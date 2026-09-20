//! The ordered-chain proof for Scanner terminal receipt custody.
//!
//! It writes as `scanner_writer` and reads back as `product_edge_owner`, because the point of the
//! `scanner_api` function is that a granted caller who is not the owner gets the receipt. A proof
//! that read back on the writer's own connection would pass whether or not the grant exists.

use sqlx::PgPool;
use vibe_scanner::{
    AttemptId, DueSlotBoundary, LocalDateTime, OpaqueId, ScannerReceipt, Version,
    VersionedIdentity, encode_attempt_id_v1, parse_untrusted_terminal_receipt_v1,
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

use crate::vectors::{CANONICAL_ATTEMPT_KEY_V1_HEX, CANONICAL_RECEIPT_V1_HEX, bytes};
use crate::{
    CommitKindV1, ProductEdgeReceiptReadError, ProductEdgeTerminalReceiptReadSource,
    ScannerTerminalReceiptCustodyV1, TerminalReceiptCustodyError,
};

fn held_receipt() -> ScannerReceipt {
    parse_untrusted_terminal_receipt_v1(&bytes(CANONICAL_RECEIPT_V1_HEX))
        .expect("the canonical vector is a receipt")
}

fn unrelated_attempt() -> AttemptId {
    let identity = |value: &str| VersionedIdentity {
        identity: OpaqueId::new(value).expect("a named identity"),
        version: Version::new(1).expect("a non-zero version"),
    };
    AttemptId {
        definition: identity("scanner-custody-proof-absent-definition"),
        scan_scope: identity("scanner-custody-proof-absent-scope"),
        boundary: DueSlotBoundary::Normal {
            local: LocalDateTime::new(2026, 1, 1, 0, 0, 0).expect("a real local time"),
            utc_offset_seconds: 0,
        },
    }
}

/// Rows this proof is responsible for, counted by its own keys rather than by the whole table.
///
/// The chain shares one database and is never reset, so a global count would report other lanes'
/// rows as this proof's leak. Counting the two keys it writes is the narrower claim it can actually
/// make: it says nothing about the table, and everything about what it left behind.
async fn rows_for_proof_keys(pool: &PgPool, keys: &[Vec<u8>]) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(
        "SELECT COUNT(*) FROM scanner_private.terminal_receipts_v1 WHERE attempt_key = ANY($1)"
            .to_owned(),
    ))
    .bind(keys)
    .fetch_one(pool)
    .await
    .expect("counting this proof's own keys")
}

#[tokio::test]
#[ignore = "requires admitted Scanner and Product Edge PostgreSQL test URLs"]
async fn terminal_receipt_custody_commits_joins_refuses_and_reads_back_to_product_edge() {
    let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
    let writer_url = test_database.database_url(CanonicalOwnerTestRoleV1::ScannerWriter);
    let reader_url = test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
    ScannerTerminalReceiptCustodyV1::materialize_schema(writer_url)
        .await
        .expect("scanner_writer materializes its own custody");
    let writer = ScannerTerminalReceiptCustodyV1::connect(writer_url)
        .await
        .expect("scanner_writer reaches its custody");
    let reader_store = ScannerTerminalReceiptCustodyV1::connect(reader_url)
        .await
        .expect("product_edge_owner reaches the granted read function");

    let receipt = held_receipt();
    let key = encode_attempt_id_v1(receipt.attempt_id()).expect("the attempt encodes");
    assert_eq!(
        key,
        bytes(CANONICAL_ATTEMPT_KEY_V1_HEX),
        "the custody key is a pure function of the attempt, and this vector pins it"
    );
    let corrupt_key = encode_attempt_id_v1(&unrelated_attempt()).expect("the attempt encodes");
    let audit = PgPool::connect(writer_url)
        .await
        .expect("an audit connection");
    let owned_keys = vec![key.clone(), corrupt_key.clone()];
    let before = rows_for_proof_keys(&audit, &owned_keys).await;
    assert_eq!(before, 0, "this proof starts owning no rows");

    // One receipt commits once.
    assert_eq!(
        writer.commit_or_join_receipt(&receipt).await.unwrap(),
        CommitKindV1::Committed
    );
    // The same receipt joins rather than committing twice, and joining is decided by the bytes
    // that are stored, not by which writer arrived first.
    assert_eq!(
        writer.commit_or_join_receipt(&receipt).await.unwrap(),
        CommitKindV1::Joined
    );

    // Product Edge reads it back on its own connection. This is the assertion the grant exists
    // for: the same call on the writer's connection would pass without any grant at all.
    let read = reader_store
        .product_edge_terminal_receipts()
        .read(receipt.attempt_id())
        .await
        .expect("the granted caller reads the Scanner-owned receipt");
    assert_eq!(read, receipt, "the readback is the receipt, whole");

    // An attempt custody never held is absent, not a fault.
    let absent = reader_store
        .product_edge_terminal_receipts()
        .read(&unrelated_attempt())
        .await
        .expect_err("custody holds nothing for that attempt");
    assert!(matches!(
        absent,
        ProductEdgeReceiptReadError::NotFound { .. }
    ));

    // A row that is not a receipt is a detected custody fault, never absence. Before the parser
    // existed nothing could produce this outcome on the read path: a primary key cannot hold two
    // disagreeing rows, and a commit conflict is a write-time result rather than stored state.
    sqlx::query(sqlx::AssertSqlSafe(
        "INSERT INTO scanner_private.terminal_receipts_v1 (attempt_key, canonical_bytes) \
         VALUES ($1,$2)"
            .to_owned(),
    ))
    .bind(&corrupt_key)
    .bind(b"this is not a canonical Scanner receipt".to_vec())
    .execute(&audit)
    .await
    .expect("the writer may place a row under its own key");
    let fault = reader_store
        .product_edge_terminal_receipts()
        .read(&unrelated_attempt())
        .await
        .expect_err("bytes that do not reconstruct are a custody fault");
    assert!(
        matches!(
            fault,
            ProductEdgeReceiptReadError::StoreSemanticConflict { .. }
        ),
        "a held row that is not a receipt must not read as an absent one, found {fault:?}"
    );

    // Offering a different receipt for an attempt custody already holds is refused, not overwritten.
    let conflicting = ScannerTerminalReceiptCustodyV1::connect(writer_url)
        .await
        .expect("a second writer connection");
    sqlx::query(sqlx::AssertSqlSafe(
        "UPDATE scanner_private.terminal_receipts_v1 SET canonical_bytes = $2 \
         WHERE attempt_key = $1"
            .to_owned(),
    ))
    .bind(&key)
    .bind(b"a different receipt for the same attempt".to_vec())
    .execute(&audit)
    .await
    .expect("the writer may tamper with its own row");
    assert!(
        matches!(
            conflicting.commit_or_join_receipt(&receipt).await,
            Err(TerminalReceiptCustodyError::ConflictingReceipt { .. })
        ),
        "custody refuses to replace a receipt it already holds"
    );

    // Clean up exactly the two keys this proof wrote, and prove it by the same count it opened with.
    sqlx::query(sqlx::AssertSqlSafe(
        "DELETE FROM scanner_private.terminal_receipts_v1 WHERE attempt_key = ANY($1)".to_owned(),
    ))
    .bind(&owned_keys)
    .execute(&audit)
    .await
    .expect("this proof removes what it wrote");
    let after = rows_for_proof_keys(&audit, &owned_keys).await;
    assert_eq!(
        after, before,
        "the chain is never reset, so this proof has to leave its own keys as it found them"
    );
    audit.close().await;
}

#[tokio::test]
#[ignore = "requires admitted Scanner and Product Edge PostgreSQL test URLs"]
async fn a_caller_without_the_grant_is_refused_rather_than_answered_empty() {
    let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
    let writer_url = test_database.database_url(CanonicalOwnerTestRoleV1::ScannerWriter);
    ScannerTerminalReceiptCustodyV1::materialize_schema(writer_url)
        .await
        .expect("scanner_writer materializes its own custody");

    // `rd_owner` holds no grant on `scanner_api`. The refusal has to be a refusal: an empty answer
    // would be indistinguishable from an attempt that never scanned, which is the shape
    // `docs/owners/runtime.md` records against `market_data_rd_api`'s twelve functions, where the
    // predicate lives in the function body instead of in the grant.
    let ungranted = ScannerTerminalReceiptCustodyV1::connect(
        test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
    )
    .await
    .expect("rd_owner can reach the database itself");
    let refusal = ungranted
        .find_receipt(&unrelated_attempt())
        .await
        .expect_err("a caller without the grant is refused");
    assert!(
        matches!(refusal, TerminalReceiptCustodyError::Unavailable { .. }),
        "an ungranted caller must be refused, not handed an empty result, found {refusal:?}"
    );
}
