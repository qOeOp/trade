//! Authenticity boundary for one bounded, read-only Databento PIT probe.
//!
//! The positive path is reachable only through [`crate::historical::DatabentoHistoricalClient`]
//! and its SDK-backed typed port. Provider calls return their authentic SDK types:
//! `DatasetRange`, `f64`, and decoded DBN streams that are canonically re-encoded.
//! Caller-authored JSON or response bytes have no constructor path into a receipt or evidence.
//!
//! Receipt fields cannot be supplied by downstream code:
//!
//! ```compile_fail
//! use vibe_databento::pit_probe::PitProbeAttemptReceipt;
//!
//! let _forged = PitProbeAttemptReceipt {};
//! ```
//!
//! This adapter evidence is not a Market Data Source Binding, rights decision, correction
//! frontier, PIT Snapshot, or `AVAILABLE` disposition.

use std::{
    io::Cursor,
    num::NonZeroU64,
    sync::atomic::{AtomicU64, Ordering},
};

use async_trait::async_trait;
use databento::{
    dbn::{
        self,
        decode::{DbnMetadata, DecodeRecord},
        encode::{DbnEncoder, EncodeRecordRef},
    },
    historical::{
        metadata::{DatasetRange, GetCostParams},
        timeseries::GetRangeParams,
    },
};
use sha2::{Digest, Sha256};
use vibe_core::{UnixNanos, consts::VIBE_USER_AGENT};

use super::{DatabentoHistoricalClient, PitProbeTransport};
use crate::common::get_date_time_range;

/// The sole dataset admitted by this bounded probe.
pub const PIT_PROBE_DATASET: &str = "EQUS.MINI";
/// The sole canonical instrument admitted by this bounded probe.
pub const PIT_PROBE_INSTRUMENT: &str = "AAPL.EQUS";
/// The Databento raw symbol for [`PIT_PROBE_INSTRUMENT`].
pub const PIT_PROBE_SYMBOL: &str = "AAPL";
/// Maximum half-open probe interval: one UTC day.
pub const PIT_PROBE_MAX_WINDOW_NS: u64 = 86_400_000_000_000;
/// Maximum records accepted from either DBN response.
pub const PIT_PROBE_MAX_RECORDS_PER_RESPONSE: u64 = 10_000;
/// Maximum canonical bytes across the two DBN artifacts.
pub const PIT_PROBE_MAX_ARTIFACT_BYTES: usize = 16 * 1024 * 1024;
/// Exact typed provider request count on a successful attempt.
pub const PIT_PROBE_REQUEST_COUNT: usize = 5;

const PIT_PROBE_CANONICAL_ENDPOINT: &str = "https://hist.databento.com";
const PIT_PROBE_TRANSPORT_POLICY: &str = "direct:no-proxy:no-redirect";
const PIT_PROBE_DBN_UPGRADE_POLICY: &str = "dbn-version-upgrade:as-is";
const SOURCE_BINDING_LOCATOR_PLACEHOLDER: &str = "market-data-source-binding:NOT_ADMITTED";
static ATTEMPT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProbeStep {
    DatasetRange,
    BboCost,
    Bbo,
    DefinitionCost,
    Definition,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct BoundedPitProbePlan {
    dataset: &'static str,
    instrument: &'static str,
    symbol: &'static str,
    schema: dbn::Schema,
    stype_in: dbn::SType,
    stype_out: dbn::SType,
    start: u64,
    end: u64,
    request_correlation: [u8; 32],
    endpoint_locator: String,
    transport_policy_locator: &'static str,
    dbn_upgrade_policy_locator: &'static str,
    configuration_locator: [u8; 32],
    source_binding_locator_placeholder: &'static str,
    max_records_per_response: u64,
    max_artifact_bytes: usize,
    steps: [ProbeStep; PIT_PROBE_REQUEST_COUNT],
}

impl BoundedPitProbePlan {
    fn new(
        endpoint_locator: &str,
        start: u64,
        end: u64,
        request_correlation: [u8; 32],
    ) -> anyhow::Result<Self> {
        anyhow::ensure!(start < end, "PIT probe range must be [start, end)");
        anyhow::ensure!(
            end - start <= PIT_PROBE_MAX_WINDOW_NS,
            "PIT probe range exceeds the fixed one-day maximum"
        );
        anyhow::ensure!(
            request_correlation != [0; 32],
            "PIT probe request correlation must be non-zero"
        );
        anyhow::ensure!(
            endpoint_locator == PIT_PROBE_CANONICAL_ENDPOINT,
            "PIT probe requires the canonical Databento Historical API endpoint"
        );
        let configuration_locator = digest_parts(
            b"databento-pit-probe-configuration/v1",
            &[
                endpoint_locator.as_bytes(),
                PIT_PROBE_TRANSPORT_POLICY.as_bytes(),
                PIT_PROBE_DBN_UPGRADE_POLICY.as_bytes(),
                PIT_PROBE_DATASET.as_bytes(),
                PIT_PROBE_SYMBOL.as_bytes(),
                dbn::Schema::Bbo1S.as_str().as_bytes(),
            ],
        );
        Ok(Self {
            dataset: PIT_PROBE_DATASET,
            instrument: PIT_PROBE_INSTRUMENT,
            symbol: PIT_PROBE_SYMBOL,
            schema: dbn::Schema::Bbo1S,
            stype_in: dbn::SType::RawSymbol,
            stype_out: dbn::SType::InstrumentId,
            start,
            end,
            request_correlation,
            endpoint_locator: endpoint_locator.to_string(),
            transport_policy_locator: PIT_PROBE_TRANSPORT_POLICY,
            dbn_upgrade_policy_locator: PIT_PROBE_DBN_UPGRADE_POLICY,
            configuration_locator,
            source_binding_locator_placeholder: SOURCE_BINDING_LOCATOR_PLACEHOLDER,
            max_records_per_response: PIT_PROBE_MAX_RECORDS_PER_RESPONSE,
            max_artifact_bytes: PIT_PROBE_MAX_ARTIFACT_BYTES,
            steps: [
                ProbeStep::DatasetRange,
                ProbeStep::BboCost,
                ProbeStep::Bbo,
                ProbeStep::DefinitionCost,
                ProbeStep::Definition,
            ],
        })
    }

    fn cost_params(&self, schema: dbn::Schema) -> anyhow::Result<GetCostParams> {
        Ok(GetCostParams::builder()
            .dataset(self.dataset)
            .symbols(vec![self.symbol])
            .stype_in(self.stype_in)
            .schema(schema)
            .date_time_range(self.date_time_range()?)
            .maybe_limit(NonZeroU64::new(self.max_records_per_response))
            .build())
    }

    fn range_params(&self, schema: dbn::Schema) -> anyhow::Result<GetRangeParams> {
        Ok(GetRangeParams::builder()
            .dataset(self.dataset)
            .symbols(vec![self.symbol])
            .stype_in(self.stype_in)
            .stype_out(self.stype_out)
            .schema(schema)
            .date_time_range(self.date_time_range()?)
            .maybe_limit(NonZeroU64::new(self.max_records_per_response))
            .build())
    }

    fn date_time_range(&self) -> anyhow::Result<databento::historical::DateTimeRange> {
        get_date_time_range(UnixNanos::from(self.start), UnixNanos::from(self.end))
    }

    fn digest(&self) -> [u8; 32] {
        digest_parts(
            b"databento-pit-probe-plan/v1",
            &[
                self.dataset.as_bytes(),
                self.instrument.as_bytes(),
                self.symbol.as_bytes(),
                self.schema.as_str().as_bytes(),
                self.stype_in.as_str().as_bytes(),
                self.stype_out.as_str().as_bytes(),
                &self.start.to_be_bytes(),
                &self.end.to_be_bytes(),
                &self.request_correlation,
                self.endpoint_locator.as_bytes(),
                self.transport_policy_locator.as_bytes(),
                self.dbn_upgrade_policy_locator.as_bytes(),
                &self.configuration_locator,
                self.source_binding_locator_placeholder.as_bytes(),
                &self.max_records_per_response.to_be_bytes(),
                &u64::try_from(self.max_artifact_bytes)
                    .expect("fixed byte budget fits u64")
                    .to_be_bytes(),
                &u64::try_from(self.steps.len())
                    .expect("fixed request count fits u64")
                    .to_be_bytes(),
            ],
        )
    }
}

/// Exact authentic SDK response kinds bound by the private receipt.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PitProbeResponseKind {
    /// `MetadataClient::get_dataset_range` returned `DatasetRange`.
    DatasetRange,
    /// `MetadataClient::get_cost` returned `f64` for the BBO request.
    BboCostF64,
    /// `TimeseriesClient::get_range` returned BBO DBN records.
    BboDbn,
    /// `MetadataClient::get_cost` returned `f64` for the Definition request.
    DefinitionCostF64,
    /// `TimeseriesClient::get_range` returned Definition DBN records.
    DefinitionDbn,
}

/// One typed response-kind/digest binding.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PitProbeResponseBinding {
    kind: PitProbeResponseKind,
    digest: [u8; 32],
}

impl PitProbeResponseBinding {
    /// Returns the authentic SDK response kind.
    #[must_use]
    pub const fn kind(&self) -> PitProbeResponseKind {
        self.kind
    }

    /// Returns the canonical SHA-256 digest.
    #[must_use]
    pub const fn digest(&self) -> &[u8; 32] {
        &self.digest
    }
}

/// Immutable receipt produced only inside the typed provider-call boundary.
///
/// Fields are private, there is no public constructor, and this type deliberately
/// implements neither `Deserialize` nor a caller-data conversion.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PitProbeAttemptReceipt {
    plan_digest: [u8; 32],
    dataset: String,
    instrument: String,
    symbol: String,
    schema: dbn::Schema,
    stype_in: dbn::SType,
    stype_out: dbn::SType,
    start: u64,
    end: u64,
    request_correlation: [u8; 32],
    request_count: usize,
    max_records_per_response: u64,
    max_artifact_bytes: usize,
    endpoint_locator: String,
    transport_policy_locator: String,
    dbn_upgrade_policy_locator: String,
    configuration_locator: [u8; 32],
    source_binding_locator_placeholder: String,
    attempt_id: [u8; 32],
    started_observation_ns: u64,
    completed_observation_ns: u64,
    responses: [PitProbeResponseBinding; PIT_PROBE_REQUEST_COUNT],
}

impl PitProbeAttemptReceipt {
    /// Returns the boundary-generated attempt identity.
    #[must_use]
    pub const fn attempt_id(&self) -> &[u8; 32] {
        &self.attempt_id
    }

    /// Returns the stable caller request correlation bound by the attempt.
    #[must_use]
    pub const fn request_correlation(&self) -> &[u8; 32] {
        &self.request_correlation
    }

    /// Returns the exact number of successful provider calls.
    #[must_use]
    pub const fn request_count(&self) -> usize {
        self.request_count
    }

    /// Returns the exact provider dataset bound by the call boundary.
    #[must_use]
    pub fn dataset(&self) -> &str {
        &self.dataset
    }

    /// Returns the canonical instrument bound by the call boundary.
    #[must_use]
    pub fn instrument(&self) -> &str {
        &self.instrument
    }

    /// Returns the provider raw symbol bound by the call boundary.
    #[must_use]
    pub fn symbol(&self) -> &str {
        &self.symbol
    }

    /// Returns the requested provider schema.
    #[must_use]
    pub const fn schema(&self) -> dbn::Schema {
        self.schema
    }

    /// Returns the input symbology type.
    #[must_use]
    pub const fn stype_in(&self) -> dbn::SType {
        self.stype_in
    }

    /// Returns the output symbology type.
    #[must_use]
    pub const fn stype_out(&self) -> dbn::SType {
        self.stype_out
    }

    /// Returns the requested half-open Unix-nanosecond range.
    #[must_use]
    pub const fn range(&self) -> (u64, u64) {
        (self.start, self.end)
    }

    /// Returns the exact record budget per DBN response.
    #[must_use]
    pub const fn max_records_per_response(&self) -> u64 {
        self.max_records_per_response
    }

    /// Returns the aggregate canonical DBN byte budget.
    #[must_use]
    pub const fn max_artifact_bytes(&self) -> usize {
        self.max_artifact_bytes
    }

    /// Returns the non-secret endpoint locator configured on the SDK client.
    #[must_use]
    pub fn endpoint_locator(&self) -> &str {
        &self.endpoint_locator
    }

    /// Returns the fixed direct transport policy bound by the SDK client.
    #[must_use]
    pub fn transport_policy_locator(&self) -> &str {
        &self.transport_policy_locator
    }

    /// Returns the provider-native DBN version policy bound by the SDK decoder.
    #[must_use]
    pub fn dbn_upgrade_policy_locator(&self) -> &str {
        &self.dbn_upgrade_policy_locator
    }

    /// Returns the deterministic non-secret configuration locator.
    #[must_use]
    pub const fn configuration_locator(&self) -> &[u8; 32] {
        &self.configuration_locator
    }

    /// Returns the boundary start observation in Unix nanoseconds.
    #[must_use]
    pub const fn started_observation_ns(&self) -> u64 {
        self.started_observation_ns
    }

    /// Returns the boundary completion observation in Unix nanoseconds.
    #[must_use]
    pub const fn completed_observation_ns(&self) -> u64 {
        self.completed_observation_ns
    }

    /// Returns the exact response-kind/digest bindings.
    #[must_use]
    pub const fn responses(&self) -> &[PitProbeResponseBinding; PIT_PROBE_REQUEST_COUNT] {
        &self.responses
    }

    /// Returns the explicitly non-admitted Source Binding locator placeholder.
    #[must_use]
    pub fn source_binding_locator_placeholder(&self) -> &str {
        &self.source_binding_locator_placeholder
    }

    fn validate(
        &self,
        plan: &BoundedPitProbePlan,
        attempt: &TypedPitProbeAttempt,
    ) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.plan_digest == plan.digest(),
            "PIT probe receipt plan mismatch"
        );
        anyhow::ensure!(
            self.dataset == plan.dataset
                && self.instrument == plan.instrument
                && self.symbol == plan.symbol
                && self.schema == plan.schema
                && self.stype_in == plan.stype_in
                && self.stype_out == plan.stype_out
                && self.start == plan.start
                && self.end == plan.end
                && self.request_correlation == plan.request_correlation,
            "PIT probe receipt request mismatch"
        );
        anyhow::ensure!(
            self.request_count == plan.steps.len()
                && self.max_records_per_response == plan.max_records_per_response
                && self.max_artifact_bytes == plan.max_artifact_bytes,
            "PIT probe receipt budget mismatch"
        );
        anyhow::ensure!(
            self.endpoint_locator == plan.endpoint_locator
                && self.transport_policy_locator == plan.transport_policy_locator
                && self.dbn_upgrade_policy_locator == plan.dbn_upgrade_policy_locator
                && self.configuration_locator == plan.configuration_locator
                && self.source_binding_locator_placeholder
                    == plan.source_binding_locator_placeholder,
            "PIT probe receipt provider binding mismatch"
        );
        anyhow::ensure!(
            self.attempt_id != [0; 32]
                && self.started_observation_ns != 0
                && self.completed_observation_ns >= self.started_observation_ns,
            "PIT probe receipt observation mismatch"
        );
        let expected = response_bindings(attempt);
        anyhow::ensure!(
            self.responses == expected,
            "PIT probe receipt response mismatch"
        );
        Ok(())
    }
}

/// Canonical provider DBN artifact and digest.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PitProbeDbnArtifact {
    bytes: Vec<u8>,
    digest: [u8; 32],
}

impl PitProbeDbnArtifact {
    /// Returns the canonical DBN bytes with provider metadata and record fields intact.
    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Returns the canonical SHA-256 digest.
    #[must_use]
    pub const fn digest(&self) -> &[u8; 32] {
        &self.digest
    }
}

/// Complete untrusted evidence for one authentic typed SDK attempt.
///
/// Private fields and the absence of a constructor prevent caller-authored positive
/// construction. The receipt binds call correlation, not Owner admission.
#[derive(Clone, Debug)]
pub struct DatabentoPitProbeEvidence {
    receipt: PitProbeAttemptReceipt,
    entitlement_range: DatasetRange,
    bbo_cost_usd: f64,
    definition_cost_usd: f64,
    bbo: PitProbeDbnArtifact,
    definitions: PitProbeDbnArtifact,
}

impl DatabentoPitProbeEvidence {
    /// Returns the immutable typed-call receipt.
    #[must_use]
    pub const fn receipt(&self) -> &PitProbeAttemptReceipt {
        &self.receipt
    }

    /// Returns the authentic SDK entitlement-range value as untrusted evidence.
    #[must_use]
    pub const fn untrusted_entitlement_range(&self) -> &DatasetRange {
        &self.entitlement_range
    }

    /// Returns the authentic SDK BBO cost value as untrusted evidence.
    #[must_use]
    pub const fn untrusted_bbo_cost_usd(&self) -> f64 {
        self.bbo_cost_usd
    }

    /// Returns the authentic SDK Definition cost value as untrusted evidence.
    #[must_use]
    pub const fn untrusted_definition_cost_usd(&self) -> f64 {
        self.definition_cost_usd
    }

    /// Returns the canonical BBO DBN artifact.
    #[must_use]
    pub const fn bbo(&self) -> &PitProbeDbnArtifact {
        &self.bbo
    }

    /// Returns the canonical Definition DBN artifact.
    #[must_use]
    pub const fn definitions(&self) -> &PitProbeDbnArtifact {
        &self.definitions
    }
}

#[derive(Clone, Debug)]
struct TypedPitProbeAttempt {
    receipt: PitProbeAttemptReceipt,
    dataset_range: DatasetRange,
    bbo_cost_usd: f64,
    definition_cost_usd: f64,
    bbo_dbn: Vec<u8>,
    definition_dbn: Vec<u8>,
}

#[async_trait]
trait TypedReadOnlyPitProbePort {
    async fn get_dataset_range(&mut self, dataset: &str) -> anyhow::Result<DatasetRange>;
    async fn get_cost(&mut self, params: &GetCostParams) -> anyhow::Result<f64>;
    async fn get_range_dbn(
        &mut self,
        params: &GetRangeParams,
        max_bytes: usize,
    ) -> anyhow::Result<Vec<u8>>;
}

struct DatabentoSdkPitProbePort {
    client: databento::HistoricalClient,
}

#[async_trait]
impl TypedReadOnlyPitProbePort for DatabentoSdkPitProbePort {
    async fn get_dataset_range(&mut self, dataset: &str) -> anyhow::Result<DatasetRange> {
        self.client
            .metadata()
            .get_dataset_range(dataset)
            .await
            .map_err(|e| anyhow::anyhow!("Databento dataset-range preflight failed: {e}"))
    }

    async fn get_cost(&mut self, params: &GetCostParams) -> anyhow::Result<f64> {
        self.client
            .metadata()
            .get_cost(params)
            .await
            .map_err(|e| anyhow::anyhow!("Databento cost preflight failed: {e}"))
    }

    async fn get_range_dbn(
        &mut self,
        params: &GetRangeParams,
        max_bytes: usize,
    ) -> anyhow::Result<Vec<u8>> {
        let mut decoder = self
            .client
            .timeseries()
            .get_range(params)
            .await
            .map_err(|e| anyhow::anyhow!("Databento range request failed: {e}"))?;
        let metadata = decoder.metadata().clone();
        let mut bytes = Vec::new();
        let mut record_count = 0_u64;
        {
            let mut encoder = DbnEncoder::new(&mut bytes, &metadata)?;
            anyhow::ensure!(
                encoder.get_ref().len() <= max_bytes,
                "Databento canonical DBN metadata exceeds the remaining byte budget"
            );

            while let Some(record) = decoder.decode_record_ref().await? {
                encoder.encode_record_ref(record)?;
                record_count += 1;
                anyhow::ensure!(
                    record_count <= PIT_PROBE_MAX_RECORDS_PER_RESPONSE,
                    "Databento provider ignored the fixed record budget"
                );
                anyhow::ensure!(
                    encoder.get_ref().len() <= max_bytes,
                    "Databento canonical DBN artifact exceeds the remaining byte budget"
                );
            }
        }
        Ok(bytes)
    }
}

impl DatabentoHistoricalClient {
    /// Runs the bounded read-only Databento PIT authenticity probe.
    ///
    /// Entitlement-range and cost preflight run first. Any non-zero, non-finite,
    /// or unavailable cost stops before a timeseries download. The returned value
    /// is untrusted adapter evidence and cannot create a Source Binding or PIT
    /// Snapshot disposition. Clients configured with a custom API base URL are
    /// rejected before the first provider call because that endpoint is not an
    /// authenticated Databento evidence source for this probe.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid or oversized range, non-canonical endpoint,
    /// preflight failure, non-zero cost, provider error, response budget breach,
    /// or receipt mismatch.
    pub async fn attempt_bounded_pit_probe(
        &self,
        start: UnixNanos,
        end: UnixNanos,
        request_correlation: [u8; 32],
    ) -> anyhow::Result<DatabentoPitProbeEvidence> {
        anyhow::ensure!(
            self.historical_api_endpoint == PIT_PROBE_CANONICAL_ENDPOINT
                && self.pit_probe_transport == PitProbeTransport::CanonicalDirect,
            "PIT probe requires the canonical direct Databento Historical transport"
        );
        let client = databento::HistoricalClient::builder()
            .user_agent_extension(VIBE_USER_AGENT.into())
            .http_client_builder(
                reqwest::ClientBuilder::new()
                    .no_proxy()
                    .redirect(reqwest::redirect::Policy::none()),
            )
            .upgrade_policy(dbn::VersionUpgradePolicy::AsIs)
            .key(self.credential.api_key())
            .map_err(|e| anyhow::anyhow!("Failed to create PIT probe client builder: {e}"))?
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to build PIT probe client: {e}"))?;
        let mut port = DatabentoSdkPitProbePort { client };
        attempt_with_port(
            &mut port,
            PIT_PROBE_CANONICAL_ENDPOINT,
            start.as_u64(),
            end.as_u64(),
            request_correlation,
            || self.clock.get_time_ns().as_u64(),
        )
        .await
    }
}

async fn attempt_with_port<P: TypedReadOnlyPitProbePort + Send>(
    port: &mut P,
    endpoint_locator: &str,
    start: u64,
    end: u64,
    request_correlation: [u8; 32],
    mut observe_ns: impl FnMut() -> u64 + Send,
) -> anyhow::Result<DatabentoPitProbeEvidence> {
    let plan = BoundedPitProbePlan::new(endpoint_locator, start, end, request_correlation)?;
    let attempt = perform_attempt(port, &plan, &mut observe_ns).await?;
    capture(&plan, &attempt)
}

async fn perform_attempt<P: TypedReadOnlyPitProbePort + Send>(
    port: &mut P,
    plan: &BoundedPitProbePlan,
    observe_ns: &mut (impl FnMut() -> u64 + Send),
) -> anyhow::Result<TypedPitProbeAttempt> {
    let started_observation_ns = observe_ns();
    anyhow::ensure!(
        started_observation_ns != 0,
        "PIT probe start observation is missing"
    );
    let sequence = ATTEMPT_SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1;
    let attempt_id = digest_parts(
        b"databento-pit-probe-attempt/v1",
        &[
            &plan.digest(),
            &started_observation_ns.to_be_bytes(),
            &sequence.to_be_bytes(),
        ],
    );

    let dataset_range = port.get_dataset_range(plan.dataset).await?;
    validate_entitlement_range(plan, &dataset_range)?;
    let bbo_cost_usd = zero_cost_preflight(port, plan, dbn::Schema::Bbo1S).await?;

    let bbo_dbn = port
        .get_range_dbn(
            &plan.range_params(dbn::Schema::Bbo1S)?,
            plan.max_artifact_bytes,
        )
        .await?;
    let bbo_mapping = validate_dbn(plan, &bbo_dbn, dbn::Schema::Bbo1S, RecordKind::Bbo)?;
    let remaining_bytes = plan
        .max_artifact_bytes
        .checked_sub(bbo_dbn.len())
        .ok_or_else(|| anyhow::anyhow!("Databento BBO artifact exceeded the byte budget"))?;
    let definition_cost_usd = zero_cost_preflight(port, plan, dbn::Schema::Definition).await?;
    let definition_dbn = port
        .get_range_dbn(
            &plan.range_params(dbn::Schema::Definition)?,
            remaining_bytes,
        )
        .await?;
    let definition_mapping = validate_dbn(
        plan,
        &definition_dbn,
        dbn::Schema::Definition,
        RecordKind::Definition,
    )?;
    anyhow::ensure!(
        bbo_mapping == definition_mapping,
        "Databento DBN mapping mismatch between BBO and Definition responses"
    );
    validate_artifact_budget(plan, &bbo_dbn, &definition_dbn)?;
    let completed_observation_ns = observe_ns();
    anyhow::ensure!(
        completed_observation_ns >= started_observation_ns,
        "PIT probe completion observation regressed"
    );

    let mut attempt = TypedPitProbeAttempt {
        receipt: empty_receipt(),
        dataset_range,
        bbo_cost_usd,
        definition_cost_usd,
        bbo_dbn,
        definition_dbn,
    };
    attempt.receipt = PitProbeAttemptReceipt {
        plan_digest: plan.digest(),
        dataset: plan.dataset.to_string(),
        instrument: plan.instrument.to_string(),
        symbol: plan.symbol.to_string(),
        schema: plan.schema,
        stype_in: plan.stype_in,
        stype_out: plan.stype_out,
        start: plan.start,
        end: plan.end,
        request_correlation: plan.request_correlation,
        request_count: plan.steps.len(),
        max_records_per_response: plan.max_records_per_response,
        max_artifact_bytes: plan.max_artifact_bytes,
        endpoint_locator: plan.endpoint_locator.clone(),
        transport_policy_locator: plan.transport_policy_locator.to_string(),
        dbn_upgrade_policy_locator: plan.dbn_upgrade_policy_locator.to_string(),
        configuration_locator: plan.configuration_locator,
        source_binding_locator_placeholder: plan.source_binding_locator_placeholder.to_string(),
        attempt_id,
        started_observation_ns,
        completed_observation_ns,
        responses: response_bindings(&attempt),
    };
    Ok(attempt)
}

async fn zero_cost_preflight<P: TypedReadOnlyPitProbePort + Send>(
    port: &mut P,
    plan: &BoundedPitProbePlan,
    schema: dbn::Schema,
) -> anyhow::Result<f64> {
    let cost_usd = port.get_cost(&plan.cost_params(schema)?).await?;
    anyhow::ensure!(
        cost_usd.is_finite() && cost_usd >= 0.0,
        "Databento {schema} cost preflight returned a malformed value"
    );
    anyhow::ensure!(
        cost_usd == 0.0,
        "Databento {schema} cost preflight is non-zero; timeseries download prohibited"
    );
    Ok(cost_usd)
}

fn capture(
    plan: &BoundedPitProbePlan,
    attempt: &TypedPitProbeAttempt,
) -> anyhow::Result<DatabentoPitProbeEvidence> {
    attempt.receipt.validate(plan, attempt)?;
    validate_entitlement_range(plan, &attempt.dataset_range)?;
    validate_artifact_budget(plan, &attempt.bbo_dbn, &attempt.definition_dbn)?;
    let bbo_mapping = validate_dbn(plan, &attempt.bbo_dbn, dbn::Schema::Bbo1S, RecordKind::Bbo)?;
    let definition_mapping = validate_dbn(
        plan,
        &attempt.definition_dbn,
        dbn::Schema::Definition,
        RecordKind::Definition,
    )?;
    anyhow::ensure!(
        bbo_mapping == definition_mapping,
        "Databento DBN mapping mismatch between BBO and Definition responses"
    );
    Ok(DatabentoPitProbeEvidence {
        receipt: attempt.receipt.clone(),
        entitlement_range: attempt.dataset_range.clone(),
        bbo_cost_usd: attempt.bbo_cost_usd,
        definition_cost_usd: attempt.definition_cost_usd,
        bbo: artifact(attempt.bbo_dbn.clone(), attempt.receipt.responses[2].digest),
        definitions: artifact(
            attempt.definition_dbn.clone(),
            attempt.receipt.responses[4].digest,
        ),
    })
}

fn empty_receipt() -> PitProbeAttemptReceipt {
    PitProbeAttemptReceipt {
        plan_digest: [0; 32],
        dataset: String::new(),
        instrument: String::new(),
        symbol: String::new(),
        schema: dbn::Schema::Bbo1S,
        stype_in: dbn::SType::RawSymbol,
        stype_out: dbn::SType::InstrumentId,
        start: 0,
        end: 0,
        request_correlation: [0; 32],
        request_count: 0,
        max_records_per_response: 0,
        max_artifact_bytes: 0,
        endpoint_locator: String::new(),
        transport_policy_locator: String::new(),
        dbn_upgrade_policy_locator: String::new(),
        configuration_locator: [0; 32],
        source_binding_locator_placeholder: String::new(),
        attempt_id: [0; 32],
        started_observation_ns: 0,
        completed_observation_ns: 0,
        responses: std::array::from_fn(|_| PitProbeResponseBinding {
            kind: PitProbeResponseKind::DatasetRange,
            digest: [0; 32],
        }),
    }
}

fn response_bindings(
    attempt: &TypedPitProbeAttempt,
) -> [PitProbeResponseBinding; PIT_PROBE_REQUEST_COUNT] {
    [
        PitProbeResponseBinding {
            kind: PitProbeResponseKind::DatasetRange,
            digest: dataset_range_digest(&attempt.dataset_range),
        },
        PitProbeResponseBinding {
            kind: PitProbeResponseKind::BboCostF64,
            digest: digest_parts(
                b"databento-pit-probe-bbo-cost-f64/v1",
                &[&attempt.bbo_cost_usd.to_bits().to_be_bytes()],
            ),
        },
        PitProbeResponseBinding {
            kind: PitProbeResponseKind::BboDbn,
            digest: digest_parts(b"databento-pit-probe-bbo-dbn/v1", &[&attempt.bbo_dbn]),
        },
        PitProbeResponseBinding {
            kind: PitProbeResponseKind::DefinitionCostF64,
            digest: digest_parts(
                b"databento-pit-probe-definition-cost-f64/v1",
                &[&attempt.definition_cost_usd.to_bits().to_be_bytes()],
            ),
        },
        PitProbeResponseBinding {
            kind: PitProbeResponseKind::DefinitionDbn,
            digest: digest_parts(
                b"databento-pit-probe-definition-dbn/v1",
                &[&attempt.definition_dbn],
            ),
        },
    ]
}

fn dataset_range_digest(range: &DatasetRange) -> [u8; 32] {
    let mut schema_ranges = range.range_by_schema.iter().collect::<Vec<_>>();
    schema_ranges.sort_by_key(|(schema, _)| schema.as_str());
    let mut hasher = Sha256::new();
    update_part(&mut hasher, b"databento-pit-probe-dataset-range/v1");
    update_part(
        &mut hasher,
        &range.start.unix_timestamp_nanos().to_be_bytes(),
    );
    update_part(&mut hasher, &range.end.unix_timestamp_nanos().to_be_bytes());
    for (schema, schema_range) in schema_ranges {
        update_part(&mut hasher, schema.as_str().as_bytes());
        update_part(
            &mut hasher,
            &schema_range.start.unix_timestamp_nanos().to_be_bytes(),
        );
        update_part(
            &mut hasher,
            &schema_range.end.unix_timestamp_nanos().to_be_bytes(),
        );
    }
    hasher.finalize().into()
}

fn validate_entitlement_range(
    plan: &BoundedPitProbePlan,
    range: &DatasetRange,
) -> anyhow::Result<()> {
    let start = i128::from(plan.start);
    let end = i128::from(plan.end);
    anyhow::ensure!(
        range.start.unix_timestamp_nanos() <= start && range.end.unix_timestamp_nanos() >= end,
        "Databento entitlement range does not cover the requested interval"
    );

    for schema in [dbn::Schema::Bbo1S, dbn::Schema::Definition] {
        let schema_range = range
            .range_by_schema
            .get(&schema)
            .ok_or_else(|| anyhow::anyhow!("Databento entitlement range is missing {schema}"))?;
        anyhow::ensure!(
            schema_range.start.unix_timestamp_nanos() <= start
                && schema_range.end.unix_timestamp_nanos() >= end,
            "Databento entitlement range for {schema} does not cover the requested interval"
        );
    }
    Ok(())
}

fn validate_artifact_budget(
    plan: &BoundedPitProbePlan,
    bbo: &[u8],
    definitions: &[u8],
) -> anyhow::Result<()> {
    let total = bbo
        .len()
        .checked_add(definitions.len())
        .ok_or_else(|| anyhow::anyhow!("Databento artifact byte count overflow"))?;
    anyhow::ensure!(
        total <= plan.max_artifact_bytes,
        "Databento canonical DBN artifacts exceed the fixed byte budget"
    );
    Ok(())
}

#[derive(Clone, Copy)]
enum RecordKind {
    Bbo,
    Definition,
}

fn validate_dbn(
    plan: &BoundedPitProbePlan,
    raw: &[u8],
    schema: dbn::Schema,
    kind: RecordKind,
) -> anyhow::Result<dbn::SymbolMapping> {
    let mut decoder = dbn::decode::DbnDecoder::with_upgrade_policy(
        Cursor::new(raw),
        dbn::VersionUpgradePolicy::AsIs,
    )
    .map_err(|e| anyhow::anyhow!("missing or malformed DBN metadata: {e}"))?;
    let metadata = decoder.metadata().clone();
    anyhow::ensure!(metadata.dataset == plan.dataset, "DBN dataset mismatch");
    anyhow::ensure!(metadata.schema == Some(schema), "DBN schema mismatch");
    anyhow::ensure!(
        metadata.start == plan.start && metadata.end.map(NonZeroU64::get) == Some(plan.end),
        "DBN range mismatch"
    );
    anyhow::ensure!(metadata.symbols == [plan.symbol], "DBN symbol mismatch");
    anyhow::ensure!(
        metadata.limit.map(NonZeroU64::get) == Some(plan.max_records_per_response),
        "DBN record limit does not match the fixed request budget"
    );
    anyhow::ensure!(
        metadata.partial.is_empty() && metadata.not_found.is_empty(),
        "DBN symbol resolution is partial or contains not-found symbols"
    );
    anyhow::ensure!(!metadata.ts_out, "DBN response contains unrequested ts_out");
    anyhow::ensure!(
        metadata.stype_in == Some(plan.stype_in),
        "DBN stype_in mismatch"
    );
    anyhow::ensure!(
        metadata.stype_out == plan.stype_out,
        "DBN stype_out mismatch"
    );
    anyhow::ensure!(
        metadata.mappings.len() == 1,
        "DBN symbology mapping set contains an unrelated symbol"
    );
    let mappings = metadata
        .mappings
        .iter()
        .filter(|mapping| mapping.raw_symbol == plan.symbol)
        .collect::<Vec<_>>();
    anyhow::ensure!(
        mappings.len() == 1 && mappings[0].intervals.len() == 1,
        "missing or ambiguous DBN symbology mapping"
    );
    let mut record_count = 0_u64;

    match kind {
        RecordKind::Bbo => {
            while let Some(record) = decoder.decode_record::<dbn::Bbo1SMsg>()? {
                validate_record(
                    plan,
                    &metadata,
                    record.hd.instrument_id,
                    record.hd.ts_event,
                    record.ts_recv,
                )?;
                record_count += 1;
                anyhow::ensure!(
                    record_count <= plan.max_records_per_response,
                    "DBN BBO response exceeds the fixed record budget"
                );
            }
        }
        RecordKind::Definition => match metadata.version {
            1 => {
                while let Some(record) = decoder.decode_record::<dbn::v1::InstrumentDefMsg>()? {
                    validate_definition_record(
                        plan,
                        &metadata,
                        record,
                        record.ts_recv,
                        std::mem::size_of::<dbn::v1::InstrumentDefMsg>(),
                    )?;
                    record_count += 1;
                    anyhow::ensure!(
                        record_count <= plan.max_records_per_response,
                        "DBN Definition response exceeds the fixed record budget"
                    );
                }
            }
            2 => {
                while let Some(record) = decoder.decode_record::<dbn::v2::InstrumentDefMsg>()? {
                    validate_definition_record(
                        plan,
                        &metadata,
                        record,
                        record.ts_recv,
                        std::mem::size_of::<dbn::v2::InstrumentDefMsg>(),
                    )?;
                    record_count += 1;
                    anyhow::ensure!(
                        record_count <= plan.max_records_per_response,
                        "DBN Definition response exceeds the fixed record budget"
                    );
                }
            }
            3 => {
                while let Some(record) = decoder.decode_record::<dbn::InstrumentDefMsg>()? {
                    validate_definition_record(
                        plan,
                        &metadata,
                        record,
                        record.ts_recv,
                        std::mem::size_of::<dbn::InstrumentDefMsg>(),
                    )?;
                    record_count += 1;
                    anyhow::ensure!(
                        record_count <= plan.max_records_per_response,
                        "DBN Definition response exceeds the fixed record budget"
                    );
                }
            }
            version => anyhow::bail!("unsupported provider-native DBN version {version}"),
        },
    }
    anyhow::ensure!(record_count != 0, "DBN response contains no records");
    Ok(mappings[0].clone())
}

fn validate_definition_record<R: dbn::compat::InstrumentDefRec>(
    plan: &BoundedPitProbePlan,
    metadata: &dbn::Metadata,
    record: &R,
    ts_recv: u64,
    exact_record_size: usize,
) -> anyhow::Result<()> {
    let header = dbn::Record::header(record);
    anyhow::ensure!(
        header.record_size() == exact_record_size,
        "DBN Definition record layout does not match metadata version"
    );
    anyhow::ensure!(
        record.raw_symbol()? == plan.symbol,
        "DBN Definition raw_symbol does not match the requested symbol"
    );
    validate_record(
        plan,
        metadata,
        header.instrument_id,
        header.ts_event,
        ts_recv,
    )
}

fn validate_record(
    plan: &BoundedPitProbePlan,
    metadata: &dbn::Metadata,
    instrument_id: u32,
    ts_event: u64,
    ts_recv: u64,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        ts_event != 0 && ts_event != dbn::UNDEF_TIMESTAMP,
        "raw-time loss: missing provider ts_event"
    );
    anyhow::ensure!(
        ts_recv != 0 && ts_recv != dbn::UNDEF_TIMESTAMP,
        "raw-time loss: missing provider ts_recv"
    );
    anyhow::ensure!(
        ts_recv >= plan.start && ts_recv < plan.end,
        "provider ts_recv is outside the requested half-open interval"
    );
    let event_mapping = mapped_instrument_id(metadata, plan, ts_event, "ts_event")?;
    let receive_mapping = mapped_instrument_id(metadata, plan, ts_recv, "ts_recv")?;
    anyhow::ensure!(
        event_mapping == receive_mapping,
        "provider mapping differs between ts_event and ts_recv"
    );
    anyhow::ensure!(
        instrument_id == event_mapping,
        "provider instrument_id does not match the exact PIT mapping"
    );
    Ok(())
}

fn mapped_instrument_id(
    metadata: &dbn::Metadata,
    plan: &BoundedPitProbePlan,
    timestamp: u64,
    field: &str,
) -> anyhow::Result<u32> {
    let date = time::OffsetDateTime::from_unix_timestamp_nanos(i128::from(timestamp))
        .map_err(|e| anyhow::anyhow!("invalid provider {field}: {e}"))?
        .date();
    let intervals = metadata
        .mappings
        .iter()
        .filter(|mapping| mapping.raw_symbol == plan.symbol)
        .flat_map(|mapping| &mapping.intervals)
        .filter(|interval| interval.start_date <= date && date < interval.end_date)
        .collect::<Vec<_>>();
    anyhow::ensure!(
        intervals.len() == 1,
        "no exact PIT mapping interval for provider {field}"
    );
    intervals[0]
        .symbol
        .parse::<u32>()
        .map_err(|e| anyhow::anyhow!("PIT mapping has non-numeric instrument_id: {e}"))
}

fn artifact(bytes: Vec<u8>, digest: [u8; 32]) -> PitProbeDbnArtifact {
    PitProbeDbnArtifact { bytes, digest }
}

fn digest_parts(domain: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    update_part(&mut hasher, domain);
    for part in parts {
        update_part(&mut hasher, part);
    }
    hasher.finalize().into()
}

fn update_part(hasher: &mut Sha256, part: &[u8]) {
    hasher.update(
        u64::try_from(part.len())
            .expect("bounded digest part fits u64")
            .to_be_bytes(),
    );
    hasher.update(part);
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use databento::dbn::{
        MappingInterval, Metadata, SType, SymbolMapping,
        decode::DecodeRecordRef,
        encode::{DbnEncoder, EncodeRecord},
    };
    use rstest::rstest;
    use time::{Date, Month, OffsetDateTime};

    use super::*;

    const START: u64 = 1_704_067_200_000_000_000;
    const END: u64 = 1_704_153_600_000_000_000;
    const TS_EVENT: u64 = START + 1_000_000_000;
    const TS_RECV: u64 = TS_EVENT + 500;
    const CORRELATION: [u8; 32] = [7; 32];

    #[derive(Default)]
    struct FixturePort {
        calls: Vec<ProbeStep>,
        dataset_range: Option<DatasetRange>,
        bbo_cost_usd: f64,
        definition_cost_usd: f64,
        bbo: Vec<u8>,
        definitions: Vec<u8>,
    }

    #[async_trait]
    impl TypedReadOnlyPitProbePort for FixturePort {
        async fn get_dataset_range(&mut self, _dataset: &str) -> anyhow::Result<DatasetRange> {
            self.calls.push(ProbeStep::DatasetRange);
            self.dataset_range
                .clone()
                .ok_or_else(|| anyhow::anyhow!("fixture dataset range unavailable"))
        }

        async fn get_cost(&mut self, params: &GetCostParams) -> anyhow::Result<f64> {
            match params.schema {
                dbn::Schema::Bbo1S => {
                    self.calls.push(ProbeStep::BboCost);
                    Ok(self.bbo_cost_usd)
                }
                dbn::Schema::Definition => {
                    self.calls.push(ProbeStep::DefinitionCost);
                    Ok(self.definition_cost_usd)
                }
                schema => anyhow::bail!("unexpected fixture cost schema {schema}"),
            }
        }

        async fn get_range_dbn(
            &mut self,
            params: &GetRangeParams,
            max_bytes: usize,
        ) -> anyhow::Result<Vec<u8>> {
            match params.schema {
                dbn::Schema::Bbo1S => {
                    self.calls.push(ProbeStep::Bbo);
                    anyhow::ensure!(
                        self.bbo.len() <= max_bytes,
                        "fixture BBO exceeds byte budget"
                    );
                    Ok(self.bbo.clone())
                }
                dbn::Schema::Definition => {
                    self.calls.push(ProbeStep::Definition);
                    anyhow::ensure!(
                        self.definitions.len() <= max_bytes,
                        "fixture Definition exceeds byte budget"
                    );
                    Ok(self.definitions.clone())
                }
                schema => anyhow::bail!("unexpected fixture schema {schema}"),
            }
        }
    }

    fn entitlement_range() -> DatasetRange {
        let start = OffsetDateTime::from_unix_timestamp_nanos(i128::from(START)).unwrap();
        let end = OffsetDateTime::from_unix_timestamp_nanos(i128::from(END)).unwrap();
        DatasetRange {
            start,
            end,
            range_by_schema: HashMap::from([
                (dbn::Schema::Bbo1S, (start, end).into()),
                (dbn::Schema::Definition, (start, end).into()),
            ]),
        }
    }

    fn metadata(schema: dbn::Schema) -> Metadata {
        Metadata::builder()
            .dataset(PIT_PROBE_DATASET)
            .schema(Some(schema))
            .start(START)
            .end(NonZeroU64::new(END))
            .stype_in(Some(SType::RawSymbol))
            .stype_out(SType::InstrumentId)
            .limit(NonZeroU64::new(PIT_PROBE_MAX_RECORDS_PER_RESPONSE))
            .symbols(vec![PIT_PROBE_SYMBOL.to_string()])
            .mappings(vec![SymbolMapping {
                raw_symbol: PIT_PROBE_SYMBOL.to_string(),
                intervals: vec![MappingInterval {
                    start_date: Date::from_calendar_date(2024, Month::January, 1).unwrap(),
                    end_date: Date::from_calendar_date(2024, Month::January, 2).unwrap(),
                    symbol: "101".to_string(),
                }],
            }])
            .build()
    }

    fn encode<R: dbn::encode::DbnEncodable>(metadata: &Metadata, record: &R) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = DbnEncoder::new(&mut bytes, metadata).unwrap();
            encoder.encode_record(record).unwrap();
        }
        bytes
    }

    fn bbo_with(metadata: &Metadata, instrument_id: u32, ts_event: u64, ts_recv: u64) -> Vec<u8> {
        let mut record = dbn::Bbo1SMsg::default_for_schema(dbn::Schema::Bbo1S);
        record.hd.instrument_id = instrument_id;
        record.hd.ts_event = ts_event;
        record.ts_recv = ts_recv;
        encode(metadata, &record)
    }

    fn definitions_with(metadata: &Metadata, instrument_id: u32) -> Vec<u8> {
        let mut record = dbn::InstrumentDefMsg::default();
        record.hd.instrument_id = instrument_id;
        record.hd.ts_event = TS_EVENT;
        record.ts_recv = TS_RECV;
        record.raw_symbol = dbn::record::str_to_c_chars(PIT_PROBE_SYMBOL).unwrap();
        encode(metadata, &record)
    }

    fn definitions_v2_with(metadata: &Metadata, instrument_id: u32) -> Vec<u8> {
        let mut record = dbn::v2::InstrumentDefMsg::default();
        record.hd.instrument_id = instrument_id;
        record.hd.ts_event = TS_EVENT;
        record.ts_recv = TS_RECV;
        record.raw_symbol = dbn::record::str_to_c_chars(PIT_PROBE_SYMBOL).unwrap();
        encode(metadata, &record)
    }

    fn fixture_port() -> FixturePort {
        FixturePort {
            calls: Vec::new(),
            dataset_range: Some(entitlement_range()),
            bbo_cost_usd: 0.0,
            definition_cost_usd: 0.0,
            bbo: bbo_with(&metadata(dbn::Schema::Bbo1S), 101, TS_EVENT, TS_RECV),
            definitions: definitions_with(&metadata(dbn::Schema::Definition), 101),
        }
    }

    fn observations() -> impl FnMut() -> u64 {
        let mut next = 10_u64;
        move || {
            let current = next;
            next += 1;
            current
        }
    }

    #[tokio::test]
    async fn typed_port_is_the_only_positive_receipt_path() {
        let mut port = fixture_port();
        let evidence = attempt_with_port(
            &mut port,
            "https://hist.databento.com",
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap();

        assert_eq!(
            port.calls,
            [
                ProbeStep::DatasetRange,
                ProbeStep::BboCost,
                ProbeStep::Bbo,
                ProbeStep::DefinitionCost,
                ProbeStep::Definition
            ]
        );
        assert_eq!(evidence.receipt().request_count(), PIT_PROBE_REQUEST_COUNT);
        assert_eq!(evidence.receipt().dataset(), PIT_PROBE_DATASET);
        assert_eq!(evidence.receipt().instrument(), PIT_PROBE_INSTRUMENT);
        assert_eq!(evidence.receipt().symbol(), PIT_PROBE_SYMBOL);
        assert_eq!(evidence.receipt().schema(), dbn::Schema::Bbo1S);
        assert_eq!(evidence.receipt().stype_in(), dbn::SType::RawSymbol);
        assert_eq!(evidence.receipt().stype_out(), dbn::SType::InstrumentId);
        assert_eq!(evidence.receipt().range(), (START, END));
        assert_eq!(
            evidence.receipt().max_records_per_response(),
            PIT_PROBE_MAX_RECORDS_PER_RESPONSE
        );
        assert_eq!(
            evidence.receipt().max_artifact_bytes(),
            PIT_PROBE_MAX_ARTIFACT_BYTES
        );
        assert_eq!(
            evidence.receipt().endpoint_locator(),
            "https://hist.databento.com"
        );
        assert_eq!(
            evidence.receipt().transport_policy_locator(),
            PIT_PROBE_TRANSPORT_POLICY
        );
        assert_eq!(
            evidence.receipt().dbn_upgrade_policy_locator(),
            PIT_PROBE_DBN_UPGRADE_POLICY
        );
        assert_ne!(evidence.receipt().configuration_locator(), &[0; 32]);
        assert_eq!(evidence.receipt().request_correlation(), &CORRELATION);
        assert_eq!(evidence.untrusted_bbo_cost_usd(), 0.0);
        assert_eq!(evidence.untrusted_definition_cost_usd(), 0.0);
        assert_eq!(evidence.receipt().started_observation_ns(), 10);
        assert_eq!(evidence.receipt().completed_observation_ns(), 11);
        assert_eq!(
            evidence.receipt().source_binding_locator_placeholder(),
            SOURCE_BINDING_LOCATOR_PLACEHOLDER
        );
        assert!(!evidence.bbo().bytes().is_empty());
        assert_ne!(evidence.bbo().digest(), &[0; 32]);
        assert_eq!(
            evidence.bbo().digest(),
            evidence.receipt().responses()[2].digest()
        );
    }

    #[tokio::test]
    async fn legacy_definition_is_reencoded_without_version_or_layout_upgrade() {
        let legacy_metadata = Metadata::builder()
            .version(1)
            .dataset(PIT_PROBE_DATASET)
            .schema(Some(dbn::Schema::Definition))
            .start(START)
            .end(NonZeroU64::new(END))
            .stype_in(Some(SType::RawSymbol))
            .stype_out(SType::InstrumentId)
            .limit(NonZeroU64::new(PIT_PROBE_MAX_RECORDS_PER_RESPONSE))
            .symbols(vec![PIT_PROBE_SYMBOL.to_string()])
            .mappings(metadata(dbn::Schema::Definition).mappings)
            .build();
        let mut legacy_record = dbn::v1::InstrumentDefMsg::default();
        legacy_record.hd.instrument_id = 101;
        legacy_record.hd.ts_event = TS_EVENT;
        legacy_record.ts_recv = TS_RECV;
        legacy_record.raw_symbol = dbn::record::str_to_c_chars(PIT_PROBE_SYMBOL).unwrap();
        let provider_bytes = encode(&legacy_metadata, &legacy_record);

        let mut decoder = dbn::decode::DbnDecoder::with_upgrade_policy(
            Cursor::new(&provider_bytes),
            dbn::VersionUpgradePolicy::AsIs,
        )
        .unwrap();
        let provider_metadata = decoder.metadata().clone();
        assert_eq!(provider_metadata.version, 1);
        let mut canonical = Vec::new();
        {
            let mut encoder = DbnEncoder::new(&mut canonical, &provider_metadata).unwrap();
            while let Some(record) = decoder.decode_record_ref().unwrap() {
                encoder.encode_record_ref(record).unwrap();
            }
        }
        assert_eq!(canonical, provider_bytes);

        let mut port = fixture_port();
        port.definitions = canonical;
        let evidence = attempt_with_port(
            &mut port,
            PIT_PROBE_CANONICAL_ENDPOINT,
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap();
        assert_eq!(evidence.definitions().bytes(), provider_bytes);
        let mut captured = dbn::decode::DbnDecoder::with_upgrade_policy(
            Cursor::new(evidence.definitions().bytes()),
            dbn::VersionUpgradePolicy::AsIs,
        )
        .unwrap();
        assert_eq!(captured.metadata().version, 1);
        assert!(
            captured
                .decode_record::<dbn::v1::InstrumentDefMsg>()
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn version_two_definition_layout_is_accepted_as_is() {
        let definition_metadata = Metadata::builder()
            .version(2)
            .dataset(PIT_PROBE_DATASET)
            .schema(Some(dbn::Schema::Definition))
            .start(START)
            .end(NonZeroU64::new(END))
            .stype_in(Some(SType::RawSymbol))
            .stype_out(SType::InstrumentId)
            .limit(NonZeroU64::new(PIT_PROBE_MAX_RECORDS_PER_RESPONSE))
            .symbols(vec![PIT_PROBE_SYMBOL.to_string()])
            .mappings(metadata(dbn::Schema::Definition).mappings)
            .build();
        let provider_bytes = definitions_v2_with(&definition_metadata, 101);
        let mut port = fixture_port();
        port.definitions = provider_bytes.clone();
        let evidence = attempt_with_port(
            &mut port,
            PIT_PROBE_CANONICAL_ENDPOINT,
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap();
        assert_eq!(evidence.definitions().bytes(), provider_bytes);
    }

    #[rstest]
    #[case("")]
    #[case("MSFT")]
    #[tokio::test]
    async fn definition_raw_symbol_must_match_request(#[case] raw_symbol: &str) {
        let mut record = dbn::InstrumentDefMsg::default();
        record.hd.instrument_id = 101;
        record.hd.ts_event = TS_EVENT;
        record.ts_recv = TS_RECV;
        record.raw_symbol = dbn::record::str_to_c_chars(raw_symbol).unwrap();
        let mut port = fixture_port();
        port.definitions = encode(&metadata(dbn::Schema::Definition), &record);
        let error = attempt_with_port(
            &mut port,
            PIT_PROBE_CANONICAL_ENDPOINT,
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("Definition raw_symbol"));
    }

    #[tokio::test]
    async fn metadata_version_must_match_exact_definition_layout() {
        let legacy_metadata = Metadata::builder()
            .version(1)
            .dataset(PIT_PROBE_DATASET)
            .schema(Some(dbn::Schema::Definition))
            .start(START)
            .end(NonZeroU64::new(END))
            .stype_in(Some(SType::RawSymbol))
            .stype_out(SType::InstrumentId)
            .limit(NonZeroU64::new(PIT_PROBE_MAX_RECORDS_PER_RESPONSE))
            .symbols(vec![PIT_PROBE_SYMBOL.to_string()])
            .mappings(metadata(dbn::Schema::Definition).mappings)
            .build();
        let mut current_record = dbn::InstrumentDefMsg::default();
        current_record.hd.instrument_id = 101;
        current_record.hd.ts_event = TS_EVENT;
        current_record.ts_recv = TS_RECV;
        current_record.raw_symbol = dbn::record::str_to_c_chars(PIT_PROBE_SYMBOL).unwrap();
        let mut port = fixture_port();
        port.definitions = encode(&legacy_metadata, &current_record);
        let error = attempt_with_port(
            &mut port,
            PIT_PROBE_CANONICAL_ENDPOINT,
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(
            error.contains("record layout does not match metadata version"),
            "unexpected error: {error}"
        );
    }

    #[rstest]
    #[case("limit", "record limit")]
    #[case("partial", "symbol resolution")]
    #[case("not_found", "symbol resolution")]
    #[case("ts_out", "unrequested ts_out")]
    #[tokio::test]
    async fn metadata_request_correlation_mismatch_is_rejected(
        #[case] mismatch: &str,
        #[case] expected: &str,
    ) {
        let mut wrong = metadata(dbn::Schema::Bbo1S);
        match mismatch {
            "limit" => wrong.limit = None,
            "partial" => wrong.partial.push(PIT_PROBE_SYMBOL.to_string()),
            "not_found" => wrong.not_found.push(PIT_PROBE_SYMBOL.to_string()),
            "ts_out" => wrong.ts_out = true,
            _ => unreachable!(),
        }
        let mut port = fixture_port();
        port.bbo = bbo_with(&wrong, 101, TS_EVENT, TS_RECV);
        let error = attempt_with_port(
            &mut port,
            PIT_PROBE_CANONICAL_ENDPOINT,
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains(expected));
        assert_eq!(
            port.calls,
            [ProbeStep::DatasetRange, ProbeStep::BboCost, ProbeStep::Bbo]
        );
    }

    #[tokio::test]
    async fn caller_controlled_endpoint_stops_before_provider_call() {
        let mut port = fixture_port();

        let error = attempt_with_port(
            &mut port,
            "https://caller.invalid",
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err();

        assert!(
            error
                .to_string()
                .contains("requires the canonical Databento Historical API endpoint")
        );
        assert!(port.calls.is_empty());
    }

    #[tokio::test]
    async fn nonzero_cost_stops_before_any_timeseries_download() {
        let mut port = fixture_port();
        port.bbo_cost_usd = 0.01;

        let error = attempt_with_port(
            &mut port,
            "https://hist.databento.com",
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();

        assert!(error.contains("non-zero"));
        assert_eq!(port.calls, [ProbeStep::DatasetRange, ProbeStep::BboCost]);
    }

    #[tokio::test]
    async fn malformed_cost_stops_before_any_timeseries_download() {
        let mut port = fixture_port();
        port.bbo_cost_usd = f64::NAN;

        let error = attempt_with_port(
            &mut port,
            "https://hist.databento.com",
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();

        assert!(error.contains("malformed"));
        assert_eq!(port.calls, [ProbeStep::DatasetRange, ProbeStep::BboCost]);
    }

    #[rstest]
    #[case(0.01, "non-zero")]
    #[case(f64::NAN, "malformed")]
    #[tokio::test]
    async fn definition_cost_failure_stops_before_definition_download(
        #[case] definition_cost_usd: f64,
        #[case] expected: &str,
    ) {
        let mut port = fixture_port();
        port.definition_cost_usd = definition_cost_usd;

        let error = attempt_with_port(
            &mut port,
            "https://hist.databento.com",
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();

        assert!(error.contains(expected));
        assert_eq!(
            port.calls,
            [
                ProbeStep::DatasetRange,
                ProbeStep::BboCost,
                ProbeStep::Bbo,
                ProbeStep::DefinitionCost
            ]
        );
    }

    #[tokio::test]
    async fn oversized_window_fails_before_the_typed_port() {
        let mut port = fixture_port();
        let error = attempt_with_port(
            &mut port,
            "https://hist.databento.com",
            START,
            START + PIT_PROBE_MAX_WINDOW_NS + 1,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("one-day maximum"));
        assert!(port.calls.is_empty());
    }

    #[tokio::test]
    async fn zero_correlation_fails_before_the_typed_port() {
        let mut port = fixture_port();
        let error = attempt_with_port(
            &mut port,
            "https://hist.databento.com",
            START,
            END,
            [0; 32],
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("correlation"));
        assert!(port.calls.is_empty());
    }

    #[tokio::test]
    async fn oversized_artifact_stops_at_the_first_range_response() {
        let mut port = fixture_port();
        port.bbo = vec![0; PIT_PROBE_MAX_ARTIFACT_BYTES + 1];
        let error = attempt_with_port(
            &mut port,
            "https://hist.databento.com",
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("byte budget"));
        assert_eq!(
            port.calls,
            [ProbeStep::DatasetRange, ProbeStep::BboCost, ProbeStep::Bbo]
        );
    }

    #[tokio::test]
    async fn incomplete_entitlement_range_stops_before_cost() {
        let mut port = fixture_port();
        port.dataset_range
            .as_mut()
            .unwrap()
            .range_by_schema
            .remove(&dbn::Schema::Definition);
        let error = attempt_with_port(
            &mut port,
            "https://hist.databento.com",
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("missing definition"));
        assert_eq!(port.calls, [ProbeStep::DatasetRange]);
    }

    #[tokio::test]
    async fn missing_dbn_metadata_is_rejected() {
        let mut port = fixture_port();
        port.bbo.clear();
        let error = attempt_with_port(
            &mut port,
            "https://hist.databento.com",
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("missing or malformed DBN metadata"));
    }

    #[rstest]
    #[case(Some(SType::InstrumentId), SType::InstrumentId, "stype_in")]
    #[case(Some(SType::RawSymbol), SType::RawSymbol, "stype_out")]
    #[tokio::test]
    async fn wrong_stype_is_rejected(
        #[case] stype_in: Option<SType>,
        #[case] stype_out: SType,
        #[case] expected: &str,
    ) {
        let mut port = fixture_port();
        let mut wrong = metadata(dbn::Schema::Bbo1S);
        wrong.stype_in = stype_in;
        wrong.stype_out = stype_out;
        port.bbo = bbo_with(&wrong, 101, TS_EVENT, TS_RECV);
        let error = attempt_with_port(
            &mut port,
            "https://hist.databento.com",
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains(expected));
    }

    #[tokio::test]
    async fn wrong_record_instrument_is_rejected() {
        let mut port = fixture_port();
        port.bbo = bbo_with(&metadata(dbn::Schema::Bbo1S), 202, TS_EVENT, TS_RECV);
        let error = attempt_with_port(
            &mut port,
            "https://hist.databento.com",
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("instrument_id"));
        assert_eq!(
            port.calls,
            [ProbeStep::DatasetRange, ProbeStep::BboCost, ProbeStep::Bbo]
        );
    }

    #[tokio::test]
    async fn unrelated_mapping_is_rejected_before_definition_preflight() {
        let mut port = fixture_port();
        let mut wrong = metadata(dbn::Schema::Bbo1S);
        wrong.mappings.push(SymbolMapping {
            raw_symbol: "MSFT".to_string(),
            intervals: wrong.mappings[0].intervals.clone(),
        });
        port.bbo = bbo_with(&wrong, 101, TS_EVENT, TS_RECV);

        let error = attempt_with_port(
            &mut port,
            "https://hist.databento.com",
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();

        assert!(error.contains("unrelated symbol"));
        assert_eq!(
            port.calls,
            [ProbeStep::DatasetRange, ProbeStep::BboCost, ProbeStep::Bbo]
        );
    }

    #[tokio::test]
    async fn extra_mapping_interval_is_rejected_before_definition_preflight() {
        let mut port = fixture_port();
        let mut wrong = metadata(dbn::Schema::Bbo1S);
        wrong.mappings[0].intervals.push(MappingInterval {
            start_date: Date::from_calendar_date(2024, Month::January, 2).unwrap(),
            end_date: Date::from_calendar_date(2024, Month::January, 3).unwrap(),
            symbol: "202".to_string(),
        });
        port.bbo = bbo_with(&wrong, 101, TS_EVENT, TS_RECV);

        let error = attempt_with_port(
            &mut port,
            "https://hist.databento.com",
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();

        assert!(error.contains("ambiguous DBN symbology mapping"));
        assert_eq!(
            port.calls,
            [ProbeStep::DatasetRange, ProbeStep::BboCost, ProbeStep::Bbo]
        );
    }

    #[tokio::test]
    async fn wrong_mapping_interval_is_rejected() {
        let mut port = fixture_port();
        let mut wrong = metadata(dbn::Schema::Bbo1S);
        wrong.mappings[0].intervals[0].start_date =
            Date::from_calendar_date(2024, Month::January, 2).unwrap();
        wrong.mappings[0].intervals[0].end_date =
            Date::from_calendar_date(2024, Month::January, 3).unwrap();
        port.bbo = bbo_with(&wrong, 101, TS_EVENT, TS_RECV);
        let error = attempt_with_port(
            &mut port,
            "https://hist.databento.com",
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("exact PIT mapping interval"));
    }

    #[rstest]
    #[case(dbn::UNDEF_TIMESTAMP, TS_RECV, "ts_event")]
    #[case(TS_EVENT, dbn::UNDEF_TIMESTAMP, "ts_recv")]
    #[tokio::test]
    async fn raw_time_loss_is_rejected(
        #[case] ts_event: u64,
        #[case] ts_recv: u64,
        #[case] expected: &str,
    ) {
        let mut port = fixture_port();
        port.bbo = bbo_with(&metadata(dbn::Schema::Bbo1S), 101, ts_event, ts_recv);
        let error = attempt_with_port(
            &mut port,
            "https://hist.databento.com",
            START,
            END,
            CORRELATION,
            observations(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains(expected));
    }

    #[tokio::test]
    async fn receipt_response_digest_mismatch_is_rejected() {
        let plan = BoundedPitProbePlan::new("https://hist.databento.com", START, END, CORRELATION)
            .unwrap();
        let mut port = fixture_port();
        let mut observe = observations();
        let mut attempt = perform_attempt(&mut port, &plan, &mut observe)
            .await
            .unwrap();
        attempt.bbo_dbn.push(0);
        let error = capture(&plan, &attempt).unwrap_err().to_string();
        assert!(error.contains("receipt response mismatch"));
    }

    #[tokio::test]
    async fn receipt_request_correlation_mismatch_is_rejected() {
        let plan = BoundedPitProbePlan::new("https://hist.databento.com", START, END, CORRELATION)
            .unwrap();
        let mut port = fixture_port();
        let mut observe = observations();
        let mut attempt = perform_attempt(&mut port, &plan, &mut observe)
            .await
            .unwrap();
        attempt.receipt.request_correlation = [8; 32];
        let error = capture(&plan, &attempt).unwrap_err().to_string();
        assert!(error.contains("receipt request mismatch"));
    }

    #[tokio::test]
    async fn receipt_dbn_upgrade_policy_mismatch_is_rejected() {
        let plan = BoundedPitProbePlan::new("https://hist.databento.com", START, END, CORRELATION)
            .unwrap();
        let mut port = fixture_port();
        let mut observe = observations();
        let mut attempt = perform_attempt(&mut port, &plan, &mut observe)
            .await
            .unwrap();
        attempt.receipt.dbn_upgrade_policy_locator = "dbn-version-upgrade:upgrade-to-v3".into();
        let error = capture(&plan, &attempt).unwrap_err().to_string();
        assert!(error.contains("receipt provider binding mismatch"));
    }

    #[tokio::test]
    async fn receipt_plan_mismatch_is_rejected() {
        let plan = BoundedPitProbePlan::new("https://hist.databento.com", START, END, CORRELATION)
            .unwrap();
        let mut port = fixture_port();
        let mut observe = observations();
        let attempt = perform_attempt(&mut port, &plan, &mut observe)
            .await
            .unwrap();
        let mut other =
            BoundedPitProbePlan::new("https://hist.databento.com", START, END, CORRELATION)
                .unwrap();
        other.end -= 1;
        let error = capture(&other, &attempt).unwrap_err().to_string();
        assert!(error.contains("receipt plan mismatch"));
    }
}
