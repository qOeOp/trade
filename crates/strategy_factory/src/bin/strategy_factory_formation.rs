use std::{env, ffi::OsString, io::Write, path::PathBuf};

const USAGE: &str = "usage:\n  strategy-factory-formation formation <binance-vision-cache-root> <attestation-bundle>\n  strategy-factory-formation project-materialize <parent-directory>\n  strategy-factory-formation project-proposal <project-manifest>\n  strategy-factory-formation status <binance-vision-cache-root> <attestation-bundle> <formation-receipt>\n  strategy-factory-formation representative-formation <binance-raw-root> <alfred-root> <schedule-root> <new-derived-catalog-root> <attestation-bundle>\n  strategy-factory-formation representative-status <binance-raw-root> <alfred-root> <schedule-root> <fresh-derived-catalog-root> <attestation-bundle> <formation-receipt>\n  strategy-factory-formation dual-tsmom-formation <binance-raw-root> <alfred-root> <schedule-root> <new-derived-catalog-root> <attestation-bundle>\n  strategy-factory-formation dual-tsmom-status <binance-raw-root> <alfred-root> <schedule-root> <fresh-derived-catalog-root> <attestation-bundle> <formation-receipt>\n  strategy-factory-formation pairs-formation <binance-raw-root> <alfred-root> <schedule-root> <new-derived-catalog-root> <attestation-bundle>\n  strategy-factory-formation pairs-status <binance-raw-root> <alfred-root> <schedule-root> <fresh-derived-catalog-root> <attestation-bundle> <formation-receipt>\n  strategy-factory-formation secac-status <binance-raw-root> <alfred-root> <schedule-root> <fresh-derived-catalog-root> <attestation-bundle> <v37-predecessor-receipt> <2024-source-root> <custody-root> <formation-receipt>\n  strategy-factory-formation representative-holdout-status <2024-source-root> <custody-root>";

fn main() {
    let mut args = env::args_os().skip(1);
    let Some(command) = args.next() else {
        eprintln!("{USAGE}");
        std::process::exit(2);
    };
    let remaining = args.collect::<Vec<_>>();

    let result = match command.to_str() {
        Some("formation") => formation(&remaining),
        Some("project-materialize") => project_materialize(&remaining),
        Some("project-proposal") => project_proposal(&remaining),
        Some("status") => status(&remaining),
        Some("representative-formation") => representative_formation(&remaining),
        Some("representative-status") => representative_status(&remaining),
        Some("dual-tsmom-formation") => dual_tsmom_formation(&remaining),
        Some("dual-tsmom-status") => dual_tsmom_status(&remaining),
        Some("pairs-formation") => pairs_formation(&remaining),
        Some("pairs-status") => pairs_status(&remaining),
        Some("secac-status") => secac_status(&remaining),
        Some("representative-holdout-status") => representative_holdout_status(&remaining),
        Some(other) => Err(anyhow::anyhow!("unknown command {other}\n{USAGE}")),
        None => Err(anyhow::anyhow!("command is not valid UTF-8\n{USAGE}")),
    };

    if let Err(e) = result {
        eprintln!("{e:#}");
        std::process::exit(2);
    }
}

fn project_materialize(args: &[OsString]) -> anyhow::Result<()> {
    anyhow::ensure!(
        args.len() == 1,
        "project-materialize requires one parent directory\n{USAGE}"
    );
    let manifest =
        vibe_strategy_factory::materialize_strategy_project_scaffold(&PathBuf::from(&args[0]))?;
    println!("{}", manifest.display());
    Ok(())
}

fn project_proposal(args: &[OsString]) -> anyhow::Result<()> {
    anyhow::ensure!(
        args.len() == 1,
        "project-proposal requires one project manifest\n{USAGE}"
    );
    let proposal = vibe_strategy_factory::seal_strategy_project_proposal(&PathBuf::from(&args[0]))?;
    std::io::stdout().write_all(&proposal.artifact().identity().to_bytes()?)?;
    Ok(())
}

fn representative_formation(args: &[OsString]) -> anyhow::Result<()> {
    anyhow::ensure!(
        args.len() == 5,
        "representative-formation requires exactly five arguments\n{USAGE}"
    );
    let producer = vibe_strategy_factory::NativeProducerVerificationRequest::from_bundle(&args[4]);
    let receipt = vibe_strategy_factory::run_frozen_representative_formation(
        &PathBuf::from(&args[0]),
        &PathBuf::from(&args[1]),
        &PathBuf::from(&args[2]),
        &PathBuf::from(&args[3]),
        producer,
    )?;
    write_formation_receipt(&receipt)
}

fn representative_status(args: &[OsString]) -> anyhow::Result<()> {
    anyhow::ensure!(
        args.len() == 6,
        "representative-status requires exactly six arguments\n{USAGE}"
    );
    let producer = vibe_strategy_factory::NativeProducerVerificationRequest::from_bundle(&args[4]);
    let status = vibe_strategy_factory::recover_frozen_representative_formation_status(
        &PathBuf::from(&args[0]),
        &PathBuf::from(&args[1]),
        &PathBuf::from(&args[2]),
        &PathBuf::from(&args[3]),
        producer,
        &PathBuf::from(&args[5]),
    )?;
    status.write_to(std::io::stdout())
}

fn dual_tsmom_formation(args: &[OsString]) -> anyhow::Result<()> {
    anyhow::ensure!(
        args.len() == 5,
        "dual-tsmom-formation requires exactly five arguments\n{USAGE}"
    );
    let producer = vibe_strategy_factory::NativeProducerVerificationRequest::from_bundle(&args[4]);
    let receipt = vibe_strategy_factory::run_frozen_dual_tsmom_formation(
        vibe_strategy_factory::RepresentativeSourceRoots::new(
            &PathBuf::from(&args[0]),
            &PathBuf::from(&args[1]),
            &PathBuf::from(&args[2]),
            &PathBuf::from(&args[3]),
        ),
        producer,
    )?;
    write_formation_receipt(&receipt)
}

fn dual_tsmom_status(args: &[OsString]) -> anyhow::Result<()> {
    anyhow::ensure!(
        args.len() == 6,
        "dual-tsmom-status requires exactly six arguments\n{USAGE}"
    );
    let producer = vibe_strategy_factory::NativeProducerVerificationRequest::from_bundle(&args[4]);
    vibe_strategy_factory::recover_frozen_dual_tsmom_formation_status(
        vibe_strategy_factory::RepresentativeSourceRoots::new(
            &PathBuf::from(&args[0]),
            &PathBuf::from(&args[1]),
            &PathBuf::from(&args[2]),
            &PathBuf::from(&args[3]),
        ),
        producer,
        &PathBuf::from(&args[5]),
    )?
    .write_to(std::io::stdout())
}

fn pairs_formation(args: &[OsString]) -> anyhow::Result<()> {
    anyhow::ensure!(
        args.len() == 5,
        "pairs-formation requires exactly five arguments\n{USAGE}"
    );
    let producer = vibe_strategy_factory::NativeProducerVerificationRequest::from_bundle(&args[4]);
    let receipt = vibe_strategy_factory::run_frozen_pairs_relative_value_formation(
        vibe_strategy_factory::RepresentativeSourceRoots::new(
            &PathBuf::from(&args[0]),
            &PathBuf::from(&args[1]),
            &PathBuf::from(&args[2]),
            &PathBuf::from(&args[3]),
        ),
        producer,
    )?;
    write_formation_receipt(&receipt)
}

fn pairs_status(args: &[OsString]) -> anyhow::Result<()> {
    anyhow::ensure!(
        args.len() == 6,
        "pairs-status requires exactly six arguments\n{USAGE}"
    );
    let producer = vibe_strategy_factory::NativeProducerVerificationRequest::from_bundle(&args[4]);
    vibe_strategy_factory::recover_frozen_pairs_relative_value_formation_status(
        vibe_strategy_factory::RepresentativeSourceRoots::new(
            &PathBuf::from(&args[0]),
            &PathBuf::from(&args[1]),
            &PathBuf::from(&args[2]),
            &PathBuf::from(&args[3]),
        ),
        producer,
        &PathBuf::from(&args[5]),
    )?
    .write_to(std::io::stdout())
}

fn secac_status(args: &[OsString]) -> anyhow::Result<()> {
    anyhow::ensure!(
        args.len() == 9,
        "secac-status requires exactly nine arguments\n{USAGE}"
    );
    let producer = vibe_strategy_factory::NativeProducerVerificationRequest::from_bundle(&args[4]);
    let status = vibe_strategy_factory::recover_frozen_secac_formation_status(
        vibe_strategy_factory::RepresentativeSourceRoots::new(
            &PathBuf::from(&args[0]),
            &PathBuf::from(&args[1]),
            &PathBuf::from(&args[2]),
            &PathBuf::from(&args[3]),
        ),
        producer,
        &PathBuf::from(&args[5]),
        &PathBuf::from(&args[6]),
        &PathBuf::from(&args[7]),
        &PathBuf::from(&args[8]),
    )?;
    status.write_to(std::io::stdout())
}

fn representative_holdout_status(args: &[OsString]) -> anyhow::Result<()> {
    anyhow::ensure!(
        args.len() == 2,
        "representative-holdout-status requires exactly two arguments\n{USAGE}"
    );
    vibe_strategy_factory::recover_representative_2024_holdout_status(
        &PathBuf::from(&args[0]),
        &PathBuf::from(&args[1]),
    )?
    .write_to(std::io::stdout())
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
    write_formation_receipt(&receipt)
}

fn write_formation_receipt(
    receipt: &vibe_strategy_factory::FormationFamilyReceipt,
) -> anyhow::Result<()> {
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
