//! Disposable A2 stored-custody tamper probe.
//!
//! This binary is deliberately feature-gated and has no runtime-selected database surface.  Every
//! intervention is a compile-time statement selected from [`StoredCase::ALL`]. Database access
//! requires dedicated test admission; only the disposable harness installs the fixed fault ports.

use anyhow::Context;
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::PgConnection;
use std::{env, fs, os::unix::fs::PermissionsExt, path::Path, time::Duration};
use vibe_testkit::postgres::DedicatedPostgresTestDatabase;

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
    marker: String,
}

impl RestoreLease {
    async fn restore(self, connection: &mut PgConnection) -> anyhow::Result<()> {
        port(connection, &self.marker, "restore", self.case.label(), "").await?;
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

const CENSUS_SQL: &str = "SELECT ARRAY[(SELECT count(*) FROM public.rd_research_request_receipts_v1),(SELECT count(*) FROM composer_private.rd_develop_designs_v2),(SELECT count(*) FROM composer_private.rd_develop_plans_v2),(SELECT count(*) FROM composer_private.rd_develop_artifacts_v2),(SELECT count(*) FROM composer_private.rd_develop_artifact_modules_v2),(SELECT count(*) FROM composer_private.rd_develop_build_receipts_v2),(SELECT count(*) FROM composer_private.rd_develop_artifact_build_receipt_uses_v2),(SELECT count(*) FROM composer_private.rd_develop_composer_receipts_v2),(SELECT count(*) FROM composer_private.rd_develop_host_receipts_v2),(SELECT count(*) FROM composer_private.rd_develop_operations_v2),(SELECT count(*) FROM composer_private.rd_develop_strategy_design_role_set_attestations_v1),(SELECT count(*) FROM composer_private.rd_develop_strategy_design_native_joins_v1),(SELECT count(*) FROM composer_private.rd_develop_outbox_v2)]::text[]";

async fn port(
    connection: &mut PgConnection,
    marker: &str,
    operation: &str,
    selector: &str,
    key: &str,
) -> anyhow::Result<Vec<Vec<String>>> {
    sqlx::query_scalar("SELECT * FROM vibe_test_admin.a2_stored_port_v1($1,$2,$3,$4)")
        .bind(marker)
        .bind(operation)
        .bind(selector)
        .bind(key)
        .fetch_all(connection)
        .await
        .context("closed stored-tamper port rejected")
}

// This generator has no input, connection, or environment access. psql binds the independently
// generated identity only in setup DDL; executable fault statements come solely from StoredCase.
fn install_sql() -> anyhow::Result<String> {
    anyhow::ensure!(
        StoredCase::ALL.len() == 34,
        "stored selector domain changed"
    );
    let mut sql = String::from(
        r#"
\set ON_ERROR_STOP on
SELECT 1 / ((session_user='postgres' AND current_user='postgres'
  AND pg_catalog.current_database()=:'test_database' AND :'test_database' ~ '^vibe_test_[0-9a-f]+$'
  AND :'test_role' ~ '^vibe_test_role_[0-9a-f]+$' AND :'test_marker' ~ '^[0-9a-f]{48}$')::integer);
BEGIN;
CREATE ROLE :"test_role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'test_password';
CREATE SCHEMA vibe_test_admin AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA vibe_test_admin FROM PUBLIC;
CREATE TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 (
  marker_identity text NOT NULL, database_name text NOT NULL, test_role text PRIMARY KEY
);
ALTER TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 OWNER TO postgres;
REVOKE ALL ON TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 FROM PUBLIC;
INSERT INTO vibe_test_admin.dedicated_postgres_test_instance_v1 VALUES (:'test_marker', :'test_database', :'test_role');
GRANT USAGE ON SCHEMA vibe_test_admin TO :"test_role";
GRANT SELECT ON TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 TO :"test_role";
CREATE TABLE vibe_test_admin.a2_stored_preimages (
  selector text NOT NULL, target_key jsonb NOT NULL, original_value jsonb NOT NULL,
  backend_pid integer NOT NULL,
  backend_start timestamptz NOT NULL,
  PRIMARY KEY (backend_pid,backend_start,selector)
);
ALTER TABLE vibe_test_admin.a2_stored_preimages OWNER TO postgres;
REVOKE ALL ON TABLE vibe_test_admin.a2_stored_preimages FROM PUBLIC;
CREATE FUNCTION vibe_test_admin.a2_stored_port_v1(expected_marker text, operation text, selector text, row_key text)
RETURNS SETOF text[] LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog
SET session_replication_role = origin
AS $port$
DECLARE capture_sql text; mutate_sql text; restore_sql text; selected_sql text; affected bigint;
BEGIN
  IF current_user <> 'postgres' OR NOT EXISTS (
    SELECT 1 FROM vibe_test_admin.dedicated_postgres_test_instance_v1 m
    JOIN pg_catalog.pg_roles r ON r.rolname=m.test_role
    WHERE m.test_role=session_user AND m.database_name=pg_catalog.current_database()
      AND m.marker_identity=expected_marker
      AND m.database_name ~ '^vibe_test_[0-9a-f]+$' AND m.test_role ~ '^vibe_test_role_[0-9a-f]+$'
      AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolreplication OR r.rolbypassrls)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members a WHERE a.member=r.oid)
  ) OR (SELECT count(*) FROM vibe_test_admin.dedicated_postgres_test_instance_v1) <> 1
  OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    WHERE n.nspname='vibe_test_admin' AND pg_catalog.pg_get_userbyid(n.nspowner)='postgres'
  ) OR (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='vibe_test_admin' AND c.relname IN ('dedicated_postgres_test_instance_v1','a2_stored_preimages')
          AND c.relkind='r' AND c.relpersistence='p' AND pg_catalog.pg_get_userbyid(c.relowner)='postgres') <> 2
  OR pg_catalog.has_schema_privilege(session_user,'vibe_test_admin','CREATE')
  OR pg_catalog.has_database_privilege(session_user,pg_catalog.current_database(),'CREATE,TEMPORARY')
  OR pg_catalog.has_table_privilege(session_user,'vibe_test_admin.dedicated_postgres_test_instance_v1','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  OR pg_catalog.has_table_privilege(session_user,'vibe_test_admin.a2_stored_preimages','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  THEN RAISE EXCEPTION 'stored-tamper admission guard rejected' USING ERRCODE='42501'; END IF;
  IF operation IS NULL OR selector IS NULL OR row_key IS NULL THEN
    RAISE EXCEPTION 'null stored-tamper operation input' USING ERRCODE='22023';
  END IF;
  IF operation='guard' AND selector='' AND row_key='' THEN RETURN; END IF;
  IF operation NOT IN ('mutate','restore','selected','family','catalog','census') THEN
    RAISE EXCEPTION 'invalid stored-tamper operation' USING ERRCODE='22023';
  END IF;
  IF operation IN ('mutate','restore','selected') THEN
    CASE selector
"#,
    );

    for case in StoredCase::ALL.iter().copied() {
        anyhow::ensure!(
            case.capture_sql()
                .starts_with("INSERT INTO pg_temp.a2_stored_preimages SELECT $2,")
                && case
                    .capture_sql()
                    .matches("pg_temp.a2_stored_preimages")
                    .count()
                    == 1
                && case
                    .restore_sql()
                    .matches("pg_temp.a2_stored_preimages")
                    .count()
                    == 1
                && case.restore_sql().matches(".selector=$1").count() == 1,
            "stored specification cannot receive exact private preimage scope"
        );
        let capture = case.capture_sql().replace("pg_temp.a2_stored_preimages", "vibe_test_admin.a2_stored_preimages(backend_pid,backend_start,selector,target_key,original_value)")
            .replacen("SELECT $2,", "SELECT pg_catalog.pg_backend_pid(),(SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid=pg_catalog.pg_backend_pid()),$2,", 1);
        let restore = case.restore_sql().replace("pg_temp.a2_stored_preimages",
            "(SELECT selector,target_key,original_value FROM vibe_test_admin.a2_stored_preimages WHERE backend_pid=pg_catalog.pg_backend_pid() AND backend_start=(SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid=pg_catalog.pg_backend_pid()))");
        sql.push_str(&format!("WHEN '{}' THEN capture_sql := {}; mutate_sql := {}; restore_sql := {}; selected_sql := {};\n",
            case.label(), sql_literal(&capture), sql_literal(case.mutate_sql()), sql_literal(&restore),
            sql_literal(&format!("SELECT ARRAY[value] FROM ({}) selected(value)", case.selected_sql()))));
    }
    sql.push_str(r#"
    ELSE RAISE EXCEPTION 'invalid stored-tamper selector' USING ERRCODE='22023';
    END CASE;
  ELSIF selector<>'' OR row_key<>'' THEN
    RAISE EXCEPTION 'unexpected stored-tamper row key' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks l WHERE l.locktype='advisory' AND l.pid=pg_catalog.pg_backend_pid()
      AND l.database=(SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database())
      AND l.classid=1093817172::oid AND l.objid=1330791748::oid AND l.objsubid=1
      AND l.mode='ExclusiveLock' AND l.granted
  ) THEN RAISE EXCEPTION 'stored-tamper session lock absent' USING ERRCODE='42501'; END IF;
  CASE operation
  WHEN 'mutate' THEN
    EXECUTE capture_sql USING row_key,selector;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>1 THEN RAISE EXCEPTION 'capture must affect exactly one row'; END IF;
    PERFORM pg_catalog.set_config('session_replication_role','replica',true);
    EXECUTE mutate_sql USING row_key;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>1 THEN RAISE EXCEPTION 'mutation must affect exactly one row'; END IF;
  WHEN 'restore' THEN
    PERFORM pg_catalog.set_config('session_replication_role','replica',true);
    EXECUTE restore_sql USING selector;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>1 THEN RAISE EXCEPTION 'restore must affect exactly one row'; END IF;
    DELETE FROM vibe_test_admin.a2_stored_preimages p WHERE p.selector=a2_stored_port_v1.selector
      AND p.backend_pid=pg_catalog.pg_backend_pid()
      AND p.backend_start=(SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid=pg_catalog.pg_backend_pid());
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>1 THEN RAISE EXCEPTION 'restore must delete exactly one preimage'; END IF;
  WHEN 'selected' THEN RETURN QUERY EXECUTE selected_sql USING row_key;
"#);

    for (operation, statement) in [
        (
            "family",
            format!("SELECT ARRAY[family,row_value] FROM ({FAMILY_SQL}) digest"),
        ),
        (
            "catalog",
            format!("SELECT ARRAY[row_value] FROM ({CATALOG_SQL}) digest"),
        ),
        ("census", CENSUS_SQL.to_owned()),
    ] {
        sql.push_str(&format!(
            "WHEN '{operation}' THEN RETURN QUERY EXECUTE {};\n",
            sql_literal(&statement)
        ));
    }
    sql.push_str(
        r#"
  ELSE RAISE EXCEPTION 'invalid stored-tamper operation' USING ERRCODE='22023';
  END CASE;
END
$port$;
ALTER FUNCTION vibe_test_admin.a2_stored_port_v1(text,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION vibe_test_admin.a2_stored_port_v1(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.a2_stored_port_v1(text,text,text,text) TO :"test_role";
COMMIT;
"#,
    );
    anyhow::ensure!(
        !sql.contains("pg_temp"),
        "generated port trusts temporary objects"
    );
    Ok(sql)
}

fn sql_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args == ["--emit-install-sql"] {
        print!("{}", install_sql()?);
        return Ok(());
    }
    anyhow::ensure!(
        args.is_empty() || args == ["--admission-only"] || args == ["--check-invalid-ports"],
        "unsupported probe mode"
    );
    let database = DedicatedPostgresTestDatabase::admit("RD_OWNER_TEST_DATABASE_URL")
        .await
        .context("dedicated test admission rejected")?;
    let mutation = database.mutation();
    let marker = mutation.marker_identity();
    let mut connection = mutation
        .pool()
        .acquire()
        .await
        .context("acquire admitted connection")?;
    port(&mut connection, marker, "guard", "", "").await?;

    if args == ["--admission-only"] {
        println!("stored_tamper_admission=accepted");
        return Ok(());
    }
    sqlx::query("SET lock_timeout='5s'")
        .execute(&mut *connection)
        .await
        .context("bound database lock wait")?;
    sqlx::query("SET statement_timeout='15s'")
        .execute(&mut *connection)
        .await
        .context("bound database statement time")?;
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(ADVISORY_LOCK_KEY)
        .execute(&mut *connection)
        .await
        .context("acquire stored-tamper lock")?;

    if args == ["--check-invalid-ports"] {
        let family_before = digest_rows(&mut connection, marker, "family").await?;
        let catalog_before = digest_rows(&mut connection, marker, "catalog").await?;
        let census_before = census(&mut connection, marker).await?;

        for (operation, selector) in [
            ("invalid", ""),
            ("mutate", "invalid"),
            ("restore", "invalid"),
            ("selected", "invalid"),
        ] {
            let error = port(&mut connection, marker, operation, selector, "")
                .await
                .err()
                .ok_or_else(|| anyhow::anyhow!("invalid fault port was admitted"))?;
            anyhow::ensure!(
                error.chain().any(
                    |cause| cause.downcast_ref::<sqlx::Error>().is_some_and(|e| e
                        .as_database_error()
                        .is_some_and(|e| e.code().as_deref() == Some("22023")))
                ),
                "invalid fault port failed for an unrelated reason"
            );
        }
        anyhow::ensure!(
            digest_rows(&mut connection, marker, "family").await? == family_before,
            "invalid ports changed stored bytes"
        );
        anyhow::ensure!(
            digest_rows(&mut connection, marker, "catalog").await? == catalog_before,
            "invalid ports changed Owner rights"
        );
        anyhow::ensure!(
            census(&mut connection, marker).await? == census_before,
            "invalid ports changed positive census"
        );
        println!("stored_tamper_invalid_ports=rejected");
        return Ok(());
    }
    let input = read_input(Path::new(INPUT_PATH))?;
    let bearer = secret("SEALED_STORED_TAMPER_OWNER_BEARER_TOKEN")?;

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
    let family_baseline = digest_rows(&mut connection, marker, "family").await?;
    let catalog_baseline = digest_rows(&mut connection, marker, "catalog").await?;
    let census_baseline = census(&mut connection, marker).await?;
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
        let selected_before = selected_row_digest(&mut connection, marker, case, key).await?;
        port(&mut connection, marker, "mutate", case.label(), key).await?;
        let lease = RestoreLease {
            case,
            marker: marker.to_owned(),
        };

        let probe_result = async {
            anyhow::ensure!(
                census(&mut connection, marker).await? == census_baseline,
                "tamper changed positive census"
            );
            anyhow::ensure!(
                a0_count(&client, &bearer).await? == a0_baseline,
                "tamper changed A0 census before Owner calls"
            );
            let run = owner_run(&client, &bearer, locator)
                .await
                .context("stored-custody RUN")?;
            let resolve = owner_resolve(&client, &bearer, request_identity)
                .await
                .context("stored-custody RESOLVE")?;

            for disposition in [run, resolve] {
                match disposition {
                    FailureDisposition::Unavailable => unavailable += 1,
                    FailureDisposition::SubmittedOrUnknown => submitted_unknown += 1,
                }
            }
            anyhow::ensure!(
                census(&mut connection, marker).await? == census_baseline,
                "Owner calls changed positive census"
            );
            anyhow::ensure!(
                a0_count(&client, &bearer).await? == a0_baseline,
                "Owner calls changed A0 census"
            );
            Ok::<(), anyhow::Error>(())
        }
        .await;

        if let Err(e) = lease.restore(&mut connection).await {
            return Err(e.context("mandatory restore failed; stopping whole probe"));
        }
        probe_result.with_context(|| format!("stored-custody selector {}", case.label()))?;
        anyhow::ensure!(
            selected_row_digest(&mut connection, marker, case, key).await? == selected_before,
            "selected row did not restore byte-exactly"
        );
        anyhow::ensure!(
            digest_rows(&mut connection, marker, "family").await? == family_baseline,
            "family digest did not restore"
        );
        anyhow::ensure!(
            digest_rows(&mut connection, marker, "catalog").await? == catalog_baseline,
            "trigger or ACL catalog changed"
        );
        anyhow::ensure!(
            census(&mut connection, marker).await? == census_baseline,
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
        .execute(&mut *connection)
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

fn read_input(path: &Path) -> anyhow::Result<ProbeInput> {
    let metadata = fs::metadata(path).context("inspect bounded input")?;
    anyhow::ensure!(
        metadata.permissions().mode() & 0o777 == 0o600,
        "input must have mode 0600"
    );
    anyhow::ensure!(metadata.len() <= 2048, "input exceeds bounded size");
    let input: ProbeInput = serde_json::from_slice(&fs::read(path).context("read bounded input")?)
        .context("parse bounded input")?;
    anyhow::ensure!(input.schema_version == 1, "unsupported input schema");
    anyhow::ensure!(
        input.research_request_locators[0] != input.research_request_locators[1],
        "locators must be distinct"
    );

    for locator in &input.research_request_locators {
        anyhow::ensure!(
            !locator.is_empty() && locator.len() <= 256 && !locator.chars().any(char::is_control),
            "invalid locator"
        );
    }
    Ok(input)
}

fn secret(name: &str) -> anyhow::Result<String> {
    let value = env::var(name).map_err(|_| anyhow::anyhow!("required secret is unavailable"))?;
    anyhow::ensure!(!value.is_empty(), "required secret is empty");
    Ok(value)
}

async fn projected_request_identity(
    client: &Client,
    bearer: &str,
    locator: &str,
) -> anyhow::Result<String> {
    let response = client
        .get(format!(
            "{OWNER_BASE_URL}/v2/develop-composer/request-projections"
        ))
        .bearer_auth(bearer)
        .query(&[("research_request_locator", locator)])
        .send()
        .await
        .context("request Owner projection")?;
    anyhow::ensure!(
        response.status() == StatusCode::OK,
        "Owner projection unavailable"
    );
    let value: serde_json::Value = response.json().await.context("parse Owner projection")?;
    value
        .get("request_identity")
        .and_then(serde_json::Value::as_str)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| anyhow::anyhow!("Owner projection omitted request identity"))
}

async fn ordinary_baseline(
    client: &Client,
    bearer: &str,
    locator: &str,
    request: &str,
) -> anyhow::Result<Baseline> {
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
) -> anyhow::Result<()> {
    let observed = ordinary_baseline(client, bearer, locator, request).await?;
    anyhow::ensure!(
        observed.run == baseline.run && observed.resolve == baseline.resolve,
        "ordinary Owner response changed after restore"
    );
    Ok(())
}

async fn owner_success_bytes(builder: reqwest::RequestBuilder) -> anyhow::Result<Vec<u8>> {
    let response = builder
        .send()
        .await
        .context("call ordinary Owner endpoint")?;
    anyhow::ensure!(
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
    anyhow::ensure!(
        value.get("disposition").and_then(serde_json::Value::as_str) == Some("SUCCESS"),
        "ordinary Owner response was not SUCCESS"
    );
    Ok(bytes)
}

enum FailureDisposition {
    Unavailable,
    SubmittedOrUnknown,
}

async fn owner_run(
    client: &Client,
    bearer: &str,
    locator: &str,
) -> anyhow::Result<FailureDisposition> {
    failure_disposition(
        client
            .post(format!("{OWNER_BASE_URL}/v2/develop-composer/runs"))
            .bearer_auth(bearer)
            .json(&serde_json::json!({"research_request_locator":locator})),
    )
    .await
}

async fn owner_resolve(
    client: &Client,
    bearer: &str,
    request: &str,
) -> anyhow::Result<FailureDisposition> {
    failure_disposition(
        client
            .post(format!(
                "{OWNER_BASE_URL}/v2/develop-composer/runs/{request}/resolve"
            ))
            .bearer_auth(bearer),
    )
    .await
}

async fn failure_disposition(
    builder: reqwest::RequestBuilder,
) -> anyhow::Result<FailureDisposition> {
    let response = builder
        .send()
        .await
        .context("call tampered Owner endpoint")?;
    let status = response.status();
    let value: serde_json::Value = response
        .json()
        .await
        .context("parse tampered Owner response")?;
    anyhow::ensure!(
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
        _ => anyhow::bail!("tampered Owner returned forbidden disposition"),
    }
}

async fn selected_row_digest(
    connection: &mut PgConnection,
    marker: &str,
    case: StoredCase,
    key: &str,
) -> anyhow::Result<[u8; 32]> {
    let rows = port(connection, marker, "selected", case.label(), key).await?;
    anyhow::ensure!(
        rows.len() == 1,
        "selector did not resolve exactly one stored row"
    );
    let value = &rows[0][0];
    Ok(Sha256::digest(value.as_bytes()).into())
}

async fn digest_rows(
    connection: &mut PgConnection,
    marker: &str,
    operation: &str,
) -> anyhow::Result<[u8; 32]> {
    let rows = port(connection, marker, operation, "", "").await?;
    let mut digest = Sha256::new();

    for row in rows {
        for value in row {
            digest.update((value.len() as u64).to_be_bytes());
            digest.update(value.as_bytes());
        }
    }
    Ok(digest.finalize().into())
}

async fn census(connection: &mut PgConnection, marker: &str) -> anyhow::Result<Vec<i64>> {
    let rows = port(connection, marker, "census", "", "").await?;
    anyhow::ensure!(rows.len() == 1, "census omitted its exact row");
    rows[0]
        .iter()
        .map(|value| value.parse().context("decode positive census"))
        .collect()
}

async fn a0_count(client: &Client, bearer: &str) -> anyhow::Result<u64> {
    let response = client
        .get(format!(
            "{OWNER_BASE_URL}/_sealed-acceptance/v1/develop-composer/a0-executions"
        ))
        .bearer_auth(bearer)
        .send()
        .await
        .context("read A0 census")?;
    anyhow::ensure!(response.status() == StatusCode::OK, "A0 census unavailable");
    let value: serde_json::Value = response.json().await.context("parse A0 census")?;
    value
        .get("a0_executions")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| anyhow::anyhow!("invalid A0 census"))
}
