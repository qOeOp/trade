use rstest::rstest;
use strategy_factory_program_sdk::lifecycle_v1::{
    self, EnvelopePayloadV1, EventOrderKeyV1, LifecycleEnvelopeV1, LifecycleKind, PositionIntentV1,
    ProtectionProposalV1, TargetProposalV1,
};
use strategy_factory_program_sdk::lifecycle_v2::{
    InstrumentKeyV2, InstrumentTargetSetV2, MemberTargetV2, target_set_encoded_bytes,
};
use vibe_data::owner::source_binding::BindingDigest;
#[cfg(feature = "sealed-strategy-input-acceptance")]
use vibe_data::owner::{
    sealed_acceptance::{
        SealedAcceptanceStrategyInputUniverseFrame,
        issue_single_member_universe_frame_for_owner_lineage, issue_strategy_input_universe_frame,
    },
    strategy_input_binding::StrategyInputUniverseFrameReceipt,
};

#[cfg(feature = "sealed-strategy-input-acceptance")]
use super::program_host_v2::{
    OwnerUniverseFrameV1, UniverseMemberSampleCoordinateV1, admit_owner_universe_program_event_v2,
};
#[cfg(feature = "sealed-strategy-input-acceptance")]
use super::strategy_plan_v2::{
    compile_strategy_design_v2_for_universe, corrupt_universe_binding_digest_for_test,
};
use super::{
    artifact_v2::StrategyArtifactV2,
    bounded_feature_program_v1::BOUNDED_FEATURE_NUMERIC_FAILURE_V1,
    cargo_artifact::{PluginCargoBuildEvidenceV2, VerifiedPluginCargoBuildV2},
    plugin_wire_v2::{
        PLUGIN_FRAME_ABI_V3, PluginFrameKindV2, PluginFrameV2, PluginOutputAvailabilityV3,
        TypedValueV2,
    },
    program_host_v2::{
        AdmittedProgramEventV2, ProgramHostV2, corrupt_checkpoint_bytes_for_test,
        corrupt_last_plugin_state_and_reseal_for_test, validate_bfp_output_availability,
        validate_bfp_warming_fields,
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
fn warming_proposal_validation_reads_all_raw_lifecycle_fields() {
    let (plan, _artifact) = fixture();
    let reaction = plan
        .reactions()
        .iter()
        .find(|reaction| reaction.kind == LifecycleKindV2::Bar)
        .unwrap();
    let node_id = &reaction.nodes[0].semantic_id;
    let manifest = executable_design().plugins.remove(0);
    let frame = output_frame(&manifest);
    let outputs: std::collections::BTreeMap<(String, String), TypedValueV2> = manifest
        .output_ports
        .iter()
        .zip(frame.values)
        .map(|(port, value)| ((node_id.clone(), port.semantic_id.clone()), value))
        .collect();
    let value = |port: &str| {
        outputs
            .get(&(node_id.clone(), port.into()))
            .unwrap()
            .clone()
    };
    let fields = [
        ("position", value("proposal.position-intent.v1")),
        ("target_variant", value("proposal.target-variant.v1")),
        ("target_position", value("proposal.target-position.v1")),
        ("target_weight", value("proposal.target-weight.v1")),
        (
            "rebalance_sequence",
            value("proposal.rebalance-sequence.v1"),
        ),
        (
            "reconciliation_target",
            value("proposal.reconciliation-target.v1"),
        ),
        (
            "protection_variant",
            value("proposal.protection-variant.v1"),
        ),
        ("stop_loss", value("proposal.stop-loss.v1")),
        ("take_profit", value("proposal.take-profit.v1")),
        ("trailing_distance", value("proposal.trailing-distance.v1")),
        ("trailing_stop", value("proposal.trailing-stop.v1")),
    ]
    .into_iter()
    .collect();

    assert!(validate_bfp_warming_fields(&fields).is_ok());

    for (field, nonzero) in [
        ("target_position", TypedValueV2::i64(1)),
        ("target_weight", TypedValueV2::i32(1)),
        ("rebalance_sequence", TypedValueV2::u64(1)),
        ("reconciliation_target", TypedValueV2::i64(1)),
        ("stop_loss", TypedValueV2::i64(1)),
        ("take_profit", TypedValueV2::i64(1)),
        ("trailing_distance", TypedValueV2::u64(1)),
        ("trailing_stop", TypedValueV2::i64(1)),
    ] {
        let mut contradictory = fields.clone();
        contradictory.insert(field, nonzero);
        assert!(
            validate_bfp_warming_fields(&contradictory).is_err(),
            "WARMING accepted nonzero {field}",
        );
    }

    for (field, value_type, semantic_id) in [
        (
            "position",
            ValueTypeV2::PositionIntentV1,
            lifecycle_v1::ENTER_SEMANTIC_ID,
        ),
        (
            "target_variant",
            ValueTypeV2::TargetVariantV1,
            lifecycle_v1::TARGET_POSITION_SEMANTIC_ID,
        ),
        (
            "protection_variant",
            ValueTypeV2::ProtectionVariantV1,
            lifecycle_v1::TRAILING_ADJUST_SEMANTIC_ID,
        ),
    ] {
        let mut contradictory = fields.clone();
        contradictory.insert(
            field,
            TypedValueV2::new(value_type, semantic_id.as_bytes()).unwrap(),
        );
        assert!(
            validate_bfp_warming_fields(&contradictory).is_err(),
            "WARMING accepted contradictory {field}",
        );
    }
}

#[rstest]
fn abi3_bfp_availability_is_explicit_and_ready_hold_stays_ready() {
    let mut manifest = executable_design().plugins.remove(0);
    manifest.abi_version = PLUGIN_FRAME_ABI_V3;
    manifest.failure_semantic_id = BOUNDED_FEATURE_NUMERIC_FAILURE_V1.into();
    let mut frame = output_frame(&manifest);

    assert!(
        !validate_bfp_output_availability(&manifest, &frame).unwrap(),
        "READY plus HOLD/Keep/Keep must remain READY",
    );

    frame.output_availability = Some(PluginOutputAvailabilityV3::Warming);
    assert!(validate_bfp_output_availability(&manifest, &frame).unwrap());

    frame.state = TypedValueV2::new(manifest.state.value_type, Vec::new()).unwrap();
    assert!(validate_bfp_output_availability(&manifest, &frame).unwrap());
    frame.output_availability = None;
    assert!(validate_bfp_output_availability(&manifest, &frame).is_err());
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn two_member_frame_invokes_once_is_causal_canonical_and_restart_equal() {
    let candidate = universe_design();
    let (plan, artifact, frame) = universe_fixture(candidate, None);
    let mut host = ProgramHostV2::new(plan.clone(), artifact.clone()).unwrap();
    host.apply_event(&admitted(&plan, envelope(1, LifecycleKind::Start), None))
        .unwrap();
    host.apply_event(
        &admit_owner_universe_program_event_v2(
            &plan,
            &OwnerUniverseFrameV1::uncoordinated(frame.clone()),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        host.plugin_calls(),
        1,
        "one complete frame invokes one guest"
    );
    let targets = host.canonical_member_target_set().unwrap();
    assert_eq!(targets.members()[0].instrument.as_bytes(), b"AAPL.XNAS");
    assert_eq!(targets.members()[1].instrument.as_bytes(), b"MSFT.XNAS");
    assert_eq!(
        targets.members()[0].target,
        TargetProposalV1::Position(18_725)
    );
    assert_eq!(
        targets.members()[1].target,
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
    let replay = frame;
    let replay_event =
        admit_owner_universe_program_event_v2(&plan, &OwnerUniverseFrameV1::uncoordinated(replay))
            .unwrap();
    assert_eq!(
        host.apply_event(&replay_event).unwrap().encode(),
        ProgramHostV2::restore(plan, artifact, &checkpoint)
            .unwrap()
            .apply_event(&replay_event)
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
    assert!(
        admit_owner_universe_program_event_v2(&plan, &OwnerUniverseFrameV1::uncoordinated(frame))
            .is_err()
    );
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
        assert!(
            admit_owner_universe_program_event_v2(
                &plan,
                &OwnerUniverseFrameV1::uncoordinated(frame.clone())
            )
            .and_then(|event| host.apply_event(&event))
            .is_err()
        );
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
    universe_fixture_with_frame(candidate, body, &frame)
}

/// Compiles `candidate` against an Owner universe frame the caller issued.
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn universe_fixture_with_frame(
    candidate: super::strategy_design_v2::StrategyDesignV2,
    body: Option<Vec<u8>>,
    frame: &SealedAcceptanceStrategyInputUniverseFrame,
) -> (
    StrategyPlanV2,
    StrategyArtifactV2,
    StrategyInputUniverseFrameReceipt,
) {
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
        compile_strategy_design_v2_for_universe(candidate, frame, &[receipt])
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
/// A single-instrument Design over a one-member universe: its roles use universe-member scope, every
/// BAR/EVENT reaction reads member ordinal 0 only, and it proposes for a single instrument.
pub(crate) fn one_member_universe_design() -> super::strategy_design_v2::StrategyDesignV2 {
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

    for reaction in &mut candidate.reactions {
        if !matches!(reaction.kind, LifecycleKindV2::Bar | LifecycleKindV2::Event) {
            continue;
        }

        for node in &mut reaction.nodes {
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
            node.input_bindings.sort();
        }
    }
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
        output_availability: (manifest.abi_version == PLUGIN_FRAME_ABI_V3)
            .then_some(PluginOutputAvailabilityV3::Ready),
        values,
        state: TypedValueV2::new(ValueTypeV2::Bytes, [1].as_slice()).unwrap(),
    }
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
pub(crate) fn hold_plugin_module(manifest: &PluginManifestV2) -> anyhow::Result<Vec<u8>> {
    let body = output_frame(manifest).encode(manifest)?[96..].to_vec();
    Ok(plugin_module(manifest, &body, InvokeMode::Valid))
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
        &[
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
    let output_capacity = frame_capacity(&manifest.output_ports, manifest.state.max_bytes)
        + usize::from(manifest.abi_version == PLUGIN_FRAME_ABI_V3);
    let output_len = 96 + body_bytes.len();
    let memory_pages = u8::try_from(manifest.max_linear_memory_bytes / 65_536)
        .expect("bounded fixture memory pages");
    let memory_initial = if manifest.abi_version == PLUGIN_FRAME_ABI_V3 {
        memory_pages
    } else {
        1
    };
    let mut wasm = b"\0asm\x01\0\0\0".to_vec();
    section(&mut wasm, 1, &[2, 0x60, 0, 1, 0x7f, 0x60, 1, 0x7f, 1, 0x7f]);
    section(&mut wasm, 3, &[5, 0, 0, 0, 0, 1]);
    section(&mut wasm, 5, &[1, 1, memory_initial, memory_pages]);
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

/// Byte layouts the member-count widening must not move for a two-member set: the SDK encoding of
/// a fixed pair, and the Plan, target set, and Host checkpoint a real two-member frame produces.
///
/// The checkpoint is pinned in both directions. Its bytes are the pre-widening bytes, and restoring
/// from them reproduces the same checkpoint, target set, and member kernels, so the slot decoder
/// accepts exactly what the pre-widening encoder wrote.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn two_member_canonical_bytes_are_unchanged_by_the_member_count_widening() {
    let member = |instrument: &[u8], position, units| MemberTargetV2 {
        instrument: InstrumentKeyV2::new(instrument).unwrap(),
        position,
        target: TargetProposalV1::Position(units),
        reconciliation_target_units: Some(units),
        protection: ProtectionProposalV1::Keep,
    };
    let fixed = InstrumentTargetSetV2::new(
        7,
        &[
            member(b"MSFT.XNAS", PositionIntentV1::Exit, 0),
            member(b"AAPL.XNAS", PositionIntentV1::Enter, 3),
        ],
    )
    .unwrap()
    .encode()
    .unwrap();

    let (plan, artifact, frame) = universe_fixture(universe_design(), None);
    let mut host = ProgramHostV2::new(plan.clone(), artifact.clone()).unwrap();
    host.apply_event(&admitted(&plan, envelope(1, LifecycleKind::Start), None))
        .unwrap();
    host.apply_event(
        &admit_owner_universe_program_event_v2(&plan, &OwnerUniverseFrameV1::uncoordinated(frame))
            .unwrap(),
    )
    .unwrap();
    let produced = host
        .canonical_member_target_set()
        .unwrap()
        .encode()
        .unwrap();

    crate::target_set_members::assert_two_member_bytes_unchanged(
        &[
            ("sdk_fixed_pair", &fixed),
            ("plan_durable", &plan.durable_bytes()),
            ("plan_digest", plan.canonical_plan_digest().as_bytes()),
            ("frame_target_set", &produced),
            ("host_checkpoint", host.checkpoint().canonical_bytes()),
        ],
        &[
            (
                "sdk_fixed_pair",
                312,
                "38d3721ab5fc86886fa86de4a97dbb5e4c00429e07699f76a77d8a84015047c6",
            ),
            (
                "plan_durable",
                20_142,
                "bc0036b0fc960c884703d4d8d8cac23022ebaee7804079dec5c17159422e6944",
            ),
            (
                "plan_digest",
                32,
                "acc8b86785383b4e2b888f361ac8c66de5f72b3735d529aabf4f1e8b7c400d6a",
            ),
            (
                "frame_target_set",
                312,
                "6df70f6cdae4a4714c750d658a8b0562bf056a059c8857d981aa504bd85ee661",
            ),
            (
                "host_checkpoint",
                3_580,
                "df04c446b9582f4b60d431f37d3711441c63df7da55c85f7d8256fafe8c29329",
            ),
        ],
    );

    let restored = ProgramHostV2::restore(plan, artifact, host.checkpoint()).unwrap();
    assert_eq!(restored.checkpoint(), host.checkpoint());
    assert_eq!(
        restored.canonical_member_target_set(),
        host.canonical_member_target_set()
    );
    assert_eq!(
        restored.member_checkpoints_for_test(),
        host.member_checkpoints_for_test()
    );
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
/// The two-member universe Design with its target-set output removed, so its plugin proposes for a
/// single instrument while its reactions still read both members.
fn two_member_single_instrument_design() -> super::strategy_design_v2::StrategyDesignV2 {
    let mut candidate = universe_design();
    candidate.plugins[0]
        .output_ports
        .retain(|port| port.semantic_id != "proposal.member-target-set.v2");

    for reaction in &mut candidate.reactions {
        for node in &mut reaction.nodes {
            node.output_port_ids
                .retain(|port| port != "proposal.member-target-set.v2");
        }

        if let Some(proposal) = &mut reaction.proposal {
            proposal.member_target_set = None;
        }
    }
    candidate
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn the_universe_contract_follows_the_owner_member_count() {
    use super::strategy_plan_v2::validate_universe_target_set_contract_for_test as contract;

    assert_eq!(contract(one_member_universe_design(), Some(1)), Ok(()));

    // A plugin may also propose the one-member set itself.
    let mut direct = one_member_universe_design();
    direct.plugins[0].output_ports.push(PortContractV2 {
        semantic_id: "proposal.member-target-set.v2".into(),
        value_type: ValueTypeV2::Bytes,
        max_bytes: strategy_factory_program_sdk::lifecycle_v2::TARGET_SET_BYTES as u32,
    });
    direct.plugins[0].output_ports.sort();
    for reaction in &mut direct.reactions {
        for node in &mut reaction.nodes {
            node.output_port_ids
                .push("proposal.member-target-set.v2".into());
            node.output_port_ids.sort();
        }

        if let Some(proposal) = &mut reaction.proposal {
            proposal.member_target_set = Some(ValueRefV2::NodeOutput {
                node_id: reaction.nodes[0].semantic_id.clone(),
                port_id: "proposal.member-target-set.v2".into(),
            });
        }
    }
    assert_eq!(contract(direct.clone(), Some(1)), Ok(()));

    // Ordinals must be exactly the universe's: a one-member Design leaves a second member unread,
    // and a two-member Design reads an ordinal a one-member universe does not have.
    for (design, member_count) in [(direct, 2), (universe_design(), 1)] {
        assert!(
            matches!(
                contract(design, Some(member_count)),
                Err(StrategyCompilationV2::Unsupported(issue)) if issue.coordinate.ends_with(".inputs")
            ),
            "member count {member_count}"
        );
    }

    // More than one member requires one complete target set: a single-instrument proposal lifts
    // only under one member, so it is refused under two whichever ordinals the Design reads.
    for design in [
        two_member_single_instrument_design(),
        one_member_universe_design(),
    ] {
        assert!(matches!(
            contract(design, Some(2)),
            Err(StrategyCompilationV2::NeedsResearchRefinement(issue))
                if issue.coordinate.ends_with(".proposal.member_target_set")
        ));
    }
}

#[rstest]
fn a_lifted_single_instrument_proposal_is_the_one_member_set_a_plugin_would_propose() {
    use super::program_host_v2::lift_single_instrument_proposal;

    let proposal = lifecycle_v1::ProposalV1 {
        intent_identity: [1; 16],
        proposal_digest: [2; 32],
        position: PositionIntentV1::Enter,
        target: TargetProposalV1::Position(5),
        reconciliation_target_units: Some(5),
        protection: ProtectionProposalV1::Keep,
        strategy_state_digest: [3; 32],
        plugin_state_digest: [4; 32],
    };
    let direct = |sequence| {
        InstrumentTargetSetV2::new(
            sequence,
            &[MemberTargetV2 {
                instrument: InstrumentKeyV2::new(b"BTCUSDT-PERP.BINANCE").unwrap(),
                position: PositionIntentV1::Enter,
                target: TargetProposalV1::Position(5),
                reconciliation_target_units: Some(5),
                protection: ProtectionProposalV1::Keep,
            }],
        )
        .unwrap()
        .encode()
        .unwrap()
    };
    let lifted = |pending| {
        lift_single_instrument_proposal(&["BTCUSDT-PERP.BINANCE"], pending, proposal)
            .unwrap()
            .encode()
            .unwrap()
    };

    // A plugin's set reaches the host as its bytes and is decoded from them; the lifted set must
    // be that same canonical value, byte for byte.
    assert_eq!(lifted(None), direct(1));
    assert_eq!(lifted(Some(7)), direct(8));
    let decoded = InstrumentTargetSetV2::decode(&direct(1)[..target_set_encoded_bytes(1)]).unwrap();
    assert_eq!(lifted(None), decoded.encode().unwrap());

    // Only a one-member universe lifts.
    for members in [&[][..], &["AAPL.XNAS", "MSFT.XNAS"][..]] {
        assert!(lift_single_instrument_proposal(members, None, proposal).is_err());
    }
    assert!(
        lift_single_instrument_proposal(&["BTCUSDT-PERP.BINANCE"], Some(u64::MAX), proposal)
            .is_err()
    );
}

/// Universe input ordinals are checked against the universe's own member count: a one-member
/// universe has only ordinal 0, and a two-member universe has 0 and 1.
#[rstest]
fn universe_input_ordinals_follow_the_member_count() {
    use super::program_host_v2::is_universe_member_ordinal as admitted;

    assert!(admitted(Some(0), 1));
    assert!(!admitted(Some(1), 1));
    assert!(admitted(Some(1), 2));
    assert!(!admitted(Some(2), 2));
    assert!(!admitted(None, 2));
    assert!(!admitted(Some(0), 0));
}

/// Compiles the one-member Design against a one-member Owner universe frame that Market Data issues
/// through its own derivation and binds to that Design.
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn one_member_universe_fixture() -> (
    StrategyPlanV2,
    StrategyArtifactV2,
    StrategyInputUniverseFrameReceipt,
) {
    let candidate = one_member_universe_design();
    let super::strategy_plan_v2::StrategyDesignPreparationV2::Prepared {
        design_identity, ..
    } = super::strategy_plan_v2::prepare_strategy_design_v2(&candidate)
    else {
        panic!("the one-member Design canonicalizes")
    };
    let frame = issue_single_member_universe_frame_for_owner_lineage(
        candidate.research_request_identity,
        design_identity,
    )
    .expect("one-member Owner universe frame");
    assert_eq!(frame.frame().selection().members().len(), 1);
    universe_fixture_with_frame(candidate, None, &frame)
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_one_member_universe_frame_is_admitted_at_ordinal_zero() {
    let (plan, artifact, frame) = one_member_universe_fixture();
    let mut host = ProgramHostV2::new(plan.clone(), artifact).unwrap();
    host.apply_event(&admitted(&plan, envelope(1, LifecycleKind::Start), None))
        .unwrap();

    host.apply_event(
        &admit_owner_universe_program_event_v2(
            &plan,
            &OwnerUniverseFrameV1::uncoordinated(frame.clone()),
        )
        .unwrap(),
    )
    .unwrap();

    let target_set = host.canonical_member_target_set().unwrap();
    assert_eq!(target_set.member_count(), 1);
    assert_eq!(
        target_set.members()[0].instrument.as_bytes(),
        frame.selection().members()[0].instrument().as_bytes()
    );
}

#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_one_member_universe_refuses_an_input_at_ordinal_one() {
    use super::program_host_v2::ProgramHostV2Error;

    let (plan, artifact, frame) = one_member_universe_fixture();
    let started = || {
        let mut host = ProgramHostV2::new(plan.clone(), artifact.clone()).unwrap();
        host.apply_event(&admitted(&plan, envelope(1, LifecycleKind::Start), None))
            .unwrap();
        host
    };
    let admitted_event =
        admit_owner_universe_program_event_v2(&plan, &OwnerUniverseFrameV1::uncoordinated(frame))
            .unwrap();

    // The reseal itself is sound: the same helper keeping ordinal 0 yields an admitted event.
    let mut kept = admitted_event.clone();
    kept.move_member_ordinal_and_reseal_for_test(&plan, "research.input.open.v1", 0);
    assert!(started().apply_event(&kept).is_ok());

    let mut moved = admitted_event;
    moved.move_member_ordinal_and_reseal_for_test(&plan, "research.input.open.v1", 1);
    assert!(matches!(
        started().apply_event(&moved),
        Err(ProgramHostV2Error::InputCoverage)
    ));
}

/// A Design whose roles name exact instruments is refused under an Owner universe by the refusal the
/// architecture names, before any other universe check can answer for it.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn exact_instrument_roles_are_refused_under_an_owner_universe_by_name() {
    let candidate = executable_design();
    let frame = issue_strategy_input_universe_frame().expect("fixed Owner universe frame");
    let implementations =
        super::strategy_plan_v2::plugin_implementation_receipts_for_test(&candidate, 71);

    let StrategyCompilationV2::Unsupported(issue) =
        compile_strategy_design_v2_for_universe(candidate, &frame, &implementations)
    else {
        panic!("an exact-instrument Design must not compile under an Owner universe")
    };
    assert_eq!(
        issue.refusal,
        Some(super::strategy_plan_v2::CompilationRefusalV2::ExactInstrumentRolesUnderOwnerUniverse)
    );
    assert_eq!(issue.coordinate, "inputs.scope");
}

/// The authored single-threshold universe-member Design, compiled against the real one-member Owner
/// universe frame that Market Data issues for that Design, with a bounded ABI3 plugin module.
///
/// The Design's roles carry the names the frame binds, so the Plan's coordinate rows name the
/// frame's (member 0, role) pairs. The module holds; what these tests exercise is the host reading
/// each coordinate into the plugin's input frame, which happens before the module runs.
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn universe_bfp_fixture() -> (
    StrategyPlanV2,
    StrategyArtifactV2,
    StrategyInputUniverseFrameReceipt,
) {
    use super::{
        bounded_feature_program_v1::BoundedFeaturePredicateV1,
        cargo_artifact::{PluginCargoBuildEvidenceV3, VerifiedPluginCargoBuildV3},
        single_threshold_authoring_v1::{
            SingleThresholdAuthoringRequestV1, SingleThresholdChannelV1, SingleThresholdOutcomeV1,
            author_single_threshold_program_v1,
        },
    };

    let outcome = |position_intent: &str, units| SingleThresholdOutcomeV1 {
        position_intent_semantic_id: position_intent.to_owned(),
        target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
        target_position_units: units,
    };
    let (candidate, _) = author_single_threshold_program_v1(&SingleThresholdAuthoringRequestV1 {
        research_request_identity: BindingDigest::from_untrusted_bytes([1; 32]),
        intent_identity: BindingDigest::from_untrusted_bytes([2; 32]),
        intent_digest: BindingDigest::from_untrusted_bytes([3; 32]),
        channel: SingleThresholdChannelV1::UniverseMember {
            close_role_semantic_id: "research.input.close.v1".to_owned(),
            open_role_semantic_id: "research.input.open.v1".to_owned(),
        },
        threshold_coefficient: 10_000,
        comparison: BoundedFeaturePredicateV1::Greater,
        when_true: outcome("kernel.position.enter.v1", 1),
        otherwise: outcome("kernel.position.exit.v1", 0),
        falsifier: "the channel never crosses the threshold in the admitted window".to_owned(),
    })
    .expect("the universe-member request is authorable");
    let super::strategy_plan_v2::StrategyDesignPreparationV2::Prepared {
        design_identity, ..
    } = super::strategy_plan_v2::prepare_strategy_design_v2(&candidate)
    else {
        panic!("the authored Design canonicalizes")
    };
    let frame = issue_single_member_universe_frame_for_owner_lineage(
        candidate.research_request_identity,
        design_identity,
    )
    .expect("one-member Owner universe frame");
    // The host reads plugin frames against the Plan's canonical manifest, whose ports are sorted.
    let mut manifest = candidate.plugins[0].clone();
    manifest.input_ports.sort();
    manifest.output_ports.sort();
    let wasm = hold_plugin_module(&manifest).expect("bounded HOLD ABI3 plugin module");
    let build = VerifiedPluginCargoBuildV3::verify(
        &manifest,
        PluginCargoBuildEvidenceV3 {
            wasm_one: &wasm,
            wasm_two: &wasm,
            capsule_digest: BindingDigest::from_untrusted_bytes([31; 32]),
            source_set_digest: BindingDigest::from_untrusted_bytes([41; 32]),
            verified_build_receipt_digest: BindingDigest::from_untrusted_bytes([51; 32]),
            max_wasm_bytes: u32::try_from(wasm.len()).expect("bounded fixture module"),
        },
    )
    .expect("repeat-equal ABI3 plugin build");
    let receipt = issue_plugin_implementation_receipt_v2_for_test(
        &manifest,
        build.capsule_digest(),
        build.source_set_digest(),
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
        panic!("the authored universe-member Design compiles against the one-member frame")
    };
    let artifact = StrategyArtifactV2::issue_versioned(&plan, vec![build.into()])
        .expect("ABI3 strategy artifact");
    (*plan, artifact, frame.frame().clone())
}

/// One coordinate for every (member, role) pair the Plan's coordinate rows name.
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn plan_member_coordinates(
    plan: &StrategyPlanV2,
    frame: &StrategyInputUniverseFrameReceipt,
) -> Vec<UniverseMemberSampleCoordinateV1> {
    plan.bfp_role_bindings()
        .iter()
        .filter(|row| row.kind() == super::strategy_plan_v2::BfpRoleBindingKindV1::Coordinate)
        .map(|row| {
            UniverseMemberSampleCoordinateV1::for_frame_test(
                frame,
                row.member_ordinal()
                    .expect("a universe coordinate row names its member"),
                row.input_role_identity(),
            )
        })
        .collect()
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
fn started_universe_host(plan: &StrategyPlanV2, artifact: &StrategyArtifactV2) -> ProgramHostV2 {
    let mut host = ProgramHostV2::new(plan.clone(), artifact.clone()).expect("ABI3 universe host");
    host.apply_event(&admitted(plan, envelope(1, LifecycleKind::Start), None))
        .expect("START applies");
    host
}

/// The control: the real universe frame with a coordinate for every pair the Plan binds is
/// admitted, carries each coordinate, and runs the program, which reads each member coordinate into
/// the plugin's input frame.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_universe_frame_with_its_member_coordinates_runs_the_program() {
    use super::program_host_v2::admit_market_data_coordinated_universe_program_event_v2;

    let (plan, artifact, frame) = universe_bfp_fixture();
    let coordinates = plan_member_coordinates(&plan, &frame);
    assert_eq!(coordinates.len(), 2, "one coordinate per role at member 0");

    let event =
        admit_market_data_coordinated_universe_program_event_v2(&plan, &frame, &coordinates)
            .expect("the coordinated frame is admitted");
    let mut host = started_universe_host(&plan, &artifact);
    host.apply_event(&event)
        .expect("the program runs on the coordinated frame");
    assert_eq!(host.plugin_calls(), 1);
}

/// The refusal: the same frame without its coordinates is refused at admission, by the host's own
/// admission and by the host entry point that takes a bare frame.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_universe_frame_without_its_member_coordinates_is_refused() {
    use super::program_host_v2::{
        ProgramHostV2Error, admit_market_data_coordinated_universe_program_event_v2,
    };

    let (plan, artifact, frame) = universe_bfp_fixture();

    assert_eq!(
        admit_market_data_coordinated_universe_program_event_v2(&plan, &frame, &[]),
        Err(ProgramHostV2Error::InputCoverage)
    );
    let mut host = started_universe_host(&plan, &artifact);
    assert_eq!(
        admit_owner_universe_program_event_v2(&plan, &OwnerUniverseFrameV1::uncoordinated(frame))
            .and_then(|event| host.apply_event(&event))
            .err(),
        Some(ProgramHostV2Error::InputCoverage)
    );
    assert_eq!(host.plugin_calls(), 0);
}

/// The coordinates must be exactly the Plan's (member, role) pairs: one fewer, one more at a member
/// the Plan does not bind, or the same pair twice is refused.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn coordinates_other_than_the_plan_pairs_are_refused() {
    use super::program_host_v2::{
        ProgramHostV2Error, admit_market_data_coordinated_universe_program_event_v2,
    };

    let (plan, _, frame) = universe_bfp_fixture();
    let coordinates = plan_member_coordinates(&plan, &frame);
    let admit = |coordinates: &[UniverseMemberSampleCoordinateV1]| {
        admit_market_data_coordinated_universe_program_event_v2(&plan, &frame, coordinates)
    };
    assert!(
        admit(&coordinates).is_ok(),
        "the Plan's own pairs are admitted"
    );

    let fewer = &coordinates[1..];
    let mut more = coordinates.clone();
    more.push(coordinates[0].clone().with_member_ordinal_for_test(1));
    let mut twice = coordinates.clone();
    twice.push(coordinates[0].clone());

    for (case, supplied) in [("fewer", fewer), ("more", &more[..]), ("twice", &twice[..])] {
        assert_eq!(
            admit(supplied),
            Err(ProgramHostV2Error::InputCoverage),
            "{case}"
        );
    }
}

/// A coordinate with no projection receipt, that does not name this frame, or that carries no BAR
/// schedule dependency is refused; the schedule dependency it does carry is part of the admitted
/// event identity.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_member_coordinate_names_this_frame_and_its_bar_schedule() {
    use super::program_host_v2::{
        ProgramHostV2Error, admit_market_data_coordinated_universe_program_event_v2,
    };

    let (plan, _, frame) = universe_bfp_fixture();
    let coordinates = plan_member_coordinates(&plan, &frame);
    let admit = |coordinates: &[UniverseMemberSampleCoordinateV1]| {
        admit_market_data_coordinated_universe_program_event_v2(&plan, &frame, coordinates)
    };
    let with_first =
        |change: &dyn Fn(UniverseMemberSampleCoordinateV1) -> UniverseMemberSampleCoordinateV1| {
            let mut changed = coordinates.clone();
            changed[0] = change(changed[0].clone());
            changed
        };

    for (case, changed) in [
        (
            "no schedule",
            with_first(&|coordinate| coordinate.with_schedule_dependency_for_test(None)),
        ),
        (
            "zero schedule",
            with_first(&|coordinate| {
                coordinate.with_schedule_dependency_for_test(Some(
                    BindingDigest::from_untrusted_bytes([0; 32]),
                ))
            }),
        ),
        (
            "zero projection receipt",
            with_first(&|coordinate| {
                coordinate
                    .with_projection_receipt_for_test(BindingDigest::from_untrusted_bytes([0; 32]))
            }),
        ),
        (
            "another subject",
            with_first(&|coordinate| {
                coordinate.with_subject_for_test(BindingDigest::from_untrusted_bytes([7; 32]))
            }),
        ),
    ] {
        assert_eq!(
            admit(&changed),
            Err(ProgramHostV2Error::InputCoverage),
            "{case}"
        );
    }

    let identity = admit(&coordinates).unwrap().admitted_identity();
    let rescheduled = with_first(&|coordinate| {
        coordinate
            .with_schedule_dependency_for_test(Some(BindingDigest::from_untrusted_bytes([9; 32])))
    });
    assert_ne!(
        admit(&rescheduled).unwrap().admitted_identity(),
        identity,
        "the BAR schedule dependency is part of the admitted identity"
    );
}

/// A universe Plan without coordinate rows admits its frame only without coordinates.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_plan_without_coordinate_rows_refuses_a_supplied_coordinate() {
    use super::program_host_v2::{
        ProgramHostV2Error, admit_market_data_coordinated_universe_program_event_v2,
    };

    let (plan, _, frame) = one_member_universe_fixture();
    assert!(plan.bfp_role_bindings().is_empty());
    let role = super::strategy_plan_v2::strategy_input_role_identity_v2(&plan.input_roles()[0]);
    assert!(
        admit_owner_universe_program_event_v2(
            &plan,
            &OwnerUniverseFrameV1::uncoordinated(frame.clone())
        )
        .is_ok()
    );
    assert_eq!(
        admit_market_data_coordinated_universe_program_event_v2(
            &plan,
            &frame,
            &[UniverseMemberSampleCoordinateV1::for_frame_test(
                &frame, 0, role
            )],
        ),
        Err(ProgramHostV2Error::InputCoverage)
    );
}

/// Market Data's sample projection over `frame`, sealed by the real codec, with a BAR schedule
/// per (member, role) derived from the pair so every schedule is distinct and nonzero.
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn market_data_projection(
    frame: &StrategyInputUniverseFrameReceipt,
) -> vibe_data::owner::universe_sample_projection_v1::StrategyInputUniverseSampleProjectionReadbackV1
{
    vibe_data::owner::universe_sample_projection_v1::sealed_acceptance::issue_sealed_acceptance_universe_sample_projection_v1(
        frame,
        |member_ordinal, role| {
            let mut bytes = *role.as_bytes();
            bytes[0] ^= member_ordinal.wrapping_add(1);
            BindingDigest::from_untrusted_bytes(bytes)
        },
    )
}

/// The control on the production pairing: the frame paired with the projection Market Data issued
/// for it is admitted through the host's pairing entry and runs the program.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_frame_paired_with_its_market_data_projection_runs_the_program() {
    use super::program_host_v2::{OwnerUniverseFrameV1, admit_owner_universe_program_event_v2};

    let (plan, artifact, frame) = universe_bfp_fixture();
    let projection = market_data_projection(&frame);
    let paired = OwnerUniverseFrameV1::from_owner_projection_v1(frame, &projection)
        .expect("the projection Market Data issued for this frame pairs with it");

    let event = admit_owner_universe_program_event_v2(&plan, &paired)
        .expect("the paired frame is admitted");
    let mut host = started_universe_host(&plan, &artifact);
    host.apply_event(&event)
        .expect("the program runs on the paired frame");
    assert_eq!(host.plugin_calls(), 1);
}

/// The refusal on the same entry: a Plan that reads member coordinates admits no frame paired
/// without them.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_coordinate_plan_refuses_its_frame_paired_without_coordinates() {
    use super::program_host_v2::{
        OwnerUniverseFrameV1, ProgramHostV2Error, admit_owner_universe_program_event_v2,
    };

    let (plan, _, frame) = universe_bfp_fixture();

    assert_eq!(
        admit_owner_universe_program_event_v2(&plan, &OwnerUniverseFrameV1::uncoordinated(frame)),
        Err(ProgramHostV2Error::InputCoverage)
    );
}

/// A projection Market Data issued for another frame pairs with no frame but its own.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn another_frames_projection_does_not_pair_with_this_frame() {
    use super::program_host_v2::{OwnerUniverseFrameV1, ProgramHostV2Error};

    let (_, _, frame) = universe_bfp_fixture();
    let (_, _, other) = super::program_host_v2_target_set_backtest_tests::fixture()
        .expect("the two-member target-set fixture");
    assert_ne!(other.digest(), frame.digest());

    assert_eq!(
        OwnerUniverseFrameV1::from_owner_projection_v1(frame, &market_data_projection(&other))
            .err(),
        Some(ProgramHostV2Error::InputCoverage)
    );
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
use vibe_data::owner::universe_sample_projection_v1::sealed_acceptance::SealedUniverseSampleProjectionTamperV1 as Tamper;

/// A projection changed in any one field it binds to the frame, and resealed by Market Data's real
/// codec so that it still decodes, pairs with the frame no longer. Each case changes one field of
/// the projection the control pairs.
///
/// Three changes cannot be built at all and are not listed: a BAR projection without a schedule
/// set or with a zero one, and a duplicated component, each fail Market Data's decoder as
/// non-canonical, so no consumer can be handed one. A BAR projection whose schedule set is another nonzero digest is not refused
/// here: the host holds no schedule to compare it with, and the set enters the admitted event's
/// identity instead.
#[rstest]
#[case::another_subject(Tamper::Subject(BindingDigest::from_untrusted_bytes([0x5A; 32])))]
#[case::event_lifecycle(Tamper::Lifecycle {
    schedule_set: BindingDigest::from_untrusted_bytes([0x5B; 32]),
})]
#[case::one_component_fewer(Tamper::DropLastComponent)]
#[case::one_component_more(Tamper::ExtraComponent)]
#[case::another_trigger(Tamper::Trigger(BindingDigest::from_untrusted_bytes([0x5C; 32])))]
#[case::another_value_receipt(Tamper::ValueReceipt(0, BindingDigest::from_untrusted_bytes([0x5D; 32])))]
#[case::another_member_binding(Tamper::MemberBinding(0, BindingDigest::from_untrusted_bytes([0x5E; 32])))]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_projection_changed_in_one_field_does_not_pair_with_its_frame(#[case] tamper: Tamper) {
    use super::program_host_v2::{OwnerUniverseFrameV1, ProgramHostV2Error};
    use vibe_data::owner::universe_sample_projection_v1::sealed_acceptance::reseal_sealed_acceptance_universe_sample_projection_v1;

    let (_, _, frame) = universe_bfp_fixture();
    let tampered = reseal_sealed_acceptance_universe_sample_projection_v1(
        &market_data_projection(&frame),
        tamper,
    );

    assert_eq!(
        OwnerUniverseFrameV1::from_owner_projection_v1(frame, &tampered).err(),
        Some(ProgramHostV2Error::InputCoverage)
    );
}

/// A projection naming another member key, or another instrument, for one of the frame's values
/// pairs with the frame no longer. Each is changed alone, so each of the two checks is exercised
/// without the other.
#[rstest]
#[cfg(feature = "sealed-strategy-input-acceptance")]
fn a_projection_naming_another_member_key_or_instrument_does_not_pair() {
    use super::program_host_v2::{OwnerUniverseFrameV1, ProgramHostV2Error};
    use vibe_data::owner::universe_sample_projection_v1::sealed_acceptance::reseal_sealed_acceptance_universe_sample_projection_v1;

    let (_, _, frame) = universe_bfp_fixture();
    let value = &frame.values()[0];
    let key: &'static str = Box::leak(value.member_key().to_owned().into_boxed_str());
    let instrument: &'static str = Box::leak(value.instrument().to_owned().into_boxed_str());

    for tamper in [
        Tamper::Member {
            index: 0,
            member_key: "OTHER",
            instrument,
        },
        Tamper::Member {
            index: 0,
            member_key: key,
            instrument: "OTHERUSDT-PERP.BINANCE",
        },
    ] {
        let tampered = reseal_sealed_acceptance_universe_sample_projection_v1(
            &market_data_projection(&frame),
            tamper,
        );
        assert_eq!(
            OwnerUniverseFrameV1::from_owner_projection_v1(frame.clone(), &tampered).err(),
            Some(ProgramHostV2Error::InputCoverage)
        );
    }
}
