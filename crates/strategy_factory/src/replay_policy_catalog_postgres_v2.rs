//! Private PostgreSQL authority for the R&D Replay Policy Catalog.

use std::fmt::Display;

use base64::{Engine, engine::general_purpose::STANDARD as BASE64_STANDARD};
use ed25519_dalek::{Signature, VerifyingKey};
#[cfg(feature = "sealed-develop-composer-acceptance")]
use ed25519_dalek::{Signer, SigningKey};
use rust_decimal::{Decimal, prelude::ToPrimitive};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};

use crate::{
    replay_execution_policy_v2::ReplayExecutionPolicyV2,
    replay_policy_catalog_v2::{
        ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogBootstrapReceiptV1,
        ReplayPolicyCatalogErrorV2,
    },
    trial_family::TrialFamilyPolicyV1,
};

const CATALOG_ADMIN_LOCK_V2: i64 = 7_246_450_332_882_419_842;
const RD_OWNER_IDENTITY_V2: &str = "vibe-strategy-factory/rd-owner";
const BOOTSTRAP_SIGNATURE_DOMAIN_V1: &[u8] = b"rd.replay-policy-catalog-bootstrap-request.v1\0";
const BOOTSTRAP_AUTHENTICATION_FACT_DOMAIN_V1: &[u8] =
    b"rd.replay-policy-catalog-bootstrap-authentication-fact.v1\0";
const AUTHORITY_MIGRATION_SQL: &str =
    include_str!("../../../product/rd-workbench/postgres-init/10-migrate-authority-custody.sh");

const CATALOG_TABLES_V2: [&str; 4] = [
    "rd_replay_policy_catalog_records_v2",
    "rd_replay_policy_catalog_head_v2",
    "rd_replay_policy_catalog_revocations_v2",
    "rd_replay_policy_catalog_audit_v2",
];
const CATALOG_PUBLIC_TABLE_SPECS_V2: &[crate::schema_materialization::PublicTableSpec] = &[
    crate::schema_materialization::PublicTableSpec {
        name: "rd_replay_policy_catalog_records_v2",
        columns: &[
            crate::schema_materialization::required("catalog_record_id", "text"),
            crate::schema_materialization::required("catalog_version", "numeric(20,0)"),
            crate::schema_materialization::required("owner_identity", "text"),
            crate::schema_materialization::optional("predecessor_record_id", "text"),
            crate::schema_materialization::required("policy_grammar_parser_id", "text"),
            crate::schema_materialization::required("policy_grammar_parser_digest", "bytea"),
            crate::schema_materialization::required("policy_canonical_bytes", "bytea"),
            crate::schema_materialization::required("policy_digest", "bytea"),
            crate::schema_materialization::required("catalog_record_digest", "bytea"),
            crate::schema_materialization::required("created_by", "text"),
            crate::schema_materialization::required("created_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "c:catalog_record_digest:::false:false:true:(octet_length(catalog_record_digest) = 32)",
            "c:catalog_version:::false:false:true:((catalog_version > (0)::numeric) AND (catalog_version <= '18446744073709551615'::numeric))",
            "c:policy_digest:::false:false:true:(octet_length(policy_digest) = 32)",
            "c:policy_grammar_parser_digest:::false:false:true:(octet_length(policy_grammar_parser_digest) = 32)",
            "f:predecessor_record_id:public.rd_replay_policy_catalog_records_v2(catalog_record_id):a:a:s:false:false:true:",
            "p:catalog_record_id:::false:false:true:",
            "u:catalog_record_digest:::false:false:true:",
            "u:catalog_version:::false:false:true:",
            "u:predecessor_record_id:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("catalog_record_id"),
            crate::schema_materialization::unique_index("catalog_record_digest"),
            crate::schema_materialization::unique_index("catalog_version"),
            crate::schema_materialization::unique_index("predecessor_record_id"),
        ],
    },
    crate::schema_materialization::PublicTableSpec {
        name: "rd_replay_policy_catalog_head_v2",
        columns: &[
            crate::schema_materialization::defaulted("singleton", "boolean", "true"),
            crate::schema_materialization::required("catalog_record_id", "text"),
            crate::schema_materialization::required("catalog_version", "numeric(20,0)"),
            crate::schema_materialization::required("advanced_by", "text"),
            crate::schema_materialization::required("advanced_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "c:singleton:::false:false:true:singleton",
            "f:catalog_record_id:public.rd_replay_policy_catalog_records_v2(catalog_record_id):a:a:s:false:false:true:",
            "p:singleton:::false:false:true:",
            "u:catalog_record_id:::false:false:true:",
            "u:catalog_version:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("singleton"),
            crate::schema_materialization::unique_index("catalog_record_id"),
            crate::schema_materialization::unique_index("catalog_version"),
        ],
    },
    crate::schema_materialization::PublicTableSpec {
        name: "rd_replay_policy_catalog_revocations_v2",
        columns: &[
            crate::schema_materialization::required("catalog_record_id", "text"),
            crate::schema_materialization::required("catalog_version", "numeric(20,0)"),
            crate::schema_materialization::required("revoked_by", "text"),
            crate::schema_materialization::required("revoked_at_epoch_ms", "bigint"),
        ],
        constraints: &[
            "f:catalog_record_id:public.rd_replay_policy_catalog_records_v2(catalog_record_id):a:a:s:false:false:true:",
            "p:catalog_record_id:::false:false:true:",
            "u:catalog_version:::false:false:true:",
        ],
        indexes: &[
            crate::schema_materialization::primary_index("catalog_record_id"),
            crate::schema_materialization::unique_index("catalog_version"),
        ],
    },
    crate::schema_materialization::PublicTableSpec {
        name: "rd_replay_policy_catalog_audit_v2",
        columns: &[
            crate::schema_materialization::required("command_identity", "text"),
            crate::schema_materialization::required("administrator_identity", "text"),
            crate::schema_materialization::required("authentication_fact_digest", "text"),
            crate::schema_materialization::required("command_kind", "text"),
            crate::schema_materialization::optional("predecessor_record_id", "text"),
            crate::schema_materialization::optional("predecessor_head_record_id", "text"),
            crate::schema_materialization::optional("result_record_id", "text"),
            crate::schema_materialization::required("content_identity", "text"),
            crate::schema_materialization::required("audit_json", "jsonb"),
            crate::schema_materialization::required("committed_at_epoch_ms", "bigint"),
        ],
        constraints: &["p:command_identity:::false:false:true:"],
        indexes: &[crate::schema_materialization::primary_index(
            "command_identity",
        )],
    },
];

pub(crate) async fn migrate(pool: &PgPool) -> Result<(), ReplayPolicyCatalogErrorV2> {
    if crate::schema_materialization::pre_cutover_materialization_is_admitted(pool)
        .await
        .map_err(unavailable)?
    {
        for (relation_name, statement) in [
            (
                "rd_replay_policy_catalog_records_v2",
                "CREATE TABLE IF NOT EXISTS rd_replay_policy_catalog_records_v2 (catalog_record_id TEXT PRIMARY KEY, catalog_version NUMERIC(20,0) NOT NULL UNIQUE CHECK (catalog_version > 0 AND catalog_version <= 18446744073709551615), owner_identity TEXT NOT NULL, predecessor_record_id TEXT UNIQUE REFERENCES rd_replay_policy_catalog_records_v2(catalog_record_id), policy_grammar_parser_id TEXT NOT NULL, policy_grammar_parser_digest BYTEA NOT NULL CHECK (octet_length(policy_grammar_parser_digest) = 32), policy_canonical_bytes BYTEA NOT NULL, policy_digest BYTEA NOT NULL CHECK (octet_length(policy_digest) = 32), catalog_record_digest BYTEA NOT NULL UNIQUE CHECK (octet_length(catalog_record_digest) = 32), created_by TEXT NOT NULL, created_at_epoch_ms BIGINT NOT NULL)",
            ),
            (
                "rd_replay_policy_catalog_head_v2",
                "CREATE TABLE IF NOT EXISTS rd_replay_policy_catalog_head_v2 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), catalog_record_id TEXT NOT NULL UNIQUE REFERENCES rd_replay_policy_catalog_records_v2(catalog_record_id), catalog_version NUMERIC(20,0) NOT NULL UNIQUE, advanced_by TEXT NOT NULL, advanced_at_epoch_ms BIGINT NOT NULL)",
            ),
            (
                "rd_replay_policy_catalog_revocations_v2",
                "CREATE TABLE IF NOT EXISTS rd_replay_policy_catalog_revocations_v2 (catalog_record_id TEXT PRIMARY KEY REFERENCES rd_replay_policy_catalog_records_v2(catalog_record_id), catalog_version NUMERIC(20,0) NOT NULL UNIQUE, revoked_by TEXT NOT NULL, revoked_at_epoch_ms BIGINT NOT NULL)",
            ),
            (
                "rd_replay_policy_catalog_audit_v2",
                "CREATE TABLE IF NOT EXISTS rd_replay_policy_catalog_audit_v2 (command_identity TEXT PRIMARY KEY, administrator_identity TEXT NOT NULL, authentication_fact_digest TEXT NOT NULL, command_kind TEXT NOT NULL, predecessor_record_id TEXT, predecessor_head_record_id TEXT, result_record_id TEXT, content_identity TEXT NOT NULL, audit_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            ),
        ] {
            crate::schema_materialization::materialize_public_table(pool, relation_name, statement)
                .await
                .map_err(unavailable)?;
        }
        crate::schema_materialization::verify_materialized_public_tables(
            pool,
            CATALOG_PUBLIC_TABLE_SPECS_V2,
        )
        .await
        .map_err(unavailable)?;
        return Ok(());
    }
    verify_catalog_storage_authority(pool).await
}

/// Proof carried only inside the private R&D administration boundary.
pub(crate) struct AuthenticatedCatalogAdministratorV2 {
    identity: String,
    authentication_fact_digest: String,
}

impl AuthenticatedCatalogAdministratorV2 {
    fn from_verified(
        identity: &str,
        authentication_fact_digest: String,
    ) -> Result<Self, ReplayPolicyCatalogErrorV2> {
        require_identity(identity, "administrator identity")?;
        require_sha256(
            &authentication_fact_digest,
            "administrator authentication fact",
        )?;
        Ok(Self {
            identity: identity.to_owned(),
            authentication_fact_digest,
        })
    }

    #[cfg(test)]
    pub(crate) fn admit(
        identity: &str,
        authentication_fact_digest: &str,
    ) -> Result<Self, ReplayPolicyCatalogErrorV2> {
        require_identity(identity, "administrator identity")?;
        require_sha256(
            authentication_fact_digest,
            "administrator authentication fact",
        )?;
        Ok(Self {
            identity: identity.to_owned(),
            authentication_fact_digest: authentication_fact_digest.to_owned(),
        })
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SealedReplayPolicyCatalogBootstrapRequestV1 {
    schema_version: u16,
    bootstrap_identity: String,
    administrator_identity: String,
    verifier_identity: String,
    catalog_record_id: String,
    policy_canonical_bytes_base64: String,
    create_command_identity: String,
    advance_command_identity: String,
    now_epoch_ms: u64,
    signature_base64: String,
}

struct VerifiedReplayPolicyCatalogBootstrapRequestV1 {
    request: SealedReplayPolicyCatalogBootstrapRequestV1,
    policy: ReplayExecutionPolicyV2,
    authentication_fact_digest: String,
}

/// Creates or verifies the fixed, signed Catalog genesis used only by the sealed acceptance graph.
#[cfg(feature = "sealed-develop-composer-acceptance")]
pub(crate) async fn ensure_authenticated_sealed_acceptance_fixture_v1(
    pool: &PgPool,
) -> Result<ReplayPolicyCatalogBootstrapReceiptV1, ReplayPolicyCatalogErrorV2> {
    let fixture = authenticated_sealed_acceptance_fixture_v1()?;
    ensure_authenticated_replay_policy_catalog_genesis_v1(
        pool,
        &fixture.sealed_request,
        fixture.verifier_identity,
        &fixture.verifier_public_key_hex,
    )
    .await
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
pub(crate) fn authenticated_sealed_acceptance_fixture_v1() -> Result<
    crate::replay_policy_catalog_sealed_acceptance_v2::SealedCatalogFixtureV1,
    ReplayPolicyCatalogErrorV2,
> {
    const VERIFIER_IDENTITY: &str = "rd-catalog-sealed-acceptance-verifier-v1";

    let signing_key = SigningKey::from_bytes(&[11_u8; 32]);
    let policy = sealed_acceptance_policy()?;
    let policy_bytes = policy
        .canonical_bytes()
        .map_err(|e| ReplayPolicyCatalogErrorV2::InvalidPolicy(e.to_string()))?;
    let mut request = SealedReplayPolicyCatalogBootstrapRequestV1 {
        schema_version: 1,
        bootstrap_identity: "rd-catalog-sealed-acceptance-bootstrap-v1".to_owned(),
        administrator_identity: "rd-catalog-sealed-acceptance-administrator-v1".to_owned(),
        verifier_identity: VERIFIER_IDENTITY.to_owned(),
        catalog_record_id: "sealed-acceptance-replay-policy-v2".to_owned(),
        policy_canonical_bytes_base64: BASE64_STANDARD.encode(&policy_bytes),
        create_command_identity: "rd-catalog-sealed-acceptance-create-v1".to_owned(),
        advance_command_identity: "rd-catalog-sealed-acceptance-advance-v1".to_owned(),
        now_epoch_ms: 1,
        signature_base64: String::new(),
    };
    let canonical = bootstrap_request_canonical_bytes(&request, &policy_bytes)?;
    request.signature_base64 = BASE64_STANDARD.encode(signing_key.sign(&canonical).to_bytes());
    let sealed_request = serde_json::to_vec(&request).map_err(|e| {
        ReplayPolicyCatalogErrorV2::InvalidPolicy(format!(
            "sealed acceptance bootstrap serialization failed: {e}"
        ))
    })?;
    let verifier_key = bytes_hex(signing_key.verifying_key().as_bytes());

    Ok(
        crate::replay_policy_catalog_sealed_acceptance_v2::SealedCatalogFixtureV1 {
            sealed_request,
            verifier_identity: VERIFIER_IDENTITY,
            verifier_public_key_hex: verifier_key,
        },
    )
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
fn sealed_acceptance_policy() -> Result<ReplayExecutionPolicyV2, ReplayPolicyCatalogErrorV2> {
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayWindowV2, VersionedIdentityV2,
    };

    fn opaque(value: &str) -> Result<OpaqueIdentityV2, ReplayPolicyCatalogErrorV2> {
        OpaqueIdentityV2::try_from(value.to_owned())
            .map_err(|e| ReplayPolicyCatalogErrorV2::InvalidPolicy(e.to_string()))
    }

    fn versioned(value: &str) -> Result<VersionedIdentityV2, ReplayPolicyCatalogErrorV2> {
        Ok(VersionedIdentityV2 {
            identity: opaque(value)?,
            version: opaque("v1")?,
        })
    }

    fn content(value: &str) -> Result<ContentIdentityV2, ReplayPolicyCatalogErrorV2> {
        Ok(ContentIdentityV2 {
            identity: opaque(value)?,
            digest: CanonicalDigestV2::try_from(format!("sha256:{}", "b".repeat(64)))
                .map_err(|e| ReplayPolicyCatalogErrorV2::InvalidPolicy(e.to_string()))?,
        })
    }

    Ok(ReplayExecutionPolicyV2 {
        runtime_kernel: versioned("runtime-kernel-v2")?,
        simulator: versioned("simulator-v2")?,
        cost: versioned("cost-model-v1")?,
        slippage: versioned("slippage-model-v1")?,
        capacity: versioned("capacity-model-v1")?,
        runner_operational_profile: versioned("runner-profile-v2")?,
        diagnostic_policy: versioned("diagnostic-policy-v2")?,
        deterministic_seed: 1,
        window: ReplayWindowV2 {
            start_event_ns: 1,
            end_event_ns_exclusive: 2,
        },
        calendar: versioned("calendar-v2")?,
        session: versioned("session-v2")?,
        time_zone: versioned("time-zone-v2")?,
        correction_rule: versioned("correction-rule-v2")?,
        market_semantics: versioned("market-semantics-v2")?,
        replay_configuration: content("replay-configuration-v2")?,
        corporate_action_cut: content("corporate-action-cut-v2")?,
        historical_membership_cut: content("historical-membership-cut-v2")?,
    })
}

pub async fn ensure_authenticated_replay_policy_catalog_genesis_v1(
    pool: &PgPool,
    sealed_request_json: &[u8],
    trusted_verifier_identity: &str,
    trusted_verifier_public_key_hex: &str,
) -> Result<ReplayPolicyCatalogBootstrapReceiptV1, ReplayPolicyCatalogErrorV2> {
    let verified = verify_bootstrap_request(
        sealed_request_json,
        trusted_verifier_identity,
        trusted_verifier_public_key_hex,
    )?;
    verify_catalog_storage_authority(pool).await?;

    let request = &verified.request;
    let administrator = AuthenticatedCatalogAdministratorV2::from_verified(
        &request.administrator_identity,
        verified.authentication_fact_digest.clone(),
    )?;
    let desired =
        ReplayPolicyCatalogBindingV2::from_policy(&request.catalog_record_id, 1, &verified.policy)?;
    let mut transaction = pool.begin().await.map_err(unavailable)?;
    require_catalog_admin_writer_session(&mut transaction).await?;
    lock_catalog(&mut transaction).await?;

    match catalog_storage_shape(&mut transaction).await? {
        CatalogStorageShapeV2::Genesis => {
            let created = ReplayPolicyCatalogAdministrationPortV2::create_policy(
                &mut transaction,
                &administrator,
                &request.create_command_identity,
                &request.catalog_record_id,
                &verified.policy,
                request.now_epoch_ms,
            )
            .await?;

            if created != desired {
                return rollback_unavailable(transaction, "Catalog bootstrap create mismatch")
                    .await;
            }
            ReplayPolicyCatalogAdministrationPortV2::advance_current_head(
                &mut transaction,
                &administrator,
                &request.advance_command_identity,
                None,
                &request.catalog_record_id,
                request.now_epoch_ms,
            )
            .await?;
        }
        CatalogStorageShapeV2::Resolution => {}
        CatalogStorageShapeV2::Conflict => return rollback_conflict(transaction).await,
    }

    let receipt =
        exact_bootstrap_receipt(&mut transaction, &verified, &administrator, &desired).await?;
    transaction.commit().await.map_err(unavailable)?;
    Ok(receipt)
}

/// Authenticates the exact sealed genesis request, then proves the immutable Owner state without
/// acquiring any Catalog mutation capability.
pub async fn read_authenticated_replay_policy_catalog_genesis_v1(
    pool: &PgPool,
    sealed_request_json: &[u8],
    trusted_verifier_identity: &str,
    trusted_verifier_public_key_hex: &str,
) -> Result<ReplayPolicyCatalogBootstrapReceiptV1, ReplayPolicyCatalogErrorV2> {
    let verified = verify_bootstrap_request(
        sealed_request_json,
        trusted_verifier_identity,
        trusted_verifier_public_key_hex,
    )?;
    verify_catalog_storage_authority(pool).await?;
    let request = &verified.request;
    let administrator = AuthenticatedCatalogAdministratorV2::from_verified(
        &request.administrator_identity,
        verified.authentication_fact_digest.clone(),
    )?;
    let desired =
        ReplayPolicyCatalogBindingV2::from_policy(&request.catalog_record_id, 1, &verified.policy)?;
    let mut transaction = pool.begin().await.map_err(unavailable)?;
    require_rd_owner_session(&mut transaction).await?;
    lock_catalog(&mut transaction).await?;
    if catalog_storage_shape(&mut transaction).await? != CatalogStorageShapeV2::Resolution {
        return rollback_conflict(transaction).await;
    }
    let receipt =
        exact_bootstrap_receipt(&mut transaction, &verified, &administrator, &desired).await?;
    transaction.rollback().await.map_err(unavailable)?;
    Ok(receipt)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CatalogStorageShapeV2 {
    Genesis,
    Resolution,
    Conflict,
}

async fn catalog_storage_shape(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<CatalogStorageShapeV2, ReplayPolicyCatalogErrorV2> {
    let rows = sqlx::query(
        "SELECT * FROM replay_policy_catalog_api.lock_replay_policy_catalog_census_v2()",
    )
    .fetch_all(&mut **transaction)
    .await
    .map_err(unavailable)?;
    let [row] = rows.as_slice() else {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog census returned an invalid row count".to_owned(),
        ));
    };
    let counts = (
        row.try_get::<i64, _>("record_count").map_err(unavailable)?,
        row.try_get::<i64, _>("head_count").map_err(unavailable)?,
        row.try_get::<i64, _>("revocation_count")
            .map_err(unavailable)?,
        row.try_get::<i64, _>("audit_count").map_err(unavailable)?,
    );
    Ok(match counts {
        (0, 0, 0, 0) => CatalogStorageShapeV2::Genesis,
        (1, 1, 0, 2) => CatalogStorageShapeV2::Resolution,
        _ => CatalogStorageShapeV2::Conflict,
    })
}

async fn exact_bootstrap_receipt(
    transaction: &mut Transaction<'_, Postgres>,
    verified: &VerifiedReplayPolicyCatalogBootstrapRequestV1,
    administrator: &AuthenticatedCatalogAdministratorV2,
    desired: &ReplayPolicyCatalogBindingV2,
) -> Result<ReplayPolicyCatalogBootstrapReceiptV1, ReplayPolicyCatalogErrorV2> {
    if catalog_storage_shape(transaction).await? != CatalogStorageShapeV2::Resolution {
        return Err(ReplayPolicyCatalogErrorV2::Conflict);
    }
    let request = &verified.request;
    verify_bootstrap_audits(transaction, administrator, request, desired).await?;
    let final_record =
        load_record_with_provenance_by_id(transaction, &request.catalog_record_id).await?;
    let final_head = current_head_with_provenance(transaction).await?;
    let expected_epoch_ms = epoch_i64(request.now_epoch_ms)?;

    if &final_record.binding != desired
        || final_record.predecessor_record_id.is_some()
        || final_record.created_by != request.administrator_identity
        || final_record.created_at_epoch_ms != expected_epoch_ms
        || final_head
            .as_ref()
            .map(|head| (&head.catalog_record_id, head.catalog_version))
            != Some((&request.catalog_record_id, desired.catalog_version()))
        || final_head.as_ref().is_none_or(|head| {
            head.advanced_by != request.administrator_identity
                || head.advanced_at_epoch_ms != expected_epoch_ms
        })
        || is_revoked(transaction, &request.catalog_record_id).await?
    {
        return Err(ReplayPolicyCatalogErrorV2::Conflict);
    }
    Ok(ReplayPolicyCatalogBootstrapReceiptV1 {
        schema_version: 1,
        bootstrap_identity: request.bootstrap_identity.clone(),
        administrator_identity: request.administrator_identity.clone(),
        verifier_identity: request.verifier_identity.clone(),
        authentication_fact_digest: verified.authentication_fact_digest.clone(),
        catalog_binding: final_record.binding,
        create_command_identity: request.create_command_identity.clone(),
        advance_command_identity: request.advance_command_identity.clone(),
    })
}

fn verify_bootstrap_request(
    sealed_request_json: &[u8],
    trusted_verifier_identity: &str,
    trusted_verifier_public_key_hex: &str,
) -> Result<VerifiedReplayPolicyCatalogBootstrapRequestV1, ReplayPolicyCatalogErrorV2> {
    let request: SealedReplayPolicyCatalogBootstrapRequestV1 =
        serde_json::from_slice(sealed_request_json).map_err(|e| {
            ReplayPolicyCatalogErrorV2::InvalidPolicy(format!(
                "sealed bootstrap request is invalid: {e}"
            ))
        })?;

    if request.schema_version != 1 {
        return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(
            "bootstrap schema version must be 1",
        ));
    }

    for (value, label) in [
        (&request.bootstrap_identity, "bootstrap identity"),
        (&request.administrator_identity, "administrator identity"),
        (&request.verifier_identity, "verifier identity"),
        (&request.catalog_record_id, "catalog record identity"),
        (&request.create_command_identity, "create command identity"),
        (
            &request.advance_command_identity,
            "advance command identity",
        ),
    ] {
        require_identity(value, label)?;
    }
    require_identity(trusted_verifier_identity, "trusted verifier identity")?;

    if request.verifier_identity != trusted_verifier_identity {
        return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(
            "bootstrap verifier identity mismatch",
        ));
    }

    if request.create_command_identity == request.advance_command_identity {
        return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(
            "bootstrap command identities must be distinct",
        ));
    }
    require_command(&request.create_command_identity, request.now_epoch_ms)?;
    require_command(&request.advance_command_identity, request.now_epoch_ms)?;

    let policy_bytes = decode_canonical_base64(
        &request.policy_canonical_bytes_base64,
        "policy canonical bytes",
    )?;
    let policy = ReplayExecutionPolicyV2::parse_canonical(&policy_bytes)
        .map_err(|e| ReplayPolicyCatalogErrorV2::InvalidPolicy(e.to_string()))?;
    let signature_bytes =
        decode_canonical_base64(&request.signature_base64, "bootstrap signature")?;
    let signature = Signature::try_from(signature_bytes.as_slice()).map_err(|_| {
        ReplayPolicyCatalogErrorV2::InvalidRecord("bootstrap signature has invalid width")
    })?;
    let public_key_bytes = decode_lower_hex_32(trusted_verifier_public_key_hex)?;
    let verifying_key = VerifyingKey::from_bytes(&public_key_bytes).map_err(|_| {
        ReplayPolicyCatalogErrorV2::InvalidRecord("trusted verifier public key is invalid")
    })?;
    let canonical = bootstrap_request_canonical_bytes(&request, &policy_bytes)?;
    verifying_key
        .verify_strict(&canonical, &signature)
        .map_err(|_| {
            ReplayPolicyCatalogErrorV2::InvalidRecord("bootstrap signature verification failed")
        })?;

    let mut digest = Sha256::new();
    digest.update(BOOTSTRAP_AUTHENTICATION_FACT_DOMAIN_V1);
    digest.update(public_key_bytes);
    digest.update(&canonical);
    digest.update(signature.to_bytes());
    Ok(VerifiedReplayPolicyCatalogBootstrapRequestV1 {
        request,
        policy,
        authentication_fact_digest: format!("sha256:{:x}", digest.finalize()),
    })
}

fn bootstrap_request_canonical_bytes(
    request: &SealedReplayPolicyCatalogBootstrapRequestV1,
    policy_bytes: &[u8],
) -> Result<Vec<u8>, ReplayPolicyCatalogErrorV2> {
    let mut bytes = BOOTSTRAP_SIGNATURE_DOMAIN_V1.to_vec();

    for field in [
        request.schema_version.to_le_bytes().as_slice(),
        request.bootstrap_identity.as_bytes(),
        request.administrator_identity.as_bytes(),
        request.verifier_identity.as_bytes(),
        request.catalog_record_id.as_bytes(),
        policy_bytes,
        request.create_command_identity.as_bytes(),
        request.advance_command_identity.as_bytes(),
        request.now_epoch_ms.to_le_bytes().as_slice(),
    ] {
        let length = u32::try_from(field.len()).map_err(|_| {
            ReplayPolicyCatalogErrorV2::InvalidRecord("bootstrap canonical field length overflow")
        })?;
        bytes.extend_from_slice(&length.to_le_bytes());
        bytes.extend_from_slice(field);
    }
    Ok(bytes)
}

fn decode_canonical_base64(
    value: &str,
    label: &'static str,
) -> Result<Vec<u8>, ReplayPolicyCatalogErrorV2> {
    let decoded = BASE64_STANDARD
        .decode(value)
        .map_err(|_| ReplayPolicyCatalogErrorV2::InvalidRecord(label))?;
    if BASE64_STANDARD.encode(&decoded) != value {
        return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(label));
    }
    Ok(decoded)
}

fn decode_lower_hex_32(value: &str) -> Result<[u8; 32], ReplayPolicyCatalogErrorV2> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(
            "trusted verifier public key must be 32 lowercase hex bytes",
        ));
    }
    let mut output = [0_u8; 32];
    for (index, byte) in output.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).map_err(|_| {
            ReplayPolicyCatalogErrorV2::InvalidRecord("trusted verifier public key is invalid")
        })?;
    }
    Ok(output)
}

/// Sole private writer for Catalog records, head, revocations, and audit.
pub(crate) struct ReplayPolicyCatalogAdministrationPortV2;

impl ReplayPolicyCatalogAdministrationPortV2 {
    pub(crate) async fn create_policy(
        transaction: &mut Transaction<'_, Postgres>,
        administrator: &AuthenticatedCatalogAdministratorV2,
        command_identity: &str,
        catalog_record_id: &str,
        policy: &ReplayExecutionPolicyV2,
        now_epoch_ms: u64,
    ) -> Result<ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogErrorV2> {
        lock_catalog(transaction).await?;
        require_command(command_identity, now_epoch_ms)?;

        if load_record_by_id(transaction, "").await.is_ok() {
            return Err(ReplayPolicyCatalogErrorV2::Conflict);
        }
        let record = ReplayPolicyCatalogBindingV2::from_policy(catalog_record_id, 1, policy)?;
        apply_admin_fact(
            transaction,
            administrator,
            "create",
            command_identity,
            &record,
            None,
            None,
            now_epoch_ms,
        )
        .await?;

        if load_record_by_id(transaction, record.catalog_record_id()).await? != record {
            return Err(ReplayPolicyCatalogErrorV2::Unavailable(
                "Catalog create readback mismatch".to_owned(),
            ));
        }
        Ok(record)
    }

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "Catalog append remains private until a separately admitted administration composition uses it"
        )
    )]
    pub(crate) async fn append_version(
        transaction: &mut Transaction<'_, Postgres>,
        administrator: &AuthenticatedCatalogAdministratorV2,
        command_identity: &str,
        expected_predecessor_record_id: &str,
        catalog_record_id: &str,
        policy: &ReplayExecutionPolicyV2,
        now_epoch_ms: u64,
    ) -> Result<ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogErrorV2> {
        lock_catalog(transaction).await?;
        require_command(command_identity, now_epoch_ms)?;
        let latest = load_record_by_id(transaction, "").await?;
        let predecessor = latest.catalog_record_id().to_owned();
        let predecessor_version = latest.catalog_version();

        if predecessor != expected_predecessor_record_id {
            return Err(ReplayPolicyCatalogErrorV2::Conflict);
        }
        let version =
            predecessor_version
                .checked_add(1)
                .ok_or(ReplayPolicyCatalogErrorV2::InvalidRecord(
                    "catalog version overflow",
                ))?;
        let record = ReplayPolicyCatalogBindingV2::from_policy(catalog_record_id, version, policy)?;
        let predecessor_head = current_head_id(transaction).await?;
        apply_admin_fact(
            transaction,
            administrator,
            "append",
            command_identity,
            &record,
            Some(&predecessor),
            predecessor_head.as_deref(),
            now_epoch_ms,
        )
        .await?;

        if load_record_by_id(transaction, record.catalog_record_id()).await? != record {
            return Err(ReplayPolicyCatalogErrorV2::Unavailable(
                "Catalog append readback mismatch".to_owned(),
            ));
        }
        Ok(record)
    }

    pub(crate) async fn advance_current_head(
        transaction: &mut Transaction<'_, Postgres>,
        administrator: &AuthenticatedCatalogAdministratorV2,
        command_identity: &str,
        expected_head_record_id: Option<&str>,
        target_record_id: &str,
        now_epoch_ms: u64,
    ) -> Result<(), ReplayPolicyCatalogErrorV2> {
        lock_catalog(transaction).await?;
        require_command(command_identity, now_epoch_ms)?;
        let current = current_head(transaction).await?;
        if current.as_ref().map(|head| head.0.as_str()) != expected_head_record_id {
            return Err(ReplayPolicyCatalogErrorV2::Conflict);
        }
        let target = load_record_by_id(transaction, target_record_id).await?;
        if is_revoked(transaction, target_record_id).await?
            || current
                .as_ref()
                .is_some_and(|head| target.catalog_version() <= head.1)
        {
            return Err(ReplayPolicyCatalogErrorV2::Conflict);
        }
        apply_admin_fact(
            transaction,
            administrator,
            "advance",
            command_identity,
            &target,
            None,
            current.as_ref().map(|head| head.0.as_str()),
            now_epoch_ms,
        )
        .await?;

        if current_head(transaction).await?.as_ref()
            != Some(&(
                target.catalog_record_id().to_owned(),
                target.catalog_version(),
            ))
        {
            return Err(ReplayPolicyCatalogErrorV2::Unavailable(
                "Catalog head readback mismatch".to_owned(),
            ));
        }
        Ok(())
    }

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "Catalog revocation remains private until a separately admitted administration composition uses it"
        )
    )]
    pub(crate) async fn revoke_version(
        transaction: &mut Transaction<'_, Postgres>,
        administrator: &AuthenticatedCatalogAdministratorV2,
        command_identity: &str,
        catalog_record_id: &str,
        now_epoch_ms: u64,
    ) -> Result<(), ReplayPolicyCatalogErrorV2> {
        lock_catalog(transaction).await?;
        require_command(command_identity, now_epoch_ms)?;
        let record = load_record_by_id(transaction, catalog_record_id).await?;
        if is_revoked(transaction, catalog_record_id).await? {
            return Err(ReplayPolicyCatalogErrorV2::Conflict);
        }
        let head = current_head_id(transaction).await?;
        apply_admin_fact(
            transaction,
            administrator,
            "revoke",
            command_identity,
            &record,
            None,
            head.as_deref(),
            now_epoch_ms,
        )
        .await?;

        if !is_revoked(transaction, record.catalog_record_id()).await? {
            return Err(ReplayPolicyCatalogErrorV2::Unavailable(
                "Catalog revocation readback mismatch".to_owned(),
            ));
        }
        Ok(())
    }
}

/// Locks and validates the exact current unrevoked Catalog fact on the caller's transaction.
pub(crate) async fn resolve_current_for_trial_family_formation(
    transaction: &mut Transaction<'_, Postgres>,
    family_policy: &TrialFamilyPolicyV1,
) -> Result<ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogErrorV2> {
    lock_catalog(transaction).await?;
    let rows = sqlx::query(
        "SELECT * FROM replay_policy_catalog_api.lock_current_replay_policy_catalog_v2()",
    )
    .fetch_all(&mut **transaction)
    .await
    .map_err(unavailable)?;

    if rows.len() != 1 {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "current Catalog head is missing".to_owned(),
        ));
    }
    let row = &rows[0];
    if row.try_get::<bool, _>("revoked").map_err(unavailable)? {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "current Catalog head is revoked".to_owned(),
        ));
    }
    let record = decode_record(row)?;
    let head_record_id: String = row.try_get("head_record_id").map_err(unavailable)?;
    let head_version = decimal_version(row.try_get("head_version").map_err(unavailable)?)?;
    if head_record_id != record.catalog_record_id() || head_version != record.catalog_version() {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog head cross-binding mismatch".to_owned(),
        ));
    }
    let replay_policy = record.verify()?;
    if replay_policy.cost.identity.as_str() != family_policy.cost_model_identity
        || replay_policy.slippage.identity.as_str() != family_policy.slippage_model_identity
        || replay_policy.capacity.identity.as_str() != family_policy.capacity_model_identity
    {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog policy model profile does not match TrialFamily policy".to_owned(),
        ));
    }
    Ok(record)
}

async fn load_record_by_id(
    transaction: &mut Transaction<'_, Postgres>,
    catalog_record_id: &str,
) -> Result<ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogErrorV2> {
    let rows = sqlx::query(
        "SELECT * FROM replay_policy_catalog_api.lock_replay_policy_catalog_record_v2($1)",
    )
    .bind(catalog_record_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(unavailable)?;

    if rows.len() != 1 {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog record is missing".to_owned(),
        ));
    }
    decode_record(&rows[0])
}

struct CatalogRecordWithProvenanceV1 {
    binding: ReplayPolicyCatalogBindingV2,
    predecessor_record_id: Option<String>,
    created_by: String,
    created_at_epoch_ms: i64,
}

struct CatalogHeadProvenanceV1 {
    catalog_record_id: String,
    catalog_version: u64,
    advanced_by: String,
    advanced_at_epoch_ms: i64,
}

async fn load_record_with_provenance_by_id(
    transaction: &mut Transaction<'_, Postgres>,
    catalog_record_id: &str,
) -> Result<CatalogRecordWithProvenanceV1, ReplayPolicyCatalogErrorV2> {
    let rows = sqlx::query(
        "SELECT * FROM replay_policy_catalog_api.lock_replay_policy_catalog_record_v2($1)",
    )
    .bind(catalog_record_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(unavailable)?;
    let [row] = rows.as_slice() else {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog record is missing".to_owned(),
        ));
    };
    Ok(CatalogRecordWithProvenanceV1 {
        binding: decode_record(row)?,
        predecessor_record_id: row.try_get("predecessor_record_id").map_err(unavailable)?,
        created_by: row.try_get("created_by").map_err(unavailable)?,
        created_at_epoch_ms: row.try_get("created_at_epoch_ms").map_err(unavailable)?,
    })
}

async fn current_head_with_provenance(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<Option<CatalogHeadProvenanceV1>, ReplayPolicyCatalogErrorV2> {
    let rows = sqlx::query(
        "SELECT * FROM replay_policy_catalog_api.lock_current_replay_policy_catalog_v2()",
    )
    .fetch_all(&mut **transaction)
    .await
    .map_err(unavailable)?;

    match rows.as_slice() {
        [] => Ok(None),
        [row] => Ok(Some(CatalogHeadProvenanceV1 {
            catalog_record_id: row.try_get("head_record_id").map_err(unavailable)?,
            catalog_version: decimal_version(row.try_get("head_version").map_err(unavailable)?)?,
            advanced_by: row.try_get("advanced_by").map_err(unavailable)?,
            advanced_at_epoch_ms: row.try_get("advanced_at_epoch_ms").map_err(unavailable)?,
        })),
        _ => Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog has multiple current heads".to_owned(),
        )),
    }
}

fn decode_record(
    row: &sqlx::postgres::PgRow,
) -> Result<ReplayPolicyCatalogBindingV2, ReplayPolicyCatalogErrorV2> {
    let catalog_record_id: String = row.try_get("catalog_record_id").map_err(unavailable)?;
    let catalog_version = decimal_version(row.try_get("catalog_version").map_err(unavailable)?)?;
    let owner_identity: String = row.try_get("owner_identity").map_err(unavailable)?;
    if owner_identity != RD_OWNER_IDENTITY_V2 {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog record owner identity mismatch".to_owned(),
        ));
    }
    let grammar_id: String = row
        .try_get("policy_grammar_parser_id")
        .map_err(unavailable)?;
    let grammar_digest: Vec<u8> = row
        .try_get("policy_grammar_parser_digest")
        .map_err(unavailable)?;
    let policy_bytes: Vec<u8> = row.try_get("policy_canonical_bytes").map_err(unavailable)?;
    let policy_digest: Vec<u8> = row.try_get("policy_digest").map_err(unavailable)?;
    let record_digest: Vec<u8> = row.try_get("catalog_record_digest").map_err(unavailable)?;
    let binding = ReplayPolicyCatalogBindingV2::from_canonical_bytes(
        &catalog_record_id,
        catalog_version,
        &grammar_id,
        digest_array(grammar_digest, "grammar/parser digest")?,
        policy_bytes,
    )?;

    if binding.policy_digest().as_slice() != policy_digest
        || binding.catalog_record_digest().as_slice() != record_digest
    {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog relational/content digest mismatch".to_owned(),
        ));
    }
    Ok(binding)
}

async fn current_head(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<Option<(String, u64)>, ReplayPolicyCatalogErrorV2> {
    let rows = sqlx::query("SELECT catalog_record_id, catalog_version FROM replay_policy_catalog_api.lock_current_replay_policy_catalog_v2()")
        .fetch_all(&mut **transaction)
        .await
        .map_err(unavailable)?;

    match rows.as_slice() {
        [] => Ok(None),
        [row] => Ok(Some((
            row.try_get("catalog_record_id").map_err(unavailable)?,
            decimal_version(row.try_get("catalog_version").map_err(unavailable)?)?,
        ))),
        _ => Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog has multiple current heads".to_owned(),
        )),
    }
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "current head identity is retained only for the private append and revoke administration paths"
    )
)]
async fn current_head_id(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<Option<String>, ReplayPolicyCatalogErrorV2> {
    Ok(current_head(transaction).await?.map(|head| head.0))
}

async fn is_revoked(
    transaction: &mut Transaction<'_, Postgres>,
    catalog_record_id: &str,
) -> Result<bool, ReplayPolicyCatalogErrorV2> {
    let rows = sqlx::query(
        "SELECT revoked FROM replay_policy_catalog_api.lock_replay_policy_catalog_record_v2($1)",
    )
    .bind(catalog_record_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(unavailable)?;
    rows.as_slice()
        .first()
        .ok_or_else(|| {
            ReplayPolicyCatalogErrorV2::Unavailable("Catalog record is missing".to_owned())
        })?
        .try_get("revoked")
        .map_err(unavailable)
}

#[allow(clippy::too_many_arguments)]
async fn apply_admin_fact(
    transaction: &mut Transaction<'_, Postgres>,
    administrator: &AuthenticatedCatalogAdministratorV2,
    action: &str,
    command_identity: &str,
    record: &ReplayPolicyCatalogBindingV2,
    predecessor_record_id: Option<&str>,
    predecessor_head_record_id: Option<&str>,
    now_epoch_ms: u64,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    let writer_session: bool =
        sqlx::query_scalar("SELECT SESSION_USER='replay_policy_catalog_admin_writer'")
            .fetch_one(&mut **transaction)
            .await
            .map_err(unavailable)?;

    if !writer_session {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog mutation requires the Replay Policy Catalog admin writer".to_owned(),
        ));
    }
    let content_identity = content_identity(record);
    let audit = CatalogAdminAuditV2 {
        schema_version: 2,
        command_identity: command_identity.to_owned(),
        administrator_identity: administrator.identity.clone(),
        authentication_fact_digest: administrator.authentication_fact_digest.clone(),
        command_kind: action.to_owned(),
        predecessor_record_id: predecessor_record_id.map(str::to_owned),
        predecessor_head_record_id: predecessor_head_record_id.map(str::to_owned),
        result_record_id: Some(record.catalog_record_id().to_owned()),
        content_identity: content_identity.clone(),
        committed_at_epoch_ms: now_epoch_ms,
    };
    let audit_json = serde_json::to_value(&audit).map_err(unavailable)?;
    let accepted: bool = sqlx::query_scalar("SELECT replay_policy_catalog_api.apply_replay_policy_catalog_command_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)")
        .bind(action)
        .bind(command_identity)
        .bind(&administrator.identity)
        .bind(&administrator.authentication_fact_digest)
        .bind(record.catalog_record_id())
        .bind(Decimal::from(record.catalog_version()))
        .bind(predecessor_record_id)
        .bind(record.policy_grammar_parser_id())
        .bind(record.policy_grammar_parser_digest().as_slice())
        .bind(record.policy_canonical_bytes())
        .bind(record.policy_digest().as_slice())
        .bind(record.catalog_record_digest().as_slice())
        .bind(predecessor_head_record_id.unwrap_or(""))
        .bind(&content_identity)
        .bind(&audit_json)
        .bind(epoch_i64(now_epoch_ms)?)
        .fetch_one(&mut **transaction)
        .await
        .map_err(unavailable)?;

    if accepted {
        Ok(())
    } else {
        Err(ReplayPolicyCatalogErrorV2::Conflict)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct CatalogAdminAuditV2 {
    schema_version: u16,
    command_identity: String,
    administrator_identity: String,
    authentication_fact_digest: String,
    command_kind: String,
    predecessor_record_id: Option<String>,
    predecessor_head_record_id: Option<String>,
    result_record_id: Option<String>,
    content_identity: String,
    committed_at_epoch_ms: u64,
}

async fn require_catalog_admin_writer_session(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    let exact: bool =
        sqlx::query_scalar("SELECT SESSION_USER='replay_policy_catalog_admin_writer'")
            .fetch_one(&mut **transaction)
            .await
            .map_err(unavailable)?;

    if exact {
        Ok(())
    } else {
        Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog bootstrap requires the Replay Policy Catalog admin writer".to_owned(),
        ))
    }
}

async fn require_rd_owner_session(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    let exact: bool = sqlx::query_scalar("SELECT SESSION_USER='rd_owner'")
        .fetch_one(&mut **transaction)
        .await
        .map_err(unavailable)?;

    if exact {
        Ok(())
    } else {
        Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog readback requires the R&D Owner".to_owned(),
        ))
    }
}

async fn verify_bootstrap_audits(
    transaction: &mut Transaction<'_, Postgres>,
    administrator: &AuthenticatedCatalogAdministratorV2,
    request: &SealedReplayPolicyCatalogBootstrapRequestV1,
    record: &ReplayPolicyCatalogBindingV2,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    let content_identity = content_identity(record);

    for (command_identity, command_kind) in [
        (request.create_command_identity.as_str(), "create"),
        (request.advance_command_identity.as_str(), "advance"),
    ] {
        let expected = CatalogAdminAuditV2 {
            schema_version: 2,
            command_identity: command_identity.to_owned(),
            administrator_identity: administrator.identity.clone(),
            authentication_fact_digest: administrator.authentication_fact_digest.clone(),
            command_kind: command_kind.to_owned(),
            predecessor_record_id: None,
            predecessor_head_record_id: None,
            result_record_id: Some(record.catalog_record_id().to_owned()),
            content_identity: content_identity.clone(),
            committed_at_epoch_ms: request.now_epoch_ms,
        };
        let rows = sqlx::query(
            "SELECT * FROM replay_policy_catalog_api.read_replay_policy_catalog_audit_v2($1)",
        )
        .bind(command_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(unavailable)?;
        let [row] = rows.as_slice() else {
            return Err(ReplayPolicyCatalogErrorV2::Conflict);
        };
        let audit_json: serde_json::Value = row.try_get("audit_json").map_err(unavailable)?;
        let audit: CatalogAdminAuditV2 =
            serde_json::from_value(audit_json.clone()).map_err(unavailable)?;

        if audit != expected
            || row
                .try_get::<String, _>("administrator_identity")
                .map_err(unavailable)?
                != expected.administrator_identity
            || row
                .try_get::<String, _>("authentication_fact_digest")
                .map_err(unavailable)?
                != expected.authentication_fact_digest
            || row
                .try_get::<String, _>("command_kind")
                .map_err(unavailable)?
                != expected.command_kind
            || row
                .try_get::<Option<String>, _>("predecessor_record_id")
                .map_err(unavailable)?
                != expected.predecessor_record_id
            || row
                .try_get::<Option<String>, _>("predecessor_head_record_id")
                .map_err(unavailable)?
                != expected.predecessor_head_record_id
            || row
                .try_get::<Option<String>, _>("result_record_id")
                .map_err(unavailable)?
                != expected.result_record_id
            || row
                .try_get::<String, _>("content_identity")
                .map_err(unavailable)?
                != expected.content_identity
            || row
                .try_get::<i64, _>("committed_at_epoch_ms")
                .map_err(unavailable)?
                != epoch_i64(expected.committed_at_epoch_ms)?
            || audit_json != serde_json::to_value(&expected).map_err(unavailable)?
        {
            return Err(ReplayPolicyCatalogErrorV2::Conflict);
        }
    }
    Ok(())
}

async fn rollback_conflict(
    transaction: Transaction<'_, Postgres>,
) -> Result<ReplayPolicyCatalogBootstrapReceiptV1, ReplayPolicyCatalogErrorV2> {
    transaction.rollback().await.map_err(unavailable)?;
    Err(ReplayPolicyCatalogErrorV2::Conflict)
}

async fn rollback_unavailable(
    transaction: Transaction<'_, Postgres>,
    message: &str,
) -> Result<ReplayPolicyCatalogBootstrapReceiptV1, ReplayPolicyCatalogErrorV2> {
    transaction.rollback().await.map_err(unavailable)?;
    Err(ReplayPolicyCatalogErrorV2::Unavailable(message.to_owned()))
}

async fn verify_catalog_storage_authority(pool: &PgPool) -> Result<(), ReplayPolicyCatalogErrorV2> {
    let authority_is_exact: bool = sqlx::query_scalar(
        "WITH owner AS (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='replay_policy_catalog_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls), callers AS (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('rd_owner','replay_policy_catalog_admin_writer','rd_fact_writer')), relations AS (SELECT relation.oid,relation.relowner,relation.relacl,relation.relpersistence FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relname=ANY($1) AND relation.relkind='r'), routines AS (SELECT procedure.proname,procedure.proowner,procedure.prosecdef,procedure.provolatile,procedure.proparallel,procedure.proconfig,procedure.proacl FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='replay_policy_catalog_api' AND procedure.proname IN ('lock_replay_policy_catalog_census_v2','lock_replay_policy_catalog_record_v2','lock_current_replay_policy_catalog_v2','read_replay_policy_catalog_audit_v2','apply_replay_policy_catalog_command_v2')) SELECT SESSION_USER IN ('rd_owner','replay_policy_catalog_admin_writer') AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='rd_owner' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls) AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='replay_policy_catalog_admin_writer' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls) AND (SELECT count(*)=4 AND bool_and(relpersistence='p' AND relowner=(SELECT oid FROM owner)) AND NOT bool_or(EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(relacl,pg_catalog.acldefault('r',relowner))) acl WHERE acl.grantee<>relowner)) FROM relations) AND (SELECT count(*)=5 AND bool_and(proowner=(SELECT oid FROM owner) AND prosecdef AND provolatile='v' AND proparallel='u' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) acl WHERE acl.privilege_type<>'EXECUTE' OR (acl.grantee<>proowner AND (acl.is_grantable OR (proname='apply_replay_policy_catalog_command_v2' AND acl.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='replay_policy_catalog_admin_writer')) OR (proname<>'apply_replay_policy_catalog_command_v2' AND acl.grantee NOT IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('rd_owner','replay_policy_catalog_admin_writer'))))))) FROM routines) AND NOT EXISTS (SELECT 1 FROM callers WHERE pg_catalog.pg_has_role(callers.oid,(SELECT oid FROM owner),'MEMBER') OR pg_catalog.pg_has_role((SELECT oid FROM owner),callers.oid,'MEMBER')) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members membership JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid JOIN pg_catalog.pg_roles member ON member.oid=membership.member WHERE granted.rolname IN ('rd_owner','replay_policy_catalog_admin_writer','rd_fact_writer') OR member.rolname IN ('rd_owner','replay_policy_catalog_admin_writer','rd_fact_writer'))",
    )
    .bind(CATALOG_TABLES_V2.as_slice())
    .fetch_one(pool)
    .await
    .map_err(unavailable)?;

    if !authority_is_exact {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog PostgreSQL owner or ACL readback mismatch".to_owned(),
        ));
    }
    let column_shape = sqlx::query_scalar::<_, String>("SELECT relation.relname||':'||attribute.attnum||':'||attribute.attname||':'||pg_catalog.format_type(attribute.atttypid,attribute.atttypmod)||':'||attribute.attnotnull||':'||COALESCE(pg_catalog.pg_get_expr(default_fact.adbin,default_fact.adrelid),'') FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped LEFT JOIN pg_catalog.pg_attrdef default_fact ON default_fact.adrelid=relation.oid AND default_fact.adnum=attribute.attnum WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relname=ANY($1) ORDER BY relation.relname,attribute.attnum")
        .bind(CATALOG_TABLES_V2.as_slice()).fetch_all(pool).await.map_err(unavailable)?;
    let expected_column_shape = [
        "rd_replay_policy_catalog_audit_v2:1:command_identity:text:true:",
        "rd_replay_policy_catalog_audit_v2:2:administrator_identity:text:true:",
        "rd_replay_policy_catalog_audit_v2:3:authentication_fact_digest:text:true:",
        "rd_replay_policy_catalog_audit_v2:4:command_kind:text:true:",
        "rd_replay_policy_catalog_audit_v2:5:predecessor_record_id:text:false:",
        "rd_replay_policy_catalog_audit_v2:6:predecessor_head_record_id:text:false:",
        "rd_replay_policy_catalog_audit_v2:7:result_record_id:text:false:",
        "rd_replay_policy_catalog_audit_v2:8:content_identity:text:true:",
        "rd_replay_policy_catalog_audit_v2:9:audit_json:jsonb:true:",
        "rd_replay_policy_catalog_audit_v2:10:committed_at_epoch_ms:bigint:true:",
        "rd_replay_policy_catalog_head_v2:1:singleton:boolean:true:true",
        "rd_replay_policy_catalog_head_v2:2:catalog_record_id:text:true:",
        "rd_replay_policy_catalog_head_v2:3:catalog_version:numeric(20,0):true:",
        "rd_replay_policy_catalog_head_v2:4:advanced_by:text:true:",
        "rd_replay_policy_catalog_head_v2:5:advanced_at_epoch_ms:bigint:true:",
        "rd_replay_policy_catalog_records_v2:1:catalog_record_id:text:true:",
        "rd_replay_policy_catalog_records_v2:2:catalog_version:numeric(20,0):true:",
        "rd_replay_policy_catalog_records_v2:3:owner_identity:text:true:",
        "rd_replay_policy_catalog_records_v2:4:predecessor_record_id:text:false:",
        "rd_replay_policy_catalog_records_v2:5:policy_grammar_parser_id:text:true:",
        "rd_replay_policy_catalog_records_v2:6:policy_grammar_parser_digest:bytea:true:",
        "rd_replay_policy_catalog_records_v2:7:policy_canonical_bytes:bytea:true:",
        "rd_replay_policy_catalog_records_v2:8:policy_digest:bytea:true:",
        "rd_replay_policy_catalog_records_v2:9:catalog_record_digest:bytea:true:",
        "rd_replay_policy_catalog_records_v2:10:created_by:text:true:",
        "rd_replay_policy_catalog_records_v2:11:created_at_epoch_ms:bigint:true:",
        "rd_replay_policy_catalog_revocations_v2:1:catalog_record_id:text:true:",
        "rd_replay_policy_catalog_revocations_v2:2:catalog_version:numeric(20,0):true:",
        "rd_replay_policy_catalog_revocations_v2:3:revoked_by:text:true:",
        "rd_replay_policy_catalog_revocations_v2:4:revoked_at_epoch_ms:bigint:true:",
    ];

    if column_shape
        .iter()
        .map(String::as_str)
        .ne(expected_column_shape)
    {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog column shape readback mismatch".to_owned(),
        ));
    }
    let dependency_shape_is_exact: bool = sqlx::query_scalar("WITH family AS (SELECT relation.oid,relation.relname FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relname=ANY($1)) SELECT (SELECT count(*)=10 AND NOT bool_or((family.relname,constraint_fact.contype::text,pg_catalog.array_to_string(constraint_fact.conkey,' ')) NOT IN (VALUES ('rd_replay_policy_catalog_records_v2','p','1'),('rd_replay_policy_catalog_records_v2','u','2'),('rd_replay_policy_catalog_records_v2','u','4'),('rd_replay_policy_catalog_records_v2','u','9'),('rd_replay_policy_catalog_head_v2','p','1'),('rd_replay_policy_catalog_head_v2','u','2'),('rd_replay_policy_catalog_head_v2','u','3'),('rd_replay_policy_catalog_revocations_v2','p','1'),('rd_replay_policy_catalog_revocations_v2','u','2'),('rd_replay_policy_catalog_audit_v2','p','1'))) FROM pg_catalog.pg_constraint constraint_fact JOIN family ON family.oid=constraint_fact.conrelid WHERE constraint_fact.contype IN ('p','u')) AND (SELECT count(*)=3 AND NOT bool_or((source.relname,pg_catalog.array_to_string(constraint_fact.conkey,' '),target.relname,pg_catalog.array_to_string(constraint_fact.confkey,' ')) NOT IN (VALUES ('rd_replay_policy_catalog_records_v2','4','rd_replay_policy_catalog_records_v2','1'),('rd_replay_policy_catalog_head_v2','2','rd_replay_policy_catalog_records_v2','1'),('rd_replay_policy_catalog_revocations_v2','1','rd_replay_policy_catalog_records_v2','1'))) FROM pg_catalog.pg_constraint constraint_fact JOIN family source ON source.oid=constraint_fact.conrelid JOIN family target ON target.oid=constraint_fact.confrelid WHERE constraint_fact.contype='f') AND (SELECT count(*)=5 AND bool_and(pg_catalog.pg_get_expr(constraint_fact.conbin,constraint_fact.conrelid) IN ('singleton','(octet_length(policy_grammar_parser_digest) = 32)','(octet_length(policy_digest) = 32)','(octet_length(catalog_record_digest) = 32)','((catalog_version > (0)::numeric) AND (catalog_version <= ''18446744073709551615''::numeric))')) FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conrelid IN (SELECT oid FROM family) AND constraint_fact.contype='c') AND (SELECT count(*)=10 AND bool_and(index_fact.indisvalid AND index_fact.indisready AND index_fact.indislive AND index_fact.indisunique AND index_fact.indexprs IS NULL AND index_fact.indpred IS NULL AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conindid=index_fact.indexrelid)) FROM pg_catalog.pg_index index_fact WHERE index_fact.indrelid IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint inbound WHERE inbound.confrelid IN (SELECT oid FROM family) AND inbound.conrelid NOT IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint outbound WHERE outbound.conrelid IN (SELECT oid FROM family) AND outbound.contype='f' AND outbound.confrelid NOT IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_rel publication WHERE publication.prrelid IN (SELECT oid FROM family)) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rewrite WHERE rewrite.ev_class IN (SELECT oid FROM family))")
        .bind(CATALOG_TABLES_V2.as_slice()).fetch_one(pool).await.map_err(unavailable)?;

    if !dependency_shape_is_exact {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog constraint or dependency readback mismatch".to_owned(),
        ));
    }
    let constraint_options_are_exact: bool = sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint constraint_fact JOIN pg_catalog.pg_class relation ON relation.oid=constraint_fact.conrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relname=ANY($1) AND (NOT constraint_fact.convalidated OR constraint_fact.condeferrable OR constraint_fact.condeferred OR constraint_fact.connoinherit<>(constraint_fact.contype IN ('p','u','f')) OR (constraint_fact.contype='f' AND (constraint_fact.confupdtype<>'a' OR constraint_fact.confdeltype<>'a' OR constraint_fact.confmatchtype<>'s'))))")
        .bind(CATALOG_TABLES_V2.as_slice()).fetch_one(pool).await.map_err(unavailable)?;

    if !constraint_options_are_exact {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog constraint option manifest mismatch".to_owned(),
        ));
    }
    let index_options_are_exact: bool = sqlx::query_scalar("SELECT count(*)=10 AND bool_and(index_fact.indisvalid AND index_fact.indisready AND index_fact.indislive AND index_fact.indisunique AND NOT index_fact.indnullsnotdistinct AND index_fact.indexprs IS NULL AND index_fact.indpred IS NULL AND index_method.amname='btree' AND index_relation.relpersistence='p' AND index_relation.reltablespace=0 AND index_relation.reloptions IS NULL AND pg_catalog.pg_get_userbyid(index_relation.relowner)='replay_policy_catalog_owner' AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indclass::oid[]) class_oid JOIN pg_catalog.pg_opclass operator_class ON operator_class.oid=class_oid WHERE NOT operator_class.opcdefault) AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indoption::smallint[]) option_value WHERE option_value<>0) AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indkey::smallint[],index_fact.indcollation::oid[]) key_fact(attnum,collation_oid) JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=index_fact.indrelid AND attribute.attnum=key_fact.attnum WHERE key_fact.collation_oid<>attribute.attcollation)) FROM pg_catalog.pg_index index_fact JOIN pg_catalog.pg_class relation ON relation.oid=index_fact.indrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace JOIN pg_catalog.pg_class index_relation ON index_relation.oid=index_fact.indexrelid JOIN pg_catalog.pg_am index_method ON index_method.oid=index_relation.relam WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relname=ANY($1)")
        .bind(CATALOG_TABLES_V2.as_slice()).fetch_one(pool).await.map_err(unavailable)?;

    if !index_options_are_exact {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog index option manifest mismatch".to_owned(),
        ));
    }
    let routines = sqlx::query("SELECT procedure.proname, procedure.prosrc, language.lanname, procedure.prokind='f' AS kind_exact, procedure.proretset, procedure.prosecdef, procedure.provolatile='v' AS volatile_exact, procedure.proparallel='u' AS parallel_exact, procedure.proisstrict, procedure.proconfig FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang WHERE namespace.nspname='replay_policy_catalog_api' AND procedure.proname=ANY($1) ORDER BY procedure.proname")
        .bind(["apply_replay_policy_catalog_command_v2", "lock_current_replay_policy_catalog_v2", "lock_replay_policy_catalog_census_v2", "lock_replay_policy_catalog_record_v2", "read_replay_policy_catalog_audit_v2"])
        .fetch_all(pool).await.map_err(unavailable)?;
    let expected = [
        (
            "apply_replay_policy_catalog_command_v2",
            "catalog_apply",
            "plpgsql",
            false,
            false,
        ),
        (
            "lock_current_replay_policy_catalog_v2",
            "catalog_current",
            "sql",
            true,
            false,
        ),
        (
            "lock_replay_policy_catalog_census_v2",
            "catalog_census",
            "plpgsql",
            true,
            false,
        ),
        (
            "lock_replay_policy_catalog_record_v2",
            "catalog_read",
            "sql",
            true,
            true,
        ),
        (
            "read_replay_policy_catalog_audit_v2",
            "catalog_audit_read",
            "sql",
            true,
            true,
        ),
    ];

    if routines.len() != expected.len()
        || routines
            .iter()
            .zip(expected)
            .any(|(row, (name, tag, language, returns_set, strict))| {
                row.try_get::<String, _>("proname").ok().as_deref() != Some(name)
                    || row.try_get::<String, _>("prosrc").ok().as_deref()
                        != migration_function_source(tag)
                    || row.try_get::<String, _>("lanname").ok().as_deref() != Some(language)
                    || row.try_get::<bool, _>("kind_exact").ok() != Some(true)
                    || row.try_get::<bool, _>("proretset").ok() != Some(returns_set)
                    || row.try_get::<bool, _>("prosecdef").ok() != Some(true)
                    || row.try_get::<bool, _>("volatile_exact").ok() != Some(true)
                    || row.try_get::<bool, _>("parallel_exact").ok() != Some(true)
                    || row.try_get::<bool, _>("proisstrict").ok() != Some(strict)
                    || row
                        .try_get::<Option<Vec<String>>, _>("proconfig")
                        .ok()
                        .flatten()
                        .as_deref()
                        != Some(&["search_path=pg_catalog, pg_temp".to_owned()])
            })
    {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog function source or metadata readback mismatch".to_owned(),
        ));
    }
    Ok(())
}

fn migration_function_source(tag: &str) -> Option<&'static str> {
    let delimiter = format!("${tag}$");
    let (_, suffix) = AUTHORITY_MIGRATION_SQL.split_once(&delimiter)?;
    let (source, _) = suffix.split_once(&delimiter)?;
    Some(source)
}

async fn lock_catalog(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    let exact: bool = sqlx::query_scalar("SELECT SESSION_USER IN ('rd_owner','replay_policy_catalog_admin_writer') AND count(*)=5 AND bool_and(pg_catalog.pg_get_userbyid(procedure.proowner)='replay_policy_catalog_owner' AND procedure.prosecdef AND procedure.provolatile='v' AND procedure.proparallel='u' AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl WHERE acl.privilege_type<>'EXECUTE' OR (acl.grantee<>procedure.proowner AND (acl.is_grantable OR (procedure.proname='apply_replay_policy_catalog_command_v2' AND acl.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='replay_policy_catalog_admin_writer')) OR (procedure.proname<>'apply_replay_policy_catalog_command_v2' AND acl.grantee NOT IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('rd_owner','replay_policy_catalog_admin_writer'))))))) FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='replay_policy_catalog_api' AND procedure.proname=ANY($1)")
        .bind(["apply_replay_policy_catalog_command_v2", "lock_current_replay_policy_catalog_v2", "lock_replay_policy_catalog_census_v2", "lock_replay_policy_catalog_record_v2", "read_replay_policy_catalog_audit_v2"]).fetch_one(&mut **transaction).await.map_err(unavailable)?;

    if !exact {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog runtime ACL drift".to_owned(),
        ));
    }
    let table_shape: bool = sqlx::query_scalar("WITH family AS (SELECT relation.oid,relation.relowner,relation.relacl,relation.relpersistence FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relname=ANY($1) AND relation.relkind='r') SELECT count(*)=4 AND bool_and(relpersistence='p' AND pg_catalog.pg_get_userbyid(relowner)='replay_policy_catalog_owner' AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(relacl,pg_catalog.acldefault('r',relowner))) acl WHERE acl.grantee<>relowner) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger trigger_fact WHERE trigger_fact.tgrelid=family.oid AND NOT trigger_fact.tgisinternal) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_rewrite rewrite WHERE rewrite.ev_class=family.oid) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index index_fact JOIN pg_catalog.pg_class index_relation ON index_relation.oid=index_fact.indexrelid WHERE index_fact.indrelid=family.oid AND index_relation.relpersistence<>'p')) FROM family")
        .bind(CATALOG_TABLES_V2.as_slice()).fetch_one(&mut **transaction).await.map_err(unavailable)?;

    if !table_shape {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog runtime table drift".to_owned(),
        ));
    }
    let sources = sqlx::query("SELECT procedure.proname, procedure.prosrc FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='replay_policy_catalog_api' AND procedure.proname=ANY($1) ORDER BY procedure.proname")
        .bind(["apply_replay_policy_catalog_command_v2", "lock_current_replay_policy_catalog_v2", "lock_replay_policy_catalog_census_v2", "lock_replay_policy_catalog_record_v2", "read_replay_policy_catalog_audit_v2"])
        .fetch_all(&mut **transaction).await.map_err(unavailable)?;
    let expected = [
        ("apply_replay_policy_catalog_command_v2", "catalog_apply"),
        ("lock_current_replay_policy_catalog_v2", "catalog_current"),
        ("lock_replay_policy_catalog_census_v2", "catalog_census"),
        ("lock_replay_policy_catalog_record_v2", "catalog_read"),
        ("read_replay_policy_catalog_audit_v2", "catalog_audit_read"),
    ];

    if sources.len() != expected.len()
        || sources.iter().zip(expected).any(|(row, (name, tag))| {
            row.try_get::<String, _>("proname").ok().as_deref() != Some(name)
                || row.try_get::<String, _>("prosrc").ok().as_deref()
                    != migration_function_source(tag)
        })
    {
        return Err(ReplayPolicyCatalogErrorV2::Unavailable(
            "Catalog runtime authority drift".to_owned(),
        ));
    }
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(CATALOG_ADMIN_LOCK_V2)
        .execute(&mut **transaction)
        .await
        .map_err(unavailable)?;
    Ok(())
}

fn require_command(
    command_identity: &str,
    now_epoch_ms: u64,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    require_identity(command_identity, "command identity")?;

    if now_epoch_ms == 0 {
        return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(
            "command time must be nonzero",
        ));
    }
    Ok(())
}

fn require_identity(value: &str, label: &'static str) -> Result<(), ReplayPolicyCatalogErrorV2> {
    if value.is_empty() || value.len() > 256 || !value.is_ascii() || value.trim() != value {
        return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(label));
    }
    Ok(())
}

fn require_sha256(value: &str, label: &'static str) -> Result<(), ReplayPolicyCatalogErrorV2> {
    if value.len() != 71
        || !value.starts_with("sha256:")
        || !value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(label));
    }
    Ok(())
}

fn content_identity(record: &ReplayPolicyCatalogBindingV2) -> String {
    format!("sha256:{}", bytes_hex(record.catalog_record_digest()))
}

fn bytes_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn digest_array(
    value: Vec<u8>,
    label: &'static str,
) -> Result<[u8; 32], ReplayPolicyCatalogErrorV2> {
    value.try_into().map_err(|_| {
        ReplayPolicyCatalogErrorV2::Unavailable(format!("Catalog {label} has invalid width"))
    })
}

fn decimal_version(value: Decimal) -> Result<u64, ReplayPolicyCatalogErrorV2> {
    value.to_u64().ok_or_else(|| {
        ReplayPolicyCatalogErrorV2::Unavailable("Catalog version is outside u64".to_owned())
    })
}

fn epoch_i64(value: u64) -> Result<i64, ReplayPolicyCatalogErrorV2> {
    i64::try_from(value).map_err(|_| {
        ReplayPolicyCatalogErrorV2::InvalidRecord("epoch milliseconds exceed PostgreSQL bigint")
    })
}

fn unavailable(error: impl Display) -> ReplayPolicyCatalogErrorV2 {
    ReplayPolicyCatalogErrorV2::Unavailable(error.to_string())
}

#[cfg(all(test, feature = "sealed-develop-composer-acceptance"))]
mod sealed_fixture_tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn fixed_fixture_replays_exactly_and_verifies_the_existing_policy() {
        let fixture = authenticated_sealed_acceptance_fixture_v1().unwrap();
        let replay = authenticated_sealed_acceptance_fixture_v1().unwrap();
        assert_eq!(fixture.sealed_request, replay.sealed_request);
        assert_eq!(
            fixture.verifier_public_key_hex,
            replay.verifier_public_key_hex
        );
        let verified = verify_bootstrap_request(
            &fixture.sealed_request,
            fixture.verifier_identity,
            &fixture.verifier_public_key_hex,
        )
        .unwrap();
        assert_eq!(verified.request.schema_version, 1);
        assert_eq!(
            verified.policy.canonical_bytes().unwrap(),
            sealed_acceptance_policy()
                .unwrap()
                .canonical_bytes()
                .unwrap()
        );
    }

    #[rstest]
    fn fixed_fixture_rejects_changed_signed_meaning_schema_and_verifier() {
        let fixture = authenticated_sealed_acceptance_fixture_v1().unwrap();

        for (field, value) in [
            ("now_epoch_ms", serde_json::json!(2)),
            ("schema_version", serde_json::json!(2)),
            ("unknown_field", serde_json::json!(true)),
            (
                "signature_base64",
                serde_json::json!(BASE64_STANDARD.encode([0_u8; 64])),
            ),
        ] {
            let mut request: serde_json::Value =
                serde_json::from_slice(&fixture.sealed_request).unwrap();
            request[field] = value;
            assert!(
                verify_bootstrap_request(
                    &serde_json::to_vec(&request).unwrap(),
                    fixture.verifier_identity,
                    &fixture.verifier_public_key_hex
                )
                .is_err()
            );
        }
        assert!(
            verify_bootstrap_request(
                &fixture.sealed_request,
                "wrong-verifier",
                &fixture.verifier_public_key_hex
            )
            .is_err()
        );
        assert!(
            verify_bootstrap_request(
                &fixture.sealed_request,
                fixture.verifier_identity,
                &"00".repeat(32)
            )
            .is_err()
        );
    }
}

#[cfg(test)]
mod postgres_tests {
    use base64::{Engine, engine::general_purpose::STANDARD as BASE64_STANDARD};
    use ed25519_dalek::{Signer, SigningKey};
    use rstest::rstest;
    use sqlx::postgres::PgPoolOptions;

    use super::*;
    use crate::{
        product_edge::{ResearchRequestDisposition, ResearchRequestReceiptV1},
        trial_family::{TrialFamilyIndependenceDispositionV1, form_initial_family, verify_family},
        trial_family_postgres::{load_trial_family_in_transaction, persist_initial_family},
    };
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayWindowV2, VersionedIdentityV2,
    };
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    const WRITE_COUNTS_SQL: &str = "SELECT
      (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2),
      (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2),
      (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2),
      (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2)";

    #[rstest]
    fn bootstrap_signature_is_canonical_and_rejects_tamper_or_unknown_fields() {
        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let policy_bytes = replay_policy(71).canonical_bytes().unwrap();
        let mut request = SealedReplayPolicyCatalogBootstrapRequestV1 {
            schema_version: 1,
            bootstrap_identity: "catalog-bootstrap-v1-a".to_owned(),
            administrator_identity: "catalog-administrator-v1-a".to_owned(),
            verifier_identity: "catalog-verifier-v1-a".to_owned(),
            catalog_record_id: "catalog-record-v2-genesis-a".to_owned(),
            policy_canonical_bytes_base64: BASE64_STANDARD.encode(&policy_bytes),
            create_command_identity: "catalog-create-command-v1-a".to_owned(),
            advance_command_identity: "catalog-advance-command-v1-a".to_owned(),
            now_epoch_ms: 71,
            signature_base64: String::new(),
        };
        let canonical = bootstrap_request_canonical_bytes(&request, &policy_bytes).unwrap();
        request.signature_base64 = BASE64_STANDARD.encode(signing_key.sign(&canonical).to_bytes());
        let request_json = serde_json::to_vec(&request).unwrap();
        let public_key_hex = bytes_hex(signing_key.verifying_key().as_bytes());

        let first =
            verify_bootstrap_request(&request_json, &request.verifier_identity, &public_key_hex)
                .unwrap();
        let second =
            verify_bootstrap_request(&request_json, &request.verifier_identity, &public_key_hex)
                .unwrap();
        assert_eq!(
            first.authentication_fact_digest,
            second.authentication_fact_digest
        );

        let mut tampered: serde_json::Value = serde_json::from_slice(&request_json).unwrap();
        tampered["administrator_identity"] = serde_json::json!("other-administrator");
        assert!(
            verify_bootstrap_request(
                &serde_json::to_vec(&tampered).unwrap(),
                &request.verifier_identity,
                &public_key_hex,
            )
            .is_err()
        );

        let mut unknown: serde_json::Value = serde_json::from_slice(&request_json).unwrap();
        unknown["unexpected"] = serde_json::json!(true);
        assert!(
            verify_bootstrap_request(
                &serde_json::to_vec(&unknown).unwrap(),
                &request.verifier_identity,
                &public_key_hex,
            )
            .is_err()
        );
    }

    #[rstest]
    fn catalog_rule_manifest_is_closed_across_migration_connect_and_runtime() {
        let source = include_str!("replay_policy_catalog_postgres_v2.rs");
        assert!(AUTHORITY_MIGRATION_SQL.contains(
            "CREATE SCHEMA IF NOT EXISTS market_data_private AUTHORIZATION market_data_owner"
        ));
        assert!(
            AUTHORITY_MIGRATION_SQL.contains("REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC")
        );
        let post_function_acl_cutover = AUTHORITY_MIGRATION_SQL
            .split("$catalog_composer_function_acl_cutover$;")
            .nth(1)
            .expect("post-Catalog/Composer function ACL cutover");
        assert!(post_function_acl_cutover.contains(
            "GRANT EXECUTE ON FUNCTION composer_owner_api.lock_replay_composition_cut_v1(text) TO market_data_reader, market_data_owner"
        ));
        assert!(AUTHORITY_MIGRATION_SQL.contains(
            "ALTER FUNCTION replay_policy_catalog_api.read_replay_policy_catalog_audit_v2(text) OWNER TO replay_policy_catalog_owner"
        ));
        assert!(AUTHORITY_MIGRATION_SQL.contains(
            "GRANT EXECUTE ON FUNCTION replay_policy_catalog_api.read_replay_policy_catalog_audit_v2(text) TO rd_owner, replay_policy_catalog_admin_writer"
        ));
        assert!(AUTHORITY_MIGRATION_SQL.contains(
            "pg_catalog.has_function_privilege('rd_owner','replay_policy_catalog_api.read_replay_policy_catalog_audit_v2(text)','EXECUTE')"
        ));
        assert!(AUTHORITY_MIGRATION_SQL.contains("lock_replay_policy_catalog_census_v2"));
        assert!(AUTHORITY_MIGRATION_SQL.contains("procedure.prosrc=$catalog_audit_read$"));
        assert_eq!(
            AUTHORITY_MIGRATION_SQL
                .matches("c.relkind='r' AND c.relpersistence='p'")
                .count(),
            4
        );
        assert!(
            AUTHORITY_MIGRATION_SQL
                .contains("count(*)=16 AND bool_and(relation.relpersistence='p')")
        );
        assert!(AUTHORITY_MIGRATION_SQL.contains("index_relation.relpersistence='p'"));
        assert!(AUTHORITY_MIGRATION_SQL.contains(
            "pg_catalog.pg_rewrite rewrite JOIN pg_catalog.pg_class relation ON relation.oid=rewrite.ev_class"
        ));
        let connect_authority = source
            .split("let authority_is_exact")
            .nth(1)
            .expect("Catalog connect authority check")
            .split("let column_shape")
            .next()
            .expect("bounded Catalog connect authority check");
        assert!(connect_authority.contains("relation.relpersistence"));
        assert!(connect_authority.contains("relpersistence='p'"));
        let connect_check = source
            .split("let dependency_shape_is_exact")
            .nth(1)
            .expect("Catalog connect dependency check")
            .split("let constraint_options_are_exact")
            .next()
            .expect("bounded Catalog connect dependency check");
        assert!(connect_check.contains("pg_catalog.array_to_string(constraint_fact.conkey,' ')"));
        assert!(connect_check.contains(
            "pg_catalog.pg_rewrite rewrite WHERE rewrite.ev_class IN (SELECT oid FROM family))"
        ));
        assert!(
            source.contains(
                "constraint_fact.connoinherit<>(constraint_fact.contype IN ('p','u','f'))"
            )
        );
        let runtime_check = source
            .split("let table_shape")
            .nth(1)
            .expect("Catalog runtime table check")
            .split("if !table_shape")
            .next()
            .expect("bounded Catalog runtime table check");
        assert!(
            runtime_check
                .contains("pg_catalog.pg_rewrite rewrite WHERE rewrite.ev_class=family.oid")
        );
        assert!(runtime_check.contains("relation.relpersistence"));
        assert!(runtime_check.contains("relpersistence='p'"));
        assert!(runtime_check.contains("index_relation.relpersistence<>'p'"));
        assert!(source.contains("index_relation.relpersistence='p'"));
    }

    #[tokio::test]
    #[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL"]
    async fn catalog_unlogged_drift_is_unavailable_to_migration_and_runtime() {
        let database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let _mutation = database.mutation();
        let pool = admitted_catalog_admin_test_pool().await;
        let topology_admin_pool = database.owner_topology_admin_pool();
        verify_catalog_storage_authority(&pool).await.unwrap();

        sqlx::query(
            "ALTER TABLE replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2 SET UNLOGGED",
        )
        .execute(topology_admin_pool)
        .await
        .unwrap();
        assert!(matches!(
            migrate(&pool).await,
            Err(ReplayPolicyCatalogErrorV2::Unavailable(_))
        ));
        let mut transaction = pool.begin().await.unwrap();
        assert!(matches!(
            lock_catalog(&mut transaction).await,
            Err(ReplayPolicyCatalogErrorV2::Unavailable(_))
        ));
        transaction.rollback().await.unwrap();

        sqlx::query(
            "ALTER TABLE replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2 SET LOGGED",
        )
        .execute(topology_admin_pool)
        .await
        .unwrap();
        verify_catalog_storage_authority(&pool).await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL"]
    async fn catalog_rule_injection_is_unavailable_and_writes_nothing() {
        let database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let _mutation = database.mutation();
        let pool = admitted_catalog_admin_test_pool().await;
        let topology_admin_pool = database.owner_topology_admin_pool();
        verify_catalog_storage_authority(&pool).await.unwrap();
        let before: (i64, i64, i64, i64) = sqlx::query_as(WRITE_COUNTS_SQL)
            .fetch_one(topology_admin_pool)
            .await
            .unwrap();

        sqlx::query(
            "CREATE RULE suppress_catalog_audit_v2 AS
             ON INSERT TO replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2
             DO INSTEAD NOTHING",
        )
        .execute(topology_admin_pool)
        .await
        .unwrap();
        assert!(matches!(
            migrate(&pool).await,
            Err(ReplayPolicyCatalogErrorV2::Unavailable(_))
        ));

        let administrator = AuthenticatedCatalogAdministratorV2::admit(
            "rd-catalog-rule-test-administrator-v2",
            &format!("sha256:{}", "a".repeat(64)),
        )
        .unwrap();
        let mut transaction = pool.begin().await.unwrap();
        let result = ReplayPolicyCatalogAdministrationPortV2::create_policy(
            &mut transaction,
            &administrator,
            "catalog-rule-injection-command-v2",
            "catalog-rule-injection-record-v2",
            &replay_policy(9_001),
            9_001,
        )
        .await;
        assert!(matches!(
            result,
            Err(ReplayPolicyCatalogErrorV2::Unavailable(_))
        ));
        let observed: (i64, i64, i64, i64) = sqlx::query_as(WRITE_COUNTS_SQL)
            .fetch_one(&mut *transaction)
            .await
            .unwrap();
        assert_eq!(observed, before);
        transaction.rollback().await.unwrap();

        sqlx::query(
            "DROP RULE suppress_catalog_audit_v2
             ON replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2",
        )
        .execute(topology_admin_pool)
        .await
        .unwrap();
        verify_catalog_storage_authority(&pool).await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL"]
    async fn catalog_admin_and_family_formation_are_atomic_and_fail_closed() {
        let database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = database.mutation();
        let fact_writer_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdFactWriter);
        let rd_owner_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let topology_admin_pool = database.owner_topology_admin_pool();
        let catalog_admin_pool = admitted_catalog_admin_test_pool().await;

        verify_catalog_storage_authority(&catalog_admin_pool)
            .await
            .unwrap();
        let external_write_grants: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'replay_policy_catalog_private' AND table_name = ANY($1) AND grantee <> 'replay_policy_catalog_owner'",
        )
        .bind(CATALOG_TABLES_V2.as_slice())
        .fetch_one(fact_writer_pool)
        .await
        .unwrap();
        assert_eq!(external_write_grants, 0);

        for (table, query) in [
            (
                "rd_replay_policy_catalog_records_v2",
                "SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2",
            ),
            (
                "rd_replay_policy_catalog_head_v2",
                "SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2",
            ),
            (
                "rd_replay_policy_catalog_revocations_v2",
                "SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2",
            ),
            (
                "rd_replay_policy_catalog_audit_v2",
                "SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2",
            ),
        ] {
            let count: i64 = sqlx::query_scalar(query)
                .fetch_one(topology_admin_pool)
                .await
                .unwrap();
            assert_eq!(count, 0, "migration must not seed {table}");
        }

        let signing_key = SigningKey::from_bytes(&[11_u8; 32]);
        let bootstrap = signed_bootstrap_request(&signing_key, &replay_policy(1), 1_000);
        let verifier_key = bytes_hex(signing_key.verifying_key().as_bytes());

        sqlx::query("INSERT INTO replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2 (command_identity,administrator_identity,authentication_fact_digest,command_kind,content_identity,audit_json,committed_at_epoch_ms) VALUES ('audit-only-poison','poison','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','poison','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}',1)")
            .execute(topology_admin_pool)
            .await
            .unwrap();
        let poison_counts = catalog_counts(topology_admin_pool).await;
        assert!(matches!(
            ensure_authenticated_replay_policy_catalog_genesis_v1(
                &catalog_admin_pool,
                &bootstrap,
                "rd-catalog-test-verifier-v1",
                &verifier_key,
            )
            .await,
            Err(ReplayPolicyCatalogErrorV2::Conflict)
        ));
        assert_eq!(catalog_counts(topology_admin_pool).await, poison_counts);
        sqlx::query("DELETE FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2 WHERE command_identity='audit-only-poison'")
            .execute(topology_admin_pool)
            .await
            .unwrap();

        let created = ensure_authenticated_replay_policy_catalog_genesis_v1(
            &catalog_admin_pool,
            &bootstrap,
            "rd-catalog-test-verifier-v1",
            &verifier_key,
        )
        .await
        .unwrap();
        let first = created.catalog_binding.clone();
        let counts_after_create: (i64, i64, i64, i64) = sqlx::query_as(
            "SELECT
              (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2),
              (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2),
              (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2),
              (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2)",
        )
        .fetch_one(topology_admin_pool)
        .await
        .unwrap();
        assert_eq!(counts_after_create, (1, 1, 0, 2));
        let resolved = ensure_authenticated_replay_policy_catalog_genesis_v1(
            &catalog_admin_pool,
            &bootstrap,
            "rd-catalog-test-verifier-v1",
            &verifier_key,
        )
        .await
        .unwrap();
        let resolved_again = ensure_authenticated_replay_policy_catalog_genesis_v1(
            &catalog_admin_pool,
            &bootstrap,
            "rd-catalog-test-verifier-v1",
            &verifier_key,
        )
        .await
        .unwrap();
        assert_eq!(
            serde_json::to_vec(&created).unwrap(),
            serde_json::to_vec(&resolved).unwrap()
        );
        assert_eq!(
            serde_json::to_vec(&resolved).unwrap(),
            serde_json::to_vec(&resolved_again).unwrap()
        );
        let counts_after_replay: (i64, i64, i64, i64) = sqlx::query_as(
            "SELECT
              (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2),
              (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2),
              (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2),
              (SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2)",
        )
        .fetch_one(topology_admin_pool)
        .await
        .unwrap();
        assert_eq!(counts_after_replay, counts_after_create);
        let readback = read_authenticated_replay_policy_catalog_genesis_v1(
            rd_owner_pool,
            &bootstrap,
            "rd-catalog-test-verifier-v1",
            &verifier_key,
        )
        .await
        .unwrap();
        assert_eq!(
            serde_json::to_vec(&created).unwrap(),
            serde_json::to_vec(&readback).unwrap()
        );
        assert_eq!(
            catalog_counts(topology_admin_pool).await,
            counts_after_create
        );
        assert_bootstrap_provenance_tamper_is_rejected(
            topology_admin_pool,
            &catalog_admin_pool,
            rd_owner_pool,
            &bootstrap,
            &verifier_key,
        )
        .await;
        let admin = AuthenticatedCatalogAdministratorV2::admit(
            "rd-catalog-test-administrator-v2",
            &format!("sha256:{}", "a".repeat(64)),
        )
        .unwrap();
        assert_direct_catalog_mutations_are_rejected(fact_writer_pool).await;
        assert_direct_catalog_mutations_are_rejected(rd_owner_pool).await;
        assert_catalog_apply_is_rejected(fact_writer_pool).await;
        assert_catalog_apply_is_rejected(rd_owner_pool).await;

        let mut policy = family_policy();
        let mut transaction = rd_owner_pool.begin().await.unwrap();
        policy.replay_execution_policy_v2 = Some(
            resolve_current_for_trial_family_formation(&mut transaction, &policy)
                .await
                .unwrap(),
        );
        let family = form_initial_family(
            "rd-research-intent-v2-catalog-formation",
            &format!("sha256:{}", "b".repeat(64)),
            policy,
            1_002,
        )
        .unwrap();
        let receipt = receipt("catalog-formation", 1_002);
        persist_initial_family(&mut transaction, &family, &receipt)
            .await
            .unwrap();
        transaction.commit().await.unwrap();

        let sealed_record = family
            .root()
            .policy()
            .replay_execution_policy_v2()
            .unwrap()
            .clone();
        assert_eq!(sealed_record, first);

        let mut transaction = catalog_admin_pool.begin().await.unwrap();
        let second = ReplayPolicyCatalogAdministrationPortV2::append_version(
            &mut transaction,
            &admin,
            "catalog-command-append-v2-2",
            first.catalog_record_id(),
            "catalog-policy-record-v2-2",
            &replay_policy(2),
            1_003,
        )
        .await
        .unwrap();
        ReplayPolicyCatalogAdministrationPortV2::advance_current_head(
            &mut transaction,
            &admin,
            "catalog-command-head-v2-2",
            Some(first.catalog_record_id()),
            second.catalog_record_id(),
            1_004,
        )
        .await
        .unwrap();
        ReplayPolicyCatalogAdministrationPortV2::revoke_version(
            &mut transaction,
            &admin,
            "catalog-command-revoke-v2-1",
            first.catalog_record_id(),
            1_005,
        )
        .await
        .unwrap();
        transaction.commit().await.unwrap();

        let mut transaction = rd_owner_pool.begin().await.unwrap();
        let loaded = load_trial_family_in_transaction(
            &mut transaction,
            "rd-research-intent-v2-catalog-formation",
            &receipt.receipt_identity,
        )
        .await
        .unwrap();
        verify_family(&loaded).unwrap();
        assert_eq!(
            loaded.root().policy().replay_execution_policy_v2(),
            Some(&sealed_record),
            "later Catalog changes cannot replace or invalidate a formed family"
        );
        transaction.rollback().await.unwrap();

        assert_zero_family_write_on_cross_splice(rd_owner_pool).await;
        assert_zero_family_write_on_tamper(
            topology_admin_pool,
            rd_owner_pool,
            second.catalog_record_id(),
        )
        .await;
        assert_zero_family_write_on_wrong_owner(
            topology_admin_pool,
            rd_owner_pool,
            second.catalog_record_id(),
        )
        .await;
        assert_zero_family_write_on_wrong_head(topology_admin_pool, rd_owner_pool).await;

        let mut transaction = catalog_admin_pool.begin().await.unwrap();
        ReplayPolicyCatalogAdministrationPortV2::revoke_version(
            &mut transaction,
            &admin,
            "catalog-command-revoke-v2-2",
            second.catalog_record_id(),
            1_006,
        )
        .await
        .unwrap();
        transaction.commit().await.unwrap();
        let before = family_row_counts(rd_owner_pool).await;
        let mut transaction = rd_owner_pool.begin().await.unwrap();
        assert!(
            resolve_current_for_trial_family_formation(&mut transaction, &family_policy())
                .await
                .is_err()
        );
        transaction.rollback().await.unwrap();
        assert_eq!(family_row_counts(rd_owner_pool).await, before);

        let audit_count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2",
        )
        .fetch_one(topology_admin_pool)
        .await
        .unwrap();
        assert_eq!(audit_count, 6);
        cleanup_catalog_for_disposable_test_only(topology_admin_pool).await;
    }

    async fn assert_zero_family_write_on_cross_splice(pool: &PgPool) {
        let before = family_row_counts(pool).await;
        let mut wrong = family_policy();
        wrong.cost_model_identity = "wrong-cost-model".to_owned();
        let mut transaction = pool.begin().await.unwrap();
        assert!(
            resolve_current_for_trial_family_formation(&mut transaction, &wrong)
                .await
                .is_err()
        );
        transaction.rollback().await.unwrap();
        assert_eq!(family_row_counts(pool).await, before);
    }

    async fn assert_zero_family_write_on_tamper(
        topology_admin_pool: &PgPool,
        pool: &PgPool,
        record_id: &str,
    ) {
        let before = family_row_counts(pool).await;
        let mut transaction = topology_admin_pool.begin().await.unwrap();
        sqlx::query("UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 SET policy_digest = decode(repeat('00',32),'hex') WHERE catalog_record_id = $1")
            .bind(record_id)
            .execute(&mut *transaction)
            .await
            .unwrap();
        assert!(
            resolve_current_for_trial_family_formation(&mut transaction, &family_policy())
                .await
                .is_err()
        );
        transaction.rollback().await.unwrap();
        assert_eq!(family_row_counts(pool).await, before);
    }

    async fn assert_zero_family_write_on_wrong_owner(
        topology_admin_pool: &PgPool,
        pool: &PgPool,
        record_id: &str,
    ) {
        let before = family_row_counts(pool).await;
        let mut transaction = topology_admin_pool.begin().await.unwrap();
        sqlx::query("UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 SET owner_identity = 'wrong-owner' WHERE catalog_record_id = $1")
            .bind(record_id)
            .execute(&mut *transaction)
            .await
            .unwrap();
        assert!(
            resolve_current_for_trial_family_formation(&mut transaction, &family_policy())
                .await
                .is_err()
        );
        transaction.rollback().await.unwrap();
        assert_eq!(family_row_counts(pool).await, before);
    }

    async fn assert_zero_family_write_on_wrong_head(topology_admin_pool: &PgPool, pool: &PgPool) {
        let before = family_row_counts(pool).await;
        let mut transaction = topology_admin_pool.begin().await.unwrap();
        sqlx::query("UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 SET catalog_version = 1 WHERE singleton = TRUE")
            .execute(&mut *transaction)
            .await
            .unwrap();
        assert!(
            resolve_current_for_trial_family_formation(&mut transaction, &family_policy())
                .await
                .is_err()
        );
        transaction.rollback().await.unwrap();
        assert_eq!(family_row_counts(pool).await, before);
    }

    async fn assert_direct_catalog_mutations_are_rejected(pool: &PgPool) {
        for statement in [
            "UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 SET owner_identity = 'raw-writer' WHERE catalog_record_id = 'catalog-policy-record-v2-1'",
            "DELETE FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 WHERE catalog_record_id = 'catalog-policy-record-v2-1'",
            "UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 SET advanced_by = 'raw-writer' WHERE singleton = TRUE",
            "INSERT INTO replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2 (catalog_record_id, catalog_version, revoked_by, revoked_at_epoch_ms) VALUES ('catalog-policy-record-v2-1',1,'raw-writer',1)",
            "INSERT INTO replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2 (command_identity, administrator_identity, authentication_fact_digest, command_kind, content_identity, audit_json, committed_at_epoch_ms) VALUES ('raw-command','raw-writer','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','RAW_WRITE','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}',1)",
        ] {
            let mut transaction = pool.begin().await.unwrap();
            let error = sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .expect_err("raw Catalog mutation must be rejected");
            assert_eq!(
                error.as_database_error().and_then(|e| e.code()),
                Some(std::borrow::Cow::Borrowed("42501"))
            );
            transaction.rollback().await.unwrap();
        }
    }

    async fn assert_catalog_apply_is_rejected(pool: &PgPool) {
        let error = sqlx::query("SELECT replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,NULL::numeric,NULL::text,NULL::text,NULL::bytea,NULL::bytea,NULL::bytea,NULL::bytea,NULL::text,NULL::text,NULL::jsonb,NULL::bigint)")
            .execute(pool)
            .await
            .expect_err("non-broker Catalog apply must be rejected");
        assert_eq!(
            error.as_database_error().and_then(|e| e.code()),
            Some(std::borrow::Cow::Borrowed("42501"))
        );
    }

    async fn assert_bootstrap_provenance_tamper_is_rejected(
        topology_admin_pool: &PgPool,
        catalog_admin_pool: &PgPool,
        rd_owner_pool: &PgPool,
        bootstrap: &[u8],
        verifier_key: &str,
    ) {
        for (tamper, restore) in [
            (
                "UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 SET predecessor_record_id=catalog_record_id WHERE catalog_version=1",
                "UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 SET predecessor_record_id=NULL WHERE catalog_version=1",
            ),
            (
                "UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 SET created_by='wrong-bootstrap-actor' WHERE catalog_version=1",
                "UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 SET created_by='rd-catalog-test-administrator-v2' WHERE catalog_version=1",
            ),
            (
                "UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 SET created_at_epoch_ms=1001 WHERE catalog_version=1",
                "UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 SET created_at_epoch_ms=1000 WHERE catalog_version=1",
            ),
            (
                "UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 SET advanced_by='wrong-bootstrap-actor' WHERE singleton",
                "UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 SET advanced_by='rd-catalog-test-administrator-v2' WHERE singleton",
            ),
            (
                "UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 SET advanced_at_epoch_ms=1001 WHERE singleton",
                "UPDATE replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 SET advanced_at_epoch_ms=1000 WHERE singleton",
            ),
        ] {
            sqlx::query(tamper)
                .execute(topology_admin_pool)
                .await
                .unwrap();
            let counts = catalog_counts(topology_admin_pool).await;
            assert_eq!(counts, (1, 1, 0, 2));
            assert!(matches!(
                ensure_authenticated_replay_policy_catalog_genesis_v1(
                    catalog_admin_pool,
                    bootstrap,
                    "rd-catalog-test-verifier-v1",
                    verifier_key,
                )
                .await,
                Err(ReplayPolicyCatalogErrorV2::Conflict)
            ));
            assert!(matches!(
                read_authenticated_replay_policy_catalog_genesis_v1(
                    rd_owner_pool,
                    bootstrap,
                    "rd-catalog-test-verifier-v1",
                    verifier_key,
                )
                .await,
                Err(ReplayPolicyCatalogErrorV2::Conflict)
            ));
            assert_eq!(catalog_counts(topology_admin_pool).await, counts);
            sqlx::query(restore)
                .execute(topology_admin_pool)
                .await
                .unwrap();
        }
        read_authenticated_replay_policy_catalog_genesis_v1(
            rd_owner_pool,
            bootstrap,
            "rd-catalog-test-verifier-v1",
            verifier_key,
        )
        .await
        .unwrap();
    }

    async fn admitted_catalog_admin_test_pool() -> PgPool {
        let database_url = std::env::var("REPLAY_POLICY_CATALOG_ADMIN_TEST_DATABASE_URL")
            .expect("explicit Catalog admin test database URL is required");
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .connect(&database_url)
            .await
            .unwrap();
        let expected_database = std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").unwrap();
        let exact: bool = sqlx::query_scalar("SELECT SESSION_USER='replay_policy_catalog_admin_writer' AND current_database()=$1 AND EXISTS(SELECT 1 FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker WHERE marker.database_name=current_database() AND marker.test_role=SESSION_USER)")
            .bind(expected_database)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(
            exact,
            "Catalog admin test connection must target the admitted disposable database"
        );
        pool
    }

    async fn catalog_counts(pool: &PgPool) -> (i64, i64, i64, i64) {
        sqlx::query_as(WRITE_COUNTS_SQL)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// Opens the poison capability only inside this disposable PostgreSQL test module. This is not
    /// an administration port and is absent from non-test builds.
    async fn cleanup_catalog_for_disposable_test_only(topology_admin_pool: &PgPool) {
        let mut transaction = topology_admin_pool.begin().await.unwrap();

        for statement in [
            "DELETE FROM replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2",
            "DELETE FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2",
            "DELETE FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2",
            "DELETE FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2",
        ] {
            sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .unwrap();
        }
        transaction.commit().await.unwrap();
    }

    async fn family_row_counts(pool: &PgPool) -> (i64, i64, i64, i64) {
        (
            sqlx::query_scalar("SELECT count(*) FROM rd_trial_families_v1")
                .fetch_one(pool)
                .await
                .unwrap(),
            sqlx::query_scalar("SELECT count(*) FROM rd_trial_family_members_v1")
                .fetch_one(pool)
                .await
                .unwrap(),
            sqlx::query_scalar("SELECT count(*) FROM rd_trial_family_heads_v1")
                .fetch_one(pool)
                .await
                .unwrap(),
            sqlx::query_scalar("SELECT count(*) FROM rd_owner_outbox_v1 WHERE event_kind = 'TRIAL_FAMILY_FROZEN_V1'")
                .fetch_one(pool)
                .await
                .unwrap(),
        )
    }

    fn family_policy() -> TrialFamilyPolicyV1 {
        TrialFamilyPolicyV1 {
            trial_budget: 2,
            stop_rule: "stop after bounded falsifier".to_owned(),
            pit_rule_identity: "pit-rule-v1".to_owned(),
            cost_model_identity: "cost-model".to_owned(),
            slippage_model_identity: "slippage-model".to_owned(),
            capacity_model_identity: "capacity-model".to_owned(),
            semantic_predecessor_frontier: Vec::new(),
            protected_feedback_frontier: "qualification-frontier-v1".to_owned(),
            independence_disposition: TrialFamilyIndependenceDispositionV1::Independent,
            independence_basis_identity: "independence-basis-v1".to_owned(),
            frozen_falsifier_binding: format!("sha256:{}", "c".repeat(64)),
            replay_execution_policy_v2: None,
        }
    }

    fn receipt(suffix: &str, committed_at_epoch_ms: u64) -> ResearchRequestReceiptV1 {
        ResearchRequestReceiptV1 {
            schema_version: 2,
            receipt_identity: format!("rd-research-receipt-v2-{suffix}"),
            request_identity: format!("rd-research-request-v2-{suffix}"),
            semantic_digest: format!("sha256:{}", "b".repeat(64)),
            disposition: ResearchRequestDisposition::Accepted,
            resulting_research_intent_identity: Some(
                "rd-research-intent-v2-catalog-formation".to_owned(),
            ),
            committed_at_epoch_ms,
            rejection_code: None,
        }
    }

    fn signed_bootstrap_request(
        signing_key: &SigningKey,
        policy: &ReplayExecutionPolicyV2,
        now_epoch_ms: u64,
    ) -> Vec<u8> {
        let policy_bytes = policy.canonical_bytes().unwrap();
        let mut request = SealedReplayPolicyCatalogBootstrapRequestV1 {
            schema_version: 1,
            bootstrap_identity: "rd-catalog-bootstrap-v1".to_owned(),
            administrator_identity: "rd-catalog-test-administrator-v2".to_owned(),
            verifier_identity: "rd-catalog-test-verifier-v1".to_owned(),
            catalog_record_id: "catalog-policy-record-v2-1".to_owned(),
            policy_canonical_bytes_base64: BASE64_STANDARD.encode(&policy_bytes),
            create_command_identity: "catalog-command-create-v2".to_owned(),
            advance_command_identity: "catalog-command-head-v2-1".to_owned(),
            now_epoch_ms,
            signature_base64: String::new(),
        };
        let canonical = bootstrap_request_canonical_bytes(&request, &policy_bytes).unwrap();
        request.signature_base64 = BASE64_STANDARD.encode(signing_key.sign(&canonical).to_bytes());
        serde_json::to_vec(&request).unwrap()
    }

    fn replay_policy(seed: u64) -> ReplayExecutionPolicyV2 {
        ReplayExecutionPolicyV2 {
            runtime_kernel: versioned("runtime-kernel"),
            simulator: versioned("simulator"),
            cost: versioned("cost-model"),
            slippage: versioned("slippage-model"),
            capacity: versioned("capacity-model"),
            runner_operational_profile: versioned("runner"),
            diagnostic_policy: versioned("diagnostic"),
            deterministic_seed: seed,
            window: ReplayWindowV2 {
                start_event_ns: 1,
                end_event_ns_exclusive: 2,
            },
            calendar: versioned("calendar"),
            session: versioned("session"),
            time_zone: versioned("timezone"),
            correction_rule: versioned("correction"),
            market_semantics: versioned("semantics"),
            replay_configuration: content("configuration"),
            corporate_action_cut: content("corporate-actions"),
            historical_membership_cut: content("membership"),
        }
    }

    fn versioned(identity: &str) -> VersionedIdentityV2 {
        VersionedIdentityV2 {
            identity: OpaqueIdentityV2::try_from(identity.to_owned()).unwrap(),
            version: OpaqueIdentityV2::try_from("v1".to_owned()).unwrap(),
        }
    }

    fn content(identity: &str) -> ContentIdentityV2 {
        ContentIdentityV2 {
            identity: OpaqueIdentityV2::try_from(identity.to_owned()).unwrap(),
            digest: CanonicalDigestV2::try_from(format!("sha256:{}", "d".repeat(64))).unwrap(),
        }
    }
}
