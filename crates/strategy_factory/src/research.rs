use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_model::data::Bar;

const FROZEN_REPRESENTATIVE_INTENT_BYTES: &[u8] =
    include_bytes!("../assets/representative_intent_v4.jcs");
const PREDECESSOR_REPRESENTATIVE_INTENT_BYTES: &[u8] =
    include_bytes!("../assets/representative_intent_v3.jcs");
const PRICE_PARAMETER_FAMILY_BYTES: &[u8] = include_bytes!("../assets/complex_intent_v4.jcs");

pub const REPRESENTATIVE_INTENT_ID: &str = "researchintent-strategy-factory-representative-v4";
pub const REPRESENTATIVE_EXPERIMENT_ID: &str = "btc-eth-perpetual-cross-asset-multitimeframe-v4";
pub const REPRESENTATIVE_INTENT_SHA256: &str =
    "7f51afa6736fab11266e6e95386c477a526c47233caf6f9638c8840295261961";

/// The content-addressed representative research authority.
///
/// Callers cannot deserialize or construct an alternative document:
///
/// ```compile_fail
/// use vibe_strategy_factory::RepresentativeResearchIntent;
///
/// let _: RepresentativeResearchIntent = serde_json::from_slice(b"{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResearchIntent {
    document: ResearchIntentDocument,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ResearchIntentDocument {
    identity: String,
    kind: String,
    payload: ResearchIntentPayload,
    revision: String,
    schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ResearchIntentPayload {
    admission: AdmissionSpec,
    authority: AuthoritySpec,
    components: Vec<String>,
    data: ResearchDataSpec,
    event_policy: EventPolicySpec,
    evidence: Vec<EvidenceSpec>,
    experiment_id: String,
    family: ResearchFamilySpec,
    non_claims: Vec<String>,
    predecessor: PredecessorSpec,
    program_contract: ProgramContractSpec,
    state_machine: StateMachineSpec,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ProgramContractSpec {
    custom_codecs: Vec<ProgramCodecSpec>,
    guest_provider_switches: String,
    host_provider_switches: String,
    parameter_layout: String,
    program_source_locator: String,
    runtime_profile: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ProgramCodecSpec {
    codec_id: String,
    payload_bytes: u32,
    record_type_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AdmissionSpec {
    formation: String,
    holdout: String,
    live: String,
    runtime: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AuthoritySpec {
    backtest: String,
    code: String,
    data: String,
    matching: String,
    portfolio: String,
    proposal: String,
    result: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ResearchDataSpec {
    channels: Vec<ObservationChannelSpec>,
    decision_clock_channel: String,
    frame_policy: FramePolicySpec,
    snapshot_semantics: String,
    unavailable_context: Vec<UnavailableContextSpec>,
    universe: UniverseSpec,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ObservationChannelSpec {
    asset_id: String,
    id: String,
    max_staleness_ns: String,
    owner_key: String,
    required: bool,
    role: String,
    source: String,
    timeframe: String,
}

impl ObservationChannelSpec {
    fn max_staleness_ns(&self) -> Result<u64, ResearchIntentError> {
        self.max_staleness_ns
            .parse::<u64>()
            .map_err(|_| ResearchIntentError::Binding("observation channel staleness"))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FramePolicySpec {
    duplicate_channel_timestamp: String,
    future_observation: String,
    input_clock: String,
    missing_observation: String,
    same_timestamp_order: String,
    stale_observation: String,
    value_custody: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct UnavailableContextSpec {
    asset_id: String,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct UniverseSpec {
    context_only: Vec<String>,
    tradable: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct EventPolicySpec {
    actual_and_consensus_surprise: String,
    archive_observation_semantics: String,
    events: Vec<EventSpec>,
    future_event_time_semantics: String,
    missing_or_unverified_schedule: String,
    mode: String,
    schedule_evidence: Vec<ScheduleEvidenceSpec>,
    timezone: String,
    transport_timestamp_semantics: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct EventSpec {
    evidence_ids: Vec<String>,
    id: String,
    post_blackout_ns: String,
    pre_blackout_ns: String,
    schedule_source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ScheduleEvidenceSpec {
    archive_timestamp: String,
    cdx_digest: String,
    id: String,
    raw_sha256: String,
    semantics: String,
    source_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct EvidenceSpec {
    id: String,
    locator: String,
    role: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ResearchFamilySpec {
    deletion_variants: Vec<String>,
    holdout_access: String,
    intent_rewrite_after_results: String,
    max_selectable_parameter_tuples: u32,
    parameter_family: ParameterFamilySpec,
    selection: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ParameterFamilySpec {
    projection: String,
    source_intent_sha256: String,
    source_locator: String,
    tuple_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PredecessorSpec {
    disposition: String,
    intent_sha256: String,
    locator: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StateMachineSpec {
    states: Vec<String>,
    terminal_invariants: Vec<String>,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ResearchIntentError {
    #[error("representative ResearchIntent is malformed: {0}")]
    Malformed(String),
    #[error("representative ResearchIntent binding mismatch: {0}")]
    Binding(&'static str),
}

impl ResearchIntent {
    /// Loads the one representative complex-strategy design authority.
    ///
    /// This intent is deliberately not formation- or execution-admitted. It freezes the upper
    /// contract before any multi-source market result or holdout partition is accessed.
    pub fn frozen_representative() -> Result<Self, ResearchIntentError> {
        let document = serde_json::from_slice(FROZEN_REPRESENTATIVE_INTENT_BYTES)
            .map_err(|e| ResearchIntentError::Malformed(e.to_string()))?;
        let intent = Self { document };
        intent.validate_canonical_encoding()?;
        intent.validate_invariants()?;
        Ok(intent)
    }

    pub fn identity(&self) -> &str {
        &self.document.identity
    }

    pub fn experiment_id(&self) -> &str {
        &self.document.payload.experiment_id
    }

    pub fn canonical_bytes(&self) -> &'static [u8] {
        FROZEN_REPRESENTATIVE_INTENT_BYTES
    }

    pub fn digest(&self) -> String {
        format!(
            "blake3:{}",
            blake3::hash(FROZEN_REPRESENTATIVE_INTENT_BYTES).to_hex()
        )
    }

    pub fn runtime_admission(&self) -> &str {
        &self.document.payload.admission.runtime
    }

    pub fn tradable_instruments(&self) -> &[String] {
        &self.document.payload.data.universe.tradable
    }

    pub fn context_only_assets(&self) -> &[String] {
        &self.document.payload.data.universe.context_only
    }

    pub fn unavailable_context(&self) -> impl Iterator<Item = (&str, &str)> {
        self.document
            .payload
            .data
            .unavailable_context
            .iter()
            .map(|context| (context.asset_id.as_str(), context.reason.as_str()))
    }

    pub fn deletion_variants(&self) -> &[String] {
        &self.document.payload.family.deletion_variants
    }

    pub(crate) fn formation_selection_policy(&self) -> &str {
        &self.document.payload.family.selection
    }

    pub(crate) fn parameter_family_authority(
        &self,
    ) -> Result<serde_json::Value, ResearchIntentError> {
        serde_json::to_value(&self.document.payload.family.parameter_family)
            .map_err(|e| ResearchIntentError::Malformed(e.to_string()))
    }

    pub(crate) fn evidence_references(&self) -> impl Iterator<Item = (&str, &str, &str)> {
        self.document.payload.evidence.iter().map(|evidence| {
            (
                evidence.id.as_str(),
                evidence.locator.as_str(),
                evidence.role.as_str(),
            )
        })
    }

    pub(crate) fn non_claims(&self) -> &[String] {
        &self.document.payload.non_claims
    }

    pub fn states(&self) -> &[String] {
        &self.document.payload.state_machine.states
    }

    pub(crate) fn max_staleness_ns(&self, channel_id: &str) -> Result<u64, ResearchIntentError> {
        self.document
            .payload
            .data
            .channels
            .iter()
            .find(|channel| channel.id == channel_id)
            .ok_or(ResearchIntentError::Binding("observation channel"))?
            .max_staleness_ns()
    }

    /// Classifies an instrument as a tradable research candidate.
    ///
    /// This is not order-routing or execution authority. The frozen representative intent keeps
    /// runtime admission explicitly closed, and context assets never become order-capable merely
    /// because their observations enter a frame.
    pub fn is_tradable_candidate(&self, instrument_id: &str) -> bool {
        self.document
            .payload
            .data
            .universe
            .tradable
            .iter()
            .any(|candidate| candidate == instrument_id)
    }

    pub fn observation_gate(&self) -> Result<ObservationFrameGate, ResearchIntentError> {
        self.validate_frozen_binding()?;
        ObservationFrameGate::new(self.clone())
    }

    /// Returns the frozen event-policy mode without evaluating an unowned calendar payload.
    pub fn economic_event_mode(&self) -> &str {
        &self.document.payload.event_policy.mode
    }

    /// Returns the fail-closed state used until an existing PIT calendar/Data owner is bound.
    pub fn unverified_event_schedule_disposition(&self) -> &str {
        &self
            .document
            .payload
            .event_policy
            .missing_or_unverified_schedule
    }

    /// Returns the admission state for actual/consensus surprise data.
    pub fn economic_surprise_admission(&self) -> &str {
        &self
            .document
            .payload
            .event_policy
            .actual_and_consensus_surprise
    }

    /// Lists the frozen blackout candidates and source locators.
    ///
    /// These values are policy, not a calendar snapshot or a claim that an event is currently
    /// inside or outside its window.
    pub fn economic_event_policies(&self) -> impl Iterator<Item = (&str, &str, &str, &str)> {
        self.document
            .payload
            .event_policy
            .events
            .iter()
            .map(|event| {
                (
                    event.id.as_str(),
                    event.schedule_source.as_str(),
                    event.pre_blackout_ns.as_str(),
                    event.post_blackout_ns.as_str(),
                )
            })
    }

    fn validate_frozen_binding(&self) -> Result<(), ResearchIntentError> {
        let frozen = Self::frozen_representative()?;
        if self != &frozen {
            return Err(ResearchIntentError::Binding("canonical frozen bytes"));
        }
        Ok(())
    }

    fn validate_canonical_encoding(&self) -> Result<(), ResearchIntentError> {
        let mut expected = serde_json::to_vec(&self.document)
            .map_err(|e| ResearchIntentError::Malformed(e.to_string()))?;
        expected.push(b'\n');
        if expected != FROZEN_REPRESENTATIVE_INTENT_BYTES {
            return Err(ResearchIntentError::Binding("canonical JCS encoding"));
        }
        Ok(())
    }

    fn validate_invariants(&self) -> Result<(), ResearchIntentError> {
        if format!("{:x}", Sha256::digest(FROZEN_REPRESENTATIVE_INTENT_BYTES))
            != REPRESENTATIVE_INTENT_SHA256
        {
            return Err(ResearchIntentError::Binding("frozen content digest"));
        }

        if self.document.identity != REPRESENTATIVE_INTENT_ID
            || self.document.kind != "ResearchIntent"
            || self.document.revision != "4"
            || self.document.schema_version != 7
            || self.document.payload.experiment_id != REPRESENTATIVE_EXPERIMENT_ID
        {
            return Err(ResearchIntentError::Binding("identity/revision/schema"));
        }

        let admission = &self.document.payload.admission;
        if admission.formation != "NOT_ADMITTED_SOFTWARE_CONTROL_ONLY"
            || admission.holdout != "NOT_ADMITTED_NO_PHYSICAL_CUSTODY_OR_UNSEEN_PARTITION"
            || admission.live != "FORBIDDEN"
            || admission.runtime != "PROGRAM_FIRST_REPRESENTATIVE_SOFTWARE_CONTROL_ONLY"
        {
            return Err(ResearchIntentError::Binding("admission boundary"));
        }

        let authority = &self.document.payload.authority;
        if authority.backtest != "existing_vibe_backtest_owner"
            || authority.code != "qOeOp_trade_strategy_factory"
            || authority.data != "existing_vibe_data_owner"
            || authority.matching != "existing_vibe_matching_owner"
            || authority.portfolio != "existing_vibe_portfolio_owner"
            || authority.proposal
                != "OpenClaw_or_LLM_sourced_candidate_only_no_code_result_qualification_or_execution_authority"
            || authority.result != "StrategyFactory_authoritative_receipts_only"
        {
            return Err(ResearchIntentError::Binding("owner authority"));
        }

        if self.document.payload.components
            != [
                "market_regime",
                "cross_asset_context",
                "market_session_context",
                "economic_event_blackout",
                "multi_timeframe_structure",
                "setup_and_candle_trigger",
                "pending_order_management",
                "position_management",
                "portfolio_risk_budget",
            ]
        {
            return Err(ResearchIntentError::Binding("component shape"));
        }

        let program = &self.document.payload.program_contract;
        if program.guest_provider_switches != "forbidden"
            || program.host_provider_switches != "forbidden"
            || program.parameter_layout != "representative-172-v2"
            || program.program_source_locator != "crates/strategy_factory/programs/complex"
            || program.runtime_profile != "strategy-program-v1"
            || program
                .custom_codecs
                .iter()
                .map(|codec| {
                    (
                        codec.codec_id.as_str(),
                        codec.payload_bytes,
                        codec.record_type_id,
                    )
                })
                .ne([
                    ("fred-decimal-f64-le-v1", 8, 1_024),
                    ("scheduled-event-kind-and-target-u64-le-v1", 16, 1_025),
                    ("session-mask-u8-v1", 8, 1_026),
                ])
        {
            return Err(ResearchIntentError::Binding("program input contract"));
        }

        let data = &self.document.payload.data;
        if data.snapshot_semantics != "point_in_time_observed_at_and_available_at"
            || data.decision_clock_channel != "btc_m15"
            || data.universe.tradable != ["BTCUSDT-PERP.BINANCE", "ETHUSDT-PERP.BINANCE"]
            || data.universe.context_only
                != [
                    "FED:DTWEXBGS",
                    "FED:DEXJPUS",
                    "EIA:DCOILWTICO",
                    "FRED:DGS2",
                    "FRED:DGS10",
                    "PAXGUSDT.BINANCE",
                ]
        {
            return Err(ResearchIntentError::Binding("universe and decision clock"));
        }

        let tradable = data
            .universe
            .tradable
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        let context_only = data
            .universe
            .context_only
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();

        if tradable.len() != data.universe.tradable.len()
            || context_only.len() != data.universe.context_only.len()
            || !tradable.is_disjoint(&context_only)
        {
            return Err(ResearchIntentError::Binding("disjoint order authority"));
        }

        let expected_channels = [
            (
                "broad_usd_d1",
                "FED:DTWEXBGS",
                "D1",
                864_000_000_000_000_u64,
                "FED:DTWEXBGS",
            ),
            (
                "btc_d1",
                "BTCUSDT-PERP.BINANCE",
                "D1",
                86_400_000_000_000,
                "BTCUSDT-PERP.BINANCE-1-DAY-LAST-EXTERNAL",
            ),
            (
                "btc_h1",
                "BTCUSDT-PERP.BINANCE",
                "H1",
                3_600_000_000_000,
                "BTCUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL",
            ),
            (
                "btc_h4",
                "BTCUSDT-PERP.BINANCE",
                "H4",
                14_400_000_000_000,
                "BTCUSDT-PERP.BINANCE-4-HOUR-LAST-EXTERNAL",
            ),
            (
                "btc_m15",
                "BTCUSDT-PERP.BINANCE",
                "M15",
                0,
                "BTCUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL",
            ),
            (
                "eth_d1",
                "ETHUSDT-PERP.BINANCE",
                "D1",
                86_400_000_000_000,
                "ETHUSDT-PERP.BINANCE-1-DAY-LAST-EXTERNAL",
            ),
            (
                "eth_h1",
                "ETHUSDT-PERP.BINANCE",
                "H1",
                3_600_000_000_000,
                "ETHUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL",
            ),
            (
                "eth_h4",
                "ETHUSDT-PERP.BINANCE",
                "H4",
                14_400_000_000_000,
                "ETHUSDT-PERP.BINANCE-4-HOUR-LAST-EXTERNAL",
            ),
            (
                "eth_m15",
                "ETHUSDT-PERP.BINANCE",
                "M15",
                0,
                "ETHUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL",
            ),
            (
                "paxg_d1",
                "PAXGUSDT.BINANCE",
                "D1",
                86_400_000_000_000,
                "PAXGUSDT.BINANCE-1-DAY-LAST-EXTERNAL",
            ),
            (
                "us10y_d1",
                "FRED:DGS10",
                "D1",
                432_000_000_000_000,
                "FRED:DGS10",
            ),
            (
                "us2y_d1",
                "FRED:DGS2",
                "D1",
                432_000_000_000_000,
                "FRED:DGS2",
            ),
            (
                "usdjpy_d1",
                "FED:DEXJPUS",
                "D1",
                864_000_000_000_000,
                "FED:DEXJPUS",
            ),
            (
                "wti_d1",
                "EIA:DCOILWTICO",
                "D1",
                432_000_000_000_000,
                "EIA:DCOILWTICO",
            ),
        ];

        if data.channels.len() != expected_channels.len() {
            return Err(ResearchIntentError::Binding("observation channels"));
        }
        let mut channel_ids = BTreeSet::new();
        for (channel, expected) in data.channels.iter().zip(expected_channels) {
            if !channel_ids.insert(channel.id.as_str())
                || !channel.required
                || (
                    channel.id.as_str(),
                    channel.asset_id.as_str(),
                    channel.timeframe.as_str(),
                    channel.max_staleness_ns()?,
                    channel.owner_key.as_str(),
                ) != expected
                || (!tradable.contains(channel.asset_id.as_str())
                    && !context_only.contains(channel.asset_id.as_str()))
            {
                return Err(ResearchIntentError::Binding("observation channels"));
            }
        }
        let usdjpy = data
            .channels
            .iter()
            .find(|channel| channel.id == "usdjpy_d1")
            .ok_or(ResearchIntentError::Binding("USDJPY semantics"))?;

        if usdjpy.asset_id != "FED:DEXJPUS"
            || usdjpy.source != "Federal_Reserve_H10_via_FRED_or_ALFRED"
            || usdjpy.role
                != "yen_per_usd_prior_completed_daily_return_direction_confirmation_not_yen_index"
        {
            return Err(ResearchIntentError::Binding("USDJPY semantics"));
        }

        let paxg = data
            .channels
            .iter()
            .find(|channel| channel.id == "paxg_d1")
            .ok_or(ResearchIntentError::Binding("PAXG proxy semantics"))?;

        if paxg.asset_id != "PAXGUSDT.BINANCE"
            || paxg.source != "Binance_spot_public_klines_checksum_archives"
            || paxg.role != "tokenized_gold_proxy_not_spot_gold"
            || tradable.contains(paxg.asset_id.as_str())
        {
            return Err(ResearchIntentError::Binding("PAXG proxy semantics"));
        }

        let frame = &data.frame_policy;
        if frame.duplicate_channel_timestamp != "reject"
            || frame.future_observation != "ineligible_no_order"
            || frame.input_clock != "nondecreasing_available_at"
            || frame.missing_observation != "ineligible_no_order"
            || frame.same_timestamp_order != "irrelevant_after_strictly_greater_watermark"
            || frame.stale_observation != "ineligible_no_order"
            || frame.value_custody
                != "existing_data_indicator_and_portfolio_owners_not_observation_gate"
        {
            return Err(ResearchIntentError::Binding("observation frame policy"));
        }

        if data.unavailable_context
            != [UnavailableContextSpec {
                asset_id: "ICE:DXY".to_string(),
                reason: "licensed_ICE_DXY_source_not_selected".to_string(),
            }]
        {
            return Err(ResearchIntentError::Binding("unavailable context"));
        }

        let event = &self.document.payload.event_policy;
        if event.actual_and_consensus_surprise != "NOT_ADMITTED_NO_PIT_CONSENSUS_SOURCE"
            || event.archive_observation_semantics
                != "THIRD_PARTY_ARCHIVE_OBSERVED_NO_LATER_THAN_CAPTURE_TIMESTAMP_NOT_PUBLISHER_SIGNATURE_OR_SYSTEM_INGESTION"
            || event.future_event_time_semantics
                != "PAYLOAD_SCHEDULED_FOR_ONLY_NOT_TRANSPORT_EVENT_TIME"
            || event.missing_or_unverified_schedule != "INELIGIBLE_NO_ORDER"
            || event.mode != "BLACKOUT_ONLY_NO_DIRECTIONAL_EVENT_BET"
            || event.timezone != "America/New_York"
            || event.transport_timestamp_semantics
                != "TS_EVENT_AND_AVAILABLE_AT_EQUAL_ARCHIVE_OBSERVED_AT"
            || event.events.len() != 3
            || event.events.iter().any(|candidate| {
                candidate.pre_blackout_ns != "3600000000000"
                    || candidate.post_blackout_ns != "3600000000000"
            })
            || event
                .events
                .iter()
                .map(|candidate| candidate.id.as_str())
                .collect::<Vec<_>>()
                != ["CPI", "FOMC_STATEMENT", "EMPLOYMENT_SITUATION"]
            || event.events[0].evidence_ids != ["bls-2023-schedule-pre-event"]
            || event.events[1].evidence_ids
                != [
                    "fed-2023-calendar-pre-event",
                    "fed-scheduled-statement-time-rule-pre-event",
                ]
            || event.events[2].evidence_ids != ["bls-2023-schedule-pre-event"]
            || event.schedule_evidence.len() != 3
            || event.schedule_evidence.iter().any(|evidence| {
                evidence.archive_timestamp.len() != 14
                    || evidence.cdx_digest.is_empty()
                    || !evidence.raw_sha256.starts_with("sha256:")
                    || !evidence.source_url.starts_with("https://")
                    || !evidence
                        .semantics
                        .starts_with("pre_2023_third_party_archive_")
            })
            || event
                .schedule_evidence
                .iter()
                .map(|evidence| evidence.id.as_str())
                .ne([
                    "bls-2023-schedule-pre-event",
                    "fed-2023-calendar-pre-event",
                    "fed-scheduled-statement-time-rule-pre-event",
                ])
        {
            return Err(ResearchIntentError::Binding("economic event policy"));
        }

        let family = &self.document.payload.family;
        if family.deletion_variants
            != [
                "full",
                "price-only",
                "without-cross-asset",
                "without-gold",
                "without-events",
                "without-sessions",
                "without-multi-timeframe",
                "without-structure",
                "without-dynamic-order",
                "without-dynamic-position",
            ]
            || family.holdout_access
                != "forbidden_until_source_manifest_formation_receipt_and_custody_are_authoritative"
            || family.intent_rewrite_after_results != "forbidden"
            || family.max_selectable_parameter_tuples != 4
            || family.parameter_family.projection
                != "exact_four_tuple_period_threshold_and_risk_fields"
            || family.parameter_family.source_intent_sha256
                != "sha256:3736e58adec8c2541cd02f19e0a43558121bc3c4656b13ed655e728dbeea14eb"
            || family.parameter_family.source_locator
                != "crates/strategy_factory/assets/complex_intent_v4.jcs"
            || family.parameter_family.tuple_ids
                != ["tuple-001", "tuple-002", "tuple-003", "tuple-004"]
            || format!("sha256:{:x}", Sha256::digest(PRICE_PARAMETER_FAMILY_BYTES))
                != family.parameter_family.source_intent_sha256
            || family.selection
                != "full_must_pass_cost_and_risk_floors_and_strictly_beat_every_deletion_or_delete_the_noncontributing_surface"
        {
            return Err(ResearchIntentError::Binding("bounded family and deletions"));
        }

        if self.document.payload.predecessor.disposition
            != "REPRESENTATIVE_V3_SUPERSEDED_SOURCE_TEMPORAL_AUTHORITY_CORRECTION_BEFORE_RESULTS"
            || self.document.payload.predecessor.intent_sha256
                != "sha256:b8dc3a9b68745b5203b24d86805c9a8a64a6b26f5e5e36ab670d220541d6469f"
            || self.document.payload.predecessor.locator
                != "crates/strategy_factory/assets/representative_intent_v3.jcs"
            || format!(
                "sha256:{:x}",
                Sha256::digest(PREDECESSOR_REPRESENTATIVE_INTENT_BYTES)
            ) != self.document.payload.predecessor.intent_sha256
        {
            return Err(ResearchIntentError::Binding("representative predecessor"));
        }

        if self.document.payload.state_machine.states
            != [
                "OBSERVING",
                "ELIGIBLE",
                "SETUP",
                "PENDING_ORDER",
                "POSITION",
                "PROTECT",
                "EXIT",
            ]
            || self.document.payload.state_machine.terminal_invariants
                != [
                    "context_only_assets_never_have_order_authority",
                    "missing_stale_future_or_unverified_context_cannot_open_risk",
                    "entry_thesis_is_revalidated_before_submit_modify_or_keep",
                    "exit_and_cancel_are_allowed_when_entry_is_ineligible",
                    "portfolio_owner_is_final_risk_budget_authority",
                ]
        {
            return Err(ResearchIntentError::Binding("research state machine"));
        }

        if self.document.payload.non_claims
            != [
                "alpha",
                "profitability",
                "formation_survival",
                "qualification",
                "live_eligibility",
                "execution_authority",
                "ice_dxy_equivalence",
                "spot_gold_equivalence",
                "paxgusdt_price_tracking",
                "paxgusdt_pit_custody",
                "paxgusdt_liquidity_or_redeemability",
                "publisher_signature",
                "contemporaneous_system_ingestion",
                "automated_calendar_capture",
                "unscheduled_fomc_coverage",
                "calendar_redistribution_license",
            ]
            || self.document.payload.evidence.len() != 7
            || self.document.payload.evidence.last()
                != Some(&EvidenceSpec {
                    id: "paxos-paxg-backing".to_string(),
                    locator: "https://docs.paxos.com/guides/stablecoin/paxg".to_string(),
                    role:
                        "official_one_fine_troy_ounce_backing_semantics_not_spot_price_equivalence"
                            .to_string(),
                })
        {
            return Err(ResearchIntentError::Binding("evidence and non-claims"));
        }
        Ok(())
    }
}

/// A time-only projection from a caller-supplied native [`Bar`].
///
/// The native type and frozen key are checked, but this projection does not prove Data-owner
/// provenance or PIT custody. Formation remains closed until a content-addressed multi-source
/// manifest is verified. Callers cannot construct one from raw strings or deserialize one:
///
/// ```compile_fail
/// use vibe_strategy_factory::ObservationStamp;
///
/// let _ = ObservationStamp::from_owner_bytes("channel", "owner", 1, 1, b"self reported");
/// ```
///
/// ```compile_fail
/// use vibe_strategy_factory::ObservationStamp;
///
/// let _: ObservationStamp = serde_json::from_slice(b"{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ObservationStamp {
    available_at_ns: u64,
    channel_id: String,
    content_digest: String,
    observed_at_ns: u64,
    owner_key: String,
}

impl ObservationStamp {
    #[cfg(test)]
    fn from_test_owner_bytes(
        channel_id: impl Into<String>,
        owner_key: impl Into<String>,
        observed_at_ns: u64,
        available_at_ns: u64,
        owner_bytes: &[u8],
    ) -> Result<Self, ObservationFrameError> {
        if owner_bytes.is_empty() {
            return Err(ObservationFrameError::EmptyOwnerProjection);
        }

        if observed_at_ns > available_at_ns {
            return Err(ObservationFrameError::ObservedAfterAvailability {
                observed_at_ns,
                available_at_ns,
            });
        }
        Ok(Self {
            available_at_ns,
            channel_id: channel_id.into(),
            content_digest: format!("blake3:{}", blake3::hash(owner_bytes).to_hex()),
            observed_at_ns,
            owner_key: owner_key.into(),
        })
    }

    /// Projects a caller-supplied native [`Bar`] for temporal validation only.
    ///
    /// This method does not attest where the bar came from. Its explicit name prevents consumers
    /// from treating a well-typed value object as Data-owner provenance.
    pub fn from_untrusted_bar(
        channel_id: impl Into<String>,
        bar: &Bar,
    ) -> Result<Self, ObservationFrameError> {
        let channel_id = channel_id.into();
        let owner_key = bar.bar_type.to_string();
        let observed_at_ns = bar.ts_event.as_u64();
        let available_at_ns = bar.ts_init.as_u64();
        if observed_at_ns > available_at_ns {
            return Err(ObservationFrameError::ObservedAfterAvailability {
                observed_at_ns,
                available_at_ns,
            });
        }
        let bytes = serde_json::to_vec(bar)
            .map_err(|e| ObservationFrameError::Serialization(e.to_string()))?;
        Ok(Self {
            available_at_ns,
            channel_id,
            content_digest: format!("blake3:{}", blake3::hash(&bytes).to_hex()),
            observed_at_ns,
            owner_key,
        })
    }

    pub fn channel_id(&self) -> &str {
        &self.channel_id
    }

    pub const fn observed_at_ns(&self) -> u64 {
        self.observed_at_ns
    }

    pub const fn available_at_ns(&self) -> u64 {
        self.available_at_ns
    }

    pub fn content_digest(&self) -> &str {
        &self.content_digest
    }

    /// Returns the data-key declared by the caller-supplied value object.
    /// This is an identifier, not provenance evidence.
    pub fn declared_data_key(&self) -> &str {
        &self.owner_key
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ObservationFrameDisposition {
    /// Every frozen channel is temporally present and fresh, but source provenance is unverified.
    ///
    /// This does not prove source authenticity, formation, strategy, order, or live eligibility.
    TemporallyCompleteUnverified,
    /// At least one frozen channel is missing or stale.
    Incomplete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "reason", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ObservationFrameIneligibility {
    Missing {
        channel_id: String,
    },
    Stale {
        age_ns: u64,
        channel_id: String,
        max_staleness_ns: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct ObservationFrameBody {
    decision_time_ns: u64,
    disposition: ObservationFrameDisposition,
    ineligibility: Vec<ObservationFrameIneligibility>,
    intent_digest: String,
    observations: Vec<ObservationStamp>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservationFrame {
    body: ObservationFrameBody,
    canonical_bytes: Vec<u8>,
    frame_digest: String,
}

impl ObservationFrame {
    pub const fn decision_time_ns(&self) -> u64 {
        self.body.decision_time_ns
    }

    pub const fn disposition(&self) -> ObservationFrameDisposition {
        self.body.disposition
    }

    pub fn ineligibility(&self) -> &[ObservationFrameIneligibility] {
        &self.body.ineligibility
    }

    pub fn observations(&self) -> &[ObservationStamp] {
        &self.body.observations
    }

    pub fn intent_digest(&self) -> &str {
        &self.body.intent_digest
    }

    pub fn frame_digest(&self) -> &str {
        &self.frame_digest
    }

    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    /// This temporal projection never claims source provenance.
    pub const fn source_provenance_verified(&self) -> bool {
        false
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ObservationFrameError {
    #[error(transparent)]
    Intent(#[from] ResearchIntentError),
    #[error("unknown observation channel: {0}")]
    UnknownChannel(String),
    #[error(
        "observation declared data key mismatch for channel {channel_id}: expected {expected}, observed {observed}"
    )]
    DeclaredDataKeyMismatch {
        channel_id: String,
        expected: String,
        observed: String,
    },
    #[error(
        "observation was observed after it became available: observed={observed_at_ns}, available={available_at_ns}"
    )]
    ObservedAfterAvailability {
        observed_at_ns: u64,
        available_at_ns: u64,
    },
    #[error("owner projection bytes are empty")]
    EmptyOwnerProjection,
    #[error("observation clock regressed: previous={previous_ns}, next={next_ns}")]
    ClockRegression { previous_ns: u64, next_ns: u64 },
    #[error("duplicate observation for channel {channel_id} at {available_at_ns}")]
    DuplicateChannelTimestamp {
        channel_id: String,
        available_at_ns: u64,
    },
    #[error("a second decision clock arrived before the first was sealed")]
    PendingDecisionConflict,
    #[error("observation frame gate is already finished")]
    Finished,
    #[error("observation frame serialization failed: {0}")]
    Serialization(String),
}

#[derive(Debug, Clone)]
pub struct ObservationFrameGate {
    intent: ResearchIntent,
    channels: BTreeMap<String, ObservationChannelSpec>,
    latest: BTreeMap<String, ObservationStamp>,
    pending_decision_ns: Option<u64>,
    watermark_ns: Option<u64>,
    finished: bool,
}

impl ObservationFrameGate {
    fn new(intent: ResearchIntent) -> Result<Self, ResearchIntentError> {
        let channels = intent
            .document
            .payload
            .data
            .channels
            .iter()
            .cloned()
            .map(|channel| (channel.id.clone(), channel))
            .collect::<BTreeMap<_, _>>();

        if channels.len() != intent.document.payload.data.channels.len() {
            return Err(ResearchIntentError::Binding("observation channels"));
        }
        Ok(Self {
            intent,
            channels,
            latest: BTreeMap::new(),
            pending_decision_ns: None,
            watermark_ns: None,
            finished: false,
        })
    }

    /// Ingests one timestamp projection from an existing owner.
    ///
    /// When this update advances beyond a pending decision time, the prior frame is sealed before
    /// the new observation is retained. Therefore an observation from the future cannot leak into
    /// the earlier decision.
    pub fn ingest(
        &mut self,
        observation: ObservationStamp,
    ) -> Result<Option<ObservationFrame>, ObservationFrameError> {
        if self.finished {
            return Err(ObservationFrameError::Finished);
        }
        let channel = self
            .channels
            .get(observation.channel_id())
            .ok_or_else(|| ObservationFrameError::UnknownChannel(observation.channel_id.clone()))?;

        if observation.owner_key != channel.owner_key {
            return Err(ObservationFrameError::DeclaredDataKeyMismatch {
                channel_id: observation.channel_id,
                expected: channel.owner_key.clone(),
                observed: observation.owner_key,
            });
        }

        if observation.observed_at_ns > observation.available_at_ns {
            return Err(ObservationFrameError::ObservedAfterAvailability {
                observed_at_ns: observation.observed_at_ns,
                available_at_ns: observation.available_at_ns,
            });
        }

        if let Some(watermark_ns) = self.watermark_ns
            && observation.available_at_ns < watermark_ns
        {
            return Err(ObservationFrameError::ClockRegression {
                previous_ns: watermark_ns,
                next_ns: observation.available_at_ns,
            });
        }

        if let Some(previous) = self.latest.get(observation.channel_id()) {
            if observation.available_at_ns < previous.available_at_ns {
                return Err(ObservationFrameError::ClockRegression {
                    previous_ns: previous.available_at_ns,
                    next_ns: observation.available_at_ns,
                });
            }

            if observation.available_at_ns == previous.available_at_ns {
                return Err(ObservationFrameError::DuplicateChannelTimestamp {
                    channel_id: observation.channel_id,
                    available_at_ns: observation.available_at_ns,
                });
            }
        }

        let frame = self.advance_watermark(observation.available_at_ns)?;
        let is_decision_clock =
            observation.channel_id == self.intent.document.payload.data.decision_clock_channel;
        let observation_time = observation.available_at_ns;
        self.latest
            .insert(observation.channel_id.clone(), observation);

        if is_decision_clock {
            if self.pending_decision_ns.is_some() {
                return Err(ObservationFrameError::PendingDecisionConflict);
            }
            self.pending_decision_ns = Some(observation_time);
        }
        Ok(frame)
    }

    /// Declares that no later owner callback can arrive below `watermark_ns`.
    /// A decision at exactly the watermark remains open so all equal-timestamp streams can arrive.
    pub fn advance_watermark(
        &mut self,
        watermark_ns: u64,
    ) -> Result<Option<ObservationFrame>, ObservationFrameError> {
        if self.finished {
            return Err(ObservationFrameError::Finished);
        }

        if let Some(previous_ns) = self.watermark_ns
            && watermark_ns < previous_ns
        {
            return Err(ObservationFrameError::ClockRegression {
                previous_ns,
                next_ns: watermark_ns,
            });
        }
        let frame = match self.pending_decision_ns {
            Some(decision_ns) if watermark_ns > decision_ns => {
                self.pending_decision_ns = None;
                Some(self.seal(decision_ns)?)
            }
            _ => None,
        };
        self.watermark_ns = Some(watermark_ns);
        Ok(frame)
    }

    /// Seals a final pending frame at the existing replay owner's end-of-stream boundary.
    pub fn finish(&mut self) -> Result<Option<ObservationFrame>, ObservationFrameError> {
        if self.finished {
            return Err(ObservationFrameError::Finished);
        }
        self.finished = true;

        match self.pending_decision_ns.take() {
            Some(decision_ns) => self.seal(decision_ns).map(Some),
            None => Ok(None),
        }
    }

    /// Deterministically recovers frame output by replaying the same owner observations.
    /// No second checkpoint store or mutable research ledger is introduced.
    pub fn replay<I>(
        intent: &ResearchIntent,
        observations: I,
    ) -> Result<Vec<ObservationFrame>, ObservationFrameError>
    where
        I: IntoIterator<Item = ObservationStamp>,
    {
        let mut gate = intent.observation_gate()?;
        let mut frames = Vec::new();

        for observation in observations {
            if let Some(frame) = gate.ingest(observation)? {
                frames.push(frame);
            }
        }

        if let Some(frame) = gate.finish()? {
            frames.push(frame);
        }
        Ok(frames)
    }

    fn seal(&self, decision_time_ns: u64) -> Result<ObservationFrame, ObservationFrameError> {
        let mut observations = Vec::new();
        let mut ineligibility = Vec::new();

        for channel in self.channels.values().filter(|channel| channel.required) {
            match self.latest.get(&channel.id) {
                Some(observation) if observation.available_at_ns <= decision_time_ns => {
                    let age_ns = decision_time_ns - observation.observed_at_ns;
                    let max_staleness_ns = channel.max_staleness_ns()?;
                    if age_ns > max_staleness_ns {
                        ineligibility.push(ObservationFrameIneligibility::Stale {
                            age_ns,
                            channel_id: channel.id.clone(),
                            max_staleness_ns,
                        });
                    }
                    observations.push(observation.clone());
                }
                _ => ineligibility.push(ObservationFrameIneligibility::Missing {
                    channel_id: channel.id.clone(),
                }),
            }
        }

        let disposition = if ineligibility.is_empty() {
            ObservationFrameDisposition::TemporallyCompleteUnverified
        } else {
            ObservationFrameDisposition::Incomplete
        };
        let body = ObservationFrameBody {
            decision_time_ns,
            disposition,
            ineligibility,
            intent_digest: self.intent.digest(),
            observations,
        };
        let bytes = serde_json::to_vec(&body)
            .map_err(|e| ObservationFrameError::Serialization(e.to_string()))?;
        Ok(ObservationFrame {
            body,
            canonical_bytes: bytes.clone(),
            frame_digest: format!("blake3:{}", blake3::hash(&bytes).to_hex()),
        })
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    const DECISION_NS: u64 = 2_000_000_000_000_000_000;

    fn stamp(intent: &ResearchIntent, channel_id: &str, available_at_ns: u64) -> ObservationStamp {
        let owner_key = intent
            .document
            .payload
            .data
            .channels
            .iter()
            .find(|channel| channel.id == channel_id)
            .unwrap()
            .owner_key
            .as_str();
        ObservationStamp::from_test_owner_bytes(
            channel_id,
            owner_key,
            available_at_ns,
            available_at_ns,
            channel_id.as_bytes(),
        )
        .unwrap()
    }

    fn complete_observations(
        intent: &ResearchIntent,
        decision_first: bool,
    ) -> Vec<ObservationStamp> {
        let mut ids = intent
            .document
            .payload
            .data
            .channels
            .iter()
            .map(|channel| channel.id.as_str())
            .collect::<Vec<_>>();
        ids.retain(|channel| *channel != "btc_m15");
        if decision_first {
            ids.insert(0, "btc_m15");
        } else {
            ids.push("btc_m15");
        }
        ids.into_iter()
            .map(|channel| stamp(intent, channel, DECISION_NS))
            .collect()
    }

    #[rstest]
    fn frozen_representative_intent_binds_software_control_only() {
        let intent = ResearchIntent::frozen_representative().unwrap();
        assert_eq!(intent.identity(), REPRESENTATIVE_INTENT_ID);
        assert_eq!(intent.experiment_id(), REPRESENTATIVE_EXPERIMENT_ID);
        assert_eq!(
            intent.runtime_admission(),
            "PROGRAM_FIRST_REPRESENTATIVE_SOFTWARE_CONTROL_ONLY"
        );
        assert_eq!(intent.tradable_instruments().len(), 2);
        assert_eq!(intent.context_only_assets().len(), 6);
        assert_eq!(intent.deletion_variants().len(), 10);
        assert_eq!(intent.states().len(), 7);
        assert!(!intent.is_tradable_candidate("FED:DTWEXBGS"));
        assert!(!intent.is_tradable_candidate("ICE:DXY"));
        assert!(intent.is_tradable_candidate("BTCUSDT-PERP.BINANCE"));
        assert!(!intent.is_tradable_candidate("PAXGUSDT.BINANCE"));
        assert_eq!(intent.unavailable_context().count(), 1);
    }

    #[rstest]
    fn equal_timestamp_stream_order_cannot_change_the_frame() {
        let intent = ResearchIntent::frozen_representative().unwrap();
        let first =
            ObservationFrameGate::replay(&intent, complete_observations(&intent, true)).unwrap();
        let second =
            ObservationFrameGate::replay(&intent, complete_observations(&intent, false)).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.len(), 1);
        assert_eq!(
            first[0].disposition(),
            ObservationFrameDisposition::TemporallyCompleteUnverified
        );
        assert_eq!(first[0].observations().len(), 14);
    }

    #[rstest]
    fn missing_and_stale_context_fail_closed_without_order_authority() {
        let intent = ResearchIntent::frozen_representative().unwrap();
        let mut missing = complete_observations(&intent, false);
        missing.retain(|observation| observation.channel_id() != "paxg_d1");
        let missing_frame = ObservationFrameGate::replay(&intent, missing)
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(
            missing_frame.disposition(),
            ObservationFrameDisposition::Incomplete
        );
        assert_eq!(
            missing_frame.ineligibility(),
            &[ObservationFrameIneligibility::Missing {
                channel_id: "paxg_d1".to_string(),
            }]
        );

        let mut stale = complete_observations(&intent, false);
        let old = DECISION_NS - 86_400_000_000_001;
        stale.retain(|observation| observation.channel_id() != "paxg_d1");
        stale.insert(0, stamp(&intent, "paxg_d1", old));
        let stale_frame = ObservationFrameGate::replay(&intent, stale)
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(
            stale_frame.disposition(),
            ObservationFrameDisposition::Incomplete
        );
        assert_eq!(
            stale_frame.ineligibility(),
            &[ObservationFrameIneligibility::Stale {
                age_ns: 86_400_000_000_001,
                channel_id: "paxg_d1".to_string(),
                max_staleness_ns: 86_400_000_000_000,
            }]
        );
        assert!(!intent.is_tradable_candidate("PAXGUSDT.BINANCE"));

        let mut future = complete_observations(&intent, false);
        future.retain(|observation| observation.channel_id() != "paxg_d1");
        future.push(stamp(&intent, "paxg_d1", DECISION_NS + 1));
        let future_frame = ObservationFrameGate::replay(&intent, future)
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(
            future_frame.ineligibility(),
            &[ObservationFrameIneligibility::Missing {
                channel_id: "paxg_d1".to_string(),
            }]
        );
    }

    #[rstest]
    fn unknown_duplicate_and_regressing_inputs_are_rejected() {
        let intent = ResearchIntent::frozen_representative().unwrap();
        assert_eq!(
            ObservationStamp::from_test_owner_bytes(
                "btc_m15",
                "BTCUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL",
                DECISION_NS,
                DECISION_NS,
                b"",
            )
            .unwrap_err(),
            ObservationFrameError::EmptyOwnerProjection
        );
        let mut gate = intent.observation_gate().unwrap();
        assert_eq!(
            gate.ingest(
                ObservationStamp::from_test_owner_bytes(
                    "xauusd_d1",
                    "XAUUSD.SIM",
                    DECISION_NS,
                    DECISION_NS,
                    b"gold",
                )
                .unwrap()
            )
            .unwrap_err(),
            ObservationFrameError::UnknownChannel("xauusd_d1".to_string())
        );
        assert_eq!(
            gate.ingest(
                ObservationStamp::from_test_owner_bytes(
                    "btc_m15",
                    "ETHUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL",
                    DECISION_NS,
                    DECISION_NS,
                    b"mislabeled",
                )
                .unwrap(),
            )
            .unwrap_err(),
            ObservationFrameError::DeclaredDataKeyMismatch {
                channel_id: "btc_m15".to_string(),
                expected: "BTCUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL".to_string(),
                observed: "ETHUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL".to_string(),
            }
        );
        gate.ingest(stamp(&intent, "eth_m15", DECISION_NS)).unwrap();
        assert_eq!(
            gate.ingest(stamp(&intent, "eth_m15", DECISION_NS))
                .unwrap_err(),
            ObservationFrameError::DuplicateChannelTimestamp {
                channel_id: "eth_m15".to_string(),
                available_at_ns: DECISION_NS,
            }
        );
        assert_eq!(
            gate.ingest(stamp(&intent, "eth_h1", DECISION_NS - 1))
                .unwrap_err(),
            ObservationFrameError::ClockRegression {
                previous_ns: DECISION_NS,
                next_ns: DECISION_NS - 1,
            }
        );
    }

    #[rstest]
    fn replay_recovery_reproduces_the_exact_frame_digest() {
        let intent = ResearchIntent::frozen_representative().unwrap();
        let observations = complete_observations(&intent, true);
        let first = ObservationFrameGate::replay(&intent, observations.clone()).unwrap();
        let recovered = ObservationFrameGate::replay(&intent, observations).unwrap();
        assert_eq!(first, recovered);
        assert_eq!(first[0].frame_digest(), recovered[0].frame_digest());
        assert_eq!(first[0].canonical_bytes(), recovered[0].canonical_bytes());
        assert_eq!(first[0].intent_digest(), intent.digest());
    }

    #[rstest]
    fn economic_calendar_freezes_pre_event_archive_authority_before_owner_execution() {
        let intent = ResearchIntent::frozen_representative().unwrap();
        assert_eq!(
            intent.economic_event_mode(),
            "BLACKOUT_ONLY_NO_DIRECTIONAL_EVENT_BET"
        );
        assert_eq!(
            intent.unverified_event_schedule_disposition(),
            "INELIGIBLE_NO_ORDER"
        );
        assert_eq!(
            intent.economic_surprise_admission(),
            "NOT_ADMITTED_NO_PIT_CONSENSUS_SOURCE"
        );
        assert_eq!(
            intent
                .economic_event_policies()
                .map(|(event_id, _, _, _)| event_id)
                .collect::<Vec<_>>(),
            ["CPI", "FOMC_STATEMENT", "EMPLOYMENT_SITUATION"]
        );
    }
}
