use std::{fs, path::PathBuf, process::Command};

use rstest::rstest;
use vibe_strategy_factory::{
    recover_representative_program_control, run_representative_program_control,
    verify_representative_software_control,
};

#[rstest]
fn derived_catalog_must_be_a_new_target() {
    let root = tempfile::tempdir().unwrap();
    let derived = root.path().join("derived");
    fs::create_dir(&derived).unwrap();
    let error =
        verify_representative_software_control(&root.path().join("absent"), &derived).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("derived catalog target must be new")
    );
}
#[rstest]
fn unavailable_raw_source_does_not_create_derived_target() {
    let root = tempfile::tempdir().unwrap();
    let derived = root.path().join("derived");
    assert!(verify_representative_software_control(&root.path().join("absent"), &derived).is_err());
    assert!(!derived.exists());
}

#[rstest]
fn incomplete_existing_raw_source_does_not_create_derived_target() {
    let root = tempfile::tempdir().unwrap();
    let raw = root.path().join("raw");
    let derived = root.path().join("derived");
    fs::create_dir(&raw).unwrap();
    assert!(verify_representative_software_control(&raw, &derived).is_err());
    assert!(!derived.exists());
}

#[rstest]
fn unavailable_representative_inputs_do_not_create_derived_target() {
    let root = tempfile::tempdir().unwrap();
    let derived = root.path().join("derived");
    assert!(
        run_representative_program_control(
            &root.path().join("missing-market"),
            &root.path().join("missing-alfred"),
            &root.path().join("missing-schedule"),
            &derived,
        )
        .is_err()
    );
    assert!(!derived.exists());
}

#[rstest]
fn representative_cli_rejects_producer_before_any_data_effect() {
    let root = tempfile::tempdir().unwrap();
    let derived = root.path().join("derived");
    let market = root.path().join("missing-market");
    let alfred = root.path().join("missing-alfred");
    let schedule = root.path().join("missing-schedule");
    let bundle = root.path().join("missing-bundle");
    let output = Command::new(env!("CARGO_BIN_EXE_strategy-factory-formation"))
        .arg("representative-formation")
        .arg(market)
        .arg(alfred)
        .arg(schedule)
        .arg(&derived)
        .arg(bundle)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(!derived.exists());
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(receipt["body"]["trials"].as_array().unwrap().len(), 40);
    assert_eq!(receipt["body"]["family_disposition"], "SOFTWARE_REJECTED");
}

#[rstest]
fn dual_tsmom_cli_rejects_producer_before_any_data_effect() {
    let root = tempfile::tempdir().unwrap();
    let derived = root.path().join("derived");
    let output = Command::new(env!("CARGO_BIN_EXE_strategy-factory-formation"))
        .arg("dual-tsmom-formation")
        .arg(root.path().join("missing-market"))
        .arg(root.path().join("missing-alfred"))
        .arg(root.path().join("missing-schedule"))
        .arg(&derived)
        .arg(root.path().join("missing-bundle"))
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(!derived.exists());
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(receipt["body"]["trials"].as_array().unwrap().len(), 5);
    assert_eq!(receipt["body"]["family_disposition"], "SOFTWARE_REJECTED");
}

#[rstest]
fn dual_tsmom_status_cli_rejects_producer_before_receipt_or_data_access() {
    let root = tempfile::tempdir().unwrap();
    let derived = root.path().join("derived");
    let output = Command::new(env!("CARGO_BIN_EXE_strategy-factory-formation"))
        .arg("dual-tsmom-status")
        .arg(root.path().join("missing-market"))
        .arg(root.path().join("missing-alfred"))
        .arg(root.path().join("missing-schedule"))
        .arg(&derived)
        .arg(root.path().join("missing-bundle"))
        .arg(root.path().join("missing-receipt"))
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(!derived.exists());
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("requires a verified native producer")
    );
}

#[cfg(unix)]
#[rstest]
fn symlinked_raw_source_does_not_create_derived_target() {
    let root = tempfile::tempdir().unwrap();
    let real = root.path().join("real");
    let raw = root.path().join("raw");
    let derived = root.path().join("derived");
    fs::create_dir(&real).unwrap();
    std::os::unix::fs::symlink(&real, &raw).unwrap();
    assert!(verify_representative_software_control(&raw, &derived).is_err());
    assert!(!derived.exists());
}

#[rstest]
fn derived_target_cannot_overlap_raw_custody() {
    let raw = tempfile::tempdir().unwrap();
    let derived = raw.path().join("derived");
    let error = verify_representative_software_control(raw.path(), &derived).unwrap_err();
    assert!(
        error.to_string().contains("custody must be disjoint"),
        "{error:#}"
    );
    assert!(!derived.exists());
}

#[cfg(unix)]
#[rstest]
fn derived_parent_cannot_be_a_symlink() {
    let root = tempfile::tempdir().unwrap();
    let raw = root.path().join("raw");
    let real = root.path().join("real");
    fs::create_dir(&raw).unwrap();
    fs::create_dir(&real).unwrap();
    std::os::unix::fs::symlink(&real, root.path().join("alias")).unwrap();
    let derived = root.path().join("alias/derived");
    let error = verify_representative_software_control(&raw, &derived).unwrap_err();
    assert!(error.to_string().contains("must be a real directory"));
    assert!(!real.join("derived").exists());
}

#[rstest]
#[ignore = "requires the separately downloaded frozen 2023 USD-M and PAXG Spot datasets"]
fn actual_dataset_recovers_into_fresh_derived_catalogs() {
    let raw = PathBuf::from(std::env::var("STRATEGY_FACTORY_REPRESENTATIVE_DATASET_ROOT").unwrap());
    let first = tempfile::tempdir().unwrap();
    verify_representative_software_control(&raw, &first.path().join("catalog")).unwrap();

    let second = tempfile::tempdir().unwrap();
    verify_representative_software_control(&raw, &second.path().join("catalog")).unwrap();
}

#[rstest]
#[ignore = "requires frozen Binance, five-series ALFRED, and scheduled-event evidence"]
fn actual_representative_program_control_recovers_exact_receipt() {
    let raw = PathBuf::from(std::env::var("STRATEGY_FACTORY_REPRESENTATIVE_DATASET_ROOT").unwrap());
    let alfred = PathBuf::from(std::env::var("VIBE_FRED_FIVE_SERIES_DATASET_ROOT").unwrap());
    let schedule = PathBuf::from(std::env::var("VIBE_SCHEDULED_EVENTS_OFFICIAL_CACHE").unwrap());
    let first = tempfile::tempdir().unwrap();
    let receipt =
        run_representative_program_control(&raw, &alfred, &schedule, &first.path().join("catalog"))
            .unwrap();
    let bytes = receipt.to_bytes().unwrap();

    let second = tempfile::tempdir().unwrap();
    let recovered = recover_representative_program_control(
        &bytes,
        &raw,
        &alfred,
        &schedule,
        &second.path().join("catalog"),
    )
    .unwrap();
    assert_eq!(recovered.receipt_digest(), receipt.receipt_digest());

    let mut tampered = bytes;
    let index = tampered.len() / 2;
    tampered[index] ^= 1;
    let third = tempfile::tempdir().unwrap();
    assert!(
        recover_representative_program_control(
            &tampered,
            &raw,
            &alfred,
            &schedule,
            &third.path().join("catalog"),
        )
        .is_err()
    );
}
