//! Deterministic Backtest-owned boundary for replaying a shared lifecycle program.

mod adapter;
mod result;
mod source;

pub use adapter::{
    AdapterFaultV1, ConsumedProgramIdentitiesV1, HostLifecycleOutcomeV1, LifecycleProgramHost,
    SimExchangeFillObservationV1, SimulatedOrderAssociationV1, SimulatedOrderIntentV1,
    StrategyReplayAdapterV1,
};
pub use result::{CanonicalStrategyReplayResultV1, StrategyReplayResultFaultV1};
pub use source::{
    LifecycleSourceEvidenceV1, NormalizedLifecycleEventV1, SourceNormalizationFaultV1,
    StrategyReplaySourceV1,
};

pub type DigestV1 = [u8; 32];
pub type IdentityV1 = [u8; 16];

pub(crate) fn digest(domain: &[u8], parts: &[&[u8]]) -> DigestV1 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    for part in parts {
        hasher.update(&((*part).len() as u64).to_le_bytes());
        hasher.update(part);
    }
    *hasher.finalize().as_bytes()
}

pub(crate) fn identity(domain: &[u8], parts: &[&[u8]]) -> IdentityV1 {
    let value = digest(domain, parts);
    value[..16]
        .try_into()
        .expect("digest prefix has fixed length")
}

pub(crate) fn is_zero(bytes: &[u8]) -> bool {
    bytes.iter().all(|byte| *byte == 0)
}
