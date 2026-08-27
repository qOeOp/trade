//! R&D-owned, failure-atomic Strategy Design V2 Develop composition.
//!
//! This crate-local first vertical deliberately uses an in-memory join store. It proves the Owner
//! contract and the sole V2 compiler/Artifact path, but does not claim durable PostgreSQL, API, or
//! workflow readiness.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use vibe_data::owner::source_binding::BindingDigest;

use crate::{
    artifact_v2::StrategyArtifactV2,
    cargo_artifact::VerifiedPluginCargoBuildV2,
    develop_plugin_build_v2::VerifiedDevelopPluginBuildV2,
    product_edge::{
        FrozenResearchGoalIntent, ResearchRequestDisposition, ResearchViewAvailability,
        ResearchViewPhase,
    },
    program_runtime::validate_plugin_candidate_v2,
    rd_owner_postgres_custody::VerifiedResearchCustodyV1,
    strategy_design_v2::{PluginManifestV2, StrategyDesignV2},
    strategy_plan_v2::{
        CompilationIssueV2, StrategyCompilationV2, StrategyDesignPreparationV2, StrategyPlanV2,
        VerifiedStrategyInputBindingsV2, compile_strategy_design_v2_with_verified_bindings,
        durable_decode, durable_encode, issue_plugin_implementation_receipt_v2,
        plugin_manifest_digest, prepare_strategy_design_v2,
    },
};

const RECEIPT_SCHEMA_V2: u16 = 2;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedDevelopComposerProposalV2 {
    pub research_request_locator: String,
    pub design: StrategyDesignV2,
    pub input_binding_receipt_digests: Vec<BindingDigest>,
    pub plugin_builds: Vec<UntrustedPluginBuildLocatorV2>,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedPluginBuildLocatorV2 {
    pub plugin_semantic_id: String,
    pub verified_build_receipt_digest: BindingDigest,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DevelopComposerTerminalKindV2 {
    Conflict,
    Unsupported,
    NeedsResearchRefinement,
    Unavailable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DevelopComposerTerminalV2 {
    pub kind: DevelopComposerTerminalKindV2,
    pub coordinate: String,
    pub reason: String,
}

impl DevelopComposerTerminalV2 {
    fn conflict(coordinate: &str, reason: &str) -> Self {
        Self::new(DevelopComposerTerminalKindV2::Conflict, coordinate, reason)
    }

    fn unsupported(coordinate: &str, reason: &str) -> Self {
        Self::new(
            DevelopComposerTerminalKindV2::Unsupported,
            coordinate,
            reason,
        )
    }

    pub(crate) fn unavailable(coordinate: &str, reason: &str) -> Self {
        Self::new(
            DevelopComposerTerminalKindV2::Unavailable,
            coordinate,
            reason,
        )
    }

    fn from_compilation(compilation: StrategyCompilationV2) -> Self {
        match compilation {
            StrategyCompilationV2::Unsupported(issue) => {
                Self::from_issue(DevelopComposerTerminalKindV2::Unsupported, &issue)
            }
            StrategyCompilationV2::NeedsResearchRefinement(issue) => Self::from_issue(
                DevelopComposerTerminalKindV2::NeedsResearchRefinement,
                &issue,
            ),
            StrategyCompilationV2::Compiled(_) => {
                unreachable!("compiled result is handled before terminal conversion")
            }
        }
    }

    fn from_preparation(preparation: StrategyDesignPreparationV2) -> Self {
        match preparation {
            StrategyDesignPreparationV2::Unsupported(issue) => {
                Self::from_issue(DevelopComposerTerminalKindV2::Unsupported, &issue)
            }
            StrategyDesignPreparationV2::NeedsResearchRefinement(issue) => Self::from_issue(
                DevelopComposerTerminalKindV2::NeedsResearchRefinement,
                &issue,
            ),
            StrategyDesignPreparationV2::Prepared { .. } => {
                unreachable!("prepared result is handled before terminal conversion")
            }
        }
    }

    fn from_issue(kind: DevelopComposerTerminalKindV2, issue: &CompilationIssueV2) -> Self {
        Self::new(kind, &issue.coordinate, &issue.reason)
    }

    fn new(kind: DevelopComposerTerminalKindV2, coordinate: &str, reason: &str) -> Self {
        Self {
            kind,
            coordinate: coordinate.to_owned(),
            reason: reason.to_owned(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DevelopComposerReceiptV2 {
    schema_version: u16,
    receipt_identity: BindingDigest,
    receipt_digest: BindingDigest,
    research_custody_digest: BindingDigest,
    proposal_digest: BindingDigest,
    design_identity: BindingDigest,
    design_digest: BindingDigest,
    canonical_plan_digest: BindingDigest,
    artifact_identity: BindingDigest,
    binding_receipt_digests: Vec<BindingDigest>,
    plugin_build_receipt_digests: Vec<BindingDigest>,
}

#[derive(Serialize)]
struct DevelopComposerReceiptBodyV2<'a> {
    schema_version: u16,
    research_custody_digest: BindingDigest,
    proposal_digest: BindingDigest,
    design_identity: BindingDigest,
    design_digest: BindingDigest,
    canonical_plan_digest: BindingDigest,
    artifact_identity: BindingDigest,
    binding_receipt_digests: &'a [BindingDigest],
    plugin_build_receipt_digests: &'a [BindingDigest],
}

impl DevelopComposerReceiptV2 {
    pub const fn receipt_identity(&self) -> BindingDigest {
        self.receipt_identity
    }

    pub const fn receipt_digest(&self) -> BindingDigest {
        self.receipt_digest
    }

    pub const fn design_identity(&self) -> BindingDigest {
        self.design_identity
    }

    pub const fn design_digest(&self) -> BindingDigest {
        self.design_digest
    }

    pub const fn canonical_plan_digest(&self) -> BindingDigest {
        self.canonical_plan_digest
    }

    pub const fn artifact_identity(&self) -> BindingDigest {
        self.artifact_identity
    }

    pub fn canonical_bytes(&self) -> Vec<u8> {
        durable_encode(self)
    }

    pub(crate) fn parse_canonical(bytes: &[u8]) -> Option<Self> {
        let receipt: Self = durable_decode(bytes).ok()?;
        (receipt.canonical_bytes() == bytes && receipt.validates()).then_some(receipt)
    }

    pub fn validates(&self) -> bool {
        self.schema_version == RECEIPT_SCHEMA_V2
            && self.receipt_digest == receipt_digest(self)
            && self.receipt_identity
                == domain_digest(
                    b"rd.develop.composer-receipt-identity.v2\0",
                    self.receipt_digest.as_bytes(),
                )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DevelopComposerPositiveV2 {
    receipt: DevelopComposerReceiptV2,
    plan: StrategyPlanV2,
    artifact: StrategyArtifactV2,
}

impl DevelopComposerPositiveV2 {
    pub const fn receipt(&self) -> &DevelopComposerReceiptV2 {
        &self.receipt
    }

    pub const fn plan(&self) -> &StrategyPlanV2 {
        &self.plan
    }

    pub const fn artifact(&self) -> &StrategyArtifactV2 {
        &self.artifact
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DevelopComposerResultV2 {
    Composed(Box<DevelopComposerPositiveV2>),
    Terminal(DevelopComposerTerminalV2),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct CurrentResearchDevelopCustodyV2 {
    request_locator: String,
    research_request_identity: BindingDigest,
    intent_identity: BindingDigest,
    intent_digest: BindingDigest,
    falsifier: String,
    research_receipt_identity: String,
    research_receipt_semantic_digest: String,
    research_view_identity: String,
    research_view_source_cut: String,
    trial_family_identity: String,
    trial_family_root_digest: String,
    trial_family_frontier_identity: String,
    trial_family_frontier_digest: String,
    custody_digest: BindingDigest,
}

impl CurrentResearchDevelopCustodyV2 {
    pub(crate) fn request_locator(&self) -> &str {
        &self.request_locator
    }

    pub(crate) const fn research_request_identity(&self) -> BindingDigest {
        self.research_request_identity
    }

    pub(crate) const fn intent_identity(&self) -> BindingDigest {
        self.intent_identity
    }

    pub(crate) const fn intent_digest(&self) -> BindingDigest {
        self.intent_digest
    }

    pub(crate) fn falsifier(&self) -> &str {
        &self.falsifier
    }

    pub(crate) const fn custody_digest(&self) -> BindingDigest {
        self.custody_digest
    }

    #[allow(
        dead_code,
        reason = "the first crate-local vertical has no admitted PostgreSQL composition root"
    )]
    pub(crate) fn from_verified(
        custody: &VerifiedResearchCustodyV1,
        request_locator: &str,
        read_cut_epoch_ms: u64,
    ) -> Result<Self, DevelopComposerTerminalV2> {
        let receipt = custody.receipt();
        let intent = match custody.intent() {
            Some(FrozenResearchGoalIntent::V2(intent)) => intent,
            _ => {
                return Err(DevelopComposerTerminalV2::unavailable(
                    "research_custody.intent",
                    "current accepted V2 Research Intent is unavailable",
                ));
            }
        };
        let view = custody.view().ok_or_else(|| {
            DevelopComposerTerminalV2::unavailable(
                "research_custody.view",
                "current Research View is unavailable",
            )
        })?;
        let family = custody.family().ok_or_else(|| {
            DevelopComposerTerminalV2::unavailable(
                "research_custody.trial_family",
                "complete current TrialFamily custody is unavailable",
            )
        })?;

        if custody.request_schema_version() != 2
            || receipt.disposition != ResearchRequestDisposition::Accepted
            || receipt.request_identity != request_locator
            || intent.request_identity != request_locator
            || view.availability != ResearchViewAvailability::Available
            || view.phase != ResearchViewPhase::IntentFrozen
            || view.request_identity != request_locator
            || view.intent_identity != intent.intent_identity
            || !custody.authority_available_at(read_cut_epoch_ms)
        {
            return Err(DevelopComposerTerminalV2::unavailable(
                "research_custody",
                "Research custody is not exact, current, accepted V2 custody",
            ));
        }
        let research_request_identity = domain_digest(
            b"rd.develop.request-identity.v2\0",
            request_locator.as_bytes(),
        );
        let intent_identity =
            parse_digest_suffix(&intent.intent_identity, "rd-research-intent-v2-").ok_or_else(
                || {
                    DevelopComposerTerminalV2::unavailable(
                        "research_custody.intent_identity",
                        "Research Intent identity is not the exact canonical V2 digest form",
                    )
                },
            )?;
        let intent_digest =
            parse_digest_suffix(&intent.semantic_digest, "sha256:").ok_or_else(|| {
                DevelopComposerTerminalV2::unavailable(
                    "research_custody.intent_digest",
                    "Research Intent semantic digest is not canonical SHA-256",
                )
            })?;
        let mut value = Self {
            request_locator: request_locator.to_owned(),
            research_request_identity,
            intent_identity,
            intent_digest,
            falsifier: intent.goal.falsification_question.clone(),
            research_receipt_identity: receipt.receipt_identity.clone(),
            research_receipt_semantic_digest: receipt.semantic_digest.clone(),
            research_view_identity: view.projection_identity.clone(),
            research_view_source_cut: view.source_cut.clone(),
            trial_family_identity: family.root().trial_family_identity().to_owned(),
            trial_family_root_digest: family.root().root_digest().to_owned(),
            trial_family_frontier_identity: family.census_frontier().frontier_identity().to_owned(),
            trial_family_frontier_digest: family.census_frontier().frontier_digest().to_owned(),
            custody_digest: BindingDigest::from_untrusted_bytes([0; 32]),
        };
        value.custody_digest = domain_digest(
            b"rd.develop.current-research-custody.v2\0",
            &serde_json::to_vec(&value).expect("research custody serialization"),
        );
        Ok(value)
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
impl CurrentResearchDevelopCustodyV2 {
    pub(crate) fn sealed_acceptance(request_locator: &str) -> Result<Self, serde_json::Error> {
        let mut value = Self {
            request_locator: request_locator.to_owned(),
            research_request_identity: BindingDigest::from_untrusted_bytes([1; 32]),
            intent_identity: BindingDigest::from_untrusted_bytes([2; 32]),
            intent_digest: BindingDigest::from_untrusted_bytes([3; 32]),
            falsifier: "trend state does not improve the frozen next-return decision".to_owned(),
            research_receipt_identity: "sealed-develop-research-receipt-v2".to_owned(),
            research_receipt_semantic_digest: "sha256:sealed-develop-research-v2".to_owned(),
            research_view_identity: "sealed-develop-research-view-v2".to_owned(),
            research_view_source_cut: "sealed-develop-source-cut-v2".to_owned(),
            trial_family_identity: "sealed-develop-trial-family-v2".to_owned(),
            trial_family_root_digest: "sha256:sealed-develop-family-root-v2".to_owned(),
            trial_family_frontier_identity: "sealed-develop-family-frontier-v2".to_owned(),
            trial_family_frontier_digest: "sha256:sealed-develop-family-frontier-v2".to_owned(),
            custody_digest: BindingDigest::from_untrusted_bytes([0; 32]),
        };
        let canonical_bytes = serde_json::to_vec(&value)?;
        value.custody_digest = domain_digest(
            b"rd.develop.current-research-custody.v2\0",
            &canonical_bytes,
        );
        Ok(value)
    }
}

pub(crate) trait DevelopComposerEvidencePortV2 {
    fn read_current_research(
        &self,
        request_locator: &str,
        read_cut_epoch_ms: u64,
    ) -> Result<CurrentResearchDevelopCustodyV2, DevelopComposerTerminalV2>;

    fn read_input_bindings(
        &self,
        design_identity: BindingDigest,
        receipt_digests: &[BindingDigest],
    ) -> Result<VerifiedStrategyInputBindingsV2, DevelopComposerTerminalV2>;

    fn read_plugin_builds(
        &self,
        manifests: &[PluginManifestV2],
        locators: &[UntrustedPluginBuildLocatorV2],
    ) -> Result<Vec<VerifiedDevelopPluginBuildV2>, DevelopComposerTerminalV2>;
}

#[derive(Default)]
pub(crate) struct DevelopComposerV2 {
    completed_by_intent: BTreeMap<BindingDigest, StoredCompositionV2>,
}

#[derive(Clone)]
struct StoredCompositionV2 {
    proposal_digest: BindingDigest,
    research_custody_digest: BindingDigest,
    positive: DevelopComposerPositiveV2,
}

impl DevelopComposerV2 {
    pub(crate) fn compose(
        &mut self,
        proposal: &UntrustedDevelopComposerProposalV2,
        read_cut_epoch_ms: u64,
        evidence: &impl DevelopComposerEvidencePortV2,
    ) -> DevelopComposerResultV2 {
        let custody = match evidence
            .read_current_research(&proposal.research_request_locator, read_cut_epoch_ms)
        {
            Ok(value) => value,
            Err(terminal) => return DevelopComposerResultV2::Terminal(terminal),
        };

        if proposal.design.research_request_identity != custody.research_request_identity
            || proposal.design.intent_identity != custody.intent_identity
            || proposal.design.intent_digest != custody.intent_digest
            || proposal.design.falsifier != custody.falsifier
        {
            return DevelopComposerResultV2::Terminal(DevelopComposerTerminalV2::conflict(
                "design.research_custody",
                "untrusted Design changed an R&D-controlled identity or falsifier",
            ));
        }
        let proposal_digest = canonical_proposal_digest(proposal);

        if let Some(existing) = self.completed_by_intent.get(&custody.intent_identity) {
            return if existing.research_custody_digest != custody.custody_digest {
                DevelopComposerResultV2::Terminal(DevelopComposerTerminalV2::conflict(
                    "research_custody",
                    "Research custody changed after this Intent was composed",
                ))
            } else if existing.proposal_digest == proposal_digest {
                DevelopComposerResultV2::Composed(Box::new(existing.positive.clone()))
            } else {
                DevelopComposerResultV2::Terminal(DevelopComposerTerminalV2::conflict(
                    "proposal.intent_identity",
                    "a different Develop proposal already owns this Research Intent",
                ))
            };
        }

        let preparation = prepare_strategy_design_v2(&proposal.design);
        let (design_identity, design_digest) = match preparation {
            StrategyDesignPreparationV2::Prepared {
                design_identity,
                design_digest,
            } => (design_identity, design_digest),
            terminal => {
                return DevelopComposerResultV2::Terminal(
                    DevelopComposerTerminalV2::from_preparation(terminal),
                );
            }
        };
        let requested_bindings = sorted_unique_digests(
            &proposal.input_binding_receipt_digests,
            "input_binding_receipt_digests",
        );
        let requested_bindings = match requested_bindings {
            Ok(value) => value,
            Err(terminal) => return DevelopComposerResultV2::Terminal(terminal),
        };
        let bindings = match evidence.read_input_bindings(design_identity, &requested_bindings) {
            Ok(value) => value,
            Err(terminal) => return DevelopComposerResultV2::Terminal(terminal),
        };
        let mut resolved_bindings = bindings.receipt_digests();
        resolved_bindings.sort();
        if resolved_bindings != requested_bindings {
            return DevelopComposerResultV2::Terminal(DevelopComposerTerminalV2::unsupported(
                "bindings",
                "Owner readback does not exactly cover the requested receipt set",
            ));
        }

        let requested_plugins = match canonical_plugin_locators(&proposal.plugin_builds) {
            Ok(value) => value,
            Err(terminal) => return DevelopComposerResultV2::Terminal(terminal),
        };
        let builds = match evidence.read_plugin_builds(&proposal.design.plugins, &requested_plugins)
        {
            Ok(value) => value,
            Err(terminal) => return DevelopComposerResultV2::Terminal(terminal),
        };
        let (plugin_receipts, verified_builds) =
            match resolve_plugin_builds(&proposal.design, &requested_plugins, builds) {
                Ok(value) => value,
                Err(terminal) => return DevelopComposerResultV2::Terminal(terminal),
            };

        let compilation = compile_strategy_design_v2_with_verified_bindings(
            proposal.design.clone(),
            bindings,
            &plugin_receipts,
        );
        let plan = match compilation {
            StrategyCompilationV2::Compiled(plan) => *plan,
            terminal => {
                return DevelopComposerResultV2::Terminal(
                    DevelopComposerTerminalV2::from_compilation(terminal),
                );
            }
        };
        let artifact = match StrategyArtifactV2::issue(&plan, verified_builds) {
            Ok(value) => value,
            Err(e) => {
                return DevelopComposerResultV2::Terminal(DevelopComposerTerminalV2::unsupported(
                    "artifact",
                    &e.to_string(),
                ));
            }
        };

        let plugin_build_receipt_digests = requested_plugins
            .iter()
            .map(|locator| locator.verified_build_receipt_digest)
            .collect::<Vec<_>>();
        let mut receipt = DevelopComposerReceiptV2 {
            schema_version: RECEIPT_SCHEMA_V2,
            receipt_identity: BindingDigest::from_untrusted_bytes([0; 32]),
            receipt_digest: BindingDigest::from_untrusted_bytes([0; 32]),
            research_custody_digest: custody.custody_digest,
            proposal_digest,
            design_identity,
            design_digest,
            canonical_plan_digest: plan.canonical_plan_digest(),
            artifact_identity: artifact.identity(),
            binding_receipt_digests: requested_bindings,
            plugin_build_receipt_digests,
        };
        receipt.receipt_digest = receipt_digest(&receipt);
        receipt.receipt_identity = domain_digest(
            b"rd.develop.composer-receipt-identity.v2\0",
            receipt.receipt_digest.as_bytes(),
        );
        let positive = DevelopComposerPositiveV2 {
            receipt,
            plan,
            artifact,
        };
        self.completed_by_intent.insert(
            custody.intent_identity,
            StoredCompositionV2 {
                proposal_digest,
                research_custody_digest: custody.custody_digest,
                positive: positive.clone(),
            },
        );
        DevelopComposerResultV2::Composed(Box::new(positive))
    }
}

fn resolve_plugin_builds(
    design: &StrategyDesignV2,
    requested: &[UntrustedPluginBuildLocatorV2],
    builds: Vec<VerifiedDevelopPluginBuildV2>,
) -> Result<
    (
        Vec<crate::strategy_plan_v2::PluginImplementationReceiptV2>,
        Vec<VerifiedPluginCargoBuildV2>,
    ),
    DevelopComposerTerminalV2,
> {
    if builds.len() != design.plugins.len() || requested.len() != design.plugins.len() {
        return Err(DevelopComposerTerminalV2::unsupported(
            "plugin_builds",
            "verified builds do not exactly cover declared plugins",
        ));
    }
    let mut by_receipt = builds
        .into_iter()
        .map(|build| (build.verified_build_receipt_digest(), build))
        .collect::<BTreeMap<_, _>>();

    if by_receipt.len() != design.plugins.len() {
        return Err(DevelopComposerTerminalV2::unsupported(
            "plugin_builds",
            "duplicate verified plugin build",
        ));
    }
    let requested_by_plugin = requested
        .iter()
        .map(|locator| {
            (
                locator.plugin_semantic_id.as_str(),
                locator.verified_build_receipt_digest,
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut receipts = Vec::with_capacity(design.plugins.len());
    let mut verified = Vec::with_capacity(design.plugins.len());
    for manifest in &design.plugins {
        let requested_receipt = requested_by_plugin
            .get(manifest.semantic_id.as_str())
            .ok_or_else(|| {
                DevelopComposerTerminalV2::unsupported(
                    "plugin_builds",
                    "declared plugin has no requested verified build",
                )
            })?;
        let build = by_receipt.remove(requested_receipt).ok_or_else(|| {
            DevelopComposerTerminalV2::unsupported(
                "plugin_builds",
                "declared plugin has no exact verified build",
            )
        })?;

        if build.plugin_semantic_id() != manifest.semantic_id {
            return Err(DevelopComposerTerminalV2::unsupported(
                "plugin_builds.plugin_semantic_id",
                "verified build is sealed to a different plugin semantic identity",
            ));
        }

        if build.manifest_digest() != plugin_manifest_digest(manifest) {
            return Err(DevelopComposerTerminalV2::unsupported(
                "plugin_builds.manifest_digest",
                "verified build is sealed to a different canonical plugin manifest",
            ));
        }
        validate_plugin_candidate_v2(build.wasm(), manifest).map_err(|e| {
            DevelopComposerTerminalV2::unsupported(
                "plugin_builds.module",
                &format!("verified module does not match the current manifest: {e}"),
            )
        })?;
        let build = build.into_verified_for_composer(manifest)?;
        let receipt = issue_plugin_implementation_receipt_v2(
            manifest,
            &design.capabilities,
            build.implementation_capsule_digest(),
            build.source_entry_digest(),
            build.module_digest(),
            build.verified_build_receipt_digest(),
        )
        .ok_or_else(|| {
            DevelopComposerTerminalV2::unsupported(
                "plugin_builds.capabilities",
                "plugin build references an undeclared capability",
            )
        })?;
        receipts.push(receipt);
        verified.push(build);
    }
    Ok((receipts, verified))
}

fn canonical_proposal_digest(proposal: &UntrustedDevelopComposerProposalV2) -> BindingDigest {
    let mut canonical = proposal.clone();
    canonical.input_binding_receipt_digests.sort();
    canonical.plugin_builds.sort();
    domain_digest(
        b"rd.develop.composer-proposal.v2\0",
        &serde_json::to_vec(&canonical).expect("Develop proposal serialization"),
    )
}

fn sorted_unique_digests(
    values: &[BindingDigest],
    coordinate: &str,
) -> Result<Vec<BindingDigest>, DevelopComposerTerminalV2> {
    let mut sorted = values.to_vec();
    sorted.sort();
    if sorted.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(DevelopComposerTerminalV2::unsupported(
            coordinate,
            "duplicate evidence locator",
        ));
    }
    Ok(sorted)
}

fn canonical_plugin_locators(
    values: &[UntrustedPluginBuildLocatorV2],
) -> Result<Vec<UntrustedPluginBuildLocatorV2>, DevelopComposerTerminalV2> {
    let mut sorted = values.to_vec();
    sorted.sort();
    let identities = sorted
        .iter()
        .map(|value| value.plugin_semantic_id.as_str())
        .collect::<BTreeSet<_>>();
    let receipts = sorted
        .iter()
        .map(|value| value.verified_build_receipt_digest)
        .collect::<BTreeSet<_>>();

    if identities.len() != sorted.len() || receipts.len() != sorted.len() {
        return Err(DevelopComposerTerminalV2::unsupported(
            "plugin_builds",
            "duplicate plugin build locator",
        ));
    }
    Ok(sorted)
}

fn receipt_digest(receipt: &DevelopComposerReceiptV2) -> BindingDigest {
    let body = DevelopComposerReceiptBodyV2 {
        schema_version: receipt.schema_version,
        research_custody_digest: receipt.research_custody_digest,
        proposal_digest: receipt.proposal_digest,
        design_identity: receipt.design_identity,
        design_digest: receipt.design_digest,
        canonical_plan_digest: receipt.canonical_plan_digest,
        artifact_identity: receipt.artifact_identity,
        binding_receipt_digests: &receipt.binding_receipt_digests,
        plugin_build_receipt_digests: &receipt.plugin_build_receipt_digests,
    };
    domain_digest(
        b"rd.develop.composer-receipt.v2\0",
        &serde_json::to_vec(&body).expect("Develop receipt body serialization"),
    )
}

fn parse_digest_suffix(value: &str, prefix: &str) -> Option<BindingDigest> {
    let hex = value.strip_prefix(prefix)?;
    if hex.len() != 64 {
        return None;
    }
    let mut bytes = [0_u8; 32];

    for (index, chunk) in hex.as_bytes().chunks_exact(2).enumerate() {
        let high = hex_nibble(chunk[0])?;
        let low = hex_nibble(chunk[1])?;
        bytes[index] = (high << 4) | low;
    }
    Some(BindingDigest::from_untrusted_bytes(bytes))
}

const fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn domain_digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

#[cfg(test)]
impl CurrentResearchDevelopCustodyV2 {
    pub(crate) fn fixture(request_locator: &str, falsifier: &str, custody_byte: u8) -> Self {
        let mut value = Self {
            request_locator: request_locator.to_owned(),
            research_request_identity: domain_digest(
                b"rd.develop.request-identity.v2\0",
                request_locator.as_bytes(),
            ),
            intent_identity: domain_digest(
                b"rd.develop.intent-identity.v2\0",
                format!("intent:{request_locator}").as_bytes(),
            ),
            intent_digest: domain_digest(
                b"rd.develop.intent-digest.v2\0",
                format!("digest:{request_locator}").as_bytes(),
            ),
            falsifier: falsifier.to_owned(),
            research_receipt_identity: format!("receipt:{request_locator}"),
            research_receipt_semantic_digest: format!("semantic:{request_locator}"),
            research_view_identity: format!("view:{request_locator}"),
            research_view_source_cut: "cut:1".to_owned(),
            trial_family_identity: format!("family:{request_locator}"),
            trial_family_root_digest: "family-root".to_owned(),
            trial_family_frontier_identity: "family-frontier".to_owned(),
            trial_family_frontier_digest: "family-frontier-digest".to_owned(),
            custody_digest: BindingDigest::from_untrusted_bytes([custody_byte; 32]),
        };
        value.custody_digest = domain_digest(
            b"rd.develop.current-research-custody.v2\0",
            &serde_json::to_vec(&value).expect("fixture custody serialization"),
        );
        value
    }
}
