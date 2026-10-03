//! The interface of PIT window custody (slice T0): what a backfill writer commits, and how a
//! multi-frame consumer finds the frames of a run.
//!
//! This module freezes the types two lanes build against in parallel with the custody itself, and
//! holds the custody's pure authority in its `authority` module. The custody aggregate's
//! PostgreSQL store implements [`PitWindowCustodyCommitV1`] and alone constructs a receipt; nothing
//! implements [`PitWindowCustodyFramesV1`] until the derived view (T0-5) does, so nothing can
//! construct a frame coordinate or a custody-sourced batch yet.
//!
//! The governing text is `docs/owners/market-data.md`, "PIT window custody". In short:
//! - **One custody, one window, committed once.** It holds every cross-section of its window for a
//!   fixed member set, under one Source Binding, Market Semantics fact and availability rule. It is
//!   never mutated. A correction is a successor that names its predecessor, restates its basis
//!   exactly and carries only the versions it adds; extending history is a new root.
//! - **The Owner derives what the caller cannot know.** The caller states the rows it retrieved and
//!   when; the Owner derives each row's availability from the binding's rule, the window schedule,
//!   the frame instants and every identity. Retrieval instants are custody evidence, outside every
//!   identity, so the same versions resubmitted with other retrieval evidence rejoin.
//! - **Fill rows never reach strategy inputs.** A fill timeframe serves quote cuts only, and may not
//!   also be an input timeframe.

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::{
    source_binding::{BindingDigest, UntrustedSourceBindingLocator},
    universe_selection::UntrustedUniverseSelectionLocatorV1,
};

pub(crate) mod authority;
pub(crate) mod schedule;
pub(crate) mod view;

/// The most members one custody holds, as the frame evidence and the native resolver do.
pub const PIT_WINDOW_CUSTODY_MAX_MEMBERS_V1: usize = 2;

/// One custody: the whole window of a fixed member set, committed once.
///
/// Every timeframe is a row-timeframe label the Source Binding declares. The execution timeframe
/// is named here, not by a run, because the custody's commit mints its window schedule.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedPitWindowCustodyRequestV1 {
    /// The admitted schema 2 binding whose declarations and availability rule govern the rows.
    pub source_binding: UntrustedSourceBindingLocator,
    /// The Market Semantics fact the rows are read under; the Owner verifies it is the head in scope.
    pub market_semantics_identity: BindingDigest,
    /// The Universe Selection record whose members the custody holds; the Owner verifies every
    /// member is included throughout the window.
    pub universe_selection: UntrustedUniverseSelectionLocatorV1,
    /// Canonical instruments in canonical order, one or two, fixed for the whole window.
    pub members: Vec<String>,
    /// Inclusive start of the window, its warm-up included.
    pub window_start_ns: u64,
    /// Exclusive end of the window.
    pub window_end_ns_exclusive: u64,
    /// The timeframe a run's frames are enumerated from: a fixed interval among `input_timeframes`.
    pub execution_timeframe: String,
    /// The timeframes held for strategy inputs, the execution timeframe among them.
    pub input_timeframes: Vec<String>,
    /// A finer fixed interval that serves quote cuts only, never an input timeframe.
    pub fill_timeframe: Option<String>,
    /// `Some` for a correction successor, naming the custody it corrects; `None` for a root.
    pub predecessor: Option<UntrustedPitWindowCustodyClaimV1>,
    /// Every cross-section version this custody adds.
    pub cross_sections: Vec<UntrustedCrossSectionVersionV1>,
}

/// What one cross-section version does to the cross-section it belongs to.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CrossSectionVersionKindV1 {
    /// The first version of a cross-section.
    Original,
    /// A version that replaces its predecessor's rows.
    Correction,
    /// A version that withdraws the cross-section: it carries no rows, and a view drops it.
    Withdrawal,
}

/// Every row of one source, timeframe and event-effective instant, in one version.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedCrossSectionVersionV1 {
    /// An input timeframe or the fill timeframe of the custody.
    pub timeframe: String,
    /// For a bar, the interval-close instant its declaration labels it by.
    pub event_effective_ns: u64,
    pub kind: CrossSectionVersionKindV1,
    /// 1 for an original; the next sequence of its predecessor otherwise.
    pub correction_sequence: u64,
    /// The version this one corrects or withdraws; `None` exactly for an original.
    pub predecessor_version: Option<BindingDigest>,
    /// The publication instant of a source that publishes corrections. `None` for a source that
    /// does not, whose single version is published at its availability, which the Owner derives.
    pub publication_ns: Option<u64>,
    /// One row per member and field the timeframe's kind requires; empty exactly for a withdrawal.
    pub rows: Vec<UntrustedCustodyRowV1>,
}

/// One value as retrieved. The Owner derives the member key from member order and checks the
/// field set against the timeframe's declared kind.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedCustodyRowV1 {
    pub instrument: String,
    pub field: String,
    /// A JSON number on the wire; a value beyond `i64` cannot cross JSON and is refused there.
    pub value_mantissa: i128,
    pub value_scale: u8,
    /// The true instant Market Data retrieved this value: for a backfill, the day it ran, never a
    /// historical instant. Custody evidence only, outside every identity.
    pub retrieval_ns: u64,
    /// Where it was retrieved from, such as an archive or an endpoint. Custody evidence only.
    pub retrieval_route: String,
}

/// An untrusted claim naming a custody chain by its root; the Owner resolves the chain's head.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedPitWindowCustodyClaimV1 {
    pub chain_root: BindingDigest,
}

/// The Owner's answer to one committed or rejoined custody. It has no public constructor:
///
/// ```compile_fail
/// use vibe_data::owner::{pit_window_custody_v1::PitWindowCustodyReceiptV1, source_binding::BindingDigest};
/// let d = BindingDigest::from_untrusted_bytes([1; 32]);
/// let _ = PitWindowCustodyReceiptV1 {
///     custody_identity: d,
///     custody_digest: d,
///     chain_root: d,
///     chain_version: 1,
///     availability_rule_digest: d,
///     minting_cut_ns: 1,
/// };
/// ```
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PitWindowCustodyReceiptV1 {
    custody_identity: BindingDigest,
    custody_digest: BindingDigest,
    chain_root: BindingDigest,
    chain_version: u64,
    availability_rule_digest: BindingDigest,
    minting_cut_ns: u64,
}

impl PitWindowCustodyReceiptV1 {
    /// The receipt of a custody the Owner committed or holds. Only the Owner's custody calls it.
    pub(crate) const fn from_owner_custody(
        custody_identity: BindingDigest,
        custody_digest: BindingDigest,
        chain_root: BindingDigest,
        chain_version: u64,
        availability_rule_digest: BindingDigest,
        minting_cut_ns: u64,
    ) -> Self {
        Self {
            custody_identity,
            custody_digest,
            chain_root,
            chain_version,
            availability_rule_digest,
            minting_cut_ns,
        }
    }

    /// The custody this receipt answers.
    #[must_use]
    pub const fn custody_identity(&self) -> BindingDigest {
        self.custody_identity
    }

    #[must_use]
    pub const fn custody_digest(&self) -> BindingDigest {
        self.custody_digest
    }

    /// The root of the chain the custody belongs to; a run names the chain by it.
    #[must_use]
    pub const fn chain_root(&self) -> BindingDigest {
        self.chain_root
    }

    /// 1 for a root; one more than its predecessor's for a successor.
    #[must_use]
    pub const fn chain_version(&self) -> u64 {
        self.chain_version
    }

    #[must_use]
    pub const fn availability_rule_digest(&self) -> BindingDigest {
        self.availability_rule_digest
    }

    /// The Owner cut the custody was minted at. A rejoin returns the original one.
    #[must_use]
    pub const fn minting_cut_ns(&self) -> u64 {
        self.minting_cut_ns
    }
}

/// Why a custody was not committed. Every refusal writes nothing.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum PitWindowCustodyRefusalV1 {
    /// The request is malformed: shape, ordering, bounds, member count, or a timeframe label the
    /// binding does not declare.
    #[error("the PIT window custody request is malformed")]
    InvalidRequest,
    #[error("the Source Binding is not admitted under this locator")]
    SourceBindingUnavailable,
    /// `SOURCE_BINDING_DECLARES_NO_AVAILABILITY_RULE`: a schema 1 binding.
    #[error("the Source Binding declares no availability rule")]
    SourceBindingDeclaresNoAvailabilityRule,
    #[error("the Market Semantics fact is not the head in scope")]
    MarketSemanticsMismatch,
    /// `WINDOW_MEMBER_NOT_VALID_THROUGHOUT`: an Instrument Master validity or Universe membership
    /// that begins or ends inside the window.
    #[error("a member is not valid throughout the window")]
    WindowMemberNotValidThroughout,
    /// `PIT_WINDOW_EXECUTION_TIMEFRAME_NOT_FIXED_INTERVAL`.
    #[error("the execution timeframe is not a fixed interval")]
    ExecutionTimeframeNotFixedInterval,
    /// `AVAILABILITY_LAG_NOT_BELOW_BAR_INTERVAL`: no frame could be decided before the next opens.
    #[error("the availability lag is not below the execution bar interval")]
    AvailabilityLagNotBelowBarInterval,
    /// `FILL_TIMEFRAME_NOT_FINER_THAN_EXECUTION`.
    #[error("the fill timeframe is not finer than the execution timeframe")]
    FillTimeframeNotFinerThanExecution,
    /// `FILL_TIMEFRAME_IS_AN_INPUT_TIMEFRAME`: fill rows would otherwise reach strategy inputs.
    #[error("the fill timeframe is also an input timeframe")]
    FillTimeframeIsAnInputTimeframe,
    /// `RETRIEVAL_AFTER_MINTING_CUT`: a row retrieved after the cut the custody is minted at.
    #[error("a row was retrieved after the custody's minting cut")]
    RetrievalAfterMintingCut,
    /// `ROW_RETRIEVED_BEFORE_BAR_CLOSE`: a row retrieved before its bar closed, which a
    /// complete-only bar cannot be.
    #[error("a row was retrieved before its bar closed")]
    RowRetrievedBeforeBarClose,
    /// `VERSION_NOT_AVAILABLE_AT_MINTING_CUT`: a version whose derived availability or stated
    /// publication is later than the cut the custody is minted at.
    #[error("a version is not available at the custody's minting cut")]
    VersionNotAvailableAtMintingCut,
    /// Two versions naming one predecessor, a repeated sequence, or a publication that does not
    /// increase with the sequence.
    #[error("a cross-section's versions branch")]
    CrossSectionBranch,
    /// `CROSS_SECTION_CORRECTION_NOT_PUBLISHED_BY_SOURCE`: a correction, withdrawal or stated
    /// publication for a source that publishes no corrections.
    #[error("the source publishes no corrections")]
    CrossSectionCorrectionNotPublishedBySource,
    /// A successor that does not restate its predecessor's basis, window and timeframes exactly.
    #[error("a successor changes its predecessor's basis")]
    SuccessorBasisChanged,
    /// The same identity already holds another meaning.
    #[error("the custody identity holds another meaning")]
    IdentityConflict,
    #[error("the Market Data store is unavailable")]
    StoreUnavailable,
}

/// The sealed custody intake. A backfill writer calls it; no consumer can implement it.
#[async_trait]
pub trait PitWindowCustodyCommitV1: Send + Sync + sealed::Sealed {
    /// Commits one custody, or rejoins an identical one and returns its original receipt.
    ///
    /// # Errors
    ///
    /// Returns the refusal that names why nothing was written.
    async fn commit_pit_window_custody_v1(
        &self,
        request: UntrustedPitWindowCustodyRequestV1,
    ) -> Result<PitWindowCustodyReceiptV1, PitWindowCustodyRefusalV1>;
}

/// Opens the sole configured PIT window custody intake on the Market Data Owner's store, named by
/// `MARKET_DATA_OWNER_DATABASE_URL`.
///
/// # Errors
///
/// [`PitWindowCustodyRefusalV1::StoreUnavailable`] when the URL is missing or the store cannot be
/// opened.
pub async fn pit_window_custody_commit_from_environment_v1()
-> Result<Arc<dyn PitWindowCustodyCommitV1>, PitWindowCustodyRefusalV1> {
    super::postgres::pit_window_custody_commit_from_environment_v1().await
}

/// A run over part of one custody chain's window.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedPitWindowRunV1 {
    pub custody: UntrustedPitWindowCustodyClaimV1,
    /// Inclusive start of the run, from the sealed Research request; inside the custody window.
    pub run_start_ns: u64,
    /// Exclusive end of the run; it bounds the last frame's quote cut.
    pub run_end_ns_exclusive: u64,
}

/// One frame of a run, as a consumer asks the native Replay resolver for it.
///
/// It pins the head the run's frames were read from, so a correction committed between
/// enumeration and the per-frame reads cannot mix two heads into one run: the resolver reads the
/// view at that head, and refuses a head that is not in the named chain.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedPitWindowCustodyFrameV1 {
    pub custody: UntrustedPitWindowCustodyClaimV1,
    /// The head identity [`PitWindowRunFramesV1::head_identity`] returned.
    pub head_identity: BindingDigest,
    /// The frame's `e_k`.
    pub event_ns: u64,
}

/// Where one frame of a run lies. It has no public constructor:
///
/// ```compile_fail
/// use vibe_data::owner::pit_window_custody_v1::PitWindowFrameCoordinateV1;
/// let _ = PitWindowFrameCoordinateV1 { ordinal: 1, event_ns: 0, decision_cut_ns: 0 };
/// ```
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PitWindowFrameCoordinateV1 {
    ordinal: u64,
    event_ns: u64,
    decision_cut_ns: u64,
}

impl PitWindowFrameCoordinateV1 {
    /// 1 for the run's first frame, dense.
    #[must_use]
    pub const fn ordinal(&self) -> u64 {
        self.ordinal
    }

    /// `e_k`: the execution bar's event instant, from the window schedule.
    #[must_use]
    pub const fn event_ns(&self) -> u64 {
        self.event_ns
    }

    /// `d_k`: the derived availability of the frame's execution cross-section, before the next
    /// frame's event.
    #[must_use]
    pub const fn decision_cut_ns(&self) -> u64 {
        self.decision_cut_ns
    }
}

/// The frames of one run, read from the head of the named chain. It has no public constructor.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PitWindowRunFramesV1 {
    chain_root: BindingDigest,
    head_identity: BindingDigest,
    head_digest: BindingDigest,
    head_version: u64,
    frames: Vec<PitWindowFrameCoordinateV1>,
}

impl PitWindowRunFramesV1 {
    #[must_use]
    pub const fn chain_root(&self) -> BindingDigest {
        self.chain_root
    }

    /// The custody the frames were read from: the chain's head when they were read.
    #[must_use]
    pub const fn head_identity(&self) -> BindingDigest {
        self.head_identity
    }

    #[must_use]
    pub const fn head_digest(&self) -> BindingDigest {
        self.head_digest
    }

    #[must_use]
    pub const fn head_version(&self) -> u64 {
        self.head_version
    }

    /// Every frame of the run, in event order.
    #[must_use]
    pub fn frames(&self) -> &[PitWindowFrameCoordinateV1] {
        &self.frames
    }
}

/// Why a run's frames were not resolved.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum PitWindowRunRefusalV1 {
    #[error("the run request is malformed")]
    InvalidRequest,
    #[error("no custody chain has this root")]
    CustodyUnknown,
    #[error("the run does not lie inside the custody window")]
    RunOutsideCustodyWindow,
    /// `PIT_WINDOW_FRAME_NOT_COVERED`: a frame with no complete cross-section, including during
    /// warm-up, or one whose rows no availability instant reaches before the next frame.
    #[error("a frame of the run is not covered")]
    FrameNotCovered,
    /// A gap, the last one bounded by the run's end, with no quote cut.
    #[error("a gap of the run has no quote cut")]
    QuoteCutMissing,
    #[error("the Market Data store is unavailable")]
    StoreUnavailable,
}

/// The sealed read of a run's frame coordinates. A multi-frame consumer resolves each frame's
/// inputs and quote cut through the native Replay resolver, whose request gains a custody frame
/// source in the derived view slice.
#[async_trait]
pub trait PitWindowCustodyFramesV1: Send + Sync + sealed::Sealed {
    /// Enumerates the run's frames from the execution timeframe's window schedule.
    ///
    /// # Errors
    ///
    /// Returns the refusal that names why the run has no frame list.
    async fn resolve_pit_window_frames_v1(
        &self,
        run: UntrustedPitWindowRunV1,
    ) -> Result<PitWindowRunFramesV1, PitWindowRunRefusalV1>;
}

/// Where a verified observation batch comes from. The batch's own source accessor takes this in
/// the derived view slice, in place of its snapshot accessors.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PitObservationBatchSourceV1 {
    /// A committed PIT snapshot.
    CommittedSnapshot {
        snapshot_identity: BindingDigest,
        fact_digest: BindingDigest,
    },
    /// One frame's strategy inputs, derived from a custody chain. It names the chain's root, not
    /// its head, so a correction changes only the views that select it.
    CustodyView {
        chain_root: BindingDigest,
        view_identity: BindingDigest,
        event_ns: u64,
        decision_cut_ns: u64,
        derived_frontier_digest: BindingDigest,
    },
    /// One gap's quote cut, derived from a custody chain: Quote rows only, never fill bars.
    CustodyQuoteCut {
        chain_root: BindingDigest,
        quote_cut_identity: BindingDigest,
        instant_ns: u64,
        derivation: QuoteDerivationV1,
    },
}

/// How a quote cut's Quotes came to be.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum QuoteDerivationV1 {
    /// Best bid and offer the source stated.
    ObservedBbo,
    /// Bid and ask both the open of the first fill-timeframe bar that opens strictly after the
    /// frame's decision cut, both sizes that bar's traded volume.
    FillBarOpen {
        fill_timeframe_identity: BindingDigest,
    },
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use serde_json::json;

    use super::{
        CrossSectionVersionKindV1, UntrustedCrossSectionVersionV1, UntrustedPitWindowRunV1,
    };

    fn digest(byte: u8) -> serde_json::Value {
        serde_json::to_value(super::BindingDigest::from_untrusted_bytes([byte; 32])).unwrap()
    }

    /// The wire a backfill writer produces, field by field; a renamed field turns this red.
    #[rstest]
    fn a_cross_section_version_has_the_frozen_wire() {
        let wire = json!({
            "timeframe": "1d",
            "event_effective_ns": 86_400_000_000_000_u64,
            "kind": "ORIGINAL",
            "correction_sequence": 1,
            "predecessor_version": null,
            "publication_ns": null,
            "rows": [{
                "instrument": "BTCUSDT-PERP.BINANCE",
                "field": "CLOSE",
                "value_mantissa": 6_512_345,
                "value_scale": 2,
                "retrieval_ns": 1_790_000_000_000_000_000_u64,
                "retrieval_route": "data.binance.vision/monthly-klines"
            }]
        });
        let version: UntrustedCrossSectionVersionV1 = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(
            serde_json::to_value(&version).unwrap(),
            wire,
            "the wire round-trips exactly"
        );
        assert_eq!(version.kind, CrossSectionVersionKindV1::Original);
        assert_eq!(version.rows[0].value_mantissa, 6_512_345);
        assert_eq!(
            serde_json::to_value(CrossSectionVersionKindV1::Withdrawal).unwrap(),
            json!("WITHDRAWAL")
        );
    }

    #[rstest]
    fn a_run_names_its_chain_by_root_and_refuses_an_unknown_field() {
        let run = json!({
            "custody": {"chain_root": digest(7)},
            "run_start_ns": 1,
            "run_end_ns_exclusive": 2
        });
        let parsed: UntrustedPitWindowRunV1 = serde_json::from_value(run.clone()).unwrap();
        assert_eq!(parsed.run_end_ns_exclusive, 2);

        let mut stating = run;
        stating["execution_timeframe"] = json!("1d");
        assert!(serde_json::from_value::<UntrustedPitWindowRunV1>(stating).is_err());
    }
}
