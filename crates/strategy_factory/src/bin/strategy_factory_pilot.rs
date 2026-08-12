use std::{env, path::PathBuf};

fn main() {
    let mut args = env::args_os().skip(1);
    let Some(data_root) = args.next().map(PathBuf::from) else {
        eprintln!("usage: strategy-factory-pilot <binance-vision-cache-root>");
        std::process::exit(2);
    };

    if args.next().is_some() {
        eprintln!("strategy-factory-pilot accepts exactly one cache-root argument");
        std::process::exit(2);
    }

    match vibe_strategy_factory::run_frozen_pilot(&data_root)
        .and_then(|run| vibe_strategy_factory::TrialReceipt::issue(&run))
    {
        Ok(receipt) => {
            if let Err(e) = receipt.write_to(std::io::stdout()) {
                eprintln!("{e:#}");
                std::process::exit(2);
            }
        }
        Err(e) => {
            eprintln!("{e:#}");
            std::process::exit(2);
        }
    }
}
