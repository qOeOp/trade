//! Consumer-side reconstruction of a Native Replay bundle from one durable R&D binding.

use std::fmt::Display;

use sqlx::{Postgres, Transaction};
use thiserror::Error;
use vibe_data::owner::{
    UniverseSampleProjectionOwnerV1,
    instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresOwnerV1,
    instrument_economic_terms_v1::InstrumentEconomicTermsReadbackV1,
    instrument_master_v2::InstrumentMasterResolverV2,
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    native_replay_scheduling_v1::NativeReplaySchedulingResolverV1,
    pit_window_custody_v1::PitWindowCustodyFramesV1, read_universe_selection_members_for_rd_v1,
    source_binding::BindingDigest,
};
use vibe_model::identifiers::StrategyId;

use crate::{
    artifact_v2::StrategyArtifactV2,
    develop_composer_postgres_v2::DevelopComposerSealedReadPortV2,
    exploratory_replay::ExploratoryReplayRequestLocatorV2,
    native_replay_custody_frames_v1::resolve_bound_custody_run_frames_v1,
    native_replay_execution_input_binding_v1::{
        NativeReplayExecutionInputBindingReadbackV1, ReplayCustodyRunBindingV1,
        resolve_native_replay_execution_input_binding_for_request_v1_in_transaction,
        verify_re_resolved_native_replay_custody_execution_inputs_v1,
        verify_re_resolved_native_replay_execution_inputs_v1,
    },
    native_replay_initial_owner_inputs_v1::resolve_native_replay_initial_owner_inputs_v1,
    native_replay_preparation_inputs_v2::{
        NativeReplayPreparationInputsV2, resolve_native_replay_preparation_inputs_v2_in_transaction,
    },
    program_host_v2::{OwnerUniverseFrameV1, plan_reads_universe_member_coordinates_v1},
    replay_execution_profile_binding_v1::{
        OwnerIssuedReplayExecutionProfileBindingV1,
        issue_owner_replay_execution_profile_binding_from_readbacks_v1,
    },
    replay_target_set_execution_bundle_v1::ReplayTargetSetExecutionBundleV1,
    strategy_plan_v2::StrategyPlanV2,
};

pub(crate) struct ResolvedNativeReplayExecutionBundleV1 {
    pub(crate) request: crate::exploratory_replay::SealedExploratoryReplayReadbackV2,
    pub(crate) rd_sources: crate::native_replay_rd_sources_v2::NativeReplayRdSourcesV2,
    pub(crate) design_bytes: Vec<u8>,
    pub(crate) plan_bytes: Vec<u8>,
    pub(crate) artifact_bytes: Vec<u8>,
    pub(crate) binding_bytes: Vec<u8>,
    pub(crate) execution: ReplayTargetSetExecutionBundleV1,
}

impl ResolvedNativeReplayExecutionBundleV1 {
    pub(crate) fn into_execution(self) -> ReplayTargetSetExecutionBundleV1 {
        self.execution
    }
}

/// The single refusal this consumer returns, for any of eighteen distinct failures.
///
/// It stays a unit struct on purpose: a caller learns that the bundle is unavailable and nothing
/// else, and that is the contract. What changes is that the Owner can now say why. Every site that
/// produces it first records its cause through [`crate::storage_diagnostic::refused_by_store`]
/// under a coordinate naming the exact stage, so a reader holding this refusal can grep
/// `native_replay_execution_binding.` and find which of the eighteen it was.
///
/// One refusal in this function is deliberately not recorded: a stored V1 binding that is simply
/// absent is a lookup that found no row, not a refusal, and it has no cause to report.
#[derive(Debug, Error)]
#[error("Native Replay execution bundle is unavailable")]
pub(crate) struct NativeReplayExecutionBindingConsumerErrorV1;

#[allow(clippy::too_many_arguments)]
pub(crate) async fn resolve_native_replay_execution_bundle_v1_in_transaction<P, R>(
    mut transaction: Transaction<'_, Postgres>,
    locator: &ExploratoryReplayRequestLocatorV2,
    composer: &P,
    instrument_master_owner: &InstrumentMasterV2PostgresOwner,
    instrument_terms_owner: &InstrumentEconomicTermsPostgresOwnerV1,
    market_data: &R,
    sample_projections: &UniverseSampleProjectionOwnerV1,
    custody_frames: Option<&dyn PitWindowCustodyFramesV1>,
    strategy_id: StrategyId,
    run_id: String,
) -> Result<ResolvedNativeReplayExecutionBundleV1, NativeReplayExecutionBindingConsumerErrorV1>
where
    P: DevelopComposerSealedReadPortV2 + ?Sized,
    R: NativeReplaySchedulingResolverV1 + ?Sized,
{
    // READ COMMITTED, as issuance: the native source boundary answers nothing under REPEATABLE
    // READ, and the Product Edge historical admission read refuses any other level by name
    // (`ProductEdgePostgresOwnerV1::begin_native_replay_issuance_transaction_v1`).
    sqlx::query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        .execute(&mut *transaction)
        .await
        .map_err(|e| {
            crate::storage_diagnostic::refused_by_store(
                "native_replay_execution_binding.transaction.set_isolation",
                &e,
            );
            NativeReplayExecutionBindingConsumerErrorV1
        })?;
    let stored = resolve_native_replay_execution_input_binding_for_request_v1_in_transaction(
        &mut transaction,
        locator,
    )
    .await
    .map_err(|e| {
        crate::storage_diagnostic::refused_by_store(
            "native_replay_execution_binding.v1_binding.resolve",
            &e,
        );
        NativeReplayExecutionBindingConsumerErrorV1
    })?
    .ok_or(NativeReplayExecutionBindingConsumerErrorV1)?;
    let binding_bytes = stored.binding().canonical_bytes().to_vec();
    let preparation = resolve_native_replay_preparation_inputs_v2_in_transaction(
        &mut transaction,
        locator,
        composer,
    )
    .await
    .map_err(|e| {
        crate::storage_diagnostic::refused_by_store(
            "native_replay_execution_binding.preparation.resolve",
            &e,
        );
        NativeReplayExecutionBindingConsumerErrorV1
    })?;
    let projected_plan =
        StrategyPlanV2::decode_owner_resolution_projection(preparation.composer().plan_bytes())
            .map_err(|e| {
                crate::storage_diagnostic::refused_by_store(
                    "native_replay_execution_binding.plan.decode_projection",
                    &e,
                );
                NativeReplayExecutionBindingConsumerErrorV1
            })?;
    let economic_locators = stored.instrument_economic_terms_locators().map_err(|e| {
        crate::storage_diagnostic::refused_by_store(
            "native_replay_execution_binding.economic_terms.locators",
            &e,
        );
        NativeReplayExecutionBindingConsumerErrorV1
    })?;
    let mut terms = Vec::with_capacity(economic_locators.len());
    for (ordinal, locator) in economic_locators.iter().enumerate() {
        terms.push(
            instrument_terms_owner
                .resolve(*locator)
                .await
                .map_err(|e| {
                    crate::storage_diagnostic::refused_by_store(
                        "native_replay_execution_binding.economic_terms.resolve",
                        &format!("member {ordinal}: {e}"),
                    );
                    NativeReplayExecutionBindingConsumerErrorV1
                })?,
        );
    }
    let term_readbacks = terms.iter().collect::<Vec<_>>();
    let profile = issue_owner_replay_execution_profile_binding_from_readbacks_v1(
        preparation.family(),
        preparation.replay(),
        &term_readbacks,
    )
    .map_err(|e| {
        crate::storage_diagnostic::refused_by_store(
            "native_replay_execution_binding.profile_authority.issue",
            &e,
        );
        NativeReplayExecutionBindingConsumerErrorV1
    })?;
    // A binding that names a custody run reads every frame of that run at its pinned head; the
    // snapshot path below never runs for it.
    if let Some(custody) = stored.binding().custody_run() {
        let execution = resolve_custody_execution_v1(
            transaction,
            &stored,
            &preparation,
            &projected_plan,
            instrument_master_owner,
            &term_readbacks,
            profile,
            market_data,
            custody_frames,
            &custody,
            strategy_id,
            run_id,
        )
        .await?;
        let design_bytes = preparation.composer().design_bytes().to_vec();
        let plan_bytes = preparation.composer().plan_bytes().to_vec();
        let artifact_bytes = preparation.composer().artifact_package_bytes().to_vec();
        let (request, rd_sources, _) = preparation.into_owner_evidence_parts();
        return Ok(ResolvedNativeReplayExecutionBundleV1 {
            request,
            rd_sources,
            design_bytes,
            plan_bytes,
            artifact_bytes,
            binding_bytes,
            execution,
        });
    }
    let request = preparation.replay().request().as_dto();
    let instrument_master = instrument_master_owner
        .resolve_instrument_master_v2_for_native_replay_request(request.request_identity.as_str())
        .await
        .map_err(|e| {
            crate::storage_diagnostic::refused_by_store(
                "native_replay_execution_binding.instrument_master.resolve",
                &e,
            );
            NativeReplayExecutionBindingConsumerErrorV1
        })?;
    // `market_request` is retained unused for now: it is the input that produced this readback, and
    // the window's whole frame sequence is resolved from it once Market Data supplies the
    // coordinates. Rebuilding it at that point would be the same second-resolution fault the
    // sequence resolver exists to prevent.
    let (_market_request, market) = resolve_native_replay_initial_owner_inputs_v1(
        &preparation,
        &projected_plan,
        &instrument_master,
        market_data,
    )
    .await
    .map_err(|e| {
        crate::storage_diagnostic::refused_by_store(
            "native_replay_execution_binding.market_inputs.resolve",
            &e,
        );
        NativeReplayExecutionBindingConsumerErrorV1
    })?;
    let plan = StrategyPlanV2::parse_and_revalidate_durable_with_owner_universe(
        preparation.composer().plan_bytes(),
        market.universe_frame(),
        projected_plan.research_request_identity(),
        projected_plan.design_identity(),
    )
    .map_err(|e| {
        crate::storage_diagnostic::refused_by_store(
            "native_replay_execution_binding.plan.revalidate_with_universe",
            &e,
        );
        NativeReplayExecutionBindingConsumerErrorV1
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
    .map_err(|e| {
        crate::storage_diagnostic::refused_by_store(
            "native_replay_execution_binding.artifact.revalidate",
            &e,
        );
        NativeReplayExecutionBindingConsumerErrorV1
    })?;
    verify_re_resolved_native_replay_execution_inputs_v1(
        &stored,
        &preparation,
        &profile,
        &plan,
        &artifact,
        &instrument_master,
        &term_readbacks,
        market.universe_frame(),
        &market.schedules().iter().collect::<Vec<_>>(),
    )
    .map_err(|e| {
        crate::storage_diagnostic::refused_by_store(
            "native_replay_execution_binding.re_resolution.verify",
            &e,
        );
        NativeReplayExecutionBindingConsumerErrorV1
    })?;
    // A Plan that reads member coordinates takes them from Market Data's sample projection over this
    // very frame, which R&D issued when it bound the request. A frame never issued one is refused
    // here rather than admitted without the coordinates its Plan reads.
    let projection = if plan_reads_universe_member_coordinates_v1(&plan) {
        let projection = sample_projections
            .resolve_by_subject_v1(market.universe_frame().digest())
            .await
            .map_err(|e| {
                crate::storage_diagnostic::refused_by_store(
                    "native_replay_execution_binding.sample_projection.resolve",
                    &e,
                );
                NativeReplayExecutionBindingConsumerErrorV1
            })?
            .ok_or_else(|| {
                crate::storage_diagnostic::refused_by_store(
                    "native_replay_execution_binding.sample_projection.resolve",
                    &"no sample projection was issued for the frame",
                );
                NativeReplayExecutionBindingConsumerErrorV1
            })?;
        Some(projection)
    } else {
        None
    };
    let public_terms = instrument_master
        .cut()
        .members()
        .iter()
        .enumerate()
        .map(|(ordinal, member)| {
            member
                .fact()
                .validate_native_crypto_perpetual_public_terms()
                .map_err(|e| {
                    crate::storage_diagnostic::refused_by_store(
                        "native_replay_execution_binding.public_terms.validate",
                        &format!("member {ordinal}: {e}"),
                    );
                    NativeReplayExecutionBindingConsumerErrorV1
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let (universe_frame, scheduling) = market.into_execution_parts().map_err(|e| {
        crate::storage_diagnostic::refused_by_store(
            "native_replay_execution_binding.market_inputs.into_execution_parts",
            &e,
        );
        NativeReplayExecutionBindingConsumerErrorV1
    })?;
    let owner_frame = match &projection {
        Some(projection) => {
            OwnerUniverseFrameV1::from_owner_projection_v1(universe_frame, projection).map_err(
                |e| {
                    crate::storage_diagnostic::refused_by_store(
                        "native_replay_execution_binding.sample_projection.attach",
                        &e,
                    );
                    NativeReplayExecutionBindingConsumerErrorV1
                },
            )?
        }
        None => OwnerUniverseFrameV1::uncoordinated(universe_frame),
    };
    transaction.commit().await.map_err(|e| {
        crate::storage_diagnostic::refused_by_store(
            "native_replay_execution_binding.transaction.commit",
            &e,
        );
        NativeReplayExecutionBindingConsumerErrorV1
    })?;
    let funding_window = profile.request_window();
    let funding_members = instrument_master
        .cut()
        .members()
        .iter()
        .map(|member| member.fact().canonical_identity().to_string())
        .collect::<Vec<_>>();
    let funding_schedule = market_data
        .resolve_replay_funding_schedule_v1(
            &funding_members,
            funding_window.start_event_ns,
            funding_window.end_event_ns_exclusive,
        )
        .await
        .map_err(|e| {
            crate::storage_diagnostic::refused_by_store(
                "native_replay_execution_binding.funding.resolve",
                &e,
            );
            NativeReplayExecutionBindingConsumerErrorV1
        })?;
    let execution = ReplayTargetSetExecutionBundleV1::new_from_single_frame_v1(
        profile,
        plan,
        artifact,
        owner_frame,
        strategy_id,
        run_id,
        public_terms,
        scheduling,
        // No backfilled coverage reaches the whole window: the bundle states none, exactly as
        // before this read existed, and its census records `FUNDING_NOT_STATED`. A genuine gap
        // inside a covered window is refused above, by name, never silently zero-filled.
        funding_schedule,
    )
    .map_err(|e| {
        crate::storage_diagnostic::refused_by_store(
            "native_replay_execution_binding.execution_bundle.compose",
            &e,
        );
        NativeReplayExecutionBindingConsumerErrorV1
    })?;
    let design_bytes = preparation.composer().design_bytes().to_vec();
    let plan_bytes = preparation.composer().plan_bytes().to_vec();
    let artifact_bytes = preparation.composer().artifact_package_bytes().to_vec();
    let (request, rd_sources, _) = preparation.into_owner_evidence_parts();
    Ok(ResolvedNativeReplayExecutionBundleV1 {
        request,
        rd_sources,
        design_bytes,
        plan_bytes,
        artifact_bytes,
        binding_bytes,
        execution,
    })
}

/// Records `cause` under `coordinate` and returns the consumer's one refusal.
fn refused(
    coordinate: &'static str,
    cause: &impl Display,
) -> NativeReplayExecutionBindingConsumerErrorV1 {
    crate::storage_diagnostic::refused_by_store(coordinate, cause);
    NativeReplayExecutionBindingConsumerErrorV1
}

/// The custody branch: every frame of the bound run, read at its pinned head under the chain's
/// own Instrument Master key; each member's public terms from the V2 fact its economic terms link;
/// the Plan and Artifact revalidated against the run's first frame; the binding re-derived from the
/// Owners exactly, which also proves those terms cover the run and agree with the chain's own
/// Instrument Master; and the bundle composed from every frame by value.
#[allow(clippy::too_many_arguments)]
async fn resolve_custody_execution_v1<R>(
    mut transaction: Transaction<'_, Postgres>,
    stored: &NativeReplayExecutionInputBindingReadbackV1,
    preparation: &NativeReplayPreparationInputsV2,
    projected_plan: &StrategyPlanV2,
    instrument_master_owner: &InstrumentMasterV2PostgresOwner,
    term_readbacks: &[&InstrumentEconomicTermsReadbackV1],
    profile: OwnerIssuedReplayExecutionProfileBindingV1,
    market_data: &R,
    custody_frames: Option<&dyn PitWindowCustodyFramesV1>,
    custody: &ReplayCustodyRunBindingV1,
    strategy_id: StrategyId,
    run_id: String,
) -> Result<ReplayTargetSetExecutionBundleV1, NativeReplayExecutionBindingConsumerErrorV1>
where
    R: NativeReplaySchedulingResolverV1 + ?Sized,
{
    let custody_frames = custody_frames.ok_or_else(|| {
        refused(
            "native_replay_execution_binding.custody.frames_port",
            &"CUSTODY_FRAMES_PORT_NOT_COMPOSED: the binding names a custody run and no custody frames port was supplied",
        )
    })?;
    let frames = resolve_bound_custody_run_frames_v1(
        custody_frames,
        market_data,
        preparation,
        projected_plan,
        custody,
    )
    .await
    .map_err(|e| refused("native_replay_execution_binding.custody.frames", &e))?;
    let (record_identity, record_digest) = frames.basis().universe_selection_record();
    let custody_members =
        read_universe_selection_members_for_rd_v1(&mut transaction, record_identity, record_digest)
            .await
            .map_err(|e| refused("native_replay_execution_binding.custody.members", &e))?;
    // Each member's public terms are the V2 fact its economic terms link, read by that exact
    // digest; the re-derivation below proves they agree with the chain's own Instrument Master.
    let mut public_facts = Vec::with_capacity(term_readbacks.len());

    for (ordinal, terms) in term_readbacks.iter().enumerate() {
        let digest =
            BindingDigest::from_untrusted_bytes(terms.fact().input().instrument_public_fact_digest);
        public_facts.push(
            instrument_master_owner
                .resolve_fact_v2(digest)
                .await
                .map_err(|e| {
                    refused(
                        "native_replay_execution_binding.custody.public_fact",
                        &format!("member {ordinal}: {e}"),
                    )
                })?,
        );
    }
    let public_fact_refs = public_facts.iter().collect::<Vec<_>>();
    let plan = StrategyPlanV2::parse_and_revalidate_durable_with_owner_universe(
        preparation.composer().plan_bytes(),
        frames.first_universe_frame(),
        projected_plan.research_request_identity(),
        projected_plan.design_identity(),
    )
    .map_err(|e| {
        refused(
            "native_replay_execution_binding.custody.plan.revalidate",
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
    .map_err(|e| {
        refused(
            "native_replay_execution_binding.custody.artifact.revalidate",
            &e,
        )
    })?;
    let bound = verify_re_resolved_native_replay_custody_execution_inputs_v1(
        stored,
        preparation,
        &profile,
        &plan,
        &artifact,
        frames.basis(),
        &custody_members,
        term_readbacks,
        &public_fact_refs,
    )
    .map_err(|e| {
        refused(
            "native_replay_execution_binding.custody.re_resolution.verify",
            &e,
        )
    })?;

    if bound != *custody {
        return Err(refused(
            "native_replay_execution_binding.custody.re_resolution.verify",
            &"the re-derived binding names another custody run",
        ));
    }
    let public_terms = public_facts
        .iter()
        .enumerate()
        .map(|(ordinal, fact)| {
            fact.validate_native_crypto_perpetual_public_terms()
                .map_err(|e| {
                    refused(
                        "native_replay_execution_binding.custody.public_terms.validate",
                        &format!("member {ordinal}: {e}"),
                    )
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    transaction.commit().await.map_err(|e| {
        refused(
            "native_replay_execution_binding.custody.transaction.commit",
            &e,
        )
    })?;
    let funding_members = custody_members
        .members()
        .iter()
        .map(|member| member.instrument().to_string())
        .collect::<Vec<_>>();
    let funding_schedule = market_data
        .resolve_replay_funding_schedule_v1(
            &funding_members,
            custody.run_start_ns,
            custody.run_end_ns_exclusive,
        )
        .await
        .map_err(|e| {
            refused(
                "native_replay_execution_binding.custody.funding.resolve",
                &e,
            )
        })?;
    ReplayTargetSetExecutionBundleV1::new_from_custody_frames_v1(
        profile,
        plan,
        artifact,
        frames,
        strategy_id,
        run_id,
        public_terms,
        // No backfilled coverage reaches the whole run window: the bundle states none, exactly
        // as before this read existed. A genuine gap inside a covered window is refused above,
        // by name, never silently zero-filled.
        funding_schedule,
    )
    .map_err(|e| {
        refused(
            "native_replay_execution_binding.custody.execution_bundle.compose",
            &format!("{e:#}"),
        )
    })
}
