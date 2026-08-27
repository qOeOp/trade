//! Market Data Owner-local authority surfaces.

#[cfg(not(test))]
use std::sync::Arc;

#[cfg(not(test))]
use vibe_deployment_store_admission::AdmittedMarketDataPostgresCapability;

pub mod pit_snapshot;
pub mod research_pit_terminal;
pub mod shared_time_evidence;
pub mod source_binding;
pub mod strategy_input_binding;

#[cfg(feature = "sealed-strategy-input-acceptance")]
pub use pit_snapshot::sealed_acceptance;

mod postgres;

#[cfg(not(test))]
use self::{
    pit_snapshot::{PitObservationBatchOwnerResolver, PitSnapshotError},
    postgres::MarketDataReadPostgres,
    research_pit_terminal::ResearchPitTerminalResolver,
    source_binding::{SourceBindingError, SourceBindingOwnerResolver},
};

/// Consumes sealed Deployment Store authority into the only production Market Data PostgreSQL
/// surface: an exact read-only Source Binding resolver.
///
/// No DSN, pool, writer, migration, clock, PIT, envelope, or caller-authored evidence crosses this
/// boundary.
///
/// # Errors
///
/// Returns `StoreUnavailable` only when composition itself is unavailable; reads fail closed through
/// the resolver.
#[cfg(not(test))]
pub async fn source_binding_resolver_from_admitted_postgres(
    capability: AdmittedMarketDataPostgresCapability,
) -> Result<Arc<dyn SourceBindingOwnerResolver>, SourceBindingError> {
    let port = std::future::ready(capability.into_source_binding_snapshot_port()).await;
    Ok(Arc::new(MarketDataReadPostgres::from_admitted(port)))
}

/// Consumes sealed Deployment Store authority into the ordinary Research PIT terminal resolver.
///
/// The resolver returns only canonical six-state terminal facts. Store or transport failure stays
/// an error and is never synthesized as a Market Data `UNAVAILABLE` disposition.
///
/// # Errors
///
/// Returns `PersistenceUnavailable` only if composition cannot retain the admitted read port;
/// every later storage/read failure is reported by the resolver itself.
#[cfg(not(test))]
pub async fn research_pit_terminal_resolver_from_admitted_postgres(
    capability: AdmittedMarketDataPostgresCapability,
) -> Result<Arc<dyn ResearchPitTerminalResolver>, PitSnapshotError> {
    let port = std::future::ready(capability.into_pit_terminal_snapshot_port()).await;
    Ok(Arc::new(MarketDataReadPostgres::from_admitted(port)))
}

/// Consumes sealed Deployment Store authority into the fixed read-only PIT-evaluation resolver.
///
/// The resolver receives only an opaque admitted port. It returns a verified complete observation
/// batch and never exposes a DSN, pool, transaction, generic SQL, or caller-selected relation.
///
/// # Errors
///
/// Returns `PersistenceUnavailable` only when composition itself is unavailable; evaluation reads
/// otherwise fail closed through the resolver.
#[cfg(not(test))]
pub async fn pit_observation_batch_resolver_from_admitted_postgres(
    capability: AdmittedMarketDataPostgresCapability,
) -> Result<Arc<dyn PitObservationBatchOwnerResolver>, PitSnapshotError> {
    let port = std::future::ready(capability.into_pit_evaluation_snapshot_port()).await;
    Ok(Arc::new(MarketDataReadPostgres::from_admitted(port)))
}
