//! Building a bounded feature program's graph: nodes, state cells and the constants they read,
//! each node after every node it reads.
//!
//! Both authoring surfaces emit their graphs through this one builder - the single-threshold
//! author and the authoring language - so a node, a cell or a constant is spelled one way however
//! the program was stated.

use crate::bounded_feature_program_v1::{
    BoundedFeatureAvailabilityV1, BoundedFeatureConstantValueV1, BoundedFeatureInitialStateV1,
    BoundedFeatureInputBindingV1, BoundedFeatureNodeV1, BoundedFeatureOutputPortV1,
    BoundedFeatureParametersV1, BoundedFeaturePredicateV1, BoundedFeatureRoundingV1,
    BoundedFeatureStateCellV1, BoundedFeatureStateKindV1, BoundedFeatureValueRefV1,
    BoundedFeatureValueTypeV1,
};

/// The one output port every node this builder emits carries.
pub(crate) const VALUE_PORT: &str = "value";
/// The unit of a 0-or-1 signal, which `select` computes with where a boolean cannot go.
pub(crate) const SIGNAL_UNIT: &str = "SIGNAL";

pub(crate) const COMPARE: &str = "bfp.fixed-i128.compare.equal-scale.v1";
pub(crate) const SELECT: &str = "bfp.fixed-i128.select.equal-scale.v1";
pub(crate) const ADD: &str =
    "bfp.fixed-i128.add.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1";
pub(crate) const SUB: &str =
    "bfp.fixed-i128.sub.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1";
pub(crate) const MUL: &str =
    "bfp.fixed-i128.mul.max-scale-38.explicit-rescale.i256-single-round.nearest-ties-to-even.v1";

pub(crate) fn node_value(node_id: &str) -> BoundedFeatureValueRefV1 {
    BoundedFeatureValueRefV1::NodeOutput {
        node_id: node_id.to_owned(),
        port_id: VALUE_PORT.to_owned(),
    }
}

pub(crate) fn prior_state(state_id: &str) -> BoundedFeatureValueRefV1 {
    BoundedFeatureValueRefV1::PriorState {
        state_id: state_id.to_owned(),
    }
}

pub(crate) fn fixed_type(unit: &str, scale: u8) -> BoundedFeatureValueTypeV1 {
    BoundedFeatureValueTypeV1::FixedI128 {
        unit: unit.to_owned(),
        scale,
    }
}

/// The nodes, state cells and constants of one program, each node after every node it reads.
#[derive(Default)]
pub(crate) struct Graph {
    pub(crate) nodes: Vec<BoundedFeatureNodeV1>,
    pub(crate) state_cells: Vec<BoundedFeatureStateCellV1>,
    pub(crate) constants: Vec<(String, BoundedFeatureConstantValueV1)>,
}

impl Graph {
    pub(crate) fn constant(
        &mut self,
        constant_id: &str,
        value: BoundedFeatureConstantValueV1,
    ) -> BoundedFeatureValueRefV1 {
        if !self.constants.iter().any(|(id, _)| id == constant_id) {
            self.constants.push((constant_id.to_owned(), value));
        }
        BoundedFeatureValueRefV1::Constant {
            constant_id: constant_id.to_owned(),
        }
    }

    pub(crate) fn fixed(
        &mut self,
        constant_id: &str,
        coefficient: i128,
        unit: &str,
        scale: u8,
    ) -> BoundedFeatureValueRefV1 {
        self.constant(
            constant_id,
            BoundedFeatureConstantValueV1::FixedI128 {
                coefficient,
                unit: unit.to_owned(),
                scale,
            },
        )
    }

    pub(crate) fn node(
        &mut self,
        node_id: &str,
        primitive: &str,
        inputs: Vec<(&str, BoundedFeatureValueRefV1)>,
        parameters: BoundedFeatureParametersV1,
        value_type: BoundedFeatureValueTypeV1,
    ) -> BoundedFeatureValueRefV1 {
        if !self.nodes.iter().any(|node| node.node_id == node_id) {
            self.nodes.push(BoundedFeatureNodeV1 {
                node_id: node_id.to_owned(),
                primitive_semantic_id: primitive.to_owned(),
                input_bindings: inputs
                    .into_iter()
                    .map(|(port_id, source)| BoundedFeatureInputBindingV1 {
                        port_id: port_id.to_owned(),
                        source,
                        require_ready: false,
                    })
                    .collect(),
                output_ports: vec![BoundedFeatureOutputPortV1 {
                    port_id: VALUE_PORT.to_owned(),
                    value_type,
                    availability: BoundedFeatureAvailabilityV1::Ready,
                }],
                parameters,
                state_id: None,
                update_clock: None,
            });
        }
        node_value(node_id)
    }

    pub(crate) fn compare(
        &mut self,
        node_id: &str,
        a: BoundedFeatureValueRefV1,
        b: BoundedFeatureValueRefV1,
        predicate: BoundedFeaturePredicateV1,
    ) -> BoundedFeatureValueRefV1 {
        self.node(
            node_id,
            COMPARE,
            vec![("a", a), ("b", b)],
            BoundedFeatureParametersV1::ComparisonPredicate { predicate },
            BoundedFeatureValueTypeV1::Boolean,
        )
    }

    pub(crate) fn select(
        &mut self,
        node_id: &str,
        condition: BoundedFeatureValueRefV1,
        when_true: BoundedFeatureValueRefV1,
        when_false: BoundedFeatureValueRefV1,
        value_type: BoundedFeatureValueTypeV1,
    ) -> BoundedFeatureValueRefV1 {
        self.node(
            node_id,
            SELECT,
            vec![
                ("condition", condition),
                ("when_true", when_true),
                ("when_false", when_false),
            ],
            BoundedFeatureParametersV1::None,
            value_type,
        )
    }

    /// An exact sum or product: the declared scale is the one the operands' scales produce, so
    /// the rounding the primitive names never applies.
    pub(crate) fn arithmetic(
        &mut self,
        node_id: &str,
        primitive: &str,
        a: BoundedFeatureValueRefV1,
        b: BoundedFeatureValueRefV1,
        unit: &str,
        scale: u8,
    ) -> BoundedFeatureValueRefV1 {
        self.node(
            node_id,
            primitive,
            vec![("a", a), ("b", b)],
            BoundedFeatureParametersV1::OutputScale {
                output_scale: scale,
                rounding: BoundedFeatureRoundingV1::NearestTiesToEven,
            },
            fixed_type(unit, scale),
        )
    }

    /// A strategy state cell holding one fixed-point value, written by `writer` on every event.
    pub(crate) fn cell(
        &mut self,
        state_id: &str,
        writer: &str,
        value_type: BoundedFeatureValueTypeV1,
        initial: &str,
    ) {
        self.state_cells.push(BoundedFeatureStateCellV1 {
            state_id: state_id.to_owned(),
            writer_node_id: writer.to_owned(),
            state_kind: BoundedFeatureStateKindV1::Strategy {
                value_type,
                source_port_id: VALUE_PORT.to_owned(),
            },
            initial: BoundedFeatureInitialStateV1::Constant {
                constant_id: initial.to_owned(),
            },
            max_bytes: 16,
        });
    }

    pub(crate) fn signal(&mut self, value: i128) -> BoundedFeatureValueRefV1 {
        let id = if value == 0 {
            "signal-zero"
        } else {
            "signal-one"
        };
        self.fixed(id, value, SIGNAL_UNIT, 0)
    }

    /// 1 when any of `conditions` holds and 0 otherwise.
    pub(crate) fn any_of(
        &mut self,
        prefix: &str,
        conditions: &[BoundedFeatureValueRefV1],
    ) -> BoundedFeatureValueRefV1 {
        let one = self.signal(1);
        let mut any = self.signal(0);
        for (index, condition) in conditions.iter().enumerate().rev() {
            any = self.select(
                &format!("{prefix}-{index}"),
                condition.clone(),
                one.clone(),
                any,
                fixed_type(SIGNAL_UNIT, 0),
            );
        }
        any
    }

    /// Whether a signal is 1.
    pub(crate) fn holds(
        &mut self,
        node_id: &str,
        signal: BoundedFeatureValueRefV1,
    ) -> BoundedFeatureValueRefV1 {
        let zero = self.signal(0);
        self.compare(node_id, signal, zero, BoundedFeaturePredicateV1::Greater)
    }
}
