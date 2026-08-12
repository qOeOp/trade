fn main() {
    match vibe_strategy_factory::run_frozen_pilot() {
        Ok(never) => match never {},
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    }
}
