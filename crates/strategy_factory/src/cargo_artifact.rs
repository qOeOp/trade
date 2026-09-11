use std::path::{Component, Path};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_data::owner::source_binding::BindingDigest;

use crate::{
    program_runtime::{
        ProgramRuntimeBudget, validate_candidate_for_artifact, validate_plugin_candidate_v2,
        validate_plugin_candidate_v3,
    },
    strategy_design_v2::PluginManifestV2,
    strategy_plan_v2::plugin_manifest_digest,
};

const PROFILE_SCHEMA_VERSION: u32 = 1;
const SDK_ABI_VERSION: u32 = 3;
pub(crate) const TARGET: &str = "wasm32v1-none";
const BUILD_PLATFORM: &str = "linux/arm64";
pub(crate) const RUSTC_RELEASE: &str = "1.97.1";
pub(crate) const RUSTC_COMMIT: &str = "8bab26f4f68e0e26f0bb7960be334d5b520ea452";
const FRONTEND: &str = "docker/dockerfile:1.20@sha256:26147acbda4f14c5add9946e2fd2ed543fc402884fd75146bd342a7f6271dc1d";
const RUST_IMAGE: &str = "public.ecr.aws/docker/library/rust:1.97.1-slim-bookworm@sha256:99e09cb2284e2ddbb73a995deee3e91783fd04d177602ccf6eab326d778ee777";
pub(crate) const BUILD_RECIPE_LOCATOR: &str = "program-build-recipe-v1.jcs";
pub(crate) const SANDBOX_BUILD_RECIPE_LOCATOR: &str = "program-build-recipe-v2.jcs";
pub(crate) const SOURCE_CAPSULE_LOCATOR: &str = "program-source-capsule-v1.tar";
pub(crate) const SANDBOX_POLICY_V1: &str = "rd-development-sandbox-container-v1";
pub(crate) const PROGRAM_SEAL_DOCKERFILE: &str = include_str!("../tools/program-seal.dockerfile");
pub(crate) const RD_SANDBOX_DOCKERFILE: &str =
    include_str!("../../../product/rd-workbench/Dockerfile.sandbox");
const MAX_SOURCE_CAPSULE_BYTES: usize = 8 * 1024 * 1024;
const MAX_RECIPE_BYTES: usize = 32 * 1024;
const MAX_FUEL: u64 = 10_000_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProgramProfileV1 {
    pub(crate) schema_version: u32,
    pub(crate) sdk_abi_version: u32,
    pub(crate) runtime_budget: ProgramRuntimeBudget,
}

#[derive(Clone, Copy)]
pub(crate) struct CargoBuildEvidence<'a> {
    pub(crate) wasm_one: &'a [u8],
    pub(crate) wasm_two: &'a [u8],
    pub(crate) source_capsule: &'a [u8],
    pub(crate) build_recipe: &'a [u8],
    pub(crate) runtime_budget: ProgramRuntimeBudget,
}

#[derive(Clone, Copy)]
pub(crate) struct SandboxedCargoBuildEvidence<'a> {
    pub(crate) wasm_one: &'a [u8],
    pub(crate) wasm_two: &'a [u8],
    pub(crate) source_capsule: &'a [u8],
    pub(crate) build_recipe: &'a [u8],
    pub(crate) runtime_budget: ProgramRuntimeBudget,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct VerifiedCargoBuild {
    pub(crate) wasm: Box<[u8]>,
    pub(crate) source_capsule: Box<[u8]>,
    pub(crate) build_recipe: Box<[u8]>,
    pub(crate) profile: ProgramProfileV1,
    pub(crate) build_recipe_locator: &'static str,
}

#[derive(Clone, Copy)]
pub(crate) struct PluginCargoBuildEvidenceV2<'a> {
    pub(crate) wasm_one: &'a [u8],
    pub(crate) wasm_two: &'a [u8],
    pub(crate) implementation_capsule_digest: BindingDigest,
    pub(crate) source_entry_digest: BindingDigest,
    pub(crate) verified_build_receipt_digest: BindingDigest,
}

#[derive(Clone, Copy)]
pub(crate) struct PluginCargoBuildEvidenceV3<'a> {
    pub(crate) wasm_one: &'a [u8],
    pub(crate) wasm_two: &'a [u8],
    pub(crate) capsule_digest: BindingDigest,
    pub(crate) source_set_digest: BindingDigest,
    pub(crate) verified_build_receipt_digest: BindingDigest,
    pub(crate) max_wasm_bytes: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct VerifiedPluginCargoBuildV2 {
    plugin_semantic_id: String,
    manifest_digest: BindingDigest,
    wasm: Box<[u8]>,
    module_digest: BindingDigest,
    implementation_capsule_digest: BindingDigest,
    source_entry_digest: BindingDigest,
    verified_build_receipt_digest: BindingDigest,
}

/// Move-only proof that two reproducible ABI3 builds passed the strict module envelope.
pub(crate) struct VerifiedPluginCargoBuildV3 {
    plugin_semantic_id: String,
    manifest_digest: BindingDigest,
    wasm: Box<[u8]>,
    module_digest: BindingDigest,
    capsule_digest: BindingDigest,
    source_set_digest: BindingDigest,
    verified_build_receipt_digest: BindingDigest,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum CargoArtifactError {
    #[error("the two isolated Cargo builds produced different Wasm bytes")]
    NonReproducible,
    #[error("Cargo build evidence exceeds its frozen bound: {0}")]
    TooLarge(&'static str),
    #[error("Cargo build recipe is invalid: {0}")]
    Recipe(String),
    #[error("program runtime profile is invalid: {0}")]
    RuntimeProfile(String),
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct BuildRecipeV1 {
    build_platform: String,
    dependency_policy: String,
    dockerfile_sha256: String,
    frontend: String,
    manifest: String,
    network_policy: String,
    rust_image: String,
    schema_version: u32,
    target: String,
    wasm_target: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SandboxedBuildRecipeV2 {
    build_platform: String,
    dependency_policy: String,
    dockerfile_sha256: String,
    frontend: String,
    manifest: String,
    network_policy: String,
    rust_image: String,
    rustc_commit: String,
    rustc_release: String,
    sandbox_policy: String,
    schema_version: u32,
    target: String,
    wasm_target: String,
}

impl VerifiedCargoBuild {
    pub(crate) fn verify(evidence: CargoBuildEvidence<'_>) -> Result<Self, CargoArtifactError> {
        if evidence.wasm_one != evidence.wasm_two {
            return Err(CargoArtifactError::NonReproducible);
        }

        for (bytes, max, name) in [
            (
                evidence.source_capsule,
                MAX_SOURCE_CAPSULE_BYTES,
                "source capsule",
            ),
            (evidence.build_recipe, MAX_RECIPE_BYTES, "build recipe"),
        ] {
            if bytes.is_empty() || bytes.len() > max {
                return Err(CargoArtifactError::TooLarge(name));
            }
        }
        validate_recipe(evidence.build_recipe)?;
        validate_budget(evidence.runtime_budget)?;
        validate_candidate_for_artifact(evidence.wasm_one, evidence.runtime_budget)
            .map_err(|e| CargoArtifactError::RuntimeProfile(e.to_string()))?;

        let profile = ProgramProfileV1 {
            schema_version: PROFILE_SCHEMA_VERSION,
            sdk_abi_version: SDK_ABI_VERSION,
            runtime_budget: evidence.runtime_budget,
        };
        Ok(Self {
            wasm: evidence.wasm_one.into(),
            source_capsule: evidence.source_capsule.into(),
            build_recipe: evidence.build_recipe.into(),
            profile,
            build_recipe_locator: BUILD_RECIPE_LOCATOR,
        })
    }

    pub(crate) fn verify_sandboxed(
        evidence: SandboxedCargoBuildEvidence<'_>,
    ) -> Result<Self, CargoArtifactError> {
        if evidence.wasm_one != evidence.wasm_two {
            return Err(CargoArtifactError::NonReproducible);
        }

        for (bytes, max, name) in [
            (
                evidence.source_capsule,
                MAX_SOURCE_CAPSULE_BYTES,
                "source capsule",
            ),
            (evidence.build_recipe, MAX_RECIPE_BYTES, "build recipe"),
        ] {
            if bytes.is_empty() || bytes.len() > max {
                return Err(CargoArtifactError::TooLarge(name));
            }
        }
        validate_sandboxed_recipe(evidence.build_recipe)?;
        validate_budget(evidence.runtime_budget)?;
        validate_candidate_for_artifact(evidence.wasm_one, evidence.runtime_budget)
            .map_err(|e| CargoArtifactError::RuntimeProfile(e.to_string()))?;
        Ok(Self {
            wasm: evidence.wasm_one.into(),
            source_capsule: evidence.source_capsule.into(),
            build_recipe: evidence.build_recipe.into(),
            profile: ProgramProfileV1 {
                schema_version: PROFILE_SCHEMA_VERSION,
                sdk_abi_version: SDK_ABI_VERSION,
                runtime_budget: evidence.runtime_budget,
            },
            build_recipe_locator: SANDBOX_BUILD_RECIPE_LOCATOR,
        })
    }
}

impl VerifiedPluginCargoBuildV2 {
    pub(crate) fn verify(
        manifest: &PluginManifestV2,
        evidence: PluginCargoBuildEvidenceV2<'_>,
    ) -> Result<Self, CargoArtifactError> {
        if evidence.wasm_one != evidence.wasm_two {
            return Err(CargoArtifactError::NonReproducible);
        }
        let zero = BindingDigest::from_untrusted_bytes([0; 32]);

        if [
            evidence.implementation_capsule_digest,
            evidence.source_entry_digest,
            evidence.verified_build_receipt_digest,
        ]
        .contains(&zero)
        {
            return Err(CargoArtifactError::Recipe(
                "plugin build provenance digest is zero".to_owned(),
            ));
        }
        validate_plugin_candidate_v2(evidence.wasm_one, manifest)
            .map_err(|e| CargoArtifactError::RuntimeProfile(e.to_string()))?;
        Ok(Self {
            plugin_semantic_id: manifest.semantic_id.clone(),
            manifest_digest: plugin_manifest_digest(manifest),
            wasm: evidence.wasm_one.into(),
            module_digest: BindingDigest::from_untrusted_bytes(
                Sha256::digest(evidence.wasm_one).into(),
            ),
            implementation_capsule_digest: evidence.implementation_capsule_digest,
            source_entry_digest: evidence.source_entry_digest,
            verified_build_receipt_digest: evidence.verified_build_receipt_digest,
        })
    }

    pub(crate) fn plugin_semantic_id(&self) -> &str {
        &self.plugin_semantic_id
    }

    pub(crate) const fn manifest_digest(&self) -> BindingDigest {
        self.manifest_digest
    }

    pub(crate) fn wasm(&self) -> &[u8] {
        &self.wasm
    }

    pub(crate) const fn module_digest(&self) -> BindingDigest {
        self.module_digest
    }

    pub(crate) const fn implementation_capsule_digest(&self) -> BindingDigest {
        self.implementation_capsule_digest
    }

    pub(crate) const fn source_entry_digest(&self) -> BindingDigest {
        self.source_entry_digest
    }

    pub(crate) const fn verified_build_receipt_digest(&self) -> BindingDigest {
        self.verified_build_receipt_digest
    }

    pub(crate) fn into_wasm(self) -> Box<[u8]> {
        self.wasm
    }

    #[cfg(test)]
    pub(crate) fn corrupt_wasm_for_test(&mut self) {
        self.wasm[0] ^= 1;
    }

    #[cfg(test)]
    pub(crate) fn corrupt_source_entry_digest_for_test(&mut self) {
        self.source_entry_digest = BindingDigest::from_untrusted_bytes([199; 32]);
    }
}

impl VerifiedPluginCargoBuildV3 {
    pub(crate) fn verify(
        manifest: &PluginManifestV2,
        evidence: PluginCargoBuildEvidenceV3<'_>,
    ) -> Result<Self, CargoArtifactError> {
        if evidence.wasm_one != evidence.wasm_two {
            return Err(CargoArtifactError::NonReproducible);
        }
        let zero = BindingDigest::from_untrusted_bytes([0; 32]);

        if [
            evidence.capsule_digest,
            evidence.source_set_digest,
            evidence.verified_build_receipt_digest,
        ]
        .contains(&zero)
        {
            return Err(CargoArtifactError::Recipe(
                "ABI3 plugin build provenance digest is zero".to_owned(),
            ));
        }
        validate_plugin_candidate_v3(evidence.wasm_one, manifest, evidence.max_wasm_bytes)
            .map_err(|e| CargoArtifactError::RuntimeProfile(e.to_string()))?;
        Ok(Self {
            plugin_semantic_id: manifest.semantic_id.clone(),
            manifest_digest: plugin_manifest_digest(manifest),
            wasm: evidence.wasm_one.into(),
            module_digest: BindingDigest::from_untrusted_bytes(
                Sha256::digest(evidence.wasm_one).into(),
            ),
            capsule_digest: evidence.capsule_digest,
            source_set_digest: evidence.source_set_digest,
            verified_build_receipt_digest: evidence.verified_build_receipt_digest,
        })
    }

    pub(crate) fn plugin_semantic_id(&self) -> &str {
        &self.plugin_semantic_id
    }

    pub(crate) const fn manifest_digest(&self) -> BindingDigest {
        self.manifest_digest
    }

    pub(crate) fn wasm(&self) -> &[u8] {
        &self.wasm
    }

    pub(crate) const fn module_digest(&self) -> BindingDigest {
        self.module_digest
    }

    pub(crate) const fn capsule_digest(&self) -> BindingDigest {
        self.capsule_digest
    }

    pub(crate) const fn source_set_digest(&self) -> BindingDigest {
        self.source_set_digest
    }

    pub(crate) const fn verified_build_receipt_digest(&self) -> BindingDigest {
        self.verified_build_receipt_digest
    }

    pub(crate) fn into_wasm(self) -> Box<[u8]> {
        self.wasm
    }
}

fn validate_recipe(bytes: &[u8]) -> Result<BuildRecipeV1, CargoArtifactError> {
    let recipe: BuildRecipeV1 =
        serde_json::from_slice(bytes).map_err(|e| CargoArtifactError::Recipe(e.to_string()))?;
    let mut canonical =
        serde_json::to_vec(&recipe).map_err(|e| CargoArtifactError::Recipe(e.to_string()))?;
    canonical.push(b'\n');
    let manifest = Path::new(&recipe.manifest);
    let safe_manifest = !manifest.is_absolute()
        && manifest
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
        && manifest
            .file_name()
            .is_some_and(|name| name == "Cargo.toml");
    let valid = bytes == canonical
        && recipe.schema_version == 1
        && recipe.dependency_policy == "cargo_vendor_locked_versioned_dirs"
        && recipe.network_policy == "vendor_only_builds_network_none"
        && recipe.frontend == FRONTEND
        && recipe.rust_image == RUST_IMAGE
        && recipe.target == TARGET
        && recipe.build_platform == BUILD_PLATFORM
        && recipe.dockerfile_sha256 == sha256(PROGRAM_SEAL_DOCKERFILE.as_bytes())
        && !recipe.wasm_target.is_empty()
        && recipe
            .wasm_target
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        && safe_manifest;

    valid.then_some(recipe).ok_or_else(|| {
        CargoArtifactError::Recipe(
            "recipe is noncanonical or outside the frozen seal policy".to_string(),
        )
    })
}

fn validate_sandboxed_recipe(bytes: &[u8]) -> Result<SandboxedBuildRecipeV2, CargoArtifactError> {
    let recipe: SandboxedBuildRecipeV2 =
        serde_json::from_slice(bytes).map_err(|e| CargoArtifactError::Recipe(e.to_string()))?;
    let mut canonical =
        serde_json::to_vec(&recipe).map_err(|e| CargoArtifactError::Recipe(e.to_string()))?;
    canonical.push(b'\n');
    let valid = bytes == canonical
        && recipe.schema_version == 2
        && recipe.build_platform == BUILD_PLATFORM
        && recipe.dependency_policy == "locked_no_external_dependencies"
        && recipe.dockerfile_sha256 == sha256(RD_SANDBOX_DOCKERFILE.as_bytes())
        && recipe.frontend == FRONTEND
        && recipe.manifest == "Cargo.toml"
        && recipe.network_policy == "container_network_none_cargo_offline"
        && recipe.rust_image == RUST_IMAGE
        && recipe.rustc_release == RUSTC_RELEASE
        && recipe.rustc_commit == RUSTC_COMMIT
        && recipe.sandbox_policy == SANDBOX_POLICY_V1
        && recipe.target == TARGET
        && recipe.wasm_target == "rd_generated_strategy";
    valid.then_some(recipe).ok_or_else(|| {
        CargoArtifactError::Recipe(
            "recipe is noncanonical or outside the frozen sandbox policy".to_string(),
        )
    })
}

fn validate_budget(budget: ProgramRuntimeBudget) -> Result<(), CargoArtifactError> {
    let valid = budget.max_module_bytes > 0
        && budget.max_module_bytes <= 64 * 1024
        && budget.fuel > 0
        && budget.fuel <= MAX_FUEL;

    valid.then_some(()).ok_or_else(|| {
        CargoArtifactError::RuntimeProfile("budget exceeds the host profile".to_string())
    })
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    use crate::strategy_design_v2::{PluginStateContractV2, PortContractV2, ValueTypeV2};

    fn plugin_manifest(abi_version: u16) -> PluginManifestV2 {
        PluginManifestV2 {
            semantic_id: format!("test.plugin.cargo-artifact.abi{abi_version}"),
            abi_version,
            input_ports: vec![PortContractV2 {
                semantic_id: "test.input.v1".to_owned(),
                value_type: ValueTypeV2::I64,
                max_bytes: 8,
            }],
            output_ports: vec![PortContractV2 {
                semantic_id: "test.output.v1".to_owned(),
                value_type: ValueTypeV2::I64,
                max_bytes: 8,
            }],
            state: PluginStateContractV2 {
                pre_port_id: "test.state.pre.v1".to_owned(),
                post_port_id: "test.state.post.v1".to_owned(),
                value_type: ValueTypeV2::Bytes,
                max_bytes: 8,
            },
            capability_ids: vec![],
            max_fuel: 10_000,
            max_linear_memory_bytes: 65_536,
            max_invocations_per_event: 1,
            failure_semantic_id: "strategy.plugin.failure.unsupported.v1".to_owned(),
        }
    }

    fn plugin_module(output_capacity: i32, float_type: bool) -> Vec<u8> {
        let mut wasm = b"\0asm\x01\0\0\0".to_vec();
        let mut types = vec![2 + u8::from(float_type)];
        types.extend([0x60, 0, 1, 0x7f, 0x60, 1, 0x7f, 1, 0x7f]);
        if float_type {
            types.extend([0x60, 1, 0x7d, 0]);
        }
        section(&mut wasm, 1, &types);

        let mut functions = vec![5 + u8::from(float_type), 0, 0, 0, 0, 1];
        if float_type {
            functions.push(2);
        }
        section(&mut wasm, 3, &functions);
        section(&mut wasm, 5, &[1, 1, 1, 1]);

        let mut exports = vec![6];
        export(&mut exports, "memory", 2, 0);

        for (name, index) in [
            ("strategy_factory_plugin_input_ptr_v2", 0),
            ("strategy_factory_plugin_input_capacity_v2", 1),
            ("strategy_factory_plugin_output_ptr_v2", 2),
            ("strategy_factory_plugin_output_capacity_v2", 3),
            ("strategy_factory_plugin_invoke_v2", 4),
        ] {
            export(&mut exports, name, 0, index);
        }
        section(&mut wasm, 7, &exports);

        let mut code = vec![5 + u8::from(float_type)];
        for value in [1024, 128, 8192, output_capacity, 0] {
            function_body(&mut code, &i32_const(value));
        }

        if float_type {
            function_body(&mut code, &[]);
        }
        section(&mut wasm, 10, &code);
        wasm
    }

    fn plugin_v3_evidence(wasm: &[u8]) -> PluginCargoBuildEvidenceV3<'_> {
        PluginCargoBuildEvidenceV3 {
            wasm_one: wasm,
            wasm_two: wasm,
            capsule_digest: BindingDigest::from_untrusted_bytes([11; 32]),
            source_set_digest: BindingDigest::from_untrusted_bytes([12; 32]),
            verified_build_receipt_digest: BindingDigest::from_untrusted_bytes([13; 32]),
            max_wasm_bytes: wasm.len() as u32,
        }
    }

    fn section(wasm: &mut Vec<u8>, id: u8, payload: &[u8]) {
        wasm.push(id);
        u32_leb(wasm, payload.len() as u32);
        wasm.extend(payload);
    }

    fn export(bytes: &mut Vec<u8>, export_name: &str, kind: u8, index: u32) {
        u32_leb(bytes, export_name.len() as u32);
        bytes.extend(export_name.as_bytes());
        bytes.push(kind);
        u32_leb(bytes, index);
    }

    fn function_body(code: &mut Vec<u8>, operators: &[u8]) {
        let mut body = vec![0];
        body.extend(operators);
        body.push(0x0b);
        u32_leb(code, body.len() as u32);
        code.extend(body);
    }

    fn i32_const(value: i32) -> Vec<u8> {
        let mut bytes = vec![0x41];
        let mut value = value;
        loop {
            let byte = value as u8 & 0x7f;
            value >>= 7;
            let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
            bytes.push(if done { byte } else { byte | 0x80 });
            if done {
                return bytes;
            }
        }
    }

    fn u32_leb(bytes: &mut Vec<u8>, mut value: u32) {
        loop {
            let byte = value as u8 & 0x7f;
            value >>= 7;
            bytes.push(if value == 0 { byte } else { byte | 0x80 });
            if value == 0 {
                return;
            }
        }
    }

    fn sandbox_recipe() -> Vec<u8> {
        let mut bytes = serde_json::to_vec(&SandboxedBuildRecipeV2 {
            build_platform: BUILD_PLATFORM.to_string(),
            dependency_policy: "locked_no_external_dependencies".to_string(),
            dockerfile_sha256: sha256(RD_SANDBOX_DOCKERFILE.as_bytes()),
            frontend: FRONTEND.to_string(),
            manifest: "Cargo.toml".to_string(),
            network_policy: "container_network_none_cargo_offline".to_string(),
            rust_image: RUST_IMAGE.to_string(),
            rustc_commit: RUSTC_COMMIT.to_string(),
            rustc_release: RUSTC_RELEASE.to_string(),
            sandbox_policy: SANDBOX_POLICY_V1.to_string(),
            schema_version: 2,
            target: TARGET.to_string(),
            wasm_target: "rd_generated_strategy".to_string(),
        })
        .unwrap();
        bytes.push(b'\n');
        bytes
    }

    #[rstest]
    fn sandbox_recipe_binds_image_toolchain_and_dockerfile() {
        assert!(validate_sandboxed_recipe(&sandbox_recipe()).is_ok());
        for needle in [RUST_IMAGE, RUSTC_COMMIT, FRONTEND] {
            let tampered = String::from_utf8(sandbox_recipe())
                .unwrap()
                .replace(needle, "tampered");
            assert!(validate_sandboxed_recipe(tampered.as_bytes()).is_err());
        }
    }

    #[rstest]
    fn sandbox_build_rejects_wasm_tamper_nonreproducibility_and_budget() {
        let build = crate::family_adapters::verified_price_build().unwrap();
        let valid = SandboxedCargoBuildEvidence {
            wasm_one: &build.wasm,
            wasm_two: &build.wasm,
            source_capsule: b"bounded capsule",
            build_recipe: &sandbox_recipe(),
            runtime_budget: ProgramRuntimeBudget {
                max_module_bytes: 64 * 1024,
                fuel: 1_000_000,
            },
        };
        assert!(VerifiedCargoBuild::verify_sandboxed(valid).is_ok());

        let mut different = build.wasm.to_vec();
        different.push(0);
        assert_eq!(
            VerifiedCargoBuild::verify_sandboxed(SandboxedCargoBuildEvidence {
                wasm_two: &different,
                ..valid
            }),
            Err(CargoArtifactError::NonReproducible)
        );

        let mut tampered = build.wasm.to_vec();
        tampered[0] ^= 1;
        assert!(matches!(
            VerifiedCargoBuild::verify_sandboxed(SandboxedCargoBuildEvidence {
                wasm_one: &tampered,
                wasm_two: &tampered,
                ..valid
            }),
            Err(CargoArtifactError::RuntimeProfile(_))
        ));

        assert!(matches!(
            VerifiedCargoBuild::verify_sandboxed(SandboxedCargoBuildEvidence {
                runtime_budget: ProgramRuntimeBudget {
                    max_module_bytes: 64 * 1024,
                    fuel: 0,
                },
                ..valid
            }),
            Err(CargoArtifactError::RuntimeProfile(_))
        ));
    }

    #[rstest]
    fn abi_three_cargo_artifact_binds_identity_provenance_and_wasm() {
        let manifest = plugin_manifest(3);
        let wasm = plugin_module(129, false);
        let evidence = plugin_v3_evidence(&wasm);
        let verified = VerifiedPluginCargoBuildV3::verify(&manifest, evidence).unwrap();

        assert_eq!(verified.plugin_semantic_id(), manifest.semantic_id);
        assert_eq!(
            verified.manifest_digest(),
            plugin_manifest_digest(&manifest)
        );
        assert_eq!(verified.wasm(), wasm);
        assert_eq!(
            verified.module_digest(),
            BindingDigest::from_untrusted_bytes(Sha256::digest(&wasm).into())
        );
        assert_eq!(verified.capsule_digest(), evidence.capsule_digest);
        assert_eq!(verified.source_set_digest(), evidence.source_set_digest);
        assert_eq!(
            verified.verified_build_receipt_digest(),
            evidence.verified_build_receipt_digest
        );
        assert_eq!(verified.into_wasm().as_ref(), wasm);
    }

    #[rstest]
    fn abi_three_cargo_artifact_rejects_abi_two_float_and_invalid_modules() {
        let wasm = plugin_module(129, false);
        assert!(matches!(
            VerifiedPluginCargoBuildV3::verify(&plugin_manifest(2), plugin_v3_evidence(&wasm)),
            Err(CargoArtifactError::RuntimeProfile(_))
        ));

        let float_wasm = plugin_module(129, true);
        assert!(matches!(
            VerifiedPluginCargoBuildV3::verify(
                &plugin_manifest(3),
                plugin_v3_evidence(&float_wasm)
            ),
            Err(CargoArtifactError::RuntimeProfile(_))
        ));

        let invalid = b"not wasm";
        assert!(matches!(
            VerifiedPluginCargoBuildV3::verify(&plugin_manifest(3), plugin_v3_evidence(invalid)),
            Err(CargoArtifactError::RuntimeProfile(_))
        ));
    }

    #[rstest]
    fn abi_three_cargo_artifact_rejects_budget_provenance_and_nonreproducibility() {
        let manifest = plugin_manifest(3);
        let wasm = plugin_module(129, false);
        let valid = plugin_v3_evidence(&wasm);

        assert!(matches!(
            VerifiedPluginCargoBuildV3::verify(
                &manifest,
                PluginCargoBuildEvidenceV3 {
                    max_wasm_bytes: (wasm.len() - 1) as u32,
                    ..valid
                }
            ),
            Err(CargoArtifactError::RuntimeProfile(_))
        ));

        for evidence in [
            PluginCargoBuildEvidenceV3 {
                capsule_digest: BindingDigest::from_untrusted_bytes([0; 32]),
                ..valid
            },
            PluginCargoBuildEvidenceV3 {
                source_set_digest: BindingDigest::from_untrusted_bytes([0; 32]),
                ..valid
            },
            PluginCargoBuildEvidenceV3 {
                verified_build_receipt_digest: BindingDigest::from_untrusted_bytes([0; 32]),
                ..valid
            },
        ] {
            assert!(matches!(
                VerifiedPluginCargoBuildV3::verify(&manifest, evidence),
                Err(CargoArtifactError::Recipe(_))
            ));
        }

        let mut different = wasm.clone();
        different.push(0);
        assert!(matches!(
            VerifiedPluginCargoBuildV3::verify(
                &manifest,
                PluginCargoBuildEvidenceV3 {
                    wasm_two: &different,
                    ..valid
                }
            ),
            Err(CargoArtifactError::NonReproducible)
        ));
    }

    #[rstest]
    fn legacy_plugin_cargo_artifact_still_accepts_abi_two() {
        let manifest = plugin_manifest(2);
        let wasm = plugin_module(128, false);
        let evidence = PluginCargoBuildEvidenceV2 {
            wasm_one: &wasm,
            wasm_two: &wasm,
            implementation_capsule_digest: BindingDigest::from_untrusted_bytes([21; 32]),
            source_entry_digest: BindingDigest::from_untrusted_bytes([22; 32]),
            verified_build_receipt_digest: BindingDigest::from_untrusted_bytes([23; 32]),
        };
        assert!(VerifiedPluginCargoBuildV2::verify(&manifest, evidence).is_ok());
    }
}
