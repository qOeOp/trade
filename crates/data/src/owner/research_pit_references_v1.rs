//! What Market Data answers about a Research request's instrument scope.
//!
//! R&D asks twice. Before it accepts a Research request it checks each requested identity, so a
//! mistyped instrument is refused before any Intent is frozen. When it issues the Intent's initial
//! PIT request it resolves every Market Data reference that request carries, so it states nothing
//! of its own. Both answers are read at Market Data's current decision cut, inside the caller's
//! transaction, and neither is a decision: the fixed-member evaluation when the PIT request is
//! issued remains the one, and an identity admissible here can still end in a terminal that is not
//! `AVAILABLE`.

use super::{
    pit_market_snapshot_intake_v1::MarketDataDecisionCutV1,
    source_binding::{BindingDigest, UntrustedSourceBindingLocator},
};

/// How one requested identity stands at Market Data's current decision cut.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResearchInstrumentAdmissibilityV1 {
    /// It resolves to an Instrument Master fact and has one membership fact in force in the
    /// current eligible-instrument frontier.
    Admissible,
    /// No Instrument Master fact for it is in force and observable at the cut.
    Unresolved,
    /// It resolves, but no single membership fact for it is in force in the current frontier, or
    /// there is no current frontier.
    NotInEligibleFrontier,
}

/// One requested identity and how it stands.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResearchInstrumentCheckRowV1 {
    identity: String,
    admissibility: ResearchInstrumentAdmissibilityV1,
}

impl ResearchInstrumentCheckRowV1 {
    pub(crate) const fn new(
        identity: String,
        admissibility: ResearchInstrumentAdmissibilityV1,
    ) -> Self {
        Self {
            identity,
            admissibility,
        }
    }

    /// The identity, exactly as the scope states it.
    #[must_use]
    pub fn identity(&self) -> &str {
        &self.identity
    }

    /// How it stands at the cut.
    #[must_use]
    pub const fn admissibility(&self) -> ResearchInstrumentAdmissibilityV1 {
        self.admissibility
    }
}

/// The early check of a whole scope, with the basis it was read on.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResearchInstrumentScopeCheckV1 {
    rows: Vec<ResearchInstrumentCheckRowV1>,
    eligible_instrument_frontier: Option<BindingDigest>,
    decision_cut: MarketDataDecisionCutV1,
}

impl ResearchInstrumentScopeCheckV1 {
    pub(crate) const fn new(
        rows: Vec<ResearchInstrumentCheckRowV1>,
        eligible_instrument_frontier: Option<BindingDigest>,
        decision_cut: MarketDataDecisionCutV1,
    ) -> Self {
        Self {
            rows,
            eligible_instrument_frontier,
            decision_cut,
        }
    }

    /// One row per identity, in the scope's order.
    #[must_use]
    pub fn rows(&self) -> &[ResearchInstrumentCheckRowV1] {
        &self.rows
    }

    /// Whether every identity is admissible.
    #[must_use]
    pub fn is_admissible(&self) -> bool {
        self.rows
            .iter()
            .all(|row| row.admissibility == ResearchInstrumentAdmissibilityV1::Admissible)
    }

    /// The frontier the rows were judged against; `None` when Market Data holds no current one,
    /// and then every row is [`ResearchInstrumentAdmissibilityV1::NotInEligibleFrontier`].
    #[must_use]
    pub const fn eligible_instrument_frontier(&self) -> Option<BindingDigest> {
        self.eligible_instrument_frontier
    }

    /// The Owner's decision cut the rows were judged at.
    #[must_use]
    pub const fn decision_cut(&self) -> &MarketDataDecisionCutV1 {
        &self.decision_cut
    }
}

/// Every Market Data reference an initial PIT request for one scope carries.
///
/// There is no Instrument Master digest among them. The PIT intake stamps its own over the
/// request's before it validates or persists the request, and that stamp is minted by a
/// resolution keyed on the request's correlation and event instant, which no read of the scope
/// can reproduce. A requester therefore states no Instrument Master claim.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResearchPitReferencesV1 {
    eligible_instrument_frontier: BindingDigest,
    source_binding: UntrustedSourceBindingLocator,
    source_binding_lineage_root: BindingDigest,
    correction_frontier_digest: BindingDigest,
    market_semantics_identity: BindingDigest,
    decision_cut: MarketDataDecisionCutV1,
}

/// The fields of [`ResearchPitReferencesV1`], as Market Data resolves them.
pub(crate) struct ResearchPitReferencesFieldsV1 {
    pub(crate) eligible_instrument_frontier: BindingDigest,
    pub(crate) source_binding: UntrustedSourceBindingLocator,
    pub(crate) source_binding_lineage_root: BindingDigest,
    pub(crate) correction_frontier_digest: BindingDigest,
    pub(crate) market_semantics_identity: BindingDigest,
    pub(crate) decision_cut: MarketDataDecisionCutV1,
}

impl ResearchPitReferencesV1 {
    pub(crate) fn new(fields: ResearchPitReferencesFieldsV1) -> Self {
        Self {
            eligible_instrument_frontier: fields.eligible_instrument_frontier,
            source_binding: fields.source_binding,
            source_binding_lineage_root: fields.source_binding_lineage_root,
            correction_frontier_digest: fields.correction_frontier_digest,
            market_semantics_identity: fields.market_semantics_identity,
            decision_cut: fields.decision_cut,
        }
    }

    /// The current eligible-instrument frontier, for the Universe Selection request.
    #[must_use]
    pub const fn eligible_instrument_frontier(&self) -> BindingDigest {
        self.eligible_instrument_frontier
    }

    /// The current head of the one Source Binding lineage, for the PIT request.
    #[must_use]
    pub const fn source_binding(&self) -> &UntrustedSourceBindingLocator {
        &self.source_binding
    }

    /// That lineage's root, for the Universe Selection request.
    #[must_use]
    pub const fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root
    }

    /// The correction frontier the identities' membership facts name, for the Universe Selection
    /// request.
    #[must_use]
    pub const fn correction_frontier_digest(&self) -> BindingDigest {
        self.correction_frontier_digest
    }

    /// The Market Semantics identity the intake derives from that Source Binding, for the PIT
    /// request.
    #[must_use]
    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }

    /// The Owner's decision cut with the clock evidence the PIT intake compares exactly.
    #[must_use]
    pub const fn decision_cut(&self) -> &MarketDataDecisionCutV1 {
        &self.decision_cut
    }
}

/// Why no references were resolved.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ResearchPitReferencesErrorV1 {
    /// Market Data holds no clock head, so it has no decision cut to read at.
    #[error("Market Data holds no decision cut")]
    ClockUnavailable,
    /// An identity is not admissible; the check says which and why.
    #[error("an identity of the scope is not admissible")]
    InstrumentNotAdmissible,
    /// The identities' membership facts name more than one Source Binding lineage or correction
    /// frontier, and one PIT request binds one Source Binding.
    #[error("the scope's identities name more than one Source Binding lineage")]
    SourceBindingLineagesDiffer,
    /// The one lineage the identities name has no current head, or its head is not admitted.
    #[error("the scope's Source Binding lineage has no admitted head")]
    SourceBindingUnavailable,
    /// The store could not be read, or returned evidence Market Data does not trust.
    #[error("Market Data store unavailable")]
    StoreUnavailable,
}

/// Why the early check produced no rows.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ResearchInstrumentScopeReadErrorV1 {
    /// Market Data holds no clock head, so it has no decision cut to read at.
    #[error("Market Data holds no decision cut")]
    ClockUnavailable,
    /// The store could not be read, or returned evidence Market Data does not trust.
    #[error("Market Data store unavailable")]
    StoreUnavailable,
}
