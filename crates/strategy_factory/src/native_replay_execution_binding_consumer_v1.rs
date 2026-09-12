//! Consumer-side reconstruction of a Native Replay bundle from one durable R&D binding.

use sqlx::{Postgres, Transaction};
use thiserror::Error;
use vibe_data::owner::{
    instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresOwnerV1,
    instrument_master_v2::InstrumentMasterResolverV2,
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    native_replay_scheduling_v1::NativeReplaySchedulingResolverV1,
};
use vibe_model::identifiers::StrategyId;

use crate::{
    artifact_v2::StrategyArtifactV2,
    develop_composer_postgres_v2::DevelopComposerSealedReadPortV2,
    exploratory_replay::ExploratoryReplayRequestLocatorV2,
    native_replay_execution_input_binding_v1::{
        resolve_native_replay_execution_input_binding_for_request_v1_in_transaction,
        verify_re_resolved_native_replay_execution_inputs_v1,
    },
    native_replay_initial_owner_inputs_v1::resolve_native_replay_initial_owner_inputs_v1,
    native_replay_preparation_inputs_v2::resolve_native_replay_preparation_inputs_v2_in_transaction,
    replay_execution_profile_binding_v1::issue_owner_replay_execution_profile_binding_from_readbacks_v1,
    replay_target_set_execution_bundle_v1::ReplayTargetSetExecutionBundleV1,
    strategy_plan_v2::StrategyPlanV2,
};

#[derive(Debug, Error)]
#[error("Native Replay execution bundle is unavailable")]
pub(crate) struct NativeReplayExecutionBindingConsumerErrorV1;

#[allow(clippy::too_many_arguments)]
pub(crate) async fn resolve_native_replay_execution_bundle_v1_in_transaction<P, R>(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &ExploratoryReplayRequestLocatorV2,
    composer: &P,
    instrument_master_owner: &InstrumentMasterV2PostgresOwner,
    instrument_terms_owner: &InstrumentEconomicTermsPostgresOwnerV1,
    market_data: &R,
    strategy_id: StrategyId,
    run_id: String,
) -> Result<ReplayTargetSetExecutionBundleV1, NativeReplayExecutionBindingConsumerErrorV1>
where
    P: DevelopComposerSealedReadPortV2 + ?Sized,
    R: NativeReplaySchedulingResolverV1 + ?Sized,
{
    let stored = resolve_native_replay_execution_input_binding_for_request_v1_in_transaction(
        transaction,
        locator,
    )
    .await
    .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)?
    .ok_or(NativeReplayExecutionBindingConsumerErrorV1)?;
    let preparation =
        resolve_native_replay_preparation_inputs_v2_in_transaction(transaction, locator, composer)
            .await
            .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)?;
    let projected_plan =
        StrategyPlanV2::decode_owner_resolution_projection(preparation.composer().plan_bytes())
            .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)?;
    let request = preparation.replay().request().as_dto();
    let instrument_master = instrument_master_owner
        .resolve_instrument_master_v2_for_native_replay_request(request.request_identity.as_str())
        .await
        .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)?;
    let economic_locators = stored
        .instrument_economic_terms_locators()
        .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)?;
    let first_terms = instrument_terms_owner
        .resolve(economic_locators[0])
        .await
        .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)?;
    let second_terms = instrument_terms_owner
        .resolve(economic_locators[1])
        .await
        .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)?;
    let terms = [first_terms, second_terms];
    let profile = issue_owner_replay_execution_profile_binding_from_readbacks_v1(
        preparation.family(),
        preparation.replay(),
        [&terms[0], &terms[1]],
    )
    .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)?;
    let market = resolve_native_replay_initial_owner_inputs_v1(
        &preparation,
        &projected_plan,
        &instrument_master,
        market_data,
    )
    .await
    .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)?;
    let plan = StrategyPlanV2::parse_and_revalidate_durable_with_owner_universe(
        preparation.composer().plan_bytes(),
        market.universe_frame(),
        projected_plan.research_request_identity(),
        projected_plan.design_identity(),
    )
    .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)?;
    let artifact = StrategyArtifactV2::parse_and_revalidate_durable(
        preparation.composer().artifact_package_bytes(),
        preparation
            .composer()
            .module_bytes()
            .map(|bytes| bytes.to_vec().into_boxed_slice())
            .collect(),
        &plan,
    )
    .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)?;
    verify_re_resolved_native_replay_execution_inputs_v1(
        &stored,
        &preparation,
        &profile,
        &plan,
        &artifact,
        &instrument_master,
        [&terms[0], &terms[1]],
        market.universe_frame(),
        [&market.schedules()[0], &market.schedules()[1]],
    )
    .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)?;
    let public_terms = [
        instrument_master.cut().members()[0]
            .fact()
            .validate_native_crypto_perpetual_public_terms()
            .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)?,
        instrument_master.cut().members()[1]
            .fact()
            .validate_native_crypto_perpetual_public_terms()
            .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)?,
    ];
    let (universe_frame, scheduling) = market
        .into_execution_parts()
        .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)?;
    ReplayTargetSetExecutionBundleV1::new(
        profile,
        plan,
        artifact,
        universe_frame,
        strategy_id,
        run_id,
        public_terms,
        scheduling,
    )
    .map_err(|_| NativeReplayExecutionBindingConsumerErrorV1)
}
