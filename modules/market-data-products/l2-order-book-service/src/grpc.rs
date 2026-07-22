use crate::persistence::unix_time_ms;
use crate::proto::l2_order_book_server::L2OrderBook;
use crate::proto::{
    BookRequest, BookSnapshot, BookWatermark, HealthRequest, HealthSnapshot, PriceLevel,
    WatchRequest,
};
use crate::state::{SharedState, Watermark};
use futures_util::Stream;
use std::pin::Pin;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::WatchStream;
use tonic::{Request, Response, Status};

#[derive(Clone)]
pub struct GrpcService {
    state: SharedState,
    stale_after_ms: u64,
}

impl GrpcService {
    pub fn new(state: SharedState, stale_after_ms: u64) -> Self {
        Self {
            state,
            stale_after_ms,
        }
    }

    async fn validate_symbol(&self, symbol: &str) -> Result<(), Status> {
        let view = self.state.view().await;
        if symbol != view.symbol {
            return Err(Status::not_found("symbol is not owned by this service"));
        }
        Ok(())
    }
}

#[tonic::async_trait]
impl L2OrderBook for GrpcService {
    async fn get_current_book(
        &self,
        request: Request<BookRequest>,
    ) -> Result<Response<BookSnapshot>, Status> {
        let request = request.into_inner();
        self.validate_symbol(&request.symbol).await?;
        let depth = if request.depth == 0 {
            1_000
        } else {
            usize::try_from(request.depth.min(5_000)).expect("u32 fits usize")
        };
        let (view, book) = self
            .state
            .current_book(depth)
            .await
            .map_err(|error| Status::unavailable(error.to_string()))?;
        let now = unix_time_ms().map_err(|error| Status::internal(error.to_string()))?;
        let freshness = now.saturating_sub(view.local_receive_time_ms);
        if freshness > self.stale_after_ms {
            return Err(Status::unavailable("current book is stale"));
        }
        Ok(Response::new(BookSnapshot {
            schema_version: "trade.l2-current-book.v1".to_string(),
            symbol: view.symbol,
            stream_epoch: view.stream_epoch,
            last_update_id: book.last_update_id,
            exchange_event_time_ms: view.exchange_event_time_ms,
            exchange_transaction_time_ms: view.exchange_transaction_time_ms,
            local_receive_time_ms: view.local_receive_time_ms,
            published_at_ms: view.published_at_ms,
            freshness_ms: freshness,
            continuity_status: view.continuity_status,
            book_hash: book.book_hash,
            bids: levels(book.bids),
            asks: levels(book.asks),
        }))
    }

    type WatchBookStream =
        Pin<Box<dyn Stream<Item = Result<BookWatermark, Status>> + Send + 'static>>;

    async fn watch_book(
        &self,
        request: Request<WatchRequest>,
    ) -> Result<Response<Self::WatchBookStream>, Status> {
        let request = request.into_inner();
        self.validate_symbol(&request.symbol).await?;
        let stream = WatchStream::new(self.state.subscribe()).map(watermark_result);
        Ok(Response::new(Box::pin(stream)))
    }

    async fn get_health(
        &self,
        request: Request<HealthRequest>,
    ) -> Result<Response<HealthSnapshot>, Status> {
        let request = request.into_inner();
        self.validate_symbol(&request.symbol).await?;
        let view = self.state.view().await;
        let now = unix_time_ms().map_err(|error| Status::internal(error.to_string()))?;
        let freshness = now.saturating_sub(view.local_receive_time_ms);
        let read_ready = view.source_ready
            && view.raw_writer_ready
            && view.projector_ready
            && view.continuity_status == "live"
            && freshness <= self.stale_after_ms;
        Ok(Response::new(HealthSnapshot {
            schema_version: "trade.l2-health.v1".to_string(),
            symbol: view.symbol,
            service_status: view.service_status,
            stream_epoch: view.stream_epoch,
            continuity_status: view.continuity_status,
            source_ready: view.source_ready,
            raw_writer_ready: view.raw_writer_ready,
            projector_ready: view.projector_ready,
            read_ready,
            broker_enabled: false,
            broker_ready: false,
            last_update_id: view.last_update_id,
            last_receive_time_ms: view.local_receive_time_ms,
            freshness_ms: freshness,
            incident_count: view.incident_count,
            last_incident: view.last_incident,
        }))
    }
}

fn levels(values: Vec<[String; 2]>) -> Vec<PriceLevel> {
    values
        .into_iter()
        .map(|[price, quantity]| PriceLevel { price, quantity })
        .collect()
}

fn watermark(value: Watermark) -> BookWatermark {
    BookWatermark {
        schema_version: "trade.l2-book-watermark.v1".to_string(),
        symbol: value.symbol,
        stream_epoch: value.stream_epoch,
        last_update_id: value.last_update_id,
        local_receive_time_ms: value.local_receive_time_ms,
        published_at_ms: value.published_at_ms,
        continuity_status: value.continuity_status,
        resync_required: value.resync_required,
    }
}

#[allow(clippy::result_large_err)]
fn watermark_result(value: Watermark) -> Result<BookWatermark, Status> {
    Ok(watermark(value))
}
