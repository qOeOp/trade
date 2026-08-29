use rstest::rstest;
use vibe_data::owner::{
    instrument_master::InstrumentMasterReadbackV1, sealed_replay_input::SealedReplayInput,
    strategy_input_binding::StrategyInputBindingReceipt,
};
use vibe_strategy_factory::{
    PreparedProgramHostCapabilityV2, ProgramPreparationFaultV2,
    develop_composer_postgres_v2::SealedDevelopComposerReadbackV2,
    exploratory_replay::SealedExploratoryReplayReadbackV2,
    prepare_program_host_from_owner_readbacks_v2,
    program_host_v2::{ProgramHostV2, ProgramHostV2Error},
};

type OwnerSealedIssuerV2 = fn(
    &SealedExploratoryReplayReadbackV2,
    &SealedDevelopComposerReadbackV2,
    SealedReplayInput,
    InstrumentMasterReadbackV1,
    Vec<StrategyInputBindingReceipt>,
)
    -> Result<PreparedProgramHostCapabilityV2, ProgramPreparationFaultV2>;

type PreparedProgramHostPartsV2 = (
    ProgramHostV2,
    SealedReplayInput,
    InstrumentMasterReadbackV1,
    Vec<StrategyInputBindingReceipt>,
);

fn accepts_backtest_consumer(
    _: impl FnOnce(
        PreparedProgramHostCapabilityV2,
    ) -> Result<PreparedProgramHostPartsV2, ProgramHostV2Error>,
) {
}

#[rstest]
fn external_backtest_application_compiles_the_real_consuming_handoff() {
    let issuer: OwnerSealedIssuerV2 = prepare_program_host_from_owner_readbacks_v2;
    let consumer = |capability: PreparedProgramHostCapabilityV2| {
        let (host, replay_input, instrument_master, input_bindings) =
            capability.into_program_host_parts_v2()?;
        let _prepared_host_identity = host.host_identity();
        Ok::<PreparedProgramHostPartsV2, ProgramHostV2Error>((
            host,
            replay_input,
            instrument_master,
            input_bindings,
        ))
    };

    let _owner_sealed_issuer = issuer;
    accepts_backtest_consumer(consumer);
}
