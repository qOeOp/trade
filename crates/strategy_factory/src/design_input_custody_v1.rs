//! Which Owner custody serves a Design's inputs, and reading it.
//!
//! Two R&D reads bind a Design to its Market Data input custody before anything is built from it:
//! the Composer's production binding read and BFP derivation. Both resolve the PIT request the
//! Owner's declarations agree on, hold the Design's role set against the stored one, re-read the
//! custody under the caller's R&D transaction and check it names this Research request and Design.
//! This module is those steps once, with the choice they now need: a Design whose roles are
//! universe members is served by the universe custody re-read, an exact-instrument Design by the
//! singular one.
//!
//! The choice is made from the scope the Owner's stored declarations were registered under, never
//! from how many roles there are or in what order, and never from the Design alone: the recovery
//! path holds no Design. A caller that does hold the Design states its scope too, and a Design
//! whose scope disagrees with the Owner's declarations is refused rather than read either way.

use std::fmt::Display;

use sqlx::{Postgres, Transaction};
use vibe_data::owner::{
    StrategyInputDeclaredScopeV1, reread_persisted_strategy_input_custody_for_update_v1,
    reread_persisted_strategy_input_universe_custody_for_update_v1,
    resolve_pit_request_for_strategy_design_v1, source_binding::BindingDigest,
    strategy_input_binding::UntrustedStrategyInputCustodyClaimV1,
};

use crate::{
    strategy_design_v2::{InputRoleV2, InputScopeV2},
    strategy_plan_v2::{
        VerifiedStrategyInputBindingsV2, input_scope_of_design_v2, strategy_input_role_identity_v2,
    },
};

/// The custody read refused. Which step and why is already recorded; the caller maps this to its
/// own answer, which says no more than that the Design has no admitted custody.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct DesignInputCustodyRefusedV1;

/// Records why one step refused, naming the caller in the cause, then returns the refusal.
fn refused(
    caller: &'static str,
    coordinate: &'static str,
    cause: &impl Display,
) -> DesignInputCustodyRefusedV1 {
    crate::storage_diagnostic::refused_by_store(coordinate, &format_args!("{caller}: {cause}"));
    DesignInputCustodyRefusedV1
}

/// What a caller that holds the Design states about its inputs: its complete role set and the one
/// scope those roles share.
pub(crate) struct DeclaredDesignInputsV1 {
    roles: Vec<BindingDigest>,
    scope: InputScopeV2,
}

impl DeclaredDesignInputsV1 {
    /// States a Design's inputs, refusing a Design with no input or whose roles mix scopes. Such a
    /// Design has no one custody path, so there is nothing to read.
    pub(crate) fn of(
        caller: &'static str,
        inputs: &[InputRoleV2],
    ) -> Result<Self, DesignInputCustodyRefusedV1> {
        let scope = match input_scope_of_design_v2(inputs) {
            Ok(Some(scope)) => scope,
            Ok(None) => {
                return Err(refused(
                    caller,
                    "design_input_custody.design_scope",
                    &"the Design declares no input",
                ));
            }
            Err(refusal) => {
                return Err(refused(
                    caller,
                    "design_input_custody.design_scope",
                    &format_args!("{refusal:?}"),
                ));
            }
        };
        Ok(Self {
            roles: inputs.iter().map(strategy_input_role_identity_v2).collect(),
            scope,
        })
    }
}

const fn design_scope_name(scope: &InputScopeV2) -> &'static str {
    match scope {
        InputScopeV2::ExactInstrument => "EXACT_INSTRUMENT",
        InputScopeV2::UniverseMembers => "UNIVERSE_MEMBERS",
    }
}

const fn declared_scope_name(scope: StrategyInputDeclaredScopeV1) -> &'static str {
    match scope {
        StrategyInputDeclaredScopeV1::ExactInstrument => "EXACT_INSTRUMENT",
        StrategyInputDeclaredScopeV1::UniverseMembers => "UNIVERSE_MEMBERS",
    }
}

const fn scopes_agree(design: &InputScopeV2, declared: StrategyInputDeclaredScopeV1) -> bool {
    matches!(
        (design, declared),
        (
            InputScopeV2::ExactInstrument,
            StrategyInputDeclaredScopeV1::ExactInstrument
        ) | (
            InputScopeV2::UniverseMembers,
            StrategyInputDeclaredScopeV1::UniverseMembers
        )
    )
}

/// Re-reads the Market Data custody that serves a Design's inputs, under the caller's R&D
/// transaction, and returns the bindings a Plan compiles against.
///
/// `declared` is the Design's own statement where the caller holds the Design, and `None` on the
/// recovery path, where the Owner's stored roles are the claim.
pub(crate) async fn reread_design_input_custody_v1(
    transaction: &mut Transaction<'_, Postgres>,
    caller: &'static str,
    research_request_identity: BindingDigest,
    design_identity: BindingDigest,
    declared: Option<DeclaredDesignInputsV1>,
) -> Result<VerifiedStrategyInputBindingsV2, DesignInputCustodyRefusedV1> {
    let coordinate = resolve_pit_request_for_strategy_design_v1(transaction, design_identity)
        .await
        .map_err(|cause| refused(caller, "design_input_custody.resolve_pit_request", &cause))?;

    let input_role_identities = match declared {
        Some(declared) => {
            // Checked before the role sets, because a Design read through the other custody path
            // would be refused there for a reason that does not name the disagreement. Mixed scopes
            // were refused when the Design was stated, so every role shares this one scope and the
            // Design-level value is the whole comparison.
            if !scopes_agree(&declared.scope, coordinate.declared_scope) {
                return Err(refused(
                    caller,
                    "design_input_custody.declared_scope",
                    &format_args!(
                        "Design scope {} (all {} roles agree); Owner declares {}",
                        design_scope_name(&declared.scope),
                        declared.roles.len(),
                        declared_scope_name(coordinate.declared_scope),
                    ),
                ));
            }
            let mut stored = coordinate.input_role_identities.clone();
            let mut expected = declared.roles.clone();
            stored.sort_unstable();
            expected.sort_unstable();
            if stored != expected {
                return Err(refused(
                    caller,
                    "design_input_custody.declared_roles",
                    &"the Design's role set differs from the roles Market Data holds for it",
                ));
            }
            declared.roles
        }
        None => coordinate.input_role_identities.clone(),
    };

    let claim = UntrustedStrategyInputCustodyClaimV1 {
        research_request_identity,
        strategy_design_identity: design_identity,
        pit_request_identity: coordinate.pit_request_identity,
        input_role_identities,
        decision_cut: coordinate.decision_cut,
    };
    let names_this_design = |research: BindingDigest, design: BindingDigest| {
        if research == research_request_identity && design == design_identity {
            Ok(())
        } else {
            Err(refused(
                caller,
                "design_input_custody.custody_identity",
                &"the re-read custody names another Research request or Design",
            ))
        }
    };

    match coordinate.declared_scope {
        StrategyInputDeclaredScopeV1::ExactInstrument => {
            let readback =
                reread_persisted_strategy_input_custody_for_update_v1(transaction, &claim)
                    .await
                    .map_err(|cause| {
                        refused(caller, "design_input_custody.reread_exact_custody", &cause)
                    })?;
            names_this_design(
                readback.research_request_identity(),
                readback.strategy_design_identity(),
            )?;
            Ok(VerifiedStrategyInputBindingsV2::from_owner_receipts(
                readback.bindings(),
            ))
        }
        StrategyInputDeclaredScopeV1::UniverseMembers => {
            let readback =
                reread_persisted_strategy_input_universe_custody_for_update_v1(transaction, &claim)
                    .await
                    .map_err(|cause| {
                        refused(
                            caller,
                            "design_input_custody.reread_universe_custody",
                            &cause,
                        )
                    })?;
            names_this_design(
                readback.research_request_identity(),
                readback.strategy_design_identity(),
            )?;
            Ok(VerifiedStrategyInputBindingsV2::from_owner_universe(
                readback.frame(),
                research_request_identity,
                design_identity,
            ))
        }
    }
}
