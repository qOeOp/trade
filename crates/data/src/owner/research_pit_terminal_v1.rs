//! The terminal of a Research request's initial PIT intake, read back by its correlation.
//!
//! R&D submits one initial PIT request per Research Intent, under a correlation it derives from the
//! Intent. A send can end without a response, and re-sending the stored bytes is not idempotent
//! once Market Data's clock head has moved, because the intake compares the request's cut with the
//! current head. So R&D recovers the attempt by correlation instead: Market Data commits at most one
//! initial snapshot per correlation, and this read returns that snapshot's terminal exactly as the
//! intake would have answered it, with the requester the request carried.
//!
//! The terminal carries the Instrument Master digest the intake stamped. R&D substitutes it into
//! its stored submission with `PitSnapshotSubmissionV1::into_request`, which seals the same request
//! identity the terminal reports, and so proves which attempt the terminal answers.

use std::fmt::Display;

use super::{
    pit_market_snapshot_intake_v1::PitMarketSnapshotTerminalV1, source_binding::BindingDigest,
};

/// One committed initial intake: its terminal and the requester its request carried.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResearchPitIntakeTerminalV1 {
    terminal: PitMarketSnapshotTerminalV1,
    requester_identity: BindingDigest,
}

impl ResearchPitIntakeTerminalV1 {
    pub(crate) const fn new(
        terminal: PitMarketSnapshotTerminalV1,
        requester_identity: BindingDigest,
    ) -> Self {
        Self {
            terminal,
            requester_identity,
        }
    }

    /// The terminal the intake answered, rebuilt from the committed snapshot.
    #[must_use]
    pub const fn terminal(&self) -> &PitMarketSnapshotTerminalV1 {
        &self.terminal
    }

    /// The requester identity the committed request carried.
    #[must_use]
    pub const fn requester_identity(&self) -> BindingDigest {
        self.requester_identity
    }
}

/// Why the read could not answer.
///
/// There is no "not found" here: an absent intake is `Ok(None)`. Every error is a failure to read
/// or to trust what was read, and a caller must never take it as "never committed".
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResearchPitTerminalReadErrorV1 {
    /// The store could not be read, or returned custody that does not verify.
    StoreUnavailable,
}

impl Display for ResearchPitTerminalReadErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("the initial PIT intake could not be read")
    }
}

impl std::error::Error for ResearchPitTerminalReadErrorV1 {}
