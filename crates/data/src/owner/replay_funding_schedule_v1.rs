//! A perpetual Replay window's settled funding, as Market Data states it to the layers above.
//!
//! Market Data produces it and owns its completeness: every settlement of each member inside the
//! window, at the interval Market Data derives for that member, with a gap refused rather than
//! filled with a zero rate. The layers above pass it down by value and trust it. The constructor
//! holds only what makes the value and its digest canonical: members in strictly ascending
//! instrument order, each member's settlements in strictly ascending time and inside the window,
//! and every rate normalized, so one schedule has one encoding and one digest.

use rust_decimal::Decimal;
use sha2::{Digest, Sha256};

const REPLAY_FUNDING_SCHEDULE_DIGEST_DOMAIN_V1: &[u8] =
    b"vibe.market-data.replay-funding-schedule.v1\0";

/// One settled funding payment: the venue's rate as published, at its settlement instant.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FundingSettlementV1 {
    settlement_ns: u64,
    rate: Decimal,
}

impl FundingSettlementV1 {
    /// The settlement at `settlement_ns`, in nanoseconds since the Unix epoch, at the venue's exact
    /// `rate`.
    #[must_use]
    pub const fn new(settlement_ns: u64, rate: Decimal) -> Self {
        Self {
            settlement_ns,
            rate,
        }
    }

    /// The settlement instant, in nanoseconds since the Unix epoch.
    #[must_use]
    pub const fn settlement_ns(&self) -> u64 {
        self.settlement_ns
    }

    /// The venue's funding rate for this settlement, exact and normalized.
    #[must_use]
    pub const fn rate(&self) -> Decimal {
        self.rate
    }
}

/// One member's settled funding inside the window.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberFundingScheduleV1 {
    instrument: String,
    settlements: Vec<FundingSettlementV1>,
}

impl MemberFundingScheduleV1 {
    /// One member's settlements, in the order Market Data states them.
    #[must_use]
    pub fn new(instrument: String, settlements: Vec<FundingSettlementV1>) -> Self {
        Self {
            instrument,
            settlements,
        }
    }

    /// The member's canonical instrument identity.
    #[must_use]
    pub fn instrument(&self) -> &str {
        &self.instrument
    }

    /// The member's settlements, in strictly ascending time.
    #[must_use]
    pub fn settlements(&self) -> &[FundingSettlementV1] {
        &self.settlements
    }
}

/// Why a funding schedule is not canonical.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ReplayFundingScheduleErrorV1 {
    /// The window does not advance.
    #[error("FUNDING_SCHEDULE_WINDOW_EMPTY: the window does not advance")]
    WindowEmpty,
    /// The schedule names no member.
    #[error("FUNDING_SCHEDULE_NO_MEMBER: the schedule names no member")]
    NoMember,
    /// Members are not in strictly ascending instrument order.
    #[error("FUNDING_SCHEDULE_MEMBERS_NOT_ASCENDING: {instrument} does not follow its predecessor")]
    MembersNotAscending {
        /// The member out of order.
        instrument: String,
    },
    /// A member's settlements are not in strictly ascending time.
    #[error("FUNDING_SCHEDULE_SETTLEMENTS_NOT_ASCENDING: {instrument} at {settlement_ns}")]
    SettlementsNotAscending {
        /// The member whose settlements are out of order.
        instrument: String,
        /// The settlement that does not follow its predecessor.
        settlement_ns: u64,
    },
    /// A settlement falls outside the window.
    #[error("FUNDING_SCHEDULE_SETTLEMENT_OUTSIDE_WINDOW: {instrument} at {settlement_ns}")]
    SettlementOutsideWindow {
        /// The member whose settlement falls outside.
        instrument: String,
        /// The settlement outside the window.
        settlement_ns: u64,
    },
}

/// Every member's settled funding inside one Replay window, with its content digest.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplayFundingScheduleV1 {
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
    members: Vec<MemberFundingScheduleV1>,
    digest: [u8; 32],
}

impl ReplayFundingScheduleV1 {
    /// The schedule for `[window_start_ns, window_end_ns_exclusive)`.
    ///
    /// # Errors
    ///
    /// Returns [`ReplayFundingScheduleErrorV1`] when the schedule is not canonical; it never
    /// judges completeness, which is Market Data's to prove before it states the schedule.
    pub fn new(
        window_start_ns: u64,
        window_end_ns_exclusive: u64,
        members: Vec<MemberFundingScheduleV1>,
    ) -> Result<Self, ReplayFundingScheduleErrorV1> {
        if window_start_ns >= window_end_ns_exclusive {
            return Err(ReplayFundingScheduleErrorV1::WindowEmpty);
        }

        if members.is_empty() {
            return Err(ReplayFundingScheduleErrorV1::NoMember);
        }

        for pair in members.windows(2) {
            if pair[0].instrument >= pair[1].instrument {
                return Err(ReplayFundingScheduleErrorV1::MembersNotAscending {
                    instrument: pair[1].instrument.clone(),
                });
            }
        }
        let mut members = members;

        for member in &mut members {
            let mut previous = None;

            for settlement in &mut member.settlements {
                if !(window_start_ns..window_end_ns_exclusive).contains(&settlement.settlement_ns) {
                    return Err(ReplayFundingScheduleErrorV1::SettlementOutsideWindow {
                        instrument: member.instrument.clone(),
                        settlement_ns: settlement.settlement_ns,
                    });
                }

                if previous.is_some_and(|previous| previous >= settlement.settlement_ns) {
                    return Err(ReplayFundingScheduleErrorV1::SettlementsNotAscending {
                        instrument: member.instrument.clone(),
                        settlement_ns: settlement.settlement_ns,
                    });
                }
                previous = Some(settlement.settlement_ns);
                settlement.rate = settlement.rate.normalize();
            }
        }
        let digest = digest_schedule(window_start_ns, window_end_ns_exclusive, &members);
        Ok(Self {
            window_start_ns,
            window_end_ns_exclusive,
            members,
            digest,
        })
    }

    /// The window as `(start_ns, end_ns_exclusive)`.
    #[must_use]
    pub const fn window(&self) -> (u64, u64) {
        (self.window_start_ns, self.window_end_ns_exclusive)
    }

    /// The members, in strictly ascending instrument order.
    #[must_use]
    pub fn members(&self) -> &[MemberFundingScheduleV1] {
        &self.members
    }

    /// The content digest over the schedule's one canonical encoding.
    #[must_use]
    pub const fn digest(&self) -> [u8; 32] {
        self.digest
    }
}

fn digest_schedule(
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
    members: &[MemberFundingScheduleV1],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(REPLAY_FUNDING_SCHEDULE_DIGEST_DOMAIN_V1);
    hasher.update(window_start_ns.to_be_bytes());
    hasher.update(window_end_ns_exclusive.to_be_bytes());
    hasher.update((members.len() as u64).to_be_bytes());

    for member in members {
        hasher.update((member.instrument.len() as u64).to_be_bytes());
        hasher.update(member.instrument.as_bytes());
        hasher.update((member.settlements.len() as u64).to_be_bytes());

        for settlement in &member.settlements {
            hasher.update(settlement.settlement_ns.to_be_bytes());
            hasher.update(settlement.rate.mantissa().to_be_bytes());
            hasher.update(settlement.rate.scale().to_be_bytes());
        }
    }
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn settlement(settlement_ns: u64, rate: &str) -> FundingSettlementV1 {
        FundingSettlementV1::new(settlement_ns, rate.parse().unwrap())
    }

    fn member(instrument: &str, settlements: &[(u64, &str)]) -> MemberFundingScheduleV1 {
        MemberFundingScheduleV1::new(
            instrument.to_owned(),
            settlements
                .iter()
                .map(|(at, rate)| settlement(*at, rate))
                .collect(),
        )
    }

    #[rstest]
    fn one_schedule_has_one_digest_whatever_the_rates_trailing_zeros() {
        let plain = ReplayFundingScheduleV1::new(
            0,
            100,
            vec![member(
                "BTCUSDT-PERP.BINANCE",
                &[(10, "0.0001"), (40, "-0.00005")],
            )],
        )
        .unwrap();
        let padded = ReplayFundingScheduleV1::new(
            0,
            100,
            vec![member(
                "BTCUSDT-PERP.BINANCE",
                &[(10, "0.000100"), (40, "-0.0000500")],
            )],
        )
        .unwrap();
        assert_eq!(plain.digest(), padded.digest());
        assert_eq!(plain, padded);
    }

    #[rstest]
    #[case::rate(vec![member("BTCUSDT-PERP.BINANCE", &[(10, "0.0002")])])]
    #[case::instant(vec![member("BTCUSDT-PERP.BINANCE", &[(11, "0.0001")])])]
    #[case::instrument(vec![member("ETHUSDT-PERP.BINANCE", &[(10, "0.0001")])])]
    #[case::no_settlement(vec![member("BTCUSDT-PERP.BINANCE", &[])])]
    fn any_change_to_the_schedule_changes_its_digest(
        #[case] changed: Vec<MemberFundingScheduleV1>,
    ) {
        let base = ReplayFundingScheduleV1::new(
            0,
            100,
            vec![member("BTCUSDT-PERP.BINANCE", &[(10, "0.0001")])],
        )
        .unwrap();
        let changed = ReplayFundingScheduleV1::new(0, 100, changed).unwrap();
        assert_ne!(base.digest(), changed.digest());
    }

    #[rstest]
    fn the_window_is_in_the_digest() {
        let members = || vec![member("BTCUSDT-PERP.BINANCE", &[(10, "0.0001")])];
        assert_ne!(
            ReplayFundingScheduleV1::new(0, 100, members())
                .unwrap()
                .digest(),
            ReplayFundingScheduleV1::new(0, 101, members())
                .unwrap()
                .digest()
        );
    }

    #[rstest]
    #[case::empty_window(5, 5, vec![member("BTCUSDT-PERP.BINANCE", &[])], "FUNDING_SCHEDULE_WINDOW_EMPTY")]
    #[case::no_member(0, 100, vec![], "FUNDING_SCHEDULE_NO_MEMBER")]
    #[case::members_out_of_order(
        0,
        100,
        vec![member("ETHUSDT-PERP.BINANCE", &[]), member("BTCUSDT-PERP.BINANCE", &[])],
        "FUNDING_SCHEDULE_MEMBERS_NOT_ASCENDING"
    )]
    #[case::member_twice(
        0,
        100,
        vec![member("BTCUSDT-PERP.BINANCE", &[]), member("BTCUSDT-PERP.BINANCE", &[])],
        "FUNDING_SCHEDULE_MEMBERS_NOT_ASCENDING"
    )]
    #[case::settlements_out_of_order(
        0,
        100,
        vec![member("BTCUSDT-PERP.BINANCE", &[(40, "0.0001"), (10, "0.0001")])],
        "FUNDING_SCHEDULE_SETTLEMENTS_NOT_ASCENDING"
    )]
    #[case::settlement_twice(
        0,
        100,
        vec![member("BTCUSDT-PERP.BINANCE", &[(10, "0.0001"), (10, "0.0002")])],
        "FUNDING_SCHEDULE_SETTLEMENTS_NOT_ASCENDING"
    )]
    #[case::settlement_at_the_end(
        0,
        100,
        vec![member("BTCUSDT-PERP.BINANCE", &[(100, "0.0001")])],
        "FUNDING_SCHEDULE_SETTLEMENT_OUTSIDE_WINDOW"
    )]
    #[case::settlement_before_the_start(
        10,
        100,
        vec![member("BTCUSDT-PERP.BINANCE", &[(9, "0.0001")])],
        "FUNDING_SCHEDULE_SETTLEMENT_OUTSIDE_WINDOW"
    )]
    fn a_schedule_that_is_not_canonical_is_refused_by_name(
        #[case] start: u64,
        #[case] end: u64,
        #[case] members: Vec<MemberFundingScheduleV1>,
        #[case] refusal: &str,
    ) {
        let e = ReplayFundingScheduleV1::new(start, end, members).unwrap_err();
        assert!(e.to_string().starts_with(refusal), "{e}");
    }

    #[rstest]
    fn a_settlement_at_the_windows_start_is_inside_it() {
        assert!(
            ReplayFundingScheduleV1::new(
                10,
                100,
                vec![member("BTCUSDT-PERP.BINANCE", &[(10, "0.0001")])]
            )
            .is_ok()
        );
    }
}
