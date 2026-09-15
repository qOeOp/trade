//! Shared PostgreSQL admission for current Decision-selected successor Research custody.
//!
//! Successor consumers must acquire the successor Intent row before any later aggregate lock, then
//! rebuild the current Develop custody from the locked Research View and TrialFamily census.

use sqlx::{Postgres, Transaction};

use crate::{
    develop_composer_v2::{CurrentResearchDevelopCustodyV2, DevelopComposerTerminalV2},
    successor_intent_postgres::{
        lock_by_intent_in_transaction, lock_successor_research_view_in_transaction,
    },
    trial_family_postgres::load_trial_family_census_v2_by_family_in_transaction,
};

const SUCCESSOR_RESEARCH_INTENT_LOCATOR_PREFIX_V1: &str = "rd-successor-research-intent-v1-";

pub(crate) fn is_successor_research_intent_locator_v1(locator: &str) -> bool {
    locator.starts_with(SUCCESSOR_RESEARCH_INTENT_LOCATOR_PREFIX_V1)
}

pub(crate) async fn lock_successor_research_for_intent_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    intent_identity: &str,
    read_cut_epoch_ms: u64,
) -> Result<CurrentResearchDevelopCustodyV2, DevelopComposerTerminalV2> {
    let successor = lock_by_intent_in_transaction(transaction, intent_identity)
        .await
        .map_err(|_| research_unavailable())?
        .ok_or_else(research_unavailable)?;
    let view = lock_successor_research_view_in_transaction(transaction, &successor)
        .await
        .map_err(|_| research_unavailable())?;
    let family = load_trial_family_census_v2_by_family_in_transaction(
        transaction,
        successor.intent().trial_family_identity(),
    )
    .await
    .map_err(|_| research_unavailable())?;
    CurrentResearchDevelopCustodyV2::from_verified_successor(
        &successor,
        &view,
        &family,
        read_cut_epoch_ms,
    )
}

fn research_unavailable() -> DevelopComposerTerminalV2 {
    DevelopComposerTerminalV2::unavailable(
        "research_custody",
        "successor Research custody is unavailable",
    )
}
