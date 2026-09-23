//! Crate-private diagnostics for Backtest Owner refusals that collapse into
//! `IncompleteReconciliation`.
//!
//! `run_exploratory_replay_v2` is fail-closed: a caller whose attempt produced no durable Result
//! learns that the evidence was incomplete and nothing else. That is the contract, and this module
//! does not change it. The value returned to a caller is identical with or without this channel,
//! and nothing here reaches an API response, an error variant, a receipt or a canonical byte.
//!
//! ## Scope: this Owner's own canonical machinery
//!
//! `NativeReplayRunErrorV2::IncompleteReconciliation` says "native Replay V2 evidence is
//! incomplete, duplicated, mismatched, or unresolvable". Four meanings in one sentence, and seven
//! sites answer with it. None of the seven is an upstream refusal. Every one of them is this Owner
//! failing at its own canonical machinery: parsing an identity it formatted a line earlier,
//! digesting bytes it just produced, encoding a request it already holds, or assembling a draft
//! from evidence it already validated. When one of those fails, the caller is told its evidence
//! was wrong, which is not what happened.
//!
//! So the scope here is **a failure of this Owner's own canonical form**: identity formatting and
//! parsing, canonical byte encoding, digest computation, and evidence assembly.
//!
//! Excluded, because the caller is already told: `ResultConstruction`,
//! `OutcomeEvidenceConstruction` and `ResultCommit` each arrive carrying a named cause from the
//! sub-Owner that produced it; `IncompleteSemanticTrace` carries a typed fault;
//! `NativeExecution` carries a string; and the meaning refusals of `ReplayOwnerErrorV2` are named
//! one per meaning already.
//!
//! Also excluded: `ExecutionBundleOwnerUnavailable`. It is not this Owner refusing, it is an
//! upstream capability being absent, and that is a cause the caller should act on by asking
//! upstream. The general rule this channel is held to: **it records a cause this Owner must
//! discard, because the contract is fail-closed and the caller is not owed it. A cause this Owner
//! may pass on should be passed on rather than logged**, which is why that variant now carries the
//! upstream error instead of appearing here.
//!
//! ## Why three channels and not one
//!
//! [`vibe_data`](../../../data/src/owner/storage_diagnostic.rs) has the first, scoped to its
//! storage boundary and excluding the meaning refusals it already names.
//! [`vibe_strategy_factory`](../../../strategy_factory/src/storage_diagnostic.rs) has the second,
//! scoped to a refusal the response does not name. Neither rule holds here: this Owner has no
//! storage boundary of its own on this path, and "the response does not name it" is very nearly
//! always true of an Owner whose meaning refusals are already named one per meaning, so that rule
//! would report almost nothing.
//!
//! The shared part is about seven lines of `tracing`. The unshared part is the rule above, and an
//! Owner that inherited the mechanism from a shared crate would inherit a scope decision it never
//! made. A fourth Owner adding a channel should write its own rule first and expect it to differ
//! again.

use std::fmt::Display;

/// Records why a refusal collapsed into `IncompleteReconciliation`, then discards the cause.
///
/// `coordinate` names the exact site in stable, greppable form, for example
/// `backtest_owner.native_replay.semantic_trace.identity`. It is a fixed string rather than a
/// formatted one so a reader can find the site without running the code. `cause` is the error the
/// site received, or a fixed sentence naming the invariant that did not hold.
pub(crate) fn refused_by_canonical_form(coordinate: &'static str, cause: &impl Display) {
    tracing::warn!(
        coordinate,
        cause = %cause,
        "Backtest Owner refused into IncompleteReconciliation"
    );
}

#[cfg(test)]
mod tests {
    use std::{
        io::Write,
        sync::{Arc, Mutex},
    };

    use tracing_subscriber::fmt::MakeWriter;

    use super::*;

    #[derive(Clone, Default)]
    struct Sink(Arc<Mutex<Vec<u8>>>);

    impl Write for Sink {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().expect("sink lock").extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl<'a> MakeWriter<'a> for Sink {
        type Writer = Self;

        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    #[rstest::rstest]
    fn a_discarded_cause_reaches_the_log_with_its_coordinate() {
        let sink = Sink::default();
        let subscriber = tracing_subscriber::fmt()
            .with_writer(sink.clone())
            .with_ansi(false)
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            refused_by_canonical_form(
                "backtest_owner.native_replay.semantic_trace.identity",
                &"identity is not canonical",
            );
        });
        let recorded = String::from_utf8(sink.0.lock().expect("sink lock").clone()).expect("utf8");

        assert!(
            recorded.contains("backtest_owner.native_replay.semantic_trace.identity"),
            "{recorded}"
        );
        assert!(recorded.contains("identity is not canonical"), "{recorded}");
        assert!(
            recorded.contains("refused into IncompleteReconciliation"),
            "{recorded}"
        );
    }
}
