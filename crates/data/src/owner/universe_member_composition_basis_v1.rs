//! What a universe-member Replay composition is composed from, as Market Data holds it for one
//! snapshot.
//!
//! The locator-only issuance command names four records besides the snapshot and its Source
//! Binding: the Universe Selection, the Reference Fact R0 record, the Market Semantics readback and
//! the correction policy. Each is fixed by the snapshot, and each is Market Data's: the selection is
//! the one the snapshot was minted over, the R0 record is the one the snapshot's own commit appended,
//! the Market Semantics readback is the head of the snapshot's chain in the binding's compatibility
//! scope, and the correction policy is projected from the binding and that R0 record. A caller that
//! holds the snapshot therefore asks for them rather than rebuilding them, and the issuance still
//! re-derives and checks every one.

use std::fmt::{Debug, Display};

use super::replay_market_facts_v2::{
    ReplayCompositionContentLocatorV1, ReplayCompositionRequestLocatorV1,
};

/// The four locators a universe-member issuance command names besides the snapshot and its binding.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UniverseMemberCompositionBasisV1 {
    universe_selection: ReplayCompositionRequestLocatorV1,
    reference_fact_r0: ReplayCompositionRequestLocatorV1,
    market_semantics: ReplayCompositionRequestLocatorV1,
    correction_policy: ReplayCompositionContentLocatorV1,
}

impl UniverseMemberCompositionBasisV1 {
    pub(crate) const fn new(
        universe_selection: ReplayCompositionRequestLocatorV1,
        reference_fact_r0: ReplayCompositionRequestLocatorV1,
        market_semantics: ReplayCompositionRequestLocatorV1,
        correction_policy: ReplayCompositionContentLocatorV1,
    ) -> Self {
        Self {
            universe_selection,
            reference_fact_r0,
            market_semantics,
            correction_policy,
        }
    }

    /// The Universe Selection the snapshot was minted over.
    #[must_use]
    pub const fn universe_selection_locator(&self) -> ReplayCompositionRequestLocatorV1 {
        self.universe_selection
    }

    /// The R0 record the snapshot's own commit appended.
    #[must_use]
    pub const fn reference_fact_r0_locator(&self) -> ReplayCompositionRequestLocatorV1 {
        self.reference_fact_r0
    }

    /// The head of the snapshot's Market Semantics chain in the binding's compatibility scope.
    #[must_use]
    pub const fn market_semantics_locator(&self) -> ReplayCompositionRequestLocatorV1 {
        self.market_semantics
    }

    /// The correction policy projected from the binding and the R0 record.
    #[must_use]
    pub const fn correction_policy_locator(&self) -> ReplayCompositionContentLocatorV1 {
        self.correction_policy
    }
}

/// Why no basis was returned.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UniverseMemberCompositionBasisErrorV1 {
    /// Market Data holds no `AVAILABLE` snapshot under exactly this locator.
    PitUnavailable,
    /// The snapshot was minted under another Source Binding than the one named.
    SourceBindingMismatch,
    /// Market Data holds no admitted Source Binding under exactly this locator.
    SourceBindingUnavailable,
    /// No Market Semantics fact has been admitted for this snapshot in the binding's scope yet.
    MarketSemanticsNotAdmitted,
    /// The store is unreachable, or returned evidence Market Data does not trust.
    StoreUnavailable,
}

impl Display for UniverseMemberCompositionBasisErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::PitUnavailable => "no AVAILABLE snapshot is stored under this locator",
            Self::SourceBindingMismatch => "the snapshot was minted under another Source Binding",
            Self::SourceBindingUnavailable => {
                "no admitted Source Binding is stored under this locator"
            }
            Self::MarketSemanticsNotAdmitted => {
                "no Market Semantics fact is admitted for this snapshot yet"
            }
            Self::StoreUnavailable => "the Market Data store is unavailable",
        })
    }
}

impl std::error::Error for UniverseMemberCompositionBasisErrorV1 {}
