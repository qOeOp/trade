use rstest::rstest;
use vibe_backtest_statistics::RoundTripsFromFillsErrorV1;

use super::*;

const DAY: i64 = 86_400_000_000_000;

fn bars() -> Vec<BarOpenV1> {
    (0..40)
        .map(|day| BarOpenV1 {
            open_ns: (19_723 + day) * DAY,
            open: 100.0 + day as f64,
        })
        .collect()
}

fn fill(day: i64, side: &str, price: &str, commission: Option<&str>) -> OwnerBacktestFillV1 {
    OwnerBacktestFillV1 {
        ts_event_ns: u64::try_from((19_723 + day) * DAY).unwrap(),
        order_event_ordinal: 1,
        client_order_id: format!("O-{day}"),
        instrument_id: "BTCUSDT-PERP.BINANCE".to_owned(),
        order_side: side.to_owned(),
        last_qty: "1".to_owned(),
        last_px: price.to_owned(),
        commission: commission.map(str::to_owned),
    }
}

fn fills() -> Vec<OwnerBacktestFillV1> {
    vec![
        fill(2, "BUY", "102.5", Some("0.05 USDT")),
        fill(5, "SELL", "106", Some("0.0125 USDT")),
        fill(10, "SELL", "110", Some("1 BNB")),
        fill(12, "BUY", "111", None),
    ]
}

fn assemble(
    fills: &[OwnerBacktestFillV1],
    funding: Option<&[f64]>,
) -> Result<BacktestRunReportDocumentV1, BacktestRunReportDocumentErrorV1> {
    let report = crate::backtest_run_report_read_v1::tests::sample_projection_v1();
    let bars = bars();
    assemble_backtest_run_report_v1(&BacktestRunReportInputsV1 {
        report: &report,
        fills,
        bars: &bars,
        funding_per_bar: funding,
        cost_per_side: 0.0005,
        request_identity: &[3; 32],
    })
}

/// A run report carries the four-question report unchanged, says it is exploratory with no
/// holdout, names how it was priced, totals its fees exactly per currency, and measures its round
/// trips against matched entries.
#[rstest]
fn a_report_carries_the_run_its_pricing_fees_standing_and_control() {
    let document = assemble(&fills(), None).expect("assembles");

    assert_eq!(
        document.report,
        crate::backtest_run_report_read_v1::tests::sample_projection_v1()
    );
    assert_eq!(
        (document.standing, document.holdout),
        ("EXPLORATORY_ONLY", "NO_HOLDOUT_PARTITION_DEFINED")
    );
    assert_eq!(
        (document.pricing.funding, document.pricing.fees),
        ("NOT_STATED", "SEALED_INSTRUMENT_TERMS")
    );
    assert_eq!(
        document.fees,
        [
            BacktestRunFeesV1 {
                currency: "BNB".to_owned(),
                total: "1".to_owned(),
            },
            BacktestRunFeesV1 {
                currency: "USDT".to_owned(),
                total: "0.0625".to_owned(),
            },
        ]
    );
    assert_eq!(document.control.entries.len(), 2);
    assert!(!document.control.funding_stated);
    assert_eq!(document.control.seed, u64::from_le_bytes([3; 8]));
    let long = &document.control.entries[0];
    assert!((long.result - (106.0 / 102.5 - 1.0 - 0.001)).abs() < 1e-12);
}

/// The report's wire shape: the four-question report nested whole under `report`, beside what a run
/// report adds.
#[rstest]
fn the_wire_shape_nests_the_four_questions_beside_what_a_run_report_adds() {
    let value = serde_json::to_value(assemble(&fills(), Some(&[0.0001; 40])).unwrap()).unwrap();
    let mut keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
    keys.sort();

    assert_eq!(
        keys,
        [
            "control",
            "fees",
            "holdout",
            "pricing",
            "report",
            "schema_version",
            "standing"
        ]
    );
    assert_eq!(value["pricing"]["funding"], "STATED");
    assert_eq!(value["control"]["funding_stated"], true);
    assert!(value["report"]["fills"].is_array());
}

#[rstest]
#[case::side(vec![fill(2, "HOLD", "1", None)], BacktestRunReportDocumentErrorV1::FillUnreadable(0))]
#[case::price(vec![fill(2, "BUY", "a lot", None)], BacktestRunReportDocumentErrorV1::FillUnreadable(0))]
#[case::commission(vec![fill(2, "BUY", "1", Some("five"))], BacktestRunReportDocumentErrorV1::CommissionUnreadable(0))]
#[case::off_the_bars(vec![fill(99, "BUY", "1", None)], BacktestRunReportDocumentErrorV1::FillsNotRoundTrips(RoundTripsFromFillsErrorV1::FillNotAtABarOpen(0)))]
fn each_refusal_is_named(
    #[case] fills: Vec<OwnerBacktestFillV1>,
    #[case] refusal: BacktestRunReportDocumentErrorV1,
) {
    assert_eq!(assemble(&fills, None), Err(refusal));
}

#[rstest]
fn funding_for_another_number_of_bars_is_refused_by_the_control() {
    assert!(matches!(
        assemble(&fills(), Some(&[0.0; 3])),
        Err(BacktestRunReportDocumentErrorV1::ControlUnmeasurable(_))
    ));
}

#[rstest]
#[case("0.05", Some((5, 2)))]
#[case("-1.250", Some((-1250, 3)))]
#[case("7", Some((7, 0)))]
#[case("1e3", None)]
#[case(".5", None)]
fn commissions_read_as_exact_decimals(#[case] text: &str, #[case] expected: Option<(i128, u32)>) {
    assert_eq!(decimal(text), expected);
}

#[rstest]
#[case(625, 4, "0.0625")]
#[case(-5, 1, "-0.5")]
#[case(12, 0, "12")]
fn decimals_write_back_exactly(#[case] coefficient: i128, #[case] scale: u32, #[case] text: &str) {
    assert_eq!(decimal_text(coefficient, scale), text);
}
