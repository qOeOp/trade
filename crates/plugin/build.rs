use std::{env, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=RUSTC");

    let rustc_version = rustc_version();
    let target = env::var("TARGET").unwrap_or_default();
    let profile = env::var("PROFILE").unwrap_or_default();
    println!("cargo:rustc-env=VIBE_PLUGIN_BUILD_RUSTC_VERSION={rustc_version}");
    println!("cargo:rustc-env=VIBE_PLUGIN_BUILD_TARGET={target}");
    println!("cargo:rustc-env=VIBE_PLUGIN_BUILD_PROFILE={profile}");
}

fn rustc_version() -> String {
    let rustc = env::var("RUSTC").unwrap_or_else(|_| "rustc".to_string());
    let Ok(output) = Command::new(rustc).arg("--version").output() else {
        return String::new();
    };

    if !output.status.success() {
        return String::new();
    }
    String::from_utf8(output.stdout)
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}
