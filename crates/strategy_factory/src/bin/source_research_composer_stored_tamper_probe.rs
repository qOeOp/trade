//! Disposable A2 stored-custody tamper probe.
//!
//! This binary is deliberately feature-gated and has no runtime-selected database surface.  Every
//! intervention is a compile-time statement selected from [`StoredCase::ALL`].  The administrative
//! connection and bearer credential belong only to the short-lived acceptance service.

use anyhow::{Context, Result, anyhow, bail, ensure};
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::{Connection, PgConnection, Row};
use std::{env, fs, os::unix::fs::PermissionsExt, path::Path, time::Duration};

const INPUT_PATH: &str = "/run/source-research-composer-stored-tamper/input.json";
const OWNER_BASE_URL: &str = "http://rd-owner-api:8080";
const ADVISORY_LOCK_KEY: i64 = 0x4132_5354_4f52_4544;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProbeInput {
    schema_version: u16,
    research_request_locators: [String; 2],
}

struct Baseline {
    run: Vec<u8>,
    resolve: Vec<u8>,
}

struct RestoreLease {
    case: StoredCase,
}

impl RestoreLease {
    async fn restore(self, connection: &mut PgConnection) -> Result<()> {
        let mut transaction = connection.begin().await.context("restore transaction")?;
        sqlx::query("SET LOCAL session_replication_role=replica")
            .execute(&mut *transaction)
            .await
            .context("arm bounded restore")?;
        let restored = sqlx::query(self.case.restore_sql())
            .bind(self.case.label())
            .execute(&mut *transaction)
            .await
            .context("restore stored value")?
            .rows_affected();
        ensure!(restored == 1, "restore did not affect exactly one row");
        transaction.commit().await.context("commit restore")?;
        let deleted = sqlx::query("DELETE FROM pg_temp.a2_stored_preimages WHERE selector=$1")
            .bind(self.case.label())
            .execute(&mut *connection)
            .await
            .context("delete consumed preimage")?
            .rows_affected();
        ensure!(deleted == 1, "consumed preimage was not deleted");
        Ok(())
    }
}

macro_rules! stored_cases {
    ($(($variant:ident, $label:literal, $capture:literal, $mutate:literal, $restore:literal, $selected:literal)),+ $(,)?) => {
        #[derive(Clone, Copy)]
        enum StoredCase { $($variant),+ }

        impl StoredCase {
            const ALL: &'static [Self] = &[$(Self::$variant),+];
            fn label(self) -> &'static str { match self { $(Self::$variant => $label),+ } }
            fn capture_sql(self) -> &'static str { match self { $(Self::$variant => $capture),+ } }
            fn mutate_sql(self) -> &'static str { match self { $(Self::$variant => $mutate),+ } }
            fn restore_sql(self) -> &'static str { match self { $(Self::$variant => $restore),+ } }
            fn selected_sql(self) -> &'static str { match self { $(Self::$variant => $selected),+ } }
        }
    };
}

stored_cases!(
    (
        SourceBinding,
        "source_binding",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',b.request_identity),to_jsonb(b.binding_json) FROM public.rd_source_intake_bindings_v1 b JOIN public.rd_research_request_receipts_v1 r ON b.request_identity=r.source_ancestry_locator_json->>'request_identity' WHERE r.request_identity=$1",
        "UPDATE public.rd_source_intake_bindings_v1 b SET binding_json=b.binding_json||'{\"stored_tamper\":true}'::jsonb FROM public.rd_research_request_receipts_v1 r WHERE r.request_identity=$1 AND b.request_identity=r.source_ancestry_locator_json->>'request_identity'",
        "UPDATE public.rd_source_intake_bindings_v1 b SET binding_json=p.original_value FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND b.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(b)::text FROM public.rd_source_intake_bindings_v1 b JOIN public.rd_research_request_receipts_v1 r ON b.request_identity=r.source_ancestry_locator_json->>'request_identity' WHERE r.request_identity=$1"
    ),
    (
        SourceReceipt,
        "source_receipt",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',s.request_identity),to_jsonb(s.receipt_json) FROM public.rd_source_intake_receipts_v1 s JOIN public.rd_research_request_receipts_v1 r ON s.request_identity=r.source_ancestry_locator_json->>'request_identity' WHERE r.request_identity=$1",
        "UPDATE public.rd_source_intake_receipts_v1 s SET receipt_json=s.receipt_json||'{\"stored_tamper\":true}'::jsonb FROM public.rd_research_request_receipts_v1 r WHERE r.request_identity=$1 AND s.request_identity=r.source_ancestry_locator_json->>'request_identity'",
        "UPDATE public.rd_source_intake_receipts_v1 s SET receipt_json=p.original_value FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND s.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(s)::text FROM public.rd_source_intake_receipts_v1 s JOIN public.rd_research_request_receipts_v1 r ON s.request_identity=r.source_ancestry_locator_json->>'request_identity' WHERE r.request_identity=$1"
    ),
    (
        SourceRawPayload,
        "source_raw_payload",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('content_digest',s.content_digest),to_jsonb(s.raw_payload) FROM public.rd_source_raw_payloads_v1 s JOIN public.rd_source_raw_receipt_links_v1 l USING(content_digest) JOIN public.rd_research_request_receipts_v1 r ON l.receipt_identity=r.source_ancestry_locator_json->>'terminal_receipt_identity' WHERE r.request_identity=$1",
        "UPDATE public.rd_source_raw_payloads_v1 s SET raw_payload=s.raw_payload||decode('00','hex') FROM public.rd_source_raw_receipt_links_v1 l,public.rd_research_request_receipts_v1 r WHERE r.request_identity=$1 AND l.receipt_identity=r.source_ancestry_locator_json->>'terminal_receipt_identity' AND s.content_digest=l.content_digest",
        "UPDATE public.rd_source_raw_payloads_v1 s SET raw_payload=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND s.content_digest=p.target_key->>'content_digest'",
        "SELECT to_jsonb(s)::text FROM public.rd_source_raw_payloads_v1 s JOIN public.rd_source_raw_receipt_links_v1 l USING(content_digest) JOIN public.rd_research_request_receipts_v1 r ON l.receipt_identity=r.source_ancestry_locator_json->>'terminal_receipt_identity' WHERE r.request_identity=$1"
    ),
    (
        SourceRawLink,
        "source_raw_link",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('receipt_identity',l.receipt_identity),to_jsonb(l.content_digest) FROM public.rd_source_raw_receipt_links_v1 l JOIN public.rd_research_request_receipts_v1 r ON l.receipt_identity=r.source_ancestry_locator_json->>'terminal_receipt_identity' WHERE r.request_identity=$1",
        "UPDATE public.rd_source_raw_receipt_links_v1 l SET content_digest=l.content_digest||'-stored-tamper' FROM public.rd_research_request_receipts_v1 r WHERE r.request_identity=$1 AND l.receipt_identity=r.source_ancestry_locator_json->>'terminal_receipt_identity'",
        "UPDATE public.rd_source_raw_receipt_links_v1 l SET content_digest=p.original_value#>>'{}' FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND l.receipt_identity=p.target_key->>'receipt_identity'",
        "SELECT to_jsonb(l)::text FROM public.rd_source_raw_receipt_links_v1 l JOIN public.rd_research_request_receipts_v1 r ON l.receipt_identity=r.source_ancestry_locator_json->>'terminal_receipt_identity' WHERE r.request_identity=$1"
    ),
    (
        SourceProvenance,
        "source_provenance",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('receipt_identity',s.receipt_identity),to_jsonb(s.provenance_json) FROM public.rd_research_source_provenance_v1 s JOIN public.rd_research_request_receipts_v1 r ON s.receipt_identity=r.source_ancestry_locator_json->>'terminal_receipt_identity' WHERE r.request_identity=$1",
        "UPDATE public.rd_research_source_provenance_v1 s SET provenance_json=s.provenance_json||'{\"stored_tamper\":true}'::jsonb FROM public.rd_research_request_receipts_v1 r WHERE r.request_identity=$1 AND s.receipt_identity=r.source_ancestry_locator_json->>'terminal_receipt_identity'",
        "UPDATE public.rd_research_source_provenance_v1 s SET provenance_json=p.original_value FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND s.receipt_identity=p.target_key->>'receipt_identity'",
        "SELECT to_jsonb(s)::text FROM public.rd_research_source_provenance_v1 s JOIN public.rd_research_request_receipts_v1 r ON s.receipt_identity=r.source_ancestry_locator_json->>'terminal_receipt_identity' WHERE r.request_identity=$1"
    ),
    (
        SourceCandidate,
        "source_candidate",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('candidate_identity',s.candidate_identity),to_jsonb(s.candidate_json) FROM public.rd_source_candidates_v1 s JOIN public.rd_research_source_provenance_v1 p USING(provenance_identity) JOIN public.rd_research_request_receipts_v1 r ON p.receipt_identity=r.source_ancestry_locator_json->>'terminal_receipt_identity' WHERE r.request_identity=$1",
        "UPDATE public.rd_source_candidates_v1 s SET candidate_json=s.candidate_json||'{\"stored_tamper\":true}'::jsonb FROM public.rd_research_source_provenance_v1 p,public.rd_research_request_receipts_v1 r WHERE r.request_identity=$1 AND p.receipt_identity=r.source_ancestry_locator_json->>'terminal_receipt_identity' AND s.provenance_identity=p.provenance_identity",
        "UPDATE public.rd_source_candidates_v1 s SET candidate_json=p.original_value FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND s.candidate_identity=p.target_key->>'candidate_identity'",
        "SELECT to_jsonb(s)::text FROM public.rd_source_candidates_v1 s JOIN public.rd_research_source_provenance_v1 p USING(provenance_identity) JOIN public.rd_research_request_receipts_v1 r ON p.receipt_identity=r.source_ancestry_locator_json->>'terminal_receipt_identity' WHERE r.request_identity=$1"
    ),
    (
        SourceOutbox,
        "source_outbox",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('event_identity',s.event_identity),to_jsonb(s.payload_json) FROM public.rd_owner_outbox_v1 s JOIN public.rd_research_request_receipts_v1 r ON s.aggregate_identity=r.source_ancestry_locator_json->>'request_identity' WHERE r.request_identity=$1 AND s.event_kind='SOURCE_INTAKE_TERMINATED_V1'",
        "UPDATE public.rd_owner_outbox_v1 s SET payload_json=s.payload_json||'{\"stored_tamper\":true}'::jsonb FROM public.rd_research_request_receipts_v1 r WHERE r.request_identity=$1 AND s.aggregate_identity=r.source_ancestry_locator_json->>'request_identity' AND s.event_kind='SOURCE_INTAKE_TERMINATED_V1'",
        "UPDATE public.rd_owner_outbox_v1 s SET payload_json=p.original_value FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND s.event_identity=p.target_key->>'event_identity'",
        "SELECT to_jsonb(s)::text FROM public.rd_owner_outbox_v1 s JOIN public.rd_research_request_receipts_v1 r ON s.aggregate_identity=r.source_ancestry_locator_json->>'request_identity' WHERE r.request_identity=$1 AND s.event_kind='SOURCE_INTAKE_TERMINATED_V1'"
    ),
    (
        ResearchSemanticDigest,
        "research_semantic_digest",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',request_identity),to_jsonb(semantic_digest) FROM public.rd_research_request_receipts_v1 WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 SET semantic_digest=semantic_digest||'-stored-tamper' WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 r SET semantic_digest=p.original_value#>>'{}' FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND r.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(r)::text FROM public.rd_research_request_receipts_v1 r WHERE request_identity=$1"
    ),
    (
        ResearchRequest,
        "research_request",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',request_identity),to_jsonb(request_json) FROM public.rd_research_request_receipts_v1 WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 SET request_json=request_json||'{\"stored_tamper\":true}'::jsonb WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 r SET request_json=p.original_value FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND r.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(r)::text FROM public.rd_research_request_receipts_v1 r WHERE request_identity=$1"
    ),
    (
        ResearchCustody,
        "research_custody",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',request_identity),to_jsonb(receipt_json) FROM public.rd_research_request_receipts_v1 WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 SET receipt_json=receipt_json||'{\"stored_tamper\":true}'::jsonb WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 r SET receipt_json=p.original_value FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND r.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(r)::text FROM public.rd_research_request_receipts_v1 r WHERE request_identity=$1"
    ),
    (
        ResearchIntent,
        "research_intent",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',request_identity),to_jsonb(intent_json) FROM public.rd_research_request_receipts_v1 WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 SET intent_json=intent_json||'{\"stored_tamper\":true}'::jsonb WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 r SET intent_json=p.original_value FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND r.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(r)::text FROM public.rd_research_request_receipts_v1 r WHERE request_identity=$1"
    ),
    (
        ResearchView,
        "research_view",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',request_identity),to_jsonb(view_json) FROM public.rd_research_request_receipts_v1 WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 SET view_json=view_json||'{\"stored_tamper\":true}'::jsonb WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 r SET view_json=p.original_value FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND r.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(r)::text FROM public.rd_research_request_receipts_v1 r WHERE request_identity=$1"
    ),
    (
        ResearchEvidenceDigest,
        "research_evidence_digest",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',request_identity),to_jsonb(artifact_evidence_digest) FROM public.rd_research_request_receipts_v1 WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 SET artifact_evidence_digest=artifact_evidence_digest||'-stored-tamper' WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 r SET artifact_evidence_digest=p.original_value#>>'{}' FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND r.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(r)::text FROM public.rd_research_request_receipts_v1 r WHERE request_identity=$1"
    ),
    (
        ResearchEvidence,
        "research_evidence",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',request_identity),to_jsonb(artifact_evidence_json) FROM public.rd_research_request_receipts_v1 WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 SET artifact_evidence_json=artifact_evidence_json||'{\"stored_tamper\":true}'::jsonb WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 r SET artifact_evidence_json=p.original_value FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND r.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(r)::text FROM public.rd_research_request_receipts_v1 r WHERE request_identity=$1"
    ),
    (
        ResearchAncestry,
        "research_ancestry",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',request_identity),to_jsonb(source_ancestry_locator_json) FROM public.rd_research_request_receipts_v1 WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 SET source_ancestry_locator_json=source_ancestry_locator_json||'{\"stored_tamper\":true}'::jsonb WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 r SET source_ancestry_locator_json=p.original_value FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND r.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(r)::text FROM public.rd_research_request_receipts_v1 r WHERE request_identity=$1"
    ),
    (
        ResearchAncestryDigest,
        "research_ancestry_digest",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',request_identity),to_jsonb(source_ancestry_evidence_digest) FROM public.rd_research_request_receipts_v1 WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 SET source_ancestry_evidence_digest=source_ancestry_evidence_digest||'-stored-tamper' WHERE request_identity=$1",
        "UPDATE public.rd_research_request_receipts_v1 r SET source_ancestry_evidence_digest=p.original_value#>>'{}' FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND r.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(r)::text FROM public.rd_research_request_receipts_v1 r WHERE request_identity=$1"
    ),
    (
        ComposerDesign,
        "composer_design",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('design_identity',encode(d.design_identity,'hex')),to_jsonb(d.canonical_bytes) FROM composer_private.rd_develop_designs_v2 d JOIN composer_private.rd_develop_plans_v2 p USING(design_identity) JOIN composer_private.rd_develop_artifacts_v2 a USING(plan_digest) JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1",
        "UPDATE composer_private.rd_develop_designs_v2 d SET canonical_bytes=d.canonical_bytes||decode('00','hex') FROM composer_private.rd_develop_plans_v2 p,composer_private.rd_develop_artifacts_v2 a,composer_private.rd_develop_operations_v2 o WHERE o.request_identity=$1 AND a.artifact_identity=o.artifact_identity AND p.plan_digest=a.plan_digest AND d.design_identity=p.design_identity",
        "UPDATE composer_private.rd_develop_designs_v2 d SET canonical_bytes=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND encode(d.design_identity,'hex')=p.target_key->>'design_identity'",
        "SELECT to_jsonb(d)::text FROM composer_private.rd_develop_designs_v2 d JOIN composer_private.rd_develop_plans_v2 p USING(design_identity) JOIN composer_private.rd_develop_artifacts_v2 a USING(plan_digest) JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1"
    ),
    (
        ComposerPlan,
        "composer_plan",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('plan_digest',encode(p.plan_digest,'hex')),to_jsonb(p.canonical_bytes) FROM composer_private.rd_develop_plans_v2 p JOIN composer_private.rd_develop_artifacts_v2 a USING(plan_digest) JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1",
        "UPDATE composer_private.rd_develop_plans_v2 p SET canonical_bytes=p.canonical_bytes||decode('00','hex') FROM composer_private.rd_develop_artifacts_v2 a,composer_private.rd_develop_operations_v2 o WHERE o.request_identity=$1 AND a.artifact_identity=o.artifact_identity AND p.plan_digest=a.plan_digest",
        "UPDATE composer_private.rd_develop_plans_v2 p SET canonical_bytes=decode(substr(x.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages x WHERE x.selector=$1 AND encode(p.plan_digest,'hex')=x.target_key->>'plan_digest'",
        "SELECT to_jsonb(p)::text FROM composer_private.rd_develop_plans_v2 p JOIN composer_private.rd_develop_artifacts_v2 a USING(plan_digest) JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1"
    ),
    (
        ComposerArtifact,
        "composer_artifact",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('artifact_identity',encode(a.artifact_identity,'hex')),to_jsonb(a.package_bytes) FROM composer_private.rd_develop_artifacts_v2 a JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1",
        "UPDATE composer_private.rd_develop_artifacts_v2 a SET package_bytes=a.package_bytes||decode('00','hex') FROM composer_private.rd_develop_operations_v2 o WHERE o.request_identity=$1 AND a.artifact_identity=o.artifact_identity",
        "UPDATE composer_private.rd_develop_artifacts_v2 a SET package_bytes=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND encode(a.artifact_identity,'hex')=p.target_key->>'artifact_identity'",
        "SELECT to_jsonb(a)::text FROM composer_private.rd_develop_artifacts_v2 a JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1"
    ),
    (
        ComposerModule,
        "composer_module",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('artifact_identity',encode(m.artifact_identity,'hex'),'ordinal',m.ordinal),to_jsonb(m.module_bytes) FROM composer_private.rd_develop_artifact_modules_v2 m JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND m.ordinal=0",
        "UPDATE composer_private.rd_develop_artifact_modules_v2 m SET module_bytes=m.module_bytes||decode('00','hex') FROM composer_private.rd_develop_operations_v2 o WHERE o.request_identity=$1 AND m.artifact_identity=o.artifact_identity AND m.ordinal=0",
        "UPDATE composer_private.rd_develop_artifact_modules_v2 m SET module_bytes=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND encode(m.artifact_identity,'hex')=p.target_key->>'artifact_identity' AND m.ordinal=(p.target_key->>'ordinal')::integer",
        "SELECT to_jsonb(m)::text FROM composer_private.rd_develop_artifact_modules_v2 m JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND m.ordinal=0"
    ),
    (
        A0ReceiptIdentity,
        "a0_receipt_identity",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('build_attempt_identity',encode(b.build_attempt_identity,'hex')),to_jsonb(b.receipt_identity) FROM composer_private.rd_develop_build_receipts_v2 b JOIN composer_private.rd_develop_artifact_build_receipt_uses_v2 u USING(receipt_identity) JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND u.ordinal=0",
        "UPDATE composer_private.rd_develop_build_receipts_v2 b SET receipt_identity=set_byte(b.receipt_identity,0,(get_byte(b.receipt_identity,0)+1)%256) FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 u,composer_private.rd_develop_operations_v2 o WHERE o.request_identity=$1 AND u.artifact_identity=o.artifact_identity AND u.ordinal=0 AND b.receipt_identity=u.receipt_identity",
        "UPDATE composer_private.rd_develop_build_receipts_v2 b SET receipt_identity=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND encode(b.build_attempt_identity,'hex')=p.target_key->>'build_attempt_identity'",
        "SELECT to_jsonb(b)::text FROM composer_private.rd_develop_build_receipts_v2 b JOIN composer_private.rd_develop_artifact_build_receipt_uses_v2 u USING(receipt_identity) JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND u.ordinal=0"
    ),
    (
        A0AttemptIdentity,
        "a0_attempt_identity",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('receipt_identity',encode(b.receipt_identity,'hex')),to_jsonb(b.build_attempt_identity) FROM composer_private.rd_develop_build_receipts_v2 b JOIN composer_private.rd_develop_artifact_build_receipt_uses_v2 u USING(receipt_identity) JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND u.ordinal=0",
        "UPDATE composer_private.rd_develop_build_receipts_v2 b SET build_attempt_identity=set_byte(b.build_attempt_identity,0,(get_byte(b.build_attempt_identity,0)+1)%256) FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 u,composer_private.rd_develop_operations_v2 o WHERE o.request_identity=$1 AND u.artifact_identity=o.artifact_identity AND u.ordinal=0 AND b.receipt_identity=u.receipt_identity",
        "UPDATE composer_private.rd_develop_build_receipts_v2 b SET build_attempt_identity=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND encode(b.receipt_identity,'hex')=p.target_key->>'receipt_identity'",
        "SELECT to_jsonb(b)::text FROM composer_private.rd_develop_build_receipts_v2 b JOIN composer_private.rd_develop_artifact_build_receipt_uses_v2 u USING(receipt_identity) JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND u.ordinal=0"
    ),
    (
        A0CapsuleIdentity,
        "a0_capsule_identity",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('receipt_identity',encode(b.receipt_identity,'hex')),to_jsonb(b.capsule_identity) FROM composer_private.rd_develop_build_receipts_v2 b JOIN composer_private.rd_develop_artifact_build_receipt_uses_v2 u USING(receipt_identity) JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND u.ordinal=0",
        "UPDATE composer_private.rd_develop_build_receipts_v2 b SET capsule_identity=set_byte(b.capsule_identity,0,(get_byte(b.capsule_identity,0)+1)%256) FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 u,composer_private.rd_develop_operations_v2 o WHERE o.request_identity=$1 AND u.artifact_identity=o.artifact_identity AND u.ordinal=0 AND b.receipt_identity=u.receipt_identity",
        "UPDATE composer_private.rd_develop_build_receipts_v2 b SET capsule_identity=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND encode(b.receipt_identity,'hex')=p.target_key->>'receipt_identity'",
        "SELECT to_jsonb(b)::text FROM composer_private.rd_develop_build_receipts_v2 b JOIN composer_private.rd_develop_artifact_build_receipt_uses_v2 u USING(receipt_identity) JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND u.ordinal=0"
    ),
    (
        A0PrivateReceipt,
        "a0_private_receipt",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('receipt_identity',encode(b.receipt_identity,'hex')),to_jsonb(b.canonical_bytes) FROM composer_private.rd_develop_build_receipts_v2 b JOIN composer_private.rd_develop_artifact_build_receipt_uses_v2 u USING(receipt_identity) JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND u.ordinal=0",
        "UPDATE composer_private.rd_develop_build_receipts_v2 b SET canonical_bytes=b.canonical_bytes||decode('00','hex') FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 u,composer_private.rd_develop_operations_v2 o WHERE o.request_identity=$1 AND u.artifact_identity=o.artifact_identity AND u.ordinal=0 AND b.receipt_identity=u.receipt_identity",
        "UPDATE composer_private.rd_develop_build_receipts_v2 b SET canonical_bytes=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND encode(b.receipt_identity,'hex')=p.target_key->>'receipt_identity'",
        "SELECT to_jsonb(b)::text FROM composer_private.rd_develop_build_receipts_v2 b JOIN composer_private.rd_develop_artifact_build_receipt_uses_v2 u USING(receipt_identity) JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND u.ordinal=0"
    ),
    (
        ComposerBuildUse,
        "composer_build_use",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('artifact_identity',encode(u.artifact_identity,'hex'),'ordinal',u.ordinal),to_jsonb(u.receipt_identity) FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 u JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND u.ordinal=0",
        "UPDATE composer_private.rd_develop_artifact_build_receipt_uses_v2 u SET receipt_identity=set_byte(u.receipt_identity,0,(get_byte(u.receipt_identity,0)+1)%256) FROM composer_private.rd_develop_operations_v2 o WHERE o.request_identity=$1 AND u.artifact_identity=o.artifact_identity AND u.ordinal=0",
        "UPDATE composer_private.rd_develop_artifact_build_receipt_uses_v2 u SET receipt_identity=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND encode(u.artifact_identity,'hex')=p.target_key->>'artifact_identity' AND u.ordinal=(p.target_key->>'ordinal')::integer",
        "SELECT to_jsonb(u)::text FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 u JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND u.ordinal=0"
    ),
    (
        ComposerBuildUseArtifact,
        "composer_build_use_artifact",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('ordinal',u.ordinal,'receipt_identity',encode(u.receipt_identity,'hex')),to_jsonb(u.artifact_identity) FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 u JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND u.ordinal=0",
        "UPDATE composer_private.rd_develop_artifact_build_receipt_uses_v2 u SET artifact_identity=set_byte(u.artifact_identity,0,(get_byte(u.artifact_identity,0)+1)%256) FROM composer_private.rd_develop_operations_v2 o WHERE o.request_identity=$1 AND u.artifact_identity=o.artifact_identity AND u.ordinal=0",
        "UPDATE composer_private.rd_develop_artifact_build_receipt_uses_v2 u SET artifact_identity=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND u.artifact_identity=set_byte(decode(substr(p.original_value#>>'{}',3),'hex'),0,(get_byte(decode(substr(p.original_value#>>'{}',3),'hex'),0)+1)%256) AND u.ordinal=(p.target_key->>'ordinal')::integer AND encode(u.receipt_identity,'hex')=p.target_key->>'receipt_identity'",
        "SELECT to_jsonb(u)::text FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 u JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND u.ordinal=0"
    ),
    (
        ComposerBuildUseOrdinal,
        "composer_build_use_ordinal",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('artifact_identity',encode(u.artifact_identity,'hex'),'receipt_identity',encode(u.receipt_identity,'hex')),to_jsonb(u.ordinal) FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 u JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND u.ordinal=0",
        "UPDATE composer_private.rd_develop_artifact_build_receipt_uses_v2 u SET ordinal=u.ordinal+1 FROM composer_private.rd_develop_operations_v2 o WHERE o.request_identity=$1 AND u.artifact_identity=o.artifact_identity AND u.ordinal=0",
        "UPDATE composer_private.rd_develop_artifact_build_receipt_uses_v2 u SET ordinal=(p.original_value#>>'{}')::integer FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND encode(u.artifact_identity,'hex')=p.target_key->>'artifact_identity' AND encode(u.receipt_identity,'hex')=p.target_key->>'receipt_identity'",
        "SELECT to_jsonb(u)::text FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 u JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1 AND u.ordinal=0"
    ),
    (
        ComposerReceipt,
        "composer_receipt",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('artifact_identity',encode(c.artifact_identity,'hex')),to_jsonb(c.canonical_bytes) FROM composer_private.rd_develop_composer_receipts_v2 c JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1",
        "UPDATE composer_private.rd_develop_composer_receipts_v2 c SET canonical_bytes=c.canonical_bytes||decode('00','hex') FROM composer_private.rd_develop_operations_v2 o WHERE o.request_identity=$1 AND c.artifact_identity=o.artifact_identity",
        "UPDATE composer_private.rd_develop_composer_receipts_v2 c SET canonical_bytes=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND encode(c.artifact_identity,'hex')=p.target_key->>'artifact_identity'",
        "SELECT to_jsonb(c)::text FROM composer_private.rd_develop_composer_receipts_v2 c JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1"
    ),
    (
        HostReceipt,
        "host_receipt",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('artifact_identity',encode(h.artifact_identity,'hex')),to_jsonb(h.canonical_bytes) FROM composer_private.rd_develop_host_receipts_v2 h JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1",
        "UPDATE composer_private.rd_develop_host_receipts_v2 h SET canonical_bytes=h.canonical_bytes||decode('00','hex') FROM composer_private.rd_develop_operations_v2 o WHERE o.request_identity=$1 AND h.artifact_identity=o.artifact_identity",
        "UPDATE composer_private.rd_develop_host_receipts_v2 h SET canonical_bytes=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND encode(h.artifact_identity,'hex')=p.target_key->>'artifact_identity'",
        "SELECT to_jsonb(h)::text FROM composer_private.rd_develop_host_receipts_v2 h JOIN composer_private.rd_develop_operations_v2 o USING(artifact_identity) WHERE o.request_identity=$1"
    ),
    (
        OperationReceipt,
        "operation_receipt",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',request_identity),to_jsonb(canonical_receipt_bytes) FROM composer_private.rd_develop_operations_v2 WHERE request_identity=$1",
        "UPDATE composer_private.rd_develop_operations_v2 SET canonical_receipt_bytes=canonical_receipt_bytes||decode('00','hex') WHERE request_identity=$1",
        "UPDATE composer_private.rd_develop_operations_v2 o SET canonical_receipt_bytes=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND o.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(o)::text FROM composer_private.rd_develop_operations_v2 o WHERE request_identity=$1"
    ),
    (
        OperationResponse,
        "operation_response",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',request_identity),to_jsonb(response_bytes) FROM composer_private.rd_develop_operations_v2 WHERE request_identity=$1",
        "UPDATE composer_private.rd_develop_operations_v2 SET response_bytes=response_bytes||decode('00','hex') WHERE request_identity=$1",
        "UPDATE composer_private.rd_develop_operations_v2 o SET response_bytes=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND o.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(o)::text FROM composer_private.rd_develop_operations_v2 o WHERE request_identity=$1"
    ),
    (
        RoleAttestation,
        "role_attestation",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',request_identity),to_jsonb(canonical_bytes) FROM composer_private.rd_develop_strategy_design_role_set_attestations_v1 WHERE request_identity=$1",
        "UPDATE composer_private.rd_develop_strategy_design_role_set_attestations_v1 SET canonical_bytes=canonical_bytes||decode('00','hex') WHERE request_identity=$1",
        "UPDATE composer_private.rd_develop_strategy_design_role_set_attestations_v1 r SET canonical_bytes=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND r.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(r)::text FROM composer_private.rd_develop_strategy_design_role_set_attestations_v1 r WHERE request_identity=$1"
    ),
    (
        RoleAttestationDigest,
        "role_attestation_digest",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',request_identity),to_jsonb(attestation_digest) FROM composer_private.rd_develop_strategy_design_role_set_attestations_v1 WHERE request_identity=$1",
        "UPDATE composer_private.rd_develop_strategy_design_role_set_attestations_v1 SET attestation_digest=set_byte(attestation_digest,0,(get_byte(attestation_digest,0)+1)%256) WHERE request_identity=$1",
        "UPDATE composer_private.rd_develop_strategy_design_role_set_attestations_v1 r SET attestation_digest=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND r.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(r)::text FROM composer_private.rd_develop_strategy_design_role_set_attestations_v1 r WHERE request_identity=$1"
    ),
    (
        ComposerOutbox,
        "composer_outbox",
        "INSERT INTO pg_temp.a2_stored_preimages SELECT $2,jsonb_build_object('request_identity',request_identity),to_jsonb(canonical_bytes) FROM composer_private.rd_develop_outbox_v2 WHERE request_identity=$1",
        "UPDATE composer_private.rd_develop_outbox_v2 SET canonical_bytes=canonical_bytes||decode('00','hex') WHERE request_identity=$1",
        "UPDATE composer_private.rd_develop_outbox_v2 o SET canonical_bytes=decode(substr(p.original_value#>>'{}',3),'hex') FROM pg_temp.a2_stored_preimages p WHERE p.selector=$1 AND o.request_identity=p.target_key->>'request_identity'",
        "SELECT to_jsonb(o)::text FROM composer_private.rd_develop_outbox_v2 o WHERE request_identity=$1"
    )
);

const FAMILY_SQL: &str = r#"
SELECT family,row_value FROM (
 SELECT 'source_binding' family,to_jsonb(t)::text row_value FROM public.rd_source_intake_bindings_v1 t
 UNION ALL SELECT 'source_receipt',to_jsonb(t)::text FROM public.rd_source_intake_receipts_v1 t
 UNION ALL SELECT 'source_raw',to_jsonb(t)::text FROM public.rd_source_raw_payloads_v1 t
 UNION ALL SELECT 'source_raw_link',to_jsonb(t)::text FROM public.rd_source_raw_receipt_links_v1 t
 UNION ALL SELECT 'source_provenance',to_jsonb(t)::text FROM public.rd_research_source_provenance_v1 t
 UNION ALL SELECT 'source_candidate',to_jsonb(t)::text FROM public.rd_source_candidates_v1 t
 UNION ALL SELECT 'research',to_jsonb(t)::text FROM public.rd_research_request_receipts_v1 t
 UNION ALL SELECT 'owner_outbox',to_jsonb(t)::text FROM public.rd_owner_outbox_v1 t
 UNION ALL SELECT 'design',to_jsonb(t)::text FROM composer_private.rd_develop_designs_v2 t
 UNION ALL SELECT 'plan',to_jsonb(t)::text FROM composer_private.rd_develop_plans_v2 t
 UNION ALL SELECT 'artifact',to_jsonb(t)::text FROM composer_private.rd_develop_artifacts_v2 t
 UNION ALL SELECT 'module',to_jsonb(t)::text FROM composer_private.rd_develop_artifact_modules_v2 t
 UNION ALL SELECT 'build',to_jsonb(t)::text FROM composer_private.rd_develop_build_receipts_v2 t
 UNION ALL SELECT 'build_use',to_jsonb(t)::text FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 t
 UNION ALL SELECT 'composer_receipt',to_jsonb(t)::text FROM composer_private.rd_develop_composer_receipts_v2 t
 UNION ALL SELECT 'host_receipt',to_jsonb(t)::text FROM composer_private.rd_develop_host_receipts_v2 t
 UNION ALL SELECT 'operation',to_jsonb(t)::text FROM composer_private.rd_develop_operations_v2 t
 UNION ALL SELECT 'role',to_jsonb(t)::text FROM composer_private.rd_develop_strategy_design_role_set_attestations_v1 t
 UNION ALL SELECT 'native',to_jsonb(t)::text FROM composer_private.rd_develop_strategy_design_native_joins_v1 t
 UNION ALL SELECT 'composer_outbox',to_jsonb(t)::text FROM composer_private.rd_develop_outbox_v2 t
) rows ORDER BY family,row_value
"#;

const CATALOG_SQL: &str = r#"
SELECT row_value FROM (
 SELECT concat_ws('|',n.nspname,c.relname,c.relkind,c.relpersistence,c.relowner,c.relacl::text) row_value
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','composer_private') AND (c.relname LIKE 'rd_source_%' OR c.relname LIKE 'rd_research_%' OR c.relname LIKE 'rd_develop_%' OR c.relname='rd_owner_outbox_v1')
 UNION ALL
 SELECT concat_ws('|',n.nspname,c.relname,t.tgname,t.tgenabled,t.tgisinternal,pg_catalog.pg_get_triggerdef(t.oid))
 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','composer_private') AND (c.relname LIKE 'rd_source_%' OR c.relname LIKE 'rd_research_%' OR c.relname LIKE 'rd_develop_%' OR c.relname='rd_owner_outbox_v1')
) facts ORDER BY row_value
"#;

#[tokio::main]
async fn main() -> Result<()> {
    let input = read_input(Path::new(INPUT_PATH))?;
    let database_url = secret("SEALED_POSTGRES_ADMIN_DATABASE_URL")?;
    let bearer = secret("SEALED_STORED_TAMPER_OWNER_BEARER_TOKEN")?;
    let mut connection = PgConnection::connect(&database_url)
        .await
        .context("connect disposable PostgreSQL")?;
    sqlx::query("SET lock_timeout='5s'")
        .execute(&mut connection)
        .await
        .context("bound database lock wait")?;
    sqlx::query("SET statement_timeout='15s'")
        .execute(&mut connection)
        .await
        .context("bound database statement time")?;
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(ADVISORY_LOCK_KEY)
        .execute(&mut connection)
        .await
        .context("acquire stored-tamper lock")?;
    sqlx::query("CREATE TEMP TABLE a2_stored_preimages(selector text PRIMARY KEY,target_key jsonb NOT NULL,original_value jsonb NOT NULL) ON COMMIT PRESERVE ROWS")
        .execute(&mut connection)
        .await
        .context("create private preimage table")?;

    let client = Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30))
        .build()
        .context("build Owner client")?;
    let mut baselines = Vec::with_capacity(2);
    let mut request_identities = Vec::with_capacity(2);
    for locator in &input.research_request_locators {
        let request_identity = projected_request_identity(&client, &bearer, locator).await?;
        baselines.push(ordinary_baseline(&client, &bearer, locator, &request_identity).await?);
        request_identities.push(request_identity);
    }
    let family_baseline = digest_rows(&mut connection, FAMILY_SQL).await?;
    let catalog_baseline = digest_rows(&mut connection, CATALOG_SQL).await?;
    let census_baseline = census(&mut connection).await?;
    let a0_baseline = a0_count(&client, &bearer).await?;

    let locator = &input.research_request_locators[0];
    let request_identity = &request_identities[0];
    let mut unavailable = 0usize;
    let mut submitted_unknown = 0usize;
    for case in StoredCase::ALL.iter().copied() {
        let key = if matches!(
            case,
            StoredCase::SourceBinding
                | StoredCase::SourceReceipt
                | StoredCase::SourceRawPayload
                | StoredCase::SourceRawLink
                | StoredCase::SourceProvenance
                | StoredCase::SourceCandidate
                | StoredCase::SourceOutbox
                | StoredCase::ResearchSemanticDigest
                | StoredCase::ResearchRequest
                | StoredCase::ResearchCustody
                | StoredCase::ResearchIntent
                | StoredCase::ResearchView
                | StoredCase::ResearchEvidenceDigest
                | StoredCase::ResearchEvidence
                | StoredCase::ResearchAncestry
                | StoredCase::ResearchAncestryDigest
        ) {
            locator
        } else {
            request_identity
        };
        let selected_before = selected_row_digest(&mut connection, case, key).await?;
        let mut transaction = connection.begin().await.context("tamper transaction")?;
        let captured = sqlx::query(case.capture_sql())
            .bind(key)
            .bind(case.label())
            .execute(&mut *transaction)
            .await
            .context("capture exact preimage")?
            .rows_affected();
        ensure!(captured == 1, "selector did not capture exactly one row");
        sqlx::query("SET LOCAL session_replication_role=replica")
            .execute(&mut *transaction)
            .await
            .context("arm bounded mutation")?;
        let changed = sqlx::query(case.mutate_sql())
            .bind(key)
            .execute(&mut *transaction)
            .await
            .context("apply one-column mutation")?
            .rows_affected();
        ensure!(changed == 1, "selector did not mutate exactly one row");
        transaction
            .commit()
            .await
            .context("commit one-column mutation")?;
        let lease = RestoreLease { case };

        let probe_result = async {
            ensure!(
                census(&mut connection).await? == census_baseline,
                "tamper changed positive census"
            );
            ensure!(
                a0_count(&client, &bearer).await? == a0_baseline,
                "tamper changed A0 census before Owner calls"
            );
            let run = owner_run(&client, &bearer, locator).await?;
            let resolve = owner_resolve(&client, &bearer, request_identity).await?;
            for disposition in [run, resolve] {
                match disposition {
                    FailureDisposition::Unavailable => unavailable += 1,
                    FailureDisposition::SubmittedOrUnknown => submitted_unknown += 1,
                }
            }
            ensure!(
                census(&mut connection).await? == census_baseline,
                "Owner calls changed positive census"
            );
            ensure!(
                a0_count(&client, &bearer).await? == a0_baseline,
                "Owner calls changed A0 census"
            );
            Ok::<(), anyhow::Error>(())
        }
        .await;

        if let Err(error) = lease.restore(&mut connection).await {
            return Err(error.context("mandatory restore failed; stopping whole probe"));
        }
        probe_result?;
        ensure!(
            selected_row_digest(&mut connection, case, key).await? == selected_before,
            "selected row did not restore byte-exactly"
        );
        ensure!(
            digest_rows(&mut connection, FAMILY_SQL).await? == family_baseline,
            "family digest did not restore"
        );
        ensure!(
            digest_rows(&mut connection, CATALOG_SQL).await? == catalog_baseline,
            "trigger or ACL catalog changed"
        );
        ensure!(
            census(&mut connection).await? == census_baseline,
            "restored positive census differs"
        );
        for index in 0..2 {
            assert_ordinary_baseline(
                &client,
                &bearer,
                &input.research_request_locators[index],
                &request_identities[index],
                &baselines[index],
            )
            .await?;
        }
    }

    sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(ADVISORY_LOCK_KEY)
        .execute(&mut connection)
        .await
        .context("release stored-tamper lock")?;
    println!(
        "stored_tamper_cases={} owner_unavailable={} owner_submitted_or_unknown={} restored={} baseline_matches={}",
        StoredCase::ALL.len(),
        unavailable,
        submitted_unknown,
        StoredCase::ALL.len(),
        StoredCase::ALL.len() * 4
    );
    Ok(())
}

fn read_input(path: &Path) -> Result<ProbeInput> {
    let metadata = fs::metadata(path).context("inspect bounded input")?;
    ensure!(
        metadata.permissions().mode() & 0o777 == 0o600,
        "input must have mode 0600"
    );
    ensure!(metadata.len() <= 2048, "input exceeds bounded size");
    let input: ProbeInput = serde_json::from_slice(&fs::read(path).context("read bounded input")?)
        .context("parse bounded input")?;
    ensure!(input.schema_version == 1, "unsupported input schema");
    ensure!(
        input.research_request_locators[0] != input.research_request_locators[1],
        "locators must be distinct"
    );
    for locator in &input.research_request_locators {
        ensure!(
            !locator.is_empty() && locator.len() <= 256 && !locator.chars().any(char::is_control),
            "invalid locator"
        );
    }
    Ok(input)
}

fn secret(name: &str) -> Result<String> {
    let value = env::var(name).map_err(|_| anyhow!("required secret is unavailable"))?;
    ensure!(!value.is_empty(), "required secret is empty");
    Ok(value)
}

async fn projected_request_identity(
    client: &Client,
    bearer: &str,
    locator: &str,
) -> Result<String> {
    let response = client
        .get(format!(
            "{OWNER_BASE_URL}/v2/develop-composer/request-projections"
        ))
        .bearer_auth(bearer)
        .query(&[("research_request_locator", locator)])
        .send()
        .await
        .context("request Owner projection")?;
    ensure!(
        response.status() == StatusCode::OK,
        "Owner projection unavailable"
    );
    let value: serde_json::Value = response.json().await.context("parse Owner projection")?;
    value
        .get("request_identity")
        .and_then(serde_json::Value::as_str)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| anyhow!("Owner projection omitted request identity"))
}

async fn ordinary_baseline(
    client: &Client,
    bearer: &str,
    locator: &str,
    request: &str,
) -> Result<Baseline> {
    let run = owner_success_bytes(
        client
            .post(format!("{OWNER_BASE_URL}/v2/develop-composer/runs"))
            .bearer_auth(bearer)
            .json(&serde_json::json!({"research_request_locator":locator})),
    )
    .await?;
    let resolve = owner_success_bytes(
        client
            .post(format!(
                "{OWNER_BASE_URL}/v2/develop-composer/runs/{request}/resolve"
            ))
            .bearer_auth(bearer),
    )
    .await?;
    Ok(Baseline { run, resolve })
}

async fn assert_ordinary_baseline(
    client: &Client,
    bearer: &str,
    locator: &str,
    request: &str,
    baseline: &Baseline,
) -> Result<()> {
    let observed = ordinary_baseline(client, bearer, locator, request).await?;
    ensure!(
        observed.run == baseline.run && observed.resolve == baseline.resolve,
        "ordinary Owner response changed after restore"
    );
    Ok(())
}

async fn owner_success_bytes(builder: reqwest::RequestBuilder) -> Result<Vec<u8>> {
    let response = builder
        .send()
        .await
        .context("call ordinary Owner endpoint")?;
    ensure!(
        response.status() == StatusCode::OK,
        "ordinary Owner endpoint was not successful"
    );
    let bytes = response
        .bytes()
        .await
        .context("read ordinary Owner response")?
        .to_vec();
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).context("parse ordinary Owner response")?;
    ensure!(
        value.get("disposition").and_then(serde_json::Value::as_str) == Some("SUCCESS"),
        "ordinary Owner response was not SUCCESS"
    );
    Ok(bytes)
}

enum FailureDisposition {
    Unavailable,
    SubmittedOrUnknown,
}

async fn owner_run(client: &Client, bearer: &str, locator: &str) -> Result<FailureDisposition> {
    failure_disposition(
        client
            .post(format!("{OWNER_BASE_URL}/v2/develop-composer/runs"))
            .bearer_auth(bearer)
            .json(&serde_json::json!({"research_request_locator":locator})),
    )
    .await
}

async fn owner_resolve(client: &Client, bearer: &str, request: &str) -> Result<FailureDisposition> {
    failure_disposition(
        client
            .post(format!(
                "{OWNER_BASE_URL}/v2/develop-composer/runs/{request}/resolve"
            ))
            .bearer_auth(bearer),
    )
    .await
}

async fn failure_disposition(builder: reqwest::RequestBuilder) -> Result<FailureDisposition> {
    let response = builder
        .send()
        .await
        .context("call tampered Owner endpoint")?;
    let status = response.status();
    let value: serde_json::Value = response
        .json()
        .await
        .context("parse tampered Owner response")?;
    ensure!(
        value
            .get("receipt_identity")
            .is_none_or(serde_json::Value::is_null)
            && value.get("artifact").is_none_or(serde_json::Value::is_null),
        "tampered Owner returned positive custody"
    );
    match (
        status,
        value.get("disposition").and_then(serde_json::Value::as_str),
    ) {
        (StatusCode::SERVICE_UNAVAILABLE, Some("UNAVAILABLE")) => {
            Ok(FailureDisposition::Unavailable)
        }
        (StatusCode::ACCEPTED, Some("SUBMITTED_OR_UNKNOWN")) => {
            Ok(FailureDisposition::SubmittedOrUnknown)
        }
        _ => bail!("tampered Owner returned forbidden disposition"),
    }
}

async fn selected_row_digest(
    connection: &mut PgConnection,
    case: StoredCase,
    key: &str,
) -> Result<[u8; 32]> {
    let rows = sqlx::query(case.selected_sql())
        .bind(key)
        .fetch_all(connection)
        .await
        .context("read selected row")?;
    ensure!(
        rows.len() == 1,
        "selector did not resolve exactly one stored row"
    );
    let value: String = rows[0].try_get(0).context("decode selected row")?;
    Ok(Sha256::digest(value.as_bytes()).into())
}

async fn digest_rows(connection: &mut PgConnection, sql: &'static str) -> Result<[u8; 32]> {
    let rows = sqlx::query(sql)
        .fetch_all(connection)
        .await
        .context("read fixed digest surface")?;
    let mut digest = Sha256::new();
    for row in rows {
        for index in 0..row.len() {
            let value: String = row.try_get(index).context("decode digest surface")?;
            digest.update((value.len() as u64).to_be_bytes());
            digest.update(value.as_bytes());
        }
    }
    Ok(digest.finalize().into())
}

async fn census(connection: &mut PgConnection) -> Result<Vec<i64>> {
    let row = sqlx::query("SELECT (SELECT count(*) FROM public.rd_research_request_receipts_v1),(SELECT count(*) FROM composer_private.rd_develop_designs_v2),(SELECT count(*) FROM composer_private.rd_develop_plans_v2),(SELECT count(*) FROM composer_private.rd_develop_artifacts_v2),(SELECT count(*) FROM composer_private.rd_develop_artifact_modules_v2),(SELECT count(*) FROM composer_private.rd_develop_build_receipts_v2),(SELECT count(*) FROM composer_private.rd_develop_artifact_build_receipt_uses_v2),(SELECT count(*) FROM composer_private.rd_develop_composer_receipts_v2),(SELECT count(*) FROM composer_private.rd_develop_host_receipts_v2),(SELECT count(*) FROM composer_private.rd_develop_operations_v2),(SELECT count(*) FROM composer_private.rd_develop_strategy_design_role_set_attestations_v1),(SELECT count(*) FROM composer_private.rd_develop_strategy_design_native_joins_v1),(SELECT count(*) FROM composer_private.rd_develop_outbox_v2)")
        .fetch_one(connection).await.context("read positive census")?;
    (0..row.len())
        .map(|index| row.try_get(index).context("decode positive census"))
        .collect()
}

async fn a0_count(client: &Client, bearer: &str) -> Result<u64> {
    let response = client
        .get(format!(
            "{OWNER_BASE_URL}/_sealed-acceptance/v1/develop-composer/a0-executions"
        ))
        .bearer_auth(bearer)
        .send()
        .await
        .context("read A0 census")?;
    ensure!(response.status() == StatusCode::OK, "A0 census unavailable");
    let value: serde_json::Value = response.json().await.context("parse A0 census")?;
    value
        .get("a0_executions")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| anyhow!("invalid A0 census"))
}
