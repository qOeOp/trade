use std::num::NonZeroUsize;

use serde::{Deserialize, Serialize};
use vibe_core::{Params, UUID4, UnixNanos};
use vibe_model::{
    data::{BarType, DataType},
    identifiers::{ClientId, InstrumentId, OptionSeriesId, Venue},
};

use super::check_client_id_or_venue;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeCustomData {
    pub client_id: Option<ClientId>,
    pub venue: Option<Venue>,
    pub data_type: DataType,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub correlation_id: Option<UUID4>,
    pub params: Option<Params>,
}

impl UnsubscribeCustomData {
    /// Creates a new [`UnsubscribeCustomData`] instance.
    pub fn new(
        client_id: Option<ClientId>,
        venue: Option<Venue>,
        data_type: DataType,
        command_id: UUID4,
        ts_init: UnixNanos,
        correlation_id: Option<UUID4>,
        params: Option<Params>,
    ) -> Self {
        check_client_id_or_venue(&client_id, &venue);
        Self {
            client_id,
            venue,
            data_type,
            command_id,
            ts_init,
            correlation_id,
            params,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeInstrument {
    pub instrument_id: InstrumentId,
    pub client_id: Option<ClientId>,
    pub venue: Option<Venue>,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub correlation_id: Option<UUID4>,
    pub params: Option<Params>,
}

impl UnsubscribeInstrument {
    /// Creates a new [`UnsubscribeInstrument`] instance.
    pub fn new(
        instrument_id: InstrumentId,
        client_id: Option<ClientId>,
        venue: Option<Venue>,
        command_id: UUID4,
        ts_init: UnixNanos,
        correlation_id: Option<UUID4>,
        params: Option<Params>,
    ) -> Self {
        check_client_id_or_venue(&client_id, &venue);
        Self {
            instrument_id,
            client_id,
            venue,
            command_id,
            ts_init,
            correlation_id,
            params,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeInstruments {
    pub client_id: Option<ClientId>,
    pub venue: Venue,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub correlation_id: Option<UUID4>,
    pub params: Option<Params>,
}

impl UnsubscribeInstruments {
    /// Creates a new [`UnsubscribeInstruments`] instance.
    pub fn new(
        client_id: Option<ClientId>,
        venue: Venue,
        command_id: UUID4,
        ts_init: UnixNanos,
        correlation_id: Option<UUID4>,
        params: Option<Params>,
    ) -> Self {
        Self {
            client_id,
            venue,
            command_id,
            ts_init,
            correlation_id,
            params,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeBookDeltas {
    pub instrument_id: InstrumentId,
    pub client_id: Option<ClientId>,
    pub venue: Option<Venue>,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub correlation_id: Option<UUID4>,
    pub params: Option<Params>,
}

impl UnsubscribeBookDeltas {
    /// Creates a new [`UnsubscribeBookDeltas`] instance.
    pub fn new(
        instrument_id: InstrumentId,
        client_id: Option<ClientId>,
        venue: Option<Venue>,
        command_id: UUID4,
        ts_init: UnixNanos,
        correlation_id: Option<UUID4>,
        params: Option<Params>,
    ) -> Self {
        check_client_id_or_venue(&client_id, &venue);
        Self {
            instrument_id,
            client_id,
            venue,
            command_id,
            ts_init,
            correlation_id,
            params,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeBookDepth10 {
    pub instrument_id: InstrumentId,
    pub client_id: Option<ClientId>,
    pub venue: Option<Venue>,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub correlation_id: Option<UUID4>,
    pub params: Option<Params>,
}

impl UnsubscribeBookDepth10 {
    /// Creates a new [`UnsubscribeBookDepth10`] instance.
    pub fn new(
        instrument_id: InstrumentId,
        client_id: Option<ClientId>,
        venue: Option<Venue>,
        command_id: UUID4,
        ts_init: UnixNanos,
        correlation_id: Option<UUID4>,
        params: Option<Params>,
    ) -> Self {
        check_client_id_or_venue(&client_id, &venue);
        Self {
            instrument_id,
            client_id,
            venue,
            command_id,
            ts_init,
            correlation_id,
            params,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeBookSnapshots {
    pub instrument_id: InstrumentId,
    pub interval_ms: NonZeroUsize,
    pub client_id: Option<ClientId>,
    pub venue: Option<Venue>,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub correlation_id: Option<UUID4>,
    pub params: Option<Params>,
}

impl UnsubscribeBookSnapshots {
    /// Creates a new [`UnsubscribeBookSnapshots`] instance.
    #[expect(clippy::too_many_arguments)]
    pub fn new(
        instrument_id: InstrumentId,
        interval_ms: NonZeroUsize,
        client_id: Option<ClientId>,
        venue: Option<Venue>,
        command_id: UUID4,
        ts_init: UnixNanos,
        correlation_id: Option<UUID4>,
        params: Option<Params>,
    ) -> Self {
        check_client_id_or_venue(&client_id, &venue);
        Self {
            instrument_id,
            interval_ms,
            client_id,
            venue,
            command_id,
            ts_init,
            correlation_id,
            params,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeQuotes {
    pub instrument_id: InstrumentId,
    pub client_id: Option<ClientId>,
    pub venue: Option<Venue>,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub correlation_id: Option<UUID4>,
    pub params: Option<Params>,
}

impl UnsubscribeQuotes {
    /// Creates a new [`UnsubscribeQuotes`] instance.
    pub fn new(
        instrument_id: InstrumentId,
        client_id: Option<ClientId>,
        venue: Option<Venue>,
        command_id: UUID4,
        ts_init: UnixNanos,
        correlation_id: Option<UUID4>,
        params: Option<Params>,
    ) -> Self {
        check_client_id_or_venue(&client_id, &venue);
        Self {
            instrument_id,
            client_id,
            venue,
            command_id,
            ts_init,
            correlation_id,
            params,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeTrades {
    pub instrument_id: InstrumentId,
    pub client_id: Option<ClientId>,
    pub venue: Option<Venue>,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub correlation_id: Option<UUID4>,
    pub params: Option<Params>,
}

impl UnsubscribeTrades {
    /// Creates a new [`UnsubscribeTrades`] instance.
    pub fn new(
        instrument_id: InstrumentId,
        client_id: Option<ClientId>,
        venue: Option<Venue>,
        command_id: UUID4,
        ts_init: UnixNanos,
        correlation_id: Option<UUID4>,
        params: Option<Params>,
    ) -> Self {
        check_client_id_or_venue(&client_id, &venue);
        Self {
            instrument_id,
            client_id,
            venue,
            command_id,
            ts_init,
            correlation_id,
            params,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeBars {
    pub bar_type: BarType,
    pub client_id: Option<ClientId>,
    pub venue: Option<Venue>,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub correlation_id: Option<UUID4>,
    pub params: Option<Params>,
}

impl UnsubscribeBars {
    /// Creates a new [`UnsubscribeBars`] instance.
    pub fn new(
        bar_type: BarType,
        client_id: Option<ClientId>,
        venue: Option<Venue>,
        command_id: UUID4,
        ts_init: UnixNanos,
        correlation_id: Option<UUID4>,
        params: Option<Params>,
    ) -> Self {
        check_client_id_or_venue(&client_id, &venue);
        Self {
            bar_type,
            client_id,
            venue,
            command_id,
            ts_init,
            correlation_id,
            params,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeMarkPrices {
    pub instrument_id: InstrumentId,
    pub client_id: Option<ClientId>,
    pub venue: Option<Venue>,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub correlation_id: Option<UUID4>,
    pub params: Option<Params>,
}

impl UnsubscribeMarkPrices {
    /// Creates a new [`UnsubscribeMarkPrices`] instance.
    pub fn new(
        instrument_id: InstrumentId,
        client_id: Option<ClientId>,
        venue: Option<Venue>,
        command_id: UUID4,
        ts_init: UnixNanos,
        correlation_id: Option<UUID4>,
        params: Option<Params>,
    ) -> Self {
        check_client_id_or_venue(&client_id, &venue);
        Self {
            instrument_id,
            client_id,
            venue,
            command_id,
            ts_init,
            correlation_id,
            params,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeIndexPrices {
    pub instrument_id: InstrumentId,
    pub client_id: Option<ClientId>,
    pub venue: Option<Venue>,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub correlation_id: Option<UUID4>,
    pub params: Option<Params>,
}

impl UnsubscribeIndexPrices {
    /// Creates a new [`UnsubscribeIndexPrices`] instance.
    pub fn new(
        instrument_id: InstrumentId,
        client_id: Option<ClientId>,
        venue: Option<Venue>,
        command_id: UUID4,
        ts_init: UnixNanos,
        correlation_id: Option<UUID4>,
        params: Option<Params>,
    ) -> Self {
        check_client_id_or_venue(&client_id, &venue);
        Self {
            instrument_id,
            client_id,
            venue,
            command_id,
            ts_init,
            correlation_id,
            params,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeFundingRates {
    pub instrument_id: InstrumentId,
    pub client_id: Option<ClientId>,
    pub venue: Option<Venue>,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub correlation_id: Option<UUID4>,
    pub params: Option<Params>,
}

impl UnsubscribeFundingRates {
    /// Creates a new [`UnsubscribeFundingRates`] instance.
    pub fn new(
        instrument_id: InstrumentId,
        client_id: Option<ClientId>,
        venue: Option<Venue>,
        command_id: UUID4,
        ts_init: UnixNanos,
        correlation_id: Option<UUID4>,
        params: Option<Params>,
    ) -> Self {
        check_client_id_or_venue(&client_id, &venue);
        Self {
            instrument_id,
            client_id,
            venue,
            command_id,
            ts_init,
            correlation_id,
            params,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeInstrumentStatus {
    pub instrument_id: InstrumentId,
    pub client_id: Option<ClientId>,
    pub venue: Option<Venue>,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub correlation_id: Option<UUID4>,
    pub params: Option<Params>,
}

impl UnsubscribeInstrumentStatus {
    /// Creates a new [`UnsubscribeInstrumentStatus`] instance.
    pub fn new(
        instrument_id: InstrumentId,
        client_id: Option<ClientId>,
        venue: Option<Venue>,
        command_id: UUID4,
        ts_init: UnixNanos,
        correlation_id: Option<UUID4>,
        params: Option<Params>,
    ) -> Self {
        check_client_id_or_venue(&client_id, &venue);
        Self {
            instrument_id,
            client_id,
            venue,
            command_id,
            ts_init,
            correlation_id,
            params,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeOptionGreeks {
    pub instrument_id: InstrumentId,
    pub client_id: Option<ClientId>,
    pub venue: Option<Venue>,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub correlation_id: Option<UUID4>,
    pub params: Option<Params>,
}

impl UnsubscribeOptionGreeks {
    /// Creates a new [`UnsubscribeOptionGreeks`] instance.
    pub fn new(
        instrument_id: InstrumentId,
        client_id: Option<ClientId>,
        venue: Option<Venue>,
        command_id: UUID4,
        ts_init: UnixNanos,
        correlation_id: Option<UUID4>,
        params: Option<Params>,
    ) -> Self {
        check_client_id_or_venue(&client_id, &venue);
        Self {
            instrument_id,
            client_id,
            venue,
            command_id,
            ts_init,
            correlation_id,
            params,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeInstrumentClose {
    pub instrument_id: InstrumentId,
    pub client_id: Option<ClientId>,
    pub venue: Option<Venue>,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub correlation_id: Option<UUID4>,
    pub params: Option<Params>,
}

impl UnsubscribeInstrumentClose {
    /// Creates a new [`UnsubscribeInstrumentClose`] instance.
    pub fn new(
        instrument_id: InstrumentId,
        client_id: Option<ClientId>,
        venue: Option<Venue>,
        command_id: UUID4,
        ts_init: UnixNanos,
        correlation_id: Option<UUID4>,
        params: Option<Params>,
    ) -> Self {
        check_client_id_or_venue(&client_id, &venue);
        Self {
            instrument_id,
            client_id,
            venue,
            command_id,
            ts_init,
            correlation_id,
            params,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnsubscribeOptionChain {
    pub series_id: OptionSeriesId,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub client_id: Option<ClientId>,
    pub venue: Option<Venue>,
}

impl UnsubscribeOptionChain {
    /// Creates a new [`UnsubscribeOptionChain`] instance.
    pub fn new(
        series_id: OptionSeriesId,
        command_id: UUID4,
        ts_init: UnixNanos,
        client_id: Option<ClientId>,
        venue: Option<Venue>,
    ) -> Self {
        check_client_id_or_venue(&client_id, &venue);
        Self {
            series_id,
            command_id,
            ts_init,
            client_id,
            venue,
        }
    }
}
