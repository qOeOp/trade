//! Tagged deterministic build boundary for an R&D Owner-frozen BFP source set.
//!
//! Two independently lowered source values and two fresh private builds are required before this
//! boundary can mint a move-only verified V3 build. Durable replay revalidates the current source,
//! capsule, receipt, manifest, and Wasm instead of trusting stored digests.

use std::{
    collections::BTreeMap,
    path::{Component, Path},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use tempfile::{Builder as TempDirBuilder, TempDir};
use vibe_data::owner::source_binding::BindingDigest;

use crate::{
    bounded_feature_program_lowerer_v1::PrevalidatedBoundedFeatureSourceInputsV1,
    bounded_feature_program_v1::BoundedFeatureBoundsV1,
    cargo_artifact::{PluginCargoBuildEvidenceV3, VerifiedPluginCargoBuildV3},
    strategy_design_v2::PluginManifestV2,
    strategy_plan_v2::{durable_decode, durable_encode, plugin_manifest_digest},
};

use super::develop_plugin_build_v2_sandbox::{
    BUILD_COMMAND, CARGO_COMMIT, CARGO_RELEASE, RUSTC_COMMIT, RUSTC_RELEASE,
    SandboxExecutionReceiptV2, SandboxSourceFileV2, TARGET, build_source_set_once,
    frozen_config_digest, frozen_execution_profiles, matches_frozen_execution_profile,
};

const CAPSULE_TAG: &str = "V3";
const CAPSULE_SCHEMA_VERSION: u16 = 3;
const RECEIPT_TAG: &str = "V3";
const RECEIPT_SCHEMA_VERSION: u16 = 3;
const LANGUAGE: &str = "rust.no_std.bounded-feature-source.v3";
const BUILD_PROFILE: &str = "release.no-float.bounded.v3";
const BFP_FAILURE_SEMANTIC_ID: &str = "bfp.numeric.failure.no-state-change.v1";
const BFP_PROGRAM_DOMAIN: &[u8] = b"strategy.bounded-feature-program.v1\0";
const SOURCE_SET_DOMAIN: &[u8] = b"strategy.bfp.source-set.v1\0";
const CAPSULE_DOMAIN: &[u8] = b"rd.develop.plugin-capsule.v3\0";
const RECEIPT_DOMAIN: &[u8] = b"rd.develop.plugin-build-receipt.v3\0";
const MAX_CAPSULE_BYTES: usize = 5 * 1024 * 1024;
const MAX_FILES: usize = 64;
const MAX_IMPORTS: u16 = 0;
const REQUIRED_EXPORTS: u16 = 6;
const OUTPUT_CRATE_NAME: &str = "strategy_bfp_guest";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct DevelopPluginSourceFileV3 {
    path: String,
    bytes: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct FrozenExecutionProfileV3 {
    host: String,
    cargo_digest: BindingDigest,
    rustc_digest: BindingDigest,
    linker_digest: BindingDigest,
    target_sysroot_digest: Option<BindingDigest>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct DeclaredBuildBoundsV3 {
    max_source_bytes: u32,
    max_wasm_bytes: u32,
    max_fuel: u64,
    max_linear_memory_bytes: u32,
    max_imports: u16,
    required_exports: u16,
    abi_version: u16,
    input_port_count: u16,
    output_port_count: u16,
    max_state_bytes: u32,
    max_invocations_per_event: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct DevelopPluginCapsuleV3 {
    capsule_tag: String,
    schema_version: u16,
    plugin_semantic_id: String,
    manifest_digest: BindingDigest,
    joint_freeze_digest: BindingDigest,
    bfp_canonical_bytes: Vec<u8>,
    bfp_digest: BindingDigest,
    kernel_catalog_digest: BindingDigest,
    complete_kernel_source_digest: BindingDigest,
    guest_kernel_source_digest: BindingDigest,
    sdk_source_digest: BindingDigest,
    lowerer_source_digest: BindingDigest,
    source_set_digest: BindingDigest,
    language: String,
    cargo_release: String,
    cargo_commit: String,
    rustc_release: String,
    rustc_commit: String,
    target: String,
    build_profile: String,
    build_command: Vec<String>,
    config_digest: BindingDigest,
    execution_profiles: Vec<FrozenExecutionProfileV3>,
    bounds: DeclaredBuildBoundsV3,
    files: Vec<DevelopPluginSourceFileV3>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreparedDevelopPluginCapsuleV3 {
    value: DevelopPluginCapsuleV3,
    canonical_bytes: Box<[u8]>,
    digest: BindingDigest,
}

impl PreparedDevelopPluginCapsuleV3 {
    pub(crate) fn parse_canonical_for(
        bytes: &[u8],
        manifest: &PluginManifestV2,
        first: &PrevalidatedBoundedFeatureSourceInputsV1,
        second: &PrevalidatedBoundedFeatureSourceInputsV1,
    ) -> Result<Self, DevelopPluginBuildTerminalV3> {
        let decoded: DevelopPluginCapsuleV3 = durable_decode(bytes).map_err(|_| {
            DevelopPluginBuildTerminalV3::invalid_capsule(
                "capsule.codec",
                "capsule bytes do not decode with the V3 schema",
            )
        })?;
        if durable_encode(&decoded) != bytes {
            return Err(DevelopPluginBuildTerminalV3::invalid_capsule(
                "capsule.canonical",
                "V3 capsule bytes are not canonical",
            ));
        }
        validate_capsule_value(&decoded)?;
        let expected = prepare_develop_plugin_capsule_v3(manifest, first, second)?;
        if decoded != expected.value {
            return Err(DevelopPluginBuildTerminalV3::invalid_capsule(
                "capsule.binding",
                "decoded V3 capsule differs from the lowerer-owned source and identity inputs",
            ));
        }
        Ok(expected)
    }

    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub(crate) const fn digest(&self) -> BindingDigest {
        self.digest
    }

    pub(crate) const fn source_set_digest(&self) -> BindingDigest {
        self.value.source_set_digest
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum DevelopPluginBuildTerminalKindV3 {
    Conflict,
    InvalidCapsule,
    InvalidReceipt,
    ToolchainUnavailable,
    SandboxUnavailable,
    BuildFailed,
    NonReproducible,
    VerificationFailed,
    CleanupFailed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DevelopPluginBuildTerminalV3 {
    pub(crate) kind: DevelopPluginBuildTerminalKindV3,
    pub(crate) coordinate: String,
    pub(crate) reason: String,
}

impl DevelopPluginBuildTerminalV3 {
    fn new(kind: DevelopPluginBuildTerminalKindV3, coordinate: &str, reason: &str) -> Self {
        Self {
            kind,
            coordinate: coordinate.to_owned(),
            reason: reason.to_owned(),
        }
    }

    fn invalid_capsule(coordinate: &str, reason: &str) -> Self {
        Self::new(
            DevelopPluginBuildTerminalKindV3::InvalidCapsule,
            coordinate,
            reason,
        )
    }

    fn invalid_receipt(coordinate: &str, reason: &str) -> Self {
        Self::new(
            DevelopPluginBuildTerminalKindV3::InvalidReceipt,
            coordinate,
            reason,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct DevelopPluginBuildExecutionReceiptV3 {
    ordinal: u8,
    cargo_release: String,
    cargo_commit: String,
    rustc_release: String,
    rustc_commit: String,
    host: String,
    cargo_digest: BindingDigest,
    rustc_digest: BindingDigest,
    linker_digest: BindingDigest,
    target_sysroot_digest: Option<BindingDigest>,
    config_digest: BindingDigest,
    target: String,
    build_command: Vec<String>,
    status: i32,
    module_digest: BindingDigest,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DevelopPluginBuildReceiptV3 {
    receipt_tag: String,
    schema_version: u16,
    receipt_digest: BindingDigest,
    capsule_digest: BindingDigest,
    plugin_semantic_id: String,
    manifest_digest: BindingDigest,
    joint_freeze_digest: BindingDigest,
    bfp_digest: BindingDigest,
    kernel_catalog_digest: BindingDigest,
    complete_kernel_source_digest: BindingDigest,
    guest_kernel_source_digest: BindingDigest,
    sdk_source_digest: BindingDigest,
    lowerer_source_digest: BindingDigest,
    source_set_digest: BindingDigest,
    bounds: DeclaredBuildBoundsV3,
    module_digest: BindingDigest,
    executions: Vec<DevelopPluginBuildExecutionReceiptV3>,
}

#[derive(Serialize)]
struct ReceiptBodyV3<'a> {
    receipt_tag: &'a str,
    schema_version: u16,
    capsule_digest: BindingDigest,
    plugin_semantic_id: &'a str,
    manifest_digest: BindingDigest,
    joint_freeze_digest: BindingDigest,
    bfp_digest: BindingDigest,
    kernel_catalog_digest: BindingDigest,
    complete_kernel_source_digest: BindingDigest,
    guest_kernel_source_digest: BindingDigest,
    sdk_source_digest: BindingDigest,
    lowerer_source_digest: BindingDigest,
    source_set_digest: BindingDigest,
    bounds: &'a DeclaredBuildBoundsV3,
    module_digest: BindingDigest,
    executions: &'a [DevelopPluginBuildExecutionReceiptV3],
}

impl DevelopPluginBuildReceiptV3 {
    pub(crate) fn canonical_bytes(&self) -> Vec<u8> {
        durable_encode(self)
    }

    pub(crate) fn parse_canonical_for(
        bytes: &[u8],
        capsule: &PreparedDevelopPluginCapsuleV3,
    ) -> Result<Self, DevelopPluginBuildTerminalV3> {
        let receipt: Self = durable_decode(bytes).map_err(|_| {
            DevelopPluginBuildTerminalV3::invalid_receipt(
                "receipt.codec",
                "V3 receipt bytes do not decode with the V3 schema",
            )
        })?;
        if receipt.canonical_bytes() != bytes {
            return Err(DevelopPluginBuildTerminalV3::invalid_receipt(
                "receipt.canonical",
                "V3 receipt bytes are not canonical",
            ));
        }
        receipt.validate_for(capsule)?;
        Ok(receipt)
    }

    fn validate_for(
        &self,
        capsule: &PreparedDevelopPluginCapsuleV3,
    ) -> Result<(), DevelopPluginBuildTerminalV3> {
        let expected = &capsule.value;
        let bindings_match = self.receipt_tag == RECEIPT_TAG
            && self.schema_version == RECEIPT_SCHEMA_VERSION
            && self.capsule_digest == capsule.digest
            && self.plugin_semantic_id == expected.plugin_semantic_id
            && self.manifest_digest == expected.manifest_digest
            && self.joint_freeze_digest == expected.joint_freeze_digest
            && self.bfp_digest == expected.bfp_digest
            && self.kernel_catalog_digest == expected.kernel_catalog_digest
            && self.complete_kernel_source_digest == expected.complete_kernel_source_digest
            && self.guest_kernel_source_digest == expected.guest_kernel_source_digest
            && self.sdk_source_digest == expected.sdk_source_digest
            && self.lowerer_source_digest == expected.lowerer_source_digest
            && self.source_set_digest == expected.source_set_digest
            && self.bounds == expected.bounds;
        if !bindings_match {
            return Err(DevelopPluginBuildTerminalV3::invalid_receipt(
                "receipt.binding",
                "V3 receipt does not completely bind the selected V3 capsule",
            ));
        }
        let execution_profile_matches = self.module_digest
            != BindingDigest::from_untrusted_bytes([0; 32])
            && self.executions.len() == 2
            && execution_authority_matches(&self.executions[0], &self.executions[1])
            && self
                .executions
                .iter()
                .enumerate()
                .all(|(index, execution)| {
                    execution.ordinal == (index + 1) as u8
                        && execution.cargo_release == CARGO_RELEASE
                        && execution.cargo_commit == CARGO_COMMIT
                        && execution.rustc_release == RUSTC_RELEASE
                        && execution.rustc_commit == RUSTC_COMMIT
                        && execution.status == 0
                        && execution.module_digest == self.module_digest
                        && execution.config_digest == expected.config_digest
                        && execution.target == TARGET
                        && execution
                            .build_command
                            .iter()
                            .map(String::as_str)
                            .eq(BUILD_COMMAND)
                        && matches_frozen_execution_profile(
                            &execution.host,
                            *execution.cargo_digest.as_bytes(),
                            *execution.rustc_digest.as_bytes(),
                            *execution.linker_digest.as_bytes(),
                            execution
                                .target_sysroot_digest
                                .map(|digest| *digest.as_bytes()),
                        )
                });
        if !execution_profile_matches || self.receipt_digest != receipt_digest(self) {
            return Err(DevelopPluginBuildTerminalV3::invalid_receipt(
                "receipt.execution",
                "V3 receipt execution or digest evidence is invalid",
            ));
        }
        Ok(())
    }
}

fn execution_authority_matches(
    first: &DevelopPluginBuildExecutionReceiptV3,
    second: &DevelopPluginBuildExecutionReceiptV3,
) -> bool {
    first.host == second.host
        && first.cargo_digest == second.cargo_digest
        && first.rustc_digest == second.rustc_digest
        && first.linker_digest == second.linker_digest
        && first.target_sysroot_digest == second.target_sysroot_digest
        && first.config_digest == second.config_digest
}

/// Freezes the exact V3 capsule from a lowerer-owned positive input type.
pub(crate) fn prepare_develop_plugin_capsule_v3(
    manifest: &PluginManifestV2,
    first_inputs: &PrevalidatedBoundedFeatureSourceInputsV1,
    second_inputs: &PrevalidatedBoundedFeatureSourceInputsV1,
) -> Result<PreparedDevelopPluginCapsuleV3, DevelopPluginBuildTerminalV3> {
    if manifest.abi_version != 3 || manifest.failure_semantic_id != BFP_FAILURE_SEMANTIC_ID {
        return Err(DevelopPluginBuildTerminalV3::invalid_capsule(
            "capsule.manifest.abi",
            "V3 requires ABI 3 and the named BFP numeric failure semantic",
        ));
    }
    if first_inputs != second_inputs {
        return Err(DevelopPluginBuildTerminalV3::new(
            DevelopPluginBuildTerminalKindV3::NonReproducible,
            "lowerer.source_identity",
            "the two independently lowered values differ in canonical bytes, source bytes, or identity bindings",
        ));
    }
    let inputs = first_inputs;
    if inputs.plugin_semantic_id() != manifest.semantic_id
        || inputs.manifest_digest() != plugin_manifest_digest(manifest)
    {
        return Err(DevelopPluginBuildTerminalV3::invalid_capsule(
            "capsule.manifest.binding",
            "lowered source does not bind the selected manifest",
        ));
    }
    validate_manifest_bounds(manifest, inputs.bounds())?;

    let first = collect_files(first_inputs);
    let second = collect_files(second_inputs);
    if first != second {
        return Err(DevelopPluginBuildTerminalV3::invalid_capsule(
            "capsule.source_set.replay",
            "the complete source bytes from the two lowerings differ",
        ));
    }
    validate_files(&first, inputs.bounds().max_source_bytes)?;
    if source_set_digest(&first)? != inputs.source_set_digest() {
        return Err(DevelopPluginBuildTerminalV3::invalid_capsule(
            "capsule.source_set.digest",
            "source set bytes do not match the lowerer-owned digest",
        ));
    }
    if domain_digest(BFP_PROGRAM_DOMAIN, inputs.program_bytes()) != inputs.program_digest() {
        return Err(DevelopPluginBuildTerminalV3::invalid_capsule(
            "capsule.bfp.digest",
            "canonical BFP bytes do not match their bound digest",
        ));
    }

    let bounds = declared_bounds(manifest, inputs.bounds())?;
    let execution_profiles = frozen_execution_profiles()
        .into_iter()
        .map(|profile| FrozenExecutionProfileV3 {
            host: profile.host.to_owned(),
            cargo_digest: BindingDigest::from_untrusted_bytes(profile.cargo_digest),
            rustc_digest: BindingDigest::from_untrusted_bytes(profile.rustc_digest),
            linker_digest: BindingDigest::from_untrusted_bytes(profile.linker_digest),
            target_sysroot_digest: profile
                .target_sysroot_digest
                .map(BindingDigest::from_untrusted_bytes),
        })
        .collect();
    let value = DevelopPluginCapsuleV3 {
        capsule_tag: CAPSULE_TAG.to_owned(),
        schema_version: CAPSULE_SCHEMA_VERSION,
        plugin_semantic_id: inputs.plugin_semantic_id().to_owned(),
        manifest_digest: inputs.manifest_digest(),
        joint_freeze_digest: inputs.joint_freeze_digest(),
        bfp_canonical_bytes: inputs.program_bytes().to_vec(),
        bfp_digest: inputs.program_digest(),
        kernel_catalog_digest: inputs.catalog_digest(),
        complete_kernel_source_digest: inputs.complete_kernel_source_digest(),
        guest_kernel_source_digest: inputs.guest_kernel_source_digest(),
        sdk_source_digest: inputs.sdk_source_digest(),
        lowerer_source_digest: inputs.lowerer_source_digest(),
        source_set_digest: inputs.source_set_digest(),
        language: LANGUAGE.to_owned(),
        cargo_release: CARGO_RELEASE.to_owned(),
        cargo_commit: CARGO_COMMIT.to_owned(),
        rustc_release: RUSTC_RELEASE.to_owned(),
        rustc_commit: RUSTC_COMMIT.to_owned(),
        target: TARGET.to_owned(),
        build_profile: BUILD_PROFILE.to_owned(),
        build_command: BUILD_COMMAND
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
        config_digest: BindingDigest::from_untrusted_bytes(frozen_config_digest(
            manifest.max_linear_memory_bytes,
        )),
        execution_profiles,
        bounds,
        files: first,
    };
    validate_capsule_value(&value)?;
    let canonical_bytes = durable_encode(&value);
    if canonical_bytes.len() > MAX_CAPSULE_BYTES {
        return Err(DevelopPluginBuildTerminalV3::invalid_capsule(
            "capsule.bytes",
            "canonical V3 capsule exceeds its frozen byte bound",
        ));
    }
    let digest = domain_digest(CAPSULE_DOMAIN, &canonical_bytes);
    Ok(PreparedDevelopPluginCapsuleV3 {
        value,
        canonical_bytes: canonical_bytes.into_boxed_slice(),
        digest,
    })
}

pub(crate) struct VerifiedDevelopPluginBuildReadV3 {
    build: VerifiedDevelopPluginBuildV3,
}

pub(crate) struct VerifiedDevelopPluginBuildV3 {
    receipt: DevelopPluginBuildReceiptV3,
    receipt_bytes: Box<[u8]>,
    wasm: Box<[u8]>,
}

#[derive(Clone, Copy)]
pub(crate) struct DevelopPluginBuildRestartEvidenceV3<'a> {
    pub(crate) capsule_bytes: &'a [u8],
    pub(crate) receipt_bytes: &'a [u8],
    pub(crate) wasm: &'a [u8],
}

impl VerifiedDevelopPluginBuildV3 {
    pub(crate) fn plugin_semantic_id(&self) -> &str {
        &self.receipt.plugin_semantic_id
    }

    pub(crate) const fn manifest_digest(&self) -> BindingDigest {
        self.receipt.manifest_digest
    }

    pub(crate) const fn joint_freeze_digest(&self) -> BindingDigest {
        self.receipt.joint_freeze_digest
    }

    pub(crate) const fn bfp_digest(&self) -> BindingDigest {
        self.receipt.bfp_digest
    }

    pub(crate) const fn source_set_digest(&self) -> BindingDigest {
        self.receipt.source_set_digest
    }

    pub(crate) const fn capsule_digest(&self) -> BindingDigest {
        self.receipt.capsule_digest
    }

    pub(crate) const fn module_digest(&self) -> BindingDigest {
        self.receipt.module_digest
    }

    pub(crate) const fn verified_build_receipt_digest(&self) -> BindingDigest {
        self.receipt.receipt_digest
    }

    pub(crate) fn wasm(&self) -> &[u8] {
        &self.wasm
    }

    pub(crate) fn canonical_receipt_bytes(&self) -> &[u8] {
        &self.receipt_bytes
    }

    /// Consumes the build proof into the distinct ABI3 Cargo artifact boundary.
    pub(crate) fn into_verified_for_composer(
        self,
        manifest: &PluginManifestV2,
    ) -> Result<VerifiedPluginCargoBuildV3, crate::develop_composer_v2::DevelopComposerTerminalV2>
    {
        if self.receipt.plugin_semantic_id != manifest.semantic_id
            || self.receipt.manifest_digest != plugin_manifest_digest(manifest)
        {
            return Err(
                crate::develop_composer_v2::DevelopComposerTerminalV2::unavailable(
                    "plugin_builds.receipt",
                    "the current manifest does not match the verified V3 build receipt",
                ),
            );
        }
        if self.receipt.module_digest != module_digest(&self.wasm) {
            return Err(
                crate::develop_composer_v2::DevelopComposerTerminalV2::unavailable(
                    "plugin_builds.receipt",
                    "the verified V3 build Wasm no longer matches its receipt",
                ),
            );
        }

        VerifiedPluginCargoBuildV3::verify(
            manifest,
            PluginCargoBuildEvidenceV3 {
                wasm_one: &self.wasm,
                wasm_two: &self.wasm,
                capsule_digest: self.receipt.capsule_digest,
                source_set_digest: self.receipt.source_set_digest,
                verified_build_receipt_digest: self.receipt.receipt_digest,
                max_wasm_bytes: self.receipt.bounds.max_wasm_bytes,
            },
        )
        .map_err(|error| {
            crate::develop_composer_v2::DevelopComposerTerminalV2::unavailable(
                "plugin_builds.consume",
                &format!("move-bound ABI3 build failed current consumption validation: {error}"),
            )
        })
    }
}

impl VerifiedDevelopPluginBuildReadV3 {
    pub(crate) fn build(&self) -> &VerifiedDevelopPluginBuildV3 {
        &self.build
    }

    pub(crate) fn canonical_receipt_bytes(&self) -> &[u8] {
        self.build.canonical_receipt_bytes()
    }

    pub(crate) fn wasm(&self) -> &[u8] {
        self.build.wasm()
    }

    pub(crate) fn into_composer_build(self) -> VerifiedDevelopPluginBuildV3 {
        self.build
    }
}

/// Reconstructs a move-only V3 proof from durable bytes against current Owner-derived inputs.
pub(crate) fn restart_verified_develop_plugin_build_v3(
    manifest: &PluginManifestV2,
    first_inputs: &PrevalidatedBoundedFeatureSourceInputsV1,
    second_inputs: &PrevalidatedBoundedFeatureSourceInputsV1,
    evidence: DevelopPluginBuildRestartEvidenceV3<'_>,
) -> Result<VerifiedDevelopPluginBuildV3, DevelopPluginBuildTerminalV3> {
    verify_current(
        manifest,
        first_inputs,
        second_inputs,
        evidence.capsule_bytes,
        evidence.receipt_bytes,
        evidence.wasm,
    )
}

pub(crate) enum DevelopPluginBuildResultV3 {
    Verified(Box<VerifiedDevelopPluginBuildReadV3>),
    Terminal(DevelopPluginBuildTerminalV3),
}

#[derive(Default)]
pub(crate) struct DevelopPluginBuildProducerV3 {
    completed_by_plugin: BTreeMap<String, StoredBuildV3>,
}

struct StoredBuildV3 {
    capsule_digest: BindingDigest,
    capsule_bytes: Box<[u8]>,
    receipt_bytes: Box<[u8]>,
    wasm: Box<[u8]>,
}

struct PendingBuildV3 {
    receipt_bytes: Box<[u8]>,
    wasm: Box<[u8]>,
}

impl DevelopPluginBuildProducerV3 {
    pub(crate) fn build(
        &mut self,
        manifest: &PluginManifestV2,
        first_inputs: PrevalidatedBoundedFeatureSourceInputsV1,
        second_inputs: PrevalidatedBoundedFeatureSourceInputsV1,
    ) -> DevelopPluginBuildResultV3 {
        let first_inputs = Box::new(first_inputs);
        let second_inputs = Box::new(second_inputs);
        let capsule =
            match prepare_develop_plugin_capsule_v3(manifest, &first_inputs, &second_inputs) {
                Ok(value) => value,
                Err(terminal) => return DevelopPluginBuildResultV3::Terminal(terminal),
            };

        if let Some(stored) = self.completed_by_plugin.get(&manifest.semantic_id) {
            if stored.capsule_digest != capsule.digest {
                return DevelopPluginBuildResultV3::Terminal(DevelopPluginBuildTerminalV3::new(
                    DevelopPluginBuildTerminalKindV3::Conflict,
                    "capsule.plugin_semantic_id",
                    "a different V3 capsule already owns this plugin semantic identity",
                ));
            }
            return match verify_stored(manifest, &first_inputs, &second_inputs, stored) {
                Ok(build) => DevelopPluginBuildResultV3::Verified(Box::new(
                    VerifiedDevelopPluginBuildReadV3 { build },
                )),
                Err(terminal) => DevelopPluginBuildResultV3::Terminal(terminal),
            };
        }

        let first_root = match private_tempdir() {
            Ok(value) => value,
            Err(terminal) => return DevelopPluginBuildResultV3::Terminal(terminal),
        };
        let second_root = match private_tempdir() {
            Ok(value) => value,
            Err(terminal) => {
                let terminal = match finish_cleanup::<PendingBuildV3>(
                    Err(terminal),
                    first_root.close(),
                    Ok(()),
                ) {
                    Err(terminal) => terminal,
                    Ok(_) => unreachable!("a cleanup-only path cannot mint a build"),
                };
                return DevelopPluginBuildResultV3::Terminal(terminal);
            }
        };

        let outcome = build_twice(
            manifest,
            &capsule,
            &first_inputs,
            &second_inputs,
            first_root.path(),
            second_root.path(),
        );
        let pending = match finish_cleanup(outcome, first_root.close(), second_root.close()) {
            Ok(value) => value,
            Err(terminal) => return DevelopPluginBuildResultV3::Terminal(terminal),
        };

        let build = match verify_current(
            manifest,
            &first_inputs,
            &second_inputs,
            capsule.canonical_bytes(),
            &pending.receipt_bytes,
            &pending.wasm,
        ) {
            Ok(value) => value,
            Err(terminal) => return DevelopPluginBuildResultV3::Terminal(terminal),
        };
        let capsule_digest = capsule.digest;
        self.completed_by_plugin.insert(
            manifest.semantic_id.clone(),
            StoredBuildV3 {
                capsule_digest,
                capsule_bytes: capsule.canonical_bytes,
                receipt_bytes: pending.receipt_bytes,
                wasm: pending.wasm,
            },
        );
        DevelopPluginBuildResultV3::Verified(Box::new(VerifiedDevelopPluginBuildReadV3 { build }))
    }

    #[cfg(test)]
    fn corrupt_stored_wasm_for_test(&mut self, plugin_semantic_id: &str) {
        if let Some(stored) = self.completed_by_plugin.get_mut(plugin_semantic_id)
            && let Some(first) = stored.wasm.first_mut()
        {
            *first ^= 0xff;
        }
    }
}

fn build_twice(
    manifest: &PluginManifestV2,
    capsule: &PreparedDevelopPluginCapsuleV3,
    first_inputs: &PrevalidatedBoundedFeatureSourceInputsV1,
    second_inputs: &PrevalidatedBoundedFeatureSourceInputsV1,
    first_root: &Path,
    second_root: &Path,
) -> Result<PendingBuildV3, DevelopPluginBuildTerminalV3> {
    let first_files = sandbox_source_files(first_inputs);
    let second_files = sandbox_source_files(second_inputs);
    let first = build_source_set_once(
        first_root,
        &first_files,
        OUTPUT_CRATE_NAME,
        manifest.max_linear_memory_bytes,
    )
    .map_err(map_sandbox_terminal)?;
    let second = build_source_set_once(
        second_root,
        &second_files,
        OUTPUT_CRATE_NAME,
        manifest.max_linear_memory_bytes,
    )
    .map_err(map_sandbox_terminal)?;
    if first.wasm != second.wasm {
        return Err(DevelopPluginBuildTerminalV3::new(
            DevelopPluginBuildTerminalKindV3::NonReproducible,
            "build.wasm",
            "the two private builds produced different Wasm bytes",
        ));
    }
    if !sandbox_authority_matches(&first.execution, &second.execution) {
        return Err(DevelopPluginBuildTerminalV3::new(
            DevelopPluginBuildTerminalKindV3::VerificationFailed,
            "build.authority",
            "the two private builds observed different execution authority or configuration",
        ));
    }
    crate::program_runtime::validate_plugin_candidate_v3(
        &first.wasm,
        manifest,
        capsule.value.bounds.max_wasm_bytes,
    )
    .map_err(|error| {
        DevelopPluginBuildTerminalV3::new(
            DevelopPluginBuildTerminalKindV3::VerificationFailed,
            "build.module",
            &error.to_string(),
        )
    })?;
    let receipt = make_receipt(capsule, &first.wasm, [&first.execution, &second.execution]);
    receipt.validate_for(capsule)?;
    Ok(PendingBuildV3 {
        receipt_bytes: receipt.canonical_bytes().into_boxed_slice(),
        wasm: first.wasm.into_boxed_slice(),
    })
}

fn verify_stored(
    manifest: &PluginManifestV2,
    first_inputs: &PrevalidatedBoundedFeatureSourceInputsV1,
    second_inputs: &PrevalidatedBoundedFeatureSourceInputsV1,
    stored: &StoredBuildV3,
) -> Result<VerifiedDevelopPluginBuildV3, DevelopPluginBuildTerminalV3> {
    verify_current(
        manifest,
        first_inputs,
        second_inputs,
        &stored.capsule_bytes,
        &stored.receipt_bytes,
        &stored.wasm,
    )
}

fn verify_current(
    manifest: &PluginManifestV2,
    first_inputs: &PrevalidatedBoundedFeatureSourceInputsV1,
    second_inputs: &PrevalidatedBoundedFeatureSourceInputsV1,
    capsule_bytes: &[u8],
    receipt_bytes: &[u8],
    wasm: &[u8],
) -> Result<VerifiedDevelopPluginBuildV3, DevelopPluginBuildTerminalV3> {
    let capsule = PreparedDevelopPluginCapsuleV3::parse_canonical_for(
        capsule_bytes,
        manifest,
        first_inputs,
        second_inputs,
    )?;
    let receipt = DevelopPluginBuildReceiptV3::parse_canonical_for(receipt_bytes, &capsule)?;
    if receipt.module_digest != module_digest(wasm) {
        return Err(DevelopPluginBuildTerminalV3::new(
            DevelopPluginBuildTerminalKindV3::VerificationFailed,
            "build.binding",
            "the current Wasm bytes do not match the canonical V3 receipt",
        ));
    }
    crate::program_runtime::validate_plugin_candidate_v3(
        wasm,
        manifest,
        capsule.value.bounds.max_wasm_bytes,
    )
    .map_err(|error| {
        DevelopPluginBuildTerminalV3::new(
            DevelopPluginBuildTerminalKindV3::VerificationFailed,
            "build.module",
            &error.to_string(),
        )
    })?;
    Ok(VerifiedDevelopPluginBuildV3 {
        receipt,
        receipt_bytes: receipt_bytes.into(),
        wasm: wasm.into(),
    })
}

fn make_receipt(
    capsule: &PreparedDevelopPluginCapsuleV3,
    wasm: &[u8],
    executions: [&SandboxExecutionReceiptV2; 2],
) -> DevelopPluginBuildReceiptV3 {
    let module_digest = module_digest(wasm);
    let mut receipt = DevelopPluginBuildReceiptV3 {
        receipt_tag: RECEIPT_TAG.to_owned(),
        schema_version: RECEIPT_SCHEMA_VERSION,
        receipt_digest: BindingDigest::from_untrusted_bytes([0; 32]),
        capsule_digest: capsule.digest,
        plugin_semantic_id: capsule.value.plugin_semantic_id.clone(),
        manifest_digest: capsule.value.manifest_digest,
        joint_freeze_digest: capsule.value.joint_freeze_digest,
        bfp_digest: capsule.value.bfp_digest,
        kernel_catalog_digest: capsule.value.kernel_catalog_digest,
        complete_kernel_source_digest: capsule.value.complete_kernel_source_digest,
        guest_kernel_source_digest: capsule.value.guest_kernel_source_digest,
        sdk_source_digest: capsule.value.sdk_source_digest,
        lowerer_source_digest: capsule.value.lowerer_source_digest,
        source_set_digest: capsule.value.source_set_digest,
        bounds: capsule.value.bounds.clone(),
        module_digest,
        executions: executions
            .into_iter()
            .enumerate()
            .map(|(index, execution)| DevelopPluginBuildExecutionReceiptV3 {
                ordinal: (index + 1) as u8,
                cargo_release: CARGO_RELEASE.to_owned(),
                cargo_commit: CARGO_COMMIT.to_owned(),
                rustc_release: RUSTC_RELEASE.to_owned(),
                rustc_commit: RUSTC_COMMIT.to_owned(),
                host: execution.host.to_owned(),
                cargo_digest: BindingDigest::from_untrusted_bytes(execution.cargo_digest),
                rustc_digest: BindingDigest::from_untrusted_bytes(execution.rustc_digest),
                linker_digest: BindingDigest::from_untrusted_bytes(execution.linker_digest),
                target_sysroot_digest: execution
                    .target_sysroot_digest
                    .map(BindingDigest::from_untrusted_bytes),
                config_digest: BindingDigest::from_untrusted_bytes(execution.config_digest),
                target: TARGET.to_owned(),
                build_command: BUILD_COMMAND
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect(),
                status: execution.status_code,
                module_digest,
            })
            .collect(),
    };
    receipt.receipt_digest = receipt_digest(&receipt);
    receipt
}

fn module_digest(wasm: &[u8]) -> BindingDigest {
    BindingDigest::from_untrusted_bytes(Sha256::digest(wasm).into())
}

fn sandbox_source_files(
    inputs: &PrevalidatedBoundedFeatureSourceInputsV1,
) -> Vec<SandboxSourceFileV2<'_>> {
    inputs
        .source_files()
        .map(|(path, bytes)| SandboxSourceFileV2 { path, bytes })
        .collect()
}

fn sandbox_authority_matches(
    first: &SandboxExecutionReceiptV2,
    second: &SandboxExecutionReceiptV2,
) -> bool {
    first.status_code == 0
        && second.status_code == 0
        && first.host == second.host
        && first.cargo_digest == second.cargo_digest
        && first.rustc_digest == second.rustc_digest
        && first.linker_digest == second.linker_digest
        && first.target_sysroot_digest == second.target_sysroot_digest
        && first.config_digest == second.config_digest
}

fn private_tempdir() -> Result<TempDir, DevelopPluginBuildTerminalV3> {
    TempDirBuilder::new()
        .prefix("strategy-factory-v3-build-")
        .tempdir()
        .map_err(|error| {
            DevelopPluginBuildTerminalV3::new(
                DevelopPluginBuildTerminalKindV3::SandboxUnavailable,
                "sandbox.root",
                &error.to_string(),
            )
        })
}

fn finish_cleanup<T>(
    outcome: Result<T, DevelopPluginBuildTerminalV3>,
    first: std::io::Result<()>,
    second: std::io::Result<()>,
) -> Result<T, DevelopPluginBuildTerminalV3> {
    if let Some(error) = first.err().or_else(|| second.err()) {
        return Err(DevelopPluginBuildTerminalV3::new(
            DevelopPluginBuildTerminalKindV3::CleanupFailed,
            "sandbox.cleanup",
            &error.to_string(),
        ));
    }
    outcome
}

fn map_sandbox_terminal(
    terminal: crate::develop_plugin_build_v2::DevelopPluginBuildTerminalV2,
) -> DevelopPluginBuildTerminalV3 {
    use crate::develop_plugin_build_v2::DevelopPluginBuildTerminalKindV2 as V2;
    let crate::develop_plugin_build_v2::DevelopPluginBuildTerminalV2 {
        kind,
        coordinate,
        reason,
    } = terminal;
    let kind = match kind {
        V2::Conflict => DevelopPluginBuildTerminalKindV3::Conflict,
        V2::InvalidCapsule => DevelopPluginBuildTerminalKindV3::InvalidCapsule,
        V2::ToolchainUnavailable => DevelopPluginBuildTerminalKindV3::ToolchainUnavailable,
        V2::SandboxUnavailable => DevelopPluginBuildTerminalKindV3::SandboxUnavailable,
        V2::BuildFailed => DevelopPluginBuildTerminalKindV3::BuildFailed,
        V2::NonReproducible => DevelopPluginBuildTerminalKindV3::NonReproducible,
        V2::VerificationFailed => DevelopPluginBuildTerminalKindV3::VerificationFailed,
        V2::CleanupFailed => DevelopPluginBuildTerminalKindV3::CleanupFailed,
    };
    DevelopPluginBuildTerminalV3::new(kind, &coordinate, &reason)
}

fn collect_files(
    inputs: &PrevalidatedBoundedFeatureSourceInputsV1,
) -> Vec<DevelopPluginSourceFileV3> {
    inputs
        .source_files()
        .map(|(path, bytes)| DevelopPluginSourceFileV3 {
            path: path.to_owned(),
            bytes: bytes.to_vec(),
        })
        .collect()
}

fn validate_manifest_bounds(
    manifest: &PluginManifestV2,
    bounds: &BoundedFeatureBoundsV1,
) -> Result<(), DevelopPluginBuildTerminalV3> {
    if bounds.max_fuel != manifest.max_fuel
        || bounds.max_linear_memory_bytes != manifest.max_linear_memory_bytes
        || bounds.max_invocations_per_event != manifest.max_invocations_per_event
        || bounds.max_state_bytes != manifest.state.max_bytes
    {
        return Err(DevelopPluginBuildTerminalV3::invalid_capsule(
            "capsule.bounds.manifest",
            "BFP resource bounds differ from the selected manifest",
        ));
    }
    Ok(())
}

fn declared_bounds(
    manifest: &PluginManifestV2,
    bounds: &BoundedFeatureBoundsV1,
) -> Result<DeclaredBuildBoundsV3, DevelopPluginBuildTerminalV3> {
    Ok(DeclaredBuildBoundsV3 {
        max_source_bytes: bounds.max_source_bytes,
        max_wasm_bytes: bounds.max_wasm_bytes,
        max_fuel: bounds.max_fuel,
        max_linear_memory_bytes: bounds.max_linear_memory_bytes,
        max_imports: MAX_IMPORTS,
        required_exports: REQUIRED_EXPORTS,
        abi_version: manifest.abi_version,
        input_port_count: u16::try_from(manifest.input_ports.len()).map_err(|_| {
            DevelopPluginBuildTerminalV3::invalid_capsule(
                "capsule.bounds.input_ports",
                "input port count exceeds the receipt width",
            )
        })?,
        output_port_count: u16::try_from(manifest.output_ports.len()).map_err(|_| {
            DevelopPluginBuildTerminalV3::invalid_capsule(
                "capsule.bounds.output_ports",
                "output port count exceeds the receipt width",
            )
        })?,
        max_state_bytes: bounds.max_state_bytes,
        max_invocations_per_event: bounds.max_invocations_per_event,
    })
}

fn validate_files(
    files: &[DevelopPluginSourceFileV3],
    max_source_bytes: u32,
) -> Result<(), DevelopPluginBuildTerminalV3> {
    if files.is_empty()
        || files.len() > MAX_FILES
        || !files
            .windows(2)
            .all(|pair| pair[0].path.as_bytes() < pair[1].path.as_bytes())
    {
        return Err(DevelopPluginBuildTerminalV3::invalid_capsule(
            "capsule.files.order",
            "source files must be nonempty, unique, and strictly path-byte-sorted",
        ));
    }
    let mut total = 0_usize;
    for file in files {
        let path = Path::new(&file.path);
        if file.path.is_empty()
            || !file.path.is_ascii()
            || path.is_absolute()
            || path
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
            || (file.path.starts_with(".cargo/") && file.path != ".cargo/config.toml")
            || file.path.starts_with("target/")
            || file.bytes.is_empty()
        {
            return Err(DevelopPluginBuildTerminalV3::invalid_capsule(
                "capsule.files.path",
                "source file path or bytes are outside the regular-file policy",
            ));
        }
        total = total.checked_add(file.bytes.len()).ok_or_else(|| {
            DevelopPluginBuildTerminalV3::invalid_capsule(
                "capsule.files.bytes",
                "source byte count overflow",
            )
        })?;
    }
    if total > max_source_bytes as usize
        || !files.iter().any(|file| file.path == ".cargo/config.toml")
        || !files.iter().any(|file| file.path == "Cargo.lock")
        || !files.iter().any(|file| file.path == "Cargo.toml")
        || !files.iter().any(|file| file.path == "src/lib.rs")
    {
        return Err(DevelopPluginBuildTerminalV3::invalid_capsule(
            "capsule.files.coverage",
            "source set exceeds its declared bound or omits a required build file",
        ));
    }
    Ok(())
}

fn validate_capsule_value(
    capsule: &DevelopPluginCapsuleV3,
) -> Result<(), DevelopPluginBuildTerminalV3> {
    let expected_profiles = frozen_execution_profiles();
    let profiles_match = capsule.execution_profiles.len() == expected_profiles.len()
        && capsule
            .execution_profiles
            .iter()
            .zip(expected_profiles)
            .all(|(actual, expected)| {
                actual.host == expected.host
                    && actual.cargo_digest.as_bytes() == &expected.cargo_digest
                    && actual.rustc_digest.as_bytes() == &expected.rustc_digest
                    && actual.linker_digest.as_bytes() == &expected.linker_digest
                    && actual
                        .target_sysroot_digest
                        .map(|digest| *digest.as_bytes())
                        == expected.target_sysroot_digest
            });
    let zero = BindingDigest::from_untrusted_bytes([0; 32]);
    let config = capsule
        .files
        .iter()
        .find(|file| file.path == ".cargo/config.toml");
    let config_matches = config.is_some_and(|file| {
        BindingDigest::from_untrusted_bytes(Sha256::digest(&file.bytes).into())
            == capsule.config_digest
            && capsule.config_digest.as_bytes()
                == &frozen_config_digest(capsule.bounds.max_linear_memory_bytes)
    });
    if capsule.capsule_tag != CAPSULE_TAG
        || capsule.schema_version != CAPSULE_SCHEMA_VERSION
        || capsule.language != LANGUAGE
        || capsule.cargo_release != CARGO_RELEASE
        || capsule.cargo_commit != CARGO_COMMIT
        || capsule.rustc_release != RUSTC_RELEASE
        || capsule.rustc_commit != RUSTC_COMMIT
        || capsule.target != TARGET
        || capsule.build_profile != BUILD_PROFILE
        || capsule
            .build_command
            .iter()
            .map(String::as_str)
            .ne(BUILD_COMMAND)
        || !profiles_match
        || capsule.bounds.max_imports != MAX_IMPORTS
        || capsule.bounds.required_exports != REQUIRED_EXPORTS
        || capsule.bounds.abi_version != 3
        || capsule.bfp_canonical_bytes.is_empty()
        || !config_matches
        || [
            capsule.manifest_digest,
            capsule.joint_freeze_digest,
            capsule.bfp_digest,
            capsule.kernel_catalog_digest,
            capsule.complete_kernel_source_digest,
            capsule.guest_kernel_source_digest,
            capsule.sdk_source_digest,
            capsule.lowerer_source_digest,
            capsule.source_set_digest,
        ]
        .contains(&zero)
    {
        return Err(DevelopPluginBuildTerminalV3::invalid_capsule(
            "capsule.profile",
            "V3 capsule tag, build profile, identities, or bounds are invalid",
        ));
    }
    validate_files(&capsule.files, capsule.bounds.max_source_bytes)?;
    if source_set_digest(&capsule.files)? != capsule.source_set_digest
        || domain_digest(BFP_PROGRAM_DOMAIN, &capsule.bfp_canonical_bytes) != capsule.bfp_digest
    {
        return Err(DevelopPluginBuildTerminalV3::invalid_capsule(
            "capsule.digest",
            "V3 capsule payload digests do not match their bytes",
        ));
    }
    Ok(())
}

fn source_set_digest(
    files: &[DevelopPluginSourceFileV3],
) -> Result<BindingDigest, DevelopPluginBuildTerminalV3> {
    let mut hasher = Sha256::new();
    hasher.update(SOURCE_SET_DOMAIN);
    hasher.update(
        u32::try_from(files.len())
            .map_err(|_| {
                DevelopPluginBuildTerminalV3::invalid_capsule(
                    "capsule.files.count",
                    "source file count exceeds digest width",
                )
            })?
            .to_le_bytes(),
    );
    for file in files {
        hasher.update(
            u16::try_from(file.path.len())
                .map_err(|_| {
                    DevelopPluginBuildTerminalV3::invalid_capsule(
                        "capsule.files.path",
                        "source path exceeds digest width",
                    )
                })?
                .to_le_bytes(),
        );
        hasher.update(file.path.as_bytes());
        hasher.update(
            u32::try_from(file.bytes.len())
                .map_err(|_| {
                    DevelopPluginBuildTerminalV3::invalid_capsule(
                        "capsule.files.bytes",
                        "source entry exceeds digest width",
                    )
                })?
                .to_le_bytes(),
        );
        hasher.update(&file.bytes);
    }
    Ok(BindingDigest::from_untrusted_bytes(
        hasher.finalize().into(),
    ))
}

fn receipt_digest(receipt: &DevelopPluginBuildReceiptV3) -> BindingDigest {
    domain_digest(
        RECEIPT_DOMAIN,
        &durable_encode(&ReceiptBodyV3 {
            receipt_tag: &receipt.receipt_tag,
            schema_version: receipt.schema_version,
            capsule_digest: receipt.capsule_digest,
            plugin_semantic_id: &receipt.plugin_semantic_id,
            manifest_digest: receipt.manifest_digest,
            joint_freeze_digest: receipt.joint_freeze_digest,
            bfp_digest: receipt.bfp_digest,
            kernel_catalog_digest: receipt.kernel_catalog_digest,
            complete_kernel_source_digest: receipt.complete_kernel_source_digest,
            guest_kernel_source_digest: receipt.guest_kernel_source_digest,
            sdk_source_digest: receipt.sdk_source_digest,
            lowerer_source_digest: receipt.lowerer_source_digest,
            source_set_digest: receipt.source_set_digest,
            bounds: &receipt.bounds,
            module_digest: receipt.module_digest,
            executions: &receipt.executions,
        }),
    )
}

fn domain_digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        bounded_feature_program_lowerer_v1::prepare_frozen_bounded_feature_source_inputs_v1,
        bounded_feature_program_v1::tests::candidate,
        develop_composer_v2::CurrentResearchDevelopCustodyV2,
        rd_bounded_feature_program_v1::freeze_research_bounded_feature_program_v1,
    };

    fn digest(byte: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([byte; 32])
    }

    fn fixture_capsule() -> PreparedDevelopPluginCapsuleV3 {
        let config = b"[build]\nrustflags = [\"-C\", \"link-arg=--max-memory=65536\", \"-C\", \"link-arg=--initial-memory=65536\", \"-C\", \"link-arg=-zstack-size=65536\"]\n".to_vec();
        let mut files = vec![
            DevelopPluginSourceFileV3 {
                path: ".cargo/config.toml".to_owned(),
                bytes: config.clone(),
            },
            DevelopPluginSourceFileV3 {
                path: "Cargo.lock".to_owned(),
                bytes: b"lock".to_vec(),
            },
            DevelopPluginSourceFileV3 {
                path: "Cargo.toml".to_owned(),
                bytes: b"manifest".to_vec(),
            },
            DevelopPluginSourceFileV3 {
                path: "src/lib.rs".to_owned(),
                bytes: b"source".to_vec(),
            },
        ];
        files.sort_by(|left, right| left.path.as_bytes().cmp(right.path.as_bytes()));
        let bfp = b"canonical-bfp".to_vec();
        let source_set_digest = source_set_digest(&files).expect("fixture source set");
        let profiles = frozen_execution_profiles()
            .into_iter()
            .map(|profile| FrozenExecutionProfileV3 {
                host: profile.host.to_owned(),
                cargo_digest: BindingDigest::from_untrusted_bytes(profile.cargo_digest),
                rustc_digest: BindingDigest::from_untrusted_bytes(profile.rustc_digest),
                linker_digest: BindingDigest::from_untrusted_bytes(profile.linker_digest),
                target_sysroot_digest: profile
                    .target_sysroot_digest
                    .map(BindingDigest::from_untrusted_bytes),
            })
            .collect();
        let value = DevelopPluginCapsuleV3 {
            capsule_tag: CAPSULE_TAG.to_owned(),
            schema_version: CAPSULE_SCHEMA_VERSION,
            plugin_semantic_id: "strategy.plugin.bfp.fixture.v1".to_owned(),
            manifest_digest: digest(1),
            joint_freeze_digest: digest(2),
            bfp_canonical_bytes: bfp.clone(),
            bfp_digest: domain_digest(BFP_PROGRAM_DOMAIN, &bfp),
            kernel_catalog_digest: digest(3),
            complete_kernel_source_digest: digest(4),
            guest_kernel_source_digest: digest(5),
            sdk_source_digest: digest(6),
            lowerer_source_digest: digest(7),
            source_set_digest,
            language: LANGUAGE.to_owned(),
            cargo_release: CARGO_RELEASE.to_owned(),
            cargo_commit: CARGO_COMMIT.to_owned(),
            rustc_release: RUSTC_RELEASE.to_owned(),
            rustc_commit: RUSTC_COMMIT.to_owned(),
            target: TARGET.to_owned(),
            build_profile: BUILD_PROFILE.to_owned(),
            build_command: BUILD_COMMAND
                .iter()
                .map(|value| (*value).to_owned())
                .collect(),
            config_digest: BindingDigest::from_untrusted_bytes(Sha256::digest(&config).into()),
            execution_profiles: profiles,
            bounds: DeclaredBuildBoundsV3 {
                max_source_bytes: 4096,
                max_wasm_bytes: 4096,
                max_fuel: 100,
                max_linear_memory_bytes: 65_536,
                max_imports: 0,
                required_exports: 6,
                abi_version: 3,
                input_port_count: 1,
                output_port_count: 1,
                max_state_bytes: 16,
                max_invocations_per_event: 1,
            },
            files,
        };
        let canonical_bytes = durable_encode(&value).into_boxed_slice();
        let digest = domain_digest(CAPSULE_DOMAIN, &canonical_bytes);
        PreparedDevelopPluginCapsuleV3 {
            value,
            canonical_bytes,
            digest,
        }
    }

    fn fixture_receipt(capsule: &PreparedDevelopPluginCapsuleV3) -> DevelopPluginBuildReceiptV3 {
        let profile = frozen_execution_profiles()[0];
        let module_digest = digest(9);
        let executions = (1..=2)
            .map(|ordinal| DevelopPluginBuildExecutionReceiptV3 {
                ordinal,
                cargo_release: CARGO_RELEASE.to_owned(),
                cargo_commit: CARGO_COMMIT.to_owned(),
                rustc_release: RUSTC_RELEASE.to_owned(),
                rustc_commit: RUSTC_COMMIT.to_owned(),
                host: profile.host.to_owned(),
                cargo_digest: BindingDigest::from_untrusted_bytes(profile.cargo_digest),
                rustc_digest: BindingDigest::from_untrusted_bytes(profile.rustc_digest),
                linker_digest: BindingDigest::from_untrusted_bytes(profile.linker_digest),
                target_sysroot_digest: profile
                    .target_sysroot_digest
                    .map(BindingDigest::from_untrusted_bytes),
                config_digest: capsule.value.config_digest,
                target: TARGET.to_owned(),
                build_command: BUILD_COMMAND
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect(),
                status: 0,
                module_digest,
            })
            .collect();
        let mut receipt = DevelopPluginBuildReceiptV3 {
            receipt_tag: RECEIPT_TAG.to_owned(),
            schema_version: RECEIPT_SCHEMA_VERSION,
            receipt_digest: digest(255),
            capsule_digest: capsule.digest,
            plugin_semantic_id: capsule.value.plugin_semantic_id.clone(),
            manifest_digest: capsule.value.manifest_digest,
            joint_freeze_digest: capsule.value.joint_freeze_digest,
            bfp_digest: capsule.value.bfp_digest,
            kernel_catalog_digest: capsule.value.kernel_catalog_digest,
            complete_kernel_source_digest: capsule.value.complete_kernel_source_digest,
            guest_kernel_source_digest: capsule.value.guest_kernel_source_digest,
            sdk_source_digest: capsule.value.sdk_source_digest,
            lowerer_source_digest: capsule.value.lowerer_source_digest,
            source_set_digest: capsule.value.source_set_digest,
            bounds: capsule.value.bounds.clone(),
            module_digest,
            executions,
        };
        receipt.receipt_digest = receipt_digest(&receipt);
        receipt
    }

    #[test]
    fn receipt_is_explicitly_v3_and_canonical() {
        let capsule = fixture_capsule();
        let receipt = fixture_receipt(&capsule);
        let bytes = receipt.canonical_bytes();
        assert_eq!(
            DevelopPluginBuildReceiptV3::parse_canonical_for(&bytes, &capsule),
            Ok(receipt)
        );
    }

    #[test]
    fn zero_module_digest_is_rejected_even_when_every_execution_matches() {
        let capsule = fixture_capsule();
        let mut receipt = fixture_receipt(&capsule);
        let zero = BindingDigest::from_untrusted_bytes([0; 32]);
        receipt.module_digest = zero;
        for execution in &mut receipt.executions {
            execution.module_digest = zero;
        }
        receipt.receipt_digest = receipt_digest(&receipt);

        assert!(
            DevelopPluginBuildReceiptV3::parse_canonical_for(&receipt.canonical_bytes(), &capsule,)
                .is_err()
        );
    }

    #[test]
    fn executions_must_share_one_authority_tuple() {
        let capsule = fixture_capsule();
        let mut receipt = fixture_receipt(&capsule);
        let other = frozen_execution_profiles()[1];
        let second = &mut receipt.executions[1];
        second.host = other.host.to_owned();
        second.cargo_digest = BindingDigest::from_untrusted_bytes(other.cargo_digest);
        second.rustc_digest = BindingDigest::from_untrusted_bytes(other.rustc_digest);
        second.linker_digest = BindingDigest::from_untrusted_bytes(other.linker_digest);
        second.target_sysroot_digest = other
            .target_sysroot_digest
            .map(BindingDigest::from_untrusted_bytes);
        receipt.receipt_digest = receipt_digest(&receipt);

        assert!(
            DevelopPluginBuildReceiptV3::parse_canonical_for(&receipt.canonical_bytes(), &capsule,)
                .is_err()
        );
    }

    #[test]
    fn execution_toolchain_and_command_fields_are_receipt_authority() {
        let capsule = fixture_capsule();
        let mut receipt = fixture_receipt(&capsule);
        receipt.executions[0].cargo_commit.push('x');
        receipt.executions[0]
            .build_command
            .push("unexpected".to_owned());
        receipt.receipt_digest = receipt_digest(&receipt);

        assert!(
            DevelopPluginBuildReceiptV3::parse_canonical_for(&receipt.canonical_bytes(), &capsule,)
                .is_err()
        );
    }

    #[test]
    fn cleanup_failure_prevents_positive_finalization() {
        let error = std::io::Error::other("cannot remove private root");
        let result = finish_cleanup(Ok(7_u8), Err(error), Ok(()));
        assert!(matches!(
            result,
            Err(DevelopPluginBuildTerminalV3 {
                kind: DevelopPluginBuildTerminalKindV3::CleanupFailed,
                ..
            })
        ));
    }

    #[test]
    fn cross_tag_noncanonical_and_identity_mutations_fail_closed() {
        let capsule = fixture_capsule();
        let receipt = fixture_receipt(&capsule);

        let mut cross_tag_capsule = capsule.value.clone();
        cross_tag_capsule.capsule_tag = "V2".to_owned();
        assert!(validate_capsule_value(&cross_tag_capsule).is_err());

        let mut cross_tag = receipt.clone();
        cross_tag.receipt_tag = "V2".to_owned();
        cross_tag.receipt_digest = receipt_digest(&cross_tag);
        assert!(
            DevelopPluginBuildReceiptV3::parse_canonical_for(
                &cross_tag.canonical_bytes(),
                &capsule
            )
            .is_err()
        );

        let mut noncanonical = receipt.canonical_bytes();
        noncanonical.push(b'\n');
        assert!(DevelopPluginBuildReceiptV3::parse_canonical_for(&noncanonical, &capsule).is_err());

        let mut changed_identity = receipt;
        changed_identity.joint_freeze_digest = digest(99);
        changed_identity.receipt_digest = receipt_digest(&changed_identity);
        assert!(
            DevelopPluginBuildReceiptV3::parse_canonical_for(
                &changed_identity.canonical_bytes(),
                &capsule
            )
            .is_err()
        );
    }

    #[test]
    fn source_set_mutation_is_rejected_before_receipt_use() {
        let mut capsule = fixture_capsule();
        capsule.value.files[0].bytes.push(1);
        assert!(validate_capsule_value(&capsule.value).is_err());
    }

    #[test]
    fn sandbox_owned_source_paths_are_rejected() {
        for path in [".cargo/credentials.toml", "target/generated.rs"] {
            let mut capsule = fixture_capsule();
            capsule.value.files.push(DevelopPluginSourceFileV3 {
                path: path.to_owned(),
                bytes: b"owned by sandbox".to_vec(),
            });
            capsule
                .value
                .files
                .sort_by(|left, right| left.path.as_bytes().cmp(right.path.as_bytes()));

            assert!(
                validate_files(&capsule.value.files, capsule.value.bounds.max_source_bytes,)
                    .is_err(),
                "sandbox-owned path must fail closed: {path}",
            );
        }
    }

    #[test]
    fn restart_requires_current_owner_inputs_before_receipt_bytes_can_be_used() {
        let (design, proposal, catalog) = candidate();
        let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);
        let frozen =
            freeze_research_bounded_feature_program_v1(&custody, &design, proposal, catalog)
                .expect("joint Owner freeze");
        let manifest = design.plugins[0].clone();
        let first = prepare_frozen_bounded_feature_source_inputs_v1(&frozen)
            .expect("first independent lowering");
        let second = prepare_frozen_bounded_feature_source_inputs_v1(&frozen)
            .expect("second independent lowering");
        let capsule = prepare_develop_plugin_capsule_v3(&manifest, &first, &second)
            .expect("current expected capsule");

        let terminal = match restart_verified_develop_plugin_build_v3(
            &manifest,
            &first,
            &second,
            DevelopPluginBuildRestartEvidenceV3 {
                capsule_bytes: capsule.canonical_bytes(),
                receipt_bytes: b"{}",
                wasm: b"not-wasm",
            },
        ) {
            Ok(_) => panic!("caller bytes cannot self-authenticate a V3 build"),
            Err(terminal) => terminal,
        };

        assert_eq!(
            terminal.kind,
            DevelopPluginBuildTerminalKindV3::InvalidReceipt
        );
        assert_eq!(terminal.coordinate, "receipt.codec");
    }

    #[test]
    fn cargo_conversion_rejects_a_different_current_manifest() {
        let capsule = fixture_capsule();
        let receipt = fixture_receipt(&capsule);
        let receipt_bytes = receipt.canonical_bytes().into_boxed_slice();
        let build = VerifiedDevelopPluginBuildV3 {
            receipt,
            receipt_bytes,
            wasm: b"not-wasm".as_slice().into(),
        };
        let (design, _, _) = candidate();

        let terminal = match build.into_verified_for_composer(&design.plugins[0]) {
            Ok(_) => panic!("a different current manifest must fail before Cargo verification"),
            Err(terminal) => terminal,
        };

        assert_eq!(
            terminal.kind,
            crate::develop_composer_v2::DevelopComposerTerminalKindV2::Unavailable
        );
        assert_eq!(terminal.coordinate, "plugin_builds.receipt");
    }

    #[test]
    #[ignore = "invokes the exact pinned local wasm compiler in two private roots"]
    fn two_lowerings_two_builds_and_strict_replay_mint_one_v3_identity() {
        let (design, proposal, catalog) = candidate();
        let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);
        let frozen =
            freeze_research_bounded_feature_program_v1(&custody, &design, proposal, catalog)
                .expect("joint Owner freeze");
        let manifest = design.plugins[0].clone();
        let first = prepare_frozen_bounded_feature_source_inputs_v1(&frozen)
            .expect("first independent lowering");
        let second = prepare_frozen_bounded_feature_source_inputs_v1(&frozen)
            .expect("second independent lowering");
        let mut producer = DevelopPluginBuildProducerV3::default();
        let first_read = match producer.build(&manifest, first, second) {
            DevelopPluginBuildResultV3::Verified(value) => value,
            DevelopPluginBuildResultV3::Terminal(terminal) => {
                panic!("V3 build failed: {terminal:?}")
            }
        };
        let first_receipt = first_read.build().canonical_receipt_bytes().to_vec();
        let first_wasm = first_read.build().wasm().to_vec();

        let third = prepare_frozen_bounded_feature_source_inputs_v1(&frozen)
            .expect("third independent lowering");
        let fourth = prepare_frozen_bounded_feature_source_inputs_v1(&frozen)
            .expect("fourth independent lowering");
        let replay = match producer.build(&manifest, third, fourth) {
            DevelopPluginBuildResultV3::Verified(value) => value,
            DevelopPluginBuildResultV3::Terminal(terminal) => {
                panic!("V3 replay failed: {terminal:?}")
            }
        };

        assert_eq!(replay.build().canonical_receipt_bytes(), first_receipt);
        assert_eq!(replay.build().wasm(), first_wasm);
        assert_eq!(
            replay.build().manifest_digest(),
            plugin_manifest_digest(&manifest),
        );
        assert_eq!(
            replay.build().module_digest(),
            module_digest(replay.build().wasm()),
        );

        let stored = producer
            .completed_by_plugin
            .get(&manifest.semantic_id)
            .expect("durable V3 build");
        let expected_capsule_digest = stored.capsule_digest;
        let capsule_bytes = stored.capsule_bytes.to_vec();
        let receipt_bytes = stored.receipt_bytes.to_vec();
        let wasm = stored.wasm.to_vec();
        let seventh = prepare_frozen_bounded_feature_source_inputs_v1(&frozen)
            .expect("seventh independent lowering");
        let eighth = prepare_frozen_bounded_feature_source_inputs_v1(&frozen)
            .expect("eighth independent lowering");
        let expected_source_set_digest = seventh.source_set_digest();
        let restarted = restart_verified_develop_plugin_build_v3(
            &manifest,
            &seventh,
            &eighth,
            DevelopPluginBuildRestartEvidenceV3 {
                capsule_bytes: &capsule_bytes,
                receipt_bytes: &receipt_bytes,
                wasm: &wasm,
            },
        )
        .expect("strict V3 restart");
        let cargo_build = restarted
            .into_verified_for_composer(&manifest)
            .expect("distinct ABI3 Cargo artifact");
        assert_eq!(cargo_build.module_digest(), module_digest(&wasm));
        assert_eq!(cargo_build.capsule_digest(), expected_capsule_digest);
        assert_eq!(cargo_build.source_set_digest(), expected_source_set_digest);

        producer.corrupt_stored_wasm_for_test(&manifest.semantic_id);
        let fifth = prepare_frozen_bounded_feature_source_inputs_v1(&frozen)
            .expect("fifth independent lowering");
        let sixth = prepare_frozen_bounded_feature_source_inputs_v1(&frozen)
            .expect("sixth independent lowering");
        assert!(matches!(
            producer.build(&manifest, fifth, sixth),
            DevelopPluginBuildResultV3::Terminal(DevelopPluginBuildTerminalV3 {
                kind: DevelopPluginBuildTerminalKindV3::VerificationFailed,
                coordinate,
                ..
            }) if coordinate == "build.binding"
        ));
    }
}
