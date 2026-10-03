//! The derived view of a PIT window custody chain at one frame (slice T0-5): which cross-section
//! version of each input timeframe a frame's strategy inputs read, and the frame's decision cut.
//!
//! The governing text is `docs/owners/market-data.md`, "PIT window custody", "Derived view". For
//! frame `k` at `e_k`:
//!
//! - the execution timeframe's cross-section at `e_k` fixes `d_k`: the availability of that
//!   cross-section's original version, so a later correction never moves the decision cut it is
//!   selected against;
//! - a frame is covered only when `d_k < e_k + interval`, the next frame's event on the grid;
//! - in each selected cross-section the view takes the highest sequence published at or before
//!   `d_k`, and a withdrawn one leaves the frame uncovered;
//! - every other input timeframe contributes its latest cross-section available by `d_k`, and a
//!   withdrawn or not yet published latest one leaves the frame uncovered rather than substituting
//!   an older bar;
//! - the fill timeframe is never an input, so its versions are never selected.
//!
//! Everything here is pure: the frames port, the pool resolver and the admitted-port resolver all
//! select through it, so the three cannot disagree on a view.

#![cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "read by the frames port and the custody frame resolver (T0-5 C6 and C9)"
    )
)]

use std::collections::{BTreeMap, BTreeSet};

use sha2::{Digest as _, Sha256};

use super::{
    CrossSectionVersionKindV1,
    schedule::{PitWindowScheduleFactV1, frame_instants_v1, window_schedule_admits_frame_v1},
};
use crate::owner::source_binding::BindingDigest;

/// The schema version a view identity binds.
pub(crate) const PIT_WINDOW_VIEW_SCHEMA_V1: u16 = 1;
const VIEW_DOMAIN: &[u8] = b"market-data.pit-window-view.v1\0";
const FRONTIER_DOMAIN: &[u8] = b"market-data.pit-window-view-frontier.v1\0";

/// One stored cross-section version of a chain, with the instants its custody resolved.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ChainVersionV1 {
    pub(crate) identity: BindingDigest,
    /// The custody that holds the version.
    pub(crate) custody_identity: BindingDigest,
    /// That custody's position in the chain.
    pub(crate) chain_version: u64,
    pub(crate) timeframe_identity: BindingDigest,
    pub(crate) event_ns: u64,
    pub(crate) kind: CrossSectionVersionKindV1,
    pub(crate) correction_sequence: u64,
    pub(crate) predecessor: Option<BindingDigest>,
    pub(crate) availability_ns: u64,
    pub(crate) publication_ns: u64,
}

/// Every cross-section of a chain, keyed by `(timeframe identity, event)`, each a verified linear
/// chain of versions in sequence order.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct CrossSectionsV1(BTreeMap<(BindingDigest, u64), Vec<ChainVersionV1>>);

/// The timeframes a view selects from.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ViewTimeframesV1 {
    pub(crate) execution: BindingDigest,
    /// Every input timeframe, the execution one among them; never the fill timeframe.
    pub(crate) inputs: BTreeSet<BindingDigest>,
    /// The execution timeframe's interval: the distance to the next frame's event.
    pub(crate) interval_ns: u64,
}

/// What a frame's view selects.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ViewSelectionV1 {
    /// `e_k`.
    pub(crate) event_ns: u64,
    /// `d_k`.
    pub(crate) decision_cut_ns: u64,
    /// `e_k + interval`: the next frame's event on the grid.
    pub(crate) next_event_ns: u64,
    /// One version per input timeframe, in ascending timeframe identity.
    pub(crate) selected: Vec<ChainVersionV1>,
}

/// Why a view was not selected.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ViewRefusalV1 {
    /// `PIT_WINDOW_FRAME_NOT_COVERED`: no complete cross-section, a withdrawn one, or a decision
    /// cut that does not precede the next frame.
    FrameNotCovered,
    /// Versions that do not form one linear chain per cross-section.
    Branch,
    /// Stored instants or timeframes no commit writes.
    Malformed,
}

impl CrossSectionsV1 {
    /// The versions of the cross-section at `(timeframe, event)`, in sequence order.
    pub(crate) fn at(&self, timeframe: BindingDigest, event_ns: u64) -> Option<&[ChainVersionV1]> {
        self.0.get(&(timeframe, event_ns)).map(Vec::as_slice)
    }
}

/// Groups `versions` into cross-sections, each verified as one linear chain: exactly one original,
/// at sequence 1 with no predecessor; every later sequence exactly once, naming the version before
/// it, which is not a withdrawal; publication strictly increasing with the sequence.
///
/// # Errors
///
/// [`ViewRefusalV1::Branch`] for any cross-section that is not one linear chain.
pub(crate) fn cross_sections_v1(
    versions: &[ChainVersionV1],
) -> Result<CrossSectionsV1, ViewRefusalV1> {
    let mut sections: BTreeMap<(BindingDigest, u64), Vec<ChainVersionV1>> = BTreeMap::new();

    for version in versions {
        sections
            .entry((version.timeframe_identity, version.event_ns))
            .or_default()
            .push(version.clone());
    }

    for chain in sections.values_mut() {
        chain.sort_by_key(|version| version.correction_sequence);

        for (position, version) in chain.iter().enumerate() {
            let expected_sequence = u64::try_from(position)
                .ok()
                .and_then(|position| position.checked_add(1))
                .ok_or(ViewRefusalV1::Branch)?;

            if version.correction_sequence != expected_sequence {
                return Err(ViewRefusalV1::Branch);
            }
            let linked = match position.checked_sub(1).map(|prior| &chain[prior]) {
                None => {
                    version.kind == CrossSectionVersionKindV1::Original
                        && version.predecessor.is_none()
                }
                Some(prior) => {
                    version.kind != CrossSectionVersionKindV1::Original
                        && version.predecessor == Some(prior.identity)
                        && prior.kind != CrossSectionVersionKindV1::Withdrawal
                        && version.publication_ns > prior.publication_ns
                }
            };

            if !linked {
                return Err(ViewRefusalV1::Branch);
            }
        }
    }
    Ok(CrossSectionsV1(sections))
}

/// The highest sequence of `chain` published at or before `cut`.
fn effective_at(chain: &[ChainVersionV1], cut: u64) -> Option<&ChainVersionV1> {
    chain
        .iter()
        .filter(|version| version.publication_ns <= cut)
        .max_by_key(|version| version.correction_sequence)
}

/// The version `chain` contributes at `cut`, refusing a withdrawn or unpublished one.
fn visible_at(chain: &[ChainVersionV1], cut: u64) -> Result<&ChainVersionV1, ViewRefusalV1> {
    effective_at(chain, cut)
        .filter(|version| version.kind != CrossSectionVersionKindV1::Withdrawal)
        .ok_or(ViewRefusalV1::FrameNotCovered)
}

/// Selects the view of frame `e_k`.
///
/// # Errors
///
/// [`ViewRefusalV1::FrameNotCovered`] for a frame the rules leave uncovered;
/// [`ViewRefusalV1::Malformed`] for timeframes or instants no commit writes.
pub(crate) fn select_view_v1(
    sections: &CrossSectionsV1,
    timeframes: &ViewTimeframesV1,
    event_ns: u64,
) -> Result<ViewSelectionV1, ViewRefusalV1> {
    if !timeframes.inputs.contains(&timeframes.execution) || timeframes.interval_ns == 0 {
        return Err(ViewRefusalV1::Malformed);
    }
    let execution = sections
        .at(timeframes.execution, event_ns)
        .ok_or(ViewRefusalV1::FrameNotCovered)?;
    // The original's availability, never the selected version's: under a rule set to the
    // retrieval instant a successor's correction is available at its own later minting cut, and a
    // decision cut taken from it would depend on the selection it decides.
    let decision_cut_ns = execution
        .first()
        .ok_or(ViewRefusalV1::Malformed)?
        .availability_ns;
    let next_event_ns = event_ns
        .checked_add(timeframes.interval_ns)
        .ok_or(ViewRefusalV1::Malformed)?;

    if decision_cut_ns >= next_event_ns {
        return Err(ViewRefusalV1::FrameNotCovered);
    }
    let mut selected = Vec::with_capacity(timeframes.inputs.len());

    for timeframe in &timeframes.inputs {
        let version = if *timeframe == timeframes.execution {
            visible_at(execution, decision_cut_ns)?
        } else {
            // The latest cross-section available by `d_k`. A withdrawn or unpublished latest one
            // refuses the frame: an older bar is never substituted as the latest.
            let latest = sections
                .0
                .range((*timeframe, 0)..=(*timeframe, u64::MAX))
                .rev()
                .map(|(_, chain)| chain)
                .find(|chain| {
                    chain
                        .first()
                        .is_some_and(|original| original.availability_ns <= decision_cut_ns)
                })
                .ok_or(ViewRefusalV1::FrameNotCovered)?;
            visible_at(latest, decision_cut_ns)?
        };

        if !(version.event_ns <= version.availability_ns
            && version.availability_ns <= version.publication_ns
            && version.publication_ns <= decision_cut_ns)
        {
            return Err(ViewRefusalV1::Malformed);
        }
        selected.push(version.clone());
    }
    Ok(ViewSelectionV1 {
        event_ns,
        decision_cut_ns,
        next_event_ns,
        selected,
    })
}

/// The identity of a view: SHA-256 over the view schema version, the availability rule digest,
/// `e_k` and the selected version identities in ascending timeframe identity. It names no head, so
/// a correction changes only the views that select it.
pub(crate) fn view_identity_v1(
    rule_digest: BindingDigest,
    selection: &ViewSelectionV1,
) -> BindingDigest {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&PIT_WINDOW_VIEW_SCHEMA_V1.to_be_bytes());
    bytes.extend_from_slice(rule_digest.as_bytes());
    put_u64(&mut bytes, selection.event_ns);
    put_u64(&mut bytes, selection.selected.len() as u64);

    for version in &selection.selected {
        bytes.extend_from_slice(version.identity.as_bytes());
    }
    sha256(VIEW_DOMAIN, &bytes)
}

/// The fields every row of a view states alike, which one derived frontier digest covers.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ViewFrontierV1 {
    pub(crate) chain_root: BindingDigest,
    pub(crate) binding_id: BindingDigest,
    pub(crate) binding_fact_digest: BindingDigest,
    pub(crate) lineage_root: BindingDigest,
    pub(crate) lineage_version: u64,
    pub(crate) source_frontier_digest: BindingDigest,
    pub(crate) correction_stream: Vec<u8>,
    pub(crate) correction_frontier_digest: BindingDigest,
    pub(crate) instrument_master_key: BindingDigest,
    pub(crate) market_semantics_identity: BindingDigest,
    /// The Universe Selection locator: `(request_identity, request_meaning_digest)`.
    pub(crate) universe: (BindingDigest, BindingDigest),
    /// The Owner clock `d_k` is an instant of.
    pub(crate) clock_identity: String,
    pub(crate) clock_epoch: String,
}

/// The derived frontier digest of a view's uniform fields.
pub(crate) fn derived_frontier_digest_v1(frontier: &ViewFrontierV1) -> BindingDigest {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&PIT_WINDOW_VIEW_SCHEMA_V1.to_be_bytes());
    bytes.extend_from_slice(frontier.chain_root.as_bytes());
    bytes.extend_from_slice(frontier.binding_id.as_bytes());
    bytes.extend_from_slice(frontier.binding_fact_digest.as_bytes());
    bytes.extend_from_slice(frontier.lineage_root.as_bytes());
    put_u64(&mut bytes, frontier.lineage_version);
    bytes.extend_from_slice(frontier.source_frontier_digest.as_bytes());
    put_var(&mut bytes, &frontier.correction_stream);
    bytes.extend_from_slice(frontier.correction_frontier_digest.as_bytes());
    bytes.extend_from_slice(frontier.instrument_master_key.as_bytes());
    bytes.extend_from_slice(frontier.market_semantics_identity.as_bytes());
    bytes.extend_from_slice(frontier.universe.0.as_bytes());
    bytes.extend_from_slice(frontier.universe.1.as_bytes());
    put_var(&mut bytes, frontier.clock_identity.as_bytes());
    put_var(&mut bytes, frontier.clock_epoch.as_bytes());
    sha256(FRONTIER_DOMAIN, &bytes)
}

/// The frames of a run: every bar-close instant of the window schedules inside
/// `[run_start_ns, run_end_ns_exclusive)`, each with its `d_k`, in event order.
///
/// Every member's schedule must state the same instants. Each frame's view is selected, so a frame
/// a view cannot cover refuses the run, and every member's window schedule must admit it.
///
/// # Errors
///
/// [`ViewRefusalV1::Malformed`] for schedules that disagree on the frames, and every refusal of
/// [`select_view_v1`]; [`ViewRefusalV1::FrameNotCovered`] for a frame a window schedule does not
/// admit.
pub(crate) fn enumerate_run_frames_v1(
    schedules: &[PitWindowScheduleFactV1],
    sections: &CrossSectionsV1,
    timeframes: &ViewTimeframesV1,
    run_start_ns: u64,
    run_end_ns_exclusive: u64,
) -> Result<Vec<(u64, u64)>, ViewRefusalV1> {
    let (first, rest) = schedules.split_first().ok_or(ViewRefusalV1::Malformed)?;
    let instants = frame_instants_v1(first, run_start_ns, run_end_ns_exclusive).collect::<Vec<_>>();

    if rest.iter().any(|schedule| {
        !frame_instants_v1(schedule, run_start_ns, run_end_ns_exclusive)
            .eq(instants.iter().copied())
    }) {
        return Err(ViewRefusalV1::Malformed);
    }
    instants
        .into_iter()
        .map(|event_ns| {
            let decision_cut_ns = select_view_v1(sections, timeframes, event_ns)?.decision_cut_ns;

            if schedules.iter().all(|schedule| {
                window_schedule_admits_frame_v1(schedule, event_ns, decision_cut_ns)
            }) {
                Ok((event_ns, decision_cut_ns))
            } else {
                Err(ViewRefusalV1::FrameNotCovered)
            }
        })
        .collect()
}

fn put_u64(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_be_bytes());
}

fn put_var(out: &mut Vec<u8>, value: &[u8]) {
    put_u64(out, value.len() as u64);
    out.extend_from_slice(value);
}

fn sha256(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

#[cfg(test)]
#[path = "view_tests.rs"]
mod tests;
