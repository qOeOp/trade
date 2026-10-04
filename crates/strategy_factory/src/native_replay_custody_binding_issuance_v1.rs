//! Request-only composition for a custody-run Native Replay execution-input binding (H8).
//!
//! Mirrors [`crate::native_replay_initial_binding_issuance_v1`]'s snapshot orchestration, with the
//! snapshot-only steps (the BAR-schedule universe sample projection, the live scheduling-resolver
//! re-check, the per-request V2 Instrument Master cut) replaced by their custody equivalents: the
//! custody chain's own basis, the Design's role-binding custody reread as-is (not freshly
//! re-derived - a custody run has no live resolver to re-derive it against, the same reason it
//! has no BAR-schedule mint), and per-member V2 facts linked by canonical identity and validity
//! window.

use std::fmt::Display;

use sqlx::{Postgres, Transaction};
use vibe_data::owner::{
    instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresOwnerV1,
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    pit_window_custody_v1::{
        PitWindowCustodyFramesV1, UntrustedPitWindowCustodyClaimV1, UntrustedPitWindowRunV1,
    },
    read_universe_selection_members_for_rd_v1,
    source_binding::BindingDigest,
};

use crate::{
    artifact_v2::StrategyArtifactV2,
    design_input_custody_v1::reread_design_input_custody_v1,
    develop_composer_postgres_v2::DevelopComposerSealedReadPortV2,
    exploratory_replay::ExploratoryReplayRequestLocatorV2,
    native_replay_execution_input_binding_v1::{
        NativeReplayExecutionInputBindingCauseV1 as Cause,
        NativeReplayExecutionInputBindingErrorV1, NativeReplayExecutionInputBindingReadbackV1,
        ReplayCustodyRunBindingV1, issue_native_replay_execution_input_binding_from_custody_run_v1,
        verify_custody_run_universe_matches_role_binding_v1,
    },
    native_replay_preparation_inputs_v2::resolve_native_replay_preparation_inputs_v2_in_transaction,
    replay_execution_profile_binding_v1::issue_owner_replay_execution_profile_binding_from_readbacks_v1,
    strategy_plan_v2::StrategyPlanV2,
};

/// Records why one composition stage refused, then returns the refusal the caller is given.
///
/// Same convention as [`crate::native_replay_initial_binding_issuance_v1`]'s own `unavailable`:
/// every stage before the final issue answers `Unavailable` with the cause that names it, and
/// first records the Owner's own detail under a coordinate naming the stage - grep
/// `native_replay_custody_binding.` to find it.
fn unavailable(
    coordinate: &'static str,
    cause: Cause,
    detail: &impl Display,
) -> NativeReplayExecutionInputBindingErrorV1 {
    crate::storage_diagnostic::refused_by_store(coordinate, detail);
    NativeReplayExecutionInputBindingErrorV1::Unavailable(cause)
}

const fn economic_terms_cause(
    error: &vibe_data::owner::instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresErrorV1,
) -> Cause {
    use vibe_data::owner::instrument_economic_terms_postgres_v1::InstrumentEconomicTermsPostgresErrorV1 as E;
    match error {
        E::UnknownSelection => Cause::EconomicTermsAbsent,
        E::AmbiguousSelection => Cause::EconomicTermsAmbiguous,
        E::ConfigurationUnavailable
        | E::StoreUnavailable
        | E::AclUnavailable
        | E::UnknownLocator
        | E::InvalidSelection
        | E::MeaningConflict
        | E::CorruptReadback => Cause::EconomicTermsUnresolved,
    }
}

/// Issues a custody-run execution-input binding (H8) for an already-committed custody Replay
/// request.
///
/// `run` is the custody-run binding to issue and persist: the caller supplies `chain_root`/
/// `head_identity`/the run window exactly as the committed Replay request's own `CustodyRun`
/// locator names them (`ComposerReplayMarketDataLocatorV3::CustodyRun`); this function re-resolves
/// the chain's current frames at the pinned head and refuses by name if they disagree.
///
/// # Errors
///
/// See [`crate::NativeReplayExecutionInputBindingCauseV1`]; each variant names the one stage that
/// did not complete.
pub(crate) async fn issue_native_replay_custody_binding_v1_in_transaction<P>(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &ExploratoryReplayRequestLocatorV2,
    composer: &P,
    instrument_terms_owner: &InstrumentEconomicTermsPostgresOwnerV1,
    instrument_master_owner: &InstrumentMasterV2PostgresOwner,
    custody_frames: &dyn PitWindowCustodyFramesV1,
    run: ReplayCustodyRunBindingV1,
) -> Result<NativeReplayExecutionInputBindingReadbackV1, NativeReplayExecutionInputBindingErrorV1>
where
    P: DevelopComposerSealedReadPortV2 + ?Sized,
{
    let preparation =
        resolve_native_replay_preparation_inputs_v2_in_transaction(transaction, locator, composer)
            .await
            .map_err(|e| {
                unavailable(
                    "native_replay_custody_binding.preparation.resolve",
                    Cause::PreparationUnresolved,
                    &e,
                )
            })?;

    let frames = custody_frames
        .resolve_pit_window_frames_v1(UntrustedPitWindowRunV1 {
            custody: UntrustedPitWindowCustodyClaimV1 {
                chain_root: BindingDigest::from_untrusted_bytes(run.chain_root),
            },
            run_start_ns: run.run_start_ns,
            run_end_ns_exclusive: run.run_end_ns_exclusive,
            // Read at the head the binding pins, so a backfill that moved the chain since never
            // refuses a retry of this issuance.
            head_identity: Some(BindingDigest::from_untrusted_bytes(run.head_identity)),
        })
        .await
        .map_err(|e| {
            unavailable(
                "native_replay_custody_binding.frames.resolve",
                Cause::CustodyRunFramesUnresolved,
                &e,
            )
        })?;

    if frames.chain_root().as_bytes() != &run.chain_root
        || frames.head_identity().as_bytes() != &run.head_identity
    {
        return Err(unavailable(
            "native_replay_custody_binding.frames.identity",
            Cause::CustodyRunFramesNameAnotherChainOrHead,
            &"custody run resolved a different chain or head than the binding names",
        ));
    }
    let basis = frames.basis();

    let bindings = reread_design_input_custody_v1(
        transaction,
        "native_replay_custody_binding.design_role_binding",
        preparation.composer().research_request_identity(),
        preparation.composer().design_identity(),
        None,
    )
    .await
    .map_err(|_| {
        unavailable(
            "native_replay_custody_binding.design_role_binding.reread",
            Cause::DesignRoleBindingUnresolved,
            &"the Design's role-binding custody could not be reread",
        )
    })?;
    verify_custody_run_universe_matches_role_binding_v1(&bindings, basis)?;

    let plan =
        StrategyPlanV2::parse_and_revalidate_durable(preparation.composer().plan_bytes(), bindings)
            .map_err(|e| {
                unavailable(
                    "native_replay_custody_binding.plan.revalidate",
                    Cause::PlanRevalidationRefused,
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
        unavailable(
            "native_replay_custody_binding.artifact.revalidate",
            Cause::ArtifactRevalidationRefused,
            &e,
        )
    })?;

    let (identity, digest) = basis.universe_selection_record();
    let custody_members = read_universe_selection_members_for_rd_v1(transaction, identity, digest)
        .await
        .map_err(|e| {
            unavailable(
                "native_replay_custody_binding.custody_members.resolve",
                Cause::CustodyMembersUnresolved,
                &e,
            )
        })?;

    let catalog = preparation
        .family()
        .root()
        .policy()
        .replay_policy_catalog_v3()
        .ok_or_else(|| {
            unavailable(
                "native_replay_custody_binding.replay_policy_catalog.select",
                Cause::ReplayPolicyCatalogAbsent,
                &"sealed Replay policy carries no Replay Policy Catalog V3",
            )
        })?;
    let (economic, _) = catalog.verify().map_err(|e| {
        unavailable(
            "native_replay_custody_binding.replay_policy_catalog.verify",
            Cause::ReplayPolicyCatalogInvalid,
            &e,
        )
    })?;
    let terms = instrument_terms_owner
        .resolve_unique_custody_run_members(
            basis,
            &economic.input().venue_identity,
            &economic.input().common_quote_currency,
            i128::from(run.run_start_ns),
        )
        .await
        .map_err(|e| {
            unavailable(
                "native_replay_custody_binding.economic_terms.resolve",
                economic_terms_cause(&e),
                &e,
            )
        })?;
    let term_readbacks = terms.iter().collect::<Vec<_>>();

    let profile = issue_owner_replay_execution_profile_binding_from_readbacks_v1(
        preparation.family(),
        preparation.replay(),
        &term_readbacks,
    )
    .map_err(|e| {
        unavailable(
            "native_replay_custody_binding.profile_authority.issue",
            Cause::ExecutionProfileNotIssued,
            &e,
        )
    })?;

    let mut resolved_public_terms = Vec::with_capacity(terms.len());
    for term in &terms {
        let digest =
            BindingDigest::from_untrusted_bytes(term.fact().input().instrument_public_fact_digest);
        let fact = instrument_master_owner
            .resolve_fact_v2(digest)
            .await
            .map_err(|e| {
                unavailable(
                    "native_replay_custody_binding.public_terms.resolve",
                    Cause::CustodyPublicTermFactUnresolved,
                    &e,
                )
            })?;
        resolved_public_terms.push(fact);
    }
    let public_term_refs = resolved_public_terms.iter().collect::<Vec<_>>();

    issue_native_replay_execution_input_binding_from_custody_run_v1(
        transaction,
        &preparation,
        &profile,
        &plan,
        &artifact,
        basis,
        &custody_members,
        &term_readbacks,
        &public_term_refs,
        run,
    )
    .await
}
