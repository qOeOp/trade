//! The protected economic measurement is derived from one run, or it does not exist.
//!
//! The fixture is the exact canonical Backtest result bytes a real `BacktestEngine`/Sim Exchange
//! target-set round trip produced: two members entered, filled, exited, filled again and ended
//! flat, paying commission against a one-million-dollar margin account. Nothing here reconstructs
//! or approximates a run; every expected number below is what that run actually reports.

use rstest::rstest;
use serde_json::{Value, json};
use vibe_backtest_owner::protected_economic_measurement::{
    ProtectedEconomicMeasurementBindingsV1, ProtectedEconomicMeasurementFaultV1,
    derive_protected_economic_measurement_v1,
};
use vibe_backtest_owner_contracts::OpaqueIdentityV2;
use vibe_backtest_owner_contracts::protected_economic_metric::{
    BASIS_POINTS_UNIT, ProtectedEconomicComputationV1, ProtectedEconomicCoverageRuleV1,
    ProtectedEconomicMetricV1,
};

const CANONICAL_RESULT: &[u8] =
    include_bytes!("data/protected_round_trip_canonical_result_v1.json");

/// The run lost twenty cents of a one-million-dollar account: -0.002 basis points, scaled by 10^4.
const EXPECTED_OBSERVED_RAW: i64 = -20;

/// Positions opened at 25ns and closed at 125ns inside a 25ns..125ns run window.
const EXPECTED_COVERAGE_BPS: u16 = 10_000;

fn computation() -> ProtectedEconomicComputationV1 {
    ProtectedEconomicComputationV1 {
        metric: ProtectedEconomicMetricV1::NetReturnBasisPoints,
        coverage_rule: ProtectedEconomicCoverageRuleV1::ObservedWindowSpan,
    }
}

fn bindings() -> ProtectedEconomicMeasurementBindingsV1 {
    ProtectedEconomicMeasurementBindingsV1 {
        request_identity: "qualification-protected-request-1".to_owned(),
        request_digest: format!("sha256:{}", "1".repeat(64)),
        attempt_identity: "backtest-protected-attempt-1".to_owned(),
        protected_plan_identity: "qualification-protected-plan-1".to_owned(),
        protected_plan_digest: format!("sha256:{}", "2".repeat(64)),
        plan_cell_set_identity: "qualification-protected-cell-set-1".to_owned(),
        plan_cell_set_digest: format!("sha256:{}", "3".repeat(64)),
        plan_cell_identity: "qualification-protected-cell-1".to_owned(),
        plan_cell_digest: format!("sha256:{}", "4".repeat(64)),
        result_time_evidence_digest: format!("sha256:{}", "5".repeat(64)),
        evidence_owner: OpaqueIdentityV2::try_from("backtest-owner".to_owned()).unwrap(),
        evidence_reference: OpaqueIdentityV2::try_from(
            "backtest-protected-canonical-result-1".to_owned(),
        )
        .unwrap(),
    }
}

/// Re-encodes an edited canonical document the way the engine's writer does.
fn recanonicalize(document: &Value) -> Vec<u8> {
    serde_json::to_vec(document).expect("canonical document re-encodes")
}

fn document() -> Value {
    serde_json::from_slice(CANONICAL_RESULT).expect("fixture is canonical JSON")
}

fn account_base(document: &mut Value) -> &mut Value {
    document["accounts"][0]
        .as_object_mut()
        .expect("account variant")
        .values_mut()
        .next()
        .expect("account payload")
        .get_mut("base")
        .expect("account base")
}

#[rstest]
fn a_real_run_yields_exactly_the_measurement_its_own_result_supports() {
    let sealed =
        derive_protected_economic_measurement_v1(CANONICAL_RESULT, computation(), &bindings())
            .expect("the round-trip run supports a measurement");
    let measurement = sealed.measurement();

    assert_eq!(measurement.observed_raw, EXPECTED_OBSERVED_RAW);
    assert_eq!(measurement.observed_coverage_bps, EXPECTED_COVERAGE_BPS);
    assert_eq!(
        measurement.metric_identity,
        ProtectedEconomicMetricV1::NetReturnBasisPoints.semantic_id()
    );
    assert_eq!(
        measurement.metric_digest,
        ProtectedEconomicMetricV1::NetReturnBasisPoints
            .definition_digest()
            .unwrap(),
        "the measurement names the frozen definition it was computed under"
    );
    assert_eq!(measurement.unit, BASIS_POINTS_UNIT);
    assert_eq!(measurement.decimal_scale, 4);

    // The decisive evidence is the run's own result, not a locator the caller chose.
    assert_eq!(
        measurement.decisive_evidence.digest,
        *sealed.canonical_result_digest()
    );
    assert_eq!(
        measurement.decisive_evidence.owner.as_str(),
        "backtest-owner"
    );

    // The measurement is self-consistent: identity derived from digest, digest over the content.
    measurement
        .validate()
        .expect("derived measurement is valid");
    assert_eq!(
        measurement.measurement_digest,
        measurement.compute_digest().unwrap()
    );
    assert!(
        measurement.measurement_identity.ends_with(
            measurement
                .measurement_digest
                .strip_prefix("blake3:")
                .unwrap()
        )
    );
}

#[rstest]
fn the_same_result_always_derives_the_same_measurement() {
    let first =
        derive_protected_economic_measurement_v1(CANONICAL_RESULT, computation(), &bindings())
            .unwrap();
    let second =
        derive_protected_economic_measurement_v1(CANONICAL_RESULT, computation(), &bindings())
            .unwrap();
    assert_eq!(first, second);
    assert_eq!(
        first.measurement().measurement_digest,
        second.measurement().measurement_digest
    );
}

#[rstest]
fn bytes_that_are_not_this_engine_s_canonical_encoding_measure_nothing() {
    // Same document, different encoding: the run's own writer emits compact canonical bytes, so a
    // re-indented copy is not the result that run produced and measures nothing.
    let reindented = serde_json::to_vec_pretty(&document()).expect("pretty document");
    assert!(matches!(
        derive_protected_economic_measurement_v1(&reindented, computation(), &bindings()),
        Err(ProtectedEconomicMeasurementFaultV1::NonCanonicalResult(_))
    ));
    assert!(matches!(
        derive_protected_economic_measurement_v1(b"{}", computation(), &bindings()),
        Err(ProtectedEconomicMeasurementFaultV1::NonCanonicalResult(_))
    ));
    let mut truncated = CANONICAL_RESULT.to_vec();
    truncated.pop();
    assert!(matches!(
        derive_protected_economic_measurement_v1(&truncated, computation(), &bindings()),
        Err(ProtectedEconomicMeasurementFaultV1::NonCanonicalResult(_))
    ));
}

#[rstest]
fn a_better_balance_alone_cannot_buy_a_better_return() {
    let mut document = document();
    account_base(&mut document)["balances"]["USD"]["total"] = json!("1000500.00 USD");
    let inflated = recanonicalize(&document);

    // The edit is canonical, so the result parses; it still measures nothing, because the account
    // delta no longer reproduces the realized PnL the positions actually recorded.
    let fault = derive_protected_economic_measurement_v1(&inflated, computation(), &bindings())
        .expect_err("an unreconciled balance measures nothing");
    assert!(
        matches!(
            fault,
            ProtectedEconomicMeasurementFaultV1::UnreconciledRealizedPnl { .. }
        ),
        "expected an unreconciled balance, received {fault}"
    );
}

#[rstest]
fn the_measurement_follows_the_run_it_was_given() {
    // A different run, consistent on both sides: each position earned a dollar instead of losing
    // ten cents, and the account balance agrees. The derived return moves with it, exactly.
    let mut document = document();
    account_base(&mut document)["balances"]["USD"]["total"] = json!("1000002.00 USD");

    for position in document["positions"]
        .as_array_mut()
        .expect("positions")
        .iter_mut()
    {
        position["realized_pnl"] = json!("1.00 USD");
    }
    let profitable = recanonicalize(&document);
    let sealed =
        derive_protected_economic_measurement_v1(&profitable, computation(), &bindings()).unwrap();

    // +2.00 on 1000000.00 is 0.02 basis points, scaled by 10^4.
    assert_eq!(sealed.measurement().observed_raw, 200);
    assert_ne!(
        sealed.canonical_result_digest(),
        derive_protected_economic_measurement_v1(CANONICAL_RESULT, computation(), &bindings())
            .unwrap()
            .canonical_result_digest(),
        "a different run is bound to different decisive evidence"
    );
}

#[rstest]
fn an_ambiguous_or_empty_run_measures_nothing() {
    let mut two_accounts = document();
    let duplicate = two_accounts["accounts"][0].clone();
    two_accounts["accounts"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    assert!(matches!(
        derive_protected_economic_measurement_v1(
            &recanonicalize(&two_accounts),
            computation(),
            &bindings()
        ),
        Err(ProtectedEconomicMeasurementFaultV1::AmbiguousAccount { observed: 2 })
    ));

    let mut two_currencies = document();
    two_currencies["positions"][0]["settlement_currency"] = json!("EUR");
    assert!(matches!(
        derive_protected_economic_measurement_v1(
            &recanonicalize(&two_currencies),
            computation(),
            &bindings()
        ),
        Err(ProtectedEconomicMeasurementFaultV1::AmbiguousSettlementCurrency { .. })
    ));

    let mut no_positions = document();
    no_positions["positions"] = json!([]);
    account_base(&mut no_positions)["balances"]["USD"]["total"] = json!("1000000.00 USD");
    assert!(matches!(
        derive_protected_economic_measurement_v1(
            &recanonicalize(&no_positions),
            computation(),
            &bindings()
        ),
        Err(ProtectedEconomicMeasurementFaultV1::NoObservedPosition)
    ));
}

#[rstest]
fn a_run_that_started_with_nothing_expresses_no_return() {
    let mut document = document();
    let base = account_base(&mut document);
    base["balances_starting"]["USD"] = json!("0.00 USD");
    base["balances"]["USD"]["total"] = json!("-0.20 USD");
    assert!(matches!(
        derive_protected_economic_measurement_v1(
            &recanonicalize(&document),
            computation(),
            &bindings()
        ),
        Err(ProtectedEconomicMeasurementFaultV1::NonPositiveStartingBalance)
    ));
}
