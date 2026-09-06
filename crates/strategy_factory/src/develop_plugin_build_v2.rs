//! R&D-owned deterministic local producer for one bounded `StrategyDesignV2` plugin.
//!
//! This is an isolated local-build proof. It deliberately owns no durable store, API, workflow,
//! deployment, or trading effect.

use std::{collections::BTreeMap, path::Component};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::{Builder as TempDirBuilder, TempDir};
use vibe_data::owner::source_binding::BindingDigest;

use crate::{
    cargo_artifact::{PluginCargoBuildEvidenceV2, VerifiedPluginCargoBuildV2},
    strategy_design_v2::PluginManifestV2,
    strategy_plan_v2::{durable_decode, durable_encode, plugin_manifest_digest},
};

use super::develop_plugin_build_v2_sandbox::{
    BUILD_COMMAND, RUSTC_COMMIT, RUSTC_RELEASE, SandboxExecutionReceiptV2, TARGET, build_once,
    frozen_config_digest, matches_frozen_execution_profile,
};

const CAPSULE_SCHEMA_VERSION: u16 = 2;
const RECEIPT_SCHEMA_VERSION: u16 = 2;
const LANGUAGE: &str = "rust.no_std.fixed-abi-source.v2";
const SOURCE_PATH: &str = "src/lib.rs";
const MAX_FILES: usize = 1;
const MAX_SOURCE_BYTES: usize = 32 * 1024;
const MAX_CAPSULE_BYTES: usize = 40 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedDevelopPluginSourceFileV2 {
    pub path: String,
    pub bytes: Vec<u8>,
    pub symlink_target: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedDevelopPluginCapsuleV2 {
    pub schema_version: u16,
    pub manifest: PluginManifestV2,
    pub language: String,
    pub rustc_release: String,
    pub rustc_commit: String,
    pub target: String,
    pub build_command: Vec<String>,
    pub files: Vec<UntrustedDevelopPluginSourceFileV2>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum DevelopPluginBuildTerminalKindV2 {
    Conflict,
    InvalidCapsule,
    ToolchainUnavailable,
    SandboxUnavailable,
    BuildFailed,
    NonReproducible,
    VerificationFailed,
    CleanupFailed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DevelopPluginBuildTerminalV2 {
    pub kind: DevelopPluginBuildTerminalKindV2,
    pub coordinate: String,
    pub reason: String,
}

impl DevelopPluginBuildTerminalV2 {
    pub(super) fn new(
        kind: DevelopPluginBuildTerminalKindV2,
        coordinate: &str,
        reason: &str,
    ) -> Self {
        Self {
            kind,
            coordinate: coordinate.to_owned(),
            reason: reason.to_owned(),
        }
    }

    fn invalid(coordinate: &str, reason: &str) -> Self {
        Self::new(
            DevelopPluginBuildTerminalKindV2::InvalidCapsule,
            coordinate,
            reason,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DevelopPluginBuildReceiptV2 {
    schema_version: u16,
    receipt_digest: BindingDigest,
    manifest_digest: BindingDigest,
    implementation_capsule_digest: BindingDigest,
    source_entry_digest: BindingDigest,
    module_digest: BindingDigest,
    executions: Vec<DevelopPluginBuildExecutionReceiptV2>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct DevelopPluginBuildExecutionReceiptV2 {
    ordinal: u8,
    rustc_release: String,
    rustc_commit: String,
    host: String,
    cargo_digest: BindingDigest,
    rustc_digest: BindingDigest,
    linker_digest: BindingDigest,
    target_sysroot_digest: Option<BindingDigest>,
    config_digest: BindingDigest,
    target: String,
    build_command: Vec<String>,
    status: i32,
    output_digest: BindingDigest,
}

#[derive(Serialize)]
struct ReceiptBodyV2<'a> {
    schema_version: u16,
    manifest_digest: BindingDigest,
    implementation_capsule_digest: BindingDigest,
    source_entry_digest: BindingDigest,
    module_digest: BindingDigest,
    executions: &'a [DevelopPluginBuildExecutionReceiptV2],
}

impl DevelopPluginBuildReceiptV2 {
    pub(crate) const fn receipt_digest(&self) -> BindingDigest {
        self.receipt_digest
    }

    pub(crate) const fn implementation_capsule_digest(&self) -> BindingDigest {
        self.implementation_capsule_digest
    }

    pub(crate) const fn module_digest(&self) -> BindingDigest {
        self.module_digest
    }

    pub(crate) fn canonical_bytes(&self) -> Vec<u8> {
        durable_encode(self)
    }

    pub(crate) fn parse_canonical(bytes: &[u8]) -> Option<Self> {
        let receipt: Self = durable_decode(bytes).ok()?;
        (receipt.canonical_bytes() == bytes && receipt.validates()).then_some(receipt)
    }

    pub(crate) fn validates(&self) -> bool {
        self.schema_version == RECEIPT_SCHEMA_VERSION
            && self.executions.len() == 2
            && self
                .executions
                .iter()
                .enumerate()
                .all(|(index, execution)| {
                    execution.ordinal == (index + 1) as u8
                        && execution.rustc_release == RUSTC_RELEASE
                        && execution.rustc_commit == RUSTC_COMMIT
                        && matches_frozen_execution_profile(
                            &execution.host,
                            *execution.cargo_digest.as_bytes(),
                            *execution.rustc_digest.as_bytes(),
                            *execution.linker_digest.as_bytes(),
                            execution
                                .target_sysroot_digest
                                .map(|digest| *digest.as_bytes()),
                        )
                        && execution.target == TARGET
                        && execution.build_command == BUILD_COMMAND
                        && execution.status == 0
                        && execution.output_digest == self.module_digest
                })
            && self.receipt_digest == receipt_digest(self)
    }

    pub(crate) fn validates_for_manifest(&self, manifest: &PluginManifestV2) -> bool {
        let capsule = fixed_capsule(manifest);
        let Ok(validated) = validate_capsule(manifest, &capsule) else {
            return false;
        };
        self.validates()
            && self.binds_manifest_and_frozen_profile(manifest)
            && self.implementation_capsule_digest == validated.capsule_digest
            && self.source_entry_digest == validated.source_digest
    }

    pub(crate) fn validates_for_restart(
        &self,
        manifest: &PluginManifestV2,
        expected_receipt_digest: BindingDigest,
        expected_module_digest: BindingDigest,
    ) -> bool {
        self.validates()
            && self.binds_manifest_and_frozen_profile(manifest)
            && self.receipt_digest == expected_receipt_digest
            && self.module_digest == expected_module_digest
    }

    fn binds_manifest_and_frozen_profile(&self, manifest: &PluginManifestV2) -> bool {
        let expected_config = BindingDigest::from_untrusted_bytes(frozen_config_digest(
            manifest.max_linear_memory_bytes,
        ));
        self.manifest_digest == plugin_manifest_digest(manifest)
            && self
                .executions
                .iter()
                .all(|execution| execution.config_digest == expected_config)
    }
}

fn fixed_capsule(manifest: &PluginManifestV2) -> UntrustedDevelopPluginCapsuleV2 {
    UntrustedDevelopPluginCapsuleV2 {
        schema_version: CAPSULE_SCHEMA_VERSION,
        manifest: manifest.clone(),
        language: LANGUAGE.to_owned(),
        rustc_release: RUSTC_RELEASE.to_owned(),
        rustc_commit: RUSTC_COMMIT.to_owned(),
        target: TARGET.to_owned(),
        build_command: BUILD_COMMAND
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
        files: vec![UntrustedDevelopPluginSourceFileV2 {
            path: SOURCE_PATH.to_owned(),
            bytes: bounded_source(manifest).into_bytes(),
            symlink_target: None,
        }],
    }
}

#[cfg(test)]
pub(crate) fn mutated_build_receipt_bytes_for_test(bytes: &[u8]) -> Vec<Vec<u8>> {
    type ReceiptMutation = Box<dyn Fn(&mut DevelopPluginBuildReceiptV2)>;
    let receipt = DevelopPluginBuildReceiptV2::parse_canonical(bytes).expect("test receipt");
    let mut mutations: Vec<ReceiptMutation> = vec![
        Box::new(|value| value.schema_version += 1),
        Box::new(|value| value.manifest_digest = BindingDigest::from_untrusted_bytes([0xa1; 32])),
        Box::new(|value| {
            value.implementation_capsule_digest = BindingDigest::from_untrusted_bytes([0xa2; 32]);
        }),
        Box::new(|value| {
            value.source_entry_digest = BindingDigest::from_untrusted_bytes([0xa3; 32]);
        }),
        Box::new(|value| value.module_digest = BindingDigest::from_untrusted_bytes([0xa4; 32])),
        Box::new(|value| value.executions[0].ordinal = 9),
        Box::new(|value| value.executions[0].rustc_release.push('x')),
        Box::new(|value| value.executions[0].rustc_commit.push('x')),
        Box::new(|value| value.executions[0].host.push('x')),
        Box::new(|value| {
            value.executions[0].cargo_digest = BindingDigest::from_untrusted_bytes([0xa5; 32]);
        }),
        Box::new(|value| {
            value.executions[0].rustc_digest = BindingDigest::from_untrusted_bytes([0xa6; 32]);
        }),
        Box::new(|value| {
            value.executions[0].linker_digest = BindingDigest::from_untrusted_bytes([0xa7; 32]);
        }),
        Box::new(|value| {
            value.executions[0].target_sysroot_digest =
                Some(BindingDigest::from_untrusted_bytes([0xaa; 32]));
        }),
        Box::new(|value| {
            value.executions[0].config_digest = BindingDigest::from_untrusted_bytes([0xa8; 32]);
        }),
        Box::new(|value| value.executions[0].target.push('x')),
        Box::new(|value| {
            value.executions[0]
                .build_command
                .push("unexpected".to_owned());
        }),
        Box::new(|value| value.executions[0].status = 1),
        Box::new(|value| {
            value.executions[0].output_digest = BindingDigest::from_untrusted_bytes([0xa9; 32]);
        }),
        Box::new(|value| value.executions[1].ordinal = 1),
        Box::new(|value| value.executions[1].rustc_release.push('x')),
        Box::new(|value| value.executions[1].rustc_commit.push('x')),
        Box::new(|value| value.executions[1].host.push('x')),
        Box::new(|value| {
            value.executions[1].cargo_digest = BindingDigest::from_untrusted_bytes([0xb1; 32]);
        }),
        Box::new(|value| {
            value.executions[1].rustc_digest = BindingDigest::from_untrusted_bytes([0xb2; 32]);
        }),
        Box::new(|value| {
            value.executions[1].linker_digest = BindingDigest::from_untrusted_bytes([0xb3; 32]);
        }),
        Box::new(|value| {
            value.executions[1].target_sysroot_digest =
                Some(BindingDigest::from_untrusted_bytes([0xba; 32]));
        }),
        Box::new(|value| {
            value.executions[1].config_digest = BindingDigest::from_untrusted_bytes([0xb4; 32]);
        }),
        Box::new(|value| value.executions[1].target.push('x')),
        Box::new(|value| {
            value.executions[1]
                .build_command
                .push("unexpected".to_owned());
        }),
        Box::new(|value| value.executions[1].status = 1),
        Box::new(|value| {
            value.executions[1].output_digest = BindingDigest::from_untrusted_bytes([0xb5; 32]);
        }),
        Box::new(|value| {
            value.executions.pop();
        }),
        Box::new(|value| value.receipt_digest = BindingDigest::from_untrusted_bytes([0xaa; 32])),
    ];
    let mutation_count = mutations.len();
    mutations
        .drain(..)
        .enumerate()
        .map(|(index, mutation)| {
            let mut candidate = receipt.clone();
            mutation(&mut candidate);
            if index + 1 != mutation_count {
                candidate.receipt_digest = receipt_digest(&candidate);
            }
            durable_encode(&candidate)
        })
        .collect()
}

pub(crate) struct VerifiedDevelopPluginBuildReadV2 {
    build: VerifiedDevelopPluginBuildV2,
}

pub(crate) struct VerifiedDevelopPluginBuildV2 {
    receipt: DevelopPluginBuildReceiptV2,
    build: VerifiedPluginCargoBuildV2,
}

impl VerifiedDevelopPluginBuildV2 {
    fn new(receipt: DevelopPluginBuildReceiptV2, build: VerifiedPluginCargoBuildV2) -> Self {
        Self { receipt, build }
    }

    pub(crate) fn plugin_semantic_id(&self) -> &str {
        self.build.plugin_semantic_id()
    }
    pub(crate) const fn manifest_digest(&self) -> BindingDigest {
        self.build.manifest_digest()
    }
    pub(crate) fn wasm(&self) -> &[u8] {
        self.build.wasm()
    }
    pub(crate) const fn verified_build_receipt_digest(&self) -> BindingDigest {
        self.build.verified_build_receipt_digest()
    }

    pub(crate) fn into_verified_for_composer(
        self,
        manifest: &PluginManifestV2,
    ) -> Result<VerifiedPluginCargoBuildV2, crate::develop_composer_v2::DevelopComposerTerminalV2>
    {
        if !self.receipt.validates_for_manifest(manifest)
            || self.receipt.module_digest != self.build.module_digest()
            || self.receipt.implementation_capsule_digest
                != self.build.implementation_capsule_digest()
            || self.receipt.source_entry_digest != self.build.source_entry_digest()
            || self.receipt.receipt_digest != self.build.verified_build_receipt_digest()
        {
            return Err(
                crate::develop_composer_v2::DevelopComposerTerminalV2::unavailable(
                    "plugin_builds.receipt",
                    "move-bound plugin build provenance is not exact and current at consumption",
                ),
            );
        }
        VerifiedPluginCargoBuildV2::verify(
            manifest,
            PluginCargoBuildEvidenceV2 {
                wasm_one: self.build.wasm(),
                wasm_two: self.build.wasm(),
                implementation_capsule_digest: self.build.implementation_capsule_digest(),
                source_entry_digest: self.build.source_entry_digest(),
                verified_build_receipt_digest: self.build.verified_build_receipt_digest(),
            },
        )
        .map_err(|e| {
            crate::develop_composer_v2::DevelopComposerTerminalV2::unavailable(
                "plugin_builds.consume",
                &format!("move-bound plugin build failed current consumption validation: {e}"),
            )
        })
    }
}

impl VerifiedDevelopPluginBuildReadV2 {
    pub(crate) const fn receipt(&self) -> &DevelopPluginBuildReceiptV2 {
        &self.build.receipt
    }

    pub(crate) fn into_composer_build(self) -> VerifiedDevelopPluginBuildV2 {
        self.build
    }

    pub(crate) fn canonical_receipt_bytes(&self) -> Vec<u8> {
        self.build.receipt.canonical_bytes()
    }
}

pub(crate) enum DevelopPluginBuildResultV2 {
    Verified(Box<VerifiedDevelopPluginBuildReadV2>),
    Terminal(DevelopPluginBuildTerminalV2),
}

#[derive(Default)]
pub(crate) struct DevelopPluginBuildProducerV2 {
    completed_by_plugin: BTreeMap<String, StoredBuildV2>,
}

struct StoredBuildV2 {
    request_digest: BindingDigest,
    receipt: DevelopPluginBuildReceiptV2,
    wasm: Box<[u8]>,
}

impl DevelopPluginBuildProducerV2 {
    pub(crate) fn build(
        &mut self,
        current_manifest: &PluginManifestV2,
        capsule: &UntrustedDevelopPluginCapsuleV2,
    ) -> DevelopPluginBuildResultV2 {
        let validated = match validate_capsule(current_manifest, capsule) {
            Ok(value) => value,
            Err(terminal) => return DevelopPluginBuildResultV2::Terminal(terminal),
        };

        if let Some(stored) = self
            .completed_by_plugin
            .get(current_manifest.semantic_id.as_str())
        {
            if stored.request_digest != validated.capsule_digest {
                return DevelopPluginBuildResultV2::Terminal(DevelopPluginBuildTerminalV2::new(
                    DevelopPluginBuildTerminalKindV2::Conflict,
                    "capsule.plugin_semantic_id",
                    "a different plugin capsule already owns this semantic identity",
                ));
            }
            return replay_verified(current_manifest, stored);
        }

        let first = match private_tempdir() {
            Ok(value) => value,
            Err(e) => {
                return DevelopPluginBuildResultV2::Terminal(DevelopPluginBuildTerminalV2::new(
                    DevelopPluginBuildTerminalKindV2::SandboxUnavailable,
                    "sandbox.root",
                    &e.to_string(),
                ));
            }
        };
        let second = match private_tempdir() {
            Ok(value) => value,
            Err(e) => {
                let original: Result<(), DevelopPluginBuildTerminalV2> =
                    Err(DevelopPluginBuildTerminalV2::new(
                        DevelopPluginBuildTerminalKindV2::SandboxUnavailable,
                        "sandbox.root",
                        &e.to_string(),
                    ));
                let first_cleanup = first.close();
                let no_second_root = Ok(());
                return terminal_result(finish_cleanup(original, &first_cleanup, &no_second_root));
            }
        };
        let crate_name = crate_name(&current_manifest.semantic_id);
        let outcome = (|| {
            let build_one = build_once(
                first.path(),
                validated.source,
                &crate_name,
                current_manifest.max_linear_memory_bytes,
            )?;
            let build_two = build_once(
                second.path(),
                validated.source,
                &crate_name,
                current_manifest.max_linear_memory_bytes,
            )?;

            if build_one.wasm != build_two.wasm {
                return Err(DevelopPluginBuildTerminalV2::new(
                    DevelopPluginBuildTerminalKindV2::NonReproducible,
                    "build.wasm",
                    "the two isolated offline builds produced different Wasm bytes",
                ));
            }

            if build_one.execution.cargo_digest != build_two.execution.cargo_digest
                || build_one.execution.rustc_digest != build_two.execution.rustc_digest
                || build_one.execution.linker_digest != build_two.execution.linker_digest
                || build_one.execution.host != build_two.execution.host
                || build_one.execution.target_sysroot_digest
                    != build_two.execution.target_sysroot_digest
                || build_one.execution.config_digest != build_two.execution.config_digest
            {
                return Err(DevelopPluginBuildTerminalV2::new(
                    DevelopPluginBuildTerminalKindV2::VerificationFailed,
                    "build.authority",
                    "isolated builds observed different tool or config identities",
                ));
            }
            let module_digest = digest(&build_one.wasm);
            let receipt = make_receipt(
                current_manifest,
                validated.capsule_digest,
                validated.source_digest,
                module_digest,
                &build_one.execution,
                &build_two.execution,
            );

            if !receipt.validates() {
                return Err(DevelopPluginBuildTerminalV2::new(
                    DevelopPluginBuildTerminalKindV2::VerificationFailed,
                    "build.receipt",
                    "the deterministic build receipt did not validate",
                ));
            }
            let verified = verify_existing(current_manifest, &receipt, &build_one.wasm)?;
            Ok(PendingBuildV2 {
                receipt,
                verified,
                wasm: build_one.wasm.into_boxed_slice(),
            })
        })();
        let first_cleanup = first.close();
        let second_cleanup = second.close();
        let pending = match finish_cleanup(outcome, &first_cleanup, &second_cleanup) {
            Ok(value) => value,
            Err(terminal) => return DevelopPluginBuildResultV2::Terminal(terminal),
        };
        let stored = StoredBuildV2 {
            request_digest: validated.capsule_digest,
            receipt: pending.receipt.clone(),
            wasm: pending.wasm,
        };
        self.completed_by_plugin
            .insert(current_manifest.semantic_id.clone(), stored);
        DevelopPluginBuildResultV2::Verified(Box::new(VerifiedDevelopPluginBuildReadV2 {
            build: VerifiedDevelopPluginBuildV2::new(pending.receipt, pending.verified),
        }))
    }

    #[cfg(test)]
    pub(crate) fn corrupt_receipt_for_test(&mut self, plugin_semantic_id: &str) {
        if let Some(stored) = self.completed_by_plugin.get_mut(plugin_semantic_id) {
            stored.receipt.executions[1].status = 9;
        }
    }
}

#[cfg(all(test, feature = "sealed-develop-composer-acceptance"))]
pub(crate) fn generate_sealed_corpus_artifacts_v2(
    manifest: &PluginManifestV2,
    capsule: &UntrustedDevelopPluginCapsuleV2,
) -> Result<(Vec<u8>, Vec<u8>), DevelopPluginBuildTerminalV2> {
    match DevelopPluginBuildProducerV2::default().build(manifest, capsule) {
        DevelopPluginBuildResultV2::Verified(build) => {
            let module = build.build.build.wasm().to_vec();
            let receipt = build.canonical_receipt_bytes();
            for (label, digest) in [
                ("manifest", build.receipt().manifest_digest),
                ("capsule", build.receipt().implementation_capsule_digest),
                ("source", build.receipt().source_entry_digest),
                ("module", build.receipt().module_digest),
                ("receipt", build.receipt().receipt_digest),
                ("receipt_bytes", digest(&receipt)),
            ] {
                eprintln!(
                    "{label}={}",
                    digest
                        .as_bytes()
                        .iter()
                        .map(|byte| format!("{byte:02x}"))
                        .collect::<String>()
                );
            }
            Ok((module, receipt))
        }
        DevelopPluginBuildResultV2::Terminal(terminal) => Err(terminal),
    }
}

struct PendingBuildV2 {
    receipt: DevelopPluginBuildReceiptV2,
    verified: VerifiedPluginCargoBuildV2,
    wasm: Box<[u8]>,
}

pub(crate) fn finish_cleanup<T>(
    outcome: Result<T, DevelopPluginBuildTerminalV2>,
    first: &std::io::Result<()>,
    second: &std::io::Result<()>,
) -> Result<T, DevelopPluginBuildTerminalV2> {
    if let Some(error) = first.as_ref().err().or_else(|| second.as_ref().err()) {
        return Err(cleanup_terminal(error));
    }
    outcome
}

fn terminal_result<T>(
    outcome: Result<T, DevelopPluginBuildTerminalV2>,
) -> DevelopPluginBuildResultV2 {
    match outcome {
        Err(terminal) => DevelopPluginBuildResultV2::Terminal(terminal),
        Ok(_) => unreachable!("cleanup-only finalization cannot produce a positive"),
    }
}

fn private_tempdir() -> std::io::Result<TempDir> {
    TempDirBuilder::new()
        .prefix("vibe-develop-plugin-v2-")
        .tempdir()
}

struct ValidatedCapsuleV2<'a> {
    capsule_digest: BindingDigest,
    source_digest: BindingDigest,
    source: &'a [u8],
}

pub(crate) fn validated_capsule_digest_v2(
    current_manifest: &PluginManifestV2,
    capsule: &UntrustedDevelopPluginCapsuleV2,
) -> Result<BindingDigest, DevelopPluginBuildTerminalV2> {
    validate_capsule(current_manifest, capsule).map(|validated| validated.capsule_digest)
}

fn validate_capsule<'a>(
    current_manifest: &PluginManifestV2,
    capsule: &'a UntrustedDevelopPluginCapsuleV2,
) -> Result<ValidatedCapsuleV2<'a>, DevelopPluginBuildTerminalV2> {
    let canonical = serde_json::to_vec(capsule)
        .map_err(|e| DevelopPluginBuildTerminalV2::invalid("capsule", &e.to_string()))?;
    if canonical.len() > MAX_CAPSULE_BYTES {
        return Err(DevelopPluginBuildTerminalV2::invalid(
            "capsule.bytes",
            "capsule exceeds the frozen byte bound",
        ));
    }

    if capsule.schema_version != CAPSULE_SCHEMA_VERSION
        || capsule.language != LANGUAGE
        || capsule.rustc_release != RUSTC_RELEASE
        || capsule.rustc_commit != RUSTC_COMMIT
        || capsule.target != TARGET
        || capsule
            .build_command
            .iter()
            .map(String::as_str)
            .ne(BUILD_COMMAND)
    {
        return Err(DevelopPluginBuildTerminalV2::invalid(
            "capsule.build_profile",
            "language, toolchain, target, or build command is outside the frozen profile",
        ));
    }

    if &capsule.manifest != current_manifest {
        return Err(DevelopPluginBuildTerminalV2::invalid(
            "capsule.manifest",
            "capsule manifest does not byte-semantically equal the current declared manifest",
        ));
    }

    if capsule.files.len() != MAX_FILES {
        return Err(DevelopPluginBuildTerminalV2::invalid(
            "capsule.files",
            "capsule must contain exactly one source file",
        ));
    }
    let file = &capsule.files[0];
    let path = std::path::Path::new(&file.path);
    if file.path != SOURCE_PATH
        || path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || file.symlink_target.is_some()
    {
        return Err(DevelopPluginBuildTerminalV2::invalid(
            "capsule.files[0].path",
            "source path must be the exact regular path src/lib.rs",
        ));
    }

    if file.bytes.is_empty() || file.bytes.len() > MAX_SOURCE_BYTES {
        return Err(DevelopPluginBuildTerminalV2::invalid(
            "capsule.files[0].bytes",
            "source is empty or exceeds the frozen byte bound",
        ));
    }
    let expected = bounded_source(current_manifest);
    if file.bytes != expected.as_bytes() {
        return Err(DevelopPluginBuildTerminalV2::invalid(
            "capsule.files[0].language",
            "source is outside the fixed no_std ABI source language",
        ));
    }
    Ok(ValidatedCapsuleV2 {
        capsule_digest: domain_digest(b"rd.develop.plugin-capsule.v2\0", &canonical),
        source_digest: digest(&file.bytes),
        source: &file.bytes,
    })
}

pub(crate) fn bounded_source(manifest: &PluginManifestV2) -> String {
    let input = frame_capacity(&manifest.input_ports, manifest.state.max_bytes);
    let output = frame_capacity(&manifest.output_ports, manifest.state.max_bytes);
    format!(
        "#![no_std]\n\n#[panic_handler]\nfn panic(_: &core::panic::PanicInfo<'_>) -> ! {{ loop {{ core::hint::spin_loop(); }} }}\n\n#[unsafe(no_mangle)]\npub extern \"C\" fn strategy_factory_plugin_input_ptr_v2() -> i32 {{ 1024 }}\n#[unsafe(no_mangle)]\npub extern \"C\" fn strategy_factory_plugin_input_capacity_v2() -> i32 {{ {input} }}\n#[unsafe(no_mangle)]\npub extern \"C\" fn strategy_factory_plugin_output_ptr_v2() -> i32 {{ 8192 }}\n#[unsafe(no_mangle)]\npub extern \"C\" fn strategy_factory_plugin_output_capacity_v2() -> i32 {{ {output} }}\n#[unsafe(no_mangle)]\npub extern \"C\" fn strategy_factory_plugin_invoke_v2(_: i32) -> i32 {{ 0 }}\n"
    )
}

fn frame_capacity(ports: &[crate::strategy_design_v2::PortContractV2], state: u32) -> usize {
    96 + (ports.len() + 1) * 8
        + state as usize
        + ports
            .iter()
            .map(|port| port.max_bytes as usize)
            .sum::<usize>()
}

fn crate_name(semantic_id: &str) -> String {
    let suffix = Sha256::digest(semantic_id.as_bytes())[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("bounded_plugin_{suffix}")
}

fn make_receipt(
    manifest: &PluginManifestV2,
    capsule_digest: BindingDigest,
    source_digest: BindingDigest,
    module_digest: BindingDigest,
    one: &SandboxExecutionReceiptV2,
    two: &SandboxExecutionReceiptV2,
) -> DevelopPluginBuildReceiptV2 {
    let mut receipt = DevelopPluginBuildReceiptV2 {
        schema_version: RECEIPT_SCHEMA_VERSION,
        receipt_digest: BindingDigest::from_untrusted_bytes([0; 32]),
        manifest_digest: plugin_manifest_digest(manifest),
        implementation_capsule_digest: capsule_digest,
        source_entry_digest: source_digest,
        module_digest,
        executions: [one, two]
            .into_iter()
            .enumerate()
            .map(|(index, execution)| DevelopPluginBuildExecutionReceiptV2 {
                ordinal: (index + 1) as u8,
                rustc_release: RUSTC_RELEASE.to_owned(),
                rustc_commit: RUSTC_COMMIT.to_owned(),
                host: execution.host.to_owned(),
                cargo_digest: BindingDigest::from_untrusted_bytes(execution.cargo_digest),
                rustc_digest: BindingDigest::from_untrusted_bytes(execution.rustc_digest),
                linker_digest: BindingDigest::from_untrusted_bytes(execution.linker_digest),
                target_sysroot_digest: execution
                    .target_sysroot_digest
                    .map(BindingDigest::from_untrusted_bytes),
                config_digest: BindingDigest::from_untrusted_bytes(execution.config_digest),
                target: TARGET.to_owned(),
                build_command: BUILD_COMMAND
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect(),
                status: execution.status_code,
                output_digest: module_digest,
            })
            .collect(),
    };
    receipt.receipt_digest = receipt_digest(&receipt);
    receipt
}

fn receipt_digest(receipt: &DevelopPluginBuildReceiptV2) -> BindingDigest {
    domain_digest(
        b"rd.develop.plugin-build-receipt.v2\0",
        &durable_encode(&ReceiptBodyV2 {
            schema_version: receipt.schema_version,
            manifest_digest: receipt.manifest_digest,
            implementation_capsule_digest: receipt.implementation_capsule_digest,
            source_entry_digest: receipt.source_entry_digest,
            module_digest: receipt.module_digest,
            executions: &receipt.executions,
        }),
    )
}

fn replay_verified(
    manifest: &PluginManifestV2,
    stored: &StoredBuildV2,
) -> DevelopPluginBuildResultV2 {
    if !stored.receipt.validates() {
        return DevelopPluginBuildResultV2::Terminal(DevelopPluginBuildTerminalV2::new(
            DevelopPluginBuildTerminalKindV2::VerificationFailed,
            "build.receipt",
            "stored build receipt is invalid",
        ));
    }

    match verify_existing(manifest, &stored.receipt, &stored.wasm) {
        Ok(build) => {
            DevelopPluginBuildResultV2::Verified(Box::new(VerifiedDevelopPluginBuildReadV2 {
                build: VerifiedDevelopPluginBuildV2::new(stored.receipt.clone(), build),
            }))
        }
        Err(terminal) => DevelopPluginBuildResultV2::Terminal(terminal),
    }
}

fn verify_existing(
    manifest: &PluginManifestV2,
    receipt: &DevelopPluginBuildReceiptV2,
    wasm: &[u8],
) -> Result<VerifiedPluginCargoBuildV2, DevelopPluginBuildTerminalV2> {
    if receipt.manifest_digest != plugin_manifest_digest(manifest)
        || receipt.module_digest != digest(wasm)
    {
        return Err(DevelopPluginBuildTerminalV2::new(
            DevelopPluginBuildTerminalKindV2::VerificationFailed,
            "build.binding",
            "build receipt does not bind the current manifest and module",
        ));
    }
    VerifiedPluginCargoBuildV2::verify(
        manifest,
        PluginCargoBuildEvidenceV2 {
            wasm_one: wasm,
            wasm_two: wasm,
            implementation_capsule_digest: receipt.implementation_capsule_digest,
            source_entry_digest: receipt.source_entry_digest,
            verified_build_receipt_digest: receipt.receipt_digest,
        },
    )
    .map_err(|e| {
        DevelopPluginBuildTerminalV2::new(
            DevelopPluginBuildTerminalKindV2::VerificationFailed,
            "build.module",
            &e.to_string(),
        )
    })
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[derive(Clone, Copy)]
enum SealedCorpusDiagnosticCoordinateV2 {
    SixRole,
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    SourceResearchComposer,
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[derive(Clone, Copy)]
struct SealedCorpusDescriptorV2 {
    manifest_digest: [u8; 32],
    capsule_digest: [u8; 32],
    source_digest: [u8; 32],
    module_digest: [u8; 32],
    receipt_digest: [u8; 32],
    receipt_bytes_digest: [u8; 32],
    diagnostic_coordinate: SealedCorpusDiagnosticCoordinateV2,
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
const SEALED_A0_CORPUS_V2: SealedCorpusDescriptorV2 = SealedCorpusDescriptorV2 {
    manifest_digest: hex_digest_v2(
        "bb6b75f44e95a41c9683691cd39ca7c3c083740b33974a03b13bde54387fc92a",
    ),
    capsule_digest: hex_digest_v2(
        "2c8a39cb9a1aaf61fd9302068863c2184807982c50234136ffd8d1f7cdce0f0d",
    ),
    source_digest: hex_digest_v2(
        "66c1449e081bb1b96ae07d69a19d07b341956a06f62e5e8c547fc23cae7a13c2",
    ),
    module_digest: hex_digest_v2(
        "427c3fe1a189e00489a912fc39fbdc412a59e4600a843a167ef8db1f5f8eddf7",
    ),
    receipt_digest: hex_digest_v2(
        "d387e50a860e4980b16008262f4f782c9bcf330482881eedecba0571b7dfe046",
    ),
    receipt_bytes_digest: hex_digest_v2(
        "10e8eccbf32176892c530c974755639be8d006b3d3bbbe15909af9414e320b53",
    ),
    diagnostic_coordinate: SealedCorpusDiagnosticCoordinateV2::SixRole,
};

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
const SOURCE_RESEARCH_COMPOSER_A0_CORPUS_V2: SealedCorpusDescriptorV2 = SealedCorpusDescriptorV2 {
    manifest_digest: hex_digest_v2(
        "6eb061e68e31eda0488fa76b57cc6992b0d80c7b08ea62c711e23aff3d2192ad",
    ),
    capsule_digest: hex_digest_v2(
        "c8b25ba67ae8bc0542381ff6641fdf94f78862553578fc2e83ef5f374735a475",
    ),
    source_digest: hex_digest_v2(
        "fe174c795cebae2bf218ec329026fad0dfebde0bf76210a00f1e477d4e82bc57",
    ),
    module_digest: hex_digest_v2(
        "ece334467363f04a0308f1c312c5f2917124d2464c8abf93b0f35c340073c5ec",
    ),
    receipt_digest: hex_digest_v2(
        "23d11565c257b0c9904fd1ec685434e966d7e286137d5e3de8cda6b41c838e97",
    ),
    receipt_bytes_digest: hex_digest_v2(
        "bd66d4b9266ec8578d0e0f90c7515f2df548e4104c193701bb7764060433b58e",
    ),
    diagnostic_coordinate: SealedCorpusDiagnosticCoordinateV2::SourceResearchComposer,
};

#[cfg(feature = "sealed-develop-composer-acceptance")]
pub(crate) fn sealed_corpus_verified_build_v2(
    manifest: &PluginManifestV2,
    capsule: &UntrustedDevelopPluginCapsuleV2,
) -> Result<VerifiedDevelopPluginBuildReadV2, DevelopPluginBuildTerminalV2> {
    verify_sealed_corpus_artifacts_v2(
        manifest,
        capsule,
        include_bytes!("../fixtures/develop_composer_sealed_a0_v2/module.wasm"),
        include_bytes!("../fixtures/develop_composer_sealed_a0_v2/build_receipt.bin"),
    )
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(crate) fn source_research_composer_sealed_corpus_verified_build_v2(
    manifest: &PluginManifestV2,
    capsule: &UntrustedDevelopPluginCapsuleV2,
) -> Result<VerifiedDevelopPluginBuildReadV2, DevelopPluginBuildTerminalV2> {
    verify_source_research_composer_sealed_corpus_artifacts_v2(
        manifest,
        capsule,
        include_bytes!("../fixtures/source_research_composer_sealed_a0_v2/module.wasm"),
        include_bytes!("../fixtures/source_research_composer_sealed_a0_v2/build_receipt.bin"),
    )
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn verify_source_research_composer_sealed_corpus_artifacts_v2(
    manifest: &PluginManifestV2,
    capsule: &UntrustedDevelopPluginCapsuleV2,
    module: &[u8],
    receipt_bytes: &[u8],
) -> Result<VerifiedDevelopPluginBuildReadV2, DevelopPluginBuildTerminalV2> {
    verify_sealed_corpus_artifacts_with_descriptor_v2(
        manifest,
        capsule,
        module,
        receipt_bytes,
        SOURCE_RESEARCH_COMPOSER_A0_CORPUS_V2,
    )
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
fn verify_sealed_corpus_artifacts_v2(
    manifest: &PluginManifestV2,
    capsule: &UntrustedDevelopPluginCapsuleV2,
    module: &[u8],
    receipt_bytes: &[u8],
) -> Result<VerifiedDevelopPluginBuildReadV2, DevelopPluginBuildTerminalV2> {
    verify_sealed_corpus_artifacts_with_descriptor_v2(
        manifest,
        capsule,
        module,
        receipt_bytes,
        SEALED_A0_CORPUS_V2,
    )
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
fn verify_sealed_corpus_artifacts_with_descriptor_v2(
    manifest: &PluginManifestV2,
    capsule: &UntrustedDevelopPluginCapsuleV2,
    module: &[u8],
    receipt_bytes: &[u8],
    corpus: SealedCorpusDescriptorV2,
) -> Result<VerifiedDevelopPluginBuildReadV2, DevelopPluginBuildTerminalV2> {
    let validated = validate_capsule(manifest, capsule)?;
    if plugin_manifest_digest(manifest).as_bytes() != &corpus.manifest_digest
        || validated.capsule_digest.as_bytes() != &corpus.capsule_digest
        || validated.source_digest.as_bytes() != &corpus.source_digest
    {
        return Err(sealed_corpus_terminal_v2(
            corpus.diagnostic_coordinate,
            SealedCorpusVerificationStageV2::Corpus,
        ));
    }

    if digest(module).as_bytes() != &corpus.module_digest
        || digest(receipt_bytes).as_bytes() != &corpus.receipt_bytes_digest
    {
        return Err(sealed_corpus_terminal_v2(
            corpus.diagnostic_coordinate,
            SealedCorpusVerificationStageV2::Artifacts,
        ));
    }
    let receipt = DevelopPluginBuildReceiptV2::parse_canonical(receipt_bytes).ok_or_else(|| {
        sealed_corpus_terminal_v2(
            corpus.diagnostic_coordinate,
            SealedCorpusVerificationStageV2::ReceiptCanonical,
        )
    })?;

    if receipt.manifest_digest.as_bytes() != &corpus.manifest_digest
        || receipt.implementation_capsule_digest.as_bytes() != &corpus.capsule_digest
        || receipt.source_entry_digest.as_bytes() != &corpus.source_digest
        || receipt.module_digest.as_bytes() != &corpus.module_digest
        || receipt.receipt_digest.as_bytes() != &corpus.receipt_digest
    {
        return Err(sealed_corpus_terminal_v2(
            corpus.diagnostic_coordinate,
            SealedCorpusVerificationStageV2::ReceiptBinding,
        ));
    }
    let verified = verify_existing(manifest, &receipt, module)?;
    Ok(VerifiedDevelopPluginBuildReadV2 {
        build: VerifiedDevelopPluginBuildV2::new(receipt, verified),
    })
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[derive(Clone, Copy)]
enum SealedCorpusVerificationStageV2 {
    Corpus,
    Artifacts,
    ReceiptCanonical,
    ReceiptBinding,
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
fn sealed_corpus_terminal_v2(
    diagnostic: SealedCorpusDiagnosticCoordinateV2,
    stage: SealedCorpusVerificationStageV2,
) -> DevelopPluginBuildTerminalV2 {
    let (kind, coordinate, reason) = match (diagnostic, stage) {
        (SealedCorpusDiagnosticCoordinateV2::SixRole, SealedCorpusVerificationStageV2::Corpus) => (
            DevelopPluginBuildTerminalKindV2::Conflict,
            "sealed_acceptance.a0_corpus",
            "manifest or capsule does not match the fixed sealed A0 corpus",
        ),
        (
            SealedCorpusDiagnosticCoordinateV2::SixRole,
            SealedCorpusVerificationStageV2::Artifacts,
        ) => (
            DevelopPluginBuildTerminalKindV2::VerificationFailed,
            "sealed_acceptance.a0_artifacts",
            "embedded sealed A0 artifact bytes do not match their fixed digests",
        ),
        (
            SealedCorpusDiagnosticCoordinateV2::SixRole,
            SealedCorpusVerificationStageV2::ReceiptCanonical,
        ) => (
            DevelopPluginBuildTerminalKindV2::VerificationFailed,
            "sealed_acceptance.a0_receipt",
            "embedded sealed A0 build receipt is not canonical and valid",
        ),
        (
            SealedCorpusDiagnosticCoordinateV2::SixRole,
            SealedCorpusVerificationStageV2::ReceiptBinding,
        ) => (
            DevelopPluginBuildTerminalKindV2::VerificationFailed,
            "sealed_acceptance.a0_receipt",
            "embedded sealed A0 receipt does not bind the fixed corpus and module",
        ),
        #[cfg(feature = "sealed-source-intake-composer-acceptance")]
        (
            SealedCorpusDiagnosticCoordinateV2::SourceResearchComposer,
            SealedCorpusVerificationStageV2::Corpus,
        ) => (
            DevelopPluginBuildTerminalKindV2::Conflict,
            "sealed_acceptance.source_research_composer_a0_corpus",
            "manifest or capsule does not match the dedicated fixed A2 A0 corpus",
        ),
        #[cfg(feature = "sealed-source-intake-composer-acceptance")]
        (
            SealedCorpusDiagnosticCoordinateV2::SourceResearchComposer,
            SealedCorpusVerificationStageV2::Artifacts,
        ) => (
            DevelopPluginBuildTerminalKindV2::VerificationFailed,
            "sealed_acceptance.source_research_composer_a0_artifacts",
            "embedded dedicated A2 A0 artifact bytes do not match their fixed digests",
        ),
        #[cfg(feature = "sealed-source-intake-composer-acceptance")]
        (
            SealedCorpusDiagnosticCoordinateV2::SourceResearchComposer,
            SealedCorpusVerificationStageV2::ReceiptCanonical,
        ) => (
            DevelopPluginBuildTerminalKindV2::VerificationFailed,
            "sealed_acceptance.source_research_composer_a0_receipt",
            "embedded dedicated A2 A0 build receipt is not canonical and valid",
        ),
        #[cfg(feature = "sealed-source-intake-composer-acceptance")]
        (
            SealedCorpusDiagnosticCoordinateV2::SourceResearchComposer,
            SealedCorpusVerificationStageV2::ReceiptBinding,
        ) => (
            DevelopPluginBuildTerminalKindV2::VerificationFailed,
            "sealed_acceptance.source_research_composer_a0_receipt",
            "embedded dedicated A2 A0 receipt does not bind its fixed corpus and module",
        ),
    };
    DevelopPluginBuildTerminalV2::new(kind, coordinate, reason)
}

#[cfg(all(test, feature = "sealed-develop-composer-acceptance"))]
pub(crate) fn verify_sealed_corpus_artifacts_for_test_v2(
    manifest: &PluginManifestV2,
    capsule: &UntrustedDevelopPluginCapsuleV2,
    module: &[u8],
    receipt_bytes: &[u8],
) -> Result<(), DevelopPluginBuildTerminalV2> {
    verify_sealed_corpus_artifacts_v2(manifest, capsule, module, receipt_bytes).map(drop)
}

#[cfg(all(test, feature = "sealed-source-intake-composer-acceptance"))]
pub(crate) fn verify_source_research_composer_sealed_corpus_artifacts_for_test_v2(
    manifest: &PluginManifestV2,
    capsule: &UntrustedDevelopPluginCapsuleV2,
    module: &[u8],
    receipt_bytes: &[u8],
) -> Result<(), DevelopPluginBuildTerminalV2> {
    verify_source_research_composer_sealed_corpus_artifacts_v2(
        manifest,
        capsule,
        module,
        receipt_bytes,
    )
    .map(drop)
}

/// Portable sealed Composer-test evidence for one fixed repository corpus.
///
/// This is not A0 producer proof: it accepts no caller manifest, source, digest, path, or command,
/// exists only in test builds, and still enters the sole plugin verifier plus the real move-bound
/// Composer consumption checks.
#[cfg(test)]
pub(crate) fn portable_sealed_composer_test_evidence() -> VerifiedDevelopPluginBuildReadV2 {
    let mut design = crate::program_host_v2_tests::executable_design();
    design.plugins[0].max_fuel = 10_000_000;
    let manifest = design.plugins.remove(0);
    let wasm = crate::program_host_v2_backtest_tests::stateful_plugin_module(&manifest)
        .expect("fixed portable Composer-test Wasm corpus is valid");
    let execution = SandboxExecutionReceiptV2 {
        status_code: 0,
        host: "aarch64-apple-darwin",
        cargo_digest: super::develop_plugin_build_v2_sandbox::CARGO_SHA256,
        rustc_digest: super::develop_plugin_build_v2_sandbox::RUSTC_SHA256,
        linker_digest: super::develop_plugin_build_v2_sandbox::LINKER_SHA256,
        target_sysroot_digest: None,
        config_digest: super::develop_plugin_build_v2_sandbox::frozen_config_digest_for_test(
            manifest.max_linear_memory_bytes,
        ),
    };
    let capsule = fixed_capsule(&manifest);
    let validated = validate_capsule(&manifest, &capsule)
        .expect("fixed portable Composer-test capsule is canonical");
    let receipt = make_receipt(
        &manifest,
        validated.capsule_digest,
        validated.source_digest,
        digest(&wasm),
        &execution,
        &execution,
    );
    let verified = verify_existing(&manifest, &receipt, &wasm)
        .expect("sealed portable Composer-test evidence passes the sole plugin verifier");
    VerifiedDevelopPluginBuildReadV2 {
        build: VerifiedDevelopPluginBuildV2::new(receipt, verified),
    }
}

fn cleanup_terminal(error: &std::io::Error) -> DevelopPluginBuildTerminalV2 {
    DevelopPluginBuildTerminalV2::new(
        DevelopPluginBuildTerminalKindV2::CleanupFailed,
        "sandbox.cleanup",
        &error.to_string(),
    )
}

fn digest(bytes: &[u8]) -> BindingDigest {
    BindingDigest::from_untrusted_bytes(Sha256::digest(bytes).into())
}

fn domain_digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
const fn hex_digest_v2(value: &str) -> [u8; 32] {
    let bytes = value.as_bytes();
    let mut output = [0; 32];
    let mut index = 0;
    while index < output.len() {
        output[index] =
            (hex_nibble_v2(bytes[index * 2]) << 4) | hex_nibble_v2(bytes[index * 2 + 1]);
        index += 1;
    }
    output
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
const fn hex_nibble_v2(value: u8) -> u8 {
    match value {
        b'0'..=b'9' => value - b'0',
        b'a'..=b'f' => value - b'a' + 10,
        _ => panic!("invalid sealed A0 digest"),
    }
}
