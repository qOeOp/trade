//! Market Data's early answer for a V3 Research request's instrument scope.
//!
//! Before accepting a V3 request this Owner asks Market Data whether every requested identity
//! resolves and lies in the eligible-instrument frontier at Market Data's current decision cut.
//! The check runs inside the R&D transaction that decides the request and only refuses early:
//! Market Data's decision when the Intent's initial PIT request is issued remains the guarantee.

use async_trait::async_trait;
use sqlx::{Postgres, Transaction};
use vibe_data::owner::check_research_instrument_scope_v1;
use vibe_data::owner::research_instrument_scope_v1::ResearchInstrumentScopeV1;
use vibe_data::owner::research_pit_references_v1::{
    ResearchInstrumentAdmissibilityV1, ResearchInstrumentScopeCheckV1,
    ResearchInstrumentScopeReadErrorV1,
};

use crate::product_edge::{
    InstrumentAdmissibilityV1, InstrumentScopeCheckRecordV1, InstrumentScopeCheckRowV1,
};

/// Why the check could not be answered. Either way the request stays unresolved rather than
/// rejected; the two are kept apart because they last differently: Market Data has no clock head
/// until it admits one, while an unreadable store is usually transient.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub(crate) enum InstrumentScopeCheckUnavailableV1 {
    /// Market Data holds no clock head yet.
    #[error("Market Data holds no clock head to answer the instrument scope check at")]
    ClockUnavailable,
    /// Market Data's store could not be read, or returned evidence it does not trust.
    #[error("Market Data's store could not answer the instrument scope check")]
    StoreUnavailable,
}

impl InstrumentScopeCheckUnavailableV1 {
    /// The diagnostic coordinate an unresolved request is refused under.
    pub(crate) const fn coordinate(self) -> &'static str {
        match self {
            Self::ClockUnavailable => {
                "research_goal_owner.submit_v2.instrument_scope_check.clock_unavailable"
            }
            Self::StoreUnavailable => {
                "research_goal_owner.submit_v2.instrument_scope_check.store_unavailable"
            }
        }
    }
}

/// Where the R&D Owner reads the early check.
#[async_trait]
pub(crate) trait InstrumentScopeCheckPortV1: Send + Sync {
    /// Answers `scope` inside `transaction`, with the frontier and cut the answer rests on.
    async fn check(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        scope: &ResearchInstrumentScopeV1,
    ) -> Result<InstrumentScopeCheckRecordV1, InstrumentScopeCheckUnavailableV1>;
}

/// The production check: Market Data's admitted read surface,
/// `market_data_rd_api.check_research_instrument_scope_v1`, answered inside this transaction.
pub(crate) struct MarketDataInstrumentScopeCheckV1;

#[async_trait]
impl InstrumentScopeCheckPortV1 for MarketDataInstrumentScopeCheckV1 {
    async fn check(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        scope: &ResearchInstrumentScopeV1,
    ) -> Result<InstrumentScopeCheckRecordV1, InstrumentScopeCheckUnavailableV1> {
        // Neither refusal is an answer about the request, so neither can close it.
        let check = check_research_instrument_scope_v1(transaction, scope)
            .await
            .map_err(|e| match e {
                ResearchInstrumentScopeReadErrorV1::ClockUnavailable => {
                    InstrumentScopeCheckUnavailableV1::ClockUnavailable
                }
                ResearchInstrumentScopeReadErrorV1::StoreUnavailable => {
                    InstrumentScopeCheckUnavailableV1::StoreUnavailable
                }
            })?;
        Ok(record_of(&check))
    }
}

/// This Owner's durable record of Market Data's answer. The admissibility is re-stated in this
/// Owner's own stored vocabulary, so a later rename on the Market Data side cannot change what a
/// stored rejection says.
fn record_of(check: &ResearchInstrumentScopeCheckV1) -> InstrumentScopeCheckRecordV1 {
    InstrumentScopeCheckRecordV1 {
        eligible_instrument_frontier: check.eligible_instrument_frontier(),
        decision_cut: check.decision_cut().clone(),
        rows: check
            .rows()
            .iter()
            .map(|row| InstrumentScopeCheckRowV1 {
                identity: row.identity().to_owned(),
                admissibility: match row.admissibility() {
                    ResearchInstrumentAdmissibilityV1::Admissible => {
                        InstrumentAdmissibilityV1::Admissible
                    }
                    ResearchInstrumentAdmissibilityV1::Unresolved => {
                        InstrumentAdmissibilityV1::Unresolved
                    }
                    ResearchInstrumentAdmissibilityV1::NotInEligibleFrontier => {
                        InstrumentAdmissibilityV1::NotInEligibleFrontier
                    }
                },
            })
            .collect(),
    }
}

/// A check that answers the same record for every scope, for tests of this Owner's own handling.
#[cfg(test)]
pub(crate) struct FixedInstrumentScopeCheckV1(
    pub(crate) Result<InstrumentScopeCheckRecordV1, InstrumentScopeCheckUnavailableV1>,
);

#[cfg(test)]
#[async_trait]
impl InstrumentScopeCheckPortV1 for FixedInstrumentScopeCheckV1 {
    async fn check(
        &self,
        _transaction: &mut Transaction<'_, Postgres>,
        _scope: &ResearchInstrumentScopeV1,
    ) -> Result<InstrumentScopeCheckRecordV1, InstrumentScopeCheckUnavailableV1> {
        self.0.clone()
    }
}
