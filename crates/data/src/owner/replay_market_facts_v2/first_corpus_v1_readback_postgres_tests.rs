//! The first corpus read back through the R&D lock function, proved on real PostgreSQL.

use rstest::rstest;
use sqlx::{Column, Row, postgres::PgRow};

use sha2::{Digest as _, Sha256};

use super::postgres::{
    PreparedReplayMarketFactsStorageV2, persist_replay_market_facts_in_transaction_v2,
    store_generation_identity_for_test,
};
use crate::owner::postgres::MarketDataOwnerPostgres;

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;

    bytes.iter().fold(String::new(), |mut text, byte| {
        write!(text, "{byte:02x}").expect("writing to a String cannot fail");
        text
    })
}

/// Every column the lock function returns, in its declared order, as text.
fn columns(row: &PgRow) -> Vec<(String, String)> {
    row.columns()
        .iter()
        .map(|column| {
            let value = row
                .try_get::<Vec<u8>, _>(column.ordinal())
                .map(|bytes| hex(&bytes))
                .or_else(|_| {
                    row.try_get::<i64, _>(column.ordinal())
                        .map(|value| value.to_string())
                })
                .expect("every column is bytes or a count");
            (column.name().to_owned(), value)
        })
        .collect()
}

async fn scenario() {
    let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
        .expect("explicit disposable Owner URL");
    let database =
        std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").expect("disposable database name");
    assert!(
        database.starts_with("vibe_test_"),
        "this proof writes; it runs only against a disposable database"
    );
    let owner = MarketDataOwnerPostgres::connect(&owner_url)
        .await
        .expect("Owner connects and migrates");
    let (binding, readback) = super::tests::first_corpus_readback(true);
    let prepared = PreparedReplayMarketFactsStorageV2::from_verified_readback(&readback, &binding)
        .expect("bound storage row");
    let mut transaction = owner.pool().begin().await.unwrap();
    persist_replay_market_facts_in_transaction_v2(&mut transaction, &prepared)
        .await
        .unwrap();
    transaction.commit().await.unwrap();

    let mut transaction = owner.pool().begin().await.unwrap();
    let row =
        sqlx::query("SELECT * FROM market_data_rd_api.lock_replay_market_facts_for_replay_v1($1)")
            .bind(binding.record().identity().as_bytes().as_slice())
            .fetch_one(&mut *transaction)
            .await
            .unwrap();
    transaction.rollback().await.unwrap();

    let columns = columns(&row);
    assert_eq!(
        columns
            .iter()
            .map(|(name, _)| name.as_str())
            .collect::<Vec<_>>(),
        V1_COLUMNS,
        "the lock function returns exactly the columns it always did, in order"
    );
    let mut deterministic = Sha256::new();

    for (name, value) in &columns {
        if name == "store_generation_identity" {
            let generation = store_generation_identity_for_test(&database);
            assert_eq!(
                value,
                &hex(&generation),
                "the store generation is the one this database derives"
            );
        } else if !DATABASE_DERIVED.contains(&name.as_str()) {
            deterministic.update(format!("{name} = {value}\n").as_bytes());
        }
    }
    assert_eq!(
        hex(&deterministic.finalize()),
        DETERMINISTIC_COLUMNS_SHA256,
        "every column that does not derive from the database name reads back unchanged"
    );
}

/// The lock function's columns, in its declared order.
const V1_COLUMNS: [&str; 39] = [
    "facts_identity",
    "meaning_identity",
    "composition_binding_identity",
    "request_identity",
    "request_digest",
    "frontier_identity",
    "receipt_identity",
    "universe_selection_identity",
    "universe_selection_digest",
    "joined_cut_identity",
    "joined_cut_digest",
    "sample_projection_identity",
    "sample_projection_digest",
    "facts_bytes",
    "frontier_bytes",
    "receipt_bytes",
    "custody_digest",
    "append_sequence",
    "receipt_facts_identity",
    "receipt_meaning_identity",
    "receipt_append_sequence",
    "receipt_manifest_digest",
    "receipt_custody_digest",
    "outbox_identity",
    "outbox_facts_identity",
    "outbox_receipt_identity",
    "outbox_payload_digest",
    "outbox_payload_bytes",
    "outbox_append_sequence",
    "outbox_manifest_digest",
    "outbox_custody_digest",
    "store_generation_identity",
    "state_append_sequence",
    "fact_count",
    "receipt_count",
    "outbox_count",
    "fact_max_sequence",
    "receipt_max_sequence",
    "outbox_max_sequence",
];

/// Columns derived from the store generation, which derives from the database name. Two fresh
/// databases differ in exactly these, so they are checked by derivation rather than by value.
const DATABASE_DERIVED: [&str; 5] = [
    "store_generation_identity",
    "receipt_manifest_digest",
    "receipt_custody_digest",
    "outbox_manifest_digest",
    "outbox_custody_digest",
];

/// SHA-256 over `name = value` lines of every other column, in order. Read from 0e9f47fe0 in two
/// fresh databases, which agreed on all 34 columns; it must not move while the table and a second
/// lock function change beside this one.
const DETERMINISTIC_COLUMNS_SHA256: &str =
    "3dbf5634ed204f751a24c8b919b57657570f05cbf714b4137318f6a3ba643098";

/// The first corpus reads back through `lock_replay_market_facts_for_replay_v1` unchanged.
///
/// R&D binaries built before the universe-member shape keep calling this function, so neither the
/// table's evolution nor the second shape may change a byte it returns for the first corpus.
#[rstest]
#[ignore = "requires the crates/data disposable PostgreSQL harness"]
fn first_corpus_reads_back_through_the_v1_lock_function_unchanged() {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(scenario());
}
