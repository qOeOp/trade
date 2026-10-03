//! Two Market Data reads this Owner's role set answers for a caller composing a universe-member
//! Replay over a new snapshot, through the same `market_data_rd_api` surface this Owner reads it
//! by for its own initial PIT request.
//!
//! Each runs Market Data's own function unchanged, in a transaction that is `READ ONLY` from its
//! first statement and always rolled back: the functions take no row lock, and a future change that
//! did would fail here rather than wait. Neither read is a decision; the issuance and the admission
//! that consume what they return re-derive and check it.

use vibe_data::owner::{
    market_semantics_admission_v1::{
        MarketSemanticsScopeValueErrorV1, MarketSemanticsScopeValueV1,
    },
    pit_snapshot::UntrustedPitSnapshotLocator,
    source_binding::UntrustedSourceBindingLocator,
    universe_member_composition_basis_v1::{
        UniverseMemberCompositionBasisErrorV1, UniverseMemberCompositionBasisV1,
    },
};

use super::PostgresResearchGoalOwnerV1;

impl PostgresResearchGoalOwnerV1 {
    /// The value a Source Binding's compatibility scope states, as Market Data's
    /// `resolve_market_semantics_scope_value_v1` reads it.
    ///
    /// # Errors
    ///
    /// Market Data's own refusal, unchanged; a transaction this Owner cannot open or roll back is
    /// `StoreUnavailable`.
    pub async fn read_market_semantics_scope_value_v1(
        &self,
        source_binding: &UntrustedSourceBindingLocator,
    ) -> Result<MarketSemanticsScopeValueV1, MarketSemanticsScopeValueErrorV1> {
        let unavailable = MarketSemanticsScopeValueErrorV1::StoreUnavailable;
        let mut transaction = self.pool.begin().await.map_err(|_| unavailable)?;
        sqlx::query("SET TRANSACTION READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(|_| unavailable)?;
        let value = vibe_data::owner::resolve_market_semantics_scope_value_v1(
            &mut transaction,
            source_binding,
        )
        .await;
        transaction.rollback().await.map_err(|_| unavailable)?;
        value
    }

    /// The four locators a universe-member Replay composition over `pit` names besides the
    /// snapshot and its binding, as Market Data's `resolve_universe_member_composition_basis_v1`
    /// reads them.
    ///
    /// # Errors
    ///
    /// Market Data's own refusal, unchanged; a transaction this Owner cannot open or roll back is
    /// `StoreUnavailable`.
    pub async fn read_universe_member_composition_basis_v1(
        &self,
        pit: &UntrustedPitSnapshotLocator,
        source_binding: &UntrustedSourceBindingLocator,
    ) -> Result<UniverseMemberCompositionBasisV1, UniverseMemberCompositionBasisErrorV1> {
        let unavailable = UniverseMemberCompositionBasisErrorV1::StoreUnavailable;
        let mut transaction = self.pool.begin().await.map_err(|_| unavailable)?;
        sqlx::query("SET TRANSACTION READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(|_| unavailable)?;
        let basis = vibe_data::owner::resolve_universe_member_composition_basis_v1(
            &mut transaction,
            pit,
            source_binding,
        )
        .await;
        transaction.rollback().await.map_err(|_| unavailable)?;
        basis
    }
}
