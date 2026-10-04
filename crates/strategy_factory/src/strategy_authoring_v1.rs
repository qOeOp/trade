//! Authoring language V1, slice 1: a strategy document compiled into the `design` and `meaning`
//! pair, for the constructs research T0 needs (`docs/owners/rd.md`, authoring language V1).
//!
//! A document names its inputs, a flat list of definitions, its states, an ordered list of rules
//! and an `otherwise` action. Every name is a node id, so the definitions are the graph, and a state
//! read anywhere is its value at the previous tick, so feedback runs only through state. The
//! compiler decides encoding only: each construct becomes catalog operations, units and scales are
//! carried exactly, and the compiler derives and prepares its own output before returning it, so
//! nothing it emits is a program `prepare` refuses.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use vibe_data::owner::source_binding::BindingDigest;
use vibe_indicators_kernel::{CatalogStateRuleV1, PrimitiveCatalogV1};

use crate::{
    bounded_feature_design_v1::{
        BoundedFeatureDesignSpecV1, PLUGIN_SEMANTIC_ID, bounded_feature_design_v1,
    },
    bounded_feature_graph_v1::{
        ADD, COMPARE, DIV, Graph, MUL, SIGNAL_UNIT, SUB, VALUE_PORT, fixed_type, node_value,
        prior_state,
    },
    bounded_feature_program_derivation_v1::{
        BoundedFeatureGraphBoundsV1, BoundedFeatureInputMeaningV1, BoundedFeatureProgramMeaningV1,
        assemble_bounded_feature_program_for_self_check_v1,
    },
    bounded_feature_program_v1::{
        BoundedFeatureAvailabilityV1, BoundedFeatureBoundsV1, BoundedFeatureClockV1,
        BoundedFeatureConstantV1, BoundedFeatureConstantValueV1, BoundedFeatureInitialStateV1,
        BoundedFeatureInputBindingV1, BoundedFeatureNodeV1, BoundedFeatureOutputPortV1,
        BoundedFeatureParametersV1, BoundedFeaturePredicateV1,
        BoundedFeatureProposalDecisionBranchV1, BoundedFeatureProposalDecisionTableV1,
        BoundedFeatureProposalFrameV1, BoundedFeatureRoundingV1, BoundedFeatureStateCellV1,
        BoundedFeatureStateKindV1, BoundedFeatureTerminalConversionV1,
        BoundedFeatureTerminalOutputV1, BoundedFeatureValueRefV1, BoundedFeatureValueTypeV1,
        BoundedFeatureWarmupContractV1, BoundedFeatureWarmupPostStateV1, expected_state_bytes,
        measure_bounded_feature_program_shape_v1, prepare_bounded_feature_program_v1,
    },
    strategy_design_v2::{InputRoleV2, StrategyDesignV2},
    strategy_plan_v2::{strategy_input_role_identity_v2, universe_member_role_v2},
};

/// The language a document must name.
pub const STRATEGY_AUTHORING_LANGUAGE_V1: &str = "research.strategy-authoring.v1";

const LAG: &str = "bfp.lag.coordinate.offset.full-history.v1";
const ROLLING_MAX: &str = "bfp.rolling.max.full-window.v1";
const ROLLING_MIN: &str = "bfp.rolling.min.full-window.v1";
const ATR: &str = "bfp.atr.true-range.wilder-first-sample.nearest-ties-to-even.v1";
const RESCALE: &str =
    "bfp.fixed-i128.rescale.max-scale-38.i256-single-round.nearest-ties-to-even.v1";

/// The unit a literal factor of `mul` takes: a pure number, which `mul` spells into its product.
const RATIO_UNIT: &str = "RATIO";
/// The unit of a `count_while` state.
const BARS_UNIT: &str = "BARS";
/// The scale a quotient is rounded to: Market Data's own value scale.
const QUOTIENT_SCALE: u8 = 9;
/// The longest window, lag or period a definition may name.
const MAX_WINDOW: u32 = 1_000;
/// The fuel a compiled program may burn in one invocation.
const AUTHORED_MAX_FUEL: u64 = 10_000_000;
/// Source and Wasm byte ceilings, fixed by the language version.
const MAX_SOURCE_BYTES: u32 = 1_048_576;
const MAX_WASM_BYTES: u32 = 4_194_304;

/// A strategy document.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StrategyAuthoringDocumentV1 {
    /// Always [`STRATEGY_AUTHORING_LANGUAGE_V1`].
    pub language: String,
    pub inputs: Vec<AuthoringInputV1>,
    pub definitions: Vec<AuthoringDefinitionV1>,
    #[serde(default)]
    pub states: Vec<AuthoringStateV1>,
    pub rules: Vec<AuthoringRuleV1>,
    pub otherwise: AuthoringOtherwiseV1,
    /// The statement this strategy can be wrong about.
    pub falsifier: String,
}

/// One input: a BAR field of the Research scope's member, under a name of the author's choosing.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AuthoringInputV1 {
    pub name: String,
    pub field: AuthoringFieldV1,
}

/// The BAR fields a document reads.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuthoringFieldV1 {
    Open,
    High,
    Low,
    Close,
    /// The bar's traded quantity, a `QUANTITY` rather than a `PRICE`.
    Volume,
}

impl AuthoringFieldV1 {
    const fn field_semantic_id(self) -> &'static str {
        match self {
            Self::Open => "MARKET_DATA.BAR.OPEN.PRICE.V1",
            Self::High => "MARKET_DATA.BAR.HIGH.PRICE.V1",
            Self::Low => "MARKET_DATA.BAR.LOW.PRICE.V1",
            Self::Close => "MARKET_DATA.BAR.CLOSE.PRICE.V1",
            Self::Volume => "MARKET_DATA.BAR.VOLUME.QUANTITY.V1",
        }
    }
}

/// One named definition.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AuthoringDefinitionV1 {
    pub name: String,
    pub expr: AuthoringExpressionV1,
}

/// What a definition computes. An operand is a name, or a decimal literal.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "op", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum AuthoringExpressionV1 {
    /// The value `bars` ticks ago.
    Ago {
        of: String,
        bars: u32,
    },
    /// The highest value over the last `window` ticks, this one included.
    Max {
        of: String,
        window: u32,
    },
    /// The lowest value over the last `window` ticks, this one included.
    Min {
        of: String,
        window: u32,
    },
    /// Wilder's average true range over the four inputs, its first sample the true range.
    Atr {
        period: u32,
    },
    Add {
        a: String,
        b: String,
    },
    Sub {
        a: String,
        b: String,
    },
    Mul {
        a: String,
        b: String,
    },
    /// `a / b`, both names, at scale 9 rounded to nearest with ties to even; its unit is `a`'s over
    /// `b`'s, so a ratio of one unit is `X/X`.
    Div {
        a: String,
        b: String,
    },
    Compare {
        a: String,
        predicate: BoundedFeaturePredicateV1,
        b: String,
    },
    AllOf {
        of: Vec<String>,
    },
    AnyOf {
        of: Vec<String>,
    },
    Not {
        of: String,
    },
}

/// One named state.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AuthoringStateV1 {
    pub name: String,
    pub kind: AuthoringStateKindV1,
}

/// What a state holds.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum AuthoringStateKindV1 {
    /// True from the tick `set` holds until the tick `reset` holds; `reset` wins a tick where both
    /// hold.
    Latch { set: String, reset: String },
    /// The number of consecutive ticks `condition` has held, 0 when it does not.
    CountWhile { condition: String },
    /// The number `value` was at the last tick `when` held, 0 before `when` first holds.
    Capture { value: String, when: String },
}

/// One rule: the first rule whose `when` holds decides the tick.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AuthoringRuleV1 {
    pub name: String,
    pub when: String,
    pub action: AuthoringActionV1,
}

/// What a rule proposes.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "intent",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum AuthoringActionV1 {
    /// Open a position of `units` on `side` from flat.
    ///
    /// `stop_loss` is refused: replay judges no order inside a bar, so slice 1 states a stop as a
    /// rule that compares the bar against a captured level and exits at the close.
    Enter {
        side: AuthoringSideV1,
        units: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_loss: Option<String>,
    },
    /// Reverse a held position through zero to `units` on `side`, in one order.
    Flip { side: AuthoringSideV1, units: i64 },
    /// Leave the position.
    Exit,
}

/// The direction of an entry.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuthoringSideV1 {
    Long,
    Short,
}

/// What the program proposes when no rule holds.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "intent",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum AuthoringOtherwiseV1 {
    Hold,
}

/// Why a document was not compiled, named at its document path.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
#[error("{code} at {path}")]
pub struct StrategyAuthoringErrorV1 {
    /// The refusal's stable name.
    pub code: &'static str,
    /// Where in the document, such as `definitions.high50.expr.of`.
    pub path: String,
}

fn refuse<T>(code: &'static str, path: impl Into<String>) -> Result<T, StrategyAuthoringErrorV1> {
    Err(StrategyAuthoringErrorV1 {
        code,
        path: path.into(),
    })
}

/// A compiled value: a fixed-point number, or a boolean.
#[derive(Clone, Debug)]
enum Value {
    Fixed {
        reference: BoundedFeatureValueRefV1,
        unit: String,
        scale: u8,
        /// Whether a node reading it must require it ready.
        warming: bool,
        /// The one input role it derives from, if it derives from exactly one.
        role: Option<String>,
    },
    Boolean {
        reference: BoundedFeatureValueRefV1,
    },
}

impl Value {
    fn binding(&self, port: &str) -> BoundedFeatureInputBindingV1 {
        let (reference, warming) = match self {
            Self::Fixed {
                reference, warming, ..
            } => (reference.clone(), *warming),
            Self::Boolean { reference } => (reference.clone(), false),
        };
        BoundedFeatureInputBindingV1 {
            port_id: port.to_owned(),
            source: reference,
            require_ready: warming,
        }
    }
}

/// What a name refers to.
#[derive(Clone, Copy)]
enum NameKind<'a> {
    Input(&'a AuthoringInputV1),
    Definition(&'a AuthoringDefinitionV1),
    State(&'a AuthoringStateV1),
    Rule(usize),
}

struct Compiler<'a> {
    document: &'a StrategyAuthoringDocumentV1,
    names: BTreeMap<&'a str, NameKind<'a>>,
    roles: BTreeMap<&'a str, InputRoleV2>,
    fields: BTreeMap<AuthoringFieldV1, &'a str>,
    graph: Graph,
    values: BTreeMap<String, Value>,
    visiting: BTreeSet<String>,
    used: BTreeSet<String>,
    /// States read whose writers are not yet emitted. A read needs only the prior value; the
    /// writer reads this tick's values, rules included, so it is emitted once the rules are.
    pending_writers: Vec<&'a AuthoringStateV1>,
}

/// Compiles a document for one Research request and Intent into the `design` and `meaning` pair.
///
/// The document is read over the one member of the Research scope's universe: each input becomes a
/// universe-member role reading that BAR field at `timeframe`, the bar label Market Data declares
/// for the run's execution timeframe. The pair is derived and prepared against the newest
/// published catalog before it is returned.
///
/// # Errors
///
/// Returns the refusal and the document path it is at.
pub fn author_strategy_document_v1(
    document: &StrategyAuthoringDocumentV1,
    research_request_identity: BindingDigest,
    intent_identity: BindingDigest,
    intent_digest: BindingDigest,
    timeframe: &str,
) -> Result<(StrategyDesignV2, BoundedFeatureProgramMeaningV1), StrategyAuthoringErrorV1> {
    if document.language != STRATEGY_AUTHORING_LANGUAGE_V1 {
        return refuse("AUTHORING_LANGUAGE_UNKNOWN", "language");
    }

    if document.falsifier.trim().is_empty() || document.falsifier.trim() != document.falsifier {
        return refuse("NAME_UNKNOWN", "falsifier");
    }
    let mut compiler = Compiler::new(document, timeframe)?;
    let table = compiler.compile_rules()?;
    compiler.emit_writers()?;
    compiler.check_used()?;

    let received = document
        .inputs
        .iter()
        .map(|input| {
            (
                compiler.roles[input.name.as_str()].clone(),
                value_port(&input.name),
            )
        })
        .collect::<Vec<_>>();
    let carried = document
        .inputs
        .iter()
        .filter(|input| !compiler.used.contains(&input.name))
        .map(|input| compiler.roles[input.name.as_str()].semantic_id.clone())
        .collect::<Vec<_>>();
    let inputs = document
        .inputs
        .iter()
        .map(|input| {
            let role = compiler.roles[input.name.as_str()].semantic_id.clone();
            BoundedFeatureInputMeaningV1 {
                role_semantic_id: role.clone(),
                value_port_semantic_id: value_port(&input.name),
                update_clock: BoundedFeatureClockV1::Trigger {
                    input_role_id: role,
                },
            }
        })
        .collect();
    let state_bytes = compiler
        .graph
        .state_cells
        .iter()
        .map(|cell| cell.max_bytes)
        .sum::<u32>()
        .max(16);
    let design = bounded_feature_design_v1(&BoundedFeatureDesignSpecV1 {
        research_request_identity,
        intent_identity,
        intent_digest,
        received,
        bar_triggered: true,
        state_max_bytes: state_bytes,
        max_fuel: AUTHORED_MAX_FUEL,
        falsifier: &document.falsifier,
    });
    let Graph {
        nodes,
        state_cells,
        constants,
    } = compiler.graph;
    let mut meaning = BoundedFeatureProgramMeaningV1 {
        plugin_semantic_id: PLUGIN_SEMANTIC_ID.to_owned(),
        inputs,
        constants: constants
            .into_iter()
            .map(|(constant_id, value)| BoundedFeatureConstantV1 { constant_id, value })
            .collect(),
        state_cells,
        nodes,
        proposal_decision_table: table,
        warmup: neutral_warmup(),
        graph_bounds: BoundedFeatureGraphBoundsV1 {
            max_nodes: u16::MAX,
            max_edges: u16::MAX,
            max_depth: u16::MAX,
            max_ports: u16::MAX,
            max_constants: u16::MAX,
            max_fan_out: u16::MAX,
            max_lag: MAX_WINDOW,
            max_window: MAX_WINDOW,
            max_state_cells: u16::MAX,
            max_decision_branches: u16::MAX,
            max_source_bytes: MAX_SOURCE_BYTES,
            max_wasm_bytes: MAX_WASM_BYTES,
        },
        carried_input_role_ids: carried,
    };
    meaning.graph_bounds = measured_bounds(&design, &meaning)?;
    self_check(&design, &meaning)?;
    Ok((design, meaning))
}

/// The plugin input port a named input arrives on.
fn value_port(name: &str) -> String {
    format!("input.{name}.v1")
}

/// The Design role a named input becomes.
fn role_id(name: &str) -> String {
    format!("research.input.{name}.v1")
}

/// A name a document may use: a lower-case letter, then lower-case letters, digits or `_`.
fn valid_name(name: &str) -> bool {
    let mut characters = name.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_lowercase())
        && characters.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
        && name.len() <= 64
}

impl<'a> Compiler<'a> {
    fn new(
        document: &'a StrategyAuthoringDocumentV1,
        timeframe: &str,
    ) -> Result<Self, StrategyAuthoringErrorV1> {
        let mut names = BTreeMap::new();
        let mut roles = BTreeMap::new();
        let mut fields = BTreeMap::new();
        let mut declare = |name: &'a str, kind: NameKind<'a>, path: String| {
            if !valid_name(name) {
                return refuse("NAME_UNKNOWN", path);
            }

            if names.insert(name, kind).is_some() {
                return refuse("NAME_DUPLICATED", path);
            }
            Ok(())
        };

        for input in &document.inputs {
            declare(
                &input.name,
                NameKind::Input(input),
                format!("inputs.{}", input.name),
            )?;

            if fields.insert(input.field, input.name.as_str()).is_some() {
                return refuse("INPUT_FIELD_REPEATED", format!("inputs.{}", input.name));
            }
            roles.insert(
                input.name.as_str(),
                universe_member_role_v2(
                    &role_id(&input.name),
                    input.field.field_semantic_id(),
                    timeframe,
                ),
            );
        }

        for definition in &document.definitions {
            declare(
                &definition.name,
                NameKind::Definition(definition),
                format!("definitions.{}", definition.name),
            )?;
        }

        for state in &document.states {
            declare(
                &state.name,
                NameKind::State(state),
                format!("states.{}", state.name),
            )?;
        }

        for (index, rule) in document.rules.iter().enumerate() {
            declare(
                &rule.name,
                NameKind::Rule(index),
                format!("rules.{}", rule.name),
            )?;
        }

        if !fields.contains_key(&AuthoringFieldV1::Close) {
            return refuse("CLOSE_INPUT_REQUIRED", "inputs");
        }

        if document.rules.is_empty() {
            return refuse("RULES_REQUIRED", "rules");
        }
        Ok(Self {
            document,
            names,
            roles,
            fields,
            graph: Graph::default(),
            values: BTreeMap::new(),
            visiting: BTreeSet::new(),
            used: BTreeSet::new(),
            pending_writers: Vec::new(),
        })
    }

    /// Every definition must be read by a rule or a state.
    fn check_used(&self) -> Result<(), StrategyAuthoringErrorV1> {
        for definition in &self.document.definitions {
            if !self.used.contains(&definition.name) {
                return refuse(
                    "DEFINITION_UNUSED",
                    format!("definitions.{}", definition.name),
                );
            }
        }

        for state in &self.document.states {
            if !self.used.contains(&state.name) {
                return refuse("DEFINITION_UNUSED", format!("states.{}", state.name));
            }
        }
        Ok(())
    }

    /// The value an operand names: a name, or a literal typed by the operand beside it.
    fn operand(
        &mut self,
        operand: &str,
        typed_by: Option<(&str, u8)>,
        path: &str,
    ) -> Result<Value, StrategyAuthoringErrorV1> {
        if operand.starts_with(|character: char| character.is_ascii_lowercase()) {
            return self.value(operand, path);
        }
        let Some((unit, scale)) = typed_by else {
            return refuse("UNIT_MISMATCH", path);
        };
        let coefficient =
            literal_at_scale(operand, scale).ok_or_else(|| StrategyAuthoringErrorV1 {
                code: "LITERAL_NOT_REPRESENTABLE",
                path: path.to_owned(),
            })?;
        let id = format!(
            "literal-{}-{coefficient}-{scale}",
            unit.to_ascii_lowercase().replace('*', "-")
        );
        Ok(Value::Fixed {
            reference: self.graph.fixed(&id, coefficient, unit, scale),
            unit: unit.to_owned(),
            scale,
            warming: false,
            role: None,
        })
    }

    /// The compiled value of a name.
    fn value(&mut self, name: &str, path: &str) -> Result<Value, StrategyAuthoringErrorV1> {
        let Some(kind) = self.names.get(name).copied() else {
            return refuse("NAME_UNKNOWN", path);
        };
        self.used.insert(name.to_owned());

        if let Some(value) = self.values.get(name) {
            return Ok(value.clone());
        }

        if !self.visiting.insert(name.to_owned()) {
            return refuse("DEFINITION_CYCLE", path);
        }
        let value = match kind {
            NameKind::Input(input) => {
                let role = self.roles[input.name.as_str()].clone();
                Value::Fixed {
                    reference: BoundedFeatureValueRefV1::InputValue {
                        input_role_id: role.semantic_id.clone(),
                    },
                    unit: role.unit.clone(),
                    scale: role.scale,
                    warming: false,
                    role: Some(role.semantic_id),
                }
            }
            NameKind::Definition(definition) => self.definition(definition)?,
            NameKind::State(state) => self.state_read(state)?,
            NameKind::Rule(index) => self.rule_selected(index)?,
        };
        self.visiting.remove(name);
        self.values.insert(name.to_owned(), value.clone());
        Ok(value)
    }

    fn fixed_operand(
        &mut self,
        name: &str,
        path: &str,
    ) -> Result<(Value, String, u8), StrategyAuthoringErrorV1> {
        let value = self.value(name, path)?;
        match &value {
            Value::Fixed { unit, scale, .. } => {
                let (unit, scale) = (unit.clone(), *scale);
                Ok((value, unit, scale))
            }
            Value::Boolean { .. } => refuse("UNIT_MISMATCH", path),
        }
    }

    fn boolean(
        &mut self,
        name: &str,
        path: &str,
    ) -> Result<BoundedFeatureValueRefV1, StrategyAuthoringErrorV1> {
        match self.value(name, path)? {
            Value::Boolean { reference } => Ok(reference),
            Value::Fixed { .. } => refuse("NOT_BOOLEAN", path),
        }
    }

    fn window(window: u32, path: &str) -> Result<u32, StrategyAuthoringErrorV1> {
        if (1..=MAX_WINDOW).contains(&window) {
            Ok(window)
        } else {
            refuse("WINDOW_OUT_OF_RANGE", path)
        }
    }

    fn definition(
        &mut self,
        definition: &AuthoringDefinitionV1,
    ) -> Result<Value, StrategyAuthoringErrorV1> {
        let name = definition.name.as_str();
        let path = format!("definitions.{name}.expr");
        match &definition.expr {
            AuthoringExpressionV1::Ago { of, bars } => {
                let bars = Self::window(*bars, &format!("{path}.bars"))?;
                let (source, unit, scale) = self.fixed_operand(of, &format!("{path}.of"))?;
                let Value::Fixed {
                    role: Some(role), ..
                } = &source
                else {
                    return refuse("AGO_NEEDS_ONE_INPUT", format!("{path}.of"));
                };
                let role = role.clone();
                // The coordinate names a sample of the clock that steps the lag, which is the
                // CLOSE role's for every stateful node here, whichever input the lag reads.
                let identity = strategy_input_role_identity_v2(
                    &self.roles[self.fields[&AuthoringFieldV1::Close]],
                );
                let parameters = BoundedFeatureParametersV1::Lag {
                    offset: bars,
                    declared_max_lag: bars,
                };
                self.primitive(
                    name,
                    LAG,
                    vec![source.binding("value")],
                    parameters,
                    CatalogStateRuleV1::Window,
                    vec![
                        BoundedFeatureOutputPortV1 {
                            port_id: "coordinate".to_owned(),
                            value_type: BoundedFeatureValueTypeV1::OwnerSampleCoordinate {
                                input_role_identity: identity,
                            },
                            availability: BoundedFeatureAvailabilityV1::WarmingReady,
                        },
                        BoundedFeatureOutputPortV1 {
                            port_id: VALUE_PORT.to_owned(),
                            value_type: fixed_type(&unit, scale),
                            availability: BoundedFeatureAvailabilityV1::WarmingReady,
                        },
                    ],
                )?;
                Ok(Value::Fixed {
                    reference: node_value(name),
                    unit,
                    scale,
                    warming: true,
                    role: Some(role),
                })
            }
            AuthoringExpressionV1::Max { of, window }
            | AuthoringExpressionV1::Min { of, window } => {
                let primitive = if matches!(definition.expr, AuthoringExpressionV1::Max { .. }) {
                    ROLLING_MAX
                } else {
                    ROLLING_MIN
                };
                let window = Self::window(*window, &format!("{path}.window"))?;
                let (source, unit, scale) = self.fixed_operand(of, &format!("{path}.of"))?;
                let role = match &source {
                    Value::Fixed { role, .. } => role.clone(),
                    Value::Boolean { .. } => None,
                };
                self.primitive(
                    name,
                    primitive,
                    vec![source.binding("value")],
                    BoundedFeatureParametersV1::Window {
                        window,
                        rounding: None,
                    },
                    CatalogStateRuleV1::Window,
                    vec![BoundedFeatureOutputPortV1 {
                        port_id: VALUE_PORT.to_owned(),
                        value_type: fixed_type(&unit, scale),
                        availability: BoundedFeatureAvailabilityV1::WarmingReady,
                    }],
                )?;
                Ok(Value::Fixed {
                    reference: node_value(name),
                    unit,
                    scale,
                    warming: true,
                    role,
                })
            }
            AuthoringExpressionV1::Atr { period } => {
                let period = Self::window(*period, &format!("{path}.period"))?;
                let mut bindings = Vec::new();
                let mut price = None;

                for (field, port) in [
                    (AuthoringFieldV1::Close, "close"),
                    (AuthoringFieldV1::High, "high"),
                    (AuthoringFieldV1::Low, "low"),
                    (AuthoringFieldV1::Open, "open"),
                ] {
                    let Some(input) = self.fields.get(&field).copied() else {
                        return refuse("ATR_INPUTS_REQUIRED", path);
                    };
                    let (value, unit, scale) = self.fixed_operand(input, &path)?;
                    bindings.push(value.binding(port));
                    price.get_or_insert((unit, scale));
                }
                let (unit, scale) = price.expect("the four inputs were read");
                self.primitive(
                    name,
                    ATR,
                    bindings,
                    BoundedFeatureParametersV1::Period {
                        period,
                        rounding: Some(BoundedFeatureRoundingV1::NearestTiesToEven),
                    },
                    CatalogStateRuleV1::Bar,
                    vec![BoundedFeatureOutputPortV1 {
                        port_id: VALUE_PORT.to_owned(),
                        value_type: fixed_type(&unit, scale),
                        availability: BoundedFeatureAvailabilityV1::Ready,
                    }],
                )?;
                Ok(Value::Fixed {
                    reference: node_value(name),
                    unit,
                    scale,
                    warming: false,
                    role: None,
                })
            }
            AuthoringExpressionV1::Add { a, b } | AuthoringExpressionV1::Sub { a, b } => {
                let primitive = if matches!(definition.expr, AuthoringExpressionV1::Add { .. }) {
                    ADD
                } else {
                    SUB
                };
                let (a, b) = self.aligned(name, a, b, &path)?;
                let (unit, scale) = fixed_unit_scale(&a);
                Ok(Value::Fixed {
                    reference: self.graph.arithmetic_over(
                        name,
                        primitive,
                        bound(&a),
                        bound(&b),
                        &unit,
                        scale,
                    ),
                    unit,
                    scale,
                    warming: false,
                    role: None,
                })
            }
            AuthoringExpressionV1::Mul { a, b } => {
                // A literal is a pure factor in `RATIO` at its own decimal places, and it is always
                // the second operand, so a product is spelled one way whichever side it was written.
                let (named, literal) = match (is_literal(a), is_literal(b)) {
                    (false, true) => (a, Some(b)),
                    (true, false) => (b, Some(a)),
                    (false, false) => (a, None),
                    (true, true) => return refuse("UNIT_MISMATCH", path),
                };
                let (left, unit_a, scale_a) = self.fixed_operand(named, &format!("{path}.a"))?;
                let (right, unit_b, scale_b) = match literal {
                    Some(literal) => {
                        let places =
                            decimal_places(literal).ok_or_else(|| StrategyAuthoringErrorV1 {
                                code: "LITERAL_NOT_REPRESENTABLE",
                                path: format!("{path}.b"),
                            })?;
                        let value = self.operand(
                            literal,
                            Some((RATIO_UNIT, places)),
                            &format!("{path}.b"),
                        )?;
                        (value, RATIO_UNIT.to_owned(), places)
                    }
                    None => self.fixed_operand(b, &format!("{path}.b"))?,
                };
                let scale = scale_a
                    .checked_add(scale_b)
                    .filter(|scale| *scale <= 38)
                    .ok_or_else(|| StrategyAuthoringErrorV1 {
                        code: "LITERAL_NOT_REPRESENTABLE",
                        path: path.clone(),
                    })?;
                let unit = format!("{unit_a}*{unit_b}");
                Ok(Value::Fixed {
                    reference: self.graph.arithmetic_over(
                        name,
                        MUL,
                        bound(&left),
                        bound(&right),
                        &unit,
                        scale,
                    ),
                    unit,
                    scale,
                    warming: false,
                    role: None,
                })
            }
            AuthoringExpressionV1::Div { a, b } => {
                for (operand, port) in [(a, "a"), (b, "b")] {
                    if is_literal(operand) {
                        return refuse("UNIT_MISMATCH", format!("{path}.{port}"));
                    }
                }
                let (left, unit_a, _) = self.fixed_operand(a, &format!("{path}.a"))?;
                let (right, unit_b, _) = self.fixed_operand(b, &format!("{path}.b"))?;
                let unit = format!("{unit_a}/{unit_b}");
                Ok(Value::Fixed {
                    reference: self.graph.arithmetic_over(
                        name,
                        DIV,
                        bound(&left),
                        bound(&right),
                        &unit,
                        QUOTIENT_SCALE,
                    ),
                    unit,
                    scale: QUOTIENT_SCALE,
                    warming: false,
                    role: None,
                })
            }
            AuthoringExpressionV1::Compare { a, predicate, b } => {
                let (a, b) = self.aligned(name, a, b, &path)?;
                let node = BoundedFeatureNodeV1 {
                    node_id: name.to_owned(),
                    primitive_semantic_id: COMPARE.to_owned(),
                    input_bindings: vec![a.binding("a"), b.binding("b")],
                    output_ports: vec![BoundedFeatureOutputPortV1 {
                        port_id: VALUE_PORT.to_owned(),
                        value_type: BoundedFeatureValueTypeV1::Boolean,
                        availability: BoundedFeatureAvailabilityV1::Ready,
                    }],
                    parameters: BoundedFeatureParametersV1::ComparisonPredicate {
                        predicate: *predicate,
                    },
                    state_id: None,
                    update_clock: None,
                };
                self.graph.nodes.push(node);
                Ok(Value::Boolean {
                    reference: node_value(name),
                })
            }
            AuthoringExpressionV1::AllOf { of } | AuthoringExpressionV1::AnyOf { of } => {
                let all = matches!(definition.expr, AuthoringExpressionV1::AllOf { .. });

                if of.is_empty() {
                    return refuse("NAME_UNKNOWN", format!("{path}.of"));
                }
                let conditions = of
                    .iter()
                    .enumerate()
                    .map(|(index, operand)| self.boolean(operand, &format!("{path}.of.{index}")))
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(Value::Boolean {
                    reference: self.combine(name, &conditions, all),
                })
            }
            AuthoringExpressionV1::Not { of } => {
                let condition = self.boolean(of, &format!("{path}.of"))?;
                Ok(Value::Boolean {
                    reference: self.negate(name, condition),
                })
            }
        }
    }

    /// Emits a stateful catalog primitive with its own state cell.
    fn primitive(
        &mut self,
        name: &str,
        primitive: &str,
        bindings: Vec<BoundedFeatureInputBindingV1>,
        parameters: BoundedFeatureParametersV1,
        rule: CatalogStateRuleV1,
        output_ports: Vec<BoundedFeatureOutputPortV1>,
    ) -> Result<(), StrategyAuthoringErrorV1> {
        let state_id = format!("{name}-state");
        let max_bytes = expected_state_bytes(rule, &parameters, &unbounded()).map_err(|_| {
            StrategyAuthoringErrorV1 {
                code: "WINDOW_OUT_OF_RANGE",
                path: format!("definitions.{name}"),
            }
        })?;
        self.graph.nodes.push(BoundedFeatureNodeV1 {
            node_id: name.to_owned(),
            primitive_semantic_id: primitive.to_owned(),
            input_bindings: bindings,
            output_ports,
            parameters,
            state_id: Some(state_id.clone()),
            // Every stateful primitive advances once per tick of the program's clock, which is its
            // `CLOSE` input.
            update_clock: Some(BoundedFeatureClockV1::Trigger {
                input_role_id: self.roles[self.fields[&AuthoringFieldV1::Close]]
                    .semantic_id
                    .clone(),
            }),
        });
        self.graph.state_cells.push(BoundedFeatureStateCellV1 {
            state_id,
            writer_node_id: name.to_owned(),
            state_kind: BoundedFeatureStateKindV1::Primitive,
            initial: BoundedFeatureInitialStateV1::CanonicalEmpty,
            max_bytes,
        });
        Ok(())
    }

    /// Brings two operands to one unit and scale.
    ///
    /// Units are syntactic products, so a `PRICE` and a `PRICE*RATIO` meet by multiplying the
    /// first by exactly 1 in `RATIO`; scales meet by rescaling the coarser up, which is exact.
    fn aligned(
        &mut self,
        name: &str,
        a: &str,
        b: &str,
        path: &str,
    ) -> Result<(Value, Value), StrategyAuthoringErrorV1> {
        let (a_literal, b_literal) = (is_literal(a), is_literal(b));
        if a_literal && b_literal {
            return refuse("UNIT_MISMATCH", path);
        }

        if a_literal || b_literal {
            let (named, literal, named_first) = if a_literal {
                (b, a, false)
            } else {
                (a, b, true)
            };
            let (value, unit, scale) = self.fixed_operand(
                named,
                &format!("{path}.{}", if named_first { "a" } else { "b" }),
            )?;
            let literal = self.operand(
                literal,
                Some((&unit, scale)),
                &format!("{path}.{}", if named_first { "b" } else { "a" }),
            )?;
            return Ok(if named_first {
                (value, literal)
            } else {
                (literal, value)
            });
        }
        let (mut a, mut unit_a, mut scale_a) = self.fixed_operand(a, &format!("{path}.a"))?;
        let (mut b, mut unit_b, mut scale_b) = self.fixed_operand(b, &format!("{path}.b"))?;

        while unit_a != unit_b {
            if unit_b.starts_with(&format!("{unit_a}*")) {
                a = self.lift_ratio(&format!("{name}-lift-a"), &a, &unit_a, scale_a);
                unit_a = format!("{unit_a}*{RATIO_UNIT}");
            } else if unit_a.starts_with(&format!("{unit_b}*")) {
                b = self.lift_ratio(&format!("{name}-lift-b"), &b, &unit_b, scale_b);
                unit_b = format!("{unit_b}*{RATIO_UNIT}");
            } else {
                return refuse("UNIT_MISMATCH", path);
            }
        }

        if scale_a < scale_b {
            a = self.rescale(&format!("{name}-rescale-a"), &a, &unit_a, scale_b);
            scale_a = scale_b;
        } else if scale_b < scale_a {
            b = self.rescale(&format!("{name}-rescale-b"), &b, &unit_b, scale_a);
            scale_b = scale_a;
        }
        let _ = (scale_a, scale_b);
        Ok((a, b))
    }

    fn lift_ratio(&mut self, id: &str, value: &Value, unit: &str, scale: u8) -> Value {
        let one = self.graph.fixed("ratio-one", 1, RATIO_UNIT, 0);
        let lifted = format!("{unit}*{RATIO_UNIT}");
        let mut node_id = id.to_owned();
        while self.graph.nodes.iter().any(|node| node.node_id == node_id) {
            node_id.push('x');
        }
        Value::Fixed {
            reference: self
                .graph
                .arithmetic(&node_id, MUL, reference(value), one, &lifted, scale),
            unit: lifted,
            scale,
            warming: false,
            role: None,
        }
    }

    fn rescale(&mut self, id: &str, value: &Value, unit: &str, scale: u8) -> Value {
        let node = BoundedFeatureNodeV1 {
            node_id: id.to_owned(),
            primitive_semantic_id: RESCALE.to_owned(),
            input_bindings: vec![value.binding("value")],
            output_ports: vec![BoundedFeatureOutputPortV1 {
                port_id: VALUE_PORT.to_owned(),
                value_type: fixed_type(unit, scale),
                availability: BoundedFeatureAvailabilityV1::Ready,
            }],
            parameters: BoundedFeatureParametersV1::OutputScale {
                output_scale: scale,
                rounding: BoundedFeatureRoundingV1::NearestTiesToEven,
            },
            state_id: None,
            update_clock: None,
        };
        self.graph.nodes.push(node);
        Value::Fixed {
            reference: node_value(id),
            unit: unit.to_owned(),
            scale,
            warming: false,
            role: None,
        }
    }

    /// 1 when the boolean holds, 0 otherwise.
    fn signal_of(
        &mut self,
        id: &str,
        condition: BoundedFeatureValueRefV1,
    ) -> BoundedFeatureValueRefV1 {
        let one = self.graph.signal(1);
        let zero = self.graph.signal(0);
        self.graph
            .select(id, condition, one, zero, fixed_type(SIGNAL_UNIT, 0))
    }

    fn combine(
        &mut self,
        name: &str,
        conditions: &[BoundedFeatureValueRefV1],
        all: bool,
    ) -> BoundedFeatureValueRefV1 {
        let zero = self.graph.signal(0);
        let one = self.graph.signal(1);
        let mut accumulated = if all { one } else { zero.clone() };

        for (index, condition) in conditions.iter().enumerate().rev() {
            let id = format!("{name}-{index}");
            accumulated = if all {
                self.graph.select(
                    &id,
                    condition.clone(),
                    accumulated,
                    zero.clone(),
                    fixed_type(SIGNAL_UNIT, 0),
                )
            } else {
                let one = self.graph.signal(1);
                self.graph.select(
                    &id,
                    condition.clone(),
                    one,
                    accumulated,
                    fixed_type(SIGNAL_UNIT, 0),
                )
            };
        }
        self.graph.holds(name, accumulated)
    }

    fn negate(
        &mut self,
        name: &str,
        condition: BoundedFeatureValueRefV1,
    ) -> BoundedFeatureValueRefV1 {
        let signal = self.signal_of(&format!("{name}-signal"), condition);
        let zero = self.graph.signal(0);
        self.graph
            .compare(name, signal, zero, BoundedFeaturePredicateV1::Equal)
    }

    /// A state read: its value at the previous tick. The state's cell is declared here and its
    /// writer later, in [`Self::emit_writers`].
    fn state_read(
        &mut self,
        state: &'a AuthoringStateV1,
    ) -> Result<Value, StrategyAuthoringErrorV1> {
        let name = state.name.as_str();
        self.pending_writers.push(state);
        Ok(match &state.kind {
            AuthoringStateKindV1::Latch { .. } => {
                let zero = self.graph.signal(0);
                self.graph.cell(
                    name,
                    &format!("{name}-next"),
                    fixed_type(SIGNAL_UNIT, 0),
                    "signal-zero",
                );
                let held = self.graph.compare(
                    &format!("{name}-held"),
                    prior_state(name),
                    zero,
                    BoundedFeaturePredicateV1::Greater,
                );
                Value::Boolean { reference: held }
            }
            AuthoringStateKindV1::Capture { value, .. } => {
                let (_, unit, scale) =
                    self.fixed_operand(value, &format!("states.{name}.kind.value"))?;
                let initial = format!("{name}-initial");
                self.graph.fixed(&initial, 0, &unit, scale);
                self.graph.cell(
                    name,
                    &format!("{name}-next"),
                    fixed_type(&unit, scale),
                    &initial,
                );
                Value::Fixed {
                    reference: prior_state(name),
                    unit,
                    scale,
                    warming: false,
                    role: None,
                }
            }
            AuthoringStateKindV1::CountWhile { .. } => {
                self.graph.fixed("bars-none", 0, BARS_UNIT, 0);
                self.graph.cell(
                    name,
                    &format!("{name}-next"),
                    fixed_type(BARS_UNIT, 0),
                    "bars-none",
                );
                Value::Fixed {
                    reference: prior_state(name),
                    unit: BARS_UNIT.to_owned(),
                    scale: 0,
                    warming: false,
                    role: None,
                }
            }
        })
    }

    /// Emits the writer of every state read, until no writer reads a state not yet written.
    fn emit_writers(&mut self) -> Result<(), StrategyAuthoringErrorV1> {
        let mut written = BTreeSet::new();
        while let Some(state) = self.pending_writers.pop() {
            if !written.insert(state.name.clone()) {
                continue;
            }
            let name = state.name.as_str();
            let path = format!("states.{name}.kind");
            match &state.kind {
                AuthoringStateKindV1::Latch { set, reset } => {
                    let zero = self.graph.signal(0);
                    let one = self.graph.signal(1);
                    let set = self.boolean(set, &format!("{path}.set"))?;
                    let reset = self.boolean(reset, &format!("{path}.reset"))?;
                    let after_set = self.graph.select(
                        &format!("{name}-after-set"),
                        set,
                        one,
                        prior_state(name),
                        fixed_type(SIGNAL_UNIT, 0),
                    );
                    self.graph.select(
                        &format!("{name}-next"),
                        reset,
                        zero,
                        after_set,
                        fixed_type(SIGNAL_UNIT, 0),
                    );
                }
                AuthoringStateKindV1::Capture { value, when } => {
                    let (value, unit, scale) =
                        self.fixed_operand(value, &format!("{path}.value"))?;
                    let when = self.boolean(when, &format!("{path}.when"))?;
                    self.graph.select(
                        &format!("{name}-next"),
                        when,
                        reference(&value),
                        prior_state(name),
                        fixed_type(&unit, scale),
                    );
                }
                AuthoringStateKindV1::CountWhile { condition } => {
                    let none = self.graph.fixed("bars-none", 0, BARS_UNIT, 0);
                    let bar = self.graph.fixed("bar-one", 1, BARS_UNIT, 0);
                    let condition = self.boolean(condition, &format!("{path}.condition"))?;
                    let counted = self.graph.arithmetic(
                        &format!("{name}-plus-one"),
                        ADD,
                        prior_state(name),
                        bar,
                        BARS_UNIT,
                        0,
                    );
                    self.graph.select(
                        &format!("{name}-next"),
                        condition,
                        counted,
                        none,
                        fixed_type(BARS_UNIT, 0),
                    );
                }
            }
        }
        Ok(())
    }

    /// "Rule `index` was selected this tick": its condition and no earlier rule's.
    fn rule_selected(&mut self, index: usize) -> Result<Value, StrategyAuthoringErrorV1> {
        let rules = &self.document.rules;
        let name = rules[index].name.clone();
        let mut conditions = Vec::new();

        for earlier in &rules[..index] {
            let condition = self.boolean(&earlier.when, &format!("rules.{}.when", earlier.name))?;
            conditions.push(self.negate(&format!("{name}-not-{}", earlier.name), condition));
        }
        let condition = self.boolean(&rules[index].when, &format!("rules.{name}.when"))?;
        conditions.insert(0, condition);
        let reference = if conditions.len() == 1 {
            conditions.remove(0)
        } else {
            self.combine(&format!("{name}-selected"), &conditions, true)
        };
        Ok(Value::Boolean { reference })
    }

    /// The decision table: one branch per rule in order, `otherwise` the default.
    fn compile_rules(
        &mut self,
    ) -> Result<BoundedFeatureProposalDecisionTableV1, StrategyAuthoringErrorV1> {
        let rules = self.document.rules.clone();
        let mut branches = Vec::new();

        for (index, rule) in rules.iter().enumerate() {
            let path = format!("rules.{}", rule.name);
            let predicate = self.boolean(&rule.when, &format!("{path}.when"))?;
            let frame = match &rule.action {
                AuthoringActionV1::Enter {
                    side,
                    units,
                    stop_loss,
                } => {
                    if stop_loss.is_some() {
                        return refuse(
                            "PROTECTION_NOT_SUPPORTED_IN_SLICE_1",
                            format!("{path}.action.stop_loss"),
                        );
                    }
                    let target = signed_units(*side, *units, &path)?;
                    self.frame(&rule.name, FrameV1::Enter { target })
                }
                AuthoringActionV1::Flip { side, units } => {
                    let target = signed_units(*side, *units, &path)?;
                    self.frame(&rule.name, FrameV1::Flip { target })
                }
                AuthoringActionV1::Exit => self.frame(&rule.name, FrameV1::Exit),
            };
            branches.push(BoundedFeatureProposalDecisionBranchV1 {
                priority: u16::try_from(10 * (index + 1)).map_err(|_| {
                    StrategyAuthoringErrorV1 {
                        code: "RULES_REQUIRED",
                        path: path.clone(),
                    }
                })?,
                predicate,
                frame,
            });
        }
        let default_frame = self.frame("otherwise", FrameV1::Hold);
        Ok(BoundedFeatureProposalDecisionTableV1 {
            branches,
            default_frame,
        })
    }

    /// One frame's eleven terminals.
    fn frame(&mut self, id: &str, frame: FrameV1) -> BoundedFeatureProposalFrameV1 {
        let (intent, target_variant, target, protection) = match frame {
            FrameV1::Enter { target } => (
                "kernel.position.enter.v1",
                "kernel.target.position.v1",
                target,
                "kernel.protection.keep.v1",
            ),
            FrameV1::Flip { target } => (
                "kernel.position.flip.v1",
                "kernel.target.position.v1",
                target,
                "kernel.protection.clear.v1",
            ),
            FrameV1::Exit => (
                "kernel.position.exit.v1",
                "kernel.target.position.v1",
                0,
                "kernel.protection.clear.v1",
            ),
            FrameV1::Hold => (
                "kernel.position.hold.v1",
                "kernel.target.keep.v1",
                0,
                "kernel.protection.keep.v1",
            ),
        };
        let constant = |graph: &mut Graph, suffix: &str, value: BoundedFeatureConstantValueV1| {
            graph.constant(&format!("{id}-{suffix}"), value)
        };
        let intent_ref = constant(
            &mut self.graph,
            "position",
            BoundedFeatureConstantValueV1::PositionIntentV1 {
                semantic_id: intent.to_owned(),
            },
        );
        let target_variant_ref = constant(
            &mut self.graph,
            "target",
            BoundedFeatureConstantValueV1::TargetVariantV1 {
                semantic_id: target_variant.to_owned(),
            },
        );
        let target_ref = constant(
            &mut self.graph,
            "target-position",
            BoundedFeatureConstantValueV1::I64 { value: target },
        );
        let protection_ref = constant(
            &mut self.graph,
            "protection",
            BoundedFeatureConstantValueV1::ProtectionVariantV1 {
                semantic_id: protection.to_owned(),
            },
        );
        let weight = self.graph.constant(
            "target-weight",
            BoundedFeatureConstantValueV1::I32 { value: 0 },
        );
        let rebalance = self
            .graph
            .constant("rebalance", BoundedFeatureConstantValueV1::U64 { value: 0 });
        let no_tick = self
            .graph
            .constant("no-tick", BoundedFeatureConstantValueV1::I64 { value: 0 });
        let no_distance = self.graph.constant(
            "no-distance",
            BoundedFeatureConstantValueV1::U64 { value: 0 },
        );
        let terminal = |port: &str, lifecycle: &str, source: BoundedFeatureValueRefV1| {
            BoundedFeatureTerminalOutputV1 {
                manifest_port_id: port.to_owned(),
                lifecycle_semantic_id: lifecycle.to_owned(),
                source,
                conversion: BoundedFeatureTerminalConversionV1::Exact,
            }
        };
        BoundedFeatureProposalFrameV1 {
            terminal_outputs: vec![
                terminal("proposal.position-intent.v1", intent, intent_ref),
                terminal(
                    "proposal.target-variant.v1",
                    target_variant,
                    target_variant_ref,
                ),
                terminal(
                    "proposal.target-position.v1",
                    target_variant,
                    target_ref.clone(),
                ),
                terminal(
                    "proposal.target-weight.v1",
                    "kernel.target.weight.v1",
                    weight,
                ),
                terminal(
                    "proposal.rebalance-sequence.v1",
                    "kernel.target.rebalance.v1",
                    rebalance,
                ),
                terminal(
                    "proposal.reconciliation-target.v1",
                    target_variant,
                    target_ref,
                ),
                terminal("proposal.protection-variant.v1", protection, protection_ref),
                terminal(
                    "proposal.stop-loss.v1",
                    "kernel.protection.stop-loss.v1",
                    no_tick.clone(),
                ),
                terminal(
                    "proposal.take-profit.v1",
                    "kernel.protection.take-profit.v1",
                    no_tick.clone(),
                ),
                terminal(
                    "proposal.trailing-distance.v1",
                    "kernel.protection.trailing-adjust.v1",
                    no_distance,
                ),
                terminal(
                    "proposal.trailing-stop.v1",
                    "kernel.protection.trailing-adjust.v1",
                    no_tick,
                ),
            ],
        }
    }
}

/// What one frame proposes.
#[derive(Clone, Copy)]
enum FrameV1 {
    Enter { target: i64 },
    Flip { target: i64 },
    Exit,
    Hold,
}

/// A rule's units as the signed target position its side names.
fn signed_units(
    side: AuthoringSideV1,
    units: i64,
    path: &str,
) -> Result<i64, StrategyAuthoringErrorV1> {
    if units <= 0 {
        return refuse("LITERAL_NOT_REPRESENTABLE", format!("{path}.action.units"));
    }
    Ok(match side {
        AuthoringSideV1::Long => units,
        AuthoringSideV1::Short => -units,
    })
}

/// A value as an arithmetic input: its reference, and whether it is still warming.
fn bound(value: &Value) -> (BoundedFeatureValueRefV1, bool) {
    match value {
        Value::Fixed {
            reference, warming, ..
        } => (reference.clone(), *warming),
        Value::Boolean { reference } => (reference.clone(), false),
    }
}

fn reference(value: &Value) -> BoundedFeatureValueRefV1 {
    match value {
        Value::Fixed { reference, .. } | Value::Boolean { reference } => reference.clone(),
    }
}

fn fixed_unit_scale(value: &Value) -> (String, u8) {
    match value {
        Value::Fixed { unit, scale, .. } => (unit.clone(), *scale),
        Value::Boolean { .. } => (SIGNAL_UNIT.to_owned(), 0),
    }
}

fn is_literal(operand: &str) -> bool {
    !operand.starts_with(|character: char| character.is_ascii_lowercase())
}

/// The decimal places a literal is written with.
fn decimal_places(literal: &str) -> Option<u8> {
    let digits = literal.strip_prefix('-').unwrap_or(literal);
    let (whole, fraction) = digits.split_once('.').unwrap_or((digits, ""));

    if whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
        || (digits.contains('.') && fraction.is_empty())
    {
        return None;
    }
    u8::try_from(fraction.len())
        .ok()
        .filter(|places| *places <= 38)
}

/// A decimal literal as a coefficient at `scale`, when it is exact there.
fn literal_at_scale(literal: &str, scale: u8) -> Option<i128> {
    let places = decimal_places(literal)?;

    if places > scale {
        let (_, fraction) = literal.split_once('.')?;
        if !fraction[usize::from(scale)..]
            .bytes()
            .all(|byte| byte == b'0')
        {
            return None;
        }
    }
    let negative = literal.starts_with('-');
    let digits = literal.trim_start_matches('-');
    let (whole, fraction) = digits.split_once('.').unwrap_or((digits, ""));
    let mut fraction = fraction.to_owned();
    fraction.truncate(usize::from(scale));
    while fraction.len() < usize::from(scale) {
        fraction.push('0');
    }
    let magnitude = format!("{whole}{fraction}").parse::<i128>().ok()?;
    Some(if negative { -magnitude } else { magnitude })
}

/// Bounds no graph reaches, for measuring a graph before its own bounds are known.
fn unbounded() -> BoundedFeatureBoundsV1 {
    BoundedFeatureBoundsV1 {
        max_nodes: u16::MAX,
        max_edges: u16::MAX,
        max_depth: u16::MAX,
        max_ports: u16::MAX,
        max_constants: u16::MAX,
        max_fan_out: u16::MAX,
        max_lag: u32::MAX,
        max_window: u32::MAX,
        max_state_cells: u16::MAX,
        max_decision_branches: u16::MAX,
        max_state_bytes: u32::MAX,
        max_source_bytes: u32::MAX,
        max_wasm_bytes: u32::MAX,
        max_fuel: u64::MAX,
        max_linear_memory_bytes: u32::MAX,
        max_invocations_per_event: u16::MAX,
    }
}

fn neutral_warmup() -> BoundedFeatureWarmupContractV1 {
    BoundedFeatureWarmupContractV1 {
        position_intent_semantic_id: "kernel.position.hold.v1".to_owned(),
        target_variant_semantic_id: "kernel.target.keep.v1".to_owned(),
        target_position_units: 0,
        target_weight_micros: 0,
        rebalance_sequence: 0,
        reconciliation_target_units: 0,
        protection_variant_semantic_id: "kernel.protection.keep.v1".to_owned(),
        stop_loss_ticks: 0,
        take_profit_ticks: 0,
        trailing_distance_ticks: 0,
        trailing_stop_ticks: 0,
        post_state: BoundedFeatureWarmupPostStateV1::AdvancedCurrentEvent,
    }
}

fn catalog() -> Result<PrimitiveCatalogV1, StrategyAuthoringErrorV1> {
    PrimitiveCatalogV1::verify().map_err(|_| StrategyAuthoringErrorV1 {
        code: "NO_VERIFIED_PRIMITIVE_CATALOG",
        path: String::new(),
    })
}

/// The program's graph bounds: exactly its measured shape, a lag or window of 0 declared as 1.
fn measured_bounds(
    design: &StrategyDesignV2,
    meaning: &BoundedFeatureProgramMeaningV1,
) -> Result<BoundedFeatureGraphBoundsV1, StrategyAuthoringErrorV1> {
    let does_not_prepare = |error: String| StrategyAuthoringErrorV1 {
        code: "AUTHORED_PROGRAM_DOES_NOT_PREPARE",
        path: error,
    };
    let proposal = assemble_bounded_feature_program_for_self_check_v1(design, catalog()?, meaning)
        .map_err(|e| does_not_prepare(e.to_string()))?;
    let shape = measure_bounded_feature_program_shape_v1(proposal, design)
        .map_err(|e| does_not_prepare(e.to_string()))?;
    Ok(BoundedFeatureGraphBoundsV1 {
        max_nodes: shape.nodes,
        max_edges: shape.edges,
        max_depth: shape.depth,
        max_ports: shape.ports,
        max_constants: shape.constants,
        max_fan_out: shape.fan_out,
        max_lag: shape.lag.max(1),
        max_window: shape.window.max(1),
        max_state_cells: shape.state_cells.max(1),
        max_decision_branches: shape.decision_branches.max(1),
        max_source_bytes: MAX_SOURCE_BYTES,
        max_wasm_bytes: MAX_WASM_BYTES,
    })
}

/// Derives and prepares the compiled pair, so nothing is returned that `prepare` refuses.
fn self_check(
    design: &StrategyDesignV2,
    meaning: &BoundedFeatureProgramMeaningV1,
) -> Result<(), StrategyAuthoringErrorV1> {
    let does_not_prepare = |error: String| StrategyAuthoringErrorV1 {
        code: "AUTHORED_PROGRAM_DOES_NOT_PREPARE",
        path: error,
    };
    let proposal = assemble_bounded_feature_program_for_self_check_v1(design, catalog()?, meaning)
        .map_err(|e| does_not_prepare(e.to_string()))?;
    prepare_bounded_feature_program_v1(proposal, design)
        .map(|_| ())
        .map_err(|e| does_not_prepare(e.to_string()))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn t0() -> StrategyAuthoringDocumentV1 {
        serde_json::from_str(include_str!(
            "../test_data/strategy_authoring_v1/t0-daily-trend.json"
        ))
        .expect("the T0 document parses")
    }

    fn author(
        document: &StrategyAuthoringDocumentV1,
    ) -> Result<(StrategyDesignV2, BoundedFeatureProgramMeaningV1), StrategyAuthoringErrorV1> {
        let digest = BindingDigest::from_untrusted_bytes([7; 32]);
        author_strategy_document_v1(document, digest, digest, digest, "1D")
    }

    /// One change to T0, by the definition or state it names.
    fn t0_with(
        change: impl FnOnce(&mut StrategyAuthoringDocumentV1),
    ) -> StrategyAuthoringDocumentV1 {
        let mut document = t0();
        change(&mut document);
        document
    }

    fn set_expr(
        document: &mut StrategyAuthoringDocumentV1,
        name: &str,
        expr: AuthoringExpressionV1,
    ) {
        document
            .definitions
            .iter_mut()
            .find(|definition| definition.name == name)
            .expect("T0 defines it")
            .expr = expr;
    }

    /// Each refusal the compiler names, driven once, at the path it names.
    #[rstest]
    #[case::language(|d: &mut StrategyAuthoringDocumentV1| d.language = "research.strategy-authoring.v2".to_owned(), "AUTHORING_LANGUAGE_UNKNOWN", "language")]
    #[case::unknown_name(|d: &mut StrategyAuthoringDocumentV1| set_expr(d, "risk", AuthoringExpressionV1::Mul { a: "atr_14".to_owned(), b: "2".to_owned() }), "NAME_UNKNOWN", "definitions.risk.expr.a")]
    #[case::duplicated_name(|d: &mut StrategyAuthoringDocumentV1| d.definitions[1].name = "prior_close".to_owned(), "NAME_DUPLICATED", "definitions.prior_close")]
    #[case::cycle(|d: &mut StrategyAuthoringDocumentV1| set_expr(d, "risk", AuthoringExpressionV1::Mul { a: "long_stop".to_owned(), b: "2".to_owned() }), "DEFINITION_CYCLE", "definitions.risk.expr.a")]
    #[case::unused(|d: &mut StrategyAuthoringDocumentV1| d.definitions.push(AuthoringDefinitionV1 { name: "spare".to_owned(), expr: AuthoringExpressionV1::Max { of: "close".to_owned(), window: 3 } }), "DEFINITION_UNUSED", "definitions.spare")]
    #[case::unit_mismatch(|d: &mut StrategyAuthoringDocumentV1| set_expr(d, "breaks_up", AuthoringExpressionV1::Compare { a: "close".to_owned(), predicate: BoundedFeaturePredicateV1::Greater, b: "held".to_owned() }), "UNIT_MISMATCH", "definitions.breaks_up.expr")]
    #[case::literal(|d: &mut StrategyAuthoringDocumentV1| set_expr(d, "breaks_up", AuthoringExpressionV1::Compare { a: "close".to_owned(), predicate: BoundedFeaturePredicateV1::Greater, b: "100.0000000001".to_owned() }), "LITERAL_NOT_REPRESENTABLE", "definitions.breaks_up.expr.b")]
    #[case::window(|d: &mut StrategyAuthoringDocumentV1| set_expr(d, "high_50", AuthoringExpressionV1::Max { of: "prior_close".to_owned(), window: 0 }), "WINDOW_OUT_OF_RANGE", "definitions.high_50.expr.window")]
    #[case::not_boolean(|d: &mut StrategyAuthoringDocumentV1| d.rules[0].when = "long_stop".to_owned(), "NOT_BOOLEAN", "rules.flip_short.when")]
    #[case::field_repeated(|d: &mut StrategyAuthoringDocumentV1| d.inputs[0].field = AuthoringFieldV1::Close, "INPUT_FIELD_REPEATED", "inputs.close")]
    #[case::close_required(|d: &mut StrategyAuthoringDocumentV1| { d.inputs.retain(|input| input.field != AuthoringFieldV1::Close); }, "CLOSE_INPUT_REQUIRED", "inputs")]
    #[case::rules_required(|d: &mut StrategyAuthoringDocumentV1| d.rules.clear(), "RULES_REQUIRED", "rules")]
    #[case::protection(|d: &mut StrategyAuthoringDocumentV1| { if let AuthoringActionV1::Enter { stop_loss, .. } = &mut d.rules[3].action { *stop_loss = Some("long_stop".to_owned()); } }, "PROTECTION_NOT_SUPPORTED_IN_SLICE_1", "rules.enter_long.action.stop_loss")]
    #[case::flip_units(|d: &mut StrategyAuthoringDocumentV1| d.rules[0].action = AuthoringActionV1::Flip { side: AuthoringSideV1::Short, units: 0 }, "LITERAL_NOT_REPRESENTABLE", "rules.flip_short.action.units")]
    #[case::capture_boolean(|d: &mut StrategyAuthoringDocumentV1| d.states[3].kind = AuthoringStateKindV1::Capture { value: "flat".to_owned(), when: "opens_long".to_owned() }, "UNIT_MISMATCH", "states.long_stop_level.kind.value")]
    #[case::ago_one_input(|d: &mut StrategyAuthoringDocumentV1| set_expr(d, "prior_close", AuthoringExpressionV1::Ago { of: "atr_20".to_owned(), bars: 1 }), "AGO_NEEDS_ONE_INPUT", "definitions.prior_close.expr.of")]
    #[case::atr_inputs(|d: &mut StrategyAuthoringDocumentV1| { d.inputs.retain(|input| input.field != AuthoringFieldV1::Open); }, "ATR_INPUTS_REQUIRED", "definitions.atr_20.expr")]
    fn each_refusal_is_named_at_its_path(
        #[case] change: fn(&mut StrategyAuthoringDocumentV1),
        #[case] code: &str,
        #[case] path: &str,
    ) {
        let refusal = author(&t0_with(change)).expect_err("refused");

        assert_eq!((refusal.code, refusal.path.as_str()), (code, path));
    }

    /// The same document compiles to the same pair, and a change to a window changes it.
    #[rstest]
    fn compilation_is_deterministic_and_reads_every_window() {
        let (design, meaning) = author(&t0()).expect("T0 compiles");
        assert_eq!(
            author(&t0()).expect("T0 compiles"),
            (design, meaning.clone())
        );

        let wider = t0_with(|d| {
            set_expr(
                d,
                "high_50",
                AuthoringExpressionV1::Max {
                    of: "prior_close".to_owned(),
                    window: 55,
                },
            );
        });
        assert_ne!(author(&wider).expect("compiles").1, meaning);
    }

    /// Research T0 compiles, and what it compiles to prepares.
    #[rstest]
    fn the_t0_document_compiles_and_prepares() {
        let (design, meaning) = author(&t0()).unwrap_or_else(|e| panic!("T0 compiles: {e}"));
        self_check(&design, &meaning).expect("the compiled program prepares");
        assert_eq!(meaning.proposal_decision_table.branches.len(), 5);
    }

    fn volume_breakout() -> StrategyAuthoringDocumentV1 {
        serde_json::from_str(include_str!(
            "../test_data/strategy_authoring_v1/volume-breakout.json"
        ))
        .expect("the volume breakout parses")
    }

    /// A document that reads VOLUME compiles and prepares; its volume role reads Market Data's
    /// volume field as a `QUANTITY`, and the target-set Host binds it.
    #[rstest]
    fn a_volume_document_compiles_prepares_and_binds() {
        let (design, meaning) = author(&volume_breakout())
            .unwrap_or_else(|e| panic!("the volume breakout compiles: {e}"));
        self_check(&design, &meaning).expect("the compiled program prepares");
        let volume = design
            .inputs
            .iter()
            .find(|role| role.field_semantic_id == "MARKET_DATA.BAR.VOLUME.QUANTITY.V1")
            .expect("a volume role");

        assert_eq!((volume.unit.as_str(), volume.scale), ("QUANTITY", 9));
        assert!(
            design
                .inputs
                .iter()
                .filter(|role| role != &volume)
                .all(|role| role.unit == "PRICE")
        );
        crate::strategy_plan_v2::validate_universe_target_set_contract_for_test(design, Some(1))
            .expect("the target-set Host binds every role, the volume role among them");
    }

    /// A price and a quantity are different units: comparing, adding or subtracting them is
    /// refused by name, and a quotient's divisor must be named.
    #[rstest]
    #[case::compare(AuthoringExpressionV1::Compare { a: "close".to_owned(), predicate: BoundedFeaturePredicateV1::Greater, b: "volume".to_owned() }, "UNIT_MISMATCH", "definitions.heavy.expr")]
    #[case::add(AuthoringExpressionV1::Add { a: "close".to_owned(), b: "volume".to_owned() }, "UNIT_MISMATCH", "definitions.heavy.expr")]
    #[case::sub(AuthoringExpressionV1::Sub { a: "volume".to_owned(), b: "close".to_owned() }, "UNIT_MISMATCH", "definitions.heavy.expr")]
    #[case::literal_divisor(AuthoringExpressionV1::Div { a: "volume".to_owned(), b: "2".to_owned() }, "UNIT_MISMATCH", "definitions.heavy.expr.b")]
    fn a_price_and_a_quantity_do_not_mix(
        #[case] expr: AuthoringExpressionV1,
        #[case] code: &str,
        #[case] path: &str,
    ) {
        let mut document = volume_breakout();
        set_expr(&mut document, "heavy", expr);
        let refusal = author(&document).expect_err("refused");

        assert_eq!((refusal.code, refusal.path.as_str()), (code, path));
    }

    /// A quotient of one unit is spelled `X/X` and compares with a literal of that unit; a price
    /// ratio and a volume ratio are different units and do not compare.
    #[rstest]
    fn a_ratio_is_spelled_as_its_quotient() {
        let mut document = volume_breakout();
        document.definitions.push(AuthoringDefinitionV1 {
            name: "price_ratio".to_owned(),
            expr: AuthoringExpressionV1::Div {
                a: "close".to_owned(),
                b: "high_20".to_owned(),
            },
        });
        set_expr(
            &mut document,
            "heavy",
            AuthoringExpressionV1::Compare {
                a: "volume_ratio".to_owned(),
                predicate: BoundedFeaturePredicateV1::Greater,
                b: "price_ratio".to_owned(),
            },
        );
        let refusal = author(&document).expect_err("refused");
        assert_eq!(
            (refusal.code, refusal.path.as_str()),
            ("UNIT_MISMATCH", "definitions.heavy.expr")
        );
    }

    /// Adding VOLUME, DIV and warming arithmetic inputs leaves every document that reads only OHLC
    /// compiling to the bytes it did: research T0's design and meaning hash as they did before.
    #[rstest]
    fn an_ohlc_document_compiles_to_the_bytes_it_did() {
        use sha2::{Digest, Sha256};

        let (design, meaning) = author(&t0()).expect("T0 compiles");
        let mut hasher = Sha256::new();
        hasher.update(serde_json::to_vec(&design).unwrap());
        hasher.update(serde_json::to_vec(&meaning).unwrap());
        let digest: [u8; 32] = hasher.finalize().into();
        let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();

        assert_eq!(
            hex,
            "a04a68960452d3ff4e1db495009214b8bfca84274785bc3000727a055c0d7d72"
        );
    }
}
