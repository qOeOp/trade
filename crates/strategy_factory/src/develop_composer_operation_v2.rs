//! Durable R&D Composer operation core.
//!
//! The public request remains untrusted. Positive construction consumes the existing A0 verified
//! build in-process; durable readback validates only private receipt/module bytes and never
//! reconstructs that move-only token.

use std::{cell::RefCell, collections::BTreeMap, sync::Mutex};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use vibe_data::owner::{
    source_binding::BindingDigest, strategy_input_binding::UntrustedStrategyInputBindingRequest,
};

use crate::{
    artifact_v2::StrategyArtifactV2,
    develop_composer_v2::{
        CurrentResearchDevelopCustodyV2, DevelopComposerEvidencePortV2, DevelopComposerPositiveV2,
        DevelopComposerReceiptV2, DevelopComposerResultV2, DevelopComposerTerminalKindV2,
        DevelopComposerTerminalV2, DevelopComposerV2, UntrustedDevelopComposerProposalV2,
        UntrustedPluginBuildLocatorV2,
    },
    develop_plugin_build_v2::{
        DevelopPluginBuildProducerV2, DevelopPluginBuildReceiptV2, DevelopPluginBuildResultV2,
        UntrustedDevelopPluginCapsuleV2, VerifiedDevelopPluginBuildReadV2,
        VerifiedDevelopPluginBuildV2, validated_capsule_digest_v2,
    },
    program_host_v2::ProgramHostV2,
    strategy_design_v2::{PluginManifestV2, StrategyDesignV2},
    strategy_plan_v2::{
        StrategyDesignPreparationV2, StrategyPlanV2, VerifiedStrategyInputBindingsV2,
        durable_decode, durable_encode, prepare_strategy_design_v2,
    },
};

pub use crate::develop_plugin_build_v2::{
    UntrustedDevelopPluginCapsuleV2 as DevelopComposerPluginSourceCapsuleV2,
    UntrustedDevelopPluginSourceFileV2 as DevelopComposerPluginSourceFileV2,
};

const OPERATION_SCHEMA_V2: u16 = 2;
const MAX_REQUEST_IDENTITY_BYTES: usize = 256;
const MAX_PLUGIN_CAPSULES: usize = 64;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DevelopComposerRunRequestV2 {
    pub request_identity: String,
    pub research_custody_reference: String,
    pub design: StrategyDesignV2,
    pub binding_requests: Vec<UntrustedStrategyInputBindingRequest>,
    pub plugin_source_capsules: Vec<UntrustedDevelopPluginCapsuleV2>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DevelopComposerOperationDispositionV2 {
    Success,
    Conflict,
    Unsupported,
    NeedsResearchRefinement,
    Unavailable,
    SubmittedOrUnknown,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DevelopComposerArtifactProjectionV2 {
    pub artifact_locator: String,
    pub artifact_digest: BindingDigest,
    pub canonical_plan_digest: BindingDigest,
    pub design_digest: BindingDigest,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DevelopComposerOperationResponseV2 {
    pub schema_version: u16,
    pub request_identity: String,
    pub disposition: DevelopComposerOperationDispositionV2,
    pub receipt_identity: Option<BindingDigest>,
    pub artifact: Option<DevelopComposerArtifactProjectionV2>,
    pub coordinate: Option<String>,
    pub reason: Option<String>,
}

impl DevelopComposerOperationResponseV2 {
    pub fn canonical_bytes(&self) -> Vec<u8> {
        durable_encode(self)
    }

    fn terminal(request_identity: &str, terminal: DevelopComposerTerminalV2) -> Self {
        let disposition = match terminal.kind {
            DevelopComposerTerminalKindV2::Conflict => {
                DevelopComposerOperationDispositionV2::Conflict
            }
            DevelopComposerTerminalKindV2::Unsupported => {
                DevelopComposerOperationDispositionV2::Unsupported
            }
            DevelopComposerTerminalKindV2::NeedsResearchRefinement => {
                DevelopComposerOperationDispositionV2::NeedsResearchRefinement
            }
            DevelopComposerTerminalKindV2::Unavailable => {
                DevelopComposerOperationDispositionV2::Unavailable
            }
        };
        Self {
            schema_version: OPERATION_SCHEMA_V2,
            request_identity: request_identity.to_owned(),
            disposition,
            receipt_identity: None,
            artifact: None,
            coordinate: Some(terminal.coordinate),
            reason: Some(terminal.reason),
        }
    }

    pub(crate) fn submitted_or_unknown(request_identity: &str) -> Self {
        Self {
            schema_version: OPERATION_SCHEMA_V2,
            request_identity: request_identity.to_owned(),
            disposition: DevelopComposerOperationDispositionV2::SubmittedOrUnknown,
            receipt_identity: None,
            artifact: None,
            coordinate: Some("storage.commit".to_owned()),
            reason: Some("commit outcome is unknown; resolve the same request identity".to_owned()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DevelopComposerHostAdmissionReceiptV2 {
    schema_version: u16,
    receipt_identity: BindingDigest,
    receipt_digest: BindingDigest,
    canonical_plan_digest: BindingDigest,
    artifact_identity: BindingDigest,
}

#[derive(Serialize)]
struct HostReceiptBodyV2 {
    schema_version: u16,
    canonical_plan_digest: BindingDigest,
    artifact_identity: BindingDigest,
}

impl DevelopComposerHostAdmissionReceiptV2 {
    fn issue(plan: &StrategyPlanV2, artifact: &StrategyArtifactV2) -> Self {
        let mut receipt = Self {
            schema_version: OPERATION_SCHEMA_V2,
            receipt_identity: zero(),
            receipt_digest: zero(),
            canonical_plan_digest: plan.canonical_plan_digest(),
            artifact_identity: artifact.identity(),
        };
        receipt.receipt_digest = host_receipt_digest(&receipt);
        receipt.receipt_identity = domain_digest(
            b"rd.develop.host-admission-receipt.identity.v2\0",
            receipt.receipt_digest.as_bytes(),
        );
        receipt
    }

    fn validates(&self, plan: &StrategyPlanV2, artifact: &StrategyArtifactV2) -> bool {
        self.schema_version == OPERATION_SCHEMA_V2
            && self.canonical_plan_digest == plan.canonical_plan_digest()
            && self.artifact_identity == artifact.identity()
            && self.receipt_digest == host_receipt_digest(self)
            && self.receipt_identity
                == domain_digest(
                    b"rd.develop.host-admission-receipt.identity.v2\0",
                    self.receipt_digest.as_bytes(),
                )
    }

    fn canonical_bytes(&self) -> Vec<u8> {
        durable_encode(self)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DevelopComposerOperationReceiptV2 {
    schema_version: u16,
    receipt_identity: BindingDigest,
    receipt_digest: BindingDigest,
    request_identity: String,
    request_digest: BindingDigest,
    research_custody_digest: BindingDigest,
    research_request_identity: BindingDigest,
    intent_identity: BindingDigest,
    design_digest: BindingDigest,
    canonical_plan_digest: BindingDigest,
    artifact_identity: BindingDigest,
    design_bytes_digest: BindingDigest,
    plan_bytes_digest: BindingDigest,
    artifact_package_bytes_digest: BindingDigest,
    private_module_set_digest: BindingDigest,
    build_receipt_set_digest: BindingDigest,
    composer_receipt_bytes_digest: BindingDigest,
    host_receipt_bytes_digest: BindingDigest,
    composer_receipt_identity: BindingDigest,
    host_receipt_identity: BindingDigest,
    response_digest: BindingDigest,
}

#[derive(Serialize)]
struct OperationReceiptBodyV2<'a> {
    schema_version: u16,
    request_identity: &'a str,
    request_digest: BindingDigest,
    research_custody_digest: BindingDigest,
    research_request_identity: BindingDigest,
    intent_identity: BindingDigest,
    design_digest: BindingDigest,
    canonical_plan_digest: BindingDigest,
    artifact_identity: BindingDigest,
    design_bytes_digest: BindingDigest,
    plan_bytes_digest: BindingDigest,
    artifact_package_bytes_digest: BindingDigest,
    private_module_set_digest: BindingDigest,
    build_receipt_set_digest: BindingDigest,
    composer_receipt_bytes_digest: BindingDigest,
    host_receipt_bytes_digest: BindingDigest,
    composer_receipt_identity: BindingDigest,
    host_receipt_identity: BindingDigest,
    response_digest: BindingDigest,
}

impl DevelopComposerOperationReceiptV2 {
    fn canonical_bytes(&self) -> Vec<u8> {
        durable_encode(self)
    }

    fn validates(&self) -> bool {
        self.schema_version == OPERATION_SCHEMA_V2
            && self.receipt_digest == operation_receipt_digest(self)
            && self.receipt_identity
                == domain_digest(
                    b"rd.develop.composer-operation-receipt.identity.v2\0",
                    self.receipt_digest.as_bytes(),
                )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DevelopComposerOutboxV2 {
    schema_version: u16,
    event_identity: BindingDigest,
    request_identity: String,
    operation_receipt_identity: BindingDigest,
    artifact_identity: BindingDigest,
    payload_digest: BindingDigest,
}

impl DevelopComposerOutboxV2 {
    fn canonical_bytes(&self) -> Vec<u8> {
        durable_encode(self)
    }

    fn validates(&self) -> bool {
        let payload = durable_encode(&(
            self.schema_version,
            self.request_identity.as_str(),
            self.operation_receipt_identity,
            self.artifact_identity,
        ));
        self.schema_version == OPERATION_SCHEMA_V2
            && self.payload_digest
                == domain_digest(b"rd.develop.composer-outbox.payload.v2\0", &payload)
            && self.event_identity
                == domain_digest(
                    b"rd.develop.composer-outbox.identity.v2\0",
                    self.payload_digest.as_bytes(),
                )
    }
}

#[derive(Clone)]
pub(crate) struct StoredDevelopComposerPositiveV2 {
    pub(crate) request_identity: String,
    pub(crate) request_digest: BindingDigest,
    pub(crate) research_request_identity: BindingDigest,
    pub(crate) intent_identity: BindingDigest,
    pub(crate) design_identity: BindingDigest,
    pub(crate) plan_digest: BindingDigest,
    pub(crate) artifact_identity: BindingDigest,
    pub(crate) build_attempt_identities: Vec<BindingDigest>,
    pub(crate) capsule_identities: Vec<BindingDigest>,
    pub(crate) build_receipt_identities: Vec<BindingDigest>,
    pub(crate) design_bytes: Vec<u8>,
    pub(crate) plan_bytes: Vec<u8>,
    pub(crate) artifact_package_bytes: Vec<u8>,
    pub(crate) module_bytes: Vec<Box<[u8]>>,
    pub(crate) build_receipt_bytes: Vec<Vec<u8>>,
    pub(crate) composer_receipt_bytes: Vec<u8>,
    pub(crate) host_receipt_bytes: Vec<u8>,
    pub(crate) operation_receipt_bytes: Vec<u8>,
    pub(crate) outbox_bytes: Vec<u8>,
    pub(crate) response_bytes: Vec<u8>,
}

pub(crate) trait DevelopComposerA0BuildPortV2 {
    fn build(
        &mut self,
        manifest: &PluginManifestV2,
        capsule: &UntrustedDevelopPluginCapsuleV2,
    ) -> Result<VerifiedDevelopPluginBuildReadV2, DevelopComposerTerminalV2>;
}

impl DevelopComposerA0BuildPortV2 for DevelopPluginBuildProducerV2 {
    fn build(
        &mut self,
        manifest: &PluginManifestV2,
        capsule: &UntrustedDevelopPluginCapsuleV2,
    ) -> Result<VerifiedDevelopPluginBuildReadV2, DevelopComposerTerminalV2> {
        match self.build(manifest, capsule) {
            DevelopPluginBuildResultV2::Verified(build) => Ok(*build),
            DevelopPluginBuildResultV2::Terminal(terminal) => {
                let kind = if matches!(
                    terminal.kind,
                    crate::develop_plugin_build_v2::DevelopPluginBuildTerminalKindV2::Conflict
                ) {
                    DevelopComposerTerminalKindV2::Conflict
                } else {
                    DevelopComposerTerminalKindV2::Unavailable
                };
                Err(DevelopComposerTerminalV2 {
                    kind,
                    coordinate: terminal.coordinate,
                    reason: terminal.reason,
                })
            }
        }
    }
}

/// Final evidence is deliberately an Owner-read seam. The acceptance adapter below is fixed at
/// compile time and is not a production Research or binding authority.
pub(crate) trait DevelopComposerFinalEvidencePortV2 {
    fn lock_and_reread(
        &self,
        request: &DevelopComposerRunRequestV2,
        design_identity: BindingDigest,
        read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2>;

    fn lock_and_reread_durable(
        &self,
        locator: &DevelopComposerDurableEvidenceLocatorV2,
        read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DevelopComposerLockedEvidenceV2 {
    pub(crate) research: CurrentResearchDevelopCustodyV2,
    pub(crate) bindings: VerifiedStrategyInputBindingsV2,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DevelopComposerDurableEvidenceLocatorV2 {
    pub(crate) request_identity: String,
    pub(crate) request_digest: BindingDigest,
    pub(crate) research_request_identity: BindingDigest,
    pub(crate) intent_identity: BindingDigest,
    pub(crate) design_identity: BindingDigest,
}

impl DevelopComposerDurableEvidenceLocatorV2 {
    pub(crate) fn from_record(record: &StoredDevelopComposerPositiveV2) -> Self {
        Self {
            request_identity: record.request_identity.clone(),
            request_digest: record.request_digest,
            research_request_identity: record.research_request_identity,
            intent_identity: record.intent_identity,
            design_identity: record.design_identity,
        }
    }
}

/// Compile-time selected acceptance evidence. It has no public constructor, runtime selector,
/// locator lookup, database token representation, or production fallback.
#[cfg(feature = "sealed-develop-composer-acceptance")]
pub(crate) struct SealedDevelopComposerAcceptanceEvidenceV2 {
    expected_request_identity: &'static str,
    expected_request_digest: BindingDigest,
    expected_design_identity: BindingDigest,
    research: CurrentResearchDevelopCustodyV2,
    bindings: VerifiedStrategyInputBindingsV2,
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
impl SealedDevelopComposerAcceptanceEvidenceV2 {
    pub(crate) fn from_fixed_corpus(
        request: &'static DevelopComposerRunRequestV2,
        research: CurrentResearchDevelopCustodyV2,
        bindings: VerifiedStrategyInputBindingsV2,
    ) -> Result<Self, DevelopComposerTerminalV2> {
        let expected_design_identity = match prepare_strategy_design_v2(&request.design) {
            StrategyDesignPreparationV2::Prepared {
                design_identity, ..
            } => design_identity,
            _ => {
                return Err(unavailable(
                    "sealed_acceptance.design",
                    "fixed acceptance Design does not prepare",
                ));
            }
        };
        Ok(Self {
            expected_request_identity: request.request_identity.as_str(),
            expected_request_digest: request_digest(request),
            expected_design_identity,
            research,
            bindings,
        })
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
impl DevelopComposerFinalEvidencePortV2 for SealedDevelopComposerAcceptanceEvidenceV2 {
    fn lock_and_reread(
        &self,
        request: &DevelopComposerRunRequestV2,
        design_identity: BindingDigest,
        _read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2> {
        if request_digest(request) != self.expected_request_digest
            || design_identity != self.expected_design_identity
            || request.research_custody_reference != self.research.request_locator()
        {
            return Err(unavailable(
                "sealed_acceptance.evidence",
                "request is not the compile-time fixed acceptance corpus",
            ));
        }
        Ok(DevelopComposerLockedEvidenceV2 {
            research: self.research.clone(),
            bindings: self.bindings.clone(),
        })
    }

    fn lock_and_reread_durable(
        &self,
        locator: &DevelopComposerDurableEvidenceLocatorV2,
        _read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2> {
        if locator.request_identity != self.expected_request_identity
            || locator.request_digest != self.expected_request_digest
            || locator.design_identity != self.expected_design_identity
            || locator.research_request_identity != self.research.research_request_identity()
            || locator.intent_identity != self.research.intent_identity()
        {
            return Err(unavailable(
                "sealed_acceptance.durable_evidence",
                "stored locator does not match current fixed acceptance evidence",
            ));
        }
        Ok(DevelopComposerLockedEvidenceV2 {
            research: self.research.clone(),
            bindings: self.bindings.clone(),
        })
    }
}

struct ComposerEvidenceV2 {
    locked: DevelopComposerLockedEvidenceV2,
    builds: RefCell<Vec<VerifiedDevelopPluginBuildV2>>,
}

impl DevelopComposerEvidencePortV2 for ComposerEvidenceV2 {
    fn read_current_research(
        &self,
        request_locator: &str,
        _read_cut_epoch_ms: u64,
    ) -> Result<CurrentResearchDevelopCustodyV2, DevelopComposerTerminalV2> {
        if request_locator != self.locked.research.request_locator() {
            return Err(unavailable(
                "research_custody",
                "locked Research locator mismatch",
            ));
        }
        Ok(self.locked.research.clone())
    }

    fn read_input_bindings(
        &self,
        _design_identity: BindingDigest,
        _receipt_digests: &[BindingDigest],
    ) -> Result<VerifiedStrategyInputBindingsV2, DevelopComposerTerminalV2> {
        Ok(self.locked.bindings.clone())
    }

    fn read_plugin_builds(
        &self,
        _manifests: &[PluginManifestV2],
        _locators: &[UntrustedPluginBuildLocatorV2],
    ) -> Result<Vec<VerifiedDevelopPluginBuildV2>, DevelopComposerTerminalV2> {
        Ok(std::mem::take(&mut *self.builds.borrow_mut()))
    }
}

pub(crate) struct DevelopComposerPreflightV2 {
    pub(crate) request_digest: BindingDigest,
    pub(crate) design_identity: BindingDigest,
    pub(crate) research_request_identity: BindingDigest,
    pub(crate) intent_identity: BindingDigest,
    pub(crate) build_attempt_identities: Vec<BindingDigest>,
    pub(crate) capsule_identities: Vec<BindingDigest>,
    locked: DevelopComposerLockedEvidenceV2,
}

pub(crate) fn preflight_develop_composer_v2(
    evidence: &impl DevelopComposerFinalEvidencePortV2,
    request: &DevelopComposerRunRequestV2,
    read_cut_epoch_ms: u64,
) -> Result<DevelopComposerPreflightV2, DevelopComposerTerminalV2> {
    validate_request(request)?;
    let preparation = prepare_strategy_design_v2(&request.design);
    let design_identity = match preparation {
        StrategyDesignPreparationV2::Prepared {
            design_identity, ..
        } => design_identity,
        StrategyDesignPreparationV2::Unsupported(issue) => {
            return Err(DevelopComposerTerminalV2 {
                kind: DevelopComposerTerminalKindV2::Unsupported,
                coordinate: issue.coordinate,
                reason: issue.reason,
            });
        }
        StrategyDesignPreparationV2::NeedsResearchRefinement(issue) => {
            return Err(DevelopComposerTerminalV2 {
                kind: DevelopComposerTerminalKindV2::NeedsResearchRefinement,
                coordinate: issue.coordinate,
                reason: issue.reason,
            });
        }
    };

    if request.binding_requests.len() != request.design.inputs.len()
        || request.binding_requests.iter().any(|binding| {
            binding.research_request_identity != request.design.research_request_identity
                || binding.strategy_design_identity != design_identity
                || !request.design.inputs.iter().any(|input| {
                    crate::strategy_plan_v2::strategy_input_role_identity_v2(input)
                        == binding.input_role_identity
                })
        })
    {
        return Err(unavailable(
            "binding_requests",
            "binding requests do not exactly cover this Research request and canonical Design",
        ));
    }

    let mut manifests = request.design.plugins.iter().collect::<Vec<_>>();
    manifests.sort_by(|left, right| left.semantic_id.cmp(&right.semantic_id));
    let capsule_identities = manifests
        .iter()
        .zip(&request.plugin_source_capsules)
        .map(|(manifest, capsule)| {
            validated_capsule_digest_v2(manifest, capsule).map_err(map_build_terminal)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let build_attempt_identities = manifests
        .iter()
        .zip(&capsule_identities)
        .map(|(manifest, capsule_identity)| {
            build_attempt_identity_v2(&manifest.semantic_id, *capsule_identity)
        })
        .collect();
    let locked = evidence.lock_and_reread(request, design_identity, read_cut_epoch_ms)?;
    if request.design.research_request_identity != locked.research.research_request_identity()
        || request.design.intent_identity != locked.research.intent_identity()
        || request.design.intent_digest != locked.research.intent_digest()
        || request.design.falsifier != locked.research.falsifier()
    {
        return Err(DevelopComposerTerminalV2 {
            kind: DevelopComposerTerminalKindV2::Conflict,
            coordinate: "design.research_custody".to_owned(),
            reason: "preflight Research custody does not bind the untrusted Design".to_owned(),
        });
    }
    let request_digest = request_digest(request);
    Ok(DevelopComposerPreflightV2 {
        request_digest,
        design_identity,
        research_request_identity: locked.research.research_request_identity(),
        intent_identity: locked.research.intent_identity(),
        build_attempt_identities,
        capsule_identities,
        locked,
    })
}

pub(crate) fn build_positive_record_from_preflight_v2(
    builder: &mut impl DevelopComposerA0BuildPortV2,
    evidence: &impl DevelopComposerFinalEvidencePortV2,
    request: &DevelopComposerRunRequestV2,
    read_cut_epoch_ms: u64,
    preflight: DevelopComposerPreflightV2,
) -> Result<
    (
        StoredDevelopComposerPositiveV2,
        DevelopComposerLockedEvidenceV2,
    ),
    DevelopComposerTerminalV2,
> {
    let mut manifests = request.design.plugins.iter().collect::<Vec<_>>();
    manifests.sort_by(|left, right| left.semantic_id.cmp(&right.semantic_id));
    let mut build_reads = Vec::with_capacity(manifests.len());
    let mut build_receipt_bytes = Vec::with_capacity(manifests.len());
    for (manifest, capsule) in manifests.iter().zip(&request.plugin_source_capsules) {
        let build = builder.build(manifest, capsule)?;
        build_receipt_bytes.push(build.canonical_receipt_bytes());
        build_reads.push(build);
    }

    // This is the final accepted Research/binding cut. Production must replace the sealed adapter
    // with durable Owner ports without changing the Composer or storage authorities.
    let locked = evidence.lock_and_reread(request, preflight.design_identity, read_cut_epoch_ms)?;
    if locked != preflight.locked {
        return Err(unavailable(
            "final_evidence",
            "final Research custody or binding evidence drifted after A0",
        ));
    }
    let binding_receipt_digests = locked.bindings.receipt_digests();
    let plugin_builds = build_reads
        .iter()
        .zip(manifests.iter())
        .map(|(build, manifest)| UntrustedPluginBuildLocatorV2 {
            plugin_semantic_id: manifest.semantic_id.clone(),
            verified_build_receipt_digest: build.receipt().receipt_digest(),
        })
        .collect::<Vec<_>>();
    let verified_builds = build_reads
        .into_iter()
        .map(VerifiedDevelopPluginBuildReadV2::into_composer_build)
        .collect();
    let composer_evidence = ComposerEvidenceV2 {
        locked: locked.clone(),
        builds: RefCell::new(verified_builds),
    };
    let proposal = UntrustedDevelopComposerProposalV2 {
        research_request_locator: request.research_custody_reference.clone(),
        design: request.design.clone(),
        input_binding_receipt_digests: binding_receipt_digests,
        plugin_builds,
    };
    let positive = match DevelopComposerV2::default().compose(
        &proposal,
        read_cut_epoch_ms,
        &composer_evidence,
    ) {
        DevelopComposerResultV2::Composed(positive) => *positive,
        DevelopComposerResultV2::Terminal(terminal) => return Err(terminal),
    };
    let record = finish_positive(
        request,
        preflight.request_digest,
        &composer_evidence.locked.research,
        &positive,
        preflight.build_attempt_identities,
        preflight.capsule_identities,
        build_receipt_bytes,
    )?;
    Ok((record, locked))
}

fn finish_positive(
    request: &DevelopComposerRunRequestV2,
    request_digest: BindingDigest,
    research: &CurrentResearchDevelopCustodyV2,
    positive: &DevelopComposerPositiveV2,
    build_attempt_identities: Vec<BindingDigest>,
    capsule_identities: Vec<BindingDigest>,
    build_receipt_bytes: Vec<Vec<u8>>,
) -> Result<StoredDevelopComposerPositiveV2, DevelopComposerTerminalV2> {
    ProgramHostV2::new(positive.plan().clone(), positive.artifact().clone()).map_err(|e| {
        unavailable(
            "program_host",
            &format!("ProgramHostV2 rejected Artifact: {e}"),
        )
    })?;
    let host_receipt =
        DevelopComposerHostAdmissionReceiptV2::issue(positive.plan(), positive.artifact());
    let design_bytes = positive.plan().canonical_design_durable_bytes();
    let plan_bytes = positive.plan().durable_bytes();
    let artifact_package_bytes = positive.artifact().durable_package_bytes();
    let module_bytes = positive.artifact().private_module_bytes();
    let composer_receipt_bytes = positive.receipt().canonical_bytes();
    let host_receipt_bytes = host_receipt.canonical_bytes();
    let artifact_projection = DevelopComposerArtifactProjectionV2 {
        artifact_locator: format!(
            "rd-strategy-artifact-v2-{}",
            hex(positive.artifact().identity())
        ),
        artifact_digest: positive.artifact().identity(),
        canonical_plan_digest: positive.plan().canonical_plan_digest(),
        design_digest: positive.receipt().design_digest(),
    };
    let mut response = DevelopComposerOperationResponseV2 {
        schema_version: OPERATION_SCHEMA_V2,
        request_identity: request.request_identity.clone(),
        disposition: DevelopComposerOperationDispositionV2::Success,
        receipt_identity: None,
        artifact: Some(artifact_projection),
        coordinate: None,
        reason: None,
    };
    let mut operation_receipt = DevelopComposerOperationReceiptV2 {
        schema_version: OPERATION_SCHEMA_V2,
        receipt_identity: zero(),
        receipt_digest: zero(),
        request_identity: request.request_identity.clone(),
        request_digest,
        research_custody_digest: research.custody_digest(),
        research_request_identity: research.research_request_identity(),
        intent_identity: research.intent_identity(),
        design_digest: positive.receipt().design_digest(),
        canonical_plan_digest: positive.plan().canonical_plan_digest(),
        artifact_identity: positive.artifact().identity(),
        design_bytes_digest: private_bytes_digest(
            b"rd.develop.design.canonical-bytes.v2\0",
            &design_bytes,
        ),
        plan_bytes_digest: private_bytes_digest(
            b"rd.develop.plan.canonical-bytes.v2\0",
            &plan_bytes,
        ),
        artifact_package_bytes_digest: private_bytes_digest(
            b"rd.develop.artifact-package.canonical-bytes.v2\0",
            &artifact_package_bytes,
        ),
        private_module_set_digest: ordered_private_bytes_digest(
            b"rd.develop.private-module-set.v2\0",
            module_bytes.iter().map(|bytes| bytes.as_ref()),
        ),
        build_receipt_set_digest: ordered_private_bytes_digest(
            b"rd.develop.build-receipt-set.v2\0",
            build_receipt_bytes.iter().map(Vec::as_slice),
        ),
        composer_receipt_bytes_digest: private_bytes_digest(
            b"rd.develop.composer-receipt.canonical-bytes.v2\0",
            &composer_receipt_bytes,
        ),
        host_receipt_bytes_digest: private_bytes_digest(
            b"rd.develop.host-receipt.canonical-bytes.v2\0",
            &host_receipt_bytes,
        ),
        composer_receipt_identity: positive.receipt().receipt_identity(),
        host_receipt_identity: host_receipt.receipt_identity,
        response_digest: public_response_digest_without_receipt(&response),
    };
    operation_receipt.receipt_digest = operation_receipt_digest(&operation_receipt);
    operation_receipt.receipt_identity = domain_digest(
        b"rd.develop.composer-operation-receipt.identity.v2\0",
        operation_receipt.receipt_digest.as_bytes(),
    );
    response.receipt_identity = Some(operation_receipt.receipt_identity);

    let payload = durable_encode(&(
        OPERATION_SCHEMA_V2,
        request.request_identity.as_str(),
        operation_receipt.receipt_identity,
        positive.artifact().identity(),
    ));
    let payload_digest = domain_digest(b"rd.develop.composer-outbox.payload.v2\0", &payload);
    let outbox = DevelopComposerOutboxV2 {
        schema_version: OPERATION_SCHEMA_V2,
        event_identity: domain_digest(
            b"rd.develop.composer-outbox.identity.v2\0",
            payload_digest.as_bytes(),
        ),
        request_identity: request.request_identity.clone(),
        operation_receipt_identity: operation_receipt.receipt_identity,
        artifact_identity: positive.artifact().identity(),
        payload_digest,
    };
    let build_receipt_identities = build_receipt_bytes
        .iter()
        .map(|bytes| {
            DevelopPluginBuildReceiptV2::parse_canonical(bytes)
                .expect("fresh A0 receipt validates")
                .receipt_digest()
        })
        .collect();
    let record = StoredDevelopComposerPositiveV2 {
        request_identity: request.request_identity.clone(),
        request_digest,
        research_request_identity: research.research_request_identity(),
        intent_identity: research.intent_identity(),
        design_identity: positive.plan().design_identity(),
        plan_digest: positive.plan().canonical_plan_digest(),
        artifact_identity: positive.artifact().identity(),
        build_attempt_identities,
        capsule_identities,
        build_receipt_identities,
        design_bytes,
        plan_bytes,
        artifact_package_bytes,
        module_bytes,
        build_receipt_bytes,
        composer_receipt_bytes,
        host_receipt_bytes,
        operation_receipt_bytes: operation_receipt.canonical_bytes(),
        outbox_bytes: outbox.canonical_bytes(),
        response_bytes: response.canonical_bytes(),
    };
    Ok(record)
}

pub(crate) fn resolve_positive_record_v2(
    record: &StoredDevelopComposerPositiveV2,
    current: DevelopComposerLockedEvidenceV2,
) -> Result<DevelopComposerOperationResponseV2, DevelopComposerTerminalV2> {
    if current.research.research_request_identity() != record.research_request_identity
        || current.research.intent_identity() != record.intent_identity
    {
        return Err(unavailable(
            "current_evidence",
            "current Research custody does not match the stored positive",
        ));
    }
    let plan = StrategyPlanV2::parse_and_revalidate_durable(&record.plan_bytes, current.bindings)
        .map_err(|e| unavailable("plan", &e))?;
    if plan.design_identity() != record.design_identity
        || plan.canonical_plan_digest() != record.plan_digest
        || plan.research_request_identity() != record.research_request_identity
        || plan.intent_identity() != record.intent_identity
    {
        return Err(unavailable(
            "plan.storage_key",
            "stored Design or Plan key digest mismatch",
        ));
    }

    if plan.canonical_design_durable_bytes() != record.design_bytes {
        return Err(unavailable("design", "canonical Design bytes mismatch"));
    }
    let artifact = StrategyArtifactV2::parse_and_revalidate_durable(
        &record.artifact_package_bytes,
        record.module_bytes.clone(),
        &plan,
    )
    .map_err(|e| unavailable("artifact", &e.to_string()))?;
    if artifact.identity() != record.artifact_identity {
        return Err(unavailable(
            "artifact.identity",
            "stored Artifact identity mismatch",
        ));
    }

    if record.build_receipt_bytes.len() != artifact.modules().len()
        || record.build_attempt_identities.len() != artifact.modules().len()
        || record.capsule_identities.len() != artifact.modules().len()
    {
        return Err(unavailable(
            "build_receipts",
            "Build Receipt coverage mismatch",
        ));
    }

    for (ordinal, (((bytes, expected_identity), module), manifest)) in record
        .build_receipt_bytes
        .iter()
        .zip(&record.build_receipt_identities)
        .zip(artifact.modules())
        .zip(plan.canonical_plugin_manifests())
        .enumerate()
    {
        let receipt = DevelopPluginBuildReceiptV2::parse_canonical(bytes)
            .ok_or_else(|| unavailable("build_receipt", "canonical Build Receipt is invalid"))?;

        if !receipt.validates_for_restart(manifest, *expected_identity, module.module_digest())
            || receipt.receipt_digest() != module.verified_build_receipt_digest()
            || receipt.implementation_capsule_digest() != record.capsule_identities[ordinal]
            || build_attempt_identity_v2(&manifest.semantic_id, record.capsule_identities[ordinal])
                != record.build_attempt_identities[ordinal]
        {
            return Err(unavailable(
                "build_receipt.binding",
                "Build Receipt binding mismatch",
            ));
        }
    }
    let composer = DevelopComposerReceiptV2::parse_canonical(&record.composer_receipt_bytes)
        .ok_or_else(|| unavailable("composer_receipt", "canonical Composer receipt is invalid"))?;

    if composer.canonical_plan_digest() != plan.canonical_plan_digest()
        || composer.artifact_identity() != artifact.identity()
    {
        return Err(unavailable(
            "composer_receipt.binding",
            "Composer receipt binding mismatch",
        ));
    }
    let host: DevelopComposerHostAdmissionReceiptV2 =
        strict_decode(&record.host_receipt_bytes, "host_receipt")?;
    if !host.validates(&plan, &artifact) {
        return Err(unavailable("host_receipt", "host receipt is invalid"));
    }
    let operation: DevelopComposerOperationReceiptV2 =
        strict_decode(&record.operation_receipt_bytes, "operation_receipt")?;
    if !operation.validates()
        || operation.request_identity != record.request_identity
        || operation.request_digest != record.request_digest
        || operation.research_custody_digest != current.research.custody_digest()
        || operation.research_request_identity != record.research_request_identity
        || operation.intent_identity != record.intent_identity
        || operation.research_request_identity != plan.research_request_identity()
        || operation.intent_identity != plan.intent_identity()
        || operation.design_digest != composer.design_digest()
        || operation.canonical_plan_digest != plan.canonical_plan_digest()
        || operation.artifact_identity != artifact.identity()
        || operation.design_bytes_digest
            != private_bytes_digest(
                b"rd.develop.design.canonical-bytes.v2\0",
                &record.design_bytes,
            )
        || operation.plan_bytes_digest
            != private_bytes_digest(b"rd.develop.plan.canonical-bytes.v2\0", &record.plan_bytes)
        || operation.artifact_package_bytes_digest
            != private_bytes_digest(
                b"rd.develop.artifact-package.canonical-bytes.v2\0",
                &record.artifact_package_bytes,
            )
        || operation.private_module_set_digest
            != ordered_private_bytes_digest(
                b"rd.develop.private-module-set.v2\0",
                record.module_bytes.iter().map(|bytes| bytes.as_ref()),
            )
        || operation.build_receipt_set_digest
            != ordered_private_bytes_digest(
                b"rd.develop.build-receipt-set.v2\0",
                record.build_receipt_bytes.iter().map(Vec::as_slice),
            )
        || operation.composer_receipt_bytes_digest
            != private_bytes_digest(
                b"rd.develop.composer-receipt.canonical-bytes.v2\0",
                &record.composer_receipt_bytes,
            )
        || operation.host_receipt_bytes_digest
            != private_bytes_digest(
                b"rd.develop.host-receipt.canonical-bytes.v2\0",
                &record.host_receipt_bytes,
            )
        || operation.composer_receipt_identity != composer.receipt_identity()
        || operation.host_receipt_identity != host.receipt_identity
    {
        return Err(unavailable(
            "operation_receipt",
            "operation receipt binding mismatch",
        ));
    }
    let outbox: DevelopComposerOutboxV2 = strict_decode(&record.outbox_bytes, "outbox")?;
    if !outbox.validates()
        || outbox.operation_receipt_identity != operation.receipt_identity
        || outbox.artifact_identity != artifact.identity()
    {
        return Err(unavailable("outbox", "outbox binding mismatch"));
    }
    let response: DevelopComposerOperationResponseV2 =
        strict_decode(&record.response_bytes, "response")?;
    if response.receipt_identity != Some(operation.receipt_identity)
        || public_response_digest_without_receipt(&response) != operation.response_digest
        || response
            .artifact
            .as_ref()
            .map(|value| value.artifact_digest)
            != Some(artifact.identity())
    {
        return Err(unavailable("response", "public response binding mismatch"));
    }
    ProgramHostV2::new(plan, artifact)
        .map_err(|e| unavailable("program_host", &format!("host readmission failed: {e}")))?;
    Ok(response)
}

pub(crate) struct LocalDevelopComposerOperationV2<B, E> {
    state: Mutex<LocalStateV2<B, E>>,
}

struct LocalStateV2<B, E> {
    builder: B,
    evidence: E,
    records: BTreeMap<String, StoredDevelopComposerPositiveV2>,
    research_meanings: BTreeMap<BindingDigest, BindingDigest>,
    intent_meanings: BTreeMap<BindingDigest, BindingDigest>,
    design_meanings: BTreeMap<BindingDigest, BindingDigest>,
    build_attempt_meanings: BTreeMap<BindingDigest, BindingDigest>,
    capsule_meanings: BTreeMap<BindingDigest, BindingDigest>,
    build_meanings: BTreeMap<BindingDigest, BindingDigest>,
    artifact_meanings: BTreeMap<BindingDigest, BindingDigest>,
    #[cfg(test)]
    fault_boundary: Option<usize>,
}

impl<B, E> LocalDevelopComposerOperationV2<B, E>
where
    B: DevelopComposerA0BuildPortV2,
    E: DevelopComposerFinalEvidencePortV2,
{
    pub(crate) fn new(builder: B, evidence: E) -> Self {
        Self {
            state: Mutex::new(LocalStateV2 {
                builder,
                evidence,
                records: BTreeMap::new(),
                research_meanings: BTreeMap::new(),
                intent_meanings: BTreeMap::new(),
                design_meanings: BTreeMap::new(),
                build_attempt_meanings: BTreeMap::new(),
                capsule_meanings: BTreeMap::new(),
                build_meanings: BTreeMap::new(),
                artifact_meanings: BTreeMap::new(),
                #[cfg(test)]
                fault_boundary: None,
            }),
        }
    }

    pub(crate) fn run(
        &self,
        request: &DevelopComposerRunRequestV2,
        read_cut_epoch_ms: u64,
    ) -> DevelopComposerOperationResponseV2 {
        let mut state = self
            .state
            .lock()
            .expect("Composer operation mutex poisoned");
        let digest = request_digest(request);
        if let Some(existing) = state.records.get(&request.request_identity) {
            return if existing.request_digest == digest {
                state
                    .evidence
                    .lock_and_reread(request, existing.design_identity, read_cut_epoch_ms)
                    .and_then(|current| resolve_positive_record_v2(existing, current))
                    .unwrap_or_else(|terminal| {
                        DevelopComposerOperationResponseV2::terminal(
                            &request.request_identity,
                            terminal,
                        )
                    })
            } else {
                conflict_response(&request.request_identity, "request_identity")
            };
        }
        let preflight =
            match preflight_develop_composer_v2(&state.evidence, request, read_cut_epoch_ms) {
                Ok(preflight) => preflight,
                Err(terminal) => {
                    return DevelopComposerOperationResponseV2::terminal(
                        &request.request_identity,
                        terminal,
                    );
                }
            };

        for (identity, index, coordinate) in [
            (
                preflight.research_request_identity,
                &state.research_meanings,
                "research_request_identity",
            ),
            (
                preflight.intent_identity,
                &state.intent_meanings,
                "intent_identity",
            ),
            (
                preflight.design_identity,
                &state.design_meanings,
                "design_identity",
            ),
        ] {
            if index
                .get(&identity)
                .is_some_and(|meaning| *meaning != digest)
            {
                return conflict_response(&request.request_identity, coordinate);
            }
        }

        if preflight.build_attempt_identities.iter().any(|identity| {
            state
                .build_attempt_meanings
                .get(identity)
                .is_some_and(|meaning| *meaning != digest)
        }) || preflight.capsule_identities.iter().any(|identity| {
            state
                .capsule_meanings
                .get(identity)
                .is_some_and(|meaning| *meaning != digest)
        }) {
            return conflict_response(&request.request_identity, "build_attempt_identity");
        }
        let LocalStateV2 {
            builder, evidence, ..
        } = &mut *state;
        let (record, current) = match build_positive_record_from_preflight_v2(
            builder,
            evidence,
            request,
            read_cut_epoch_ms,
            preflight,
        ) {
            Ok(record) => record,
            Err(terminal) => {
                return DevelopComposerOperationResponseV2::terminal(
                    &request.request_identity,
                    terminal,
                );
            }
        };

        for (identity, index, coordinate) in [
            (
                record.research_request_identity,
                &state.research_meanings,
                "research_request_identity",
            ),
            (
                record.intent_identity,
                &state.intent_meanings,
                "intent_identity",
            ),
            (
                record.artifact_identity,
                &state.artifact_meanings,
                "artifact_identity",
            ),
        ] {
            if index
                .get(&identity)
                .is_some_and(|meaning| *meaning != digest)
            {
                return conflict_response(&request.request_identity, coordinate);
            }
        }

        if record.build_receipt_identities.iter().any(|identity| {
            state
                .build_meanings
                .get(identity)
                .is_some_and(|meaning| *meaning != digest)
        }) {
            return conflict_response(&request.request_identity, "build_attempt_identity");
        }
        #[cfg(test)]
        for boundary in 1..=positive_write_boundary_count(&record) {
            if state.fault_boundary == Some(boundary) {
                return unavailable_response(
                    &request.request_identity,
                    "storage.write_boundary",
                    "injected transaction failure",
                );
            }
        }
        state
            .research_meanings
            .insert(record.research_request_identity, digest);
        state.intent_meanings.insert(record.intent_identity, digest);
        state.design_meanings.insert(record.design_identity, digest);
        for identity in &record.build_attempt_identities {
            state.build_attempt_meanings.insert(*identity, digest);
        }

        for identity in &record.capsule_identities {
            state.capsule_meanings.insert(*identity, digest);
        }
        state
            .artifact_meanings
            .insert(record.artifact_identity, digest);
        for identity in &record.build_receipt_identities {
            state.build_meanings.insert(*identity, digest);
        }
        let response = resolve_positive_record_v2(&record, current).unwrap_or_else(|terminal| {
            DevelopComposerOperationResponseV2::terminal(&request.request_identity, terminal)
        });
        state
            .records
            .insert(request.request_identity.clone(), record);
        response
    }

    pub(crate) fn resolve(
        &self,
        request_identity: &str,
        read_cut_epoch_ms: u64,
    ) -> DevelopComposerOperationResponseV2 {
        let state = self
            .state
            .lock()
            .expect("Composer operation mutex poisoned");
        state.records.get(request_identity).map_or_else(
            || unavailable_response(request_identity, "operation", "terminal is unavailable"),
            |record| {
                state
                    .evidence
                    .lock_and_reread_durable(
                        &DevelopComposerDurableEvidenceLocatorV2::from_record(record),
                        read_cut_epoch_ms,
                    )
                    .and_then(|current| resolve_positive_record_v2(record, current))
                    .unwrap_or_else(|terminal| {
                        DevelopComposerOperationResponseV2::terminal(request_identity, terminal)
                    })
            },
        )
    }

    #[cfg(test)]
    pub(crate) fn set_fault_boundary_for_test(&self, boundary: Option<usize>) {
        self.state
            .lock()
            .expect("Composer operation mutex poisoned")
            .fault_boundary = boundary;
    }

    #[cfg(test)]
    pub(crate) fn positive_row_count_for_test(&self) -> usize {
        self.state
            .lock()
            .expect("Composer operation mutex poisoned")
            .records
            .len()
    }

    #[cfg(test)]
    pub(crate) fn mutate_record_for_test(
        &self,
        mutation: impl FnOnce(&mut StoredDevelopComposerPositiveV2),
    ) {
        let mut state = self
            .state
            .lock()
            .expect("Composer operation mutex poisoned");
        mutation(state.records.values_mut().next().expect("positive record"));
    }

    #[cfg(test)]
    pub(crate) fn record_for_test(&self) -> StoredDevelopComposerPositiveV2 {
        self.state
            .lock()
            .expect("Composer operation mutex poisoned")
            .records
            .values()
            .next()
            .expect("positive record")
            .clone()
    }
}

#[cfg(test)]
pub(crate) fn positive_write_boundary_count(record: &StoredDevelopComposerPositiveV2) -> usize {
    // Design, Plan, Artifact, each module, each Build Receipt, Composer receipt, host receipt,
    // operation receipt, and outbox.
    7 + record.module_bytes.len() + record.build_receipt_bytes.len()
}

fn validate_request(
    request: &DevelopComposerRunRequestV2,
) -> Result<(), DevelopComposerTerminalV2> {
    if request.request_identity.trim().is_empty()
        || request.request_identity.len() > MAX_REQUEST_IDENTITY_BYTES
    {
        return Err(unavailable(
            "request_identity",
            "request identity is absent or unbounded",
        ));
    }

    if request.research_custody_reference.trim().is_empty() {
        return Err(unavailable(
            "research_custody_reference",
            "Research custody locator is absent",
        ));
    }

    if request.plugin_source_capsules.is_empty()
        || request.plugin_source_capsules.len() > MAX_PLUGIN_CAPSULES
        || request.plugin_source_capsules.len() != request.design.plugins.len()
    {
        return Err(unavailable(
            "plugin_source_capsules",
            "capsule coverage is not exact and bounded",
        ));
    }
    let mut manifests = request.design.plugins.iter().collect::<Vec<_>>();
    manifests.sort_by(|left, right| left.semantic_id.cmp(&right.semantic_id));
    if manifests
        .iter()
        .zip(&request.plugin_source_capsules)
        .any(|(manifest, capsule)| capsule.manifest != **manifest)
    {
        return Err(unavailable(
            "plugin_source_capsules.order",
            "ordered capsule manifests do not exactly match canonical Design plugin order",
        ));
    }
    Ok(())
}

pub(crate) fn request_digest(request: &DevelopComposerRunRequestV2) -> BindingDigest {
    domain_digest(
        b"rd.develop.composer-operation-request.v2\0",
        &durable_encode(request),
    )
}

pub(crate) fn build_attempt_identity_v2(
    plugin_semantic_id: &str,
    capsule_identity: BindingDigest,
) -> BindingDigest {
    domain_digest(
        b"rd.develop.plugin-build-attempt.identity.v2\0",
        &durable_encode(&(plugin_semantic_id, capsule_identity)),
    )
}

fn map_build_terminal(
    terminal: crate::develop_plugin_build_v2::DevelopPluginBuildTerminalV2,
) -> DevelopComposerTerminalV2 {
    let kind = if matches!(
        terminal.kind,
        crate::develop_plugin_build_v2::DevelopPluginBuildTerminalKindV2::Conflict
    ) {
        DevelopComposerTerminalKindV2::Conflict
    } else {
        DevelopComposerTerminalKindV2::Unavailable
    };
    DevelopComposerTerminalV2 {
        kind,
        coordinate: terminal.coordinate,
        reason: terminal.reason,
    }
}

fn strict_decode<T>(bytes: &[u8], coordinate: &str) -> Result<T, DevelopComposerTerminalV2>
where
    T: for<'de> Deserialize<'de> + Serialize,
{
    let value: T = durable_decode(bytes)
        .map_err(|_| unavailable(coordinate, "private canonical bytes failed strict parse"))?;
    if durable_encode(&value) != bytes {
        return Err(unavailable(
            coordinate,
            "private canonical bytes are noncanonical",
        ));
    }
    Ok(value)
}

fn host_receipt_digest(receipt: &DevelopComposerHostAdmissionReceiptV2) -> BindingDigest {
    domain_digest(
        b"rd.develop.host-admission-receipt.v2\0",
        &durable_encode(&HostReceiptBodyV2 {
            schema_version: receipt.schema_version,
            canonical_plan_digest: receipt.canonical_plan_digest,
            artifact_identity: receipt.artifact_identity,
        }),
    )
}

fn operation_receipt_digest(receipt: &DevelopComposerOperationReceiptV2) -> BindingDigest {
    domain_digest(
        b"rd.develop.composer-operation-receipt.v2\0",
        &durable_encode(&OperationReceiptBodyV2 {
            schema_version: receipt.schema_version,
            request_identity: &receipt.request_identity,
            request_digest: receipt.request_digest,
            research_custody_digest: receipt.research_custody_digest,
            research_request_identity: receipt.research_request_identity,
            intent_identity: receipt.intent_identity,
            design_digest: receipt.design_digest,
            canonical_plan_digest: receipt.canonical_plan_digest,
            artifact_identity: receipt.artifact_identity,
            design_bytes_digest: receipt.design_bytes_digest,
            plan_bytes_digest: receipt.plan_bytes_digest,
            artifact_package_bytes_digest: receipt.artifact_package_bytes_digest,
            private_module_set_digest: receipt.private_module_set_digest,
            build_receipt_set_digest: receipt.build_receipt_set_digest,
            composer_receipt_bytes_digest: receipt.composer_receipt_bytes_digest,
            host_receipt_bytes_digest: receipt.host_receipt_bytes_digest,
            composer_receipt_identity: receipt.composer_receipt_identity,
            host_receipt_identity: receipt.host_receipt_identity,
            response_digest: receipt.response_digest,
        }),
    )
}

fn private_bytes_digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    domain_digest(domain, bytes)
}

fn ordered_private_bytes_digest<'a>(
    domain: &[u8],
    values: impl IntoIterator<Item = &'a [u8]>,
) -> BindingDigest {
    let member_digests = values
        .into_iter()
        .map(|bytes| private_bytes_digest(b"rd.develop.private-member.v2\0", bytes))
        .collect::<Vec<_>>();
    domain_digest(domain, &durable_encode(&member_digests))
}

fn public_response_digest_without_receipt(
    response: &DevelopComposerOperationResponseV2,
) -> BindingDigest {
    let mut projection = response.clone();
    projection.receipt_identity = None;
    domain_digest(
        b"rd.develop.composer-operation-response.v2\0",
        &projection.canonical_bytes(),
    )
}

pub(crate) fn conflict_response(
    request_identity: &str,
    coordinate: &str,
) -> DevelopComposerOperationResponseV2 {
    DevelopComposerOperationResponseV2::terminal(
        request_identity,
        DevelopComposerTerminalV2 {
            kind: DevelopComposerTerminalKindV2::Conflict,
            coordinate: coordinate.to_owned(),
            reason: "identity is already bound to different canonical meaning".to_owned(),
        },
    )
}

fn unavailable_response(
    request_identity: &str,
    coordinate: &str,
    reason: &str,
) -> DevelopComposerOperationResponseV2 {
    DevelopComposerOperationResponseV2::terminal(request_identity, unavailable(coordinate, reason))
}

fn unavailable(coordinate: &str, reason: &str) -> DevelopComposerTerminalV2 {
    DevelopComposerTerminalV2 {
        kind: DevelopComposerTerminalKindV2::Unavailable,
        coordinate: coordinate.to_owned(),
        reason: reason.to_owned(),
    }
}

fn zero() -> BindingDigest {
    BindingDigest::from_untrusted_bytes([0; 32])
}

fn domain_digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

fn hex(digest: BindingDigest) -> String {
    digest
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
