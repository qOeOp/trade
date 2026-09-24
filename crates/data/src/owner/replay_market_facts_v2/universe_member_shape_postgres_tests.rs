//! The Replay facts table's two shapes and its migration, proved on real PostgreSQL.

use rstest::rstest;
use sqlx::PgPool;

use super::{
    ReplayMarketFactsShapeV2,
    postgres::{
        PreparedReplayMarketFactsStorageV2, REPLAY_MARKET_FACTS_SHAPE_CHECK_V2,
        persist_replay_market_facts_in_transaction_v2,
        recover_bound_replay_market_facts_for_rd_in_transaction_v2,
        recover_bound_replay_market_facts_readback_in_transaction_v2,
    },
    tests::{first_corpus_readback, request, universe_member_readback},
};
use crate::owner::{postgres::MarketDataOwnerPostgres, source_binding::BindingDigest};

const UNIVERSE_BINDING: [u8; 32] = [97; 32];

/// The table's shape as the catalog states it: whether `shape` is required, whether it has a
/// default, whether the joined-cut column is required, and the named shape check.
type TableShape = (Option<bool>, Option<bool>, Option<bool>, Option<String>);

async fn table_shape(pool: &PgPool) -> TableShape {
    sqlx::query_as(
        "SELECT
            (SELECT a.attnotnull FROM pg_catalog.pg_attribute a WHERE a.attrelid='market_data_private.replay_market_facts_v2'::regclass AND a.attname='shape' AND NOT a.attisdropped),
            (SELECT a.atthasdef FROM pg_catalog.pg_attribute a WHERE a.attrelid='market_data_private.replay_market_facts_v2'::regclass AND a.attname='shape' AND NOT a.attisdropped),
            (SELECT a.attnotnull FROM pg_catalog.pg_attribute a WHERE a.attrelid='market_data_private.replay_market_facts_v2'::regclass AND a.attname='joined_cut_identity' AND NOT a.attisdropped),
            (SELECT pg_catalog.pg_get_constraintdef(c.oid) FROM pg_catalog.pg_constraint c WHERE c.conrelid='market_data_private.replay_market_facts_v2'::regclass AND c.conname='replay_market_facts_shape_v2')",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

fn current_shape() -> TableShape {
    (
        Some(true),
        Some(false),
        Some(false),
        Some(REPLAY_MARKET_FACTS_SHAPE_CHECK_V2.to_owned()),
    )
}

async fn execute(pool: &PgPool, statements: &[&'static str]) {
    let mut transaction = pool.begin().await.unwrap();

    for &statement in statements {
        sqlx::query(statement)
            .execute(&mut *transaction)
            .await
            .unwrap();
    }
    transaction.commit().await.unwrap();
}

async fn scenario() {
    let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
        .expect("explicit disposable Owner URL");
    let database =
        std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").expect("disposable database name");
    assert!(
        database.starts_with("vibe_test_"),
        "this proof writes and reshapes a table; it runs only against a disposable database"
    );

    // A fresh database is created in the legacy shape and migrated in the same migration, so every
    // fresh database runs the legacy branch.
    let owner = MarketDataOwnerPostgres::connect(&owner_url)
        .await
        .expect("Owner connects and migrates");
    assert_eq!(
        table_shape(owner.pool()).await,
        current_shape(),
        "shape is required with no default, the first corpus's columns are optional, and the named \
         check is exactly the one the read contract pins"
    );

    // A deployed table is legacy-shaped and already holds first-corpus rows. Store one, put the
    // table back in exactly its legacy shape, and migrate again: the row is backfilled as shape 1
    // and reads back unchanged.
    let (binding, first) = first_corpus_readback(true);
    let mut transaction = owner.pool().begin().await.unwrap();
    persist_replay_market_facts_in_transaction_v2(
        &mut transaction,
        &PreparedReplayMarketFactsStorageV2::from_verified_readback(&first, &binding).unwrap(),
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    execute(
        owner.pool(),
        &[
            "ALTER TABLE market_data_private.replay_market_facts_v2 DROP CONSTRAINT replay_market_facts_shape_v2",
            "ALTER TABLE market_data_private.replay_market_facts_v2 DROP COLUMN shape, DROP COLUMN universe_frame_identity, DROP COLUMN universe_frame_digest",
            "ALTER TABLE market_data_private.replay_market_facts_v2 ALTER COLUMN joined_cut_identity SET NOT NULL, ALTER COLUMN joined_cut_digest SET NOT NULL, ALTER COLUMN sample_projection_identity SET NOT NULL, ALTER COLUMN sample_projection_digest SET NOT NULL",
        ],
    )
    .await;
    assert_eq!(
        table_shape(owner.pool()).await,
        (None, None, Some(true), None),
        "the table is back in its legacy shape"
    );
    let owner = MarketDataOwnerPostgres::connect(&owner_url)
        .await
        .expect("the legacy shape migrates");
    assert_eq!(table_shape(owner.pool()).await, current_shape());
    let shapes: Vec<i16> =
        sqlx::query_scalar("SELECT shape FROM market_data_private.replay_market_facts_v2")
            .fetch_all(owner.pool())
            .await
            .unwrap();
    assert_eq!(
        shapes,
        [1],
        "the existing first-corpus row is backfilled as shape 1"
    );
    let mut transaction = owner.pool().begin().await.unwrap();
    assert_eq!(
        recover_bound_replay_market_facts_for_rd_in_transaction_v2(
            &mut transaction,
            &request(71),
            *binding.record().identity().as_bytes(),
        )
        .await
        .unwrap(),
        first
    );
    transaction.rollback().await.unwrap();

    // The current shape is recognised and left alone.
    let owner = MarketDataOwnerPostgres::connect(&owner_url)
        .await
        .expect("a second migration is a no-op");
    assert_eq!(table_shape(owner.pool()).await, current_shape());

    // The universe-member shape is stored and read back through both current readers.
    let universe = universe_member_readback(1);
    let mut transaction = owner.pool().begin().await.unwrap();
    persist_replay_market_facts_in_transaction_v2(
        &mut transaction,
        &PreparedReplayMarketFactsStorageV2::from_verified_universe_member_readback(
            &universe,
            BindingDigest::from_untrusted_bytes(UNIVERSE_BINDING),
        )
        .unwrap(),
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    let mut transaction = owner.pool().begin().await.unwrap();
    let recovered = recover_bound_replay_market_facts_readback_in_transaction_v2(
        &mut transaction,
        &request(71),
        UNIVERSE_BINDING,
    )
    .await
    .unwrap();
    assert_eq!(recovered, universe);
    assert_eq!(
        recovered.facts().shape(),
        ReplayMarketFactsShapeV2::UniverseMembers
    );
    assert_eq!(
        recover_bound_replay_market_facts_for_rd_in_transaction_v2(
            &mut transaction,
            &request(71),
            UNIVERSE_BINDING,
        )
        .await
        .unwrap(),
        universe,
        "the R&D lock function's second version reads the universe shape back too"
    );
    transaction.rollback().await.unwrap();

    // The named check keeps a row's columns to its shape: a universe-member row that also names a
    // joined cut is refused by the database, and the row is left as it was.
    let refused = sqlx::query(
        "UPDATE market_data_private.replay_market_facts_v2 SET joined_cut_identity=universe_frame_identity, joined_cut_digest=universe_frame_digest WHERE shape=2",
    )
    .execute(owner.pool())
    .await
    .expect_err("a universe-member row with a joined cut breaks the shape check");
    assert_eq!(
        refused.as_database_error().and_then(|e| e.constraint()),
        Some("replay_market_facts_shape_v2")
    );
    let untouched: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM market_data_private.replay_market_facts_v2 WHERE shape=2 AND joined_cut_identity IS NULL",
    )
    .fetch_one(owner.pool())
    .await
    .unwrap();
    assert_eq!(untouched, 1);

    // A table that is neither shape stops the migration instead of being guessed at.
    execute(
        owner.pool(),
        &["ALTER TABLE market_data_private.replay_market_facts_v2 DROP CONSTRAINT replay_market_facts_shape_v2"],
    )
    .await;
    assert!(
        MarketDataOwnerPostgres::connect(&owner_url).await.is_err(),
        "a current-shaped table without its named check refuses to migrate"
    );
}

/// The table's legacy-to-current migration, both shapes stored and read back, and the named check.
#[rstest]
#[ignore = "requires the crates/data disposable PostgreSQL harness"]
fn replay_facts_table_migrates_and_keeps_each_row_to_its_shape() {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(scenario());
}
