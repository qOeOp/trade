//! Exact local process boundary for the R&D-owned bounded plugin builder.

use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use sha2::{Digest, Sha256};
use tar::{Builder, EntryType, Header};

use super::develop_plugin_build_v2::{
    DevelopPluginBuildTerminalKindV2, DevelopPluginBuildTerminalV2,
};

pub(super) const RUSTC_RELEASE: &str = "1.97.1";
pub(super) const RUSTC_COMMIT: &str = "8bab26f4f68e0e26f0bb7960be334d5b520ea452";
pub(super) const CARGO_RELEASE: &str = "1.97.1";
pub(super) const CARGO_COMMIT: &str = "c980f4866141969fab6254a680546a277789d6f0";
pub(super) const TARGET: &str = "wasm32v1-none";
pub(super) const LINUX_TARGET_SYSROOT_SHA256: [u8; 32] =
    hex_bytes("92fcee2e35330d22e879b640064e2e4b4e47157af1a7e05fc942dc6cc12b8faf");

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct FrozenHostProfileV2 {
    pub(super) host: &'static str,
    pub(super) cargo_digest: [u8; 32],
    pub(super) rustc_digest: [u8; 32],
    pub(super) linker_digest: [u8; 32],
    pub(super) target: &'static str,
    pub(super) target_sysroot_digest: Option<[u8; 32]>,
}

const MACOS_ARM64_PROFILE: FrozenHostProfileV2 = FrozenHostProfileV2 {
    host: "aarch64-apple-darwin",
    cargo_digest: hex_bytes("7672ead309d505577c018fff2cafb3433601f073e38cbe87359ac1f7b944bbf5"),
    rustc_digest: hex_bytes("210df6794001b73ec3d453878707fa1e0bdcb63c427024a6e6574bbe5615a4da"),
    linker_digest: hex_bytes("8f5fe507df7232eac0a610c12a5d11f3202205235f710eb98c6c78df6d3f548d"),
    target: TARGET,
    target_sysroot_digest: None,
};

const LINUX_ARM64_PROFILE: FrozenHostProfileV2 = FrozenHostProfileV2 {
    host: "aarch64-unknown-linux-gnu",
    cargo_digest: hex_bytes("c5dcff701935f50505c9c5df7ee941a9de4f29d84ab91627c396848accef1808"),
    rustc_digest: hex_bytes("a3d4dfcd867ddc1e7dca25f13f7236c72229a56f68aa511437c5bb72eb2dfe78"),
    linker_digest: hex_bytes("533dffee7995258d3de4f995b0c926f18a5245a0aef09896901deee6ef144eb7"),
    target: TARGET,
    target_sysroot_digest: Some(LINUX_TARGET_SYSROOT_SHA256),
};

// Durable receipt fixtures remain bound to the profile selected by the compiling host.
#[cfg(not(all(target_os = "linux", target_arch = "aarch64")))]
pub(super) const CARGO_SHA256: [u8; 32] = MACOS_ARM64_PROFILE.cargo_digest;
#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
pub(super) const CARGO_SHA256: [u8; 32] = LINUX_ARM64_PROFILE.cargo_digest;
#[cfg(not(all(target_os = "linux", target_arch = "aarch64")))]
pub(super) const RUSTC_SHA256: [u8; 32] = MACOS_ARM64_PROFILE.rustc_digest;
#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
pub(super) const RUSTC_SHA256: [u8; 32] = LINUX_ARM64_PROFILE.rustc_digest;
#[cfg(not(all(target_os = "linux", target_arch = "aarch64")))]
pub(super) const LINKER_SHA256: [u8; 32] = MACOS_ARM64_PROFILE.linker_digest;
#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
pub(super) const LINKER_SHA256: [u8; 32] = LINUX_ARM64_PROFILE.linker_digest;
pub(super) const BUILD_COMMAND: [&str; 8] = [
    "cargo",
    "build",
    "--offline",
    "--locked",
    "--release",
    "--target",
    TARGET,
    "--manifest-path=Cargo.toml",
];

const MAX_DIAGNOSTIC_BYTES: usize = 16 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct SandboxExecutionReceiptV2 {
    pub(super) status_code: i32,
    pub(super) cargo_digest: [u8; 32],
    pub(super) rustc_digest: [u8; 32],
    pub(super) linker_digest: [u8; 32],
    pub(super) config_digest: [u8; 32],
}

pub(super) struct SandboxBuildOutputV2 {
    pub(super) wasm: Vec<u8>,
    pub(super) execution: SandboxExecutionReceiptV2,
}

struct ExactToolV2 {
    path: PathBuf,
    observed_digest: [u8; 32],
}

pub(super) fn build_once(
    root: &Path,
    source: &[u8],
    crate_name: &str,
    max_memory_bytes: u32,
) -> Result<SandboxBuildOutputV2, DevelopPluginBuildTerminalV2> {
    let profile = selected_host_profile()?;
    reject_ancestor_configs(root)?;
    let toolchain = toolchain_root(profile)?;
    let cargo = exact_tool(&toolchain, "cargo", profile.cargo_digest)?;
    let rustc = exact_tool(&toolchain, "rustc", profile.rustc_digest)?;
    let linker = exact_absolute_tool(
        &toolchain
            .join("lib/rustlib")
            .join(profile.host)
            .join("bin/rust-lld"),
        profile.linker_digest,
        "linker",
    )?;
    verify_tool(
        &cargo.path,
        CARGO_RELEASE,
        CARGO_COMMIT,
        profile.host,
        "cargo",
    )?;
    verify_tool(
        &rustc.path,
        RUSTC_RELEASE,
        RUSTC_COMMIT,
        profile.host,
        "rustc",
    )?;
    let config_digest = materialize(root, source, crate_name, max_memory_bytes)?;
    verify_target_sysroot(&toolchain, profile)?;

    let home = root.join("home");
    let target_dir = root.join("target");
    fs::create_dir(&home).map_err(|e| io_terminal("sandbox.home", &e))?;
    let output = Command::new(&cargo.path)
        .args(&BUILD_COMMAND[1..6])
        .arg(profile.target)
        .args(&BUILD_COMMAND[7..])
        .current_dir(root)
        .env_clear()
        .env("CARGO_HOME", root.join("cargo-home"))
        .env("HOME", &home)
        .env("PATH", cargo.path.parent().unwrap_or(Path::new("/invalid")))
        .env("RUSTC", &rustc.path)
        .env("CARGO_TARGET_WASM32V1_NONE_LINKER", &linker.path)
        .env("RUSTUP_TOOLCHAIN", RUSTC_RELEASE)
        .env("SOURCE_DATE_EPOCH", "0")
        .env("TZ", "UTC")
        .env("CARGO_TARGET_DIR", &target_dir)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| {
            DevelopPluginBuildTerminalV2::new(
                DevelopPluginBuildTerminalKindV2::SandboxUnavailable,
                "sandbox.execute",
                &e.to_string(),
            )
        })?;
    recheck_tool(&cargo)?;
    recheck_tool(&rustc)?;
    recheck_tool(&linker)?;
    verify_target_sysroot(&toolchain, profile)?;
    let status_code = output.status.code().ok_or_else(|| {
        DevelopPluginBuildTerminalV2::new(
            DevelopPluginBuildTerminalKindV2::BuildFailed,
            "build.status",
            "Cargo build did not return a finished exit status",
        )
    })?;

    if status_code != 0 {
        return Err(DevelopPluginBuildTerminalV2::new(
            DevelopPluginBuildTerminalKindV2::BuildFailed,
            "build.status",
            &bounded_diagnostic(&output.stderr),
        ));
    }
    let wasm_path = target_dir
        .join(TARGET)
        .join("release")
        .join(format!("{crate_name}.wasm"));
    let wasm = fs::read(&wasm_path).map_err(|e| io_terminal("build.output", &e))?;
    Ok(SandboxBuildOutputV2 {
        wasm,
        execution: SandboxExecutionReceiptV2 {
            status_code,
            cargo_digest: cargo.observed_digest,
            rustc_digest: rustc.observed_digest,
            linker_digest: linker.observed_digest,
            config_digest,
        },
    })
}

fn selected_host_profile() -> Result<&'static FrozenHostProfileV2, DevelopPluginBuildTerminalV2> {
    select_host_profile(std::env::consts::OS, std::env::consts::ARCH)
}

fn select_host_profile(
    target_os: &str,
    target_arch: &str,
) -> Result<&'static FrozenHostProfileV2, DevelopPluginBuildTerminalV2> {
    match (target_os, target_arch) {
        ("macos", "aarch64") => Ok(&MACOS_ARM64_PROFILE),
        ("linux", "aarch64") => Ok(&LINUX_ARM64_PROFILE),
        _ => Err(DevelopPluginBuildTerminalV2::new(
            DevelopPluginBuildTerminalKindV2::ToolchainUnavailable,
            "toolchain.host",
            "the exact local build profile admits only aarch64-apple-darwin",
        )),
    }
}

#[cfg(test)]
pub(super) fn host_profile_for_test(
    target_os: &str,
    target_arch: &str,
) -> Result<&'static FrozenHostProfileV2, DevelopPluginBuildTerminalV2> {
    select_host_profile(target_os, target_arch)
}

#[cfg(test)]
pub(super) fn pinned_host_profile_for_test(
    target_os: &str,
    target_arch: &str,
) -> Option<&'static FrozenHostProfileV2> {
    match (target_os, target_arch) {
        ("macos", "aarch64") => Some(&MACOS_ARM64_PROFILE),
        ("linux", "aarch64") => Some(&LINUX_ARM64_PROFILE),
        _ => None,
    }
}

fn verify_target_sysroot(
    toolchain: &Path,
    profile: &FrozenHostProfileV2,
) -> Result<(), DevelopPluginBuildTerminalV2> {
    let Some(expected_digest) = profile.target_sysroot_digest else {
        return Ok(());
    };
    let root = toolchain.join("lib/rustlib").join(profile.target);
    verify_target_sysroot_at(&root, expected_digest)
}

fn verify_target_sysroot_at(
    root: &Path,
    expected_digest: [u8; 32],
) -> Result<(), DevelopPluginBuildTerminalV2> {
    let observed_digest = canonical_target_sysroot_digest(root).map_err(|e| {
        DevelopPluginBuildTerminalV2::new(
            DevelopPluginBuildTerminalKindV2::ToolchainUnavailable,
            "toolchain.target_sysroot",
            &e.to_string(),
        )
    })?;

    if observed_digest != expected_digest {
        return Err(DevelopPluginBuildTerminalV2::new(
            DevelopPluginBuildTerminalKindV2::ToolchainUnavailable,
            "toolchain.target_sysroot_digest",
            "the canonical target sysroot bytes do not match the frozen digest",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn canonical_target_sysroot_digest(root: &Path) -> io::Result<[u8; 32]> {
    use std::os::unix::fs::MetadataExt;

    let metadata = fs::symlink_metadata(root)?;
    if !metadata.file_type().is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "the target sysroot root is not a directory",
        ));
    }

    let mut entries = vec![(PathBuf::new(), metadata)];
    collect_sysroot_entries(root, Path::new(""), &mut entries)?;
    let mut writer = CanonicalTarHash::default();
    {
        let mut archive = Builder::new(&mut writer);

        for (relative, metadata) in entries {
            let source = root.join(&relative);
            let mut archive_path = PathBuf::from(TARGET);
            archive_path.push(&relative);
            let file_type = metadata.file_type();
            let mut header = Header::new_gnu();
            header.set_uid(0);
            header.set_gid(0);
            header.set_mode(metadata.mode() & 0o7777);
            header.set_mtime(0);
            if file_type.is_dir() {
                header.set_entry_type(EntryType::Directory);
                header.set_size(0);
                let path = archive_path.to_str().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "sysroot path is not UTF-8")
                })?;
                append_gnu_entry(&mut archive, &mut header, format!("{path}/"), io::empty())?;
            } else if file_type.is_file() {
                header.set_entry_type(EntryType::Regular);
                header.set_size(metadata.len());
                append_gnu_entry(
                    &mut archive,
                    &mut header,
                    archive_path,
                    fs::File::open(source)?,
                )?;
            } else if file_type.is_symlink() {
                header.set_entry_type(EntryType::Symlink);
                header.set_size(0);
                header.set_link_name(fs::read_link(source)?)?;
                append_gnu_entry(&mut archive, &mut header, archive_path, io::empty())?;
            } else {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "the target sysroot contains an unsupported file type",
                ));
            }
        }
        archive.finish()?;
    }
    writer.finish_gnu_record()
}

fn append_gnu_entry<W: Write, R: io::Read, P: AsRef<Path>>(
    archive: &mut Builder<W>,
    header: &mut Header,
    path: P,
    data: R,
) -> io::Result<()> {
    header.set_path(path)?;
    header.set_cksum();
    let checksum = header.cksum()?;
    let checksum = format!("{checksum:06o}");
    if checksum.len() != 6 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "canonical GNU tar checksum exceeds its field",
        ));
    }
    header.as_mut_bytes()[148..154].copy_from_slice(checksum.as_bytes());
    header.as_mut_bytes()[154] = 0;
    header.as_mut_bytes()[155] = b' ';
    archive.append(header, data)
}

#[cfg(not(unix))]
fn canonical_target_sysroot_digest(_root: &Path) -> io::Result<[u8; 32]> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "canonical target sysroot verification requires Unix metadata",
    ))
}

#[cfg(unix)]
fn collect_sysroot_entries(
    root: &Path,
    relative: &Path,
    entries: &mut Vec<(PathBuf, fs::Metadata)>,
) -> io::Result<()> {
    let mut children = fs::read_dir(root.join(relative))?.collect::<Result<Vec<_>, _>>()?;
    children.sort_by_key(fs::DirEntry::file_name);
    for child in children {
        let child_relative = relative.join(child.file_name());
        let metadata = fs::symlink_metadata(root.join(&child_relative))?;
        let is_dir = metadata.file_type().is_dir();
        entries.push((child_relative.clone(), metadata));
        if is_dir {
            collect_sysroot_entries(root, &child_relative, entries)?;
        }
    }
    Ok(())
}

#[derive(Default)]
struct CanonicalTarHash {
    digest: Sha256,
    bytes_written: usize,
}

impl CanonicalTarHash {
    fn finish_gnu_record(mut self) -> io::Result<[u8; 32]> {
        const GNU_RECORD_BYTES: usize = 20 * 512;
        let padding = (GNU_RECORD_BYTES - self.bytes_written % GNU_RECORD_BYTES) % GNU_RECORD_BYTES;
        self.write_all(&[0; GNU_RECORD_BYTES][..padding])?;
        Ok(self.digest.finalize().into())
    }
}

impl Write for CanonicalTarHash {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.digest.update(bytes);
        self.bytes_written = self
            .bytes_written
            .checked_add(bytes.len())
            .ok_or_else(|| io::Error::other("canonical tar byte count overflow"))?;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
pub(super) fn target_sysroot_digest_for_test(root: &Path) -> io::Result<[u8; 32]> {
    canonical_target_sysroot_digest(root)
}

#[cfg(test)]
pub(super) fn verify_target_sysroot_for_test(
    root: &Path,
    expected_digest: [u8; 32],
) -> Result<(), DevelopPluginBuildTerminalV2> {
    verify_target_sysroot_at(root, expected_digest)
}

fn materialize(
    root: &Path,
    source: &[u8],
    crate_name: &str,
    max_memory_bytes: u32,
) -> Result<[u8; 32], DevelopPluginBuildTerminalV2> {
    fs::create_dir_all(root.join("src")).map_err(|e| io_terminal("sandbox.root", &e))?;
    fs::create_dir(root.join(".cargo")).map_err(|e| io_terminal("sandbox.config", &e))?;
    fs::write(root.join("src/lib.rs"), source).map_err(|e| io_terminal("sandbox.source", &e))?;
    let manifest = format!(
        "[package]\nname = \"{crate_name}\"\nversion = \"0.0.0\"\nedition = \"2024\"\nrust-version = \"{RUSTC_RELEASE}\"\npublish = false\n\n[lib]\ncrate-type = [\"cdylib\"]\n\n[profile.release]\ncodegen-units = 1\ndebug = false\nincremental = false\nlto = true\nopt-level = \"s\"\npanic = \"abort\"\nstrip = \"symbols\"\n"
    );
    fs::write(root.join("Cargo.toml"), manifest)
        .map_err(|e| io_terminal("sandbox.manifest", &e))?;
    let lock = format!(
        "# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = \"{crate_name}\"\nversion = \"0.0.0\"\n"
    );
    fs::write(root.join("Cargo.lock"), lock).map_err(|e| io_terminal("sandbox.lock", &e))?;
    let config = frozen_config(max_memory_bytes);
    fs::write(root.join(".cargo/config.toml"), &config)
        .map_err(|e| io_terminal("sandbox.config", &e))?;
    Ok(Sha256::digest(config.as_bytes()).into())
}

fn frozen_config(max_memory_bytes: u32) -> String {
    format!(
        "[build]\nrustflags = [\"-C\", \"link-arg=--max-memory={max_memory_bytes}\", \"-C\", \"link-arg=--initial-memory={max_memory_bytes}\", \"-C\", \"link-arg=-zstack-size=65536\"]\n"
    )
}

pub(super) fn frozen_config_digest(max_memory_bytes: u32) -> [u8; 32] {
    Sha256::digest(frozen_config(max_memory_bytes).as_bytes()).into()
}

#[cfg(test)]
pub(super) fn frozen_config_digest_for_test(max_memory_bytes: u32) -> [u8; 32] {
    frozen_config_digest(max_memory_bytes)
}

fn exact_tool(
    toolchain: &Path,
    name: &str,
    expected_digest: [u8; 32],
) -> Result<ExactToolV2, DevelopPluginBuildTerminalV2> {
    let expected = toolchain.join("bin").join(name);
    exact_absolute_tool(&expected, expected_digest, name)
}

fn toolchain_root(profile: &FrozenHostProfileV2) -> Result<PathBuf, DevelopPluginBuildTerminalV2> {
    let rustup_home = std::env::var_os("RUSTUP_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".rustup")))
        .ok_or_else(|| {
            DevelopPluginBuildTerminalV2::new(
                DevelopPluginBuildTerminalKindV2::ToolchainUnavailable,
                "toolchain.location",
                "neither RUSTUP_HOME nor HOME is available for local tool discovery",
            )
        })?;
    let candidate = rustup_home
        .join("toolchains")
        .join(format!("{RUSTC_RELEASE}-{}", profile.host));
    let canonical =
        fs::canonicalize(candidate).map_err(|e| io_terminal("toolchain.canonical", &e))?;
    if !canonical.is_dir() {
        return Err(DevelopPluginBuildTerminalV2::new(
            DevelopPluginBuildTerminalKindV2::ToolchainUnavailable,
            "toolchain.location",
            "the discovered local toolchain root is not a directory",
        ));
    }
    Ok(canonical)
}

fn exact_absolute_tool(
    expected: &Path,
    expected_digest: [u8; 32],
    name: &str,
) -> Result<ExactToolV2, DevelopPluginBuildTerminalV2> {
    let path = fs::canonicalize(expected).map_err(|e| io_terminal("toolchain.canonical", &e))?;
    if !path.is_file() {
        return Err(DevelopPluginBuildTerminalV2::new(
            DevelopPluginBuildTerminalKindV2::ToolchainUnavailable,
            "toolchain.binary",
            &format!("the exact frozen local {name} binary is unavailable"),
        ));
    }
    let bytes = fs::read(&path).map_err(|e| io_terminal("toolchain.bytes", &e))?;
    let observed_digest = <[u8; 32]>::from(Sha256::digest(bytes));
    if observed_digest != expected_digest {
        return Err(DevelopPluginBuildTerminalV2::new(
            DevelopPluginBuildTerminalKindV2::ToolchainUnavailable,
            "toolchain.digest",
            "the canonical executable bytes do not match the frozen digest",
        ));
    }
    Ok(ExactToolV2 {
        path,
        observed_digest,
    })
}

#[cfg(test)]
pub(super) fn verify_mismatched_candidate_for_test(
    path: &Path,
) -> Result<(), DevelopPluginBuildTerminalV2> {
    exact_absolute_tool(path, CARGO_SHA256, "cargo").map(|_| ())
}

#[cfg(test)]
pub(super) fn verify_mismatched_candidate_for_profile_for_test(
    path: &Path,
    target_os: &str,
    target_arch: &str,
) -> Result<(), DevelopPluginBuildTerminalV2> {
    let profile = pinned_host_profile_for_test(target_os, target_arch).ok_or_else(|| {
        DevelopPluginBuildTerminalV2::new(
            DevelopPluginBuildTerminalKindV2::ToolchainUnavailable,
            "toolchain.host",
            "no frozen executable pin profile exists for the test host",
        )
    })?;
    exact_absolute_tool(path, profile.cargo_digest, "cargo").map(|_| ())
}

fn recheck_tool(tool: &ExactToolV2) -> Result<(), DevelopPluginBuildTerminalV2> {
    let bytes = fs::read(&tool.path).map_err(|e| io_terminal("toolchain.bytes", &e))?;
    if <[u8; 32]>::from(Sha256::digest(bytes)) != tool.observed_digest {
        return Err(DevelopPluginBuildTerminalV2::new(
            DevelopPluginBuildTerminalKindV2::ToolchainUnavailable,
            "toolchain.changed",
            "a frozen tool executable changed during the build",
        ));
    }
    Ok(())
}

fn verify_tool(
    tool: &Path,
    release: &str,
    commit: &str,
    host: &str,
    name: &str,
) -> Result<(), DevelopPluginBuildTerminalV2> {
    let output = Command::new(tool)
        .arg("-Vv")
        .env_clear()
        .output()
        .map_err(|e| {
            DevelopPluginBuildTerminalV2::new(
                DevelopPluginBuildTerminalKindV2::ToolchainUnavailable,
                "toolchain.version",
                &e.to_string(),
            )
        })?;
    let text = String::from_utf8_lossy(&output.stdout);
    if !output.status.success()
        || !text.contains(&format!("release: {release}\n"))
        || !text.contains(&format!("commit-hash: {commit}\n"))
        || !text.contains(&format!("host: {host}\n"))
    {
        return Err(DevelopPluginBuildTerminalV2::new(
            DevelopPluginBuildTerminalKindV2::ToolchainUnavailable,
            "toolchain.identity",
            &format!("the canonical {name} does not match the frozen release, commit, and host"),
        ));
    }
    Ok(())
}

fn reject_ancestor_configs(root: &Path) -> Result<(), DevelopPluginBuildTerminalV2> {
    let canonical =
        fs::canonicalize(root).map_err(|e| io_terminal("sandbox.root.canonical", &e))?;
    for candidate in [root, canonical.as_path()] {
        for ancestor in candidate.ancestors().skip(1) {
            for relative in [".cargo/config", ".cargo/config.toml"] {
                if ancestor.join(relative).exists() {
                    return Err(DevelopPluginBuildTerminalV2::new(
                        DevelopPluginBuildTerminalKindV2::ToolchainUnavailable,
                        "toolchain.ancestor_config",
                        "an ambient ancestor Cargo config could change build authority",
                    ));
                }
            }
        }
    }
    Ok(())
}

const fn hex_bytes(value: &str) -> [u8; 32] {
    let bytes = value.as_bytes();
    let mut output = [0; 32];
    let mut index = 0;
    while index < 32 {
        output[index] = (hex_nibble(bytes[index * 2]) << 4) | hex_nibble(bytes[index * 2 + 1]);
        index += 1;
    }
    output
}

const fn hex_nibble(value: u8) -> u8 {
    match value {
        b'0'..=b'9' => value - b'0',
        b'a'..=b'f' => value - b'a' + 10,
        _ => panic!("invalid frozen hex digest"),
    }
}

fn bounded_diagnostic(bytes: &[u8]) -> String {
    String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_DIAGNOSTIC_BYTES)]).into_owned()
}

fn io_terminal(coordinate: &str, error: &std::io::Error) -> DevelopPluginBuildTerminalV2 {
    DevelopPluginBuildTerminalV2::new(
        DevelopPluginBuildTerminalKindV2::SandboxUnavailable,
        coordinate,
        &error.to_string(),
    )
}
