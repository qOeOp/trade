use std::{any::Any, sync::Arc};

use serde::Serialize;
use vibe_binance::common::{
    enums::BinanceKlineInterval, offline::AuthenticatedBinanceVisionKlines,
};
use vibe_core::UnixNanos;
use vibe_model::data::{CustomData, CustomDataTrait, Data, DataType, HasTsInit};

use crate::intent::{ZERO_VOLUME_CLOSE_NS, ZERO_VOLUME_OPEN_NS};

const INSTRUMENT_ID: &str = "BTCUSDT.BINANCE";
const ZERO_VOLUME_DATA_TYPE: &str = "StrategyFactoryNonExecutableKlineEventV1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct NonExecutableKlineEvent {
    provenance_digest: String,
    instrument_id: String,
    source_open_time_ns: u64,
    source_close_time_ns: u64,
    synthetic: bool,
    source_gap: bool,
    tradable: bool,
    execution_allowed: bool,
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

pub(crate) fn project_authenticated_zero_volume_observation(
    authenticated: &AuthenticatedBinanceVisionKlines,
) -> anyhow::Result<Option<(u64, Data)>> {
    let metadata = authenticated.metadata();
    anyhow::ensure!(
        metadata.binding().symbol() == "BTCUSDT"
            && metadata.binding().interval() == BinanceKlineInterval::Hour1,
        "zero-volume observation archive binding mismatch"
    );
    anyhow::ensure!(
        authenticated.zero_volume_observations().len() <= 1,
        "archive contains multiple zero-volume observations"
    );
    let Some(observation) = authenticated.zero_volume_observations().first() else {
        return Ok(None);
    };
    let source_open_time_ns = micros_to_nanos(observation.open_time_micros())?;
    let source_close_time_ns = micros_to_nanos(observation.close_time_micros())?;
    anyhow::ensure!(
        source_open_time_ns == ZERO_VOLUME_OPEN_NS
            && source_close_time_ns == ZERO_VOLUME_CLOSE_NS
            && observation.ohlc()
                == (
                    "28080.00000000",
                    "28080.00000000",
                    "28080.00000000",
                    "28080.00000000",
                ),
        "zero-volume observation does not match the frozen source event"
    );
    let event = NonExecutableKlineEvent {
        provenance_digest: format!("sha256:{}", metadata.archive_sha256()),
        instrument_id: INSTRUMENT_ID.to_string(),
        source_open_time_ns,
        source_close_time_ns,
        synthetic: false,
        source_gap: true,
        tradable: false,
        execution_allowed: false,
    };
    let data_type = DataType::new(ZERO_VOLUME_DATA_TYPE, None, Some(INSTRUMENT_ID.to_string()));
    Ok(Some((
        source_open_time_ns,
        Data::Custom(CustomData::new(Arc::new(event), data_type)),
    )))
}

fn micros_to_nanos(value: i64) -> anyhow::Result<u64> {
    u64::try_from(value)
        .ok()
        .and_then(|value| value.checked_mul(1_000))
        .ok_or_else(|| anyhow::anyhow!("source timestamp is negative or overflows nanoseconds"))
}
