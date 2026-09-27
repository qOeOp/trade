//! Whether R&D may continue an admitted Research Intent at one operation's cut.
//!
//! An admitted Intent is frozen, and its View identifies it. Nothing refreshes that View: its
//! validity window is the projection's freshness for a reader, which renders it `STALE`, and not a
//! bound on how long the Intent may be worked on. What bounds continuing the work is the authority
//! the Intent was admitted under. Every continuation re-locks the Intent's own Product Edge
//! admission at its own cut, the way a downstream first mutation does, and continues only while the
//! operator authorization that admission names is current there: in force, not revoked, under a
//! current policy binding and manifest. It also continues only while no protected evaluation has
//! become observable to the Intent since it was frozen: the protected-feedback history the Intent's
//! projection belongs to must still be at the generation the Intent froze. Once a phase fact has
//! advanced it, iterating goes through a successor Intent, which freezes the new generation.
//!
//! [`ResearchContinuationAuthorizedV1`] is the only way into a current Research custody for
//! Develop, so a continuation cannot skip the check: only
//! [`authorize_research_continuation_in_transaction`] builds one.

use sqlx::{Postgres, Transaction};
use vibe_product_edge::{
    DownstreamAdmissionModeV1, ProductEdgeAdmissionLocatorV1, ProductEdgeAdmissionReadbackV1,
    resolve_admission_for_downstream_in_transaction,
};
use vibe_qualification::ProtectedFeedbackFrontierReadbackV1;

use crate::develop_composer_v2::DevelopComposerTerminalV2;

/// Every continuation refusal's coordinate starts with this, so a reader that has its own refusal
/// for other failures can let these through under their own names.
pub(crate) const RESEARCH_CONTINUATION_COORDINATE_PREFIX_V1: &str =
    "research_custody.continuation.";

/// Whether `terminal` is one of this module's refusals.
pub(crate) fn is_research_continuation_refusal(terminal: &DevelopComposerTerminalV2) -> bool {
    terminal
        .coordinate
        .starts_with(RESEARCH_CONTINUATION_COORDINATE_PREFIX_V1)
}

/// Coordinate of a Research custody with no current Product Edge admission to continue under: a
/// quarantined legacy custody.
pub(crate) const RESEARCH_CONTINUATION_NO_ADMISSION_COORDINATE_V1: &str =
    "research_custody.continuation.no_admission";
/// Coordinate of an admission whose operator authority is not current at the operation's cut:
/// expired, revoked, superseded without a current binding, or outside its manifest's window.
pub(crate) const RESEARCH_CONTINUATION_AUTHORITY_NOT_CURRENT_COORDINATE_V1: &str =
    "research_custody.continuation.authority_not_current";
/// Coordinate of a re-locked admission that is not the one the Intent was admitted under.
pub(crate) const RESEARCH_CONTINUATION_ADMISSION_CHANGED_COORDINATE_V1: &str =
    "research_custody.continuation.admission_changed";
/// Coordinate of an Intent whose protected-feedback history has moved past the generation it
/// froze: a protected evaluation became observable to it after the freeze.
pub(crate) const RESEARCH_CONTINUATION_PROTECTED_FEEDBACK_ADVANCED_COORDINATE_V1: &str =
    "research_custody.continuation.protected_feedback_advanced";
/// Coordinate of an Intent whose protected-feedback generation cannot be read at the cut: the
/// frozen projection or its history is not found, or Qualification cannot be read.
pub(crate) const RESEARCH_CONTINUATION_PROTECTED_FEEDBACK_UNAVAILABLE_COORDINATE_V1: &str =
    "research_custody.continuation.protected_feedback_unavailable";

/// Proof that one admitted Research Intent may be continued at one cut: its admission was
/// re-locked there and its operator authority was current.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ResearchContinuationAuthorizedV1 {
    admission_identity: String,
    cut_epoch_ms: u64,
}

impl ResearchContinuationAuthorizedV1 {
    pub(crate) fn admission_identity(&self) -> &str {
        &self.admission_identity
    }

    pub(crate) const fn cut_epoch_ms(&self) -> u64 {
        self.cut_epoch_ms
    }

    /// A proof for a unit test that has no Product Edge custody to lock.
    #[cfg(test)]
    pub(crate) fn for_test(admission_identity: &str, cut_epoch_ms: u64) -> Self {
        Self {
            admission_identity: admission_identity.to_owned(),
            cut_epoch_ms,
        }
    }
}

/// Re-locks `admission` at `cut_epoch_ms` in the caller's transaction and proves the Intent it
/// admitted may be continued there.
///
/// `admitted`, when the caller holds it, is the admission as the Intent's custody stored it; the
/// re-locked admission must carry the same lineage. `frozen_feedback` is the protected-feedback
/// projection the Intent was frozen under; its history's generation is read and held `FOR SHARE`
/// until the caller's transaction ends, so no phase fact can commit between the check and the
/// continuation's own commit. Both reads answer only under `READ COMMITTED`, which is the level
/// every continuation already runs at.
pub(crate) async fn authorize_research_continuation_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    admission: &ProductEdgeAdmissionLocatorV1,
    admitted: Option<&ProductEdgeAdmissionReadbackV1>,
    frozen_feedback: &ProtectedFeedbackFrontierReadbackV1,
    cut_epoch_ms: u64,
) -> Result<ResearchContinuationAuthorizedV1, DevelopComposerTerminalV2> {
    let current = resolve_admission_for_downstream_in_transaction(
        transaction,
        admission,
        DownstreamAdmissionModeV1::FirstMutation {
            read_cut_epoch_ms: cut_epoch_ms,
        },
    )
    .await
    .map_err(|cause| {
        crate::storage_diagnostic::refused_by_store(
            RESEARCH_CONTINUATION_AUTHORITY_NOT_CURRENT_COORDINATE_V1,
            &cause,
        );
        authority_not_current()
    })?;

    if current.locator() != admission
        || admitted.is_some_and(|admitted| !current.has_same_admission_lineage(admitted))
    {
        crate::storage_diagnostic::refused_by_store(
            RESEARCH_CONTINUATION_ADMISSION_CHANGED_COORDINATE_V1,
            &format!(
                "re-locked admission {} differs from the one the Intent was admitted under",
                current.locator().admission_identity
            ),
        );
        return Err(DevelopComposerTerminalV2::unavailable(
            RESEARCH_CONTINUATION_ADMISSION_CHANGED_COORDINATE_V1,
            "the re-locked Product Edge admission is not the one the Research Intent was admitted under",
        ));
    }

    if !current.authorizes_first_mutation_at(cut_epoch_ms) {
        return Err(authority_not_current());
    }
    verify_protected_feedback_not_advanced_in_transaction(transaction, frozen_feedback).await?;
    Ok(ResearchContinuationAuthorizedV1 {
        admission_identity: admission.admission_identity.clone(),
        cut_epoch_ms,
    })
}

/// The admission an initial Research custody stored, or the named refusal when it has none.
pub(crate) fn initial_research_admission(
    custody: &crate::rd_owner_postgres_custody::VerifiedResearchCustodyV1,
) -> Result<&ProductEdgeAdmissionReadbackV1, DevelopComposerTerminalV2> {
    custody.product_edge_admission().ok_or_else(|| {
        DevelopComposerTerminalV2::unavailable(
            RESEARCH_CONTINUATION_NO_ADMISSION_COORDINATE_V1,
            "a quarantined legacy Research custody carries no current Product Edge admission",
        )
    })
}

/// Proves an initial Research Intent may be continued at `cut_epoch_ms`: its stored admission
/// re-locked there with its operator authority current, and its protected feedback not advanced.
pub(crate) async fn authorize_initial_research_continuation_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    custody: &crate::rd_owner_postgres_custody::VerifiedResearchCustodyV1,
    cut_epoch_ms: u64,
) -> Result<ResearchContinuationAuthorizedV1, DevelopComposerTerminalV2> {
    let admission = initial_research_admission(custody)?;
    let frozen_feedback = custody.protected_feedback().ok_or_else(|| {
        crate::storage_diagnostic::refused_by_store(
            RESEARCH_CONTINUATION_PROTECTED_FEEDBACK_UNAVAILABLE_COORDINATE_V1,
            &"an admitted Research custody carries no frozen protected-feedback projection",
        );
        protected_feedback_unavailable()
    })?;
    authorize_research_continuation_in_transaction(
        transaction,
        admission.locator(),
        Some(admission),
        frozen_feedback,
        cut_epoch_ms,
    )
    .await
}

/// The initial Research custody a Develop operation continues under at `cut_epoch_ms`: the Intent's
/// stored admission re-locked there, its operator authority current, its protected feedback not
/// advanced, and the frozen custody rebuilt.
pub(crate) async fn continue_initial_research_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    custody: &crate::rd_owner_postgres_custody::VerifiedResearchCustodyV1,
    request_locator: &str,
    cut_epoch_ms: u64,
) -> Result<crate::develop_composer_v2::CurrentResearchDevelopCustodyV2, DevelopComposerTerminalV2>
{
    let authorized = Box::pin(authorize_initial_research_continuation_in_transaction(
        transaction,
        custody,
        cut_epoch_ms,
    ))
    .await?;
    crate::develop_composer_v2::CurrentResearchDevelopCustodyV2::from_verified(
        custody,
        request_locator,
        &authorized,
    )
}

/// The successor Research custody a Develop operation continues under at `cut_epoch_ms`, on the
/// same terms as [`continue_initial_research_in_transaction`].
pub(crate) async fn continue_successor_research_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &crate::successor_intent::SuccessorResearchIntentReadbackV1,
    custody: &crate::successor_intent_postgres::SuccessorResearchViewCustodyV1,
    family: &crate::trial_family::TrialFamilyCensusReadbackV2,
    cut_epoch_ms: u64,
) -> Result<crate::develop_composer_v2::CurrentResearchDevelopCustodyV2, DevelopComposerTerminalV2>
{
    let intent = readback.intent();
    let frozen_feedback =
        crate::successor_intent_postgres::verify_successor_protected_feedback_basis_in_transaction(
            transaction,
            intent.independence_basis_identity(),
            intent.independence_basis_digest(),
            intent.protected_feedback_projection_identity(),
            intent.protected_feedback_projection_digest(),
        )
        .await
        .map_err(|cause| {
            crate::storage_diagnostic::refused_by_store(
                RESEARCH_CONTINUATION_PROTECTED_FEEDBACK_UNAVAILABLE_COORDINATE_V1,
                &cause,
            );
            protected_feedback_unavailable()
        })?;
    let authorized = Box::pin(authorize_research_continuation_in_transaction(
        transaction,
        custody.admission(),
        None,
        &frozen_feedback,
        cut_epoch_ms,
    ))
    .await?;
    crate::develop_composer_v2::CurrentResearchDevelopCustodyV2::from_verified_successor(
        readback,
        custody,
        family,
        &authorized,
    )
}

/// Refuses unless the protected-feedback history `frozen` belongs to is still at the source cut
/// `frozen` states. Every phase fact of the history advances it, so an unequal cut means a
/// protected evaluation became observable to the Intent after its freeze.
async fn verify_protected_feedback_not_advanced_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    frozen: &ProtectedFeedbackFrontierReadbackV1,
) -> Result<(), DevelopComposerTerminalV2> {
    match vibe_qualification::read_protected_feedback_generation_in_transaction(
        transaction,
        frozen.projection_identity(),
    )
    .await
    {
        Ok(Some(current)) if current.source_cut() == frozen.source_cut() => Ok(()),
        Ok(Some(current)) => {
            crate::storage_diagnostic::refused_by_store(
                RESEARCH_CONTINUATION_PROTECTED_FEEDBACK_ADVANCED_COORDINATE_V1,
                &format!(
                    "the Intent froze {} and its history is at {}",
                    frozen.source_cut(),
                    current.source_cut()
                ),
            );
            Err(DevelopComposerTerminalV2::unavailable(
                RESEARCH_CONTINUATION_PROTECTED_FEEDBACK_ADVANCED_COORDINATE_V1,
                "a protected evaluation became observable to the Research Intent after it was frozen; iterate through a successor Intent",
            ))
        }
        Ok(None) => {
            crate::storage_diagnostic::refused_by_store(
                RESEARCH_CONTINUATION_PROTECTED_FEEDBACK_UNAVAILABLE_COORDINATE_V1,
                &"Qualification holds no history for the Intent's frozen projection",
            );
            Err(protected_feedback_unavailable())
        }
        Err(cause) => {
            crate::storage_diagnostic::refused_by_store(
                RESEARCH_CONTINUATION_PROTECTED_FEEDBACK_UNAVAILABLE_COORDINATE_V1,
                &cause,
            );
            Err(protected_feedback_unavailable())
        }
    }
}

fn protected_feedback_unavailable() -> DevelopComposerTerminalV2 {
    DevelopComposerTerminalV2::unavailable(
        RESEARCH_CONTINUATION_PROTECTED_FEEDBACK_UNAVAILABLE_COORDINATE_V1,
        "the protected-feedback generation the Research Intent froze cannot be read at this cut",
    )
}

fn authority_not_current() -> DevelopComposerTerminalV2 {
    DevelopComposerTerminalV2::unavailable(
        RESEARCH_CONTINUATION_AUTHORITY_NOT_CURRENT_COORDINATE_V1,
        "the operator authority the Research Intent was admitted under is not current at this cut",
    )
}
