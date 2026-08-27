//! Content-addressed StrategyPlanV2 package. ProgramHost evaluation is a successor boundary.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use strategy_factory_program_sdk::lifecycle_v1;
use thiserror::Error;
use vibe_data::owner::source_binding::BindingDigest;

use crate::{
    cargo_artifact::VerifiedPluginCargoBuildV2,
    strategy_design_v2::PluginManifestV2,
    strategy_plan_v2::{
        PluginImplementationReceiptV2, StrategyPlanV2, durable_decode, durable_encode,
        plugin_implementation_receipt_digest, plugin_manifest_digest, plugin_module_identity,
    },
};

pub const STRATEGY_ARTIFACT_SCHEMA_V2: u16 = 2;
pub const PROGRAM_PROFILE_SCHEMA_V2: u16 = 2;
pub const PROGRAM_HOST_ABI_VERSION_V2: u16 = 2;
const PROGRAM_HOST_ABI_SEMANTIC_ID_V2: &str = "strategy.program-host.plugin-abi.v2";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StrategyArtifactModuleV2 {
    plugin_semantic_id: String,
    manifest_digest: BindingDigest,
    module_digest: BindingDigest,
    module_identity: BindingDigest,
    implementation_capsule_digest: BindingDigest,
    source_entry_digest: BindingDigest,
    verified_build_receipt_digest: BindingDigest,
    implementation_receipt_digest: BindingDigest,
    #[serde(skip)]
    wasm: Box<[u8]>,
}

impl StrategyArtifactModuleV2 {
    pub fn plugin_semantic_id(&self) -> &str {
        &self.plugin_semantic_id
    }

    pub const fn manifest_digest(&self) -> BindingDigest {
        self.manifest_digest
    }

    pub const fn module_digest(&self) -> BindingDigest {
        self.module_digest
    }

    pub const fn module_identity(&self) -> BindingDigest {
        self.module_identity
    }

    pub const fn implementation_capsule_digest(&self) -> BindingDigest {
        self.implementation_capsule_digest
    }

    pub const fn source_entry_digest(&self) -> BindingDigest {
        self.source_entry_digest
    }

    pub const fn verified_build_receipt_digest(&self) -> BindingDigest {
        self.verified_build_receipt_digest
    }

    pub const fn implementation_receipt_digest(&self) -> BindingDigest {
        self.implementation_receipt_digest
    }

    pub(crate) fn wasm(&self) -> &[u8] {
        &self.wasm
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProgramPluginProfileV2 {
    plugin_semantic_id: String,
    manifest_identity: BindingDigest,
    resource_identity: BindingDigest,
    module_identity: BindingDigest,
    source_identity: BindingDigest,
    build_receipt_identity: BindingDigest,
}

impl ProgramPluginProfileV2 {
    pub fn plugin_semantic_id(&self) -> &str {
        &self.plugin_semantic_id
    }

    pub const fn manifest_identity(&self) -> BindingDigest {
        self.manifest_identity
    }

    pub const fn resource_identity(&self) -> BindingDigest {
        self.resource_identity
    }

    pub const fn module_identity(&self) -> BindingDigest {
        self.module_identity
    }

    pub const fn source_identity(&self) -> BindingDigest {
        self.source_identity
    }

    pub const fn build_receipt_identity(&self) -> BindingDigest {
        self.build_receipt_identity
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProgramProfileV2 {
    schema_version: u16,
    canonical_plan_digest: BindingDigest,
    artifact_identity: BindingDigest,
    program_host_abi_identity: BindingDigest,
    program_host_abi_version: u16,
    lifecycle_kernel_identity: BindingDigest,
    lifecycle_schema_version: u16,
    checkpoint_schema_version: u16,
    envelope_codec_version: u16,
    market_semantics_identity: BindingDigest,
    runtime_profile_identity: BindingDigest,
    plugins: Vec<ProgramPluginProfileV2>,
    profile_identity: BindingDigest,
}

impl ProgramProfileV2 {
    pub const fn schema_version(&self) -> u16 {
        self.schema_version
    }

    pub const fn canonical_plan_digest(&self) -> BindingDigest {
        self.canonical_plan_digest
    }

    pub const fn artifact_identity(&self) -> BindingDigest {
        self.artifact_identity
    }

    pub const fn program_host_abi_identity(&self) -> BindingDigest {
        self.program_host_abi_identity
    }

    pub const fn program_host_abi_version(&self) -> u16 {
        self.program_host_abi_version
    }

    pub const fn lifecycle_kernel_identity(&self) -> BindingDigest {
        self.lifecycle_kernel_identity
    }

    pub const fn lifecycle_schema_version(&self) -> u16 {
        self.lifecycle_schema_version
    }

    pub const fn checkpoint_schema_version(&self) -> u16 {
        self.checkpoint_schema_version
    }

    pub const fn envelope_codec_version(&self) -> u16 {
        self.envelope_codec_version
    }

    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }

    pub const fn runtime_profile_identity(&self) -> BindingDigest {
        self.runtime_profile_identity
    }

    pub const fn profile_identity(&self) -> BindingDigest {
        self.profile_identity
    }

    pub fn plugins(&self) -> &[ProgramPluginProfileV2] {
        &self.plugins
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyArtifactV2 {
    identity: BindingDigest,
    canonical_plan_digest: BindingDigest,
    canonical_plan: Box<[u8]>,
    modules: Vec<StrategyArtifactModuleV2>,
    profile: ProgramProfileV2,
}

#[derive(Deserialize, Serialize)]
struct StrategyArtifactPackageV2 {
    schema_version: u16,
    identity: BindingDigest,
    canonical_plan_digest: BindingDigest,
    modules: Vec<StrategyArtifactModuleV2>,
    profile: ProgramProfileV2,
}

impl StrategyArtifactV2 {
    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }

    pub const fn canonical_plan_digest(&self) -> BindingDigest {
        self.canonical_plan_digest
    }

    pub fn canonical_plan(&self) -> &[u8] {
        &self.canonical_plan
    }

    pub fn modules(&self) -> &[StrategyArtifactModuleV2] {
        &self.modules
    }

    pub const fn profile(&self) -> &ProgramProfileV2 {
        &self.profile
    }

    /// Canonical private package metadata. Raw modules are stored in separate private BYTEA rows.
    pub(crate) fn durable_package_bytes(&self) -> Vec<u8> {
        durable_encode(&StrategyArtifactPackageV2 {
            schema_version: STRATEGY_ARTIFACT_SCHEMA_V2,
            identity: self.identity,
            canonical_plan_digest: self.canonical_plan_digest,
            modules: self.modules.clone(),
            profile: self.profile.clone(),
        })
    }

    pub(crate) fn private_module_bytes(&self) -> Vec<Box<[u8]>> {
        self.modules
            .iter()
            .map(|module| module.wasm.clone())
            .collect()
    }

    pub(crate) fn parse_and_revalidate_durable(
        package_bytes: &[u8],
        module_bytes: Vec<Box<[u8]>>,
        plan: &StrategyPlanV2,
    ) -> Result<Self, StrategyArtifactV2Error> {
        let mut package: StrategyArtifactPackageV2 =
            durable_decode(package_bytes).map_err(|_| StrategyArtifactV2Error::ReceiptMismatch)?;
        if package.schema_version != STRATEGY_ARTIFACT_SCHEMA_V2
            || durable_encode(&package) != package_bytes
            || package.modules.len() != module_bytes.len()
        {
            return Err(StrategyArtifactV2Error::ReceiptMismatch);
        }

        for (module, bytes) in package.modules.iter_mut().zip(module_bytes) {
            module.wasm = bytes;
        }
        let artifact = Self {
            identity: package.identity,
            canonical_plan_digest: package.canonical_plan_digest,
            canonical_plan: plan.canonical_bytes().into_boxed_slice(),
            modules: package.modules,
            profile: package.profile,
        };
        artifact.validate_for_plan(plan)?;
        if artifact.durable_package_bytes() != package_bytes {
            return Err(StrategyArtifactV2Error::ReceiptMismatch);
        }
        Ok(artifact)
    }

    /// Revalidates every content and receipt identity at the Host consumption boundary.
    pub(crate) fn validate_for_plan(
        &self,
        plan: &StrategyPlanV2,
    ) -> Result<(), StrategyArtifactV2Error> {
        if self.canonical_plan.as_ref() != plan.canonical_bytes().as_slice()
            || self.canonical_plan_digest != plan.canonical_plan_digest()
            || self.profile.canonical_plan_digest != self.canonical_plan_digest
            || self.profile.artifact_identity != self.identity
            || self.profile.market_semantics_identity != plan.market_semantics_identity()
        {
            return Err(StrategyArtifactV2Error::ReceiptMismatch);
        }
        let expected_profile = build_profile(
            plan,
            self.identity,
            &self.modules,
            plan.canonical_plugin_manifests(),
        );

        if self.profile != expected_profile
            || self.modules.len() != plan.plugin_implementations().len()
        {
            return Err(StrategyArtifactV2Error::ModuleCoverage);
        }

        for ((module, receipt), manifest) in self
            .modules
            .iter()
            .zip(plan.plugin_implementations())
            .zip(plan.canonical_plugin_manifests())
        {
            let module_digest =
                BindingDigest::from_untrusted_bytes(Sha256::digest(module.wasm()).into());
            if module.plugin_semantic_id != receipt.plugin_semantic_id()
                || module.plugin_semantic_id != manifest.semantic_id
                || module.manifest_digest != plugin_manifest_digest(manifest)
                || module.module_digest != module_digest
                || module.module_digest != receipt.module_digest()
                || module.module_identity
                    != plugin_module_identity(
                        &module.plugin_semantic_id,
                        module.manifest_digest,
                        module_digest,
                    )
                || module.module_identity != receipt.module_identity()
                || module.implementation_receipt_digest
                    != plugin_implementation_receipt_digest(receipt)
                || module.implementation_receipt_digest != receipt.receipt_digest()
            {
                return Err(StrategyArtifactV2Error::ReceiptMismatch);
            }
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn corrupt_module_bytes_for_test(&mut self) {
        self.modules[0].wasm[0] ^= 1;
    }

    #[cfg(test)]
    pub(crate) fn corrupt_profile_identity_for_test(&mut self) {
        self.profile.profile_identity = BindingDigest::from_untrusted_bytes([0xa5; 32]);
    }

    pub(crate) fn issue(
        plan: &StrategyPlanV2,
        mut builds: Vec<VerifiedPluginCargoBuildV2>,
    ) -> Result<Self, StrategyArtifactV2Error> {
        let receipts = plan.plugin_implementations();
        if builds.len() != receipts.len() {
            return Err(StrategyArtifactV2Error::ModuleCoverage);
        }

        if receipts
            .iter()
            .map(PluginImplementationReceiptV2::module_identity)
            .collect::<BTreeSet<_>>()
            .len()
            != receipts.len()
            || receipts
                .iter()
                .map(PluginImplementationReceiptV2::module_digest)
                .collect::<BTreeSet<_>>()
                .len()
                != receipts.len()
        {
            return Err(StrategyArtifactV2Error::SharedModuleIdentity);
        }

        let manifests = plan.canonical_plugin_manifests();
        let mut modules = Vec::with_capacity(receipts.len());
        for receipt in receipts {
            let manifest = manifests
                .iter()
                .find(|manifest| manifest.semantic_id == receipt.plugin_semantic_id())
                .ok_or(StrategyArtifactV2Error::ReceiptMismatch)?;
            let matching = builds
                .iter()
                .enumerate()
                .filter(|(_, build)| build_matches_receipt(build, receipt))
                .map(|(index, _)| index)
                .collect::<Vec<_>>();
            let [index] = matching.as_slice() else {
                return Err(StrategyArtifactV2Error::ReceiptMismatch);
            };
            let build = builds.swap_remove(*index);

            if module_resource_identity(manifest) == BindingDigest::from_untrusted_bytes([0; 32]) {
                return Err(StrategyArtifactV2Error::ReceiptMismatch);
            }
            modules.push(StrategyArtifactModuleV2 {
                plugin_semantic_id: receipt.plugin_semantic_id().to_owned(),
                manifest_digest: receipt.manifest_digest(),
                module_digest: receipt.module_digest(),
                module_identity: receipt.module_identity(),
                implementation_capsule_digest: receipt.implementation_capsule_digest(),
                source_entry_digest: receipt.source_entry_digest(),
                verified_build_receipt_digest: receipt.verified_build_receipt_digest(),
                implementation_receipt_digest: receipt.receipt_digest(),
                wasm: build.into_wasm(),
            });
        }

        if !builds.is_empty() {
            return Err(StrategyArtifactV2Error::ModuleCoverage);
        }
        modules.sort_by(|left, right| left.plugin_semantic_id.cmp(&right.plugin_semantic_id));

        let canonical_plan = plan.canonical_bytes().into_boxed_slice();
        let canonical_plan_digest = plan.canonical_plan_digest();
        let module_projection = modules
            .iter()
            .map(|module| {
                (
                    module.plugin_semantic_id.as_str(),
                    module.manifest_digest,
                    module.module_digest,
                    module.module_identity,
                    module.source_entry_digest,
                    module.verified_build_receipt_digest,
                    module.implementation_receipt_digest,
                )
            })
            .collect::<Vec<_>>();
        let identity = domain_digest(
            b"strategy.artifact.identity.v2\0",
            &serde_json::to_vec(&(
                STRATEGY_ARTIFACT_SCHEMA_V2,
                canonical_plan_digest,
                &module_projection,
            ))
            .expect("artifact identity serialization"),
        );
        let profile = build_profile(plan, identity, &modules, manifests);
        Ok(Self {
            identity,
            canonical_plan_digest,
            canonical_plan,
            modules,
            profile,
        })
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum StrategyArtifactV2Error {
    #[error("plugin modules do not exactly cover the compiled plan")]
    ModuleCoverage,
    #[error("plugin build material does not exactly match its compiler-sealed receipt")]
    ReceiptMismatch,
    #[error("one module identity or module content is shared across plugins")]
    SharedModuleIdentity,
}

fn build_matches_receipt(
    build: &VerifiedPluginCargoBuildV2,
    receipt: &PluginImplementationReceiptV2,
) -> bool {
    let actual_module_digest =
        BindingDigest::from_untrusted_bytes(Sha256::digest(build.wasm()).into());
    build.plugin_semantic_id() == receipt.plugin_semantic_id()
        && build.manifest_digest() == receipt.manifest_digest()
        && build.module_digest() == actual_module_digest
        && build.module_digest() == receipt.module_digest()
        && build.implementation_capsule_digest() == receipt.implementation_capsule_digest()
        && build.source_entry_digest() == receipt.source_entry_digest()
        && build.verified_build_receipt_digest() == receipt.verified_build_receipt_digest()
}

fn build_profile(
    plan: &StrategyPlanV2,
    artifact_identity: BindingDigest,
    modules: &[StrategyArtifactModuleV2],
    manifests: &[PluginManifestV2],
) -> ProgramProfileV2 {
    let host_contract = (
        PROGRAM_HOST_ABI_SEMANTIC_ID_V2,
        PROGRAM_HOST_ABI_VERSION_V2,
        [
            "memory",
            "strategy_factory_plugin_input_ptr_v2",
            "strategy_factory_plugin_input_capacity_v2",
            "strategy_factory_plugin_output_ptr_v2",
            "strategy_factory_plugin_output_capacity_v2",
            "strategy_factory_plugin_invoke_v2",
        ],
    );
    let program_host_abi_identity = domain_digest(
        b"strategy.program-host.abi.identity.v2\0",
        &serde_json::to_vec(&host_contract).expect("ProgramHost ABI serialization"),
    );
    let lifecycle_kernel_identity = domain_digest(
        b"strategy.lifecycle.kernel.identity.v2\0",
        &serde_json::to_vec(&(plan.kernel_semantics_id(), plan.lifecycle_schema_version()))
            .expect("kernel identity serialization"),
    );
    let plugins = modules
        .iter()
        .map(|module| {
            let manifest = manifests
                .iter()
                .find(|manifest| manifest.semantic_id == module.plugin_semantic_id)
                .expect("compiler-sealed manifest/module coverage");
            ProgramPluginProfileV2 {
                plugin_semantic_id: module.plugin_semantic_id.clone(),
                manifest_identity: module.manifest_digest,
                resource_identity: module_resource_identity(manifest),
                module_identity: module.module_identity,
                source_identity: module.source_entry_digest,
                build_receipt_identity: module.verified_build_receipt_digest,
            }
        })
        .collect::<Vec<_>>();
    let runtime_profile_identity = domain_digest(
        b"strategy.program-runtime.profile.identity.v2\0",
        &serde_json::to_vec(&(
            program_host_abi_identity,
            PROGRAM_HOST_ABI_VERSION_V2,
            lifecycle_kernel_identity,
            plan.lifecycle_schema_version(),
            plan.checkpoint_schema_version(),
            lifecycle_v1::ENVELOPE_CODEC_VERSION,
            &plugins,
        ))
        .expect("runtime profile serialization"),
    );
    let mut profile = ProgramProfileV2 {
        schema_version: PROGRAM_PROFILE_SCHEMA_V2,
        canonical_plan_digest: plan.canonical_plan_digest(),
        artifact_identity,
        program_host_abi_identity,
        program_host_abi_version: PROGRAM_HOST_ABI_VERSION_V2,
        lifecycle_kernel_identity,
        lifecycle_schema_version: plan.lifecycle_schema_version(),
        checkpoint_schema_version: plan.checkpoint_schema_version(),
        envelope_codec_version: lifecycle_v1::ENVELOPE_CODEC_VERSION,
        market_semantics_identity: plan.market_semantics_identity(),
        runtime_profile_identity,
        plugins,
        profile_identity: BindingDigest::from_untrusted_bytes([0; 32]),
    };
    profile.profile_identity = domain_digest(
        b"strategy.program-profile.identity.v2\0",
        &serde_json::to_vec(&profile).expect("program profile serialization"),
    );
    profile
}

fn module_resource_identity(manifest: &PluginManifestV2) -> BindingDigest {
    let resources = (
        manifest.semantic_id.as_str(),
        &manifest.input_ports,
        &manifest.output_ports,
        &manifest.state,
        manifest.max_fuel,
        manifest.max_linear_memory_bytes,
        manifest.max_invocations_per_event,
        manifest.failure_semantic_id.as_str(),
    );
    domain_digest(
        b"strategy.plugin.resources.identity.v2\0",
        &serde_json::to_vec(&resources).expect("plugin resource serialization"),
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
        cargo_artifact::{PluginCargoBuildEvidenceV2, VerifiedPluginCargoBuildV2},
        strategy_design_v2::{
            ComputeNodeV2, PluginManifestV2, PluginStateContractV2, PortBindingV2, PortContractV2,
            StateCellV2, StateWriteV2, TypedConstantV2, ValueRefV2, ValueTypeV2,
        },
        strategy_design_v2_tests::{bindings, design},
        strategy_plan_v2::{
            StrategyCompilationV2, compile_with_binding_and_implementation_receipts_for_test,
            issue_plugin_implementation_receipt_v2_for_test,
        },
    };
    use rstest::rstest;

    #[rstest]
    fn artifact_binds_canonical_plan_receipt_module_and_profile() {
        let (plan, builds) = compiled_plan_and_builds(false);
        let artifact = StrategyArtifactV2::issue(&plan, builds).expect("sealed artifact");
        assert_eq!(artifact.canonical_plan(), plan.canonical_bytes());
        assert_eq!(
            artifact.canonical_plan_digest(),
            plan.canonical_plan_digest()
        );
        assert_eq!(
            artifact.modules().len(),
            plan.plugin_implementations().len()
        );
        assert_eq!(artifact.profile().artifact_identity(), artifact.identity());
        assert_eq!(
            artifact.profile().canonical_plan_digest(),
            artifact.canonical_plan_digest()
        );
        assert_eq!(artifact.profile().plugins().len(), artifact.modules().len());
        assert_eq!(
            artifact.profile().schema_version(),
            PROGRAM_PROFILE_SCHEMA_V2
        );
        assert_eq!(
            artifact.profile().program_host_abi_version(),
            PROGRAM_HOST_ABI_VERSION_V2
        );
        assert_eq!(
            artifact.profile().lifecycle_schema_version(),
            plan.lifecycle_schema_version()
        );
        assert_eq!(
            artifact.profile().checkpoint_schema_version(),
            plan.checkpoint_schema_version()
        );
        assert_eq!(
            artifact.profile().envelope_codec_version(),
            lifecycle_v1::ENVELOPE_CODEC_VERSION
        );
        assert_eq!(
            artifact.profile().market_semantics_identity(),
            plan.market_semantics_identity()
        );
        assert_ne!(
            artifact.profile().program_host_abi_identity(),
            BindingDigest::from_untrusted_bytes([0; 32])
        );
        assert_ne!(
            artifact.profile().runtime_profile_identity(),
            artifact.profile().profile_identity()
        );
        let plugin_profile = &artifact.profile().plugins()[0];
        let module = &artifact.modules()[0];
        assert_eq!(
            plugin_profile.plugin_semantic_id(),
            module.plugin_semantic_id()
        );
        assert_eq!(plugin_profile.manifest_identity(), module.manifest_digest());
        assert_eq!(plugin_profile.module_identity(), module.module_identity());
        assert_eq!(
            plugin_profile.source_identity(),
            module.source_entry_digest()
        );
        assert_eq!(
            plugin_profile.build_receipt_identity(),
            module.verified_build_receipt_digest()
        );
        assert_ne!(
            plugin_profile.resource_identity(),
            BindingDigest::from_untrusted_bytes([0; 32])
        );
        assert!(!artifact.modules()[0].wasm().is_empty());
    }

    #[rstest]
    fn module_coverage_corruption_and_shared_content_fail_closed() {
        let (plan, builds) = compiled_plan_and_builds(false);
        assert_eq!(
            StrategyArtifactV2::issue(&plan, vec![]),
            Err(StrategyArtifactV2Error::ModuleCoverage)
        );
        let mut corrupt = builds.clone();
        corrupt[0].corrupt_source_entry_digest_for_test();
        assert_eq!(
            StrategyArtifactV2::issue(&plan, corrupt),
            Err(StrategyArtifactV2Error::ReceiptMismatch)
        );
        let mut corrupt = builds.clone();
        corrupt[0].corrupt_wasm_for_test();
        assert_eq!(
            StrategyArtifactV2::issue(&plan, corrupt),
            Err(StrategyArtifactV2Error::ReceiptMismatch)
        );
        let mut extra = builds;
        extra.push(extra[0].clone());
        assert_eq!(
            StrategyArtifactV2::issue(&plan, extra),
            Err(StrategyArtifactV2Error::ModuleCoverage)
        );

        let (shared_plan, shared_builds) = compiled_plan_and_builds(true);
        assert_eq!(
            StrategyArtifactV2::issue(&shared_plan, shared_builds),
            Err(StrategyArtifactV2Error::SharedModuleIdentity)
        );
    }

    #[rstest]
    fn unordered_builds_are_mapped_only_by_sealed_receipts() {
        let (plan, mut builds) = compiled_two_plugin_plan(false);
        builds.reverse();
        let artifact = StrategyArtifactV2::issue(&plan, builds).expect("unordered builds");
        assert!(
            artifact
                .modules()
                .windows(2)
                .all(|pair| pair[0].plugin_semantic_id() < pair[1].plugin_semantic_id())
        );

        for module in artifact.modules() {
            let receipt = plan
                .plugin_implementations()
                .iter()
                .find(|receipt| receipt.plugin_semantic_id() == module.plugin_semantic_id())
                .expect("sealed receipt");
            assert_eq!(module.module_identity(), receipt.module_identity());
            assert_eq!(module.source_entry_digest(), receipt.source_entry_digest());
        }
    }

    #[rstest]
    fn canonical_plan_change_rebinds_artifact_and_profile() {
        let (first_plan, first_builds) = compile(design(), false);
        let first = StrategyArtifactV2::issue(&first_plan, first_builds).expect("first artifact");
        let mut changed_design = design();
        changed_design
            .falsifier
            .push_str("; changed frozen falsifier");
        let (second_plan, second_builds) = compile(changed_design, false);
        let second =
            StrategyArtifactV2::issue(&second_plan, second_builds).expect("second artifact");
        assert_ne!(
            first.canonical_plan_digest(),
            second.canonical_plan_digest()
        );
        assert_ne!(first.identity(), second.identity());
        assert_ne!(
            first.profile().profile_identity(),
            second.profile().profile_identity()
        );
    }

    #[rstest]
    fn plugin_wasm_envelope_and_manifest_resources_fail_closed() {
        let candidate = design();
        let manifest = &candidate.plugins[0];

        for wasm in [
            plugin_module(1, 1, 1, true, false, true, false),
            plugin_module(1, 1, 1, false, true, true, false),
            plugin_module(1, 1, 1, false, false, false, false),
            plugin_module(1, 1, 17, false, false, true, false),
            plugin_module(1, 1, 1, false, false, true, true),
            plugin_module(10_000, 1, 1, false, false, true, false),
        ] {
            assert!(
                VerifiedPluginCargoBuildV2::verify(
                    manifest,
                    PluginCargoBuildEvidenceV2 {
                        wasm_one: &wasm,
                        wasm_two: &wasm,
                        implementation_capsule_digest: BindingDigest::from_untrusted_bytes([1; 32]),
                        source_entry_digest: BindingDigest::from_untrusted_bytes([2; 32]),
                        verified_build_receipt_digest: BindingDigest::from_untrusted_bytes([3; 32]),
                    },
                )
                .is_err()
            );
        }
    }

    fn compiled_plan_and_builds(
        shared: bool,
    ) -> (Box<StrategyPlanV2>, Vec<VerifiedPluginCargoBuildV2>) {
        if shared {
            compiled_two_plugin_plan(true)
        } else {
            compile(design(), false)
        }
    }

    fn compiled_two_plugin_plan(
        shared_module: bool,
    ) -> (Box<StrategyPlanV2>, Vec<VerifiedPluginCargoBuildV2>) {
        let mut candidate = design();
        let second_id = "research.plugin.stateful-trend.second.v2";
        let second_state = "research.state.second-plugin.v2";
        let second_output = "proposal.second-target-position.v2";
        let second_post_state = "plugin.second-state.post.v2";
        let second = PluginManifestV2 {
            semantic_id: second_id.to_owned(),
            abi_version: candidate.plugins[0].abi_version,
            input_ports: vec![PortContractV2 {
                semantic_id: "input.prior-target-position.v2".to_owned(),
                value_type: ValueTypeV2::I64,
                max_bytes: 8,
            }],
            output_ports: vec![PortContractV2 {
                semantic_id: second_output.to_owned(),
                value_type: ValueTypeV2::I64,
                max_bytes: 8,
            }],
            state: PluginStateContractV2 {
                pre_port_id: "plugin.second-state.pre.v2".to_owned(),
                post_port_id: second_post_state.to_owned(),
                value_type: ValueTypeV2::Bytes,
                max_bytes: 32,
            },
            capability_ids: vec![candidate.plugins[0].capability_ids[0].clone()],
            max_fuel: 100_000,
            max_linear_memory_bytes: 1_048_576,
            max_invocations_per_event: 1,
            failure_semantic_id: "strategy.plugin.failure.unsupported.v1".to_owned(),
        };
        candidate.plugins.push(second);
        candidate.state.push(StateCellV2 {
            semantic_id: second_state.to_owned(),
            value_type: ValueTypeV2::Bytes,
            initial: TypedConstantV2::Bytes { value: vec![0] },
            max_bytes: 32,
        });
        let bar = candidate
            .reactions
            .iter_mut()
            .find(|reaction| reaction.kind == crate::strategy_design_v2::LifecycleKindV2::Bar)
            .expect("BAR reaction");
        let prior_node = bar.nodes[0].semantic_id.clone();
        let prior_output = bar
            .proposal
            .as_ref()
            .and_then(|proposal| match &proposal.target_position_units {
                ValueRefV2::NodeOutput { port_id, .. } => Some(port_id.clone()),
                _ => None,
            })
            .expect("prior target output");
        let second_node = "research.node.second-plugin.bar.v2";
        bar.nodes.push(ComputeNodeV2 {
            semantic_id: second_node.to_owned(),
            plugin_semantic_id: second_id.to_owned(),
            input_bindings: vec![PortBindingV2 {
                port_id: "input.prior-target-position.v2".to_owned(),
                source: ValueRefV2::NodeOutput {
                    node_id: prior_node,
                    port_id: prior_output,
                },
            }],
            pre_state: ValueRefV2::PriorState {
                state_id: second_state.to_owned(),
            },
            output_port_ids: vec![second_output.to_owned()],
            post_state_port_id: second_post_state.to_owned(),
        });
        bar.state_writes.push(StateWriteV2 {
            state_id: second_state.to_owned(),
            source: ValueRefV2::NodeOutput {
                node_id: second_node.to_owned(),
                port_id: second_post_state.to_owned(),
            },
        });
        bar.proposal
            .as_mut()
            .expect("BAR proposal")
            .target_position_units = ValueRefV2::NodeOutput {
            node_id: second_node.to_owned(),
            port_id: second_output.to_owned(),
        };
        compile(candidate, shared_module)
    }

    fn compile(
        candidate: crate::strategy_design_v2::StrategyDesignV2,
        shared_module: bool,
    ) -> (Box<StrategyPlanV2>, Vec<VerifiedPluginCargoBuildV2>) {
        let mut receipts = Vec::new();
        let mut builds = Vec::new();

        for (index, plugin) in candidate.plugins.iter().enumerate() {
            let capacity = if shared_module { 1 } else { 1 + index as i32 };
            let wasm = plugin_module(capacity, capacity, 1, false, false, true, false);
            let build = VerifiedPluginCargoBuildV2::verify(
                plugin,
                PluginCargoBuildEvidenceV2 {
                    wasm_one: &wasm,
                    wasm_two: &wasm,
                    implementation_capsule_digest: BindingDigest::from_untrusted_bytes(
                        [30 + index as u8; 32],
                    ),
                    source_entry_digest: BindingDigest::from_untrusted_bytes(
                        [40 + index as u8; 32],
                    ),
                    verified_build_receipt_digest: BindingDigest::from_untrusted_bytes(
                        [50 + index as u8; 32],
                    ),
                },
            )
            .expect("valid plugin build");
            receipts.push(issue_plugin_implementation_receipt_v2_for_test(
                plugin,
                build.implementation_capsule_digest(),
                build.source_entry_digest(),
                build.module_digest(),
                build.verified_build_receipt_digest(),
                "strategy.plugin.compute.v2",
                plugin.abi_version,
                plugin
                    .capability_ids
                    .iter()
                    .map(|id| (id.clone(), 1))
                    .collect(),
            ));
            builds.push(build);
        }
        let owner_bindings = bindings(&candidate);
        let compilation = compile_with_binding_and_implementation_receipts_for_test(
            candidate,
            owner_bindings,
            receipts,
        );
        let StrategyCompilationV2::Compiled(plan) = compilation else {
            panic!("test plan must compile: {compilation:?}")
        };
        (plan, builds)
    }

    fn plugin_module(
        input_capacity: i32,
        output_capacity: i32,
        memory_max: u8,
        import: bool,
        start: bool,
        exact_exports: bool,
        grow: bool,
    ) -> Vec<u8> {
        let mut wasm = b"\0asm\x01\0\0\0".to_vec();
        section(&mut wasm, 1, &[2, 0x60, 0, 1, 0x7f, 0x60, 1, 0x7f, 1, 0x7f]);

        if import {
            let mut payload = vec![1];
            name(&mut payload, "host");
            name(&mut payload, "f");
            payload.extend([0, 0]);
            section(&mut wasm, 2, &payload);
        }
        section(&mut wasm, 3, &[5, 0, 0, 0, 0, 1]);
        section(&mut wasm, 5, &[1, 1, 1, memory_max]);
        let shift = u32::from(import);
        let mut exports = vec![if exact_exports { 6 } else { 5 }];
        export(&mut exports, "memory", 2, 0);

        for (export_name, index) in [
            ("strategy_factory_plugin_input_ptr_v2", 0),
            ("strategy_factory_plugin_input_capacity_v2", 1),
            ("strategy_factory_plugin_output_ptr_v2", 2),
            ("strategy_factory_plugin_output_capacity_v2", 3),
        ] {
            export(&mut exports, export_name, 0, index + shift);
        }

        if exact_exports {
            export(
                &mut exports,
                "strategy_factory_plugin_invoke_v2",
                0,
                4 + shift,
            );
        }
        section(&mut wasm, 7, &exports);
        if start {
            section(&mut wasm, 8, &[shift as u8]);
        }
        let mut code = vec![5];
        for value in [1024, input_capacity, 8192, output_capacity] {
            body(&mut code, &i32_const(value));
        }

        if grow {
            body(&mut code, &[0x41, 1, 0x40, 0, 0x1a, 0x41, 0]);
        } else {
            body(&mut code, &i32_const(0));
        }
        section(&mut wasm, 10, &code);
        wasm
    }

    fn section(wasm: &mut Vec<u8>, id: u8, payload: &[u8]) {
        wasm.push(id);
        u32_leb(wasm, payload.len() as u32);
        wasm.extend(payload);
    }

    fn export(bytes: &mut Vec<u8>, export_name: &str, kind: u8, index: u32) {
        name(bytes, export_name);
        bytes.push(kind);
        u32_leb(bytes, index);
    }

    fn name(bytes: &mut Vec<u8>, value: &str) {
        u32_leb(bytes, value.len() as u32);
        bytes.extend(value.as_bytes());
    }

    fn body(code: &mut Vec<u8>, operators: &[u8]) {
        let mut bytes = vec![0];
        bytes.extend(operators);
        bytes.push(0x0b);
        u32_leb(code, bytes.len() as u32);
        code.extend(bytes);
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
}
