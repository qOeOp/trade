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
    StrategyDesignRoleIntentErrorV1, StrategyDesignRoleIntentV1,
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
/// # Errors
///
/// Returns [`DesignRoleIntentErrorV1::Design`] when the Design does not prepare,
/// [`DesignRoleIntentErrorV1::Custody`] when it names other Research identities, and
/// [`DesignRoleIntentErrorV1::Projection`] when the prepared Design does not project into an
/// admissible intent.
pub(crate) fn derive_design_role_intent_v1(
    custody: &CurrentResearchDevelopCustodyV2,
    design: &StrategyDesignV2,
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

    Ok(StrategyDesignRoleIntentV1::from_rd_owner_projection(
        custody.research_request_identity(),
        custody.intent_identity(),
        custody.custody_digest(),
        design_identity,
        design_digest,
        project_design_role_entries_v1(&design.inputs),
    )?)
}
