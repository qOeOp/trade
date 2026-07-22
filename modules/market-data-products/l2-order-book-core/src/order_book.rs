use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::HashMap;
use thiserror::Error;

pub type Level = [String; 2];

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Snapshot {
    #[serde(rename = "lastUpdateId", alias = "last_update_id")]
    pub last_update_id: u64,
    pub bids: Vec<Level>,
    pub asks: Vec<Level>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DepthUpdate {
    pub event_time_ms: u64,
    pub transaction_time_ms: u64,
    pub local_receive_time_ms: u64,
    pub first_update_id: u64,
    pub final_update_id: u64,
    pub previous_final_update_id: u64,
    pub bids: Vec<Level>,
    pub asks: Vec<Level>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct BookGap {
    pub event_index: usize,
    pub expected_previous_final_update_id: u64,
    pub actual_previous_final_update_id: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct BookSnapshot {
    pub last_update_id: u64,
    pub book_hash: String,
    pub bids: Vec<Level>,
    pub asks: Vec<Level>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct ProjectionOutcome {
    pub status: String,
    pub last_update_id: u64,
    pub applied_event_count: usize,
    pub book_hash: String,
    pub bids: Vec<Level>,
    pub asks: Vec<Level>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gap: Option<BookGap>,
}

#[derive(Debug, Error)]
pub enum OrderBookError {
    #[error("invalid unsigned decimal: {0}")]
    InvalidDecimal(String),
    #[error("transaction_time_ms must not exceed event_time_ms")]
    InvalidEventTime,
    #[error("local_receive_time_ms must be positive")]
    MissingReceiveTime,
    #[error("book contains {actual} levels, limit is {limit}")]
    CapacityExceeded { actual: usize, limit: usize },
    #[error("failed to encode canonical book: {0}")]
    CanonicalEncoding(#[from] serde_json::Error),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SequenceDecision {
    Ignore,
    Accept,
    BridgeMiss {
        snapshot_last_update_id: u64,
        first_update_id: u64,
    },
    Gap {
        expected_previous_final_update_id: u64,
        actual_previous_final_update_id: u64,
    },
}

#[derive(Clone, Debug)]
pub struct SequenceTracker {
    snapshot_last_update_id: u64,
    bridged: bool,
    last_update_id: u64,
}

impl SequenceTracker {
    pub fn new(snapshot_last_update_id: u64) -> Self {
        Self {
            snapshot_last_update_id,
            bridged: false,
            last_update_id: snapshot_last_update_id,
        }
    }

    pub fn observe(&mut self, event: &DepthUpdate) -> SequenceDecision {
        if !self.bridged {
            if event.final_update_id < self.snapshot_last_update_id {
                return SequenceDecision::Ignore;
            }
            if event.first_update_id > self.snapshot_last_update_id {
                return SequenceDecision::BridgeMiss {
                    snapshot_last_update_id: self.snapshot_last_update_id,
                    first_update_id: event.first_update_id,
                };
            }
            self.bridged = true;
            self.last_update_id = event.final_update_id;
            return SequenceDecision::Accept;
        }
        if event.previous_final_update_id != self.last_update_id {
            return SequenceDecision::Gap {
                expected_previous_final_update_id: self.last_update_id,
                actual_previous_final_update_id: event.previous_final_update_id,
            };
        }
        self.last_update_id = event.final_update_id;
        SequenceDecision::Accept
    }

    pub fn bridged(&self) -> bool {
        self.bridged
    }

    pub fn last_update_id(&self) -> u64 {
        self.last_update_id
    }
}

#[derive(Clone, Debug)]
pub struct OrderBook {
    bids: HashMap<String, String>,
    asks: HashMap<String, String>,
    last_update_id: u64,
    max_levels: usize,
}

impl OrderBook {
    pub fn from_snapshot(snapshot: &Snapshot, max_levels: usize) -> Result<Self, OrderBookError> {
        let mut value = Self {
            bids: HashMap::new(),
            asks: HashMap::new(),
            last_update_id: snapshot.last_update_id,
            max_levels,
        };
        apply_levels(&mut value.bids, &snapshot.bids)?;
        apply_levels(&mut value.asks, &snapshot.asks)?;
        value.enforce_capacity()?;
        Ok(value)
    }

    pub fn apply(&mut self, event: &DepthUpdate) -> Result<(), OrderBookError> {
        validate_update(event)?;
        apply_levels(&mut self.bids, &event.bids)?;
        apply_levels(&mut self.asks, &event.asks)?;
        self.enforce_capacity()?;
        self.last_update_id = event.final_update_id;
        Ok(())
    }

    pub fn snapshot(&self, depth: Option<usize>) -> Result<BookSnapshot, OrderBookError> {
        let mut bids = sorted_levels(&self.bids, false);
        let mut asks = sorted_levels(&self.asks, true);
        if let Some(limit) = depth {
            bids.truncate(limit);
            asks.truncate(limit);
        }
        let canonical = serde_json::to_vec(&CanonicalBook {
            asks: &asks,
            bids: &bids,
        })?;
        Ok(BookSnapshot {
            last_update_id: self.last_update_id,
            book_hash: format!("{:x}", Sha256::digest(canonical)),
            bids,
            asks,
        })
    }

    pub fn level_count(&self) -> usize {
        self.bids.len() + self.asks.len()
    }

    fn enforce_capacity(&self) -> Result<(), OrderBookError> {
        let actual = self.level_count();
        if actual > self.max_levels {
            return Err(OrderBookError::CapacityExceeded {
                actual,
                limit: self.max_levels,
            });
        }
        Ok(())
    }
}

pub fn project_updates(
    snapshot: &Snapshot,
    updates: &[DepthUpdate],
    max_levels: usize,
) -> Result<ProjectionOutcome, OrderBookError> {
    let mut book = OrderBook::from_snapshot(snapshot, max_levels)?;
    let mut tracker = SequenceTracker::new(snapshot.last_update_id);
    let mut applied_event_count = 0;
    let mut gap = None;

    for (event_index, event) in updates.iter().enumerate() {
        validate_update(event)?;
        match tracker.observe(event) {
            SequenceDecision::Ignore => {}
            SequenceDecision::Accept => {
                book.apply(event)?;
                applied_event_count += 1;
            }
            SequenceDecision::BridgeMiss {
                snapshot_last_update_id,
                first_update_id: _,
            } => {
                gap = Some(BookGap {
                    event_index,
                    expected_previous_final_update_id: snapshot_last_update_id,
                    actual_previous_final_update_id: event.previous_final_update_id,
                });
                break;
            }
            SequenceDecision::Gap {
                expected_previous_final_update_id,
                actual_previous_final_update_id,
            } => {
                gap = Some(BookGap {
                    event_index,
                    expected_previous_final_update_id,
                    actual_previous_final_update_id,
                });
                break;
            }
        }
    }

    let view = book.snapshot(None)?;
    Ok(ProjectionOutcome {
        status: if gap.is_some() {
            "incomplete"
        } else {
            "complete"
        }
        .to_string(),
        last_update_id: view.last_update_id,
        applied_event_count,
        book_hash: view.book_hash,
        bids: view.bids,
        asks: view.asks,
        gap,
    })
}

pub fn normalize_decimal(value: &str) -> Result<String, OrderBookError> {
    let mut parts = value.split('.');
    let integer = parts.next().unwrap_or_default();
    let fraction = parts.next();
    if parts.next().is_some()
        || integer.is_empty()
        || !integer.bytes().all(|character| character.is_ascii_digit())
        || (integer.len() > 1 && integer.starts_with('0'))
        || fraction.is_some_and(|value| {
            value.is_empty() || !value.bytes().all(|character| character.is_ascii_digit())
        })
    {
        return Err(OrderBookError::InvalidDecimal(value.to_string()));
    }
    let normalized_fraction = fraction.unwrap_or_default().trim_end_matches('0');
    if normalized_fraction.is_empty() {
        Ok(integer.to_string())
    } else {
        Ok(format!("{integer}.{normalized_fraction}"))
    }
}

fn validate_update(event: &DepthUpdate) -> Result<(), OrderBookError> {
    if event.transaction_time_ms > event.event_time_ms {
        return Err(OrderBookError::InvalidEventTime);
    }
    if event.local_receive_time_ms == 0 {
        return Err(OrderBookError::MissingReceiveTime);
    }
    Ok(())
}

fn apply_levels(
    side: &mut HashMap<String, String>,
    levels: &[Level],
) -> Result<(), OrderBookError> {
    for [raw_price, raw_quantity] in levels {
        let price = normalize_decimal(raw_price)?;
        let quantity = normalize_decimal(raw_quantity)?;
        if quantity == "0" {
            side.remove(&price);
        } else {
            side.insert(price, quantity);
        }
    }
    Ok(())
}

fn sorted_levels(side: &HashMap<String, String>, ascending: bool) -> Vec<Level> {
    let mut levels: Vec<Level> = side
        .iter()
        .map(|(price, quantity)| [price.clone(), quantity.clone()])
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

fn compare_decimals(left: &str, right: &str) -> Ordering {
    let (left_integer, left_fraction) = decimal_parts(left);
    let (right_integer, right_fraction) = decimal_parts(right);
    left_integer
        .len()
        .cmp(&right_integer.len())
        .then_with(|| left_integer.cmp(right_integer))
        .then_with(|| {
            let width = left_fraction.len().max(right_fraction.len());
            let mut left_padded = left_fraction.to_string();
            let mut right_padded = right_fraction.to_string();
            left_padded.extend(std::iter::repeat_n('0', width - left_fraction.len()));
            right_padded.extend(std::iter::repeat_n('0', width - right_fraction.len()));
            left_padded.cmp(&right_padded)
        })
}

fn decimal_parts(value: &str) -> (&str, &str) {
    value.split_once('.').unwrap_or((value, ""))
}

#[derive(Serialize)]
struct CanonicalBook<'a> {
    asks: &'a [Level],
    bids: &'a [Level],
}

#[cfg(test)]
mod tests {
    use super::*;

    fn update(first: u64, final_id: u64, previous: u64) -> DepthUpdate {
        DepthUpdate {
            event_time_ms: 2,
            transaction_time_ms: 1,
            local_receive_time_ms: 3,
            first_update_id: first,
            final_update_id: final_id,
            previous_final_update_id: previous,
            bids: vec![["100.00".to_string(), "2.50".to_string()]],
            asks: Vec::new(),
        }
    }

    #[test]
    fn bridge_and_gap_are_explicit() {
        let mut tracker = SequenceTracker::new(100);
        assert_eq!(
            tracker.observe(&update(90, 99, 89)),
            SequenceDecision::Ignore
        );
        assert_eq!(
            tracker.observe(&update(99, 101, 98)),
            SequenceDecision::Accept
        );
        assert!(matches!(
            tracker.observe(&update(102, 103, 999)),
            SequenceDecision::Gap { .. }
        ));
    }

    #[test]
    fn book_is_decimal_normalized_and_sorted() {
        let snapshot = Snapshot {
            last_update_id: 100,
            bids: vec![
                ["9.0".to_string(), "1.00".to_string()],
                ["10.00".to_string(), "2".to_string()],
            ],
            asks: vec![["11.000".to_string(), "3.0".to_string()]],
        };
        let book = OrderBook::from_snapshot(&snapshot, 10).expect("snapshot");
        let view = book.snapshot(None).expect("view");
        assert_eq!(view.bids[0], ["10".to_string(), "2".to_string()]);
        assert_eq!(view.bids[1], ["9".to_string(), "1".to_string()]);
        assert_eq!(view.asks[0], ["11".to_string(), "3".to_string()]);
    }

    #[test]
    fn capacity_fails_closed() {
        let snapshot = Snapshot {
            last_update_id: 1,
            bids: vec![["1".to_string(), "1".to_string()]],
            asks: vec![["2".to_string(), "1".to_string()]],
        };
        assert!(matches!(
            OrderBook::from_snapshot(&snapshot, 1),
            Err(OrderBookError::CapacityExceeded { .. })
        ));
    }
}
