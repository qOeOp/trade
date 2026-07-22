use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::env;
use std::error::Error;
use std::fs;
use std::time::Instant;

const FIXTURE_SCHEMA: &str = "trade.l2-bakeoff-fixture.v1";
const RESULT_SCHEMA: &str = "trade.l2-bakeoff-result.v1";

type Level = [String; 2];

#[derive(Clone, Debug, Deserialize)]
struct Snapshot {
    last_update_id: u64,
    bids: Vec<Level>,
    asks: Vec<Level>,
}

#[derive(Clone, Debug, Deserialize)]
struct DepthEvent {
    event_time_ms: u64,
    transaction_time_ms: u64,
    local_receive_time_ms: u64,
    first_update_id: u64,
    final_update_id: u64,
    previous_final_update_id: u64,
    bids: Vec<Level>,
    asks: Vec<Level>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
struct Gap {
    event_index: usize,
    expected_previous_final_update_id: u64,
    actual_previous_final_update_id: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
struct Outcome {
    status: String,
    last_update_id: u64,
    applied_event_count: usize,
    book_hash: String,
    bids: Vec<Level>,
    asks: Vec<Level>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gap: Option<Gap>,
}

#[derive(Clone, Debug, Deserialize)]
struct Fixture {
    schema_version: String,
    fixture_id: String,
    stream_epoch: String,
    symbol: String,
    snapshot: Snapshot,
    events: Vec<DepthEvent>,
    expected: Outcome,
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
    outcome: Outcome,
}

#[derive(Serialize)]
struct CanonicalBook<'a> {
    asks: &'a [Level],
    bids: &'a [Level],
}

fn main() -> Result<(), Box<dyn Error>> {
    let arguments = parse_args(env::args().skip(1).collect())?;
    let raw = fs::read_to_string(&arguments.fixture)?;
    let result = run_bakeoff(&raw, arguments.iterations)?;
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}

struct Arguments {
    fixture: String,
    iterations: usize,
}

fn parse_args(values: Vec<String>) -> Result<Arguments, Box<dyn Error>> {
    let mut fixture = String::from("fixtures/complete.json");
    let mut iterations = 1_usize;
    let mut index = 0_usize;
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
        source_hash: hash_bytes(raw.as_bytes()),
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
    validate_levels(&fixture.snapshot.bids)?;
    validate_levels(&fixture.snapshot.asks)?;
    for event in &fixture.events {
        if event.transaction_time_ms > event.event_time_ms {
            return Err("transaction_time_ms must not exceed event_time_ms".into());
        }
        if event.local_receive_time_ms == 0 {
            return Err("local_receive_time_ms must be positive".into());
        }
        validate_levels(&event.bids)?;
        validate_levels(&event.asks)?;
    }
    Ok(fixture)
}

fn project_fixture(fixture: &Fixture) -> Result<Outcome, Box<dyn Error>> {
    let mut bids = HashMap::new();
    let mut asks = HashMap::new();
    apply_levels(&mut bids, &fixture.snapshot.bids)?;
    apply_levels(&mut asks, &fixture.snapshot.asks)?;

    let mut previous_final_update_id = fixture.snapshot.last_update_id;
    let mut applied_event_count = 0_usize;
    let mut bridged = false;
    let mut gap = None;

    for (event_index, event) in fixture.events.iter().enumerate() {
        if event.final_update_id < fixture.snapshot.last_update_id {
            continue;
        }
        if !bridged {
            if event.first_update_id > fixture.snapshot.last_update_id
                || event.final_update_id < fixture.snapshot.last_update_id
            {
                gap = Some(Gap {
                    event_index,
                    expected_previous_final_update_id: fixture.snapshot.last_update_id,
                    actual_previous_final_update_id: event.previous_final_update_id,
                });
                break;
            }
            bridged = true;
        } else if event.previous_final_update_id != previous_final_update_id {
            gap = Some(Gap {
                event_index,
                expected_previous_final_update_id: previous_final_update_id,
                actual_previous_final_update_id: event.previous_final_update_id,
            });
            break;
        }

        apply_levels(&mut bids, &event.bids)?;
        apply_levels(&mut asks, &event.asks)?;
        previous_final_update_id = event.final_update_id;
        applied_event_count += 1;
    }

    let sorted_bids = map_to_levels(bids, false);
    let sorted_asks = map_to_levels(asks, true);
    let canonical = serde_json::to_vec(&CanonicalBook {
        asks: &sorted_asks,
        bids: &sorted_bids,
    })?;
    Ok(Outcome {
        status: if gap.is_some() {
            String::from("incomplete")
        } else {
            String::from("complete")
        },
        last_update_id: previous_final_update_id,
        applied_event_count,
        book_hash: hash_bytes(&canonical),
        bids: sorted_bids,
        asks: sorted_asks,
        gap,
    })
}

fn validate_levels(levels: &[Level]) -> Result<(), Box<dyn Error>> {
    for level in levels {
        normalize_decimal(&level[0])?;
        normalize_decimal(&level[1])?;
    }
    Ok(())
}

fn apply_levels(
    book: &mut HashMap<String, String>,
    levels: &[Level],
) -> Result<(), Box<dyn Error>> {
    for level in levels {
        let price = normalize_decimal(&level[0])?;
        let quantity = normalize_decimal(&level[1])?;
        if quantity == "0" {
            book.remove(&price);
        } else {
            book.insert(price, quantity);
        }
    }
    Ok(())
}

fn map_to_levels(book: HashMap<String, String>, ascending: bool) -> Vec<Level> {
    let mut levels: Vec<Level> = book
        .into_iter()
        .map(|(price, quantity)| [price, quantity])
        .collect();
    levels.sort_by(|left, right| {
        let ordering = compare_decimals(&left[0], &right[0]);
        if ascending {
            ordering
        } else {
            ordering.reverse()
        }
    });
    levels
}

fn normalize_decimal(value: &str) -> Result<String, Box<dyn Error>> {
    let mut parts = value.split('.');
    let integer = parts.next().ok_or("decimal integer part is missing")?;
    let fraction = parts.next();
    if parts.next().is_some()
        || integer.is_empty()
        || !integer.bytes().all(|value| value.is_ascii_digit())
        || (integer.len() > 1 && integer.starts_with('0'))
        || fraction.is_some_and(|value| {
            value.is_empty() || !value.bytes().all(|character| character.is_ascii_digit())
        })
    {
        return Err(format!("invalid unsigned decimal: {value}").into());
    }
    let normalized_fraction = fraction.unwrap_or("").trim_end_matches('0');
    if normalized_fraction.is_empty() {
        Ok(integer.to_string())
    } else {
        Ok(format!("{integer}.{normalized_fraction}"))
    }
}

fn compare_decimals(left: &str, right: &str) -> Ordering {
    let (left_integer, left_fraction) = split_decimal(left);
    let (right_integer, right_fraction) = split_decimal(right);
    left_integer
        .len()
        .cmp(&right_integer.len())
        .then_with(|| left_integer.cmp(right_integer))
        .then_with(|| {
            let width = left_fraction.len().max(right_fraction.len());
            let mut padded_left = left_fraction.to_string();
            let mut padded_right = right_fraction.to_string();
            padded_left.extend(std::iter::repeat_n('0', width - left_fraction.len()));
            padded_right.extend(std::iter::repeat_n('0', width - right_fraction.len()));
            padded_left.cmp(&padded_right)
        })
}

fn split_decimal(value: &str) -> (&str, &str) {
    value.split_once('.').unwrap_or((value, ""))
}

fn hash_bytes(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frozen_fixtures_match() -> Result<(), Box<dyn Error>> {
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
