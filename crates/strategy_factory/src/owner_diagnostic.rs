//! Crate-private diagnostics for R&D Owner fail-closed boundaries.
//!
//! An R&D Owner boundary that cannot prove its custody answers `SubmittedOrUnknown`: the caller
//! learns that the submission is not resolved, never why. That is deliberate, and this module does
//! not change it. The response returned to a caller is byte-identical with or without this channel,
//! and nothing here reaches an API response, an error variant, a receipt or a canonical byte.
//!
//! What it changes is whether the Owner itself can say why it refused. `submit_v2` folds more than
//! twenty distinct refusals -- a store read that failed, a Product Edge admission that expired, a
//! Replay Policy Catalog head that does not exist -- into one unresolved result; locating the
//! missing Catalog head took a fully instrumented build against a disposable PostgreSQL instance.
//! The cause had been discarded one line from where it was produced.
//!
//! This is the R&D Owner's counterpart of the Market Data Owner's `storage_diagnostic`, with the
//! same shape and the same rule: the coordinate is a fixed, greppable string naming the exact
//! boundary, and the cause is recorded and then dropped.

use std::fmt::Display;

/// Records why a fail-closed R&D Owner boundary answered unresolved, then discards the cause.
///
/// `coordinate` names the exact boundary in stable, greppable form, for example
/// `product_edge.submit_v2.final.replay_policy_catalog_v3.resolve`. A predicate the Owner decided
/// for itself names its verdict as the cause; a store error carries the error.
///
/// Emitted at `WARN` because an Owner boundary is not expected to refuse: a refusal means either
/// the store is genuinely unavailable or something upstream disagrees with the custody the Owner
/// holds, and both are worth seeing without turning on debug logging first.
pub(crate) fn refused_by_owner(coordinate: &'static str, cause: &impl Display) {
    tracing::warn!(
        coordinate,
        cause = %cause,
        "R&D Owner fail-closed boundary refused"
    );
}
