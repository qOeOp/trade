//! Typed, effect-free Strategy Design V2 reaction graph.

use serde::{Deserialize, Deserializer, Serialize, de::Visitor};
use vibe_data::owner::source_binding::BindingDigest;

pub const STRATEGY_DESIGN_SCHEMA_V2: u16 = 2;
pub const INPUT_JOIN_LATEST_NOT_AFTER_TRIGGER_V1: &str =
    "strategy.input-join.latest-not-after-trigger.v1";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StrategyDesignV2 {
    pub schema_version: u16,
    pub research_request_identity: BindingDigest,
    pub intent_identity: BindingDigest,
    pub intent_digest: BindingDigest,
    pub inputs: Vec<InputRoleV2>,
    pub joins: Vec<InputJoinV2>,
    pub parameters: Vec<ParameterV2>,
    pub state: Vec<StateCellV2>,
    pub reactions: Vec<ReactionGraphV2>,
    pub capabilities: Vec<CapabilityDeclarationV2>,
    pub plugins: Vec<PluginManifestV2>,
    pub resources: ResourceBoundsV2,
    pub falsifier: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValueTypeV2 {
    I32,
    I64,
    U64,
    I128,
    Bytes,
    Digest32,
    StableIdentity16,
    PositionIntentV1,
    TargetVariantV1,
    ProtectionVariantV1,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum TypedConstantV2 {
    I32 {
        value: i32,
    },
    I64 {
        value: i64,
    },
    U64 {
        value: u64,
    },
    I128 {
        #[serde(deserialize_with = "deserialize_i128_v2")]
        value: i128,
    },
    Bytes {
        value: Vec<u8>,
    },
    Digest32 {
        value: BindingDigest,
    },
    StableIdentity16 {
        value: [u8; 16],
    },
    PositionIntentV1 {
        semantic_id: String,
    },
    TargetVariantV1 {
        semantic_id: String,
    },
    ProtectionVariantV1 {
        semantic_id: String,
    },
}

fn deserialize_i128_v2<'de, D>(deserializer: D) -> Result<i128, D::Error>
where
    D: Deserializer<'de>,
{
    struct I128Visitor;

    impl Visitor<'_> for I128Visitor {
        type Value = i128;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("a signed 128-bit integer")
        }

        fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
            Ok(i128::from(value))
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E> {
            Ok(i128::from(value))
        }

        fn visit_i128<E>(self, value: i128) -> Result<Self::Value, E> {
            Ok(value)
        }

        fn visit_u128<E>(self, value: u128) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            i128::try_from(value).map_err(E::custom)
        }
    }

    deserializer.deserialize_any(I128Visitor)
}

impl TypedConstantV2 {
    pub const fn value_type(&self) -> ValueTypeV2 {
        match self {
            Self::I32 { .. } => ValueTypeV2::I32,
            Self::I64 { .. } => ValueTypeV2::I64,
            Self::U64 { .. } => ValueTypeV2::U64,
            Self::I128 { .. } => ValueTypeV2::I128,
            Self::Bytes { .. } => ValueTypeV2::Bytes,
            Self::Digest32 { .. } => ValueTypeV2::Digest32,
            Self::StableIdentity16 { .. } => ValueTypeV2::StableIdentity16,
            Self::PositionIntentV1 { .. } => ValueTypeV2::PositionIntentV1,
            Self::TargetVariantV1 { .. } => ValueTypeV2::TargetVariantV1,
            Self::ProtectionVariantV1 { .. } => ValueTypeV2::ProtectionVariantV1,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InputFactClassV2 {
    Research,
    MarketData,
    ExecutionRuntime,
    BacktestSimExchange,
    Portfolio,
    Risk,
}

/// Owner scope of one typed input role.
#[derive(Clone, Debug, Default, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum InputScopeV2 {
    /// One exact canonical instrument resolved by a singular Owner receipt.
    #[default]
    ExactInstrument,
    /// The same role repeated for every member of an Owner-sealed universe selection.
    UniverseMembers,
}

impl InputScopeV2 {
    fn is_exact_instrument(&self) -> bool {
        matches!(self, Self::ExactInstrument)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InputRoleV2 {
    pub semantic_id: String,
    pub fact_class: InputFactClassV2,
    /// Exact instrument on the compatible singular path; empty for `UniverseMembers`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub instrument: String,
    #[serde(default, skip_serializing_if = "InputScopeV2::is_exact_instrument")]
    pub scope: InputScopeV2,
    pub field_semantic_id: String,
    pub channel: String,
    pub timeframe: String,
    pub unit: String,
    pub scale: u8,
    pub value_type: ValueTypeV2,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InputJoinV2 {
    pub semantic_id: String,
    pub inputs: Vec<String>,
    pub alignment_semantic_id: String,
    pub trigger_input_id: String,
    pub max_staleness_ns: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ParameterV2 {
    pub semantic_id: String,
    pub value_type: ValueTypeV2,
    pub value: TypedConstantV2,
    pub unit: String,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StateCellV2 {
    pub semantic_id: String,
    pub value_type: ValueTypeV2,
    pub initial: TypedConstantV2,
    pub max_bytes: u32,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LifecycleKindV2 {
    Start,
    Bar,
    Event,
    Fill,
    Timer,
    Stop,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LifecycleContextV2 {
    IntentIdentity,
    EnvelopeDigest,
    CurrentPositionUnits,
    RebalanceSequence,
    StrategyStateDigest,
    PluginStateDigest,
}

impl LifecycleContextV2 {
    pub const fn value_type(self) -> ValueTypeV2 {
        match self {
            Self::IntentIdentity => ValueTypeV2::StableIdentity16,
            Self::EnvelopeDigest | Self::StrategyStateDigest | Self::PluginStateDigest => {
                ValueTypeV2::Digest32
            }
            Self::CurrentPositionUnits => ValueTypeV2::I64,
            Self::RebalanceSequence => ValueTypeV2::U64,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ValueRefV2 {
    Input {
        input_id: String,
    },
    UniverseMemberInput {
        input_id: String,
        /// Zero-based position in the Owner-canonical selection member order.
        member_ordinal: u8,
    },
    Parameter {
        parameter_id: String,
    },
    PriorState {
        state_id: String,
    },
    LifecycleContext {
        field: LifecycleContextV2,
    },
    NodeOutput {
        node_id: String,
        port_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PortContractV2 {
    pub semantic_id: String,
    pub value_type: ValueTypeV2,
    pub max_bytes: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PluginStateContractV2 {
    pub pre_port_id: String,
    pub post_port_id: String,
    pub value_type: ValueTypeV2,
    pub max_bytes: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PluginManifestV2 {
    pub semantic_id: String,
    pub abi_version: u16,
    pub input_ports: Vec<PortContractV2>,
    pub output_ports: Vec<PortContractV2>,
    pub state: PluginStateContractV2,
    pub capability_ids: Vec<String>,
    pub max_fuel: u64,
    pub max_linear_memory_bytes: u32,
    pub max_invocations_per_event: u16,
    pub failure_semantic_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PortBindingV2 {
    pub port_id: String,
    pub source: ValueRefV2,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputeNodeV2 {
    pub semantic_id: String,
    pub plugin_semantic_id: String,
    pub input_bindings: Vec<PortBindingV2>,
    pub pre_state: ValueRefV2,
    pub output_port_ids: Vec<String>,
    pub post_state_port_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StateWriteV2 {
    pub state_id: String,
    pub source: ValueRefV2,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProposalWiringV2 {
    pub position_intent: ValueRefV2,
    pub target_variant: ValueRefV2,
    pub target_position_units: ValueRefV2,
    pub target_weight_micros: ValueRefV2,
    pub rebalance_sequence: ValueRefV2,
    pub reconciliation_target_units: ValueRefV2,
    pub protection_variant: ValueRefV2,
    pub stop_loss_ticks: ValueRefV2,
    pub take_profit_ticks: ValueRefV2,
    pub trailing_distance_ticks: ValueRefV2,
    pub trailing_stop_ticks: ValueRefV2,
    /// Canonical `lifecycle_v2::InstrumentTargetSetV2` bytes for an exactly-two-member frame.
    /// Absent on the compatible single-instrument V2 path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub member_target_set: Option<ValueRefV2>,
}

impl ProposalWiringV2 {
    pub(crate) fn fields(&self) -> Vec<(&'static str, &ValueRefV2, ValueTypeV2)> {
        let mut fields = vec![
            (
                "position_intent",
                &self.position_intent,
                ValueTypeV2::PositionIntentV1,
            ),
            (
                "target_variant",
                &self.target_variant,
                ValueTypeV2::TargetVariantV1,
            ),
            (
                "target_position_units",
                &self.target_position_units,
                ValueTypeV2::I64,
            ),
            (
                "target_weight_micros",
                &self.target_weight_micros,
                ValueTypeV2::I32,
            ),
            (
                "rebalance_sequence",
                &self.rebalance_sequence,
                ValueTypeV2::U64,
            ),
            (
                "reconciliation_target_units",
                &self.reconciliation_target_units,
                ValueTypeV2::I64,
            ),
            (
                "protection_variant",
                &self.protection_variant,
                ValueTypeV2::ProtectionVariantV1,
            ),
            ("stop_loss_ticks", &self.stop_loss_ticks, ValueTypeV2::I64),
            (
                "take_profit_ticks",
                &self.take_profit_ticks,
                ValueTypeV2::I64,
            ),
            (
                "trailing_distance_ticks",
                &self.trailing_distance_ticks,
                ValueTypeV2::U64,
            ),
            (
                "trailing_stop_ticks",
                &self.trailing_stop_ticks,
                ValueTypeV2::I64,
            ),
        ];

        if let Some(value) = &self.member_target_set {
            fields.push(("member_target_set", value, ValueTypeV2::Bytes));
        }
        fields
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReactionGraphV2 {
    pub kind: LifecycleKindV2,
    pub nodes: Vec<ComputeNodeV2>,
    pub state_writes: Vec<StateWriteV2>,
    pub proposal: Option<ProposalWiringV2>,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CapabilityDeclarationV2 {
    pub semantic_id: String,
    pub version: u16,
    pub dependencies: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceBoundsV2 {
    pub max_inputs: u16,
    pub max_nodes_per_reaction: u16,
    pub max_dependency_edges: u16,
    pub max_state_bytes: u32,
    pub max_plugin_calls_per_event: u16,
}
