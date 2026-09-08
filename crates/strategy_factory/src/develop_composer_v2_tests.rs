use std::cell::{Cell, RefCell};

use rstest::rstest;
use vibe_data::owner::source_binding::BindingDigest;

use super::{
    artifact_v2::StrategyArtifactV2,
    bounded_feature_program_lowerer_v1::prepare_frozen_bounded_feature_source_inputs_v1,
    bounded_feature_program_v1::tests::candidate as bfp_candidate,
    cargo_artifact::{PluginCargoBuildEvidenceV2, VerifiedPluginCargoBuildV2},
    develop_composer_v2::{
        CurrentResearchDevelopCustodyV2, DevelopComposerEvidencePortV2, DevelopComposerResultV2,
        DevelopComposerTerminalKindV2, DevelopComposerTerminalV2, DevelopComposerV2,
        UntrustedDevelopComposerProposalV2, UntrustedPluginBuildLocatorV2,
        VerifiedDevelopPluginBuildV2OrV3,
    },
    develop_plugin_build_v2::portable_sealed_composer_test_evidence,
    develop_plugin_build_v3::{
        DevelopPluginBuildProducerV3, DevelopPluginBuildReceiptV3, DevelopPluginBuildResultV3,
        VerifiedDevelopPluginBuildReadV3,
    },
    program_host_v2::ProgramHostV2,
    program_host_v2_backtest_tests::stateful_plugin_module,
    program_host_v2_tests::executable_design,
    rd_bounded_feature_program_v1::{
        FrozenResearchBoundedFeatureProgramV1, freeze_research_bounded_feature_program_v1,
    },
    strategy_design_v2::{
        LifecycleKindV2, ParameterV2, PluginManifestV2, StrategyDesignV2, TypedConstantV2,
        ValueRefV2, ValueTypeV2,
    },
    strategy_design_v2_tests::bindings,
    strategy_plan_v2::{
        StrategyDesignPreparationV2, VerifiedStrategyInputBindingsV2, durable_decode,
        prepare_strategy_design_v2, verified_strategy_input_bindings_for_test,
    },
};

#[cfg(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "linux", target_arch = "aarch64")
))]
use super::develop_plugin_build_v2::{
    DevelopPluginBuildProducerV2, DevelopPluginBuildResultV2, UntrustedDevelopPluginCapsuleV2,
    UntrustedDevelopPluginSourceFileV2, VerifiedDevelopPluginBuildReadV2, bounded_source,
};

#[rstest]
#[cfg(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "linux", target_arch = "aarch64")
))]
fn real_local_plugin_builder_supplies_composer_and_program_host() {
    let (mut proposal, mut evidence) = fixture();
    let manifest = proposal.design.plugins[0].clone();
    let build = real_plugin_build(&manifest);
    proposal.plugin_builds[0].verified_build_receipt_digest = build.receipt().receipt_digest();
    evidence.builds = RefCell::new(vec![build.into_composer_build().into()]);

    let positive = composed(DevelopComposerV2::default().compose(&proposal, 10, &evidence));
    ProgramHostV2::new(positive.plan().clone(), positive.artifact().clone())
        .expect("the real locally built module reaches the sole Composer and ProgramHostV2 path");
}

#[test]
#[ignore = "invokes the exact pinned local wasm compiler in two private roots"]
fn real_v3_owner_build_reaches_composer_and_durable_abi3_artifact() {
    let (design, bfp_proposal, catalog) = single_plugin_bfp_candidate();
    let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);
    let frozen =
        freeze_research_bounded_feature_program_v1(&custody, &design, bfp_proposal, catalog)
            .expect("joint Owner BFP freeze");
    let manifest = design.plugins[0].clone();
    let mut producer = DevelopPluginBuildProducerV3::default();

    let positive_build = real_v3_plugin_build(&mut producer, &manifest, &frozen);
    let capsule_digest = positive_build.build().capsule_digest();
    let source_set_digest = positive_build.build().source_set_digest();
    let module_digest = positive_build.build().module_digest();
    let receipt_digest = positive_build.build().verified_build_receipt_digest();
    let receipt: DevelopPluginBuildReceiptV3 =
        durable_decode(positive_build.canonical_receipt_bytes())
            .expect("real builder emits the canonical typed V3 receipt");
    assert_eq!(
        receipt.canonical_bytes(),
        positive_build.canonical_receipt_bytes()
    );

    // The move-only V3 build enters the tagged Composer enum directly; no V2 build token exists.
    let (proposal, evidence) = v3_composer_case(design.clone(), custody.clone(), positive_build);
    let positive = composed(DevelopComposerV2::default().compose(&proposal, 10, &evidence));
    assert_eq!(positive.artifact().profile().program_host_abi_version(), 3);
    positive
        .artifact()
        .validate_for_plan(positive.plan())
        .expect("Composer ABI3 Artifact revalidates against its Plan");
    let module = &positive.artifact().modules()[0];
    assert_eq!(module.implementation_capsule_digest(), capsule_digest);
    assert_eq!(module.source_entry_digest(), source_set_digest);
    assert_eq!(module.module_digest(), module_digest);
    assert_eq!(module.verified_build_receipt_digest(), receipt_digest);

    let package_bytes = positive.artifact().durable_package_bytes();
    let private_modules = positive.artifact().private_module_bytes();
    let restarted = StrategyArtifactV2::parse_and_revalidate_durable(
        &package_bytes,
        private_modules,
        positive.plan(),
    )
    .expect("durable ABI3 Artifact restart revalidates every bound identity");
    assert_eq!(restarted, *positive.artifact());

    let wrong_manifest_build = real_v3_plugin_build(&mut producer, &manifest, &frozen);
    let mut wrong_design = design.clone();
    wrong_design.plugins[0].max_fuel -= 1;
    let (wrong_proposal, wrong_evidence) =
        v3_composer_case(wrong_design, custody.clone(), wrong_manifest_build);
    let terminal =
        into_terminal(DevelopComposerV2::default().compose(&wrong_proposal, 11, &wrong_evidence));
    assert_eq!(terminal.kind, DevelopComposerTerminalKindV2::Unsupported);
    assert_eq!(terminal.coordinate, "plugin_builds.manifest_digest");

    let cross_tag_build = real_v3_plugin_build(&mut producer, &manifest, &frozen);
    let mut v2_tagged_design = design;
    v2_tagged_design.plugins[0].abi_version = 2;
    v2_tagged_design.plugins[0].failure_semantic_id =
        "strategy.plugin.failure.unsupported.v1".to_owned();
    let (cross_tag_proposal, cross_tag_evidence) =
        v3_composer_case(v2_tagged_design, custody, cross_tag_build);
    let terminal = into_terminal(DevelopComposerV2::default().compose(
        &cross_tag_proposal,
        12,
        &cross_tag_evidence,
    ));
    assert_eq!(terminal.kind, DevelopComposerTerminalKindV2::Unsupported);
    assert_eq!(terminal.coordinate, "plugin_builds.manifest_digest");
}

fn single_plugin_bfp_candidate() -> (
    StrategyDesignV2,
    super::bounded_feature_program_v1::BoundedFeatureProgramProposalV1,
    vibe_indicators_kernel::PrimitiveCatalogV1,
) {
    let (mut design, mut proposal, catalog) = bfp_candidate();
    let plugin_semantic_id = proposal.plugin_semantic_id.clone();
    design
        .plugins
        .retain(|plugin| plugin.semantic_id == plugin_semantic_id);
    for reaction in &mut design.reactions {
        reaction
            .nodes
            .retain(|node| node.plugin_semantic_id == plugin_semantic_id);
        if reaction.nodes.is_empty() {
            reaction.state_writes.clear();
            reaction.proposal = None;
        }
    }
    let event_reaction = design
        .reactions
        .iter_mut()
        .find(|reaction| reaction.kind == LifecycleKindV2::Event)
        .expect("BFP candidate has an EVENT reaction");
    event_reaction.nodes[0].input_bindings[0].source = ValueRefV2::Parameter {
        parameter_id: "research.parameter.timer-close.v1".to_owned(),
    };
    event_reaction.nodes[0].input_bindings[1].source = ValueRefV2::Parameter {
        parameter_id: "research.parameter.timer-coordinate.v1".to_owned(),
    };
    let mut timer_reaction = design
        .reactions
        .iter()
        .find(|reaction| reaction.kind == LifecycleKindV2::Event)
        .cloned()
        .expect("BFP candidate has an EVENT reaction");
    timer_reaction.kind = LifecycleKindV2::Timer;
    let prior_node_id = timer_reaction.nodes[0].semantic_id.clone();
    let timer_node_id = "research.node.bfp.timer.v1";
    timer_reaction.nodes[0].semantic_id = timer_node_id.to_owned();
    timer_reaction.nodes[0].input_bindings[0].source = ValueRefV2::Parameter {
        parameter_id: "research.parameter.timer-close.v1".to_owned(),
    };
    timer_reaction.nodes[0].input_bindings[1].source = ValueRefV2::Parameter {
        parameter_id: "research.parameter.timer-coordinate.v1".to_owned(),
    };
    for write in &mut timer_reaction.state_writes {
        rename_node_output(&mut write.source, &prior_node_id, timer_node_id);
    }
    let reaction_proposal = timer_reaction
        .proposal
        .as_mut()
        .expect("BFP EVENT reaction has complete proposal wiring");
    for reference in [
        &mut reaction_proposal.position_intent,
        &mut reaction_proposal.target_variant,
        &mut reaction_proposal.target_position_units,
        &mut reaction_proposal.target_weight_micros,
        &mut reaction_proposal.rebalance_sequence,
        &mut reaction_proposal.reconciliation_target_units,
        &mut reaction_proposal.protection_variant,
        &mut reaction_proposal.stop_loss_ticks,
        &mut reaction_proposal.take_profit_ticks,
        &mut reaction_proposal.trailing_distance_ticks,
        &mut reaction_proposal.trailing_stop_ticks,
    ] {
        rename_node_output(reference, &prior_node_id, timer_node_id);
    }
    if let Some(reference) = &mut reaction_proposal.member_target_set {
        rename_node_output(reference, &prior_node_id, timer_node_id);
    }
    *design
        .reactions
        .iter_mut()
        .find(|reaction| reaction.kind == LifecycleKindV2::Timer)
        .expect("BFP candidate has a TIMER reaction") = timer_reaction;
    let retained_state_ids = design
        .reactions
        .iter()
        .flat_map(|reaction| reaction.state_writes.iter())
        .map(|write| write.state_id.as_str())
        .collect::<Vec<_>>();
    design
        .state
        .retain(|state| retained_state_ids.contains(&state.semantic_id.as_str()));
    design.parameters.push(ParameterV2 {
        semantic_id: "research.parameter.timer-coordinate.v1".to_owned(),
        value_type: ValueTypeV2::Bytes,
        value: TypedConstantV2::Bytes { value: vec![] },
        unit: "OWNER_SAMPLE_COORDINATE_V1".to_owned(),
    });
    design.resources.max_state_bytes = design.state.iter().map(|state| state.max_bytes).sum();

    let (design_identity, design_digest) = match prepare_strategy_design_v2(&design) {
        StrategyDesignPreparationV2::Prepared {
            design_identity,
            design_digest,
        } => (design_identity, design_digest),
        other => panic!("single-plugin BFP design must prepare: {other:?}"),
    };
    proposal.design_identity = design_identity;
    proposal.design_digest = design_digest;
    (design, proposal, catalog)
}

fn rename_node_output(reference: &mut ValueRefV2, prior_node_id: &str, node_id: &str) {
    if let ValueRefV2::NodeOutput {
        node_id: reference_node_id,
        ..
    } = reference
        && reference_node_id == prior_node_id
    {
        *reference_node_id = node_id.to_owned();
    }
}

fn real_v3_plugin_build(
    producer: &mut DevelopPluginBuildProducerV3,
    manifest: &PluginManifestV2,
    frozen: &FrozenResearchBoundedFeatureProgramV1,
) -> VerifiedDevelopPluginBuildReadV3 {
    let first = prepare_frozen_bounded_feature_source_inputs_v1(frozen)
        .expect("first independent lowering");
    let second = prepare_frozen_bounded_feature_source_inputs_v1(frozen)
        .expect("second independent lowering");
    match producer.build(manifest, first, second) {
        DevelopPluginBuildResultV3::Verified(value) => *value,
        DevelopPluginBuildResultV3::Terminal(terminal) => {
            panic!("real V3 plugin build failed: {terminal:?}")
        }
    }
}

fn v3_composer_case(
    design: StrategyDesignV2,
    custody: CurrentResearchDevelopCustodyV2,
    build: VerifiedDevelopPluginBuildReadV3,
) -> (UntrustedDevelopComposerProposalV2, TestEvidencePort) {
    let owner_bindings = bindings(&design);
    let input_binding_receipt_digests = owner_bindings
        .iter()
        .map(|(_, digest)| *digest)
        .collect::<Vec<_>>();
    let verified_bindings = verified_strategy_input_bindings_for_test(&design, owner_bindings);
    let plugin_builds = vec![UntrustedPluginBuildLocatorV2 {
        plugin_semantic_id: design.plugins[0].semantic_id.clone(),
        verified_build_receipt_digest: build.build().verified_build_receipt_digest(),
    }];
    (
        UntrustedDevelopComposerProposalV2 {
            research_request_locator: custody.request_locator().to_owned(),
            design,
            input_binding_receipt_digests,
            plugin_builds,
        },
        TestEvidencePort {
            custody,
            bindings: verified_bindings,
            builds: RefCell::new(vec![build.into_composer_build().into()]),
            binding_terminal: None,
            build_terminal: None,
            research_reads: Cell::new(0),
            binding_reads: Cell::new(0),
            build_reads: Cell::new(0),
        },
    )
}

#[cfg(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "linux", target_arch = "aarch64")
))]
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
    builds: RefCell<Vec<VerifiedDevelopPluginBuildV2OrV3>>,
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

        if request_locator != self.custody.request_locator() {
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
    ) -> Result<Vec<VerifiedDevelopPluginBuildV2OrV3>, DevelopComposerTerminalV2> {
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
            builds: RefCell::new(vec![build.into_composer_build().into()]),
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

fn into_terminal(result: DevelopComposerResultV2) -> DevelopComposerTerminalV2 {
    match result {
        DevelopComposerResultV2::Terminal(terminal) => terminal,
        DevelopComposerResultV2::Composed(_) => panic!("terminal path leaked a positive Artifact"),
    }
}
