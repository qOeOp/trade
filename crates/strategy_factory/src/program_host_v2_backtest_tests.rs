use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

use anyhow::Context;
#[cfg(test)]
use rstest::rstest;
use serde::Serialize;
use sha2::Digest;
use strategy_factory_program_sdk::lifecycle_v1::{
    self, EnvelopePayloadV1, EventOrderKeyV1, LifecycleEnvelopeV1, LifecycleKind,
};
use vibe_backtest::{
    config::{BacktestEngineConfig, SimulatedVenueConfig},
    engine::BacktestEngine,
};
use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, ObservationComponentV2, OpaqueIdentityV2, ReplayAuthorityClaimV2,
    ReplayWindowV2, VersionedIdentityV2,
};
use vibe_data::owner::source_binding::BindingDigest;
use vibe_model::{
    data::{Bar, BarSpecification, BarType, BookOrder, Data, OrderBookDelta, TradeTick},
    enums::{
        AccountType, AggregationSource, AggressorSide, BarAggregation, BookAction, BookType,
        OmsType, OrderSide, PriceType,
    },
    identifiers::{InstrumentId, StrategyId, TradeId, Venue},
    instruments::{Instrument, InstrumentAny, stubs::crypto_perpetual_ethusdt},
    orders::Order,
    types::{Money, Price, Quantity},
};

use super::{
    artifact_v2::{StrategyArtifactV2, StrategyArtifactV2Error},
    cargo_artifact::{PluginCargoBuildEvidenceV2, VerifiedPluginCargoBuildV2},
    plugin_wire_v2::{PluginFrameKindV2, PluginFrameV2, TypedValueV2},
    program_host_backtest_v2::{BacktestProgramHostStrategyV2, BacktestProgramHostTraceV2},
    program_host_v2::AdmittedProgramEventV2,
    strategy_design_v2::{
        CapabilityDeclarationV2, ComputeNodeV2, InputFactClassV2, InputRoleV2, InputScopeV2,
        LifecycleContextV2, LifecycleKindV2, ParameterV2, PluginManifestV2, PluginStateContractV2,
        PortBindingV2, PortContractV2, ProposalWiringV2, ReactionGraphV2, ResourceBoundsV2,
        STRATEGY_DESIGN_SCHEMA_V2, StateCellV2, StateWriteV2, StrategyDesignV2, TypedConstantV2,
        ValueRefV2, ValueTypeV2,
    },
    strategy_plan_v2::{
        StrategyCompilationV2, StrategyPlanV2,
        compile_with_binding_and_implementation_receipts_for_test,
        issue_plugin_implementation_receipt_v2_for_test,
    },
};

#[cfg(test)]
use super::strategy_plan_v2::{
    VerifiedStrategyInputBindingsV2, verified_strategy_input_bindings_for_test,
};

const INPUT_PTR: i32 = 1_024;
const OUTPUT_PTR: i32 = 8_192;
const STATIC_PTR: i32 = 16_384;
const PLUGIN_ID: &str = "research.plugin.stateful-trend.v1";
const STATE_POST: &str = "plugin.state.post.v1";
type BacktestFixtureParts = (
    StrategyPlanV2,
    StrategyArtifactV2,
    StrategyDesignV2,
    Vec<(InputRoleV2, BindingDigest)>,
);
const OUTPUT_PORTS: &[(&str, ValueTypeV2)] = &[
    ("proposal.position-intent.v1", ValueTypeV2::PositionIntentV1),
    ("proposal.target-variant.v1", ValueTypeV2::TargetVariantV1),
    ("proposal.target-position.v1", ValueTypeV2::I64),
    ("proposal.target-weight.v1", ValueTypeV2::I32),
    ("proposal.rebalance-sequence.v1", ValueTypeV2::U64),
    ("proposal.reconciliation-target.v1", ValueTypeV2::I64),
    (
        "proposal.protection-variant.v1",
        ValueTypeV2::ProtectionVariantV1,
    ),
    ("proposal.stop-loss.v1", ValueTypeV2::I64),
    ("proposal.take-profit.v1", ValueTypeV2::I64),
    ("proposal.trailing-distance.v1", ValueTypeV2::U64),
    ("proposal.trailing-stop.v1", ValueTypeV2::I64),
];

#[derive(Clone, Copy)]
enum Phase {
    Enter,
    HoldZero,
    HoldOne,
    Add,
    HoldTwo,
    Reduce,
    HoldThree,
    Exit,
    HoldFour,
}

#[derive(Clone, Copy)]
#[allow(dead_code)]
enum InputMutation {
    None,
    OpenFirst,
    CloseFirst,
}

fn output(node: &str, port: &str) -> ValueRefV2 {
    ValueRefV2::NodeOutput {
        node_id: node.into(),
        port_id: port.into(),
    }
}

fn context(field: LifecycleContextV2) -> ValueRefV2 {
    ValueRefV2::LifecycleContext { field }
}

fn proposal(node: &str) -> ProposalWiringV2 {
    ProposalWiringV2 {
        position_intent: output(node, "proposal.position-intent.v1"),
        target_variant: output(node, "proposal.target-variant.v1"),
        target_position_units: output(node, "proposal.target-position.v1"),
        target_weight_micros: output(node, "proposal.target-weight.v1"),
        rebalance_sequence: output(node, "proposal.rebalance-sequence.v1"),
        reconciliation_target_units: output(node, "proposal.reconciliation-target.v1"),
        protection_variant: output(node, "proposal.protection-variant.v1"),
        stop_loss_ticks: output(node, "proposal.stop-loss.v1"),
        take_profit_ticks: output(node, "proposal.take-profit.v1"),
        trailing_distance_ticks: output(node, "proposal.trailing-distance.v1"),
        trailing_stop_ticks: output(node, "proposal.trailing-stop.v1"),
        member_target_set: None,
    }
}

fn compute_node(node: &str, state: &str) -> ComputeNodeV2 {
    ComputeNodeV2 {
        semantic_id: node.into(),
        plugin_semantic_id: PLUGIN_ID.into(),
        input_bindings: vec![
            PortBindingV2 {
                port_id: "input.close.v1".into(),
                source: ValueRefV2::Input {
                    input_id: "research.input.close.v1".into(),
                },
            },
            PortBindingV2 {
                port_id: "input.current-position.v1".into(),
                source: context(LifecycleContextV2::CurrentPositionUnits),
            },
            PortBindingV2 {
                port_id: "input.envelope-digest.v1".into(),
                source: context(LifecycleContextV2::EnvelopeDigest),
            },
            PortBindingV2 {
                port_id: "input.intent.v1".into(),
                source: context(LifecycleContextV2::IntentIdentity),
            },
            PortBindingV2 {
                port_id: "input.lookback.v1".into(),
                source: ValueRefV2::Parameter {
                    parameter_id: "research.parameter.lookback.v1".into(),
                },
            },
            PortBindingV2 {
                port_id: "input.rebalance-sequence.v1".into(),
                source: context(LifecycleContextV2::RebalanceSequence),
            },
        ],
        pre_state: ValueRefV2::PriorState {
            state_id: state.into(),
        },
        output_port_ids: OUTPUT_PORTS
            .iter()
            .map(|(port, _)| (*port).to_owned())
            .collect(),
        post_state_port_id: STATE_POST.into(),
    }
}

fn reaction(kind: LifecycleKindV2, node: &str, state: &str) -> ReactionGraphV2 {
    let mut compute = compute_node(node, state);
    let close_source = match kind {
        LifecycleKindV2::Event => ValueRefV2::Input {
            input_id: "research.input.last-trade.v1".into(),
        },
        LifecycleKindV2::Timer => ValueRefV2::Parameter {
            parameter_id: "research.parameter.timer-close.v1".into(),
        },
        _ => ValueRefV2::Input {
            input_id: "research.input.close.v1".into(),
        },
    };

    if let Some(binding) = compute
        .input_bindings
        .iter_mut()
        .find(|binding| binding.port_id == "input.close.v1")
    {
        binding.source = close_source;
    }
    ReactionGraphV2 {
        kind,
        nodes: vec![compute],
        state_writes: vec![StateWriteV2 {
            state_id: state.into(),
            source: output(node, STATE_POST),
        }],
        proposal: Some(proposal(node)),
    }
}

fn stateful_backtest_design() -> StrategyDesignV2 {
    let capabilities = [
        "research.trend.warmup.v1",
        "research.trend.enter.v1",
        "research.trend.add.v1",
        "research.trend.reduce.v1",
        "research.trend.trailing.v1",
        "research.trend.timer-exit.v1",
    ];
    let mut design = StrategyDesignV2 {
        schema_version: STRATEGY_DESIGN_SCHEMA_V2,
        research_request_identity: BindingDigest::from_untrusted_bytes([1; 32]),
        intent_identity: BindingDigest::from_untrusted_bytes([2; 32]),
        intent_digest: BindingDigest::from_untrusted_bytes([3; 32]),
        inputs: vec![
            InputRoleV2 {
                semantic_id: "research.input.close.v1".into(),
                fact_class: InputFactClassV2::MarketData,
                instrument: "AAPL.XNAS".into(),
                scope: InputScopeV2::ExactInstrument,
                field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".into(),
                channel: "MARKET".into(),
                timeframe: "1M".into(),
                unit: "PRICE".into(),
                scale: 2,
                value_type: ValueTypeV2::I128,
            },
            InputRoleV2 {
                semantic_id: "research.input.last-trade.v1".into(),
                fact_class: InputFactClassV2::MarketData,
                instrument: "AAPL.XNAS".into(),
                scope: InputScopeV2::ExactInstrument,
                field_semantic_id: "MARKET_DATA.TRADE.LAST.PRICE.V1".into(),
                channel: "MARKET".into(),
                timeframe: "TICK".into(),
                unit: "PRICE".into(),
                scale: 2,
                value_type: ValueTypeV2::I128,
            },
        ],
        joins: vec![],
        parameters: vec![
            ParameterV2 {
                semantic_id: "research.parameter.lookback.v1".into(),
                value_type: ValueTypeV2::I64,
                value: TypedConstantV2::I64 { value: 20 },
                unit: "BAR_COUNT".into(),
            },
            ParameterV2 {
                semantic_id: "research.parameter.timer-close.v1".into(),
                value_type: ValueTypeV2::I128,
                value: TypedConstantV2::I128 { value: 0 },
                unit: "PRICE".into(),
            },
        ],
        state: vec![StateCellV2 {
            semantic_id: "research.state.trend.v1".into(),
            value_type: ValueTypeV2::Bytes,
            initial: TypedConstantV2::Bytes { value: vec![] },
            max_bytes: 256,
        }],
        reactions: vec![
            ReactionGraphV2 {
                kind: LifecycleKindV2::Start,
                nodes: vec![],
                state_writes: vec![],
                proposal: None,
            },
            reaction(
                LifecycleKindV2::Bar,
                "research.node.bar.v1",
                "research.state.trend.v1",
            ),
            reaction(
                LifecycleKindV2::Event,
                "research.node.event.v1",
                "research.state.trend.v1",
            ),
            ReactionGraphV2 {
                kind: LifecycleKindV2::Fill,
                nodes: vec![],
                state_writes: vec![],
                proposal: None,
            },
            reaction(
                LifecycleKindV2::Timer,
                "research.node.timer.v1",
                "research.state.trend.v1",
            ),
            ReactionGraphV2 {
                kind: LifecycleKindV2::Stop,
                nodes: vec![],
                state_writes: vec![],
                proposal: None,
            },
        ],
        capabilities: capabilities
            .into_iter()
            .map(|semantic_id| CapabilityDeclarationV2 {
                semantic_id: semantic_id.into(),
                version: 1,
                dependencies: vec![],
            })
            .collect(),
        plugins: vec![PluginManifestV2 {
            semantic_id: PLUGIN_ID.into(),
            abi_version: 2,
            input_ports: vec![
                PortContractV2 {
                    semantic_id: "input.close.v1".into(),
                    value_type: ValueTypeV2::I128,
                    max_bytes: 16,
                },
                PortContractV2 {
                    semantic_id: "input.current-position.v1".into(),
                    value_type: ValueTypeV2::I64,
                    max_bytes: 8,
                },
                PortContractV2 {
                    semantic_id: "input.envelope-digest.v1".into(),
                    value_type: ValueTypeV2::Digest32,
                    max_bytes: 32,
                },
                PortContractV2 {
                    semantic_id: "input.intent.v1".into(),
                    value_type: ValueTypeV2::StableIdentity16,
                    max_bytes: 16,
                },
                PortContractV2 {
                    semantic_id: "input.lookback.v1".into(),
                    value_type: ValueTypeV2::I64,
                    max_bytes: 8,
                },
                PortContractV2 {
                    semantic_id: "input.rebalance-sequence.v1".into(),
                    value_type: ValueTypeV2::U64,
                    max_bytes: 8,
                },
            ],
            output_ports: OUTPUT_PORTS
                .iter()
                .map(|(semantic_id, value_type)| PortContractV2 {
                    semantic_id: (*semantic_id).into(),
                    value_type: *value_type,
                    max_bytes: match value_type {
                        ValueTypeV2::Digest32 => 32,
                        ValueTypeV2::I32
                        | ValueTypeV2::PositionIntentV1
                        | ValueTypeV2::TargetVariantV1
                        | ValueTypeV2::ProtectionVariantV1 => 4,
                        _ => 8,
                    },
                })
                .collect(),
            state: PluginStateContractV2 {
                pre_port_id: "plugin.state.pre.v1".into(),
                post_port_id: STATE_POST.into(),
                value_type: ValueTypeV2::Bytes,
                max_bytes: 256,
            },
            capability_ids: capabilities.into_iter().map(str::to_owned).collect(),
            max_fuel: 10_000_000,
            max_linear_memory_bytes: 1_048_576,
            max_invocations_per_event: 1,
            failure_semantic_id: "strategy.plugin.failure.unsupported.v1".into(),
        }],
        resources: ResourceBoundsV2 {
            max_inputs: 4,
            max_nodes_per_reaction: 4,
            max_dependency_edges: 256,
            max_state_bytes: 4096,
            max_plugin_calls_per_event: 4,
        },
        falsifier: "trend state does not improve the frozen next-return decision".into(),
    };
    let mut open = design.inputs[0].clone();
    open.semantic_id = "research.input.open.v1".into();
    open.field_semantic_id = "MARKET_DATA.BAR.OPEN.PRICE.V1".into();
    design.inputs.push(open);
    design.plugins[0].input_ports.push(PortContractV2 {
        semantic_id: "input.open.v1".into(),
        value_type: ValueTypeV2::I128,
        max_bytes: 16,
    });

    for reaction in &mut design.reactions {
        for node in &mut reaction.nodes {
            let source = match reaction.kind {
                LifecycleKindV2::Bar => ValueRefV2::Input {
                    input_id: "research.input.open.v1".into(),
                },
                LifecycleKindV2::Event => ValueRefV2::Input {
                    input_id: "research.input.last-trade.v1".into(),
                },
                _ => ValueRefV2::Parameter {
                    parameter_id: "research.parameter.timer-close.v1".into(),
                },
            };
            node.input_bindings.push(PortBindingV2 {
                port_id: "input.open.v1".into(),
                source,
            });
            node.input_bindings.sort();
        }
    }

    for port in &mut design.plugins[0].output_ports {
        if matches!(
            port.value_type,
            ValueTypeV2::PositionIntentV1
                | ValueTypeV2::TargetVariantV1
                | ValueTypeV2::ProtectionVariantV1
        ) {
            port.max_bytes = 64;
        }
    }
    design.plugins[0].input_ports.sort();
    design.plugins[0].output_ports.sort();
    design.plugins[0].capability_ids.sort();
    design
}

fn bindings(design: &StrategyDesignV2) -> Vec<(InputRoleV2, BindingDigest)> {
    let mut inputs = design.inputs.clone();
    inputs.sort();
    inputs
        .into_iter()
        .enumerate()
        .map(|(index, role)| {
            (
                role,
                BindingDigest::from_untrusted_bytes([10 + index as u8; 32]),
            )
        })
        .collect()
}

pub struct StatefulBacktestNativeReplayEvidenceV2 {
    corpus: Vec<u8>,
    trace: BacktestProgramHostTraceV2,
    consumed_meanings: Vec<NativeReplayConsumedMeaningV2>,
    design_digest: [u8; 32],
    plan_digest: [u8; 32],
    artifact_digest: [u8; 32],
    #[cfg(test)]
    restored: bool,
    #[cfg(test)]
    native_position_closed: bool,
    #[cfg(test)]
    native_final_position_units: i64,
    #[cfg(test)]
    native_order_statuses: Vec<String>,
    owner_input_cut: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct NativeReplayConsumedMeaningV2 {
    component: ObservationComponentV2,
    observed_meaning_identity: OpaqueIdentityV2,
    observed_meaning_digest: CanonicalDigestV2,
    observation_digest: CanonicalDigestV2,
}

impl StatefulBacktestNativeReplayEvidenceV2 {
    pub fn canonical_execution_bytes(&self) -> &[u8] {
        &self.corpus
    }

    pub fn owner_input_cut(&self) -> [u8; 32] {
        self.owner_input_cut
    }

    pub fn consumed_meanings(
        &self,
    ) -> impl ExactSizeIterator<
        Item = (
            ObservationComponentV2,
            &OpaqueIdentityV2,
            &CanonicalDigestV2,
            &CanonicalDigestV2,
        ),
    > {
        self.consumed_meanings.iter().map(|meaning| {
            (
                meaning.component,
                &meaning.observed_meaning_identity,
                &meaning.observed_meaning_digest,
                &meaning.observation_digest,
            )
        })
    }

    pub fn design_digest(&self) -> [u8; 32] {
        self.design_digest
    }

    pub fn plan_digest(&self) -> [u8; 32] {
        self.plan_digest
    }

    pub fn artifact_digest(&self) -> [u8; 32] {
        self.artifact_digest
    }

    pub fn lifecycle_count(&self, lifecycle: &str) -> usize {
        self.trace
            .host_transitions
            .iter()
            .filter(|transition| transition.lifecycle == lifecycle)
            .count()
    }

    pub fn native_fill_count(&self) -> usize {
        self.trace
            .native_order_observations
            .iter()
            .filter(|observation| !observation.protection_order && observation.event == "FILLED")
            .count()
    }
}

#[derive(Serialize)]
struct Corpus<'a> {
    design_digest: [u8; 32],
    plan_digest: [u8; 32],
    artifact_digest: [u8; 32],
    trace: &'a BacktestProgramHostTraceV2,
    final_result: Vec<u8>,
    native_order_statuses: &'a [String],
    native_position_closed: bool,
    native_position_events: usize,
    owner_input_cut: [u8; 32],
    consumed_meanings: &'a [NativeReplayConsumedMeaningV2],
}

pub fn run_stateful_backtest_native_replay_v2(
    restore: bool,
) -> anyhow::Result<StatefulBacktestNativeReplayEvidenceV2> {
    run_corpus(restore, InputMutation::None)
}

#[cfg(test)]
#[rstest]
fn stateful_v2_host_drives_real_backtest_with_restart_and_repeat_equality() {
    let uninterrupted =
        run_corpus(false, InputMutation::None).expect("uninterrupted real Backtest corpus");
    let restored =
        run_corpus(true, InputMutation::None).expect("checkpoint-restored real Backtest corpus");
    let repeated = run_corpus(false, InputMutation::None).expect("repeated real Backtest corpus");

    assert!(!uninterrupted.restored);
    assert!(restored.restored);
    assert_eq!(uninterrupted.corpus, restored.corpus);
    assert_eq!(uninterrupted.corpus, repeated.corpus);

    let semantic_positions = uninterrupted
        .trace
        .host_transitions
        .iter()
        .filter_map(|transition| {
            (transition.position_intent != "HOLD").then_some(transition.position_intent.as_str())
        })
        .collect::<Vec<_>>();
    assert_eq!(semantic_positions, ["ENTER", "ADD", "REDUCE", "EXIT"]);
    let bar_positions = uninterrupted
        .trace
        .host_transitions
        .iter()
        .filter(|transition| transition.lifecycle == "BAR")
        .map(|transition| transition.position_intent.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        bar_positions,
        [
            "ENTER", "HOLD", "ADD", "HOLD", "REDUCE", "HOLD", "EXIT", "HOLD"
        ]
    );
    let protection = uninterrupted
        .trace
        .host_transitions
        .iter()
        .filter_map(|transition| {
            (transition.protection_action != "KEEP")
                .then_some(transition.protection_action.as_str())
        })
        .collect::<Vec<_>>();
    assert_eq!(protection, ["REPLACE", "ADJUST", "CLEAR"]);
    let native_protection_events = uninterrupted
        .trace
        .native_order_observations
        .iter()
        .filter(|observation| observation.protection_order)
        .map(|observation| observation.event.as_str())
        .collect::<Vec<_>>();
    assert!(native_protection_events.contains(&"SUBMITTED"));
    assert!(native_protection_events.contains(&"UPDATED"));
    assert!(native_protection_events.contains(&"CANCELED"));

    let fill_positions = uninterrupted
        .trace
        .host_transitions
        .iter()
        .filter_map(|transition| {
            (transition.lifecycle == "FILL").then_some(transition.position_after_units)
        })
        .collect::<Vec<_>>();
    assert_eq!(fill_positions, [5, 8, 13, 16, 11, 8, 3, 0]);

    let native_fill_states = uninterrupted
        .trace
        .native_order_observations
        .iter()
        .filter(|observation| !observation.protection_order && observation.event == "FILLED")
        .map(|observation| {
            (
                observation.status.as_str(),
                observation.cached_position_units,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        native_fill_states,
        [
            ("PARTIALLY_FILLED", 5),
            ("FILLED", 8),
            ("PARTIALLY_FILLED", 13),
            ("FILLED", 16),
            ("PARTIALLY_FILLED", 11),
            ("FILLED", 8),
            ("PARTIALLY_FILLED", 3),
            ("FILLED", 0),
        ]
    );

    let split = uninterrupted
        .trace
        .host_transitions
        .iter()
        .position(|transition| {
            transition.lifecycle == "FILL" && transition.position_after_units == 8
        })
        .expect("first full ENTER fill");
    assert_eq!(
        &uninterrupted.trace.host_transitions[split + 1..],
        &restored.trace.host_transitions[split + 1..]
    );

    assert!(uninterrupted.native_position_closed);
    assert_eq!(uninterrupted.native_final_position_units, 0);
    assert_eq!(
        uninterrupted
            .native_order_statuses
            .iter()
            .filter(|status| status.as_str() == "FILLED")
            .count(),
        4
    );

    for mutation in [InputMutation::OpenFirst, InputMutation::CloseFirst] {
        let changed = run_corpus(false, mutation).expect("mutated real Backtest corpus");
        assert_ne!(uninterrupted.corpus, changed.corpus);
        assert_eq!(semantic_intents(&changed.trace), ["ENTER", "ADD", "REDUCE"]);
        assert!(!changed.native_position_closed);
        assert_eq!(changed.native_final_position_units, 8);
        assert_eq!(
            changed
                .native_order_statuses
                .iter()
                .filter(|status| status.as_str() == "FILLED")
                .count(),
            3
        );
    }
}

#[cfg(test)]
fn semantic_intents(trace: &BacktestProgramHostTraceV2) -> Vec<&str> {
    trace
        .host_transitions
        .iter()
        .filter_map(|transition| {
            (transition.position_intent != "HOLD").then_some(transition.position_intent.as_str())
        })
        .collect()
}

fn run_corpus(
    restore: bool,
    mutation: InputMutation,
) -> anyhow::Result<StatefulBacktestNativeReplayEvidenceV2> {
    let instrument = InstrumentAny::CryptoPerpetual(crypto_perpetual_ethusdt());
    let instrument_id = instrument.id();
    let bar_type = BarType::new(
        instrument_id,
        BarSpecification::new(1, BarAggregation::Minute, PriceType::Last),
        AggregationSource::External,
    );
    let (plan, artifact) = fixture(instrument_id)?;
    let mut field_pairs = [
        (99_i128, 100_i128),
        (100, 100),
        (99, 100),
        (100, 100),
        (99, 100),
        (100, 100),
        (99, 100),
        (100, 100),
    ];

    match mutation {
        InputMutation::None => {}
        InputMutation::OpenFirst => field_pairs[0].0 = 101,
        InputMutation::CloseFirst => field_pairs[0].1 = 98,
    }
    let bars = field_pairs
        .into_iter()
        .enumerate()
        .map(|(offset, (open, close))| {
            let time = (offset as u64 + 1) * 1_000_000_000;
            let open = Price::from(format!("{open}.00").as_str());
            let close = Price::from(format!("{close}.00").as_str());
            let order_key = EventOrderKeyV1::new(
                time,
                time,
                LifecycleKind::Bar,
                offset as u64 + 10,
                [offset as u8 + 10; 16],
            )
            .map_err(|e| anyhow::anyhow!("BAR order key rejected: {e:?}"))?;
            let envelope = LifecycleEnvelopeV1::new_bound(order_key, EnvelopePayloadV1::Bar)
                .map_err(|e| anyhow::anyhow!("BAR envelope rejected: {e:?}"))?;
            let event = AdmittedProgramEventV2::issue_for_plan_test(
                &plan,
                envelope,
                vec![
                    (
                        "research.input.close.v1",
                        TypedValueV2::i128(raw_to_i128(close.raw)),
                    ),
                    (
                        "research.input.open.v1",
                        TypedValueV2::i128(raw_to_i128(open.raw)),
                    ),
                ],
            );
            let bar = Bar::new(
                bar_type,
                open,
                open.max(close),
                open.min(close),
                close,
                Quantity::from("100.000"),
                time.into(),
                time.into(),
            );
            Ok((event, bar))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let (events, bars): (Vec<_>, Vec<_>) = bars.into_iter().unzip();
    let owner_input_cut = owner_input_cut(&events);
    let data = bars
        .into_iter()
        .enumerate()
        .flat_map(|(offset, bar)| {
            let time = bar.ts_init;
            let sequence = (offset as u64 + 1) * 10;
            let order_id = (offset as u64 + 1) * 100;
            let cents = i64::try_from(bar.close.as_f64() as i128 * 100)
                .expect("fixture price is an exact integer");
            let mut frame = vec![
                Data::Delta(OrderBookDelta::clear(instrument_id, sequence, time, time)),
                book_level(
                    instrument_id,
                    OrderSide::Buy,
                    cents - 1,
                    100,
                    order_id + 1,
                    sequence + 1,
                    time,
                ),
                book_level(
                    instrument_id,
                    OrderSide::Sell,
                    cents + 1,
                    100,
                    order_id + 2,
                    sequence + 2,
                    time,
                ),
                Data::Bar(bar),
            ];

            if offset % 2 == 0 {
                let aggressor_side = AggressorSide::NoAggressor;
                frame.push(trade_fill(
                    instrument_id,
                    cents,
                    5,
                    aggressor_side,
                    &format!("CORPUS-{offset}-1"),
                    time.as_u64() + 1,
                ));
                frame.push(trade_fill(
                    instrument_id,
                    cents,
                    3,
                    aggressor_side,
                    &format!("CORPUS-{offset}-2"),
                    time.as_u64() + 2,
                ));
            }
            frame
        })
        .collect();
    let trace = Rc::new(RefCell::new(BacktestProgramHostTraceV2::default()));
    let restore_performed = Rc::new(Cell::new(false));
    let strategy = BacktestProgramHostStrategyV2::new(
        StrategyId::from("STRATEGY-DESIGN-V2-BACKTEST-001"),
        plan.clone(),
        artifact.clone(),
        instrument_id,
        bar_type,
        events,
        restore,
        Rc::clone(&restore_performed),
        Rc::clone(&trace),
    )?;

    let mut engine = BacktestEngine::new(BacktestEngineConfig {
        bypass_logging: true,
        run_analysis: false,
        ..Default::default()
    })?;
    engine.add_venue(
        SimulatedVenueConfig::builder()
            .venue(Venue::from("BINANCE"))
            .oms_type(OmsType::Netting)
            .account_type(AccountType::Margin)
            .book_type(BookType::L2_MBP)
            .starting_balances(vec![Money::from("1_000_000 USDT")])
            .bar_execution(false)
            .liquidity_consumption(true)
            .use_random_ids(false)
            .build()?,
    )?;
    engine.add_instrument(&instrument)?;
    engine.add_strategy(strategy)?;
    engine.add_data(data, None, true, true)?;
    engine.run(
        None,
        None,
        Some("strategy-design-v2-stateful-corpus".to_owned()),
        false,
    )?;

    let trace = trace.borrow().clone();
    anyhow::ensure!(
        trace.callback_failure.is_none(),
        "Backtest V2 strategy callback failed: {:?}",
        trace.callback_failure
    );
    let result = engine.get_canonical_result()?.to_bytes()?;
    let cache = engine.kernel().cache();
    let cache = cache.borrow();
    let orders = cache.orders(None, None, None, None, None);
    let native_order_statuses = orders
        .iter()
        .map(|order| order.status().to_string())
        .collect::<Vec<_>>();
    let positions = cache.positions(None, None, None, None, None);
    anyhow::ensure!(
        positions.len() == 1,
        "real Backtest did not retain one net position"
    );
    let native_position_closed = positions[0].is_closed();
    #[cfg(test)]
    let native_final_position_units = positions[0].signed_qty as i64;
    let native_position_events = positions[0].events.len();
    let design_digest = *plan.design_digest().as_bytes();
    let plan_digest = *plan.canonical_plan_digest().as_bytes();
    let artifact_digest = *artifact.identity().as_bytes();
    let consumed_meanings =
        actual_consumption_census(design_digest, plan_digest, artifact_digest, owner_input_cut)?;
    let corpus = serde_json::to_vec(&Corpus {
        design_digest,
        plan_digest,
        artifact_digest,
        trace: &trace,
        final_result: result,
        native_order_statuses: &native_order_statuses,
        native_position_closed,
        native_position_events,
        owner_input_cut,
        consumed_meanings: &consumed_meanings,
    })?;
    Ok(StatefulBacktestNativeReplayEvidenceV2 {
        corpus,
        trace,
        consumed_meanings,
        design_digest,
        plan_digest,
        artifact_digest,
        #[cfg(test)]
        restored: restore_performed.get(),
        #[cfg(test)]
        native_position_closed,
        #[cfg(test)]
        native_final_position_units,
        #[cfg(test)]
        native_order_statuses,
        owner_input_cut,
    })
}

fn actual_consumption_census(
    design_digest: [u8; 32],
    plan_digest: [u8; 32],
    artifact_digest: [u8; 32],
    owner_input_cut: [u8; 32],
) -> anyhow::Result<Vec<NativeReplayConsumedMeaningV2>> {
    let mut census = Vec::with_capacity(ObservationComponentV2::REQUESTED_MEANING.len());
    push_content(
        &mut census,
        ObservationComponentV2::FrozenResearchIntent,
        "stateful-trend-research-intent-v2",
        fixed_digest('b')?,
    )?;
    push_content(
        &mut census,
        ObservationComponentV2::TrialFamily,
        "stateful-trend-trial-family-v2",
        fixed_digest('c')?,
    )?;
    push_content(
        &mut census,
        ObservationComponentV2::TrialFamilyCensusFrontier,
        "stateful-trend-census-frontier-v2",
        fixed_digest('d')?,
    )?;
    push_serialized(
        &mut census,
        ObservationComponentV2::ReplayAuthority,
        &ReplayAuthorityClaimV2::Exploratory,
    )?;
    push_content(
        &mut census,
        ObservationComponentV2::StrategyDesign,
        "stateful-trend-strategy-design-v2",
        array_digest(design_digest)?,
    )?;
    push_content(
        &mut census,
        ObservationComponentV2::StrategyPlan,
        "stateful-trend-strategy-plan-v2",
        array_digest(plan_digest)?,
    )?;
    push_content(
        &mut census,
        ObservationComponentV2::Artifact,
        "stateful-trend-strategy-artifact-v2",
        array_digest(artifact_digest)?,
    )?;
    push_content(
        &mut census,
        ObservationComponentV2::ResolvedOwnerInputs,
        "stateful-trend-owner-input-cut-v2",
        array_digest(owner_input_cut)?,
    )?;

    for (component, identity_text, byte) in [
        (
            ObservationComponentV2::PitScope,
            "stateful-trend-pit-scope-v2",
            '4',
        ),
        (
            ObservationComponentV2::PitSnapshot,
            "stateful-trend-pit-snapshot-v2",
            '5',
        ),
        (
            ObservationComponentV2::UniverseSelection,
            "stateful-trend-universe-v2",
            '6',
        ),
    ] {
        push_content(&mut census, component, identity_text, fixed_digest(byte)?)?;
    }

    for (component, identity_text, version_text) in [
        (
            ObservationComponentV2::CorrectionRule,
            "stateful-trend-correction-rule",
            "v2",
        ),
        (
            ObservationComponentV2::MarketSemantics,
            "stateful-trend-market-semantics",
            "v2",
        ),
    ] {
        push_versioned(&mut census, component, identity_text, version_text)?;
    }
    push_content(
        &mut census,
        ObservationComponentV2::ReplayConfiguration,
        "stateful-trend-replay-config-v2",
        fixed_digest('7')?,
    )?;

    for (component, identity_text, version_text) in [
        (
            ObservationComponentV2::RuntimeKernel,
            "strategy-shared-lifecycle-kernel",
            "v1",
        ),
        (ObservationComponentV2::Simulator, "vibe-sim-exchange", "v1"),
        (
            ObservationComponentV2::CostModel,
            "vibe-maker-taker-instrument-fee-model",
            "v1",
        ),
        (
            ObservationComponentV2::SlippageModel,
            "stateful-trend-book-fill-model",
            "v1",
        ),
        (
            ObservationComponentV2::CapacityModel,
            "stateful-trend-bounded-capacity-model",
            "v1",
        ),
        (
            ObservationComponentV2::RunnerOperationalProfile,
            "backtest-native-runner",
            "v2",
        ),
        (
            ObservationComponentV2::DiagnosticPolicy,
            "backtest-diagnostic-policy",
            "v2",
        ),
    ] {
        push_versioned(&mut census, component, identity_text, version_text)?;
    }
    push_serialized(
        &mut census,
        ObservationComponentV2::DeterministicSeed,
        &7_u64,
    )?;
    push_serialized(
        &mut census,
        ObservationComponentV2::ReplayWindow,
        &ReplayWindowV2 {
            start_event_ns: 1_000_000_000,
            end_event_ns_exclusive: 9_000_000_000,
        },
    )?;

    for (component, identity_text, version_text) in [
        (
            ObservationComponentV2::Calendar,
            "continuous-crypto-calendar",
            "v1",
        ),
        (
            ObservationComponentV2::Session,
            "continuous-crypto-session",
            "v1",
        ),
        (ObservationComponentV2::TimeZone, "utc", "v1"),
    ] {
        push_versioned(&mut census, component, identity_text, version_text)?;
    }
    push_content(
        &mut census,
        ObservationComponentV2::CorporateActionCut,
        "no-corporate-actions-cut",
        fixed_digest('8')?,
    )?;
    push_content(
        &mut census,
        ObservationComponentV2::HistoricalMembershipCut,
        "ethusdt-membership-cut",
        fixed_digest('9')?,
    )?;
    anyhow::ensure!(
        census
            .iter()
            .map(|meaning| meaning.component)
            .eq(ObservationComponentV2::REQUESTED_MEANING),
        "Native Replay actual-consumption census is incomplete or out of order"
    );
    Ok(census)
}

fn push_content(
    census: &mut Vec<NativeReplayConsumedMeaningV2>,
    component: ObservationComponentV2,
    identity_text: &str,
    digest: CanonicalDigestV2,
) -> anyhow::Result<()> {
    push_consumed(census, component, opaque_identity(identity_text)?, digest)
}

fn push_versioned(
    census: &mut Vec<NativeReplayConsumedMeaningV2>,
    component: ObservationComponentV2,
    identity_text: &str,
    version_text: &str,
) -> anyhow::Result<()> {
    let value = VersionedIdentityV2 {
        identity: opaque_identity(identity_text)?,
        version: opaque_identity(version_text)?,
    };
    let digest = canonical_digest("vibe.backtest.request-component.v2", &value)?;
    push_consumed(census, component, value.version, digest)
}

fn push_serialized<T: Serialize>(
    census: &mut Vec<NativeReplayConsumedMeaningV2>,
    component: ObservationComponentV2,
    value: &T,
) -> anyhow::Result<()> {
    let digest = canonical_digest("vibe.backtest.request-component.v2", value)?;
    let identity_digest = canonical_digest(
        "vibe.backtest.request-component-identity.v2",
        &(component, &digest),
    )?;
    let identity = opaque_identity(&format!(
        "backtest-request-component-v2-{}",
        identity_digest.as_str().trim_start_matches("blake3:")
    ))?;
    push_consumed(census, component, identity, digest)
}

fn push_consumed(
    census: &mut Vec<NativeReplayConsumedMeaningV2>,
    component: ObservationComponentV2,
    observed_meaning_identity: OpaqueIdentityV2,
    observed_meaning_digest: CanonicalDigestV2,
) -> anyhow::Result<()> {
    let observation_digest = canonical_digest(
        "vibe.strategy-factory.native-replay-consumption.v2",
        &(
            component,
            &observed_meaning_identity,
            &observed_meaning_digest,
        ),
    )?;
    census.push(NativeReplayConsumedMeaningV2 {
        component,
        observed_meaning_identity,
        observed_meaning_digest,
        observation_digest,
    });
    Ok(())
}

fn opaque_identity(value: &str) -> anyhow::Result<OpaqueIdentityV2> {
    OpaqueIdentityV2::try_from(value.to_owned()).map_err(Into::into)
}

fn fixed_digest(byte: char) -> anyhow::Result<CanonicalDigestV2> {
    CanonicalDigestV2::try_from(format!("sha256:{}", byte.to_string().repeat(64)))
        .map_err(Into::into)
}

fn array_digest(bytes: [u8; 32]) -> anyhow::Result<CanonicalDigestV2> {
    let hex = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    CanonicalDigestV2::try_from(format!("sha256:{hex}")).map_err(Into::into)
}

fn canonical_digest<T: Serialize>(domain: &str, value: &T) -> anyhow::Result<CanonicalDigestV2> {
    let bytes = serde_json::to_vec(value)?;
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(b"\0");
    hasher.update(&bytes);
    CanonicalDigestV2::try_from(format!("blake3:{}", hasher.finalize().to_hex()))
        .map_err(Into::into)
}

fn owner_input_cut(events: &[AdmittedProgramEventV2]) -> [u8; 32] {
    let mut hasher = sha2::Sha256::new();
    hasher.update(b"strategy.stateful-backtest.owner-input-cut.v2\0");
    for event in events {
        hasher.update(event.admitted_identity().as_bytes());
    }
    hasher.finalize().into()
}

fn trade_fill(
    instrument_id: InstrumentId,
    cents: i64,
    units: u64,
    aggressor_side: AggressorSide,
    trade_id: &str,
    time_ns: u64,
) -> Data {
    let price = format!("{}.{:02}", cents / 100, cents.unsigned_abs() % 100);
    Data::Trade(TradeTick::new(
        instrument_id,
        Price::from(price.as_str()),
        Quantity::new(units as f64, 3),
        aggressor_side,
        TradeId::from(trade_id),
        time_ns.into(),
        time_ns.into(),
    ))
}

fn book_level(
    instrument_id: InstrumentId,
    side: OrderSide,
    cents: i64,
    units: u64,
    order_id: u64,
    sequence: u64,
    time: vibe_core::UnixNanos,
) -> Data {
    let price = format!("{}.{:02}", cents / 100, cents.unsigned_abs() % 100);
    Data::Delta(OrderBookDelta::new(
        instrument_id,
        BookAction::Add,
        BookOrder::new(
            side,
            Price::from(price.as_str()),
            Quantity::new(units as f64, 3),
            order_id,
        ),
        0,
        sequence,
        time,
        time,
    ))
}

fn fixture(instrument_id: InstrumentId) -> anyhow::Result<(StrategyPlanV2, StrategyArtifactV2)> {
    let (plan, artifact, _, _) = fixture_parts(instrument_id, None)?;
    Ok((plan, artifact))
}

#[cfg(test)]
pub(crate) fn preparation_fixture(
    instrument_id: InstrumentId,
    meaning: u8,
) -> anyhow::Result<(
    StrategyPlanV2,
    StrategyArtifactV2,
    VerifiedStrategyInputBindingsV2,
)> {
    let (plan, artifact, design, owner_bindings) = fixture_parts(instrument_id, Some(meaning))?;
    let verified_bindings = verified_strategy_input_bindings_for_test(&design, owner_bindings);
    Ok((plan, artifact, verified_bindings))
}

fn fixture_parts(
    instrument_id: InstrumentId,
    meaning: Option<u8>,
) -> anyhow::Result<BacktestFixtureParts> {
    let mut design = stateful_backtest_design();

    if let Some(meaning) = meaning {
        design.research_request_identity = BindingDigest::from_untrusted_bytes([meaning; 32]);
        design.intent_identity = BindingDigest::from_untrusted_bytes([meaning.wrapping_add(1); 32]);
        design.intent_digest = BindingDigest::from_untrusted_bytes([meaning.wrapping_add(2); 32]);
    }

    for input in &mut design.inputs {
        input.instrument = instrument_id.to_string();
        input.timeframe = "1-MINUTE".to_owned();
    }
    design.state[0].initial = TypedConstantV2::Bytes { value: vec![0] };
    design.plugins[0].max_fuel = 10_000_000;
    let manifest = &design.plugins[0];
    let wasm = stateful_plugin_module(manifest)?;
    let build = VerifiedPluginCargoBuildV2::verify(
        manifest,
        PluginCargoBuildEvidenceV2 {
            wasm_one: &wasm,
            wasm_two: &wasm,
            implementation_capsule_digest: BindingDigest::from_untrusted_bytes([31; 32]),
            source_entry_digest: BindingDigest::from_untrusted_bytes([41; 32]),
            verified_build_receipt_digest: BindingDigest::from_untrusted_bytes([51; 32]),
        },
    )?;
    let receipt = issue_plugin_implementation_receipt_v2_for_test(
        manifest,
        build.implementation_capsule_digest(),
        build.source_entry_digest(),
        build.module_digest(),
        build.verified_build_receipt_digest(),
        "strategy.plugin.compute.v2",
        manifest.abi_version,
        manifest
            .capability_ids
            .iter()
            .map(|id| (id.clone(), 1))
            .collect(),
    );
    let owner_bindings = bindings(&design);
    let StrategyCompilationV2::Compiled(plan) =
        compile_with_binding_and_implementation_receipts_for_test(
            design.clone(),
            owner_bindings.clone(),
            vec![receipt],
        )
    else {
        anyhow::bail!("stateful Backtest V2 fixture did not compile")
    };
    let artifact = StrategyArtifactV2::issue(&plan, vec![build])
        .map_err(|error: StrategyArtifactV2Error| anyhow::anyhow!(error))?;
    Ok((*plan, artifact, design, owner_bindings))
}

pub(crate) fn stateful_plugin_module(manifest: &PluginManifestV2) -> anyhow::Result<Vec<u8>> {
    let phases = [
        Phase::Enter,
        Phase::HoldZero,
        Phase::HoldOne,
        Phase::Add,
        Phase::HoldTwo,
        Phase::Reduce,
        Phase::HoldThree,
        Phase::Exit,
        Phase::HoldFour,
    ];
    let bodies = phases
        .into_iter()
        .map(|phase| {
            output_frame(manifest, phase)
                .encode(manifest)
                .map(|bytes| bytes[96..].to_vec())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut pointers = Vec::with_capacity(bodies.len());
    let mut next = STATIC_PTR;
    for body in &bodies {
        pointers.push(next);
        next += i32::try_from(body.len() + 32)?;
    }
    let input = sample_input_frame(manifest).encode(manifest)?;
    let current_position_ordinal = manifest
        .input_ports
        .iter()
        .position(|port| port.semantic_id == "input.current-position.v1")
        .context("current-position input port")?;
    let position_ptr =
        INPUT_PTR + i32::try_from(payload_offset(&input, current_position_ordinal as u16)?)?;
    let open_ordinal = manifest
        .input_ports
        .iter()
        .position(|port| port.semantic_id == "input.open.v1")
        .context("open input port")?;
    let open_ptr = INPUT_PTR + i32::try_from(payload_offset(&input, open_ordinal as u16)?)?;
    let close_ordinal = manifest
        .input_ports
        .iter()
        .position(|port| port.semantic_id == "input.close.v1")
        .context("close input port")?;
    let close_ptr = INPUT_PTR + i32::try_from(payload_offset(&input, close_ordinal as u16)?)?;
    let state_ptr = INPUT_PTR + i32::try_from(payload_offset(&input, u16::MAX)?)?;
    let output_capacity = frame_capacity(&manifest.output_ports, manifest.state.max_bytes);
    let input_capacity = frame_capacity(&manifest.input_ports, manifest.state.max_bytes);

    let image =
        |index: usize| output_image(&bodies[index], pointers[index], manifest.output_ports.len());
    let field_relation = |opcode: u8| {
        let mut condition = i32_const(close_ptr);
        condition.push(0x29);
        condition.extend([3, 0]);
        condition.extend(i32_const(open_ptr));
        condition.push(0x29);
        condition.extend([3, 0]);
        condition.push(opcode);
        condition
    };
    let choose_position = |expected: i64, relation_opcode: u8, yes: Vec<u8>, no: Vec<u8>| {
        let mut condition = i32_const(position_ptr);
        condition.push(0x29);
        condition.extend([3, 0]);
        condition.extend(i64_const(expected));
        condition.push(0x51);
        condition.extend(field_relation(relation_opcode));
        condition.push(0x71);
        if_else(condition, yes, no)
    };
    let state_three = choose_position(8, 0x55, image(7), image(6));
    let state_two = choose_position(16, 0x55, image(5), image(4));
    let state_one = choose_position(8, 0x55, image(3), image(2));
    let choose_state = |state: i32, yes: Vec<u8>, no: Vec<u8>| {
        let mut condition = i32_const(state_ptr);
        condition.push(0x2d);
        condition.extend([0, 0]);
        condition.extend(i32_const(state));
        condition.push(0x46);
        if_else(condition, yes, no)
    };
    let invoke = choose_state(
        0,
        if_else(field_relation(0x55), image(0), image(1)),
        choose_state(
            1,
            state_one,
            choose_state(2, state_two, choose_state(3, state_three, image(8))),
        ),
    );

    let mut wasm = b"\0asm\x01\0\0\0".to_vec();
    section(&mut wasm, 1, &[2, 0x60, 0, 1, 0x7f, 0x60, 1, 0x7f, 1, 0x7f]);
    section(&mut wasm, 3, &[5, 0, 0, 0, 0, 1]);
    section(&mut wasm, 5, &[1, 1, 1, 16]);
    let mut exports = vec![6];
    export(&mut exports, "memory", 2, 0);

    for (name, index) in [
        ("strategy_factory_plugin_input_ptr_v2", 0),
        ("strategy_factory_plugin_input_capacity_v2", 1),
        ("strategy_factory_plugin_output_ptr_v2", 2),
        ("strategy_factory_plugin_output_capacity_v2", 3),
        ("strategy_factory_plugin_invoke_v2", 4),
    ] {
        export(&mut exports, name, 0, index);
    }
    section(&mut wasm, 7, &exports);
    let mut code = vec![5];

    for value in [
        INPUT_PTR,
        input_capacity as i32,
        OUTPUT_PTR,
        output_capacity as i32,
    ] {
        function_body(&mut code, &i32_const(value));
    }
    function_body(&mut code, &invoke);
    section(&mut wasm, 10, &code);
    let mut data = Vec::new();
    u32_leb(&mut data, bodies.len() as u32);
    for (pointer, body) in pointers.into_iter().zip(bodies) {
        data.push(0);
        data.extend(i32_const(pointer));
        data.push(0x0b);
        u32_leb(&mut data, body.len() as u32);
        data.extend(body);
    }
    section(&mut wasm, 11, &data);
    Ok(wasm)
}

fn sample_input_frame(manifest: &PluginManifestV2) -> PluginFrameV2 {
    let values = manifest
        .input_ports
        .iter()
        .map(|port| match port.value_type {
            ValueTypeV2::I32 => TypedValueV2::i32(0),
            ValueTypeV2::I64 => TypedValueV2::i64(0),
            ValueTypeV2::U64 => TypedValueV2::u64(0),
            ValueTypeV2::I128 => TypedValueV2::i128(0),
            ValueTypeV2::Bytes => TypedValueV2::new(ValueTypeV2::Bytes, Vec::new()).unwrap(),
            ValueTypeV2::Digest32 => {
                TypedValueV2::digest(BindingDigest::from_untrusted_bytes([1; 32]))
            }
            ValueTypeV2::StableIdentity16 => TypedValueV2::stable_identity([1; 16]),
            ValueTypeV2::PositionIntentV1
            | ValueTypeV2::TargetVariantV1
            | ValueTypeV2::ProtectionVariantV1 => unreachable!("fixture has no semantic input"),
        })
        .collect();
    PluginFrameV2 {
        kind: PluginFrameKindV2::Input,
        manifest_digest: BindingDigest::from_untrusted_bytes([1; 32]),
        module_identity: BindingDigest::from_untrusted_bytes([2; 32]),
        invocation_identity: [3; 16],
        values,
        state: TypedValueV2::new(ValueTypeV2::Bytes, vec![0]).unwrap(),
    }
}

fn output_frame(manifest: &PluginManifestV2, phase: Phase) -> PluginFrameV2 {
    let (position, target, units, protection, stop, take, distance, trailing, state) = match phase {
        Phase::Enter => (
            lifecycle_v1::ENTER_SEMANTIC_ID,
            lifecycle_v1::TARGET_POSITION_SEMANTIC_ID,
            8,
            "kernel.protection.replace.v1",
            8_500,
            12_000,
            500,
            9_000,
            1,
        ),
        Phase::HoldZero => hold(0),
        Phase::HoldOne => hold(1),
        Phase::Add => (
            lifecycle_v1::ADD_SEMANTIC_ID,
            lifecycle_v1::TARGET_POSITION_SEMANTIC_ID,
            16,
            lifecycle_v1::TRAILING_ADJUST_SEMANTIC_ID,
            0,
            0,
            0,
            9_500,
            2,
        ),
        Phase::HoldTwo => hold(2),
        Phase::Reduce => (
            lifecycle_v1::REDUCE_SEMANTIC_ID,
            lifecycle_v1::TARGET_POSITION_SEMANTIC_ID,
            8,
            "kernel.protection.keep.v1",
            0,
            0,
            0,
            0,
            3,
        ),
        Phase::HoldThree => hold(3),
        Phase::Exit => (
            lifecycle_v1::EXIT_SEMANTIC_ID,
            lifecycle_v1::TARGET_POSITION_SEMANTIC_ID,
            0,
            "kernel.protection.clear.v1",
            0,
            0,
            0,
            0,
            4,
        ),
        Phase::HoldFour => hold(4),
    };
    let values = manifest
        .output_ports
        .iter()
        .map(|port| match port.semantic_id.as_str() {
            "proposal.position-intent.v1" => {
                TypedValueV2::new(ValueTypeV2::PositionIntentV1, position.as_bytes()).unwrap()
            }
            "proposal.target-variant.v1" => {
                TypedValueV2::new(ValueTypeV2::TargetVariantV1, target.as_bytes()).unwrap()
            }
            "proposal.target-position.v1" | "proposal.reconciliation-target.v1" => {
                TypedValueV2::i64(units)
            }
            "proposal.target-weight.v1" => TypedValueV2::i32(0),
            "proposal.rebalance-sequence.v1" => TypedValueV2::u64(0),
            "proposal.protection-variant.v1" => {
                TypedValueV2::new(ValueTypeV2::ProtectionVariantV1, protection.as_bytes()).unwrap()
            }
            "proposal.stop-loss.v1" => TypedValueV2::i64(stop),
            "proposal.take-profit.v1" => TypedValueV2::i64(take),
            "proposal.trailing-distance.v1" => TypedValueV2::u64(distance),
            "proposal.trailing-stop.v1" => TypedValueV2::i64(trailing),
            value => panic!("unexpected output port {value}"),
        })
        .collect();
    PluginFrameV2 {
        kind: PluginFrameKindV2::Output,
        manifest_digest: BindingDigest::from_untrusted_bytes([1; 32]),
        module_identity: BindingDigest::from_untrusted_bytes([2; 32]),
        invocation_identity: [3; 16],
        values,
        state: TypedValueV2::new(ValueTypeV2::Bytes, vec![state]).unwrap(),
    }
}

fn hold(
    state: u8,
) -> (
    &'static str,
    &'static str,
    i64,
    &'static str,
    i64,
    i64,
    u64,
    i64,
    u8,
) {
    (
        lifecycle_v1::HOLD_SEMANTIC_ID,
        "kernel.target.keep.v1",
        0,
        "kernel.protection.keep.v1",
        0,
        0,
        0,
        0,
        state,
    )
}

fn payload_offset(bytes: &[u8], wanted: u16) -> anyhow::Result<usize> {
    let mut cursor = 96;
    while cursor < bytes.len() {
        let ordinal = u16::from_le_bytes(bytes[cursor..cursor + 2].try_into()?);
        let len = u32::from_le_bytes(bytes[cursor + 4..cursor + 8].try_into()?) as usize;
        if ordinal == wanted {
            return Ok(cursor + 8);
        }
        cursor += 8 + len;
    }
    anyhow::bail!("plugin frame ordinal {wanted} is absent")
}

fn output_image(body: &[u8], pointer: i32, output_count: usize) -> Vec<u8> {
    let mut bytes = Vec::new();
    for offset in (0..96).step_by(8) {
        bytes.extend(i32_const(OUTPUT_PTR));
        bytes.extend(i32_const(INPUT_PTR));
        bytes.push(0x29);
        bytes.push(3);
        u32_leb(&mut bytes, offset);
        bytes.push(0x37);
        bytes.push(3);
        u32_leb(&mut bytes, offset);
    }
    store_i32(&mut bytes, OUTPUT_PTR, i32::from_le_bytes(*b"SFPO"), 0);
    store_i32_16(&mut bytes, OUTPUT_PTR, (output_count + 1) as i32, 88);
    store_i32(&mut bytes, OUTPUT_PTR, body.len() as i32, 92);
    for offset in 0..body.len() {
        bytes.extend(i32_const(OUTPUT_PTR + 96));
        bytes.extend(i32_const(pointer));
        bytes.push(0x2d);
        bytes.push(0);
        u32_leb(&mut bytes, offset as u32);
        bytes.push(0x3a);
        bytes.push(0);
        u32_leb(&mut bytes, offset as u32);
    }
    bytes.extend(i32_const((96 + body.len()) as i32));
    bytes
}

fn if_else(mut condition: Vec<u8>, yes: Vec<u8>, no: Vec<u8>) -> Vec<u8> {
    condition.extend([0x04, 0x7f]);
    condition.extend(yes);
    condition.push(0x05);
    condition.extend(no);
    condition.push(0x0b);
    condition
}

fn frame_capacity(ports: &[super::strategy_design_v2::PortContractV2], state: u32) -> usize {
    96 + (ports.len() + 1) * 8
        + state as usize
        + ports
            .iter()
            .map(|port| port.max_bytes as usize)
            .sum::<usize>()
}

fn store_i32(bytes: &mut Vec<u8>, ptr: i32, value: i32, offset: u32) {
    bytes.extend(i32_const(ptr));
    bytes.extend(i32_const(value));
    bytes.push(0x36);
    bytes.push(2);
    u32_leb(bytes, offset);
}

fn store_i32_16(bytes: &mut Vec<u8>, ptr: i32, value: i32, offset: u32) {
    bytes.extend(i32_const(ptr));
    bytes.extend(i32_const(value));
    bytes.push(0x3b);
    bytes.push(1);
    u32_leb(bytes, offset);
}

fn section(wasm: &mut Vec<u8>, id: u8, payload: &[u8]) {
    wasm.push(id);
    u32_leb(wasm, payload.len() as u32);
    wasm.extend(payload);
}

fn export(bytes: &mut Vec<u8>, export_name: &str, kind: u8, index: u32) {
    name(bytes, export_name);
    bytes.push(kind);
    u32_leb(bytes, index);
}

fn name(bytes: &mut Vec<u8>, value: &str) {
    u32_leb(bytes, value.len() as u32);
    bytes.extend(value.as_bytes());
}

fn function_body(code: &mut Vec<u8>, operators: &[u8]) {
    let mut bytes = vec![0];
    bytes.extend(operators);
    bytes.push(0x0b);
    u32_leb(code, bytes.len() as u32);
    code.extend(bytes);
}

fn i32_const(value: i32) -> Vec<u8> {
    signed_leb(0x41, i64::from(value))
}

fn i64_const(value: i64) -> Vec<u8> {
    signed_leb(0x42, value)
}

fn raw_to_i128<T: Into<i128>>(raw: T) -> i128 {
    raw.into()
}

fn signed_leb(opcode: u8, mut value: i64) -> Vec<u8> {
    let mut bytes = vec![opcode];

    loop {
        let byte = value as u8 & 0x7f;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        bytes.push(if done { byte } else { byte | 0x80 });
        if done {
            return bytes;
        }
    }
}

fn u32_leb(bytes: &mut Vec<u8>, mut value: u32) {
    loop {
        let byte = value as u8 & 0x7f;
        value >>= 7;
        bytes.push(if value == 0 { byte } else { byte | 0x80 });
        if value == 0 {
            return;
        }
    }
}
