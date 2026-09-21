//! One real Backtest round trip, run rather than remembered.
//!
//! The protected gate used to derive its measurement from canonical bytes frozen into the tree by
//! the pull request that first produced them. Frozen bytes cannot notice that the engine changed,
//! so the number they support is a record of one past run rather than a statement about this one.
//! This module runs the round trip instead, and the gate derives from what it reports.
//!
//! THE QUOTE SERIES BELOW IS CONSTRUCTED, NOT MARKET DATA. Its shape was chosen so a 10/20 EMA
//! crossing happens at all; its prices were not chosen to reach any particular result, and no
//! assertion anywhere fixes what the run must earn. The number this module produces is a fact
//! about the engine, the simulated venue and the portfolio running together. It is not a fact
//! about any market, and it must never be quoted as one.
//!
//! The frozen bytes it replaces were the same kind of corpus, written down once. What changes is
//! that the engine can now move the number, and nothing before this could.

use vibe_backtest::{
    config::{BacktestEngineConfig, SimulatedVenueConfig},
    engine::BacktestEngine,
    result::CanonicalBacktestResult,
};
use vibe_model::{
    data::{Data, QuoteTick},
    enums::{AccountType, BookType, OmsType},
    identifiers::{InstrumentId, Symbol, Venue},
    instruments::{CryptoPerpetual, InstrumentAny},
    types::{Currency, Money, Price, Quantity},
};
use vibe_trading::examples::strategies::EmaCross;

const RUN_CONFIG_ID: &str = "protected-economic-round-trip-v1";
const INSTRUMENT: &str = "BTCUSDT-PERP.SIM";
const VENUE: &str = "SIM";
const FAST_PERIOD: usize = 2;
const SLOW_PERIOD: usize = 3;
const TRADE_SIZE: &str = "1";

/// Quotes held flat long enough for both averages to initialize on the same value.
///
/// Short, because the coverage rule divides the position's span by the run window: a long warmup
/// would push the position's open away from the window start and cost coverage the measurement
/// would then refuse. Shaping the corpus so the position spans the run is what makes it a valid
/// measurement subject at all; it fixes nothing about what the run earns.
const WARMUP_QUOTES: u64 = 3;
/// Quotes that rise, which carries the fast average above the slow one and holds it there.
const RISING_QUOTES: u64 = 194;
/// Quotes that fall sharply at the very end, which carries it back under and closes the position.
const FALLING_QUOTES: u64 = 3;

const BASE_PRICE: f64 = 100.0;
const RISING_STEP: f64 = 0.01;
const FALLING_STEP: f64 = 2.0;

fn instrument() -> InstrumentAny {
    InstrumentAny::CryptoPerpetual(CryptoPerpetual::new(
        InstrumentId::from(INSTRUMENT),
        Symbol::from("BTCUSDT-PERP"),
        Currency::BTC(),
        Currency::USD(),
        Currency::USD(),
        false,
        2,
        0,
        Price::from("0.01"),
        Quantity::from("1"),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        0.into(),
        0.into(),
    ))
}

/// Which constructed quote series to feed the strategy.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProtectedRoundTripCorpusV1 {
    /// Flat, then rising, then falling: the fast average crosses above and then back below, so the
    /// strategy opens a position and closes it.
    Crossing,
    /// Flat throughout: the two averages never separate, so the strategy never trades. This exists
    /// to drive the measurement's `NoObservedPosition` refusal, which nothing else drives.
    Flat,
}

/// Returns the constructed quote series for `corpus`.
///
/// These are not market observations. The ramp exists so the crossing happens; the prices are
/// arbitrary and no caller asserts what the run earns from them.
fn quotes(instrument_id: InstrumentId, corpus: ProtectedRoundTripCorpusV1) -> Vec<Data> {
    let mut quotes = Vec::new();
    let mut price = BASE_PRICE;

    for ordinal in 0..(WARMUP_QUOTES + RISING_QUOTES + FALLING_QUOTES) {
        if corpus == ProtectedRoundTripCorpusV1::Flat {
            // Leave `price` alone: the averages stay equal and the strategy never crosses.
        } else if (WARMUP_QUOTES..WARMUP_QUOTES + RISING_QUOTES).contains(&ordinal) {
            price += RISING_STEP;
        } else if ordinal >= WARMUP_QUOTES + RISING_QUOTES {
            price -= FALLING_STEP;
        }

        // One tick of spread, so a market order crosses it and pays for the crossing.
        let ts = (ordinal + 1) * 1_000_000_000;
        quotes.push(Data::Quote(QuoteTick::new(
            instrument_id,
            Price::new(price - 0.01, 2),
            Price::new(price + 0.01, 2),
            Quantity::from("100"),
            Quantity::from("100"),
            ts.into(),
            ts.into(),
        )));
    }

    quotes
}

/// Runs the protected round trip on the crossing corpus and returns its canonical result.
///
/// # Errors
///
/// Returns an error if the engine cannot be configured, the run fails, or the run opened no
/// position. A run that traded nothing supports no measurement, so it fails here rather than
/// reaching the gate as a zero.
pub(crate) fn run_protected_economic_round_trip_v1() -> anyhow::Result<CanonicalBacktestResult> {
    let canonical = run_round_trip_v1(ProtectedRoundTripCorpusV1::Crossing)?;
    let positions = canonical
        .as_value()
        .get("positions")
        .and_then(serde_json::Value::as_array)
        .map_or(0, Vec::len);
    anyhow::ensure!(
        positions >= 1,
        "the protected round trip opened no position, so it supports no economic measurement"
    );
    Ok(canonical)
}

/// Runs one round trip on `corpus` and returns exactly what it produced.
///
/// # Errors
///
/// Returns an error if the engine cannot be configured or the run fails. It does not judge what
/// the run traded: the flat corpus is meant to trade nothing.
fn run_round_trip_v1(
    corpus: ProtectedRoundTripCorpusV1,
) -> anyhow::Result<CanonicalBacktestResult> {
    let instrument = instrument();
    let instrument_id = InstrumentId::from(INSTRUMENT);
    let mut engine = BacktestEngine::new(BacktestEngineConfig {
        bypass_logging: true,
        run_analysis: false,
        ..Default::default()
    })?;
    engine.add_venue(
        SimulatedVenueConfig::builder()
            .venue(Venue::from(VENUE))
            .oms_type(OmsType::Netting)
            .account_type(AccountType::Margin)
            .book_type(BookType::L1_MBP)
            .starting_balances(vec![Money::from("1_000_000 USD")])
            .bar_execution(false)
            .use_random_ids(false)
            .build()?,
    )?;
    engine.add_instrument(&instrument)?;
    engine.add_strategy(EmaCross::new(
        instrument_id,
        Quantity::from(TRADE_SIZE),
        FAST_PERIOD,
        SLOW_PERIOD,
    ))?;
    engine.add_data(quotes(instrument_id, corpus), None, true, true)?;
    engine.run(None, None, Some(RUN_CONFIG_ID.to_owned()), false)?;
    engine.get_canonical_result()
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use vibe_backtest_owner_contracts::{
        OpaqueIdentityV2,
        protected_economic_metric::{
            ProtectedEconomicComputationV1, ProtectedEconomicCoverageRuleV1,
            ProtectedEconomicMetricV1,
        },
    };

    use super::*;
    use crate::protected_economic_measurement::{
        ProtectedEconomicMeasurementBindingsV1, ProtectedEconomicMeasurementFaultV1,
        derive_protected_economic_measurement_v1,
    };

    fn computation() -> ProtectedEconomicComputationV1 {
        ProtectedEconomicComputationV1 {
            metric: ProtectedEconomicMetricV1::NetReturnBasisPoints,
            coverage_rule: ProtectedEconomicCoverageRuleV1::ObservedWindowSpan,
        }
    }

    fn bindings() -> ProtectedEconomicMeasurementBindingsV1 {
        ProtectedEconomicMeasurementBindingsV1 {
            request_identity: "protected-round-trip-request-1".to_owned(),
            request_digest: format!("sha256:{}", "1".repeat(64)),
            attempt_identity: "protected-round-trip-attempt-1".to_owned(),
            protected_plan_identity: "protected-round-trip-plan-1".to_owned(),
            protected_plan_digest: format!("sha256:{}", "2".repeat(64)),
            plan_cell_set_identity: "protected-round-trip-cell-set-1".to_owned(),
            plan_cell_set_digest: format!("sha256:{}", "3".repeat(64)),
            plan_cell_identity: "protected-round-trip-cell-1".to_owned(),
            plan_cell_digest: format!("sha256:{}", "4".repeat(64)),
            result_time_evidence_digest: format!("sha256:{}", "5".repeat(64)),
            evidence_owner: OpaqueIdentityV2::try_from("backtest-owner".to_owned()).unwrap(),
            evidence_reference: OpaqueIdentityV2::try_from(
                "protected-round-trip-canonical-result-1".to_owned(),
            )
            .unwrap(),
        }
    }

    #[rstest]
    fn test_the_round_trip_trades_and_reports_what_it_earned() {
        let canonical = run_protected_economic_round_trip_v1().unwrap();
        let document = canonical.as_value();

        let fills = document["fills"].as_array().unwrap();
        assert!(!fills.is_empty(), "the round trip filled nothing");

        // The measurement's own preconditions, asserted where the corpus is produced rather than
        // where it is consumed, so a corpus that drifts out of shape fails here first.
        assert_eq!(document["accounts"].as_array().unwrap().len(), 1);
        assert_eq!(document["run"]["outcome"], "completed");
    }

    #[rstest]
    fn test_the_measurement_accepts_this_round_s_own_bytes() {
        let canonical = run_protected_economic_round_trip_v1().unwrap();
        let sealed = derive_protected_economic_measurement_v1(
            &canonical.to_bytes().unwrap(),
            computation(),
            &bindings(),
        )
        .expect("a real round trip's own bytes support the frozen computation");

        // What the run earned is printed, never asserted. Any threshold here would be a threshold
        // this corpus was chosen to clear, and the gate's own economic floor lives in the chain.
        println!(
            "protected round trip: observed_raw={} unit={} scale={} coverage_bps={}",
            sealed.measurement().observed_raw,
            sealed.measurement().unit,
            sealed.measurement().decimal_scale,
            sealed.measurement().observed_coverage_bps,
        );
    }

    #[rstest]
    fn test_a_run_that_never_crossed_is_refused_rather_than_measured_as_zero() {
        // The negative control. Without it the pair above only shows that this corpus passes, not
        // that the measurement can tell the two corpora apart, and `NoObservedPosition` would stay
        // a refusal nothing ever drove.
        let canonical = run_round_trip_v1(ProtectedRoundTripCorpusV1::Flat).unwrap();
        let document = canonical.as_value();
        assert!(document["fills"].as_array().unwrap().is_empty());
        assert!(document["positions"].as_array().unwrap().is_empty());

        let fault = derive_protected_economic_measurement_v1(
            &canonical.to_bytes().unwrap(),
            computation(),
            &bindings(),
        )
        .expect_err("a run that opened no position cannot support a measurement");

        assert!(
            matches!(
                fault,
                ProtectedEconomicMeasurementFaultV1::NoObservedPosition
            ),
            "expected NoObservedPosition, found {fault}"
        );
    }
}
