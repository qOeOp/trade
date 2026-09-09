use std::cell::{Cell, RefCell};

use rstest::rstest;
#[cfg(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "linux", target_arch = "aarch64")
))]
use strategy_factory_program_sdk::lifecycle_v1::{
    EnvelopePayloadV1, EventOrderKeyV1, LifecycleEnvelopeV1, LifecycleKind,
};
use vibe_data::owner::source_binding::BindingDigest;

use super::{
    cargo_artifact::{PluginCargoBuildEvidenceV2, VerifiedPluginCargoBuildV2},
    develop_composer_v2::{
        CurrentResearchDevelopCustodyV2, DevelopComposerEvidencePortV2, DevelopComposerResultV2,
        DevelopComposerTerminalKindV2, DevelopComposerTerminalV2, DevelopComposerV2,
        UntrustedDevelopComposerProposalV2, UntrustedPluginBuildLocatorV2,
        VerifiedDevelopPluginBuildV2OrV3,
    },
    develop_plugin_build_v2::portable_sealed_composer_test_evidence,
    program_host_v2::ProgramHostV2,
    program_host_v2_backtest_tests::stateful_plugin_module,
    program_host_v2_tests::executable_design,
    strategy_design_v2::{ParameterV2, PluginManifestV2, TypedConstantV2, ValueRefV2, ValueTypeV2},
    strategy_design_v2_tests::bindings,
    strategy_plan_v2::{
        StrategyDesignPreparationV2, VerifiedStrategyInputBindingsV2, prepare_strategy_design_v2,
        verified_strategy_input_bindings_for_test,
    },
};

#[cfg(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "linux", target_arch = "aarch64")
))]
use super::{
    artifact_v2::StrategyArtifactV2,
    bounded_feature_program_lowerer_v1::prepare_frozen_bounded_feature_source_inputs_v1,
    bounded_feature_program_v1::tests::candidate as bfp_candidate,
    develop_plugin_build_v3::{
        DevelopPluginBuildProducerV3, DevelopPluginBuildReceiptV3, DevelopPluginBuildResultV3,
        VerifiedDevelopPluginBuildReadV3,
    },
    plugin_wire_v2::TypedValueV2,
    program_host_v2::AdmittedProgramEventV2,
    rd_bounded_feature_program_v1::{
        FrozenResearchBoundedFeatureProgramV1, freeze_research_bounded_feature_program_v1,
    },
    strategy_design_v2::{LifecycleKindV2, StrategyDesignV2},
    strategy_plan_v2::durable_decode,
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
#[cfg(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "linux", target_arch = "aarch64")
))]
fn real_v3_owner_build_reaches_composer_program_host_and_durable_abi3_artifact() {
    let (design, mut bfp_proposal, catalog) = bfp_composer_candidate();
    let state_id = design.state[0].semantic_id.clone();
    let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);

    let mut mismatched_producer = DevelopPluginBuildProducerV3::default();
    let mismatched_frozen = freeze_research_bounded_feature_program_v1(
        &custody,
        &design,
        bfp_proposal.clone(),
        catalog,
    )
    .expect("joint Owner BFP freeze with a stale static binding receipt");
    let mismatched_build = real_v3_plugin_build(
        &mut mismatched_producer,
        &design.plugins[0],
        &mismatched_frozen,
    );
    let (mismatched_proposal, mismatched_evidence) =
        v3_composer_case(design.clone(), custody.clone(), mismatched_build);
    let terminal = into_terminal(DevelopComposerV2::default().compose(
        &mismatched_proposal,
        9,
        &mismatched_evidence,
    ));
    assert_eq!(terminal.kind, DevelopComposerTerminalKindV2::Unsupported);
    assert_eq!(
        terminal.coordinate,
        "plugin_builds.static_binding_receipt_digest"
    );

    let current_binding = bindings(&design)
        .into_iter()
        .find(|(role, _)| role.semantic_id == bfp_proposal.inputs[0].input_role_id)
        .expect("BFP input has one current Owner binding")
        .1;
    bfp_proposal.inputs[0].static_binding_receipt_digest = current_binding;
    let mut producer = DevelopPluginBuildProducerV3::default();
    let frozen =
        freeze_research_bounded_feature_program_v1(&custody, &design, bfp_proposal, catalog)
            .expect("joint Owner BFP freeze");
    let manifest = design.plugins[0].clone();

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

    assert_eq!(manifest.state.max_bytes, 4096);
    let mut host = ProgramHostV2::new(positive.plan().clone(), restarted.clone())
        .expect("generated ABI3 Artifact reaches ProgramHost");
    let start = LifecycleEnvelopeV1::new_bound(
        EventOrderKeyV1::new(1, 1, LifecycleKind::Start, 1, [1; 16]).expect("START order key"),
        EnvelopePayloadV1::Start,
    )
    .expect("START envelope");
    host.apply_event(&AdmittedProgramEventV2::issue_for_plan_test(
        positive.plan(),
        start,
        vec![],
    ))
    .expect("ProgramHost starts the generated ABI3 program");
    let pre_execution_checkpoint = host.checkpoint().canonical_bytes().to_vec();
    let bar = LifecycleEnvelopeV1::new_bound(
        EventOrderKeyV1::new(2, 2, LifecycleKind::Bar, 2, [2; 16]).expect("BAR order key"),
        EnvelopePayloadV1::Bar,
    )
    .expect("BAR envelope");
    host.apply_event(
        &AdmittedProgramEventV2::issue_for_plan_test_with_owner_sample_projection(
            positive.plan(),
            bar,
            vec![("research.input.close.v1", TypedValueV2::i128(100))],
        ),
    )
    .expect("ProgramHost executes the generated ABI3 program");
    assert_eq!(host.plugin_calls(), 1);
    assert_ne!(
        host.checkpoint().canonical_bytes(),
        pre_execution_checkpoint
    );
    let (strategy_state, plugin_state) = host.state_pair_for_test(&state_id);
    assert_eq!(strategy_state.len(), 1);
    assert_eq!(strategy_state, plugin_state);
    let committed_state = strategy_state.to_vec();
    let restored_host =
        ProgramHostV2::restore(positive.plan().clone(), restarted, host.checkpoint())
            .expect("ProgramHost restores the committed one-byte ABI3 state");
    assert_eq!(
        restored_host.state_pair_for_test(&state_id),
        (committed_state.as_slice(), committed_state.as_slice())
    );

    let cross_design_build = real_v3_plugin_build(&mut producer, &manifest, &frozen);
    let mut cross_design = design.clone();
    cross_design.resources.max_dependency_edges += 1;
    let (cross_design_proposal, cross_design_evidence) =
        v3_composer_case(cross_design, custody.clone(), cross_design_build);
    let terminal = into_terminal(DevelopComposerV2::default().compose(
        &cross_design_proposal,
        11,
        &cross_design_evidence,
    ));
    assert_eq!(terminal.kind, DevelopComposerTerminalKindV2::Unsupported);
    assert_eq!(terminal.coordinate, "plugin_builds.joint_freeze_digest");

    let wrong_manifest_build = real_v3_plugin_build(&mut producer, &manifest, &frozen);
    let mut wrong_design = design.clone();
    wrong_design.plugins[0].max_fuel -= 1;
    let (wrong_proposal, wrong_evidence) =
        v3_composer_case(wrong_design, custody.clone(), wrong_manifest_build);
    let terminal =
        into_terminal(DevelopComposerV2::default().compose(&wrong_proposal, 12, &wrong_evidence));
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
        13,
        &cross_tag_evidence,
    ));
    assert_eq!(terminal.kind, DevelopComposerTerminalKindV2::Unsupported);
    assert_eq!(terminal.coordinate, "plugin_builds.manifest_digest");
}

#[test]
fn abi3_bfp_parameter_inputs_cannot_bypass_market_owner_roles() {
    let (mut design, proposal, _) = bfp_candidate();
    let bfp_plugin = proposal.plugin_semantic_id;
    for reaction in &mut design.reactions {
        for node in &mut reaction.nodes {
            if node.plugin_semantic_id != bfp_plugin {
                continue;
            }
            node.input_bindings[0].source = ValueRefV2::Parameter {
                parameter_id: "research.parameter.fabricated-value.v1".to_owned(),
            };
            node.input_bindings[1].source = ValueRefV2::Parameter {
                parameter_id: "research.parameter.fabricated-coordinate.v1".to_owned(),
            };
        }
    }
    design.parameters = vec![
        ParameterV2 {
            semantic_id: "research.parameter.fabricated-value.v1".to_owned(),
            value_type: ValueTypeV2::I128,
            value: TypedConstantV2::I128 { value: 100 },
            unit: "PRICE".to_owned(),
        },
        ParameterV2 {
            semantic_id: "research.parameter.fabricated-coordinate.v1".to_owned(),
            value_type: ValueTypeV2::Bytes,
            value: TypedConstantV2::Bytes {
                value: vec![1; 308],
            },
            unit: "OWNER_SAMPLE_COORDINATE_V1".to_owned(),
        },
    ];
    assert!(matches!(
        prepare_strategy_design_v2(&design),
        StrategyDesignPreparationV2::Unsupported(issue)
            if issue.coordinate == "reactions.nodes.input"
    ));
}

#[cfg(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "linux", target_arch = "aarch64")
))]
fn bfp_composer_candidate() -> (
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
        if reaction.kind != LifecycleKindV2::Bar {
            reaction.nodes.clear();
        }
        if reaction.nodes.is_empty() {
            reaction.state_writes.clear();
            reaction.proposal = None;
        }
    }
    design.parameters.clear();
    let retained_state_ids = design
        .reactions
        .iter()
        .flat_map(|reaction| reaction.state_writes.iter())
        .map(|write| write.state_id.as_str())
        .collect::<Vec<_>>();
    design
        .state
        .retain(|state| retained_state_ids.contains(&state.semantic_id.as_str()));
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

#[cfg(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "linux", target_arch = "aarch64")
))]
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

#[cfg(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "linux", target_arch = "aarch64")
))]
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
    let bfp_plugin_semantic_id = build.build().plugin_semantic_id().to_owned();
    let plugin_builds = vec![UntrustedPluginBuildLocatorV2 {
        plugin_semantic_id: bfp_plugin_semantic_id.clone(),
        verified_build_receipt_digest: build.build().verified_build_receipt_digest(),
    }];
    let builds = vec![build.into_composer_build().into()];
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
            builds: RefCell::new(builds),
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

#[cfg(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "linux", target_arch = "aarch64")
))]
fn into_terminal(result: DevelopComposerResultV2) -> DevelopComposerTerminalV2 {
    match result {
        DevelopComposerResultV2::Terminal(terminal) => terminal,
        DevelopComposerResultV2::Composed(_) => panic!("terminal path leaked a positive Artifact"),
    }
}
