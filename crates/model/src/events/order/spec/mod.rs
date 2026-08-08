//! Test-only fluent builders for order event types.
//!
//! Each spec mirrors the fields of a production event with sensible defaults, derives
//! [`bon::Builder`], and exposes a `build()` method that funnels through the production
//! constructor so any invariant checks still run on the constructed value.
//!
//! Specs are gated behind the `stubs` feature and must not be referenced from production code.

pub mod accepted;
pub mod cancel_rejected;
pub mod canceled;
pub mod denied;
pub mod emulated;
pub mod expired;
pub mod fill_voided;
pub mod filled;
pub mod initialized;
pub mod modify_rejected;
pub mod pending_cancel;
pub mod pending_update;
pub mod rejected;
pub mod released;
pub mod submitted;
pub mod triggered;
pub mod updated;

pub use accepted::OrderAcceptedSpec;
pub use cancel_rejected::OrderCancelRejectedSpec;
pub use canceled::OrderCanceledSpec;
pub use denied::OrderDeniedSpec;
pub use emulated::OrderEmulatedSpec;
pub use expired::OrderExpiredSpec;
pub use fill_voided::OrderFillVoidedSpec;
pub use filled::OrderFilledSpec;
pub use initialized::OrderInitializedSpec;
pub use modify_rejected::OrderModifyRejectedSpec;
pub use pending_cancel::OrderPendingCancelSpec;
pub use pending_update::OrderPendingUpdateSpec;
pub use rejected::OrderRejectedSpec;
pub use released::OrderReleasedSpec;
pub use submitted::OrderSubmittedSpec;
pub use triggered::OrderTriggeredSpec;
pub use updated::OrderUpdatedSpec;
