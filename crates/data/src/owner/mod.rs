//! Market Data Owner-local authority surfaces.

#[cfg(not(test))]
use std::sync::Arc;

pub mod bar_schedule;
pub mod calendar;
pub(crate) mod corporate_action;
pub(crate) mod correction_policy_projection;
pub mod instrument_master;
pub(crate) mod market_semantics;
pub mod observation_census;
pub mod pit_snapshot;
pub(crate) mod reference_fact_coordinates;
pub mod replay_market_facts_v2;
pub mod research_pit_terminal;
pub mod sample_fact;
pub mod sample_projection;
pub mod sample_projection_v4;
pub mod sealed_replay_input;
pub(crate) mod session;
pub mod shared_time_evidence;
pub mod source_binding;
pub mod strategy_design_role_set;
pub mod strategy_input_binding;
pub mod strategy_input_joined_cut;
pub(crate) mod time_zone;
pub mod universe_selection;

#[cfg(feature = "sealed-strategy-input-acceptance")]
pub use pit_snapshot::sealed_acceptance;

mod postgres;
mod store_admission;

#[cfg(not(test))]
use self::{
    bar_schedule::BarScheduleResolverV1,
    postgres::MarketDataReadPostgres,
    research_pit_terminal::ResearchPitTerminalResolver,
    sample_projection::{
        StrategyInputSampleProjectionResolverV2, StrategyInputSampleProjectionResolverV3,
    },
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

/// Redacted startup failure for the sealed V2 sample-projection resolver.
#[derive(Debug, thiserror::Error)]
#[error("Market Data sample-projection bootstrap rejected: {failure:?}")]
pub struct StrategyInputSampleProjectionBootstrapErrorV2 {
    failure: ResearchPitTerminalBootstrapFailure,
}

/// Redacted startup failure for the sealed V3 BAR sample-projection resolver.
#[derive(Debug, thiserror::Error)]
#[error("Market Data V3 BAR sample-projection bootstrap rejected: {failure:?}")]
pub struct StrategyInputSampleProjectionBootstrapErrorV3 {
    failure: ResearchPitTerminalBootstrapFailure,
}

/// Redacted startup failure for the sealed BAR schedule resolver.
#[derive(Debug, thiserror::Error)]
#[error("Market Data BAR schedule bootstrap rejected: {failure:?}")]
pub struct BarScheduleBootstrapErrorV1 {
    failure: ResearchPitTerminalBootstrapFailure,
}

impl BarScheduleBootstrapErrorV1 {
    #[must_use]
    pub const fn failure(&self) -> ResearchPitTerminalBootstrapFailure {
        self.failure
    }
}

impl StrategyInputSampleProjectionBootstrapErrorV2 {
    #[must_use]
    pub const fn failure(&self) -> ResearchPitTerminalBootstrapFailure {
        self.failure
    }
}

impl StrategyInputSampleProjectionBootstrapErrorV3 {
    #[must_use]
    pub const fn failure(&self) -> ResearchPitTerminalBootstrapFailure {
        self.failure
    }
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

/// Resolves store admission and returns only the sealed V2 sample-projection resolver.
///
/// Disabled mode returns `None`. Required mode fails closed unless the complete admission cut and
/// credential lease are available; no raw row or storage capability crosses this boundary.
///
/// # Errors
///
/// Returns only a redacted configuration or admission category.
#[cfg(not(test))]
pub async fn strategy_input_sample_projection_resolver_v2_from_store_admission_environment()
-> Result<
    Option<Arc<dyn StrategyInputSampleProjectionResolverV2>>,
    StrategyInputSampleProjectionBootstrapErrorV2,
> {
    let bootstrap =
        store_admission::RdOwnerStoreAdmissionBootstrap::from_environment().map_err(|e| {
            StrategyInputSampleProjectionBootstrapErrorV2 {
                failure: map_bootstrap_failure(&e),
            }
        })?;
    consume_sample_projection_store_admission_bootstrap_v2(bootstrap).await
}

/// Lookup-injected form of the sealed V2 sample-projection startup bridge.
///
/// # Errors
///
/// Returns only a redacted configuration or admission category.
#[cfg(not(test))]
pub async fn strategy_input_sample_projection_resolver_v2_from_store_admission_lookup(
    lookup: impl FnMut(&str) -> Option<String>,
) -> Result<
    Option<Arc<dyn StrategyInputSampleProjectionResolverV2>>,
    StrategyInputSampleProjectionBootstrapErrorV2,
> {
    let bootstrap =
        store_admission::RdOwnerStoreAdmissionBootstrap::from_lookup(lookup).map_err(|e| {
            StrategyInputSampleProjectionBootstrapErrorV2 {
                failure: map_bootstrap_failure(&e),
            }
        })?;
    consume_sample_projection_store_admission_bootstrap_v2(bootstrap).await
}

/// Resolves store admission and returns only the sealed V3 BAR sample-projection resolver.
///
/// Disabled mode returns `None`. Required mode fails closed unless the exact complete V3 floor is
/// admitted for the fixed Strategy Factory R&D Owner API consumer. The production admission
/// adapters remain unavailable, so required production startup currently returns a redacted error.
///
/// # Errors
///
/// Returns only a redacted configuration or admission category.
#[cfg(not(test))]
pub async fn strategy_input_sample_projection_resolver_v3_from_store_admission_environment()
-> Result<
    Option<Arc<dyn StrategyInputSampleProjectionResolverV3>>,
    StrategyInputSampleProjectionBootstrapErrorV3,
> {
    let bootstrap =
        store_admission::RdOwnerStoreAdmissionBootstrap::from_environment().map_err(|e| {
            StrategyInputSampleProjectionBootstrapErrorV3 {
                failure: map_bootstrap_failure(&e),
            }
        })?;
    consume_sample_projection_store_admission_bootstrap_v3(bootstrap).await
}

/// Lookup-injected form of the sealed V3 BAR startup bridge.
///
/// # Errors
///
/// Returns only a redacted configuration or admission category.
#[cfg(not(test))]
pub async fn strategy_input_sample_projection_resolver_v3_from_store_admission_lookup(
    lookup: impl FnMut(&str) -> Option<String>,
) -> Result<
    Option<Arc<dyn StrategyInputSampleProjectionResolverV3>>,
    StrategyInputSampleProjectionBootstrapErrorV3,
> {
    let bootstrap =
        store_admission::RdOwnerStoreAdmissionBootstrap::from_lookup(lookup).map_err(|e| {
            StrategyInputSampleProjectionBootstrapErrorV3 {
                failure: map_bootstrap_failure(&e),
            }
        })?;
    consume_sample_projection_store_admission_bootstrap_v3(bootstrap).await
}

/// Resolves store admission and returns only the sealed BAR schedule resolver.
///
/// Disabled mode returns `None`. Required mode fails closed unless admission retains the exact
/// BAR measurement floor and fixed read-only capability.
///
/// # Errors
///
/// Returns only a redacted configuration or admission category.
#[cfg(not(test))]
pub async fn bar_schedule_resolver_v1_from_store_admission_environment()
-> Result<Option<Arc<dyn BarScheduleResolverV1>>, BarScheduleBootstrapErrorV1> {
    let bootstrap =
        store_admission::RdOwnerStoreAdmissionBootstrap::from_environment().map_err(|e| {
            BarScheduleBootstrapErrorV1 {
                failure: map_bootstrap_failure(&e),
            }
        })?;
    consume_bar_schedule_store_admission_bootstrap_v1(bootstrap).await
}

/// Lookup-injected form of the sealed BAR schedule startup bridge.
///
/// # Errors
///
/// Returns only a redacted configuration or admission category.
#[cfg(not(test))]
pub async fn bar_schedule_resolver_v1_from_store_admission_lookup(
    lookup: impl FnMut(&str) -> Option<String>,
) -> Result<Option<Arc<dyn BarScheduleResolverV1>>, BarScheduleBootstrapErrorV1> {
    let bootstrap =
        store_admission::RdOwnerStoreAdmissionBootstrap::from_lookup(lookup).map_err(|e| {
            BarScheduleBootstrapErrorV1 {
                failure: map_bootstrap_failure(&e),
            }
        })?;
    consume_bar_schedule_store_admission_bootstrap_v1(bootstrap).await
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
async fn consume_sample_projection_store_admission_bootstrap_v2(
    bootstrap: store_admission::RdOwnerStoreAdmissionBootstrap,
) -> Result<
    Option<Arc<dyn StrategyInputSampleProjectionResolverV2>>,
    StrategyInputSampleProjectionBootstrapErrorV2,
> {
    match bootstrap {
        store_admission::RdOwnerStoreAdmissionBootstrap::Disabled => Ok(None),
        store_admission::RdOwnerStoreAdmissionBootstrap::Required(request) => {
            let capability = store_admission::admit_rd_owner_market_data_postgres(&request)
                .await
                .map_err(|_| StrategyInputSampleProjectionBootstrapErrorV2 {
                    failure: ResearchPitTerminalBootstrapFailure::StoreAdmissionRejected,
                })?;
            let port = capability
                .into_sample_projection_snapshot_port()
                .map_err(|_| StrategyInputSampleProjectionBootstrapErrorV2 {
                    failure: ResearchPitTerminalBootstrapFailure::StoreAdmissionRejected,
                })?;
            Ok(Some(Arc::new(MarketDataReadPostgres::from_admitted(port))))
        }
    }
}

#[cfg(not(test))]
async fn consume_sample_projection_store_admission_bootstrap_v3(
    bootstrap: store_admission::RdOwnerStoreAdmissionBootstrap,
) -> Result<
    Option<Arc<dyn StrategyInputSampleProjectionResolverV3>>,
    StrategyInputSampleProjectionBootstrapErrorV3,
> {
    match bootstrap {
        store_admission::RdOwnerStoreAdmissionBootstrap::Disabled => Ok(None),
        store_admission::RdOwnerStoreAdmissionBootstrap::Required(request) => {
            let capability = store_admission::admit_rd_owner_market_data_postgres(&request)
                .await
                .map_err(|_| StrategyInputSampleProjectionBootstrapErrorV3 {
                    failure: ResearchPitTerminalBootstrapFailure::StoreAdmissionRejected,
                })?;
            let port = capability
                .into_sample_projection_snapshot_port_v3()
                .map_err(|_| StrategyInputSampleProjectionBootstrapErrorV3 {
                    failure: ResearchPitTerminalBootstrapFailure::StoreAdmissionRejected,
                })?;
            Ok(Some(Arc::new(MarketDataReadPostgres::from_admitted(port))))
        }
    }
}

#[cfg(not(test))]
async fn consume_bar_schedule_store_admission_bootstrap_v1(
    bootstrap: store_admission::RdOwnerStoreAdmissionBootstrap,
) -> Result<Option<Arc<dyn BarScheduleResolverV1>>, BarScheduleBootstrapErrorV1> {
    match bootstrap {
        store_admission::RdOwnerStoreAdmissionBootstrap::Disabled => Ok(None),
        store_admission::RdOwnerStoreAdmissionBootstrap::Required(request) => {
            let capability = store_admission::admit_rd_owner_market_data_postgres(&request)
                .await
                .map_err(|_| BarScheduleBootstrapErrorV1 {
                    failure: ResearchPitTerminalBootstrapFailure::StoreAdmissionRejected,
                })?;
            let port = capability.into_bar_schedule_snapshot_port().map_err(|_| {
                BarScheduleBootstrapErrorV1 {
                    failure: ResearchPitTerminalBootstrapFailure::StoreAdmissionRejected,
                }
            })?;
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
