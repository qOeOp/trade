use std::process::ExitCode;

use vibe_qualification::run_owner_recovery_cli;

#[tokio::main]
async fn main() -> ExitCode {
    match run_owner_recovery_cli(std::env::args_os()).await {
        Ok(receipt) => match serde_json::to_string(&receipt) {
            Ok(json) => {
                println!("{json}");
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("Qualification Owner recovery receipt serialization failed: {e}");
                ExitCode::FAILURE
            }
        },
        Err(e) => {
            eprintln!("Qualification Owner recovery unavailable: {e}");
            ExitCode::FAILURE
        }
    }
}
