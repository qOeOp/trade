//! Builds a lowered Bounded Feature Program guest the way a production build of one is run, for
//! the tests that need the real module rather than its source.

use std::{fs, path::Path, process::Command};

use crate::{
    bounded_feature_program_lowerer_v1::prepare_frozen_bounded_feature_source_inputs_v1,
    rd_bounded_feature_program_v1::FrozenResearchBoundedFeatureProgramV1,
    strategy_design_v2::{PluginManifestV2, StrategyDesignV2},
};

/// Every Cargo key that outranks, or replaces, the `[build] rustflags` the lowering freezes
/// into a guest project's own `.cargo/config.toml`.
///
/// Cargo does not merge rustflags across levels. The first of `RUSTFLAGS`,
/// `CARGO_ENCODED_RUSTFLAGS`, `target.<triple>.rustflags` and `build.rustflags` that is
/// present wins outright, and an environment variable beats the configuration file that
/// carries the same key. So any one of these silently discards the whole frozen list,
/// including the `--initial-memory`/`--max-memory` pair `frozen_config` sizes from the
/// manifest.
pub(crate) const AMBIENT_RUST_FLAG_VARS: [&str; 4] = [
    "RUSTFLAGS",
    "CARGO_ENCODED_RUSTFLAGS",
    "CARGO_BUILD_RUSTFLAGS",
    "CARGO_TARGET_WASM32V1_NONE_RUSTFLAGS",
];

/// Build a lowered guest project the way a production build of one is run.
///
/// `develop_plugin_build_v2_sandbox` invokes Cargo under `env_clear`, so the only rustflags a
/// guest compiles under in production are the ones the lowering froze into the project's
/// `.cargo/config.toml`. A proof that inherited its own environment did not stand for that
/// build: `actions-rust-lang/setup-rust-toolchain` exports `RUSTFLAGS=-D warnings` for the
/// whole job, which its own input documents as overwriting `build.rustflags`, so on CI the
/// frozen list was discarded and the linker emitted a growable memory with no maximum at all.
/// The strict ABI 3 envelope then refused the module for the linear-memory budget it does in
/// fact fit inside - on the first operation, on Linux only, while the same proof passed on a
/// developer machine that exports no such variable.
///
/// Warning discipline is stated here rather than inherited. `build.warnings` is a separate key
/// from rustflags, so denying warnings this way cannot displace the frozen list, and the guest
/// is held to the same bar on every host - including one whose `make` target exports
/// `CARGO_BUILD_WARNINGS=warn` for the workspace around it.
pub(crate) fn lowered_guest_build_command(project: &Path, target_dir: &Path) -> Command {
    let mut command = Command::new("cargo");
    for name in AMBIENT_RUST_FLAG_VARS {
        command.env_remove(name);
    }
    command
        .args([
            "build",
            "--release",
            "--target",
            "wasm32v1-none",
            "--offline",
        ])
        .env("CARGO_BUILD_WARNINGS", "deny")
        .env("CARGO_TARGET_DIR", target_dir)
        .current_dir(project);
    command
}

/// One frozen program's guest, built and admitted as a strict ABI 3 module.
pub(crate) struct LoweredGuestModuleV1 {
    /// The plugin manifest of the frozen Design, which the module was built against.
    pub(crate) manifest: PluginManifestV2,
    pub(crate) wasm: Vec<u8>,
    /// The bound the program declares for its module, which the module was admitted under.
    #[cfg_attr(
        not(feature = "sealed-strategy-input-acceptance"),
        allow(
            dead_code,
            reason = "read by the target-set Sim proof, which needs that feature"
        )
    )]
    pub(crate) max_wasm_bytes: u32,
}

/// Lowers `frozen` into `root`, builds it into `target_dir`, and admits the module as strict ABI 3.
///
/// `label` names the program in every failure, so a caller building several can tell them apart.
pub(crate) fn build_lowered_guest_for_test(
    frozen: &FrozenResearchBoundedFeatureProgramV1,
    root: &Path,
    target_dir: &Path,
    label: &str,
) -> LoweredGuestModuleV1 {
    let canonical_design: StrategyDesignV2 =
        serde_json::from_slice(frozen.design_bytes()).expect("a frozen Design parses");
    let manifest = canonical_design.plugins[0].clone();
    let lowered = prepare_frozen_bounded_feature_source_inputs_v1(frozen)
        .unwrap_or_else(|e| panic!("{label} source lowering: {e}"));

    for (path, bytes) in lowered.source_files() {
        let destination = root.join(path);
        fs::create_dir_all(destination.parent().expect("source parent")).unwrap();
        fs::write(destination, bytes).unwrap();
    }
    let output = lowered_guest_build_command(root, target_dir)
        .output()
        .expect("run cargo");
    assert!(
        output.status.success(),
        "{label}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let wasm = fs::read(target_dir.join("wasm32v1-none/release/strategy_bfp_guest.wasm"))
        .expect("built wasm");
    let max_wasm_bytes = lowered.bounds().max_wasm_bytes;
    crate::program_runtime::validate_plugin_candidate_v3(&wasm, &manifest, max_wasm_bytes)
        .unwrap_or_else(|e| panic!("{label} strict ABI 3 module: {e}"));

    LoweredGuestModuleV1 {
        manifest,
        wasm,
        max_wasm_bytes,
    }
}
