use crate::{
    envelope::{OwnerEventEnvelope, TelemetryEnvelope},
    projection::{GlobalStatusView, SourceFrontier, StatusProjection},
};

/// Read-only adapter boundary for a future Owner outbox.
pub trait OwnerEventSource {
    type Error;

    fn read_after(
        &self,
        frontier: &SourceFrontier,
        limit: usize,
    ) -> Result<Vec<OwnerEventEnvelope>, Self::Error>;
}

/// Read-only adapter boundary for a future telemetry backend.
pub trait TelemetrySource {
    type Error;

    fn read_observations(&self, limit: usize) -> Result<Vec<TelemetryEnvelope>, Self::Error>;
}

/// Consumer-facing status access is query-only.
pub trait GlobalStatusReadPort {
    fn global_status(&self, now_epoch_ms: u64) -> GlobalStatusView;
}

impl GlobalStatusReadPort for StatusProjection {
    fn global_status(&self, now_epoch_ms: u64) -> GlobalStatusView {
        self.global_status(now_epoch_ms)
    }
}
