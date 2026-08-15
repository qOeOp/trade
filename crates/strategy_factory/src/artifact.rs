use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::cargo_artifact::{
    BUILD_RECIPE_LOCATOR, ProgramProfileV1, RUSTC_COMMIT, RUSTC_RELEASE, SOURCE_CAPSULE_LOCATOR,
    TARGET, VerifiedCargoBuild,
};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct StrategyProgramProfileIdentity {
    pub schema_version: u32,
    pub profile_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct StrategyArtifactIdentity {
    pub schema_version: u32,
    pub intent_digest: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trial_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters_digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strategy_spec_digest: Option<String>,
    pub wasm_digest: String,
    pub guest_source_locator: String,
    pub guest_source_digest: String,
    pub build_recipe_locator: String,
    pub build_recipe_digest: String,
    pub rustc_release: String,
    pub rustc_commit: String,
    pub target: String,
    pub program_profile: StrategyProgramProfileIdentity,
    pub artifact_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StrategyArtifact {
    identity: StrategyArtifactIdentity,
    wasm: Box<[u8]>,
    profile: Box<ProgramProfileV1>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ArtifactError {
    #[error("artifact identity serialization failed: {0}")]
    Identity(String),
    #[error("artifact binding mismatch")]
    Binding,
}

#[derive(Clone, Serialize)]
struct ArtifactIdentitySeed<'a> {
    schema_version: u32,
    intent_digest: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    strategy_spec_digest: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trial_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    parameters_digest: Option<&'a str>,
    wasm_digest: &'a str,
    guest_source_locator: &'a str,
    guest_source_digest: &'a str,
    build_recipe_locator: &'a str,
    build_recipe_digest: &'a str,
    rustc_release: &'a str,
    rustc_commit: &'a str,
    target: &'a str,
    program_profile: &'a StrategyProgramProfileIdentity,
}

/// Shape-neutral, already-validated material presented to the sole Artifact owner.
pub(crate) struct ArtifactIssuance<'a> {
    schema_version: u32,
    intent_bytes: &'a [u8],
    strategy_spec_digest: Option<String>,
    trial_id: Option<String>,
    parameters: Option<Vec<u8>>,
    build: &'a VerifiedCargoBuild,
}

impl<'a> ArtifactIssuance<'a> {
    pub(crate) fn program(
        schema_version: u32,
        intent_bytes: &'a [u8],
        strategy_spec_digest: Option<String>,
        trial_id: Option<String>,
        parameters: Option<Vec<u8>>,
        build: &'a VerifiedCargoBuild,
    ) -> Self {
        Self {
            schema_version,
            intent_bytes,
            strategy_spec_digest,
            trial_id,
            parameters,
            build,
        }
    }

    pub(crate) fn intent_digest(&self) -> String {
        digest(self.intent_bytes)
    }

    pub(crate) fn trial_id(&self) -> Option<&str> {
        self.trial_id.as_deref()
    }

    pub(crate) fn parameters_digest(&self) -> Option<String> {
        self.parameters.as_deref().map(digest)
    }

    pub(crate) fn strategy_spec_digest(&self) -> Option<&str> {
        self.strategy_spec_digest.as_deref()
    }
}

impl StrategyArtifactIdentity {
    pub fn to_bytes(&self) -> Result<Vec<u8>, ArtifactError> {
        let value =
            serde_json::to_value(self).map_err(|e| ArtifactError::Identity(e.to_string()))?;
        let mut bytes =
            serde_json::to_vec(&value).map_err(|e| ArtifactError::Identity(e.to_string()))?;
        bytes.push(b'\n');
        Ok(bytes)
    }
}

impl StrategyArtifact {
    pub(crate) fn issue(issuance: &ArtifactIssuance<'_>) -> Result<Self, ArtifactError> {
        let intent_digest = digest(issuance.intent_bytes);
        let parameters_digest = issuance.parameters.as_deref().map(digest);
        let wasm_digest = digest(&issuance.build.wasm);
        let guest_source_digest = digest(&issuance.build.source_capsule);
        let build_recipe_digest = digest(&issuance.build.build_recipe);
        let program_profile = StrategyProgramProfileIdentity {
            schema_version: issuance.build.profile.schema_version,
            profile_digest: digest(
                &serde_json::to_vec(&issuance.build.profile)
                    .map_err(|e| ArtifactError::Identity(e.to_string()))?,
            ),
        };
        let seed = ArtifactIdentitySeed {
            schema_version: issuance.schema_version,
            intent_digest: &intent_digest,
            strategy_spec_digest: issuance.strategy_spec_digest.as_deref(),
            trial_id: issuance.trial_id.as_deref(),
            parameters_digest: parameters_digest.as_deref(),
            wasm_digest: &wasm_digest,
            guest_source_locator: SOURCE_CAPSULE_LOCATOR,
            guest_source_digest: &guest_source_digest,
            build_recipe_locator: BUILD_RECIPE_LOCATOR,
            build_recipe_digest: &build_recipe_digest,
            rustc_release: RUSTC_RELEASE,
            rustc_commit: RUSTC_COMMIT,
            target: TARGET,
            program_profile: &program_profile,
        };
        let artifact_digest =
            digest(&serde_json::to_vec(&seed).map_err(|e| ArtifactError::Identity(e.to_string()))?);
        Ok(Self {
            identity: StrategyArtifactIdentity {
                schema_version: issuance.schema_version,
                intent_digest,
                trial_id: issuance.trial_id.clone(),
                parameters_digest,
                strategy_spec_digest: issuance.strategy_spec_digest.clone(),
                wasm_digest,
                guest_source_locator: SOURCE_CAPSULE_LOCATOR.to_string(),
                guest_source_digest,
                build_recipe_locator: BUILD_RECIPE_LOCATOR.to_string(),
                build_recipe_digest,
                rustc_release: RUSTC_RELEASE.to_string(),
                rustc_commit: RUSTC_COMMIT.to_string(),
                target: TARGET.to_string(),
                program_profile,
                artifact_digest,
            },
            wasm: issuance.build.wasm.clone(),
            profile: Box::new(issuance.build.profile.clone()),
        })
    }

    pub const fn identity(&self) -> &StrategyArtifactIdentity {
        &self.identity
    }

    pub fn wasm(&self) -> &[u8] {
        &self.wasm
    }

    pub(crate) fn program_profile(&self) -> &ProgramProfileV1 {
        &self.profile
    }

    pub(crate) fn verify_parameters(&self, parameters: &[u8]) -> Result<(), ArtifactError> {
        if self.identity.parameters_digest.as_deref() != Some(digest(parameters).as_str()) {
            return Err(ArtifactError::Binding);
        }
        Ok(())
    }
}

pub(crate) fn digest(bytes: &[u8]) -> String {
    format!("blake3:{}", blake3::hash(bytes).to_hex())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn issuance() -> ArtifactIssuance<'static> {
        ArtifactIssuance::program(
            1,
            b"{\"intent\":\"shape-neutral\"}",
            Some("blake3:spec".to_string()),
            Some("parameter/full".to_string()),
            Some(b"frozen-parameters".to_vec()),
            crate::pilot::verified_pilot_build().expect("sealed pilot build"),
        )
    }

    #[rstest]
    fn shape_neutral_artifact_issuance_is_deterministic() {
        let first = StrategyArtifact::issue(&issuance()).expect("first artifact");
        let second = StrategyArtifact::issue(&issuance()).expect("second artifact");
        let bytes = first.identity().to_bytes().expect("identity bytes");
        assert_eq!(bytes.last(), Some(&b'\n'));
        assert_eq!(
            serde_json::from_slice::<StrategyArtifactIdentity>(&bytes).unwrap(),
            *first.identity()
        );
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let mut expected = serde_json::to_vec(&value).unwrap();
        expected.push(b'\n');
        assert_eq!(bytes, expected);
        assert_eq!(first, second);
        assert_eq!(first.wasm(), issuance().build.wasm.as_ref());
        assert_eq!(first.identity().trial_id.as_deref(), Some("parameter/full"));
        assert!(first.identity().parameters_digest.is_some());
        assert_eq!(first.identity().program_profile.schema_version, 1);
        assert!(first.identity().artifact_digest.starts_with("blake3:"));
    }

    #[rstest]
    fn artifact_identity_binds_content_provenance_toolchain_target_and_abi() {
        let artifact = StrategyArtifact::issue(&issuance()).expect("artifact");

        let mutations: [fn(&mut StrategyArtifactIdentity); 12] = [
            |identity: &mut StrategyArtifactIdentity| identity.schema_version += 1,
            |identity: &mut StrategyArtifactIdentity| identity.intent_digest.push_str("_extra"),
            |identity: &mut StrategyArtifactIdentity| identity.wasm_digest.push_str("_extra"),
            |identity: &mut StrategyArtifactIdentity| {
                identity.guest_source_locator.push_str("_extra");
            },
            |identity: &mut StrategyArtifactIdentity| {
                identity.guest_source_digest.push_str("_extra");
            },
            |identity: &mut StrategyArtifactIdentity| {
                identity.build_recipe_locator.push_str("_extra");
            },
            |identity: &mut StrategyArtifactIdentity| {
                identity.build_recipe_digest.push_str("_extra");
            },
            |identity: &mut StrategyArtifactIdentity| identity.rustc_release.push_str("_extra"),
            |identity: &mut StrategyArtifactIdentity| identity.rustc_commit.push_str("_extra"),
            |identity: &mut StrategyArtifactIdentity| identity.target.push_str("_extra"),
            |identity: &mut StrategyArtifactIdentity| {
                identity.program_profile.profile_digest.push_str("_extra");
            },
            |identity: &mut StrategyArtifactIdentity| identity.artifact_digest.push_str("_extra"),
        ];

        for mutate in mutations {
            let mut tampered = artifact.clone();
            mutate(&mut tampered.identity);
            assert_ne!(tampered, StrategyArtifact::issue(&issuance()).unwrap());
        }

        assert_eq!(artifact.identity().schema_version, 1);
        assert_eq!(
            artifact.identity().strategy_spec_digest.as_deref(),
            Some("blake3:spec")
        );
    }

    #[rstest]
    fn artifact_digest_seed_changes_with_source_or_build_recipe_provenance() {
        let artifact = StrategyArtifact::issue(&issuance()).expect("artifact");
        let identity = artifact.identity();
        let seed = ArtifactIdentitySeed {
            schema_version: identity.schema_version,
            intent_digest: &identity.intent_digest,
            strategy_spec_digest: identity.strategy_spec_digest.as_deref(),
            trial_id: identity.trial_id.as_deref(),
            parameters_digest: identity.parameters_digest.as_deref(),
            wasm_digest: &identity.wasm_digest,
            guest_source_locator: &identity.guest_source_locator,
            guest_source_digest: &identity.guest_source_digest,
            build_recipe_locator: &identity.build_recipe_locator,
            build_recipe_digest: &identity.build_recipe_digest,
            rustc_release: &identity.rustc_release,
            rustc_commit: &identity.rustc_commit,
            target: &identity.target,
            program_profile: &identity.program_profile,
        };
        let seed_bytes = serde_json::to_vec(&seed).expect("serialize identity seed");
        assert_eq!(identity.artifact_digest, digest(&seed_bytes));

        let changed_source_digest = format!("{}_changed", identity.guest_source_digest);
        let mut changed_source = seed.clone();
        changed_source.guest_source_digest = &changed_source_digest;
        assert_ne!(
            digest(&serde_json::to_vec(&changed_source).expect("serialize changed source seed")),
            identity.artifact_digest
        );

        let changed_recipe_digest = format!("{}_changed", identity.build_recipe_digest);
        let mut changed_recipe = seed;
        changed_recipe.build_recipe_digest = &changed_recipe_digest;
        assert_ne!(
            digest(&serde_json::to_vec(&changed_recipe).expect("serialize changed recipe seed")),
            identity.artifact_digest
        );
    }
}
