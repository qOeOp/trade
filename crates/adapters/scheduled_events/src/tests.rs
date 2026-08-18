use std::{fs, path::Path};

use vibe_core::datetime::unix_nanos_to_iso8601;

use super::*;

const BLS: &str = r#"<!doctype html><html><body>
<p><strong>NOTE: All times on calendar are Eastern Time.</strong></p>
<table><tbody>
<tr><td class="date-cell"><p>Friday, January 6, 2023</p></td><td class="time-cell"><p>08:30 AM</p></td><td class="desc-cell"><p><strong>Employment Situation</strong> for December 2022</p></td></tr>
<tr><td class="date-cell"><p>Thursday, January 12, 2023</p></td><td class="time-cell"><p>08:30 AM</p></td><td class="desc-cell"><p><strong>Consumer Price Index</strong> for December 2022</p></td></tr>
{rows}</tbody></table></body></html>"#;
const FED: &str = r#"<!doctype html><html><body>
<div class="panel panel-default"><div class="panel-heading"><h4><a>2023 FOMC Meetings</a></h4></div>
{meetings}</div></body></html>"#;
const RULE: &str = "<!doctype html><html><body><p>Committee policy statements for all regularly scheduled meetings will now be released at 2 p.m. Eastern Time.</p></body></html>";

fn bls() -> String {
    let mut rows = String::new();
    for month in 2..=12 {
        let name = [
            "",
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ][month];
        for (day, event) in [(2, "Employment Situation"), (12, "Consumer Price Index")] {
            rows.push_str(&format!("<tr><td class=\"date-cell\">Monday, {name} {day}, 2023</td><td class=\"time-cell\">08:30 AM</td><td class=\"desc-cell\"><strong>{event}</strong></td></tr>"));
        }
    }
    BLS.replace("{rows}", &rows)
}

fn fed() -> String {
    let meetings = [
        ("Jan/Feb", "31-1 "),
        ("March", "21-22*"),
        ("May", "2-3"),
        ("June", "13-14*"),
        ("July", "25-26"),
        ("September", "19-20*"),
        ("Oct/Nov", "31-1"),
        ("December", "12-13*"),
    ]
    .into_iter()
    .map(|(month, date)| format!("<div class=\"row fomc-meeting\"><div class=\"fomc-meeting__month\"><strong>{month}</strong></div><div class=\"fomc-meeting__date\">{date}</div></div>"))
    .collect::<String>();
    FED.replace("{meetings}", &meetings)
}

fn test_plan(bls: &[u8], fed: &[u8], rule: &[u8]) -> ScheduledEventPlan {
    ScheduledEventPlan::new(
        2023,
        [
            ScheduleSource::new(
                ScheduleSourceKind::BlsReleaseCalendar,
                "bls.html",
                "https://www.bls.gov/schedule/2023/home.htm",
                "20221018180439",
                "bls-cdx",
                sha256(bls),
            )
            .unwrap(),
            ScheduleSource::new(
                ScheduleSourceKind::FomcMeetingCalendar,
                "fed.html",
                "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
                "20221213005116",
                "fed-cdx",
                sha256(fed),
            )
            .unwrap(),
            ScheduleSource::new(
                ScheduleSourceKind::FomcStatementRule,
                "rule.html",
                "https://www.federalreserve.gov/newsevents/pressreleases/rule.htm",
                "20170430203953",
                "rule-cdx",
                sha256(rule),
            )
            .unwrap(),
        ],
    )
    .unwrap()
}

fn write_fixture(root: &Path, plan: &ScheduledEventPlan, values: [&[u8]; 3]) {
    for (source, value) in plan.sources.iter().zip(values) {
        fs::write(root.join(&source.filename), value).unwrap();
    }
}

fn fixture() -> (tempfile::TempDir, ScheduledEventPlan) {
    let root = tempfile::tempdir().unwrap();
    let bls = bls();
    let fed = fed();
    let plan = test_plan(bls.as_bytes(), fed.as_bytes(), RULE.as_bytes());
    write_fixture(
        root.path(),
        &plan,
        [bls.as_bytes(), fed.as_bytes(), RULE.as_bytes()],
    );
    (root, plan)
}

fn open(root: &Path, plan: &ScheduledEventPlan) -> anyhow::Result<ScheduledEventDataset> {
    open_custodied(&fs::canonicalize(root)?, plan)
}

fn observations(dataset: &ScheduledEventDataset) -> Vec<&ScheduledEventObservation> {
    dataset
        .custom_data()
        .iter()
        .map(|data| {
            data.data
                .as_any()
                .downcast_ref::<ScheduledEventObservation>()
                .unwrap()
        })
        .collect()
}

#[test]
fn emits_sorted_non_forgeable_custom_data_with_dst_and_frozen_type() {
    let (root, plan) = fixture();
    let dataset = open(root.path(), &plan).unwrap();
    let values = observations(&dataset);
    assert_eq!(values.len(), 32);
    assert!(
        values
            .windows(2)
            .all(|pair| pair[0].scheduled_for() <= pair[1].scheduled_for())
    );
    assert!(
        values
            .iter()
            .all(|value| value.ts_event() == value.ts_init())
    );
    assert!(
        values
            .iter()
            .all(|value| value.scheduled_for() > value.ts_event())
    );
    assert!(
        dataset
            .custom_data()
            .iter()
            .all(|data| data.data_type == ScheduledEventObservation::data_type())
    );
    let january = values
        .iter()
        .find(|value| value.event_id() == "Consumer Price Index")
        .unwrap();
    let june = values
        .iter()
        .find(|value| {
            value.event_id() == "Consumer Price Index"
                && unix_nanos_to_iso8601(value.scheduled_for()).starts_with("2023-06")
        })
        .unwrap();
    assert!(unix_nanos_to_iso8601(january.scheduled_for()).ends_with("13:30:00.000000000Z"));
    assert!(unix_nanos_to_iso8601(june.scheduled_for()).ends_with("12:30:00.000000000Z"));
    assert_eq!(
        values
            .iter()
            .filter(|value| value.event_id() == "FOMC_STATEMENT")
            .count(),
        8
    );
}

#[test]
fn manifest_is_reproducible_and_binds_parsed_events() {
    let (root, plan) = fixture();
    let first = open(root.path(), &plan).unwrap();
    let second = open(root.path(), &plan).unwrap();
    assert_eq!(first.manifest_digest(), second.manifest_digest());
    assert_eq!(first.custom_data(), second.custom_data());
}

#[test]
fn rejects_tamper_missing_and_symlink() {
    let (root, plan) = fixture();
    fs::write(root.path().join(&plan.sources[0].filename), b"tamper").unwrap();
    assert!(open(root.path(), &plan).is_err());

    let (root, plan) = fixture();
    fs::remove_file(root.path().join(&plan.sources[1].filename)).unwrap();
    assert!(open(root.path(), &plan).is_err());

    #[cfg(unix)]
    {
        let (root, plan) = fixture();
        fs::remove_file(root.path().join(&plan.sources[2].filename)).unwrap();
        std::os::unix::fs::symlink(
            &plan.sources[0].filename,
            root.path().join(&plan.sources[2].filename),
        )
        .unwrap();
        assert!(open(root.path(), &plan).is_err());
    }
}

#[test]
fn rejects_duplicate_or_conflicting_release() {
    let root = tempfile::tempdir().unwrap();
    let mut bls = bls();
    bls = bls.replace("</tbody>", "<tr><td class=\"date-cell\">Friday, January 6, 2023</td><td class=\"time-cell\">09:30 AM</td><td class=\"desc-cell\"><strong>Employment Situation</strong></td></tr></tbody>");
    let fed = fed();
    let plan = test_plan(bls.as_bytes(), fed.as_bytes(), RULE.as_bytes());
    write_fixture(
        root.path(),
        &plan,
        [bls.as_bytes(), fed.as_bytes(), RULE.as_bytes()],
    );
    assert!(open(root.path(), &plan).is_err());
}

#[test]
fn rejects_non_2023_and_schedule_not_observed_in_advance() {
    let root = tempfile::tempdir().unwrap();
    let bls = bls().replace("January 6, 2023", "January 6, 2024");
    let fed = fed();
    let plan = test_plan(bls.as_bytes(), fed.as_bytes(), RULE.as_bytes());
    write_fixture(
        root.path(),
        &plan,
        [bls.as_bytes(), fed.as_bytes(), RULE.as_bytes()],
    );
    assert!(open(root.path(), &plan).is_err());

    let (root, mut plan) = fixture();
    plan.sources[0].archive_timestamp = "20240101000000".into();
    assert!(open(root.path(), &plan).is_err());
}

#[test]
fn same_owner_accepts_another_declared_year_and_unselected_release() {
    let root = tempfile::tempdir().unwrap();
    let bls = bls()
        .replace("2023", "2024")
        .replace(
            "</tbody>",
            "<tr><td class=\"date-cell\">Monday, January 22, 2024</td><td class=\"time-cell\">08:30 AM</td><td class=\"desc-cell\"><strong>Producer Price Index</strong></td></tr></tbody>",
        );
    let fed = fed().replace("2023", "2024");
    let mut plan = test_plan(bls.as_bytes(), fed.as_bytes(), RULE.as_bytes());
    plan.year = 2024;
    write_fixture(
        root.path(),
        &plan,
        [bls.as_bytes(), fed.as_bytes(), RULE.as_bytes()],
    );
    let dataset = open(root.path(), &plan).unwrap();
    let values = observations(&dataset);
    assert_eq!(values.len(), 33);
    assert!(
        values
            .iter()
            .any(|value| value.event_id() == "Producer Price Index")
    );
}

#[test]
fn rejects_rule_and_calendar_shape_drift() {
    let root = tempfile::tempdir().unwrap();
    let bls = bls();
    let fed = fed();
    let rule = RULE.replace("2 p.m.", "2:30 p.m.");
    let plan = test_plan(bls.as_bytes(), fed.as_bytes(), rule.as_bytes());
    write_fixture(
        root.path(),
        &plan,
        [bls.as_bytes(), fed.as_bytes(), rule.as_bytes()],
    );
    assert!(open(root.path(), &plan).is_err());

    let root = tempfile::tempdir().unwrap();
    let fed = fed.replace("2023 FOMC Meetings", "FOMC Meetings");
    let plan = test_plan(bls.as_bytes(), fed.as_bytes(), RULE.as_bytes());
    write_fixture(
        root.path(),
        &plan,
        [bls.as_bytes(), fed.as_bytes(), RULE.as_bytes()],
    );
    assert!(open(root.path(), &plan).is_err());
}

#[test]
#[ignore = "requires externally custodied official snapshot bytes"]
fn official_cache_probe() {
    let root = std::env::var("VIBE_SCHEDULED_EVENTS_OFFICIAL_CACHE").unwrap();
    let plan = ScheduledEventPlan::new(
        2023,
        [
            ScheduleSource::new(
                ScheduleSourceKind::BlsReleaseCalendar,
                "bls-schedule-2023-20221018180439.html",
                "https://www.bls.gov/schedule/2023/home.htm",
                "20221018180439",
                "HEVTAWNK542IVD7RRBRTJ24QYWFB47BU",
                "48e7410956027a6868e196a1ebade3301af5834632e52474d8e98de8f17492fd",
            )
            .unwrap(),
            ScheduleSource::new(
                ScheduleSourceKind::FomcMeetingCalendar,
                "fed-fomc-calendar-20221213005116.html",
                "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
                "20221213005116",
                "XJCE65BPC5MCTFXEWPU7RWPH5VZYNFV2",
                "dd720d6220e0f06f99ab22c9f915f600815ea4201ef5516fbf6171716194b32c",
            )
            .unwrap(),
            ScheduleSource::new(
                ScheduleSourceKind::FomcStatementRule,
                "fed-fomc-release-rule-20170430203953.html",
                "https://www.federalreserve.gov/newsevents/pressreleases/monetary20130313a.htm",
                "20170430203953",
                "A4TEXVPFH7AIJKQZ4M5KZUEGXDNOAB2O",
                "fd1ec0594fa842e9ca8905a2b4589e529dc988baf8a193517fc8d68161f828b3",
            )
            .unwrap(),
        ],
    )
    .unwrap();
    let dataset = open_custodied(Path::new(&root), &plan).unwrap();
    assert!(dataset.custom_data().len() >= 32);
}
