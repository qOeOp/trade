use std::env;

use vibe_deribit::{
    common::enums::{DeribitEnvironment, DeribitProductType},
    http::{
        client::DeribitHttpClient, models::DeribitCurrency, query::GetLastTradesByCurrencyParams,
    },
};
use vibe_model::identifiers::InstrumentId;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    vibe_common::logging::ensure_logging_initialized();

    let args: Vec<String> = env::args().collect();
    let environment = if args.iter().any(|a| a == "--testnet") {
        DeribitEnvironment::Testnet
    } else {
        DeribitEnvironment::Mainnet
    };

    // Create HTTP client
    let client = DeribitHttpClient::new(None, environment, 10, 3, 1000, 10_000, None)?;

    // Fetch BTC-PERPETUAL instrument
    log::info!("Fetching BTC-PERPETUAL instrument...");
    let instrument_id = InstrumentId::from("BTC-PERPETUAL.DERIBIT");
    let instrument = client.request_instrument(instrument_id).await?;
    println!("Single instrument:");
    println!("{instrument:?}\n");

    // Fetch BTC instruments
    log::info!("Fetching BTC instruments...");
    let instruments = client
        .request_instruments(DeribitCurrency::BTC, None)
        .await?;
    println!("First 2 instruments from BTC:");
    for (i, inst) in instruments.iter().take(2).enumerate() {
        let num = i + 1;
        println!("{num}. {inst:?}");
    }

    if args.iter().any(|a| a == "--combos") {
        log::info!("Fetching BTC future_combo instruments...");
        let future_combos = client
            .request_instruments(DeribitCurrency::BTC, Some(DeribitProductType::FutureCombo))
            .await?;
        println!("BTC future_combo count: {}", future_combos.len());
        for inst in future_combos.iter().take(3) {
            println!("  {inst:?}");
        }

        log::info!("Fetching BTC option_combo instruments...");
        let option_combos = client
            .request_instruments(DeribitCurrency::BTC, Some(DeribitProductType::OptionCombo))
            .await?;
        println!("BTC option_combo count: {}", option_combos.len());
        for inst in option_combos.iter().take(3) {
            println!("  {inst:?}");
        }

        log::info!("Fetching last BTC future_combo trades...");
        let params = GetLastTradesByCurrencyParams::builder()
            .currency(DeribitCurrency::BTC)
            .kind(DeribitProductType::FutureCombo)
            .count(3_u32)
            .include_old(true)
            .build()
            .expect("Failed to build trades params");
        let trades_resp = client.inner().get_last_trades_by_currency(params).await?;
        if let Some(result) = trades_resp.result {
            println!("Combo trades returned: {}", result.trades.len());
            for trade in result.trades.iter().take(2) {
                let leg_count = trade.legs.as_ref().map_or(0, Vec::len);
                println!(
                    "  trade_id={} combo={} price={} amount={} legs={}",
                    trade.trade_id, trade.instrument_name, trade.price, trade.amount, leg_count,
                );

                if let Some(legs) = &trade.legs {
                    for leg in legs {
                        println!(
                            "    leg: instrument={} trade_id={} combo_trade_id={} dir={} px={} qty={}",
                            leg.instrument_name,
                            leg.trade_id,
                            leg.combo_trade_id,
                            leg.direction,
                            leg.price,
                            leg.amount,
                        );
                    }
                }
            }
        }
    }

    Ok(())
}
