use vibe_backtest_owner::ConsumedComponentObservationV2;

fn main() {
    let _: ConsumedComponentObservationV2 = serde_json::from_str("{}").unwrap();
}
