use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::env;
use std::error::Error;
use std::fs;
use std::time::Instant;
use trade_l2_order_book_core::{
    DepthUpdate, ProjectionOutcome, Snapshot, normalize_decimal, project_updates,
};

const FIXTURE_SCHEMA: &str = "trade.l2-bakeoff-fixture.v1";
const RESULT_SCHEMA: &str = "trade.l2-bakeoff-result.v1";

#[derive(Clone, Debug, Deserialize)]
struct Fixture {
    schema_version: String,
    fixture_id: String,
    stream_epoch: String,
    symbol: String,
    snapshot: Snapshot,
    events: Vec<DepthUpdate>,
    expected: ProjectionOutcome,
}

#[derive(Debug, Serialize)]
struct ResultEnvelope {
    schema_version: &'static str,
    implementation: &'static str,
    fixture_id: String,
    source_hash: String,
    iterations: usize,
    processed_event_count: usize,
    elapsed_ns: u128,
    outcome: ProjectionOutcome,
}

struct Arguments {
    fixture: String,
    iterations: usize,
}

fn main() -> Result<(), Box<dyn Error>> {
    let arguments = parse_args(env::args().skip(1).collect())?;
    let raw = fs::read_to_string(&arguments.fixture)?;
    let result = run_bakeoff(&raw, arguments.iterations)?;
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}

fn parse_args(values: Vec<String>) -> Result<Arguments, Box<dyn Error>> {
    let mut fixture = String::from("fixtures/complete.json");
    let mut iterations = 1;
    let mut index = 0;
    while index < values.len() {
        match values[index].as_str() {
            "--fixture" if index + 1 < values.len() => {
                fixture = values[index + 1].clone();
                index += 2;
            }
            "--iterations" if index + 1 < values.len() => {
                iterations = values[index + 1].parse()?;
                index += 2;
            }
            value => return Err(format!("unknown or incomplete argument: {value}").into()),
        }
    }
    if iterations == 0 {
        return Err("iterations must be positive".into());
    }
    Ok(Arguments {
        fixture,
        iterations,
    })
}

fn run_bakeoff(raw: &str, iterations: usize) -> Result<ResultEnvelope, Box<dyn Error>> {
    if iterations == 0 {
        return Err("iterations must be positive".into());
    }
    let fixture = parse_fixture(raw)?;
    let mut outcome = None;
    let started_at = Instant::now();
    for _ in 0..iterations {
        outcome = Some(project_fixture(&fixture)?);
    }
    let outcome = outcome.ok_or("projection produced no outcome")?;
    Ok(ResultEnvelope {
        schema_version: RESULT_SCHEMA,
        implementation: "rust",
        fixture_id: fixture.fixture_id,
        source_hash: format!("{:x}", Sha256::digest(raw.as_bytes())),
        iterations,
        processed_event_count: outcome.applied_event_count * iterations,
        elapsed_ns: started_at.elapsed().as_nanos(),
        outcome,
    })
}

fn parse_fixture(raw: &str) -> Result<Fixture, Box<dyn Error>> {
    let fixture: Fixture = serde_json::from_str(raw)?;
    if fixture.schema_version != FIXTURE_SCHEMA {
        return Err("unsupported fixture schema_version".into());
    }
    if fixture.fixture_id.is_empty() || fixture.stream_epoch.is_empty() || fixture.symbol.is_empty()
    {
        return Err("fixture identity fields must be non-empty".into());
    }
    if fixture.events.is_empty() {
        return Err("fixture events must be non-empty".into());
    }
    if !matches!(fixture.expected.status.as_str(), "complete" | "incomplete")
        || fixture.expected.book_hash.len() != 64
    {
        return Err("fixture expected outcome is invalid".into());
    }
    for [price, quantity] in fixture
        .snapshot
        .bids
        .iter()
        .chain(&fixture.snapshot.asks)
        .chain(
            fixture
                .events
                .iter()
                .flat_map(|event| event.bids.iter().chain(&event.asks)),
        )
    {
        normalize_decimal(price)?;
        normalize_decimal(quantity)?;
    }
    Ok(fixture)
}

fn project_fixture(fixture: &Fixture) -> Result<ProjectionOutcome, Box<dyn Error>> {
    Ok(project_updates(
        &fixture.snapshot,
        &fixture.events,
        1_000_000,
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frozen_fixtures_match_shared_production_core() -> Result<(), Box<dyn Error>> {
        for raw in [
            include_str!("../../fixtures/complete.json"),
            include_str!("../../fixtures/gap.json"),
        ] {
            let fixture = parse_fixture(raw)?;
            let actual = project_fixture(&fixture)?;
            assert_eq!(actual, fixture.expected);
            let result = run_bakeoff(raw, 3)?;
            assert_eq!(result.processed_event_count, actual.applied_event_count * 3);
        }
        Ok(())
    }

    #[test]
    fn decimal_normalization_is_exact() -> Result<(), Box<dyn Error>> {
        assert_eq!(normalize_decimal("100.000")?, "100");
        assert_eq!(normalize_decimal("0.7500")?, "0.75");
        assert!(normalize_decimal("1e-8").is_err());
        Ok(())
    }
}
