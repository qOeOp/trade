//! Crate-private diagnostics for R&D Owner refusals that collapse into `SubmittedOrUnknown`.
//!
//! `submit_v2` is fail-closed: when a stored fact, an authority, or a store disagrees with the
//! request, the caller learns only `SUBMITTED_OR_UNKNOWN` and is told to resolve the same request
//! identity. That is the contract, and this module does not change it. The response returned to a
//! caller is byte-identical with or without this channel, and nothing here reaches an API
//! response, an error variant, a receipt or a canonical byte.
//!
//! What it changes is whether the Owner itself can say why it refused. Every refusal site in
//! `submit_v2` discarded its cause one line from where it was produced, so locating one meant an
//! instrumented build against a disposable store. Market Data's `storage_diagnostic` is the
//! precedent; this is the same channel for the R&D Owner.
//!
//! Scope is a refusal that the response does not name. A refusal the contract already names -
//! `ConflictingReplay`, `Unauthorized`, `Storage` - is not reported here.

use std::fmt::Display;

/// Records why a refusal collapsed into `SubmittedOrUnknown`, then discards the cause.
///
/// `coordinate` names the exact site in stable, greppable form, for example
/// `research_goal_owner.submit_v2.basis_stage.load`. It is a fixed string rather than a formatted
/// one so that a reader can find the site without running the code. `cause` is the error the
/// site received, or a fixed sentence naming the invariant that did not hold.
///
/// Emitted at `WARN` because a refusal here is not expected: it means either the store is
/// genuinely unavailable or something durable disagrees with the request, and both are worth
/// seeing without turning on debug logging first.
pub(crate) fn refused_by_store(coordinate: &'static str, cause: &impl Display) {
    tracing::warn!(
        coordinate,
        cause = %cause,
        "R&D Owner refused into SubmittedOrUnknown"
    );
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::sync::{Arc, Mutex};

    use tracing_subscriber::fmt::MakeWriter;

    /// One shared byte buffer the subscriber writes every event into.
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
    fn a_refusal_names_its_coordinate_and_cause_at_warn() {
        let sink = Sink::default();
        let subscriber = tracing_subscriber::fmt().with_writer(sink.clone()).finish();
        let coordinate = "research_goal_owner.submit_v2.basis_stage.load";
        let cause = "permission denied for schema composer_private";
        tracing::subscriber::with_default(subscriber, || {
            super::refused_by_store(coordinate, &cause);
        });
        let written = String::from_utf8(sink.0.lock().expect("sink lock").clone())
            .expect("subscriber output is UTF-8");

        assert!(written.contains("WARN"), "{written}");
        assert!(written.contains(coordinate), "{written}");
        assert!(written.contains(cause), "{written}");
        assert!(
            written.contains("R&D Owner refused into SubmittedOrUnknown"),
            "{written}"
        );
    }
}
