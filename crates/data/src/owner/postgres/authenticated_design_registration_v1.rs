//! Registration of one authenticated Design's roles, whatever authenticated it.
//!
//! Two shapes can state a Design's roles to Market Data. A Composer attestation states them once a
//! program exists, and the Design role intent R&D publishes states them before one can: a program's
//! identity folds in the binding receipts this registration issues, so the first cycle has nothing
//! artifact-bound to stand on. What the two shapes authenticate is the same claim, so what Market
//! Data does with it is the same work, and it lives here once rather than beside either consumer.
//!
//! Nothing a shape says becomes a stored fact. Every Market Data coordinate is resolved from this
//! Owner's own custody at its own decision cut, coverage is then re-checked against the declared
//! roles, and registration stays write-once.

use sqlx::{Postgres, Transaction};

use crate::owner::strategy_design_role_set::StrategyDesignRoleEntryV1;
use crate::owner::strategy_input_binding_admission_v1::{
    StrategyInputBindingAdmissionErrorV1, StrategyInputBindingAdmissionTerminalV1,
};

use super::pit_role_resolution_v1::{
    AuthenticatedDesignIdentityV1, PitRoleResolutionErrorV1, compose_binding_request_v1,
    resolve_role_snapshot_v1,
};
use super::strategy_input_binding_registry::{
    StrategyInputBindingRegistryErrorV1, load_owner_verified_pit_batch_v1,
    register_authenticated_role_declarations_v1,
};

/// Resolves, composes and registers every declared role inside the caller's open transaction.
///
/// The caller owns the transaction because the whole set must land or none of it must: a Design
/// whose roles are half registered would let a later cycle bind the rest against a different
/// decision cut. `initial_pit_request` is the PIT request the Design's role intent names; a
/// universe-member role registers against exactly it and is refused by name without it.
pub(super) async fn register_authenticated_design_roles_v1(
    transaction: &mut Transaction<'_, Postgres>,
    design: AuthenticatedDesignIdentityV1,
    roles: &[StrategyDesignRoleEntryV1],
    initial_pit_request: Option<
        crate::owner::strategy_design_role_intent_v1::InitialPitRequestLocatorV1,
    >,
) -> Result<StrategyInputBindingAdmissionTerminalV1, StrategyInputBindingAdmissionErrorV1> {
    if roles.is_empty() {
        return Err(StrategyInputBindingAdmissionErrorV1::UnsupportedRole);
    }
    let mut requests = Vec::with_capacity(roles.len());

    for role in roles {
        let resolved = resolve_role_snapshot_v1(transaction, design, role, initial_pit_request)
            .await
            .map_err(map_admission_resolution_error)?;
        let batch = load_owner_verified_pit_batch_v1(transaction, resolved.snapshot_identity)
            .await
            .map_err(|e| map_admission_registry_error(&e))?;
        requests.push(
            compose_binding_request_v1(design, role, &batch)
                .map_err(map_admission_resolution_error)?,
        );
    }
    let [first, rest @ ..] = requests.as_slice() else {
        return Err(StrategyInputBindingAdmissionErrorV1::UnsupportedRole);
    };

    // One Design's roles answer at one PIT request or the Design does not have a single coordinate
    // to be replayed at, and that is a refusal rather than a choice between two of them.
    if rest
        .iter()
        .any(|request| request.pit_request_identity != first.pit_request_identity)
    {
        return Err(StrategyInputBindingAdmissionErrorV1::SplitCoordinate);
    }
    let terminal = StrategyInputBindingAdmissionTerminalV1::seal(
        design.design_identity(),
        design.research_request_identity(),
        first.pit_request_identity,
        first.decision_cut,
        requests.len() as u64,
    );
    register_authenticated_role_declarations_v1(transaction, design, roles, &requests)
        .await
        .map_err(|e| map_admission_registry_error(&e))?;
    Ok(terminal)
}

/// Composes and registers every declared role over a custody run's first frame inside the
/// caller's open transaction (T0-10): the frame view at the head `run` pins, sealed, so each role's
/// universe selection is the one every later frame of the run derives.
pub(super) async fn register_custody_design_roles_v1(
    transaction: &mut Transaction<'_, Postgres>,
    design: AuthenticatedDesignIdentityV1,
    roles: &[StrategyDesignRoleEntryV1],
    run: crate::owner::pit_window_custody_v1::UntrustedPitWindowRunV1,
) -> Result<StrategyInputBindingAdmissionTerminalV1, StrategyInputBindingAdmissionErrorV1> {
    if roles.is_empty() {
        return Err(StrategyInputBindingAdmissionErrorV1::UnsupportedRole);
    }

    // An unpinned run would read whatever head is current, and two admissions of one Design could
    // then compose over different views.
    if run.head_identity.is_none() {
        return Err(StrategyInputBindingAdmissionErrorV1::BindingUnavailable {
            cause: "CUSTODY_HEAD_UNPINNED",
        });
    }
    let run_unavailable = StrategyInputBindingAdmissionErrorV1::BindingUnavailable {
        cause: "CUSTODY_RUN_UNAVAILABLE",
    };
    let frames =
        super::pit_window_custody_v1::resolve_pit_window_frames_in_transaction_v1(transaction, run)
            .await
            .map_err(|_| run_unavailable)?;
    let first = frames.frames().first().ok_or(run_unavailable)?;
    let frame = crate::owner::pit_window_custody_v1::UntrustedPitWindowCustodyFrameV1 {
        custody: run.custody,
        head_identity: frames.head_identity(),
        event_ns: first.event_ns(),
    };
    let (batch, basis) =
        super::custody_strategy_input_v1::read_custody_frame_batch_v1(transaction, &frame)
            .await
            .map_err(|e| map_admission_registry_error(&e))?;
    let mut requests = Vec::with_capacity(roles.len());

    for role in roles {
        let request = compose_binding_request_v1(design, role, &batch)
            .map_err(map_admission_resolution_error)?;
        super::custody_strategy_input_v1::check_custody_request_against_basis_v1(
            &request, &batch, &basis,
        )
        .map_err(|e| map_admission_registry_error(&e))?;
        requests.push(request);
    }
    let terminal = StrategyInputBindingAdmissionTerminalV1::seal(
        design.design_identity(),
        design.research_request_identity(),
        batch.request_identity(),
        batch.time_evidence().decision_cut.value,
        requests.len() as u64,
    );
    register_authenticated_role_declarations_v1(transaction, design, roles, &requests)
        .await
        .map_err(|e| map_admission_registry_error(&e))?;
    Ok(terminal)
}

pub(super) fn map_admission_resolution_error(
    error: PitRoleResolutionErrorV1,
) -> StrategyInputBindingAdmissionErrorV1 {
    match error {
        PitRoleResolutionErrorV1::UnsupportedRole
        | PitRoleResolutionErrorV1::UnknownFieldSemantic
        | PitRoleResolutionErrorV1::UnitMismatch => {
            StrategyInputBindingAdmissionErrorV1::UnsupportedRole
        }
        PitRoleResolutionErrorV1::NoMatchingSnapshot
        | PitRoleResolutionErrorV1::DecisionCutUnavailable => {
            StrategyInputBindingAdmissionErrorV1::NoMatchingSnapshot
        }
        PitRoleResolutionErrorV1::AmbiguousSnapshot => {
            StrategyInputBindingAdmissionErrorV1::AmbiguousSnapshot
        }
        PitRoleResolutionErrorV1::InitialPitRequestUnnamed => {
            StrategyInputBindingAdmissionErrorV1::InitialPitRequestUnnamed
        }
        PitRoleResolutionErrorV1::InitialPitRequestUnknown => {
            StrategyInputBindingAdmissionErrorV1::InitialPitRequestUnknown
        }
        PitRoleResolutionErrorV1::InitialPitRequestDigestMismatch => {
            StrategyInputBindingAdmissionErrorV1::InitialPitRequestDigestMismatch
        }
        PitRoleResolutionErrorV1::InitialPitRequestNotAvailable => {
            StrategyInputBindingAdmissionErrorV1::InitialPitRequestNotAvailable
        }
        PitRoleResolutionErrorV1::InitialPitRequestRequesterMismatch => {
            StrategyInputBindingAdmissionErrorV1::InitialPitRequestRequesterMismatch
        }
        PitRoleResolutionErrorV1::UniverseUnavailable => {
            StrategyInputBindingAdmissionErrorV1::BindingUnavailable {
                cause: "UNIVERSE_UNAVAILABLE",
            }
        }
        PitRoleResolutionErrorV1::StoreUnavailable => {
            StrategyInputBindingAdmissionErrorV1::StoreUnavailable
        }
    }
}

pub(super) fn map_admission_registry_error(
    error: &StrategyInputBindingRegistryErrorV1,
) -> StrategyInputBindingAdmissionErrorV1 {
    match error {
        StrategyInputBindingRegistryErrorV1::RequestConflict => {
            StrategyInputBindingAdmissionErrorV1::RequestConflict
        }
        StrategyInputBindingRegistryErrorV1::StoreUnavailable
        | StrategyInputBindingRegistryErrorV1::StoreUntrusted => {
            StrategyInputBindingAdmissionErrorV1::StoreUnavailable
        }
        StrategyInputBindingRegistryErrorV1::PitUnavailable => {
            StrategyInputBindingAdmissionErrorV1::NoMatchingSnapshot
        }
        StrategyInputBindingRegistryErrorV1::StrategyDesignRoleSetUnavailable => {
            StrategyInputBindingAdmissionErrorV1::UnsupportedRole
        }
        other => StrategyInputBindingAdmissionErrorV1::BindingUnavailable {
            cause: other.code(),
        },
    }
}
