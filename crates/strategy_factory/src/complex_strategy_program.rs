use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::complex_strategy_compiler::{
    BoundComplexStrategyFrameV1, ComplexStrategyCompileInputV1,
};

const PROGRAM_IDENTITY_DOMAIN_V1: &[u8] = b"vibe.strategy-factory.complex-strategy-program.v1\0";
const TRACE_DOMAIN_V1: &[u8] = b"vibe.strategy-factory.complex-strategy-trace.v1\0";
const FIXED_SCALE: u8 = 18;
const MAX_ORACLE_FRAMES: usize = 4_096;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ProgramInputV1 {
    pub(crate) id: String,
    pub(crate) instrument_role: String,
    pub(crate) timeframe: String,
    pub(crate) field: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ProgramJoinV1 {
    pub(crate) id: String,
    pub(crate) left_input: usize,
    pub(crate) right_input: usize,
    pub(crate) alignment: ProgramJoinAlignmentV1,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum ProgramJoinAlignmentV1 {
    ExactDecisionCut,
    LatestAtOrBeforeDecisionCut,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ProgramScaledIntegerV1 {
    pub(crate) coefficient: i64,
    pub(crate) scale: u8,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ProgramParameterV1 {
    pub(crate) id: String,
    pub(crate) value: ProgramScaledIntegerV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ProgramFeatureV1 {
    pub(crate) id: String,
    pub(crate) operation: ProgramFeatureOperationV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum ProgramFeatureOperationV1 {
    Input {
        input: usize,
    },
    JoinLeft {
        join: usize,
    },
    JoinRight {
        join: usize,
    },
    Parameter {
        parameter: usize,
    },
    Lag {
        operand: usize,
        periods: u16,
    },
    RollingMean {
        operand: usize,
        window: u16,
    },
    RollingStdDev {
        operand: usize,
        window: u16,
    },
    Add {
        left: usize,
        right: usize,
    },
    Subtract {
        left: usize,
        right: usize,
    },
    Multiply {
        left: usize,
        right: usize,
    },
    Divide {
        numerator: usize,
        denominator: usize,
        zero_denominator: ProgramZeroDenominatorV1,
    },
    Negate {
        operand: usize,
    },
    Absolute {
        operand: usize,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum ProgramZeroDenominatorV1 {
    RejectEvaluation,
    ReturnZero,
    UseValue { value: ProgramScaledIntegerV1 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ProgramStateV1 {
    pub(crate) id: String,
    pub(crate) initial: ProgramScaledIntegerV1,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum ProgramComparisonV1 {
    LessThan,
    LessThanOrEqual,
    Equal,
    NotEqual,
    GreaterThanOrEqual,
    GreaterThan,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum ProgramValueReferenceV1 {
    Feature { feature: usize },
    Parameter { parameter: usize },
    State { state_cell: usize },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ProgramGuardV1 {
    pub(crate) left: ProgramValueReferenceV1,
    pub(crate) comparison: ProgramComparisonV1,
    pub(crate) right: ProgramValueReferenceV1,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ProgramActionV1 {
    pub(crate) state_cell: usize,
    pub(crate) value: ProgramValueReferenceV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ProgramTransitionV1 {
    pub(crate) id: String,
    pub(crate) guards: Vec<ProgramGuardV1>,
    pub(crate) actions: Vec<ProgramActionV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ComplexStrategyProgramDefinitionV1 {
    pub(crate) ir_semantic_digest: String,
    pub(crate) binding_identity: String,
    pub(crate) inputs: Vec<ProgramInputV1>,
    pub(crate) joins: Vec<ProgramJoinV1>,
    pub(crate) parameters: Vec<ProgramParameterV1>,
    pub(crate) features: Vec<ProgramFeatureV1>,
    pub(crate) states: Vec<ProgramStateV1>,
    pub(crate) transitions: Vec<ProgramTransitionV1>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ComplexStrategyProgramV1 {
    definition: ComplexStrategyProgramDefinitionV1,
    canonical_bytes: Box<[u8]>,
    identity: String,
}

impl ComplexStrategyProgramV1 {
    pub(crate) fn compile(
        definition: ComplexStrategyProgramDefinitionV1,
    ) -> Result<Self, ComplexStrategyProgramError> {
        validate_indexes(&definition)?;
        let mut canonical_bytes = serde_json::to_vec(&definition)?;
        canonical_bytes.push(b'\n');
        let identity = identity(PROGRAM_IDENTITY_DOMAIN_V1, &canonical_bytes);
        Ok(Self {
            definition,
            canonical_bytes: canonical_bytes.into(),
            identity,
        })
    }

    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub(crate) fn identity(&self) -> &str {
        &self.identity
    }

    pub(crate) fn input_count(&self) -> usize {
        self.definition.inputs.len()
    }

    pub(crate) fn parameter_value(&self, id: &str) -> Option<ProgramScaledIntegerV1> {
        self.definition
            .parameters
            .iter()
            .find(|parameter| parameter.id == id)
            .map(|parameter| parameter.value)
    }

    pub(crate) fn has_transition(&self, id: &str) -> bool {
        self.definition
            .transitions
            .iter()
            .any(|transition| transition.id == id)
    }

    #[cfg(test)]
    pub(crate) fn initial_states(&self) -> &[ProgramStateV1] {
        &self.definition.states
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ProgramInputSampleV1 {
    pub(crate) observed_at: u64,
    pub(crate) available_at: u64,
    pub(crate) value: ProgramScaledIntegerV1,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProgramFrameV1 {
    pub(crate) frame_identity: [u8; 32],
    pub(crate) decision_time: u64,
    pub(crate) inputs: Vec<ProgramInputSampleV1>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProgramTraceV1 {
    canonical_bytes: Box<[u8]>,
}

impl ProgramTraceV1 {
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum ComplexStrategyProgramError {
    #[error("complex strategy program canonicalization failed: {0}")]
    Canonicalization(String),
    #[error("complex strategy program contains an invalid compiled index")]
    InvalidIndex,
    #[error("complex strategy program frame is malformed")]
    MalformedFrame,
    #[error("complex strategy program input ordering or market semantics changed")]
    MarketSemanticsMismatch,
    #[error("complex strategy program arithmetic overflowed")]
    ArithmeticOverflow,
    #[error("complex strategy program action value is unavailable")]
    UnavailableActionValue,
    #[error("complex strategy program frame contains an unsupported fixed-point scale")]
    UnsupportedScale,
    #[error("complex strategy program frame contains conflicting state assignments")]
    ConflictingStateAssignment,
    #[error("complex strategy program frame was sealed for a different compile plan or binding")]
    FrameBindingMismatch,
    #[error("complex strategy program frame bound exceeded")]
    FrameBoundExceeded,
}

pub(crate) fn execute_bound_program(
    compile_input: &ComplexStrategyCompileInputV1,
    frames: &[BoundComplexStrategyFrameV1],
) -> Result<ProgramTraceV1, ComplexStrategyProgramError> {
    if frames
        .iter()
        .any(|frame| !frame.matches_compile_input(compile_input))
    {
        return Err(ComplexStrategyProgramError::FrameBindingMismatch);
    }
    let frames = frames
        .iter()
        .map(BoundComplexStrategyFrameV1::program_frame)
        .cloned()
        .collect::<Vec<_>>();
    ProgramOracleV1::new(
        compile_input.program(),
        compile_input.compile_plan_identity(),
    )?
    .execute(&frames)
}

impl From<serde_json::Error> for ComplexStrategyProgramError {
    fn from(error: serde_json::Error) -> Self {
        Self::Canonicalization(error.to_string())
    }
}

struct ProgramOracleV1<'a> {
    program: &'a ComplexStrategyProgramV1,
    compile_plan_identity: [u8; 32],
    state_values: Vec<i128>,
    history: Vec<Vec<i128>>,
    last_decision_time: Option<u64>,
    last_input_times: Vec<(u64, u64)>,
}

impl<'a> ProgramOracleV1<'a> {
    fn new(
        program: &'a ComplexStrategyProgramV1,
        compile_plan_identity: &[u8; 32],
    ) -> Result<Self, ComplexStrategyProgramError> {
        let state_values = program
            .definition
            .states
            .iter()
            .map(|state| fixed(state.initial))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            program,
            compile_plan_identity: *compile_plan_identity,
            state_values,
            history: vec![Vec::new(); program.definition.features.len()],
            last_decision_time: None,
            last_input_times: vec![(0, 0); program.definition.inputs.len()],
        })
    }

    fn execute(
        mut self,
        frames: &[ProgramFrameV1],
    ) -> Result<ProgramTraceV1, ComplexStrategyProgramError> {
        if frames.len() > MAX_ORACLE_FRAMES {
            return Err(ComplexStrategyProgramError::FrameBoundExceeded);
        }
        let mut trace = Vec::new();
        trace.extend_from_slice(TRACE_DOMAIN_V1);
        trace.extend_from_slice(&self.compile_plan_identity);
        push_len(&mut trace, frames.len())?;

        for frame in frames {
            self.validate_frame(frame)?;
            let features = self.evaluate_features(frame)?;
            let before = self.state_values.clone();
            let mut fired = Vec::new();
            let mut pending_state = vec![None; self.state_values.len()];

            for transition in &self.program.definition.transitions {
                if transition
                    .guards
                    .iter()
                    .all(|guard| self.evaluate_guard(*guard, &features).unwrap_or(false))
                {
                    for action in &transition.actions {
                        let value = self
                            .resolve(action.value, &features)
                            .ok_or(ComplexStrategyProgramError::UnavailableActionValue)?;
                        if pending_state[action.state_cell].replace(value).is_some() {
                            return Err(ComplexStrategyProgramError::ConflictingStateAssignment);
                        }
                    }
                    fired.push(transition.id.as_str());
                }
            }

            for (state, pending) in self.state_values.iter_mut().zip(pending_state) {
                if let Some(value) = pending {
                    *state = value;
                }
            }
            self.append_trace_frame(
                &mut trace,
                &frame.frame_identity,
                frame.decision_time,
                &before,
                &fired,
            )?;

            for (slot, value) in features.into_iter().enumerate() {
                if let Some(value) = value {
                    self.history[slot].push(value);
                }
            }
            self.last_decision_time = Some(frame.decision_time);
        }
        Ok(ProgramTraceV1 {
            canonical_bytes: trace.into(),
        })
    }

    fn validate_frame(
        &mut self,
        frame: &ProgramFrameV1,
    ) -> Result<(), ComplexStrategyProgramError> {
        if frame.inputs.len() != self.program.definition.inputs.len()
            || frame.decision_time == 0
            || self
                .last_decision_time
                .is_some_and(|last| frame.decision_time <= last)
        {
            return Err(ComplexStrategyProgramError::MalformedFrame);
        }

        for (slot, sample) in frame.inputs.iter().enumerate() {
            if sample.observed_at == 0
                || sample.observed_at > sample.available_at
                || sample.available_at > frame.decision_time
            {
                return Err(ComplexStrategyProgramError::MalformedFrame);
            }
            let (last_observed, last_available) = self.last_input_times[slot];
            if sample.observed_at <= last_observed || sample.available_at < last_available {
                return Err(ComplexStrategyProgramError::MarketSemanticsMismatch);
            }
            fixed(sample.value)?;
        }

        for join in &self.program.definition.joins {
            let left = frame.inputs[join.left_input];
            let right = frame.inputs[join.right_input];
            if matches!(join.alignment, ProgramJoinAlignmentV1::ExactDecisionCut)
                && (left.observed_at != frame.decision_time
                    || right.observed_at != frame.decision_time)
            {
                return Err(ComplexStrategyProgramError::MarketSemanticsMismatch);
            }
        }

        for (slot, sample) in frame.inputs.iter().enumerate() {
            self.last_input_times[slot] = (sample.observed_at, sample.available_at);
        }
        Ok(())
    }

    fn evaluate_features(
        &self,
        frame: &ProgramFrameV1,
    ) -> Result<Vec<Option<i128>>, ComplexStrategyProgramError> {
        let mut values = vec![None; self.program.definition.features.len()];
        for (slot, feature) in self.program.definition.features.iter().enumerate() {
            let value = match feature.operation {
                ProgramFeatureOperationV1::Input { input } => {
                    Some(fixed(frame.inputs[input].value)?)
                }
                ProgramFeatureOperationV1::JoinLeft { join } => Some(fixed(
                    frame.inputs[self.program.definition.joins[join].left_input].value,
                )?),
                ProgramFeatureOperationV1::JoinRight { join } => Some(fixed(
                    frame.inputs[self.program.definition.joins[join].right_input].value,
                )?),
                ProgramFeatureOperationV1::Parameter { parameter } => {
                    Some(fixed(self.program.definition.parameters[parameter].value)?)
                }
                ProgramFeatureOperationV1::Lag { operand, periods } => self.history[operand]
                    .len()
                    .checked_sub(usize::from(periods))
                    .map(|index| self.history[operand][index]),
                ProgramFeatureOperationV1::RollingMean { operand, window } => {
                    match rolling_values(&self.history[operand], values[operand], window) {
                        Some(items) => checked_mean(&items)?,
                        None => None,
                    }
                }
                ProgramFeatureOperationV1::RollingStdDev { operand, window } => {
                    match rolling_values(&self.history[operand], values[operand], window) {
                        Some(items) => checked_std_dev(&items)?,
                        None => None,
                    }
                }
                ProgramFeatureOperationV1::Add { left, right } => {
                    match binary(&values, left, right) {
                        Some((left, right)) => Some(
                            left.checked_add(right)
                                .ok_or(ComplexStrategyProgramError::ArithmeticOverflow)?,
                        ),
                        None => None,
                    }
                }
                ProgramFeatureOperationV1::Subtract { left, right } => {
                    match binary(&values, left, right) {
                        Some((left, right)) => Some(
                            left.checked_sub(right)
                                .ok_or(ComplexStrategyProgramError::ArithmeticOverflow)?,
                        ),
                        None => None,
                    }
                }
                ProgramFeatureOperationV1::Multiply { left, right } => {
                    match binary(&values, left, right) {
                        Some((left, right)) => Some(
                            left.checked_mul(right)
                                .and_then(|value| value.checked_div(fixed_factor()))
                                .ok_or(ComplexStrategyProgramError::ArithmeticOverflow)?,
                        ),
                        None => None,
                    }
                }
                ProgramFeatureOperationV1::Divide {
                    numerator,
                    denominator,
                    zero_denominator,
                } => match binary(&values, numerator, denominator) {
                    Some((_, 0)) => match zero_denominator {
                        ProgramZeroDenominatorV1::RejectEvaluation => None,
                        ProgramZeroDenominatorV1::ReturnZero => Some(0),
                        ProgramZeroDenominatorV1::UseValue { value } => Some(fixed(value)?),
                    },
                    Some((numerator, denominator)) => Some(
                        numerator
                            .checked_mul(fixed_factor())
                            .and_then(|value| value.checked_div(denominator))
                            .ok_or(ComplexStrategyProgramError::ArithmeticOverflow)?,
                    ),
                    None => None,
                },
                ProgramFeatureOperationV1::Negate { operand } => match values[operand] {
                    Some(value) => Some(
                        value
                            .checked_neg()
                            .ok_or(ComplexStrategyProgramError::ArithmeticOverflow)?,
                    ),
                    None => None,
                },
                ProgramFeatureOperationV1::Absolute { operand } => match values[operand] {
                    Some(value) => Some(
                        value
                            .checked_abs()
                            .ok_or(ComplexStrategyProgramError::ArithmeticOverflow)?,
                    ),
                    None => None,
                },
            };
            values[slot] = value;
        }
        Ok(values)
    }

    fn evaluate_guard(&self, guard: ProgramGuardV1, features: &[Option<i128>]) -> Option<bool> {
        let left = self.resolve(guard.left, features)?;
        let right = self.resolve(guard.right, features)?;
        Some(match guard.comparison {
            ProgramComparisonV1::LessThan => left < right,
            ProgramComparisonV1::LessThanOrEqual => left <= right,
            ProgramComparisonV1::Equal => left == right,
            ProgramComparisonV1::NotEqual => left != right,
            ProgramComparisonV1::GreaterThanOrEqual => left >= right,
            ProgramComparisonV1::GreaterThan => left > right,
        })
    }

    fn resolve(
        &self,
        reference: ProgramValueReferenceV1,
        features: &[Option<i128>],
    ) -> Option<i128> {
        match reference {
            ProgramValueReferenceV1::Feature { feature } => features[feature],
            ProgramValueReferenceV1::Parameter { parameter } => {
                fixed(self.program.definition.parameters[parameter].value).ok()
            }
            ProgramValueReferenceV1::State { state_cell } => Some(self.state_values[state_cell]),
        }
    }

    fn append_trace_frame(
        &self,
        trace: &mut Vec<u8>,
        frame_identity: &[u8; 32],
        decision_time: u64,
        before: &[i128],
        fired: &[&str],
    ) -> Result<(), ComplexStrategyProgramError> {
        trace.extend_from_slice(frame_identity);
        trace.extend_from_slice(&decision_time.to_le_bytes());
        push_len(trace, fired.len())?;
        for id in fired {
            push_len(trace, id.len())?;
            trace.extend_from_slice(id.as_bytes());
        }
        push_len(trace, self.state_values.len())?;
        for (old, new) in before.iter().zip(&self.state_values) {
            trace.extend_from_slice(&old.to_le_bytes());
            trace.extend_from_slice(&new.to_le_bytes());
        }
        Ok(())
    }
}

fn validate_indexes(
    definition: &ComplexStrategyProgramDefinitionV1,
) -> Result<(), ComplexStrategyProgramError> {
    let inputs = definition.inputs.len();
    let joins = definition.joins.len();
    let parameters = definition.parameters.len();
    let features = definition.features.len();
    let states = definition.states.len();
    for join in &definition.joins {
        if join.left_input >= inputs || join.right_input >= inputs {
            return Err(ComplexStrategyProgramError::InvalidIndex);
        }
    }

    for (slot, feature) in definition.features.iter().enumerate() {
        let valid = match feature.operation {
            ProgramFeatureOperationV1::Input { input } => input < inputs,
            ProgramFeatureOperationV1::JoinLeft { join }
            | ProgramFeatureOperationV1::JoinRight { join } => join < joins,
            ProgramFeatureOperationV1::Parameter { parameter } => parameter < parameters,
            ProgramFeatureOperationV1::Lag { operand, .. }
            | ProgramFeatureOperationV1::RollingMean { operand, .. }
            | ProgramFeatureOperationV1::RollingStdDev { operand, .. }
            | ProgramFeatureOperationV1::Negate { operand }
            | ProgramFeatureOperationV1::Absolute { operand } => operand < slot,
            ProgramFeatureOperationV1::Add { left, right }
            | ProgramFeatureOperationV1::Subtract { left, right }
            | ProgramFeatureOperationV1::Multiply { left, right } => left < slot && right < slot,
            ProgramFeatureOperationV1::Divide {
                numerator,
                denominator,
                ..
            } => numerator < slot && denominator < slot,
        };

        if !valid {
            return Err(ComplexStrategyProgramError::InvalidIndex);
        }
    }

    for transition in &definition.transitions {
        for guard in &transition.guards {
            if !valid_reference(guard.left, features, parameters, states)
                || !valid_reference(guard.right, features, parameters, states)
            {
                return Err(ComplexStrategyProgramError::InvalidIndex);
            }
        }

        for action in &transition.actions {
            if action.state_cell >= states
                || !valid_reference(action.value, features, parameters, states)
            {
                return Err(ComplexStrategyProgramError::InvalidIndex);
            }
        }
    }
    Ok(())
}

fn valid_reference(
    reference: ProgramValueReferenceV1,
    features: usize,
    parameters: usize,
    states: usize,
) -> bool {
    match reference {
        ProgramValueReferenceV1::Feature { feature } => feature < features,
        ProgramValueReferenceV1::Parameter { parameter } => parameter < parameters,
        ProgramValueReferenceV1::State { state_cell } => state_cell < states,
    }
}

fn rolling_values(history: &[i128], current: Option<i128>, window: u16) -> Option<Vec<i128>> {
    let current = current?;
    let prior = usize::from(window) - 1;
    if history.len() < prior {
        return None;
    }
    let mut values = history[history.len() - prior..].to_vec();
    values.push(current);
    Some(values)
}

fn checked_mean(values: &[i128]) -> Result<Option<i128>, ComplexStrategyProgramError> {
    let total = values
        .iter()
        .try_fold(0_i128, |total, value| total.checked_add(*value))
        .ok_or(ComplexStrategyProgramError::ArithmeticOverflow)?;
    Ok(Some(
        total
            / i128::try_from(values.len())
                .map_err(|_| ComplexStrategyProgramError::ArithmeticOverflow)?,
    ))
}

fn checked_std_dev(values: &[i128]) -> Result<Option<i128>, ComplexStrategyProgramError> {
    let mean = checked_mean(values)?.ok_or(ComplexStrategyProgramError::ArithmeticOverflow)?;
    let sum = values
        .iter()
        .try_fold(0_u128, |total, value| {
            let difference = value.checked_sub(mean)?.unsigned_abs();
            total.checked_add(difference.checked_mul(difference)?)
        })
        .ok_or(ComplexStrategyProgramError::ArithmeticOverflow)?;
    let variance = sum
        / u128::try_from(values.len())
            .map_err(|_| ComplexStrategyProgramError::ArithmeticOverflow)?;
    let root = integer_sqrt(variance);
    i128::try_from(root)
        .map(Some)
        .map_err(|_| ComplexStrategyProgramError::ArithmeticOverflow)
}

fn integer_sqrt(value: u128) -> u128 {
    if value < 2 {
        return value;
    }
    let mut low = 1_u128;
    let mut high = value.min(1_u128 << 64);
    while low < high {
        let middle = low + (high - low).div_ceil(2);
        if middle <= value / middle {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    low
}

fn binary(values: &[Option<i128>], left: usize, right: usize) -> Option<(i128, i128)> {
    Some((values[left]?, values[right]?))
}

fn fixed(value: ProgramScaledIntegerV1) -> Result<i128, ComplexStrategyProgramError> {
    let exponent = FIXED_SCALE
        .checked_sub(value.scale)
        .ok_or(ComplexStrategyProgramError::UnsupportedScale)?;
    i128::from(value.coefficient)
        .checked_mul(10_i128.pow(u32::from(exponent)))
        .ok_or(ComplexStrategyProgramError::ArithmeticOverflow)
}

const fn fixed_factor() -> i128 {
    1_000_000_000_000_000_000
}

fn push_len(bytes: &mut Vec<u8>, value: usize) -> Result<(), ComplexStrategyProgramError> {
    let value =
        u32::try_from(value).map_err(|_| ComplexStrategyProgramError::FrameBoundExceeded)?;
    bytes.extend_from_slice(&value.to_le_bytes());
    Ok(())
}

fn identity(domain: &[u8], bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    format!("sha256:{}", encode_hex(&hasher.finalize()))
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}
