//! Whether R&D may continue an admitted Research Intent at one operation's cut.
//!
//! An admitted Intent is frozen, and its View identifies it. Nothing refreshes that View: its
//! validity window is the projection's freshness for a reader, which renders it `STALE`, and not a
//! bound on how long the Intent may be worked on. What bounds continuing the work is the authority
//! the Intent was admitted under. Every continuation re-locks the Intent's own Product Edge
//! admission at its own cut, the way a downstream first mutation does, and continues only while the
//! operator authorization that admission names is current there: in force, not revoked, under a
//! current policy binding and manifest. Protected feedback is checked when the Intent is admitted
//! and not again (`docs/owners/rd.md`), because today it carries no generation a later cut could
//! compare.
//!
//! [`ResearchContinuationAuthorizedV1`] is the only way into a current Research custody for
//! Develop, so a continuation cannot skip the check: only
//! [`authorize_research_continuation_in_transaction`] builds one.

use sqlx::{Postgres, Transaction};
use vibe_product_edge::{
    DownstreamAdmissionModeV1, ProductEdgeAdmissionLocatorV1, ProductEdgeAdmissionReadbackV1,
    resolve_admission_for_downstream_in_transaction,
};

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
/// re-locked admission must carry the same lineage. The lock answers only under `READ COMMITTED`,
/// which is the level every continuation already runs at.
pub(crate) async fn authorize_research_continuation_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    admission: &ProductEdgeAdmissionLocatorV1,
    admitted: Option<&ProductEdgeAdmissionReadbackV1>,
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

/// The initial Research custody a Develop operation continues under at `cut_epoch_ms`: the Intent's
/// stored admission re-locked there, its operator authority current, and the frozen custody rebuilt.
pub(crate) async fn continue_initial_research_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    custody: &crate::rd_owner_postgres_custody::VerifiedResearchCustodyV1,
    request_locator: &str,
    cut_epoch_ms: u64,
) -> Result<crate::develop_composer_v2::CurrentResearchDevelopCustodyV2, DevelopComposerTerminalV2>
{
    let admission = initial_research_admission(custody)?;
    let authorized = authorize_research_continuation_in_transaction(
        transaction,
        admission.locator(),
        Some(admission),
        cut_epoch_ms,
    )
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
    let authorized = authorize_research_continuation_in_transaction(
        transaction,
        custody.admission(),
        None,
        cut_epoch_ms,
    )
    .await?;
    crate::develop_composer_v2::CurrentResearchDevelopCustodyV2::from_verified_successor(
        readback,
        custody,
        family,
        &authorized,
    )
}

fn authority_not_current() -> DevelopComposerTerminalV2 {
    DevelopComposerTerminalV2::unavailable(
        RESEARCH_CONTINUATION_AUTHORITY_NOT_CURRENT_COORDINATE_V1,
        "the operator authority the Research Intent was admitted under is not current at this cut",
    )
}
