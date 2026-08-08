use std::any::Any;

use bytes::Bytes;
use vibe_model::data::{
    Bar, FundingRateUpdate, IndexPriceUpdate, MarkPriceUpdate, OptionGreeks, OrderBookDeltas,
    OrderBookDepth10, QuoteTick, TradeTick,
};

use super::PayloadCodecError;
use crate::msgbus::BusPayloadType;

macro_rules! define_deserializer {
    ($fn_name:ident, $ty:ty) => {
        pub(crate) fn $fn_name(_payload: &[u8]) -> anyhow::Result<$ty> {
            anyhow::bail!("Cap'n Proto decoding requires the `capnp` feature")
        }
    };
}

define_deserializer!(deserialize_order_book_deltas, OrderBookDeltas);
define_deserializer!(deserialize_order_book_depth10, OrderBookDepth10);
define_deserializer!(deserialize_quote, QuoteTick);
define_deserializer!(deserialize_trade, TradeTick);
define_deserializer!(deserialize_bar, Bar);
define_deserializer!(deserialize_mark_price, MarkPriceUpdate);
define_deserializer!(deserialize_index_price, IndexPriceUpdate);
define_deserializer!(deserialize_funding_rate, FundingRateUpdate);
define_deserializer!(deserialize_option_greeks, OptionGreeks);

pub(super) fn serialize_payload(
    payload_type: BusPayloadType,
    _message: &dyn Any,
) -> Result<Bytes, PayloadCodecError> {
    let type_name = payload_type.as_str();
    Err(PayloadCodecError::Dropped(format!(
        "Cap'n Proto serialization for {type_name} requires the `capnp` feature"
    )))
}
