//! Resolution from one authenticated Strategy Design input role to the Owner's own snapshot.
//!
//! A Design declares role intent and nothing else, so the eleven Market Data facts a V1 binding
//! request carries cannot come from its side. This module answers the one question that stands
//! between the two: given the semantic coordinates a role authenticates, which snapshot of the
//! Owner's own custody answers at them.
//!
//! The coordinates are exactly the ones `resolve_strategy_input_row` selects a row by, so the
//! index and the binder ask the same question. Selection is latest-not-after against the Owner's
//! own decision cut: a correction advances its lineage and is not ambiguity, while two lineages
//! answering one coordinate at one cut is, and that resolves to nothing rather than to a choice.
//!
//! Every read here goes through the schema's `SECURITY DEFINER` resolvers on the caller's open
//! transaction. It holds no lock, so a registration cannot serialise Composer transactions behind
//! the Owner's clock.

use sqlx::{Postgres, Row, Transaction};

use crate::owner::{
    pit_snapshot::VerifiedPitObservationBatch,
    pit_snapshot::{PitSnapshotDisposition, research_pit_requester_identity_v1},
    source_binding::BindingDigest,
    strategy_design_role_intent_v1::StrategyDesignRoleIntentV1,
    strategy_design_role_set::{StrategyDesignRoleEntryV1, StrategyDesignRoleSetReceiptV1},
    strategy_input_binding::{
        EXACT_INSTRUMENT_ROLE_SCOPE_V1, MarketDataFieldSemantic, StrategyInputChannel,
        StrategyInputUnit, UNIVERSE_MEMBERS_ROLE_SCOPE_V1, UntrustedStrategyInputBindingRequest,
        UntrustedStrategyInputScope, derive_universe_selection,
    },
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum PitRoleResolutionErrorV1 {
    /// The role is neither an exact-instrument nor a universe-member market role.
    UnsupportedRole,
    /// The role names a field semantic this Owner does not define.
    UnknownFieldSemantic,
    /// The role's unit contradicts the unit its field semantic fixes.
    UnitMismatch,
    /// The Owner holds no decision cut, so nothing can be selected not-after it.
    DecisionCutUnavailable,
    /// No snapshot answers these coordinates at or before the Owner's decision cut.
    NoMatchingSnapshot,
    /// More than one lineage answers these coordinates at the selected cut.
    AmbiguousSnapshot,
    /// A universe-member role's Design names no initial PIT request to register against.
    InitialPitRequestUnnamed,
    /// No PIT request of this Owner has the named identity.
    InitialPitRequestUnknown,
    /// The named PIT request's digest is not the one the Design names.
    InitialPitRequestDigestMismatch,
    /// The named PIT request's current snapshot is not `AVAILABLE`.
    InitialPitRequestNotAvailable,
    /// The named PIT request was not requested for the Design's Research request.
    InitialPitRequestRequesterMismatch,
    /// The snapshot that answers a universe-member role does not derive one Universe Selection.
    UniverseUnavailable,
    /// The store could not be read.
    StoreUnavailable,
}

/// The one snapshot that answers a role, and the cut it was selected at.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ResolvedRoleSnapshotV1 {
    pub(super) snapshot_identity: BindingDigest,
    pub(super) decision_cut: u64,
}

/// Reads the Owner's current decision cut through its clock custody resolvers.
///
/// This is the Owner's own time, never a caller's: a Design's coordinate is frozen at the cut the
/// Owner held when the declaration was registered.
async fn owner_decision_cut_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<u64, PitRoleResolutionErrorV1> {
    let state = sqlx::query(
        "SELECT head_identity FROM market_data_private.resolve_clock_custody_state_v1()",
    )
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| PitRoleResolutionErrorV1::StoreUnavailable)?
    .ok_or(PitRoleResolutionErrorV1::DecisionCutUnavailable)?;
    let head_identity: Vec<u8> = state
        .try_get("head_identity")
        .map_err(|_| PitRoleResolutionErrorV1::StoreUnavailable)?;

    let handoff =
        sqlx::query("SELECT decision_cut FROM market_data_private.resolve_clock_handoff_v1($1)")
            .bind(&head_identity)
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|_| PitRoleResolutionErrorV1::StoreUnavailable)?
            .ok_or(PitRoleResolutionErrorV1::DecisionCutUnavailable)?;
    let decision_cut: i64 = handoff
        .try_get("decision_cut")
        .map_err(|_| PitRoleResolutionErrorV1::StoreUnavailable)?;

    u64::try_from(decision_cut).map_err(|_| PitRoleResolutionErrorV1::DecisionCutUnavailable)
}

/// The initial PIT request a Design role intent names: its claimed identity and digest.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct NamedInitialPitRequestV1 {
    pub(super) pit_request_identity: BindingDigest,
    pub(super) pit_request_digest: BindingDigest,
}

/// Resolves one authenticated role to the single snapshot that answers it.
///
/// An exact-instrument role is answered by the snapshot whose rows carry its coordinates. A
/// universe-member role names no instrument and its Design names no universe: it is answered by
/// exactly the initial PIT request its Design's role intent names, which its Research request
/// submitted with the instrument scope the user chose, and never by a search.
pub(super) async fn resolve_role_snapshot_v1(
    transaction: &mut Transaction<'_, Postgres>,
    design: AuthenticatedDesignIdentityV1,
    role: &StrategyDesignRoleEntryV1,
    initial_pit_request: Option<NamedInitialPitRequestV1>,
) -> Result<ResolvedRoleSnapshotV1, PitRoleResolutionErrorV1> {
    let (universe_members, semantic) = classify_role_v1(role)?;

    if universe_members {
        let named =
            initial_pit_request.ok_or(PitRoleResolutionErrorV1::InitialPitRequestUnnamed)?;
        return boxed_initial_pit_request_snapshot_v1(transaction, design, named).await;
    }
    let decision_cut = owner_decision_cut_v1(transaction).await?;
    let cut_bound = i64::try_from(decision_cut)
        .map_err(|_| PitRoleResolutionErrorV1::DecisionCutUnavailable)?;

    let rows = sqlx::query(
        "SELECT decision_cut,snapshot_identity FROM market_data_private.resolve_pit_role_coordinate_v1($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(role.instrument.as_str())
    .bind(role.channel.as_str())
    .bind(semantic.data_kind())
    .bind(semantic.row_field())
    .bind(role.timeframe.as_str())
    .bind(i16::from(role.scale))
    .bind(cut_bound)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| PitRoleResolutionErrorV1::StoreUnavailable)?;

    let [row] = rows.as_slice() else {
        return if rows.is_empty() {
            Err(PitRoleResolutionErrorV1::NoMatchingSnapshot)
        } else {
            Err(PitRoleResolutionErrorV1::AmbiguousSnapshot)
        };
    };
    let selected_cut: i64 = row
        .try_get("decision_cut")
        .map_err(|_| PitRoleResolutionErrorV1::StoreUnavailable)?;
    let identity: Vec<u8> = row
        .try_get("snapshot_identity")
        .map_err(|_| PitRoleResolutionErrorV1::StoreUnavailable)?;
    let identity: [u8; 32] = identity
        .try_into()
        .map_err(|_| PitRoleResolutionErrorV1::StoreUnavailable)?;

    Ok(ResolvedRoleSnapshotV1 {
        snapshot_identity: BindingDigest::from_untrusted_bytes(identity),
        decision_cut: u64::try_from(selected_cut)
            .map_err(|_| PitRoleResolutionErrorV1::StoreUnavailable)?,
    })
}

/// Classifies a role this Owner can resolve: whether it reads universe members, and its field
/// semantic. A synchronous step of its own, so the async resolver's frame holds only the result.
fn classify_role_v1(
    role: &StrategyDesignRoleEntryV1,
) -> Result<(bool, MarketDataFieldSemantic), PitRoleResolutionErrorV1> {
    if role.fact_class != "MARKET_DATA"
        || role.value_type != "I128"
        || role.timeframe.is_empty()
        || role.channel.is_empty()
    {
        return Err(PitRoleResolutionErrorV1::UnsupportedRole);
    }
    let universe_members = match (role.scope.as_str(), role.instrument.is_empty()) {
        (EXACT_INSTRUMENT_ROLE_SCOPE_V1, false) => false,
        (UNIVERSE_MEMBERS_ROLE_SCOPE_V1, true) => true,
        _ => return Err(PitRoleResolutionErrorV1::UnsupportedRole),
    };
    let semantic = MarketDataFieldSemantic::from_identity(&role.field_semantic_id)
        .ok_or(PitRoleResolutionErrorV1::UnknownFieldSemantic)?;

    if role.unit != semantic.unit().canonical() {
        return Err(PitRoleResolutionErrorV1::UnitMismatch);
    }
    Ok((universe_members, semantic))
}

/// The named-request resolution as a boxed future built outside the caller's frame.
///
/// `resolve_role_snapshot_v1` sits on the exact-instrument registration path, whose frames the
/// ordered chain runs on a 2 MiB test stack; a debug build would otherwise reserve room for this
/// future in that frame on every call, universe role or not.
fn boxed_initial_pit_request_snapshot_v1<'a>(
    transaction: &'a mut Transaction<'_, Postgres>,
    design: AuthenticatedDesignIdentityV1,
    named: NamedInitialPitRequestV1,
) -> std::pin::Pin<
    Box<
        dyn std::future::Future<Output = Result<ResolvedRoleSnapshotV1, PitRoleResolutionErrorV1>>
            + Send
            + 'a,
    >,
> {
    Box::pin(resolve_initial_pit_request_snapshot_v1(
        transaction,
        design,
        named,
    ))
}

/// Resolves the snapshot of exactly the initial PIT request a Design names.
///
/// The request's lineage head must be the named request's, `AVAILABLE`, and requested for the
/// Design's own Research request; each other outcome is refused by name. Nothing is searched: a
/// request submitted under a forged requester is never picked up because it is never looked for.
async fn resolve_initial_pit_request_snapshot_v1(
    transaction: &mut Transaction<'_, Postgres>,
    design: AuthenticatedDesignIdentityV1,
    named: NamedInitialPitRequestV1,
) -> Result<ResolvedRoleSnapshotV1, PitRoleResolutionErrorV1> {
    let rows = sqlx::query(
        "SELECT snapshot_identity,request_digest FROM market_data_private.resolve_pit_request_heads_v1($1)",
    )
    .bind(named.pit_request_identity.as_bytes().as_slice())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| PitRoleResolutionErrorV1::StoreUnavailable)?;

    let [row] = rows.as_slice() else {
        return if rows.is_empty() {
            Err(PitRoleResolutionErrorV1::InitialPitRequestUnknown)
        } else {
            Err(PitRoleResolutionErrorV1::AmbiguousSnapshot)
        };
    };
    let digest_of = |column: &str| -> Result<BindingDigest, PitRoleResolutionErrorV1> {
        let bytes: Vec<u8> = row
            .try_get(column)
            .map_err(|_| PitRoleResolutionErrorV1::StoreUnavailable)?;
        let bytes: [u8; 32] = bytes
            .try_into()
            .map_err(|_| PitRoleResolutionErrorV1::StoreUnavailable)?;
        Ok(BindingDigest::from_untrusted_bytes(bytes))
    };
    let snapshot_identity = digest_of("snapshot_identity")?;
    let stored_digest = digest_of("request_digest")?;
    let aggregate = super::load_pit(transaction, snapshot_identity, true, false)
        .await
        .map_err(|_| PitRoleResolutionErrorV1::StoreUnavailable)?
        .ok_or(PitRoleResolutionErrorV1::InitialPitRequestUnknown)?;
    let fact = aggregate.fact();
    admit_initial_pit_request_v1(
        named,
        stored_digest,
        fact.disposition() == PitSnapshotDisposition::Available,
        fact.request().requester_identity,
        design.research_request_identity(),
    )?;
    Ok(ResolvedRoleSnapshotV1 {
        snapshot_identity,
        decision_cut: fact.request().time_evidence.decision_cut.value,
    })
}

/// Decides whether a stored PIT request may answer a Design's named initial PIT request.
fn admit_initial_pit_request_v1(
    named: NamedInitialPitRequestV1,
    stored_digest: BindingDigest,
    available: bool,
    requester_identity: BindingDigest,
    research_request_identity: BindingDigest,
) -> Result<(), PitRoleResolutionErrorV1> {
    if stored_digest != named.pit_request_digest {
        return Err(PitRoleResolutionErrorV1::InitialPitRequestDigestMismatch);
    }

    if !available {
        return Err(PitRoleResolutionErrorV1::InitialPitRequestNotAvailable);
    }

    if requester_identity != research_pit_requester_identity_v1(research_request_identity) {
        return Err(PitRoleResolutionErrorV1::InitialPitRequestRequesterMismatch);
    }
    Ok(())
}

/// The two Design coordinates every binding request in one registration carries.
///
/// Both an attested role set and a published Design role intent state them, and a request that
/// transposed them would name a Design that does not exist rather than failing to compile, so the
/// pair travels as one value that only an authenticated shape can construct.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct AuthenticatedDesignIdentityV1 {
    research_request_identity: BindingDigest,
    design_identity: BindingDigest,
}

impl AuthenticatedDesignIdentityV1 {
    pub(super) const fn from_role_set(receipt: &StrategyDesignRoleSetReceiptV1) -> Self {
        Self {
            research_request_identity: receipt.research_request_identity,
            design_identity: receipt.design_identity,
        }
    }

    pub(super) const fn from_role_intent(intent: &StrategyDesignRoleIntentV1) -> Self {
        Self {
            research_request_identity: intent.research_request_identity(),
            design_identity: intent.design_identity(),
        }
    }

    pub(super) const fn research_request_identity(self) -> BindingDigest {
        self.research_request_identity
    }

    pub(super) const fn design_identity(self) -> BindingDigest {
        self.design_identity
    }
}

/// Composes the V1 binding request a role's declaration is registered under.
///
/// Every Market Data fact in the result is read off the Owner's own verified batch, and every
/// semantic coordinate off the authenticated role. Nothing here can be supplied by a caller, which
/// is what lets `register_strategy_input_binding_declaration_v1` treat the result as a claim it
/// re-derives rather than as evidence.
pub(super) fn compose_binding_request_v1(
    design: AuthenticatedDesignIdentityV1,
    role: &StrategyDesignRoleEntryV1,
    batch: &VerifiedPitObservationBatch,
) -> Result<UntrustedStrategyInputBindingRequest, PitRoleResolutionErrorV1> {
    let field_semantic = MarketDataFieldSemantic::from_identity(&role.field_semantic_id)
        .ok_or(PitRoleResolutionErrorV1::UnknownFieldSemantic)?;
    let channel = StrategyInputChannel::from_canonical(&role.channel)
        .ok_or(PitRoleResolutionErrorV1::UnsupportedRole)?;
    let unit = StrategyInputUnit::from_canonical(&role.unit)
        .ok_or(PitRoleResolutionErrorV1::UnitMismatch)?;

    if unit != field_semantic.unit() {
        return Err(PitRoleResolutionErrorV1::UnitMismatch);
    }
    // The selection a universe-member role reads is the one the batch itself derives, never one a
    // caller names.
    let scope = match role.scope.as_str() {
        EXACT_INSTRUMENT_ROLE_SCOPE_V1 => UntrustedStrategyInputScope::ExactInstrument {
            instrument: role.instrument.clone(),
        },
        UNIVERSE_MEMBERS_ROLE_SCOPE_V1 => UntrustedStrategyInputScope::UniverseSelection {
            selection_identity: derive_universe_selection(batch)
                .map_err(|_| PitRoleResolutionErrorV1::UniverseUnavailable)?
                .selection_identity(),
        },
        _ => return Err(PitRoleResolutionErrorV1::UnsupportedRole),
    };
    Ok(UntrustedStrategyInputBindingRequest {
        research_request_identity: design.research_request_identity,
        strategy_design_identity: design.design_identity,
        input_role_identity: role.role_identity,
        scope,
        field_semantic,
        channel,
        timeframe: role.timeframe.clone(),
        unit,
        scale: role.scale,
        pit_request_identity: batch.request_identity(),
        pit_request_digest: batch.request_digest(),
        snapshot_identity: batch.snapshot_identity(),
        snapshot_fact_digest: batch.fact_digest(),
        observation_batch_digest: batch.digest(),
        source_binding_identity: batch.source_binding_identity(),
        source_frontier_digest: batch.source_frontier_digest(),
        correction_frontier_digest: batch.correction_frontier_digest(),
        instrument_master_digest: batch.instrument_master_digest(),
        universe_selection_digest: batch.universe_selection_digest(),
        market_semantics_identity: batch.market_semantics_identity(),
        decision_cut: batch.time_evidence().decision_cut.value,
    })
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::{
        BindingDigest, NamedInitialPitRequestV1, PitRoleResolutionErrorV1,
        admit_initial_pit_request_v1, research_pit_requester_identity_v1,
    };

    fn d(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    fn named() -> NamedInitialPitRequestV1 {
        NamedInitialPitRequestV1 {
            pit_request_identity: d(1),
            pit_request_digest: d(2),
        }
    }

    #[rstest]
    fn the_requester_digest_is_sha256_over_its_domain_and_the_research_request() {
        let expected = "ff0ef68f947580320a329350da8421bfb42a9328b75381cd8b93f273d8d9badf";
        let expected: Vec<u8> = (0..expected.len())
            .step_by(2)
            .map(|at| u8::from_str_radix(&expected[at..at + 2], 16).unwrap())
            .collect();
        assert_eq!(
            research_pit_requester_identity_v1(d(7))
                .as_bytes()
                .as_slice(),
            expected.as_slice()
        );
        assert_ne!(
            research_pit_requester_identity_v1(d(7)),
            research_pit_requester_identity_v1(d(8))
        );
    }

    #[rstest]
    fn a_named_initial_pit_request_is_admitted_only_as_itself() {
        let requester = research_pit_requester_identity_v1(d(7));
        assert_eq!(
            admit_initial_pit_request_v1(named(), d(2), true, requester, d(7)),
            Ok(())
        );
        assert_eq!(
            admit_initial_pit_request_v1(named(), d(3), true, requester, d(7)),
            Err(PitRoleResolutionErrorV1::InitialPitRequestDigestMismatch)
        );
        assert_eq!(
            admit_initial_pit_request_v1(named(), d(2), false, requester, d(7)),
            Err(PitRoleResolutionErrorV1::InitialPitRequestNotAvailable)
        );
        // Another Research request's requester, and the raw Research request identity itself,
        // are both refused: only the domain digest is the requester.
        for forged in [research_pit_requester_identity_v1(d(8)), d(7)] {
            assert_eq!(
                admit_initial_pit_request_v1(named(), d(2), true, forged, d(7)),
                Err(PitRoleResolutionErrorV1::InitialPitRequestRequesterMismatch)
            );
        }
    }
}
