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
    source_binding::BindingDigest,
    strategy_design_role_intent_v1::StrategyDesignRoleIntentV1,
    strategy_design_role_set::{StrategyDesignRoleEntryV1, StrategyDesignRoleSetReceiptV1},
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
        UntrustedStrategyInputBindingRequest, UntrustedStrategyInputScope,
    },
};

/// The exact canonical scope string a first-vertical role carries.
const EXACT_INSTRUMENT_SCOPE: &str = r#"{"kind":"EXACT_INSTRUMENT"}"#;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum PitRoleResolutionErrorV1 {
    /// The role is not a first-vertical exact-instrument market role.
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

/// Resolves one authenticated role to the single snapshot that answers it.
pub(super) async fn resolve_role_snapshot_v1(
    transaction: &mut Transaction<'_, Postgres>,
    role: &StrategyDesignRoleEntryV1,
) -> Result<ResolvedRoleSnapshotV1, PitRoleResolutionErrorV1> {
    if role.fact_class != "MARKET_DATA"
        || role.scope != EXACT_INSTRUMENT_SCOPE
        || role.value_type != "I128"
        || role.instrument.is_empty()
        || role.timeframe.is_empty()
        || role.channel.is_empty()
    {
        return Err(PitRoleResolutionErrorV1::UnsupportedRole);
    }
    let semantic = MarketDataFieldSemantic::from_identity(&role.field_semantic_id)
        .ok_or(PitRoleResolutionErrorV1::UnknownFieldSemantic)?;

    if role.unit != semantic.unit().canonical() {
        return Err(PitRoleResolutionErrorV1::UnitMismatch);
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
    Ok(UntrustedStrategyInputBindingRequest {
        research_request_identity: design.research_request_identity,
        strategy_design_identity: design.design_identity,
        input_role_identity: role.role_identity,
        scope: UntrustedStrategyInputScope::ExactInstrument {
            instrument: role.instrument.clone(),
        },
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
