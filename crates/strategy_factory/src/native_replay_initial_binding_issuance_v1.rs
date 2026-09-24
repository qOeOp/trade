//! Request-only composition for the first durable Native Replay execution-input binding.

use std::fmt::Display;

use sqlx::{Postgres, Transaction};
use vibe_data::owner::{
    instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresOwnerV1,
    instrument_master_v2::{
        InstrumentMasterCustodyErrorV2, InstrumentMasterResolverV2,
        native_replay_request_identity_v2,
    },
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    native_replay_scheduling_v1::NativeReplaySchedulingResolverV1,
};

use crate::{
    artifact_v2::StrategyArtifactV2,
    develop_composer_postgres_v2::DevelopComposerSealedReadPortV2,
    exploratory_replay::ExploratoryReplayRequestLocatorV2,
    native_replay_execution_input_binding_v1::{
        NativeReplayExecutionInputBindingErrorV1, NativeReplayExecutionInputBindingReadbackV1,
        issue_native_replay_execution_input_binding_from_owner_readbacks_v1,
    },
    native_replay_initial_owner_inputs_v1::resolve_native_replay_initial_owner_inputs_v1,
    native_replay_preparation_inputs_v2::resolve_native_replay_preparation_inputs_v2_in_transaction,
    replay_execution_profile_binding_v1::issue_owner_replay_execution_profile_binding_from_readbacks_v1,
    strategy_plan_v2::StrategyPlanV2,
};

/// Records why one composition stage refused, then returns the refusal the caller is given.
///
/// Every stage before the final issue collapses into `Unavailable`, which names none of them, so
/// each first records its cause under a coordinate naming the stage: grep
/// `native_replay_initial_binding.` to find which one it was. Two earlier answers are named
/// instead: a request with no composition binding is `NoCompositionBinding`, and an Instrument
/// Master cut already issued for the request under another binding is `Conflict`, recorded under
/// its coordinate the same way. The final issue's own error is not collapsed and not recorded
/// here: it already names `Conflict` and `Storage`, and a cause the caller can be told should be
/// told rather than logged.
fn unavailable(
    coordinate: &'static str,
    cause: &impl Display,
) -> NativeReplayExecutionInputBindingErrorV1 {
    crate::storage_diagnostic::refused_by_store(coordinate, cause);
    NativeReplayExecutionInputBindingErrorV1::Unavailable
}

pub(crate) async fn issue_native_replay_initial_binding_v1_in_transaction<P, R>(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &ExploratoryReplayRequestLocatorV2,
    composer: &P,
    instrument_master_owner: &InstrumentMasterV2PostgresOwner,
    instrument_terms_owner: &InstrumentEconomicTermsPostgresOwnerV1,
    market_data: &R,
) -> Result<NativeReplayExecutionInputBindingReadbackV1, NativeReplayExecutionInputBindingErrorV1>
where
    P: DevelopComposerSealedReadPortV2 + ?Sized,
    R: NativeReplaySchedulingResolverV1 + ?Sized,
{
    let preparation =
        resolve_native_replay_preparation_inputs_v2_in_transaction(transaction, locator, composer)
            .await
            .map_err(|e| unavailable("native_replay_initial_binding.preparation.resolve", &e))?;
    let projected_plan =
        StrategyPlanV2::decode_owner_resolution_projection(preparation.composer().plan_bytes())
            .map_err(|e| unavailable("native_replay_initial_binding.plan.decode_projection", &e))?;
    let request = preparation.replay().request().as_dto();
    let master_request_identity =
        native_replay_request_identity_v2(request.request_identity.as_str()).map_err(|e| {
            unavailable(
                "native_replay_initial_binding.instrument_master.request_identity",
                &e,
            )
        })?;
    let composition_binding =
        crate::exploratory_replay::postgres::read_composer_v3_market_data_binding_in_transaction(
            transaction,
            request.request_identity.as_str(),
        )
        .await
        .map_err(|e| unavailable("native_replay_initial_binding.composition_binding.read", &e))?
        .ok_or(NativeReplayExecutionInputBindingErrorV1::NoCompositionBinding)?;
    // Market Data issues the request-keyed cut in its own transaction before this one resolves it
    // under the same key. It is not atomic with this transaction: when a later stage here fails,
    // the cut stays and the retry reuses it. Moving this after the resolve, or dropping it, leaves
    // the resolve with no cut to find for any request.
    instrument_master_owner
        .issue_cut_for_bound_replay_v1(request.request_identity.as_str(), composition_binding)
        .await
        .map_err(|e| {
            let coordinate = "native_replay_initial_binding.instrument_master.issue";

            match e {
                InstrumentMasterCustodyErrorV2::BoundReplayBindingConflict
                | InstrumentMasterCustodyErrorV2::RequestConflict => {
                    crate::storage_diagnostic::refused_by_store(coordinate, &e);
                    NativeReplayExecutionInputBindingErrorV1::Conflict
                }
                InstrumentMasterCustodyErrorV2::InvalidRequest
                | InstrumentMasterCustodyErrorV2::InvalidUniverseSelection
                | InstrumentMasterCustodyErrorV2::MissingFact
                | InstrumentMasterCustodyErrorV2::ChainMismatch
                | InstrumentMasterCustodyErrorV2::CodecMismatch
                | InstrumentMasterCustodyErrorV2::CrossSpliced
                | InstrumentMasterCustodyErrorV2::IdentityConflict
                | InstrumentMasterCustodyErrorV2::UnknownLocator
                | InstrumentMasterCustodyErrorV2::StoreUnavailable
                | InstrumentMasterCustodyErrorV2::AclUnavailable
                | InstrumentMasterCustodyErrorV2::BoundReplayBindingUnavailable => {
                    unavailable(coordinate, &e)
                }
            }
        })?;
    let instrument_master = instrument_master_owner
        .resolve_instrument_master_v2_for_native_replay_request(request.request_identity.as_str())
        .await
        .map_err(|e| {
            unavailable(
                "native_replay_initial_binding.instrument_master.resolve",
                &e,
            )
        })?;

    if instrument_master.cut().request_identity() != master_request_identity {
        return Err(unavailable(
            "native_replay_initial_binding.instrument_master.cut",
            &"Instrument Master cut belongs to a different Replay request",
        ));
    }
    let catalog = preparation
        .family()
        .root()
        .policy()
        .replay_policy_catalog_v3()
        .ok_or_else(|| {
            unavailable(
                "native_replay_initial_binding.replay_policy_catalog.select",
                &"sealed Replay policy carries no Replay Policy Catalog V3",
            )
        })?;
    let (economic, _) = catalog.verify().map_err(|e| {
        unavailable(
            "native_replay_initial_binding.replay_policy_catalog.verify",
            &e,
        )
    })?;
    let terms = instrument_terms_owner
        .resolve_unique_native_replay_pair(
            &instrument_master,
            &economic.input().venue_identity,
            &economic.input().common_quote_currency,
            i128::from(request.window.start_event_ns),
        )
        .await
        .map_err(|e| unavailable("native_replay_initial_binding.economic_terms.resolve", &e))?;
    let term_readbacks = terms.iter().collect::<Vec<_>>();
    let profile = issue_owner_replay_execution_profile_binding_from_readbacks_v1(
        preparation.family(),
        preparation.replay(),
        &term_readbacks,
    )
    .map_err(|e| unavailable("native_replay_initial_binding.profile_authority.issue", &e))?;
    let (_market_request, market) = resolve_native_replay_initial_owner_inputs_v1(
        &preparation,
        &projected_plan,
        &instrument_master,
        market_data,
    )
    .await
    .map_err(|e| unavailable("native_replay_initial_binding.market_inputs.resolve", &e))?;
    let (universe_frame, schedules) = market.into_binding_parts();
    let plan = StrategyPlanV2::parse_and_revalidate_durable_with_owner_universe(
        preparation.composer().plan_bytes(),
        &universe_frame,
        projected_plan.research_request_identity(),
        projected_plan.design_identity(),
    )
    .map_err(|e| {
        unavailable(
            "native_replay_initial_binding.plan.revalidate_with_universe",
            &e,
        )
    })?;
    let artifact = StrategyArtifactV2::parse_and_revalidate_durable(
        preparation.composer().artifact_package_bytes(),
        preparation
            .composer()
            .module_bytes()
            .map(|bytes| bytes.to_vec().into_boxed_slice())
            .collect(),
        &plan,
    )
    .map_err(|e| unavailable("native_replay_initial_binding.artifact.revalidate", &e))?;
    issue_native_replay_execution_input_binding_from_owner_readbacks_v1(
        transaction,
        &preparation,
        &profile,
        &plan,
        &artifact,
        &instrument_master,
        &term_readbacks,
        &universe_frame,
        &schedules.iter().collect::<Vec<_>>(),
    )
    .await
}
