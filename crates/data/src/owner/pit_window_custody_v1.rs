//! The interface of PIT window custody (slice T0): what a backfill writer commits, and how a
//! multi-frame consumer finds the frames of a run.
//!
//! This module freezes the types two lanes build against in parallel with the custody itself, and
//! holds the custody's pure authority in its `authority` module, its window schedule in `schedule`
//! and its derived view in `view`. The custody aggregate's PostgreSQL store implements
//! [`PitWindowCustodyCommitV1`] and alone constructs a receipt; the derived view (T0-5) reads a
//! run's frames from a chain's head and alone constructs a frame coordinate, and the verified
//! batch seal's custody branches alone construct a custody-sourced batch.
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
    instrument_master::{
        InstrumentMasterReadbackV1, V1StructuralPublicTermsProjectionError,
        ValidatedInstrumentMasterV1StructuralPublicTermsProjection,
    },
    market_semantics::MarketSemanticsValueV1,
    market_semantics_admission_v1::MarketSemanticsValueSubmissionV1,
    source_binding::{BindingDigest, UntrustedSourceBindingLocator},
    universe_selection::UntrustedUniverseSelectionLocatorV1,
};

pub(crate) mod authority;
pub(crate) mod chain_records;
pub(crate) mod quote_cut;
pub(crate) mod schedule;
#[cfg(feature = "sealed-strategy-input-acceptance")]
pub mod sealed_acceptance;
#[cfg(feature = "sealed-strategy-input-acceptance")]
pub mod sealed_acceptance_chain;
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
    /// The typed Market Semantics value the rows are read under: an untrusted claim. The Owner
    /// records it once per custody chain, under the compatibility scope the binding implies, and
    /// refuses it when another head of that scope states another value.
    pub market_semantics_value: MarketSemanticsValueSubmissionV1,
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
    /// `VALUE_FINER_THAN_SERIES_SCALE`: a row value with more than nine decimal places, the
    /// fixed scale every custody series is stated at; it is never rounded.
    #[error("a value is finer than the custody series scale")]
    ValueFinerThanSeriesScale,
    /// `MARKET_SEMANTICS_SCOPE_VALUE_CONFLICT`: the claimed Market Semantics value differs from
    /// the value a head of its compatibility scope - a snapshot's or another chain's - states.
    #[error("the Market Semantics value differs from its scope's")]
    MarketSemanticsScopeValueConflict,
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
    /// A frame the Owner's derived view enumerated. Only the frames port calls it.
    pub(crate) const fn from_owner_view(ordinal: u64, event_ns: u64, decision_cut_ns: u64) -> Self {
        Self {
            ordinal,
            event_ns,
            decision_cut_ns,
        }
    }

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

/// What a run's custody chain was committed on, read with its frames: the Universe Selection, the
/// Instrument Master cut and the Market Semantics fact its root bound, and the members and window
/// they hold. A consumer takes a run's universe, cut and Market Semantics from here, never from its
/// own evaluation. It has no public constructor:
///
/// ```compile_fail
/// use vibe_data::owner::{pit_window_custody_v1::PitWindowChainBasisV1, source_binding::BindingDigest};
/// let d = BindingDigest::from_untrusted_bytes([1; 32]);
/// let _ = PitWindowChainBasisV1 {
///     chain_root: d,
///     head_identity: d,
///     universe_selection_record: (d, d),
///     instrument_master_key: d,
///     market_semantics_identity: d,
///     members: Vec::new(),
///     window: (0, 1),
/// };
/// ```
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PitWindowChainBasisV1 {
    chain_root: BindingDigest,
    head_identity: BindingDigest,
    universe_selection: UntrustedUniverseSelectionLocatorV1,
    universe_selection_record: (BindingDigest, BindingDigest),
    instrument_master_key: BindingDigest,
    instrument_master_cut: Arc<InstrumentMasterReadbackV1>,
    market_semantics_identity: BindingDigest,
    market_semantics_value: MarketSemanticsValueV1,
    members: Vec<String>,
    window: (u64, u64),
}

/// The parts of a chain basis, as the Owner's read verified them.
pub(crate) struct ChainBasisPartsV1 {
    pub(crate) chain_root: BindingDigest,
    pub(crate) head_identity: BindingDigest,
    pub(crate) universe_selection: UntrustedUniverseSelectionLocatorV1,
    pub(crate) universe_selection_record: (BindingDigest, BindingDigest),
    pub(crate) instrument_master_key: BindingDigest,
    pub(crate) instrument_master_cut: InstrumentMasterReadbackV1,
    pub(crate) market_semantics_identity: BindingDigest,
    pub(crate) market_semantics_value: MarketSemanticsValueV1,
    pub(crate) members: Vec<String>,
    pub(crate) window: (u64, u64),
}

impl PitWindowChainBasisV1 {
    /// The basis the Owner's read verified against the chain's own records. Only the frames read
    /// calls it.
    pub(crate) fn from_owner_chain(parts: ChainBasisPartsV1) -> Self {
        Self {
            chain_root: parts.chain_root,
            head_identity: parts.head_identity,
            universe_selection: parts.universe_selection,
            universe_selection_record: parts.universe_selection_record,
            instrument_master_key: parts.instrument_master_key,
            instrument_master_cut: Arc::new(parts.instrument_master_cut),
            market_semantics_identity: parts.market_semantics_identity,
            market_semantics_value: parts.market_semantics_value,
            members: parts.members,
            window: parts.window,
        }
    }

    /// The root of the chain the basis belongs to.
    #[must_use]
    pub const fn chain_root(&self) -> BindingDigest {
        self.chain_root
    }

    /// The head the run's frames were read from. The basis is the root's, whichever head that is.
    #[must_use]
    pub const fn head_identity(&self) -> BindingDigest {
        self.head_identity
    }

    /// The Universe Selection record the root custody named, as its locator.
    #[must_use]
    pub const fn universe_selection(&self) -> UntrustedUniverseSelectionLocatorV1 {
        self.universe_selection
    }

    /// The stored Universe Selection record the root custody's locator resolves to, as `(record
    /// identity, record digest)`: the key `read_universe_selection_members_for_rd_v1` reads the
    /// custody's members by. It is resolved in the same read as the frames, and its record's
    /// request meaning digest is the locator's.
    #[must_use]
    pub const fn universe_selection_record(&self) -> (BindingDigest, BindingDigest) {
        self.universe_selection_record
    }

    /// The Instrument Master key the root custody record binds, equal to the chain's Instrument
    /// Master link's key: the digest every frame's view batch carries as its
    /// `instrument_master_digest`.
    #[must_use]
    pub const fn instrument_master_key(&self) -> BindingDigest {
        self.instrument_master_key
    }

    /// The Instrument Master cut the root's commit issued over the members, as the Owner reads it
    /// back: its public facts and economic terms.
    #[must_use]
    pub fn instrument_master_cut(&self) -> &InstrumentMasterReadbackV1 {
        &self.instrument_master_cut
    }

    /// The Market Semantics fact the custody's rows are read under.
    #[must_use]
    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }

    /// The typed Market Semantics value the root recorded, equal to the chain's Market Semantics
    /// fact's.
    #[must_use]
    pub const fn market_semantics_value(&self) -> &MarketSemanticsValueV1 {
        &self.market_semantics_value
    }

    /// The custody's members, in canonical order.
    #[must_use]
    pub fn members(&self) -> &[String] {
        &self.members
    }

    /// The custody window, `[start, end)` in nanoseconds, its warm-up included.
    #[must_use]
    pub const fn window(&self) -> (u64, u64) {
        self.window
    }

    /// The UNIQUE `(venue_identity, source_identity)` mapping the member's V1 fact carries in this
    /// basis's Instrument Master cut. R&D must not guess this pair when calling
    /// [`InstrumentMasterReadbackV1::project_validated_v1_crypto_perpetual_structural_public_terms`]:
    /// it is derived here, never picked from more than one candidate.
    ///
    /// # Errors
    ///
    /// Returns [`PitWindowMemberMappingErrorV1::NotAMember`] if `canonical_identity` is not one of
    /// [`Self::members`] or has no fact in [`Self::instrument_master_cut`],
    /// [`PitWindowMemberMappingErrorV1::NoMapping`] if its fact carries no mapping, and
    /// [`PitWindowMemberMappingErrorV1::AmbiguousMapping`] if it carries more than one.
    pub fn member_venue_source(
        &self,
        canonical_identity: &str,
    ) -> Result<(&str, &str), PitWindowMemberMappingErrorV1> {
        if !self
            .members
            .iter()
            .any(|member| member == canonical_identity)
        {
            return Err(PitWindowMemberMappingErrorV1::NotAMember);
        }
        let fact = self
            .instrument_master_cut
            .facts()
            .iter()
            .find(|fact| fact.canonical_identity() == canonical_identity)
            .ok_or(PitWindowMemberMappingErrorV1::NotAMember)?;
        match fact.mappings() {
            [] => Err(PitWindowMemberMappingErrorV1::NoMapping),
            [mapping] => Ok((
                mapping.venue_identity.as_str(),
                mapping.source_identity.as_str(),
            )),
            _ => Err(PitWindowMemberMappingErrorV1::AmbiguousMapping),
        }
    }

    /// The member's V1 structural public terms: the mapping [`Self::member_venue_source`] selects,
    /// projected through
    /// [`InstrumentMasterReadbackV1::project_validated_v1_crypto_perpetual_structural_public_terms`].
    /// The selection is pure: no store read and no floor change beyond the basis already held.
    ///
    /// # Errors
    ///
    /// Returns the mapping selection error, or [`PitWindowMemberMappingErrorV1::Projection`]
    /// wrapping the projection's own refusal.
    pub fn structural_public_terms(
        &self,
        canonical_identity: &str,
    ) -> Result<
        ValidatedInstrumentMasterV1StructuralPublicTermsProjection,
        PitWindowMemberMappingErrorV1,
    > {
        let (venue_identity, source_identity) = self.member_venue_source(canonical_identity)?;
        self.instrument_master_cut
            .project_validated_v1_crypto_perpetual_structural_public_terms(
                canonical_identity,
                venue_identity,
                source_identity,
            )
            .map_err(PitWindowMemberMappingErrorV1::Projection)
    }
}

/// Why a custody member's V1 venue/source mapping could not be selected, or the structural public
/// terms it selects could not be projected.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum PitWindowMemberMappingErrorV1 {
    #[error("the canonical identity is not a member of this chain basis")]
    NotAMember,
    #[error("the member's V1 fact in this basis's Instrument Master cut carries no mapping")]
    NoMapping,
    #[error(
        "the member's V1 fact in this basis's Instrument Master cut carries more than one mapping"
    )]
    AmbiguousMapping,
    #[error("the structural public terms projection failed: {0}")]
    Projection(#[source] V1StructuralPublicTermsProjectionError),
}

/// The frames of one run, read from the head of the named chain. It has no public constructor:
///
/// ```compile_fail
/// use vibe_data::owner::{pit_window_custody_v1::PitWindowRunFramesV1, source_binding::BindingDigest};
/// let d = BindingDigest::from_untrusted_bytes([1; 32]);
/// let _ = PitWindowRunFramesV1 {
///     chain_root: d,
///     head_identity: d,
///     head_digest: d,
///     head_version: 1,
///     frames: Vec::new(),
/// };
/// ```
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PitWindowRunFramesV1 {
    chain_root: BindingDigest,
    head_identity: BindingDigest,
    head_digest: BindingDigest,
    head_version: u64,
    frames: Vec<PitWindowFrameCoordinateV1>,
    basis: PitWindowChainBasisV1,
}

impl PitWindowRunFramesV1 {
    /// The frames the Owner's derived view enumerated from the head it read, with the basis read
    /// in the same transaction. Only the frames port calls it.
    pub(crate) const fn from_owner_view(
        chain_root: BindingDigest,
        head_identity: BindingDigest,
        head_digest: BindingDigest,
        head_version: u64,
        frames: Vec<PitWindowFrameCoordinateV1>,
        basis: PitWindowChainBasisV1,
    ) -> Self {
        Self {
            chain_root,
            head_identity,
            head_digest,
            head_version,
            frames,
            basis,
        }
    }

    /// What the chain was committed on, read in the same transaction and at the same head as the
    /// frames.
    #[must_use]
    pub const fn basis(&self) -> &PitWindowChainBasisV1 {
        &self.basis
    }

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
/// inputs and quote cut through the native Replay resolver, naming the frame by a custody frame
/// source that pins the head the frames were read from.
///
/// Every gap's quote cut is checked here, at run level, once its derivation exists (T0-6); until
/// then the read does not check gaps, and the per-frame read refuses every frame for want of one.
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
        CrossSectionVersionKindV1, PitWindowMemberMappingErrorV1, UntrustedCrossSectionVersionV1,
        UntrustedPitWindowRunV1,
    };
    use crate::owner::{
        instrument_master::{
            BACKTEST_OWNER_V1, ClockProjection, InstrumentClass, InstrumentDecimal,
            InstrumentMasterCutV1, InstrumentMasterFactProposalV1, InstrumentMasterFactV1,
            InstrumentMasterReadbackV1, InstrumentMasterResolution, InstrumentMasterScopeV1,
            InstrumentVenueSourceMapping, UntrustedInstrumentMasterRequestV1,
            authority::{build_cut, build_fact, build_readback, build_receipt},
        },
        shared_time_evidence::build_head_fact,
        source_binding::{
            BindingDigest, MarketDataClockAdmission, MarketDataClockComparisonRule,
            MarketDataClockCutKind,
        },
    };

    fn digest(byte: u8) -> serde_json::Value {
        serde_json::to_value(super::BindingDigest::from_untrusted_bytes([byte; 32])).unwrap()
    }

    fn d(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    /// A sealed V1 crypto-perpetual Instrument Master readback for one member, carrying exactly the
    /// mappings given.
    fn member_mapping_readback(
        canonical_identity: &str,
        mappings: Vec<InstrumentVenueSourceMapping>,
    ) -> InstrumentMasterReadbackV1 {
        let admission = MarketDataClockAdmission {
            cut_kind: MarketDataClockCutKind::MarketDataAsOf,
            clock_identity: "12345678901234567890123456789012".into(),
            clock_epoch: "abcdefghijklmnopqrstuvwxyzABCDEF".into(),
            monotonic_sequence: 1,
            wall_observed: 60,
            decision_cut: 60,
            valid_through: 100,
            restart_continuity_digest: d(30),
            uncertainty_bound: 1,
            skew_bound: 2,
            comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
        };
        let head = build_head_fact(&admission, None).unwrap();
        let fact = build_fact(
            InstrumentMasterFactProposalV1 {
                canonical_identity: canonical_identity.into(),
                predecessor_fact_digest: None,
                mappings,
                instrument_class: InstrumentClass::CryptoPerpetual,
                base_currency: Some("ETH".into()),
                quote_currency: Some("USDT".into()),
                settlement_currency: Some("USDT".into()),
                margin_currency: Some("USDT".into()),
                price_increment: InstrumentDecimal {
                    mantissa: 1,
                    scale: 2,
                },
                quantity_increment: InstrumentDecimal {
                    mantissa: 1,
                    scale: 0,
                },
                contract_multiplier: InstrumentDecimal {
                    mantissa: 1,
                    scale: 0,
                },
                calendar_identity: "CRYPTO-CONTINUOUS-V1".into(),
                session_identity: "CRYPTO-CONTINUOUS-V1".into(),
                time_zone_identity: "UTC".into(),
                lifecycle_frontier: d(31),
                corporate_action_frontier: d(32),
                historical_membership_frontier: d(33),
                market_semantics_identity: d(34),
                source_frontier: d(35),
                correction_frontier: d(36),
                effective_from: 0,
                effective_until: Some(200),
                provider_available: 50,
                retrieval: 51,
                correction_publication: 52,
                owner_observation: 55,
            },
            &head.handoff,
            None,
        )
        .unwrap();
        let request = UntrustedInstrumentMasterRequestV1 {
            request_identity: d(40),
            request_meaning_digest: d(41),
            consumer_role: BACKTEST_OWNER_V1.into(),
            scope: InstrumentMasterScopeV1::ExactInstrument(canonical_identity.into()),
            effective_instant: 0,
            owner_observation: 59,
            decision_cut: 60,
            clock_head: head.handoff.locator().clone(),
            lifecycle_frontier: d(31),
            corporate_action_frontier: d(32),
            historical_membership_frontier: d(33),
            market_semantics_identity: d(34),
            source_frontier: d(35),
            correction_frontier: d(36),
            stable_correlation: d(42),
        };
        let cut = build_cut(
            &request,
            vec![canonical_identity.into()],
            std::slice::from_ref(&fact),
            fact.clock.clone(),
        )
        .unwrap();
        let receipt = build_receipt(&request, &[fact], &cut, d(43), 1).unwrap();
        build_readback(&receipt).unwrap()
    }

    fn raw_clock() -> ClockProjection {
        ClockProjection {
            clock_identity: [0u8; 32],
            clock_epoch: [0u8; 32],
            monotonic_sequence: 1,
            wall_observed: 60,
            decision_cut: 60,
            head_identity: d(2),
            head_digest: d(6),
            valid_through: 100,
            restart_continuity_digest: d(30),
            uncertainty_bound: 1,
            skew_bound: 2,
            epoch_proof_identity: None,
            epoch_proof_digest: None,
        }
    }

    /// Builds an `InstrumentMasterFactV1` directly, bypassing the Owner's admission validation
    /// that today refuses an empty mapping set. The member selection defended here (never a pick)
    /// must hold even against a fact the admission does not let through, since the fact's own
    /// author never constructed its mapping count.
    fn raw_fact_with_mappings(
        canonical_identity: &str,
        mappings: Vec<InstrumentVenueSourceMapping>,
    ) -> InstrumentMasterFactV1 {
        InstrumentMasterFactV1 {
            proposal: InstrumentMasterFactProposalV1 {
                canonical_identity: canonical_identity.into(),
                predecessor_fact_digest: None,
                mappings,
                instrument_class: InstrumentClass::CryptoPerpetual,
                base_currency: Some("ETH".into()),
                quote_currency: Some("USDT".into()),
                settlement_currency: Some("USDT".into()),
                margin_currency: Some("USDT".into()),
                price_increment: InstrumentDecimal {
                    mantissa: 1,
                    scale: 2,
                },
                quantity_increment: InstrumentDecimal {
                    mantissa: 1,
                    scale: 0,
                },
                contract_multiplier: InstrumentDecimal {
                    mantissa: 1,
                    scale: 0,
                },
                calendar_identity: "CRYPTO-CONTINUOUS-V1".into(),
                session_identity: "CRYPTO-CONTINUOUS-V1".into(),
                time_zone_identity: "UTC".into(),
                lifecycle_frontier: d(31),
                corporate_action_frontier: d(32),
                historical_membership_frontier: d(33),
                market_semantics_identity: d(34),
                source_frontier: d(35),
                correction_frontier: d(36),
                effective_from: 10,
                effective_until: Some(200),
                provider_available: 50,
                retrieval: 51,
                correction_publication: 52,
                owner_observation: 55,
            },
            clock: raw_clock(),
            canonical_bytes: Vec::new(),
            identity: d(99),
        }
    }

    /// Builds an `InstrumentMasterReadbackV1` directly around one raw fact; its own identities are
    /// unchecked, which is harmless here because `member_venue_source`'s zero-mapping refusal never
    /// reaches `verify_instrument_master_readback`.
    fn raw_readback_for(fact: InstrumentMasterFactV1) -> InstrumentMasterReadbackV1 {
        let canonical_identity = fact.canonical_identity().to_owned();
        let cut = InstrumentMasterCutV1 {
            request_identity: d(21),
            request_meaning_digest: d(22),
            scope: InstrumentMasterScopeV1::ExactInstrument(canonical_identity.clone()),
            expected_members: vec![canonical_identity.clone()],
            effective_instant: 0,
            owner_observation: 59,
            decision_cut: 60,
            clock: raw_clock(),
            resolutions: vec![InstrumentMasterResolution {
                canonical_identity,
                fact_digest: fact.identity(),
            }],
            frontiers: [d(31), d(32), d(33), d(34), d(35), d(36)],
            canonical_bytes: Vec::new(),
            identity: d(98),
        };
        InstrumentMasterReadbackV1 {
            request_identity: d(21),
            request_meaning_digest: d(22),
            facts: vec![fact],
            cut,
            stable_correlation: d(23),
            store_generation_identity: d(30),
            store_append_sequence: 7,
            receipt_identity: d(97),
            outbox_identity: d(96),
            canonical_bytes: Vec::new(),
            identity: d(95),
        }
    }

    /// Builds a chain basis naming exactly one member, over the given Instrument Master cut.
    fn basis_for(
        canonical_identity: &str,
        cut: InstrumentMasterReadbackV1,
    ) -> super::PitWindowChainBasisV1 {
        use super::{
            ChainBasisPartsV1, MarketSemanticsValueV1, UntrustedUniverseSelectionLocatorV1,
        };
        use crate::owner::market_semantics::{
            MarketSemanticsPriceAdjustmentV1, MarketSemanticsTimestampBasisV1,
        };

        super::PitWindowChainBasisV1::from_owner_chain(ChainBasisPartsV1 {
            chain_root: d(1),
            head_identity: d(2),
            universe_selection: UntrustedUniverseSelectionLocatorV1::from_untrusted(d(3), d(4)),
            universe_selection_record: (d(7), d(8)),
            instrument_master_key: d(9),
            instrument_master_cut: cut,
            market_semantics_identity: d(5),
            market_semantics_value: MarketSemanticsValueV1 {
                normalization_identity: d(31),
                price_adjustment: MarketSemanticsPriceAdjustmentV1::Raw,
                timestamp_basis: MarketSemanticsTimestampBasisV1::IntervalClose,
                price_unit_identity: d(32),
                size_unit_identity: d(33),
            },
            members: vec![canonical_identity.to_owned()],
            window: (10, 20),
        })
    }

    /// A member with exactly one mapping returns it, and `structural_public_terms` equals a direct
    /// projection call with the selected pair.
    #[rstest]
    fn a_single_mapping_member_resolves_and_projects() {
        const MEMBER: &str = "ETHUSDT-PERP.SIM";
        let mappings = vec![InstrumentVenueSourceMapping {
            venue_identity: "SIM".into(),
            source_identity: "BINANCE".into(),
            source_instrument: b"ETHUSDT-PERP".to_vec(),
        }];
        let readback = member_mapping_readback(MEMBER, mappings);
        let direct = readback
            .project_validated_v1_crypto_perpetual_structural_public_terms(MEMBER, "SIM", "BINANCE")
            .expect("the unique mapping projects");
        let basis = basis_for(MEMBER, readback);

        assert_eq!(
            basis.member_venue_source(MEMBER),
            Ok(("SIM", "BINANCE")),
            "the unique mapping is selected"
        );
        assert_eq!(
            basis.structural_public_terms(MEMBER),
            Ok(direct),
            "structural_public_terms equals a direct projection call with the selected pair"
        );
    }

    /// A member with no mapping is refused by name, never picked.
    #[rstest]
    fn a_member_with_no_mapping_is_refused() {
        const MEMBER: &str = "ETHUSDT-PERP.SIM";
        let readback = raw_readback_for(raw_fact_with_mappings(MEMBER, Vec::new()));
        let basis = basis_for(MEMBER, readback);

        assert_eq!(
            basis.member_venue_source(MEMBER),
            Err(PitWindowMemberMappingErrorV1::NoMapping)
        );
        assert_eq!(
            basis.structural_public_terms(MEMBER),
            Err(PitWindowMemberMappingErrorV1::NoMapping)
        );
    }

    /// A member with more than one mapping is refused by name, never picked.
    #[rstest]
    fn a_member_with_more_than_one_mapping_is_refused() {
        const MEMBER: &str = "ETHUSDT-PERP.SIM";
        let mappings = vec![
            InstrumentVenueSourceMapping {
                venue_identity: "SIM".into(),
                source_identity: "BINANCE".into(),
                source_instrument: b"ETHUSDT-PERP".to_vec(),
            },
            InstrumentVenueSourceMapping {
                venue_identity: "SIM".into(),
                source_identity: "BINANCE".into(),
                source_instrument: b"ETHUSDT-PERP-ALT".to_vec(),
            },
        ];
        let readback = member_mapping_readback(MEMBER, mappings);
        let basis = basis_for(MEMBER, readback);

        assert_eq!(
            basis.member_venue_source(MEMBER),
            Err(PitWindowMemberMappingErrorV1::AmbiguousMapping)
        );
        assert_eq!(
            basis.structural_public_terms(MEMBER),
            Err(PitWindowMemberMappingErrorV1::AmbiguousMapping)
        );
    }

    /// A canonical identity outside the basis's member set is refused by name.
    #[rstest]
    fn a_non_member_is_refused() {
        const MEMBER: &str = "ETHUSDT-PERP.SIM";
        let mappings = vec![InstrumentVenueSourceMapping {
            venue_identity: "SIM".into(),
            source_identity: "BINANCE".into(),
            source_instrument: b"ETHUSDT-PERP".to_vec(),
        }];
        let readback = member_mapping_readback(MEMBER, mappings);
        let basis = basis_for(MEMBER, readback);

        assert_eq!(
            basis.member_venue_source("BTCUSDT-PERP.SIM"),
            Err(PitWindowMemberMappingErrorV1::NotAMember)
        );
        assert_eq!(
            basis.structural_public_terms("BTCUSDT-PERP.SIM"),
            Err(PitWindowMemberMappingErrorV1::NotAMember)
        );
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

    /// Each accessor of a chain basis returns the part the Owner's read verified, and a run's
    /// frames carry the basis they were read with.
    #[rstest]
    fn a_chain_basis_returns_each_part_it_was_read_with() {
        use super::{
            ChainBasisPartsV1, MarketSemanticsValueV1, PitWindowChainBasisV1,
            PitWindowFrameCoordinateV1, PitWindowRunFramesV1, UntrustedUniverseSelectionLocatorV1,
        };
        use crate::owner::market_semantics::{
            MarketSemanticsPriceAdjustmentV1, MarketSemanticsTimestampBasisV1,
        };

        let d = |byte: u8| super::BindingDigest::from_untrusted_bytes([byte; 32]);
        let value = MarketSemanticsValueV1 {
            normalization_identity: d(31),
            price_adjustment: MarketSemanticsPriceAdjustmentV1::Raw,
            timestamp_basis: MarketSemanticsTimestampBasisV1::IntervalClose,
            price_unit_identity: d(32),
            size_unit_identity: d(33),
        };
        let cut = crate::owner::calendar::tests::instrument_readback("XNYS-CALENDAR-V1");
        let cut_identity = cut.identity();
        let basis = PitWindowChainBasisV1::from_owner_chain(ChainBasisPartsV1 {
            chain_root: d(1),
            head_identity: d(2),
            universe_selection: UntrustedUniverseSelectionLocatorV1::from_untrusted(d(3), d(4)),
            universe_selection_record: (d(7), d(8)),
            instrument_master_key: d(9),
            instrument_master_cut: cut,
            market_semantics_identity: d(5),
            market_semantics_value: value,
            members: vec![
                "BTCUSDT-PERP.BINANCE".to_owned(),
                "ETHUSDT-PERP.BINANCE".to_owned(),
            ],
            window: (10, 20),
        });

        assert_eq!(basis.chain_root(), d(1));
        assert_eq!(basis.head_identity(), d(2));
        assert_eq!(
            basis.universe_selection(),
            UntrustedUniverseSelectionLocatorV1::from_untrusted(d(3), d(4))
        );
        assert_eq!(basis.universe_selection_record(), (d(7), d(8)));
        assert_eq!(basis.instrument_master_key(), d(9));
        assert_eq!(basis.instrument_master_cut().identity(), cut_identity);
        assert_eq!(basis.market_semantics_identity(), d(5));
        assert_eq!(basis.market_semantics_value(), &value);
        assert_eq!(
            basis.members(),
            ["BTCUSDT-PERP.BINANCE", "ETHUSDT-PERP.BINANCE"]
        );
        assert_eq!(basis.window(), (10, 20));

        let frames = PitWindowRunFramesV1::from_owner_view(
            d(1),
            d(2),
            d(6),
            1,
            vec![PitWindowFrameCoordinateV1::from_owner_view(1, 12, 13)],
            basis.clone(),
        );
        assert_eq!(frames.basis(), &basis);
        assert_eq!(
            frames.clone(),
            frames,
            "a run's frames clone with their basis"
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
