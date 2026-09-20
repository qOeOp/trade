//! One frozen window, answered coordinate by coordinate.
//!
//! A point-in-time snapshot is one as-of cut: [`crate::owner::pit_snapshot`]'s authority requires
//! every observation row's four time coordinates to equal the frozen request's four, so a series
//! is not something one intake can carry. A series is N intakes, and until now nothing in this
//! system issued the second one.
//!
//! This is that driver, and the division of labour it encodes is the reason it lives here rather
//! than in a consumer. `docs/owners/market-data.md` states as its first prohibition that this Owner
//! never selects the time window for a research run, backtest or scan - so the window arrives here
//! already frozen, and this module only ever reads it. Which coordinates lie *inside* that window
//! is a different question, and it is not a selection: it is the evaluation of an admitted
//! [`BarScheduleFactV1`](crate::owner::bar_schedule::BarScheduleFactV1), whose effective-dated
//! calendar, session and anchor identities no other Owner holds. That is the same division Universe
//! Selection already uses, where the requester owns the rule and this Owner evaluates it.
//!
//! The sweep reads the Owner's decision cut once and freezes every request against it, so a
//! coordinate's meaning is "as of `T`, decided at cut `C`". Each request is otherwise exactly the
//! request the single-coordinate path already freezes, including its four time coordinates: this
//! module issues N of what is already proven rather than a second kind of request.

use async_trait::async_trait;

use super::{
    bar_schedule::{
        BarScheduleKindV1, BarScheduleResolverV1, BarScheduleUnitV1, UntrustedBarScheduleLocatorV1,
    },
    pit_market_snapshot_intake_v1::{
        MarketDataDecisionCutV1, PitMarketSnapshotIntakeErrorV1, PitMarketSnapshotIntakeV1,
        PitMarketSnapshotTerminalV1,
    },
    pit_snapshot::{
        UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
        UntrustedPitSnapshotRequest, UntrustedPitSnapshotTimeEvidence,
        UntrustedProviderAvailableTime, UntrustedRetrievalTime, UntrustedSnapshotDecisionCut,
        seal_request_claims_v1,
    },
    source_binding::{BindingDigest, UntrustedSourceBindingLocator},
    universe_selection::UntrustedUniverseSelectionLocatorV1,
};

/// The most coordinates one window may be expanded into.
///
/// The bound is this Owner's, not the caller's. A caller that supplied its own limit would be
/// supplying the limit it is bounded by, which bounds nothing. Every coordinate is a complete
/// intake - a retrieval from the provider and a committed snapshot - so this is a work bound rather
/// than a memory one, and a window that needs more than this is more than one sweep.
pub const MAX_COORDINATES_PER_WINDOW: usize = 512;

/// One frozen window a caller asks this Owner to answer.
///
/// Every field is the caller's. This Owner reads them and writes none of them, which is what keeps
/// the prohibition on selecting a time window literally true: `from_ns` and `until_ns_exclusive`
/// arrive frozen and leave unchanged.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedFrozenObservationWindowV1 {
    /// The first instant the window covers.
    pub from_ns: u64,
    /// The first instant past the window.
    pub until_ns_exclusive: u64,
    /// The admitted bar schedule whose boundaries are the coordinates inside the window.
    pub schedule: UntrustedBarScheduleLocatorV1,
    /// The admitted Source Binding every request in the sweep is frozen against.
    pub source_binding: UntrustedSourceBindingLocator,
    /// The evaluated Universe Selection whose members every request covers.
    pub universe_selection: UntrustedUniverseSelectionLocatorV1,
    /// The requester's stable correlation identity, carried onto every request.
    pub correlation_identity: BindingDigest,
    /// The requester's identity, carried onto every request.
    pub requester_identity: BindingDigest,
    /// The requester's scope digest, carried onto every request.
    pub scope_digest: BindingDigest,
    /// The identity of the evaluated selection every request states.
    ///
    /// Distinct from `scope_digest` and from `universe_selection`: the locator addresses the
    /// selection record, this is the selection's own identity, and the scope digest is the
    /// requester's description of what it asked for. The single-coordinate path states all three.
    pub universe_selection_digest: BindingDigest,
    /// The Market Semantics compatibility identity every request states.
    pub market_semantics_identity: BindingDigest,
    /// The caller's Instrument Master claim, which this Owner resolves rather than trusts.
    ///
    /// It is carried rather than invented: a driver that minted this would be asserting an
    /// Instrument Master resolution on the caller's behalf, and the single-coordinate path already
    /// takes it from the caller for the same reason.
    pub instrument_master_digest: BindingDigest,
}

/// Why a window could not be expanded at all.
///
/// Every variant here means **no coordinate was attempted**. Once the sweep begins submitting, the
/// result stops being a binary and becomes a fact: see [`FrozenObservationWindowTerminalV1`].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FrozenObservationWindowErrorV1 {
    /// The window is empty or inverted, or no schedule boundary falls inside it.
    WindowUnusable,
    /// The bar schedule locator does not resolve to a schedule this Owner holds.
    ScheduleUnavailable,
    /// The schedule's effective interval does not cover the whole window.
    ScheduleOutsideWindow,
    /// The schedule is one this Owner cannot expand without another resolution.
    UnsupportedSchedule,
    /// The window expands to more coordinates than one sweep may answer.
    CoordinateCountExceeded,
    /// The Owner holds no clock head, so nothing could be frozen.
    ClockUnavailable,
}

/// Where a sweep stopped, and why.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FrozenObservationWindowHaltV1 {
    /// The coordinate the sweep was answering when it stopped. It committed nothing.
    pub at_event_effective_ns: u64,
    /// How many coordinates were never attempted, this one included.
    pub unanswered: usize,
    /// The intake's own bounded category for why it reached no finding.
    pub reason: PitMarketSnapshotIntakeErrorV1,
}

/// One coordinate the sweep answered, and the terminal it reached.
#[derive(Clone, Debug)]
pub struct AnsweredCoordinateV1 {
    /// The as-of instant this terminal answers.
    pub event_effective_ns: u64,
    /// The Owner's terminal. A negative disposition is an answer, not a failure.
    pub terminal: PitMarketSnapshotTerminalV1,
}

/// What a sweep did.
///
/// This is deliberately not a `Result`. A sweep that commits four hundred snapshots and then meets
/// an unavailable store has not failed and has not succeeded; it has done four hundred things. An
/// error returned in its place would read as "nothing happened", and the caller's natural response
/// - retry the window - would then collide with the snapshots it does not know exist.
#[derive(Clone, Debug)]
pub struct FrozenObservationWindowTerminalV1 {
    coordinates: Vec<AnsweredCoordinateV1>,
    halted: Option<FrozenObservationWindowHaltV1>,
    decision_cut: u64,
}

impl FrozenObservationWindowTerminalV1 {
    /// Every coordinate that reached a terminal, in ascending order.
    #[must_use]
    pub fn coordinates(&self) -> &[AnsweredCoordinateV1] {
        &self.coordinates
    }

    /// Where the sweep stopped, absent when it answered the whole window.
    #[must_use]
    pub const fn halted(&self) -> Option<FrozenObservationWindowHaltV1> {
        self.halted
    }

    /// The single cut every request in this sweep was frozen against.
    #[must_use]
    pub const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }
}

/// Answers one frozen window, coordinate by coordinate.
#[async_trait]
pub trait FrozenObservationWindowIntakeV1: Send + Sync {
    /// Expands the window against its schedule and answers every coordinate in it.
    ///
    /// # Errors
    ///
    /// Returns a bounded category only when no coordinate was attempted. Once the first request is
    /// submitted the outcome is a terminal, whose `halted` says where the sweep stopped.
    async fn answer_window(
        &self,
        window: UntrustedFrozenObservationWindowV1,
    ) -> Result<FrozenObservationWindowTerminalV1, FrozenObservationWindowErrorV1>;
}

/// The coordinates an admitted schedule places inside a frozen window.
///
/// A coordinate is a schedule boundary. At boundary `B` the bar that has closed is the one covering
/// `[B - step, B)`, so one boundary names one complete bar and the enumeration is one-to-one.
///
/// **Phase.** A [`BarScheduleFactV1`](crate::owner::bar_schedule::BarScheduleFactV1) states a
/// cadence and no phase: its `anchor_identity` is a provenance digest over the binding, batch and
/// row it was derived from, not an instant. Boundaries are therefore taken from the epoch, which is
/// this venue's own convention rather than a property of the schedule fact - measured, not assumed,
/// and asserted against the provider's own close times in the end-to-end proof so a venue that ever
/// disagrees turns that proof red instead of silently misaligning every coordinate.
fn coordinates_in_window(
    step_ns: u64,
    from_ns: u64,
    until_ns_exclusive: u64,
) -> Result<Vec<u64>, FrozenObservationWindowErrorV1> {
    if step_ns == 0 || from_ns >= until_ns_exclusive {
        return Err(FrozenObservationWindowErrorV1::WindowUnusable);
    }

    // The first boundary at or after `from_ns`, without iterating up to it.
    let remainder = from_ns % step_ns;
    let first = if remainder == 0 {
        from_ns
    } else {
        from_ns
            .checked_add(step_ns - remainder)
            .ok_or(FrozenObservationWindowErrorV1::WindowUnusable)?
    };

    if first >= until_ns_exclusive {
        return Err(FrozenObservationWindowErrorV1::WindowUnusable);
    }

    // Counted before it is built, so an oversized window is refused rather than allocated.
    let span = until_ns_exclusive - first;
    let count = usize::try_from(span.div_ceil(step_ns))
        .map_err(|_| FrozenObservationWindowErrorV1::CoordinateCountExceeded)?;
    if count > MAX_COORDINATES_PER_WINDOW {
        return Err(FrozenObservationWindowErrorV1::CoordinateCountExceeded);
    }

    Ok((0..count)
        .map(|index| first + (index as u64) * step_ns)
        .collect())
}

/// One schedule boundary's length in nanoseconds.
///
/// `ExchangeSession` is refused rather than approximated. Expanding a session schedule needs the
/// calendar its `calendar_identity` names, which is a separate resolution this slice does not make;
/// treating a session day as a fixed twenty-four hours would be wrong on exactly the days that
/// matter, and wrong silently.
const fn step_ns_of(
    kind: BarScheduleKindV1,
    unit: BarScheduleUnitV1,
    step: u32,
) -> Result<u64, FrozenObservationWindowErrorV1> {
    if step == 0 {
        return Err(FrozenObservationWindowErrorV1::UnsupportedSchedule);
    }
    let unit_ns: u64 = match (kind, unit) {
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Second) => 1_000_000_000,
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Minute) => 60_000_000_000,
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Hour) => 3_600_000_000_000,
        _ => return Err(FrozenObservationWindowErrorV1::UnsupportedSchedule),
    };

    match unit_ns.checked_mul(step as u64) {
        Some(step_ns) => Ok(step_ns),
        None => Err(FrozenObservationWindowErrorV1::UnsupportedSchedule),
    }
}

/// Freezes one request at one coordinate, against the cut the whole sweep shares.
fn frozen_request_at(
    window: &UntrustedFrozenObservationWindowV1,
    cut: &MarketDataDecisionCutV1,
    event_effective_ns: u64,
) -> UntrustedPitSnapshotRequest {
    let id = cut.clock_identity.clone();
    let epoch = cut.clock_epoch.clone();
    // All four coordinates are the frozen instant, which is what the single-coordinate path
    // already states. A sweep is N of that request, not a second kind of request, and changing
    // what the four coordinates mean is a question about one snapshot rather than about a series.
    let mut request = UntrustedPitSnapshotRequest {
        // Both claims are zero here and neither stays zero: `seal_request_claims_v1` at the end of
        // this function derives them from the content this request commits. A reader who stops at
        // these two lines sees a caller asserting an empty identity, which is the opposite of what
        // happens - the identity is not the caller's to assert, so it is written last, by the seal.
        claimed_request_identity: BindingDigest::from_untrusted_bytes([0; 32]),
        claimed_request_digest: BindingDigest::from_untrusted_bytes([0; 32]),
        correlation_identity: window.correlation_identity,
        requester_identity: window.requester_identity,
        scope_digest: window.scope_digest,
        source_binding: window.source_binding.clone(),
        instrument_master_digest: window.instrument_master_digest,
        universe_selection_digest: window.universe_selection_digest,
        market_semantics_identity: window.market_semantics_identity,
        time_evidence: UntrustedPitSnapshotTimeEvidence {
            event_effective: UntrustedEventEffectiveTime::from_untrusted(
                event_effective_ns,
                &id,
                &epoch,
            ),
            provider_available: UntrustedProviderAvailableTime::from_untrusted(
                event_effective_ns,
                &id,
                &epoch,
            ),
            retrieval: UntrustedRetrievalTime::from_untrusted(event_effective_ns, &id, &epoch),
            correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
                event_effective_ns,
                &id,
                &epoch,
            )),
            decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(
                cut.decision_cut,
                &id,
                &epoch,
            ),
            monotonic_sequence: cut.monotonic_sequence,
            restart_continuity_digest: cut.restart_continuity_digest,
            skew_bound: cut.skew_bound,
            uncertainty_bound: cut.uncertainty_bound,
            observed_at: cut.decision_cut,
            valid_through: cut.valid_through,
        },
    };
    seal_request_claims_v1(&mut request);
    request
}

/// Answers a frozen window by driving the single-coordinate intake once per coordinate.
#[derive(Debug)]
pub struct FrozenObservationWindowDriverV1<I, S> {
    intake: I,
    schedules: S,
}

impl<I, S> FrozenObservationWindowDriverV1<I, S>
where
    I: PitMarketSnapshotIntakeV1,
    S: BarScheduleResolverV1,
{
    /// Binds the intake this driver issues to and the resolver that says where boundaries fall.
    pub const fn new(intake: I, schedules: S) -> Self {
        Self { intake, schedules }
    }
}

#[async_trait]
impl<I, S> FrozenObservationWindowIntakeV1 for FrozenObservationWindowDriverV1<I, S>
where
    I: PitMarketSnapshotIntakeV1 + Send + Sync,
    S: BarScheduleResolverV1 + Send + Sync,
{
    async fn answer_window(
        &self,
        window: UntrustedFrozenObservationWindowV1,
    ) -> Result<FrozenObservationWindowTerminalV1, FrozenObservationWindowErrorV1> {
        let readback = self
            .schedules
            .resolve_bar_schedule_v1(&window.schedule)
            .await
            .map_err(|_| FrozenObservationWindowErrorV1::ScheduleUnavailable)?;
        let fact = readback.fact();

        // A schedule states the cadence only while it is effective. A window reaching outside that
        // interval would be expanded by a rule that was not in force for part of it.
        let covers_start = fact.effective_from() <= i128::from(window.from_ns);
        let covers_end = fact
            .effective_until()
            .is_none_or(|until| i128::from(window.until_ns_exclusive) <= until);
        if !covers_start || !covers_end {
            return Err(FrozenObservationWindowErrorV1::ScheduleOutsideWindow);
        }

        let step_ns = step_ns_of(fact.kind(), fact.unit(), fact.step())?;
        let coordinates =
            coordinates_in_window(step_ns, window.from_ns, window.until_ns_exclusive)?;

        // Read once: every request in this sweep is frozen against one cut, so a coordinate means
        // "as of T, decided at C" rather than each one carrying a different C.
        let cut = self
            .intake
            .current_decision_cut()
            .await
            .map_err(|_| FrozenObservationWindowErrorV1::ClockUnavailable)?;

        Ok(sweep(&self.intake, &window, &cut, coordinates).await)
    }
}

/// Issues one frozen request per coordinate and reports what it managed to answer.
///
/// Separate from the resolution above so this - the part with the partial-progress property - can
/// be driven directly. A sweep stops at the first coordinate the intake cannot reach a finding for,
/// and says which one and how many were never attempted; it does not discard what it committed.
async fn sweep<I: PitMarketSnapshotIntakeV1>(
    intake: &I,
    window: &UntrustedFrozenObservationWindowV1,
    cut: &MarketDataDecisionCutV1,
    coordinates: Vec<u64>,
) -> FrozenObservationWindowTerminalV1 {
    let total = coordinates.len();
    let mut answered = Vec::with_capacity(total);
    let mut halted = None;

    for (index, event_effective_ns) in coordinates.into_iter().enumerate() {
        let request = frozen_request_at(window, cut, event_effective_ns);
        match intake.submit(request, window.universe_selection).await {
            Ok(terminal) => answered.push(AnsweredCoordinateV1 {
                event_effective_ns,
                terminal,
            }),
            Err(reason) => {
                halted = Some(FrozenObservationWindowHaltV1 {
                    at_event_effective_ns: event_effective_ns,
                    unanswered: total - index,
                    reason,
                });
                break;
            }
        }
    }

    FrozenObservationWindowTerminalV1 {
        coordinates: answered,
        halted,
        decision_cut: cut.decision_cut,
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    const HOUR_NS: u64 = 3_600_000_000_000;

    #[rstest]
    fn boundaries_are_taken_from_the_epoch_and_are_half_open() {
        // A window that starts exactly on a boundary includes it, and one that ends exactly on a
        // boundary excludes it: the same half-open convention the window itself states.
        let four_hours = 4 * HOUR_NS;
        let coordinates = coordinates_in_window(four_hours, 0, 3 * four_hours).unwrap();
        assert_eq!(coordinates, vec![0, four_hours, 2 * four_hours]);
    }

    #[rstest]
    fn a_window_starting_off_a_boundary_begins_at_the_next_one() {
        let four_hours = 4 * HOUR_NS;
        let coordinates = coordinates_in_window(four_hours, 1, 2 * four_hours + 1).unwrap();
        assert_eq!(
            coordinates,
            vec![four_hours, 2 * four_hours],
            "an instant inside a bar is not that bar's boundary"
        );
    }

    #[rstest]
    fn a_window_containing_no_boundary_is_unusable() {
        let four_hours = 4 * HOUR_NS;
        assert_eq!(
            coordinates_in_window(four_hours, 1, four_hours),
            Err(FrozenObservationWindowErrorV1::WindowUnusable),
            "a window inside one bar names no complete bar, and answering it with the bar it sits \
             in would answer a coordinate the caller did not ask for"
        );
    }

    #[rstest]
    fn an_inverted_or_empty_window_is_unusable() {
        assert_eq!(
            coordinates_in_window(HOUR_NS, 10, 10),
            Err(FrozenObservationWindowErrorV1::WindowUnusable)
        );
        assert_eq!(
            coordinates_in_window(HOUR_NS, 11, 10),
            Err(FrozenObservationWindowErrorV1::WindowUnusable)
        );
    }

    #[rstest]
    fn the_cap_is_counted_before_the_window_is_expanded() {
        let step = HOUR_NS;
        let ok = coordinates_in_window(step, 0, step * MAX_COORDINATES_PER_WINDOW as u64).unwrap();
        assert_eq!(ok.len(), MAX_COORDINATES_PER_WINDOW);
        assert_eq!(
            coordinates_in_window(step, 0, step * (MAX_COORDINATES_PER_WINDOW as u64 + 1)),
            Err(FrozenObservationWindowErrorV1::CoordinateCountExceeded),
            "one past the cap is refused, and refusing it allocates nothing"
        );
    }

    #[rstest]
    fn only_fixed_interval_schedules_expand() {
        assert_eq!(
            step_ns_of(BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Hour, 4),
            Ok(4 * HOUR_NS)
        );
        assert_eq!(
            step_ns_of(
                BarScheduleKindV1::FixedInterval,
                BarScheduleUnitV1::Minute,
                1
            ),
            Ok(60_000_000_000)
        );
        // A session day is refused rather than approximated as twenty-four hours. The approximation
        // would be wrong on exactly the days a session schedule exists to describe.
        assert_eq!(
            step_ns_of(
                BarScheduleKindV1::ExchangeSession,
                BarScheduleUnitV1::ExchangeSessionDay,
                1
            ),
            Err(FrozenObservationWindowErrorV1::UnsupportedSchedule)
        );
        assert_eq!(
            step_ns_of(
                BarScheduleKindV1::FixedInterval,
                BarScheduleUnitV1::ExchangeSessionDay,
                1
            ),
            Err(FrozenObservationWindowErrorV1::UnsupportedSchedule),
            "a session day has no fixed length whatever kind claims it"
        );
        assert_eq!(
            step_ns_of(BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Hour, 0),
            Err(FrozenObservationWindowErrorV1::UnsupportedSchedule),
            "a zero step would place every coordinate at the same instant"
        );
    }

    /// An intake that answers a fixed number of coordinates and then cannot reach a finding.
    ///
    /// It exists to prove the one property a doc comment cannot: that a sweep interrupted after
    /// committing work reports the work, rather than reporting that nothing happened.
    struct IntakeThatStopsAfter {
        answers: usize,
        submitted: std::sync::atomic::AtomicUsize,
    }

    impl super::super::pit_market_snapshot_intake_v1::sealed::Sealed for IntakeThatStopsAfter {}

    #[async_trait]
    impl PitMarketSnapshotIntakeV1 for IntakeThatStopsAfter {
        async fn current_decision_cut(
            &self,
        ) -> Result<MarketDataDecisionCutV1, PitMarketSnapshotIntakeErrorV1> {
            Ok(MarketDataDecisionCutV1 {
                clock_identity: "TEST-CLOCK".into(),
                clock_epoch: "TEST-EPOCH".into(),
                decision_cut: 9_000_000_000_000_000,
                monotonic_sequence: 7,
                restart_continuity_digest: BindingDigest::from_untrusted_bytes([9; 32]),
                valid_through: 9_100_000_000_000_000,
                uncertainty_bound: 1,
                skew_bound: 1,
            })
        }

        async fn submit(
            &self,
            _request: UntrustedPitSnapshotRequest,
            _universe_selection: UntrustedUniverseSelectionLocatorV1,
        ) -> Result<PitMarketSnapshotTerminalV1, PitMarketSnapshotIntakeErrorV1> {
            let index = self
                .submitted
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);

            if index < self.answers {
                Ok(PitMarketSnapshotTerminalV1::seal(
                    super::super::pit_market_snapshot_intake_v1::PitMarketSnapshotTerminalFieldsV1 {
                        request_identity: BindingDigest::from_untrusted_bytes([1; 32]),
                        request_digest: BindingDigest::from_untrusted_bytes([2; 32]),
                        correlation_identity: BindingDigest::from_untrusted_bytes([3; 32]),
                        snapshot_identity: BindingDigest::from_untrusted_bytes([4; 32]),
                        fact_digest: BindingDigest::from_untrusted_bytes([5; 32]),
                        disposition:
                            super::super::pit_market_snapshot_intake_v1::PitMarketSnapshotDispositionV1::Available,
                        locator: None,
                        instrument_master_digest: BindingDigest::from_untrusted_bytes([6; 32]),
                    },
                ))
            } else {
                Err(PitMarketSnapshotIntakeErrorV1::StoreUnavailable)
            }
        }
    }

    /// A locator the sweep only ever carries.
    ///
    /// The stub intake below never reads it, but it cannot be omitted: a request without a binding
    /// is not a request, and a fixture that could omit it would be proving something easier than
    /// the production path does.
    fn source_binding_locator() -> UntrustedSourceBindingLocator {
        let frontier = |byte: u8| super::super::source_binding::UntrustedCompleteFrontier {
            stream_identity: "test/stream".to_owned(),
            cut_identity: "test/stream/cut-1".to_owned(),
            sequence: 1,
            digest: BindingDigest::from_untrusted_bytes([byte; 32]),
        };
        UntrustedSourceBindingLocator::from_untrusted(
            super::super::source_binding::UntrustedSourceBindingLocatorFields {
                owner: "MARKET_DATA_OWNER_V1".to_owned(),
                lineage_root: BindingDigest::from_untrusted_bytes([20; 32]),
                lineage_version: 1,
                predecessor_binding_id: None,
                predecessor_fact_digest: None,
                binding_id: BindingDigest::from_untrusted_bytes([21; 32]),
                fact_digest: BindingDigest::from_untrusted_bytes([22; 32]),
                credential_handle_identity: BindingDigest::from_untrusted_bytes([23; 32]),
                credential_audience:
                    super::super::source_binding::UntrustedCredentialAudienceClaim::MarketData,
                credential_capabilities: [
                    super::super::source_binding::UntrustedCredentialCapabilityClaim::MarketDataRead,
                ]
                .into_iter()
                .collect(),
                source_frontier: frontier(24),
                correction_frontier: frontier(25),
                time_evidence: super::super::source_binding::UntrustedMarketDataAsOf {
                    claimed_evidence_identity: BindingDigest::from_untrusted_bytes([26; 32]),
                    clock_identity: "TEST-CLOCK".to_owned(),
                    clock_epoch: "TEST-EPOCH".to_owned(),
                    monotonic_sequence: 7,
                    restart_continuity_digest: BindingDigest::from_untrusted_bytes([9; 32]),
                    skew_bound: 1,
                    uncertainty_bound: 1,
                    event_effective: 1,
                    provider_available: 1,
                    retrieval: 1,
                    correction_publication: 1,
                    observed_at: 1,
                    effective_at: 1,
                    valid_through: 2,
                },
            },
        )
    }

    fn window(from_ns: u64, until_ns_exclusive: u64) -> UntrustedFrozenObservationWindowV1 {
        UntrustedFrozenObservationWindowV1 {
            from_ns,
            until_ns_exclusive,
            schedule: UntrustedBarScheduleLocatorV1 {
                digest: super::super::bar_schedule::BarScheduleIdentity::from_untrusted_bytes(
                    [7; 32],
                ),
            },
            source_binding: source_binding_locator(),
            universe_selection: UntrustedUniverseSelectionLocatorV1::from_untrusted(
                BindingDigest::from_untrusted_bytes([10; 32]),
                BindingDigest::from_untrusted_bytes([11; 32]),
            ),
            correlation_identity: BindingDigest::from_untrusted_bytes([12; 32]),
            requester_identity: BindingDigest::from_untrusted_bytes([13; 32]),
            scope_digest: BindingDigest::from_untrusted_bytes([14; 32]),
            universe_selection_digest: BindingDigest::from_untrusted_bytes([15; 32]),
            market_semantics_identity: BindingDigest::from_untrusted_bytes([16; 32]),
            instrument_master_digest: BindingDigest::from_untrusted_bytes([17; 32]),
        }
    }

    #[rstest]
    fn this_venues_own_bar_boundaries_satisfy_the_epoch_phase() {
        // Measured from `fapi.binance.com/fapi/v1/klines` on 2026-09-21: 4h bars open at
        // 1789876800000, 1789891200000, 1789905600000 and daily bars at 1789776000000 and
        // 1789862400000, each closing one millisecond before the next opens. The phase this
        // enumerator assumes is the phase that venue publishes, and this states the measurement
        // rather than the assumption.
        for open_ms in [1_789_876_800_000_u64, 1_789_891_200_000, 1_789_905_600_000] {
            assert_eq!(open_ms * 1_000_000 % (4 * HOUR_NS), 0);
        }

        for open_ms in [1_789_776_000_000_u64, 1_789_862_400_000] {
            assert_eq!(open_ms * 1_000_000 % (24 * HOUR_NS), 0);
        }
    }

    /// A resolver that cannot answer, so the driver's own entry point is walked.
    struct NoSuchSchedule;

    impl super::super::bar_schedule::resolver_seal::Sealed for NoSuchSchedule {}

    #[async_trait]
    impl BarScheduleResolverV1 for NoSuchSchedule {
        async fn resolve_bar_schedule_v1(
            &self,
            _locator: &UntrustedBarScheduleLocatorV1,
        ) -> Result<
            super::super::bar_schedule::BarScheduleReadbackV1,
            super::super::bar_schedule::BarScheduleError,
        > {
            Err(super::super::bar_schedule::BarScheduleError::UnsupportedSchedule)
        }
    }

    /// Constructs the driver and calls the trait method a caller would call.
    ///
    /// The proofs below drive `sweep` directly, which is the part with the interesting behaviour
    /// but is not the part production uses. Until this existed the driver type had never been
    /// instantiated anywhere in the repository and `answer_window` had never been called, so the
    /// first caller would have been the first to walk it.
    ///
    /// What this covers is the entry and its first refusal. A window that resolves its schedule
    /// and sweeps real coordinates through this entry needs a readback a store produces, and that
    /// arrives with the composition root rather than being faked here.
    #[tokio::test]
    async fn the_driver_entry_refuses_a_schedule_it_cannot_resolve() {
        let intake = IntakeThatStopsAfter {
            answers: 0,
            submitted: std::sync::atomic::AtomicUsize::new(0),
        };
        let driver = FrozenObservationWindowDriverV1::new(intake, NoSuchSchedule);

        let outcome = driver.answer_window(window(0, 4 * HOUR_NS)).await;

        assert_eq!(
            outcome.err(),
            Some(FrozenObservationWindowErrorV1::ScheduleUnavailable),
            "a schedule that does not resolve is refused before any coordinate is attempted"
        );
    }

    #[tokio::test]
    async fn a_sweep_interrupted_after_committing_reports_what_it_committed() {
        // The property this exists for: a caller that receives "nothing happened" from a sweep
        // that committed four hundred snapshots will retry the window, and every retried
        // coordinate then collides. Partial progress has to be readable or it is a trap.
        let intake = IntakeThatStopsAfter {
            answers: 3,
            submitted: std::sync::atomic::AtomicUsize::new(0),
        };
        let cut = intake.current_decision_cut().await.unwrap();
        let window = window(0, 5 * 4 * HOUR_NS);
        let coordinates: Vec<u64> = (0..5).map(|index| index * 4 * HOUR_NS).collect();

        let terminal = sweep(&intake, &window, &cut, coordinates).await;

        assert_eq!(
            terminal.coordinates().len(),
            3,
            "the three that reached a terminal are reported, not discarded"
        );
        assert_eq!(
            terminal
                .coordinates()
                .iter()
                .map(|answered| answered.event_effective_ns)
                .collect::<Vec<_>>(),
            vec![0, 4 * HOUR_NS, 8 * HOUR_NS],
            "in ascending order, so a caller can resume from the last one"
        );
        let halt = terminal
            .halted()
            .expect("an interrupted sweep says where it stopped");
        assert_eq!(halt.at_event_effective_ns, 12 * HOUR_NS);
        assert_eq!(
            halt.unanswered, 2,
            "the coordinate it stopped on is unanswered too, not merely the ones after it"
        );
        assert_eq!(
            halt.reason,
            PitMarketSnapshotIntakeErrorV1::StoreUnavailable
        );
    }

    #[tokio::test]
    async fn a_sweep_that_answers_the_whole_window_has_no_halt() {
        let intake = IntakeThatStopsAfter {
            answers: usize::MAX,
            submitted: std::sync::atomic::AtomicUsize::new(0),
        };
        let cut = intake.current_decision_cut().await.unwrap();
        let window = window(0, 2 * 4 * HOUR_NS);
        let terminal = sweep(&intake, &window, &cut, vec![0, 4 * HOUR_NS]).await;

        assert_eq!(terminal.coordinates().len(), 2);
        assert!(
            terminal.halted().is_none(),
            "absence of a halt is what says the window was answered whole"
        );
        assert_eq!(
            terminal.decision_cut(),
            cut.decision_cut,
            "every coordinate in one sweep is frozen against one cut"
        );
    }
}
