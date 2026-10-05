//! Pure, unit-tested gating: whether a job is due, given the clock and what this process itself
//! remembers already having tried. None of this is durable - a restart's empty memory just makes
//! every gate fire again on the next tick, and each job's own idempotency (B1's rejoin, B6a's
//! `ON CONFLICT DO NOTHING`) absorbs the repeat. That is the resident process's whole restart
//! story; nothing here persists anything on purpose.

const NS_PER_DAY: i64 = 86_400_000_000_000;
const NS_PER_DAY_U: u64 = 86_400_000_000_000;

fn utc_day(now_ns: u64) -> Option<jiff::civil::Date> {
    jiff::Timestamp::from_nanosecond(i128::from(now_ns))
        .ok()
        .map(|timestamp| timestamp.to_zoned(jiff::tz::TimeZone::UTC).date())
}

/// Whether to attempt (or retry) verifying `target_start_ns` now. `false` once
/// `last_success_target_ns` already names this exact target - a verification, unlike a retry
/// after failure, is never repeated once it has actually succeeded. Otherwise due only once
/// `retry_interval_ns` has passed since `last_attempt_ns` (or there has been no attempt yet) -
/// an attempt is recorded whether it succeeds or not, so a failure (the archive not published
/// yet) is retried on a bounded cadence rather than hitting the archive every tick.
#[must_use]
pub fn verification_retry_due(
    target_start_ns: u64,
    last_success_target_ns: Option<u64>,
    now_ns: u64,
    last_attempt_ns: Option<u64>,
    retry_interval_ns: u64,
) -> bool {
    if last_success_target_ns == Some(target_start_ns) {
        return false;
    }
    last_attempt_ns.is_none_or(|last| now_ns >= last.saturating_add(retry_interval_ns))
}

/// Whether the archive for last month could plausibly have been published yet - the 2nd of the
/// month at the earliest (`docs/owners/market-data.md`'s own measurement: "published on the 2nd
/// of the next month, 09:00 to 12:00 UTC"). A precondition for monthly archive verification,
/// separate from [`verification_retry_due`]'s success/retry bookkeeping.
#[must_use]
pub fn month_archive_plausibly_published(now_ns: u64) -> bool {
    utc_day(now_ns).is_some_and(|today| today.day() >= 2)
}

/// Whether B6a's funding recorder is due: `now_ns` has reached or passed the instant
/// `next_funding_poll_ns_v1` computed from the last known settlement. `None` (no settlement
/// observed yet for this instrument) is always due, so a fresh instrument gets its first poll.
#[must_use]
pub fn funding_poll_due(now_ns: u64, next_poll_ns: Option<u64>) -> bool {
    next_poll_ns.is_none_or(|next| now_ns >= next)
}

/// Yesterday's UTC calendar day, as `(year, month, day)` - the daily archive verification job's
/// own target: a day's archive is never checked before the day has fully closed.
#[must_use]
pub fn yesterday_utc(now_ns: u64) -> Option<(i16, i8, i8)> {
    let (yesterday_start_ns, _) = yesterday_bounds_ns(now_ns)?;
    utc_day(yesterday_start_ns).map(|date| (date.year(), date.month(), date.day()))
}

/// Yesterday's UTC calendar day's own `[start, end)` - the daily archive verification job's own
/// target identity, so a successful verification is recorded against the exact day it verified,
/// never against "whatever day it happened to run on".
#[must_use]
pub fn yesterday_bounds_ns(now_ns: u64) -> Option<(u64, u64)> {
    let today_start_ns = u64::try_from(
        i64::try_from(now_ns).ok()? - i64::try_from(now_ns).ok()?.rem_euclid(NS_PER_DAY),
    )
    .ok()?;
    let yesterday_start_ns = today_start_ns.checked_sub(NS_PER_DAY_U)?;
    Some((yesterday_start_ns, today_start_ns))
}

/// Last UTC calendar month, as `(year, month)` - the monthly archive verification job's own
/// target, checked only once `month_archive_plausibly_published` has already confirmed it is at
/// least the 2nd.
#[must_use]
pub fn last_month_utc(now_ns: u64) -> Option<(i16, i8)> {
    let today = utc_day(now_ns)?;
    let first_of_this_month = today.first_of_month();
    let last_of_last_month = first_of_this_month.yesterday().ok()?;
    Some((last_of_last_month.year(), last_of_last_month.month()))
}

fn date_midnight_utc_ns(date: jiff::civil::Date) -> Option<u64> {
    let timestamp = date
        .at(0, 0, 0, 0)
        .to_zoned(jiff::tz::TimeZone::UTC)
        .ok()?
        .timestamp();
    u64::try_from(timestamp.as_nanosecond()).ok()
}

/// `1w`'s own grid anchor: 1970-01-01 was a Thursday, so the first Monday 00:00 UTC is four days
/// later. Matches `bar_schedule.rs`'s own `MONDAY_NS` exactly - the same grid, computed the same
/// way, so a week this derives can never disagree with the store's own `1w` bars about where a
/// week starts.
const MONDAY_ANCHOR_NS: u64 = 4 * NS_PER_DAY_U;
const WEEK_NS: u64 = 7 * NS_PER_DAY_U;

/// The most recently fully-closed UTC week's `[start, end)`, or `None` before the grid's own
/// first Monday, or before any full week has closed since it.
#[must_use]
pub fn last_week_bounds_ns(now_ns: u64) -> Option<(u64, u64)> {
    if now_ns < MONDAY_ANCHOR_NS {
        return None;
    }
    let week_index = (now_ns - MONDAY_ANCHOR_NS) / WEEK_NS;
    if week_index == 0 {
        return None;
    }
    let this_monday = MONDAY_ANCHOR_NS + week_index * WEEK_NS;
    Some((this_monday - WEEK_NS, this_monday))
}

/// The most recently fully-closed UTC calendar month's `[start, end)`.
#[must_use]
pub fn last_month_bounds_ns(now_ns: u64) -> Option<(u64, u64)> {
    let today = utc_day(now_ns)?;
    let first_of_this_month = today.first_of_month();
    let first_of_last_month = first_of_this_month.yesterday().ok()?.first_of_month();
    let start_ns = date_midnight_utc_ns(first_of_last_month)?;
    let end_ns = date_midnight_utc_ns(first_of_this_month)?;
    Some((start_ns, end_ns))
}

/// Once per closed UTC week: `true` the first time this is called once a given week's `end` has
/// passed, keyed by that week's own start so two different closed weeks are never confused with
/// each other.
#[must_use]
pub fn weekly_gate_due(now_ns: u64, last_done_week_start_ns: Option<u64>) -> bool {
    let Some((week_start, _)) = last_week_bounds_ns(now_ns) else {
        return false;
    };
    last_done_week_start_ns != Some(week_start)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    const DAY: u64 = 86_400_000_000_000;
    // 2026-01-15 00:00:00 UTC.
    const MID_JAN_NS: u64 = 1_768_435_200_000_000_000;

    const HOUR: u64 = 3_600_000_000_000;

    #[rstest]
    fn verification_never_retries_once_it_actually_succeeded() {
        let target = 1_000;
        assert!(verification_retry_due(target, None, MID_JAN_NS, None, HOUR));
        assert!(!verification_retry_due(
            target,
            Some(target),
            MID_JAN_NS,
            None,
            HOUR
        ));
        // A different target (e.g. the next day) is due again even though some target succeeded.
        assert!(verification_retry_due(
            target + DAY,
            Some(target),
            MID_JAN_NS,
            None,
            HOUR
        ));
    }

    #[rstest]
    fn a_failed_attempt_retries_only_after_the_interval_passes() {
        let target = 1_000;
        assert!(!verification_retry_due(
            target,
            None,
            MID_JAN_NS,
            Some(MID_JAN_NS),
            HOUR
        ));
        assert!(!verification_retry_due(
            target,
            None,
            MID_JAN_NS + HOUR - 1,
            Some(MID_JAN_NS),
            HOUR
        ));
        assert!(verification_retry_due(
            target,
            None,
            MID_JAN_NS + HOUR,
            Some(MID_JAN_NS),
            HOUR
        ));
    }

    #[rstest]
    fn the_month_archive_is_not_plausibly_published_before_the_second() {
        // 2026-02-01: not yet the 2nd.
        let feb_1 = MID_JAN_NS + 17 * DAY;
        assert!(!month_archive_plausibly_published(feb_1));
        // 2026-02-02: plausibly published.
        let feb_2 = feb_1 + DAY;
        assert!(month_archive_plausibly_published(feb_2));
    }

    #[rstest]
    fn funding_is_due_with_no_prior_settlement_and_once_the_next_instant_passes() {
        assert!(funding_poll_due(1_000, None));
        assert!(!funding_poll_due(999, Some(1_000)));
        assert!(funding_poll_due(1_000, Some(1_000)));
        assert!(funding_poll_due(1_001, Some(1_000)));
    }

    #[rstest]
    fn yesterday_crosses_the_day_boundary_correctly() {
        // MID_JAN_NS is exactly 2026-01-15 00:00:00 UTC.
        assert_eq!(yesterday_utc(MID_JAN_NS), Some((2026, 1, 14)));
        assert_eq!(yesterday_utc(MID_JAN_NS + DAY - 1), Some((2026, 1, 14)));
        assert_eq!(yesterday_utc(MID_JAN_NS + DAY), Some((2026, 1, 15)));
    }

    #[rstest]
    fn last_month_crosses_a_year_boundary() {
        assert_eq!(last_month_utc(MID_JAN_NS), Some((2025, 12)));
        let feb_2026 = MID_JAN_NS + 20 * DAY;
        assert_eq!(last_month_utc(feb_2026), Some((2026, 1)));
    }

    #[rstest]
    fn last_week_bounds_are_seven_days_ending_on_a_monday() {
        // MID_JAN_NS (2026-01-15) is a Thursday; its week's own Monday is 2026-01-12.
        let (start, end) = last_week_bounds_ns(MID_JAN_NS).expect("a full week has closed");
        assert_eq!(end - start, 7 * DAY);
        assert_eq!(end, start + 7 * DAY);
        // The window is stable across every day of the same week.
        assert_eq!(last_week_bounds_ns(MID_JAN_NS + DAY), Some((start, end)));
        // The following Monday rolls to the next window.
        let days_to_next_monday = 4; // Thursday -> next Monday
        assert_eq!(
            last_week_bounds_ns(MID_JAN_NS + days_to_next_monday * DAY),
            Some((end, end + 7 * DAY))
        );
    }

    #[rstest]
    fn last_month_bounds_are_the_full_prior_calendar_month() {
        let (start, end) = last_month_bounds_ns(MID_JAN_NS).expect("a full month has closed");
        // December 2025 has 31 days.
        assert_eq!(end - start, 31 * DAY);
    }

    #[rstest]
    fn the_weekly_gate_fires_once_per_closed_week() {
        let (week_start, _) = last_week_bounds_ns(MID_JAN_NS).unwrap();
        assert!(weekly_gate_due(MID_JAN_NS, None));
        assert!(!weekly_gate_due(MID_JAN_NS, Some(week_start)));
        assert!(weekly_gate_due(MID_JAN_NS + 7 * DAY, Some(week_start)));
    }
}
