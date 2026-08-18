use std::{
    collections::{BTreeMap, BTreeSet},
    io::{Cursor, Read},
    path::Path,
    sync::Arc,
};

use anyhow::{Context, ensure};
use rust_decimal::Decimal;
use serde::Serialize;
use sha2::{Digest, Sha256};
use time::{Date, Duration, macros::format_description};
use vibe_core::{
    UnixNanos,
    paths::custody::{open_custodied_directory, read_bounded_regular_at},
};
use vibe_model::data::{CustomData, CustomDataTrait, DataType, HasTsInit};
use zip::{CompressionMethod, ZipArchive, read::ZipFile};

const SCHEMA: &str = "vibe.alfred.custodied.v1";
const OBSERVATION_TYPE: &str = "FredObservation";
const ID_PREFIX: &str = "FRED:";
const MAX_ARCHIVE: u64 = 20 * 1024 * 1024;
const MAX_MEMBER: u64 = 10 * 1024 * 1024;
const DATE_FORMAT: &[time::format_description::FormatItem<'static>] =
    format_description!("[year]-[month]-[day]");

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AlfredQuery {
    series_id: String,
    observation_start: String,
    observation_end: String,
    vintage_start: String,
    vintage_end: String,
}

impl AlfredQuery {
    pub fn new(
        series_id: impl Into<String>,
        observation_start: impl Into<String>,
        observation_end: impl Into<String>,
        vintage_start: impl Into<String>,
        vintage_end: impl Into<String>,
    ) -> Self {
        Self {
            series_id: series_id.into(),
            observation_start: observation_start.into(),
            observation_end: observation_end.into(),
            vintage_start: vintage_start.into(),
            vintage_end: vintage_end.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AlfredPlan(Vec<AlfredQuery>);

impl AlfredPlan {
    /// # Errors
    /// Rejects invalid or duplicate series, dates, spans, and plans outside one to eight series.
    pub fn new(mut queries: Vec<AlfredQuery>) -> anyhow::Result<Self> {
        ensure!(
            (1..=8).contains(&queries.len()),
            "plan must contain 1..=8 series"
        );
        for query in &queries {
            ensure!(
                (1..=32).contains(&query.series_id.len())
                    && query.series_id.bytes().all(|byte| {
                        byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_'
                    }),
                "invalid ALFRED series id"
            );
            for (start, end, max_days) in [
                (&query.observation_start, &query.observation_end, 3_660),
                (&query.vintage_start, &query.vintage_end, 366),
            ] {
                let (start, end) = (date(start)?, date(end)?);
                ensure!(
                    start <= end && (end - start).whole_days() <= max_days,
                    "invalid or excessive date range"
                );
            }
        }
        queries.sort_by(|a, b| a.series_id.cmp(&b.series_id));
        ensure!(
            queries
                .windows(2)
                .all(|pair| pair[0].series_id != pair[1].series_id),
            "duplicate series id"
        );
        Ok(Self(queries))
    }
}

/// A custody-derived ALFRED observation. Callers can inspect but cannot forge one.
///
/// ```compile_fail
/// use vibe_fred::FredObservation;
/// let _ = FredObservation { series_id: String::new(), observation: "1".parse().unwrap(),
///     ts_event: 0_u64.into(), ts_init: 0_u64.into() };
/// ```
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FredObservation {
    series_id: String,
    observation: Decimal,
    ts_event: UnixNanos,
    ts_init: UnixNanos,
}

impl FredObservation {
    pub fn series_id(&self) -> &str {
        &self.series_id
    }
    pub fn observation(&self) -> Decimal {
        self.observation
    }
    pub fn data_type(series_id: &str) -> DataType {
        DataType::new(
            OBSERVATION_TYPE,
            None,
            Some(format!("{ID_PREFIX}{series_id}")),
        )
    }
}

impl HasTsInit for FredObservation {
    fn ts_init(&self) -> UnixNanos {
        self.ts_init
    }
}

impl CustomDataTrait for FredObservation {
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct AlfredSeriesCounts {
    pub usable: usize,
    pub missing: usize,
}

#[derive(Clone, Debug)]
pub struct AlfredDataset {
    manifest_digest: String,
    series_counts: BTreeMap<String, AlfredSeriesCounts>,
    custom_data: Vec<CustomData>,
}

impl AlfredDataset {
    pub fn manifest_digest(&self) -> &str {
        &self.manifest_digest
    }
    pub fn series_counts(&self, series_id: &str) -> Option<AlfredSeriesCounts> {
        self.series_counts.get(series_id).copied()
    }
    pub fn custom_data(&self) -> &[CustomData] {
        &self.custom_data
    }
}

#[derive(Serialize)]
struct SeriesEvidence {
    query: AlfredQuery,
    archive_sha256: String,
    readme_sha256: String,
    csv_sha256: String,
    vintage_dates: Vec<String>,
    counts: AlfredSeriesCounts,
}

/// Opens frozen ALFRED ZIP files through the repository custody owner without writing or fetching.
///
/// # Errors
/// Rejects unsafe paths, malformed archives, metadata drift, revisions, and out-of-range dates.
pub fn open_custodied(root: &Path, plan: &AlfredPlan) -> anyhow::Result<AlfredDataset> {
    let custody = open_custodied_directory(root)?;
    let mut evidence = Vec::with_capacity(plan.0.len());
    let mut series_counts = BTreeMap::new();
    let mut custom_data = Vec::new();
    for query in &plan.0 {
        let path = format!("{}.zip", query.series_id);
        let archive = read_bounded_regular_at(&custody, Path::new(&path), MAX_ARCHIVE)?;
        let (readme, csv) = archive_members(&archive)?;
        let vintages = read_vintages(&readme, query)?;
        let (counts, mut data) = parse_csv(&csv, query, &vintages)?;
        evidence.push(SeriesEvidence {
            query: query.clone(),
            archive_sha256: sha256(&archive),
            readme_sha256: sha256(&readme),
            csv_sha256: sha256(&csv),
            vintage_dates: vintages.into_iter().collect(),
            counts,
        });
        series_counts.insert(query.series_id.clone(), counts);
        custom_data.append(&mut data);
    }
    custom_data.sort_by_key(|item| {
        (
            item.ts_init(),
            item.data_type.identifier().map(str::to_owned),
            item.data.ts_event(),
        )
    });
    let mut bytes = serde_json::to_vec(&BTreeMap::from([
        ("schema", serde_json::to_value(SCHEMA)?),
        ("series", serde_json::to_value(evidence)?),
    ]))?;
    bytes.push(b'\n');
    Ok(AlfredDataset {
        manifest_digest: sha256(&bytes),
        series_counts,
        custom_data,
    })
}

fn archive_members(bytes: &[u8]) -> anyhow::Result<(Vec<u8>, Vec<u8>)> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;
    ensure!(
        archive.len() == 2,
        "ALFRED ZIP must contain exactly two members"
    );
    let readme = read_member(archive.by_name("README.txt")?)?;
    let csv = read_member(archive.by_name("obs.,_initial_release_only.csv")?)?;
    Ok((readme, csv))
}

fn read_member<R: Read>(mut member: ZipFile<'_, R>) -> anyhow::Result<Vec<u8>> {
    let name = member.name().to_string();
    ensure!(
        member.is_file() && !member.is_symlink() && !member.encrypted(),
        "unsafe ZIP member"
    );
    ensure!(
        matches!(
            member.compression(),
            CompressionMethod::Stored | CompressionMethod::Deflated
        ),
        "unsupported ZIP compression"
    );
    ensure!(member.size() <= MAX_MEMBER, "ZIP member exceeds bound");
    ensure!(
        member.enclosed_name().as_deref() == Some(Path::new(&name)),
        "unsafe ZIP member name"
    );
    let mut content = Vec::new();
    member
        .by_ref()
        .take(MAX_MEMBER + 1)
        .read_to_end(&mut content)?;
    ensure!(
        content.len() as u64 <= MAX_MEMBER,
        "ZIP member exceeds bound"
    );
    Ok(content)
}

fn read_vintages(bytes: &[u8], query: &AlfredQuery) -> anyhow::Result<BTreeSet<String>> {
    let text = std::str::from_utf8(bytes)?;
    let series_line = format!("Series ID: {}", query.series_id);
    ensure!(
        text.lines().filter(|line| *line == series_line).count() == 1,
        "README series mismatch"
    );
    ensure!(
        text.lines()
            .filter(|line| *line == "Output Format: Observations, Initial Release Only")
            .count()
            == 1,
        "README output format mismatch"
    );
    let marker = "Vintage Dates Specified:\n----------\n";
    ensure!(
        text.matches(marker).count() == 1,
        "README vintage block is not unique"
    );
    let block = text
        .split_once(marker)
        .context("README vintage block missing")?
        .1
        .split_once("\n----------\n")
        .context("README vintage block unterminated")?
        .0;
    let mut vintages = BTreeSet::new();
    let mut previous = None;
    for raw in block.lines() {
        bounded_date(
            raw,
            &query.vintage_start,
            &query.vintage_end,
            "README vintage",
        )?;
        ensure!(
            previous.is_none_or(|value| value < raw),
            "README vintages are duplicate or unsorted"
        );
        vintages.insert(raw.to_string());
        previous = Some(raw);
    }
    ensure!(!vintages.is_empty(), "README vintage block is empty");
    Ok(vintages)
}

fn parse_csv(
    bytes: &[u8],
    query: &AlfredQuery,
    vintages: &BTreeSet<String>,
) -> anyhow::Result<(AlfredSeriesCounts, Vec<CustomData>)> {
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_reader(bytes);
    let expected = [
        "period_start_date",
        query.series_id.as_str(),
        "realtime_start_date",
    ];
    ensure!(
        reader.headers()?.iter().eq(expected),
        "unexpected ALFRED CSV schema"
    );
    let mut seen = BTreeSet::new();
    let mut missing = 0;
    let mut data = Vec::new();
    for row in reader.records() {
        let row = row?;
        ensure!(row.len() == 3, "unexpected ALFRED CSV width");
        let observed = bounded_date(
            &row[0],
            &query.observation_start,
            &query.observation_end,
            "observation",
        )?;
        let realtime = bounded_date(&row[2], &query.vintage_start, &query.vintage_end, "release")?;
        ensure!(
            vintages.contains(&row[2]),
            "CSV release is absent from README vintages"
        );
        ensure!(
            seen.insert(row[0].to_string()),
            "duplicate initial observation"
        );
        if row[1].is_empty() || &row[1] == "." {
            missing += 1;
            continue;
        }
        let ts_event = day_end(observed)?;
        let ts_init = midnight(realtime + Duration::days(1))?;
        ensure!(
            ts_init > ts_event,
            "initial release is not after observation"
        );
        let value = FredObservation {
            series_id: query.series_id.clone(),
            observation: Decimal::from_str_exact(&row[1]).context("invalid observation decimal")?,
            ts_event,
            ts_init,
        };
        data.push(CustomData::new(
            Arc::new(value),
            FredObservation::data_type(&query.series_id),
        ));
    }
    Ok((
        AlfredSeriesCounts {
            usable: data.len(),
            missing,
        },
        data,
    ))
}

fn bounded_date(value: &str, start: &str, end: &str, label: &str) -> anyhow::Result<Date> {
    let value = date(value)?;
    ensure!(
        (date(start)?..=date(end)?).contains(&value),
        "{label} is outside frozen range"
    );
    Ok(value)
}

fn date(value: &str) -> anyhow::Result<Date> {
    Ok(Date::parse(value, DATE_FORMAT)?)
}
fn midnight(value: Date) -> anyhow::Result<UnixNanos> {
    Ok(UnixNanos::new(u64::try_from(
        value.midnight().assume_utc().unix_timestamp_nanos(),
    )?))
}
fn day_end(value: Date) -> anyhow::Result<UnixNanos> {
    Ok(UnixNanos::new(
        midnight(value + Duration::days(1))?.as_u64() - 1,
    ))
}
fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use std::{fs, io::Write};

    use zip::{ZipWriter, write::SimpleFileOptions};

    use super::*;

    fn query(series: &str) -> AlfredQuery {
        AlfredQuery::new(
            series,
            "2023-01-01",
            "2023-01-10",
            "2023-01-03",
            "2023-01-10",
        )
    }

    fn readme(series: &str) -> String {
        format!(
            "----------\nSeries ID: {series}\nOutput Format: Observations, Initial Release Only\nVintage Dates Specified:\n----------\n2023-01-03\n2023-01-04\n2023-01-10\n----------\n"
        )
    }

    fn csv(series: &str) -> String {
        format!(
            "period_start_date,{series},realtime_start_date\n2023-01-02,.,2023-01-04\n2023-01-03,4.40,2023-01-04\n"
        )
    }

    fn archive(readme: &str, csv: &str) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        writer.start_file("README.txt", options).unwrap();
        writer.write_all(readme.as_bytes()).unwrap();
        writer
            .start_file("obs.,_initial_release_only.csv", options)
            .unwrap();
        writer.write_all(csv.as_bytes()).unwrap();
        writer.finish().unwrap().into_inner()
    }

    fn write_series(root: &Path, series: &str, readme_text: &str, csv_text: &str) {
        fs::write(
            root.join(format!("{series}.zip")),
            archive(readme_text, csv_text),
        )
        .unwrap();
    }

    #[test]
    fn opens_two_series_deterministically_and_counts_missing() {
        let root = tempfile::tempdir().unwrap();
        let path = fs::canonicalize(root.path()).unwrap();
        for series in ["DGS2", "DGS10"] {
            write_series(&path, series, &readme(series), &csv(series));
        }
        fs::write(path.join("inert-extra"), b"ignored").unwrap();
        let plan = AlfredPlan::new(vec![query("DGS2"), query("DGS10")]).unwrap();
        let first = open_custodied(&path, &plan).unwrap();
        let second = open_custodied(&path, &plan).unwrap();
        assert_eq!(first.manifest_digest(), second.manifest_digest());
        assert_eq!(first.custom_data().len(), 2);
        assert_eq!(
            first.series_counts("DGS2"),
            Some(AlfredSeriesCounts {
                usable: 1,
                missing: 1
            })
        );
        assert_eq!(
            first.custom_data()[0].data_type,
            FredObservation::data_type("DGS10")
        );
    }

    #[test]
    fn plan_rebound_schema_revision_and_tamper_fail_closed() {
        let root = tempfile::tempdir().unwrap();
        let path = fs::canonicalize(root.path()).unwrap();
        write_series(&path, "DGS2", &readme("DGS2"), &csv("DGS2"));
        let rebound = AlfredPlan::new(vec![AlfredQuery::new(
            "DGS2",
            "2023-01-04",
            "2023-01-10",
            "2023-01-03",
            "2023-01-10",
        )])
        .unwrap();
        assert!(open_custodied(&path, &rebound).is_err());
        write_series(
            &path,
            "DGS2",
            &readme("DGS2"),
            "date,DGS2,realtime_start_date\n2023-01-03,4.4,2023-01-04\n",
        );
        assert!(open_custodied(&path, &AlfredPlan::new(vec![query("DGS2")]).unwrap()).is_err());
        fs::write(path.join("DGS2.zip"), b"tampered").unwrap();
        assert!(open_custodied(&path, &AlfredPlan::new(vec![query("DGS2")]).unwrap()).is_err());
    }

    #[test]
    fn revision_rows_and_bad_vintages_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let path = fs::canonicalize(root.path()).unwrap();
        let revision = "period_start_date,DGS2,realtime_start_date\n2023-01-03,4.4,2023-01-04\n2023-01-03,4.5,2023-01-10\n";
        write_series(&path, "DGS2", &readme("DGS2"), revision);
        let plan = AlfredPlan::new(vec![query("DGS2")]).unwrap();
        assert!(open_custodied(&path, &plan).is_err());
        write_series(
            &path,
            "DGS2",
            &readme("DGS2").replace("2023-01-04\n2023-01-10", "2023-01-10\n2023-01-04"),
            &csv("DGS2"),
        );
        assert!(open_custodied(&path, &plan).is_err());
    }

    #[test]
    #[ignore = "set VIBE_FRED_OFFICIAL_DATASET_ROOT to run the offline official-data probe"]
    fn official_2023_dataset_is_deterministic() {
        let Ok(root) = std::env::var("VIBE_FRED_OFFICIAL_DATASET_ROOT") else {
            return;
        };
        let root = fs::canonicalize(root).unwrap();
        let plan = AlfredPlan::new(
            ["DGS2", "DGS10"]
                .map(|series| {
                    AlfredQuery::new(
                        series,
                        "2023-01-01",
                        "2023-12-28",
                        "2023-01-01",
                        "2023-12-31",
                    )
                })
                .to_vec(),
        )
        .unwrap();
        let first = open_custodied(&root, &plan).unwrap();
        let second = open_custodied(&root, &plan).unwrap();
        assert_eq!(first.manifest_digest(), second.manifest_digest());
        assert!(first.series_counts("DGS2").unwrap().usable > 0);
        assert!(first.series_counts("DGS10").unwrap().usable > 0);
    }

    #[cfg(unix)]
    #[test]
    fn archive_symlink_is_rejected_by_custody_owner() {
        let root = tempfile::tempdir().unwrap();
        let path = fs::canonicalize(root.path()).unwrap();
        let outside = path.join("outside.zip");
        fs::write(&outside, archive(&readme("DGS2"), &csv("DGS2"))).unwrap();
        std::os::unix::fs::symlink(&outside, path.join("DGS2.zip")).unwrap();
        assert!(open_custodied(&path, &AlfredPlan::new(vec![query("DGS2")]).unwrap()).is_err());
    }
}
