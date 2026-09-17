//! Crate-private diagnostics for Market Data Owner storage boundaries.
//!
//! Every Owner storage boundary is fail-closed: a caller learns only that custody is unavailable,
//! never why. That is deliberate, and this module does not change it. The refusal returned to a
//! caller is byte-identical with or without this channel, and nothing here reaches an API response,
//! an error variant, a receipt or a canonical byte.
//!
//! What it changes is whether the Owner itself can say why it refused. PR #572's defect - a
//! `SECURITY DEFINER` facade returning one column while its caller selected three - surfaced as a
//! bare `StoreUnavailable` and could only be located by raising a disposable PostgreSQL instance
//! and reproducing it. The cause had been discarded one line from where it was produced.
//!
//! Scope is the storage boundary only. A meaning refusal - untrusted declaration bytes, a mismatched
//! digest, a rejected claim - is a decision the Owner made and already names itself; it is not
//! reported here.

use std::fmt::Display;

/// Records why a fail-closed storage boundary refused, then discards the cause.
///
/// `coordinate` names the exact boundary in stable, greppable form, for example
/// `strategy_input_binding_registry.pit_facade.fetch_all`. It is a fixed string rather than a
/// formatted one so that a reader can find the site without running the code.
///
/// Emitted at `WARN` because an Owner storage boundary is not expected to refuse: a refusal means
/// either the store is genuinely unavailable or something upstream disagrees with the schema, and
/// both are worth seeing without turning on debug logging first.
pub(crate) fn refused_by_store(coordinate: &'static str, cause: &impl Display) {
    tracing::warn!(
        coordinate,
        cause = %cause,
        "Market Data Owner storage boundary refused"
    );
}
