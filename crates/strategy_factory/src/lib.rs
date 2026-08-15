//! Minimal Strategy Factory product boundary.
//!
//! It owns the frozen intent, deterministic artifact, restricted Wasm boundary,
//! and the thin application adapter into existing data and trading-engine owners.

pub mod application;
pub mod artifact;
#[allow(dead_code)]
mod cargo_artifact;
mod decision;
mod experiment;
mod family;
mod family_adapters;
mod formation_adapters;
pub mod intent;
pub mod pilot;
mod producer;
#[allow(dead_code)]
mod program_host;
mod program_runtime;
mod program_session;
mod qualification;
pub mod receipt;
mod research;
mod robustness;
mod software_control;
pub mod status;

pub use application::{
    recover_frozen_complex_formation_status, recover_frozen_complex_qualification_status,
    recover_frozen_pilot_status, run_frozen_complex_formation, run_frozen_complex_qualification,
    run_frozen_pilot,
};
pub use family::{FrozenStrategyFamily, ResearchIntent, StrategyFamilyError, StrategyTrial};
pub use producer::NativeProducerVerificationRequest;
pub use receipt::{
    FormationFamilyDisposition, FormationFamilyReceipt, FormationTrialDisposition,
    QualificationDisposition, QualificationReceipt,
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
