#![allow(
    dead_code,
    reason = "storage codec and test fault seams stay private behind the sealed Owner resolvers"
)]

use sqlx::{Postgres, Row, Transaction};

use super::{
    ReplayCorporateActionTermsV2, ReplayMarketDependencyKindV2, ReplayMarketDependencyRefV2,
    ReplayMarketFactsReadbackV2, ReplayPriceAdjustmentV2, ReplayReferenceFactKindV2,
    ReplayReferenceFactTimeV2, ReplayReferenceFactValueV2, ReplayTimestampBasisV2,
    UntrustedReplayMarketFactsRequestV2,
    authority::{
        ReplayMarketFactsEvidenceV2, ReplayNativeChainEvidenceV2, ReplayReferenceFactCutProposalV2,
        ReplayReferenceFactProposalV2, ReplayReferenceFactScopeProposalV2,
        issue_replay_market_facts_v2,
    },
    codec::{
        CUT_DOMAIN, FACTS_DOMAIN, FRONTIER_DOMAIN, MAX_AGGREGATE_BYTES, MAX_CUT_BYTES,
        MAX_FIELD_BYTES, MAX_FRONTIER_BYTES, MAX_RECEIPT_BYTES, RECEIPT_DOMAIN, digest,
    },
    composition::{
        ReplayCompositionBindingLocatorV1, ReplayCompositionBindingReadbackV1,
        decode_replay_composition_binding_v1, verify_replay_composition_binding_v1,
    },
    verify_replay_market_facts_readback_v2,
};
use crate::owner::source_binding::BindingDigest;
const STORAGE_DOMAIN: &[u8] = b"vibe.market-data.replay-market-facts-storage.v2\0";
const MEANING_DOMAIN: &[u8] = b"vibe.market-data.replay-market-facts-meaning.v2\0";
const BOUND_MEANING_DOMAIN: &[u8] = b"vibe.market-data.replay-market-facts-bound-meaning.v1\0";
const GENERATION_DOMAIN: &[u8] = b"vibe.market-data.replay-market-facts-generation.v2\0";
const MANIFEST_DOMAIN: &[u8] = b"vibe.market-data.replay-market-facts-manifest.v2\0";
const RECEIPT_CUSTODY_DOMAIN: &[u8] = b"vibe.market-data.replay-market-facts-receipt-custody.v2\0";
const OUTBOX_CUSTODY_DOMAIN: &[u8] = b"vibe.market-data.replay-market-facts-outbox-custody.v2\0";
const DIGEST_BYTES: usize = 32;
const RECEIPT_CANONICAL_BYTES: usize = 2 + 4 * DIGEST_BYTES;
const REQUIRED_DEPENDENCY_COUNT: usize = 7;
const RESOLVE_COMPOSITION_BINDING_SOURCE_V1: &str = " SELECT b.binding_identity,b.binding_digest,b.receipt_identity,b.record_bytes,r.receipt_bytes,o.outbox_identity,o.binding_identity,o.receipt_identity,o.payload_bytes FROM market_data_private.replay_composition_bindings_v1 AS b JOIN market_data_private.replay_composition_binding_receipts_v1 AS r ON r.binding_identity=b.binding_identity JOIN market_data_private.replay_composition_binding_outbox_v1 AS o ON o.binding_identity=b.binding_identity WHERE b.binding_identity=p_binding_identity ";
const RESOLVE_BOUND_REPLAY_FACTS_SOURCE_V1: &str = " SELECT f.facts_identity,f.meaning_identity,f.composition_binding_identity,f.request_identity,f.request_digest,f.frontier_identity,f.receipt_identity,f.universe_selection_identity,f.universe_selection_digest,f.joined_cut_identity,f.joined_cut_digest,f.sample_projection_identity,f.sample_projection_digest,f.facts_bytes,f.frontier_bytes,r.receipt_bytes,f.custody_digest,f.append_sequence,r.facts_identity,r.meaning_identity,r.append_sequence,r.manifest_digest,r.custody_digest,o.outbox_identity,o.facts_identity,o.receipt_identity,o.payload_digest,o.payload_bytes,o.append_sequence,o.manifest_digest,o.custody_digest,s.store_generation_identity,s.append_sequence,(SELECT COUNT(*) FROM market_data_private.replay_market_facts_v2),(SELECT COUNT(*) FROM market_data_private.replay_market_facts_receipts_v2),(SELECT COUNT(*) FROM market_data_private.replay_market_facts_outbox_v2),(SELECT COALESCE(MAX(append_sequence),0) FROM market_data_private.replay_market_facts_v2),(SELECT COALESCE(MAX(append_sequence),0) FROM market_data_private.replay_market_facts_receipts_v2),(SELECT COALESCE(MAX(append_sequence),0) FROM market_data_private.replay_market_facts_outbox_v2) FROM market_data_private.replay_market_facts_v2 AS f JOIN market_data_private.replay_market_facts_receipts_v2 AS r ON r.facts_identity=f.facts_identity JOIN market_data_private.replay_market_facts_outbox_v2 AS o ON o.facts_identity=f.facts_identity CROSS JOIN market_data_private.replay_market_facts_state_v2 AS s WHERE s.singleton AND f.meaning_identity=p_meaning_identity ";

pub(crate) const REPLAY_MARKET_FACTS_SCHEMA_V2: [&str; 20] = [
    "CREATE TABLE IF NOT EXISTS market_data_private.replay_market_facts_state_v2 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), store_generation_identity BYTEA NOT NULL CHECK (octet_length(store_generation_identity)=32), append_sequence BIGINT NOT NULL CHECK (append_sequence>=0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.replay_market_facts_v2 (facts_identity BYTEA PRIMARY KEY CHECK (octet_length(facts_identity)=32), meaning_identity BYTEA UNIQUE NOT NULL CHECK (octet_length(meaning_identity)=32), composition_binding_identity BYTEA NULL CHECK (composition_binding_identity IS NULL OR octet_length(composition_binding_identity)=32), request_identity BYTEA NOT NULL CHECK (octet_length(request_identity)=32), request_digest BYTEA NOT NULL CHECK (octet_length(request_digest)=32), frontier_identity BYTEA NOT NULL CHECK (octet_length(frontier_identity)=32), receipt_identity BYTEA UNIQUE NOT NULL CHECK (octet_length(receipt_identity)=32), universe_selection_identity BYTEA NOT NULL CHECK (octet_length(universe_selection_identity)=32), universe_selection_digest BYTEA NOT NULL CHECK (octet_length(universe_selection_digest)=32), joined_cut_identity BYTEA NOT NULL CHECK (octet_length(joined_cut_identity)=32), joined_cut_digest BYTEA NOT NULL CHECK (octet_length(joined_cut_digest)=32), sample_projection_identity BYTEA NOT NULL CHECK (octet_length(sample_projection_identity)=32), sample_projection_digest BYTEA NOT NULL CHECK (octet_length(sample_projection_digest)=32), facts_bytes BYTEA NOT NULL CHECK (octet_length(facts_bytes)>0 AND octet_length(facts_bytes)<=33554432), frontier_bytes BYTEA NOT NULL CHECK (octet_length(frontier_bytes)>0 AND octet_length(frontier_bytes)<=65536), append_sequence BIGINT UNIQUE NOT NULL CHECK (append_sequence>0), custody_digest BYTEA NOT NULL CHECK (octet_length(custody_digest)=32))",
    "ALTER TABLE market_data_private.replay_market_facts_v2 ADD COLUMN IF NOT EXISTS composition_binding_identity BYTEA NULL CHECK (composition_binding_identity IS NULL OR octet_length(composition_binding_identity)=32)",
    "CREATE UNIQUE INDEX IF NOT EXISTS replay_market_facts_binding_v1 ON market_data_private.replay_market_facts_v2(composition_binding_identity) WHERE composition_binding_identity IS NOT NULL",
    "CREATE TABLE IF NOT EXISTS market_data_private.replay_market_facts_receipts_v2 (receipt_identity BYTEA PRIMARY KEY CHECK (octet_length(receipt_identity)=32), facts_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.replay_market_facts_v2(facts_identity), meaning_identity BYTEA UNIQUE NOT NULL CHECK (octet_length(meaning_identity)=32), receipt_bytes BYTEA NOT NULL CHECK (octet_length(receipt_bytes)=130), append_sequence BIGINT UNIQUE NOT NULL CHECK (append_sequence>0), manifest_digest BYTEA NOT NULL CHECK (octet_length(manifest_digest)=32), custody_digest BYTEA NOT NULL CHECK (octet_length(custody_digest)=32))",
    "CREATE TABLE IF NOT EXISTS market_data_private.replay_market_facts_outbox_v2 (outbox_identity BYTEA PRIMARY KEY CHECK (octet_length(outbox_identity)=32), facts_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.replay_market_facts_v2(facts_identity), receipt_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.replay_market_facts_receipts_v2(receipt_identity), payload_digest BYTEA NOT NULL CHECK (octet_length(payload_digest)=32), payload_bytes BYTEA NOT NULL CHECK (octet_length(payload_bytes)=130), append_sequence BIGINT UNIQUE NOT NULL CHECK (append_sequence>0), manifest_digest BYTEA NOT NULL CHECK (octet_length(manifest_digest)=32), custody_digest BYTEA NOT NULL CHECK (octet_length(custody_digest)=32))",
    "CREATE TABLE IF NOT EXISTS market_data_private.replay_composition_bindings_v1 (binding_identity BYTEA PRIMARY KEY CHECK (octet_length(binding_identity)=32), binding_digest BYTEA UNIQUE NOT NULL CHECK (octet_length(binding_digest)=32), receipt_identity BYTEA UNIQUE NOT NULL CHECK (octet_length(receipt_identity)=32), record_bytes BYTEA NOT NULL CHECK (octet_length(record_bytes)>0 AND octet_length(record_bytes)<=1048576))",
    "CREATE TABLE IF NOT EXISTS market_data_private.replay_composition_binding_receipts_v1 (receipt_identity BYTEA PRIMARY KEY CHECK (octet_length(receipt_identity)=32), binding_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.replay_composition_bindings_v1(binding_identity) ON DELETE RESTRICT, receipt_bytes BYTEA NOT NULL CHECK (octet_length(receipt_bytes)=98))",
    "CREATE TABLE IF NOT EXISTS market_data_private.replay_composition_binding_outbox_v1 (outbox_identity BYTEA PRIMARY KEY CHECK (octet_length(outbox_identity)=32), binding_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.replay_composition_bindings_v1(binding_identity) ON DELETE RESTRICT, receipt_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.replay_composition_binding_receipts_v1(receipt_identity) ON DELETE RESTRICT, payload_bytes BYTEA NOT NULL CHECK (octet_length(payload_bytes)=98))",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_replay_composition_binding_v1(p_binding_identity BYTEA) RETURNS TABLE(binding_identity BYTEA,binding_digest BYTEA,receipt_identity BYTEA,record_bytes BYTEA,receipt_bytes BYTEA,outbox_identity BYTEA,outbox_binding_identity BYTEA,outbox_receipt_identity BYTEA,outbox_bytes BYTEA) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT b.binding_identity,b.binding_digest,b.receipt_identity,b.record_bytes,r.receipt_bytes,o.outbox_identity,o.binding_identity,o.receipt_identity,o.payload_bytes FROM market_data_private.replay_composition_bindings_v1 AS b JOIN market_data_private.replay_composition_binding_receipts_v1 AS r ON r.binding_identity=b.binding_identity JOIN market_data_private.replay_composition_binding_outbox_v1 AS o ON o.binding_identity=b.binding_identity WHERE b.binding_identity=p_binding_identity $function$",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_replay_market_facts_bound_storage_v1(p_meaning_identity BYTEA) RETURNS TABLE(facts_identity BYTEA,meaning_identity BYTEA,composition_binding_identity BYTEA,request_identity BYTEA,request_digest BYTEA,frontier_identity BYTEA,receipt_identity BYTEA,universe_selection_identity BYTEA,universe_selection_digest BYTEA,joined_cut_identity BYTEA,joined_cut_digest BYTEA,sample_projection_identity BYTEA,sample_projection_digest BYTEA,facts_bytes BYTEA,frontier_bytes BYTEA,receipt_bytes BYTEA,custody_digest BYTEA,append_sequence BIGINT,receipt_facts_identity BYTEA,receipt_meaning_identity BYTEA,receipt_append_sequence BIGINT,receipt_manifest_digest BYTEA,receipt_custody_digest BYTEA,outbox_identity BYTEA,outbox_facts_identity BYTEA,outbox_receipt_identity BYTEA,outbox_payload_digest BYTEA,outbox_payload_bytes BYTEA,outbox_append_sequence BIGINT,outbox_manifest_digest BYTEA,outbox_custody_digest BYTEA,store_generation_identity BYTEA,state_append_sequence BIGINT,fact_count BIGINT,receipt_count BIGINT,outbox_count BIGINT,fact_max_sequence BIGINT,receipt_max_sequence BIGINT,outbox_max_sequence BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT f.facts_identity,f.meaning_identity,f.composition_binding_identity,f.request_identity,f.request_digest,f.frontier_identity,f.receipt_identity,f.universe_selection_identity,f.universe_selection_digest,f.joined_cut_identity,f.joined_cut_digest,f.sample_projection_identity,f.sample_projection_digest,f.facts_bytes,f.frontier_bytes,r.receipt_bytes,f.custody_digest,f.append_sequence,r.facts_identity,r.meaning_identity,r.append_sequence,r.manifest_digest,r.custody_digest,o.outbox_identity,o.facts_identity,o.receipt_identity,o.payload_digest,o.payload_bytes,o.append_sequence,o.manifest_digest,o.custody_digest,s.store_generation_identity,s.append_sequence,(SELECT COUNT(*) FROM market_data_private.replay_market_facts_v2),(SELECT COUNT(*) FROM market_data_private.replay_market_facts_receipts_v2),(SELECT COUNT(*) FROM market_data_private.replay_market_facts_outbox_v2),(SELECT COALESCE(MAX(append_sequence),0) FROM market_data_private.replay_market_facts_v2),(SELECT COALESCE(MAX(append_sequence),0) FROM market_data_private.replay_market_facts_receipts_v2),(SELECT COALESCE(MAX(append_sequence),0) FROM market_data_private.replay_market_facts_outbox_v2) FROM market_data_private.replay_market_facts_v2 AS f JOIN market_data_private.replay_market_facts_receipts_v2 AS r ON r.facts_identity=f.facts_identity JOIN market_data_private.replay_market_facts_outbox_v2 AS o ON o.facts_identity=f.facts_identity CROSS JOIN market_data_private.replay_market_facts_state_v2 AS s WHERE s.singleton AND f.meaning_identity=p_meaning_identity $function$",
    "REVOKE ALL ON TABLE market_data_private.replay_market_facts_v2 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.replay_market_facts_receipts_v2 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.replay_market_facts_outbox_v2 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.replay_market_facts_state_v2 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.replay_composition_bindings_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.replay_composition_binding_receipts_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.replay_composition_binding_outbox_v1 FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_replay_composition_binding_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_replay_market_facts_bound_storage_v1(BYTEA) FROM PUBLIC",
];

const INSERT_REPLAY_MARKET_FACTS_V2: &str = "INSERT INTO market_data_private.replay_market_facts_v2(facts_identity,meaning_identity,composition_binding_identity,request_identity,request_digest,frontier_identity,receipt_identity,universe_selection_identity,universe_selection_digest,joined_cut_identity,joined_cut_digest,sample_projection_identity,sample_projection_digest,facts_bytes,frontier_bytes,append_sequence,custody_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)";
const INSERT_REPLAY_MARKET_FACTS_RECEIPT_V2: &str = "INSERT INTO market_data_private.replay_market_facts_receipts_v2(receipt_identity,facts_identity,meaning_identity,receipt_bytes,append_sequence,manifest_digest,custody_digest) VALUES($1,$2,$3,$4,$5,$6,$7)";
const INSERT_REPLAY_MARKET_FACTS_OUTBOX_V2: &str = "INSERT INTO market_data_private.replay_market_facts_outbox_v2(outbox_identity,facts_identity,receipt_identity,payload_digest,payload_bytes,append_sequence,manifest_digest,custody_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)";
const LOAD_REPLAY_MARKET_FACTS_BY_MEANING_V2: &str =
    "SELECT * FROM market_data_private.resolve_replay_market_facts_bound_storage_v1($1)";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct OpaqueDependencyLocatorV2 {
    pub(super) identity: [u8; DIGEST_BYTES],
    pub(super) digest: [u8; DIGEST_BYTES],
}

impl OpaqueDependencyLocatorV2 {
    fn from_dependency(dependency: super::ReplayMarketDependencyRefV2) -> Self {
        Self {
            identity: *dependency.identity().as_bytes(),
            digest: *dependency.digest().as_bytes(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreparedReplayMarketFactsStorageV2 {
    row: StoredReplayMarketFactsRowV2,
}

impl PreparedReplayMarketFactsStorageV2 {
    pub(crate) fn from_verified_readback(
        readback: &ReplayMarketFactsReadbackV2,
        binding: &ReplayCompositionBindingReadbackV1,
    ) -> Result<Self, ReplayMarketFactsPostgresErrorV2> {
        if !verify_replay_market_facts_readback_v2(readback)
            || !verify_replay_composition_binding_v1(binding)
        {
            return Err(ReplayMarketFactsPostgresErrorV2::InvalidPrepared);
        }
        let facts = readback.facts();
        let receipt = readback.receipt();
        let dependencies = facts.frontier().dependencies();
        if dependencies.len() != REQUIRED_DEPENDENCY_COUNT {
            return Err(ReplayMarketFactsPostgresErrorV2::InvalidPrepared);
        }
        let universe_selection = OpaqueDependencyLocatorV2::from_dependency(dependencies[3]);
        let joined_cut = OpaqueDependencyLocatorV2::from_dependency(dependencies[5]);
        let sample_projection = OpaqueDependencyLocatorV2::from_dependency(dependencies[6]);
        let composition_binding_identity = *binding.record().identity().as_bytes();
        let meaning_identity = bound_meaning_identity(
            *facts.request_identity().as_bytes(),
            *facts.request_digest().as_bytes(),
            *facts.pit_snapshot_identity().as_bytes(),
            facts.replay_start_event_ns(),
            facts.replay_end_event_ns_exclusive(),
            composition_binding_identity,
        );
        let mut row = StoredReplayMarketFactsRowV2 {
            facts_identity: *facts.identity().as_bytes(),
            meaning_identity,
            composition_binding_identity: Some(composition_binding_identity),
            request_identity: *facts.request_identity().as_bytes(),
            request_digest: *facts.request_digest().as_bytes(),
            pit_snapshot_identity: *facts.pit_snapshot_identity().as_bytes(),
            replay_start_event_ns: facts.replay_start_event_ns(),
            replay_end_event_ns_exclusive: facts.replay_end_event_ns_exclusive(),
            frontier_identity: *facts.frontier().identity().as_bytes(),
            receipt_identity: *receipt.identity().as_bytes(),
            universe_selection,
            joined_cut,
            sample_projection,
            facts_bytes: facts.canonical_bytes().to_vec(),
            frontier_bytes: facts.frontier().canonical_bytes().to_vec(),
            receipt_bytes: receipt.canonical_bytes().to_vec(),
            custody_digest: [0; DIGEST_BYTES],
        };
        row.custody_digest = storage_digest(&row);
        validate_stored_row(&row).map_err(|_| ReplayMarketFactsPostgresErrorV2::InvalidPrepared)?;
        Ok(Self { row })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct StoredReplayMarketFactsRowV2 {
    pub(super) facts_identity: [u8; DIGEST_BYTES],
    pub(super) meaning_identity: [u8; DIGEST_BYTES],
    pub(super) composition_binding_identity: Option<[u8; DIGEST_BYTES]>,
    pub(super) request_identity: [u8; DIGEST_BYTES],
    pub(super) request_digest: [u8; DIGEST_BYTES],
    pub(super) pit_snapshot_identity: [u8; DIGEST_BYTES],
    pub(super) replay_start_event_ns: i128,
    pub(super) replay_end_event_ns_exclusive: i128,
    pub(super) frontier_identity: [u8; DIGEST_BYTES],
    pub(super) receipt_identity: [u8; DIGEST_BYTES],
    pub(super) universe_selection: OpaqueDependencyLocatorV2,
    pub(super) joined_cut: OpaqueDependencyLocatorV2,
    pub(super) sample_projection: OpaqueDependencyLocatorV2,
    pub(super) facts_bytes: Vec<u8>,
    pub(super) frontier_bytes: Vec<u8>,
    pub(super) receipt_bytes: Vec<u8>,
    pub(super) custody_digest: [u8; DIGEST_BYTES],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ReplayMarketFactsStorageManifestV2 {
    pub(super) store_generation_identity: [u8; DIGEST_BYTES],
    pub(super) append_sequence: u64,
    pub(super) receipt_facts_identity: [u8; DIGEST_BYTES],
    pub(super) receipt_meaning_identity: [u8; DIGEST_BYTES],
    pub(super) receipt_append_sequence: u64,
    pub(super) receipt_manifest_digest: [u8; DIGEST_BYTES],
    pub(super) receipt_custody_digest: [u8; DIGEST_BYTES],
    pub(super) outbox_identity: [u8; DIGEST_BYTES],
    pub(super) outbox_facts_identity: [u8; DIGEST_BYTES],
    pub(super) outbox_receipt_identity: [u8; DIGEST_BYTES],
    pub(super) outbox_payload_digest: [u8; DIGEST_BYTES],
    pub(super) outbox_payload_bytes: Vec<u8>,
    pub(super) outbox_append_sequence: u64,
    pub(super) outbox_manifest_digest: [u8; DIGEST_BYTES],
    pub(super) outbox_custody_digest: [u8; DIGEST_BYTES],
    pub(super) state_append_sequence: u64,
    pub(super) fact_count: u64,
    pub(super) receipt_count: u64,
    pub(super) outbox_count: u64,
    pub(super) fact_max_sequence: u64,
    pub(super) receipt_max_sequence: u64,
    pub(super) outbox_max_sequence: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct DurableReplayMarketFactsStorageV2 {
    row: StoredReplayMarketFactsRowV2,
    manifest: ReplayMarketFactsStorageManifestV2,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub(crate) enum ReplayMarketFactsPostgresErrorV2 {
    #[error("prepared replay facts are invalid")]
    InvalidPrepared,
    #[error("replay facts identity collides with different content")]
    IdentityConflict,
    #[error("replay request meaning collides with different facts")]
    MeaningConflict,
    #[error("stored replay facts are unknown")]
    UnknownRecord,
    #[error("stored replay facts are corrupt or cross-spliced")]
    CorruptRecord,
    #[error("durable Universe Selection authority is unavailable")]
    UniverseSelectionUnavailable,
    #[error("durable JoinedCut authority is unavailable")]
    JoinedCutUnavailable,
    #[error("durable SampleProjection authority is unavailable")]
    SampleProjectionUnavailable,
    #[error("replay facts storage is unavailable")]
    StoreUnavailable,
    #[error("composition binding is unknown")]
    BindingUnavailable,
    #[error("composition binding custody is corrupt or conflicts")]
    BindingConflict,
}

pub(crate) async fn verify_replay_market_facts_read_contract_v2(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), ReplayMarketFactsPostgresErrorV2> {
    let exact: bool = sqlx::query_scalar(
        "SELECT current_user='market_data_owner'
            AND pg_catalog.pg_get_userbyid(namespace.nspowner)=current_user
            AND pg_catalog.has_schema_privilege(current_user,namespace.oid,'USAGE,CREATE')
            AND NOT EXISTS (
                SELECT 1 FROM pg_catalog.aclexplode(COALESCE(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))) privilege
                 WHERE privilege.grantee<>namespace.nspowner)
            AND (SELECT count(*)=7
                   AND count(*) FILTER (WHERE pg_catalog.pg_get_userbyid(relation.relowner)=current_user)=7
                   AND count(*) FILTER (WHERE relation.relkind='r' AND relation.relpersistence='p')=7
                   AND count(*) FILTER (WHERE NOT relation.relrowsecurity AND NOT relation.relforcerowsecurity)=7
                   AND NOT EXISTS (
                       SELECT 1 FROM pg_catalog.pg_class relation_acl
                       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation_acl.relacl,pg_catalog.acldefault('r',relation_acl.relowner))) privilege
                        WHERE relation_acl.oid=ANY(ARRAY[
                          pg_catalog.to_regclass('market_data_private.replay_market_facts_v2'),
                          pg_catalog.to_regclass('market_data_private.replay_market_facts_receipts_v2'),
                          pg_catalog.to_regclass('market_data_private.replay_market_facts_outbox_v2'),
                          pg_catalog.to_regclass('market_data_private.replay_market_facts_state_v2'),
                          pg_catalog.to_regclass('market_data_private.replay_composition_bindings_v1'),
                          pg_catalog.to_regclass('market_data_private.replay_composition_binding_receipts_v1'),
                          pg_catalog.to_regclass('market_data_private.replay_composition_binding_outbox_v1')
                        ]) AND privilege.grantee<>relation_acl.relowner)
                   AND NOT EXISTS (
                       SELECT 1 FROM pg_catalog.pg_attribute attribute
                        WHERE attribute.attrelid=ANY(ARRAY[
                          pg_catalog.to_regclass('market_data_private.replay_market_facts_v2'),
                          pg_catalog.to_regclass('market_data_private.replay_market_facts_receipts_v2'),
                          pg_catalog.to_regclass('market_data_private.replay_market_facts_outbox_v2'),
                          pg_catalog.to_regclass('market_data_private.replay_market_facts_state_v2'),
                          pg_catalog.to_regclass('market_data_private.replay_composition_bindings_v1'),
                          pg_catalog.to_regclass('market_data_private.replay_composition_binding_receipts_v1'),
                          pg_catalog.to_regclass('market_data_private.replay_composition_binding_outbox_v1')
                        ]) AND attribute.attnum>0 AND NOT attribute.attisdropped AND attribute.attacl IS NOT NULL)
                  FROM pg_catalog.pg_class relation
                 WHERE relation.oid=ANY(ARRAY[
                   pg_catalog.to_regclass('market_data_private.replay_market_facts_v2'),
                   pg_catalog.to_regclass('market_data_private.replay_market_facts_receipts_v2'),
                   pg_catalog.to_regclass('market_data_private.replay_market_facts_outbox_v2'),
                   pg_catalog.to_regclass('market_data_private.replay_market_facts_state_v2'),
                   pg_catalog.to_regclass('market_data_private.replay_composition_bindings_v1'),
                   pg_catalog.to_regclass('market_data_private.replay_composition_binding_receipts_v1'),
                   pg_catalog.to_regclass('market_data_private.replay_composition_binding_outbox_v1')
                 ]))
            AND (SELECT count(*)=2
                   AND count(*) FILTER (WHERE pg_catalog.pg_get_userbyid(procedure.proowner)=current_user)=2
                   AND count(*) FILTER (WHERE language.lanname='sql' AND procedure.prokind='f' AND procedure.proretset AND procedure.prosecdef AND NOT procedure.proisstrict AND procedure.provolatile='s' AND procedure.proparallel='u' AND procedure.proconfig=ARRAY['search_path=pg_catalog']::text[] AND procedure.prosrc=ANY(ARRAY[$1,$2]))=2
                   AND NOT EXISTS (
                       SELECT 1 FROM pg_catalog.pg_proc function_acl
                       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(function_acl.proacl,pg_catalog.acldefault('f',function_acl.proowner))) privilege
                        WHERE function_acl.oid=ANY(ARRAY[
                          pg_catalog.to_regprocedure('market_data_private.resolve_replay_composition_binding_v1(bytea)'),
                          pg_catalog.to_regprocedure('market_data_private.resolve_replay_market_facts_bound_storage_v1(bytea)')
                        ]) AND privilege.grantee<>function_acl.proowner)
                  FROM pg_catalog.pg_proc procedure
                  JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang
                 WHERE procedure.oid=ANY(ARRAY[
                   pg_catalog.to_regprocedure('market_data_private.resolve_replay_composition_binding_v1(bytea)'),
                   pg_catalog.to_regprocedure('market_data_private.resolve_replay_market_facts_bound_storage_v1(bytea)')
                 ]))
           FROM pg_catalog.pg_namespace namespace
          WHERE namespace.nspname='market_data_private'",
    )
    .bind(RESOLVE_COMPOSITION_BINDING_SOURCE_V1)
    .bind(RESOLVE_BOUND_REPLAY_FACTS_SOURCE_V1)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;
    let topology_exact: bool = sqlx::query_scalar(
        "WITH expected(relation_name,constraint_kind,key_columns,foreign_relation,foreign_columns,delete_action) AS (VALUES
            ('replay_market_facts_state_v2','p','singleton','','',' '),
            ('replay_market_facts_v2','p','facts_identity','','',' '),
            ('replay_market_facts_v2','u','meaning_identity','','',' '),
            ('replay_market_facts_v2','u','receipt_identity','','',' '),
            ('replay_market_facts_v2','u','append_sequence','','',' '),
            ('replay_market_facts_receipts_v2','p','receipt_identity','','',' '),
            ('replay_market_facts_receipts_v2','u','facts_identity','','',' '),
            ('replay_market_facts_receipts_v2','u','meaning_identity','','',' '),
            ('replay_market_facts_receipts_v2','u','append_sequence','','',' '),
            ('replay_market_facts_receipts_v2','f','facts_identity','replay_market_facts_v2','facts_identity','a'),
            ('replay_market_facts_outbox_v2','p','outbox_identity','','',' '),
            ('replay_market_facts_outbox_v2','u','facts_identity','','',' '),
            ('replay_market_facts_outbox_v2','u','receipt_identity','','',' '),
            ('replay_market_facts_outbox_v2','u','append_sequence','','',' '),
            ('replay_market_facts_outbox_v2','f','facts_identity','replay_market_facts_v2','facts_identity','a'),
            ('replay_market_facts_outbox_v2','f','receipt_identity','replay_market_facts_receipts_v2','receipt_identity','a'),
            ('replay_composition_bindings_v1','p','binding_identity','','',' '),
            ('replay_composition_bindings_v1','u','binding_digest','','',' '),
            ('replay_composition_bindings_v1','u','receipt_identity','','',' '),
            ('replay_composition_binding_receipts_v1','p','receipt_identity','','',' '),
            ('replay_composition_binding_receipts_v1','u','binding_identity','','',' '),
            ('replay_composition_binding_receipts_v1','f','binding_identity','replay_composition_bindings_v1','binding_identity','r'),
            ('replay_composition_binding_outbox_v1','p','outbox_identity','','',' '),
            ('replay_composition_binding_outbox_v1','u','binding_identity','','',' '),
            ('replay_composition_binding_outbox_v1','u','receipt_identity','','',' '),
            ('replay_composition_binding_outbox_v1','f','binding_identity','replay_composition_bindings_v1','binding_identity','r'),
            ('replay_composition_binding_outbox_v1','f','receipt_identity','replay_composition_binding_receipts_v1','receipt_identity','r')
        ), observed AS (
          SELECT relation.relname::text AS relation_name,
                 constraint_fact.contype::text AS constraint_kind,
                 pg_catalog.array_to_string(ARRAY(
                   SELECT attribute.attname
                     FROM pg_catalog.unnest(constraint_fact.conkey) WITH ORDINALITY key(attnum,ordinality)
                     JOIN pg_catalog.pg_attribute attribute
                       ON attribute.attrelid=constraint_fact.conrelid AND attribute.attnum=key.attnum
                    ORDER BY key.ordinality),' ') AS key_columns,
                 COALESCE(foreign_relation.relname,'')::text AS foreign_relation,
                 COALESCE(pg_catalog.array_to_string(ARRAY(
                   SELECT attribute.attname
                     FROM pg_catalog.unnest(constraint_fact.confkey) WITH ORDINALITY key(attnum,ordinality)
                     JOIN pg_catalog.pg_attribute attribute
                       ON attribute.attrelid=constraint_fact.confrelid AND attribute.attnum=key.attnum
                    ORDER BY key.ordinality),' '),'') AS foreign_columns,
                 CASE WHEN constraint_fact.contype='f' THEN constraint_fact.confdeltype::text ELSE ' ' END AS delete_action,
                 constraint_fact.condeferrable,constraint_fact.condeferred,constraint_fact.convalidated,
                 constraint_fact.conislocal,constraint_fact.coninhcount,
                 constraint_fact.contype<>'f'
                   OR constraint_fact.confrelid=pg_catalog.to_regclass(
                       pg_catalog.format('market_data_private.%I',foreign_relation.relname)) AS foreign_relation_oid_exact
            FROM pg_catalog.pg_constraint constraint_fact
            JOIN pg_catalog.pg_class relation ON relation.oid=constraint_fact.conrelid
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
            LEFT JOIN pg_catalog.pg_class foreign_relation ON foreign_relation.oid=constraint_fact.confrelid
           WHERE namespace.nspname='market_data_private'
             AND relation.relname IN (
               'replay_market_facts_state_v2','replay_market_facts_v2',
               'replay_market_facts_receipts_v2','replay_market_facts_outbox_v2',
               'replay_composition_bindings_v1','replay_composition_binding_receipts_v1',
               'replay_composition_binding_outbox_v1')
             AND constraint_fact.contype IN ('p','u','f')
        )
        SELECT (SELECT count(*) FROM observed)=27
          AND NOT EXISTS (SELECT relation_name,constraint_kind,key_columns,foreign_relation,foreign_columns,delete_action FROM expected EXCEPT ALL SELECT relation_name,constraint_kind,key_columns,foreign_relation,foreign_columns,delete_action FROM observed)
          AND NOT EXISTS (SELECT relation_name,constraint_kind,key_columns,foreign_relation,foreign_columns,delete_action FROM observed EXCEPT ALL SELECT relation_name,constraint_kind,key_columns,foreign_relation,foreign_columns,delete_action FROM expected)
          AND NOT EXISTS (SELECT 1 FROM observed WHERE condeferrable OR condeferred OR NOT convalidated OR NOT conislocal OR coninhcount<>0)
          AND NOT EXISTS (SELECT 1 FROM observed WHERE NOT foreign_relation_oid_exact)
          AND (SELECT count(*)=1
                 AND bool_and(index_fact.indisunique AND index_fact.indisvalid AND index_fact.indisready
                              AND NOT index_fact.indisprimary AND NOT index_fact.indisexclusion
                              AND index_fact.indrelid=pg_catalog.to_regclass('market_data_private.replay_market_facts_v2')
                              AND pg_catalog.pg_get_expr(index_fact.indpred,index_fact.indrelid)='(composition_binding_identity IS NOT NULL)'
                              AND pg_catalog.array_to_string(ARRAY(
                                  SELECT attribute.attname
                                    FROM pg_catalog.unnest(index_fact.indkey::smallint[]) WITH ORDINALITY key(attnum,ordinality)
                                    JOIN pg_catalog.pg_attribute attribute
                                      ON attribute.attrelid=index_fact.indrelid AND attribute.attnum=key.attnum
                                   ORDER BY key.ordinality),' ')='composition_binding_identity')
                 FROM pg_catalog.pg_index index_fact
                 JOIN pg_catalog.pg_class index_relation ON index_relation.oid=index_fact.indexrelid
                WHERE index_relation.relnamespace=pg_catalog.to_regnamespace('market_data_private')
                  AND index_relation.relname='replay_market_facts_binding_v1')",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;
    (exact && topology_exact)
        .then_some(())
        .ok_or(ReplayMarketFactsPostgresErrorV2::StoreUnavailable)
}

pub(crate) async fn persist_replay_composition_binding_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    binding: &ReplayCompositionBindingReadbackV1,
) -> Result<(), ReplayMarketFactsPostgresErrorV2> {
    if !verify_replay_composition_binding_v1(binding) {
        return Err(ReplayMarketFactsPostgresErrorV2::InvalidPrepared);
    }
    let locator = binding.record().locator();
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(advisory_key(*locator.binding_identity().as_bytes()))
        .execute(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;

    if let Ok(existing) =
        recover_replay_composition_binding_in_transaction_v1(transaction, locator).await
    {
        return if existing == *binding {
            Ok(())
        } else {
            Err(ReplayMarketFactsPostgresErrorV2::BindingConflict)
        };
    }
    let receipt_identity = binding.receipt().identity();
    sqlx::query("INSERT INTO market_data_private.replay_composition_bindings_v1(binding_identity,binding_digest,receipt_identity,record_bytes) VALUES($1,$2,$3,$4)")
        .bind(locator.binding_identity().as_bytes().as_slice())
        .bind(locator.binding_digest().as_bytes().as_slice())
        .bind(receipt_identity.as_bytes().as_slice())
        .bind(binding.record().canonical_bytes())
        .execute(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::BindingConflict)?;
    sqlx::query("INSERT INTO market_data_private.replay_composition_binding_receipts_v1(receipt_identity,binding_identity,receipt_bytes) VALUES($1,$2,$3)")
        .bind(receipt_identity.as_bytes().as_slice())
        .bind(locator.binding_identity().as_bytes().as_slice())
        .bind(binding.receipt().canonical_bytes())
        .execute(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::BindingConflict)?;
    sqlx::query("INSERT INTO market_data_private.replay_composition_binding_outbox_v1(outbox_identity,binding_identity,receipt_identity,payload_bytes) VALUES($1,$2,$3,$4)")
        .bind(binding.outbox().identity().as_bytes().as_slice())
        .bind(locator.binding_identity().as_bytes().as_slice())
        .bind(receipt_identity.as_bytes().as_slice())
        .bind(binding.outbox().payload())
        .execute(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::BindingConflict)?;
    let recovered =
        recover_replay_composition_binding_in_transaction_v1(transaction, locator).await?;
    (recovered == *binding)
        .then_some(())
        .ok_or(ReplayMarketFactsPostgresErrorV2::BindingConflict)
}

pub(crate) async fn recover_replay_composition_binding_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    locator: ReplayCompositionBindingLocatorV1,
) -> Result<ReplayCompositionBindingReadbackV1, ReplayMarketFactsPostgresErrorV2> {
    let row =
        sqlx::query("SELECT * FROM market_data_private.resolve_replay_composition_binding_v1($1)")
            .bind(locator.binding_identity().as_bytes().as_slice())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?
            .ok_or(ReplayMarketFactsPostgresErrorV2::BindingUnavailable)?;
    let identity = digest_array(row_bytes(&row, "binding_identity")?)?;
    let digest = digest_array(row_bytes(&row, "binding_digest")?)?;
    let receipt_identity = digest_array(row_bytes(&row, "receipt_identity")?)?;
    let outbox_identity = digest_array(row_bytes(&row, "outbox_identity")?)?;
    let outbox_binding_identity = digest_array(row_bytes(&row, "outbox_binding_identity")?)?;
    let outbox_receipt_identity = digest_array(row_bytes(&row, "outbox_receipt_identity")?)?;

    if identity != *locator.binding_identity().as_bytes()
        || digest != *locator.binding_digest().as_bytes()
        || outbox_binding_identity != identity
        || outbox_identity != receipt_identity
        || outbox_receipt_identity != receipt_identity
    {
        return Err(ReplayMarketFactsPostgresErrorV2::BindingConflict);
    }
    let record_bytes = row_bytes(&row, "record_bytes")?;
    let receipt_bytes = row_bytes(&row, "receipt_bytes")?;
    let outbox_bytes = row_bytes(&row, "outbox_bytes")?;
    let readback =
        decode_replay_composition_binding_v1(&record_bytes, &receipt_bytes, &outbox_bytes)
            .map_err(|_| ReplayMarketFactsPostgresErrorV2::BindingConflict)?;

    if readback.record().locator() != locator
        || *readback.receipt().identity().as_bytes() != receipt_identity
        || readback.record().canonical_bytes() != record_bytes
        || readback.receipt().canonical_bytes() != receipt_bytes
        || readback.outbox().payload() != outbox_bytes
    {
        return Err(ReplayMarketFactsPostgresErrorV2::BindingConflict);
    }
    Ok(readback)
}

/// Persists an already-issued opaque record inside the caller's Owner transaction.
///
/// This function neither begins nor commits a transaction and never promotes storage bytes into a
/// positive readback.
pub(crate) async fn persist_replay_market_facts_in_transaction_v2(
    transaction: &mut Transaction<'_, Postgres>,
    prepared: &PreparedReplayMarketFactsStorageV2,
) -> Result<(), ReplayMarketFactsPostgresErrorV2> {
    validate_stored_row(&prepared.row)
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::InvalidPrepared)?;
    lock_identities(transaction, &prepared.row).await?;

    if let Some(existing) = load_by_identity(transaction, prepared.row.facts_identity).await? {
        return classify_existing(&existing.row, &prepared.row);
    }

    if let Some(existing) = load_by_meaning(transaction, prepared.row.meaning_identity).await? {
        return classify_existing(&existing.row, &prepared.row);
    }

    if let Some(existing) = load_by_receipt(transaction, prepared.row.receipt_identity).await? {
        return classify_existing(&existing.row, &prepared.row);
    }

    if any_storage_fragment_exists(transaction, &prepared.row).await? {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }

    let row = &prepared.row;
    let database_name: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;
    let generation = store_generation_identity(&database_name);
    sqlx::query("INSERT INTO market_data_private.replay_market_facts_state_v2(singleton,store_generation_identity,append_sequence) VALUES(TRUE,$1,0) ON CONFLICT(singleton) DO NOTHING")
        .bind(generation.as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;
    let prior_state = sqlx::query("SELECT store_generation_identity,append_sequence,(SELECT COUNT(*) FROM market_data_private.replay_market_facts_v2) AS fact_count,(SELECT COUNT(*) FROM market_data_private.replay_market_facts_receipts_v2) AS receipt_count,(SELECT COUNT(*) FROM market_data_private.replay_market_facts_outbox_v2) AS outbox_count,(SELECT COALESCE(MAX(append_sequence),0) FROM market_data_private.replay_market_facts_v2) AS fact_max_sequence,(SELECT COALESCE(MAX(append_sequence),0) FROM market_data_private.replay_market_facts_receipts_v2) AS receipt_max_sequence,(SELECT COALESCE(MAX(append_sequence),0) FROM market_data_private.replay_market_facts_outbox_v2) AS outbox_max_sequence FROM market_data_private.replay_market_facts_state_v2 WHERE singleton FOR UPDATE")
        .fetch_one(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;
    let stored_generation = digest_array(row_bytes(&prior_state, "store_generation_identity")?)?;
    let prior_sequence = row_u64(&prior_state, "append_sequence")?;
    if stored_generation != generation
        || row_u64(&prior_state, "fact_count")? != prior_sequence
        || row_u64(&prior_state, "receipt_count")? != prior_sequence
        || row_u64(&prior_state, "outbox_count")? != prior_sequence
        || row_u64(&prior_state, "fact_max_sequence")? != prior_sequence
        || row_u64(&prior_state, "receipt_max_sequence")? != prior_sequence
        || row_u64(&prior_state, "outbox_max_sequence")? != prior_sequence
    {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    let append_sequence = prior_sequence
        .checked_add(1)
        .ok_or(ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;
    let append_sequence_i64 = i64::try_from(append_sequence)
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;
    let manifest_digest = storage_manifest_digest(row, generation, append_sequence);
    let receipt_custody = receipt_custody_digest(row, manifest_digest, append_sequence);
    let outbox_payload_digest = digest_bytes(RECEIPT_DOMAIN, &row.receipt_bytes);
    let outbox_custody =
        outbox_custody_digest(row, manifest_digest, outbox_payload_digest, append_sequence);
    sqlx::query("UPDATE market_data_private.replay_market_facts_state_v2 SET append_sequence=$1 WHERE singleton AND store_generation_identity=$2 AND append_sequence=$3")
        .bind(append_sequence_i64)
        .bind(generation.as_slice())
        .bind(i64::try_from(prior_sequence).map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?)
        .execute(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;
    sqlx::query(INSERT_REPLAY_MARKET_FACTS_V2)
        .bind(row.facts_identity.as_slice())
        .bind(row.meaning_identity.as_slice())
        .bind(
            row.composition_binding_identity
                .as_ref()
                .map(<[u8; DIGEST_BYTES]>::as_slice),
        )
        .bind(row.request_identity.as_slice())
        .bind(row.request_digest.as_slice())
        .bind(row.frontier_identity.as_slice())
        .bind(row.receipt_identity.as_slice())
        .bind(row.universe_selection.identity.as_slice())
        .bind(row.universe_selection.digest.as_slice())
        .bind(row.joined_cut.identity.as_slice())
        .bind(row.joined_cut.digest.as_slice())
        .bind(row.sample_projection.identity.as_slice())
        .bind(row.sample_projection.digest.as_slice())
        .bind(&row.facts_bytes)
        .bind(&row.frontier_bytes)
        .bind(append_sequence_i64)
        .bind(row.custody_digest.as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;
    sqlx::query(INSERT_REPLAY_MARKET_FACTS_RECEIPT_V2)
        .bind(row.receipt_identity.as_slice())
        .bind(row.facts_identity.as_slice())
        .bind(row.meaning_identity.as_slice())
        .bind(&row.receipt_bytes)
        .bind(append_sequence_i64)
        .bind(manifest_digest.as_slice())
        .bind(receipt_custody.as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;
    sqlx::query(INSERT_REPLAY_MARKET_FACTS_OUTBOX_V2)
        .bind(row.receipt_identity.as_slice())
        .bind(row.facts_identity.as_slice())
        .bind(row.receipt_identity.as_slice())
        .bind(outbox_payload_digest.as_slice())
        .bind(&row.receipt_bytes)
        .bind(append_sequence_i64)
        .bind(manifest_digest.as_slice())
        .bind(outbox_custody.as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;

    let stored = if let Some(stored) = load_by_meaning(transaction, row.meaning_identity).await? {
        stored
    } else if let Some(stored) = load_by_identity(transaction, row.facts_identity).await? {
        stored
    } else {
        load_by_receipt(transaction, row.receipt_identity)
            .await?
            .ok_or(ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?
    };
    classify_existing(&stored.row, row)
}

pub(crate) struct ExactStoredReplayMarketFactsV2 {
    pub(crate) facts_identity: [u8; 32],
    pub(crate) receipt_identity: [u8; 32],
    pub(crate) facts_bytes: Vec<u8>,
    pub(crate) frontier_bytes: Vec<u8>,
    pub(crate) receipt_bytes: Vec<u8>,
}

pub(crate) async fn recover_replay_market_facts_readback_in_transaction_v2(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedReplayMarketFactsRequestV2,
) -> Result<ReplayMarketFactsReadbackV2, ReplayMarketFactsPostgresErrorV2> {
    let locator = request.pit_locator();
    let meaning = meaning_identity(
        *locator.request_identity.as_bytes(),
        *locator.request_digest.as_bytes(),
        *locator.snapshot_identity.as_bytes(),
        request.replay_start_event_ns(),
        request.replay_end_event_ns_exclusive(),
    );
    let durable = load_by_meaning(transaction, meaning)
        .await?
        .ok_or(ReplayMarketFactsPostgresErrorV2::UnknownRecord)?;
    decode_exact_readback_v2(&durable, request)
}

pub(crate) async fn recover_bound_replay_market_facts_readback_in_transaction_v2(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedReplayMarketFactsRequestV2,
    binding_identity: [u8; DIGEST_BYTES],
) -> Result<ReplayMarketFactsReadbackV2, ReplayMarketFactsPostgresErrorV2> {
    let durable =
        recover_durable_by_binding_in_transaction_v2(transaction, binding_identity).await?;
    decode_exact_readback_v2(&durable, request)
}

async fn recover_durable_by_binding_in_transaction_v2(
    transaction: &mut Transaction<'_, Postgres>,
    binding_identity: [u8; DIGEST_BYTES],
) -> Result<DurableReplayMarketFactsStorageV2, ReplayMarketFactsPostgresErrorV2> {
    let meanings: Vec<Vec<u8>> = sqlx::query_scalar("SELECT meaning_identity FROM market_data_private.replay_market_facts_v2 WHERE composition_binding_identity=$1 ORDER BY meaning_identity")
        .bind(binding_identity.as_slice())
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;
    let [meaning] = meanings.as_slice() else {
        return Err(if meanings.is_empty() {
            ReplayMarketFactsPostgresErrorV2::UnknownRecord
        } else {
            ReplayMarketFactsPostgresErrorV2::CorruptRecord
        });
    };
    load_by_meaning(transaction, digest_array(meaning.clone())?)
        .await?
        .ok_or(ReplayMarketFactsPostgresErrorV2::UnknownRecord)
}

pub(crate) async fn recover_replay_market_facts_by_binding_in_transaction_v2(
    transaction: &mut Transaction<'_, Postgres>,
    binding_identity: [u8; 32],
) -> Result<ExactStoredReplayMarketFactsV2, ReplayMarketFactsPostgresErrorV2> {
    let durable =
        recover_durable_by_binding_in_transaction_v2(transaction, binding_identity).await?;
    validate_stored_row(&durable.row)?;
    validate_storage_manifest(&durable.row, &durable.manifest)?;
    if durable.row.composition_binding_identity != Some(binding_identity)
        || durable.manifest.outbox_payload_bytes != durable.row.receipt_bytes
    {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    Ok(ExactStoredReplayMarketFactsV2 {
        facts_identity: durable.row.facts_identity,
        receipt_identity: durable.row.receipt_identity,
        facts_bytes: durable.row.facts_bytes,
        frontier_bytes: durable.row.frontier_bytes,
        receipt_bytes: durable.row.receipt_bytes,
    })
}

fn decode_exact_readback_v2(
    durable: &DurableReplayMarketFactsStorageV2,
    request: &UntrustedReplayMarketFactsRequestV2,
) -> Result<ReplayMarketFactsReadbackV2, ReplayMarketFactsPostgresErrorV2> {
    validate_stored_row(&durable.row)?;
    validate_storage_manifest(&durable.row, &durable.manifest)?;
    let row = &durable.row;
    let locator = request.pit_locator();
    if row.request_identity != *locator.request_identity.as_bytes()
        || row.request_digest != *locator.request_digest.as_bytes()
        || row.pit_snapshot_identity != *locator.snapshot_identity.as_bytes()
        || row.replay_start_event_ns != request.replay_start_event_ns()
        || row.replay_end_event_ns_exclusive != request.replay_end_event_ns_exclusive()
    {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }

    let (base_dependencies, native_chain, reference_cut_identities) =
        decode_frontier_evidence_v2(&row.frontier_bytes)?;
    let reference_cuts = decode_fact_cuts_v2(
        &row.facts_bytes,
        request,
        row.frontier_identity,
        &reference_cut_identities,
    )?;
    let stable_correlation = decode_receipt_correlation_v2(&row.receipt_bytes)?;
    let readback = issue_replay_market_facts_v2(
        request,
        ReplayMarketFactsEvidenceV2 {
            base_dependencies,
            native_chain,
            reference_cuts,
            stable_correlation,
        },
    )
    .map_err(|_| ReplayMarketFactsPostgresErrorV2::CorruptRecord)?;
    if readback.facts().identity().as_bytes() != &row.facts_identity
        || readback.receipt().identity().as_bytes() != &row.receipt_identity
        || readback.facts().canonical_bytes() != row.facts_bytes
        || readback.facts().frontier().canonical_bytes() != row.frontier_bytes
        || readback.receipt().canonical_bytes() != row.receipt_bytes
    {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    Ok(readback)
}

fn decode_frontier_evidence_v2(
    bytes: &[u8],
) -> Result<
    (
        Vec<ReplayMarketDependencyRefV2>,
        ReplayNativeChainEvidenceV2,
        Vec<BindingDigest>,
    ),
    ReplayMarketFactsPostgresErrorV2,
> {
    let mut cursor = Cursor::new(bytes);
    cursor.version()?;
    if cursor.u32()? as usize != REQUIRED_DEPENDENCY_COUNT {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    let expected_kinds = [
        ReplayMarketDependencyKindV2::PitSnapshotV1,
        ReplayMarketDependencyKindV2::SourceBindingV1,
        ReplayMarketDependencyKindV2::InstrumentMasterCutV1,
        ReplayMarketDependencyKindV2::UniverseSelectionV1,
        ReplayMarketDependencyKindV2::ObservationCensusV1,
        ReplayMarketDependencyKindV2::StrategyInputJoinedCutV1,
    ];
    let mut dependencies = Vec::with_capacity(REQUIRED_DEPENDENCY_COUNT);
    for kind in expected_kinds {
        dependencies.push(cursor.typed_dependency(kind)?);
    }
    let projection_kind = cursor.u16()?;
    let projection_kind = match projection_kind {
        7 => ReplayMarketDependencyKindV2::StrategyInputSampleProjectionV2,
        8 => ReplayMarketDependencyKindV2::StrategyInputSampleProjectionV4,
        _ => return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord),
    };
    let projection = ReplayMarketDependencyRefV2::from_verified_owner_record(
        projection_kind,
        cursor.binding_digest()?,
        cursor.binding_digest()?,
    );
    dependencies.push(projection);

    let observation = cursor.typed_dependency(ReplayMarketDependencyKindV2::ObservationCensusV1)?;
    let joined = cursor.typed_dependency(ReplayMarketDependencyKindV2::StrategyInputJoinedCutV1)?;
    let joined_subject = cursor.binding_digest()?;
    let joined_subject_digest = cursor.binding_digest()?;
    let sample = cursor.typed_dependency(projection_kind)?;
    let sample_subject = cursor.binding_digest()?;
    let sample_subject_digest = cursor.binding_digest()?;
    let reference_count = usize::try_from(cursor.u32()?)
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::CorruptRecord)?;
    if reference_count != 7 {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    let mut reference_cut_identities = Vec::with_capacity(reference_count);
    for _ in 0..reference_count {
        reference_cut_identities.push(cursor.binding_digest()?);
    }
    if !cursor.is_finished()
        || observation != dependencies[4]
        || joined != dependencies[5]
        || sample != dependencies[6]
    {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    Ok((
        dependencies[..4].to_vec(),
        ReplayNativeChainEvidenceV2 {
            observation_census: observation,
            joined_cut: joined,
            joined_cut_observation_subject: joined_subject,
            joined_cut_observation_subject_digest: joined_subject_digest,
            sample_projection: sample,
            sample_projection_joined_cut_subject: sample_subject,
            sample_projection_joined_cut_subject_digest: sample_subject_digest,
        },
        reference_cut_identities,
    ))
}

fn decode_fact_cuts_v2(
    bytes: &[u8],
    request: &UntrustedReplayMarketFactsRequestV2,
    expected_frontier: [u8; DIGEST_BYTES],
    expected_cut_identities: &[BindingDigest],
) -> Result<Vec<ReplayReferenceFactCutProposalV2>, ReplayMarketFactsPostgresErrorV2> {
    let mut cursor = Cursor::new(bytes);
    cursor.version()?;
    let locator = request.pit_locator();
    if cursor.binding_digest()? != locator.request_identity
        || cursor.binding_digest()? != locator.request_digest
        || cursor.binding_digest()? != locator.snapshot_identity
        || cursor.binding_digest()? != locator.fact_digest
        || cursor.u64()? != locator.time_evidence.decision_cut.value
        || cursor.u64()? != locator.time_evidence.observed_at
        || cursor.u64()? != locator.time_evidence.valid_through
        || cursor.length_prefixed(MAX_FIELD_BYTES)?
            != locator.time_evidence.decision_cut.clock_identity.as_bytes()
        || cursor.length_prefixed(MAX_FIELD_BYTES)?
            != locator.time_evidence.decision_cut.clock_epoch.as_bytes()
        || cursor.i128()? != request.replay_start_event_ns()
        || cursor.i128()? != request.replay_end_event_ns_exclusive()
        || cursor.digest()? != expected_frontier
    {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    let count = usize::try_from(cursor.u32()?)
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::CorruptRecord)?;
    if count != 7 || expected_cut_identities.len() != count {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    let mut cuts = Vec::with_capacity(count);
    let mut decoded_identities = Vec::with_capacity(count);
    for ordinal in 1_u16..=7 {
        if cursor.u16()? != ordinal {
            return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
        }
        let identity = cursor.binding_digest()?;
        let cut_bytes = cursor.length_prefixed(MAX_CUT_BYTES)?;
        if digest(CUT_DOMAIN, cut_bytes) != identity {
            return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
        }
        cuts.push(decode_cut_proposal_v2(cut_bytes)?);
        decoded_identities.push(identity);
    }
    let mut sorted_identities = decoded_identities;
    sorted_identities.sort_unstable();
    if !cursor.is_finished() || sorted_identities != expected_cut_identities {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    Ok(cuts)
}

fn decode_cut_proposal_v2(
    bytes: &[u8],
) -> Result<ReplayReferenceFactCutProposalV2, ReplayMarketFactsPostgresErrorV2> {
    let mut cursor = Cursor::new(bytes);
    cursor.version()?;
    let kind = reference_kind(cursor.u16()?)?;
    let scope_bytes = cursor.length_prefixed(MAX_FIELD_BYTES)?;
    let scope = decode_scope_v2(scope_bytes)?;
    let count = usize::try_from(cursor.u32()?)
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::CorruptRecord)?;
    if count > super::codec::MAX_FACTS_PER_CUT {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    let mut facts = Vec::with_capacity(count);
    for _ in 0..count {
        let identity = cursor.binding_digest()?;
        let fact_bytes = cursor.length_prefixed(super::codec::MAX_FACT_BYTES)?;
        if digest(super::codec::FACT_DOMAIN, fact_bytes) != identity {
            return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
        }
        facts.push(decode_fact_proposal_v2(fact_bytes, scope_bytes)?);
    }
    if !cursor.is_finished() {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    Ok(ReplayReferenceFactCutProposalV2 { kind, scope, facts })
}

fn decode_scope_v2(
    bytes: &[u8],
) -> Result<ReplayReferenceFactScopeProposalV2, ReplayMarketFactsPostgresErrorV2> {
    let mut cursor = Cursor::new(bytes);
    cursor.version()?;
    let scope = ReplayReferenceFactScopeProposalV2 {
        pit_snapshot_identity: cursor.binding_digest()?,
        pit_decision_cut: cursor.u64()?,
        pit_observed_at: cursor.u64()?,
        pit_valid_through: cursor.u64()?,
        pit_clock_digest: cursor.binding_digest()?,
        replay_start_event_ns: cursor.i128()?,
        replay_end_event_ns_exclusive: cursor.i128()?,
        authority_kind: dependency_kind(cursor.u16()?)?,
        authority_identity: cursor.binding_digest()?,
    };
    cursor
        .is_finished()
        .then_some(scope)
        .ok_or(ReplayMarketFactsPostgresErrorV2::CorruptRecord)
}

fn decode_fact_proposal_v2(
    bytes: &[u8],
    expected_scope: &[u8],
) -> Result<ReplayReferenceFactProposalV2, ReplayMarketFactsPostgresErrorV2> {
    let mut cursor = Cursor::new(bytes);
    cursor.version()?;
    if cursor.length_prefixed(MAX_FIELD_BYTES)? != expected_scope {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    let value = decode_value_v2(&mut cursor)?;
    let time = decode_time_v2(&mut cursor)?;
    let source_identity = cursor.binding_digest()?;
    let correction_identity = cursor.binding_digest()?;
    if !cursor.is_finished() {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    Ok(ReplayReferenceFactProposalV2 {
        value,
        time,
        source_identity,
        correction_identity,
    })
}

fn decode_value_v2(
    cursor: &mut Cursor<'_>,
) -> Result<ReplayReferenceFactValueV2, ReplayMarketFactsPostgresErrorV2> {
    Ok(match reference_kind(cursor.u16()?)? {
        ReplayReferenceFactKindV2::Calendar => ReplayReferenceFactValueV2::Calendar {
            calendar_identity: cursor.length_prefixed(MAX_FIELD_BYTES)?.to_vec(),
            trading_day: cursor.i32()?,
            is_open: cursor.boolean()?,
        },
        ReplayReferenceFactKindV2::Session => ReplayReferenceFactValueV2::Session {
            session_identity: cursor.length_prefixed(MAX_FIELD_BYTES)?.to_vec(),
            calendar_identity: cursor.length_prefixed(MAX_FIELD_BYTES)?.to_vec(),
            opens_at_ns: cursor.i128()?,
            closes_at_ns: cursor.i128()?,
        },
        ReplayReferenceFactKindV2::TimeZone => ReplayReferenceFactValueV2::TimeZone {
            time_zone_identity: cursor.length_prefixed(MAX_FIELD_BYTES)?.to_vec(),
            ruleset_identity: cursor.binding_digest()?,
            offset_seconds: cursor.i32()?,
        },
        ReplayReferenceFactKindV2::MarketSemantics => {
            let normalization_identity = cursor.binding_digest()?;
            let price_adjustment = match cursor.u16()? {
                1 => ReplayPriceAdjustmentV2::Raw,
                2 => ReplayPriceAdjustmentV2::SplitAdjusted,
                3 => ReplayPriceAdjustmentV2::TotalReturnAdjusted,
                _ => return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord),
            };
            let timestamp_basis = match cursor.u16()? {
                1 => ReplayTimestampBasisV2::EventEffective,
                2 => ReplayTimestampBasisV2::IntervalOpen,
                3 => ReplayTimestampBasisV2::IntervalClose,
                _ => return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord),
            };
            ReplayReferenceFactValueV2::MarketSemantics {
                normalization_identity,
                price_adjustment,
                timestamp_basis,
                price_unit_identity: cursor.binding_digest()?,
                size_unit_identity: cursor.binding_digest()?,
            }
        }
        ReplayReferenceFactKindV2::CorrectionPolicy => {
            ReplayReferenceFactValueV2::CorrectionPolicy {
                stream_identity: cursor.length_prefixed(MAX_FIELD_BYTES)?.to_vec(),
                sequence: cursor.u64()?,
                successor_only: cursor.boolean()?,
            }
        }
        ReplayReferenceFactKindV2::CorporateAction => {
            let action_identity = cursor.binding_digest()?;
            let instrument = cursor.length_prefixed(MAX_FIELD_BYTES)?.to_vec();
            let terms = match cursor.u16()? {
                1 => ReplayCorporateActionTermsV2::Split {
                    numerator: cursor.u64()?,
                    denominator: cursor.u64()?,
                },
                2 => ReplayCorporateActionTermsV2::CashDividend {
                    mantissa: cursor.i128()?,
                    scale: cursor.u8()?,
                    currency_identity: cursor.length_prefixed(MAX_FIELD_BYTES)?.to_vec(),
                },
                3 => ReplayCorporateActionTermsV2::SymbolChange {
                    successor_instrument: cursor.length_prefixed(MAX_FIELD_BYTES)?.to_vec(),
                },
                4 => ReplayCorporateActionTermsV2::Expiry,
                5 => ReplayCorporateActionTermsV2::Roll {
                    successor_instrument: cursor.length_prefixed(MAX_FIELD_BYTES)?.to_vec(),
                },
                _ => return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord),
            };
            ReplayReferenceFactValueV2::CorporateAction {
                action_identity,
                instrument,
                terms,
            }
        }
        ReplayReferenceFactKindV2::HistoricalMembership => {
            ReplayReferenceFactValueV2::HistoricalMembership {
                selection_identity: cursor.binding_digest()?,
                member_key: cursor.length_prefixed(MAX_FIELD_BYTES)?.to_vec(),
                instrument: cursor.length_prefixed(MAX_FIELD_BYTES)?.to_vec(),
                included: cursor.boolean()?,
            }
        }
    })
}

fn decode_time_v2(
    cursor: &mut Cursor<'_>,
) -> Result<ReplayReferenceFactTimeV2, ReplayMarketFactsPostgresErrorV2> {
    let effective_from_ns = cursor.i128()?;
    let effective_until_ns = match cursor.u8()? {
        0 => None,
        1 => Some(cursor.i128()?),
        _ => return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord),
    };
    Ok(ReplayReferenceFactTimeV2 {
        effective_from_ns,
        effective_until_ns,
        provider_available_ns: cursor.i128()?,
        retrieval_ns: cursor.i128()?,
        correction_publication_ns: cursor.i128()?,
        owner_observation_ns: cursor.i128()?,
        decision_cut: cursor.u64()?,
    })
}

fn decode_receipt_correlation_v2(
    bytes: &[u8],
) -> Result<BindingDigest, ReplayMarketFactsPostgresErrorV2> {
    let mut cursor = Cursor::new(bytes);
    cursor.version()?;
    let _request_identity = cursor.digest()?;
    let _facts_identity = cursor.digest()?;
    let _frontier_identity = cursor.digest()?;
    let correlation = cursor.binding_digest()?;
    cursor
        .is_finished()
        .then_some(correlation)
        .ok_or(ReplayMarketFactsPostgresErrorV2::CorruptRecord)
}

fn reference_kind(
    value: u16,
) -> Result<ReplayReferenceFactKindV2, ReplayMarketFactsPostgresErrorV2> {
    match value {
        1 => Ok(ReplayReferenceFactKindV2::Calendar),
        2 => Ok(ReplayReferenceFactKindV2::Session),
        3 => Ok(ReplayReferenceFactKindV2::TimeZone),
        4 => Ok(ReplayReferenceFactKindV2::MarketSemantics),
        5 => Ok(ReplayReferenceFactKindV2::CorrectionPolicy),
        6 => Ok(ReplayReferenceFactKindV2::CorporateAction),
        7 => Ok(ReplayReferenceFactKindV2::HistoricalMembership),
        _ => Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord),
    }
}

fn dependency_kind(
    value: u16,
) -> Result<ReplayMarketDependencyKindV2, ReplayMarketFactsPostgresErrorV2> {
    match value {
        1 => Ok(ReplayMarketDependencyKindV2::PitSnapshotV1),
        2 => Ok(ReplayMarketDependencyKindV2::SourceBindingV1),
        3 => Ok(ReplayMarketDependencyKindV2::InstrumentMasterCutV1),
        4 => Ok(ReplayMarketDependencyKindV2::UniverseSelectionV1),
        5 => Ok(ReplayMarketDependencyKindV2::ObservationCensusV1),
        6 => Ok(ReplayMarketDependencyKindV2::StrategyInputJoinedCutV1),
        7 => Ok(ReplayMarketDependencyKindV2::StrategyInputSampleProjectionV2),
        8 => Ok(ReplayMarketDependencyKindV2::StrategyInputSampleProjectionV4),
        _ => Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord),
    }
}

/// Performs only the negative half of resolution.
///
/// A structurally valid stored row still cannot become positive: W2 must first resolve native
/// Universe Selection, `JoinedCut`, and `SampleProjection` records in this same Owner transaction.
pub(super) async fn resolve_replay_market_facts_negative_in_transaction_v2(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedReplayMarketFactsRequestV2,
) -> Result<std::convert::Infallible, ReplayMarketFactsPostgresErrorV2> {
    let locator = request.pit_locator();
    let meaning = meaning_identity(
        *locator.request_identity.as_bytes(),
        *locator.request_digest.as_bytes(),
        *locator.snapshot_identity.as_bytes(),
        request.replay_start_event_ns(),
        request.replay_end_event_ns_exclusive(),
    );
    let row = load_by_meaning(transaction, meaning)
        .await?
        .ok_or(ReplayMarketFactsPostgresErrorV2::UnknownRecord)?;
    validate_stored_row(&row.row)?;
    Err(ReplayMarketFactsPostgresErrorV2::UniverseSelectionUnavailable)
}

fn classify_existing(
    existing: &StoredReplayMarketFactsRowV2,
    candidate: &StoredReplayMarketFactsRowV2,
) -> Result<(), ReplayMarketFactsPostgresErrorV2> {
    validate_stored_row(existing)?;
    if existing == candidate {
        Ok(())
    } else if existing.facts_identity == candidate.facts_identity
        || existing.receipt_identity == candidate.receipt_identity
    {
        Err(ReplayMarketFactsPostgresErrorV2::IdentityConflict)
    } else {
        Err(ReplayMarketFactsPostgresErrorV2::MeaningConflict)
    }
}

async fn lock_identities(
    transaction: &mut Transaction<'_, Postgres>,
    row: &StoredReplayMarketFactsRowV2,
) -> Result<(), ReplayMarketFactsPostgresErrorV2> {
    let mut identities = [
        row.facts_identity,
        row.meaning_identity,
        row.receipt_identity,
    ];
    identities.sort_unstable();
    for identity in identities {
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(advisory_key(identity))
            .execute(&mut **transaction)
            .await
            .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;
    }
    Ok(())
}

fn advisory_key(identity: [u8; DIGEST_BYTES]) -> i64 {
    i64::from_be_bytes(identity[..8].try_into().expect("fixed digest prefix"))
}

async fn load_by_meaning(
    transaction: &mut Transaction<'_, Postgres>,
    identity: [u8; DIGEST_BYTES],
) -> Result<Option<DurableReplayMarketFactsStorageV2>, ReplayMarketFactsPostgresErrorV2> {
    let row = sqlx::query(LOAD_REPLAY_MARKET_FACTS_BY_MEANING_V2)
        .bind(identity.as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;
    row.map(|row| decode_postgres_row(&row)).transpose()
}

async fn load_by_identity(
    transaction: &mut Transaction<'_, Postgres>,
    identity: [u8; DIGEST_BYTES],
) -> Result<Option<DurableReplayMarketFactsStorageV2>, ReplayMarketFactsPostgresErrorV2> {
    let meaning: Option<Vec<u8>> = sqlx::query_scalar(
        "SELECT meaning_identity FROM market_data_private.replay_market_facts_v2 WHERE facts_identity=$1",
    )
        .bind(identity.as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;

    match meaning {
        Some(meaning) => load_by_meaning(transaction, digest_array(meaning)?).await,
        None => Ok(None),
    }
}

async fn load_by_receipt(
    transaction: &mut Transaction<'_, Postgres>,
    identity: [u8; DIGEST_BYTES],
) -> Result<Option<DurableReplayMarketFactsStorageV2>, ReplayMarketFactsPostgresErrorV2> {
    let meaning: Option<Vec<u8>> = sqlx::query_scalar(
        "SELECT meaning_identity FROM market_data_private.replay_market_facts_receipts_v2 WHERE receipt_identity=$1",
    )
        .bind(identity.as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)?;

    match meaning {
        Some(meaning) => load_by_meaning(transaction, digest_array(meaning)?).await,
        None => Ok(None),
    }
}

async fn any_storage_fragment_exists(
    transaction: &mut Transaction<'_, Postgres>,
    row: &StoredReplayMarketFactsRowV2,
) -> Result<bool, ReplayMarketFactsPostgresErrorV2> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM market_data_private.replay_market_facts_v2 WHERE facts_identity=$1 OR meaning_identity=$2 OR receipt_identity=$3 UNION ALL SELECT 1 FROM market_data_private.replay_market_facts_receipts_v2 WHERE receipt_identity=$3 OR facts_identity=$1 OR meaning_identity=$2 UNION ALL SELECT 1 FROM market_data_private.replay_market_facts_outbox_v2 WHERE outbox_identity=$3 OR receipt_identity=$3 OR facts_identity=$1)")
        .bind(row.facts_identity.as_slice())
        .bind(row.meaning_identity.as_slice())
        .bind(row.receipt_identity.as_slice())
        .fetch_one(&mut **transaction)
        .await
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::StoreUnavailable)
}

fn decode_postgres_row(
    row: &sqlx::postgres::PgRow,
) -> Result<DurableReplayMarketFactsStorageV2, ReplayMarketFactsPostgresErrorV2> {
    let raw = RawReplayMarketFactsRowV2 {
        facts_identity: row_bytes(row, "facts_identity")?,
        meaning_identity: row_bytes(row, "meaning_identity")?,
        composition_binding_identity: row_optional_digest(row, "composition_binding_identity")?,
        request_identity: row_bytes(row, "request_identity")?,
        request_digest: row_bytes(row, "request_digest")?,
        frontier_identity: row_bytes(row, "frontier_identity")?,
        receipt_identity: row_bytes(row, "receipt_identity")?,
        universe_selection_identity: row_bytes(row, "universe_selection_identity")?,
        universe_selection_digest: row_bytes(row, "universe_selection_digest")?,
        joined_cut_identity: row_bytes(row, "joined_cut_identity")?,
        joined_cut_digest: row_bytes(row, "joined_cut_digest")?,
        sample_projection_identity: row_bytes(row, "sample_projection_identity")?,
        sample_projection_digest: row_bytes(row, "sample_projection_digest")?,
        facts_bytes: row_bytes(row, "facts_bytes")?,
        frontier_bytes: row_bytes(row, "frontier_bytes")?,
        receipt_bytes: row_bytes(row, "receipt_bytes")?,
        custody_digest: row_bytes(row, "custody_digest")?,
    };
    let stored = StoredReplayMarketFactsRowV2::try_from(raw)?;
    let manifest = ReplayMarketFactsStorageManifestV2 {
        store_generation_identity: digest_array(row_bytes(row, "store_generation_identity")?)?,
        append_sequence: row_u64(row, "append_sequence")?,
        receipt_facts_identity: digest_array(row_bytes(row, "receipt_facts_identity")?)?,
        receipt_meaning_identity: digest_array(row_bytes(row, "receipt_meaning_identity")?)?,
        receipt_append_sequence: row_u64(row, "receipt_append_sequence")?,
        receipt_manifest_digest: digest_array(row_bytes(row, "receipt_manifest_digest")?)?,
        receipt_custody_digest: digest_array(row_bytes(row, "receipt_custody_digest")?)?,
        outbox_identity: digest_array(row_bytes(row, "outbox_identity")?)?,
        outbox_facts_identity: digest_array(row_bytes(row, "outbox_facts_identity")?)?,
        outbox_receipt_identity: digest_array(row_bytes(row, "outbox_receipt_identity")?)?,
        outbox_payload_digest: digest_array(row_bytes(row, "outbox_payload_digest")?)?,
        outbox_payload_bytes: row_bytes(row, "outbox_payload_bytes")?,
        outbox_append_sequence: row_u64(row, "outbox_append_sequence")?,
        outbox_manifest_digest: digest_array(row_bytes(row, "outbox_manifest_digest")?)?,
        outbox_custody_digest: digest_array(row_bytes(row, "outbox_custody_digest")?)?,
        state_append_sequence: row_u64(row, "state_append_sequence")?,
        fact_count: row_u64(row, "fact_count")?,
        receipt_count: row_u64(row, "receipt_count")?,
        outbox_count: row_u64(row, "outbox_count")?,
        fact_max_sequence: row_u64(row, "fact_max_sequence")?,
        receipt_max_sequence: row_u64(row, "receipt_max_sequence")?,
        outbox_max_sequence: row_u64(row, "outbox_max_sequence")?,
    };
    validate_storage_manifest(&stored, &manifest)?;
    Ok(DurableReplayMarketFactsStorageV2 {
        row: stored,
        manifest,
    })
}

fn row_bytes(
    row: &sqlx::postgres::PgRow,
    column: &'static str,
) -> Result<Vec<u8>, ReplayMarketFactsPostgresErrorV2> {
    row.try_get(column)
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::CorruptRecord)
}

fn row_optional_digest(
    row: &sqlx::postgres::PgRow,
    column: &'static str,
) -> Result<Option<Vec<u8>>, ReplayMarketFactsPostgresErrorV2> {
    row.try_get(column)
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::CorruptRecord)
}

fn row_u64(
    row: &sqlx::postgres::PgRow,
    column: &'static str,
) -> Result<u64, ReplayMarketFactsPostgresErrorV2> {
    let value: i64 = row
        .try_get(column)
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::CorruptRecord)?;
    u64::try_from(value).map_err(|_| ReplayMarketFactsPostgresErrorV2::CorruptRecord)
}

#[derive(Clone, Debug)]
struct RawReplayMarketFactsRowV2 {
    facts_identity: Vec<u8>,
    meaning_identity: Vec<u8>,
    composition_binding_identity: Option<Vec<u8>>,
    request_identity: Vec<u8>,
    request_digest: Vec<u8>,
    frontier_identity: Vec<u8>,
    receipt_identity: Vec<u8>,
    universe_selection_identity: Vec<u8>,
    universe_selection_digest: Vec<u8>,
    joined_cut_identity: Vec<u8>,
    joined_cut_digest: Vec<u8>,
    sample_projection_identity: Vec<u8>,
    sample_projection_digest: Vec<u8>,
    facts_bytes: Vec<u8>,
    frontier_bytes: Vec<u8>,
    receipt_bytes: Vec<u8>,
    custody_digest: Vec<u8>,
}

impl TryFrom<RawReplayMarketFactsRowV2> for StoredReplayMarketFactsRowV2 {
    type Error = ReplayMarketFactsPostgresErrorV2;

    fn try_from(raw: RawReplayMarketFactsRowV2) -> Result<Self, Self::Error> {
        let facts = parse_facts_envelope(&raw.facts_bytes)?;
        let row = Self {
            facts_identity: digest_array(raw.facts_identity)?,
            meaning_identity: digest_array(raw.meaning_identity)?,
            composition_binding_identity: raw
                .composition_binding_identity
                .map(digest_array)
                .transpose()?,
            request_identity: digest_array(raw.request_identity)?,
            request_digest: digest_array(raw.request_digest)?,
            pit_snapshot_identity: facts.pit_snapshot_identity,
            replay_start_event_ns: facts.replay_start_event_ns,
            replay_end_event_ns_exclusive: facts.replay_end_event_ns_exclusive,
            frontier_identity: digest_array(raw.frontier_identity)?,
            receipt_identity: digest_array(raw.receipt_identity)?,
            universe_selection: OpaqueDependencyLocatorV2 {
                identity: digest_array(raw.universe_selection_identity)?,
                digest: digest_array(raw.universe_selection_digest)?,
            },
            joined_cut: OpaqueDependencyLocatorV2 {
                identity: digest_array(raw.joined_cut_identity)?,
                digest: digest_array(raw.joined_cut_digest)?,
            },
            sample_projection: OpaqueDependencyLocatorV2 {
                identity: digest_array(raw.sample_projection_identity)?,
                digest: digest_array(raw.sample_projection_digest)?,
            },
            facts_bytes: raw.facts_bytes,
            frontier_bytes: raw.frontier_bytes,
            receipt_bytes: raw.receipt_bytes,
            custody_digest: digest_array(raw.custody_digest)?,
        };
        validate_stored_row(&row)?;
        Ok(row)
    }
}

fn digest_array(bytes: Vec<u8>) -> Result<[u8; DIGEST_BYTES], ReplayMarketFactsPostgresErrorV2> {
    bytes
        .try_into()
        .map_err(|_| ReplayMarketFactsPostgresErrorV2::CorruptRecord)
}

fn validate_stored_row(
    row: &StoredReplayMarketFactsRowV2,
) -> Result<(), ReplayMarketFactsPostgresErrorV2> {
    if row.facts_bytes.is_empty()
        || row.facts_bytes.len() > MAX_AGGREGATE_BYTES
        || row.frontier_bytes.is_empty()
        || row.frontier_bytes.len() > MAX_FRONTIER_BYTES
        || row.receipt_bytes.len() != RECEIPT_CANONICAL_BYTES
        || row.receipt_bytes.len() > MAX_RECEIPT_BYTES
        || row.replay_start_event_ns >= row.replay_end_event_ns_exclusive
        || row.facts_identity != digest_bytes(FACTS_DOMAIN, &row.facts_bytes)
        || row.frontier_identity != digest_bytes(FRONTIER_DOMAIN, &row.frontier_bytes)
        || row.receipt_identity != digest_bytes(RECEIPT_DOMAIN, &row.receipt_bytes)
        || row.meaning_identity != expected_meaning_identity(row)
        || row.custody_digest != storage_digest(row)
    {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    validate_facts_envelope(row)?;
    validate_receipt_envelope(row)?;
    validate_frontier_envelope(row)
}

fn validate_storage_manifest(
    row: &StoredReplayMarketFactsRowV2,
    manifest: &ReplayMarketFactsStorageManifestV2,
) -> Result<(), ReplayMarketFactsPostgresErrorV2> {
    let expected_manifest = storage_manifest_digest(
        row,
        manifest.store_generation_identity,
        manifest.append_sequence,
    );
    let expected_payload_digest = digest_bytes(RECEIPT_DOMAIN, &row.receipt_bytes);
    if manifest.append_sequence == 0
        || manifest.receipt_facts_identity != row.facts_identity
        || manifest.receipt_meaning_identity != row.meaning_identity
        || manifest.receipt_append_sequence != manifest.append_sequence
        || manifest.receipt_manifest_digest != expected_manifest
        || manifest.receipt_custody_digest
            != receipt_custody_digest(row, expected_manifest, manifest.append_sequence)
        || manifest.outbox_identity != row.receipt_identity
        || manifest.outbox_facts_identity != row.facts_identity
        || manifest.outbox_receipt_identity != row.receipt_identity
        || manifest.outbox_payload_digest != expected_payload_digest
        || manifest.outbox_payload_bytes != row.receipt_bytes
        || manifest.outbox_append_sequence != manifest.append_sequence
        || manifest.outbox_manifest_digest != expected_manifest
        || manifest.outbox_custody_digest
            != outbox_custody_digest(
                row,
                expected_manifest,
                expected_payload_digest,
                manifest.append_sequence,
            )
        || manifest.state_append_sequence != manifest.fact_count
        || manifest.state_append_sequence != manifest.receipt_count
        || manifest.state_append_sequence != manifest.outbox_count
        || manifest.state_append_sequence != manifest.fact_max_sequence
        || manifest.state_append_sequence != manifest.receipt_max_sequence
        || manifest.state_append_sequence != manifest.outbox_max_sequence
        || manifest.state_append_sequence < manifest.append_sequence
    {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    Ok(())
}

fn validate_facts_envelope(
    row: &StoredReplayMarketFactsRowV2,
) -> Result<(), ReplayMarketFactsPostgresErrorV2> {
    let facts = parse_facts_envelope(&row.facts_bytes)?;
    if facts.request_identity != row.request_identity
        || facts.request_digest != row.request_digest
        || facts.pit_snapshot_identity != row.pit_snapshot_identity
        || facts.replay_start_event_ns != row.replay_start_event_ns
        || facts.replay_end_event_ns_exclusive != row.replay_end_event_ns_exclusive
        || facts.frontier_identity != row.frontier_identity
    {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    Ok(())
}

fn validate_receipt_envelope(
    row: &StoredReplayMarketFactsRowV2,
) -> Result<(), ReplayMarketFactsPostgresErrorV2> {
    let mut cursor = Cursor::new(&row.receipt_bytes);
    cursor.version()?;
    let request_identity = cursor.digest()?;
    let facts_identity = cursor.digest()?;
    let frontier_identity = cursor.digest()?;
    let stable_correlation = cursor.digest()?;
    if !cursor.is_finished()
        || stable_correlation == [0; DIGEST_BYTES]
        || request_identity != row.request_identity
        || facts_identity != row.facts_identity
        || frontier_identity != row.frontier_identity
    {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    Ok(())
}

fn validate_frontier_envelope(
    row: &StoredReplayMarketFactsRowV2,
) -> Result<(), ReplayMarketFactsPostgresErrorV2> {
    let mut cursor = Cursor::new(&row.frontier_bytes);
    cursor.version()?;
    if cursor.u32()? as usize != REQUIRED_DEPENDENCY_COUNT {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    let mut dependencies = Vec::with_capacity(REQUIRED_DEPENDENCY_COUNT);

    for expected_kind in 1_u16..=6 {
        let kind = cursor.u16()?;
        let dependency = OpaqueDependencyLocatorV2 {
            identity: cursor.digest()?,
            digest: cursor.digest()?,
        };

        if kind != expected_kind
            || dependency.identity == [0; DIGEST_BYTES]
            || dependency.digest == [0; DIGEST_BYTES]
        {
            return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
        }
        dependencies.push(dependency);
    }
    let projection_kind = cursor.u16()?;
    if !matches!(projection_kind, 7 | 8) {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    let projection_dependency = OpaqueDependencyLocatorV2 {
        identity: cursor.digest()?,
        digest: cursor.digest()?,
    };

    if projection_dependency.identity == [0; DIGEST_BYTES]
        || projection_dependency.digest == [0; DIGEST_BYTES]
    {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    dependencies.push(projection_dependency);
    let observation = cursor.dependency(ReplayMarketDependencyKindV2::ObservationCensusV1)?;
    let joined = cursor.dependency(ReplayMarketDependencyKindV2::StrategyInputJoinedCutV1)?;
    let joined_subject = cursor.digest()?;
    let joined_subject_digest = cursor.digest()?;
    let sample = cursor.dependency(if projection_kind == 7 {
        ReplayMarketDependencyKindV2::StrategyInputSampleProjectionV2
    } else {
        ReplayMarketDependencyKindV2::StrategyInputSampleProjectionV4
    })?;
    let sample_subject = cursor.digest()?;
    let sample_subject_digest = cursor.digest()?;
    let reference_count = cursor.u32()? as usize;
    for _ in 0..reference_count {
        let _ = cursor.digest()?;
    }

    if !cursor.is_finished()
        || observation != dependencies[4]
        || joined != dependencies[5]
        || sample != dependencies[6]
        || joined_subject != observation.identity
        || joined_subject_digest != observation.digest
        || sample_subject != joined.identity
        || sample_subject_digest != joined.digest
        || row.universe_selection != dependencies[3]
        || row.joined_cut != dependencies[5]
        || row.sample_projection != dependencies[6]
    {
        return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct FactsEnvelopeV2 {
    request_identity: [u8; DIGEST_BYTES],
    request_digest: [u8; DIGEST_BYTES],
    pit_snapshot_identity: [u8; DIGEST_BYTES],
    replay_start_event_ns: i128,
    replay_end_event_ns_exclusive: i128,
    frontier_identity: [u8; DIGEST_BYTES],
}

fn parse_facts_envelope(bytes: &[u8]) -> Result<FactsEnvelopeV2, ReplayMarketFactsPostgresErrorV2> {
    let mut cursor = Cursor::new(bytes);
    cursor.version()?;
    let request_identity = cursor.digest()?;
    let request_digest = cursor.digest()?;
    let pit_snapshot_identity = cursor.digest()?;
    let _pit_fact_digest = cursor.digest()?;
    let _pit_decision_cut = cursor.u64()?;
    let _pit_observed_at = cursor.u64()?;
    let _pit_valid_through = cursor.u64()?;
    cursor.skip_length_prefixed()?;
    cursor.skip_length_prefixed()?;
    let replay_start_event_ns = cursor.i128()?;
    let replay_end_event_ns_exclusive = cursor.i128()?;
    let frontier_identity = cursor.digest()?;
    Ok(FactsEnvelopeV2 {
        request_identity,
        request_digest,
        pit_snapshot_identity,
        replay_start_event_ns,
        replay_end_event_ns_exclusive,
        frontier_identity,
    })
}

struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Cursor<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, count: usize) -> Result<&'a [u8], ReplayMarketFactsPostgresErrorV2> {
        let end = self
            .offset
            .checked_add(count)
            .ok_or(ReplayMarketFactsPostgresErrorV2::CorruptRecord)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(ReplayMarketFactsPostgresErrorV2::CorruptRecord)?;
        self.offset = end;
        Ok(value)
    }

    fn version(&mut self) -> Result<(), ReplayMarketFactsPostgresErrorV2> {
        if self.u16()? == 2 {
            Ok(())
        } else {
            Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord)
        }
    }

    fn u16(&mut self) -> Result<u16, ReplayMarketFactsPostgresErrorV2> {
        Ok(u16::from_be_bytes(self.take(2)?.try_into().map_err(
            |_| ReplayMarketFactsPostgresErrorV2::CorruptRecord,
        )?))
    }

    fn u8(&mut self) -> Result<u8, ReplayMarketFactsPostgresErrorV2> {
        Ok(*self
            .take(1)?
            .first()
            .ok_or(ReplayMarketFactsPostgresErrorV2::CorruptRecord)?)
    }

    fn u32(&mut self) -> Result<u32, ReplayMarketFactsPostgresErrorV2> {
        Ok(u32::from_be_bytes(self.take(4)?.try_into().map_err(
            |_| ReplayMarketFactsPostgresErrorV2::CorruptRecord,
        )?))
    }

    fn u64(&mut self) -> Result<u64, ReplayMarketFactsPostgresErrorV2> {
        Ok(u64::from_be_bytes(self.take(8)?.try_into().map_err(
            |_| ReplayMarketFactsPostgresErrorV2::CorruptRecord,
        )?))
    }

    fn i32(&mut self) -> Result<i32, ReplayMarketFactsPostgresErrorV2> {
        Ok(i32::from_be_bytes(self.take(4)?.try_into().map_err(
            |_| ReplayMarketFactsPostgresErrorV2::CorruptRecord,
        )?))
    }

    fn i128(&mut self) -> Result<i128, ReplayMarketFactsPostgresErrorV2> {
        Ok(i128::from_be_bytes(self.take(16)?.try_into().map_err(
            |_| ReplayMarketFactsPostgresErrorV2::CorruptRecord,
        )?))
    }

    fn digest(&mut self) -> Result<[u8; DIGEST_BYTES], ReplayMarketFactsPostgresErrorV2> {
        self.take(DIGEST_BYTES)?
            .try_into()
            .map_err(|_| ReplayMarketFactsPostgresErrorV2::CorruptRecord)
    }

    fn binding_digest(&mut self) -> Result<BindingDigest, ReplayMarketFactsPostgresErrorV2> {
        Ok(BindingDigest::from_untrusted_bytes(self.digest()?))
    }

    fn boolean(&mut self) -> Result<bool, ReplayMarketFactsPostgresErrorV2> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord),
        }
    }

    fn length_prefixed(
        &mut self,
        limit: usize,
    ) -> Result<&'a [u8], ReplayMarketFactsPostgresErrorV2> {
        let count = usize::try_from(self.u32()?)
            .map_err(|_| ReplayMarketFactsPostgresErrorV2::CorruptRecord)?;
        if count > limit {
            return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
        }
        self.take(count)
    }

    fn skip_length_prefixed(&mut self) -> Result<(), ReplayMarketFactsPostgresErrorV2> {
        let count = usize::try_from(self.u32()?)
            .map_err(|_| ReplayMarketFactsPostgresErrorV2::CorruptRecord)?;
        if count > MAX_FIELD_BYTES {
            return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
        }
        let _ = self.take(count)?;
        Ok(())
    }

    fn dependency(
        &mut self,
        expected_kind: ReplayMarketDependencyKindV2,
    ) -> Result<OpaqueDependencyLocatorV2, ReplayMarketFactsPostgresErrorV2> {
        if self.u16()? != expected_kind as u16 {
            return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
        }
        Ok(OpaqueDependencyLocatorV2 {
            identity: self.digest()?,
            digest: self.digest()?,
        })
    }

    fn typed_dependency(
        &mut self,
        expected_kind: ReplayMarketDependencyKindV2,
    ) -> Result<ReplayMarketDependencyRefV2, ReplayMarketFactsPostgresErrorV2> {
        if self.u16()? != expected_kind as u16 {
            return Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord);
        }
        Ok(ReplayMarketDependencyRefV2::from_verified_owner_record(
            expected_kind,
            self.binding_digest()?,
            self.binding_digest()?,
        ))
    }

    const fn is_finished(&self) -> bool {
        self.offset == self.bytes.len()
    }
}

pub(super) fn meaning_identity(
    request_identity: [u8; DIGEST_BYTES],
    request_digest: [u8; DIGEST_BYTES],
    pit_snapshot_identity: [u8; DIGEST_BYTES],
    replay_start_event_ns: i128,
    replay_end_event_ns_exclusive: i128,
) -> [u8; DIGEST_BYTES] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(MEANING_DOMAIN);
    hasher.update(&request_identity);
    hasher.update(&request_digest);
    hasher.update(&pit_snapshot_identity);
    hasher.update(&replay_start_event_ns.to_be_bytes());
    hasher.update(&replay_end_event_ns_exclusive.to_be_bytes());
    *hasher.finalize().as_bytes()
}

pub(super) fn bound_meaning_identity(
    request_identity: [u8; DIGEST_BYTES],
    request_digest: [u8; DIGEST_BYTES],
    pit_snapshot_identity: [u8; DIGEST_BYTES],
    replay_start_event_ns: i128,
    replay_end_event_ns_exclusive: i128,
    composition_binding_identity: [u8; DIGEST_BYTES],
) -> [u8; DIGEST_BYTES] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(BOUND_MEANING_DOMAIN);
    hasher.update(&request_identity);
    hasher.update(&request_digest);
    hasher.update(&pit_snapshot_identity);
    hasher.update(&replay_start_event_ns.to_be_bytes());
    hasher.update(&replay_end_event_ns_exclusive.to_be_bytes());
    hasher.update(&composition_binding_identity);
    *hasher.finalize().as_bytes()
}

fn expected_meaning_identity(row: &StoredReplayMarketFactsRowV2) -> [u8; DIGEST_BYTES] {
    match row.composition_binding_identity {
        Some(binding) if binding != [0; DIGEST_BYTES] => bound_meaning_identity(
            row.request_identity,
            row.request_digest,
            row.pit_snapshot_identity,
            row.replay_start_event_ns,
            row.replay_end_event_ns_exclusive,
            binding,
        ),
        Some(_) => [0; DIGEST_BYTES],
        None => meaning_identity(
            row.request_identity,
            row.request_digest,
            row.pit_snapshot_identity,
            row.replay_start_event_ns,
            row.replay_end_event_ns_exclusive,
        ),
    }
}

pub(super) fn storage_digest(row: &StoredReplayMarketFactsRowV2) -> [u8; DIGEST_BYTES] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(STORAGE_DOMAIN);

    for bytes in [
        row.facts_identity.as_slice(),
        row.meaning_identity.as_slice(),
        row.request_identity.as_slice(),
        row.request_digest.as_slice(),
        row.frontier_identity.as_slice(),
        row.receipt_identity.as_slice(),
        row.universe_selection.identity.as_slice(),
        row.universe_selection.digest.as_slice(),
        row.joined_cut.identity.as_slice(),
        row.joined_cut.digest.as_slice(),
        row.sample_projection.identity.as_slice(),
        row.sample_projection.digest.as_slice(),
    ] {
        hasher.update(bytes);
    }

    match row.composition_binding_identity {
        Some(binding) => {
            hasher.update(&[1]);
            hasher.update(&binding);
        }
        None => {
            hasher.update(&[0]);
        }
    }

    for bytes in [&row.facts_bytes, &row.frontier_bytes, &row.receipt_bytes] {
        hasher.update(&(bytes.len() as u64).to_be_bytes());
        hasher.update(bytes);
    }
    *hasher.finalize().as_bytes()
}

fn store_generation_identity(database_name: &str) -> [u8; DIGEST_BYTES] {
    digest_bytes(GENERATION_DOMAIN, database_name.as_bytes())
}

fn storage_manifest_digest(
    row: &StoredReplayMarketFactsRowV2,
    store_generation_identity: [u8; DIGEST_BYTES],
    append_sequence: u64,
) -> [u8; DIGEST_BYTES] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(MANIFEST_DOMAIN);
    hasher.update(&store_generation_identity);
    hasher.update(&append_sequence.to_be_bytes());
    hasher.update(&row.facts_identity);
    hasher.update(&row.meaning_identity);
    hasher.update(&row.frontier_identity);
    hasher.update(&row.receipt_identity);
    hasher.update(&row.custody_digest);
    hasher.update(&(row.receipt_bytes.len() as u64).to_be_bytes());
    hasher.update(&row.receipt_bytes);
    *hasher.finalize().as_bytes()
}

fn receipt_custody_digest(
    row: &StoredReplayMarketFactsRowV2,
    manifest_digest: [u8; DIGEST_BYTES],
    append_sequence: u64,
) -> [u8; DIGEST_BYTES] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(RECEIPT_CUSTODY_DOMAIN);
    hasher.update(&row.receipt_identity);
    hasher.update(&row.facts_identity);
    hasher.update(&row.meaning_identity);
    hasher.update(&append_sequence.to_be_bytes());
    hasher.update(&manifest_digest);
    hasher.update(&(row.receipt_bytes.len() as u64).to_be_bytes());
    hasher.update(&row.receipt_bytes);
    *hasher.finalize().as_bytes()
}

fn outbox_custody_digest(
    row: &StoredReplayMarketFactsRowV2,
    manifest_digest: [u8; DIGEST_BYTES],
    payload_digest: [u8; DIGEST_BYTES],
    append_sequence: u64,
) -> [u8; DIGEST_BYTES] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(OUTBOX_CUSTODY_DOMAIN);
    hasher.update(&row.receipt_identity);
    hasher.update(&row.facts_identity);
    hasher.update(&payload_digest);
    hasher.update(&append_sequence.to_be_bytes());
    hasher.update(&manifest_digest);
    hasher.update(&(row.receipt_bytes.len() as u64).to_be_bytes());
    hasher.update(&row.receipt_bytes);
    *hasher.finalize().as_bytes()
}

pub(super) fn digest_bytes(domain: &[u8], bytes: &[u8]) -> [u8; DIGEST_BYTES] {
    *digest(domain, bytes).as_bytes()
}

#[cfg(test)]
pub(super) fn classify_candidate_rows_for_test(
    existing: &StoredReplayMarketFactsRowV2,
    candidate: &StoredReplayMarketFactsRowV2,
) -> Result<(), ReplayMarketFactsPostgresErrorV2> {
    classify_existing(existing, candidate)
}

#[cfg(test)]
pub(super) fn validate_stored_row_for_test(
    row: &StoredReplayMarketFactsRowV2,
) -> Result<(), ReplayMarketFactsPostgresErrorV2> {
    validate_stored_row(row)
}

#[cfg(test)]
pub(super) fn reseal_storage_row_for_test(row: &mut StoredReplayMarketFactsRowV2) {
    row.custody_digest = storage_digest(row);
}

#[cfg(test)]
pub(super) fn negative_resolution_for_test(
    row: &StoredReplayMarketFactsRowV2,
) -> Result<std::convert::Infallible, ReplayMarketFactsPostgresErrorV2> {
    validate_stored_row(row)?;
    Err(ReplayMarketFactsPostgresErrorV2::UniverseSelectionUnavailable)
}

#[cfg(test)]
pub(super) fn sealed_storage_manifest_for_test(
    row: &StoredReplayMarketFactsRowV2,
    database_name: &str,
    append_sequence: u64,
    total_count: u64,
) -> ReplayMarketFactsStorageManifestV2 {
    let generation = store_generation_identity(database_name);
    let manifest_digest = storage_manifest_digest(row, generation, append_sequence);
    let payload_digest = digest_bytes(RECEIPT_DOMAIN, &row.receipt_bytes);
    ReplayMarketFactsStorageManifestV2 {
        store_generation_identity: generation,
        append_sequence,
        receipt_facts_identity: row.facts_identity,
        receipt_meaning_identity: row.meaning_identity,
        receipt_append_sequence: append_sequence,
        receipt_manifest_digest: manifest_digest,
        receipt_custody_digest: receipt_custody_digest(row, manifest_digest, append_sequence),
        outbox_identity: row.receipt_identity,
        outbox_facts_identity: row.facts_identity,
        outbox_receipt_identity: row.receipt_identity,
        outbox_payload_digest: payload_digest,
        outbox_payload_bytes: row.receipt_bytes.clone(),
        outbox_append_sequence: append_sequence,
        outbox_manifest_digest: manifest_digest,
        outbox_custody_digest: outbox_custody_digest(
            row,
            manifest_digest,
            payload_digest,
            append_sequence,
        ),
        state_append_sequence: total_count,
        fact_count: total_count,
        receipt_count: total_count,
        outbox_count: total_count,
        fact_max_sequence: total_count,
        receipt_max_sequence: total_count,
        outbox_max_sequence: total_count,
    }
}

#[cfg(test)]
pub(super) fn validate_storage_manifest_for_test(
    row: &StoredReplayMarketFactsRowV2,
    manifest: &ReplayMarketFactsStorageManifestV2,
) -> Result<(), ReplayMarketFactsPostgresErrorV2> {
    validate_storage_manifest(row, manifest)
}

#[cfg(test)]
pub(super) fn store_generation_identity_for_test(database_name: &str) -> [u8; DIGEST_BYTES] {
    store_generation_identity(database_name)
}

#[cfg(test)]
mod resolver_contract_tests {
    use super::*;

    #[test]
    fn read_contract_authenticates_exact_schema_functions_and_acl() {
        let schema = REPLAY_MARKET_FACTS_SCHEMA_V2.join("\n");
        assert!(schema.contains(RESOLVE_COMPOSITION_BINDING_SOURCE_V1));
        assert!(schema.contains(RESOLVE_BOUND_REPLAY_FACTS_SOURCE_V1));

        let source = include_str!("postgres.rs");
        for required in [
            "current_user='market_data_owner'",
            "pg_catalog.aclexplode",
            "attribute.attacl IS NOT NULL",
            "procedure.prosrc=ANY(ARRAY[$1,$2])",
            "procedure.prosecdef",
            "procedure.proconfig=ARRAY['search_path=pg_catalog']::text[]",
            "relation.relkind='r'",
            "(SELECT count(*) FROM observed)=27",
            "constraint_fact.confrelid=pg_catalog.to_regclass(",
            "NOT foreign_relation_oid_exact",
            "replay_market_facts_binding_v1",
            "index_fact.indisunique",
            "index_fact.indrelid=pg_catalog.to_regclass('market_data_private.replay_market_facts_v2')",
            "pg_catalog.pg_get_expr(index_fact.indpred,index_fact.indrelid)='(composition_binding_identity IS NOT NULL)'",
        ] {
            assert!(source.contains(required));
        }
    }

    #[test]
    fn resolver_requires_binding_and_revalidates_native_chain_before_return() {
        let owner = include_str!("../postgres.rs");
        let ordinary = owner
            .split("pub(crate) async fn resolve_replay_market_facts_readback_v2")
            .nth(1)
            .expect("ordinary replay resolver")
            .split("pub(crate) async fn resolve_replay_composition_readback_v1")
            .next()
            .expect("bounded ordinary replay resolver");
        assert!(ordinary.contains("Err(ReplayMarketFactsErrorV2::CustodyUnavailable)"));
        assert!(!ordinary.contains("recover_replay_market_facts_readback_in_transaction_v2"));

        let composition = owner
            .split("pub(crate) async fn resolve_replay_composition_readback_v1")
            .nth(1)
            .expect("bound composition resolver")
            .split("async fn migrate")
            .next()
            .expect("bounded composition resolver");
        let recover = composition
            .find("recover_bound_replay_market_facts_readback_in_transaction_v2")
            .expect("exact binding recovery");
        let native = composition
            .find("validate_replay_market_native_dependencies_read_only_v2")
            .expect("native dependency closure");
        let commit = composition.find(".commit()").expect("read-only commit");
        assert!(recover < native && native < commit);

        for required in [
            "universe_selection_records_v1",
            "load_strategy_input_joined_cut_custody_v1",
            "load_observation_census_v1",
            "rederive_observation_census_read_only_v1",
            "persisted_census != rederived_census",
            "persisted_census.record().identity() != observation.identity()",
            "resolve_strategy_input_sample_projection_v4",
            "row_digest(\"schedule_dependency_set_digest\")?",
            "validate_sample_projection_dependencies_v3",
            ".ok_or(Error::UniverseSelectionUnavailable)",
            ".ok_or(Error::JoinedCutUnavailable)",
            ".ok_or(Error::SampleProjectionUnavailable)",
        ] {
            assert!(owner.contains(required));
        }
    }

    #[test]
    fn resolver_decoder_rejects_unknown_canonical_discriminants() {
        assert_eq!(
            reference_kind(0),
            Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord)
        );
        assert_eq!(
            dependency_kind(9),
            Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord)
        );

        let mut invalid_boolean = Cursor::new(&[2]);
        assert_eq!(
            invalid_boolean.boolean(),
            Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord)
        );
    }
}
