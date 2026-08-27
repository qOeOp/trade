use rstest::rstest;

use super::{
    develop_plugin_build_v2::{
        DevelopPluginBuildProducerV2, DevelopPluginBuildResultV2, DevelopPluginBuildTerminalKindV2,
        UntrustedDevelopPluginCapsuleV2, UntrustedDevelopPluginSourceFileV2, bounded_source,
        portable_sealed_composer_test_evidence,
    },
    program_host_v2_tests::executable_design,
};

fn capsule() -> UntrustedDevelopPluginCapsuleV2 {
    let manifest = executable_design().plugins.remove(0);
    UntrustedDevelopPluginCapsuleV2 {
        schema_version: 2,
        manifest: manifest.clone(),
        language: "rust.no_std.fixed-abi-source.v2".to_owned(),
        rustc_release: "1.97.1".to_owned(),
        rustc_commit: "8bab26f4f68e0e26f0bb7960be334d5b520ea452".to_owned(),
        target: "wasm32v1-none".to_owned(),
        build_command: [
            "cargo",
            "build",
            "--offline",
            "--locked",
            "--release",
            "--target",
            "wasm32v1-none",
            "--manifest-path=Cargo.toml",
        ]
        .map(str::to_owned)
        .to_vec(),
        files: vec![UntrustedDevelopPluginSourceFileV2 {
            path: "src/lib.rs".to_owned(),
            bytes: bounded_source(&manifest).into_bytes(),
            symlink_target: None,
        }],
    }
}

#[rstest]
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn real_bounded_plugin_builds_twice_and_exact_replay_joins() {
    let capsule = capsule();
    let manifest = capsule.manifest.clone();
    let mut producer = DevelopPluginBuildProducerV2::default();
    let first = verified(producer.build(&manifest, &capsule));
    assert!(first.receipt().validates());
    let receipt = first.receipt().receipt_digest();
    let capsule_digest = first.receipt().implementation_capsule_digest();
    let _move_bound_composer_value = first.into_composer_build();

    let replay = verified(producer.build(&manifest, &capsule));
    assert_eq!(replay.receipt().receipt_digest(), receipt);
    assert_eq!(
        replay.receipt().implementation_capsule_digest(),
        capsule_digest
    );
    let fresh = verified(DevelopPluginBuildProducerV2::default().build(&manifest, &capsule));
    assert_eq!(fresh.receipt().receipt_digest(), receipt);

    producer.corrupt_receipt_for_test(&manifest.semantic_id);
    assert_terminal(
        producer.build(&manifest, &capsule),
        DevelopPluginBuildTerminalKindV2::VerificationFailed,
    );
}

#[rstest]
#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
fn unsupported_host_returns_toolchain_unavailable_without_a_positive() {
    let capsule = capsule();
    let manifest = capsule.manifest.clone();
    let result = DevelopPluginBuildProducerV2::default().build(&manifest, &capsule);
    match result {
        DevelopPluginBuildResultV2::Terminal(terminal) => {
            assert_eq!(
                terminal.kind,
                DevelopPluginBuildTerminalKindV2::ToolchainUnavailable
            );
            #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
            assert_eq!(terminal.coordinate, "toolchain.target_sysroot");
            #[cfg(not(all(target_os = "linux", target_arch = "aarch64")))]
            assert_eq!(terminal.coordinate, "toolchain.host");
        }
        DevelopPluginBuildResultV2::Verified(_) => {
            panic!("unsupported host leaked a verified build")
        }
    }
}

#[rstest]
fn frozen_host_profiles_preserve_exact_pins_but_admit_only_complete_authority() {
    use super::develop_plugin_build_v2_sandbox::{
        TARGET, host_profile_for_test, pinned_host_profile_for_test,
    };

    let macos = pinned_host_profile_for_test("macos", "aarch64")
        .expect("the exact macOS arm64 profile remains admitted");
    assert_eq!(macos.host, "aarch64-apple-darwin");
    assert_eq!(macos.target, TARGET);
    assert_eq!(
        macos.cargo_digest,
        hex_digest("7672ead309d505577c018fff2cafb3433601f073e38cbe87359ac1f7b944bbf5")
    );
    assert_eq!(
        macos.rustc_digest,
        hex_digest("210df6794001b73ec3d453878707fa1e0bdcb63c427024a6e6574bbe5615a4da")
    );
    assert_eq!(
        macos.linker_digest,
        hex_digest("8f5fe507df7232eac0a610c12a5d11f3202205235f710eb98c6c78df6d3f548d")
    );

    let linux = pinned_host_profile_for_test("linux", "aarch64")
        .expect("the exact Linux arm64 executable pins remain auditable");
    assert_eq!(linux.host, "aarch64-unknown-linux-gnu");
    assert_eq!(linux.target, TARGET);
    assert_eq!(
        linux.cargo_digest,
        hex_digest("c5dcff701935f50505c9c5df7ee941a9de4f29d84ab91627c396848accef1808")
    );
    assert_eq!(
        linux.rustc_digest,
        hex_digest("a3d4dfcd867ddc1e7dca25f13f7236c72229a56f68aa511437c5bb72eb2dfe78")
    );
    assert_eq!(
        linux.linker_digest,
        hex_digest("533dffee7995258d3de4f995b0c926f18a5245a0aef09896901deee6ef144eb7")
    );

    let terminal = host_profile_for_test("linux", "aarch64")
        .expect_err("executable pins cannot substitute for target sysroot authority");
    assert_eq!(
        terminal.kind,
        DevelopPluginBuildTerminalKindV2::ToolchainUnavailable
    );
    assert_eq!(terminal.coordinate, "toolchain.target_sysroot");
}

#[rstest]
fn unknown_host_profile_fails_closed() {
    let terminal = super::develop_plugin_build_v2_sandbox::host_profile_for_test("linux", "x86_64")
        .expect_err("an unpinned host profile must remain unavailable");
    assert_eq!(
        terminal.kind,
        DevelopPluginBuildTerminalKindV2::ToolchainUnavailable
    );
    assert_eq!(terminal.coordinate, "toolchain.host");
}

#[rstest]
fn cleanup_failure_dominates_the_original_terminal() {
    let original = super::develop_plugin_build_v2::DevelopPluginBuildTerminalV2::new(
        DevelopPluginBuildTerminalKindV2::BuildFailed,
        "build.status",
        "original failure",
    );
    let cleanup = std::io::Error::other("injected cleanup failure");
    let cleanup_failure = Err(cleanup);
    let cleanup_success = Ok(());
    let terminal = super::develop_plugin_build_v2::finish_cleanup::<()>(
        Err(original),
        &cleanup_failure,
        &cleanup_success,
    )
    .expect_err("cleanup failure must dominate");
    assert_eq!(
        terminal.kind,
        DevelopPluginBuildTerminalKindV2::CleanupFailed
    );
    assert_eq!(terminal.coordinate, "sandbox.cleanup");
}

#[rstest]
fn relocated_candidate_with_mismatched_bytes_is_not_tool_authority() {
    let root = tempfile::tempdir().expect("private test root is available");
    let candidate = root.path().join("cargo");
    std::fs::write(&candidate, b"not the frozen Cargo executable")
        .expect("mismatched local candidate is materialized");
    let terminal =
        super::develop_plugin_build_v2_sandbox::verify_mismatched_candidate_for_test(&candidate)
            .expect_err("location cannot substitute for exact executable bytes");
    assert_eq!(
        terminal.kind,
        DevelopPluginBuildTerminalKindV2::ToolchainUnavailable
    );
    assert_eq!(terminal.coordinate, "toolchain.digest");
}

#[rstest]
fn linux_profile_rejects_wrong_tool_digest() {
    let root = tempfile::tempdir().expect("private test root is available");
    let candidate = root.path().join("cargo");
    std::fs::write(&candidate, b"not the frozen Linux Cargo executable")
        .expect("mismatched local candidate is materialized");
    let terminal =
        super::develop_plugin_build_v2_sandbox::verify_mismatched_candidate_for_profile_for_test(
            &candidate, "linux", "aarch64",
        )
        .expect_err("the Linux profile must bind exact executable bytes");
    assert_eq!(
        terminal.kind,
        DevelopPluginBuildTerminalKindV2::ToolchainUnavailable
    );
    assert_eq!(terminal.coordinate, "toolchain.digest");
}

#[rstest]
fn portable_sealed_composer_evidence_is_exact_design_only_at_consumption() {
    let mut exact_manifest = executable_design().plugins.remove(0);
    exact_manifest.max_fuel = 10_000_000;
    portable_sealed_composer_test_evidence()
        .into_composer_build()
        .into_verified_for_composer(&exact_manifest)
        .expect("the sealed evidence consumes only for its fixed exact design");

    let mut changed_manifest = exact_manifest;
    changed_manifest.max_fuel -= 1;
    let terminal = portable_sealed_composer_test_evidence()
        .into_composer_build()
        .into_verified_for_composer(&changed_manifest)
        .expect_err("changed manifest must fail at the move-bound consumption boundary");
    assert_eq!(terminal.coordinate, "plugin_builds.receipt");
}

#[rstest]
fn invalid_capsule_profiles_return_zero_verified_builds() {
    let base = capsule();
    let manifest = base.manifest.clone();

    for mutate in [
        |value: &mut UntrustedDevelopPluginCapsuleV2| value.files[0].path = "../lib.rs".to_owned(),
        |value: &mut UntrustedDevelopPluginCapsuleV2| {
            value.files[0].symlink_target = Some("/tmp/escape".to_owned());
        },
        |value: &mut UntrustedDevelopPluginCapsuleV2| {
            value.files.push(UntrustedDevelopPluginSourceFileV2 {
                path: "build.rs".to_owned(),
                bytes: b"fn main() {}".to_vec(),
                symlink_target: None,
            });
        },
        |value: &mut UntrustedDevelopPluginCapsuleV2| {
            value.files[0]
                .bytes
                .extend_from_slice(b"\ninclude_bytes!(\"/etc/passwd\");\n");
        },
        |value: &mut UntrustedDevelopPluginCapsuleV2| {
            value.build_command.push("--features=network".to_owned());
        },
        |value: &mut UntrustedDevelopPluginCapsuleV2| {
            value.rustc_commit = "environment-drift".to_owned();
        },
    ] {
        let mut candidate = base.clone();
        mutate(&mut candidate);
        assert_terminal(
            DevelopPluginBuildProducerV2::default().build(&manifest, &candidate),
            DevelopPluginBuildTerminalKindV2::InvalidCapsule,
        );
    }
}

#[rstest]
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn conflicting_capsule_after_a_positive_returns_zero_verified_builds() {
    let base = capsule();
    let manifest = base.manifest.clone();
    let mut producer = DevelopPluginBuildProducerV2::default();
    let _first = verified(producer.build(&manifest, &base));
    let mut conflicting_manifest = manifest.clone();
    conflicting_manifest.max_fuel -= 1;
    let mut conflicting = base;
    conflicting.manifest = conflicting_manifest.clone();
    assert_terminal(
        producer.build(&conflicting_manifest, &conflicting),
        DevelopPluginBuildTerminalKindV2::Conflict,
    );
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn verified(
    result: DevelopPluginBuildResultV2,
) -> super::develop_plugin_build_v2::VerifiedDevelopPluginBuildReadV2 {
    match result {
        DevelopPluginBuildResultV2::Verified(value) => *value,
        DevelopPluginBuildResultV2::Terminal(terminal) => {
            panic!("unexpected terminal: {terminal:?}")
        }
    }
}

fn hex_digest(value: &str) -> [u8; 32] {
    let bytes = value.as_bytes();
    std::array::from_fn(|index| {
        let offset = index * 2;
        (hex_nibble(bytes[offset]) << 4) | hex_nibble(bytes[offset + 1])
    })
}

fn hex_nibble(value: u8) -> u8 {
    match value {
        b'0'..=b'9' => value - b'0',
        b'a'..=b'f' => value - b'a' + 10,
        _ => panic!("invalid test digest"),
    }
}

fn assert_terminal(result: DevelopPluginBuildResultV2, expected: DevelopPluginBuildTerminalKindV2) {
    match result {
        DevelopPluginBuildResultV2::Terminal(terminal) => assert_eq!(terminal.kind, expected),
        DevelopPluginBuildResultV2::Verified(_) => panic!("invalid capsule leaked verified build"),
    }
}
