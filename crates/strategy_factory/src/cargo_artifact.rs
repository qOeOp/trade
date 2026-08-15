use std::path::{Component, Path};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::program_runtime::{ProgramRuntimeBudget, validate_candidate_for_artifact};

const PROFILE_SCHEMA_VERSION: u32 = 1;
const SDK_ABI_VERSION: u32 = 3;
pub(crate) const TARGET: &str = "wasm32v1-none";
const BUILD_PLATFORM: &str = "linux/arm64";
pub(crate) const RUSTC_RELEASE: &str = "1.97.1";
pub(crate) const RUSTC_COMMIT: &str = "8bab26f4f68e0e26f0bb7960be334d5b520ea452";
const FRONTEND: &str = "docker/dockerfile:1.20@sha256:26147acbda4f14c5add9946e2fd2ed543fc402884fd75146bd342a7f6271dc1d";
const RUST_IMAGE: &str = "public.ecr.aws/docker/library/rust:1.97.1-slim-bookworm@sha256:99e09cb2284e2ddbb73a995deee3e91783fd04d177602ccf6eab326d778ee777";
pub(crate) const BUILD_RECIPE_LOCATOR: &str = "program-build-recipe-v1.jcs";
pub(crate) const SOURCE_CAPSULE_LOCATOR: &str = "program-source-capsule-v1.tar";
pub(crate) const PROGRAM_SEAL_DOCKERFILE: &str = include_str!("../tools/program-seal.dockerfile");
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct VerifiedCargoBuild {
    pub(crate) wasm: Box<[u8]>,
    pub(crate) source_capsule: Box<[u8]>,
    pub(crate) build_recipe: Box<[u8]>,
    pub(crate) profile: ProgramProfileV1,
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
        })
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
