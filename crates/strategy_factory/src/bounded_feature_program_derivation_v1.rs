//! Deterministic assembly of a Bounded Feature Program proposal from declared meaning.
//!
//! `docs/owners/rd.md` fixes who authors what: a proposer declares Research meaning, and the Owner
//! admits it. `BoundedFeatureProgramProposalV1` has twenty fields, and most of them are not meaning
//! at all - schema and semantic versions, seven identity and digest fields bound to the Design, the
//! pinned catalog identity, the first-party SDK digest, and the four resource bounds the plugin
//! manifest already fixes. A proposer that had to emit those would be restating facts it cannot
//! know, and every restatement is a chance to disagree with the Design it claims to serve.
//!
//! This module derives all of them. What a proposer declares is the part only it can decide: the
//! typed node graph, its constants and state cells, the decision-table terminals, the warmup
//! contract, the graph's own bounds, and for each declared input role the value port the graph
//! reads and the clock that updates it.
//!
//! Derivation is not admission. The result is still a proposal, carries no Owner authority, and
//! must pass the same canonical verification as one assembled by hand.

use std::collections::BTreeSet;

use thiserror::Error;
use vibe_data::owner::source_binding::BindingDigest;
use vibe_indicators_kernel::PrimitiveCatalogV1;

use crate::{
    bounded_feature_program_lowerer_v1::first_party_bfp_sdk_source_digest_v1,
    bounded_feature_program_v1::{
        BOUNDED_FEATURE_CATALOG_SEMANTIC_VERSION_V1, BOUNDED_FEATURE_PROGRAM_SCHEMA_V1,
        BOUNDED_FEATURE_PROGRAM_SEMANTIC_VERSION_V1, BoundedFeatureBoundsV1, BoundedFeatureClockV1,
        BoundedFeatureConstantV1, BoundedFeatureInputV1, BoundedFeatureNodeV1,
        BoundedFeatureProgramProposalV1, BoundedFeatureProposalDecisionTableV1,
        BoundedFeatureStateCellV1, BoundedFeatureWarmupContractV1,
    },
    strategy_design_v2::StrategyDesignV2,
    strategy_plan_v2::{
        StrategyDesignPreparationV2, VerifiedStrategyInputBindingsV2, plugin_manifest_digest,
        prepare_strategy_design_v2, strategy_input_role_identity_v2,
    },
};

/// Market Data is the only Owner a bounded feature program reads facts from.
const MARKET_DATA_OWNER_SEMANTIC_ID_V1: &str = "market-data.owner.v1";

/// What a proposer decides about one declared input role.
///
/// Everything else about the role - its fact type, timeframe, unit, scale and role identity - is
/// the Design's and is derived from it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BoundedFeatureInputMeaningV1 {
    /// `InputRoleV2::semantic_id` of the Design role this describes.
    pub role_semantic_id: String,
    /// Port the graph reads this role's value from.
    pub value_port_semantic_id: String,
    /// Trigger or sample clock that advances the role.
    pub update_clock: BoundedFeatureClockV1,
}

/// Bounds on the graph's own shape, which the plugin manifest does not fix.
///
/// The four resource bounds the manifest does fix - fuel, linear memory, invocations per event and
/// state bytes - are absent here on purpose: a proposer restating them could only agree or be
/// rejected, so it is not asked.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BoundedFeatureGraphBoundsV1 {
    /// Maximum node count.
    pub max_nodes: u16,
    /// Maximum edge count.
    pub max_edges: u16,
    /// Maximum graph depth.
    pub max_depth: u16,
    /// Maximum port count.
    pub max_ports: u16,
    /// Maximum constant count.
    pub max_constants: u16,
    /// Maximum fan-out from one output.
    pub max_fan_out: u16,
    /// Maximum declared lag.
    pub max_lag: u32,
    /// Maximum rolling window.
    pub max_window: u32,
    /// Maximum state-cell count.
    pub max_state_cells: u16,
    /// Maximum decision-table branch count.
    pub max_decision_branches: u16,
    /// Maximum generated source bytes.
    pub max_source_bytes: u32,
    /// Maximum generated Wasm bytes.
    pub max_wasm_bytes: u32,
}

/// Everything a proposer declares, and nothing it cannot decide.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BoundedFeatureProgramMeaningV1 {
    /// Bounded plugin from the Design this program builds.
    pub plugin_semantic_id: String,
    /// One entry per declared Design input role, in any order.
    pub inputs: Vec<BoundedFeatureInputMeaningV1>,
    /// Frozen constants the graph references.
    pub constants: Vec<BoundedFeatureConstantV1>,
    /// Declared state cells.
    pub state_cells: Vec<BoundedFeatureStateCellV1>,
    /// The typed DAG.
    pub nodes: Vec<BoundedFeatureNodeV1>,
    /// Terminal outputs the lifecycle kernel applies.
    pub proposal_decision_table: BoundedFeatureProposalDecisionTableV1,
    /// Warmup contract.
    pub warmup: BoundedFeatureWarmupContractV1,
    /// Bounds on the graph's own shape.
    pub graph_bounds: BoundedFeatureGraphBoundsV1,
}

/// Why declared meaning could not be assembled against a Design.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BoundedFeatureProgramDerivationErrorV1 {
    /// The Design does not canonicalize, so it has no identity to bind to.
    #[error("the Strategy Design is not canonicalizable")]
    Design,
    /// The declared plugin is not one the Design carries.
    #[error("the Design declares no bounded plugin named by this meaning")]
    UnknownPlugin,
    /// Meaning names an input role the Design does not declare.
    #[error("meaning names an input role the Design does not declare: {0}")]
    UnknownInputRole(String),
    /// Meaning names one input role more than once.
    #[error("meaning names one input role more than once: {0}")]
    DuplicateInputRole(String),
    /// A Design input role has no declared meaning.
    #[error("the Design declares an input role this meaning leaves out: {0}")]
    UncoveredInputRole(String),
    /// A declared input role has no static binding receipt.
    #[error("no static binding receipt is bound to input role {0}")]
    MissingBindingReceipt(String),
}

/// Assembles one canonical proposal from a Design, the pinned catalog and declared meaning.
///
/// Every Design input role must appear in `meaning.inputs` exactly once. An omitted role would
/// silently narrow the program's inputs, and a repeated one would leave which declaration wins to
/// ordering, so both are refused rather than resolved.
///
/// `bindings` is the Owner's verified binding custody, not a caller-supplied map. Its fields are
/// private and it is constructible only from Owner receipts, so derivation cannot be handed a
/// receipt that no Owner issued. That is also why this function is crate-private: assembly belongs
/// inside the Owner, and only the declared meaning crosses the API boundary.
///
/// # Errors
///
/// Returns the reason the declared meaning does not fit the Design: a Design that does not
/// canonicalize, an unknown plugin, an unknown, duplicated or uncovered input role, or a role with
/// no binding receipt.
pub(crate) fn derive_bounded_feature_program_proposal_v1(
    design: &StrategyDesignV2,
    catalog: PrimitiveCatalogV1,
    meaning: &BoundedFeatureProgramMeaningV1,
    bindings: &VerifiedStrategyInputBindingsV2,
) -> Result<BoundedFeatureProgramProposalV1, BoundedFeatureProgramDerivationErrorV1> {
    let (design_identity, design_digest) = match prepare_strategy_design_v2(design) {
        StrategyDesignPreparationV2::Prepared {
            design_identity,
            design_digest,
        } => (design_identity, design_digest),
        _ => return Err(BoundedFeatureProgramDerivationErrorV1::Design),
    };

    let manifest = design
        .plugins
        .iter()
        .find(|plugin| plugin.semantic_id == meaning.plugin_semantic_id)
        .ok_or(BoundedFeatureProgramDerivationErrorV1::UnknownPlugin)?;

    let mut declared = BTreeSet::new();
    let mut inputs = Vec::with_capacity(meaning.inputs.len());
    for input in &meaning.inputs {
        if !declared.insert(input.role_semantic_id.clone()) {
            return Err(BoundedFeatureProgramDerivationErrorV1::DuplicateInputRole(
                input.role_semantic_id.clone(),
            ));
        }
        let role = design
            .inputs
            .iter()
            .find(|role| role.semantic_id == input.role_semantic_id)
            .ok_or_else(|| {
                BoundedFeatureProgramDerivationErrorV1::UnknownInputRole(
                    input.role_semantic_id.clone(),
                )
            })?;
        let input_role_identity = strategy_input_role_identity_v2(role);
        let static_binding_receipt_digest = bindings
            .receipt_digest_for_role(input_role_identity)
            .ok_or_else(|| {
            BoundedFeatureProgramDerivationErrorV1::MissingBindingReceipt(
                input.role_semantic_id.clone(),
            )
        })?;

        inputs.push(BoundedFeatureInputV1 {
            owner_semantic_id: MARKET_DATA_OWNER_SEMANTIC_ID_V1.to_owned(),
            fact_type_semantic_id: role.field_semantic_id.clone(),
            input_role_id: role.semantic_id.clone(),
            input_role_identity,
            timeframe: role.timeframe.clone(),
            unit: role.unit.clone(),
            scale: role.scale,
            static_binding_receipt_digest,
            value_port_semantic_id: input.value_port_semantic_id.clone(),
            update_clock: input.update_clock.clone(),
        });
    }

    if let Some(uncovered) = design
        .inputs
        .iter()
        .find(|role| !declared.contains(&role.semantic_id))
    {
        return Err(BoundedFeatureProgramDerivationErrorV1::UncoveredInputRole(
            uncovered.semantic_id.clone(),
        ));
    }

    Ok(BoundedFeatureProgramProposalV1 {
        schema_version: BOUNDED_FEATURE_PROGRAM_SCHEMA_V1,
        semantic_version: BOUNDED_FEATURE_PROGRAM_SEMANTIC_VERSION_V1,
        research_request_identity: design.research_request_identity,
        intent_identity: design.intent_identity,
        intent_digest: design.intent_digest,
        design_identity,
        design_digest,
        plugin_semantic_id: meaning.plugin_semantic_id.clone(),
        plugin_manifest_digest: plugin_manifest_digest(manifest),
        catalog_semantic_version: BOUNDED_FEATURE_CATALOG_SEMANTIC_VERSION_V1,
        catalog_digest: BindingDigest::from_untrusted_bytes(catalog.identity()),
        first_party_sdk_source_digest: first_party_bfp_sdk_source_digest_v1(),
        inputs,
        constants: meaning.constants.clone(),
        state_cells: meaning.state_cells.clone(),
        nodes: meaning.nodes.clone(),
        proposal_decision_table: meaning.proposal_decision_table.clone(),
        warmup: meaning.warmup.clone(),
        bounds: BoundedFeatureBoundsV1 {
            max_nodes: meaning.graph_bounds.max_nodes,
            max_edges: meaning.graph_bounds.max_edges,
            max_depth: meaning.graph_bounds.max_depth,
            max_ports: meaning.graph_bounds.max_ports,
            max_constants: meaning.graph_bounds.max_constants,
            max_fan_out: meaning.graph_bounds.max_fan_out,
            max_lag: meaning.graph_bounds.max_lag,
            max_window: meaning.graph_bounds.max_window,
            max_state_cells: meaning.graph_bounds.max_state_cells,
            max_decision_branches: meaning.graph_bounds.max_decision_branches,
            max_source_bytes: meaning.graph_bounds.max_source_bytes,
            max_wasm_bytes: meaning.graph_bounds.max_wasm_bytes,
            // The manifest already fixes these, so restating them could only agree or be rejected.
            max_state_bytes: manifest.state.max_bytes,
            max_fuel: manifest.max_fuel,
            max_linear_memory_bytes: manifest.max_linear_memory_bytes,
            max_invocations_per_event: manifest.max_invocations_per_event,
        },
    })
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    /// Recovers the declared half of a known-good proposal, so derivation can be checked against it.
    fn meaning_of(proposal: &BoundedFeatureProgramProposalV1) -> BoundedFeatureProgramMeaningV1 {
        BoundedFeatureProgramMeaningV1 {
            plugin_semantic_id: proposal.plugin_semantic_id.clone(),
            inputs: proposal
                .inputs
                .iter()
                .map(|input| BoundedFeatureInputMeaningV1 {
                    role_semantic_id: input.input_role_id.clone(),
                    value_port_semantic_id: input.value_port_semantic_id.clone(),
                    update_clock: input.update_clock.clone(),
                })
                .collect(),
            constants: proposal.constants.clone(),
            state_cells: proposal.state_cells.clone(),
            nodes: proposal.nodes.clone(),
            proposal_decision_table: proposal.proposal_decision_table.clone(),
            warmup: proposal.warmup.clone(),
            graph_bounds: BoundedFeatureGraphBoundsV1 {
                max_nodes: proposal.bounds.max_nodes,
                max_edges: proposal.bounds.max_edges,
                max_depth: proposal.bounds.max_depth,
                max_ports: proposal.bounds.max_ports,
                max_constants: proposal.bounds.max_constants,
                max_fan_out: proposal.bounds.max_fan_out,
                max_lag: proposal.bounds.max_lag,
                max_window: proposal.bounds.max_window,
                max_state_cells: proposal.bounds.max_state_cells,
                max_decision_branches: proposal.bounds.max_decision_branches,
                max_source_bytes: proposal.bounds.max_source_bytes,
                max_wasm_bytes: proposal.bounds.max_wasm_bytes,
            },
        }
    }

    /// Builds Owner-shaped verified custody carrying the fixture's own receipts.
    fn bindings_of(
        design: &StrategyDesignV2,
        proposal: &BoundedFeatureProgramProposalV1,
    ) -> VerifiedStrategyInputBindingsV2 {
        let receipts = proposal
            .inputs
            .iter()
            .map(|input| {
                let role = design
                    .inputs
                    .iter()
                    .find(|role| role.semantic_id == input.input_role_id)
                    .expect("the fixture proposal names the Design's own roles")
                    .clone();

                (role, input.static_binding_receipt_digest)
            })
            .collect();

        crate::strategy_plan_v2::verified_strategy_input_bindings_for_test(design, receipts)
    }

    /// Derivation must reproduce a known-good proposal exactly, field for field.
    ///
    /// This is the whole claim: a proposer that declares only meaning loses nothing, because every
    /// field it did not declare was already determined by the Design, the pinned catalog and the
    /// plugin manifest.
    #[rstest]
    fn derivation_reproduces_a_known_good_proposal() {
        let (design, expected, catalog) = crate::bounded_feature_program_v1::tests::candidate();
        let derived = derive_bounded_feature_program_proposal_v1(
            &design,
            catalog,
            &meaning_of(&expected),
            &bindings_of(&design, &expected),
        )
        .expect("declared meaning assembles against its own Design");

        assert_eq!(derived, expected);
    }

    #[rstest]
    fn an_input_role_the_design_does_not_declare_is_refused() {
        let (design, proposal, catalog) = crate::bounded_feature_program_v1::tests::candidate();
        let mut meaning = meaning_of(&proposal);
        meaning.inputs[0].role_semantic_id = "role-the-design-never-declared".to_owned();

        assert_eq!(
            derive_bounded_feature_program_proposal_v1(
                &design,
                catalog,
                &meaning,
                &bindings_of(&design, &proposal),
            ),
            Err(BoundedFeatureProgramDerivationErrorV1::UnknownInputRole(
                "role-the-design-never-declared".to_owned()
            ))
        );
    }

    /// An omitted role would silently narrow the program's inputs, so it closes derivation.
    #[rstest]
    fn an_uncovered_design_input_role_is_refused() {
        let (design, proposal, catalog) = crate::bounded_feature_program_v1::tests::candidate();
        let mut meaning = meaning_of(&proposal);
        let dropped = meaning.inputs.remove(0).role_semantic_id;

        assert_eq!(
            derive_bounded_feature_program_proposal_v1(
                &design,
                catalog,
                &meaning,
                &bindings_of(&design, &proposal),
            ),
            Err(BoundedFeatureProgramDerivationErrorV1::UncoveredInputRole(
                dropped
            ))
        );
    }

    /// A repeated role would leave which declaration wins to ordering.
    #[rstest]
    fn a_repeated_input_role_is_refused() {
        let (design, proposal, catalog) = crate::bounded_feature_program_v1::tests::candidate();
        let mut meaning = meaning_of(&proposal);
        let repeated = meaning.inputs[0].clone();
        let role = repeated.role_semantic_id.clone();
        meaning.inputs.push(repeated);

        assert_eq!(
            derive_bounded_feature_program_proposal_v1(
                &design,
                catalog,
                &meaning,
                &bindings_of(&design, &proposal),
            ),
            Err(BoundedFeatureProgramDerivationErrorV1::DuplicateInputRole(
                role
            ))
        );
    }

    /// Receipts are Owner custody; derivation mints none and refuses without them.
    #[rstest]
    fn a_role_without_a_binding_receipt_is_refused() {
        let (design, proposal, catalog) = crate::bounded_feature_program_v1::tests::candidate();
        let meaning = meaning_of(&proposal);
        let role = meaning.inputs[0].role_semantic_id.clone();

        assert_eq!(
            derive_bounded_feature_program_proposal_v1(
                &design,
                catalog,
                &meaning,
                &crate::strategy_plan_v2::verified_strategy_input_bindings_for_test(
                    &design,
                    vec![],
                ),
            ),
            Err(BoundedFeatureProgramDerivationErrorV1::MissingBindingReceipt(role))
        );
    }

    #[rstest]
    fn a_plugin_the_design_does_not_carry_is_refused() {
        let (design, proposal, catalog) = crate::bounded_feature_program_v1::tests::candidate();
        let mut meaning = meaning_of(&proposal);
        meaning.plugin_semantic_id = "plugin-the-design-never-declared".to_owned();

        assert_eq!(
            derive_bounded_feature_program_proposal_v1(
                &design,
                catalog,
                &meaning,
                &bindings_of(&design, &proposal),
            ),
            Err(BoundedFeatureProgramDerivationErrorV1::UnknownPlugin)
        );
    }
}
