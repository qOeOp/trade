use rstest::rstest;

#[cfg(feature = "sealed-strategy-input-acceptance")]
use vibe_data::owner::sealed_acceptance::issue_strategy_input_universe_frame;
use vibe_data::owner::source_binding::BindingDigest;

#[cfg(feature = "sealed-strategy-input-acceptance")]
use crate::program_host_v2_tests::universe_design;
#[cfg(feature = "sealed-strategy-input-acceptance")]
use crate::strategy_plan_v2::compile_strategy_design_v2_for_universe;
use crate::{
    program_host_v2_tests::executable_design,
    strategy_design_v2::{
        InputFactClassV2, LifecycleKindV2, TypedConstantV2, ValueRefV2, ValueTypeV2,
    },
    strategy_design_v2_tests::{bindings, design},
    strategy_plan_v2::{
        CompilationIssueV2, StrategyCompilationV2, StrategyDesignPreparationV2,
        compile_with_binding_and_implementation_receipts_for_test,
        compile_with_binding_projections_for_test,
        corrupt_plugin_implementation_receipt_digest_for_test,
        issue_plugin_implementation_receipt_v2_for_test, plugin_implementation_receipts_for_test,
        prepare_strategy_design_v2, rebind_plugin_manifest_digest_for_test,
        rebind_plugin_module_identity_for_test, strategy_input_role_identity_v2,
    },
};

#[rstest]
fn two_singular_member_receipt_sets_cannot_activate_shared_mode() {
    let mut candidate = executable_design();
    candidate
        .inputs
        .iter_mut()
        .find(|input| input.semantic_id == "research.input.open.v1")
        .unwrap()
        .instrument = "MSFT.XNAS".into();
    let StrategyCompilationV2::Unsupported(issue) =
        compile_with_binding_projections_for_test(candidate.clone(), bindings(&candidate))
    else {
        panic!("singular receipts must not create shared authority")
    };
    assert_eq!(issue.coordinate, "bindings.instrument");
    assert!(issue.reason.contains("UniverseSelection"));
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
#[rstest]
fn actual_owner_selection_compiles_the_canonical_universe_plan() {
    let candidate = universe_design();
    let frame = issue_strategy_input_universe_frame().unwrap();
    let implementations = plugin_implementation_receipts_for_test(&candidate, 71);
    let StrategyCompilationV2::Compiled(plan) =
        compile_strategy_design_v2_for_universe(candidate.clone(), &frame, &implementations)
    else {
        panic!("actual selection compiles")
    };
    assert_eq!(plan.lifecycle_schema_version(), 2);
    assert_eq!(
        plan.kernel_semantics_id(),
        "strategy.lifecycle.shared-kernel.v2"
    );
    assert_eq!(plan.universe_selection().unwrap().members().len(), 2);

    let mut another_design = candidate;
    another_design.intent_digest = BindingDigest::from_untrusted_bytes([91; 32]);
    let StrategyCompilationV2::Unsupported(issue) =
        compile_strategy_design_v2_for_universe(another_design, &frame, &implementations)
    else {
        panic!("Design B must reject Design A sealed role bindings")
    };
    assert_eq!(
        issue.coordinate,
        "universe_bindings.design_or_request_identity"
    );
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
#[rstest]
fn universe_member_scope_rejects_missing_selection_mixed_scope_and_instrument_smuggling() {
    let candidate = universe_design();
    assert!(!matches!(
        compile_with_binding_projections_for_test(candidate.clone(), vec![]),
        StrategyCompilationV2::Compiled(_)
    ));

    let frame = issue_strategy_input_universe_frame().unwrap();
    let mut mixed = candidate.clone();
    mixed.inputs[0].scope = crate::strategy_design_v2::InputScopeV2::ExactInstrument;
    mixed.inputs[0].instrument = "AAPL.XNAS".into();
    let mut smuggled = candidate;
    smuggled.inputs[0].instrument = "AAPL.XNAS".into();
    for invalid in [mixed, smuggled] {
        let implementations = plugin_implementation_receipts_for_test(&invalid, 71);
        assert!(!matches!(
            compile_strategy_design_v2_for_universe(invalid, &frame, &implementations,),
            StrategyCompilationV2::Compiled(_)
        ));
    }
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
#[rstest]
fn universe_bar_event_rejects_more_than_one_compute_node() {
    let mut candidate = universe_design();
    candidate.resources.max_nodes_per_reaction = 2;
    candidate.resources.max_plugin_calls_per_event = 2;
    let bar = reaction_index(&candidate, LifecycleKindV2::Bar);
    let mut extra = candidate.reactions[bar].nodes[0].clone();
    extra.semantic_id = "research.node.universe.extra.v2".into();
    candidate.reactions[bar].nodes.push(extra);
    let frame = issue_strategy_input_universe_frame().unwrap();
    let implementations = plugin_implementation_receipts_for_test(&candidate, 71);
    let StrategyCompilationV2::Unsupported(issue) =
        compile_strategy_design_v2_for_universe(candidate, &frame, &implementations)
    else {
        panic!("bounded universe must reject a second compute node")
    };
    assert_eq!(issue.coordinate, "reactions.nodes");
    assert!(issue.reason.contains("exactly one compute node"));
}

fn assert_unsupported(candidate: crate::strategy_design_v2::StrategyDesignV2) {
    let _ = unsupported_issue(candidate);
}

fn unsupported_issue(candidate: crate::strategy_design_v2::StrategyDesignV2) -> CompilationIssueV2 {
    let StrategyCompilationV2::Unsupported(issue) =
        compile_with_binding_projections_for_test(candidate, vec![])
    else {
        panic!("expected Unsupported and no Plan")
    };
    issue
}

fn reaction_index(
    candidate: &crate::strategy_design_v2::StrategyDesignV2,
    kind: LifecycleKindV2,
) -> usize {
    candidate
        .reactions
        .iter()
        .position(|reaction| reaction.kind == kind)
        .expect("reaction")
}

#[rstest]
fn stateful_trend_lowers_closed_typed_proposal_topology() {
    let candidate = design();
    let bar = reaction_index(&candidate, LifecycleKindV2::Bar);
    let timer = reaction_index(&candidate, LifecycleKindV2::Timer);
    assert_eq!(
        candidate.reactions[bar].state_writes[0].state_id,
        candidate.reactions[timer].state_writes[0].state_id
    );
    assert_eq!(
        candidate.reactions[bar].nodes[0].plugin_semantic_id,
        candidate.reactions[timer].nodes[0].plugin_semantic_id
    );
    let receipts = bindings(&candidate);
    let StrategyCompilationV2::Compiled(first) =
        compile_with_binding_projections_for_test(candidate.clone(), receipts.clone())
    else {
        panic!("stateful trend must compile")
    };
    let StrategyCompilationV2::Compiled(second) =
        compile_with_binding_projections_for_test(candidate, receipts)
    else {
        panic!("exact replay must compile")
    };
    assert_eq!(first, second);
    assert_eq!(first.canonical_bytes(), second.canonical_bytes());

    for capability in [
        "research.trend.warmup.v1",
        "research.trend.enter.v1",
        "research.trend.add.v1",
        "research.trend.reduce.v1",
        "research.trend.trailing.v1",
        "research.trend.timer-exit.v1",
        "kernel.fill.reconcile.v1",
    ] {
        assert!(first.contains_capability(capability), "{capability}");
    }

    for proposal in first
        .reactions()
        .iter()
        .filter_map(|reaction| reaction.proposal.as_ref())
    {
        let payload = serde_json::to_value(proposal).expect("proposal payload JSON");

        for host_sealed_field in [
            "intent_identity",
            "proposal_digest",
            "strategy_state_digest",
            "plugin_state_digest",
        ] {
            assert!(
                payload.get(host_sealed_field).is_none(),
                "{host_sealed_field}"
            );
        }
    }
}

#[rstest]
fn immutable_accessors_are_canonical_and_lowering_bound() {
    let original_design = design();
    let StrategyCompilationV2::Compiled(original) = compile_with_binding_projections_for_test(
        original_design.clone(),
        bindings(&original_design),
    ) else {
        panic!("original design must compile")
    };
    let encoded: serde_json::Value =
        serde_json::from_slice(&original.canonical_bytes()).expect("canonical plan JSON");
    assert_eq!(encoded["schema_version"], original.schema_version());
    assert_eq!(
        encoded["design_identity"],
        serde_json::to_value(original.design_identity()).expect("design identity JSON")
    );
    assert_eq!(
        encoded["design_digest"],
        serde_json::to_value(original.design_digest()).expect("design digest JSON")
    );
    assert_eq!(
        encoded["research_request_identity"],
        serde_json::to_value(original.research_request_identity()).expect("research identity JSON")
    );
    assert_eq!(
        encoded["intent_identity"],
        serde_json::to_value(original.intent_identity()).expect("intent identity JSON")
    );
    assert_eq!(
        encoded["intent_digest"],
        serde_json::to_value(original.intent_digest()).expect("intent digest JSON")
    );
    assert_eq!(
        encoded["market_semantics_identity"],
        serde_json::to_value(original.market_semantics_identity()).expect("market identity JSON")
    );
    assert_eq!(
        encoded["binding_digest"],
        serde_json::to_value(original.binding_digest()).expect("binding digest JSON")
    );
    assert_eq!(
        encoded["capability_closure"],
        serde_json::to_value(original.capability_closure()).expect("capability closure JSON")
    );
    assert_eq!(
        encoded["primitive_abi_version"],
        original.primitive_abi_version()
    );
    assert_eq!(
        encoded["plugin_abi_versions"],
        serde_json::to_value(original.plugin_abi_versions()).expect("plugin ABI JSON")
    );
    assert_eq!(
        encoded["lifecycle_schema_version"],
        original.lifecycle_schema_version()
    );
    assert_eq!(
        encoded["checkpoint_schema_version"],
        original.checkpoint_schema_version()
    );
    assert_eq!(
        encoded["kernel_semantics_id"],
        original.kernel_semantics_id()
    );
    assert_eq!(
        encoded["resources"],
        serde_json::to_value(original.resources()).expect("resources JSON")
    );
    assert_eq!(
        encoded["canonical_design"]["inputs"],
        serde_json::to_value(original.input_roles()).expect("input roles JSON")
    );
    assert_eq!(
        encoded["canonical_design"]["reactions"],
        serde_json::to_value(original.reactions()).expect("reactions JSON")
    );
    assert_eq!(
        encoded["canonical_design"]["plugins"],
        serde_json::to_value(original.canonical_plugin_manifests()).expect("plugins JSON")
    );
    assert_eq!(
        encoded["plugin_implementations"],
        serde_json::to_value(original.plugin_implementations()).expect("implementations JSON")
    );
    assert_eq!(
        encoded["plugin_implementation_digest"],
        serde_json::to_value(original.plugin_implementation_digest())
            .expect("implementation digest JSON")
    );
    assert_eq!(
        encoded["lowering_digest"],
        serde_json::to_value(original.lowering_digest()).expect("lowering digest JSON")
    );

    let mut changed_design = design();
    changed_design.research_request_identity = BindingDigest::from_untrusted_bytes([41; 32]);
    changed_design.intent_identity = BindingDigest::from_untrusted_bytes([42; 32]);
    changed_design.intent_digest = BindingDigest::from_untrusted_bytes([43; 32]);
    changed_design.inputs[0].unit = "PRICE_TICKS".into();
    changed_design.resources.max_dependency_edges -= 1;
    changed_design.plugins[0].max_fuel -= 1;
    let prior_capability = changed_design.capabilities[0].semantic_id.clone();
    let changed_capability = "research.trend.changed.v1".to_owned();
    changed_design.capabilities[0].semantic_id = changed_capability.clone();
    let manifest_capability = changed_design.plugins[0]
        .capability_ids
        .iter_mut()
        .find(|value| **value == prior_capability)
        .expect("manifest capability");
    *manifest_capability = changed_capability;
    let bar = reaction_index(&changed_design, LifecycleKindV2::Bar);
    let proposal = changed_design.reactions[bar]
        .proposal
        .as_mut()
        .expect("BAR proposal");
    std::mem::swap(
        &mut proposal.target_position_units,
        &mut proposal.reconciliation_target_units,
    );
    let changed_bindings = bindings(&changed_design);
    let StrategyCompilationV2::Compiled(changed) =
        compile_with_binding_projections_for_test(changed_design, changed_bindings)
    else {
        panic!("changed design must compile")
    };
    assert_ne!(original.canonical_bytes(), changed.canonical_bytes());
    assert_ne!(original.design_identity(), changed.design_identity());
    assert_ne!(original.design_digest(), changed.design_digest());
    assert_ne!(original.binding_digest(), changed.binding_digest());
    assert_ne!(original.lowering_digest(), changed.lowering_digest());
    assert_ne!(
        original.research_request_identity(),
        changed.research_request_identity()
    );
    assert_ne!(original.intent_identity(), changed.intent_identity());
    assert_ne!(original.intent_digest(), changed.intent_digest());
    assert_ne!(original.capability_closure(), changed.capability_closure());
    assert_ne!(original.resources(), changed.resources());
    assert_ne!(original.input_roles(), changed.input_roles());
    assert_ne!(original.reactions(), changed.reactions());
    assert_ne!(
        original.canonical_plugin_manifests(),
        changed.canonical_plugin_manifests()
    );
    assert_eq!(
        original.market_semantics_identity(),
        changed.market_semantics_identity()
    );
    assert_eq!(
        original.primitive_abi_version(),
        changed.primitive_abi_version()
    );
    assert_eq!(
        original.plugin_abi_versions(),
        changed.plugin_abi_versions()
    );
    assert_eq!(
        original.lifecycle_schema_version(),
        changed.lifecycle_schema_version()
    );
    assert_eq!(
        original.checkpoint_schema_version(),
        changed.checkpoint_schema_version()
    );
    assert_eq!(
        original.kernel_semantics_id(),
        changed.kernel_semantics_id()
    );

    let view = original.execution_view();
    let mut canonical_capabilities = original_design.capabilities.clone();
    canonical_capabilities.sort();
    assert_eq!(view.parameters, original_design.parameters);
    assert_eq!(view.initial_state, original_design.state);
    assert_eq!(view.reactions, original.reactions());
    assert_eq!(view.plugin_contracts, original.canonical_plugin_manifests());
    assert_eq!(view.capability_versions, canonical_capabilities);
    assert_eq!(view.sealed_bindings.len(), original_design.inputs.len());
    let sealed_binding = view
        .sealed_bindings
        .iter()
        .find(|binding| {
            binding.input_role_identity()
                == strategy_input_role_identity_v2(&original_design.inputs[0])
        })
        .expect("close binding");
    assert_eq!(
        sealed_binding.research_request_identity(),
        original.research_request_identity()
    );
    assert_eq!(
        sealed_binding.strategy_design_identity(),
        original.design_identity()
    );
    assert_eq!(
        sealed_binding.field_semantic_id(),
        original_design.inputs[0].field_semantic_id
    );
    assert_eq!(sealed_binding.data_kind(), "BAR");
    assert_eq!(
        sealed_binding.instrument(),
        original_design.inputs[0].instrument
    );
    assert_eq!(sealed_binding.channel(), original_design.inputs[0].channel);
    assert_eq!(
        sealed_binding.timeframe(),
        original_design.inputs[0].timeframe
    );
    assert_eq!(sealed_binding.unit(), original_design.inputs[0].unit);
    assert_eq!(sealed_binding.scale(), original_design.inputs[0].scale);
    assert_eq!(
        sealed_binding.market_semantics_identity(),
        original.market_semantics_identity()
    );
    assert_ne!(
        sealed_binding.input_role_identity(),
        BindingDigest::from_untrusted_bytes([0; 32])
    );
    assert_ne!(
        sealed_binding.receipt_digest(),
        BindingDigest::from_untrusted_bytes([0; 32])
    );
    assert_eq!(
        view.plugin_implementations,
        original.plugin_implementations()
    );
}

fn receipt_capability_versions() -> Vec<(String, u16)> {
    let candidate = design();
    candidate.plugins[0]
        .capability_ids
        .iter()
        .map(|semantic_id| {
            let declaration = candidate
                .capabilities
                .iter()
                .find(|value| value.semantic_id == *semantic_id)
                .expect("declared capability");
            (semantic_id.clone(), declaration.version)
        })
        .collect()
}

#[rstest]
fn implementation_receipts_are_exact_and_content_addressed() {
    let candidate = design();
    let owner_bindings = bindings(&candidate);
    let first_receipts = plugin_implementation_receipts_for_test(&candidate, 81);
    let second_receipts = plugin_implementation_receipts_for_test(&candidate, 82);
    let StrategyCompilationV2::Compiled(first) =
        compile_with_binding_and_implementation_receipts_for_test(
            candidate.clone(),
            owner_bindings.clone(),
            first_receipts,
        )
    else {
        panic!("first implementation must compile")
    };
    let StrategyCompilationV2::Compiled(second) =
        compile_with_binding_and_implementation_receipts_for_test(
            candidate.clone(),
            owner_bindings.clone(),
            second_receipts,
        )
    else {
        panic!("second implementation must compile")
    };
    assert_eq!(first.design_digest(), second.design_digest());
    assert_eq!(first.binding_digest(), second.binding_digest());
    assert_ne!(
        first.plugin_implementations()[0].implementation_capsule_digest(),
        second.plugin_implementations()[0].implementation_capsule_digest()
    );
    assert_ne!(
        first.plugin_implementation_digest(),
        second.plugin_implementation_digest()
    );
    assert_ne!(first.lowering_digest(), second.lowering_digest());
    assert_ne!(first.canonical_bytes(), second.canonical_bytes());
    assert_ne!(
        first.canonical_plan_digest(),
        second.canonical_plan_digest()
    );
    assert_eq!(first.canonical_plan_digest(), first.canonical_plan_digest());
    let first_plan_json: serde_json::Value =
        serde_json::from_slice(&first.canonical_bytes()).expect("canonical plan JSON");
    assert!(first_plan_json.get("canonical_plan_digest").is_none());
    let implementation = &first.plugin_implementations()[0];
    assert_eq!(
        implementation.plugin_semantic_id(),
        candidate.plugins[0].semantic_id
    );
    assert_eq!(
        implementation.export_identity(),
        "strategy.plugin.compute.v2"
    );
    assert_eq!(
        implementation.abi_version(),
        candidate.plugins[0].abi_version
    );

    for bound_digest in [
        implementation.manifest_digest(),
        implementation.implementation_capsule_digest(),
        implementation.source_entry_digest(),
        implementation.module_digest(),
        implementation.module_identity(),
        implementation.verified_build_receipt_digest(),
    ] {
        assert_ne!(bound_digest, BindingDigest::from_untrusted_bytes([0; 32]));
    }
    assert_eq!(
        implementation.capability_versions().len(),
        candidate.plugins[0].capability_ids.len()
    );
    assert!(
        implementation
            .capability_versions()
            .iter()
            .all(|value| value.version() == 1 && !value.semantic_id().is_empty())
    );
    assert_ne!(
        implementation.receipt_digest(),
        BindingDigest::from_untrusted_bytes([0; 32])
    );

    for receipt in [
        issue_plugin_implementation_receipt_v2_for_test(
            &candidate.plugins[0],
            BindingDigest::from_untrusted_bytes([81; 32]),
            BindingDigest::from_untrusted_bytes([100; 32]),
            BindingDigest::from_untrusted_bytes([83; 32]),
            BindingDigest::from_untrusted_bytes([84; 32]),
            "strategy.plugin.compute.v2",
            2,
            receipt_capability_versions(),
        ),
        issue_plugin_implementation_receipt_v2_for_test(
            &candidate.plugins[0],
            BindingDigest::from_untrusted_bytes([81; 32]),
            BindingDigest::from_untrusted_bytes([82; 32]),
            BindingDigest::from_untrusted_bytes([101; 32]),
            BindingDigest::from_untrusted_bytes([84; 32]),
            "strategy.plugin.compute.v2",
            2,
            receipt_capability_versions(),
        ),
        issue_plugin_implementation_receipt_v2_for_test(
            &candidate.plugins[0],
            BindingDigest::from_untrusted_bytes([81; 32]),
            BindingDigest::from_untrusted_bytes([82; 32]),
            BindingDigest::from_untrusted_bytes([83; 32]),
            BindingDigest::from_untrusted_bytes([102; 32]),
            "strategy.plugin.compute.v2",
            2,
            receipt_capability_versions(),
        ),
    ] {
        let StrategyCompilationV2::Compiled(changed_build) =
            compile_with_binding_and_implementation_receipts_for_test(
                candidate.clone(),
                owner_bindings.clone(),
                vec![receipt],
            )
        else {
            panic!("changed verified implementation must compile")
        };
        assert_eq!(first.design_digest(), changed_build.design_digest());
        assert_eq!(first.binding_digest(), changed_build.binding_digest());
        assert_ne!(
            first.plugin_implementation_digest(),
            changed_build.plugin_implementation_digest()
        );
        assert_ne!(first.lowering_digest(), changed_build.lowering_digest());
        assert_ne!(first.canonical_bytes(), changed_build.canonical_bytes());
    }

    let missing = compile_with_binding_and_implementation_receipts_for_test(
        candidate.clone(),
        owner_bindings.clone(),
        vec![],
    );
    assert!(matches!(
        missing,
        StrategyCompilationV2::Unsupported(issue)
            if issue.coordinate == "plugin_implementations"
    ));

    let valid = plugin_implementation_receipts_for_test(&candidate, 83)[0].clone();
    let duplicate = compile_with_binding_and_implementation_receipts_for_test(
        candidate.clone(),
        owner_bindings.clone(),
        vec![valid.clone(), valid],
    );
    assert!(matches!(
        duplicate,
        StrategyCompilationV2::Unsupported(issue) if issue.reason.contains("duplicate")
    ));

    let mut foreign_plugin = candidate.plugins[0].clone();
    foreign_plugin.semantic_id = "research.plugin.foreign.v1".into();

    for (coordinate, receipt) in [
        (
            "plugin_implementations.plugin_semantic_id",
            issue_plugin_implementation_receipt_v2_for_test(
                &foreign_plugin,
                BindingDigest::from_untrusted_bytes([84; 32]),
                BindingDigest::from_untrusted_bytes([85; 32]),
                BindingDigest::from_untrusted_bytes([86; 32]),
                BindingDigest::from_untrusted_bytes([87; 32]),
                "strategy.plugin.compute.v2",
                2,
                receipt_capability_versions(),
            ),
        ),
        (
            "plugin_implementations.export_identity",
            issue_plugin_implementation_receipt_v2_for_test(
                &candidate.plugins[0],
                BindingDigest::from_untrusted_bytes([88; 32]),
                BindingDigest::from_untrusted_bytes([89; 32]),
                BindingDigest::from_untrusted_bytes([90; 32]),
                BindingDigest::from_untrusted_bytes([91; 32]),
                "strategy.plugin.compute.foreign.v2",
                2,
                receipt_capability_versions(),
            ),
        ),
        (
            "plugin_implementations.abi_version",
            issue_plugin_implementation_receipt_v2_for_test(
                &candidate.plugins[0],
                BindingDigest::from_untrusted_bytes([92; 32]),
                BindingDigest::from_untrusted_bytes([93; 32]),
                BindingDigest::from_untrusted_bytes([94; 32]),
                BindingDigest::from_untrusted_bytes([95; 32]),
                "strategy.plugin.compute.v2",
                1,
                receipt_capability_versions(),
            ),
        ),
        (
            "plugin_implementations.capability_versions",
            issue_plugin_implementation_receipt_v2_for_test(
                &candidate.plugins[0],
                BindingDigest::from_untrusted_bytes([96; 32]),
                BindingDigest::from_untrusted_bytes([97; 32]),
                BindingDigest::from_untrusted_bytes([98; 32]),
                BindingDigest::from_untrusted_bytes([99; 32]),
                "strategy.plugin.compute.v2",
                2,
                vec![("research.trend.warmup.v1".into(), 99)],
            ),
        ),
    ] {
        assert!(matches!(
            compile_with_binding_and_implementation_receipts_for_test(
                candidate.clone(),
                owner_bindings.clone(),
                vec![receipt],
            ),
            StrategyCompilationV2::Unsupported(issue) if issue.coordinate == coordinate
        ));
    }

    let mut corrupt = plugin_implementation_receipts_for_test(&candidate, 88)[0].clone();
    corrupt_plugin_implementation_receipt_digest_for_test(&mut corrupt);
    assert!(matches!(
        compile_with_binding_and_implementation_receipts_for_test(
            candidate.clone(),
            owner_bindings,
            vec![corrupt],
        ),
        StrategyCompilationV2::Unsupported(issue)
            if issue.coordinate == "plugin_implementations.receipt_digest"
    ));

    let mut wrong_manifest = plugin_implementation_receipts_for_test(&candidate, 89)[0].clone();
    rebind_plugin_manifest_digest_for_test(
        &mut wrong_manifest,
        BindingDigest::from_untrusted_bytes([201; 32]),
    );
    assert!(matches!(
        compile_with_binding_and_implementation_receipts_for_test(
            candidate.clone(),
            bindings(&candidate),
            vec![wrong_manifest],
        ),
        StrategyCompilationV2::Unsupported(issue)
            if issue.coordinate == "plugin_implementations.manifest_digest"
    ));

    let mut wrong_module_identity =
        plugin_implementation_receipts_for_test(&candidate, 90)[0].clone();
    rebind_plugin_module_identity_for_test(
        &mut wrong_module_identity,
        BindingDigest::from_untrusted_bytes([202; 32]),
    );
    assert!(matches!(
        compile_with_binding_and_implementation_receipts_for_test(
            candidate.clone(),
            bindings(&candidate),
            vec![wrong_module_identity],
        ),
        StrategyCompilationV2::Unsupported(issue)
            if issue.coordinate == "plugin_implementations.module_identity"
    ));

    let zero_source = issue_plugin_implementation_receipt_v2_for_test(
        &candidate.plugins[0],
        BindingDigest::from_untrusted_bytes([203; 32]),
        BindingDigest::from_untrusted_bytes([0; 32]),
        BindingDigest::from_untrusted_bytes([204; 32]),
        BindingDigest::from_untrusted_bytes([205; 32]),
        "strategy.plugin.compute.v2",
        2,
        receipt_capability_versions(),
    );
    assert!(matches!(
        compile_with_binding_and_implementation_receipts_for_test(
            candidate.clone(),
            bindings(&candidate),
            vec![zero_source],
        ),
        StrategyCompilationV2::Unsupported(issue)
            if issue.coordinate == "plugin_implementations.content_digests"
    ));
}

#[rstest]
fn top_level_and_port_permutations_preserve_design_and_plan_bytes() {
    let first = design();
    let StrategyDesignPreparationV2::Prepared {
        design_identity: first_identity,
        ..
    } = prepare_strategy_design_v2(&first)
    else {
        panic!("first preparation")
    };
    let first_bindings = bindings(&first);
    let StrategyCompilationV2::Compiled(first_plan) =
        compile_with_binding_projections_for_test(first, first_bindings)
    else {
        panic!("first compile")
    };

    let mut second = design();
    second.reactions.reverse();
    second.capabilities.reverse();
    second.plugins[0].input_ports.reverse();
    second.plugins[0].output_ports.reverse();
    second.plugins[0].capability_ids.reverse();
    for reaction in &mut second.reactions {
        reaction.state_writes.reverse();
        for node in &mut reaction.nodes {
            node.input_bindings.reverse();
            node.output_port_ids.reverse();
        }
    }
    let StrategyDesignPreparationV2::Prepared {
        design_identity: second_identity,
        ..
    } = prepare_strategy_design_v2(&second)
    else {
        panic!("second preparation")
    };
    let mut second_bindings = bindings(&second);
    second_bindings.reverse();
    let StrategyCompilationV2::Compiled(second_plan) =
        compile_with_binding_projections_for_test(second, second_bindings)
    else {
        panic!("second compile")
    };
    assert_eq!(first_identity, second_identity);
    assert_eq!(first_plan.canonical_bytes(), second_plan.canonical_bytes());
}

#[rstest]
fn missing_input_state_type_and_binding_coverage_fail_closed() {
    let mut missing_input = design();
    let bar = reaction_index(&missing_input, LifecycleKindV2::Bar);
    missing_input.reactions[bar].nodes[0].input_bindings[0].source = ValueRefV2::Input {
        input_id: "research.input.missing.v1".into(),
    };
    assert_unsupported(missing_input);

    let mut state_type = design();
    state_type.state[0].value_type = ValueTypeV2::I64;
    state_type.state[0].initial = TypedConstantV2::I64 { value: 0 };
    assert_unsupported(state_type);

    let candidate = design();
    assert!(matches!(
        compile_with_binding_projections_for_test(candidate.clone(), vec![]),
        StrategyCompilationV2::Unsupported(issue) if issue.coordinate == "bindings"
    ));
    let mut mismatch = bindings(&candidate);
    mismatch[0].0.instrument = "WRONG.XNAS".into();
    mismatch[0].1 = BindingDigest::from_untrusted_bytes([77; 32]);
    assert!(matches!(
        compile_with_binding_projections_for_test(candidate, mismatch),
        StrategyCompilationV2::Unsupported(_)
    ));
}

#[rstest]
fn proposal_port_and_unconsumed_trailing_output_fail_closed() {
    let mut missing_port = design();
    let bar = reaction_index(&missing_port, LifecycleKindV2::Bar);
    missing_port.reactions[bar]
        .proposal
        .as_mut()
        .expect("proposal")
        .position_intent = ValueRefV2::NodeOutput {
        node_id: "research.node.bar.v1".into(),
        port_id: "proposal.missing.v1".into(),
    };
    assert_unsupported(missing_port);

    let mut trailing = design();
    let bar = reaction_index(&trailing, LifecycleKindV2::Bar);
    trailing.reactions[bar]
        .proposal
        .as_mut()
        .expect("proposal")
        .trailing_stop_ticks = ValueRefV2::NodeOutput {
        node_id: "research.node.bar.v1".into(),
        port_id: "proposal.stop-loss.v1".into(),
    };
    assert_unsupported(trailing);
}

#[rstest]
fn forward_cycle_state_ownership_and_cross_reaction_refs_fail_closed() {
    let mut forward = design();
    forward.plugins[0].max_invocations_per_event = 2;
    let bar = reaction_index(&forward, LifecycleKindV2::Bar);
    let mut later = forward.reactions[bar].nodes[0].clone();
    later.semantic_id = "research.node.bar-later.v1".into();
    forward.reactions[bar].nodes[0].input_bindings[0].source = ValueRefV2::NodeOutput {
        node_id: later.semantic_id.clone(),
        port_id: "proposal.target-position.v1".into(),
    };
    forward.reactions[bar].nodes.push(later);
    assert!(unsupported_issue(forward).reason.contains("forward"));

    let mut cycle = design();
    let bar = reaction_index(&cycle, LifecycleKindV2::Bar);
    cycle.reactions[bar].nodes[0].input_bindings[0].source = ValueRefV2::NodeOutput {
        node_id: "research.node.bar.v1".into(),
        port_id: "proposal.target-position.v1".into(),
    };
    assert!(unsupported_issue(cycle).reason.contains("forward"));

    let mut multiwriter = design();
    let bar = reaction_index(&multiwriter, LifecycleKindV2::Bar);
    let duplicate_write = multiwriter.reactions[bar].state_writes[0].clone();
    multiwriter.reactions[bar]
        .state_writes
        .push(duplicate_write);
    assert!(
        unsupported_issue(multiwriter)
            .reason
            .contains("same reaction")
    );

    let mut second_owner = design();
    let mut second_plugin = second_owner.plugins[0].clone();
    second_plugin.semantic_id = "research.plugin.second-owner.v1".into();
    second_owner.plugins.push(second_plugin);
    let timer = reaction_index(&second_owner, LifecycleKindV2::Timer);
    second_owner.reactions[timer].nodes[0].plugin_semantic_id =
        "research.plugin.second-owner.v1".into();
    assert!(
        unsupported_issue(second_owner)
            .reason
            .contains("different plugin owner")
    );

    let mut cross = design();
    let bar = reaction_index(&cross, LifecycleKindV2::Bar);
    cross.reactions[bar]
        .proposal
        .as_mut()
        .expect("proposal")
        .position_intent = ValueRefV2::NodeOutput {
        node_id: "research.node.event.v1".into(),
        port_id: "proposal.position-intent.v1".into(),
    };
    assert!(unsupported_issue(cross).reason.contains("cross-reaction"));
}

#[rstest]
fn incomplete_plugin_port_and_unbounded_manifest_fail_closed() {
    let mut incomplete = design();
    let bar = reaction_index(&incomplete, LifecycleKindV2::Bar);
    incomplete.reactions[bar].nodes[0].output_port_ids.pop();
    assert_unsupported(incomplete);

    let mut duplicate = design();
    duplicate.plugins[0].input_ports[1] = duplicate.plugins[0].input_ports[0].clone();
    assert_unsupported(duplicate);

    let mut unbounded = design();
    unbounded.plugins[0].max_fuel = u64::MAX;
    assert_unsupported(unbounded);

    let mut edges = design();
    edges.resources.max_dependency_edges = 1;
    assert_unsupported(edges);
}

#[rstest]
fn proposal_lifecycle_and_fixed_fill_boundaries_fail_closed() {
    let mut missing = design();
    let event = reaction_index(&missing, LifecycleKindV2::Event);
    missing.reactions[event].proposal = None;
    assert!(matches!(
        compile_with_binding_projections_for_test(missing, vec![]),
        StrategyCompilationV2::NeedsResearchRefinement(_)
    ));

    let mut start = design();
    let bar = reaction_index(&start, LifecycleKindV2::Bar);
    let start_index = reaction_index(&start, LifecycleKindV2::Start);
    let proposal = start.reactions[bar].proposal.clone();
    start.reactions[start_index].proposal = proposal;
    assert_unsupported(start);

    let mut start_node = design();
    let bar = reaction_index(&start_node, LifecycleKindV2::Bar);
    let start_index = reaction_index(&start_node, LifecycleKindV2::Start);
    let mut nodes = start_node.reactions[bar].nodes.clone();
    nodes[0].semantic_id = "research.node.start.v1".into();
    start_node.reactions[start_index].nodes = nodes;
    assert!(unsupported_issue(start_node).reason.contains("kernel-only"));

    let mut stop_state = design();
    let bar = reaction_index(&stop_state, LifecycleKindV2::Bar);
    let stop_index = reaction_index(&stop_state, LifecycleKindV2::Stop);
    let state_writes = stop_state.reactions[bar].state_writes.clone();
    stop_state.reactions[stop_index].state_writes = state_writes;
    assert!(unsupported_issue(stop_state).reason.contains("kernel-only"));

    let mut fill = design();
    let bar = reaction_index(&fill, LifecycleKindV2::Bar);
    let fill_index = reaction_index(&fill, LifecycleKindV2::Fill);
    let nodes = fill.reactions[bar].nodes.clone();
    fill.reactions[fill_index].nodes = nodes;
    assert_unsupported(fill);

    let mut timer_input = design();
    let timer = reaction_index(&timer_input, LifecycleKindV2::Timer);
    timer_input.reactions[timer].nodes[0].input_bindings[0].source = ValueRefV2::Input {
        input_id: "research.input.close.v1".into(),
    };
    assert!(
        unsupported_issue(timer_input)
            .reason
            .contains("Time/Scheduler")
    );

    let mut wrong_bar_owner = design();
    wrong_bar_owner.inputs[0].fact_class = InputFactClassV2::Portfolio;
    assert!(
        unsupported_issue(wrong_bar_owner)
            .reason
            .contains("Market Data Owner frame")
    );

    let mut unreachable_event = design();
    unreachable_event.inputs[1].field_semantic_id = "MARKET_DATA.BAR.OPEN.PRICE.V1".into();
    let owner_bindings = bindings(&unreachable_event);
    let StrategyCompilationV2::Unsupported(issue) =
        compile_with_binding_projections_for_test(unreachable_event, owner_bindings)
    else {
        panic!("unreachable Owner trigger must be unsupported")
    };
    assert!(
        issue.reason.contains("cannot issue this reaction trigger"),
        "{}",
        issue.reason
    );
}
