use std::{
    fs,
    os::unix::fs::FileTypeExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use anyhow::Context;
use serde::Serialize;
use sha2::Digest;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{UnixListener, UnixStream},
};

use crate::{
    artifact_build::{
        ArtifactBuildError, GENERATED_PROGRAM_LOCK, GENERATED_PROGRAM_MANIFEST,
        SANDBOX_SOCKET_DEFAULT, SandboxBuildProductV1, canonical_sandbox_source_capsule,
        decode_sandbox_request, failure_wire_response, success_wire_response,
    },
    cargo_artifact::{
        RD_SANDBOX_DOCKERFILE, RUSTC_COMMIT, RUSTC_RELEASE, SANDBOX_POLICY_V1, TARGET,
    },
};

const MAX_REQUEST_BYTES: usize = 512 * 1024;
#[derive(Serialize)]
struct Recipe<'a> {
    build_platform: &'a str,
    dependency_policy: &'a str,
    dockerfile_sha256: String,
    frontend: &'a str,
    manifest: &'a str,
    network_policy: &'a str,
    rust_image: &'a str,
    rustc_commit: &'a str,
    rustc_release: &'a str,
    sandbox_policy: &'a str,
    schema_version: u32,
    target: &'a str,
    wasm_target: &'a str,
}

pub async fn run(socket: &Path) -> anyhow::Result<()> {
    let parent = socket
        .parent()
        .context("sandbox socket parent is missing")?;
    anyhow::ensure!(
        socket.starts_with("/run/trade-rd-sandbox/")
            && parent == Path::new("/run/trade-rd-sandbox"),
        "sandbox socket is outside dedicated custody"
    );
    fs::create_dir_all(parent)?;
    if let Ok(metadata) = fs::symlink_metadata(socket) {
        anyhow::ensure!(
            metadata.file_type().is_socket(),
            "sandbox socket path is not a socket"
        );
        fs::remove_file(socket)?;
    }
    let listener = UnixListener::bind(socket)?;
    loop {
        let (stream, _) = listener.accept().await?;
        handle(stream).await?;
    }
}

async fn handle(mut stream: UnixStream) -> anyhow::Result<()> {
    let length = usize::try_from(stream.read_u32().await?).context("request length")?;
    if length == 0 || length > MAX_REQUEST_BYTES {
        return write_response(&mut stream, failure_wire_response("SANDBOX_REQUEST_BOUND")).await;
    }
    let mut bytes = vec![0; length];
    stream.read_exact(&mut bytes).await?;
    let response = match decode_sandbox_request(&bytes) {
        Ok(request) => match tokio::task::spawn_blocking(move || build(&request.source)).await {
            Ok(Ok(product)) => success_wire_response(&product),
            Ok(Err(_)) | Err(_) => failure_wire_response("DETERMINISTIC_BUILD_FAILED"),
        },
        Err(ArtifactBuildError::Sandbox(_)) => failure_wire_response("SANDBOX_REQUEST_REJECTED"),
        Err(_) => failure_wire_response("SANDBOX_REQUEST_REJECTED"),
    };
    write_response(&mut stream, response).await
}

async fn write_response(stream: &mut UnixStream, response: Vec<u8>) -> anyhow::Result<()> {
    stream.write_u32(u32::try_from(response.len())?).await?;
    stream.write_all(&response).await?;
    stream.flush().await?;
    Ok(())
}

fn build(source: &str) -> anyhow::Result<SandboxBuildProductV1> {
    anyhow::ensure!(
        std::env::vars().all(|(name, _)| {
            !name.contains("API_KEY")
                && !name.contains("TOKEN")
                && !name.contains("PASSWORD")
                && !name.contains("DATABASE_URL")
                && !name.contains("DOCKER_HOST")
        }),
        "sandbox inherited a credential or effect-port environment variable"
    );
    let scratch = tempfile::tempdir_in("/tmp")?;
    let input = scratch.path().join("input");
    let source_dir = input.join("src");
    let first = scratch.path().join("output-first");
    let second = scratch.path().join("output-second");
    fs::create_dir_all(&source_dir)?;
    fs::create_dir(&first)?;
    fs::create_dir(&second)?;
    fs::write(input.join("Cargo.toml"), GENERATED_PROGRAM_MANIFEST)?;
    fs::write(input.join("Cargo.lock"), GENERATED_PROGRAM_LOCK)?;
    fs::write(source_dir.join("lib.rs"), source)?;
    make_read_only(&input)?;
    cargo_build(&input, &first)?;
    cargo_build(&input, &second)?;
    let wasm_path = Path::new(TARGET)
        .join("release")
        .join("rd_generated_strategy.wasm");
    let wasm_one = fs::read(first.join(&wasm_path))?;
    let wasm_two = fs::read(second.join(&wasm_path))?;
    let source_capsule = canonical_sandbox_source_capsule(source.as_bytes())?;
    let mut build_recipe = serde_json::to_vec(&Recipe {
        build_platform: "linux/arm64",
        dependency_policy: "locked_no_external_dependencies",
        dockerfile_sha256: format!(
            "sha256:{:x}",
            sha2::Sha256::digest(RD_SANDBOX_DOCKERFILE.as_bytes())
        ),
        frontend: "docker/dockerfile:1.20@sha256:26147acbda4f14c5add9946e2fd2ed543fc402884fd75146bd342a7f6271dc1d",
        manifest: "Cargo.toml",
        network_policy: "container_network_none_cargo_offline",
        rust_image: "public.ecr.aws/docker/library/rust:1.97.1-slim-bookworm@sha256:99e09cb2284e2ddbb73a995deee3e91783fd04d177602ccf6eab326d778ee777",
        rustc_commit: RUSTC_COMMIT,
        rustc_release: RUSTC_RELEASE,
        sandbox_policy: SANDBOX_POLICY_V1,
        schema_version: 2,
        target: TARGET,
        wasm_target: "rd_generated_strategy",
    })?;
    build_recipe.push(b'\n');
    Ok(SandboxBuildProductV1 {
        source_capsule,
        build_recipe,
        wasm_one,
        wasm_two,
    })
}

fn cargo_build(input: &Path, output: &Path) -> anyhow::Result<()> {
    let status = Command::new("/usr/local/cargo/bin/cargo")
        .args([
            "build",
            "--frozen",
            "--offline",
            "--release",
            "--target",
            TARGET,
            "--manifest-path",
        ])
        .arg(input.join("Cargo.toml"))
        .arg("--target-dir")
        .arg(output)
        .env_clear()
        .env("PATH", "/usr/local/cargo/bin:/usr/local/rustup/toolchains/1.97.1-aarch64-unknown-linux-gnu/bin:/usr/bin:/bin")
        .env("HOME", "/tmp")
        .env("CARGO_HOME", "/tmp/cargo-home-empty")
        .env("RUSTUP_HOME", "/usr/local/rustup")
        .env("CARGO_NET_OFFLINE", "true")
        .env("CARGO_INCREMENTAL", "0")
        .env("CARGO_TERM_COLOR", "never")
        .env("SOURCE_DATE_EPOCH", "1")
        .env(
            "CARGO_TARGET_WASM32V1_NONE_RUSTFLAGS",
            "-Clink-arg=--initial-memory=65536 -Clink-arg=--max-memory=65536 -Clink-arg=--stack-first -Clink-arg=-z -Clink-arg=stack-size=16384",
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .context("sandbox Cargo process unavailable")?;
    anyhow::ensure!(status.success(), "sandbox Cargo build failed");
    Ok(())
}

fn make_read_only(root: &Path) -> anyhow::Result<()> {
    for path in [
        root.join("Cargo.toml"),
        root.join("Cargo.lock"),
        root.join("src/lib.rs"),
    ] {
        let mut permissions = fs::metadata(&path)?.permissions();
        permissions.set_readonly(true);
        fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

pub fn socket_from_environment() -> PathBuf {
    std::env::var_os("RD_SANDBOX_SOCKET")
        .map_or_else(|| PathBuf::from(SANDBOX_SOCKET_DEFAULT), PathBuf::from)
}
