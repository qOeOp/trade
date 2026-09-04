//! Private native Corporate Action authority owned by Instrument Master.

#![allow(
    dead_code,
    reason = "positive Replay/Backtest composition is intentionally delivered later"
)]

use super::source_binding::BindingDigest;

pub(super) mod authority;
pub(super) mod codec;

#[cfg(test)]
pub(crate) mod tests;

pub(crate) type CorporateActionIdentity = BindingDigest;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u16)]
pub(crate) enum CorporateActionConsumerV1 {
    ReplayV2 = 1,
    Backtest = 2,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CashDividendPriceAdjustmentV1 {
    SubtractCashFromPreActionPrice,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum CorporateActionTermsV1 {
    Split {
        numerator: u64,
        denominator: u64,
    },
    CashDividend {
        mantissa: i128,
        scale: u8,
        currency_identity: Box<[u8]>,
    },
    SymbolChange {
        successor_instrument: Box<[u8]>,
    },
    Expiry,
    Roll {
        successor_instrument: Box<[u8]>,
    },
}

impl CorporateActionTermsV1 {
    pub(crate) const fn split_quantity_ratio(&self) -> Option<(u64, u64)> {
        match self {
            Self::Split {
                numerator,
                denominator,
            } => Some((*numerator, *denominator)),
            _ => None,
        }
    }

    pub(crate) const fn split_price_ratio(&self) -> Option<(u64, u64)> {
        match self {
            Self::Split {
                numerator,
                denominator,
            } => Some((*denominator, *numerator)),
            _ => None,
        }
    }

    pub(crate) const fn cash_dividend_price_adjustment(
        &self,
    ) -> Option<CashDividendPriceAdjustmentV1> {
        match self {
            Self::CashDividend { .. } => {
                Some(CashDividendPriceAdjustmentV1::SubtractCashFromPreActionPrice)
            }
            _ => None,
        }
    }
}

/// Untrusted request: it carries census scope and lookup locators, never action terms.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UntrustedCorporateActionProposalV1 {
    pub request_identity: CorporateActionIdentity,
    pub request_meaning_digest: CorporateActionIdentity,
    pub consumer: CorporateActionConsumerV1,
    pub replay_start_ns: i128,
    pub replay_end_ns_exclusive: i128,
    pub instruments: Box<[Box<[u8]>]>,
    pub owner_observation_ns: i128,
    pub decision_cut: u64,
    pub instrument_master_locator_bytes: Box<[u8]>,
    pub pit_locator_bytes: Box<[u8]>,
    pub source_binding_locator_bytes: Box<[u8]>,
    pub r0_locator_bytes: Box<[u8]>,
    pub stable_correlation: CorporateActionIdentity,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct UntrustedCorporateActionLocatorV1 {
    pub request_identity: CorporateActionIdentity,
    pub request_meaning_digest: CorporateActionIdentity,
}

/// Instrument Master-private action term and correction head.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CorporateActionRegistryEntryV1 {
    action_identity: CorporateActionIdentity,
    instrument: Box<[u8]>,
    terms: CorporateActionTermsV1,
    correction_identity: CorporateActionIdentity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AuthenticatedCorporateActionEntryV1 {
    registry: CorporateActionRegistryEntryV1,
    predecessor_identity: Option<CorporateActionIdentity>,
    effective_from_ns: i128,
    effective_until_ns: Option<i128>,
    provider_available_ns: i128,
    retrieval_ns: i128,
    correction_publication_ns: i128,
    owner_observation_ns: i128,
    decision_cut: u64,
    coordinate_identity: CorporateActionIdentity,
    coordinate_digest: CorporateActionIdentity,
    instrument_master_fact_digest: CorporateActionIdentity,
    pit_snapshot_identity: CorporateActionIdentity,
    pit_fact_digest: CorporateActionIdentity,
    source_binding_identity: CorporateActionIdentity,
    source_binding_fact_digest: CorporateActionIdentity,
    source_binding_lineage_root: CorporateActionIdentity,
    source_binding_lineage_version: u64,
    source_frontier: CorporateActionIdentity,
    correction_frontier: CorporateActionIdentity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AuthenticatedCorporateActionInputsV1 {
    entries: Box<[AuthenticatedCorporateActionEntryV1]>,
    instruments: Box<[Box<[u8]>]>,
    r0_cut_identity: CorporateActionIdentity,
    r0_cut_digest: CorporateActionIdentity,
    instrument_master_readback_digest: CorporateActionIdentity,
    instrument_master_cut_digest: CorporateActionIdentity,
    pit_cut_digest: CorporateActionIdentity,
    stable_correlation: CorporateActionIdentity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CorporateActionFactV1 {
    pub(super) action_identity: CorporateActionIdentity,
    pub(super) instrument: Box<[u8]>,
    pub(super) terms: CorporateActionTermsV1,
    pub(super) predecessor_identity: Option<CorporateActionIdentity>,
    pub(super) effective_from_ns: i128,
    pub(super) effective_until_ns: Option<i128>,
    pub(super) provider_available_ns: i128,
    pub(super) retrieval_ns: i128,
    pub(super) correction_publication_ns: i128,
    pub(super) owner_observation_ns: i128,
    pub(super) decision_cut: u64,
    pub(super) coordinate_identity: CorporateActionIdentity,
    pub(super) coordinate_digest: CorporateActionIdentity,
    pub(super) instrument_master_readback_digest: CorporateActionIdentity,
    pub(super) instrument_master_fact_digest: CorporateActionIdentity,
    pub(super) instrument_master_cut_digest: CorporateActionIdentity,
    pub(super) pit_snapshot_identity: CorporateActionIdentity,
    pub(super) pit_fact_digest: CorporateActionIdentity,
    pub(super) source_binding_identity: CorporateActionIdentity,
    pub(super) source_binding_fact_digest: CorporateActionIdentity,
    pub(super) source_binding_lineage_root: CorporateActionIdentity,
    pub(super) source_binding_lineage_version: u64,
    pub(super) source_frontier: CorporateActionIdentity,
    pub(super) correction_frontier: CorporateActionIdentity,
    pub(super) correction_identity: CorporateActionIdentity,
    pub(super) canonical_bytes: Box<[u8]>,
    pub(super) identity: CorporateActionIdentity,
}

impl CorporateActionFactV1 {
    pub(crate) const fn identity(&self) -> CorporateActionIdentity {
        self.identity
    }
    pub(crate) const fn digest(&self) -> CorporateActionIdentity {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub(crate) fn instrument(&self) -> &[u8] {
        &self.instrument
    }
    pub(crate) const fn action_identity(&self) -> CorporateActionIdentity {
        self.action_identity
    }
    pub(crate) const fn predecessor_identity(&self) -> Option<CorporateActionIdentity> {
        self.predecessor_identity
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CorporateActionCutEntryV1 {
    pub(super) action_identity: CorporateActionIdentity,
    pub(super) fact_identity: CorporateActionIdentity,
    pub(super) fact_digest: CorporateActionIdentity,
    pub(super) effective_from_ns: i128,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CorporateActionInstrumentCensusV1 {
    pub(super) instrument: Box<[u8]>,
    pub(super) actions: Box<[CorporateActionCutEntryV1]>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CorporateActionCutV1 {
    pub(super) request_identity: CorporateActionIdentity,
    pub(super) request_meaning_digest: CorporateActionIdentity,
    pub(super) consumer: CorporateActionConsumerV1,
    pub(super) replay_start_ns: i128,
    pub(super) replay_end_ns_exclusive: i128,
    pub(super) owner_observation_ns: i128,
    pub(super) decision_cut: u64,
    pub(super) r0_cut_identity: CorporateActionIdentity,
    pub(super) r0_cut_digest: CorporateActionIdentity,
    pub(super) instrument_master_cut_digest: CorporateActionIdentity,
    pub(super) pit_cut_digest: CorporateActionIdentity,
    pub(super) census: Box<[CorporateActionInstrumentCensusV1]>,
    pub(super) gaps: Box<[Box<[u8]>]>,
    pub(super) canonical_bytes: Box<[u8]>,
    pub(super) identity: CorporateActionIdentity,
}

impl CorporateActionCutV1 {
    pub(crate) const fn identity(&self) -> CorporateActionIdentity {
        self.identity
    }
    pub(crate) const fn digest(&self) -> CorporateActionIdentity {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CorporateActionReceiptV1 {
    pub(super) request_identity: CorporateActionIdentity,
    pub(super) request_meaning_digest: CorporateActionIdentity,
    pub(super) consumer: CorporateActionConsumerV1,
    pub(super) cut_identity: CorporateActionIdentity,
    pub(super) cut_digest: CorporateActionIdentity,
    pub(super) store_generation_identity: CorporateActionIdentity,
    pub(super) append_sequence: u64,
    pub(super) stable_correlation: CorporateActionIdentity,
    pub(super) canonical_bytes: Box<[u8]>,
    pub(super) identity: CorporateActionIdentity,
}

impl CorporateActionReceiptV1 {
    pub(crate) const fn identity(&self) -> CorporateActionIdentity {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct CorporateActionReadbackV1 {
    pub(super) facts: Box<[CorporateActionFactV1]>,
    pub(super) cut: CorporateActionCutV1,
    pub(super) receipt: CorporateActionReceiptV1,
    pub(super) outbox_identity: CorporateActionIdentity,
    pub(super) canonical_bytes: Box<[u8]>,
    pub(super) identity: CorporateActionIdentity,
}

impl CorporateActionReadbackV1 {
    pub(crate) fn facts(&self) -> &[CorporateActionFactV1] {
        &self.facts
    }
    pub(crate) const fn cut(&self) -> &CorporateActionCutV1 {
        &self.cut
    }
    pub(crate) const fn receipt(&self) -> &CorporateActionReceiptV1 {
        &self.receipt
    }
    pub(crate) const fn outbox_identity(&self) -> CorporateActionIdentity {
        self.outbox_identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub(crate) const fn identity(&self) -> CorporateActionIdentity {
        self.identity
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CorporateActionErrorV1 {
    InvalidRequest,
    UnauthenticatedInput,
    DependencyMismatch,
    InvalidFact,
    InvalidCorrection,
    MissingPredecessor,
    InvalidOverlap,
    IncompleteCut,
    NonCanonicalOrder,
    CapacityExceeded,
    CodecMismatch,
    DigestMismatch,
    RequestConflict,
    UnknownIdentity,
    StoreUnavailable,
    StoreUntrusted,
}
