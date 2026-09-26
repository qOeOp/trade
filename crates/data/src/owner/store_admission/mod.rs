//! Fail-closed custody for admitting an external deployment store.
//!
//! This private boundary is deliberately not a business Owner. It can seal a store-admission receipt only
//! after resolving and verifying custodian-owned signed history, consulting an independent
//! anti-rollback witness, resolving an opaque credential lease, and directly measuring the target.
//! The production resolver, signature verifier, witness, and credential resolver are intentionally
//! unavailable until their deployment authorities exist.

#![allow(
    dead_code,
    reason = "private store-admission foundations retain tested unavailable production adapters and S3 stops"
)]

mod postgres;
pub(super) use postgres::RawSharedTimeEvidenceSnapshotV1;
#[cfg(test)]
pub(super) use postgres::RawSharedTimeHistoryRowV1;

use std::{
    fmt::{Debug, Display},
    sync::Arc,
};

use async_trait::async_trait;
use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

#[cfg(test)]
use postgres::PostgresMeasurementError;
use postgres::{
    PostgresCredentialLease, PostgresDirectMeasurer, PostgresMeasurement, PostgresMeasurementSpec,
    PostgresTlsIdentity,
};

/// Exact business Owner admitted by the first deployment-store consumer.
pub(super) const MARKET_DATA_OWNER: &str = "MARKET_DATA_OWNER_V1";
/// Exact first deployment-store consumer.
pub(super) const RD_OWNER_API_CONSUMER: &str = "STRATEGY_FACTORY_RD_OWNER_API_V1";
/// Only backend admitted by the current implementation slice.
pub(super) const POSTGRES_BACKEND: &str = "POSTGRESQL_V1";

const MODE_ENV: &str = "DEPLOYMENT_STORE_ADMISSION_MODE";
const ENVIRONMENT_ENV: &str = "DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY";
const DEPLOYMENT_ENV: &str = "DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY";
const HEAD_ENV: &str = "DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY";

/// Startup decision for the default `rd-owner-api` composition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum RdOwnerStoreAdmissionBootstrap {
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
    pub(super) fn from_lookup(
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
    pub(super) fn from_environment() -> Result<Self, BootstrapConfigurationError> {
        Self::from_environment_result(std::env::var(MODE_ENV), |name| std::env::var(name).ok())
    }

    fn from_environment_result(
        mode: Result<String, std::env::VarError>,
        mut lookup: impl FnMut(&str) -> Option<String>,
    ) -> Result<Self, BootstrapConfigurationError> {
        match mode {
            Ok(mode) => Self::from_lookup(|name| {
                if name == MODE_ENV {
                    Some(mode.clone())
                } else {
                    lookup(name)
                }
            }),
            Err(std::env::VarError::NotPresent) => Self::from_lookup(lookup),
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
pub(super) enum BootstrapConfigurationError {
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
#[allow(
    clippy::struct_field_names,
    reason = "all three private values are exact deployment-store scope identities"
)]
pub(super) struct RdOwnerMarketDataAdmissionRequest {
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
    pub(super) fn new(
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
pub(super) struct SealedDeploymentStoreAdmissionReceipt {
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
    pub(super) fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    /// Returns the exact consumer identity sealed into the receipt.
    #[must_use]
    pub(super) fn consumer_identity(&self) -> &str {
        &self.consumer_identity
    }
}

/// Owner-private, consumed authority for constructing the fixed Market Data snapshot port.
///
/// This value is issued only after the complete custodian pipeline commits its sealed receipt. It
/// deliberately implements neither `Clone` nor `Serialize`, and it exposes no DSN, pool, manifest,
/// measurement envelope, or caller-authored evidence.
///
pub(super) struct AdmittedMarketDataPostgresCapability {
    receipt: SealedDeploymentStoreAdmissionReceipt,
    credential_lease: PostgresCredentialLease,
    measurement_spec: PostgresMeasurementSpec,
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
    pub(super) fn receipt_identity(&self) -> &str {
        self.receipt.receipt_identity()
    }

    /// Returns the exact fixed consumer identity sealed by the custodian.
    #[must_use]
    pub(super) fn consumer_identity(&self) -> &str {
        self.receipt.consumer_identity()
    }

    /// Consumes this authority into the only admitted Market Data storage operation.
    #[must_use]
    pub(super) fn into_source_binding_snapshot_port(self) -> AdmittedMarketDataSnapshotPort {
        AdmittedMarketDataSnapshotPort {
            receipt: self.receipt,
            revalidator: self.revalidator,
            scope: self.scope,
        }
    }

    /// Consumes this authority into the fixed Market Data PIT-evaluation snapshot operation.
    #[must_use]
    pub(super) fn into_pit_evaluation_snapshot_port(self) -> AdmittedMarketDataSnapshotPort {
        self.into_source_binding_snapshot_port()
    }

    /// Consumes this authority into the fixed Market Data PIT-terminal snapshot operation.
    #[must_use]
    pub(super) fn into_pit_terminal_snapshot_port(self) -> AdmittedMarketDataSnapshotPort {
        self.into_source_binding_snapshot_port()
    }

    /// Consumes this authority into the fixed V2 sample-projection read operation.
    pub(super) fn into_sample_projection_snapshot_port(
        self,
    ) -> Result<AdmittedMarketDataSnapshotPort, DeploymentStoreAdmissionError> {
        if !self.measurement_spec.covers_sample_projection_floor_v2() {
            return Err(rejection(
                &self.scope,
                AdmissionFailureCode::DirectMeasurementMismatch,
            ));
        }
        Ok(self.into_source_binding_snapshot_port())
    }

    /// Consumes this authority into the fixed V3 BAR sample-projection read operation.
    pub(super) fn into_sample_projection_snapshot_port_v3(
        self,
    ) -> Result<AdmittedMarketDataSnapshotPort, DeploymentStoreAdmissionError> {
        if !self.measurement_spec.covers_sample_projection_floor_v3() {
            return Err(rejection(
                &self.scope,
                AdmissionFailureCode::DirectMeasurementMismatch,
            ));
        }
        Ok(self.into_source_binding_snapshot_port())
    }

    /// Consumes this authority into the fixed BAR schedule read operation.
    pub(super) fn into_bar_schedule_snapshot_port(
        self,
    ) -> Result<AdmittedMarketDataSnapshotPort, DeploymentStoreAdmissionError> {
        if !self.measurement_spec.covers_bar_schedule_floor_v1() {
            return Err(rejection(
                &self.scope,
                AdmissionFailureCode::DirectMeasurementMismatch,
            ));
        }
        Ok(self.into_source_binding_snapshot_port())
    }

    /// Consumes this authority into the fixed native Replay scheduling read operation: a frame's
    /// BAR schedules and the quote cut its Quotes are read from.
    pub(super) fn into_native_replay_scheduling_snapshot_port_v2(
        self,
    ) -> Result<AdmittedMarketDataSnapshotPort, DeploymentStoreAdmissionError> {
        if !self.measurement_spec.covers_bar_schedule_floor_v1()
            || !self
                .measurement_spec
                .covers_native_replay_quote_cut_floor_v2()
        {
            return Err(rejection(
                &self.scope,
                AdmissionFailureCode::DirectMeasurementMismatch,
            ));
        }
        Ok(self.into_source_binding_snapshot_port())
    }

    /// Consumes this authority into the fixed Shared Time evidence read operation.
    pub(super) fn into_shared_time_evidence_snapshot_port_v1(
        self,
    ) -> Result<AdmittedMarketDataSnapshotPort, DeploymentStoreAdmissionError> {
        if !self.measurement_spec.covers_shared_time_floor_v1() {
            return Err(rejection(
                &self.scope,
                AdmissionFailureCode::DirectMeasurementMismatch,
            ));
        }
        Ok(self.into_source_binding_snapshot_port())
    }
}

/// Owner-private opaque port exposing only fixed Market Data snapshot operations.
pub(super) struct AdmittedMarketDataSnapshotPort {
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

/// Exact raw rows observed inside one fixed read-only Market Data snapshot.
pub(super) struct MarketDataSourceBindingStorageEvidence {
    admission_receipt_identity: String,
    lineage_rows: Vec<Vec<u8>>,
    clock_rows: Vec<Vec<u8>>,
}

/// Exact raw PIT, Source Binding, clock, and normalized-batch custody observed in one snapshot.
///
/// DSA deliberately does not decode these business bytes. `vibe-data` is the sole verifier that
/// may turn the complete evidence into a verified observation batch.
pub(super) struct MarketDataPitEvaluationStorageEvidence {
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

/// Exact raw PIT, Source Binding, and clock custody observed for one terminal read.
///
/// Unlike evaluation evidence, this DTO deliberately has no normalized-observation batch. DSA
/// does not decode Market Data business bytes; `vibe-data` alone validates the terminal
/// disposition and every request, source, lineage, and time binding.
pub(super) struct MarketDataPitTerminalStorageEvidence {
    admission_receipt_identity: String,
    pit_lineage_rows: Vec<Vec<u8>>,
    source_lineage_rows: Vec<Vec<u8>>,
    clock_rows: Vec<Vec<u8>>,
}

/// Exact raw projection and V1 dependency rows observed inside one admitted snapshot.
pub(super) struct StrategyInputSampleProjectionStorageEvidenceV2 {
    projection_row: Vec<u8>,
    timeframe_rows: Vec<Vec<u8>>,
    sample_rows: Vec<Vec<u8>>,
}

/// Complete raw V3 BAR projection evidence observed inside one admitted snapshot.
pub(super) struct StrategyInputSampleProjectionStorageEvidenceV3 {
    projection_row: Vec<u8>,
    dependency_rows: Vec<Vec<u8>>,
    timeframe_rows: Vec<Vec<u8>>,
    sample_rows: Vec<Vec<u8>>,
    schedule_rows: Vec<Vec<u8>>,
    schedule_history_rows: Vec<Vec<Vec<u8>>>,
}

impl StrategyInputSampleProjectionStorageEvidenceV3 {
    #[must_use]
    pub(super) fn projection_row(&self) -> &[u8] {
        &self.projection_row
    }
    #[must_use]
    pub(super) fn dependency_rows(&self) -> &[Vec<u8>] {
        &self.dependency_rows
    }
    #[must_use]
    pub(super) fn timeframe_rows(&self) -> &[Vec<u8>] {
        &self.timeframe_rows
    }
    #[must_use]
    pub(super) fn sample_rows(&self) -> &[Vec<u8>] {
        &self.sample_rows
    }
    #[must_use]
    pub(super) fn schedule_rows(&self) -> &[Vec<u8>] {
        &self.schedule_rows
    }
    #[must_use]
    pub(super) fn schedule_history_rows(&self) -> &[Vec<Vec<u8>>] {
        &self.schedule_history_rows
    }

    #[cfg(test)]
    pub(super) async fn from_disposable_postgres(
        database_url: String,
        receipt_digest: [u8; 32],
    ) -> Result<Self, ()> {
        let lease = PostgresCredentialLease::from_resolved_secret(
            "disposable-sample-projection-v3-test",
            "vibe-data-test",
            "v1",
            u64::MAX,
            database_url,
        )
        .map_err(|_| ())?;
        let raw =
            postgres::read_strategy_input_sample_projection_snapshot_v3(&lease, &receipt_digest)
                .await
                .map_err(|_| ())?;
        Ok(Self {
            projection_row: raw.projection_row,
            dependency_rows: raw.dependency_rows,
            timeframe_rows: raw.timeframe_rows,
            sample_rows: raw.sample_rows,
            schedule_rows: raw.schedule_rows,
            schedule_history_rows: raw.schedule_history_rows,
        })
    }
}

impl StrategyInputSampleProjectionStorageEvidenceV2 {
    #[must_use]
    pub(super) fn projection_row(&self) -> &[u8] {
        &self.projection_row
    }

    #[must_use]
    pub(super) fn timeframe_rows(&self) -> &[Vec<u8>] {
        &self.timeframe_rows
    }

    #[must_use]
    pub(super) fn sample_rows(&self) -> &[Vec<u8>] {
        &self.sample_rows
    }

    #[cfg(test)]
    pub(super) async fn from_disposable_postgres(
        database_url: String,
        receipt_digest: [u8; 32],
    ) -> Result<Self, ()> {
        let lease = PostgresCredentialLease::from_resolved_secret(
            "disposable-sample-projection-test",
            "vibe-data-test",
            "v1",
            u64::MAX,
            database_url,
        )
        .map_err(|_| ())?;
        let raw =
            postgres::read_strategy_input_sample_projection_snapshot_v2(&lease, &receipt_digest)
                .await
                .map_err(|_| ())?;
        Ok(Self {
            projection_row: raw.projection_row,
            timeframe_rows: raw.timeframe_rows,
            sample_rows: raw.sample_rows,
        })
    }
}

/// Exact raw BAR readback and append-only history observed inside one admitted snapshot.
///
/// The evidence never leaves the Market Data Owner and has no public constructor.
pub(super) struct BarScheduleStorageEvidenceV1 {
    readback_row: Vec<u8>,
    history_rows: Vec<Vec<u8>>,
}

impl BarScheduleStorageEvidenceV1 {
    #[must_use]
    pub(super) fn readback_row(&self) -> &[u8] {
        &self.readback_row
    }

    #[must_use]
    pub(super) fn history_rows(&self) -> &[Vec<u8>] {
        &self.history_rows
    }
}

/// Exact native index columns and bytes for one normalized PIT observation row.
pub(super) struct MarketDataPitObservationNativeRow {
    ordinal: u64,
    symbolic_key: String,
    member_key: String,
    row_bytes: Vec<u8>,
}

impl MarketDataPitObservationNativeRow {
    #[must_use]
    pub(super) const fn ordinal(&self) -> u64 {
        self.ordinal
    }
    #[must_use]
    pub(super) fn symbolic_key(&self) -> &str {
        &self.symbolic_key
    }
    #[must_use]
    pub(super) fn member_key(&self) -> &str {
        &self.member_key
    }
    #[must_use]
    pub(super) fn row_bytes(&self) -> &[u8] {
        &self.row_bytes
    }
}

impl MarketDataPitEvaluationStorageEvidence {
    #[must_use]
    pub(super) fn admission_receipt_identity(&self) -> &str {
        &self.admission_receipt_identity
    }
    #[must_use]
    pub(super) fn pit_lineage_rows(&self) -> &[Vec<u8>] {
        &self.pit_lineage_rows
    }
    #[must_use]
    pub(super) fn source_lineage_rows(&self) -> &[Vec<u8>] {
        &self.source_lineage_rows
    }
    #[must_use]
    pub(super) fn clock_rows(&self) -> &[Vec<u8>] {
        &self.clock_rows
    }
    #[must_use]
    pub(super) const fn batch_source_binding_identity(&self) -> &[u8; 32] {
        &self.batch_source_binding_identity
    }
    #[must_use]
    pub(super) const fn batch_source_binding_lineage_root(&self) -> &[u8; 32] {
        &self.batch_source_binding_lineage_root
    }
    #[must_use]
    pub(super) const fn batch_source_binding_lineage_version(&self) -> u64 {
        self.batch_source_binding_lineage_version
    }
    #[must_use]
    pub(super) const fn batch_digest(&self) -> &[u8; 32] {
        &self.batch_digest
    }
    #[must_use]
    pub(super) fn batch_bytes(&self) -> &[u8] {
        &self.batch_bytes
    }
    #[must_use]
    pub(super) fn batch_rows(&self) -> &[MarketDataPitObservationNativeRow] {
        &self.batch_rows
    }
}

impl MarketDataPitTerminalStorageEvidence {
    #[must_use]
    pub(super) fn admission_receipt_identity(&self) -> &str {
        &self.admission_receipt_identity
    }
    #[must_use]
    pub(super) fn pit_lineage_rows(&self) -> &[Vec<u8>] {
        &self.pit_lineage_rows
    }
    #[must_use]
    pub(super) fn source_lineage_rows(&self) -> &[Vec<u8>] {
        &self.source_lineage_rows
    }
    #[must_use]
    pub(super) fn clock_rows(&self) -> &[Vec<u8>] {
        &self.clock_rows
    }
}

impl MarketDataSourceBindingStorageEvidence {
    #[must_use]
    pub(super) fn admission_receipt_identity(&self) -> &str {
        &self.admission_receipt_identity
    }
    #[must_use]
    pub(super) fn lineage_rows(&self) -> &[Vec<u8>] {
        &self.lineage_rows
    }
    #[must_use]
    pub(super) fn clock_rows(&self) -> &[Vec<u8>] {
        &self.clock_rows
    }
}

impl AdmittedMarketDataSnapshotPort {
    /// Reads one Shared Time head and an optional direct successor after admission before and after.
    pub(super) async fn resolve_shared_time_evidence_v1(
        &self,
    ) -> Result<postgres::RawSharedTimeEvidenceSnapshotV1, DeploymentStoreAdmissionError> {
        let before = self
            .revalidator
            .admit_capability(self.scope.clone())
            .await?;
        validate_shared_time_revalidation_v1(
            &self.scope,
            &self.receipt,
            &before.receipt,
            &before.measurement_spec,
        )?;
        let raw = postgres::read_shared_time_evidence_snapshot_v1(&before.credential_lease)
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
        validate_shared_time_revalidation_v1(
            &self.scope,
            &self.receipt,
            &after.receipt,
            &after.measurement_spec,
        )?;
        Ok(raw)
    }

    /// Reads all candidates for one canonical instrument after admission before and after.
    pub(super) async fn resolve_bar_schedule_candidates_v1(
        &self,
        canonical_instrument: &str,
    ) -> Result<Vec<BarScheduleStorageEvidenceV1>, DeploymentStoreAdmissionError> {
        let before = self
            .revalidator
            .admit_capability(self.scope.clone())
            .await?;
        validate_bar_schedule_revalidation_v1(
            &self.scope,
            &self.receipt,
            &before.receipt,
            &before.measurement_spec,
        )?;
        let raw = postgres::read_bar_schedule_candidate_snapshots_v1(
            &before.credential_lease,
            canonical_instrument,
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
        validate_bar_schedule_revalidation_v1(
            &self.scope,
            &self.receipt,
            &after.receipt,
            &after.measurement_spec,
        )?;
        Ok(bar_schedule_candidate_evidence_v1(raw))
    }

    /// Reads one frame's quote cut census after admission before and after.
    pub(super) async fn resolve_native_replay_quote_cut_census_v2(
        &self,
        scope_digest: [u8; 32],
        frame_time_ns: u64,
        decision_cut_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> Result<postgres::RawNativeReplayQuoteCutCensusV2, DeploymentStoreAdmissionError> {
        let before = self
            .revalidator
            .admit_capability(self.scope.clone())
            .await?;
        validate_native_replay_quote_cut_revalidation_v2(
            &self.scope,
            &self.receipt,
            &before.receipt,
            &before.measurement_spec,
        )?;
        let raw = postgres::read_native_replay_quote_cut_census_snapshot_v2(
            &before.credential_lease,
            &scope_digest,
            frame_time_ns,
            decision_cut_ns,
            window_end_ns_exclusive,
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
        validate_native_replay_quote_cut_revalidation_v2(
            &self.scope,
            &self.receipt,
            &after.receipt,
            &after.measurement_spec,
        )?;
        Ok(raw)
    }

    /// Reads one fixed BAR schedule readback and complete history after admission before and after.
    pub(super) async fn resolve_bar_schedule_v1(
        &self,
        readback_identity: [u8; 32],
    ) -> Result<Option<BarScheduleStorageEvidenceV1>, DeploymentStoreAdmissionError> {
        let before = self
            .revalidator
            .admit_capability(self.scope.clone())
            .await?;
        validate_bar_schedule_revalidation_v1(
            &self.scope,
            &self.receipt,
            &before.receipt,
            &before.measurement_spec,
        )?;
        let raw =
            postgres::read_bar_schedule_snapshot_v1(&before.credential_lease, &readback_identity)
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
        validate_bar_schedule_revalidation_v1(
            &self.scope,
            &self.receipt,
            &after.receipt,
            &after.measurement_spec,
        )?;
        Ok(raw.map(|raw| BarScheduleStorageEvidenceV1 {
            readback_row: raw.readback_row,
            history_rows: raw.history_rows,
        }))
    }

    /// Revalidates the BAR measurement floor and admission cut immediately before return.
    pub(super) async fn revalidate_bar_schedule_v1_before_return(
        &self,
    ) -> Result<(), DeploymentStoreAdmissionError> {
        let current = self
            .revalidator
            .admit_capability(self.scope.clone())
            .await?;
        validate_bar_schedule_revalidation_v1(
            &self.scope,
            &self.receipt,
            &current.receipt,
            &current.measurement_spec,
        )
    }

    /// Reads one fixed V2 projection and all referenced V1 custody after admission before and after.
    pub(super) async fn resolve_sample_projection_v2(
        &self,
        receipt_digest: [u8; 32],
    ) -> Result<StrategyInputSampleProjectionStorageEvidenceV2, DeploymentStoreAdmissionError> {
        let before = self
            .revalidator
            .admit_capability(self.scope.clone())
            .await?;
        validate_sample_projection_revalidation_v2(
            &self.scope,
            &self.receipt,
            &before.receipt,
            &before.measurement_spec,
        )?;
        let raw = postgres::read_strategy_input_sample_projection_snapshot_v2(
            &before.credential_lease,
            &receipt_digest,
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
        validate_sample_projection_revalidation_v2(
            &self.scope,
            &self.receipt,
            &after.receipt,
            &after.measurement_spec,
        )?;
        Ok(StrategyInputSampleProjectionStorageEvidenceV2 {
            projection_row: raw.projection_row,
            timeframe_rows: raw.timeframe_rows,
            sample_rows: raw.sample_rows,
        })
    }

    /// Revalidates the exact V2 measurement floor and admission cut immediately before return.
    pub(super) async fn revalidate_sample_projection_v2_before_return(
        &self,
    ) -> Result<(), DeploymentStoreAdmissionError> {
        let current = self
            .revalidator
            .admit_capability(self.scope.clone())
            .await?;
        validate_sample_projection_revalidation_v2(
            &self.scope,
            &self.receipt,
            &current.receipt,
            &current.measurement_spec,
        )
    }

    /// Reads one fixed V3 BAR projection and every referenced Owner artifact in one snapshot.
    pub(super) async fn resolve_sample_projection_v3(
        &self,
        receipt_digest: [u8; 32],
    ) -> Result<StrategyInputSampleProjectionStorageEvidenceV3, DeploymentStoreAdmissionError> {
        let before = self
            .revalidator
            .admit_capability(self.scope.clone())
            .await?;
        validate_sample_projection_revalidation_v3(
            &self.scope,
            &self.receipt,
            &before.receipt,
            &before.measurement_spec,
        )?;
        let raw = postgres::read_strategy_input_sample_projection_snapshot_v3(
            &before.credential_lease,
            &receipt_digest,
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
        validate_sample_projection_revalidation_v3(
            &self.scope,
            &self.receipt,
            &after.receipt,
            &after.measurement_spec,
        )?;
        Ok(StrategyInputSampleProjectionStorageEvidenceV3 {
            projection_row: raw.projection_row,
            dependency_rows: raw.dependency_rows,
            timeframe_rows: raw.timeframe_rows,
            sample_rows: raw.sample_rows,
            schedule_rows: raw.schedule_rows,
            schedule_history_rows: raw.schedule_history_rows,
        })
    }

    /// Revalidates the complete V3 BAR floor and admission cut immediately before promotion.
    pub(super) async fn revalidate_sample_projection_v3_before_return(
        &self,
    ) -> Result<(), DeploymentStoreAdmissionError> {
        let current = self
            .revalidator
            .admit_capability(self.scope.clone())
            .await?;
        validate_sample_projection_revalidation_v3(
            &self.scope,
            &self.receipt,
            &current.receipt,
            &current.measurement_spec,
        )
    }

    /// Reads one fixed Source Binding snapshot after full admission both before checkout and return.
    pub(super) async fn resolve(
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
    pub(super) async fn resolve_pit_evaluation(
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
        Ok(pit_evaluation_evidence_v1(
            self.receipt.receipt_identity.clone(),
            raw,
        ))
    }

    /// Reads one fixed PIT-terminal snapshot after admission both before checkout and return.
    ///
    /// Storage or transport failure remains an admission error. It is never converted into a
    /// Market Data `UNAVAILABLE` disposition.
    pub(super) async fn resolve_pit_terminal(
        &self,
        snapshot_identity: [u8; 32],
    ) -> Result<MarketDataPitTerminalStorageEvidence, DeploymentStoreAdmissionError> {
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
        let raw = postgres::read_market_data_pit_terminal_snapshot(
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
        Ok(MarketDataPitTerminalStorageEvidence {
            admission_receipt_identity: self.receipt.receipt_identity.clone(),
            pit_lineage_rows: raw.pit_lineage_rows,
            source_lineage_rows: raw.source_lineage_rows,
            clock_rows: raw.clock_rows,
        })
    }
}

fn same_snapshot_cut(
    expected: &SealedDeploymentStoreAdmissionReceipt,
    observed: &SealedDeploymentStoreAdmissionReceipt,
) -> bool {
    expected == observed
}

fn validate_sample_projection_revalidation_v2(
    scope: &AdmissionScope,
    expected: &SealedDeploymentStoreAdmissionReceipt,
    observed: &SealedDeploymentStoreAdmissionReceipt,
    observed_measurement_spec: &PostgresMeasurementSpec,
) -> Result<(), DeploymentStoreAdmissionError> {
    if !observed_measurement_spec.covers_sample_projection_floor_v2() {
        return Err(rejection(
            scope,
            AdmissionFailureCode::DirectMeasurementMismatch,
        ));
    }

    if !same_snapshot_cut(expected, observed) {
        return Err(rejection(scope, AdmissionFailureCode::AdmissionCutExpired));
    }
    Ok(())
}

fn validate_sample_projection_revalidation_v3(
    scope: &AdmissionScope,
    expected: &SealedDeploymentStoreAdmissionReceipt,
    observed: &SealedDeploymentStoreAdmissionReceipt,
    observed_measurement_spec: &PostgresMeasurementSpec,
) -> Result<(), DeploymentStoreAdmissionError> {
    if !observed_measurement_spec.covers_sample_projection_floor_v3() {
        return Err(rejection(
            scope,
            AdmissionFailureCode::DirectMeasurementMismatch,
        ));
    }

    if !same_snapshot_cut(expected, observed) {
        return Err(rejection(scope, AdmissionFailureCode::AdmissionCutExpired));
    }
    Ok(())
}

fn validate_bar_schedule_revalidation_v1(
    scope: &AdmissionScope,
    expected: &SealedDeploymentStoreAdmissionReceipt,
    observed: &SealedDeploymentStoreAdmissionReceipt,
    observed_measurement_spec: &PostgresMeasurementSpec,
) -> Result<(), DeploymentStoreAdmissionError> {
    if !observed_measurement_spec.covers_bar_schedule_floor_v1() {
        return Err(rejection(
            scope,
            AdmissionFailureCode::DirectMeasurementMismatch,
        ));
    }

    if !same_snapshot_cut(expected, observed) {
        return Err(rejection(scope, AdmissionFailureCode::AdmissionCutExpired));
    }
    Ok(())
}

fn validate_native_replay_quote_cut_revalidation_v2(
    scope: &AdmissionScope,
    expected: &SealedDeploymentStoreAdmissionReceipt,
    observed: &SealedDeploymentStoreAdmissionReceipt,
    observed_measurement_spec: &PostgresMeasurementSpec,
) -> Result<(), DeploymentStoreAdmissionError> {
    if !observed_measurement_spec.covers_native_replay_quote_cut_floor_v2() {
        return Err(rejection(
            scope,
            AdmissionFailureCode::DirectMeasurementMismatch,
        ));
    }

    if !same_snapshot_cut(expected, observed) {
        return Err(rejection(scope, AdmissionFailureCode::AdmissionCutExpired));
    }
    Ok(())
}

fn validate_shared_time_revalidation_v1(
    scope: &AdmissionScope,
    expected: &SealedDeploymentStoreAdmissionReceipt,
    observed: &SealedDeploymentStoreAdmissionReceipt,
    observed_measurement_spec: &PostgresMeasurementSpec,
) -> Result<(), DeploymentStoreAdmissionError> {
    if !observed_measurement_spec.covers_shared_time_floor_v1() {
        return Err(rejection(
            scope,
            AdmissionFailureCode::DirectMeasurementMismatch,
        ));
    }

    if !same_snapshot_cut(expected, observed) {
        return Err(rejection(scope, AdmissionFailureCode::AdmissionCutExpired));
    }
    Ok(())
}

/// Stable failure categories at the custody boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(super) enum AdmissionFailureCode {
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
pub(super) struct DeploymentStoreCustodyIncident {
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
pub(super) struct DeploymentStoreAdmissionError {
    code: AdmissionFailureCode,
    incident: Box<DeploymentStoreCustodyIncident>,
}

impl DeploymentStoreAdmissionError {
    /// Returns the stable rejection category.
    #[must_use]
    pub(super) const fn code(&self) -> AdmissionFailureCode {
        self.code
    }

    /// Returns the immutable incident for custody and diagnostics.
    #[must_use]
    pub(super) fn incident(&self) -> &DeploymentStoreCustodyIncident {
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
pub(super) async fn admit_rd_owner_market_data_postgres(
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

/// The evidence one PIT evaluation read returns, under the receipt the read was made against.
fn pit_evaluation_evidence_v1(
    admission_receipt_identity: String,
    raw: postgres::RawPitEvaluationSnapshot,
) -> MarketDataPitEvaluationStorageEvidence {
    MarketDataPitEvaluationStorageEvidence {
        admission_receipt_identity,
        pit_lineage_rows: raw.pit_lineage_rows,
        source_lineage_rows: raw.source_lineage_rows,
        clock_rows: raw.clock_rows,
        batch_source_binding_identity: raw.batch_source_binding_identity,
        batch_source_binding_lineage_root: raw.batch_source_binding_lineage_root,
        batch_source_binding_lineage_version: raw.batch_source_binding_lineage_version,
        batch_digest: raw.batch_digest,
        batch_bytes: raw.batch_bytes,
        batch_rows: raw.batch_rows,
    }
}

/// The evidence one BAR schedule candidate read returns.
fn bar_schedule_candidate_evidence_v1(
    raw: Vec<postgres::RawBarScheduleSnapshotV1>,
) -> Vec<BarScheduleStorageEvidenceV1> {
    raw.into_iter()
        .map(|raw| BarScheduleStorageEvidenceV1 {
            readback_row: raw.readback_row,
            history_rows: raw.history_rows,
        })
        .collect()
}

/// The three reads a native Replay initial market resolution makes, whichever port makes them.
///
/// The admitted port wraps each read in admission before and after it. The sealed acceptance port
/// makes the same raw read with no admission at all. What `vibe-data` does with the evidence -
/// verification, selection, the quote cut rules - exists once, over whichever port implements this.
#[async_trait]
pub(super) trait NativeReplaySchedulingReadPortV1: Send + Sync {
    /// The complete PIT evaluation evidence of one snapshot.
    async fn resolve_pit_evaluation(
        &self,
        snapshot_identity: [u8; 32],
    ) -> Result<MarketDataPitEvaluationStorageEvidence, DeploymentStoreAdmissionError>;

    /// Every BAR schedule candidate of one canonical instrument, with its history.
    async fn resolve_bar_schedule_candidates_v1(
        &self,
        canonical_instrument: &str,
    ) -> Result<Vec<BarScheduleStorageEvidenceV1>, DeploymentStoreAdmissionError>;

    /// One frame's quote cut census and the bound its next frame sets.
    async fn resolve_native_replay_quote_cut_census_v2(
        &self,
        scope_digest: [u8; 32],
        frame_time_ns: u64,
        decision_cut_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> Result<postgres::RawNativeReplayQuoteCutCensusV2, DeploymentStoreAdmissionError>;
}

#[async_trait]
impl NativeReplaySchedulingReadPortV1 for AdmittedMarketDataSnapshotPort {
    async fn resolve_pit_evaluation(
        &self,
        snapshot_identity: [u8; 32],
    ) -> Result<MarketDataPitEvaluationStorageEvidence, DeploymentStoreAdmissionError> {
        Self::resolve_pit_evaluation(self, snapshot_identity).await
    }

    async fn resolve_bar_schedule_candidates_v1(
        &self,
        canonical_instrument: &str,
    ) -> Result<Vec<BarScheduleStorageEvidenceV1>, DeploymentStoreAdmissionError> {
        Self::resolve_bar_schedule_candidates_v1(self, canonical_instrument).await
    }

    async fn resolve_native_replay_quote_cut_census_v2(
        &self,
        scope_digest: [u8; 32],
        frame_time_ns: u64,
        decision_cut_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> Result<postgres::RawNativeReplayQuoteCutCensusV2, DeploymentStoreAdmissionError> {
        Self::resolve_native_replay_quote_cut_census_v2(
            self,
            scope_digest,
            frame_time_ns,
            decision_cut_ns,
            window_end_ns_exclusive,
        )
        .await
    }
}

/// The receipt identity every evidence from the sealed acceptance port carries: it names the
/// absence of a Store Admission, so no reader can take such evidence for admitted evidence.
#[cfg(any(test, feature = "sealed-strategy-input-acceptance"))]
pub(super) const SEALED_ACCEPTANCE_NO_STORE_ADMISSION_V1: &str =
    "SEALED_ACCEPTANCE_NO_STORE_ADMISSION_V1";

/// The native Replay scheduling reads over a directly connected principal, for sealed acceptance
/// only.
///
/// It makes exactly the raw reads the admitted port makes, through the same measured-read
/// functions, which accept only a disposable loopback `vibe_test_` database. What it does not do
/// is the admission itself: no custody history, signer, anti-rollback witness, credential lease or
/// direct measurement before a read, and no revalidation after one. That segment is `B3` and stays
/// unproven here. The principal is whatever the URL names; acceptance connects as a least-privilege
/// test principal granted exactly `NATIVE_REPLAY_SCHEDULING_ACCEPTANCE_GRANTS_V1`, so a read that
/// strays outside that set is refused rather than silently answered.
#[cfg(any(test, feature = "sealed-strategy-input-acceptance"))]
pub(super) struct UnadmittedAcceptanceSnapshotPortV1 {
    lease: postgres::PostgresCredentialLease,
    scope: AdmissionScope,
}

#[cfg(any(test, feature = "sealed-strategy-input-acceptance"))]
impl Debug for UnadmittedAcceptanceSnapshotPortV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(UnadmittedAcceptanceSnapshotPortV1))
            .finish_non_exhaustive()
    }
}

#[cfg(any(test, feature = "sealed-strategy-input-acceptance"))]
impl UnadmittedAcceptanceSnapshotPortV1 {
    /// A port reading as the principal `database_url` names.
    ///
    /// # Errors
    ///
    /// `CredentialLeaseRejected` when the URL is empty.
    pub(super) fn from_database_url(
        database_url: &str,
    ) -> Result<Self, DeploymentStoreAdmissionError> {
        let scope = AdmissionScope {
            environment_identity: SEALED_ACCEPTANCE_NO_STORE_ADMISSION_V1.to_owned(),
            deployment_identity: SEALED_ACCEPTANCE_NO_STORE_ADMISSION_V1.to_owned(),
            consumer_owner: MARKET_DATA_OWNER.to_owned(),
            consumer_identity: RD_OWNER_API_CONSUMER.to_owned(),
            backend: POSTGRES_BACKEND.to_owned(),
            expected_head_identity: SEALED_ACCEPTANCE_NO_STORE_ADMISSION_V1.to_owned(),
        };
        let lease = postgres::PostgresCredentialLease::from_resolved_secret(
            "sealed-acceptance",
            "market-data-native-replay-scheduling",
            "v1",
            u64::MAX,
            database_url.to_owned(),
        )
        .map_err(|_| rejection(&scope, AdmissionFailureCode::CredentialLeaseRejected))?;
        Ok(Self { lease, scope })
    }

    fn unavailable(&self) -> DeploymentStoreAdmissionError {
        rejection(
            &self.scope,
            AdmissionFailureCode::DirectMeasurementUnavailable,
        )
    }
}

#[cfg(any(test, feature = "sealed-strategy-input-acceptance"))]
#[async_trait]
impl NativeReplaySchedulingReadPortV1 for UnadmittedAcceptanceSnapshotPortV1 {
    async fn resolve_pit_evaluation(
        &self,
        snapshot_identity: [u8; 32],
    ) -> Result<MarketDataPitEvaluationStorageEvidence, DeploymentStoreAdmissionError> {
        let raw =
            postgres::read_market_data_pit_evaluation_snapshot(&self.lease, &snapshot_identity)
                .await
                .map_err(|_| self.unavailable())?;
        Ok(pit_evaluation_evidence_v1(
            SEALED_ACCEPTANCE_NO_STORE_ADMISSION_V1.to_owned(),
            raw,
        ))
    }

    async fn resolve_bar_schedule_candidates_v1(
        &self,
        canonical_instrument: &str,
    ) -> Result<Vec<BarScheduleStorageEvidenceV1>, DeploymentStoreAdmissionError> {
        let raw =
            postgres::read_bar_schedule_candidate_snapshots_v1(&self.lease, canonical_instrument)
                .await
                .map_err(|_| self.unavailable())?;
        Ok(bar_schedule_candidate_evidence_v1(raw))
    }

    async fn resolve_native_replay_quote_cut_census_v2(
        &self,
        scope_digest: [u8; 32],
        frame_time_ns: u64,
        decision_cut_ns: u64,
        window_end_ns_exclusive: u64,
    ) -> Result<postgres::RawNativeReplayQuoteCutCensusV2, DeploymentStoreAdmissionError> {
        postgres::read_native_replay_quote_cut_census_snapshot_v2(
            &self.lease,
            &scope_digest,
            frame_time_ns,
            decision_cut_ns,
            window_end_ns_exclusive,
        )
        .await
        .map_err(|_| self.unavailable())
    }
}

/// One privilege the sealed acceptance principal is granted.
#[cfg(any(test, feature = "sealed-strategy-input-acceptance"))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum AcceptanceGrantV1 {
    /// `USAGE` on a schema.
    SchemaUsage(&'static str),
    /// `SELECT` on a relation the raw reads name directly.
    TableSelect(&'static str),
    /// `EXECUTE` on a function the raw reads call, by its exact signature.
    FunctionExecute(&'static str),
}

#[cfg(any(test, feature = "sealed-strategy-input-acceptance"))]
impl AcceptanceGrantV1 {
    fn object(self) -> String {
        match self {
            Self::SchemaUsage(schema) => format!("USAGE ON SCHEMA {schema}"),
            Self::TableSelect(table) => format!("SELECT ON TABLE {table}"),
            Self::FunctionExecute(function) => format!("EXECUTE ON FUNCTION {function}"),
        }
    }

    /// `GRANT` of this privilege to an already quoted role.
    pub(super) fn grant_to(self, quoted_role: &str) -> String {
        format!("GRANT {} TO {quoted_role}", self.object())
    }

    /// `REVOKE` of this privilege from an already quoted role.
    pub(super) fn revoke_from(self, quoted_role: &str) -> String {
        format!("REVOKE {} FROM {quoted_role}", self.object())
    }
}

/// Exactly what the three native Replay scheduling raw reads need of the principal they connect
/// as, and nothing more.
///
/// It is also a draft of the gate `B3` must grant the principal a Store Admission leases, measured
/// by removal: the sealed acceptance proof revokes each entry alone and requires the read that
/// needs it to be refused. Two entries fall outside every floor a scheduling admission measures
/// today: the PIT evaluation read names `pit_snapshot_facts_v1` and `clock_handoffs_v1` directly,
/// and no floor covers the PIT evaluation functions at all.
#[cfg(any(test, feature = "sealed-strategy-input-acceptance"))]
pub(super) const NATIVE_REPLAY_SCHEDULING_ACCEPTANCE_GRANTS_V1: &[AcceptanceGrantV1] = &[
    AcceptanceGrantV1::SchemaUsage("market_data_private"),
    AcceptanceGrantV1::TableSelect("market_data_private.pit_snapshot_facts_v1"),
    AcceptanceGrantV1::TableSelect("market_data_private.clock_handoffs_v1"),
    AcceptanceGrantV1::FunctionExecute("market_data_private.resolve_pit_snapshot_v1(bytea)"),
    AcceptanceGrantV1::FunctionExecute(
        "market_data_private.resolve_pit_observation_batch_v1(bytea)",
    ),
    AcceptanceGrantV1::FunctionExecute(
        "market_data_private.resolve_pit_observation_rows_v1(bytea)",
    ),
    AcceptanceGrantV1::FunctionExecute("market_data_private.resolve_pit_lineage_custody_v1(bytea)"),
    AcceptanceGrantV1::FunctionExecute("market_data_private.resolve_pit_lineage_members_v1(bytea)"),
    AcceptanceGrantV1::FunctionExecute("market_data_private.resolve_source_binding_v1(bytea)"),
    AcceptanceGrantV1::FunctionExecute(
        "market_data_private.resolve_source_lineage_custody_v1(bytea)",
    ),
    AcceptanceGrantV1::FunctionExecute(
        "market_data_private.resolve_source_lineage_members_v1(bytea)",
    ),
    AcceptanceGrantV1::FunctionExecute("market_data_private.resolve_clock_custody_state_v1()"),
    AcceptanceGrantV1::FunctionExecute(
        "market_data_private.resolve_owner_history_census_custody_v1()",
    ),
    AcceptanceGrantV1::FunctionExecute(
        "market_data_private.resolve_bar_schedule_candidates_v1(text)",
    ),
    AcceptanceGrantV1::FunctionExecute("market_data_private.resolve_bar_schedule_history_v1(text)"),
    AcceptanceGrantV1::FunctionExecute(
        "market_data_private.resolve_native_replay_quote_cut_census_v2(bytea,bigint,bigint)",
    ),
    AcceptanceGrantV1::FunctionExecute(
        "market_data_private.resolve_native_replay_next_frame_v2(bytea,bigint,bigint)",
    ),
];

/// Applies `statement_of` for every sealed acceptance grant to `role`, as the Market Data owner.
///
/// # Errors
///
/// The store's error when a statement is refused; statements already applied stay applied.
#[cfg(any(test, feature = "sealed-strategy-input-acceptance"))]
pub(super) async fn apply_native_replay_scheduling_acceptance_grants_v1(
    owner: &sqlx::PgPool,
    role: &str,
    statement_of: fn(AcceptanceGrantV1, &str) -> String,
) -> Result<(), sqlx::Error> {
    let quoted: String = sqlx::query_scalar("SELECT pg_catalog.quote_ident($1)")
        .bind(role)
        .fetch_one(owner)
        .await?;

    for grant in NATIVE_REPLAY_SCHEDULING_ACCEPTANCE_GRANTS_V1 {
        sqlx::query(sqlx::AssertSqlSafe(statement_of(*grant, &quoted)))
            .execute(owner)
            .await?;
    }
    Ok(())
}

/// Makes the intentionally unavailable S3 boundary explicit without adding an adapter.
///
/// # Errors
///
/// Always returns `S3_UNAVAILABLE` for the fixed consumer scope.
pub(super) fn unavailable_s3_admission(
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

        let manifests = validate_and_order_history(&scope, &resolved.manifests)?;
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
            measurement_spec: latest.measurement_spec.clone(),
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

fn validate_and_order_history(
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
            Self::with_spec(
                &PostgresMeasurementSpec::new(
                    "market_data_private",
                    "market_data_private.schema_migrations_v1",
                    vec!["market_data_api.resolve_snapshot_v1(text)".to_string()],
                    vec!["market_data_private.snapshot_facts_v1".to_string()],
                )
                .unwrap(),
            )
        }

        fn with_spec(spec: &PostgresMeasurementSpec) -> Self {
            Self::with_spec_and_measurement(spec, measurement("role-v1"))
        }

        /// Builds the fixture around a measurement the caller supplies.
        ///
        /// Admission compares what the measurer returns against what the manifest recorded, so a
        /// custodian holding a *real* measurer needs manifests built from a real measurement. Every
        /// other caller passes the synthetic one and behaves exactly as before.
        fn with_spec_and_measurement(
            spec: &PostgresMeasurementSpec,
            measurement: PostgresMeasurement,
        ) -> Self {
            let request = RdOwnerMarketDataAdmissionRequest::new(
                "test-environment".to_string(),
                "rd-workbench-test".to_string(),
                format!("sha256:{}", "0".repeat(64)),
            )
            .unwrap();
            let scope = request.scope();
            let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
            let genesis = manifest(
                &scope,
                &measurement,
                spec,
                1,
                None,
                "rotation-fence-genesis",
            );
            let successor = manifest(
                &scope,
                &measurement,
                spec,
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
    async fn sample_projection_capability_requires_and_preserves_exact_measurement_floor() {
        let unrelated = Fixture::new();
        let capability = unrelated
            .custodian(Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)))
            .admit_capability(unrelated.request.scope())
            .await
            .expect("unrelated admission remains valid for unrelated consumers");
        assert_eq!(
            capability
                .into_sample_projection_snapshot_port()
                .unwrap_err()
                .code(),
            AdmissionFailureCode::DirectMeasurementMismatch
        );

        let complete = Fixture::with_spec(
            &PostgresMeasurementSpec::new(
                "market_data_private",
                "market_data_private.schema_migrations_v1",
                vec![
                    "market_data_private.resolve_strategy_input_sample_projection_v2(bytea)"
                        .to_string(),
                    "market_data_private.resolve_timeframe_projection_receipt_v1(bytea)"
                        .to_string(),
                    "market_data_private.resolve_sample_receipt_v1(bytea)".to_string(),
                ],
                vec![
                    "market_data_private.strategy_input_sample_projection_receipts_v2".to_string(),
                    "market_data_private.timeframe_projection_receipts_v1".to_string(),
                    "market_data_private.sample_facts_v1".to_string(),
                    "market_data_private.sample_receipts_v1".to_string(),
                    "market_data_private.sample_outbox_v1".to_string(),
                ],
            )
            .unwrap(),
        );
        let measurement_calls = Arc::new(AtomicUsize::new(0));
        let custodian = complete.custodian(
            Arc::new(AtomicUsize::new(0)),
            Arc::clone(&measurement_calls),
        );
        let initial = custodian
            .admit_capability(complete.request.scope())
            .await
            .expect("complete floor admitted");
        assert!(initial.measurement_spec.covers_sample_projection_floor_v2());
        let port = initial
            .into_sample_projection_snapshot_port()
            .expect("complete floor promotes projection port");
        assert_eq!(measurement_calls.load(Ordering::SeqCst), 1);
        port.revalidate_sample_projection_v2_before_return()
            .await
            .expect("return performs a distinct complete revalidation");
        assert_eq!(measurement_calls.load(Ordering::SeqCst), 2);

        let incomplete_spec = PostgresMeasurementSpec::new(
            "market_data_private",
            "market_data_private.schema_migrations_v1",
            vec!["market_data_api.resolve_snapshot_v1(text)".to_string()],
            vec!["market_data_private.snapshot_facts_v1".to_string()],
        )
        .unwrap();
        assert_eq!(
            validate_sample_projection_revalidation_v2(
                &port.scope,
                &port.receipt,
                &port.receipt,
                &incomplete_spec,
            )
            .unwrap_err()
            .code(),
            AdmissionFailureCode::DirectMeasurementMismatch
        );

        let mut rotated = port.receipt.clone();
        rotated.rotation_fence_identity = "rotation:new".to_string();
        assert_eq!(
            validate_sample_projection_revalidation_v2(
                &port.scope,
                &port.receipt,
                &rotated,
                &complete.history.manifests[1].manifest.measurement_spec,
            )
            .unwrap_err()
            .code(),
            AdmissionFailureCode::AdmissionCutExpired
        );
    }

    #[tokio::test]
    async fn v3_bar_projection_requires_complete_floor_and_revalidates_exact_cut() {
        let unrelated = Fixture::new();
        let capability = unrelated
            .custodian(Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)))
            .admit_capability(unrelated.request.scope())
            .await
            .expect("unrelated admission");
        assert_eq!(
            capability
                .into_sample_projection_snapshot_port_v3()
                .unwrap_err()
                .code(),
            AdmissionFailureCode::DirectMeasurementMismatch
        );

        let complete_spec = PostgresMeasurementSpec::new(
            "market_data_private",
            "market_data_private.schema_migrations_v1",
            vec![
                "market_data_private.resolve_strategy_input_sample_projection_v3(bytea)".into(),
                "market_data_private.resolve_strategy_input_sample_projection_schedule_dependencies_v3(bytea)".into(),
                "market_data_private.resolve_timeframe_projection_receipt_v1(bytea)".into(),
                "market_data_private.resolve_sample_receipt_v1(bytea)".into(),
                "market_data_private.resolve_bar_schedule_v1(bytea)".into(),
                "market_data_private.resolve_bar_schedule_history_v1(text)".into(),
            ],
            vec![
                "market_data_private.strategy_input_sample_projection_receipts_v3".into(),
                "market_data_private.strategy_input_sample_projection_schedule_dependencies_v3".into(),
                "market_data_private.timeframe_projection_receipts_v1".into(),
                "market_data_private.sample_facts_v1".into(),
                "market_data_private.sample_receipts_v1".into(),
                "market_data_private.sample_outbox_v1".into(),
                "market_data_private.bar_schedule_state_v1".into(),
                "market_data_private.bar_schedule_facts_v1".into(),
                "market_data_private.bar_schedule_heads_v1".into(),
                "market_data_private.bar_schedule_cuts_v1".into(),
                "market_data_private.bar_schedule_receipts_v1".into(),
                "market_data_private.bar_schedule_outbox_v1".into(),
            ],
        )
        .unwrap();
        let complete = Fixture::with_spec(&complete_spec);
        let measurement_calls = Arc::new(AtomicUsize::new(0));
        let custodian = complete.custodian(
            Arc::new(AtomicUsize::new(0)),
            Arc::clone(&measurement_calls),
        );
        let initial = custodian
            .admit_capability(complete.request.scope())
            .await
            .expect("complete V3 floor admitted");
        assert!(initial.measurement_spec.covers_sample_projection_floor_v3());
        let port = initial
            .into_sample_projection_snapshot_port_v3()
            .expect("complete V3 floor promotes fixed port");
        assert_eq!(measurement_calls.load(Ordering::SeqCst), 1);
        port.revalidate_sample_projection_v3_before_return()
            .await
            .expect("final V3 revalidation");
        assert_eq!(measurement_calls.load(Ordering::SeqCst), 2);

        let incomplete = PostgresMeasurementSpec::new(
            "market_data_private",
            "market_data_private.schema_migrations_v1",
            vec!["market_data_private.resolve_strategy_input_sample_projection_v3(bytea)".into()],
            vec!["market_data_private.strategy_input_sample_projection_receipts_v3".into()],
        )
        .unwrap();
        assert_eq!(
            validate_sample_projection_revalidation_v3(
                &port.scope,
                &port.receipt,
                &port.receipt,
                &incomplete,
            )
            .unwrap_err()
            .code(),
            AdmissionFailureCode::DirectMeasurementMismatch
        );
        let mut rotated = port.receipt.clone();
        rotated.rotation_fence_identity = "rotation:new".to_string();
        assert_eq!(
            validate_sample_projection_revalidation_v3(
                &port.scope,
                &port.receipt,
                &rotated,
                &complete_spec,
            )
            .unwrap_err()
            .code(),
            AdmissionFailureCode::AdmissionCutExpired
        );
    }

    #[tokio::test]
    async fn bar_schedule_capability_requires_and_preserves_exact_measurement_floor() {
        let unrelated = Fixture::new();
        let capability = unrelated
            .custodian(Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)))
            .admit_capability(unrelated.request.scope())
            .await
            .expect("unrelated admission remains valid for unrelated consumers");
        assert_eq!(
            capability
                .into_bar_schedule_snapshot_port()
                .unwrap_err()
                .code(),
            AdmissionFailureCode::DirectMeasurementMismatch
        );

        let complete = Fixture::with_spec(
            &PostgresMeasurementSpec::new(
                "market_data_private",
                "market_data_private.schema_migrations_v1",
                vec![
                    "market_data_private.resolve_bar_schedule_v1(bytea)".to_string(),
                    "market_data_private.resolve_bar_schedule_candidates_v1(text)".to_string(),
                    "market_data_private.resolve_bar_schedule_history_v1(text)".to_string(),
                ],
                vec![
                    "market_data_private.bar_schedule_state_v1".to_string(),
                    "market_data_private.bar_schedule_facts_v1".to_string(),
                    "market_data_private.bar_schedule_heads_v1".to_string(),
                    "market_data_private.bar_schedule_cuts_v1".to_string(),
                    "market_data_private.bar_schedule_receipts_v1".to_string(),
                    "market_data_private.bar_schedule_outbox_v1".to_string(),
                ],
            )
            .unwrap(),
        );
        let measurement_calls = Arc::new(AtomicUsize::new(0));
        let custodian = complete.custodian(
            Arc::new(AtomicUsize::new(0)),
            Arc::clone(&measurement_calls),
        );
        let initial = custodian
            .admit_capability(complete.request.scope())
            .await
            .expect("complete BAR floor admitted");
        assert!(initial.measurement_spec.covers_bar_schedule_floor_v1());
        let port = initial
            .into_bar_schedule_snapshot_port()
            .expect("complete floor promotes BAR port");
        assert_eq!(measurement_calls.load(Ordering::SeqCst), 1);
        port.revalidate_bar_schedule_v1_before_return()
            .await
            .expect("return performs a distinct complete BAR revalidation");
        assert_eq!(measurement_calls.load(Ordering::SeqCst), 2);

        let incomplete = PostgresMeasurementSpec::new(
            "market_data_private",
            "market_data_private.schema_migrations_v1",
            vec!["market_data_private.resolve_bar_schedule_v1(bytea)".to_string()],
            vec!["market_data_private.bar_schedule_facts_v1".to_string()],
        )
        .unwrap();
        assert_eq!(
            validate_bar_schedule_revalidation_v1(
                &port.scope,
                &port.receipt,
                &port.receipt,
                &incomplete,
            )
            .unwrap_err()
            .code(),
            AdmissionFailureCode::DirectMeasurementMismatch
        );

        let mut rotated = port.receipt.clone();
        rotated.rotation_fence_identity = "rotation:new".to_string();
        assert_eq!(
            validate_bar_schedule_revalidation_v1(
                &port.scope,
                &port.receipt,
                &rotated,
                &complete.history.manifests[1].manifest.measurement_spec,
            )
            .unwrap_err()
            .code(),
            AdmissionFailureCode::AdmissionCutExpired
        );
    }

    /// Executes the port's own BAR schedule read for the first time in this repository.
    ///
    /// Its only caller is `postgres.rs:7952`, inside a `#[cfg(not(test))]` block, so no test build
    /// contains a call to it: the method is unreachable rather than untested. This reaches it
    /// directly, from the module that owns the property, so nothing here is a consumer holding a
    /// port it did not earn.
    ///
    /// **What this does not reach**, stated because the next reader will otherwise assume more:
    ///
    /// 1. The ordering in `postgres.rs` around 7940-7963 - read, verify, revalidate, return. Those
    ///    three calls do not exist in a test build, and it is the arrangement rather than any one
    ///    of them that has never been observed.
    /// 2. The second half of this method: the `admit` and `validate` pair that runs *after* the
    ///    storage read and before the value is returned. Reaching it needs a real read, so it
    ///    belongs with a database-backed proof.
    /// 3. `verify_admitted_bar_schedule_v1`, which sits between the read and the revalidation.
    /// 4. The before-return property itself, which is **already** covered by
    ///    `bar_schedule_capability_requires_and_preserves_exact_measurement_floor` above - it
    ///    counts one measurement, calls `revalidate_bar_schedule_v1_before_return`, and counts two.
    ///    That test, not this one, is what guards the property; anyone editing it should know that.
    /// 5. `validate_bar_schedule_revalidation_v1` between the admission and the read. Deleting that
    ///    call leaves this test green, which was measured rather than assumed: reaching the read
    ///    proves only that nothing before it rejected, not that everything before it ran. Covering
    ///    it needs a fixture whose second admission disagrees with the sealed receipt, so that
    ///    skipping the check changes the outcome instead of merely removing a step.
    #[tokio::test]
    async fn the_admitted_ports_bar_schedule_read_admits_and_validates_before_it_measures() {
        let complete = Fixture::with_spec(
            &PostgresMeasurementSpec::new(
                "market_data_private",
                "market_data_private.schema_migrations_v1",
                vec![
                    "market_data_private.resolve_bar_schedule_v1(bytea)".to_string(),
                    "market_data_private.resolve_bar_schedule_candidates_v1(text)".to_string(),
                    "market_data_private.resolve_bar_schedule_history_v1(text)".to_string(),
                ],
                vec![
                    "market_data_private.bar_schedule_state_v1".to_string(),
                    "market_data_private.bar_schedule_facts_v1".to_string(),
                    "market_data_private.bar_schedule_heads_v1".to_string(),
                    "market_data_private.bar_schedule_cuts_v1".to_string(),
                    "market_data_private.bar_schedule_receipts_v1".to_string(),
                    "market_data_private.bar_schedule_outbox_v1".to_string(),
                ],
            )
            .unwrap(),
        );
        let measurement_calls = Arc::new(AtomicUsize::new(0));
        let custodian = complete.custodian(
            Arc::new(AtomicUsize::new(0)),
            Arc::clone(&measurement_calls),
        );
        let port = custodian
            .admit_capability(complete.request.scope())
            .await
            .expect("complete BAR floor admitted")
            .into_bar_schedule_snapshot_port()
            .expect("complete floor promotes BAR port");
        assert_eq!(measurement_calls.load(Ordering::SeqCst), 1);

        let outcome = port.resolve_bar_schedule_v1([7; 32]).await;

        // No store is configured here, so the read fails - and where it fails is the point: the
        // method reached the read, so it did not reject earlier. It does not follow that the
        // validation between the admission and the read ran; see boundary 5 below, which is there
        // because deleting that validation leaves this test green.
        let Err(rejected) = outcome else {
            panic!("no store is reachable from this test, so the read cannot succeed");
        };

        assert_eq!(
            rejected.code(),
            AdmissionFailureCode::DirectMeasurementUnavailable,
            "the read is what failed, so everything before it succeeded"
        );
        assert_eq!(
            measurement_calls.load(Ordering::SeqCst),
            2,
            "the method re-admits before reading rather than trusting the capability it was built \
             from; the count distinguishes that from reusing the admission"
        );
    }

    #[rstest::rstest]
    fn shared_time_floor_requires_every_fixed_function_and_relation() {
        let functions = vec![
            "market_data_private.resolve_owner_history_census_custody_v1()".to_string(),
            "market_data_private.resolve_clock_custody_state_v1()".to_string(),
            "market_data_private.resolve_clock_membership_custody_v1()".to_string(),
            "market_data_private.resolve_clock_handoff_v1(bytea)".to_string(),
            "market_data_private.resolve_epoch_successor_proof_v1(bytea)".to_string(),
        ];
        let relations = vec![
            "market_data_private.owner_migrations_v1".to_string(),
            "market_data_private.owner_history_census_state_v1".to_string(),
            "market_data_private.source_binding_lineage_census_v1".to_string(),
            "market_data_private.pit_snapshot_lineage_census_v1".to_string(),
            "market_data_private.source_binding_facts_v1".to_string(),
            "market_data_private.source_binding_heads_v1".to_string(),
            "market_data_private.pit_snapshot_facts_v1".to_string(),
            "market_data_private.pit_snapshot_heads_v1".to_string(),
            "market_data_private.clock_head_v1".to_string(),
            "market_data_private.clock_handoffs_v1".to_string(),
            "market_data_private.clock_handoff_state_v1".to_string(),
            "market_data_private.clock_handoff_membership_v1".to_string(),
            "market_data_private.clock_handoff_head_v1".to_string(),
            "market_data_private.epoch_successor_proofs_v1".to_string(),
        ];
        let complete = PostgresMeasurementSpec::new(
            "market_data_private",
            "market_data_private.schema_migrations_v1",
            functions.clone(),
            relations.clone(),
        )
        .expect("complete Shared Time measurement");
        assert!(complete.covers_shared_time_floor_v1());

        for omitted in 0..functions.len() {
            let mut incomplete = functions.clone();
            incomplete.remove(omitted);
            let spec = PostgresMeasurementSpec::new(
                "market_data_private",
                "market_data_private.schema_migrations_v1",
                incomplete,
                relations.clone(),
            )
            .expect("bounded incomplete function measurement");
            assert!(!spec.covers_shared_time_floor_v1());
        }

        for omitted in 0..relations.len() {
            let mut incomplete = relations.clone();
            incomplete.remove(omitted);
            let spec = PostgresMeasurementSpec::new(
                "market_data_private",
                "market_data_private.schema_migrations_v1",
                functions.clone(),
                incomplete,
            )
            .expect("bounded incomplete relation measurement");
            assert!(!spec.covers_shared_time_floor_v1());
        }
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
    fn ambient_postgres_configuration_detection_is_fail_closed() {
        assert!(postgres::ambient_pg_configuration_present_with(
            |name| name == "PGPORT"
        ));
        assert!(!postgres::ambient_pg_configuration_present_with(|_| false));
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

        let result = RdOwnerStoreAdmissionBootstrap::from_environment_result(
            Err(std::env::VarError::NotUnicode(OsString::from_vec(vec![
                0xff,
            ]))),
            |_| None,
        );

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

    // ---------------------------------------------------------------------------------------
    // The BAR schedule arrangement, against a real disposable PostgreSQL.
    //
    // Everything a real database can answer is real here: the schema, the migration, the seeded
    // schedule, the measurement and the storage read. Custody, signatures and the witness stay
    // fixtures, because those are exactly the authorities `B3` is missing - this proves the order
    // the Owner reads in, not that store admission is available.
    // ---------------------------------------------------------------------------------------

    /// Counts admissions while delegating to the real measurer.
    ///
    /// The count lives here rather than in the arrangement on purpose: code that reports its own
    /// execution order proves only that it contains a reporting statement.
    struct CountingPostgresMeasurer {
        calls: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl DirectMeasurer for CountingPostgresMeasurer {
        async fn measure(
            &self,
            lease: &PostgresCredentialLease,
            spec: &PostgresMeasurementSpec,
        ) -> Result<PostgresMeasurement, ()> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            PostgresDirectMeasurer::measure(&PostgresDirectMeasurer, lease, spec)
                .await
                .map_err(|_| ())
        }
    }

    /// Mints a lease for the disposable database the harness provisioned.
    struct LeasedCredentials {
        database_url: String,
    }

    #[async_trait]
    impl CredentialResolver for LeasedCredentials {
        async fn resolve(
            &self,
            handle: &CredentialHandleBinding,
        ) -> Result<PostgresCredentialLease, ()> {
            PostgresCredentialLease::from_resolved_secret(
                handle.identity.clone(),
                handle.audience.clone(),
                handle.version.clone(),
                NOW + 3_600_000,
                self.database_url.clone(),
            )
            .map_err(|_| ())
        }
    }

    fn bar_schedule_measurement_spec() -> PostgresMeasurementSpec {
        PostgresMeasurementSpec::new(
            "market_data_private",
            "market_data_private.owner_migrations_v1",
            vec![
                "market_data_private.resolve_bar_schedule_v1(bytea)".to_string(),
                "market_data_private.resolve_bar_schedule_candidates_v1(text)".to_string(),
                "market_data_private.resolve_bar_schedule_history_v1(text)".to_string(),
            ],
            vec![
                "market_data_private.bar_schedule_state_v1".to_string(),
                "market_data_private.bar_schedule_facts_v1".to_string(),
                "market_data_private.bar_schedule_heads_v1".to_string(),
                "market_data_private.bar_schedule_cuts_v1".to_string(),
                "market_data_private.bar_schedule_receipts_v1".to_string(),
                "market_data_private.bar_schedule_outbox_v1".to_string(),
            ],
        )
        .expect("BAR schedule measurement spec")
    }

    /// Drives the three-step BAR schedule arrangement against a real database, twice.
    ///
    /// The arrangement is `resolve_bar_schedule_through_admitted_port_v1`: the port's read, then
    /// verification of the evidence it returned, then the port's revalidation before the value is
    /// handed back. Each of those three has its own coverage. **The order had none**, and until it
    /// left the `cfg(not(test))` arm it could not have had any.
    ///
    /// **Both readings must be reported together; neither alone says anything.**
    ///
    /// ```text
    ///   intact row     admissions +3   Ok    2 from the port's own read, 1 from the revalidation
    ///   tampered row   admissions +2   Err   the same 2, and the revalidation never happened
    /// ```
    ///
    /// The first reading alone is also satisfied by the order read, revalidate, verify - the
    /// verification is a pure function, so moving it past the revalidation changes no count. The
    /// second reading is what pins it between them: the tampered row resolves (the query finds it,
    /// the joins hold, the counts are untouched) and fails only when its bytes are decoded, so a
    /// build that revalidated before verifying would show +3 here. **Deleting either assertion as
    /// redundant removes the whole property.**
    ///
    /// A refused PIT readback does not go on to read schedule candidates.
    ///
    /// `resolve_native_replay_initial_market_through_port_v1` reads the snapshot's
    /// evidence, verifies it, and only then asks the port for each member's schedule candidates.
    /// Nothing in the types enforces that order; swapping the two would still compile, still
    /// refuse, and still return the same error to the caller. What would change is that a store
    /// whose snapshot evidence no longer decodes would have been asked about schedules anyway.
    ///
    /// The count is kept by the measurer, not by the arrangement, and the two readings differ only
    /// in whether the schedule reads happened. The intact case is the positive control: it has no
    /// schedule seeded for either instrument, so it refuses too - but it refuses *after* reading,
    /// which is the whole point. A proof with only the refusing case would report zero schedule
    /// reads whether the order held or the counter was broken.
    #[rstest]
    #[ignore = "requires the crates/data disposable PostgreSQL harness"]
    fn a_refused_pit_readback_never_reads_schedule_candidates() {
        std::thread::Builder::new()
            .name("market-data-native-replay-order".into())
            .stack_size(16 * 1024 * 1024)
            .spawn(|| {
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap()
                    .block_on(run_native_replay_initial_market_order_scenario());
            })
            .unwrap()
            .join()
            .unwrap();
    }

    /// The BAR schedule measurement with the quote cut floor beside it: what a native Replay
    /// scheduling port is admitted on.
    fn native_replay_scheduling_measurement_spec() -> PostgresMeasurementSpec {
        PostgresMeasurementSpec::new(
            "market_data_private",
            "market_data_private.owner_migrations_v1",
            vec![
                "market_data_private.resolve_bar_schedule_v1(bytea)".to_string(),
                "market_data_private.resolve_bar_schedule_candidates_v1(text)".to_string(),
                "market_data_private.resolve_bar_schedule_history_v1(text)".to_string(),
                "market_data_private.resolve_native_replay_quote_cut_census_v2(bytea,bigint,bigint)"
                    .to_string(),
                "market_data_private.resolve_native_replay_next_frame_v2(bytea,bigint,bigint)"
                    .to_string(),
            ],
            vec![
                "market_data_private.bar_schedule_state_v1".to_string(),
                "market_data_private.bar_schedule_facts_v1".to_string(),
                "market_data_private.bar_schedule_heads_v1".to_string(),
                "market_data_private.bar_schedule_cuts_v1".to_string(),
                "market_data_private.bar_schedule_receipts_v1".to_string(),
                "market_data_private.bar_schedule_outbox_v1".to_string(),
                "market_data_private.native_replay_quote_cut_census_v2".to_string(),
                "market_data_private.native_replay_frame_census_v2".to_string(),
            ],
        )
        .expect("native Replay scheduling measurement spec")
    }

    /// Admits `spec` against the disposable database through a real measurement.
    async fn admitted_capability_for(
        owner_url: &str,
        spec: &PostgresMeasurementSpec,
    ) -> AdmittedMarketDataPostgresCapability {
        let lease = PostgresCredentialLease::from_resolved_secret(
            "native-replay-quote-cut-handle",
            "market-data-owner",
            "v1",
            NOW + 3_600_000,
            owner_url.to_owned(),
        )
        .expect("lease for the disposable database");
        let measured = PostgresDirectMeasurer::measure(&PostgresDirectMeasurer, &lease, spec)
            .await
            .expect("the real measurer reads the disposable database");
        let fixture = Fixture::with_spec_and_measurement(spec, measured);
        Custodian::new(
            Arc::new(fixture.custody()),
            Arc::new(Ed25519Verifier {
                key: fixture.signing_key.verifying_key(),
                calls: Arc::new(AtomicUsize::new(0)),
            }),
            Arc::new(FakeWitness {
                observation: fixture.witness.clone(),
            }),
            Arc::new(LeasedCredentials {
                database_url: owner_url.to_owned(),
            }),
            Arc::new(CountingPostgresMeasurer {
                calls: Arc::new(AtomicUsize::new(0)),
            }),
            Arc::new(FixedClock),
        )
        .admit_capability(fixture.request.scope())
        .await
        .expect("the disposable database satisfies the recorded manifest")
    }

    /// A frame's quote cut, read through an admitted port, is the one custody resolves.
    ///
    /// The port reads the frame census's bound and the quote cut census through the Owner's two
    /// census functions under a measured lease, decodes the rows it returns, and reads the chosen
    /// cut back through its PIT evaluation. Custody's own read takes the same census through a
    /// pool. The two are separate code over the same rules, so this asks them the same questions
    /// and requires the same answers - including the refusal when the window ends on the quote
    /// cut's instant. A measurement without the quote cut floor never becomes a scheduling port.
    #[rstest]
    #[ignore = "requires the crates/data disposable PostgreSQL harness"]
    fn the_admitted_quote_cut_read_resolves_what_custody_resolves() {
        std::thread::Builder::new()
            .name("market-data-native-replay-quote-cut".into())
            .stack_size(16 * 1024 * 1024)
            .spawn(|| {
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap()
                    .block_on(run_native_replay_quote_cut_admitted_scenario());
            })
            .unwrap()
            .join()
            .unwrap();
    }

    async fn run_native_replay_quote_cut_admitted_scenario() {
        use crate::owner::native_replay_quote_cut_v2::{
            NativeReplayCutKindV2, NativeReplayQuoteCutRefusalV2, classify_native_replay_cut_v2,
        };

        let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
            .expect("explicit disposable Owner URL");
        let database =
            std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").expect("disposable database name");
        assert!(
            database.starts_with("vibe_test_"),
            "this proof writes; it runs only against a disposable database"
        );
        let owner = crate::owner::postgres::MarketDataOwnerPostgres::connect(&owner_url)
            .await
            .expect("Owner connects and migrates");
        let snapshot =
            crate::owner::postgres::tests::native_replay_two_member_snapshot_fixture_v1(&owner)
                .await;

        assert!(
            admitted_capability_for(&owner_url, &bar_schedule_measurement_spec())
                .await
                .into_native_replay_scheduling_snapshot_port_v2()
                .is_err(),
            "a measurement without the quote cut floor is not a scheduling port"
        );
        let port =
            admitted_capability_for(&owner_url, &native_replay_scheduling_measurement_spec())
                .await
                .into_native_replay_scheduling_snapshot_port_v2()
                .expect("the measurement carries both floors");

        let evidence = port
            .resolve_pit_evaluation(*snapshot.snapshot_identity.as_bytes())
            .await
            .expect("the frame's evidence");
        let frame = crate::owner::postgres::verify_admitted_pit_evidence_by_identity_v1(
            snapshot.snapshot_identity,
            snapshot.snapshot_fact_digest,
            &evidence,
        )
        .expect("the frame verifies");
        let window_end = snapshot.frame_time_ns + 1_000;

        let through_port = crate::owner::postgres::resolve_native_replay_quote_cut_through_port_v2(
            &port, &frame, window_end,
        )
        .await
        .expect("the port resolves the frame's quote cut");
        assert_eq!(
            through_port.snapshot_identity(),
            snapshot.quote_cut_snapshot_identity
        );
        assert_eq!(
            classify_native_replay_cut_v2(through_port.observations()),
            NativeReplayCutKindV2::QuoteCut
        );
        assert_eq!(
            through_port.time_evidence().event_effective.value,
            snapshot.quote_cut_instant_ns
        );
        let through_custody = owner
            .resolve_native_replay_quote_cut_v2(&frame, window_end)
            .await
            .expect("custody resolves the frame's quote cut");
        assert_eq!(
            through_custody.snapshot_identity(),
            through_port.snapshot_identity(),
            "the port and custody resolve the same quote cut"
        );

        // A window that ends on the quote cut's instant leaves the frame without one, both ways.
        assert_eq!(
            crate::owner::postgres::resolve_native_replay_quote_cut_through_port_v2(
                &port,
                &frame,
                snapshot.quote_cut_instant_ns,
            )
            .await
            .map(|batch| batch.snapshot_identity()),
            Err(NativeReplayQuoteCutRefusalV2::QuoteCutMissing)
        );
        assert_eq!(
            owner
                .resolve_native_replay_quote_cut_v2(&frame, snapshot.quote_cut_instant_ns)
                .await
                .map(|batch| batch.snapshot_identity()),
            Err(NativeReplayQuoteCutRefusalV2::QuoteCutMissing)
        );
    }

    /// Which of the three scheduling reads a grant serves.
    #[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
    enum SchedulingReadV1 {
        PitEvaluation,
        BarScheduleCandidates,
        QuoteCutCensus,
    }

    /// The reads a grant exists for, stated before any run so the proof can disagree with it.
    fn reads_needing(grant: AcceptanceGrantV1) -> std::collections::BTreeSet<SchedulingReadV1> {
        use SchedulingReadV1::{BarScheduleCandidates, PitEvaluation, QuoteCutCensus};

        match grant {
            AcceptanceGrantV1::SchemaUsage(_) => {
                [PitEvaluation, BarScheduleCandidates, QuoteCutCensus].into()
            }
            AcceptanceGrantV1::TableSelect(_) => [PitEvaluation].into(),
            AcceptanceGrantV1::FunctionExecute(function) if function.contains("bar_schedule") => {
                [BarScheduleCandidates].into()
            }
            AcceptanceGrantV1::FunctionExecute(function) if function.contains("native_replay") => {
                [QuoteCutCensus].into()
            }
            AcceptanceGrantV1::FunctionExecute(_) => [PitEvaluation].into(),
        }
    }

    /// Runs each scheduling read once through `port` and names the ones that were refused.
    async fn refused_reads(
        port: &UnadmittedAcceptanceSnapshotPortV1,
        snapshot: &crate::owner::postgres::tests::NativeReplayTwoMemberSnapshotFixtureV1,
    ) -> std::collections::BTreeSet<SchedulingReadV1> {
        let mut refused = std::collections::BTreeSet::new();

        if port
            .resolve_pit_evaluation(*snapshot.snapshot_identity.as_bytes())
            .await
            .is_err()
        {
            refused.insert(SchedulingReadV1::PitEvaluation);
        }

        if port
            .resolve_bar_schedule_candidates_v1("AAPL.XNAS")
            .await
            .is_err()
        {
            refused.insert(SchedulingReadV1::BarScheduleCandidates);
        }

        if port
            .resolve_native_replay_quote_cut_census_v2(
                *snapshot.snapshot_identity.as_bytes(),
                snapshot.frame_time_ns,
                snapshot.frame_time_ns + 1_000,
                snapshot.frame_time_ns + 1_000,
            )
            .await
            .is_err()
        {
            refused.insert(SchedulingReadV1::QuoteCutCensus);
        }
        refused
    }

    /// The sealed acceptance resolver reads under exactly the grants it declares, as a
    /// least-privilege principal, through the read path the admitted resolver uses.
    ///
    /// It connects as the disposable harness's reader role, which starts with no `USAGE` on
    /// `market_data_private`. With nothing granted, every read is refused. With exactly
    /// `NATIVE_REPLAY_SCHEDULING_ACCEPTANCE_GRANTS_V1`, every read is answered: the snapshot's
    /// evidence verifies, a member's schedule candidates are read, and the quote cut read through
    /// the port is the one custody resolves. Each grant revoked alone refuses exactly the reads
    /// stated for it in `reads_needing`, and nothing else, so the list is neither short nor padded.
    #[rstest]
    #[ignore = "requires the crates/data disposable PostgreSQL harness"]
    fn the_sealed_acceptance_resolver_reads_under_exactly_its_grants() {
        std::thread::Builder::new()
            .name("market-data-sealed-acceptance-grants".into())
            .stack_size(16 * 1024 * 1024)
            .spawn(|| {
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap()
                    .block_on(run_sealed_acceptance_grants_scenario());
            })
            .unwrap()
            .join()
            .unwrap();
    }

    async fn run_sealed_acceptance_grants_scenario() {
        use crate::owner::native_replay_scheduling_v1::{
            NativeReplaySchedulingErrorV1, NativeReplaySchedulingResolverV1,
        };

        const READER: &str = "vibe_test_role_market_data_reader";
        let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
            .expect("explicit disposable Owner URL");
        let reader_url = std::env::var("MARKET_DATA_READER_TEST_DATABASE_URL")
            .expect("explicit disposable reader URL");
        let database =
            std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").expect("disposable database name");
        assert!(
            database.starts_with("vibe_test_"),
            "this proof grants and revokes; it runs only against a disposable database"
        );
        assert!(
            reader_url.contains(READER),
            "the proof's principal is the harness reader"
        );
        let owner = crate::owner::postgres::MarketDataOwnerPostgres::connect(&owner_url)
            .await
            .expect("Owner connects and migrates");
        let snapshot =
            crate::owner::postgres::tests::native_replay_two_member_snapshot_fixture_v1(&owner)
                .await;
        let request = native_replay_request_for(&snapshot);
        let resolver = crate::owner::postgres::SealedAcceptanceNativeReplaySchedulingResolverV1 {
            port: UnadmittedAcceptanceSnapshotPortV1::from_database_url(&reader_url)
                .expect("a reader URL makes a port"),
        };

        // Nothing granted: the least-privilege principal reads nothing at all.
        assert_eq!(
            refused_reads(&resolver.port, &snapshot).await.len(),
            3,
            "an ungranted principal is refused every read"
        );

        apply_native_replay_scheduling_acceptance_grants_v1(owner.pool(), READER, |grant, role| {
            grant.grant_to(role)
        })
        .await
        .expect("the owner grants the acceptance reads");

        // Exactly the grants: every read is answered.
        assert!(refused_reads(&resolver.port, &snapshot).await.is_empty());

        // The resolver composes the same read path. It cannot tell this proof which case it is in:
        // the fixture seeds no schedule, and selection names a member with no candidate exactly as
        // it names a refused read. The discriminating measurements are the reads above and below;
        // the path with schedules is the ordered chain's, where the Replay fixtures seed them.
        assert_eq!(
            resolver
                .resolve_native_replay_initial_market_inputs_v1(&request)
                .await
                .map(|_| ()),
            Err(NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)
        );

        let evidence = resolver
            .port
            .resolve_pit_evaluation(*snapshot.snapshot_identity.as_bytes())
            .await
            .expect("the frame's evidence");
        let frame = crate::owner::postgres::verify_admitted_pit_evidence_by_identity_v1(
            snapshot.snapshot_identity,
            snapshot.snapshot_fact_digest,
            &evidence,
        )
        .expect("the frame verifies");
        let window_end = snapshot.frame_time_ns + 1_000;
        let through_port = crate::owner::postgres::resolve_native_replay_quote_cut_through_port_v2(
            &resolver.port,
            &frame,
            window_end,
        )
        .await
        .expect("the acceptance port resolves the frame's quote cut");
        assert_eq!(
            through_port.snapshot_identity(),
            snapshot.quote_cut_snapshot_identity
        );
        assert_eq!(
            owner
                .resolve_native_replay_quote_cut_v2(&frame, window_end)
                .await
                .expect("custody resolves the frame's quote cut")
                .snapshot_identity(),
            through_port.snapshot_identity(),
            "the acceptance port and custody resolve the same quote cut"
        );

        // Every grant is needed, and for exactly the reads stated for it.
        let quoted: String = sqlx::query_scalar("SELECT pg_catalog.quote_ident($1)")
            .bind(READER)
            .fetch_one(owner.pool())
            .await
            .unwrap();

        for grant in NATIVE_REPLAY_SCHEDULING_ACCEPTANCE_GRANTS_V1 {
            sqlx::query(sqlx::AssertSqlSafe(grant.revoke_from(&quoted)))
                .execute(owner.pool())
                .await
                .unwrap();
            assert_eq!(
                refused_reads(&resolver.port, &snapshot).await,
                reads_needing(*grant),
                "{grant:?} revoked alone"
            );
            sqlx::query(sqlx::AssertSqlSafe(grant.grant_to(&quoted)))
                .execute(owner.pool())
                .await
                .unwrap();
        }
        assert!(
            refused_reads(&resolver.port, &snapshot).await.is_empty(),
            "every grant restored"
        );
    }

    /// A request that names one committed snapshot and nothing more.
    ///
    /// The role list and window exist because the constructor takes them, not because this proof
    /// depends on them: everything it measures happens at or before the evidence check, which runs
    /// before any of these fields is consulted. A request that could resolve a frame would need a
    /// universe selection the Owner derived, and deriving one is the supply this proof does not
    /// have and does not need.
    fn native_replay_request_for(
        snapshot: &crate::owner::postgres::tests::NativeReplayTwoMemberSnapshotFixtureV1,
    ) -> crate::owner::native_replay_scheduling_v1::NativeReplayInitialMarketRequestV1 {
        use crate::owner::native_replay_scheduling_v1::{
            NativeReplayInitialMarketRequestV1, NativeReplayInitialUniverseRoleV1,
        };
        use crate::owner::source_binding::BindingDigest;
        use crate::owner::strategy_input_binding::{
            MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
        };
        let role = NativeReplayInitialUniverseRoleV1::new(
            BindingDigest::from_untrusted_bytes([90; 32]),
            MarketDataFieldSemantic::BarClosePrice,
            StrategyInputChannel::Market,
            "1M".to_owned(),
            StrategyInputUnit::Price,
            2,
        );
        NativeReplayInitialMarketRequestV1::new(
            snapshot.snapshot_identity,
            snapshot.snapshot_fact_digest,
            BindingDigest::from_untrusted_bytes([91; 32]),
            BindingDigest::from_untrusted_bytes([92; 32]),
            BindingDigest::from_untrusted_bytes([93; 32]),
            snapshot.universe_selection_digest,
            snapshot.instrument_master_digest,
            snapshot.source_binding_lineage_root,
            snapshot.market_semantics_identity,
            vec![role],
            vec!["AAPL.XNAS".into(), "MSFT.XNAS".into()],
            snapshot.frame_time_ns,
            snapshot.frame_time_ns + 1_000,
        )
    }

    async fn run_native_replay_initial_market_order_scenario() {
        let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
            .expect("explicit disposable Owner URL");
        let database =
            std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").expect("disposable database name");
        assert!(
            database.starts_with("vibe_test_"),
            "this proof writes and tampers; it runs only against a disposable database"
        );

        for name in [
            "PGHOST",
            "PGPORT",
            "PGUSER",
            "PGPASSWORD",
            "PGDATABASE",
            "PGSERVICE",
            "PGSSLMODE",
        ] {
            assert!(
                std::env::var(name).is_err(),
                "{name} is set: the port's read fails closed on ambient configuration, and that \
                 failure cannot be told apart from the ones this proof is looking for"
            );
        }

        let owner = crate::owner::postgres::MarketDataOwnerPostgres::connect(&owner_url)
            .await
            .expect("Owner connects and migrates");
        let snapshot =
            crate::owner::postgres::tests::native_replay_two_member_snapshot_fixture_v1(&owner)
                .await;

        let spec = bar_schedule_measurement_spec();
        let lease = PostgresCredentialLease::from_resolved_secret(
            "native-replay-order-handle",
            "market-data-owner",
            "v1",
            NOW + 3_600_000,
            owner_url.clone(),
        )
        .expect("lease for the disposable database");
        let measured = PostgresDirectMeasurer::measure(&PostgresDirectMeasurer, &lease, &spec)
            .await
            .expect("the real measurer reads the disposable database");
        let fixture = Fixture::with_spec_and_measurement(&spec, measured);
        let calls = Arc::new(AtomicUsize::new(0));
        let custodian = Custodian::new(
            Arc::new(fixture.custody()),
            Arc::new(Ed25519Verifier {
                key: fixture.signing_key.verifying_key(),
                calls: Arc::new(AtomicUsize::new(0)),
            }),
            Arc::new(FakeWitness {
                observation: fixture.witness.clone(),
            }),
            Arc::new(LeasedCredentials {
                database_url: owner_url.clone(),
            }),
            Arc::new(CountingPostgresMeasurer {
                calls: Arc::clone(&calls),
            }),
            Arc::new(FixedClock),
        );
        let port = custodian
            .admit_capability(fixture.request.scope())
            .await
            .expect("the disposable database satisfies the recorded manifest")
            .into_bar_schedule_snapshot_port()
            .expect("the admitted capability carries the snapshot port");

        // What each of the two reads costs, measured directly rather than assumed, because the
        // assertions below are absolute rather than relative. The first version of this proof
        // compared the two cases by their difference, and a mutation that read schedules before
        // verifying anything passed it: premature reads land on both sides and cancel. A quantity
        // that moves with the defect in only one of the two cases is not a discriminator.
        let before = calls.load(Ordering::SeqCst);
        port.resolve_bar_schedule_candidates_v1("AAPL.XNAS")
            .await
            .expect("the port answers a schedule query against the disposable database");
        let per_schedule_read = calls.load(Ordering::SeqCst) - before;
        assert!(
            per_schedule_read > 0,
            "a schedule read must move the counter, or the readings below mean nothing"
        );
        let before = calls.load(Ordering::SeqCst);
        port.resolve_pit_evaluation(*snapshot.snapshot_identity.as_bytes())
            .await
            .expect("the port answers an evidence query against the disposable database");
        let per_evidence_read = calls.load(Ordering::SeqCst) - before;
        assert!(
            per_evidence_read > 0,
            "an evidence read must move the counter, or the readings below mean nothing"
        );

        let request = native_replay_request_for(&snapshot);

        // Reading one: the snapshot is intact, so the evidence verifies and the arrangement goes on
        // to ask about schedules. No schedule is seeded for either instrument, so it still refuses -
        // after the reads, which is what makes this the control rather than the result.
        let before = calls.load(Ordering::SeqCst);
        let refused = crate::owner::postgres::resolve_native_replay_initial_market_through_port_v1(
            &port, &request,
        )
        .await
        .expect_err("no schedule is seeded for either member");
        let intact_reads = calls.load(Ordering::SeqCst) - before;
        // One schedule read rather than two, measured: the loop refuses at the first instrument
        // whose candidates cannot be selected, so the second is never asked. The arithmetic first
        // written here assumed both and the run corrected it.
        assert_eq!(
            intact_reads,
            per_evidence_read + per_schedule_read,
            "the intact snapshot verified, read one instrument's candidates and stopped there; \
             refusal {refused:?}"
        );

        // Reading two: the same snapshot, with stored bytes that no longer decode to their digest.
        // Every join key and every count is untouched, so the read still finds the row and only the
        // verification can reject.
        sqlx::query(
            "UPDATE market_data_private.pit_observation_batches_v1 SET batch_bytes = batch_bytes \
             || '\\x00'::bytea",
        )
        .execute(owner.pool())
        .await
        .expect("tamper the stored batch bytes");

        let before = calls.load(Ordering::SeqCst);
        let rejected =
            crate::owner::postgres::resolve_native_replay_initial_market_through_port_v1(
                &port, &request,
            )
            .await
            .expect_err("evidence that does not decode to its digest must not be returned");
        let tampered_reads = calls.load(Ordering::SeqCst) - before;
        assert!(
            matches!(
                rejected,
                crate::owner::native_replay_scheduling_v1::NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable
            ),
            "the refusal names the readback, not the binding: {rejected:?}"
        );
        assert_eq!(
            tampered_reads, per_evidence_read,
            "the tampered snapshot cost the evidence read and nothing else. Anything larger means \
             a schedule was read for a snapshot that had already failed to verify, which is the \
             order this proof exists to hold."
        );
    }

    /// The two admissions inside the port's own read are not a mistake in the count. The port
    /// brackets its storage read with an admission on each side, which was measured here rather
    /// than assumed - the first version of this proof expected +2 and +1 and was corrected by the
    /// run. The revalidation the arrangement performs is a third, and it is the only one the two
    /// readings differ by.
    ///
    /// The count is kept by the measurer, not by the arrangement. Code that records its own
    /// execution order proves only that it contains a recording statement.
    ///
    /// Custody, signatures and the witness are fixtures. That is the honest boundary: they are the
    /// authorities `B3` does not have, and this proof does not claim to supply them. What is real
    /// is everything a database can answer - schema, migration, seeded schedule, measurement, and
    /// the storage read the port performs.
    #[rstest]
    #[ignore = "requires the crates/data disposable PostgreSQL harness"]
    fn the_admitted_bar_schedule_order_verifies_before_it_revalidates() {
        std::thread::Builder::new()
            .name("market-data-bar-schedule-order".into())
            .stack_size(16 * 1024 * 1024)
            .spawn(|| {
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap()
                    .block_on(run_bar_schedule_order_scenario());
            })
            .unwrap()
            .join()
            .unwrap();
    }

    async fn run_bar_schedule_order_scenario() {
        let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
            .expect("explicit disposable Owner URL");
        let database =
            std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").expect("disposable database name");
        assert!(
            database.starts_with("vibe_test_"),
            "this proof writes and tampers; it runs only against a disposable database"
        );

        // The port's storage read refuses outright when ambient PostgreSQL configuration is
        // present, and that refusal is reported as a store failure - the same shape as a missing
        // row or a broken order. Asserting it here keeps a machine's stray `PG*` from being read
        // as a finding about the arrangement.
        for name in [
            "PGHOST",
            "PGPORT",
            "PGUSER",
            "PGPASSWORD",
            "PGDATABASE",
            "PGSERVICE",
            "PGSSLMODE",
        ] {
            assert!(
                std::env::var(name).is_err(),
                "{name} is set: the port's read fails closed on ambient configuration, and that \
                 failure cannot be told apart from the ones this proof is looking for"
            );
        }

        let owner = crate::owner::postgres::MarketDataOwnerPostgres::connect(&owner_url)
            .await
            .expect("Owner connects and migrates");
        let seed = crate::owner::sample_fact::tests::bar_postgres_schedule_fixture_v1();
        let prepared = crate::owner::bar_schedule::prepare_bar_schedule_commit_v1(
            seed.schedule_proposal.clone(),
            &seed.binding,
            &seed.batch,
            &seed.instrument_master,
            &seed.instrument_master,
        )
        .expect("prepared BAR schedule");
        let committed = owner
            .commit_prepared_bar_schedule_v1(&prepared)
            .await
            .expect("Owner commits the seed schedule");
        let locator = crate::owner::bar_schedule::UntrustedBarScheduleLocatorV1 {
            digest: committed.digest(),
        };

        let spec = bar_schedule_measurement_spec();
        let lease = PostgresCredentialLease::from_resolved_secret(
            "bar-schedule-order-handle",
            "market-data-owner",
            "v1",
            NOW + 3_600_000,
            owner_url.clone(),
        )
        .expect("lease for the disposable database");

        // Measure once directly, so the manifests can record what the real measurer will return.
        // Admission compares the two, so a synthetic measurement would reject before the
        // arrangement was ever reached - and that rejection looks like a broken order.
        let measured = PostgresDirectMeasurer::measure(&PostgresDirectMeasurer, &lease, &spec)
            .await
            .expect("the real measurer reads the disposable database");

        let fixture = Fixture::with_spec_and_measurement(&spec, measured);
        let calls = Arc::new(AtomicUsize::new(0));
        let custodian = Custodian::new(
            Arc::new(fixture.custody()),
            Arc::new(Ed25519Verifier {
                key: fixture.signing_key.verifying_key(),
                calls: Arc::new(AtomicUsize::new(0)),
            }),
            Arc::new(FakeWitness {
                observation: fixture.witness.clone(),
            }),
            Arc::new(LeasedCredentials {
                database_url: owner_url.clone(),
            }),
            Arc::new(CountingPostgresMeasurer {
                calls: Arc::clone(&calls),
            }),
            Arc::new(FixedClock),
        );
        let port = custodian
            .admit_capability(fixture.request.scope())
            .await
            .expect("the disposable database satisfies the recorded manifest")
            .into_bar_schedule_snapshot_port()
            .expect("the admitted capability carries the BAR schedule port");
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "obtaining the port measures once"
        );

        // Reading one: the intact row.
        let before = calls.load(Ordering::SeqCst);
        let readback =
            crate::owner::postgres::resolve_bar_schedule_through_admitted_port_v1(&port, &locator)
                .await
                .expect("the intact schedule is read, verified and revalidated");
        assert_eq!(readback.digest(), committed.digest());
        assert_eq!(
            calls.load(Ordering::SeqCst) - before,
            3,
            "the port's read admits on each side of the storage read, and the arrangement's \
             revalidation admits once more; two would mean the revalidation never ran"
        );

        // Reading two: the same row, with bytes that no longer decode to their digest. The query
        // still finds it - every join key and every count is untouched - so the read succeeds and
        // only the verification can reject.
        sqlx::query(
            "UPDATE market_data_private.bar_schedule_facts_v1 SET fact_bytes = fact_bytes || \
             '\\x00'::bytea",
        )
        .execute(owner.pool())
        .await
        .expect("tamper the stored fact bytes");

        let before = calls.load(Ordering::SeqCst);
        let rejected =
            crate::owner::postgres::resolve_bar_schedule_through_admitted_port_v1(&port, &locator)
                .await
                .expect_err("evidence that does not decode to its digest must not be returned");
        assert!(matches!(
            rejected,
            crate::owner::bar_schedule::BarScheduleError::StoreUnavailable
        ));
        assert_eq!(
            calls.load(Ordering::SeqCst) - before,
            2,
            "the port's read still bracketed the storage read, the verification then rejected, and \
             the revalidation did not run; three would mean the revalidation happens before the \
             evidence is checked"
        );
    }
}
