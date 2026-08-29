//! Minimal Strategy Factory product boundary.
//!
//! It owns the frozen intent, deterministic artifact, restricted Wasm boundary,
//! and the thin application adapter into existing data and trading-engine owners.

mod application;
pub mod artifact;
pub mod artifact_build;
pub mod artifact_build_postgres;
pub mod artifact_build_sandbox;
#[allow(dead_code)]
pub mod artifact_v2;
mod binance_program_application;
mod binance_program_data;
#[allow(dead_code)]
mod cargo_artifact;
#[allow(dead_code)]
mod complex_strategy_compiler;
#[cfg(test)]
mod complex_strategy_compiler_tests;
pub mod complex_strategy_develop_evaluation;
mod complex_strategy_ir;
#[cfg(test)]
mod complex_strategy_ir_tests;
#[allow(dead_code)]
mod complex_strategy_program;
#[cfg(test)]
mod complex_strategy_program_tests;
mod decision;
#[allow(
    dead_code,
    reason = "durable Composer RUN is reachable only from the compile-time sealed acceptance composition"
)]
pub mod develop_composer_operation_v2;
#[cfg(test)]
mod develop_composer_operation_v2_tests;
#[allow(
    dead_code,
    reason = "durable Composer PostgreSQL RUN is reachable only from the sealed acceptance composition"
)]
pub mod develop_composer_postgres_v2;
pub mod develop_composer_sealed_acceptance_v2;
#[allow(
    dead_code,
    reason = "crate-local Develop Composer awaits an admitted durable composition root"
)]
pub mod develop_composer_v2;
#[cfg(test)]
mod develop_composer_v2_tests;
#[allow(dead_code)]
mod develop_plugin_build_v2;
mod develop_plugin_build_v2_sandbox;
#[cfg(test)]
mod develop_plugin_build_v2_tests;
mod dual_tsmom;
mod experiment;
pub mod exploratory_replay;
mod family;
mod family_adapters;
mod formation_adapters;
mod holdout;
pub mod intent;
#[allow(
    dead_code,
    reason = "prepared Native Replay awaits native Instrument Master and complete Owner readbacks"
)]
mod native_replay_v2;
pub use native_replay_v2::{
    PreparedProgramHostCapabilityV2, ProgramPreparationFaultV2,
    prepare_program_host_from_owner_readbacks_v2,
};
mod pairs_relative_value;
pub mod pilot;
pub mod plugin_wire_v2;
mod producer;
pub mod product_edge;
pub mod product_edge_postgres;
#[allow(dead_code)]
mod program_host;
#[allow(dead_code)]
mod program_host_backtest_target_set_v2;
#[allow(dead_code)]
mod program_host_backtest_v2;
pub use program_host_backtest_v2::{
    StatefulBacktestNativeReplayEvidenceV2, run_stateful_backtest_native_replay_v2,
};
pub mod program_host_v2;
mod program_host_v2_backtest_tests;
#[cfg(all(test, feature = "sealed-strategy-input-acceptance"))]
mod program_host_v2_target_set_backtest_tests;
#[cfg(test)]
mod program_host_v2_tests;
mod program_project;
mod program_runtime;
pub mod program_runtime_v2;
mod program_session;
mod rd_owner_postgres_custody;
pub mod receipt;
mod representative;
mod research;
mod robustness;
mod software_control;
pub mod source_intake;
pub mod status;
pub mod strategy_design_v2;
#[cfg(test)]
mod strategy_design_v2_tests;
pub mod strategy_plan_v2;
#[cfg(test)]
mod strategy_plan_v2_tests;
mod successor;
pub mod trial_family;
pub mod trial_family_postgres;

pub use application::{
    RepresentativeSourceRoots, recover_frozen_complex_formation_status,
    recover_frozen_dual_tsmom_formation_status,
    recover_frozen_pairs_relative_value_formation_status, recover_frozen_pilot_status,
    recover_frozen_representative_formation_status, recover_frozen_secac_formation_status,
    recover_representative_program_control, run_frozen_complex_formation,
    run_frozen_dual_tsmom_formation, run_frozen_pairs_relative_value_formation, run_frozen_pilot,
    run_frozen_representative_formation, run_representative_program_control,
};
pub use complex_strategy_ir::{
    COMPLEX_STRATEGY_IR_SCHEMA_V1, COMPLEX_STRATEGY_IR_SCHEMA_VERSION_V1, ComplexStrategyIrError,
    ComplexStrategyIrV1,
};
pub use family::{FrozenStrategyFamily, ResearchIntent, StrategyFamilyError, StrategyTrial};
pub use holdout::{
    RepresentativeHoldoutIntegrity, RepresentativeHoldoutPhase, RepresentativeHoldoutStatus,
    recover_representative_2024_holdout_status, verify_representative_holdout_sources,
};
pub use producer::NativeProducerVerificationRequest;
pub use program_project::{
    FrozenProgramProject, ResearchIntentProposal, StrategyProjectProposal,
    materialize_strategy_project_scaffold, seal_strategy_project_proposal,
};
pub use receipt::{
    FormationFamilyDisposition, FormationFamilyReceipt, FormationTrialDisposition,
    RepresentativeProgramControlReceipt,
};
pub use research::{
    ObservationFrame, ObservationFrameDisposition, ObservationFrameError, ObservationFrameGate,
    ObservationFrameIneligibility, ObservationStamp, REPRESENTATIVE_EXPERIMENT_ID,
    REPRESENTATIVE_INTENT_ID, REPRESENTATIVE_INTENT_SHA256,
    ResearchIntent as RepresentativeResearchIntent, ResearchIntentError,
};
pub use software_control::verify_representative_software_control;
pub use status::{
    ResearchEvidenceReference, ResearchPhase, ResearchStatusSnapshot, SelectedFormationCandidate,
};
