use std::{env, ffi::OsString, path::PathBuf};

const USAGE: &str = "usage:\n  strategy-factory-formation formation <binance-vision-cache-root> <attestation-bundle>\n  strategy-factory-formation status <binance-vision-cache-root> <attestation-bundle> <formation-receipt>\n  strategy-factory-formation qualification <binance-vision-cache-root> <attestation-bundle> <formation-receipt>\n  strategy-factory-formation qualification-status <binance-vision-cache-root> <attestation-bundle> <formation-receipt> <qualification-receipt>\n  strategy-factory-formation software-control <binance-raw-root> <new-derived-catalog-root>";

fn main() {
    let mut args = env::args_os().skip(1);
    let Some(command) = args.next() else {
        eprintln!("{USAGE}");
        std::process::exit(2);
    };
    let remaining = args.collect::<Vec<_>>();

    let result = match command.to_str() {
        Some("formation") => formation(&remaining),
        Some("status") => status(&remaining),
        Some("qualification") => qualification(&remaining),
        Some("qualification-status") => qualification_status(&remaining),
        Some("software-control") => software_control(&remaining),
        Some(other) => Err(anyhow::anyhow!("unknown command {other}\n{USAGE}")),
        None => Err(anyhow::anyhow!("command is not valid UTF-8\n{USAGE}")),
    };

    if let Err(e) = result {
        eprintln!("{e:#}");
        std::process::exit(2);
    }
}

fn software_control(args: &[OsString]) -> anyhow::Result<()> {
    anyhow::ensure!(
        args.len() == 2,
        "software-control requires exactly two arguments\n{USAGE}"
    );
    vibe_strategy_factory::verify_representative_software_control(
        &PathBuf::from(&args[0]),
        &PathBuf::from(&args[1]),
    )?;
    println!("CROSS_ASSET_SOFTWARE_CONTROL_NON_PIT_NON_ECONOMIC_OK");
    Ok(())
}

fn formation(args: &[OsString]) -> anyhow::Result<()> {
    anyhow::ensure!(
        args.len() == 2,
        "formation requires exactly two arguments\n{USAGE}"
    );
    let data_root = PathBuf::from(&args[0]);
    let bundle_path = PathBuf::from(&args[1]);

    let producer_request =
        vibe_strategy_factory::NativeProducerVerificationRequest::from_bundle(bundle_path);
    let receipt =
        vibe_strategy_factory::run_frozen_complex_formation(&data_root, producer_request)?;
    let software_rejected = matches!(
        receipt.disposition(),
        vibe_strategy_factory::FormationFamilyDisposition::SoftwareRejected
    );
    receipt.write_to(std::io::stdout())?;
    anyhow::ensure!(
        !software_rejected,
        "formation family was software-rejected; receipt emitted to stdout"
    );
    Ok(())
}

fn status(args: &[OsString]) -> anyhow::Result<()> {
    anyhow::ensure!(
        args.len() == 3,
        "status requires exactly three arguments\n{USAGE}"
    );
    let data_root = PathBuf::from(&args[0]);
    let bundle_path = PathBuf::from(&args[1]);
    let receipt_path = PathBuf::from(&args[2]);
    let producer_request =
        vibe_strategy_factory::NativeProducerVerificationRequest::from_bundle(bundle_path);
    let status = vibe_strategy_factory::recover_frozen_complex_formation_status(
        &data_root,
        producer_request,
        &receipt_path,
    )?;
    status.write_to(std::io::stdout())?;
    Ok(())
}

fn qualification(args: &[OsString]) -> anyhow::Result<()> {
    anyhow::ensure!(
        args.len() == 3,
        "qualification requires exactly three arguments\n{USAGE}"
    );
    let producer_request = vibe_strategy_factory::NativeProducerVerificationRequest::from_bundle(
        PathBuf::from(&args[1]),
    );
    let receipt = vibe_strategy_factory::run_frozen_complex_qualification(
        &PathBuf::from(&args[0]),
        producer_request,
        &PathBuf::from(&args[2]),
    )?;
    receipt.write_to(std::io::stdout())?;
    Ok(())
}

fn qualification_status(args: &[OsString]) -> anyhow::Result<()> {
    anyhow::ensure!(
        args.len() == 4,
        "qualification-status requires exactly four arguments\n{USAGE}"
    );
    let producer_request = vibe_strategy_factory::NativeProducerVerificationRequest::from_bundle(
        PathBuf::from(&args[1]),
    );
    let status = vibe_strategy_factory::recover_frozen_complex_qualification_status(
        &PathBuf::from(&args[0]),
        producer_request,
        &PathBuf::from(&args[2]),
        &PathBuf::from(&args[3]),
    )?;
    status.write_to(std::io::stdout())?;
    Ok(())
}
