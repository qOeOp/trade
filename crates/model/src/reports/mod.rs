//! Status report types for trading operations.
//!
//! This module provides report types for tracking and communicating the status
//! of various trading operations, including order fills, order status, position
//! status, and mass status requests.

pub mod fill;
pub mod mass_status;
pub mod order;
pub mod position;

// Re-exports
pub use fill::FillReport;
pub use mass_status::ExecutionMassStatus;
pub use order::OrderStatusReport;
pub use position::PositionStatusReport;
use vibe_core::UnixNanos;

use crate::data::HasTsInit;

impl HasTsInit for FillReport {
    fn ts_init(&self) -> UnixNanos {
        self.ts_init
    }
}

impl HasTsInit for OrderStatusReport {
    fn ts_init(&self) -> UnixNanos {
        self.ts_init
    }
}

impl HasTsInit for PositionStatusReport {
    fn ts_init(&self) -> UnixNanos {
        self.ts_init
    }
}

impl HasTsInit for ExecutionMassStatus {
    fn ts_init(&self) -> UnixNanos {
        self.ts_init
    }
}

crate::impl_catalog_path_prefix!(FillReport, "fill_report");
crate::impl_catalog_path_prefix!(OrderStatusReport, "order_status_report");
crate::impl_catalog_path_prefix!(PositionStatusReport, "position_status_report");
crate::impl_catalog_path_prefix!(ExecutionMassStatus, "execution_mass_status");
