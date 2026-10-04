//! UTC calendar arithmetic on nanosecond timestamps, without a time zone database.

const NANOS_PER_DAY: i64 = 86_400_000_000_000;

/// Days since 1970-01-01, rounding toward the past.
const fn days_of_ns(ns: i64) -> i64 {
    ns.div_euclid(NANOS_PER_DAY)
}

/// The UTC calendar year a timestamp falls in (Hinnant's civil-from-days).
pub(crate) fn utc_year_of_ns(ns: i64) -> i32 {
    let z = days_of_ns(ns) + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let year = year_of_era + era * 400 + i64::from(month_index >= 10);
    i32::try_from(year).expect("a nanosecond timestamp's year fits an i32")
}

/// The ISO calendar week a timestamp falls in, as the count of Monday-to-Sunday UTC weeks since
/// the week of 1970-01-01, a Thursday. Only equality and order of weeks are read.
pub(crate) const fn iso_week_of_ns(ns: i64) -> i64 {
    (days_of_ns(ns) + 3).div_euclid(7)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    const DAY: i64 = NANOS_PER_DAY;

    #[rstest]
    #[case::epoch(0, 1970)]
    #[case::last_nanosecond_of_1969(-1, 1969)]
    #[case::new_year_2024(19_723 * DAY, 2024)]
    #[case::last_day_of_2023(19_722 * DAY, 2023)]
    #[case::leap_day_2024(19_782 * DAY, 2024)]
    #[case::new_year_2100(47_482 * DAY, 2100)]
    fn the_year_is_the_utc_calendar_year(#[case] ns: i64, #[case] year: i32) {
        assert_eq!(utc_year_of_ns(ns), year);
    }

    /// 2024-01-01 is a Monday: it starts a week, and the Sunday before ends the previous one.
    #[rstest]
    fn weeks_run_monday_to_sunday() {
        let monday = 19_723 * DAY;
        assert_eq!(
            iso_week_of_ns(monday),
            iso_week_of_ns(monday + 6 * DAY + DAY - 1)
        );
        assert_eq!(iso_week_of_ns(monday - 1), iso_week_of_ns(monday) - 1);
        assert_eq!(iso_week_of_ns(monday + 7 * DAY), iso_week_of_ns(monday) + 1);
    }
}
