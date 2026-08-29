//! Native, content-addressed Instrument Master custody owned by Market Data.
//!
//! The public boundary accepts untrusted requests and exposes only a sealed read-only resolver.
//! Writers, storage coordinates, and constructors for positive facts/readbacks remain Owner-private.
//!
//! ```compile_fail
//! use vibe_data::owner::instrument_master::InstrumentMasterReadbackV1;
//! let forged = InstrumentMasterReadbackV1 {};
//! ```
//!
//! ```compile_fail
//! use vibe_data::owner::postgres::MarketDataOwnerPostgres;
//! ```

use std::fmt::Display;

use super::{
    shared_time_evidence::UntrustedClockHeadLocator, source_binding::BindingDigest,
    strategy_input_binding::StrategyInputUniverseSelectionReceipt,
};

pub(super) mod authority;
mod codec;

pub use authority::verify_instrument_master_readback;

/// Reuses the repository's canonical fixed-size digest representation.
pub type InstrumentMasterIdentity = BindingDigest;

pub const BACKTEST_OWNER_V1: &str = "BACKTEST_OWNER_V1";
pub const MARKET_DATA_AS_OF: &str = "MARKET_DATA_AS_OF";
pub const SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1: &str = "SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1";

/// Exact supported Instrument Master fact classes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u16)]
pub enum InstrumentClass {
    Equity = 0x0001,
    Future = 0x0002,
    Option = 0x0003,
    FxPair = 0x0004,
    CryptoSpot = 0x0005,
    CryptoPerpetual = 0x0006,
    FixedIncome = 0x0007,
    Fund = 0x0008,
    Index = 0x0009,
    Commodity = 0x000a,
    Betting = 0x000b,
    Synthetic = 0x000c,
}

impl InstrumentClass {
    fn decode(value: u16) -> Result<Self, InstrumentMasterError> {
        Ok(match value {
            0x0001 => Self::Equity,
            0x0002 => Self::Future,
            0x0003 => Self::Option,
            0x0004 => Self::FxPair,
            0x0005 => Self::CryptoSpot,
            0x0006 => Self::CryptoPerpetual,
            0x0007 => Self::FixedIncome,
            0x0008 => Self::Fund,
            0x0009 => Self::Index,
            0x000a => Self::Commodity,
            0x000b => Self::Betting,
            0x000c => Self::Synthetic,
            _ => return Err(InstrumentMasterError::CodecMismatch),
        })
    }
}

/// Exact positive decimal; redundant trailing fractional zeroes are invalid.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InstrumentDecimal {
    pub mantissa: i128,
    pub scale: u8,
}

impl InstrumentDecimal {
    fn validate(self) -> Result<(), InstrumentMasterError> {
        if self.mantissa <= 0 || self.scale > 38 || (self.scale != 0 && self.mantissa % 10 == 0) {
            Err(InstrumentMasterError::InvalidFact)
        } else {
            Ok(())
        }
    }
}

/// One canonical venue/source mapping tuple.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstrumentVenueSourceMapping {
    pub venue_identity: String,
    pub source_identity: String,
    pub source_instrument: Vec<u8>,
}

/// Untrusted fact meaning proposed to the private Market Data writer.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstrumentMasterFactProposalV1 {
    pub canonical_identity: String,
    pub predecessor_fact_digest: Option<InstrumentMasterIdentity>,
    pub mappings: Vec<InstrumentVenueSourceMapping>,
    pub instrument_class: InstrumentClass,
    pub base_currency: Option<String>,
    pub quote_currency: Option<String>,
    pub settlement_currency: Option<String>,
    pub margin_currency: Option<String>,
    pub price_increment: InstrumentDecimal,
    pub quantity_increment: InstrumentDecimal,
    pub contract_multiplier: InstrumentDecimal,
    pub calendar_identity: String,
    pub session_identity: String,
    pub time_zone_identity: String,
    pub lifecycle_frontier: InstrumentMasterIdentity,
    pub corporate_action_frontier: InstrumentMasterIdentity,
    pub historical_membership_frontier: InstrumentMasterIdentity,
    pub market_semantics_identity: InstrumentMasterIdentity,
    pub source_frontier: InstrumentMasterIdentity,
    pub correction_frontier: InstrumentMasterIdentity,
    pub effective_from: i128,
    pub effective_until: Option<i128>,
    pub provider_available: i128,
    pub retrieval: i128,
    pub correction_publication: i128,
    pub owner_observation: i128,
}

/// Untrusted resolution scope. A Universe identity never carries its own membership.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InstrumentMasterScopeV1 {
    ExactInstrument(String),
    UniverseSelectionRecord(InstrumentMasterIdentity),
}

/// Untrusted request; its clock locator is only a lookup key for current sealed Owner evidence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedInstrumentMasterRequestV1 {
    pub request_identity: InstrumentMasterIdentity,
    pub request_meaning_digest: InstrumentMasterIdentity,
    pub consumer_role: String,
    pub scope: InstrumentMasterScopeV1,
    pub effective_instant: i128,
    pub owner_observation: i128,
    pub decision_cut: u64,
    pub clock_head: UntrustedClockHeadLocator,
    pub lifecycle_frontier: InstrumentMasterIdentity,
    pub corporate_action_frontier: InstrumentMasterIdentity,
    pub historical_membership_frontier: InstrumentMasterIdentity,
    pub market_semantics_identity: InstrumentMasterIdentity,
    pub source_frontier: InstrumentMasterIdentity,
    pub correction_frontier: InstrumentMasterIdentity,
    pub stable_correlation: InstrumentMasterIdentity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ClockProjection {
    pub(super) clock_identity: [u8; 32],
    pub(super) clock_epoch: [u8; 32],
    pub(super) monotonic_sequence: u64,
    pub(super) wall_observed: u64,
    pub(super) decision_cut: u64,
    pub(super) head_identity: InstrumentMasterIdentity,
    pub(super) head_digest: InstrumentMasterIdentity,
    pub(super) valid_through: u64,
    pub(super) restart_continuity_digest: InstrumentMasterIdentity,
    pub(super) uncertainty_bound: u64,
    pub(super) skew_bound: u64,
    pub(super) epoch_proof_identity: Option<InstrumentMasterIdentity>,
    pub(super) epoch_proof_digest: Option<InstrumentMasterIdentity>,
}

/// Canonical immutable fact. Callers can inspect but cannot construct or deserialize it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstrumentMasterFactV1 {
    pub(super) proposal: InstrumentMasterFactProposalV1,
    pub(super) clock: ClockProjection,
    pub(super) canonical_bytes: Vec<u8>,
    pub(super) identity: InstrumentMasterIdentity,
}

impl InstrumentMasterFactV1 {
    pub fn canonical_identity(&self) -> &str {
        &self.proposal.canonical_identity
    }
    pub const fn identity(&self) -> InstrumentMasterIdentity {
        self.identity
    }
    pub const fn digest(&self) -> InstrumentMasterIdentity {
        self.identity
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub const fn predecessor_fact_digest(&self) -> Option<InstrumentMasterIdentity> {
        self.proposal.predecessor_fact_digest
    }
    pub const fn effective_from(&self) -> i128 {
        self.proposal.effective_from
    }
    pub const fn effective_until(&self) -> Option<i128> {
        self.proposal.effective_until
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct InstrumentMasterResolution {
    pub(super) canonical_identity: String,
    pub(super) fact_digest: InstrumentMasterIdentity,
}

/// Canonical immutable cut, available only inside a sealed readback.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstrumentMasterCutV1 {
    pub(super) request_identity: InstrumentMasterIdentity,
    pub(super) request_meaning_digest: InstrumentMasterIdentity,
    pub(super) scope: InstrumentMasterScopeV1,
    pub(super) expected_members: Vec<String>,
    pub(super) effective_instant: i128,
    pub(super) owner_observation: i128,
    pub(super) decision_cut: u64,
    pub(super) clock: ClockProjection,
    pub(super) resolutions: Vec<InstrumentMasterResolution>,
    pub(super) frontiers: [InstrumentMasterIdentity; 6],
    pub(super) canonical_bytes: Vec<u8>,
    pub(super) identity: InstrumentMasterIdentity,
}

impl InstrumentMasterCutV1 {
    pub const fn identity(&self) -> InstrumentMasterIdentity {
        self.identity
    }
    pub const fn digest(&self) -> InstrumentMasterIdentity {
        self.identity
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub fn expected_members(&self) -> &[String] {
        &self.expected_members
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct InstrumentMasterReceiptV1 {
    pub(super) request_identity: InstrumentMasterIdentity,
    pub(super) request_meaning_digest: InstrumentMasterIdentity,
    pub(super) fact_bytes: Vec<Vec<u8>>,
    pub(super) cut_bytes: Vec<u8>,
    pub(super) store_generation_identity: InstrumentMasterIdentity,
    pub(super) store_append_sequence: u64,
    pub(super) stable_correlation: InstrumentMasterIdentity,
    pub(super) canonical_bytes: Vec<u8>,
    pub(super) identity: InstrumentMasterIdentity,
}

/// Move-only Owner-sealed exact readback. It intentionally implements neither `Clone` nor `Deserialize`.
#[derive(Debug, Eq, PartialEq)]
pub struct InstrumentMasterReadbackV1 {
    pub(super) request_identity: InstrumentMasterIdentity,
    pub(super) request_meaning_digest: InstrumentMasterIdentity,
    pub(super) facts: Vec<InstrumentMasterFactV1>,
    pub(super) cut: InstrumentMasterCutV1,
    pub(super) stable_correlation: InstrumentMasterIdentity,
    pub(super) store_generation_identity: InstrumentMasterIdentity,
    pub(super) store_append_sequence: u64,
    pub(super) receipt_identity: InstrumentMasterIdentity,
    pub(super) outbox_identity: InstrumentMasterIdentity,
    pub(super) canonical_bytes: Vec<u8>,
    pub(super) identity: InstrumentMasterIdentity,
}

impl InstrumentMasterReadbackV1 {
    pub const fn identity(&self) -> InstrumentMasterIdentity {
        self.identity
    }
    pub const fn digest(&self) -> InstrumentMasterIdentity {
        self.identity
    }
    pub fn facts(&self) -> &[InstrumentMasterFactV1] {
        &self.facts
    }
    pub const fn cut(&self) -> &InstrumentMasterCutV1 {
        &self.cut
    }
    pub const fn receipt_identity(&self) -> InstrumentMasterIdentity {
        self.receipt_identity
    }
    pub const fn outbox_identity(&self) -> InstrumentMasterIdentity {
        self.outbox_identity
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

/// Sealed complete membership supplied only by an existing Owner-derived Universe receipt.
#[derive(Debug)]
pub struct InstrumentMasterUniverseMembershipV1 {
    pub(super) selection_identity: InstrumentMasterIdentity,
    pub(super) members: Vec<String>,
}

/// Existing Universe Selection authority adapter; it cannot be implemented by callers.
pub(crate) mod membership_seal {
    pub trait Sealed {}
}
impl membership_seal::Sealed for StrategyInputUniverseSelectionReceipt {}

pub trait InstrumentMasterUniverseMembershipResolver:
    membership_seal::Sealed + Send + Sync
{
    /// Resolves the complete canonical membership for one exact sealed selection identity.
    ///
    /// # Errors
    ///
    /// Returns a fail-closed error when identity or canonical membership does not match.
    fn resolve_instrument_master_membership(
        &self,
        selection_identity: InstrumentMasterIdentity,
    ) -> Result<InstrumentMasterUniverseMembershipV1, InstrumentMasterError>;
}

impl InstrumentMasterUniverseMembershipResolver for StrategyInputUniverseSelectionReceipt {
    fn resolve_instrument_master_membership(
        &self,
        selection_identity: InstrumentMasterIdentity,
    ) -> Result<InstrumentMasterUniverseMembershipV1, InstrumentMasterError> {
        if self.selection_identity() != selection_identity {
            return Err(InstrumentMasterError::MembershipMismatch);
        }
        let members: Vec<String> = self
            .members()
            .iter()
            .map(|member| member.instrument().to_owned())
            .collect();
        authority::validate_members(&members)?;
        Ok(InstrumentMasterUniverseMembershipV1 {
            selection_identity,
            members,
        })
    }
}

#[doc(hidden)]
pub mod resolver_seal {
    pub trait Sealed {}
}

/// Public read-only sealed Instrument Master resolver.
#[async_trait::async_trait]
pub trait InstrumentMasterResolver: resolver_seal::Sealed + Send + Sync {
    async fn resolve_instrument_master(
        &self,
        request: &UntrustedInstrumentMasterRequestV1,
        universe: Option<&dyn InstrumentMasterUniverseMembershipResolver>,
    ) -> Result<InstrumentMasterReadbackV1, InstrumentMasterError>;

    async fn recover_instrument_master(
        &self,
        request_identity: InstrumentMasterIdentity,
        request_meaning_digest: InstrumentMasterIdentity,
    ) -> Result<InstrumentMasterReadbackV1, InstrumentMasterError>;
}

/// Every failure is terminal for the attempted positive resolution and creates no inferred state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstrumentMasterError {
    InvalidFact,
    InvalidRequest,
    WrongRole,
    CodecMismatch,
    DigestMismatch,
    ClockUnavailable,
    ClockMismatch,
    ClockExpired,
    ClockDiscontinuous,
    FrontierMismatch,
    MembershipMismatch,
    UnknownIdentity,
    AmbiguousIdentity,
    MissingPredecessor,
    PredecessorBranch,
    PredecessorCycle,
    InvalidOverlap,
    RequestConflict,
    StoreUnavailable,
    StoreUntrusted,
    CommitInterrupted,
    ResponseLost,
}

impl Display for InstrumentMasterError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}
impl std::error::Error for InstrumentMasterError {}

#[cfg(test)]
mod tests;
