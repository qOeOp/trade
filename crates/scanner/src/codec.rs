//! Canonical custody encoding for a Scanner terminal receipt.
//!
//! A [`ScannerReceipt`] is produced by two private constructors and has no `Deserialize`, so an
//! outside store can hold one it was handed and can never read one back. This module is the read
//! side: it encodes a committed receipt as canonical bytes and reconstructs a receipt from
//! untrusted bytes, refusing by name what does not reconstruct. The store that holds the bytes
//! lives outside this crate; nothing here depends on it.
//!
//! # Reconstruction is not re-admission
//!
//! A receipt does not retain the clock admission its attempt observed: `admit` reads
//! `ClockAdmission::Admitted.observed_at` and stores it nowhere, so the `DueSlot` cannot be
//! rebuilt and the admission cannot be re-run. Reconstruction therefore re-runs exactly the
//! predicates whose two sides are both retained - every source, frontier, scope, requirement and
//! cross-cut equality - plus the due instant, which [`crate::AttemptId::due_at`] derives from the
//! stored boundary. [`crate::InputWitness`] is where that split is enforced, and refusals from it
//! arrive as [`TerminalReceiptDecodeError::AdmissionNotWitnessed`] carrying the domain's own
//! [`InputMismatch`], so a reconstruction names the same reason admission would have named.
//!
//! What the receipt loses per fact - the clock epoch and the time evidence - it keeps as an
//! emergent receipt-level invariant: every fact in one receipt was admitted against one due slot,
//! so all of them must agree. That agreement is recomputable, no individual `admit_fact` call
//! checks it, and [`TerminalReceiptDecodeError::ClockAdmissionNotSingular`] is its refusal.
//!
//! # The canonical form cannot express an invalid receipt
//!
//! Four states are unrepresentable rather than refused, which is stronger:
//!
//! - the constructor branch is read from the membership's own tag, so the bytes cannot disagree
//!   with themselves about which constructor produced the receipt;
//! - a resolved membership encodes bindings only and rebuilds the map from
//!   [`crate::StrategyBinding::strategy`], so a key that contradicts its binding cannot be written;
//! - an unresolved membership encodes its four fields once and derives the
//!   [`crate::MembershipUnavailable`] from them, so [`DomainError::MembershipMeaningConflict`]
//!   cannot be written;
//! - every committed fact is encoded whole, so the `Missing*` variants of [`InputMismatch`], which
//!   describe a partial untrusted readback, are unreachable through this codec.
//!
//! # Canonicity
//!
//! One value has exactly one encoding. Repeated groups are written in strictly ascending key order
//! and a decoder that sees any other order refuses with
//! [`TerminalReceiptDecodeError::NotAscending`] rather than silently collapsing to the same value,
//! and a value that two constructors could produce is written under one of them only. A store may
//! therefore key on, or digest, these bytes.

use crate::{
    ActivationConditionContract, AttemptId, AttemptMeaning, BatchFailureCategory,
    BatchOperationalFailure, CandidateIndependentCapacityScope, CapacityRequirement,
    CapacityRequirementContract, CapacityViewCut, CapacityViewField, CapitalPoolAssumptions,
    CapitalPoolMethod, CommittedOwnerFact, CompatibilityCut, ContentDigest,
    DataRequirementContract, DomainError, DueSlotBoundary, EvidenceSet, FoldDisposition,
    FoldOccurrence, FrontierLineage, FrontierRequirement, GapDisposition, GovernedArtifactRef,
    InputMismatch, InputWitness, LifecycleConstraints, LocalDateTime, MarketFactCut,
    MarketFactField, MembershipMeaning, MembershipUnavailable, MisfirePolicy, ObservedMemberFact,
    OpaqueId, OwnerSource, ProposalEvidence, RecordIdentity, ScannerReceipt, ScheduleDefinition,
    SemanticScope, SnapshotAdmissionPolicy, SnapshotCut, SourceFrontier, SourceNode, SourceOwner,
    StrategyBinding, StrategyDisposition, StrategyOutcome, UniverseSelectionRequirement,
    UnixTimestamp, UntrustedCapacityViewRetentionV1, UntrustedMarketFactReadback,
    UntrustedOwnerFactRefV1, Version, VersionedIdentity,
};
use std::collections::{BTreeMap, BTreeSet};

const RECEIPT_DOMAIN: &[u8] = b"VIBE_SCANNER_TERMINAL_RECEIPT_V1";
const ATTEMPT_DOMAIN: &[u8] = b"VIBE_SCANNER_ATTEMPT_IDENTITY_V1";
const VERSION: u16 = 1;

// Raising a bound is compatible; lowering one is a breaking change, and asymmetrically so. Bytes
// already committed under a wider bound stay in custody, so a narrower reader starts refusing
// receipts that are intact and were lawfully written - the store has not changed, this build has.
const MAX_RECEIPT_BYTES: usize = 4 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 16 * 1024;
const MAX_ENTRIES: u32 = 65_536;

/// Why a committed receipt could not be written as canonical bytes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TerminalReceiptEncodeError {
    /// A disposition that neither private constructor can produce, so no canonical tag applies.
    UnreachableDisposition { strategy: OpaqueId },
    /// A field, a repeated group, or the whole encoding exceeded this codec's bound.
    CapacityExceeded { field: &'static str },
}

/// Why untrusted bytes do not reconstruct a Scanner terminal receipt.
///
/// The variants are ordered by how far the bytes got: framing, then shape, then meaning. A
/// refusal never collapses into absence, and the two that carry a domain value reuse the domain's
/// own vocabulary rather than restating it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TerminalReceiptDecodeError {
    /// The bytes do not open with this codec's domain tag; they describe some other artifact.
    ForeignDomain,
    /// The domain tag matched but the version is not one this build reconstructs.
    UnsupportedVersion { found: u16 },
    /// A field needed more bytes than remained.
    Truncated { field: &'static str },
    /// Every field decoded and bytes remain; the writer wrote more than this version defines.
    TrailingBytes { unconsumed: usize },
    /// A length-prefixed string was not UTF-8.
    MalformedText { field: &'static str },
    /// A length prefix exceeded this codec's bound.
    CapacityExceeded { field: &'static str },
    /// A tag byte outside the set this version defines for that position.
    UnknownDiscriminant { field: &'static str, code: u8 },
    /// A repeated group was not in strictly ascending key order, so it is not the canonical form.
    NotAscending { field: &'static str },
    /// A value with more than one possible encoding was written under the non-canonical one.
    NonCanonical { field: &'static str },
    /// The bytes decoded, but the Scanner domain refuses the receipt they describe.
    NotReconstructible(DomainError),
    /// The bytes decoded, but an input check the receipt still witnesses refuses them.
    AdmissionNotWitnessed(InputMismatch),
    /// Facts inside one receipt disagree about the clock admission its one attempt observed.
    ClockAdmissionNotSingular { field: &'static str },
}

impl From<DomainError> for TerminalReceiptDecodeError {
    fn from(error: DomainError) -> Self {
        Self::NotReconstructible(error)
    }
}

impl From<InputMismatch> for TerminalReceiptDecodeError {
    fn from(error: InputMismatch) -> Self {
        Self::AdmissionNotWitnessed(error)
    }
}

/// Encodes the stable custody key of one scheduled scan attempt.
///
/// A [`crate::TerminalReceiptStore`] looks receipts up by [`AttemptId`], which is a structured
/// value rather than a scalar. These bytes are that lookup key, defined here so that the key is a
/// property of the domain rather than of whichever adapter stores it.
pub fn encode_attempt_id_v1(attempt_id: &AttemptId) -> Result<Vec<u8>, TerminalReceiptEncodeError> {
    let mut encoder = Encoder::default();
    encoder.bytes("attempt_domain", ATTEMPT_DOMAIN)?;
    encoder.u16(VERSION);
    encode_attempt_id(&mut encoder, attempt_id)?;
    encoder.finish()
}

/// Encodes a committed receipt as the canonical bytes a custody store holds.
pub fn encode_terminal_receipt_v1(
    receipt: &ScannerReceipt,
) -> Result<Vec<u8>, TerminalReceiptEncodeError> {
    let mut encoder = Encoder::default();
    encoder.bytes("receipt_domain", RECEIPT_DOMAIN)?;
    encoder.u16(VERSION);
    encode_attempt_id(&mut encoder, receipt.attempt_id())?;
    encode_attempt_meaning(&mut encoder, receipt.meaning())?;

    if matches!(
        receipt.meaning().membership,
        MembershipMeaning::Resolved { .. }
    ) {
        let dispositions = receipt.dispositions();
        encoder.count("dispositions", dispositions.len())?;

        for disposition in dispositions.values() {
            encode_strategy_disposition(&mut encoder, disposition)?;
        }
        encoder.option(
            "proposal_evidence",
            receipt.proposal().map(super::Proposal::evidence),
            |encoder, evidence| {
                encode_proposal_evidence(encoder, evidence);
                Ok(())
            },
        )?;
        encoder.option(
            "operational_failure",
            receipt.status().batch_operational_failure(),
            |encoder, failure| {
                encode_batch_operational_failure(encoder, failure);
                Ok(())
            },
        )?;
    }
    encoder.finish()
}

/// Reconstructs a receipt from untrusted canonical bytes, refusing by name what does not rebuild.
pub fn parse_untrusted_terminal_receipt_v1(
    bytes: &[u8],
) -> Result<ScannerReceipt, TerminalReceiptDecodeError> {
    if bytes.len() > MAX_RECEIPT_BYTES {
        return Err(TerminalReceiptDecodeError::CapacityExceeded {
            field: "terminal_receipt",
        });
    }
    let mut decoder = Decoder::new(bytes);
    decoder.expect_domain("receipt_domain", RECEIPT_DOMAIN)?;
    let version = decoder.u16("receipt_version")?;

    if version != VERSION {
        return Err(TerminalReceiptDecodeError::UnsupportedVersion { found: version });
    }
    let attempt_id = decode_attempt_id(&mut decoder)?;
    let meaning = decode_attempt_meaning(&mut decoder)?;
    let due_at = attempt_id.due_at();
    let witness = InputWitness::reconstructing(due_at);

    let receipt = match &meaning.membership {
        MembershipMeaning::Resolved { .. } => {
            let count = decoder.count("dispositions")?;
            let mut dispositions = Vec::new();
            let mut previous: Option<OpaqueId> = None;

            for _ in 0..count {
                let disposition =
                    decode_strategy_disposition(&mut decoder, &meaning.admission_policy, witness)?;

                if previous
                    .as_ref()
                    .is_some_and(|last| last >= disposition.binding().strategy())
                {
                    return Err(TerminalReceiptDecodeError::NotAscending {
                        field: "dispositions",
                    });
                }
                previous = Some(disposition.binding().strategy().clone());
                dispositions.push(disposition);
            }
            let proposal_evidence =
                decoder.option("proposal_evidence", decode_proposal_evidence)?;
            let operational_failure =
                decoder.option("operational_failure", decode_batch_operational_failure)?;
            ScannerReceipt::complete(
                attempt_id,
                meaning,
                dispositions,
                proposal_evidence,
                operational_failure,
            )?
        }
        MembershipMeaning::Unresolved {
            disposition,
            source_cut,
            terminal_reason,
            observed,
        } => {
            let unavailable = MembershipUnavailable {
                disposition: disposition.clone(),
                source_cut: source_cut.clone(),
                terminal_reason: terminal_reason.clone(),
                observed: observed
                    .iter()
                    .map(|(strategy, evidence)| {
                        ObservedMemberFact::new(strategy.clone(), evidence.clone())
                    })
                    .collect(),
            };
            ScannerReceipt::membership_unresolved(attempt_id, meaning, unavailable)?
        }
    };
    decoder.finish()?;
    witness_singular_clock_admission(&receipt)?;
    Ok(receipt)
}

/// Refuses a receipt whose facts disagree about the one clock admission its attempt observed.
///
/// Every fact in one receipt is admitted against one `DueSlot`, so `clock_epoch` and
/// `time_evidence` are equal across all of them and every capacity cut's `admitted_at` is the same
/// instant. No `admit_fact` call sees more than one fact, so none of them can check this; it is
/// checkable only once the whole receipt is back.
fn witness_singular_clock_admission(
    receipt: &ScannerReceipt,
) -> Result<(), TerminalReceiptDecodeError> {
    let mut clock: Option<(u64, &OpaqueId)> = None;
    let mut admitted_at: Option<UnixTimestamp> = None;

    for disposition in receipt.dispositions().values() {
        let market = disposition.market_fact_cut().into_iter().flat_map(|cut| {
            [
                cut.pit_snapshot(),
                cut.universe_selection_record(),
                cut.instrument_master(),
                cut.calendar_session_time_zone(),
                cut.corporate_action(),
                cut.historical_membership(),
                cut.market_semantics_compatibility(),
            ]
        });
        let capacity = disposition
            .capacity_view_cut()
            .into_iter()
            .flat_map(|cut| [cut.account_facts(), cut.liquidity()]);

        for fact in market.chain(capacity) {
            match clock {
                None => clock = Some((fact.clock_epoch(), fact.time_evidence())),
                Some((epoch, _)) if epoch != fact.clock_epoch() => {
                    return Err(TerminalReceiptDecodeError::ClockAdmissionNotSingular {
                        field: "clock_epoch",
                    });
                }
                Some((_, evidence)) if evidence != fact.time_evidence() => {
                    return Err(TerminalReceiptDecodeError::ClockAdmissionNotSingular {
                        field: "time_evidence",
                    });
                }
                Some(_) => {}
            }
        }

        if let Some(cut) = disposition.capacity_view_cut() {
            match admitted_at {
                None => admitted_at = Some(cut.admitted_at()),
                Some(observed) if observed != cut.admitted_at() => {
                    return Err(TerminalReceiptDecodeError::ClockAdmissionNotSingular {
                        field: "admitted_at",
                    });
                }
                Some(_) => {}
            }
        }
    }
    Ok(())
}

fn encode_attempt_id(
    encoder: &mut Encoder,
    attempt_id: &AttemptId,
) -> Result<(), TerminalReceiptEncodeError> {
    encode_versioned_identity(encoder, &attempt_id.definition)?;
    encode_versioned_identity(encoder, &attempt_id.scan_scope)?;

    match &attempt_id.boundary {
        DueSlotBoundary::Normal {
            local,
            utc_offset_seconds,
        } => {
            encoder.u8(1);
            encode_local_date_time(encoder, *local);
            encoder.i32(*utc_offset_seconds);
        }
        DueSlotBoundary::Fold {
            local,
            occurrence,
            utc_offset_seconds,
        } => {
            encoder.u8(2);
            encode_local_date_time(encoder, *local);
            encoder.u8(match occurrence {
                FoldOccurrence::First => 1,
                FoldOccurrence::Second => 2,
            });
            encoder.i32(*utc_offset_seconds);
        }
        DueSlotBoundary::GapShifted {
            intended,
            shifted_to,
            utc_offset_seconds,
        } => {
            encoder.u8(3);
            encode_local_date_time(encoder, *intended);
            encode_local_date_time(encoder, *shifted_to);
            encoder.i32(*utc_offset_seconds);
        }
    }
    Ok(())
}

fn decode_attempt_id(decoder: &mut Decoder<'_>) -> Result<AttemptId, TerminalReceiptDecodeError> {
    let definition = decode_versioned_identity(decoder, "attempt_definition")?;
    let scan_scope = decode_versioned_identity(decoder, "attempt_scan_scope")?;
    let boundary = match decoder.u8("due_slot_boundary")? {
        1 => DueSlotBoundary::Normal {
            local: decode_local_date_time(decoder, "boundary_local")?,
            utc_offset_seconds: decoder.i32("boundary_utc_offset_seconds")?,
        },
        2 => DueSlotBoundary::Fold {
            local: decode_local_date_time(decoder, "boundary_local")?,
            occurrence: match decoder.u8("fold_occurrence")? {
                1 => FoldOccurrence::First,
                2 => FoldOccurrence::Second,
                code => {
                    return Err(TerminalReceiptDecodeError::UnknownDiscriminant {
                        field: "fold_occurrence",
                        code,
                    });
                }
            },
            utc_offset_seconds: decoder.i32("boundary_utc_offset_seconds")?,
        },
        3 => DueSlotBoundary::GapShifted {
            intended: decode_local_date_time(decoder, "boundary_intended")?,
            shifted_to: decode_local_date_time(decoder, "boundary_shifted_to")?,
            utc_offset_seconds: decoder.i32("boundary_utc_offset_seconds")?,
        },
        code => {
            return Err(TerminalReceiptDecodeError::UnknownDiscriminant {
                field: "due_slot_boundary",
                code,
            });
        }
    };
    Ok(AttemptId {
        definition,
        scan_scope,
        boundary,
    })
}

fn encode_attempt_meaning(
    encoder: &mut Encoder,
    meaning: &AttemptMeaning,
) -> Result<(), TerminalReceiptEncodeError> {
    encode_schedule_definition(encoder, &meaning.schedule)?;
    encode_admission_policy(encoder, &meaning.admission_policy)?;
    encode_membership_meaning(encoder, &meaning.membership)
}

fn decode_attempt_meaning(
    decoder: &mut Decoder<'_>,
) -> Result<AttemptMeaning, TerminalReceiptDecodeError> {
    Ok(AttemptMeaning {
        schedule: decode_schedule_definition(decoder)?,
        admission_policy: decode_admission_policy(decoder)?,
        membership: decode_membership_meaning(decoder)?,
    })
}

fn encode_schedule_definition(
    encoder: &mut Encoder,
    schedule: &ScheduleDefinition,
) -> Result<(), TerminalReceiptEncodeError> {
    encode_versioned_identity(encoder, &schedule.definition)?;
    encode_versioned_identity(encoder, &schedule.scan_scope)?;
    encoder.opaque_id("cadence", &schedule.cadence)?;
    encoder.opaque_id("calendar_time_zone", &schedule.calendar_time_zone)?;
    encoder.u8(match schedule.fold_disposition {
        FoldDisposition::First => 1,
        FoldDisposition::Second => 2,
        FoldDisposition::Both => 3,
    });
    encoder.u8(match schedule.gap_disposition {
        GapDisposition::Skip => 1,
        GapDisposition::ShiftForward => 2,
    });
    encoder.u8(match schedule.misfire_policy {
        MisfirePolicy::Skip => 1,
        MisfirePolicy::FireOnce => 2,
        MisfirePolicy::Backfill => 3,
    });
    encoder.opaque_id("shared_clock", &schedule.shared_clock)?;
    encoder.opaque_id("effective_interval", &schedule.effective_interval)
}

fn decode_schedule_definition(
    decoder: &mut Decoder<'_>,
) -> Result<ScheduleDefinition, TerminalReceiptDecodeError> {
    Ok(ScheduleDefinition {
        definition: decode_versioned_identity(decoder, "schedule_definition")?,
        scan_scope: decode_versioned_identity(decoder, "schedule_scan_scope")?,
        cadence: decoder.opaque_id("cadence")?,
        calendar_time_zone: decoder.opaque_id("calendar_time_zone")?,
        fold_disposition: match decoder.u8("fold_disposition")? {
            1 => FoldDisposition::First,
            2 => FoldDisposition::Second,
            3 => FoldDisposition::Both,
            code => {
                return Err(TerminalReceiptDecodeError::UnknownDiscriminant {
                    field: "fold_disposition",
                    code,
                });
            }
        },
        gap_disposition: match decoder.u8("gap_disposition")? {
            1 => GapDisposition::Skip,
            2 => GapDisposition::ShiftForward,
            code => {
                return Err(TerminalReceiptDecodeError::UnknownDiscriminant {
                    field: "gap_disposition",
                    code,
                });
            }
        },
        misfire_policy: match decoder.u8("misfire_policy")? {
            1 => MisfirePolicy::Skip,
            2 => MisfirePolicy::FireOnce,
            3 => MisfirePolicy::Backfill,
            code => {
                return Err(TerminalReceiptDecodeError::UnknownDiscriminant {
                    field: "misfire_policy",
                    code,
                });
            }
        },
        shared_clock: decoder.opaque_id("shared_clock")?,
        effective_interval: decoder.opaque_id("effective_interval")?,
    })
}

fn encode_admission_policy(
    encoder: &mut Encoder,
    policy: &SnapshotAdmissionPolicy,
) -> Result<(), TerminalReceiptEncodeError> {
    encode_versioned_identity(encoder, policy.identity())?;
    encode_owner_source(encoder, policy.market_source())?;
    encode_owner_source(encoder, policy.capacity_source())?;
    encode_frontier_requirement(encoder, policy.market_frontier())?;
    encode_frontier_requirement(encoder, policy.capacity_frontier())?;
    encoder.opaque_id("semantic_scope", policy.semantic_scope().identity())?;
    encoder.opaque_id("compatibility_cut", policy.compatibility_cut().identity())
}

fn decode_admission_policy(
    decoder: &mut Decoder<'_>,
) -> Result<SnapshotAdmissionPolicy, TerminalReceiptDecodeError> {
    Ok(SnapshotAdmissionPolicy::new(
        decode_versioned_identity(decoder, "policy_identity")?,
        decode_owner_source(decoder, "market_source")?,
        decode_owner_source(decoder, "capacity_source")?,
        decode_frontier_requirement(decoder, "market_frontier")?,
        decode_frontier_requirement(decoder, "capacity_frontier")?,
        SemanticScope::new(decoder.opaque_id("semantic_scope")?),
        CompatibilityCut::new(decoder.opaque_id("compatibility_cut")?),
    ))
}

fn encode_owner_source(
    encoder: &mut Encoder,
    source: &OwnerSource,
) -> Result<(), TerminalReceiptEncodeError> {
    encoder.opaque_id("source_owner", source.owner().identity())?;
    encoder.opaque_id("source_node", source.node().identity())
}

fn decode_owner_source(
    decoder: &mut Decoder<'_>,
    field: &'static str,
) -> Result<OwnerSource, TerminalReceiptDecodeError> {
    let _ = field;
    Ok(OwnerSource::new(
        SourceOwner::new(decoder.opaque_id("source_owner")?),
        SourceNode::new(decoder.opaque_id("source_node")?),
    ))
}

fn encode_frontier_requirement(
    encoder: &mut Encoder,
    requirement: &FrontierRequirement,
) -> Result<(), TerminalReceiptEncodeError> {
    encoder.opaque_id("frontier_lineage", requirement.lineage().identity())?;
    encoder.u64(requirement.minimum_sequence());
    Ok(())
}

fn decode_frontier_requirement(
    decoder: &mut Decoder<'_>,
    field: &'static str,
) -> Result<FrontierRequirement, TerminalReceiptDecodeError> {
    let _ = field;
    Ok(FrontierRequirement::new(
        FrontierLineage::new(decoder.opaque_id("frontier_lineage")?),
        decoder.u64("frontier_minimum_sequence")?,
    ))
}

fn encode_membership_meaning(
    encoder: &mut Encoder,
    membership: &MembershipMeaning,
) -> Result<(), TerminalReceiptEncodeError> {
    match membership {
        MembershipMeaning::Resolved {
            registry_frontier,
            expected,
        } => {
            encoder.u8(1);
            encoder.opaque_id("registry_frontier", registry_frontier)?;
            encoder.count("expected", expected.len())?;

            // The map key is `binding.strategy()`, so writing the binding alone is total and the
            // contradictory key `resolved_expected` refuses cannot be written at all.
            for binding in expected.values() {
                encode_strategy_binding(encoder, binding)?;
            }
        }
        MembershipMeaning::Unresolved {
            disposition,
            source_cut,
            terminal_reason,
            observed,
        } => {
            encoder.u8(2);
            encoder.opaque_id("membership_disposition", disposition)?;
            encoder.opaque_id("membership_source_cut", source_cut)?;
            encoder.opaque_id("membership_terminal_reason", terminal_reason)?;
            encoder.count("membership_observed", observed.len())?;

            for (strategy, evidence) in observed {
                encoder.opaque_id("observed_strategy", strategy)?;
                encode_evidence_set(encoder, evidence)?;
            }
        }
    }
    Ok(())
}

fn decode_membership_meaning(
    decoder: &mut Decoder<'_>,
) -> Result<MembershipMeaning, TerminalReceiptDecodeError> {
    match decoder.u8("membership_meaning")? {
        1 => {
            let registry_frontier = decoder.opaque_id("registry_frontier")?;
            let count = decoder.count("expected")?;
            let mut expected = BTreeMap::new();
            let mut previous: Option<OpaqueId> = None;

            for _ in 0..count {
                let binding = decode_strategy_binding(decoder)?;
                let strategy = binding.strategy().clone();

                if previous.as_ref().is_some_and(|last| *last >= strategy) {
                    return Err(TerminalReceiptDecodeError::NotAscending { field: "expected" });
                }
                previous = Some(strategy.clone());
                expected.insert(strategy, binding);
            }
            Ok(MembershipMeaning::Resolved {
                registry_frontier,
                expected,
            })
        }
        2 => {
            let disposition = decoder.opaque_id("membership_disposition")?;
            let source_cut = decoder.opaque_id("membership_source_cut")?;
            let terminal_reason = decoder.opaque_id("membership_terminal_reason")?;
            let count = decoder.count("membership_observed")?;
            let mut observed = BTreeMap::new();
            let mut previous: Option<OpaqueId> = None;

            for _ in 0..count {
                let strategy = decoder.opaque_id("observed_strategy")?;

                if previous.as_ref().is_some_and(|last| *last >= strategy) {
                    return Err(TerminalReceiptDecodeError::NotAscending {
                        field: "membership_observed",
                    });
                }
                previous = Some(strategy.clone());
                observed.insert(strategy, decode_evidence_set(decoder, "observed_evidence")?);
            }
            Ok(MembershipMeaning::Unresolved {
                disposition,
                source_cut,
                terminal_reason,
                observed,
            })
        }
        code => Err(TerminalReceiptDecodeError::UnknownDiscriminant {
            field: "membership_meaning",
            code,
        }),
    }
}

fn encode_strategy_binding(
    encoder: &mut Encoder,
    binding: &StrategyBinding,
) -> Result<(), TerminalReceiptEncodeError> {
    encoder.opaque_id("strategy", binding.strategy())?;
    encode_versioned(
        encoder,
        "artifact_ref",
        binding.artifact_ref().identity(),
        binding.artifact_ref().version(),
    )?;
    encode_versioned(
        encoder,
        "activation_condition",
        binding.activation_condition().identity(),
        binding.activation_condition().version(),
    )?;
    encode_versioned(
        encoder,
        "data_requirement",
        binding.data_requirement().identity(),
        binding.data_requirement().version(),
    )?;
    encode_versioned(
        encoder,
        "lifecycle_constraints",
        binding.lifecycle_constraints().identity(),
        binding.lifecycle_constraints().version(),
    )?;
    encode_versioned(
        encoder,
        "universe_selection",
        binding.universe_selection().identity(),
        binding.universe_selection().version(),
    )?;
    encoder.option(
        "capacity_requirement",
        binding.capacity_requirement(),
        |encoder, requirement| {
            encode_versioned(
                encoder,
                "capacity_requirement_contract",
                requirement.contract().identity(),
                requirement.contract().version(),
            )?;
            encoder.opaque_id(
                "candidate_independent_scope",
                requirement.candidate_independent_scope().identity(),
            )
        },
    )
}

fn decode_strategy_binding(
    decoder: &mut Decoder<'_>,
) -> Result<StrategyBinding, TerminalReceiptDecodeError> {
    let strategy = decoder.opaque_id("strategy")?;
    let artifact_ref = decode_versioned_identity(decoder, "artifact_ref")?;
    let activation_condition = decode_versioned_identity(decoder, "activation_condition")?;
    let data_requirement = decode_versioned_identity(decoder, "data_requirement")?;
    let lifecycle_constraints = decode_versioned_identity(decoder, "lifecycle_constraints")?;
    let universe_selection = decode_versioned_identity(decoder, "universe_selection")?;
    let capacity_requirement = decoder.option("capacity_requirement", |decoder| {
        let contract = decode_versioned_identity(decoder, "capacity_requirement_contract")?;
        Ok(CapacityRequirement::new(
            CapacityRequirementContract::new(contract.identity, contract.version),
            CandidateIndependentCapacityScope::new(
                decoder.opaque_id("candidate_independent_scope")?,
            ),
        ))
    })?;
    Ok(StrategyBinding::new(
        strategy,
        GovernedArtifactRef::new(artifact_ref.identity, artifact_ref.version),
        ActivationConditionContract::new(
            activation_condition.identity,
            activation_condition.version,
        ),
        DataRequirementContract::new(data_requirement.identity, data_requirement.version),
        LifecycleConstraints::new(
            lifecycle_constraints.identity,
            lifecycle_constraints.version,
        ),
        UniverseSelectionRequirement::new(universe_selection.identity, universe_selection.version),
        capacity_requirement,
    ))
}

fn encode_strategy_disposition(
    encoder: &mut Encoder,
    disposition: &StrategyDisposition,
) -> Result<(), TerminalReceiptEncodeError> {
    let evaluated = disposition.input_mismatch().is_none()
        && disposition.outcome() != StrategyOutcome::InputUnavailable
        && disposition.market_fact_cut().is_some();

    if evaluated {
        encoder.u8(1);
        encode_strategy_binding(encoder, disposition.binding())?;
        encoder.u8(strategy_outcome_code(disposition.outcome()));
        let market = disposition.market_fact_cut().ok_or_else(|| {
            TerminalReceiptEncodeError::UnreachableDisposition {
                strategy: disposition.binding().strategy().clone(),
            }
        })?;
        encode_market_fact_cut(encoder, market)?;
        encoder.option(
            "capacity_view_cut",
            disposition.capacity_view_cut(),
            encode_capacity_view_cut,
        )?;
        return encode_evidence_set(encoder, disposition.auxiliary());
    }

    if disposition.outcome() != StrategyOutcome::InputUnavailable {
        // `input_unavailable` stamps `InputUnavailable`, and `evaluated` needs a market cut and no
        // mismatch. A value outside both images was never produced by this crate.
        return Err(TerminalReceiptEncodeError::UnreachableDisposition {
            strategy: disposition.binding().strategy().clone(),
        });
    }

    if disposition.market_fact_cut().is_none() && disposition.capacity_view_cut().is_some() {
        // A capacity cut is admitted against the market cut it was found compatible with, so the
        // decoder refuses this pairing. Refusing it here too keeps the two exactly inverse.
        return Err(TerminalReceiptEncodeError::UnreachableDisposition {
            strategy: disposition.binding().strategy().clone(),
        });
    }
    encoder.u8(2);
    encode_strategy_binding(encoder, disposition.binding())?;
    encoder.option(
        "market_fact_cut",
        disposition.market_fact_cut(),
        encode_market_fact_cut,
    )?;
    encoder.option(
        "capacity_view_cut",
        disposition.capacity_view_cut(),
        encode_capacity_view_cut,
    )?;
    encode_evidence_set(encoder, disposition.auxiliary())?;
    encoder.option(
        "input_mismatch",
        disposition.input_mismatch().as_ref(),
        |encoder, mismatch| {
            encode_input_mismatch(encoder, *mismatch);
            Ok(())
        },
    )
}

fn decode_strategy_disposition(
    decoder: &mut Decoder<'_>,
    policy: &SnapshotAdmissionPolicy,
    witness: InputWitness<'_>,
) -> Result<StrategyDisposition, TerminalReceiptDecodeError> {
    match decoder.u8("strategy_disposition")? {
        1 => {
            let binding = decode_strategy_binding(decoder)?;
            let outcome = decode_strategy_outcome(decoder)?;

            if outcome == StrategyOutcome::InputUnavailable {
                // Both constructors can produce this value; only tag 2 is its canonical form.
                return Err(TerminalReceiptDecodeError::NonCanonical {
                    field: "strategy_disposition",
                });
            }
            let market = decode_market_fact_cut(decoder, policy, witness, &binding)?;
            let capacity = decode_capacity_view_cut(decoder, policy, witness, &binding, &market)?;
            let auxiliary = decode_evidence_set(decoder, "disposition_auxiliary")?;
            Ok(StrategyDisposition::evaluated(
                binding, outcome, market, capacity, auxiliary,
            ))
        }
        2 => {
            let binding = decode_strategy_binding(decoder)?;
            let market = decoder.option("market_fact_cut", |decoder| {
                decode_market_fact_cut(decoder, policy, witness, &binding)
            })?;
            let capacity = match &market {
                Some(market) => {
                    decode_capacity_view_cut(decoder, policy, witness, &binding, market)?
                }
                None => {
                    // A capacity cut is admitted against the market cut it was compatible with, so
                    // bytes that keep one without the other describe no admission that happened.
                    if decoder.u8("capacity_view_cut")? != 0 {
                        return Err(TerminalReceiptDecodeError::NonCanonical {
                            field: "capacity_view_cut",
                        });
                    }
                    None
                }
            };
            let auxiliary = decode_evidence_set(decoder, "disposition_auxiliary")?;
            let input_mismatch = decoder.option("input_mismatch", decode_input_mismatch)?;
            Ok(StrategyDisposition::input_unavailable(
                binding,
                market,
                capacity,
                auxiliary,
                input_mismatch,
            ))
        }
        code => Err(TerminalReceiptDecodeError::UnknownDiscriminant {
            field: "strategy_disposition",
            code,
        }),
    }
}

fn encode_market_fact_cut(
    encoder: &mut Encoder,
    cut: &MarketFactCut,
) -> Result<(), TerminalReceiptEncodeError> {
    encode_versioned(
        encoder,
        "cut_data_requirement",
        cut.data_requirement().identity(),
        cut.data_requirement().version(),
    )?;
    encode_versioned(
        encoder,
        "cut_universe_selection_requirement",
        cut.universe_selection_requirement().identity(),
        cut.universe_selection_requirement().version(),
    )?;

    for fact in [
        cut.pit_snapshot(),
        cut.universe_selection_record(),
        cut.instrument_master(),
        cut.calendar_session_time_zone(),
        cut.corporate_action(),
        cut.historical_membership(),
        cut.market_semantics_compatibility(),
    ] {
        encode_committed_owner_fact(encoder, fact)?;
    }
    encode_opaque_id_set(encoder, "market_auxiliary", cut.auxiliary())
}

fn decode_market_fact_cut(
    decoder: &mut Decoder<'_>,
    policy: &SnapshotAdmissionPolicy,
    witness: InputWitness<'_>,
    binding: &StrategyBinding,
) -> Result<MarketFactCut, TerminalReceiptDecodeError> {
    let data_requirement = decode_versioned_identity(decoder, "cut_data_requirement")?;
    let universe_selection_requirement =
        decode_versioned_identity(decoder, "cut_universe_selection_requirement")?;
    let readback = UntrustedMarketFactReadback {
        data_requirement: Some(DataRequirementContract::new(
            data_requirement.identity,
            data_requirement.version,
        )),
        universe_selection_requirement: Some(UniverseSelectionRequirement::new(
            universe_selection_requirement.identity,
            universe_selection_requirement.version,
        )),
        pit_snapshot: Some(decode_committed_owner_fact(decoder, "pit_snapshot")?),
        universe_selection_record: Some(decode_committed_owner_fact(
            decoder,
            "universe_selection_record",
        )?),
        instrument_master: Some(decode_committed_owner_fact(decoder, "instrument_master")?),
        calendar_session_time_zone: Some(decode_committed_owner_fact(
            decoder,
            "calendar_session_time_zone",
        )?),
        corporate_action: Some(decode_committed_owner_fact(decoder, "corporate_action")?),
        historical_membership: Some(decode_committed_owner_fact(
            decoder,
            "historical_membership",
        )?),
        market_semantics_compatibility: Some(decode_committed_owner_fact(
            decoder,
            "market_semantics_compatibility",
        )?),
        auxiliary: decode_opaque_id_set(decoder, "market_auxiliary")?,
    };
    Ok(MarketFactCut::reconstruct(
        policy, witness, binding, readback,
    )?)
}

fn encode_capacity_view_cut(
    encoder: &mut Encoder,
    cut: &CapacityViewCut,
) -> Result<(), TerminalReceiptEncodeError> {
    encode_versioned(
        encoder,
        "capacity_requirement_contract",
        cut.requirement_contract().identity(),
        cut.requirement_contract().version(),
    )?;
    encoder.opaque_id(
        "candidate_independent_scope",
        cut.candidate_independent_scope().identity(),
    )?;
    encode_committed_owner_fact(encoder, cut.account_facts())?;
    encode_committed_owner_fact(encoder, cut.liquidity())?;
    encode_versioned(
        encoder,
        "capital_pool_method",
        cut.capital_pool_method().identity(),
        cut.capital_pool_method().version(),
    )?;
    encode_versioned(
        encoder,
        "capital_pool_assumptions",
        cut.capital_pool_assumptions().identity(),
        cut.capital_pool_assumptions().version(),
    )?;
    encoder.i64(cut.measurement_time().seconds());
    encoder.i64(cut.valid_through().seconds());
    encoder.i64(cut.admitted_at().seconds());
    encode_opaque_id_set(encoder, "capacity_auxiliary", cut.auxiliary())
}

fn decode_capacity_view_cut(
    decoder: &mut Decoder<'_>,
    policy: &SnapshotAdmissionPolicy,
    witness: InputWitness<'_>,
    binding: &StrategyBinding,
    market: &MarketFactCut,
) -> Result<Option<CapacityViewCut>, TerminalReceiptDecodeError> {
    let present = decoder.u8("capacity_view_cut")?;

    match present {
        0 => {
            if binding.capacity_requirement().is_some() {
                // `SnapshotAdmissionPolicy::admit` refuses a binding that requires capacity and
                // reads back none, so a committed disposition never pairs the two.
                return Err(TerminalReceiptDecodeError::AdmissionNotWitnessed(
                    InputMismatch::CapacityMissing,
                ));
            }
            return Ok(None);
        }
        1 => {}
        code => {
            return Err(TerminalReceiptDecodeError::UnknownDiscriminant {
                field: "capacity_view_cut",
                code,
            });
        }
    }
    let required =
        binding
            .capacity_requirement()
            .ok_or(TerminalReceiptDecodeError::AdmissionNotWitnessed(
                InputMismatch::CapacityScope,
            ))?;
    let requirement_contract = decode_versioned_identity(decoder, "capacity_requirement_contract")?;
    let retention = UntrustedCapacityViewRetentionV1 {
        requirement_contract: Some(CapacityRequirementContract::new(
            requirement_contract.identity,
            requirement_contract.version,
        )),
        candidate_independent_scope: Some(CandidateIndependentCapacityScope::new(
            decoder.opaque_id("candidate_independent_scope")?,
        )),
        account_facts: Some(decode_committed_owner_fact(decoder, "account_facts")?),
        liquidity: Some(decode_committed_owner_fact(decoder, "liquidity")?),
        capital_pool_method: Some({
            let value = decode_versioned_identity(decoder, "capital_pool_method")?;
            CapitalPoolMethod::new(value.identity, value.version)
        }),
        capital_pool_assumptions: Some({
            let value = decode_versioned_identity(decoder, "capital_pool_assumptions")?;
            CapitalPoolAssumptions::new(value.identity, value.version)
        }),
        measurement_time: Some(UnixTimestamp::new(decoder.i64("measurement_time")?)),
        valid_through: Some(UnixTimestamp::new(decoder.i64("capacity_valid_through")?)),
        admitted_at: Some(UnixTimestamp::new(decoder.i64("admitted_at")?)),
        auxiliary: decode_opaque_id_set(decoder, "capacity_auxiliary")?,
    };
    Ok(Some(CapacityViewCut::reconstruct(
        policy, witness, required, market, retention,
    )?))
}

fn encode_committed_owner_fact(
    encoder: &mut Encoder,
    fact: &CommittedOwnerFact,
) -> Result<(), TerminalReceiptEncodeError> {
    encode_owner_source(encoder, fact.source())?;
    encoder.opaque_id("record_identity", fact.record_identity().identity())?;
    encoder.opaque_id("content_digest", fact.content_digest().identity())?;
    encoder.opaque_id(
        "source_frontier_lineage",
        fact.source_frontier().lineage().identity(),
    )?;
    encoder.u64(fact.source_frontier().sequence());
    encoder.opaque_id("snapshot_cut", fact.snapshot_cut().identity())?;
    encoder.opaque_id(
        "fact_compatibility_cut",
        fact.compatibility_cut().identity(),
    )?;
    encoder.opaque_id("fact_semantic_scope", fact.semantic_scope().identity())?;
    encoder.i64(fact.observed_at().seconds());
    encoder.i64(fact.valid_through().seconds());
    encoder.u64(fact.clock_epoch());
    encoder.opaque_id("time_evidence", fact.time_evidence())
}

fn decode_committed_owner_fact(
    decoder: &mut Decoder<'_>,
    field: &'static str,
) -> Result<UntrustedOwnerFactRefV1, TerminalReceiptDecodeError> {
    let _ = field;
    Ok(UntrustedOwnerFactRefV1 {
        source: decode_owner_source(decoder, "fact_source")?,
        record_identity: RecordIdentity::new(decoder.opaque_id("record_identity")?),
        content_digest: ContentDigest::new(decoder.opaque_id("content_digest")?),
        // A committed fact always holds its frontier, so the canonical form always writes one and
        // `InputMismatch::FrontierMissing` is unreachable through this codec.
        source_frontier: Some(SourceFrontier::new(
            FrontierLineage::new(decoder.opaque_id("source_frontier_lineage")?),
            decoder.u64("source_frontier_sequence")?,
        )),
        snapshot_cut: SnapshotCut::new(decoder.opaque_id("snapshot_cut")?),
        compatibility_cut: CompatibilityCut::new(decoder.opaque_id("fact_compatibility_cut")?),
        semantic_scope: SemanticScope::new(decoder.opaque_id("fact_semantic_scope")?),
        observed_at: UnixTimestamp::new(decoder.i64("fact_observed_at")?),
        valid_through: UnixTimestamp::new(decoder.i64("fact_valid_through")?),
        clock_epoch: decoder.u64("fact_clock_epoch")?,
        time_evidence: decoder.opaque_id("time_evidence")?,
    })
}

fn encode_proposal_evidence(encoder: &mut Encoder, evidence: &ProposalEvidence) {
    let _ = encoder.opaque_id("proposal_identity", &evidence.proposal_identity);
    let _ = encoder.opaque_id("evidence_cut", &evidence.evidence_cut);
}

fn decode_proposal_evidence(
    decoder: &mut Decoder<'_>,
) -> Result<ProposalEvidence, TerminalReceiptDecodeError> {
    Ok(ProposalEvidence {
        proposal_identity: decoder.opaque_id("proposal_identity")?,
        evidence_cut: decoder.opaque_id("evidence_cut")?,
    })
}

fn encode_batch_operational_failure(encoder: &mut Encoder, failure: &BatchOperationalFailure) {
    encoder.u8(match failure.category {
        BatchFailureCategory::SchedulerOrchestrationFailure => 1,
        BatchFailureCategory::ScannerServiceFailure => 2,
        BatchFailureCategory::SharedDependencyOperationalFailure => 3,
    });
    let _ = encoder.opaque_id("failure_identity", &failure.failure_identity);
    let _ = encoder.opaque_id("evidence_source_cut", &failure.evidence_source_cut);
    let _ = encoder.opaque_id("failure_time_evidence", &failure.time_evidence);
}

fn decode_batch_operational_failure(
    decoder: &mut Decoder<'_>,
) -> Result<BatchOperationalFailure, TerminalReceiptDecodeError> {
    Ok(BatchOperationalFailure {
        category: match decoder.u8("batch_failure_category")? {
            1 => BatchFailureCategory::SchedulerOrchestrationFailure,
            2 => BatchFailureCategory::ScannerServiceFailure,
            3 => BatchFailureCategory::SharedDependencyOperationalFailure,
            code => {
                return Err(TerminalReceiptDecodeError::UnknownDiscriminant {
                    field: "batch_failure_category",
                    code,
                });
            }
        },
        failure_identity: decoder.opaque_id("failure_identity")?,
        evidence_source_cut: decoder.opaque_id("evidence_source_cut")?,
        time_evidence: decoder.opaque_id("failure_time_evidence")?,
    })
}

const fn strategy_outcome_code(outcome: StrategyOutcome) -> u8 {
    match outcome {
        StrategyOutcome::Matched => 1,
        StrategyOutcome::NoMatch => 2,
        StrategyOutcome::InsufficientData => 3,
        StrategyOutcome::InputUnavailable => 4,
        StrategyOutcome::ConditionFailed => 5,
    }
}

fn decode_strategy_outcome(
    decoder: &mut Decoder<'_>,
) -> Result<StrategyOutcome, TerminalReceiptDecodeError> {
    Ok(match decoder.u8("strategy_outcome")? {
        1 => StrategyOutcome::Matched,
        2 => StrategyOutcome::NoMatch,
        3 => StrategyOutcome::InsufficientData,
        4 => StrategyOutcome::InputUnavailable,
        5 => StrategyOutcome::ConditionFailed,
        code => {
            return Err(TerminalReceiptDecodeError::UnknownDiscriminant {
                field: "strategy_outcome",
                code,
            });
        }
    })
}

fn encode_input_mismatch(encoder: &mut Encoder, mismatch: InputMismatch) {
    let (code, field) = match mismatch {
        InputMismatch::SourceOwnerResolveUnavailable => (1, 0),
        InputMismatch::SourceOwnerResolveBindingMismatch => (2, 0),
        InputMismatch::MissingMarketFact(field) => (3, market_fact_field_code(field)),
        InputMismatch::MissingCapacityViewFact(field) => (4, capacity_view_field_code(field)),
        InputMismatch::DataRequirement => (5, 0),
        InputMismatch::UniverseSelectionRequirement => (6, 0),
        InputMismatch::CapacityMissing => (7, 0),
        InputMismatch::CapacityRequirementContract => (8, 0),
        InputMismatch::CapacityScope => (9, 0),
        InputMismatch::SourceOwner => (10, 0),
        InputMismatch::SourceNode => (11, 0),
        InputMismatch::FrontierMissing => (12, 0),
        InputMismatch::FrontierLineage => (13, 0),
        InputMismatch::FrontierRegressed => (14, 0),
        InputMismatch::SemanticScope => (15, 0),
        InputMismatch::CompatibilityCut => (16, 0),
        InputMismatch::ClockEpoch => (17, 0),
        InputMismatch::TimeEvidence => (18, 0),
        InputMismatch::FutureObservation => (19, 0),
        InputMismatch::Expired => (20, 0),
        InputMismatch::MarketCrossCut => (21, 0),
        InputMismatch::CapacityCrossCut => (22, 0),
        InputMismatch::CapacityMarketCrossCut => (23, 0),
        InputMismatch::CapacityMeasurementTime => (24, 0),
        InputMismatch::CapacityValidityCut => (25, 0),
    };
    encoder.u8(code);
    encoder.u8(field);
}

fn decode_input_mismatch(
    decoder: &mut Decoder<'_>,
) -> Result<InputMismatch, TerminalReceiptDecodeError> {
    let code = decoder.u8("input_mismatch")?;
    let field = decoder.u8("input_mismatch_field")?;
    let mismatch = match code {
        1 => InputMismatch::SourceOwnerResolveUnavailable,
        2 => InputMismatch::SourceOwnerResolveBindingMismatch,
        3 => {
            return Ok(InputMismatch::MissingMarketFact(decode_market_fact_field(
                field,
            )?));
        }
        4 => {
            return Ok(InputMismatch::MissingCapacityViewFact(
                decode_capacity_view_field(field)?,
            ));
        }
        5 => InputMismatch::DataRequirement,
        6 => InputMismatch::UniverseSelectionRequirement,
        7 => InputMismatch::CapacityMissing,
        8 => InputMismatch::CapacityRequirementContract,
        9 => InputMismatch::CapacityScope,
        10 => InputMismatch::SourceOwner,
        11 => InputMismatch::SourceNode,
        12 => InputMismatch::FrontierMissing,
        13 => InputMismatch::FrontierLineage,
        14 => InputMismatch::FrontierRegressed,
        15 => InputMismatch::SemanticScope,
        16 => InputMismatch::CompatibilityCut,
        17 => InputMismatch::ClockEpoch,
        18 => InputMismatch::TimeEvidence,
        19 => InputMismatch::FutureObservation,
        20 => InputMismatch::Expired,
        21 => InputMismatch::MarketCrossCut,
        22 => InputMismatch::CapacityCrossCut,
        23 => InputMismatch::CapacityMarketCrossCut,
        24 => InputMismatch::CapacityMeasurementTime,
        25 => InputMismatch::CapacityValidityCut,
        code => {
            return Err(TerminalReceiptDecodeError::UnknownDiscriminant {
                field: "input_mismatch",
                code,
            });
        }
    };

    if field != 0 {
        // Only the two field-carrying variants use the second byte; a value there otherwise means
        // the same mismatch has two encodings.
        return Err(TerminalReceiptDecodeError::NonCanonical {
            field: "input_mismatch_field",
        });
    }
    Ok(mismatch)
}

const fn market_fact_field_code(field: MarketFactField) -> u8 {
    match field {
        MarketFactField::DataRequirement => 1,
        MarketFactField::UniverseSelectionRequirement => 2,
        MarketFactField::PitSnapshot => 3,
        MarketFactField::UniverseSelectionRecord => 4,
        MarketFactField::InstrumentMaster => 5,
        MarketFactField::CalendarSessionTimeZone => 6,
        MarketFactField::CorporateAction => 7,
        MarketFactField::HistoricalMembership => 8,
        MarketFactField::MarketSemanticsCompatibility => 9,
    }
}

fn decode_market_fact_field(code: u8) -> Result<MarketFactField, TerminalReceiptDecodeError> {
    Ok(match code {
        1 => MarketFactField::DataRequirement,
        2 => MarketFactField::UniverseSelectionRequirement,
        3 => MarketFactField::PitSnapshot,
        4 => MarketFactField::UniverseSelectionRecord,
        5 => MarketFactField::InstrumentMaster,
        6 => MarketFactField::CalendarSessionTimeZone,
        7 => MarketFactField::CorporateAction,
        8 => MarketFactField::HistoricalMembership,
        9 => MarketFactField::MarketSemanticsCompatibility,
        code => {
            return Err(TerminalReceiptDecodeError::UnknownDiscriminant {
                field: "market_fact_field",
                code,
            });
        }
    })
}

const fn capacity_view_field_code(field: CapacityViewField) -> u8 {
    match field {
        CapacityViewField::RequirementContract => 1,
        CapacityViewField::CandidateIndependentScope => 2,
        CapacityViewField::AccountFacts => 3,
        CapacityViewField::Liquidity => 4,
        CapacityViewField::CapitalPoolMethod => 5,
        CapacityViewField::CapitalPoolAssumptions => 6,
        CapacityViewField::MeasurementTime => 7,
        CapacityViewField::ValidThrough => 8,
        CapacityViewField::CompatibleMarketSnapshotCut => 9,
        CapacityViewField::AdmittedAt => 10,
    }
}

fn decode_capacity_view_field(code: u8) -> Result<CapacityViewField, TerminalReceiptDecodeError> {
    Ok(match code {
        1 => CapacityViewField::RequirementContract,
        2 => CapacityViewField::CandidateIndependentScope,
        3 => CapacityViewField::AccountFacts,
        4 => CapacityViewField::Liquidity,
        5 => CapacityViewField::CapitalPoolMethod,
        6 => CapacityViewField::CapitalPoolAssumptions,
        7 => CapacityViewField::MeasurementTime,
        8 => CapacityViewField::ValidThrough,
        9 => CapacityViewField::CompatibleMarketSnapshotCut,
        10 => CapacityViewField::AdmittedAt,
        code => {
            return Err(TerminalReceiptDecodeError::UnknownDiscriminant {
                field: "capacity_view_field",
                code,
            });
        }
    })
}

fn encode_versioned(
    encoder: &mut Encoder,
    field: &'static str,
    identity: &OpaqueId,
    version: Version,
) -> Result<(), TerminalReceiptEncodeError> {
    encoder.opaque_id(field, identity)?;
    encoder.u64(version.get());
    Ok(())
}

fn encode_versioned_identity(
    encoder: &mut Encoder,
    identity: &VersionedIdentity,
) -> Result<(), TerminalReceiptEncodeError> {
    encode_versioned(
        encoder,
        "versioned_identity",
        &identity.identity,
        identity.version,
    )
}

fn decode_versioned_identity(
    decoder: &mut Decoder<'_>,
    field: &'static str,
) -> Result<VersionedIdentity, TerminalReceiptDecodeError> {
    Ok(VersionedIdentity {
        identity: decoder.opaque_id(field)?,
        version: Version::new(decoder.u64("version")?)?,
    })
}

fn encode_local_date_time(encoder: &mut Encoder, local: LocalDateTime) {
    encoder.i32(local.year);
    encoder.u8(local.month);
    encoder.u8(local.day);
    encoder.u8(local.hour);
    encoder.u8(local.minute);
    encoder.u8(local.second);
}

fn decode_local_date_time(
    decoder: &mut Decoder<'_>,
    field: &'static str,
) -> Result<LocalDateTime, TerminalReceiptDecodeError> {
    let _ = field;
    Ok(LocalDateTime::new(
        decoder.i32("local_year")?,
        decoder.u8("local_month")?,
        decoder.u8("local_day")?,
        decoder.u8("local_hour")?,
        decoder.u8("local_minute")?,
        decoder.u8("local_second")?,
    )?)
}

fn encode_evidence_set(
    encoder: &mut Encoder,
    evidence: &EvidenceSet,
) -> Result<(), TerminalReceiptEncodeError> {
    encoder.count("evidence_set", evidence.iter().len())?;

    for value in evidence.iter() {
        encoder.opaque_id("evidence", value)?;
    }
    Ok(())
}

fn decode_evidence_set(
    decoder: &mut Decoder<'_>,
    field: &'static str,
) -> Result<EvidenceSet, TerminalReceiptDecodeError> {
    Ok(EvidenceSet::new(decode_ascending_ids(decoder, field)?)?)
}

fn encode_opaque_id_set(
    encoder: &mut Encoder,
    field: &'static str,
    values: &BTreeSet<OpaqueId>,
) -> Result<(), TerminalReceiptEncodeError> {
    encoder.count(field, values.len())?;

    for value in values {
        encoder.opaque_id(field, value)?;
    }
    Ok(())
}

fn decode_opaque_id_set(
    decoder: &mut Decoder<'_>,
    field: &'static str,
) -> Result<BTreeSet<OpaqueId>, TerminalReceiptDecodeError> {
    Ok(decode_ascending_ids(decoder, field)?.into_iter().collect())
}

/// Decodes a repeated identity group, refusing any order but strictly ascending.
///
/// A set collapses a repeat and re-sorts any order, so accepting either would give one value two
/// encodings and break the canonicity a content-addressed store depends on.
fn decode_ascending_ids(
    decoder: &mut Decoder<'_>,
    field: &'static str,
) -> Result<Vec<OpaqueId>, TerminalReceiptDecodeError> {
    let count = decoder.count(field)?;
    let mut values: Vec<OpaqueId> = Vec::new();

    for _ in 0..count {
        let value = decoder.opaque_id(field)?;

        if values.last().is_some_and(|last| *last >= value) {
            return Err(TerminalReceiptDecodeError::NotAscending { field });
        }
        values.push(value);
    }
    Ok(values)
}

#[derive(Default)]
struct Encoder(Vec<u8>);

impl Encoder {
    fn finish(self) -> Result<Vec<u8>, TerminalReceiptEncodeError> {
        if self.0.len() > MAX_RECEIPT_BYTES {
            return Err(TerminalReceiptEncodeError::CapacityExceeded {
                field: "terminal_receipt",
            });
        }
        Ok(self.0)
    }

    fn bytes(
        &mut self,
        field: &'static str,
        value: &[u8],
    ) -> Result<(), TerminalReceiptEncodeError> {
        let length = u32::try_from(value.len())
            .ok()
            .filter(|_| value.len() <= MAX_TEXT_BYTES)
            .ok_or(TerminalReceiptEncodeError::CapacityExceeded { field })?;
        self.u32(length);
        self.0.extend_from_slice(value);
        Ok(())
    }

    fn opaque_id(
        &mut self,
        field: &'static str,
        value: &OpaqueId,
    ) -> Result<(), TerminalReceiptEncodeError> {
        self.bytes(field, value.as_str().as_bytes())
    }

    fn count(
        &mut self,
        field: &'static str,
        value: usize,
    ) -> Result<(), TerminalReceiptEncodeError> {
        let value = u32::try_from(value)
            .ok()
            .filter(|count| *count <= MAX_ENTRIES)
            .ok_or(TerminalReceiptEncodeError::CapacityExceeded { field })?;
        self.u32(value);
        Ok(())
    }

    fn option<T>(
        &mut self,
        field: &'static str,
        value: Option<T>,
        encode: impl FnOnce(&mut Self, T) -> Result<(), TerminalReceiptEncodeError>,
    ) -> Result<(), TerminalReceiptEncodeError> {
        let _ = field;

        match value {
            Some(value) => {
                self.u8(1);
                encode(self, value)
            }
            None => {
                self.u8(0);
                Ok(())
            }
        }
    }

    fn u8(&mut self, value: u8) {
        self.0.push(value);
    }

    fn u16(&mut self, value: u16) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }

    fn u32(&mut self, value: u32) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }

    fn u64(&mut self, value: u64) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }

    fn i32(&mut self, value: i32) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }

    fn i64(&mut self, value: i64) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }
}

struct Decoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Decoder<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(
        &mut self,
        field: &'static str,
        count: usize,
    ) -> Result<&'a [u8], TerminalReceiptDecodeError> {
        let end = self
            .offset
            .checked_add(count)
            .ok_or(TerminalReceiptDecodeError::CapacityExceeded { field })?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(TerminalReceiptDecodeError::Truncated { field })?;
        self.offset = end;
        Ok(value)
    }

    fn u8(&mut self, field: &'static str) -> Result<u8, TerminalReceiptDecodeError> {
        Ok(self.take(field, 1)?[0])
    }

    fn u16(&mut self, field: &'static str) -> Result<u16, TerminalReceiptDecodeError> {
        Ok(u16::from_be_bytes(self.array(field)?))
    }

    fn u32(&mut self, field: &'static str) -> Result<u32, TerminalReceiptDecodeError> {
        Ok(u32::from_be_bytes(self.array(field)?))
    }

    fn u64(&mut self, field: &'static str) -> Result<u64, TerminalReceiptDecodeError> {
        Ok(u64::from_be_bytes(self.array(field)?))
    }

    fn i32(&mut self, field: &'static str) -> Result<i32, TerminalReceiptDecodeError> {
        Ok(i32::from_be_bytes(self.array(field)?))
    }

    fn i64(&mut self, field: &'static str) -> Result<i64, TerminalReceiptDecodeError> {
        Ok(i64::from_be_bytes(self.array(field)?))
    }

    fn array<const N: usize>(
        &mut self,
        field: &'static str,
    ) -> Result<[u8; N], TerminalReceiptDecodeError> {
        self.take(field, N)?
            .try_into()
            .map_err(|_| TerminalReceiptDecodeError::Truncated { field })
    }

    fn bytes(&mut self, field: &'static str) -> Result<&'a [u8], TerminalReceiptDecodeError> {
        let count = self.u32(field)? as usize;

        if count > MAX_TEXT_BYTES {
            return Err(TerminalReceiptDecodeError::CapacityExceeded { field });
        }
        self.take(field, count)
    }

    fn expect_domain(
        &mut self,
        field: &'static str,
        expected: &[u8],
    ) -> Result<(), TerminalReceiptDecodeError> {
        match self.bytes(field) {
            Ok(found) if found == expected => Ok(()),
            Ok(_) | Err(TerminalReceiptDecodeError::CapacityExceeded { .. }) => {
                Err(TerminalReceiptDecodeError::ForeignDomain)
            }
            Err(TerminalReceiptDecodeError::Truncated { .. })
                if self.bytes.len() < expected.len() =>
            {
                Err(TerminalReceiptDecodeError::ForeignDomain)
            }
            Err(e) => Err(e),
        }
    }

    fn opaque_id(&mut self, field: &'static str) -> Result<OpaqueId, TerminalReceiptDecodeError> {
        let text = std::str::from_utf8(self.bytes(field)?)
            .map_err(|_| TerminalReceiptDecodeError::MalformedText { field })?;
        Ok(OpaqueId::new(text)?)
    }

    fn count(&mut self, field: &'static str) -> Result<u32, TerminalReceiptDecodeError> {
        let count = self.u32(field)?;

        if count > MAX_ENTRIES {
            return Err(TerminalReceiptDecodeError::CapacityExceeded { field });
        }
        Ok(count)
    }

    fn option<T>(
        &mut self,
        field: &'static str,
        decode: impl FnOnce(&mut Self) -> Result<T, TerminalReceiptDecodeError>,
    ) -> Result<Option<T>, TerminalReceiptDecodeError> {
        match self.u8(field)? {
            0 => Ok(None),
            1 => decode(self).map(Some),
            code => Err(TerminalReceiptDecodeError::UnknownDiscriminant { field, code }),
        }
    }

    fn finish(self) -> Result<(), TerminalReceiptDecodeError> {
        let unconsumed = self.bytes.len().saturating_sub(self.offset);

        if unconsumed == 0 {
            Ok(())
        } else {
            Err(TerminalReceiptDecodeError::TrailingBytes { unconsumed })
        }
    }
}
