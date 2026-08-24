//! Sealed Shared Time clock-head evidence produced by the Market Data Owner.
//!
//! The public surface is deliberately read-only. A caller may submit an untrusted exact locator,
//! inspect a verified sealed handoff, and ask the Owner to verify one direct successor. It cannot
//! construct a positive handoff or proof, select a store, mint a head, or walk predecessor links.
//!
//! ```compile_fail
//! use vibe_data::owner::shared_time_evidence::ClockHeadHandoff;
//!
//! let forged = ClockHeadHandoff {};
//! ```
//!
//! ```compile_fail
//! use vibe_data::owner::postgres::MarketDataOwnerPostgres;
//! ```

use std::fmt::Display;

use serde::{Deserialize, Serialize};

use super::source_binding::{
    BindingDigest, MarketDataClockAdmission, MarketDataClockComparisonRule,
};

const HEAD_IDENTITY_DOMAIN: &[u8] = b"vibe.market-data.shared-time.head-identity.v1";
const HEAD_DIGEST_DOMAIN: &[u8] = b"vibe.market-data.shared-time.head-digest.v1";
const EPOCH_PROOF_IDENTITY_DOMAIN: &[u8] = b"vibe.market-data.shared-time.epoch-successor-proof.v1";

/// Untrusted content-addressed clock-head locator.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct UntrustedClockHeadLocator {
    head_identity: BindingDigest,
    head_digest: BindingDigest,
}

impl UntrustedClockHeadLocator {
    /// Wraps caller-supplied locator fields. Construction grants no Owner authority.
    pub const fn from_untrusted(head_identity: BindingDigest, head_digest: BindingDigest) -> Self {
        Self {
            head_identity,
            head_digest,
        }
    }

    /// Returns the claimed head identity.
    pub const fn head_identity(&self) -> BindingDigest {
        self.head_identity
    }

    /// Returns the claimed head digest.
    pub const fn head_digest(&self) -> BindingDigest {
        self.head_digest
    }
}

/// Market Data's immutable, content-addressed clock-head handoff.
///
/// This value is serializable for downstream evidence binding but intentionally cannot be
/// constructed or deserialized outside the Owner resolver.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ClockHeadHandoff {
    head_identity: BindingDigest,
    head_digest: BindingDigest,
    clock_identity: String,
    clock_epoch: String,
    monotonic_sequence: u64,
    wall_observed: u64,
    decision_cut: u64,
    valid_through: u64,
    restart_continuity_digest: BindingDigest,
    uncertainty_bound: u64,
    skew_bound: u64,
    comparison_rule: ClockHeadComparisonRule,
    #[serde(skip)]
    locator: UntrustedClockHeadLocator,
}

impl ClockHeadHandoff {
    /// Returns the immutable semantic head identity.
    pub const fn head_identity(&self) -> BindingDigest {
        self.head_identity
    }

    /// Returns the immutable content digest.
    pub const fn head_digest(&self) -> BindingDigest {
        self.head_digest
    }

    /// Returns the stable clock identity.
    pub fn clock_identity(&self) -> &str {
        &self.clock_identity
    }

    /// Returns the clock epoch identity.
    pub fn clock_epoch(&self) -> &str {
        &self.clock_epoch
    }

    /// Returns the positive monotonic sequence within this epoch.
    pub const fn monotonic_sequence(&self) -> u64 {
        self.monotonic_sequence
    }

    /// Returns the wall observation cut.
    pub const fn wall_observed(&self) -> u64 {
        self.wall_observed
    }

    /// Returns the decision cut.
    pub const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }

    /// Returns the exclusive validity boundary.
    pub const fn valid_through(&self) -> u64 {
        self.valid_through
    }

    /// Returns the restart-continuity digest.
    pub const fn restart_continuity_digest(&self) -> BindingDigest {
        self.restart_continuity_digest
    }

    /// Returns the admitted uncertainty bound.
    pub const fn uncertainty_bound(&self) -> u64 {
        self.uncertainty_bound
    }

    /// Returns the maximum admitted skew bound.
    pub const fn skew_bound(&self) -> u64 {
        self.skew_bound
    }

    /// Returns the comparison rule.
    pub const fn comparison_rule(&self) -> ClockHeadComparisonRule {
        self.comparison_rule
    }

    /// Returns an untrusted locator suitable only for exact Owner resolution.
    pub const fn locator(&self) -> &UntrustedClockHeadLocator {
        &self.locator
    }
}

/// The only supported clock-head comparison rule.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub enum ClockHeadComparisonRule {
    /// `valid_through` is an exclusive boundary.
    ExclusiveValidThrough,
}

/// Direct immutable proof for exactly one epoch transition.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct EpochSuccessorProof {
    pub(crate) proof_identity: BindingDigest,
    pub(crate) predecessor_head_digest: BindingDigest,
    pub(crate) successor_head_digest: BindingDigest,
    pub(crate) prior_clock_identity: String,
    pub(crate) prior_clock_epoch: String,
    pub(crate) successor_clock_identity: String,
    pub(crate) successor_clock_epoch: String,
    pub(crate) successor_continuity_digest: BindingDigest,
    pub(crate) commit_cut: u64,
    pub(crate) comparison_rule: ClockHeadComparisonRule,
}

impl EpochSuccessorProof {
    /// Returns the content-derived proof identity.
    pub const fn proof_identity(&self) -> BindingDigest {
        self.proof_identity
    }

    /// Returns the exact predecessor head digest.
    pub const fn predecessor_head_digest(&self) -> BindingDigest {
        self.predecessor_head_digest
    }

    /// Returns the exact successor head digest.
    pub const fn successor_head_digest(&self) -> BindingDigest {
        self.successor_head_digest
    }

    /// Returns the prior clock identity.
    pub fn prior_clock_identity(&self) -> &str {
        &self.prior_clock_identity
    }

    /// Returns the prior epoch identity.
    pub fn prior_clock_epoch(&self) -> &str {
        &self.prior_clock_epoch
    }

    /// Returns the successor clock identity.
    pub fn successor_clock_identity(&self) -> &str {
        &self.successor_clock_identity
    }

    /// Returns the successor epoch identity.
    pub fn successor_clock_epoch(&self) -> &str {
        &self.successor_clock_epoch
    }

    /// Returns the successor continuity digest.
    pub const fn successor_continuity_digest(&self) -> BindingDigest {
        self.successor_continuity_digest
    }

    /// Returns the proof commit cut.
    pub const fn commit_cut(&self) -> u64 {
        self.commit_cut
    }

    /// Returns the comparison rule shared by both heads.
    pub const fn comparison_rule(&self) -> ClockHeadComparisonRule {
        self.comparison_rule
    }
}

/// One exact direct transition resolved from Market Data custody.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ClockHeadSuccessorReadback {
    handoff: ClockHeadHandoff,
    epoch_successor_proof: Option<EpochSuccessorProof>,
}

impl ClockHeadSuccessorReadback {
    /// Returns the verified successor handoff.
    pub const fn handoff(&self) -> &ClockHeadHandoff {
        &self.handoff
    }

    /// Returns the mandatory direct proof for an epoch change and no proof within one epoch.
    pub const fn epoch_successor_proof(&self) -> Option<&EpochSuccessorProof> {
        self.epoch_successor_proof.as_ref()
    }
}

/// Public read-only Shared Time consumer port.
#[async_trait::async_trait]
pub trait SharedTimeEvidenceResolver: Send + Sync {
    /// Resolves one exact immutable head. This does not authorize a consumer transition.
    async fn resolve_clock_head(
        &self,
        locator: &UntrustedClockHeadLocator,
    ) -> Result<ClockHeadHandoff, SharedTimeEvidenceError>;

    /// Resolves exactly one direct successor from the caller's prior sealed handoff.
    async fn resolve_clock_successor(
        &self,
        prior: &ClockHeadHandoff,
        successor: &UntrustedClockHeadLocator,
    ) -> Result<ClockHeadSuccessorReadback, SharedTimeEvidenceError>;
}

/// Fail-closed Shared Time persistence or resolution error.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SharedTimeEvidenceError {
    /// A required head field is incomplete or invalid.
    InvalidHead,
    /// The requested transition does not name the direct current predecessor.
    PriorHandoffMismatch,
    /// A same-epoch successor did not strictly advance every required cut.
    SuccessorDoesNotAdvance,
    /// An epoch transition is missing, duplicated, or has an invalid direct proof.
    EpochSuccessorProofMismatch,
    /// The same content identity was associated with conflicting stored meaning.
    ReplayConflict,
    /// The exact locator or sealed native record does not match.
    LocatorMismatch,
    /// Native Owner custody is unavailable or malformed.
    StoreUnavailable,
    /// A test fault interrupted the transaction before commit.
    CommitInterrupted,
    /// Commit succeeded but the response was lost; exact retry can recover it.
    ResponseLost,
}

impl Display for SharedTimeEvidenceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for SharedTimeEvidenceError {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ClockHeadFact {
    pub(crate) predecessor_head_digest: Option<BindingDigest>,
    pub(crate) handoff: ClockHeadHandoff,
}

pub(crate) fn build_head_fact(
    clock: &MarketDataClockAdmission,
    predecessor_head_digest: Option<BindingDigest>,
) -> Result<ClockHeadFact, SharedTimeEvidenceError> {
    if !clock.is_complete() {
        return Err(SharedTimeEvidenceError::InvalidHead);
    }
    let head_identity = digest(HEAD_IDENTITY_DOMAIN, &canonical_clock_bytes(clock));
    let head_digest = digest(
        HEAD_DIGEST_DOMAIN,
        &canonical_head_bytes(clock, predecessor_head_digest),
    );
    Ok(ClockHeadFact {
        predecessor_head_digest,
        handoff: ClockHeadHandoff {
            head_identity,
            head_digest,
            clock_identity: clock.clock_identity.clone(),
            clock_epoch: clock.clock_epoch.clone(),
            monotonic_sequence: clock.monotonic_sequence,
            wall_observed: clock.wall_observed,
            decision_cut: clock.decision_cut,
            valid_through: clock.valid_through,
            restart_continuity_digest: clock.restart_continuity_digest,
            uncertainty_bound: clock.uncertainty_bound,
            skew_bound: clock.skew_bound,
            comparison_rule: ClockHeadComparisonRule::ExclusiveValidThrough,
            locator: UntrustedClockHeadLocator {
                head_identity,
                head_digest,
            },
        },
    })
}

pub(crate) fn verify_head_fact(fact: &ClockHeadFact) -> bool {
    let clock = fact.clock();
    build_head_fact(&clock, fact.predecessor_head_digest).is_ok_and(|expected| expected == *fact)
}

pub(crate) fn validate_same_epoch_successor(
    prior: &ClockHeadFact,
    next: &MarketDataClockAdmission,
) -> Result<(), SharedTimeEvidenceError> {
    let current = prior.clock();
    let stable = next.clock_identity == current.clock_identity
        && next.clock_epoch == current.clock_epoch
        && next.restart_continuity_digest == current.restart_continuity_digest
        && next.uncertainty_bound == current.uncertainty_bound
        && next.skew_bound == current.skew_bound
        && next.comparison_rule == current.comparison_rule;
    let advances = next.monotonic_sequence > current.monotonic_sequence
        && next.wall_observed > current.wall_observed
        && next.decision_cut > current.decision_cut
        && next.valid_through > current.valid_through;
    if next.is_complete() && stable && advances {
        Ok(())
    } else {
        Err(SharedTimeEvidenceError::SuccessorDoesNotAdvance)
    }
}

pub(crate) fn validate_new_epoch_successor(
    prior: &ClockHeadFact,
    next: &MarketDataClockAdmission,
) -> Result<(), SharedTimeEvidenceError> {
    let current = prior.clock();
    let valid = next.is_complete()
        && next.clock_identity == current.clock_identity
        && next.clock_epoch != current.clock_epoch
        && next.restart_continuity_digest != current.restart_continuity_digest
        && next.wall_observed > current.wall_observed
        && next.decision_cut > current.decision_cut
        && next.valid_through > current.valid_through
        && next.comparison_rule == current.comparison_rule;

    if valid {
        Ok(())
    } else {
        Err(SharedTimeEvidenceError::EpochSuccessorProofMismatch)
    }
}

pub(crate) fn build_epoch_successor_proof(
    prior: &ClockHeadFact,
    successor: &ClockHeadFact,
) -> EpochSuccessorProof {
    let mut proof = EpochSuccessorProof {
        proof_identity: BindingDigest::from_untrusted_bytes([0; 32]),
        predecessor_head_digest: prior.handoff.head_digest,
        successor_head_digest: successor.handoff.head_digest,
        prior_clock_identity: prior.handoff.clock_identity.clone(),
        prior_clock_epoch: prior.handoff.clock_epoch.clone(),
        successor_clock_identity: successor.handoff.clock_identity.clone(),
        successor_clock_epoch: successor.handoff.clock_epoch.clone(),
        successor_continuity_digest: successor.handoff.restart_continuity_digest,
        commit_cut: successor.handoff.decision_cut,
        comparison_rule: ClockHeadComparisonRule::ExclusiveValidThrough,
    };
    proof.proof_identity = digest(EPOCH_PROOF_IDENTITY_DOMAIN, &canonical_proof_bytes(&proof));
    proof
}

pub(crate) fn verify_epoch_successor_proof(
    proof: &EpochSuccessorProof,
    prior: &ClockHeadFact,
    successor: &ClockHeadFact,
) -> bool {
    proof == &build_epoch_successor_proof(prior, successor)
        && successor.predecessor_head_digest == Some(prior.handoff.head_digest)
        && prior.handoff.clock_epoch != successor.handoff.clock_epoch
}

impl ClockHeadFact {
    pub(crate) fn clock(&self) -> MarketDataClockAdmission {
        MarketDataClockAdmission {
            cut_kind: super::source_binding::MarketDataClockCutKind::MarketDataAsOf,
            clock_identity: self.handoff.clock_identity.clone(),
            clock_epoch: self.handoff.clock_epoch.clone(),
            monotonic_sequence: self.handoff.monotonic_sequence,
            wall_observed: self.handoff.wall_observed,
            decision_cut: self.handoff.decision_cut,
            valid_through: self.handoff.valid_through,
            restart_continuity_digest: self.handoff.restart_continuity_digest,
            uncertainty_bound: self.handoff.uncertainty_bound,
            skew_bound: self.handoff.skew_bound,
            comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
        }
    }
}

pub(crate) fn successor_readback(
    handoff: ClockHeadHandoff,
    epoch_successor_proof: Option<EpochSuccessorProof>,
) -> ClockHeadSuccessorReadback {
    ClockHeadSuccessorReadback {
        handoff,
        epoch_successor_proof,
    }
}

fn canonical_clock_bytes(clock: &MarketDataClockAdmission) -> Vec<u8> {
    let mut bytes = Vec::new();
    push_string(&mut bytes, &clock.clock_identity);
    push_string(&mut bytes, &clock.clock_epoch);
    push_u64(&mut bytes, clock.monotonic_sequence);
    push_u64(&mut bytes, clock.wall_observed);
    push_u64(&mut bytes, clock.decision_cut);
    push_u64(&mut bytes, clock.valid_through);
    bytes.extend_from_slice(clock.restart_continuity_digest.as_bytes());
    push_u64(&mut bytes, clock.uncertainty_bound);
    push_u64(&mut bytes, clock.skew_bound);
    bytes.push(1);
    bytes
}

fn canonical_head_bytes(
    clock: &MarketDataClockAdmission,
    predecessor_head_digest: Option<BindingDigest>,
) -> Vec<u8> {
    let mut bytes = canonical_clock_bytes(clock);

    match predecessor_head_digest {
        Some(value) => {
            bytes.push(1);
            bytes.extend_from_slice(value.as_bytes());
        }
        None => bytes.push(0),
    }
    bytes
}

fn canonical_proof_bytes(proof: &EpochSuccessorProof) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(proof.predecessor_head_digest.as_bytes());
    bytes.extend_from_slice(proof.successor_head_digest.as_bytes());
    push_string(&mut bytes, &proof.prior_clock_identity);
    push_string(&mut bytes, &proof.prior_clock_epoch);
    push_string(&mut bytes, &proof.successor_clock_identity);
    push_string(&mut bytes, &proof.successor_clock_epoch);
    bytes.extend_from_slice(proof.successor_continuity_digest.as_bytes());
    push_u64(&mut bytes, proof.commit_cut);
    bytes.push(1);
    bytes
}

fn push_string(bytes: &mut Vec<u8>, value: &str) {
    push_u64(bytes, value.len() as u64);
    bytes.extend_from_slice(value.as_bytes());
}

fn push_u64(bytes: &mut Vec<u8>, value: u64) {
    bytes.extend_from_slice(&value.to_be_bytes());
}

fn digest(domain: &[u8], value: &[u8]) -> BindingDigest {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(&(value.len() as u64).to_be_bytes());
    hasher.update(value);
    BindingDigest::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;
    use crate::owner::source_binding::MarketDataClockCutKind;

    fn d(byte: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([byte; 32])
    }

    fn clock(
        epoch: &str,
        sequence: u64,
        cut: u64,
        continuity: BindingDigest,
    ) -> MarketDataClockAdmission {
        MarketDataClockAdmission {
            cut_kind: MarketDataClockCutKind::MarketDataAsOf,
            clock_identity: "market-clock".into(),
            clock_epoch: epoch.into(),
            monotonic_sequence: sequence,
            wall_observed: cut,
            decision_cut: cut,
            valid_through: cut + 60,
            restart_continuity_digest: continuity,
            uncertainty_bound: 1,
            skew_bound: 2,
            comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
        }
    }

    #[rstest]
    fn head_identity_and_digest_bind_every_handoff_field() {
        let base = clock("epoch-1", 1, 100, d(1));
        let base_fact = build_head_fact(&base, None).unwrap();
        let mut variants = Vec::new();

        let mut value = base.clone();
        value.clock_identity = "other-clock".into();
        variants.push(value);
        let mut value = base.clone();
        value.clock_epoch = "epoch-2".into();
        variants.push(value);
        let mut value = base.clone();
        value.monotonic_sequence = 2;
        variants.push(value);
        let mut value = base.clone();
        value.wall_observed = 101;
        variants.push(value);
        let mut value = base.clone();
        value.decision_cut = 99;
        variants.push(value);
        let mut value = base.clone();
        value.valid_through = 161;
        variants.push(value);
        let mut value = base.clone();
        value.restart_continuity_digest = d(2);
        variants.push(value);
        let mut value = base.clone();
        value.uncertainty_bound = 0;
        variants.push(value);
        let mut value = base;
        value.skew_bound = 3;
        variants.push(value);

        for variant in variants {
            let fact = build_head_fact(&variant, None).unwrap();
            assert_ne!(
                fact.handoff.head_identity(),
                base_fact.handoff.head_identity()
            );
            assert_ne!(fact.handoff.head_digest(), base_fact.handoff.head_digest());
        }

        let linked = build_head_fact(&clock("epoch-1", 1, 100, d(1)), Some(d(9))).unwrap();
        assert_eq!(
            linked.handoff.head_identity(),
            base_fact.handoff.head_identity()
        );
        assert_ne!(
            linked.handoff.head_digest(),
            base_fact.handoff.head_digest()
        );
    }

    #[rstest]
    fn same_epoch_successor_requires_every_stable_field_and_strict_cut() {
        let mut prior_clock = clock("epoch-1", 1, 100, d(1));
        prior_clock.wall_observed = 105;
        let prior = build_head_fact(&prior_clock, None).unwrap();
        let mut valid = clock("epoch-1", 2, 101, d(1));
        valid.wall_observed = 110;
        validate_same_epoch_successor(&prior, &valid).unwrap();
        let mut variants = Vec::new();

        let mut value = valid.clone();
        value.clock_identity = "other-clock".into();
        variants.push(value);
        let mut value = valid.clone();
        value.restart_continuity_digest = d(2);
        variants.push(value);
        let mut value = valid.clone();
        value.uncertainty_bound = 0;
        variants.push(value);
        let mut value = valid.clone();
        value.skew_bound = 3;
        variants.push(value);
        let mut value = valid.clone();
        value.monotonic_sequence = 1;
        variants.push(value);
        let mut value = valid.clone();
        value.wall_observed = 105;
        variants.push(value);
        let mut value = valid.clone();
        value.decision_cut = 100;
        variants.push(value);
        let mut value = valid;
        value.valid_through = 160;
        variants.push(value);

        for variant in variants {
            assert_eq!(
                validate_same_epoch_successor(&prior, &variant),
                Err(SharedTimeEvidenceError::SuccessorDoesNotAdvance)
            );
        }
    }

    #[rstest]
    fn new_epoch_successor_requires_new_continuity_and_strict_cuts() {
        let prior = build_head_fact(&clock("epoch-1", 9, 100, d(1)), None).unwrap();
        let valid = clock("epoch-2", 1, 110, d(2));
        validate_new_epoch_successor(&prior, &valid).unwrap();

        let mut variants = Vec::new();
        let mut value = valid.clone();
        value.restart_continuity_digest = d(1);
        variants.push(value);
        let mut value = valid.clone();
        value.wall_observed = 100;
        variants.push(value);
        let mut value = valid.clone();
        value.decision_cut = 100;
        variants.push(value);
        let mut value = valid;
        value.valid_through = 160;
        variants.push(value);

        for variant in variants {
            assert_eq!(
                validate_new_epoch_successor(&prior, &variant),
                Err(SharedTimeEvidenceError::EpochSuccessorProofMismatch)
            );
        }
    }

    #[rstest]
    fn proof_identity_binds_every_direct_epoch_transition_field() {
        let prior = build_head_fact(&clock("epoch-1", 9, 100, d(1)), None).unwrap();
        let successor_clock = clock("epoch-2", 1, 110, d(2));
        validate_new_epoch_successor(&prior, &successor_clock).unwrap();
        let mut different_clock = successor_clock.clone();
        different_clock.clock_identity = "other-clock".into();
        assert_eq!(
            validate_new_epoch_successor(&prior, &different_clock),
            Err(SharedTimeEvidenceError::EpochSuccessorProofMismatch)
        );
        let successor =
            build_head_fact(&successor_clock, Some(prior.handoff.head_digest())).unwrap();
        let proof = build_epoch_successor_proof(&prior, &successor);
        assert_eq!(
            proof.proof_identity,
            digest(EPOCH_PROOF_IDENTITY_DOMAIN, &canonical_proof_bytes(&proof))
        );
        assert!(verify_epoch_successor_proof(&proof, &prior, &successor));

        let mut variants = Vec::new();
        let mut value = proof.clone();
        value.predecessor_head_digest = d(3);
        variants.push(value);
        let mut value = proof.clone();
        value.successor_head_digest = d(4);
        variants.push(value);
        let mut value = proof.clone();
        value.prior_clock_identity = "other-prior-clock".into();
        variants.push(value);
        let mut value = proof.clone();
        value.prior_clock_epoch = "other-prior-epoch".into();
        variants.push(value);
        let mut value = proof.clone();
        value.successor_clock_identity = "other-successor-clock".into();
        variants.push(value);
        let mut value = proof.clone();
        value.successor_clock_epoch = "other-successor-epoch".into();
        variants.push(value);
        let mut value = proof.clone();
        value.successor_continuity_digest = d(5);
        variants.push(value);
        let mut value = proof.clone();
        value.commit_cut += 1;
        variants.push(value);

        for variant in variants {
            assert_ne!(
                digest(
                    EPOCH_PROOF_IDENTITY_DOMAIN,
                    &canonical_proof_bytes(&variant)
                ),
                proof.proof_identity
            );
            assert!(!verify_epoch_successor_proof(&variant, &prior, &successor));
        }
    }
}
