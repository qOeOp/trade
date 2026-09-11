//! R&D Owner joint freeze for one canonical Design and Bounded Feature Program.
//!
//! Public Design and BFP values remain proposals. This module can issue a positive frozen value only
//! from crate-private, already-verified Research V2 custody. A durable composition root must call it
//! while retaining the PostgreSQL transaction that supplied that custody.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use thiserror::Error;
use vibe_data::owner::source_binding::BindingDigest;
use vibe_indicators_kernel::PrimitiveCatalogV1;

use crate::{
    bounded_feature_program_v1::{
        BoundedFeatureProgramErrorV1, BoundedFeatureProgramProposalV1,
        prepare_bounded_feature_program_v1,
    },
    develop_composer_v2::CurrentResearchDevelopCustodyV2,
    strategy_design_v2::StrategyDesignV2,
    strategy_plan_v2::{
        StrategyCompilationV2, VerifiedStrategyInputBindingsV2,
        prepare_canonical_strategy_design_v2,
    },
};

const JOINT_FREEZE_SCHEMA_V1: u16 = 1;
const JOINT_FREEZE_DOMAIN_V1: &[u8] = b"rd.bounded-feature-program.joint-freeze.v1\0";
pub(crate) const JOINT_FREEZE_EVENT_KIND_V1: &str = "RESEARCH_BOUNDED_FEATURE_PROGRAM_FROZEN_V1";

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub(crate) enum ResearchBoundedFeatureProgramFreezeErrorV1 {
    #[error("current accepted Research custody does not match the proposed Design")]
    ResearchCustody,
    #[error("Strategy Design is not canonicalizable")]
    Design,
    #[error("Bounded Feature Program is unsupported: {0}")]
    Program(#[from] BoundedFeatureProgramErrorV1),
    #[error("R&D Owner joint-freeze custody is unavailable")]
    Unavailable,
    #[error("a different R&D Owner joint freeze already occupies this Research identity")]
    Conflict,
}

pub(crate) async fn commit_research_bounded_feature_program_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request_locator: &str,
    read_cut_epoch_ms: u64,
    committed_at_epoch_ms: u64,
    design: &StrategyDesignV2,
    proposal: BoundedFeatureProgramProposalV1,
    catalog: PrimitiveCatalogV1,
) -> Result<FrozenResearchBoundedFeatureProgramV1, ResearchBoundedFeatureProgramFreezeErrorV1> {
    sqlx::query(
        "SELECT pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('rd.bounded-feature-program.freeze.v1:' || $1, 0)
         )",
    )
    .bind(request_locator)
    .execute(&mut **transaction)
    .await
    .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    let verified =
        crate::rd_owner_postgres_custody::admit_research_v2_custody_read_only_in_transaction(
            transaction,
            request_locator,
        )
        .await
        .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?
        .ok_or(ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    let custody = CurrentResearchDevelopCustodyV2::from_verified(
        &verified,
        request_locator,
        read_cut_epoch_ms,
    )
    .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    let candidate =
        freeze_research_bounded_feature_program_v1(&custody, design, proposal, catalog)?;

    if let Some(stored) = load_stored_freeze(transaction, request_locator, true).await? {
        validate_stored_freeze(&custody, &stored, catalog)?;
        if !verify_stored_outbox(transaction, request_locator, &stored).await? {
            return Err(ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable);
        }
        return if stored == candidate {
            Ok(stored)
        } else {
            Err(ResearchBoundedFeatureProgramFreezeErrorV1::Conflict)
        };
    }

    sqlx::query(
        "INSERT INTO public.rd_bounded_feature_program_freezes_v1 (
            request_identity, schema_version, research_request_identity, intent_identity,
            intent_digest, research_custody_digest, design_identity, design_digest, design_bytes,
            plugin_manifest_digest, program_digest, program_bytes, joint_freeze_digest,
            committed_at_epoch_ms
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    )
    .bind(request_locator)
    .bind(i32::from(candidate.schema_version))
    .bind(candidate.research_request_identity.as_bytes().as_slice())
    .bind(candidate.intent_identity.as_bytes().as_slice())
    .bind(candidate.intent_digest.as_bytes().as_slice())
    .bind(candidate.research_custody_digest.as_bytes().as_slice())
    .bind(candidate.design_identity.as_bytes().as_slice())
    .bind(candidate.design_digest.as_bytes().as_slice())
    .bind(candidate.design_bytes.as_ref())
    .bind(candidate.plugin_manifest_digest.as_bytes().as_slice())
    .bind(candidate.program_digest.as_bytes().as_slice())
    .bind(candidate.program_bytes.as_ref())
    .bind(candidate.joint_freeze_digest.as_bytes().as_slice())
    .bind(
        i64::try_from(committed_at_epoch_ms)
            .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?,
    )
    .execute(&mut **transaction)
    .await
    .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;

    persist_outbox(
        transaction,
        request_locator,
        &candidate,
        committed_at_epoch_ms,
    )
    .await?;

    let stored = load_stored_freeze(transaction, request_locator, true)
        .await?
        .filter(|stored| stored == &candidate)
        .ok_or(ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    validate_stored_freeze(&custody, &stored, catalog)?;
    if !verify_stored_outbox(transaction, request_locator, &stored).await? {
        return Err(ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable);
    }
    Ok(stored)
}

pub(crate) async fn read_research_bounded_feature_program_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request_locator: &str,
    read_cut_epoch_ms: u64,
    catalog: PrimitiveCatalogV1,
) -> Result<FrozenResearchBoundedFeatureProgramV1, ResearchBoundedFeatureProgramFreezeErrorV1> {
    let verified =
        crate::rd_owner_postgres_custody::admit_research_v2_custody_read_only_in_transaction(
            transaction,
            request_locator,
        )
        .await
        .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?
        .ok_or(ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    let custody = CurrentResearchDevelopCustodyV2::from_verified(
        &verified,
        request_locator,
        read_cut_epoch_ms,
    )
    .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    let stored = load_stored_freeze(transaction, request_locator, false)
        .await?
        .ok_or(ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    if !verify_stored_outbox(transaction, request_locator, &stored).await? {
        return Err(ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable);
    }
    validate_stored_freeze(&custody, &stored, catalog)?;
    Ok(stored)
}

fn validate_stored_freeze(
    custody: &CurrentResearchDevelopCustodyV2,
    stored: &FrozenResearchBoundedFeatureProgramV1,
    catalog: PrimitiveCatalogV1,
) -> Result<(), ResearchBoundedFeatureProgramFreezeErrorV1> {
    let design: StrategyDesignV2 = serde_json::from_slice(stored.design_bytes())
        .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    let parsed_program = crate::bounded_feature_program_v1::parse_bounded_feature_program_v1(
        stored.program_bytes(),
        &design,
        catalog,
    )
    .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    let rebuilt = freeze_research_bounded_feature_program_v1(
        custody,
        &design,
        parsed_program.program().clone(),
        catalog,
    )
    .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    if &rebuilt != stored {
        return Err(ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable);
    }
    Ok(())
}

async fn load_stored_freeze(
    transaction: &mut Transaction<'_, Postgres>,
    request_locator: &str,
    exclusive: bool,
) -> Result<Option<FrozenResearchBoundedFeatureProgramV1>, ResearchBoundedFeatureProgramFreezeErrorV1>
{
    let row = if exclusive {
        sqlx::query(
            "SELECT schema_version, research_request_identity, intent_identity, intent_digest,
                    research_custody_digest, design_identity, design_digest, design_bytes,
                    plugin_manifest_digest, program_digest, program_bytes, joint_freeze_digest
               FROM public.rd_bounded_feature_program_freezes_v1
              WHERE request_identity=$1 FOR UPDATE",
        )
        .bind(request_locator)
        .fetch_optional(&mut **transaction)
        .await
    } else {
        sqlx::query(
            "SELECT schema_version, research_request_identity, intent_identity, intent_digest,
                    research_custody_digest, design_identity, design_digest, design_bytes,
                    plugin_manifest_digest, program_digest, program_bytes, joint_freeze_digest
               FROM public.rd_bounded_feature_program_freezes_v1
              WHERE request_identity=$1 FOR SHARE",
        )
        .bind(request_locator)
        .fetch_optional(&mut **transaction)
        .await
    }
    .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    row.as_ref().map(decode_stored_freeze).transpose()
}

fn decode_stored_freeze(
    row: &sqlx::postgres::PgRow,
) -> Result<FrozenResearchBoundedFeatureProgramV1, ResearchBoundedFeatureProgramFreezeErrorV1> {
    let schema_version: i32 = row
        .try_get("schema_version")
        .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    if schema_version != i32::from(JOINT_FREEZE_SCHEMA_V1) {
        return Err(ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable);
    }
    Ok(FrozenResearchBoundedFeatureProgramV1 {
        schema_version: JOINT_FREEZE_SCHEMA_V1,
        research_request_identity: row_digest(row, "research_request_identity")?,
        intent_identity: row_digest(row, "intent_identity")?,
        intent_digest: row_digest(row, "intent_digest")?,
        research_custody_digest: row_digest(row, "research_custody_digest")?,
        design_identity: row_digest(row, "design_identity")?,
        design_digest: row_digest(row, "design_digest")?,
        design_bytes: row_bytes(row, "design_bytes")?.into_boxed_slice(),
        plugin_manifest_digest: row_digest(row, "plugin_manifest_digest")?,
        program_digest: row_digest(row, "program_digest")?,
        program_bytes: row_bytes(row, "program_bytes")?.into_boxed_slice(),
        joint_freeze_digest: row_digest(row, "joint_freeze_digest")?,
    })
}

fn row_digest(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<BindingDigest, ResearchBoundedFeatureProgramFreezeErrorV1> {
    let bytes = row_bytes(row, column)?;
    let digest: [u8; 32] = bytes
        .try_into()
        .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    Ok(BindingDigest::from_untrusted_bytes(digest))
}

fn row_bytes(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<Vec<u8>, ResearchBoundedFeatureProgramFreezeErrorV1> {
    row.try_get(column)
        .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)
}

#[derive(Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct ResearchBoundedFeatureProgramOutboxV1 {
    schema_version: u16,
    research_request_identity: BindingDigest,
    intent_identity: BindingDigest,
    research_custody_digest: BindingDigest,
    design_identity: BindingDigest,
    design_digest: BindingDigest,
    plugin_manifest_digest: BindingDigest,
    program_digest: BindingDigest,
    joint_freeze_digest: BindingDigest,
}

impl From<&FrozenResearchBoundedFeatureProgramV1> for ResearchBoundedFeatureProgramOutboxV1 {
    fn from(value: &FrozenResearchBoundedFeatureProgramV1) -> Self {
        Self {
            schema_version: value.schema_version,
            research_request_identity: value.research_request_identity,
            intent_identity: value.intent_identity,
            research_custody_digest: value.research_custody_digest,
            design_identity: value.design_identity,
            design_digest: value.design_digest,
            plugin_manifest_digest: value.plugin_manifest_digest,
            program_digest: value.program_digest,
            joint_freeze_digest: value.joint_freeze_digest,
        }
    }
}

async fn persist_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    request_locator: &str,
    frozen: &FrozenResearchBoundedFeatureProgramV1,
    committed_at_epoch_ms: u64,
) -> Result<(), ResearchBoundedFeatureProgramFreezeErrorV1> {
    let payload = ResearchBoundedFeatureProgramOutboxV1::from(frozen);
    let payload_json = serde_json::to_value(&payload)
        .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    let payload_digest = outbox_payload_digest(&payload_json)?;
    let event_identity = outbox_event_identity(frozen.joint_freeze_digest);
    sqlx::query(
        "INSERT INTO public.rd_owner_outbox_v1 (
            event_identity, aggregate_identity, event_kind, payload_digest, payload_json,
            committed_at_epoch_ms
         ) VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(event_identity)
    .bind(request_locator)
    .bind(JOINT_FREEZE_EVENT_KIND_V1)
    .bind(payload_digest)
    .bind(payload_json)
    .bind(
        i64::try_from(committed_at_epoch_ms)
            .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?,
    )
    .execute(&mut **transaction)
    .await
    .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    Ok(())
}

async fn verify_stored_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    request_locator: &str,
    frozen: &FrozenResearchBoundedFeatureProgramV1,
) -> Result<bool, ResearchBoundedFeatureProgramFreezeErrorV1> {
    let row = sqlx::query(
        "SELECT outbox.event_identity, outbox.payload_digest, outbox.payload_json
           FROM public.rd_owner_outbox_v1 outbox
           JOIN public.rd_bounded_feature_program_freezes_v1 frozen
             ON frozen.request_identity=outbox.aggregate_identity
            AND frozen.committed_at_epoch_ms=outbox.committed_at_epoch_ms
          WHERE outbox.aggregate_identity=$1 AND outbox.event_kind=$2
          FOR SHARE OF outbox, frozen",
    )
    .bind(request_locator)
    .bind(JOINT_FREEZE_EVENT_KIND_V1)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    let Some(row) = row else {
        return Ok(false);
    };
    let payload_json: serde_json::Value = row
        .try_get("payload_json")
        .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    let payload: ResearchBoundedFeatureProgramOutboxV1 =
        serde_json::from_value(payload_json.clone())
            .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    let expected_payload = ResearchBoundedFeatureProgramOutboxV1::from(frozen);
    let event_identity: String = row
        .try_get("event_identity")
        .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    let payload_digest: String = row
        .try_get("payload_digest")
        .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    Ok(payload == expected_payload
        && payload_json
            == serde_json::to_value(&expected_payload)
                .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?
        && event_identity == outbox_event_identity(frozen.joint_freeze_digest)
        && payload_digest == outbox_payload_digest(&payload_json)?)
}

fn outbox_event_identity(joint_freeze_digest: BindingDigest) -> String {
    let mut hash = Sha256::new();
    hash.update(b"rd.bounded-feature-program.outbox-event.v1\0");
    hash.update(joint_freeze_digest.as_bytes());
    format!("rd-bfp-freeze-event-v1-{:x}", hash.finalize())
}

fn outbox_payload_digest(
    payload_json: &serde_json::Value,
) -> Result<String, ResearchBoundedFeatureProgramFreezeErrorV1> {
    let bytes = serde_json::to_vec(&("rd.owner-outbox.payload.v1", payload_json))
        .map_err(|_| ResearchBoundedFeatureProgramFreezeErrorV1::Unavailable)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

/// Positive R&D joint-freeze value.
///
/// Private fields and the absence of `Deserialize` and a public constructor prevent callers from
/// upgrading a proposal or caller-authored digest into Owner custody. Durable readback must rebuild
/// this value from the exact stored bytes while holding the same R&D Owner authority cut.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct FrozenResearchBoundedFeatureProgramV1 {
    schema_version: u16,
    research_request_identity: BindingDigest,
    intent_identity: BindingDigest,
    intent_digest: BindingDigest,
    research_custody_digest: BindingDigest,
    design_identity: BindingDigest,
    design_digest: BindingDigest,
    design_bytes: Box<[u8]>,
    plugin_manifest_digest: BindingDigest,
    program_digest: BindingDigest,
    program_bytes: Box<[u8]>,
    joint_freeze_digest: BindingDigest,
}

impl FrozenResearchBoundedFeatureProgramV1 {
    pub(crate) const fn schema_version(&self) -> u16 {
        self.schema_version
    }

    pub(crate) const fn research_request_identity(&self) -> BindingDigest {
        self.research_request_identity
    }

    pub(crate) const fn intent_identity(&self) -> BindingDigest {
        self.intent_identity
    }

    pub(crate) const fn intent_digest(&self) -> BindingDigest {
        self.intent_digest
    }

    pub(crate) const fn research_custody_digest(&self) -> BindingDigest {
        self.research_custody_digest
    }

    pub(crate) const fn design_identity(&self) -> BindingDigest {
        self.design_identity
    }

    pub(crate) const fn design_digest(&self) -> BindingDigest {
        self.design_digest
    }

    pub(crate) fn design_bytes(&self) -> &[u8] {
        &self.design_bytes
    }

    pub(crate) const fn plugin_manifest_digest(&self) -> BindingDigest {
        self.plugin_manifest_digest
    }

    pub(crate) const fn program_digest(&self) -> BindingDigest {
        self.program_digest
    }

    pub(crate) fn program_bytes(&self) -> &[u8] {
        &self.program_bytes
    }

    pub(crate) const fn joint_freeze_digest(&self) -> BindingDigest {
        self.joint_freeze_digest
    }
}

pub(crate) fn freeze_research_bounded_feature_program_v1(
    custody: &CurrentResearchDevelopCustodyV2,
    design: &StrategyDesignV2,
    proposal: BoundedFeatureProgramProposalV1,
    catalog: PrimitiveCatalogV1,
) -> Result<FrozenResearchBoundedFeatureProgramV1, ResearchBoundedFeatureProgramFreezeErrorV1> {
    if design.research_request_identity != custody.research_request_identity()
        || design.intent_identity != custody.intent_identity()
        || design.intent_digest != custody.intent_digest()
        || design.falsifier != custody.falsifier()
    {
        return Err(ResearchBoundedFeatureProgramFreezeErrorV1::ResearchCustody);
    }

    let canonical_design =
        prepare_canonical_strategy_design_v2(design).map_err(map_design_error)?;
    let canonical_program = prepare_bounded_feature_program_v1(proposal, design, catalog)?;

    let program = canonical_program.program();
    if program.design_identity != canonical_design.design_identity()
        || program.design_digest != canonical_design.design_digest()
    {
        return Err(ResearchBoundedFeatureProgramFreezeErrorV1::Design);
    }

    let joint_freeze_digest = joint_freeze_digest(
        custody.custody_digest(),
        canonical_design.design_identity(),
        canonical_design.design_digest(),
        program.plugin_manifest_digest,
        canonical_program.digest(),
        canonical_design.canonical_bytes(),
        canonical_program.canonical_bytes(),
    );

    Ok(FrozenResearchBoundedFeatureProgramV1 {
        schema_version: JOINT_FREEZE_SCHEMA_V1,
        research_request_identity: custody.research_request_identity(),
        intent_identity: custody.intent_identity(),
        intent_digest: custody.intent_digest(),
        research_custody_digest: custody.custody_digest(),
        design_identity: canonical_design.design_identity(),
        design_digest: canonical_design.design_digest(),
        design_bytes: canonical_design.canonical_bytes().into(),
        plugin_manifest_digest: program.plugin_manifest_digest,
        program_digest: canonical_program.digest(),
        program_bytes: canonical_program.canonical_bytes().into(),
        joint_freeze_digest,
    })
}

fn map_design_error(_: StrategyCompilationV2) -> ResearchBoundedFeatureProgramFreezeErrorV1 {
    ResearchBoundedFeatureProgramFreezeErrorV1::Design
}

#[allow(clippy::too_many_arguments)]
fn joint_freeze_digest(
    research_custody_digest: BindingDigest,
    design_identity: BindingDigest,
    design_digest: BindingDigest,
    plugin_manifest_digest: BindingDigest,
    program_digest: BindingDigest,
    design_bytes: &[u8],
    program_bytes: &[u8],
) -> BindingDigest {
    let mut hash = Sha256::new();
    hash.update(JOINT_FREEZE_DOMAIN_V1);
    hash.update(JOINT_FREEZE_SCHEMA_V1.to_le_bytes());
    hash.update(research_custody_digest.as_bytes());
    hash.update(design_identity.as_bytes());
    hash.update(design_digest.as_bytes());
    hash.update(plugin_manifest_digest.as_bytes());
    hash.update(program_digest.as_bytes());
    hash.update((design_bytes.len() as u64).to_le_bytes());
    hash.update(design_bytes);
    hash.update((program_bytes.len() as u64).to_le_bytes());
    hash.update(program_bytes);
    BindingDigest::from_untrusted_bytes(hash.finalize().into())
}

pub(crate) fn joint_freeze_matches_current_design_v1(
    custody: &CurrentResearchDevelopCustodyV2,
    design: &StrategyDesignV2,
    plugin_manifest_digest: BindingDigest,
    program_digest: BindingDigest,
    program_bytes: &[u8],
    expected_joint_freeze_digest: BindingDigest,
) -> bool {
    let Ok(canonical_design) = prepare_canonical_strategy_design_v2(design) else {
        return false;
    };
    joint_freeze_digest(
        custody.custody_digest(),
        canonical_design.design_identity(),
        canonical_design.design_digest(),
        plugin_manifest_digest,
        program_digest,
        canonical_design.canonical_bytes(),
        program_bytes,
    ) == expected_joint_freeze_digest
}

pub(crate) fn frozen_program_matches_current_static_bindings_v1(
    design: &StrategyDesignV2,
    program_bytes: &[u8],
    bindings: &VerifiedStrategyInputBindingsV2,
) -> bool {
    let Ok(catalog) = PrimitiveCatalogV1::verify() else {
        return false;
    };
    let Ok(program) = crate::bounded_feature_program_v1::parse_bounded_feature_program_v1(
        program_bytes,
        design,
        catalog,
    ) else {
        return false;
    };
    program.program().inputs.iter().all(|input| {
        bindings.receipt_digest_for_role(input.input_role_identity)
            == Some(input.static_binding_receipt_digest)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        bounded_feature_program_v1::tests::candidate,
        develop_composer_v2::CurrentResearchDevelopCustodyV2,
    };

    #[rstest::rstest]
    fn freezes_exact_custody_and_canonical_design_program_bytes() {
        let (design, proposal, catalog) = candidate();
        let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);

        let frozen = freeze_research_bounded_feature_program_v1(
            &custody,
            &design,
            proposal.clone(),
            catalog,
        )
        .unwrap();

        let mut reordered = design;
        reordered.reactions.reverse();
        let reordered_frozen =
            freeze_research_bounded_feature_program_v1(&custody, &reordered, proposal, catalog)
                .unwrap();

        assert_eq!(frozen.schema_version(), 1);
        assert_eq!(frozen.research_custody_digest(), custody.custody_digest());
        assert_eq!(frozen.design_bytes(), reordered_frozen.design_bytes());
        assert_eq!(frozen.program_bytes(), reordered_frozen.program_bytes());
        assert_eq!(
            frozen.joint_freeze_digest(),
            reordered_frozen.joint_freeze_digest()
        );
    }

    #[rstest::rstest]
    fn rejects_cross_spliced_research_custody_before_freeze() {
        let (mut design, proposal, catalog) = candidate();
        let custody = CurrentResearchDevelopCustodyV2::joint_bfp_test_fixture(&design);
        design.intent_digest = BindingDigest::from_untrusted_bytes([99; 32]);

        assert_eq!(
            freeze_research_bounded_feature_program_v1(&custody, &design, proposal, catalog),
            Err(ResearchBoundedFeatureProgramFreezeErrorV1::ResearchCustody)
        );
    }
}
