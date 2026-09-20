//! Per-condition readiness vocabulary for one frozen bounded feature program.
//!
//! A strategy that takes no action for a long stretch has two causes a replay must not confuse: a
//! condition that was evaluated and came out false, and a condition whose inputs had not yet
//! satisfied the availability rule they were frozen under. This vocabulary carries the second one,
//! and it carries why: the rule and the window that imposed it, named by the node that imposed it.
//!
//! The facts here are derivable from the frozen program alone. Nothing in this module observes a
//! run, and nothing in it decides whether a condition should have been ready.
//!
//! A producer filling these facts from a run must not read a condition's colour out of its Boolean
//! state cell. The guest writes that cell as `if produced.ready { produced } else { prior }`, so a
//! tick on which the condition was not evaluable stores the previous tick's colour rather than
//! anything meaning "not evaluated". A reader would see a lit or dark light for a tick that never
//! reached the decision table, and nothing would fail: the write succeeds, and the program's own
//! warming bit lives in the output frame instead.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The rule that fixes when a condition first becomes evaluable.
///
/// Each variant names the published availability rule of the node that imposed it, together with
/// the parameter that rule reads. A rule with no parameter carries none rather than a zero, so a
/// reader never has to know which zeros are meaningful.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ConditionWarmupRuleV1 {
    /// Nothing in the condition's closure warms: it is evaluable from the first sample.
    ReadyFromFirstSample,
    /// A windowed primitive produces nothing until its window holds this many samples.
    FullWindow { window: u32 },
    /// A lag primitive produces nothing until it holds its offset plus one sample.
    LagOffsetPlusOne { offset: u32 },
    /// A period primitive produces nothing until it holds its period plus one sample.
    PeriodPlusOne { period: u32 },
    /// A previous-close primitive produces nothing until a second sample arrives.
    PreviousClose,
}

impl ConditionWarmupRuleV1 {
    /// The earliest tick this rule alone admits, counting the first sample as tick one.
    #[must_use]
    pub const fn earliest_tick(self) -> u32 {
        match self {
            Self::ReadyFromFirstSample => 1,
            Self::FullWindow { window } => window,
            Self::LagOffsetPlusOne { offset } => offset.saturating_add(1),
            Self::PeriodPlusOne { period } => period.saturating_add(1),
            Self::PreviousClose => 2,
        }
    }
}

/// One decision-branch predicate and the tick at which it first becomes evaluable.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ConditionReadinessV1 {
    /// The node whose output the decision table reads for this branch.
    pub condition_node_id: String,
    /// The branch's frozen priority, which orders evaluation.
    pub branch_priority: u16,
    /// The first tick at which every input in this condition's closure satisfies its rule.
    pub expected_ready_tick: u32,
    /// The rule that fixes that tick.
    pub binding_rule: ConditionWarmupRuleV1,
    /// The node in the closure whose rule fixed it, which is this condition itself when nothing
    /// upstream warms.
    pub binding_node_id: String,
}

/// Every decision-branch predicate of one frozen program, with the tick each first becomes
/// evaluable.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ConditionReadinessCensusV1 {
    pub schema_version: u16,
    /// One entry per decision branch, in the frozen branch order.
    pub conditions: Vec<ConditionReadinessV1>,
}

/// The first rule a census does not satisfy.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ConditionReadinessFaultV1 {
    #[error("condition readiness census schema version is not 1")]
    SchemaVersion,
    #[error("condition readiness census carries no condition")]
    Empty,
    #[error("condition readiness census names {node_id} more than once")]
    DuplicateCondition { node_id: String },
    #[error("condition readiness census repeats branch priority {priority}")]
    DuplicatePriority { priority: u16 },
    #[error("condition {node_id} carries an empty node identity")]
    EmptyIdentity { node_id: String },
    #[error("condition {node_id} is ready before its first sample")]
    TickBeforeFirstSample { node_id: String },
    #[error(
        "condition {node_id} is ready at tick {tick}, earlier than its binding rule alone admits"
    )]
    TickEarlierThanRule { node_id: String, tick: u32 },
    #[error("condition {node_id} names no warming rule but is not ready at its first sample")]
    WarmingTickWithoutRule { node_id: String },
}

impl ConditionReadinessCensusV1 {
    /// Proves every rule this vocabulary states, or names the first one the census breaks.
    ///
    /// The check that carries the weight is the last pair: a census may not claim a condition is
    /// ready earlier than the rule it names admits, and may not claim a warming condition while
    /// naming no rule. Either would let a reader conclude a window had filled when it had not.
    ///
    /// # Errors
    ///
    /// Returns the first rule the census does not satisfy.
    pub fn validate(&self) -> Result<(), ConditionReadinessFaultV1> {
        if self.schema_version != 1 {
            return Err(ConditionReadinessFaultV1::SchemaVersion);
        }

        if self.conditions.is_empty() {
            return Err(ConditionReadinessFaultV1::Empty);
        }

        let mut seen_nodes = std::collections::BTreeSet::new();
        let mut seen_priorities = std::collections::BTreeSet::new();

        for condition in &self.conditions {
            if condition.condition_node_id.is_empty() || condition.binding_node_id.is_empty() {
                return Err(ConditionReadinessFaultV1::EmptyIdentity {
                    node_id: condition.condition_node_id.clone(),
                });
            }

            if !seen_nodes.insert(condition.condition_node_id.as_str()) {
                return Err(ConditionReadinessFaultV1::DuplicateCondition {
                    node_id: condition.condition_node_id.clone(),
                });
            }

            if !seen_priorities.insert(condition.branch_priority) {
                return Err(ConditionReadinessFaultV1::DuplicatePriority {
                    priority: condition.branch_priority,
                });
            }

            if condition.expected_ready_tick == 0 {
                return Err(ConditionReadinessFaultV1::TickBeforeFirstSample {
                    node_id: condition.condition_node_id.clone(),
                });
            }

            if condition.expected_ready_tick < condition.binding_rule.earliest_tick() {
                return Err(ConditionReadinessFaultV1::TickEarlierThanRule {
                    node_id: condition.condition_node_id.clone(),
                    tick: condition.expected_ready_tick,
                });
            }

            if condition.binding_rule == ConditionWarmupRuleV1::ReadyFromFirstSample
                && condition.expected_ready_tick != 1
            {
                return Err(ConditionReadinessFaultV1::WarmingTickWithoutRule {
                    node_id: condition.condition_node_id.clone(),
                });
            }
        }
        Ok(())
    }
}
