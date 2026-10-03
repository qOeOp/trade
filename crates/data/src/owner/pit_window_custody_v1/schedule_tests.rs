//! The window schedule fact: identity, phase, frame instants and the frame check.

use rstest::rstest;

use super::*;

const SECOND: u64 = 1_000_000_000;
const HOUR: u64 = 3_600 * SECOND;
const DAY: u64 = 24 * HOUR;
/// A UTC midnight in 2023.
const START: u64 = 19_700 * DAY;

fn d(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

fn shape(step: u32) -> DeclaredBarShapeV1 {
    DeclaredBarShapeV1 {
        kind: BarScheduleKindV1::FixedInterval,
        unit: BarScheduleUnitV1::Hour,
        step,
        anchor: DeclaredBarAnchorV1::UnixEpoch,
        clock: BarScheduleClockV1::Continuous,
        label: BarScheduleLabelV1::IntervalClose,
        completion: BarScheduleCompletionV1::CompleteOnly,
    }
}

/// A daily schedule over three days from `START`.
fn daily() -> PitWindowScheduleFactV1 {
    schedule(24, START, START + 3 * DAY)
}

fn schedule(
    step: u32,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
) -> PitWindowScheduleFactV1 {
    let interval_ns = u64::from(step) * HOUR;
    seal(PitWindowScheduleFactV1 {
        custody_identity: d(1),
        chain_root: d(1),
        member_ordinal: 0,
        instrument: "BTCUSDT-PERP.BINANCE".to_owned(),
        timeframe_identity: d(2),
        shape: shape(step),
        interval_ns,
        phase_ns: phase_ns_v1(DeclaredBarAnchorV1::UnixEpoch, interval_ns).unwrap(),
        window_start_ns,
        window_end_ns_exclusive,
        instrument_master_key: d(3),
        instrument_master_fact_digest: d(4),
        market_semantics_identity: d(5),
        cut_ns: 1_790_000_000_000_000_000,
        canonical_bytes: Vec::new(),
        identity: d(0),
    })
    .expect("a T0 schedule seals")
}

#[rstest]
#[case::daily(24)]
#[case::four_hourly(4)]
fn a_grid_from_the_unix_epoch_has_phase_zero(#[case] step: u32) {
    assert_eq!(
        phase_ns_v1(DeclaredBarAnchorV1::UnixEpoch, u64::from(step) * HOUR),
        Some(0)
    );
    assert_eq!(phase_ns_v1(DeclaredBarAnchorV1::SessionOpen, DAY), None);
    assert_eq!(schedule(step, START, START + DAY).phase_ns, 0);
}

#[rstest]
fn the_identity_is_stable_and_binds_every_field() {
    let fact = daily();
    assert_eq!(daily().identity(), fact.identity());
    assert_eq!(fact.identity(), sha256(fact.canonical_bytes()));

    let mut later = fact.clone();
    later.cut_ns += 1;
    assert_ne!(seal(later).unwrap().identity(), fact.identity());
    let mut other_member = fact.clone();
    other_member.member_ordinal = 1;
    assert_ne!(seal(other_member).unwrap().identity(), fact.identity());
    let mut wider = fact.clone();
    wider.window_end_ns_exclusive += DAY;
    assert_ne!(seal(wider).unwrap().identity(), fact.identity());
}

#[rstest]
fn stored_bytes_decode_only_to_the_fact_they_state() {
    let fact = daily();
    assert_eq!(
        decode_window_schedule_v1(fact.canonical_bytes(), fact.identity()),
        Some(fact.clone())
    );

    // Bytes that do not reproduce the identity are refused.
    let mut tampered = fact.canonical_bytes().to_vec();
    let last = tampered.len() - 1;
    tampered[last] ^= 1;
    assert_eq!(decode_window_schedule_v1(&tampered, fact.identity()), None);

    // So are bytes stating a schedule T0 cannot have, even under their own digest: here a phase
    // the epoch anchor does not give.
    let mut off_phase = fact.canonical_bytes().to_vec();
    // From the end: cut, three digests, window end and start, then the phase.
    let phase_at = off_phase.len() - 8 - 32 * 3 - 8 * 3;
    off_phase[phase_at + 7] = 1;
    assert_eq!(
        decode_window_schedule_v1(&off_phase, sha256(&off_phase)),
        None
    );
}

#[rstest]
fn frame_instants_are_the_close_instants_inside_the_run_and_the_window() {
    let fact = daily();
    let all = frame_instants_v1(&fact, START, START + 3 * DAY).collect::<Vec<_>>();
    assert_eq!(all, [START, START + DAY, START + 2 * DAY]);

    // A run inside the window, starting and ending between closes.
    let inner = frame_instants_v1(&fact, START + 1, START + 2 * DAY + 1).collect::<Vec<_>>();
    assert_eq!(inner, [START + DAY, START + 2 * DAY]);

    // The run's end is exclusive, its start inclusive.
    assert_eq!(
        frame_instants_v1(&fact, START + DAY, START + 2 * DAY).collect::<Vec<_>>(),
        [START + DAY]
    );

    // A run reaching past the window is bounded by it, at both ends.
    assert_eq!(
        frame_instants_v1(&fact, 0, u64::MAX).collect::<Vec<_>>(),
        all,
        "the window bounds a run that covers it"
    );

    // An empty run, and a run outside the window, have no frame.
    assert_eq!(
        frame_instants_v1(&fact, START + DAY, START + DAY).count(),
        0
    );
    assert_eq!(frame_instants_v1(&fact, START + 1, START + DAY).count(), 0);
    assert_eq!(
        frame_instants_v1(&fact, START + 3 * DAY, START + 9 * DAY).count(),
        0
    );

    let four_hourly = schedule(4, START, START + DAY);
    assert_eq!(
        frame_instants_v1(&four_hourly, START, START + DAY).count(),
        6
    );
}

/// A backfilled frame: its `d_k` is history, long before the day the custody was minted.
#[rstest]
fn a_historical_frame_of_a_custody_minted_today_is_admitted() {
    let fact = daily();
    let historical = START + DAY + 2 * 60 * SECOND;
    assert!(historical < fact.cut_ns);
    assert!(window_schedule_admits_frame_v1(
        &fact,
        START + DAY,
        historical
    ));
    assert!(window_schedule_admits_frame_v1(&fact, START, START));
}

#[rstest]
fn a_frame_decided_before_the_window_starts_is_refused() {
    let fact = daily();
    assert!(!window_schedule_admits_frame_v1(&fact, START, START - 1));
}

#[rstest]
fn a_frame_outside_the_window_or_off_its_grid_is_refused() {
    let fact = daily();
    let late = fact.cut_ns;
    assert!(!window_schedule_admits_frame_v1(&fact, START - DAY, late));
    assert!(!window_schedule_admits_frame_v1(
        &fact,
        START + 3 * DAY,
        late
    ));
    assert!(!window_schedule_admits_frame_v1(
        &fact,
        START + DAY + 1,
        late
    ));
}
