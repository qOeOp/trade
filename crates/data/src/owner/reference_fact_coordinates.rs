//! Shared validation primitives for native reference-fact authorities.
//!
//! This module owns no business fact and constructs no Replay value. It only makes the coordinate,
//! canonical-byte, complete-manifest, and write-once custody invariants common to the specialized
//! Market Data authorities that consume it.

#![allow(
    dead_code,
    reason = "the native reference-fact authorities are delivered by successor slices"
)]

use sha2::{Digest, Sha256};

use super::source_binding::BindingDigest;

pub(crate) mod r0;

const MAX_IDENTITY_BYTES: usize = 256;
const MAX_STREAM_IDENTITY_BYTES: usize = 512;
const MAX_CANONICAL_FACT_BYTES: usize = 64 * 1024;
const MAX_CANONICAL_CUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_FACTS_PER_CUT: usize = 16_384;

const FACT_DOMAIN: &[u8] = b"market-data-native-reference-fact-v1\0";
const CUT_DOMAIN: &[u8] = b"market-data-native-reference-cut-v1\0";
const RECEIPT_DOMAIN: &[u8] = b"market-data-native-reference-receipt-v1\0";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub(crate) enum NativeReferenceFactKindV1 {
    Calendar = 1,
    Session = 2,
    TimeZone = 3,
    MarketSemantics = 4,
    CorrectionPolicy = 5,
    CorporateAction = 6,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ReferenceFactCoordinateErrorV1 {
    MissingIdentity,
    InvalidPitCut,
    InvalidReplayInterval,
    SourceUnavailable,
    InvalidSourceFrontier,
    InvalidCorrectionFrontier,
    InvalidEffectiveInterval,
    InvalidAvailabilityOrder,
    FutureObservation,
    IncomparableClock,
    InvalidCanonicalBytes,
    DigestMismatch,
    IncompleteCut,
    NonCanonicalManifest,
    CapacityExceeded,
    InvalidCustody,
    CustodyCrossSplice,
    AppendSequenceOverflow,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactClockV1 {
    pub(crate) clock_identity: Box<[u8]>,
    pub(crate) clock_epoch: Box<[u8]>,
    pub(crate) monotonic_sequence: u64,
    pub(crate) wall_observed: u64,
    pub(crate) decision_cut: u64,
    pub(crate) valid_through: u64,
    pub(crate) head_identity: BindingDigest,
    pub(crate) head_digest: BindingDigest,
    pub(crate) restart_continuity_digest: BindingDigest,
    pub(crate) uncertainty_bound: u64,
    pub(crate) skew_bound: u64,
    pub(crate) comparison_rule: u8,
    pub(crate) epoch_proof_identity: Option<BindingDigest>,
    pub(crate) epoch_proof_digest: Option<BindingDigest>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactPitCutV1 {
    pub(crate) snapshot_identity: BindingDigest,
    pub(crate) fact_digest: BindingDigest,
    pub(crate) decision_cut: u64,
    pub(crate) observed_at: u64,
    pub(crate) valid_through: u64,
    pub(crate) clock: ReferenceFactClockV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactFrontierV1 {
    pub(crate) stream_identity: Box<[u8]>,
    pub(crate) cut_identity: Box<[u8]>,
    pub(crate) sequence: u64,
    pub(crate) digest: BindingDigest,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AdmittedReferenceFactSourceV1 {
    pub(crate) binding_identity: BindingDigest,
    pub(crate) binding_fact_digest: BindingDigest,
    pub(crate) lineage_root: BindingDigest,
    pub(crate) lineage_version: u64,
    pub(crate) admitted: bool,
    pub(crate) frontier: ReferenceFactFrontierV1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactEffectiveTimeV1 {
    pub(crate) effective_from_ns: i128,
    pub(crate) effective_until_ns: Option<i128>,
    pub(crate) provider_available_ns: i128,
    pub(crate) retrieval_ns: i128,
    pub(crate) correction_publication_ns: i128,
    pub(crate) owner_observation_ns: i128,
    pub(crate) decision_cut: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactCoordinateClaimV1 {
    pub(crate) pit: ReferenceFactPitCutV1,
    pub(crate) replay_start_event_ns: i128,
    pub(crate) replay_end_event_ns_exclusive: i128,
    pub(crate) source: AdmittedReferenceFactSourceV1,
    pub(crate) correction: ReferenceFactFrontierV1,
    pub(crate) time: ReferenceFactEffectiveTimeV1,
    pub(crate) fact_clock: ReferenceFactClockV1,
    pub(crate) predecessor_identity: Option<BindingDigest>,
    pub(crate) stable_correlation: BindingDigest,
}

/// Validated coordinate projection shared by, but not authoritative for, native reference facts.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct VerifiedReferenceFactCoordinatesV1(ReferenceFactCoordinateClaimV1);

impl VerifiedReferenceFactCoordinatesV1 {
    pub(crate) fn verify(
        claim: ReferenceFactCoordinateClaimV1,
    ) -> Result<Self, ReferenceFactCoordinateErrorV1> {
        validate_pit(&claim.pit)?;
        if claim.replay_start_event_ns >= claim.replay_end_event_ns_exclusive {
            return Err(ReferenceFactCoordinateErrorV1::InvalidReplayInterval);
        }
        validate_source(&claim.source)?;
        validate_frontier(&claim.correction, false)?;
        validate_time(
            claim.time,
            &claim.pit,
            claim.replay_start_event_ns,
            claim.replay_end_event_ns_exclusive,
        )?;
        validate_clock(&claim.fact_clock)?;
        if claim.fact_clock != claim.pit.clock
            || claim.pit.clock.wall_observed != claim.pit.observed_at
            || claim.pit.clock.decision_cut != claim.pit.decision_cut
            || claim.pit.clock.valid_through != claim.pit.valid_through
        {
            return Err(ReferenceFactCoordinateErrorV1::IncomparableClock);
        }
        require_digest(claim.stable_correlation)?;
        if let Some(predecessor) = claim.predecessor_identity {
            require_digest(predecessor)?;
        }
        Ok(Self(claim))
    }

    pub(crate) const fn claim(&self) -> &ReferenceFactCoordinateClaimV1 {
        &self.0
    }
}

pub(crate) fn verified_coordinates_from_r0_v1(
    r0: &r0::ReferenceFactR0ReadbackV1,
) -> Result<VerifiedReferenceFactCoordinatesV1, ReferenceFactCoordinateErrorV1> {
    let record = r0.record();
    let evidence = &record.evidence;
    let clock = ReferenceFactClockV1 {
        clock_identity: evidence.clock_identity.clone(),
        clock_epoch: evidence.clock_epoch.clone(),
        monotonic_sequence: evidence.clock_sequence,
        wall_observed: evidence.clock_wall_observed,
        decision_cut: evidence.clock_decision_cut,
        valid_through: evidence.clock_valid_through,
        head_identity: evidence.clock_head_identity,
        head_digest: evidence.clock_head_digest,
        restart_continuity_digest: evidence.restart_continuity_digest,
        uncertainty_bound: evidence.uncertainty_bound,
        skew_bound: evidence.skew_bound,
        comparison_rule: 1,
        epoch_proof_identity: None,
        epoch_proof_digest: None,
    };
    VerifiedReferenceFactCoordinatesV1::verify(ReferenceFactCoordinateClaimV1 {
        pit: ReferenceFactPitCutV1 {
            snapshot_identity: evidence.pit_snapshot_identity,
            fact_digest: evidence.pit_fact_digest,
            decision_cut: evidence.clock_decision_cut,
            observed_at: evidence.clock_wall_observed,
            valid_through: evidence.clock_valid_through,
            clock: clock.clone(),
        },
        replay_start_event_ns: record.replay_start_event_ns,
        replay_end_event_ns_exclusive: record.replay_end_event_ns_exclusive,
        source: AdmittedReferenceFactSourceV1 {
            binding_identity: evidence.source_binding_identity,
            binding_fact_digest: evidence.source_binding_fact_digest,
            lineage_root: evidence.source_binding_lineage_root,
            lineage_version: evidence.source_binding_lineage_version,
            admitted: true,
            frontier: ReferenceFactFrontierV1 {
                stream_identity: evidence.source_frontier_stream_identity.clone(),
                cut_identity: evidence.source_frontier_cut_identity.clone(),
                sequence: evidence.source_frontier_sequence,
                digest: evidence.source_frontier_digest,
            },
        },
        correction: ReferenceFactFrontierV1 {
            stream_identity: evidence.correction_frontier_stream_identity.clone(),
            cut_identity: evidence.correction_frontier_cut_identity.clone(),
            sequence: evidence.correction_frontier_sequence,
            digest: evidence.correction_frontier_digest,
        },
        time: ReferenceFactEffectiveTimeV1 {
            effective_from_ns: record.effective_from_ns,
            effective_until_ns: record.effective_until_ns,
            provider_available_ns: record.provider_available_ns,
            retrieval_ns: record.retrieval_ns,
            correction_publication_ns: record.correction_publication_ns,
            owner_observation_ns: record.owner_observation_ns,
            decision_cut: record.decision_cut,
        },
        fact_clock: clock,
        predecessor_identity: record.predecessor_identity,
        stable_correlation: record.stable_correlation,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct VerifiedReferenceFactCanonicalV1 {
    kind: NativeReferenceFactKindV1,
    bytes: Box<[u8]>,
    identity: BindingDigest,
}

impl VerifiedReferenceFactCanonicalV1 {
    pub(crate) fn verify(
        kind: NativeReferenceFactKindV1,
        bytes: impl Into<Box<[u8]>>,
        claimed_identity: BindingDigest,
    ) -> Result<Self, ReferenceFactCoordinateErrorV1> {
        let bytes = bytes.into();
        if bytes.is_empty() {
            return Err(ReferenceFactCoordinateErrorV1::InvalidCanonicalBytes);
        }

        if bytes.len() > MAX_CANONICAL_FACT_BYTES {
            return Err(ReferenceFactCoordinateErrorV1::CapacityExceeded);
        }

        if fact_identity(kind, &bytes) != claimed_identity {
            return Err(ReferenceFactCoordinateErrorV1::DigestMismatch);
        }
        Ok(Self {
            kind,
            bytes,
            identity: claimed_identity,
        })
    }

    pub(crate) fn derive_identity(kind: NativeReferenceFactKindV1, bytes: &[u8]) -> BindingDigest {
        fact_identity(kind, bytes)
    }

    pub(crate) const fn kind(&self) -> NativeReferenceFactKindV1 {
        self.kind
    }

    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub(crate) const fn identity(&self) -> BindingDigest {
        self.identity
    }
}

pub(crate) fn verify_reference_fact_predecessor_v1(
    coordinates: &VerifiedReferenceFactCoordinatesV1,
    fact: &VerifiedReferenceFactCanonicalV1,
) -> Result<(), ReferenceFactCoordinateErrorV1> {
    if coordinates
        .claim()
        .predecessor_identity
        .is_some_and(|predecessor| predecessor == fact.identity())
    {
        Err(ReferenceFactCoordinateErrorV1::CustodyCrossSplice)
    } else {
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ReferenceFactCutCompletenessV1 {
    NonEmpty,
    ExplicitEmpty,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactCutManifestClaimV1 {
    pub(crate) kind: NativeReferenceFactKindV1,
    pub(crate) scope_identity: BindingDigest,
    pub(crate) decision_cut: u64,
    pub(crate) completeness: ReferenceFactCutCompletenessV1,
    pub(crate) fact_identities: Box<[BindingDigest]>,
    pub(crate) canonical_bytes: Box<[u8]>,
    pub(crate) claimed_identity: BindingDigest,
}

/// Canonically ordered, complete cut manifest. Specialized authorities decide whether empty is legal.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct VerifiedReferenceFactCutManifestV1 {
    kind: NativeReferenceFactKindV1,
    scope_identity: BindingDigest,
    decision_cut: u64,
    fact_identities: Box<[BindingDigest]>,
    canonical_bytes: Box<[u8]>,
    identity: BindingDigest,
}

impl VerifiedReferenceFactCutManifestV1 {
    pub(crate) fn verify(
        claim: ReferenceFactCutManifestClaimV1,
        explicit_empty_allowed: bool,
    ) -> Result<Self, ReferenceFactCoordinateErrorV1> {
        require_digest(claim.scope_identity)?;
        if claim.decision_cut == 0 {
            return Err(ReferenceFactCoordinateErrorV1::InvalidPitCut);
        }

        if claim.fact_identities.len() > MAX_FACTS_PER_CUT
            || claim.canonical_bytes.len() > MAX_CANONICAL_CUT_BYTES
        {
            return Err(ReferenceFactCoordinateErrorV1::CapacityExceeded);
        }

        if claim.canonical_bytes.is_empty() {
            return Err(ReferenceFactCoordinateErrorV1::InvalidCanonicalBytes);
        }
        let empty = claim.fact_identities.is_empty();
        match (empty, claim.completeness, explicit_empty_allowed) {
            (false, ReferenceFactCutCompletenessV1::NonEmpty, _) => {}
            (true, ReferenceFactCutCompletenessV1::ExplicitEmpty, true) => {}
            _ => return Err(ReferenceFactCoordinateErrorV1::IncompleteCut),
        }
        let mut previous = None;

        for identity in &claim.fact_identities {
            require_digest(*identity)?;
            if previous.is_some_and(|value| value >= *identity) {
                return Err(ReferenceFactCoordinateErrorV1::NonCanonicalManifest);
            }
            previous = Some(*identity);
        }
        let expected = cut_identity(
            claim.kind,
            claim.scope_identity,
            claim.decision_cut,
            claim.completeness,
            &claim.fact_identities,
            &claim.canonical_bytes,
        )?;

        if expected != claim.claimed_identity {
            return Err(ReferenceFactCoordinateErrorV1::DigestMismatch);
        }
        Ok(Self {
            kind: claim.kind,
            scope_identity: claim.scope_identity,
            decision_cut: claim.decision_cut,
            fact_identities: claim.fact_identities,
            canonical_bytes: claim.canonical_bytes,
            identity: expected,
        })
    }

    pub(crate) fn derive_identity(
        kind: NativeReferenceFactKindV1,
        scope_identity: BindingDigest,
        decision_cut: u64,
        completeness: ReferenceFactCutCompletenessV1,
        fact_identities: &[BindingDigest],
        canonical_bytes: &[u8],
    ) -> Result<BindingDigest, ReferenceFactCoordinateErrorV1> {
        cut_identity(
            kind,
            scope_identity,
            decision_cut,
            completeness,
            fact_identities,
            canonical_bytes,
        )
    }

    pub(crate) const fn kind(&self) -> NativeReferenceFactKindV1 {
        self.kind
    }

    pub(crate) const fn scope_identity(&self) -> BindingDigest {
        self.scope_identity
    }

    pub(crate) const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }

    pub(crate) fn fact_identities(&self) -> &[BindingDigest] {
        &self.fact_identities
    }

    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub(crate) const fn identity(&self) -> BindingDigest {
        self.identity
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactCustodyClaimV1 {
    pub(crate) kind: NativeReferenceFactKindV1,
    pub(crate) store_generation_identity: BindingDigest,
    pub(crate) request_identity: BindingDigest,
    pub(crate) request_meaning_digest: BindingDigest,
    pub(crate) cut_identity: BindingDigest,
    pub(crate) stable_correlation: BindingDigest,
    pub(crate) append_sequence: u64,
    pub(crate) receipt_identity: BindingDigest,
    pub(crate) outbox_identity: BindingDigest,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct VerifiedReferenceFactCustodyV1(ReferenceFactCustodyClaimV1);

impl VerifiedReferenceFactCustodyV1 {
    pub(crate) fn verify(
        claim: ReferenceFactCustodyClaimV1,
    ) -> Result<Self, ReferenceFactCoordinateErrorV1> {
        for identity in [
            claim.store_generation_identity,
            claim.request_identity,
            claim.request_meaning_digest,
            claim.cut_identity,
            claim.stable_correlation,
        ] {
            require_digest(identity)?;
        }

        if claim.append_sequence == 0 {
            return Err(ReferenceFactCoordinateErrorV1::InvalidCustody);
        }
        let receipt = receipt_identity(
            claim.kind,
            claim.store_generation_identity,
            claim.request_identity,
            claim.request_meaning_digest,
            claim.cut_identity,
            claim.stable_correlation,
            claim.append_sequence,
        );

        if claim.receipt_identity != receipt || claim.outbox_identity != receipt {
            return Err(ReferenceFactCoordinateErrorV1::CustodyCrossSplice);
        }
        Ok(Self(claim))
    }

    pub(crate) fn derive_identities(
        kind: NativeReferenceFactKindV1,
        store_generation_identity: BindingDigest,
        request_identity: BindingDigest,
        request_meaning_digest: BindingDigest,
        cut_identity: BindingDigest,
        stable_correlation: BindingDigest,
        append_sequence: u64,
    ) -> (BindingDigest, BindingDigest) {
        let receipt = receipt_identity(
            kind,
            store_generation_identity,
            request_identity,
            request_meaning_digest,
            cut_identity,
            stable_correlation,
            append_sequence,
        );
        (receipt, receipt)
    }

    pub(crate) const fn claim(&self) -> &ReferenceFactCustodyClaimV1 {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ReferenceFactCustodyJoinV1 {
    ExactReplay,
    Conflict,
}

pub(crate) fn classify_custody_join_v1(
    stored: &VerifiedReferenceFactCustodyV1,
    proposed: &VerifiedReferenceFactCustodyV1,
) -> ReferenceFactCustodyJoinV1 {
    if stored == proposed {
        ReferenceFactCustodyJoinV1::ExactReplay
    } else {
        ReferenceFactCustodyJoinV1::Conflict
    }
}

pub(crate) fn next_append_sequence_v1(current: u64) -> Result<u64, ReferenceFactCoordinateErrorV1> {
    current
        .checked_add(1)
        .ok_or(ReferenceFactCoordinateErrorV1::AppendSequenceOverflow)
}

fn validate_pit(pit: &ReferenceFactPitCutV1) -> Result<(), ReferenceFactCoordinateErrorV1> {
    require_digest(pit.snapshot_identity)?;
    require_digest(pit.fact_digest)?;
    validate_clock(&pit.clock)?;
    if pit.decision_cut == 0
        || pit.observed_at != pit.decision_cut
        || pit.valid_through <= pit.observed_at
        || pit.clock.monotonic_sequence == 0
    {
        return Err(ReferenceFactCoordinateErrorV1::InvalidPitCut);
    }
    Ok(())
}

fn validate_source(
    source: &AdmittedReferenceFactSourceV1,
) -> Result<(), ReferenceFactCoordinateErrorV1> {
    if !source.admitted {
        return Err(ReferenceFactCoordinateErrorV1::SourceUnavailable);
    }

    for identity in [
        source.binding_identity,
        source.binding_fact_digest,
        source.lineage_root,
    ] {
        require_digest(identity)?;
    }

    if source.lineage_version == 0 {
        return Err(ReferenceFactCoordinateErrorV1::InvalidSourceFrontier);
    }
    validate_frontier(&source.frontier, true)
}

fn validate_frontier(
    frontier: &ReferenceFactFrontierV1,
    source: bool,
) -> Result<(), ReferenceFactCoordinateErrorV1> {
    if frontier.stream_identity.is_empty()
        || frontier.stream_identity.len() > MAX_STREAM_IDENTITY_BYTES
        || frontier.sequence == 0
        || frontier.cut_identity.is_empty()
        || frontier.cut_identity.len() > MAX_IDENTITY_BYTES
        || require_digest(frontier.digest).is_err()
    {
        return Err(if source {
            ReferenceFactCoordinateErrorV1::InvalidSourceFrontier
        } else {
            ReferenceFactCoordinateErrorV1::InvalidCorrectionFrontier
        });
    }
    Ok(())
}

fn validate_clock(clock: &ReferenceFactClockV1) -> Result<(), ReferenceFactCoordinateErrorV1> {
    if clock.clock_identity.is_empty()
        || clock.clock_epoch.is_empty()
        || clock.clock_identity.len() > MAX_IDENTITY_BYTES
        || clock.clock_epoch.len() > MAX_IDENTITY_BYTES
        || clock.monotonic_sequence == 0
        || clock.wall_observed == 0
        || clock.decision_cut == 0
        || clock.valid_through <= clock.wall_observed
        || clock.decision_cut > clock.wall_observed
        || clock.skew_bound == 0
        || clock.uncertainty_bound > clock.skew_bound
        || clock.comparison_rule != 1
    {
        return Err(ReferenceFactCoordinateErrorV1::IncomparableClock);
    }
    require_digest(clock.head_identity)
        .and_then(|()| require_digest(clock.head_digest))
        .and_then(|()| require_digest(clock.restart_continuity_digest))
        .and_then(
            |()| match (clock.epoch_proof_identity, clock.epoch_proof_digest) {
                (None, None) => Ok(()),
                (Some(identity), Some(digest)) => {
                    require_digest(identity).and_then(|()| require_digest(digest))
                }
                _ => Err(ReferenceFactCoordinateErrorV1::IncomparableClock),
            },
        )
        .map_err(|_| ReferenceFactCoordinateErrorV1::IncomparableClock)
}

fn validate_time(
    time: ReferenceFactEffectiveTimeV1,
    pit: &ReferenceFactPitCutV1,
    replay_start: i128,
    replay_end: i128,
) -> Result<(), ReferenceFactCoordinateErrorV1> {
    if time
        .effective_until_ns
        .is_some_and(|until| until <= time.effective_from_ns)
    {
        return Err(ReferenceFactCoordinateErrorV1::InvalidEffectiveInterval);
    }
    let overlaps = time.effective_from_ns < replay_end
        && time
            .effective_until_ns
            .is_none_or(|until| until > replay_start);
    if !overlaps {
        return Err(ReferenceFactCoordinateErrorV1::InvalidEffectiveInterval);
    }

    if time.provider_available_ns <= 0
        || time.retrieval_ns <= 0
        || time.correction_publication_ns <= 0
        || time.owner_observation_ns <= 0
        || time.provider_available_ns > time.retrieval_ns
        || time.correction_publication_ns > time.retrieval_ns
        || time.retrieval_ns > time.owner_observation_ns
        || time.decision_cut != pit.decision_cut
    {
        return Err(ReferenceFactCoordinateErrorV1::InvalidAvailabilityOrder);
    }
    let pit_observed = i128::from(pit.observed_at);
    if time.provider_available_ns > pit_observed
        || time.retrieval_ns > pit_observed
        || time.correction_publication_ns > pit_observed
        || time.owner_observation_ns > pit_observed
    {
        return Err(ReferenceFactCoordinateErrorV1::FutureObservation);
    }
    Ok(())
}

fn require_digest(identity: BindingDigest) -> Result<(), ReferenceFactCoordinateErrorV1> {
    if identity.as_bytes() == &[0; 32] {
        Err(ReferenceFactCoordinateErrorV1::MissingIdentity)
    } else {
        Ok(())
    }
}

fn cut_identity(
    kind: NativeReferenceFactKindV1,
    scope_identity: BindingDigest,
    decision_cut: u64,
    completeness: ReferenceFactCutCompletenessV1,
    fact_identities: &[BindingDigest],
    canonical_bytes: &[u8],
) -> Result<BindingDigest, ReferenceFactCoordinateErrorV1> {
    let count = u32::try_from(fact_identities.len())
        .map_err(|_| ReferenceFactCoordinateErrorV1::CapacityExceeded)?;
    let mut encoded =
        Vec::with_capacity(1 + 32 + 8 + 1 + 4 + fact_identities.len() * 32 + canonical_bytes.len());
    encoded.push(kind as u8);
    encoded.extend_from_slice(scope_identity.as_bytes());
    encoded.extend_from_slice(&decision_cut.to_le_bytes());
    encoded.push(match completeness {
        ReferenceFactCutCompletenessV1::NonEmpty => 1,
        ReferenceFactCutCompletenessV1::ExplicitEmpty => 2,
    });
    encoded.extend_from_slice(&count.to_le_bytes());
    for identity in fact_identities {
        encoded.extend_from_slice(identity.as_bytes());
    }
    encoded.extend_from_slice(canonical_bytes);
    Ok(digest(CUT_DOMAIN, &encoded))
}

fn receipt_identity(
    kind: NativeReferenceFactKindV1,
    store_generation_identity: BindingDigest,
    request_identity: BindingDigest,
    request_meaning_digest: BindingDigest,
    cut_identity: BindingDigest,
    stable_correlation: BindingDigest,
    append_sequence: u64,
) -> BindingDigest {
    let mut encoded = Vec::with_capacity(1 + 32 * 5 + 8);
    encoded.push(kind as u8);
    encoded.extend_from_slice(store_generation_identity.as_bytes());
    encoded.extend_from_slice(request_identity.as_bytes());
    encoded.extend_from_slice(request_meaning_digest.as_bytes());
    encoded.extend_from_slice(cut_identity.as_bytes());
    encoded.extend_from_slice(stable_correlation.as_bytes());
    encoded.extend_from_slice(&append_sequence.to_le_bytes());
    digest(RECEIPT_DOMAIN, &encoded)
}

fn fact_identity(kind: NativeReferenceFactKindV1, bytes: &[u8]) -> BindingDigest {
    let mut encoded = Vec::with_capacity(1 + bytes.len());
    encoded.push(kind as u8);
    encoded.extend_from_slice(bytes);
    digest(FACT_DOMAIN, &encoded)
}

fn digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

#[cfg(test)]
mod tests;
