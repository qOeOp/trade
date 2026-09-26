//! A Data Client that answers nothing, or answers part of a universe, gets a terminal negative the
//! Owner derives itself, and a retry of it rejoins.
//!
//! `PitObservationSourceV1::observe` states the contract: an empty answer is not an error but
//! insufficient coverage, recorded as an explicit terminal negative. These drive the production
//! intake over a real Owner store, with the fixture's Data Client swapped for one that answers
//! less than the scope.

use std::sync::Arc;

use super::{
    MarketDataOwnerPostgres, MarketDataPitIntakePostgresV1,
    pit_intake_member_count_tests::{Fixture, d},
};
use crate::owner::{
    pit_market_snapshot_intake_v1::{
        PitMarketSnapshotBlockerV1, PitMarketSnapshotDispositionV1, PitMarketSnapshotIntakeV1,
    },
    pit_observation_source_v1::{
        PitObservationScopeV1, PitObservationSourceErrorV1, PitObservationSourceV1,
        VendorObservationV1,
    },
};

/// Answers the first `members` of the scope, in its order, with one canonical close each.
struct AnswersMembersV1 {
    members: usize,
}

#[async_trait::async_trait]
impl PitObservationSourceV1 for AnswersMembersV1 {
    async fn observe(
        &self,
        scope: &PitObservationScopeV1,
    ) -> Result<Vec<VendorObservationV1>, PitObservationSourceErrorV1> {
        Ok(scope
            .members()
            .iter()
            .take(self.members)
            .map(|member| VendorObservationV1 {
                symbolic_key: format!("{member}.CLOSE.1M"),
                member_key: member.clone(),
                instrument: member.clone(),
                channel: "MARKET".into(),
                data_kind: "BAR".into(),
                timeframe: "1M".into(),
                field: "CLOSE".into(),
                value_mantissa: 12_345,
                value_scale: 2,
                event_effective: scope.event_effective(),
                provider_available: scope.provider_available(),
                retrieval: scope.retrieval(),
                correction_publication: scope.correction_publication(),
            })
            .collect())
    }
}

async fn intake_answering(members: usize) -> MarketDataPitIntakePostgresV1 {
    let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap();
    MarketDataPitIntakePostgresV1 {
        owner: MarketDataOwnerPostgres::connect(&owner_url).await.unwrap(),
        observations: Arc::new(AnswersMembersV1 { members }),
    }
}

/// The tables whose rows a submission changes, by name, before and after.
fn changed(
    before: &[(String, i64, String)],
    after: &[(String, i64, String)],
) -> Vec<(String, i64)> {
    before
        .iter()
        .zip(after)
        .filter(|(before, after)| before != after)
        .map(|(before, after)| (before.0.clone(), after.1 - before.1))
        .collect()
}

async fn batches_of(
    fixture: &Fixture,
    snapshot: crate::owner::source_binding::BindingDigest,
) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM market_data_private.pit_observation_batches_v1 WHERE snapshot_identity=$1",
    )
    .bind(snapshot.as_bytes().as_slice())
    .fetch_one(fixture.owner().pool())
    .await
    .unwrap()
}

/// An empty answer commits an INSUFFICIENT snapshot, named by its coverage blocker, with no
/// observation batch; the same submission again rejoins it; and a Data Client that answers the one
/// member still commits `AVAILABLE` with its batch, as before.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_an_empty_answer_is_an_insufficient_snapshot_without_a_batch() {
    let fixture = Fixture::install().await;
    fixture.admit_instrument("AAPL", d(81)).await;
    let (universe, locator) = fixture.universe(100, &[0, 1, 1], &[("AAPL", "AAPL")]).await;
    let empty = intake_answering(0).await;

    let before = fixture.store().await;
    let terminal = empty
        .submit(fixture.request(231, &universe), locator)
        .await
        .expect("an empty answer is a terminal negative, not an error");
    assert_eq!(
        terminal.disposition(),
        PitMarketSnapshotDispositionV1::Insufficient
    );
    assert_eq!(
        terminal.primary_blocker(),
        Some(PitMarketSnapshotBlockerV1::CoverageInsufficient)
    );
    assert_eq!(
        terminal.locator(),
        None,
        "a negative terminal locates no snapshot"
    );
    assert_eq!(
        batches_of(&fixture, terminal.snapshot_identity()).await,
        0,
        "an empty answer stores no observation batch"
    );
    let after = fixture.store().await;
    assert!(
        changed(&before, &after)
            .iter()
            .all(|(table, _)| !table.starts_with("pit_observation_")),
        "no observation batch or row is written: {:?}",
        changed(&before, &after)
    );

    // The same submission again rejoins the committed terminal, and writes nothing.
    assert_eq!(
        empty.submit(fixture.request(231, &universe), locator).await,
        Ok(terminal)
    );
    assert_eq!(fixture.store().await, after, "a rejoin writes nothing");

    // One member answered: AVAILABLE, with its one-row batch, as before.
    let answered = intake_answering(1)
        .await
        .submit(fixture.request(232, &universe), locator)
        .await
        .expect("a complete answer commits");
    assert_eq!(
        answered.disposition(),
        PitMarketSnapshotDispositionV1::Available
    );
    assert_eq!(answered.primary_blocker(), None);
    assert_eq!(batches_of(&fixture, answered.snapshot_identity()).await, 1);
}

/// A two-member universe answered for one member is INSUFFICIENT, with the batch it answered, and
/// the same submission again rejoins it instead of being refused on replay.
#[tokio::test]
#[ignore = "requires a disposable Market Data PostgreSQL database"]
async fn postgres_a_partial_answer_is_insufficient_and_its_retry_rejoins() {
    let fixture = Fixture::install().await;
    for identity in ["AAPL", "MSFT"] {
        fixture.admit_instrument(identity, d(81)).await;
    }
    let (universe, locator) = fixture
        .universe(110, &[0, 1, 1], &[("MSFT", "MSFT"), ("AAPL", "AAPL")])
        .await;
    let partial = intake_answering(1).await;

    let terminal = partial
        .submit(fixture.request(233, &universe), locator)
        .await
        .expect("a partial answer is a terminal negative, not an error");
    assert_eq!(
        terminal.disposition(),
        PitMarketSnapshotDispositionV1::Insufficient
    );
    assert_eq!(
        terminal.primary_blocker(),
        Some(PitMarketSnapshotBlockerV1::CoverageInsufficient)
    );
    assert_eq!(batches_of(&fixture, terminal.snapshot_identity()).await, 1);

    let settled = fixture.store().await;
    assert_eq!(
        partial
            .submit(fixture.request(233, &universe), locator)
            .await,
        Ok(terminal),
        "a retry of a committed negative rejoins it"
    );
    assert_eq!(fixture.store().await, settled, "a rejoin writes nothing");
}
