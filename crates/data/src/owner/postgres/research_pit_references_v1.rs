//! The two reads R&D makes of a Research request's instrument scope, in its own transaction.
//!
//! The `market_data_rd_api` functions below only return stored evidence: the Owner's clock head,
//! the current eligible-instrument frontier's membership facts for the requested instruments, their
//! Instrument Master facts, and one Source Binding lineage's head. They are `STABLE` and take no
//! row locks, so a check never waits on, or holds up, a Market Data writer. The Owner decoders and
//! selection rules the intake itself uses decide every answer here.

use std::collections::BTreeSet;

use sqlx::{Postgres, Transaction};

use crate::owner::{
    instrument_master::{
        InstrumentMasterFactV1,
        authority::{ObservationClockV1, select_facts_observed},
    },
    research_instrument_scope_v1::ResearchInstrumentScopeV1,
    research_pit_references_v1::{
        ResearchInstrumentAdmissibilityV1, ResearchInstrumentCheckRowV1,
        ResearchInstrumentScopeCheckV1, ResearchInstrumentScopeReadErrorV1,
        ResearchPitReferencesErrorV1, ResearchPitReferencesFieldsV1, ResearchPitReferencesV1,
    },
    source_binding::{
        BindingDigest, MarketDataClockAdmission,
        authority::{SourceBindingDisposition, derive_market_semantics_compatibility_identity_v1},
    },
    universe_selection::authority::{
        HistoricalMembershipSourceFactV1, decode_source_fact_v1, latest_membership_fact_v1,
        membership_fact_in_force_v1,
    },
};

pub(super) const SCHEMA_V1: &[&str] = &[
    "CREATE OR REPLACE FUNCTION market_data_rd_api.read_owner_clock_head_for_research_v1() RETURNS TABLE(clock_identity TEXT,clock_epoch TEXT,monotonic_sequence BIGINT,wall_observed BIGINT,decision_cut BIGINT,valid_through BIGINT,restart_continuity_digest BYTEA,uncertainty_bound BIGINT,skew_bound BIGINT,comparison_rule SMALLINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT c.clock_identity,c.clock_epoch,c.monotonic_sequence,c.wall_observed,c.decision_cut,c.valid_through,c.restart_continuity_digest,c.uncertainty_bound,c.skew_bound,c.comparison_rule FROM market_data_private.clock_head_v1 c WHERE c.singleton $function$",
    "CREATE OR REPLACE FUNCTION market_data_rd_api.read_eligible_frontier_members_for_research_v1(p_instruments BYTEA[]) RETURNS TABLE(eligible_frontier BYTEA,fact_identity BYTEA,fact_bytes BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT c.eligible_frontier,m.fact_identity,m.fact_bytes FROM (SELECT market_data_private.current_eligible_frontier_v1() AS eligible_frontier) c LEFT JOIN (market_data_private.historical_membership_facts_v1 m JOIN market_data_private.historical_membership_manifest_v1 x ON x.eligible_frontier=m.eligible_frontier AND x.member_key=m.member_key) ON m.eligible_frontier=c.eligible_frontier AND m.instrument=ANY(p_instruments) WHERE c.eligible_frontier IS NOT NULL ORDER BY m.fact_identity $function$",
    "CREATE OR REPLACE FUNCTION market_data_rd_api.read_instrument_facts_for_research_v1(p_identities TEXT[]) RETURNS TABLE(fact_digest BYTEA,canonical_identity TEXT,predecessor_fact_digest BYTEA,fact_bytes BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT f.fact_digest,f.canonical_identity,f.predecessor_fact_digest,f.fact_bytes FROM market_data_private.instrument_master_facts_v1 f WHERE f.canonical_identity=ANY(p_identities) ORDER BY f.canonical_identity,f.fact_digest $function$",
    "CREATE OR REPLACE FUNCTION market_data_rd_api.read_source_binding_head_for_research_v1(p_lineage_root BYTEA) RETURNS TABLE(row_identity BYTEA,fact_digest BYTEA,request_identity BYTEA,request_digest BYTEA,correction_stream_identity TEXT,correction_sequence BIGINT,fact_lineage_root BYTEA,fact_lineage_version BIGINT,aggregate_json JSONB,outbox_event_identity BYTEA,outbox_aggregate_identity BYTEA,outbox_payload BYTEA,outbox_digest BYTEA,head_lineage_root BYTEA,head_identity BYTEA,head_digest BYTEA,head_version BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $function$ SELECT f.binding_id,f.fact_digest,NULL::BYTEA,NULL::BYTEA,NULL::TEXT,NULL::BIGINT,f.lineage_root,f.lineage_version,f.aggregate_json,o.event_identity,o.aggregate_identity,o.payload,o.payload_digest,h.lineage_root,h.binding_id,h.fact_digest,h.lineage_version FROM market_data_private.source_binding_heads_v1 h JOIN market_data_private.source_binding_facts_v1 f ON f.binding_id=h.binding_id JOIN market_data_private.source_binding_outbox_v1 o ON o.aggregate_identity=f.binding_id WHERE h.lineage_root=p_lineage_root $function$",
    "REVOKE ALL ON FUNCTION market_data_rd_api.read_owner_clock_head_for_research_v1() FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_rd_api.read_eligible_frontier_members_for_research_v1(BYTEA[]) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_rd_api.read_instrument_facts_for_research_v1(TEXT[]) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_rd_api.read_source_binding_head_for_research_v1(BYTEA) FROM PUBLIC",
    "DO $grant$ BEGIN IF pg_catalog.to_regrole('rd_owner') IS NOT NULL THEN GRANT EXECUTE ON FUNCTION market_data_rd_api.read_owner_clock_head_for_research_v1(),market_data_rd_api.read_eligible_frontier_members_for_research_v1(BYTEA[]),market_data_rd_api.read_instrument_facts_for_research_v1(TEXT[]),market_data_rd_api.read_source_binding_head_for_research_v1(BYTEA) TO rd_owner; END IF; END $grant$",
];

/// What the store holds for one scope at the Owner's current decision cut.
struct ScopeEvidenceV1 {
    clock: MarketDataClockAdmission,
    frontier: Option<BindingDigest>,
    membership: Vec<HistoricalMembershipSourceFactV1>,
    instruments: Vec<InstrumentMasterFactV1>,
}

/// Why the evidence could not be read.
enum EvidenceErrorV1 {
    ClockUnavailable,
    StoreUnavailable,
}

impl From<EvidenceErrorV1> for ResearchInstrumentScopeReadErrorV1 {
    fn from(error: EvidenceErrorV1) -> Self {
        match error {
            EvidenceErrorV1::ClockUnavailable => Self::ClockUnavailable,
            EvidenceErrorV1::StoreUnavailable => Self::StoreUnavailable,
        }
    }
}

impl From<EvidenceErrorV1> for ResearchPitReferencesErrorV1 {
    fn from(error: EvidenceErrorV1) -> Self {
        match error {
            EvidenceErrorV1::ClockUnavailable => Self::ClockUnavailable,
            EvidenceErrorV1::StoreUnavailable => Self::StoreUnavailable,
        }
    }
}

/// Checks each identity of a Research request's scope at Market Data's current decision cut.
///
/// Runs in the caller's R&D transaction, reads only, and takes no row locks. It only refuses
/// early: the fixed-member evaluation when the initial PIT request is issued remains the decision.
///
/// # Errors
///
/// [`ResearchInstrumentScopeReadErrorV1::ClockUnavailable`] when Market Data holds no clock head,
/// and [`ResearchInstrumentScopeReadErrorV1::StoreUnavailable`] when the store cannot be read or
/// returns evidence Market Data does not trust.
pub async fn check_research_instrument_scope_v1(
    transaction: &mut Transaction<'_, Postgres>,
    scope: &ResearchInstrumentScopeV1,
) -> Result<ResearchInstrumentScopeCheckV1, ResearchInstrumentScopeReadErrorV1> {
    let evidence = read_scope_evidence_v1(transaction, scope).await?;
    let rows = scope
        .identities()
        .iter()
        .map(|identity| {
            ResearchInstrumentCheckRowV1::new(
                identity.clone(),
                admissibility_v1(&evidence, identity),
            )
        })
        .collect();
    Ok(ResearchInstrumentScopeCheckV1::new(
        rows,
        evidence.frontier,
        super::public_decision_cut_v1(&evidence.clock),
    ))
}

/// Resolves every Market Data reference an initial PIT request for this scope carries.
///
/// Runs in the caller's R&D transaction, reads only, and takes no row locks. The caller states
/// nothing of its own: the frontier, the Source Binding, its lineage root and correction frontier,
/// the Market Semantics identity and the decision cut are all Market Data's.
///
/// # Errors
///
/// [`ResearchPitReferencesErrorV1::InstrumentNotAdmissible`] when any identity is not admissible,
/// [`ResearchPitReferencesErrorV1::SourceBindingLineagesDiffer`] when the identities' membership
/// facts name more than one lineage or correction frontier,
/// [`ResearchPitReferencesErrorV1::SourceBindingUnavailable`] when that lineage has no admitted
/// head, and the clock and store failures of the check.
pub async fn resolve_research_pit_references_v1(
    transaction: &mut Transaction<'_, Postgres>,
    scope: &ResearchInstrumentScopeV1,
) -> Result<ResearchPitReferencesV1, ResearchPitReferencesErrorV1> {
    let evidence = read_scope_evidence_v1(transaction, scope).await?;
    let frontier = evidence
        .frontier
        .ok_or(ResearchPitReferencesErrorV1::InstrumentNotAdmissible)?;
    let mut named = Vec::with_capacity(scope.identities().len());

    for identity in scope.identities() {
        if admissibility_v1(&evidence, identity) != ResearchInstrumentAdmissibilityV1::Admissible {
            return Err(ResearchPitReferencesErrorV1::InstrumentNotAdmissible);
        }
        named.extend(frontier_fact_v1(&evidence, identity));
    }
    let (lineage_root, correction_frontier_digest) =
        one_lineage_v1(&named).ok_or(ResearchPitReferencesErrorV1::SourceBindingLineagesDiffer)?;
    let source = sqlx::query(
        "SELECT * FROM market_data_rd_api.read_source_binding_head_for_research_v1($1)",
    )
    .bind(lineage_root.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| ResearchPitReferencesErrorV1::StoreUnavailable)?
    .ok_or(ResearchPitReferencesErrorV1::SourceBindingUnavailable)?;
    let source = super::decode_source_row(&source, true)
        .map_err(|_| ResearchPitReferencesErrorV1::StoreUnavailable)?;
    let source_fact = source.commit().fact();

    if source_fact.lineage_root() != lineage_root {
        return Err(ResearchPitReferencesErrorV1::StoreUnavailable);
    }

    if source_fact.disposition() != SourceBindingDisposition::Admitted {
        return Err(ResearchPitReferencesErrorV1::SourceBindingUnavailable);
    }
    Ok(ResearchPitReferencesV1::new(
        ResearchPitReferencesFieldsV1 {
            eligible_instrument_frontier: frontier,
            source_binding: source.commit().receipt().locator().clone(),
            source_binding_lineage_root: lineage_root,
            correction_frontier_digest,
            market_semantics_identity: derive_market_semantics_compatibility_identity_v1(
                &source_fact.proposal().semantics,
            ),
            decision_cut: super::public_decision_cut_v1(&evidence.clock),
        },
    ))
}

async fn read_scope_evidence_v1(
    transaction: &mut Transaction<'_, Postgres>,
    scope: &ResearchInstrumentScopeV1,
) -> Result<ScopeEvidenceV1, EvidenceErrorV1> {
    let clock =
        sqlx::query("SELECT * FROM market_data_rd_api.read_owner_clock_head_for_research_v1()")
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|_| EvidenceErrorV1::StoreUnavailable)?
            .ok_or(EvidenceErrorV1::ClockUnavailable)?;
    let clock = super::decode_clock(&clock).map_err(|_| EvidenceErrorV1::StoreUnavailable)?;

    let instruments: Vec<Vec<u8>> = scope
        .identities()
        .iter()
        .map(|identity| identity.as_bytes().to_vec())
        .collect();
    let rows = sqlx::query(
        "SELECT eligible_frontier,fact_identity,fact_bytes FROM market_data_rd_api.read_eligible_frontier_members_for_research_v1($1)",
    )
    .bind(&instruments)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| EvidenceErrorV1::StoreUnavailable)?;
    let (frontier, membership) = decode_frontier_rows_v1(&rows)?;

    let instruments = sqlx::query(
        "SELECT fact_digest,canonical_identity,predecessor_fact_digest,fact_bytes FROM market_data_rd_api.read_instrument_facts_for_research_v1($1)",
    )
    .bind(scope.identities())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| EvidenceErrorV1::StoreUnavailable)?;
    let instruments = super::decode_instrument_fact_rows(instruments)
        .map_err(|_| EvidenceErrorV1::StoreUnavailable)?;

    Ok(ScopeEvidenceV1 {
        clock,
        frontier,
        membership,
        instruments,
    })
}

/// The current frontier and its membership facts, each checked against the identity it is stored
/// under. No row at all means Market Data holds no current frontier.
fn decode_frontier_rows_v1(
    rows: &[sqlx::postgres::PgRow],
) -> Result<(Option<BindingDigest>, Vec<HistoricalMembershipSourceFactV1>), EvidenceErrorV1> {
    use sqlx::Row;

    let digest = |bytes: Vec<u8>| {
        <[u8; 32]>::try_from(bytes.as_slice())
            .map(BindingDigest::from_untrusted_bytes)
            .map_err(|_| EvidenceErrorV1::StoreUnavailable)
    };
    let mut frontiers = BTreeSet::new();
    let mut membership = Vec::with_capacity(rows.len());

    for row in rows {
        let frontier: Vec<u8> = row
            .try_get("eligible_frontier")
            .map_err(|_| EvidenceErrorV1::StoreUnavailable)?;
        frontiers.insert(digest(frontier)?);
        let identity: Option<Vec<u8>> = row
            .try_get("fact_identity")
            .map_err(|_| EvidenceErrorV1::StoreUnavailable)?;
        let bytes: Option<Vec<u8>> = row
            .try_get("fact_bytes")
            .map_err(|_| EvidenceErrorV1::StoreUnavailable)?;

        match (identity, bytes) {
            (None, None) => {}
            (Some(identity), Some(bytes)) => {
                let fact =
                    decode_source_fact_v1(&bytes).map_err(|_| EvidenceErrorV1::StoreUnavailable)?;
                if fact.identity().as_bytes() != identity.as_slice() {
                    return Err(EvidenceErrorV1::StoreUnavailable);
                }
                membership.push(fact);
            }
            _ => return Err(EvidenceErrorV1::StoreUnavailable),
        }
    }

    if frontiers.len() > 1 {
        return Err(EvidenceErrorV1::StoreUnavailable);
    }
    Ok((frontiers.pop_first(), membership))
}

/// How one identity stands; an unresolved identity is reported before its frontier membership.
fn admissibility_v1(
    evidence: &ScopeEvidenceV1,
    identity: &str,
) -> ResearchInstrumentAdmissibilityV1 {
    if evidence.frontier.is_none() {
        return ResearchInstrumentAdmissibilityV1::NotInEligibleFrontier;
    }

    if !resolves_v1(evidence, identity) {
        return ResearchInstrumentAdmissibilityV1::Unresolved;
    }

    if frontier_fact_v1(evidence, identity).is_none() {
        return ResearchInstrumentAdmissibilityV1::NotInEligibleFrontier;
    }
    ResearchInstrumentAdmissibilityV1::Admissible
}

/// Whether the Instrument Master selects exactly one fact for the identity at the cut, read as a
/// request whose event instant and observation are the cut itself.
fn resolves_v1(evidence: &ScopeEvidenceV1, identity: &str) -> bool {
    let Some(clock) = ObservationClockV1::from_owner_head(
        &evidence.clock.clock_identity,
        &evidence.clock.clock_epoch,
        evidence.clock.monotonic_sequence,
    ) else {
        return false;
    };
    let cut = evidence.clock.decision_cut;
    select_facts_observed(
        &evidence.instruments,
        std::slice::from_ref(&identity.to_owned()),
        i128::from(cut),
        i128::from(cut),
        cut,
        clock,
    )
    .is_ok()
}

/// The one membership fact in force for the identity in the current frontier, by the selection
/// rule the Universe Selection evaluator applies.
fn frontier_fact_v1<'a>(
    evidence: &'a ScopeEvidenceV1,
    identity: &str,
) -> Option<&'a HistoricalMembershipSourceFactV1> {
    let cut = evidence.clock.decision_cut;
    latest_membership_fact_v1(evidence.membership.iter().filter(|fact| {
        fact.instrument() == identity.as_bytes()
            && membership_fact_in_force_v1(fact, i128::from(cut), i128::from(cut), cut)
    }))
}

/// The one lineage root and correction frontier every named fact states, if they agree.
fn one_lineage_v1(
    facts: &[&HistoricalMembershipSourceFactV1],
) -> Option<(BindingDigest, BindingDigest)> {
    let lineages = facts
        .iter()
        .map(|fact| {
            (
                fact.proposal.source_binding_lineage_root,
                fact.proposal.correction_frontier_digest,
            )
        })
        .collect::<BTreeSet<_>>();
    let [lineage] = lineages.into_iter().collect::<Vec<_>>()[..] else {
        return None;
    };
    Some(lineage)
}
