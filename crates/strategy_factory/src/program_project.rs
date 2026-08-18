use std::{
    collections::BTreeSet,
    fs,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
};

use anyhow::Context;
use serde::Deserialize;
use serde_json::Value;
use vibe_core::paths::custody::{open_custodied_directory, read_bounded_regular_at};

use crate::{
    artifact::{ArtifactIssuance, StrategyArtifact, digest},
    cargo_artifact::{CargoBuildEvidence, VerifiedCargoBuild},
    family::FrozenStrategyFamily,
    pilot::verified_pilot_build,
};

pub(crate) const PROGRAM_SEAL_SCRIPT_BYTES: &[u8] = include_bytes!("../tools/seal-program.sh");
pub(crate) const PROGRAM_SEAL_DOCKERFILE_BYTES: &[u8] =
    include_bytes!("../tools/program-seal.dockerfile");

const PRODUCT_FILES: [&str; 4] = [
    "build-recipe.jcs",
    "program.first.wasm",
    "program.second.wasm",
    "source-capsule.tar",
];
const MAX_CAPSULE_ENTRIES: usize = 256;
const MAX_CAPSULE_FILE_BYTES: u64 = 1_048_576;
const MAX_CAPSULE_CONTENT_BYTES: u64 = 4 * 1_048_576;
const PROJECT_MANIFEST: &str = "strategy-program-project-v1.jcs";
const PROPOSAL_ARTIFACT_SCHEMA_VERSION: u32 = 2;
const PROPOSAL_INTENT_FILE: &str = "research-intent-proposal-v1.jcs";
const PROPOSAL_INTENT_MAX_BYTES: usize = 64 * 1_024;
const PROPOSAL_NON_CLAIMS: [&str; 8] = [
    "NO_ALPHA_CLAIM",
    "NO_DATA_AUTHORITY",
    "NO_EVIDENCE_VERIFICATION",
    "NO_EXECUTION_AUTHORITY",
    "NO_FORMATION_AUTHORITY",
    "NO_LIVE_AUTHORITY",
    "NO_QUALIFICATION_AUTHORITY",
    "NO_RESULT_AUTHORITY",
];
const PROPOSAL_INTENT_TEMPLATE_BYTES: &[u8] = b"{\"authority\":{\"artifact\":\"CANDIDATE_IDENTITY_ONLY\",\"data\":\"NONE\",\"evidence\":\"DECLARED_LOCATORS_ONLY_NOT_VERIFIED\",\"execution\":\"NONE\",\"formation\":\"NONE\",\"qualification\":\"NONE\",\"results\":\"NONE\"},\"evaluation\":{\"holdout\":\"replace-me\",\"metrics\":[{\"id\":\"metric-1\",\"statement\":\"replace-me\"}]},\"evidence\":[{\"claim\":\"replace-me\",\"id\":\"source-1\",\"locator\":\"replace-me\"}],\"falsifiers\":[\"replace-me\"],\"hypothesis\":\"replace-me\",\"identity\":\"replace-me\",\"inputs\":{\"channels\":[]},\"kind\":\"ResearchIntentProposal\",\"non_claims\":[\"NO_ALPHA_CLAIM\",\"NO_DATA_AUTHORITY\",\"NO_EVIDENCE_VERIFICATION\",\"NO_EXECUTION_AUTHORITY\",\"NO_FORMATION_AUTHORITY\",\"NO_LIVE_AUTHORITY\",\"NO_QUALIFICATION_AUTHORITY\",\"NO_RESULT_AUTHORITY\"],\"parameter_space\":{\"parameters\":[]},\"revision\":1,\"schema_version\":1}\n";

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResearchIntentProposalDocument {
    authority: ResearchIntentProposalAuthority,
    evaluation: ResearchIntentProposalEvaluation,
    evidence: Vec<ResearchIntentProposalEvidence>,
    falsifiers: Vec<String>,
    hypothesis: String,
    identity: String,
    inputs: ResearchIntentProposalInputs,
    kind: String,
    non_claims: Vec<String>,
    parameter_space: ResearchIntentProposalParameterSpace,
    revision: u32,
    schema_version: u32,
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResearchIntentProposalEvaluation {
    holdout: String,
    metrics: Vec<ResearchIntentProposalStatement>,
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResearchIntentProposalInputs {
    channels: Vec<ResearchIntentProposalStatement>,
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResearchIntentProposalParameterSpace {
    parameters: Vec<ResearchIntentProposalStatement>,
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResearchIntentProposalStatement {
    id: String,
    statement: String,
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResearchIntentProposalAuthority {
    artifact: String,
    data: String,
    evidence: String,
    execution: String,
    formation: String,
    qualification: String,
    results: String,
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResearchIntentProposalEvidence {
    claim: String,
    id: String,
    locator: String,
}

/// Opaque, proposal-only research input sealed with one strategy project.
/// It is not the authoritative [`crate::ResearchIntent`] accepted by a frozen family.
///
/// ```compile_fail
/// use vibe_strategy_factory::ResearchIntentProposal;
/// let _ = ResearchIntentProposal {};
/// ```
#[derive(Clone, PartialEq, Eq)]
pub struct ResearchIntentProposal {
    canonical_bytes: Box<[u8]>,
    content_digest: String,
    document: ResearchIntentProposalDocument,
}

impl std::fmt::Debug for ResearchIntentProposal {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(ResearchIntentProposal))
            .field("identity", &self.document.identity)
            .field("revision", &self.document.revision)
            .field("content_digest", &self.content_digest)
            .finish_non_exhaustive()
    }
}

impl ResearchIntentProposal {
    fn parse(bytes: &[u8]) -> anyhow::Result<Self> {
        anyhow::ensure!(
            (1..=PROPOSAL_INTENT_MAX_BYTES).contains(&bytes.len()),
            "research intent proposal size is invalid"
        );
        let value: Value = serde_json::from_slice(bytes)?;
        let mut canonical = serde_json::to_vec(&value)?;
        canonical.push(b'\n');
        anyhow::ensure!(
            canonical == bytes,
            "research intent proposal is not canonical JSON+LF"
        );
        let document: ResearchIntentProposalDocument = serde_json::from_value(value)?;
        validate_proposal_document(&document)?;
        Ok(Self {
            canonical_bytes: bytes.into(),
            content_digest: digest(bytes),
            document,
        })
    }

    pub fn identity(&self) -> &str {
        &self.document.identity
    }

    pub const fn revision(&self) -> u32 {
        self.document.revision
    }

    pub fn content_digest(&self) -> &str {
        &self.content_digest
    }

    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

fn validate_proposal_document(document: &ResearchIntentProposalDocument) -> anyhow::Result<()> {
    anyhow::ensure!(
        document.kind == "ResearchIntentProposal"
            && document.schema_version == 1
            && (1..=1_000_000).contains(&document.revision),
        "research intent proposal kind, schema, or revision is invalid"
    );
    anyhow::ensure!(
        valid_identifier(&document.identity) && document.identity != "replace-me",
        "research intent proposal identity is invalid"
    );
    validate_text(&document.hypothesis, 4_096, "hypothesis")?;
    anyhow::ensure!(
        document.hypothesis != "replace-me",
        "research intent proposal is a placeholder"
    );
    validate_text(&document.evaluation.holdout, 4_096, "holdout")?;
    anyhow::ensure!(
        document.evaluation.holdout != "replace-me",
        "research intent proposal holdout is a placeholder"
    );
    validate_statements(&document.evaluation.metrics, 1, 32, "metrics")?;
    validate_statements(&document.inputs.channels, 0, 32, "channels")?;
    validate_statements(&document.parameter_space.parameters, 0, 64, "parameters")?;
    anyhow::ensure!(
        (1..=32).contains(&document.evidence.len()),
        "research intent proposal evidence count is invalid"
    );
    let mut prior = None;
    for evidence in &document.evidence {
        anyhow::ensure!(
            valid_identifier(&evidence.id),
            "research intent proposal evidence id is invalid"
        );
        if let Some(prior) = prior {
            anyhow::ensure!(
                prior < evidence.id.as_str(),
                "research intent proposal evidence must be sorted and unique"
            );
        }
        prior = Some(evidence.id.as_str());
        validate_text(&evidence.claim, 4_096, "evidence claim")?;
        validate_text(&evidence.locator, 2_048, "evidence locator")?;
        anyhow::ensure!(
            evidence.claim != "replace-me" && evidence.locator != "replace-me",
            "research intent proposal evidence is a placeholder"
        );
    }
    anyhow::ensure!(
        (1..=32).contains(&document.falsifiers.len()),
        "research intent proposal falsifier count is invalid"
    );
    for falsifier in &document.falsifiers {
        validate_text(falsifier, 4_096, "falsifier")?;
        anyhow::ensure!(
            falsifier != "replace-me",
            "research intent proposal is a placeholder"
        );
    }
    anyhow::ensure!(
        document.falsifiers.windows(2).all(|pair| pair[0] < pair[1]),
        "research intent proposal falsifiers must be sorted and unique"
    );
    anyhow::ensure!(
        document.non_claims == PROPOSAL_NON_CLAIMS,
        "research intent proposal non-claims are invalid"
    );
    let authority = &document.authority;
    anyhow::ensure!(
        authority.artifact == "CANDIDATE_IDENTITY_ONLY"
            && authority.data == "NONE"
            && authority.evidence == "DECLARED_LOCATORS_ONLY_NOT_VERIFIED"
            && authority.execution == "NONE"
            && authority.formation == "NONE"
            && authority.qualification == "NONE"
            && authority.results == "NONE",
        "research intent proposal authority is invalid"
    );
    Ok(())
}

fn validate_text(value: &str, max: usize, label: &str) -> anyhow::Result<()> {
    anyhow::ensure!(
        value == value.trim() && (1..=max).contains(&value.len()),
        "research intent proposal {label} is invalid"
    );
    Ok(())
}

fn valid_identifier(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn validate_statements(
    statements: &[ResearchIntentProposalStatement],
    min: usize,
    max: usize,
    label: &str,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        (min..=max).contains(&statements.len()),
        "research intent proposal {label} count is invalid"
    );
    for statement in statements {
        anyhow::ensure!(
            valid_identifier(&statement.id),
            "research intent proposal {label} id is invalid"
        );
        validate_text(&statement.statement, 4_096, label)?;
        anyhow::ensure!(
            statement.statement != "replace-me",
            "research intent proposal {label} is a placeholder"
        );
    }
    anyhow::ensure!(
        statements.windows(2).all(|pair| pair[0].id < pair[1].id),
        "research intent proposal {label} must be sorted and unique"
    );
    Ok(())
}

/// Opaque custody for one reproducibly sealed, non-authoritative strategy proposal.
/// It cannot execute, issue receipts, access data, or enter Formation or Qualification.
/// Durable cross-process export is not admitted; custody lasts for this handle.
/// ```compile_fail
/// use vibe_strategy_factory::StrategyProjectProposal;
/// let _ = StrategyProjectProposal {};
/// ```
pub struct StrategyProjectProposal {
    artifact: StrategyArtifact,
    build: VerifiedCargoBuild,
    intent: ResearchIntentProposal,
}
impl std::fmt::Debug for StrategyProjectProposal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct(stringify!(StrategyProjectProposal))
            .field("artifact_identity", self.artifact.identity())
            .finish_non_exhaustive()
    }
}
impl StrategyProjectProposal {
    pub const fn artifact(&self) -> &StrategyArtifact {
        &self.artifact
    }

    pub const fn intent(&self) -> &ResearchIntentProposal {
        &self.intent
    }

    /// Materializes the retained exact source capsule into a new private project directory.
    pub fn materialize(&self, parent: &Path) -> anyhow::Result<PathBuf> {
        materialize_build(&self.build, parent)
    }

    /// Reseals a materialized project and recovers the exact proposal Artifact.
    pub fn recover(&self, project_manifest: &Path) -> anyhow::Result<StrategyArtifact> {
        let actual = seal_project(project_manifest, self.build.profile.runtime_budget)?;
        anyhow::ensure!(actual == self.build, "strategy proposal project changed");
        let intent = proposal_intent_from_build(&actual)?;
        anyhow::ensure!(intent == self.intent, "research intent proposal changed");
        let artifact = issue_proposal_artifact(&actual, intent.canonical_bytes())?;
        anyhow::ensure!(
            artifact == self.artifact,
            "strategy proposal identity changed"
        );
        Ok(artifact)
    }
}

/// Materializes the smallest existing SDK project as an editable proposal scaffold.
pub fn materialize_strategy_project_scaffold(parent: &Path) -> anyhow::Result<PathBuf> {
    materialize_build_with(verified_pilot_build()?, parent, install_proposal_intent)
}

/// Seals an edited project into a candidate-only Artifact with no execution authority.
pub fn seal_strategy_project_proposal(
    project_manifest: &Path,
) -> anyhow::Result<StrategyProjectProposal> {
    let budget = verified_pilot_build()?.profile.runtime_budget;
    issue_strategy_project_proposal(seal_project(project_manifest, budget)?)
}

fn issue_strategy_project_proposal(
    build: VerifiedCargoBuild,
) -> anyhow::Result<StrategyProjectProposal> {
    let intent = proposal_intent_from_build(&build)?;
    let artifact = issue_proposal_artifact(&build, intent.canonical_bytes())?;
    Ok(StrategyProjectProposal {
        artifact,
        build,
        intent,
    })
}

fn issue_proposal_artifact(
    build: &VerifiedCargoBuild,
    intent_bytes: &[u8],
) -> anyhow::Result<StrategyArtifact> {
    Ok(StrategyArtifact::issue(&ArtifactIssuance::program(
        PROPOSAL_ARTIFACT_SCHEMA_VERSION,
        intent_bytes,
        None,
        None,
        None,
        build,
    ))?)
}

/// Opaque family-owned access to one dependency-locked program project.
pub struct FrozenProgramProject<'a> {
    pub(crate) family: &'a FrozenStrategyFamily,
    pub(crate) build: &'a VerifiedCargoBuild,
}

impl<'a> FrozenProgramProject<'a> {
    /// Materializes the exact frozen source capsule in a new private project directory.
    pub fn materialize(&self, parent: &Path) -> anyhow::Result<PathBuf> {
        materialize_build(self.build, parent)
    }

    /// Reseals an exact recovered project and returns only the existing family-issued artifacts.
    pub fn recover(&self, project_manifest: &Path) -> anyhow::Result<Vec<StrategyArtifact>> {
        let actual = self.seal_candidate(project_manifest)?;
        anyhow::ensure!(
            actual == *self.build,
            "strategy-program project does not reproduce the frozen family build"
        );
        Ok(self.family.materialize_all()?)
    }

    pub(crate) fn seal_candidate(
        &self,
        project_manifest: &Path,
    ) -> anyhow::Result<VerifiedCargoBuild> {
        let current = self.family.program_project()?;
        anyhow::ensure!(
            current.build == self.build,
            "frozen family project authority changed"
        );
        seal_project(project_manifest, self.build.profile.runtime_budget)
    }
}

#[cfg(unix)]
fn initialize_git_root(root: &Path) -> anyhow::Result<()> {
    let status = Command::new("/usr/bin/git")
        .args(["-c", "init.templateDir=", "init", "-q"])
        .arg(root)
        .env_clear()
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .context("trusted Git was unavailable")?;
    anyhow::ensure!(status.success(), "trusted Git could not initialize project");
    Ok(())
}

pub(crate) fn seal_project(
    project_manifest: &Path,
    runtime_budget: crate::program_runtime::ProgramRuntimeBudget,
) -> anyhow::Result<VerifiedCargoBuild> {
    let scratch = tempfile::tempdir()?;
    let script = scratch.path().join("seal-program.sh");
    let dockerfile = scratch.path().join("program-seal.dockerfile");
    let product = scratch.path().join("product");
    fs::write(&script, PROGRAM_SEAL_SCRIPT_BYTES)?;
    fs::write(&dockerfile, PROGRAM_SEAL_DOCKERFILE_BYTES)?;

    let status = Command::new("/bin/bash")
        .arg(&script)
        .arg(project_manifest)
        .arg(&product)
        .arg(&dockerfile)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .context("trusted strategy-program sealer was unavailable")?;
    anyhow::ensure!(status.success(), "strategy-program project seal failed");

    load_product(&product, runtime_budget)
}

#[cfg(test)]
fn verify_product(product: &Path, expected: &VerifiedCargoBuild) -> anyhow::Result<()> {
    let actual = load_product(product, expected.profile.runtime_budget)?;
    anyhow::ensure!(
        &actual == expected,
        "strategy-program project does not reproduce the frozen family build"
    );
    Ok(())
}

pub(crate) fn materialize_build(
    build: &VerifiedCargoBuild,
    parent: &Path,
) -> anyhow::Result<PathBuf> {
    materialize_build_with(build, parent, |_, _| Ok(()))
}

fn materialize_build_with(
    build: &VerifiedCargoBuild,
    parent: &Path,
    prepare: impl FnOnce(&Path, &Path) -> anyhow::Result<()>,
) -> anyhow::Result<PathBuf> {
    #[cfg(not(unix))]
    {
        let _ = (build, parent, prepare);
        anyhow::bail!("program project materialization requires Unix custody");
    }

    #[cfg(unix)]
    {
        let metadata = fs::symlink_metadata(parent)?;
        anyhow::ensure!(
            metadata.is_dir() && !metadata.file_type().is_symlink(),
            "program project parent must be a real directory"
        );
        let parent = fs::canonicalize(parent)?;
        open_custodied_directory(&parent)?;
        let staging = tempfile::Builder::new()
            .prefix(".strategy-program-project-")
            .tempdir_in(&parent)?;
        let result = (|| {
            let manifest = extract_frozen_source(build, staging.path())?;
            prepare(staging.path(), &manifest)?;
            initialize_git_root(staging.path())?;
            Ok(manifest)
        })();
        match result {
            Ok(manifest) => Ok(staging.keep().join(manifest)),
            Err(error) => {
                staging.close().context("clean partial program project")?;
                Err(error)
            }
        }
    }
}

fn install_proposal_intent(root: &Path, manifest: &Path) -> anyhow::Result<()> {
    let intent = manifest.with_file_name(PROPOSAL_INTENT_FILE);
    let intent_locator = intent
        .to_str()
        .context("research intent proposal locator is not UTF-8")?;
    let manifest_path = root.join(manifest);
    let mut document: Value = serde_json::from_slice(&fs::read(&manifest_path)?)?;
    let source_files = document
        .get_mut("source_files")
        .and_then(Value::as_array_mut)
        .context("strategy-program project source_files are unavailable")?;
    anyhow::ensure!(
        !source_files.iter().any(|value| value == intent_locator),
        "strategy-program scaffold already contains a research intent proposal"
    );
    source_files.push(Value::String(intent_locator.to_string()));
    source_files.sort_by(|left, right| left.as_str().cmp(&right.as_str()));
    fs::write(root.join(&intent), PROPOSAL_INTENT_TEMPLATE_BYTES)?;
    let mut canonical = serde_json::to_vec(&document)?;
    canonical.push(b'\n');
    fs::write(manifest_path, canonical)?;
    Ok(())
}

fn load_product(
    product: &Path,
    runtime_budget: crate::program_runtime::ProgramRuntimeBudget,
) -> anyhow::Result<VerifiedCargoBuild> {
    let names = fs::read_dir(product)?
        .map(|entry| {
            entry?
                .file_name()
                .into_string()
                .map_err(|_| anyhow::anyhow!("strategy-program product name is not UTF-8"))
        })
        .collect::<anyhow::Result<BTreeSet<_>>>()?;
    anyhow::ensure!(
        names == PRODUCT_FILES.into_iter().map(str::to_string).collect(),
        "strategy-program product topology mismatch"
    );
    let canonical_product = fs::canonicalize(product)?;
    let root = open_custodied_directory(&canonical_product)?;
    let source = read_bounded_regular_at(&root, Path::new("source-capsule.tar"), 8 * 1_048_576)?;
    let recipe = read_bounded_regular_at(&root, Path::new("build-recipe.jcs"), 32 * 1_024)?;
    let first = read_bounded_regular_at(&root, Path::new("program.first.wasm"), 64 * 1_024)?;
    let second = read_bounded_regular_at(&root, Path::new("program.second.wasm"), 64 * 1_024)?;
    Ok(VerifiedCargoBuild::verify(CargoBuildEvidence {
        wasm_one: &first,
        wasm_two: &second,
        source_capsule: &source,
        build_recipe: &recipe,
        runtime_budget,
    })?)
}

fn extract_frozen_source(build: &VerifiedCargoBuild, target: &Path) -> anyhow::Result<PathBuf> {
    let manifest = inspect_capsule(&build.source_capsule)?;
    let mut archive = tar::Archive::new(Cursor::new(&build.source_capsule));
    archive.set_preserve_mtime(false);
    archive.unpack(target)?;
    Ok(manifest)
}

fn proposal_intent_from_build(
    build: &VerifiedCargoBuild,
) -> anyhow::Result<ResearchIntentProposal> {
    let manifest = inspect_capsule(&build.source_capsule)?;
    let intent = manifest.with_file_name(PROPOSAL_INTENT_FILE);
    let intent_locator = intent
        .to_str()
        .context("research intent proposal locator is not UTF-8")?;
    let project: Value = serde_json::from_slice(&read_capsule_file(
        &build.source_capsule,
        &manifest,
        32 * 1_024,
    )?)?;
    anyhow::ensure!(
        project
            .get("source_files")
            .and_then(Value::as_array)
            .is_some_and(|sources| {
                sources
                    .iter()
                    .any(|source| source.as_str() == Some(intent_locator))
            }),
        "strategy-program project does not bind its research intent proposal"
    );
    ResearchIntentProposal::parse(&read_capsule_file(
        &build.source_capsule,
        &intent,
        PROPOSAL_INTENT_MAX_BYTES,
    )?)
}

fn read_capsule_file(bytes: &[u8], expected: &Path, limit: usize) -> anyhow::Result<Vec<u8>> {
    let mut archive = tar::Archive::new(Cursor::new(bytes));
    let mut content = None;
    for entry in archive.entries()? {
        let mut entry = entry?;
        let directory = entry.header().entry_type().is_dir();
        let path = safe_capsule_path(&entry.path()?, directory)?;
        if path != expected {
            continue;
        }
        anyhow::ensure!(
            entry.header().entry_type().is_file() && content.is_none(),
            "source capsule file is duplicated or not regular"
        );
        anyhow::ensure!(
            entry.size() <= limit as u64,
            "source capsule file is too large"
        );
        let mut bytes = Vec::new();
        entry
            .by_ref()
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes)?;
        anyhow::ensure!(bytes.len() <= limit, "source capsule file is too large");
        content = Some(bytes);
    }
    content.context("source capsule file is missing")
}

fn inspect_capsule(bytes: &[u8]) -> anyhow::Result<PathBuf> {
    let mut archive = tar::Archive::new(Cursor::new(bytes));
    let mut paths = BTreeSet::new();
    let mut manifests = Vec::new();
    let mut content_bytes = 0u64;
    let mut entry_count = 0usize;
    for entry in archive.entries()? {
        let entry = entry?;
        entry_count += 1;
        anyhow::ensure!(
            entry_count <= MAX_CAPSULE_ENTRIES,
            "too many source entries"
        );
        let entry_type = entry.header().entry_type();
        let directory = entry_type.is_dir();
        anyhow::ensure!(
            directory || entry_type.is_file(),
            "source capsule contains a non-file entry"
        );
        let path = safe_capsule_path(&entry.path()?, directory)?;
        if path.as_os_str().is_empty() {
            continue;
        }
        anyhow::ensure!(paths.insert(path.clone()), "duplicate source capsule path");
        if !directory {
            let size = entry.size();
            anyhow::ensure!(size <= MAX_CAPSULE_FILE_BYTES, "source entry is too large");
            content_bytes = content_bytes.saturating_add(size);
            if path
                .file_name()
                .is_some_and(|name| name == PROJECT_MANIFEST)
            {
                manifests.push(path.clone());
            }
        }
    }
    anyhow::ensure!(
        content_bytes <= MAX_CAPSULE_CONTENT_BYTES,
        "source capsule content is too large"
    );
    anyhow::ensure!(
        manifests.len() == 1,
        "source capsule must contain one project manifest"
    );
    Ok(manifests.pop().expect("one project manifest"))
}

fn safe_capsule_path(path: &Path, directory: bool) -> anyhow::Result<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => normalized.push(part),
            _ => anyhow::bail!("unsafe source capsule path"),
        }
    }
    anyhow::ensure!(
        directory || !normalized.as_os_str().is_empty(),
        "empty file path"
    );
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use serde_json::json;

    use super::*;

    fn canonical_bytes(value: &Value) -> Vec<u8> {
        let mut bytes = serde_json::to_vec(value).unwrap();
        bytes.push(b'\n');
        bytes
    }

    fn valid_proposal_value() -> Value {
        let mut value: Value = serde_json::from_slice(PROPOSAL_INTENT_TEMPLATE_BYTES).unwrap();
        value["identity"] = json!("session-state-proposal-v1");
        value["hypothesis"] = json!("Session-aware behavior is testable after costs.");
        value["evaluation"]["holdout"] = json!("one-way reserved partition");
        value["evaluation"]["metrics"][0]["statement"] = json!("Net return after costs.");
        value["evidence"][0]["claim"] = json!("Session boundaries can change market behavior.");
        value["evidence"][0]["locator"] = json!("doi:10.1093/rfs/hhi027");
        value["falsifiers"][0] = json!("Costs exceed gross returns in every coordinate.");
        value
    }

    #[rstest]
    fn proposal_intent_is_canonical_bounded_and_non_authoritative() {
        let bytes = canonical_bytes(&valid_proposal_value());
        assert_eq!(ResearchIntentProposal::parse(&bytes).unwrap().revision(), 1);
        assert!(ResearchIntentProposal::parse(PROPOSAL_INTENT_TEMPLATE_BYTES).is_err());
        assert!(ResearchIntentProposal::parse(&bytes[..bytes.len() - 1]).is_err());
        assert!(ResearchIntentProposal::parse(&vec![b' '; PROPOSAL_INTENT_MAX_BYTES + 1]).is_err());

        let mut wrong_authority = valid_proposal_value();
        wrong_authority["authority"]["execution"] = json!("PROPOSED");
        assert!(ResearchIntentProposal::parse(&canonical_bytes(&wrong_authority)).is_err());

        let mut unknown = valid_proposal_value();
        unknown["evaluation"]["authority"] = json!({"execution": "AUTHORIZED"});
        assert!(ResearchIntentProposal::parse(&canonical_bytes(&unknown)).is_err());

        let mut unknown_statement = valid_proposal_value();
        unknown_statement["evaluation"]["metrics"][0]["qualification"] = json!("PASSED");
        assert!(ResearchIntentProposal::parse(&canonical_bytes(&unknown_statement)).is_err());

        let mut nested_statement = valid_proposal_value();
        nested_statement["evaluation"]["metrics"][0]["statement"] =
            json!({"qualification": "PASSED"});
        assert!(ResearchIntentProposal::parse(&canonical_bytes(&nested_statement)).is_err());

        let mut missing_shape = valid_proposal_value();
        missing_shape["inputs"] = json!({"unknown": true});
        assert!(ResearchIntentProposal::parse(&canonical_bytes(&missing_shape)).is_err());

        let mut duplicate = valid_proposal_value();
        let repeated = duplicate["evidence"][0].clone();
        duplicate["evidence"].as_array_mut().unwrap().push(repeated);
        assert!(ResearchIntentProposal::parse(&canonical_bytes(&duplicate)).is_err());
    }

    fn write_product(root: &Path, wasm: &[u8]) {
        fs::write(
            root.join("source-capsule.tar"),
            include_bytes!("../assets/program_complex_v1/source-capsule.tar"),
        )
        .unwrap();
        fs::write(
            root.join("build-recipe.jcs"),
            include_bytes!("../assets/program_complex_v1/build-recipe.jcs"),
        )
        .unwrap();
        fs::write(root.join("program.first.wasm"), wasm).unwrap();
        fs::write(root.join("program.second.wasm"), wasm).unwrap();
    }

    #[rstest]
    fn product_loader_requires_the_complete_frozen_build() {
        let root = tempfile::tempdir().unwrap();
        let expected = crate::family_adapters::verified_price_build().unwrap();
        write_product(root.path(), &expected.wasm);
        verify_product(root.path(), expected).unwrap();

        let mut source = expected.source_capsule.to_vec();
        source[0] ^= 1;
        fs::write(root.path().join("source-capsule.tar"), source).unwrap();
        assert!(verify_product(root.path(), expected).is_err());

        fs::write(root.path().join("unexpected"), b"extra").unwrap();
        assert!(verify_product(root.path(), expected).is_err());
    }

    #[rstest]
    fn two_copied_abi_valid_wasm_files_cannot_replace_the_frozen_project() {
        let root = tempfile::tempdir().unwrap();
        let expected = crate::family_adapters::verified_price_build().unwrap();
        let foreign = include_bytes!("../assets/program_channel_control_v1/program.first.wasm");
        write_product(root.path(), foreign);
        assert!(verify_product(root.path(), expected).is_err());
    }

    #[cfg(unix)]
    #[rstest]
    fn product_loader_rejects_symlinked_material() {
        let root = tempfile::tempdir().unwrap();
        let expected = crate::family_adapters::verified_price_build().unwrap();
        write_product(root.path(), &expected.wasm);
        fs::remove_file(root.path().join("program.second.wasm")).unwrap();
        std::os::unix::fs::symlink(
            root.path().join("program.first.wasm"),
            root.path().join("program.second.wasm"),
        )
        .unwrap();
        assert!(verify_product(root.path(), expected).is_err());
    }

    #[rstest]
    fn capsule_decoder_rejects_unsafe_paths_and_non_files() {
        assert!(safe_capsule_path(Path::new("../escape"), false).is_err());
        assert!(safe_capsule_path(Path::new("/absolute"), false).is_err());
        assert!(safe_capsule_path(Path::new("."), false).is_err());

        let mut bytes = Vec::new();
        {
            let mut builder = tar::Builder::new(&mut bytes);
            let mut header = tar::Header::new_gnu();
            header.set_entry_type(tar::EntryType::Symlink);
            header.set_size(0);
            header.set_cksum();
            builder
                .append_data(&mut header, "link", std::io::empty())
                .unwrap();
            builder.finish().unwrap();
        }
        assert!(inspect_capsule(&bytes).is_err());
    }

    #[rstest]
    fn capsule_decoder_rejects_duplicates_and_truncation() {
        let mut bytes = Vec::new();
        {
            let mut builder = tar::Builder::new(&mut bytes);
            for value in *b"ab" {
                let mut header = tar::Header::new_gnu();
                header.set_size(1);
                header.set_cksum();
                builder
                    .append_data(&mut header, "duplicate", [value].as_slice())
                    .unwrap();
            }
            builder.finish().unwrap();
        }
        assert!(inspect_capsule(&bytes).is_err());
        bytes.truncate(513);
        assert!(inspect_capsule(&bytes).is_err());
    }

    #[rstest]
    fn capsule_decoder_counts_empty_directory_entries() {
        let mut bytes = Vec::new();
        {
            let mut builder = tar::Builder::new(&mut bytes);
            for _ in 0..=MAX_CAPSULE_ENTRIES {
                let mut header = tar::Header::new_gnu();
                header.set_entry_type(tar::EntryType::Directory);
                header.set_size(0);
                header.set_cksum();
                builder.append_data(&mut header, "./", &[][..]).unwrap();
            }
            builder.finish().unwrap();
        }
        assert!(
            inspect_capsule(&bytes)
                .unwrap_err()
                .to_string()
                .contains("too many source entries")
        );
    }
}
