use std::{any::Any, str::FromStr, sync::Arc};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use vibe_core::UnixNanos;
use vibe_model::{
    data::{CustomData, CustomDataTrait, Data, DataType, HasTsInit},
    types::Quantity,
};

pub use crate::intent::MISSING_OPEN_NS;
use crate::intent::{ZERO_VOLUME_CLOSE_NS, ZERO_VOLUME_OPEN_NS};

pub const INSTRUMENT_ID: &str = "BTCUSDT.BINANCE";
pub const NEXT_ACTUAL_OPEN_NS: u64 = 1_679_666_400_000_000_000;
pub const ZERO_VOLUME_DATA_TYPE: &str = "StrategyFactoryNonExecutableKlineEventV1";

const ARCHIVE_NAME: &str = "BTCUSDT-1h-2023-03.zip";
const ARCHIVE_URL: &str =
    "https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2023-03.zip";
const ARCHIVE_SHA256: &str = "7f2afb8e0179a57ac31eab5205660298ba5eb77039ac2e21aef9b715ff3d06ce";
const SIDECAR_URL: &str = "https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2023-03.zip.CHECKSUM";
const SIDECAR_SHA256: &str = "0723db47f2c7d886dc8c832edeeb6e4d72c3b8e0da9404e12a718b19f8dbe21b";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BinanceArchiveProvenance {
    pub provider: String,
    pub market: String,
    pub symbol: String,
    pub interval: String,
    pub archive_name: String,
    pub archive_url: String,
    pub archive_sha256: String,
    pub sidecar_url: String,
    pub sidecar_sha256: String,
}

impl BinanceArchiveProvenance {
    pub fn frozen_observation() -> Self {
        Self {
            provider: "Binance Spot public historical market data".to_string(),
            market: "spot".to_string(),
            symbol: "BTCUSDT".to_string(),
            interval: "1h".to_string(),
            archive_name: ARCHIVE_NAME.to_string(),
            archive_url: ARCHIVE_URL.to_string(),
            archive_sha256: ARCHIVE_SHA256.to_string(),
            sidecar_url: SIDECAR_URL.to_string(),
            sidecar_sha256: SIDECAR_SHA256.to_string(),
        }
    }

    fn validate(&self) -> Result<(), DataAdmissionError> {
        if self != &Self::frozen_observation() {
            return Err(DataAdmissionError::UnboundProvenance);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BinanceKlineRecord {
    pub archive_sha256: String,
    pub instrument_id: String,
    pub interval: String,
    pub open_time_ns: u64,
    pub close_time_ns: u64,
    pub open: String,
    pub high: String,
    pub low: String,
    pub close: String,
    pub base_volume: String,
    pub closed: bool,
    pub source_gap: bool,
    pub tradable: bool,
    pub execution_allowed: bool,
}

impl BinanceKlineRecord {
    pub fn frozen_zero_volume_observation() -> Self {
        Self {
            archive_sha256: ARCHIVE_SHA256.to_string(),
            instrument_id: INSTRUMENT_ID.to_string(),
            interval: "1h".to_string(),
            open_time_ns: ZERO_VOLUME_OPEN_NS,
            close_time_ns: ZERO_VOLUME_CLOSE_NS,
            open: "28080.00000000".to_string(),
            high: "28080.00000000".to_string(),
            low: "28080.00000000".to_string(),
            close: "28080.00000000".to_string(),
            base_volume: "0.00000000".to_string(),
            closed: true,
            source_gap: true,
            tradable: false,
            execution_allowed: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NonExecutableKlineEvent {
    pub provenance_digest: String,
    pub instrument_id: String,
    pub source_open_time_ns: u64,
    pub source_close_time_ns: u64,
    pub synthetic: bool,
    pub source_gap: bool,
    pub tradable: bool,
    pub execution_allowed: bool,
}

impl HasTsInit for NonExecutableKlineEvent {
    fn ts_init(&self) -> UnixNanos {
        self.source_close_time_ns.into()
    }
}

impl CustomDataTrait for NonExecutableKlineEvent {
    fn type_name(&self) -> &'static str {
        ZERO_VOLUME_DATA_TYPE
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn ts_event(&self) -> UnixNanos {
        self.source_close_time_ns.into()
    }

    fn to_json(&self) -> anyhow::Result<String> {
        Ok(serde_json::to_string(self)?)
    }

    fn clone_arc(&self) -> Arc<dyn CustomDataTrait> {
        Arc::new(self.clone())
    }

    fn eq_arc(&self, other: &dyn CustomDataTrait) -> bool {
        other.as_any().downcast_ref::<Self>() == Some(self)
    }

    fn type_name_static() -> &'static str {
        ZERO_VOLUME_DATA_TYPE
    }
}

#[derive(Debug)]
pub struct ProjectedBacktestInputs {
    source_open_times: Vec<u64>,
    data: Vec<Data>,
}

impl ProjectedBacktestInputs {
    pub fn data(&self) -> &[Data] {
        &self.data
    }

    pub fn into_data(self) -> Vec<Data> {
        self.data
    }

    pub fn contains_source_open_time(&self, ts: u64) -> bool {
        self.source_open_times.binary_search(&ts).is_ok()
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DataAdmissionError {
    #[error("source record set cannot be empty")]
    EmptyRecordSet,
    #[error("Binance archive provenance is not bound to the frozen official object")]
    UnboundProvenance,
    #[error("source record is malformed or unbound: {0}")]
    Malformed(&'static str),
    #[error("zero-volume source event cannot receive executable Bar authority")]
    ZeroVolumeExecutableAuthority,
    #[error(
        "executable Binance record authority is unavailable before verified archive-row parsing"
    )]
    ExecutableRecordAuthorityUnavailable,
    #[error("source records are not strictly ordered")]
    Ordering,
}

pub fn project_backtest_inputs(
    provenance: &BinanceArchiveProvenance,
    records: &[BinanceKlineRecord],
) -> Result<ProjectedBacktestInputs, DataAdmissionError> {
    if records.is_empty() {
        return Err(DataAdmissionError::EmptyRecordSet);
    }
    provenance.validate()?;
    let mut source_open_times = Vec::with_capacity(records.len());
    let mut data = Vec::with_capacity(records.len());
    let mut previous = None;
    for record in records {
        if previous.is_some_and(|ts| ts >= record.open_time_ns) {
            return Err(DataAdmissionError::Ordering);
        }
        previous = Some(record.open_time_ns);
        source_open_times.push(record.open_time_ns);
        data.push(project_record(provenance, record)?);
    }
    Ok(ProjectedBacktestInputs {
        source_open_times,
        data,
    })
}

fn project_record(
    provenance: &BinanceArchiveProvenance,
    record: &BinanceKlineRecord,
) -> Result<Data, DataAdmissionError> {
    let volume = Quantity::from_str(&record.base_volume)
        .map_err(|_| DataAdmissionError::Malformed("base_volume"))?;
    if !volume.is_zero() {
        return Err(DataAdmissionError::ExecutableRecordAuthorityUnavailable);
    }
    if record.archive_sha256 != provenance.archive_sha256
        || record.instrument_id != INSTRUMENT_ID
        || record.interval != "1h"
        || !record.closed
        || record.close_time_ns <= record.open_time_ns
    {
        return Err(DataAdmissionError::Malformed("identity/time/closure"));
    }
    if record.tradable || record.execution_allowed {
        return Err(DataAdmissionError::ZeroVolumeExecutableAuthority);
    }
    if record != &BinanceKlineRecord::frozen_zero_volume_observation() {
        return Err(DataAdmissionError::Malformed(
            "zero-volume frozen observation",
        ));
    }
    let provenance_digest = format!(
        "blake3:{}",
        blake3::hash(
            serde_json::to_string(provenance)
                .map_err(|_| DataAdmissionError::Malformed("provenance serialization"))?
                .as_bytes()
        )
        .to_hex()
    );
    let event = NonExecutableKlineEvent {
        provenance_digest,
        instrument_id: record.instrument_id.clone(),
        source_open_time_ns: record.open_time_ns,
        source_close_time_ns: record.close_time_ns,
        synthetic: false,
        source_gap: true,
        tradable: false,
        execution_allowed: false,
    };
    let data_type = DataType::new(
        ZERO_VOLUME_DATA_TYPE,
        None,
        Some(record.instrument_id.clone()),
    );
    Ok(Data::Custom(CustomData::new(Arc::new(event), data_type)))
}

pub fn frozen_frontier_projection() -> Result<ProjectedBacktestInputs, DataAdmissionError> {
    let projection = project_backtest_inputs(
        &BinanceArchiveProvenance::frozen_observation(),
        &[BinanceKlineRecord::frozen_zero_volume_observation()],
    )?;
    debug_assert!(!projection.contains_source_open_time(MISSING_OPEN_NS));
    debug_assert!(!projection.contains_source_open_time(NEXT_ACTUAL_OPEN_NS));
    Ok(projection)
}
