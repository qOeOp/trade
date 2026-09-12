//! Production Strategy Factory resolver for Backtest-owned Native Replay preparation.

use std::{future::Future, pin::Pin, sync::Arc};

use vibe_backtest_owner_contracts::{ObservationComponentV2, OpaqueIdentityV2, ReplayRequestV2};
use vibe_data::owner::{
    instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresOwnerV1,
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    native_replay_scheduling_v1::NativeReplaySchedulingResolverV1,
};
use vibe_model::identifiers::StrategyId;

use crate::{
    develop_composer_postgres_v2::DevelopComposerSealedReadPortV2,
    exploratory_replay::ExploratoryReplayRequestLocatorV2,
    native_replay_execution_binding_consumer_v1::{
        ResolvedNativeReplayExecutionBundleV1,
        resolve_native_replay_execution_bundle_v1_in_transaction,
    },
    native_replay_preparation_owner_v2::{
        NativeReplayExecutionPreparationErrorV2, NativeReplayExecutionPreparationResolverV2,
        NativeReplayExecutionPreparationV2, NativeReplayOwnerObservationV2, sealed,
    },
    native_replay_rd_sources_v2::NativeReplayRdSourcesV2,
    product_edge_postgres::PostgresResearchGoalOwnerV1,
};

const RD_OWNER_NAMESPACE: &str = "rd-owner-v2";
const COMPOSER_OWNER_NAMESPACE: &str = "rd-composer-owner-v2";
const BINDING_OWNER_NAMESPACE: &str = "rd-native-replay-binding-owner-v1";

/// Resolves one exact R&D request and all execution inputs before handing ownership to Backtest.
pub struct PostgresNativeReplayExecutionPreparationResolverV2 {
    research_owner: Arc<PostgresResearchGoalOwnerV1>,
    composer: Arc<dyn DevelopComposerSealedReadPortV2>,
    instrument_master_owner: Arc<InstrumentMasterV2PostgresOwner>,
    instrument_terms_owner: Arc<InstrumentEconomicTermsPostgresOwnerV1>,
    market_data: Arc<dyn NativeReplaySchedulingResolverV1>,
}

impl PostgresNativeReplayExecutionPreparationResolverV2 {
    #[must_use]
    pub fn new(
        research_owner: Arc<PostgresResearchGoalOwnerV1>,
        composer: Arc<dyn DevelopComposerSealedReadPortV2>,
        instrument_master_owner: Arc<InstrumentMasterV2PostgresOwner>,
        instrument_terms_owner: Arc<InstrumentEconomicTermsPostgresOwnerV1>,
        market_data: Arc<dyn NativeReplaySchedulingResolverV1>,
    ) -> Self {
        Self {
            research_owner,
            composer,
            instrument_master_owner,
            instrument_terms_owner,
            market_data,
        }
    }
}

impl sealed::Sealed for PostgresNativeReplayExecutionPreparationResolverV2 {}

impl NativeReplayExecutionPreparationResolverV2
    for PostgresNativeReplayExecutionPreparationResolverV2
{
    fn resolve_native_replay_execution_preparation_v2<'a>(
        &'a self,
        locator: &'a ExploratoryReplayRequestLocatorV2,
        attempt_identity: &'a OpaqueIdentityV2,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        NativeReplayExecutionPreparationV2,
                        NativeReplayExecutionPreparationErrorV2,
                    >,
                > + 'a,
        >,
    > {
        Box::pin(async move {
            let strategy_identity = derived_identity(
                "strategy-factory.native-replay.strategy.v2",
                locator,
                attempt_identity,
            )?;
            let run_identity = derived_identity(
                "strategy-factory.native-replay.run.v2",
                locator,
                attempt_identity,
            )?;
            let mut transaction = self
                .research_owner
                .native_replay_pool_v2()
                .begin()
                .await
                .map_err(unavailable)?;
            sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
                .execute(&mut *transaction)
                .await
                .map_err(unavailable)?;
            let resolved = resolve_native_replay_execution_bundle_v1_in_transaction(
                &mut transaction,
                locator,
                self.composer.as_ref(),
                self.instrument_master_owner.as_ref(),
                self.instrument_terms_owner.as_ref(),
                self.market_data.as_ref(),
                StrategyId::from(strategy_identity.as_str()),
                run_identity,
            )
            .await
            .map_err(unavailable)?;
            transaction.commit().await.map_err(unavailable)?;
            materialize_preparation(resolved, locator, attempt_identity)
        })
    }
}

fn materialize_preparation(
    resolved: ResolvedNativeReplayExecutionBundleV1,
    locator: &ExploratoryReplayRequestLocatorV2,
    attempt_identity: &OpaqueIdentityV2,
) -> Result<NativeReplayExecutionPreparationV2, NativeReplayExecutionPreparationErrorV2> {
    let deterministic_fill_seed = resolved.request.request().as_dto().deterministic_seed;
    let observations = owner_observations(
        resolved.request.request(),
        &resolved.rd_sources,
        &resolved.design_bytes,
        &resolved.plan_bytes,
        &resolved.artifact_bytes,
        &resolved.binding_bytes,
    )?;
    let semantic_trace_reference = opaque_derived_identity(
        "strategy-factory.native-replay.semantic-trace.v2",
        locator,
        attempt_identity,
    )?;
    let instance_identity = opaque_derived_identity(
        "strategy-factory.native-replay.instance.v2",
        locator,
        attempt_identity,
    )?;
    Ok(NativeReplayExecutionPreparationV2::from_owner_resolution(
        resolved.request,
        resolved.execution,
        observations,
        semantic_trace_reference,
        deterministic_fill_seed,
        instance_identity,
    ))
}

fn owner_observations(
    request: &ReplayRequestV2,
    rd_sources: &NativeReplayRdSourcesV2,
    design_bytes: &[u8],
    plan_bytes: &[u8],
    artifact_bytes: &[u8],
    binding_bytes: &[u8],
) -> Result<Vec<NativeReplayOwnerObservationV2>, NativeReplayExecutionPreparationErrorV2> {
    let request_bytes = rd_sources.exploratory_replay_request().canonical_bytes();
    request
        .requested_component_meanings()
        .map_err(unavailable)?
        .into_iter()
        .enumerate()
        .map(|(ordinal, (component, identity, digest))| {
            let (namespace, bytes) = match component {
                ObservationComponentV2::FrozenResearchIntent => (
                    RD_OWNER_NAMESPACE,
                    rd_sources.frozen_research_intent().canonical_bytes(),
                ),
                ObservationComponentV2::TrialFamily => (
                    RD_OWNER_NAMESPACE,
                    rd_sources.trial_family_root().canonical_bytes(),
                ),
                ObservationComponentV2::TrialFamilyCensusFrontier => (
                    RD_OWNER_NAMESPACE,
                    rd_sources.trial_family_census_frontier().canonical_bytes(),
                ),
                ObservationComponentV2::ReplayAuthority => (
                    RD_OWNER_NAMESPACE,
                    rd_sources.replay_authority().canonical_bytes(),
                ),
                ObservationComponentV2::StrategyDesign => (COMPOSER_OWNER_NAMESPACE, design_bytes),
                ObservationComponentV2::StrategyPlan => (COMPOSER_OWNER_NAMESPACE, plan_bytes),
                ObservationComponentV2::Artifact => (COMPOSER_OWNER_NAMESPACE, artifact_bytes),
                ObservationComponentV2::ResolvedOwnerInputs
                | ObservationComponentV2::PitScope
                | ObservationComponentV2::PitSnapshot
                | ObservationComponentV2::UniverseSelection
                | ObservationComponentV2::CorrectionRule
                | ObservationComponentV2::MarketSemantics
                | ObservationComponentV2::ReplayConfiguration
                | ObservationComponentV2::RuntimeKernel
                | ObservationComponentV2::Simulator
                | ObservationComponentV2::CostModel
                | ObservationComponentV2::SlippageModel
                | ObservationComponentV2::CapacityModel
                | ObservationComponentV2::RunnerOperationalProfile
                | ObservationComponentV2::DiagnosticPolicy
                | ObservationComponentV2::DeterministicSeed
                | ObservationComponentV2::ReplayWindow
                | ObservationComponentV2::Calendar
                | ObservationComponentV2::Session
                | ObservationComponentV2::TimeZone
                | ObservationComponentV2::CorporateActionCut
                | ObservationComponentV2::HistoricalMembershipCut => {
                    (BINDING_OWNER_NAMESPACE, binding_bytes)
                }
                ObservationComponentV2::SemanticTrace => (RD_OWNER_NAMESPACE, request_bytes),
            };
            let producer_reference = observation_reference(ordinal, &identity, &digest, bytes)?;
            Ok(NativeReplayOwnerObservationV2::from_owner_resolution(
                component,
                OpaqueIdentityV2::try_from(namespace.to_owned()).map_err(unavailable)?,
                producer_reference,
                bytes.to_vec(),
                identity,
                digest,
            ))
        })
        .collect()
}

fn observation_reference(
    ordinal: usize,
    identity: &OpaqueIdentityV2,
    digest: &vibe_backtest_owner_contracts::CanonicalDigestV2,
    bytes: &[u8],
) -> Result<OpaqueIdentityV2, NativeReplayExecutionPreparationErrorV2> {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"strategy-factory.native-replay.owner-observation.v2\0");
    hasher.update(&(ordinal as u64).to_le_bytes());
    hash_field(&mut hasher, identity.as_str().as_bytes());
    hash_field(&mut hasher, digest.as_str().as_bytes());
    hash_field(&mut hasher, bytes);
    OpaqueIdentityV2::try_from(format!(
        "native-replay-owner-observation-v2-{}",
        hasher.finalize().to_hex()
    ))
    .map_err(unavailable)
}

fn derived_identity(
    domain: &str,
    locator: &ExploratoryReplayRequestLocatorV2,
    attempt_identity: &OpaqueIdentityV2,
) -> Result<String, NativeReplayExecutionPreparationErrorV2> {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(&[0]);
    for value in [
        locator.request_identity.as_bytes(),
        locator.meaning_digest.as_bytes(),
        locator.receipt_identity.as_bytes(),
        locator.seal_digest.as_bytes(),
        attempt_identity.as_str().as_bytes(),
    ] {
        hash_field(&mut hasher, value);
    }
    Ok(format!(
        "rdq-native-replay-v2-{}",
        hasher.finalize().to_hex()
    ))
}

fn opaque_derived_identity(
    domain: &str,
    locator: &ExploratoryReplayRequestLocatorV2,
    attempt_identity: &OpaqueIdentityV2,
) -> Result<OpaqueIdentityV2, NativeReplayExecutionPreparationErrorV2> {
    OpaqueIdentityV2::try_from(derived_identity(domain, locator, attempt_identity)?)
        .map_err(unavailable)
}

fn hash_field(hasher: &mut blake3::Hasher, value: &[u8]) {
    hasher.update(&(value.len() as u64).to_le_bytes());
    hasher.update(value);
}

fn unavailable<T>(_: T) -> NativeReplayExecutionPreparationErrorV2 {
    NativeReplayExecutionPreparationErrorV2
}
