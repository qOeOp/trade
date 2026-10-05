//! Request-only composition for the first durable Native Replay execution-input binding.

use std::fmt::Display;

use sqlx::{Postgres, Transaction};
use vibe_data::owner::{
    UniverseSampleProjectionIssuanceErrorV1, UniverseSampleProjectionOwnerV1,
    UniverseSampleProjectionScopeV1,
    instrument_economic_terms_postgres_v1::{
        InstrumentEconomicTermsPostgresErrorV1, InstrumentEconomicTermsPostgresOwnerV1,
    },
    instrument_master_v2::{
        InstrumentMasterCustodyErrorV2, InstrumentMasterResolverV2,
        native_replay_request_identity_v2,
    },
    instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
    native_replay_scheduling_v1::{
        NativeReplaySchedulingErrorV1, NativeReplaySchedulingResolverV1,
    },
};

use crate::{
    artifact_v2::StrategyArtifactV2,
    develop_composer_postgres_v2::DevelopComposerSealedReadPortV2,
    exploratory_replay::ExploratoryReplayRequestLocatorV2,
    native_replay_execution_input_binding_v1::{
        NativeReplayExecutionInputBindingCauseV1 as Cause,
        NativeReplayExecutionInputBindingErrorV1, NativeReplayExecutionInputBindingReadbackV1,
        issue_native_replay_execution_input_binding_from_owner_readbacks_v1,
    },
    native_replay_initial_owner_inputs_v1::{
        NativeReplayInitialOwnerInputsErrorV1, resolve_native_replay_initial_owner_inputs_v1,
    },
    native_replay_preparation_inputs_v2::resolve_native_replay_preparation_inputs_v2_in_transaction,
    replay_execution_profile_binding_v1::issue_owner_replay_execution_profile_binding_from_readbacks_v1,
    strategy_plan_v2::StrategyPlanV2,
};

/// Records why one composition stage refused, then returns the refusal the caller is given.
///
/// Every stage before the final issue answers `Unavailable` with the cause that names it, and
/// first records the Owner's own detail under a coordinate naming the stage: grep
/// `native_replay_initial_binding.` to find it. The cause tells the caller which check refused;
/// the detail stays in the log, because it can carry Owner custody the caller is not owed. Three
/// earlier answers are separate variants instead: a request with no composition binding is `NoCompositionBinding`, an Instrument
/// Master cut already issued for the request under another binding is `Conflict`, and a cut whose
/// V2 facts disagree with the V1 facts the binding's PIT snapshot cites is
/// `InstrumentMasterGenerationMismatch`, and a cut with a member whose terms a later snapshot changed
/// is `InstrumentMasterTermsChanged`; the last three are recorded under their coordinate the same
/// way. The final issue's own error is not collapsed and not recorded
/// here: it already names `Conflict` and `Storage`, and a cause the caller can be told should be
/// told rather than logged.
fn unavailable(
    coordinate: &'static str,
    cause: Cause,
    detail: &impl Display,
) -> NativeReplayExecutionInputBindingErrorV1 {
    crate::storage_diagnostic::refused_by_store(coordinate, detail);
    NativeReplayExecutionInputBindingErrorV1::Unavailable(cause)
}

/// Names a refusal of the initial frame's universe sample projection. No wildcard: a new Market
/// Data refusal has to be named here before this compiles.
const fn sample_projection_cause(error: &UniverseSampleProjectionIssuanceErrorV1) -> Cause {
    match error {
        UniverseSampleProjectionIssuanceErrorV1::ScheduleAbsent => Cause::BarScheduleAbsent,
        UniverseSampleProjectionIssuanceErrorV1::ScheduleUnavailable => {
            Cause::BarScheduleUnavailable
        }
        UniverseSampleProjectionIssuanceErrorV1::SourceBindingDeclaresNoBarTimeframe => {
            Cause::SourceBindingDeclaresNoBarTimeframe
        }
        UniverseSampleProjectionIssuanceErrorV1::DeclaredBarTimeframeMismatch => {
            Cause::DeclaredBarTimeframeMismatch
        }
        UniverseSampleProjectionIssuanceErrorV1::InvalidRequestIdentity
        | UniverseSampleProjectionIssuanceErrorV1::BindingUnavailable
        | UniverseSampleProjectionIssuanceErrorV1::CompositionShapeMismatch
        | UniverseSampleProjectionIssuanceErrorV1::FrameMismatch
        | UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable
        | UniverseSampleProjectionIssuanceErrorV1::BindingConflict
        | UniverseSampleProjectionIssuanceErrorV1::SubjectConflict
        | UniverseSampleProjectionIssuanceErrorV1::SampleConflict => {
            Cause::SampleProjectionNotIssued
        }
    }
}

/// Names a refusal of the members' economic terms. `UnknownSelection` is the one that says no
/// terms apply; the rest are failures to read or verify custody.
const fn economic_terms_cause(error: &InstrumentEconomicTermsPostgresErrorV1) -> Cause {
    match error {
        InstrumentEconomicTermsPostgresErrorV1::UnknownSelection => Cause::EconomicTermsAbsent,
        InstrumentEconomicTermsPostgresErrorV1::AmbiguousSelection => Cause::EconomicTermsAmbiguous,
        InstrumentEconomicTermsPostgresErrorV1::ConfigurationUnavailable
        | InstrumentEconomicTermsPostgresErrorV1::StoreUnavailable
        | InstrumentEconomicTermsPostgresErrorV1::AclUnavailable
        | InstrumentEconomicTermsPostgresErrorV1::UnknownLocator
        | InstrumentEconomicTermsPostgresErrorV1::InvalidSelection
        | InstrumentEconomicTermsPostgresErrorV1::MeaningConflict
        | InstrumentEconomicTermsPostgresErrorV1::CorruptReadback => Cause::EconomicTermsUnresolved,
    }
}

/// Names a refusal of the initial frame's market inputs, including Market Data's own. No
/// wildcard on either enum.
const fn market_inputs_cause(error: &NativeReplayInitialOwnerInputsErrorV1) -> Cause {
    match error {
        NativeReplayInitialOwnerInputsErrorV1::PlanHasNoUniverseSelection => {
            Cause::PlanHasNoUniverseSelection
        }
        NativeReplayInitialOwnerInputsErrorV1::ReplayCoordinateMalformed(_) => {
            Cause::DigestNotCanonical
        }
        NativeReplayInitialOwnerInputsErrorV1::MemberCountNotAdmitted(_) => {
            Cause::MemberCountNotAdmitted
        }
        NativeReplayInitialOwnerInputsErrorV1::MembersDisagreeWithInstrumentMaster => {
            Cause::InstrumentMasterCutMemberDiffers
        }
        NativeReplayInitialOwnerInputsErrorV1::RoleNotUniverseMarketData(_)
        | NativeReplayInitialOwnerInputsErrorV1::RoleCoordinateUnknown { .. } => {
            Cause::PlanRolesUnsupported
        }
        NativeReplayInitialOwnerInputsErrorV1::MemberInstrumentMalformed(_) => {
            Cause::MarketInputsUnresolved
        }
        NativeReplayInitialOwnerInputsErrorV1::MarketData(market_data) => match market_data {
            NativeReplaySchedulingErrorV1::NoBarScheduleAtFrame => Cause::BarScheduleAbsent,
            NativeReplaySchedulingErrorV1::SourceBindingDeclaresNoBarTimeframe => {
                Cause::SourceBindingDeclaresNoBarTimeframe
            }
            NativeReplaySchedulingErrorV1::DeclaredBarTimeframeMismatch => {
                Cause::DeclaredBarTimeframeMismatch
            }
            NativeReplaySchedulingErrorV1::ExecutionRoleAbsent => Cause::ExecutionRoleAbsent,
            NativeReplaySchedulingErrorV1::ExecutionRoleAmbiguous => Cause::ExecutionRoleAmbiguous,
            NativeReplaySchedulingErrorV1::MoreThanOneRoleTimeframe => {
                Cause::MoreThanOneRoleTimeframe
            }
            NativeReplaySchedulingErrorV1::ExecutionTimeframeNotDeclared => {
                Cause::ExecutionTimeframeNotDeclared
            }
            NativeReplaySchedulingErrorV1::CalendarMonthNotAnExecutionTimeframe => {
                Cause::CalendarMonthNotAnExecutionTimeframe
            }
            NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable { .. }
            | NativeReplaySchedulingErrorV1::OwnerBindingMismatch
            | NativeReplaySchedulingErrorV1::FieldCensusMismatch
            | NativeReplaySchedulingErrorV1::EventOrderUnavailable
            | NativeReplaySchedulingErrorV1::ExactInstrumentRolesUnderOwnerUniverse
            | NativeReplaySchedulingErrorV1::NativeRepresentation
            | NativeReplaySchedulingErrorV1::UniverseSelectionRecordMismatch
            | NativeReplaySchedulingErrorV1::PitWindowHeadNotInChain
            | NativeReplaySchedulingErrorV1::PitWindowFrameNotCovered
            | NativeReplaySchedulingErrorV1::FrameSourceMismatch => Cause::MarketInputsUnresolved,
        },
    }
}

pub(crate) async fn issue_native_replay_initial_binding_v1_in_transaction<P, R>(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &ExploratoryReplayRequestLocatorV2,
    composer: &P,
    instrument_master_owner: &InstrumentMasterV2PostgresOwner,
    instrument_terms_owner: &InstrumentEconomicTermsPostgresOwnerV1,
    sample_projection_owner: &UniverseSampleProjectionOwnerV1,
    market_data: &R,
) -> Result<NativeReplayExecutionInputBindingReadbackV1, NativeReplayExecutionInputBindingErrorV1>
where
    P: DevelopComposerSealedReadPortV2 + ?Sized,
    R: NativeReplaySchedulingResolverV1 + ?Sized,
{
    let preparation =
        resolve_native_replay_preparation_inputs_v2_in_transaction(transaction, locator, composer)
            .await
            .map_err(|e| {
                unavailable(
                    "native_replay_initial_binding.preparation.resolve",
                    Cause::PreparationUnresolved,
                    &e,
                )
            })?;
    let projected_plan =
        StrategyPlanV2::decode_owner_resolution_projection(preparation.composer().plan_bytes())
            .map_err(|e| {
                unavailable(
                    "native_replay_initial_binding.plan.decode_projection",
                    Cause::PlanProjectionUndecodable,
                    &e,
                )
            })?;
    let request = preparation.replay().request().as_dto();
    let master_request_identity =
        native_replay_request_identity_v2(request.request_identity.as_str()).map_err(|e| {
            unavailable(
                "native_replay_initial_binding.instrument_master.request_identity",
                Cause::RequestIdentityInvalid,
                &e,
            )
        })?;
    let composition_binding =
        crate::exploratory_replay::postgres::read_composer_v3_market_data_binding_in_transaction(
            transaction,
            request.request_identity.as_str(),
        )
        .await
        .map_err(|e| {
            unavailable(
                "native_replay_initial_binding.composition_binding.read",
                Cause::CompositionBindingUnreadable,
                &e,
            )
        })?
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
                // The recorded cause names which generation rule failed.
                InstrumentMasterCustodyErrorV2::GenerationMismatch(_) => {
                    crate::storage_diagnostic::refused_by_store(coordinate, &e);
                    NativeReplayExecutionInputBindingErrorV1::InstrumentMasterGenerationMismatch
                }
                InstrumentMasterCustodyErrorV2::TermsChanged => {
                    crate::storage_diagnostic::refused_by_store(coordinate, &e);
                    NativeReplayExecutionInputBindingErrorV1::InstrumentMasterTermsChanged
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
                | InstrumentMasterCustodyErrorV2::BoundReplayBindingUnavailable
                | InstrumentMasterCustodyErrorV2::MemberClassCarriesCorporateActions => {
                    unavailable(coordinate, Cause::InstrumentMasterCutNotIssued, &e)
                }
            }
        })?;
    // Market Data issues the initial frame's universe sample projection the same way, in its own
    // transaction, before this one resolves the frame: it never calls R&D and takes no lock this
    // transaction can hold. A later failure here leaves the projection, and the retry reuses it.
    let sample_projections = sample_projection_owner
        .issue_v1(
            request.request_identity.as_str(),
            composition_binding,
            UniverseSampleProjectionScopeV1::InitialFrame,
        )
        .await
        .map_err(|e| {
            let coordinate = "native_replay_initial_binding.sample_projection.issue";

            match e {
                UniverseSampleProjectionIssuanceErrorV1::BindingConflict
                | UniverseSampleProjectionIssuanceErrorV1::SubjectConflict
                | UniverseSampleProjectionIssuanceErrorV1::SampleConflict => {
                    crate::storage_diagnostic::refused_by_store(coordinate, &e);
                    NativeReplayExecutionInputBindingErrorV1::Conflict
                }
                UniverseSampleProjectionIssuanceErrorV1::InvalidRequestIdentity
                | UniverseSampleProjectionIssuanceErrorV1::BindingUnavailable
                | UniverseSampleProjectionIssuanceErrorV1::CompositionShapeMismatch
                | UniverseSampleProjectionIssuanceErrorV1::FrameMismatch
                | UniverseSampleProjectionIssuanceErrorV1::ScheduleUnavailable
                | UniverseSampleProjectionIssuanceErrorV1::SourceBindingDeclaresNoBarTimeframe
                | UniverseSampleProjectionIssuanceErrorV1::DeclaredBarTimeframeMismatch
                | UniverseSampleProjectionIssuanceErrorV1::ScheduleAbsent
                | UniverseSampleProjectionIssuanceErrorV1::StoreUnavailable => {
                    unavailable(coordinate, sample_projection_cause(&e), &e)
                }
            }
        })?;
    let instrument_master = instrument_master_owner
        .resolve_instrument_master_v2_for_native_replay_request(request.request_identity.as_str())
        .await
        .map_err(|e| {
            unavailable(
                "native_replay_initial_binding.instrument_master.resolve",
                Cause::InstrumentMasterUnresolved,
                &e,
            )
        })?;

    if instrument_master.cut().request_identity() != master_request_identity {
        return Err(unavailable(
            "native_replay_initial_binding.instrument_master.cut",
            Cause::InstrumentMasterCutForeign,
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
                Cause::ReplayPolicyCatalogAbsent,
                &"sealed Replay policy carries no Replay Policy Catalog V3",
            )
        })?;
    let (economic, _) = catalog.verify().map_err(|e| {
        unavailable(
            "native_replay_initial_binding.replay_policy_catalog.verify",
            Cause::ReplayPolicyCatalogInvalid,
            &e,
        )
    })?;
    let terms = instrument_terms_owner
        .resolve_unique_native_replay_members(
            &instrument_master,
            &economic.input().venue_identity,
            &economic.input().common_quote_currency,
            i128::from(request.window.start_event_ns),
        )
        .await
        .map_err(|e| {
            unavailable(
                "native_replay_initial_binding.economic_terms.resolve",
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
            "native_replay_initial_binding.profile_authority.issue",
            Cause::ExecutionProfileNotIssued,
            &e,
        )
    })?;
    let (_market_request, market) = resolve_native_replay_initial_owner_inputs_v1(
        &preparation,
        &projected_plan,
        &instrument_master,
        market_data,
    )
    .await
    .map_err(|e| {
        unavailable(
            "native_replay_initial_binding.market_inputs.resolve",
            market_inputs_cause(&e),
            &e,
        )
    })?;
    let (universe_frame, schedules) = market.into_binding_parts();

    // An early refusal only: the host attaches a projection only when it names the frame it
    // admits, and that check is the guarantee. Refusing here keeps a binding from being issued
    // over a frame no projection names.
    if !matches!(&sample_projections[..], [projection] if projection.subject() == universe_frame.digest())
    {
        return Err(unavailable(
            "native_replay_initial_binding.sample_projection.subject",
            Cause::SampleProjectionNamesAnotherFrame,
            &"the initial frame's sample projection names another universe frame",
        ));
    }
    let plan = StrategyPlanV2::parse_and_revalidate_durable_with_owner_universe(
        preparation.composer().plan_bytes(),
        &universe_frame,
        projected_plan.research_request_identity(),
        projected_plan.design_identity(),
    )
    .map_err(|e| {
        unavailable(
            "native_replay_initial_binding.plan.revalidate_with_universe",
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
            "native_replay_initial_binding.artifact.revalidate",
            Cause::ArtifactRevalidationRefused,
            &e,
        )
    })?;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A missing BAR schedule is named the same whichever stage meets it first: the sample
    /// projection, which issuance runs first, or the market inputs.
    #[rstest::rstest]
    fn a_missing_bar_schedule_is_named_at_either_stage() {
        assert_eq!(
            sample_projection_cause(&UniverseSampleProjectionIssuanceErrorV1::ScheduleAbsent),
            Cause::BarScheduleAbsent
        );
        assert_eq!(
            market_inputs_cause(&NativeReplayInitialOwnerInputsErrorV1::MarketData(
                NativeReplaySchedulingErrorV1::NoBarScheduleAtFrame
            )),
            Cause::BarScheduleAbsent
        );
        // A schedule that cannot be chosen, or a read that failed, is not a missing one.
        assert_eq!(
            sample_projection_cause(&UniverseSampleProjectionIssuanceErrorV1::ScheduleUnavailable),
            Cause::BarScheduleUnavailable
        );
        assert_eq!(
            market_inputs_cause(&NativeReplayInitialOwnerInputsErrorV1::MarketData(
                NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable {
                    read: vibe_data::owner::native_replay_scheduling_v1::OwnerReadV1::SnapshotBatch,
                    cause: vibe_data::owner::native_replay_scheduling_v1::OwnerReadCauseV1::StoreRefused,
                }
            )),
            Cause::MarketInputsUnresolved
        );
    }

    #[rstest::rstest]
    fn economic_terms_that_do_not_apply_are_told_apart_from_a_failed_read() {
        assert_eq!(
            economic_terms_cause(&InstrumentEconomicTermsPostgresErrorV1::UnknownSelection),
            Cause::EconomicTermsAbsent
        );
        assert_eq!(
            economic_terms_cause(&InstrumentEconomicTermsPostgresErrorV1::AmbiguousSelection),
            Cause::EconomicTermsAmbiguous
        );
        assert_eq!(
            economic_terms_cause(&InstrumentEconomicTermsPostgresErrorV1::StoreUnavailable),
            Cause::EconomicTermsUnresolved
        );
    }
}
