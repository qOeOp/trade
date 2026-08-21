//! Sealed, incident-specific Qualification Owner reconstruction.
//!
//! This module is intentionally feature-gated and closed over one incident.
//! It is not a general import, restore, or migration surface.

use std::{
    collections::BTreeMap,
    env,
    ffi::OsString,
    fmt, fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Deserializer, Serialize, de};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};

use crate::{
    ProtectedFeedbackFrontierReadbackV1, ProtectedFeedbackResolutionV1, QualificationOwnerError,
    RdIndependenceBasisLocatorV1,
    postgres::{
        StoredRdBasisReceiptV1, admit_projection_in_transaction, canonical_digest, decode_exact,
        form_projection_for_basis, identity, load_rd_basis_in_transaction,
        lock_principal_scope_in_transaction, principal_scope_key, resolution_name,
        verify_scope_history_in_transaction,
    },
};

const INCIDENT_IDENTITY: &str =
    "qualification-owner-incident-v1-01a02194-139a-7281-9d2b-a87ab29d67ba";
const AUTHORIZATION_LOCATOR: &str = "codex://threads/01a014ef-d305-7b40-8d6b-f5c6d26fca56";
const EVIDENCE_SESSION_RESOURCE: &str = "/Users/vx/.codex/sessions/2026/08/21/rollout-2026-08-21T07-49-07-01a02194-139a-7281-9d2b-a87ab29d67ba.jsonl";
const TARGET_DATABASE_RESOURCE: &str = "env:RD_OWNER_DATABASE_URL";
const DISPOSITION: &str = "DETERMINISTIC_CANONICAL_RECONSTRUCTION_NO_BACKUP";
const PROJECTED_EVENT_KIND: &str = "QUALIFICATION_PROTECTED_FEEDBACK_PROJECTED_V1";
const GENERATOR_COMMIT: &str = "a05d76ea18e2b35d7e55d74357fbc30b971ec1a2";
const GENERATOR_TREE: &str = "eb25b1a8325c4711ebd8d2cd012b3a87f70741c6";
const GENERATOR_BLOB: &str = "ba63c5efc72b8b2ad6c353013a1c879cbfc754c1";
const GENERATOR_SHA256: &str = "3a6fb8aab7de276638026823865a35407be7e4a05a6f93d414cc157a5b60dfc3";

const REQUEST_IDENTITY: &str = "research-request-4914a790-f915-4433-b943-ed58ea05eae1";
const BASIS_IDENTITY: &str =
    "rd-independence-basis-v1-85b0ba3745d6917e46512ed2a8f89665e98d5780076472d52fe0b7770cf06b8a";
const BASIS_DIGEST: &str =
    "sha256:85b0ba3745d6917e46512ed2a8f89665e98d5780076472d52fe0b7770cf06b8a";
const BASIS_RECEIPT_IDENTITY: &str = "rd-independence-basis-receipt-v1-31161e79c3376d61239ec124e8a77653f807f9f7a9d17f4e729d3c09eff0c0b7";
const BASIS_LINEAGE_DIGEST: &str =
    "sha256:5e9e285d0d283eb6e11863798ababd4399b70dadb6446a7d63d00d70745d33ca";
const BASIS_COMMITTED_AT_EPOCH_MS: u64 = 1_787_308_003_200;
const RD_PRINCIPAL_SCOPE_KEY: &str =
    "sha256:c4426b5b3e5831a62f9f378569e9030b96ef69d8fc1f463c9892757947cd8e75";
const PRINCIPAL: &str = "admin";
const SCOPE_SUBMIT: &str = "research:submit";
const SCOPE_VIEW: &str = "research:view";

const QUALIFICATION_SCOPE_KEY: &str =
    "sha256:7abca99bbc9110e62142484510a1458f22e345babd7c66dfbe903e1d2fcafcf6";
const PROJECTION_IDENTITY: &str = "qualification-protected-feedback-frontier-v1-2b17a7cbc464e77df3b052976ebd6ce4a5c14db61353c72669e82b565f19dada";
const PROJECTION_DIGEST: &str =
    "sha256:2b17a7cbc464e77df3b052976ebd6ce4a5c14db61353c72669e82b565f19dada";
const PROJECTION_RECEIPT_IDENTITY: &str = "qualification-protected-feedback-frontier-receipt-v1-50a00752f5bf2e73820923c8472ea7fe9509b6440ad45b87718fc5d2c8f2b372";
const OUTBOX_EVENT_IDENTITY: &str =
    "qualification-owner-event-v1-566626b33394df610ecc99b67c0cc0a317942f95fb7202f0a33cd24bfd2974f2";
const OUTBOX_PAYLOAD_DIGEST: &str =
    "sha256:566626b33394df610ecc99b67c0cc0a317942f95fb7202f0a33cd24bfd2974f2";
const SOURCE_CUT: &str = "qualification-protected-feedback-cut-v1-0";
const PROJECTION_AT_EPOCH_MS: u64 = 1_787_308_003_208;
const VALID_THROUGH_EPOCH_MS: u64 = 1_787_308_603_208;
const PROJECTION_JSON_SHA256: &str =
    "e4dfc592871bca6858aa68df9373f66a86509ef6ac6cc1937d267ea0e099b9f4";
const PROJECTION_RECEIPT_JSON_SHA256: &str =
    "f2665d8a4b364d8d1cd0c833faef925ecd51358d7fb697c856ef4bde34bbb40c";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    receipt_digest: String,
    incident_identity: String,
    disposition: String,
    authorization_locator: String,
    evidence_session_resource: String,
    evidence_records: Vec<EvidenceRecordBindingV1>,
    generator: GeneratorBindingV1,
    tool_executable_sha256: String,
    target_database_resource: String,
    database_resource_fingerprint: String,
    rd_anchor: RdAnchorBindingV1,
    restored: RestoredBindingV1,
    pre_counts: QualificationCountsV1,
    post_counts: QualificationCountsV1,
    recovered_at_epoch_ms: u64,
    raw_original_jsonb_storage_observed: bool,
    physical_backup_restored: bool,
    new_validity_minted: bool,
    new_domain_wake_emitted: bool,
}

impl RecoveryReceiptV1 {
    #[must_use]
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    #[must_use]
    pub fn database_resource_fingerprint(&self) -> &str {
        &self.database_resource_fingerprint
    }

    #[must_use]
    pub const fn recovered_at_epoch_ms(&self) -> u64 {
        self.recovered_at_epoch_ms
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredRecoveryReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    receipt_digest: String,
    incident_identity: String,
    disposition: String,
    authorization_locator: String,
    evidence_session_resource: String,
    evidence_records: Vec<EvidenceRecordBindingV1>,
    generator: GeneratorBindingV1,
    tool_executable_sha256: String,
    target_database_resource: String,
    database_resource_fingerprint: String,
    rd_anchor: RdAnchorBindingV1,
    restored: RestoredBindingV1,
    pre_counts: QualificationCountsV1,
    post_counts: QualificationCountsV1,
    recovered_at_epoch_ms: u64,
    raw_original_jsonb_storage_observed: bool,
    physical_backup_restored: bool,
    new_validity_minted: bool,
    new_domain_wake_emitted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct EvidenceRecordBindingV1 {
    call_line: u64,
    call_record_sha256: String,
    output_line: u64,
    output_record_sha256: String,
    call_item_identity: String,
    output_item_identity: String,
    call_identity: String,
    turn_identity: String,
    output_json_pointer: String,
    output_length_bytes: u64,
    output_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct GeneratorBindingV1 {
    commit: String,
    tree: String,
    postgres_blob: String,
    postgres_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RdAnchorBindingV1 {
    request_identity: String,
    basis_identity: String,
    basis_digest: String,
    basis_receipt_identity: String,
    basis_lineage_digest: String,
    basis_committed_at_epoch_ms: u64,
    basis_head_key: String,
    basis_outbox_event_identity: String,
    basis_outbox_payload_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RestoredBindingV1 {
    projection_identity: String,
    projection_digest: String,
    projection_receipt_identity: String,
    principal_scope_key: String,
    source_sequence: u64,
    source_cut: String,
    projection_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
    projection_json_sha256: String,
    projection_receipt_json_sha256: String,
    outbox_event_identity: String,
    outbox_payload_digest: String,
    outbox_event_kind: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct QualificationCountsV1 {
    projections: u64,
    heads: u64,
    outbox_events: u64,
    recovery_receipts: u64,
}

#[derive(Serialize)]
struct RecoveryReceiptMeaningV1<'a> {
    schema_version: u32,
    incident_identity: &'a str,
    disposition: &'a str,
    authorization_locator: &'a str,
    evidence_session_resource: &'a str,
    evidence_records: &'a [EvidenceRecordBindingV1],
    generator: &'a GeneratorBindingV1,
    tool_executable_sha256: &'a str,
    target_database_resource: &'a str,
    database_resource_fingerprint: &'a str,
    rd_anchor: &'a RdAnchorBindingV1,
    restored: &'a RestoredBindingV1,
    pre_counts: QualificationCountsV1,
    post_counts: QualificationCountsV1,
    recovered_at_epoch_ms: u64,
    raw_original_jsonb_storage_observed: bool,
    physical_backup_restored: bool,
    new_validity_minted: bool,
    new_domain_wake_emitted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct IncidentEvidenceV1 {
    records: Vec<EvidenceRecordBindingV1>,
    projection: ProtectedFeedbackFrontierReadbackV1,
}

#[derive(Debug, Clone, Copy)]
struct EvidenceRecordSpec {
    call_line: usize,
    call_record_sha256: &'static str,
    output_line: usize,
    output_record_sha256: &'static str,
    call_item_identity: &'static str,
    output_item_identity: &'static str,
    call_identity: &'static str,
    turn_identity: &'static str,
    output_length_bytes: usize,
    output_sha256: &'static str,
}

const EVIDENCE_RECORDS: [EvidenceRecordSpec; 5] = [
    EvidenceRecordSpec {
        call_line: 11_441,
        call_record_sha256: "c08ac4a49c99aa96c45ad1757029fb3facfa4196c1c204ae78c7c5a100a72160",
        output_line: 11_442,
        output_record_sha256: "eb6069097d8938d286e65c6ed1d96c90fc4a9f0ab7a49f02b8e0b05e60f284fb",
        call_item_identity: "ctc_01d042be7b2a0380016a882859adc887d0ae4f78b235bbe975",
        output_item_identity: "ctco_01a023dd-ebf7-7d92-8c9f-f22ed00c9a22",
        call_identity: "call_BP4MyLwjctRC0qyhvYB8hioy",
        turn_identity: "01a023cb-a748-7a72-aff6-56e723e6a831",
        output_length_bytes: 185,
        output_sha256: "d81542c09f814bd7fd6228c42e9bdaa38f569b88c6fd0149562c5b989e37eff5",
    },
    EvidenceRecordSpec {
        call_line: 13_591,
        call_record_sha256: "dee59f4cc5f0a6aad94b150ad26a352f88a3bbe1b9030f6768a7e991a3b1c705",
        output_line: 13_592,
        output_record_sha256: "0c9607c82171ead178e6c8adafaa66e27f18b61a7f4ecc2b7bd4a8f8449c5085",
        call_item_identity: "ctc_01d042be7b2a0380016a884316219087d0a50b763b7da30089",
        output_item_identity: "ctco_01a02446-1fb4-7983-8cf5-da4a6c2e839a",
        call_identity: "call_NYGCdnnsT0wqcPVVgr678jhX",
        turn_identity: "01a0241b-1d7a-7721-ae07-71f75c517a3b",
        output_length_bytes: 54,
        output_sha256: "6993ff8262f45e99699b7c86bebb62f12bf98519ecd800be0733f627170762d1",
    },
    EvidenceRecordSpec {
        call_line: 13_742,
        call_record_sha256: "4fd7ce6c342523da6fde9968dc310bcbbe94ab93be463de04cf7b2fdfbbc2a73",
        output_line: 13_743,
        output_record_sha256: "bf704cafecb1a51eb9c9d7526760908a723c6f160932b6fef956272af5456688",
        call_item_identity: "ctc_01d042be7b2a0380016a884419a08487d0bdd59460f442531c",
        output_item_identity: "ctco_01a0244a-13ac-7822-a4cc-4d5f61c79a95",
        call_identity: "call_gHPC1nrNyVC3IC2LmkHRFWH0",
        turn_identity: "01a0241b-1d7a-7721-ae07-71f75c517a3b",
        output_length_bytes: 3_420,
        output_sha256: "2dc588b4130e122a45c1e20c116bcfc1e21fefcc22446927bc04ed2f926c85b8",
    },
    EvidenceRecordSpec {
        call_line: 13_750,
        call_record_sha256: "3ce462e7bfc1053efb3a55b2eb057e05bbe2dcca3e06a8185860cb9c031f7d23",
        output_line: 13_751,
        output_record_sha256: "9c19a38d371762787ec07018071493490634e1ab949d39daf14649806d9a1b62",
        call_item_identity: "ctc_01d042be7b2a0380016a884425ca8087d0aa01e7f8c3a1a33f",
        output_item_identity: "ctco_01a0244a-40d3-7af2-885a-5bac525e5fb1",
        call_identity: "call_V1AhcaxzDtKtzxWk6VGhdTvf",
        turn_identity: "01a0241b-1d7a-7721-ae07-71f75c517a3b",
        output_length_bytes: 1_840,
        output_sha256: "60c05abf4bef81431978a26d42ee6ecc12e6b740d2b8a63179e3a617343150ed",
    },
    EvidenceRecordSpec {
        call_line: 12_354,
        call_record_sha256: "5020d2b2ba37a7dbf92a3ae4fa4799bfd9e10169d58b293de39bb2470b4514d7",
        output_line: 12_355,
        output_record_sha256: "ffccb0f1aec40ae23bd26fb18a4f43f56ded29190299d03e513837bcb9e15240",
        call_item_identity: "ctc_01d042be7b2a0380016a883454930487d09aa0686e6fa95025",
        output_item_identity: "ctco_01a0240c-7842-7e02-b832-ef4d04201540",
        call_identity: "call_Y7q6OzF6SBkhNbrvclW6VvZL",
        turn_identity: "01a023ed-4b54-78d1-b8f4-e1cf17957939",
        output_length_bytes: 40_106,
        output_sha256: "be2b45c5dfcf784facb094bc79d05ce2e67199bf755871c270bdd60bb99b0a3b",
    },
];

/// Execute the sealed admin binary contract.
///
/// # Errors
///
/// Returns `Unavailable` for every malformed, stale, mismatched, or unsafe input or store.
pub async fn run_owner_recovery_cli(
    arguments: impl IntoIterator<Item = OsString>,
) -> Result<RecoveryReceiptV1, QualificationOwnerError> {
    let request = CliRequestV1::parse(arguments)?;
    request.verify_closed_manifest()?;
    let evidence = verify_evidence(Path::new(&request.evidence_session_resource))?;
    let database_url = resolve_target_database_resource(&request.target_database_resource)?;
    let tool_executable_sha256 = executable_sha256()?;
    let receipt = recover(
        &database_url,
        &request.target_database_resource,
        &request.authorization_locator,
        &tool_executable_sha256,
        &evidence,
        FaultPoint::None,
    )
    .await?;
    verify_current_cut_remains_unavailable(&database_url).await?;
    Ok(receipt)
}

#[derive(Debug)]
struct CliRequestV1 {
    evidence_session_resource: String,
    incident_identity: String,
    authorization_locator: String,
    target_database_resource: String,
}

impl CliRequestV1 {
    fn parse(
        arguments: impl IntoIterator<Item = OsString>,
    ) -> Result<Self, QualificationOwnerError> {
        let mut values = BTreeMap::new();
        let mut arguments = arguments.into_iter();
        let _program = arguments.next();
        while let Some(flag) = arguments.next() {
            let flag = flag
                .into_string()
                .map_err(|_| unavailable("recovery CLI flag is not UTF-8"))?;
            if !matches!(
                flag.as_str(),
                "--evidence-session-resource"
                    | "--incident-identity"
                    | "--authorization-locator"
                    | "--target-database-resource"
            ) {
                return Err(unavailable("recovery CLI accepted an unknown field"));
            }
            let value = arguments
                .next()
                .ok_or_else(|| unavailable("recovery CLI field is missing its value"))?
                .into_string()
                .map_err(|_| unavailable("recovery CLI value is not UTF-8"))?;
            if values.insert(flag, value).is_some() {
                return Err(unavailable("recovery CLI field is duplicated"));
            }
        }

        if values.len() != 4 {
            return Err(unavailable("recovery CLI requires exactly four fields"));
        }
        Ok(Self {
            evidence_session_resource: take(&mut values, "--evidence-session-resource")?,
            incident_identity: take(&mut values, "--incident-identity")?,
            authorization_locator: take(&mut values, "--authorization-locator")?,
            target_database_resource: take(&mut values, "--target-database-resource")?,
        })
    }

    fn verify_closed_manifest(&self) -> Result<(), QualificationOwnerError> {
        if self.evidence_session_resource != EVIDENCE_SESSION_RESOURCE
            || self.incident_identity != INCIDENT_IDENTITY
            || self.authorization_locator != AUTHORIZATION_LOCATOR
            || self.target_database_resource != TARGET_DATABASE_RESOURCE
        {
            return Err(unavailable(
                "recovery CLI does not match the closed incident manifest",
            ));
        }
        Ok(())
    }
}

fn take(
    values: &mut BTreeMap<String, String>,
    key: &str,
) -> Result<String, QualificationOwnerError> {
    values
        .remove(key)
        .ok_or_else(|| unavailable("recovery CLI field is missing"))
}

fn resolve_target_database_resource(resource: &str) -> Result<String, QualificationOwnerError> {
    if resource != TARGET_DATABASE_RESOURCE {
        return Err(unavailable("target database resource is not admitted"));
    }
    env::var("RD_OWNER_DATABASE_URL")
        .map_err(|_| unavailable("target database resource is unavailable"))
}

fn executable_sha256() -> Result<String, QualificationOwnerError> {
    let executable = env::current_exe()
        .map_err(|e| unavailable(format!("recovery executable is unavailable: {e}")))?;
    let bytes = fs::read(executable)
        .map_err(|e| unavailable(format!("recovery executable is unreadable: {e}")))?;
    Ok(format!("sha256:{}", sha256_hex(&bytes)))
}

fn verify_evidence(path: &Path) -> Result<IncidentEvidenceV1, QualificationOwnerError> {
    if path != Path::new(EVIDENCE_SESSION_RESOURCE) {
        return Err(unavailable("evidence session resource locator mismatch"));
    }
    let bytes = fs::read(path)
        .map_err(|e| unavailable(format!("evidence session resource unavailable: {e}")))?;
    std::str::from_utf8(&bytes)
        .map_err(|_| unavailable("evidence session resource is not exact UTF-8"))?;
    if !bytes.ends_with(b"\n") {
        return Err(unavailable("evidence session resource lacks trailing LF"));
    }
    let lines = bytes
        .split_inclusive(|byte| *byte == b'\n')
        .collect::<Vec<_>>();
    let mut bindings = Vec::with_capacity(EVIDENCE_RECORDS.len());
    let mut outputs = BTreeMap::new();

    for spec in EVIDENCE_RECORDS {
        let call = line(&lines, spec.call_line)?;
        let output = line(&lines, spec.output_line)?;
        if sha256_hex(call) != spec.call_record_sha256
            || sha256_hex(output) != spec.output_record_sha256
        {
            return Err(unavailable("evidence record hash mismatch"));
        }
        let call_json = strict_json(call)?;
        let output_json = strict_json(output)?;
        verify_call_record(&call_json, &spec)?;
        let output_text = verify_output_record(&output_json, &spec)?;
        outputs.insert(spec.output_line, output_text.to_string());
        bindings.push(EvidenceRecordBindingV1 {
            call_line: u64::try_from(spec.call_line).map_err(json_error)?,
            call_record_sha256: format!("sha256:{}", spec.call_record_sha256),
            output_line: u64::try_from(spec.output_line).map_err(json_error)?,
            output_record_sha256: format!("sha256:{}", spec.output_record_sha256),
            call_item_identity: spec.call_item_identity.to_string(),
            output_item_identity: spec.output_item_identity.to_string(),
            call_identity: spec.call_identity.to_string(),
            turn_identity: spec.turn_identity.to_string(),
            output_json_pointer: "/payload/output/1/text".to_string(),
            output_length_bytes: u64::try_from(spec.output_length_bytes).map_err(json_error)?,
            output_sha256: format!("sha256:{}", spec.output_sha256),
        });
    }

    verify_decisive_outputs(&outputs)?;
    let projection = recompute_expected_projection()?;
    Ok(IncidentEvidenceV1 {
        records: bindings,
        projection,
    })
}

fn line<'a>(lines: &'a [&[u8]], one_based: usize) -> Result<&'a [u8], QualificationOwnerError> {
    lines
        .get(one_based.saturating_sub(1))
        .copied()
        .ok_or_else(|| unavailable("evidence record line unavailable"))
}

fn verify_call_record(
    value: &serde_json::Value,
    spec: &EvidenceRecordSpec,
) -> Result<(), QualificationOwnerError> {
    require_string(value, "/type", "response_item")?;
    require_string(value, "/payload/type", "custom_tool_call")?;
    require_string(value, "/payload/id", spec.call_item_identity)?;
    require_string(value, "/payload/call_id", spec.call_identity)?;
    require_string(value, "/payload/name", "exec")?;
    require_string(value, "/payload/status", "completed")?;
    require_string(
        value,
        "/payload/internal_chat_message_metadata_passthrough/turn_id",
        spec.turn_identity,
    )
}

fn verify_output_record<'a>(
    value: &'a serde_json::Value,
    spec: &EvidenceRecordSpec,
) -> Result<&'a str, QualificationOwnerError> {
    require_string(value, "/type", "response_item")?;
    require_string(value, "/payload/type", "custom_tool_call_output")?;
    require_string(value, "/payload/id", spec.output_item_identity)?;
    require_string(value, "/payload/call_id", spec.call_identity)?;
    require_string(
        value,
        "/payload/internal_chat_message_metadata_passthrough/turn_id",
        spec.turn_identity,
    )?;
    let output = value
        .pointer("/payload/output")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| unavailable("evidence output array unavailable"))?;
    if output.len() != 2 {
        return Err(unavailable("evidence output pointer is ambiguous"));
    }
    require_string(value, "/payload/output/0/type", "input_text")?;
    require_string(value, "/payload/output/1/type", "input_text")?;
    let text = value
        .pointer("/payload/output/1/text")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| unavailable("evidence output text unavailable"))?;
    if text.len() != spec.output_length_bytes || sha256_hex(text.as_bytes()) != spec.output_sha256 {
        return Err(unavailable("evidence output length or hash mismatch"));
    }
    Ok(text)
}

fn require_string(
    value: &serde_json::Value,
    pointer: &str,
    expected: &str,
) -> Result<(), QualificationOwnerError> {
    if value.pointer(pointer).and_then(serde_json::Value::as_str) != Some(expected) {
        return Err(unavailable("evidence record field mismatch"));
    }
    Ok(())
}

fn verify_decisive_outputs(
    outputs: &BTreeMap<usize, String>,
) -> Result<(), QualificationOwnerError> {
    let direct_counts = output(outputs, 11_442)?;

    for exact in [
        "basis=1",
        "qualification_projection=1",
        "qualification_outbox=1",
    ] {
        require_once(direct_counts, exact)?;
    }
    let integrity_counts = output(outputs, 13_592)?;

    for exact in [
        "projections=1",
        "heads=1",
        "head_linked=1",
        "orphan_outboxes=0",
    ] {
        require_once(integrity_counts, exact)?;
    }
    let projection_scalars = output(outputs, 13_743)?;

    for exact in [
        PROJECTION_IDENTITY,
        BASIS_IDENTITY,
        PROJECTION_DIGEST,
        QUALIFICATION_SCOPE_KEY,
        OUTBOX_EVENT_IDENTITY,
        OUTBOX_PAYLOAD_DIGEST,
        PROJECTED_EVENT_KIND,
        SOURCE_CUT,
        "GENESIS_EMPTY",
        "1787308003208",
        "1787308603208",
    ] {
        require_present(projection_scalars, exact)?;
    }
    let rd_scalars = output(outputs, 13_751)?;

    for exact in [
        REQUEST_IDENTITY,
        BASIS_IDENTITY,
        BASIS_DIGEST,
        BASIS_LINEAGE_DIGEST,
        RD_PRINCIPAL_SCOPE_KEY,
        "1787308003200",
    ] {
        require_present(rd_scalars, exact)?;
    }
    let consumer = output(outputs, 12_355)?;

    for exact in [
        REQUEST_IDENTITY,
        BASIS_IDENTITY,
        BASIS_RECEIPT_IDENTITY,
        PROJECTION_IDENTITY,
        PROJECTION_RECEIPT_IDENTITY,
        "\"resolution\": \"GENESIS_EMPTY\"",
        "\"trial_family_resolution\": \"AVAILABLE\"",
    ] {
        if !consumer.contains(exact) {
            return Err(unavailable("secondary consumer evidence mismatch"));
        }
    }
    Ok(())
}

fn output(outputs: &BTreeMap<usize, String>, line: usize) -> Result<&str, QualificationOwnerError> {
    outputs
        .get(&line)
        .map(String::as_str)
        .ok_or_else(|| unavailable("decisive evidence output unavailable"))
}

fn require_once(haystack: &str, needle: &str) -> Result<(), QualificationOwnerError> {
    if haystack.match_indices(needle).count() != 1 {
        return Err(unavailable(
            "decisive evidence scalar is absent or ambiguous",
        ));
    }
    Ok(())
}

fn require_present(haystack: &str, needle: &str) -> Result<(), QualificationOwnerError> {
    if !haystack.contains(needle) {
        return Err(unavailable("decisive evidence scalar is absent"));
    }
    Ok(())
}

fn recompute_expected_projection()
-> Result<ProtectedFeedbackFrontierReadbackV1, QualificationOwnerError> {
    let request_scope = expected_scope();
    if principal_scope_key(PRINCIPAL, &request_scope)? != QUALIFICATION_SCOPE_KEY {
        return Err(unavailable("Qualification principal/scope key mismatch"));
    }
    let projection = form_projection_for_basis(
        PRINCIPAL,
        &request_scope,
        BASIS_IDENTITY,
        BASIS_DIGEST,
        ProtectedFeedbackResolutionV1::GenesisEmpty,
        0,
        SOURCE_CUT.to_string(),
        None,
        None,
        PROJECTION_AT_EPOCH_MS,
    )?;
    let projection_json = serde_json::to_vec(&projection.as_stored()).map_err(json_error)?;
    let receipt_json = serde_json::to_vec(&projection.receipt_as_stored()).map_err(json_error)?;
    let outbox_digest = canonical_digest(
        "qualification.owner-outbox.payload.v1",
        &projection.as_stored(),
    )?;

    if projection.projection_identity() != PROJECTION_IDENTITY
        || projection.projection_digest() != PROJECTION_DIGEST
        || projection.receipt().receipt_identity() != PROJECTION_RECEIPT_IDENTITY
        || projection.valid_through_epoch_ms() != VALID_THROUGH_EPOCH_MS
        || sha256_hex(&projection_json) != PROJECTION_JSON_SHA256
        || sha256_hex(&receipt_json) != PROJECTION_RECEIPT_JSON_SHA256
        || outbox_digest != OUTBOX_PAYLOAD_DIGEST
        || identity("qualification-owner-event-v1", &outbox_digest) != OUTBOX_EVENT_IDENTITY
    {
        return Err(unavailable("frozen generator canonical vector mismatch"));
    }
    Ok(projection)
}

fn expected_scope() -> Vec<String> {
    vec![SCOPE_SUBMIT.to_string(), SCOPE_VIEW.to_string()]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FaultPoint {
    None,
    Projection,
    Head,
    Outbox,
    Receipt,
    #[cfg(test)]
    DelayAfterLocks,
}

#[cfg(test)]
static RECOVERY_LOCKED_FOR_TEST: tokio::sync::Notify = tokio::sync::Notify::const_new();

async fn recover(
    database_url: &str,
    target_database_resource: &str,
    authorization_locator: &str,
    tool_executable_sha256: &str,
    evidence: &IncidentEvidenceV1,
    fault: FaultPoint,
) -> Result<RecoveryReceiptV1, QualificationOwnerError> {
    let canonical_evidence = verify_evidence(Path::new(EVIDENCE_SESSION_RESOURCE))?;

    if *evidence != canonical_evidence {
        return Err(unavailable("preparsed incident evidence mismatch"));
    }

    if target_database_resource != TARGET_DATABASE_RESOURCE
        || authorization_locator != AUTHORIZATION_LOCATOR
        || !is_sha256(tool_executable_sha256)
    {
        return Err(unavailable("recovery execution binding mismatch"));
    }
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(4)
        .connect(database_url)
        .await
        .map_err(storage)?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;

    let database_fingerprint = database_resource_fingerprint(&mut transaction).await?;
    verify_no_active_publisher(&mut transaction).await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(INCIDENT_IDENTITY)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;

    let locator = expected_basis_locator();
    let basis = load_rd_basis_in_transaction(&mut transaction, &locator).await?;
    if basis.request_identity != REQUEST_IDENTITY
        || basis.lineage_digest != BASIS_LINEAGE_DIGEST
        || basis.basis_identity != BASIS_IDENTITY
        || basis.basis_digest != BASIS_DIGEST
    {
        return Err(unavailable("surviving R&D basis anchor mismatch"));
    }
    let rd_anchor = verify_rd_anchor(&mut transaction).await?;
    let scope_key = principal_scope_key(&basis.principal, &basis.request_scope)?;
    if scope_key != QUALIFICATION_SCOPE_KEY {
        return Err(unavailable("Qualification scope anchor mismatch"));
    }
    lock_principal_scope_in_transaction(&mut transaction, &scope_key).await?;

    sqlx::query("LOCK TABLE qualification_protected_feedback_projections_v1, qualification_protected_feedback_heads_v1, qualification_owner_outbox_v1 IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    sqlx::query("CREATE TABLE IF NOT EXISTS qualification_owner_recovery_receipts_v1 (receipt_identity TEXT PRIMARY KEY, incident_identity TEXT NOT NULL UNIQUE, disposition TEXT NOT NULL, receipt_digest TEXT NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)")
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    sqlx::query("LOCK TABLE qualification_owner_recovery_receipts_v1 IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;

    #[cfg(test)]
    if fault == FaultPoint::DelayAfterLocks {
        RECOVERY_LOCKED_FOR_TEST.notify_one();
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }

    let counts = qualification_counts(&mut transaction).await?;

    if counts
        == (QualificationCountsV1 {
            projections: 1,
            heads: 1,
            outbox_events: 1,
            recovery_receipts: 1,
        })
    {
        let receipt = read_completed_receipt(
            &mut transaction,
            &database_fingerprint,
            &rd_anchor,
            tool_executable_sha256,
            evidence,
        )
        .await?;
        verify_reconstructed_history(&mut transaction, &evidence.projection).await?;
        transaction.commit().await.map_err(storage)?;
        return Ok(receipt);
    }

    if counts
        != (QualificationCountsV1 {
            projections: 0,
            heads: 0,
            outbox_events: 0,
            recovery_receipts: 0,
        })
    {
        return Err(unavailable(
            "Qualification recovery target is partial or non-empty",
        ));
    }

    let recovered_at_epoch_ms = sqlx::query_scalar::<_, i64>(
        "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::BIGINT",
    )
    .fetch_one(&mut *transaction)
    .await
    .map_err(storage)
    .and_then(|value| u64::try_from(value).map_err(json_error))?;
    let receipt = form_recovery_receipt(
        &database_fingerprint,
        &rd_anchor,
        tool_executable_sha256,
        evidence,
        recovered_at_epoch_ms,
    )?;
    insert_projection(&mut transaction, &evidence.projection).await?;
    inject(fault, FaultPoint::Projection)?;
    insert_head(&mut transaction, &evidence.projection).await?;
    inject(fault, FaultPoint::Head)?;
    insert_original_outbox(&mut transaction, &evidence.projection).await?;
    inject(fault, FaultPoint::Outbox)?;
    insert_recovery_receipt(&mut transaction, &receipt).await?;
    inject(fault, FaultPoint::Receipt)?;

    let post_counts = qualification_counts(&mut transaction).await?;

    if post_counts != receipt.post_counts {
        return Err(unavailable("Qualification recovery post-count mismatch"));
    }
    verify_reconstructed_history(&mut transaction, &evidence.projection).await?;
    transaction.commit().await.map_err(storage)?;
    Ok(receipt)
}

async fn verify_current_cut_remains_unavailable(
    database_url: &str,
) -> Result<(), QualificationOwnerError> {
    let read_cut_epoch_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(json_error)?
        .as_millis()
        .try_into()
        .map_err(json_error)?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database_url)
        .await
        .map_err(storage)?;
    let mut transaction = pool.begin().await.map_err(storage)?;
    let result = admit_projection_in_transaction(
        &mut transaction,
        &expected_basis_locator(),
        read_cut_epoch_ms,
    )
    .await;
    transaction.rollback().await.map_err(storage)?;

    match result {
        Err(QualificationOwnerError::Unavailable(message))
            if message == "Qualification projection is stale" =>
        {
            Ok(())
        }
        Err(e) => Err(e),
        Ok(_) => Err(unavailable(
            "ordinary current-cut resolver did not remain stale and unavailable",
        )),
    }
}

fn expected_basis_locator() -> RdIndependenceBasisLocatorV1 {
    RdIndependenceBasisLocatorV1 {
        basis_identity: BASIS_IDENTITY.to_string(),
        basis_digest: BASIS_DIGEST.to_string(),
        request_identity: REQUEST_IDENTITY.to_string(),
        principal: PRINCIPAL.to_string(),
        request_scope: expected_scope(),
    }
}

async fn database_resource_fingerprint(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<String, QualificationOwnerError> {
    let row = sqlx::query("SELECT current_database() AS database_name, current_user AS database_user, COALESCE(inet_server_addr()::TEXT, 'local') AS server_address, COALESCE(inet_server_port(), 0) AS server_port, current_setting('server_version_num') AS server_version_num")
        .fetch_one(&mut **transaction)
        .await
        .map_err(storage)?;
    let fields = (
        row.try_get::<String, _>("database_name").map_err(storage)?,
        row.try_get::<String, _>("database_user").map_err(storage)?,
        row.try_get::<String, _>("server_address")
            .map_err(storage)?,
        row.try_get::<i32, _>("server_port").map_err(storage)?,
        row.try_get::<String, _>("server_version_num")
            .map_err(storage)?,
    );
    canonical_digest("qualification.recovery-database-resource.v1", &fields)
}

async fn verify_no_active_publisher(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), QualificationOwnerError> {
    let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND state <> 'idle' AND (application_name LIKE 'qualification-owner-outbox-publisher%' OR query ILIKE '%qualification_owner_outbox_v1%')")
        .fetch_one(&mut **transaction)
        .await
        .map_err(storage)?;

    if count != 0 {
        return Err(unavailable("Qualification outbox publisher is active"));
    }
    Ok(())
}

async fn verify_rd_anchor(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<RdAnchorBindingV1, QualificationOwnerError> {
    let basis_row = sqlx::query("SELECT receipt_json, committed_at_epoch_ms FROM rd_independence_bases_v1 WHERE basis_identity = $1 FOR SHARE")
        .bind(BASIS_IDENTITY)
        .fetch_one(&mut **transaction)
        .await
        .map_err(storage)?;
    let receipt: StoredRdBasisReceiptV1 = decode_exact(
        &basis_row
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?,
    )?;
    let committed_at = u64::try_from(
        basis_row
            .try_get::<i64, _>("committed_at_epoch_ms")
            .map_err(storage)?,
    )
    .map_err(json_error)?;

    if receipt.schema_version != 1
        || receipt.receipt_identity != BASIS_RECEIPT_IDENTITY
        || receipt.basis_identity != BASIS_IDENTITY
        || receipt.basis_digest != BASIS_DIGEST
        || receipt.committed_at_epoch_ms != BASIS_COMMITTED_AT_EPOCH_MS
        || committed_at != BASIS_COMMITTED_AT_EPOCH_MS
    {
        return Err(unavailable("surviving R&D basis receipt anchor mismatch"));
    }

    let head_rows = sqlx::query("SELECT principal_scope_key, principal, basis_identity, lineage_digest, committed_at_epoch_ms FROM rd_independence_basis_heads_v1 WHERE principal_scope_key = $1 FOR SHARE")
        .bind(RD_PRINCIPAL_SCOPE_KEY)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if head_rows.len() != 1 {
        return Err(unavailable("surviving R&D basis head unavailable"));
    }
    let head = &head_rows[0];
    if head
        .try_get::<String, _>("principal_scope_key")
        .map_err(storage)?
        != RD_PRINCIPAL_SCOPE_KEY
        || head.try_get::<String, _>("principal").map_err(storage)? != PRINCIPAL
        || head
            .try_get::<String, _>("basis_identity")
            .map_err(storage)?
            != BASIS_IDENTITY
        || head
            .try_get::<String, _>("lineage_digest")
            .map_err(storage)?
            != BASIS_LINEAGE_DIGEST
        || u64::try_from(
            head.try_get::<i64, _>("committed_at_epoch_ms")
                .map_err(storage)?,
        )
        .map_err(json_error)?
            != BASIS_COMMITTED_AT_EPOCH_MS
    {
        return Err(unavailable("surviving R&D basis head mismatch"));
    }

    let outbox_rows = sqlx::query("SELECT event_identity, payload_digest FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1 AND event_kind = 'INDEPENDENCE_BASIS_PRECOMMITTED_V1' FOR SHARE")
        .bind(BASIS_IDENTITY)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if outbox_rows.len() != 1 {
        return Err(unavailable("surviving R&D basis outbox unavailable"));
    }
    Ok(RdAnchorBindingV1 {
        request_identity: REQUEST_IDENTITY.to_string(),
        basis_identity: BASIS_IDENTITY.to_string(),
        basis_digest: BASIS_DIGEST.to_string(),
        basis_receipt_identity: BASIS_RECEIPT_IDENTITY.to_string(),
        basis_lineage_digest: BASIS_LINEAGE_DIGEST.to_string(),
        basis_committed_at_epoch_ms: BASIS_COMMITTED_AT_EPOCH_MS,
        basis_head_key: RD_PRINCIPAL_SCOPE_KEY.to_string(),
        basis_outbox_event_identity: outbox_rows[0].try_get("event_identity").map_err(storage)?,
        basis_outbox_payload_digest: outbox_rows[0].try_get("payload_digest").map_err(storage)?,
    })
}

async fn qualification_counts(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<QualificationCountsV1, QualificationOwnerError> {
    Ok(QualificationCountsV1 {
        projections: checked_count(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM qualification_protected_feedback_projections_v1",
            )
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?,
        )?,
        heads: checked_count(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM qualification_protected_feedback_heads_v1",
            )
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?,
        )?,
        outbox_events: checked_count(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM qualification_owner_outbox_v1")
                .fetch_one(&mut **transaction)
                .await
                .map_err(storage)?,
        )?,
        recovery_receipts: checked_count(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM qualification_owner_recovery_receipts_v1",
            )
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?,
        )?,
    })
}

fn checked_count(value: i64) -> Result<u64, QualificationOwnerError> {
    u64::try_from(value).map_err(json_error)
}

fn form_recovery_receipt(
    database_resource_fingerprint: &str,
    rd_anchor: &RdAnchorBindingV1,
    tool_executable_sha256: &str,
    evidence: &IncidentEvidenceV1,
    recovered_at_epoch_ms: u64,
) -> Result<RecoveryReceiptV1, QualificationOwnerError> {
    let pre_counts = QualificationCountsV1 {
        projections: 0,
        heads: 0,
        outbox_events: 0,
        recovery_receipts: 0,
    };
    let post_counts = QualificationCountsV1 {
        projections: 1,
        heads: 1,
        outbox_events: 1,
        recovery_receipts: 1,
    };
    let generator = GeneratorBindingV1 {
        commit: GENERATOR_COMMIT.to_string(),
        tree: GENERATOR_TREE.to_string(),
        postgres_blob: GENERATOR_BLOB.to_string(),
        postgres_sha256: format!("sha256:{GENERATOR_SHA256}"),
    };
    let restored = RestoredBindingV1 {
        projection_identity: PROJECTION_IDENTITY.to_string(),
        projection_digest: PROJECTION_DIGEST.to_string(),
        projection_receipt_identity: PROJECTION_RECEIPT_IDENTITY.to_string(),
        principal_scope_key: QUALIFICATION_SCOPE_KEY.to_string(),
        source_sequence: 0,
        source_cut: SOURCE_CUT.to_string(),
        projection_at_epoch_ms: PROJECTION_AT_EPOCH_MS,
        valid_through_epoch_ms: VALID_THROUGH_EPOCH_MS,
        projection_json_sha256: format!("sha256:{PROJECTION_JSON_SHA256}"),
        projection_receipt_json_sha256: format!("sha256:{PROJECTION_RECEIPT_JSON_SHA256}"),
        outbox_event_identity: OUTBOX_EVENT_IDENTITY.to_string(),
        outbox_payload_digest: OUTBOX_PAYLOAD_DIGEST.to_string(),
        outbox_event_kind: PROJECTED_EVENT_KIND.to_string(),
        committed_at_epoch_ms: PROJECTION_AT_EPOCH_MS,
    };
    let meaning = RecoveryReceiptMeaningV1 {
        schema_version: 1,
        incident_identity: INCIDENT_IDENTITY,
        disposition: DISPOSITION,
        authorization_locator: AUTHORIZATION_LOCATOR,
        evidence_session_resource: EVIDENCE_SESSION_RESOURCE,
        evidence_records: &evidence.records,
        generator: &generator,
        tool_executable_sha256,
        target_database_resource: TARGET_DATABASE_RESOURCE,
        database_resource_fingerprint,
        rd_anchor,
        restored: &restored,
        pre_counts,
        post_counts,
        recovered_at_epoch_ms,
        raw_original_jsonb_storage_observed: false,
        physical_backup_restored: false,
        new_validity_minted: false,
        new_domain_wake_emitted: false,
    };
    let receipt_digest = canonical_digest("qualification.owner-recovery-receipt.v1", &meaning)?;
    Ok(RecoveryReceiptV1 {
        schema_version: 1,
        receipt_identity: identity("qualification-owner-recovery-receipt-v1", &receipt_digest),
        receipt_digest,
        incident_identity: INCIDENT_IDENTITY.to_string(),
        disposition: DISPOSITION.to_string(),
        authorization_locator: AUTHORIZATION_LOCATOR.to_string(),
        evidence_session_resource: EVIDENCE_SESSION_RESOURCE.to_string(),
        evidence_records: evidence.records.clone(),
        generator,
        tool_executable_sha256: tool_executable_sha256.to_string(),
        target_database_resource: TARGET_DATABASE_RESOURCE.to_string(),
        database_resource_fingerprint: database_resource_fingerprint.to_string(),
        rd_anchor: rd_anchor.clone(),
        restored,
        pre_counts,
        post_counts,
        recovered_at_epoch_ms,
        raw_original_jsonb_storage_observed: false,
        physical_backup_restored: false,
        new_validity_minted: false,
        new_domain_wake_emitted: false,
    })
}

async fn insert_projection(
    transaction: &mut Transaction<'_, Postgres>,
    projection: &ProtectedFeedbackFrontierReadbackV1,
) -> Result<(), QualificationOwnerError> {
    sqlx::query("INSERT INTO qualification_protected_feedback_projections_v1 (projection_identity,basis_identity,principal,request_scope_json,resolution_state,source_sequence,source_cut,projection_digest,projection_json,receipt_json,committed_at_epoch_ms,valid_through_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
        .bind(projection.projection_identity())
        .bind(projection.basis_identity())
        .bind(projection.principal())
        .bind(serde_json::to_value(projection.request_scope()).map_err(json_error)?)
        .bind(resolution_name(projection.resolution()))
        .bind(i64::try_from(projection.source_sequence()).map_err(json_error)?)
        .bind(projection.source_cut())
        .bind(projection.projection_digest())
        .bind(serde_json::to_value(projection.as_stored()).map_err(json_error)?)
        .bind(serde_json::to_value(projection.receipt_as_stored()).map_err(json_error)?)
        .bind(i64::try_from(projection.receipt().committed_at_epoch_ms()).map_err(json_error)?)
        .bind(i64::try_from(projection.valid_through_epoch_ms()).map_err(json_error)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn insert_head(
    transaction: &mut Transaction<'_, Postgres>,
    projection: &ProtectedFeedbackFrontierReadbackV1,
) -> Result<(), QualificationOwnerError> {
    sqlx::query("INSERT INTO qualification_protected_feedback_heads_v1 (principal_scope_key,principal,request_scope_json,frontier_identity,frontier_digest,source_sequence,source_cut,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(QUALIFICATION_SCOPE_KEY)
        .bind(projection.principal())
        .bind(serde_json::to_value(projection.request_scope()).map_err(json_error)?)
        .bind(projection.projection_identity())
        .bind(projection.projection_digest())
        .bind(i64::try_from(projection.source_sequence()).map_err(json_error)?)
        .bind(projection.source_cut())
        .bind(i64::try_from(projection.receipt().committed_at_epoch_ms()).map_err(json_error)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn insert_original_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    projection: &ProtectedFeedbackFrontierReadbackV1,
) -> Result<(), QualificationOwnerError> {
    sqlx::query("INSERT INTO qualification_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(OUTBOX_EVENT_IDENTITY)
        .bind(projection.projection_identity())
        .bind(PROJECTED_EVENT_KIND)
        .bind(OUTBOX_PAYLOAD_DIGEST)
        .bind(serde_json::to_value(projection.as_stored()).map_err(json_error)?)
        .bind(i64::try_from(projection.receipt().committed_at_epoch_ms()).map_err(json_error)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn insert_recovery_receipt(
    transaction: &mut Transaction<'_, Postgres>,
    receipt: &RecoveryReceiptV1,
) -> Result<(), QualificationOwnerError> {
    sqlx::query("INSERT INTO qualification_owner_recovery_receipts_v1 (receipt_identity,incident_identity,disposition,receipt_digest,receipt_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&receipt.receipt_identity)
        .bind(&receipt.incident_identity)
        .bind(&receipt.disposition)
        .bind(&receipt.receipt_digest)
        .bind(serde_json::to_value(receipt.as_stored()).map_err(json_error)?)
        .bind(i64::try_from(receipt.recovered_at_epoch_ms).map_err(json_error)?)
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

async fn verify_reconstructed_history(
    transaction: &mut Transaction<'_, Postgres>,
    expected: &ProtectedFeedbackFrontierReadbackV1,
) -> Result<(), QualificationOwnerError> {
    let history = verify_scope_history_in_transaction(
        transaction,
        PRINCIPAL,
        &expected_scope(),
        QUALIFICATION_SCOPE_KEY,
    )
    .await?;
    drop(history);
    let row = sqlx::query("SELECT projection_json, receipt_json FROM qualification_protected_feedback_projections_v1 WHERE projection_identity = $1")
        .bind(PROJECTION_IDENTITY)
        .fetch_one(&mut **transaction)
        .await
        .map_err(storage)?;

    if row
        .try_get::<serde_json::Value, _>("projection_json")
        .map_err(storage)?
        != serde_json::to_value(expected.as_stored()).map_err(json_error)?
        || row
            .try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?
            != serde_json::to_value(expected.receipt_as_stored()).map_err(json_error)?
    {
        return Err(unavailable(
            "reconstructed Qualification canonical history mismatch",
        ));
    }
    Ok(())
}

async fn read_completed_receipt(
    transaction: &mut Transaction<'_, Postgres>,
    database_fingerprint: &str,
    rd_anchor: &RdAnchorBindingV1,
    tool_executable_sha256: &str,
    evidence: &IncidentEvidenceV1,
) -> Result<RecoveryReceiptV1, QualificationOwnerError> {
    let rows = sqlx::query("SELECT receipt_identity, incident_identity, disposition, receipt_digest, receipt_json, committed_at_epoch_ms FROM qualification_owner_recovery_receipts_v1 FOR UPDATE")
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() != 1 {
        return Err(unavailable("completed recovery receipt is ambiguous"));
    }
    let row = &rows[0];
    let stored: StoredRecoveryReceiptV1 = decode_exact(
        &row.try_get::<serde_json::Value, _>("receipt_json")
            .map_err(storage)?,
    )?;
    let receipt = RecoveryReceiptV1::from_stored(stored);
    receipt.verify_canonical()?;
    if receipt.database_resource_fingerprint != database_fingerprint
        || receipt.rd_anchor != *rd_anchor
        || receipt.tool_executable_sha256 != tool_executable_sha256
        || receipt.evidence_records != evidence.records
        || row
            .try_get::<String, _>("receipt_identity")
            .map_err(storage)?
            != receipt.receipt_identity
        || row
            .try_get::<String, _>("incident_identity")
            .map_err(storage)?
            != INCIDENT_IDENTITY
        || row.try_get::<String, _>("disposition").map_err(storage)? != DISPOSITION
        || row
            .try_get::<String, _>("receipt_digest")
            .map_err(storage)?
            != receipt.receipt_digest
        || u64::try_from(
            row.try_get::<i64, _>("committed_at_epoch_ms")
                .map_err(storage)?,
        )
        .map_err(json_error)?
            != receipt.recovered_at_epoch_ms
    {
        return Err(unavailable("completed recovery receipt binding mismatch"));
    }
    Ok(receipt)
}

impl RecoveryReceiptV1 {
    fn as_stored(&self) -> StoredRecoveryReceiptV1 {
        StoredRecoveryReceiptV1 {
            schema_version: self.schema_version,
            receipt_identity: self.receipt_identity.clone(),
            receipt_digest: self.receipt_digest.clone(),
            incident_identity: self.incident_identity.clone(),
            disposition: self.disposition.clone(),
            authorization_locator: self.authorization_locator.clone(),
            evidence_session_resource: self.evidence_session_resource.clone(),
            evidence_records: self.evidence_records.clone(),
            generator: self.generator.clone(),
            tool_executable_sha256: self.tool_executable_sha256.clone(),
            target_database_resource: self.target_database_resource.clone(),
            database_resource_fingerprint: self.database_resource_fingerprint.clone(),
            rd_anchor: self.rd_anchor.clone(),
            restored: self.restored.clone(),
            pre_counts: self.pre_counts,
            post_counts: self.post_counts,
            recovered_at_epoch_ms: self.recovered_at_epoch_ms,
            raw_original_jsonb_storage_observed: self.raw_original_jsonb_storage_observed,
            physical_backup_restored: self.physical_backup_restored,
            new_validity_minted: self.new_validity_minted,
            new_domain_wake_emitted: self.new_domain_wake_emitted,
        }
    }

    fn from_stored(stored: StoredRecoveryReceiptV1) -> Self {
        Self {
            schema_version: stored.schema_version,
            receipt_identity: stored.receipt_identity,
            receipt_digest: stored.receipt_digest,
            incident_identity: stored.incident_identity,
            disposition: stored.disposition,
            authorization_locator: stored.authorization_locator,
            evidence_session_resource: stored.evidence_session_resource,
            evidence_records: stored.evidence_records,
            generator: stored.generator,
            tool_executable_sha256: stored.tool_executable_sha256,
            target_database_resource: stored.target_database_resource,
            database_resource_fingerprint: stored.database_resource_fingerprint,
            rd_anchor: stored.rd_anchor,
            restored: stored.restored,
            pre_counts: stored.pre_counts,
            post_counts: stored.post_counts,
            recovered_at_epoch_ms: stored.recovered_at_epoch_ms,
            raw_original_jsonb_storage_observed: stored.raw_original_jsonb_storage_observed,
            physical_backup_restored: stored.physical_backup_restored,
            new_validity_minted: stored.new_validity_minted,
            new_domain_wake_emitted: stored.new_domain_wake_emitted,
        }
    }

    fn verify_canonical(&self) -> Result<(), QualificationOwnerError> {
        let meaning = RecoveryReceiptMeaningV1 {
            schema_version: self.schema_version,
            incident_identity: &self.incident_identity,
            disposition: &self.disposition,
            authorization_locator: &self.authorization_locator,
            evidence_session_resource: &self.evidence_session_resource,
            evidence_records: &self.evidence_records,
            generator: &self.generator,
            tool_executable_sha256: &self.tool_executable_sha256,
            target_database_resource: &self.target_database_resource,
            database_resource_fingerprint: &self.database_resource_fingerprint,
            rd_anchor: &self.rd_anchor,
            restored: &self.restored,
            pre_counts: self.pre_counts,
            post_counts: self.post_counts,
            recovered_at_epoch_ms: self.recovered_at_epoch_ms,
            raw_original_jsonb_storage_observed: self.raw_original_jsonb_storage_observed,
            physical_backup_restored: self.physical_backup_restored,
            new_validity_minted: self.new_validity_minted,
            new_domain_wake_emitted: self.new_domain_wake_emitted,
        };
        let digest = canonical_digest("qualification.owner-recovery-receipt.v1", &meaning)?;
        if self.schema_version != 1
            || self.receipt_digest != digest
            || self.receipt_identity != identity("qualification-owner-recovery-receipt-v1", &digest)
            || self.incident_identity != INCIDENT_IDENTITY
            || self.disposition != DISPOSITION
            || self.authorization_locator != AUTHORIZATION_LOCATOR
            || self.evidence_session_resource != EVIDENCE_SESSION_RESOURCE
            || self.generator.commit != GENERATOR_COMMIT
            || self.generator.tree != GENERATOR_TREE
            || self.generator.postgres_blob != GENERATOR_BLOB
            || self.generator.postgres_sha256 != format!("sha256:{GENERATOR_SHA256}")
            || self.target_database_resource != TARGET_DATABASE_RESOURCE
            || self.raw_original_jsonb_storage_observed
            || self.physical_backup_restored
            || self.new_validity_minted
            || self.new_domain_wake_emitted
        {
            return Err(unavailable("recovery receipt canonical meaning mismatch"));
        }
        Ok(())
    }
}

fn inject(actual: FaultPoint, expected: FaultPoint) -> Result<(), QualificationOwnerError> {
    if actual == expected {
        return Err(unavailable("injected recovery transaction fault"));
    }
    Ok(())
}

fn is_sha256(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|hex| hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[allow(clippy::needless_pass_by_value)]
fn storage(error: sqlx::Error) -> QualificationOwnerError {
    unavailable(error.to_string())
}

fn json_error(error: impl fmt::Display) -> QualificationOwnerError {
    unavailable(error.to_string())
}

fn unavailable(error: impl Into<String>) -> QualificationOwnerError {
    QualificationOwnerError::Unavailable(error.into())
}

#[derive(Debug)]
enum StrictJsonValue {
    Null,
    Bool(bool),
    Number(serde_json::Number),
    String(String),
    Array(Vec<Self>),
    Object(BTreeMap<String, Self>),
}

impl<'de> Deserialize<'de> for StrictJsonValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(StrictJsonVisitor)
    }
}

struct StrictJsonVisitor;

impl<'de> de::Visitor<'de> for StrictJsonVisitor {
    type Value = StrictJsonValue;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a JSON value without duplicate object members")
    }

    fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E> {
        Ok(StrictJsonValue::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
        Ok(StrictJsonValue::Number(value.into()))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E> {
        Ok(StrictJsonValue::Number(value.into()))
    }

    fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        serde_json::Number::from_f64(value)
            .map(StrictJsonValue::Number)
            .ok_or_else(|| E::custom("non-finite JSON number"))
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E> {
        Ok(StrictJsonValue::String(value.to_string()))
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
        Ok(StrictJsonValue::String(value))
    }

    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(StrictJsonValue::Null)
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(StrictJsonValue::Null)
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: de::SeqAccess<'de>,
    {
        let mut values = Vec::new();
        while let Some(value) = sequence.next_element()? {
            values.push(value);
        }
        Ok(StrictJsonValue::Array(values))
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: de::MapAccess<'de>,
    {
        let mut values = BTreeMap::new();
        while let Some((key, value)) = map.next_entry::<String, StrictJsonValue>()? {
            if values.insert(key, value).is_some() {
                return Err(de::Error::custom("duplicate JSON object member"));
            }
        }
        Ok(StrictJsonValue::Object(values))
    }
}

impl StrictJsonValue {
    fn into_json(self) -> serde_json::Value {
        match self {
            Self::Null => serde_json::Value::Null,
            Self::Bool(value) => serde_json::Value::Bool(value),
            Self::Number(value) => serde_json::Value::Number(value),
            Self::String(value) => serde_json::Value::String(value),
            Self::Array(values) => {
                serde_json::Value::Array(values.into_iter().map(Self::into_json).collect())
            }
            Self::Object(values) => serde_json::Value::Object(
                values
                    .into_iter()
                    .map(|(key, value)| (key, value.into_json()))
                    .collect(),
            ),
        }
    }
}

fn strict_json(bytes: &[u8]) -> Result<serde_json::Value, QualificationOwnerError> {
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = StrictJsonValue::deserialize(&mut deserializer).map_err(json_error)?;
    deserializer.end().map_err(json_error)?;
    Ok(value.into_json())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        PostgresQualificationOwnerV1,
        postgres::{StoredIndependenceDispositionV1, StoredLineageResolutionV1, StoredRdBasisV1},
    };
    use rstest::rstest;
    use sqlx::PgPool;

    #[derive(Serialize)]
    struct TestRdBasisOutboxPayloadV1<'a> {
        schema_version: u32,
        basis_identity: &'a str,
        basis_digest: &'a str,
        receipt_identity: &'a str,
        principal: &'a str,
        request_scope: &'a [String],
        lineage_digest: &'a str,
    }

    #[rstest]
    fn strict_json_rejects_duplicate_members() {
        assert!(strict_json(b"{\"a\":1,\"a\":2}\n").is_err());
        assert!(strict_json(b"{\"a\":1}\n").is_ok());
    }

    #[rstest]
    fn frozen_evidence_recomputes_exact_canonical_vector() {
        let evidence = verify_evidence(Path::new(EVIDENCE_SESSION_RESOURCE)).unwrap();
        assert_eq!(
            evidence.projection.projection_identity(),
            PROJECTION_IDENTITY
        );
        assert_eq!(evidence.records.len(), EVIDENCE_RECORDS.len());
    }

    #[tokio::test]
    #[ignore = "requires explicit disposable QUALIFICATION_OWNER_RECOVERY_TEST_DATABASE_URL"]
    async fn isolated_postgres_recovery_is_atomic_fail_closed_and_replay_safe() {
        let database_url = env::var("QUALIFICATION_OWNER_RECOVERY_TEST_DATABASE_URL")
            .expect("explicit disposable Qualification recovery test database is required");
        assert_ne!(
            Some(database_url.as_str()),
            env::var("RD_OWNER_DATABASE_URL").ok().as_deref()
        );
        assert_ne!(
            Some(database_url.as_str()),
            env::var("DATABASE_URL").ok().as_deref()
        );

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(8)
            .connect(&database_url)
            .await
            .unwrap();
        let marker = sqlx::query(
            "SELECT current_database() AS database_name, current_user AS database_user",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(
            marker
                .try_get::<String, _>("database_name")
                .unwrap()
                .starts_with("qualification_owner_recovery_test_")
        );
        assert!(
            marker
                .try_get::<String, _>("database_user")
                .unwrap()
                .starts_with("qualification_owner_recovery_test_")
        );

        for statement in [
            "CREATE TABLE rd_independence_bases_v1 (basis_identity TEXT PRIMARY KEY, request_identity TEXT NOT NULL UNIQUE, principal TEXT NOT NULL, request_scope_json JSONB NOT NULL, lineage_digest TEXT NOT NULL, basis_digest TEXT NOT NULL, basis_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE rd_independence_basis_heads_v1 (principal_scope_key TEXT PRIMARY KEY, principal TEXT NOT NULL, request_scope_json JSONB NOT NULL, basis_identity TEXT NOT NULL UNIQUE REFERENCES rd_independence_bases_v1(basis_identity), lineage_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE rd_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (aggregate_identity, event_kind))",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        let owner = PostgresQualificationOwnerV1::connect(&database_url)
            .await
            .unwrap();
        seed_exact_rd_anchor(&pool).await;
        let evidence = verify_evidence(Path::new(EVIDENCE_SESSION_RESOURCE)).unwrap();
        let tool_sha = format!("sha256:{}", "1".repeat(64));

        let mut bad_evidence = evidence.clone();
        bad_evidence.records[0].output_sha256 = format!("sha256:{}", "0".repeat(64));
        assert!(
            recover(
                &database_url,
                TARGET_DATABASE_RESOURCE,
                AUTHORIZATION_LOCATOR,
                &tool_sha,
                &bad_evidence,
                FaultPoint::None,
            )
            .await
            .is_err()
        );
        assert!(
            recover(
                &database_url,
                "env:WRONG_DATABASE_URL",
                AUTHORIZATION_LOCATOR,
                &tool_sha,
                &evidence,
                FaultPoint::None,
            )
            .await
            .is_err()
        );
        assert!(
            recover(
                &database_url,
                TARGET_DATABASE_RESOURCE,
                "codex://threads/wrong",
                &tool_sha,
                &evidence,
                FaultPoint::None,
            )
            .await
            .is_err()
        );
        assert!(
            recover(
                &database_url,
                TARGET_DATABASE_RESOURCE,
                AUTHORIZATION_LOCATOR,
                "sha256:not-a-tool",
                &evidence,
                FaultPoint::None,
            )
            .await
            .is_err()
        );

        sqlx::query("UPDATE rd_independence_bases_v1 SET basis_digest = 'sha256:wrong' WHERE basis_identity = $1")
            .bind(BASIS_IDENTITY)
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            recover(
                &database_url,
                TARGET_DATABASE_RESOURCE,
                AUTHORIZATION_LOCATOR,
                &tool_sha,
                &evidence,
                FaultPoint::None,
            )
            .await
            .is_err()
        );
        sqlx::query(
            "UPDATE rd_independence_bases_v1 SET basis_digest = $1 WHERE basis_identity = $2",
        )
        .bind(BASIS_DIGEST)
        .bind(BASIS_IDENTITY)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query("CREATE TABLE qualification_owner_recovery_receipts_v1 (receipt_identity TEXT PRIMARY KEY, incident_identity TEXT NOT NULL UNIQUE, disposition TEXT NOT NULL, receipt_digest TEXT NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO qualification_owner_recovery_receipts_v1 VALUES ('partial','partial-incident','partial','sha256:partial','{}',0)")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            recover(
                &database_url,
                TARGET_DATABASE_RESOURCE,
                AUTHORIZATION_LOCATOR,
                &tool_sha,
                &evidence,
                FaultPoint::None,
            )
            .await
            .is_err()
        );
        sqlx::query("DROP TABLE qualification_owner_recovery_receipts_v1")
            .execute(&pool)
            .await
            .unwrap();

        for fault in [
            FaultPoint::Projection,
            FaultPoint::Head,
            FaultPoint::Outbox,
            FaultPoint::Receipt,
        ] {
            assert!(
                recover(
                    &database_url,
                    TARGET_DATABASE_RESOURCE,
                    AUTHORIZATION_LOCATOR,
                    &tool_sha,
                    &evidence,
                    fault,
                )
                .await
                .is_err()
            );
            assert_exact_counts(&pool, 0, 0, 0).await;
            assert!(
                !sqlx::query_scalar::<_, bool>(
                    "SELECT to_regclass('qualification_owner_recovery_receipts_v1') IS NOT NULL"
                )
                .fetch_one(&pool)
                .await
                .unwrap()
            );
        }

        let recovery_database_url = database_url.clone();
        let recovery_evidence = evidence.clone();
        let recovery_tool_sha = tool_sha.clone();
        let recovery_locked = RECOVERY_LOCKED_FOR_TEST.notified();

        let recovery = tokio::spawn(async move {
            recover(
                &recovery_database_url,
                TARGET_DATABASE_RESOURCE,
                AUTHORIZATION_LOCATOR,
                &recovery_tool_sha,
                &recovery_evidence,
                FaultPoint::DelayAfterLocks,
            )
            .await
        });
        recovery_locked.await;

        let ordinary = tokio::spawn(async move {
            owner
                .resolve_for_basis(&expected_basis_locator(), u64::MAX)
                .await
        });
        let receipt = recovery.await.unwrap().unwrap();
        assert!(ordinary.await.unwrap().is_err());
        assert_exact_counts(&pool, 1, 1, 1).await;
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM qualification_owner_recovery_receipts_v1",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );

        let replay = recover(
            &database_url,
            TARGET_DATABASE_RESOURCE,
            AUTHORIZATION_LOCATOR,
            &tool_sha,
            &evidence,
            FaultPoint::None,
        )
        .await
        .unwrap();
        assert_eq!(replay, receipt);
        assert_exact_counts(&pool, 1, 1, 1).await;

        let wrong_tool_sha = format!("sha256:{}", "2".repeat(64));
        assert!(
            recover(
                &database_url,
                TARGET_DATABASE_RESOURCE,
                AUTHORIZATION_LOCATOR,
                &wrong_tool_sha,
                &evidence,
                FaultPoint::None,
            )
            .await
            .is_err()
        );
        assert_exact_counts(&pool, 1, 1, 1).await;
    }

    async fn seed_exact_rd_anchor(pool: &PgPool) {
        let scope = expected_scope();
        let basis = StoredRdBasisV1 {
            schema_version: 1,
            basis_identity: BASIS_IDENTITY.to_string(),
            request_identity: REQUEST_IDENTITY.to_string(),
            principal: PRINCIPAL.to_string(),
            request_scope: scope.clone(),
            rationale_digest:
                "sha256:5f16ed9b33dba0e27b98d18462a389ef5aa7491be8286fbf07218316ae37d9ab"
                    .to_string(),
            independence_disposition: StoredIndependenceDispositionV1::Related,
            lineage_resolution: StoredLineageResolutionV1::CompleteFrontier,
            semantic_predecessor_frontier: vec![
                "rd-research-intent-v2-e4d4359b6fcd955a79ddd4e7b84d69681e1624abc40c2eaf43ed407a6805f044",
                "rd-research-intent-v2-621bf427e56f3330cc85d1576bd3f4abf42699094a94fda739bb9b8501400f93",
                "rd-research-intent-v2-06130f00df98e9bde152fc43dbb6c20ab4e6a33c5b11b4236bc1e2b9ff86a84c",
                "rd-research-intent-v2-ff31e4a2436e826b1774e8e766b29fb675b8d7dd1ddf70a5bc467f0ca1959110",
                "rd-research-intent-v2-d15b4c25bc03cfb499e61f72f0b6d7b047a38bb455903de42ccde78bc49ccba9",
                "rd-research-intent-v2-96fec4242a57a95514bad5d9056456dd8cb1d3bb50757424dd36633b08990f20",
                "rd-research-intent-v2-85a195fcce68e8b96733f1f1ffc7f2f31450b492615ccfe72e40e4e2a7dfd32b",
                "rd-research-intent-v2-a7a1601098d69123a359becce0271281a220050ffdee3f9ccb507594bdf15d67",
                "rd-research-intent-v2-882c44a2235e50de940893de3ef62123945249091e6c19e980335f7bcfa41303",
                "rd-research-intent-v2-81152f092ce4695dcdfefb7ab7e709af9576e8dafb7073f96b12dffceaf7ccb9",
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
            lineage_digest: BASIS_LINEAGE_DIGEST.to_string(),
            basis_digest: BASIS_DIGEST.to_string(),
        };
        let receipt = StoredRdBasisReceiptV1 {
            schema_version: 1,
            receipt_identity: BASIS_RECEIPT_IDENTITY.to_string(),
            basis_identity: BASIS_IDENTITY.to_string(),
            basis_digest: BASIS_DIGEST.to_string(),
            committed_at_epoch_ms: BASIS_COMMITTED_AT_EPOCH_MS,
        };
        let payload = TestRdBasisOutboxPayloadV1 {
            schema_version: 1,
            basis_identity: BASIS_IDENTITY,
            basis_digest: BASIS_DIGEST,
            receipt_identity: BASIS_RECEIPT_IDENTITY,
            principal: PRINCIPAL,
            request_scope: &scope,
            lineage_digest: BASIS_LINEAGE_DIGEST,
        };
        let payload_digest = canonical_digest("rd.owner-outbox.payload.v1", &payload).unwrap();
        sqlx::query("INSERT INTO rd_independence_bases_v1 (basis_identity,request_identity,principal,request_scope_json,lineage_digest,basis_digest,basis_json,receipt_json,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(BASIS_IDENTITY)
            .bind(REQUEST_IDENTITY)
            .bind(PRINCIPAL)
            .bind(serde_json::to_value(&scope).unwrap())
            .bind(BASIS_LINEAGE_DIGEST)
            .bind(BASIS_DIGEST)
            .bind(serde_json::to_value(&basis).unwrap())
            .bind(serde_json::to_value(&receipt).unwrap())
            .bind(i64::try_from(BASIS_COMMITTED_AT_EPOCH_MS).unwrap())
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO rd_independence_basis_heads_v1 (principal_scope_key,principal,request_scope_json,basis_identity,lineage_digest,committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(RD_PRINCIPAL_SCOPE_KEY)
            .bind(PRINCIPAL)
            .bind(serde_json::to_value(&scope).unwrap())
            .bind(BASIS_IDENTITY)
            .bind(BASIS_LINEAGE_DIGEST)
            .bind(i64::try_from(BASIS_COMMITTED_AT_EPOCH_MS).unwrap())
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO rd_owner_outbox_v1 (event_identity,aggregate_identity,event_kind,payload_digest,payload_json,committed_at_epoch_ms) VALUES ($1,$2,'INDEPENDENCE_BASIS_PRECOMMITTED_V1',$3,$4,$5)")
            .bind(identity("rd-owner-event-v1", &payload_digest))
            .bind(BASIS_IDENTITY)
            .bind(&payload_digest)
            .bind(serde_json::to_value(&payload).unwrap())
            .bind(i64::try_from(BASIS_COMMITTED_AT_EPOCH_MS).unwrap())
            .execute(pool)
            .await
            .unwrap();
    }

    async fn assert_exact_counts(pool: &PgPool, projections: i64, heads: i64, outbox: i64) {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM qualification_protected_feedback_projections_v1",
            )
            .fetch_one(pool)
            .await
            .unwrap(),
            projections
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM qualification_protected_feedback_heads_v1",
            )
            .fetch_one(pool)
            .await
            .unwrap(),
            heads
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM qualification_owner_outbox_v1",)
                .fetch_one(pool)
                .await
                .unwrap(),
            outbox
        );
    }
}
