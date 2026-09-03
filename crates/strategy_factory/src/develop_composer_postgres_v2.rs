//! PostgreSQL custody for the durable Composer V2 positive terminal.
//!
//! Every authoritative value is private BYTEA. No JSON column participates in readback or hashing.

use std::{collections::BTreeSet, fmt::Display};

use async_trait::async_trait;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use vibe_data::owner::source_binding::BindingDigest;

use crate::develop_composer_operation_v2::{
    DevelopComposerA0BuildPortV2, DevelopComposerDurableEvidenceLocatorV2,
    DevelopComposerFinalEvidencePortV2, DevelopComposerLockedEvidenceV2,
    DevelopComposerOperationDispositionV2, DevelopComposerOperationResponseV2,
    DevelopComposerPreflightV2, DevelopComposerRunRequestV2, StoredDevelopComposerPositiveV2,
    build_positive_record_from_preflight_v2, conflict_response, preflight_develop_composer_v2,
    request_digest, resolve_positive_record_v2,
};

const SEALED_READ_SCHEMA_V2: u16 = 2;
const SEALED_READ_FUNCTION_V2: &str = "composer_owner_api.lock_accepted_develop_composer_v2(text)";
const SEALED_READ_UNAVAILABLE_PROTOCOL_V2: &str = "Composer sealed readback is unavailable";
const COMMIT_FUNCTION_V2: &str = "composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea)";
const COMMIT_FUNCTION_SOURCE_V2: &str = "DECLARE ordinal integer;
BEGIN
  IF SESSION_USER<>'rd_fact_writer' THEN RAISE EXCEPTION 'R&D fact writer required' USING ERRCODE='42501'; END IF;
  IF cardinality(p_receipt_identities)<>cardinality(p_attempt_identities)
     OR cardinality(p_receipt_identities)<>cardinality(p_capsule_identities)
     OR cardinality(p_receipt_identities)<>cardinality(p_build_bytes) THEN RETURN false; END IF;
  INSERT INTO composer_private.rd_develop_designs_v2 VALUES (p_design_identity,p_design_bytes);
  INSERT INTO composer_private.rd_develop_plans_v2 VALUES (p_plan_digest,p_design_identity,p_plan_bytes);
  INSERT INTO composer_private.rd_develop_artifacts_v2 VALUES (p_artifact_identity,p_plan_digest,p_package_bytes);
  FOR ordinal IN SELECT generate_subscripts(p_module_bytes,1) LOOP INSERT INTO composer_private.rd_develop_artifact_modules_v2 VALUES (p_artifact_identity,ordinal-1,p_module_bytes[ordinal]); END LOOP;
  FOR ordinal IN SELECT generate_subscripts(p_receipt_identities,1) LOOP INSERT INTO composer_private.rd_develop_build_receipts_v2 VALUES (p_receipt_identities[ordinal],p_attempt_identities[ordinal],p_capsule_identities[ordinal],p_artifact_identity,ordinal-1,p_build_bytes[ordinal]); END LOOP;
  INSERT INTO composer_private.rd_develop_composer_receipts_v2 VALUES (p_artifact_identity,p_composer_bytes);
  INSERT INTO composer_private.rd_develop_host_receipts_v2 VALUES (p_artifact_identity,p_host_bytes);
  INSERT INTO composer_private.rd_develop_operations_v2 VALUES (p_request_identity,p_request_digest,p_research_identity,p_intent_identity,p_artifact_identity,p_operation_bytes,p_response_bytes);
  INSERT INTO composer_private.rd_develop_outbox_v2 VALUES (p_request_identity,p_outbox_bytes);
  RETURN true;
END";
const COMPOSER_TABLES_V2: [&str; 9] = [
    "rd_develop_designs_v2",
    "rd_develop_plans_v2",
    "rd_develop_artifacts_v2",
    "rd_develop_artifact_modules_v2",
    "rd_develop_build_receipts_v2",
    "rd_develop_composer_receipts_v2",
    "rd_develop_host_receipts_v2",
    "rd_develop_operations_v2",
    "rd_develop_outbox_v2",
];
const SEALED_READ_FUNCTION_SOURCE_V2: &str = "BEGIN
  LOCK TABLE
    composer_private.rd_develop_designs_v2,
    composer_private.rd_develop_plans_v2,
    composer_private.rd_develop_artifacts_v2,
    composer_private.rd_develop_artifact_modules_v2,
    composer_private.rd_develop_build_receipts_v2,
    composer_private.rd_develop_composer_receipts_v2,
    composer_private.rd_develop_host_receipts_v2,
    composer_private.rd_develop_operations_v2,
    composer_private.rd_develop_outbox_v2
  IN SHARE MODE;
  RETURN QUERY
  SELECT operation.request_digest,
         operation.research_request_identity,
         operation.intent_identity,
         operation.artifact_identity,
         operation.canonical_receipt_bytes,
         operation.response_bytes,
         artifact.plan_digest,
         artifact.package_bytes,
         plan.design_identity,
         plan.canonical_bytes,
         design.canonical_bytes,
         COALESCE(modules.ordinals, ARRAY[]::integer[]),
         COALESCE(modules.canonical_bytes, ARRAY[]::bytea[]),
         COALESCE(builds.ordinals, ARRAY[]::integer[]),
         COALESCE(builds.receipt_identities, ARRAY[]::bytea[]),
         COALESCE(builds.attempt_identities, ARRAY[]::bytea[]),
         COALESCE(builds.capsule_identities, ARRAY[]::bytea[]),
         COALESCE(builds.canonical_bytes, ARRAY[]::bytea[]),
         composer.canonical_bytes,
         host.canonical_bytes,
         outbox.canonical_bytes
    FROM composer_private.rd_develop_operations_v2 operation
    JOIN composer_private.rd_develop_artifacts_v2 artifact
      ON artifact.artifact_identity=operation.artifact_identity
    JOIN composer_private.rd_develop_plans_v2 plan
      ON plan.plan_digest=artifact.plan_digest
    JOIN composer_private.rd_develop_designs_v2 design
      ON design.design_identity=plan.design_identity
    JOIN composer_private.rd_develop_composer_receipts_v2 composer
      ON composer.artifact_identity=artifact.artifact_identity
    JOIN composer_private.rd_develop_host_receipts_v2 host
      ON host.artifact_identity=artifact.artifact_identity
    JOIN composer_private.rd_develop_outbox_v2 outbox
      ON outbox.request_identity=operation.request_identity
    LEFT JOIN LATERAL (
      SELECT array_agg(module.ordinal ORDER BY module.ordinal) AS ordinals,
             array_agg(module.module_bytes ORDER BY module.ordinal) AS canonical_bytes
        FROM composer_private.rd_develop_artifact_modules_v2 module
       WHERE module.artifact_identity=artifact.artifact_identity
    ) modules ON TRUE
    LEFT JOIN LATERAL (
      SELECT array_agg(receipt.ordinal ORDER BY receipt.ordinal) AS ordinals,
             array_agg(receipt.receipt_identity ORDER BY receipt.ordinal) AS receipt_identities,
             array_agg(receipt.build_attempt_identity ORDER BY receipt.ordinal) AS attempt_identities,
             array_agg(receipt.capsule_identity ORDER BY receipt.ordinal) AS capsule_identities,
             array_agg(receipt.canonical_bytes ORDER BY receipt.ordinal) AS canonical_bytes
        FROM composer_private.rd_develop_build_receipts_v2 receipt
       WHERE receipt.artifact_identity=artifact.artifact_identity
    ) builds ON TRUE
   WHERE operation.request_identity=p_request_identity;
END";

/// Untrusted exact claim for one accepted durable Composer operation.
///
/// Constructing or changing this locator grants no authority. The R&D-owned read port resolves the
/// complete claim against one persisted positive operation and returns only a sealed readback.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DevelopComposerSealedReadLocatorV2 {
    pub schema_version: u16,
    pub request_identity: String,
    pub operation_receipt_identity: BindingDigest,
    pub artifact_locator: String,
    pub artifact_identity: BindingDigest,
    pub canonical_plan_digest: BindingDigest,
    pub design_digest: BindingDigest,
}

impl DevelopComposerSealedReadLocatorV2 {
    /// Projects an untrusted locator from a public positive operation response.
    ///
    /// The returned value becomes authoritative only after exact R&D Owner resolution.
    pub fn from_accepted_response(
        response: &DevelopComposerOperationResponseV2,
    ) -> Result<Self, DevelopComposerSealedReadErrorV2> {
        let receipt_identity = response
            .receipt_identity
            .ok_or(DevelopComposerSealedReadErrorV2::Unavailable)?;
        let artifact = response
            .artifact
            .as_ref()
            .ok_or(DevelopComposerSealedReadErrorV2::Unavailable)?;

        if response.schema_version != SEALED_READ_SCHEMA_V2
            || response.disposition != DevelopComposerOperationDispositionV2::Success
            || response.coordinate.is_some()
            || response.reason.is_some()
            || response.request_identity.is_empty()
            || artifact.artifact_locator.is_empty()
        {
            return Err(DevelopComposerSealedReadErrorV2::Unavailable);
        }
        Ok(Self {
            schema_version: SEALED_READ_SCHEMA_V2,
            request_identity: response.request_identity.clone(),
            operation_receipt_identity: receipt_identity,
            artifact_locator: artifact.artifact_locator.clone(),
            artifact_identity: artifact.artifact_digest,
            canonical_plan_digest: artifact.canonical_plan_digest,
            design_digest: artifact.design_digest,
        })
    }
}

/// Uniform fail-closed result for missing, mismatched, corrupt, or unreadable R&D custody.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DevelopComposerSealedReadErrorV2 {
    Unavailable,
}

impl Display for DevelopComposerSealedReadErrorV2 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("sealed Composer readback is unavailable")
    }
}

impl std::error::Error for DevelopComposerSealedReadErrorV2 {}

/// R&D-sealed canonical Composer package readback.
///
/// Private fields and the absence of `Deserialize` or a public constructor prevent callers from
/// upgrading arbitrary DTOs or bytes into an R&D Owner fact. The bytes remain immutable historical
/// Composer custody; they are not Backtest actual-consumption or replay-result evidence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealedDevelopComposerReadbackV2 {
    locator: DevelopComposerSealedReadLocatorV2,
    request_digest: BindingDigest,
    research_request_identity: BindingDigest,
    intent_identity: BindingDigest,
    design_identity: BindingDigest,
    design_bytes: Box<[u8]>,
    design_bytes_digest: BindingDigest,
    plan_bytes: Box<[u8]>,
    plan_bytes_digest: BindingDigest,
    artifact_package_bytes: Box<[u8]>,
    artifact_package_bytes_digest: BindingDigest,
    module_bytes: Vec<Box<[u8]>>,
    module_bytes_digests: Vec<BindingDigest>,
    build_receipt_identities: Vec<BindingDigest>,
    build_receipt_bytes: Vec<Box<[u8]>>,
    build_receipt_bytes_digests: Vec<BindingDigest>,
    composer_receipt_bytes: Box<[u8]>,
    composer_receipt_bytes_digest: BindingDigest,
    host_receipt_bytes: Box<[u8]>,
    host_receipt_bytes_digest: BindingDigest,
}

impl SealedDevelopComposerReadbackV2 {
    pub const fn locator(&self) -> &DevelopComposerSealedReadLocatorV2 {
        &self.locator
    }

    pub const fn request_digest(&self) -> BindingDigest {
        self.request_digest
    }

    pub const fn research_request_identity(&self) -> BindingDigest {
        self.research_request_identity
    }

    pub const fn intent_identity(&self) -> BindingDigest {
        self.intent_identity
    }

    pub const fn design_identity(&self) -> BindingDigest {
        self.design_identity
    }

    pub fn design_bytes(&self) -> &[u8] {
        &self.design_bytes
    }

    pub const fn design_bytes_digest(&self) -> BindingDigest {
        self.design_bytes_digest
    }

    pub fn plan_bytes(&self) -> &[u8] {
        &self.plan_bytes
    }

    pub const fn plan_bytes_digest(&self) -> BindingDigest {
        self.plan_bytes_digest
    }

    pub fn artifact_package_bytes(&self) -> &[u8] {
        &self.artifact_package_bytes
    }

    pub const fn artifact_package_bytes_digest(&self) -> BindingDigest {
        self.artifact_package_bytes_digest
    }

    pub fn module_bytes(&self) -> impl ExactSizeIterator<Item = &[u8]> {
        self.module_bytes.iter().map(|bytes| bytes.as_ref())
    }

    pub fn module_bytes_digests(&self) -> &[BindingDigest] {
        &self.module_bytes_digests
    }

    pub fn build_receipt_identities(&self) -> &[BindingDigest] {
        &self.build_receipt_identities
    }

    pub fn build_receipt_bytes(&self) -> impl ExactSizeIterator<Item = &[u8]> {
        self.build_receipt_bytes.iter().map(|bytes| bytes.as_ref())
    }

    pub fn build_receipt_bytes_digests(&self) -> &[BindingDigest] {
        &self.build_receipt_bytes_digests
    }

    pub fn composer_receipt_bytes(&self) -> &[u8] {
        &self.composer_receipt_bytes
    }

    pub const fn composer_receipt_bytes_digest(&self) -> BindingDigest {
        self.composer_receipt_bytes_digest
    }

    pub fn host_receipt_bytes(&self) -> &[u8] {
        &self.host_receipt_bytes
    }

    pub const fn host_receipt_bytes_digest(&self) -> BindingDigest {
        self.host_receipt_bytes_digest
    }
}

mod sealed_read_port {
    pub trait RdOwned {}
}

/// Query-only boundary that only an R&D-owned implementation can provide.
#[async_trait]
pub trait DevelopComposerSealedReadPortV2: sealed_read_port::RdOwned + Send + Sync {
    /// Resolves one exact accepted Composer locator without creating or mutating custody.
    async fn read_accepted(
        &self,
        locator: &DevelopComposerSealedReadLocatorV2,
    ) -> Result<SealedDevelopComposerReadbackV2, DevelopComposerSealedReadErrorV2>;
}

/// R&D composition-root implementation. Its evidence seam and constructor remain crate-private so
/// a downstream caller cannot substitute its own current-custody authority.
#[allow(
    dead_code,
    reason = "the future R&D composition root injects this port into the Backtest-owned runner"
)]
pub(crate) struct PostgresDevelopComposerSealedReadPortV2<E> {
    store: PostgresDevelopComposerStoreV2,
    evidence: E,
    read_cut_epoch_ms: u64,
}

#[allow(
    dead_code,
    reason = "the future R&D composition root owns construction of the sealed read port"
)]
impl<E> PostgresDevelopComposerSealedReadPortV2<E> {
    pub(crate) const fn new(
        store: PostgresDevelopComposerStoreV2,
        evidence: E,
        read_cut_epoch_ms: u64,
    ) -> Self {
        Self {
            store,
            evidence,
            read_cut_epoch_ms,
        }
    }
}

impl<E> sealed_read_port::RdOwned for PostgresDevelopComposerSealedReadPortV2<E> {}

#[async_trait]
impl<E> DevelopComposerSealedReadPortV2 for PostgresDevelopComposerSealedReadPortV2<E>
where
    E: DevelopComposerFinalEvidencePortV2 + Send + Sync,
{
    async fn read_accepted(
        &self,
        locator: &DevelopComposerSealedReadLocatorV2,
    ) -> Result<SealedDevelopComposerReadbackV2, DevelopComposerSealedReadErrorV2> {
        let mut transaction = self
            .store
            .pool
            .begin()
            .await
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
        let record = load_record_via_sealed_routine_in_transaction(
            &mut transaction,
            &locator.request_identity,
        )
        .await?
        .ok_or(DevelopComposerSealedReadErrorV2::Unavailable)?;
        if !locator_matches_record_keys(locator, &record) {
            return Err(DevelopComposerSealedReadErrorV2::Unavailable);
        }
        let current = self
            .evidence
            .lock_and_reread_durable(
                &DevelopComposerDurableEvidenceLocatorV2::from_record(&record),
                self.read_cut_epoch_ms,
            )
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
        let readback = read_accepted_in_transaction(&mut transaction, locator, current).await?;
        transaction
            .commit()
            .await
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
        Ok(readback)
    }
}

fn locator_matches_record_keys(
    locator: &DevelopComposerSealedReadLocatorV2,
    record: &StoredDevelopComposerPositiveV2,
) -> bool {
    locator.schema_version == SEALED_READ_SCHEMA_V2
        && !locator.request_identity.is_empty()
        && locator.request_identity == record.request_identity
        && locator.artifact_identity == record.artifact_identity
        && locator.canonical_plan_digest == record.plan_digest
}

fn accepted_response_matches_locator(
    locator: &DevelopComposerSealedReadLocatorV2,
    response: &DevelopComposerOperationResponseV2,
) -> bool {
    response.schema_version == SEALED_READ_SCHEMA_V2
        && response.disposition == DevelopComposerOperationDispositionV2::Success
        && response.request_identity == locator.request_identity
        && response.receipt_identity == Some(locator.operation_receipt_identity)
        && response.coordinate.is_none()
        && response.reason.is_none()
        && response.artifact.as_ref().is_some_and(|artifact| {
            artifact.artifact_locator == locator.artifact_locator
                && artifact.artifact_digest == locator.artifact_identity
                && artifact.canonical_plan_digest == locator.canonical_plan_digest
                && artifact.design_digest == locator.design_digest
        })
}

fn seal_readback(
    locator: &DevelopComposerSealedReadLocatorV2,
    record: StoredDevelopComposerPositiveV2,
    response: &DevelopComposerOperationResponseV2,
) -> Result<SealedDevelopComposerReadbackV2, DevelopComposerSealedReadErrorV2> {
    if !locator_matches_record_keys(locator, &record)
        || !accepted_response_matches_locator(locator, response)
        || record.response_bytes != response.canonical_bytes()
    {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }

    let module_bytes_digests = record
        .module_bytes
        .iter()
        .map(|bytes| {
            canonical_blob_digest(b"rd.develop.artifact-module.canonical-bytes.v2\0", bytes)
        })
        .collect();
    let build_receipt_bytes_digests = record
        .build_receipt_bytes
        .iter()
        .map(|bytes| canonical_blob_digest(b"rd.develop.build-receipt.canonical-bytes.v2\0", bytes))
        .collect();

    Ok(SealedDevelopComposerReadbackV2 {
        locator: locator.clone(),
        request_digest: record.request_digest,
        research_request_identity: record.research_request_identity,
        intent_identity: record.intent_identity,
        design_identity: record.design_identity,
        design_bytes_digest: canonical_blob_digest(
            b"rd.develop.design.canonical-bytes.v2\0",
            &record.design_bytes,
        ),
        design_bytes: record.design_bytes.into_boxed_slice(),
        plan_bytes_digest: canonical_blob_digest(
            b"rd.develop.plan.canonical-bytes.v2\0",
            &record.plan_bytes,
        ),
        plan_bytes: record.plan_bytes.into_boxed_slice(),
        artifact_package_bytes_digest: canonical_blob_digest(
            b"rd.develop.artifact-package.canonical-bytes.v2\0",
            &record.artifact_package_bytes,
        ),
        artifact_package_bytes: record.artifact_package_bytes.into_boxed_slice(),
        module_bytes: record.module_bytes,
        module_bytes_digests,
        build_receipt_identities: record.build_receipt_identities,
        build_receipt_bytes: record
            .build_receipt_bytes
            .into_iter()
            .map(Vec::into_boxed_slice)
            .collect(),
        build_receipt_bytes_digests,
        composer_receipt_bytes_digest: canonical_blob_digest(
            b"rd.develop.composer-receipt.canonical-bytes.v2\0",
            &record.composer_receipt_bytes,
        ),
        composer_receipt_bytes: record.composer_receipt_bytes.into_boxed_slice(),
        host_receipt_bytes_digest: canonical_blob_digest(
            b"rd.develop.host-receipt.canonical-bytes.v2\0",
            &record.host_receipt_bytes,
        ),
        host_receipt_bytes: record.host_receipt_bytes.into_boxed_slice(),
    })
}

fn canonical_blob_digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

/// Fixed-corpus dynamic acceptance adapter for the sealed read port. It exists only under the
/// repository's non-default Composer acceptance feature and supplies no runtime-selectable R&D
/// evidence authority.
#[cfg(feature = "sealed-develop-composer-acceptance")]
pub struct SealedDevelopComposerAcceptanceReadPortV2 {
    owner: crate::develop_composer_sealed_acceptance_v2::SealedDevelopComposerAcceptanceV2,
    store: PostgresDevelopComposerStoreV2,
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
impl SealedDevelopComposerAcceptanceReadPortV2 {
    pub async fn connect(database_url: &str) -> anyhow::Result<Self> {
        let owner = crate::develop_composer_sealed_acceptance_v2::SealedDevelopComposerAcceptanceV2::connect(database_url).await?;
        let store = PostgresDevelopComposerStoreV2::connect(database_url).await?;
        Ok(Self { owner, store })
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
impl sealed_read_port::RdOwned for SealedDevelopComposerAcceptanceReadPortV2 {}

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[async_trait]
impl DevelopComposerSealedReadPortV2 for SealedDevelopComposerAcceptanceReadPortV2 {
    async fn read_accepted(
        &self,
        locator: &DevelopComposerSealedReadLocatorV2,
    ) -> Result<SealedDevelopComposerReadbackV2, DevelopComposerSealedReadErrorV2> {
        let mut transaction = self
            .store
            .pool
            .begin()
            .await
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
        let readback = self
            .owner
            .read_accepted_in_transaction(&mut transaction, locator)
            .await?;
        transaction
            .commit()
            .await
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
        Ok(readback)
    }
}

/// Resolves one accepted Composer fact using exactly the caller's transaction and Owner-locked
/// evidence. This function opens no connection or transaction and performs no writes.
pub(crate) async fn read_accepted_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &DevelopComposerSealedReadLocatorV2,
    locked_evidence: DevelopComposerLockedEvidenceV2,
) -> Result<SealedDevelopComposerReadbackV2, DevelopComposerSealedReadErrorV2> {
    let record =
        load_record_via_sealed_routine_in_transaction(transaction, &locator.request_identity)
            .await?
            .ok_or(DevelopComposerSealedReadErrorV2::Unavailable)?;
    if !locator_matches_record_keys(locator, &record) {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    let response = resolve_positive_record_v2(&record, locked_evidence)
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    seal_readback(locator, record, &response)
}

async fn load_record_via_sealed_routine_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<Option<StoredDevelopComposerPositiveV2>, DevelopComposerSealedReadErrorV2> {
    verify_composer_read_authority_in_transaction(transaction).await?;
    let Some(row) = sqlx::query(
        "SELECT *
           FROM composer_owner_api.lock_accepted_develop_composer_v2($1)",
    )
    .bind(request_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?
    else {
        return Ok(None);
    };

    let module_ordinals: Vec<i32> = row
        .try_get("module_ordinals")
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    let module_bytes: Vec<Vec<u8>> = row
        .try_get("module_bytes")
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    exact_ordinal_array(&module_ordinals, module_bytes.len())?;
    let build_ordinals: Vec<i32> = row
        .try_get("build_ordinals")
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    let build_receipt_bytes: Vec<Vec<u8>> = row
        .try_get("build_receipt_bytes")
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    exact_ordinal_array(&build_ordinals, build_receipt_bytes.len())?;

    Ok(Some(StoredDevelopComposerPositiveV2 {
        request_identity: request_identity.to_owned(),
        request_digest: sealed_digest_column(&row, "request_digest")?,
        research_request_identity: sealed_digest_column(&row, "research_request_identity")?,
        intent_identity: sealed_digest_column(&row, "intent_identity")?,
        design_identity: sealed_digest_column(&row, "design_identity")?,
        plan_digest: sealed_digest_column(&row, "plan_digest")?,
        artifact_identity: sealed_digest_column(&row, "artifact_identity")?,
        build_attempt_identities: sealed_digest_array(&row, "build_attempt_identities")?,
        capsule_identities: sealed_digest_array(&row, "capsule_identities")?,
        build_receipt_identities: sealed_digest_array(&row, "build_receipt_identities")?,
        design_bytes: sealed_bytes_column(&row, "design_bytes")?,
        plan_bytes: sealed_bytes_column(&row, "plan_bytes")?,
        artifact_package_bytes: sealed_bytes_column(&row, "artifact_package_bytes")?,
        module_bytes: module_bytes
            .into_iter()
            .map(Vec::into_boxed_slice)
            .collect(),
        build_receipt_bytes,
        composer_receipt_bytes: sealed_bytes_column(&row, "composer_receipt_bytes")?,
        host_receipt_bytes: sealed_bytes_column(&row, "host_receipt_bytes")?,
        operation_receipt_bytes: sealed_bytes_column(&row, "operation_receipt_bytes")?,
        outbox_bytes: sealed_bytes_column(&row, "outbox_bytes")?,
        response_bytes: sealed_bytes_column(&row, "response_bytes")?,
    }))
}

async fn verify_composer_read_authority_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), DevelopComposerSealedReadErrorV2> {
    let authority_is_exact: bool = sqlx::query_scalar(
        "WITH target AS (
           SELECT procedure.oid,
                  procedure.proowner,
                  procedure.proacl,
                  procedure.prosrc,
                  procedure.prolang,
                  procedure.prokind,
                  procedure.proretset,
                  procedure.prosecdef,
                  procedure.provolatile,
                  procedure.proparallel,
                  procedure.proisstrict,
                  procedure.proconfig,
                  namespace.oid AS namespace_oid,
                  namespace.nspowner,
                  namespace.nspacl,
                  object_owner.rolcanlogin,
                  object_owner.rolsuper,
                  object_owner.rolcreatedb,
                  object_owner.rolcreaterole,
                  object_owner.rolreplication,
                  object_owner.rolbypassrls,
                  caller.oid AS caller_oid,
                  rd_owner.oid AS rd_owner_oid,
                  fact_writer.oid AS fact_writer_oid
             FROM pg_catalog.pg_proc procedure
             JOIN pg_catalog.pg_namespace namespace
               ON namespace.oid=procedure.pronamespace
              AND namespace.nspname='composer_owner_api'
             JOIN pg_catalog.pg_roles caller ON caller.rolname=current_user
             JOIN pg_catalog.pg_roles object_owner ON object_owner.oid=procedure.proowner AND object_owner.rolname='composer_owner'
             LEFT JOIN pg_catalog.pg_roles rd_owner ON rd_owner.rolname='rd_owner'
             LEFT JOIN pg_catalog.pg_roles fact_writer ON fact_writer.rolname='rd_fact_writer'
            WHERE procedure.oid=pg_catalog.to_regprocedure($1)
              AND procedure.proname='lock_accepted_develop_composer_v2'
         ), required(table_name) AS (
           VALUES
             ('rd_develop_designs_v2'),
             ('rd_develop_plans_v2'),
             ('rd_develop_artifacts_v2'),
             ('rd_develop_artifact_modules_v2'),
             ('rd_develop_build_receipts_v2'),
             ('rd_develop_composer_receipts_v2'),
             ('rd_develop_host_receipts_v2'),
             ('rd_develop_operations_v2'),
             ('rd_develop_outbox_v2')
         ), relations AS (
           SELECT relation.oid, relation.relowner, relation.relacl, target.proowner
             FROM required
             CROSS JOIN target
             JOIN pg_catalog.pg_namespace namespace
               ON namespace.nspname='composer_private'
             JOIN pg_catalog.pg_class relation
               ON relation.relnamespace=namespace.oid
              AND relation.relname=required.table_name
              AND relation.relkind IN ('r','p')
         )
         SELECT count(*)=9
            AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='rd_owner' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls)
            AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members membership JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid JOIN pg_catalog.pg_roles member ON member.oid=membership.member WHERE granted.rolname='rd_owner' OR member.rolname='rd_owner')
            AND (
              SELECT count(*)=2
                 AND bool_and(procedure.oid IN (
                   pg_catalog.to_regprocedure($1),
                   pg_catalog.to_regprocedure($3)
                 ))
                 AND bool_and((
                   SELECT count(*)=CASE procedure.proname
                            WHEN 'commit_develop_composer_v2' THEN 2 ELSE 3 END
                      AND count(*) FILTER (
                        WHERE acl.grantee=procedure.proowner
                          AND acl.privilege_type='EXECUTE'
                      )=1
                      AND count(*) FILTER (
                        WHERE acl.grantee=(
                          SELECT oid FROM pg_catalog.pg_roles
                           WHERE rolname='rd_fact_writer'
                        )
                          AND acl.privilege_type='EXECUTE'
                          AND NOT acl.is_grantable
                      )=1
                      AND count(*) FILTER (
                        WHERE acl.grantee=(
                          SELECT oid FROM pg_catalog.pg_roles
                           WHERE rolname='rd_owner'
                        )
                          AND acl.privilege_type='EXECUTE'
                          AND NOT acl.is_grantable
                      )=CASE procedure.proname
                          WHEN 'commit_develop_composer_v2' THEN 0 ELSE 1 END
                      AND count(*) FILTER (WHERE acl.grantee=0)=0
                      AND count(*) FILTER (
                        WHERE acl.privilege_type<>'EXECUTE'
                           OR acl.grantee NOT IN (
                             procedure.proowner,
                             (SELECT oid FROM pg_catalog.pg_roles
                               WHERE rolname='rd_owner'),
                             (SELECT oid FROM pg_catalog.pg_roles
                               WHERE rolname='rd_fact_writer')
                           )
                           OR (acl.grantee<>procedure.proowner AND acl.is_grantable)
                      )=0
                     FROM pg_catalog.aclexplode(COALESCE(
                            procedure.proacl,
                            pg_catalog.acldefault('f',procedure.proowner)
                          )) acl
                 ))
                FROM pg_catalog.pg_proc procedure
                JOIN pg_catalog.pg_namespace namespace
                  ON namespace.oid=procedure.pronamespace
               WHERE namespace.nspname='composer_owner_api'
            )
            AND bool_and(relowner=relations.proowner)
            AND NOT bool_or(EXISTS (
              SELECT 1
                FROM pg_catalog.aclexplode(COALESCE(
                       relacl,
                       pg_catalog.acldefault('r', relowner)
                     )) acl
               WHERE acl.grantee<>relowner
            ))
            AND NOT bool_or(EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger_fact WHERE trigger_fact.tgrelid=relations.oid AND NOT trigger_fact.tgisinternal))
            AND NOT bool_or(EXISTS (SELECT 1 FROM pg_catalog.pg_policy policy WHERE policy.polrelid=relations.oid))
            AND NOT bool_or(EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rewrite WHERE rewrite.ev_class=relations.oid AND rewrite.rulename<>'_RETURN'))
            AND NOT bool_or(EXISTS (SELECT 1 FROM pg_catalog.pg_inherits inheritance WHERE inheritance.inhrelid=relations.oid OR inheritance.inhparent=relations.oid))
            AND (SELECT nspowner=proowner FROM target)
            AND (SELECT prosrc=$2
                   AND prolang=(
                     SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql'
                   )
                   AND prokind='f'
                   AND proretset
                   AND prosecdef
                   AND provolatile='v'
                   AND proparallel='u'
                   AND proisstrict
                   AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
                   AND NOT rolreplication AND NOT rolbypassrls
                   AND proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
                   AND (
                     caller_oid=proowner
                     OR (
                       caller_oid IN (rd_owner_oid,fact_writer_oid)
                       AND NOT pg_catalog.pg_has_role(caller_oid, proowner, 'MEMBER')
                       AND NOT pg_catalog.pg_has_role(proowner, caller_oid, 'MEMBER')
                       AND pg_catalog.has_schema_privilege(caller_oid, namespace_oid, 'USAGE')
                       AND pg_catalog.has_function_privilege(caller_oid, oid, 'EXECUTE')
                     )
                   )
                   AND NOT EXISTS (
                     SELECT 1
                      FROM pg_catalog.aclexplode(COALESCE(
                             proacl,
                             pg_catalog.acldefault('f', proowner)
                            )) acl
                      WHERE acl.privilege_type<>'EXECUTE'
                         OR acl.grantee NOT IN (proowner, rd_owner_oid, fact_writer_oid)
                         OR (acl.grantee IN (rd_owner_oid,fact_writer_oid) AND acl.is_grantable)
                   )
                   AND NOT EXISTS (
                     SELECT 1
                      FROM pg_catalog.aclexplode(COALESCE(
                             nspacl,
                             pg_catalog.acldefault('n', nspowner)
                            )) acl
                      WHERE acl.privilege_type NOT IN ('USAGE','CREATE')
                         OR acl.grantee NOT IN (nspowner, rd_owner_oid, fact_writer_oid)
                         OR (acl.grantee IN (rd_owner_oid,fact_writer_oid)
                             AND (acl.privilege_type<>'USAGE' OR acl.is_grantable))
                   )
                 FROM target)
            AND NOT bool_or(
              (SELECT caller_oid<>proowner FROM target)
              AND pg_catalog.has_table_privilege(
                (SELECT caller_oid FROM target),
                relations.oid,
                'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
              )
            )
           FROM relations",
    )
    .bind(SEALED_READ_FUNCTION_V2)
    .bind(SEALED_READ_FUNCTION_SOURCE_V2)
    .bind(COMMIT_FUNCTION_V2)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    if !authority_is_exact {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    let column_shape = sqlx::query_scalar::<_, String>("SELECT relation.relname||':'||attribute.attnum||':'||attribute.attname||':'||pg_catalog.format_type(attribute.atttypid,attribute.atttypmod)||':'||attribute.attnotnull||':'||COALESCE(pg_catalog.pg_get_expr(default_fact.adbin,default_fact.adrelid),'') FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped LEFT JOIN pg_catalog.pg_attrdef default_fact ON default_fact.adrelid=relation.oid AND default_fact.adnum=attribute.attnum WHERE namespace.nspname='composer_private' AND relation.relname=ANY($1) ORDER BY relation.relname,attribute.attnum")
        .bind(COMPOSER_TABLES_V2.as_slice()).fetch_all(&mut **transaction).await.map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    let expected_column_shape = [
        "rd_develop_artifact_modules_v2:1:artifact_identity:bytea:true:",
        "rd_develop_artifact_modules_v2:2:ordinal:integer:true:",
        "rd_develop_artifact_modules_v2:3:module_bytes:bytea:true:",
        "rd_develop_artifacts_v2:1:artifact_identity:bytea:true:",
        "rd_develop_artifacts_v2:2:plan_digest:bytea:true:",
        "rd_develop_artifacts_v2:3:package_bytes:bytea:true:",
        "rd_develop_build_receipts_v2:1:receipt_identity:bytea:true:",
        "rd_develop_build_receipts_v2:2:build_attempt_identity:bytea:true:",
        "rd_develop_build_receipts_v2:3:capsule_identity:bytea:true:",
        "rd_develop_build_receipts_v2:4:artifact_identity:bytea:true:",
        "rd_develop_build_receipts_v2:5:ordinal:integer:true:",
        "rd_develop_build_receipts_v2:6:canonical_bytes:bytea:true:",
        "rd_develop_composer_receipts_v2:1:artifact_identity:bytea:true:",
        "rd_develop_composer_receipts_v2:2:canonical_bytes:bytea:true:",
        "rd_develop_designs_v2:1:design_identity:bytea:true:",
        "rd_develop_designs_v2:2:canonical_bytes:bytea:true:",
        "rd_develop_host_receipts_v2:1:artifact_identity:bytea:true:",
        "rd_develop_host_receipts_v2:2:canonical_bytes:bytea:true:",
        "rd_develop_operations_v2:1:request_identity:text:true:",
        "rd_develop_operations_v2:2:request_digest:bytea:true:",
        "rd_develop_operations_v2:3:research_request_identity:bytea:true:",
        "rd_develop_operations_v2:4:intent_identity:bytea:true:",
        "rd_develop_operations_v2:5:artifact_identity:bytea:true:",
        "rd_develop_operations_v2:6:canonical_receipt_bytes:bytea:true:",
        "rd_develop_operations_v2:7:response_bytes:bytea:true:",
        "rd_develop_outbox_v2:1:request_identity:text:true:",
        "rd_develop_outbox_v2:2:canonical_bytes:bytea:true:",
        "rd_develop_plans_v2:1:plan_digest:bytea:true:",
        "rd_develop_plans_v2:2:design_identity:bytea:true:",
        "rd_develop_plans_v2:3:canonical_bytes:bytea:true:",
    ];

    if column_shape
        .iter()
        .map(String::as_str)
        .ne(expected_column_shape)
    {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    let dependency_shape_is_exact: bool = sqlx::query_scalar("WITH family AS (SELECT relation.oid,relation.relname FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='composer_private' AND relation.relname=ANY($1)) SELECT (SELECT count(*)=17 AND NOT bool_or((family.relname,constraint_fact.contype::text,constraint_fact.conkey::text) NOT IN (VALUES ('rd_develop_designs_v2','p','1'),('rd_develop_plans_v2','p','1'),('rd_develop_plans_v2','u','2'),('rd_develop_artifacts_v2','p','1'),('rd_develop_artifacts_v2','u','2'),('rd_develop_artifact_modules_v2','p','1 2'),('rd_develop_build_receipts_v2','p','1'),('rd_develop_build_receipts_v2','u','2'),('rd_develop_build_receipts_v2','u','3'),('rd_develop_build_receipts_v2','u','4 5'),('rd_develop_composer_receipts_v2','p','1'),('rd_develop_host_receipts_v2','p','1'),('rd_develop_operations_v2','p','1'),('rd_develop_operations_v2','u','3'),('rd_develop_operations_v2','u','4'),('rd_develop_operations_v2','u','5'),('rd_develop_outbox_v2','p','1'))) FROM pg_catalog.pg_constraint constraint_fact JOIN family ON family.oid=constraint_fact.conrelid WHERE constraint_fact.contype IN ('p','u')) AND (SELECT count(*)=8 AND NOT bool_or((source.relname,constraint_fact.conkey::text,target.relname,constraint_fact.confkey::text) NOT IN (VALUES ('rd_develop_plans_v2','2','rd_develop_designs_v2','1'),('rd_develop_artifacts_v2','2','rd_develop_plans_v2','1'),('rd_develop_artifact_modules_v2','1','rd_develop_artifacts_v2','1'),('rd_develop_build_receipts_v2','4','rd_develop_artifacts_v2','1'),('rd_develop_composer_receipts_v2','1','rd_develop_artifacts_v2','1'),('rd_develop_host_receipts_v2','1','rd_develop_artifacts_v2','1'),('rd_develop_operations_v2','5','rd_develop_artifacts_v2','1'),('rd_develop_outbox_v2','1','rd_develop_operations_v2','1'))) FROM pg_catalog.pg_constraint constraint_fact JOIN family source ON source.oid=constraint_fact.conrelid JOIN family target ON target.oid=constraint_fact.confrelid WHERE constraint_fact.contype='f') AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conrelid IN (SELECT oid FROM family) AND constraint_fact.contype NOT IN ('p','u','f')) AND (SELECT count(*)=17 AND bool_and(index_fact.indisvalid AND index_fact.indisready AND index_fact.indislive AND index_fact.indisunique AND index_fact.indexprs IS NULL AND index_fact.indpred IS NULL AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conindid=index_fact.indexrelid)) FROM pg_catalog.pg_index index_fact WHERE index_fact.indrelid IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint inbound WHERE inbound.confrelid IN (SELECT oid FROM family) AND inbound.conrelid NOT IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint outbound WHERE outbound.conrelid IN (SELECT oid FROM family) AND outbound.contype='f' AND outbound.confrelid NOT IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_rel publication WHERE publication.prrelid IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rewrite WHERE rewrite.ev_class IN (SELECT oid FROM family) AND rewrite.rulename='_RETURN')")
        .bind(COMPOSER_TABLES_V2.as_slice()).fetch_one(&mut **transaction).await.map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    if !dependency_shape_is_exact {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    let constraint_options_are_exact: bool = sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint constraint_fact JOIN pg_catalog.pg_class relation ON relation.oid=constraint_fact.conrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='composer_private' AND relation.relname=ANY($1) AND (NOT constraint_fact.convalidated OR constraint_fact.condeferrable OR constraint_fact.condeferred OR constraint_fact.connoinherit OR (constraint_fact.contype='f' AND (constraint_fact.confupdtype<>'a' OR constraint_fact.confdeltype<>'a' OR constraint_fact.confmatchtype<>'s'))))")
        .bind(COMPOSER_TABLES_V2.as_slice()).fetch_one(&mut **transaction).await.map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    if !constraint_options_are_exact {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    let index_options_are_exact: bool = sqlx::query_scalar("SELECT count(*)=17 AND bool_and(index_fact.indisvalid AND index_fact.indisready AND index_fact.indislive AND index_fact.indisunique AND NOT index_fact.indnullsnotdistinct AND index_fact.indexprs IS NULL AND index_fact.indpred IS NULL AND index_method.amname='btree' AND index_relation.reltablespace=0 AND index_relation.reloptions IS NULL AND pg_catalog.pg_get_userbyid(index_relation.relowner)='composer_owner' AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indclass::oid[]) class_oid JOIN pg_catalog.pg_opclass operator_class ON operator_class.oid=class_oid WHERE NOT operator_class.opcdefault) AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indoption::smallint[]) option_value WHERE option_value<>0) AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indkey::smallint[],index_fact.indcollation::oid[]) key_fact(attnum,collation_oid) JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=index_fact.indrelid AND attribute.attnum=key_fact.attnum WHERE key_fact.collation_oid<>attribute.attcollation)) FROM pg_catalog.pg_index index_fact JOIN pg_catalog.pg_class relation ON relation.oid=index_fact.indrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace JOIN pg_catalog.pg_class index_relation ON index_relation.oid=index_fact.indexrelid JOIN pg_catalog.pg_am index_method ON index_method.oid=index_relation.relam WHERE namespace.nspname='composer_private' AND relation.relname=ANY($1)")
        .bind(COMPOSER_TABLES_V2.as_slice()).fetch_one(&mut **transaction).await.map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    if !index_options_are_exact {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    Ok(())
}

async fn verify_composer_commit_authority_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), sqlx::Error> {
    let exact: bool = sqlx::query_scalar(
        "SELECT SESSION_USER='rd_fact_writer' AND procedure.prosrc=$2
            AND pg_catalog.pg_get_userbyid(procedure.proowner)='composer_owner'
            AND language.lanname='plpgsql' AND procedure.prokind='f'
            AND NOT procedure.proretset AND procedure.prosecdef AND procedure.proisstrict
            AND procedure.provolatile='v' AND procedure.proparallel='u'
            AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
            AND (
              SELECT count(*)=2
                 AND count(*) FILTER (
                   WHERE acl.grantee=procedure.proowner
                     AND acl.privilege_type='EXECUTE'
                 )=1
                 AND count(*) FILTER (
                   WHERE acl.grantee=(
                     SELECT oid FROM pg_catalog.pg_roles
                      WHERE rolname='rd_fact_writer'
                   )
                     AND acl.privilege_type='EXECUTE'
                     AND NOT acl.is_grantable
                 )=1
                 AND count(*) FILTER (WHERE acl.grantee=0)=0
                 AND count(*) FILTER (
                   WHERE acl.privilege_type<>'EXECUTE'
                      OR acl.grantee NOT IN (
                        procedure.proowner,
                        (SELECT oid FROM pg_catalog.pg_roles
                          WHERE rolname='rd_fact_writer')
                      )
                      OR (acl.grantee<>procedure.proowner AND acl.is_grantable)
                 )=0
                FROM pg_catalog.aclexplode(COALESCE(
                       procedure.proacl,
                       pg_catalog.acldefault('f',procedure.proowner)
                     )) acl
            )
           FROM pg_catalog.pg_proc procedure
           JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang
          WHERE procedure.oid=pg_catalog.to_regprocedure($1)",
    )
    .bind(COMMIT_FUNCTION_V2)
    .bind(COMMIT_FUNCTION_SOURCE_V2)
    .fetch_one(&mut **transaction)
    .await?;

    if exact {
        Ok(())
    } else {
        Err(sqlx::Error::Protocol(
            "Composer commit authority is unavailable".to_owned(),
        ))
    }
}

fn exact_ordinal_array(
    ordinals: &[i32],
    values_len: usize,
) -> Result<(), DevelopComposerSealedReadErrorV2> {
    if ordinals.len() != values_len
        || ordinals
            .iter()
            .enumerate()
            .any(|(expected, actual)| usize::try_from(*actual).ok() != Some(expected))
    {
        return Err(DevelopComposerSealedReadErrorV2::Unavailable);
    }
    Ok(())
}

fn sealed_digest_column(
    row: &sqlx::postgres::PgRow,
    name: &str,
) -> Result<BindingDigest, DevelopComposerSealedReadErrorV2> {
    let bytes = sealed_bytes_column(row, name)?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    Ok(BindingDigest::from_untrusted_bytes(bytes))
}

fn sealed_digest_array(
    row: &sqlx::postgres::PgRow,
    name: &str,
) -> Result<Vec<BindingDigest>, DevelopComposerSealedReadErrorV2> {
    row.try_get::<Vec<Vec<u8>>, _>(name)
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?
        .into_iter()
        .map(|bytes| {
            let bytes: [u8; 32] = bytes
                .try_into()
                .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
            Ok(BindingDigest::from_untrusted_bytes(bytes))
        })
        .collect()
}

fn sealed_bytes_column(
    row: &sqlx::postgres::PgRow,
    name: &str,
) -> Result<Vec<u8>, DevelopComposerSealedReadErrorV2> {
    row.try_get(name)
        .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)
}

#[derive(Clone)]
pub struct PostgresDevelopComposerStoreV2 {
    pool: PgPool,
}

impl PostgresDevelopComposerStoreV2 {
    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(8)
            .connect(database_url)
            .await?;
        Self::migrate(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
        let mut transaction = pool.begin().await?;
        verify_composer_read_authority_in_transaction(&mut transaction)
            .await
            .map_err(|_| {
                sqlx::Error::Protocol("Composer authority topology is unavailable".to_owned())
            })?;
        transaction.rollback().await
    }

    pub async fn resolve(
        &self,
        request_identity: &str,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        Ok(unavailable_response(
            request_identity,
            "current Owner evidence is unavailable for public durable RESOLVE",
        ))
    }

    pub(crate) async fn resolve_with_evidence(
        &self,
        request_identity: &str,
        evidence: &impl DevelopComposerFinalEvidencePortV2,
        read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        let record = match load_record(&self.pool, request_identity).await {
            Ok(Some(record)) => record,
            Ok(None) => {
                return Ok(unavailable_response(
                    request_identity,
                    "terminal is unavailable",
                ));
            }
            Err(e) if is_record_integrity_error(&e) => {
                return Ok(unavailable_response(
                    request_identity,
                    "stored terminal custody is incomplete or malformed",
                ));
            }
            Err(e) => return Err(e),
        };
        Ok(resolve_loaded_record_with_evidence(
            &record,
            evidence,
            read_cut_epoch_ms,
        ))
    }

    pub(crate) async fn run(
        &self,
        builder: &mut impl DevelopComposerA0BuildPortV2,
        evidence: &impl DevelopComposerFinalEvidencePortV2,
        request: &DevelopComposerRunRequestV2,
        read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        self.run_with_fault(builder, evidence, request, read_cut_epoch_ms, None)
            .await
    }

    async fn run_with_fault(
        &self,
        builder: &mut impl DevelopComposerA0BuildPortV2,
        evidence: &impl DevelopComposerFinalEvidencePortV2,
        request: &DevelopComposerRunRequestV2,
        read_cut_epoch_ms: u64,
        fail_after_boundary: Option<usize>,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        acquire_advisory_locks(
            &mut transaction,
            &[request_lock_key(&request.request_identity)],
        )
        .await?;

        let existing =
            match load_record_in_transaction(&mut transaction, &request.request_identity).await {
                Ok(existing) => existing,
                Err(sqlx::Error::Protocol(message))
                    if message == SEALED_READ_UNAVAILABLE_PROTOCOL_V2 =>
                {
                    transaction.rollback().await?;
                    return Ok(unavailable_response(
                        &request.request_identity,
                        SEALED_READ_UNAVAILABLE_PROTOCOL_V2,
                    ));
                }
                Err(e) if is_record_integrity_error(&e) => {
                    transaction.rollback().await?;
                    return Ok(unavailable_response(
                        &request.request_identity,
                        "stored terminal custody is incomplete or malformed",
                    ));
                }
                Err(e) => return Err(e),
            };

        if let Some(existing) = existing {
            let response = if existing.request_digest == request_digest(request) {
                evidence
                    .lock_and_reread(request, existing.design_identity, read_cut_epoch_ms)
                    .and_then(|current| resolve_positive_record_v2(&existing, current))
                    .unwrap_or_else(|terminal| terminal_response(request, terminal))
            } else {
                DevelopComposerOperationResponseV2 {
                    schema_version: 2,
                    request_identity: request.request_identity.clone(),
                    disposition: DevelopComposerOperationDispositionV2::Conflict,
                    receipt_identity: None,
                    artifact: None,
                    coordinate: Some("request_identity".to_owned()),
                    reason: Some(
                        "identity is already bound to different canonical meaning".to_owned(),
                    ),
                }
            };
            transaction.rollback().await?;
            return Ok(response);
        }
        let preflight = match preflight_develop_composer_v2(evidence, request, read_cut_epoch_ms) {
            Ok(preflight) => preflight,
            Err(terminal) => {
                transaction.rollback().await?;
                return Ok(terminal_response(request, terminal));
            }
        };
        acquire_advisory_locks(&mut transaction, &preflight_lock_keys(&preflight)).await?;
        let (record, current) = match build_positive_record_from_preflight_v2(
            builder,
            evidence,
            request,
            read_cut_epoch_ms,
            preflight,
        ) {
            Ok(record) => record,
            Err(terminal) => {
                transaction.rollback().await?;
                return Ok(terminal_response(request, terminal));
            }
        };
        acquire_advisory_locks(&mut transaction, &postbuild_lock_keys(&record)).await?;

        if let Err(e) = persist_record(
            &mut transaction,
            &record,
            current.bindings.clone(),
            fail_after_boundary,
        )
        .await
        {
            let unique_violation = e
                .as_database_error()
                .is_some_and(|database| database.is_unique_violation());
            transaction.rollback().await?;

            if unique_violation {
                return Ok(conflict_response(
                    &request.request_identity,
                    "operation.semantic_identity",
                ));
            }
            return Err(e);
        }
        let stored = match load_record_via_sealed_routine_in_transaction(
            &mut transaction,
            &request.request_identity,
        )
        .await
        {
            Ok(Some(stored)) => stored,
            _ => {
                transaction.rollback().await?;
                return Err(sqlx::Error::Protocol(
                    "fresh Composer custody is absent or malformed".to_owned(),
                ));
            }
        };
        let response = match resolve_positive_record_v2(&stored, current) {
            Ok(response) => response,
            Err(terminal) => {
                transaction.rollback().await?;
                return Err(sqlx::Error::Protocol(format!(
                    "fresh Composer record failed readback: {}",
                    terminal.reason
                )));
            }
        };

        match transaction.commit().await {
            Ok(()) => Ok(response),
            Err(_) => Ok(DevelopComposerOperationResponseV2::submitted_or_unknown(
                &request.request_identity,
            )),
        }
    }

    #[cfg(test)]
    pub(crate) async fn run_with_fault_for_test(
        &self,
        builder: &mut impl DevelopComposerA0BuildPortV2,
        evidence: &impl DevelopComposerFinalEvidencePortV2,
        request: &DevelopComposerRunRequestV2,
        read_cut_epoch_ms: u64,
        fail_after_boundary: usize,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        self.run_with_fault(
            builder,
            evidence,
            request,
            read_cut_epoch_ms,
            Some(fail_after_boundary),
        )
        .await
    }
}

pub(crate) fn resolve_loaded_record_with_evidence(
    record: &StoredDevelopComposerPositiveV2,
    evidence: &impl DevelopComposerFinalEvidencePortV2,
    read_cut_epoch_ms: u64,
) -> DevelopComposerOperationResponseV2 {
    evidence
        .lock_and_reread_durable(
            &DevelopComposerDurableEvidenceLocatorV2::from_record(record),
            read_cut_epoch_ms,
        )
        .and_then(|current| resolve_positive_record_v2(record, current))
        .unwrap_or_else(|terminal| DevelopComposerOperationResponseV2 {
            schema_version: 2,
            request_identity: record.request_identity.clone(),
            disposition: DevelopComposerOperationDispositionV2::Unavailable,
            receipt_identity: None,
            artifact: None,
            coordinate: Some(terminal.coordinate),
            reason: Some(terminal.reason),
        })
}

async fn acquire_advisory_locks(
    transaction: &mut Transaction<'_, Postgres>,
    keys: &[String],
) -> Result<(), sqlx::Error> {
    let keys = keys.iter().collect::<BTreeSet<_>>();
    for key in keys {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(key)
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}

fn preflight_lock_keys(preflight: &DevelopComposerPreflightV2) -> Vec<String> {
    let mut keys = vec![
        lock_key(
            "10:rd.develop.research.v2",
            preflight.research_request_identity,
        ),
        lock_key("20:rd.develop.intent.v2", preflight.intent_identity),
        lock_key("30:rd.develop.design.v2", preflight.design_identity),
    ];
    keys.extend(
        preflight
            .build_attempt_identities
            .iter()
            .map(|identity| lock_key("40:rd.develop.build-attempt.v2", *identity)),
    );
    keys.extend(
        preflight
            .capsule_identities
            .iter()
            .map(|identity| lock_key("50:rd.develop.capsule.v2", *identity)),
    );
    keys.sort();
    keys
}

fn postbuild_lock_keys(record: &StoredDevelopComposerPositiveV2) -> Vec<String> {
    let mut keys = vec![lock_key(
        "60:rd.develop.artifact.v2",
        record.artifact_identity,
    )];
    keys.extend(
        record
            .build_receipt_identities
            .iter()
            .map(|identity| lock_key("70:rd.develop.build-receipt.v2", *identity)),
    );
    keys.sort();
    keys
}

fn lock_key(domain: &str, identity: BindingDigest) -> String {
    let suffix = identity
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{domain}:{suffix}")
}

fn request_lock_key(request_identity: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"rd.develop.request-lock.identity.v2\0");
    hasher.update(request_identity.as_bytes());
    lock_key(
        "00:rd.develop.request.v2",
        BindingDigest::from_untrusted_bytes(hasher.finalize().into()),
    )
}

fn terminal_response(
    request: &DevelopComposerRunRequestV2,
    terminal: crate::develop_composer_v2::DevelopComposerTerminalV2,
) -> DevelopComposerOperationResponseV2 {
    DevelopComposerOperationResponseV2 {
        schema_version: 2,
        request_identity: request.request_identity.clone(),
        disposition: match terminal.kind {
            crate::develop_composer_v2::DevelopComposerTerminalKindV2::Conflict => {
                DevelopComposerOperationDispositionV2::Conflict
            }
            crate::develop_composer_v2::DevelopComposerTerminalKindV2::Unsupported => {
                DevelopComposerOperationDispositionV2::Unsupported
            }
            crate::develop_composer_v2::DevelopComposerTerminalKindV2::NeedsResearchRefinement => {
                DevelopComposerOperationDispositionV2::NeedsResearchRefinement
            }
            crate::develop_composer_v2::DevelopComposerTerminalKindV2::Unavailable => {
                DevelopComposerOperationDispositionV2::Unavailable
            }
        },
        receipt_identity: None,
        artifact: None,
        coordinate: Some(terminal.coordinate),
        reason: Some(terminal.reason),
    }
}

async fn persist_record(
    transaction: &mut Transaction<'_, Postgres>,
    record: &StoredDevelopComposerPositiveV2,
    current_bindings: crate::strategy_plan_v2::VerifiedStrategyInputBindingsV2,
    fail_after_boundary: Option<usize>,
) -> Result<(), sqlx::Error> {
    verify_composer_commit_authority_in_transaction(transaction).await?;
    let plan = crate::strategy_plan_v2::StrategyPlanV2::parse_and_revalidate_durable(
        &record.plan_bytes,
        current_bindings,
    )
    .map_err(sqlx::Error::Protocol)?;
    if let Some(boundary) = fail_after_boundary {
        return Err(sqlx::Error::Protocol(format!(
            "injected Composer write-boundary failure {boundary}"
        )));
    }
    let module_bytes = record
        .module_bytes
        .iter()
        .map(|bytes| bytes.to_vec())
        .collect::<Vec<_>>();
    let receipt_identities = record
        .build_receipt_identities
        .iter()
        .map(|value| value.as_bytes().to_vec())
        .collect::<Vec<_>>();
    let attempt_identities = record
        .build_attempt_identities
        .iter()
        .map(|value| value.as_bytes().to_vec())
        .collect::<Vec<_>>();
    let capsule_identities = record
        .capsule_identities
        .iter()
        .map(|value| value.as_bytes().to_vec())
        .collect::<Vec<_>>();
    let committed: bool = sqlx::query_scalar("SELECT composer_owner_api.commit_develop_composer_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)")
        .bind(&record.request_identity)
        .bind(record.request_digest.as_bytes().as_slice())
        .bind(record.research_request_identity.as_bytes().as_slice())
        .bind(record.intent_identity.as_bytes().as_slice())
        .bind(record.artifact_identity.as_bytes().as_slice())
        .bind(plan.design_identity().as_bytes().as_slice())
        .bind(plan.canonical_plan_digest().as_bytes().as_slice())
        .bind(&record.design_bytes)
        .bind(&record.plan_bytes)
        .bind(&record.artifact_package_bytes)
        .bind(module_bytes)
        .bind(receipt_identities)
        .bind(attempt_identities)
        .bind(capsule_identities)
        .bind(&record.build_receipt_bytes)
        .bind(&record.composer_receipt_bytes)
        .bind(&record.host_receipt_bytes)
        .bind(&record.operation_receipt_bytes)
        .bind(&record.response_bytes)
        .bind(&record.outbox_bytes)
        .fetch_one(&mut **transaction)
        .await?;

    if committed {
        Ok(())
    } else {
        Err(sqlx::Error::Protocol(
            "Composer owner rejected commit envelope".to_owned(),
        ))
    }
}

async fn load_record(
    pool: &PgPool,
    request_identity: &str,
) -> Result<Option<StoredDevelopComposerPositiveV2>, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let record = load_record_in_transaction(&mut transaction, request_identity).await?;
    transaction.commit().await?;
    Ok(record)
}

async fn load_record_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<Option<StoredDevelopComposerPositiveV2>, sqlx::Error> {
    load_record_via_sealed_routine_in_transaction(transaction, request_identity)
        .await
        .map_err(|_| sqlx::Error::Protocol(SEALED_READ_UNAVAILABLE_PROTOCOL_V2.to_owned()))
}

fn exact_ordinal(row: &sqlx::postgres::PgRow, expected: usize) -> Result<(), sqlx::Error> {
    let expected = i32::try_from(expected)
        .map_err(|_| sqlx::Error::Protocol("Composer ordinal overflow".to_owned()))?;
    let actual = row.try_get::<i32, _>("ordinal")?;
    if actual != expected {
        return Err(sqlx::Error::Protocol(format!(
            "Composer ordinal mismatch: expected {expected}, found {actual}"
        )));
    }
    Ok(())
}

fn digest_column(row: &sqlx::postgres::PgRow, name: &str) -> Result<BindingDigest, sqlx::Error> {
    let bytes: Vec<u8> = row.try_get(name)?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| sqlx::Error::Protocol(format!("{name} is not an exact 32-byte digest")))?;
    Ok(BindingDigest::from_untrusted_bytes(bytes))
}

fn unavailable_response(
    request_identity: &str,
    reason: &str,
) -> DevelopComposerOperationResponseV2 {
    DevelopComposerOperationResponseV2 {
        schema_version: 2,
        request_identity: request_identity.to_owned(),
        disposition: DevelopComposerOperationDispositionV2::Unavailable,
        receipt_identity: None,
        artifact: None,
        coordinate: Some("operation".to_owned()),
        reason: Some(reason.to_owned()),
    }
}

fn is_record_integrity_error(error: &sqlx::Error) -> bool {
    match error {
        sqlx::Error::RowNotFound => true,
        sqlx::Error::Protocol(message) => {
            message.starts_with("Composer ordinal mismatch:")
                || message.ends_with(" is not an exact 32-byte digest")
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    #[rstest]
    fn composer_authority_rejects_public_execute_on_commit() {
        let source = include_str!("develop_composer_postgres_v2.rs");
        let read_authority = source
            .split("async fn verify_composer_read_authority_in_transaction")
            .nth(1)
            .expect("Composer read authority")
            .split("async fn verify_composer_commit_authority_in_transaction")
            .next()
            .expect("bounded Composer read authority");
        assert!(read_authority.contains("pg_catalog.to_regprocedure($3)"));
        assert!(read_authority.contains(".bind(COMMIT_FUNCTION_V2)"));
        assert!(read_authority.contains("WHEN 'commit_develop_composer_v2' THEN 2 ELSE 3 END"));
        assert!(read_authority.contains("WHEN 'commit_develop_composer_v2' THEN 0 ELSE 1 END"));
        assert!(read_authority.contains("count(*) FILTER (WHERE acl.grantee=0)=0"));

        let commit_authority = source
            .split("async fn verify_composer_commit_authority_in_transaction")
            .nth(1)
            .expect("Composer commit authority")
            .split("fn exact_ordinal_array")
            .next()
            .expect("bounded Composer commit authority");
        assert!(commit_authority.contains("SESSION_USER='rd_fact_writer'"));
        assert!(commit_authority.contains("SELECT count(*)=2"));
        assert!(commit_authority.contains("count(*) FILTER (WHERE acl.grantee=0)=0"));
    }
}
