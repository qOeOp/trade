//! Derives the Design-level role intent this Owner publishes to Market Data.
//!
//! Market Data needs one authenticated statement about a Design before it can issue the binding
//! declarations a program depends on, and every other statement this Owner can make is
//! artifact-bound. So this one says only what the Owner knows without a Composer: the Research
//! request, intent and custody digest the Design was admitted against, the Design's own identity
//! and digest, and the roles it declares.
//!
//! It selects no members, frames or binding digests. Those stay Market Data's to resolve, which is
//! what keeps this a statement of Design meaning rather than a claim about market facts.

use vibe_data::owner::strategy_design_role_intent_v1::{
    InitialPitRequestLocatorV1, StrategyDesignRoleIntentErrorV1, StrategyDesignRoleIntentV1,
};

use crate::{
    develop_composer_v2::CurrentResearchDevelopCustodyV2,
    strategy_design_v2::StrategyDesignV2,
    strategy_plan_v2::{
        StrategyDesignPreparationV2, prepare_strategy_design_v2, project_design_role_entries_v1,
    },
};

/// Why a Design could not be published as role intent.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum DesignRoleIntentErrorV1 {
    /// The Design does not prepare, so it has no identity to publish under.
    #[error("the Design does not prepare into a canonical identity")]
    Design,
    /// The Design carries Research identities other than the custody it is published against.
    #[error("the Design does not belong to the Research custody it is published against")]
    Custody,
    /// The prepared Design does not project into an admissible intent.
    #[error("the Design does not project into an admissible role intent: {0}")]
    Projection(#[from] StrategyDesignRoleIntentErrorV1),
}

/// Publishes what this Owner knows about a Design, for Market Data to authenticate it by.
///
/// The Design must already carry the Research identities of the custody it is published against.
/// A Design that names a different Research request or Intent is refused rather than rewritten,
/// because rewriting it here would publish a statement no Research custody backs.
///
/// `initial_pit_request` is the `AVAILABLE` initial PIT request this Owner recorded for a V3
/// Intent, read from its own custody by the caller, and `None` for a V2 one. With it the intent is
/// schema 2 and names that request; without it, schema 1, which names none.
///
/// # Errors
///
/// Returns [`DesignRoleIntentErrorV1::Design`] when the Design does not prepare,
/// [`DesignRoleIntentErrorV1::Custody`] when it names other Research identities, and
/// [`DesignRoleIntentErrorV1::Projection`] when the prepared Design does not project into an
/// admissible intent.
pub(crate) fn derive_design_role_intent_v1(
    custody: &CurrentResearchDevelopCustodyV2,
    design: &StrategyDesignV2,
    initial_pit_request: Option<InitialPitRequestLocatorV1>,
) -> Result<StrategyDesignRoleIntentV1, DesignRoleIntentErrorV1> {
    if design.research_request_identity != custody.research_request_identity()
        || design.intent_identity != custody.intent_identity()
        || design.intent_digest != custody.intent_digest()
    {
        return Err(DesignRoleIntentErrorV1::Custody);
    }

    let StrategyDesignPreparationV2::Prepared {
        design_identity,
        design_digest,
    } = prepare_strategy_design_v2(design)
    else {
        return Err(DesignRoleIntentErrorV1::Design);
    };

    let roles = project_design_role_entries_v1(&design.inputs);
    Ok(match initial_pit_request {
        None => StrategyDesignRoleIntentV1::from_rd_owner_projection(
            custody.research_request_identity(),
            custody.intent_identity(),
            custody.custody_digest(),
            design_identity,
            design_digest,
            roles,
        )?,
        Some(initial_pit_request) => {
            StrategyDesignRoleIntentV1::from_rd_owner_projection_with_initial_pit(
                custody.research_request_identity(),
                custody.intent_identity(),
                custody.custody_digest(),
                design_identity,
                design_digest,
                roles,
                initial_pit_request,
            )?
        }
    })
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use vibe_data::owner::source_binding::BindingDigest;

    use super::{DesignRoleIntentErrorV1, derive_design_role_intent_v1};
    use crate::{
        bounded_feature_program_v1::tests::candidate,
        develop_composer_v2::CurrentResearchDevelopCustodyV2,
        strategy_plan_v2::project_design_role_entries_v1,
    };

    #[rstest]
    fn the_published_intent_carries_the_custody_and_the_design_it_was_derived_from() {
        let (design, _) = candidate();
        let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);

        let intent = derive_design_role_intent_v1(&custody, &design, None).unwrap();

        assert_eq!(
            intent.research_request_identity(),
            custody.research_request_identity()
        );
        assert_eq!(intent.intent_identity(), custody.intent_identity());
        assert_eq!(intent.research_custody_digest(), custody.custody_digest());
        assert_eq!(
            intent.roles(),
            project_design_role_entries_v1(&design.inputs)
        );
        assert!(!intent.roles().is_empty());
    }

    #[rstest]
    fn a_design_reordered_but_not_changed_publishes_the_same_intent() {
        let (design, _) = candidate();
        let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);
        let mut reordered = design.clone();
        reordered.reactions.reverse();
        assert_ne!(
            reordered.reactions, design.reactions,
            "the fixture must carry more than one reaction for this to permute anything"
        );

        let intent = derive_design_role_intent_v1(&custody, &design, None).unwrap();
        let reordered_intent = derive_design_role_intent_v1(&custody, &reordered, None).unwrap();

        assert_eq!(intent.design_identity(), reordered_intent.design_identity());
        assert_eq!(intent.intent_digest(), reordered_intent.intent_digest());
        assert_eq!(intent.canonical_bytes(), reordered_intent.canonical_bytes());
    }

    #[rstest]
    fn a_design_from_other_research_is_refused_rather_than_rewritten() {
        let (design, _) = candidate();
        let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);
        let mut spliced = design;
        spliced.intent_digest = BindingDigest::from_untrusted_bytes([99; 32]);

        assert_eq!(
            derive_design_role_intent_v1(&custody, &spliced, None),
            Err(DesignRoleIntentErrorV1::Custody)
        );
    }

    #[rstest]
    fn a_design_that_does_not_prepare_has_no_identity_to_publish_under() {
        let (design, _) = candidate();
        let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);
        let mut unprepared = design;
        unprepared.falsifier = String::new();

        assert_eq!(
            derive_design_role_intent_v1(&custody, &unprepared, None),
            Err(DesignRoleIntentErrorV1::Design)
        );
    }
}
