use std::fmt::Display;

use derive_builder::Builder;
use serde::{Deserialize, Serialize};
use vibe_core::{Params, UUID4, UnixNanos};
use vibe_model::identifiers::{
    AccountId, ClientId, ClientOrderId, InstrumentId, StrategyId, TraderId, VenueOrderId,
};

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, Builder)]
#[serde(tag = "type")]
pub struct QueryAccount {
    pub trader_id: TraderId,
    pub client_id: Option<ClientId>,
    pub account_id: AccountId,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub params: Option<Params>,
    #[builder(default)]
    pub correlation_id: Option<UUID4>,
    #[builder(default)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<UUID4>,
}

impl QueryAccount {
    /// Creates a new [`QueryAccount`] instance.
    #[must_use]
    pub const fn new(
        trader_id: TraderId,
        client_id: Option<ClientId>,
        account_id: AccountId,
        command_id: UUID4,
        ts_init: UnixNanos,
        params: Option<Params>,
        correlation_id: Option<UUID4>,
    ) -> Self {
        Self {
            trader_id,
            client_id,
            account_id,
            command_id,
            ts_init,
            params,
            correlation_id,
            causation_id: None,
        }
    }
}

impl Display for QueryAccount {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "QueryAccount(client_id={:?}, account_id={})",
            self.client_id, self.account_id,
        )
    }
}

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, Builder)]
#[serde(tag = "type")]
pub struct QueryOrder {
    pub trader_id: TraderId,
    pub client_id: Option<ClientId>,
    pub strategy_id: StrategyId,
    pub instrument_id: InstrumentId,
    pub client_order_id: ClientOrderId,
    pub venue_order_id: Option<VenueOrderId>,
    pub command_id: UUID4,
    pub ts_init: UnixNanos,
    pub params: Option<Params>,
    #[builder(default)]
    pub correlation_id: Option<UUID4>,
    #[builder(default)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<UUID4>,
}

impl QueryOrder {
    /// Creates a new [`QueryOrder`] instance.
    #[expect(clippy::too_many_arguments)]
    #[must_use]
    pub const fn new(
        trader_id: TraderId,
        client_id: Option<ClientId>,
        strategy_id: StrategyId,
        instrument_id: InstrumentId,
        client_order_id: ClientOrderId,
        venue_order_id: Option<VenueOrderId>,
        command_id: UUID4,
        ts_init: UnixNanos,
        params: Option<Params>,
        correlation_id: Option<UUID4>,
    ) -> Self {
        Self {
            trader_id,
            client_id,
            strategy_id,
            instrument_id,
            client_order_id,
            venue_order_id,
            command_id,
            ts_init,
            params,
            correlation_id,
            causation_id: None,
        }
    }
}

impl Display for QueryOrder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "QueryOrder(instrument_id={}, client_order_id={}, venue_order_id={:?})",
            self.instrument_id, self.client_order_id, self.venue_order_id,
        )
    }
}

#[cfg(test)]
mod tests {}
