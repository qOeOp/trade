use std::cell::{Cell, RefCell};

use rstest::rstest;
use vibe_data::owner::source_binding::BindingDigest;

use super::{
    cargo_artifact::{PluginCargoBuildEvidenceV2, VerifiedPluginCargoBuildV2},
    develop_composer_v2::{
        CurrentResearchDevelopCustodyV2, DevelopComposerEvidencePortV2, DevelopComposerResultV2,
        DevelopComposerTerminalKindV2, DevelopComposerTerminalV2, DevelopComposerV2,
        UntrustedDevelopComposerProposalV2, UntrustedPluginBuildLocatorV2,
    },
    develop_plugin_build_v2::{
        VerifiedDevelopPluginBuildV2, portable_sealed_composer_test_evidence,
    },
    program_host_v2::ProgramHostV2,
    program_host_v2_backtest_tests::stateful_plugin_module,
    program_host_v2_tests::executable_design,
    strategy_design_v2::PluginManifestV2,
    strategy_design_v2_tests::bindings,
    strategy_plan_v2::{
        VerifiedStrategyInputBindingsV2, verified_strategy_input_bindings_for_test,
    },
};

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use super::develop_plugin_build_v2::{
    DevelopPluginBuildProducerV2, DevelopPluginBuildResultV2, UntrustedDevelopPluginCapsuleV2,
    UntrustedDevelopPluginSourceFileV2, VerifiedDevelopPluginBuildReadV2, bounded_source,
};

#[rstest]
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn real_local_plugin_builder_supplies_composer_and_program_host() {
    let (mut proposal, mut evidence) = fixture();
    let manifest = proposal.design.plugins[0].clone();
    let build = real_plugin_build(&manifest);
    proposal.plugin_builds[0].verified_build_receipt_digest = build.receipt().receipt_digest();
    evidence.builds = RefCell::new(vec![build.into_composer_build()]);

    let positive = composed(DevelopComposerV2::default().compose(&proposal, 10, &evidence));
    ProgramHostV2::new(positive.plan().clone(), positive.artifact().clone())
        .expect("the real locally built module reaches the sole Composer and ProgramHostV2 path");
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn real_plugin_build(manifest: &PluginManifestV2) -> VerifiedDevelopPluginBuildReadV2 {
    let capsule = UntrustedDevelopPluginCapsuleV2 {
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
            bytes: bounded_source(manifest).into_bytes(),
            symlink_target: None,
        }],
    };

    match DevelopPluginBuildProducerV2::default().build(manifest, &capsule) {
        DevelopPluginBuildResultV2::Verified(value) => *value,
        DevelopPluginBuildResultV2::Terminal(terminal) => {
            panic!("real local plugin build failed: {terminal:?}")
        }
    }
}

struct TestEvidencePort {
    custody: CurrentResearchDevelopCustodyV2,
    bindings: VerifiedStrategyInputBindingsV2,
    builds: RefCell<Vec<VerifiedDevelopPluginBuildV2>>,
    binding_terminal: Option<DevelopComposerTerminalV2>,
    build_terminal: Option<DevelopComposerTerminalV2>,
    research_reads: Cell<usize>,
    binding_reads: Cell<usize>,
    build_reads: Cell<usize>,
}

impl DevelopComposerEvidencePortV2 for TestEvidencePort {
    fn read_current_research(
        &self,
        request_locator: &str,
        _read_cut_epoch_ms: u64,
    ) -> Result<CurrentResearchDevelopCustodyV2, DevelopComposerTerminalV2> {
        self.research_reads.set(self.research_reads.get() + 1);

        if request_locator != "research-request-1" {
            return Err(DevelopComposerTerminalV2::unavailable(
                "research_custody",
                "request is unavailable",
            ));
        }
        Ok(self.custody.clone())
    }

    fn read_input_bindings(
        &self,
        _design_identity: BindingDigest,
        _receipt_digests: &[BindingDigest],
    ) -> Result<VerifiedStrategyInputBindingsV2, DevelopComposerTerminalV2> {
        self.binding_reads.set(self.binding_reads.get() + 1);
        self.binding_terminal
            .clone()
            .map_or_else(|| Ok(self.bindings.clone()), Err)
    }

    fn read_plugin_builds(
        &self,
        _manifests: &[PluginManifestV2],
        _locators: &[UntrustedPluginBuildLocatorV2],
    ) -> Result<Vec<VerifiedDevelopPluginBuildV2>, DevelopComposerTerminalV2> {
        self.build_reads.set(self.build_reads.get() + 1);
        self.build_terminal
            .clone()
            .map_or_else(|| Ok(std::mem::take(&mut *self.builds.borrow_mut())), Err)
    }
}

#[rstest]
fn owner_composer_joins_exact_replay_and_produces_the_program_host_artifact() {
    let (proposal, evidence) = fixture();
    let mut composer = DevelopComposerV2::default();
    let first = composed(composer.compose(&proposal, 10, &evidence));
    let replay = composed(composer.compose(&proposal, 11, &evidence));

    assert_eq!(first, replay);
    assert_eq!(
        first.receipt().canonical_bytes(),
        replay.receipt().canonical_bytes()
    );
    assert!(first.receipt().validates());
    assert_eq!(
        first.receipt().design_identity(),
        first.plan().design_identity()
    );
    assert_eq!(
        first.receipt().canonical_plan_digest(),
        first.plan().canonical_plan_digest()
    );
    assert_eq!(
        first.receipt().artifact_identity(),
        first.artifact().identity()
    );
    ProgramHostV2::new(first.plan().clone(), first.artifact().clone())
        .expect("composer Artifact is accepted by the sole ProgramHostV2 path");

    assert_eq!(evidence.research_reads.get(), 2, "retry rereads custody");
    assert_eq!(
        evidence.binding_reads.get(),
        1,
        "exact replay joins the receipt"
    );
    assert_eq!(
        evidence.build_reads.get(),
        1,
        "exact replay rebuilds nothing"
    );

    let mut conflicting = proposal.clone();
    conflicting.design.schema_version = 99;
    assert_terminal(
        composer.compose(&conflicting, 12, &evidence),
        DevelopComposerTerminalKindV2::Conflict,
    );
    assert_eq!(evidence.binding_reads.get(), 1);
    assert_eq!(evidence.build_reads.get(), 1);

    let (_, drifted_evidence) = fixture_with_custody_byte(18);
    assert_terminal(
        composer.compose(&proposal, 13, &drifted_evidence),
        DevelopComposerTerminalKindV2::Conflict,
    );
    assert_eq!(drifted_evidence.binding_reads.get(), 0);
    assert_eq!(drifted_evidence.build_reads.get(), 0);
}

#[rstest]
fn every_invalid_owner_or_compiler_path_returns_zero_partial_artifact() {
    let (proposal, evidence) = fixture();

    let mut drifted = proposal.clone();
    drifted.design.falsifier.push_str(" changed by caller");
    assert_terminal(
        DevelopComposerV2::default().compose(&drifted, 10, &evidence),
        DevelopComposerTerminalKindV2::Conflict,
    );

    let mut missing_binding = proposal.clone();
    missing_binding.input_binding_receipt_digests.pop();
    assert_terminal(
        DevelopComposerV2::default().compose(&missing_binding, 10, &evidence),
        DevelopComposerTerminalKindV2::Unsupported,
    );

    let mut duplicate_binding = proposal.clone();
    duplicate_binding
        .input_binding_receipt_digests
        .push(duplicate_binding.input_binding_receipt_digests[0]);
    assert_terminal(
        DevelopComposerV2::default().compose(&duplicate_binding, 10, &evidence),
        DevelopComposerTerminalKindV2::Unsupported,
    );

    let mut extra_binding = proposal.clone();
    extra_binding
        .input_binding_receipt_digests
        .push(BindingDigest::from_untrusted_bytes([99; 32]));
    assert_terminal(
        DevelopComposerV2::default().compose(&extra_binding, 10, &evidence),
        DevelopComposerTerminalKindV2::Unsupported,
    );

    let mut missing_plugin = proposal.clone();
    missing_plugin.plugin_builds.clear();
    assert_terminal(
        DevelopComposerV2::default().compose(&missing_plugin, 10, &evidence),
        DevelopComposerTerminalKindV2::Unsupported,
    );

    let mut duplicate_plugin = proposal.clone();
    duplicate_plugin
        .plugin_builds
        .push(duplicate_plugin.plugin_builds[0].clone());
    assert_terminal(
        DevelopComposerV2::default().compose(&duplicate_plugin, 10, &evidence),
        DevelopComposerTerminalKindV2::Unsupported,
    );

    let mut extra_plugin = proposal.clone();
    extra_plugin
        .plugin_builds
        .push(UntrustedPluginBuildLocatorV2 {
            plugin_semantic_id: "research.plugin.extra.v2".to_owned(),
            verified_build_receipt_digest: BindingDigest::from_untrusted_bytes([52; 32]),
        });
    assert_terminal(
        DevelopComposerV2::default().compose(&extra_plugin, 10, &evidence),
        DevelopComposerTerminalKindV2::Unsupported,
    );

    let mut unsupported = proposal.clone();
    unsupported.design.schema_version = 99;
    assert_terminal(
        DevelopComposerV2::default().compose(&unsupported, 10, &evidence),
        DevelopComposerTerminalKindV2::Unsupported,
    );

    let mut refinement = proposal.clone();
    refinement.design.inputs.clear();
    assert_terminal(
        DevelopComposerV2::default().compose(&refinement, 10, &evidence),
        DevelopComposerTerminalKindV2::NeedsResearchRefinement,
    );

    let manifest = &proposal.design.plugins[0];
    let wasm = stateful_plugin_module(manifest).expect("bounded Wasm fixture");
    let mut changed = wasm.clone();
    changed.push(0);
    assert!(
        VerifiedPluginCargoBuildV2::verify(
            manifest,
            PluginCargoBuildEvidenceV2 {
                wasm_one: &wasm,
                wasm_two: &changed,
                implementation_capsule_digest: BindingDigest::from_untrusted_bytes([31; 32]),
                source_entry_digest: BindingDigest::from_untrusted_bytes([41; 32]),
                verified_build_receipt_digest: BindingDigest::from_untrusted_bytes([51; 32]),
            },
        )
        .is_err(),
        "the existing verifier rejects nondeterministic builds"
    );
    let (_, mut unavailable_build) = fixture();
    unavailable_build.build_terminal = Some(DevelopComposerTerminalV2::unavailable(
        "plugin_builds",
        "deterministic verified build unavailable",
    ));
    assert_terminal(
        DevelopComposerV2::default().compose(&proposal, 10, &unavailable_build),
        DevelopComposerTerminalKindV2::Unavailable,
    );
}

#[rstest]
fn verified_plugin_build_is_bound_to_its_exact_plugin_and_manifest() {
    let (mut relabelled, evidence) = fixture();
    let replacement_id = "research.plugin.compatible-relabel.v2";
    let original_id = relabelled.design.plugins[0].semantic_id.clone();
    relabelled.design.plugins[0].semantic_id = replacement_id.to_owned();
    for reaction in &mut relabelled.design.reactions {
        for node in &mut reaction.nodes {
            if node.plugin_semantic_id == original_id {
                node.plugin_semantic_id = replacement_id.to_owned();
            }
        }
    }
    relabelled.plugin_builds[0].plugin_semantic_id = replacement_id.to_owned();

    let result = DevelopComposerV2::default().compose(&relabelled, 10, &evidence);
    match result {
        DevelopComposerResultV2::Terminal(terminal) => {
            assert_eq!(terminal.kind, DevelopComposerTerminalKindV2::Unsupported);
            assert_eq!(terminal.coordinate, "plugin_builds.plugin_semantic_id");
        }
        DevelopComposerResultV2::Composed(_) => {
            panic!("a relabelled verified build leaked a Plan and Artifact")
        }
    }

    let (mut changed_manifest, fresh_evidence) = fixture();
    changed_manifest.design.plugins[0].max_fuel -= 1;
    let result = DevelopComposerV2::default().compose(&changed_manifest, 10, &fresh_evidence);
    match result {
        DevelopComposerResultV2::Terminal(terminal) => {
            assert_eq!(terminal.kind, DevelopComposerTerminalKindV2::Unsupported);
            assert_eq!(terminal.coordinate, "plugin_builds.manifest_digest");
        }
        DevelopComposerResultV2::Composed(_) => {
            panic!("a build for a different canonical manifest leaked a Plan and Artifact")
        }
    }
}

fn fixture() -> (UntrustedDevelopComposerProposalV2, TestEvidencePort) {
    fixture_with_custody_byte(17)
}

fn fixture_with_custody_byte(
    custody_byte: u8,
) -> (UntrustedDevelopComposerProposalV2, TestEvidencePort) {
    let custody = CurrentResearchDevelopCustodyV2::fixture(
        "research-request-1",
        "price relation must stop producing the declared position transition",
        custody_byte,
    );
    let mut design = executable_design();
    design.research_request_identity = custody.research_request_identity();
    design.intent_identity = custody.intent_identity();
    design.intent_digest = custody.intent_digest();
    design.falsifier = custody.falsifier().to_owned();
    design.state[0].initial = super::strategy_design_v2::TypedConstantV2::Bytes { value: vec![0] };
    design.plugins[0].max_fuel = 10_000_000;

    let owner_bindings = bindings(&design);
    let input_binding_receipt_digests = owner_bindings
        .iter()
        .map(|(_, digest)| *digest)
        .collect::<Vec<_>>();
    let verified_bindings = verified_strategy_input_bindings_for_test(&design, owner_bindings);
    let manifest = &design.plugins[0];
    let build = portable_sealed_composer_test_evidence();
    let plugin_builds = vec![UntrustedPluginBuildLocatorV2 {
        plugin_semantic_id: manifest.semantic_id.clone(),
        verified_build_receipt_digest: build.receipt().receipt_digest(),
    }];
    (
        UntrustedDevelopComposerProposalV2 {
            research_request_locator: "research-request-1".to_owned(),
            design,
            input_binding_receipt_digests,
            plugin_builds,
        },
        TestEvidencePort {
            custody,
            bindings: verified_bindings,
            builds: RefCell::new(vec![build.into_composer_build()]),
            binding_terminal: None,
            build_terminal: None,
            research_reads: Cell::new(0),
            binding_reads: Cell::new(0),
            build_reads: Cell::new(0),
        },
    )
}

fn composed(
    result: DevelopComposerResultV2,
) -> Box<super::develop_composer_v2::DevelopComposerPositiveV2> {
    match result {
        DevelopComposerResultV2::Composed(positive) => positive,
        DevelopComposerResultV2::Terminal(terminal) => panic!("unexpected terminal: {terminal:?}"),
    }
}

fn assert_terminal(result: DevelopComposerResultV2, expected: DevelopComposerTerminalKindV2) {
    match result {
        DevelopComposerResultV2::Terminal(terminal) => assert_eq!(terminal.kind, expected),
        DevelopComposerResultV2::Composed(_) => panic!("terminal path leaked a positive Artifact"),
    }
}
