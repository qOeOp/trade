//! Engine-derived protected economic measurement.
//!
//! Backtest reports what a protected replay actually produced. Until now the measurement reached
//! the Owner as a caller-authored DTO whose `observed_raw` nothing tied to a run: the Owner checked
//! that the value was bound to the right request, plan, cell, attempt and clock cut, and then
//! sealed it. A caller could therefore mint a passing economic result and receive a positive
//! protected receipt for it.
//!
//! This module closes that hole. The only way to obtain a [`SealedProtectedEconomicMeasurementV1`]
//! is to hand this module the exact canonical Backtest result bytes a run produced and a
//! computation the Backtest catalog publishes. Every number is then derived here, in exact integer
//! arithmetic, from documented canonical-result fields; the decisive evidence locator is built from
//! the digest of those same bytes, so it cannot point at another run. The type has no public
//! constructor and no deserializer, so a caller cannot forge or reinterpret one.
//!
//! No floating-point value participates. Money is parsed from its canonical decimal string into a
//! scaled integer, and the ratio is evaluated in `i128` before it is narrowed.

use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_backtest::result::CanonicalBacktestResult;
use vibe_backtest_owner_contracts::protected_economic_metric::{
    ProtectedEconomicComputationV1, ProtectedEconomicCoverageRuleV1, ProtectedEconomicMetricV1,
};
use vibe_backtest_owner_contracts::protected_replay::{
    ProtectedConsumedInputLocatorV1, ProtectedEconomicMeasurementV1,
};
use vibe_backtest_owner_contracts::{CanonicalDigestV2, OpaqueIdentityV2};

const CANONICAL_RESULT_DIGEST_DOMAIN_V1: &str =
    "vibe.backtest.protected-economic-canonical-result.v1";
const MAX_COVERAGE_BPS: u128 = 10_000;

/// Exact bindings one measurement must repeat from the request it answers.
#[derive(Debug, Clone)]
pub struct ProtectedEconomicMeasurementBindingsV1 {
    pub request_identity: String,
    pub request_digest: String,
    pub attempt_identity: String,
    pub protected_plan_identity: String,
    pub protected_plan_digest: String,
    pub plan_cell_set_identity: String,
    pub plan_cell_set_digest: String,
    pub plan_cell_identity: String,
    pub plan_cell_digest: String,
    pub result_time_evidence_digest: String,
    /// Owner that retains the canonical result bytes this measurement was derived from.
    pub evidence_owner: OpaqueIdentityV2,
    /// Reference under which those exact bytes are retained.
    pub evidence_reference: OpaqueIdentityV2,
}

/// A measurement no caller can construct, deserialize, or edit.
///
/// It exists only as the output of [`derive_protected_economic_measurement_v1`], which builds it
/// from the exact canonical result bytes of one run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SealedProtectedEconomicMeasurementV1 {
    measurement: ProtectedEconomicMeasurementV1,
    canonical_result_digest: CanonicalDigestV2,
}

impl SealedProtectedEconomicMeasurementV1 {
    /// Returns the derived measurement exactly as it will be sealed into the protected result.
    #[must_use]
    pub const fn measurement(&self) -> &ProtectedEconomicMeasurementV1 {
        &self.measurement
    }

    /// Returns the digest of the canonical Backtest result bytes this measurement was derived from.
    #[must_use]
    pub const fn canonical_result_digest(&self) -> &CanonicalDigestV2 {
        &self.canonical_result_digest
    }
}

/// Why a canonical Backtest result yields no protected economic measurement.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ProtectedEconomicMeasurementFaultV1 {
    #[error("the bytes offered are not a canonical Backtest result: {0}")]
    NonCanonicalResult(String),
    #[error("canonical Backtest result omits {path}")]
    MissingField { path: &'static str },
    #[error("canonical Backtest result field {path} is not the documented shape")]
    MalformedField { path: &'static str },
    #[error("protected measurement needs exactly one account, observed {observed}")]
    AmbiguousAccount { observed: usize },
    #[error("protected measurement needs exactly one settlement currency, observed {observed}")]
    AmbiguousSettlementCurrency { observed: usize },
    #[error("starting balance must be positive to express a return")]
    NonPositiveStartingBalance,
    #[error(
        "balance delta {balance_delta_raw} disagrees with the summed position realized PnL {position_delta_raw}"
    )]
    UnreconciledRealizedPnl {
        balance_delta_raw: i128,
        position_delta_raw: i128,
    },
    #[error("protected measurement needs at least one observed position")]
    NoObservedPosition,
    #[error("run window is empty or inverted")]
    EmptyRunWindow,
    #[error("observed value does not fit the frozen fixed-point scale")]
    ValueOutOfRange,
    #[error("derived measurement is not a valid protected measurement: {0}")]
    InvalidMeasurement(String),
}

/// Derives the one measurement a canonical Backtest result supports under a frozen computation.
///
/// The bytes must be the exact canonical result of the protected run; they are validated as
/// canonical before a single field is read, digested, and bound into the decisive-evidence locator.
///
/// # Errors
///
/// Returns the first documented field the result does not supply exactly as the frozen computation
/// requires. No partial or inferred measurement is ever produced.
pub fn derive_protected_economic_measurement_v1(
    canonical_result_bytes: &[u8],
    computation: ProtectedEconomicComputationV1,
    bindings: &ProtectedEconomicMeasurementBindingsV1,
) -> Result<SealedProtectedEconomicMeasurementV1, ProtectedEconomicMeasurementFaultV1> {
    let result = CanonicalBacktestResult::from_slice(canonical_result_bytes)
        .map_err(|e| ProtectedEconomicMeasurementFaultV1::NonCanonicalResult(e.to_string()))?;
    let document = result.as_value();
    let observed_raw = match computation.metric {
        ProtectedEconomicMetricV1::NetReturnBasisPoints => {
            net_return_basis_points(document, computation.metric.decimal_scale())?
        }
    };
    let observed_coverage_bps = match computation.coverage_rule {
        ProtectedEconomicCoverageRuleV1::ObservedWindowSpan => observed_window_span_bps(document)?,
    };
    let canonical_result_digest = canonical_result_digest(canonical_result_bytes)?;
    let mut measurement = ProtectedEconomicMeasurementV1 {
        schema_version: 1,
        measurement_identity: "pending-measurement-identity".to_owned(),
        measurement_digest: format!("blake3:{}", "0".repeat(64)),
        request_identity: bindings.request_identity.clone(),
        request_digest: bindings.request_digest.clone(),
        attempt_identity: bindings.attempt_identity.clone(),
        protected_plan_identity: bindings.protected_plan_identity.clone(),
        protected_plan_digest: bindings.protected_plan_digest.clone(),
        plan_cell_set_identity: bindings.plan_cell_set_identity.clone(),
        plan_cell_set_digest: bindings.plan_cell_set_digest.clone(),
        plan_cell_identity: bindings.plan_cell_identity.clone(),
        plan_cell_digest: bindings.plan_cell_digest.clone(),
        metric_identity: computation.metric.semantic_id().to_owned(),
        metric_digest: computation
            .metric
            .definition_digest()
            .map_err(|e| ProtectedEconomicMeasurementFaultV1::InvalidMeasurement(e.to_string()))?,
        unit: computation.metric.unit().to_owned(),
        decimal_scale: computation.metric.decimal_scale(),
        observed_raw,
        observed_coverage_bps,
        decisive_evidence: ProtectedConsumedInputLocatorV1 {
            owner: bindings.evidence_owner.clone(),
            reference: bindings.evidence_reference.clone(),
            digest: canonical_result_digest.clone(),
        },
        result_time_evidence_digest: bindings.result_time_evidence_digest.clone(),
    };
    measurement.measurement_digest = measurement
        .compute_digest()
        .map_err(|e| ProtectedEconomicMeasurementFaultV1::InvalidMeasurement(e.to_string()))?;
    measurement.measurement_identity = format!(
        "backtest-protected-economic-measurement-v1-{}",
        measurement
            .measurement_digest
            .strip_prefix("blake3:")
            .ok_or_else(|| ProtectedEconomicMeasurementFaultV1::InvalidMeasurement(
                "measurement digest is not blake3".to_owned()
            ))?
    );
    measurement
        .validate()
        .map_err(|e| ProtectedEconomicMeasurementFaultV1::InvalidMeasurement(e.to_string()))?;
    Ok(SealedProtectedEconomicMeasurementV1 {
        measurement,
        canonical_result_digest,
    })
}

/// Net-of-cost account return over the replay, as scaled basis points.
///
/// The account balance delta is the net figure: it already carries every commission the run paid.
/// It is accepted only when the summed per-position realized PnL reproduces it exactly, so neither
/// side can drift from the other without producing no measurement at all.
fn net_return_basis_points(
    document: &serde_json::Value,
    decimal_scale: u8,
) -> Result<i64, ProtectedEconomicMeasurementFaultV1> {
    let accounts = document
        .get("accounts")
        .and_then(serde_json::Value::as_array)
        .ok_or(ProtectedEconomicMeasurementFaultV1::MissingField { path: "accounts" })?;

    if accounts.len() != 1 {
        return Err(ProtectedEconomicMeasurementFaultV1::AmbiguousAccount {
            observed: accounts.len(),
        });
    }
    let base = accounts[0]
        .as_object()
        .and_then(|account| account.values().next())
        .and_then(|variant| variant.get("base"))
        .ok_or(ProtectedEconomicMeasurementFaultV1::MalformedField { path: "accounts[]" })?;
    let starting = base
        .get("balances_starting")
        .and_then(serde_json::Value::as_object)
        .ok_or(ProtectedEconomicMeasurementFaultV1::MissingField {
            path: "accounts[].base.balances_starting",
        })?;

    if starting.len() != 1 {
        return Err(
            ProtectedEconomicMeasurementFaultV1::AmbiguousSettlementCurrency {
                observed: starting.len(),
            },
        );
    }
    let (currency, starting_value) =
        starting
            .iter()
            .next()
            .ok_or(ProtectedEconomicMeasurementFaultV1::MissingField {
                path: "accounts[].base.balances_starting",
            })?;
    let starting_raw = money_raw(
        starting_value,
        currency,
        "accounts[].base.balances_starting",
    )?;

    if starting_raw <= 0 {
        return Err(ProtectedEconomicMeasurementFaultV1::NonPositiveStartingBalance);
    }
    let final_raw = money_raw(
        base.get("balances")
            .and_then(serde_json::Value::as_object)
            .and_then(|balances| balances.get(currency))
            .and_then(|balance| balance.get("total"))
            .ok_or(ProtectedEconomicMeasurementFaultV1::MissingField {
                path: "accounts[].base.balances[currency].total",
            })?,
        currency,
        "accounts[].base.balances[currency].total",
    )?;
    let balance_delta_raw = final_raw - starting_raw;
    let position_delta_raw = summed_realized_pnl_raw(document, currency)?;

    if balance_delta_raw != position_delta_raw {
        return Err(
            ProtectedEconomicMeasurementFaultV1::UnreconciledRealizedPnl {
                balance_delta_raw,
                position_delta_raw,
            },
        );
    }
    let factor = 10_i128
        .checked_pow(u32::from(decimal_scale) + 4)
        .ok_or(ProtectedEconomicMeasurementFaultV1::ValueOutOfRange)?;
    let scaled = balance_delta_raw
        .checked_mul(factor)
        .ok_or(ProtectedEconomicMeasurementFaultV1::ValueOutOfRange)?;
    i64::try_from(scaled / starting_raw)
        .map_err(|_| ProtectedEconomicMeasurementFaultV1::ValueOutOfRange)
}

/// Sums every position's realized PnL, requiring one settlement currency throughout.
fn summed_realized_pnl_raw(
    document: &serde_json::Value,
    currency: &str,
) -> Result<i128, ProtectedEconomicMeasurementFaultV1> {
    let positions = document
        .get("positions")
        .and_then(serde_json::Value::as_array)
        .ok_or(ProtectedEconomicMeasurementFaultV1::MissingField { path: "positions" })?;
    let mut total = 0_i128;

    for position in positions {
        let settlement = position
            .get("settlement_currency")
            .and_then(serde_json::Value::as_str)
            .ok_or(ProtectedEconomicMeasurementFaultV1::MissingField {
                path: "positions[].settlement_currency",
            })?;

        if settlement != currency {
            return Err(
                ProtectedEconomicMeasurementFaultV1::AmbiguousSettlementCurrency { observed: 2 },
            );
        }
        let realized = position.get("realized_pnl").ok_or(
            ProtectedEconomicMeasurementFaultV1::MissingField {
                path: "positions[].realized_pnl",
            },
        )?;
        total = total
            .checked_add(money_raw(realized, currency, "positions[].realized_pnl")?)
            .ok_or(ProtectedEconomicMeasurementFaultV1::ValueOutOfRange)?;
    }
    Ok(total)
}

/// Share of the configured replay window the observed position lifecycle spans, in basis points.
fn observed_window_span_bps(
    document: &serde_json::Value,
) -> Result<u16, ProtectedEconomicMeasurementFaultV1> {
    let run = document
        .get("run")
        .ok_or(ProtectedEconomicMeasurementFaultV1::MissingField { path: "run" })?;
    let start = nanos(run.get("backtest_start_ns"), "run.backtest_start_ns")?;
    let end = nanos(run.get("backtest_end_ns"), "run.backtest_end_ns")?;

    if end <= start {
        return Err(ProtectedEconomicMeasurementFaultV1::EmptyRunWindow);
    }
    let positions = document
        .get("positions")
        .and_then(serde_json::Value::as_array)
        .ok_or(ProtectedEconomicMeasurementFaultV1::MissingField { path: "positions" })?;
    let mut first_open = None;
    let mut last_observed = None;

    for position in positions {
        let opened = nanos(position.get("ts_opened"), "positions[].ts_opened")?;
        let closed = match position.get("ts_closed") {
            None | Some(serde_json::Value::Null) => opened,
            Some(value) => nanos(Some(value), "positions[].ts_closed")?,
        };
        first_open = Some(first_open.map_or(opened, |value: u128| value.min(opened)));
        last_observed = Some(last_observed.map_or(closed, |value: u128| value.max(closed)));
    }
    let (Some(first_open), Some(last_observed)) = (first_open, last_observed) else {
        return Err(ProtectedEconomicMeasurementFaultV1::NoObservedPosition);
    };
    let observed = last_observed.saturating_sub(first_open);
    let covered = observed
        .checked_mul(MAX_COVERAGE_BPS)
        .ok_or(ProtectedEconomicMeasurementFaultV1::ValueOutOfRange)?
        / (end - start);
    u16::try_from(covered.min(MAX_COVERAGE_BPS))
        .map_err(|_| ProtectedEconomicMeasurementFaultV1::ValueOutOfRange)
}

/// Parses one canonical money string into a scaled integer of minor units.
///
/// Canonical money is `"<decimal> <CURRENCY>"`. The currency must be the settlement currency, and
/// every value in one measurement is normalized to the widest fraction observed so the comparison
/// between the balance delta and the summed realized PnL is exact.
fn money_raw(
    value: &serde_json::Value,
    currency: &str,
    path: &'static str,
) -> Result<i128, ProtectedEconomicMeasurementFaultV1> {
    let text = value
        .as_str()
        .ok_or(ProtectedEconomicMeasurementFaultV1::MalformedField { path })?;
    let (amount, suffix) = text
        .split_once(' ')
        .ok_or(ProtectedEconomicMeasurementFaultV1::MalformedField { path })?;

    if suffix != currency {
        return Err(
            ProtectedEconomicMeasurementFaultV1::AmbiguousSettlementCurrency { observed: 2 },
        );
    }
    decimal_raw(amount, path)
}

/// Parses a canonical decimal into an integer scaled by [`MONEY_SCALE`] decimal places.
fn decimal_raw(
    amount: &str,
    path: &'static str,
) -> Result<i128, ProtectedEconomicMeasurementFaultV1> {
    let (negative, digits) = match amount.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, amount),
    };
    let (integer, fraction) = digits.split_once('.').unwrap_or((digits, ""));

    if integer.is_empty()
        || !integer.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
        || fraction.len() > MONEY_SCALE
    {
        return Err(ProtectedEconomicMeasurementFaultV1::MalformedField { path });
    }
    let mut raw = integer
        .parse::<i128>()
        .map_err(|_| ProtectedEconomicMeasurementFaultV1::ValueOutOfRange)?
        .checked_mul(MONEY_SCALE_FACTOR)
        .ok_or(ProtectedEconomicMeasurementFaultV1::ValueOutOfRange)?;
    let mut scale = MONEY_SCALE_FACTOR;

    for byte in fraction.bytes() {
        scale /= 10;
        raw = raw
            .checked_add(i128::from(byte - b'0') * scale)
            .ok_or(ProtectedEconomicMeasurementFaultV1::ValueOutOfRange)?;
    }
    Ok(if negative { -raw } else { raw })
}

/// Decimal places every money value is normalized to before it is compared or summed.
const MONEY_SCALE: usize = 18;
const MONEY_SCALE_FACTOR: i128 = 1_000_000_000_000_000_000;

fn nanos(
    value: Option<&serde_json::Value>,
    path: &'static str,
) -> Result<u128, ProtectedEconomicMeasurementFaultV1> {
    value
        .and_then(serde_json::Value::as_str)
        .ok_or(ProtectedEconomicMeasurementFaultV1::MissingField { path })?
        .parse::<u128>()
        .map_err(|_| ProtectedEconomicMeasurementFaultV1::MalformedField { path })
}

fn canonical_result_digest(
    bytes: &[u8],
) -> Result<CanonicalDigestV2, ProtectedEconomicMeasurementFaultV1> {
    #[derive(Serialize)]
    struct Envelope<'a> {
        domain: &'a str,
        length: u64,
    }

    let mut hasher = Sha256::new();
    let envelope = serde_json::to_vec(&Envelope {
        domain: CANONICAL_RESULT_DIGEST_DOMAIN_V1,
        length: bytes.len() as u64,
    })
    .map_err(|e| ProtectedEconomicMeasurementFaultV1::InvalidMeasurement(e.to_string()))?;
    hasher.update(&envelope);
    hasher.update(bytes);
    CanonicalDigestV2::try_from(format!("sha256:{:x}", hasher.finalize()))
        .map_err(|e| ProtectedEconomicMeasurementFaultV1::InvalidMeasurement(e.to_string()))
}
