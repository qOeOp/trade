use anyhow::{Result, bail};
use std::sync::Arc;
use tokio::sync::{RwLock, watch};
use trade_l2_order_book_core::{BookSnapshot, DepthUpdate, OrderBook, Snapshot};

#[derive(Clone, Debug, Default)]
pub struct Watermark {
    pub symbol: String,
    pub stream_epoch: String,
    pub last_update_id: u64,
    pub local_receive_time_ms: u64,
    pub published_at_ms: u64,
    pub continuity_status: String,
    pub resync_required: bool,
}

pub struct OwnerState {
    pub symbol: String,
    pub service_status: String,
    pub stream_epoch: String,
    pub continuity_status: String,
    pub source_ready: bool,
    pub raw_writer_ready: bool,
    pub projector_ready: bool,
    pub book: Option<OrderBook>,
    pub last_update_id: u64,
    pub exchange_event_time_ms: u64,
    pub exchange_transaction_time_ms: u64,
    pub local_receive_time_ms: u64,
    pub published_at_ms: u64,
    pub incident_count: u64,
    pub last_incident: String,
}

#[derive(Clone)]
pub struct SharedState {
    inner: Arc<RwLock<OwnerState>>,
    watermark: watch::Sender<Watermark>,
}

impl SharedState {
    pub fn new(symbol: String) -> Self {
        let initial = Watermark {
            symbol: symbol.clone(),
            continuity_status: "starting".to_string(),
            resync_required: true,
            ..Watermark::default()
        };
        let (watermark, _) = watch::channel(initial);
        Self {
            inner: Arc::new(RwLock::new(OwnerState {
                symbol,
                service_status: "starting".to_string(),
                stream_epoch: String::new(),
                continuity_status: "starting".to_string(),
                source_ready: false,
                raw_writer_ready: false,
                projector_ready: false,
                book: None,
                last_update_id: 0,
                exchange_event_time_ms: 0,
                exchange_transaction_time_ms: 0,
                local_receive_time_ms: 0,
                published_at_ms: 0,
                incident_count: 0,
                last_incident: String::new(),
            })),
            watermark,
        }
    }

    pub async fn begin_epoch(
        &self,
        stream_epoch: String,
        snapshot: &Snapshot,
        max_levels: usize,
        now_ms: u64,
    ) -> Result<()> {
        let book = OrderBook::from_snapshot(snapshot, max_levels)?;
        let mut state = self.inner.write().await;
        state.service_status = "running".to_string();
        state.stream_epoch = stream_epoch;
        state.continuity_status = "bridging".to_string();
        state.source_ready = false;
        state.raw_writer_ready = true;
        state.projector_ready = false;
        state.last_update_id = snapshot.last_update_id;
        state.published_at_ms = now_ms;
        state.book = Some(book);
        self.publish_watermark(&state, true);
        Ok(())
    }

    pub async fn apply(&self, update: &DepthUpdate, now_ms: u64) -> Result<()> {
        let mut state = self.inner.write().await;
        let book = state
            .book
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("book unavailable"))?;
        book.apply(update)?;
        state.continuity_status = "live".to_string();
        state.source_ready = true;
        state.raw_writer_ready = true;
        state.projector_ready = true;
        state.last_update_id = update.final_update_id;
        state.exchange_event_time_ms = update.event_time_ms;
        state.exchange_transaction_time_ms = update.transaction_time_ms;
        state.local_receive_time_ms = update.local_receive_time_ms;
        state.published_at_ms = now_ms;
        self.publish_watermark(&state, false);
        Ok(())
    }

    pub async fn mark_not_live(&self, status: &str, reason: &str, incident: bool, now_ms: u64) {
        let mut state = self.inner.write().await;
        state.continuity_status = status.to_string();
        state.source_ready = false;
        state.projector_ready = false;
        state.published_at_ms = now_ms;
        if incident {
            state.incident_count += 1;
            state.last_incident = reason.to_string();
        }
        self.publish_watermark(&state, true);
    }

    pub async fn mark_writer_failed(&self, reason: &str, now_ms: u64) {
        let mut state = self.inner.write().await;
        state.service_status = "degraded".to_string();
        state.continuity_status = "degraded".to_string();
        state.source_ready = false;
        state.raw_writer_ready = false;
        state.projector_ready = false;
        state.published_at_ms = now_ms;
        state.incident_count += 1;
        state.last_incident = reason.to_string();
        self.publish_watermark(&state, true);
    }

    pub async fn current_book(&self, depth: usize) -> Result<(OwnerView, BookSnapshot)> {
        let state = self.inner.read().await;
        if state.continuity_status != "live" || !state.source_ready || !state.raw_writer_ready {
            bail!("current book is not live");
        }
        let book = state
            .book
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("book unavailable"))?;
        Ok((OwnerView::from(&*state), book.snapshot(Some(depth))?))
    }

    pub async fn view(&self) -> OwnerView {
        OwnerView::from(&*self.inner.read().await)
    }

    pub fn subscribe(&self) -> watch::Receiver<Watermark> {
        self.watermark.subscribe()
    }

    fn publish_watermark(&self, state: &OwnerState, resync_required: bool) {
        self.watermark.send_replace(Watermark {
            symbol: state.symbol.clone(),
            stream_epoch: state.stream_epoch.clone(),
            last_update_id: state.last_update_id,
            local_receive_time_ms: state.local_receive_time_ms,
            published_at_ms: state.published_at_ms,
            continuity_status: state.continuity_status.clone(),
            resync_required,
        });
    }
}

#[derive(Clone, Debug)]
pub struct OwnerView {
    pub symbol: String,
    pub service_status: String,
    pub stream_epoch: String,
    pub continuity_status: String,
    pub source_ready: bool,
    pub raw_writer_ready: bool,
    pub projector_ready: bool,
    pub last_update_id: u64,
    pub exchange_event_time_ms: u64,
    pub exchange_transaction_time_ms: u64,
    pub local_receive_time_ms: u64,
    pub published_at_ms: u64,
    pub incident_count: u64,
    pub last_incident: String,
}

impl From<&OwnerState> for OwnerView {
    fn from(value: &OwnerState) -> Self {
        Self {
            symbol: value.symbol.clone(),
            service_status: value.service_status.clone(),
            stream_epoch: value.stream_epoch.clone(),
            continuity_status: value.continuity_status.clone(),
            source_ready: value.source_ready,
            raw_writer_ready: value.raw_writer_ready,
            projector_ready: value.projector_ready,
            last_update_id: value.last_update_id,
            exchange_event_time_ms: value.exchange_event_time_ms,
            exchange_transaction_time_ms: value.exchange_transaction_time_ms,
            local_receive_time_ms: value.local_receive_time_ms,
            published_at_ms: value.published_at_ms,
            incident_count: value.incident_count,
            last_incident: value.last_incident.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> Snapshot {
        Snapshot {
            last_update_id: 100,
            bids: vec![["100".to_string(), "1".to_string()]],
            asks: vec![["101".to_string(), "1".to_string()]],
        }
    }

    #[tokio::test]
    async fn current_book_is_available_only_while_live() {
        let state = SharedState::new("BTCUSDT".to_string());
        assert!(state.current_book(20).await.is_err());
        state
            .begin_epoch("epoch-1".to_string(), &snapshot(), 10, 1)
            .await
            .expect("epoch");
        assert!(state.current_book(20).await.is_err());
        state
            .apply(
                &DepthUpdate {
                    event_time_ms: 2,
                    transaction_time_ms: 1,
                    local_receive_time_ms: 3,
                    first_update_id: 100,
                    final_update_id: 101,
                    previous_final_update_id: 99,
                    bids: Vec::new(),
                    asks: Vec::new(),
                },
                4,
            )
            .await
            .expect("apply");
        assert!(state.current_book(20).await.is_ok());
        state.mark_not_live("resyncing", "gap", true, 5).await;
        assert!(state.current_book(20).await.is_err());
    }

    #[tokio::test]
    async fn slow_watermark_consumer_observes_latest_state_and_epoch_resync() {
        let state = SharedState::new("BTCUSDT".to_string());
        let mut receiver = state.subscribe();
        state
            .begin_epoch("epoch-1".to_string(), &snapshot(), 10, 1)
            .await
            .expect("epoch 1");
        for update_id in 101..=103 {
            state
                .apply(
                    &DepthUpdate {
                        event_time_ms: update_id,
                        transaction_time_ms: update_id - 1,
                        local_receive_time_ms: update_id + 1,
                        first_update_id: update_id,
                        final_update_id: update_id,
                        previous_final_update_id: update_id - 1,
                        bids: Vec::new(),
                        asks: Vec::new(),
                    },
                    update_id + 2,
                )
                .await
                .expect("apply");
        }
        receiver.changed().await.expect("latest watermark");
        let latest = receiver.borrow_and_update().clone();
        assert_eq!(latest.last_update_id, 103);
        assert!(!latest.resync_required);

        state
            .begin_epoch("epoch-2".to_string(), &snapshot(), 10, 200)
            .await
            .expect("epoch 2");
        receiver.changed().await.expect("epoch watermark");
        let rollover = receiver.borrow_and_update().clone();
        assert_eq!(rollover.stream_epoch, "epoch-2");
        assert!(rollover.resync_required);
    }
}
