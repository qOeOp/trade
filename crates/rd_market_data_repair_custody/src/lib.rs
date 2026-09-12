//! Fixed Market Data read custody for one R&D-owned repair request.
//!
//! The locator is an untrusted query. Positive custody is move-only and is issued only after the
//! fixed PostgreSQL function returns mutually consistent request, receipt, storage and outbox bytes.

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use thiserror::Error;

const LOCK_FUNCTION_V1: &str =
    "rd_owner_api.lock_market_data_repair_request_v1(text,text,text,text)";
/// Canonical body of the only R&D read function accepted by this custody boundary.
pub const MARKET_DATA_REPAIR_LOCK_FUNCTION_SOURCE_V1: &str = "DECLARE locked_request record; locked_outbox record; BEGIN IF session_user <> 'market_data_owner' OR pg_catalog.current_setting('transaction_isolation') <> 'serializable' THEN RETURN NULL; END IF; SELECT * INTO locked_request FROM public.rd_market_data_repair_requests_v1 WHERE request_identity=requested_request_identity AND request_digest=requested_request_digest AND receipt_json->>'receipt_identity'=requested_receipt_identity AND receipt_json->>'receipt_digest'=requested_receipt_digest FOR SHARE; IF NOT FOUND THEN RETURN NULL; END IF; SELECT aggregate_identity,event_kind,payload_json INTO STRICT locked_outbox FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=requested_request_identity AND event_kind='MARKET_DATA_REPAIR_REQUESTED_V1' FOR SHARE; RETURN pg_catalog.jsonb_build_object('schema_version',1,'request_json',locked_request.request_json,'receipt_json',locked_request.receipt_json,'request_storage_base64',pg_catalog.replace(pg_catalog.encode(locked_request.request_storage_bytes,'base64'),pg_catalog.chr(10),''),'request_storage_digest',locked_request.request_storage_digest,'receipt_storage_base64',pg_catalog.replace(pg_catalog.encode(locked_request.receipt_storage_bytes,'base64'),pg_catalog.chr(10),''),'receipt_storage_digest',locked_request.receipt_storage_digest,'outbox',pg_catalog.jsonb_build_object('aggregate_identity',locked_outbox.aggregate_identity,'event_kind',locked_outbox.event_kind,'payload_json',locked_outbox.payload_json)); END";
const REQUEST_STORAGE_DOMAIN_V1: &str = "rd.market-data-repair-request.storage.v1";
const RECEIPT_STORAGE_DOMAIN_V1: &str = "rd.market-data-repair-request-receipt.storage.v1";
const OUTBOX_EVENT_V1: &str = "MARKET_DATA_REPAIR_REQUESTED_V1";

/// Exact locator for an already-committed R&D repair request.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct SealedMarketDataRepairRequestLocatorV1 {
    pub request_identity: String,
    pub request_digest: String,
    pub receipt_identity: String,
    pub receipt_digest: String,
}

/// Move-only positive R&D custody exposed to Market Data.
#[derive(Debug)]
pub struct SealedMarketDataRepairRequestReadbackV1 {
    request_identity: String,
    request_digest: String,
    receipt_identity: String,
    receipt_digest: String,
    canonical_request_bytes: Vec<u8>,
    canonical_receipt_bytes: Vec<u8>,
    request: serde_json::Value,
}

/// Closed set of R&D request digests Market Data may compare with its own facts.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MarketDataRepairDigestCoordinateV1 {
    CorrelationIdentity,
    OriginalPitRequestIdentity,
    OriginalPitRequestDigest,
    OriginalPitSnapshotIdentity,
    OriginalPitProofDigest,
    InstrumentScopeDigest,
    UniverseSelectionDigest,
    InstrumentMasterDigest,
    ProvenanceBindingIdentity,
    ProvenanceBindingFactDigest,
    ProvenanceLineageRoot,
    SourceFrontierDigest,
    CorrectionFrontierDigest,
    MarketSemanticsIdentity,
}

impl SealedMarketDataRepairRequestReadbackV1 {
    #[must_use]
    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }

    #[must_use]
    pub fn request_digest(&self) -> &str {
        &self.request_digest
    }

    #[must_use]
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    #[must_use]
    pub fn receipt_digest(&self) -> &str {
        &self.receipt_digest
    }

    #[must_use]
    pub fn canonical_request_bytes(&self) -> &[u8] {
        &self.canonical_request_bytes
    }

    #[must_use]
    pub fn canonical_receipt_bytes(&self) -> &[u8] {
        &self.canonical_receipt_bytes
    }

    #[must_use]
    pub fn is_market_data_target(&self) -> bool {
        string_field(&self.request, "category") == "MARKET_DATA"
            && string_field(&self.request, "target") == "MARKET_DATA"
    }

    #[must_use]
    pub fn digest_coordinate(
        &self,
        coordinate: MarketDataRepairDigestCoordinateV1,
    ) -> Option<[u8; 32]> {
        digest_field(
            &self.request,
            match coordinate {
                MarketDataRepairDigestCoordinateV1::CorrelationIdentity => "correlation_identity",
                MarketDataRepairDigestCoordinateV1::OriginalPitRequestIdentity => {
                    "original_pit_request_identity"
                }
                MarketDataRepairDigestCoordinateV1::OriginalPitRequestDigest => {
                    "original_pit_request_digest"
                }
                MarketDataRepairDigestCoordinateV1::OriginalPitSnapshotIdentity => {
                    "original_pit_snapshot_identity"
                }
                MarketDataRepairDigestCoordinateV1::OriginalPitProofDigest => {
                    "original_pit_proof_digest"
                }
                MarketDataRepairDigestCoordinateV1::InstrumentScopeDigest => {
                    "instrument_scope_digest"
                }
                MarketDataRepairDigestCoordinateV1::UniverseSelectionDigest => {
                    "universe_selection_digest"
                }
                MarketDataRepairDigestCoordinateV1::InstrumentMasterDigest => {
                    "instrument_master_digest"
                }
                MarketDataRepairDigestCoordinateV1::ProvenanceBindingIdentity => {
                    "provenance_binding_identity"
                }
                MarketDataRepairDigestCoordinateV1::ProvenanceBindingFactDigest => {
                    "provenance_binding_fact_digest"
                }
                MarketDataRepairDigestCoordinateV1::ProvenanceLineageRoot => {
                    "provenance_lineage_root"
                }
                MarketDataRepairDigestCoordinateV1::SourceFrontierDigest => {
                    "source_frontier_digest"
                }
                MarketDataRepairDigestCoordinateV1::CorrectionFrontierDigest => {
                    "correction_frontier_digest"
                }
                MarketDataRepairDigestCoordinateV1::MarketSemanticsIdentity => {
                    "market_semantics_identity"
                }
            },
        )
    }

    #[must_use]
    pub fn provenance_lineage_version(&self) -> Option<u64> {
        self.request.get("provenance_lineage_version")?.as_u64()
    }

    #[must_use]
    pub fn original_time_evidence_matches(&self, value: &impl serde::Serialize) -> bool {
        serde_json::to_value(value)
            .ok()
            .as_ref()
            .is_some_and(|value| self.request.get("original_time_evidence") == Some(value))
    }
}

#[derive(Debug, Error)]
pub enum MarketDataRepairRequestCustodyErrorV1 {
    #[error("R&D Market Data repair request custody is unavailable")]
    Unavailable,
    #[error("R&D Market Data repair request storage is unavailable: {0}")]
    Storage(String),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedEnvelopeV1 {
    schema_version: u16,
    request_json: serde_json::Value,
    receipt_json: serde_json::Value,
    request_storage_base64: String,
    request_storage_digest: String,
    receipt_storage_base64: String,
    receipt_storage_digest: String,
    outbox: LockedOutboxV1,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedOutboxV1 {
    aggregate_identity: String,
    event_kind: String,
    payload_json: serde_json::Value,
}

/// Locks and verifies one exact request through the fixed `market_data_owner` PostgreSQL principal.
/// The caller retains the SERIALIZABLE transaction and this function performs no write.
pub async fn lock_market_data_repair_request_v1(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &SealedMarketDataRepairRequestLocatorV1,
) -> Result<SealedMarketDataRepairRequestReadbackV1, MarketDataRepairRequestCustodyErrorV1> {
    validate_locator(locator)?;
    validate_call_context(transaction).await?;
    validate_function_binding(transaction).await?;
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.lock_market_data_repair_request_v1($1,$2,$3,$4)")
            .bind(&locator.request_identity)
            .bind(&locator.request_digest)
            .bind(&locator.receipt_identity)
            .bind(&locator.receipt_digest)
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?;
    let envelope: LockedEnvelopeV1 =
        serde_json::from_value(value.ok_or(MarketDataRepairRequestCustodyErrorV1::Unavailable)?)
            .map_err(|_| MarketDataRepairRequestCustodyErrorV1::Unavailable)?;
    admit_envelope(locator, envelope)
}

fn admit_envelope(
    locator: &SealedMarketDataRepairRequestLocatorV1,
    envelope: LockedEnvelopeV1,
) -> Result<SealedMarketDataRepairRequestReadbackV1, MarketDataRepairRequestCustodyErrorV1> {
    if envelope.schema_version != 1 {
        return Err(MarketDataRepairRequestCustodyErrorV1::Unavailable);
    }
    let request_bytes = BASE64
        .decode(envelope.request_storage_base64)
        .map_err(|_| MarketDataRepairRequestCustodyErrorV1::Unavailable)?;
    let receipt_bytes = BASE64
        .decode(envelope.receipt_storage_base64)
        .map_err(|_| MarketDataRepairRequestCustodyErrorV1::Unavailable)?;
    let decoded_request: serde_json::Value = serde_json::from_slice(&request_bytes)
        .map_err(|_| MarketDataRepairRequestCustodyErrorV1::Unavailable)?;
    let decoded_receipt: serde_json::Value = serde_json::from_slice(&receipt_bytes)
        .map_err(|_| MarketDataRepairRequestCustodyErrorV1::Unavailable)?;
    if decoded_request != envelope.request_json
        || decoded_receipt != envelope.receipt_json
        || storage_digest(REQUEST_STORAGE_DOMAIN_V1, &request_bytes)
            != envelope.request_storage_digest
        || storage_digest(RECEIPT_STORAGE_DOMAIN_V1, &receipt_bytes)
            != envelope.receipt_storage_digest
        || string_field(&decoded_request, "request_identity") != locator.request_identity
        || string_field(&decoded_request, "request_digest") != locator.request_digest
        || string_field(&decoded_receipt, "receipt_identity") != locator.receipt_identity
        || string_field(&decoded_receipt, "receipt_digest") != locator.receipt_digest
        || string_field(&decoded_receipt, "request_identity") != locator.request_identity
        || string_field(&decoded_receipt, "request_digest") != locator.request_digest
        || envelope.outbox.aggregate_identity != locator.request_identity
        || envelope.outbox.event_kind != OUTBOX_EVENT_V1
        || string_field(&envelope.outbox.payload_json, "request_identity")
            != locator.request_identity
        || string_field(&envelope.outbox.payload_json, "request_digest") != locator.request_digest
        || string_field(&envelope.outbox.payload_json, "receipt_identity")
            != locator.receipt_identity
        || string_field(&envelope.outbox.payload_json, "receipt_digest") != locator.receipt_digest
    {
        return Err(MarketDataRepairRequestCustodyErrorV1::Unavailable);
    }
    Ok(SealedMarketDataRepairRequestReadbackV1 {
        request_identity: locator.request_identity.clone(),
        request_digest: locator.request_digest.clone(),
        receipt_identity: locator.receipt_identity.clone(),
        receipt_digest: locator.receipt_digest.clone(),
        canonical_request_bytes: request_bytes,
        canonical_receipt_bytes: receipt_bytes,
        request: decoded_request,
    })
}

fn validate_locator(
    locator: &SealedMarketDataRepairRequestLocatorV1,
) -> Result<(), MarketDataRepairRequestCustodyErrorV1> {
    if [
        locator.request_identity.as_str(),
        locator.request_digest.as_str(),
        locator.receipt_identity.as_str(),
        locator.receipt_digest.as_str(),
    ]
    .into_iter()
    .all(|value| !value.is_empty() && value.len() <= 512)
    {
        Ok(())
    } else {
        Err(MarketDataRepairRequestCustodyErrorV1::Unavailable)
    }
}

async fn validate_call_context(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), MarketDataRepairRequestCustodyErrorV1> {
    let exact: bool = sqlx::query_scalar(
        "SELECT session_user='market_data_owner'
             AND current_user='market_data_owner'
             AND pg_catalog.current_setting('transaction_isolation')='serializable'
             AND role.rolcanlogin
             AND role.rolinherit
             AND NOT (role.rolsuper OR role.rolcreatedb OR role.rolcreaterole
                      OR role.rolreplication OR role.rolbypassrls)
             AND NOT EXISTS (
               SELECT 1 FROM pg_catalog.pg_auth_members membership
                WHERE membership.roleid=role.oid OR membership.member=role.oid
             )
          FROM pg_catalog.pg_roles role
         WHERE role.rolname='market_data_owner'",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    if exact {
        Ok(())
    } else {
        Err(MarketDataRepairRequestCustodyErrorV1::Unavailable)
    }
}

async fn validate_function_binding(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), MarketDataRepairRequestCustodyErrorV1> {
    let exact: bool = sqlx::query_scalar(
        "SELECT role.rolname='rd_owner'
             AND procedure.prosecdef
             AND procedure.provolatile='v'
             AND procedure.proparallel='u'
             AND procedure.proisstrict
             AND procedure.proconfig=ARRAY['search_path=pg_catalog']::text[]
             AND procedure.prosrc=$2
             AND has_schema_privilege('market_data_owner','rd_owner_api','USAGE')
             AND has_function_privilege('market_data_owner', procedure.oid, 'EXECUTE')
             AND NOT has_function_privilege('public', procedure.oid, 'EXECUTE')
             AND NOT has_table_privilege('market_data_owner', 'public.rd_market_data_repair_requests_v1', 'SELECT')
             AND NOT has_table_privilege('market_data_owner', 'public.rd_owner_outbox_v1', 'SELECT')
             AND NOT EXISTS (
               SELECT 1 FROM pg_catalog.aclexplode(procedure.proacl) acl
                WHERE acl.privilege_type='EXECUTE'
                  AND acl.grantee NOT IN (
                    role.oid,
                    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='market_data_owner')
                  )
             )
          FROM pg_proc procedure
          JOIN pg_roles role ON role.oid=procedure.proowner
         WHERE procedure.oid=to_regprocedure($1)",
    )
    .bind(LOCK_FUNCTION_V1)
    .bind(MARKET_DATA_REPAIR_LOCK_FUNCTION_SOURCE_V1)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)?
    .unwrap_or(false);
    if exact {
        Ok(())
    } else {
        Err(MarketDataRepairRequestCustodyErrorV1::Unavailable)
    }
}

fn string_field<'a>(value: &'a serde_json::Value, field: &str) -> &'a str {
    value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
}

fn digest_field(value: &serde_json::Value, field: &str) -> Option<[u8; 32]> {
    let values = value.get(field)?.as_array()?;
    if values.len() != 32 {
        return None;
    }
    let bytes = values
        .iter()
        .map(|value| value.as_u64().and_then(|value| u8::try_from(value).ok()))
        .collect::<Option<Vec<_>>>()?;
    bytes.try_into().ok()
}

fn storage_digest(domain: &str, bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(domain.as_bytes());
    digest.update([0]);
    digest.update(bytes);
    format!("sha256:{:x}", digest.finalize())
}

fn storage(error: impl std::fmt::Display) -> MarketDataRepairRequestCustodyErrorV1 {
    MarketDataRepairRequestCustodyErrorV1::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_locator() {
        assert!(matches!(
            validate_locator(&SealedMarketDataRepairRequestLocatorV1 {
                request_identity: String::new(),
                request_digest: "sha256:digest".to_owned(),
                receipt_identity: "receipt".to_owned(),
                receipt_digest: "sha256:receipt".to_owned(),
            }),
            Err(MarketDataRepairRequestCustodyErrorV1::Unavailable)
        ));
    }

    fn fixture() -> (SealedMarketDataRepairRequestLocatorV1, LockedEnvelopeV1) {
        let request = serde_json::json!({
            "schema_version": 1,
            "request_identity": "request-1",
            "request_digest": "sha256:request",
            "receipt_identity": "ignored",
            "category": "MARKET_DATA",
            "target": "MARKET_DATA",
            "correlation_identity": vec![7_u8; 32],
            "original_time_evidence": {"clock": "fixed"}
        });
        let receipt = serde_json::json!({
            "schema_version": 1,
            "receipt_identity": "receipt-1",
            "receipt_digest": "sha256:receipt",
            "request_identity": "request-1",
            "request_digest": "sha256:request"
        });
        let request_bytes = serde_json::to_vec(&request).expect("request bytes");
        let receipt_bytes = serde_json::to_vec(&receipt).expect("receipt bytes");
        (
            SealedMarketDataRepairRequestLocatorV1 {
                request_identity: "request-1".to_owned(),
                request_digest: "sha256:request".to_owned(),
                receipt_identity: "receipt-1".to_owned(),
                receipt_digest: "sha256:receipt".to_owned(),
            },
            LockedEnvelopeV1 {
                schema_version: 1,
                request_json: request,
                receipt_json: receipt,
                request_storage_base64: BASE64.encode(&request_bytes),
                request_storage_digest: storage_digest(REQUEST_STORAGE_DOMAIN_V1, &request_bytes),
                receipt_storage_base64: BASE64.encode(&receipt_bytes),
                receipt_storage_digest: storage_digest(RECEIPT_STORAGE_DOMAIN_V1, &receipt_bytes),
                outbox: LockedOutboxV1 {
                    aggregate_identity: "request-1".to_owned(),
                    event_kind: OUTBOX_EVENT_V1.to_owned(),
                    payload_json: serde_json::json!({
                        "request_identity": "request-1",
                        "request_digest": "sha256:request",
                        "receipt_identity": "receipt-1",
                        "receipt_digest": "sha256:receipt"
                    }),
                },
            },
        )
    }

    #[test]
    fn exact_envelope_issues_move_only_readback() {
        let (locator, envelope) = fixture();
        let readback = admit_envelope(&locator, envelope).expect("sealed readback");
        assert!(readback.is_market_data_target());
        assert_eq!(
            readback.digest_coordinate(MarketDataRepairDigestCoordinateV1::CorrelationIdentity),
            Some([7; 32])
        );
        assert!(readback.original_time_evidence_matches(&serde_json::json!({"clock":"fixed"})));
    }

    #[test]
    fn storage_and_outbox_splices_fail_closed() {
        let (locator, mut storage_tamper) = fixture();
        storage_tamper.request_storage_digest = "sha256:tampered".to_owned();
        assert!(matches!(
            admit_envelope(&locator, storage_tamper),
            Err(MarketDataRepairRequestCustodyErrorV1::Unavailable)
        ));

        let (locator, mut outbox_tamper) = fixture();
        outbox_tamper.outbox.aggregate_identity = "another-request".to_owned();
        assert!(matches!(
            admit_envelope(&locator, outbox_tamper),
            Err(MarketDataRepairRequestCustodyErrorV1::Unavailable)
        ));
    }
}
