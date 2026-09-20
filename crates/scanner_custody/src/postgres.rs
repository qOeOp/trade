//! The Scanner-owned PostgreSQL custody for terminal receipts.
//!
//! Receipts are held as the canonical bytes `vibe_scanner`'s codec produces, keyed by the canonical
//! encoding of the attempt identity. The bytes are the record: a stored row is meaningful only
//! because `parse_untrusted_terminal_receipt_v1` will refuse anything that is not a receipt, so
//! custody stores no second projection that could disagree with them.
//!
//! Product Edge reads through `scanner_api.read_terminal_receipt_v1`, a `SECURITY DEFINER` function
//! owned by `scanner_owner`. Its body filters on the requested key and on nothing else: a body that
//! also pinned `session_user` would hand a granted caller an empty result rather than a refusal,
//! which is the shape `docs/owners/runtime.md` records against `market_data_rd_api`'s twelve
//! functions. The function returns the stored key beside the bytes so a caller can see that the
//! store honoured its own predicate before it spends anything parsing.

use sqlx::{PgPool, Row};
use vibe_scanner::{
    AttemptId, CommitKind, CommitOutcome, OpaqueId, ReceiptStoreError, ScannerReceipt,
    TerminalReceiptDecodeError, TerminalReceiptStore, encode_attempt_id_v1,
    encode_terminal_receipt_v1, parse_untrusted_terminal_receipt_v1,
};

use crate::{ProductEdgeTerminalReceiptReadSource, sealed};

/// Every statement here is built from this module's own constants; no caller value reaches the SQL
/// text, which is why asserting safety is a statement about this file rather than about a caller.
fn sql(text: String) -> sqlx::AssertSqlSafe<String> {
    sqlx::AssertSqlSafe(text)
}

#[cfg(test)]
mod chain_proofs;

const RECEIPTS_TABLE: &str = "scanner_private.terminal_receipts_v1";
const READ_FUNCTION: &str = "scanner_api.read_terminal_receipt_v1";

/// Why custody could not answer, before the answer is translated into a port refusal.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TerminalReceiptCustodyError {
    /// The store did not answer: no connection, no permission, or a failed statement.
    Unavailable { evidence: OpaqueId },
    /// The store answered, and what it holds for that attempt is not a receipt.
    ///
    /// This is the only producer of a detected custody fault on the read path. A row exists, so it
    /// is not absence; nothing parsed, so there is no returned identity to conflict with; the store
    /// answered, so it is not unavailable.
    NotAReceipt {
        attempt_id: Box<AttemptId>,
        refusal: TerminalReceiptDecodeError,
    },
    /// The store holds a different receipt for that attempt than the one offered.
    ConflictingReceipt { attempt_id: Box<AttemptId> },
    /// A receipt this build cannot write as canonical bytes.
    Unencodable { attempt_id: Box<AttemptId> },
}

fn unavailable(reason: &str) -> TerminalReceiptCustodyError {
    TerminalReceiptCustodyError::Unavailable {
        evidence: OpaqueId::new(format!("scanner-custody:{reason}"))
            .unwrap_or_else(|_| unreachable!("a non-empty literal is a usable identity")),
    }
}

/// One PostgreSQL custody over `scanner_private`, read through `scanner_api`.
#[derive(Clone, Debug)]
pub struct ScannerTerminalReceiptCustodyV1 {
    pool: PgPool,
}

impl ScannerTerminalReceiptCustodyV1 {
    /// Connects to an already-materialized custody.
    ///
    /// # Errors
    ///
    /// Returns [`TerminalReceiptCustodyError::Unavailable`] when the connection cannot be made.
    pub async fn connect(database_url: &str) -> Result<Self, TerminalReceiptCustodyError> {
        let pool = PgPool::connect(database_url)
            .await
            .map_err(|_| unavailable("connect"))?;
        Ok(Self { pool })
    }

    /// Creates the custody relation and the one read function Product Edge is granted.
    ///
    /// The `GRANT EXECUTE` sits on the statement after the `CREATE FUNCTION` deliberately. A grant
    /// on a routine that does not exist yet aborts the transaction that carries it, so the grant
    /// and its target have to land together; guarding it instead would turn "the function failed to
    /// build" into "the grant was skipped", and the two look identical afterwards.
    ///
    /// # Errors
    ///
    /// Returns [`TerminalReceiptCustodyError::Unavailable`] when any statement fails.
    pub async fn materialize_schema(database_url: &str) -> Result<(), TerminalReceiptCustodyError> {
        let pool = PgPool::connect(database_url)
            .await
            .map_err(|_| unavailable("materialize-connect"))?;
        let statements = [
            format!(
                "CREATE TABLE IF NOT EXISTS {RECEIPTS_TABLE} (\
                 attempt_key BYTEA PRIMARY KEY,\
                 canonical_bytes BYTEA NOT NULL,\
                 committed_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            ),
            format!(
                "CREATE OR REPLACE FUNCTION {READ_FUNCTION}(p_attempt_key BYTEA) \
                 RETURNS TABLE(attempt_key BYTEA, canonical_bytes BYTEA) \
                 LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ \
                 SELECT r.attempt_key, r.canonical_bytes FROM {RECEIPTS_TABLE} r \
                 WHERE r.attempt_key = p_attempt_key $function$"
            ),
            format!("GRANT EXECUTE ON FUNCTION {READ_FUNCTION}(BYTEA) TO product_edge_owner"),
        ];

        for statement in statements {
            sqlx::query(sql(statement))
                .execute(&pool)
                .await
                .map_err(|_| unavailable("materialize"))?;
        }
        pool.close().await;
        Ok(())
    }

    /// Reads back the one receipt held for that attempt.
    ///
    /// # Errors
    ///
    /// Returns [`TerminalReceiptCustodyError::Unavailable`] when the store cannot answer, and
    /// [`TerminalReceiptCustodyError::NotAReceipt`] when it answers with bytes that do not
    /// reconstruct.
    pub async fn find_receipt(
        &self,
        attempt_id: &AttemptId,
    ) -> Result<Option<ScannerReceipt>, TerminalReceiptCustodyError> {
        let key = encode_attempt_id_v1(attempt_id).map_err(|_| unavailable("attempt-key"))?;
        let row = sqlx::query(sql(format!(
            "SELECT attempt_key, canonical_bytes FROM {READ_FUNCTION}($1)"
        )))
        .bind(&key)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| unavailable("read"))?;
        let Some(row) = row else {
            return Ok(None);
        };
        let stored_key: Vec<u8> = row
            .try_get("attempt_key")
            .map_err(|_| unavailable("column"))?;

        if stored_key != key {
            // The function answered with a row it was not asked for. Nothing is parsed yet, so the
            // identity a conflict would name is the store's own, not the receipt's.
            return Err(TerminalReceiptCustodyError::NotAReceipt {
                attempt_id: Box::new(attempt_id.clone()),
                refusal: TerminalReceiptDecodeError::NonCanonical {
                    field: "attempt_key",
                },
            });
        }
        let bytes: Vec<u8> = row
            .try_get("canonical_bytes")
            .map_err(|_| unavailable("column"))?;
        parse_untrusted_terminal_receipt_v1(&bytes)
            .map(Some)
            .map_err(|refusal| TerminalReceiptCustodyError::NotAReceipt {
                attempt_id: Box::new(attempt_id.clone()),
                refusal,
            })
    }

    /// Commits the first receipt for an attempt, joins an identical one, and refuses a different one.
    ///
    /// Equality is byte equality of the canonical encoding, which is exact because one receipt has
    /// exactly one encoding. A second writer racing the first loses the primary key and then reads
    /// the winner's bytes, so the join is decided by what is stored rather than by who arrived
    /// first.
    ///
    /// # Errors
    ///
    /// Returns [`TerminalReceiptCustodyError::ConflictingReceipt`] when a different receipt is held
    /// for that attempt, and [`TerminalReceiptCustodyError::Unavailable`] when the store cannot
    /// answer.
    pub async fn commit_or_join_receipt(
        &self,
        receipt: &ScannerReceipt,
    ) -> Result<CommitKindV1, TerminalReceiptCustodyError> {
        let attempt_id = receipt.attempt_id();
        let key = encode_attempt_id_v1(attempt_id).map_err(|_| unavailable("attempt-key"))?;
        let bytes = encode_terminal_receipt_v1(receipt).map_err(|_| {
            TerminalReceiptCustodyError::Unencodable {
                attempt_id: Box::new(attempt_id.clone()),
            }
        })?;
        let inserted = sqlx::query(sql(format!(
            "INSERT INTO {RECEIPTS_TABLE} (attempt_key, canonical_bytes) VALUES ($1,$2) \
             ON CONFLICT (attempt_key) DO NOTHING"
        )))
        .bind(&key)
        .bind(&bytes)
        .execute(&self.pool)
        .await
        .map_err(|_| unavailable("commit"))?
        .rows_affected();

        if inserted == 1 {
            return Ok(CommitKindV1::Committed);
        }
        let stored: Vec<u8> = sqlx::query_scalar(sql(format!(
            "SELECT canonical_bytes FROM {RECEIPTS_TABLE} WHERE attempt_key = $1"
        )))
        .bind(&key)
        .fetch_one(&self.pool)
        .await
        .map_err(|_| unavailable("commit-readback"))?;

        if stored == bytes {
            Ok(CommitKindV1::Joined)
        } else {
            Err(TerminalReceiptCustodyError::ConflictingReceipt {
                attempt_id: Box::new(attempt_id.clone()),
            })
        }
    }
}

/// Whether custody took the receipt or found the same one already held.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommitKindV1 {
    Committed,
    Joined,
}

impl From<TerminalReceiptCustodyError> for ReceiptStoreError {
    /// Translates a custody answer into the port's two refusals.
    ///
    /// Every decode refusal becomes `SemanticConflict` rather than absence: the row exists, so
    /// reporting it as missing would render a detected custody fault as "this attempt never
    /// scanned", which is the one reading `docs/owners/scanner.md` forbids. It is not
    /// `Unavailable` either - the store answered, and pointing an operator at the connection
    /// would send them to infrastructure that is working.
    fn from(error: TerminalReceiptCustodyError) -> Self {
        match error {
            TerminalReceiptCustodyError::Unavailable { evidence } => Self::Unavailable { evidence },
            TerminalReceiptCustodyError::NotAReceipt { attempt_id, .. }
            | TerminalReceiptCustodyError::ConflictingReceipt { attempt_id }
            | TerminalReceiptCustodyError::Unencodable { attempt_id } => Self::SemanticConflict {
                attempt_id: *attempt_id,
            },
        }
    }
}

impl TerminalReceiptStore for ScannerTerminalReceiptCustodyV1 {
    async fn find(
        &self,
        attempt_id: &AttemptId,
    ) -> Result<Option<ScannerReceipt>, ReceiptStoreError> {
        self.find_receipt(attempt_id).await.map_err(Into::into)
    }

    async fn commit_or_join(
        &self,
        receipt: ScannerReceipt,
    ) -> Result<CommitOutcome, ReceiptStoreError> {
        let kind = match self.commit_or_join_receipt(&receipt).await? {
            CommitKindV1::Committed => CommitKind::Committed,
            CommitKindV1::Joined => CommitKind::Joined,
        };
        Ok(CommitOutcome { kind, receipt })
    }
}

impl sealed::ScannerOwnedTerminalReceiptStore for ScannerTerminalReceiptCustodyV1 {}
impl ProductEdgeTerminalReceiptReadSource for ScannerTerminalReceiptCustodyV1 {}
