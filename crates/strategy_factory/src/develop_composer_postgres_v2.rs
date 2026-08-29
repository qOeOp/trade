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
    DevelopComposerFinalEvidencePortV2, DevelopComposerOperationDispositionV2,
    DevelopComposerOperationResponseV2, DevelopComposerPreflightV2, DevelopComposerRunRequestV2,
    StoredDevelopComposerPositiveV2, build_positive_record_from_preflight_v2, conflict_response,
    preflight_develop_composer_v2, request_digest, resolve_positive_record_v2,
};

const SEALED_READ_SCHEMA_V2: u16 = 2;

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
        let record = load_record(&self.store.pool, &locator.request_identity)
            .await
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?
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
        let response = resolve_positive_record_v2(&record, current)
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
        seal_readback(locator, record, &response)
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
        lock_composer_tables_for_consistent_read(&mut transaction).await?;
        let record = load_record_in_transaction(&mut transaction, &locator.request_identity)
            .await
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?
            .ok_or(DevelopComposerSealedReadErrorV2::Unavailable)?;
        let response = self
            .owner
            .resolve(&locator.request_identity)
            .await
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
        if !accepted_response_matches_locator(locator, &response) {
            return Err(DevelopComposerSealedReadErrorV2::Unavailable);
        }

        let readback = seal_readback(locator, record, &response)?;
        transaction
            .commit()
            .await
            .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
        Ok(readback)
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
async fn lock_composer_tables_for_consistent_read(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), DevelopComposerSealedReadErrorV2> {
    sqlx::query(
        "LOCK TABLE
           rd_develop_designs_v2,
           rd_develop_plans_v2,
           rd_develop_artifacts_v2,
           rd_develop_artifact_modules_v2,
           rd_develop_build_receipts_v2,
           rd_develop_composer_receipts_v2,
           rd_develop_host_receipts_v2,
           rd_develop_operations_v2,
           rd_develop_outbox_v2
         IN SHARE MODE",
    )
    .execute(&mut **transaction)
    .await
    .map_err(|_| DevelopComposerSealedReadErrorV2::Unavailable)?;
    Ok(())
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
        for &statement in MIGRATION_STATEMENTS_V2 {
            sqlx::query(statement).execute(pool).await?;
        }
        Ok(())
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
        if preflight_identity_conflicts(&mut transaction, &preflight).await? {
            transaction.rollback().await?;
            return Ok(conflict_response(
                &request.request_identity,
                "operation.semantic_identity",
            ));
        }
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
        if identity_conflicts(&mut transaction, &record).await? {
            transaction.rollback().await?;
            return Ok(conflict_response(
                &request.request_identity,
                "operation.semantic_identity",
            ));
        }

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
        let response = match resolve_positive_record_v2(&record, current) {
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

async fn preflight_identity_conflicts(
    transaction: &mut Transaction<'_, Postgres>,
    preflight: &DevelopComposerPreflightV2,
) -> Result<bool, sqlx::Error> {
    let research_or_intent = sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT request_digest
           FROM rd_develop_operations_v2
          WHERE research_request_identity=$1 OR intent_identity=$2
          LIMIT 1",
    )
    .bind(preflight.research_request_identity.as_bytes().as_slice())
    .bind(preflight.intent_identity.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await?;

    if digest_conflicts(research_or_intent.as_deref(), preflight.request_digest) {
        return Ok(true);
    }
    let design = sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT operation.request_digest
           FROM rd_develop_plans_v2 plan
           JOIN rd_develop_artifacts_v2 artifact ON artifact.plan_digest=plan.plan_digest
           JOIN rd_develop_operations_v2 operation ON operation.artifact_identity=artifact.artifact_identity
          WHERE plan.design_identity=$1
          LIMIT 1",
    )
    .bind(preflight.design_identity.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await?;

    if digest_conflicts(design.as_deref(), preflight.request_digest) {
        return Ok(true);
    }

    for (attempt, capsule) in preflight
        .build_attempt_identities
        .iter()
        .zip(&preflight.capsule_identities)
    {
        let build = sqlx::query_scalar::<_, Vec<u8>>(
            "SELECT operation.request_digest
               FROM rd_develop_build_receipts_v2 receipt
               JOIN rd_develop_operations_v2 operation
                 ON operation.artifact_identity=receipt.artifact_identity
              WHERE receipt.build_attempt_identity=$1 OR receipt.capsule_identity=$2
              LIMIT 1",
        )
        .bind(attempt.as_bytes().as_slice())
        .bind(capsule.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await?;

        if digest_conflicts(build.as_deref(), preflight.request_digest) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn digest_conflicts(existing: Option<&[u8]>, request_digest: BindingDigest) -> bool {
    existing.is_some_and(|digest| digest != request_digest.as_bytes())
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

async fn identity_conflicts(
    transaction: &mut Transaction<'_, Postgres>,
    record: &StoredDevelopComposerPositiveV2,
) -> Result<bool, sqlx::Error> {
    let existing = sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT request_digest
           FROM rd_develop_operations_v2
          WHERE research_request_identity=$1 OR intent_identity=$2 OR artifact_identity=$3
          LIMIT 1",
    )
    .bind(record.research_request_identity.as_bytes().as_slice())
    .bind(record.intent_identity.as_bytes().as_slice())
    .bind(record.artifact_identity.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await?;

    if existing
        .as_deref()
        .is_some_and(|digest| digest != record.request_digest.as_bytes())
    {
        return Ok(true);
    }

    for identity in &record.build_receipt_identities {
        let existing = sqlx::query_scalar::<_, Vec<u8>>(
            "SELECT operation.request_digest
               FROM rd_develop_build_receipts_v2 receipt
               JOIN rd_develop_operations_v2 operation
                 ON operation.artifact_identity=receipt.artifact_identity
              WHERE receipt.receipt_identity=$1",
        )
        .bind(identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await?;

        if existing
            .as_deref()
            .is_some_and(|digest| digest != record.request_digest.as_bytes())
        {
            return Ok(true);
        }
    }
    Ok(false)
}

const MIGRATION_STATEMENTS_V2: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS rd_develop_designs_v2 (design_identity BYTEA PRIMARY KEY, canonical_bytes BYTEA NOT NULL)",
    "CREATE TABLE IF NOT EXISTS rd_develop_plans_v2 (plan_digest BYTEA PRIMARY KEY, design_identity BYTEA NOT NULL UNIQUE REFERENCES rd_develop_designs_v2(design_identity), canonical_bytes BYTEA NOT NULL)",
    "CREATE TABLE IF NOT EXISTS rd_develop_artifacts_v2 (artifact_identity BYTEA PRIMARY KEY, plan_digest BYTEA NOT NULL UNIQUE REFERENCES rd_develop_plans_v2(plan_digest), package_bytes BYTEA NOT NULL)",
    "CREATE TABLE IF NOT EXISTS rd_develop_artifact_modules_v2 (artifact_identity BYTEA NOT NULL REFERENCES rd_develop_artifacts_v2(artifact_identity), ordinal INTEGER NOT NULL, module_bytes BYTEA NOT NULL, PRIMARY KEY (artifact_identity, ordinal))",
    "CREATE TABLE IF NOT EXISTS rd_develop_build_receipts_v2 (receipt_identity BYTEA PRIMARY KEY, build_attempt_identity BYTEA NOT NULL UNIQUE, capsule_identity BYTEA NOT NULL UNIQUE, artifact_identity BYTEA NOT NULL REFERENCES rd_develop_artifacts_v2(artifact_identity), ordinal INTEGER NOT NULL, canonical_bytes BYTEA NOT NULL, UNIQUE (artifact_identity, ordinal))",
    "CREATE TABLE IF NOT EXISTS rd_develop_composer_receipts_v2 (artifact_identity BYTEA PRIMARY KEY REFERENCES rd_develop_artifacts_v2(artifact_identity), canonical_bytes BYTEA NOT NULL)",
    "CREATE TABLE IF NOT EXISTS rd_develop_host_receipts_v2 (artifact_identity BYTEA PRIMARY KEY REFERENCES rd_develop_artifacts_v2(artifact_identity), canonical_bytes BYTEA NOT NULL)",
    "CREATE TABLE IF NOT EXISTS rd_develop_operations_v2 (request_identity TEXT PRIMARY KEY, request_digest BYTEA NOT NULL, research_request_identity BYTEA NOT NULL UNIQUE, intent_identity BYTEA NOT NULL UNIQUE, artifact_identity BYTEA NOT NULL UNIQUE REFERENCES rd_develop_artifacts_v2(artifact_identity), canonical_receipt_bytes BYTEA NOT NULL, response_bytes BYTEA NOT NULL)",
    "CREATE TABLE IF NOT EXISTS rd_develop_outbox_v2 (request_identity TEXT PRIMARY KEY REFERENCES rd_develop_operations_v2(request_identity), canonical_bytes BYTEA NOT NULL)",
    "REVOKE ALL ON TABLE rd_develop_designs_v2, rd_develop_plans_v2, rd_develop_artifacts_v2, rd_develop_artifact_modules_v2, rd_develop_build_receipts_v2, rd_develop_composer_receipts_v2, rd_develop_host_receipts_v2, rd_develop_operations_v2, rd_develop_outbox_v2 FROM PUBLIC",
];

async fn persist_record(
    transaction: &mut Transaction<'_, Postgres>,
    record: &StoredDevelopComposerPositiveV2,
    current_bindings: crate::strategy_plan_v2::VerifiedStrategyInputBindingsV2,
    fail_after_boundary: Option<usize>,
) -> Result<(), sqlx::Error> {
    let mut boundary = 0_usize;
    let plan = crate::strategy_plan_v2::StrategyPlanV2::parse_and_revalidate_durable(
        &record.plan_bytes,
        current_bindings,
    )
    .map_err(sqlx::Error::Protocol)?;
    sqlx::query(
        "INSERT INTO rd_develop_designs_v2 (design_identity, canonical_bytes) VALUES ($1,$2)",
    )
    .bind(plan.design_identity().as_bytes().as_slice())
    .bind(&record.design_bytes)
    .execute(&mut **transaction)
    .await?;
    fail(fail_after_boundary, &mut boundary)?;
    sqlx::query("INSERT INTO rd_develop_plans_v2 (plan_digest, design_identity, canonical_bytes) VALUES ($1,$2,$3)")
        .bind(plan.canonical_plan_digest().as_bytes().as_slice())
        .bind(plan.design_identity().as_bytes().as_slice())
        .bind(&record.plan_bytes)
        .execute(&mut **transaction)
        .await?;
    fail(fail_after_boundary, &mut boundary)?;
    sqlx::query("INSERT INTO rd_develop_artifacts_v2 (artifact_identity, plan_digest, package_bytes) VALUES ($1,$2,$3)")
        .bind(record.artifact_identity.as_bytes().as_slice())
        .bind(plan.canonical_plan_digest().as_bytes().as_slice())
        .bind(&record.artifact_package_bytes)
        .execute(&mut **transaction)
        .await?;
    fail(fail_after_boundary, &mut boundary)?;

    for (ordinal, bytes) in record.module_bytes.iter().enumerate() {
        sqlx::query("INSERT INTO rd_develop_artifact_modules_v2 (artifact_identity, ordinal, module_bytes) VALUES ($1,$2,$3)")
            .bind(record.artifact_identity.as_bytes().as_slice())
            .bind(i32::try_from(ordinal).map_err(|_| sqlx::Error::Protocol("module ordinal overflow".to_owned()))?)
            .bind(bytes.as_ref())
            .execute(&mut **transaction)
            .await?;
        fail(fail_after_boundary, &mut boundary)?;
    }

    for (ordinal, (((identity, attempt), capsule), bytes)) in record
        .build_receipt_identities
        .iter()
        .zip(&record.build_attempt_identities)
        .zip(&record.capsule_identities)
        .zip(&record.build_receipt_bytes)
        .enumerate()
    {
        sqlx::query("INSERT INTO rd_develop_build_receipts_v2 (receipt_identity, build_attempt_identity, capsule_identity, artifact_identity, ordinal, canonical_bytes) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(identity.as_bytes().as_slice())
            .bind(attempt.as_bytes().as_slice())
            .bind(capsule.as_bytes().as_slice())
            .bind(record.artifact_identity.as_bytes().as_slice())
            .bind(i32::try_from(ordinal).map_err(|_| sqlx::Error::Protocol("receipt ordinal overflow".to_owned()))?)
            .bind(bytes)
            .execute(&mut **transaction)
            .await?;
        fail(fail_after_boundary, &mut boundary)?;
    }

    for (statement, bytes) in [
        (
            "INSERT INTO rd_develop_composer_receipts_v2 (artifact_identity, canonical_bytes) VALUES ($1,$2)",
            &record.composer_receipt_bytes,
        ),
        (
            "INSERT INTO rd_develop_host_receipts_v2 (artifact_identity, canonical_bytes) VALUES ($1,$2)",
            &record.host_receipt_bytes,
        ),
    ] {
        sqlx::query(statement)
            .bind(record.artifact_identity.as_bytes().as_slice())
            .bind(bytes)
            .execute(&mut **transaction)
            .await?;
        fail(fail_after_boundary, &mut boundary)?;
    }
    sqlx::query("INSERT INTO rd_develop_operations_v2 (request_identity, request_digest, research_request_identity, intent_identity, artifact_identity, canonical_receipt_bytes, response_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7)")
        .bind(&record.request_identity)
        .bind(record.request_digest.as_bytes().as_slice())
        .bind(record.research_request_identity.as_bytes().as_slice())
        .bind(record.intent_identity.as_bytes().as_slice())
        .bind(record.artifact_identity.as_bytes().as_slice())
        .bind(&record.operation_receipt_bytes)
        .bind(&record.response_bytes)
        .execute(&mut **transaction)
        .await?;
    fail(fail_after_boundary, &mut boundary)?;
    sqlx::query(
        "INSERT INTO rd_develop_outbox_v2 (request_identity, canonical_bytes) VALUES ($1,$2)",
    )
    .bind(&record.request_identity)
    .bind(&record.outbox_bytes)
    .execute(&mut **transaction)
    .await?;
    fail(fail_after_boundary, &mut boundary)?;
    Ok(())
}

fn fail(target: Option<usize>, boundary: &mut usize) -> Result<(), sqlx::Error> {
    *boundary += 1;
    if target == Some(*boundary) {
        return Err(sqlx::Error::Protocol(format!(
            "injected Composer write-boundary failure {boundary}"
        )));
    }
    Ok(())
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
    let Some(operation) = sqlx::query("SELECT request_digest, research_request_identity, intent_identity, artifact_identity, canonical_receipt_bytes, response_bytes FROM rd_develop_operations_v2 WHERE request_identity=$1")
        .bind(request_identity)
        .fetch_optional(&mut **transaction)
        .await?
    else {
        return Ok(None);
    };
    let artifact_identity = digest_column(&operation, "artifact_identity")?;
    let artifact = sqlx::query(
        "SELECT plan_digest, package_bytes FROM rd_develop_artifacts_v2 WHERE artifact_identity=$1",
    )
    .bind(artifact_identity.as_bytes().as_slice())
    .fetch_one(&mut **transaction)
    .await?;
    let plan_digest = digest_column(&artifact, "plan_digest")?;
    let plan = sqlx::query(
        "SELECT design_identity, canonical_bytes FROM rd_develop_plans_v2 WHERE plan_digest=$1",
    )
    .bind(plan_digest.as_bytes().as_slice())
    .fetch_one(&mut **transaction)
    .await?;
    let design_identity = digest_column(&plan, "design_identity")?;
    let design_bytes = sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT canonical_bytes FROM rd_develop_designs_v2 WHERE design_identity=$1",
    )
    .bind(design_identity.as_bytes().as_slice())
    .fetch_one(&mut **transaction)
    .await?;
    let modules = sqlx::query("SELECT ordinal, module_bytes FROM rd_develop_artifact_modules_v2 WHERE artifact_identity=$1 ORDER BY ordinal")
        .bind(artifact_identity.as_bytes().as_slice())
        .fetch_all(&mut **transaction)
        .await?;
    let mut module_bytes = Vec::with_capacity(modules.len());
    for (expected, row) in modules.into_iter().enumerate() {
        exact_ordinal(&row, expected)?;
        module_bytes.push(
            row.try_get::<Vec<u8>, _>("module_bytes")?
                .into_boxed_slice(),
        );
    }
    let build_rows = sqlx::query("SELECT ordinal, receipt_identity, build_attempt_identity, capsule_identity, canonical_bytes FROM rd_develop_build_receipts_v2 WHERE artifact_identity=$1 ORDER BY ordinal")
        .bind(artifact_identity.as_bytes().as_slice())
        .fetch_all(&mut **transaction)
        .await?;
    let mut build_receipt_identities = Vec::with_capacity(build_rows.len());
    let mut build_attempt_identities = Vec::with_capacity(build_rows.len());
    let mut capsule_identities = Vec::with_capacity(build_rows.len());
    let mut build_receipt_bytes = Vec::with_capacity(build_rows.len());
    for (expected, row) in build_rows.into_iter().enumerate() {
        exact_ordinal(&row, expected)?;
        build_receipt_identities.push(digest_column(&row, "receipt_identity")?);
        build_attempt_identities.push(digest_column(&row, "build_attempt_identity")?);
        capsule_identities.push(digest_column(&row, "capsule_identity")?);
        build_receipt_bytes.push(row.try_get("canonical_bytes")?);
    }
    Ok(Some(StoredDevelopComposerPositiveV2 {
        request_identity: request_identity.to_owned(),
        request_digest: digest_column(&operation, "request_digest")?,
        research_request_identity: digest_column(&operation, "research_request_identity")?,
        intent_identity: digest_column(&operation, "intent_identity")?,
        design_identity,
        plan_digest,
        artifact_identity,
        build_attempt_identities,
        capsule_identities,
        build_receipt_identities,
        design_bytes,
        plan_bytes: plan.try_get("canonical_bytes")?,
        artifact_package_bytes: artifact.try_get("package_bytes")?,
        module_bytes,
        build_receipt_bytes,
        composer_receipt_bytes: sqlx::query_scalar("SELECT canonical_bytes FROM rd_develop_composer_receipts_v2 WHERE artifact_identity=$1")
            .bind(artifact_identity.as_bytes().as_slice())
            .fetch_one(&mut **transaction)
            .await?,
        host_receipt_bytes: sqlx::query_scalar("SELECT canonical_bytes FROM rd_develop_host_receipts_v2 WHERE artifact_identity=$1")
            .bind(artifact_identity.as_bytes().as_slice())
            .fetch_one(&mut **transaction)
            .await?,
        operation_receipt_bytes: operation.try_get("canonical_receipt_bytes")?,
        outbox_bytes: sqlx::query_scalar("SELECT canonical_bytes FROM rd_develop_outbox_v2 WHERE request_identity=$1")
            .bind(request_identity)
            .fetch_one(&mut **transaction)
            .await?,
        response_bytes: operation.try_get("response_bytes")?,
    }))
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
