use serde::Serialize;
use thiserror::Error;

use crate::{
    decision::{
        CoreWasmValueType, DECISION_ABI_VERSION, DECISION_EXPORT, DECISION_SIGNATURE,
        DecisionContract, DecisionError,
    },
    intent::{IntentError, ResearchIntent},
};

pub const MAX_ARTIFACT_WASM_BYTES: usize = 4_096;
pub const GUEST_RUSTC_RELEASE: &str = env!("STRATEGY_FACTORY_GUEST_RUSTC_RELEASE");
pub const GUEST_RUSTC_COMMIT: &str = env!("STRATEGY_FACTORY_GUEST_RUSTC_COMMIT");
pub const GUEST_TARGET: &str = env!("STRATEGY_FACTORY_GUEST_TARGET");
pub const GUEST_SOURCE_LOCATOR: &str = "crates/strategy_factory/guest/pilot.rs";
pub const BUILD_RECIPE_LOCATOR: &str = "crates/strategy_factory/build.rs";

const RESTRICTED_WASM: &[u8] = include_bytes!(concat!(
    env!("OUT_DIR"),
    "/strategy_factory_pilot.first.wasm"
));
const GUEST_SOURCE: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/guest/pilot.rs"));
const BUILD_RECIPE: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/build.rs"));
#[cfg(test)]
const REPEATED_BUILD_WASM: &[u8] = include_bytes!(concat!(
    env!("OUT_DIR"),
    "/strategy_factory_pilot.second.wasm"
));

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StrategyArtifactIdentity {
    pub schema_version: u32,
    pub intent_digest: String,
    pub wasm_digest: String,
    pub guest_source_locator: String,
    pub guest_source_digest: String,
    pub build_recipe_locator: String,
    pub build_recipe_digest: String,
    pub rustc_release: String,
    pub rustc_commit: String,
    pub target: String,
    pub decision_abi_version: u32,
    pub decision_export: String,
    pub decision_signature: String,
    pub artifact_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StrategyArtifact {
    identity: StrategyArtifactIdentity,
    wasm: Box<[u8]>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ArtifactError {
    #[error(transparent)]
    Intent(#[from] IntentError),
    #[error(transparent)]
    Decision(#[from] DecisionError),
    #[error("artifact exceeds the frozen {MAX_ARTIFACT_WASM_BYTES}-byte bound")]
    TooLarge,
    #[error("artifact identity serialization failed: {0}")]
    Identity(String),
    #[error("artifact binding mismatch")]
    Binding,
}

#[derive(Clone, Serialize)]
struct ArtifactIdentitySeed<'a> {
    schema_version: u32,
    intent_digest: &'a str,
    wasm_digest: &'a str,
    guest_source_locator: &'a str,
    guest_source_digest: &'a str,
    build_recipe_locator: &'a str,
    build_recipe_digest: &'a str,
    rustc_release: &'a str,
    rustc_commit: &'a str,
    target: &'a str,
    decision_abi_version: u32,
    decision_export: &'a str,
    decision_signature: &'a str,
}

impl StrategyArtifact {
    pub fn issue(
        intent: &ResearchIntent,
        contract: &DecisionContract,
    ) -> Result<Self, ArtifactError> {
        intent.validate_frozen_binding()?;
        let expected_contract = DecisionContract::for_intent(intent)?;
        if contract != &expected_contract {
            return Err(ArtifactError::Binding);
        }
        contract.validate_abi(DECISION_ABI_VERSION, DECISION_EXPORT, &DECISION_SIGNATURE)?;

        if RESTRICTED_WASM.len() > MAX_ARTIFACT_WASM_BYTES {
            return Err(ArtifactError::TooLarge);
        }

        let intent_digest = digest(intent.canonical_bytes());
        let wasm_digest = digest(RESTRICTED_WASM);
        let guest_source_digest = digest(GUEST_SOURCE);
        let build_recipe_digest = digest(BUILD_RECIPE);
        let decision_signature = signature_identity(contract);
        let identity_seed = {
            let seed = ArtifactIdentitySeed {
                schema_version: 3,
                intent_digest: &intent_digest,
                wasm_digest: &wasm_digest,
                guest_source_locator: GUEST_SOURCE_LOCATOR,
                guest_source_digest: &guest_source_digest,
                build_recipe_locator: BUILD_RECIPE_LOCATOR,
                build_recipe_digest: &build_recipe_digest,
                rustc_release: GUEST_RUSTC_RELEASE,
                rustc_commit: GUEST_RUSTC_COMMIT,
                target: GUEST_TARGET,
                decision_abi_version: contract.version(),
                decision_export: contract.export(),
                decision_signature: &decision_signature,
            };
            serde_json::to_vec(&seed).map_err(|e| ArtifactError::Identity(e.to_string()))?
        };
        let identity = StrategyArtifactIdentity {
            schema_version: 3,
            intent_digest,
            wasm_digest,
            guest_source_locator: GUEST_SOURCE_LOCATOR.to_string(),
            guest_source_digest,
            build_recipe_locator: BUILD_RECIPE_LOCATOR.to_string(),
            build_recipe_digest,
            rustc_release: GUEST_RUSTC_RELEASE.to_string(),
            rustc_commit: GUEST_RUSTC_COMMIT.to_string(),
            target: GUEST_TARGET.to_string(),
            decision_abi_version: contract.version(),
            decision_export: contract.export().to_string(),
            decision_signature,
            artifact_digest: digest(&identity_seed),
        };
        Ok(Self {
            identity,
            wasm: RESTRICTED_WASM.into(),
        })
    }

    pub fn verify_binding(
        &self,
        intent: &ResearchIntent,
        contract: &DecisionContract,
    ) -> Result<(), ArtifactError> {
        let expected = Self::issue(intent, contract)?;
        if self != &expected {
            return Err(ArtifactError::Binding);
        }
        Ok(())
    }

    pub const fn identity(&self) -> &StrategyArtifactIdentity {
        &self.identity
    }

    pub fn wasm(&self) -> &[u8] {
        &self.wasm
    }
}

fn signature_identity(contract: &DecisionContract) -> String {
    let parameters = contract
        .signature()
        .parameters()
        .iter()
        .map(value_type_name)
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "({parameters})->{}",
        value_type_name(&contract.signature().result())
    )
}

const fn value_type_name(value_type: &CoreWasmValueType) -> &'static str {
    match value_type {
        CoreWasmValueType::I32 => "i32",
        CoreWasmValueType::F64 => "f64",
    }
}

fn digest(bytes: &[u8]) -> String {
    format!("blake3:{}", blake3::hash(bytes).to_hex())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn exact_repeated_guest_builds_and_artifact_issuance_are_deterministic() {
        assert_eq!(RESTRICTED_WASM, REPEATED_BUILD_WASM);
        let intent = ResearchIntent::frozen().expect("frozen intent");
        let contract = DecisionContract::for_intent(&intent).expect("decision contract");
        let first = StrategyArtifact::issue(&intent, &contract).expect("first artifact");
        let second = StrategyArtifact::issue(&intent, &contract).expect("second artifact");
        assert_eq!(first, second);
        assert_eq!(first.wasm().len(), RESTRICTED_WASM.len());
    }

    #[rstest]
    fn public_tampered_intent_cannot_bypass_artifact_binding() {
        let mut intent = ResearchIntent::frozen().expect("frozen intent");
        intent.payload.pilot_id = "tampered".to_string();
        let frozen = ResearchIntent::frozen().expect("frozen intent");
        let contract = DecisionContract::for_intent(&frozen).expect("decision contract");
        assert_eq!(
            StrategyArtifact::issue(&intent, &contract),
            Err(ArtifactError::Intent(IntentError::Binding("pilot id")))
        );
    }

    #[rstest]
    fn artifact_identity_binds_content_provenance_toolchain_target_and_abi() {
        let intent = ResearchIntent::frozen().expect("frozen intent");
        let contract = DecisionContract::for_intent(&intent).expect("decision contract");
        let artifact = StrategyArtifact::issue(&intent, &contract).expect("artifact");

        let mutations: [fn(&mut StrategyArtifactIdentity); 14] = [
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
            |identity: &mut StrategyArtifactIdentity| identity.decision_abi_version += 1,
            |identity: &mut StrategyArtifactIdentity| identity.decision_export.push_str("_extra"),
            |identity: &mut StrategyArtifactIdentity| {
                identity.decision_signature.push_str("_extra");
            },
            |identity: &mut StrategyArtifactIdentity| identity.artifact_digest.push_str("_extra"),
        ];

        for mutate in mutations {
            let mut tampered = artifact.clone();
            mutate(&mut tampered.identity);
            assert_eq!(
                tampered.verify_binding(&intent, &contract),
                Err(ArtifactError::Binding)
            );
        }
    }

    #[rstest]
    fn artifact_digest_seed_changes_with_source_or_build_recipe_provenance() {
        let intent = ResearchIntent::frozen().expect("frozen intent");
        let contract = DecisionContract::for_intent(&intent).expect("decision contract");
        let artifact = StrategyArtifact::issue(&intent, &contract).expect("artifact");
        let identity = artifact.identity();
        let seed = ArtifactIdentitySeed {
            schema_version: identity.schema_version,
            intent_digest: &identity.intent_digest,
            wasm_digest: &identity.wasm_digest,
            guest_source_locator: &identity.guest_source_locator,
            guest_source_digest: &identity.guest_source_digest,
            build_recipe_locator: &identity.build_recipe_locator,
            build_recipe_digest: &identity.build_recipe_digest,
            rustc_release: &identity.rustc_release,
            rustc_commit: &identity.rustc_commit,
            target: &identity.target,
            decision_abi_version: identity.decision_abi_version,
            decision_export: &identity.decision_export,
            decision_signature: &identity.decision_signature,
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
