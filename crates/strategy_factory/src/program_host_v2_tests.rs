use rstest::rstest;
use strategy_factory_program_sdk::lifecycle_v1::{
    EnvelopePayloadV1, EventOrderKeyV1, LifecycleEnvelopeV1, LifecycleKind, PositionIntentV1,
    ProtectionProposalV1, TargetProposalV1,
};
use strategy_factory_program_sdk::lifecycle_v2::{
    InstrumentKeyV2, InstrumentTargetSetV2, MemberTargetV2,
};
use vibe_data::owner::source_binding::BindingDigest;
#[cfg(feature = "sealed-strategy-input-acceptance")]
use vibe_data::owner::{
    sealed_acceptance::issue_strategy_input_universe_frame,
    strategy_input_binding::StrategyInputUniverseFrameReceipt,
};

#[cfg(feature = "sealed-strategy-input-acceptance")]
use super::program_host_v2::admit_market_data_universe_program_event_v2;
#[cfg(feature = "sealed-strategy-input-acceptance")]
use super::strategy_plan_v2::{
    compile_strategy_design_v2_for_universe, corrupt_universe_binding_digest_for_test,
};
use super::{
    artifact_v2::StrategyArtifactV2,
    cargo_artifact::{PluginCargoBuildEvidenceV2, VerifiedPluginCargoBuildV2},
    plugin_wire_v2::{PluginFrameKindV2, PluginFrameV2, TypedValueV2},
    program_host_v2::{
        AdmittedProgramEventV2, ProgramHostV2, corrupt_checkpoint_bytes_for_test,
        corrupt_last_plugin_state_and_reseal_for_test,
    },
    strategy_design_v2::{
        LifecycleKindV2, PluginManifestV2, PortBindingV2, PortContractV2, StateCellV2,
        TypedConstantV2, ValueRefV2, ValueTypeV2,
    },
    strategy_design_v2_tests::{bindings, design},
    strategy_plan_v2::{
        StrategyCompilationV2, StrategyPlanV2,
        compile_with_binding_and_implementation_receipts_for_test,
        issue_plugin_implementation_receipt_v2_for_test,
    },
};

#[rstest]
fn canonical_plugin_frame_rejects_noncanonical_header_order_type_and_trailing_bytes() {
    for value_type in [
        ValueTypeV2::PositionIntentV1,
        ValueTypeV2::TargetVariantV1,
        ValueTypeV2::ProtectionVariantV1,
    ] {
        assert!(TypedValueV2::new(value_type, b"kernel.unknown.v1".as_slice()).is_err());
    }
    let manifest = executable_design().plugins.remove(0);
    let frame = output_frame(&manifest);
    let bytes = frame.encode(&manifest).expect("canonical output");
    assert_eq!(
        bytes.len(),
        96 + u32::from_le_bytes(bytes[92..96].try_into().unwrap()) as usize
    );
    assert_eq!(
        PluginFrameV2::decode_exact(
            &bytes,
            PluginFrameKindV2::Output,
            &manifest,
            frame.manifest_digest,
            frame.module_identity,
            frame.invocation_identity,
        )
        .unwrap(),
        frame
    );

    for offset in [6, 90, 96] {
        let mut tampered = bytes.clone();
        tampered[offset] ^= 1;
        assert!(
            PluginFrameV2::decode_exact(
                &tampered,
                PluginFrameKindV2::Output,
                &manifest,
                frame.manifest_digest,
                frame.module_identity,
                frame.invocation_identity,
            )
            .is_err()
        );
    }
    let mut trailing = bytes;
    trailing.push(0);
    assert!(
        PluginFrameV2::decode_exact(
            &trailing,
            PluginFrameKindV2::Output,
            &manifest,
            frame.manifest_digest,
            frame.module_identity,
            frame.invocation_identity,
        )
        .is_err()
    );
}

#[rstest]
fn generic_host_is_atomic_replay_safe_and_restart_deterministic() {
    let (plan, artifact) = fixture();
    let mut host = ProgramHostV2::new(plan.clone(), artifact.clone()).unwrap();
    host.apply_event(&admitted(&plan, envelope(1, LifecycleKind::Start), None))
        .unwrap();
    let bar = envelope(2, LifecycleKind::Bar);
    let input = admitted(&plan, bar, Some((10_000, 9_000)));
    let trace = host.apply_event(&input).unwrap();
    assert_eq!(trace.position_intent, PositionIntentV1::Hold);
    assert_eq!(host.plugin_calls(), 1);
    let checkpoint = host.checkpoint().clone();
    let changed_time = envelope_with_order(2, 3, LifecycleKind::Bar, 2, [2; 16]);
    let mut corrupt = input.clone();
    corrupt.corrupt_envelope_for_test(changed_time);
    assert!(host.apply_event(&corrupt).is_err());
    let changed_sequence = envelope_with_order(2, 2, LifecycleKind::Bar, 3, [2; 16]);
    corrupt.corrupt_envelope_for_test(changed_sequence);
    assert!(host.apply_event(&corrupt).is_err());
    let mut changed_trigger = input.clone();
    changed_trigger.corrupt_trigger_for_test();
    assert!(host.apply_event(&changed_trigger).is_err());
    assert_eq!(host.plugin_calls(), 1);
    assert_eq!(host.checkpoint(), &checkpoint);
    let missing = admitted(&plan, bar, None);
    assert!(host.apply_event(&missing).is_err());
    let mismatched = admitted(&plan, bar, Some((10_001, 9_000)));
    assert!(host.apply_event(&mismatched).is_err());
    assert_eq!(host.plugin_calls(), 1, "failed joins invoke no guest");
    assert_eq!(host.checkpoint(), &checkpoint);
    let replay = host.apply_event(&input).unwrap();
    assert_eq!(replay.encode(), trace.encode());
    assert_eq!(host.plugin_calls(), 1, "exact replay invokes no guest");
    assert_eq!(host.checkpoint(), &checkpoint);

    let mut restarted =
        ProgramHostV2::restore(plan.clone(), artifact.clone(), &checkpoint).unwrap();
    assert_eq!(
        restarted.apply_event(&input).unwrap().encode(),
        trace.encode()
    );
    assert_eq!(restarted.plugin_calls(), 1);
    let next = envelope(3, LifecycleKind::Bar);
    let next_input = admitted(&plan, next, Some((10_200, 9_100)));
    let uninterrupted = host.apply_event(&next_input).unwrap();
    let restored = restarted.apply_event(&next_input).unwrap();
    assert_eq!(uninterrupted.encode(), restored.encode());
    assert_eq!(
        host.checkpoint().canonical_bytes(),
        restarted.checkpoint().canonical_bytes()
    );

    let mut tampered_bundle = checkpoint.clone();
    corrupt_checkpoint_bytes_for_test(&mut tampered_bundle);
    assert!(ProgramHostV2::restore(plan.clone(), artifact.clone(), &tampered_bundle).is_err());

    let mut tampered_state = checkpoint;
    corrupt_last_plugin_state_and_reseal_for_test(&mut tampered_state);
    assert!(ProgramHostV2::restore(plan, artifact, &tampered_state).is_err());
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn two_member_frame_invokes_once_is_causal_canonical_and_restart_equal() {
    let candidate = universe_design();
    let (plan, artifact, frame) = universe_fixture(candidate, None);
    let mut host = ProgramHostV2::new(plan.clone(), artifact.clone()).unwrap();
    host.apply_event(&admitted(&plan, envelope(1, LifecycleKind::Start), None))
        .unwrap();
    host.apply_market_data_universe_event(&frame).unwrap();
    assert_eq!(
        host.plugin_calls(),
        1,
        "one complete frame invokes one guest"
    );
    let targets = host.canonical_member_target_set().unwrap();
    assert_eq!(targets.members[0].instrument.as_bytes(), b"AAPL.XNAS");
    assert_eq!(targets.members[1].instrument.as_bytes(), b"MSFT.XNAS");
    assert_eq!(
        targets.members[0].target,
        TargetProposalV1::Position(18_725)
    );
    assert_eq!(
        targets.members[1].target,
        TargetProposalV1::Position(42_115)
    );
    let member_checkpoints = host.member_checkpoints_for_test();
    assert_eq!(member_checkpoints.len(), 2);
    assert!(
        member_checkpoints
            .iter()
            .all(|(_, checkpoint)| checkpoint.pending_intent.is_some())
    );

    let checkpoint = host.checkpoint().clone();
    let replay = frame.clone();
    assert_eq!(
        host.apply_market_data_universe_event(&replay)
            .unwrap()
            .encode(),
        ProgramHostV2::restore(plan, artifact, &checkpoint)
            .unwrap()
            .apply_market_data_universe_event(&replay)
            .unwrap()
            .encode()
    );
    assert_eq!(host.checkpoint(), &checkpoint);
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
#[rstest]
fn universe_frame_binding_digest_must_match_the_plan_projection() {
    let (mut plan, _artifact, frame) = universe_fixture(universe_design(), None);
    corrupt_universe_binding_digest_for_test(&mut plan);
    assert!(admit_market_data_universe_program_event_v2(&plan, &frame).is_err());
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn partial_duplicate_and_unknown_member_sets_fail_atomically() {
    let candidate = universe_design();
    let canonical = universe_target_set("AAPL.XNAS", "MSFT.XNAS", 1, 1, 2)
        .encode()
        .unwrap();
    let mut partial = canonical;
    partial[8..10].copy_from_slice(&1_u16.to_le_bytes());
    let mut duplicate = canonical;
    duplicate[168..177].copy_from_slice(b"AAPL.XNAS");
    let unknown = universe_target_set("AAPL.XNAS", "ZZZZ.XNAS", 1, 1, 2)
        .encode()
        .unwrap();
    let mut out_of_range = canonical;
    out_of_range[24 + 66] = 2;
    out_of_range[24 + 80..24 + 84].copy_from_slice(&1_000_001_i32.to_le_bytes());
    out_of_range[24 + 84..24 + 96].fill(0);

    for target_set in [partial, duplicate, unknown, out_of_range] {
        let body = universe_output_body(&candidate, target_set);
        let (plan, artifact, frame) = universe_fixture(candidate.clone(), Some(body));
        let mut host = ProgramHostV2::new(plan.clone(), artifact).unwrap();
        host.apply_event(&admitted(&plan, envelope(1, LifecycleKind::Start), None))
            .unwrap();
        let checkpoint = host.checkpoint().clone();
        assert!(host.apply_market_data_universe_event(&frame).is_err());
        assert_eq!(host.plugin_calls(), 0);
        assert_eq!(host.checkpoint(), &checkpoint);
        assert!(host.canonical_member_target_set().is_none());
    }
}

#[rstest]
fn lineage_versions_are_monotone_per_root_and_checkpointed_atomically() {
    let (plan, artifact) = fixture();
    let mut host = ProgramHostV2::new(plan.clone(), artifact.clone()).unwrap();
    host.apply_event(&admitted(&plan, envelope(1, LifecycleKind::Start), None))
        .unwrap();

    let root_a = BindingDigest::from_untrusted_bytes([0xa1; 32]);
    let root_b = BindingDigest::from_untrusted_bytes([0xb2; 32]);
    let high_a = admitted_with_lineage(
        &plan,
        envelope(2, LifecycleKind::Bar),
        (10_000, 9_000),
        root_a,
        9,
    );
    let first_trace = host.apply_event(&high_a).unwrap();
    assert_eq!(host.apply_event(&high_a).unwrap(), first_trace);

    let low_b = admitted_with_lineage(
        &plan,
        envelope(3, LifecycleKind::Bar),
        (10_100, 9_100),
        root_b,
        1,
    );
    host.apply_event(&low_b)
        .expect("versions from distinct lineage roots are incomparable");
    let frontier_checkpoint = host.checkpoint().clone();
    let calls_before_failure = host.plugin_calls();

    let downgrade_a = admitted_with_lineage(
        &plan,
        envelope(4, LifecycleKind::Bar),
        (10_200, 9_200),
        root_a,
        8,
    );
    assert!(host.apply_event(&downgrade_a).is_err());
    assert_eq!(host.plugin_calls(), calls_before_failure);
    assert_eq!(host.checkpoint(), &frontier_checkpoint);

    let mut restored = ProgramHostV2::restore(plan, artifact, &frontier_checkpoint).unwrap();
    assert!(restored.apply_event(&downgrade_a).is_err());
    assert_eq!(restored.plugin_calls(), calls_before_failure);
    assert_eq!(restored.checkpoint(), &frontier_checkpoint);
}

#[rstest]
fn tampered_module_and_profile_are_rejected_at_host_consumption() {
    let (plan, artifact) = fixture();
    let mut module = artifact.clone();
    module.corrupt_module_bytes_for_test();
    assert!(ProgramHostV2::new(plan.clone(), module).is_err());

    let mut profile = artifact;
    profile.corrupt_profile_identity_for_test();
    assert!(ProgramHostV2::new(plan, profile).is_err());
}

#[rstest]
fn one_plugin_keeps_each_plan_owned_state_cell_distinct() {
    let mut candidate = executable_design();
    candidate.state.push(StateCellV2 {
        semantic_id: "research.state.timer.v1".into(),
        value_type: ValueTypeV2::Bytes,
        initial: TypedConstantV2::Bytes { value: vec![9] },
        max_bytes: 256,
    });
    let timer = candidate
        .reactions
        .iter_mut()
        .find(|reaction| {
            matches!(
                reaction.kind,
                super::strategy_design_v2::LifecycleKindV2::Timer
            )
        })
        .unwrap();
    timer.nodes[0].pre_state = ValueRefV2::PriorState {
        state_id: "research.state.timer.v1".into(),
    };
    timer.state_writes[0].state_id = "research.state.timer.v1".into();
    let (plan, artifact) = fixture_from_design(candidate, InvokeMode::Valid);
    let mut host = ProgramHostV2::new(plan.clone(), artifact).unwrap();
    assert_eq!(
        host.state_pair_for_test("research.state.trend.v1"),
        (&[][..], &[][..])
    );
    assert_eq!(
        host.state_pair_for_test("research.state.timer.v1"),
        (&[9][..], &[9][..])
    );
    host.apply_event(&admitted(&plan, envelope(1, LifecycleKind::Start), None))
        .unwrap();
    let bar = envelope(2, LifecycleKind::Bar);
    host.apply_event(&admitted(&plan, bar, Some((10_000, 9_000))))
        .unwrap();
    assert_eq!(
        host.state_pair_for_test("research.state.trend.v1"),
        (&[1][..], &[1][..])
    );
    assert_eq!(
        host.state_pair_for_test("research.state.timer.v1"),
        (&[9][..], &[9][..])
    );
    let timer = envelope(3, LifecycleKind::Timer);
    host.apply_event(&admitted(&plan, timer, None)).unwrap();
    assert_eq!(
        host.state_pair_for_test("research.state.timer.v1"),
        (&[1][..], &[1][..])
    );
}

#[rstest]
fn malformed_trap_and_fuel_failures_leave_the_complete_host_unchanged() {
    for mode in [
        InvokeMode::Malformed,
        InvokeMode::UnknownSemantic,
        InvokeMode::Trap,
        InvokeMode::Spin,
    ] {
        let (plan, artifact) = fixture_with_mode(mode);
        let mut host = ProgramHostV2::new(plan.clone(), artifact).unwrap();
        host.apply_event(&admitted(&plan, envelope(1, LifecycleKind::Start), None))
            .unwrap();
        let before = host.checkpoint().canonical_bytes().to_vec();
        let bar = envelope(2, LifecycleKind::Bar);
        let input = admitted(&plan, bar, Some((10_000, 9_000)));
        assert!(host.apply_event(&input).is_err());
        assert_eq!(host.checkpoint().canonical_bytes(), before);
        assert_eq!(host.plugin_calls(), 0);
    }
}

fn fixture() -> (StrategyPlanV2, StrategyArtifactV2) {
    fixture_with_mode(InvokeMode::Valid)
}

#[derive(Clone, Copy)]
enum InvokeMode {
    Valid,
    Malformed,
    UnknownSemantic,
    Trap,
    Spin,
}

fn fixture_with_mode(mode: InvokeMode) -> (StrategyPlanV2, StrategyArtifactV2) {
    fixture_from_design(executable_design(), mode)
}

fn fixture_from_design(
    candidate: super::strategy_design_v2::StrategyDesignV2,
    mode: InvokeMode,
) -> (StrategyPlanV2, StrategyArtifactV2) {
    let manifest = &candidate.plugins[0];
    let body = output_frame(manifest).encode(manifest).unwrap()[96..].to_vec();
    fixture_from_design_and_body(candidate, body, mode)
}

fn fixture_from_design_and_body(
    candidate: super::strategy_design_v2::StrategyDesignV2,
    mut body: Vec<u8>,
    mode: InvokeMode,
) -> (StrategyPlanV2, StrategyArtifactV2) {
    let manifest = &candidate.plugins[0];

    if matches!(mode, InvokeMode::UnknownSemantic) {
        let known = b"kernel.position.hold.v1";
        let start = body
            .windows(known.len())
            .position(|window| window == known)
            .expect("position semantic payload");
        body[start..start + known.len()].copy_from_slice(b"kernel.position.zzzz.v1");
    }
    let wasm = plugin_module(manifest, &body, mode);
    let build = VerifiedPluginCargoBuildV2::verify(
        manifest,
        PluginCargoBuildEvidenceV2 {
            wasm_one: &wasm,
            wasm_two: &wasm,
            implementation_capsule_digest: BindingDigest::from_untrusted_bytes([31; 32]),
            source_entry_digest: BindingDigest::from_untrusted_bytes([41; 32]),
            verified_build_receipt_digest: BindingDigest::from_untrusted_bytes([51; 32]),
        },
    )
    .unwrap();
    let receipt = issue_plugin_implementation_receipt_v2_for_test(
        manifest,
        build.implementation_capsule_digest(),
        build.source_entry_digest(),
        build.module_digest(),
        build.verified_build_receipt_digest(),
        "strategy.plugin.compute.v2",
        manifest.abi_version,
        manifest
            .capability_ids
            .iter()
            .map(|id| (id.clone(), 1))
            .collect(),
    );
    let owner_bindings = bindings(&candidate);
    let StrategyCompilationV2::Compiled(plan) =
        compile_with_binding_and_implementation_receipts_for_test(
            candidate,
            owner_bindings,
            vec![receipt],
        )
    else {
        panic!("fixture compiles")
    };
    let artifact = StrategyArtifactV2::issue(&plan, vec![build]).unwrap();
    (*plan, artifact)
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
fn universe_fixture(
    candidate: super::strategy_design_v2::StrategyDesignV2,
    body: Option<Vec<u8>>,
) -> (
    StrategyPlanV2,
    StrategyArtifactV2,
    StrategyInputUniverseFrameReceipt,
) {
    let frame = issue_strategy_input_universe_frame().expect("fixed Owner universe frame");
    let manifest = &candidate.plugins[0];
    let body =
        body.unwrap_or_else(|| output_frame(manifest).encode(manifest).unwrap()[96..].to_vec());
    let wasm = plugin_module(manifest, &body, InvokeMode::Valid);
    let build = VerifiedPluginCargoBuildV2::verify(
        manifest,
        PluginCargoBuildEvidenceV2 {
            wasm_one: &wasm,
            wasm_two: &wasm,
            implementation_capsule_digest: BindingDigest::from_untrusted_bytes([31; 32]),
            source_entry_digest: BindingDigest::from_untrusted_bytes([41; 32]),
            verified_build_receipt_digest: BindingDigest::from_untrusted_bytes([51; 32]),
        },
    )
    .unwrap();
    let receipt = issue_plugin_implementation_receipt_v2_for_test(
        manifest,
        build.implementation_capsule_digest(),
        build.source_entry_digest(),
        build.module_digest(),
        build.verified_build_receipt_digest(),
        "strategy.plugin.compute.v2",
        manifest.abi_version,
        manifest
            .capability_ids
            .iter()
            .map(|id| (id.clone(), 1))
            .collect(),
    );
    let StrategyCompilationV2::Compiled(plan) =
        compile_strategy_design_v2_for_universe(candidate, &frame, &[receipt])
    else {
        panic!("actual sealed universe selection compiles")
    };
    let artifact = StrategyArtifactV2::issue(&plan, vec![build]).unwrap();
    (*plan, artifact, frame.frame().clone())
}

fn admitted(
    plan: &StrategyPlanV2,
    envelope: LifecycleEnvelopeV1,
    values: Option<(i128, i128)>,
) -> AdmittedProgramEventV2 {
    let values = values.map_or_else(Vec::new, |(close, open)| {
        vec![
            ("research.input.close.v1", TypedValueV2::i128(close)),
            ("research.input.open.v1", TypedValueV2::i128(open)),
        ]
    });
    AdmittedProgramEventV2::issue_for_plan_test(plan, envelope, values)
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
fn universe_output_body(
    candidate: &super::strategy_design_v2::StrategyDesignV2,
    target_set: [u8; strategy_factory_program_sdk::lifecycle_v2::TARGET_SET_BYTES],
) -> Vec<u8> {
    let manifest = &candidate.plugins[0];
    let mut body = output_frame(manifest).encode(manifest).unwrap()[96..].to_vec();
    let start = body.windows(4).position(|bytes| bytes == b"SFTS").unwrap();
    body[start..start + target_set.len()].copy_from_slice(&target_set);
    body
}

fn admitted_with_lineage(
    plan: &StrategyPlanV2,
    envelope: LifecycleEnvelopeV1,
    values: (i128, i128),
    root: BindingDigest,
    version: u64,
) -> AdmittedProgramEventV2 {
    AdmittedProgramEventV2::issue_for_plan_test_with_lineage(
        plan,
        envelope,
        vec![
            ("research.input.close.v1", TypedValueV2::i128(values.0)),
            ("research.input.open.v1", TypedValueV2::i128(values.1)),
        ],
        root,
        version,
    )
}

pub(crate) fn executable_design() -> super::strategy_design_v2::StrategyDesignV2 {
    let mut candidate = design();
    let mut open = candidate.inputs[0].clone();
    open.semantic_id = "research.input.open.v1".into();
    open.field_semantic_id = "MARKET_DATA.BAR.OPEN.PRICE.V1".into();
    candidate.inputs.push(open);
    candidate.plugins[0].input_ports.push(PortContractV2 {
        semantic_id: "input.open.v1".into(),
        value_type: ValueTypeV2::I128,
        max_bytes: 16,
    });

    for reaction in &mut candidate.reactions {
        for node in &mut reaction.nodes {
            let source = match reaction.kind {
                LifecycleKindV2::Bar => ValueRefV2::Input {
                    input_id: "research.input.open.v1".into(),
                },
                LifecycleKindV2::Event => ValueRefV2::Input {
                    input_id: "research.input.last-trade.v1".into(),
                },
                _ => ValueRefV2::Parameter {
                    parameter_id: "research.parameter.timer-close.v1".into(),
                },
            };
            node.input_bindings.push(PortBindingV2 {
                port_id: "input.open.v1".into(),
                source,
            });
            node.input_bindings.sort();
        }
    }

    for port in &mut candidate.plugins[0].output_ports {
        if matches!(
            port.value_type,
            ValueTypeV2::PositionIntentV1
                | ValueTypeV2::TargetVariantV1
                | ValueTypeV2::ProtectionVariantV1
        ) {
            port.max_bytes = 64;
        }
    }
    candidate.plugins[0].input_ports.sort();
    candidate.plugins[0].output_ports.sort();
    candidate.plugins[0].capability_ids.sort();
    candidate
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
pub(crate) fn universe_design() -> super::strategy_design_v2::StrategyDesignV2 {
    let mut candidate = executable_design();
    candidate.inputs.retain(|input| {
        matches!(
            input.semantic_id.as_str(),
            "research.input.close.v1" | "research.input.open.v1"
        )
    });

    for input in &mut candidate.inputs {
        input.scope = super::strategy_design_v2::InputScopeV2::UniverseMembers;
        input.instrument.clear();
        input.timeframe = "1D".into();
    }
    candidate.resources.max_inputs = 8;
    candidate.plugins[0].input_ports.extend([
        PortContractV2 {
            semantic_id: "input.member-b-close.v2".into(),
            value_type: ValueTypeV2::I128,
            max_bytes: 16,
        },
        PortContractV2 {
            semantic_id: "input.member-b-open.v2".into(),
            value_type: ValueTypeV2::I128,
            max_bytes: 16,
        },
    ]);
    candidate.plugins[0].output_ports.push(PortContractV2 {
        semantic_id: "proposal.member-target-set.v2".into(),
        value_type: ValueTypeV2::Bytes,
        max_bytes: strategy_factory_program_sdk::lifecycle_v2::TARGET_SET_BYTES as u32,
    });

    for reaction in &mut candidate.reactions {
        for node in &mut reaction.nodes {
            if matches!(reaction.kind, LifecycleKindV2::Bar | LifecycleKindV2::Event) {
                for binding in &mut node.input_bindings {
                    binding.source = match binding.port_id.as_str() {
                        "input.close.v1" => ValueRefV2::UniverseMemberInput {
                            input_id: "research.input.close.v1".into(),
                            member_ordinal: 0,
                        },
                        "input.open.v1" => ValueRefV2::UniverseMemberInput {
                            input_id: "research.input.open.v1".into(),
                            member_ordinal: 0,
                        },
                        _ => binding.source.clone(),
                    };
                }
                node.input_bindings.extend([
                    PortBindingV2 {
                        port_id: "input.member-b-close.v2".into(),
                        source: ValueRefV2::UniverseMemberInput {
                            input_id: "research.input.close.v1".into(),
                            member_ordinal: 1,
                        },
                    },
                    PortBindingV2 {
                        port_id: "input.member-b-open.v2".into(),
                        source: ValueRefV2::UniverseMemberInput {
                            input_id: "research.input.open.v1".into(),
                            member_ordinal: 1,
                        },
                    },
                ]);
            } else {
                for port_id in ["input.member-b-close.v2", "input.member-b-open.v2"] {
                    node.input_bindings.push(PortBindingV2 {
                        port_id: port_id.into(),
                        source: ValueRefV2::Parameter {
                            parameter_id: "research.parameter.timer-close.v1".into(),
                        },
                    });
                }
            }
            node.output_port_ids
                .push("proposal.member-target-set.v2".into());
            node.input_bindings.sort();
            node.output_port_ids.sort();
        }

        if let Some(proposal) = &mut reaction.proposal {
            let node = reaction.nodes[0].semantic_id.clone();
            proposal.member_target_set = Some(ValueRefV2::NodeOutput {
                node_id: node,
                port_id: "proposal.member-target-set.v2".into(),
            });
        }
    }
    candidate.plugins[0].input_ports.sort();
    candidate.plugins[0].output_ports.sort();
    candidate
}

fn output_frame(manifest: &PluginManifestV2) -> PluginFrameV2 {
    let values = manifest
        .output_ports
        .iter()
        .map(|port| match port.semantic_id.as_str() {
            "proposal.position-intent.v1" => TypedValueV2::new(
                ValueTypeV2::PositionIntentV1,
                b"kernel.position.hold.v1".as_slice(),
            )
            .unwrap(),
            "proposal.target-variant.v1" => TypedValueV2::new(
                ValueTypeV2::TargetVariantV1,
                b"kernel.target.keep.v1".as_slice(),
            )
            .unwrap(),
            "proposal.target-position.v1"
            | "proposal.reconciliation-target.v1"
            | "proposal.stop-loss.v1"
            | "proposal.take-profit.v1"
            | "proposal.trailing-stop.v1" => TypedValueV2::i64(0),
            "proposal.target-weight.v1" => TypedValueV2::i32(0),
            "proposal.rebalance-sequence.v1" | "proposal.trailing-distance.v1" => {
                TypedValueV2::u64(0)
            }
            "proposal.protection-variant.v1" => TypedValueV2::new(
                ValueTypeV2::ProtectionVariantV1,
                b"kernel.protection.keep.v1".as_slice(),
            )
            .unwrap(),
            "proposal.member-target-set.v2" => TypedValueV2::new(
                ValueTypeV2::Bytes,
                universe_target_set("AAPL.XNAS", "MSFT.XNAS", 1, 1, 2)
                    .encode()
                    .unwrap(),
            )
            .unwrap(),
            value => panic!("unexpected port {value}"),
        })
        .collect();
    PluginFrameV2 {
        kind: PluginFrameKindV2::Output,
        manifest_digest: BindingDigest::from_untrusted_bytes([1; 32]),
        module_identity: BindingDigest::from_untrusted_bytes([2; 32]),
        invocation_identity: [3; 16],
        values,
        state: TypedValueV2::new(ValueTypeV2::Bytes, [1].as_slice()).unwrap(),
    }
}

fn universe_target_set(
    first: &str,
    second: &str,
    sequence: u64,
    first_units: i64,
    second_units: i64,
) -> InstrumentTargetSetV2 {
    InstrumentTargetSetV2::new(
        sequence,
        [
            MemberTargetV2 {
                instrument: InstrumentKeyV2::new(first.as_bytes()).unwrap(),
                position: PositionIntentV1::Enter,
                target: TargetProposalV1::Position(first_units),
                reconciliation_target_units: Some(first_units),
                protection: ProtectionProposalV1::Keep,
            },
            MemberTargetV2 {
                instrument: InstrumentKeyV2::new(second.as_bytes()).unwrap(),
                position: PositionIntentV1::Enter,
                target: TargetProposalV1::Position(second_units),
                reconciliation_target_units: Some(second_units),
                protection: ProtectionProposalV1::Keep,
            },
        ],
    )
    .unwrap()
}

fn envelope(sequence: u64, kind: LifecycleKind) -> LifecycleEnvelopeV1 {
    envelope_with_order(sequence, sequence, kind, sequence, [sequence as u8; 16])
}

fn envelope_with_order(
    logical_time: u64,
    event_time: u64,
    kind: LifecycleKind,
    owner_sequence: u64,
    event_identity: [u8; 16],
) -> LifecycleEnvelopeV1 {
    let payload = match kind {
        LifecycleKind::Start => EnvelopePayloadV1::Start,
        LifecycleKind::Bar => EnvelopePayloadV1::Bar,
        LifecycleKind::Timer => EnvelopePayloadV1::Timer,
        _ => panic!("unused fixture lifecycle"),
    };
    LifecycleEnvelopeV1::new_bound(
        EventOrderKeyV1::new(
            logical_time,
            event_time,
            kind,
            owner_sequence,
            event_identity,
        )
        .unwrap(),
        payload,
    )
    .unwrap()
}

fn plugin_module(manifest: &PluginManifestV2, body_bytes: &[u8], mode: InvokeMode) -> Vec<u8> {
    let input_capacity = frame_capacity(&manifest.input_ports, manifest.state.max_bytes);
    let output_capacity = frame_capacity(&manifest.output_ports, manifest.state.max_bytes);
    let output_len = 96 + body_bytes.len();
    let mut wasm = b"\0asm\x01\0\0\0".to_vec();
    section(&mut wasm, 1, &[2, 0x60, 0, 1, 0x7f, 0x60, 1, 0x7f, 1, 0x7f]);
    section(&mut wasm, 3, &[5, 0, 0, 0, 0, 1]);
    section(&mut wasm, 5, &[1, 1, 1, 16]);
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
    let mut code = vec![5];
    for value in [1024, input_capacity as i32, 8192, output_capacity as i32] {
        function_body(&mut code, &i32_const(value));
    }
    let invoke = match mode {
        InvokeMode::Valid | InvokeMode::UnknownSemantic => {
            let mut invoke = Vec::new();
            for offset in (0..96).step_by(8) {
                invoke.extend(i32_const(8192));
                invoke.extend(i32_const(1024));
                invoke.push(0x29);
                invoke.push(3);
                u32_leb(&mut invoke, offset);
                invoke.push(0x37);
                invoke.push(3);
                u32_leb(&mut invoke, offset);
            }
            store_i32(&mut invoke, 8192, i32::from_le_bytes(*b"SFPO"), 0);
            store_i32_16(
                &mut invoke,
                8192,
                (manifest.output_ports.len() + 1) as i32,
                88,
            );
            store_i32(&mut invoke, 8192, body_bytes.len() as i32, 92);
            if let Some(target_set_body) = body_bytes.windows(4).position(|bytes| bytes == b"SFTS")
                && body_bytes.get(target_set_body + 24 + 66) == Some(&1)
                && body_bytes.get(target_set_body + 24 + 144 + 66) == Some(&1)
            {
                for (port, member_offset) in [
                    ("input.close.v1", 104_u32),
                    ("input.member-b-close.v2", 248_u32),
                ] {
                    if let Some(input_offset) = plugin_input_payload_offset(manifest, port) {
                        for output_offset in [member_offset, member_offset + 8] {
                            copy_i64(
                                &mut invoke,
                                input_offset as u32,
                                96 + target_set_body as u32 + output_offset,
                            );
                        }
                    }
                }
            }
            invoke.extend(i32_const(output_len as i32));
            invoke
        }
        InvokeMode::Malformed => i32_const(0),
        InvokeMode::Trap => vec![0x00],
        InvokeMode::Spin => vec![0x03, 0x40, 0x0c, 0, 0x0b, 0x41, 0],
    };
    function_body(&mut code, &invoke);
    section(&mut wasm, 10, &code);
    let mut data = vec![1, 0];
    data.extend(i32_const(8192 + 96));
    data.push(0x0b);
    u32_leb(&mut data, body_bytes.len() as u32);
    data.extend(body_bytes);
    section(&mut wasm, 11, &data);
    wasm
}

fn plugin_input_payload_offset(manifest: &PluginManifestV2, semantic_id: &str) -> Option<usize> {
    let mut cursor = 96;
    for port in &manifest.input_ports {
        cursor += 8;
        if port.semantic_id == semantic_id {
            return Some(cursor);
        }
        cursor += match port.value_type {
            ValueTypeV2::I32 => 4,
            ValueTypeV2::I64 | ValueTypeV2::U64 => 8,
            ValueTypeV2::I128 | ValueTypeV2::StableIdentity16 => 16,
            ValueTypeV2::Digest32 => 32,
            _ => return None,
        };
    }
    None
}

fn copy_i64(bytes: &mut Vec<u8>, input_offset: u32, output_offset: u32) {
    bytes.extend(i32_const(8192));
    bytes.extend(i32_const(1024));
    bytes.push(0x29);
    bytes.push(3);
    u32_leb(bytes, input_offset);
    bytes.push(0x37);
    bytes.push(3);
    u32_leb(bytes, output_offset);
}

fn frame_capacity(ports: &[PortContractV2], state: u32) -> usize {
    96 + (ports.len() + 1) * 8
        + state as usize
        + ports
            .iter()
            .map(|port| port.max_bytes as usize)
            .sum::<usize>()
}
fn store_i32(bytes: &mut Vec<u8>, ptr: i32, value: i32, offset: u32) {
    bytes.extend(i32_const(ptr));
    bytes.extend(i32_const(value));
    bytes.push(0x36);
    bytes.push(2);
    u32_leb(bytes, offset);
}
fn store_i32_16(bytes: &mut Vec<u8>, ptr: i32, value: i32, offset: u32) {
    bytes.extend(i32_const(ptr));
    bytes.extend(i32_const(value));
    bytes.push(0x3b);
    bytes.push(1);
    u32_leb(bytes, offset);
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
fn function_body(code: &mut Vec<u8>, operators: &[u8]) {
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
