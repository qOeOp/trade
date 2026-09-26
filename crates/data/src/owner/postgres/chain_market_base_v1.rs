//! The chain market base's acceptance corpus, named by the correlation the base submits under.
//!
//! A compatibility scope carries one Market Semantics chain per PIT snapshot, so once anything else
//! is admitted under the market base's scope, the scope alone no longer names the base's corpus. The
//! base's snapshot does, and the base's correlation finds it.

use sqlx::{Postgres, Transaction};
use thiserror::Error;

use super::MarketDataOwnerPostgres;
use crate::owner::{
    chain_fixture_v1::{
        CHAIN_MARKET_BASE_PIT_CORRELATION_V1, CHAIN_MARKET_BASE_RESEARCH_REQUEST_V1,
    },
    pit_snapshot::research_pit_requester_identity_v1,
    source_binding::BindingDigest,
};

/// The instants and cut the market base seals its Market Semantics fact under.
const BASE_EFFECTIVE_INSTANT_NS: i128 = 50;
const BASE_OWNER_OBSERVATION_NS: i128 = 100;
const BASE_DECISION_CUT: u64 = 100;

/// The chain market base's PIT snapshot, found by the correlation the base submits under.
///
/// Only this module builds one, so a caller holding one names the base's corpus and no other
/// snapshot.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ChainMarketBaseSnapshotV1(BindingDigest);

impl ChainMarketBaseSnapshotV1 {
    pub(crate) const fn snapshot_identity(self) -> BindingDigest {
        self.0
    }
}

/// Why the chain market base's corpus could not be named.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum ChainMarketBaseUnavailableV1 {
    #[error("the Market Data store was unavailable")]
    Store,
    #[error("no initial PIT snapshot carries the chain market base's correlation and requester")]
    NoSnapshot,
    #[error(
        "more than one initial PIT snapshot carries the chain market base's correlation and requester"
    )]
    Ambiguous,
    #[error("the market base's snapshot carries no single Market Semantics fact under this scope")]
    Semantics,
}

/// Finds the chain market base's PIT snapshot in the store at `owner_url`.
///
/// # Errors
///
/// [`ChainMarketBaseUnavailableV1::NoSnapshot`] when the store holds no snapshot under the base's
/// correlation, and [`ChainMarketBaseUnavailableV1::Store`] when it cannot be read.
pub async fn chain_market_base_snapshot_v1(
    owner_url: &str,
) -> Result<ChainMarketBaseSnapshotV1, ChainMarketBaseUnavailableV1> {
    let owner = MarketDataOwnerPostgres::connect_existing(owner_url)
        .await
        .map_err(|_| ChainMarketBaseUnavailableV1::Store)?;
    let mut transaction = owner
        .pool
        .begin()
        .await
        .map_err(|_| ChainMarketBaseUnavailableV1::Store)?;
    let snapshot = chain_market_base_snapshot_in_transaction_v1(&mut transaction).await?;
    transaction
        .rollback()
        .await
        .map_err(|_| ChainMarketBaseUnavailableV1::Store)?;
    Ok(snapshot)
}

/// Finds the chain market base's PIT snapshot: the one initial snapshot whose request carries the
/// base's correlation and requester.
///
/// Both are compared as the Owner stored them, in the snapshot's aggregate, serialized by the same
/// encoder that wrote it.
pub(crate) async fn chain_market_base_snapshot_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<ChainMarketBaseSnapshotV1, ChainMarketBaseUnavailableV1> {
    let correlation = serde_json::to_value(BindingDigest::from_untrusted_bytes(
        CHAIN_MARKET_BASE_PIT_CORRELATION_V1,
    ))
    .map_err(|_| ChainMarketBaseUnavailableV1::Store)?;
    let requester = serde_json::to_value(research_pit_requester_identity_v1(
        BindingDigest::from_untrusted_bytes(CHAIN_MARKET_BASE_RESEARCH_REQUEST_V1),
    ))
    .map_err(|_| ChainMarketBaseUnavailableV1::Store)?;
    let snapshots: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT snapshot_identity FROM market_data_private.pit_snapshot_facts_v1 \
         WHERE lineage_version=1 \
           AND aggregate_json #> '{fact,request,correlation_identity}' = $1 \
           AND aggregate_json #> '{fact,request,requester_identity}' = $2",
    )
    .bind(correlation)
    .bind(requester)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| ChainMarketBaseUnavailableV1::Store)?;
    let snapshot = match snapshots.as_slice() {
        [] => return Err(ChainMarketBaseUnavailableV1::NoSnapshot),
        [snapshot] => snapshot,
        _ => return Err(ChainMarketBaseUnavailableV1::Ambiguous),
    };
    let snapshot: [u8; 32] = snapshot
        .as_slice()
        .try_into()
        .map_err(|_| ChainMarketBaseUnavailableV1::Store)?;
    Ok(ChainMarketBaseSnapshotV1(
        BindingDigest::from_untrusted_bytes(snapshot),
    ))
}

/// Requires exactly one Market Semantics fact under `scope` for the base's snapshot, the one the
/// base sealed, whatever else the scope carries.
pub(crate) async fn require_chain_market_base_fact_v1(
    transaction: &mut Transaction<'_, Postgres>,
    scope: BindingDigest,
    market_base: ChainMarketBaseSnapshotV1,
) -> Result<(), ChainMarketBaseUnavailableV1> {
    let readback = super::market_semantics::resolve_market_semantics_scope_in_transaction_v1(
        transaction,
        scope,
        market_base.0,
        BASE_EFFECTIVE_INSTANT_NS,
        BASE_OWNER_OBSERVATION_NS,
        BASE_DECISION_CUT,
    )
    .await
    .map_err(|_| ChainMarketBaseUnavailableV1::Semantics)?;
    let [fact] = readback.facts() else {
        return Err(ChainMarketBaseUnavailableV1::Semantics);
    };

    if fact.pit_snapshot_identity != market_base.0 {
        return Err(ChainMarketBaseUnavailableV1::Semantics);
    }
    Ok(())
}
