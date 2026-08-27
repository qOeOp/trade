//! Fail-closed custody for admitting an external deployment store.
//!
//! This crate is deliberately not a business Owner. It can seal a store-admission receipt only
//! after resolving and verifying custodian-owned signed history, consulting an independent
//! anti-rollback witness, resolving an opaque credential lease, and directly measuring the target.
//! The production resolver, signature verifier, witness, and credential resolver are intentionally
//! unavailable until their deployment authorities exist.

mod postgres;

use std::{
    fmt::{Debug, Display},
    sync::Arc,
};

use async_trait::async_trait;
use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

pub use postgres::{
    PostgresCredentialLease, PostgresDirectMeasurer, PostgresMeasurement, PostgresMeasurementError,
    PostgresMeasurementSpec, PostgresTlsIdentity,
};

/// Exact business Owner admitted by the first deployment-store consumer.
pub const MARKET_DATA_OWNER: &str = "MARKET_DATA_OWNER_V1";
/// Exact first deployment-store consumer.
pub const RD_OWNER_API_CONSUMER: &str = "STRATEGY_FACTORY_RD_OWNER_API_V1";
/// Only backend admitted by the current implementation slice.
pub const POSTGRES_BACKEND: &str = "POSTGRESQL_V1";

const MODE_ENV: &str = "DEPLOYMENT_STORE_ADMISSION_MODE";
const ENVIRONMENT_ENV: &str = "DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY";
const DEPLOYMENT_ENV: &str = "DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY";
const HEAD_ENV: &str = "DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY";

/// Startup decision for the default `rd-owner-api` composition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RdOwnerStoreAdmissionBootstrap {
    /// The existing default behavior is preserved and no Market Data repository is constructed.
    Disabled,
    /// Store consumption was explicitly requested and must obtain a sealed receipt or fail closed.
    Required(RdOwnerMarketDataAdmissionRequest),
}

impl RdOwnerStoreAdmissionBootstrap {
    /// Parses the exact fail-closed bootstrap seam from a supplied environment lookup.
    ///
    /// The lookup abstraction keeps configuration tests deterministic and does not carry evidence.
    ///
    /// # Errors
    ///
    /// Returns a typed error for an unknown mode or an incomplete required scope.
    pub fn from_lookup(
        mut lookup: impl FnMut(&str) -> Option<String>,
    ) -> Result<Self, BootstrapConfigurationError> {
        match lookup(MODE_ENV).as_deref().unwrap_or("disabled") {
            "disabled" => Ok(Self::Disabled),
            "required" => Ok(Self::Required(RdOwnerMarketDataAdmissionRequest::new(
                required_lookup(&mut lookup, ENVIRONMENT_ENV)?,
                required_lookup(&mut lookup, DEPLOYMENT_ENV)?,
                required_lookup(&mut lookup, HEAD_ENV)?,
            )?)),
            _ => Err(BootstrapConfigurationError::InvalidMode),
        }
    }

    /// Parses the process environment without reading or accepting a credential value.
    ///
    /// # Errors
    ///
    /// Returns a typed error for invalid or incomplete configuration.
    pub fn from_environment() -> Result<Self, BootstrapConfigurationError> {
        match std::env::var(MODE_ENV) {
            Ok(mode) => Self::from_lookup(|name| {
                if name == MODE_ENV {
                    Some(mode.clone())
                } else {
                    std::env::var(name).ok()
                }
            }),
            Err(std::env::VarError::NotPresent) => {
                Self::from_lookup(|name| std::env::var(name).ok())
            }
            Err(std::env::VarError::NotUnicode(_)) => Err(BootstrapConfigurationError::InvalidMode),
        }
    }
}

fn required_lookup(
    lookup: &mut impl FnMut(&str) -> Option<String>,
    name: &'static str,
) -> Result<String, BootstrapConfigurationError> {
    lookup(name)
        .filter(|value| !value.trim().is_empty())
        .ok_or(BootstrapConfigurationError::MissingRequiredIdentity(name))
}

/// Invalid configuration at the consumer seam. This never denotes positive store evidence.
#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum BootstrapConfigurationError {
    #[error("invalid deployment store admission mode")]
    InvalidMode,
    #[error("missing required deployment store identity: {0}")]
    MissingRequiredIdentity(&'static str),
    #[error("invalid deployment store identity")]
    InvalidIdentity,
}

/// Exact scope requested by the first real consumer.
///
/// Business Owner, consumer, and backend are fixed inside the constructor and cannot be supplied by
/// environment configuration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RdOwnerMarketDataAdmissionRequest {
    environment_identity: String,
    deployment_identity: String,
    expected_head_identity: String,
}

impl RdOwnerMarketDataAdmissionRequest {
    /// Creates the fixed Market Data/PostgreSQL/`rd-owner-api` request scope.
    ///
    /// # Errors
    ///
    /// Returns an error when any identity is empty or contains surrounding whitespace.
    pub fn new(
        environment_identity: String,
        deployment_identity: String,
        expected_head_identity: String,
    ) -> Result<Self, BootstrapConfigurationError> {
        if !valid_opaque_identity(&environment_identity)
            || !valid_opaque_identity(&deployment_identity)
            || !valid_digest_identity(&expected_head_identity)
        {
            return Err(BootstrapConfigurationError::InvalidIdentity);
        }
        Ok(Self {
            environment_identity,
            deployment_identity,
            expected_head_identity,
        })
    }

    fn scope(&self) -> AdmissionScope {
        AdmissionScope {
            environment_identity: self.environment_identity.clone(),
            deployment_identity: self.deployment_identity.clone(),
            consumer_owner: MARKET_DATA_OWNER.to_string(),
            consumer_identity: RD_OWNER_API_CONSUMER.to_string(),
            backend: POSTGRES_BACKEND.to_string(),
            expected_head_identity: self.expected_head_identity.clone(),
        }
    }
}

fn valid_opaque_identity(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn valid_digest_identity(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

/// Immutable, content-addressed proof created only by the complete custodian pipeline.
///
/// This type has no public constructor and cannot be deserialized from caller-authored bytes.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SealedDeploymentStoreAdmissionReceipt {
    receipt_identity: String,
    environment_identity: String,
    deployment_identity: String,
    consumer_owner: String,
    consumer_identity: String,
    backend: String,
    manifest_identity: String,
    head_identity: String,
    generation: u64,
    history_digest: String,
    signed_history_proof_identity: String,
    signed_head_proof_identity: String,
    witness_identity: String,
    witness_proof_identity: String,
    measurement_digest: String,
    credential_handle_identity: String,
    credential_handle_audience: String,
    credential_handle_version: String,
    rotation_fence_identity: String,
    admitted_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
    recovery_identity: String,
    replay_identity: String,
}

impl SealedDeploymentStoreAdmissionReceipt {
    /// Returns the content-addressed immutable receipt identity.
    #[must_use]
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    /// Returns the exact consumer identity sealed into the receipt.
    #[must_use]
    pub fn consumer_identity(&self) -> &str {
        &self.consumer_identity
    }
}

/// Opaque, consumed authority for constructing the Market Data Source Binding PostgreSQL read port.
///
/// This value is issued only after the complete custodian pipeline commits its sealed receipt. It
/// deliberately implements neither `Clone` nor `Serialize`, and it exposes no DSN, pool, manifest,
/// measurement envelope, or caller-authored evidence.
///
/// A caller cannot duplicate the capability:
///
/// ```compile_fail
/// use vibe_deployment_store_admission::AdmittedMarketDataPostgresCapability;
///
/// fn duplicate(capability: AdmittedMarketDataPostgresCapability) {
///     let _copy = capability.clone();
/// }
/// ```
///
/// It also cannot be serialized into caller-owned evidence:
///
/// ```compile_fail
/// use vibe_deployment_store_admission::AdmittedMarketDataPostgresCapability;
///
/// fn serialize(capability: &AdmittedMarketDataPostgresCapability) {
///     let _bytes = serde_json::to_vec(capability).unwrap();
/// }
/// ```
pub struct AdmittedMarketDataPostgresCapability {
    receipt: SealedDeploymentStoreAdmissionReceipt,
    credential_lease: PostgresCredentialLease,
    revalidator: Arc<Custodian>,
    scope: AdmissionScope,
}

impl Debug for AdmittedMarketDataPostgresCapability {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(AdmittedMarketDataPostgresCapability))
            .field("receipt_identity", &self.receipt.receipt_identity)
            .field("consumer_identity", &self.receipt.consumer_identity)
            .finish_non_exhaustive()
    }
}

impl AdmittedMarketDataPostgresCapability {
    /// Returns the sealed receipt identity without exposing the receipt body.
    #[must_use]
    pub fn receipt_identity(&self) -> &str {
        self.receipt.receipt_identity()
    }

    /// Returns the exact fixed consumer identity sealed by the custodian.
    #[must_use]
    pub fn consumer_identity(&self) -> &str {
        self.receipt.consumer_identity()
    }

    /// Consumes this authority into the only admitted Market Data storage operation.
    #[must_use]
    pub fn into_source_binding_snapshot_port(self) -> AdmittedMarketDataSourceBindingSnapshotPort {
        AdmittedMarketDataSnapshotPort {
            receipt: self.receipt,
            revalidator: self.revalidator,
            scope: self.scope,
        }
    }

    /// Consumes this authority into the fixed Market Data PIT-evaluation snapshot operation.
    #[must_use]
    pub fn into_pit_evaluation_snapshot_port(self) -> AdmittedMarketDataSnapshotPort {
        self.into_source_binding_snapshot_port()
    }
}

/// DSA-owned opaque port exposing only fixed Market Data snapshot operations.
///
/// The superseded generic SQL surface is intentionally absent:
///
/// ```compile_fail
/// use vibe_deployment_store_admission::AdmittedMarketDataPostgresReadPool;
/// ```
pub struct AdmittedMarketDataSnapshotPort {
    receipt: SealedDeploymentStoreAdmissionReceipt,
    revalidator: Arc<Custodian>,
    scope: AdmissionScope,
}

impl Debug for AdmittedMarketDataSnapshotPort {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(AdmittedMarketDataSnapshotPort))
            .field("receipt_identity", &self.receipt.receipt_identity)
            .finish_non_exhaustive()
    }
}

/// Compatibility name for the original fixed Source Binding operation.
pub type AdmittedMarketDataSourceBindingSnapshotPort = AdmittedMarketDataSnapshotPort;

/// Exact raw rows observed inside one fixed read-only Market Data snapshot.
pub struct MarketDataSourceBindingStorageEvidence {
    admission_receipt_identity: String,
    lineage_rows: Vec<Vec<u8>>,
    clock_rows: Vec<Vec<u8>>,
}

/// Exact raw PIT, Source Binding, clock, and normalized-batch custody observed in one snapshot.
///
/// DSA deliberately does not decode these business bytes. `vibe-data` is the sole verifier that
/// may turn the complete evidence into a verified observation batch.
pub struct MarketDataPitEvaluationStorageEvidence {
    admission_receipt_identity: String,
    pit_lineage_rows: Vec<Vec<u8>>,
    source_lineage_rows: Vec<Vec<u8>>,
    clock_rows: Vec<Vec<u8>>,
    batch_source_binding_identity: [u8; 32],
    batch_source_binding_lineage_root: [u8; 32],
    batch_source_binding_lineage_version: u64,
    batch_digest: [u8; 32],
    batch_bytes: Vec<u8>,
    batch_rows: Vec<MarketDataPitObservationNativeRow>,
}

/// Exact native index columns and bytes for one normalized PIT observation row.
pub struct MarketDataPitObservationNativeRow {
    ordinal: u64,
    symbolic_key: String,
    member_key: String,
    row_bytes: Vec<u8>,
}

impl MarketDataPitObservationNativeRow {
    #[must_use]
    pub const fn ordinal(&self) -> u64 {
        self.ordinal
    }
    #[must_use]
    pub fn symbolic_key(&self) -> &str {
        &self.symbolic_key
    }
    #[must_use]
    pub fn member_key(&self) -> &str {
        &self.member_key
    }
    #[must_use]
    pub fn row_bytes(&self) -> &[u8] {
        &self.row_bytes
    }
}

impl MarketDataPitEvaluationStorageEvidence {
    #[must_use]
    pub fn admission_receipt_identity(&self) -> &str {
        &self.admission_receipt_identity
    }
    #[must_use]
    pub fn pit_lineage_rows(&self) -> &[Vec<u8>] {
        &self.pit_lineage_rows
    }
    #[must_use]
    pub fn source_lineage_rows(&self) -> &[Vec<u8>] {
        &self.source_lineage_rows
    }
    #[must_use]
    pub fn clock_rows(&self) -> &[Vec<u8>] {
        &self.clock_rows
    }
    #[must_use]
    pub const fn batch_source_binding_identity(&self) -> &[u8; 32] {
        &self.batch_source_binding_identity
    }
    #[must_use]
    pub const fn batch_source_binding_lineage_root(&self) -> &[u8; 32] {
        &self.batch_source_binding_lineage_root
    }
    #[must_use]
    pub const fn batch_source_binding_lineage_version(&self) -> u64 {
        self.batch_source_binding_lineage_version
    }
    #[must_use]
    pub const fn batch_digest(&self) -> &[u8; 32] {
        &self.batch_digest
    }
    #[must_use]
    pub fn batch_bytes(&self) -> &[u8] {
        &self.batch_bytes
    }
    #[must_use]
    pub fn batch_rows(&self) -> &[MarketDataPitObservationNativeRow] {
        &self.batch_rows
    }
}

impl MarketDataSourceBindingStorageEvidence {
    #[must_use]
    pub fn admission_receipt_identity(&self) -> &str {
        &self.admission_receipt_identity
    }
    #[must_use]
    pub fn lineage_rows(&self) -> &[Vec<u8>] {
        &self.lineage_rows
    }
    #[must_use]
    pub fn clock_rows(&self) -> &[Vec<u8>] {
        &self.clock_rows
    }
}

impl AdmittedMarketDataSnapshotPort {
    /// Reads one fixed Source Binding snapshot after full admission both before checkout and return.
    pub async fn resolve(
        &self,
        binding_identity: [u8; 32],
    ) -> Result<MarketDataSourceBindingStorageEvidence, DeploymentStoreAdmissionError> {
        let before = self
            .revalidator
            .admit_capability(self.scope.clone())
            .await?;

        if !same_snapshot_cut(&self.receipt, &before.receipt) {
            return Err(rejection(
                &self.scope,
                AdmissionFailureCode::AdmissionCutExpired,
            ));
        }
        let (lineage_rows, clock_rows) = postgres::read_market_data_source_binding_snapshot(
            &before.credential_lease,
            &binding_identity,
        )
        .await
        .map_err(|_| {
            rejection(
                &self.scope,
                AdmissionFailureCode::DirectMeasurementUnavailable,
            )
        })?;
        let after = self
            .revalidator
            .admit_capability(self.scope.clone())
            .await?;

        if !same_snapshot_cut(&self.receipt, &after.receipt) {
            return Err(rejection(
                &self.scope,
                AdmissionFailureCode::AdmissionCutExpired,
            ));
        }
        Ok(MarketDataSourceBindingStorageEvidence {
            admission_receipt_identity: self.receipt.receipt_identity.clone(),
            lineage_rows,
            clock_rows,
        })
    }

    /// Reads one fixed PIT-evaluation snapshot after admission both before checkout and return.
    pub async fn resolve_pit_evaluation(
        &self,
        snapshot_identity: [u8; 32],
    ) -> Result<MarketDataPitEvaluationStorageEvidence, DeploymentStoreAdmissionError> {
        let before = self
            .revalidator
            .admit_capability(self.scope.clone())
            .await?;

        if !same_snapshot_cut(&self.receipt, &before.receipt) {
            return Err(rejection(
                &self.scope,
                AdmissionFailureCode::AdmissionCutExpired,
            ));
        }
        let raw = postgres::read_market_data_pit_evaluation_snapshot(
            &before.credential_lease,
            &snapshot_identity,
        )
        .await
        .map_err(|_| {
            rejection(
                &self.scope,
                AdmissionFailureCode::DirectMeasurementUnavailable,
            )
        })?;
        let after = self
            .revalidator
            .admit_capability(self.scope.clone())
            .await?;

        if !same_snapshot_cut(&self.receipt, &after.receipt) {
            return Err(rejection(
                &self.scope,
                AdmissionFailureCode::AdmissionCutExpired,
            ));
        }
        Ok(MarketDataPitEvaluationStorageEvidence {
            admission_receipt_identity: self.receipt.receipt_identity.clone(),
            pit_lineage_rows: raw.pit_lineage_rows,
            source_lineage_rows: raw.source_lineage_rows,
            clock_rows: raw.clock_rows,
            batch_source_binding_identity: raw.batch_source_binding_identity,
            batch_source_binding_lineage_root: raw.batch_source_binding_lineage_root,
            batch_source_binding_lineage_version: raw.batch_source_binding_lineage_version,
            batch_digest: raw.batch_digest,
            batch_bytes: raw.batch_bytes,
            batch_rows: raw.batch_rows,
        })
    }
}

fn same_snapshot_cut(
    expected: &SealedDeploymentStoreAdmissionReceipt,
    observed: &SealedDeploymentStoreAdmissionReceipt,
) -> bool {
    expected == observed
}

/// Stable failure categories at the custody boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AdmissionFailureCode {
    ProductionResolverUnavailable,
    ProductionSignatureVerifierUnavailable,
    ProductionAntiRollbackWitnessUnavailable,
    ProductionCredentialResolverUnavailable,
    ProductionReceiptStoreUnavailable,
    HistoryUnavailable,
    AmbiguousCurrentHead,
    ExpectedHeadMismatch,
    InvalidSignature,
    InvalidAppendOnlyHistory,
    ScopeMismatch,
    AntiRollbackRejected,
    ManifestNotCurrent,
    ManifestExpired,
    AdmissionCutExpired,
    RotationFenceOpen,
    CredentialLeaseRejected,
    DirectMeasurementUnavailable,
    DirectMeasurementMismatch,
    S3Unavailable,
}

/// Immutable non-business custody incident emitted for every rejected admission.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct DeploymentStoreCustodyIncident {
    incident_identity: String,
    failure_code: AdmissionFailureCode,
    environment_identity: String,
    deployment_identity: String,
    consumer_identity: String,
    backend: String,
    expected_head_identity: String,
}

/// Fail-closed admission error with a secret-free immutable incident.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeploymentStoreAdmissionError {
    code: AdmissionFailureCode,
    incident: Box<DeploymentStoreCustodyIncident>,
}

impl DeploymentStoreAdmissionError {
    /// Returns the stable rejection category.
    #[must_use]
    pub const fn code(&self) -> AdmissionFailureCode {
        self.code
    }

    /// Returns the immutable incident for custody and diagnostics.
    #[must_use]
    pub fn incident(&self) -> &DeploymentStoreCustodyIncident {
        self.incident.as_ref()
    }
}

impl Display for DeploymentStoreAdmissionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "deployment store admission rejected: {:?}",
            self.code
        )
    }
}

impl std::error::Error for DeploymentStoreAdmissionError {}

/// Runs the exact production `rd-owner-api` seam.
///
/// The current production resolver is intentionally unavailable. Consequently this function can
/// return no positive receipt until a separately evidenced production adapter is implemented.
///
/// # Errors
///
/// Returns a typed fail-closed custody incident while production ports remain unavailable.
pub async fn admit_rd_owner_market_data_postgres(
    request: &RdOwnerMarketDataAdmissionRequest,
) -> Result<AdmittedMarketDataPostgresCapability, DeploymentStoreAdmissionError> {
    let custodian = Custodian::new(
        Arc::new(UnavailableCustodyStore),
        Arc::new(UnavailableSignatureVerifier),
        Arc::new(UnavailableAntiRollbackWitness),
        Arc::new(UnavailableCredentialResolver),
        Arc::new(UnavailableDirectMeasurer),
        Arc::new(SystemClock),
    );
    custodian.admit_capability(request.scope()).await
}

/// Makes the intentionally unavailable S3 boundary explicit without adding an adapter.
///
/// # Errors
///
/// Always returns `S3_UNAVAILABLE` for the fixed consumer scope.
pub fn unavailable_s3_admission(
    request: &RdOwnerMarketDataAdmissionRequest,
) -> Result<SealedDeploymentStoreAdmissionReceipt, DeploymentStoreAdmissionError> {
    Err(rejection(
        &request.scope(),
        AdmissionFailureCode::S3Unavailable,
    ))
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct AdmissionScope {
    environment_identity: String,
    deployment_identity: String,
    consumer_owner: String,
    consumer_identity: String,
    backend: String,
    expected_head_identity: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct CredentialHandleBinding {
    identity: String,
    audience: String,
    version: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct RecoveryBinding {
    identity: String,
    restart_requires_reverification: bool,
    ambiguity_forbids_business_retry: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct RotationFence {
    identity: String,
    predecessor_manifest_identity: Option<String>,
    closed_at_epoch_ms: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct StoreManifest {
    manifest_identity: String,
    environment_identity: String,
    deployment_identity: String,
    consumer_owner: String,
    consumer_identity: String,
    backend: String,
    endpoint_identity: String,
    tls_identity: PostgresTlsIdentity,
    server_identity: String,
    database_identity: String,
    measurement_spec: PostgresMeasurementSpec,
    expected_measurement: PostgresMeasurement,
    credential_handle: CredentialHandleBinding,
    predecessor_manifest_identity: Option<String>,
    generation: u64,
    valid_from_epoch_ms: u64,
    valid_through_epoch_ms: u64,
    recovery: RecoveryBinding,
    rotation_fence: RotationFence,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct SignedManifest {
    manifest: StoreManifest,
    signer_identity: String,
    signature: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct StoreHead {
    head_identity: String,
    environment_identity: String,
    deployment_identity: String,
    consumer_owner: String,
    consumer_identity: String,
    backend: String,
    current_manifest_identity: String,
    generation: u64,
    history_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct SignedHead {
    head: StoreHead,
    signer_identity: String,
    signature: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ResolvedHistory {
    manifests: Vec<SignedManifest>,
    current_heads: Vec<SignedHead>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct AntiRollbackObservation {
    witness_identity: String,
    head_identity: String,
    manifest_identity: String,
    generation: u64,
    observed_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct AdmissionCommitCut {
    signed_history_proof_identity: String,
    signed_head_proof_identity: String,
    witness_proof_identity: String,
    not_before_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "production custody is intentionally unavailable until its authority exists"
    )
)]
enum ReceiptCommitError {
    Unavailable,
    HeadChanged,
    ConflictingReceipt,
    Expired,
}

#[async_trait]
trait CustodyStore: Send + Sync {
    async fn resolve_history(&self, scope: &AdmissionScope) -> Result<ResolvedHistory, ()>;

    /// Atomically rechecks signed custody and the independent witness frontier, obtains the
    /// authority clock cut, and either joins or writes the immutable receipt.
    async fn commit_receipt_if_current(
        &self,
        scope: &AdmissionScope,
        expected_cut: &AdmissionCommitCut,
        receipt: SealedDeploymentStoreAdmissionReceipt,
    ) -> Result<SealedDeploymentStoreAdmissionReceipt, ReceiptCommitError>;
}

#[async_trait]
trait SignatureVerifier: Send + Sync {
    async fn verify(
        &self,
        signer_identity: &str,
        message: &[u8],
        signature: &[u8],
    ) -> Result<bool, ()>;
}

#[async_trait]
trait AntiRollbackWitness: Send + Sync {
    async fn observe(
        &self,
        scope: &AdmissionScope,
        head: &StoreHead,
    ) -> Result<AntiRollbackObservation, ()>;
}

#[async_trait]
trait CredentialResolver: Send + Sync {
    async fn resolve(
        &self,
        handle: &CredentialHandleBinding,
    ) -> Result<PostgresCredentialLease, ()>;
}

#[async_trait]
trait DirectMeasurer: Send + Sync {
    async fn measure(
        &self,
        lease: &PostgresCredentialLease,
        spec: &PostgresMeasurementSpec,
    ) -> Result<PostgresMeasurement, ()>;
}

trait Clock: Send + Sync {
    fn now_epoch_ms(&self) -> u64;
}

struct Custodian {
    custody: Arc<dyn CustodyStore>,
    signatures: Arc<dyn SignatureVerifier>,
    witness: Arc<dyn AntiRollbackWitness>,
    credentials: Arc<dyn CredentialResolver>,
    measurer: Arc<dyn DirectMeasurer>,
    clock: Arc<dyn Clock>,
}

impl Custodian {
    fn revalidator(&self) -> Arc<Self> {
        Arc::new(Self::new(
            Arc::clone(&self.custody),
            Arc::clone(&self.signatures),
            Arc::clone(&self.witness),
            Arc::clone(&self.credentials),
            Arc::clone(&self.measurer),
            Arc::clone(&self.clock),
        ))
    }
}

impl Custodian {
    fn new(
        custody: Arc<dyn CustodyStore>,
        signatures: Arc<dyn SignatureVerifier>,
        witness: Arc<dyn AntiRollbackWitness>,
        credentials: Arc<dyn CredentialResolver>,
        measurer: Arc<dyn DirectMeasurer>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            custody,
            signatures,
            witness,
            credentials,
            measurer,
            clock,
        }
    }

    #[cfg(test)]
    async fn admit(
        &self,
        scope: AdmissionScope,
    ) -> Result<SealedDeploymentStoreAdmissionReceipt, DeploymentStoreAdmissionError> {
        self.admit_capability(scope)
            .await
            .map(|capability| capability.receipt)
    }

    async fn admit_capability(
        &self,
        scope: AdmissionScope,
    ) -> Result<AdmittedMarketDataPostgresCapability, DeploymentStoreAdmissionError> {
        let resolved =
            self.custody.resolve_history(&scope).await.map_err(|()| {
                rejection(&scope, AdmissionFailureCode::ProductionResolverUnavailable)
            })?;

        if resolved.current_heads.len() != 1 {
            return Err(rejection(
                &scope,
                AdmissionFailureCode::AmbiguousCurrentHead,
            ));
        }
        let signed_head = &resolved.current_heads[0];
        if signed_head.head.head_identity != scope.expected_head_identity {
            return Err(rejection(
                &scope,
                AdmissionFailureCode::ExpectedHeadMismatch,
            ));
        }

        if signed_head.head.head_identity != head_identity(&signed_head.head) {
            return Err(rejection(
                &scope,
                AdmissionFailureCode::InvalidAppendOnlyHistory,
            ));
        }
        self.verify_signature(
            &scope,
            &signed_head.signer_identity,
            &signed_head.head,
            &signed_head.signature,
        )
        .await?;
        validate_head_scope(&scope, &signed_head.head)?;

        let manifests = validate_and_order_history(&scope, &resolved.manifests).await?;
        for signed_manifest in &manifests {
            self.verify_signature(
                &scope,
                &signed_manifest.signer_identity,
                &signed_manifest.manifest,
                &signed_manifest.signature,
            )
            .await?;
        }
        let now = self.clock.now_epoch_ms();
        validate_manifest_chain(&scope, &manifests, now)?;
        let history_digest = digest_serializable(
            &manifests
                .iter()
                .map(|entry| &entry.manifest.manifest_identity)
                .collect::<Vec<_>>(),
        );
        let signed_history_proof_identity = digest_serializable(&manifests);
        let signed_head_proof_identity = digest_serializable(signed_head);
        let latest = &manifests
            .last()
            .ok_or_else(|| rejection(&scope, AdmissionFailureCode::HistoryUnavailable))?
            .manifest;

        if signed_head.head.current_manifest_identity != latest.manifest_identity
            || signed_head.head.generation != latest.generation
            || signed_head.head.history_digest != history_digest
        {
            return Err(rejection(&scope, AdmissionFailureCode::ManifestNotCurrent));
        }

        if now < latest.valid_from_epoch_ms || now >= latest.valid_through_epoch_ms {
            return Err(rejection(&scope, AdmissionFailureCode::ManifestExpired));
        }

        let observation = self
            .witness
            .observe(&scope, &signed_head.head)
            .await
            .map_err(|()| {
                rejection(
                    &scope,
                    AdmissionFailureCode::ProductionAntiRollbackWitnessUnavailable,
                )
            })?;

        if observation.head_identity != signed_head.head.head_identity
            || observation.manifest_identity != latest.manifest_identity
            || observation.generation != latest.generation
            || observation.observed_at_epoch_ms > now
            || observation.valid_through_epoch_ms <= now
            || !valid_opaque_identity(&observation.witness_identity)
        {
            return Err(rejection(
                &scope,
                AdmissionFailureCode::AntiRollbackRejected,
            ));
        }

        let lease = self
            .credentials
            .resolve(&latest.credential_handle)
            .await
            .map_err(|()| {
                rejection(
                    &scope,
                    AdmissionFailureCode::ProductionCredentialResolverUnavailable,
                )
            })?;

        if lease.handle_identity() != latest.credential_handle.identity
            || lease.audience() != latest.credential_handle.audience
            || lease.version() != latest.credential_handle.version
            || lease.valid_through_epoch_ms() <= now
        {
            return Err(rejection(
                &scope,
                AdmissionFailureCode::CredentialLeaseRejected,
            ));
        }
        let measurement = self
            .measurer
            .measure(&lease, &latest.measurement_spec)
            .await
            .map_err(|()| rejection(&scope, AdmissionFailureCode::DirectMeasurementUnavailable))?;

        if measurement != latest.expected_measurement
            || measurement.endpoint_identity != latest.endpoint_identity
            || measurement.tls_identity != latest.tls_identity
            || measurement.server_identity != latest.server_identity
            || measurement.database_identity != latest.database_identity
        {
            return Err(rejection(
                &scope,
                AdmissionFailureCode::DirectMeasurementMismatch,
            ));
        }

        let commit_now = self.clock.now_epoch_ms();
        let valid_through_epoch_ms = latest
            .valid_through_epoch_ms
            .min(observation.valid_through_epoch_ms)
            .min(lease.valid_through_epoch_ms());
        let not_before_epoch_ms = now
            .max(latest.valid_from_epoch_ms)
            .max(latest.rotation_fence.closed_at_epoch_ms.unwrap_or(u64::MAX))
            .max(observation.observed_at_epoch_ms);

        if commit_now < not_before_epoch_ms || commit_now >= valid_through_epoch_ms {
            return Err(rejection(&scope, AdmissionFailureCode::AdmissionCutExpired));
        }
        let witness_proof_identity = digest_serializable(&observation);

        let mut receipt = SealedDeploymentStoreAdmissionReceipt {
            receipt_identity: String::new(),
            environment_identity: scope.environment_identity.clone(),
            deployment_identity: scope.deployment_identity.clone(),
            consumer_owner: scope.consumer_owner.clone(),
            consumer_identity: scope.consumer_identity.clone(),
            backend: scope.backend.clone(),
            manifest_identity: latest.manifest_identity.clone(),
            head_identity: signed_head.head.head_identity.clone(),
            generation: latest.generation,
            history_digest,
            signed_history_proof_identity: signed_history_proof_identity.clone(),
            signed_head_proof_identity: signed_head_proof_identity.clone(),
            witness_identity: observation.witness_identity,
            witness_proof_identity: witness_proof_identity.clone(),
            measurement_digest: digest_serializable(&measurement),
            credential_handle_identity: latest.credential_handle.identity.clone(),
            credential_handle_audience: latest.credential_handle.audience.clone(),
            credential_handle_version: latest.credential_handle.version.clone(),
            rotation_fence_identity: latest.rotation_fence.identity.clone(),
            admitted_at_epoch_ms: 0,
            valid_through_epoch_ms,
            recovery_identity: latest.recovery.identity.clone(),
            replay_identity: String::new(),
        };
        receipt.replay_identity = receipt_replay_identity(&receipt);
        let commit_cut = AdmissionCommitCut {
            signed_history_proof_identity,
            signed_head_proof_identity,
            witness_proof_identity,
            not_before_epoch_ms,
            valid_through_epoch_ms,
        };

        let receipt = self
            .custody
            .commit_receipt_if_current(&scope, &commit_cut, receipt)
            .await
            .map_err(|e| match e {
                ReceiptCommitError::Unavailable => rejection(
                    &scope,
                    AdmissionFailureCode::ProductionReceiptStoreUnavailable,
                ),
                ReceiptCommitError::HeadChanged => {
                    rejection(&scope, AdmissionFailureCode::ManifestNotCurrent)
                }
                ReceiptCommitError::ConflictingReceipt => {
                    rejection(&scope, AdmissionFailureCode::AmbiguousCurrentHead)
                }
                ReceiptCommitError::Expired => {
                    rejection(&scope, AdmissionFailureCode::AdmissionCutExpired)
                }
            })?;
        Ok(AdmittedMarketDataPostgresCapability {
            receipt,
            credential_lease: lease,
            revalidator: self.revalidator(),
            scope,
        })
    }

    async fn verify_signature<T: Serialize + Sync>(
        &self,
        scope: &AdmissionScope,
        signer_identity: &str,
        value: &T,
        signature: &[u8],
    ) -> Result<(), DeploymentStoreAdmissionError> {
        if !valid_opaque_identity(signer_identity) {
            return Err(rejection(scope, AdmissionFailureCode::InvalidSignature));
        }
        let message = serde_json::to_vec(value)
            .map_err(|_| rejection(scope, AdmissionFailureCode::InvalidSignature))?;

        match self
            .signatures
            .verify(signer_identity, &message, signature)
            .await
        {
            Ok(true) => Ok(()),
            Ok(false) => Err(rejection(scope, AdmissionFailureCode::InvalidSignature)),
            Err(()) => Err(rejection(
                scope,
                AdmissionFailureCode::ProductionSignatureVerifierUnavailable,
            )),
        }
    }
}

async fn validate_and_order_history(
    scope: &AdmissionScope,
    manifests: &[SignedManifest],
) -> Result<Vec<SignedManifest>, DeploymentStoreAdmissionError> {
    if manifests.is_empty() {
        return Err(rejection(scope, AdmissionFailureCode::HistoryUnavailable));
    }
    let mut ordered = manifests.to_vec();
    ordered.sort_by_key(|entry| entry.manifest.generation);
    Ok(ordered)
}

fn validate_head_scope(
    scope: &AdmissionScope,
    head: &StoreHead,
) -> Result<(), DeploymentStoreAdmissionError> {
    if head.environment_identity != scope.environment_identity
        || head.deployment_identity != scope.deployment_identity
        || head.consumer_owner != scope.consumer_owner
        || head.consumer_identity != scope.consumer_identity
        || head.backend != scope.backend
    {
        return Err(rejection(scope, AdmissionFailureCode::ScopeMismatch));
    }
    Ok(())
}

fn validate_manifest_chain(
    scope: &AdmissionScope,
    manifests: &[SignedManifest],
    now_epoch_ms: u64,
) -> Result<(), DeploymentStoreAdmissionError> {
    let mut predecessor: Option<&str> = None;
    let mut expected_generation = 1_u64;
    let mut prior_valid_from = 0_u64;

    for entry in manifests {
        let manifest = &entry.manifest;
        let fence_closed_at = manifest
            .rotation_fence
            .closed_at_epoch_ms
            .ok_or_else(|| rejection(scope, AdmissionFailureCode::RotationFenceOpen))?;

        if manifest.credential_handle.audience != scope.consumer_identity {
            return Err(rejection(scope, AdmissionFailureCode::ScopeMismatch));
        }

        if manifest
            .rotation_fence
            .predecessor_manifest_identity
            .as_deref()
            != predecessor
            || fence_closed_at < manifest.valid_from_epoch_ms
            || fence_closed_at > now_epoch_ms
            || fence_closed_at >= manifest.valid_through_epoch_ms
        {
            return Err(rejection(scope, AdmissionFailureCode::RotationFenceOpen));
        }

        if manifest.environment_identity != scope.environment_identity
            || manifest.deployment_identity != scope.deployment_identity
            || manifest.consumer_owner != scope.consumer_owner
            || manifest.consumer_identity != scope.consumer_identity
            || manifest.backend != scope.backend
            || manifest.generation != expected_generation
            || manifest.predecessor_manifest_identity.as_deref() != predecessor
            || !valid_opaque_identity(&manifest.credential_handle.identity)
            || !valid_opaque_identity(&manifest.credential_handle.audience)
            || !valid_opaque_identity(&manifest.credential_handle.version)
            || !valid_opaque_identity(&manifest.recovery.identity)
            || !valid_opaque_identity(&manifest.rotation_fence.identity)
            || !manifest.recovery.restart_requires_reverification
            || !manifest.recovery.ambiguity_forbids_business_retry
            || manifest.valid_from_epoch_ms >= manifest.valid_through_epoch_ms
            || manifest.valid_from_epoch_ms < prior_valid_from
            || manifest.manifest_identity != manifest_identity(manifest)
        {
            return Err(rejection(
                scope,
                AdmissionFailureCode::InvalidAppendOnlyHistory,
            ));
        }
        predecessor = Some(&manifest.manifest_identity);
        prior_valid_from = manifest.valid_from_epoch_ms;
        expected_generation = expected_generation.saturating_add(1);
    }
    Ok(())
}

fn manifest_identity(manifest: &StoreManifest) -> String {
    let mut meaning = manifest.clone();
    meaning.manifest_identity.clear();
    digest_serializable(&meaning)
}

fn head_identity(head: &StoreHead) -> String {
    let mut meaning = head.clone();
    meaning.head_identity.clear();
    digest_serializable(&meaning)
}

fn digest_serializable(value: &impl Serialize) -> String {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(71);
    output.push_str("sha256:");

    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(output, "{byte:02x}");
    }
    output
}

fn receipt_replay_identity(receipt: &SealedDeploymentStoreAdmissionReceipt) -> String {
    let mut meaning = receipt.clone();
    meaning.receipt_identity.clear();
    meaning.admitted_at_epoch_ms = 0;
    meaning.replay_identity.clear();
    digest_serializable(&meaning)
}

fn rejection(scope: &AdmissionScope, code: AdmissionFailureCode) -> DeploymentStoreAdmissionError {
    let mut incident = DeploymentStoreCustodyIncident {
        incident_identity: String::new(),
        failure_code: code,
        environment_identity: scope.environment_identity.clone(),
        deployment_identity: scope.deployment_identity.clone(),
        consumer_identity: scope.consumer_identity.clone(),
        backend: scope.backend.clone(),
        expected_head_identity: scope.expected_head_identity.clone(),
    };
    incident.incident_identity = digest_serializable(&incident);
    DeploymentStoreAdmissionError {
        code,
        incident: Box::new(incident),
    }
}

struct UnavailableCustodyStore;
struct UnavailableSignatureVerifier;
struct UnavailableAntiRollbackWitness;
struct UnavailableCredentialResolver;
struct UnavailableDirectMeasurer;
struct SystemClock;

#[async_trait]
impl CustodyStore for UnavailableCustodyStore {
    async fn resolve_history(&self, _scope: &AdmissionScope) -> Result<ResolvedHistory, ()> {
        Err(())
    }

    async fn commit_receipt_if_current(
        &self,
        _scope: &AdmissionScope,
        _expected_cut: &AdmissionCommitCut,
        _receipt: SealedDeploymentStoreAdmissionReceipt,
    ) -> Result<SealedDeploymentStoreAdmissionReceipt, ReceiptCommitError> {
        Err(ReceiptCommitError::Unavailable)
    }
}

#[async_trait]
impl SignatureVerifier for UnavailableSignatureVerifier {
    async fn verify(
        &self,
        _signer_identity: &str,
        _message: &[u8],
        _signature: &[u8],
    ) -> Result<bool, ()> {
        Err(())
    }
}

#[async_trait]
impl AntiRollbackWitness for UnavailableAntiRollbackWitness {
    async fn observe(
        &self,
        _scope: &AdmissionScope,
        _head: &StoreHead,
    ) -> Result<AntiRollbackObservation, ()> {
        Err(())
    }
}

#[async_trait]
impl CredentialResolver for UnavailableCredentialResolver {
    async fn resolve(
        &self,
        _handle: &CredentialHandleBinding,
    ) -> Result<PostgresCredentialLease, ()> {
        Err(())
    }
}

#[async_trait]
impl DirectMeasurer for UnavailableDirectMeasurer {
    async fn measure(
        &self,
        _lease: &PostgresCredentialLease,
        _spec: &PostgresMeasurementSpec,
    ) -> Result<PostgresMeasurement, ()> {
        Err(())
    }
}

#[async_trait]
impl DirectMeasurer for PostgresDirectMeasurer {
    async fn measure(
        &self,
        lease: &PostgresCredentialLease,
        spec: &PostgresMeasurementSpec,
    ) -> Result<PostgresMeasurement, ()> {
        Self::measure(self, lease, spec).await.map_err(|_| ())
    }
}

impl Clock for SystemClock {
    fn now_epoch_ms(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |duration| {
                u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
            })
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        sync::{
            Mutex,
            atomic::{AtomicU64, AtomicUsize, Ordering},
        },
    };

    use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
    use rstest::rstest;

    use super::*;

    const NOW: u64 = 1_000_000;
    const SIGNER: &str = "deployment-store-test-signer-v1";
    static MODE_ENV_LOCK: Mutex<()> = Mutex::new(());
    static PG_ENV_LOCK: Mutex<()> = Mutex::new(());

    struct FixedClock;

    impl Clock for FixedClock {
        fn now_epoch_ms(&self) -> u64 {
            NOW
        }
    }

    struct AdvancingClock {
        next: AtomicU64,
    }

    impl Clock for AdvancingClock {
        fn now_epoch_ms(&self) -> u64 {
            self.next.fetch_add(1, Ordering::SeqCst)
        }
    }

    struct MutableClock {
        now: Arc<AtomicU64>,
    }

    struct RegressingClock {
        calls: AtomicUsize,
    }

    impl Clock for RegressingClock {
        fn now_epoch_ms(&self) -> u64 {
            if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
                NOW
            } else {
                NOW - 2_000
            }
        }
    }

    impl Clock for MutableClock {
        fn now_epoch_ms(&self) -> u64 {
            self.now.load(Ordering::SeqCst)
        }
    }

    struct FakeCustodyState {
        history: ResolvedHistory,
        current_witness_proof_identity: String,
        receipts: HashMap<String, SealedDeploymentStoreAdmissionReceipt>,
        now_epoch_ms: u64,
    }

    #[derive(Clone)]
    struct FakeCustodyStore {
        state: Arc<Mutex<FakeCustodyState>>,
    }

    #[async_trait]
    impl CustodyStore for FakeCustodyStore {
        async fn resolve_history(&self, _scope: &AdmissionScope) -> Result<ResolvedHistory, ()> {
            self.state
                .lock()
                .map(|state| state.history.clone())
                .map_err(|_| ())
        }

        async fn commit_receipt_if_current(
            &self,
            scope: &AdmissionScope,
            expected_cut: &AdmissionCommitCut,
            mut receipt: SealedDeploymentStoreAdmissionReceipt,
        ) -> Result<SealedDeploymentStoreAdmissionReceipt, ReceiptCommitError> {
            let mut state = self
                .state
                .lock()
                .map_err(|_| ReceiptCommitError::Unavailable)?;

            if state.history.current_heads.len() != 1 {
                return Err(ReceiptCommitError::HeadChanged);
            }
            let current_head_proof = digest_serializable(&state.history.current_heads[0]);
            let current_history_proof = digest_serializable(&state.history.manifests);
            if current_head_proof != expected_cut.signed_head_proof_identity
                || current_history_proof != expected_cut.signed_history_proof_identity
                || state.current_witness_proof_identity != expected_cut.witness_proof_identity
            {
                return Err(ReceiptCommitError::HeadChanged);
            }

            if state.now_epoch_ms < expected_cut.not_before_epoch_ms
                || state.now_epoch_ms >= expected_cut.valid_through_epoch_ms
            {
                return Err(ReceiptCommitError::Expired);
            }
            receipt.admitted_at_epoch_ms = state.now_epoch_ms;
            receipt.replay_identity = receipt_replay_identity(&receipt);
            receipt.receipt_identity = digest_serializable(&receipt);
            let slot = digest_serializable(&(
                &scope.environment_identity,
                &scope.deployment_identity,
                &scope.consumer_owner,
                &scope.consumer_identity,
                &scope.backend,
                &expected_cut.signed_head_proof_identity,
                &expected_cut.signed_history_proof_identity,
                &expected_cut.witness_proof_identity,
            ));

            if let Some(existing) = state.receipts.get(&slot) {
                return if existing.replay_identity == receipt.replay_identity {
                    Ok(existing.clone())
                } else {
                    Err(ReceiptCommitError::ConflictingReceipt)
                };
            }
            state.receipts.insert(slot, receipt.clone());
            Ok(receipt)
        }
    }

    struct Ed25519Verifier {
        key: VerifyingKey,
        calls: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl SignatureVerifier for Ed25519Verifier {
        async fn verify(
            &self,
            signer_identity: &str,
            message: &[u8],
            signature: &[u8],
        ) -> Result<bool, ()> {
            self.calls.fetch_add(1, Ordering::SeqCst);

            if signer_identity != SIGNER {
                return Ok(false);
            }
            let signature = Signature::try_from(signature).map_err(|_| ())?;
            Ok(self.key.verify(message, &signature).is_ok())
        }
    }

    struct AnyTestSignerVerifier {
        key: VerifyingKey,
    }

    #[async_trait]
    impl SignatureVerifier for AnyTestSignerVerifier {
        async fn verify(
            &self,
            _signer_identity: &str,
            message: &[u8],
            signature: &[u8],
        ) -> Result<bool, ()> {
            let signature = Signature::try_from(signature).map_err(|_| ())?;
            Ok(self.key.verify(message, &signature).is_ok())
        }
    }

    #[derive(Clone)]
    struct FakeWitness {
        observation: AntiRollbackObservation,
    }

    #[async_trait]
    impl AntiRollbackWitness for FakeWitness {
        async fn observe(
            &self,
            _scope: &AdmissionScope,
            _head: &StoreHead,
        ) -> Result<AntiRollbackObservation, ()> {
            Ok(self.observation.clone())
        }
    }

    struct FakeCredentials;

    #[async_trait]
    impl CredentialResolver for FakeCredentials {
        async fn resolve(
            &self,
            handle: &CredentialHandleBinding,
        ) -> Result<PostgresCredentialLease, ()> {
            PostgresCredentialLease::from_resolved_secret(
                &handle.identity,
                &handle.audience,
                &handle.version,
                NOW + 5_000,
                "postgres://test:secret@127.0.0.1:5432/disposable".to_string(),
            )
            .map_err(|_| ())
        }
    }

    struct FakeMeasurer {
        value: PostgresMeasurement,
        calls: Arc<AtomicUsize>,
    }

    struct HeadSwitchingMeasurer {
        value: PostgresMeasurement,
        custody: FakeCustodyStore,
    }

    struct ExpiringMeasurer {
        value: PostgresMeasurement,
        now: Arc<AtomicU64>,
    }

    struct WitnessSwitchingMeasurer {
        value: PostgresMeasurement,
        custody: FakeCustodyStore,
    }

    #[async_trait]
    impl DirectMeasurer for WitnessSwitchingMeasurer {
        async fn measure(
            &self,
            _lease: &PostgresCredentialLease,
            _spec: &PostgresMeasurementSpec,
        ) -> Result<PostgresMeasurement, ()> {
            self.custody
                .state
                .lock()
                .map_err(|_| ())?
                .current_witness_proof_identity = "sha256:witness-frontier-advanced".to_string();
            Ok(self.value.clone())
        }
    }

    #[async_trait]
    impl DirectMeasurer for ExpiringMeasurer {
        async fn measure(
            &self,
            _lease: &PostgresCredentialLease,
            _spec: &PostgresMeasurementSpec,
        ) -> Result<PostgresMeasurement, ()> {
            self.now.store(NOW + 5_000, Ordering::SeqCst);
            Ok(self.value.clone())
        }
    }

    #[async_trait]
    impl DirectMeasurer for HeadSwitchingMeasurer {
        async fn measure(
            &self,
            _lease: &PostgresCredentialLease,
            _spec: &PostgresMeasurementSpec,
        ) -> Result<PostgresMeasurement, ()> {
            let mut state = self.custody.state.lock().map_err(|_| ())?;
            state.history.current_heads[0].signature[0] ^= 1;
            Ok(self.value.clone())
        }
    }

    #[async_trait]
    impl DirectMeasurer for FakeMeasurer {
        async fn measure(
            &self,
            _lease: &PostgresCredentialLease,
            _spec: &PostgresMeasurementSpec,
        ) -> Result<PostgresMeasurement, ()> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.value.clone())
        }
    }

    struct Fixture {
        request: RdOwnerMarketDataAdmissionRequest,
        history: ResolvedHistory,
        witness: AntiRollbackObservation,
        measurement: PostgresMeasurement,
        signing_key: SigningKey,
    }

    impl Fixture {
        fn new() -> Self {
            let request = RdOwnerMarketDataAdmissionRequest::new(
                "test-environment".to_string(),
                "rd-workbench-test".to_string(),
                format!("sha256:{}", "0".repeat(64)),
            )
            .unwrap();
            let scope = request.scope();
            let measurement = measurement("role-v1");
            let spec = PostgresMeasurementSpec::new(
                "market_data_private",
                "market_data_private.schema_migrations_v1",
                vec!["market_data_api.resolve_snapshot_v1(text)".to_string()],
                vec!["market_data_private.snapshot_facts_v1".to_string()],
            )
            .unwrap();
            let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
            let genesis = manifest(
                &scope,
                &measurement,
                &spec,
                1,
                None,
                "rotation-fence-genesis",
            );
            let successor = manifest(
                &scope,
                &measurement,
                &spec,
                2,
                Some(genesis.manifest_identity.clone()),
                "rotation-fence-2",
            );
            let manifests = vec![
                sign_manifest(genesis, &signing_key),
                sign_manifest(successor.clone(), &signing_key),
            ];
            let history_digest = digest_serializable(
                &manifests
                    .iter()
                    .map(|entry| &entry.manifest.manifest_identity)
                    .collect::<Vec<_>>(),
            );
            let mut head = StoreHead {
                head_identity: String::new(),
                environment_identity: scope.environment_identity,
                deployment_identity: scope.deployment_identity,
                consumer_owner: scope.consumer_owner,
                consumer_identity: scope.consumer_identity,
                backend: scope.backend,
                current_manifest_identity: successor.manifest_identity.clone(),
                generation: 2,
                history_digest,
            };
            head.head_identity = head_identity(&head);
            let expected_head = head.head_identity.clone();
            let signed_head = sign_head(head, &signing_key);
            Self {
                request: RdOwnerMarketDataAdmissionRequest::new(
                    "test-environment".to_string(),
                    "rd-workbench-test".to_string(),
                    expected_head.clone(),
                )
                .unwrap(),
                history: ResolvedHistory {
                    manifests,
                    current_heads: vec![signed_head],
                },
                witness: AntiRollbackObservation {
                    witness_identity: "anti-rollback-witness-observation-v1".to_string(),
                    head_identity: expected_head,
                    manifest_identity: successor.manifest_identity,
                    generation: 2,
                    observed_at_epoch_ms: NOW,
                    valid_through_epoch_ms: NOW + 5_000,
                },
                measurement,
                signing_key,
            }
        }

        fn custodian(
            &self,
            signature_calls: Arc<AtomicUsize>,
            measurement_calls: Arc<AtomicUsize>,
        ) -> Custodian {
            self.custodian_with_clock(signature_calls, measurement_calls, Arc::new(FixedClock))
        }

        fn custody(&self) -> FakeCustodyStore {
            FakeCustodyStore {
                state: Arc::new(Mutex::new(FakeCustodyState {
                    history: self.history.clone(),
                    current_witness_proof_identity: digest_serializable(&self.witness),
                    receipts: HashMap::new(),
                    now_epoch_ms: NOW + 10,
                })),
            }
        }

        fn custodian_with_clock(
            &self,
            signature_calls: Arc<AtomicUsize>,
            measurement_calls: Arc<AtomicUsize>,
            clock: Arc<dyn Clock>,
        ) -> Custodian {
            self.custodian_with_ports(
                self.custody(),
                Arc::new(Ed25519Verifier {
                    key: self.signing_key.verifying_key(),
                    calls: signature_calls,
                }),
                Arc::new(FakeMeasurer {
                    value: self.measurement.clone(),
                    calls: measurement_calls,
                }),
                clock,
            )
        }

        fn custodian_with_ports(
            &self,
            custody: FakeCustodyStore,
            signatures: Arc<dyn SignatureVerifier>,
            measurer: Arc<dyn DirectMeasurer>,
            clock: Arc<dyn Clock>,
        ) -> Custodian {
            Custodian::new(
                Arc::new(custody),
                signatures,
                Arc::new(FakeWitness {
                    observation: self.witness.clone(),
                }),
                Arc::new(FakeCredentials),
                measurer,
                clock,
            )
        }

        fn replace_latest(&mut self, mut latest: StoreManifest) {
            latest.manifest_identity = manifest_identity(&latest);
            self.history.manifests[1] = sign_manifest(latest.clone(), &self.signing_key);
            let mut head = self.history.current_heads[0].head.clone();
            head.current_manifest_identity = latest.manifest_identity.clone();
            head.history_digest = digest_serializable(
                &self
                    .history
                    .manifests
                    .iter()
                    .map(|entry| &entry.manifest.manifest_identity)
                    .collect::<Vec<_>>(),
            );
            head.head_identity.clear();
            head.head_identity = head_identity(&head);
            self.request.expected_head_identity = head.head_identity.clone();
            self.history.current_heads[0] = sign_head(head.clone(), &self.signing_key);
            self.witness.head_identity = head.head_identity;
            self.witness.manifest_identity = latest.manifest_identity;
        }
    }

    fn measurement(role: &str) -> PostgresMeasurement {
        PostgresMeasurement {
            endpoint_identity: "postgresql://127.0.0.1:5432".to_string(),
            tls_identity: PostgresTlsIdentity::disposable_plaintext("127.0.0.1"),
            server_identity: "postgres-system:test-cluster".to_string(),
            database_identity: "postgres-database:vibe_test:42".to_string(),
            schema_identity: "sha256:schema".to_string(),
            migration_identity: "sha256:migration".to_string(),
            function_identity: "sha256:function".to_string(),
            role_identity: format!("sha256:{role}"),
            acl_identity: "sha256:acl".to_string(),
        }
    }

    fn manifest(
        scope: &AdmissionScope,
        measurement: &PostgresMeasurement,
        spec: &PostgresMeasurementSpec,
        generation: u64,
        predecessor: Option<String>,
        fence: &str,
    ) -> StoreManifest {
        let mut manifest = StoreManifest {
            manifest_identity: String::new(),
            environment_identity: scope.environment_identity.clone(),
            deployment_identity: scope.deployment_identity.clone(),
            consumer_owner: scope.consumer_owner.clone(),
            consumer_identity: scope.consumer_identity.clone(),
            backend: scope.backend.clone(),
            endpoint_identity: measurement.endpoint_identity.clone(),
            tls_identity: measurement.tls_identity.clone(),
            server_identity: measurement.server_identity.clone(),
            database_identity: measurement.database_identity.clone(),
            measurement_spec: spec.clone(),
            expected_measurement: measurement.clone(),
            credential_handle: CredentialHandleBinding {
                identity: "credential-handle-market-data".to_string(),
                audience: RD_OWNER_API_CONSUMER.to_string(),
                version: format!("credential-v{generation}"),
            },
            predecessor_manifest_identity: predecessor.clone(),
            generation,
            valid_from_epoch_ms: NOW - 1_000,
            valid_through_epoch_ms: NOW + 10_000,
            recovery: RecoveryBinding {
                identity: "restart-reverify-and-remeasure-v1".to_string(),
                restart_requires_reverification: true,
                ambiguity_forbids_business_retry: true,
            },
            rotation_fence: RotationFence {
                identity: fence.to_string(),
                predecessor_manifest_identity: predecessor,
                closed_at_epoch_ms: Some(NOW - 100),
            },
        };
        manifest.manifest_identity = manifest_identity(&manifest);
        manifest
    }

    fn sign_manifest(manifest: StoreManifest, key: &SigningKey) -> SignedManifest {
        let message = serde_json::to_vec(&manifest).unwrap();
        SignedManifest {
            manifest,
            signer_identity: SIGNER.to_string(),
            signature: key.sign(&message).to_bytes().to_vec(),
        }
    }

    fn sign_head(head: StoreHead, key: &SigningKey) -> SignedHead {
        let message = serde_json::to_vec(&head).unwrap();
        SignedHead {
            head,
            signer_identity: SIGNER.to_string(),
            signature: key.sign(&message).to_bytes().to_vec(),
        }
    }

    #[tokio::test]
    async fn restart_reverifies_complete_signed_history_and_remeasures() {
        let fixture = Fixture::new();
        let signature_calls = Arc::new(AtomicUsize::new(0));
        let measurement_calls = Arc::new(AtomicUsize::new(0));
        let custodian = fixture.custodian_with_clock(
            signature_calls.clone(),
            measurement_calls.clone(),
            Arc::new(AdvancingClock {
                next: AtomicU64::new(NOW),
            }),
        );

        let first = custodian.admit(fixture.request.scope()).await.unwrap();
        let after_cache_loss = custodian.admit(fixture.request.scope()).await.unwrap();

        assert_eq!(first, after_cache_loss);
        assert_eq!(signature_calls.load(Ordering::SeqCst), 6);
        assert_eq!(measurement_calls.load(Ordering::SeqCst), 2);
        assert_eq!(first.consumer_identity(), RD_OWNER_API_CONSUMER);
        assert!(!first.receipt_identity().is_empty());
    }

    #[tokio::test]
    async fn concurrent_exact_replay_joins_same_immutable_receipt() {
        let fixture = Fixture::new();
        let measurement_calls = Arc::new(AtomicUsize::new(0));
        let custodian =
            Arc::new(fixture.custodian(Arc::new(AtomicUsize::new(0)), measurement_calls.clone()));
        let left = custodian.admit(fixture.request.scope());
        let right = custodian.admit(fixture.request.scope());
        let (left, right) = tokio::join!(left, right);
        assert_eq!(left.unwrap(), right.unwrap());
        assert_eq!(measurement_calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn signed_head_change_during_measurement_cannot_commit_a_receipt() {
        let fixture = Fixture::new();
        let custody = fixture.custody();
        let custodian = Custodian::new(
            Arc::new(custody.clone()),
            Arc::new(Ed25519Verifier {
                key: fixture.signing_key.verifying_key(),
                calls: Arc::new(AtomicUsize::new(0)),
            }),
            Arc::new(FakeWitness {
                observation: fixture.witness.clone(),
            }),
            Arc::new(FakeCredentials),
            Arc::new(HeadSwitchingMeasurer {
                value: fixture.measurement.clone(),
                custody,
            }),
            Arc::new(FixedClock),
        );

        let error = custodian.admit(fixture.request.scope()).await.unwrap_err();
        assert_eq!(error.code(), AdmissionFailureCode::ManifestNotCurrent);
    }

    #[tokio::test]
    async fn signer_provenance_changes_the_sealed_receipt() {
        let first = Fixture::new();
        let mut second = Fixture::new();
        for manifest in &mut second.history.manifests {
            manifest.signer_identity = "deployment-store-other-signer-v2".to_string();
        }
        second.history.current_heads[0].signer_identity =
            "deployment-store-other-signer-v2".to_string();

        let first_receipt = first
            .custodian_with_ports(
                first.custody(),
                Arc::new(AnyTestSignerVerifier {
                    key: first.signing_key.verifying_key(),
                }),
                Arc::new(FakeMeasurer {
                    value: first.measurement.clone(),
                    calls: Arc::new(AtomicUsize::new(0)),
                }),
                Arc::new(FixedClock),
            )
            .admit(first.request.scope())
            .await
            .unwrap();
        let second_receipt = second
            .custodian_with_ports(
                second.custody(),
                Arc::new(AnyTestSignerVerifier {
                    key: second.signing_key.verifying_key(),
                }),
                Arc::new(FakeMeasurer {
                    value: second.measurement.clone(),
                    calls: Arc::new(AtomicUsize::new(0)),
                }),
                Arc::new(FixedClock),
            )
            .admit(second.request.scope())
            .await
            .unwrap();

        assert_ne!(first_receipt, second_receipt);
    }

    #[tokio::test]
    async fn expiry_during_direct_measurement_yields_no_receipt() {
        let fixture = Fixture::new();
        let now = Arc::new(AtomicU64::new(NOW));
        let custodian = fixture.custodian_with_ports(
            fixture.custody(),
            Arc::new(Ed25519Verifier {
                key: fixture.signing_key.verifying_key(),
                calls: Arc::new(AtomicUsize::new(0)),
            }),
            Arc::new(ExpiringMeasurer {
                value: fixture.measurement.clone(),
                now: now.clone(),
            }),
            Arc::new(MutableClock { now }),
        );

        let error = custodian.admit(fixture.request.scope()).await.unwrap_err();
        assert_eq!(error.code(), AdmissionFailureCode::AdmissionCutExpired);
    }

    #[tokio::test]
    async fn witness_frontier_change_during_measurement_yields_no_receipt() {
        let fixture = Fixture::new();
        let custody = fixture.custody();
        let custodian = fixture.custodian_with_ports(
            custody.clone(),
            Arc::new(Ed25519Verifier {
                key: fixture.signing_key.verifying_key(),
                calls: Arc::new(AtomicUsize::new(0)),
            }),
            Arc::new(WitnessSwitchingMeasurer {
                value: fixture.measurement.clone(),
                custody,
            }),
            Arc::new(FixedClock),
        );

        let error = custodian.admit(fixture.request.scope()).await.unwrap_err();
        assert_eq!(error.code(), AdmissionFailureCode::ManifestNotCurrent);
    }

    #[tokio::test]
    async fn clock_regression_before_commit_yields_no_receipt() {
        let fixture = Fixture::new();
        let custodian = fixture.custodian_with_clock(
            Arc::new(AtomicUsize::new(0)),
            Arc::new(AtomicUsize::new(0)),
            Arc::new(RegressingClock {
                calls: AtomicUsize::new(0),
            }),
        );

        let error = custodian.admit(fixture.request.scope()).await.unwrap_err();
        assert_eq!(error.code(), AdmissionFailureCode::AdmissionCutExpired);
    }

    #[tokio::test]
    async fn dual_head_bad_signature_and_rollback_yield_no_receipt() {
        let mut dual = Fixture::new();
        dual.history
            .current_heads
            .push(dual.history.current_heads[0].clone());
        let error = dual
            .custodian(Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)))
            .admit(dual.request.scope())
            .await
            .unwrap_err();
        assert_eq!(error.code(), AdmissionFailureCode::AmbiguousCurrentHead);

        let mut bad_signature = Fixture::new();
        bad_signature.history.manifests[1].signature[0] ^= 1;
        let error = bad_signature
            .custodian(Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)))
            .admit(bad_signature.request.scope())
            .await
            .unwrap_err();
        assert_eq!(error.code(), AdmissionFailureCode::InvalidSignature);

        let mut rollback = Fixture::new();
        rollback.witness.generation = 1;
        let error = rollback
            .custodian(Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)))
            .admit(rollback.request.scope())
            .await
            .unwrap_err();
        assert_eq!(error.code(), AdmissionFailureCode::AntiRollbackRejected);
    }

    #[tokio::test]
    async fn open_rotation_or_changed_measurement_yields_no_receipt() {
        let mut open = Fixture::new();
        let mut latest = open.history.manifests[1].manifest.clone();
        latest.rotation_fence.closed_at_epoch_ms = None;
        open.replace_latest(latest);
        let error = open
            .custodian(Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)))
            .admit(open.request.scope())
            .await
            .unwrap_err();
        assert_eq!(error.code(), AdmissionFailureCode::RotationFenceOpen);

        let changed = Fixture::new();
        let custodian = Custodian::new(
            Arc::new(FakeCustodyStore {
                state: Arc::new(Mutex::new(FakeCustodyState {
                    history: changed.history.clone(),
                    current_witness_proof_identity: digest_serializable(&changed.witness),
                    receipts: HashMap::new(),
                    now_epoch_ms: NOW + 10,
                })),
            }),
            Arc::new(Ed25519Verifier {
                key: changed.signing_key.verifying_key(),
                calls: Arc::new(AtomicUsize::new(0)),
            }),
            Arc::new(FakeWitness {
                observation: changed.witness.clone(),
            }),
            Arc::new(FakeCredentials),
            Arc::new(FakeMeasurer {
                value: measurement("changed-role"),
                calls: Arc::new(AtomicUsize::new(0)),
            }),
            Arc::new(FixedClock),
        );
        let error = custodian.admit(changed.request.scope()).await.unwrap_err();
        assert_eq!(
            error.code(),
            AdmissionFailureCode::DirectMeasurementMismatch
        );
    }

    #[tokio::test]
    async fn audience_mismatch_and_future_rotation_closure_fail_closed() {
        let mut audience = Fixture::new();
        let mut latest = audience.history.manifests[1].manifest.clone();
        latest.credential_handle.audience = "OTHER_CONSUMER".to_string();
        audience.replace_latest(latest);
        let error = audience
            .custodian(Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)))
            .admit(audience.request.scope())
            .await
            .unwrap_err();
        assert_eq!(error.code(), AdmissionFailureCode::ScopeMismatch);

        let mut future = Fixture::new();
        let mut latest = future.history.manifests[1].manifest.clone();
        latest.rotation_fence.closed_at_epoch_ms = Some(NOW + 1);
        future.replace_latest(latest);
        let error = future
            .custodian(Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)))
            .admit(future.request.scope())
            .await
            .unwrap_err();
        assert_eq!(error.code(), AdmissionFailureCode::RotationFenceOpen);
    }

    #[tokio::test]
    async fn production_and_s3_ports_are_explicitly_unavailable() {
        let fixture = Fixture::new();
        let production = admit_rd_owner_market_data_postgres(&fixture.request)
            .await
            .unwrap_err();
        assert_eq!(
            production.code(),
            AdmissionFailureCode::ProductionResolverUnavailable
        );
        assert_eq!(
            unavailable_s3_admission(&fixture.request)
                .unwrap_err()
                .code(),
            AdmissionFailureCode::S3Unavailable
        );
    }

    #[tokio::test]
    async fn complete_custodian_pipeline_privately_issues_consumed_market_data_capability() {
        let fixture = Fixture::new();
        let capability = fixture
            .custodian(Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)))
            .admit_capability(fixture.request.scope())
            .await
            .expect("complete sealed admission");

        assert!(capability.receipt_identity().starts_with("sha256:"));
        assert_eq!(capability.consumer_identity(), RD_OWNER_API_CONSUMER);
        assert!(!format!("{capability:?}").contains("password"));
    }

    #[tokio::test]
    async fn postgres_target_override_parameters_fail_before_connection() {
        let lease = PostgresCredentialLease::from_resolved_secret(
            "test-handle",
            RD_OWNER_API_CONSUMER,
            "test-v1",
            NOW + 1,
            "postgresql://rd_owner@127.0.0.1/vibe_test_decoy?hostaddr=192.0.2.1".to_string(),
        )
        .unwrap();
        let spec = PostgresMeasurementSpec::new(
            "safe_schema",
            "safe_schema.schema_migrations_v1",
            vec!["safe_schema.resolve_v1()".to_string()],
            vec!["safe_schema.facts_v1".to_string()],
        )
        .unwrap();

        assert_eq!(
            PostgresDirectMeasurer.measure(&lease, &spec).await,
            Err(PostgresMeasurementError::InvalidTarget)
        );
    }

    #[rstest]
    fn ambient_postgres_configuration_fails_before_connection() {
        let _lock = PG_ENV_LOCK.lock().unwrap();
        let prior = std::env::var_os("PGPORT");
        // SAFETY: this test serializes all mutations of this exact process variable.
        unsafe { std::env::set_var("PGPORT", "6543") };
        let lease = PostgresCredentialLease::from_resolved_secret(
            "test-handle",
            RD_OWNER_API_CONSUMER,
            "test-v1",
            NOW + 1,
            "postgresql://rd_owner@127.0.0.1/vibe_test_decoy".to_string(),
        )
        .unwrap();
        let spec = PostgresMeasurementSpec::new(
            "safe_schema",
            "safe_schema.schema_migrations_v1",
            vec!["safe_schema.resolve_v1()".to_string()],
            vec!["safe_schema.facts_v1".to_string()],
        )
        .unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime.block_on(PostgresDirectMeasurer.measure(&lease, &spec));

        if let Some(value) = prior {
            // SAFETY: restoration is covered by the same serialized critical section.
            unsafe { std::env::set_var("PGPORT", value) };
        } else {
            // SAFETY: restoration is covered by the same serialized critical section.
            unsafe { std::env::remove_var("PGPORT") };
        }

        assert_eq!(result, Err(PostgresMeasurementError::InvalidTarget));
    }

    #[rstest]
    fn consumer_configuration_is_disabled_by_default_and_required_is_exact() {
        assert_eq!(
            RdOwnerStoreAdmissionBootstrap::from_lookup(|_| None).unwrap(),
            RdOwnerStoreAdmissionBootstrap::Disabled
        );
        let configured = RdOwnerStoreAdmissionBootstrap::from_lookup(|name| match name {
            MODE_ENV => Some("required".to_string()),
            ENVIRONMENT_ENV => Some("test-environment".to_string()),
            DEPLOYMENT_ENV => Some("rd-workbench-test".to_string()),
            HEAD_ENV => Some(format!("sha256:{}", "a".repeat(64))),
            _ => None,
        })
        .unwrap();
        let RdOwnerStoreAdmissionBootstrap::Required(request) = configured else {
            panic!("required mode must bind the fixed consumer scope");
        };
        let scope = request.scope();
        assert_eq!(scope.consumer_owner, MARKET_DATA_OWNER);
        assert_eq!(scope.consumer_identity, RD_OWNER_API_CONSUMER);
        assert_eq!(scope.backend, POSTGRES_BACKEND);
    }

    #[cfg(unix)]
    #[rstest]
    fn non_unicode_environment_mode_fails_closed() {
        use std::{ffi::OsString, os::unix::ffi::OsStringExt};

        let _lock = MODE_ENV_LOCK.lock().unwrap();
        let prior = std::env::var_os(MODE_ENV);
        // SAFETY: this test serializes all mutations of this exact process variable.
        unsafe { std::env::set_var(MODE_ENV, OsString::from_vec(vec![0xff])) };
        let result = RdOwnerStoreAdmissionBootstrap::from_environment();

        if let Some(value) = prior {
            // SAFETY: restoration is covered by the same serialized critical section.
            unsafe { std::env::set_var(MODE_ENV, value) };
        } else {
            // SAFETY: restoration is covered by the same serialized critical section.
            unsafe { std::env::remove_var(MODE_ENV) };
        }

        assert_eq!(result, Err(BootstrapConfigurationError::InvalidMode));
    }

    #[rstest]
    fn credential_debug_and_incident_never_contain_secret() {
        let lease = PostgresCredentialLease::from_resolved_secret(
            "handle",
            "audience",
            "v1",
            NOW + 1,
            "postgres://role:secret-canary@db.example/test".to_string(),
        )
        .unwrap();
        let debug = format!("{lease:?}");
        assert!(!debug.contains("secret-canary"));
        assert!(debug.contains("[REDACTED]"));

        let fixture = Fixture::new();
        let error = unavailable_s3_admission(&fixture.request).unwrap_err();
        let incident = serde_json::to_string(error.incident()).unwrap();
        assert!(!incident.contains("secret"));

        assert_eq!(
            RdOwnerMarketDataAdmissionRequest::new(
                "postgres://user:secret@db.example/store".to_string(),
                "deployment".to_string(),
                format!("sha256:{}", "a".repeat(64)),
            ),
            Err(BootstrapConfigurationError::InvalidIdentity)
        );
        assert!(matches!(
            PostgresCredentialLease::from_resolved_secret(
                "postgres://user:secret@db.example/store",
                RD_OWNER_API_CONSUMER,
                "v1",
                NOW + 1,
                "postgres://role:secret-canary@db.example/test".to_string(),
            ),
            Err(PostgresMeasurementError::InvalidCredentialLease)
        ));
        assert_eq!(
            PostgresMeasurementSpec::new(
                "safe_schema",
                "safe_schema.schema_migrations_v1",
                vec!["postgres://user:secret-canary@db.example/store".to_string()],
                vec!["safe_schema.facts_v1".to_string()],
            ),
            Err(PostgresMeasurementError::InvalidSpecification)
        );
    }

    #[tokio::test]
    async fn snapshot_cut_expiry_or_rotation_drift_discards_evidence() {
        let fixture = Fixture::new();
        let receipt = fixture
            .custodian(Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)))
            .admit(fixture.request.scope())
            .await
            .expect("sealed cut");

        let mut expired_between_checkout_and_return = receipt.clone();
        expired_between_checkout_and_return.valid_through_epoch_ms -= 1;
        assert!(!same_snapshot_cut(
            &receipt,
            &expired_between_checkout_and_return
        ));

        let mut rotated_between_checkout_and_return = receipt.clone();
        rotated_between_checkout_and_return.rotation_fence_identity = "rotation:new".to_string();
        assert!(!same_snapshot_cut(
            &receipt,
            &rotated_between_checkout_and_return
        ));
    }
}
