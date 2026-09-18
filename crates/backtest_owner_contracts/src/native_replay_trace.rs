//! Ordered shared-kernel semantic trace vocabulary for one native Replay V2 execution.
//!
//! Backtest owns the complete ordered semantic trace of a replay: every normalized lifecycle
//! event the shared kernel consumed, the checkpoint digest before and after it, the kernel
//! primitive it applied, the target and protection transition, and the reconciliation of every
//! simulated fill. This module fixes the vocabulary of that trace and the fail-closed census that
//! both the Native Replay consumer and the Backtest Owner apply before any trace bytes are sealed.
//!
//! The census is a pure function over borrowed views. It has no knowledge of the engine, the
//! host, or PostgreSQL, so the producer boundary and the Owner boundary validate the exact same
//! invariants against the exact same bytes.

use strategy_factory_program_sdk::lifecycle_v1::{
    FillDispositionV1, LifecycleKind, PositionIntentV1, ProtectionSemanticSetV1,
    STOP_LOSS_SEMANTIC_ID, SemanticTraceV1, TAKE_PROFIT_SEMANTIC_ID, TRACE_BYTES,
    TRAILING_ADJUST_SEMANTIC_ID,
};
use thiserror::Error;

/// Canonical lifecycle name of `START`.
pub const LIFECYCLE_START: &str = "START";
/// Canonical lifecycle name of `BAR`.
pub const LIFECYCLE_BAR: &str = "BAR";
/// Canonical lifecycle name of `EVENT`.
pub const LIFECYCLE_EVENT: &str = "EVENT";
/// Canonical lifecycle name of `FILL`.
pub const LIFECYCLE_FILL: &str = "FILL";
/// Canonical lifecycle name of `TIMER`.
pub const LIFECYCLE_TIMER: &str = "TIMER";
/// Canonical lifecycle name of `STOP`.
pub const LIFECYCLE_STOP: &str = "STOP";

/// Returns the canonical lifecycle name the ordered trace uses for one kernel lifecycle kind.
#[must_use]
pub const fn lifecycle_name(kind: LifecycleKind) -> &'static str {
    match kind {
        LifecycleKind::Start => LIFECYCLE_START,
        LifecycleKind::Bar => LIFECYCLE_BAR,
        LifecycleKind::Event => LIFECYCLE_EVENT,
        LifecycleKind::Fill => LIFECYCLE_FILL,
        LifecycleKind::Timer => LIFECYCLE_TIMER,
        LifecycleKind::Stop => LIFECYCLE_STOP,
    }
}

/// Returns the canonical position-intent name the ordered trace uses for one kernel intent.
#[must_use]
pub const fn position_intent_name(intent: PositionIntentV1) -> &'static str {
    match intent {
        PositionIntentV1::Hold => "HOLD",
        PositionIntentV1::Enter => "ENTER",
        PositionIntentV1::Add => "ADD",
        PositionIntentV1::Reduce => "REDUCE",
        PositionIntentV1::Exit => "EXIT",
    }
}

/// Returns the canonical fill-disposition name the ordered trace uses for one kernel disposition.
#[must_use]
pub const fn fill_disposition_name(disposition: FillDispositionV1) -> &'static str {
    match disposition {
        FillDispositionV1::PartiallyFilled => "PARTIALLY_FILLED",
        FillDispositionV1::Filled => "FILLED",
        FillDispositionV1::Rejected => "REJECTED",
        FillDispositionV1::Canceled => "CANCELED",
    }
}

/// Returns the versioned kernel protection semantic IDs one trace carries, in canonical order.
#[must_use]
pub fn protection_semantic_ids(set: ProtectionSemanticSetV1) -> Vec<&'static str> {
    [
        (ProtectionSemanticSetV1::STOP_LOSS, STOP_LOSS_SEMANTIC_ID),
        (
            ProtectionSemanticSetV1::TAKE_PROFIT,
            TAKE_PROFIT_SEMANTIC_ID,
        ),
        (
            ProtectionSemanticSetV1::TRAILING_ADJUST,
            TRAILING_ADJUST_SEMANTIC_ID,
        ),
    ]
    .into_iter()
    .filter_map(|(bit, semantic_id)| set.contains(bit).then_some(semantic_id))
    .collect()
}

/// One ordered host transition exactly as the Native Replay consumer observed it.
///
/// `instrument` is `None` for a host-wide lifecycle event (`START`, `STOP`) and names the exact
/// member for a member-scoped event (`BAR`, `FILL`). `trace` is the canonical 320-byte
/// [`SemanticTraceV1`] encoding the shared kernel returned for this transition.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OrderedTransitionViewV1<'a> {
    pub instrument: Option<&'a str>,
    pub lifecycle: &'a str,
    pub position_intent: &'a str,
    pub position_before_grid_units: i64,
    pub position_after_grid_units: i64,
    pub checkpoint_before: [u8; 32],
    pub checkpoint_after: [u8; 32],
    pub trace: &'a [u8],
}

/// One native fill the running host accepted, as the Native Replay consumer reported it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ActualFillViewV1<'a> {
    pub instrument: &'a str,
    pub intent_identity: [u8; 16],
    pub disposition: &'a str,
    pub cumulative_filled_grid_units: u64,
    pub position_before_grid_units: i64,
    pub position_after_grid_units: i64,
    pub checkpoint_before: [u8; 32],
    pub checkpoint_after: [u8; 32],
}

/// Facts a complete ordered trace proved about itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OrderedTraceCensusV1 {
    /// Every transition, including the host-wide `START` and `STOP`.
    pub transition_count: usize,
    /// Distinct checkpoint transitions, counting one committed target set as one.
    pub checkpoint_transition_count: usize,
    /// Committed target sets, each covering every member exactly once.
    pub target_set_count: usize,
    /// `FILL` transitions the kernel reconciled, including rejected and canceled terminals.
    pub fill_transition_count: usize,
    /// Native fills bound to exactly one `FILL` transition each.
    pub reconciled_fill_count: usize,
    /// Checkpoint digest before the `START` transition.
    pub initial_checkpoint: [u8; 32],
    /// Checkpoint digest after the `STOP` transition.
    pub terminal_checkpoint: [u8; 32],
}

/// Why an ordered trace is not a complete Backtest semantic trace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum OrderedTraceFaultV1 {
    #[error("ordered semantic trace has no transitions")]
    Empty,
    #[error("ordered semantic trace does not begin with exactly one host-wide START")]
    MissingStart,
    #[error("ordered semantic trace does not end with exactly one host-wide STOP")]
    MissingStop,
    #[error("transition {index} names a lifecycle the ordered trace does not admit")]
    UnsupportedLifecycle { index: usize },
    #[error("transition {index} is scoped to the wrong member or host level")]
    ScopeMismatch { index: usize },
    #[error("transition {index} does not carry a canonical kernel semantic trace")]
    MalformedTrace { index: usize },
    #[error("transition {index} disagrees with the kernel trace it carries")]
    TraceMismatch { index: usize },
    #[error("transition {index} did not advance the host checkpoint")]
    UnchangedCheckpoint { index: usize },
    #[error("transition {index} does not continue the checkpoint chain")]
    CheckpointChainBreak { index: usize },
    #[error("transition {index} regresses the kernel event order")]
    OrderRegression { index: usize },
    #[error("checkpoint transition {group} mixes lifecycles or does not cover every member once")]
    TargetSetShape { group: usize },
    #[error("ordered semantic trace committed {actual} target sets, expected {expected}")]
    TargetSetCount { expected: usize, actual: usize },
    #[error("native fill {fill} is not bound to exactly one FILL transition")]
    UnboundFill { fill: usize },
    #[error("FILL transition {index} consumed native quantity without a reported fill")]
    UnreportedFill { index: usize },
}

#[derive(Clone, Copy)]
struct DecodedTransition {
    kind: LifecycleKind,
    order: (u64, u64, u8, u64, [u8; 16]),
    trace: SemanticTraceV1,
}

/// Proves one ordered trace complete and exactly reconciled against the fills it reports.
///
/// The invariants, in order: the trace is a single `START`..`STOP` lifecycle whose host-wide
/// events carry no member and whose member events name an admitted member; every transition
/// carries a canonical kernel trace whose lifecycle, intent, and positions it repeats; every
/// transition advances the checkpoint; consecutive transitions form one unbroken checkpoint chain
/// in which one committed target set is the only multi-transition step and covers every member
/// exactly once; kernel event order never regresses across chain steps; the trace committed
/// exactly `expected_target_sets`; and every reported native fill binds to exactly one `FILL`
/// transition whose kernel frontier repeats its intent, cumulative quantity, and disposition,
/// while every consuming `FILL` transition is reported.
///
/// # Errors
///
/// Returns the first invariant the trace violates.
pub fn validate_ordered_semantic_trace_v1(
    transitions: &[OrderedTransitionViewV1<'_>],
    fills: &[ActualFillViewV1<'_>],
    members: &[&str],
    expected_target_sets: usize,
) -> Result<OrderedTraceCensusV1, OrderedTraceFaultV1> {
    let Some((first, rest)) = transitions.split_first() else {
        return Err(OrderedTraceFaultV1::Empty);
    };
    let Some((last, _)) = rest.split_last() else {
        return Err(OrderedTraceFaultV1::MissingStop);
    };

    if first.lifecycle != LIFECYCLE_START
        || transitions
            .iter()
            .filter(|transition| transition.lifecycle == LIFECYCLE_START)
            .count()
            != 1
    {
        return Err(OrderedTraceFaultV1::MissingStart);
    }

    if last.lifecycle != LIFECYCLE_STOP
        || transitions
            .iter()
            .filter(|transition| transition.lifecycle == LIFECYCLE_STOP)
            .count()
            != 1
    {
        return Err(OrderedTraceFaultV1::MissingStop);
    }
    let decoded = transitions
        .iter()
        .enumerate()
        .map(|(index, transition)| decode_transition(index, transition, members))
        .collect::<Result<Vec<_>, _>>()?;
    let census = validate_checkpoint_chain(transitions, &decoded, members, expected_target_sets)?;
    let reconciled_fill_count = reconcile_fills(transitions, &decoded, fills)?;
    Ok(OrderedTraceCensusV1 {
        reconciled_fill_count,
        ..census
    })
}

fn decode_transition(
    index: usize,
    transition: &OrderedTransitionViewV1<'_>,
    members: &[&str],
) -> Result<DecodedTransition, OrderedTraceFaultV1> {
    let host_wide = match transition.lifecycle {
        LIFECYCLE_START | LIFECYCLE_STOP => true,
        LIFECYCLE_BAR | LIFECYCLE_EVENT | LIFECYCLE_FILL | LIFECYCLE_TIMER => false,
        _ => return Err(OrderedTraceFaultV1::UnsupportedLifecycle { index }),
    };
    let scoped = match transition.instrument {
        None => host_wide,
        Some(instrument) => !host_wide && members.contains(&instrument),
    };

    if !scoped {
        return Err(OrderedTraceFaultV1::ScopeMismatch { index });
    }

    if transition.trace.len() != TRACE_BYTES {
        return Err(OrderedTraceFaultV1::MalformedTrace { index });
    }
    let trace = SemanticTraceV1::decode(transition.trace)
        .map_err(|_| OrderedTraceFaultV1::MalformedTrace { index })?;
    let order_key = trace
        .order_key
        .ok_or(OrderedTraceFaultV1::MalformedTrace { index })?;

    if lifecycle_name(order_key.kind) != transition.lifecycle
        || position_intent_name(trace.position_intent) != transition.position_intent
        || trace.position_before_units != transition.position_before_grid_units
        || trace.position_after_units != transition.position_after_grid_units
    {
        return Err(OrderedTraceFaultV1::TraceMismatch { index });
    }

    if transition.checkpoint_before == transition.checkpoint_after {
        return Err(OrderedTraceFaultV1::UnchangedCheckpoint { index });
    }
    Ok(DecodedTransition {
        kind: order_key.kind,
        order: (
            order_key.logical_time_ns,
            order_key.event_time_ns,
            order_key.kind as u8,
            order_key.owner_sequence,
            order_key.event_identity,
        ),
        trace,
    })
}

fn validate_checkpoint_chain(
    transitions: &[OrderedTransitionViewV1<'_>],
    decoded: &[DecodedTransition],
    members: &[&str],
    expected_target_sets: usize,
) -> Result<OrderedTraceCensusV1, OrderedTraceFaultV1> {
    let mut frontier: Option<[u8; 32]> = None;
    let mut last_order = None;
    let mut group = 0_usize;
    let mut target_set_count = 0_usize;
    let mut fill_transition_count = 0_usize;
    let mut index = 0_usize;

    while index < transitions.len() {
        let step = transitions[index];
        let step_pair = (step.checkpoint_before, step.checkpoint_after);
        let end = transitions[index..]
            .iter()
            .position(|transition| {
                (transition.checkpoint_before, transition.checkpoint_after) != step_pair
            })
            .map_or(transitions.len(), |offset| index + offset);
        if frontier.is_some_and(|frontier| frontier != step.checkpoint_before) {
            return Err(OrderedTraceFaultV1::CheckpointChainBreak { index });
        }

        if last_order.is_some_and(|last| decoded[index].order <= last) {
            return Err(OrderedTraceFaultV1::OrderRegression { index });
        }
        let members_in_step = transitions[index..end]
            .iter()
            .map(|transition| transition.instrument)
            .collect::<Vec<_>>();
        let same_lifecycle = transitions[index..end]
            .iter()
            .all(|transition| transition.lifecycle == step.lifecycle);
        let same_order = decoded[index..end]
            .iter()
            .all(|transition| transition.order == decoded[index].order);
        let shape_valid = same_lifecycle
            && same_order
            && match decoded[index].kind {
                LifecycleKind::Bar | LifecycleKind::Event => {
                    end - index == members.len()
                        && members.iter().all(|member| {
                            members_in_step
                                .iter()
                                .filter(|instrument| **instrument == Some(*member))
                                .count()
                                == 1
                        })
                }
                LifecycleKind::Start
                | LifecycleKind::Fill
                | LifecycleKind::Timer
                | LifecycleKind::Stop => end - index == 1,
            };

        if !shape_valid {
            return Err(OrderedTraceFaultV1::TargetSetShape { group });
        }

        match decoded[index].kind {
            LifecycleKind::Bar | LifecycleKind::Event => target_set_count += 1,
            LifecycleKind::Fill => fill_transition_count += 1,
            LifecycleKind::Start | LifecycleKind::Timer | LifecycleKind::Stop => {}
        }
        frontier = Some(step.checkpoint_after);
        last_order = Some(decoded[index].order);
        group += 1;
        index = end;
    }

    if target_set_count != expected_target_sets {
        return Err(OrderedTraceFaultV1::TargetSetCount {
            expected: expected_target_sets,
            actual: target_set_count,
        });
    }
    Ok(OrderedTraceCensusV1 {
        transition_count: transitions.len(),
        checkpoint_transition_count: group,
        target_set_count,
        fill_transition_count,
        reconciled_fill_count: 0,
        initial_checkpoint: transitions[0].checkpoint_before,
        terminal_checkpoint: transitions[transitions.len() - 1].checkpoint_after,
    })
}

fn reconcile_fills(
    transitions: &[OrderedTransitionViewV1<'_>],
    decoded: &[DecodedTransition],
    fills: &[ActualFillViewV1<'_>],
) -> Result<usize, OrderedTraceFaultV1> {
    let mut bound = vec![false; transitions.len()];

    for (fill_index, fill) in fills.iter().enumerate() {
        let matches = transitions
            .iter()
            .zip(decoded)
            .enumerate()
            .filter(|(_, (transition, decoded))| {
                decoded.kind == LifecycleKind::Fill
                    && transition.instrument == Some(fill.instrument)
                    && transition.checkpoint_before == fill.checkpoint_before
                    && transition.checkpoint_after == fill.checkpoint_after
                    && transition.position_before_grid_units == fill.position_before_grid_units
                    && transition.position_after_grid_units == fill.position_after_grid_units
                    && decoded.trace.fill_frontier.intent_identity == fill.intent_identity
                    && decoded.trace.fill_frontier.cumulative_filled_units
                        == fill.cumulative_filled_grid_units
                    && decoded
                        .trace
                        .fill_disposition
                        .is_some_and(|value| fill_disposition_name(value) == fill.disposition)
            })
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        let [index] = matches.as_slice() else {
            return Err(OrderedTraceFaultV1::UnboundFill { fill: fill_index });
        };

        if std::mem::replace(&mut bound[*index], true) {
            return Err(OrderedTraceFaultV1::UnboundFill { fill: fill_index });
        }
    }

    for (index, decoded) in decoded.iter().enumerate() {
        let consuming = decoded.kind == LifecycleKind::Fill
            && matches!(
                decoded.trace.fill_disposition,
                Some(FillDispositionV1::PartiallyFilled | FillDispositionV1::Filled)
            );

        if consuming && !bound[index] {
            return Err(OrderedTraceFaultV1::UnreportedFill { index });
        }
    }
    Ok(fills.len())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use strategy_factory_program_sdk::lifecycle_v1::{
        EventOrderKeyV1, FillFrontierV1, TargetSemanticV1, TargetStateV1,
    };

    use super::*;

    const AAPL: &str = "AAPL.XNAS";
    const MSFT: &str = "MSFT.XNAS";

    struct Owned {
        instrument: Option<&'static str>,
        lifecycle: &'static str,
        position_intent: &'static str,
        before: i64,
        after: i64,
        checkpoint_before: [u8; 32],
        checkpoint_after: [u8; 32],
        trace: Vec<u8>,
    }

    impl Owned {
        fn view(&self) -> OrderedTransitionViewV1<'_> {
            OrderedTransitionViewV1 {
                instrument: self.instrument,
                lifecycle: self.lifecycle,
                position_intent: self.position_intent,
                position_before_grid_units: self.before,
                position_after_grid_units: self.after,
                checkpoint_before: self.checkpoint_before,
                checkpoint_after: self.checkpoint_after,
                trace: &self.trace,
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn transition(
        instrument: Option<&'static str>,
        kind: LifecycleKind,
        sequence: u64,
        intent: PositionIntentV1,
        before: i64,
        after: i64,
        checkpoint: (u8, u8),
        fill: Option<([u8; 16], u64, FillDispositionV1)>,
    ) -> Owned {
        let trace = SemanticTraceV1 {
            order_key: Some(
                EventOrderKeyV1::new(sequence, sequence, kind, sequence, [sequence as u8; 16])
                    .unwrap(),
            ),
            envelope_digest: [9; 32],
            position_intent: intent,
            target_semantic: if intent == PositionIntentV1::Hold {
                TargetSemanticV1::None
            } else {
                TargetSemanticV1::Position
            },
            target: if intent == PositionIntentV1::Hold {
                TargetStateV1::None
            } else {
                TargetStateV1::Position(after)
            },
            fill_disposition: fill.map(|(_, _, disposition)| disposition),
            position_before_units: before,
            position_after_units: after,
            fill_frontier: fill.map_or_else(FillFrontierV1::default, |(identity, units, d)| {
                FillFrontierV1 {
                    intent_identity: identity,
                    cumulative_filled_units: units,
                    terminal_disposition: Some(d),
                }
            }),
            ..SemanticTraceV1::default()
        };
        Owned {
            instrument,
            lifecycle: lifecycle_name(kind),
            position_intent: position_intent_name(intent),
            before,
            after,
            checkpoint_before: [checkpoint.0; 32],
            checkpoint_after: [checkpoint.1; 32],
            trace: trace.encode().to_vec(),
        }
    }

    fn corpus() -> Vec<Owned> {
        vec![
            transition(
                None,
                LifecycleKind::Start,
                1,
                PositionIntentV1::Hold,
                0,
                0,
                (1, 2),
                None,
            ),
            transition(
                Some(AAPL),
                LifecycleKind::Bar,
                10,
                PositionIntentV1::Enter,
                0,
                0,
                (2, 3),
                None,
            ),
            transition(
                Some(MSFT),
                LifecycleKind::Bar,
                10,
                PositionIntentV1::Enter,
                0,
                0,
                (2, 3),
                None,
            ),
            transition(
                Some(AAPL),
                LifecycleKind::Fill,
                11,
                PositionIntentV1::Enter,
                0,
                2,
                (3, 4),
                Some(([7; 16], 2, FillDispositionV1::Filled)),
            ),
            transition(
                Some(MSFT),
                LifecycleKind::Fill,
                12,
                PositionIntentV1::Enter,
                0,
                1,
                (4, 5),
                Some(([8; 16], 1, FillDispositionV1::Filled)),
            ),
            transition(
                None,
                LifecycleKind::Stop,
                99,
                PositionIntentV1::Hold,
                0,
                0,
                (5, 6),
                None,
            ),
        ]
    }

    fn fills() -> Vec<ActualFillViewV1<'static>> {
        vec![
            ActualFillViewV1 {
                instrument: AAPL,
                intent_identity: [7; 16],
                disposition: "FILLED",
                cumulative_filled_grid_units: 2,
                position_before_grid_units: 0,
                position_after_grid_units: 2,
                checkpoint_before: [3; 32],
                checkpoint_after: [4; 32],
            },
            ActualFillViewV1 {
                instrument: MSFT,
                intent_identity: [8; 16],
                disposition: "FILLED",
                cumulative_filled_grid_units: 1,
                position_before_grid_units: 0,
                position_after_grid_units: 1,
                checkpoint_before: [4; 32],
                checkpoint_after: [5; 32],
            },
        ]
    }

    fn validate(
        owned: &[Owned],
        fills: &[ActualFillViewV1<'_>],
    ) -> Result<OrderedTraceCensusV1, OrderedTraceFaultV1> {
        let views = owned.iter().map(Owned::view).collect::<Vec<_>>();
        validate_ordered_semantic_trace_v1(&views, fills, &[AAPL, MSFT], 1)
    }

    #[rstest]
    fn complete_start_to_stop_trace_is_admitted_with_an_exact_census() {
        let census = validate(&corpus(), &fills()).unwrap();
        assert_eq!(
            census,
            OrderedTraceCensusV1 {
                transition_count: 6,
                checkpoint_transition_count: 5,
                target_set_count: 1,
                fill_transition_count: 2,
                reconciled_fill_count: 2,
                initial_checkpoint: [1; 32],
                terminal_checkpoint: [6; 32],
            }
        );
    }

    #[rstest]
    fn lifecycle_must_be_one_host_wide_start_and_stop() {
        assert_eq!(validate(&[], &[]), Err(OrderedTraceFaultV1::Empty));
        let mut no_start = corpus();
        no_start.remove(0);
        assert_eq!(
            validate(&no_start, &fills()),
            Err(OrderedTraceFaultV1::MissingStart)
        );
        let mut no_stop = corpus();
        no_stop.pop();
        assert_eq!(
            validate(&no_stop, &fills()),
            Err(OrderedTraceFaultV1::MissingStop)
        );
        let mut scoped_start = corpus();
        scoped_start[0].instrument = Some(AAPL);
        assert_eq!(
            validate(&scoped_start, &fills()),
            Err(OrderedTraceFaultV1::ScopeMismatch { index: 0 })
        );
        let mut foreign_member = corpus();
        foreign_member[1].instrument = Some("TSLA.XNAS");
        assert_eq!(
            validate(&foreign_member, &fills()),
            Err(OrderedTraceFaultV1::ScopeMismatch { index: 1 })
        );
        let mut unsupported = corpus();
        unsupported[1].lifecycle = "SNAPSHOT";
        assert_eq!(
            validate(&unsupported, &fills()),
            Err(OrderedTraceFaultV1::UnsupportedLifecycle { index: 1 })
        );
    }

    #[rstest]
    fn every_transition_repeats_its_own_canonical_kernel_trace() {
        let mut truncated = corpus();
        truncated[3].trace.pop();
        assert_eq!(
            validate(&truncated, &fills()),
            Err(OrderedTraceFaultV1::MalformedTrace { index: 3 })
        );
        let mut noncanonical = corpus();
        noncanonical[3].trace[2] = 1;
        assert_eq!(
            validate(&noncanonical, &fills()),
            Err(OrderedTraceFaultV1::MalformedTrace { index: 3 })
        );
        let mut relabelled = corpus();
        relabelled[3].position_intent = "ADD";
        assert_eq!(
            validate(&relabelled, &fills()),
            Err(OrderedTraceFaultV1::TraceMismatch { index: 3 })
        );
        let mut moved = corpus();
        moved[3].after = 3;
        assert_eq!(
            validate(&moved, &fills()),
            Err(OrderedTraceFaultV1::TraceMismatch { index: 3 })
        );
        let mut wrong_lifecycle = corpus();
        wrong_lifecycle[3].lifecycle = LIFECYCLE_BAR;
        assert_eq!(
            validate(&wrong_lifecycle, &fills()),
            Err(OrderedTraceFaultV1::TraceMismatch { index: 3 })
        );
        let mut idle = corpus();
        idle[3].checkpoint_after = idle[3].checkpoint_before;
        assert_eq!(
            validate(&idle, &fills()),
            Err(OrderedTraceFaultV1::UnchangedCheckpoint { index: 3 })
        );
    }

    #[rstest]
    fn checkpoint_chain_and_kernel_order_are_unbroken() {
        let mut broken = corpus();
        broken[4].checkpoint_before = [40; 32];
        assert_eq!(
            validate(&broken, &fills()),
            Err(OrderedTraceFaultV1::CheckpointChainBreak { index: 4 })
        );
        let mut regressed = corpus();
        regressed[4] = transition(
            Some(MSFT),
            LifecycleKind::Fill,
            11,
            PositionIntentV1::Enter,
            0,
            1,
            (4, 5),
            Some(([8; 16], 1, FillDispositionV1::Filled)),
        );
        assert_eq!(
            validate(&regressed, &fills()),
            Err(OrderedTraceFaultV1::OrderRegression { index: 4 })
        );
        let mut half_target_set = corpus();
        half_target_set.remove(2);
        assert_eq!(
            validate(&half_target_set, &fills()),
            Err(OrderedTraceFaultV1::TargetSetShape { group: 1 })
        );
        let mut duplicate_member = corpus();
        duplicate_member[2].instrument = Some(AAPL);
        assert_eq!(
            validate(&duplicate_member, &fills()),
            Err(OrderedTraceFaultV1::TargetSetShape { group: 1 })
        );
        let views = corpus();
        let views = views.iter().map(Owned::view).collect::<Vec<_>>();
        assert_eq!(
            validate_ordered_semantic_trace_v1(&views, &fills(), &[AAPL, MSFT], 2),
            Err(OrderedTraceFaultV1::TargetSetCount {
                expected: 2,
                actual: 1
            })
        );
    }

    #[rstest]
    fn every_native_fill_binds_to_exactly_one_reconciling_fill_transition() {
        let mut fills_with_wrong_intent = fills();
        fills_with_wrong_intent[0].intent_identity = [70; 16];
        assert_eq!(
            validate(&corpus(), &fills_with_wrong_intent),
            Err(OrderedTraceFaultV1::UnboundFill { fill: 0 })
        );
        let mut inflated = fills();
        inflated[1].cumulative_filled_grid_units = 3;
        assert_eq!(
            validate(&corpus(), &inflated),
            Err(OrderedTraceFaultV1::UnboundFill { fill: 1 })
        );
        let mut relabelled = fills();
        relabelled[1].disposition = "PARTIALLY_FILLED";
        assert_eq!(
            validate(&corpus(), &relabelled),
            Err(OrderedTraceFaultV1::UnboundFill { fill: 1 })
        );
        let mut duplicated = fills();
        duplicated.push(duplicated[0]);
        assert_eq!(
            validate(&corpus(), &duplicated),
            Err(OrderedTraceFaultV1::UnboundFill { fill: 2 })
        );
        let mut unreported = fills();
        unreported.pop();
        assert_eq!(
            validate(&corpus(), &unreported),
            Err(OrderedTraceFaultV1::UnreportedFill { index: 4 })
        );
    }

    #[rstest]
    fn rejected_or_canceled_fill_transitions_need_no_reported_fill() {
        let mut owned = corpus();
        owned.insert(
            5,
            transition(
                Some(AAPL),
                LifecycleKind::Fill,
                13,
                PositionIntentV1::Enter,
                2,
                2,
                (5, 7),
                Some(([7; 16], 2, FillDispositionV1::Canceled)),
            ),
        );
        owned[6].checkpoint_before = [7; 32];
        owned[6].checkpoint_after = [8; 32];
        let census = validate(&owned, &fills()).unwrap();
        assert_eq!(census.fill_transition_count, 3);
        assert_eq!(census.reconciled_fill_count, 2);
        assert_eq!(census.terminal_checkpoint, [8; 32]);
    }

    #[rstest]
    fn vocabulary_is_stable() {
        assert_eq!(lifecycle_name(LifecycleKind::Start), "START");
        assert_eq!(lifecycle_name(LifecycleKind::Stop), "STOP");
        assert_eq!(position_intent_name(PositionIntentV1::Reduce), "REDUCE");
        assert_eq!(
            fill_disposition_name(FillDispositionV1::Canceled),
            "CANCELED"
        );
        let all = ProtectionSemanticSetV1::default();
        assert!(protection_semantic_ids(all).is_empty());
    }
}
