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
    resolve_pit_request_for_strategy_design_v1,
    source_binding::BindingDigest,
    strategy_input_binding::{
        StrategyInputUniverseCustodyReadbackV1, UntrustedStrategyInputCustodyClaimV1,
    },
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

/// The role identities a custody claim is made with, admitted before any re-read.
///
/// With the Design in hand the Design's scope must be the scope the Owner's declarations were
/// registered under, and its role set the set the Owner holds; the claim then carries the Design's
/// roles. Without it, the Owner's stored roles are the claim. The scope is checked before the role
/// sets, because a Design read through the other custody path would be refused there for a reason
/// that does not name the disagreement. Mixed scopes were refused when the Design was stated, so
/// every role shares this one scope and the Design-level value is the whole comparison.
fn admit_claimed_roles_v1(
    caller: &'static str,
    declared_scope: StrategyInputDeclaredScopeV1,
    stored_roles: &[BindingDigest],
    declared: Option<DeclaredDesignInputsV1>,
) -> Result<Vec<BindingDigest>, DesignInputCustodyRefusedV1> {
    let Some(declared) = declared else {
        return Ok(stored_roles.to_vec());
    };

    if !scopes_agree(&declared.scope, declared_scope) {
        return Err(refused(
            caller,
            "design_input_custody.declared_scope",
            &format_args!(
                "Design scope {} (all {} roles agree); Owner declares {}",
                design_scope_name(&declared.scope),
                declared.roles.len(),
                declared_scope_name(declared_scope),
            ),
        ));
    }
    let mut stored = stored_roles.to_vec();
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
    Ok(declared.roles)
}

/// The custody claim for one Design, and the scope its Owner declarations were registered under.
struct DesignCustodyClaimV1 {
    scope: StrategyInputDeclaredScopeV1,
    claim: UntrustedStrategyInputCustodyClaimV1,
}

/// Resolves the PIT request the Owner's declarations agree on and admits the claimed roles.
async fn design_custody_claim_v1(
    transaction: &mut Transaction<'_, Postgres>,
    caller: &'static str,
    research_request_identity: BindingDigest,
    design_identity: BindingDigest,
    declared: Option<DeclaredDesignInputsV1>,
) -> Result<DesignCustodyClaimV1, DesignInputCustodyRefusedV1> {
    let coordinate = resolve_pit_request_for_strategy_design_v1(transaction, design_identity)
        .await
        .map_err(|cause| refused(caller, "design_input_custody.resolve_pit_request", &cause))?;
    let input_role_identities = admit_claimed_roles_v1(
        caller,
        coordinate.declared_scope,
        &coordinate.input_role_identities,
        declared,
    )?;
    Ok(DesignCustodyClaimV1 {
        scope: coordinate.declared_scope,
        claim: UntrustedStrategyInputCustodyClaimV1 {
            research_request_identity,
            strategy_design_identity: design_identity,
            pit_request_identity: coordinate.pit_request_identity,
            input_role_identities,
            decision_cut: coordinate.decision_cut,
        },
    })
}

/// Refuses a re-read custody that names another Research request or Design than the claim.
fn require_names_design_v1(
    caller: &'static str,
    claim: &UntrustedStrategyInputCustodyClaimV1,
    research: BindingDigest,
    design: BindingDigest,
) -> Result<(), DesignInputCustodyRefusedV1> {
    if research == claim.research_request_identity && design == claim.strategy_design_identity {
        Ok(())
    } else {
        Err(refused(
            caller,
            "design_input_custody.custody_identity",
            &"the re-read custody names another Research request or Design",
        ))
    }
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
    let DesignCustodyClaimV1 { scope, claim } = design_custody_claim_v1(
        transaction,
        caller,
        research_request_identity,
        design_identity,
        declared,
    )
    .await?;

    match scope {
        StrategyInputDeclaredScopeV1::ExactInstrument => {
            let readback =
                reread_persisted_strategy_input_custody_for_update_v1(transaction, &claim)
                    .await
                    .map_err(|cause| {
                        refused(caller, "design_input_custody.reread_exact_custody", &cause)
                    })?;
            require_names_design_v1(
                caller,
                &claim,
                readback.research_request_identity(),
                readback.strategy_design_identity(),
            )?;
            Ok(VerifiedStrategyInputBindingsV2::from_owner_receipts(
                readback.bindings(),
            ))
        }
        StrategyInputDeclaredScopeV1::UniverseMembers => {
            let readback = reread_universe_custody_v1(transaction, caller, &claim).await?;
            Ok(VerifiedStrategyInputBindingsV2::from_owner_universe(
                readback.frame(),
                research_request_identity,
                design_identity,
            ))
        }
    }
}

/// Re-derives, under the caller's R&D transaction, the universe frame a Design's persisted input
/// custody binds, and returns its digest.
///
/// The Owner's stored roles are the claim, as on the recovery path. A Design whose declarations
/// were registered as exact-instrument has no universe frame and is refused by name.
pub(crate) async fn reread_design_universe_frame_digest_v1(
    transaction: &mut Transaction<'_, Postgres>,
    caller: &'static str,
    research_request_identity: BindingDigest,
    design_identity: BindingDigest,
) -> Result<BindingDigest, DesignInputCustodyRefusedV1> {
    let DesignCustodyClaimV1 { scope, claim } = design_custody_claim_v1(
        transaction,
        caller,
        research_request_identity,
        design_identity,
        None,
    )
    .await?;

    if scope != StrategyInputDeclaredScopeV1::UniverseMembers {
        return Err(refused(
            caller,
            "design_input_custody.universe_frame_scope",
            &format_args!(
                "the Owner declares {}, which binds no universe frame",
                declared_scope_name(scope)
            ),
        ));
    }
    Ok(reread_universe_custody_v1(transaction, caller, &claim)
        .await?
        .frame()
        .digest())
}

async fn reread_universe_custody_v1(
    transaction: &mut Transaction<'_, Postgres>,
    caller: &'static str,
    claim: &UntrustedStrategyInputCustodyClaimV1,
) -> Result<StrategyInputUniverseCustodyReadbackV1, DesignInputCustodyRefusedV1> {
    let readback =
        reread_persisted_strategy_input_universe_custody_for_update_v1(transaction, claim)
            .await
            .map_err(|cause| {
                refused(
                    caller,
                    "design_input_custody.reread_universe_custody",
                    &cause,
                )
            })?;
    require_names_design_v1(
        caller,
        claim,
        readback.research_request_identity(),
        readback.strategy_design_identity(),
    )?;
    Ok(readback)
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::sync::{Arc, Mutex};

    use tracing_subscriber::fmt::MakeWriter;
    use vibe_data::owner::{StrategyInputDeclaredScopeV1, source_binding::BindingDigest};

    use super::{DeclaredDesignInputsV1, DesignInputCustodyRefusedV1, admit_claimed_roles_v1};
    use crate::{
        strategy_design_v2::{InputRoleV2, InputScopeV2},
        strategy_plan_v2::{
            UNIVERSE_CLOSE_FIELD_SEMANTIC_ID_V2, UNIVERSE_OPEN_FIELD_SEMANTIC_ID_V2,
            strategy_input_role_identity_v2, universe_member_role_v2,
        },
    };

    #[derive(Clone, Default)]
    struct Sink(Arc<Mutex<Vec<u8>>>);

    impl Write for Sink {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().expect("sink lock").extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl<'a> MakeWriter<'a> for Sink {
        type Writer = Self;

        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    /// Runs the admission with every recorded refusal captured, and returns both.
    fn admit(
        declared_scope: StrategyInputDeclaredScopeV1,
        stored_roles: &[BindingDigest],
        design_inputs: Option<&[InputRoleV2]>,
    ) -> (
        Result<Vec<BindingDigest>, DesignInputCustodyRefusedV1>,
        String,
    ) {
        let sink = Sink::default();
        let subscriber = tracing_subscriber::fmt().with_writer(sink.clone()).finish();
        let admitted = tracing::subscriber::with_default(subscriber, || {
            let declared = design_inputs.map(|inputs| {
                DeclaredDesignInputsV1::of("test", inputs).expect("the Design states one scope")
            });
            admit_claimed_roles_v1("test", declared_scope, stored_roles, declared)
        });
        let written = String::from_utf8(sink.0.lock().expect("sink lock").clone())
            .expect("subscriber output is UTF-8");
        (admitted, written)
    }

    fn universe_roles() -> Vec<InputRoleV2> {
        vec![
            universe_member_role_v2("OPEN", UNIVERSE_OPEN_FIELD_SEMANTIC_ID_V2),
            universe_member_role_v2("CLOSE", UNIVERSE_CLOSE_FIELD_SEMANTIC_ID_V2),
        ]
    }

    fn exact_roles() -> Vec<InputRoleV2> {
        universe_roles()
            .into_iter()
            .map(|role| InputRoleV2 {
                instrument: "BTCUSDT-PERP.BINANCE".to_owned(),
                scope: InputScopeV2::ExactInstrument,
                ..role
            })
            .collect()
    }

    fn identities(roles: &[InputRoleV2]) -> Vec<BindingDigest> {
        roles.iter().map(strategy_input_role_identity_v2).collect()
    }

    #[rstest::rstest]
    #[case::exact_design_universe_owner(
        exact_roles(),
        StrategyInputDeclaredScopeV1::UniverseMembers
    )]
    #[case::universe_design_exact_owner(
        universe_roles(),
        StrategyInputDeclaredScopeV1::ExactInstrument
    )]
    fn a_design_whose_scope_the_owner_does_not_declare_is_refused_by_name(
        #[case] design: Vec<InputRoleV2>,
        #[case] owner_scope: StrategyInputDeclaredScopeV1,
    ) {
        // The Owner holds exactly the Design's roles, so only the scope disagrees: without the scope
        // check this admits and the claim goes down the custody path the Design does not use.
        let (admitted, written) = admit(owner_scope, &identities(&design), Some(&design));

        assert_eq!(admitted, Err(DesignInputCustodyRefusedV1));
        assert!(
            written.contains("design_input_custody.declared_scope"),
            "{written}"
        );
        assert!(written.contains("(all 2 roles agree)"), "{written}");
    }

    #[rstest::rstest]
    fn a_design_whose_role_set_differs_is_refused_by_name() {
        let design = universe_roles();
        let stored = identities(&design[..1]);
        let (admitted, written) = admit(
            StrategyInputDeclaredScopeV1::UniverseMembers,
            &stored,
            Some(&design),
        );

        assert_eq!(admitted, Err(DesignInputCustodyRefusedV1));
        assert!(
            written.contains("design_input_custody.declared_roles"),
            "{written}"
        );
    }

    #[rstest::rstest]
    #[case::exact(exact_roles(), StrategyInputDeclaredScopeV1::ExactInstrument)]
    #[case::universe(universe_roles(), StrategyInputDeclaredScopeV1::UniverseMembers)]
    fn an_agreeing_design_claims_its_own_roles_whatever_order_the_owner_stores(
        #[case] design: Vec<InputRoleV2>,
        #[case] owner_scope: StrategyInputDeclaredScopeV1,
    ) {
        let mut stored = identities(&design);
        stored.reverse();
        let (admitted, written) = admit(owner_scope, &stored, Some(&design));

        assert_eq!(admitted, Ok(identities(&design)));
        assert!(written.is_empty(), "{written}");
    }

    #[rstest::rstest]
    fn without_the_design_the_owner_stored_roles_are_the_claim() {
        let stored = identities(&universe_roles());
        let (admitted, written) =
            admit(StrategyInputDeclaredScopeV1::UniverseMembers, &stored, None);

        assert_eq!(admitted, Ok(stored));
        assert!(written.is_empty(), "{written}");
    }
}
