//! Build script for the `vibe-core` crate.
//!
//! This script propagates version information through the `VIBE_VERSION` and
//! `VIBE_USER_AGENT` compile-time environment variables.

use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=../Cargo.toml");
    println!("cargo:rerun-if-changed=../../python/pyproject.toml");

    // The Python manifest is unavailable when this crate builds from a published package
    let vibe_version = "2.0.0rc3";

    if let Some(pyproject_version) = try_read_pyproject_version() {
        assert!(
            pyproject_version.starts_with(vibe_version),
            "Version mismatch: pyproject.toml={pyproject_version}, hardcoded={vibe_version}",
        );
    }

    // Set compile-time environment variables
    println!("cargo:rustc-env=VIBE_VERSION={vibe_version}");
    println!("cargo:rustc-env=VIBE_USER_AGENT=VibeTrader/{vibe_version}");
}

fn try_read_pyproject_version() -> Option<String> {
    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let path = crate_dir
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("python/pyproject.toml"))?;

    if path.exists()
        && let Ok(contents) = std::fs::read_to_string(path)
        && let Ok(value) = toml::from_str::<toml::Value>(&contents)
        && let Some(version) = value
            .get("project")
            .and_then(|p| p.get("version"))
            .and_then(|v| v.as_str())
    {
        return Some(version.to_string());
    }

    None
}
