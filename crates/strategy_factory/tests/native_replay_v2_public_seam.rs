use rstest::rstest;
use vibe_data::owner::{
    instrument_master::InstrumentMasterReadbackV1,
    sample_projection::StrategyInputSampleProjectionReadbackV2,
    sealed_replay_input::SealedReplayInput, strategy_input_binding::StrategyInputBindingReceipt,
    strategy_input_joined_cut::StrategyInputJoinedCutReceiptV1,
};
use vibe_strategy_factory::{
    PreparedProgramHostCapabilityV2, PreparedProgramHostHandoffV2, ProgramPreparationFaultV2,
    develop_composer_postgres_v2::SealedDevelopComposerReadbackV2,
    exploratory_replay::SealedExploratoryReplayReadbackV2,
    prepare_program_host_from_owner_readbacks_v2, program_host_v2::ProgramHostV2Error,
};

type OwnerSealedIssuerV2 = fn(
    &SealedExploratoryReplayReadbackV2,
    &SealedDevelopComposerReadbackV2,
    SealedReplayInput,
    InstrumentMasterReadbackV1,
    Vec<StrategyInputBindingReceipt>,
    StrategyInputJoinedCutReceiptV1,
    StrategyInputSampleProjectionReadbackV2,
)
    -> Result<PreparedProgramHostCapabilityV2, ProgramPreparationFaultV2>;

fn accepts_handoff_transition(
    _: impl FnOnce(
        PreparedProgramHostCapabilityV2,
    ) -> Result<PreparedProgramHostHandoffV2, ProgramHostV2Error>,
) {
}

fn accepts_backtest_consumer(_: impl FnOnce(PreparedProgramHostHandoffV2)) {}

type ExactBacktestConsumerV2 = fn(PreparedProgramHostHandoffV2);
type PreparedPublicObservationV2 = ([u8; 32], usize, [u8; 32], u32);
type PublicConsumerResultV2 = Result<PreparedPublicObservationV2, Box<dyn std::error::Error>>;

fn accepts_exact_backtest_consumer(_: ExactBacktestConsumerV2) {}

#[allow(dead_code)]
fn public_owner_projection_consumer(
    replay: &SealedExploratoryReplayReadbackV2,
    composer: &SealedDevelopComposerReadbackV2,
    replay_input: SealedReplayInput,
    instrument_master: InstrumentMasterReadbackV1,
    input_bindings: Vec<StrategyInputBindingReceipt>,
    joined_cut: StrategyInputJoinedCutReceiptV1,
    sample_projection: StrategyInputSampleProjectionReadbackV2,
) -> PublicConsumerResultV2 {
    let handoff = prepare_program_host_from_owner_readbacks_v2(
        replay,
        composer,
        replay_input,
        instrument_master,
        input_bindings,
        joined_cut,
        sample_projection,
    )?
    .into_program_host_handoff_v2()?;
    Ok((
        *handoff.host_identity().as_bytes(),
        handoff.input_binding_count(),
        handoff.sample_projection_digest(),
        handoff.sample_projection_component_count(),
    ))
}

#[rstest]
fn external_backtest_application_compiles_the_real_consuming_handoff() {
    let issuer: OwnerSealedIssuerV2 = prepare_program_host_from_owner_readbacks_v2;
    let transition =
        |capability: PreparedProgramHostCapabilityV2| capability.into_program_host_handoff_v2();
    let consumer = |handoff: PreparedProgramHostHandoffV2| {
        let _prepared_host_identity = handoff.host_identity();
        let _prepared_input_binding_count = handoff.input_binding_count();
        let _owner_projection_digest = handoff.sample_projection_digest();
        let _owner_projection_component_count = handoff.sample_projection_component_count();
    };

    let _owner_sealed_issuer = issuer;
    accepts_handoff_transition(transition);
    accepts_backtest_consumer(consumer);
    accepts_exact_backtest_consumer(consumer);
}
