//! R&D-owned PostgreSQL composition for canonical Research custody and durable Composer V2.
//!
//! The public Composer request remains untrusted. `RUN` uses its Research reference only as a
//! lookup key, then locks and canonically rereads the complete Research custody. `RESOLVE` accepts
//! only the Composer request identity: it derives the immutable Research/Intent identities from
//! durable Composer custody and uniquely matches them against the complete canonical Research
//! census. The same R&D Owner transaction is passed to the fact-Owner binding resolver and remains
//! open until the Composer decision completes.

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use serde::Deserialize;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use std::sync::atomic::{AtomicU64, Ordering};
use vibe_common::{clock::Clock, live::clock::LiveClock};
use vibe_data::owner::source_binding::BindingDigest;

use crate::{
    develop_composer_operation_v2::{
        DevelopComposerA0BuildPortV2, DevelopComposerDurableEvidenceLocatorV2,
        DevelopComposerFinalEvidencePortV2, DevelopComposerLockedEvidenceV2,
        DevelopComposerOperationResponseV2, DevelopComposerRunRequestV2, request_digest,
    },
    develop_composer_postgres_v2::PostgresDevelopComposerStoreV2,
    develop_composer_v2::{CurrentResearchDevelopCustodyV2, DevelopComposerTerminalV2},
    product_edge::FrozenResearchGoalIntent,
    rd_owner_postgres_custody::{
        ResearchCustodyLookupV1, VerifiedResearchCustodyV1,
        admit_all_research_custodies_in_transaction, admit_research_custody_in_transaction,
    },
    strategy_plan_v2::VerifiedStrategyInputBindingsV2,
};

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use crate::develop_composer_postgres_v2::{
    DevelopComposerAcceptanceWriteBoundaryV2, PreparedDevelopComposerRunInTransactionV2,
};

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use crate::{
    develop_plugin_build_v2::{
        DevelopPluginBuildTerminalKindV2, UntrustedDevelopPluginCapsuleV2,
        UntrustedDevelopPluginSourceFileV2, VerifiedDevelopPluginBuildReadV2, bounded_source,
        source_research_composer_sealed_corpus_verified_build_v2,
    },
    develop_plugin_build_v2_sandbox::{BUILD_COMMAND, RUSTC_COMMIT, RUSTC_RELEASE, TARGET},
    strategy_design_v2::*,
    strategy_plan_v2::{
        StrategyDesignPreparationV2, prepare_strategy_design_v2, strategy_input_role_identity_v2,
    },
};

#[cfg(all(test, feature = "sealed-source-intake-composer-acceptance"))]
use crate::develop_composer_operation_v2::conflict_response;

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use vibe_data::owner::pit_snapshot::sealed_acceptance::{
    SealedAcceptanceStrategyInputUniverseFrame,
    issue_source_intake_composer_universe_frame_for_owner_lineage,
};

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use strategy_factory_program_sdk::lifecycle_v2::TARGET_SET_BYTES;

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use vibe_data::owner::strategy_input_binding::{
    MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
    UntrustedStrategyInputBindingRequest, UntrustedStrategyInputScope,
};

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub const SEALED_SOURCE_INTAKE_COMPOSER_RESEARCH_REQUEST_IDENTITY_V2: &str =
    "sealed-source-intake-composer-research-v2";

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub const SOURCE_RESEARCH_COMPOSER_PROVIDER_IDENTITY_V2: &str =
    "rd.source-research-composer.fixed-a0.v2";

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
static SEALED_SOURCE_RESEARCH_COMPOSER_A0_EXECUTIONS_V2: AtomicU64 = AtomicU64::new(0);

/// Returns the process-local number of fixed A0 builder invocations for the isolated A2 runner.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub fn sealed_source_research_composer_a0_execution_count_v2() -> u64 {
    SEALED_SOURCE_RESEARCH_COMPOSER_A0_EXECUTIONS_V2.load(Ordering::SeqCst)
}

/// Closed selectors for compile-time A2 inputs that have no separately mutable Owner row.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum SourceResearchComposerAcceptanceTamperV2 {
    BindingResearchRequestIdentity,
    BindingStrategyDesignIdentity,
    BindingInputRoleIdentity,
    BindingScopeSelectionIdentity,
    BindingFieldSemantic,
    BindingChannel,
    BindingTimeframe,
    BindingUnit,
    BindingScale,
    BindingPitRequestIdentity,
    BindingPitRequestDigest,
    BindingSnapshotIdentity,
    BindingSnapshotFactDigest,
    BindingObservationBatchDigest,
    BindingSourceBindingIdentity,
    BindingSourceFrontierDigest,
    BindingCorrectionFrontierDigest,
    BindingInstrumentMasterDigest,
    BindingUniverseSelectionDigest,
    BindingMarketSemanticsIdentity,
    BindingDecisionCut,
    CapsuleSchemaVersion,
    CapsuleManifestSemanticIdentity,
    CapsuleLanguage,
    CapsuleRustcRelease,
    CapsuleRustcCommit,
    CapsuleTarget,
    CapsuleBuildCommand,
    CapsuleSourceFilePath,
    CapsuleSourceFileBytes,
    CapsuleSourceFileSymlinkTarget,
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
impl SourceResearchComposerAcceptanceTamperV2 {
    pub const ALL: [Self; 31] = [
        Self::BindingResearchRequestIdentity,
        Self::BindingStrategyDesignIdentity,
        Self::BindingInputRoleIdentity,
        Self::BindingScopeSelectionIdentity,
        Self::BindingFieldSemantic,
        Self::BindingChannel,
        Self::BindingTimeframe,
        Self::BindingUnit,
        Self::BindingScale,
        Self::BindingPitRequestIdentity,
        Self::BindingPitRequestDigest,
        Self::BindingSnapshotIdentity,
        Self::BindingSnapshotFactDigest,
        Self::BindingObservationBatchDigest,
        Self::BindingSourceBindingIdentity,
        Self::BindingSourceFrontierDigest,
        Self::BindingCorrectionFrontierDigest,
        Self::BindingInstrumentMasterDigest,
        Self::BindingUniverseSelectionDigest,
        Self::BindingMarketSemanticsIdentity,
        Self::BindingDecisionCut,
        Self::CapsuleSchemaVersion,
        Self::CapsuleManifestSemanticIdentity,
        Self::CapsuleLanguage,
        Self::CapsuleRustcRelease,
        Self::CapsuleRustcCommit,
        Self::CapsuleTarget,
        Self::CapsuleBuildCommand,
        Self::CapsuleSourceFilePath,
        Self::CapsuleSourceFileBytes,
        Self::CapsuleSourceFileSymlinkTarget,
    ];
}

/// One acceptance-only intervention. It is never part of a production RUN or RESOLVE DTO.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", content = "selector", deny_unknown_fields)]
pub enum SourceResearchComposerAcceptanceControlV2 {
    FailAfter(DevelopComposerAcceptanceWriteBoundaryV2),
    Tamper(SourceResearchComposerAcceptanceTamperV2),
}

/// Read-only projection of the exact runtime request that R&D will derive from canonical custody.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceResearchComposerRequestProjectionV2 {
    pub schema_version: u16,
    pub research_request_locator: String,
    pub request_identity: String,
    pub request_digest: BindingDigest,
    pub research_custody_digest: BindingDigest,
    pub research_request_identity: BindingDigest,
    pub intent_identity: BindingDigest,
    pub intent_digest: BindingDigest,
    pub design_identity: BindingDigest,
    pub design_digest: BindingDigest,
    pub provider_identity: String,
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
const A2_PLUGIN_ID: &str = "research.plugin.stateful-trend.v1";
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
const A2_STATE_POST: &str = "plugin.state.post.v1";
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
const A2_RESEARCH_REQUEST_DIGEST: [u8; 32] = [
    223, 5, 233, 127, 131, 44, 31, 89, 145, 164, 47, 53, 99, 79, 189, 249, 39, 161, 65, 101, 108,
    144, 51, 47, 139, 187, 12, 62, 199, 108, 216, 30,
];
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
const A2_RESEARCH_INTENT_IDENTITY: [u8; 32] = [
    144, 111, 188, 100, 83, 142, 165, 188, 241, 146, 149, 161, 150, 22, 45, 75, 87, 250, 31, 16,
    149, 240, 135, 230, 227, 211, 2, 181, 121, 228, 234, 202,
];
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
const A2_RESEARCH_INTENT_DIGEST: [u8; 32] = [
    145, 220, 57, 233, 17, 42, 91, 118, 88, 23, 84, 51, 92, 93, 176, 110, 80, 10, 195, 126, 41, 34,
    62, 116, 32, 46, 242, 254, 183, 185, 73, 14,
];
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
const A2_OUTPUT_PORTS: &[(&str, ValueTypeV2)] = &[
    ("proposal.position-intent.v1", ValueTypeV2::PositionIntentV1),
    ("proposal.target-variant.v1", ValueTypeV2::TargetVariantV1),
    ("proposal.target-position.v1", ValueTypeV2::I64),
    ("proposal.target-weight.v1", ValueTypeV2::I32),
    ("proposal.rebalance-sequence.v1", ValueTypeV2::U64),
    ("proposal.reconciliation-target.v1", ValueTypeV2::I64),
    (
        "proposal.protection-variant.v1",
        ValueTypeV2::ProtectionVariantV1,
    ),
    ("proposal.stop-loss.v1", ValueTypeV2::I64),
    ("proposal.take-profit.v1", ValueTypeV2::I64),
    ("proposal.trailing-distance.v1", ValueTypeV2::U64),
    ("proposal.trailing-stop.v1", ValueTypeV2::I64),
    ("proposal.member-target-set.v2", ValueTypeV2::Bytes),
];

/// Returns the fixed, untrusted two-role A2 Design proposal.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[must_use]
pub fn sealed_source_research_composer_design_v2() -> StrategyDesignV2 {
    let capabilities = [
        "research.trend.warmup.v1",
        "research.trend.enter.v1",
        "research.trend.add.v1",
        "research.trend.reduce.v1",
        "research.trend.trailing.v1",
        "research.trend.timer-exit.v1",
    ];
    let mut input_ports = vec![
        ("input.close.v1", ValueTypeV2::I128, 16),
        ("input.open.v1", ValueTypeV2::I128, 16),
        ("input.member-b-close.v2", ValueTypeV2::I128, 16),
        ("input.member-b-open.v2", ValueTypeV2::I128, 16),
        ("input.current-position.v1", ValueTypeV2::I64, 8),
        ("input.envelope-digest.v1", ValueTypeV2::Digest32, 32),
        ("input.intent.v1", ValueTypeV2::StableIdentity16, 16),
        ("input.lookback.v1", ValueTypeV2::I64, 8),
        ("input.rebalance-sequence.v1", ValueTypeV2::U64, 8),
    ]
    .into_iter()
    .map(|(semantic_id, value_type, max_bytes)| PortContractV2 {
        semantic_id: semantic_id.to_owned(),
        value_type,
        max_bytes,
    })
    .collect::<Vec<_>>();
    input_ports.sort();
    let mut output_ports = A2_OUTPUT_PORTS
        .iter()
        .map(|(semantic_id, value_type)| PortContractV2 {
            semantic_id: (*semantic_id).to_owned(),
            value_type: *value_type,
            max_bytes: match *semantic_id {
                "proposal.member-target-set.v2" => TARGET_SET_BYTES as u32,
                _ if matches!(
                    value_type,
                    ValueTypeV2::PositionIntentV1
                        | ValueTypeV2::TargetVariantV1
                        | ValueTypeV2::ProtectionVariantV1
                ) =>
                {
                    64
                }
                _ if matches!(value_type, ValueTypeV2::I32) => 4,
                _ => 8,
            },
        })
        .collect::<Vec<_>>();
    output_ports.sort();
    StrategyDesignV2 {
        schema_version: STRATEGY_DESIGN_SCHEMA_V2,
        research_request_identity: BindingDigest::from_untrusted_bytes(A2_RESEARCH_REQUEST_DIGEST),
        intent_identity: BindingDigest::from_untrusted_bytes(A2_RESEARCH_INTENT_IDENTITY),
        intent_digest: BindingDigest::from_untrusted_bytes(A2_RESEARCH_INTENT_DIGEST),
        inputs: vec![
            a2_input_role("research.input.close.v1", "MARKET_DATA.BAR.CLOSE.PRICE.V1"),
            a2_input_role("research.input.open.v1", "MARKET_DATA.BAR.OPEN.PRICE.V1"),
        ],
        joins: vec![],
        parameters: vec![
            ParameterV2 {
                semantic_id: "research.parameter.lookback.v1".to_owned(),
                value_type: ValueTypeV2::I64,
                value: TypedConstantV2::I64 { value: 20 },
                unit: "BAR_COUNT".to_owned(),
            },
            ParameterV2 {
                semantic_id: "research.parameter.timer-close.v1".to_owned(),
                value_type: ValueTypeV2::I128,
                value: TypedConstantV2::I128 { value: 0 },
                unit: "PRICE".to_owned(),
            },
        ],
        state: vec![StateCellV2 {
            semantic_id: "research.state.trend.v1".to_owned(),
            value_type: ValueTypeV2::Bytes,
            initial: TypedConstantV2::Bytes { value: vec![] },
            max_bytes: 256,
        }],
        reactions: vec![
            ReactionGraphV2 {
                kind: LifecycleKindV2::Start,
                nodes: vec![],
                state_writes: vec![],
                proposal: None,
            },
            a2_reaction(
                LifecycleKindV2::Bar,
                "research.node.bar.v1",
                "research.state.trend.v1",
                true,
            ),
            a2_reaction(
                LifecycleKindV2::Event,
                "research.node.event.v1",
                "research.state.trend.v1",
                true,
            ),
            ReactionGraphV2 {
                kind: LifecycleKindV2::Fill,
                nodes: vec![],
                state_writes: vec![],
                proposal: None,
            },
            a2_reaction(
                LifecycleKindV2::Timer,
                "research.node.timer.v1",
                "research.state.trend.v1",
                false,
            ),
            ReactionGraphV2 {
                kind: LifecycleKindV2::Stop,
                nodes: vec![],
                state_writes: vec![],
                proposal: None,
            },
        ],
        capabilities: capabilities
            .iter()
            .map(|semantic_id| CapabilityDeclarationV2 {
                semantic_id: (*semantic_id).to_owned(),
                version: 1,
                dependencies: vec![],
            })
            .collect(),
        plugins: vec![PluginManifestV2 {
            semantic_id: A2_PLUGIN_ID.to_owned(),
            abi_version: 2,
            input_ports,
            output_ports,
            state: PluginStateContractV2 {
                pre_port_id: "plugin.state.pre.v1".to_owned(),
                post_port_id: A2_STATE_POST.to_owned(),
                value_type: ValueTypeV2::Bytes,
                max_bytes: 256,
            },
            capability_ids: capabilities
                .iter()
                .map(|value| (*value).to_owned())
                .collect(),
            max_fuel: 100_000,
            max_linear_memory_bytes: 1_048_576,
            max_invocations_per_event: 1,
            failure_semantic_id: "strategy.plugin.failure.unsupported.v1".to_owned(),
        }],
        resources: ResourceBoundsV2 {
            max_inputs: 8,
            max_nodes_per_reaction: 4,
            max_dependency_edges: 256,
            max_state_bytes: 4096,
            max_plugin_calls_per_event: 4,
        },
        falsifier: "Does the fixed control erase the effect?".to_owned(),
    }
}

/// Returns the caller-safe fixed untrusted request for the later authenticated A2 API.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[must_use]
pub fn sealed_source_research_composer_request_v2() -> DevelopComposerRunRequestV2 {
    let design = sealed_source_research_composer_design_v2();
    let StrategyDesignPreparationV2::Prepared {
        design_identity, ..
    } = prepare_strategy_design_v2(&design)
    else {
        unreachable!("fixed A2 Design must prepare")
    };
    let selection_identity = BindingDigest::from_untrusted_bytes([
        38, 69, 161, 29, 208, 191, 187, 10, 106, 223, 55, 76, 175, 82, 195, 14, 54, 4, 74, 9, 51,
        97, 227, 227, 81, 199, 206, 202, 52, 52, 55, 207,
    ]);
    let binding_requests = design
        .inputs
        .iter()
        .enumerate()
        .map(|(ordinal, input)| {
            a2_fixed_binding_request(
                input,
                design.research_request_identity,
                design_identity,
                selection_identity,
                ordinal as u8,
            )
        })
        .collect();
    let manifest = design.plugins[0].clone();
    let capsule = UntrustedDevelopPluginCapsuleV2 {
        schema_version: 2,
        manifest: manifest.clone(),
        language: "rust.no_std.fixed-abi-source.v2".to_owned(),
        rustc_release: RUSTC_RELEASE.to_owned(),
        rustc_commit: RUSTC_COMMIT.to_owned(),
        target: TARGET.to_owned(),
        build_command: BUILD_COMMAND
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
        files: vec![UntrustedDevelopPluginSourceFileV2 {
            path: "src/lib.rs".to_owned(),
            bytes: bounded_source(&manifest).into_bytes(),
            symlink_target: None,
        }],
    };
    DevelopComposerRunRequestV2 {
        request_identity: "sealed-source-intake-composer-develop-v2".to_owned(),
        research_custody_reference: SEALED_SOURCE_INTAKE_COMPOSER_RESEARCH_REQUEST_IDENTITY_V2
            .to_owned(),
        design,
        binding_requests,
        plugin_source_capsules: vec![capsule],
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn derive_source_research_composer_request_v2(
    research: &CurrentResearchDevelopCustodyV2,
) -> Result<DevelopComposerRunRequestV2, DevelopComposerTerminalV2> {
    let mut design = sealed_source_research_composer_design_v2();
    design.research_request_identity = research.research_request_identity();
    design.intent_identity = research.intent_identity();
    design.intent_digest = research.intent_digest();
    design.falsifier = research.falsifier().to_owned();
    let StrategyDesignPreparationV2::Prepared {
        design_identity, ..
    } = prepare_strategy_design_v2(&design)
    else {
        return Err(DevelopComposerTerminalV2::unavailable(
            "design",
            "the canonical Research-derived A2 Design does not prepare",
        ));
    };
    let selection_identity = BindingDigest::from_untrusted_bytes([
        38, 69, 161, 29, 208, 191, 187, 10, 106, 223, 55, 76, 175, 82, 195, 14, 54, 4, 74, 9, 51,
        97, 227, 227, 81, 199, 206, 202, 52, 52, 55, 207,
    ]);
    let binding_requests = design
        .inputs
        .iter()
        .enumerate()
        .map(|(ordinal, input)| {
            a2_fixed_binding_request(
                input,
                design.research_request_identity,
                design_identity,
                selection_identity,
                ordinal as u8,
            )
        })
        .collect();
    let manifest = design.plugins[0].clone();
    let capsule = UntrustedDevelopPluginCapsuleV2 {
        schema_version: 2,
        manifest: manifest.clone(),
        language: "rust.no_std.fixed-abi-source.v2".to_owned(),
        rustc_release: RUSTC_RELEASE.to_owned(),
        rustc_commit: RUSTC_COMMIT.to_owned(),
        target: TARGET.to_owned(),
        build_command: BUILD_COMMAND
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
        files: vec![UntrustedDevelopPluginSourceFileV2 {
            path: "src/lib.rs".to_owned(),
            bytes: bounded_source(&manifest).into_bytes(),
            symlink_target: None,
        }],
    };
    Ok(DevelopComposerRunRequestV2 {
        request_identity: source_research_composer_request_identity_v2(
            research.research_request_identity(),
        ),
        research_custody_reference: research.request_locator().to_owned(),
        design,
        binding_requests,
        plugin_source_capsules: vec![capsule],
    })
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn tamper_source_research_composer_request_v2(
    request: &mut DevelopComposerRunRequestV2,
    selector: SourceResearchComposerAcceptanceTamperV2,
) -> Result<(), DevelopComposerTerminalV2> {
    let binding = request.binding_requests.first_mut().ok_or_else(|| {
        DevelopComposerTerminalV2::unavailable(
            "acceptance_tamper",
            "the fixed A2 binding input is unavailable",
        )
    })?;
    let capsule = request.plugin_source_capsules.first_mut().ok_or_else(|| {
        DevelopComposerTerminalV2::unavailable(
            "acceptance_tamper",
            "the fixed A2 source capsule is unavailable",
        )
    })?;
    if capsule.files.is_empty() {
        return Err(DevelopComposerTerminalV2::unavailable(
            "acceptance_tamper",
            "the fixed A2 source file is unavailable",
        ));
    }
    let changed_digest = BindingDigest::from_untrusted_bytes([0xff; 32]);
    match selector {
        SourceResearchComposerAcceptanceTamperV2::BindingResearchRequestIdentity => {
            binding.research_request_identity = changed_digest;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingStrategyDesignIdentity => {
            binding.strategy_design_identity = changed_digest;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingInputRoleIdentity => {
            binding.input_role_identity = changed_digest;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingScopeSelectionIdentity => {
            binding.scope = UntrustedStrategyInputScope::UniverseSelection {
                selection_identity: changed_digest,
            };
        }
        SourceResearchComposerAcceptanceTamperV2::BindingFieldSemantic => {
            binding.field_semantic = MarketDataFieldSemantic::BarHighPrice;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingChannel => {
            binding.channel = StrategyInputChannel::Reference;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingTimeframe => {
            binding.timeframe.push_str("-tampered");
        }
        SourceResearchComposerAcceptanceTamperV2::BindingUnit => {
            binding.unit = StrategyInputUnit::Quantity;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingScale => {
            binding.scale = binding.scale.wrapping_add(1);
        }
        SourceResearchComposerAcceptanceTamperV2::BindingPitRequestIdentity => {
            binding.pit_request_identity = changed_digest;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingPitRequestDigest => {
            binding.pit_request_digest = changed_digest;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingSnapshotIdentity => {
            binding.snapshot_identity = changed_digest;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingSnapshotFactDigest => {
            binding.snapshot_fact_digest = changed_digest;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingObservationBatchDigest => {
            binding.observation_batch_digest = changed_digest;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingSourceBindingIdentity => {
            binding.source_binding_identity = changed_digest;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingSourceFrontierDigest => {
            binding.source_frontier_digest = changed_digest;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingCorrectionFrontierDigest => {
            binding.correction_frontier_digest = changed_digest;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingInstrumentMasterDigest => {
            binding.instrument_master_digest = changed_digest;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingUniverseSelectionDigest => {
            binding.universe_selection_digest = changed_digest;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingMarketSemanticsIdentity => {
            binding.market_semantics_identity = changed_digest;
        }
        SourceResearchComposerAcceptanceTamperV2::BindingDecisionCut => {
            binding.decision_cut = binding.decision_cut.wrapping_add(1);
        }
        SourceResearchComposerAcceptanceTamperV2::CapsuleSchemaVersion => {
            capsule.schema_version = capsule.schema_version.wrapping_add(1);
        }
        SourceResearchComposerAcceptanceTamperV2::CapsuleManifestSemanticIdentity => {
            capsule.manifest.semantic_id.push_str(".tampered");
        }
        SourceResearchComposerAcceptanceTamperV2::CapsuleLanguage => {
            capsule.language.push_str(".tampered");
        }
        SourceResearchComposerAcceptanceTamperV2::CapsuleRustcRelease => {
            capsule.rustc_release.push_str(".tampered");
        }
        SourceResearchComposerAcceptanceTamperV2::CapsuleRustcCommit => {
            capsule.rustc_commit.push_str(".tampered");
        }
        SourceResearchComposerAcceptanceTamperV2::CapsuleTarget => {
            capsule.target.push_str(".tampered");
        }
        SourceResearchComposerAcceptanceTamperV2::CapsuleBuildCommand => {
            capsule.build_command.push("--tampered".to_owned());
        }
        SourceResearchComposerAcceptanceTamperV2::CapsuleSourceFilePath => {
            capsule.files[0].path.push_str(".tampered");
        }
        SourceResearchComposerAcceptanceTamperV2::CapsuleSourceFileBytes => {
            capsule.files[0].bytes.push(b' ');
        }
        SourceResearchComposerAcceptanceTamperV2::CapsuleSourceFileSymlinkTarget => {
            capsule.files[0].symlink_target = Some("tampered".to_owned());
        }
    }
    Ok(())
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn source_research_composer_request_identity_v2(
    research_request_identity: BindingDigest,
) -> String {
    let request_suffix = research_request_identity
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("rd-source-research-composer-v2-{request_suffix}")
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn project_source_research_composer_request_v2(
    research: &CurrentResearchDevelopCustodyV2,
    request: &DevelopComposerRunRequestV2,
) -> Result<SourceResearchComposerRequestProjectionV2, DevelopComposerTerminalV2> {
    let StrategyDesignPreparationV2::Prepared {
        design_identity,
        design_digest,
    } = prepare_strategy_design_v2(&request.design)
    else {
        return Err(DevelopComposerTerminalV2::unavailable(
            "design",
            "the canonical Research-derived A2 Design does not prepare",
        ));
    };
    Ok(SourceResearchComposerRequestProjectionV2 {
        schema_version: 2,
        research_request_locator: research.request_locator().to_owned(),
        request_identity: request.request_identity.clone(),
        request_digest: request_digest(request),
        research_custody_digest: research.custody_digest(),
        research_request_identity: research.research_request_identity(),
        intent_identity: research.intent_identity(),
        intent_digest: research.intent_digest(),
        design_identity,
        design_digest,
        provider_identity: SOURCE_RESEARCH_COMPOSER_PROVIDER_IDENTITY_V2.to_owned(),
    })
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn a2_fixed_binding_request(
    input: &InputRoleV2,
    research_request_identity: BindingDigest,
    strategy_design_identity: BindingDigest,
    selection_identity: BindingDigest,
    seed: u8,
) -> UntrustedStrategyInputBindingRequest {
    UntrustedStrategyInputBindingRequest {
        research_request_identity,
        strategy_design_identity,
        input_role_identity: strategy_input_role_identity_v2(input),
        scope: UntrustedStrategyInputScope::UniverseSelection { selection_identity },
        field_semantic: match input.field_semantic_id.as_str() {
            "MARKET_DATA.BAR.OPEN.PRICE.V1" => MarketDataFieldSemantic::BarOpenPrice,
            _ => MarketDataFieldSemantic::BarClosePrice,
        },
        channel: StrategyInputChannel::Market,
        timeframe: input.timeframe.clone(),
        unit: StrategyInputUnit::Price,
        scale: input.scale,
        pit_request_identity: a2_digest(seed + 11),
        pit_request_digest: a2_digest(seed + 21),
        snapshot_identity: a2_digest(seed + 31),
        snapshot_fact_digest: a2_digest(seed + 41),
        observation_batch_digest: a2_digest(seed + 51),
        source_binding_identity: a2_digest(seed + 61),
        source_frontier_digest: a2_digest(seed + 71),
        correction_frontier_digest: a2_digest(seed + 81),
        instrument_master_digest: a2_digest(seed + 91),
        universe_selection_digest: a2_digest(seed + 101),
        market_semantics_identity: a2_digest(111),
        decision_cut: 40,
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn a2_digest(seed: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([seed; 32])
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn a2_input_role(semantic_id: &str, field_semantic_id: &str) -> InputRoleV2 {
    InputRoleV2 {
        semantic_id: semantic_id.to_owned(),
        fact_class: InputFactClassV2::MarketData,
        instrument: String::new(),
        scope: InputScopeV2::UniverseMembers,
        field_semantic_id: field_semantic_id.to_owned(),
        channel: "MARKET".to_owned(),
        timeframe: "1D".to_owned(),
        unit: "PRICE".to_owned(),
        scale: 2,
        value_type: ValueTypeV2::I128,
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn a2_output(node: &str, port: &str) -> ValueRefV2 {
    ValueRefV2::NodeOutput {
        node_id: node.to_owned(),
        port_id: port.to_owned(),
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn a2_context(field: LifecycleContextV2) -> ValueRefV2 {
    ValueRefV2::LifecycleContext { field }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn a2_proposal(node: &str) -> ProposalWiringV2 {
    ProposalWiringV2 {
        position_intent: a2_output(node, "proposal.position-intent.v1"),
        target_variant: a2_output(node, "proposal.target-variant.v1"),
        target_position_units: a2_output(node, "proposal.target-position.v1"),
        target_weight_micros: a2_output(node, "proposal.target-weight.v1"),
        rebalance_sequence: a2_output(node, "proposal.rebalance-sequence.v1"),
        reconciliation_target_units: a2_output(node, "proposal.reconciliation-target.v1"),
        protection_variant: a2_output(node, "proposal.protection-variant.v1"),
        stop_loss_ticks: a2_output(node, "proposal.stop-loss.v1"),
        take_profit_ticks: a2_output(node, "proposal.take-profit.v1"),
        trailing_distance_ticks: a2_output(node, "proposal.trailing-distance.v1"),
        trailing_stop_ticks: a2_output(node, "proposal.trailing-stop.v1"),
        member_target_set: Some(a2_output(node, "proposal.member-target-set.v2")),
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn a2_compute_node(node: &str, state: &str, event: bool) -> ComputeNodeV2 {
    let market_source = |input_id: &str, member_ordinal| ValueRefV2::UniverseMemberInput {
        input_id: input_id.to_owned(),
        member_ordinal,
    };
    let timer_source = || ValueRefV2::Parameter {
        parameter_id: "research.parameter.timer-close.v1".to_owned(),
    };
    let mut input_bindings = vec![
        PortBindingV2 {
            port_id: "input.close.v1".to_owned(),
            source: if event {
                market_source("research.input.close.v1", 0)
            } else {
                timer_source()
            },
        },
        PortBindingV2 {
            port_id: "input.open.v1".to_owned(),
            source: if event {
                market_source("research.input.open.v1", 0)
            } else {
                timer_source()
            },
        },
        PortBindingV2 {
            port_id: "input.member-b-close.v2".to_owned(),
            source: if event {
                market_source("research.input.close.v1", 1)
            } else {
                timer_source()
            },
        },
        PortBindingV2 {
            port_id: "input.member-b-open.v2".to_owned(),
            source: if event {
                market_source("research.input.open.v1", 1)
            } else {
                timer_source()
            },
        },
        PortBindingV2 {
            port_id: "input.current-position.v1".to_owned(),
            source: a2_context(LifecycleContextV2::CurrentPositionUnits),
        },
        PortBindingV2 {
            port_id: "input.envelope-digest.v1".to_owned(),
            source: a2_context(LifecycleContextV2::EnvelopeDigest),
        },
        PortBindingV2 {
            port_id: "input.intent.v1".to_owned(),
            source: a2_context(LifecycleContextV2::IntentIdentity),
        },
        PortBindingV2 {
            port_id: "input.lookback.v1".to_owned(),
            source: ValueRefV2::Parameter {
                parameter_id: "research.parameter.lookback.v1".to_owned(),
            },
        },
        PortBindingV2 {
            port_id: "input.rebalance-sequence.v1".to_owned(),
            source: a2_context(LifecycleContextV2::RebalanceSequence),
        },
    ];
    input_bindings.sort();
    let mut output_port_ids = A2_OUTPUT_PORTS
        .iter()
        .map(|(port, _)| (*port).to_owned())
        .collect::<Vec<_>>();
    output_port_ids.sort();
    ComputeNodeV2 {
        semantic_id: node.to_owned(),
        plugin_semantic_id: A2_PLUGIN_ID.to_owned(),
        input_bindings,
        pre_state: ValueRefV2::PriorState {
            state_id: state.to_owned(),
        },
        output_port_ids,
        post_state_port_id: A2_STATE_POST.to_owned(),
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn a2_reaction(kind: LifecycleKindV2, node: &str, state: &str, event: bool) -> ReactionGraphV2 {
    ReactionGraphV2 {
        kind,
        nodes: vec![a2_compute_node(node, state, event)],
        state_writes: vec![StateWriteV2 {
            state_id: state.to_owned(),
            source: a2_output(node, A2_STATE_POST),
        }],
        proposal: Some(a2_proposal(node)),
    }
}

/// Canonical fact-Owner binding seam selected by the A2 assembly at compile time.
///
/// Both methods receive the already-open R&D Owner transaction. Implementations may call only
/// Owner-owned sealed read functions on that transaction; they must not open another pool,
/// connection, or transaction and cannot trust a caller-projected binding receipt.
#[async_trait::async_trait]
pub(crate) trait SourceResearchComposerBindingOwnerV2: Send + Sync {
    async fn lock_for_run(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        request: &DevelopComposerRunRequestV2,
        read_cut_epoch_ms: u64,
    ) -> Result<VerifiedStrategyInputBindingsV2, DevelopComposerTerminalV2>;

    async fn lock_for_resolve(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        locator: &DevelopComposerDurableEvidenceLocatorV2,
        read_cut_epoch_ms: u64,
    ) -> Result<VerifiedStrategyInputBindingsV2, DevelopComposerTerminalV2>;
}

/// Compile-time-selected A2 Market Data binding Owner.
///
/// The type has no fields or constructor arguments: every read issues the one sealed A2 universe
/// directly from the Market Data Owner adapter. The caller can therefore supply neither Market
/// facts nor a receipt/locator/clock substitute. The enclosing Composer preflight still treats the
/// public binding requests as untrusted proposals and proves that the fixed Owner frame binds the
/// canonically reread Research custody and prepared Design.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
struct SealedSourceResearchComposerBindingOwnerV2;

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[async_trait::async_trait]
impl SourceResearchComposerBindingOwnerV2 for SealedSourceResearchComposerBindingOwnerV2 {
    async fn lock_for_run(
        &self,
        _transaction: &mut Transaction<'_, Postgres>,
        request: &DevelopComposerRunRequestV2,
        _read_cut_epoch_ms: u64,
    ) -> Result<VerifiedStrategyInputBindingsV2, DevelopComposerTerminalV2> {
        let design_identity = match prepare_strategy_design_v2(&request.design) {
            StrategyDesignPreparationV2::Prepared {
                design_identity, ..
            } => design_identity,
            _ => return Err(market_data_unavailable()),
        };
        let authority =
            sealed_a2_market_authority(request.design.research_request_identity, design_identity)?;
        verify_sealed_a2_market_authority(
            &authority,
            request.design.research_request_identity,
            design_identity,
        )?;
        Ok(VerifiedStrategyInputBindingsV2::from_sealed_universe(
            &authority,
        ))
    }

    async fn lock_for_resolve(
        &self,
        _transaction: &mut Transaction<'_, Postgres>,
        locator: &DevelopComposerDurableEvidenceLocatorV2,
        _read_cut_epoch_ms: u64,
    ) -> Result<VerifiedStrategyInputBindingsV2, DevelopComposerTerminalV2> {
        let authority =
            sealed_a2_market_authority(locator.research_request_identity, locator.design_identity)?;
        verify_sealed_a2_market_authority(
            &authority,
            locator.research_request_identity,
            locator.design_identity,
        )?;
        Ok(VerifiedStrategyInputBindingsV2::from_sealed_universe(
            &authority,
        ))
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn sealed_a2_market_authority(
    research_request_identity: BindingDigest,
    design_identity: BindingDigest,
) -> Result<SealedAcceptanceStrategyInputUniverseFrame, DevelopComposerTerminalV2> {
    issue_source_intake_composer_universe_frame_for_owner_lineage(
        research_request_identity,
        design_identity,
    )
    .map_err(|_| market_data_unavailable())
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn verify_sealed_a2_market_authority(
    authority: &SealedAcceptanceStrategyInputUniverseFrame,
    research_request_identity: BindingDigest,
    design_identity: BindingDigest,
) -> Result<(), DevelopComposerTerminalV2> {
    if authority.role_bindings().is_empty()
        || authority.role_bindings().iter().any(|binding| {
            binding.research_request_identity() != research_request_identity
                || binding.strategy_design_identity() != design_identity
        })
    {
        return Err(market_data_unavailable());
    }
    Ok(())
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn market_data_unavailable() -> DevelopComposerTerminalV2 {
    DevelopComposerTerminalV2::unavailable(
        "market_data_binding",
        "the compile-time sealed A2 Market Data Owner frame is unavailable or mismatched",
    )
}

/// Fixed A0 adapter for the A2 composition. It accepts only the manifest and capsule already
/// carried by the dedicated fixed A2 Composer corpus.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
struct SealedSourceResearchComposerA0BuildV2;

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
impl DevelopComposerA0BuildPortV2 for SealedSourceResearchComposerA0BuildV2 {
    fn build(
        &mut self,
        manifest: &PluginManifestV2,
        capsule: &UntrustedDevelopPluginCapsuleV2,
    ) -> Result<VerifiedDevelopPluginBuildReadV2, DevelopComposerTerminalV2> {
        SEALED_SOURCE_RESEARCH_COMPOSER_A0_EXECUTIONS_V2.fetch_add(1, Ordering::SeqCst);
        source_research_composer_sealed_corpus_verified_build_v2(manifest, capsule).map_err(
            |terminal| DevelopComposerTerminalV2 {
                kind: if terminal.kind == DevelopPluginBuildTerminalKindV2::Conflict {
                    crate::develop_composer_v2::DevelopComposerTerminalKindV2::Conflict
                } else {
                    crate::develop_composer_v2::DevelopComposerTerminalKindV2::Unavailable
                },
                coordinate: terminal.coordinate,
                reason: terminal.reason,
            },
        )
    }
}

/// One fixed A2 composition root. The binding Owner is injected by trusted assembly code, not by
/// the request or a runtime provider selector.
pub(crate) struct PostgresSourceResearchComposerV2<B> {
    store: PostgresDevelopComposerStoreV2,
    binding_owner: B,
}

impl<B> PostgresSourceResearchComposerV2<B>
where
    B: SourceResearchComposerBindingOwnerV2,
{
    pub(crate) async fn connect(
        rd_owner_database_url: &str,
        rd_fact_writer_database_url: &str,
        binding_owner: B,
    ) -> Result<Self, sqlx::Error> {
        Ok(Self {
            store: PostgresDevelopComposerStoreV2::connect(
                rd_owner_database_url,
                rd_fact_writer_database_url,
            )
            .await?,
            binding_owner,
        })
    }

    /// Projects the exact request identities R&D will derive without creating Composer custody.
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    pub(crate) async fn request_projection(
        &self,
        research_request_locator: &str,
    ) -> Result<SourceResearchComposerRequestProjectionV2, sqlx::Error> {
        let read_cut_epoch_ms = current_read_cut_epoch_ms();
        let mut owner_transaction = self.store.begin_read_transaction().await?;
        let research = self
            .lock_research_for_locator(
                &mut owner_transaction,
                research_request_locator,
                read_cut_epoch_ms,
            )
            .await
            .map_err(composer_terminal_protocol)?;
        let request = derive_source_research_composer_request_v2(&research)
            .map_err(composer_terminal_protocol)?;
        let projection = project_source_research_composer_request_v2(&research, &request)
            .map_err(composer_terminal_protocol)?;
        owner_transaction.commit().await?;
        Ok(projection)
    }

    /// Runs the existing Composer operation from canonical, transaction-locked Owner evidence.
    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    pub(crate) async fn run(
        &self,
        builder: &mut impl DevelopComposerA0BuildPortV2,
        research_request_locator: &str,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        self.run_with_acceptance_control(builder, research_request_locator, None)
            .await
    }

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    async fn run_with_acceptance_control(
        &self,
        builder: &mut impl DevelopComposerA0BuildPortV2,
        research_request_locator: &str,
        control: Option<SourceResearchComposerAcceptanceControlV2>,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        let read_cut_epoch_ms = current_read_cut_epoch_ms();
        let mut owner_transaction = self.store.begin_read_transaction().await?;
        let research = match self
            .lock_research_for_locator(
                &mut owner_transaction,
                research_request_locator,
                read_cut_epoch_ms,
            )
            .await
        {
            Ok(research) => research,
            Err(terminal) => {
                owner_transaction.rollback().await?;
                return Ok(terminal_response_for_locator(
                    research_request_locator,
                    terminal,
                ));
            }
        };
        let mut request = match derive_source_research_composer_request_v2(&research) {
            Ok(request) => request,
            Err(terminal) => {
                owner_transaction.rollback().await?;
                return Ok(terminal_response_for_locator(
                    research_request_locator,
                    terminal,
                ));
            }
        };
        if let Some(SourceResearchComposerAcceptanceControlV2::Tamper(selector)) = control
            && let Err(terminal) =
                tamper_source_research_composer_request_v2(&mut request, selector)
        {
            owner_transaction.rollback().await?;
            return Ok(terminal_response_for_request(&request, terminal));
        }
        let initial = self
            .lock_run_evidence(&mut owner_transaction, &request, read_cut_epoch_ms)
            .await;
        let initial = match initial {
            Ok(initial) => initial,
            Err(terminal) => {
                owner_transaction.rollback().await?;
                return Ok(terminal_response_for_request(&request, terminal));
            }
        };

        let evidence = LockedOwnerEvidenceV2 {
            locked: Ok(initial),
        };
        let prepared = self
            .store
            .prepare_run_in_transaction(
                &mut owner_transaction,
                builder,
                &evidence,
                &request,
                read_cut_epoch_ms,
            )
            .await;
        let response = match prepared {
            Ok(PreparedDevelopComposerRunInTransactionV2::Complete(response)) => Ok(response),
            Ok(PreparedDevelopComposerRunInTransactionV2::Prepared(prepared)) => {
                let final_locked = match self
                    .lock_run_evidence(&mut owner_transaction, &request, read_cut_epoch_ms)
                    .await
                {
                    Ok(locked) => locked,
                    Err(terminal) => {
                        owner_transaction.rollback().await?;
                        return Ok(terminal_response_for_request(&request, terminal));
                    }
                };
                match control {
                    Some(SourceResearchComposerAcceptanceControlV2::FailAfter(boundary)) => {
                        self.store
                            .commit_prepared_run_in_transaction_with_acceptance_boundary(
                                &mut owner_transaction,
                                &request,
                                prepared,
                                final_locked,
                                boundary,
                            )
                            .await
                    }
                    _ => {
                        self.store
                            .commit_prepared_run_in_transaction(
                                &mut owner_transaction,
                                &request,
                                prepared,
                                final_locked,
                            )
                            .await
                    }
                }
            }
            Err(error) => Err(error),
        };
        match response {
            Ok(response) => match owner_transaction.commit().await {
                Ok(()) => Ok(response),
                Err(_) => Ok(DevelopComposerOperationResponseV2::submitted_or_unknown(
                    &request.request_identity,
                )),
            },
            Err(error) => {
                owner_transaction.rollback().await?;
                Err(error)
            }
        }
    }

    /// Resolves an existing operation by request identity only and never starts first mutation.
    pub(crate) async fn resolve(
        &self,
        request_identity: &str,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        self.resolve_with_acceptance_tamper(request_identity, None)
            .await
    }

    #[cfg(feature = "sealed-source-intake-composer-acceptance")]
    async fn resolve_with_acceptance_tamper(
        &self,
        request_identity: &str,
        tamper: Option<SourceResearchComposerAcceptanceTamperV2>,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        let read_cut_epoch_ms = current_read_cut_epoch_ms();
        let Some(locator) = self
            .store
            .durable_evidence_locator(request_identity)
            .await?
        else {
            return self.store.resolve(request_identity).await;
        };

        let mut owner_transaction = self.store.begin_read_transaction().await?;
        let locked = self
            .lock_resolve_evidence(&mut owner_transaction, &locator, read_cut_epoch_ms)
            .await;
        let locked = match (locked, tamper) {
            (Ok(locked), Some(selector)) => {
                let mut expected = derive_source_research_composer_request_v2(&locked.research)
                    .map_err(composer_terminal_protocol)?;
                tamper_source_research_composer_request_v2(&mut expected, selector)
                    .map_err(composer_terminal_protocol)?;
                if request_digest(&expected) != locator.request_digest {
                    Err(DevelopComposerTerminalV2::unavailable(
                        "acceptance_tamper",
                        "the selected compile-time A2 input no longer matches durable custody",
                    ))
                } else {
                    Ok(locked)
                }
            }
            (locked, _) => locked,
        };
        let evidence = LockedOwnerEvidenceV2 { locked };
        let response = self
            .store
            .resolve_with_evidence(request_identity, &evidence, read_cut_epoch_ms)
            .await;
        owner_transaction.rollback().await?;
        response
    }

    async fn lock_run_evidence(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        request: &DevelopComposerRunRequestV2,
        read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2> {
        let research = self
            .lock_research_for_locator(
                transaction,
                &request.research_custody_reference,
                read_cut_epoch_ms,
            )
            .await?;
        let bindings = self
            .binding_owner
            .lock_for_run(transaction, request, read_cut_epoch_ms)
            .await?;
        Ok(DevelopComposerLockedEvidenceV2 { research, bindings })
    }

    async fn lock_research_for_locator(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        research_request_locator: &str,
        read_cut_epoch_ms: u64,
    ) -> Result<CurrentResearchDevelopCustodyV2, DevelopComposerTerminalV2> {
        let custody = admit_research_custody_in_transaction(
            transaction,
            ResearchCustodyLookupV1::RequestV2(research_request_locator),
        )
        .await
        .map_err(|_| research_unavailable())?
        .ok_or_else(research_unavailable)?;
        CurrentResearchDevelopCustodyV2::from_verified(
            &custody,
            research_request_locator,
            read_cut_epoch_ms,
        )
    }

    async fn lock_resolve_evidence(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        locator: &DevelopComposerDurableEvidenceLocatorV2,
        read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2> {
        let custodies = admit_all_research_custodies_in_transaction(transaction)
            .await
            .map_err(|_| research_unavailable())?;
        let mut matches = Vec::new();
        for custody in custodies {
            if durable_research_identities(&custody).is_some_and(|(request, intent)| {
                request == locator.research_request_identity && intent == locator.intent_identity
            }) {
                matches.push(custody);
            }
        }
        let [custody] = matches.try_into().map_err(|_| {
            DevelopComposerTerminalV2::unavailable(
                "research_custody",
                "durable Composer identity does not uniquely match current canonical Research custody",
            )
        })?;
        let request_locator = custody.receipt().request_identity.clone();
        let research = CurrentResearchDevelopCustodyV2::from_verified(
            &custody,
            &request_locator,
            read_cut_epoch_ms,
        )?;
        let bindings = self
            .binding_owner
            .lock_for_resolve(transaction, locator, read_cut_epoch_ms)
            .await?;
        Ok(DevelopComposerLockedEvidenceV2 { research, bindings })
    }
}

/// Fixed A2 assembly: sealed Market Data Owner, sealed A0 builder, and an internally selected
/// process-wide monotonic realtime clock.
///
/// Database endpoints remain infrastructure inputs. There is deliberately no provider selector,
/// Market fact/receipt/locator argument, A0 builder argument, or clock argument.
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub struct SealedPostgresSourceResearchComposerV2 {
    inner: PostgresSourceResearchComposerV2<SealedSourceResearchComposerBindingOwnerV2>,
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
impl SealedPostgresSourceResearchComposerV2 {
    pub async fn connect(
        rd_owner_database_url: &str,
        rd_fact_writer_database_url: &str,
    ) -> Result<Self, sqlx::Error> {
        Ok(Self {
            inner: PostgresSourceResearchComposerV2::connect(
                rd_owner_database_url,
                rd_fact_writer_database_url,
                SealedSourceResearchComposerBindingOwnerV2,
            )
            .await?,
        })
    }

    pub async fn request_projection(
        &self,
        research_request_locator: &str,
    ) -> Result<SourceResearchComposerRequestProjectionV2, sqlx::Error> {
        self.inner
            .request_projection(research_request_locator)
            .await
    }

    pub async fn run(
        &self,
        research_request_locator: &str,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        self.inner
            .run(
                &mut SealedSourceResearchComposerA0BuildV2,
                research_request_locator,
            )
            .await
    }

    pub async fn run_with_acceptance_control(
        &self,
        research_request_locator: &str,
        control: SourceResearchComposerAcceptanceControlV2,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        self.inner
            .run_with_acceptance_control(
                &mut SealedSourceResearchComposerA0BuildV2,
                research_request_locator,
                Some(control),
            )
            .await
    }

    pub async fn resolve(
        &self,
        request_identity: &str,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        self.inner.resolve(request_identity).await
    }

    pub async fn resolve_with_acceptance_tamper(
        &self,
        request_identity: &str,
        tamper: SourceResearchComposerAcceptanceTamperV2,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        self.inner
            .resolve_with_acceptance_tamper(request_identity, Some(tamper))
            .await
    }
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn composer_terminal_protocol(terminal: DevelopComposerTerminalV2) -> sqlx::Error {
    sqlx::Error::Protocol(format!("{}: {}", terminal.coordinate, terminal.reason))
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn terminal_response_for_locator(
    research_request_locator: &str,
    terminal: DevelopComposerTerminalV2,
) -> DevelopComposerOperationResponseV2 {
    let mut hasher = Sha256::new();
    hasher.update(b"rd.develop.request-identity.v2\0");
    hasher.update(research_request_locator.as_bytes());
    let request_identity = source_research_composer_request_identity_v2(
        BindingDigest::from_untrusted_bytes(hasher.finalize().into()),
    );
    terminal_response_for_identity(&request_identity, terminal)
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn terminal_response_for_request(
    request: &DevelopComposerRunRequestV2,
    terminal: DevelopComposerTerminalV2,
) -> DevelopComposerOperationResponseV2 {
    terminal_response_for_identity(&request.request_identity, terminal)
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
fn terminal_response_for_identity(
    request_identity: &str,
    terminal: DevelopComposerTerminalV2,
) -> DevelopComposerOperationResponseV2 {
    DevelopComposerOperationResponseV2 {
        schema_version: 2,
        request_identity: request_identity.to_owned(),
        disposition: match terminal.kind {
            crate::develop_composer_v2::DevelopComposerTerminalKindV2::Conflict => {
                crate::develop_composer_operation_v2::DevelopComposerOperationDispositionV2::Conflict
            }
            crate::develop_composer_v2::DevelopComposerTerminalKindV2::Unsupported => {
                crate::develop_composer_operation_v2::DevelopComposerOperationDispositionV2::Unsupported
            }
            crate::develop_composer_v2::DevelopComposerTerminalKindV2::NeedsResearchRefinement => {
                crate::develop_composer_operation_v2::DevelopComposerOperationDispositionV2::NeedsResearchRefinement
            }
            crate::develop_composer_v2::DevelopComposerTerminalKindV2::Unavailable => {
                crate::develop_composer_operation_v2::DevelopComposerOperationDispositionV2::Unavailable
            }
        },
        receipt_identity: None,
        artifact: None,
        coordinate: Some(terminal.coordinate),
        reason: Some(terminal.reason),
    }
}

#[cfg(all(test, feature = "sealed-source-intake-composer-acceptance"))]
fn reject_non_sealed_source_research_composer_request_v2(
    request: &DevelopComposerRunRequestV2,
) -> Option<DevelopComposerOperationResponseV2> {
    (request != &sealed_source_research_composer_request_v2()).then(|| {
        conflict_response(
            &request.request_identity,
            "sealed_acceptance.source_research_composer_request",
        )
    })
}

fn current_read_cut_epoch_ms() -> u64 {
    LiveClock::default().timestamp_ms()
}

#[derive(Clone)]
struct LockedOwnerEvidenceV2 {
    locked: Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2>,
}

impl DevelopComposerFinalEvidencePortV2 for LockedOwnerEvidenceV2 {
    fn lock_and_reread(
        &self,
        request: &DevelopComposerRunRequestV2,
        _design_identity: BindingDigest,
        _read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2> {
        let locked = self.locked.clone()?;
        if request.research_custody_reference != locked.research.request_locator() {
            return Err(research_unavailable());
        }
        Ok(locked)
    }

    fn lock_and_reread_durable(
        &self,
        locator: &DevelopComposerDurableEvidenceLocatorV2,
        _read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2> {
        let locked = self.locked.clone()?;
        if locator.research_request_identity != locked.research.research_request_identity()
            || locator.intent_identity != locked.research.intent_identity()
        {
            return Err(research_unavailable());
        }
        Ok(locked)
    }
}

/// Derives only the immutable census keys. Positive custody still comes exclusively from
/// `CurrentResearchDevelopCustodyV2::from_verified` after the census is uniquely matched.
fn durable_research_identities(
    custody: &VerifiedResearchCustodyV1,
) -> Option<(BindingDigest, BindingDigest)> {
    let request_identity = domain_digest(
        b"rd.develop.request-identity.v2\0",
        custody.receipt().request_identity.as_bytes(),
    );
    let FrozenResearchGoalIntent::V2(intent) = custody.intent()? else {
        return None;
    };
    let intent_identity = parse_digest_suffix(&intent.intent_identity, "rd-research-intent-v2-")?;
    Some((request_identity, intent_identity))
}

fn parse_digest_suffix(value: &str, prefix: &str) -> Option<BindingDigest> {
    let hex = value.strip_prefix(prefix)?;
    if hex.len() != 64 {
        return None;
    }
    let mut bytes = [0_u8; 32];
    for (index, chunk) in hex.as_bytes().chunks_exact(2).enumerate() {
        bytes[index] = (hex_nibble(chunk[0])? << 4) | hex_nibble(chunk[1])?;
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

fn research_unavailable() -> DevelopComposerTerminalV2 {
    DevelopComposerTerminalV2::unavailable(
        "research_custody",
        "current canonical Research Owner custody is unavailable",
    )
}

#[cfg(all(test, feature = "sealed-source-intake-composer-acceptance"))]
mod tests {
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering as AtomicOrdering},
    };

    use super::*;

    static A0_COUNTER_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn test_locked_evidence(
        research: CurrentResearchDevelopCustodyV2,
        request: &DevelopComposerRunRequestV2,
    ) -> DevelopComposerLockedEvidenceV2 {
        let bindings = crate::strategy_plan_v2::verified_strategy_input_bindings_for_test(
            &request.design,
            request
                .design
                .inputs
                .iter()
                .cloned()
                .enumerate()
                .map(|(index, input)| {
                    (
                        input,
                        BindingDigest::from_untrusted_bytes([index as u8 + 1; 32]),
                    )
                })
                .collect(),
        );
        DevelopComposerLockedEvidenceV2 { research, bindings }
    }

    struct OrderedEvidenceV2 {
        locked: DevelopComposerLockedEvidenceV2,
        reads: Arc<AtomicUsize>,
    }

    impl DevelopComposerFinalEvidencePortV2 for OrderedEvidenceV2 {
        fn lock_and_reread(
            &self,
            _request: &DevelopComposerRunRequestV2,
            _design_identity: BindingDigest,
            _read_cut_epoch_ms: u64,
        ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2> {
            self.reads.fetch_add(1, AtomicOrdering::SeqCst);
            Ok(self.locked.clone())
        }

        fn lock_and_reread_durable(
            &self,
            _locator: &DevelopComposerDurableEvidenceLocatorV2,
            _read_cut_epoch_ms: u64,
        ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2> {
            unreachable!("not used by this two-phase unit boundary")
        }
    }

    struct OrderedA0BuilderV2 {
        reads: Arc<AtomicUsize>,
    }

    impl DevelopComposerA0BuildPortV2 for OrderedA0BuilderV2 {
        fn build(
            &mut self,
            manifest: &PluginManifestV2,
            capsule: &UntrustedDevelopPluginCapsuleV2,
        ) -> Result<VerifiedDevelopPluginBuildReadV2, DevelopComposerTerminalV2> {
            assert_eq!(self.reads.load(AtomicOrdering::SeqCst), 1);
            SealedSourceResearchComposerA0BuildV2.build(manifest, capsule)
        }
    }

    #[test]
    fn runtime_projection_derives_all_lineage_from_canonical_research() {
        let first = CurrentResearchDevelopCustodyV2::fixture(
            "runtime-research-1",
            "runtime falsifier 1",
            31,
        );
        let second = CurrentResearchDevelopCustodyV2::fixture(
            "runtime-research-2",
            "runtime falsifier 2",
            32,
        );
        let first_request =
            derive_source_research_composer_request_v2(&first).expect("first derived request");
        let second_request =
            derive_source_research_composer_request_v2(&second).expect("second derived request");
        let first_projection = project_source_research_composer_request_v2(&first, &first_request)
            .expect("first projection");
        let second_projection =
            project_source_research_composer_request_v2(&second, &second_request)
                .expect("second projection");

        assert_eq!(first_request.design.falsifier, "runtime falsifier 1");
        assert_eq!(second_request.design.falsifier, "runtime falsifier 2");
        assert_eq!(
            first_projection.research_custody_digest,
            first.custody_digest()
        );
        assert_eq!(
            second_projection.research_custody_digest,
            second.custody_digest()
        );
        assert_ne!(
            first_projection.request_identity,
            second_projection.request_identity
        );
        assert_ne!(
            first_projection.request_digest,
            second_projection.request_digest
        );
        assert_ne!(
            first_projection.design_identity,
            second_projection.design_identity
        );
        assert_eq!(
            first_projection.provider_identity,
            second_projection.provider_identity
        );
    }

    #[test]
    fn sealed_a2_request_has_exact_prepared_identity_roles_and_research_locator() {
        let request = sealed_source_research_composer_request_v2();
        let StrategyDesignPreparationV2::Prepared {
            design_identity, ..
        } = prepare_strategy_design_v2(&request.design)
        else {
            panic!("fixed A2 design must prepare");
        };
        assert!(
            request
                .binding_requests
                .iter()
                .all(|binding| binding.strategy_design_identity == design_identity)
        );
        assert_eq!(
            request.design.research_request_identity.as_bytes(),
            &A2_RESEARCH_REQUEST_DIGEST
        );
        assert_eq!(
            request.research_custody_reference,
            SEALED_SOURCE_INTAKE_COMPOSER_RESEARCH_REQUEST_IDENTITY_V2
        );
        assert_eq!(request.design.inputs.len(), 2);
        assert_eq!(request.binding_requests.len(), 2);
        assert!(request.design.inputs.iter().all(|role| {
            role.scope == InputScopeV2::UniverseMembers
                && role.fact_class == InputFactClassV2::MarketData
        }));
        assert_eq!(
            request
                .design
                .inputs
                .iter()
                .map(|role| role.field_semantic_id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "MARKET_DATA.BAR.CLOSE.PRICE.V1",
                "MARKET_DATA.BAR.OPEN.PRICE.V1"
            ]
        );
    }

    #[test]
    fn sealed_a2_request_identities_match_market_owner_frame_roles() {
        let request = sealed_source_research_composer_request_v2();
        let StrategyDesignPreparationV2::Prepared {
            design_identity, ..
        } = prepare_strategy_design_v2(&request.design)
        else {
            panic!("fixed A2 Design must prepare")
        };
        let authority =
            sealed_a2_market_authority(request.design.research_request_identity, design_identity)
                .expect("fixed A2 Market authority");
        let mut request_roles = request
            .binding_requests
            .iter()
            .map(|binding| {
                (
                    binding.research_request_identity,
                    binding.strategy_design_identity,
                    binding.input_role_identity,
                )
            })
            .collect::<Vec<_>>();
        let mut owner_roles = authority
            .role_bindings()
            .iter()
            .map(|binding| {
                (
                    binding.research_request_identity(),
                    binding.strategy_design_identity(),
                    binding.input_role_identity(),
                )
            })
            .collect::<Vec<_>>();
        request_roles.sort();
        owner_roles.sort();
        assert_eq!(request_roles, owner_roles);
    }

    #[test]
    fn sealed_a2_request_gate_rejects_all_same_identity_binding_mutations() {
        let sealed = sealed_source_research_composer_request_v2();
        assert!(reject_non_sealed_source_research_composer_request_v2(&sealed).is_none());

        fn assert_rejected(
            sealed: &DevelopComposerRunRequestV2,
            mutated: DevelopComposerRunRequestV2,
        ) {
            assert_eq!(mutated.request_identity, sealed.request_identity);
            let rejection = reject_non_sealed_source_research_composer_request_v2(&mutated)
                .expect("same-identity mutation must fail before PostgreSQL delegation");
            assert_eq!(rejection.request_identity, sealed.request_identity);
            assert_eq!(
                rejection.disposition,
                crate::develop_composer_operation_v2::DevelopComposerOperationDispositionV2::Conflict
            );
            assert_eq!(
                rejection.coordinate.as_deref(),
                Some("sealed_acceptance.source_research_composer_request")
            );
        }

        macro_rules! assert_binding_mutation_rejected {
            ($field:ident, $value:expr) => {{
                let mut mutated = sealed.clone();
                mutated.binding_requests[0].$field = $value;
                assert_rejected(&sealed, mutated);
            }};
        }

        let zero = BindingDigest::from_untrusted_bytes([0; 32]);
        assert_binding_mutation_rejected!(research_request_identity, zero);
        assert_binding_mutation_rejected!(strategy_design_identity, zero);
        assert_binding_mutation_rejected!(input_role_identity, zero);
        assert_binding_mutation_rejected!(
            scope,
            UntrustedStrategyInputScope::ExactInstrument {
                instrument: "AAPL.XNAS".to_owned(),
            }
        );
        assert_binding_mutation_rejected!(field_semantic, MarketDataFieldSemantic::BarHighPrice);
        assert_binding_mutation_rejected!(channel, StrategyInputChannel::Reference);
        assert_binding_mutation_rejected!(timeframe, "1H".to_owned());
        assert_binding_mutation_rejected!(unit, StrategyInputUnit::Quantity);
        assert_binding_mutation_rejected!(scale, 3);
        assert_binding_mutation_rejected!(pit_request_identity, zero);
        assert_binding_mutation_rejected!(pit_request_digest, zero);
        assert_binding_mutation_rejected!(snapshot_identity, zero);
        assert_binding_mutation_rejected!(snapshot_fact_digest, zero);
        assert_binding_mutation_rejected!(observation_batch_digest, zero);
        assert_binding_mutation_rejected!(source_binding_identity, zero);
        assert_binding_mutation_rejected!(source_frontier_digest, zero);
        assert_binding_mutation_rejected!(correction_frontier_digest, zero);
        assert_binding_mutation_rejected!(instrument_master_digest, zero);
        assert_binding_mutation_rejected!(universe_selection_digest, zero);
        assert_binding_mutation_rejected!(market_semantics_identity, zero);
        assert_binding_mutation_rejected!(decision_cut, 41);

        let mut duplicated_role = sealed.clone();
        duplicated_role.binding_requests[1] = duplicated_role.binding_requests[0].clone();
        assert_rejected(&sealed, duplicated_role);

        let mut reordered_roles = sealed.clone();
        reordered_roles.binding_requests.swap(0, 1);
        assert_rejected(&sealed, reordered_roles);
    }

    #[test]
    fn sealed_a2_request_gate_rejects_every_top_level_mutation() {
        let sealed = sealed_source_research_composer_request_v2();

        let mut changed_identity = sealed.clone();
        changed_identity.request_identity.push_str("-changed");
        assert!(reject_non_sealed_source_research_composer_request_v2(&changed_identity).is_some());

        for mutated in [
            {
                let mut request = sealed.clone();
                request.research_custody_reference.push_str("-changed");
                request
            },
            {
                let mut request = sealed.clone();
                request.design.falsifier.push_str(" changed");
                request
            },
            {
                let mut request = sealed.clone();
                request.binding_requests.pop();
                request
            },
            {
                let mut request = sealed.clone();
                request.plugin_source_capsules[0]
                    .language
                    .push_str("-changed");
                request
            },
        ] {
            assert_eq!(mutated.request_identity, sealed.request_identity);
            assert!(reject_non_sealed_source_research_composer_request_v2(&mutated).is_some());
        }
    }

    #[test]
    fn dedicated_a2_a0_verifier_accepts_exact_corpus_and_rejects_single_mutations() {
        let request = sealed_source_research_composer_request_v2();
        let manifest = &request.design.plugins[0];
        let capsule = &request.plugin_source_capsules[0];
        let module =
            include_bytes!("../fixtures/source_research_composer_sealed_a0_v2/module.wasm");
        let receipt =
            include_bytes!("../fixtures/source_research_composer_sealed_a0_v2/build_receipt.bin");

        crate::develop_plugin_build_v2::verify_source_research_composer_sealed_corpus_artifacts_for_test_v2(
            manifest,
            capsule,
            module,
            receipt,
        )
        .expect("exact dedicated A2 A0 corpus");

        let mut changed_manifest = manifest.clone();
        changed_manifest.max_fuel -= 1;
        assert!(
            crate::develop_plugin_build_v2::verify_source_research_composer_sealed_corpus_artifacts_for_test_v2(
                &changed_manifest,
                capsule,
                module,
                receipt,
            )
            .is_err()
        );

        let mut changed_capsule = capsule.clone();
        changed_capsule.files[0].bytes.push(b' ');
        assert!(
            crate::develop_plugin_build_v2::verify_source_research_composer_sealed_corpus_artifacts_for_test_v2(
                manifest,
                &changed_capsule,
                module,
                receipt,
            )
            .is_err()
        );

        let mut changed_module = module.to_vec();
        changed_module[0] ^= 1;
        assert!(
            crate::develop_plugin_build_v2::verify_source_research_composer_sealed_corpus_artifacts_for_test_v2(
                manifest,
                capsule,
                &changed_module,
                receipt,
            )
            .is_err()
        );

        let mut changed_receipt = receipt.to_vec();
        changed_receipt[0] ^= 1;
        assert!(
            crate::develop_plugin_build_v2::verify_source_research_composer_sealed_corpus_artifacts_for_test_v2(
                manifest,
                capsule,
                module,
                &changed_receipt,
            )
            .is_err()
        );

        assert!(
            crate::develop_plugin_build_v2::verify_sealed_corpus_artifacts_for_test_v2(
                manifest, capsule, module, receipt,
            )
            .is_err(),
            "existing six-role A1/W3 corpus verifier must reject the dedicated A2 corpus"
        );
    }

    #[test]
    fn fixed_a2_a0_builder_counts_each_actual_invocation_once() {
        let _guard = A0_COUNTER_TEST_LOCK.lock().expect("A0 counter test lock");
        let request = sealed_source_research_composer_request_v2();
        let before = sealed_source_research_composer_a0_execution_count_v2();
        SealedSourceResearchComposerA0BuildV2
            .build(
                &request.design.plugins[0],
                &request.plugin_source_capsules[0],
            )
            .expect("fixed A2 A0 build");
        assert_eq!(
            sealed_source_research_composer_a0_execution_count_v2(),
            before + 1
        );
    }

    #[test]
    fn prepared_a0_is_built_between_initial_and_final_evidence_reads() {
        let _guard = A0_COUNTER_TEST_LOCK.lock().expect("A0 counter test lock");
        let research = CurrentResearchDevelopCustodyV2::fixture(
            "prepared-a0-order",
            "prepared A0 order falsifier",
            47,
        );
        let request =
            derive_source_research_composer_request_v2(&research).expect("derived request");
        let reads = Arc::new(AtomicUsize::new(0));
        let evidence = OrderedEvidenceV2 {
            locked: test_locked_evidence(research, &request),
            reads: reads.clone(),
        };
        let preflight = crate::develop_composer_operation_v2::preflight_develop_composer_v2(
            &evidence, &request, 47,
        )
        .expect("preflight");
        let before = sealed_source_research_composer_a0_execution_count_v2();
        let prepared = crate::develop_composer_operation_v2::prepare_develop_composer_a0_v2(
            &mut OrderedA0BuilderV2 {
                reads: reads.clone(),
            },
            &request,
            preflight,
        )
        .expect("one prepared A0");
        assert_eq!(
            sealed_source_research_composer_a0_execution_count_v2(),
            before + 1
        );
        let final_locked = evidence
            .lock_and_reread(&request, prepared.design_identity(), 47)
            .expect("final reread");
        let _ = crate::develop_composer_operation_v2::finish_positive_record_from_prepared_a0_v2(
            &request,
            prepared,
            final_locked,
        );
        assert_eq!(reads.load(AtomicOrdering::SeqCst), 2);
    }

    #[test]
    fn prepared_a0_rejects_postbuild_owner_drift_before_positive_construction() {
        let _guard = A0_COUNTER_TEST_LOCK.lock().expect("A0 counter test lock");
        let research = CurrentResearchDevelopCustodyV2::fixture(
            "prepared-a0-drift",
            "prepared A0 drift falsifier",
            51,
        );
        let request =
            derive_source_research_composer_request_v2(&research).expect("derived request");
        let initial = test_locked_evidence(research, &request);
        let evidence = LockedOwnerEvidenceV2 {
            locked: Ok(initial.clone()),
        };
        let preflight = crate::develop_composer_operation_v2::preflight_develop_composer_v2(
            &evidence, &request, 51,
        )
        .expect("preflight");
        let prepared = crate::develop_composer_operation_v2::prepare_develop_composer_a0_v2(
            &mut SealedSourceResearchComposerA0BuildV2,
            &request,
            preflight,
        )
        .expect("prepared A0");
        let mut drifted = initial;
        drifted.research = CurrentResearchDevelopCustodyV2::fixture(
            "prepared-a0-drift-changed",
            "changed after A0",
            52,
        );
        let terminal =
            match crate::develop_composer_operation_v2::finish_positive_record_from_prepared_a0_v2(
                &request, prepared, drifted,
            ) {
                Ok(_) => panic!("postbuild drift must reject before a positive record exists"),
                Err(terminal) => terminal,
            };
        assert_eq!(terminal.coordinate, "final_evidence");
    }

    #[test]
    #[ignore = "regenerates the dedicated A2 sealed A0 corpus from the admitted Darwin producer"]
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn regenerate_source_research_composer_sealed_a0_corpus_from_real_producer() {
        let request = sealed_source_research_composer_request_v2();
        let (module, receipt) =
            crate::develop_plugin_build_v2::generate_sealed_corpus_artifacts_v2(
                &request.design.plugins[0],
                &request.plugin_source_capsules[0],
            )
            .expect("real fixed-corpus A2 build");
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures/source_research_composer_sealed_a0_v2");
        std::fs::create_dir_all(&root).expect("dedicated A2 fixture directory");
        std::fs::write(root.join("module.wasm"), module).expect("dedicated A2 module fixture");
        std::fs::write(root.join("build_receipt.bin"), receipt)
            .expect("dedicated A2 receipt fixture");
    }

    #[test]
    fn sealed_a2_market_authority_is_repeatable_and_rejects_identity_substitution() {
        let request = sealed_source_research_composer_request_v2();
        let StrategyDesignPreparationV2::Prepared {
            design_identity, ..
        } = prepare_strategy_design_v2(&request.design)
        else {
            panic!("fixed A2 Design must prepare")
        };
        let first =
            sealed_a2_market_authority(request.design.research_request_identity, design_identity)
                .expect("fixed A2 Market authority");
        let second =
            sealed_a2_market_authority(request.design.research_request_identity, design_identity)
                .expect("replayed A2 Market authority");
        assert_eq!(first, second);

        let role = first
            .role_bindings()
            .first()
            .expect("fixed A2 authority has roles");
        verify_sealed_a2_market_authority(
            &first,
            role.research_request_identity(),
            role.strategy_design_identity(),
        )
        .expect("fixed identities bind the sealed frame");

        assert!(
            verify_sealed_a2_market_authority(
                &first,
                BindingDigest::from_untrusted_bytes([0; 32]),
                role.strategy_design_identity(),
            )
            .is_err()
        );
        assert!(
            verify_sealed_a2_market_authority(
                &first,
                role.research_request_identity(),
                BindingDigest::from_untrusted_bytes([0; 32]),
            )
            .is_err()
        );
    }

    #[test]
    fn every_closed_acceptance_tamper_changes_the_derived_request_digest() {
        let canonical = sealed_source_research_composer_request_v2();
        let canonical_digest = request_digest(&canonical);
        for selector in SourceResearchComposerAcceptanceTamperV2::ALL {
            let mut tampered = canonical.clone();
            tamper_source_research_composer_request_v2(&mut tampered, selector)
                .expect("fixed A2 input is present");
            assert_ne!(request_digest(&tampered), canonical_digest, "{selector:?}");
        }
    }
}
