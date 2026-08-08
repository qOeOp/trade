//! WebSocket message dispatch context for the Derive data client.

use std::sync::{Arc, Mutex};

use vibe_common::{cache::quote::QuoteCache, messages::DataEvent};
use vibe_core::{AtomicMap, AtomicSet, time::AtomicTime};
use vibe_model::{identifiers::InstrumentId, instruments::InstrumentAny};

pub(crate) struct WsMessageContext {
    pub(crate) clock: &'static AtomicTime,
    pub(crate) data_sender: tokio::sync::mpsc::UnboundedSender<DataEvent>,
    pub(crate) instruments: Arc<AtomicMap<InstrumentId, InstrumentAny>>,
    pub(crate) active_book_delta_channels: Arc<AtomicMap<InstrumentId, String>>,
    pub(crate) active_book_depth10_channels: Arc<AtomicMap<InstrumentId, String>>,
    pub(crate) active_ticker_channels: Arc<AtomicMap<InstrumentId, String>>,
    pub(crate) active_quote_subs: Arc<AtomicSet<InstrumentId>>,
    pub(crate) active_trade_subs: Arc<AtomicSet<InstrumentId>>,
    pub(crate) active_mark_subs: Arc<AtomicSet<InstrumentId>>,
    pub(crate) active_index_subs: Arc<AtomicSet<InstrumentId>>,
    pub(crate) active_funding_subs: Arc<AtomicSet<InstrumentId>>,
    pub(crate) active_greeks_subs: Arc<AtomicSet<InstrumentId>>,
    pub(crate) subscription_lock: Arc<Mutex<()>>,
    pub(crate) quote_cache: Arc<Mutex<QuoteCache>>,
}
