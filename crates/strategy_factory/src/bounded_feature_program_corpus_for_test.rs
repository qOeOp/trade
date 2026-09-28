//! The declared-meaning corpus, assembled as `declare` assembles it, for the tests that run or
//! compare its programs.

use std::fs;

use vibe_data::owner::source_binding::BindingDigest;
use vibe_indicators_kernel::PrimitiveCatalogV1;

use crate::{
    bounded_feature_program_v1::BoundedFeatureProgramProposalV1,
    strategy_design_v2::StrategyDesignV2,
};

/// The authored program `name` from the declared-meaning corpus, assembled as `declare` does.
pub(crate) fn corpus_program(name: &str) -> (StrategyDesignV2, BoundedFeatureProgramProposalV1) {
    use crate::bounded_feature_program_derivation_v1::{
        BoundedFeatureProgramMeaningV1, derive_bounded_feature_program_proposal_v1,
    };

    let corpus = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/test_data/bounded_feature_program_meaning_v1/"
    );
    // Four programs share another's Design, as the corpus README states.
    let design_name = match name {
        "a0v3" => "a0",
        "t5" => "t4",
        "t8" | "t9" => "t7",
        own => own,
    };
    let design: StrategyDesignV2 = serde_json::from_str(
        &fs::read_to_string(format!("{corpus}{design_name}-design.json")).unwrap(),
    )
    .unwrap();
    let declared: BoundedFeatureProgramMeaningV1 =
        serde_json::from_str(&fs::read_to_string(format!("{corpus}{name}-meaning.json")).unwrap())
            .unwrap();
    let receipts = design
        .inputs
        .iter()
        .enumerate()
        .map(|(index, role)| {
            let mut bytes = [0x5a_u8; 32];
            bytes[0] = u8::try_from(index).unwrap();
            (role.clone(), BindingDigest::from_untrusted_bytes(bytes))
        })
        .collect();
    let bindings =
        crate::strategy_plan_v2::verified_strategy_input_bindings_for_test(&design, receipts);
    let proposal = derive_bounded_feature_program_proposal_v1(
        &design,
        PrimitiveCatalogV1::verify().unwrap(),
        &declared,
        &bindings,
    )
    .unwrap_or_else(|e| panic!("{name} assembles: {e}"));
    (design, proposal)
}
