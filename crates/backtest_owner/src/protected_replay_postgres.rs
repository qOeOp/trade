//! Atomic Backtest custody for Qualification-only protected replay results.

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use vibe_backtest_owner_contracts::{
    ProtectedReplayAttemptFrontierDtoV1, ProtectedReplayAttemptFrontierLocatorV1,
    ProtectedReplayAttemptFrontierOutboxDtoV1, ProtectedReplayAttemptFrontierReceiptDtoV1,
    ProtectedReplayRequestDtoV1, ProtectedReplayRequestDtoV2, ProtectedReplayRequestLocatorV1,
    ProtectedReplayRequestSetLocatorV1, ProtectedReplayRequestSetSealDtoV1,
    ProtectedReplayResultDtoV1, ProtectedReplayResultDtoV2, ProtectedReplayResultDtoV3,
    protected_replay_attempt_frontier_custody_wires_v1, protected_result_custody_wires_v1,
    protected_result_custody_wires_v2, protected_result_custody_wires_v3,
};
use vibe_backtest_result_custody::validate_protected_replay_result_writer_topology_v1;

use crate::{
    ProtectedReplayResultProposalV3, ResolvedProtectedReplayRequestSetV1,
    SealedProtectedReplayResultV1, SealedProtectedReplayResultV2, SealedProtectedReplayResultV3,
    postgres::{PostgresReplayResultOwnerErrorV2, PostgresReplayResultOwnerV2},
    protected_replay::commit_protected_owner_result_proposal_v3,
};

const RESULT_STORAGE_DOMAIN: &str = "vibe.backtest.protected-replay-result-storage.v1";
const RECEIPT_STORAGE_DOMAIN: &str = "vibe.backtest.protected-result-receipt-storage.v1";
const OUTBOX_STORAGE_DOMAIN: &str = "vibe.backtest.protected-result-outbox-storage.v1";
const ATTEMPT_LOCK_DOMAIN: &str = "vibe.backtest.protected-result-attempt-lock.v1";
const QUALIFICATION_REQUEST_STORAGE_DOMAIN: &str =
    "qualification.protected-replay-request.storage.v1";
const QUALIFICATION_RECEIPT_STORAGE_DOMAIN: &str =
    "qualification.protected-replay-request-receipt.storage.v1";
const QUALIFICATION_SEAL_DOMAIN: &str = "qualification.protected-replay-request-seal.v1";
const QUALIFICATION_RECEIPT_DOMAIN: &str = "qualification.protected-replay-request-receipt.v1";
const QUALIFICATION_EVENT_DOMAIN: &str = "qualification.protected-replay-request-frozen-event.v1";
const QUALIFICATION_REQUEST_SET_STORAGE_DOMAIN: &str =
    "qualification.protected-replay-request-set.storage.v1";
const QUALIFICATION_REQUEST_SET_EVENT_DOMAIN: &str =
    "qualification.protected-replay-request-set-sealed-event.v1";
const FRONTIER_STORAGE_DOMAIN: &str = "vibe.backtest.protected-attempt-frontier-storage.v1";
const FRONTIER_RECEIPT_STORAGE_DOMAIN: &str =
    "vibe.backtest.protected-attempt-frontier-receipt-storage.v1";
const FRONTIER_OUTBOX_STORAGE_DOMAIN: &str =
    "vibe.backtest.protected-attempt-frontier-outbox-storage.v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtectedReplayResultReadbackV1 {
    result: ProtectedReplayResultDtoV1,
    result_canonical_bytes: Vec<u8>,
    receipt_canonical_bytes: Vec<u8>,
    outbox_canonical_bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtectedReplayResultReadbackV2 {
    result: ProtectedReplayResultDtoV2,
    result_canonical_bytes: Vec<u8>,
    receipt_canonical_bytes: Vec<u8>,
    outbox_canonical_bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtectedReplayResultReadbackV3 {
    result: ProtectedReplayResultDtoV3,
    result_canonical_bytes: Vec<u8>,
    receipt_canonical_bytes: Vec<u8>,
    outbox_canonical_bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtectedReplayAttemptFrontierReadbackV1 {
    frontier: ProtectedReplayAttemptFrontierDtoV1,
    receipt: ProtectedReplayAttemptFrontierReceiptDtoV1,
    frontier_canonical_bytes: Vec<u8>,
    receipt_canonical_bytes: Vec<u8>,
    outbox_canonical_bytes: Vec<u8>,
}

impl ProtectedReplayAttemptFrontierReadbackV1 {
    pub const fn frontier(&self) -> &ProtectedReplayAttemptFrontierDtoV1 {
        &self.frontier
    }
    pub fn frontier_canonical_bytes(&self) -> &[u8] {
        &self.frontier_canonical_bytes
    }
    pub fn receipt_canonical_bytes(&self) -> &[u8] {
        &self.receipt_canonical_bytes
    }
    pub fn outbox_canonical_bytes(&self) -> &[u8] {
        &self.outbox_canonical_bytes
    }
    pub fn locator(&self) -> ProtectedReplayAttemptFrontierLocatorV1 {
        ProtectedReplayAttemptFrontierLocatorV1 {
            frontier_identity: self.frontier.frontier_identity.clone(),
            frontier_digest: self.frontier.frontier_digest.clone(),
            receipt_identity: self.receipt.receipt_identity.clone(),
            receipt_digest: self.receipt.receipt_digest.clone(),
        }
    }
}

impl ProtectedReplayResultReadbackV3 {
    pub const fn result(&self) -> &ProtectedReplayResultDtoV3 {
        &self.result
    }
    pub fn result_canonical_bytes(&self) -> &[u8] {
        &self.result_canonical_bytes
    }
    pub fn receipt_canonical_bytes(&self) -> &[u8] {
        &self.receipt_canonical_bytes
    }
    pub fn outbox_canonical_bytes(&self) -> &[u8] {
        &self.outbox_canonical_bytes
    }
}

impl ProtectedReplayResultReadbackV2 {
    pub const fn result(&self) -> &ProtectedReplayResultDtoV2 {
        &self.result
    }
    pub fn result_canonical_bytes(&self) -> &[u8] {
        &self.result_canonical_bytes
    }
    pub fn receipt_canonical_bytes(&self) -> &[u8] {
        &self.receipt_canonical_bytes
    }
    pub fn outbox_canonical_bytes(&self) -> &[u8] {
        &self.outbox_canonical_bytes
    }
}

impl ProtectedReplayResultReadbackV1 {
    pub const fn result(&self) -> &ProtectedReplayResultDtoV1 {
        &self.result
    }
    pub fn result_canonical_bytes(&self) -> &[u8] {
        &self.result_canonical_bytes
    }
    pub fn receipt_canonical_bytes(&self) -> &[u8] {
        &self.receipt_canonical_bytes
    }
    pub fn outbox_canonical_bytes(&self) -> &[u8] {
        &self.outbox_canonical_bytes
    }
}

pub enum ProtectedReplayResultCommitDispositionV1 {
    Committed(Box<ProtectedReplayResultReadbackV1>),
    SubmittedOrUnknown(ProtectedReplayResultCommitRecoveryV1),
}

pub enum ProtectedReplayResultCommitDispositionV2 {
    Committed(Box<ProtectedReplayResultReadbackV2>),
    SubmittedOrUnknown(ProtectedReplayResultCommitRecoveryV2),
}

pub enum ProtectedReplayResultCommitDispositionV3 {
    Committed(Box<ProtectedReplayResultReadbackV3>),
    SubmittedOrUnknown(ProtectedReplayResultCommitRecoveryV3),
}

pub enum ProtectedReplayAttemptFrontierCommitDispositionV1 {
    Committed(Box<ProtectedReplayAttemptFrontierReadbackV1>),
    SubmittedOrUnknown(ProtectedReplayAttemptFrontierCommitRecoveryV1),
}

pub struct ProtectedReplayAttemptFrontierCommitRecoveryV1 {
    frontier_identity: String,
    request_set_identity: String,
    expected_frontier_bytes: Vec<u8>,
}

impl ProtectedReplayAttemptFrontierCommitRecoveryV1 {
    pub async fn resolve(
        &self,
        owner: &PostgresReplayResultOwnerV2,
    ) -> Result<Option<ProtectedReplayAttemptFrontierReadbackV1>, PostgresReplayResultOwnerErrorV2>
    {
        let mut transaction = owner
            .pool
            .begin()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        let readback = read_exact_frontier(
            &mut transaction,
            &self.frontier_identity,
            &self.request_set_identity,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        Ok(readback.filter(|value| value.frontier_canonical_bytes == self.expected_frontier_bytes))
    }
}

pub struct ProtectedReplayResultCommitRecoveryV3 {
    result_identity: String,
    request_identity: String,
    attempt_identity: String,
    expected_result_bytes: Vec<u8>,
}

impl ProtectedReplayResultCommitRecoveryV3 {
    pub async fn resolve(
        &self,
        owner: &PostgresReplayResultOwnerV2,
    ) -> Result<Option<ProtectedReplayResultReadbackV3>, PostgresReplayResultOwnerErrorV2> {
        let mut transaction = owner
            .pool
            .begin()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        validate_protected_replay_result_writer_topology_v1(&mut transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
        let readback = read_exact_v3(
            &mut transaction,
            &self.result_identity,
            &self.request_identity,
            &self.attempt_identity,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        Ok(readback.filter(|value| value.result_canonical_bytes == self.expected_result_bytes))
    }
}

pub struct ProtectedReplayResultCommitRecoveryV2 {
    result_identity: String,
    request_identity: String,
    attempt_identity: String,
    expected_result_bytes: Vec<u8>,
}

impl ProtectedReplayResultCommitRecoveryV2 {
    pub async fn resolve(
        &self,
        owner: &PostgresReplayResultOwnerV2,
    ) -> Result<Option<ProtectedReplayResultReadbackV2>, PostgresReplayResultOwnerErrorV2> {
        let mut transaction = owner
            .pool
            .begin()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        validate_protected_replay_result_writer_topology_v1(&mut transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
        let readback = read_exact_v2(
            &mut transaction,
            &self.result_identity,
            &self.request_identity,
            &self.attempt_identity,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        Ok(readback.filter(|value| value.result_canonical_bytes == self.expected_result_bytes))
    }
}

pub struct ProtectedReplayResultCommitRecoveryV1 {
    result_identity: String,
    request_identity: String,
    attempt_identity: String,
    expected_result_bytes: Vec<u8>,
}

impl ProtectedReplayResultCommitRecoveryV1 {
    pub async fn resolve(
        &self,
        owner: &PostgresReplayResultOwnerV2,
    ) -> Result<Option<ProtectedReplayResultReadbackV1>, PostgresReplayResultOwnerErrorV2> {
        let mut transaction = owner
            .pool
            .begin()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        validate_protected_replay_result_writer_topology_v1(&mut transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
        let readback = read_exact(
            &mut transaction,
            &self.result_identity,
            &self.request_identity,
            &self.attempt_identity,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        Ok(readback.filter(|value| value.result_canonical_bytes == self.expected_result_bytes))
    }
}

impl PostgresReplayResultOwnerV2 {
    /// Resolves and verifies Qualification's immutable complete request-set envelope.
    pub async fn resolve_protected_replay_request_set_v1(
        &self,
        qualification_pool: &sqlx::PgPool,
        locator: &ProtectedReplayRequestSetLocatorV1,
    ) -> Result<ResolvedProtectedReplayRequestSetV1, PostgresReplayResultOwnerErrorV2> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
        validate_cross_owner_binding(qualification_pool, &mut transaction).await?;
        let request_set = lock_qualification_request_set(&mut transaction, locator).await?;
        transaction
            .commit()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        Ok(ResolvedProtectedReplayRequestSetV1::new(request_set))
    }

    /// Atomically freezes every terminal V3 result for a complete Qualification request set.
    pub async fn close_protected_replay_attempt_frontier_v1(
        &self,
        qualification_pool: &sqlx::PgPool,
        locator: &ProtectedReplayRequestSetLocatorV1,
    ) -> Result<ProtectedReplayAttemptFrontierCommitDispositionV1, PostgresReplayResultOwnerErrorV2>
    {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
        validate_cross_owner_binding(qualification_pool, &mut transaction).await?;
        let request_set = lock_qualification_request_set(&mut transaction, locator).await?;
        lock_plan_cell_set_fence(&mut transaction, &request_set.plan_cell_set_identity).await?;

        if let Some(existing) =
            read_frontier_for_request_set(&mut transaction, &request_set.request_set_identity)
                .await?
        {
            existing
                .frontier
                .validate_against_request_set(&request_set)
                .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
            transaction
                .commit()
                .await
                .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
            return Ok(
                ProtectedReplayAttemptFrontierCommitDispositionV1::Committed(Box::new(existing)),
            );
        }

        let mut results = Vec::new();

        for member in &request_set.members {
            let request_locator = ProtectedReplayRequestLocatorV1 {
                request_identity: member.request_identity.clone(),
                request_digest: member.request_digest.clone(),
                receipt_identity: member.request_receipt_identity.clone(),
                seal_digest: member.request_seal_digest.clone(),
            };
            let request = lock_qualification_request_v2(&mut transaction, &request_locator).await?;
            let rows = sqlx::query(
                "SELECT result_identity,attempt_identity \
                   FROM public.backtest_protected_replay_results_v1 \
                  WHERE request_identity=$1 AND request_digest=$2 \
                  ORDER BY attempt_identity,result_identity",
            )
            .bind(&member.request_identity)
            .bind(&member.request_digest)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
            if rows.is_empty() {
                return Err(PostgresReplayResultOwnerErrorV2::ResultNotAdmitted);
            }

            for row in rows {
                let result_identity: String = row
                    .try_get("result_identity")
                    .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
                let attempt_identity: String = row
                    .try_get("attempt_identity")
                    .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
                let readback = read_exact_v3(
                    &mut transaction,
                    &result_identity,
                    &member.request_identity,
                    &attempt_identity,
                )
                .await?
                .ok_or(PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
                readback
                    .result
                    .validate_against_request(&request, &request_locator)
                    .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
                results.push(readback.result);
            }
        }

        if read_frontier_for_request_set(&mut transaction, &request_set.request_set_identity)
            .await?
            .is_some()
        {
            return Err(PostgresReplayResultOwnerErrorV2::ConflictingResult);
        }
        let frontier =
            ProtectedReplayAttemptFrontierDtoV1::from_terminal_results(&request_set, &results)
                .map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?;
        let frontier_bytes = frontier
            .to_canonical_bytes()
            .map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?;
        let frontier_json = serde_json::to_value(&frontier)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?;
        let committed_at_epoch_ms: i64 = sqlx::query_scalar(
            "SELECT (EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())*1000)::bigint",
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        let committed_at_epoch_ms = u64::try_from(committed_at_epoch_ms)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        let (receipt, receipt_bytes, outbox, outbox_bytes) =
            protected_replay_attempt_frontier_custody_wires_v1(&frontier, committed_at_epoch_ms)
                .map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?;

        sqlx::query(
            "INSERT INTO public.backtest_protected_replay_attempt_frontiers_v1 \
             (frontier_identity,frontier_digest,request_set_identity,request_set_digest,\
              plan_cell_set_identity,plan_cell_set_digest,frontier_json,canonical_frontier_bytes,\
              storage_digest,committed_at_epoch_ms) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(&frontier.frontier_identity)
        .bind(&frontier.frontier_digest)
        .bind(&frontier.request_set_identity)
        .bind(&frontier.request_set_digest)
        .bind(&frontier.plan_cell_set_identity)
        .bind(&frontier.plan_cell_set_digest)
        .bind(&frontier_json)
        .bind(&frontier_bytes)
        .bind(storage_digest(FRONTIER_STORAGE_DOMAIN, &frontier_bytes))
        .bind(
            i64::try_from(committed_at_epoch_ms)
                .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?,
        )
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        sqlx::query(
            "INSERT INTO public.backtest_protected_replay_attempt_frontier_receipts_v1 \
             (frontier_identity,receipt_identity,receipt_digest,frontier_digest,request_set_identity,\
              request_set_digest,outbox_event_identity,committed_at_epoch_ms,canonical_bytes,storage_digest) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(&frontier.frontier_identity)
        .bind(&receipt.receipt_identity)
        .bind(&receipt.receipt_digest)
        .bind(&frontier.frontier_digest)
        .bind(&frontier.request_set_identity)
        .bind(&frontier.request_set_digest)
        .bind(&receipt.outbox_event_identity)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?)
        .bind(&receipt_bytes)
        .bind(storage_digest(FRONTIER_RECEIPT_STORAGE_DOMAIN, &receipt_bytes))
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        sqlx::query(
            "INSERT INTO public.backtest_protected_replay_attempt_frontier_outbox_v1 \
             (frontier_identity,event_identity,event_digest,receipt_identity,frontier_digest,\
              request_set_identity,request_set_digest,payload_digest,committed_at_epoch_ms,\
              canonical_bytes,storage_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        )
        .bind(&frontier.frontier_identity)
        .bind(&outbox.event_identity)
        .bind(&outbox.event_digest)
        .bind(&receipt.receipt_identity)
        .bind(&frontier.frontier_digest)
        .bind(&frontier.request_set_identity)
        .bind(&frontier.request_set_digest)
        .bind(&outbox.payload_digest)
        .bind(
            i64::try_from(committed_at_epoch_ms)
                .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?,
        )
        .bind(&outbox_bytes)
        .bind(storage_digest(
            FRONTIER_OUTBOX_STORAGE_DOMAIN,
            &outbox_bytes,
        ))
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;

        let readback = read_exact_frontier(
            &mut transaction,
            &frontier.frontier_identity,
            &frontier.request_set_identity,
        )
        .await?
        .ok_or(PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
        let recovery = ProtectedReplayAttemptFrontierCommitRecoveryV1 {
            frontier_identity: frontier.frontier_identity,
            request_set_identity: frontier.request_set_identity,
            expected_frontier_bytes: frontier_bytes,
        };

        match transaction.commit().await {
            Ok(()) => Ok(
                ProtectedReplayAttemptFrontierCommitDispositionV1::Committed(Box::new(readback)),
            ),
            Err(_) => {
                Ok(ProtectedReplayAttemptFrontierCommitDispositionV1::SubmittedOrUnknown(recovery))
            }
        }
    }

    /// Locks the sealed Qualification request, constructs V3 inside Backtest, and commits it through
    /// the request-bound atomic custody path. Callers never receive a constructible sealed result.
    pub async fn produce_and_commit_protected_replay_result_v3(
        &self,
        qualification_pool: &sqlx::PgPool,
        locator: &ProtectedReplayRequestLocatorV1,
        proposal: ProtectedReplayResultProposalV3,
    ) -> Result<ProtectedReplayResultCommitDispositionV3, PostgresReplayResultOwnerErrorV2> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
        validate_cross_owner_binding(qualification_pool, &mut transaction).await?;
        validate_protected_replay_result_writer_topology_v1(&mut transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
        let request = lock_qualification_request_v2(&mut transaction, locator).await?;
        let sealed = commit_protected_owner_result_proposal_v3(&request, locator, proposal)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?;
        transaction
            .rollback()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        self.commit_request_bound_protected_replay_result_v3(qualification_pool, locator, &sealed)
            .await
    }

    /// Commits one Backtest-sealed protected Result only while the exact Qualification request is
    /// locked in the same physical database and transaction.
    pub async fn commit_request_bound_protected_replay_result_v1(
        &self,
        qualification_pool: &sqlx::PgPool,
        locator: &ProtectedReplayRequestLocatorV1,
        result: &SealedProtectedReplayResultV1,
    ) -> Result<ProtectedReplayResultCommitDispositionV1, PostgresReplayResultOwnerErrorV2> {
        let result_bytes = result
            .to_canonical_bytes()
            .map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?;
        let result_dto = ProtectedReplayResultDtoV1::from_canonical_bytes(&result_bytes)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?;

        if result_dto.request_identity != locator.request_identity
            || result_dto.request_digest != locator.request_digest
            || result_dto.request_receipt_identity != locator.receipt_identity
            || result_dto.request_seal_digest != locator.seal_digest
        {
            return Err(PostgresReplayResultOwnerErrorV2::RequestNotAdmitted);
        }

        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
        validate_cross_owner_binding(qualification_pool, &mut transaction).await?;
        validate_protected_replay_result_writer_topology_v1(&mut transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
        let request = lock_qualification_request(&mut transaction, locator).await?;
        result_dto
            .validate_against_request(&request, locator)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;
        lock_attempt(&mut transaction, &result_dto).await?;

        if let Some(existing) = read_exact(
            &mut transaction,
            &result_dto.result_identity,
            &result_dto.request_identity,
            &result_dto.attempt_identity,
        )
        .await?
        {
            if existing.result_canonical_bytes != result_bytes {
                return Err(PostgresReplayResultOwnerErrorV2::ConflictingResult);
            }
            transaction
                .commit()
                .await
                .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
            return Ok(ProtectedReplayResultCommitDispositionV1::Committed(
                Box::new(existing),
            ));
        }

        let inserted = sqlx::query(
            "INSERT INTO public.backtest_protected_replay_results_v1 \
             (result_identity,result_digest,request_identity,request_digest,request_receipt_identity,request_seal_digest,attempt_identity,terminal,protected_policy_identity,protected_policy_version,protected_plan_identity,protected_plan_digest,plan_cell_identity,plan_cell_digest,canonical_bytes,storage_digest) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT DO NOTHING",
        )
        .bind(&result_dto.result_identity)
        .bind(&result_dto.result_digest)
        .bind(&result_dto.request_identity)
        .bind(&result_dto.request_digest)
        .bind(&result_dto.request_receipt_identity)
        .bind(&result_dto.request_seal_digest)
        .bind(&result_dto.attempt_identity)
        .bind(terminal_text(result_dto.terminal))
        .bind(&result_dto.protected_decision_policy_identity)
        .bind(i64::try_from(result_dto.protected_decision_policy_version).map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?)
        .bind(&result_dto.protected_plan_identity)
        .bind(&result_dto.protected_plan_digest)
        .bind(&result_dto.plan_cell_identity)
        .bind(&result_dto.plan_cell_digest)
        .bind(&result_bytes)
        .bind(storage_digest(RESULT_STORAGE_DOMAIN, &result_bytes))
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        if inserted.rows_affected() != 1 {
            return Err(PostgresReplayResultOwnerErrorV2::ConflictingResult);
        }

        let committed_at_epoch_ms: i64 = sqlx::query_scalar(
            "SELECT (EXTRACT(EPOCH FROM pg_catalog.transaction_timestamp())*1000)::bigint",
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        let committed_at_epoch_ms = u64::try_from(committed_at_epoch_ms)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        let (receipt, receipt_bytes, outbox, outbox_bytes) =
            protected_result_custody_wires_v1(&result_dto, committed_at_epoch_ms)
                .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        sqlx::query(
            "INSERT INTO public.backtest_protected_replay_result_receipts_v1 \
             (result_identity,receipt_identity,receipt_digest,request_identity,request_digest,result_digest,outbox_event_identity,committed_at_epoch_ms,canonical_bytes,storage_digest) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(&result_dto.result_identity)
        .bind(&receipt.receipt_identity)
        .bind(&receipt.receipt_digest)
        .bind(&result_dto.request_identity)
        .bind(&result_dto.request_digest)
        .bind(&result_dto.result_digest)
        .bind(&receipt.outbox_event_identity)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?)
        .bind(&receipt_bytes)
        .bind(storage_digest(RECEIPT_STORAGE_DOMAIN, &receipt_bytes))
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        sqlx::query(
            "INSERT INTO public.backtest_protected_replay_result_outbox_v1 \
             (result_identity,event_identity,event_digest,receipt_identity,request_identity,request_digest,result_digest,payload_digest,committed_at_epoch_ms,canonical_bytes,storage_digest) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        )
        .bind(&result_dto.result_identity)
        .bind(&outbox.event_identity)
        .bind(&outbox.event_digest)
        .bind(&receipt.receipt_identity)
        .bind(&result_dto.request_identity)
        .bind(&result_dto.request_digest)
        .bind(&result_dto.result_digest)
        .bind(&outbox.payload_digest)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?)
        .bind(&outbox_bytes)
        .bind(storage_digest(OUTBOX_STORAGE_DOMAIN, &outbox_bytes))
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        let readback = read_exact(
            &mut transaction,
            &result_dto.result_identity,
            &result_dto.request_identity,
            &result_dto.attempt_identity,
        )
        .await?
        .ok_or(PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
        let recovery = ProtectedReplayResultCommitRecoveryV1 {
            result_identity: result_dto.result_identity,
            request_identity: result_dto.request_identity,
            attempt_identity: result_dto.attempt_identity,
            expected_result_bytes: result_bytes,
        };

        match transaction.commit().await {
            Ok(()) => Ok(ProtectedReplayResultCommitDispositionV1::Committed(
                Box::new(readback),
            )),
            Err(_) => Ok(ProtectedReplayResultCommitDispositionV1::SubmittedOrUnknown(recovery)),
        }
    }

    /// Commits a Backtest-sealed protected V2 Result carrying decisive evidence for every
    /// diagnostic category. V1 custody remains unchanged for prior negative terminals.
    pub async fn commit_request_bound_protected_replay_result_v2(
        &self,
        qualification_pool: &sqlx::PgPool,
        locator: &ProtectedReplayRequestLocatorV1,
        result: &SealedProtectedReplayResultV2,
    ) -> Result<ProtectedReplayResultCommitDispositionV2, PostgresReplayResultOwnerErrorV2> {
        let result_bytes = result
            .to_canonical_bytes()
            .map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?;
        let result_dto = ProtectedReplayResultDtoV2::from_canonical_bytes(&result_bytes)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?;

        if result_dto.request_identity != locator.request_identity
            || result_dto.request_digest != locator.request_digest
            || result_dto.request_receipt_identity != locator.receipt_identity
            || result_dto.request_seal_digest != locator.seal_digest
        {
            return Err(PostgresReplayResultOwnerErrorV2::RequestNotAdmitted);
        }

        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
        validate_cross_owner_binding(qualification_pool, &mut transaction).await?;
        validate_protected_replay_result_writer_topology_v1(&mut transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
        let request = lock_qualification_request(&mut transaction, locator).await?;
        result_dto
            .validate_against_request(&request, locator)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;
        lock_attempt_fields(
            &mut transaction,
            &result_dto.request_identity,
            &result_dto.attempt_identity,
        )
        .await?;

        if let Some(existing) = read_exact_v2(
            &mut transaction,
            &result_dto.result_identity,
            &result_dto.request_identity,
            &result_dto.attempt_identity,
        )
        .await?
        {
            if existing.result_canonical_bytes != result_bytes {
                return Err(PostgresReplayResultOwnerErrorV2::ConflictingResult);
            }
            transaction
                .commit()
                .await
                .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
            return Ok(ProtectedReplayResultCommitDispositionV2::Committed(
                Box::new(existing),
            ));
        }

        let inserted = sqlx::query(
            "INSERT INTO public.backtest_protected_replay_results_v1 \
             (result_identity,result_digest,request_identity,request_digest,request_receipt_identity,request_seal_digest,attempt_identity,terminal,protected_policy_identity,protected_policy_version,protected_plan_identity,protected_plan_digest,plan_cell_identity,plan_cell_digest,canonical_bytes,storage_digest) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT DO NOTHING",
        )
        .bind(&result_dto.result_identity)
        .bind(&result_dto.result_digest)
        .bind(&result_dto.request_identity)
        .bind(&result_dto.request_digest)
        .bind(&result_dto.request_receipt_identity)
        .bind(&result_dto.request_seal_digest)
        .bind(&result_dto.attempt_identity)
        .bind(terminal_text(result_dto.terminal))
        .bind(&result_dto.protected_decision_policy_identity)
        .bind(i64::try_from(result_dto.protected_decision_policy_version).map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?)
        .bind(&result_dto.protected_plan_identity)
        .bind(&result_dto.protected_plan_digest)
        .bind(&result_dto.plan_cell_identity)
        .bind(&result_dto.plan_cell_digest)
        .bind(&result_bytes)
        .bind(storage_digest(RESULT_STORAGE_DOMAIN, &result_bytes))
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        if inserted.rows_affected() != 1 {
            return Err(PostgresReplayResultOwnerErrorV2::ConflictingResult);
        }

        let committed_at_epoch_ms: i64 = sqlx::query_scalar(
            "SELECT (EXTRACT(EPOCH FROM pg_catalog.transaction_timestamp())*1000)::bigint",
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        let committed_at_epoch_ms = u64::try_from(committed_at_epoch_ms)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        let (receipt, receipt_bytes, outbox, outbox_bytes) =
            protected_result_custody_wires_v2(&result_dto, committed_at_epoch_ms)
                .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        sqlx::query(
            "INSERT INTO public.backtest_protected_replay_result_receipts_v1 \
             (result_identity,receipt_identity,receipt_digest,request_identity,request_digest,result_digest,outbox_event_identity,committed_at_epoch_ms,canonical_bytes,storage_digest) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(&result_dto.result_identity)
        .bind(&receipt.receipt_identity)
        .bind(&receipt.receipt_digest)
        .bind(&result_dto.request_identity)
        .bind(&result_dto.request_digest)
        .bind(&result_dto.result_digest)
        .bind(&receipt.outbox_event_identity)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?)
        .bind(&receipt_bytes)
        .bind(storage_digest(RECEIPT_STORAGE_DOMAIN, &receipt_bytes))
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        sqlx::query(
            "INSERT INTO public.backtest_protected_replay_result_outbox_v1 \
             (result_identity,event_identity,event_digest,receipt_identity,request_identity,request_digest,result_digest,payload_digest,committed_at_epoch_ms,canonical_bytes,storage_digest) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        )
        .bind(&result_dto.result_identity)
        .bind(&outbox.event_identity)
        .bind(&outbox.event_digest)
        .bind(&receipt.receipt_identity)
        .bind(&result_dto.request_identity)
        .bind(&result_dto.request_digest)
        .bind(&result_dto.result_digest)
        .bind(&outbox.payload_digest)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?)
        .bind(&outbox_bytes)
        .bind(storage_digest(OUTBOX_STORAGE_DOMAIN, &outbox_bytes))
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        let readback = read_exact_v2(
            &mut transaction,
            &result_dto.result_identity,
            &result_dto.request_identity,
            &result_dto.attempt_identity,
        )
        .await?
        .ok_or(PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
        let recovery = ProtectedReplayResultCommitRecoveryV2 {
            result_identity: result_dto.result_identity,
            request_identity: result_dto.request_identity,
            attempt_identity: result_dto.attempt_identity,
            expected_result_bytes: result_bytes,
        };

        match transaction.commit().await {
            Ok(()) => Ok(ProtectedReplayResultCommitDispositionV2::Committed(
                Box::new(readback),
            )),
            Err(_) => Ok(ProtectedReplayResultCommitDispositionV2::SubmittedOrUnknown(recovery)),
        }
    }

    pub async fn commit_request_bound_protected_replay_result_v3(
        &self,
        qualification_pool: &sqlx::PgPool,
        locator: &ProtectedReplayRequestLocatorV1,
        result: &SealedProtectedReplayResultV3,
    ) -> Result<ProtectedReplayResultCommitDispositionV3, PostgresReplayResultOwnerErrorV2> {
        let result_bytes = result
            .to_canonical_bytes()
            .map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?;
        let result_dto = ProtectedReplayResultDtoV3::from_canonical_bytes(&result_bytes)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?;

        if result_dto.request_identity != locator.request_identity
            || result_dto.request_digest != locator.request_digest
            || result_dto.request_receipt_identity != locator.receipt_identity
            || result_dto.request_seal_digest != locator.seal_digest
        {
            return Err(PostgresReplayResultOwnerErrorV2::RequestNotAdmitted);
        }

        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .execute(&mut *transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
        validate_cross_owner_binding(qualification_pool, &mut transaction).await?;
        validate_protected_replay_result_writer_topology_v1(&mut transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
        let request = lock_qualification_request_v2(&mut transaction, locator).await?;
        result_dto
            .validate_against_request(&request, locator)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;
        lock_attempt_fields(
            &mut transaction,
            &result_dto.request_identity,
            &result_dto.attempt_identity,
        )
        .await?;

        if let Some(existing) = read_exact_v3(
            &mut transaction,
            &result_dto.result_identity,
            &result_dto.request_identity,
            &result_dto.attempt_identity,
        )
        .await?
        {
            if existing.result_canonical_bytes != result_bytes {
                return Err(PostgresReplayResultOwnerErrorV2::ConflictingResult);
            }
            transaction
                .commit()
                .await
                .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
            return Ok(ProtectedReplayResultCommitDispositionV3::Committed(
                Box::new(existing),
            ));
        }

        lock_plan_cell_set_fence(&mut transaction, &result_dto.plan_cell_set_identity).await?;
        let frontier_closed: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 \
               FROM public.backtest_protected_replay_attempt_frontiers_v1 \
              WHERE plan_cell_set_identity=$1)",
        )
        .bind(&result_dto.plan_cell_set_identity)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        if frontier_closed {
            return Err(PostgresReplayResultOwnerErrorV2::ConflictingResult);
        }

        let committed_at_epoch_ms: i64 = sqlx::query_scalar(
            "SELECT (EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())*1000)::bigint",
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        let committed_at_epoch_ms = u64::try_from(committed_at_epoch_ms)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        let (receipt, receipt_bytes, outbox, outbox_bytes) =
            protected_result_custody_wires_v3(&result_dto, committed_at_epoch_ms)
                .map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?;

        let inserted = sqlx::query(
            "INSERT INTO public.backtest_protected_replay_results_v1 \
             (result_identity,result_digest,request_identity,request_digest,request_receipt_identity,request_seal_digest,attempt_identity,terminal,protected_policy_identity,protected_policy_version,protected_plan_identity,protected_plan_digest,plan_cell_identity,plan_cell_digest,canonical_bytes,storage_digest) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT DO NOTHING",
        )
        .bind(&result_dto.result_identity)
        .bind(&result_dto.result_digest)
        .bind(&result_dto.request_identity)
        .bind(&result_dto.request_digest)
        .bind(&result_dto.request_receipt_identity)
        .bind(&result_dto.request_seal_digest)
        .bind(&result_dto.attempt_identity)
        .bind(terminal_text(result_dto.terminal))
        .bind(&result_dto.protected_decision_policy_identity)
        .bind(i64::try_from(result_dto.protected_decision_policy_version).map_err(|_| PostgresReplayResultOwnerErrorV2::ResultNotAdmitted)?)
        .bind(&result_dto.protected_plan_identity)
        .bind(&result_dto.protected_plan_digest)
        .bind(&result_dto.plan_cell_identity)
        .bind(&result_dto.plan_cell_digest)
        .bind(&result_bytes)
        .bind(storage_digest(RESULT_STORAGE_DOMAIN, &result_bytes))
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        if inserted.rows_affected() != 1 {
            return Err(PostgresReplayResultOwnerErrorV2::ConflictingResult);
        }

        sqlx::query(
            "INSERT INTO public.backtest_protected_replay_result_receipts_v1 \
             (result_identity,receipt_identity,receipt_digest,request_identity,request_digest,result_digest,outbox_event_identity,committed_at_epoch_ms,canonical_bytes,storage_digest) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(&result_dto.result_identity)
        .bind(&receipt.receipt_identity)
        .bind(&receipt.receipt_digest)
        .bind(&result_dto.request_identity)
        .bind(&result_dto.request_digest)
        .bind(&result_dto.result_digest)
        .bind(&receipt.outbox_event_identity)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?)
        .bind(&receipt_bytes)
        .bind(storage_digest(RECEIPT_STORAGE_DOMAIN, &receipt_bytes))
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        sqlx::query(
            "INSERT INTO public.backtest_protected_replay_result_outbox_v1 \
             (result_identity,event_identity,event_digest,receipt_identity,request_identity,request_digest,result_digest,payload_digest,committed_at_epoch_ms,canonical_bytes,storage_digest) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        )
        .bind(&result_dto.result_identity)
        .bind(&outbox.event_identity)
        .bind(&outbox.event_digest)
        .bind(&receipt.receipt_identity)
        .bind(&result_dto.request_identity)
        .bind(&result_dto.request_digest)
        .bind(&result_dto.result_digest)
        .bind(&outbox.payload_digest)
        .bind(i64::try_from(committed_at_epoch_ms).map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?)
        .bind(&outbox_bytes)
        .bind(storage_digest(OUTBOX_STORAGE_DOMAIN, &outbox_bytes))
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
        let readback = read_exact_v3(
            &mut transaction,
            &result_dto.result_identity,
            &result_dto.request_identity,
            &result_dto.attempt_identity,
        )
        .await?
        .ok_or(PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
        let recovery = ProtectedReplayResultCommitRecoveryV3 {
            result_identity: result_dto.result_identity,
            request_identity: result_dto.request_identity,
            attempt_identity: result_dto.attempt_identity,
            expected_result_bytes: result_bytes,
        };

        match transaction.commit().await {
            Ok(()) => Ok(ProtectedReplayResultCommitDispositionV3::Committed(
                Box::new(readback),
            )),
            Err(_) => Ok(ProtectedReplayResultCommitDispositionV3::SubmittedOrUnknown(recovery)),
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedQualificationRequestV1 {
    schema_version: u16,
    request: LockedBytesV1,
    receipt: LockedBytesV1,
    outbox: LockedQualificationOutboxV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedBytesV1 {
    bytes_base64: String,
    storage_digest: String,
    mirror: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedQualificationOutboxV1 {
    event_identity: String,
    payload_digest: String,
    payload_json: serde_json::Value,
    committed_at_epoch_ms: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedQualificationRequestSetV1 {
    schema_version: u16,
    seal: LockedBytesV1,
    outbox: LockedQualificationOutboxV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct QualificationRequestReceiptWireV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    request_identity: String,
    request_digest: String,
    seal_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct QualificationRequestOutboxPayloadV1 {
    schema_version: u16,
    request_identity: String,
    request_digest: String,
    receipt_identity: String,
    seal_digest: String,
}

async fn lock_qualification_request(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &ProtectedReplayRequestLocatorV1,
) -> Result<ProtectedReplayRequestDtoV1, PostgresReplayResultOwnerErrorV2> {
    let value: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT qualification_api.lock_protected_replay_request_v1($1,$2,$3,$4)",
    )
    .bind(&locator.request_identity)
    .bind(&locator.request_digest)
    .bind(&locator.receipt_identity)
    .bind(&locator.seal_digest)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
    let locked: LockedQualificationRequestV1 =
        serde_json::from_value(value.ok_or(PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;
    if locked.schema_version != 1 {
        return Err(PostgresReplayResultOwnerErrorV2::RequestNotAdmitted);
    }
    let request_bytes = decode_locked_bytes(&locked.request, QUALIFICATION_REQUEST_STORAGE_DOMAIN)?;
    let receipt_bytes = decode_locked_bytes(&locked.receipt, QUALIFICATION_RECEIPT_STORAGE_DOMAIN)?;
    let request = ProtectedReplayRequestDtoV1::from_canonical_bytes(&request_bytes)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;
    let receipt: QualificationRequestReceiptWireV1 = serde_json::from_slice(&receipt_bytes)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;
    let outbox_payload: QualificationRequestOutboxPayloadV1 =
        serde_json::from_value(locked.outbox.payload_json.clone())
            .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;
    let request_seal_bytes = serde_json::to_vec(&request)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;
    let seal_digest = qualification_digest(QUALIFICATION_SEAL_DOMAIN, &request_seal_bytes)?;
    let committed_at = receipt.committed_at_epoch_ms;
    let receipt_digest = qualification_digest(
        QUALIFICATION_RECEIPT_DOMAIN,
        &(
            &request.request_identity,
            &request.request_digest,
            &seal_digest,
            committed_at,
        ),
    )?;
    let expected_receipt_identity = derived_identity(
        "qualification-protected-replay-request-receipt-v1",
        &receipt_digest,
    )?;
    let payload_digest =
        qualification_digest(QUALIFICATION_EVENT_DOMAIN, &locked.outbox.payload_json)?;
    let expected_event_identity = derived_identity(
        "qualification-protected-replay-request-frozen-event-v1",
        &payload_digest,
    )?;

    if request.request_identity != locator.request_identity
        || request.request_digest != locator.request_digest
        || receipt.schema_version != 1
        || receipt.receipt_identity != locator.receipt_identity
        || receipt.receipt_identity != expected_receipt_identity
        || receipt.receipt_digest != receipt_digest
        || receipt.request_identity != request.request_identity
        || receipt.request_digest != request.request_digest
        || receipt.seal_digest != locator.seal_digest
        || seal_digest != locator.seal_digest
        || locked.outbox.payload_digest != payload_digest
        || locked.outbox.committed_at_epoch_ms != committed_at
        || locked.outbox.event_identity != expected_event_identity
        || outbox_payload.schema_version != 1
        || outbox_payload.request_identity != locator.request_identity
        || outbox_payload.request_digest != locator.request_digest
        || outbox_payload.receipt_identity != locator.receipt_identity
        || outbox_payload.seal_digest != locator.seal_digest
    {
        return Err(PostgresReplayResultOwnerErrorV2::RequestNotAdmitted);
    }
    Ok(request)
}

async fn lock_qualification_request_v2(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &ProtectedReplayRequestLocatorV1,
) -> Result<ProtectedReplayRequestDtoV2, PostgresReplayResultOwnerErrorV2> {
    let value: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT qualification_api.lock_protected_replay_request_v1($1,$2,$3,$4)",
    )
    .bind(&locator.request_identity)
    .bind(&locator.request_digest)
    .bind(&locator.receipt_identity)
    .bind(&locator.seal_digest)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
    let locked: LockedQualificationRequestV1 =
        serde_json::from_value(value.ok_or(PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;
    if locked.schema_version != 1 {
        return Err(PostgresReplayResultOwnerErrorV2::RequestNotAdmitted);
    }
    let request_bytes = decode_locked_bytes(&locked.request, QUALIFICATION_REQUEST_STORAGE_DOMAIN)?;
    let receipt_bytes = decode_locked_bytes(&locked.receipt, QUALIFICATION_RECEIPT_STORAGE_DOMAIN)?;
    let request = ProtectedReplayRequestDtoV2::from_canonical_bytes(&request_bytes)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;
    let receipt: QualificationRequestReceiptWireV1 = serde_json::from_slice(&receipt_bytes)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;
    let outbox_payload: QualificationRequestOutboxPayloadV1 =
        serde_json::from_value(locked.outbox.payload_json.clone())
            .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;
    let request_seal_bytes = serde_json::to_vec(&request)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;
    let seal_digest = qualification_digest(QUALIFICATION_SEAL_DOMAIN, &request_seal_bytes)?;
    let committed_at = receipt.committed_at_epoch_ms;
    let receipt_digest = qualification_digest(
        QUALIFICATION_RECEIPT_DOMAIN,
        &(
            &request.request_identity,
            &request.request_digest,
            &seal_digest,
            committed_at,
        ),
    )?;
    let expected_receipt_identity = derived_identity(
        "qualification-protected-replay-request-receipt-v1",
        &receipt_digest,
    )?;
    let payload_digest =
        qualification_digest(QUALIFICATION_EVENT_DOMAIN, &locked.outbox.payload_json)?;
    let expected_event_identity = derived_identity(
        "qualification-protected-replay-request-frozen-event-v1",
        &payload_digest,
    )?;

    if request.request_identity != locator.request_identity
        || request.request_digest != locator.request_digest
        || receipt.schema_version != 1
        || receipt.receipt_identity != locator.receipt_identity
        || receipt.receipt_identity != expected_receipt_identity
        || receipt.receipt_digest != receipt_digest
        || receipt.request_identity != request.request_identity
        || receipt.request_digest != request.request_digest
        || receipt.seal_digest != locator.seal_digest
        || seal_digest != locator.seal_digest
        || locked.outbox.payload_digest != payload_digest
        || locked.outbox.committed_at_epoch_ms != committed_at
        || locked.outbox.event_identity != expected_event_identity
        || outbox_payload.schema_version != 1
        || outbox_payload.request_identity != locator.request_identity
        || outbox_payload.request_digest != locator.request_digest
        || outbox_payload.receipt_identity != locator.receipt_identity
        || outbox_payload.seal_digest != locator.seal_digest
    {
        return Err(PostgresReplayResultOwnerErrorV2::RequestNotAdmitted);
    }
    Ok(request)
}

async fn lock_qualification_request_set(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &ProtectedReplayRequestSetLocatorV1,
) -> Result<ProtectedReplayRequestSetSealDtoV1, PostgresReplayResultOwnerErrorV2> {
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT qualification_api.lock_protected_replay_request_set_v1($1,$2)")
            .bind(&locator.request_set_identity)
            .bind(&locator.request_set_digest)
            .fetch_one(&mut **transaction)
            .await
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
    let locked: LockedQualificationRequestSetV1 =
        serde_json::from_value(value.ok_or(PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;
    if locked.schema_version != 1 {
        return Err(PostgresReplayResultOwnerErrorV2::RequestNotAdmitted);
    }
    let bytes = decode_locked_bytes(&locked.seal, QUALIFICATION_REQUEST_SET_STORAGE_DOMAIN)?;
    let request_set = ProtectedReplayRequestSetSealDtoV1::from_canonical_bytes(&bytes)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;
    let expected_payload = serde_json::json!({
        "schema_version": 1,
        "request_set_identity": request_set.request_set_identity,
        "request_set_digest": request_set.request_set_digest,
        "plan_cell_set_identity": request_set.plan_cell_set_identity,
        "plan_cell_set_digest": request_set.plan_cell_set_digest,
    });
    let payload_digest =
        qualification_digest(QUALIFICATION_REQUEST_SET_EVENT_DOMAIN, &expected_payload)?;
    let event_identity = derived_identity(
        "qualification-protected-replay-request-set-sealed-event-v1",
        &payload_digest,
    )?;

    if request_set.request_set_identity != locator.request_set_identity
        || request_set.request_set_digest != locator.request_set_digest
        || locked.outbox.payload_json != expected_payload
        || locked.outbox.payload_digest != payload_digest
        || locked.outbox.event_identity != event_identity
        || locked.outbox.committed_at_epoch_ms == 0
    {
        return Err(PostgresReplayResultOwnerErrorV2::RequestNotAdmitted);
    }
    Ok(request_set)
}

fn decode_locked_bytes(
    value: &LockedBytesV1,
    domain: &str,
) -> Result<Vec<u8>, PostgresReplayResultOwnerErrorV2> {
    let bytes = STANDARD
        .decode(&value.bytes_base64)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?;

    if qualification_digest(domain, &bytes)? != value.storage_digest
        || serde_json::from_slice::<serde_json::Value>(&bytes)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)?
            != value.mirror
    {
        return Err(PostgresReplayResultOwnerErrorV2::RequestNotAdmitted);
    }
    Ok(bytes)
}

async fn validate_cross_owner_binding(
    qualification_pool: &sqlx::PgPool,
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), PostgresReplayResultOwnerErrorV2> {
    let qualification: (String, String, String, Option<String>, Option<i32>) = sqlx::query_as(
        "SELECT session_user,current_user,pg_catalog.current_database(),pg_catalog.inet_server_addr()::text,pg_catalog.inet_server_port()",
    )
    .fetch_one(qualification_pool)
    .await
    .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;
    let backtest: (String, String, String, Option<String>, Option<i32>) = sqlx::query_as(
        "SELECT session_user,current_user,pg_catalog.current_database(),pg_catalog.inet_server_addr()::text,pg_catalog.inet_server_port()",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayResultOwnerErrorV2::CustodyUnavailable)?;

    if qualification.0 != "qualification_writer"
        || qualification.1 != "qualification_writer"
        || backtest.0 != "backtest_owner"
        || backtest.1 != "backtest_owner"
        || qualification.2 != backtest.2
        || qualification.3 != backtest.3
        || qualification.4 != backtest.4
    {
        return Err(PostgresReplayResultOwnerErrorV2::CustodyUnavailable);
    }
    Ok(())
}

async fn lock_attempt(
    transaction: &mut Transaction<'_, Postgres>,
    result: &ProtectedReplayResultDtoV1,
) -> Result<(), PostgresReplayResultOwnerErrorV2> {
    lock_attempt_fields(
        transaction,
        &result.request_identity,
        &result.attempt_identity,
    )
    .await
}

async fn lock_attempt_fields(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
    attempt_identity: &str,
) -> Result<(), PostgresReplayResultOwnerErrorV2> {
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))")
        .bind(format!(
            "{ATTEMPT_LOCK_DOMAIN}:{request_identity}:{attempt_identity}"
        ))
        .execute(&mut **transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
    Ok(())
}

async fn lock_plan_cell_set_fence(
    transaction: &mut Transaction<'_, Postgres>,
    plan_cell_set_identity: &str,
) -> Result<(), PostgresReplayResultOwnerErrorV2> {
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))")
        .bind(plan_cell_set_identity)
        .execute(&mut **transaction)
        .await
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
    Ok(())
}

async fn read_frontier_for_request_set(
    transaction: &mut Transaction<'_, Postgres>,
    request_set_identity: &str,
) -> Result<Option<ProtectedReplayAttemptFrontierReadbackV1>, PostgresReplayResultOwnerErrorV2> {
    let identity: Option<String> = sqlx::query_scalar(
        "SELECT frontier_identity \
           FROM public.backtest_protected_replay_attempt_frontiers_v1 \
          WHERE request_set_identity=$1",
    )
    .bind(request_set_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
    let Some(identity) = identity else {
        return Ok(None);
    };
    read_exact_frontier(transaction, &identity, request_set_identity).await
}

async fn read_exact_frontier(
    transaction: &mut Transaction<'_, Postgres>,
    frontier_identity: &str,
    request_set_identity: &str,
) -> Result<Option<ProtectedReplayAttemptFrontierReadbackV1>, PostgresReplayResultOwnerErrorV2> {
    let row = sqlx::query(
        "SELECT frontier.frontier_json,frontier.canonical_frontier_bytes,\
                frontier.storage_digest,frontier.committed_at_epoch_ms,\
                receipt.canonical_bytes AS receipt_bytes,\
                receipt.storage_digest AS receipt_storage_digest,\
                outbox.canonical_bytes AS outbox_bytes,\
                outbox.storage_digest AS outbox_storage_digest \
           FROM public.backtest_protected_replay_attempt_frontiers_v1 frontier \
           JOIN public.backtest_protected_replay_attempt_frontier_receipts_v1 receipt \
             USING(frontier_identity) \
           JOIN public.backtest_protected_replay_attempt_frontier_outbox_v1 outbox \
             USING(frontier_identity) \
          WHERE frontier.frontier_identity=$1 AND frontier.request_set_identity=$2",
    )
    .bind(frontier_identity)
    .bind(request_set_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
    let Some(row) = row else { return Ok(None) };
    let frontier_bytes: Vec<u8> = row
        .try_get("canonical_frontier_bytes")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let receipt_bytes: Vec<u8> = row
        .try_get("receipt_bytes")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let outbox_bytes: Vec<u8> = row
        .try_get("outbox_bytes")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    if row
        .try_get::<String, _>("storage_digest")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?
        != storage_digest(FRONTIER_STORAGE_DOMAIN, &frontier_bytes)
        || row
            .try_get::<String, _>("receipt_storage_digest")
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?
            != storage_digest(FRONTIER_RECEIPT_STORAGE_DOMAIN, &receipt_bytes)
        || row
            .try_get::<String, _>("outbox_storage_digest")
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?
            != storage_digest(FRONTIER_OUTBOX_STORAGE_DOMAIN, &outbox_bytes)
    {
        return Err(PostgresReplayResultOwnerErrorV2::CorruptReadback);
    }
    let frontier = ProtectedReplayAttemptFrontierDtoV1::from_canonical_bytes(&frontier_bytes)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let frontier_json: serde_json::Value = row
        .try_get("frontier_json")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    if serde_json::to_value(&frontier)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?
        != frontier_json
    {
        return Err(PostgresReplayResultOwnerErrorV2::CorruptReadback);
    }
    let committed_at_epoch_ms = u64::try_from(
        row.try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?,
    )
    .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let (receipt, expected_receipt_bytes, outbox, expected_outbox_bytes) =
        protected_replay_attempt_frontier_custody_wires_v1(&frontier, committed_at_epoch_ms)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let stored_receipt: ProtectedReplayAttemptFrontierReceiptDtoV1 =
        serde_json::from_slice(&receipt_bytes)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let stored_outbox: ProtectedReplayAttemptFrontierOutboxDtoV1 =
        serde_json::from_slice(&outbox_bytes)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;

    if stored_receipt != receipt
        || stored_outbox != outbox
        || receipt_bytes != expected_receipt_bytes
        || outbox_bytes != expected_outbox_bytes
    {
        return Err(PostgresReplayResultOwnerErrorV2::CorruptReadback);
    }
    Ok(Some(ProtectedReplayAttemptFrontierReadbackV1 {
        frontier,
        receipt,
        frontier_canonical_bytes: frontier_bytes,
        receipt_canonical_bytes: receipt_bytes,
        outbox_canonical_bytes: outbox_bytes,
    }))
}

async fn read_exact_v2(
    transaction: &mut Transaction<'_, Postgres>,
    result_identity: &str,
    request_identity: &str,
    attempt_identity: &str,
) -> Result<Option<ProtectedReplayResultReadbackV2>, PostgresReplayResultOwnerErrorV2> {
    let row = sqlx::query(
        "SELECT result.canonical_bytes,result.storage_digest,
                receipt.canonical_bytes AS receipt_bytes,receipt.storage_digest AS receipt_storage_digest,
                outbox.canonical_bytes AS outbox_bytes,outbox.storage_digest AS outbox_storage_digest
           FROM public.backtest_protected_replay_results_v1 result
           JOIN public.backtest_protected_replay_result_receipts_v1 receipt USING(result_identity)
           JOIN public.backtest_protected_replay_result_outbox_v1 outbox USING(result_identity)
          WHERE result.result_identity=$1 AND result.request_identity=$2 AND result.attempt_identity=$3",
    )
    .bind(result_identity)
    .bind(request_identity)
    .bind(attempt_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
    let Some(row) = row else { return Ok(None) };
    let result_bytes: Vec<u8> = row
        .try_get("canonical_bytes")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let receipt_bytes: Vec<u8> = row
        .try_get("receipt_bytes")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let outbox_bytes: Vec<u8> = row
        .try_get("outbox_bytes")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    if row
        .try_get::<String, _>("storage_digest")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?
        != storage_digest(RESULT_STORAGE_DOMAIN, &result_bytes)
        || row
            .try_get::<String, _>("receipt_storage_digest")
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?
            != storage_digest(RECEIPT_STORAGE_DOMAIN, &receipt_bytes)
        || row
            .try_get::<String, _>("outbox_storage_digest")
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?
            != storage_digest(OUTBOX_STORAGE_DOMAIN, &outbox_bytes)
    {
        return Err(PostgresReplayResultOwnerErrorV2::CorruptReadback);
    }
    let result = ProtectedReplayResultDtoV2::from_canonical_bytes(&result_bytes)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let receipt: vibe_backtest_owner_contracts::ProtectedResultReceiptDtoV1 =
        serde_json::from_slice(&receipt_bytes)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let outbox: vibe_backtest_owner_contracts::ProtectedResultOutboxDtoV1 =
        serde_json::from_slice(&outbox_bytes)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let (expected_receipt, expected_receipt_bytes, expected_outbox, expected_outbox_bytes) =
        protected_result_custody_wires_v2(&result, receipt.committed_at_epoch_ms)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;

    if receipt != expected_receipt
        || outbox != expected_outbox
        || receipt_bytes != expected_receipt_bytes
        || outbox_bytes != expected_outbox_bytes
    {
        return Err(PostgresReplayResultOwnerErrorV2::CorruptReadback);
    }
    Ok(Some(ProtectedReplayResultReadbackV2 {
        result,
        result_canonical_bytes: result_bytes,
        receipt_canonical_bytes: receipt_bytes,
        outbox_canonical_bytes: outbox_bytes,
    }))
}

async fn read_exact_v3(
    transaction: &mut Transaction<'_, Postgres>,
    result_identity: &str,
    request_identity: &str,
    attempt_identity: &str,
) -> Result<Option<ProtectedReplayResultReadbackV3>, PostgresReplayResultOwnerErrorV2> {
    let row = sqlx::query(
        "SELECT result.canonical_bytes,result.storage_digest,
                receipt.canonical_bytes AS receipt_bytes,receipt.storage_digest AS receipt_storage_digest,
                outbox.canonical_bytes AS outbox_bytes,outbox.storage_digest AS outbox_storage_digest
           FROM public.backtest_protected_replay_results_v1 result
           JOIN public.backtest_protected_replay_result_receipts_v1 receipt USING(result_identity)
           JOIN public.backtest_protected_replay_result_outbox_v1 outbox USING(result_identity)
          WHERE result.result_identity=$1 AND result.request_identity=$2 AND result.attempt_identity=$3",
    )
    .bind(result_identity)
    .bind(request_identity)
    .bind(attempt_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
    let Some(row) = row else { return Ok(None) };
    let result_bytes: Vec<u8> = row
        .try_get("canonical_bytes")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let receipt_bytes: Vec<u8> = row
        .try_get("receipt_bytes")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let outbox_bytes: Vec<u8> = row
        .try_get("outbox_bytes")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    if row
        .try_get::<String, _>("storage_digest")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?
        != storage_digest(RESULT_STORAGE_DOMAIN, &result_bytes)
        || row
            .try_get::<String, _>("receipt_storage_digest")
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?
            != storage_digest(RECEIPT_STORAGE_DOMAIN, &receipt_bytes)
        || row
            .try_get::<String, _>("outbox_storage_digest")
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?
            != storage_digest(OUTBOX_STORAGE_DOMAIN, &outbox_bytes)
    {
        return Err(PostgresReplayResultOwnerErrorV2::CorruptReadback);
    }
    let result = ProtectedReplayResultDtoV3::from_canonical_bytes(&result_bytes)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let receipt: vibe_backtest_owner_contracts::ProtectedResultReceiptDtoV1 =
        serde_json::from_slice(&receipt_bytes)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let outbox: vibe_backtest_owner_contracts::ProtectedResultOutboxDtoV1 =
        serde_json::from_slice(&outbox_bytes)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let (expected_receipt, expected_receipt_bytes, expected_outbox, expected_outbox_bytes) =
        protected_result_custody_wires_v3(&result, receipt.committed_at_epoch_ms)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;

    if receipt != expected_receipt
        || outbox != expected_outbox
        || receipt_bytes != expected_receipt_bytes
        || outbox_bytes != expected_outbox_bytes
    {
        return Err(PostgresReplayResultOwnerErrorV2::CorruptReadback);
    }
    Ok(Some(ProtectedReplayResultReadbackV3 {
        result,
        result_canonical_bytes: result_bytes,
        receipt_canonical_bytes: receipt_bytes,
        outbox_canonical_bytes: outbox_bytes,
    }))
}

async fn read_exact(
    transaction: &mut Transaction<'_, Postgres>,
    result_identity: &str,
    request_identity: &str,
    attempt_identity: &str,
) -> Result<Option<ProtectedReplayResultReadbackV1>, PostgresReplayResultOwnerErrorV2> {
    let row = sqlx::query(
        "SELECT result.canonical_bytes,result.storage_digest,
                receipt.canonical_bytes AS receipt_bytes,receipt.storage_digest AS receipt_storage_digest,
                outbox.canonical_bytes AS outbox_bytes,outbox.storage_digest AS outbox_storage_digest
           FROM public.backtest_protected_replay_results_v1 result
           JOIN public.backtest_protected_replay_result_receipts_v1 receipt USING(result_identity)
           JOIN public.backtest_protected_replay_result_outbox_v1 outbox USING(result_identity)
          WHERE result.result_identity=$1 AND result.request_identity=$2 AND result.attempt_identity=$3
        ",
    )
    .bind(result_identity)
    .bind(request_identity)
    .bind(attempt_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
    let Some(row) = row else { return Ok(None) };
    let result_bytes: Vec<u8> = row
        .try_get("canonical_bytes")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let receipt_bytes: Vec<u8> = row
        .try_get("receipt_bytes")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let outbox_bytes: Vec<u8> = row
        .try_get("outbox_bytes")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    if row
        .try_get::<String, _>("storage_digest")
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?
        != storage_digest(RESULT_STORAGE_DOMAIN, &result_bytes)
        || row
            .try_get::<String, _>("receipt_storage_digest")
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?
            != storage_digest(RECEIPT_STORAGE_DOMAIN, &receipt_bytes)
        || row
            .try_get::<String, _>("outbox_storage_digest")
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?
            != storage_digest(OUTBOX_STORAGE_DOMAIN, &outbox_bytes)
    {
        return Err(PostgresReplayResultOwnerErrorV2::CorruptReadback);
    }
    let result = ProtectedReplayResultDtoV1::from_canonical_bytes(&result_bytes)
        .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let receipt: vibe_backtest_owner_contracts::ProtectedResultReceiptDtoV1 =
        serde_json::from_slice(&receipt_bytes)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let outbox: vibe_backtest_owner_contracts::ProtectedResultOutboxDtoV1 =
        serde_json::from_slice(&outbox_bytes)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;
    let (expected_receipt, expected_receipt_bytes, expected_outbox, expected_outbox_bytes) =
        protected_result_custody_wires_v1(&result, receipt.committed_at_epoch_ms)
            .map_err(|_| PostgresReplayResultOwnerErrorV2::CorruptReadback)?;

    if receipt != expected_receipt
        || outbox != expected_outbox
        || receipt_bytes != expected_receipt_bytes
        || outbox_bytes != expected_outbox_bytes
    {
        return Err(PostgresReplayResultOwnerErrorV2::CorruptReadback);
    }
    Ok(Some(ProtectedReplayResultReadbackV1 {
        result,
        result_canonical_bytes: result_bytes,
        receipt_canonical_bytes: receipt_bytes,
        outbox_canonical_bytes: outbox_bytes,
    }))
}

fn qualification_digest<T: Serialize + ?Sized>(
    domain: &str,
    value: &T,
) -> Result<String, PostgresReplayResultOwnerErrorV2> {
    #[derive(Serialize)]
    struct Envelope<'a, T: ?Sized> {
        domain: &'a str,
        value: &'a T,
    }

    let bytes = serde_json::to_vec(&Envelope { domain, value })
        .map_err(|_| PostgresReplayResultOwnerErrorV2::StorageUnavailable)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn storage_digest(domain: &str, bytes: &[u8]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(&[0]);
    hasher.update(bytes);
    format!("blake3:{}", hasher.finalize().to_hex())
}

fn derived_identity(
    prefix: &str,
    digest: &str,
) -> Result<String, PostgresReplayResultOwnerErrorV2> {
    digest
        .strip_prefix("sha256:")
        .map(|suffix| format!("{prefix}-{suffix}"))
        .ok_or(PostgresReplayResultOwnerErrorV2::RequestNotAdmitted)
}

fn terminal_text(value: vibe_backtest_owner_contracts::ReplayTerminalV2) -> &'static str {
    match value {
        vibe_backtest_owner_contracts::ReplayTerminalV2::RunRejected => "RUN_REJECTED",
        vibe_backtest_owner_contracts::ReplayTerminalV2::TerminalResult => "TERMINAL_RESULT",
        vibe_backtest_owner_contracts::ReplayTerminalV2::InvalidReplayEvidence => {
            "INVALID_REPLAY_EVIDENCE"
        }
        vibe_backtest_owner_contracts::ReplayTerminalV2::InProgressOrUnknown => {
            "IN_PROGRESS_OR_UNKNOWN"
        }
    }
}
