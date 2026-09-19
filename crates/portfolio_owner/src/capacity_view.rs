//! The Portfolio-owned candidate-neutral gross Capacity View.
//!
//! A Capacity View states one gross economic ceiling for one `BOUND` Capacity Scope under one
//! declared pool methodology. It is a ceiling, never remaining headroom: Portfolio subtracts no Risk
//! Reservation liability, reads no Risk state, and allocates no capital. Risk alone combines this
//! ceiling with its own commitment frontier.
//!
//! The only methodology admitted here is [`PAPER_COLLATERAL_GROSS_CEILING_V1`], whose whole content
//! is: for a simulated `PAPER` pool denominated in the same currency as the account's collateral,
//! the gross ceiling is that collateral and there is no liquidity constraint to compress it.
//! Valuation is the identity map because the two currencies are the same, which is a fact about
//! that case rather than a missing input. A pool denominated in any other currency needs a Market
//! Data valuation fact, so it fails closed until one exists.
//!
//! A caller cannot mint the sealed view:
//!
//! ```compile_fail
//! use vibe_portfolio_owner::capacity_view::CapacityViewReadback;
//!
//! let _forged = CapacityViewReadback {};
//! ```
//!
//! ```compile_fail
//! use serde::de::DeserializeOwned;
//! use vibe_portfolio_owner::capacity_view::CapacityViewReadback;
//!
//! fn requires_deserialize<T: DeserializeOwned>() {}
//! requires_deserialize::<CapacityViewReadback>();
//! ```

use std::{error::Error, fmt::Display};

use serde::{Deserialize, Serialize};

use crate::sha256_hex;

/// Schema version of the Capacity View contract.
pub const CAPACITY_VIEW_SCHEMA_VERSION: u32 = 1;
/// The only pool methodology this slice admits.
pub const PAPER_COLLATERAL_GROSS_CEILING_V1: &str = "paper-collateral-gross-ceiling.v1";
/// Assumption set the methodology declares: no liquidity constraint, identity valuation.
pub const PAPER_COLLATERAL_ASSUMPTIONS_V1: &str =
    "paper-collateral-assumptions.v1.no-liquidity-constraint.identity-valuation";
/// Explicit identity of the declared absence of a liquidity input.
pub const NO_LIQUIDITY_INPUT_V1: &str = "liquidity-input.v1.not-required-by-methodology";
/// The one gross ceiling dimension this methodology projects.
pub const GROSS_CEILING_DIMENSION_NOTIONAL: &str = "NOTIONAL";
/// Fixed scale of every gross ceiling: whole units times one million.
pub const GROSS_CEILING_SCALE: u32 = 6;
const VIEW_IDENTITY_DOMAIN: &[u8] = b"vibe.portfolio.capacity-view.identity.v1\0";

/// Structured reason Portfolio withheld a Capacity View.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "reason", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapacityViewFailure {
    /// The requested methodology is not the one this slice admits.
    UnsupportedMethodology { requested: String },
    /// No `BOUND` Capacity Scope resolves for the request.
    CapacityScopeUnavailable,
    /// Execution has committed no opening account fact for the scope's account namespace.
    AccountFactUnavailable,
    /// Execution's opening fact belongs to another account namespace or Execution Scope.
    AccountFactMismatch,
    /// The pool's denomination differs from the collateral currency, so identity valuation is not
    /// admissible and a Market Data valuation fact is required.
    ValuationUnavailable {
        /// Currency the pool is denominated in.
        pool_currency: String,
        /// Currency the collateral is held in.
        collateral_currency: String,
    },
    /// The collateral amount carries more precision than the fixed ceiling scale, or overflows it.
    CollateralNotRepresentable { amount: String },
    /// The measurement time is not inside the scope proof's validity window.
    MeasurementOutsideProof,
    /// A validity deadline is absent or not after the measurement time.
    InvalidValidity,
    /// Owner custody is unavailable.
    OwnerResolveUnavailable,
}

impl Display for CapacityViewFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl Error for CapacityViewFailure {}

/// Exact Execution-committed opening account fact a view is projected from.
///
/// Portfolio never derives this; it reads Execution's own sealed fact through the Execution Owner's
/// read-only API and records the exact cut it consumed.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionAccountFactCut {
    /// Execution's fact identity.
    pub fact_identity: String,
    /// Account namespace the fact opened.
    pub account_namespace: String,
    /// Execution Scope the fact belongs to.
    pub execution_scope_identity: String,
    /// Currency the collateral is held in.
    pub collateral_currency: String,
    /// Canonical positive decimal collateral amount.
    pub collateral_amount: String,
    /// Execution's native stream sequence: the account fact cut coordinate.
    pub sequence: u64,
}

/// One gross ceiling the methodology projects, in one dimension and unit.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GrossCeiling {
    /// Risk dimension the ceiling bounds.
    pub dimension: String,
    /// Unit the ceiling is expressed in.
    pub unit: String,
    /// Ceiling value at [`GROSS_CEILING_SCALE`].
    pub scaled_amount: u64,
}

/// Portfolio-sealed Capacity View.
///
/// Private fields, no public constructor, no `Deserialize`: possession proves Portfolio custody
/// projected it from a `BOUND` scope and an Execution-committed account fact.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CapacityViewReadback {
    schema_version: u32,
    view_identity: String,
    capacity_scope_identity: String,
    account_namespace: String,
    mode: crate::capacity_scope::CapacityScopeMode,
    economic_pool_identity: String,
    pool_methodology_version: String,
    assumption_version: String,
    valuation_version: String,
    liquidity_input_cut_identity: String,
    account_fact_cut: ExecutionAccountFactCut,
    proof_frontier_identity: String,
    gross_ceilings: Vec<GrossCeiling>,
    candidate_neutral: bool,
    measured_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

impl CapacityViewReadback {
    /// Contract schema version.
    #[must_use]
    pub const fn schema_version(&self) -> u32 {
        self.schema_version
    }

    /// Owner-derived view identity.
    #[must_use]
    pub fn view_identity(&self) -> &str {
        &self.view_identity
    }

    /// Capacity Scope the ceiling belongs to.
    #[must_use]
    pub fn capacity_scope_identity(&self) -> &str {
        &self.capacity_scope_identity
    }

    /// Account namespace the ceiling covers.
    #[must_use]
    pub fn account_namespace(&self) -> &str {
        &self.account_namespace
    }

    /// `PAPER` or `LIVE` mode.
    #[must_use]
    pub const fn mode(&self) -> crate::capacity_scope::CapacityScopeMode {
        self.mode
    }

    /// Candidate-neutral economic pool.
    #[must_use]
    pub fn economic_pool_identity(&self) -> &str {
        &self.economic_pool_identity
    }

    /// Declared pool methodology version.
    #[must_use]
    pub fn pool_methodology_version(&self) -> &str {
        &self.pool_methodology_version
    }

    /// Declared assumption version.
    #[must_use]
    pub fn assumption_version(&self) -> &str {
        &self.assumption_version
    }

    /// Declared valuation version.
    #[must_use]
    pub fn valuation_version(&self) -> &str {
        &self.valuation_version
    }

    /// Identity of the liquidity input cut, or of its declared absence.
    #[must_use]
    pub fn liquidity_input_cut_identity(&self) -> &str {
        &self.liquidity_input_cut_identity
    }

    /// Exact Execution account fact cut consumed.
    #[must_use]
    pub const fn account_fact_cut(&self) -> &ExecutionAccountFactCut {
        &self.account_fact_cut
    }

    /// Capacity Scope proof frontier this view was projected under.
    #[must_use]
    pub fn proof_frontier_identity(&self) -> &str {
        &self.proof_frontier_identity
    }

    /// Gross ceilings by dimension and unit.
    #[must_use]
    pub fn gross_ceilings(&self) -> &[GrossCeiling] {
        &self.gross_ceilings
    }

    /// Always true here: the methodology consumes no candidate or generation input.
    #[must_use]
    pub const fn candidate_neutral(&self) -> bool {
        self.candidate_neutral
    }

    /// Owner measurement time.
    #[must_use]
    pub const fn measured_at_epoch_ms(&self) -> u64 {
        self.measured_at_epoch_ms
    }

    /// Exclusive validity deadline.
    #[must_use]
    pub const fn valid_through_epoch_ms(&self) -> u64 {
        self.valid_through_epoch_ms
    }

    /// The single notional ceiling Strategy Governance and Risk compare a request against.
    #[must_use]
    pub fn notional_gross_ceiling(&self) -> u64 {
        self.gross_ceilings
            .iter()
            .find(|ceiling| ceiling.dimension == GROSS_CEILING_DIMENSION_NOTIONAL)
            .map_or(0, |ceiling| ceiling.scaled_amount)
    }
}

/// Converts a canonical positive decimal to the fixed ceiling scale.
///
/// # Errors
///
/// Returns [`CapacityViewFailure::CollateralNotRepresentable`] when the amount carries more
/// fraction digits than the scale admits or does not fit the scaled range.
pub(crate) fn scale_amount(amount: &str) -> Result<u64, CapacityViewFailure> {
    let unrepresentable = || CapacityViewFailure::CollateralNotRepresentable {
        amount: amount.to_string(),
    };
    let (integer, fraction) = amount.split_once('.').unwrap_or((amount, ""));

    if fraction.len() as u32 > GROSS_CEILING_SCALE {
        return Err(unrepresentable());
    }
    let padded = format!("{fraction:0<width$}", width = GROSS_CEILING_SCALE as usize);
    let units: u64 = integer.parse().map_err(|_| unrepresentable())?;
    let fractional: u64 = if padded.is_empty() {
        0
    } else {
        padded.parse().map_err(|_| unrepresentable())?
    };
    units
        .checked_mul(10_u64.pow(GROSS_CEILING_SCALE))
        .and_then(|scaled| scaled.checked_add(fractional))
        .ok_or_else(unrepresentable)
}

pub(crate) fn seal_view(
    scope: &crate::capacity_scope::BoundCapacityScopeReadback,
    proof_frontier_identity: &str,
    account_fact_cut: ExecutionAccountFactCut,
    measured_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
) -> Result<CapacityViewReadback, CapacityViewFailure> {
    if account_fact_cut.account_namespace != scope.account_namespace() {
        return Err(CapacityViewFailure::AccountFactMismatch);
    }

    if account_fact_cut.collateral_currency != scope.economic_pool_currency() {
        return Err(CapacityViewFailure::ValuationUnavailable {
            pool_currency: scope.economic_pool_currency().to_string(),
            collateral_currency: account_fact_cut.collateral_currency,
        });
    }

    if valid_through_epoch_ms <= measured_at_epoch_ms || measured_at_epoch_ms == 0 {
        return Err(CapacityViewFailure::InvalidValidity);
    }
    let scaled_amount = scale_amount(&account_fact_cut.collateral_amount)?;
    let gross_ceilings = vec![GrossCeiling {
        dimension: GROSS_CEILING_DIMENSION_NOTIONAL.to_string(),
        unit: scope.economic_pool_currency().to_string(),
        scaled_amount,
    }];
    let mut view = CapacityViewReadback {
        schema_version: CAPACITY_VIEW_SCHEMA_VERSION,
        view_identity: String::new(),
        capacity_scope_identity: scope.capacity_scope_identity().to_string(),
        account_namespace: scope.account_namespace().to_string(),
        mode: scope.mode(),
        economic_pool_identity: scope.economic_pool_identity().to_string(),
        pool_methodology_version: PAPER_COLLATERAL_GROSS_CEILING_V1.to_string(),
        assumption_version: PAPER_COLLATERAL_ASSUMPTIONS_V1.to_string(),
        valuation_version: PAPER_COLLATERAL_ASSUMPTIONS_V1.to_string(),
        liquidity_input_cut_identity: NO_LIQUIDITY_INPUT_V1.to_string(),
        account_fact_cut,
        proof_frontier_identity: proof_frontier_identity.to_string(),
        gross_ceilings,
        candidate_neutral: true,
        measured_at_epoch_ms,
        valid_through_epoch_ms,
    };
    view.view_identity = derive_view_identity(&view);
    Ok(view)
}

pub(crate) fn derive_view_identity(view: &CapacityViewReadback) -> String {
    let mut bytes = Vec::from(VIEW_IDENTITY_DOMAIN);

    for value in [
        view.capacity_scope_identity.as_str(),
        view.account_namespace.as_str(),
        view.economic_pool_identity.as_str(),
        view.pool_methodology_version.as_str(),
        view.assumption_version.as_str(),
        view.valuation_version.as_str(),
        view.liquidity_input_cut_identity.as_str(),
        view.account_fact_cut.fact_identity.as_str(),
        view.account_fact_cut.execution_scope_identity.as_str(),
        view.proof_frontier_identity.as_str(),
    ] {
        bytes.extend_from_slice(&(value.len() as u64).to_be_bytes());
        bytes.extend_from_slice(value.as_bytes());
    }
    bytes.extend_from_slice(&view.account_fact_cut.sequence.to_be_bytes());

    for ceiling in &view.gross_ceilings {
        bytes.extend_from_slice(&(ceiling.dimension.len() as u64).to_be_bytes());
        bytes.extend_from_slice(ceiling.dimension.as_bytes());
        bytes.extend_from_slice(&(ceiling.unit.len() as u64).to_be_bytes());
        bytes.extend_from_slice(ceiling.unit.as_bytes());
        bytes.extend_from_slice(&ceiling.scaled_amount.to_be_bytes());
    }
    bytes.extend_from_slice(&view.measured_at_epoch_ms.to_be_bytes());
    bytes.extend_from_slice(&view.valid_through_epoch_ms.to_be_bytes());
    format!("sha256:{}", sha256_hex(&bytes))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    #[case("100000", Some(100_000_000_000))]
    #[case("0.5", Some(500_000))]
    #[case("12.345678", Some(12_345_678))]
    #[case("12.3456789", None)]
    #[case("18446744073710", None)]
    fn collateral_scales_exactly_or_fails_closed(
        #[case] amount: &str,
        #[case] expected: Option<u64>,
    ) {
        assert_eq!(scale_amount(amount).ok(), expected);
    }

    #[rstest]
    fn the_methodology_declares_its_own_absent_liquidity_input() {
        assert!(NO_LIQUIDITY_INPUT_V1.contains("not-required"));
        assert_ne!(NO_LIQUIDITY_INPUT_V1, "");
        assert_eq!(GROSS_CEILING_SCALE, 6);
    }
}
