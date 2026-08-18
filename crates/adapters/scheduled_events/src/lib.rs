//! Offline reader for frozen pre-event archives. Timestamps prove only third-party observation,
//! never publisher signature, system ingestion, qualification, direction, or execution authority.

#![warn(rustc::all)]
#![deny(unsafe_code)]
#![deny(nonstandard_style)]
#![deny(missing_debug_implementations)]
#![deny(clippy::missing_errors_doc)]
#![deny(clippy::missing_panics_doc)]
#![deny(rustdoc::broken_intra_doc_links)]

use std::{collections::BTreeSet, path::Path, sync::Arc};

use anyhow::{Context, ensure};
use jiff::{
    Timestamp,
    civil::{Date, DateTime},
    tz::Offset,
};
use scraper::{ElementRef, Html, Selector};
use serde::Serialize;
use sha2::{Digest, Sha256};
use vibe_core::{
    UnixNanos,
    datetime::{get_timezone, try_datetime_to_unix_nanos},
    paths::custody::{open_custodied_directory, read_bounded_regular_at},
};
use vibe_model::data::{CustomData, CustomDataTrait, DataType, HasTsInit};

const SCHEMA: &str = "vibe.scheduled-events.custodied.v1";
const OBSERVATION_TYPE: &str = "ScheduledEventObservation";
const DATASET_IDENTIFIER: &str = "VIBE_SCHEDULED_EVENTS/OFFICIAL_ARCHIVE/V1";
const MAX_HTML: u64 = 4 * 1024 * 1024;
const TIMEZONE: &str = "America/New_York";
const STATEMENT_RULE: &str = "Committee policy statements for all regularly scheduled meetings will now be released at 2 p.m. Eastern Time.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScheduleSourceKind {
    BlsReleaseCalendar,
    FomcMeetingCalendar,
    FomcStatementRule,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ScheduleSource {
    kind: ScheduleSourceKind,
    filename: String,
    source_url: String,
    archive_timestamp: String,
    cdx_digest: String,
    raw_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScheduledEventPlan {
    year: i16,
    sources: [ScheduleSource; 3],
}

impl ScheduleSource {
    /// Creates one content-addressed source declaration. This does not fetch or authenticate it.
    /// # Errors
    /// Rejects unsafe filenames, non-HTTPS locators, malformed timestamps, or malformed digests.
    pub fn new(
        kind: ScheduleSourceKind,
        filename: impl Into<String>,
        source_url: impl Into<String>,
        archive_timestamp: impl Into<String>,
        cdx_digest: impl Into<String>,
        raw_sha256: impl Into<String>,
    ) -> anyhow::Result<Self> {
        let source = Self {
            kind,
            filename: filename.into(),
            source_url: source_url.into(),
            archive_timestamp: archive_timestamp.into(),
            cdx_digest: cdx_digest.into(),
            raw_sha256: raw_sha256.into(),
        };
        ensure!(
            Path::new(&source.filename).components().count() == 1
                && !source.filename.starts_with('.'),
            "source filename must be a safe leaf"
        );
        ensure!(
            source.source_url.starts_with("https://")
                && !source.cdx_digest.is_empty()
                && source.raw_sha256.len() == 64
                && source
                    .raw_sha256
                    .bytes()
                    .all(|value| value.is_ascii_hexdigit()),
            "source identity is malformed"
        );
        archive_time(&source.archive_timestamp)?;
        Ok(source)
    }
}

impl ScheduledEventPlan {
    /// Creates a provider-plan independent of any strategy or event selection.
    /// # Errors
    /// Rejects an unsupported year, duplicate filenames, or missing/duplicate source roles.
    pub fn new(year: i16, mut sources: [ScheduleSource; 3]) -> anyhow::Result<Self> {
        ensure!(
            (2000..=2100).contains(&year),
            "schedule year is unsupported"
        );
        sources.sort_by_key(|source| source.kind);
        let roles = std::array::from_fn(|index| sources[index].kind);
        ensure!(
            roles
                == [
                    ScheduleSourceKind::BlsReleaseCalendar,
                    ScheduleSourceKind::FomcMeetingCalendar,
                    ScheduleSourceKind::FomcStatementRule,
                ],
            "schedule source roles must be exact and unique"
        );
        let filenames = sources
            .iter()
            .map(|source| source.filename.as_str())
            .collect::<BTreeSet<_>>();
        ensure!(
            filenames.len() == sources.len(),
            "schedule source filenames collide"
        );
        Ok(Self { year, sources })
    }
}

/// A custody-derived scheduled event. Its future schedule is payload, never transport time.
/// ```compile_fail
/// use vibe_scheduled_events::ScheduledEventObservation;
/// let _ = ScheduledEventObservation { event_id: String::new(),
///     scheduled_for: 0_u64.into(),
///     ts_event: 0_u64.into(), ts_init: 0_u64.into() };
/// ```
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ScheduledEventObservation {
    event_id: String,
    scheduled_for: UnixNanos,
    ts_event: UnixNanos,
    ts_init: UnixNanos,
}

impl ScheduledEventObservation {
    pub fn event_id(&self) -> &str {
        &self.event_id
    }

    pub const fn scheduled_for(&self) -> UnixNanos {
        self.scheduled_for
    }

    pub fn data_type() -> DataType {
        DataType::new(OBSERVATION_TYPE, None, Some(DATASET_IDENTIFIER.into()))
    }
}

impl HasTsInit for ScheduledEventObservation {
    fn ts_init(&self) -> UnixNanos {
        self.ts_init
    }
}

impl CustomDataTrait for ScheduledEventObservation {
    fn type_name(&self) -> &'static str {
        OBSERVATION_TYPE
    }
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
    fn ts_event(&self) -> UnixNanos {
        self.ts_event
    }
    fn to_json(&self) -> anyhow::Result<String> {
        Ok(serde_json::to_string(self)?)
    }
    fn clone_arc(&self) -> Arc<dyn CustomDataTrait> {
        Arc::new(self.clone())
    }
    fn eq_arc(&self, other: &dyn CustomDataTrait) -> bool {
        other.as_any().downcast_ref::<Self>() == Some(self)
    }
}

#[derive(Clone, Debug)]
pub struct ScheduledEventDataset {
    manifest_digest: String,
    custom_data: Vec<CustomData>,
}

impl ScheduledEventDataset {
    pub fn manifest_digest(&self) -> &str {
        &self.manifest_digest
    }

    pub fn custom_data(&self) -> &[CustomData] {
        &self.custom_data
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct ParsedEvent {
    event_id: String,
    scheduled_for: UnixNanos,
    observed_at: UnixNanos,
}

/// Opens one declared BLS/Fed schedule set through the repository custody owner without fetching.
/// # Errors
/// Rejects unsafe, missing, tampered, malformed, duplicate, wrong-year, or non-pre-event evidence.
pub fn open_custodied(
    root: &Path,
    plan: &ScheduledEventPlan,
) -> anyhow::Result<ScheduledEventDataset> {
    let custody = open_custodied_directory(root)?;
    let mut raw = Vec::with_capacity(3);
    for evidence in &plan.sources {
        let bytes = read_bounded_regular_at(&custody, Path::new(&evidence.filename), MAX_HTML)?;
        ensure!(
            sha256(&bytes) == evidence.raw_sha256,
            "custodied HTML digest mismatch"
        );
        raw.push(bytes);
    }
    let bls_observed = archive_time(&plan.sources[0].archive_timestamp)?;
    let fed_observed = archive_time(&plan.sources[1].archive_timestamp)?
        .max(archive_time(&plan.sources[2].archive_timestamp)?);
    let mut parsed = parse_bls(&raw[0], bls_observed)?;
    ensure_statement_rule(&raw[2])?;
    parsed.extend(parse_fomc(&raw[1], fed_observed, plan.year)?);
    validate_and_sort(&mut parsed, plan.year)?;
    let manifest_digest = manifest_digest(plan, &parsed)?;
    let data_type = ScheduledEventObservation::data_type();
    let custom_data = parsed
        .into_iter()
        .map(|event| {
            let observation = ScheduledEventObservation {
                event_id: event.event_id,
                scheduled_for: event.scheduled_for,
                ts_event: event.observed_at,
                ts_init: event.observed_at,
            };
            CustomData::new(Arc::new(observation), data_type.clone())
        })
        .collect();
    Ok(ScheduledEventDataset {
        manifest_digest,
        custom_data,
    })
}

fn parse_bls(bytes: &[u8], observed_at: UnixNanos) -> anyhow::Result<Vec<ParsedEvent>> {
    let document = Html::parse_document(std::str::from_utf8(bytes)?);
    let row = selector("tr")?;
    let date_cell = selector("td.date-cell")?;
    let time_cell = selector("td.time-cell")?;
    let description = selector("td.desc-cell strong")?;
    let body_text = normalized_text(document.root_element());
    ensure!(
        body_text.contains("NOTE: All times on calendar are Eastern Time."),
        "BLS timezone declaration missing"
    );
    let mut events = Vec::new();
    for row in document.select(&row) {
        let Some(label) = row.select(&description).next().map(normalized_text) else {
            continue;
        };
        let Some((date, time)) = row
            .select(&date_cell)
            .next()
            .map(normalized_text)
            .zip(row.select(&time_cell).next().map(normalized_text))
            .filter(|(date, time)| !date.is_empty() && !time.is_empty())
        else {
            continue;
        };
        let (_, calendar_date) = date.split_once(", ").context("BLS weekday missing")?;
        let local = DateTime::strptime("%B %e, %Y %I:%M %p", format!("{calendar_date} {time}"))?;
        let scheduled_for = eastern(local)?;
        events.push(parsed(label, scheduled_for, observed_at));
    }
    ensure!(!events.is_empty(), "BLS schedule has no release rows");
    Ok(events)
}

fn parse_fomc(bytes: &[u8], observed_at: UnixNanos, year: i16) -> anyhow::Result<Vec<ParsedEvent>> {
    let document = Html::parse_document(std::str::from_utf8(bytes)?);
    let panels = selector("div.panel")?;
    let heading = selector("div.panel-heading")?;
    let meeting = selector("div.fomc-meeting")?;
    let month = selector("div.fomc-meeting__month")?;
    let date = selector("div.fomc-meeting__date")?;
    let panel = document
        .select(&panels)
        .find(|panel| {
            panel
                .select(&heading)
                .next()
                .is_some_and(|h| normalized_text(h) == format!("{year} FOMC Meetings"))
        })
        .with_context(|| format!("{year} FOMC panel missing"))?;
    let mut events = Vec::new();
    for item in panel.select(&meeting) {
        let month = required_text(item.select(&month).next(), "FOMC month")?;
        let days = required_text(item.select(&date).next(), "FOMC date")?;
        ensure!(!days.contains('('), "non-scheduled FOMC entry rejected");
        let end_month = month.rsplit('/').next().context("FOMC month missing")?;
        let end_day = days
            .trim_end_matches('*')
            .split('-')
            .next_back()
            .context("FOMC end date missing")?
            .trim()
            .parse::<i8>()?;
        let date = Date::new(year, month_number(end_month)?, end_day)?;
        let scheduled_for = eastern(date.at(14, 0, 0, 0))?;
        events.push(parsed("FOMC_STATEMENT".into(), scheduled_for, observed_at));
    }
    ensure!(!events.is_empty(), "FOMC schedule has no regular meetings");
    Ok(events)
}

fn ensure_statement_rule(bytes: &[u8]) -> anyhow::Result<()> {
    let document = Html::parse_document(std::str::from_utf8(bytes)?);
    ensure!(
        normalized_text(document.root_element()).contains(STATEMENT_RULE),
        "exact FOMC release-time rule missing"
    );
    Ok(())
}

fn parsed(event_id: String, scheduled_for: UnixNanos, observed_at: UnixNanos) -> ParsedEvent {
    ParsedEvent {
        event_id,
        scheduled_for,
        observed_at,
    }
}

fn validate_and_sort(events: &mut [ParsedEvent], year: i16) -> anyhow::Result<()> {
    let mut dates = BTreeSet::new();
    for event in events.iter() {
        ensure!(
            event.scheduled_for > event.observed_at,
            "schedule was not observed before event"
        );
        let local = Timestamp::from_nanosecond(i128::from(event.scheduled_for.as_u64()))?
            .to_zoned(get_timezone(TIMEZONE)?);
        ensure!(
            local.year() == year,
            "scheduled event outside declared year"
        );
        ensure!(
            dates.insert((event.event_id.as_str(), local.date())),
            "duplicate or conflicting scheduled event"
        );
    }
    events.sort_by(|left, right| {
        (left.scheduled_for, left.event_id.as_str())
            .cmp(&(right.scheduled_for, right.event_id.as_str()))
    });
    Ok(())
}

fn manifest_digest(plan: &ScheduledEventPlan, events: &[ParsedEvent]) -> anyhow::Result<String> {
    digest_json(&serde_json::json!({
        "schema": SCHEMA,
        "parser_schema": "bls-table-and-fed-panel-v1",
        "timezone": TIMEZONE,
        "year": plan.year,
        "sources": plan.sources,
        "events": events,
    }))
}

fn archive_time(value: &str) -> anyhow::Result<UnixNanos> {
    let local = DateTime::strptime("%Y%m%d%H%M%S", value)?;
    try_datetime_to_unix_nanos(Offset::UTC.to_timestamp(local)?)
}

fn eastern(local: DateTime) -> anyhow::Result<UnixNanos> {
    try_datetime_to_unix_nanos(local.to_zoned(get_timezone(TIMEZONE)?)?.timestamp())
}

fn month_number(value: &str) -> anyhow::Result<i8> {
    Ok(match value.trim() {
        "Jan" | "January" => 1,
        "Feb" | "February" => 2,
        "Mar" | "March" => 3,
        "Apr" | "April" => 4,
        "May" => 5,
        "Jun" | "June" => 6,
        "Jul" | "July" => 7,
        "Aug" | "August" => 8,
        "Sep" | "September" => 9,
        "Oct" | "October" => 10,
        "Nov" | "November" => 11,
        "Dec" | "December" => 12,
        _ => anyhow::bail!("invalid FOMC month"),
    })
}

fn selector(value: &str) -> anyhow::Result<Selector> {
    Selector::parse(value).map_err(|error| anyhow::anyhow!("invalid built-in selector: {error:?}"))
}

fn required_text(element: Option<ElementRef<'_>>, name: &str) -> anyhow::Result<String> {
    element
        .map(normalized_text)
        .filter(|text| !text.is_empty())
        .with_context(|| format!("{name} missing"))
}

fn normalized_text(element: ElementRef<'_>) -> String {
    element
        .text()
        .flat_map(str::split_whitespace)
        .collect::<Vec<_>>()
        .join(" ")
}

fn digest_json(value: &impl Serialize) -> anyhow::Result<String> {
    let mut bytes = serde_json::to_vec(value)?;
    bytes.push(b'\n');
    Ok(sha256(&bytes))
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests;
