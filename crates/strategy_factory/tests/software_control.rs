use std::{fs, path::PathBuf, process::Command};

use rstest::rstest;
use vibe_strategy_factory::verify_representative_software_control;

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
    let second = tempfile::tempdir().unwrap();
    verify_representative_software_control(&raw, &first.path().join("catalog")).unwrap();
    verify_representative_software_control(&raw, &second.path().join("catalog")).unwrap();

    let cli = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_strategy-factory-formation"))
        .args(["software-control", raw.to_str().unwrap()])
        .arg(cli.path().join("catalog"))
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(
        output.stdout,
        b"CROSS_ASSET_SOFTWARE_CONTROL_NON_PIT_NON_ECONOMIC_OK\n"
    );
    assert!(output.stderr.is_empty());
}
