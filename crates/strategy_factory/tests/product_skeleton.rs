use rstest::rstest;

use vibe_strategy_factory::{
    artifact::{BUILD_RECIPE_LOCATOR, GUEST_SOURCE_LOCATOR},
    decision::{
        ChannelProjection, CoreWasmValueType, DECISION_ABI_VERSION, DECISION_EXPORT,
        DECISION_SIGNATURE, DecisionAction, DecisionDirection, DecisionInput, EntryRule,
        ExecutionTiming, ExitRule, FinalBarInvocation, TerminalRule, ValidationInvocation,
        WarmupInvocation, ZeroVolumeInvocation,
    },
    intent::FROZEN_INTENT_ID,
    prepare_frozen_pilot,
    runtime::{RuntimeError, validate_restricted_module},
};

#[rstest]
fn restricted_wasm_accepts_only_the_exact_inert_compiler_memory_envelope() {
    let prepared = prepare_frozen_pilot().expect("frozen product skeleton prepares");
    validate_restricted_module(prepared.artifact().wasm()).expect("exact compiler envelope");
    let module_with_memory = [
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x05, 0x03, 0x01, 0x00, 0x01,
    ];
    assert_eq!(
        validate_restricted_module(&module_with_memory).unwrap_err(),
        RuntimeError::Envelope("fixed compiler memory")
    );
}

#[rstest]
fn intent_artifact_and_runtime_projection_are_deterministic() {
    let first = prepare_frozen_pilot().expect("first preparation");
    let second = prepare_frozen_pilot().expect("second preparation");
    assert_eq!(first.intent(), second.intent());
    assert_eq!(first.artifact(), second.artifact());
    assert_eq!(first.runtime(), second.runtime());
    let identity = first.artifact().identity();
    assert_eq!(identity.schema_version, 3);
    assert_eq!(identity.guest_source_locator, GUEST_SOURCE_LOCATOR);
    assert_eq!(identity.build_recipe_locator, BUILD_RECIPE_LOCATOR);
    assert_eq!(
        identity.guest_source_digest,
        format!(
            "blake3:{}",
            blake3::hash(include_bytes!("../guest/pilot.rs")).to_hex()
        )
    );
    assert_eq!(
        identity.build_recipe_digest,
        format!(
            "blake3:{}",
            blake3::hash(include_bytes!("../build.rs")).to_hex()
        )
    );
    assert_eq!(
        first.artifact().identity().artifact_digest,
        first.runtime().artifact_digest
    );
}

#[rstest]
fn application_preparation_carries_the_exact_dormant_decision_contract() {
    let prepared = prepare_frozen_pilot().expect("frozen product skeleton prepares");
    let contract = prepared.decision_contract();

    assert_eq!(contract.version(), DECISION_ABI_VERSION);
    assert_eq!(contract.export(), DECISION_EXPORT);
    assert_eq!(
        contract.signature().parameters(),
        &[
            CoreWasmValueType::I32,
            CoreWasmValueType::I32,
            CoreWasmValueType::F64,
            CoreWasmValueType::F64,
            CoreWasmValueType::F64,
            CoreWasmValueType::F64,
            CoreWasmValueType::F64,
        ]
    );
    assert_eq!(contract.signature().result(), CoreWasmValueType::I32);
    contract
        .validate_abi(DECISION_ABI_VERSION, DECISION_EXPORT, &DECISION_SIGNATURE)
        .expect("exact ABI identity");
    assert_eq!(contract.intent_identity(), FROZEN_INTENT_ID);
    assert_eq!(
        contract.pilot_id(),
        "btc-usdt-1h-dual-timescale-breakout-v1"
    );

    let mechanism = contract.mechanism();
    assert_eq!(mechanism.direction(), DecisionDirection::LongOnly);
    assert_eq!(
        mechanism.entry(),
        EntryRule::CurrentFastEmaAboveSlowAndCloseAbovePrior72High
    );
    assert_eq!(
        mechanism.exit(),
        ExitRule::CloseBelowPrior24LowOrCurrentFastEmaNotAboveSlow
    );
    assert_eq!(
        mechanism.execution(),
        ExecutionTiming::NextExecutableExternalBarOpen
    );
    assert_eq!(
        mechanism.terminal(),
        TerminalRule::PenultimateSignalFinalOpenExecution
    );
    assert_eq!(mechanism.entry_lookback(), 72);
    assert_eq!(mechanism.exit_lookback(), 24);
    assert_eq!(mechanism.fast_ema(), 24);
    assert_eq!(mechanism.slow_ema(), 120);

    let invocation = contract.invocation();
    assert_eq!(
        invocation.warmup(),
        WarmupInvocation::UpdateNativeIndicatorsWithoutGuest
    );
    assert_eq!(
        invocation.zero_volume(),
        ZeroVolumeInvocation::NoIndicatorGuestOrOrder
    );
    assert_eq!(
        invocation.validation(),
        ValidationInvocation::CurrentEmaAndPreviousCallbackChannels
    );
    assert_eq!(
        invocation.channels(),
        ChannelProjection::PreviousCallbackPrior72HighAndPrior24Low
    );
    assert_eq!(
        invocation.final_bar(),
        FinalBarInvocation::ReleasePenultimateExitAtOpenWithoutCloseDecision
    );
}

#[rstest]
fn application_preparation_executes_the_frozen_guest_truth_table() {
    let mut prepared = prepare_frozen_pilot().expect("frozen product skeleton prepares");
    let cases = [
        (
            (0, 0, 110.0, 2.0, 1.0, 100.0, 80.0),
            DecisionAction::EnterLong,
        ),
        ((0, 0, 100.0, 2.0, 1.0, 100.0, 80.0), DecisionAction::Hold),
        (
            (0, 1, 79.0, 2.0, 1.0, 100.0, 80.0),
            DecisionAction::ExitLong,
        ),
        (
            (0, 1, 90.0, 1.0, 1.0, 100.0, 80.0),
            DecisionAction::ExitLong,
        ),
        ((0, 1, 90.0, 2.0, 1.0, 100.0, 80.0), DecisionAction::Hold),
        (
            (1, 1, 90.0, 2.0, 1.0, 100.0, 80.0),
            DecisionAction::ExitLong,
        ),
        ((1, 0, 110.0, 2.0, 1.0, 100.0, 80.0), DecisionAction::Hold),
    ];

    for ((phase, position, close, fast, slow, prior_high, prior_low), expected) in cases {
        let input =
            DecisionInput::from_abi(phase, position, close, fast, slow, prior_high, prior_low)
                .expect("closed finite decision input");
        assert_eq!(prepared.decide(input).expect("guest decision"), expected);
    }
}
