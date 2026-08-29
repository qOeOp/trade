//! Market Data Owner-local authority surfaces.

#[cfg(not(test))]
use std::sync::Arc;

pub mod pit_snapshot;
pub mod research_pit_terminal;
pub mod sealed_replay_input;
pub mod shared_time_evidence;
pub mod source_binding;
pub mod strategy_input_binding;

#[cfg(feature = "sealed-strategy-input-acceptance")]
pub use pit_snapshot::sealed_acceptance;

mod postgres;
mod store_admission;

#[cfg(not(test))]
use self::{
    postgres::MarketDataReadPostgres, research_pit_terminal::ResearchPitTerminalResolver,
    sealed_replay_input::SealedReplayInputResolver,
};

/// Public startup failure categories for the sealed Research PIT terminal bridge.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResearchPitTerminalBootstrapFailure {
    InvalidMode,
    MissingRequiredIdentity,
    InvalidIdentity,
    StoreAdmissionRejected,
}

/// Redacted startup failure. Private store-admission evidence never crosses the Owner boundary.
#[derive(Debug, thiserror::Error)]
#[error("Market Data Research PIT terminal bootstrap rejected: {failure:?}")]
pub struct ResearchPitTerminalBootstrapError {
    failure: ResearchPitTerminalBootstrapFailure,
}

/// Redacted startup failure for the sealed replay-input read port.
#[derive(Debug, thiserror::Error)]
#[error("Market Data sealed replay-input bootstrap rejected: {failure:?}")]
pub struct SealedReplayInputBootstrapError {
    failure: ResearchPitTerminalBootstrapFailure,
}

impl SealedReplayInputBootstrapError {
    #[must_use]
    pub const fn failure(&self) -> ResearchPitTerminalBootstrapFailure {
        self.failure
    }
}

impl ResearchPitTerminalBootstrapError {
    #[must_use]
    pub const fn failure(&self) -> ResearchPitTerminalBootstrapFailure {
        self.failure
    }
}

/// Resolves the configured store admission and returns only a sealed Research PIT terminal port.
///
/// Disabled mode preserves the existing no-repository default. Required mode performs the complete
/// non-business admission pipeline before retaining a fixed read-only snapshot port inside Market
/// Data. No capability, credential, raw PIT/source/clock evidence, or generic query crosses this
/// boundary.
///
/// # Errors
///
/// Returns a redacted fail-closed category when configuration or store admission is unavailable.
#[cfg(not(test))]
pub async fn research_pit_terminal_resolver_from_store_admission_environment()
-> Result<Option<Arc<dyn ResearchPitTerminalResolver>>, ResearchPitTerminalBootstrapError> {
    let bootstrap = store_admission::RdOwnerStoreAdmissionBootstrap::from_environment()
        .map_err(|e| map_bootstrap_error(&e))?;
    consume_store_admission_bootstrap(bootstrap).await
}

/// Lookup-injected form of the sealed startup bridge for deterministic composition tests.
///
/// # Errors
///
/// Returns a redacted fail-closed category when configuration or store admission is unavailable.
#[cfg(not(test))]
pub async fn research_pit_terminal_resolver_from_store_admission_lookup(
    lookup: impl FnMut(&str) -> Option<String>,
) -> Result<Option<Arc<dyn ResearchPitTerminalResolver>>, ResearchPitTerminalBootstrapError> {
    let bootstrap = store_admission::RdOwnerStoreAdmissionBootstrap::from_lookup(lookup)
        .map_err(|e| map_bootstrap_error(&e))?;
    consume_store_admission_bootstrap(bootstrap).await
}

/// Resolves store admission and returns only the sealed Strategy Factory replay-input read port.
///
/// The default remains disabled. Required mode admits the fixed read-only Market Data snapshot
/// capability; no raw row, storage capability, credential, or writer crosses this boundary.
///
/// # Errors
///
/// Returns a redacted fail-closed category when configuration or store admission is unavailable.
#[cfg(not(test))]
pub async fn sealed_replay_input_resolver_from_store_admission_environment()
-> Result<Option<Arc<dyn SealedReplayInputResolver>>, SealedReplayInputBootstrapError> {
    let bootstrap =
        store_admission::RdOwnerStoreAdmissionBootstrap::from_environment().map_err(|e| {
            SealedReplayInputBootstrapError {
                failure: map_bootstrap_failure(&e),
            }
        })?;
    consume_replay_input_store_admission_bootstrap(bootstrap).await
}

/// Lookup-injected form of the sealed replay-input startup bridge.
///
/// # Errors
///
/// Returns a redacted fail-closed category when configuration or store admission is unavailable.
#[cfg(not(test))]
pub async fn sealed_replay_input_resolver_from_store_admission_lookup(
    lookup: impl FnMut(&str) -> Option<String>,
) -> Result<Option<Arc<dyn SealedReplayInputResolver>>, SealedReplayInputBootstrapError> {
    let bootstrap =
        store_admission::RdOwnerStoreAdmissionBootstrap::from_lookup(lookup).map_err(|e| {
            SealedReplayInputBootstrapError {
                failure: map_bootstrap_failure(&e),
            }
        })?;
    consume_replay_input_store_admission_bootstrap(bootstrap).await
}

#[cfg(not(test))]
async fn consume_store_admission_bootstrap(
    bootstrap: store_admission::RdOwnerStoreAdmissionBootstrap,
) -> Result<Option<Arc<dyn ResearchPitTerminalResolver>>, ResearchPitTerminalBootstrapError> {
    match bootstrap {
        store_admission::RdOwnerStoreAdmissionBootstrap::Disabled => Ok(None),
        store_admission::RdOwnerStoreAdmissionBootstrap::Required(request) => {
            let capability = store_admission::admit_rd_owner_market_data_postgres(&request)
                .await
                .map_err(|_| ResearchPitTerminalBootstrapError {
                    failure: ResearchPitTerminalBootstrapFailure::StoreAdmissionRejected,
                })?;
            let port = capability.into_pit_terminal_snapshot_port();
            Ok(Some(Arc::new(MarketDataReadPostgres::from_admitted(port))))
        }
    }
}

#[cfg(not(test))]
async fn consume_replay_input_store_admission_bootstrap(
    bootstrap: store_admission::RdOwnerStoreAdmissionBootstrap,
) -> Result<Option<Arc<dyn SealedReplayInputResolver>>, SealedReplayInputBootstrapError> {
    match bootstrap {
        store_admission::RdOwnerStoreAdmissionBootstrap::Disabled => Ok(None),
        store_admission::RdOwnerStoreAdmissionBootstrap::Required(request) => {
            let capability = store_admission::admit_rd_owner_market_data_postgres(&request)
                .await
                .map_err(|_| SealedReplayInputBootstrapError {
                    failure: ResearchPitTerminalBootstrapFailure::StoreAdmissionRejected,
                })?;
            let port = capability.into_pit_evaluation_snapshot_port();
            Ok(Some(Arc::new(MarketDataReadPostgres::from_admitted(port))))
        }
    }
}

#[cfg(not(test))]
fn map_bootstrap_error(
    error: &store_admission::BootstrapConfigurationError,
) -> ResearchPitTerminalBootstrapError {
    let failure = map_bootstrap_failure(error);
    ResearchPitTerminalBootstrapError { failure }
}

#[cfg(not(test))]
fn map_bootstrap_failure(
    error: &store_admission::BootstrapConfigurationError,
) -> ResearchPitTerminalBootstrapFailure {
    match error {
        store_admission::BootstrapConfigurationError::InvalidMode => {
            ResearchPitTerminalBootstrapFailure::InvalidMode
        }
        store_admission::BootstrapConfigurationError::MissingRequiredIdentity(_) => {
            ResearchPitTerminalBootstrapFailure::MissingRequiredIdentity
        }
        store_admission::BootstrapConfigurationError::InvalidIdentity => {
            ResearchPitTerminalBootstrapFailure::InvalidIdentity
        }
    }
}
