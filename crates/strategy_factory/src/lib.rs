//! Minimal Strategy Factory product boundary.
//!
//! It owns the frozen intent, deterministic artifact, restricted Wasm boundary,
//! and the thin application adapter into existing data and trading-engine owners.

mod application;
pub mod artifact;
pub mod artifact_build;
pub mod artifact_build_postgres;
pub mod artifact_build_sandbox;
mod binance_program_application;
mod binance_program_data;
#[allow(dead_code)]
mod cargo_artifact;
mod decision;
mod dual_tsmom;
mod experiment;
pub mod exploratory_replay;
mod family;
mod family_adapters;
mod formation_adapters;
mod holdout;
pub mod intent;
mod pairs_relative_value;
pub mod pilot;
mod producer;
pub mod product_edge;
pub mod product_edge_postgres;
#[allow(dead_code)]
mod program_host;
mod program_project;
mod program_runtime;
mod program_session;
mod rd_owner_postgres_custody;
pub mod receipt;
mod representative;
mod research;
mod robustness;
mod software_control;
pub mod status;
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
