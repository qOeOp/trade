use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

const GUEST_SOURCE: &str = "guest/pilot.rs";
const RUSTC_RELEASE: &str = "1.97.1";
const RUSTC_COMMIT: &str = "8bab26f4f68e0e26f0bb7960be334d5b520ea452";
const TARGET: &str = "wasm32v1-none";

fn main() {
    println!("cargo:rerun-if-changed={GUEST_SOURCE}");
    println!("cargo:rerun-if-env-changed=RUSTC");

    let rustc = env::var_os("RUSTC").unwrap_or_else(|| panic!("RUSTC is required"));
    let identity = command_output(Command::new(&rustc).args(["-Vv"]), "query rustc identity");
    let identity = String::from_utf8(identity.stdout)
        .unwrap_or_else(|error| panic!("rustc identity is not UTF-8: {error}"));
    require_identity(&identity);

    let target_libdir = command_output(
        Command::new(&rustc).args(["--print", "target-libdir", "--target", TARGET]),
        "query wasm32v1-none target",
    );
    let target_libdir = String::from_utf8(target_libdir.stdout)
        .unwrap_or_else(|error| panic!("target libdir is not UTF-8: {error}"));
    let target_libdir = PathBuf::from(target_libdir.trim());
    assert!(
        target_libdir.is_dir(),
        "required {TARGET} target is unavailable at {}",
        target_libdir.display()
    );

    let manifest_dir = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR")
            .unwrap_or_else(|| panic!("CARGO_MANIFEST_DIR is required")),
    );
    let out_dir =
        PathBuf::from(env::var_os("OUT_DIR").unwrap_or_else(|| panic!("OUT_DIR is required")));
    let source = manifest_dir.join(GUEST_SOURCE);
    let first = out_dir.join("strategy_factory_pilot.first.wasm");
    let second = out_dir.join("strategy_factory_pilot.second.wasm");

    compile_guest(&rustc, &source, &first);
    compile_guest(&rustc, &source, &second);

    let first_bytes = fs::read(&first)
        .unwrap_or_else(|error| panic!("read first frozen guest build failed: {error}"));
    let second_bytes = fs::read(&second)
        .unwrap_or_else(|error| panic!("read second frozen guest build failed: {error}"));
    assert_eq!(
        first_bytes, second_bytes,
        "frozen guest is not byte-identical across exact repeated builds"
    );

    println!("cargo:rustc-env=STRATEGY_FACTORY_GUEST_RUSTC_RELEASE={RUSTC_RELEASE}");
    println!("cargo:rustc-env=STRATEGY_FACTORY_GUEST_RUSTC_COMMIT={RUSTC_COMMIT}");
    println!("cargo:rustc-env=STRATEGY_FACTORY_GUEST_TARGET={TARGET}");
}

fn require_identity(identity: &str) {
    let release = identity
        .lines()
        .find_map(|line| line.strip_prefix("release: "));
    let commit = identity
        .lines()
        .find_map(|line| line.strip_prefix("commit-hash: "));
    assert!(
        release == Some(RUSTC_RELEASE) && commit == Some(RUSTC_COMMIT),
        "frozen guest requires rustc {RUSTC_RELEASE} ({RUSTC_COMMIT}), observed:\n{identity}"
    );
}

fn compile_guest(rustc: &std::ffi::OsStr, source: &Path, output: &Path) {
    let result = command_output(
        Command::new(rustc)
            .args([
                "--edition=2024",
                "--crate-name=strategy_factory_pilot_guest",
                "--crate-type=cdylib",
                "--target=wasm32v1-none",
                "-Dwarnings",
                "-Cpanic=abort",
                "-Copt-level=2",
                "-Cdebuginfo=0",
                "-Ccodegen-units=1",
                "-Clto=fat",
                "-Cstrip=symbols",
                "-Clink-arg=--no-entry",
                "-Clink-arg=--export=strategy_factory_decide_v1",
                "-Clink-arg=--initial-memory=65536",
                "-Clink-arg=--max-memory=65536",
                "-Clink-arg=--stack-first",
                "-Clink-arg=-z",
                "-Clink-arg=stack-size=0",
                "-Clink-arg=--global-base=0",
            ])
            .arg(source)
            .arg("-o")
            .arg(output),
        "compile frozen guest",
    );
    assert!(
        result.stderr.is_empty(),
        "exact frozen guest compile emitted stderr:\n{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

fn command_output(command: &mut Command, operation: &str) -> Output {
    let output = command
        .output()
        .unwrap_or_else(|error| panic!("{operation} failed to start: {error}"));
    assert!(
        output.status.success(),
        "{operation} failed with {}:\n{}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    output
}
