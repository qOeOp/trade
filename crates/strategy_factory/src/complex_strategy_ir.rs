use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::complex_strategy_program::{
    ComplexStrategyProgramDefinitionV1, ComplexStrategyProgramError, ComplexStrategyProgramV1,
    ProgramActionV1, ProgramComparisonV1, ProgramFeatureOperationV1, ProgramFeatureV1,
    ProgramGuardV1, ProgramInputV1, ProgramJoinAlignmentV1, ProgramJoinV1, ProgramParameterV1,
    ProgramScaledIntegerV1, ProgramStateV1, ProgramTransitionV1, ProgramValueReferenceV1,
    ProgramZeroDenominatorV1,
};
use crate::rd_owner_postgres_custody::VerifiedResearchCustodyV1;

pub const COMPLEX_STRATEGY_IR_SCHEMA_V1: &str = "complex-strategy-ir-v1";
pub const COMPLEX_STRATEGY_IR_SCHEMA_VERSION_V1: u32 = 1;

const SEMANTIC_DIGEST_DOMAIN_V1: &[u8] = b"vibe.strategy-factory.complex-strategy-ir.semantic.v1\0";
const MAX_DOCUMENT_BYTES: usize = 64 * 1024;
const MAX_ID_BYTES: usize = 64;
const MAX_INPUTS: usize = 32;
const MAX_JOINS: usize = 32;
const MAX_PARAMETERS: usize = 64;
const MAX_FEATURES: usize = 256;
const MAX_FEATURE_DEPTH: usize = 64;
const MAX_STATE_CELLS: usize = 32;
const MAX_TRANSITIONS: usize = 128;
const MAX_GUARDS_PER_TRANSITION: usize = 16;
const MAX_ACTIONS_PER_TRANSITION: usize = 16;
const MAX_WINDOW: u16 = 4_096;
const MAX_SCALE: u8 = 18;

#[derive(Debug, Error)]
pub enum ComplexStrategyIrError {
    #[error("complex strategy IR is not valid JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("complex strategy IR document size is outside the supported bound")]
    DocumentSize,
    #[error("complex strategy IR schema or version is unsupported")]
    UnsupportedSchema,
    #[error("complex strategy IR frozen Intent binding does not match the expected Intent")]
    IntentBindingMismatch,
    #[error("complex strategy IR authority requires a verified accepted frozen Intent")]
    IntentAuthorityUnavailable,
    #[error("{field} is invalid")]
    InvalidField { field: &'static str },
    #[error("{collection} exceeds its supported bound")]
    BoundExceeded { collection: &'static str },
    #[error("duplicate {collection} declaration: {id}")]
    DuplicateDeclaration {
        collection: &'static str,
        id: String,
    },
    #[error("{owner} references unbound {target}: {id}")]
    UnboundReference {
        owner: String,
        target: &'static str,
        id: String,
    },
    #[error("feature dependency cycle contains: {id}")]
    FeatureCycle { id: String },
    #[error("feature dependency depth exceeds its supported bound")]
    FeatureDepth,
}

/// A validated, provider-neutral complex-strategy meaning document.
///
/// The value contains no source, import, filesystem, command, provider, dependency,
/// credential, network, deployment, replay, qualification, trading, or effect surface.
/// It is descriptive R&D input only and carries no runtime authority.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComplexStrategyIrV1 {
    document: ComplexStrategyDocumentV1,
    canonical_bytes: Box<[u8]>,
    semantic_digest: String,
}

/// Opaque proof that the R&D Owner verified custody of an accepted frozen Intent.
pub(crate) struct ComplexStrategyIntentAuthorityV1 {
    intent_identity: String,
    intent_semantic_digest: String,
}

impl ComplexStrategyIntentAuthorityV1 {
    #[cfg(test)]
    pub(crate) fn for_test(
        intent_identity: &str,
        intent_semantic_digest: &str,
    ) -> Result<Self, ComplexStrategyIrError> {
        validate_id(intent_identity, "expected_intent.identity")?;
        validate_sha256(intent_semantic_digest, "expected_intent.semantic_digest")?;

        Ok(Self {
            intent_identity: intent_identity.to_owned(),
            intent_semantic_digest: intent_semantic_digest.to_owned(),
        })
    }
}

impl TryFrom<&VerifiedResearchCustodyV1> for ComplexStrategyIntentAuthorityV1 {
    type Error = ComplexStrategyIrError;

    fn try_from(custody: &VerifiedResearchCustodyV1) -> Result<Self, ComplexStrategyIrError> {
        let intent = custody
            .intent()
            .ok_or(ComplexStrategyIrError::IntentAuthorityUnavailable)?;

        Ok(Self {
            intent_identity: intent.intent_identity().to_owned(),
            intent_semantic_digest: intent.semantic_digest().to_owned(),
        })
    }
}

impl ComplexStrategyIrV1 {
    pub(crate) fn parse_for_intent(
        bytes: &[u8],
        authority: &ComplexStrategyIntentAuthorityV1,
    ) -> Result<Self, ComplexStrategyIrError> {
        if !(1..=MAX_DOCUMENT_BYTES).contains(&bytes.len()) {
            return Err(ComplexStrategyIrError::DocumentSize);
        }

        let mut document: ComplexStrategyDocumentV1 = serde_json::from_slice(bytes)?;
        validate_document(&document)?;
        if document.intent.identity != authority.intent_identity
            || document.intent.semantic_digest != authority.intent_semantic_digest
        {
            return Err(ComplexStrategyIrError::IntentBindingMismatch);
        }
        normalize_declaration_order(&mut document);
        let mut canonical_bytes = serde_json::to_vec(&document)?;
        canonical_bytes.push(b'\n');

        let mut hasher = Sha256::new();
        hasher.update(SEMANTIC_DIGEST_DOMAIN_V1);
        hasher.update(&canonical_bytes);
        let semantic_digest = format!("sha256:{}", encode_hex(&hasher.finalize()));

        Ok(Self {
            document,
            canonical_bytes: canonical_bytes.into(),
            semantic_digest,
        })
    }

    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub fn semantic_digest(&self) -> &str {
        &self.semantic_digest
    }

    pub fn intent_identity(&self) -> &str {
        &self.document.intent.identity
    }

    pub fn intent_semantic_digest(&self) -> &str {
        &self.document.intent.semantic_digest
    }

    pub fn schema(&self) -> &'static str {
        COMPLEX_STRATEGY_IR_SCHEMA_V1
    }

    pub const fn schema_version(&self) -> u32 {
        COMPLEX_STRATEGY_IR_SCHEMA_VERSION_V1
    }

    pub(crate) fn symbolic_inputs(&self) -> Vec<SymbolicInputProjectionV1> {
        self.document
            .inputs
            .iter()
            .map(project_symbolic_input)
            .collect()
    }

    pub(crate) fn compile_program(
        &self,
        binding_identity: &str,
    ) -> Result<ComplexStrategyProgramV1, ComplexStrategyProgramError> {
        let definition =
            compile_program_definition(&self.document, &self.semantic_digest, binding_identity)?;
        ComplexStrategyProgramV1::compile(definition)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub(crate) struct SymbolicInputProjectionV1 {
    pub(crate) id: String,
    pub(crate) instrument_role: String,
    pub(crate) timeframe: String,
    pub(crate) field: String,
}

impl TryFrom<(&VerifiedResearchCustodyV1, &[u8])> for ComplexStrategyIrV1 {
    type Error = ComplexStrategyIrError;

    fn try_from(
        (custody, bytes): (&VerifiedResearchCustodyV1, &[u8]),
    ) -> Result<Self, Self::Error> {
        let authority = ComplexStrategyIntentAuthorityV1::try_from(custody)?;
        Self::parse_for_intent(bytes, &authority)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ComplexStrategyDocumentV1 {
    schema: String,
    schema_version: u32,
    intent: FrozenIntentBindingV1,
    inputs: Vec<SymbolicInputV1>,
    joins: Vec<InputJoinV1>,
    parameters: Vec<ScaledParameterV1>,
    features: Vec<FeatureNodeV1>,
    state_cells: Vec<StateCellV1>,
    transitions: Vec<TransitionV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FrozenIntentBindingV1 {
    identity: String,
    semantic_digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SymbolicInputV1 {
    id: String,
    instrument_role: InstrumentRoleV1,
    timeframe: String,
    field: InputFieldV1,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(transparent)]
struct InstrumentRoleV1(String);

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum InputFieldV1 {
    Open,
    High,
    Low,
    Close,
    Volume,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct InputJoinV1 {
    id: String,
    left_input: String,
    right_input: String,
    alignment: JoinAlignmentV1,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum JoinAlignmentV1 {
    ExactDecisionCut,
    LatestAtOrBeforeDecisionCut,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ScaledParameterV1 {
    id: String,
    value: ScaledIntegerV1,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ScaledIntegerV1 {
    coefficient: i64,
    scale: u8,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FeatureNodeV1 {
    id: String,
    operation: FeatureOperationV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
enum FeatureOperationV1 {
    Input {
        input: String,
    },
    JoinLeft {
        join: String,
    },
    JoinRight {
        join: String,
    },
    Parameter {
        parameter: String,
    },
    Lag {
        operand: String,
        periods: u16,
    },
    RollingMean {
        operand: String,
        window: u16,
    },
    RollingStdDev {
        operand: String,
        window: u16,
    },
    Add {
        left: String,
        right: String,
    },
    Subtract {
        left: String,
        right: String,
    },
    Multiply {
        left: String,
        right: String,
    },
    Divide {
        numerator: String,
        denominator: String,
        zero_denominator: ZeroDenominatorPolicyV1,
    },
    Negate {
        operand: String,
    },
    Absolute {
        operand: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
enum ZeroDenominatorPolicyV1 {
    RejectEvaluation,
    ReturnZero,
    UseValue { value: ScaledIntegerV1 },
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StateCellV1 {
    id: String,
    initial: ScaledIntegerV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TransitionV1 {
    id: String,
    guards: Vec<GuardV1>,
    actions: Vec<ActionV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct GuardV1 {
    left: ValueReferenceV1,
    comparison: ComparisonV1,
    right: ValueReferenceV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ComparisonV1 {
    LessThan,
    LessThanOrEqual,
    Equal,
    NotEqual,
    GreaterThanOrEqual,
    GreaterThan,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
enum ValueReferenceV1 {
    Feature { feature: String },
    Parameter { parameter: String },
    State { state_cell: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
enum ActionV1 {
    AssignState {
        state_cell: String,
        value: ValueReferenceV1,
    },
}

fn project_symbolic_input(input: &SymbolicInputV1) -> SymbolicInputProjectionV1 {
    SymbolicInputProjectionV1 {
        id: input.id.clone(),
        instrument_role: input.instrument_role.0.clone(),
        timeframe: input.timeframe.clone(),
        field: input_field_name(&input.field).to_owned(),
    }
}

fn compile_program_definition(
    document: &ComplexStrategyDocumentV1,
    ir_semantic_digest: &str,
    binding_identity: &str,
) -> Result<ComplexStrategyProgramDefinitionV1, ComplexStrategyProgramError> {
    let input_indexes = indexes(document.inputs.iter().map(|input| input.id.as_str()));
    let join_indexes = indexes(document.joins.iter().map(|join| join.id.as_str()));
    let parameter_indexes = indexes(
        document
            .parameters
            .iter()
            .map(|parameter| parameter.id.as_str()),
    );
    let state_indexes = indexes(document.state_cells.iter().map(|state| state.id.as_str()));
    let feature_order = topological_feature_order(&document.features)?;
    let feature_indexes = indexes(feature_order.iter().copied());
    let feature_map = document
        .features
        .iter()
        .map(|feature| (feature.id.as_str(), feature))
        .collect::<BTreeMap<_, _>>();

    let inputs = document
        .inputs
        .iter()
        .map(|input| ProgramInputV1 {
            id: input.id.clone(),
            instrument_role: input.instrument_role.0.clone(),
            timeframe: input.timeframe.clone(),
            field: input_field_name(&input.field).to_owned(),
        })
        .collect();
    let joins = document
        .joins
        .iter()
        .map(|join| ProgramJoinV1 {
            id: join.id.clone(),
            left_input: input_indexes[join.left_input.as_str()],
            right_input: input_indexes[join.right_input.as_str()],
            alignment: match join.alignment {
                JoinAlignmentV1::ExactDecisionCut => ProgramJoinAlignmentV1::ExactDecisionCut,
                JoinAlignmentV1::LatestAtOrBeforeDecisionCut => {
                    ProgramJoinAlignmentV1::LatestAtOrBeforeDecisionCut
                }
            },
        })
        .collect();
    let parameters = document
        .parameters
        .iter()
        .map(|parameter| ProgramParameterV1 {
            id: parameter.id.clone(),
            value: program_scaled(&parameter.value),
        })
        .collect();
    let features = feature_order
        .iter()
        .map(|id| {
            let feature = feature_map[id];
            Ok(ProgramFeatureV1 {
                id: feature.id.clone(),
                operation: program_feature_operation(
                    &feature.operation,
                    &input_indexes,
                    &join_indexes,
                    &parameter_indexes,
                    &feature_indexes,
                ),
            })
        })
        .collect::<Result<Vec<_>, ComplexStrategyProgramError>>()?;
    let states = document
        .state_cells
        .iter()
        .map(|state| ProgramStateV1 {
            id: state.id.clone(),
            initial: program_scaled(&state.initial),
        })
        .collect();
    let transitions = document
        .transitions
        .iter()
        .map(|transition| ProgramTransitionV1 {
            id: transition.id.clone(),
            guards: transition
                .guards
                .iter()
                .map(|guard| ProgramGuardV1 {
                    left: program_reference(
                        &guard.left,
                        &feature_indexes,
                        &parameter_indexes,
                        &state_indexes,
                    ),
                    comparison: match guard.comparison {
                        ComparisonV1::LessThan => ProgramComparisonV1::LessThan,
                        ComparisonV1::LessThanOrEqual => ProgramComparisonV1::LessThanOrEqual,
                        ComparisonV1::Equal => ProgramComparisonV1::Equal,
                        ComparisonV1::NotEqual => ProgramComparisonV1::NotEqual,
                        ComparisonV1::GreaterThanOrEqual => ProgramComparisonV1::GreaterThanOrEqual,
                        ComparisonV1::GreaterThan => ProgramComparisonV1::GreaterThan,
                    },
                    right: program_reference(
                        &guard.right,
                        &feature_indexes,
                        &parameter_indexes,
                        &state_indexes,
                    ),
                })
                .collect(),
            actions: transition
                .actions
                .iter()
                .map(|action| match action {
                    ActionV1::AssignState { state_cell, value } => ProgramActionV1 {
                        state_cell: state_indexes[state_cell.as_str()],
                        value: program_reference(
                            value,
                            &feature_indexes,
                            &parameter_indexes,
                            &state_indexes,
                        ),
                    },
                })
                .collect(),
        })
        .collect();
    Ok(ComplexStrategyProgramDefinitionV1 {
        ir_semantic_digest: ir_semantic_digest.to_owned(),
        binding_identity: binding_identity.to_owned(),
        inputs,
        joins,
        parameters,
        features,
        states,
        transitions,
    })
}

fn program_feature_operation(
    operation: &FeatureOperationV1,
    inputs: &BTreeMap<&str, usize>,
    joins: &BTreeMap<&str, usize>,
    parameters: &BTreeMap<&str, usize>,
    features: &BTreeMap<&str, usize>,
) -> ProgramFeatureOperationV1 {
    match operation {
        FeatureOperationV1::Input { input } => ProgramFeatureOperationV1::Input {
            input: inputs[input.as_str()],
        },
        FeatureOperationV1::JoinLeft { join } => ProgramFeatureOperationV1::JoinLeft {
            join: joins[join.as_str()],
        },
        FeatureOperationV1::JoinRight { join } => ProgramFeatureOperationV1::JoinRight {
            join: joins[join.as_str()],
        },
        FeatureOperationV1::Parameter { parameter } => ProgramFeatureOperationV1::Parameter {
            parameter: parameters[parameter.as_str()],
        },
        FeatureOperationV1::Lag { operand, periods } => ProgramFeatureOperationV1::Lag {
            operand: features[operand.as_str()],
            periods: *periods,
        },
        FeatureOperationV1::RollingMean { operand, window } => {
            ProgramFeatureOperationV1::RollingMean {
                operand: features[operand.as_str()],
                window: *window,
            }
        }
        FeatureOperationV1::RollingStdDev { operand, window } => {
            ProgramFeatureOperationV1::RollingStdDev {
                operand: features[operand.as_str()],
                window: *window,
            }
        }
        FeatureOperationV1::Add { left, right } => ProgramFeatureOperationV1::Add {
            left: features[left.as_str()],
            right: features[right.as_str()],
        },
        FeatureOperationV1::Subtract { left, right } => ProgramFeatureOperationV1::Subtract {
            left: features[left.as_str()],
            right: features[right.as_str()],
        },
        FeatureOperationV1::Multiply { left, right } => ProgramFeatureOperationV1::Multiply {
            left: features[left.as_str()],
            right: features[right.as_str()],
        },
        FeatureOperationV1::Divide {
            numerator,
            denominator,
            zero_denominator,
        } => ProgramFeatureOperationV1::Divide {
            numerator: features[numerator.as_str()],
            denominator: features[denominator.as_str()],
            zero_denominator: match zero_denominator {
                ZeroDenominatorPolicyV1::RejectEvaluation => {
                    ProgramZeroDenominatorV1::RejectEvaluation
                }
                ZeroDenominatorPolicyV1::ReturnZero => ProgramZeroDenominatorV1::ReturnZero,
                ZeroDenominatorPolicyV1::UseValue { value } => ProgramZeroDenominatorV1::UseValue {
                    value: program_scaled(value),
                },
            },
        },
        FeatureOperationV1::Negate { operand } => ProgramFeatureOperationV1::Negate {
            operand: features[operand.as_str()],
        },
        FeatureOperationV1::Absolute { operand } => ProgramFeatureOperationV1::Absolute {
            operand: features[operand.as_str()],
        },
    }
}

fn program_reference(
    reference: &ValueReferenceV1,
    features: &BTreeMap<&str, usize>,
    parameters: &BTreeMap<&str, usize>,
    states: &BTreeMap<&str, usize>,
) -> ProgramValueReferenceV1 {
    match reference {
        ValueReferenceV1::Feature { feature } => ProgramValueReferenceV1::Feature {
            feature: features[feature.as_str()],
        },
        ValueReferenceV1::Parameter { parameter } => ProgramValueReferenceV1::Parameter {
            parameter: parameters[parameter.as_str()],
        },
        ValueReferenceV1::State { state_cell } => ProgramValueReferenceV1::State {
            state_cell: states[state_cell.as_str()],
        },
    }
}

fn program_scaled(value: &ScaledIntegerV1) -> ProgramScaledIntegerV1 {
    ProgramScaledIntegerV1 {
        coefficient: value.coefficient,
        scale: value.scale,
    }
}

fn indexes<'a>(ids: impl Iterator<Item = &'a str>) -> BTreeMap<&'a str, usize> {
    ids.enumerate().map(|(index, id)| (id, index)).collect()
}

fn topological_feature_order(
    features: &[FeatureNodeV1],
) -> Result<Vec<&str>, ComplexStrategyProgramError> {
    let by_id = features
        .iter()
        .map(|feature| (feature.id.as_str(), feature))
        .collect::<BTreeMap<_, _>>();
    let mut ordered = Vec::with_capacity(features.len());
    let mut included = BTreeSet::new();

    while ordered.len() != features.len() {
        let next = by_id.iter().find_map(|(id, feature)| {
            (!included.contains(id)
                && feature_dependencies(&feature.operation)
                    .iter()
                    .all(|dependency| included.contains(dependency)))
            .then_some(*id)
        });
        let Some(next) = next else {
            return Err(ComplexStrategyProgramError::InvalidIndex);
        };
        included.insert(next);
        ordered.push(next);
    }
    Ok(ordered)
}

fn input_field_name(field: &InputFieldV1) -> &'static str {
    match field {
        InputFieldV1::Open => "OPEN",
        InputFieldV1::High => "HIGH",
        InputFieldV1::Low => "LOW",
        InputFieldV1::Close => "CLOSE",
        InputFieldV1::Volume => "VOLUME",
    }
}

fn validate_document(document: &ComplexStrategyDocumentV1) -> Result<(), ComplexStrategyIrError> {
    if document.schema != COMPLEX_STRATEGY_IR_SCHEMA_V1
        || document.schema_version != COMPLEX_STRATEGY_IR_SCHEMA_VERSION_V1
    {
        return Err(ComplexStrategyIrError::UnsupportedSchema);
    }
    validate_id(&document.intent.identity, "intent.identity")?;
    validate_sha256(&document.intent.semantic_digest, "intent.semantic_digest")?;

    validate_len("inputs", document.inputs.len(), 1, MAX_INPUTS)?;
    validate_len("joins", document.joins.len(), 0, MAX_JOINS)?;
    validate_len("parameters", document.parameters.len(), 1, MAX_PARAMETERS)?;
    validate_len("features", document.features.len(), 1, MAX_FEATURES)?;
    validate_len(
        "state_cells",
        document.state_cells.len(),
        1,
        MAX_STATE_CELLS,
    )?;
    validate_len(
        "transitions",
        document.transitions.len(),
        1,
        MAX_TRANSITIONS,
    )?;

    let input_ids = unique_ids("input", document.inputs.iter().map(|input| &input.id))?;
    let join_ids = unique_ids("join", document.joins.iter().map(|join| &join.id))?;
    let parameter_ids = unique_ids(
        "parameter",
        document.parameters.iter().map(|parameter| &parameter.id),
    )?;
    let feature_ids = unique_ids(
        "feature",
        document.features.iter().map(|feature| &feature.id),
    )?;
    let state_ids = unique_ids(
        "state cell",
        document.state_cells.iter().map(|state| &state.id),
    )?;
    unique_ids(
        "transition",
        document.transitions.iter().map(|transition| &transition.id),
    )?;

    for input in &document.inputs {
        validate_id(&input.id, "inputs.id")?;
        validate_id(&input.instrument_role.0, "inputs.instrument_role")?;
        validate_id(&input.timeframe, "inputs.timeframe")?;
    }
    reject_duplicate_input_meanings(&document.inputs)?;

    for join in &document.joins {
        validate_id(&join.id, "joins.id")?;
        bound(&input_ids, &join.left_input, &join.id, "input")?;
        bound(&input_ids, &join.right_input, &join.id, "input")?;
        if join.left_input == join.right_input {
            return Err(ComplexStrategyIrError::InvalidField {
                field: "joins.left_input/right_input",
            });
        }
    }
    reject_duplicate_join_meanings(&document.joins)?;

    for parameter in &document.parameters {
        validate_id(&parameter.id, "parameters.id")?;
        validate_scaled_integer(&parameter.value, "parameters.value.scale")?;
    }

    for state in &document.state_cells {
        validate_id(&state.id, "state_cells.id")?;
        validate_scaled_integer(&state.initial, "state_cells.initial.scale")?;
    }

    let features = document
        .features
        .iter()
        .map(|feature| (feature.id.as_str(), feature))
        .collect::<BTreeMap<_, _>>();

    for feature in &document.features {
        validate_id(&feature.id, "features.id")?;
        validate_feature_operation(feature, &input_ids, &join_ids, &parameter_ids, &feature_ids)?;
    }
    validate_feature_dag(&features)?;

    for transition in &document.transitions {
        validate_id(&transition.id, "transitions.id")?;
        validate_len(
            "transition guards",
            transition.guards.len(),
            1,
            MAX_GUARDS_PER_TRANSITION,
        )?;
        validate_len(
            "transition actions",
            transition.actions.len(),
            1,
            MAX_ACTIONS_PER_TRANSITION,
        )?;

        for guard in &transition.guards {
            validate_value_reference(
                &guard.left,
                &transition.id,
                &feature_ids,
                &parameter_ids,
                &state_ids,
            )?;
            validate_value_reference(
                &guard.right,
                &transition.id,
                &feature_ids,
                &parameter_ids,
                &state_ids,
            )?;
        }

        for action in &transition.actions {
            match action {
                ActionV1::AssignState { state_cell, value } => {
                    bound(&state_ids, state_cell, &transition.id, "state cell")?;
                    validate_value_reference(
                        value,
                        &transition.id,
                        &feature_ids,
                        &parameter_ids,
                        &state_ids,
                    )?;
                }
            }
        }
        let assigned_states = transition
            .actions
            .iter()
            .map(|action| match action {
                ActionV1::AssignState { state_cell, .. } => state_cell.as_str(),
            })
            .collect::<BTreeSet<_>>();

        if assigned_states.len() != transition.actions.len() {
            return Err(ComplexStrategyIrError::InvalidField {
                field: "transitions.actions.state_cell",
            });
        }
    }

    Ok(())
}

fn validate_feature_operation(
    feature: &FeatureNodeV1,
    inputs: &BTreeSet<&str>,
    joins: &BTreeSet<&str>,
    parameters: &BTreeSet<&str>,
    features: &BTreeSet<&str>,
) -> Result<(), ComplexStrategyIrError> {
    let owner = feature.id.as_str();
    match &feature.operation {
        FeatureOperationV1::Input { input } => bound(inputs, input, owner, "input"),
        FeatureOperationV1::JoinLeft { join } | FeatureOperationV1::JoinRight { join } => {
            bound(joins, join, owner, "join")
        }
        FeatureOperationV1::Parameter { parameter } => {
            bound(parameters, parameter, owner, "parameter")
        }
        FeatureOperationV1::Lag { operand, periods } => {
            validate_window(*periods, "features.operation.periods")?;
            bound(features, operand, owner, "feature")
        }
        FeatureOperationV1::RollingMean { operand, window }
        | FeatureOperationV1::RollingStdDev { operand, window } => {
            validate_window(*window, "features.operation.window")?;
            bound(features, operand, owner, "feature")
        }
        FeatureOperationV1::Add { left, right }
        | FeatureOperationV1::Subtract { left, right }
        | FeatureOperationV1::Multiply { left, right } => {
            bound(features, left, owner, "feature")?;
            bound(features, right, owner, "feature")
        }
        FeatureOperationV1::Divide {
            numerator,
            denominator,
            zero_denominator,
        } => {
            bound(features, numerator, owner, "feature")?;
            bound(features, denominator, owner, "feature")?;
            if let ZeroDenominatorPolicyV1::UseValue { value } = zero_denominator {
                validate_scaled_integer(value, "features.operation.zero_denominator.value.scale")?;
            }
            Ok(())
        }
        FeatureOperationV1::Negate { operand } | FeatureOperationV1::Absolute { operand } => {
            bound(features, operand, owner, "feature")
        }
    }
}

fn validate_value_reference(
    reference: &ValueReferenceV1,
    owner: &str,
    features: &BTreeSet<&str>,
    parameters: &BTreeSet<&str>,
    states: &BTreeSet<&str>,
) -> Result<(), ComplexStrategyIrError> {
    match reference {
        ValueReferenceV1::Feature { feature } => bound(features, feature, owner, "feature"),
        ValueReferenceV1::Parameter { parameter } => {
            bound(parameters, parameter, owner, "parameter")
        }
        ValueReferenceV1::State { state_cell } => bound(states, state_cell, owner, "state cell"),
    }
}

fn validate_feature_dag(
    features: &BTreeMap<&str, &FeatureNodeV1>,
) -> Result<(), ComplexStrategyIrError> {
    let mut depths = BTreeMap::new();
    let mut active = BTreeSet::new();
    for id in features.keys() {
        feature_depth(id, features, &mut active, &mut depths)?;
    }
    Ok(())
}

fn feature_depth<'a>(
    id: &'a str,
    features: &BTreeMap<&'a str, &'a FeatureNodeV1>,
    active: &mut BTreeSet<&'a str>,
    depths: &mut BTreeMap<&'a str, usize>,
) -> Result<usize, ComplexStrategyIrError> {
    if let Some(depth) = depths.get(id) {
        return Ok(*depth);
    }

    if !active.insert(id) {
        return Err(ComplexStrategyIrError::FeatureCycle { id: id.to_string() });
    }
    let feature = features
        .get(id)
        .ok_or_else(|| ComplexStrategyIrError::UnboundReference {
            owner: id.to_string(),
            target: "feature",
            id: id.to_string(),
        })?;
    let mut maximum_dependency_depth = 0;
    for dependency in feature_dependencies(&feature.operation) {
        maximum_dependency_depth =
            maximum_dependency_depth.max(feature_depth(dependency, features, active, depths)?);
    }
    active.remove(id);
    let depth = maximum_dependency_depth + 1;
    if depth > MAX_FEATURE_DEPTH {
        return Err(ComplexStrategyIrError::FeatureDepth);
    }
    depths.insert(id, depth);
    Ok(depth)
}

fn feature_dependencies(operation: &FeatureOperationV1) -> Vec<&str> {
    match operation {
        FeatureOperationV1::Input { .. }
        | FeatureOperationV1::JoinLeft { .. }
        | FeatureOperationV1::JoinRight { .. }
        | FeatureOperationV1::Parameter { .. } => Vec::new(),
        FeatureOperationV1::Lag { operand, .. }
        | FeatureOperationV1::RollingMean { operand, .. }
        | FeatureOperationV1::RollingStdDev { operand, .. }
        | FeatureOperationV1::Negate { operand }
        | FeatureOperationV1::Absolute { operand } => vec![operand],
        FeatureOperationV1::Add { left, right }
        | FeatureOperationV1::Subtract { left, right }
        | FeatureOperationV1::Multiply { left, right } => vec![left, right],
        FeatureOperationV1::Divide {
            numerator,
            denominator,
            ..
        } => vec![numerator, denominator],
    }
}

fn normalize_declaration_order(document: &mut ComplexStrategyDocumentV1) {
    document
        .inputs
        .sort_by(|left, right| left.id.cmp(&right.id));
    document.joins.sort_by(|left, right| left.id.cmp(&right.id));
    document
        .parameters
        .sort_by(|left, right| left.id.cmp(&right.id));
    document
        .features
        .sort_by(|left, right| left.id.cmp(&right.id));
    document
        .state_cells
        .sort_by(|left, right| left.id.cmp(&right.id));
    document
        .transitions
        .sort_by(|left, right| left.id.cmp(&right.id));
}

fn validate_id(value: &str, field: &'static str) -> Result<(), ComplexStrategyIrError> {
    let valid = (1..=MAX_ID_BYTES).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':'));

    if valid {
        Ok(())
    } else {
        Err(ComplexStrategyIrError::InvalidField { field })
    }
}

fn validate_sha256(value: &str, field: &'static str) -> Result<(), ComplexStrategyIrError> {
    let valid = value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    });

    if valid {
        Ok(())
    } else {
        Err(ComplexStrategyIrError::InvalidField { field })
    }
}

fn validate_scaled_integer(
    value: &ScaledIntegerV1,
    field: &'static str,
) -> Result<(), ComplexStrategyIrError> {
    if value.scale <= MAX_SCALE {
        Ok(())
    } else {
        Err(ComplexStrategyIrError::InvalidField { field })
    }
}

fn validate_window(value: u16, field: &'static str) -> Result<(), ComplexStrategyIrError> {
    if (1..=MAX_WINDOW).contains(&value) {
        Ok(())
    } else {
        Err(ComplexStrategyIrError::InvalidField { field })
    }
}

fn validate_len(
    collection: &'static str,
    actual: usize,
    minimum: usize,
    maximum: usize,
) -> Result<(), ComplexStrategyIrError> {
    if (minimum..=maximum).contains(&actual) {
        Ok(())
    } else {
        Err(ComplexStrategyIrError::BoundExceeded { collection })
    }
}

fn unique_ids<'a>(
    collection: &'static str,
    ids: impl Iterator<Item = &'a String>,
) -> Result<BTreeSet<&'a str>, ComplexStrategyIrError> {
    let mut unique = BTreeSet::new();
    for id in ids {
        if !unique.insert(id.as_str()) {
            return Err(ComplexStrategyIrError::DuplicateDeclaration {
                collection,
                id: id.clone(),
            });
        }
    }
    Ok(unique)
}

fn bound(
    declared: &BTreeSet<&str>,
    id: &str,
    owner: &str,
    target: &'static str,
) -> Result<(), ComplexStrategyIrError> {
    if declared.contains(id) {
        Ok(())
    } else {
        Err(ComplexStrategyIrError::UnboundReference {
            owner: owner.to_string(),
            target,
            id: id.to_string(),
        })
    }
}

fn reject_duplicate_input_meanings(
    inputs: &[SymbolicInputV1],
) -> Result<(), ComplexStrategyIrError> {
    let mut meanings = BTreeSet::new();

    for input in inputs {
        let meaning = (&input.instrument_role, &input.timeframe, &input.field);
        if !meanings.insert(meaning) {
            return Err(ComplexStrategyIrError::DuplicateDeclaration {
                collection: "input meaning",
                id: input.id.clone(),
            });
        }
    }
    Ok(())
}

fn reject_duplicate_join_meanings(joins: &[InputJoinV1]) -> Result<(), ComplexStrategyIrError> {
    let mut meanings = BTreeSet::new();

    for join in joins {
        let meaning = (&join.left_input, &join.right_input, &join.alignment);
        if !meanings.insert(meaning) {
            return Err(ComplexStrategyIrError::DuplicateDeclaration {
                collection: "join meaning",
                id: join.id.clone(),
            });
        }
    }
    Ok(())
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
