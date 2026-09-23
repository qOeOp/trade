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

//!
//! ## Three channels, not one
//!
//! This is the first of three. The R&D Owner's `storage_diagnostic` in `vibe-strategy-factory` is
//! scoped to a refusal the response does not name; the Backtest Owner's `canonical_diagnostic` is
//! scoped to a failure of that Owner's own canonical form. Neither rule holds here and this one
//! holds in neither of theirs. The shared part is about seven lines of `tracing`; the unshared
//! part is the scope rule, and an Owner that took the mechanism from a shared crate would take a
//! scope decision it never made.

use std::fmt::{Debug, Display};

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

/// Records that a fail-closed storage boundary refused, locating it by its own source position.
///
/// [`refused_by_store`] is for a boundary a reader has named. This is for the ones nobody named:
/// every module here funnels its store failures through a local `store_error`, which converts the
/// cause into a bare unavailable variant and drops it. There are hundreds of those call sites and
/// inventing a coordinate for each would be inventing three hundred names nobody would keep
/// accurate. The call site already has an exact name - where it is - so this reports that instead.
///
/// The location is the caller's only if the chain from the call site is unbroken: every function
/// between here and it must carry `#[track_caller]`, and the call must be a real call. Passing
/// `store_error` to `map_err` as a function value is not one; the location then resolves inside
/// `core`, which names no boundary at all. That failure compiles and still logs, so it is checked
/// in source by `every_cause_that_reaches_store_error_is_located` rather than left to be noticed.
///
/// Clippy guards the other direction at no cost: `clippy::redundant_closure` does not fire on a
/// closure that wraps a `#[track_caller]` function, so if the attribute is ever dropped, every one
/// of those call sites turns into a warning at once.
///
/// The location is an explicit field rather than something a reader recovers from the event's
/// target, because the Owner API's subscriber is built with `with_target(false)` and prints no
/// module path at all. Under that subscriber an event without these fields names nowhere.
#[track_caller]
pub(crate) fn refused_by_store_at(cause: &impl Debug) {
    let at = std::panic::Location::caller();
    tracing::warn!(
        file = at.file(),
        line = at.line(),
        cause = ?cause,
        "Market Data Owner storage boundary refused"
    );
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use rstest::rstest;

    /// Every store cause this crate discards is recorded at a line that names a real boundary.
    ///
    /// The mechanism is `#[track_caller]`, and it has one silent failure: handing `store_error` to
    /// `map_err` as a function value rather than calling it. The location then resolves inside
    /// `core::ops::function`, which names nothing, and the build stays green and the log stays
    /// populated - the WARN simply points at the standard library. Measured, not assumed: the same
    /// helper reached through a closure reports the call site and reached as a function value
    /// reports `library/core/src/ops/function.rs`.
    ///
    /// So the call shape is checked in source. The opposite mistake - dropping `#[track_caller]`
    /// and keeping the closures - needs no check here: `clippy::redundant_closure` exempts
    /// `#[track_caller]` functions and only those, so it fires on every site the moment the
    /// attribute goes.
    ///
    /// The name says `store_error` and means it. A cause discarded by an inline
    /// `map_err(|_| ...)` is not covered and is not located: there are about 1,600 of those in
    /// this crate's production code, 116 of them inside these same eleven files. They are not one
    /// chokepoint and cannot be routed like one - each is its own question about whether the
    /// variant it returns is even the right refusal - so they are a different change, and this
    /// assertion is deliberately not named as though it had already made it.
    #[rstest]
    fn every_cause_that_reaches_store_error_is_located() {
        // Assembled so this assertion's own source does not contain the shape it forbids.
        let by_value = ["map_err(", "store_error)"].concat();
        let by_value_classified = ["map_err(", "classify_insert)"].concat();
        let closure_form = ["map_err(|cause| ", "store_error(&cause))"].concat();
        let closure_form_classified = ["map_err(|cause| ", "classify_insert(&cause))"].concat();
        let definition = ["fn ", "store_error(cause: &impl Debug)"].concat();
        let recording = ["refused", "_by_store_at("].concat();

        let mut sources = Vec::new();
        collect_rust_sources(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src"),
            &mut sources,
        );
        // The walk names its own file, so a walk that reads nothing cannot pass by reading nothing.
        assert!(
            sources
                .iter()
                .any(|(path, _)| path.ends_with("storage_diagnostic.rs")),
            "the source walk reaches this file; it read {} files",
            sources.len()
        );

        let mut definitions = 0usize;
        let mut located_sites = 0usize;

        for (path, text) in &sources {
            assert!(
                !text.contains(&by_value) && !text.contains(&by_value_classified),
                "{path} hands a cause recorder to map_err as a function value, which records a \
                 location inside core instead of the boundary that refused"
            );
            definitions += text.matches(&definition).count();
            located_sites += text.matches(&closure_form).count();
            located_sites += text.matches(&closure_form_classified).count();

            // Every definition records before it converts, and every function that forwards to one
            // passes the caller's location on. Top-level items in these modules close at column
            // zero, so that delimiter bounds each item without guessing a window size.
            let without_closures = text
                .replace(&closure_form, "")
                .replace(&closure_form_classified, "");

            for item in without_closures.split("\n}\n") {
                if !item.contains(&["store", "_error("].concat()) {
                    continue;
                }
                assert!(
                    item.contains("#[track_caller]"),
                    "{path} calls the cause recorder from an item that does not carry \
                     #[track_caller], so the location it records is this item rather than the \
                     caller that refused"
                );
            }
        }

        assert!(
            definitions > 0,
            "there is at least one cause recorder to check; otherwise this assertion measures \
             nothing and passes for that reason"
        );

        for (path, text) in &sources {
            if text.contains(&definition) {
                assert!(
                    text.contains(&recording),
                    "{path} defines a cause recorder that records nothing"
                );
            }
        }
        // A sibling change describes this crate as one that still discards these causes, which
        // stops being true here. Placed in the guard rather than left as something to remember: a
        // rebase that brings that sentence in merges cleanly, so nothing else would make anyone
        // look at it.
        //
        // Matched against the text with its comment markers and line breaks folded away. The first
        // version searched the raw source and passed on a rebase that brought the sentence in: the
        // real one wraps mid-phrase across two `///` lines, while the sentence injected to prove
        // the assertion fired sat on one line. A probe and a positive control of different shapes
        // agree only by luck.
        let superseded = ["still discards causes", " through `store_error`"].concat();

        for (path, text) in &sources {
            assert!(
                !fold_comment_wrapping(text).contains(&superseded),
                "{path} still says these causes are discarded unnamed, which this guard disproves"
            );
        }

        assert!(
            located_sites >= definitions,
            "every module that defines a cause recorder calls it: {definitions} recorders, \
             {located_sites} located call sites"
        );
    }

    /// Strips comment markers and joins every line with one space, so a phrase a rustfmt wrap
    /// split across two lines is still one phrase.
    fn fold_comment_wrapping(text: &str) -> String {
        let mut folded = String::with_capacity(text.len());

        for line in text.lines() {
            let trimmed = line.trim_start();
            let body = trimmed
                .strip_prefix("///")
                .or_else(|| trimmed.strip_prefix("//!"))
                .or_else(|| trimmed.strip_prefix("//"))
                .unwrap_or(trimmed);
            folded.push_str(body.trim());
            folded.push(' ');
        }
        folded
    }

    fn collect_rust_sources(directory: &Path, into: &mut Vec<(String, String)>) {
        let entries = std::fs::read_dir(directory).expect("the crate source tree is readable");
        for entry in entries {
            let path = entry.expect("a readable directory entry").path();
            if path.is_dir() {
                collect_rust_sources(&path, into);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                let text = std::fs::read_to_string(&path).expect("a readable source file");
                into.push((path.display().to_string(), text));
            }
        }
    }
}
