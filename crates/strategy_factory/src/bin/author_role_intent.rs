//! Turns a single-threshold statement into the two bodies the Owner's routes accept.
//!
//! `docs/owners/rd.md` assigns this translation to a proposer - "a language model, a person or any
//! other caller" - and fixes only its output: one canonical `StrategyDesignV2` and, on the
//! bounded-plugin path, the program's meaning. This is a proposer. It invents nothing: every field
//! it emits is either stated in the request or derived by
//! `author_single_threshold_program_v1`, which refuses a statement it cannot author.
//!
//! It exists because `POST /v1/strategy-designs/publish-role-intent` has never been called. The
//! route is mounted and alive - a run against a deployed Owner answered `405` to a GET, `403` to a
//! bad token and `400 MALFORMED_TYPED_REQUEST` to an empty body - and the reason nothing had
//! reached past that is that its body carries a whole `StrategyDesignV2`, which no tool produced.
//!
//! Reads the statement as JSON on stdin, writes both bodies as JSON on stdout:
//!
//! ```text
//! {"publish_role_intent": {"research_request_locator": "...", "design": {...}},
//!  "meaning": {...}}
//! ```
//!
//! A refusal goes to stderr under its own name and exits non-zero, so a caller can tell "this
//! statement cannot be authored" from "the authoring surface is broken".

use std::io::{Read, Write};

use serde::Deserialize;
use vibe_strategy_factory::single_threshold_authoring_v1::{
    DesignRoleIntentProposalV1, SingleThresholdAuthoringRequestV1,
};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProposalInput {
    /// The locator the Owner resolves the Research custody by. The proposer does not invent it:
    /// it names a request the Owner already holds.
    research_request_locator: String,
    /// The statement itself, in the admitted family's own shape.
    authoring: SingleThresholdAuthoringRequestV1,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut raw = String::new();
    std::io::stdin().read_to_string(&mut raw)?;
    let input: ProposalInput = serde_json::from_str(&raw)?;

    // The output shape is `DesignRoleIntentProposalV1`, which lives in the library rather than
    // here so that a test can serialise what this program actually emits and feed it to the
    // Owner's request type. A copy of the shape kept in this binary would drift silently.
    let out =
        match DesignRoleIntentProposalV1::author(&input.research_request_locator, &input.authoring)
        {
            Ok(proposal) => proposal,
            Err(refusal) => {
                // The refusal's own name, not a generic failure: a statement both sides propose the
                // same frame for is a different thing from a malformed one, and the caller has to be
                // able to tell them apart without reading this program.
                writeln!(std::io::stderr(), "refused: {refusal}")?;
                std::process::exit(1);
            }
        };

    serde_json::to_writer_pretty(std::io::stdout(), &out)?;
    writeln!(std::io::stdout())?;
    Ok(())
}
