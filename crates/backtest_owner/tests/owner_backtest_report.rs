//! The Owner's economic report reads a real run, and says nothing when a run said nothing.
//!
//! The corpus is the same canonical Backtest result bytes `protected_economic_measurement.rs`
//! consumes: a real `BacktestEngine`/Sim Exchange target-set round trip in which two members
//! entered, filled, exited, filled again and ended flat against a one-million-dollar margin
//! account. Every expected number below is what that run actually reports, so a reader that
//! silently produced empties would fail here rather than pass.

use rstest::rstest;
use serde_json::{Value, json};
use vibe_backtest::result::CanonicalBacktestResult;
use vibe_strategy_factory::OwnerBacktestReportV1;

const CANONICAL_RESULT: &[u8] =
    include_bytes!("data/protected_round_trip_canonical_result_v1.json");

/// The single return the run recorded, at the close of its 25ns..125ns window.
const EXPECTED_RETURN: f64 = -7.714_904_846_805_236e-5;

fn report() -> OwnerBacktestReportV1 {
    let result = CanonicalBacktestResult::from_slice(CANONICAL_RESULT).unwrap();

    OwnerBacktestReportV1::from_canonical_result(&result).unwrap()
}

/// Rewrites one canonical array and re-reads the bytes, so a control run differs from the corpus
/// only in the field under test.
fn report_with(mutate: impl FnOnce(&mut Value)) -> OwnerBacktestReportV1 {
    let mut document: Value = serde_json::from_slice(CANONICAL_RESULT).unwrap();
    mutate(&mut document);
    let bytes = serde_json::to_vec(&document).unwrap();
    let result = CanonicalBacktestResult::from_slice(&bytes).unwrap();

    OwnerBacktestReportV1::from_canonical_result(&result).unwrap()
}

#[rstest]
fn test_report_states_what_the_real_run_did() {
    let report = report();

    assert_eq!(
        report.run_config_id.as_deref(),
        Some("target-set-backtest-b3-round-trip")
    );
    assert_eq!(report.trader_id, "TRADER-001");
    assert_eq!(report.outcome, "completed");
    assert_eq!(report.backtest_start_ns, Some(25));
    assert_eq!(report.backtest_end_ns, Some(125));
    assert_eq!(report.iterations, 14);
    assert_eq!(report.total_events, 22);
    assert_eq!(report.total_orders, 6);
    assert_eq!(report.total_positions, 2);
}

#[rstest]
fn test_report_lists_every_execution_in_run_order() {
    let report = report();

    assert_eq!(report.fill_count(), 6);

    let first = &report.fills[0];
    assert_eq!(first.ts_event_ns, 25);
    assert_eq!(first.order_side, "BUY");
    assert_eq!(first.instrument_id, "AAPL.XNAS");
    assert_eq!(first.last_qty, "2");
    assert_eq!(first.last_px, "187.25");
    assert_eq!(first.commission.as_deref(), Some("0.00 USD"));
    assert_eq!(first.client_order_id, "client-order-2");

    let last = &report.fills[5];
    assert_eq!(last.ts_event_ns, 125);
    assert_eq!(last.order_side, "SELL");
    assert_eq!(last.instrument_id, "MSFT.XNAS");
    assert_eq!(last.last_qty, "2.0");
    assert_eq!(last.last_px, "421.14");
    assert_eq!(last.client_order_id, "client-order-3");

    // The canonical encoder sorts `fills` for determinism rather than for time, so the reader has
    // to restore run order; an unsorted read would show 125ns before 25ns here.
    let timestamps = report
        .fills
        .iter()
        .map(|fill| fill.ts_event_ns)
        .collect::<Vec<_>>();
    assert_eq!(timestamps, vec![25, 25, 26, 27, 125, 125]);
}

#[rstest]
fn test_report_derives_the_numbers_no_canonical_result_carries() {
    let report = report();

    assert_eq!(report.returns_series, vec![(125, EXPECTED_RETURN)]);

    // A single negative return makes the whole equity curve one drawdown, so net return and
    // maximum drawdown coincide here. Neither is read from `statistics`: no canonical result
    // carries either, because the default analyzer registers no `Max Drawdown`.
    // Both compound through an equity curve that starts at 1.0, so both lose about 4.6e-17 to
    // cancellation against the raw return. The tolerance admits that and nothing larger.
    let net_return = report.net_return.unwrap();
    let max_drawdown = report.max_drawdown.unwrap();
    assert!((net_return - EXPECTED_RETURN).abs() < 1e-15, "{net_return}");
    assert!(
        (max_drawdown - EXPECTED_RETURN).abs() < 1e-15,
        "{max_drawdown}"
    );
    assert!(!report.stats_returns.contains_key("Max Drawdown"));
}

#[rstest]
fn test_report_decodes_the_statistics_the_run_reported() {
    let report = report();

    assert_eq!(report.stats_general.get("Long Ratio"), Some(&1.0));

    let pnls = report.stats_pnls.get("USD").unwrap();
    let total = pnls.get("PnL (total)").unwrap();
    assert!((total + 0.2).abs() < 1e-9, "{total}");
    assert_eq!(pnls.get("Win Rate"), Some(&0.0));

    // The run won nothing, so its win statistics are the encoder's `nan` spelling rather than a
    // number. Decoding them as anything else would turn an undefined statistic into a real one.
    assert!(
        report
            .stats_returns
            .get("Average Win (Return)")
            .unwrap()
            .is_nan()
    );
    assert!(pnls.get("Max Winner").unwrap().is_nan());
}

#[rstest]
fn test_a_run_that_recorded_no_returns_reports_no_number_rather_than_zero() {
    let report = report_with(|document| {
        document["statistics"]["returns_series"] = json!([]);
    });

    assert!(report.returns_series.is_empty());
    assert_eq!(report.net_return, None);
    assert_eq!(report.max_drawdown, None);
}

#[rstest]
fn test_a_run_that_recorded_a_zero_return_reports_zero_rather_than_no_number() {
    let report = report_with(|document| {
        document["statistics"]["returns_series"] =
            json!([{"timestamp_ns": "125", "value": "0000000000000000"}]);
    });

    assert_eq!(report.returns_series, vec![(125, 0.0)]);
    assert_eq!(report.net_return, Some(0.0));
    assert_eq!(report.max_drawdown, Some(0.0));
}

#[rstest]
fn test_a_run_with_no_execution_renders_as_no_execution_rather_than_as_nothing() {
    // The corpus cannot be edited into a run that executed nothing: emptying `fills`, `orders`,
    // `positions` and `position_snapshots` renumbers the document's derived identities, and
    // `from_slice` rejects the result as non-canonical. Only the rendering of an executionless run
    // is exercised here; the reading of real executions is proven on the corpus above.
    let executionless = OwnerBacktestReportV1 {
        fills: Vec::new(),
        ..report()
    };

    assert_eq!(executionless.fill_count(), 0);
    assert!(executionless.to_string().contains("fills           0"));
    assert!(executionless.to_string().contains("(no execution)"));
}

#[rstest]
fn test_report_renders_every_headline_number_it_carries() {
    let rendered = report().to_string();
    println!("{rendered}");

    for line in [
        "run config id   target-set-backtest-b3-round-trip",
        "outcome         completed",
        "iterations      14",
        "total orders    6",
        "total positions 2",
        "fills           6",
    ] {
        assert!(rendered.contains(line), "missing {line} in:\n{rendered}");
    }
    assert!(
        rendered.contains("net return      -0.0000771490"),
        "{rendered}"
    );
    assert!(
        rendered.contains("max drawdown    -0.0000771490"),
        "{rendered}"
    );
    assert!(
        rendered.contains("fill ts=25 ord=3 BUY AAPL.XNAS qty=2 px=187.25"),
        "{rendered}"
    );
}
