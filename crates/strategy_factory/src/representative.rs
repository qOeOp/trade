use std::{collections::BTreeMap, path::Path, str::FromStr, sync::Arc};

use anyhow::Context;
use jiff::Timestamp;
use rust_decimal::prelude::ToPrimitive;
use strategy_factory_program_sdk::ProgramRunScope;
use vibe_common::signal::Signal;
use vibe_fred::{AlfredPlan, AlfredQuery, FredObservation, open_custodied as open_alfred};
use vibe_model::{
    data::{BarType, CustomData, DataType, HasTsInit},
    identifiers::{InstrumentId, StrategyId},
    types::Money,
};
use vibe_scheduled_events::{
    ScheduleSource, ScheduleSourceKind, ScheduledEventObservation, ScheduledEventPlan,
    open_custodied as open_schedule,
};
use vibe_trading::sessions::{ForexSession, fx_prev_end, fx_prev_start};

use crate::{
    artifact::{ArtifactIssuance, StrategyArtifact, StrategyArtifactIdentity},
    binance_program_application::{BoundBinanceProgramApplication, run_binance_catalog_program},
    experiment::PriceOnlyResearchIntent,
    family::StrategyFamilyError,
    family_adapters::verified_price_build,
    program_host::{
        ProgramCustomBinding, ProgramCustomProjection, ProgramEffectBudget, ProgramHostBindings,
    },
    research::ResearchIntent as RepresentativeResearchIntent,
    software_control::{prepare_representative_market_dataset, validate_program_terminal},
};

pub(crate) const BAR_CHANNELS: [&str; 9] = [
    "BTCUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL",
    "BTCUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL",
    "BTCUSDT-PERP.BINANCE-4-HOUR-LAST-EXTERNAL",
    "BTCUSDT-PERP.BINANCE-1-DAY-LAST-EXTERNAL",
    "ETHUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL",
    "ETHUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL",
    "ETHUSDT-PERP.BINANCE-4-HOUR-LAST-EXTERNAL",
    "ETHUSDT-PERP.BINANCE-1-DAY-LAST-EXTERNAL",
    "PAXGUSDT.BINANCE-1-DAY-LAST-EXTERNAL",
];
const BAR_CHANNEL_IDS: [&str; 9] = [
    "btc_m15", "btc_h1", "btc_h4", "btc_d1", "eth_m15", "eth_h1", "eth_h4", "eth_d1", "paxg_d1",
];
pub(crate) const MACRO_SERIES: [&str; 5] = ["DGS2", "DGS10", "DTWEXBGS", "DEXJPUS", "DCOILWTICO"];
const MACRO_CHANNEL_IDS: [&str; 5] = ["us2y_d1", "us10y_d1", "broad_usd_d1", "usdjpy_d1", "wti_d1"];
const HOUR_NS: u64 = 3_600_000_000_000;
const SCALAR_RECORD: u32 = 1_024;
const CALENDAR_RECORD: u32 = 1_025;
const SESSION_RECORD: u32 = 1_026;
const CALENDAR_CHANNEL: u32 = 15;
const SESSION_CHANNEL: u32 = 16;
const CROSS_ASSET: u16 = 1 << 0;
const GOLD: u16 = 1 << 1;
const EVENTS: u16 = 1 << 2;
const SESSIONS: u16 = 1 << 3;
const MULTI_TIMEFRAME: u16 = 1 << 4;
const STRUCTURE: u16 = 1 << 5;
const DYNAMIC_ORDER: u16 = 1 << 6;
const DYNAMIC_POSITION: u16 = 1 << 7;
const ALL_FEATURES: u16 = (1 << 8) - 1;
const DELETION_FEATURE_MASKS: [u16; 10] = [
    ALL_FEATURES,
    0,
    ALL_FEATURES & !CROSS_ASSET,
    ALL_FEATURES & !GOLD,
    ALL_FEATURES & !EVENTS,
    ALL_FEATURES & !SESSIONS,
    ALL_FEATURES & !MULTI_TIMEFRAME,
    ALL_FEATURES & !STRUCTURE,
    ALL_FEATURES & !DYNAMIC_ORDER,
    ALL_FEATURES & !DYNAMIC_POSITION,
];
const REPRESENTATIVE_EXECUTABLE: u32 = 1;
// Predeclared M15 sandbox ceiling; downstream Risk and Portfolio stay authoritative.
const REPRESENTATIVE_MAX_EFFECTS: u32 = 40_000;
const REPRESENTATIVE_MAX_OPENING_SUBMITS: u32 = 20_000;
const REPRESENTATIVE_MAX_CUMULATIVE_OPENING_QUANTITY: f64 = 40_000.0;

impl ProgramCustomProjection for FredObservation {
    const CODEC_ID: &'static str = "fred-decimal-f64-le-v1";
    const PAYLOAD_LEN: usize = 8;

    fn encode_program_payload(&self, output: &mut [u8]) -> anyhow::Result<()> {
        let value = self
            .observation()
            .to_f64()
            .context("FRED observation cannot be represented by the frozen f64 codec")?;
        anyhow::ensure!(value.is_finite(), "FRED observation is not finite");
        output.copy_from_slice(&value.to_bits().to_le_bytes());
        Ok(())
    }
}

impl ProgramCustomProjection for ScheduledEventObservation {
    const CODEC_ID: &'static str = "scheduled-event-kind-and-target-u64-le-v1";
    const PAYLOAD_LEN: usize = 16;

    fn encode_program_payload(&self, output: &mut [u8]) -> anyhow::Result<()> {
        output.fill(0);
        output[0] = match self.event_id() {
            "Consumer Price Index" => 1,
            "Employment Situation" => 2,
            "FOMC_STATEMENT" => 3,
            event_id => anyhow::bail!("unselected scheduled event {event_id}"),
        };
        output[8..].copy_from_slice(&self.scheduled_for().as_u64().to_le_bytes());
        Ok(())
    }
}

impl ProgramCustomProjection for Signal {
    const CODEC_ID: &'static str = "session-mask-u8-v1";
    const PAYLOAD_LEN: usize = 8;

    fn encode_program_payload(&self, output: &mut [u8]) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.name == "StrategyFactorySessionStateV1",
            "foreign session signal"
        );
        output.fill(0);
        output[0] = self.value.parse()?;
        Ok(())
    }
}

fn session_data_type() -> DataType {
    DataType::new(
        "Signal",
        None,
        Some("VIBE_TRADING/FX_SESSIONS/TOKYO_LONDON_NEW_YORK/V1".into()),
    )
}

pub(crate) fn representative_program_inputs(
    intent: &PriceOnlyResearchIntent,
    parameter_id: &str,
    variant_id: &str,
) -> Result<(Vec<u8>, ProgramHostBindings), StrategyFamilyError> {
    intent
        .validate_frozen_binding()
        .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
    let tuple = intent
        .tuple(parameter_id)
        .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
    let representative_intent = RepresentativeResearchIntent::frozen_representative()
        .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
    let variant_index = representative_intent
        .deletion_variants()
        .iter()
        .position(|candidate| candidate == variant_id)
        .ok_or(StrategyFamilyError::ForeignTrial)?;
    let feature_mask = DELETION_FEATURE_MASKS
        .get(variant_index)
        .copied()
        .ok_or(StrategyFamilyError::ForeignTrial)?;
    let bars = BAR_CHANNELS
        .iter()
        .enumerate()
        .map(|(index, value)| Ok((u32::try_from(index + 1)?, value.parse::<BarType>()?)))
        .collect::<anyhow::Result<Vec<_>>>()
        .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
    let mut customs = MACRO_SERIES
        .iter()
        .enumerate()
        .map(|(index, series)| {
            ProgramCustomBinding::new::<FredObservation>(
                FredObservation::data_type(series),
                SCALAR_RECORD,
                u32::try_from(index + 10).expect("bounded scalar channel"),
            )
        })
        .collect::<anyhow::Result<Vec<_>>>()
        .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
    customs.push(
        ProgramCustomBinding::new::<ScheduledEventObservation>(
            ScheduledEventObservation::data_type(),
            CALENDAR_RECORD,
            CALENDAR_CHANNEL,
        )
        .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?,
    );
    customs.push(
        ProgramCustomBinding::new::<Signal>(session_data_type(), SESSION_RECORD, SESSION_CHANNEL)
            .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?,
    );
    let budget = ProgramEffectBudget::new(
        REPRESENTATIVE_MAX_EFFECTS,
        REPRESENTATIVE_MAX_EFFECTS,
        REPRESENTATIVE_MAX_OPENING_SUBMITS,
        [(
            REPRESENTATIVE_EXECUTABLE,
            REPRESENTATIVE_MAX_CUMULATIVE_OPENING_QUANTITY,
        )],
    )
    .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
    let bindings = ProgramHostBindings::new(
        [(
            REPRESENTATIVE_EXECUTABLE,
            InstrumentId::from("BTCUSDT-PERP.BINANCE"),
        )],
        bars,
        budget,
    )
    .and_then(|bindings| bindings.with_custom(customs))
    .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;

    let mut bytes = Vec::with_capacity(172);
    bytes.extend_from_slice(b"RPF1");
    bytes.push(2);
    bytes.push(6);
    bytes.extend_from_slice(&feature_mask.to_le_bytes());
    bytes.extend_from_slice(&REPRESENTATIVE_EXECUTABLE.to_le_bytes());
    for channel in 1_u32..=SESSION_CHANNEL {
        bytes.extend_from_slice(&channel.to_le_bytes());
    }

    for value in [
        tuple.atr_period,
        tuple.band_period,
        tuple.breakout_lookback,
        tuple.exit_lookback,
        tuple.fast_ema,
        tuple.rsi_period,
        tuple.slow_ema,
        tuple.volatility_fast,
        tuple.volatility_slow,
    ]
    .into_iter()
    .chain([
        tuple.band_sigma_milli,
        tuple.max_volatility_ratio_milli,
        tuple.rsi_entry_max_milli,
        tuple.target_risk_bps,
        tuple.trailing_atr_milli,
        100,
    ]) {
        bytes.extend_from_slice(
            &u16::try_from(value)
                .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?
                .to_le_bytes(),
        );
    }
    bytes.extend_from_slice(&3_600_000_000_000_u64.to_le_bytes());
    bytes.extend_from_slice(&3_600_000_000_000_u64.to_le_bytes());
    bytes.extend_from_slice(&900_000_000_000_u64.to_le_bytes());
    let balance = Money::from_str(&intent.payload.costs.initial_balance)
        .map_err(StrategyFamilyError::Definition)?;
    bytes.extend_from_slice(&balance.as_f64().to_le_bytes());
    bytes.push(0b111);

    for channel_id in BAR_CHANNEL_IDS.into_iter().chain(MACRO_CHANNEL_IDS) {
        let staleness = representative_intent
            .max_staleness_ns(channel_id)
            .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?;
        if staleness % HOUR_NS != 0 {
            return Err(StrategyFamilyError::Definition(
                "freshness is not an exact number of hours".into(),
            ));
        }
        bytes.extend_from_slice(
            &u16::try_from(staleness / HOUR_NS)
                .map_err(|e| StrategyFamilyError::Definition(e.to_string()))?
                .to_le_bytes(),
        );
    }
    bytes.extend_from_slice(&[0; 5]);
    debug_assert_eq!(bytes.len(), 172);
    Ok((bytes, bindings))
}

fn schedule_plan() -> anyhow::Result<ScheduledEventPlan> {
    ScheduledEventPlan::new(
        2023,
        [
            ScheduleSource::new(
                ScheduleSourceKind::BlsReleaseCalendar,
                "bls-schedule-2023-20221018180439.html",
                "https://www.bls.gov/schedule/2023/home.htm",
                "20221018180439",
                "HEVTAWNK542IVD7RRBRTJ24QYWFB47BU",
                "48e7410956027a6868e196a1ebade3301af5834632e52474d8e98de8f17492fd",
            )?,
            ScheduleSource::new(
                ScheduleSourceKind::FomcMeetingCalendar,
                "fed-fomc-calendar-20221213005116.html",
                "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
                "20221213005116",
                "XJCE65BPC5MCTFXEWPU7RWPH5VZYNFV2",
                "dd720d6220e0f06f99ab22c9f915f600815ea4201ef5516fbf6171716194b32c",
            )?,
            ScheduleSource::new(
                ScheduleSourceKind::FomcStatementRule,
                "fed-fomc-release-rule-20170430203953.html",
                "https://www.federalreserve.gov/newsevents/pressreleases/monetary20130313a.htm",
                "20170430203953",
                "A4TEXVPFH7AIJKQZ4M5KZUEGXDNOAB2O",
                "fd1ec0594fa842e9ca8905a2b4589e529dc988baf8a193517fc8d68161f828b3",
            )?,
        ],
    )
}

fn selected_schedule_data(values: &[CustomData]) -> anyhow::Result<Vec<CustomData>> {
    let mut counts = [0; 3];
    let mut selected = Vec::new();

    for value in values {
        let event = value
            .data
            .as_any()
            .downcast_ref::<ScheduledEventObservation>()
            .context("scheduled event has the wrong concrete type")?;
        let slot = match event.event_id() {
            "Consumer Price Index" => Some(0),
            "Employment Situation" => Some(1),
            "FOMC_STATEMENT" => Some(2),
            _ => None,
        };

        if let Some(slot) = slot {
            counts[slot] += 1;
            selected.push(value.clone());
        }
    }
    anyhow::ensure!(
        counts == [12, 12, 8],
        "representative schedule coverage mismatch"
    );
    Ok(selected)
}

pub(crate) fn session_observations(start_ns: u64, end_ns: u64) -> anyhow::Result<Vec<CustomData>> {
    let sessions = [
        ForexSession::Tokyo,
        ForexSession::London,
        ForexSession::NewYork,
    ];
    let data_type = session_data_type();
    let mut output = Vec::new();
    let mut previous = None;
    let mut timestamp = start_ns;
    while timestamp <= end_ns {
        let instant = Timestamp::from_nanosecond(i128::from(timestamp))?;
        let mask = sessions
            .iter()
            .enumerate()
            .fold(0_u8, |mask, (index, session)| {
                mask | u8::from(fx_prev_start(*session, instant) > fx_prev_end(*session, instant))
                    << index
            });

        if previous != Some(mask) {
            let available_at = timestamp.saturating_sub(1).into();
            output.push(CustomData::new(
                Arc::new(Signal::new(
                    "StrategyFactorySessionStateV1".into(),
                    mask.to_string(),
                    available_at,
                    available_at,
                )),
                data_type.clone(),
            ));
            previous = Some(mask);
        }
        timestamp = timestamp
            .checked_add(900_000_000_000)
            .context("session projection overflow")?;
    }
    Ok(output)
}

fn macro_plan() -> anyhow::Result<AlfredPlan> {
    let window = ["2023-01-01", "2023-12-28", "2023-01-01", "2023-12-31"];
    AlfredPlan::new(
        MACRO_SERIES
            .into_iter()
            .map(|series| AlfredQuery::new(series, window[0], window[1], window[2], window[3]))
            .collect(),
    )
}

pub(crate) struct RepresentativeProgramControl {
    pub(crate) input_manifest_digests: BTreeMap<String, String>,
    pub(crate) source_counts: BTreeMap<String, usize>,
    pub(crate) artifact_identity: StrategyArtifactIdentity,
    pub(crate) canonical_result: Vec<u8>,
    pub(crate) decision_tags: Vec<u32>,
}

pub(crate) struct PreparedRepresentativeProgramData {
    pub(crate) dataset: crate::binance_program_data::PreparedBinanceProgramDataset,
    pub(crate) input_manifest_digests: BTreeMap<String, String>,
    pub(crate) run_scope: ProgramRunScope,
    pub(crate) source_counts: BTreeMap<String, usize>,
}

pub(crate) fn prepare_representative_program_data(
    raw_root: &Path,
    alfred_root: &Path,
    schedule_root: &Path,
    derived_catalog_root: &Path,
) -> anyhow::Result<PreparedRepresentativeProgramData> {
    let macro_data = open_alfred(alfred_root, &macro_plan()?)?;
    let schedule_data = open_schedule(schedule_root, &schedule_plan()?)?;
    let selected_schedule = selected_schedule_data(schedule_data.custom_data())?;
    let market_start_ns = 1_672_532_099_999_000_000_u64;
    let source_end_ns = 1_704_067_199_999_000_000_u64;
    let mut custom_data = macro_data.custom_data().to_vec();
    custom_data.extend(selected_schedule.iter().cloned());
    custom_data.extend(session_observations(market_start_ns, source_end_ns)?);
    let session_count =
        custom_data.len() - macro_data.custom_data().len() - selected_schedule.len();
    let source_start_ns = custom_data
        .iter()
        .map(HasTsInit::ts_init)
        .map(|timestamp| timestamp.as_u64())
        .min()
        .context("representative custom inputs are unavailable")?
        .min(market_start_ns);
    let run_scope = ProgramRunScope::new(
        source_start_ns,
        market_start_ns,
        source_end_ns + 900_000_000_000,
    )
    .map_err(|e| anyhow::anyhow!("invalid representative run scope: {e:?}"))?;
    let source_binding = format!(
        "{}:{}",
        macro_data.manifest_digest(),
        schedule_data.manifest_digest()
    );
    let dataset = prepare_representative_market_dataset(
        raw_root,
        derived_catalog_root,
        custom_data,
        source_binding.as_bytes(),
    )?;
    let mut source_counts = BTreeMap::from([
        ("market.source_events".into(), dataset.source_event_count),
        (
            "market.executable_bars".into(),
            dataset.executable_bar_count,
        ),
        ("schedule.events".into(), selected_schedule.len()),
        ("session.transitions".into(), session_count),
    ]);

    for series in MACRO_SERIES {
        let counts = macro_data
            .series_counts(series)
            .context("frozen ALFRED series counts are unavailable")?;
        source_counts.insert(format!("{series}.usable"), counts.usable);
        source_counts.insert(format!("{series}.missing"), counts.missing);
    }
    Ok(PreparedRepresentativeProgramData {
        input_manifest_digests: BTreeMap::from([
            ("alfred".into(), macro_data.manifest_digest().into()),
            ("market".into(), dataset.source_manifest_digest.clone()),
            ("schedule".into(), schedule_data.manifest_digest().into()),
        ]),
        dataset,
        run_scope,
        source_counts,
    })
}

pub(crate) fn run_representative_program_control(
    raw_root: &Path,
    alfred_root: &Path,
    schedule_root: &Path,
    derived_catalog_root: &Path,
) -> anyhow::Result<RepresentativeProgramControl> {
    let price_intent = PriceOnlyResearchIntent::frozen()?;
    let (parameters, bindings) = representative_program_inputs(&price_intent, "tuple-001", "full")?;
    run_representative_program_control_with_inputs(
        raw_root,
        alfred_root,
        schedule_root,
        derived_catalog_root,
        parameters,
        bindings,
    )
}

fn run_representative_program_control_with_inputs(
    raw_root: &Path,
    alfred_root: &Path,
    schedule_root: &Path,
    derived_catalog_root: &Path,
    parameters: Vec<u8>,
    bindings: ProgramHostBindings,
) -> anyhow::Result<RepresentativeProgramControl> {
    let representative_intent = RepresentativeResearchIntent::frozen_representative()?;
    let prepared = prepare_representative_program_data(
        raw_root,
        alfred_root,
        schedule_root,
        derived_catalog_root,
    )?;
    let artifact = StrategyArtifact::issue(&ArtifactIssuance::program(
        12,
        representative_intent.canonical_bytes(),
        Some(bindings.identity()?),
        Some("representative-program-control/tuple-001/full".into()),
        Some(parameters.clone()),
        verified_price_build()?,
    ))?;
    artifact.verify_parameters(&parameters)?;
    let artifact_identity = artifact.identity().clone();
    let (result, decision_tags) = run_binance_catalog_program(
        &prepared.dataset.catalog_root,
        &prepared.dataset.bar_types,
        &prepared.dataset.instruments,
        &prepared.dataset.custom_data,
        &BoundBinanceProgramApplication {
            artifact,
            parameters,
            bindings,
        },
        prepared.run_scope,
        StrategyId::from("REPRESENTATIVE-PROGRAM-CONTROL-001"),
        "representative-program-control-001",
    )?;
    validate_program_terminal(&result)?;
    Ok(RepresentativeProgramControl {
        input_manifest_digests: prepared.input_manifest_digests,
        source_counts: prepared.source_counts,
        artifact_identity,
        canonical_result: result.to_bytes()?,
        decision_tags,
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use rstest::rstest;

    use super::*;

    #[rstest]
    fn representative_parameters_are_fixed_width_and_bind_every_input_channel() {
        let intent = PriceOnlyResearchIntent::frozen().unwrap();
        let (parameters, bindings) =
            representative_program_inputs(&intent, "tuple-001", "full").unwrap();
        assert_eq!(parameters.len(), 172);
        assert!(bindings.identity().unwrap().starts_with("blake3:"));
    }

    #[rstest]
    fn representative_deletion_variants_are_one_frozen_feature_mask_table() {
        let intent = PriceOnlyResearchIntent::frozen().unwrap();
        let representative = RepresentativeResearchIntent::frozen_representative().unwrap();
        let masks = representative
            .deletion_variants()
            .iter()
            .map(|variant| {
                let (parameters, _) =
                    representative_program_inputs(&intent, "tuple-001", variant).unwrap();
                u16::from_le_bytes(parameters[6..8].try_into().unwrap())
            })
            .collect::<Vec<_>>();
        assert_eq!(masks, DELETION_FEATURE_MASKS);
        assert_eq!(masks[0], ALL_FEATURES);
        assert_eq!(masks[1], 0);
        assert_eq!(
            masks
                .iter()
                .copied()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            10
        );
    }

    #[rstest]
    fn foreign_parameter_or_variant_cannot_materialize_program_inputs() {
        let intent = PriceOnlyResearchIntent::frozen().unwrap();
        assert!(representative_program_inputs(&intent, "foreign", "full").is_err());
        assert!(representative_program_inputs(&intent, "tuple-001", "foreign").is_err());
    }

    #[rstest]
    #[ignore = "requires frozen Binance, five-series ALFRED, and scheduled-event evidence"]
    fn stale_artifact_policy_reaches_real_owner_chain_and_cannot_open_risk() {
        let raw =
            PathBuf::from(std::env::var("STRATEGY_FACTORY_REPRESENTATIVE_DATASET_ROOT").unwrap());
        let alfred = PathBuf::from(std::env::var("VIBE_FRED_FIVE_SERIES_DATASET_ROOT").unwrap());
        let schedule =
            PathBuf::from(std::env::var("VIBE_SCHEDULED_EVENTS_OFFICIAL_CACHE").unwrap());
        let intent = PriceOnlyResearchIntent::frozen().unwrap();
        let (mut parameters, bindings) =
            representative_program_inputs(&intent, "tuple-001", "full").unwrap();
        parameters[139..167].fill(0);
        let target = tempfile::tempdir().unwrap();
        let control = run_representative_program_control_with_inputs(
            &raw,
            &alfred,
            &schedule,
            &target.path().join("catalog"),
            parameters,
            bindings,
        )
        .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&control.canonical_result).unwrap();
        assert_eq!(result["orders"].as_array().unwrap().len(), 0);
        assert!(control.decision_tags.is_empty());
    }
}
