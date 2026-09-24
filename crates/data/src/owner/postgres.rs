//! Native PostgreSQL custody for the Market Data Owner.
//!
//! Both constructors and every writer remain crate-private. Downstream code can receive only the
//! public read-only resolver traits and sealed readbacks; it cannot choose a database, trusted
//! clock, canonical basis, or positive disposition.

#![allow(
    dead_code,
    reason = "private durable Owner composition is exercised by disposable PostgreSQL tests until product composition exists"
)]

use std::{collections::BTreeSet, fmt::Debug};

mod authenticated_design_registration_v1;
#[cfg(feature = "sealed-strategy-input-acceptance")]
pub mod bar_joined_cut_acceptance_v1;
mod calendar;
mod corporate_action;
mod live_market_stream_v1;
#[cfg(test)]
mod market_data_rd_api_authorization_postgres_tests;
mod market_semantics;
mod observation_census;
#[cfg(test)]
mod pit_intake_member_count_tests;
mod pit_role_resolution_v1;
mod rd_strategy_input_custody;
mod reference_fact_catalog;
mod reference_fact_coordinates;
mod replay_market_facts_v2;
pub(super) use replay_market_facts_v2::resolve_bound_replay_cut_for_rd_in_transaction_v1;
pub(super) use replay_market_facts_v2::{
    BoundUniverseSelectionErrorV1, recover_bound_universe_selection_in_transaction_v1,
};
#[cfg(test)]
pub(super) use replay_market_facts_v2::{
    ISSUANCE_BINDING_CONSTRAINT, ISSUANCE_IDENTITY_CONSTRAINT, ISSUANCE_MEANING_CONSTRAINT,
};
#[cfg(test)]
pub(super) use universe_selection::persist_issued_readback_for_test;
mod sample_projection_v4;
mod session;
pub(in crate::owner) mod strategy_input_binding_registry;
#[cfg(feature = "isolated-event-replay-acceptance")]
pub(in crate::owner) mod strategy_input_event_binding_v1;
#[cfg(not(feature = "isolated-event-replay-acceptance"))]
mod strategy_input_event_binding_v1;
mod time_zone;
mod universe_selection;

// The resolver is needed in every build: the arrangement that reads a frame's inputs is no longer
// inside a `cfg(not(test))` arm, so that its order can be driven rather than only deployed.
use super::native_replay_scheduling_v1::{
    NativeReplayInitialMarketReadbackV1, NativeReplayInitialMarketRequestV1,
    NativeReplaySchedulingErrorV1, NativeReplaySchedulingResolverV1,
    issue_native_replay_initial_market_readback_v1, select_native_replay_schedule_v1,
};
use super::pit_snapshot::{
    PitObservationBatchOwnerResolver, PitSnapshotFact, VerifiedPitObservationBatch,
};

/// Exactly what custody holds for one sealed V2 sequence, as stored.
///
/// Every field is read back from the relation, never re-derived, so a byte comparison against it
/// is a claim about history rather than about the current code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NativeReplayFrameSequenceCustodyReadbackV2 {
    pub(crate) sequence_identity: BindingDigest,
    pub(crate) sequence_bytes: Vec<u8>,
    pub(crate) receipt_identity: BindingDigest,
    pub(crate) receipt_bytes: Vec<u8>,
    pub(crate) outbox_identity: BindingDigest,
    pub(crate) outbox_payload: Vec<u8>,
}

/// The complete coordinate set for a successor frame, every field Owner-derived.
///
/// `docs/owners/market-data.md` forbids a caller-supplied second snapshot, frame time, member
/// values, schedule, event order or frame list. The frame time here is the frame's own
/// event-effective coordinate as the Owner recorded it, not a window bound the caller chose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct NativeReplayCensusFrameV2 {
    pub(crate) snapshot_identity: BindingDigest,
    pub(crate) snapshot_fact_digest: BindingDigest,
    pub(crate) frame_time_ns: u64,
}

/// The frames one scope's census holds inside a request window, in commit order.
///
/// The last frame is not consumed: it bounds the liquidity of the one before it. Keeping the two
/// apart here means no consumer has to remember which of the resolved frames it may run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NativeReplayCensusSequenceV2 {
    pub(crate) consumed: Vec<NativeReplayCensusFrameV2>,
    pub(crate) bounding_successor: NativeReplayCensusFrameV2,
}

use super::native_replay_scheduling_v2::{
    NativeReplayFrameCensusRefusalV2, NativeReplayFrameSequenceCustodyRecordV2,
    NativeReplayFrameSequenceCustodyRefusalV2,
};
use super::research_pit_terminal::{
    ResearchPitTerminal, ResearchPitTerminalResolver, UntrustedResearchPitTerminalRequest,
    seal_research_pit_terminal,
};
#[cfg(not(test))]
use super::sample_projection::{
    StrategyInputSampleProjectionReadbackV2, StrategyInputSampleProjectionReadbackV3,
    StrategyInputSampleProjectionResolveErrorV2, StrategyInputSampleProjectionResolveErrorV3,
    StrategyInputSampleProjectionResolverV2, StrategyInputSampleProjectionResolverV3,
    UntrustedStrategyInputSampleProjectionLocatorV2,
    UntrustedStrategyInputSampleProjectionLocatorV3,
};
#[cfg(not(test))]
use super::sealed_replay_input::{
    SealedReplayInput, SealedReplayInputResolver, UntrustedSealedReplayInputRequest,
    seal_replay_input,
};
use super::store_admission::RawSharedTimeEvidenceSnapshotV1;
#[cfg(test)]
use super::store_admission::RawSharedTimeHistoryRowV1;
// The port and the BAR schedule evidence are needed in every build: the arrangement that reads a
// schedule through the port is no longer inside a `cfg(not(test))` arm, so that its order can be
// driven rather than only deployed. The rest stay gated with their production-only readers.
use super::store_admission::{
    AdmittedMarketDataSnapshotPort, BarScheduleStorageEvidenceV1,
    MarketDataPitEvaluationStorageEvidence,
};
#[cfg(not(test))]
use super::store_admission::{
    MarketDataPitTerminalStorageEvidence, MarketDataSourceBindingStorageEvidence,
    StrategyInputSampleProjectionStorageEvidenceV2, StrategyInputSampleProjectionStorageEvidenceV3,
};
use super::universe_selection::{
    UniverseSelectionErrorV1, UniverseSelectionIdentity, UniverseSelectionReadbackV1,
    UntrustedUniverseSelectionLocatorV1,
};
use super::{
    bar_schedule::{
        BarScheduleCompletionV1, BarScheduleIdentity, BarScheduleKindV1, BarScheduleLabelV1,
        BarScheduleReadbackV1, BarScheduleResolverV1, BarScheduleUnitV1,
        PreparedBarScheduleCommitV1, UntrustedBarScheduleLocatorV1,
        authority::{
            build_readback as build_bar_schedule_readback,
            build_receipt as build_bar_schedule_receipt, decode_cut as decode_bar_schedule_cut,
            decode_fact as decode_bar_schedule_fact, decode_receipt as decode_bar_schedule_receipt,
        },
    },
    instrument_master::{
        InstrumentMasterError, InstrumentMasterFactProposalV1, InstrumentMasterFactV1,
        InstrumentMasterIdentity, InstrumentMasterReadbackV1, InstrumentMasterResolver,
        InstrumentMasterScopeV1, InstrumentMasterUniverseMembershipResolver,
        UntrustedInstrumentMasterRequestV1,
        authority::{
            build_cut as build_instrument_cut, build_fact as build_instrument_fact,
            build_readback as build_instrument_readback, build_receipt as build_instrument_receipt,
            clock_projection as instrument_clock_projection,
            cut_matches_request as instrument_cut_matches_request,
            decode_cut as decode_instrument_cut, decode_fact as decode_instrument_fact,
            decode_receipt as decode_instrument_receipt, select_facts as select_instrument_facts,
            validate_fact_graph as validate_instrument_fact_graph,
        },
    },
    instrument_master_admission_v1::{
        InstrumentMasterAdmissionErrorV1, InstrumentMasterAdmissionTerminalV1,
        InstrumentMasterAdmissionV1, InstrumentMasterFactSubmissionV1,
        sealed::Sealed as InstrumentMasterAdmissionSealed,
    },
    live_market_fact_v1::{LiveMarketFactSourceV1, LiveMarketFactV1, LiveMarketSubscriptionV1},
    live_market_stream_v1::{
        LiveMarketChannelErrorV1, LiveMarketChannelHeadV1, LiveMarketChannelRequestV1,
        LiveMarketChannelV1, LiveMarketFactIntakeV1, derive_channel_identity_v1,
        sealed::Sealed as LiveMarketSealed,
    },
    market_semantics_admission_v1::{
        MarketSemanticsAdmissionErrorV1, MarketSemanticsAdmissionTerminalV1,
        MarketSemanticsAdmissionV1, MarketSemanticsFactSubmissionV1,
        sealed::Sealed as MarketSemanticsAdmissionSealed,
    },
    native_replay_quote_cut_v2::{
        NativeReplayCutCoordinatesV2, NativeReplayCutKindV2, NativeReplayQuoteCutCandidateV2,
        NativeReplayQuoteCutRefusalV2, classify_native_replay_cut_v2,
        native_replay_quote_cut_bound_v2, select_native_replay_quote_cut_v2,
        verify_native_replay_quote_cut_v2,
    },
    observation_census::{
        ObservationCensusErrorV1, ObservationCensusReadbackV1, ObservationCensusResolverV1,
        StrategyInputJoinedCutOwnerResolverV1, StrategyInputJoinedCutReadbackV1,
        UntrustedObservationCensusLocatorV1, UntrustedObservationCensusRequestV1,
        UntrustedStrategyInputJoinedCutLocatorV1,
    },
    pit_market_snapshot_intake_v1::{
        MarketDataDecisionCutV1, PitMarketSnapshotDispositionV1, PitMarketSnapshotIntakeErrorV1,
        PitMarketSnapshotIntakeV1, PitMarketSnapshotTerminalV1, sealed::Sealed as PitIntakeSealed,
    },
    pit_observation_source_v1::{PitObservationScopeV1, PitObservationSourceV1},
    pit_snapshot::{
        PitSnapshotCommitAggregate, PitSnapshotDisposition, PitSnapshotError,
        UntrustedPitObservation, UntrustedPitObservationBatchProposal, UntrustedPitSnapshotLocator,
        UntrustedPitSnapshotProposal, UntrustedPitSnapshotRequest,
        authority::{
            CanonicalBasisResolverV1, ObservedPitObservationNativeRow, OwnerCanonicalBasisV1,
            OwnerSnapshotDeterminationV1, PreparedPitObservationBatch,
            derive_observation_batch_digest, prepare_correction_aggregate,
            prepare_initial_aggregate, prepare_observation_batch,
            verify_aggregate as verify_pit_aggregate, verify_observation_batch,
        },
        seal_request_claims_v1,
    },
    replay_market_facts_v2::{
        ReplayCompositionBindingErrorV1, ReplayMarketFactsErrorV2, ReplayMarketFactsReadbackV2,
        UntrustedReplayMarketFactsRequestV2,
        composition::UntrustedReplayMarketFactsCompositionRequestV1,
    },
    sample_fact::{
        PreparedSampleCommitV1, StoredSampleReadbackV1, verify_stored_sample_readback_v1,
        verify_stored_timeframe_projection_v1,
    },
    sample_projection::{
        DecodedStrategyInputSampleProjectionV2, DecodedStrategyInputSampleProjectionV3,
        PreparedStrategyInputSampleProjectionV2, PreparedStrategyInputSampleProjectionV3,
        decode_strategy_input_sample_projection_v2, decode_strategy_input_sample_projection_v3,
        verify_decoded_projection_component_native_v2,
        verify_decoded_projection_component_native_v3,
    },
    shared_time_evidence::{
        ClockHeadFact, ClockHeadHandoff, ClockHeadSuccessorReadback, EpochSuccessorProof,
        SharedTimeEvidenceError, SharedTimeEvidenceResolver, UntrustedClockHeadLocator,
        build_epoch_successor_proof, build_head_fact, successor_readback,
        validate_new_epoch_successor, validate_same_epoch_successor, verify_epoch_successor_proof,
        verify_head_fact,
    },
    source_binding::{
        BindingDigest, MarketDataClockAdmission, MarketDataClockComparisonRule,
        SourceBindingBlocker, SourceBindingError, SourceBindingOwnerReadback,
        SourceBindingOwnerResolver, UntrustedSourceBindingLocator, UntrustedSourceBindingProposal,
        authority::{
            OwnerLineage as SourceOwnerLineage, OwnerSourceBindingDecision, SourceBindingCommit,
            SourceBindingDisposition, SourceBindingFact, SourceBindingStoredAggregate,
            build_stored_aggregate, derive_binding_id,
            derive_market_semantics_compatibility_identity_v1, derive_time_evidence_identity,
            seal_owner_clock_admission_v1, validate_clock_for_readback, validate_proposal,
            validate_successor_advances, verify_stored_aggregate as verify_source_aggregate,
        },
    },
    source_binding_admission_v1::{
        ProviderReachabilityEvidenceV1, ProviderRightsEvidenceV1,
        SourceBindingAdmissionDispositionV1, SourceBindingAdmissionErrorV1,
        SourceBindingAdmissionRequestV1, SourceBindingAdmissionTerminalV1,
        SourceBindingAdmissionV1, sealed::Sealed as SourceBindingAdmissionSealed,
    },
    strategy_design_role_set::StrategyDesignRoleSetLocatorV1,
    strategy_input_binding_admission_v1::{
        StrategyInputBindingAdmissionErrorV1, StrategyInputBindingAdmissionTerminalV1,
        StrategyInputBindingAdmissionV1, sealed::Sealed as StrategyInputBindingAdmissionSealed,
    },
    universe_selection::{
        UntrustedUniverseSelectionRequestV1,
        authority::{
            CanonicalUniverseSelectionRuleEvaluatorV1, HistoricalMembershipFactProposalV1,
        },
    },
    universe_selection_admission_v1::{
        HistoricalMembershipAdmissionRequestV1, UniverseSelectionAdmissionErrorV1,
        UniverseSelectionAdmissionV1, UniverseSelectionTerminalV1,
        sealed::Sealed as UniverseSelectionAdmissionSealed,
    },
};
#[cfg(test)]
use super::{
    sample_projection::{
        StrategyInputSampleProjectionReadbackV2, StrategyInputSampleProjectionReadbackV3,
    },
    store_admission::{
        StrategyInputSampleProjectionStorageEvidenceV2,
        StrategyInputSampleProjectionStorageEvidenceV3,
    },
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgPoolOptions};

#[cfg(test)]
use super::pit_snapshot::{PitSnapshotOwnerReadback, PitSnapshotOwnerResolver};

const MIGRATION_ID: &str = "market-data-owner-postgres-v1";
const SHARED_TIME_MIGRATION_ID: &str = "market-data-owner-shared-time-v1";
const OWNER_HISTORY_CENSUS_MIGRATION_ID: &str = "market-data-owner-history-census-v1";
const OWNER_SCHEMA_GUARD_V1: &str = "DO $owner_schema$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace namespace JOIN pg_catalog.pg_roles role ON role.oid=namespace.nspowner WHERE namespace.nspname='market_data_private' AND role.rolname=current_user) THEN RAISE EXCEPTION 'Market Data bootstrap schema ownership is unavailable'; END IF; END $owner_schema$";

const MIGRATION_STATEMENTS: &[&str] = &[
    OWNER_SCHEMA_GUARD_V1,
    "REVOKE ALL ON SCHEMA market_data_private FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.owner_migrations_v1 (migration_id TEXT PRIMARY KEY, installed_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp())",
    "CREATE TABLE IF NOT EXISTS market_data_private.clock_head_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), clock_identity TEXT NOT NULL, clock_epoch TEXT NOT NULL, monotonic_sequence BIGINT NOT NULL CHECK (monotonic_sequence > 0), wall_observed BIGINT NOT NULL CHECK (wall_observed > 0), decision_cut BIGINT NOT NULL CHECK (decision_cut > 0), valid_through BIGINT NOT NULL, restart_continuity_digest BYTEA NOT NULL CHECK (octet_length(restart_continuity_digest) = 32), uncertainty_bound BIGINT NOT NULL CHECK (uncertainty_bound >= 0), skew_bound BIGINT NOT NULL CHECK (skew_bound > 0), comparison_rule SMALLINT NOT NULL CHECK (comparison_rule = 1), shared_time_materialized BOOLEAN NOT NULL DEFAULT FALSE, CHECK (uncertainty_bound <= skew_bound), CHECK (decision_cut <= wall_observed), CHECK (wall_observed < valid_through))",
    "ALTER TABLE market_data_private.clock_head_v1 ADD COLUMN IF NOT EXISTS shared_time_materialized BOOLEAN NOT NULL DEFAULT FALSE",
    "CREATE TABLE IF NOT EXISTS market_data_private.instrument_master_facts_v1 (fact_digest BYTEA PRIMARY KEY CHECK (octet_length(fact_digest)=32), canonical_identity TEXT NOT NULL CHECK (canonical_identity<>''), predecessor_fact_digest BYTEA NULL REFERENCES market_data_private.instrument_master_facts_v1(fact_digest), fact_bytes BYTEA NOT NULL CHECK (octet_length(fact_bytes)>0), UNIQUE(canonical_identity,predecessor_fact_digest))",
    "CREATE INDEX IF NOT EXISTS instrument_master_facts_identity_v1 ON market_data_private.instrument_master_facts_v1(canonical_identity)",
    "CREATE TABLE IF NOT EXISTS market_data_private.instrument_master_state_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), store_generation_identity BYTEA NOT NULL CHECK (octet_length(store_generation_identity)=32), append_sequence BIGINT NOT NULL CHECK (append_sequence>=0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.instrument_master_cuts_v1 (cut_identity BYTEA PRIMARY KEY CHECK (octet_length(cut_identity)=32), request_identity BYTEA UNIQUE NOT NULL CHECK (octet_length(request_identity)=32), cut_bytes BYTEA NOT NULL CHECK (octet_length(cut_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.instrument_master_receipts_v1 (request_identity BYTEA PRIMARY KEY CHECK (octet_length(request_identity)=32), request_meaning_digest BYTEA NOT NULL CHECK (octet_length(request_meaning_digest)=32), cut_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.instrument_master_cuts_v1(cut_identity), receipt_identity BYTEA UNIQUE NOT NULL CHECK (octet_length(receipt_identity)=32), receipt_bytes BYTEA NOT NULL CHECK (octet_length(receipt_bytes)>0), append_sequence BIGINT UNIQUE NOT NULL CHECK (append_sequence>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.instrument_master_outbox_v1 (outbox_identity BYTEA PRIMARY KEY CHECK (octet_length(outbox_identity)=32), request_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.instrument_master_receipts_v1(request_identity), receipt_bytes BYTEA NOT NULL CHECK (octet_length(receipt_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.timeframe_projection_receipts_v1 (receipt_digest BYTEA PRIMARY KEY CHECK (octet_length(receipt_digest)=32), binding_receipt_digest BYTEA UNIQUE NOT NULL CHECK (octet_length(binding_receipt_digest)=32), receipt_bytes BYTEA NOT NULL CHECK (octet_length(receipt_bytes)>0), custody_digest BYTEA NOT NULL CHECK (octet_length(custody_digest)=32))",
    "CREATE TABLE IF NOT EXISTS market_data_private.sample_facts_v1 (sample_identity BYTEA PRIMARY KEY CHECK (octet_length(sample_identity)=32), fact_digest BYTEA UNIQUE NOT NULL CHECK (octet_length(fact_digest)=32), series_identity BYTEA NOT NULL CHECK (octet_length(series_identity)=32), series_predecessor_identity BYTEA NULL REFERENCES market_data_private.sample_facts_v1(sample_identity), series_sequence BIGINT NOT NULL CHECK (series_sequence>0), correction_slot_identity BYTEA NOT NULL CHECK (octet_length(correction_slot_identity)=32), correction_predecessor_identity BYTEA NULL REFERENCES market_data_private.sample_facts_v1(sample_identity), correction_sequence BIGINT NOT NULL CHECK (correction_sequence>0), logical_time BIGINT NOT NULL CHECK (logical_time>0), lineage_version BIGINT NOT NULL CHECK (lineage_version>0), projection_receipt_digest BYTEA NOT NULL REFERENCES market_data_private.timeframe_projection_receipts_v1(receipt_digest), fact_bytes BYTEA NOT NULL CHECK (octet_length(fact_bytes)>0), custody_digest BYTEA NOT NULL CHECK (octet_length(custody_digest)=32), CHECK (series_predecessor_identity IS NULL OR series_predecessor_identity<>sample_identity), CHECK (correction_predecessor_identity IS NULL OR correction_predecessor_identity<>sample_identity), UNIQUE(series_identity,series_sequence), UNIQUE(series_identity,series_predecessor_identity), UNIQUE(correction_slot_identity,correction_sequence), UNIQUE(correction_slot_identity,correction_predecessor_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.sample_series_heads_v1 (series_identity BYTEA PRIMARY KEY CHECK (octet_length(series_identity)=32), sample_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.sample_facts_v1(sample_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.sample_correction_heads_v1 (correction_slot_identity BYTEA PRIMARY KEY CHECK (octet_length(correction_slot_identity)=32), series_identity BYTEA NOT NULL CHECK (octet_length(series_identity)=32), sample_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.sample_facts_v1(sample_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.sample_receipts_v1 (sample_identity BYTEA PRIMARY KEY REFERENCES market_data_private.sample_facts_v1(sample_identity), receipt_digest BYTEA UNIQUE NOT NULL CHECK (octet_length(receipt_digest)=32), receipt_bytes BYTEA NOT NULL CHECK (octet_length(receipt_bytes)>0), custody_digest BYTEA NOT NULL CHECK (octet_length(custody_digest)=32))",
    "CREATE TABLE IF NOT EXISTS market_data_private.sample_outbox_v1 (outbox_identity BYTEA PRIMARY KEY CHECK (octet_length(outbox_identity)=32), sample_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.sample_receipts_v1(sample_identity), payload_digest BYTEA NOT NULL CHECK (octet_length(payload_digest)=32), payload_bytes BYTEA NOT NULL CHECK (octet_length(payload_bytes)>0), custody_digest BYTEA NOT NULL CHECK (octet_length(custody_digest)=32))",
    "CREATE TABLE IF NOT EXISTS market_data_private.strategy_input_sample_projection_receipts_v2 (receipt_digest BYTEA PRIMARY KEY CHECK (octet_length(receipt_digest)=32), kind SMALLINT NOT NULL CHECK (kind IN (1,2)), subject_identity BYTEA NOT NULL CHECK (octet_length(subject_identity)=32), component_count BIGINT NOT NULL CHECK (component_count>0 AND component_count<=4294967295), receipt_bytes BYTEA NOT NULL, custody_digest BYTEA NOT NULL CHECK (octet_length(custody_digest)=32), UNIQUE(kind,subject_identity), CHECK (octet_length(receipt_bytes)=41+612*component_count))",
    "ALTER TABLE market_data_private.strategy_input_sample_projection_receipts_v2 DROP CONSTRAINT IF EXISTS strategy_input_sample_projection_receipts_v2_kind_check",
    "ALTER TABLE market_data_private.strategy_input_sample_projection_receipts_v2 ADD CONSTRAINT strategy_input_sample_projection_receipts_v2_kind_check CHECK (kind IN (1,2))",
    "CREATE TABLE IF NOT EXISTS market_data_private.bar_schedule_state_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), store_generation_identity BYTEA NOT NULL CHECK (octet_length(store_generation_identity)=32), append_sequence BIGINT NOT NULL CHECK (append_sequence>=0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.bar_schedule_facts_v1 (fact_digest BYTEA PRIMARY KEY CHECK (octet_length(fact_digest)=32), canonical_instrument TEXT NOT NULL CHECK (canonical_instrument<>''), predecessor_fact_digest BYTEA NULL REFERENCES market_data_private.bar_schedule_facts_v1(fact_digest), fact_bytes BYTEA NOT NULL CHECK (octet_length(fact_bytes)>0), UNIQUE(canonical_instrument,predecessor_fact_digest))",
    "CREATE TABLE IF NOT EXISTS market_data_private.bar_schedule_heads_v1 (canonical_instrument TEXT PRIMARY KEY CHECK (canonical_instrument<>''), fact_digest BYTEA UNIQUE NOT NULL REFERENCES market_data_private.bar_schedule_facts_v1(fact_digest))",
    "CREATE TABLE IF NOT EXISTS market_data_private.bar_schedule_cuts_v1 (cut_identity BYTEA PRIMARY KEY CHECK (octet_length(cut_identity)=32), fact_digest BYTEA UNIQUE NOT NULL REFERENCES market_data_private.bar_schedule_facts_v1(fact_digest), cut_bytes BYTEA NOT NULL CHECK (octet_length(cut_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.bar_schedule_receipts_v1 (fact_digest BYTEA PRIMARY KEY REFERENCES market_data_private.bar_schedule_facts_v1(fact_digest), readback_identity BYTEA UNIQUE NOT NULL CHECK (octet_length(readback_identity)=32), receipt_identity BYTEA UNIQUE NOT NULL CHECK (octet_length(receipt_identity)=32), receipt_bytes BYTEA NOT NULL CHECK (octet_length(receipt_bytes)>0), append_sequence BIGINT UNIQUE NOT NULL CHECK (append_sequence>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.bar_schedule_outbox_v1 (outbox_identity BYTEA PRIMARY KEY CHECK (octet_length(outbox_identity)=32), fact_digest BYTEA UNIQUE NOT NULL REFERENCES market_data_private.bar_schedule_facts_v1(fact_digest), receipt_bytes BYTEA NOT NULL CHECK (octet_length(receipt_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.strategy_input_sample_projection_receipts_v3 (receipt_digest BYTEA PRIMARY KEY CHECK (octet_length(receipt_digest)=32), kind SMALLINT NOT NULL CHECK (kind=1), lifecycle SMALLINT NOT NULL CHECK (lifecycle=2), subject_identity BYTEA NOT NULL CHECK (octet_length(subject_identity)=32), component_count BIGINT NOT NULL CHECK (component_count>0 AND component_count<=4294967295), receipt_bytes BYTEA NOT NULL, custody_digest BYTEA NOT NULL CHECK (octet_length(custody_digest)=32), UNIQUE(kind,lifecycle,subject_identity), CHECK (octet_length(receipt_bytes)=42+612*component_count))",
    "CREATE TABLE IF NOT EXISTS market_data_private.strategy_input_sample_projection_schedule_dependencies_v3 (receipt_digest BYTEA NOT NULL REFERENCES market_data_private.strategy_input_sample_projection_receipts_v3(receipt_digest) ON DELETE RESTRICT, component_ordinal BIGINT NOT NULL CHECK (component_ordinal>=0), role_identity BYTEA NOT NULL CHECK (octet_length(role_identity)=32), binding_receipt_digest BYTEA NOT NULL CHECK (octet_length(binding_receipt_digest)=32), schedule_readback_identity BYTEA NOT NULL REFERENCES market_data_private.bar_schedule_receipts_v1(readback_identity) ON DELETE RESTRICT CHECK (octet_length(schedule_readback_identity)=32), schedule_fact_digest BYTEA NOT NULL REFERENCES market_data_private.bar_schedule_facts_v1(fact_digest) ON DELETE RESTRICT CHECK (octet_length(schedule_fact_digest)=32), schedule_cut_identity BYTEA NOT NULL REFERENCES market_data_private.bar_schedule_cuts_v1(cut_identity) ON DELETE RESTRICT CHECK (octet_length(schedule_cut_identity)=32), schedule_cut_digest BYTEA NOT NULL CHECK (octet_length(schedule_cut_digest)=32), schedule_receipt_identity BYTEA NOT NULL REFERENCES market_data_private.bar_schedule_receipts_v1(receipt_identity) ON DELETE RESTRICT CHECK (octet_length(schedule_receipt_identity)=32), PRIMARY KEY(receipt_digest,component_ordinal), UNIQUE(receipt_digest,role_identity,binding_receipt_digest))",
    "CREATE TABLE IF NOT EXISTS market_data_private.clock_handoffs_v1 (head_identity BYTEA PRIMARY KEY CHECK (octet_length(head_identity) = 32), head_digest BYTEA NOT NULL UNIQUE CHECK (octet_length(head_digest) = 32), predecessor_head_digest BYTEA NULL UNIQUE REFERENCES market_data_private.clock_handoffs_v1(head_digest) CHECK (predecessor_head_digest IS NULL OR octet_length(predecessor_head_digest) = 32), clock_identity TEXT NOT NULL, clock_epoch TEXT NOT NULL, monotonic_sequence BIGINT NOT NULL CHECK (monotonic_sequence > 0), wall_observed BIGINT NOT NULL CHECK (wall_observed > 0), decision_cut BIGINT NOT NULL CHECK (decision_cut > 0), valid_through BIGINT NOT NULL, restart_continuity_digest BYTEA NOT NULL CHECK (octet_length(restart_continuity_digest) = 32), uncertainty_bound BIGINT NOT NULL CHECK (uncertainty_bound >= 0), skew_bound BIGINT NOT NULL CHECK (skew_bound > 0), comparison_rule SMALLINT NOT NULL CHECK (comparison_rule = 1), CHECK (uncertainty_bound <= skew_bound), CHECK (decision_cut <= wall_observed), CHECK (wall_observed < valid_through))",
    "CREATE TABLE IF NOT EXISTS market_data_private.clock_handoff_head_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), head_identity BYTEA NOT NULL UNIQUE REFERENCES market_data_private.clock_handoffs_v1(head_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.clock_handoff_state_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), materialized BOOLEAN NOT NULL, handoff_count BIGINT NOT NULL CHECK (handoff_count >= 0), epoch_transition_count BIGINT NOT NULL CHECK (epoch_transition_count >= 0), CHECK ((NOT materialized AND handoff_count = 0 AND epoch_transition_count = 0) OR (materialized AND handoff_count > 0 AND epoch_transition_count < handoff_count)))",
    "CREATE TABLE IF NOT EXISTS market_data_private.clock_handoff_membership_v1 (head_identity BYTEA PRIMARY KEY REFERENCES market_data_private.clock_handoffs_v1(head_identity), root_head_identity BYTEA NOT NULL REFERENCES market_data_private.clock_handoffs_v1(head_identity), ordinal BIGINT NOT NULL UNIQUE CHECK (ordinal > 0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.epoch_successor_proofs_v1 (proof_identity BYTEA PRIMARY KEY CHECK (octet_length(proof_identity) = 32), predecessor_head_digest BYTEA NOT NULL UNIQUE REFERENCES market_data_private.clock_handoffs_v1(head_digest), successor_head_digest BYTEA NOT NULL UNIQUE REFERENCES market_data_private.clock_handoffs_v1(head_digest), prior_clock_identity TEXT NOT NULL, prior_clock_epoch TEXT NOT NULL, successor_clock_identity TEXT NOT NULL, successor_clock_epoch TEXT NOT NULL, successor_continuity_digest BYTEA NOT NULL CHECK (octet_length(successor_continuity_digest) = 32), commit_cut BIGINT NOT NULL CHECK (commit_cut > 0), comparison_rule SMALLINT NOT NULL CHECK (comparison_rule = 1), CHECK (predecessor_head_digest <> successor_head_digest), CHECK (prior_clock_epoch <> successor_clock_epoch))",
    "CREATE TABLE IF NOT EXISTS market_data_private.source_binding_facts_v1 (binding_id BYTEA PRIMARY KEY CHECK (octet_length(binding_id) = 32), fact_digest BYTEA NOT NULL CHECK (octet_length(fact_digest) = 32), lineage_root BYTEA NOT NULL CHECK (octet_length(lineage_root) = 32), lineage_version BIGINT NOT NULL CHECK (lineage_version > 0), aggregate_json JSONB NOT NULL, UNIQUE(lineage_root, lineage_version))",
    "CREATE TABLE IF NOT EXISTS market_data_private.source_binding_heads_v1 (lineage_root BYTEA PRIMARY KEY CHECK (octet_length(lineage_root) = 32), binding_id BYTEA NOT NULL UNIQUE REFERENCES market_data_private.source_binding_facts_v1(binding_id), fact_digest BYTEA NOT NULL CHECK (octet_length(fact_digest) = 32), lineage_version BIGINT NOT NULL CHECK (lineage_version > 0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.source_binding_outbox_v1 (event_identity BYTEA PRIMARY KEY CHECK (octet_length(event_identity) = 32), aggregate_identity BYTEA NOT NULL UNIQUE REFERENCES market_data_private.source_binding_facts_v1(binding_id), payload_digest BYTEA NOT NULL CHECK (octet_length(payload_digest) = 32), payload BYTEA NOT NULL)",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_snapshot_facts_v1 (snapshot_identity BYTEA PRIMARY KEY CHECK (octet_length(snapshot_identity) = 32), fact_digest BYTEA NOT NULL CHECK (octet_length(fact_digest) = 32), request_identity BYTEA NOT NULL CHECK (octet_length(request_identity) = 32), request_digest BYTEA NOT NULL CHECK (octet_length(request_digest) = 32), correction_stream_identity TEXT NOT NULL, correction_sequence BIGINT NOT NULL CHECK (correction_sequence > 0), lineage_root BYTEA NOT NULL CHECK (octet_length(lineage_root) = 32), lineage_version BIGINT NOT NULL CHECK (lineage_version > 0), aggregate_json JSONB NOT NULL, UNIQUE(request_identity, correction_stream_identity, correction_sequence), UNIQUE(lineage_root, lineage_version))",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_snapshot_heads_v1 (lineage_root BYTEA PRIMARY KEY CHECK (octet_length(lineage_root) = 32), snapshot_identity BYTEA NOT NULL UNIQUE REFERENCES market_data_private.pit_snapshot_facts_v1(snapshot_identity), fact_digest BYTEA NOT NULL CHECK (octet_length(fact_digest) = 32), lineage_version BIGINT NOT NULL CHECK (lineage_version > 0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_snapshot_outbox_v1 (event_identity BYTEA PRIMARY KEY CHECK (octet_length(event_identity) = 32), aggregate_identity BYTEA NOT NULL UNIQUE REFERENCES market_data_private.pit_snapshot_facts_v1(snapshot_identity), payload_digest BYTEA NOT NULL CHECK (octet_length(payload_digest) = 32), payload BYTEA NOT NULL)",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_observation_batches_v1 (snapshot_identity BYTEA PRIMARY KEY REFERENCES market_data_private.pit_snapshot_facts_v1(snapshot_identity), source_binding_identity BYTEA NOT NULL CHECK (octet_length(source_binding_identity) = 32), source_binding_lineage_root BYTEA NOT NULL CHECK (octet_length(source_binding_lineage_root) = 32), source_binding_lineage_version BIGINT NOT NULL CHECK (source_binding_lineage_version > 0), batch_digest BYTEA NOT NULL CHECK (octet_length(batch_digest) = 32), batch_bytes BYTEA NOT NULL CHECK (octet_length(batch_bytes) > 0), row_count BIGINT NOT NULL CHECK (row_count > 0 AND row_count <= 10000))",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_observation_rows_v1 (snapshot_identity BYTEA NOT NULL REFERENCES market_data_private.pit_observation_batches_v1(snapshot_identity), ordinal BIGINT NOT NULL CHECK (ordinal > 0), symbolic_key TEXT NOT NULL CHECK (symbolic_key <> ''), member_key TEXT NOT NULL CHECK (member_key <> ''), row_bytes BYTEA NOT NULL CHECK (octet_length(row_bytes) > 0), PRIMARY KEY(snapshot_identity,ordinal), UNIQUE(snapshot_identity,symbolic_key,member_key))",
    "CREATE TABLE IF NOT EXISTS market_data_private.source_binding_lineage_census_v1 (lineage_root BYTEA PRIMARY KEY CHECK (octet_length(lineage_root) = 32))",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_snapshot_lineage_census_v1 (lineage_root BYTEA PRIMARY KEY CHECK (octet_length(lineage_root) = 32))",
    // One row per committed observation coordinate, so that a Design's authenticated input
    // role can be resolved to the Owner's own snapshot without scanning or decoding rows. The
    // coordinates are exactly what `request_matches_authenticated_role_v1` authenticates, and
    // the lineage root is part of the key: a correction advances its own lineage and is not
    // ambiguity, while two lineages answering one coordinate at one cut is, and resolution
    // fails closed on it rather than choosing.
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_role_coordinate_index_v1 (instrument TEXT NOT NULL CHECK (instrument <> ''), channel TEXT NOT NULL CHECK (channel <> ''), data_kind TEXT NOT NULL CHECK (data_kind <> ''), field TEXT NOT NULL CHECK (field <> ''), timeframe TEXT NOT NULL CHECK (timeframe <> ''), value_scale SMALLINT NOT NULL CHECK (value_scale >= 0 AND value_scale <= 255), decision_cut BIGINT NOT NULL CHECK (decision_cut > 0), lineage_root BYTEA NOT NULL CHECK (octet_length(lineage_root) = 32), lineage_version BIGINT NOT NULL CHECK (lineage_version > 0), snapshot_identity BYTEA NOT NULL REFERENCES market_data_private.pit_snapshot_facts_v1(snapshot_identity), PRIMARY KEY(instrument,channel,data_kind,field,timeframe,value_scale,decision_cut,lineage_root))",
    "CREATE TABLE IF NOT EXISTS market_data_private.native_replay_frame_census_v2 (scope_digest BYTEA NOT NULL CHECK (octet_length(scope_digest) = 32), frame_ordinal BIGINT NOT NULL CHECK (frame_ordinal > 0), snapshot_identity BYTEA NOT NULL UNIQUE REFERENCES market_data_private.pit_snapshot_facts_v1(snapshot_identity) ON DELETE RESTRICT, snapshot_fact_digest BYTEA NOT NULL CHECK (octet_length(snapshot_fact_digest) = 32), event_effective_ns BIGINT NOT NULL CHECK (event_effective_ns >= 0), decision_cut_ns BIGINT NOT NULL CHECK (decision_cut_ns >= 0), correction_branch_digest BYTEA NOT NULL CHECK (octet_length(correction_branch_digest) = 32), PRIMARY KEY (scope_digest, frame_ordinal))",
    // A quote cut is a PIT snapshot whose verified batch holds Quote rows and nothing else. It is
    // not a frame and takes no frame ordinal: a frame's liquidity is the one quote cut strictly
    // between its BAR and its bound, which the resolver finds by scope and event time.
    "CREATE TABLE IF NOT EXISTS market_data_private.native_replay_quote_cut_census_v2 (snapshot_identity BYTEA PRIMARY KEY REFERENCES market_data_private.pit_snapshot_facts_v1(snapshot_identity) ON DELETE RESTRICT, scope_digest BYTEA NOT NULL CHECK (octet_length(scope_digest) = 32), snapshot_fact_digest BYTEA NOT NULL CHECK (octet_length(snapshot_fact_digest) = 32), event_effective_ns BIGINT NOT NULL CHECK (event_effective_ns >= 0), decision_cut_ns BIGINT NOT NULL CHECK (decision_cut_ns >= 0), instrument_master_digest BYTEA NOT NULL CHECK (octet_length(instrument_master_digest) = 32), universe_selection_digest BYTEA NOT NULL CHECK (octet_length(universe_selection_digest) = 32), market_semantics_identity BYTEA NOT NULL CHECK (octet_length(market_semantics_identity) = 32), source_binding_lineage_root BYTEA NOT NULL CHECK (octet_length(source_binding_lineage_root) = 32), correction_lineage_root BYTEA NOT NULL CHECK (octet_length(correction_lineage_root) = 32), correction_lineage_version BIGINT NOT NULL CHECK (correction_lineage_version > 0))",
    "CREATE INDEX IF NOT EXISTS native_replay_quote_cut_census_v2_by_scope_and_time ON market_data_private.native_replay_quote_cut_census_v2 (scope_digest, event_effective_ns)",
    "CREATE INDEX IF NOT EXISTS native_replay_quote_cut_census_v2_by_lineage ON market_data_private.native_replay_quote_cut_census_v2 (correction_lineage_root, correction_lineage_version)",
    "CREATE TABLE IF NOT EXISTS market_data_private.native_replay_frame_sequences_v2 (sequence_identity BYTEA PRIMARY KEY CHECK (octet_length(sequence_identity) = 32), request_identity BYTEA NOT NULL UNIQUE CHECK (octet_length(request_identity) = 32), v1_binding_identity BYTEA NOT NULL CHECK (octet_length(v1_binding_identity) = 32), window_start_ns BIGINT NOT NULL CHECK (window_start_ns >= 0), window_end_ns_exclusive BIGINT NOT NULL CHECK (window_end_ns_exclusive > window_start_ns), first_snapshot_identity BYTEA NOT NULL CHECK (octet_length(first_snapshot_identity) = 32), second_snapshot_identity BYTEA NOT NULL CHECK (octet_length(second_snapshot_identity) = 32), sequence_bytes BYTEA NOT NULL CHECK (octet_length(sequence_bytes) > 0), receipt_identity BYTEA NOT NULL UNIQUE CHECK (octet_length(receipt_identity) = 32), receipt_bytes BYTEA NOT NULL CHECK (octet_length(receipt_bytes) > 0), CHECK (first_snapshot_identity <> second_snapshot_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.native_replay_frame_sequence_outbox_v2 (outbox_identity BYTEA PRIMARY KEY CHECK (octet_length(outbox_identity) = 32), sequence_identity BYTEA NOT NULL UNIQUE REFERENCES market_data_private.native_replay_frame_sequences_v2(sequence_identity) ON DELETE RESTRICT, payload_digest BYTEA NOT NULL CHECK (octet_length(payload_digest) = 32), payload BYTEA NOT NULL CHECK (octet_length(payload) > 0))",
    "CREATE OR REPLACE FUNCTION market_data_private.native_replay_frame_sequence_append_only() RETURNS trigger LANGUAGE plpgsql AS $native_replay_frame_sequence_append_only$ BEGIN RAISE EXCEPTION 'native replay frame sequence custody is append-only'; END $native_replay_frame_sequence_append_only$",
    "DROP TRIGGER IF EXISTS native_replay_frame_sequences_are_append_only ON market_data_private.native_replay_frame_sequences_v2",
    "CREATE TRIGGER native_replay_frame_sequences_are_append_only BEFORE UPDATE OR DELETE ON market_data_private.native_replay_frame_sequences_v2 FOR EACH ROW EXECUTE FUNCTION market_data_private.native_replay_frame_sequence_append_only()",
    "DROP TRIGGER IF EXISTS native_replay_frame_sequence_outbox_is_append_only ON market_data_private.native_replay_frame_sequence_outbox_v2",
    "CREATE TRIGGER native_replay_frame_sequence_outbox_is_append_only BEFORE UPDATE OR DELETE ON market_data_private.native_replay_frame_sequence_outbox_v2 FOR EACH ROW EXECUTE FUNCTION market_data_private.native_replay_frame_sequence_append_only()",
    "CREATE TABLE IF NOT EXISTS market_data_private.owner_history_census_state_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), source_lineage_count BIGINT NOT NULL CHECK (source_lineage_count >= 0), pit_lineage_count BIGINT NOT NULL CHECK (pit_lineage_count >= 0))",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_source_binding_v1(p_binding_id BYTEA) RETURNS TABLE(row_identity BYTEA, fact_digest BYTEA, request_identity BYTEA, request_digest BYTEA, correction_stream_identity TEXT, correction_sequence BIGINT, fact_lineage_root BYTEA, fact_lineage_version BIGINT, aggregate_json JSONB, outbox_event_identity BYTEA, outbox_aggregate_identity BYTEA, outbox_payload BYTEA, outbox_digest BYTEA, head_lineage_root BYTEA, head_identity BYTEA, head_digest BYTEA, head_version BIGINT, clock_identity TEXT, clock_epoch TEXT, monotonic_sequence BIGINT, wall_observed BIGINT, decision_cut BIGINT, valid_through BIGINT, restart_continuity_digest BYTEA, uncertainty_bound BIGINT, skew_bound BIGINT, comparison_rule SMALLINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT f.binding_id, f.fact_digest, NULL::BYTEA, NULL::BYTEA, NULL::TEXT, NULL::BIGINT, f.lineage_root, f.lineage_version, f.aggregate_json, o.event_identity, o.aggregate_identity, o.payload, o.payload_digest, h.lineage_root, h.binding_id, h.fact_digest, h.lineage_version, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::BIGINT, NULL::BIGINT, NULL::BIGINT, NULL::BYTEA, NULL::BIGINT, NULL::BIGINT, NULL::SMALLINT FROM market_data_private.source_binding_facts_v1 AS f JOIN market_data_private.source_binding_outbox_v1 AS o ON o.aggregate_identity = f.binding_id JOIN market_data_private.source_binding_heads_v1 AS h ON h.lineage_root = f.lineage_root WHERE f.binding_id = p_binding_id $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_pit_snapshot_v1(p_snapshot_identity BYTEA) RETURNS TABLE(row_identity BYTEA, fact_digest BYTEA, request_identity BYTEA, request_digest BYTEA, correction_stream_identity TEXT, correction_sequence BIGINT, fact_lineage_root BYTEA, fact_lineage_version BIGINT, aggregate_json JSONB, outbox_event_identity BYTEA, outbox_aggregate_identity BYTEA, outbox_payload BYTEA, outbox_digest BYTEA, head_lineage_root BYTEA, head_identity BYTEA, head_digest BYTEA, head_version BIGINT, clock_identity TEXT, clock_epoch TEXT, monotonic_sequence BIGINT, wall_observed BIGINT, decision_cut BIGINT, valid_through BIGINT, restart_continuity_digest BYTEA, uncertainty_bound BIGINT, skew_bound BIGINT, comparison_rule SMALLINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT f.snapshot_identity, f.fact_digest, f.request_identity, f.request_digest, f.correction_stream_identity, f.correction_sequence, f.lineage_root, f.lineage_version, f.aggregate_json, o.event_identity, o.aggregate_identity, o.payload, o.payload_digest, h.lineage_root, h.snapshot_identity, h.fact_digest, h.lineage_version, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::BIGINT, NULL::BIGINT, NULL::BIGINT, NULL::BYTEA, NULL::BIGINT, NULL::BIGINT, NULL::SMALLINT FROM market_data_private.pit_snapshot_facts_v1 AS f JOIN market_data_private.pit_snapshot_outbox_v1 AS o ON o.aggregate_identity = f.snapshot_identity JOIN market_data_private.pit_snapshot_heads_v1 AS h ON h.lineage_root = f.lineage_root WHERE f.snapshot_identity = p_snapshot_identity $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_pit_observation_batch_v1(p_snapshot_identity BYTEA) RETURNS TABLE(source_binding_identity BYTEA, source_binding_lineage_root BYTEA, source_binding_lineage_version BIGINT, batch_digest BYTEA, batch_bytes BYTEA, row_count BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT b.source_binding_identity,b.source_binding_lineage_root,b.source_binding_lineage_version,b.batch_digest,b.batch_bytes,b.row_count FROM market_data_private.pit_observation_batches_v1 AS b WHERE b.snapshot_identity=p_snapshot_identity AND b.row_count=(SELECT COUNT(*) FROM market_data_private.pit_observation_rows_v1 AS r WHERE r.snapshot_identity=b.snapshot_identity) $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_pit_observation_rows_v1(p_snapshot_identity BYTEA) RETURNS TABLE(ordinal BIGINT,symbolic_key TEXT,member_key TEXT,row_bytes BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT r.ordinal,r.symbolic_key,r.member_key,r.row_bytes FROM market_data_private.pit_observation_rows_v1 AS r WHERE r.snapshot_identity=p_snapshot_identity ORDER BY r.ordinal $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_source_lineage_custody_v1(p_lineage_root BYTEA) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT EXISTS(SELECT 1 FROM market_data_private.source_binding_heads_v1 AS h WHERE h.lineage_root=p_lineage_root AND h.lineage_version=(SELECT COUNT(*) FROM market_data_private.source_binding_facts_v1 AS f WHERE f.lineage_root=p_lineage_root) AND h.lineage_version=(SELECT COUNT(*) FROM market_data_private.source_binding_outbox_v1 AS o JOIN market_data_private.source_binding_facts_v1 AS f ON f.binding_id=o.aggregate_identity WHERE f.lineage_root=p_lineage_root) AND h.lineage_version=(SELECT MAX(f.lineage_version) FROM market_data_private.source_binding_facts_v1 AS f WHERE f.lineage_root=p_lineage_root)) $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_pit_lineage_custody_v1(p_lineage_root BYTEA) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT EXISTS(SELECT 1 FROM market_data_private.pit_snapshot_heads_v1 AS h WHERE h.lineage_root=p_lineage_root AND h.lineage_version=(SELECT COUNT(*) FROM market_data_private.pit_snapshot_facts_v1 AS f WHERE f.lineage_root=p_lineage_root) AND h.lineage_version=(SELECT COUNT(*) FROM market_data_private.pit_snapshot_outbox_v1 AS o JOIN market_data_private.pit_snapshot_facts_v1 AS f ON f.snapshot_identity=o.aggregate_identity WHERE f.lineage_root=p_lineage_root) AND h.lineage_version=(SELECT MAX(f.lineage_version) FROM market_data_private.pit_snapshot_facts_v1 AS f WHERE f.lineage_root=p_lineage_root)) $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_source_lineage_members_v1(p_lineage_root BYTEA) RETURNS TABLE(member_identity BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT f.binding_id FROM market_data_private.source_binding_facts_v1 AS f WHERE f.lineage_root=p_lineage_root ORDER BY f.lineage_version $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_pit_lineage_members_v1(p_lineage_root BYTEA) RETURNS TABLE(member_identity BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT f.snapshot_identity FROM market_data_private.pit_snapshot_facts_v1 AS f WHERE f.lineage_root=p_lineage_root ORDER BY f.lineage_version $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_source_lineage_roots_v1() RETURNS TABLE(lineage_root BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT lineage_root FROM market_data_private.source_binding_lineage_census_v1 ORDER BY lineage_root $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_pit_lineage_roots_v1() RETURNS TABLE(lineage_root BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT lineage_root FROM market_data_private.pit_snapshot_lineage_census_v1 ORDER BY lineage_root $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_owner_history_census_custody_v1() RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT EXISTS(SELECT 1 FROM market_data_private.owner_history_census_state_v1 AS s WHERE s.singleton AND s.source_lineage_count=(SELECT COUNT(*) FROM market_data_private.source_binding_lineage_census_v1) AND s.pit_lineage_count=(SELECT COUNT(*) FROM market_data_private.pit_snapshot_lineage_census_v1)) AND EXISTS(SELECT 1 FROM market_data_private.owner_migrations_v1 WHERE migration_id='market-data-owner-history-census-v1') AND NOT EXISTS(SELECT 1 FROM market_data_private.source_binding_facts_v1 AS f LEFT JOIN market_data_private.source_binding_lineage_census_v1 AS c ON c.lineage_root=f.lineage_root WHERE c.lineage_root IS NULL) AND NOT EXISTS(SELECT 1 FROM market_data_private.source_binding_heads_v1 AS h LEFT JOIN market_data_private.source_binding_lineage_census_v1 AS c ON c.lineage_root=h.lineage_root WHERE c.lineage_root IS NULL) AND NOT EXISTS(SELECT 1 FROM market_data_private.pit_snapshot_facts_v1 AS f LEFT JOIN market_data_private.pit_snapshot_lineage_census_v1 AS c ON c.lineage_root=f.lineage_root WHERE c.lineage_root IS NULL) AND NOT EXISTS(SELECT 1 FROM market_data_private.pit_snapshot_heads_v1 AS h LEFT JOIN market_data_private.pit_snapshot_lineage_census_v1 AS c ON c.lineage_root=h.lineage_root WHERE c.lineage_root IS NULL) $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_clock_handoff_v1(p_head_identity BYTEA) RETURNS TABLE(head_identity BYTEA, head_digest BYTEA, predecessor_head_digest BYTEA, clock_identity TEXT, clock_epoch TEXT, monotonic_sequence BIGINT, wall_observed BIGINT, decision_cut BIGINT, valid_through BIGINT, restart_continuity_digest BYTEA, uncertainty_bound BIGINT, skew_bound BIGINT, comparison_rule SMALLINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT h.head_identity,h.head_digest,h.predecessor_head_digest,h.clock_identity,h.clock_epoch,h.monotonic_sequence,h.wall_observed,h.decision_cut,h.valid_through,h.restart_continuity_digest,h.uncertainty_bound,h.skew_bound,h.comparison_rule FROM market_data_private.clock_handoffs_v1 AS h WHERE h.head_identity=p_head_identity $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_epoch_successor_proof_v1(p_successor_head_digest BYTEA) RETURNS TABLE(proof_identity BYTEA, predecessor_head_digest BYTEA, successor_head_digest BYTEA, prior_clock_identity TEXT, prior_clock_epoch TEXT, successor_clock_identity TEXT, successor_clock_epoch TEXT, successor_continuity_digest BYTEA, commit_cut BIGINT, comparison_rule SMALLINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT p.proof_identity,p.predecessor_head_digest,p.successor_head_digest,p.prior_clock_identity,p.prior_clock_epoch,p.successor_clock_identity,p.successor_clock_epoch,p.successor_continuity_digest,p.commit_cut,p.comparison_rule FROM market_data_private.epoch_successor_proofs_v1 AS p WHERE p.successor_head_digest=p_successor_head_digest $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_clock_membership_custody_v1() RETURNS TABLE(handoff_count BIGINT, head_identity BYTEA, root_head_identity BYTEA, ordinal BIGINT, prior_head_identity BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT state.handoff_count,edge.head_identity,edge.root_head_identity,edge.ordinal,edge.prior_head_identity FROM market_data_private.clock_handoff_state_v1 AS state LEFT JOIN LATERAL (SELECT membership.head_identity,membership.root_head_identity,membership.ordinal,prior.head_identity AS prior_head_identity FROM market_data_private.clock_handoff_membership_v1 AS membership JOIN market_data_private.clock_handoffs_v1 AS handoff ON handoff.head_identity=membership.head_identity LEFT JOIN market_data_private.clock_handoffs_v1 AS prior ON prior.head_digest=handoff.predecessor_head_digest) AS edge ON TRUE WHERE state.singleton $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_clock_custody_state_v1() RETURNS TABLE(head_identity BYTEA, head_digest BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ SELECT h.head_identity,h.head_digest FROM market_data_private.clock_handoff_state_v1 AS s JOIN market_data_private.clock_head_v1 AS c ON c.singleton AND c.shared_time_materialized JOIN market_data_private.clock_handoff_head_v1 AS p ON p.singleton JOIN market_data_private.clock_handoffs_v1 AS h ON h.head_identity=p.head_identity JOIN market_data_private.clock_handoff_membership_v1 AS current_membership ON current_membership.head_identity=h.head_identity AND current_membership.ordinal=s.handoff_count WHERE s.singleton AND s.materialized AND s.handoff_count=(SELECT COUNT(*) FROM market_data_private.clock_handoffs_v1) AND s.handoff_count=(SELECT COUNT(*) FROM market_data_private.clock_handoff_membership_v1) AND s.epoch_transition_count=(SELECT COUNT(*) FROM market_data_private.epoch_successor_proofs_v1) AND s.epoch_transition_count=(SELECT COUNT(*) FROM market_data_private.clock_handoffs_v1 AS successor JOIN market_data_private.clock_handoffs_v1 AS prior ON prior.head_digest=successor.predecessor_head_digest WHERE successor.clock_epoch<>prior.clock_epoch) AND 1=(SELECT COUNT(*) FROM market_data_private.clock_handoff_membership_v1 AS root_membership JOIN market_data_private.clock_handoffs_v1 AS root_handoff ON root_handoff.head_identity=root_membership.head_identity WHERE root_membership.ordinal=1 AND root_membership.root_head_identity=root_membership.head_identity AND root_handoff.predecessor_head_digest IS NULL) AND NOT EXISTS (SELECT 1 FROM market_data_private.clock_handoff_membership_v1 AS membership JOIN market_data_private.clock_handoffs_v1 AS handoff ON handoff.head_identity=membership.head_identity LEFT JOIN market_data_private.clock_handoffs_v1 AS prior ON prior.head_digest=handoff.predecessor_head_digest LEFT JOIN market_data_private.clock_handoff_membership_v1 AS prior_membership ON prior_membership.head_identity=prior.head_identity WHERE (membership.ordinal=1 AND (membership.root_head_identity<>membership.head_identity OR handoff.predecessor_head_digest IS NOT NULL)) OR (membership.ordinal>1 AND (prior_membership.head_identity IS NULL OR membership.root_head_identity<>prior_membership.root_head_identity OR membership.ordinal<>prior_membership.ordinal+1))) AND EXISTS (SELECT 1 FROM market_data_private.owner_migrations_v1 AS m WHERE m.migration_id='market-data-owner-shared-time-v1') AND h.clock_identity=c.clock_identity AND h.clock_epoch=c.clock_epoch AND h.monotonic_sequence=c.monotonic_sequence AND h.wall_observed=c.wall_observed AND h.decision_cut=c.decision_cut AND h.valid_through=c.valid_through AND h.restart_continuity_digest=c.restart_continuity_digest AND h.uncertainty_bound=c.uncertainty_bound AND h.skew_bound=c.skew_bound AND h.comparison_rule=c.comparison_rule $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_instrument_master_receipt_v1(p_request_identity BYTEA) RETURNS TABLE(request_identity BYTEA,request_meaning_digest BYTEA,cut_identity BYTEA,cut_bytes BYTEA,receipt_identity BYTEA,receipt_bytes BYTEA,outbox_identity BYTEA,outbox_receipt_bytes BYTEA,store_generation_identity BYTEA,append_sequence BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT r.request_identity,r.request_meaning_digest,c.cut_identity,c.cut_bytes,r.receipt_identity,r.receipt_bytes,o.outbox_identity,o.receipt_bytes,s.store_generation_identity,r.append_sequence FROM market_data_private.instrument_master_receipts_v1 AS r JOIN market_data_private.instrument_master_cuts_v1 AS c ON c.request_identity=r.request_identity AND c.cut_identity=r.cut_identity JOIN market_data_private.instrument_master_outbox_v1 AS o ON o.request_identity=r.request_identity AND o.outbox_identity=r.receipt_identity AND o.receipt_bytes=r.receipt_bytes JOIN market_data_private.instrument_master_state_v1 AS s ON s.singleton AND s.append_sequence=(SELECT COUNT(*) FROM market_data_private.instrument_master_receipts_v1) AND s.append_sequence=(SELECT COUNT(*) FROM market_data_private.instrument_master_cuts_v1) AND s.append_sequence=(SELECT COUNT(*) FROM market_data_private.instrument_master_outbox_v1) WHERE r.request_identity=p_request_identity $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_timeframe_projection_receipt_v1(p_receipt_digest BYTEA) RETURNS TABLE(receipt_digest BYTEA,binding_receipt_digest BYTEA,receipt_bytes BYTEA,custody_digest BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT p.receipt_digest,p.binding_receipt_digest,p.receipt_bytes,p.custody_digest FROM market_data_private.timeframe_projection_receipts_v1 AS p WHERE p.receipt_digest=p_receipt_digest $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_sample_receipt_v1(p_receipt_digest BYTEA) RETURNS TABLE(sample_identity BYTEA,fact_digest BYTEA,series_identity BYTEA,series_predecessor_identity BYTEA,series_sequence BIGINT,correction_slot_identity BYTEA,correction_predecessor_identity BYTEA,correction_sequence BIGINT,logical_time BIGINT,lineage_version BIGINT,projection_receipt_digest BYTEA,projection_binding_receipt_digest BYTEA,projection_receipt_bytes BYTEA,projection_custody_digest BYTEA,fact_bytes BYTEA,fact_custody_digest BYTEA,receipt_digest BYTEA,receipt_bytes BYTEA,receipt_custody_digest BYTEA,outbox_identity BYTEA,outbox_payload_digest BYTEA,outbox_payload_bytes BYTEA,outbox_custody_digest BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT f.sample_identity,f.fact_digest,f.series_identity,f.series_predecessor_identity,f.series_sequence,f.correction_slot_identity,f.correction_predecessor_identity,f.correction_sequence,f.logical_time,f.lineage_version,f.projection_receipt_digest,p.binding_receipt_digest,p.receipt_bytes,p.custody_digest,f.fact_bytes,f.custody_digest,r.receipt_digest,r.receipt_bytes,r.custody_digest,o.outbox_identity,o.payload_digest,o.payload_bytes,o.custody_digest FROM market_data_private.sample_receipts_v1 AS r JOIN market_data_private.sample_facts_v1 AS f ON f.sample_identity=r.sample_identity JOIN market_data_private.timeframe_projection_receipts_v1 AS p ON p.receipt_digest=f.projection_receipt_digest JOIN market_data_private.sample_outbox_v1 AS o ON o.sample_identity=f.sample_identity WHERE r.receipt_digest=p_receipt_digest $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_strategy_input_sample_projection_v2(p_receipt_digest BYTEA) RETURNS TABLE(receipt_digest BYTEA,kind SMALLINT,subject_identity BYTEA,component_count BIGINT,receipt_bytes BYTEA,custody_digest BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT p.receipt_digest,p.kind,p.subject_identity,p.component_count,p.receipt_bytes,p.custody_digest FROM market_data_private.strategy_input_sample_projection_receipts_v2 AS p WHERE p.receipt_digest=p_receipt_digest $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_bar_schedule_v1(p_readback_identity BYTEA) RETURNS TABLE(fact_digest BYTEA,canonical_instrument TEXT,predecessor_fact_digest BYTEA,fact_bytes BYTEA,cut_identity BYTEA,cut_bytes BYTEA,readback_identity BYTEA,receipt_identity BYTEA,receipt_bytes BYTEA,append_sequence BIGINT,outbox_identity BYTEA,outbox_receipt_bytes BYTEA,store_generation_identity BYTEA,state_append_sequence BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT f.fact_digest,f.canonical_instrument,f.predecessor_fact_digest,f.fact_bytes,c.cut_identity,c.cut_bytes,r.readback_identity,r.receipt_identity,r.receipt_bytes,r.append_sequence,o.outbox_identity,o.receipt_bytes,s.store_generation_identity,s.append_sequence FROM market_data_private.bar_schedule_receipts_v1 AS r JOIN market_data_private.bar_schedule_facts_v1 AS f ON f.fact_digest=r.fact_digest JOIN market_data_private.bar_schedule_cuts_v1 AS c ON c.fact_digest=f.fact_digest JOIN market_data_private.bar_schedule_outbox_v1 AS o ON o.fact_digest=f.fact_digest AND o.outbox_identity=r.receipt_identity AND o.receipt_bytes=r.receipt_bytes JOIN market_data_private.bar_schedule_state_v1 AS s ON s.singleton AND s.append_sequence=(SELECT COUNT(*) FROM market_data_private.bar_schedule_facts_v1) AND s.append_sequence=(SELECT COUNT(*) FROM market_data_private.bar_schedule_cuts_v1) AND s.append_sequence=(SELECT COUNT(*) FROM market_data_private.bar_schedule_receipts_v1) AND s.append_sequence=(SELECT COUNT(*) FROM market_data_private.bar_schedule_outbox_v1) WHERE r.readback_identity=p_readback_identity $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_bar_schedule_candidates_v1(p_canonical_instrument TEXT) RETURNS TABLE(fact_digest BYTEA,canonical_instrument TEXT,predecessor_fact_digest BYTEA,fact_bytes BYTEA,cut_identity BYTEA,cut_bytes BYTEA,readback_identity BYTEA,receipt_identity BYTEA,receipt_bytes BYTEA,append_sequence BIGINT,outbox_identity BYTEA,outbox_receipt_bytes BYTEA,store_generation_identity BYTEA,state_append_sequence BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT f.fact_digest,f.canonical_instrument,f.predecessor_fact_digest,f.fact_bytes,c.cut_identity,c.cut_bytes,r.readback_identity,r.receipt_identity,r.receipt_bytes,r.append_sequence,o.outbox_identity,o.receipt_bytes,s.store_generation_identity,s.append_sequence FROM market_data_private.bar_schedule_receipts_v1 AS r JOIN market_data_private.bar_schedule_facts_v1 AS f ON f.fact_digest=r.fact_digest JOIN market_data_private.bar_schedule_cuts_v1 AS c ON c.fact_digest=f.fact_digest JOIN market_data_private.bar_schedule_outbox_v1 AS o ON o.fact_digest=f.fact_digest AND o.outbox_identity=r.receipt_identity AND o.receipt_bytes=r.receipt_bytes JOIN market_data_private.bar_schedule_state_v1 AS s ON s.singleton AND s.append_sequence=(SELECT COUNT(*) FROM market_data_private.bar_schedule_facts_v1) AND s.append_sequence=(SELECT COUNT(*) FROM market_data_private.bar_schedule_cuts_v1) AND s.append_sequence=(SELECT COUNT(*) FROM market_data_private.bar_schedule_receipts_v1) AND s.append_sequence=(SELECT COUNT(*) FROM market_data_private.bar_schedule_outbox_v1) WHERE f.canonical_instrument=p_canonical_instrument ORDER BY r.readback_identity $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_bar_schedule_history_v1(p_canonical_instrument TEXT) RETURNS TABLE(head_fact_digest BYTEA,fact_digest BYTEA,predecessor_fact_digest BYTEA,fact_bytes BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT h.fact_digest,f.fact_digest,f.predecessor_fact_digest,f.fact_bytes FROM (SELECT fact_digest FROM market_data_private.bar_schedule_heads_v1 WHERE canonical_instrument=p_canonical_instrument) AS h FULL OUTER JOIN (SELECT fact_digest,predecessor_fact_digest,fact_bytes FROM market_data_private.bar_schedule_facts_v1 WHERE canonical_instrument=p_canonical_instrument) AS f ON TRUE $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_strategy_input_sample_projection_v3(p_receipt_digest BYTEA) RETURNS TABLE(receipt_digest BYTEA,kind SMALLINT,lifecycle SMALLINT,subject_identity BYTEA,component_count BIGINT,receipt_bytes BYTEA,custody_digest BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT p.receipt_digest,p.kind,p.lifecycle,p.subject_identity,p.component_count,p.receipt_bytes,p.custody_digest FROM market_data_private.strategy_input_sample_projection_receipts_v3 AS p WHERE p.receipt_digest=p_receipt_digest $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_strategy_input_sample_projection_schedule_dependencies_v3(p_receipt_digest BYTEA) RETURNS TABLE(component_ordinal BIGINT,role_identity BYTEA,binding_receipt_digest BYTEA,schedule_readback_identity BYTEA,schedule_fact_digest BYTEA,schedule_cut_identity BYTEA,schedule_cut_digest BYTEA,schedule_receipt_identity BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT d.component_ordinal,d.role_identity,d.binding_receipt_digest,d.schedule_readback_identity,d.schedule_fact_digest,d.schedule_cut_identity,d.schedule_cut_digest,d.schedule_receipt_identity FROM market_data_private.strategy_input_sample_projection_schedule_dependencies_v3 AS d WHERE d.receipt_digest=p_receipt_digest ORDER BY d.component_ordinal $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_pit_role_coordinate_v1(p_instrument TEXT, p_channel TEXT, p_data_kind TEXT, p_field TEXT, p_timeframe TEXT, p_value_scale SMALLINT, p_decision_cut_at_or_before BIGINT) RETURNS TABLE(decision_cut BIGINT, lineage_root BYTEA, snapshot_identity BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$ WITH matched AS (SELECT i.decision_cut, i.lineage_root, i.lineage_version FROM market_data_private.pit_role_coordinate_index_v1 AS i WHERE i.instrument = p_instrument AND i.channel = p_channel AND i.data_kind = p_data_kind AND i.field = p_field AND i.timeframe = p_timeframe AND i.value_scale = p_value_scale AND i.decision_cut <= p_decision_cut_at_or_before) SELECT m.decision_cut, m.lineage_root, h.snapshot_identity FROM matched AS m JOIN market_data_private.pit_snapshot_heads_v1 AS h ON h.lineage_root = m.lineage_root AND h.lineage_version = m.lineage_version WHERE m.decision_cut = (SELECT MAX(decision_cut) FROM matched) ORDER BY m.lineage_root $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_native_replay_quote_cut_census_v2(p_scope_digest BYTEA, p_after_ns BIGINT, p_before_ns BIGINT) RETURNS TABLE(snapshot_identity BYTEA,snapshot_fact_digest BYTEA,scope_digest BYTEA,event_effective_ns BIGINT,decision_cut_ns BIGINT,instrument_master_digest BYTEA,universe_selection_digest BYTEA,market_semantics_identity BYTEA,source_binding_lineage_root BYTEA,correction_lineage_root BYTEA,correction_lineage_version BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$ SELECT c.snapshot_identity,c.snapshot_fact_digest,c.scope_digest,c.event_effective_ns,c.decision_cut_ns,c.instrument_master_digest,c.universe_selection_digest,c.market_semantics_identity,c.source_binding_lineage_root,c.correction_lineage_root,c.correction_lineage_version FROM market_data_private.native_replay_quote_cut_census_v2 AS c WHERE c.correction_lineage_root IN (SELECT i.correction_lineage_root FROM market_data_private.native_replay_quote_cut_census_v2 AS i WHERE i.scope_digest = p_scope_digest AND i.event_effective_ns > p_after_ns AND i.event_effective_ns < p_before_ns) ORDER BY c.correction_lineage_root,c.correction_lineage_version,c.snapshot_identity $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_native_replay_next_frame_v2(p_scope_digest BYTEA, p_after_ns BIGINT, p_decision_cut_ns BIGINT) RETURNS TABLE(event_effective_ns BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$ SELECT f.event_effective_ns FROM market_data_private.native_replay_frame_census_v2 AS f WHERE f.scope_digest = p_scope_digest AND f.event_effective_ns > p_after_ns AND f.decision_cut_ns <= p_decision_cut_ns ORDER BY f.event_effective_ns LIMIT 1 $function$",
    "REVOKE ALL ON ALL TABLES IN SCHEMA market_data_private FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_source_binding_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_pit_snapshot_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_pit_observation_batch_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_pit_observation_rows_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_pit_role_coordinate_v1(TEXT,TEXT,TEXT,TEXT,TEXT,SMALLINT,BIGINT) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_source_lineage_custody_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_pit_lineage_custody_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_source_lineage_members_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_pit_lineage_members_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_source_lineage_roots_v1() FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_pit_lineage_roots_v1() FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_owner_history_census_custody_v1() FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_clock_handoff_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_epoch_successor_proof_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_clock_membership_custody_v1() FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_clock_custody_state_v1() FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_instrument_master_receipt_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_timeframe_projection_receipt_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_sample_receipt_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_strategy_input_sample_projection_v2(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_bar_schedule_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_bar_schedule_candidates_v1(TEXT) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_bar_schedule_history_v1(TEXT) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_strategy_input_sample_projection_v3(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_strategy_input_sample_projection_schedule_dependencies_v3(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_native_replay_quote_cut_census_v2(BYTEA,BIGINT,BIGINT) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_native_replay_next_frame_v2(BYTEA,BIGINT,BIGINT) FROM PUBLIC",
];

pub(crate) struct MarketDataOwnerPostgres {
    pool: PgPool,
}

pub(crate) struct MarketDataReadPostgres {
    #[cfg(test)]
    pub(crate) pool: PgPool,
    #[cfg(not(test))]
    admitted_port: AdmittedMarketDataSnapshotPort,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ObservationCensusFaultV1 {
    None,
    RollbackBeforeCommit,
    ResponseLoss,
}

/// Unforgeable proof that PostgreSQL custody and every native dependency were verified.
///
/// Only this module can construct the proof. The projection contract may consume it, while other
/// Owner siblings cannot promote structurally coherent caller-authored bytes.
pub(super) struct StrategyInputSampleProjectionPostgresProofV2 {
    decoded: DecodedStrategyInputSampleProjectionV2,
}

/// Unforgeable proof that complete V3 BAR PostgreSQL custody was verified.
pub(super) struct StrategyInputSampleProjectionPostgresProofV3 {
    decoded: DecodedStrategyInputSampleProjectionV3,
}

impl StrategyInputSampleProjectionPostgresProofV3 {
    fn new(decoded: DecodedStrategyInputSampleProjectionV3) -> Self {
        Self { decoded }
    }

    pub(super) fn into_decoded(self) -> DecodedStrategyInputSampleProjectionV3 {
        self.decoded
    }
}

impl StrategyInputSampleProjectionPostgresProofV2 {
    fn new(decoded: DecodedStrategyInputSampleProjectionV2) -> Self {
        Self { decoded }
    }

    pub(super) fn into_decoded(self) -> DecodedStrategyInputSampleProjectionV2 {
        self.decoded
    }
}

impl MarketDataOwnerPostgres {
    pub(crate) async fn connect(database_url: &str) -> Result<Self, SourceBindingError> {
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .connect(database_url)
            .await
            .map_err(|e| {
                super::storage_diagnostic::refused_by_store("market_data_owner.connect.pool", &e);
                SourceBindingError::StoreUnavailable
            })?;
        let owner = Self { pool };
        owner.migrate().await?;
        Ok(owner)
    }

    /// The twelve conditions `connect_existing` admits this connection against, by name.
    ///
    /// They were one `AND` chain answered by a single boolean, so every way of failing them
    /// produced `StoreUnavailable` and nothing else - the same value a store that is genuinely
    /// down produces. Connecting as the wrong role, connecting to a replica, and connecting to a
    /// database this Owner has never migrated were one answer.
    ///
    /// This list is the readable form. `ADMISSION_SQL_V1` is what runs, and
    /// `the_admission_query_names_every_condition_it_checks` holds the two together, because a
    /// dynamic string cannot be sent here and a hand-maintained copy would drift.
    const ADMISSION_CONDITIONS_V1: &'static [(&'static str, &'static str)] = &[
        ("session_user", "session_user='market_data_owner'"),
        ("current_user", "current_user='market_data_owner'"),
        ("not_in_recovery", "NOT pg_catalog.pg_is_in_recovery()"),
        (
            "owner_migrations_present",
            "pg_catalog.to_regclass('market_data_private.owner_migrations_v1') IS NOT NULL",
        ),
        ("rolcanlogin", "role.rolcanlogin"),
        ("rolinherit", "role.rolinherit"),
        ("not_rolsuper", "NOT role.rolsuper"),
        ("not_rolcreatedb", "NOT role.rolcreatedb"),
        ("not_rolcreaterole", "NOT role.rolcreaterole"),
        ("not_rolreplication", "NOT role.rolreplication"),
        ("not_rolbypassrls", "NOT role.rolbypassrls"),
        (
            "no_role_membership",
            "NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members membership WHERE membership.member=role.oid OR membership.roleid=role.oid)",
        ),
    ];

    /// One round trip that still decides admission, and answers with the names that refused it.
    const ADMISSION_SQL_V1: &'static str = "SELECT pg_catalog.array_to_string(pg_catalog.array_remove(ARRAY[CASE WHEN session_user='market_data_owner' THEN NULL ELSE 'session_user' END,CASE WHEN current_user='market_data_owner' THEN NULL ELSE 'current_user' END,CASE WHEN NOT pg_catalog.pg_is_in_recovery() THEN NULL ELSE 'not_in_recovery' END,CASE WHEN pg_catalog.to_regclass('market_data_private.owner_migrations_v1') IS NOT NULL THEN NULL ELSE 'owner_migrations_present' END,CASE WHEN role.rolcanlogin THEN NULL ELSE 'rolcanlogin' END,CASE WHEN role.rolinherit THEN NULL ELSE 'rolinherit' END,CASE WHEN NOT role.rolsuper THEN NULL ELSE 'not_rolsuper' END,CASE WHEN NOT role.rolcreatedb THEN NULL ELSE 'not_rolcreatedb' END,CASE WHEN NOT role.rolcreaterole THEN NULL ELSE 'not_rolcreaterole' END,CASE WHEN NOT role.rolreplication THEN NULL ELSE 'not_rolreplication' END,CASE WHEN NOT role.rolbypassrls THEN NULL ELSE 'not_rolbypassrls' END,CASE WHEN NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members membership WHERE membership.member=role.oid OR membership.roleid=role.oid) THEN NULL ELSE 'no_role_membership' END]::text[], NULL), ',') FROM pg_catalog.pg_roles role WHERE role.rolname=current_user";

    pub(crate) async fn connect_existing(database_url: &str) -> Result<Self, SourceBindingError> {
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .connect(database_url)
            .await
            .map_err(|e| {
                super::storage_diagnostic::refused_by_store(
                    "market_data_owner.connect_existing.pool",
                    &e,
                );
                SourceBindingError::StoreUnavailable
            })?;

        let refused: String = sqlx::query_scalar(Self::ADMISSION_SQL_V1)
            .fetch_one(&pool)
            .await
            .map_err(|e| {
                // `fetch_one` also fails when the row is absent, which is its own fact: the
                // connected role has no `pg_roles` entry to admit, and none of the conditions
                // above were read at all.
                super::storage_diagnostic::refused_by_store(
                    "market_data_owner.connect_existing.admission_query",
                    &e,
                );
                SourceBindingError::StoreUnavailable
            })?;

        if !refused.is_empty() {
            super::storage_diagnostic::refused_by_store(
                "market_data_owner.connect_existing.admission",
                &format!("this connection does not satisfy: {refused}"),
            );
            return Err(SourceBindingError::StoreUnavailable);
        }

        Ok(Self { pool })
    }

    #[allow(
        clippy::unused_async,
        reason = "the fail-closed legacy resolver retains the asynchronous Owner resolver seam"
    )]
    pub(crate) async fn resolve_replay_market_facts_readback_v2(
        &self,
        _request: &UntrustedReplayMarketFactsRequestV2,
    ) -> Result<ReplayMarketFactsReadbackV2, ReplayMarketFactsErrorV2> {
        // Native Replay V2 rows are sealed against a composition binding. This legacy request has
        // no binding locator, so resolving it could only guess among distinct bound meanings.
        Err(ReplayMarketFactsErrorV2::CustodyUnavailable)
    }

    /// Resolves a sealed request window's frame sequence, from Owner custody alone.
    ///
    /// `docs/owners/market-data.md` admits "no caller-supplied second PIT locator, timestamp,
    /// frame list, raw row, price, quantity, schedule, pool or replacement resolver". The caller
    /// therefore names only the first frame - the one its sealed request already fixes - and the
    /// rest of the sequence comes out of the scope census or not at all. There is no parameter
    /// through which another snapshot could be offered.
    ///
    /// These are the rules a census row can decide on its own. Scope and liquidity order need each
    /// frame's resolved schedule and Quote evidence, so `admit_frame_census_v2` checks those once
    /// the caller has resolved them; this function never claims to have checked them.
    ///
    /// # Errors
    ///
    /// Returns the exact [`NativeReplayFrameCensusRefusalV2`] for the first violated rule.
    pub(crate) async fn resolve_native_replay_census_sequence_v2(
        &self,
        scope_digest: BindingDigest,
        first_frame_snapshot_identity: BindingDigest,
        request_decision_cut_ns: u64,
        window_start_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> Result<NativeReplayCensusSequenceV2, NativeReplayFrameCensusRefusalV2> {
        let mut transaction = self
            .pool
            .begin_with("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .await
            .map_err(|_| NativeReplayFrameCensusRefusalV2::CensusUnavailable)?;
        let rows = load_native_replay_frame_census_v2(
            &mut transaction,
            scope_digest,
            window_start_ns,
            window_end_ns_exclusive,
        )
        .await
        .map_err(|_| NativeReplayFrameCensusRefusalV2::CensusUnavailable)?;

        if rows
            .iter()
            .any(|row| row.decision_cut_ns > request_decision_cut_ns)
        {
            return Err(NativeReplayFrameCensusRefusalV2::ObservationAfterDecisionCut);
        }

        if rows.windows(2).any(|pair| {
            pair[0].frame_ordinal == pair[1].frame_ordinal
                && pair[0].correction_branch_digest != pair[1].correction_branch_digest
        }) {
            return Err(NativeReplayFrameCensusRefusalV2::AmbiguousCorrectionBranch);
        }
        let Some(first) = rows.first() else {
            return Err(NativeReplayFrameCensusRefusalV2::EligibleFrameCountIsBelowTwo);
        };

        // The census decides which frame is first; the request may only agree with it.
        if first.snapshot_identity != first_frame_snapshot_identity {
            return Err(NativeReplayFrameCensusRefusalV2::FirstFrameIsNotTheSealedRequestFrame);
        }
        let mut identities = BTreeSet::new();

        // Distinctness is asked of the whole sequence: two rows sharing an identity are the same
        // frame counted twice however far apart the census puts them.
        if rows
            .iter()
            .any(|row| !identities.insert(row.snapshot_identity))
        {
            return Err(NativeReplayFrameCensusRefusalV2::DuplicateFrameIdentity);
        }

        // Each rule held between the two rows of a pair and holds between every neighbouring pair.
        for pair in rows.windows(2) {
            if pair[1].frame_ordinal != pair[0].frame_ordinal + 1 {
                return Err(NativeReplayFrameCensusRefusalV2::SkippedEligibleFrame);
            }

            if pair[1].event_effective_ns <= pair[0].event_effective_ns {
                return Err(NativeReplayFrameCensusRefusalV2::NonIncreasingEventOrder);
            }
        }
        let Some((successor, consumed)) = rows.split_last() else {
            return Err(NativeReplayFrameCensusRefusalV2::EligibleFrameCountIsBelowTwo);
        };

        if consumed.is_empty() {
            return Err(NativeReplayFrameCensusRefusalV2::EligibleFrameCountIsBelowTwo);
        }
        let frame = |row: &NativeReplayFrameCensusRowV2| NativeReplayCensusFrameV2 {
            snapshot_identity: row.snapshot_identity,
            snapshot_fact_digest: row.snapshot_fact_digest,
            frame_time_ns: row.event_effective_ns,
        };
        Ok(NativeReplayCensusSequenceV2 {
            consumed: consumed.iter().map(frame).collect(),
            bounding_successor: frame(successor),
        })
    }

    /// Resolves the one quote cut a frame takes its liquidity from, from Owner custody alone.
    ///
    /// See [`resolve_native_replay_quote_cut_in_transaction_v2`]; this is the same read in a
    /// read-only transaction of its own.
    ///
    /// # Errors
    ///
    /// Returns the exact [`NativeReplayQuoteCutRefusalV2`] for the first violated rule.
    pub(crate) async fn resolve_native_replay_quote_cut_v2(
        &self,
        frame: &VerifiedPitObservationBatch,
        window_end_ns_exclusive: u64,
    ) -> Result<VerifiedPitObservationBatch, NativeReplayQuoteCutRefusalV2> {
        let mut transaction = self
            .pool
            .begin_with("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .await
            .map_err(|_| NativeReplayQuoteCutRefusalV2::CustodyUnavailable)?;
        let quote_cut = resolve_native_replay_quote_cut_in_transaction_v2(
            &mut transaction,
            frame,
            window_end_ns_exclusive,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|_| NativeReplayQuoteCutRefusalV2::CustodyUnavailable)?;
        Ok(quote_cut)
    }

    /// Commits the sealed V2 sequence's receipt and outbox atomically, or refuses without writing.
    ///
    /// `docs/owners/market-data.md` requires that "exact same-meaning retry or response-loss
    /// recovery re-resolves and re-verifies the whole sequence and returns byte-identical
    /// historical bytes, while changed meaning conflicts without writing". The request identity is
    /// the custody key, so a retry finds the stored row and returns its bytes; a different sealed
    /// meaning for the same request hits that same row and refuses before any insert runs.
    ///
    /// # Errors
    ///
    /// Returns [`NativeReplayFrameSequenceCustodyRefusalV2`] when custody is unreachable or the
    /// request already holds a differently sealed sequence.
    pub(crate) async fn commit_native_replay_frame_sequence_v2(
        &self,
        record: &NativeReplayFrameSequenceCustodyRecordV2,
    ) -> Result<NativeReplayFrameSequenceCustodyReadbackV2, NativeReplayFrameSequenceCustodyRefusalV2>
    {
        use NativeReplayFrameSequenceCustodyRefusalV2 as Refusal;

        let window_start =
            i64::try_from(record.window_start_ns()).map_err(|_| Refusal::CustodyUnavailable)?;
        let window_end = i64::try_from(record.window_end_ns_exclusive())
            .map_err(|_| Refusal::CustodyUnavailable)?;

        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| Refusal::CustodyUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| Refusal::CustodyUnavailable)?;
        // Two concurrent commits of the same request must serialize, so the loser observes the
        // winner's row and either replays it or conflicts - never inserts a second meaning.
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(sample_advisory_key(*record.request_identity().as_bytes()))
            .execute(&mut *transaction)
            .await
            .map_err(|_| Refusal::CustodyUnavailable)?;

        let stored = sqlx::query(
            "SELECT s.sequence_identity,s.sequence_bytes,s.receipt_identity,s.receipt_bytes,o.outbox_identity,o.payload FROM market_data_private.native_replay_frame_sequences_v2 s JOIN market_data_private.native_replay_frame_sequence_outbox_v2 o ON o.sequence_identity=s.sequence_identity WHERE s.request_identity=$1",
        )
        .bind(record.request_identity().as_bytes().as_slice())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|_| Refusal::CustodyUnavailable)?;

        if let Some(row) = stored {
            let readback = decode_native_replay_frame_sequence_custody_v2(&row)?;
            // Same meaning replays; changed meaning refuses. Either way nothing was inserted.
            if readback.sequence_identity != record.sequence_identity()
                || readback.sequence_bytes != record.sequence_bytes()
                || readback.receipt_identity != record.receipt_identity()
                || readback.receipt_bytes != record.receipt_bytes()
            {
                return Err(Refusal::SequenceConflict);
            }
            transaction
                .commit()
                .await
                .map_err(|_| Refusal::CustodyUnavailable)?;
            return Ok(readback);
        }

        sqlx::query(
            "INSERT INTO market_data_private.native_replay_frame_sequences_v2(sequence_identity,request_identity,v1_binding_identity,window_start_ns,window_end_ns_exclusive,first_snapshot_identity,second_snapshot_identity,sequence_bytes,receipt_identity,receipt_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(record.sequence_identity().as_bytes().as_slice())
        .bind(record.request_identity().as_bytes().as_slice())
        .bind(record.v1_binding_identity().as_bytes().as_slice())
        .bind(window_start)
        .bind(window_end)
        .bind(record.first_snapshot_identity().as_bytes().as_slice())
        // The column keeps the name it had while a sequence was a pair; what it holds is the
        // sequence's last frame, which is the same cut whenever the sequence is two frames long.
        .bind(record.last_snapshot_identity().as_bytes().as_slice())
        .bind(record.sequence_bytes())
        .bind(record.receipt_identity().as_bytes().as_slice())
        .bind(record.receipt_bytes())
        .execute(&mut *transaction)
        .await
        .map_err(|_| Refusal::SequenceConflict)?;

        // Same transaction: a receipt without its outbox row is not a state this Owner can reach.
        sqlx::query(
            "INSERT INTO market_data_private.native_replay_frame_sequence_outbox_v2(outbox_identity,sequence_identity,payload_digest,payload) VALUES ($1,$2,$3,$4)",
        )
        .bind(record.outbox_identity().as_bytes().as_slice())
        .bind(record.sequence_identity().as_bytes().as_slice())
        .bind(record.outbox_identity().as_bytes().as_slice())
        .bind(record.outbox_payload())
        .execute(&mut *transaction)
        .await
        .map_err(|_| Refusal::SequenceConflict)?;

        transaction
            .commit()
            .await
            .map_err(|_| Refusal::CustodyUnavailable)?;

        Ok(NativeReplayFrameSequenceCustodyReadbackV2 {
            sequence_identity: record.sequence_identity(),
            sequence_bytes: record.sequence_bytes().to_vec(),
            receipt_identity: record.receipt_identity(),
            receipt_bytes: record.receipt_bytes().to_vec(),
            outbox_identity: record.outbox_identity(),
            outbox_payload: record.outbox_payload().to_vec(),
        })
    }

    /// Reads one sealed V2 sequence back by its exact locator, or hands back nothing.
    ///
    /// The locator is the request identity paired with the sequence identity: neither alone names
    /// a row the caller is entitled to, and a mismatched pair is absence rather than a near miss.
    ///
    /// # Errors
    ///
    /// Returns [`NativeReplayFrameSequenceCustodyRefusalV2::CustodyUnavailable`] when custody
    /// cannot be read.
    pub(crate) async fn resolve_native_replay_frame_sequence_v2(
        &self,
        request_identity: BindingDigest,
        sequence_identity: BindingDigest,
    ) -> Result<
        Option<NativeReplayFrameSequenceCustodyReadbackV2>,
        NativeReplayFrameSequenceCustodyRefusalV2,
    > {
        use NativeReplayFrameSequenceCustodyRefusalV2 as Refusal;

        let mut transaction = self
            .pool
            .begin_with("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .await
            .map_err(|_| Refusal::CustodyUnavailable)?;
        let row = sqlx::query(
            "SELECT s.sequence_identity,s.sequence_bytes,s.receipt_identity,s.receipt_bytes,o.outbox_identity,o.payload FROM market_data_private.native_replay_frame_sequences_v2 s JOIN market_data_private.native_replay_frame_sequence_outbox_v2 o ON o.sequence_identity=s.sequence_identity WHERE s.request_identity=$1 AND s.sequence_identity=$2",
        )
        .bind(request_identity.as_bytes().as_slice())
        .bind(sequence_identity.as_bytes().as_slice())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|_| Refusal::CustodyUnavailable)?;

        row.as_ref()
            .map(decode_native_replay_frame_sequence_custody_v2)
            .transpose()
    }

    pub(crate) async fn resolve_replay_composition_readback_v1(
        &self,
        request: &UntrustedReplayMarketFactsCompositionRequestV1,
    ) -> Result<ReplayMarketFactsReadbackV2, ReplayCompositionBindingErrorV1> {
        let mut transaction = self
            .pool
            .begin_with("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        super::replay_market_facts_v2::postgres::verify_replay_market_facts_read_contract_v2(
            &mut transaction,
        )
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        let binding = super::replay_market_facts_v2::postgres::recover_replay_composition_binding_in_transaction_v1(
            &mut transaction,
            request.binding_locator(),
        )
        .await
        .map_err(map_replay_composition_postgres_error_v1)?;
        let readback = super::replay_market_facts_v2::postgres::recover_bound_replay_market_facts_readback_in_transaction_v2(
            &mut transaction,
            request.replay_v2_request(),
            *binding.record().identity().as_bytes(),
        )
        .await
        .map_err(map_replay_composition_postgres_error_v1)?;
        super::replay_market_facts_v2::composition::validate_replay_composition_readback_association_v1(
            request,
            &binding,
            &readback,
        )?;
        validate_replay_market_native_dependencies_read_only_v2(&mut transaction, &readback)
            .await
            .map_err(map_replay_composition_postgres_error_v1)?;
        transaction
            .commit()
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
        Ok(readback)
    }

    async fn migrate(&self) -> Result<(), SourceBindingError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;

        for statement in MIGRATION_STATEMENTS {
            sqlx::query(*statement)
                .execute(&mut *transaction)
                .await
                .map_err(|_| SourceBindingError::StoreUnavailable)?;
        }

        for statement in super::replay_market_facts_v2::postgres::REPLAY_MARKET_FACTS_SCHEMA_V2 {
            sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .map_err(|_| SourceBindingError::StoreUnavailable)?;
        }

        for statement in super::replay_market_facts_v2::postgres::REPLAY_MARKET_RD_CUT_API_SCHEMA_V1
        {
            sqlx::query(*statement)
                .execute(&mut *transaction)
                .await
                .map_err(|_| SourceBindingError::StoreUnavailable)?;
        }
        sample_projection_v4::install(&mut transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        live_market_stream_v1::install(&mut transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        let history_census_installed: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM market_data_private.owner_migrations_v1 WHERE migration_id=$1)",
        )
        .bind(OWNER_HISTORY_CENSUS_MIGRATION_ID)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?;

        if !history_census_installed {
            install_owner_history_census(&mut transaction).await?;
        }
        validate_owner_history_custody(&mut transaction).await?;
        let shared_time_installed: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM market_data_private.owner_migrations_v1 WHERE migration_id=$1)",
        )
        .bind(SHARED_TIME_MIGRATION_ID)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?;

        if shared_time_installed {
            validate_clock_handoff_installation(&mut transaction).await?;
        } else {
            install_clock_handoff_state(&mut transaction).await?;
            sqlx::query(
                "INSERT INTO market_data_private.owner_migrations_v1(migration_id) VALUES ($1)",
            )
            .bind(SHARED_TIME_MIGRATION_ID)
            .execute(&mut *transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        }
        universe_selection::install_universe_selection_schema_v1(&mut transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        market_semantics::install_market_semantics_schema_v1(&mut transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        reference_fact_coordinates::install_reference_fact_r0_schema_v1(&mut transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        strategy_input_binding_registry::install_strategy_input_binding_registry_schema_v1(
            &mut transaction,
        )
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?;

        for statement in rd_strategy_input_custody::SCHEMA_V1 {
            sqlx::query(*statement)
                .execute(&mut *transaction)
                .await
                .map_err(|_| SourceBindingError::StoreUnavailable)?;
        }
        observation_census::install_observation_census_schema_v1(&mut transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        sqlx::query(
            "INSERT INTO market_data_private.owner_migrations_v1(migration_id) VALUES ($1) ON CONFLICT (migration_id) DO NOTHING",
        )
        .bind(MIGRATION_ID)
        .execute(&mut *transaction)
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)
    }

    #[cfg(test)]
    pub(crate) const fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub(crate) async fn commit_source_initial(
        &self,
        proposal: UntrustedSourceBindingProposal,
        decision: OwnerSourceBindingDecision,
        clock: &MarketDataClockAdmission,
    ) -> Result<SourceBindingCommit, SourceBindingError> {
        Box::pin(self.commit_source_initial_with_fault(
            proposal,
            decision,
            clock,
            PostgresCommitFault::None,
        ))
        .await
    }

    async fn commit_source_initial_with_fault(
        &self,
        proposal: UntrustedSourceBindingProposal,
        decision: OwnerSourceBindingDecision,
        clock: &MarketDataClockAdmission,
        fault: PostgresCommitFault,
    ) -> Result<SourceBindingCommit, SourceBindingError> {
        validate_proposal(&proposal, clock)?;
        let binding_id = derive_binding_id(&proposal);
        let aggregate = build_stored_aggregate(
            proposal,
            decision,
            SourceOwnerLineage {
                root: binding_id,
                version: 1,
                predecessor_binding_id: None,
                predecessor_fact_digest: None,
            },
        );
        let mut transaction = self.transaction().await?;
        lock_digests(&mut transaction, binding_id, binding_id).await?;
        if let Some(stored) = load_source_for_update(&mut transaction, binding_id, false).await? {
            validate_materialized_clock_custody(&mut transaction).await?;
            Box::pin(validate_source_replay_clock(&mut transaction, &stored)).await?;
            validate_source_lineage_head_custody(
                &mut transaction,
                stored.commit().fact().lineage_root(),
            )
            .await?;
            return exact_source_replay(&stored, &aggregate);
        }

        if source_head(&mut transaction, binding_id).await?.is_some() {
            return Err(SourceBindingError::ReplayConflict);
        }
        admit_clock(&mut transaction, clock).await?;
        insert_source(&mut transaction, &aggregate, fault).await?;
        transaction
            .commit()
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        if fault == PostgresCommitFault::ResponseLoss {
            Err(SourceBindingError::ResponseLost)
        } else {
            Ok(aggregate.commit().clone())
        }
    }

    pub(crate) async fn commit_source_successor(
        &self,
        predecessor: &UntrustedSourceBindingLocator,
        proposal: UntrustedSourceBindingProposal,
        decision: OwnerSourceBindingDecision,
        clock: &MarketDataClockAdmission,
    ) -> Result<SourceBindingCommit, SourceBindingError> {
        Box::pin(self.commit_source_successor_with_fault(
            predecessor,
            proposal,
            decision,
            clock,
            PostgresCommitFault::None,
        ))
        .await
    }

    async fn commit_source_successor_with_fault(
        &self,
        predecessor: &UntrustedSourceBindingLocator,
        proposal: UntrustedSourceBindingProposal,
        decision: OwnerSourceBindingDecision,
        clock: &MarketDataClockAdmission,
        fault: PostgresCommitFault,
    ) -> Result<SourceBindingCommit, SourceBindingError> {
        validate_proposal(&proposal, clock)?;
        let binding_id = derive_binding_id(&proposal);
        let mut transaction = self.transaction().await?;
        let initial_predecessor = load_source(&mut transaction, predecessor.binding_id, false)
            .await?
            .ok_or(SourceBindingError::LineageHeadMismatch)?;
        if initial_predecessor.commit().receipt().locator() != predecessor {
            return Err(SourceBindingError::LineageHeadMismatch);
        }
        let predecessor_fact = initial_predecessor.commit().fact();
        let lineage_root = predecessor_fact.lineage_root();
        lock_digests(&mut transaction, binding_id, lineage_root).await?;
        let locked_predecessor =
            load_source_for_update(&mut transaction, predecessor.binding_id, false)
                .await?
                .ok_or(SourceBindingError::LineageHeadMismatch)?;
        if locked_predecessor.commit().receipt().locator() != predecessor {
            return Err(SourceBindingError::LineageHeadMismatch);
        }
        let predecessor_fact = locked_predecessor.commit().fact();
        let lineage = SourceOwnerLineage {
            root: predecessor_fact.lineage_root(),
            version: predecessor_fact.lineage_version().checked_add(1).ok_or(
                SourceBindingError::InvalidVersionOrSequence("lineage_version"),
            )?,
            predecessor_binding_id: Some(predecessor_fact.binding_id()),
            predecessor_fact_digest: Some(predecessor_fact.digest()),
        };
        let aggregate = build_stored_aggregate(proposal, decision, lineage);

        if let Some(stored) = load_source_for_update(&mut transaction, binding_id, false).await? {
            validate_materialized_clock_custody(&mut transaction).await?;
            Box::pin(validate_source_replay_clock(&mut transaction, &stored)).await?;
            validate_source_lineage_head_custody(
                &mut transaction,
                stored.commit().fact().lineage_root(),
            )
            .await?;
            return exact_source_replay(&stored, &aggregate);
        }
        let head = source_head_for_update(&mut transaction, lineage.root)
            .await?
            .ok_or(SourceBindingError::LineageHeadMismatch)?;
        if !head.matches_source(predecessor_fact) {
            return Err(SourceBindingError::LineageHeadMismatch);
        }
        validate_successor_advances(predecessor_fact, aggregate.commit().fact().proposal())?;
        admit_clock(&mut transaction, clock).await?;
        insert_source(&mut transaction, &aggregate, fault).await?;
        transaction
            .commit()
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        if fault == PostgresCommitFault::ResponseLoss {
            Err(SourceBindingError::ResponseLost)
        } else {
            Ok(aggregate.commit().clone())
        }
    }

    async fn transaction(&self) -> Result<Transaction<'_, Postgres>, SourceBindingError> {
        self.pool
            .begin()
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)
    }

    pub(crate) async fn commit_pit_initial(
        &self,
        proposal: UntrustedPitSnapshotProposal,
        canonical_basis: &dyn CanonicalBasisResolverV1,
        clock: &MarketDataClockAdmission,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        Box::pin(self.commit_pit_initial_with_fault(
            proposal,
            canonical_basis,
            clock,
            PostgresCommitFault::None,
        ))
        .await
    }

    async fn commit_pit_initial_with_fault(
        &self,
        proposal: UntrustedPitSnapshotProposal,
        canonical_basis: &dyn CanonicalBasisResolverV1,
        clock: &MarketDataClockAdmission,
        fault: PostgresCommitFault,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        Box::pin(self.commit_pit_initial_inner(proposal, canonical_basis, clock, fault)).await
    }

    async fn commit_pit_initial_inner(
        &self,
        proposal: UntrustedPitSnapshotProposal,
        canonical_basis: &dyn CanonicalBasisResolverV1,
        clock: &MarketDataClockAdmission,
        fault: PostgresCommitFault,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let source = load_source_for_update(
            &mut transaction,
            proposal.request.source_binding.binding_id,
            false,
        )
        .await
        .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?
        .ok_or(PitSnapshotError::SourceBindingUnavailable)?;
        if source.commit().receipt().locator() != &proposal.request.source_binding {
            return Err(PitSnapshotError::SourceBindingUnavailable);
        }
        let aggregate =
            prepare_initial_aggregate(proposal, canonical_basis, source.commit().fact(), clock)?;
        Box::pin(persist_pit(
            transaction,
            aggregate,
            None,
            clock,
            fault,
            PitPersistCompanionV1::None,
        ))
        .await
    }

    pub(crate) async fn commit_pit_initial_with_observation_batch(
        &self,
        proposal: UntrustedPitSnapshotProposal,
        batch: UntrustedPitObservationBatchProposal,
        canonical_basis: &dyn CanonicalBasisResolverV1,
        clock: &MarketDataClockAdmission,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        Box::pin(self.commit_pit_initial_with_observation_batch_and_fault(
            proposal,
            batch,
            canonical_basis,
            clock,
            PostgresCommitFault::None,
        ))
        .await
    }

    async fn commit_pit_initial_with_observation_batch_and_fault(
        &self,
        proposal: UntrustedPitSnapshotProposal,
        batch: UntrustedPitObservationBatchProposal,
        canonical_basis: &dyn CanonicalBasisResolverV1,
        clock: &MarketDataClockAdmission,
        fault: PostgresCommitFault,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        let prepared = prepare_observation_batch(&proposal, &batch)?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let source = load_source_for_update(
            &mut transaction,
            proposal.request.source_binding.binding_id,
            false,
        )
        .await
        .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?
        .ok_or(PitSnapshotError::SourceBindingUnavailable)?;
        if source.commit().receipt().locator() != &proposal.request.source_binding {
            return Err(PitSnapshotError::SourceBindingUnavailable);
        }
        let aggregate =
            prepare_initial_aggregate(proposal, canonical_basis, source.commit().fact(), clock)?;
        verify_observation_batch(
            &aggregate,
            aggregate.fact().source_binding_identity(),
            aggregate.fact().source_binding_lineage_root(),
            aggregate.fact().source_binding_lineage_version(),
            prepared.digest(),
            prepared.bytes(),
            &prepared.native_rows()?,
        )?;
        Box::pin(persist_pit(
            transaction,
            aggregate,
            Some(prepared),
            clock,
            fault,
            PitPersistCompanionV1::None,
        ))
        .await
    }

    /// Mints the next Owner clock admission for a commit that establishes or advances the head.
    ///
    /// The cut is the Owner's own wall observation, and the sequence strictly advances the
    /// persisted head. A wall clock that has not moved past the head cannot mint, because a cut
    /// that did not advance would let two different findings claim the same instant.
    ///
    /// # Errors
    ///
    /// Returns [`SourceBindingAdmissionErrorV1::ClockUnavailable`] when no advancing cut can be
    /// minted and [`SourceBindingAdmissionErrorV1::StoreUnavailable`] when the store fails.
    pub(crate) async fn mint_clock_admission_v1(
        &self,
    ) -> Result<MarketDataClockAdmission, SourceBindingAdmissionErrorV1> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| SourceBindingAdmissionErrorV1::StoreUnavailable)?;
        let head = load_current_clock_for_update(&mut transaction)
            .await
            .map_err(|_| SourceBindingAdmissionErrorV1::StoreUnavailable)?;
        transaction
            .rollback()
            .await
            .map_err(|_| SourceBindingAdmissionErrorV1::StoreUnavailable)?;

        let observed_ns = u64::try_from(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| SourceBindingAdmissionErrorV1::ClockUnavailable)?
                .as_nanos(),
        )
        .map_err(|_| SourceBindingAdmissionErrorV1::ClockUnavailable)?;

        let sequence = match &head {
            None => 1,
            Some(current) => {
                if observed_ns <= current.decision_cut {
                    return Err(SourceBindingAdmissionErrorV1::ClockUnavailable);
                }
                current
                    .monotonic_sequence
                    .checked_add(1)
                    .ok_or(SourceBindingAdmissionErrorV1::ClockUnavailable)?
            }
        };
        seal_owner_clock_admission_v1(
            OWNER_CLOCK_IDENTITY_V1,
            OWNER_CLOCK_EPOCH_V1,
            sequence,
            observed_ns,
            OWNER_CLOCK_VALIDITY_WINDOW_NS,
            OWNER_CLOCK_UNCERTAINTY_BOUND_NS,
            OWNER_CLOCK_SKEW_BOUND_NS,
        )
        .ok_or(SourceBindingAdmissionErrorV1::ClockUnavailable)
    }

    /// Returns the one canonical clock head this Owner persists with its own facts.
    ///
    /// The caller of an intake never supplies a decision cut. An Owner that holds no head yet has
    /// no cut to bind, so it fails closed instead of inventing one from wall time.
    ///
    /// # Errors
    ///
    /// Returns [`PitMarketSnapshotIntakeErrorV1::ClockUnavailable`] when no head is persisted and
    /// [`PitMarketSnapshotIntakeErrorV1::StoreUnavailable`] when the store cannot be read.
    pub(crate) async fn current_clock_admission_v1(
        &self,
    ) -> Result<MarketDataClockAdmission, PitMarketSnapshotIntakeErrorV1> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PitMarketSnapshotIntakeErrorV1::StoreUnavailable)?;
        let clock = load_current_clock_for_update(&mut transaction)
            .await
            .map_err(|_| PitMarketSnapshotIntakeErrorV1::StoreUnavailable)?
            .ok_or(PitMarketSnapshotIntakeErrorV1::ClockUnavailable)?;
        transaction
            .rollback()
            .await
            .map_err(|_| PitMarketSnapshotIntakeErrorV1::StoreUnavailable)?;
        Ok(clock)
    }

    /// Answers one frozen PIT Market Snapshot Request end to end.
    ///
    /// The requester supplies the request and nothing else: no observations, no evidence, no
    /// digest, no disposition. Market Data resolves the admitted Source Binding and the evaluated
    /// Universe Selection Record, issues the retrieval scope itself, stamps its own bindings onto
    /// the vendor rows, and derives the terminal disposition. A Data Client can therefore state
    /// what it measured and when, and nothing about what that measurement is bound to.
    ///
    /// # Errors
    ///
    /// Returns [`PitSnapshotError::SourceBindingUnavailable`] when the request names a binding the
    /// Owner does not hold, [`PitSnapshotError::ObservationBatchUnavailable`] when the retrieval
    /// fails or exceeds the admitted batch, and the usual persistence failures otherwise. An empty
    /// or partial retrieval is not an error: it becomes insufficient coverage.
    pub(crate) async fn commit_pit_initial_from_request_v1(
        &self,
        request: UntrustedPitSnapshotRequest,
        observations: &dyn PitObservationSourceV1,
        universe_locator: &UntrustedUniverseSelectionLocatorV1,
        clock: &MarketDataClockAdmission,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let source =
            load_source_for_update(&mut transaction, request.source_binding.binding_id, false)
                .await
                .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?
                .ok_or(PitSnapshotError::SourceBindingUnavailable)?;
        if source.commit().receipt().locator() != &request.source_binding {
            return Err(PitSnapshotError::SourceBindingUnavailable);
        }
        let source_fact = source.commit().fact();

        // The scope carries the Owner's resolution of the selection rule. A record the Owner
        // cannot recover leaves the scope empty, which becomes insufficient coverage rather than a
        // licence for the client to choose its own members. A record it recovers but does not
        // admit is refused by name here, before anything is written.
        let (members, universe) = pit_intake_scope_v1(
            universe_selection::recover_universe_selection_in_transaction_v1(
                &mut transaction,
                universe_locator,
            )
            .await,
            request.universe_selection_digest,
        )?;

        // The request-supplied instrument master digest is a claim. The Owner replaces it with
        // the digest of its own resolution cut for the scoped instruments at this decision cut,
        // then re-seals the request identity over what it will actually commit.
        let mut request = request;
        request.instrument_master_digest =
            Box::pin(self.resolve_instrument_master_digest_for_pit_request_v1(
                &request,
                &members,
                universe.as_deref(),
                clock,
            ))
            .await?;
        seal_request_claims_v1(&mut request);

        let time = &request.time_evidence;
        let correction_publication = time
            .correction_publication
            .as_ref()
            .ok_or(PitSnapshotError::InvalidObservationBatch)?;
        let scope = PitObservationScopeV1::from_owner_request(
            members,
            time.event_effective.value,
            time.provider_available.value,
            time.retrieval.value,
            correction_publication.value,
            time.decision_cut.value,
        );
        let vendor_rows = observations
            .observe(&scope)
            .await
            .map_err(|_| PitSnapshotError::ObservationBatchUnavailable)?;

        let batch = UntrustedPitObservationBatchProposal {
            rows: vendor_rows
                .into_iter()
                .map(|row| UntrustedPitObservation {
                    symbolic_key: row.symbolic_key,
                    member_key: row.member_key,
                    instrument: row.instrument,
                    channel: row.channel,
                    data_kind: row.data_kind,
                    timeframe: row.timeframe,
                    field: row.field,
                    value_mantissa: row.value_mantissa,
                    value_scale: row.value_scale,
                    event_effective: row.event_effective,
                    provider_available: row.provider_available,
                    retrieval: row.retrieval,
                    correction_publication: row.correction_publication,
                    // Every binding below is the Owner's, never the client's.
                    source_binding_identity: source_fact.binding_id(),
                    source_frontier_digest: source_fact.source_frontier().digest,
                    instrument_master_digest: request.instrument_master_digest,
                    universe_selection_digest: request.universe_selection_digest,
                    market_semantics_identity: request.market_semantics_identity,
                    correction_stream_identity: source_fact
                        .correction_frontier()
                        .stream_identity
                        .clone(),
                    correction_sequence: source_fact.correction_frontier().sequence,
                    correction_frontier_digest: source_fact.correction_frontier().digest,
                })
                .collect(),
        };

        let observed_members = batch
            .rows
            .iter()
            .map(|row| row.member_key.as_bytes().to_vec())
            .collect::<std::collections::BTreeSet<_>>();
        let determination = Box::pin(resolve_owner_snapshot_determination_v1(
            &mut transaction,
            &request,
            universe_locator,
            &observed_members,
            source_fact,
        ))
        .await?;
        let owner_basis = OwnerCanonicalBasisV1::resolve_from_owner_custody(
            &request,
            source_fact,
            derive_observation_batch_digest(&batch)?,
            determination,
            clock,
        );
        let proposal = UntrustedPitSnapshotProposal {
            request,
            evidence: owner_basis.owner_evidence().clone(),
        };
        let prepared = prepare_observation_batch(&proposal, &batch)?;
        let aggregate = prepare_initial_aggregate(proposal, &owner_basis, source_fact, clock)?;
        if aggregate.fact().disposition() == PitSnapshotDisposition::Available {
            verify_observation_batch(
                &aggregate,
                aggregate.fact().source_binding_identity(),
                aggregate.fact().source_binding_lineage_root(),
                aggregate.fact().source_binding_lineage_version(),
                prepared.digest(),
                prepared.bytes(),
                &prepared.native_rows()?,
            )?;
        }
        Box::pin(persist_pit(
            transaction,
            aggregate,
            Some(prepared),
            clock,
            PostgresCommitFault::None,
            PitPersistCompanionV1::OwnerR0Record,
        ))
        .await
    }

    /// Mints one PIT Market Snapshot whose canonical basis Market Data resolved for itself.
    ///
    /// This is the production counterpart of the acceptance mint. The requester supplies only its
    /// frozen proposal, the observation batch and the locator of an already-evaluated Universe
    /// Selection Record; every value that decides the terminal disposition is read back from Owner
    /// custody inside this one transaction. An unresolvable universe record, semantics scope or
    /// unadmitted Source Binding is not an error: it becomes the corresponding blocker, so the
    /// consumer receives an explicit `INSUFFICIENT`, `AMBIGUOUS`, `UNLICENSED` or `UNAVAILABLE`
    /// terminal instead of a synthetic success. Only a store failure aborts.
    ///
    /// # Errors
    ///
    /// Returns [`PitSnapshotError::CanonicalBasisMismatch`] when the requester's claimed evidence
    /// differs from what the Owner resolved, and the usual persistence and observation-batch
    /// failures otherwise.
    pub(crate) async fn commit_pit_initial_from_owner_custody_v1(
        &self,
        proposal: UntrustedPitSnapshotProposal,
        batch: UntrustedPitObservationBatchProposal,
        universe_locator: &UntrustedUniverseSelectionLocatorV1,
        clock: &MarketDataClockAdmission,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        let prepared = prepare_observation_batch(&proposal, &batch)?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let source = load_source_for_update(
            &mut transaction,
            proposal.request.source_binding.binding_id,
            false,
        )
        .await
        .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?
        .ok_or(PitSnapshotError::SourceBindingUnavailable)?;
        if source.commit().receipt().locator() != &proposal.request.source_binding {
            return Err(PitSnapshotError::SourceBindingUnavailable);
        }
        let source_fact = source.commit().fact();

        let observed_members = prepared
            .native_rows()?
            .iter()
            .map(|row| row.member_key.as_bytes().to_vec())
            .collect::<std::collections::BTreeSet<_>>();
        let determination = Box::pin(resolve_owner_snapshot_determination_v1(
            &mut transaction,
            &proposal.request,
            universe_locator,
            &observed_members,
            source_fact,
        ))
        .await?;

        let owner_basis = OwnerCanonicalBasisV1::resolve_from_owner_custody(
            &proposal.request,
            source_fact,
            prepared.digest(),
            determination,
            clock,
        );
        // The Owner's finding replaces the requester's claim before the fact is built, so the
        // snapshot records what Market Data determined. The canonical batch was already validated
        // against the claimed frontiers and digest, and those are byte-equal to the Owner's, so
        // only the three determinations change here.
        let mut proposal = proposal;
        proposal.evidence = owner_basis.owner_evidence().clone();
        let aggregate = prepare_initial_aggregate(proposal, &owner_basis, source_fact, clock)?;
        if aggregate.fact().disposition() == PitSnapshotDisposition::Available {
            verify_observation_batch(
                &aggregate,
                aggregate.fact().source_binding_identity(),
                aggregate.fact().source_binding_lineage_root(),
                aggregate.fact().source_binding_lineage_version(),
                prepared.digest(),
                prepared.bytes(),
                &prepared.native_rows()?,
            )?;
        }
        Box::pin(persist_pit(
            transaction,
            aggregate,
            Some(prepared),
            clock,
            PostgresCommitFault::None,
            PitPersistCompanionV1::OwnerR0Record,
        ))
        .await
    }

    pub(crate) async fn commit_pit_correction(
        &self,
        predecessor: &UntrustedPitSnapshotLocator,
        proposal: UntrustedPitSnapshotProposal,
        canonical_basis: &dyn CanonicalBasisResolverV1,
        clock: &MarketDataClockAdmission,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        Box::pin(self.commit_pit_correction_inner(predecessor, proposal, canonical_basis, clock))
            .await
    }

    async fn commit_pit_correction_inner(
        &self,
        predecessor: &UntrustedPitSnapshotLocator,
        proposal: UntrustedPitSnapshotProposal,
        canonical_basis: &dyn CanonicalBasisResolverV1,
        clock: &MarketDataClockAdmission,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let prior = load_pit_for_update(&mut transaction, predecessor.snapshot_identity, false)
            .await?
            .ok_or(PitSnapshotError::CorrectionHeadMismatch)?;
        if prior.receipt().locator() != predecessor {
            return Err(PitSnapshotError::CorrectionHeadMismatch);
        }
        let source = load_source_for_update(
            &mut transaction,
            proposal.request.source_binding.binding_id,
            false,
        )
        .await
        .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?
        .ok_or(PitSnapshotError::SourceBindingUnavailable)?;
        if source.commit().receipt().locator() != &proposal.request.source_binding {
            return Err(PitSnapshotError::SourceBindingUnavailable);
        }
        let aggregate = prepare_correction_aggregate(
            prior.fact(),
            proposal,
            canonical_basis,
            source.commit().fact(),
            clock,
        )?;
        Box::pin(persist_pit(
            transaction,
            aggregate,
            None,
            clock,
            PostgresCommitFault::None,
            PitPersistCompanionV1::None,
        ))
        .await
    }

    pub(crate) async fn commit_pit_correction_with_observation_batch(
        &self,
        predecessor: &UntrustedPitSnapshotLocator,
        proposal: UntrustedPitSnapshotProposal,
        batch: UntrustedPitObservationBatchProposal,
        canonical_basis: &dyn CanonicalBasisResolverV1,
        clock: &MarketDataClockAdmission,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        let prepared = prepare_observation_batch(&proposal, &batch)?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let prior = load_pit_for_update(&mut transaction, predecessor.snapshot_identity, false)
            .await?
            .ok_or(PitSnapshotError::CorrectionHeadMismatch)?;
        if prior.receipt().locator() != predecessor {
            return Err(PitSnapshotError::CorrectionHeadMismatch);
        }
        let source = load_source_for_update(
            &mut transaction,
            proposal.request.source_binding.binding_id,
            false,
        )
        .await
        .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?
        .ok_or(PitSnapshotError::SourceBindingUnavailable)?;
        if source.commit().receipt().locator() != &proposal.request.source_binding {
            return Err(PitSnapshotError::SourceBindingUnavailable);
        }
        let aggregate = prepare_correction_aggregate(
            prior.fact(),
            proposal,
            canonical_basis,
            source.commit().fact(),
            clock,
        )?;
        verify_observation_batch(
            &aggregate,
            aggregate.fact().source_binding_identity(),
            aggregate.fact().source_binding_lineage_root(),
            aggregate.fact().source_binding_lineage_version(),
            prepared.digest(),
            prepared.bytes(),
            &prepared.native_rows()?,
        )?;
        Box::pin(persist_pit(
            transaction,
            aggregate,
            Some(prepared),
            clock,
            PostgresCommitFault::None,
            PitPersistCompanionV1::None,
        ))
        .await
    }

    pub(crate) async fn commit_clock_successor(
        &self,
        prior: &ClockHeadHandoff,
        next: &MarketDataClockAdmission,
    ) -> Result<ClockHeadSuccessorReadback, SharedTimeEvidenceError> {
        self.commit_clock_successor_with_fault(prior, next, PostgresCommitFault::None)
            .await
    }

    async fn commit_clock_successor_with_fault(
        &self,
        prior: &ClockHeadHandoff,
        next: &MarketDataClockAdmission,
        fault: PostgresCommitFault,
    ) -> Result<ClockHeadSuccessorReadback, SharedTimeEvidenceError> {
        let transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        persist_clock_successor(transaction, prior, next, fault).await
    }
}

async fn validate_replay_market_native_dependencies_read_only_v2(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &ReplayMarketFactsReadbackV2,
) -> Result<(), super::replay_market_facts_v2::postgres::ReplayMarketFactsPostgresErrorV2> {
    use super::replay_market_facts_v2::postgres::ReplayMarketFactsPostgresErrorV2 as Error;

    let dependencies = readback.facts().frontier().dependencies();
    let [_, _, _, universe, observation, joined, sample] = dependencies else {
        return Err(Error::CorruptRecord);
    };

    let universe_row = sqlx::query(
        "SELECT r.request_identity,r.request_meaning_digest,r.selection_identity,r.record_bytes,c.receipt_identity,c.receipt_bytes,o.outbox_identity,o.receipt_bytes AS outbox_receipt_bytes FROM market_data_private.universe_selection_records_v1 AS r JOIN market_data_private.universe_selection_receipts_v1 AS c ON c.request_identity=r.request_identity JOIN market_data_private.universe_selection_outbox_v1 AS o ON o.request_identity=r.request_identity WHERE r.selection_identity=$1",
    )
    .bind(universe.identity().as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| Error::StoreUnavailable)?
    .ok_or(Error::UniverseSelectionUnavailable)?;
    let universe_record_bytes: Vec<u8> = universe_row
        .try_get("record_bytes")
        .map_err(|_| Error::CorruptRecord)?;
    let universe_receipt_bytes: Vec<u8> = universe_row
        .try_get("receipt_bytes")
        .map_err(|_| Error::CorruptRecord)?;
    let universe_outbox_identity = BindingDigest::from_untrusted_bytes(
        universe_row
            .try_get::<Vec<u8>, _>("outbox_identity")
            .map_err(|_| Error::CorruptRecord)?
            .try_into()
            .map_err(|_| Error::CorruptRecord)?,
    );
    let universe_readback = super::universe_selection::authority::decode_readback_v1(
        &universe_record_bytes,
        &universe_receipt_bytes,
        universe_outbox_identity,
    )
    .map_err(|_| Error::CorruptRecord)?;
    let indexed_universe = BindingDigest::from_untrusted_bytes(
        universe_row
            .try_get::<Vec<u8>, _>("selection_identity")
            .map_err(|_| Error::CorruptRecord)?
            .try_into()
            .map_err(|_| Error::CorruptRecord)?,
    );
    let outbox_receipt: Vec<u8> = universe_row
        .try_get("outbox_receipt_bytes")
        .map_err(|_| Error::CorruptRecord)?;

    if universe.identity() != universe.digest()
        || indexed_universe != universe.identity()
        || universe_readback.record().identity() != universe.identity()
        || universe_readback.record().digest() != universe.digest()
        || universe_readback.record().request_identity().as_bytes()
            != universe_row
                .try_get::<Vec<u8>, _>("request_identity")
                .map_err(|_| Error::CorruptRecord)?
                .as_slice()
        || universe_readback
            .record()
            .request_meaning_digest()
            .as_bytes()
            != universe_row
                .try_get::<Vec<u8>, _>("request_meaning_digest")
                .map_err(|_| Error::CorruptRecord)?
                .as_slice()
        || universe_readback.receipt().identity().as_bytes()
            != universe_row
                .try_get::<Vec<u8>, _>("receipt_identity")
                .map_err(|_| Error::CorruptRecord)?
                .as_slice()
        || outbox_receipt != universe_receipt_bytes
    {
        return Err(Error::CorruptRecord);
    }

    let joined_locator = UntrustedStrategyInputJoinedCutLocatorV1::from_untrusted(
        joined.identity(),
        joined.digest(),
    );
    let (joined_request, joined_custody, joined_receipt_digest) =
        observation_census::load_strategy_input_joined_cut_custody_v1(
            transaction,
            &joined_locator,
            observation_census::ObservationCensusReadModeV1::ReadOnly,
        )
        .await
        .map_err(|_| Error::JoinedCutUnavailable)?
        .ok_or(Error::JoinedCutUnavailable)?;
    let persisted_census = observation_census::load_observation_census_v1(
        transaction,
        &joined_request.locator(),
        observation_census::ObservationCensusReadModeV1::ReadOnly,
    )
    .await
    .map_err(|_| Error::JoinedCutUnavailable)?
    .ok_or(Error::JoinedCutUnavailable)?;
    let (rederived_census, rederived_joined) =
        observation_census::rederive_observation_census_read_only_v1(transaction, &joined_request)
            .await
            .map_err(|_| Error::JoinedCutUnavailable)?;

    if persisted_census != rederived_census
        || persisted_census.record().identity() != observation.identity()
        || persisted_census.record().digest() != observation.digest()
    {
        return Err(Error::CorruptRecord);
    }
    crate::owner::observation_census::authority::validate_strategy_input_joined_cut_custody_v1(
        &joined_custody,
        &joined_request,
        &persisted_census,
        &joined_locator,
        joined_receipt_digest,
    )
    .map_err(|_| Error::CorruptRecord)?;

    if rederived_joined.record().identity() != joined.identity()
        || rederived_joined.record().digest() != joined.digest()
        || rederived_joined.record().canonical_bytes() != joined_custody.as_ref()
        || rederived_joined.record().joined_cut_receipt().digest() != joined_receipt_digest
    {
        return Err(Error::CorruptRecord);
    }

    validate_replay_sample_projection_read_only_v4(
        transaction,
        *sample.identity().as_bytes(),
        *sample.digest().as_bytes(),
        *joined_receipt_digest.as_bytes(),
    )
    .await
}

async fn validate_replay_sample_projection_read_only_v4(
    transaction: &mut Transaction<'_, Postgres>,
    sample_identity: [u8; 32],
    sample_digest: [u8; 32],
    joined_receipt_digest: [u8; 32],
) -> Result<(), super::replay_market_facts_v2::postgres::ReplayMarketFactsPostgresErrorV2> {
    use super::replay_market_facts_v2::postgres::ReplayMarketFactsPostgresErrorV2 as Error;
    use crate::owner::sample_projection_v4::{
        COMPONENT_LEN_V4, HEADER_LEN_V4, ScheduleDependencyV4, StrategyInputSampleProjectionKindV4,
        V3_HEADER_LEN, decode_v4, schedule_set_digest,
    };

    if sample_identity != sample_digest {
        return Err(Error::CorruptRecord);
    }
    let row = sqlx::query(
        "SELECT * FROM market_data_private.resolve_strategy_input_sample_projection_v4($1)",
    )
    .bind(sample_identity.as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| Error::StoreUnavailable)?
    .ok_or(Error::SampleProjectionUnavailable)?;
    let bytes: Vec<u8> = row
        .try_get("receipt_bytes")
        .map_err(|_| Error::CorruptRecord)?;
    let readback_bytes: Vec<u8> = row
        .try_get("readback_bytes")
        .map_err(|_| Error::CorruptRecord)?;
    let outbox_bytes: Vec<u8> = row
        .try_get("outbox_payload")
        .map_err(|_| Error::CorruptRecord)?;
    let decoded = decode_v4(&bytes, sample_identity).map_err(|_| Error::CorruptRecord)?;
    let row_digest = |column| -> Result<[u8; 32], Error> {
        row.try_get::<Vec<u8>, _>(column)
            .map_err(|_| Error::CorruptRecord)?
            .try_into()
            .map_err(|_| Error::CorruptRecord)
    };

    if decoded.kind() != StrategyInputSampleProjectionKindV4::JoinedCut
        || decoded.subject_identity() != joined_receipt_digest
        || row_digest("receipt_digest")? != sample_identity
        || row_digest("schedule_dependency_set_digest")? != decoded.schedule_dependency_set_digest()
        || row_digest("outbox_identity")? != sample_identity
        || readback_bytes != bytes
        || outbox_bytes != bytes
    {
        return Err(Error::CorruptRecord);
    }
    let dependencies = sqlx::query(
        "SELECT * FROM market_data_private.resolve_strategy_input_sample_projection_dependencies_v4($1)",
    )
    .bind(sample_identity.as_slice())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| Error::StoreUnavailable)?
    .into_iter()
    .map(|dependency_row| {
        let digest = |column| -> Result<[u8; 32], Error> {
            dependency_row
                .try_get::<Vec<u8>, _>(column)
                .map_err(|_| Error::CorruptRecord)?
                .try_into()
                .map_err(|_| Error::CorruptRecord)
        };
        Ok(ScheduleDependencyV4 {
            source_projection_digest: digest("source_projection_digest")?,
            role_identity: digest("role_identity")?,
            binding_receipt_digest: digest("binding_receipt_digest")?,
            timeframe_projection_digest: digest("timeframe_projection_digest")?,
            schedule_readback_identity: digest("schedule_readback_identity")?,
            schedule_fact_digest: digest("schedule_fact_digest")?,
            schedule_cut_identity: digest("schedule_cut_identity")?,
            schedule_cut_digest: digest("schedule_cut_digest")?,
            schedule_receipt_identity: digest("schedule_receipt_identity")?,
        })
    })
    .collect::<Result<Vec<_>, Error>>()?;

    if dependencies.len() != decoded.component_count() as usize
        || schedule_set_digest(&dependencies) != decoded.schedule_dependency_set_digest()
    {
        return Err(Error::CorruptRecord);
    }

    for (exact_v4, dependency) in decoded.canonical_bytes()[HEADER_LEN_V4..]
        .chunks_exact(COMPONENT_LEN_V4)
        .zip(&dependencies)
    {
        let stored = load_strategy_input_sample_projection_v3(
            transaction,
            dependency.source_projection_digest,
        )
        .await
        .map_err(|_| Error::SampleProjectionUnavailable)?
        .ok_or(Error::SampleProjectionUnavailable)?;
        let stored_dependencies = load_sample_projection_schedule_dependencies_v3(
            transaction,
            dependency.source_projection_digest,
        )
        .await
        .map_err(|_| Error::SampleProjectionUnavailable)?;
        validate_sample_projection_dependencies_v3(
            transaction,
            &stored.decoded,
            &stored_dependencies,
            false,
        )
        .await
        .map_err(|_| Error::CorruptRecord)?;
        let stored_dependency = stored_dependencies
            .iter()
            .find(|stored_dependency| {
                stored_dependency.role_identity == dependency.role_identity
                    && stored_dependency.binding_receipt_digest == dependency.binding_receipt_digest
            })
            .ok_or(Error::CorruptRecord)?;

        if stored_dependency.schedule_readback_identity.as_bytes()
            != &dependency.schedule_readback_identity
            || stored_dependency.schedule_fact_digest.as_bytes() != &dependency.schedule_fact_digest
            || stored_dependency.schedule_cut_identity.as_bytes()
                != &dependency.schedule_cut_identity
            || stored_dependency.schedule_cut_digest.as_bytes() != &dependency.schedule_cut_digest
            || stored_dependency.schedule_receipt_identity.as_bytes()
                != &dependency.schedule_receipt_identity
        {
            return Err(Error::CorruptRecord);
        }
        let index = stored
            .decoded
            .components()
            .iter()
            .position(|component| {
                component.role_identity() == dependency.role_identity
                    && component.binding_receipt_digest() == dependency.binding_receipt_digest
                    && component.timeframe_projection_digest()
                        == dependency.timeframe_projection_digest
            })
            .ok_or(Error::CorruptRecord)?;
        let start = V3_HEADER_LEN + index * COMPONENT_LEN_V4;

        if stored
            .decoded
            .canonical_bytes()
            .get(start..start + COMPONENT_LEN_V4)
            != Some(exact_v4)
        {
            return Err(Error::CorruptRecord);
        }
    }
    let mut custody = Sha256::new();
    custody.update(b"market-data.sample-projection-postgres-custody.v4\0");
    custody.update(sample_identity);
    custody.update(decoded.schedule_dependency_set_digest());
    custody.update(&bytes);
    let custody: [u8; 32] = custody.finalize().into();
    if row_digest("receipt_custody_digest")? != custody
        || row_digest("readback_custody_digest")? != custody
        || row_digest("outbox_custody_digest")? != custody
    {
        return Err(Error::CorruptRecord);
    }
    Ok(())
}

fn map_replay_market_facts_postgres_error_v2(
    error: super::replay_market_facts_v2::postgres::ReplayMarketFactsPostgresErrorV2,
) -> ReplayMarketFactsErrorV2 {
    use super::replay_market_facts_v2::postgres::ReplayMarketFactsPostgresErrorV2 as PostgresError;
    match error {
        PostgresError::UnknownRecord => ReplayMarketFactsErrorV2::CustodyUnavailable,
        PostgresError::CorruptRecord => ReplayMarketFactsErrorV2::DigestMismatch,
        _ => ReplayMarketFactsErrorV2::CustodyUnavailable,
    }
}

fn map_replay_composition_postgres_error_v1(
    error: super::replay_market_facts_v2::postgres::ReplayMarketFactsPostgresErrorV2,
) -> ReplayCompositionBindingErrorV1 {
    use super::replay_market_facts_v2::postgres::ReplayMarketFactsPostgresErrorV2 as PostgresError;
    match error {
        PostgresError::BindingUnavailable | PostgresError::UnknownRecord => {
            ReplayCompositionBindingErrorV1::UnknownBinding
        }
        PostgresError::BindingConflict | PostgresError::CorruptRecord => {
            ReplayCompositionBindingErrorV1::DigestMismatch
        }
        _ => ReplayCompositionBindingErrorV1::ReplayV2Unavailable,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PostgresCommitFault {
    None,
    AfterFactBeforeOutbox,
    AfterClockHeadBeforeEpochProof,
    AfterPitOutboxBeforeBatch,
    AfterPitBatchBeforeRows,
    ResponseLoss,
}

/// What the Owner appends beside a PIT snapshot in the same transaction.
///
/// Production intake paths append the snapshot's R0 observation-evidence record, so every
/// `AVAILABLE` snapshot a deployment mints carries the coordinate a Market Semantics fact later
/// cross-binds. Test and correction paths append nothing: their custody is assembled by the proof
/// that owns it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PitPersistCompanionV1 {
    None,
    OwnerR0Record,
}

/// Owner-internal, contract-neutral input to the durable sample custody adapter.
///
/// The Market Data contract must validate and canonicalize every field before constructing this
/// value. PostgreSQL treats identities and canonical bytes as opaque and never parses timeframe
/// labels or synthesizes sample authority.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct PreparedSampleCustodyV1 {
    sample_identity: [u8; 32],
    fact_digest: [u8; 32],
    series_identity: [u8; 32],
    series_predecessor_identity: Option<[u8; 32]>,
    series_sequence: u64,
    correction_slot_identity: [u8; 32],
    correction_predecessor_identity: Option<[u8; 32]>,
    correction_sequence: u64,
    logical_time: u64,
    lineage_version: u64,
    projection_receipt_digest: [u8; 32],
    projection_binding_receipt_digest: [u8; 32],
    projection_receipt_bytes: Vec<u8>,
    fact_bytes: Vec<u8>,
    receipt_digest: [u8; 32],
    receipt_bytes: Vec<u8>,
    outbox_identity: [u8; 32],
    outbox_payload_digest: [u8; 32],
    outbox_payload_bytes: Vec<u8>,
}

impl PreparedSampleCustodyV1 {
    fn from_prepared_contract(value: &PreparedSampleCommitV1) -> Self {
        Self {
            sample_identity: value.sample_identity(),
            fact_digest: value.fact_digest(),
            series_identity: value.series_identity(),
            series_predecessor_identity: value.series_predecessor(),
            series_sequence: value.series_sequence(),
            correction_slot_identity: value.correction_slot_identity(),
            correction_predecessor_identity: value.correction_predecessor(),
            correction_sequence: value.correction_sequence(),
            logical_time: value.logical_time(),
            lineage_version: value.lineage_version(),
            projection_receipt_digest: value.timeframe_projection_receipt_digest(),
            projection_binding_receipt_digest: value.timeframe_projection_binding_receipt_digest(),
            projection_receipt_bytes: value.timeframe_projection_receipt_bytes().to_vec(),
            fact_bytes: value.fact_canonical_bytes().to_vec(),
            receipt_digest: value.sample_receipt_digest(),
            receipt_bytes: value.sample_receipt_canonical_bytes().to_vec(),
            outbox_identity: value.outbox_identity(),
            outbox_payload_digest: value.outbox_payload_digest(),
            outbox_payload_bytes: value.outbox_canonical_payload_bytes().to_vec(),
        }
    }

    /// Test-only synthetic adapter for exercising PostgreSQL custody refuters.
    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn from_verified_contract(
        sample_identity: [u8; 32],
        fact_digest: [u8; 32],
        series_identity: [u8; 32],
        series_predecessor_identity: Option<[u8; 32]>,
        series_sequence: u64,
        correction_slot_identity: [u8; 32],
        correction_predecessor_identity: Option<[u8; 32]>,
        correction_sequence: u64,
        logical_time: u64,
        lineage_version: u64,
        projection_receipt_digest: [u8; 32],
        projection_binding_receipt_digest: [u8; 32],
        projection_receipt_bytes: Vec<u8>,
        fact_bytes: Vec<u8>,
        receipt_digest: [u8; 32],
        receipt_bytes: Vec<u8>,
        outbox_identity: [u8; 32],
        outbox_payload_digest: [u8; 32],
        outbox_payload_bytes: Vec<u8>,
    ) -> Self {
        Self {
            sample_identity,
            fact_digest,
            series_identity,
            series_predecessor_identity,
            series_sequence,
            correction_slot_identity,
            correction_predecessor_identity,
            correction_sequence,
            logical_time,
            lineage_version,
            projection_receipt_digest,
            projection_binding_receipt_digest,
            projection_receipt_bytes,
            fact_bytes,
            receipt_digest,
            receipt_bytes,
            outbox_identity,
            outbox_payload_digest,
            outbox_payload_bytes,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[cfg(test)]
pub(super) enum SampleCustodyFaultV1 {
    RollbackBeforeHeads,
    ResponseLoss,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct SampleCustodyReadbackV1 {
    receipt_digest: [u8; 32],
    receipt_bytes: Vec<u8>,
}

impl SampleCustodyReadbackV1 {
    pub(super) const fn receipt_digest(&self) -> [u8; 32] {
        self.receipt_digest
    }

    pub(super) fn exact_receipt_bytes(&self) -> &[u8] {
        &self.receipt_bytes
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub(super) enum SampleCustodyErrorV1 {
    #[error("invalid contract adapter input")]
    InvalidInput,
    #[error("timeframe projection receipt is missing or conflicting")]
    ProjectionConflict,
    #[error("sample identity or canonical content conflicts")]
    IdentityConflict,
    #[error("series predecessor, sequence, lineage, or time does not advance the head")]
    SeriesHeadConflict,
    #[error("correction predecessor or sequence does not advance the slot head")]
    CorrectionHeadConflict,
    #[error("durable sample custody is unavailable or corrupt")]
    StoreUnavailable,
    #[error("sample commit was deliberately rolled back")]
    CommitInterrupted,
    #[error("sample commit succeeded but its response was lost")]
    ResponseLost,
    #[error("sample receipt is unknown")]
    UnknownReceipt,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub(super) enum SampleProjectionCustodyErrorV2 {
    #[error("prepared FRAME projection is unavailable")]
    InvalidPrepared,
    #[error("projection receipt identity conflicts with durable custody")]
    IdentityConflict,
    #[error("FRAME evidence subject already has a different projection receipt")]
    SubjectConflict,
    #[error("durable FRAME projection custody is unavailable or corrupt")]
    StoreUnavailable,
    #[error("FRAME projection commit was deliberately rolled back")]
    CommitInterrupted,
    #[error("FRAME projection commit succeeded but its response was lost")]
    ResponseLost,
    #[error("FRAME projection receipt is unknown")]
    UnknownReceipt,
}

/// Exact historical projection promoted only by the durable Market Data Owner.
#[derive(Debug)]
pub(super) struct StoredStrategyInputSampleProjectionV2 {
    decoded: DecodedStrategyInputSampleProjectionV2,
}

impl StoredStrategyInputSampleProjectionV2 {
    pub(super) const fn receipt_digest(&self) -> [u8; 32] {
        self.decoded.receipt_digest()
    }

    pub(super) const fn kind_tag(&self) -> u8 {
        self.decoded.kind_tag()
    }

    pub(super) const fn subject_identity(&self) -> [u8; 32] {
        self.decoded.subject_identity()
    }

    pub(super) const fn component_count(&self) -> u32 {
        self.decoded.component_count()
    }

    pub(super) fn canonical_bytes(&self) -> &[u8] {
        self.decoded.canonical_bytes()
    }

    #[cfg(feature = "isolated-event-replay-acceptance")]
    pub(super) fn components(
        &self,
    ) -> &[super::sample_projection::DecodedStrategyInputSampleProjectionComponentV2] {
        self.decoded.components()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub(super) enum BarScheduleCustodyErrorV1 {
    #[error("prepared BAR schedule is unavailable")]
    InvalidPrepared,
    #[error("BAR schedule identity conflicts with durable custody")]
    IdentityConflict,
    #[error("BAR schedule predecessor does not match the durable instrument head")]
    HeadConflict,
    #[error("durable BAR schedule custody is unavailable or corrupt")]
    StoreUnavailable,
    #[error("BAR schedule commit was deliberately rolled back")]
    CommitInterrupted,
    #[error("BAR schedule commit succeeded but its response was lost")]
    ResponseLost,
    #[error("BAR schedule readback is unknown")]
    UnknownReadback,
}

#[derive(Debug)]
pub(super) struct StoredStrategyInputSampleProjectionV3 {
    decoded: DecodedStrategyInputSampleProjectionV3,
}

#[derive(Debug, Eq, PartialEq)]
struct StoredStrategyInputSampleProjectionScheduleDependencyV3 {
    component_ordinal: u32,
    role_identity: [u8; 32],
    binding_receipt_digest: [u8; 32],
    schedule_readback_identity: BarScheduleIdentity,
    schedule_fact_digest: BarScheduleIdentity,
    schedule_cut_identity: BarScheduleIdentity,
    schedule_cut_digest: BarScheduleIdentity,
    schedule_receipt_identity: BarScheduleIdentity,
}

impl StoredStrategyInputSampleProjectionV3 {
    pub(super) const fn receipt_digest(&self) -> [u8; 32] {
        self.decoded.receipt_digest()
    }

    pub(super) const fn kind_tag(&self) -> u8 {
        self.decoded.kind_tag()
    }

    pub(super) const fn lifecycle_tag(&self) -> u8 {
        self.decoded.lifecycle_tag()
    }

    pub(super) const fn subject_identity(&self) -> [u8; 32] {
        self.decoded.subject_identity()
    }

    pub(super) const fn component_count(&self) -> u32 {
        self.decoded.component_count()
    }

    pub(super) fn canonical_bytes(&self) -> &[u8] {
        self.decoded.canonical_bytes()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[cfg(test)]
pub(super) enum BarScheduleCustodyFaultV1 {
    RollbackBeforeCommit,
    ResponseLoss,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[cfg(test)]
pub(super) enum SampleProjectionCustodyFaultV3 {
    RollbackBeforeCommit,
    ResponseLoss,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[cfg(test)]
pub(super) enum SampleProjectionCustodyFaultV2 {
    RollbackBeforeCommit,
    ResponseLoss,
}

#[derive(Debug)]
enum InstrumentAppendAttemptError {
    Public(InstrumentMasterError),
    RetryableContention,
}

impl InstrumentAppendAttemptError {
    const fn store_unavailable() -> Self {
        Self::Public(InstrumentMasterError::StoreUnavailable)
    }

    const fn into_public(self) -> InstrumentMasterError {
        match self {
            Self::Public(error) => error,
            Self::RetryableContention => InstrumentMasterError::StoreUnavailable,
        }
    }
}

impl From<InstrumentMasterError> for InstrumentAppendAttemptError {
    fn from(value: InstrumentMasterError) -> Self {
        Self::Public(value)
    }
}

fn classify_instrument_append_error(
    error: &sqlx::Error,
    unique_fact_conflict_is_retryable: bool,
) -> InstrumentAppendAttemptError {
    let sqlstate = error
        .as_database_error()
        .and_then(sqlx::error::DatabaseError::code);

    if matches!(sqlstate.as_deref(), Some("40001" | "40P01"))
        || (unique_fact_conflict_is_retryable && sqlstate.as_deref() == Some("23505"))
    {
        InstrumentAppendAttemptError::RetryableContention
    } else {
        InstrumentAppendAttemptError::store_unavailable()
    }
}

impl MarketDataOwnerPostgres {
    /// Stores one already-verified point-event FRAME projection as an immutable Owner receipt.
    pub(crate) async fn commit_strategy_input_sample_projection_v2(
        &self,
        prepared: &PreparedStrategyInputSampleProjectionV2,
    ) -> Result<StoredStrategyInputSampleProjectionV2, SampleProjectionCustodyErrorV2> {
        self.commit_strategy_input_sample_projection_inner_v2(prepared, false, false)
            .await
    }

    #[cfg(test)]
    pub(super) async fn commit_strategy_input_sample_projection_with_fault_v2(
        &self,
        prepared: &PreparedStrategyInputSampleProjectionV2,
        fault: SampleProjectionCustodyFaultV2,
    ) -> Result<StoredStrategyInputSampleProjectionV2, SampleProjectionCustodyErrorV2> {
        self.commit_strategy_input_sample_projection_inner_v2(
            prepared,
            fault == SampleProjectionCustodyFaultV2::RollbackBeforeCommit,
            fault == SampleProjectionCustodyFaultV2::ResponseLoss,
        )
        .await
    }

    async fn commit_strategy_input_sample_projection_inner_v2(
        &self,
        prepared: &PreparedStrategyInputSampleProjectionV2,
        rollback_before_commit: bool,
        response_loss: bool,
    ) -> Result<StoredStrategyInputSampleProjectionV2, SampleProjectionCustodyErrorV2> {
        let decoded = validate_prepared_sample_projection_v2(prepared)?;
        let receipt_digest = prepared.receipt_digest();
        let subject_identity = prepared.subject_identity();
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        lock_sample_projection_identities_v2(&mut transaction, subject_identity, receipt_digest)
            .await?;
        validate_sample_projection_dependencies_v2(&mut transaction, &decoded, true).await?;

        if let Some(stored) =
            load_strategy_input_sample_projection_v2(&mut transaction, receipt_digest).await?
        {
            if stored.kind_tag() != prepared.kind_tag()
                || stored.subject_identity() != subject_identity
                || stored.component_count() != prepared.component_count()
                || stored.canonical_bytes() != prepared.canonical_bytes()
            {
                return Err(SampleProjectionCustodyErrorV2::IdentityConflict);
            }
            transaction
                .commit()
                .await
                .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
            return Ok(stored);
        }

        let subject_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM market_data_private.strategy_input_sample_projection_receipts_v2 WHERE kind=$1 AND subject_identity=$2)",
        )
        .bind(i16::from(prepared.kind_tag()))
        .bind(subject_identity.as_slice())
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        if subject_exists {
            return Err(SampleProjectionCustodyErrorV2::SubjectConflict);
        }

        let custody_digest = sample_projection_custody_digest_v2(
            receipt_digest,
            prepared.kind_tag(),
            subject_identity,
            prepared.component_count(),
            prepared.canonical_bytes(),
        );
        sqlx::query("INSERT INTO market_data_private.strategy_input_sample_projection_receipts_v2(receipt_digest,kind,subject_identity,component_count,receipt_bytes,custody_digest) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(receipt_digest.as_slice())
            .bind(i16::from(prepared.kind_tag()))
            .bind(subject_identity.as_slice())
            .bind(i64::from(prepared.component_count()))
            .bind(prepared.canonical_bytes())
            .bind(custody_digest.as_slice())
            .execute(&mut *transaction)
            .await
            .map_err(|e| map_sample_projection_insert_error_v2(&e))?;
        if rollback_before_commit {
            return Err(SampleProjectionCustodyErrorV2::CommitInterrupted);
        }
        transaction
            .commit()
            .await
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        if response_loss {
            Err(SampleProjectionCustodyErrorV2::ResponseLost)
        } else {
            promote_stored_strategy_input_sample_projection_v2(
                prepared.canonical_bytes(),
                receipt_digest,
            )
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)
        }
    }

    /// Resolves one exact historical FRAME projection through its fixed Owner resolver.
    pub(crate) async fn resolve_strategy_input_sample_projection_v2(
        &self,
        receipt_digest: [u8; 32],
    ) -> Result<StoredStrategyInputSampleProjectionV2, SampleProjectionCustodyErrorV2> {
        resolve_strategy_input_sample_projection_from_pool_v2(&self.pool, receipt_digest).await
    }

    /// Stores one already-verified BAR FRAME projection under the additive V3 lifecycle custody.
    pub(crate) async fn commit_strategy_input_sample_projection_v3(
        &self,
        prepared: &PreparedStrategyInputSampleProjectionV3,
    ) -> Result<StoredStrategyInputSampleProjectionV3, SampleProjectionCustodyErrorV2> {
        self.commit_strategy_input_sample_projection_inner_v3(prepared, false, false)
            .await
    }

    #[cfg(test)]
    pub(super) async fn commit_strategy_input_sample_projection_with_fault_v3(
        &self,
        prepared: &PreparedStrategyInputSampleProjectionV3,
        fault: SampleProjectionCustodyFaultV3,
    ) -> Result<StoredStrategyInputSampleProjectionV3, SampleProjectionCustodyErrorV2> {
        self.commit_strategy_input_sample_projection_inner_v3(
            prepared,
            fault == SampleProjectionCustodyFaultV3::RollbackBeforeCommit,
            fault == SampleProjectionCustodyFaultV3::ResponseLoss,
        )
        .await
    }

    async fn commit_strategy_input_sample_projection_inner_v3(
        &self,
        prepared: &PreparedStrategyInputSampleProjectionV3,
        rollback_before_commit: bool,
        response_loss: bool,
    ) -> Result<StoredStrategyInputSampleProjectionV3, SampleProjectionCustodyErrorV2> {
        let (decoded, dependencies) = validate_prepared_sample_projection_v3(prepared)?;
        let receipt_digest = prepared.receipt_digest();
        let subject_identity = prepared.subject_identity();
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        lock_sample_projection_identities_v2(&mut transaction, subject_identity, receipt_digest)
            .await?;
        validate_sample_projection_dependencies_v3(&mut transaction, &decoded, &dependencies, true)
            .await?;

        if let Some(stored) =
            load_strategy_input_sample_projection_v3(&mut transaction, receipt_digest).await?
        {
            let stored_dependencies =
                load_sample_projection_schedule_dependencies_v3(&mut transaction, receipt_digest)
                    .await?;

            if stored.kind_tag() != prepared.kind_tag()
                || stored.lifecycle_tag() != prepared.lifecycle_tag()
                || stored.subject_identity() != subject_identity
                || stored.component_count() != prepared.component_count()
                || stored.canonical_bytes() != prepared.canonical_bytes()
                || stored_dependencies != dependencies
            {
                return Err(SampleProjectionCustodyErrorV2::IdentityConflict);
            }
            transaction
                .commit()
                .await
                .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
            return Ok(stored);
        }

        let subject_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM market_data_private.strategy_input_sample_projection_receipts_v3 WHERE kind=$1 AND lifecycle=$2 AND subject_identity=$3)",
        )
        .bind(i16::from(prepared.kind_tag()))
        .bind(i16::from(prepared.lifecycle_tag()))
        .bind(subject_identity.as_slice())
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        if subject_exists {
            return Err(SampleProjectionCustodyErrorV2::SubjectConflict);
        }

        let custody_digest = sample_projection_custody_digest_v3(
            receipt_digest,
            prepared.kind_tag(),
            prepared.lifecycle_tag(),
            subject_identity,
            prepared.component_count(),
            prepared.canonical_bytes(),
            &dependencies,
        );
        sqlx::query("INSERT INTO market_data_private.strategy_input_sample_projection_receipts_v3(receipt_digest,kind,lifecycle,subject_identity,component_count,receipt_bytes,custody_digest) VALUES ($1,$2,$3,$4,$5,$6,$7)")
            .bind(receipt_digest.as_slice())
            .bind(i16::from(prepared.kind_tag()))
            .bind(i16::from(prepared.lifecycle_tag()))
            .bind(subject_identity.as_slice())
            .bind(i64::from(prepared.component_count()))
            .bind(prepared.canonical_bytes())
            .bind(custody_digest.as_slice())
            .execute(&mut *transaction)
            .await
            .map_err(|e| map_sample_projection_insert_error_v2(&e))?;
        insert_sample_projection_schedule_dependencies_v3(
            &mut transaction,
            receipt_digest,
            &dependencies,
        )
        .await?;

        if rollback_before_commit {
            return Err(SampleProjectionCustodyErrorV2::CommitInterrupted);
        }
        transaction
            .commit()
            .await
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        if response_loss {
            Err(SampleProjectionCustodyErrorV2::ResponseLost)
        } else {
            promote_stored_strategy_input_sample_projection_v3(
                prepared.canonical_bytes(),
                receipt_digest,
            )
        }
    }

    pub(crate) async fn resolve_strategy_input_sample_projection_v3(
        &self,
        receipt_digest: [u8; 32],
    ) -> Result<StoredStrategyInputSampleProjectionV3, SampleProjectionCustodyErrorV2> {
        resolve_strategy_input_sample_projection_from_pool_v3(&self.pool, receipt_digest).await
    }

    /// Atomically persists one prepared BAR schedule and its sealed readback custody.
    pub(crate) async fn commit_prepared_bar_schedule_v1(
        &self,
        prepared: &PreparedBarScheduleCommitV1,
    ) -> Result<BarScheduleReadbackV1, BarScheduleCustodyErrorV1> {
        self.commit_prepared_bar_schedule_inner_v1(prepared, false, false)
            .await
    }

    #[cfg(test)]
    pub(super) async fn commit_prepared_bar_schedule_with_fault_v1(
        &self,
        prepared: &PreparedBarScheduleCommitV1,
        fault: BarScheduleCustodyFaultV1,
    ) -> Result<BarScheduleReadbackV1, BarScheduleCustodyErrorV1> {
        self.commit_prepared_bar_schedule_inner_v1(
            prepared,
            fault == BarScheduleCustodyFaultV1::RollbackBeforeCommit,
            fault == BarScheduleCustodyFaultV1::ResponseLoss,
        )
        .await
    }

    async fn commit_prepared_bar_schedule_inner_v1(
        &self,
        prepared: &PreparedBarScheduleCommitV1,
        rollback_before_commit: bool,
        response_loss: bool,
    ) -> Result<BarScheduleReadbackV1, BarScheduleCustodyErrorV1> {
        let fact = prepared.fact();
        let canonical_instrument = fact.canonical_instrument();
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(bar_schedule_string_lock(canonical_instrument))
            .execute(&mut *transaction)
            .await
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;

        if let Some(readback) =
            load_bar_schedule_by_fact(&mut transaction, fact.digest(), true).await?
        {
            if readback.fact().canonical_bytes() != fact.canonical_bytes()
                || readback.fact().digest() != fact.digest()
                || readback.fact().predecessor_fact_digest() != prepared.expected_predecessor()
                || readback.fact().cut_effective_instant() != fact.cut_effective_instant()
            {
                return Err(BarScheduleCustodyErrorV1::IdentityConflict);
            }
            transaction
                .commit()
                .await
                .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
            return Ok(readback);
        }

        let fact_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM market_data_private.bar_schedule_facts_v1 WHERE fact_digest=$1)",
        )
        .bind(fact.digest().as_bytes().as_slice())
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        if fact_exists {
            return Err(BarScheduleCustodyErrorV1::StoreUnavailable);
        }
        let head =
            validate_bar_schedule_history(&mut transaction, canonical_instrument, true).await?;

        if head != prepared.expected_predecessor() {
            return Err(BarScheduleCustodyErrorV1::HeadConflict);
        }

        let database_name: String = sqlx::query_scalar("SELECT current_database()")
            .fetch_one(&mut *transaction)
            .await
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        let generation = bar_schedule_store_generation(&database_name);
        sqlx::query("INSERT INTO market_data_private.bar_schedule_state_v1(singleton,store_generation_identity,append_sequence) VALUES (TRUE,$1,0) ON CONFLICT (singleton) DO NOTHING")
            .bind(generation.as_bytes().as_slice())
            .execute(&mut *transaction)
            .await
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        let state = sqlx::query("UPDATE market_data_private.bar_schedule_state_v1 SET append_sequence=append_sequence+1 WHERE singleton AND store_generation_identity=$1 RETURNING store_generation_identity,append_sequence")
            .bind(generation.as_bytes().as_slice())
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?
            .ok_or(BarScheduleCustodyErrorV1::StoreUnavailable)?;
        let stored_generation = bar_schedule_digest_column(&state, "store_generation_identity")?;
        let append_sequence = positive_u64(
            state
                .try_get("append_sequence")
                .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?,
        )
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        let receipt = build_bar_schedule_receipt(
            fact,
            &decode_bar_schedule_cut(prepared.cut_canonical_bytes(), prepared.cut_digest())
                .map_err(|_| BarScheduleCustodyErrorV1::InvalidPrepared)?,
            stored_generation,
            append_sequence,
        )
        .map_err(|_| BarScheduleCustodyErrorV1::InvalidPrepared)?;
        let readback = build_bar_schedule_readback(
            decode_bar_schedule_fact(fact.canonical_bytes(), fact.digest())
                .map_err(|_| BarScheduleCustodyErrorV1::InvalidPrepared)?,
            decode_bar_schedule_cut(prepared.cut_canonical_bytes(), prepared.cut_digest())
                .map_err(|_| BarScheduleCustodyErrorV1::InvalidPrepared)?,
            receipt,
        )
        .map_err(|_| BarScheduleCustodyErrorV1::InvalidPrepared)?;

        sqlx::query("INSERT INTO market_data_private.bar_schedule_facts_v1(fact_digest,canonical_instrument,predecessor_fact_digest,fact_bytes) VALUES ($1,$2,$3,$4)")
            .bind(fact.digest().as_bytes().as_slice())
            .bind(canonical_instrument)
            .bind(fact.predecessor_fact_digest().map(|value| value.as_bytes().to_vec()))
            .bind(fact.canonical_bytes())
            .execute(&mut *transaction)
            .await
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        sqlx::query("INSERT INTO market_data_private.bar_schedule_cuts_v1(cut_identity,fact_digest,cut_bytes) VALUES ($1,$2,$3)")
            .bind(prepared.cut_digest().as_bytes().as_slice())
            .bind(fact.digest().as_bytes().as_slice())
            .bind(prepared.cut_canonical_bytes())
            .execute(&mut *transaction)
            .await
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        sqlx::query("INSERT INTO market_data_private.bar_schedule_receipts_v1(fact_digest,readback_identity,receipt_identity,receipt_bytes,append_sequence) VALUES ($1,$2,$3,$4,$5)")
            .bind(fact.digest().as_bytes().as_slice())
            .bind(readback.digest().as_bytes().as_slice())
            .bind(readback.receipt_identity().as_bytes().as_slice())
            .bind(readback.receipt_canonical_bytes())
            .bind(i64::try_from(append_sequence).map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?)
            .execute(&mut *transaction)
            .await
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        sqlx::query("INSERT INTO market_data_private.bar_schedule_outbox_v1(outbox_identity,fact_digest,receipt_bytes) VALUES ($1,$2,$3)")
            .bind(readback.outbox_identity().as_bytes().as_slice())
            .bind(fact.digest().as_bytes().as_slice())
            .bind(readback.receipt_canonical_bytes())
            .execute(&mut *transaction)
            .await
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;

        if let Some(predecessor) = prepared.expected_predecessor() {
            let updated = sqlx::query("UPDATE market_data_private.bar_schedule_heads_v1 SET fact_digest=$1 WHERE canonical_instrument=$2 AND fact_digest=$3")
                .bind(fact.digest().as_bytes().as_slice())
                .bind(canonical_instrument)
                .bind(predecessor.as_bytes().as_slice())
                .execute(&mut *transaction)
                .await
                .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
            if updated.rows_affected() != 1 {
                return Err(BarScheduleCustodyErrorV1::HeadConflict);
            }
        } else {
            sqlx::query("INSERT INTO market_data_private.bar_schedule_heads_v1(canonical_instrument,fact_digest) VALUES ($1,$2)")
                .bind(canonical_instrument)
                .bind(fact.digest().as_bytes().as_slice())
                .execute(&mut *transaction)
                .await
                .map_err(|_| BarScheduleCustodyErrorV1::HeadConflict)?;
        }

        if rollback_before_commit {
            return Err(BarScheduleCustodyErrorV1::CommitInterrupted);
        }
        transaction
            .commit()
            .await
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        if response_loss {
            Err(BarScheduleCustodyErrorV1::ResponseLost)
        } else {
            Ok(readback)
        }
    }

    /// Persists one contract-verified sample and returns a verified native readback.
    ///
    /// The timeframe projection is idempotently stored first under its own immutable receipt;
    /// the sample fact, receipt, outbox, and both heads then commit atomically together.
    pub(crate) async fn commit_prepared_sample_v1(
        &self,
        prepared: &PreparedSampleCommitV1,
    ) -> Result<StoredSampleReadbackV1, SampleCustodyErrorV1> {
        self.store_timeframe_projection_receipt_v1(
            prepared.timeframe_projection_receipt_digest(),
            prepared.timeframe_projection_binding_receipt_digest(),
            prepared.timeframe_projection_receipt_bytes(),
        )
        .await?;
        let custody = PreparedSampleCustodyV1::from_prepared_contract(prepared);
        let stored = self.commit_sample_custody_v1(&custody).await?;
        if stored.receipt_digest() != prepared.sample_receipt_digest()
            || stored.exact_receipt_bytes() != prepared.sample_receipt_canonical_bytes()
        {
            return Err(SampleCustodyErrorV1::StoreUnavailable);
        }
        verify_stored_sample_readback_v1(
            prepared.fact_canonical_bytes(),
            prepared.fact_digest(),
            stored.exact_receipt_bytes(),
            stored.receipt_digest(),
        )
        .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)
    }

    /// Resolves and verifies one exact historical native sample readback.
    pub(crate) async fn resolve_prepared_sample_v1(
        &self,
        receipt_digest: [u8; 32],
    ) -> Result<StoredSampleReadbackV1, SampleCustodyErrorV1> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
        let stored = load_sample_custody(&mut transaction, receipt_digest)
            .await?
            .ok_or(SampleCustodyErrorV1::UnknownReceipt)?;
        transaction
            .commit()
            .await
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
        verify_stored_sample_readback_v1(
            &stored.prepared.fact_bytes,
            stored.prepared.fact_digest,
            &stored.prepared.receipt_bytes,
            stored.prepared.receipt_digest,
        )
        .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)
    }

    /// Stores one already-validated timeframe projection receipt without interpreting its label.
    async fn store_timeframe_projection_receipt_v1(
        &self,
        receipt_digest: [u8; 32],
        binding_receipt_digest: [u8; 32],
        receipt_bytes: &[u8],
    ) -> Result<(), SampleCustodyErrorV1> {
        if zero_digest(receipt_digest)
            || zero_digest(binding_receipt_digest)
            || receipt_bytes.is_empty()
        {
            return Err(SampleCustodyErrorV1::InvalidInput);
        }
        let custody_digest =
            projection_custody_digest(receipt_digest, binding_receipt_digest, receipt_bytes);
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(sample_advisory_key(binding_receipt_digest))
            .execute(&mut *transaction)
            .await
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;

        if let Some(row) = sqlx::query("SELECT receipt_digest,receipt_bytes,custody_digest FROM market_data_private.timeframe_projection_receipts_v1 WHERE binding_receipt_digest=$1")
            .bind(binding_receipt_digest.as_slice())
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?
        {
            let stored_bytes: Vec<u8> = row.try_get("receipt_bytes").map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
            let stored_custody = sample_digest_column(&row, "custody_digest")?;
            let stored_digest = sample_digest_column(&row, "receipt_digest")?;
            if stored_digest != receipt_digest
                || stored_bytes != receipt_bytes
                || stored_custody != custody_digest
            {
                return Err(SampleCustodyErrorV1::ProjectionConflict);
            }
            transaction.commit().await.map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
            return Ok(());
        }
        sqlx::query("INSERT INTO market_data_private.timeframe_projection_receipts_v1(receipt_digest,binding_receipt_digest,receipt_bytes,custody_digest) VALUES ($1,$2,$3,$4)")
            .bind(receipt_digest.as_slice())
            .bind(binding_receipt_digest.as_slice())
            .bind(receipt_bytes)
            .bind(custody_digest.as_slice())
            .execute(&mut *transaction)
            .await
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)
    }

    /// Atomically persists one sample and compare-and-swap advances both of its heads.
    async fn commit_sample_custody_v1(
        &self,
        prepared: &PreparedSampleCustodyV1,
    ) -> Result<SampleCustodyReadbackV1, SampleCustodyErrorV1> {
        self.commit_sample_custody_inner_v1(prepared, false, false)
            .await
    }

    #[cfg(test)]
    pub(super) async fn commit_sample_custody_with_fault_v1(
        &self,
        prepared: &PreparedSampleCustodyV1,
        fault: SampleCustodyFaultV1,
    ) -> Result<SampleCustodyReadbackV1, SampleCustodyErrorV1> {
        self.commit_sample_custody_inner_v1(
            prepared,
            fault == SampleCustodyFaultV1::RollbackBeforeHeads,
            fault == SampleCustodyFaultV1::ResponseLoss,
        )
        .await
    }

    async fn commit_sample_custody_inner_v1(
        &self,
        prepared: &PreparedSampleCustodyV1,
        rollback_before_heads: bool,
        response_loss: bool,
    ) -> Result<SampleCustodyReadbackV1, SampleCustodyErrorV1> {
        validate_prepared_sample(prepared)?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
        let mut locks = [
            sample_advisory_key(prepared.series_identity),
            sample_advisory_key(prepared.correction_slot_identity),
        ];
        locks.sort_unstable();
        for lock in locks {
            sqlx::query("SELECT pg_advisory_xact_lock($1)")
                .bind(lock)
                .execute(&mut *transaction)
                .await
                .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
        }

        validate_projection_in_transaction(&mut transaction, prepared).await?;
        if let Some(stored) = load_sample_custody(&mut transaction, prepared.receipt_digest).await?
        {
            if stored.prepared == *prepared {
                transaction
                    .commit()
                    .await
                    .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
                return Ok(SampleCustodyReadbackV1 {
                    receipt_digest: prepared.receipt_digest,
                    receipt_bytes: stored.prepared.receipt_bytes,
                });
            }
            return Err(SampleCustodyErrorV1::IdentityConflict);
        }
        let identity_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM market_data_private.sample_facts_v1 WHERE sample_identity=$1 OR fact_digest=$2 UNION ALL SELECT 1 FROM market_data_private.sample_receipts_v1 WHERE receipt_digest=$3 UNION ALL SELECT 1 FROM market_data_private.sample_outbox_v1 WHERE outbox_identity=$4)")
            .bind(prepared.sample_identity.as_slice()).bind(prepared.fact_digest.as_slice()).bind(prepared.receipt_digest.as_slice()).bind(prepared.outbox_identity.as_slice())
            .fetch_one(&mut *transaction).await.map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
        if identity_exists {
            return Err(SampleCustodyErrorV1::IdentityConflict);
        }
        validate_series_predecessor(&mut transaction, prepared).await?;
        validate_correction_predecessor(&mut transaction, prepared).await?;

        let fact_custody = sample_fact_custody_digest(prepared);
        sqlx::query("INSERT INTO market_data_private.sample_facts_v1(sample_identity,fact_digest,series_identity,series_predecessor_identity,series_sequence,correction_slot_identity,correction_predecessor_identity,correction_sequence,logical_time,lineage_version,projection_receipt_digest,fact_bytes,custody_digest) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
            .bind(prepared.sample_identity.as_slice()).bind(prepared.fact_digest.as_slice()).bind(prepared.series_identity.as_slice()).bind(prepared.series_predecessor_identity.map(|v| v.to_vec())).bind(sample_i64(prepared.series_sequence)?).bind(prepared.correction_slot_identity.as_slice()).bind(prepared.correction_predecessor_identity.map(|v| v.to_vec())).bind(sample_i64(prepared.correction_sequence)?).bind(sample_i64(prepared.logical_time)?).bind(sample_i64(prepared.lineage_version)?).bind(prepared.projection_receipt_digest.as_slice()).bind(&prepared.fact_bytes).bind(fact_custody.as_slice())
            .execute(&mut *transaction).await.map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
        let receipt_custody = sample_receipt_custody_digest(
            prepared.sample_identity,
            prepared.receipt_digest,
            &prepared.receipt_bytes,
        );
        sqlx::query("INSERT INTO market_data_private.sample_receipts_v1(sample_identity,receipt_digest,receipt_bytes,custody_digest) VALUES ($1,$2,$3,$4)")
            .bind(prepared.sample_identity.as_slice()).bind(prepared.receipt_digest.as_slice()).bind(&prepared.receipt_bytes).bind(receipt_custody.as_slice())
            .execute(&mut *transaction).await.map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
        let outbox_custody = sample_outbox_custody_digest(prepared);
        sqlx::query("INSERT INTO market_data_private.sample_outbox_v1(outbox_identity,sample_identity,payload_digest,payload_bytes,custody_digest) VALUES ($1,$2,$3,$4,$5)")
            .bind(prepared.outbox_identity.as_slice()).bind(prepared.sample_identity.as_slice()).bind(prepared.outbox_payload_digest.as_slice()).bind(&prepared.outbox_payload_bytes).bind(outbox_custody.as_slice())
            .execute(&mut *transaction).await.map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
        if rollback_before_heads {
            return Err(SampleCustodyErrorV1::CommitInterrupted);
        }
        cas_series_head(&mut transaction, prepared).await?;
        cas_correction_head(&mut transaction, prepared).await?;
        transaction
            .commit()
            .await
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
        if response_loss {
            Err(SampleCustodyErrorV1::ResponseLost)
        } else {
            Ok(SampleCustodyReadbackV1 {
                receipt_digest: prepared.receipt_digest,
                receipt_bytes: prepared.receipt_bytes.clone(),
            })
        }
    }

    /// Resolves one exact historical receipt and rejects any broken custody join or digest.
    #[cfg(test)]
    pub(super) async fn resolve_sample_receipt_custody_v1(
        &self,
        receipt_digest: [u8; 32],
    ) -> Result<SampleCustodyReadbackV1, SampleCustodyErrorV1> {
        resolve_sample_receipt_from_pool(&self.pool, receipt_digest).await
    }
}

impl MarketDataReadPostgres {
    #[cfg(test)]
    pub(super) async fn resolve_strategy_input_sample_projection_v2(
        &self,
        receipt_digest: [u8; 32],
    ) -> Result<StoredStrategyInputSampleProjectionV2, SampleProjectionCustodyErrorV2> {
        resolve_strategy_input_sample_projection_from_pool_v2(&self.pool, receipt_digest).await
    }

    #[cfg(test)]
    pub(super) async fn resolve_strategy_input_sample_projection_v3(
        &self,
        receipt_digest: [u8; 32],
    ) -> Result<StoredStrategyInputSampleProjectionV3, SampleProjectionCustodyErrorV2> {
        resolve_strategy_input_sample_projection_from_pool_v3(&self.pool, receipt_digest).await
    }

    #[cfg(test)]
    pub(super) async fn resolve_sample_receipt_custody_v1(
        &self,
        receipt_digest: [u8; 32],
    ) -> Result<SampleCustodyReadbackV1, SampleCustodyErrorV1> {
        resolve_sample_receipt_from_pool(&self.pool, receipt_digest).await
    }
}

impl MarketDataOwnerPostgres {
    pub(crate) async fn append_instrument_master_fact(
        &self,
        proposal: InstrumentMasterFactProposalV1,
        clock_locator: &UntrustedClockHeadLocator,
    ) -> Result<InstrumentMasterFactV1, InstrumentMasterError> {
        let replay = proposal.clone();
        match self
            .append_instrument_master_fact_inner(proposal, clock_locator, false)
            .await
        {
            Err(InstrumentAppendAttemptError::RetryableContention) => self
                .append_instrument_master_fact_inner(replay, clock_locator, false)
                .await
                .map_err(InstrumentAppendAttemptError::into_public),
            result => result.map_err(InstrumentAppendAttemptError::into_public),
        }
    }

    #[cfg(test)]
    pub(crate) async fn append_instrument_master_fact_with_rollback(
        &self,
        proposal: InstrumentMasterFactProposalV1,
        clock_locator: &UntrustedClockHeadLocator,
    ) -> Result<InstrumentMasterFactV1, InstrumentMasterError> {
        self.append_instrument_master_fact_inner(proposal, clock_locator, true)
            .await
            .map_err(InstrumentAppendAttemptError::into_public)
    }

    async fn append_instrument_master_fact_inner(
        &self,
        proposal: InstrumentMasterFactProposalV1,
        clock_locator: &UntrustedClockHeadLocator,
        interrupt_before_commit: bool,
    ) -> Result<InstrumentMasterFactV1, InstrumentAppendAttemptError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| InstrumentAppendAttemptError::store_unavailable())?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| InstrumentAppendAttemptError::store_unavailable())?;
        let lock = instrument_string_lock(&proposal.canonical_identity);
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(lock)
            .execute(&mut *transaction)
            .await
            .map_err(|_| InstrumentAppendAttemptError::store_unavailable())?;
        let (handoff, proof) = current_instrument_clock(&mut transaction, clock_locator).await?;
        let fact = build_instrument_fact(proposal, &handoff, proof.as_ref())?;
        let mut facts = load_instrument_facts(
            &mut transaction,
            &[fact.canonical_identity().to_owned()],
            true,
        )
        .await?;

        if let Some(stored) = facts.iter().find(|stored| stored.digest() == fact.digest()) {
            if stored == &fact {
                return Ok(stored.clone());
            }
            return Err(InstrumentMasterError::DigestMismatch.into());
        }
        facts.push(fact.clone());
        validate_instrument_fact_graph(&facts)?;
        sqlx::query("INSERT INTO market_data_private.instrument_master_facts_v1(fact_digest,canonical_identity,predecessor_fact_digest,fact_bytes) VALUES ($1,$2,$3,$4)")
            .bind(fact.digest().as_bytes().as_slice())
            .bind(fact.canonical_identity())
            .bind(fact.predecessor_fact_digest().map(|digest| digest.as_bytes().to_vec()))
            .bind(fact.canonical_bytes())
            .execute(&mut *transaction)
            .await
            .map_err(|e| classify_instrument_append_error(&e, true))?;
        if interrupt_before_commit {
            return Err(InstrumentMasterError::CommitInterrupted.into());
        }
        transaction
            .commit()
            .await
            .map_err(|e| classify_instrument_append_error(&e, false))?;
        Ok(fact)
    }

    async fn resolve_instrument_master_inner(
        &self,
        request: &UntrustedInstrumentMasterRequestV1,
        universe: Option<&dyn InstrumentMasterUniverseMembershipResolver>,
        response_loss: bool,
        interrupt_before_outbox: bool,
    ) -> Result<InstrumentMasterReadbackV1, InstrumentMasterError> {
        if request.consumer_role != super::instrument_master::BACKTEST_OWNER_V1 {
            return Err(InstrumentMasterError::WrongRole);
        }
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| InstrumentMasterError::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| InstrumentMasterError::StoreUnavailable)?;
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(advisory_key(request.request_identity))
            .execute(&mut *transaction)
            .await
            .map_err(|_| InstrumentMasterError::StoreUnavailable)?;

        if let Some(readback) =
            load_durable_instrument_readback(&mut transaction, request.request_identity, true)
                .await?
        {
            if !instrument_cut_matches_request(readback.cut(), request)
                || readback.stable_correlation != request.stable_correlation
            {
                return Err(InstrumentMasterError::RequestConflict);
            }
            transaction
                .commit()
                .await
                .map_err(|_| InstrumentMasterError::StoreUnavailable)?;
            return Ok(readback);
        }

        let members = match (&request.scope, universe) {
            (InstrumentMasterScopeV1::ExactInstrument(identity), None) if !identity.is_empty() => {
                vec![identity.clone()]
            }
            (InstrumentMasterScopeV1::UniverseSelectionRecord(identity), Some(resolver)) => {
                let membership = resolver.resolve_instrument_master_membership(*identity)?;
                if membership.selection_identity != *identity {
                    return Err(InstrumentMasterError::MembershipMismatch);
                }
                membership.members
            }
            _ => return Err(InstrumentMasterError::MembershipMismatch),
        };
        let (handoff, proof) =
            current_instrument_clock(&mut transaction, &request.clock_head).await?;
        let clock = instrument_clock_projection(&handoff, proof.as_ref())?;
        let facts = load_instrument_facts(&mut transaction, &members, true).await?;
        validate_instrument_fact_graph(&facts)?;
        let selected = select_instrument_facts(
            &facts,
            &members,
            request.effective_instant,
            request.owner_observation,
            request.decision_cut,
            &clock,
        )?;
        let cut = build_instrument_cut(request, members, &selected, clock)?;

        let database_name: String = sqlx::query_scalar("SELECT current_database()")
            .fetch_one(&mut *transaction)
            .await
            .map_err(|_| InstrumentMasterError::StoreUnavailable)?;
        let generation = instrument_store_generation(&database_name);
        sqlx::query("INSERT INTO market_data_private.instrument_master_state_v1(singleton,store_generation_identity,append_sequence) VALUES (TRUE,$1,0) ON CONFLICT (singleton) DO NOTHING")
            .bind(generation.as_bytes().as_slice()).execute(&mut *transaction).await.map_err(|_| InstrumentMasterError::StoreUnavailable)?;
        let state = sqlx::query("UPDATE market_data_private.instrument_master_state_v1 SET append_sequence=append_sequence+1 WHERE singleton AND store_generation_identity=$1 RETURNING store_generation_identity,append_sequence")
            .bind(generation.as_bytes().as_slice()).fetch_optional(&mut *transaction).await.map_err(|_| InstrumentMasterError::StoreUnavailable)?.ok_or(InstrumentMasterError::StoreUntrusted)?;
        let stored_generation: Vec<u8> = state
            .try_get("store_generation_identity")
            .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
        let append_sequence = positive_u64(
            state
                .try_get("append_sequence")
                .map_err(|_| InstrumentMasterError::StoreUntrusted)?,
        )
        .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
        let receipt = build_instrument_receipt(
            request,
            &selected,
            &cut,
            digest_from_bytes(&stored_generation)
                .map_err(|_| InstrumentMasterError::StoreUntrusted)?,
            append_sequence,
        )?;
        sqlx::query("INSERT INTO market_data_private.instrument_master_cuts_v1(cut_identity,request_identity,cut_bytes) VALUES ($1,$2,$3)")
            .bind(cut.identity().as_bytes().as_slice())
            .bind(request.request_identity.as_bytes().as_slice())
            .bind(cut.canonical_bytes())
            .execute(&mut *transaction).await.map_err(|_| InstrumentMasterError::StoreUnavailable)?;
        sqlx::query("INSERT INTO market_data_private.instrument_master_receipts_v1(request_identity,request_meaning_digest,cut_identity,receipt_identity,receipt_bytes,append_sequence) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(request.request_identity.as_bytes().as_slice()).bind(request.request_meaning_digest.as_bytes().as_slice()).bind(cut.identity().as_bytes().as_slice()).bind(receipt.identity.as_bytes().as_slice()).bind(&receipt.canonical_bytes).bind(i64::try_from(append_sequence).map_err(|_| InstrumentMasterError::StoreUnavailable)?)
            .execute(&mut *transaction).await.map_err(|_| InstrumentMasterError::StoreUnavailable)?;
        if interrupt_before_outbox {
            return Err(InstrumentMasterError::CommitInterrupted);
        }
        sqlx::query("INSERT INTO market_data_private.instrument_master_outbox_v1(outbox_identity,request_identity,receipt_bytes) VALUES ($1,$2,$3)")
            .bind(receipt.identity.as_bytes().as_slice()).bind(request.request_identity.as_bytes().as_slice()).bind(&receipt.canonical_bytes)
            .execute(&mut *transaction).await.map_err(|_| InstrumentMasterError::StoreUnavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| InstrumentMasterError::StoreUnavailable)?;
        if response_loss {
            Err(InstrumentMasterError::ResponseLost)
        } else {
            build_instrument_readback(&receipt)
        }
    }

    #[cfg(test)]
    pub(crate) async fn resolve_instrument_master_with_response_loss(
        &self,
        request: &UntrustedInstrumentMasterRequestV1,
        universe: Option<&dyn InstrumentMasterUniverseMembershipResolver>,
    ) -> Result<InstrumentMasterReadbackV1, InstrumentMasterError> {
        self.resolve_instrument_master_inner(request, universe, true, false)
            .await
    }

    #[cfg(test)]
    pub(crate) async fn resolve_instrument_master_with_rollback(
        &self,
        request: &UntrustedInstrumentMasterRequestV1,
        universe: Option<&dyn InstrumentMasterUniverseMembershipResolver>,
    ) -> Result<InstrumentMasterReadbackV1, InstrumentMasterError> {
        self.resolve_instrument_master_inner(request, universe, false, true)
            .await
    }
}

impl super::instrument_master::resolver_seal::Sealed for MarketDataOwnerPostgres {}

#[async_trait::async_trait]
impl InstrumentMasterResolver for MarketDataOwnerPostgres {
    async fn resolve_instrument_master(
        &self,
        request: &UntrustedInstrumentMasterRequestV1,
        universe: Option<&dyn InstrumentMasterUniverseMembershipResolver>,
    ) -> Result<InstrumentMasterReadbackV1, InstrumentMasterError> {
        self.resolve_instrument_master_inner(request, universe, false, false)
            .await
    }

    async fn recover_instrument_master(
        &self,
        request_identity: InstrumentMasterIdentity,
        request_meaning_digest: InstrumentMasterIdentity,
    ) -> Result<InstrumentMasterReadbackV1, InstrumentMasterError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| InstrumentMasterError::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(|_| InstrumentMasterError::StoreUnavailable)?;
        validate_read_custody(&mut transaction)
            .await
            .map_err(|_| InstrumentMasterError::ClockDiscontinuous)?;
        let readback = load_durable_instrument_readback(&mut transaction, request_identity, false)
            .await?
            .ok_or(InstrumentMasterError::UnknownIdentity)?;
        if readback.request_meaning_digest != request_meaning_digest {
            return Err(InstrumentMasterError::RequestConflict);
        }
        transaction
            .commit()
            .await
            .map_err(|_| InstrumentMasterError::StoreUnavailable)?;
        Ok(readback)
    }
}

impl MarketDataOwnerPostgres {
    async fn resolve_observation_census_inner_v1(
        &self,
        request: &UntrustedObservationCensusRequestV1,
        #[cfg(test)] fault: ObservationCensusFaultV1,
    ) -> Result<ObservationCensusReadbackV1, ObservationCensusErrorV1> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
        let (census, _) =
            observation_census::resolve_and_commit_observation_census_v1(&mut transaction, request)
                .await?;
        #[cfg(test)]
        if fault == ObservationCensusFaultV1::RollbackBeforeCommit {
            return Err(ObservationCensusErrorV1::CommitInterrupted);
        }
        transaction
            .commit()
            .await
            .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
        #[cfg(test)]
        if fault == ObservationCensusFaultV1::ResponseLoss {
            return Err(ObservationCensusErrorV1::ResponseLost);
        }
        Ok(census)
    }

    #[cfg(test)]
    pub(super) async fn resolve_observation_census_with_fault_v1(
        &self,
        request: &UntrustedObservationCensusRequestV1,
        fault: ObservationCensusFaultV1,
    ) -> Result<ObservationCensusReadbackV1, ObservationCensusErrorV1> {
        self.resolve_observation_census_inner_v1(request, fault)
            .await
    }
}

impl super::observation_census::resolver_seal::Sealed for MarketDataOwnerPostgres {}

#[async_trait::async_trait]
impl ObservationCensusResolverV1 for MarketDataOwnerPostgres {
    async fn resolve_observation_census_v1(
        &self,
        request: &UntrustedObservationCensusRequestV1,
    ) -> Result<ObservationCensusReadbackV1, ObservationCensusErrorV1> {
        self.resolve_observation_census_inner_v1(
            request,
            #[cfg(test)]
            ObservationCensusFaultV1::None,
        )
        .await
    }

    async fn recover_observation_census_v1(
        &self,
        locator: &UntrustedObservationCensusLocatorV1,
    ) -> Result<ObservationCensusReadbackV1, ObservationCensusErrorV1> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
        let request =
            observation_census::load_observation_census_request_v1(&mut transaction, locator)
                .await?
                .ok_or(ObservationCensusErrorV1::UnknownIdentity)?;
        let (census, _) = observation_census::resolve_and_commit_observation_census_v1(
            &mut transaction,
            &request,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
        Ok(census)
    }
}

#[async_trait::async_trait]
impl StrategyInputJoinedCutOwnerResolverV1 for MarketDataOwnerPostgres {
    async fn resolve_strategy_input_joined_cut_v1(
        &self,
        locator: &UntrustedStrategyInputJoinedCutLocatorV1,
    ) -> Result<StrategyInputJoinedCutReadbackV1, ObservationCensusErrorV1> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
        let (request, custody_bytes, receipt_digest) =
            observation_census::load_strategy_input_joined_cut_custody_v1(
                &mut transaction,
                locator,
                observation_census::ObservationCensusReadModeV1::LockRows,
            )
            .await?
            .ok_or(ObservationCensusErrorV1::UnknownIdentity)?;
        let (_, joined) = observation_census::resolve_and_commit_observation_census_v1(
            &mut transaction,
            &request,
        )
        .await?;

        if joined.record().identity() != locator.joined_cut_identity()
            || joined.record().canonical_bytes() != custody_bytes.as_ref()
            || joined.record().joined_cut_receipt().digest() != receipt_digest
        {
            return Err(ObservationCensusErrorV1::DigestMismatch);
        }
        transaction
            .commit()
            .await
            .map_err(|_| ObservationCensusErrorV1::StoreUnavailable)?;
        Ok(joined)
    }
}

impl MarketDataReadPostgres {
    #[cfg(not(test))]
    pub(crate) const fn from_admitted(port: AdmittedMarketDataSnapshotPort) -> Self {
        Self {
            admitted_port: port,
        }
    }

    #[cfg(test)]
    pub(crate) async fn connect(database_url: &str) -> Result<Self, SourceBindingError> {
        let pool = PgPoolOptions::new()
            .max_connections(4)
            .connect(database_url)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        Ok(Self { pool })
    }

    #[cfg(test)]
    async fn begin_read_snapshot(
        &self,
    ) -> Result<Transaction<'_, Postgres>, SharedTimeEvidenceError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        Ok(transaction)
    }
}

#[derive(Clone, Debug)]
struct StoredSampleCustodyV1 {
    prepared: PreparedSampleCustodyV1,
}

fn validate_prepared_sample_projection_v2(
    prepared: &PreparedStrategyInputSampleProjectionV2,
) -> Result<DecodedStrategyInputSampleProjectionV2, SampleProjectionCustodyErrorV2> {
    let stored = decode_strategy_input_sample_projection_v2(
        prepared.canonical_bytes(),
        prepared.receipt_digest(),
    )
    .map_err(|_| SampleProjectionCustodyErrorV2::InvalidPrepared)?;

    if stored.kind_tag() != prepared.kind_tag()
        || stored.subject_identity() != prepared.subject_identity()
        || stored.component_count() != prepared.component_count()
        || stored.canonical_bytes() != prepared.canonical_bytes()
    {
        return Err(SampleProjectionCustodyErrorV2::InvalidPrepared);
    }
    Ok(stored)
}

async fn validate_sample_projection_dependencies_v2(
    transaction: &mut Transaction<'_, Postgres>,
    decoded: &DecodedStrategyInputSampleProjectionV2,
    lock_dependencies: bool,
) -> Result<(), SampleProjectionCustodyErrorV2> {
    for component in decoded.components() {
        let sample_receipt_digest = component.sample_receipt_digest();
        let timeframe_projection_digest = component.timeframe_projection_digest();

        if lock_dependencies {
            let sample_locked: Option<Vec<u8>> = sqlx::query_scalar(
                "SELECT receipt_digest FROM market_data_private.sample_receipts_v1 WHERE receipt_digest=$1 FOR KEY SHARE",
            )
            .bind(sample_receipt_digest.as_slice())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
            let timeframe_locked: Option<Vec<u8>> = sqlx::query_scalar(
                "SELECT receipt_digest FROM market_data_private.timeframe_projection_receipts_v1 WHERE receipt_digest=$1 FOR KEY SHARE",
            )
            .bind(timeframe_projection_digest.as_slice())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
            if sample_locked.is_none() || timeframe_locked.is_none() {
                return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
            }
        }

        let stored = load_sample_custody(transaction, sample_receipt_digest)
            .await
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?
            .ok_or(SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        if stored.prepared.projection_receipt_digest != timeframe_projection_digest {
            return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
        }
        let sample = verify_stored_sample_readback_v1(
            &stored.prepared.fact_bytes,
            stored.prepared.fact_digest,
            &stored.prepared.receipt_bytes,
            stored.prepared.receipt_digest,
        )
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        let timeframe = verify_stored_timeframe_projection_v1(
            &stored.prepared.projection_receipt_bytes,
            stored.prepared.projection_receipt_digest,
        )
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        verify_decoded_projection_component_native_v2(component, &timeframe, &sample)
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    }
    Ok(())
}

async fn lock_sample_projection_identities_v2(
    transaction: &mut Transaction<'_, Postgres>,
    subject_identity: [u8; 32],
    receipt_digest: [u8; 32],
) -> Result<(), SampleProjectionCustodyErrorV2> {
    let mut identities = [subject_identity, receipt_digest];
    identities.sort_unstable();
    for identity in identities {
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(sample_advisory_key(identity))
            .execute(&mut **transaction)
            .await
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    }
    Ok(())
}

async fn resolve_strategy_input_sample_projection_from_pool_v2(
    pool: &PgPool,
    receipt_digest: [u8; 32],
) -> Result<StoredStrategyInputSampleProjectionV2, SampleProjectionCustodyErrorV2> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let stored = load_strategy_input_sample_projection_v2(&mut transaction, receipt_digest)
        .await?
        .ok_or(SampleProjectionCustodyErrorV2::UnknownReceipt)?;
    transaction
        .commit()
        .await
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    Ok(stored)
}

async fn load_strategy_input_sample_projection_v2(
    transaction: &mut Transaction<'_, Postgres>,
    expected_digest: [u8; 32],
) -> Result<Option<StoredStrategyInputSampleProjectionV2>, SampleProjectionCustodyErrorV2> {
    let Some(row) = sqlx::query(
        "SELECT * FROM market_data_private.resolve_strategy_input_sample_projection_v2($1)",
    )
    .bind(expected_digest.as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?
    else {
        return Ok(None);
    };
    let receipt_digest = sample_projection_digest_column_v2(&row, "receipt_digest")?;
    let subject_identity = sample_projection_digest_column_v2(&row, "subject_identity")?;
    let custody_digest = sample_projection_digest_column_v2(&row, "custody_digest")?;
    let kind: i16 = row
        .try_get("kind")
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let kind = u8::try_from(kind).map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let component_count: i64 = row
        .try_get("component_count")
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let component_count = u32::try_from(component_count)
        .ok()
        .filter(|count| *count != 0)
        .ok_or(SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let receipt_bytes: Vec<u8> = row
        .try_get("receipt_bytes")
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;

    if receipt_digest != expected_digest
        || custody_digest
            != sample_projection_custody_digest_v2(
                receipt_digest,
                kind,
                subject_identity,
                component_count,
                &receipt_bytes,
            )
    {
        return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
    }
    let stored =
        promote_stored_strategy_input_sample_projection_v2(&receipt_bytes, receipt_digest)?;

    if stored.kind_tag() != kind
        || stored.subject_identity() != subject_identity
        || stored.component_count() != component_count
    {
        return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
    }
    validate_sample_projection_dependencies_v2(transaction, &stored.decoded, false).await?;
    Ok(Some(stored))
}

fn promote_stored_strategy_input_sample_projection_v2(
    bytes: &[u8],
    expected_digest: [u8; 32],
) -> Result<StoredStrategyInputSampleProjectionV2, SampleProjectionCustodyErrorV2> {
    let decoded = decode_strategy_input_sample_projection_v2(bytes, expected_digest)
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    Ok(StoredStrategyInputSampleProjectionV2 { decoded })
}

fn sample_projection_digest_column_v2(
    row: &sqlx::postgres::PgRow,
    column: &'static str,
) -> Result<[u8; 32], SampleProjectionCustodyErrorV2> {
    let bytes: Vec<u8> = row
        .try_get(column)
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    bytes
        .try_into()
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)
}

fn sample_projection_custody_digest_v2(
    receipt_digest: [u8; 32],
    kind: u8,
    subject_identity: [u8; 32],
    component_count: u32,
    receipt_bytes: &[u8],
) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(b"market-data.sample-projection-custody.v2\0");
    digest.update(receipt_digest);
    digest.update([kind]);
    digest.update(subject_identity);
    digest.update(component_count.to_le_bytes());
    digest.update(receipt_bytes);
    digest.finalize().into()
}

fn validate_prepared_sample_projection_v3(
    prepared: &PreparedStrategyInputSampleProjectionV3,
) -> Result<
    (
        DecodedStrategyInputSampleProjectionV3,
        Vec<StoredStrategyInputSampleProjectionScheduleDependencyV3>,
    ),
    SampleProjectionCustodyErrorV2,
> {
    let stored = decode_strategy_input_sample_projection_v3(
        prepared.canonical_bytes(),
        prepared.receipt_digest(),
    )
    .map_err(|_| SampleProjectionCustodyErrorV2::InvalidPrepared)?;

    if prepared.kind_tag() != 0x01
        || prepared.lifecycle_tag() != 0x02
        || stored.kind_tag() != prepared.kind_tag()
        || stored.lifecycle_tag() != prepared.lifecycle_tag()
        || stored.subject_identity() != prepared.subject_identity()
        || stored.component_count() != prepared.component_count()
        || stored.canonical_bytes() != prepared.canonical_bytes()
    {
        return Err(SampleProjectionCustodyErrorV2::InvalidPrepared);
    }
    let dependencies = prepared
        .schedule_dependencies()
        .iter()
        .enumerate()
        .map(|(ordinal, dependency)| {
            let component = stored
                .components()
                .get(ordinal)
                .ok_or(SampleProjectionCustodyErrorV2::InvalidPrepared)?;
            let component_ordinal = u32::try_from(ordinal)
                .map_err(|_| SampleProjectionCustodyErrorV2::InvalidPrepared)?;

            if component.role_identity() != dependency.role_identity()
                || component.binding_receipt_digest() != dependency.binding_receipt_digest()
            {
                return Err(SampleProjectionCustodyErrorV2::InvalidPrepared);
            }
            Ok(StoredStrategyInputSampleProjectionScheduleDependencyV3 {
                component_ordinal,
                role_identity: dependency.role_identity(),
                binding_receipt_digest: dependency.binding_receipt_digest(),
                schedule_readback_identity: BarScheduleIdentity::from_untrusted_bytes(
                    dependency.schedule_readback_identity(),
                ),
                schedule_fact_digest: BarScheduleIdentity::from_untrusted_bytes(
                    dependency.schedule_fact_digest(),
                ),
                schedule_cut_identity: BarScheduleIdentity::from_untrusted_bytes(
                    dependency.schedule_cut_identity(),
                ),
                schedule_cut_digest: BarScheduleIdentity::from_untrusted_bytes(
                    dependency.schedule_cut_digest(),
                ),
                schedule_receipt_identity: BarScheduleIdentity::from_untrusted_bytes(
                    dependency.schedule_receipt_identity(),
                ),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    if dependencies.len() != stored.components().len() {
        return Err(SampleProjectionCustodyErrorV2::InvalidPrepared);
    }
    Ok((stored, dependencies))
}

async fn validate_sample_projection_dependencies_v3(
    transaction: &mut Transaction<'_, Postgres>,
    decoded: &DecodedStrategyInputSampleProjectionV3,
    schedule_dependencies: &[StoredStrategyInputSampleProjectionScheduleDependencyV3],
    lock_dependencies: bool,
) -> Result<(), SampleProjectionCustodyErrorV2> {
    if schedule_dependencies.len() != decoded.components().len() {
        return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
    }

    for (ordinal, (component, schedule_dependency)) in decoded
        .components()
        .iter()
        .zip(schedule_dependencies)
        .enumerate()
    {
        if schedule_dependency.component_ordinal
            != u32::try_from(ordinal)
                .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?
            || schedule_dependency.role_identity != component.role_identity()
            || schedule_dependency.binding_receipt_digest != component.binding_receipt_digest()
        {
            return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
        }
        let sample_receipt_digest = component.sample_receipt_digest();
        let timeframe_projection_digest = component.timeframe_projection_digest();

        if lock_dependencies {
            let sample_locked: Option<Vec<u8>> = sqlx::query_scalar(
                "SELECT receipt_digest FROM market_data_private.sample_receipts_v1 WHERE receipt_digest=$1 FOR KEY SHARE",
            )
            .bind(sample_receipt_digest.as_slice())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
            let timeframe_locked: Option<Vec<u8>> = sqlx::query_scalar(
                "SELECT receipt_digest FROM market_data_private.timeframe_projection_receipts_v1 WHERE receipt_digest=$1 FOR KEY SHARE",
            )
            .bind(timeframe_projection_digest.as_slice())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
            if sample_locked.is_none() || timeframe_locked.is_none() {
                return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
            }
        }
        let stored = load_sample_custody(transaction, sample_receipt_digest)
            .await
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?
            .ok_or(SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        if stored.prepared.projection_receipt_digest != timeframe_projection_digest {
            return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
        }
        let sample = verify_stored_sample_readback_v1(
            &stored.prepared.fact_bytes,
            stored.prepared.fact_digest,
            &stored.prepared.receipt_bytes,
            stored.prepared.receipt_digest,
        )
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        let timeframe = verify_stored_timeframe_projection_v1(
            &stored.prepared.projection_receipt_bytes,
            stored.prepared.projection_receipt_digest,
        )
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        verify_decoded_projection_component_native_v3(component, &timeframe, &sample)
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        validate_schedule_dependency_v3(
            transaction,
            schedule_dependency,
            &timeframe,
            &sample,
            lock_dependencies,
        )
        .await?;
    }
    Ok(())
}

async fn validate_schedule_dependency_v3(
    transaction: &mut Transaction<'_, Postgres>,
    dependency: &StoredStrategyInputSampleProjectionScheduleDependencyV3,
    timeframe: &super::sample_fact::TimeframeProjectionReceiptV1,
    sample: &StoredSampleReadbackV1,
    lock_dependency: bool,
) -> Result<(), SampleProjectionCustodyErrorV2> {
    if lock_dependency {
        let locked: Option<Vec<u8>> = sqlx::query_scalar(
            "SELECT readback_identity FROM market_data_private.bar_schedule_receipts_v1 WHERE readback_identity=$1 FOR KEY SHARE",
        )
        .bind(dependency.schedule_readback_identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        if locked.is_none() {
            return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
        }
    }
    let schedule = load_bar_schedule_readback(transaction, dependency.schedule_readback_identity)
        .await
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?
        .ok_or(SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let fact = schedule.fact();
    if fact.digest() != dependency.schedule_fact_digest
        || schedule.cut.identity != dependency.schedule_cut_identity
        || schedule.cut.identity != dependency.schedule_cut_digest
        || schedule.receipt_identity() != dependency.schedule_receipt_identity
        || schedule_timeframe_spec_bytes_v3(fact)? != *timeframe.spec().canonical_bytes()
        || fact.cut_effective_instant() != i128::from(sample.receipt().event_effective())
        || i128::from(sample.receipt().event_effective()) < fact.effective_from()
        || fact
            .effective_until()
            .is_some_and(|until| i128::from(sample.receipt().event_effective()) >= until)
        || fact.market_semantics_identity().as_bytes()
            != &sample.receipt().market_semantics_identity()
        || fact.instrument_master_digest().as_bytes() != &sample.fact().instrument_master_digest()
        || fact.schedule_source_frontier().as_bytes() != &sample.fact().source_frontier_digest()
        || fact.schedule_correction_frontier().as_bytes()
            != &sample.fact().correction_frontier_digest()
    {
        return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
    }
    Ok(())
}

fn schedule_timeframe_spec_bytes_v3(
    fact: &super::bar_schedule::BarScheduleFactV1,
) -> Result<[u8; 140], SampleProjectionCustodyErrorV2> {
    let (kind, unit) = match (fact.kind(), fact.unit()) {
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Second) => (0x02, 0x01),
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Minute) => (0x02, 0x02),
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Hour) => (0x02, 0x03),
        (BarScheduleKindV1::ExchangeSession, BarScheduleUnitV1::ExchangeSessionDay) => (0x03, 0x04),
        _ => return Err(SampleProjectionCustodyErrorV2::StoreUnavailable),
    };
    let label = match fact.label() {
        BarScheduleLabelV1::IntervalOpen => 0x01,
        BarScheduleLabelV1::IntervalClose => 0x02,
    };
    let partial = match fact.completion() {
        BarScheduleCompletionV1::CompleteOnly => 0x01,
    };
    let mut bytes = Vec::with_capacity(140);
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&0_u16.to_le_bytes());
    bytes.push(kind);
    bytes.extend_from_slice(&fact.step().to_le_bytes());
    bytes.push(unit);
    bytes.extend_from_slice(fact.anchor_identity().as_bytes());
    bytes.extend_from_slice(fact.calendar_identity().as_bytes());
    bytes.extend_from_slice(fact.session_identity().as_bytes());
    bytes.extend_from_slice(fact.time_zone_identity().as_bytes());
    bytes.push(label);
    bytes.push(partial);
    bytes
        .try_into()
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)
}

async fn insert_sample_projection_schedule_dependencies_v3(
    transaction: &mut Transaction<'_, Postgres>,
    receipt_digest: [u8; 32],
    dependencies: &[StoredStrategyInputSampleProjectionScheduleDependencyV3],
) -> Result<(), SampleProjectionCustodyErrorV2> {
    for dependency in dependencies {
        sqlx::query("INSERT INTO market_data_private.strategy_input_sample_projection_schedule_dependencies_v3(receipt_digest,component_ordinal,role_identity,binding_receipt_digest,schedule_readback_identity,schedule_fact_digest,schedule_cut_identity,schedule_cut_digest,schedule_receipt_identity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(receipt_digest.as_slice())
            .bind(i64::from(dependency.component_ordinal))
            .bind(dependency.role_identity.as_slice())
            .bind(dependency.binding_receipt_digest.as_slice())
            .bind(dependency.schedule_readback_identity.as_bytes().as_slice())
            .bind(dependency.schedule_fact_digest.as_bytes().as_slice())
            .bind(dependency.schedule_cut_identity.as_bytes().as_slice())
            .bind(dependency.schedule_cut_digest.as_bytes().as_slice())
            .bind(dependency.schedule_receipt_identity.as_bytes().as_slice())
            .execute(&mut **transaction)
            .await
            .map_err(|e| map_sample_projection_insert_error_v2(&e))?;
    }
    Ok(())
}

async fn load_sample_projection_schedule_dependencies_v3(
    transaction: &mut Transaction<'_, Postgres>,
    receipt_digest: [u8; 32],
) -> Result<
    Vec<StoredStrategyInputSampleProjectionScheduleDependencyV3>,
    SampleProjectionCustodyErrorV2,
> {
    let rows = sqlx::query("SELECT * FROM market_data_private.resolve_strategy_input_sample_projection_schedule_dependencies_v3($1)")
        .bind(receipt_digest.as_slice())
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    rows.into_iter()
        .map(|row| {
            Ok(StoredStrategyInputSampleProjectionScheduleDependencyV3 {
                component_ordinal: u32::try_from(
                    row.try_get::<i64, _>("component_ordinal")
                        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?,
                )
                .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?,
                role_identity: sample_projection_digest_column_v2(&row, "role_identity")?,
                binding_receipt_digest: sample_projection_digest_column_v2(
                    &row,
                    "binding_receipt_digest",
                )?,
                schedule_readback_identity: bar_schedule_digest_column(
                    &row,
                    "schedule_readback_identity",
                )
                .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?,
                schedule_fact_digest: bar_schedule_digest_column(&row, "schedule_fact_digest")
                    .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?,
                schedule_cut_identity: bar_schedule_digest_column(&row, "schedule_cut_identity")
                    .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?,
                schedule_cut_digest: bar_schedule_digest_column(&row, "schedule_cut_digest")
                    .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?,
                schedule_receipt_identity: bar_schedule_digest_column(
                    &row,
                    "schedule_receipt_identity",
                )
                .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?,
            })
        })
        .collect()
}

async fn resolve_strategy_input_sample_projection_from_pool_v3(
    pool: &PgPool,
    receipt_digest: [u8; 32],
) -> Result<StoredStrategyInputSampleProjectionV3, SampleProjectionCustodyErrorV2> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let stored = load_strategy_input_sample_projection_v3(&mut transaction, receipt_digest)
        .await?
        .ok_or(SampleProjectionCustodyErrorV2::UnknownReceipt)?;
    transaction
        .commit()
        .await
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    Ok(stored)
}

async fn load_strategy_input_sample_projection_v3(
    transaction: &mut Transaction<'_, Postgres>,
    expected_digest: [u8; 32],
) -> Result<Option<StoredStrategyInputSampleProjectionV3>, SampleProjectionCustodyErrorV2> {
    let Some(row) = sqlx::query(
        "SELECT * FROM market_data_private.resolve_strategy_input_sample_projection_v3($1)",
    )
    .bind(expected_digest.as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?
    else {
        return Ok(None);
    };
    let receipt_digest = sample_projection_digest_column_v2(&row, "receipt_digest")?;
    let subject_identity = sample_projection_digest_column_v2(&row, "subject_identity")?;
    let custody_digest = sample_projection_digest_column_v2(&row, "custody_digest")?;
    let kind: u8 = u8::try_from(
        row.try_get::<i16, _>("kind")
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?,
    )
    .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let lifecycle: u8 = u8::try_from(
        row.try_get::<i16, _>("lifecycle")
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?,
    )
    .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let component_count = u32::try_from(
        row.try_get::<i64, _>("component_count")
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?,
    )
    .ok()
    .filter(|count| *count != 0)
    .ok_or(SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let receipt_bytes: Vec<u8> = row
        .try_get("receipt_bytes")
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let dependencies =
        load_sample_projection_schedule_dependencies_v3(transaction, receipt_digest).await?;
    if receipt_digest != expected_digest
        || kind != 0x01
        || lifecycle != 0x02
        || custody_digest
            != sample_projection_custody_digest_v3(
                receipt_digest,
                kind,
                lifecycle,
                subject_identity,
                component_count,
                &receipt_bytes,
                &dependencies,
            )
    {
        return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
    }
    let stored =
        promote_stored_strategy_input_sample_projection_v3(&receipt_bytes, receipt_digest)?;

    if stored.kind_tag() != kind
        || stored.lifecycle_tag() != lifecycle
        || stored.subject_identity() != subject_identity
        || stored.component_count() != component_count
    {
        return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
    }
    validate_sample_projection_dependencies_v3(transaction, &stored.decoded, &dependencies, false)
        .await?;
    Ok(Some(stored))
}

fn promote_stored_strategy_input_sample_projection_v3(
    bytes: &[u8],
    expected_digest: [u8; 32],
) -> Result<StoredStrategyInputSampleProjectionV3, SampleProjectionCustodyErrorV2> {
    let decoded = decode_strategy_input_sample_projection_v3(bytes, expected_digest)
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    Ok(StoredStrategyInputSampleProjectionV3 { decoded })
}

fn sample_projection_custody_digest_v3(
    receipt_digest: [u8; 32],
    kind: u8,
    lifecycle: u8,
    subject_identity: [u8; 32],
    component_count: u32,
    receipt_bytes: &[u8],
    dependencies: &[StoredStrategyInputSampleProjectionScheduleDependencyV3],
) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(b"market-data.sample-projection-custody.v3\0");
    digest.update(receipt_digest);
    digest.update([kind, lifecycle]);
    digest.update(subject_identity);
    digest.update(component_count.to_le_bytes());
    digest.update(receipt_bytes);
    for dependency in dependencies {
        digest.update(dependency.component_ordinal.to_le_bytes());
        digest.update(dependency.role_identity);
        digest.update(dependency.binding_receipt_digest);
        digest.update(dependency.schedule_readback_identity.as_bytes());
        digest.update(dependency.schedule_fact_digest.as_bytes());
        digest.update(dependency.schedule_cut_identity.as_bytes());
        digest.update(dependency.schedule_cut_digest.as_bytes());
        digest.update(dependency.schedule_receipt_identity.as_bytes());
    }
    digest.finalize().into()
}

fn bar_schedule_store_generation(database_name: &str) -> BarScheduleIdentity {
    let mut digest = Sha256::new();
    digest.update(b"market-data.bar-schedule-store-generation.v1\0");
    digest.update(database_name.as_bytes());
    BarScheduleIdentity::from_untrusted_bytes(digest.finalize().into())
}

fn bar_schedule_string_lock(value: &str) -> i64 {
    let digest = blake3::hash(value.as_bytes());
    i64::from_be_bytes(digest.as_bytes()[..8].try_into().expect("fixed digest"))
}

fn bar_schedule_digest_column(
    row: &sqlx::postgres::PgRow,
    column: &'static str,
) -> Result<BarScheduleIdentity, BarScheduleCustodyErrorV1> {
    let bytes: Vec<u8> = row
        .try_get(column)
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    bytes
        .try_into()
        .map(BarScheduleIdentity::from_untrusted_bytes)
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)
}

async fn load_bar_schedule_by_fact(
    transaction: &mut Transaction<'_, Postgres>,
    fact_digest: BarScheduleIdentity,
    lock: bool,
) -> Result<Option<BarScheduleReadbackV1>, BarScheduleCustodyErrorV1> {
    let query = if lock {
        "SELECT readback_identity FROM market_data_private.bar_schedule_receipts_v1 WHERE fact_digest=$1 FOR UPDATE"
    } else {
        "SELECT readback_identity FROM market_data_private.bar_schedule_receipts_v1 WHERE fact_digest=$1"
    };
    let identity: Option<Vec<u8>> = sqlx::query_scalar(query)
        .bind(fact_digest.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    let Some(identity) = identity else {
        return Ok(None);
    };
    let identity: [u8; 32] = identity
        .try_into()
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    load_bar_schedule_readback(
        transaction,
        BarScheduleIdentity::from_untrusted_bytes(identity),
    )
    .await
}

async fn load_bar_schedule_readback(
    transaction: &mut Transaction<'_, Postgres>,
    expected_identity: BarScheduleIdentity,
) -> Result<Option<BarScheduleReadbackV1>, BarScheduleCustodyErrorV1> {
    let Some(row) = sqlx::query_scalar::<_, Value>(
        "SELECT to_jsonb(r) FROM market_data_private.resolve_bar_schedule_v1($1) AS r",
    )
    .bind(expected_identity.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?
    else {
        return Ok(None);
    };
    let object = row
        .as_object()
        .ok_or(BarScheduleCustodyErrorV1::StoreUnavailable)?;
    let canonical_instrument = bar_schedule_raw_text(object, "canonical_instrument")?;
    let history = sqlx::query_scalar::<_, Value>(
        "SELECT to_jsonb(h) FROM market_data_private.resolve_bar_schedule_history_v1($1) AS h",
    )
    .bind(canonical_instrument)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?
    .into_iter()
    .map(|value| {
        serde_json::to_vec(&value).map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)
    })
    .collect::<Result<Vec<_>, _>>()?;
    let row = serde_json::to_vec(&row).map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    verify_bar_schedule_storage_evidence(expected_identity, &row, &history).map(Some)
}

/// Verifies fixed raw BAR readback and history evidence from either the test pool or admitted port.
fn verify_bar_schedule_storage_evidence(
    expected_identity: BarScheduleIdentity,
    readback_row: &[u8],
    history_rows: &[Vec<u8>],
) -> Result<BarScheduleReadbackV1, BarScheduleCustodyErrorV1> {
    let value: Value = serde_json::from_slice(readback_row)
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    let row = value
        .as_object()
        .ok_or(BarScheduleCustodyErrorV1::StoreUnavailable)?;
    let fact_digest = bar_schedule_raw_digest(row, "fact_digest")?;
    let cut_identity = bar_schedule_raw_digest(row, "cut_identity")?;
    let readback_identity = bar_schedule_raw_digest(row, "readback_identity")?;
    let receipt_identity = bar_schedule_raw_digest(row, "receipt_identity")?;
    let outbox_identity = bar_schedule_raw_digest(row, "outbox_identity")?;
    let generation = bar_schedule_raw_digest(row, "store_generation_identity")?;
    let predecessor = bar_schedule_raw_optional_digest(row, "predecessor_fact_digest")?;
    let canonical_instrument = bar_schedule_raw_text(row, "canonical_instrument")?;
    let fact_bytes = bar_schedule_raw_bytes(row, "fact_bytes")?;
    let cut_bytes = bar_schedule_raw_bytes(row, "cut_bytes")?;
    let receipt_bytes = bar_schedule_raw_bytes(row, "receipt_bytes")?;
    let outbox_bytes = bar_schedule_raw_bytes(row, "outbox_receipt_bytes")?;
    let append_sequence = bar_schedule_raw_u64(row, "append_sequence", true)?;
    let state_append_sequence = bar_schedule_raw_u64(row, "state_append_sequence", false)?;
    let fact = decode_bar_schedule_fact(&fact_bytes, fact_digest)
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    let cut = decode_bar_schedule_cut(&cut_bytes, cut_identity)
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    let receipt = decode_bar_schedule_receipt(&receipt_bytes, receipt_identity)
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    let expected_fact = decode_bar_schedule_fact(&fact_bytes, fact_digest)
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    let expected_cut = decode_bar_schedule_cut(&cut_bytes, cut_identity)
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    let expected_receipt =
        build_bar_schedule_receipt(&expected_fact, &expected_cut, generation, append_sequence)
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    let expected_readback =
        build_bar_schedule_readback(expected_fact, expected_cut, expected_receipt)
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    let readback = build_bar_schedule_readback(fact, cut, receipt)
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;

    if readback_identity != expected_identity
        || readback.digest() != expected_identity
        || readback.fact().canonical_instrument() != canonical_instrument
        || readback.fact().predecessor_fact_digest() != predecessor
        || readback.fact().digest() != fact_digest
        || readback.receipt_identity() != receipt_identity
        || readback.outbox_identity() != outbox_identity
        || readback.receipt_canonical_bytes() != receipt_bytes
        || receipt_bytes != outbox_bytes
        || receipt_identity != outbox_identity
        || state_append_sequence < append_sequence
        || expected_readback.digest() != readback.digest()
        || expected_readback.receipt_canonical_bytes() != receipt_bytes
    {
        return Err(BarScheduleCustodyErrorV1::StoreUnavailable);
    }
    verify_bar_schedule_history_evidence(canonical_instrument, fact_digest, history_rows)?;
    Ok(readback)
}

fn verify_bar_schedule_history_evidence(
    canonical_instrument: &str,
    expected_fact: BarScheduleIdentity,
    history_rows: &[Vec<u8>],
) -> Result<(), BarScheduleCustodyErrorV1> {
    let mut head = None;
    let mut entries = std::collections::BTreeMap::new();

    for raw in history_rows {
        let value: Value =
            serde_json::from_slice(raw).map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        let row = value
            .as_object()
            .ok_or(BarScheduleCustodyErrorV1::StoreUnavailable)?;
        let observed_head = bar_schedule_raw_optional_digest(row, "head_fact_digest")?;
        if head
            .replace(observed_head)
            .is_some_and(|prior| prior != observed_head)
        {
            return Err(BarScheduleCustodyErrorV1::StoreUnavailable);
        }
        let digest = bar_schedule_raw_digest(row, "fact_digest")?;
        let predecessor = bar_schedule_raw_optional_digest(row, "predecessor_fact_digest")?;
        let bytes = bar_schedule_raw_bytes(row, "fact_bytes")?;
        let fact = decode_bar_schedule_fact(&bytes, digest)
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;

        if fact.canonical_instrument() != canonical_instrument
            || fact.predecessor_fact_digest() != predecessor
            || entries.insert(digest, predecessor).is_some()
        {
            return Err(BarScheduleCustodyErrorV1::StoreUnavailable);
        }
    }
    let head = head
        .flatten()
        .ok_or(BarScheduleCustodyErrorV1::StoreUnavailable)?;
    let mut seen = std::collections::BTreeSet::new();
    let mut cursor = Some(head);
    while let Some(identity) = cursor {
        if !seen.insert(identity) {
            return Err(BarScheduleCustodyErrorV1::StoreUnavailable);
        }
        cursor = *entries
            .get(&identity)
            .ok_or(BarScheduleCustodyErrorV1::StoreUnavailable)?;
    }

    if seen.len() != entries.len() || !entries.contains_key(&expected_fact) {
        return Err(BarScheduleCustodyErrorV1::StoreUnavailable);
    }
    Ok(())
}

fn bar_schedule_raw_text<'a>(
    row: &'a serde_json::Map<String, Value>,
    field: &'static str,
) -> Result<&'a str, BarScheduleCustodyErrorV1> {
    row.get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(BarScheduleCustodyErrorV1::StoreUnavailable)
}

fn bar_schedule_raw_bytes(
    row: &serde_json::Map<String, Value>,
    field: &'static str,
) -> Result<Vec<u8>, BarScheduleCustodyErrorV1> {
    let encoded = row
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| value.strip_prefix("\\x"))
        .ok_or(BarScheduleCustodyErrorV1::StoreUnavailable)?;
    if encoded.len() % 2 != 0 {
        return Err(BarScheduleCustodyErrorV1::StoreUnavailable);
    }
    (0..encoded.len())
        .step_by(2)
        .map(|offset| {
            u8::from_str_radix(&encoded[offset..offset + 2], 16)
                .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)
        })
        .collect()
}

fn bar_schedule_raw_digest(
    row: &serde_json::Map<String, Value>,
    field: &'static str,
) -> Result<BarScheduleIdentity, BarScheduleCustodyErrorV1> {
    bar_schedule_raw_bytes(row, field)?
        .try_into()
        .map(BarScheduleIdentity::from_untrusted_bytes)
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)
}

fn bar_schedule_raw_optional_digest(
    row: &serde_json::Map<String, Value>,
    field: &'static str,
) -> Result<Option<BarScheduleIdentity>, BarScheduleCustodyErrorV1> {
    match row.get(field) {
        Some(Value::Null) => Ok(None),
        Some(_) => bar_schedule_raw_digest(row, field).map(Some),
        None => Err(BarScheduleCustodyErrorV1::StoreUnavailable),
    }
}

fn bar_schedule_raw_u64(
    row: &serde_json::Map<String, Value>,
    field: &'static str,
    positive: bool,
) -> Result<u64, BarScheduleCustodyErrorV1> {
    row.get(field)
        .and_then(Value::as_u64)
        .filter(|value| !positive || *value > 0)
        .ok_or(BarScheduleCustodyErrorV1::StoreUnavailable)
}

async fn validate_bar_schedule_history(
    transaction: &mut Transaction<'_, Postgres>,
    canonical_instrument: &str,
    lock: bool,
) -> Result<Option<BarScheduleIdentity>, BarScheduleCustodyErrorV1> {
    let (head, rows) = if lock {
        let rows = sqlx::query(
            "SELECT fact_digest,predecessor_fact_digest,fact_bytes FROM market_data_private.bar_schedule_facts_v1 WHERE canonical_instrument=$1 FOR UPDATE",
        )
        .bind(canonical_instrument)
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        let head: Option<Vec<u8>> = sqlx::query_scalar(
            "SELECT fact_digest FROM market_data_private.bar_schedule_heads_v1 WHERE canonical_instrument=$1",
        )
        .bind(canonical_instrument)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        (head, rows)
    } else {
        let rows =
            sqlx::query("SELECT * FROM market_data_private.resolve_bar_schedule_history_v1($1)")
                .bind(canonical_instrument)
                .fetch_all(&mut **transaction)
                .await
                .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        let head = rows
            .first()
            .map(|row| {
                row.try_get("head_fact_digest")
                    .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)
            })
            .transpose()?;

        if rows.iter().any(|row| {
            row.try_get::<Option<Vec<u8>>, _>("head_fact_digest")
                .map_or(true, |value| value != head)
        }) {
            return Err(BarScheduleCustodyErrorV1::StoreUnavailable);
        }
        (head, rows)
    };

    if rows.is_empty() {
        return if head.is_none() {
            Ok(None)
        } else {
            Err(BarScheduleCustodyErrorV1::StoreUnavailable)
        };
    }
    let head: [u8; 32] = head
        .ok_or(BarScheduleCustodyErrorV1::StoreUnavailable)?
        .try_into()
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;

    let mut entries = std::collections::BTreeMap::new();

    for row in rows {
        let digest = bar_schedule_digest_column(&row, "fact_digest")?;
        let predecessor: Option<Vec<u8>> = row
            .try_get("predecessor_fact_digest")
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        let predecessor = predecessor
            .map(|value| {
                value
                    .try_into()
                    .map(BarScheduleIdentity::from_untrusted_bytes)
                    .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)
            })
            .transpose()?;
        let bytes: Vec<u8> = row
            .try_get("fact_bytes")
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        let fact = decode_bar_schedule_fact(&bytes, digest)
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;

        if fact.canonical_instrument() != canonical_instrument
            || fact.predecessor_fact_digest() != predecessor
            || entries.insert(digest, predecessor).is_some()
        {
            return Err(BarScheduleCustodyErrorV1::StoreUnavailable);
        }
    }
    let head = BarScheduleIdentity::from_untrusted_bytes(head);
    let mut seen = std::collections::BTreeSet::new();
    let mut cursor = Some(head);
    while let Some(identity) = cursor {
        if !seen.insert(identity) {
            return Err(BarScheduleCustodyErrorV1::StoreUnavailable);
        }
        cursor = *entries
            .get(&identity)
            .ok_or(BarScheduleCustodyErrorV1::StoreUnavailable)?;
    }

    if seen.len() != entries.len() {
        return Err(BarScheduleCustodyErrorV1::StoreUnavailable);
    }
    Ok(Some(head))
}

async fn resolve_bar_schedule_from_pool(
    pool: &PgPool,
    locator: &UntrustedBarScheduleLocatorV1,
) -> Result<BarScheduleReadbackV1, BarScheduleCustodyErrorV1> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    let readback = load_bar_schedule_readback(&mut transaction, locator.digest)
        .await?
        .ok_or(BarScheduleCustodyErrorV1::UnknownReadback)?;
    validate_bar_schedule_history(
        &mut transaction,
        readback.fact().canonical_instrument(),
        false,
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    Ok(readback)
}

fn map_sample_projection_insert_error_v2(error: &sqlx::Error) -> SampleProjectionCustodyErrorV2 {
    if error
        .as_database_error()
        .is_some_and(sqlx::error::DatabaseError::is_unique_violation)
    {
        SampleProjectionCustodyErrorV2::IdentityConflict
    } else {
        SampleProjectionCustodyErrorV2::StoreUnavailable
    }
}

fn validate_prepared_sample(value: &PreparedSampleCustodyV1) -> Result<(), SampleCustodyErrorV1> {
    let identities = [
        value.sample_identity,
        value.fact_digest,
        value.series_identity,
        value.correction_slot_identity,
        value.projection_receipt_digest,
        value.projection_binding_receipt_digest,
        value.receipt_digest,
        value.outbox_identity,
        value.outbox_payload_digest,
    ];

    if identities.into_iter().any(zero_digest)
        || value.series_predecessor_identity == Some(value.sample_identity)
        || value.correction_predecessor_identity == Some(value.sample_identity)
        || value.series_sequence == 0
        || value.correction_sequence == 0
        || value.logical_time == 0
        || value.lineage_version == 0
        || value.projection_receipt_bytes.is_empty()
        || value.fact_bytes.is_empty()
        || value.receipt_bytes.is_empty()
        || value.outbox_payload_bytes.is_empty()
    {
        return Err(SampleCustodyErrorV1::InvalidInput);
    }
    Ok(())
}

async fn validate_projection_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    prepared: &PreparedSampleCustodyV1,
) -> Result<(), SampleCustodyErrorV1> {
    let row = sqlx::query("SELECT binding_receipt_digest,receipt_bytes,custody_digest FROM market_data_private.timeframe_projection_receipts_v1 WHERE receipt_digest=$1 FOR SHARE")
        .bind(prepared.projection_receipt_digest.as_slice())
        .fetch_optional(&mut **transaction).await.map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?
        .ok_or(SampleCustodyErrorV1::ProjectionConflict)?;
    let bytes: Vec<u8> = row
        .try_get("receipt_bytes")
        .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
    let custody = sample_digest_column(&row, "custody_digest")?;
    let binding_receipt_digest = sample_digest_column(&row, "binding_receipt_digest")?;
    if binding_receipt_digest != prepared.projection_binding_receipt_digest
        || bytes != prepared.projection_receipt_bytes
        || custody
            != projection_custody_digest(
                prepared.projection_receipt_digest,
                prepared.projection_binding_receipt_digest,
                &bytes,
            )
    {
        return Err(SampleCustodyErrorV1::ProjectionConflict);
    }
    Ok(())
}

async fn validate_series_predecessor(
    transaction: &mut Transaction<'_, Postgres>,
    prepared: &PreparedSampleCustodyV1,
) -> Result<(), SampleCustodyErrorV1> {
    let head: Option<Vec<u8>> = sqlx::query_scalar("SELECT sample_identity FROM market_data_private.sample_series_heads_v1 WHERE series_identity=$1 FOR UPDATE")
        .bind(prepared.series_identity.as_slice()).fetch_optional(&mut **transaction).await.map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
    match prepared.series_predecessor_identity {
        None if head.is_none() => Ok(()),
        Some(predecessor) if head.as_deref() == Some(predecessor.as_slice()) => {
            let prior = sqlx::query("SELECT series_identity,series_sequence,logical_time,lineage_version FROM market_data_private.sample_facts_v1 WHERE sample_identity=$1")
                .bind(predecessor.as_slice()).fetch_optional(&mut **transaction).await.map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?
                .ok_or(SampleCustodyErrorV1::SeriesHeadConflict)?;
            let prior_series = sample_digest_column(&prior, "series_identity")?;
            let prior_sequence = sample_u64_column(&prior, "series_sequence")?;
            let prior_time = sample_u64_column(&prior, "logical_time")?;
            let prior_version = sample_u64_column(&prior, "lineage_version")?;

            if prior_series == prepared.series_identity
                && prepared.series_sequence
                    == prior_sequence
                        .checked_add(1)
                        .ok_or(SampleCustodyErrorV1::SeriesHeadConflict)?
                && prepared.logical_time > prior_time
                && prepared.lineage_version >= prior_version
            {
                Ok(())
            } else {
                Err(SampleCustodyErrorV1::SeriesHeadConflict)
            }
        }
        _ => Err(SampleCustodyErrorV1::SeriesHeadConflict),
    }
}

async fn validate_correction_predecessor(
    transaction: &mut Transaction<'_, Postgres>,
    prepared: &PreparedSampleCustodyV1,
) -> Result<(), SampleCustodyErrorV1> {
    let head: Option<(Vec<u8>, Vec<u8>)> = sqlx::query_as("SELECT sample_identity,series_identity FROM market_data_private.sample_correction_heads_v1 WHERE correction_slot_identity=$1 FOR UPDATE")
        .bind(prepared.correction_slot_identity.as_slice()).fetch_optional(&mut **transaction).await.map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
    match prepared.correction_predecessor_identity {
        None if head.is_none() => Ok(()),
        Some(predecessor)
            if head.as_ref().is_some_and(|(identity, series)| {
                identity.as_slice() == predecessor && series.as_slice() == prepared.series_identity
            }) =>
        {
            let prior = sqlx::query("SELECT series_identity,correction_slot_identity,correction_sequence FROM market_data_private.sample_facts_v1 WHERE sample_identity=$1")
                .bind(predecessor.as_slice()).fetch_optional(&mut **transaction).await.map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?
                .ok_or(SampleCustodyErrorV1::CorrectionHeadConflict)?;

            if sample_digest_column(&prior, "series_identity")? == prepared.series_identity
                && sample_digest_column(&prior, "correction_slot_identity")?
                    == prepared.correction_slot_identity
                && prepared.correction_sequence
                    == sample_u64_column(&prior, "correction_sequence")?
                        .checked_add(1)
                        .ok_or(SampleCustodyErrorV1::CorrectionHeadConflict)?
            {
                Ok(())
            } else {
                Err(SampleCustodyErrorV1::CorrectionHeadConflict)
            }
        }
        _ => Err(SampleCustodyErrorV1::CorrectionHeadConflict),
    }
}

async fn cas_series_head(
    transaction: &mut Transaction<'_, Postgres>,
    prepared: &PreparedSampleCustodyV1,
) -> Result<(), SampleCustodyErrorV1> {
    let result = if let Some(predecessor) = prepared.series_predecessor_identity {
        sqlx::query("UPDATE market_data_private.sample_series_heads_v1 SET sample_identity=$1 WHERE series_identity=$2 AND sample_identity=$3")
            .bind(prepared.sample_identity.as_slice()).bind(prepared.series_identity.as_slice()).bind(predecessor.as_slice())
            .execute(&mut **transaction).await
    } else {
        sqlx::query("INSERT INTO market_data_private.sample_series_heads_v1(series_identity,sample_identity) VALUES ($1,$2) ON CONFLICT (series_identity) DO NOTHING")
            .bind(prepared.series_identity.as_slice()).bind(prepared.sample_identity.as_slice())
            .execute(&mut **transaction).await
    }
    .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;

    if result.rows_affected() == 1 {
        Ok(())
    } else {
        Err(SampleCustodyErrorV1::SeriesHeadConflict)
    }
}

async fn cas_correction_head(
    transaction: &mut Transaction<'_, Postgres>,
    prepared: &PreparedSampleCustodyV1,
) -> Result<(), SampleCustodyErrorV1> {
    let result = if let Some(predecessor) = prepared.correction_predecessor_identity {
        sqlx::query("UPDATE market_data_private.sample_correction_heads_v1 SET sample_identity=$1 WHERE correction_slot_identity=$2 AND series_identity=$3 AND sample_identity=$4")
            .bind(prepared.sample_identity.as_slice()).bind(prepared.correction_slot_identity.as_slice()).bind(prepared.series_identity.as_slice()).bind(predecessor.as_slice())
            .execute(&mut **transaction).await
    } else {
        sqlx::query("INSERT INTO market_data_private.sample_correction_heads_v1(correction_slot_identity,series_identity,sample_identity) VALUES ($1,$2,$3) ON CONFLICT (correction_slot_identity) DO NOTHING")
            .bind(prepared.correction_slot_identity.as_slice()).bind(prepared.series_identity.as_slice()).bind(prepared.sample_identity.as_slice())
            .execute(&mut **transaction).await
    }
    .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;

    if result.rows_affected() == 1 {
        Ok(())
    } else {
        Err(SampleCustodyErrorV1::CorrectionHeadConflict)
    }
}

async fn resolve_sample_receipt_from_pool(
    pool: &PgPool,
    receipt_digest: [u8; 32],
) -> Result<SampleCustodyReadbackV1, SampleCustodyErrorV1> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
    let stored = load_sample_custody(&mut transaction, receipt_digest)
        .await?
        .ok_or(SampleCustodyErrorV1::UnknownReceipt)?;
    transaction
        .commit()
        .await
        .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
    Ok(SampleCustodyReadbackV1 {
        receipt_digest,
        receipt_bytes: stored.prepared.receipt_bytes,
    })
}

async fn load_sample_custody(
    transaction: &mut Transaction<'_, Postgres>,
    receipt_digest: [u8; 32],
) -> Result<Option<StoredSampleCustodyV1>, SampleCustodyErrorV1> {
    let Some(row) = sqlx::query("SELECT * FROM market_data_private.resolve_sample_receipt_v1($1)")
        .bind(receipt_digest.as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?
    else {
        return Ok(None);
    };
    let prepared = PreparedSampleCustodyV1 {
        sample_identity: sample_digest_column(&row, "sample_identity")?,
        fact_digest: sample_digest_column(&row, "fact_digest")?,
        series_identity: sample_digest_column(&row, "series_identity")?,
        series_predecessor_identity: sample_optional_digest_column(
            &row,
            "series_predecessor_identity",
        )?,
        series_sequence: sample_u64_column(&row, "series_sequence")?,
        correction_slot_identity: sample_digest_column(&row, "correction_slot_identity")?,
        correction_predecessor_identity: sample_optional_digest_column(
            &row,
            "correction_predecessor_identity",
        )?,
        correction_sequence: sample_u64_column(&row, "correction_sequence")?,
        logical_time: sample_u64_column(&row, "logical_time")?,
        lineage_version: sample_u64_column(&row, "lineage_version")?,
        projection_receipt_digest: sample_digest_column(&row, "projection_receipt_digest")?,
        projection_binding_receipt_digest: sample_digest_column(
            &row,
            "projection_binding_receipt_digest",
        )?,
        projection_receipt_bytes: row
            .try_get("projection_receipt_bytes")
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?,
        fact_bytes: row
            .try_get("fact_bytes")
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?,
        receipt_digest: sample_digest_column(&row, "receipt_digest")?,
        receipt_bytes: row
            .try_get("receipt_bytes")
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?,
        outbox_identity: sample_digest_column(&row, "outbox_identity")?,
        outbox_payload_digest: sample_digest_column(&row, "outbox_payload_digest")?,
        outbox_payload_bytes: row
            .try_get("outbox_payload_bytes")
            .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?,
    };
    validate_prepared_sample(&prepared).map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
    let projection_custody = sample_digest_column(&row, "projection_custody_digest")?;
    let fact_custody = sample_digest_column(&row, "fact_custody_digest")?;
    let receipt_custody = sample_digest_column(&row, "receipt_custody_digest")?;
    let outbox_custody = sample_digest_column(&row, "outbox_custody_digest")?;

    if projection_custody
        != projection_custody_digest(
            prepared.projection_receipt_digest,
            prepared.projection_binding_receipt_digest,
            &prepared.projection_receipt_bytes,
        )
        || fact_custody != sample_fact_custody_digest(&prepared)
        || receipt_custody
            != sample_receipt_custody_digest(
                prepared.sample_identity,
                prepared.receipt_digest,
                &prepared.receipt_bytes,
            )
        || outbox_custody != sample_outbox_custody_digest(&prepared)
    {
        return Err(SampleCustodyErrorV1::StoreUnavailable);
    }
    Ok(Some(StoredSampleCustodyV1 { prepared }))
}

fn zero_digest(value: [u8; 32]) -> bool {
    value == [0; 32]
}

fn sample_i64(value: u64) -> Result<i64, SampleCustodyErrorV1> {
    i64::try_from(value).map_err(|_| SampleCustodyErrorV1::InvalidInput)
}

fn sample_u64_column(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<u64, SampleCustodyErrorV1> {
    let value: i64 = row
        .try_get(column)
        .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
    u64::try_from(value).map_err(|_| SampleCustodyErrorV1::StoreUnavailable)
}

fn sample_digest_column(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<[u8; 32], SampleCustodyErrorV1> {
    let value: Vec<u8> = row
        .try_get(column)
        .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
    value
        .try_into()
        .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)
}

fn sample_optional_digest_column(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<Option<[u8; 32]>, SampleCustodyErrorV1> {
    let value: Option<Vec<u8>> = row
        .try_get(column)
        .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)?;
    value
        .map(|bytes| {
            bytes
                .try_into()
                .map_err(|_| SampleCustodyErrorV1::StoreUnavailable)
        })
        .transpose()
}

fn sample_advisory_key(value: [u8; 32]) -> i64 {
    i64::from_be_bytes(value[..8].try_into().expect("fixed digest"))
}

fn sample_hash(domain: &[u8], fields: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    for field in fields {
        hasher.update(
            u64::try_from(field.len())
                .expect("field length fits u64")
                .to_be_bytes(),
        );
        hasher.update(field);
    }
    hasher.finalize().into()
}

fn optional_digest_bytes(value: Option<&[u8; 32]>) -> &[u8] {
    value.map_or(&[], |digest| digest.as_slice())
}

fn projection_custody_digest(
    identity: [u8; 32],
    binding_receipt_digest: [u8; 32],
    bytes: &[u8],
) -> [u8; 32] {
    sample_hash(
        b"market-data.postgres.projection-custody.v1\0",
        &[&identity, &binding_receipt_digest, bytes],
    )
}

fn sample_fact_custody_digest(value: &PreparedSampleCustodyV1) -> [u8; 32] {
    sample_hash(
        b"market-data.postgres.sample-fact-custody.v1\0",
        &[
            &value.sample_identity,
            &value.fact_digest,
            &value.series_identity,
            optional_digest_bytes(value.series_predecessor_identity.as_ref()),
            &value.series_sequence.to_be_bytes(),
            &value.correction_slot_identity,
            optional_digest_bytes(value.correction_predecessor_identity.as_ref()),
            &value.correction_sequence.to_be_bytes(),
            &value.logical_time.to_be_bytes(),
            &value.lineage_version.to_be_bytes(),
            &value.projection_receipt_digest,
            &value.fact_bytes,
        ],
    )
}

fn sample_receipt_custody_digest(sample: [u8; 32], receipt: [u8; 32], bytes: &[u8]) -> [u8; 32] {
    sample_hash(
        b"market-data.postgres.sample-receipt-custody.v1\0",
        &[&sample, &receipt, bytes],
    )
}

fn sample_outbox_custody_digest(value: &PreparedSampleCustodyV1) -> [u8; 32] {
    sample_hash(
        b"market-data.postgres.sample-outbox-custody.v1\0",
        &[
            &value.outbox_identity,
            &value.sample_identity,
            &value.outbox_payload_digest,
            &value.outbox_payload_bytes,
        ],
    )
}

fn exact_source_replay(
    stored: &SourceBindingStoredAggregate,
    proposed: &SourceBindingStoredAggregate,
) -> Result<SourceBindingCommit, SourceBindingError> {
    if stored == proposed {
        Ok(stored.commit().clone())
    } else {
        Err(SourceBindingError::ReplayConflict)
    }
}

fn instrument_store_generation(database_name: &str) -> InstrumentMasterIdentity {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"VIBE_INSTRUMENT_MASTER_STORE_GENERATION_V1\0");
    hasher.update(database_name.as_bytes());
    InstrumentMasterIdentity::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

fn instrument_string_lock(value: &str) -> i64 {
    let digest = blake3::hash(value.as_bytes());
    i64::from_be_bytes(digest.as_bytes()[..8].try_into().expect("fixed digest"))
}

async fn load_durable_instrument_readback(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: InstrumentMasterIdentity,
    lock: bool,
) -> Result<Option<InstrumentMasterReadbackV1>, InstrumentMasterError> {
    let presence: (bool, bool, bool) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM market_data_private.instrument_master_receipts_v1 WHERE request_identity=$1),EXISTS(SELECT 1 FROM market_data_private.instrument_master_cuts_v1 WHERE request_identity=$1),EXISTS(SELECT 1 FROM market_data_private.instrument_master_outbox_v1 WHERE request_identity=$1)",
    )
    .bind(request_identity.as_bytes().as_slice())
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| InstrumentMasterError::StoreUnavailable)?;

    if presence == (false, false, false) {
        return Ok(None);
    }

    if presence != (true, true, true) {
        return Err(InstrumentMasterError::StoreUntrusted);
    }

    let query = if lock {
        "SELECT r.request_identity,r.request_meaning_digest,r.receipt_identity,r.receipt_bytes,r.append_sequence,c.cut_identity,c.cut_bytes,o.outbox_identity,o.receipt_bytes AS outbox_receipt_bytes,s.store_generation_identity,s.append_sequence AS state_append_sequence,(SELECT COUNT(*) FROM market_data_private.instrument_master_cuts_v1) AS cut_count,(SELECT COUNT(*) FROM market_data_private.instrument_master_receipts_v1) AS receipt_count,(SELECT COUNT(*) FROM market_data_private.instrument_master_outbox_v1) AS outbox_count FROM market_data_private.instrument_master_receipts_v1 AS r JOIN market_data_private.instrument_master_cuts_v1 AS c ON c.request_identity=r.request_identity AND c.cut_identity=r.cut_identity JOIN market_data_private.instrument_master_outbox_v1 AS o ON o.request_identity=r.request_identity AND o.outbox_identity=r.receipt_identity CROSS JOIN market_data_private.instrument_master_state_v1 AS s WHERE s.singleton AND r.request_identity=$1 FOR UPDATE OF r,c,o,s"
    } else {
        "SELECT r.request_identity,r.request_meaning_digest,r.receipt_identity,r.receipt_bytes,r.append_sequence,c.cut_identity,c.cut_bytes,o.outbox_identity,o.receipt_bytes AS outbox_receipt_bytes,s.store_generation_identity,s.append_sequence AS state_append_sequence,(SELECT COUNT(*) FROM market_data_private.instrument_master_cuts_v1) AS cut_count,(SELECT COUNT(*) FROM market_data_private.instrument_master_receipts_v1) AS receipt_count,(SELECT COUNT(*) FROM market_data_private.instrument_master_outbox_v1) AS outbox_count FROM market_data_private.instrument_master_receipts_v1 AS r JOIN market_data_private.instrument_master_cuts_v1 AS c ON c.request_identity=r.request_identity AND c.cut_identity=r.cut_identity JOIN market_data_private.instrument_master_outbox_v1 AS o ON o.request_identity=r.request_identity AND o.outbox_identity=r.receipt_identity CROSS JOIN market_data_private.instrument_master_state_v1 AS s WHERE s.singleton AND r.request_identity=$1"
    };
    let row = sqlx::query(query)
        .bind(request_identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| InstrumentMasterError::StoreUnavailable)?
        .ok_or(InstrumentMasterError::StoreUntrusted)?;
    decode_durable_instrument_readback_row(&row, request_identity).map(Some)
}

async fn load_durable_instrument_readback_for_rd_replay(
    transaction: &mut Transaction<'_, Postgres>,
    cut_identity: InstrumentMasterIdentity,
) -> Result<Option<InstrumentMasterReadbackV1>, InstrumentMasterError> {
    let row =
        sqlx::query("SELECT * FROM market_data_rd_api.lock_instrument_master_for_replay_v1($1)")
            .bind(cut_identity.as_bytes().as_slice())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|_| InstrumentMasterError::StoreUnavailable)?;
    row.map(|row| {
        let request_identity: Vec<u8> = row
            .try_get("request_identity")
            .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
        decode_durable_instrument_readback_row(
            &row,
            digest_from_bytes(&request_identity)
                .map_err(|_| InstrumentMasterError::StoreUntrusted)?,
        )
    })
    .transpose()
}

fn decode_durable_instrument_readback_row(
    row: &sqlx::postgres::PgRow,
    request_identity: InstrumentMasterIdentity,
) -> Result<InstrumentMasterReadbackV1, InstrumentMasterError> {
    let row_digest =
        |column: &'static str| -> Result<InstrumentMasterIdentity, InstrumentMasterError> {
            let bytes: Vec<u8> = row
                .try_get(column)
                .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
            digest_from_bytes(&bytes).map_err(|_| InstrumentMasterError::StoreUntrusted)
        };
    let receipt_bytes: Vec<u8> = row
        .try_get("receipt_bytes")
        .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
    let outbox_bytes: Vec<u8> = row
        .try_get("outbox_receipt_bytes")
        .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
    let cut_bytes: Vec<u8> = row
        .try_get("cut_bytes")
        .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
    let receipt = decode_instrument_receipt(&receipt_bytes)?;
    let append_sequence = positive_u64(
        row.try_get("append_sequence")
            .map_err(|_| InstrumentMasterError::StoreUntrusted)?,
    )
    .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
    let state_append_sequence = nonnegative_u64(
        row.try_get("state_append_sequence")
            .map_err(|_| InstrumentMasterError::StoreUntrusted)?,
    )
    .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
    let cut_count = nonnegative_u64(
        row.try_get("cut_count")
            .map_err(|_| InstrumentMasterError::StoreUntrusted)?,
    )
    .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
    let receipt_count = nonnegative_u64(
        row.try_get("receipt_count")
            .map_err(|_| InstrumentMasterError::StoreUntrusted)?,
    )
    .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
    let outbox_count = nonnegative_u64(
        row.try_get("outbox_count")
            .map_err(|_| InstrumentMasterError::StoreUntrusted)?,
    )
    .map_err(|_| InstrumentMasterError::StoreUntrusted)?;

    if row_digest("request_identity")? != request_identity
        || receipt.request_identity != request_identity
        || row_digest("request_meaning_digest")? != receipt.request_meaning_digest
        || row_digest("receipt_identity")? != receipt.identity
        || row_digest("outbox_identity")? != receipt.identity
        || receipt_bytes != outbox_bytes
        || row_digest("cut_identity")? != decode_instrument_cut(&receipt.cut_bytes)?.identity()
        || cut_bytes != receipt.cut_bytes
        || row_digest("store_generation_identity")? != receipt.store_generation_identity
        || append_sequence != receipt.store_append_sequence
        || state_append_sequence != cut_count
        || state_append_sequence != receipt_count
        || state_append_sequence != outbox_count
    {
        return Err(InstrumentMasterError::StoreUntrusted);
    }
    build_instrument_readback(&receipt)
}

async fn current_instrument_clock(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &UntrustedClockHeadLocator,
) -> Result<(ClockHeadHandoff, Option<EpochSuccessorProof>), InstrumentMasterError> {
    validate_read_custody(transaction)
        .await
        .map_err(|_| InstrumentMasterError::ClockDiscontinuous)?;
    let row = sqlx::query("SELECT * FROM market_data_private.resolve_clock_custody_state_v1()")
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| InstrumentMasterError::ClockUnavailable)?
        .ok_or(InstrumentMasterError::ClockUnavailable)?;
    let identity: Vec<u8> = row
        .try_get("head_identity")
        .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
    let digest: Vec<u8> = row
        .try_get("head_digest")
        .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
    let current_locator = UntrustedClockHeadLocator::from_untrusted(
        digest_from_bytes(&identity).map_err(|_| InstrumentMasterError::StoreUntrusted)?,
        digest_from_bytes(&digest).map_err(|_| InstrumentMasterError::StoreUntrusted)?,
    );

    if &current_locator != locator {
        return Err(InstrumentMasterError::ClockMismatch);
    }
    let fact = load_clock_fact_for_read(transaction, locator)
        .await
        .map_err(|_| InstrumentMasterError::ClockUnavailable)?;
    let proof = load_epoch_proof_for_read(transaction, fact.handoff.head_digest())
        .await
        .map_err(|_| InstrumentMasterError::ClockDiscontinuous)?;
    if fact.predecessor_head_digest.is_none() && proof.is_some() {
        return Err(InstrumentMasterError::ClockDiscontinuous);
    }

    if let Some(predecessor_digest) = fact.predecessor_head_digest {
        let prior_row = sqlx::query(
            "SELECT head_identity FROM market_data_private.clock_handoffs_v1 WHERE head_digest=$1",
        )
        .bind(predecessor_digest.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| InstrumentMasterError::ClockDiscontinuous)?
        .ok_or(InstrumentMasterError::ClockDiscontinuous)?;
        let prior_identity: Vec<u8> = prior_row
            .try_get("head_identity")
            .map_err(|_| InstrumentMasterError::ClockDiscontinuous)?;
        let prior = load_clock_fact_for_read_by_identity(
            transaction,
            digest_from_bytes(&prior_identity)
                .map_err(|_| InstrumentMasterError::ClockDiscontinuous)?,
        )
        .await
        .map_err(|_| InstrumentMasterError::ClockDiscontinuous)?;
        let changed_epoch = prior.handoff.clock_epoch() != fact.handoff.clock_epoch();
        if changed_epoch != proof.is_some() {
            return Err(InstrumentMasterError::ClockDiscontinuous);
        }
    }
    Ok((fact.handoff, proof))
}

async fn load_instrument_facts(
    transaction: &mut Transaction<'_, Postgres>,
    members: &[String],
    lock: bool,
) -> Result<Vec<InstrumentMasterFactV1>, InstrumentMasterError> {
    let query = if lock {
        "SELECT fact_digest,canonical_identity,predecessor_fact_digest,fact_bytes FROM market_data_private.instrument_master_facts_v1 WHERE canonical_identity=ANY($1) ORDER BY canonical_identity,fact_digest FOR UPDATE"
    } else {
        "SELECT fact_digest,canonical_identity,predecessor_fact_digest,fact_bytes FROM market_data_private.instrument_master_facts_v1 WHERE canonical_identity=ANY($1) ORDER BY canonical_identity,fact_digest"
    };
    let rows = sqlx::query(query)
        .bind(members)
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| InstrumentMasterError::StoreUnavailable)?;
    rows.into_iter()
        .map(|row| {
            let bytes: Vec<u8> = row
                .try_get("fact_bytes")
                .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
            let fact = decode_instrument_fact(&bytes)?;
            let digest: Vec<u8> = row
                .try_get("fact_digest")
                .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
            let identity: String = row
                .try_get("canonical_identity")
                .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
            let predecessor: Option<Vec<u8>> = row
                .try_get("predecessor_fact_digest")
                .map_err(|_| InstrumentMasterError::StoreUntrusted)?;
            let predecessor = predecessor
                .map(|value| {
                    digest_from_bytes(&value).map_err(|_| InstrumentMasterError::StoreUntrusted)
                })
                .transpose()?;

            if digest_from_bytes(&digest).map_err(|_| InstrumentMasterError::StoreUntrusted)?
                != fact.digest()
                || identity != fact.canonical_identity()
                || predecessor != fact.predecessor_fact_digest()
            {
                return Err(InstrumentMasterError::StoreUntrusted);
            }
            Ok(fact)
        })
        .collect()
}

async fn lock_digests(
    transaction: &mut Transaction<'_, Postgres>,
    first: BindingDigest,
    second: BindingDigest,
) -> Result<(), SourceBindingError> {
    let mut keys = [advisory_key(first), advisory_key(second)];
    keys.sort_unstable();
    for key in keys {
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(key)
            .execute(&mut **transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
    }
    Ok(())
}

fn advisory_key(digest: BindingDigest) -> i64 {
    i64::from_be_bytes(digest.as_bytes()[..8].try_into().expect("fixed digest"))
}

async fn load_source(
    transaction: &mut Transaction<'_, Postgres>,
    binding_id: BindingDigest,
    require_current_head: bool,
) -> Result<Option<SourceBindingStoredAggregate>, SourceBindingError> {
    let row = sqlx::query(
        "SELECT f.binding_id AS row_identity,f.fact_digest,NULL::BYTEA AS request_identity,NULL::BYTEA AS request_digest,NULL::TEXT AS correction_stream_identity,NULL::BIGINT AS correction_sequence,f.lineage_root AS fact_lineage_root,f.lineage_version AS fact_lineage_version,f.aggregate_json,o.event_identity AS outbox_event_identity,o.aggregate_identity AS outbox_aggregate_identity,o.payload AS outbox_payload,o.payload_digest AS outbox_digest,h.lineage_root AS head_lineage_root,h.binding_id AS head_identity,h.fact_digest AS head_digest,h.lineage_version AS head_version FROM market_data_private.source_binding_facts_v1 AS f JOIN market_data_private.source_binding_outbox_v1 AS o ON o.aggregate_identity=f.binding_id JOIN market_data_private.source_binding_heads_v1 AS h ON h.lineage_root=f.lineage_root WHERE f.binding_id=$1",
    )
    .bind(binding_id.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    row.map(|row| decode_source_row(&row, require_current_head))
        .transpose()
}

async fn load_source_for_update(
    transaction: &mut Transaction<'_, Postgres>,
    binding_id: BindingDigest,
    require_current_head: bool,
) -> Result<Option<SourceBindingStoredAggregate>, SourceBindingError> {
    let row = sqlx::query(
        "SELECT f.binding_id AS row_identity,f.fact_digest,NULL::BYTEA AS request_identity,NULL::BYTEA AS request_digest,NULL::TEXT AS correction_stream_identity,NULL::BIGINT AS correction_sequence,f.lineage_root AS fact_lineage_root,f.lineage_version AS fact_lineage_version,f.aggregate_json,o.event_identity AS outbox_event_identity,o.aggregate_identity AS outbox_aggregate_identity,o.payload AS outbox_payload,o.payload_digest AS outbox_digest,h.lineage_root AS head_lineage_root,h.binding_id AS head_identity,h.fact_digest AS head_digest,h.lineage_version AS head_version FROM market_data_private.source_binding_facts_v1 AS f JOIN market_data_private.source_binding_outbox_v1 AS o ON o.aggregate_identity=f.binding_id JOIN market_data_private.source_binding_heads_v1 AS h ON h.lineage_root=f.lineage_root WHERE f.binding_id=$1 FOR UPDATE OF f,o,h",
    )
    .bind(binding_id.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    row.map(|row| decode_source_row(&row, require_current_head))
        .transpose()
}

async fn load_source_for_rd_strategy_input(
    transaction: &mut Transaction<'_, Postgres>,
    binding_id: BindingDigest,
) -> Result<Option<SourceBindingStoredAggregate>, SourceBindingError> {
    let row = sqlx::query("SELECT * FROM market_data_rd_api.lock_source_for_strategy_input_v1($1)")
        .bind(binding_id.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?;
    row.map(|row| decode_source_row(&row, false)).transpose()
}

fn decode_source_row(
    row: &sqlx::postgres::PgRow,
    require_current_head: bool,
) -> Result<SourceBindingStoredAggregate, SourceBindingError> {
    let value: Value = row
        .try_get("aggregate_json")
        .map_err(|_| SourceBindingError::StoreUnavailable)?;
    let aggregate: SourceBindingStoredAggregate =
        serde_json::from_value(value).map_err(|_| SourceBindingError::StoreUnavailable)?;
    let native = decode_native_index(row).map_err(|_| SourceBindingError::StoreUnavailable)?;

    if !verify_source_native(&aggregate, &native, require_current_head) {
        return Err(SourceBindingError::StoreUnavailable);
    }
    Ok(aggregate)
}

async fn source_head(
    transaction: &mut Transaction<'_, Postgres>,
    lineage_root: BindingDigest,
) -> Result<Option<BindingDigest>, SourceBindingError> {
    let value: Option<Vec<u8>> = sqlx::query_scalar(
        "SELECT binding_id FROM market_data_private.source_binding_heads_v1 WHERE lineage_root=$1",
    )
    .bind(lineage_root.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    value
        .map(|value| digest_from_bytes(&value).map_err(|_| SourceBindingError::StoreUnavailable))
        .transpose()
}

async fn source_head_for_update(
    transaction: &mut Transaction<'_, Postgres>,
    lineage_root: BindingDigest,
) -> Result<Option<NativeHead>, SourceBindingError> {
    let row = sqlx::query(
        "SELECT lineage_root,binding_id AS head_identity,fact_digest,lineage_version FROM market_data_private.source_binding_heads_v1 WHERE lineage_root=$1 FOR UPDATE",
    )
    .bind(lineage_root.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    row.map(|row| decode_head(&row).map_err(|_| SourceBindingError::StoreUnavailable))
        .transpose()
}

async fn validate_source_lineage_head_custody(
    transaction: &mut Transaction<'_, Postgres>,
    lineage_root: BindingDigest,
) -> Result<(), SourceBindingError> {
    validate_source_lineage_shape(transaction, lineage_root).await?;
    let head = source_head_for_update(transaction, lineage_root)
        .await?
        .ok_or(SourceBindingError::StoreUnavailable)?;
    load_source_for_update(transaction, head.identity, true)
        .await?
        .ok_or(SourceBindingError::StoreUnavailable)?;
    Ok(())
}

async fn validate_source_lineage_shape(
    transaction: &mut Transaction<'_, Postgres>,
    lineage_root: BindingDigest,
) -> Result<(), SourceBindingError> {
    let valid: bool =
        sqlx::query_scalar("SELECT market_data_private.resolve_source_lineage_custody_v1($1)")
            .bind(lineage_root.as_bytes().as_slice())
            .fetch_one(&mut **transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;

    if !valid {
        super::storage_diagnostic::refused_by_store(
            "source_lineage.shape.custody",
            &"source lineage custody rejected its own stored shape",
        );
        return Err(SourceBindingError::StoreUnavailable);
    }
    let identities: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT member_identity FROM market_data_private.resolve_source_lineage_members_v1($1)",
    )
    .bind(lineage_root.as_bytes().as_slice())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    let mut prior = None;
    let mut terminal_head = None;

    for (offset, identity) in identities.iter().enumerate() {
        let identity =
            digest_from_bytes(identity).map_err(|_| SourceBindingError::StoreUnavailable)?;
        let envelope = load_envelope(
            transaction,
            "SELECT * FROM market_data_private.resolve_source_binding_v1($1)",
            identity,
        )
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?
        .ok_or(SourceBindingError::StoreUnavailable)?;
        let aggregate: SourceBindingStoredAggregate = serde_json::from_value(envelope.aggregate)
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        let fact = aggregate.commit().fact();
        let expected_version = u64::try_from(offset)
            .ok()
            .and_then(|value| value.checked_add(1))
            .ok_or(SourceBindingError::StoreUnavailable)?;

        if !verify_source_native(&aggregate, &envelope.native, false)
            || fact.lineage_root() != lineage_root
            || fact.lineage_version() != expected_version
        {
            return Err(SourceBindingError::StoreUnavailable);
        }

        match prior {
            None if fact.binding_id() == lineage_root
                && fact.predecessor_binding_id().is_none()
                && fact.predecessor_fact_digest().is_none() => {}
            Some((prior_identity, prior_digest))
                if fact.predecessor_binding_id() == Some(prior_identity)
                    && fact.predecessor_fact_digest() == Some(prior_digest) => {}
            _ => return Err(SourceBindingError::StoreUnavailable),
        }
        terminal_head = Some((
            envelope.native.head.lineage_root,
            envelope.native.head.identity,
            envelope.native.head.fact_digest,
            envelope.native.head.lineage_version,
        ));
        prior = Some((fact.binding_id(), fact.digest()));
    }
    let (terminal_identity, terminal_digest) = prior.ok_or(SourceBindingError::StoreUnavailable)?;
    let terminal_version =
        u64::try_from(identities.len()).map_err(|_| SourceBindingError::StoreUnavailable)?;
    let (head_root, head_identity, head_digest, head_version) =
        terminal_head.ok_or(SourceBindingError::StoreUnavailable)?;

    if head_root != lineage_root
        || head_identity != terminal_identity
        || head_digest != terminal_digest
        || head_version != terminal_version
    {
        return Err(SourceBindingError::StoreUnavailable);
    }
    Ok(())
}

async fn validate_owner_history_custody(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), SourceBindingError> {
    let census_is_valid: bool =
        sqlx::query_scalar("SELECT market_data_private.resolve_owner_history_census_custody_v1()")
            .fetch_one(&mut **transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;

    if !census_is_valid {
        // A detection, not an outage: the query ran and the store disagreed with itself. Without
        // this line the two are the same `StoreUnavailable` to every caller and to every log, so
        // "has this check ever caught anything?" could not be answered from any record.
        super::storage_diagnostic::refused_by_store(
            "owner_history.census.custody",
            &"lineage census disagrees with the facts and heads it indexes",
        );
        return Err(SourceBindingError::StoreUnavailable);
    }
    let source_roots: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT lineage_root FROM market_data_private.resolve_source_lineage_roots_v1()",
    )
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;

    for lineage_root in source_roots {
        let lineage_root =
            digest_from_bytes(&lineage_root).map_err(|_| SourceBindingError::StoreUnavailable)?;
        validate_source_lineage_shape(transaction, lineage_root).await?;
    }

    let pit_roots: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT lineage_root FROM market_data_private.resolve_pit_lineage_roots_v1()",
    )
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;

    for lineage_root in pit_roots {
        let lineage_root = digest_from_bytes(&lineage_root).map_err(|e| {
            super::storage_diagnostic::refused_by_store(
                "owner_history.pit_lineage.root_digest",
                &e,
            );
            SourceBindingError::StoreUnavailable
        })?;
        validate_pit_lineage_shape(transaction, lineage_root)
            .await
            .map_err(|e| {
                // This `map_err` crosses an error-type boundary, so before this line the reason a
                // PIT lineage failed its shape check was discarded one statement from where it was
                // produced - the exact defect `storage_diagnostic` was written for.
                super::storage_diagnostic::refused_by_store("owner_history.pit_lineage.shape", &e);
                SourceBindingError::StoreUnavailable
            })?;
    }
    Ok(())
}

async fn install_owner_history_census(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), SourceBindingError> {
    sqlx::query(
        "INSERT INTO market_data_private.source_binding_lineage_census_v1(lineage_root) SELECT lineage_root FROM market_data_private.source_binding_heads_v1 UNION SELECT lineage_root FROM market_data_private.source_binding_facts_v1",
    )
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    sqlx::query(
        "INSERT INTO market_data_private.pit_snapshot_lineage_census_v1(lineage_root) SELECT lineage_root FROM market_data_private.pit_snapshot_heads_v1 UNION SELECT lineage_root FROM market_data_private.pit_snapshot_facts_v1",
    )
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    sqlx::query(
        "INSERT INTO market_data_private.owner_history_census_state_v1(singleton,source_lineage_count,pit_lineage_count) VALUES (TRUE,(SELECT COUNT(*) FROM market_data_private.source_binding_lineage_census_v1),(SELECT COUNT(*) FROM market_data_private.pit_snapshot_lineage_census_v1))",
    )
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    sqlx::query("INSERT INTO market_data_private.owner_migrations_v1(migration_id) VALUES ($1)")
        .bind(OWNER_HISTORY_CENSUS_MIGRATION_ID)
        .execute(&mut **transaction)
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

async fn admit_source_lineage_census(
    transaction: &mut Transaction<'_, Postgres>,
    lineage_root: BindingDigest,
) -> Result<(), SourceBindingError> {
    let inserted: Option<i64> = sqlx::query_scalar(
        "INSERT INTO market_data_private.source_binding_lineage_census_v1(lineage_root) VALUES ($1) ON CONFLICT (lineage_root) DO NOTHING RETURNING 1::BIGINT",
    )
    .bind(lineage_root.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;

    if inserted.is_some() {
        let result = sqlx::query(
            "UPDATE market_data_private.owner_history_census_state_v1 SET source_lineage_count=source_lineage_count+1 WHERE singleton",
        )
        .execute(&mut **transaction)
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?;

        if result.rows_affected() != 1 {
            return Err(SourceBindingError::StoreUnavailable);
        }
    }
    Ok(())
}

async fn insert_source(
    transaction: &mut Transaction<'_, Postgres>,
    aggregate: &SourceBindingStoredAggregate,
    fault: PostgresCommitFault,
) -> Result<(), SourceBindingError> {
    let fact = aggregate.commit().fact();
    admit_source_lineage_census(transaction, fact.lineage_root()).await?;
    let json = serde_json::to_value(aggregate).map_err(|_| SourceBindingError::StoreUnavailable)?;
    sqlx::query(
        "INSERT INTO market_data_private.source_binding_facts_v1(binding_id,fact_digest,lineage_root,lineage_version,aggregate_json) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(fact.binding_id().as_bytes().as_slice())
    .bind(fact.digest().as_bytes().as_slice())
    .bind(fact.lineage_root().as_bytes().as_slice())
    .bind(to_i64(fact.lineage_version())?)
    .bind(json)
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    if fault == PostgresCommitFault::AfterFactBeforeOutbox {
        return Err(SourceBindingError::CommitInterrupted);
    }
    sqlx::query(
        "INSERT INTO market_data_private.source_binding_outbox_v1(event_identity,aggregate_identity,payload_digest,payload) VALUES ($1,$2,$3,$4)",
    )
    .bind(aggregate.outbox().digest().as_bytes().as_slice())
    .bind(fact.binding_id().as_bytes().as_slice())
    .bind(aggregate.outbox().digest().as_bytes().as_slice())
    .bind(aggregate.outbox().payload())
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    sqlx::query(
        "INSERT INTO market_data_private.source_binding_heads_v1(lineage_root,binding_id,fact_digest,lineage_version) VALUES ($1,$2,$3,$4) ON CONFLICT (lineage_root) DO UPDATE SET binding_id=EXCLUDED.binding_id,fact_digest=EXCLUDED.fact_digest,lineage_version=EXCLUDED.lineage_version",
    )
    .bind(fact.lineage_root().as_bytes().as_slice())
    .bind(fact.binding_id().as_bytes().as_slice())
    .bind(fact.digest().as_bytes().as_slice())
    .bind(to_i64(fact.lineage_version())?)
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

fn to_i64(value: u64) -> Result<i64, SourceBindingError> {
    i64::try_from(value).map_err(|_| SourceBindingError::StoreUnavailable)
}

async fn admit_clock(
    transaction: &mut Transaction<'_, Postgres>,
    next: &MarketDataClockAdmission,
) -> Result<(), SourceBindingError> {
    if !next.is_complete() {
        return Err(SourceBindingError::TrustedClockMismatch);
    }
    lock_clock_state(transaction).await?;
    if !shared_time_migration_is_installed(transaction).await? {
        return Err(SourceBindingError::StoreUnavailable);
    }
    validate_owner_history_custody(transaction).await?;
    let current = load_current_clock_for_update(transaction).await?;
    if let Some(current) = current {
        let current_fact = ensure_clock_handoff_state(transaction, &current).await?;
        if next == &current {
            return Ok(());
        }
        validate_same_epoch_successor(&current_fact, next)
            .map_err(|_| SourceBindingError::TrustedClockMismatch)?;
        let next_fact = build_head_fact(next, Some(current_fact.handoff.head_digest()))
            .map_err(|_| SourceBindingError::TrustedClockMismatch)?;
        insert_clock_handoff(transaction, &next_fact).await?;
        insert_clock_membership(
            transaction,
            &next_fact,
            Some(current_fact.handoff.head_identity()),
        )
        .await?;
        update_clock(transaction, next).await?;
        set_clock_handoff_head(transaction, next_fact.handoff.head_identity()).await?;
        advance_clock_handoff_state(transaction, false).await?;
    } else {
        let state = load_clock_handoff_state_for_update(transaction).await?;

        if state.materialized || state.handoff_count != 0 || state.epoch_transition_count != 0 {
            return Err(SourceBindingError::StoreUnavailable);
        }

        if !clock_handoff_history_is_empty(transaction).await? {
            return Err(SourceBindingError::StoreUnavailable);
        }

        if !owner_fact_history_is_empty(transaction).await? {
            return Err(SourceBindingError::StoreUnavailable);
        }
        let fact =
            build_head_fact(next, None).map_err(|_| SourceBindingError::TrustedClockMismatch)?;
        insert_clock_handoff(transaction, &fact).await?;
        insert_clock_membership(transaction, &fact, None).await?;
        insert_clock(transaction, next).await?;
        set_clock_handoff_head(transaction, fact.handoff.head_identity()).await?;
        materialize_initial_clock_handoff_state(transaction).await?;
    }
    Ok(())
}

async fn clock_handoff_history_is_empty(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<bool, SourceBindingError> {
    let count: i64 = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM market_data_private.clock_handoffs_v1) + (SELECT COUNT(*) FROM market_data_private.clock_handoff_head_v1) + (SELECT COUNT(*) FROM market_data_private.clock_handoff_membership_v1) + (SELECT COUNT(*) FROM market_data_private.epoch_successor_proofs_v1)",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(count == 0)
}

async fn owner_fact_history_is_empty(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<bool, SourceBindingError> {
    let count: i64 = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM market_data_private.source_binding_facts_v1) + (SELECT COUNT(*) FROM market_data_private.source_binding_heads_v1) + (SELECT COUNT(*) FROM market_data_private.source_binding_outbox_v1) + (SELECT COUNT(*) FROM market_data_private.pit_snapshot_facts_v1) + (SELECT COUNT(*) FROM market_data_private.pit_snapshot_heads_v1) + (SELECT COUNT(*) FROM market_data_private.pit_snapshot_outbox_v1)",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(count == 0)
}

async fn legacy_owner_history_clocks(
    transaction: &mut Transaction<'_, Postgres>,
    clock: &MarketDataClockAdmission,
) -> Result<Option<Vec<MarketDataClockAdmission>>, SourceBindingError> {
    let mut clocks = Vec::new();
    let source_rows =
        sqlx::query("SELECT aggregate_json FROM market_data_private.source_binding_facts_v1")
            .fetch_all(&mut **transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;

    for row in source_rows {
        let value: Value = row
            .try_get("aggregate_json")
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        let aggregate: SourceBindingStoredAggregate =
            serde_json::from_value(value).map_err(|_| SourceBindingError::StoreUnavailable)?;

        if !verify_source_aggregate(&aggregate) {
            return Ok(None);
        }
        let observed = clock_for_source_time(aggregate.commit().fact().time_evidence());

        if !clocks.contains(&observed) {
            clocks.push(observed);
        }
    }

    let pit_rows =
        sqlx::query("SELECT aggregate_json FROM market_data_private.pit_snapshot_facts_v1")
            .fetch_all(&mut **transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;

    for row in pit_rows {
        let value: Value = row
            .try_get("aggregate_json")
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        let aggregate: PitSnapshotCommitAggregate =
            serde_json::from_value(value).map_err(|_| SourceBindingError::StoreUnavailable)?;

        if !verify_pit_aggregate(&aggregate) {
            return Ok(None);
        }
        let observed = clock_for_pit_time(&aggregate.fact().request().time_evidence);

        if !clocks.contains(&observed) {
            clocks.push(observed);
        }
    }

    if !clocks.contains(clock) {
        clocks.push(clock.clone());
    }
    clocks.sort_by_key(|value| value.monotonic_sequence);
    if clocks.last() != Some(clock) {
        return Ok(None);
    }
    let Some(first) = clocks.first() else {
        return Ok(None);
    };
    let mut prior =
        build_head_fact(first, None).map_err(|_| SourceBindingError::TrustedClockMismatch)?;

    for successor in clocks.iter().skip(1) {
        if validate_same_epoch_successor(&prior, successor).is_err() {
            return Ok(None);
        }
        prior = build_head_fact(successor, Some(prior.handoff.head_digest()))
            .map_err(|_| SourceBindingError::TrustedClockMismatch)?;
    }
    Ok(Some(clocks))
}

async fn shared_time_migration_is_installed(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<bool, SourceBindingError> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM market_data_private.owner_migrations_v1 WHERE migration_id=$1)",
    )
    .bind(SHARED_TIME_MIGRATION_ID)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)
}

/// Resolves the three PIT determinations that belong to Market Data alone.
///
/// Each determination is read back from Owner custody inside the caller's open transaction and
/// never from the requester's claim. An identity the Owner does not hold, or a record whose digest
/// does not match the frozen request, yields `false` so the snapshot carries an explicit blocker;
/// only a store failure propagates as an error.
async fn resolve_owner_snapshot_determination_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedPitSnapshotRequest,
    universe_locator: &UntrustedUniverseSelectionLocatorV1,
    observed_members: &std::collections::BTreeSet<Vec<u8>>,
    source_fact: &SourceBindingFact,
) -> Result<OwnerSnapshotDeterminationV1, PitSnapshotError> {
    let source_available = source_fact.disposition() == SourceBindingDisposition::Admitted;

    // The Market Semantics registry is keyed by a registry key that itself binds the PIT
    // observation batch, so it is downstream of this mint and cannot be consulted here without a
    // cycle. The non-circular Owner evidence at this cut is the admitted Source Binding's own
    // authenticated semantics: the frozen request is compatible exactly when its identity is the
    // one Market Data derives from that binding.
    let semantics_compatible = request.market_semantics_identity
        == derive_market_semantics_compatibility_identity_v1(&source_fact.proposal().semantics);

    let coverage_complete = match universe_selection::recover_universe_selection_in_transaction_v1(
        transaction,
        universe_locator,
    )
    .await
    {
        Ok(readback) => {
            let record = readback.record();
            if record.identity() == request.universe_selection_digest {
                let expected = record
                    .membership()
                    .iter()
                    .filter(|member| member.included())
                    .map(|member| member.member_key().to_vec())
                    .collect::<std::collections::BTreeSet<_>>();
                !expected.is_empty() && &expected == observed_members
            } else {
                false
            }
        }
        Err(UniverseSelectionErrorV1::StoreUnavailable) => {
            return Err(PitSnapshotError::PersistenceUnavailable);
        }
        Err(_) => false,
    };

    Ok(OwnerSnapshotDeterminationV1::from_owner_evidence(
        coverage_complete,
        semantics_compatible,
        source_available,
    ))
}

async fn persist_pit(
    mut transaction: Transaction<'_, Postgres>,
    aggregate: PitSnapshotCommitAggregate,
    batch: Option<PreparedPitObservationBatch>,
    clock: &MarketDataClockAdmission,
    fault: PostgresCommitFault,
    companion: PitPersistCompanionV1,
) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
    let fact = aggregate.fact();
    lock_digests(
        &mut transaction,
        fact.snapshot_identity(),
        fact.lineage_root(),
    )
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;

    if let Some(stored) =
        load_pit_for_update(&mut transaction, fact.snapshot_identity(), false).await?
    {
        validate_materialized_clock_custody(&mut transaction)
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        Box::pin(validate_pit_replay_clock(&mut transaction, &stored)).await?;
        validate_pit_lineage_head_custody(&mut transaction, stored.fact().lineage_root()).await?;
        validate_source_lineage_head_custody(
            &mut transaction,
            stored.fact().source_binding_lineage_root(),
        )
        .await
        .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?;
        if stored != aggregate {
            return Err(PitSnapshotError::ReplayConflict);
        }

        if let Some(expected) = batch.as_ref() {
            let observed = load_pit_observation_batch_for_update(&mut transaction, &stored)
                .await?
                .ok_or(PitSnapshotError::ReplayConflict)?;

            if observed.digest != expected.digest()
                || observed.bytes != expected.bytes()
                || observed.rows != expected.native_rows()?
            {
                return Err(PitSnapshotError::ReplayConflict);
            }
            verify_observation_batch(
                &stored,
                observed.source_binding_identity,
                observed.source_binding_lineage_root,
                observed.source_binding_lineage_version,
                observed.digest,
                &observed.bytes,
                &observed.rows,
            )?;
        }
        return Ok(stored);
    }
    let source_head = source_head_for_update(&mut transaction, fact.source_binding_lineage_root())
        .await
        .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?
        .ok_or(PitSnapshotError::SourceBindingUnavailable)?;
    if !source_head.matches_source_locator(&fact.request().source_binding) {
        return Err(PitSnapshotError::SourceBindingUnavailable);
    }
    let head = pit_head_for_update(&mut transaction, fact.lineage_root()).await?;
    match (fact.lineage_version(), fact.predecessor_snapshot_identity()) {
        (1, None) if head.is_none() => {}
        (_, Some(predecessor))
            if head
                .as_ref()
                .is_some_and(|head| head.matches_pit_identity(predecessor, fact)) => {}
        _ => return Err(PitSnapshotError::CorrectionHeadMismatch),
    }
    admit_clock(&mut transaction, clock)
        .await
        .map_err(|e| match e {
            SourceBindingError::StoreUnavailable => PitSnapshotError::PersistenceUnavailable,
            _ => PitSnapshotError::TrustedClockMismatch,
        })?;
    insert_pit(&mut transaction, &aggregate, fault).await?;
    if fault == PostgresCommitFault::AfterPitOutboxBeforeBatch {
        return Err(PitSnapshotError::CommitInterrupted);
    }

    if let Some(batch) = batch.as_ref() {
        insert_pit_observation_batch(&mut transaction, &aggregate, batch, fault).await?;
    }

    // Which Native Replay census a snapshot joins is decided by the rows this transaction just
    // verified and wrote - never by the requester's scope claim, which names a scope but cannot
    // say whether a snapshot is a frame or the quotes that follow one. Only an available snapshot
    // can have a verified batch read back, so only one can join either census.
    let rows = batch
        .as_ref()
        .filter(|_| aggregate.fact().disposition() == PitSnapshotDisposition::Available)
        .map_or(&[][..], PreparedPitObservationBatch::rows);

    match classify_native_replay_cut_v2(rows) {
        NativeReplayCutKindV2::Frame => {
            admit_native_replay_frame_census(&mut transaction, aggregate.fact()).await?;
        }
        NativeReplayCutKindV2::QuoteCut => {
            admit_native_replay_quote_cut_census(&mut transaction, aggregate.fact()).await?;
        }
        NativeReplayCutKindV2::Neither => {}
    }

    // The R0 record is derived from rows this transaction just wrote and resolves them back
    // through the same locked reads a later caller would use, so a snapshot that cannot carry its
    // own observation evidence never commits at all.
    if companion == PitPersistCompanionV1::OwnerR0Record
        && batch.is_some()
        && aggregate.fact().disposition() == PitSnapshotDisposition::Available
    {
        Box::pin(
            reference_fact_coordinates::append_owner_r0_for_available_pit_v1(
                &mut transaction,
                &aggregate,
            ),
        )
        .await
        .map_err(|e| {
            super::storage_diagnostic::refused_by_store("pit.persist.owner_r0_record", &e);
            PitSnapshotError::PersistenceUnavailable
        })?;
    }
    transaction
        .commit()
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    if fault == PostgresCommitFault::ResponseLoss {
        Err(PitSnapshotError::ResponseLost)
    } else {
        Ok(aggregate)
    }
}

async fn validate_source_replay_clock(
    transaction: &mut Transaction<'_, Postgres>,
    aggregate: &SourceBindingStoredAggregate,
) -> Result<(), SourceBindingError> {
    let expected = clock_for_source_time(aggregate.commit().fact().time_evidence());
    let historical = load_historical_clock(transaction, &expected)
        .await
        .map_err(|e| match e {
            SharedTimeEvidenceError::StoreUnavailable => SourceBindingError::StoreUnavailable,
            _ => SourceBindingError::TrustedClockMismatch,
        })?;
    validate_clock_for_readback(aggregate.commit().fact().time_evidence(), &historical)
}

async fn validate_pit_replay_clock(
    transaction: &mut Transaction<'_, Postgres>,
    aggregate: &PitSnapshotCommitAggregate,
) -> Result<(), PitSnapshotError> {
    let expected = clock_for_pit_time(&aggregate.fact().request().time_evidence);
    let historical = load_historical_clock(transaction, &expected)
        .await
        .map_err(|e| match e {
            SharedTimeEvidenceError::StoreUnavailable => PitSnapshotError::PersistenceUnavailable,
            _ => PitSnapshotError::TrustedClockMismatch,
        })?;
    super::pit_snapshot::authority::validate_read_clock(
        &aggregate.fact().request().time_evidence,
        &historical,
    )
}

async fn load_pit_for_update(
    transaction: &mut Transaction<'_, Postgres>,
    snapshot_identity: BindingDigest,
    require_current_head: bool,
) -> Result<Option<PitSnapshotCommitAggregate>, PitSnapshotError> {
    load_pit(transaction, snapshot_identity, require_current_head, true).await
}

async fn load_pit_for_rd_strategy_input(
    transaction: &mut Transaction<'_, Postgres>,
    snapshot_identity: BindingDigest,
) -> Result<Option<PitSnapshotCommitAggregate>, PitSnapshotError> {
    let row = sqlx::query("SELECT * FROM market_data_rd_api.lock_pit_snapshot_for_replay_v1($1)")
        .bind(snapshot_identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    row.map(|row| decode_pit_row(&row, false)).transpose()
}

async fn load_pit(
    transaction: &mut Transaction<'_, Postgres>,
    snapshot_identity: BindingDigest,
    require_current_head: bool,
    lock: bool,
) -> Result<Option<PitSnapshotCommitAggregate>, PitSnapshotError> {
    let query = if lock {
        "SELECT f.snapshot_identity AS row_identity,f.fact_digest,f.request_identity,f.request_digest,f.correction_stream_identity,f.correction_sequence,f.lineage_root AS fact_lineage_root,f.lineage_version AS fact_lineage_version,f.aggregate_json,o.event_identity AS outbox_event_identity,o.aggregate_identity AS outbox_aggregate_identity,o.payload AS outbox_payload,o.payload_digest AS outbox_digest,h.lineage_root AS head_lineage_root,h.snapshot_identity AS head_identity,h.fact_digest AS head_digest,h.lineage_version AS head_version FROM market_data_private.pit_snapshot_facts_v1 AS f JOIN market_data_private.pit_snapshot_outbox_v1 AS o ON o.aggregate_identity=f.snapshot_identity JOIN market_data_private.pit_snapshot_heads_v1 AS h ON h.lineage_root=f.lineage_root WHERE f.snapshot_identity=$1 FOR UPDATE OF f,o,h"
    } else {
        "SELECT f.snapshot_identity AS row_identity,f.fact_digest,f.request_identity,f.request_digest,f.correction_stream_identity,f.correction_sequence,f.lineage_root AS fact_lineage_root,f.lineage_version AS fact_lineage_version,f.aggregate_json,o.event_identity AS outbox_event_identity,o.aggregate_identity AS outbox_aggregate_identity,o.payload AS outbox_payload,o.payload_digest AS outbox_digest,h.lineage_root AS head_lineage_root,h.snapshot_identity AS head_identity,h.fact_digest AS head_digest,h.lineage_version AS head_version FROM market_data_private.pit_snapshot_facts_v1 AS f JOIN market_data_private.pit_snapshot_outbox_v1 AS o ON o.aggregate_identity=f.snapshot_identity JOIN market_data_private.pit_snapshot_heads_v1 AS h ON h.lineage_root=f.lineage_root WHERE f.snapshot_identity=$1"
    };
    let row = sqlx::query(query)
        .bind(snapshot_identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    row.map(|row| decode_pit_row(&row, require_current_head))
        .transpose()
}

fn decode_pit_row(
    row: &sqlx::postgres::PgRow,
    require_current_head: bool,
) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
    let value: Value = row
        .try_get("aggregate_json")
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let aggregate: PitSnapshotCommitAggregate =
        serde_json::from_value(value).map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let native = decode_native_index(row).map_err(|_| PitSnapshotError::PersistenceUnavailable)?;

    if !verify_pit_native(&aggregate, &native, require_current_head) {
        return Err(PitSnapshotError::PersistenceUnavailable);
    }
    Ok(aggregate)
}

async fn pit_head_for_update(
    transaction: &mut Transaction<'_, Postgres>,
    lineage_root: BindingDigest,
) -> Result<Option<NativeHead>, PitSnapshotError> {
    let row = sqlx::query(
        "SELECT lineage_root,snapshot_identity AS head_identity,fact_digest,lineage_version FROM market_data_private.pit_snapshot_heads_v1 WHERE lineage_root=$1 FOR UPDATE",
    )
    .bind(lineage_root.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    row.map(|row| decode_head(&row).map_err(|_| PitSnapshotError::PersistenceUnavailable))
        .transpose()
}

async fn validate_pit_lineage_head_custody(
    transaction: &mut Transaction<'_, Postgres>,
    lineage_root: BindingDigest,
) -> Result<(), PitSnapshotError> {
    validate_pit_lineage_shape(transaction, lineage_root).await?;
    let head = pit_head_for_update(transaction, lineage_root)
        .await?
        .ok_or(PitSnapshotError::PersistenceUnavailable)?;
    load_pit_for_update(transaction, head.identity, true)
        .await?
        .ok_or(PitSnapshotError::PersistenceUnavailable)?;
    Ok(())
}

async fn validate_pit_lineage_shape(
    transaction: &mut Transaction<'_, Postgres>,
    lineage_root: BindingDigest,
) -> Result<(), PitSnapshotError> {
    let valid: bool =
        sqlx::query_scalar("SELECT market_data_private.resolve_pit_lineage_custody_v1($1)")
            .bind(lineage_root.as_bytes().as_slice())
            .fetch_one(&mut **transaction)
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;

    if !valid {
        super::storage_diagnostic::refused_by_store(
            "pit_lineage.shape.custody",
            &"PIT lineage custody rejected its own stored shape",
        );
        return Err(PitSnapshotError::PersistenceUnavailable);
    }
    let identities: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT member_identity FROM market_data_private.resolve_pit_lineage_members_v1($1)",
    )
    .bind(lineage_root.as_bytes().as_slice())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let mut prior = None;
    let mut terminal_head = None;

    for (offset, identity) in identities.iter().enumerate() {
        let identity =
            digest_from_bytes(identity).map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let envelope = load_envelope(
            transaction,
            "SELECT * FROM market_data_private.resolve_pit_snapshot_v1($1)",
            identity,
        )
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?
        .ok_or(PitSnapshotError::PersistenceUnavailable)?;
        let aggregate: PitSnapshotCommitAggregate = serde_json::from_value(envelope.aggregate)
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let fact = aggregate.fact();
        let expected_version = u64::try_from(offset)
            .ok()
            .and_then(|value| value.checked_add(1))
            .ok_or(PitSnapshotError::PersistenceUnavailable)?;

        if !verify_pit_native(&aggregate, &envelope.native, false)
            || fact.lineage_root() != lineage_root
            || fact.lineage_version() != expected_version
        {
            return Err(PitSnapshotError::PersistenceUnavailable);
        }

        match prior {
            None if fact.snapshot_identity() == lineage_root
                && fact.predecessor_snapshot_identity().is_none()
                && fact.predecessor_fact_digest().is_none() => {}
            Some((prior_identity, prior_digest))
                if fact.predecessor_snapshot_identity() == Some(prior_identity)
                    && fact.predecessor_fact_digest() == Some(prior_digest) => {}
            _ => return Err(PitSnapshotError::PersistenceUnavailable),
        }
        terminal_head = Some((
            envelope.native.head.lineage_root,
            envelope.native.head.identity,
            envelope.native.head.fact_digest,
            envelope.native.head.lineage_version,
        ));
        prior = Some((fact.snapshot_identity(), fact.digest()));
    }
    let (terminal_identity, terminal_digest) =
        prior.ok_or(PitSnapshotError::PersistenceUnavailable)?;
    let terminal_version =
        u64::try_from(identities.len()).map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let (head_root, head_identity, head_digest, head_version) =
        terminal_head.ok_or(PitSnapshotError::PersistenceUnavailable)?;

    if head_root != lineage_root
        || head_identity != terminal_identity
        || head_digest != terminal_digest
        || head_version != terminal_version
    {
        return Err(PitSnapshotError::PersistenceUnavailable);
    }
    Ok(())
}

/// Assigns this snapshot the next dense frame ordinal within its scope.
///
/// The ordinal is commit order, not event order. Market Data persists no canonical time column on
/// a snapshot fact, so nothing can order frames across lineages after the fact; the k-th frame
/// committed for a scope is the only total order the Owner can assert. Strictly increasing
/// canonical event order is a separate admission rule, checked when a two-frame profile is
/// resolved, so a census that is dense but out of event order refuses rather than admits.
///
/// Density is what proves "no skipped eligible frame": the existing correction lineage orders
/// revisions of one request and cannot see a sibling lineage's frame in the same window.
/// One census row for a scope, as the Owner recorded it at commit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NativeReplayFrameCensusRowV2 {
    pub(crate) frame_ordinal: u64,
    pub(crate) snapshot_identity: BindingDigest,
    pub(crate) snapshot_fact_digest: BindingDigest,
    pub(crate) event_effective_ns: u64,
    pub(crate) decision_cut_ns: u64,
    pub(crate) correction_branch_digest: BindingDigest,
}

/// Reads one scope's frames whose event-effective coordinate falls inside the half-open window.
///
/// This answers only what the census itself knows: which frames a scope holds, in commit order,
/// with the coordinates a window question is asked in. Whether those frames form an admissible
/// two-frame profile is decided by `admit_two_frame_census_v2`, which additionally needs each
/// frame's resolved schedule and liquidity.
///
/// Rows outside the window are excluded here rather than filtered later, so an ordinal gap in the
/// returned rows is exactly what "a skipped eligible frame" means for this window.
async fn load_native_replay_frame_census_v2(
    transaction: &mut Transaction<'_, Postgres>,
    scope_digest: BindingDigest,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
) -> Result<Vec<NativeReplayFrameCensusRowV2>, PitSnapshotError> {
    let start =
        i64::try_from(window_start_ns).map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let end = i64::try_from(window_end_ns_exclusive)
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let rows = sqlx::query(
        "SELECT frame_ordinal,snapshot_identity,snapshot_fact_digest,event_effective_ns,decision_cut_ns,correction_branch_digest FROM market_data_private.native_replay_frame_census_v2 WHERE scope_digest=$1 AND event_effective_ns>=$2 AND event_effective_ns<$3 ORDER BY frame_ordinal",
    )
    .bind(scope_digest.as_bytes().as_slice())
    .bind(start)
    .bind(end)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;

    rows.into_iter()
        .map(|row| {
            Ok(NativeReplayFrameCensusRowV2 {
                frame_ordinal: u64::try_from(
                    row.try_get::<i64, _>("frame_ordinal")
                        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?,
                )
                .map_err(|_| PitSnapshotError::PersistenceUnavailable)?,
                snapshot_identity: census_digest(&row, "snapshot_identity")?,
                snapshot_fact_digest: census_digest(&row, "snapshot_fact_digest")?,
                event_effective_ns: u64::try_from(
                    row.try_get::<i64, _>("event_effective_ns")
                        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?,
                )
                .map_err(|_| PitSnapshotError::PersistenceUnavailable)?,
                decision_cut_ns: u64::try_from(
                    row.try_get::<i64, _>("decision_cut_ns")
                        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?,
                )
                .map_err(|_| PitSnapshotError::PersistenceUnavailable)?,
                correction_branch_digest: census_digest(&row, "correction_branch_digest")?,
            })
        })
        .collect()
}

fn decode_native_replay_frame_sequence_custody_v2(
    row: &sqlx::postgres::PgRow,
) -> Result<NativeReplayFrameSequenceCustodyReadbackV2, NativeReplayFrameSequenceCustodyRefusalV2> {
    let digest =
        |column: &str| -> Result<BindingDigest, NativeReplayFrameSequenceCustodyRefusalV2> {
            let bytes: Vec<u8> = row
                .try_get(column)
                .map_err(|_| NativeReplayFrameSequenceCustodyRefusalV2::CustodyUnavailable)?;
            let bytes: [u8; 32] = bytes
                .try_into()
                .map_err(|_| NativeReplayFrameSequenceCustodyRefusalV2::CustodyUnavailable)?;
            Ok(BindingDigest::from_untrusted_bytes(bytes))
        };
    let bytes = |column: &str| -> Result<Vec<u8>, NativeReplayFrameSequenceCustodyRefusalV2> {
        row.try_get(column)
            .map_err(|_| NativeReplayFrameSequenceCustodyRefusalV2::CustodyUnavailable)
    };
    Ok(NativeReplayFrameSequenceCustodyReadbackV2 {
        sequence_identity: digest("sequence_identity")?,
        sequence_bytes: bytes("sequence_bytes")?,
        receipt_identity: digest("receipt_identity")?,
        receipt_bytes: bytes("receipt_bytes")?,
        outbox_identity: digest("outbox_identity")?,
        outbox_payload: bytes("payload")?,
    })
}

fn census_digest(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<BindingDigest, PitSnapshotError> {
    let bytes: Vec<u8> = row
        .try_get(column)
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    Ok(BindingDigest::from_untrusted_bytes(bytes))
}

async fn admit_native_replay_frame_census(
    transaction: &mut Transaction<'_, Postgres>,
    fact: &PitSnapshotFact,
) -> Result<(), PitSnapshotError> {
    let time = &fact.request().time_evidence;
    let event_effective = i64::try_from(time.event_effective.value)
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let decision_cut = i64::try_from(time.decision_cut.value)
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    sqlx::query(
        "INSERT INTO market_data_private.native_replay_frame_census_v2(scope_digest,frame_ordinal,snapshot_identity,snapshot_fact_digest,event_effective_ns,decision_cut_ns,correction_branch_digest) SELECT $1, COALESCE(MAX(frame_ordinal),0)+1, $2, $3, $4, $5, $6 FROM market_data_private.native_replay_frame_census_v2 WHERE scope_digest=$1 ON CONFLICT (snapshot_identity) DO NOTHING",
    )
    .bind(fact.request().scope_digest.as_bytes().as_slice())
    .bind(fact.snapshot_identity().as_bytes().as_slice())
    .bind(fact.digest().as_bytes().as_slice())
    .bind(event_effective)
    .bind(decision_cut)
    .bind(fact.lineage_root().as_bytes().as_slice())
    .execute(&mut **transaction)
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    Ok(())
}

async fn admit_native_replay_quote_cut_census(
    transaction: &mut Transaction<'_, Postgres>,
    fact: &PitSnapshotFact,
) -> Result<(), PitSnapshotError> {
    let time = &fact.request().time_evidence;
    let event_effective = i64::try_from(time.event_effective.value)
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let decision_cut = i64::try_from(time.decision_cut.value)
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    sqlx::query(
        "INSERT INTO market_data_private.native_replay_quote_cut_census_v2(snapshot_identity,scope_digest,snapshot_fact_digest,event_effective_ns,decision_cut_ns,instrument_master_digest,universe_selection_digest,market_semantics_identity,source_binding_lineage_root,correction_lineage_root,correction_lineage_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (snapshot_identity) DO NOTHING",
    )
    .bind(fact.snapshot_identity().as_bytes().as_slice())
    .bind(fact.request().scope_digest.as_bytes().as_slice())
    .bind(fact.digest().as_bytes().as_slice())
    .bind(event_effective)
    .bind(decision_cut)
    .bind(fact.request().instrument_master_digest.as_bytes().as_slice())
    .bind(fact.request().universe_selection_digest.as_bytes().as_slice())
    .bind(fact.request().market_semantics_identity.as_bytes().as_slice())
    .bind(fact.source_binding_lineage_root().as_bytes().as_slice())
    .bind(fact.lineage_root().as_bytes().as_slice())
    .bind(
        i64::try_from(fact.lineage_version())
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?,
    )
    .execute(&mut **transaction)
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    Ok(())
}

/// Reads every version of each quote cut correction lineage that has any version in `scope_digest`
/// and `(after_ns, before_ns_exclusive)`.
///
/// Whole lineages, not the rows in the interval: a correction may move a quote cut's event time,
/// and `select_native_replay_quote_cut_v2` must see a lineage's latest correction to know whether
/// the lineage still serves the frame. Loading only the interval would hide a correction that
/// moved out of it and leave its superseded original looking current. The interval only chooses
/// which lineages to read; the rules are applied in the pure function, which is what the tests pin.
async fn load_native_replay_quote_cut_census_v2(
    transaction: &mut Transaction<'_, Postgres>,
    scope_digest: BindingDigest,
    after_ns: u64,
    before_ns_exclusive: u64,
) -> Result<Vec<NativeReplayQuoteCutCandidateV2>, PitSnapshotError> {
    let after = i64::try_from(after_ns).map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let before =
        i64::try_from(before_ns_exclusive).map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let rows = sqlx::query(
        "SELECT * FROM market_data_private.resolve_native_replay_quote_cut_census_v2($1,$2,$3)",
    )
    .bind(scope_digest.as_bytes().as_slice())
    .bind(after)
    .bind(before)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    rows.iter()
        .map(|row| {
            let nanos = |column: &str| -> Result<u64, PitSnapshotError> {
                let value: i64 = row
                    .try_get(column)
                    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
                u64::try_from(value).map_err(|_| PitSnapshotError::PersistenceUnavailable)
            };
            Ok(NativeReplayQuoteCutCandidateV2 {
                snapshot_identity: census_digest(row, "snapshot_identity")?,
                snapshot_fact_digest: census_digest(row, "snapshot_fact_digest")?,
                scope_digest: census_digest(row, "scope_digest")?,
                instrument_master_digest: census_digest(row, "instrument_master_digest")?,
                universe_selection_digest: census_digest(row, "universe_selection_digest")?,
                market_semantics_identity: census_digest(row, "market_semantics_identity")?,
                source_binding_lineage_root: census_digest(row, "source_binding_lineage_root")?,
                event_effective_ns: nanos("event_effective_ns")?,
                decision_cut_ns: nanos("decision_cut_ns")?,
                correction_lineage_root: census_digest(row, "correction_lineage_root")?,
                correction_lineage_version: nanos("correction_lineage_version")?,
            })
        })
        .collect()
}

/// Reads the event time of the first frame after `after_ns` in `scope_digest` that the Owner had
/// observed by `decision_cut_ns`, if there is one.
async fn load_next_native_replay_frame_v2(
    transaction: &mut Transaction<'_, Postgres>,
    scope_digest: BindingDigest,
    after_ns: u64,
    decision_cut_ns: u64,
) -> Result<Option<u64>, PitSnapshotError> {
    let after = i64::try_from(after_ns).map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let decision_cut =
        i64::try_from(decision_cut_ns).map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let next: Option<i64> = sqlx::query_scalar(
        "SELECT event_effective_ns FROM market_data_private.resolve_native_replay_next_frame_v2($1,$2,$3)",
    )
    .bind(scope_digest.as_bytes().as_slice())
    .bind(after)
    .bind(decision_cut)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    next.map(|value| u64::try_from(value).map_err(|_| PitSnapshotError::PersistenceUnavailable))
        .transpose()
}

/// Resolves the one quote cut `frame` takes its liquidity from, inside the caller's transaction.
///
/// `docs/owners/market-data.md` takes a frame's liquidity from its quote cut: an Owner-verified
/// snapshot strictly after the frame's BAR cut and strictly before the next frame's. The caller
/// names neither. The bound is the first later frame in the frame's scope census, or the window's
/// end when none precedes it, and the decision cut is the frame's own: the sealed request names
/// the frame's PIT snapshot, whose decision cut is the only one it fixes, so a later reading
/// resolves the same quote cut. Frames the Owner observed after that cut do not bound the
/// interval, and a later frame can only narrow it - which leaves a quote cut missing, never
/// admits one that is not the frame's. The census is then searched on the frame's coordinates,
/// exactly one correction lineage must lie in the interval as the Owner saw it at the decision
/// cut, and its batch is read back and verified before it is compared with the frame's.
///
/// # Errors
///
/// Returns the exact [`NativeReplayQuoteCutRefusalV2`] for the first violated rule.
async fn resolve_native_replay_quote_cut_in_transaction_v2(
    transaction: &mut Transaction<'_, Postgres>,
    frame: &VerifiedPitObservationBatch,
    window_end_ns_exclusive: u64,
) -> Result<VerifiedPitObservationBatch, NativeReplayQuoteCutRefusalV2> {
    let frame_coordinates = NativeReplayCutCoordinatesV2::of(frame);
    let decision_cut_ns = frame.time_evidence().decision_cut.value;
    let next_frame_ns = load_next_native_replay_frame_v2(
        transaction,
        frame_coordinates.scope_digest,
        frame_coordinates.event_effective_ns,
        decision_cut_ns,
    )
    .await
    .map_err(|_| NativeReplayQuoteCutRefusalV2::CustodyUnavailable)?;
    let bound_ns_exclusive =
        native_replay_quote_cut_bound_v2(next_frame_ns, window_end_ns_exclusive);
    let candidates = load_native_replay_quote_cut_census_v2(
        transaction,
        frame_coordinates.scope_digest,
        frame_coordinates.event_effective_ns,
        bound_ns_exclusive,
    )
    .await
    .map_err(|_| NativeReplayQuoteCutRefusalV2::CustodyUnavailable)?;
    let chosen = select_native_replay_quote_cut_v2(
        &candidates,
        &frame_coordinates,
        bound_ns_exclusive,
        decision_cut_ns,
    )?;
    let quote_cut = load_verified_observation_batch(
        transaction,
        chosen.snapshot_identity,
        chosen.snapshot_fact_digest,
    )
    .await
    .map_err(|_| NativeReplayQuoteCutRefusalV2::CustodyUnavailable)?;
    verify_native_replay_quote_cut_v2(
        &frame_coordinates,
        &NativeReplayCutCoordinatesV2::of(&quote_cut),
    )?;
    Ok(quote_cut)
}

async fn admit_pit_lineage_census(
    transaction: &mut Transaction<'_, Postgres>,
    lineage_root: BindingDigest,
) -> Result<(), PitSnapshotError> {
    let inserted: Option<i64> = sqlx::query_scalar(
        "INSERT INTO market_data_private.pit_snapshot_lineage_census_v1(lineage_root) VALUES ($1) ON CONFLICT (lineage_root) DO NOTHING RETURNING 1::BIGINT",
    )
    .bind(lineage_root.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;

    if inserted.is_some() {
        let result = sqlx::query(
            "UPDATE market_data_private.owner_history_census_state_v1 SET pit_lineage_count=pit_lineage_count+1 WHERE singleton",
        )
        .execute(&mut **transaction)
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;

        if result.rows_affected() != 1 {
            return Err(PitSnapshotError::PersistenceUnavailable);
        }
    }
    Ok(())
}

async fn insert_pit(
    transaction: &mut Transaction<'_, Postgres>,
    aggregate: &PitSnapshotCommitAggregate,
    fault: PostgresCommitFault,
) -> Result<(), PitSnapshotError> {
    let fact = aggregate.fact();
    admit_pit_lineage_census(transaction, fact.lineage_root()).await?;
    let correction = &fact.evidence().correction_frontier;
    let json =
        serde_json::to_value(aggregate).map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    sqlx::query(
        "INSERT INTO market_data_private.pit_snapshot_facts_v1(snapshot_identity,fact_digest,request_identity,request_digest,correction_stream_identity,correction_sequence,lineage_root,lineage_version,aggregate_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(fact.snapshot_identity().as_bytes().as_slice())
    .bind(fact.digest().as_bytes().as_slice())
    .bind(fact.request_identity().as_bytes().as_slice())
    .bind(fact.request_digest().as_bytes().as_slice())
    .bind(&correction.stream_identity)
    .bind(i64::try_from(correction.sequence).map_err(|_| PitSnapshotError::PersistenceUnavailable)?)
    .bind(fact.lineage_root().as_bytes().as_slice())
    .bind(i64::try_from(fact.lineage_version()).map_err(|_| PitSnapshotError::PersistenceUnavailable)?)
    .bind(json)
    .execute(&mut **transaction)
    .await
    .map_err(|e| map_pit_insert_error(&e))?;

    if fault == PostgresCommitFault::AfterFactBeforeOutbox {
        return Err(PitSnapshotError::CommitInterrupted);
    }
    sqlx::query(
        "INSERT INTO market_data_private.pit_snapshot_outbox_v1(event_identity,aggregate_identity,payload_digest,payload) VALUES ($1,$2,$3,$4)",
    )
    .bind(aggregate.outbox().digest().as_bytes().as_slice())
    .bind(fact.snapshot_identity().as_bytes().as_slice())
    .bind(aggregate.outbox().digest().as_bytes().as_slice())
    .bind(aggregate.outbox().payload())
    .execute(&mut **transaction)
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    sqlx::query(
        "INSERT INTO market_data_private.pit_snapshot_heads_v1(lineage_root,snapshot_identity,fact_digest,lineage_version) VALUES ($1,$2,$3,$4) ON CONFLICT (lineage_root) DO UPDATE SET snapshot_identity=EXCLUDED.snapshot_identity,fact_digest=EXCLUDED.fact_digest,lineage_version=EXCLUDED.lineage_version",
    )
    .bind(fact.lineage_root().as_bytes().as_slice())
    .bind(fact.snapshot_identity().as_bytes().as_slice())
    .bind(fact.digest().as_bytes().as_slice())
    .bind(i64::try_from(fact.lineage_version()).map_err(|_| PitSnapshotError::PersistenceUnavailable)?)
    .execute(&mut **transaction)
    .await
    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    Ok(())
}

struct StoredPitObservationBatch {
    source_binding_identity: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    source_binding_lineage_version: u64,
    digest: BindingDigest,
    bytes: Vec<u8>,
    rows: Vec<ObservedPitObservationNativeRow>,
}

async fn load_pit_observation_batch_for_update(
    transaction: &mut Transaction<'_, Postgres>,
    aggregate: &PitSnapshotCommitAggregate,
) -> Result<Option<StoredPitObservationBatch>, PitSnapshotError> {
    load_pit_observation_batch(transaction, aggregate, true).await
}

async fn load_pit_observation_batch(
    transaction: &mut Transaction<'_, Postgres>,
    aggregate: &PitSnapshotCommitAggregate,
    lock: bool,
) -> Result<Option<StoredPitObservationBatch>, PitSnapshotError> {
    load_pit_observation_batch_with_mode(transaction, aggregate, lock, false).await
}

async fn load_pit_observation_batch_for_rd_strategy_input(
    transaction: &mut Transaction<'_, Postgres>,
    aggregate: &PitSnapshotCommitAggregate,
) -> Result<Option<StoredPitObservationBatch>, PitSnapshotError> {
    load_pit_observation_batch_with_mode(transaction, aggregate, true, true).await
}

async fn load_pit_observation_batch_with_mode(
    transaction: &mut Transaction<'_, Postgres>,
    aggregate: &PitSnapshotCommitAggregate,
    lock: bool,
    rd_owner: bool,
) -> Result<Option<StoredPitObservationBatch>, PitSnapshotError> {
    let fact = aggregate.fact();
    let header_query = if rd_owner {
        "SELECT * FROM market_data_rd_api.lock_pit_observation_batch_for_strategy_input_v1($1)"
    } else if lock {
        "SELECT source_binding_identity,source_binding_lineage_root,source_binding_lineage_version,batch_digest,batch_bytes,row_count FROM market_data_private.pit_observation_batches_v1 WHERE snapshot_identity=$1 FOR UPDATE"
    } else {
        "SELECT source_binding_identity,source_binding_lineage_root,source_binding_lineage_version,batch_digest,batch_bytes,row_count FROM market_data_private.pit_observation_batches_v1 WHERE snapshot_identity=$1"
    };
    let Some(header) = sqlx::query(header_query)
        .bind(fact.snapshot_identity().as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?
    else {
        return Ok(None);
    };
    let source_binding_identity = row_digest(&header, "source_binding_identity")
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let source_binding_lineage_root = row_digest(&header, "source_binding_lineage_root")
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let source_binding_lineage_version: i64 = header
        .try_get("source_binding_lineage_version")
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let row_count: i64 = header
        .try_get("row_count")
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;

    if source_binding_identity != fact.source_binding_identity()
        || source_binding_lineage_root != fact.source_binding_lineage_root()
        || u64::try_from(source_binding_lineage_version).ok()
            != Some(fact.source_binding_lineage_version())
        || row_count <= 0
        || row_count > 10_000
    {
        return Err(PitSnapshotError::PersistenceUnavailable);
    }
    let digest = row_digest(&header, "batch_digest")
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let bytes: Vec<u8> = header
        .try_get("batch_bytes")
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let rows_query = if rd_owner {
        "SELECT * FROM market_data_rd_api.lock_pit_observation_rows_for_strategy_input_v1($1)"
    } else if lock {
        "SELECT ordinal,symbolic_key,member_key,row_bytes FROM market_data_private.pit_observation_rows_v1 WHERE snapshot_identity=$1 ORDER BY ordinal FOR UPDATE"
    } else {
        "SELECT ordinal,symbolic_key,member_key,row_bytes FROM market_data_private.pit_observation_rows_v1 WHERE snapshot_identity=$1 ORDER BY ordinal"
    };
    let native_rows = sqlx::query(rows_query)
        .bind(fact.snapshot_identity().as_bytes().as_slice())
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let rows = native_rows
        .into_iter()
        .map(|row| {
            Ok(ObservedPitObservationNativeRow {
                ordinal: u64::try_from(
                    row.try_get::<i64, _>("ordinal")
                        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?,
                )
                .map_err(|_| PitSnapshotError::PersistenceUnavailable)?,
                symbolic_key: row
                    .try_get("symbolic_key")
                    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?,
                member_key: row
                    .try_get("member_key")
                    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?,
                row_bytes: row
                    .try_get("row_bytes")
                    .map_err(|_| PitSnapshotError::PersistenceUnavailable)?,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    if i64::try_from(rows.len()).ok() != Some(row_count) {
        return Err(PitSnapshotError::PersistenceUnavailable);
    }
    Ok(Some(StoredPitObservationBatch {
        source_binding_identity,
        source_binding_lineage_root,
        source_binding_lineage_version: u64::try_from(source_binding_lineage_version)
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?,
        digest,
        bytes,
        rows,
    }))
}

async fn insert_pit_observation_batch(
    transaction: &mut Transaction<'_, Postgres>,
    aggregate: &PitSnapshotCommitAggregate,
    batch: &PreparedPitObservationBatch,
    fault: PostgresCommitFault,
) -> Result<(), PitSnapshotError> {
    let fact = aggregate.fact();
    let row_count =
        i64::try_from(batch.rows().len()).map_err(|_| PitSnapshotError::InvalidObservationBatch)?;
    sqlx::query(
        "INSERT INTO market_data_private.pit_observation_batches_v1(snapshot_identity,source_binding_identity,source_binding_lineage_root,source_binding_lineage_version,batch_digest,batch_bytes,row_count) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(fact.snapshot_identity().as_bytes().as_slice())
    .bind(fact.source_binding_identity().as_bytes().as_slice())
    .bind(fact.source_binding_lineage_root().as_bytes().as_slice())
    .bind(
        i64::try_from(fact.source_binding_lineage_version())
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?,
    )
    .bind(batch.digest().as_bytes().as_slice())
    .bind(batch.bytes())
    .bind(row_count)
    .execute(&mut **transaction)
    .await
    .map_err(|e| map_pit_insert_error(&e))?;
    if fault == PostgresCommitFault::AfterPitBatchBeforeRows {
        return Err(PitSnapshotError::CommitInterrupted);
    }

    for (offset, (row, row_bytes)) in batch.rows().iter().zip(batch.row_bytes()).enumerate() {
        let ordinal = i64::try_from(offset)
            .ok()
            .and_then(|value| value.checked_add(1))
            .ok_or(PitSnapshotError::InvalidObservationBatch)?;
        sqlx::query(
            "INSERT INTO market_data_private.pit_observation_rows_v1(snapshot_identity,ordinal,symbolic_key,member_key,row_bytes) VALUES ($1,$2,$3,$4,$5)",
        )
        .bind(fact.snapshot_identity().as_bytes().as_slice())
        .bind(ordinal)
        .bind(row.symbolic_key())
        .bind(row.member_key())
        .bind(row_bytes)
        .execute(&mut **transaction)
        .await
        .map_err(|e| map_pit_insert_error(&e))?;
    }
    index_pit_role_coordinates(transaction, aggregate, batch).await?;
    Ok(())
}

/// Records the coordinates at which this snapshot answers, so that a Design's authenticated input
/// role can later be resolved to it.
///
/// The coordinates written here are exactly the ones `resolve_strategy_input_row` selects a row by,
/// which is what makes the index answer the same question the binder does. A correction re-answers
/// its own lineage at the same cut, so it overwrites that lineage's row and never competes with
/// itself; two rows of one batch sharing a coordinate write the same values, and the binder still
/// rejects that batch as ambiguous when a role reaches it.
async fn index_pit_role_coordinates(
    transaction: &mut Transaction<'_, Postgres>,
    aggregate: &PitSnapshotCommitAggregate,
    batch: &PreparedPitObservationBatch,
) -> Result<(), PitSnapshotError> {
    let fact = aggregate.fact();
    let decision_cut = i64::try_from(fact.request().time_evidence.decision_cut.value)
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let lineage_version = i64::try_from(fact.lineage_version())
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;

    if decision_cut <= 0 {
        return Err(PitSnapshotError::InvalidObservationBatch);
    }

    for row in batch.rows() {
        sqlx::query(
            "INSERT INTO market_data_private.pit_role_coordinate_index_v1(instrument,channel,data_kind,field,timeframe,value_scale,decision_cut,lineage_root,lineage_version,snapshot_identity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (instrument,channel,data_kind,field,timeframe,value_scale,decision_cut,lineage_root) DO UPDATE SET lineage_version=EXCLUDED.lineage_version,snapshot_identity=EXCLUDED.snapshot_identity WHERE market_data_private.pit_role_coordinate_index_v1.lineage_version<=EXCLUDED.lineage_version",
        )
        .bind(row.instrument())
        .bind(row.channel())
        .bind(row.data_kind())
        .bind(row.field())
        .bind(row.timeframe())
        .bind(i16::from(row.value_scale()))
        .bind(decision_cut)
        .bind(fact.lineage_root().as_bytes().as_slice())
        .bind(lineage_version)
        .bind(fact.snapshot_identity().as_bytes().as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(|e| map_pit_insert_error(&e))?;
    }
    Ok(())
}

fn map_pit_insert_error(error: &sqlx::Error) -> PitSnapshotError {
    if error
        .as_database_error()
        .is_some_and(sqlx::error::DatabaseError::is_unique_violation)
    {
        PitSnapshotError::ReplayConflict
    } else {
        PitSnapshotError::PersistenceUnavailable
    }
}

async fn insert_clock(
    transaction: &mut Transaction<'_, Postgres>,
    clock: &MarketDataClockAdmission,
) -> Result<(), SourceBindingError> {
    sqlx::query(
        "INSERT INTO market_data_private.clock_head_v1(singleton,clock_identity,clock_epoch,monotonic_sequence,wall_observed,decision_cut,valid_through,restart_continuity_digest,uncertainty_bound,skew_bound,comparison_rule,shared_time_materialized) VALUES (TRUE,$1,$2,$3,$4,$5,$6,$7,$8,$9,1,TRUE)",
    )
    .bind(&clock.clock_identity)
    .bind(&clock.clock_epoch)
    .bind(to_i64(clock.monotonic_sequence)?)
    .bind(to_i64(clock.wall_observed)?)
    .bind(to_i64(clock.decision_cut)?)
    .bind(to_i64(clock.valid_through)?)
    .bind(clock.restart_continuity_digest.as_bytes().as_slice())
    .bind(to_i64(clock.uncertainty_bound)?)
    .bind(to_i64(clock.skew_bound)?)
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

async fn update_clock(
    transaction: &mut Transaction<'_, Postgres>,
    clock: &MarketDataClockAdmission,
) -> Result<(), SourceBindingError> {
    sqlx::query(
        "UPDATE market_data_private.clock_head_v1 SET clock_identity=$1,clock_epoch=$2,monotonic_sequence=$3,wall_observed=$4,decision_cut=$5,valid_through=$6,restart_continuity_digest=$7,uncertainty_bound=$8,skew_bound=$9,comparison_rule=1 WHERE singleton",
    )
    .bind(&clock.clock_identity)
    .bind(&clock.clock_epoch)
    .bind(to_i64(clock.monotonic_sequence)?)
    .bind(to_i64(clock.wall_observed)?)
    .bind(to_i64(clock.decision_cut)?)
    .bind(to_i64(clock.valid_through)?)
    .bind(clock.restart_continuity_digest.as_bytes().as_slice())
    .bind(to_i64(clock.uncertainty_bound)?)
    .bind(to_i64(clock.skew_bound)?)
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

const CLOCK_STATE_LOCK_KEY: i64 = 0x5649_4245_5449_4d45;

async fn lock_clock_state(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), SourceBindingError> {
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(CLOCK_STATE_LOCK_KEY)
        .execute(&mut **transaction)
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

async fn validate_materialized_clock_custody(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), SourceBindingError> {
    lock_clock_state(transaction).await?;
    validate_owner_history_custody(transaction).await?;
    let current = load_current_clock_for_update(transaction)
        .await?
        .ok_or(SourceBindingError::StoreUnavailable)?;
    ensure_clock_handoff_state(transaction, &current).await?;
    Ok(())
}

#[derive(Clone, Copy)]
struct DurableClockHandoffState {
    materialized: bool,
    handoff_count: i64,
    epoch_transition_count: i64,
}

async fn load_current_clock_for_update(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<Option<MarketDataClockAdmission>, SourceBindingError> {
    sqlx::query(
        "SELECT clock_identity,clock_epoch,monotonic_sequence,wall_observed,decision_cut,valid_through,restart_continuity_digest,uncertainty_bound,skew_bound,comparison_rule FROM market_data_private.clock_head_v1 WHERE singleton FOR UPDATE",
    )
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?
    .map(|row| decode_clock(&row).map_err(|_| SourceBindingError::StoreUnavailable))
    .transpose()
}

async fn load_clock_materialization_witness_for_update(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<Option<bool>, SourceBindingError> {
    sqlx::query_scalar(
        "SELECT shared_time_materialized FROM market_data_private.clock_head_v1 WHERE singleton FOR UPDATE",
    )
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)
}

async fn load_clock_handoff_state_for_update(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<DurableClockHandoffState, SourceBindingError> {
    let row = sqlx::query(
        "SELECT materialized,handoff_count,epoch_transition_count FROM market_data_private.clock_handoff_state_v1 WHERE singleton FOR UPDATE",
    )
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?
    .ok_or(SourceBindingError::StoreUnavailable)?;
    Ok(DurableClockHandoffState {
        materialized: row
            .try_get("materialized")
            .map_err(|_| SourceBindingError::StoreUnavailable)?,
        handoff_count: row
            .try_get("handoff_count")
            .map_err(|_| SourceBindingError::StoreUnavailable)?,
        epoch_transition_count: row
            .try_get("epoch_transition_count")
            .map_err(|_| SourceBindingError::StoreUnavailable)?,
    })
}

async fn clock_handoff_storage_counts(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(i64, i64, i64), SourceBindingError> {
    sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM market_data_private.clock_handoffs_v1), (SELECT COUNT(*) FROM market_data_private.clock_handoff_head_v1), (SELECT COUNT(*) FROM market_data_private.epoch_successor_proofs_v1)",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)
}

async fn insert_clock_handoff_state(
    transaction: &mut Transaction<'_, Postgres>,
    state: DurableClockHandoffState,
) -> Result<(), SourceBindingError> {
    sqlx::query(
        "INSERT INTO market_data_private.clock_handoff_state_v1(singleton,materialized,handoff_count,epoch_transition_count) VALUES (TRUE,$1,$2,$3)",
    )
    .bind(state.materialized)
    .bind(state.handoff_count)
    .bind(state.epoch_transition_count)
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

async fn materialize_initial_clock_handoff_state(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), SourceBindingError> {
    let result = sqlx::query(
        "UPDATE market_data_private.clock_handoff_state_v1 SET materialized=TRUE,handoff_count=1 WHERE singleton AND NOT materialized AND handoff_count=0 AND epoch_transition_count=0",
    )
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;

    if result.rows_affected() == 1 {
        Ok(())
    } else {
        Err(SourceBindingError::StoreUnavailable)
    }
}

async fn advance_clock_handoff_state(
    transaction: &mut Transaction<'_, Postgres>,
    epoch_changed: bool,
) -> Result<(), SourceBindingError> {
    let result = sqlx::query(
        "UPDATE market_data_private.clock_handoff_state_v1 SET handoff_count=handoff_count+1,epoch_transition_count=epoch_transition_count+$1 WHERE singleton AND materialized",
    )
    .bind(i64::from(epoch_changed))
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;

    if result.rows_affected() == 1 {
        Ok(())
    } else {
        Err(SourceBindingError::StoreUnavailable)
    }
}

async fn install_clock_handoff_state(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), SourceBindingError> {
    lock_clock_state(transaction).await?;
    let state_rows: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM market_data_private.clock_handoff_state_v1")
            .fetch_one(&mut **transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
    if state_rows != 0 {
        return Err(SourceBindingError::StoreUnavailable);
    }
    let current = load_current_clock_for_update(transaction).await?;
    let materialization_witness =
        load_clock_materialization_witness_for_update(transaction).await?;
    let counts = clock_handoff_storage_counts(transaction).await?;
    match (current, materialization_witness, counts) {
        (None, None, (0, 0, 0)) if owner_fact_history_is_empty(transaction).await? => {
            insert_clock_handoff_state(
                transaction,
                DurableClockHandoffState {
                    materialized: false,
                    handoff_count: 0,
                    epoch_transition_count: 0,
                },
            )
            .await
        }
        (Some(clock), Some(false), (0, 0, 0)) => {
            let clocks = legacy_owner_history_clocks(transaction, &clock)
                .await?
                .ok_or(SourceBindingError::StoreUnavailable)?;
            let mut prior = None;

            for observed in &clocks {
                let fact = build_head_fact(
                    observed,
                    prior
                        .as_ref()
                        .map(|value: &ClockHeadFact| value.handoff.head_digest()),
                )
                .map_err(|_| SourceBindingError::TrustedClockMismatch)?;
                insert_clock_handoff(transaction, &fact).await?;
                insert_clock_membership(
                    transaction,
                    &fact,
                    prior.as_ref().map(|value| value.handoff.head_identity()),
                )
                .await?;
                prior = Some(fact);
            }
            let head = prior.ok_or(SourceBindingError::StoreUnavailable)?;
            set_clock_handoff_head(transaction, head.handoff.head_identity()).await?;
            sqlx::query(
                "UPDATE market_data_private.clock_head_v1 SET shared_time_materialized=TRUE WHERE singleton AND NOT shared_time_materialized",
            )
            .execute(&mut **transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
            insert_clock_handoff_state(
                transaction,
                DurableClockHandoffState {
                    materialized: true,
                    handoff_count: i64::try_from(clocks.len())
                        .map_err(|_| SourceBindingError::StoreUnavailable)?,
                    epoch_transition_count: 0,
                },
            )
            .await
        }
        _ => Err(SourceBindingError::StoreUnavailable),
    }
}

async fn validate_clock_handoff_installation(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), SourceBindingError> {
    lock_clock_state(transaction).await?;
    let state = load_clock_handoff_state_for_update(transaction).await?;
    let current = load_current_clock_for_update(transaction).await?;
    let materialization_witness =
        load_clock_materialization_witness_for_update(transaction).await?;
    let counts = clock_handoff_storage_counts(transaction).await?;
    match (state.materialized, current, materialization_witness, counts) {
        (false, None, None, (0, 0, 0))
            if state.handoff_count == 0 && state.epoch_transition_count == 0 =>
        {
            Ok(())
        }
        (true, Some(clock), Some(true), _) => {
            ensure_clock_handoff_state(transaction, &clock).await?;
            Ok(())
        }
        _ => Err(SourceBindingError::StoreUnavailable),
    }
}

async fn ensure_clock_handoff_state(
    transaction: &mut Transaction<'_, Postgres>,
    current: &MarketDataClockAdmission,
) -> Result<ClockHeadFact, SourceBindingError> {
    let state = load_clock_handoff_state_for_update(transaction).await?;
    let materialization_witness =
        load_clock_materialization_witness_for_update(transaction).await?;
    let (handoff_count, head_count, epoch_transition_count) =
        clock_handoff_storage_counts(transaction).await?;

    if !shared_time_migration_is_installed(transaction).await?
        || !state.materialized
        || materialization_witness != Some(true)
        || state.handoff_count != handoff_count
        || state.epoch_transition_count != epoch_transition_count
        || head_count != 1
    {
        return Err(SourceBindingError::StoreUnavailable);
    }

    if sqlx::query("SELECT * FROM market_data_private.resolve_clock_custody_state_v1()")
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?
        .is_none()
    {
        return Err(SourceBindingError::StoreUnavailable);
    }
    Box::pin(validate_clock_membership_custody(transaction))
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?;

    if let Some(fact) = load_current_clock_fact_for_update(transaction)
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?
    {
        if fact.clock() == *current && verify_head_fact(&fact) {
            return Ok(fact);
        }
        return Err(SourceBindingError::StoreUnavailable);
    }
    Err(SourceBindingError::StoreUnavailable)
}

async fn insert_clock_handoff(
    transaction: &mut Transaction<'_, Postgres>,
    fact: &ClockHeadFact,
) -> Result<(), SourceBindingError> {
    sqlx::query(
        "INSERT INTO market_data_private.clock_handoffs_v1(head_identity,head_digest,predecessor_head_digest,clock_identity,clock_epoch,monotonic_sequence,wall_observed,decision_cut,valid_through,restart_continuity_digest,uncertainty_bound,skew_bound,comparison_rule) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1)",
    )
    .bind(fact.handoff.head_identity().as_bytes().as_slice())
    .bind(fact.handoff.head_digest().as_bytes().as_slice())
    .bind(fact.predecessor_head_digest.map(|value| value.as_bytes().to_vec()))
    .bind(fact.handoff.clock_identity())
    .bind(fact.handoff.clock_epoch())
    .bind(to_i64(fact.handoff.monotonic_sequence())?)
    .bind(to_i64(fact.handoff.wall_observed())?)
    .bind(to_i64(fact.handoff.decision_cut())?)
    .bind(to_i64(fact.handoff.valid_through())?)
    .bind(fact.handoff.restart_continuity_digest().as_bytes().as_slice())
    .bind(to_i64(fact.handoff.uncertainty_bound())?)
    .bind(to_i64(fact.handoff.skew_bound())?)
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

async fn insert_clock_membership(
    transaction: &mut Transaction<'_, Postgres>,
    fact: &ClockHeadFact,
    prior_identity: Option<BindingDigest>,
) -> Result<(), SourceBindingError> {
    let (root_identity, ordinal) = if let Some(prior_identity) = prior_identity {
        let row = sqlx::query(
            "SELECT root_head_identity,ordinal FROM market_data_private.clock_handoff_membership_v1 WHERE head_identity=$1 FOR UPDATE",
        )
        .bind(prior_identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?
        .ok_or(SourceBindingError::StoreUnavailable)?;
        let root_identity: Vec<u8> = row
            .try_get("root_head_identity")
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        let ordinal: i64 = row
            .try_get("ordinal")
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        (
            digest_from_bytes(&root_identity).map_err(|_| SourceBindingError::StoreUnavailable)?,
            ordinal
                .checked_add(1)
                .ok_or(SourceBindingError::StoreUnavailable)?,
        )
    } else {
        if fact.predecessor_head_digest.is_some() {
            return Err(SourceBindingError::StoreUnavailable);
        }
        (fact.handoff.head_identity(), 1)
    };

    sqlx::query(
        "INSERT INTO market_data_private.clock_handoff_membership_v1(head_identity,root_head_identity,ordinal) VALUES ($1,$2,$3)",
    )
    .bind(fact.handoff.head_identity().as_bytes().as_slice())
    .bind(root_identity.as_bytes().as_slice())
    .bind(ordinal)
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

async fn set_clock_handoff_head(
    transaction: &mut Transaction<'_, Postgres>,
    identity: BindingDigest,
) -> Result<(), SourceBindingError> {
    sqlx::query(
        "INSERT INTO market_data_private.clock_handoff_head_v1(singleton,head_identity) VALUES (TRUE,$1) ON CONFLICT (singleton) DO UPDATE SET head_identity=EXCLUDED.head_identity",
    )
    .bind(identity.as_bytes().as_slice())
    .execute(&mut **transaction)
    .await
    .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(())
}

async fn persist_clock_successor(
    mut transaction: Transaction<'_, Postgres>,
    prior: &ClockHeadHandoff,
    next: &MarketDataClockAdmission,
    fault: PostgresCommitFault,
) -> Result<ClockHeadSuccessorReadback, SharedTimeEvidenceError> {
    lock_clock_state(&mut transaction)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    validate_owner_history_custody(&mut transaction)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let current_clock = load_current_clock_for_update(&mut transaction)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?
        .ok_or(SharedTimeEvidenceError::StoreUnavailable)?;
    let current = ensure_clock_handoff_state(&mut transaction, &current_clock)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let next_fact = build_head_fact(next, Some(prior.head_digest()))?;

    if let Some(stored) =
        load_clock_fact_by_identity(&mut transaction, next_fact.handoff.head_identity(), false)
            .await?
    {
        if stored != next_fact || stored.predecessor_head_digest != Some(prior.head_digest()) {
            return Err(SharedTimeEvidenceError::ReplayConflict);
        }
        let proof = load_epoch_proof(&mut transaction, stored.handoff.head_digest()).await?;
        let stored_prior =
            load_clock_fact_by_identity(&mut transaction, prior.head_identity(), false)
                .await?
                .ok_or(SharedTimeEvidenceError::PriorHandoffMismatch)?;
        if &stored_prior.handoff != prior {
            return Err(SharedTimeEvidenceError::PriorHandoffMismatch);
        }
        let expected_proof = if prior.clock_epoch() == stored.handoff.clock_epoch() {
            None
        } else {
            Some(build_epoch_successor_proof(&stored_prior, &stored))
        };

        if proof != expected_proof {
            return Err(SharedTimeEvidenceError::EpochSuccessorProofMismatch);
        }
        transaction
            .commit()
            .await
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        return Ok(successor_readback(prior, stored.handoff, proof));
    }

    if &current.handoff != prior {
        return Err(SharedTimeEvidenceError::PriorHandoffMismatch);
    }
    let epoch_changed = next.clock_epoch != current_clock.clock_epoch;
    if epoch_changed {
        validate_new_epoch_successor(&current, next)?;
        if clock_epoch_seen(&mut transaction, next).await? {
            return Err(SharedTimeEvidenceError::EpochSuccessorProofMismatch);
        }
    } else {
        validate_same_epoch_successor(&current, next)?;
    }

    insert_clock_handoff(&mut transaction, &next_fact)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    insert_clock_membership(
        &mut transaction,
        &next_fact,
        Some(current.handoff.head_identity()),
    )
    .await
    .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let proof = if epoch_changed {
        let proof = build_epoch_successor_proof(&current, &next_fact);

        if fault == PostgresCommitFault::AfterClockHeadBeforeEpochProof {
            return Err(SharedTimeEvidenceError::CommitInterrupted);
        }
        insert_epoch_proof(&mut transaction, &proof).await?;
        Some(proof)
    } else {
        None
    };
    update_clock(&mut transaction, next)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    set_clock_handoff_head(&mut transaction, next_fact.handoff.head_identity())
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    advance_clock_handoff_state(&mut transaction, epoch_changed)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    transaction
        .commit()
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    if fault == PostgresCommitFault::ResponseLoss {
        Err(SharedTimeEvidenceError::ResponseLost)
    } else {
        Ok(successor_readback(prior, next_fact.handoff, proof))
    }
}

async fn clock_epoch_seen(
    transaction: &mut Transaction<'_, Postgres>,
    next: &MarketDataClockAdmission,
) -> Result<bool, SharedTimeEvidenceError> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM market_data_private.clock_handoffs_v1 WHERE clock_identity=$1 AND clock_epoch=$2)",
    )
    .bind(&next.clock_identity)
    .bind(&next.clock_epoch)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)
}

async fn insert_epoch_proof(
    transaction: &mut Transaction<'_, Postgres>,
    proof: &EpochSuccessorProof,
) -> Result<(), SharedTimeEvidenceError> {
    sqlx::query(
        "INSERT INTO market_data_private.epoch_successor_proofs_v1(proof_identity,predecessor_head_digest,successor_head_digest,prior_clock_identity,prior_clock_epoch,successor_clock_identity,successor_clock_epoch,successor_continuity_digest,commit_cut,comparison_rule) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)",
    )
    .bind(proof.proof_identity().as_bytes().as_slice())
    .bind(proof.predecessor_head_digest().as_bytes().as_slice())
    .bind(proof.successor_head_digest().as_bytes().as_slice())
    .bind(proof.prior_clock_identity())
    .bind(proof.prior_clock_epoch())
    .bind(proof.successor_clock_identity())
    .bind(proof.successor_clock_epoch())
    .bind(proof.successor_continuity_digest().as_bytes().as_slice())
    .bind(i64::try_from(proof.commit_cut()).map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?)
    .execute(&mut **transaction)
    .await
    .map_err(|e| map_shared_time_insert_error(&e))?;
    Ok(())
}

fn map_shared_time_insert_error(error: &sqlx::Error) -> SharedTimeEvidenceError {
    if error
        .as_database_error()
        .is_some_and(sqlx::error::DatabaseError::is_unique_violation)
    {
        SharedTimeEvidenceError::ReplayConflict
    } else {
        SharedTimeEvidenceError::StoreUnavailable
    }
}

async fn load_current_clock_fact_for_update(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<Option<ClockHeadFact>, SharedTimeEvidenceError> {
    let row = sqlx::query(
        "SELECT h.* FROM market_data_private.clock_handoff_head_v1 AS p JOIN market_data_private.clock_handoffs_v1 AS h ON h.head_identity=p.head_identity WHERE p.singleton FOR UPDATE OF p,h",
    )
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    row.map(|row| decode_clock_fact(&row)).transpose()
}

async fn load_clock_fact_by_identity(
    transaction: &mut Transaction<'_, Postgres>,
    identity: BindingDigest,
    for_update: bool,
) -> Result<Option<ClockHeadFact>, SharedTimeEvidenceError> {
    let statement = if for_update {
        "SELECT * FROM market_data_private.clock_handoffs_v1 WHERE head_identity=$1 FOR UPDATE"
    } else {
        "SELECT * FROM market_data_private.clock_handoffs_v1 WHERE head_identity=$1"
    };
    let row = sqlx::query(statement)
        .bind(identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    row.map(|row| decode_clock_fact(&row)).transpose()
}

fn decode_clock_fact(
    row: &sqlx::postgres::PgRow,
) -> Result<ClockHeadFact, SharedTimeEvidenceError> {
    let comparison_rule: i16 = row
        .try_get("comparison_rule")
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    if comparison_rule != 1 {
        return Err(SharedTimeEvidenceError::StoreUnavailable);
    }
    let restart: Vec<u8> = row
        .try_get("restart_continuity_digest")
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let predecessor: Option<Vec<u8>> = row
        .try_get("predecessor_head_digest")
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let clock = MarketDataClockAdmission {
        cut_kind: super::source_binding::MarketDataClockCutKind::MarketDataAsOf,
        clock_identity: row
            .try_get("clock_identity")
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        clock_epoch: row
            .try_get("clock_epoch")
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        monotonic_sequence: positive_u64(
            row.try_get("monotonic_sequence")
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        wall_observed: positive_u64(
            row.try_get("wall_observed")
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        decision_cut: positive_u64(
            row.try_get("decision_cut")
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        valid_through: positive_u64(
            row.try_get("valid_through")
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        restart_continuity_digest: digest_from_bytes(&restart)
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        uncertainty_bound: nonnegative_u64(
            row.try_get("uncertainty_bound")
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        skew_bound: positive_u64(
            row.try_get("skew_bound")
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
    };
    let fact = build_head_fact(
        &clock,
        predecessor
            .map(|value| digest_from_bytes(&value))
            .transpose()
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
    )?;
    let stored_identity: Vec<u8> = row
        .try_get("head_identity")
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let stored_digest: Vec<u8> = row
        .try_get("head_digest")
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;

    if fact.handoff.head_identity()
        != digest_from_bytes(&stored_identity)
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?
        || fact.handoff.head_digest()
            != digest_from_bytes(&stored_digest)
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?
        || !verify_head_fact(&fact)
    {
        return Err(SharedTimeEvidenceError::StoreUnavailable);
    }
    Ok(fact)
}

async fn load_epoch_proof(
    transaction: &mut Transaction<'_, Postgres>,
    successor_digest: BindingDigest,
) -> Result<Option<EpochSuccessorProof>, SharedTimeEvidenceError> {
    let row = sqlx::query(
        "SELECT * FROM market_data_private.epoch_successor_proofs_v1 WHERE successor_head_digest=$1",
    )
    .bind(successor_digest.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    row.map(|row| decode_epoch_proof(&row)).transpose()
}

fn decode_epoch_proof(
    row: &sqlx::postgres::PgRow,
) -> Result<EpochSuccessorProof, SharedTimeEvidenceError> {
    let comparison_rule: i16 = row
        .try_get("comparison_rule")
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    if comparison_rule != 1 {
        return Err(SharedTimeEvidenceError::StoreUnavailable);
    }
    let digest_column = |name: &'static str| -> Result<BindingDigest, SharedTimeEvidenceError> {
        let value: Vec<u8> = row
            .try_get(name)
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        digest_from_bytes(&value).map_err(|_| SharedTimeEvidenceError::StoreUnavailable)
    };
    Ok(EpochSuccessorProof {
        proof_identity: digest_column("proof_identity")?,
        predecessor_head_digest: digest_column("predecessor_head_digest")?,
        successor_head_digest: digest_column("successor_head_digest")?,
        prior_clock_identity: row
            .try_get("prior_clock_identity")
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        prior_clock_epoch: row
            .try_get("prior_clock_epoch")
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        successor_clock_identity: row
            .try_get("successor_clock_identity")
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        successor_clock_epoch: row
            .try_get("successor_clock_epoch")
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        successor_continuity_digest: digest_column("successor_continuity_digest")?,
        commit_cut: positive_u64(
            row.try_get("commit_cut")
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        comparison_rule:
            super::shared_time_evidence::ClockHeadComparisonRule::ExclusiveValidThrough,
    })
}

async fn load_clock_fact_for_read(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &UntrustedClockHeadLocator,
) -> Result<ClockHeadFact, SharedTimeEvidenceError> {
    let fact = load_clock_fact_for_read_by_identity(transaction, locator.head_identity()).await?;
    if fact.handoff.locator() != locator {
        return Err(SharedTimeEvidenceError::LocatorMismatch);
    }
    Ok(fact)
}

async fn load_clock_fact_for_read_by_identity(
    transaction: &mut Transaction<'_, Postgres>,
    identity: BindingDigest,
) -> Result<ClockHeadFact, SharedTimeEvidenceError> {
    let row = sqlx::query("SELECT * FROM market_data_private.resolve_clock_handoff_v1($1)")
        .bind(identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?
        .ok_or(SharedTimeEvidenceError::LocatorMismatch)?;
    decode_clock_fact(&row)
}

async fn load_historical_clock(
    transaction: &mut Transaction<'_, Postgres>,
    expected: &MarketDataClockAdmission,
) -> Result<MarketDataClockAdmission, SharedTimeEvidenceError> {
    let semantic_identity = build_head_fact(expected, None)?.handoff.head_identity();
    let row = sqlx::query("SELECT * FROM market_data_private.resolve_clock_handoff_v1($1)")
        .bind(semantic_identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?
        .ok_or(SharedTimeEvidenceError::LocatorMismatch)?;
    let fact = decode_clock_fact(&row)?;
    let clock = fact.clock();

    if &clock != expected {
        return Err(SharedTimeEvidenceError::LocatorMismatch);
    }
    Ok(clock)
}

fn clock_for_source_time(
    time: &super::source_binding::UntrustedMarketDataAsOf,
) -> MarketDataClockAdmission {
    MarketDataClockAdmission {
        cut_kind: super::source_binding::MarketDataClockCutKind::MarketDataAsOf,
        clock_identity: time.clock_identity.clone(),
        clock_epoch: time.clock_epoch.clone(),
        monotonic_sequence: time.monotonic_sequence,
        wall_observed: time.observed_at,
        decision_cut: time.effective_at,
        valid_through: time.valid_through,
        restart_continuity_digest: time.restart_continuity_digest,
        uncertainty_bound: time.uncertainty_bound,
        skew_bound: time.skew_bound,
        comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
    }
}

fn clock_for_pit_time(
    time: &super::pit_snapshot::UntrustedPitSnapshotTimeEvidence,
) -> MarketDataClockAdmission {
    MarketDataClockAdmission {
        cut_kind: super::source_binding::MarketDataClockCutKind::MarketDataAsOf,
        clock_identity: time.decision_cut.clock_identity.clone(),
        clock_epoch: time.decision_cut.clock_epoch.clone(),
        monotonic_sequence: time.monotonic_sequence,
        wall_observed: time.observed_at,
        decision_cut: time.decision_cut.value,
        valid_through: time.valid_through,
        restart_continuity_digest: time.restart_continuity_digest,
        uncertainty_bound: time.uncertainty_bound,
        skew_bound: time.skew_bound,
        comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
    }
}

async fn load_epoch_proof_for_read(
    transaction: &mut Transaction<'_, Postgres>,
    successor_digest: BindingDigest,
) -> Result<Option<EpochSuccessorProof>, SharedTimeEvidenceError> {
    let row = sqlx::query("SELECT * FROM market_data_private.resolve_epoch_successor_proof_v1($1)")
        .bind(successor_digest.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    row.map(|row| decode_epoch_proof(&row)).transpose()
}

#[cfg(test)]
type ReadSnapshotTestHook = (
    std::sync::Arc<tokio::sync::Barrier>,
    std::sync::Arc<tokio::sync::Barrier>,
);

#[cfg(test)]
static READ_SNAPSHOT_TEST_HOOK: std::sync::Mutex<Option<ReadSnapshotTestHook>> =
    std::sync::Mutex::new(None);

#[cfg(test)]
async fn pause_after_read_custody_for_test() {
    let hook = READ_SNAPSHOT_TEST_HOOK.lock().unwrap().clone();
    if let Some((entered, release)) = hook {
        entered.wait().await;
        release.wait().await;
    }
}

#[derive(Clone, Copy)]
struct ClockMembership {
    identity: BindingDigest,
    root_identity: BindingDigest,
    ordinal: u64,
    prior_identity: Option<BindingDigest>,
}

async fn validate_clock_membership_custody(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), SharedTimeEvidenceError> {
    let entries = {
        let rows =
            sqlx::query("SELECT * FROM market_data_private.resolve_clock_membership_custody_v1()")
                .fetch_all(&mut **transaction)
                .await
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        let first = rows
            .first()
            .ok_or(SharedTimeEvidenceError::StoreUnavailable)?;
        let expected: i64 = first
            .try_get("handoff_count")
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        let expected =
            usize::try_from(expected).map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        let first_identity: Option<Vec<u8>> = first
            .try_get("head_identity")
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;

        if expected == 0 {
            if rows.len() == 1 && first_identity.is_none() {
                Vec::new()
            } else {
                return Err(SharedTimeEvidenceError::StoreUnavailable);
            }
        } else {
            if rows.len() != expected {
                return Err(SharedTimeEvidenceError::StoreUnavailable);
            }
            rows.into_iter()
                .map(|row| {
                    let identity: Vec<u8> = row
                        .try_get("head_identity")
                        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
                    let root_identity: Vec<u8> = row
                        .try_get("root_head_identity")
                        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
                    let prior_identity: Option<Vec<u8>> = row
                        .try_get("prior_head_identity")
                        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
                    let ordinal: i64 = row
                        .try_get("ordinal")
                        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
                    Ok(ClockMembership {
                        identity: digest_from_bytes(&identity)
                            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
                        root_identity: digest_from_bytes(&root_identity)
                            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
                        ordinal: u64::try_from(ordinal)
                            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
                        prior_identity: prior_identity
                            .map(|value| digest_from_bytes(&value))
                            .transpose()
                            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
                    })
                })
                .collect::<Result<Vec<_>, SharedTimeEvidenceError>>()?
        }
    };

    for entry in &entries {
        let fact = load_clock_fact_for_read_by_identity(transaction, entry.identity).await?;
        if entry.ordinal == 1 {
            if entry.root_identity != entry.identity
                || entry.prior_identity.is_some()
                || fact.predecessor_head_digest.is_some()
            {
                return Err(SharedTimeEvidenceError::StoreUnavailable);
            }
            continue;
        }
        let prior_entry = entries
            .iter()
            .find(|candidate| Some(candidate.identity) == entry.prior_identity)
            .ok_or(SharedTimeEvidenceError::StoreUnavailable)?;

        if entry.root_identity != prior_entry.root_identity
            || prior_entry.ordinal.checked_add(1) != Some(entry.ordinal)
        {
            return Err(SharedTimeEvidenceError::StoreUnavailable);
        }
        let prior = load_clock_fact_for_read_by_identity(transaction, prior_entry.identity).await?;
        if fact.predecessor_head_digest != Some(prior.handoff.head_digest()) {
            return Err(SharedTimeEvidenceError::StoreUnavailable);
        }
        let proof = load_epoch_proof_for_read(transaction, fact.handoff.head_digest()).await?;
        if fact.handoff.clock_epoch() == prior.handoff.clock_epoch() {
            validate_same_epoch_successor(&prior, &fact.clock())
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
            if proof.is_some() {
                return Err(SharedTimeEvidenceError::StoreUnavailable);
            }
        } else {
            validate_new_epoch_successor(&prior, &fact.clock())
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
            let proof = proof.ok_or(SharedTimeEvidenceError::StoreUnavailable)?;
            if !verify_epoch_successor_proof(&proof, &prior, &fact) {
                return Err(SharedTimeEvidenceError::StoreUnavailable);
            }
        }
    }
    Ok(())
}

async fn validate_read_custody(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), SharedTimeEvidenceError> {
    validate_owner_history_custody(transaction)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let row = sqlx::query("SELECT * FROM market_data_private.resolve_clock_custody_state_v1()")
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?
        .ok_or(SharedTimeEvidenceError::StoreUnavailable)?;
    let head_identity: Vec<u8> = row
        .try_get("head_identity")
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let head_digest: Vec<u8> = row
        .try_get("head_digest")
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let locator = UntrustedClockHeadLocator::from_untrusted(
        digest_from_bytes(&head_identity).map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
        digest_from_bytes(&head_digest).map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?,
    );
    load_clock_fact_for_read(transaction, &locator).await?;
    Box::pin(validate_clock_membership_custody(transaction)).await?;
    Ok(())
}

#[cfg(test)]
#[async_trait::async_trait]
impl SharedTimeEvidenceResolver for MarketDataReadPostgres {
    async fn resolve_clock_head(
        &self,
        locator: &UntrustedClockHeadLocator,
    ) -> Result<ClockHeadHandoff, SharedTimeEvidenceError> {
        let mut transaction = self.begin_read_snapshot().await?;
        validate_read_custody(&mut transaction).await?;
        let handoff = load_clock_fact_for_read(&mut transaction, locator)
            .await?
            .handoff;
        transaction
            .commit()
            .await
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        Ok(handoff)
    }

    async fn resolve_clock_successor(
        &self,
        prior: &ClockHeadHandoff,
        successor: &UntrustedClockHeadLocator,
    ) -> Result<ClockHeadSuccessorReadback, SharedTimeEvidenceError> {
        let mut transaction = self.begin_read_snapshot().await?;
        validate_read_custody(&mut transaction).await?;
        #[cfg(test)]
        pause_after_read_custody_for_test().await;
        let prior_fact = load_clock_fact_for_read(&mut transaction, prior.locator()).await?;
        if &prior_fact.handoff != prior {
            return Err(SharedTimeEvidenceError::PriorHandoffMismatch);
        }
        let successor_fact = load_clock_fact_for_read(&mut transaction, successor).await?;
        if successor_fact.predecessor_head_digest != Some(prior.head_digest()) {
            return Err(SharedTimeEvidenceError::PriorHandoffMismatch);
        }
        let proof =
            load_epoch_proof_for_read(&mut transaction, successor_fact.handoff.head_digest())
                .await?;

        if prior.clock_epoch() == successor_fact.handoff.clock_epoch() {
            validate_same_epoch_successor(&prior_fact, &successor_fact.clock())?;

            if proof.is_some() {
                return Err(SharedTimeEvidenceError::EpochSuccessorProofMismatch);
            }
        } else {
            validate_new_epoch_successor(&prior_fact, &successor_fact.clock())?;
            let proof_value = proof
                .as_ref()
                .ok_or(SharedTimeEvidenceError::EpochSuccessorProofMismatch)?;
            if !verify_epoch_successor_proof(proof_value, &prior_fact, &successor_fact) {
                return Err(SharedTimeEvidenceError::EpochSuccessorProofMismatch);
            }
        }
        let readback = successor_readback(prior, successor_fact.handoff, proof);
        transaction
            .commit()
            .await
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        Ok(readback)
    }
}

#[cfg(not(test))]
#[async_trait::async_trait]
impl SharedTimeEvidenceResolver for MarketDataReadPostgres {
    async fn resolve_clock_head(
        &self,
        locator: &UntrustedClockHeadLocator,
    ) -> Result<ClockHeadHandoff, SharedTimeEvidenceError> {
        let raw = self
            .admitted_port
            .resolve_shared_time_evidence_v1()
            .await
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        let history = verify_raw_clock_history_v1(&raw)?;
        let entry = history
            .iter()
            .find(|entry| entry.fact.handoff.head_identity() == locator.head_identity())
            .ok_or(SharedTimeEvidenceError::LocatorMismatch)?;
        if entry.fact.handoff.locator() != locator {
            return Err(SharedTimeEvidenceError::LocatorMismatch);
        }
        Ok(entry.fact.handoff.clone())
    }

    async fn resolve_clock_successor(
        &self,
        prior: &ClockHeadHandoff,
        successor: &UntrustedClockHeadLocator,
    ) -> Result<ClockHeadSuccessorReadback, SharedTimeEvidenceError> {
        let raw = self
            .admitted_port
            .resolve_shared_time_evidence_v1()
            .await
            .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        let history = verify_raw_clock_history_v1(&raw)?;
        let prior_entry = history
            .iter()
            .find(|entry| entry.fact.handoff.head_identity() == prior.head_identity())
            .ok_or(SharedTimeEvidenceError::PriorHandoffMismatch)?;
        if &prior_entry.fact.handoff != prior {
            return Err(SharedTimeEvidenceError::PriorHandoffMismatch);
        }
        let successor_entry = history
            .iter()
            .find(|entry| entry.fact.handoff.head_identity() == successor.head_identity())
            .ok_or(SharedTimeEvidenceError::LocatorMismatch)?;

        if successor_entry.fact.handoff.locator() != successor
            || successor_entry.fact.predecessor_head_digest != Some(prior.head_digest())
        {
            return Err(SharedTimeEvidenceError::PriorHandoffMismatch);
        }
        Ok(successor_readback(
            prior,
            successor_entry.fact.handoff.clone(),
            successor_entry.proof.clone(),
        ))
    }
}

struct VerifiedClockHistoryEntryV1 {
    membership: ClockMembership,
    fact: ClockHeadFact,
    proof: Option<EpochSuccessorProof>,
}

fn verify_raw_clock_history_v1(
    raw: &RawSharedTimeEvidenceSnapshotV1,
) -> Result<Vec<VerifiedClockHistoryEntryV1>, SharedTimeEvidenceError> {
    let mut expected_count = None;
    let mut entries = Vec::with_capacity(raw.history_rows.len());
    for raw_entry in &raw.history_rows {
        let (count, membership) = decode_raw_clock_membership(&raw_entry.membership_row)?;
        if expected_count
            .replace(count)
            .is_some_and(|expected| expected != count)
        {
            return Err(SharedTimeEvidenceError::StoreUnavailable);
        }
        let fact = decode_raw_clock_fact(
            raw_entry
                .handoff_row
                .as_deref()
                .ok_or(SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
        if membership.identity != fact.handoff.head_identity() {
            return Err(SharedTimeEvidenceError::StoreUnavailable);
        }
        let proof = raw_entry
            .epoch_proof_row
            .as_deref()
            .map(decode_raw_epoch_proof)
            .transpose()?;
        entries.push(VerifiedClockHistoryEntryV1 {
            membership,
            fact,
            proof,
        });
    }

    if expected_count != Some(entries.len()) || entries.is_empty() {
        return Err(SharedTimeEvidenceError::StoreUnavailable);
    }

    for entry in &entries {
        if entries
            .iter()
            .filter(|candidate| candidate.membership.identity == entry.membership.identity)
            .count()
            != 1
            || entries
                .iter()
                .filter(|candidate| candidate.membership.ordinal == entry.membership.ordinal)
                .count()
                != 1
        {
            return Err(SharedTimeEvidenceError::StoreUnavailable);
        }

        if entry.membership.ordinal == 1 {
            if entry.membership.root_identity != entry.membership.identity
                || entry.membership.prior_identity.is_some()
                || entry.fact.predecessor_head_digest.is_some()
                || entry.proof.is_some()
            {
                return Err(SharedTimeEvidenceError::StoreUnavailable);
            }
            continue;
        }
        let prior = entries
            .iter()
            .find(|candidate| {
                Some(candidate.membership.identity) == entry.membership.prior_identity
            })
            .ok_or(SharedTimeEvidenceError::StoreUnavailable)?;

        if entry.membership.root_identity != prior.membership.root_identity
            || prior.membership.ordinal.checked_add(1) != Some(entry.membership.ordinal)
            || entry.fact.predecessor_head_digest != Some(prior.fact.handoff.head_digest())
        {
            return Err(SharedTimeEvidenceError::StoreUnavailable);
        }

        if entry.fact.handoff.clock_epoch() == prior.fact.handoff.clock_epoch() {
            validate_same_epoch_successor(&prior.fact, &entry.fact.clock())
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
            if entry.proof.is_some() {
                return Err(SharedTimeEvidenceError::StoreUnavailable);
            }
        } else {
            validate_new_epoch_successor(&prior.fact, &entry.fact.clock())
                .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
            let proof = entry
                .proof
                .as_ref()
                .ok_or(SharedTimeEvidenceError::StoreUnavailable)?;
            if !verify_epoch_successor_proof(proof, &prior.fact, &entry.fact) {
                return Err(SharedTimeEvidenceError::StoreUnavailable);
            }
        }
    }
    Ok(entries)
}

#[cfg(test)]
#[async_trait::async_trait]
impl SourceBindingOwnerResolver for MarketDataReadPostgres {
    async fn resolve_source_binding(
        &self,
        locator: &UntrustedSourceBindingLocator,
    ) -> Result<SourceBindingOwnerReadback, SourceBindingError> {
        let mut transaction = self
            .begin_read_snapshot()
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        validate_read_custody(&mut transaction)
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        validate_source_lineage_shape(&mut transaction, locator.lineage_root).await?;
        let envelope = load_envelope(
            &mut transaction,
            "SELECT * FROM market_data_private.resolve_source_binding_v1($1)",
            locator.binding_id,
        )
        .await
        .map_err(|_| SourceBindingError::StoreUnavailable)?
        .ok_or(SourceBindingError::LocatorMismatch)?;
        let aggregate: SourceBindingStoredAggregate = serde_json::from_value(envelope.aggregate)
            .map_err(|_| SourceBindingError::StoreUnavailable)?;

        if !verify_source_native(&aggregate, &envelope.native, true)
            || aggregate.commit().receipt().locator() != locator
        {
            return Err(SourceBindingError::LocatorMismatch);
        }
        let expected_clock = clock_for_source_time(aggregate.commit().fact().time_evidence());
        let historical_clock = load_historical_clock(&mut transaction, &expected_clock)
            .await
            .map_err(|e| match e {
                SharedTimeEvidenceError::StoreUnavailable => SourceBindingError::StoreUnavailable,
                _ => SourceBindingError::TrustedClockMismatch,
            })?;
        validate_clock_for_readback(aggregate.commit().fact().time_evidence(), &historical_clock)?;
        let readback = SourceBindingOwnerReadback::from_verified(&aggregate);
        transaction
            .commit()
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        Ok(readback)
    }
}

#[cfg(not(test))]
#[async_trait::async_trait]
impl SourceBindingOwnerResolver for MarketDataReadPostgres {
    async fn resolve_source_binding(
        &self,
        locator: &UntrustedSourceBindingLocator,
    ) -> Result<SourceBindingOwnerReadback, SourceBindingError> {
        let evidence = self
            .admitted_port
            .resolve(*locator.binding_id().as_bytes())
            .await
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        verify_admitted_source_evidence(locator, &evidence)
    }
}

/// Reads one snapshot's verified observation batch from a pool, for the build that holds one.
///
/// The caller says which cut it wants by identity and states the digest it expects that cut to
/// have. Checking the digest here is what keeps this arm equal in meaning to the port arm, whose
/// verifier checks it inside: without it, an identity that has since been corrected would resolve
/// to a revision the caller never named.
#[cfg(test)]
async fn load_verified_observation_batch_from_pool(
    pool: &PgPool,
    snapshot_identity: BindingDigest,
    expected_fact_digest: BindingDigest,
) -> Result<VerifiedPitObservationBatch, PitSnapshotError> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    // Both loads read without locking. The transaction above is `READ ONLY`, and PostgreSQL refuses
    // `SELECT ... FOR UPDATE` inside one with `25006`, so the locking variants this used to call
    // could not return a batch under any circumstances - the caller always saw
    // `PersistenceUnavailable`, with the cause discarded one line from where it was produced. The
    // snapshot this isolation level already provides is what a read-only consumer needs; the lock
    // was protecting a write that does not happen here.
    let batch =
        load_verified_observation_batch(&mut transaction, snapshot_identity, expected_fact_digest)
            .await?;
    transaction
        .commit()
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    Ok(batch)
}

/// Reads one snapshot's verified observation batch inside the caller's read-only transaction.
///
/// The caller names the cut by identity and states the digest it expects; an identity that has
/// since been corrected would otherwise resolve to a revision the caller never named. Both loads
/// read without locking, because PostgreSQL refuses `SELECT ... FOR UPDATE` in a `READ ONLY`
/// transaction and a reader has no write to protect.
async fn load_verified_observation_batch(
    transaction: &mut Transaction<'_, Postgres>,
    snapshot_identity: BindingDigest,
    expected_fact_digest: BindingDigest,
) -> Result<VerifiedPitObservationBatch, PitSnapshotError> {
    let aggregate = load_pit(transaction, snapshot_identity, false, false)
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?
        .ok_or(PitSnapshotError::LocatorMismatch)?;

    if aggregate.fact().digest() != expected_fact_digest {
        return Err(PitSnapshotError::LocatorMismatch);
    }
    let stored = load_pit_observation_batch(transaction, &aggregate, false)
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?
        .ok_or(PitSnapshotError::LocatorMismatch)?;
    verify_observation_batch(
        &aggregate,
        stored.source_binding_identity,
        stored.source_binding_lineage_root,
        stored.source_binding_lineage_version,
        stored.digest,
        &stored.bytes,
        &stored.rows,
    )
    .map_err(|_| PitSnapshotError::LocatorMismatch)
}

#[async_trait::async_trait]
impl PitObservationBatchOwnerResolver for MarketDataReadPostgres {
    async fn resolve_pit_observation_batch(
        &self,
        locator: &UntrustedPitSnapshotLocator,
    ) -> Result<VerifiedPitObservationBatch, PitSnapshotError> {
        #[cfg(test)]
        {
            return load_verified_observation_batch_from_pool(
                &self.pool,
                locator.snapshot_identity,
                locator.fact_digest,
            )
            .await;
        }
        #[cfg(not(test))]
        {
            let evidence = self
                .admitted_port
                .resolve_pit_evaluation(*locator.snapshot_identity.as_bytes())
                .await
                .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
            verify_admitted_pit_evidence(locator, &evidence)
        }
    }
}

#[cfg(not(test))]
#[async_trait::async_trait]
impl ResearchPitTerminalResolver for MarketDataReadPostgres {
    async fn resolve_research_pit_terminal(
        &self,
        request: &UntrustedResearchPitTerminalRequest,
    ) -> Result<ResearchPitTerminal, PitSnapshotError> {
        let evidence = self
            .admitted_port
            .resolve_pit_terminal(*request.locator.snapshot_identity.as_bytes())
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        verify_admitted_pit_terminal_evidence(request, &evidence)
    }
}

#[cfg(not(test))]
#[async_trait::async_trait]
impl SealedReplayInputResolver for MarketDataReadPostgres {
    async fn resolve_sealed_replay_input(
        &self,
        request: &UntrustedSealedReplayInputRequest,
    ) -> Result<SealedReplayInput, PitSnapshotError> {
        let evidence = self
            .admitted_port
            .resolve_pit_evaluation(*request.locator.snapshot_identity.as_bytes())
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let (pit, source, batch) =
            verify_admitted_current_pit_evidence(&request.locator, &evidence)?;
        seal_replay_input(&pit, &source, &batch, request)
    }
}

#[cfg(not(test))]
#[async_trait::async_trait]
impl StrategyInputSampleProjectionResolverV2 for MarketDataReadPostgres {
    async fn resolve_strategy_input_sample_projection_v2(
        &self,
        locator: &UntrustedStrategyInputSampleProjectionLocatorV2,
    ) -> Result<StrategyInputSampleProjectionReadbackV2, StrategyInputSampleProjectionResolveErrorV2>
    {
        let evidence = self
            .admitted_port
            .resolve_sample_projection_v2(locator.receipt_digest())
            .await
            .map_err(|_| StrategyInputSampleProjectionResolveErrorV2)?;
        let readback = verify_admitted_sample_projection_v2(locator.receipt_digest(), &evidence)
            .map_err(|_| StrategyInputSampleProjectionResolveErrorV2)?;
        self.admitted_port
            .revalidate_sample_projection_v2_before_return()
            .await
            .map_err(|_| StrategyInputSampleProjectionResolveErrorV2)?;
        Ok(readback)
    }
}

#[cfg(not(test))]
#[async_trait::async_trait]
impl StrategyInputSampleProjectionResolverV3 for MarketDataReadPostgres {
    async fn resolve_strategy_input_sample_projection_v3(
        &self,
        locator: &UntrustedStrategyInputSampleProjectionLocatorV3,
    ) -> Result<StrategyInputSampleProjectionReadbackV3, StrategyInputSampleProjectionResolveErrorV3>
    {
        let evidence = self
            .admitted_port
            .resolve_sample_projection_v3(locator.receipt_digest())
            .await
            .map_err(|_| StrategyInputSampleProjectionResolveErrorV3)?;
        let readback = verify_admitted_sample_projection_v3(locator.receipt_digest(), &evidence)
            .map_err(|_| StrategyInputSampleProjectionResolveErrorV3)?;
        self.admitted_port
            .revalidate_sample_projection_v3_before_return()
            .await
            .map_err(|_| StrategyInputSampleProjectionResolveErrorV3)?;
        Ok(readback)
    }
}

impl super::research_pit_terminal::sealed::Sealed for MarketDataReadPostgres {}
impl super::sealed_replay_input::sealed::Sealed for MarketDataReadPostgres {}
impl super::bar_schedule::resolver_seal::Sealed for MarketDataReadPostgres {}
impl super::native_replay_scheduling_v1::resolver_seal::Sealed for MarketDataReadPostgres {}

/// Reads one frame's initial Market Data inputs through an admitted port, in the required order.
///
/// **Deliberately not `cfg`-gated, although its only production caller is.** While this lived
/// inside the `cfg(not(test))` arm of the resolver, the arrangement did not exist in a test build
/// at all - not untested but absent - so no proof could reach it and the first execution of this
/// order would have happened in a deployment. The port revalidates its own admission before and
/// after each read, so what this adds is the order: the cut, the schedules that cut admits, then
/// the quote cut the frame's census and decision cut choose.
pub(super) async fn resolve_native_replay_initial_market_through_admitted_port_v1(
    port: &AdmittedMarketDataSnapshotPort,
    request: &NativeReplayInitialMarketRequestV1,
) -> Result<NativeReplayInitialMarketReadbackV1, NativeReplaySchedulingErrorV1> {
    let evidence = port
        .resolve_pit_evaluation(*request.snapshot_identity().as_bytes())
        .await
        .map_err(|_| NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)?;
    let batch = verify_admitted_pit_evidence_by_identity_v1(
        request.snapshot_identity(),
        request.snapshot_fact_digest(),
        &evidence,
    )
    .map_err(|_| NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)?;
    let timeframe = request
        .schedule_timeframe()
        .ok_or(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?
        .to_owned();
    let mut schedules = Vec::with_capacity(request.member_instruments().len());

    for instrument in request.member_instruments() {
        let candidates = port
            .resolve_bar_schedule_candidates_v1(&instrument.to_string())
            .await
            .map_err(|_| NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)?;
        let verified = candidates
            .iter()
            .map(verify_admitted_bar_schedule_candidate_v1)
            .collect::<Result<Vec<_>, _>>()?;
        schedules.push(select_native_replay_schedule_v1(
            verified,
            &batch,
            instrument,
            &timeframe,
            request.frame_time_ns(),
        )?);
    }
    let quote_cut = resolve_native_replay_quote_cut_through_admitted_port_v2(
        port,
        &batch,
        request.window_end_ns_exclusive(),
    )
    .await
    .map_err(native_replay_scheduling_error_of_quote_cut_refusal)?;
    issue_native_replay_initial_market_readback_v1(batch, quote_cut, schedules, request)
}

/// Resolves a frame's quote cut through an admitted port, by the same rules as custody's own read.
///
/// The port returns the frame census's bound and the quote cut census rows from one snapshot;
/// the chosen quote cut is then read back through the port's PIT evaluation and verified like
/// any other cut before it is compared with the frame.
pub(super) async fn resolve_native_replay_quote_cut_through_admitted_port_v2(
    port: &AdmittedMarketDataSnapshotPort,
    frame: &VerifiedPitObservationBatch,
    window_end_ns_exclusive: u64,
) -> Result<VerifiedPitObservationBatch, NativeReplayQuoteCutRefusalV2> {
    let frame_coordinates = NativeReplayCutCoordinatesV2::of(frame);
    let decision_cut_ns = frame.time_evidence().decision_cut.value;
    let census = port
        .resolve_native_replay_quote_cut_census_v2(
            *frame_coordinates.scope_digest.as_bytes(),
            frame_coordinates.event_effective_ns,
            decision_cut_ns,
            window_end_ns_exclusive,
        )
        .await
        .map_err(|_| NativeReplayQuoteCutRefusalV2::CustodyUnavailable)?;
    let candidates = census
        .rows
        .iter()
        .map(|row| decode_raw_native_replay_quote_cut_candidate_v2(row))
        .collect::<Result<Vec<_>, _>>()?;
    let chosen = select_native_replay_quote_cut_v2(
        &candidates,
        &frame_coordinates,
        census.bound_ns_exclusive,
        decision_cut_ns,
    )?;
    let evidence = port
        .resolve_pit_evaluation(*chosen.snapshot_identity.as_bytes())
        .await
        .map_err(|_| NativeReplayQuoteCutRefusalV2::CustodyUnavailable)?;
    let quote_cut = verify_admitted_pit_evidence_by_identity_v1(
        chosen.snapshot_identity,
        chosen.snapshot_fact_digest,
        &evidence,
    )
    .map_err(|_| NativeReplayQuoteCutRefusalV2::CustodyUnavailable)?;
    verify_native_replay_quote_cut_v2(
        &frame_coordinates,
        &NativeReplayCutCoordinatesV2::of(&quote_cut),
    )?;
    Ok(quote_cut)
}

/// Decodes one quote cut census row as the port's census read returned it.
fn decode_raw_native_replay_quote_cut_candidate_v2(
    row: &[u8],
) -> Result<NativeReplayQuoteCutCandidateV2, NativeReplayQuoteCutRefusalV2> {
    let value: Value = serde_json::from_slice(row)
        .map_err(|_| NativeReplayQuoteCutRefusalV2::CustodyUnavailable)?;
    let object = value
        .as_object()
        .ok_or(NativeReplayQuoteCutRefusalV2::CustodyUnavailable)?;
    let digest = |field: &str| {
        object
            .get(field)
            .ok_or(NativeReplayQuoteCutRefusalV2::CustodyUnavailable)
            .and_then(|value| {
                raw_digest(value).map_err(|_| NativeReplayQuoteCutRefusalV2::CustodyUnavailable)
            })
    };
    let nanos = |field: &str| {
        object
            .get(field)
            .and_then(Value::as_u64)
            .ok_or(NativeReplayQuoteCutRefusalV2::CustodyUnavailable)
    };
    Ok(NativeReplayQuoteCutCandidateV2 {
        snapshot_identity: digest("snapshot_identity")?,
        snapshot_fact_digest: digest("snapshot_fact_digest")?,
        scope_digest: digest("scope_digest")?,
        instrument_master_digest: digest("instrument_master_digest")?,
        universe_selection_digest: digest("universe_selection_digest")?,
        market_semantics_identity: digest("market_semantics_identity")?,
        source_binding_lineage_root: digest("source_binding_lineage_root")?,
        event_effective_ns: nanos("event_effective_ns")?,
        decision_cut_ns: nanos("decision_cut_ns")?,
        correction_lineage_root: digest("correction_lineage_root")?,
        correction_lineage_version: nanos("correction_lineage_version")?,
    })
}

/// What a quote cut refusal means to the frame that needed it.
///
/// A frame with no quote cut has no liquidity after its BAR, which is what `EventOrderUnavailable`
/// has always said; any other refusal is a quote cut that is not the frame's.
fn native_replay_scheduling_error_of_quote_cut_refusal(
    refusal: NativeReplayQuoteCutRefusalV2,
) -> NativeReplaySchedulingErrorV1 {
    match refusal {
        NativeReplayQuoteCutRefusalV2::CustodyUnavailable => {
            NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable
        }
        NativeReplayQuoteCutRefusalV2::QuoteCutMissing => {
            NativeReplaySchedulingErrorV1::EventOrderUnavailable
        }
        NativeReplayQuoteCutRefusalV2::AmbiguousQuoteCut
        | NativeReplayQuoteCutRefusalV2::NotAQuoteCut
        | NativeReplayQuoteCutRefusalV2::CoordinateMismatch
        | NativeReplayQuoteCutRefusalV2::MemberMismatch => {
            NativeReplaySchedulingErrorV1::OwnerBindingMismatch
        }
    }
}

/// The same read against a pool, for the build where this type holds one instead of a port.
#[cfg(test)]
async fn resolve_native_replay_initial_market_from_pool_v1(
    pool: &PgPool,
    request: &NativeReplayInitialMarketRequestV1,
) -> Result<NativeReplayInitialMarketReadbackV1, NativeReplaySchedulingErrorV1> {
    let batch = load_verified_observation_batch_from_pool(
        pool,
        request.snapshot_identity(),
        request.snapshot_fact_digest(),
    )
    .await
    .map_err(|_| NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(|_| NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)?;
    let timeframe = request
        .schedule_timeframe()
        .ok_or(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?
        .to_owned();
    let mut schedules = Vec::with_capacity(request.member_instruments().len());

    for instrument in request.member_instruments() {
        let candidates = load_bar_schedule_candidates(&mut transaction, &instrument.to_string())
            .await
            .map_err(|_| NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)?;
        schedules.push(select_native_replay_schedule_v1(
            candidates,
            &batch,
            instrument,
            &timeframe,
            request.frame_time_ns(),
        )?);
    }
    let quote_cut = resolve_native_replay_quote_cut_in_transaction_v2(
        &mut transaction,
        &batch,
        request.window_end_ns_exclusive(),
    )
    .await
    .map_err(native_replay_scheduling_error_of_quote_cut_refusal)?;
    transaction
        .commit()
        .await
        .map_err(|_| NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)?;
    issue_native_replay_initial_market_readback_v1(batch, quote_cut, schedules, request)
}

/// Every schedule one instrument holds, in the order the candidate function returns them.
#[cfg(test)]
async fn load_bar_schedule_candidates(
    transaction: &mut Transaction<'_, Postgres>,
    canonical_instrument: &str,
) -> Result<Vec<BarScheduleReadbackV1>, BarScheduleCustodyErrorV1> {
    let digests: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT f.fact_digest FROM market_data_private.bar_schedule_facts_v1 AS f JOIN market_data_private.bar_schedule_receipts_v1 AS r ON r.fact_digest=f.fact_digest WHERE f.canonical_instrument=$1 ORDER BY r.readback_identity",
    )
    .bind(canonical_instrument)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
    let mut readbacks = Vec::with_capacity(digests.len());

    for digest in digests {
        let digest: [u8; 32] = digest
            .try_into()
            .map_err(|_| BarScheduleCustodyErrorV1::StoreUnavailable)?;
        let readback = load_bar_schedule_by_fact(
            transaction,
            BarScheduleIdentity::from_untrusted_bytes(digest),
            false,
        )
        .await?
        .ok_or(BarScheduleCustodyErrorV1::UnknownReadback)?;
        readbacks.push(readback);
    }
    Ok(readbacks)
}

#[async_trait::async_trait]
impl NativeReplaySchedulingResolverV1 for MarketDataReadPostgres {
    async fn resolve_native_replay_initial_market_inputs_v1(
        &self,
        request: &NativeReplayInitialMarketRequestV1,
    ) -> Result<NativeReplayInitialMarketReadbackV1, NativeReplaySchedulingErrorV1> {
        #[cfg(test)]
        {
            return resolve_native_replay_initial_market_from_pool_v1(&self.pool, request).await;
        }
        #[cfg(not(test))]
        {
            resolve_native_replay_initial_market_through_admitted_port_v1(
                &self.admitted_port,
                request,
            )
            .await
        }
    }
}

#[async_trait::async_trait]
impl BarScheduleResolverV1 for MarketDataReadPostgres {
    async fn resolve_bar_schedule_v1(
        &self,
        locator: &UntrustedBarScheduleLocatorV1,
    ) -> Result<BarScheduleReadbackV1, super::bar_schedule::BarScheduleError> {
        #[cfg(test)]
        {
            return resolve_bar_schedule_from_pool(&self.pool, locator)
                .await
                .map_err(|e| match e {
                    BarScheduleCustodyErrorV1::UnknownReadback => {
                        super::bar_schedule::BarScheduleError::UnknownIdentity
                    }
                    _ => super::bar_schedule::BarScheduleError::StoreUnavailable,
                });
        }
        #[cfg(not(test))]
        {
            resolve_bar_schedule_through_admitted_port_v1(&self.admitted_port, locator).await
        }
    }
}

/// Reads one BAR schedule through an admitted port, in the order the custody argument requires.
///
/// Three steps, and the arrangement is the property: the port's own read, then verification of the
/// evidence it returned, then the port's revalidation before the value is handed back. Skipping the
/// middle step would return evidence nothing checked; skipping the last would return a value proven
/// against an admission that may have expired while the read was in flight.
///
/// **Deliberately not `cfg`-gated, although its only production caller is.** While this lived inside
/// the `cfg(not(test))` arm of `resolve_bar_schedule_v1`, the arrangement did not exist in a test
/// build at all - not untested but absent - so no proof could reach it and the first execution of
/// this order would have happened in a deployment. The three methods it calls each have their own
/// coverage; what had none was the order, and an order cannot be observed from outside the build
/// that contains it.
pub(super) async fn resolve_bar_schedule_through_admitted_port_v1(
    port: &AdmittedMarketDataSnapshotPort,
    locator: &UntrustedBarScheduleLocatorV1,
) -> Result<BarScheduleReadbackV1, super::bar_schedule::BarScheduleError> {
    let evidence = port
        .resolve_bar_schedule_v1(*locator.digest.as_bytes())
        .await
        .map_err(|_| super::bar_schedule::BarScheduleError::StoreUnavailable)?;
    let evidence = evidence.ok_or(super::bar_schedule::BarScheduleError::UnknownIdentity)?;
    let readback = verify_admitted_bar_schedule_v1(locator.digest, &evidence)
        .map_err(|_| super::bar_schedule::BarScheduleError::StoreUnavailable)?;
    port.revalidate_bar_schedule_v1_before_return()
        .await
        .map_err(|_| super::bar_schedule::BarScheduleError::StoreUnavailable)?;
    Ok(readback)
}

fn verify_admitted_bar_schedule_v1(
    expected_identity: BarScheduleIdentity,
    evidence: &BarScheduleStorageEvidenceV1,
) -> Result<BarScheduleReadbackV1, BarScheduleCustodyErrorV1> {
    verify_bar_schedule_storage_evidence(
        expected_identity,
        evidence.readback_row(),
        evidence.history_rows(),
    )
}

fn verify_admitted_bar_schedule_candidate_v1(
    evidence: &BarScheduleStorageEvidenceV1,
) -> Result<BarScheduleReadbackV1, NativeReplaySchedulingErrorV1> {
    let value: Value = serde_json::from_slice(evidence.readback_row())
        .map_err(|_| NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)?;
    let identity = value
        .as_object()
        .and_then(|object| object.get("readback_identity"))
        .ok_or(NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)
        .and_then(|value| {
            raw_digest(value).map_err(|_| NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)
        })?;
    verify_bar_schedule_storage_evidence(identity, evidence.readback_row(), evidence.history_rows())
        .map_err(|_| NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)
}

#[cfg(test)]
#[async_trait::async_trait]
impl PitSnapshotOwnerResolver for MarketDataReadPostgres {
    async fn resolve_pit_snapshot(
        &self,
        locator: &UntrustedPitSnapshotLocator,
    ) -> Result<PitSnapshotOwnerReadback, PitSnapshotError> {
        let mut transaction = self
            .begin_read_snapshot()
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        validate_read_custody(&mut transaction)
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let envelope = load_envelope(
            &mut transaction,
            "SELECT * FROM market_data_private.resolve_pit_snapshot_v1($1)",
            locator.snapshot_identity,
        )
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?
        .ok_or(PitSnapshotError::LocatorMismatch)?;
        let aggregate: PitSnapshotCommitAggregate = serde_json::from_value(envelope.aggregate)
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        validate_pit_lineage_shape(&mut transaction, aggregate.fact().lineage_root()).await?;

        if !verify_pit_native(&aggregate, &envelope.native, true)
            || aggregate.receipt().locator() != locator
        {
            return Err(PitSnapshotError::LocatorMismatch);
        }
        validate_source_read_custody(&mut transaction, &aggregate.fact().request().source_binding)
            .await?;
        let expected_clock = clock_for_pit_time(&aggregate.fact().request().time_evidence);
        let historical_clock = load_historical_clock(&mut transaction, &expected_clock)
            .await
            .map_err(|e| match e {
                SharedTimeEvidenceError::StoreUnavailable => {
                    PitSnapshotError::PersistenceUnavailable
                }
                _ => PitSnapshotError::TrustedClockMismatch,
            })?;
        super::pit_snapshot::authority::validate_read_clock(
            &aggregate.fact().request().time_evidence,
            &historical_clock,
        )?;
        let readback = PitSnapshotOwnerReadback::from_verified(&aggregate);
        transaction
            .commit()
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        Ok(readback)
    }
}

#[cfg(test)]
#[async_trait::async_trait]
impl ResearchPitTerminalResolver for MarketDataReadPostgres {
    async fn resolve_research_pit_terminal(
        &self,
        request: &UntrustedResearchPitTerminalRequest,
    ) -> Result<ResearchPitTerminal, PitSnapshotError> {
        let mut transaction = self
            .begin_read_snapshot()
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        validate_read_custody(&mut transaction)
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let envelope = load_envelope(
            &mut transaction,
            "SELECT * FROM market_data_private.resolve_pit_snapshot_v1($1)",
            request.locator.snapshot_identity,
        )
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?
        .ok_or(PitSnapshotError::LocatorMismatch)?;
        let pit: PitSnapshotCommitAggregate = serde_json::from_value(envelope.aggregate)
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        validate_pit_lineage_shape(&mut transaction, pit.fact().lineage_root()).await?;
        if !verify_pit_native(&pit, &envelope.native, false)
            || pit.receipt().locator() != &request.locator
        {
            return Err(PitSnapshotError::LocatorMismatch);
        }

        if envelope.native.head.identity != pit.fact().snapshot_identity()
            || envelope.native.head.fact_digest != pit.fact().digest()
            || envelope.native.head.lineage_version != pit.fact().lineage_version()
        {
            return Err(PitSnapshotError::CorrectionHeadMismatch);
        }
        validate_source_read_custody(&mut transaction, &pit.fact().request().source_binding)
            .await?;
        let source_envelope = load_envelope(
            &mut transaction,
            "SELECT * FROM market_data_private.resolve_source_binding_v1($1)",
            pit.fact().source_binding_identity(),
        )
        .await
        .map_err(|_| PitSnapshotError::PersistenceUnavailable)?
        .ok_or(PitSnapshotError::SourceBindingUnavailable)?;
        let source: SourceBindingStoredAggregate =
            serde_json::from_value(source_envelope.aggregate)
                .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        if !verify_source_native(&source, &source_envelope.native, true) {
            return Err(PitSnapshotError::SourceBindingUnavailable);
        }
        let expected_clock = clock_for_pit_time(&pit.fact().request().time_evidence);
        let historical_clock = load_historical_clock(&mut transaction, &expected_clock)
            .await
            .map_err(|e| match e {
                SharedTimeEvidenceError::StoreUnavailable => {
                    PitSnapshotError::PersistenceUnavailable
                }
                _ => PitSnapshotError::TrustedClockMismatch,
            })?;
        super::pit_snapshot::authority::validate_read_clock(
            &pit.fact().request().time_evidence,
            &historical_clock,
        )?;
        let terminal = seal_research_pit_terminal(&pit, &source, request)?;
        transaction
            .commit()
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        Ok(terminal)
    }
}

struct StoredEnvelope {
    aggregate: Value,
    native: NativeIndex,
}

fn verify_admitted_sample_projection_v2(
    expected_digest: [u8; 32],
    evidence: &StrategyInputSampleProjectionStorageEvidenceV2,
) -> Result<StrategyInputSampleProjectionReadbackV2, SampleProjectionCustodyErrorV2> {
    let projection: Value = serde_json::from_slice(evidence.projection_row())
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let projection = projection
        .as_object()
        .ok_or(SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let receipt_digest = projection_raw_digest(projection, "receipt_digest")?;
    let subject_identity = projection_raw_digest(projection, "subject_identity")?;
    let custody_digest = projection_raw_digest(projection, "custody_digest")?;
    let kind = projection_raw_u64(projection, "kind").and_then(|value| {
        u8::try_from(value).map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)
    })?;
    let component_count = projection_raw_u64(projection, "component_count").and_then(|value| {
        u32::try_from(value).map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)
    })?;
    let receipt_bytes = projection_raw_bytes_field(projection, "receipt_bytes")?;

    if receipt_digest != expected_digest
        || component_count == 0
        || custody_digest
            != sample_projection_custody_digest_v2(
                receipt_digest,
                kind,
                subject_identity,
                component_count,
                &receipt_bytes,
            )
    {
        return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
    }
    let decoded = decode_strategy_input_sample_projection_v2(&receipt_bytes, receipt_digest)
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;

    if decoded.kind_tag() != kind
        || decoded.subject_identity() != subject_identity
        || decoded.component_count() != component_count
        || decoded.components().len() != evidence.sample_rows().len()
        || decoded.components().len() != evidence.timeframe_rows().len()
    {
        return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
    }

    for ((component, timeframe_row), sample_row) in decoded
        .components()
        .iter()
        .zip(evidence.timeframe_rows())
        .zip(evidence.sample_rows())
    {
        let timeframe: Value = serde_json::from_slice(timeframe_row)
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        let timeframe = timeframe
            .as_object()
            .ok_or(SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        let timeframe_digest = projection_raw_digest(timeframe, "receipt_digest")?;
        let timeframe_binding = projection_raw_digest(timeframe, "binding_receipt_digest")?;
        let timeframe_bytes = projection_raw_bytes_field(timeframe, "receipt_bytes")?;
        let timeframe_custody = projection_raw_digest(timeframe, "custody_digest")?;
        if timeframe_digest != component.timeframe_projection_digest()
            || timeframe_custody
                != projection_custody_digest(timeframe_digest, timeframe_binding, &timeframe_bytes)
        {
            return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
        }
        let timeframe = verify_stored_timeframe_projection_v1(&timeframe_bytes, timeframe_digest)
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;

        let sample: Value = serde_json::from_slice(sample_row)
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        let sample = sample
            .as_object()
            .ok_or(SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        let prepared = PreparedSampleCustodyV1 {
            sample_identity: projection_raw_digest(sample, "sample_identity")?,
            fact_digest: projection_raw_digest(sample, "fact_digest")?,
            series_identity: projection_raw_digest(sample, "series_identity")?,
            series_predecessor_identity: projection_raw_optional_digest(
                sample,
                "series_predecessor_identity",
            )?,
            series_sequence: projection_raw_u64(sample, "series_sequence")?,
            correction_slot_identity: projection_raw_digest(sample, "correction_slot_identity")?,
            correction_predecessor_identity: projection_raw_optional_digest(
                sample,
                "correction_predecessor_identity",
            )?,
            correction_sequence: projection_raw_u64(sample, "correction_sequence")?,
            logical_time: projection_raw_u64(sample, "logical_time")?,
            lineage_version: projection_raw_u64(sample, "lineage_version")?,
            projection_receipt_digest: projection_raw_digest(sample, "projection_receipt_digest")?,
            projection_binding_receipt_digest: projection_raw_digest(
                sample,
                "projection_binding_receipt_digest",
            )?,
            projection_receipt_bytes: projection_raw_bytes_field(
                sample,
                "projection_receipt_bytes",
            )?,
            fact_bytes: projection_raw_bytes_field(sample, "fact_bytes")?,
            receipt_digest: projection_raw_digest(sample, "receipt_digest")?,
            receipt_bytes: projection_raw_bytes_field(sample, "receipt_bytes")?,
            outbox_identity: projection_raw_digest(sample, "outbox_identity")?,
            outbox_payload_digest: projection_raw_digest(sample, "outbox_payload_digest")?,
            outbox_payload_bytes: projection_raw_bytes_field(sample, "outbox_payload_bytes")?,
        };
        validate_prepared_sample(&prepared)
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;

        if prepared.projection_receipt_digest != timeframe_digest
            || prepared.projection_binding_receipt_digest != timeframe_binding
            || prepared.projection_receipt_bytes != timeframe_bytes
            || projection_raw_digest(sample, "projection_custody_digest")?
                != projection_custody_digest(
                    prepared.projection_receipt_digest,
                    prepared.projection_binding_receipt_digest,
                    &prepared.projection_receipt_bytes,
                )
            || projection_raw_digest(sample, "fact_custody_digest")?
                != sample_fact_custody_digest(&prepared)
            || projection_raw_digest(sample, "receipt_custody_digest")?
                != sample_receipt_custody_digest(
                    prepared.sample_identity,
                    prepared.receipt_digest,
                    &prepared.receipt_bytes,
                )
            || projection_raw_digest(sample, "outbox_custody_digest")?
                != sample_outbox_custody_digest(&prepared)
        {
            return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
        }
        let sample = verify_stored_sample_readback_v1(
            &prepared.fact_bytes,
            prepared.fact_digest,
            &prepared.receipt_bytes,
            prepared.receipt_digest,
        )
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        verify_decoded_projection_component_native_v2(component, &timeframe, &sample)
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    }
    Ok(
        StrategyInputSampleProjectionReadbackV2::from_postgres_verified(
            StrategyInputSampleProjectionPostgresProofV2::new(decoded),
        ),
    )
}

fn verify_admitted_sample_projection_v3(
    expected_digest: [u8; 32],
    evidence: &StrategyInputSampleProjectionStorageEvidenceV3,
) -> Result<StrategyInputSampleProjectionReadbackV3, SampleProjectionCustodyErrorV2> {
    let projection: Value = serde_json::from_slice(evidence.projection_row())
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let projection = projection
        .as_object()
        .ok_or(SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let receipt_digest = projection_raw_digest(projection, "receipt_digest")?;
    let subject_identity = projection_raw_digest(projection, "subject_identity")?;
    let custody_digest = projection_raw_digest(projection, "custody_digest")?;
    let kind = u8::try_from(projection_raw_u64(projection, "kind")?)
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let lifecycle = u8::try_from(projection_raw_u64(projection, "lifecycle")?)
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let component_count = u32::try_from(projection_raw_u64(projection, "component_count")?)
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let receipt_bytes = projection_raw_bytes_field(projection, "receipt_bytes")?;
    let decoded = decode_strategy_input_sample_projection_v3(&receipt_bytes, receipt_digest)
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let count = decoded.components().len();

    if receipt_digest != expected_digest
        || kind != 0x01
        || lifecycle != 0x02
        || component_count == 0
        || decoded.kind_tag() != kind
        || decoded.lifecycle_tag() != lifecycle
        || decoded.subject_identity() != subject_identity
        || decoded.component_count() != component_count
        || count != evidence.dependency_rows().len()
        || count != evidence.timeframe_rows().len()
        || count != evidence.sample_rows().len()
        || count != evidence.schedule_rows().len()
        || count != evidence.schedule_history_rows().len()
    {
        return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
    }

    let mut dependencies = Vec::with_capacity(count);

    for (ordinal, raw) in evidence.dependency_rows().iter().enumerate() {
        let value: Value = serde_json::from_slice(raw)
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        let row = value
            .as_object()
            .ok_or(SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        let dependency =
            StoredStrategyInputSampleProjectionScheduleDependencyV3 {
                component_ordinal: u32::try_from(projection_raw_u64_allow_zero(
                    row,
                    "component_ordinal",
                )?)
                .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?,
                role_identity: projection_raw_digest(row, "role_identity")?,
                binding_receipt_digest: projection_raw_digest(row, "binding_receipt_digest")?,
                schedule_readback_identity: BarScheduleIdentity::from_untrusted_bytes(
                    projection_raw_digest(row, "schedule_readback_identity")?,
                ),
                schedule_fact_digest: BarScheduleIdentity::from_untrusted_bytes(
                    projection_raw_digest(row, "schedule_fact_digest")?,
                ),
                schedule_cut_identity: BarScheduleIdentity::from_untrusted_bytes(
                    projection_raw_digest(row, "schedule_cut_identity")?,
                ),
                schedule_cut_digest: BarScheduleIdentity::from_untrusted_bytes(
                    projection_raw_digest(row, "schedule_cut_digest")?,
                ),
                schedule_receipt_identity: BarScheduleIdentity::from_untrusted_bytes(
                    projection_raw_digest(row, "schedule_receipt_identity")?,
                ),
            };
        let component = &decoded.components()[ordinal];
        if dependency.component_ordinal
            != u32::try_from(ordinal)
                .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?
            || dependency.role_identity != component.role_identity()
            || dependency.binding_receipt_digest != component.binding_receipt_digest()
        {
            return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
        }
        dependencies.push(dependency);
    }

    if custody_digest
        != sample_projection_custody_digest_v3(
            receipt_digest,
            kind,
            lifecycle,
            subject_identity,
            component_count,
            &receipt_bytes,
            &dependencies,
        )
    {
        return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
    }

    for (ordinal, (component, dependency)) in
        decoded.components().iter().zip(&dependencies).enumerate()
    {
        let timeframe = verify_admitted_timeframe_row_v1(
            &evidence.timeframe_rows()[ordinal],
            component.timeframe_projection_digest(),
        )?;
        let sample = verify_admitted_sample_row_v1(
            &evidence.sample_rows()[ordinal],
            component.sample_receipt_digest(),
            timeframe.digest(),
        )?;
        verify_decoded_projection_component_native_v3(component, &timeframe, &sample)
            .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        let schedule = verify_bar_schedule_storage_evidence(
            dependency.schedule_readback_identity,
            &evidence.schedule_rows()[ordinal],
            &evidence.schedule_history_rows()[ordinal],
        )
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
        let fact = schedule.fact();
        if fact.digest() != dependency.schedule_fact_digest
            || schedule.cut.identity != dependency.schedule_cut_identity
            || schedule.cut.identity != dependency.schedule_cut_digest
            || schedule.receipt_identity() != dependency.schedule_receipt_identity
            || schedule_timeframe_spec_bytes_v3(fact)? != *timeframe.spec().canonical_bytes()
            || fact.cut_effective_instant() != i128::from(sample.receipt().event_effective())
            || i128::from(sample.receipt().event_effective()) < fact.effective_from()
            || fact
                .effective_until()
                .is_some_and(|until| i128::from(sample.receipt().event_effective()) >= until)
            || fact.market_semantics_identity().as_bytes()
                != &sample.receipt().market_semantics_identity()
            || fact.instrument_master_digest().as_bytes()
                != &sample.fact().instrument_master_digest()
            || fact.schedule_source_frontier().as_bytes() != &sample.fact().source_frontier_digest()
            || fact.schedule_correction_frontier().as_bytes()
                != &sample.fact().correction_frontier_digest()
        {
            return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
        }
    }

    Ok(
        StrategyInputSampleProjectionReadbackV3::from_postgres_verified(
            StrategyInputSampleProjectionPostgresProofV3::new(decoded),
        ),
    )
}

fn verify_admitted_timeframe_row_v1(
    raw: &[u8],
    expected_digest: [u8; 32],
) -> Result<super::sample_fact::TimeframeProjectionReceiptV1, SampleProjectionCustodyErrorV2> {
    let value: Value = serde_json::from_slice(raw)
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let row = value
        .as_object()
        .ok_or(SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let digest = projection_raw_digest(row, "receipt_digest")?;
    let binding = projection_raw_digest(row, "binding_receipt_digest")?;
    let bytes = projection_raw_bytes_field(row, "receipt_bytes")?;
    let custody = projection_raw_digest(row, "custody_digest")?;
    if digest != expected_digest || custody != projection_custody_digest(digest, binding, &bytes) {
        return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
    }
    verify_stored_timeframe_projection_v1(&bytes, digest)
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)
}

fn verify_admitted_sample_row_v1(
    raw: &[u8],
    expected_receipt_digest: [u8; 32],
    expected_projection_digest: [u8; 32],
) -> Result<StoredSampleReadbackV1, SampleProjectionCustodyErrorV2> {
    let value: Value = serde_json::from_slice(raw)
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let row = value
        .as_object()
        .ok_or(SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    let prepared = PreparedSampleCustodyV1 {
        sample_identity: projection_raw_digest(row, "sample_identity")?,
        fact_digest: projection_raw_digest(row, "fact_digest")?,
        series_identity: projection_raw_digest(row, "series_identity")?,
        series_predecessor_identity: projection_raw_optional_digest(
            row,
            "series_predecessor_identity",
        )?,
        series_sequence: projection_raw_u64(row, "series_sequence")?,
        correction_slot_identity: projection_raw_digest(row, "correction_slot_identity")?,
        correction_predecessor_identity: projection_raw_optional_digest(
            row,
            "correction_predecessor_identity",
        )?,
        correction_sequence: projection_raw_u64(row, "correction_sequence")?,
        logical_time: projection_raw_u64(row, "logical_time")?,
        lineage_version: projection_raw_u64(row, "lineage_version")?,
        projection_receipt_digest: projection_raw_digest(row, "projection_receipt_digest")?,
        projection_binding_receipt_digest: projection_raw_digest(
            row,
            "projection_binding_receipt_digest",
        )?,
        projection_receipt_bytes: projection_raw_bytes_field(row, "projection_receipt_bytes")?,
        fact_bytes: projection_raw_bytes_field(row, "fact_bytes")?,
        receipt_digest: projection_raw_digest(row, "receipt_digest")?,
        receipt_bytes: projection_raw_bytes_field(row, "receipt_bytes")?,
        outbox_identity: projection_raw_digest(row, "outbox_identity")?,
        outbox_payload_digest: projection_raw_digest(row, "outbox_payload_digest")?,
        outbox_payload_bytes: projection_raw_bytes_field(row, "outbox_payload_bytes")?,
    };
    validate_prepared_sample(&prepared)
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)?;

    if prepared.receipt_digest != expected_receipt_digest
        || prepared.projection_receipt_digest != expected_projection_digest
        || projection_raw_digest(row, "projection_custody_digest")?
            != projection_custody_digest(
                prepared.projection_receipt_digest,
                prepared.projection_binding_receipt_digest,
                &prepared.projection_receipt_bytes,
            )
        || projection_raw_digest(row, "fact_custody_digest")?
            != sample_fact_custody_digest(&prepared)
        || projection_raw_digest(row, "receipt_custody_digest")?
            != sample_receipt_custody_digest(
                prepared.sample_identity,
                prepared.receipt_digest,
                &prepared.receipt_bytes,
            )
        || projection_raw_digest(row, "outbox_custody_digest")?
            != sample_outbox_custody_digest(&prepared)
    {
        return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
    }
    verify_stored_sample_readback_v1(
        &prepared.fact_bytes,
        prepared.fact_digest,
        &prepared.receipt_bytes,
        prepared.receipt_digest,
    )
    .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)
}

fn projection_raw_u64(
    object: &serde_json::Map<String, Value>,
    field: &'static str,
) -> Result<u64, SampleProjectionCustodyErrorV2> {
    object
        .get(field)
        .and_then(Value::as_u64)
        .filter(|value| *value != 0)
        .ok_or(SampleProjectionCustodyErrorV2::StoreUnavailable)
}

fn projection_raw_u64_allow_zero(
    object: &serde_json::Map<String, Value>,
    field: &'static str,
) -> Result<u64, SampleProjectionCustodyErrorV2> {
    object
        .get(field)
        .and_then(Value::as_u64)
        .ok_or(SampleProjectionCustodyErrorV2::StoreUnavailable)
}

fn projection_raw_digest(
    object: &serde_json::Map<String, Value>,
    field: &'static str,
) -> Result<[u8; 32], SampleProjectionCustodyErrorV2> {
    projection_raw_bytes_field(object, field)?
        .try_into()
        .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)
}

fn projection_raw_optional_digest(
    object: &serde_json::Map<String, Value>,
    field: &'static str,
) -> Result<Option<[u8; 32]>, SampleProjectionCustodyErrorV2> {
    match object.get(field) {
        Some(Value::Null) => Ok(None),
        Some(_) => projection_raw_digest(object, field).map(Some),
        None => Err(SampleProjectionCustodyErrorV2::StoreUnavailable),
    }
}

fn projection_raw_bytes_field(
    object: &serde_json::Map<String, Value>,
    field: &'static str,
) -> Result<Vec<u8>, SampleProjectionCustodyErrorV2> {
    let encoded = object
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| value.strip_prefix("\\x"))
        .ok_or(SampleProjectionCustodyErrorV2::StoreUnavailable)?;
    if encoded.len() % 2 != 0 {
        return Err(SampleProjectionCustodyErrorV2::StoreUnavailable);
    }
    (0..encoded.len())
        .step_by(2)
        .map(|offset| {
            u8::from_str_radix(&encoded[offset..offset + 2], 16)
                .map_err(|_| SampleProjectionCustodyErrorV2::StoreUnavailable)
        })
        .collect()
}

#[cfg(not(test))]
fn verify_admitted_source_evidence(
    locator: &UntrustedSourceBindingLocator,
    evidence: &MarketDataSourceBindingStorageEvidence,
) -> Result<SourceBindingOwnerReadback, SourceBindingError> {
    if !evidence.admission_receipt_identity().starts_with("sha256:") {
        return Err(SourceBindingError::StoreUnavailable);
    }
    verify_admitted_source_rows(
        locator,
        evidence.lineage_rows(),
        evidence.clock_rows(),
        true,
    )
}

fn verify_admitted_source_rows(
    locator: &UntrustedSourceBindingLocator,
    lineage_rows: &[Vec<u8>],
    clock_rows: &[Vec<u8>],
    require_current_head: bool,
) -> Result<SourceBindingOwnerReadback, SourceBindingError> {
    let mut prior = None;
    let mut selected = None;
    let mut terminal_aggregate = None;

    for (offset, raw) in lineage_rows.iter().enumerate() {
        let envelope = decode_raw_source_envelope(raw)?;
        let aggregate: SourceBindingStoredAggregate = serde_json::from_value(envelope.aggregate)
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        let fact = aggregate.commit().fact();
        let expected_version = u64::try_from(offset)
            .ok()
            .and_then(|value| value.checked_add(1))
            .ok_or(SourceBindingError::StoreUnavailable)?;

        if !verify_source_native(&aggregate, &envelope.native, false)
            || fact.lineage_version() != expected_version
        {
            return Err(SourceBindingError::StoreUnavailable);
        }

        match prior {
            None if fact.binding_id() == fact.lineage_root()
                && fact.predecessor_binding_id().is_none()
                && fact.predecessor_fact_digest().is_none() => {}
            Some((identity, digest))
                if fact.predecessor_binding_id() == Some(identity)
                    && fact.predecessor_fact_digest() == Some(digest) => {}
            _ => return Err(SourceBindingError::StoreUnavailable),
        }

        if aggregate.commit().receipt().locator() == locator {
            selected = Some(aggregate.clone());
        }
        prior = Some((fact.binding_id(), fact.digest()));
        terminal_aggregate = Some(aggregate);
    }
    let aggregate = selected.ok_or(SourceBindingError::LocatorMismatch)?;
    let terminal = lineage_rows
        .last()
        .ok_or(SourceBindingError::StoreUnavailable)?;
    let terminal = decode_raw_source_envelope(terminal)?;
    let terminal_aggregate = terminal_aggregate.ok_or(SourceBindingError::StoreUnavailable)?;

    if !terminal
        .native
        .head
        .matches_source(terminal_aggregate.commit().fact())
        || (require_current_head
            && aggregate.commit().fact().binding_id()
                != terminal_aggregate.commit().fact().binding_id())
        || aggregate.commit().receipt().locator() != locator
    {
        return Err(SourceBindingError::LocatorMismatch);
    }
    let expected_clock = clock_for_source_time(aggregate.commit().fact().time_evidence());
    let historical_clock = clock_rows
        .iter()
        .find_map(|raw| {
            decode_raw_clock(raw)
                .ok()
                .filter(|clock| clock == &expected_clock)
        })
        .ok_or(SourceBindingError::TrustedClockMismatch)?;
    validate_clock_for_readback(aggregate.commit().fact().time_evidence(), &historical_clock)?;
    Ok(SourceBindingOwnerReadback::from_verified(&aggregate))
}

fn verify_admitted_pit_evidence(
    locator: &UntrustedPitSnapshotLocator,
    evidence: &MarketDataPitEvaluationStorageEvidence,
) -> Result<VerifiedPitObservationBatch, PitSnapshotError> {
    if !evidence.admission_receipt_identity().starts_with("sha256:") {
        return Err(PitSnapshotError::PersistenceUnavailable);
    }
    let mut prior = None;
    let mut selected = None;
    let mut terminal = None;

    for (offset, raw) in evidence.pit_lineage_rows().iter().enumerate() {
        let envelope = decode_raw_pit_envelope(raw)?;
        let aggregate: PitSnapshotCommitAggregate = serde_json::from_value(envelope.aggregate)
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let fact = aggregate.fact();
        let expected_version = u64::try_from(offset)
            .ok()
            .and_then(|value| value.checked_add(1))
            .ok_or(PitSnapshotError::PersistenceUnavailable)?;

        if !verify_pit_native(&aggregate, &envelope.native, false)
            || fact.lineage_version() != expected_version
        {
            return Err(PitSnapshotError::PersistenceUnavailable);
        }

        match prior {
            None if fact.snapshot_identity() == fact.lineage_root()
                && fact.predecessor_snapshot_identity().is_none()
                && fact.predecessor_fact_digest().is_none() => {}
            Some((identity, digest))
                if fact.predecessor_snapshot_identity() == Some(identity)
                    && fact.predecessor_fact_digest() == Some(digest) => {}
            _ => return Err(PitSnapshotError::PersistenceUnavailable),
        }

        if aggregate.receipt().locator() == locator {
            selected = Some(aggregate.clone());
        }
        prior = Some((fact.snapshot_identity(), fact.digest()));
        terminal = Some((aggregate, envelope.native.head));
    }
    let (terminal, head) = terminal.ok_or(PitSnapshotError::PersistenceUnavailable)?;
    if head.lineage_root != terminal.fact().lineage_root()
        || head.identity != terminal.fact().snapshot_identity()
        || head.fact_digest != terminal.fact().digest()
        || head.lineage_version != terminal.fact().lineage_version()
    {
        return Err(PitSnapshotError::PersistenceUnavailable);
    }
    let aggregate = selected.ok_or(PitSnapshotError::LocatorMismatch)?;
    verify_admitted_source_rows(
        &aggregate.fact().request().source_binding,
        evidence.source_lineage_rows(),
        evidence.clock_rows(),
        false,
    )
    .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?;
    let expected_clock = clock_for_pit_time(&aggregate.fact().request().time_evidence);
    let historical_clock = evidence
        .clock_rows()
        .iter()
        .find_map(|raw| {
            decode_raw_clock(raw)
                .ok()
                .filter(|clock| clock == &expected_clock)
        })
        .ok_or(PitSnapshotError::TrustedClockMismatch)?;
    super::pit_snapshot::authority::validate_read_clock(
        &aggregate.fact().request().time_evidence,
        &historical_clock,
    )?;
    verify_observation_batch(
        &aggregate,
        BindingDigest::from_untrusted_bytes(*evidence.batch_source_binding_identity()),
        BindingDigest::from_untrusted_bytes(*evidence.batch_source_binding_lineage_root()),
        evidence.batch_source_binding_lineage_version(),
        BindingDigest::from_untrusted_bytes(*evidence.batch_digest()),
        evidence.batch_bytes(),
        &evidence
            .batch_rows()
            .iter()
            .map(|row| ObservedPitObservationNativeRow {
                ordinal: row.ordinal(),
                symbolic_key: row.symbolic_key().to_string(),
                member_key: row.member_key().to_string(),
                row_bytes: row.row_bytes().to_vec(),
            })
            .collect::<Vec<_>>(),
    )
}

pub(super) fn verify_admitted_pit_evidence_by_identity_v1(
    snapshot_identity: BindingDigest,
    fact_digest: BindingDigest,
    evidence: &MarketDataPitEvaluationStorageEvidence,
) -> Result<VerifiedPitObservationBatch, PitSnapshotError> {
    let mut selected = None;

    for raw in evidence.pit_lineage_rows() {
        let envelope = decode_raw_pit_envelope(raw)?;
        let aggregate: PitSnapshotCommitAggregate = serde_json::from_value(envelope.aggregate)
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;

        if aggregate.fact().snapshot_identity() == snapshot_identity
            && aggregate.fact().digest() == fact_digest
            && selected
                .replace(aggregate.receipt().locator().clone())
                .is_some()
        {
            return Err(PitSnapshotError::PersistenceUnavailable);
        }
    }
    let locator = selected.ok_or(PitSnapshotError::LocatorMismatch)?;
    verify_admitted_pit_evidence(&locator, evidence)
}

#[cfg(not(test))]
fn verify_admitted_current_pit_evidence(
    locator: &UntrustedPitSnapshotLocator,
    evidence: &MarketDataPitEvaluationStorageEvidence,
) -> Result<
    (
        PitSnapshotCommitAggregate,
        SourceBindingStoredAggregate,
        VerifiedPitObservationBatch,
    ),
    PitSnapshotError,
> {
    if !evidence.admission_receipt_identity().starts_with("sha256:") {
        return Err(PitSnapshotError::PersistenceUnavailable);
    }
    let mut prior = None;
    let mut selected = None;
    let mut terminal = None;

    for (offset, raw) in evidence.pit_lineage_rows().iter().enumerate() {
        let envelope = decode_raw_pit_envelope(raw)?;
        let aggregate: PitSnapshotCommitAggregate = serde_json::from_value(envelope.aggregate)
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let fact = aggregate.fact();
        let expected_version = u64::try_from(offset)
            .ok()
            .and_then(|value| value.checked_add(1))
            .ok_or(PitSnapshotError::PersistenceUnavailable)?;

        if !verify_pit_native(&aggregate, &envelope.native, false)
            || fact.lineage_version() != expected_version
        {
            return Err(PitSnapshotError::PersistenceUnavailable);
        }

        match prior {
            None if fact.snapshot_identity() == fact.lineage_root()
                && fact.predecessor_snapshot_identity().is_none()
                && fact.predecessor_fact_digest().is_none() => {}
            Some((identity, digest))
                if fact.predecessor_snapshot_identity() == Some(identity)
                    && fact.predecessor_fact_digest() == Some(digest) => {}
            _ => return Err(PitSnapshotError::PersistenceUnavailable),
        }

        if aggregate.receipt().locator() == locator {
            selected = Some(aggregate.clone());
        }
        prior = Some((fact.snapshot_identity(), fact.digest()));
        terminal = Some((aggregate, envelope.native.head));
    }

    let (terminal, head) = terminal.ok_or(PitSnapshotError::PersistenceUnavailable)?;
    if head.lineage_root != terminal.fact().lineage_root()
        || head.identity != terminal.fact().snapshot_identity()
        || head.fact_digest != terminal.fact().digest()
        || head.lineage_version != terminal.fact().lineage_version()
    {
        return Err(PitSnapshotError::PersistenceUnavailable);
    }
    let selected = selected.ok_or(PitSnapshotError::LocatorMismatch)?;
    if selected.fact().snapshot_identity() != terminal.fact().snapshot_identity() {
        return Err(PitSnapshotError::CorrectionHeadMismatch);
    }
    let source = verify_terminal_source_rows(
        &selected.fact().request().source_binding,
        evidence.source_lineage_rows(),
        evidence.clock_rows(),
    )?;
    let expected_clock = clock_for_pit_time(&selected.fact().request().time_evidence);
    let historical_clock = evidence
        .clock_rows()
        .iter()
        .find_map(|raw| {
            decode_raw_clock(raw)
                .ok()
                .filter(|clock| clock == &expected_clock)
        })
        .ok_or(PitSnapshotError::TrustedClockMismatch)?;
    super::pit_snapshot::authority::validate_read_clock(
        &selected.fact().request().time_evidence,
        &historical_clock,
    )?;
    let batch = verify_observation_batch(
        &selected,
        BindingDigest::from_untrusted_bytes(*evidence.batch_source_binding_identity()),
        BindingDigest::from_untrusted_bytes(*evidence.batch_source_binding_lineage_root()),
        evidence.batch_source_binding_lineage_version(),
        BindingDigest::from_untrusted_bytes(*evidence.batch_digest()),
        evidence.batch_bytes(),
        &evidence
            .batch_rows()
            .iter()
            .map(|row| ObservedPitObservationNativeRow {
                ordinal: row.ordinal(),
                symbolic_key: row.symbolic_key().to_string(),
                member_key: row.member_key().to_string(),
                row_bytes: row.row_bytes().to_vec(),
            })
            .collect::<Vec<_>>(),
    )?;
    Ok((selected, source, batch))
}

#[cfg(not(test))]
fn verify_admitted_pit_terminal_evidence(
    request: &UntrustedResearchPitTerminalRequest,
    evidence: &MarketDataPitTerminalStorageEvidence,
) -> Result<ResearchPitTerminal, PitSnapshotError> {
    if !evidence.admission_receipt_identity().starts_with("sha256:") {
        return Err(PitSnapshotError::PersistenceUnavailable);
    }
    let mut prior = None;
    let mut selected = None;
    let mut terminal = None;

    for (offset, raw) in evidence.pit_lineage_rows().iter().enumerate() {
        let envelope = decode_raw_pit_envelope(raw)?;
        let aggregate: PitSnapshotCommitAggregate = serde_json::from_value(envelope.aggregate)
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let fact = aggregate.fact();
        let expected_version = u64::try_from(offset)
            .ok()
            .and_then(|value| value.checked_add(1))
            .ok_or(PitSnapshotError::PersistenceUnavailable)?;

        if !verify_pit_native(&aggregate, &envelope.native, false)
            || fact.lineage_version() != expected_version
        {
            return Err(PitSnapshotError::PersistenceUnavailable);
        }

        match prior {
            None if fact.snapshot_identity() == fact.lineage_root()
                && fact.predecessor_snapshot_identity().is_none()
                && fact.predecessor_fact_digest().is_none() => {}
            Some((identity, digest))
                if fact.predecessor_snapshot_identity() == Some(identity)
                    && fact.predecessor_fact_digest() == Some(digest) => {}
            _ => return Err(PitSnapshotError::PersistenceUnavailable),
        }

        if aggregate.receipt().locator() == &request.locator {
            selected = Some(aggregate.clone());
        }
        prior = Some((fact.snapshot_identity(), fact.digest()));
        terminal = Some((aggregate, envelope.native.head));
    }
    let (terminal, head) = terminal.ok_or(PitSnapshotError::PersistenceUnavailable)?;
    if head.lineage_root != terminal.fact().lineage_root()
        || head.identity != terminal.fact().snapshot_identity()
        || head.fact_digest != terminal.fact().digest()
        || head.lineage_version != terminal.fact().lineage_version()
    {
        return Err(PitSnapshotError::PersistenceUnavailable);
    }
    let selected = selected.ok_or(PitSnapshotError::LocatorMismatch)?;
    if selected.fact().snapshot_identity() != terminal.fact().snapshot_identity() {
        return Err(PitSnapshotError::CorrectionHeadMismatch);
    }
    let source = verify_terminal_source_rows(
        &selected.fact().request().source_binding,
        evidence.source_lineage_rows(),
        evidence.clock_rows(),
    )?;
    let expected_clock = clock_for_pit_time(&selected.fact().request().time_evidence);
    let historical_clock = evidence
        .clock_rows()
        .iter()
        .find_map(|raw| {
            decode_raw_clock(raw)
                .ok()
                .filter(|clock| clock == &expected_clock)
        })
        .ok_or(PitSnapshotError::TrustedClockMismatch)?;
    super::pit_snapshot::authority::validate_read_clock(
        &selected.fact().request().time_evidence,
        &historical_clock,
    )?;
    seal_research_pit_terminal(&selected, &source, request)
}

#[cfg(not(test))]
fn verify_terminal_source_rows(
    locator: &UntrustedSourceBindingLocator,
    rows: &[Vec<u8>],
    clock_rows: &[Vec<u8>],
) -> Result<SourceBindingStoredAggregate, PitSnapshotError> {
    let mut lineage = rows
        .iter()
        .map(|raw| {
            let envelope = decode_raw_source_envelope(raw)
                .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?;
            let aggregate: SourceBindingStoredAggregate =
                serde_json::from_value(envelope.aggregate)
                    .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?;
            Ok((aggregate, envelope.native))
        })
        .collect::<Result<Vec<_>, PitSnapshotError>>()?;
    lineage
        .retain(|(aggregate, _)| aggregate.commit().fact().lineage_root() == locator.lineage_root);
    lineage.sort_by_key(|(aggregate, _)| aggregate.commit().fact().lineage_version());
    if lineage.is_empty() {
        return Err(PitSnapshotError::SourceBindingUnavailable);
    }
    let mut prior = None;
    let mut selected = None;

    for (offset, (aggregate, native)) in lineage.iter().enumerate() {
        let fact = aggregate.commit().fact();
        let expected_version = u64::try_from(offset)
            .ok()
            .and_then(|value| value.checked_add(1))
            .ok_or(PitSnapshotError::SourceBindingUnavailable)?;

        if !verify_source_native(aggregate, native, false)
            || fact.lineage_version() != expected_version
        {
            return Err(PitSnapshotError::SourceBindingUnavailable);
        }

        match prior {
            None if fact.binding_id() == fact.lineage_root()
                && fact.predecessor_binding_id().is_none()
                && fact.predecessor_fact_digest().is_none() => {}
            Some((identity, digest))
                if fact.predecessor_binding_id() == Some(identity)
                    && fact.predecessor_fact_digest() == Some(digest) => {}
            _ => return Err(PitSnapshotError::SourceBindingUnavailable),
        }

        if aggregate.commit().receipt().locator() == locator {
            selected = Some(aggregate.clone());
        }
        prior = Some((fact.binding_id(), fact.digest()));
    }
    let selected = selected.ok_or(PitSnapshotError::SourceBindingUnavailable)?;
    let (terminal, native) = lineage
        .last()
        .ok_or(PitSnapshotError::SourceBindingUnavailable)?;

    if selected.commit().fact().binding_id() != terminal.commit().fact().binding_id()
        || !native.head.matches_source(terminal.commit().fact())
    {
        return Err(PitSnapshotError::SourceBindingUnavailable);
    }
    let expected_clock = clock_for_source_time(selected.commit().fact().time_evidence());
    let historical_clock = clock_rows
        .iter()
        .find_map(|raw| {
            decode_raw_clock(raw)
                .ok()
                .filter(|clock| clock == &expected_clock)
        })
        .ok_or(PitSnapshotError::TrustedClockMismatch)?;
    validate_clock_for_readback(selected.commit().fact().time_evidence(), &historical_clock)
        .map_err(|_| PitSnapshotError::TrustedClockMismatch)?;
    Ok(selected)
}

fn decode_raw_source_envelope(raw: &[u8]) -> Result<StoredEnvelope, SourceBindingError> {
    let value: Value =
        serde_json::from_slice(raw).map_err(|_| SourceBindingError::StoreUnavailable)?;
    let object = value
        .as_object()
        .ok_or(SourceBindingError::StoreUnavailable)?;
    let digest = |name| {
        raw_digest(
            object
                .get(name)
                .ok_or(SourceBindingError::StoreUnavailable)?,
        )
    };
    let positive = |name| {
        raw_positive(
            object
                .get(name)
                .ok_or(SourceBindingError::StoreUnavailable)?,
        )
    };
    Ok(StoredEnvelope {
        aggregate: object
            .get("aggregate_json")
            .cloned()
            .ok_or(SourceBindingError::StoreUnavailable)?,
        native: NativeIndex {
            row_identity: digest("row_identity")?,
            fact_digest: digest("fact_digest")?,
            request_identity: None,
            request_digest: None,
            correction_stream_identity: None,
            correction_sequence: None,
            fact_lineage_root: digest("fact_lineage_root")?,
            fact_lineage_version: positive("fact_lineage_version")?,
            outbox_event_identity: digest("outbox_event_identity")?,
            outbox_aggregate_identity: digest("outbox_aggregate_identity")?,
            outbox_payload: raw_bytes(
                object
                    .get("outbox_payload")
                    .ok_or(SourceBindingError::StoreUnavailable)?,
            )?,
            outbox_digest: digest("outbox_digest")?,
            head: NativeHead {
                lineage_root: digest("head_lineage_root")?,
                identity: digest("head_identity")?,
                fact_digest: digest("head_digest")?,
                lineage_version: positive("head_version")?,
            },
        },
    })
}

fn decode_raw_pit_envelope(raw: &[u8]) -> Result<StoredEnvelope, PitSnapshotError> {
    let value: Value =
        serde_json::from_slice(raw).map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
    let object = value
        .as_object()
        .ok_or(PitSnapshotError::PersistenceUnavailable)?;
    let required = |name| {
        object
            .get(name)
            .ok_or(PitSnapshotError::PersistenceUnavailable)
    };
    let digest =
        |name| raw_digest(required(name)?).map_err(|_| PitSnapshotError::PersistenceUnavailable);
    let positive =
        |name| raw_positive(required(name)?).map_err(|_| PitSnapshotError::PersistenceUnavailable);
    Ok(StoredEnvelope {
        aggregate: required("aggregate_json")?.clone(),
        native: NativeIndex {
            row_identity: digest("row_identity")?,
            fact_digest: digest("fact_digest")?,
            request_identity: Some(digest("request_identity")?),
            request_digest: Some(digest("request_digest")?),
            correction_stream_identity: Some(
                required("correction_stream_identity")?
                    .as_str()
                    .map(str::to_owned)
                    .ok_or(PitSnapshotError::PersistenceUnavailable)?,
            ),
            correction_sequence: Some(positive("correction_sequence")?),
            fact_lineage_root: digest("fact_lineage_root")?,
            fact_lineage_version: positive("fact_lineage_version")?,
            outbox_event_identity: digest("outbox_event_identity")?,
            outbox_aggregate_identity: digest("outbox_aggregate_identity")?,
            outbox_payload: raw_bytes(required("outbox_payload")?)
                .map_err(|_| PitSnapshotError::PersistenceUnavailable)?,
            outbox_digest: digest("outbox_digest")?,
            head: NativeHead {
                lineage_root: digest("head_lineage_root")?,
                identity: digest("head_identity")?,
                fact_digest: digest("head_digest")?,
                lineage_version: positive("head_version")?,
            },
        },
    })
}

fn decode_raw_clock(raw: &[u8]) -> Result<MarketDataClockAdmission, SourceBindingError> {
    Ok(decode_raw_clock_fact(raw)?.clock())
}

fn decode_raw_clock_fact(raw: &[u8]) -> Result<ClockHeadFact, SourceBindingError> {
    let value: Value =
        serde_json::from_slice(raw).map_err(|_| SourceBindingError::StoreUnavailable)?;
    let object = value
        .as_object()
        .ok_or(SourceBindingError::StoreUnavailable)?;
    let string = |name| {
        object
            .get(name)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or(SourceBindingError::StoreUnavailable)
    };
    let positive = |name| {
        raw_positive(
            object
                .get(name)
                .ok_or(SourceBindingError::StoreUnavailable)?,
        )
    };

    if object.get("comparison_rule").and_then(Value::as_i64) != Some(1) {
        return Err(SourceBindingError::StoreUnavailable);
    }
    let clock = MarketDataClockAdmission {
        cut_kind: super::source_binding::MarketDataClockCutKind::MarketDataAsOf,
        clock_identity: string("clock_identity")?,
        clock_epoch: string("clock_epoch")?,
        monotonic_sequence: positive("monotonic_sequence")?,
        wall_observed: positive("wall_observed")?,
        decision_cut: positive("decision_cut")?,
        valid_through: positive("valid_through")?,
        restart_continuity_digest: raw_digest(
            object
                .get("restart_continuity_digest")
                .ok_or(SourceBindingError::StoreUnavailable)?,
        )?,
        uncertainty_bound: object
            .get("uncertainty_bound")
            .and_then(Value::as_u64)
            .ok_or(SourceBindingError::StoreUnavailable)?,
        skew_bound: positive("skew_bound")?,
        comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
    };
    let predecessor = object
        .get("predecessor_head_digest")
        .filter(|value| !value.is_null())
        .map(raw_digest)
        .transpose()?;
    let fact = build_head_fact(&clock, predecessor)
        .map_err(|_| SourceBindingError::TrustedClockMismatch)?;

    if fact.handoff.head_identity()
        != raw_digest(
            object
                .get("head_identity")
                .ok_or(SourceBindingError::StoreUnavailable)?,
        )?
        || fact.handoff.head_digest()
            != raw_digest(
                object
                    .get("head_digest")
                    .ok_or(SourceBindingError::StoreUnavailable)?,
            )?
        || !verify_head_fact(&fact)
    {
        return Err(SourceBindingError::TrustedClockMismatch);
    }
    Ok(fact)
}

fn decode_raw_clock_membership(
    raw: &[u8],
) -> Result<(usize, ClockMembership), SharedTimeEvidenceError> {
    let value: Value =
        serde_json::from_slice(raw).map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let object = value
        .as_object()
        .ok_or(SharedTimeEvidenceError::StoreUnavailable)?;
    let count = object
        .get("handoff_count")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value != 0)
        .ok_or(SharedTimeEvidenceError::StoreUnavailable)?;
    let digest = |name| {
        raw_digest(
            object
                .get(name)
                .ok_or(SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)
    };
    let prior_identity = object
        .get("prior_head_identity")
        .filter(|value| !value.is_null())
        .map(raw_digest)
        .transpose()
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    Ok((
        count,
        ClockMembership {
            identity: digest("head_identity")?,
            root_identity: digest("root_head_identity")?,
            ordinal: object
                .get("ordinal")
                .and_then(Value::as_u64)
                .filter(|value| *value != 0)
                .ok_or(SharedTimeEvidenceError::StoreUnavailable)?,
            prior_identity,
        },
    ))
}

fn decode_raw_epoch_proof(raw: &[u8]) -> Result<EpochSuccessorProof, SharedTimeEvidenceError> {
    let value: Value =
        serde_json::from_slice(raw).map_err(|_| SharedTimeEvidenceError::StoreUnavailable)?;
    let object = value
        .as_object()
        .ok_or(SharedTimeEvidenceError::StoreUnavailable)?;
    let digest = |name| {
        raw_digest(
            object
                .get(name)
                .ok_or(SharedTimeEvidenceError::StoreUnavailable)?,
        )
        .map_err(|_| SharedTimeEvidenceError::StoreUnavailable)
    };
    let string = |name| {
        object
            .get(name)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or(SharedTimeEvidenceError::StoreUnavailable)
    };

    if object.get("comparison_rule").and_then(Value::as_i64) != Some(1) {
        return Err(SharedTimeEvidenceError::StoreUnavailable);
    }
    Ok(EpochSuccessorProof {
        proof_identity: digest("proof_identity")?,
        predecessor_head_digest: digest("predecessor_head_digest")?,
        successor_head_digest: digest("successor_head_digest")?,
        prior_clock_identity: string("prior_clock_identity")?,
        prior_clock_epoch: string("prior_clock_epoch")?,
        successor_clock_identity: string("successor_clock_identity")?,
        successor_clock_epoch: string("successor_clock_epoch")?,
        successor_continuity_digest: digest("successor_continuity_digest")?,
        commit_cut: object
            .get("commit_cut")
            .and_then(Value::as_u64)
            .filter(|value| *value != 0)
            .ok_or(SharedTimeEvidenceError::StoreUnavailable)?,
        comparison_rule:
            super::shared_time_evidence::ClockHeadComparisonRule::ExclusiveValidThrough,
    })
}

fn raw_positive(value: &Value) -> Result<u64, SourceBindingError> {
    value
        .as_u64()
        .filter(|value| *value != 0)
        .ok_or(SourceBindingError::StoreUnavailable)
}

fn raw_digest(value: &Value) -> Result<BindingDigest, SourceBindingError> {
    let bytes = raw_bytes(value)?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| SourceBindingError::StoreUnavailable)?;
    Ok(BindingDigest::from_untrusted_bytes(bytes))
}

fn raw_bytes(value: &Value) -> Result<Vec<u8>, SourceBindingError> {
    let encoded = value
        .as_str()
        .and_then(|value| value.strip_prefix("\\x"))
        .ok_or(SourceBindingError::StoreUnavailable)?;
    if encoded.len() % 2 != 0 {
        return Err(SourceBindingError::StoreUnavailable);
    }
    (0..encoded.len())
        .step_by(2)
        .map(|offset| {
            u8::from_str_radix(&encoded[offset..offset + 2], 16)
                .map_err(|_| SourceBindingError::StoreUnavailable)
        })
        .collect()
}

async fn validate_source_read_custody(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &UntrustedSourceBindingLocator,
) -> Result<(), PitSnapshotError> {
    validate_source_lineage_shape(transaction, locator.lineage_root)
        .await
        .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?;
    let historical = load_envelope(
        transaction,
        "SELECT * FROM market_data_private.resolve_source_binding_v1($1)",
        locator.binding_id,
    )
    .await
    .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?
    .ok_or(PitSnapshotError::SourceBindingUnavailable)?;
    let historical_aggregate: SourceBindingStoredAggregate =
        serde_json::from_value(historical.aggregate)
            .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?;

    if !verify_source_native(&historical_aggregate, &historical.native, false)
        || historical_aggregate.commit().receipt().locator() != locator
    {
        return Err(PitSnapshotError::SourceBindingUnavailable);
    }

    let current = load_envelope(
        transaction,
        "SELECT * FROM market_data_private.resolve_source_binding_v1($1)",
        historical.native.head.identity,
    )
    .await
    .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?
    .ok_or(PitSnapshotError::SourceBindingUnavailable)?;
    let current_aggregate: SourceBindingStoredAggregate = serde_json::from_value(current.aggregate)
        .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?;
    if !verify_source_native(&current_aggregate, &current.native, true) {
        return Err(PitSnapshotError::SourceBindingUnavailable);
    }
    Ok(())
}

struct NativeIndex {
    row_identity: BindingDigest,
    fact_digest: BindingDigest,
    request_identity: Option<BindingDigest>,
    request_digest: Option<BindingDigest>,
    correction_stream_identity: Option<String>,
    correction_sequence: Option<u64>,
    fact_lineage_root: BindingDigest,
    fact_lineage_version: u64,
    outbox_event_identity: BindingDigest,
    outbox_aggregate_identity: BindingDigest,
    outbox_payload: Vec<u8>,
    outbox_digest: BindingDigest,
    head: NativeHead,
}

struct NativeHead {
    lineage_root: BindingDigest,
    identity: BindingDigest,
    fact_digest: BindingDigest,
    lineage_version: u64,
}

impl NativeHead {
    fn matches_source(&self, fact: &super::source_binding::authority::SourceBindingFact) -> bool {
        self.lineage_root == fact.lineage_root()
            && self.identity == fact.binding_id()
            && self.fact_digest == fact.digest()
            && self.lineage_version == fact.lineage_version()
    }

    fn matches_pit_identity(
        &self,
        predecessor: BindingDigest,
        successor: &super::pit_snapshot::PitSnapshotFact,
    ) -> bool {
        self.lineage_root == successor.lineage_root()
            && self.identity == predecessor
            && Some(self.fact_digest) == successor.predecessor_fact_digest()
            && self.lineage_version.checked_add(1) == Some(successor.lineage_version())
    }

    fn matches_source_locator(&self, locator: &UntrustedSourceBindingLocator) -> bool {
        self.lineage_root == locator.lineage_root
            && self.identity == locator.binding_id
            && self.fact_digest == locator.fact_digest
            && self.lineage_version == locator.lineage_version
    }
}

fn verify_source_native(
    aggregate: &SourceBindingStoredAggregate,
    native: &NativeIndex,
    require_current_head: bool,
) -> bool {
    let fact = aggregate.commit().fact();
    verify_source_aggregate(aggregate)
        && native.row_identity == fact.binding_id()
        && native.fact_digest == fact.digest()
        && native.request_identity.is_none()
        && native.request_digest.is_none()
        && native.correction_stream_identity.is_none()
        && native.correction_sequence.is_none()
        && native.fact_lineage_root == fact.lineage_root()
        && native.fact_lineage_version == fact.lineage_version()
        && native.outbox_event_identity == aggregate.outbox().digest()
        && native.outbox_aggregate_identity == fact.binding_id()
        && native.outbox_payload == aggregate.outbox().payload()
        && native.outbox_digest == aggregate.outbox().digest()
        && native.head.lineage_root == fact.lineage_root()
        && native.head.lineage_version >= fact.lineage_version()
        && (!require_current_head || native.head.matches_source(fact))
}

fn verify_pit_native(
    aggregate: &PitSnapshotCommitAggregate,
    native: &NativeIndex,
    require_current_head: bool,
) -> bool {
    let fact = aggregate.fact();
    let correction = &fact.evidence().correction_frontier;
    verify_pit_aggregate(aggregate)
        && native.row_identity == fact.snapshot_identity()
        && native.fact_digest == fact.digest()
        && native.request_identity == Some(fact.request_identity())
        && native.request_digest == Some(fact.request_digest())
        && native.correction_stream_identity.as_deref() == Some(&*correction.stream_identity)
        && native.correction_sequence == Some(correction.sequence)
        && native.fact_lineage_root == fact.lineage_root()
        && native.fact_lineage_version == fact.lineage_version()
        && native.outbox_event_identity == aggregate.outbox().digest()
        && native.outbox_aggregate_identity == fact.snapshot_identity()
        && native.outbox_payload == aggregate.outbox().payload()
        && native.outbox_digest == aggregate.outbox().digest()
        && native.head.lineage_root == fact.lineage_root()
        && native.head.lineage_version >= fact.lineage_version()
        && (!require_current_head
            || (native.head.identity == fact.snapshot_identity()
                && native.head.fact_digest == fact.digest()
                && native.head.lineage_version == fact.lineage_version()))
}

async fn load_envelope(
    transaction: &mut Transaction<'_, Postgres>,
    statement: &'static str,
    identity: BindingDigest,
) -> Result<Option<StoredEnvelope>, sqlx::Error> {
    let Some(row) = sqlx::query(statement)
        .bind(identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await?
    else {
        return Ok(None);
    };
    Ok(Some(decode_envelope(&row)?))
}

fn decode_envelope(row: &sqlx::postgres::PgRow) -> Result<StoredEnvelope, sqlx::Error> {
    Ok(StoredEnvelope {
        aggregate: row.try_get("aggregate_json")?,
        native: decode_native_index(row)?,
    })
}

fn decode_native_index(row: &sqlx::postgres::PgRow) -> Result<NativeIndex, sqlx::Error> {
    let request_identity: Option<Vec<u8>> = row.try_get("request_identity")?;
    let request_digest: Option<Vec<u8>> = row.try_get("request_digest")?;
    let correction_sequence: Option<i64> = row.try_get("correction_sequence")?;
    Ok(NativeIndex {
        row_identity: row_digest(row, "row_identity")?,
        fact_digest: row_digest(row, "fact_digest")?,
        request_identity: request_identity
            .map(|value| digest_from_bytes(&value))
            .transpose()?,
        request_digest: request_digest
            .map(|value| digest_from_bytes(&value))
            .transpose()?,
        correction_stream_identity: row.try_get("correction_stream_identity")?,
        correction_sequence: correction_sequence.map(positive_u64).transpose()?,
        fact_lineage_root: row_digest(row, "fact_lineage_root")?,
        fact_lineage_version: positive_u64(row.try_get("fact_lineage_version")?)?,
        outbox_event_identity: row_digest(row, "outbox_event_identity")?,
        outbox_aggregate_identity: row_digest(row, "outbox_aggregate_identity")?,
        outbox_payload: row.try_get("outbox_payload")?,
        outbox_digest: row_digest(row, "outbox_digest")?,
        head: NativeHead {
            lineage_root: row_digest(row, "head_lineage_root")?,
            identity: row_digest(row, "head_identity")?,
            fact_digest: row_digest(row, "head_digest")?,
            lineage_version: positive_u64(row.try_get("head_version")?)?,
        },
    })
}

fn decode_head(row: &sqlx::postgres::PgRow) -> Result<NativeHead, sqlx::Error> {
    Ok(NativeHead {
        lineage_root: row_digest(row, "lineage_root")?,
        identity: row_digest(row, "head_identity")?,
        fact_digest: row_digest(row, "fact_digest")?,
        lineage_version: positive_u64(row.try_get("lineage_version")?)?,
    })
}

fn row_digest(
    row: &sqlx::postgres::PgRow,
    column: &'static str,
) -> Result<BindingDigest, sqlx::Error> {
    let bytes: Vec<u8> = row.try_get(column)?;
    digest_from_bytes(&bytes)
}

fn decode_clock(row: &sqlx::postgres::PgRow) -> Result<MarketDataClockAdmission, sqlx::Error> {
    let restart: Vec<u8> = row.try_get("restart_continuity_digest")?;
    let comparison_rule: i16 = row.try_get("comparison_rule")?;
    if comparison_rule != 1 {
        return Err(sqlx::Error::Protocol(
            "invalid Market Data comparison rule".into(),
        ));
    }
    Ok(MarketDataClockAdmission {
        cut_kind: super::source_binding::MarketDataClockCutKind::MarketDataAsOf,
        clock_identity: row.try_get("clock_identity")?,
        clock_epoch: row.try_get("clock_epoch")?,
        monotonic_sequence: positive_u64(row.try_get("monotonic_sequence")?)?,
        wall_observed: positive_u64(row.try_get("wall_observed")?)?,
        decision_cut: positive_u64(row.try_get("decision_cut")?)?,
        valid_through: positive_u64(row.try_get("valid_through")?)?,
        restart_continuity_digest: digest_from_bytes(&restart)?,
        uncertainty_bound: nonnegative_u64(row.try_get("uncertainty_bound")?)?,
        skew_bound: positive_u64(row.try_get("skew_bound")?)?,
        comparison_rule:
            super::source_binding::MarketDataClockComparisonRule::ExclusiveValidThrough,
    })
}

fn digest_from_bytes(bytes: &[u8]) -> Result<BindingDigest, sqlx::Error> {
    let value: [u8; 32] = bytes
        .try_into()
        .map_err(|_| sqlx::Error::Protocol("invalid Market Data digest length".into()))?;
    Ok(BindingDigest::from_untrusted_bytes(value))
}

fn positive_u64(value: i64) -> Result<u64, sqlx::Error> {
    u64::try_from(value)
        .ok()
        .filter(|value| *value != 0)
        .ok_or_else(|| sqlx::Error::Protocol("invalid positive Market Data integer".into()))
}

fn nonnegative_u64(value: i64) -> Result<u64, sqlx::Error> {
    u64::try_from(value).map_err(|_| sqlx::Error::Protocol("invalid Market Data integer".into()))
}

#[cfg(test)]
pub(crate) mod tests;

/// Opens the sole configured Market Data intake and binds one Data Client to it.
pub(super) async fn pit_market_snapshot_intake_from_environment_v1(
    observations: std::sync::Arc<dyn PitObservationSourceV1>,
) -> Result<std::sync::Arc<dyn PitMarketSnapshotIntakeV1>, PitMarketSnapshotIntakeErrorV1> {
    let url =
        std::env::var(super::instrument_master_v2_postgres::MARKET_DATA_OWNER_DATABASE_URL_ENV)
            .map_err(|_| PitMarketSnapshotIntakeErrorV1::StoreUnavailable)?;
    if url.is_empty() || url.trim() != url {
        return Err(PitMarketSnapshotIntakeErrorV1::StoreUnavailable);
    }
    let owner = MarketDataOwnerPostgres::connect(&url)
        .await
        .map_err(|_| PitMarketSnapshotIntakeErrorV1::StoreUnavailable)?;
    Ok(std::sync::Arc::new(MarketDataPitIntakePostgresV1 {
        owner,
        observations,
    }))
}

/// The domain of a PIT request's Instrument Master resolution over one member.
const INSTRUMENT_MASTER_PIT_REQUEST_DOMAIN: &[u8] =
    b"vibe.market-data.instrument-master-pit-request.v1\0";
/// The domain of a PIT request's Instrument Master resolution over a two-member universe. The
/// one-member preimage carries no member count, so a separate domain is what keeps the two
/// encodings from ever producing the same bytes.
const INSTRUMENT_MASTER_PIT_REQUEST_MEMBERS_DOMAIN: &[u8] =
    b"vibe.market-data.instrument-master-pit-request.members.v1\0";
/// The most members a PIT request may be scoped to.
const PIT_INTAKE_MAX_MEMBERS: usize = 2;

/// The scope a PIT request names: the members of the record it was frozen against, and the record.
///
/// A record the Owner cannot recover, or one that is not the request's, scopes nothing. Kept out of
/// the async caller so its temporaries never sit in that caller's poll frame.
fn pit_intake_scope_v1(
    recovered: Result<UniverseSelectionReadbackV1, UniverseSelectionErrorV1>,
    universe_selection_digest: UniverseSelectionIdentity,
) -> Result<(Vec<String>, Option<Box<UniverseSelectionReadbackV1>>), PitSnapshotError> {
    match recovered {
        Ok(readback) if readback.record().identity() == universe_selection_digest => {
            Ok((pit_intake_members_v1(&readback)?, Some(Box::new(readback))))
        }
        Ok(_) => Ok((Vec::new(), None)),
        Err(UniverseSelectionErrorV1::StoreUnavailable) => {
            Err(PitSnapshotError::PersistenceUnavailable)
        }
        Err(_) => Ok((Vec::new(), None)),
    }
}

/// The members a PIT request is scoped to: the recovered record's included members, in its order.
///
/// Each one must be keyed by the canonical instrument it names, because the Instrument Master
/// resolution reads the record's instruments while the observation scope carries its member
/// keys; a record where the two differ would bind one set of instruments and observe another.
fn pit_intake_members_v1(
    readback: &UniverseSelectionReadbackV1,
) -> Result<Vec<String>, PitSnapshotError> {
    let included = readback
        .record()
        .membership()
        .iter()
        .filter(|member| member.included())
        .collect::<Vec<_>>();

    if included.is_empty() || included.len() > PIT_INTAKE_MAX_MEMBERS {
        return Err(PitSnapshotError::UniverseMemberCountUnadmitted);
    }
    included
        .into_iter()
        .map(|member| {
            if member.member_key() != member.instrument() {
                return Err(PitSnapshotError::UniverseMemberKeyIsNotInstrument);
            }
            String::from_utf8(member.member_key().to_vec())
                .map_err(|_| PitSnapshotError::ObservationBatchUnavailable)
        })
        .collect()
}

/// The bytes a PIT request's Instrument Master request identity is the SHA-256 of.
///
/// One member keeps the encoding it has always had. Two members bind the selection record and
/// every member, each length-prefixed, in canonical order.
fn pit_instrument_master_identity_preimage_v1(
    correlation: BindingDigest,
    selection: UniverseSelectionIdentity,
    members: &[String],
    effective: i128,
    decision_cut: u64,
) -> Result<Vec<u8>, PitSnapshotError> {
    let mut preimage = Vec::new();
    if let [member] = members {
        preimage.extend_from_slice(INSTRUMENT_MASTER_PIT_REQUEST_DOMAIN);
        preimage.extend_from_slice(correlation.as_bytes());
        preimage.extend_from_slice(member.as_bytes());
    } else {
        preimage.extend_from_slice(INSTRUMENT_MASTER_PIT_REQUEST_MEMBERS_DOMAIN);
        preimage.extend_from_slice(correlation.as_bytes());
        preimage.extend_from_slice(selection.as_bytes());
        let count = u64::try_from(members.len())
            .map_err(|_| PitSnapshotError::UniverseMemberCountUnadmitted)?;
        preimage.extend_from_slice(&count.to_be_bytes());

        for member in members {
            let length = u16::try_from(member.len())
                .map_err(|_| PitSnapshotError::InstrumentMasterUnavailable)?;
            preimage.extend_from_slice(&length.to_be_bytes());
            preimage.extend_from_slice(member.as_bytes());
        }
    }
    preimage.extend_from_slice(&effective.to_be_bytes());
    preimage.extend_from_slice(&decision_cut.to_be_bytes());
    Ok(preimage)
}

/// The record and its members in canonical order, when the scope has one or two members.
fn pit_instrument_master_members_v1<'a>(
    universe: Option<&'a UniverseSelectionReadbackV1>,
    members: &[String],
) -> Result<(&'a UniverseSelectionReadbackV1, Vec<String>), PitSnapshotError> {
    let (Some(universe), 1..=PIT_INTAKE_MAX_MEMBERS) = (universe, members.len()) else {
        return Err(PitSnapshotError::InstrumentMasterUnavailable);
    };
    let mut members = members.to_vec();
    members.sort();
    Ok((universe, members))
}

/// States one PIT request to the Instrument Master under the frontiers of its selected facts.
///
/// `members` is in canonical order and `selected` answers it member for member. The request takes
/// the first fact's frontiers; the resolution refuses a second fact that disagrees with them. It is
/// boxed because the async caller holds it across the resolution, in a debug build's poll frame.
fn pit_instrument_master_request_v1(
    request: &UntrustedPitSnapshotRequest,
    selection: UniverseSelectionIdentity,
    members: &[String],
    selected: &[InstrumentMasterFactV1],
    clock: &MarketDataClockAdmission,
    clock_head: UntrustedClockHeadLocator,
) -> Result<Box<UntrustedInstrumentMasterRequestV1>, PitSnapshotError> {
    let ([first, ..], true) = (selected, selected.len() == members.len()) else {
        return Err(PitSnapshotError::InstrumentMasterUnavailable);
    };
    let time = &request.time_evidence;
    let effective = i128::from(time.event_effective.value);
    let (domain, scope) = match members {
        [member] => (
            INSTRUMENT_MASTER_PIT_REQUEST_DOMAIN,
            InstrumentMasterScopeV1::ExactInstrument(member.clone()),
        ),
        _ => (
            INSTRUMENT_MASTER_PIT_REQUEST_MEMBERS_DOMAIN,
            InstrumentMasterScopeV1::UniverseSelectionRecord(selection),
        ),
    };
    let request_identity = BindingDigest::from_untrusted_bytes(
        Sha256::digest(pit_instrument_master_identity_preimage_v1(
            request.correlation_identity,
            selection,
            members,
            effective,
            clock.decision_cut,
        )?)
        .into(),
    );
    let mut meaning = Sha256::new();
    meaning.update(domain);
    meaning.update(request_identity.as_bytes());
    for fact in selected {
        meaning.update(fact.digest().as_bytes());
    }
    Ok(Box::new(UntrustedInstrumentMasterRequestV1 {
        request_identity,
        request_meaning_digest: BindingDigest::from_untrusted_bytes(meaning.finalize().into()),
        consumer_role: super::instrument_master::BACKTEST_OWNER_V1.into(),
        scope,
        effective_instant: effective,
        owner_observation: i128::from(time.observed_at),
        decision_cut: clock.decision_cut,
        clock_head,
        lifecycle_frontier: first.proposal.lifecycle_frontier,
        corporate_action_frontier: first.proposal.corporate_action_frontier,
        historical_membership_frontier: first.proposal.historical_membership_frontier,
        market_semantics_identity: first.proposal.market_semantics_identity,
        source_frontier: first.proposal.source_frontier,
        correction_frontier: first.proposal.correction_frontier,
        stable_correlation: request.correlation_identity,
    }))
}

impl MarketDataOwnerPostgres {
    /// The locator of the Owner's current clock head, for custody that must bind it exactly.
    pub(crate) async fn current_clock_head_locator_v1(
        &self,
    ) -> Result<UntrustedClockHeadLocator, PitMarketSnapshotIntakeErrorV1> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PitMarketSnapshotIntakeErrorV1::StoreUnavailable)?;
        let head = load_current_clock_fact_for_update(&mut transaction)
            .await
            .map_err(|_| PitMarketSnapshotIntakeErrorV1::StoreUnavailable)?
            .ok_or(PitMarketSnapshotIntakeErrorV1::ClockUnavailable)?;
        transaction
            .rollback()
            .await
            .map_err(|_| PitMarketSnapshotIntakeErrorV1::StoreUnavailable)?;
        Ok(head.handoff.locator().clone())
    }

    /// Admits one Instrument Master V1 fact under the Owner's current clock head.
    ///
    /// # Errors
    ///
    /// A bounded category when nothing was admitted; a replayed submission rejoins its fact.
    pub(crate) async fn admit_instrument_master_fact_v1(
        &self,
        submission: InstrumentMasterFactSubmissionV1,
    ) -> Result<InstrumentMasterAdmissionTerminalV1, InstrumentMasterAdmissionErrorV1> {
        let proposal = submission.into_proposal()?;
        let locator = self
            .current_clock_head_locator_v1()
            .await
            .map_err(|_| InstrumentMasterAdmissionErrorV1::ClockUnavailable)?;
        let fact = self
            .append_instrument_master_fact(proposal, &locator)
            .await?;
        Ok(InstrumentMasterAdmissionTerminalV1::seal(
            fact.canonical_identity().to_owned(),
            fact.digest(),
            locator.head_identity(),
        ))
    }

    /// The digest of the Owner's own Instrument Master resolution for one PIT request.
    ///
    /// The request scopes one or two instruments through its Universe Selection Record. The Owner
    /// selects, member by member in canonical order, the fact effective at the request's event
    /// instant and observable at its cut, states the request under those facts' own frontiers,
    /// resolves the write-once cut, and hands back the readback digest a declaration will later
    /// compare against. One member is resolved as that exact instrument; two are resolved as the
    /// record itself, whose membership the Instrument Master reads back from `universe`. A scope
    /// with no member has no instrument to bind and is refused rather than approximated.
    async fn resolve_instrument_master_digest_for_pit_request_v1(
        &self,
        request: &UntrustedPitSnapshotRequest,
        members: &[String],
        universe: Option<&UniverseSelectionReadbackV1>,
        clock: &MarketDataClockAdmission,
    ) -> Result<BindingDigest, PitSnapshotError> {
        let (universe, members) = pit_instrument_master_members_v1(universe, members)?;
        let time = &request.time_evidence;
        let effective = i128::from(time.event_effective.value);
        let observation = i128::from(time.observed_at);

        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;
        let head = load_current_clock_fact_for_update(&mut transaction)
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?
            .ok_or(PitSnapshotError::TrustedClockMismatch)?;
        let locator = head.handoff.locator().clone();
        let selected = async {
            let (handoff, proof) = current_instrument_clock(&mut transaction, &locator).await?;
            let projection = instrument_clock_projection(&handoff, proof.as_ref())?;
            let facts = load_instrument_facts(&mut transaction, &members, false).await?;
            validate_instrument_fact_graph(&facts)?;
            select_instrument_facts(
                &facts,
                &members,
                effective,
                observation,
                clock.decision_cut,
                &projection,
            )
        }
        .await
        .map_err(|e| {
            super::storage_diagnostic::refused_by_store(
                "pit.request.instrument_master_digest.select",
                &e,
            );
            PitSnapshotError::InstrumentMasterUnavailable
        })?;
        transaction
            .rollback()
            .await
            .map_err(|_| PitSnapshotError::PersistenceUnavailable)?;

        let resolution = pit_instrument_master_request_v1(
            request,
            universe.record().identity(),
            &members,
            &selected,
            clock,
            locator,
        )?;
        let membership: Option<&dyn InstrumentMasterUniverseMembershipResolver> =
            (members.len() > 1).then_some(universe);
        let readback = Box::pin(self.resolve_instrument_master(&resolution, membership))
            .await
            .map_err(|e| {
                super::storage_diagnostic::refused_by_store(
                    "pit.request.instrument_master_digest.resolve",
                    &e,
                );
                PitSnapshotError::InstrumentMasterUnavailable
            })?;
        Ok(readback.digest())
    }
}

const MARKET_SEMANTICS_REQUEST_DOMAIN: &[u8] =
    b"vibe.market-data.market-semantics-owner-request.v1\0";

impl MarketDataOwnerPostgres {
    /// Admits one Market Semantics fact for the scope the submitted binding implies.
    ///
    /// Every dependency is resolved from this Owner's own custody inside one transaction: the
    /// snapshot and its verified batch, the admitted Source Binding, the Instrument Master cut the
    /// snapshot's request already binds, and the R0 record the snapshot's own commit appended. The
    /// registry entry is registered for the derived key with the submitted value, and the fact is
    /// appended through the unchanged resolver, which re-derives that key and refuses any drift.
    ///
    /// # Errors
    ///
    /// A bounded category when nothing was admitted; a replayed submission rejoins its fact.
    pub(crate) async fn admit_market_semantics_fact_v1(
        &self,
        submission: MarketSemanticsFactSubmissionV1,
    ) -> Result<MarketSemanticsAdmissionTerminalV1, MarketSemanticsAdmissionErrorV1> {
        // Resolving four readbacks, a registry key and a fact in one frame makes a large future.
        // Boxing it here keeps every caller's own future small, which is the only place that can
        // be decided once instead of at each call site.
        Box::pin(self.admit_market_semantics_fact_inner_v1(submission)).await
    }

    async fn admit_market_semantics_fact_inner_v1(
        &self,
        submission: MarketSemanticsFactSubmissionV1,
    ) -> Result<MarketSemanticsAdmissionTerminalV1, MarketSemanticsAdmissionErrorV1> {
        use super::market_semantics::{
            MarketSemanticsConsumerV1, UntrustedMarketSemanticsProposalV1,
        };

        let value = submission.value.clone().into_value()?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| MarketSemanticsAdmissionErrorV1::StoreUnavailable)?;
        let source = load_source_for_update(
            &mut transaction,
            submission.source_binding.binding_id,
            false,
        )
        .await
        .map_err(|_| MarketSemanticsAdmissionErrorV1::StoreUnavailable)?
        .ok_or(MarketSemanticsAdmissionErrorV1::DependencyUnavailable)?;

        if source.commit().receipt().locator() != &submission.source_binding {
            return Err(MarketSemanticsAdmissionErrorV1::DependencyUnavailable);
        }
        let source_readback = SourceBindingOwnerReadback::from_verified(&source);

        if !source_readback.is_admitted() {
            return Err(MarketSemanticsAdmissionErrorV1::DependencyUnavailable);
        }
        let pit = load_pit_for_update(
            &mut transaction,
            submission.pit_snapshot.snapshot_identity,
            false,
        )
        .await
        .map_err(|_| MarketSemanticsAdmissionErrorV1::StoreUnavailable)?
        .ok_or(MarketSemanticsAdmissionErrorV1::DependencyUnavailable)?;

        if pit.receipt().locator() != &submission.pit_snapshot
            || !super::pit_snapshot::PitSnapshotOwnerReadback::from_verified(&pit).is_available()
        {
            return Err(MarketSemanticsAdmissionErrorV1::DependencyUnavailable);
        }
        let stored_batch = load_pit_observation_batch_for_update(&mut transaction, &pit)
            .await
            .map_err(|_| MarketSemanticsAdmissionErrorV1::StoreUnavailable)?
            .ok_or(MarketSemanticsAdmissionErrorV1::DependencyUnavailable)?;
        let batch = verify_observation_batch(
            &pit,
            stored_batch.source_binding_identity,
            stored_batch.source_binding_lineage_root,
            stored_batch.source_binding_lineage_version,
            stored_batch.digest,
            &stored_batch.bytes,
            &stored_batch.rows,
        )
        .map_err(|_| MarketSemanticsAdmissionErrorV1::DependencyUnavailable)?;

        // The scope is the binding's own Market Semantics Compatibility identity, which is what
        // the snapshot was minted against; a submitter naming a scope could state a fact about a
        // compatibility this binding never claimed.
        let scope = derive_market_semantics_compatibility_identity_v1(
            &source.commit().fact().proposal().semantics,
        );

        if batch.market_semantics_identity() != scope {
            return Err(MarketSemanticsAdmissionErrorV1::DependencyUnavailable);
        }
        let instrument_request_identity = instrument_master_request_identity_for_cut_v1(
            &mut transaction,
            batch.instrument_master_digest(),
        )
        .await?;
        let instrument =
            load_durable_instrument_readback(&mut transaction, instrument_request_identity, false)
                .await
                .map_err(|_| MarketSemanticsAdmissionErrorV1::StoreUnavailable)?
                .ok_or(MarketSemanticsAdmissionErrorV1::DependencyUnavailable)?;
        let r0_request_identity = reference_fact_coordinates::owner_r0_request_identity_v1(
            pit.fact().snapshot_identity(),
            pit.fact().digest(),
        );
        let r0 = reference_fact_coordinates::load_reference_fact_r0_readback_v1(
            &mut transaction,
            r0_request_identity,
        )
        .await
        .map_err(|_| MarketSemanticsAdmissionErrorV1::StoreUnavailable)?
        .ok_or(MarketSemanticsAdmissionErrorV1::DependencyUnavailable)?;

        let key = super::market_semantics::authority::derive_registry_key_v1(
            scope,
            &source_readback,
            &batch,
            &instrument,
            &r0,
        )?;
        let record = r0.record();
        let effective_instant = record.effective_from_ns;
        let entry = super::market_semantics::authority::seal_registry_entry_v1(
            key,
            value,
            source_readback.binding_id(),
        )?;
        market_semantics::register_market_semantics_registry_entry_v1(&mut transaction, &entry)
            .await
            .map_err(|e| match e {
                // The registry is write-once per key: that registration inserts on conflict do
                // nothing and then reads back, so a readback that does not equal what this
                // submission offered means the key already carries different content. That is the
                // submitter's conflict, not a store fault.
                super::market_semantics::MarketSemanticsErrorV1::StoreUntrusted => {
                    MarketSemanticsAdmissionErrorV1::AdmissionConflict
                }
                other => MarketSemanticsAdmissionErrorV1::from(other),
            })?;

        let mut instrument_locator_bytes = Vec::with_capacity(64);
        instrument_locator_bytes.extend_from_slice(instrument.request_identity.as_bytes());
        instrument_locator_bytes.extend_from_slice(instrument.request_meaning_digest.as_bytes());
        let mut r0_locator_bytes = Vec::with_capacity(64);
        r0_locator_bytes.extend_from_slice(r0.cut().request_identity.as_bytes());
        r0_locator_bytes.extend_from_slice(r0.cut().request_meaning_digest.as_bytes());
        let mut request_identity = Sha256::new();
        request_identity.update(MARKET_SEMANTICS_REQUEST_DOMAIN);
        request_identity.update(scope.as_bytes());
        request_identity.update(pit.fact().snapshot_identity().as_bytes());
        request_identity.update(entry.identity().as_bytes());
        let mut proposal = UntrustedMarketSemanticsProposalV1 {
            request_identity: BindingDigest::from_untrusted_bytes(
                request_identity.finalize().into(),
            ),
            request_meaning_digest: BindingDigest::from_untrusted_bytes([0; 32]),
            consumer: MarketSemanticsConsumerV1::StrategyInputBindingRegistry,
            compatibility_scope_identity: scope,
            predecessor_identity: None,
            value,
            effective_from_ns: record.effective_from_ns,
            effective_until_ns: record.effective_until_ns,
            effective_instant_ns: effective_instant,
            owner_observation_ns: record.owner_observation_ns,
            decision_cut: record.decision_cut,
            pit_locator_bytes: serde_json::to_vec(pit.receipt().locator())
                .map_err(|_| MarketSemanticsAdmissionErrorV1::InvalidSubmission)?
                .into_boxed_slice(),
            source_binding_locator_bytes: serde_json::to_vec(source.commit().receipt().locator())
                .map_err(|_| MarketSemanticsAdmissionErrorV1::InvalidSubmission)?
                .into_boxed_slice(),
            instrument_master_locator_bytes: instrument_locator_bytes.into_boxed_slice(),
            r0_locator_bytes: r0_locator_bytes.into_boxed_slice(),
            stable_correlation: record.stable_correlation,
        };
        proposal.request_meaning_digest =
            super::market_semantics::authority::request_meaning_digest_v1(&proposal)?;
        let readback = Box::pin(
            market_semantics::resolve_market_semantics_in_transaction_v1(
                &mut transaction,
                &proposal,
            ),
        )
        .await?;
        let [fact] = readback.facts() else {
            return Err(MarketSemanticsAdmissionErrorV1::StoreUnavailable);
        };
        let terminal = MarketSemanticsAdmissionTerminalV1::seal(
            scope,
            fact.identity(),
            readback.cut().identity(),
        );
        transaction
            .commit()
            .await
            .map_err(|_| MarketSemanticsAdmissionErrorV1::StoreUnavailable)?;
        Ok(terminal)
    }
}

/// The request identity of the Owner's own Instrument Master resolution behind one cut digest.
///
/// A snapshot binds the readback digest its mint resolved. The registry key needs that exact
/// readback, and the durable receipt is the only thing that maps the digest back to the request
/// that produced it.
async fn instrument_master_request_identity_for_cut_v1(
    transaction: &mut Transaction<'_, Postgres>,
    readback_digest: BindingDigest,
) -> Result<BindingDigest, MarketSemanticsAdmissionErrorV1> {
    let rows: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT request_identity FROM market_data_private.instrument_master_receipts_v1 ORDER BY request_identity",
    )
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| MarketSemanticsAdmissionErrorV1::StoreUnavailable)?;

    for row in rows {
        let identity: [u8; 32] = row
            .as_slice()
            .try_into()
            .map_err(|_| MarketSemanticsAdmissionErrorV1::StoreUnavailable)?;
        let identity = BindingDigest::from_untrusted_bytes(identity);
        let candidate = load_durable_instrument_readback(transaction, identity, false)
            .await
            .map_err(|_| MarketSemanticsAdmissionErrorV1::StoreUnavailable)?;

        if candidate.is_some_and(|readback| readback.digest() == readback_digest) {
            return Ok(identity);
        }
    }
    Err(MarketSemanticsAdmissionErrorV1::DependencyUnavailable)
}

pub(super) async fn market_semantics_admission_from_environment_v1()
-> Result<std::sync::Arc<dyn MarketSemanticsAdmissionV1>, MarketSemanticsAdmissionErrorV1> {
    let url =
        std::env::var(super::instrument_master_v2_postgres::MARKET_DATA_OWNER_DATABASE_URL_ENV)
            .map_err(|_| MarketSemanticsAdmissionErrorV1::StoreUnavailable)?;
    if url.is_empty() || url.trim() != url {
        return Err(MarketSemanticsAdmissionErrorV1::StoreUnavailable);
    }
    let owner = MarketDataOwnerPostgres::connect(&url).await.map_err(|e| {
        super::storage_diagnostic::refused_by_store(
            "market_semantics_admission.environment.connect",
            &e,
        );
        MarketSemanticsAdmissionErrorV1::StoreUnavailable
    })?;
    Ok(std::sync::Arc::new(MarketSemanticsAdmissionPostgresV1 {
        owner,
    }))
}

struct MarketSemanticsAdmissionPostgresV1 {
    owner: MarketDataOwnerPostgres,
}

impl Debug for MarketSemanticsAdmissionPostgresV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(MarketSemanticsAdmissionPostgresV1))
            .finish_non_exhaustive()
    }
}

impl MarketSemanticsAdmissionSealed for MarketSemanticsAdmissionPostgresV1 {}

#[async_trait::async_trait]
impl MarketSemanticsAdmissionV1 for MarketSemanticsAdmissionPostgresV1 {
    async fn admit_fact(
        &self,
        submission: MarketSemanticsFactSubmissionV1,
    ) -> Result<MarketSemanticsAdmissionTerminalV1, MarketSemanticsAdmissionErrorV1> {
        self.owner.admit_market_semantics_fact_v1(submission).await
    }
}

/// Issues the subscription one live channel carries, from the Owner's own Instrument Master.
///
/// A caller proposes canonical identities; this decides what the channel actually carries. Each
/// candidate must have exactly one Instrument Master fact that is effective at `observation_ns`
/// and observable under the Owner's current clock head, and that fact must state the same Market
/// Semantics Compatibility identity the binding does. Anything else is refused rather than
/// carried, which is what makes the later refusal of an out-of-scope venue answer mean something:
/// the scope is the Owner's, not the caller's.
async fn issue_live_market_subscription_v1(
    transaction: &mut Transaction<'_, Postgres>,
    proposed: &[String],
    channel: crate::owner::strategy_input_binding::StrategyInputChannel,
    field_semantic: crate::owner::strategy_input_binding::MarketDataFieldSemantic,
    binding: crate::owner::live_market_fact_v1::LiveMarketBindingV1,
    observation_ns: u64,
) -> Result<LiveMarketSubscriptionV1, LiveMarketChannelErrorV1> {
    let mut members = proposed.to_vec();
    members.sort_unstable();
    members.dedup();

    if members.is_empty() || members.iter().any(String::is_empty) {
        return Err(LiveMarketChannelErrorV1::InvalidRequest);
    }
    let observation = i128::from(observation_ns);
    let head = load_current_clock_fact_for_update(transaction)
        .await
        .map_err(|_| LiveMarketChannelErrorV1::StoreUnavailable)?
        .ok_or(LiveMarketChannelErrorV1::StoreUntrusted)?;
    let locator = head.handoff.locator().clone();
    let selected = async {
        let (handoff, proof) = current_instrument_clock(transaction, &locator).await?;
        let projection = instrument_clock_projection(&handoff, proof.as_ref())?;
        let facts = load_instrument_facts(transaction, &members, false).await?;
        validate_instrument_fact_graph(&facts)?;
        // A live channel asks about now under the Owner's current head, so the effective instant
        // and the observation instant are the same one and the cut is the head's own.
        select_instrument_facts(
            &facts,
            &members,
            observation,
            observation,
            projection.decision_cut,
            &projection,
        )
    }
    .await
    .map_err(|e| {
        super::storage_diagnostic::refused_by_store("live_market.subscription.instruments", &e);
        LiveMarketChannelErrorV1::InstrumentUnavailable
    })?;

    // A fact under different Market Semantics measures a different thing by the same name, and the
    // generation's Strategy Artifact was bound to the binding's identity, not to this fact's.
    if selected
        .iter()
        .any(|fact| fact.proposal.market_semantics_identity != binding.market_semantics_identity)
    {
        return Err(LiveMarketChannelErrorV1::InstrumentUnavailable);
    }
    let instruments = selected
        .iter()
        .map(|fact| fact.canonical_identity().to_string())
        .collect::<Vec<_>>();
    LiveMarketSubscriptionV1::issue_v1(instruments, channel, field_semantic).map_err(Into::into)
}

pub(super) async fn live_market_fact_intake_from_environment_v1(
    source: std::sync::Arc<dyn LiveMarketFactSourceV1>,
) -> Result<std::sync::Arc<dyn LiveMarketFactIntakeV1>, LiveMarketChannelErrorV1> {
    let url =
        std::env::var(super::instrument_master_v2_postgres::MARKET_DATA_OWNER_DATABASE_URL_ENV)
            .map_err(|_| LiveMarketChannelErrorV1::StoreUnavailable)?;
    if url.is_empty() || url.trim() != url {
        return Err(LiveMarketChannelErrorV1::StoreUnavailable);
    }
    let owner = MarketDataOwnerPostgres::connect(&url).await.map_err(|e| {
        super::storage_diagnostic::refused_by_store("live_market_intake.environment.connect", &e);
        LiveMarketChannelErrorV1::StoreUnavailable
    })?;
    Ok(std::sync::Arc::new(LiveMarketFactIntakePostgresV1 {
        owner: std::sync::Arc::new(owner),
        source,
        open_channels: std::sync::Arc::new(
            std::sync::Mutex::new(std::collections::BTreeSet::new()),
        ),
    }))
}

struct LiveMarketFactIntakePostgresV1 {
    owner: std::sync::Arc<MarketDataOwnerPostgres>,
    source: std::sync::Arc<dyn LiveMarketFactSourceV1>,
    open_channels: OpenLiveChannels,
}

/// The channel identities this process currently has open.
///
/// One channel is one consumer. Two pollers on one head would each take the row lock when their
/// own venue wait finished, so the venue's order and the Owner's sequence could disagree without
/// either side being able to tell.
type OpenLiveChannels = std::sync::Arc<std::sync::Mutex<std::collections::BTreeSet<BindingDigest>>>;

impl Debug for LiveMarketFactIntakePostgresV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(LiveMarketFactIntakePostgresV1))
            .finish_non_exhaustive()
    }
}

impl LiveMarketSealed for LiveMarketFactIntakePostgresV1 {}

#[async_trait::async_trait]
impl LiveMarketFactIntakeV1 for LiveMarketFactIntakePostgresV1 {
    async fn open_channel(
        &self,
        request: LiveMarketChannelRequestV1,
    ) -> Result<std::sync::Arc<dyn LiveMarketChannelV1>, LiveMarketChannelErrorV1> {
        let (binding, subscription) = self
            .owner
            .open_live_market_scope_v1(&request, live_retrieval_now_ns_v1())
            .await?;
        let channel_identity =
            derive_channel_identity_v1(binding.source_binding_identity, &subscription);

        if !self
            .open_channels
            .lock()
            .map_err(|_| LiveMarketChannelErrorV1::StoreUnavailable)?
            .insert(channel_identity)
        {
            return Err(LiveMarketChannelErrorV1::ChannelBusy);
        }
        let channel = LiveMarketChannelPostgresV1 {
            owner: std::sync::Arc::clone(&self.owner),
            source: std::sync::Arc::clone(&self.source),
            open_channels: std::sync::Arc::clone(&self.open_channels),
            source_binding_identity: binding.source_binding_identity,
            channel_identity,
            subscription,
            request,
        };
        // Opening reads the head, so a channel that cannot resume is refused here rather than at
        // the first fact, when a consumer would already be waiting on it.
        channel.head().await?;
        Ok(std::sync::Arc::new(channel))
    }
}

struct LiveMarketChannelPostgresV1 {
    owner: std::sync::Arc<MarketDataOwnerPostgres>,
    source: std::sync::Arc<dyn LiveMarketFactSourceV1>,
    open_channels: OpenLiveChannels,
    request: LiveMarketChannelRequestV1,
    /// The scope the Data Client was opened against. It tells the client what to answer for; what
    /// a fact may be sealed under is decided again inside the sealing transaction, so a scope that
    /// narrowed while the channel waited costs one refused batch rather than one wrong fact.
    subscription: LiveMarketSubscriptionV1,
    source_binding_identity: BindingDigest,
    channel_identity: BindingDigest,
}

impl Debug for LiveMarketChannelPostgresV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(LiveMarketChannelPostgresV1))
            .field("channel_identity", &self.channel_identity)
            .finish_non_exhaustive()
    }
}

impl Drop for LiveMarketChannelPostgresV1 {
    fn drop(&mut self) {
        if let Ok(mut open) = self.open_channels.lock() {
            open.remove(&self.channel_identity);
        }
    }
}

impl LiveMarketSealed for LiveMarketChannelPostgresV1 {}

#[async_trait::async_trait]
impl LiveMarketChannelV1 for LiveMarketChannelPostgresV1 {
    fn channel_identity(&self) -> BindingDigest {
        self.channel_identity
    }

    async fn next_facts(&self) -> Result<Vec<LiveMarketFactV1>, LiveMarketChannelErrorV1> {
        // The venue wait happens outside any transaction, so an idle market never holds the head
        // lock. The scope is re-resolved inside the sealing transaction instead.
        let observations = self.source.next_batch(&self.subscription).await?;
        self.owner
            .seal_live_market_batch_v1(
                &self.request,
                self.channel_identity,
                &observations,
                live_retrieval_now_ns_v1(),
            )
            .await
    }

    async fn head(&self) -> Result<LiveMarketChannelHeadV1, LiveMarketChannelErrorV1> {
        self.owner
            .live_market_channel_head_v1(self.channel_identity, self.source_binding_identity)
            .await
    }
}

/// The retrieval instant this Owner stamps on a live fact, in nanoseconds since the epoch.
///
/// It is the Owner's evidence about itself: when this system received something. It is read from
/// the host wall clock and not from the Owner's sealed clock head, so it shares a clock with
/// neither the venue's instants nor any coordinate admitted under that head, and no ordering
/// between them is provable. The name says `retrieval` because that is the coordinate it fills;
/// an earlier name said Owner-observation, which is a different coordinate this fact does not
/// carry, and a document describing this path repeated that mistake.
///
/// A host clock before the epoch is reported as zero rather than guessed at, which makes every
/// live observation ambiguous and stops the channel, because a system that cannot say when it
/// received a fact cannot place that fact in time either.
fn live_retrieval_now_ns_v1() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| u64::try_from(elapsed.as_nanos()).ok())
        .unwrap_or_default()
}

pub(super) async fn instrument_master_admission_from_environment_v1()
-> Result<std::sync::Arc<dyn InstrumentMasterAdmissionV1>, InstrumentMasterAdmissionErrorV1> {
    let url =
        std::env::var(super::instrument_master_v2_postgres::MARKET_DATA_OWNER_DATABASE_URL_ENV)
            .map_err(|_| InstrumentMasterAdmissionErrorV1::StoreUnavailable)?;
    if url.is_empty() || url.trim() != url {
        return Err(InstrumentMasterAdmissionErrorV1::StoreUnavailable);
    }
    let owner = MarketDataOwnerPostgres::connect(&url).await.map_err(|e| {
        super::storage_diagnostic::refused_by_store(
            "instrument_master_admission.environment.connect",
            &e,
        );
        InstrumentMasterAdmissionErrorV1::StoreUnavailable
    })?;
    Ok(std::sync::Arc::new(InstrumentMasterAdmissionPostgresV1 {
        owner,
    }))
}

struct InstrumentMasterAdmissionPostgresV1 {
    owner: MarketDataOwnerPostgres,
}

impl Debug for InstrumentMasterAdmissionPostgresV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(InstrumentMasterAdmissionPostgresV1))
            .finish_non_exhaustive()
    }
}

impl InstrumentMasterAdmissionSealed for InstrumentMasterAdmissionPostgresV1 {}

#[async_trait::async_trait]
impl InstrumentMasterAdmissionV1 for InstrumentMasterAdmissionPostgresV1 {
    async fn admit_fact(
        &self,
        submission: InstrumentMasterFactSubmissionV1,
    ) -> Result<InstrumentMasterAdmissionTerminalV1, InstrumentMasterAdmissionErrorV1> {
        self.owner.admit_instrument_master_fact_v1(submission).await
    }
}

/// The durable intake. It retains the Owner and the Data Client and exposes neither.
struct MarketDataPitIntakePostgresV1 {
    owner: MarketDataOwnerPostgres,
    observations: std::sync::Arc<dyn PitObservationSourceV1>,
}

impl Debug for MarketDataPitIntakePostgresV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(MarketDataPitIntakePostgresV1))
            .finish_non_exhaustive()
    }
}

impl PitIntakeSealed for MarketDataPitIntakePostgresV1 {}

#[async_trait::async_trait]
impl PitMarketSnapshotIntakeV1 for MarketDataPitIntakePostgresV1 {
    async fn current_decision_cut(
        &self,
    ) -> Result<MarketDataDecisionCutV1, PitMarketSnapshotIntakeErrorV1> {
        self.owner
            .current_clock_admission_v1()
            .await
            .map(|clock| public_decision_cut_v1(&clock))
    }

    async fn submit(
        &self,
        request: UntrustedPitSnapshotRequest,
        universe_selection: UntrustedUniverseSelectionLocatorV1,
    ) -> Result<PitMarketSnapshotTerminalV1, PitMarketSnapshotIntakeErrorV1> {
        // The request identity is Market Data-derived by definition: the Owner seals it over the
        // content it commits, after it has stamped its own instrument master digest, so the
        // terminal reports the identity of the request as persisted rather than as submitted.
        let correlation_identity = request.correlation_identity;
        // The decision cut is the Owner's, never the caller's: it comes from the one canonical
        // clock head Market Data persists with its own facts.
        let clock = self.owner.current_clock_admission_v1().await?;
        let aggregate = self
            .owner
            .commit_pit_initial_from_request_v1(
                request,
                self.observations.as_ref(),
                &universe_selection,
                &clock,
            )
            .await?;
        let fact = aggregate.fact();
        let disposition = public_disposition_v1(fact.disposition());
        let locator = (disposition == PitMarketSnapshotDispositionV1::Available)
            .then(|| aggregate.receipt().locator().clone());
        Ok(PitMarketSnapshotTerminalV1::seal(
            super::pit_market_snapshot_intake_v1::PitMarketSnapshotTerminalFieldsV1 {
                request_identity: fact.request_identity(),
                request_digest: fact.request_digest(),
                correlation_identity,
                snapshot_identity: fact.snapshot_identity(),
                fact_digest: fact.digest(),
                disposition,
                locator,
                instrument_master_digest: fact.request().instrument_master_digest,
            },
        ))
    }
}

/// Mirrors the Owner's private disposition onto the public terminal vocabulary.
const fn public_disposition_v1(
    disposition: PitSnapshotDisposition,
) -> PitMarketSnapshotDispositionV1 {
    match disposition {
        PitSnapshotDisposition::Available => PitMarketSnapshotDispositionV1::Available,
        PitSnapshotDisposition::Unlicensed => PitMarketSnapshotDispositionV1::Unlicensed,
        PitSnapshotDisposition::Ambiguous => PitMarketSnapshotDispositionV1::Ambiguous,
        PitSnapshotDisposition::Stale => PitMarketSnapshotDispositionV1::Stale,
        PitSnapshotDisposition::Insufficient => PitMarketSnapshotDispositionV1::Insufficient,
        PitSnapshotDisposition::Unavailable => PitMarketSnapshotDispositionV1::Unavailable,
    }
}

/// Projects the Owner's clock head onto the public decision cut a requester must repeat.
fn public_decision_cut_v1(clock: &MarketDataClockAdmission) -> MarketDataDecisionCutV1 {
    MarketDataDecisionCutV1 {
        clock_identity: clock.clock_identity.clone(),
        clock_epoch: clock.clock_epoch.clone(),
        decision_cut: clock.decision_cut,
        monotonic_sequence: clock.monotonic_sequence,
        restart_continuity_digest: clock.restart_continuity_digest,
        valid_through: clock.valid_through,
        uncertainty_bound: clock.uncertainty_bound,
        skew_bound: clock.skew_bound,
    }
}

/// The Owner clock identity every Market Data cut is minted under.
// The Instrument Master codec binds the clock identity and epoch as exactly 32 bytes each
// (`docs/owners/market-data.md`, "Canonical identity and codec"), so the Owner's own clock must
// name itself in that width or no Instrument Master fact can ever be admitted under it.
const OWNER_CLOCK_IDENTITY_V1: &str = "market-data.owner-clock.v1-00001";
/// The only epoch this slice mints. An epoch change needs the Epoch Successor Proof, which is TARGET.
const OWNER_CLOCK_EPOCH_V1: &str = "market-data.owner-epoch.v1-00001";
const _: () = assert!(OWNER_CLOCK_IDENTITY_V1.len() == 32 && OWNER_CLOCK_EPOCH_V1.len() == 32);
/// How long one minted cut stays valid.
const OWNER_CLOCK_VALIDITY_WINDOW_NS: u64 = 3_600_000_000_000;
/// The fixed uncertainty bound of the Owner clock.
const OWNER_CLOCK_UNCERTAINTY_BOUND_NS: u64 = 1_000_000;
/// The fixed skew bound of the Owner clock.
const OWNER_CLOCK_SKEW_BOUND_NS: u64 = 1_000_000;

/// Opens the sole configured Market Data Source Binding admission.
pub(super) async fn source_binding_admission_from_environment_v1()
-> Result<std::sync::Arc<dyn SourceBindingAdmissionV1>, SourceBindingAdmissionErrorV1> {
    let url =
        std::env::var(super::instrument_master_v2_postgres::MARKET_DATA_OWNER_DATABASE_URL_ENV)
            .map_err(|_| SourceBindingAdmissionErrorV1::StoreUnavailable)?;
    if url.is_empty() || url.trim() != url {
        return Err(SourceBindingAdmissionErrorV1::StoreUnavailable);
    }
    let owner = MarketDataOwnerPostgres::connect(&url).await.map_err(|e| {
        // Opening the store runs its migration, and every statement in there reports the same
        // unavailable value. Without this the caller cannot tell a missing URL from a refused
        // grant, which is the difference between a configuration mistake and a real defect.
        super::storage_diagnostic::refused_by_store(
            "source_binding_admission.environment.connect",
            &e,
        );
        SourceBindingAdmissionErrorV1::StoreUnavailable
    })?;
    Ok(std::sync::Arc::new(SourceBindingAdmissionPostgresV1 {
        owner,
    }))
}

/// The durable admission. It retains the Owner and exposes no pool, writer or clock.
struct SourceBindingAdmissionPostgresV1 {
    owner: MarketDataOwnerPostgres,
}

impl Debug for SourceBindingAdmissionPostgresV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(SourceBindingAdmissionPostgresV1))
            .finish_non_exhaustive()
    }
}

impl SourceBindingAdmissionSealed for SourceBindingAdmissionPostgresV1 {}

#[async_trait::async_trait]
impl SourceBindingAdmissionV1 for SourceBindingAdmissionPostgresV1 {
    async fn admit(
        &self,
        request: SourceBindingAdmissionRequestV1,
    ) -> Result<SourceBindingAdmissionTerminalV1, SourceBindingAdmissionErrorV1> {
        let decision = OwnerSourceBindingDecision {
            blockers: derive_source_blockers_v1(request.rights, request.reachability),
        };
        let clock = self.owner.mint_clock_admission_v1().await?;
        // When a binding was observed is the Owner's fact, not the submitter's, and the first
        // admission is what establishes the clock head at all, so Operations could not state these
        // fields even in principle. The Owner stamps them and re-derives the identity the stamped
        // content implies; the submitter's own four coordinates and effective instant are kept.
        let mut proposal = request.proposal;
        proposal.time_evidence.clock_identity = clock.clock_identity.clone();
        proposal.time_evidence.clock_epoch = clock.clock_epoch.clone();
        proposal.time_evidence.monotonic_sequence = clock.monotonic_sequence;
        proposal.time_evidence.restart_continuity_digest = clock.restart_continuity_digest;
        proposal.time_evidence.skew_bound = clock.skew_bound;
        proposal.time_evidence.uncertainty_bound = clock.uncertainty_bound;
        proposal.time_evidence.observed_at = clock.wall_observed;
        // The instant a binding takes effect is the cut it was admitted at, not a time the
        // submitter chose: an admission cannot be backdated to before the Owner observed it.
        proposal.time_evidence.effective_at = clock.decision_cut;
        proposal.time_evidence.valid_through = clock.valid_through;
        proposal.time_evidence.claimed_evidence_identity =
            derive_time_evidence_identity(&proposal.time_evidence);
        proposal.claimed_binding_id = derive_binding_id(&proposal);
        let commit = self
            .owner
            .commit_source_initial(proposal, decision, &clock)
            .await?;
        let fact = commit.fact();
        Ok(SourceBindingAdmissionTerminalV1::seal(
            fact.binding_id(),
            fact.lineage_root(),
            fact.lineage_version(),
            public_source_disposition_v1(fact.disposition()),
            commit.receipt().locator().clone(),
            derive_market_semantics_compatibility_identity_v1(&fact.proposal().semantics),
        ))
    }
}

/// Derives the blocker set from the evidence Operations supplied.
///
/// The mapping is the document's own: a withdrawal is `REVOKED`, a decisive denial is
/// `UNLICENSED`, and unknown rights or an unanswered endpoint are `UNAVAILABLE`. Unresolved rights
/// never become a denial, because a source whose licence is merely unproven can still be admitted
/// later, while a denied one needs a new grant.
fn derive_source_blockers_v1(
    rights: ProviderRightsEvidenceV1,
    reachability: ProviderReachabilityEvidenceV1,
) -> std::collections::BTreeSet<SourceBindingBlocker> {
    let mut blockers = std::collections::BTreeSet::new();

    match rights {
        ProviderRightsEvidenceV1::Granted => {}
        ProviderRightsEvidenceV1::Revoked => {
            blockers.insert(SourceBindingBlocker::RightsRevoked);
        }
        ProviderRightsEvidenceV1::Denied => {
            blockers.insert(SourceBindingBlocker::RightsDeniedOrUnlicensed);
        }
        ProviderRightsEvidenceV1::Unresolved => {
            blockers.insert(SourceBindingBlocker::RightsEvidenceUnresolved);
        }
    }

    if reachability == ProviderReachabilityEvidenceV1::Unreachable {
        blockers.insert(SourceBindingBlocker::SourceUnavailable);
    }
    blockers
}

/// Mirrors the Owner's private source disposition onto the public vocabulary.
const fn public_source_disposition_v1(
    disposition: SourceBindingDisposition,
) -> SourceBindingAdmissionDispositionV1 {
    match disposition {
        SourceBindingDisposition::Admitted => SourceBindingAdmissionDispositionV1::Admitted,
        SourceBindingDisposition::Revoked => SourceBindingAdmissionDispositionV1::Revoked,
        SourceBindingDisposition::Unlicensed => SourceBindingAdmissionDispositionV1::Unlicensed,
        SourceBindingDisposition::Incompatible => SourceBindingAdmissionDispositionV1::Incompatible,
        SourceBindingDisposition::Unavailable => SourceBindingAdmissionDispositionV1::Unavailable,
    }
}

/// Opens the sole configured Market Data universe-selection intake.
pub(super) async fn universe_selection_admission_from_environment_v1()
-> Result<std::sync::Arc<dyn UniverseSelectionAdmissionV1>, UniverseSelectionAdmissionErrorV1> {
    let url =
        std::env::var(super::instrument_master_v2_postgres::MARKET_DATA_OWNER_DATABASE_URL_ENV)
            .map_err(|_| UniverseSelectionAdmissionErrorV1::StoreUnavailable)?;
    if url.is_empty() || url.trim() != url {
        return Err(UniverseSelectionAdmissionErrorV1::StoreUnavailable);
    }
    let owner = MarketDataOwnerPostgres::connect(&url)
        .await
        .map_err(|_| UniverseSelectionAdmissionErrorV1::StoreUnavailable)?;
    Ok(std::sync::Arc::new(UniverseSelectionAdmissionPostgresV1 {
        owner,
    }))
}

/// The durable universe-selection intake. It exposes no pool, evaluator or raw membership row.
struct UniverseSelectionAdmissionPostgresV1 {
    owner: MarketDataOwnerPostgres,
}

impl Debug for UniverseSelectionAdmissionPostgresV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(UniverseSelectionAdmissionPostgresV1))
            .finish_non_exhaustive()
    }
}

impl UniverseSelectionAdmissionSealed for UniverseSelectionAdmissionPostgresV1 {}

#[async_trait::async_trait]
impl UniverseSelectionAdmissionV1 for UniverseSelectionAdmissionPostgresV1 {
    async fn admit_membership(
        &self,
        request: HistoricalMembershipAdmissionRequestV1,
    ) -> Result<(), UniverseSelectionAdmissionErrorV1> {
        let proposals = request
            .members
            .into_iter()
            .map(|member| HistoricalMembershipFactProposalV1 {
                member_key: member.member_key.into_bytes(),
                instrument: member.instrument.into_bytes(),
                // A submission states facts, never a lineage: the Owner links predecessors itself.
                predecessor_identity: None,
                effective_from_ns: member.effective_from_ns,
                effective_until_ns: member.effective_until_ns,
                provider_available_ns: member.provider_available_ns,
                retrieval_ns: member.retrieval_ns,
                correction_publication_ns: member.correction_publication_ns,
                owner_observation_ns: member.owner_observation_ns,
                decision_cut: member.decision_cut,
                source_binding_lineage_root: member.source_binding_lineage_root,
                correction_frontier_digest: member.correction_frontier_digest,
            })
            .collect();
        let mut transaction = self
            .owner
            .pool
            .begin()
            .await
            .map_err(|_| UniverseSelectionAdmissionErrorV1::StoreUnavailable)?;
        universe_selection::persist_historical_membership_frontier_v1(
            &mut transaction,
            request.eligible_instrument_frontier,
            proposals,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|_| UniverseSelectionAdmissionErrorV1::StoreUnavailable)
    }

    async fn evaluate(
        &self,
        request: UntrustedUniverseSelectionRequestV1,
    ) -> Result<UniverseSelectionTerminalV1, UniverseSelectionAdmissionErrorV1> {
        let mut transaction = self
            .owner
            .pool
            .begin()
            .await
            .map_err(|_| UniverseSelectionAdmissionErrorV1::StoreUnavailable)?;
        let readback = universe_selection::resolve_universe_selection_in_transaction_v1(
            &mut transaction,
            &request,
            Some(&CanonicalUniverseSelectionRuleEvaluatorV1),
        )
        .await?;
        let terminal = seal_universe_terminal_v1(&readback);
        transaction
            .commit()
            .await
            .map_err(|_| UniverseSelectionAdmissionErrorV1::StoreUnavailable)?;
        Ok(terminal)
    }

    async fn recover(
        &self,
        locator: UntrustedUniverseSelectionLocatorV1,
    ) -> Result<UniverseSelectionTerminalV1, UniverseSelectionAdmissionErrorV1> {
        let mut transaction = self
            .owner
            .pool
            .begin()
            .await
            .map_err(|_| UniverseSelectionAdmissionErrorV1::StoreUnavailable)?;
        let readback = universe_selection::recover_universe_selection_in_transaction_v1(
            &mut transaction,
            &locator,
        )
        .await?;
        let terminal = seal_universe_terminal_v1(&readback);
        transaction
            .rollback()
            .await
            .map_err(|_| UniverseSelectionAdmissionErrorV1::StoreUnavailable)?;
        Ok(terminal)
    }
}

/// Projects one readback onto the sealed terminal, which carries identities and no membership rows.
fn seal_universe_terminal_v1(
    readback: &crate::owner::universe_selection::UniverseSelectionReadbackV1,
) -> UniverseSelectionTerminalV1 {
    let record = readback.record();
    UniverseSelectionTerminalV1::seal(
        record.request_identity(),
        record.request_meaning_digest(),
        record.identity(),
        record
            .membership()
            .iter()
            .filter(|member| member.included())
            .count() as u64,
    )
}

/// The env var naming the principal that may read the Composer's role-set attestation.
///
/// It is a second principal on the same database rather than a second database: the Owner writes
/// its custody as `market_data_owner`, which is denied that resolver, and reads the attestation as
/// `market_data_reader`, which holds nothing in `market_data_private`.
const MARKET_DATA_RD_ROLE_SET_DATABASE_URL_ENV: &str = "MARKET_DATA_RD_ROLE_SET_DATABASE_URL";

pub(super) async fn strategy_input_binding_admission_from_environment_v1()
-> Result<std::sync::Arc<dyn StrategyInputBindingAdmissionV1>, StrategyInputBindingAdmissionErrorV1>
{
    let owner_url =
        std::env::var(super::instrument_master_v2_postgres::MARKET_DATA_OWNER_DATABASE_URL_ENV)
            .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
    let reader_url = std::env::var(MARKET_DATA_RD_ROLE_SET_DATABASE_URL_ENV)
        .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;

    if owner_url.is_empty()
        || owner_url.trim() != owner_url
        || reader_url.is_empty()
        || reader_url.trim() != reader_url
    {
        return Err(StrategyInputBindingAdmissionErrorV1::StoreUnavailable);
    }
    let binding =
        super::replay_market_facts_v2::ReplayCompositionOwnerV1::connect(&owner_url, &reader_url)
            .await
            .map_err(|_| StrategyInputBindingAdmissionErrorV1::StoreUnavailable)?;
    Ok(std::sync::Arc::new(
        StrategyInputBindingAdmissionPostgresV1 { binding },
    ))
}

/// The durable W3 admission. It exposes neither pool, attestation nor declaration row.
struct StrategyInputBindingAdmissionPostgresV1 {
    binding: super::replay_market_facts_v2::ReplayCompositionOwnerV1,
}

impl Debug for StrategyInputBindingAdmissionPostgresV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(StrategyInputBindingAdmissionPostgresV1))
            .finish_non_exhaustive()
    }
}

impl StrategyInputBindingAdmissionSealed for StrategyInputBindingAdmissionPostgresV1 {}

#[async_trait::async_trait]
impl StrategyInputBindingAdmissionV1 for StrategyInputBindingAdmissionPostgresV1 {
    async fn admit(
        &self,
        locator: StrategyDesignRoleSetLocatorV1,
    ) -> Result<StrategyInputBindingAdmissionTerminalV1, StrategyInputBindingAdmissionErrorV1> {
        self.binding
            .declare_strategy_input_bindings_v1(&locator)
            .await
    }

    async fn admit_published_design(
        &self,
        design_identity: BindingDigest,
    ) -> Result<StrategyInputBindingAdmissionTerminalV1, StrategyInputBindingAdmissionErrorV1> {
        self.binding
            .declare_strategy_input_bindings_from_design_intent_v1(design_identity)
            .await
    }
}

#[cfg(test)]
mod store_admission_tests {
    use rstest::rstest;

    use super::MarketDataOwnerPostgres;

    /// The readable list and the statement that runs must be the same twelve conditions.
    ///
    /// A dynamic SQL string cannot be sent through `query_scalar` here - the type bound refuses
    /// it - so the statement is a literal and the list beside it could drift into decoration.
    /// This is what stops that: every condition must appear in the statement in the exact form
    /// that makes it contribute its own name, and the statement must contain no other name.
    #[rstest]
    fn the_admission_query_names_every_condition_it_checks() {
        let sql = MarketDataOwnerPostgres::ADMISSION_SQL_V1;

        for (name, predicate) in MarketDataOwnerPostgres::ADMISSION_CONDITIONS_V1 {
            let case = format!("CASE WHEN {predicate} THEN NULL ELSE '{name}' END");
            assert!(
                sql.contains(&case),
                "`{name}` is listed but the statement does not contribute its name: {case}"
            );
        }

        // The other direction. Without it, deleting a condition from the statement while leaving
        // it in the list would pass: the loop above only reads what the list still names.
        assert_eq!(
            sql.matches("CASE WHEN ").count(),
            MarketDataOwnerPostgres::ADMISSION_CONDITIONS_V1.len(),
            "the statement checks a different number of conditions than the list names"
        );
    }

    /// Every name is distinct, so a refusal naming one identifies one condition.
    #[rstest]
    fn no_two_conditions_answer_with_the_same_name() {
        let mut names: Vec<&str> = MarketDataOwnerPostgres::ADMISSION_CONDITIONS_V1
            .iter()
            .map(|(name, _)| *name)
            .collect();
        let total = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), total, "two conditions share one name");
    }
}
