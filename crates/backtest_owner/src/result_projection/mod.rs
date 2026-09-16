//! Backtest-owned, read-only projection of sealed canonical result facts.

use std::collections::BTreeSet;

use serde::Serialize;
use serde_json::{Map, Value};
use thiserror::Error;
use vibe_backtest_owner_contracts::{
    BacktestCommissionProjectionV1, BacktestOutcomeEvidenceDtoV1, BacktestRealizedPnlProjectionV1,
    BacktestResultProjectionDtoV1, BacktestResultProjectionLocatorV1, BacktestReturnProjectionV1,
    BacktestSlippageProjectionV1, CanonicalDigestV2,
};
use vibe_backtest_result_custody::LockedExploratoryReplayResultV3;

const PROJECTION_SCHEMA_V1: u16 = 1;
const CANONICAL_RESULT_SCHEMA_V1: &str = "vibe-backtest-result/v1";
const CANONICAL_RESULT_BYTES_DOMAIN_V1: &[u8] = b"vibe.backtest.canonical-result-bytes.v1\0";
const MAX_DRAWDOWN: &str = "Max Drawdown";
const SHARPE_RATIO: &str = "Sharpe Ratio (252 days)";
const SORTINO_RATIO: &str = "Sortino Ratio (252 days)";

/// Move-only positive projection created only from a complete Backtest custody readback.
///
/// The inner DTO is serializable for downstream reads, but this carrier has no public constructor,
/// clone implementation, or deserializer.
#[derive(Debug, Serialize)]
#[serde(transparent)]
pub struct SealedBacktestResultProjectionV1(BacktestResultProjectionDtoV1);

impl SealedBacktestResultProjectionV1 {
    /// Returns the dependency-neutral projection vocabulary.
    #[must_use]
    pub const fn projection(&self) -> &BacktestResultProjectionDtoV1 {
        &self.0
    }

    /// Returns the exact compact JSON representation of this projection.
    ///
    /// # Errors
    ///
    /// Returns an error if serialization is unavailable.
    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, BacktestResultProjectionErrorV1> {
        serde_json::to_vec(&self.0)
            .map_err(|_| BacktestResultProjectionErrorV1::ProjectionEncodingUnavailable)
    }
}

/// Derives an economic-fact projection from one exact, Owner-verified result readback.
///
/// The locator selects the expected result/request/attempt and canonical-result digest only. All
/// projected values are decoded from the canonical engine-result bytes retained by Backtest.
///
/// # Errors
///
/// Fails closed on any authority mismatch, canonical-byte mismatch, malformed or missing required
/// fact, open terminal position, absent closed round trip, empty returns, or non-finite metric.
pub fn project_locked_exploratory_replay_result_v1(
    locked: &LockedExploratoryReplayResultV3,
    locator: &BacktestResultProjectionLocatorV1,
) -> Result<SealedBacktestResultProjectionV1, BacktestResultProjectionErrorV1> {
    let result = locked.replay().result();
    let evidence = locked.outcome_evidence();
    if evidence.result_identity != result.result_identity
        || evidence.result_digest != result.result_digest
        || evidence.request_identity != result.request_identity
        || evidence.request_meaning_digest != result.request_meaning_digest
        || evidence.attempt_identity != result.attempt_identity
    {
        return Err(BacktestResultProjectionErrorV1::AuthorityMismatch);
    }

    project_verified_outcome(evidence, locked.engine_canonical_result_bytes(), locator)
        .map(SealedBacktestResultProjectionV1)
}

fn project_verified_outcome(
    evidence: &BacktestOutcomeEvidenceDtoV1,
    canonical_result_bytes: &[u8],
    locator: &BacktestResultProjectionLocatorV1,
) -> Result<BacktestResultProjectionDtoV1, BacktestResultProjectionErrorV1> {
    if evidence.result_identity != locator.result_identity
        || evidence.result_digest != locator.result_digest
        || evidence.request_identity != locator.request_identity
        || evidence.attempt_identity != locator.attempt_identity
        || evidence.canonical_result.canonical_bytes_digest != locator.canonical_result_digest
    {
        return Err(BacktestResultProjectionErrorV1::AuthorityMismatch);
    }

    let canonical_result_digest = canonical_result_digest(canonical_result_bytes)?;
    let canonical_result_length = u64::try_from(canonical_result_bytes.len())
        .map_err(|_| BacktestResultProjectionErrorV1::CanonicalResultBindingMismatch)?;
    if evidence.canonical_result.schema_identity.as_str() != CANONICAL_RESULT_SCHEMA_V1
        || evidence.canonical_result.canonical_bytes_length != canonical_result_length
        || evidence.canonical_result.canonical_bytes_digest != canonical_result_digest
    {
        return Err(BacktestResultProjectionErrorV1::CanonicalResultBindingMismatch);
    }

    let document: Value = serde_json::from_slice(canonical_result_bytes)
        .map_err(|_| invalid("canonical result JSON"))?;
    if serde_json::to_vec(&document).map_err(|_| invalid("canonical result encoding"))?
        != canonical_result_bytes
    {
        return Err(invalid("canonical result encoding"));
    }
    let root = object(&document, "canonical result")?;
    require_exact_fields(
        root,
        &[
            "accounts",
            "components",
            "diagnostics",
            "fills",
            "orders",
            "portfolio_snapshots",
            "position_snapshots",
            "positions",
            "run",
            "schema",
            "statistics",
            "summary",
        ],
        "canonical result",
    )?;
    if string(root, "schema", "canonical result schema")? != CANONICAL_RESULT_SCHEMA_V1 {
        return Err(invalid("canonical result schema"));
    }
    let run = object_field(root, "run", "canonical result run")?;
    if string(run, "outcome", "canonical result outcome")? != "completed" {
        return Err(BacktestResultProjectionErrorV1::IncompleteRun);
    }

    let orders = array(root, "orders", "canonical orders")?;
    let fills = array(root, "fills", "canonical fills")?;
    let positions = array(root, "positions", "canonical positions")?;
    if orders.is_empty() || fills.is_empty() || positions.is_empty() {
        return Err(missing("orders, fills, or positions"));
    }
    let orders_count = count(orders)?;
    let fills_count = count(fills)?;
    let positions_count = count(positions)?;

    let slippages = project_slippages(orders)?;
    let commissions = project_commissions(fills)?;
    let (closed_round_trips_count, realized_pnls) = project_closed_positions(positions)?;
    if closed_round_trips_count == 0 {
        return Err(missing("closed round trip"));
    }

    let summary = object_field(root, "summary", "canonical summary")?;
    require_summary_count(summary, "orders.total", orders_count)?;
    require_summary_count(summary, "positions.total", positions_count)?;
    require_summary_count(summary, "positions.closed", closed_round_trips_count)?;
    let terminal_flat = summary_count(summary, "positions.open")? == 0
        && positions.iter().all(|position| {
            position
                .as_object()
                .and_then(|value| value.get("side"))
                .and_then(Value::as_str)
                == Some("FLAT")
        });
    if !terminal_flat {
        return Err(BacktestResultProjectionErrorV1::TerminalPositionOpen);
    }

    let statistics = object_field(root, "statistics", "canonical statistics")?;
    let returns_series = project_returns(array(
        statistics,
        "returns_series",
        "canonical returns series",
    )?)?;
    if returns_series.is_empty() {
        return Err(missing("returns series"));
    }
    let general = object_field(statistics, "general", "canonical general statistics")?;
    let returns = object_field(statistics, "returns", "canonical return statistics")?;
    let max_drawdown = finite_metric(general, MAX_DRAWDOWN)?;
    let sharpe_ratio = finite_metric(returns, SHARPE_RATIO)?;
    let sortino_ratio = finite_metric(returns, SORTINO_RATIO)?;

    Ok(BacktestResultProjectionDtoV1 {
        schema_version: PROJECTION_SCHEMA_V1,
        result_identity: evidence.result_identity.clone(),
        result_digest: evidence.result_digest.clone(),
        request_identity: evidence.request_identity.clone(),
        request_meaning_digest: evidence.request_meaning_digest.clone(),
        attempt_identity: evidence.attempt_identity.clone(),
        canonical_result_schema_identity: evidence.canonical_result.schema_identity.clone(),
        canonical_result_digest,
        orders_count,
        fills_count,
        positions_count,
        closed_round_trips_count,
        terminal_flat,
        commissions,
        slippages,
        realized_pnls,
        returns_series,
        max_drawdown,
        sharpe_ratio,
        sortino_ratio,
    })
}

fn project_slippages(
    orders: &[Value],
) -> Result<Vec<BacktestSlippageProjectionV1>, BacktestResultProjectionErrorV1> {
    orders
        .iter()
        .map(|order| {
            let variant = single_variant(order, "canonical order")?;
            let core = object_field(variant, "core", "canonical order core")?;
            Ok(BacktestSlippageProjectionV1 {
                client_order_identity: string(core, "client_order_id", "canonical order identity")?
                    .to_owned(),
                value: nonempty_string(core, "slippage", "canonical order slippage")?.to_owned(),
            })
        })
        .collect()
}

fn project_commissions(
    fills: &[Value],
) -> Result<Vec<BacktestCommissionProjectionV1>, BacktestResultProjectionErrorV1> {
    fills
        .iter()
        .map(|fill| {
            let fill = object(fill, "canonical fill")?;
            let event = object_field(fill, "event", "canonical fill event")?;
            let event = event
                .get("Filled")
                .ok_or_else(|| missing("canonical Filled event"))
                .and_then(|value| object(value, "canonical Filled event"))?;
            Ok(BacktestCommissionProjectionV1 {
                client_order_identity: string(
                    fill,
                    "client_order_id",
                    "canonical fill order identity",
                )?
                .to_owned(),
                trade_identity: string(event, "trade_id", "canonical fill trade identity")?
                    .to_owned(),
                amount: nonempty_string(event, "commission", "canonical fill commission")?
                    .to_owned(),
            })
        })
        .collect()
}

fn project_closed_positions(
    positions: &[Value],
) -> Result<(u64, Vec<BacktestRealizedPnlProjectionV1>), BacktestResultProjectionErrorV1> {
    let mut realized = Vec::with_capacity(positions.len());
    for position in positions {
        let position = object(position, "canonical position")?;
        if string(position, "side", "canonical position side")? != "FLAT"
            || nonempty_string(position, "ts_closed", "canonical position close timestamp").is_err()
        {
            return Err(BacktestResultProjectionErrorV1::TerminalPositionOpen);
        }
        realized.push(BacktestRealizedPnlProjectionV1 {
            position_identity: string(position, "position_id", "canonical position identity")?
                .to_owned(),
            amount: nonempty_string(position, "realized_pnl", "canonical realized PnL")?.to_owned(),
        });
    }
    Ok((count(positions)?, realized))
}

fn project_returns(
    values: &[Value],
) -> Result<Vec<BacktestReturnProjectionV1>, BacktestResultProjectionErrorV1> {
    let mut previous = None;
    values
        .iter()
        .map(|point| {
            let point = object(point, "canonical return point")?;
            let timestamp =
                canonical_u64_string(string(point, "timestamp_ns", "canonical return timestamp")?)?;
            if previous.is_some_and(|value| value >= timestamp) {
                return Err(invalid("canonical return timestamp ordering"));
            }
            previous = Some(timestamp);
            Ok(BacktestReturnProjectionV1 {
                timestamp_ns: timestamp.to_string(),
                value: finite_bits(
                    string(point, "value", "canonical return value")?,
                    "returns series",
                )?,
            })
        })
        .collect()
}

fn finite_metric(
    metrics: &Map<String, Value>,
    name: &'static str,
) -> Result<String, BacktestResultProjectionErrorV1> {
    finite_bits(string(metrics, name, name)?, name)
}

fn finite_bits(
    value: &str,
    field: &'static str,
) -> Result<String, BacktestResultProjectionErrorV1> {
    if value.len() != 16
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(BacktestResultProjectionErrorV1::NonFiniteValue(field));
    }
    let bits = u64::from_str_radix(value, 16)
        .map_err(|_| BacktestResultProjectionErrorV1::NonFiniteValue(field))?;
    if !f64::from_bits(bits).is_finite() {
        return Err(BacktestResultProjectionErrorV1::NonFiniteValue(field));
    }
    Ok(value.to_owned())
}

fn canonical_result_digest(
    bytes: &[u8],
) -> Result<CanonicalDigestV2, BacktestResultProjectionErrorV1> {
    if bytes.is_empty() {
        return Err(BacktestResultProjectionErrorV1::CanonicalResultBindingMismatch);
    }
    let mut hasher = blake3::Hasher::new();
    hasher.update(CANONICAL_RESULT_BYTES_DOMAIN_V1);
    hasher.update(bytes);
    CanonicalDigestV2::try_from(format!("blake3:{}", hasher.finalize().to_hex()))
        .map_err(|_| BacktestResultProjectionErrorV1::CanonicalResultBindingMismatch)
}

fn single_variant<'a>(
    value: &'a Value,
    context: &'static str,
) -> Result<&'a Map<String, Value>, BacktestResultProjectionErrorV1> {
    let mapping = object(value, context)?;
    if mapping.len() != 1 {
        return Err(invalid(context));
    }
    mapping
        .values()
        .next()
        .ok_or_else(|| invalid(context))
        .and_then(|value| object(value, context))
}

fn require_exact_fields(
    object: &Map<String, Value>,
    expected: &[&str],
    context: &'static str,
) -> Result<(), BacktestResultProjectionErrorV1> {
    let actual = object.keys().map(String::as_str).collect::<BTreeSet<_>>();
    let expected = expected.iter().copied().collect::<BTreeSet<_>>();
    if actual != expected {
        return Err(invalid(context));
    }
    Ok(())
}

fn object<'a>(
    value: &'a Value,
    context: &'static str,
) -> Result<&'a Map<String, Value>, BacktestResultProjectionErrorV1> {
    value.as_object().ok_or_else(|| invalid(context))
}

fn object_field<'a>(
    mapping: &'a Map<String, Value>,
    key: &'static str,
    context: &'static str,
) -> Result<&'a Map<String, Value>, BacktestResultProjectionErrorV1> {
    mapping
        .get(key)
        .ok_or_else(|| missing(context))
        .and_then(|value| object(value, context))
}

fn array<'a>(
    object: &'a Map<String, Value>,
    key: &'static str,
    context: &'static str,
) -> Result<&'a [Value], BacktestResultProjectionErrorV1> {
    object
        .get(key)
        .ok_or_else(|| missing(context))?
        .as_array()
        .map(Vec::as_slice)
        .ok_or_else(|| invalid(context))
}

fn string<'a>(
    object: &'a Map<String, Value>,
    key: &'static str,
    context: &'static str,
) -> Result<&'a str, BacktestResultProjectionErrorV1> {
    object
        .get(key)
        .ok_or_else(|| missing(context))?
        .as_str()
        .ok_or_else(|| invalid(context))
}

fn nonempty_string<'a>(
    object: &'a Map<String, Value>,
    key: &'static str,
    context: &'static str,
) -> Result<&'a str, BacktestResultProjectionErrorV1> {
    let value = string(object, key, context)?;
    if value.is_empty() {
        return Err(missing(context));
    }
    Ok(value)
}

fn summary_count(
    summary: &Map<String, Value>,
    key: &'static str,
) -> Result<u64, BacktestResultProjectionErrorV1> {
    canonical_u64_string(string(summary, key, "canonical summary count")?)
}

fn require_summary_count(
    summary: &Map<String, Value>,
    key: &'static str,
    expected: u64,
) -> Result<(), BacktestResultProjectionErrorV1> {
    if summary_count(summary, key)? != expected {
        return Err(invalid("canonical summary count"));
    }
    Ok(())
}

fn canonical_u64_string(value: &str) -> Result<u64, BacktestResultProjectionErrorV1> {
    if value != "0"
        && (value.is_empty()
            || value.starts_with('0')
            || !value.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err(invalid("canonical unsigned decimal"));
    }
    value
        .parse()
        .map_err(|_| invalid("canonical unsigned decimal"))
}

fn count(values: &[Value]) -> Result<u64, BacktestResultProjectionErrorV1> {
    u64::try_from(values.len()).map_err(|_| invalid("canonical collection length"))
}

const fn invalid(context: &'static str) -> BacktestResultProjectionErrorV1 {
    BacktestResultProjectionErrorV1::InvalidCanonicalResult(context)
}

const fn missing(context: &'static str) -> BacktestResultProjectionErrorV1 {
    BacktestResultProjectionErrorV1::MissingCanonicalFact(context)
}

/// Fail-closed projection errors.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum BacktestResultProjectionErrorV1 {
    #[error("Backtest projection authority is cross-spliced")]
    AuthorityMismatch,
    #[error("canonical Backtest result binding does not match its Owner readback")]
    CanonicalResultBindingMismatch,
    #[error("canonical Backtest result is invalid: {0}")]
    InvalidCanonicalResult(&'static str),
    #[error("canonical Backtest result is missing required fact: {0}")]
    MissingCanonicalFact(&'static str),
    #[error("canonical Backtest run is not completed")]
    IncompleteRun,
    #[error("canonical Backtest result is not terminal-flat")]
    TerminalPositionOpen,
    #[error("canonical Backtest value is non-finite: {0}")]
    NonFiniteValue(&'static str),
    #[error("Backtest result projection encoding is unavailable")]
    ProjectionEncodingUnavailable,
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use vibe_backtest_owner_contracts::{
        BacktestOutcomeEvidenceBindingsV1, CanonicalResultBindingDtoV1,
        ComponentObservationLocatorV2, ContentIdentityV2, ObservationComponentV2, OpaqueIdentityV2,
    };

    use super::*;

    fn identity(value: &str) -> OpaqueIdentityV2 {
        OpaqueIdentityV2::try_from(value.to_owned()).unwrap()
    }

    fn digest(marker: char) -> CanonicalDigestV2 {
        CanonicalDigestV2::try_from(format!("blake3:{}", marker.to_string().repeat(64))).unwrap()
    }

    fn canonical_document() -> Value {
        json!({
            "accounts": [],
            "components": {
                "actor_ids": [],
                "exec_algorithm_ids": [],
                "strategy_ids": [],
                "trader_state": "STOPPED"
            },
            "diagnostics": [],
            "fills": [{
                "client_order_id": "order-1",
                "event": {"Filled": {
                    "commission": "1.00000000 USDT",
                    "trade_id": "trade-1"
                }},
                "order_event_ordinal": "1"
            }],
            "orders": [{"Market": {"core": {
                "client_order_id": "order-1",
                "slippage": "0.25"
            }}}],
            "portfolio_snapshots": [],
            "position_snapshots": [],
            "positions": [{
                "position_id": "position-1",
                "realized_pnl": "4.00000000 USDT",
                "side": "FLAT",
                "ts_closed": "20"
            }],
            "run": {
                "backtest_end_ns": "20",
                "backtest_start_ns": "10",
                "iterations": "2",
                "outcome": "completed",
                "run_config_id": "config-1",
                "total_events": "3",
                "total_orders": "1",
                "total_positions": "1",
                "trader_id": "trader-1"
            },
            "schema": CANONICAL_RESULT_SCHEMA_V1,
            "statistics": {
                "general": {MAX_DRAWDOWN: "bfb999999999999a"},
                "pnls": {"USDT": {"PnL (total)": "4010000000000000"}},
                "returns": {
                    SHARPE_RATIO: "3ff0000000000000",
                    SORTINO_RATIO: "4000000000000000"
                },
                "returns_series": [
                    {"timestamp_ns": "10", "value": "3f847ae147ae147b"},
                    {"timestamp_ns": "20", "value": "bf847ae147ae147b"}
                ]
            },
            "summary": {
                "orders.total": "1",
                "positions.closed": "1",
                "positions.open": "0",
                "positions.total": "1"
            }
        })
    }

    fn authority(
        document: &Value,
    ) -> (
        Vec<u8>,
        BacktestOutcomeEvidenceDtoV1,
        BacktestResultProjectionLocatorV1,
    ) {
        let bytes = serde_json::to_vec(document).unwrap();
        let canonical_result_digest = canonical_result_digest(&bytes).unwrap();
        let evidence =
            BacktestOutcomeEvidenceDtoV1::from_bindings(BacktestOutcomeEvidenceBindingsV1 {
                result_identity: identity("result-1"),
                result_digest: digest('1'),
                request_identity: identity("request-1"),
                request_meaning_digest: digest('2'),
                attempt_identity: identity("attempt-1"),
                frozen_research_intent: ContentIdentityV2 {
                    identity: identity("intent-1"),
                    digest: digest('3'),
                },
                trial_family_census_frontier: ContentIdentityV2 {
                    identity: identity("census-1"),
                    digest: digest('4'),
                },
                semantic_trace: ComponentObservationLocatorV2 {
                    component: ObservationComponentV2::SemanticTrace,
                    reference: identity("trace-1"),
                    digest: digest('5'),
                },
                canonical_result: CanonicalResultBindingDtoV1 {
                    schema_identity: identity(CANONICAL_RESULT_SCHEMA_V1),
                    canonical_bytes_digest: canonical_result_digest.clone(),
                    canonical_bytes_length: u64::try_from(bytes.len()).unwrap(),
                },
            })
            .unwrap();
        let locator = BacktestResultProjectionLocatorV1 {
            result_identity: evidence.result_identity.clone(),
            result_digest: evidence.result_digest.clone(),
            request_identity: evidence.request_identity.clone(),
            attempt_identity: evidence.attempt_identity.clone(),
            canonical_result_digest,
        };
        (bytes, evidence, locator)
    }

    #[test]
    fn canonical_owner_result_projects_bound_economic_facts() {
        let document = canonical_document();
        let (bytes, evidence, locator) = authority(&document);
        let projection = project_verified_outcome(&evidence, &bytes, &locator).unwrap();

        assert_eq!(projection.result_identity.as_str(), "result-1");
        assert_eq!(projection.request_identity.as_str(), "request-1");
        assert_eq!(projection.attempt_identity.as_str(), "attempt-1");
        assert_eq!(projection.orders_count, 1);
        assert_eq!(projection.fills_count, 1);
        assert_eq!(projection.positions_count, 1);
        assert_eq!(projection.closed_round_trips_count, 1);
        assert!(projection.terminal_flat);
        assert_eq!(projection.commissions[0].amount, "1.00000000 USDT");
        assert_eq!(projection.slippages[0].value, "0.25");
        assert_eq!(projection.realized_pnls[0].amount, "4.00000000 USDT");
        assert_eq!(projection.returns_series.len(), 2);
        assert_eq!(projection.max_drawdown, "bfb999999999999a");
        assert_eq!(projection.sharpe_ratio, "3ff0000000000000");
        assert_eq!(projection.sortino_ratio, "4000000000000000");
    }

    #[test]
    fn authority_or_canonical_bytes_mismatch_yields_no_projection() {
        let document = canonical_document();
        let (bytes, evidence, locator) = authority(&document);
        let mut mismatches = Vec::new();
        let mut wrong = locator.clone();
        wrong.result_identity = identity("result-2");
        mismatches.push(wrong);
        let mut wrong = locator.clone();
        wrong.result_digest = digest('9');
        mismatches.push(wrong);
        let mut wrong = locator.clone();
        wrong.request_identity = identity("request-2");
        mismatches.push(wrong);
        let mut wrong = locator.clone();
        wrong.attempt_identity = identity("attempt-2");
        mismatches.push(wrong);
        let mut wrong = locator.clone();
        wrong.canonical_result_digest = digest('8');
        mismatches.push(wrong);

        for mismatch in mismatches {
            assert_eq!(
                project_verified_outcome(&evidence, &bytes, &mismatch),
                Err(BacktestResultProjectionErrorV1::AuthorityMismatch)
            );
        }

        let (_, _, locator) = authority(&document);
        let mut tampered = bytes;
        tampered.push(b' ');
        assert_eq!(
            project_verified_outcome(&evidence, &tampered, &locator),
            Err(BacktestResultProjectionErrorV1::CanonicalResultBindingMismatch)
        );
    }

    #[test]
    fn incomplete_economic_facts_fail_closed() {
        let mut cases = Vec::new();

        let mut no_round_trip = canonical_document();
        no_round_trip["positions"] = json!([]);
        no_round_trip["summary"]["positions.closed"] = json!("0");
        no_round_trip["summary"]["positions.total"] = json!("0");
        cases.push(no_round_trip);

        let mut open = canonical_document();
        open["positions"][0]["side"] = json!("LONG");
        open["positions"][0]["ts_closed"] = Value::Null;
        open["summary"]["positions.closed"] = json!("0");
        open["summary"]["positions.open"] = json!("1");
        cases.push(open);

        let mut no_returns = canonical_document();
        no_returns["statistics"]["returns_series"] = json!([]);
        cases.push(no_returns);

        let mut no_drawdown = canonical_document();
        no_drawdown["statistics"]["general"] = json!({});
        cases.push(no_drawdown);

        let mut nonfinite_sharpe = canonical_document();
        nonfinite_sharpe["statistics"]["returns"][SHARPE_RATIO] = json!("nan");
        cases.push(nonfinite_sharpe);

        let mut nonfinite_sortino = canonical_document();
        nonfinite_sortino["statistics"]["returns"][SORTINO_RATIO] = json!("+inf");
        cases.push(nonfinite_sortino);

        for document in cases {
            let (bytes, evidence, locator) = authority(&document);
            assert!(project_verified_outcome(&evidence, &bytes, &locator).is_err());
        }
    }
}
