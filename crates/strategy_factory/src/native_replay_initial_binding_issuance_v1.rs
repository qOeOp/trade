//! Request-only composition for the first durable Native Replay execution-input binding.

use sqlx::{Postgres, Transaction};
use thiserror::Error;
use vibe_data::owner::{
    instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresOwnerV1,
    instrument_master_v2::{InstrumentMasterResolverV2, native_replay_request_identity_v2},
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    native_replay_scheduling_v1::NativeReplaySchedulingResolverV1,
};

use crate::{
    artifact_v2::StrategyArtifactV2,
    develop_composer_postgres_v2::DevelopComposerSealedReadPortV2,
    exploratory_replay::ExploratoryReplayRequestLocatorV2,
    native_replay_execution_input_binding_v1::{
        NativeReplayExecutionInputBindingReadbackV1,
        issue_native_replay_execution_input_binding_from_owner_readbacks_v1,
    },
    native_replay_initial_owner_inputs_v1::resolve_native_replay_initial_owner_inputs_v1,
    native_replay_preparation_inputs_v2::resolve_native_replay_preparation_inputs_v2_in_transaction,
    replay_execution_profile_binding_v1::issue_owner_replay_execution_profile_binding_from_readbacks_v1,
    strategy_plan_v2::StrategyPlanV2,
};

#[derive(Debug, Error)]
#[error("Native Replay initial execution-input binding is unavailable")]
pub(crate) struct NativeReplayInitialBindingIssuanceErrorV1;

pub(crate) async fn issue_native_replay_initial_binding_v1_in_transaction<P, R>(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &ExploratoryReplayRequestLocatorV2,
    composer: &P,
    instrument_master_owner: &InstrumentMasterV2PostgresOwner,
    instrument_terms_owner: &InstrumentEconomicTermsPostgresOwnerV1,
    market_data: &R,
) -> Result<NativeReplayExecutionInputBindingReadbackV1, NativeReplayInitialBindingIssuanceErrorV1>
where
    P: DevelopComposerSealedReadPortV2 + ?Sized,
    R: NativeReplaySchedulingResolverV1 + ?Sized,
{
    let preparation =
        resolve_native_replay_preparation_inputs_v2_in_transaction(transaction, locator, composer)
            .await
            .map_err(|_| NativeReplayInitialBindingIssuanceErrorV1)?;
    let projected_plan =
        StrategyPlanV2::decode_owner_resolution_projection(preparation.composer().plan_bytes())
            .map_err(|_| NativeReplayInitialBindingIssuanceErrorV1)?;
    let request = preparation.replay().request().as_dto();
    let master_request_identity =
        native_replay_request_identity_v2(request.request_identity.as_str())
            .map_err(|_| NativeReplayInitialBindingIssuanceErrorV1)?;
    let instrument_master = instrument_master_owner
        .resolve_instrument_master_v2_for_native_replay_request(request.request_identity.as_str())
        .await
        .map_err(|_| NativeReplayInitialBindingIssuanceErrorV1)?;
    if instrument_master.cut().request_identity() != master_request_identity {
        return Err(NativeReplayInitialBindingIssuanceErrorV1);
    }
    let catalog = preparation
        .family()
        .root()
        .policy()
        .replay_policy_catalog_v3()
        .ok_or(NativeReplayInitialBindingIssuanceErrorV1)?;
    let (economic, _) = catalog
        .verify()
        .map_err(|_| NativeReplayInitialBindingIssuanceErrorV1)?;
    let terms = instrument_terms_owner
        .resolve_unique_native_replay_pair(
            &instrument_master,
            &economic.input().venue_identity,
            &economic.input().common_quote_currency,
            i128::from(request.window.start_event_ns),
        )
        .await
        .map_err(|_| NativeReplayInitialBindingIssuanceErrorV1)?;
    let profile = issue_owner_replay_execution_profile_binding_from_readbacks_v1(
        preparation.family(),
        preparation.replay(),
        [&terms[0], &terms[1]],
    )
    .map_err(|_| NativeReplayInitialBindingIssuanceErrorV1)?;
    let market = resolve_native_replay_initial_owner_inputs_v1(
        &preparation,
        &projected_plan,
        &instrument_master,
        market_data,
    )
    .await
    .map_err(|_| NativeReplayInitialBindingIssuanceErrorV1)?;
    let (universe_frame, schedules) = market.into_binding_parts();
    let plan = StrategyPlanV2::parse_and_revalidate_durable_with_owner_universe(
        preparation.composer().plan_bytes(),
        &universe_frame,
        projected_plan.research_request_identity(),
        projected_plan.design_identity(),
    )
    .map_err(|_| NativeReplayInitialBindingIssuanceErrorV1)?;
    let artifact = StrategyArtifactV2::parse_and_revalidate_durable(
        preparation.composer().artifact_package_bytes(),
        preparation
            .composer()
            .module_bytes()
            .map(|bytes| bytes.to_vec().into_boxed_slice())
            .collect(),
        &plan,
    )
    .map_err(|_| NativeReplayInitialBindingIssuanceErrorV1)?;
    issue_native_replay_execution_input_binding_from_owner_readbacks_v1(
        transaction,
        &preparation,
        &profile,
        &plan,
        &artifact,
        &instrument_master,
        [&terms[0], &terms[1]],
        &universe_frame,
        [&schedules[0], &schedules[1]],
    )
    .await
    .map_err(|_| NativeReplayInitialBindingIssuanceErrorV1)
}
