use std::{
    collections::BTreeMap,
    fmt::Display,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use vibe_operator_authorization::{
    AuthorizationReadModeV1, ExpiredManifestRecoveryEpochV1, ExpiredManifestRecoveryTransitionV1,
    OperationManifestBindingV1, OperatorAuthorizationError, OperatorAuthorizationLocatorV1,
    OperatorAuthorizationReadbackV1, UntrustedCanonicalAuthorizationEvidenceV1,
    parse_untrusted_authorization_envelope_v1,
    parse_untrusted_portfolio_resource_grant_envelope_v1, resolve_authorization_in_transaction,
};
use vibe_product_edge_claim_custody::{
    StoredInvocationAdmissionReceiptV1, StoredInvocationClaimV1, StoredInvocationStateKindV1,
    StoredInvocationStateV1,
};
use vibe_rd_artifact_invocation_custody::{
    ArtifactInvocationStartReservationV1, verify_invocation_start_reservation_in_transaction,
};
use vibe_rd_source_intake_invocation_custody::{
    SourceInvocationClaimCustodyV1, SourceInvocationStartedCustodyV1,
    resolve_source_acquisition_binding_in_transaction,
    resolve_source_invocation_claim_in_transaction,
    resolve_source_invocation_start_reservation_in_transaction,
    resolve_source_invocation_started_in_transaction,
    verify_source_invocation_start_reservation_in_transaction,
};

use crate::{
    ARTIFACT_BUILD_REQUIRED_EFFECTS_V1, AgentOperationManifestProposalV1,
    DownstreamAdmissionModeV1, PORTFOLIO_READ_ONLY_EFFECT_POLICY_V1,
    PORTFOLIO_READ_POLICY_OPERATION_SCHEMA_V1, PORTFOLIO_READ_POLICY_OPERATION_V1,
    PORTFOLIO_READ_POLICY_SCHEMA_V1, PORTFOLIO_READ_POLICY_TARGET_OWNER_V1,
    PRODUCT_EDGE_ADMISSION_EVENT_STREAM_V1, PRODUCT_EDGE_SCHEMA_V1, PortfolioReadPolicyCustodyV1,
    PortfolioReadPolicyPayloadV1, PortfolioReadPolicyRequestV1, PortfolioReadPolicyResolutionV1,
    PortfolioReadPolicyUnavailableReasonV1, PortfolioSourceOwnerResolveResultV1,
    ProductEdgeAdmissionEventCursorV1, ProductEdgeAdmissionEventLocatorV1,
    ProductEdgeAdmissionLocatorV1, ProductEdgeAdmissionObservationV1,
    ProductEdgeAdmissionReadbackV1, ProductEdgeAdmissionReceiptV1, ProductEdgeAdmissionRequestV1,
    ProductEdgeAuthorizationTrustV1, ProductEdgeBootstrapProposalV1,
    ProductEdgeBootstrapReadbackV1, ProductEdgeCurrentPolicyEvidenceV1, ProductEdgeError,
    ProductEdgeExpiredManifestRecoveryProposalV1, ProductEdgeInvocationClaimDispositionV1,
    ProductEdgeInvocationClaimReadbackV1, ProductEdgeInvocationClaimRequestV1,
    ProductEdgeInvocationStartDispositionV1, ProductEdgeInvocationStartReadbackV1,
    ProductEdgeSourceInvocationClaimRequestV1, ProductEdgeSourceInvocationStartRequestV1,
    ProductEdgeSuccessorProposalV1, SOURCE_INTAKE_OPERATION_SCHEMA_V1, SOURCE_INTAKE_OPERATION_V1,
    SOURCE_INTAKE_REQUIRED_EFFECTS_V1, SOURCE_INTAKE_TARGET_OWNER_V1, canonical_digest, identity,
    is_sha256_digest,
};

const MANIFEST_EVENT: &str = "PRODUCT_EDGE_OPERATION_MANIFEST_APPROVED_V1";
const BINDING_EVENT: &str = "PRODUCT_EDGE_DEPLOYMENT_BINDING_ACTIVE_V1";
const SUPERSESSION_EVENT: &str = "PRODUCT_EDGE_DEPLOYMENT_BINDING_SUPERSEDED_V1";
const ADMISSION_EVENT: &str = "PRODUCT_EDGE_REQUEST_ADMITTED_V1";
const INVOCATION_ADMISSION_EVENT: &str = "PRODUCT_EDGE_PROVIDER_INVOCATION_ADMITTED_V1";
const INVOCATION_CLAIM_EVENT: &str = "PRODUCT_EDGE_PROVIDER_INVOCATION_CLAIMED_V1";
const INVOCATION_CLAIM_STATE_EVENT: &str = "PRODUCT_EDGE_PROVIDER_INVOCATION_CLAIM_STATE_V1";
const INVOCATION_STARTED_EVENT: &str = "PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1";
const ARTIFACT_BUILD_OPERATION_V1: &str = "artifact_build.submit_or_resolve.v1";
const ARTIFACT_BUILD_SCHEMA_V1: &str = "rd-artifact-build-request-v1";
const ARTIFACT_PROVIDER_EFFECT_V1: &str = "R_AND_D_PROVIDER_INVOCATION_V1";
const SOURCE_PROVIDER_EFFECT_V1: &str = "R_AND_D_SOURCE_PROVIDER_INVOCATION_V1";
const MAX_ADMISSION_EVENT_PAGE_V1: u32 = 100;
const EXPIRED_MANIFEST_RECOVERY_SCHEMA_STATEMENTS: [&str; 3] = [
    "CREATE TABLE IF NOT EXISTS public.product_edge_expired_manifest_recoveries_v1 (recovery_epoch_identity TEXT PRIMARY KEY CHECK (recovery_epoch_identity <> ''), recovery_epoch_digest TEXT NOT NULL UNIQUE CHECK (recovery_epoch_digest <> ''), predecessor_binding_identity TEXT NOT NULL REFERENCES public.product_edge_deployment_bindings_v1(binding_identity) CHECK (predecessor_binding_identity <> ''), successor_binding_identity TEXT NOT NULL UNIQUE REFERENCES public.product_edge_deployment_bindings_v1(binding_identity) CHECK (successor_binding_identity <> '' AND successor_binding_identity <> predecessor_binding_identity), recovery_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL CHECK (committed_at_epoch_ms >= 0))",
    "ALTER TABLE public.product_edge_expired_manifest_recoveries_v1 OWNER TO product_edge_owner",
    "REVOKE ALL ON TABLE public.product_edge_expired_manifest_recoveries_v1 FROM PUBLIC, rd_owner, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer, backtest_owner, portfolio_owner",
];
const VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA: &str = "SELECT relation.relowner = pg_catalog.to_regrole('product_edge_owner')::oid
   AND relation.relpersistence = 'p'
   AND (
     SELECT pg_catalog.count(*) = 6
        AND pg_catalog.bool_and(CASE attribute.attname
          WHEN 'recovery_epoch_identity' THEN attribute.atttypid = 'pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
          WHEN 'recovery_epoch_digest' THEN attribute.atttypid = 'pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
          WHEN 'predecessor_binding_identity' THEN attribute.atttypid = 'pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
          WHEN 'successor_binding_identity' THEN attribute.atttypid = 'pg_catalog.text'::pg_catalog.regtype AND attribute.attnotnull
          WHEN 'recovery_json' THEN attribute.atttypid = 'pg_catalog.jsonb'::pg_catalog.regtype AND attribute.attnotnull
          WHEN 'committed_at_epoch_ms' THEN attribute.atttypid = 'pg_catalog.int8'::pg_catalog.regtype AND attribute.attnotnull
          ELSE false
        END AND NOT attribute.atthasdef AND attribute.attidentity = '' AND attribute.attgenerated = '')
       FROM pg_catalog.pg_attribute attribute
      WHERE attribute.attrelid = relation.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
   )
   AND (
     SELECT pg_catalog.count(*) = 10
        AND pg_catalog.bool_and(constraint_entry.convalidated)
        AND pg_catalog.array_agg(
              constraint_entry.contype::pg_catalog.text || ':' || pg_catalog.pg_get_constraintdef(constraint_entry.oid, true)
              ORDER BY constraint_entry.contype, pg_catalog.pg_get_constraintdef(constraint_entry.oid, true)
            ) = ARRAY[
              'c:CHECK (committed_at_epoch_ms >= 0)',
              'c:CHECK (predecessor_binding_identity <> ''::text)',
              'c:CHECK (recovery_epoch_digest <> ''::text)',
              'c:CHECK (recovery_epoch_identity <> ''::text)',
              'c:CHECK (successor_binding_identity <> ''::text AND successor_binding_identity <> predecessor_binding_identity)',
              'f:FOREIGN KEY (predecessor_binding_identity) REFERENCES product_edge_deployment_bindings_v1(binding_identity)',
              'f:FOREIGN KEY (successor_binding_identity) REFERENCES product_edge_deployment_bindings_v1(binding_identity)',
              'p:PRIMARY KEY (recovery_epoch_identity)',
              'u:UNIQUE (recovery_epoch_digest)',
              'u:UNIQUE (successor_binding_identity)'
            ]::pg_catalog.text[]
       FROM pg_catalog.pg_constraint constraint_entry
      WHERE constraint_entry.conrelid = relation.oid
   )
   AND (
     SELECT pg_catalog.count(*) = 7
        AND pg_catalog.count(*) FILTER (WHERE acl.grantee = pg_catalog.to_regrole('product_edge_owner')::oid AND NOT acl.is_grantable) = 7
       FROM pg_catalog.aclexplode(COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) acl
   )
  FROM pg_catalog.pg_class relation
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
 WHERE namespace.nspname = 'public'
   AND relation.relname = 'product_edge_expired_manifest_recoveries_v1'
   AND relation.relkind = 'r'
";
const ADDED_MANIFEST_PROHIBITED_FLOOR_V1: [&str; 3] = [
    "LIVE_TRADING_V1",
    "PROTECTED_FEEDBACK_DETAIL_V1",
    "REAL_TRADING_V1",
];

fn has_exact_artifact_build_effects(requested_effects: &[String]) -> bool {
    requested_effects
        .iter()
        .map(String::as_str)
        .eq(ARTIFACT_BUILD_REQUIRED_EFFECTS_V1)
}

fn has_exact_source_intake_effects(requested_effects: &[String]) -> bool {
    requested_effects
        .iter()
        .map(String::as_str)
        .eq(SOURCE_INTAKE_REQUIRED_EFFECTS_V1)
}

fn valid_source_doi(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value == value.trim()
        && value.starts_with("10.")
        && value.contains('/')
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"./-_;():".contains(&byte)
        })
}

fn valid_source_text(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 8_192 && !value.chars().any(char::is_control)
}

fn valid_source_interpretation(value: &SourceInterpretationPayloadV1) -> bool {
    valid_source_text(&value.bounded_explanation)
        && valid_source_text(&value.differentiating_prediction)
        && valid_source_text(&value.falsifier)
        && (1..=16).contains(&value.plausible_alternatives.len())
        && value
            .plausible_alternatives
            .iter()
            .all(|item| valid_source_text(item))
        && value
            .plausible_alternatives
            .windows(2)
            .all(|pair| pair[0] < pair[1])
}

mod custody;
mod custody_types;
use custody::*;
use custody_types::*;

#[derive(Debug)]
struct VerifiedDeploymentHistoryV1 {
    bindings: Vec<StoredBindingV1>,
    pending_supersession: Option<StoredSupersessionV1>,
}

impl VerifiedDeploymentHistoryV1 {
    fn current(&self) -> Result<&StoredBindingV1, ProductEdgeError> {
        if self.pending_supersession.is_some() {
            return Err(ProductEdgeError::Unavailable);
        }
        self.bindings.last().ok_or(ProductEdgeError::Unavailable)
    }

    fn head(&self) -> Result<&StoredBindingV1, ProductEdgeError> {
        self.bindings.last().ok_or(ProductEdgeError::Unavailable)
    }

    fn find(&self, binding_identity: &str) -> Result<&StoredBindingV1, ProductEdgeError> {
        self.bindings
            .iter()
            .find(|binding| binding.binding_identity == binding_identity)
            .ok_or(ProductEdgeError::Unavailable)
    }
}

fn first_mutation_policy_binding<'a>(
    admission: &StoredAdmissionV1,
    bindings: &'a [StoredBindingV1],
    current_has_pending_supersession: bool,
) -> Result<&'a StoredBindingV1, ProductEdgeError> {
    if current_has_pending_supersession {
        return Err(ProductEdgeError::Unavailable);
    }
    let admitted_index = bindings
        .iter()
        .position(|binding| binding.binding_identity == admission.binding_identity)
        .ok_or(ProductEdgeError::Unavailable)?;
    let admitted = &bindings[admitted_index];

    if admission.binding_identity != admission.history_head_identity {
        return Err(ProductEdgeError::Unavailable);
    }
    policy_equivalent_chain_head(admitted, &bindings[admitted_index + 1..])
}

fn policy_equivalent_chain_head<'a>(
    admitted: &'a StoredBindingV1,
    successors: &'a [StoredBindingV1],
) -> Result<&'a StoredBindingV1, ProductEdgeError> {
    if successors.len() > 1 {
        return Err(ProductEdgeError::Unavailable);
    }

    let mut predecessor = admitted;
    for successor in successors {
        let expected_generation = predecessor
            .generation
            .checked_add(1)
            .ok_or(ProductEdgeError::Unavailable)?;

        if successor.deployment_identity != admitted.deployment_identity
            || successor.predecessor_binding_identity.as_deref()
                != Some(predecessor.binding_identity.as_str())
            || successor.generation != expected_generation
            || successor.effective_principal != admitted.effective_principal
            || successor.authorized_scope != admitted.authorized_scope
            || successor.scope_policy_version != admitted.scope_policy_version
            || successor.capability_policy_version != admitted.capability_policy_version
            || successor.audit_policy_version != admitted.audit_policy_version
            || successor.manifest_identities != admitted.manifest_identities
        {
            return Err(ProductEdgeError::Unavailable);
        }
        predecessor = successor;
    }
    Ok(predecessor)
}

fn authority_windows_are_current_at(
    cut_epoch_ms: u64,
    binding_valid_from_epoch_ms: u64,
    binding_valid_through_epoch_ms: u64,
    manifest_effective_from_epoch_ms: u64,
    manifest_valid_through_epoch_ms: u64,
    authorization_is_current: bool,
) -> bool {
    authorization_is_current
        && binding_valid_from_epoch_ms <= cut_epoch_ms
        && cut_epoch_ms < binding_valid_through_epoch_ms
        && manifest_effective_from_epoch_ms <= cut_epoch_ms
        && cut_epoch_ms < manifest_valid_through_epoch_ms
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum AuthorizationSelectionV1 {
    Current,
    Historical(String),
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct AuthorizationRequirementV1 {
    authorization_identity: String,
    issuance_receipt_identity: String,
    selection: AuthorizationSelectionV1,
}

impl AuthorizationRequirementV1 {
    fn current(locator: &OperatorAuthorizationLocatorV1) -> Self {
        Self {
            authorization_identity: locator.authorization_identity.clone(),
            issuance_receipt_identity: locator.issuance_receipt_identity.clone(),
            selection: AuthorizationSelectionV1::Current,
        }
    }

    fn historical(locator: &OperatorAuthorizationLocatorV1, frontier_identity: &str) -> Self {
        Self {
            authorization_identity: locator.authorization_identity.clone(),
            issuance_receipt_identity: locator.issuance_receipt_identity.clone(),
            selection: AuthorizationSelectionV1::Historical(frontier_identity.to_string()),
        }
    }

    fn locator(&self) -> OperatorAuthorizationLocatorV1 {
        OperatorAuthorizationLocatorV1 {
            authorization_identity: self.authorization_identity.clone(),
            issuance_receipt_identity: self.issuance_receipt_identity.clone(),
        }
    }
}

#[derive(Debug, Default)]
struct LockedAuthorizationPlanV1 {
    evidence: BTreeMap<AuthorizationRequirementV1, OperatorAuthorizationReadbackV1>,
}

impl LockedAuthorizationPlanV1 {
    fn get(
        &self,
        requirement: &AuthorizationRequirementV1,
    ) -> Result<&OperatorAuthorizationReadbackV1, ProductEdgeError> {
        if let Some(readback) = self.evidence.get(requirement) {
            return Ok(readback);
        }
        let AuthorizationSelectionV1::Historical(frontier_identity) = &requirement.selection else {
            return Err(ProductEdgeError::Unavailable);
        };
        let current = AuthorizationRequirementV1 {
            authorization_identity: requirement.authorization_identity.clone(),
            issuance_receipt_identity: requirement.issuance_receipt_identity.clone(),
            selection: AuthorizationSelectionV1::Current,
        };
        self.evidence
            .get(&current)
            .filter(|readback| readback.frontier().frontier_identity() == frontier_identity)
            .ok_or(ProductEdgeError::Unavailable)
    }
}

async fn lock_authorization_plan(
    transaction: &mut Transaction<'_, Postgres>,
    requirements: impl IntoIterator<Item = AuthorizationRequirementV1>,
) -> Result<LockedAuthorizationPlanV1, ProductEdgeError> {
    let mut requirements = requirements.into_iter().collect::<Vec<_>>();
    requirements.sort();
    requirements.dedup();
    let mut evidence = BTreeMap::new();

    for requirement in requirements {
        let mode = match &requirement.selection {
            AuthorizationSelectionV1::Current => AuthorizationReadModeV1::CurrentAtLock,
            AuthorizationSelectionV1::Historical(frontier_identity) => {
                AuthorizationReadModeV1::Historical {
                    frontier_identity: frontier_identity.clone(),
                }
            }
        };
        let readback =
            resolve_authorization_in_transaction(transaction, &requirement.locator(), mode)
                .await
                .map_err(authority)?;
        evidence.insert(requirement, readback);
    }
    Ok(LockedAuthorizationPlanV1 { evidence })
}

async fn hint_deployment_bindings(
    transaction: &mut Transaction<'_, Postgres>,
    deployment_identity: &str,
) -> Result<Vec<StoredBindingV1>, ProductEdgeError> {
    let rows = sqlx::query("SELECT binding_identity, deployment_identity, generation, predecessor_binding_identity, authorization_identity, issuance_receipt_identity, authorization_frontier_identity, binding_digest, binding_json, receipt_json, committed_at_epoch_ms FROM product_edge_deployment_bindings_v1 WHERE deployment_identity=$1 ORDER BY generation, binding_identity")
        .bind(deployment_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    rows.iter()
        .map(|row| decode_binding_row(row).map(|(stored, _)| stored))
        .collect()
}

async fn hint_admission(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<Option<StoredAdmissionV1>, ProductEdgeError> {
    let rows = sqlx::query("SELECT request_identity, admission_identity, deployment_identity, binding_identity, authorization_identity, issuance_receipt_identity, authorization_frontier_identity, request_semantic_digest, admission_digest, admission_json, receipt_json, committed_at_epoch_ms FROM product_edge_request_admissions_v1 WHERE request_identity=$1")
        .bind(request_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() > 1 {
        return Err(ProductEdgeError::Unavailable);
    }
    rows.first()
        .map(|row| decode_admission_row(row).map(|(stored, _)| stored))
        .transpose()
}

fn historical_requirements(bindings: &[StoredBindingV1]) -> Vec<AuthorizationRequirementV1> {
    bindings
        .iter()
        .map(|binding| {
            AuthorizationRequirementV1::historical(
                &binding.authorization,
                &binding.authorization_frontier_identity,
            )
        })
        .collect()
}

async fn lock_deployment_authorizations(
    transaction: &mut Transaction<'_, Postgres>,
    deployment_identity: &str,
    extra_requirements: impl IntoIterator<Item = AuthorizationRequirementV1>,
) -> Result<(Vec<StoredBindingV1>, LockedAuthorizationPlanV1), ProductEdgeError> {
    let hinted_bindings = hint_deployment_bindings(transaction, deployment_identity).await?;
    let mut requirements = historical_requirements(&hinted_bindings);
    requirements.extend(extra_requirements);
    let authorization_plan = lock_authorization_plan(transaction, requirements).await?;
    Ok((hinted_bindings, authorization_plan))
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedBindingRowV1 {
    binding_identity: String,
    deployment_identity: String,
    generation: i64,
    predecessor_binding_identity: Option<String>,
    authorization_identity: String,
    issuance_receipt_identity: String,
    authorization_frontier_identity: String,
    binding_digest: String,
    binding_json: serde_json::Value,
    receipt_json: serde_json::Value,
    committed_at_epoch_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedAdmissionRowV1 {
    request_identity: String,
    admission_identity: String,
    deployment_identity: String,
    binding_identity: String,
    authorization_identity: String,
    issuance_receipt_identity: String,
    authorization_frontier_identity: String,
    request_semantic_digest: String,
    admission_digest: String,
    admission_json: serde_json::Value,
    receipt_json: serde_json::Value,
    committed_at_epoch_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedBindingHintV1 {
    binding_identity: String,
    generation: i64,
    authorization_identity: String,
    issuance_receipt_identity: String,
    authorization_frontier_identity: String,
    binding_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedHeadRowV1 {
    deployment_identity: String,
    binding_identity: String,
    generation: i64,
    binding_digest: String,
    committed_at_epoch_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedSupersessionRowV1 {
    binding_identity: String,
    successor_binding_identity: Option<String>,
    supersession_digest: String,
    supersession_json: serde_json::Value,
    committed_at_epoch_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedBindingManifestRowV1 {
    binding_identity: String,
    manifest_identity: String,
    manifest_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedManifestRowV1 {
    manifest_identity: String,
    operation: String,
    operation_schema: String,
    target_owner: String,
    manifest_digest: String,
    manifest_json: serde_json::Value,
    receipt_json: serde_json::Value,
    committed_at_epoch_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedOutboxRowV1 {
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    payload_json: serde_json::Value,
    committed_at_epoch_ms: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct AdmissionEventStreamStateRowV1 {
    last_owner_sequence: i64,
    event_count: i64,
    minimum_owner_sequence: Option<i64>,
    maximum_owner_sequence: Option<i64>,
    admission_count: i64,
    wrong_kind_count: i64,
    broken_predecessor_count: i64,
    broken_assignment_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedAuthorizationEnvelopeSourceV1 {
    authorization_identity: String,
    issuance_receipt_identity: String,
    envelope: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedDownstreamAdmissionEnvelopeV1 {
    hinted_admission: LockedAdmissionRowV1,
    hinted_binding_locators: Vec<LockedBindingHintV1>,
    admission: LockedAdmissionRowV1,
    bindings: Vec<LockedBindingRowV1>,
    head: Option<LockedHeadRowV1>,
    supersessions: Vec<LockedSupersessionRowV1>,
    binding_manifests: Vec<LockedBindingManifestRowV1>,
    manifests: Vec<LockedManifestRowV1>,
    outboxes: Vec<LockedOutboxRowV1>,
    authorizations: Vec<LockedAuthorizationEnvelopeSourceV1>,
}

fn decode_locked_binding(
    row: &LockedBindingRowV1,
) -> Result<(StoredBindingV1, StoredBindingReceiptV1), ProductEdgeError> {
    let stored: StoredBindingV1 = from_json(row.binding_json.clone())?;
    let receipt: StoredBindingReceiptV1 = from_json(row.receipt_json.clone())?;

    if stored.schema_version != PRODUCT_EDGE_SCHEMA_V1
        || row.binding_identity != stored.binding_identity
        || row.deployment_identity != stored.deployment_identity
        || row.generation != to_i64(stored.generation)?
        || row.predecessor_binding_identity != stored.predecessor_binding_identity
        || row.authorization_identity != stored.authorization.authorization_identity
        || row.issuance_receipt_identity != stored.authorization.issuance_receipt_identity
        || row.authorization_frontier_identity != stored.authorization_frontier_identity
        || row.binding_digest != stored.binding_digest
        || binding_digest(&stored)? != stored.binding_digest
        || from_i64(row.committed_at_epoch_ms)? != stored.committed_at_epoch_ms
        || receipt != binding_receipt(&stored)
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok((stored, receipt))
}

fn decode_locked_admission(
    row: &LockedAdmissionRowV1,
) -> Result<(StoredAdmissionV1, StoredAdmissionReceiptV1), ProductEdgeError> {
    let stored: StoredAdmissionV1 = from_json(row.admission_json.clone())?;
    let receipt: StoredAdmissionReceiptV1 = from_json(row.receipt_json.clone())?;
    if row.request_identity != stored.request.request_identity
        || row.admission_identity != stored.admission_identity
        || row.deployment_identity != stored.deployment_identity
        || row.binding_identity != stored.binding_identity
        || row.authorization_identity != stored.authorization.authorization_identity
        || row.issuance_receipt_identity != stored.authorization.issuance_receipt_identity
        || row.authorization_frontier_identity != stored.authorization_frontier_identity
        || row.request_semantic_digest != stored.request_semantic_digest
        || row.admission_digest != stored.admission_digest
        || from_i64(row.committed_at_epoch_ms)? != stored.committed_at_epoch_ms
        || receipt != admission_receipt(&stored)
        || stored.request.semantic_digest()? != stored.request_semantic_digest
        || admission_digest(&stored)? != stored.admission_digest
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok((stored, receipt))
}

fn decode_locked_manifest(
    row: &LockedManifestRowV1,
) -> Result<(StoredManifestV1, StoredManifestReceiptV1), ProductEdgeError> {
    let stored: StoredManifestV1 = from_json(row.manifest_json.clone())?;
    let receipt: StoredManifestReceiptV1 = from_json(row.receipt_json.clone())?;

    if stored.schema_version != PRODUCT_EDGE_SCHEMA_V1
        || row.manifest_identity != stored.manifest_identity
        || row.operation != stored.proposal.operation
        || row.operation_schema != stored.proposal.operation_schema
        || row.target_owner != stored.proposal.target_owner
        || row.manifest_digest != stored.manifest_digest
        || stored.proposal.manifest_identity()? != stored.manifest_identity
        || stored.proposal.manifest_digest()? != stored.manifest_digest
        || from_i64(row.committed_at_epoch_ms)? != stored.committed_at_epoch_ms
        || receipt != manifest_receipt(&stored)
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok((stored, receipt))
}

fn verify_locked_outbox<T: Serialize>(
    rows: &[LockedOutboxRowV1],
    seed: &str,
    aggregate: &str,
    kind: &str,
    payload: &T,
    committed_at: u64,
) -> Result<(), ProductEdgeError> {
    let payload_digest = canonical_digest("product-edge.outbox-payload.v1", payload)?;
    let event_identity = identity(
        "product-edge-owner-event-v1",
        &[
            seed,
            aggregate,
            kind,
            &payload_digest,
            &committed_at.to_string(),
        ],
    );
    let matches = rows
        .iter()
        .filter(|row| row.aggregate_identity == aggregate && row.event_kind == kind)
        .collect::<Vec<_>>();

    if matches.len() != 1 {
        return Err(ProductEdgeError::Unavailable);
    }
    let row = matches[0];
    let record: StoredOutboxV1 = from_json(row.payload_json.clone())?;
    if row.event_identity != event_identity
        || row.payload_digest != payload_digest
        || from_i64(row.committed_at_epoch_ms)? != committed_at
        || record
            != (StoredOutboxV1 {
                schema_version: PRODUCT_EDGE_SCHEMA_V1,
                event_identity,
                aggregate_identity: aggregate.to_string(),
                event_kind: kind.to_string(),
                payload_digest,
                committed_at_epoch_ms: committed_at,
            })
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok(())
}

fn verify_locked_downstream_envelope(
    value: serde_json::Value,
    locator: &ProductEdgeAdmissionLocatorV1,
    mode: DownstreamAdmissionModeV1,
) -> Result<ProductEdgeAdmissionReadbackV1, ProductEdgeError> {
    let envelope: LockedDownstreamAdmissionEnvelopeV1 = from_json(value)?;
    if envelope.hinted_admission != envelope.admission {
        return Err(ProductEdgeError::Unavailable);
    }
    let (stored_admission, admission_receipt_value) = decode_locked_admission(&envelope.admission)?;
    if stored_admission.request.request_identity != locator.request_identity
        || stored_admission.admission_identity != locator.admission_identity
        || stored_admission.admission_digest != locator.admission_digest
    {
        return Err(ProductEdgeError::Unavailable);
    }

    let mut authorization_sources = BTreeMap::new();
    for source in envelope.authorizations {
        if authorization_sources
            .insert(
                (
                    source.authorization_identity,
                    source.issuance_receipt_identity,
                ),
                source.envelope,
            )
            .is_some()
        {
            return Err(ProductEdgeError::Unavailable);
        }
    }

    let mut manifests = BTreeMap::new();
    for row in &envelope.manifests {
        let (manifest, receipt) = decode_locked_manifest(row)?;
        verify_locked_outbox(
            &envelope.outboxes,
            &receipt.receipt_identity,
            &manifest.manifest_identity,
            MANIFEST_EVENT,
            &receipt,
            manifest.committed_at_epoch_ms,
        )?;

        if manifests
            .insert(manifest.manifest_identity.clone(), manifest)
            .is_some()
        {
            return Err(ProductEdgeError::Unavailable);
        }
    }

    let mut bindings = Vec::with_capacity(envelope.bindings.len());
    let mut binding_receipts = BTreeMap::new();

    for (index, row) in envelope.bindings.iter().enumerate() {
        let (binding, receipt) = decode_locked_binding(row)?;
        let expected_generation = u64::try_from(index)
            .map_err(storage)?
            .checked_add(1)
            .ok_or(ProductEdgeError::Unavailable)?;

        if binding.deployment_identity != stored_admission.deployment_identity
            || binding.generation != expected_generation
            || binding.predecessor_binding_identity
                != bindings
                    .last()
                    .map(|prior: &StoredBindingV1| prior.binding_identity.clone())
            || bindings
                .last()
                .is_some_and(|prior| binding.committed_at_epoch_ms < prior.committed_at_epoch_ms)
        {
            return Err(ProductEdgeError::Unavailable);
        }
        let hint = envelope
            .hinted_binding_locators
            .get(index)
            .ok_or(ProductEdgeError::Unavailable)?;

        if hint.binding_identity != binding.binding_identity
            || hint.generation != to_i64(binding.generation)?
            || hint.authorization_identity != binding.authorization.authorization_identity
            || hint.issuance_receipt_identity != binding.authorization.issuance_receipt_identity
            || hint.authorization_frontier_identity != binding.authorization_frontier_identity
            || hint.binding_digest != binding.binding_digest
        {
            return Err(ProductEdgeError::Unavailable);
        }

        let mapped = envelope
            .binding_manifests
            .iter()
            .filter(|entry| entry.binding_identity == binding.binding_identity)
            .collect::<Vec<_>>();

        if mapped.len() != binding.manifest_identities.len() {
            return Err(ProductEdgeError::Unavailable);
        }
        let mut manifest_bindings = Vec::with_capacity(mapped.len());
        for (mapped, identity) in mapped.iter().zip(&binding.manifest_identities) {
            let manifest = manifests
                .get(identity)
                .ok_or(ProductEdgeError::Unavailable)?;

            if mapped.manifest_identity != *identity
                || mapped.manifest_digest != manifest.manifest_digest
            {
                return Err(ProductEdgeError::Unavailable);
            }
            manifest_bindings.push(OperationManifestBindingV1 {
                manifest_identity: manifest.manifest_identity.clone(),
                manifest_digest: manifest.manifest_digest.clone(),
            });
        }
        let source = authorization_sources
            .get(&(
                binding.authorization.authorization_identity.clone(),
                binding.authorization.issuance_receipt_identity.clone(),
            ))
            .ok_or(ProductEdgeError::Unavailable)?;
        let authorization = parse_untrusted_authorization_envelope_v1(
            source.clone(),
            &binding.authorization,
            AuthorizationReadModeV1::Historical {
                frontier_identity: binding.authorization_frontier_identity.clone(),
            },
        )
        .map_err(authority)?;

        if authorization.frontier().frontier_identity() != binding.authorization_frontier_identity
            || authorization.scope().principal != binding.effective_principal
            || authorization.scope().permissions != binding.authorized_scope
            || authorization.operation_manifests() != manifest_bindings.as_slice()
            || binding.valid_from_epoch_ms < authorization.not_before_epoch_ms()
            || binding.valid_through_epoch_ms > authorization.valid_through_epoch_ms()
        {
            return Err(ProductEdgeError::Unavailable);
        }
        verify_locked_outbox(
            &envelope.outboxes,
            &receipt.receipt_identity,
            &binding.binding_identity,
            BINDING_EVENT,
            &receipt,
            binding.committed_at_epoch_ms,
        )?;
        binding_receipts.insert(binding.binding_identity.clone(), receipt);
        bindings.push(binding);
    }

    if bindings.len() != envelope.hinted_binding_locators.len()
        || bindings.is_empty()
        || manifests.len()
            != envelope
                .binding_manifests
                .iter()
                .map(|row| &row.manifest_identity)
                .collect::<std::collections::BTreeSet<_>>()
                .len()
    {
        return Err(ProductEdgeError::Unavailable);
    }

    let mut supersessions = BTreeMap::new();
    for row in &envelope.supersessions {
        let stored: StoredSupersessionV1 = from_json(row.supersession_json.clone())?;
        if row.binding_identity != stored.binding_identity
            || row.successor_binding_identity.as_deref()
                != Some(stored.successor_binding_identity.as_str())
            || row.supersession_digest != stored.supersession_digest
            || supersession_digest(&stored)? != stored.supersession_digest
            || from_i64(row.committed_at_epoch_ms)? != stored.committed_at_epoch_ms
            || supersessions
                .insert(stored.binding_identity.clone(), stored)
                .is_some()
        {
            return Err(ProductEdgeError::Unavailable);
        }
    }

    for (index, binding) in bindings.iter().enumerate() {
        let supersession = supersessions.get(&binding.binding_identity);

        if index + 1 < bindings.len() {
            let successor = &bindings[index + 1];
            let supersession = supersession.ok_or(ProductEdgeError::Unavailable)?;
            let manifests = successor
                .manifest_identities
                .iter()
                .map(|identity| {
                    manifests
                        .get(identity)
                        .map(|manifest| manifest.proposal.clone())
                        .ok_or(ProductEdgeError::Unavailable)
                })
                .collect::<Result<Vec<_>, _>>()?;
            let expected_proposal = ProductEdgeSuccessorProposalV1 {
                deployment_identity: successor.deployment_identity.clone(),
                binding_identity: successor.binding_identity.clone(),
                predecessor_binding_identity: binding.binding_identity.clone(),
                expected_history_head: binding.binding_identity.clone(),
                generation: successor.generation,
                effective_principal: successor.effective_principal.clone(),
                scope_policy_version: successor.scope_policy_version.clone(),
                capability_policy_version: successor.capability_policy_version.clone(),
                audit_policy_version: successor.audit_policy_version.clone(),
                valid_from_epoch_ms: successor.valid_from_epoch_ms,
                valid_through_epoch_ms: successor.valid_through_epoch_ms,
                authorization: successor.authorization.clone(),
                manifests,
            };

            let expected_digest = if let Some(epoch) = &successor.recovery_epoch {
                ProductEdgeExpiredManifestRecoveryProposalV1 {
                    recovery_epoch: epoch.clone(),
                    successor: expected_proposal,
                }
                .semantic_digest()?
            } else {
                expected_proposal.semantic_digest()?
            };

            if supersession.successor_binding_identity != successor.binding_identity
                || supersession.successor_proposal_digest != expected_digest
            {
                return Err(ProductEdgeError::Unavailable);
            }
        }

        if let Some(supersession) = supersession {
            verify_locked_outbox(
                &envelope.outboxes,
                &supersession.supersession_digest,
                &binding.binding_identity,
                SUPERSESSION_EVENT,
                supersession,
                supersession.committed_at_epoch_ms,
            )?;
        }
    }

    let head = envelope.head.ok_or(ProductEdgeError::Unavailable)?;
    let current = bindings.last().ok_or(ProductEdgeError::Unavailable)?;
    if head.deployment_identity != current.deployment_identity
        || head.binding_identity != current.binding_identity
        || head.generation != to_i64(current.generation)?
        || head.binding_digest != current.binding_digest
        || from_i64(head.committed_at_epoch_ms)? != current.committed_at_epoch_ms
    {
        return Err(ProductEdgeError::Unavailable);
    }

    let binding = bindings
        .iter()
        .find(|binding| binding.binding_identity == stored_admission.binding_identity)
        .ok_or(ProductEdgeError::Unavailable)?;

    let policy_binding = match mode {
        DownstreamAdmissionModeV1::FirstMutation { .. } => first_mutation_policy_binding(
            &stored_admission,
            &bindings,
            supersessions.contains_key(&current.binding_identity),
        )?,
        DownstreamAdmissionModeV1::Historical => binding,
    };
    let manifest = manifests
        .get(&stored_admission.manifest_identity)
        .ok_or(ProductEdgeError::Unavailable)?;

    if binding.generation != stored_admission.binding_generation
        || binding.binding_identity != stored_admission.history_head_identity
        || binding.effective_principal != stored_admission.effective_principal
        || binding.authorized_scope != stored_admission.authorized_scope
        || binding.scope_policy_version != stored_admission.scope_policy_version
        || binding.capability_policy_version != stored_admission.capability_policy_version
        || binding.audit_policy_version != stored_admission.audit_policy_version
        || binding.authorization != stored_admission.authorization
        || binding.authorization_frontier_identity
            != stored_admission.authorization_frontier_identity
        || !binding
            .manifest_identities
            .contains(&stored_admission.manifest_identity)
        || manifest.manifest_digest != stored_admission.manifest_digest
        || manifest.proposal.operation != stored_admission.request.operation
        || manifest.proposal.operation_schema != stored_admission.request.operation_schema
        || manifest.proposal.target_owner != stored_admission.request.target_owner
    {
        return Err(ProductEdgeError::Unavailable);
    }

    let source = authorization_sources
        .get(&(
            stored_admission
                .authorization
                .authorization_identity
                .clone(),
            stored_admission
                .authorization
                .issuance_receipt_identity
                .clone(),
        ))
        .ok_or(ProductEdgeError::Unavailable)?;
    let authorization_mode = AuthorizationReadModeV1::Historical {
        frontier_identity: stored_admission.authorization_frontier_identity.clone(),
    };
    let authorization: UntrustedCanonicalAuthorizationEvidenceV1 =
        parse_untrusted_authorization_envelope_v1(
            source.clone(),
            &stored_admission.authorization,
            authorization_mode,
        )
        .map_err(authority)?;

    if authorization.frontier().frontier_identity()
        != stored_admission.authorization_frontier_identity
        || authorization.scope().principal != stored_admission.effective_principal
        || authorization.scope().permissions != stored_admission.authorized_scope
        || authorization.request_proof_digest() != stored_admission.request.request_proof_digest
        || !authorization.operation_manifests().iter().any(|entry| {
            entry.manifest_identity == stored_admission.manifest_identity
                && entry.manifest_digest == stored_admission.manifest_digest
        })
    {
        return Err(ProductEdgeError::Unavailable);
    }
    let original_current_authorization_evidence =
        if let DownstreamAdmissionModeV1::FirstMutation { read_cut_epoch_ms } = mode {
            let current_original = parse_untrusted_authorization_envelope_v1(
                source.clone(),
                &stored_admission.authorization,
                AuthorizationReadModeV1::CurrentAtLock,
            )
            .map_err(authority)?;

            if !current_original.is_current_at(read_cut_epoch_ms)
                || current_original.scope().principal != stored_admission.effective_principal
                || current_original.scope().permissions != stored_admission.authorized_scope
                || current_original.request_proof_digest()
                    != stored_admission.request.request_proof_digest
            {
                return Err(ProductEdgeError::Unavailable);
            }
            Some(current_original)
        } else {
            None
        };
    let current_policy_evidence =
        if let DownstreamAdmissionModeV1::FirstMutation { read_cut_epoch_ms } = mode {
            let current_source = authorization_sources
                .get(&(
                    policy_binding.authorization.authorization_identity.clone(),
                    policy_binding
                        .authorization
                        .issuance_receipt_identity
                        .clone(),
                ))
                .ok_or(ProductEdgeError::Unavailable)?;
            let current_authorization = parse_untrusted_authorization_envelope_v1(
                current_source.clone(),
                &policy_binding.authorization,
                AuthorizationReadModeV1::CurrentAtLock,
            )
            .map_err(authority)?;
            let current_manifest_bindings = policy_binding
                .manifest_identities
                .iter()
                .map(|identity| {
                    manifests
                        .get(identity)
                        .map(|manifest| OperationManifestBindingV1 {
                            manifest_identity: manifest.manifest_identity.clone(),
                            manifest_digest: manifest.manifest_digest.clone(),
                        })
                        .ok_or(ProductEdgeError::Unavailable)
                })
                .collect::<Result<Vec<_>, _>>()?;

            if current_authorization.frontier().frontier_identity()
                != policy_binding.authorization_frontier_identity
                || current_authorization.scope().principal != policy_binding.effective_principal
                || current_authorization.scope().permissions != policy_binding.authorized_scope
                || original_current_authorization_evidence
                    .as_ref()
                    .is_none_or(|original| {
                        original.scope() != current_authorization.scope()
                            || original.request_proof_digest()
                                != current_authorization.request_proof_digest()
                            || original.operation_manifests()
                                != current_authorization.operation_manifests()
                    })
                || current_authorization.operation_manifests()
                    != current_manifest_bindings.as_slice()
                || !authority_windows_are_current_at(
                    read_cut_epoch_ms,
                    policy_binding.valid_from_epoch_ms,
                    policy_binding.valid_through_epoch_ms,
                    manifest.proposal.effective_from_epoch_ms,
                    manifest.proposal.valid_through_epoch_ms,
                    current_authorization.is_current_at(read_cut_epoch_ms),
                )
            {
                return Err(ProductEdgeError::Unavailable);
            }
            Some(ProductEdgeCurrentPolicyEvidenceV1 {
                binding_identity: policy_binding.binding_identity.clone(),
                binding_generation: policy_binding.generation,
                authorization: current_authorization,
                manifest_identity: manifest.manifest_identity.clone(),
                manifest_digest: manifest.manifest_digest.clone(),
                binding_valid_from_epoch_ms: policy_binding.valid_from_epoch_ms,
                binding_valid_through_epoch_ms: policy_binding.valid_through_epoch_ms,
                manifest_effective_from_epoch_ms: manifest.proposal.effective_from_epoch_ms,
                manifest_valid_through_epoch_ms: manifest.proposal.valid_through_epoch_ms,
            })
        } else {
            None
        };
    verify_locked_outbox(
        &envelope.outboxes,
        &admission_receipt_value.receipt_identity,
        &stored_admission.admission_identity,
        ADMISSION_EVENT,
        &admission_receipt_value,
        stored_admission.committed_at_epoch_ms,
    )?;
    let expected_outbox_count = manifests.len() + bindings.len() + supersessions.len() + 1;
    if envelope.outboxes.len() != expected_outbox_count
        || authorization_sources.len()
            != bindings
                .iter()
                .map(|binding| {
                    (
                        binding.authorization.authorization_identity.clone(),
                        binding.authorization.issuance_receipt_identity.clone(),
                    )
                })
                .chain(std::iter::once((
                    stored_admission
                        .authorization
                        .authorization_identity
                        .clone(),
                    stored_admission
                        .authorization
                        .issuance_receipt_identity
                        .clone(),
                )))
                .collect::<std::collections::BTreeSet<_>>()
                .len()
    {
        return Err(ProductEdgeError::Unavailable);
    }

    Ok(ProductEdgeAdmissionReadbackV1 {
        locator: ProductEdgeAdmissionLocatorV1 {
            request_identity: stored_admission.request.request_identity.clone(),
            admission_identity: stored_admission.admission_identity,
            admission_digest: stored_admission.admission_digest,
        },
        receipt: admission_receipt_value.into(),
        request: stored_admission.request,
        deployment_identity: stored_admission.deployment_identity,
        binding_identity: stored_admission.binding_identity,
        binding_generation: stored_admission.binding_generation,
        history_head_identity: stored_admission.history_head_identity,
        effective_principal: stored_admission.effective_principal,
        authorized_scope: stored_admission.authorized_scope,
        scope_policy_version: stored_admission.scope_policy_version,
        capability_policy_version: stored_admission.capability_policy_version,
        audit_policy_version: stored_admission.audit_policy_version,
        authorization,
        manifest_identity: stored_admission.manifest_identity,
        manifest_digest: stored_admission.manifest_digest,
        read_cut_epoch_ms: stored_admission.read_cut_epoch_ms,
        manifest_proposal: manifest.proposal.clone(),
        original_current_authorization_evidence,
        current_policy_evidence,
    })
}

#[derive(Clone)]
/// PostgreSQL Product Edge Owner boundary.
///
/// The writer pool is deliberately not part of the consumer API:
/// ```compile_fail
/// use vibe_product_edge::ProductEdgePostgresOwnerV1;
/// fn raw_writer(owner: &ProductEdgePostgresOwnerV1) {
///     let _ = owner.pool();
/// }
/// ```
pub struct ProductEdgePostgresOwnerV1 {
    pool: PgPool,
    deployment_identity: String,
    authorization_trust: ProductEdgeAuthorizationTrustV1,
}

#[derive(Clone)]
/// Read-only PostgreSQL capability for the Product Edge admission event stream.
///
/// Construction performs no migration and the capability exposes neither the
/// underlying pool nor any Product Edge mutation API:
/// ```compile_fail
/// use vibe_product_edge::ProductEdgePostgresAdmissionReadPortV1;
/// fn consumer_cannot_write(port: &ProductEdgePostgresAdmissionReadPortV1) {
///     let _ = port.admit_request;
///     let _ = port.pool();
/// }
/// ```
pub struct ProductEdgePostgresAdmissionReadPortV1 {
    pool: PgPool,
}

impl ProductEdgePostgresAdmissionReadPortV1 {
    pub async fn connect(database_url: &str) -> Result<Self, ProductEdgeError> {
        let pool = PgPool::connect(database_url).await.map_err(storage)?;
        let mut transaction = begin_repeatable_read(&pool)
            .await
            .map_err(|_| ProductEdgeError::Unavailable)?;
        verify_admission_event_stream(&mut transaction)
            .await
            .map_err(|_| ProductEdgeError::Unavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| ProductEdgeError::Unavailable)?;
        Ok(Self { pool })
    }

    pub async fn follow_admission_events_after(
        &self,
        cursor: &ProductEdgeAdmissionEventCursorV1,
        page_size: u32,
    ) -> Result<Vec<ProductEdgeAdmissionEventLocatorV1>, ProductEdgeError> {
        follow_admission_events_after(&self.pool, cursor, page_size).await
    }

    pub async fn resolve_admission_observation(
        &self,
        locator: &ProductEdgeAdmissionEventLocatorV1,
    ) -> Result<ProductEdgeAdmissionObservationV1, ProductEdgeError> {
        resolve_admission_observation(&self.pool, locator).await
    }
}

async fn verify_expired_manifest_recovery_schema(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), ProductEdgeError> {
    let verified = sqlx::query_scalar::<_, bool>(VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(storage)?
        .unwrap_or(false);

    if !verified {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok(())
}

async fn prepare_expired_manifest_recovery_schema_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), ProductEdgeError> {
    for statement in EXPIRED_MANIFEST_RECOVERY_SCHEMA_STATEMENTS {
        sqlx::query(statement)
            .execute(&mut **transaction)
            .await
            .map_err(storage)?;
    }
    verify_expired_manifest_recovery_schema(transaction).await
}

impl ProductEdgePostgresOwnerV1 {
    pub async fn connect(
        database_url: &str,
        deployment_identity: impl Into<String>,
        authorization_trust: ProductEdgeAuthorizationTrustV1,
    ) -> Result<Self, ProductEdgeError> {
        let deployment_identity = deployment_identity.into();
        if deployment_identity.trim().is_empty() {
            return Err(ProductEdgeError::InvalidProposal("deployment locator"));
        }
        authorization_trust.validate()?;
        let pool = PgPool::connect(database_url).await.map_err(storage)?;
        let owner = Self {
            pool,
            deployment_identity,
            authorization_trust,
        };
        owner.migrate().await?;
        Ok(owner)
    }

    /// Connects the Owner for expired-manifest recovery and prepares only the
    /// recovery sidecar schema. Existing Owner tables must already exist.
    pub async fn connect_for_expired_manifest_recovery(
        database_url: &str,
        deployment_identity: impl Into<String>,
        authorization_trust: ProductEdgeAuthorizationTrustV1,
    ) -> Result<Self, ProductEdgeError> {
        let deployment_identity = deployment_identity.into();
        if deployment_identity.trim().is_empty() {
            return Err(ProductEdgeError::InvalidProposal("deployment locator"));
        }
        authorization_trust.validate()?;
        let pool = PgPool::connect(database_url).await.map_err(storage)?;
        let owner = Self {
            pool,
            deployment_identity,
            authorization_trust,
        };
        owner.prepare_expired_manifest_recovery_schema().await?;
        Ok(owner)
    }

    async fn migrate(&self) -> Result<(), ProductEdgeError> {
        self.migrate_observing(|_| std::future::ready(())).await
    }

    async fn migrate_observing<F, Fut>(&self, mut observe: F) -> Result<(), ProductEdgeError>
    where
        F: FnMut(&str) -> Fut,
        Fut: std::future::Future<Output = ()>,
    {
        let mut transaction = self.pool.begin().await.map_err(storage)?;

        for statement in [
            "CREATE TABLE IF NOT EXISTS product_edge_operation_manifests_v1 (manifest_identity TEXT PRIMARY KEY, operation TEXT NOT NULL, operation_schema TEXT NOT NULL, target_owner TEXT NOT NULL, manifest_digest TEXT NOT NULL, manifest_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "ALTER TABLE product_edge_operation_manifests_v1 DROP CONSTRAINT IF EXISTS product_edge_operation_manifests_v1_operation_operation_schema_target_owner_key",
            "ALTER TABLE product_edge_operation_manifests_v1 DROP CONSTRAINT IF EXISTS product_edge_operation_manife_operation_operation_schema_ta_key",
            "CREATE INDEX IF NOT EXISTS product_edge_manifest_operation_v1 ON product_edge_operation_manifests_v1(operation, operation_schema, target_owner)",
            "CREATE TABLE IF NOT EXISTS product_edge_deployment_bindings_v1 (binding_identity TEXT PRIMARY KEY, deployment_identity TEXT NOT NULL, generation BIGINT NOT NULL, predecessor_binding_identity TEXT, authorization_identity TEXT, issuance_receipt_identity TEXT, authorization_frontier_identity TEXT, binding_digest TEXT NOT NULL, binding_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE(deployment_identity, generation))",
            "ALTER TABLE product_edge_deployment_bindings_v1 ADD COLUMN IF NOT EXISTS authorization_identity TEXT",
            "ALTER TABLE product_edge_deployment_bindings_v1 ADD COLUMN IF NOT EXISTS issuance_receipt_identity TEXT",
            "ALTER TABLE product_edge_deployment_bindings_v1 ADD COLUMN IF NOT EXISTS authorization_frontier_identity TEXT",
            "UPDATE product_edge_deployment_bindings_v1 SET authorization_identity=binding_json#>>'{authorization,authorization_identity}', issuance_receipt_identity=binding_json#>>'{authorization,issuance_receipt_identity}', authorization_frontier_identity=binding_json->>'authorization_frontier_identity' WHERE binding_json ? 'authorization_frontier_identity' AND (authorization_identity IS NULL OR issuance_receipt_identity IS NULL OR authorization_frontier_identity IS NULL)",
            "CREATE TABLE IF NOT EXISTS product_edge_deployment_supersessions_v1 (binding_identity TEXT PRIMARY KEY REFERENCES product_edge_deployment_bindings_v1(binding_identity), successor_binding_identity TEXT, supersession_digest TEXT NOT NULL, supersession_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS product_edge_binding_manifests_v1 (binding_identity TEXT NOT NULL REFERENCES product_edge_deployment_bindings_v1(binding_identity), manifest_identity TEXT NOT NULL REFERENCES product_edge_operation_manifests_v1(manifest_identity), manifest_digest TEXT NOT NULL, PRIMARY KEY(binding_identity, manifest_identity))",
            "CREATE TABLE IF NOT EXISTS product_edge_deployment_heads_v1 (deployment_identity TEXT PRIMARY KEY, binding_identity TEXT NOT NULL REFERENCES product_edge_deployment_bindings_v1(binding_identity), generation BIGINT NOT NULL, binding_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS product_edge_request_admissions_v1 (request_identity TEXT PRIMARY KEY, admission_identity TEXT NOT NULL UNIQUE, deployment_identity TEXT, binding_identity TEXT, authorization_identity TEXT, issuance_receipt_identity TEXT, authorization_frontier_identity TEXT, request_semantic_digest TEXT NOT NULL, admission_digest TEXT NOT NULL, admission_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "ALTER TABLE product_edge_request_admissions_v1 ADD COLUMN IF NOT EXISTS deployment_identity TEXT",
            "ALTER TABLE product_edge_request_admissions_v1 ADD COLUMN IF NOT EXISTS binding_identity TEXT",
            "ALTER TABLE product_edge_request_admissions_v1 ADD COLUMN IF NOT EXISTS authorization_identity TEXT",
            "ALTER TABLE product_edge_request_admissions_v1 ADD COLUMN IF NOT EXISTS issuance_receipt_identity TEXT",
            "ALTER TABLE product_edge_request_admissions_v1 ADD COLUMN IF NOT EXISTS authorization_frontier_identity TEXT",
            "UPDATE product_edge_request_admissions_v1 SET deployment_identity=admission_json->>'deployment_identity', binding_identity=admission_json->>'binding_identity', authorization_identity=admission_json#>>'{authorization,authorization_identity}', issuance_receipt_identity=admission_json#>>'{authorization,issuance_receipt_identity}', authorization_frontier_identity=admission_json->>'authorization_frontier_identity' WHERE deployment_identity IS NULL OR binding_identity IS NULL OR authorization_identity IS NULL OR issuance_receipt_identity IS NULL OR authorization_frontier_identity IS NULL",
            "CREATE TABLE IF NOT EXISTS product_edge_effect_invocation_admissions_v1 (receipt_identity TEXT PRIMARY KEY, receipt_digest TEXT NOT NULL, admission_identity TEXT NOT NULL UNIQUE, attempt_identity TEXT NOT NULL UNIQUE, claim_identity TEXT NOT NULL UNIQUE, receipt_json JSONB NOT NULL, write_cut_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS product_edge_effect_invocation_claims_v1 (admission_identity TEXT PRIMARY KEY, claim_identity TEXT NOT NULL UNIQUE, attempt_identity TEXT NOT NULL UNIQUE, claim_digest TEXT NOT NULL, claim_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS product_edge_effect_invocation_states_v1 (claim_identity TEXT PRIMARY KEY REFERENCES product_edge_effect_invocation_claims_v1(claim_identity), admission_identity TEXT NOT NULL UNIQUE, attempt_identity TEXT NOT NULL UNIQUE, claim_digest TEXT NOT NULL, state_digest TEXT NOT NULL, state_json JSONB NOT NULL, updated_at_epoch_ms BIGINT NOT NULL)",
            "CREATE OR REPLACE FUNCTION product_edge_api.lock_legacy_prepared_attempt_drain_effects_v1() RETURNS jsonb LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog AS $function$ BEGIN IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF; LOCK TABLE public.product_edge_effect_invocation_admissions_v1 IN SHARE ROW EXCLUSIVE MODE; LOCK TABLE public.product_edge_effect_invocation_claims_v1 IN SHARE ROW EXCLUSIVE MODE; LOCK TABLE public.product_edge_effect_invocation_states_v1 IN SHARE ROW EXCLUSIVE MODE; RETURN pg_catalog.jsonb_build_object('schema_version', 1); END $function$",
            "ALTER FUNCTION product_edge_api.lock_legacy_prepared_attempt_drain_effects_v1() OWNER TO product_edge_owner",
            "REVOKE ALL ON FUNCTION product_edge_api.lock_legacy_prepared_attempt_drain_effects_v1() FROM PUBLIC, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer, backtest_owner, portfolio_owner",
            "GRANT EXECUTE ON FUNCTION product_edge_api.lock_legacy_prepared_attempt_drain_effects_v1() TO rd_owner, product_edge_owner",
            "CREATE OR REPLACE FUNCTION product_edge_api.read_legacy_prepared_attempt_absence_v1(requested_admission_identity text, requested_attempt_identity text) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog AS $function$ DECLARE admission_count bigint; claim_count bigint; state_count bigint; provider_start_count bigint; BEGIN IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF; LOCK TABLE public.product_edge_effect_invocation_admissions_v1 IN SHARE ROW EXCLUSIVE MODE; LOCK TABLE public.product_edge_effect_invocation_claims_v1 IN SHARE ROW EXCLUSIVE MODE; LOCK TABLE public.product_edge_effect_invocation_states_v1 IN SHARE ROW EXCLUSIVE MODE; SELECT pg_catalog.count(*) INTO admission_count FROM public.product_edge_effect_invocation_admissions_v1 WHERE admission_identity=requested_admission_identity OR attempt_identity=requested_attempt_identity; SELECT pg_catalog.count(*) INTO claim_count FROM public.product_edge_effect_invocation_claims_v1 WHERE admission_identity=requested_admission_identity OR attempt_identity=requested_attempt_identity; SELECT pg_catalog.count(*) INTO state_count FROM public.product_edge_effect_invocation_states_v1 WHERE admission_identity=requested_admission_identity OR attempt_identity=requested_attempt_identity; SELECT pg_catalog.count(*) INTO provider_start_count FROM public.product_edge_effect_invocation_states_v1 WHERE (admission_identity=requested_admission_identity OR attempt_identity=requested_attempt_identity) AND state_json->>'state'='INVOCATION_STARTED'; RETURN pg_catalog.jsonb_build_object('schema_version', 1, 'effect_invocation_admission_count', admission_count, 'effect_invocation_claim_count', claim_count, 'effect_invocation_state_count', state_count, 'provider_start_custody_count', provider_start_count); END $function$",
            "ALTER FUNCTION product_edge_api.read_legacy_prepared_attempt_absence_v1(text,text) OWNER TO product_edge_owner",
            "REVOKE ALL ON FUNCTION product_edge_api.read_legacy_prepared_attempt_absence_v1(text,text) FROM PUBLIC, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer, backtest_owner, portfolio_owner",
            "GRANT EXECUTE ON FUNCTION product_edge_api.read_legacy_prepared_attempt_absence_v1(text,text) TO rd_owner, product_edge_owner",
            "CREATE TABLE IF NOT EXISTS product_edge_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)",
            "CREATE OR REPLACE FUNCTION product_edge_reject_admission_event_mutation_v1() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN IF OLD.event_kind = 'PRODUCT_EDGE_REQUEST_ADMITTED_V1' OR (TG_OP = 'UPDATE' AND NEW.event_kind = 'PRODUCT_EDGE_REQUEST_ADMITTED_V1') THEN RAISE EXCEPTION 'product edge admission events are immutable' USING ERRCODE = '55000'; END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $function$",
            "REVOKE ALL ON FUNCTION product_edge_reject_admission_event_mutation_v1() FROM PUBLIC",
            "DROP TRIGGER IF EXISTS product_edge_admission_event_immutable_v1 ON product_edge_owner_outbox_v1",
            "CREATE TRIGGER product_edge_admission_event_immutable_v1 BEFORE UPDATE OR DELETE ON product_edge_owner_outbox_v1 FOR EACH ROW EXECUTE FUNCTION product_edge_reject_admission_event_mutation_v1()",
            "CREATE TABLE IF NOT EXISTS product_edge_admission_event_stream_v1 (stream_identity TEXT PRIMARY KEY, last_owner_sequence BIGINT NOT NULL CHECK (last_owner_sequence >= 0))",
            "INSERT INTO product_edge_admission_event_stream_v1 (stream_identity, last_owner_sequence) VALUES ('product-edge.admission-events.v1', 0) ON CONFLICT (stream_identity) DO NOTHING",
            "CREATE TABLE IF NOT EXISTS product_edge_admission_events_v1 (owner_sequence BIGINT PRIMARY KEY CHECK (owner_sequence > 0), event_identity TEXT NOT NULL UNIQUE REFERENCES product_edge_owner_outbox_v1(event_identity), predecessor_event_identity TEXT, assignment_mode TEXT NOT NULL)",
            "ALTER TABLE product_edge_admission_events_v1 ADD COLUMN IF NOT EXISTS predecessor_event_identity TEXT",
            "ALTER TABLE product_edge_admission_events_v1 ADD COLUMN IF NOT EXISTS assignment_mode TEXT",
            "UPDATE product_edge_admission_events_v1 SET assignment_mode = 'REBUILT' WHERE assignment_mode IS NULL",
            "WITH baseline AS (SELECT COALESCE(MAX(owner_sequence), 0) AS value, (ARRAY_AGG(event_identity ORDER BY owner_sequence DESC))[1] AS predecessor_event_identity FROM product_edge_admission_events_v1), ranked AS (SELECT outbox.event_identity, baseline.value + ROW_NUMBER() OVER (ORDER BY outbox.committed_at_epoch_ms, outbox.event_identity) AS value, COALESCE(LAG(outbox.event_identity) OVER (ORDER BY outbox.committed_at_epoch_ms, outbox.event_identity), baseline.predecessor_event_identity) AS predecessor_event_identity FROM product_edge_owner_outbox_v1 AS outbox CROSS JOIN baseline LEFT JOIN product_edge_admission_events_v1 AS event ON event.event_identity = outbox.event_identity WHERE outbox.event_kind = 'PRODUCT_EDGE_REQUEST_ADMITTED_V1' AND event.event_identity IS NULL) INSERT INTO product_edge_admission_events_v1 (owner_sequence, event_identity, predecessor_event_identity, assignment_mode) SELECT value, event_identity, predecessor_event_identity, 'REBUILT' FROM ranked ON CONFLICT (event_identity) DO NOTHING",
            "WITH linked AS (SELECT owner_sequence, LAG(event_identity) OVER (ORDER BY owner_sequence) AS predecessor_event_identity FROM product_edge_admission_events_v1) UPDATE product_edge_admission_events_v1 AS event SET predecessor_event_identity = linked.predecessor_event_identity FROM linked WHERE event.owner_sequence = linked.owner_sequence AND event.owner_sequence > 1 AND event.predecessor_event_identity IS NULL",
            "UPDATE product_edge_admission_event_stream_v1 SET last_owner_sequence = GREATEST(last_owner_sequence, COALESCE((SELECT MAX(owner_sequence) FROM product_edge_admission_events_v1), 0)) WHERE stream_identity = 'product-edge.admission-events.v1'",
            "CREATE OR REPLACE FUNCTION product_edge_reject_admission_assignment_mutation_v1() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN RAISE EXCEPTION 'product edge admission event assignments are immutable' USING ERRCODE = '55000'; RETURN OLD; END $function$",
            "REVOKE ALL ON FUNCTION product_edge_reject_admission_assignment_mutation_v1() FROM PUBLIC",
            "DROP TRIGGER IF EXISTS product_edge_admission_assignment_immutable_v1 ON product_edge_admission_events_v1",
            "CREATE TRIGGER product_edge_admission_assignment_immutable_v1 BEFORE UPDATE OR DELETE ON product_edge_admission_events_v1 FOR EACH ROW EXECUTE FUNCTION product_edge_reject_admission_assignment_mutation_v1()",
            "CREATE INDEX IF NOT EXISTS product_edge_outbox_aggregate_v1 ON product_edge_owner_outbox_v1(aggregate_identity, event_kind)",
        ] {
            sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .map_err(storage)?;
            observe(statement).await;
        }
        prepare_expired_manifest_recovery_schema_in_transaction(&mut transaction).await?;

        for statement in EXPIRED_MANIFEST_RECOVERY_SCHEMA_STATEMENTS {
            observe(statement).await;
        }
        transaction.commit().await.map_err(storage)?;
        Ok(())
    }

    async fn prepare_expired_manifest_recovery_schema(&self) -> Result<(), ProductEdgeError> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        prepare_expired_manifest_recovery_schema_in_transaction(&mut transaction).await?;
        transaction.commit().await.map_err(storage)?;
        Ok(())
    }

    pub async fn bootstrap_genesis(
        &self,
        proposal: ProductEdgeBootstrapProposalV1,
    ) -> Result<ProductEdgeBootstrapReadbackV1, ProductEdgeError> {
        proposal.validate()?;
        if proposal.deployment_identity != self.deployment_identity {
            return Err(ProductEdgeError::InvalidProposal("deployment mismatch"));
        }
        proposal.semantic_digest()?;
        let mut transaction = begin_read_committed(&self.pool).await?;
        let (hinted_bindings, authorization_plan) = lock_deployment_authorizations(
            &mut transaction,
            &self.deployment_identity,
            [AuthorizationRequirementV1::current(&proposal.authorization)],
        )
        .await?;
        lock_deployment(&mut transaction, &self.deployment_identity).await?;
        if let Some(existing) =
            load_binding_by_identity(&mut transaction, &proposal.binding_identity, true).await?
        {
            if !binding_matches_proposal(&existing, &proposal)? {
                return Err(ProductEdgeError::ConflictingReplay);
            }
            let readback = load_bootstrap_readback(
                &mut transaction,
                &existing,
                now_ms()?,
                &hinted_bindings,
                &authorization_plan,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return Ok(readback);
        }

        if verify_deployment_history(
            &mut transaction,
            &self.deployment_identity,
            true,
            &hinted_bindings,
            &authorization_plan,
        )
        .await?
        .is_some()
        {
            return Err(ProductEdgeError::ConflictingReplay);
        }

        let committed_at = now_ms()?;
        if committed_at < proposal.valid_from_epoch_ms
            || committed_at >= proposal.valid_through_epoch_ms
        {
            return Err(ProductEdgeError::InvalidProposal("binding validity"));
        }
        let authorization = authorization_plan.get(&AuthorizationRequirementV1::current(
            &proposal.authorization,
        ))?;

        if !authorization.is_current_at(committed_at) {
            return Err(ProductEdgeError::Unavailable);
        }
        self.verify_authorization_trust(authorization)?;
        if authorization.scope().principal != proposal.effective_principal {
            return Err(ProductEdgeError::Unavailable);
        }
        let manifest_bindings = proposal
            .manifests
            .iter()
            .map(|manifest| {
                Ok(OperationManifestBindingV1 {
                    manifest_identity: manifest.manifest_identity()?,
                    manifest_digest: manifest.manifest_digest()?,
                })
            })
            .collect::<Result<Vec<_>, ProductEdgeError>>()?;
        if authorization.operation_manifests() != manifest_bindings.as_slice() {
            return Err(ProductEdgeError::Unavailable);
        }

        if proposal.valid_from_epoch_ms < authorization.not_before_epoch_ms()
            || proposal.valid_through_epoch_ms > authorization.valid_through_epoch_ms()
        {
            return Err(ProductEdgeError::Unavailable);
        }

        let mut manifest_identities = Vec::with_capacity(proposal.manifests.len());

        for manifest in &proposal.manifests {
            require_manifest_covers_binding(
                manifest,
                proposal.valid_from_epoch_ms,
                proposal.valid_through_epoch_ms,
                committed_at,
            )?;
            let stored = store_manifest(&mut transaction, manifest, committed_at).await?;
            manifest_identities.push(stored.manifest_identity);
        }
        let mut stored = StoredBindingV1 {
            schema_version: PRODUCT_EDGE_SCHEMA_V1,
            deployment_identity: proposal.deployment_identity,
            binding_identity: proposal.binding_identity,
            generation: proposal.generation,
            predecessor_binding_identity: None,
            effective_principal: proposal.effective_principal,
            authorized_scope: authorization.scope().permissions.clone(),
            scope_policy_version: proposal.scope_policy_version,
            capability_policy_version: proposal.capability_policy_version,
            audit_policy_version: proposal.audit_policy_version,
            valid_from_epoch_ms: proposal.valid_from_epoch_ms,
            valid_through_epoch_ms: proposal.valid_through_epoch_ms,
            authorization: proposal.authorization,
            authorization_frontier_identity: authorization
                .frontier()
                .frontier_identity()
                .to_string(),
            manifest_identities,
            binding_digest: String::new(),
            committed_at_epoch_ms: committed_at,
            recovery_epoch: None,
        };
        stored.binding_digest = binding_digest(&stored)?;
        let receipt = binding_receipt(&stored);
        sqlx::query("INSERT INTO product_edge_deployment_bindings_v1 (binding_identity, deployment_identity, generation, predecessor_binding_identity, authorization_identity, issuance_receipt_identity, authorization_frontier_identity, binding_digest, binding_json, receipt_json, committed_at_epoch_ms) VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10)")
            .bind(&stored.binding_identity).bind(&stored.deployment_identity).bind(to_i64(stored.generation)?)
            .bind(&stored.authorization.authorization_identity).bind(&stored.authorization.issuance_receipt_identity)
            .bind(&stored.authorization_frontier_identity).bind(&stored.binding_digest)
            .bind(json(&stored)?).bind(json(&receipt)?).bind(to_i64(committed_at)?)
            .execute(&mut *transaction).await.map_err(storage)?;
        sqlx::query("INSERT INTO product_edge_deployment_heads_v1 (deployment_identity, binding_identity, generation, binding_digest, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5)")
            .bind(&stored.deployment_identity).bind(&stored.binding_identity).bind(to_i64(stored.generation)?)
            .bind(&stored.binding_digest).bind(to_i64(committed_at)?).execute(&mut *transaction).await.map_err(storage)?;

        for manifest in &manifest_bindings {
            sqlx::query("INSERT INTO product_edge_binding_manifests_v1 (binding_identity, manifest_identity, manifest_digest) VALUES ($1,$2,$3)")
                .bind(&stored.binding_identity).bind(&manifest.manifest_identity).bind(&manifest.manifest_digest)
                .execute(&mut *transaction).await.map_err(storage)?;
        }
        insert_outbox(
            &mut transaction,
            &receipt.receipt_identity,
            &stored.binding_identity,
            BINDING_EVENT,
            &receipt,
            committed_at,
        )
        .await?;
        let expected_bindings = vec![stored.clone()];
        let readback = load_bootstrap_readback(
            &mut transaction,
            &stored,
            committed_at,
            &expected_bindings,
            &authorization_plan,
        )
        .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(readback)
    }

    pub async fn activate_successor(
        &self,
        proposal: ProductEdgeSuccessorProposalV1,
    ) -> Result<ProductEdgeBootstrapReadbackV1, ProductEdgeError> {
        proposal.validate()?;
        let proposal_digest = proposal.semantic_digest()?;
        if proposal.deployment_identity != self.deployment_identity {
            return Err(ProductEdgeError::InvalidProposal("deployment mismatch"));
        }

        for attempt in 0..2 {
            match self
                .commit_successor_fence(&proposal, &proposal_digest, None)
                .await
            {
                Ok(Some(readback)) => return Ok(readback),
                Ok(None) => break,
                Err(ProductEdgeError::Unavailable) if attempt == 0 => {}
                Err(e) => return Err(e),
            }
        }

        // A concurrent exact activation may change absence to presence after
        // this transaction's hint. Never chase that row while PE locks are
        // held: discard the complete transaction and restart once at entry.

        for attempt in 0..2 {
            match self
                .activate_successor_phase_two(&proposal, &proposal_digest, None)
                .await
            {
                Err(ProductEdgeError::Unavailable) if attempt == 0 => {}
                result => return result,
            }
        }
        Err(ProductEdgeError::Unavailable)
    }

    pub async fn recover_expired_manifests(
        &self,
        recovery: ProductEdgeExpiredManifestRecoveryProposalV1,
    ) -> Result<ProductEdgeBootstrapReadbackV1, ProductEdgeError> {
        recovery.validate()?;
        let proposal_digest = recovery.semantic_digest()?;
        let proposal = &recovery.successor;
        if proposal.deployment_identity != self.deployment_identity {
            return Err(ProductEdgeError::InvalidProposal("deployment mismatch"));
        }

        for attempt in 0..2 {
            match self
                .commit_successor_fence(proposal, &proposal_digest, Some(&recovery.recovery_epoch))
                .await
            {
                Ok(Some(readback)) => return Ok(readback),
                Ok(None) => break,
                Err(ProductEdgeError::Unavailable) if attempt == 0 => {}
                Err(e) => return Err(e),
            }
        }

        for attempt in 0..2 {
            match self
                .activate_successor_phase_two(
                    proposal,
                    &proposal_digest,
                    Some(&recovery.recovery_epoch),
                )
                .await
            {
                Err(ProductEdgeError::Unavailable) if attempt == 0 => {}
                result => return result,
            }
        }
        Err(ProductEdgeError::Unavailable)
    }

    async fn activate_successor_phase_two(
        &self,
        proposal: &ProductEdgeSuccessorProposalV1,
        proposal_digest: &str,
        recovery_epoch: Option<&ExpiredManifestRecoveryEpochV1>,
    ) -> Result<ProductEdgeBootstrapReadbackV1, ProductEdgeError> {
        // Phase two activates only from that exact durable fence.
        let mut transaction = begin_read_committed(&self.pool).await?;
        let (hinted_bindings, authorization_plan) = lock_deployment_authorizations(
            &mut transaction,
            &self.deployment_identity,
            [AuthorizationRequirementV1::current(&proposal.authorization)],
        )
        .await?;
        lock_deployment(&mut transaction, &self.deployment_identity).await?;
        if let Some(existing) =
            load_binding_by_identity(&mut transaction, &proposal.binding_identity, true).await?
        {
            if !binding_matches_successor(&existing, proposal)? {
                return Err(ProductEdgeError::ConflictingReplay);
            }
            require_exact_recovery_sidecar(
                &mut transaction,
                &existing,
                recovery_epoch,
                proposal_digest,
            )
            .await?;
            let readback = load_bootstrap_readback(
                &mut transaction,
                &existing,
                now_ms()?,
                &hinted_bindings,
                &authorization_plan,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return Ok(readback);
        }
        let history = verify_deployment_history(
            &mut transaction,
            &self.deployment_identity,
            true,
            &hinted_bindings,
            &authorization_plan,
        )
        .await?
        .ok_or(ProductEdgeError::Unavailable)?;
        let current = history.head()?.clone();
        require_successor_head(&current, proposal)?;
        let fence = history
            .pending_supersession
            .ok_or(ProductEdgeError::Unavailable)?;

        if fence.binding_identity != current.binding_identity
            || fence.successor_binding_identity != proposal.binding_identity
            || fence.successor_proposal_digest != proposal_digest
        {
            return Err(ProductEdgeError::ConflictingReplay);
        }
        let committed_at = now_ms()?;
        let authorization = self
            .verify_successor_policy(
                &mut transaction,
                &current,
                proposal,
                committed_at,
                &authorization_plan,
                recovery_epoch,
            )
            .await?;
        let manifest_identities = if recovery_epoch.is_some() {
            let mut identities = Vec::with_capacity(proposal.manifests.len());

            for manifest in &proposal.manifests {
                identities.push(
                    store_manifest(&mut transaction, manifest, committed_at)
                        .await?
                        .manifest_identity,
                );
            }
            identities
        } else {
            proposal
                .manifests
                .iter()
                .map(AgentOperationManifestProposalV1::manifest_identity)
                .collect::<Result<Vec<_>, _>>()?
        };
        let mut successor = StoredBindingV1 {
            schema_version: PRODUCT_EDGE_SCHEMA_V1,
            deployment_identity: proposal.deployment_identity.clone(),
            binding_identity: proposal.binding_identity.clone(),
            generation: proposal.generation,
            predecessor_binding_identity: Some(proposal.predecessor_binding_identity.clone()),
            effective_principal: proposal.effective_principal.clone(),
            authorized_scope: authorization.scope().permissions.clone(),
            scope_policy_version: proposal.scope_policy_version.clone(),
            capability_policy_version: proposal.capability_policy_version.clone(),
            audit_policy_version: proposal.audit_policy_version.clone(),
            valid_from_epoch_ms: proposal.valid_from_epoch_ms,
            valid_through_epoch_ms: proposal.valid_through_epoch_ms,
            authorization: proposal.authorization.clone(),
            authorization_frontier_identity: authorization
                .frontier()
                .frontier_identity()
                .to_string(),
            manifest_identities,
            binding_digest: String::new(),
            committed_at_epoch_ms: committed_at,
            recovery_epoch: recovery_epoch.cloned(),
        };
        successor.binding_digest = binding_digest(&successor)?;
        let receipt = binding_receipt(&successor);
        sqlx::query("INSERT INTO product_edge_deployment_bindings_v1 (binding_identity, deployment_identity, generation, predecessor_binding_identity, authorization_identity, issuance_receipt_identity, authorization_frontier_identity, binding_digest, binding_json, receipt_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
            .bind(&successor.binding_identity).bind(&successor.deployment_identity)
            .bind(to_i64(successor.generation)?).bind(&successor.predecessor_binding_identity)
            .bind(&successor.authorization.authorization_identity).bind(&successor.authorization.issuance_receipt_identity)
            .bind(&successor.authorization_frontier_identity).bind(&successor.binding_digest)
            .bind(json(&successor)?).bind(json(&receipt)?)
            .bind(to_i64(committed_at)?).execute(&mut *transaction).await.map_err(storage)?;
        for manifest in &successor.manifest_identities {
            let stored_manifest = load_manifest_by_identity(&mut transaction, manifest, false)
                .await?
                .ok_or(ProductEdgeError::Unavailable)?;
            sqlx::query("INSERT INTO product_edge_binding_manifests_v1 (binding_identity, manifest_identity, manifest_digest) VALUES ($1,$2,$3)")
                .bind(&successor.binding_identity).bind(&stored_manifest.manifest_identity).bind(&stored_manifest.manifest_digest)
                .execute(&mut *transaction).await.map_err(storage)?;
        }

        if let Some(epoch) = recovery_epoch {
            let recovery = StoredExpiredManifestRecoveryV1 {
                schema_version: PRODUCT_EDGE_SCHEMA_V1,
                proposal: ProductEdgeExpiredManifestRecoveryProposalV1 {
                    recovery_epoch: epoch.clone(),
                    successor: proposal.clone(),
                },
                proposal_digest: proposal_digest.to_string(),
                committed_at_epoch_ms: committed_at,
            };
            sqlx::query("INSERT INTO product_edge_expired_manifest_recoveries_v1 (recovery_epoch_identity, recovery_epoch_digest, predecessor_binding_identity, successor_binding_identity, recovery_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
                .bind(&epoch.recovery_epoch_identity)
                .bind(&epoch.recovery_epoch_digest)
                .bind(&proposal.predecessor_binding_identity)
                .bind(&proposal.binding_identity)
                .bind(json(&recovery)?)
                .bind(to_i64(committed_at)?)
                .execute(&mut *transaction)
                .await
                .map_err(storage)?;
        }
        insert_outbox(
            &mut transaction,
            &receipt.receipt_identity,
            &successor.binding_identity,
            BINDING_EVENT,
            &receipt,
            committed_at,
        )
        .await?;
        let updated = sqlx::query("UPDATE product_edge_deployment_heads_v1 SET binding_identity=$1, generation=$2, binding_digest=$3, committed_at_epoch_ms=$4 WHERE deployment_identity=$5 AND binding_identity=$6 AND generation=$7")
            .bind(&successor.binding_identity).bind(to_i64(successor.generation)?)
            .bind(&successor.binding_digest).bind(to_i64(committed_at)?)
            .bind(&self.deployment_identity).bind(&current.binding_identity)
            .bind(to_i64(current.generation)?).execute(&mut *transaction).await.map_err(storage)?;

        if updated.rows_affected() != 1 {
            return Err(ProductEdgeError::Unavailable);
        }
        let mut expected_bindings = hinted_bindings.clone();
        expected_bindings.push(successor.clone());
        let verified = verify_deployment_history(
            &mut transaction,
            &self.deployment_identity,
            true,
            &expected_bindings,
            &authorization_plan,
        )
        .await?
        .ok_or(ProductEdgeError::Unavailable)?;
        if verified.pending_supersession.is_some() || verified.current()? != &successor {
            return Err(ProductEdgeError::Unavailable);
        }
        let readback = load_bootstrap_readback(
            &mut transaction,
            &successor,
            committed_at,
            &expected_bindings,
            &authorization_plan,
        )
        .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(readback)
    }

    // This is the only phase-one cutover path. It commits an independently
    // durable zero-ACTIVE fence; phase two may then activate only the exact
    // proposal digest sealed here.
    async fn commit_successor_fence(
        &self,
        proposal: &ProductEdgeSuccessorProposalV1,
        proposal_digest: &str,
        recovery_epoch: Option<&ExpiredManifestRecoveryEpochV1>,
    ) -> Result<Option<ProductEdgeBootstrapReadbackV1>, ProductEdgeError> {
        let mut transaction = begin_read_committed(&self.pool).await?;
        let (hinted_bindings, authorization_plan) = lock_deployment_authorizations(
            &mut transaction,
            &self.deployment_identity,
            [AuthorizationRequirementV1::current(&proposal.authorization)],
        )
        .await?;
        lock_deployment(&mut transaction, &self.deployment_identity).await?;
        if let Some(existing) =
            load_binding_by_identity(&mut transaction, &proposal.binding_identity, true).await?
        {
            if !binding_matches_successor(&existing, proposal)? {
                return Err(ProductEdgeError::ConflictingReplay);
            }
            require_exact_recovery_sidecar(
                &mut transaction,
                &existing,
                recovery_epoch,
                proposal_digest,
            )
            .await?;
            let readback = load_bootstrap_readback(
                &mut transaction,
                &existing,
                now_ms()?,
                &hinted_bindings,
                &authorization_plan,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return Ok(Some(readback));
        }
        let history = verify_deployment_history(
            &mut transaction,
            &self.deployment_identity,
            true,
            &hinted_bindings,
            &authorization_plan,
        )
        .await?
        .ok_or(ProductEdgeError::Unavailable)?;
        let current = history.head()?.clone();
        require_successor_head(&current, proposal)?;
        if let Some(existing_fence) = history.pending_supersession {
            if existing_fence.binding_identity != current.binding_identity
                || existing_fence.successor_binding_identity != proposal.binding_identity
                || existing_fence.successor_proposal_digest != proposal_digest
            {
                return Err(ProductEdgeError::ConflictingReplay);
            }
        } else {
            let fence_cut = now_ms()?;
            self.verify_successor_policy(
                &mut transaction,
                &current,
                proposal,
                fence_cut,
                &authorization_plan,
                recovery_epoch,
            )
            .await?;

            let mut fence = StoredSupersessionV1 {
                schema_version: PRODUCT_EDGE_SCHEMA_V1,
                binding_identity: current.binding_identity.clone(),
                successor_binding_identity: proposal.binding_identity.clone(),
                successor_proposal_digest: proposal_digest.to_string(),
                supersession_digest: String::new(),
                committed_at_epoch_ms: fence_cut,
            };
            fence.supersession_digest = supersession_digest(&fence)?;
            sqlx::query("INSERT INTO product_edge_deployment_supersessions_v1 (binding_identity, successor_binding_identity, supersession_digest, supersession_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5)")
                .bind(&fence.binding_identity).bind(&fence.successor_binding_identity)
                .bind(&fence.supersession_digest).bind(json(&fence)?)
                .bind(to_i64(fence_cut)?).execute(&mut *transaction).await.map_err(storage)?;
            insert_outbox(
                &mut transaction,
                &fence.supersession_digest,
                &current.binding_identity,
                SUPERSESSION_EVENT,
                &fence,
                fence_cut,
            )
            .await?;
            let fenced = verify_deployment_history(
                &mut transaction,
                &self.deployment_identity,
                true,
                &hinted_bindings,
                &authorization_plan,
            )
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;
            if fenced.pending_supersession.as_ref() != Some(&fence) {
                return Err(ProductEdgeError::Unavailable);
            }
        }
        transaction.commit().await.map_err(storage)?;
        Ok(None)
    }

    pub async fn admit_request(
        &self,
        request: ProductEdgeAdmissionRequestV1,
    ) -> Result<ProductEdgeAdmissionReadbackV1, ProductEdgeError> {
        if request.operation == ARTIFACT_BUILD_OPERATION_V1
            || request.operation == SOURCE_INTAKE_OPERATION_V1
        {
            return Err(ProductEdgeError::Unavailable);
        }
        Box::pin(self.admit_request_inner(request, None)).await
    }

    pub async fn admit_artifact_build_request(
        &self,
        request: ProductEdgeAdmissionRequestV1,
    ) -> Result<ProductEdgeAdmissionReadbackV1, ProductEdgeError> {
        if request.operation != ARTIFACT_BUILD_OPERATION_V1
            || request.operation_schema != ARTIFACT_BUILD_SCHEMA_V1
            || !has_exact_artifact_build_effects(&request.requested_effects)
        {
            return Err(ProductEdgeError::Unavailable);
        }
        let payload: ArtifactBuildAdmissionPayloadV1 =
            serde_json::from_value(request.typed_payload.clone())
                .map_err(|_| ProductEdgeError::Unavailable)?;

        if payload.build_request_identity != request.request_identity
            || payload.build_request_identity.trim().is_empty()
            || payload.attempt_identity.trim().is_empty()
            || payload.intent_identity.trim().is_empty()
            || payload.channel != "WINDMILL_PRODUCT_EDGE"
        {
            return Err(ProductEdgeError::Unavailable);
        }
        Box::pin(self.admit_request_inner(request, Some(payload.intent_identity))).await
    }

    pub async fn admit_source_intake_request(
        &self,
        request: ProductEdgeAdmissionRequestV1,
    ) -> Result<ProductEdgeAdmissionReadbackV1, ProductEdgeError> {
        if request.operation != SOURCE_INTAKE_OPERATION_V1
            || request.operation_schema != SOURCE_INTAKE_OPERATION_SCHEMA_V1
            || request.target_owner != SOURCE_INTAKE_TARGET_OWNER_V1
            || !has_exact_source_intake_effects(&request.requested_effects)
        {
            return Err(ProductEdgeError::Unavailable);
        }
        let payload: SourceIntakeAdmissionPayloadV1 =
            serde_json::from_value(request.typed_payload.clone())
                .map_err(|_| ProductEdgeError::Unavailable)?;

        if payload.request_identity != request.request_identity
            || payload.gateway != "WINDMILL_PRODUCT_EDGE"
            || !valid_source_doi(&payload.normalized_doi)
            || !valid_source_interpretation(&payload.interpretation)
        {
            return Err(ProductEdgeError::Unavailable);
        }
        Box::pin(self.admit_request_inner(request, None)).await
    }

    async fn admit_request_inner(
        &self,
        request: ProductEdgeAdmissionRequestV1,
        artifact_intent_identity: Option<String>,
    ) -> Result<ProductEdgeAdmissionReadbackV1, ProductEdgeError> {
        request.validate()?;
        let request_semantic_digest = request.semantic_digest()?;
        let mut transaction = begin_read_committed(&self.pool).await?;
        let hinted_admission = hint_admission(&mut transaction, &request.request_identity).await?;
        let hinted_bindings =
            hint_deployment_bindings(&mut transaction, &self.deployment_identity).await?;
        let current_research = if hinted_admission.is_none() {
            match artifact_intent_identity.as_deref() {
                Some(intent_identity) => Some(
                    peek_current_research_for_artifact(&mut transaction, intent_identity).await?,
                ),
                None => None,
            }
        } else {
            None
        };
        let mut requirements = historical_requirements(&hinted_bindings);
        if let Some(existing) = &hinted_admission {
            requirements.push(AuthorizationRequirementV1::historical(
                &existing.authorization,
                &existing.authorization_frontier_identity,
            ));
        } else {
            let current = hinted_bindings
                .last()
                .ok_or(ProductEdgeError::Unavailable)?;
            requirements.push(AuthorizationRequirementV1::current(&current.authorization));

            if let Some(current_research) = &current_research {
                let source_hint = hint_admission(
                    &mut transaction,
                    &current_research.evidence.source_admission.request_identity,
                )
                .await?
                .ok_or(ProductEdgeError::Unavailable)?;

                if source_hint.admission_identity
                    != current_research
                        .evidence
                        .source_admission
                        .admission_identity
                    || source_hint.admission_digest
                        != current_research.evidence.source_admission.admission_digest
                {
                    return Err(ProductEdgeError::Unavailable);
                }
                requirements.push(AuthorizationRequirementV1::current(
                    &source_hint.authorization,
                ));
            }
        }
        let authorization_plan = lock_authorization_plan(&mut transaction, requirements).await?;
        lock_deployment(&mut transaction, &self.deployment_identity).await?;
        let mut request_locks = vec![request.request_identity.as_str()];
        if let Some(current_research) = &current_research {
            request_locks.push(&current_research.evidence.source_admission.request_identity);
        }
        request_locks.sort_unstable();
        request_locks.dedup();
        for request_identity in request_locks {
            lock_request(&mut transaction, request_identity).await?;
        }

        if let Some(existing) =
            load_admission_row(&mut transaction, &request.request_identity, true).await?
        {
            if hinted_admission.as_ref() != Some(&existing) {
                return Err(ProductEdgeError::Unavailable);
            }

            if existing.request_semantic_digest != request_semantic_digest
                || existing.request != request
            {
                return Err(ProductEdgeError::ConflictingReplay);
            }
            let result = verify_admission(
                &mut transaction,
                existing,
                DownstreamAdmissionModeV1::Historical,
                &hinted_bindings,
                &authorization_plan,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return Ok(result);
        }

        if hinted_admission.is_some() {
            return Err(ProductEdgeError::Unavailable);
        }
        let read_cut = now_ms()?;
        let binding = load_current_binding(
            &mut transaction,
            &self.deployment_identity,
            read_cut,
            &hinted_bindings,
            &authorization_plan,
        )
        .await?;
        let manifest = load_manifest_for_operation(&mut transaction, &binding, &request).await?;
        if read_cut < manifest.proposal.effective_from_epoch_ms
            || read_cut >= manifest.proposal.valid_through_epoch_ms
            || !binding
                .manifest_identities
                .contains(&manifest.manifest_identity)
            || request
                .requested_effects
                .iter()
                .any(|effect| !manifest.proposal.allowed_effects.contains(effect))
            || request
                .requested_effects
                .iter()
                .any(|effect| manifest.proposal.prohibited_effects.contains(effect))
        {
            return Err(ProductEdgeError::Unavailable);
        }
        let authorization =
            authorization_plan.get(&AuthorizationRequirementV1::current(&binding.authorization))?;
        if !authorization.is_current_at(read_cut) {
            return Err(ProductEdgeError::Unavailable);
        }
        self.verify_authorization_trust(authorization)?;
        if authorization.scope().principal != binding.effective_principal
            || authorization.scope().permissions != binding.authorized_scope
            || authorization.request_proof_digest() != request.request_proof_digest
            || !authorization.operation_manifests().iter().any(|entry| {
                entry.manifest_identity == manifest.manifest_identity
                    && entry.manifest_digest == manifest.manifest_digest
            })
        {
            return Err(ProductEdgeError::Unavailable);
        }
        let locked_research = if let (Some(intent_identity), Some(peeked)) = (
            artifact_intent_identity.as_deref(),
            current_research.as_ref(),
        ) {
            let source = load_admission_row(
                &mut transaction,
                &peeked.evidence.source_admission.request_identity,
                false,
            )
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;

            if source.admission_identity != peeked.evidence.source_admission.admission_identity
                || source.admission_digest != peeked.evidence.source_admission.admission_digest
            {
                return Err(ProductEdgeError::Unavailable);
            }
            Some((
                lock_current_research_for_artifact(&mut transaction, intent_identity, peeked)
                    .await?,
                source,
            ))
        } else {
            None
        };
        // Every canonical lock is now held. Sample one cut immediately before
        // the first write and revalidate every half-open authority window at
        // that exact cut; the same cut is bound into identity and receipt.
        let final_cut = now_ms()?;
        if !authority_windows_are_current_at(
            final_cut,
            binding.valid_from_epoch_ms,
            binding.valid_through_epoch_ms,
            manifest.proposal.effective_from_epoch_ms,
            manifest.proposal.valid_through_epoch_ms,
            authorization.is_current_at(final_cut),
        ) {
            return Err(ProductEdgeError::Unavailable);
        }

        if let Some((locked, source)) = &locked_research {
            let evidence = &locked.evidence;
            let source_authorization = authorization_plan
                .get(&AuthorizationRequirementV1::current(&source.authorization))?;
            let same_or_immediate = binding.generation == source.binding_generation
                && binding.binding_identity == source.binding_identity
                || binding.generation == source.binding_generation.saturating_add(1)
                    && binding.predecessor_binding_identity.as_deref()
                        == Some(source.binding_identity.as_str());

            if locked.owner_cut_epoch_ms > final_cut
                || evidence.projection_at_epoch_ms > final_cut
                || final_cut >= evidence.valid_through_epoch_ms
                || !source_authorization.is_current_at(final_cut)
                || !same_or_immediate
                || evidence.effective_principal != source.effective_principal
                || evidence.authorized_scope != source.authorized_scope
                || source.effective_principal != binding.effective_principal
                || source.authorized_scope != binding.authorized_scope
                || source_authorization.scope() != authorization.scope()
                || source_authorization.request_proof_digest()
                    != authorization.request_proof_digest()
                || source_authorization.operation_manifests() != authorization.operation_manifests()
            {
                return Err(ProductEdgeError::Unavailable);
            }
        }
        let admission_identity = identity(
            "product-edge-request-admission-v1",
            &[
                &request.request_identity,
                &request_semantic_digest,
                &binding.binding_identity,
                authorization.frontier().frontier_identity(),
                &manifest.manifest_identity,
                &final_cut.to_string(),
            ],
        );
        let committed_at = final_cut;
        let mut stored = StoredAdmissionV1 {
            schema_version: PRODUCT_EDGE_SCHEMA_V1,
            admission_identity,
            admission_digest: String::new(),
            request_semantic_digest,
            request,
            deployment_identity: binding.deployment_identity.clone(),
            binding_identity: binding.binding_identity.clone(),
            binding_generation: binding.generation,
            history_head_identity: binding.binding_identity.clone(),
            effective_principal: binding.effective_principal.clone(),
            authorized_scope: binding.authorized_scope.clone(),
            scope_policy_version: binding.scope_policy_version.clone(),
            capability_policy_version: binding.capability_policy_version.clone(),
            audit_policy_version: binding.audit_policy_version.clone(),
            authorization: binding.authorization.clone(),
            authorization_frontier_identity: authorization
                .frontier()
                .frontier_identity()
                .to_string(),
            manifest_identity: manifest.manifest_identity.clone(),
            manifest_digest: manifest.manifest_digest.clone(),
            read_cut_epoch_ms: final_cut,
            committed_at_epoch_ms: committed_at,
            current_research_custody: locked_research.map(|(locked, _)| {
                StoredCurrentResearchCustodyV1 {
                    evidence_digest: locked.evidence_digest,
                    evidence: locked.evidence,
                }
            }),
        };
        stored.admission_digest = admission_digest(&stored)?;
        let receipt = admission_receipt(&stored);
        sqlx::query("INSERT INTO product_edge_request_admissions_v1 (request_identity, admission_identity, deployment_identity, binding_identity, authorization_identity, issuance_receipt_identity, authorization_frontier_identity, request_semantic_digest, admission_digest, admission_json, receipt_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
            .bind(&stored.request.request_identity).bind(&stored.admission_identity)
            .bind(&stored.deployment_identity).bind(&stored.binding_identity)
            .bind(&stored.authorization.authorization_identity).bind(&stored.authorization.issuance_receipt_identity)
            .bind(&stored.authorization_frontier_identity).bind(&stored.request_semantic_digest)
            .bind(&stored.admission_digest).bind(json(&stored)?).bind(json(&receipt)?).bind(to_i64(committed_at)?)
            .execute(&mut *transaction).await.map_err(storage)?;
        insert_admission_outbox(
            &mut transaction,
            &receipt.receipt_identity,
            &stored.admission_identity,
            &receipt,
            committed_at,
        )
        .await?;
        let result = verify_admission(
            &mut transaction,
            stored,
            DownstreamAdmissionModeV1::Historical,
            &hinted_bindings,
            &authorization_plan,
        )
        .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(result)
    }

    pub async fn resolve_admission(
        &self,
        request_identity: &str,
        request_proof_digest: &str,
    ) -> Result<Option<ProductEdgeAdmissionReadbackV1>, ProductEdgeError> {
        let mut transaction = begin_read_committed(&self.pool).await?;
        let Some(hinted) = hint_admission(&mut transaction, request_identity).await? else {
            transaction.rollback().await.map_err(storage)?;
            return Ok(None);
        };
        let locator = ProductEdgeAdmissionLocatorV1 {
            request_identity: request_identity.to_string(),
            admission_identity: hinted.admission_identity,
            admission_digest: hinted.admission_digest,
        };
        let result = resolve_admission_for_downstream_in_transaction(
            &mut transaction,
            &locator,
            DownstreamAdmissionModeV1::Historical,
        )
        .await?;

        if result.request().request_proof_digest != request_proof_digest {
            return Err(ProductEdgeError::Unavailable);
        }
        transaction.commit().await.map_err(storage)?;
        Ok(Some(result))
    }

    pub async fn follow_admission_events_after(
        &self,
        cursor: &ProductEdgeAdmissionEventCursorV1,
        page_size: u32,
    ) -> Result<Vec<ProductEdgeAdmissionEventLocatorV1>, ProductEdgeError> {
        follow_admission_events_after(&self.pool, cursor, page_size).await
    }

    pub async fn resolve_admission_observation(
        &self,
        locator: &ProductEdgeAdmissionEventLocatorV1,
    ) -> Result<ProductEdgeAdmissionObservationV1, ProductEdgeError> {
        resolve_admission_observation(&self.pool, locator).await
    }

    pub async fn claim_provider_invocation(
        &self,
        request: ProductEdgeInvocationClaimRequestV1,
    ) -> Result<ProductEdgeInvocationClaimReadbackV1, ProductEdgeError> {
        Box::pin(self.claim_provider_invocation_inner(request)).await
    }

    async fn claim_provider_invocation_inner(
        &self,
        request: ProductEdgeInvocationClaimRequestV1,
    ) -> Result<ProductEdgeInvocationClaimReadbackV1, ProductEdgeError> {
        if request.attempt_identity.trim().is_empty() {
            return Err(ProductEdgeError::InvalidProposal("invocation attempt"));
        }
        let mut transaction = begin_read_committed(&self.pool).await?;
        let existing_hint: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM product_edge_effect_invocation_claims_v1 WHERE admission_identity=$1)")
            .bind(&request.admission.admission_identity)
            .fetch_one(&mut *transaction)
            .await
            .map_err(storage)?;

        if existing_hint {
            let existing =
                load_invocation_claim(&mut transaction, &request.admission.admission_identity)
                    .await?
                    .ok_or(ProductEdgeError::Unavailable)?;
            if existing.attempt_identity != request.attempt_identity {
                return Err(ProductEdgeError::ConflictingReplay);
            }
            load_invocation_admission_for_locator(
                &mut transaction,
                &request.admission,
                &existing,
                ARTIFACT_PROVIDER_EFFECT_V1,
            )
            .await?;
            load_invocation_state(&mut transaction, &existing.claim_identity)
                .await?
                .ok_or(ProductEdgeError::Unavailable)?;
            let readback = resolve_invocation_claim_readback(
                &mut transaction,
                &request.admission.admission_identity,
                ProductEdgeInvocationClaimDispositionV1::AlreadyClaimed,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return Ok(readback);
        }
        let hinted_admission =
            hint_admission(&mut transaction, &request.admission.request_identity)
                .await?
                .ok_or(ProductEdgeError::Unavailable)?;

        if hinted_admission.admission_identity != request.admission.admission_identity
            || hinted_admission.admission_digest != request.admission.admission_digest
            || hinted_admission.request.operation != ARTIFACT_BUILD_OPERATION_V1
        {
            return Err(ProductEdgeError::Unavailable);
        }
        let research_custody = hinted_admission
            .current_research_custody
            .clone()
            .ok_or(ProductEdgeError::Unavailable)?;
        let research_evidence = research_custody.evidence;
        let source_hint = hint_admission(
            &mut transaction,
            &research_evidence.source_admission.request_identity,
        )
        .await?
        .ok_or(ProductEdgeError::Unavailable)?;

        if source_hint.admission_identity != research_evidence.source_admission.admission_identity
            || source_hint.admission_digest != research_evidence.source_admission.admission_digest
        {
            return Err(ProductEdgeError::Unavailable);
        }
        let hinted_bindings =
            hint_deployment_bindings(&mut transaction, &self.deployment_identity).await?;
        let current_binding = hinted_bindings
            .last()
            .ok_or(ProductEdgeError::Unavailable)?;
        let prelock_plan = lock_authorization_plan(
            &mut transaction,
            vec![
                AuthorizationRequirementV1::historical(
                    &hinted_admission.authorization,
                    &hinted_admission.authorization_frontier_identity,
                ),
                AuthorizationRequirementV1::current(&current_binding.authorization),
                AuthorizationRequirementV1::current(&source_hint.authorization),
            ],
        )
        .await?;
        lock_deployment(&mut transaction, &self.deployment_identity).await?;
        let mut request_locks = [
            request.admission.request_identity.as_str(),
            research_evidence.source_admission.request_identity.as_str(),
        ];
        request_locks.sort_unstable();
        for request_identity in request_locks {
            lock_request(&mut transaction, request_identity).await?;
        }
        let mut source = None;

        for request_identity in request_locks {
            let locked = load_admission_row(&mut transaction, request_identity, false)
                .await?
                .ok_or(ProductEdgeError::Unavailable)?;

            if request_identity == research_evidence.source_admission.request_identity {
                source = Some(locked);
            } else if locked.admission_identity != request.admission.admission_identity
                || locked.admission_digest != request.admission.admission_digest
            {
                return Err(ProductEdgeError::Unavailable);
            }
        }
        let source = source.ok_or(ProductEdgeError::Unavailable)?;
        let read_cut = now_ms()?;
        let admission = resolve_admission_for_downstream_in_transaction(
            &mut transaction,
            &request.admission,
            DownstreamAdmissionModeV1::FirstMutation {
                read_cut_epoch_ms: read_cut,
            },
        )
        .await?;

        if load_invocation_claim(&mut transaction, &request.admission.admission_identity)
            .await?
            .is_some()
        {
            return Err(ProductEdgeError::Unavailable);
        }
        // All OA and Product Edge locks/rereads precede this final R&D Owner
        // lock. No OA/PE acquisition is permitted between this call and the
        // first invocation-admission write.
        let locked_research = lock_current_research_for_artifact(
            &mut transaction,
            &research_evidence.intent_identity,
            &PeekCurrentResearchEnvelopeV1 {
                evidence_digest: research_custody.evidence_digest,
                evidence: research_evidence.clone(),
            },
        )
        .await?;

        if !has_exact_artifact_build_effects(&admission.request().requested_effects) {
            return Err(ProductEdgeError::Unavailable);
        }
        let write_cut = now_ms()?;
        if !admission.authorizes_first_mutation_at(write_cut) {
            return Err(ProductEdgeError::Unavailable);
        }
        let current_policy = admission
            .current_policy_evidence
            .as_ref()
            .ok_or(ProductEdgeError::Unavailable)?;
        let source_authorization =
            prelock_plan.get(&AuthorizationRequirementV1::current(&source.authorization))?;
        let same_or_immediate = current_policy.binding_generation == source.binding_generation
            && current_policy.binding_identity == source.binding_identity
            || current_policy.binding_generation == source.binding_generation.saturating_add(1)
                && current_binding.predecessor_binding_identity.as_deref()
                    == Some(source.binding_identity.as_str());

        if locked_research.owner_cut_epoch_ms > write_cut
            || locked_research.evidence.projection_at_epoch_ms > write_cut
            || write_cut >= locked_research.evidence.valid_through_epoch_ms
            || !source_authorization.is_current_at(write_cut)
            || !same_or_immediate
            || locked_research.evidence.effective_principal != source.effective_principal
            || locked_research.evidence.authorized_scope != source.authorized_scope
            || source.effective_principal != admission.effective_principal()
            || source.authorized_scope != admission.authorized_scope()
            || source_authorization.scope() != current_policy.authorization.scope()
            || source_authorization.request_proof_digest()
                != current_policy.authorization.request_proof_digest()
            || source_authorization.operation_manifests()
                != current_policy.authorization.operation_manifests()
        {
            return Err(ProductEdgeError::Unavailable);
        }
        let invocation_admission_receipt_identity = identity(
            "product-edge-provider-invocation-admission-receipt-v1",
            &[
                &request.admission.admission_identity,
                &request.attempt_identity,
                &current_policy.binding_identity,
                current_policy.authorization.frontier().frontier_identity(),
                &write_cut.to_string(),
            ],
        );
        let claim_identity = identity(
            "product-edge-provider-invocation-claim-v1",
            &[
                &request.admission.admission_identity,
                &request.attempt_identity,
                &invocation_admission_receipt_identity,
            ],
        );
        let historical_authorization = admission.authorization().locator();
        let current_authorization = current_policy.authorization.locator();
        let mut invocation_admission = StoredInvocationAdmissionReceiptV1 {
            schema_version: PRODUCT_EDGE_SCHEMA_V1,
            receipt_identity: invocation_admission_receipt_identity,
            receipt_digest: String::new(),
            request_identity: admission.request().request_identity.clone(),
            admission_identity: request.admission.admission_identity.clone(),
            admission_digest: request.admission.admission_digest.clone(),
            historical_binding_identity: admission.binding_identity().to_string(),
            historical_binding_generation: admission.binding_generation(),
            historical_authorization_identity: historical_authorization.authorization_identity,
            historical_issuance_receipt_identity: historical_authorization
                .issuance_receipt_identity,
            historical_authorization_frontier_identity: admission
                .authorization()
                .frontier()
                .frontier_identity()
                .to_string(),
            current_binding_identity: current_policy.binding_identity.clone(),
            current_binding_generation: current_policy.binding_generation,
            current_authorization_identity: current_authorization.authorization_identity,
            current_issuance_receipt_identity: current_authorization.issuance_receipt_identity,
            current_authorization_frontier_identity: current_policy
                .authorization
                .frontier()
                .frontier_identity()
                .to_string(),
            current_authorization_not_before_epoch_ms: current_policy
                .authorization
                .not_before_epoch_ms(),
            current_authorization_valid_through_epoch_ms: current_policy
                .authorization
                .valid_through_epoch_ms(),
            current_binding_valid_from_epoch_ms: current_policy.binding_valid_from_epoch_ms,
            current_binding_valid_through_epoch_ms: current_policy.binding_valid_through_epoch_ms,
            effective_principal: admission.effective_principal().to_string(),
            authorized_scope: admission.authorized_scope().to_vec(),
            scope_policy_version: admission.scope_policy_version().to_string(),
            capability_policy_version: admission.capability_policy_version().to_string(),
            audit_policy_version: admission.audit_policy_version().to_string(),
            manifest_identity: admission.manifest_identity().to_string(),
            manifest_digest: admission.manifest_digest().to_string(),
            manifest_effective_from_epoch_ms: current_policy.manifest_effective_from_epoch_ms,
            manifest_valid_through_epoch_ms: current_policy.manifest_valid_through_epoch_ms,
            attempt_identity: request.attempt_identity.clone(),
            effect: ARTIFACT_PROVIDER_EFFECT_V1.to_string(),
            claim_identity: claim_identity.clone(),
            write_cut_epoch_ms: write_cut,
        };
        invocation_admission.receipt_digest =
            invocation_admission_receipt_digest(&invocation_admission)?;
        sqlx::query("INSERT INTO product_edge_effect_invocation_admissions_v1 (receipt_identity, receipt_digest, admission_identity, attempt_identity, claim_identity, receipt_json, write_cut_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)")
            .bind(&invocation_admission.receipt_identity)
            .bind(&invocation_admission.receipt_digest)
            .bind(&invocation_admission.admission_identity)
            .bind(&invocation_admission.attempt_identity)
            .bind(&invocation_admission.claim_identity)
            .bind(json(&invocation_admission)?)
            .bind(to_i64(write_cut)?)
            .execute(&mut *transaction).await.map_err(storage)?;
        insert_outbox(
            &mut transaction,
            &invocation_admission.receipt_identity,
            &invocation_admission.admission_identity,
            INVOCATION_ADMISSION_EVENT,
            &invocation_admission,
            write_cut,
        )
        .await?;
        let mut stored = StoredInvocationClaimV1 {
            schema_version: PRODUCT_EDGE_SCHEMA_V1,
            claim_identity,
            admission_identity: request.admission.admission_identity,
            attempt_identity: request.attempt_identity,
            invocation_admission_receipt_identity: invocation_admission.receipt_identity,
            invocation_admission_receipt_digest: invocation_admission.receipt_digest,
            claim_digest: String::new(),
            committed_at_epoch_ms: write_cut,
        };
        stored.claim_digest = invocation_claim_digest(&stored)?;
        sqlx::query("INSERT INTO product_edge_effect_invocation_claims_v1 (admission_identity, claim_identity, attempt_identity, claim_digest, claim_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(&stored.admission_identity).bind(&stored.claim_identity)
            .bind(&stored.attempt_identity).bind(&stored.claim_digest)
            .bind(json(&stored)?).bind(to_i64(write_cut)?)
            .execute(&mut *transaction).await.map_err(storage)?;
        insert_outbox(
            &mut transaction,
            &stored.claim_identity,
            &stored.admission_identity,
            INVOCATION_CLAIM_EVENT,
            &stored,
            write_cut,
        )
        .await?;
        let mut state = StoredInvocationStateV1 {
            schema_version: PRODUCT_EDGE_SCHEMA_V1,
            claim_identity: stored.claim_identity.clone(),
            admission_identity: stored.admission_identity.clone(),
            attempt_identity: stored.attempt_identity.clone(),
            claim_digest: stored.claim_digest.clone(),
            state: StoredInvocationStateKindV1::Claimed,
            state_digest: String::new(),
            updated_at_epoch_ms: write_cut,
        };
        state.state_digest = invocation_state_digest(&state)?;
        sqlx::query("INSERT INTO product_edge_effect_invocation_states_v1 (claim_identity, admission_identity, attempt_identity, claim_digest, state_digest, state_json, updated_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)")
            .bind(&state.claim_identity).bind(&state.admission_identity)
            .bind(&state.attempt_identity).bind(&state.claim_digest)
            .bind(&state.state_digest).bind(json(&state)?).bind(to_i64(write_cut)?)
            .execute(&mut *transaction).await.map_err(storage)?;
        insert_outbox(
            &mut transaction,
            &state.state_digest,
            &state.claim_identity,
            INVOCATION_CLAIM_STATE_EVENT,
            &state,
            write_cut,
        )
        .await?;
        let verified = load_invocation_claim(&mut transaction, &stored.admission_identity)
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;
        verify_invocation_admission_lineage(
            &mut transaction,
            &admission,
            &verified,
            ARTIFACT_PROVIDER_EFFECT_V1,
        )
        .await?;
        load_invocation_state(&mut transaction, &verified.claim_identity)
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;
        let readback = resolve_invocation_claim_readback(
            &mut transaction,
            &verified.admission_identity,
            ProductEdgeInvocationClaimDispositionV1::ClaimedNew,
        )
        .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(readback)
    }

    pub async fn claim_source_intake_invocation(
        &self,
        request: ProductEdgeSourceInvocationClaimRequestV1,
    ) -> Result<ProductEdgeInvocationClaimReadbackV1, ProductEdgeError> {
        if request.attempt_identity.trim().is_empty()
            || request.binding_identity.trim().is_empty()
            || request.attempt_identity != request.binding_identity
        {
            return Err(ProductEdgeError::InvalidProposal(
                "source invocation attempt",
            ));
        }
        let mut transaction = begin_read_committed(&self.pool).await?;
        let existing_hint: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM product_edge_effect_invocation_claims_v1 WHERE admission_identity=$1)",
        )
        .bind(&request.admission.admission_identity)
        .fetch_one(&mut *transaction)
        .await
        .map_err(storage)?;
        let admission = resolve_admission_for_downstream_in_transaction(
            &mut transaction,
            &request.admission,
            if existing_hint {
                DownstreamAdmissionModeV1::Historical
            } else {
                DownstreamAdmissionModeV1::FirstMutation {
                    read_cut_epoch_ms: now_ms()?,
                }
            },
        )
        .await?;
        let payload: SourceIntakeAdmissionPayloadV1 =
            serde_json::from_value(admission.request().typed_payload.clone())
                .map_err(|_| ProductEdgeError::Unavailable)?;

        if admission.request().operation != SOURCE_INTAKE_OPERATION_V1
            || admission.request().operation_schema != SOURCE_INTAKE_OPERATION_SCHEMA_V1
            || admission.request().target_owner != SOURCE_INTAKE_TARGET_OWNER_V1
            || !has_exact_source_intake_effects(&admission.request().requested_effects)
            || payload.request_identity != admission.request().request_identity
            || !valid_source_doi(&payload.normalized_doi)
            || !valid_source_interpretation(&payload.interpretation)
        {
            return Err(ProductEdgeError::Unavailable);
        }
        // Product Edge locks and verifies its complete admission first. The
        // final cross-owner lock is the exact R&D binding that this claim uses.
        let binding = resolve_source_acquisition_binding_in_transaction(
            &mut transaction,
            &request.admission.request_identity,
            &request.binding_identity,
        )
        .await
        .map_err(source_invocation_custody_error)?;

        if binding.request_identity() != request.admission.request_identity
            || binding.admission_identity() != request.admission.admission_identity
            || binding.admission_digest() != request.admission.admission_digest
            || binding.operation_manifest_identity() != admission.manifest_identity()
            || binding.operation_manifest_digest() != admission.manifest_digest()
            || binding.normalized_doi() != payload.normalized_doi
        {
            return Err(ProductEdgeError::Unavailable);
        }

        if existing_hint {
            let existing =
                load_invocation_claim(&mut transaction, &request.admission.admission_identity)
                    .await?
                    .ok_or(ProductEdgeError::Unavailable)?;
            if existing.attempt_identity != request.attempt_identity {
                return Err(ProductEdgeError::ConflictingReplay);
            }
            load_invocation_admission_for_locator(
                &mut transaction,
                &request.admission,
                &existing,
                SOURCE_PROVIDER_EFFECT_V1,
            )
            .await?;
            load_invocation_state(&mut transaction, &existing.claim_identity)
                .await?
                .ok_or(ProductEdgeError::Unavailable)?;
            let readback = resolve_invocation_claim_readback(
                &mut transaction,
                &request.admission.admission_identity,
                ProductEdgeInvocationClaimDispositionV1::AlreadyClaimed,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return Ok(readback);
        }

        let write_cut = now_ms()?;
        if !admission.authorizes_first_mutation_at(write_cut) {
            return Err(ProductEdgeError::Unavailable);
        }
        let readback =
            commit_source_invocation_claim(&mut transaction, &admission, &request, write_cut)
                .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(readback)
    }

    pub async fn start_source_intake_invocation(
        &self,
        request: ProductEdgeSourceInvocationStartRequestV1,
    ) -> Result<ProductEdgeInvocationStartReadbackV1, ProductEdgeError> {
        if request.request_identity.trim().is_empty()
            || request.admission_identity.trim().is_empty()
            || request.attempt_identity.trim().is_empty()
            || request.claim_identity.trim().is_empty()
            || request.reservation_identity.trim().is_empty()
            || request.reservation_digest.trim().is_empty()
        {
            return Err(ProductEdgeError::InvalidProposal(
                "source invocation start locator",
            ));
        }
        let admission_identity = request.admission_identity.clone();
        let mut transaction = begin_read_committed(&self.pool).await?;
        let hinted_state_json: Option<serde_json::Value> = sqlx::query_scalar(
            "SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE admission_identity=$1",
        )
        .bind(&admission_identity)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(storage)?;
        let hinted_state: StoredInvocationStateV1 =
            from_json(hinted_state_json.ok_or(ProductEdgeError::Unavailable)?)?;
        if invocation_state_digest(&hinted_state)? != hinted_state.state_digest {
            return Err(ProductEdgeError::Unavailable);
        }
        let claim = load_invocation_claim(&mut transaction, &admission_identity)
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;

        if claim.claim_identity != request.claim_identity
            || claim.attempt_identity != request.attempt_identity
        {
            return Err(ProductEdgeError::ConflictingReplay);
        }
        let admission_receipt =
            load_invocation_admission_receipt(&mut transaction, &claim.claim_identity)
                .await?
                .ok_or(ProductEdgeError::Unavailable)?;
        let receipt = load_invocation_admission_for_locator(
            &mut transaction,
            &ProductEdgeAdmissionLocatorV1 {
                request_identity: request.request_identity.clone(),
                admission_identity: admission_identity.clone(),
                admission_digest: admission_receipt.admission_digest,
            },
            &claim,
            SOURCE_PROVIDER_EFFECT_V1,
        )
        .await?;

        if receipt.request_identity != request.request_identity {
            return Err(ProductEdgeError::Unavailable);
        }
        let state = load_invocation_state(&mut transaction, &claim.claim_identity)
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;
        if state != hinted_state {
            return Err(ProductEdgeError::Unavailable);
        }
        // All Product Edge claim and state locks precede the final R&D Owner
        // reservation lock, matching the claim path's PE -> R&D order.
        let reservation = resolve_source_invocation_start_reservation_in_transaction(
            &mut transaction,
            &request.request_identity,
            &request.attempt_identity,
            &request.claim_identity,
            &request.reservation_identity,
            &request.reservation_digest,
        )
        .await
        .map_err(source_invocation_custody_error)?;

        if claim.claim_identity != reservation.claim_identity()
            || claim.claim_digest != reservation.claim_digest()
            || claim.attempt_identity != reservation.attempt_identity()
        {
            return Err(ProductEdgeError::ConflictingReplay);
        }
        // The R&D reservation is re-resolved under lock immediately before the
        // one-way Product Edge start transition.
        verify_source_invocation_start_reservation_in_transaction(&mut transaction, &reservation)
            .await
            .map_err(source_invocation_custody_error)?;

        if state.state == StoredInvocationStateKindV1::InvocationStarted {
            let readback = resolve_invocation_start_readback(
                &mut transaction,
                &admission_identity,
                ProductEdgeInvocationStartDispositionV1::OutcomeUnknown,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return Ok(readback);
        }
        let started_at = now_ms()?;
        let mut started = state.clone();
        started.state = StoredInvocationStateKindV1::InvocationStarted;
        started.state_digest.clear();
        started.updated_at_epoch_ms = started_at;
        started.state_digest = invocation_state_digest(&started)?;
        let updated = sqlx::query("UPDATE product_edge_effect_invocation_states_v1 SET state_digest=$1, state_json=$2, updated_at_epoch_ms=$3 WHERE claim_identity=$4 AND state_digest=$5 AND state_json=$6")
            .bind(&started.state_digest).bind(json(&started)?).bind(to_i64(started_at)?)
            .bind(&started.claim_identity).bind(&state.state_digest).bind(json(&state)?)
            .execute(&mut *transaction).await.map_err(storage)?;

        if updated.rows_affected() != 1 {
            return Err(ProductEdgeError::Unavailable);
        }
        insert_outbox(
            &mut transaction,
            &started.state_digest,
            &started.claim_identity,
            INVOCATION_STARTED_EVENT,
            &started,
            started_at,
        )
        .await?;
        let verified = load_invocation_state(&mut transaction, &started.claim_identity)
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;
        if verified != started {
            return Err(ProductEdgeError::Unavailable);
        }
        let readback = resolve_invocation_start_readback(
            &mut transaction,
            &admission_identity,
            ProductEdgeInvocationStartDispositionV1::StartedNew,
        )
        .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(readback)
    }

    pub async fn start_provider_invocation(
        &self,
        reservation: ArtifactInvocationStartReservationV1,
    ) -> Result<ProductEdgeInvocationStartReadbackV1, ProductEdgeError> {
        let admission_identity = reservation.admission_identity().to_string();
        let mut transaction = begin_read_committed(&self.pool).await?;
        let hinted_state_json: Option<serde_json::Value> = sqlx::query_scalar("SELECT state_json FROM product_edge_effect_invocation_states_v1 WHERE admission_identity=$1")
            .bind(&admission_identity)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(storage)?;
        let hinted_state: StoredInvocationStateV1 =
            from_json(hinted_state_json.ok_or(ProductEdgeError::Unavailable)?)?;
        if invocation_state_digest(&hinted_state)? != hinted_state.state_digest {
            return Err(ProductEdgeError::Unavailable);
        }
        let claim = load_invocation_claim(&mut transaction, &admission_identity)
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;

        if claim.claim_identity != reservation.claim_identity()
            || claim.claim_digest != reservation.claim_digest()
            || claim.attempt_identity != reservation.attempt_identity()
        {
            return Err(ProductEdgeError::ConflictingReplay);
        }
        let state = load_invocation_state(&mut transaction, &claim.claim_identity)
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;
        if state != hinted_state {
            return Err(ProductEdgeError::Unavailable);
        }
        let claim_custody = resolve_invocation_claim_readback(
            &mut transaction,
            &admission_identity,
            ProductEdgeInvocationClaimDispositionV1::AlreadyClaimed,
        )
        .await?
        .into_custody();
        verify_invocation_start_reservation_in_transaction(
            &mut transaction,
            &reservation,
            &claim_custody,
        )
        .await
        .map_err(invocation_reservation_error)?;

        if state.state == StoredInvocationStateKindV1::InvocationStarted {
            let readback = resolve_invocation_start_readback(
                &mut transaction,
                &admission_identity,
                ProductEdgeInvocationStartDispositionV1::OutcomeUnknown,
            )
            .await?;
            transaction.commit().await.map_err(storage)?;
            return Ok(readback);
        }

        let started_at = now_ms()?;
        let mut started = state.clone();
        started.state = StoredInvocationStateKindV1::InvocationStarted;
        started.state_digest.clear();
        started.updated_at_epoch_ms = started_at;
        started.state_digest = invocation_state_digest(&started)?;
        let updated = sqlx::query("UPDATE product_edge_effect_invocation_states_v1 SET state_digest=$1, state_json=$2, updated_at_epoch_ms=$3 WHERE claim_identity=$4 AND state_digest=$5 AND state_json=$6")
            .bind(&started.state_digest).bind(json(&started)?).bind(to_i64(started_at)?)
            .bind(&started.claim_identity).bind(&state.state_digest).bind(json(&state)?)
            .execute(&mut *transaction).await.map_err(storage)?;

        if updated.rows_affected() != 1 {
            return Err(ProductEdgeError::Unavailable);
        }
        insert_outbox(
            &mut transaction,
            &started.state_digest,
            &started.claim_identity,
            INVOCATION_STARTED_EVENT,
            &started,
            started_at,
        )
        .await?;
        let verified = load_invocation_state(&mut transaction, &started.claim_identity)
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;
        if verified != started {
            return Err(ProductEdgeError::Unavailable);
        }
        let readback = resolve_invocation_start_readback(
            &mut transaction,
            &admission_identity,
            ProductEdgeInvocationStartDispositionV1::StartedNew,
        )
        .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(readback)
    }

    pub async fn resolve_provider_invocation_claim(
        &self,
        admission: &ProductEdgeAdmissionLocatorV1,
        attempt_identity: &str,
    ) -> Result<Option<ProductEdgeInvocationClaimReadbackV1>, ProductEdgeError> {
        let mut transaction = begin_read_committed(&self.pool).await?;
        let Some(claim) =
            load_invocation_claim(&mut transaction, &admission.admission_identity).await?
        else {
            transaction.commit().await.map_err(storage)?;
            return Ok(None);
        };

        if claim.attempt_identity != attempt_identity {
            return Err(ProductEdgeError::ConflictingReplay);
        }
        load_invocation_admission_for_locator(
            &mut transaction,
            admission,
            &claim,
            ARTIFACT_PROVIDER_EFFECT_V1,
        )
        .await?;
        load_invocation_state(&mut transaction, &claim.claim_identity)
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;
        let readback = resolve_invocation_claim_readback(
            &mut transaction,
            &admission.admission_identity,
            ProductEdgeInvocationClaimDispositionV1::AlreadyClaimed,
        )
        .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(Some(readback))
    }

    pub async fn resolve_provider_invocation_claim_by_request(
        &self,
        request_identity: &str,
        attempt_identity: &str,
    ) -> Result<Option<ProductEdgeInvocationClaimReadbackV1>, ProductEdgeError> {
        if request_identity.trim().is_empty() || attempt_identity.trim().is_empty() {
            return Err(ProductEdgeError::InvalidProposal(
                "invocation claim locator",
            ));
        }
        let mut transaction = begin_read_committed(&self.pool).await?;
        let admission = load_admission_row(&mut transaction, request_identity, false)
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;
        let locator = ProductEdgeAdmissionLocatorV1 {
            request_identity: admission.request.request_identity.clone(),
            admission_identity: admission.admission_identity.clone(),
            admission_digest: admission.admission_digest.clone(),
        };
        let Some(claim) =
            load_invocation_claim(&mut transaction, &locator.admission_identity).await?
        else {
            transaction.commit().await.map_err(storage)?;
            return Ok(None);
        };

        if claim.attempt_identity != attempt_identity {
            return Err(ProductEdgeError::ConflictingReplay);
        }
        load_invocation_admission_for_locator(
            &mut transaction,
            &locator,
            &claim,
            ARTIFACT_PROVIDER_EFFECT_V1,
        )
        .await?;
        load_invocation_state(&mut transaction, &claim.claim_identity)
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;
        let readback = resolve_invocation_claim_readback(
            &mut transaction,
            &locator.admission_identity,
            ProductEdgeInvocationClaimDispositionV1::AlreadyClaimed,
        )
        .await?;
        transaction.commit().await.map_err(storage)?;
        Ok(Some(readback))
    }

    fn verify_authorization_trust(
        &self,
        authorization: &OperatorAuthorizationReadbackV1,
    ) -> Result<(), ProductEdgeError> {
        if authorization.issuer_identity() != self.authorization_trust.issuer_identity
            || authorization.issuer_key_version() != self.authorization_trust.issuer_key_version
            || authorization.scope().audience != self.authorization_trust.audience
        {
            return Err(ProductEdgeError::Unavailable);
        }
        Ok(())
    }

    async fn verify_successor_policy(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        predecessor: &StoredBindingV1,
        proposal: &ProductEdgeSuccessorProposalV1,
        read_cut: u64,
        authorization_plan: &LockedAuthorizationPlanV1,
        recovery_epoch: Option<&ExpiredManifestRecoveryEpochV1>,
    ) -> Result<OperatorAuthorizationReadbackV1, ProductEdgeError> {
        if read_cut < proposal.valid_from_epoch_ms
            || read_cut >= proposal.valid_through_epoch_ms
            || proposal.valid_from_epoch_ms <= predecessor.valid_from_epoch_ms
            || proposal.effective_principal != predecessor.effective_principal
            || proposal.scope_policy_version != predecessor.scope_policy_version
            || recovery_epoch.is_none()
                && proposal.capability_policy_version != predecessor.capability_policy_version
            || proposal.audit_policy_version != predecessor.audit_policy_version
        {
            return Err(ProductEdgeError::Unavailable);
        }
        let manifest_bindings = proposal
            .manifests
            .iter()
            .map(|manifest| {
                require_manifest_covers_binding(
                    manifest,
                    proposal.valid_from_epoch_ms,
                    proposal.valid_through_epoch_ms,
                    read_cut,
                )?;
                Ok(OperationManifestBindingV1 {
                    manifest_identity: manifest.manifest_identity()?,
                    manifest_digest: manifest.manifest_digest()?,
                })
            })
            .collect::<Result<Vec<_>, ProductEdgeError>>()?;

        if let Some(epoch) = recovery_epoch {
            let predecessor_authorization =
                authorization_plan.get(&AuthorizationRequirementV1::historical(
                    &predecessor.authorization,
                    &predecessor.authorization_frontier_identity,
                ))?;

            if predecessor_authorization.valid_through_epoch_ms()
                != predecessor.valid_through_epoch_ms
                || proposal.valid_from_epoch_ms
                    != predecessor_authorization.valid_through_epoch_ms()
            {
                return Err(ProductEdgeError::Unavailable);
            }
            verify_recovery_manifest_delta(transaction, predecessor, proposal, epoch).await?;
        } else {
            if read_cut >= predecessor.valid_through_epoch_ms
                || predecessor.manifest_identities
                    != manifest_bindings
                        .iter()
                        .map(|manifest| manifest.manifest_identity.clone())
                        .collect::<Vec<_>>()
            {
                return Err(ProductEdgeError::Unavailable);
            }

            for (proposal_manifest, manifest_binding) in
                proposal.manifests.iter().zip(&manifest_bindings)
            {
                let stored = load_manifest_by_identity(
                    transaction,
                    &manifest_binding.manifest_identity,
                    false,
                )
                .await?
                .ok_or(ProductEdgeError::Unavailable)?;

                if stored.proposal != *proposal_manifest
                    || stored.manifest_digest != manifest_binding.manifest_digest
                {
                    return Err(ProductEdgeError::Unavailable);
                }
            }
        }
        let authorization = authorization_plan.get(&AuthorizationRequirementV1::current(
            &proposal.authorization,
        ))?;

        if !authorization.is_current_at(read_cut) {
            return Err(ProductEdgeError::Unavailable);
        }
        self.verify_authorization_trust(authorization)?;
        if authorization.scope().principal != predecessor.effective_principal
            || authorization.scope().permissions != predecessor.authorized_scope
            || authorization.operation_manifests() != manifest_bindings.as_slice()
            || authorization.recovery_epoch() != recovery_epoch
            || proposal.valid_from_epoch_ms < authorization.not_before_epoch_ms()
            || proposal.valid_through_epoch_ms > authorization.valid_through_epoch_ms()
        {
            return Err(ProductEdgeError::Unavailable);
        }
        Ok(authorization.clone())
    }
}

fn require_successor_head(
    current: &StoredBindingV1,
    proposal: &ProductEdgeSuccessorProposalV1,
) -> Result<(), ProductEdgeError> {
    if current.binding_identity != proposal.expected_history_head
        || current.binding_identity != proposal.predecessor_binding_identity
        || proposal.generation != current.generation.saturating_add(1)
    {
        return Err(ProductEdgeError::ConflictingReplay);
    }
    Ok(())
}

async fn verify_recovery_manifest_delta(
    transaction: &mut Transaction<'_, Postgres>,
    predecessor: &StoredBindingV1,
    proposal: &ProductEdgeSuccessorProposalV1,
    epoch: &ExpiredManifestRecoveryEpochV1,
) -> Result<(), ProductEdgeError> {
    if proposal.valid_from_epoch_ms != predecessor.valid_through_epoch_ms
        || epoch.predecessor_operation_manifests().len() != predecessor.manifest_identities.len()
    {
        return Err(ProductEdgeError::Unavailable);
    }
    let mut predecessor_bindings = Vec::with_capacity(predecessor.manifest_identities.len());
    let mut old_by_key = BTreeMap::new();

    for identity in &predecessor.manifest_identities {
        let stored = load_manifest_by_identity(transaction, identity, false)
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;
        predecessor_bindings.push(OperationManifestBindingV1 {
            manifest_identity: stored.manifest_identity.clone(),
            manifest_digest: stored.manifest_digest.clone(),
        });

        if old_by_key
            .insert(stored.proposal.semantic_key(), stored)
            .is_some()
        {
            return Err(ProductEdgeError::Unavailable);
        }
    }
    predecessor_bindings
        .sort_by(|left, right| left.manifest_identity.cmp(&right.manifest_identity));
    if predecessor_bindings != epoch.predecessor_operation_manifests() {
        return Err(ProductEdgeError::Unavailable);
    }
    let mut new_by_key = BTreeMap::new();

    for manifest in &proposal.manifests {
        if manifest.effective_from_epoch_ms != proposal.valid_from_epoch_ms
            || manifest.valid_through_epoch_ms < proposal.valid_through_epoch_ms
            || new_by_key
                .insert(manifest.semantic_key(), manifest)
                .is_some()
        {
            return Err(ProductEdgeError::Unavailable);
        }
    }
    let transition_old_keys = epoch
        .manifest_transitions
        .iter()
        .filter_map(|transition| match transition {
            ExpiredManifestRecoveryTransitionV1::Retained { semantic_key, .. }
            | ExpiredManifestRecoveryTransitionV1::Removed { semantic_key, .. } => {
                Some(semantic_key)
            }
            ExpiredManifestRecoveryTransitionV1::Added { .. } => None,
        })
        .collect::<Vec<_>>();
    let transition_new_keys = epoch
        .manifest_transitions
        .iter()
        .filter_map(|transition| match transition {
            ExpiredManifestRecoveryTransitionV1::Retained { semantic_key, .. }
            | ExpiredManifestRecoveryTransitionV1::Added { semantic_key, .. } => Some(semantic_key),
            ExpiredManifestRecoveryTransitionV1::Removed { .. } => None,
        })
        .collect::<Vec<_>>();

    if old_by_key.keys().ne(transition_old_keys)
        || new_by_key.keys().ne(transition_new_keys)
        || epoch.successor_operation_manifests()
            != proposal
                .manifests
                .iter()
                .map(|manifest| {
                    Ok(OperationManifestBindingV1 {
                        manifest_identity: manifest.manifest_identity()?,
                        manifest_digest: manifest.manifest_digest()?,
                    })
                })
                .collect::<Result<Vec<_>, ProductEdgeError>>()?
    {
        return Err(ProductEdgeError::Unavailable);
    }

    for transition in &epoch.manifest_transitions {
        match transition {
            ExpiredManifestRecoveryTransitionV1::Retained {
                semantic_key,
                predecessor_manifest,
                successor_manifest,
            } => {
                let old = old_by_key
                    .get(semantic_key)
                    .ok_or(ProductEdgeError::Unavailable)?;
                let new = new_by_key
                    .get(semantic_key)
                    .ok_or(ProductEdgeError::Unavailable)?;

                if manifest_binding(old)? != *predecessor_manifest
                    || manifest_binding_from_proposal(new)? != *successor_manifest
                    || !retained_manifest_is_non_widening(
                        &old.proposal,
                        new,
                        proposal.valid_from_epoch_ms,
                    )
                {
                    return Err(ProductEdgeError::Unavailable);
                }
            }
            ExpiredManifestRecoveryTransitionV1::Added {
                semantic_key,
                successor_manifest,
            } => {
                let new = new_by_key
                    .get(semantic_key)
                    .ok_or(ProductEdgeError::Unavailable)?;

                if manifest_binding_from_proposal(new)? != *successor_manifest
                    || !added_manifest_is_bounded(new)
                {
                    return Err(ProductEdgeError::Unavailable);
                }
            }
            ExpiredManifestRecoveryTransitionV1::Removed {
                semantic_key,
                predecessor_manifest,
            } => {
                let old = old_by_key
                    .get(semantic_key)
                    .ok_or(ProductEdgeError::Unavailable)?;
                if manifest_binding(old)? != *predecessor_manifest {
                    return Err(ProductEdgeError::Unavailable);
                }
            }
        }
    }

    if !recovery_capability_policy_is_valid(&predecessor.capability_policy_version, proposal, epoch)
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok(())
}

fn manifest_binding(
    stored: &StoredManifestV1,
) -> Result<OperationManifestBindingV1, ProductEdgeError> {
    Ok(OperationManifestBindingV1 {
        manifest_identity: stored.proposal.manifest_identity()?,
        manifest_digest: stored.proposal.manifest_digest()?,
    })
}

fn manifest_binding_from_proposal(
    proposal: &AgentOperationManifestProposalV1,
) -> Result<OperationManifestBindingV1, ProductEdgeError> {
    Ok(OperationManifestBindingV1 {
        manifest_identity: proposal.manifest_identity()?,
        manifest_digest: proposal.manifest_digest()?,
    })
}

fn added_manifest_is_bounded(manifest: &AgentOperationManifestProposalV1) -> bool {
    let target = manifest.target_owner.to_ascii_uppercase();
    let prohibited_floor_present = ADDED_MANIFEST_PROHIBITED_FLOOR_V1.iter().all(|required| {
        manifest
            .prohibited_effects
            .iter()
            .any(|effect| effect == required)
    });
    prohibited_floor_present
        && !target.contains("LIVE")
        && !target.contains("TRADING")
        && manifest.allowed_effects.iter().all(|effect| {
            let effect = effect.to_ascii_uppercase();
            !effect.contains("LIVE") && !effect.contains("TRADING")
        })
}

fn retained_manifest_is_non_widening(
    predecessor: &AgentOperationManifestProposalV1,
    successor: &AgentOperationManifestProposalV1,
    successor_start: u64,
) -> bool {
    successor.capability_policy_digest == predecessor.capability_policy_digest
        && successor.effective_from_epoch_ms == predecessor.valid_through_epoch_ms
        && successor.effective_from_epoch_ms == successor_start
        && successor
            .allowed_effects
            .iter()
            .all(|effect| predecessor.allowed_effects.contains(effect))
        && predecessor
            .prohibited_effects
            .iter()
            .all(|effect| successor.prohibited_effects.contains(effect))
}

fn recovery_capability_policy_is_valid(
    predecessor_version: &str,
    successor: &ProductEdgeSuccessorProposalV1,
    epoch: &ExpiredManifestRecoveryEpochV1,
) -> bool {
    if epoch.evolves_capability_set() {
        !successor.capability_policy_version.is_empty()
            && successor.manifests.iter().all(|manifest| {
                manifest.capability_policy_digest == successor.capability_policy_version
            })
    } else {
        successor.capability_policy_version == predecessor_version
    }
}

async fn require_exact_recovery_sidecar(
    transaction: &mut Transaction<'_, Postgres>,
    binding: &StoredBindingV1,
    expected_epoch: Option<&ExpiredManifestRecoveryEpochV1>,
    expected_digest: &str,
) -> Result<(), ProductEdgeError> {
    if binding.recovery_epoch.as_ref() != expected_epoch {
        return Err(ProductEdgeError::ConflictingReplay);
    }
    let rows = sqlx::query("SELECT recovery_epoch_identity, recovery_epoch_digest, predecessor_binding_identity, successor_binding_identity, recovery_json, committed_at_epoch_ms FROM product_edge_expired_manifest_recoveries_v1 WHERE successor_binding_identity=$1 FOR SHARE")
        .bind(&binding.binding_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    match expected_epoch {
        None if rows.is_empty() => Ok(()),
        None => Err(ProductEdgeError::ConflictingReplay),
        Some(_) if rows.len() != 1 => Err(ProductEdgeError::Unavailable),
        Some(epoch) => {
            let row = &rows[0];
            let stored: StoredExpiredManifestRecoveryV1 =
                from_json(row.try_get("recovery_json").map_err(storage)?)?;

            if stored.schema_version != PRODUCT_EDGE_SCHEMA_V1
                || stored.proposal.validate().is_err()
                || stored.proposal.recovery_epoch != *epoch
                || stored.proposal.successor.binding_identity != binding.binding_identity
                || stored.proposal_digest != expected_digest
                || stored.proposal.semantic_digest()? != stored.proposal_digest
                || row
                    .try_get::<String, _>("recovery_epoch_identity")
                    .map_err(storage)?
                    != epoch.recovery_epoch_identity
                || row
                    .try_get::<String, _>("recovery_epoch_digest")
                    .map_err(storage)?
                    != epoch.recovery_epoch_digest
                || row
                    .try_get::<String, _>("predecessor_binding_identity")
                    .map_err(storage)?
                    != stored.proposal.successor.predecessor_binding_identity
                || row
                    .try_get::<String, _>("successor_binding_identity")
                    .map_err(storage)?
                    != binding.binding_identity
                || from_i64(row.try_get("committed_at_epoch_ms").map_err(storage)?)?
                    != stored.committed_at_epoch_ms
            {
                return Err(ProductEdgeError::Unavailable);
            }
            Ok(())
        }
    }
}

async fn commit_source_invocation_claim(
    transaction: &mut Transaction<'_, Postgres>,
    admission: &ProductEdgeAdmissionReadbackV1,
    request: &ProductEdgeSourceInvocationClaimRequestV1,
    write_cut: u64,
) -> Result<ProductEdgeInvocationClaimReadbackV1, ProductEdgeError> {
    if load_invocation_claim(transaction, &request.admission.admission_identity)
        .await?
        .is_some()
    {
        return Err(ProductEdgeError::Unavailable);
    }
    let current_policy = admission
        .current_policy_evidence
        .as_ref()
        .ok_or(ProductEdgeError::Unavailable)?;
    let receipt_identity = identity(
        "product-edge-provider-invocation-admission-receipt-v1",
        &[
            &request.admission.admission_identity,
            &request.attempt_identity,
            &current_policy.binding_identity,
            current_policy.authorization.frontier().frontier_identity(),
            &write_cut.to_string(),
        ],
    );
    let claim_identity = identity(
        "product-edge-provider-invocation-claim-v1",
        &[
            &request.admission.admission_identity,
            &request.attempt_identity,
            &receipt_identity,
        ],
    );
    let historical_authorization = admission.authorization().locator();
    let current_authorization = current_policy.authorization.locator();
    let mut invocation_admission = StoredInvocationAdmissionReceiptV1 {
        schema_version: PRODUCT_EDGE_SCHEMA_V1,
        receipt_identity,
        receipt_digest: String::new(),
        request_identity: admission.request().request_identity.clone(),
        admission_identity: request.admission.admission_identity.clone(),
        admission_digest: request.admission.admission_digest.clone(),
        historical_binding_identity: admission.binding_identity().to_string(),
        historical_binding_generation: admission.binding_generation(),
        historical_authorization_identity: historical_authorization.authorization_identity,
        historical_issuance_receipt_identity: historical_authorization.issuance_receipt_identity,
        historical_authorization_frontier_identity: admission
            .authorization()
            .frontier()
            .frontier_identity()
            .to_string(),
        current_binding_identity: current_policy.binding_identity.clone(),
        current_binding_generation: current_policy.binding_generation,
        current_authorization_identity: current_authorization.authorization_identity,
        current_issuance_receipt_identity: current_authorization.issuance_receipt_identity,
        current_authorization_frontier_identity: current_policy
            .authorization
            .frontier()
            .frontier_identity()
            .to_string(),
        current_authorization_not_before_epoch_ms: current_policy
            .authorization
            .not_before_epoch_ms(),
        current_authorization_valid_through_epoch_ms: current_policy
            .authorization
            .valid_through_epoch_ms(),
        current_binding_valid_from_epoch_ms: current_policy.binding_valid_from_epoch_ms,
        current_binding_valid_through_epoch_ms: current_policy.binding_valid_through_epoch_ms,
        effective_principal: admission.effective_principal().to_string(),
        authorized_scope: admission.authorized_scope().to_vec(),
        scope_policy_version: admission.scope_policy_version().to_string(),
        capability_policy_version: admission.capability_policy_version().to_string(),
        audit_policy_version: admission.audit_policy_version().to_string(),
        manifest_identity: admission.manifest_identity().to_string(),
        manifest_digest: admission.manifest_digest().to_string(),
        manifest_effective_from_epoch_ms: current_policy.manifest_effective_from_epoch_ms,
        manifest_valid_through_epoch_ms: current_policy.manifest_valid_through_epoch_ms,
        attempt_identity: request.attempt_identity.clone(),
        effect: SOURCE_PROVIDER_EFFECT_V1.to_string(),
        claim_identity: claim_identity.clone(),
        write_cut_epoch_ms: write_cut,
    };
    invocation_admission.receipt_digest =
        invocation_admission_receipt_digest(&invocation_admission)?;
    sqlx::query("INSERT INTO product_edge_effect_invocation_admissions_v1 (receipt_identity, receipt_digest, admission_identity, attempt_identity, claim_identity, receipt_json, write_cut_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)")
        .bind(&invocation_admission.receipt_identity)
        .bind(&invocation_admission.receipt_digest)
        .bind(&invocation_admission.admission_identity)
        .bind(&invocation_admission.attempt_identity)
        .bind(&invocation_admission.claim_identity)
        .bind(json(&invocation_admission)?)
        .bind(to_i64(write_cut)?)
        .execute(&mut **transaction).await.map_err(storage)?;
    insert_outbox(
        transaction,
        &invocation_admission.receipt_identity,
        &invocation_admission.admission_identity,
        INVOCATION_ADMISSION_EVENT,
        &invocation_admission,
        write_cut,
    )
    .await?;
    let mut claim = StoredInvocationClaimV1 {
        schema_version: PRODUCT_EDGE_SCHEMA_V1,
        claim_identity,
        admission_identity: request.admission.admission_identity.clone(),
        attempt_identity: request.attempt_identity.clone(),
        invocation_admission_receipt_identity: invocation_admission.receipt_identity,
        invocation_admission_receipt_digest: invocation_admission.receipt_digest,
        claim_digest: String::new(),
        committed_at_epoch_ms: write_cut,
    };
    claim.claim_digest = invocation_claim_digest(&claim)?;
    sqlx::query("INSERT INTO product_edge_effect_invocation_claims_v1 (admission_identity, claim_identity, attempt_identity, claim_digest, claim_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&claim.admission_identity).bind(&claim.claim_identity)
        .bind(&claim.attempt_identity).bind(&claim.claim_digest)
        .bind(json(&claim)?).bind(to_i64(write_cut)?)
        .execute(&mut **transaction).await.map_err(storage)?;
    insert_outbox(
        transaction,
        &claim.claim_identity,
        &claim.admission_identity,
        INVOCATION_CLAIM_EVENT,
        &claim,
        write_cut,
    )
    .await?;
    let mut state = StoredInvocationStateV1 {
        schema_version: PRODUCT_EDGE_SCHEMA_V1,
        claim_identity: claim.claim_identity.clone(),
        admission_identity: claim.admission_identity.clone(),
        attempt_identity: claim.attempt_identity.clone(),
        claim_digest: claim.claim_digest.clone(),
        state: StoredInvocationStateKindV1::Claimed,
        state_digest: String::new(),
        updated_at_epoch_ms: write_cut,
    };
    state.state_digest = invocation_state_digest(&state)?;
    sqlx::query("INSERT INTO product_edge_effect_invocation_states_v1 (claim_identity, admission_identity, attempt_identity, claim_digest, state_digest, state_json, updated_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)")
        .bind(&state.claim_identity).bind(&state.admission_identity)
        .bind(&state.attempt_identity).bind(&state.claim_digest)
        .bind(&state.state_digest).bind(json(&state)?).bind(to_i64(write_cut)?)
        .execute(&mut **transaction).await.map_err(storage)?;
    insert_outbox(
        transaction,
        &state.state_digest,
        &state.claim_identity,
        INVOCATION_CLAIM_STATE_EVENT,
        &state,
        write_cut,
    )
    .await?;
    let verified = load_invocation_claim(transaction, &claim.admission_identity)
        .await?
        .ok_or(ProductEdgeError::Unavailable)?;
    verify_invocation_admission_lineage(
        transaction,
        admission,
        &verified,
        SOURCE_PROVIDER_EFFECT_V1,
    )
    .await?;
    load_invocation_state(transaction, &verified.claim_identity)
        .await?
        .ok_or(ProductEdgeError::Unavailable)?;
    resolve_invocation_claim_readback(
        transaction,
        &verified.admission_identity,
        ProductEdgeInvocationClaimDispositionV1::ClaimedNew,
    )
    .await
}

fn supersession_digest(fence: &StoredSupersessionV1) -> Result<String, ProductEdgeError> {
    canonical_digest(
        "product-edge.deployment-supersession.v1",
        &(
            fence.schema_version,
            &fence.binding_identity,
            &fence.successor_binding_identity,
            &fence.successor_proposal_digest,
            fence.committed_at_epoch_ms,
        ),
    )
}

fn require_manifest_covers_binding(
    manifest: &AgentOperationManifestProposalV1,
    binding_valid_from: u64,
    binding_valid_through: u64,
    read_cut: u64,
) -> Result<(), ProductEdgeError> {
    if read_cut < manifest.effective_from_epoch_ms
        || read_cut >= manifest.valid_through_epoch_ms
        || binding_valid_from < manifest.effective_from_epoch_ms
        || binding_valid_through > manifest.valid_through_epoch_ms
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok(())
}

pub async fn resolve_admission_for_downstream_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &ProductEdgeAdmissionLocatorV1,
    mode: DownstreamAdmissionModeV1,
) -> Result<ProductEdgeAdmissionReadbackV1, ProductEdgeError> {
    let envelope: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT product_edge_api.lock_downstream_admission_v1($1,$2,$3)")
            .bind(&locator.request_identity)
            .bind(&locator.admission_identity)
            .bind(&locator.admission_digest)
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?;
    verify_locked_downstream_envelope(
        envelope.ok_or(ProductEdgeError::Unavailable)?,
        locator,
        mode,
    )
}

pub async fn resolve_source_invocation_claim_for_downstream_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
    admission_identity: &str,
    attempt_identity: &str,
) -> Result<SourceInvocationClaimCustodyV1, ProductEdgeError> {
    resolve_source_invocation_claim_in_transaction(
        transaction,
        request_identity,
        admission_identity,
        attempt_identity,
    )
    .await
    .map_err(source_invocation_custody_error)
}

pub async fn resolve_source_invocation_started_for_downstream_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
    admission_identity: &str,
    attempt_identity: &str,
) -> Result<SourceInvocationStartedCustodyV1, ProductEdgeError> {
    resolve_source_invocation_started_in_transaction(
        transaction,
        request_identity,
        admission_identity,
        attempt_identity,
    )
    .await
    .map_err(source_invocation_custody_error)
}

/// Resolves only Product Edge-owned read-policy custody for a later Portfolio
/// Owner source resolve. The caller transaction retains every OA and Product
/// Edge lock until it commits or rolls back.
pub async fn resolve_portfolio_read_policy_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request: &PortfolioReadPolicyRequestV1,
) -> PortfolioReadPolicyResolutionV1 {
    let unavailable = |reason| PortfolioReadPolicyResolutionV1::Unavailable { reason };
    if request.validate().is_err() {
        return unavailable(PortfolioReadPolicyUnavailableReasonV1::InvalidRequest);
    }

    let envelope: Option<serde_json::Value> = match sqlx::query_scalar(
        "SELECT product_edge_api.lock_portfolio_read_policy_v1($1,$2,$3,$4,$5)",
    )
    .bind(&request.grant.grant_identity)
    .bind(&request.grant.issuance_receipt_identity)
    .bind(&request.admission.request_identity)
    .bind(&request.admission.admission_identity)
    .bind(&request.admission.admission_digest)
    .fetch_one(&mut **transaction)
    .await
    {
        Ok(value) => value,
        Err(_) => return unavailable(PortfolioReadPolicyUnavailableReasonV1::OwnerUnavailable),
    };
    let Some(envelope) = envelope else {
        return unavailable(PortfolioReadPolicyUnavailableReasonV1::OwnerUnavailable);
    };
    let final_cut_epoch_ms = match database_now(transaction).await {
        Ok(value) => value,
        Err(_) => return unavailable(PortfolioReadPolicyUnavailableReasonV1::OwnerUnavailable),
    };
    let envelope: LockedPortfolioReadPolicyEnvelopeV1 = match from_json(envelope) {
        Ok(value) => value,
        Err(_) => return unavailable(PortfolioReadPolicyUnavailableReasonV1::OwnerUnavailable),
    };
    let grant_bytes = match serde_json::to_vec(&envelope.operator_authorization) {
        Ok(value) => value,
        Err(_) => return unavailable(PortfolioReadPolicyUnavailableReasonV1::OwnerUnavailable),
    };
    let grant_evidence =
        match parse_untrusted_portfolio_resource_grant_envelope_v1(&grant_bytes, &request.grant) {
            Ok(value) => value,
            Err(_) => {
                return unavailable(
                    PortfolioReadPolicyUnavailableReasonV1::OperatorAuthorizationMismatch,
                );
            }
        };
    let admission_evidence = match verify_locked_downstream_envelope(
        envelope.product_edge,
        &request.admission,
        DownstreamAdmissionModeV1::FirstMutation {
            read_cut_epoch_ms: final_cut_epoch_ms,
        },
    ) {
        Ok(value) => value,
        Err(_) => {
            return unavailable(PortfolioReadPolicyUnavailableReasonV1::ProductEdgeCustodyMismatch);
        }
    };
    let payload: PortfolioReadPolicyPayloadV1 =
        match serde_json::from_value(admission_evidence.request().typed_payload.clone()) {
            Ok(value) => value,
            Err(_) => {
                return unavailable(
                    PortfolioReadPolicyUnavailableReasonV1::ProductEdgeCustodyMismatch,
                );
            }
        };

    if payload.validate().is_err()
        || payload.grant != request.grant
        || admission_evidence.request().operation != PORTFOLIO_READ_POLICY_OPERATION_V1
        || admission_evidence.request().operation_schema
            != PORTFOLIO_READ_POLICY_OPERATION_SCHEMA_V1
        || admission_evidence.request().target_owner != PORTFOLIO_READ_POLICY_TARGET_OWNER_V1
        || admission_evidence.request().requested_effects
            != [PORTFOLIO_READ_ONLY_EFFECT_POLICY_V1.to_string()]
        || !admission_evidence.has_exact_portfolio_read_manifest()
        || admission_evidence.effective_principal() != payload.resource.principal
        || admission_evidence.authorized_scope()
            != [vibe_operator_authorization::PORTFOLIO_VIEW_PERMISSION_V1]
        || admission_evidence.manifest_identity() != payload.manifest.manifest_locator
        || admission_evidence.manifest_digest() != payload.manifest.manifest_digest
    {
        return unavailable(PortfolioReadPolicyUnavailableReasonV1::ProductEdgeCustodyMismatch);
    }

    if !grant_evidence.matches_resource(&payload.resource)
        || !grant_evidence.matches_product_edge_manifest(&payload.manifest)
    {
        return unavailable(PortfolioReadPolicyUnavailableReasonV1::OperatorAuthorizationMismatch);
    }

    if !admission_evidence.has_current_policy_at(final_cut_epoch_ms)
        || !grant_evidence.is_current_at(final_cut_epoch_ms)
    {
        return unavailable(PortfolioReadPolicyUnavailableReasonV1::PolicyNotCurrent);
    }

    let request_semantic_digest = match admission_evidence.request().semantic_digest() {
        Ok(value) => value,
        Err(_) => return unavailable(PortfolioReadPolicyUnavailableReasonV1::OwnerUnavailable),
    };
    let policy_digest = match payload.policy_digest() {
        Ok(value) => value,
        Err(_) => {
            return unavailable(PortfolioReadPolicyUnavailableReasonV1::ProductEdgeCustodyMismatch);
        }
    };

    if request_semantic_digest != request.expected_request_semantic_digest
        || policy_digest != request.expected_policy_digest
    {
        return unavailable(PortfolioReadPolicyUnavailableReasonV1::ProductEdgeCustodyMismatch);
    }
    let authorization_policy_cut = grant_evidence.frontier_identity().to_string();
    let custody_meaning = serde_json::json!({
        "schema_version": PORTFOLIO_READ_POLICY_SCHEMA_V1,
        "admission": &request.admission,
        "request_semantic_digest": &request_semantic_digest,
        "policy_digest": &policy_digest,
        "resource": &payload.resource,
        "grant": &request.grant,
        "manifest": &payload.manifest,
        "allowed_object_classes": &payload.allowed_object_classes,
        "effect_policy": payload.effect_policy,
        "authorization_policy_cut": &authorization_policy_cut,
        "final_cut_epoch_ms": final_cut_epoch_ms,
        "source_owner_result": PortfolioSourceOwnerResolveResultV1::SourceOwnerResolveUnavailable,
    });
    let custody_digest = match canonical_digest(
        "product-edge.portfolio-read-policy-custody.v1",
        &custody_meaning,
    ) {
        Ok(value) => value,
        Err(_) => return unavailable(PortfolioReadPolicyUnavailableReasonV1::OwnerUnavailable),
    };
    let custody_identity = identity(
        "product-edge-portfolio-read-policy-custody-v1",
        &[
            &request_semantic_digest,
            &authorization_policy_cut,
            &custody_digest,
        ],
    );

    PortfolioReadPolicyResolutionV1::Sealed {
        custody: Box::new(PortfolioReadPolicyCustodyV1 {
            custody_identity,
            custody_digest,
            admission: request.admission.clone(),
            request_semantic_digest,
            policy_digest,
            resource: payload.resource,
            grant: request.grant.clone(),
            manifest: payload.manifest,
            allowed_object_classes: payload.allowed_object_classes,
            effect_policy: payload.effect_policy,
            authorization_policy_cut,
            final_cut_epoch_ms,
            source_owner_result: PortfolioSourceOwnerResolveResultV1::SourceOwnerResolveUnavailable,
            admission_evidence,
            grant_evidence,
        }),
    }
}

async fn verify_admission(
    transaction: &mut Transaction<'_, Postgres>,
    stored: StoredAdmissionV1,
    mode: DownstreamAdmissionModeV1,
    hinted_bindings: &[StoredBindingV1],
    authorization_plan: &LockedAuthorizationPlanV1,
) -> Result<ProductEdgeAdmissionReadbackV1, ProductEdgeError> {
    stored
        .request
        .validate()
        .map_err(|_| ProductEdgeError::Unavailable)?;

    if stored.schema_version != PRODUCT_EDGE_SCHEMA_V1
        || stored.request.semantic_digest()? != stored.request_semantic_digest
        || admission_digest(&stored)? != stored.admission_digest
    {
        return Err(ProductEdgeError::Unavailable);
    }
    let receipt = admission_receipt(&stored);
    verify_outbox(
        transaction,
        &receipt.receipt_identity,
        &stored.admission_identity,
        ADMISSION_EVENT,
        &receipt,
        stored.committed_at_epoch_ms,
    )
    .await?;
    let history = verify_deployment_history(
        transaction,
        &stored.deployment_identity,
        false,
        hinted_bindings,
        authorization_plan,
    )
    .await?
    .ok_or(ProductEdgeError::Unavailable)?;
    let binding = history.find(&stored.binding_identity)?;
    let policy_binding = match mode {
        DownstreamAdmissionModeV1::FirstMutation { .. } => first_mutation_policy_binding(
            &stored,
            &history.bindings,
            history.pending_supersession.is_some(),
        )?,
        DownstreamAdmissionModeV1::Historical => binding,
    };
    let manifest = load_manifest_by_identity(transaction, &stored.manifest_identity, false)
        .await?
        .ok_or(ProductEdgeError::Unavailable)?;

    if binding.deployment_identity != stored.deployment_identity
        || binding.generation != stored.binding_generation
        || binding.binding_identity != stored.history_head_identity
        || binding.effective_principal != stored.effective_principal
        || binding.authorized_scope != stored.authorized_scope
        || binding.scope_policy_version != stored.scope_policy_version
        || binding.capability_policy_version != stored.capability_policy_version
        || binding.audit_policy_version != stored.audit_policy_version
        || binding.authorization != stored.authorization
        || binding.authorization_frontier_identity != stored.authorization_frontier_identity
        || !binding
            .manifest_identities
            .contains(&stored.manifest_identity)
        || manifest.manifest_digest != stored.manifest_digest
        || manifest.proposal.operation != stored.request.operation
        || manifest.proposal.operation_schema != stored.request.operation_schema
        || manifest.proposal.target_owner != stored.request.target_owner
    {
        return Err(ProductEdgeError::Unavailable);
    }
    let authorization_requirement = AuthorizationRequirementV1::historical(
        &stored.authorization,
        &stored.authorization_frontier_identity,
    );
    let authorization = authorization_plan.get(&authorization_requirement)?;

    if authorization.frontier().frontier_identity() != stored.authorization_frontier_identity
        || authorization.scope().principal != stored.effective_principal
        || authorization.scope().permissions != stored.authorized_scope
        || authorization.request_proof_digest() != stored.request.request_proof_digest
        || !authorization.operation_manifests().iter().any(|entry| {
            entry.manifest_identity == stored.manifest_identity
                && entry.manifest_digest == stored.manifest_digest
        })
    {
        return Err(ProductEdgeError::Unavailable);
    }
    let current_policy_evidence =
        if let DownstreamAdmissionModeV1::FirstMutation { read_cut_epoch_ms } = mode {
            let current_authorization = authorization_plan.get(
                &AuthorizationRequirementV1::current(&policy_binding.authorization),
            )?;
            let mut current_manifest_bindings =
                Vec::with_capacity(policy_binding.manifest_identities.len());
            for identity in &policy_binding.manifest_identities {
                let current_manifest = load_manifest_by_identity(transaction, identity, false)
                    .await?
                    .ok_or(ProductEdgeError::Unavailable)?;
                current_manifest_bindings.push(OperationManifestBindingV1 {
                    manifest_identity: current_manifest.manifest_identity,
                    manifest_digest: current_manifest.manifest_digest,
                });
            }

            if current_authorization.frontier().frontier_identity()
                != policy_binding.authorization_frontier_identity
                || current_authorization.scope().principal != policy_binding.effective_principal
                || current_authorization.scope().permissions != policy_binding.authorized_scope
                || current_authorization.operation_manifests()
                    != current_manifest_bindings.as_slice()
                || !authority_windows_are_current_at(
                    read_cut_epoch_ms,
                    policy_binding.valid_from_epoch_ms,
                    policy_binding.valid_through_epoch_ms,
                    manifest.proposal.effective_from_epoch_ms,
                    manifest.proposal.valid_through_epoch_ms,
                    current_authorization.is_current_at(read_cut_epoch_ms),
                )
            {
                return Err(ProductEdgeError::Unavailable);
            }
            Some(ProductEdgeCurrentPolicyEvidenceV1 {
                binding_identity: policy_binding.binding_identity.clone(),
                binding_generation: policy_binding.generation,
                authorization: current_authorization.canonical_evidence(),
                manifest_identity: manifest.manifest_identity.clone(),
                manifest_digest: manifest.manifest_digest.clone(),
                binding_valid_from_epoch_ms: policy_binding.valid_from_epoch_ms,
                binding_valid_through_epoch_ms: policy_binding.valid_through_epoch_ms,
                manifest_effective_from_epoch_ms: manifest.proposal.effective_from_epoch_ms,
                manifest_valid_through_epoch_ms: manifest.proposal.valid_through_epoch_ms,
            })
        } else {
            None
        };
    Ok(ProductEdgeAdmissionReadbackV1 {
        locator: ProductEdgeAdmissionLocatorV1 {
            request_identity: stored.request.request_identity.clone(),
            admission_identity: stored.admission_identity,
            admission_digest: stored.admission_digest,
        },
        receipt: receipt.into(),
        request: stored.request,
        deployment_identity: stored.deployment_identity,
        binding_identity: stored.binding_identity,
        binding_generation: stored.binding_generation,
        history_head_identity: stored.history_head_identity,
        effective_principal: stored.effective_principal,
        authorized_scope: stored.authorized_scope,
        scope_policy_version: stored.scope_policy_version,
        capability_policy_version: stored.capability_policy_version,
        audit_policy_version: stored.audit_policy_version,
        authorization: authorization.canonical_evidence(),
        manifest_identity: stored.manifest_identity,
        manifest_digest: stored.manifest_digest,
        read_cut_epoch_ms: stored.read_cut_epoch_ms,
        manifest_proposal: manifest.proposal.clone(),
        original_current_authorization_evidence: None,
        current_policy_evidence,
    })
}

async fn store_manifest(
    transaction: &mut Transaction<'_, Postgres>,
    proposal: &AgentOperationManifestProposalV1,
    committed_at: u64,
) -> Result<StoredManifestV1, ProductEdgeError> {
    let manifest_identity = proposal.manifest_identity()?;
    let manifest_digest = proposal.manifest_digest()?;

    if let Some(existing) = load_manifest_by_identity(transaction, &manifest_identity, true).await?
    {
        if existing.proposal != *proposal || existing.manifest_digest != manifest_digest {
            return Err(ProductEdgeError::ConflictingReplay);
        }
        return Ok(existing);
    }
    let stored = StoredManifestV1 {
        schema_version: PRODUCT_EDGE_SCHEMA_V1,
        manifest_identity,
        manifest_digest,
        proposal: proposal.clone(),
        committed_at_epoch_ms: committed_at,
    };
    let receipt = manifest_receipt(&stored);
    sqlx::query("INSERT INTO product_edge_operation_manifests_v1 (manifest_identity, operation, operation_schema, target_owner, manifest_digest, manifest_json, receipt_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(&stored.manifest_identity).bind(&stored.proposal.operation).bind(&stored.proposal.operation_schema)
        .bind(&stored.proposal.target_owner).bind(&stored.manifest_digest).bind(json(&stored)?).bind(json(&receipt)?)
        .bind(to_i64(committed_at)?).execute(&mut **transaction).await.map_err(storage)?;
    insert_outbox(
        transaction,
        &receipt.receipt_identity,
        &stored.manifest_identity,
        MANIFEST_EVENT,
        &receipt,
        committed_at,
    )
    .await?;
    Ok(stored)
}

async fn verify_deployment_history(
    transaction: &mut Transaction<'_, Postgres>,
    deployment_identity: &str,
    update_head: bool,
    hinted_bindings: &[StoredBindingV1],
    authorization_plan: &LockedAuthorizationPlanV1,
) -> Result<Option<VerifiedDeploymentHistoryV1>, ProductEdgeError> {
    let binding_rows = sqlx::query(
        "SELECT binding_identity, generation FROM product_edge_deployment_bindings_v1 WHERE deployment_identity = $1 ORDER BY generation, binding_identity FOR SHARE",
    )
    .bind(deployment_identity)
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;
    let head_query = if update_head {
        "SELECT deployment_identity, binding_identity, generation, binding_digest, committed_at_epoch_ms FROM product_edge_deployment_heads_v1 WHERE deployment_identity = $1 FOR UPDATE"
    } else {
        "SELECT deployment_identity, binding_identity, generation, binding_digest, committed_at_epoch_ms FROM product_edge_deployment_heads_v1 WHERE deployment_identity = $1 FOR SHARE"
    };
    let head_rows = sqlx::query(head_query)
        .bind(deployment_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if binding_rows.len() != hinted_bindings.len() {
        return Err(ProductEdgeError::Unavailable);
    }

    if binding_rows.is_empty() {
        if head_rows.is_empty() {
            return Ok(None);
        }
        return Err(ProductEdgeError::Unavailable);
    }

    if head_rows.len() != 1 {
        return Err(ProductEdgeError::Unavailable);
    }

    let mut bindings = Vec::with_capacity(binding_rows.len());
    let mut pending_supersession = None;

    for (index, row) in binding_rows.iter().enumerate() {
        let binding_identity: String = row.try_get("binding_identity").map_err(storage)?;
        let binding = load_binding_by_identity(transaction, &binding_identity, false)
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;
        if hinted_bindings.get(index) != Some(&binding) {
            return Err(ProductEdgeError::Unavailable);
        }
        let expected_generation = u64::try_from(index)
            .map_err(storage)?
            .checked_add(1)
            .ok_or(ProductEdgeError::Unavailable)?;
        let expected_predecessor = bindings
            .last()
            .map(|binding: &StoredBindingV1| binding.binding_identity.as_str());
        if binding.deployment_identity != deployment_identity
            || binding.generation != expected_generation
            || row.try_get::<i64, _>("generation").map_err(storage)? != to_i64(expected_generation)?
            || binding.predecessor_binding_identity.as_deref() != expected_predecessor
            || bindings.last().is_some_and(|predecessor| {
                binding.committed_at_epoch_ms < predecessor.committed_at_epoch_ms
            })
        {
            return Err(ProductEdgeError::Unavailable);
        }

        let mut manifest_bindings = Vec::with_capacity(binding.manifest_identities.len());
        for manifest_identity in &binding.manifest_identities {
            let manifest = load_manifest_by_identity(transaction, manifest_identity, false)
                .await?
                .ok_or(ProductEdgeError::Unavailable)?;
            verify_outbox_kinds(transaction, manifest_identity, &[MANIFEST_EVENT]).await?;
            manifest_bindings.push(OperationManifestBindingV1 {
                manifest_identity: manifest.manifest_identity,
                manifest_digest: manifest.manifest_digest,
            });
        }
        let manifest_locator_rows = sqlx::query("SELECT manifest_identity, manifest_digest FROM product_edge_binding_manifests_v1 WHERE binding_identity=$1 ORDER BY manifest_identity FOR SHARE")
            .bind(&binding.binding_identity)
            .fetch_all(&mut **transaction)
            .await
            .map_err(storage)?;

        if manifest_locator_rows.len() != manifest_bindings.len()
            || manifest_locator_rows
                .iter()
                .zip(&manifest_bindings)
                .any(|(row, manifest)| {
                    row.try_get::<String, _>("manifest_identity")
                        .ok()
                        .as_deref()
                        != Some(manifest.manifest_identity.as_str())
                        || row.try_get::<String, _>("manifest_digest").ok().as_deref()
                            != Some(manifest.manifest_digest.as_str())
                })
        {
            return Err(ProductEdgeError::Unavailable);
        }

        if binding.manifest_identities.is_empty()
            || binding
                .manifest_identities
                .windows(2)
                .any(|pair| pair[0] >= pair[1])
        {
            return Err(ProductEdgeError::Unavailable);
        }
        let authorization = authorization_plan.get(&AuthorizationRequirementV1::historical(
            &binding.authorization,
            &binding.authorization_frontier_identity,
        ))?;

        if authorization.frontier().frontier_identity() != binding.authorization_frontier_identity
            || authorization.scope().principal != binding.effective_principal
            || authorization.scope().permissions != binding.authorized_scope
            || authorization.operation_manifests() != manifest_bindings.as_slice()
            || binding.valid_from_epoch_ms < authorization.not_before_epoch_ms()
            || binding.valid_through_epoch_ms > authorization.valid_through_epoch_ms()
        {
            return Err(ProductEdgeError::Unavailable);
        }

        if binding.predecessor_binding_identity.is_none() {
            if binding.recovery_epoch.is_some() {
                return Err(ProductEdgeError::Unavailable);
            }
        } else {
            let proposal_digest = successor_proposal_digest(transaction, &binding).await?;
            require_exact_recovery_sidecar(
                transaction,
                &binding,
                binding.recovery_epoch.as_ref(),
                &proposal_digest,
            )
            .await?;
        }

        let supersession = load_supersession(transaction, &binding.binding_identity).await?;
        let is_current = index + 1 == binding_rows.len();
        if is_current {
            if let Some(supersession) = supersession {
                verify_outbox_kinds(
                    transaction,
                    &binding.binding_identity,
                    &[BINDING_EVENT, SUPERSESSION_EVENT],
                )
                .await?;
                pending_supersession = Some(supersession);
            } else {
                verify_outbox_kinds(transaction, &binding.binding_identity, &[BINDING_EVENT])
                    .await?;
            }
        } else {
            let supersession = supersession.ok_or(ProductEdgeError::Unavailable)?;
            let expected_successor: String = binding_rows[index + 1]
                .try_get("binding_identity")
                .map_err(storage)?;
            let successor = load_binding_by_identity(transaction, &expected_successor, false)
                .await?
                .ok_or(ProductEdgeError::Unavailable)?;

            if supersession.successor_binding_identity != expected_successor
                || supersession.successor_proposal_digest
                    != successor_proposal_digest(transaction, &successor).await?
            {
                return Err(ProductEdgeError::Unavailable);
            }
            verify_outbox_kinds(
                transaction,
                &binding.binding_identity,
                &[BINDING_EVENT, SUPERSESSION_EVENT],
            )
            .await?;
        }
        bindings.push(binding);
    }

    let current = bindings.last().ok_or(ProductEdgeError::Unavailable)?;
    let head = &head_rows[0];
    if head
        .try_get::<String, _>("deployment_identity")
        .map_err(storage)?
        != current.deployment_identity
        || head
            .try_get::<String, _>("binding_identity")
            .map_err(storage)?
            != current.binding_identity
        || head.try_get::<i64, _>("generation").map_err(storage)? != to_i64(current.generation)?
        || head
            .try_get::<String, _>("binding_digest")
            .map_err(storage)?
            != current.binding_digest
        || from_i64(head.try_get("committed_at_epoch_ms").map_err(storage)?)?
            != current.committed_at_epoch_ms
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok(Some(VerifiedDeploymentHistoryV1 {
        bindings,
        pending_supersession,
    }))
}

async fn successor_proposal_digest(
    transaction: &mut Transaction<'_, Postgres>,
    binding: &StoredBindingV1,
) -> Result<String, ProductEdgeError> {
    let predecessor = binding
        .predecessor_binding_identity
        .clone()
        .ok_or(ProductEdgeError::Unavailable)?;
    let mut manifests = Vec::with_capacity(binding.manifest_identities.len());
    for identity in &binding.manifest_identities {
        manifests.push(
            load_manifest_by_identity(transaction, identity, false)
                .await?
                .ok_or(ProductEdgeError::Unavailable)?
                .proposal,
        );
    }
    let proposal = ProductEdgeSuccessorProposalV1 {
        deployment_identity: binding.deployment_identity.clone(),
        binding_identity: binding.binding_identity.clone(),
        predecessor_binding_identity: predecessor.clone(),
        expected_history_head: predecessor,
        generation: binding.generation,
        effective_principal: binding.effective_principal.clone(),
        scope_policy_version: binding.scope_policy_version.clone(),
        capability_policy_version: binding.capability_policy_version.clone(),
        audit_policy_version: binding.audit_policy_version.clone(),
        valid_from_epoch_ms: binding.valid_from_epoch_ms,
        valid_through_epoch_ms: binding.valid_through_epoch_ms,
        authorization: binding.authorization.clone(),
        manifests,
    };

    if let Some(epoch) = &binding.recovery_epoch {
        ProductEdgeExpiredManifestRecoveryProposalV1 {
            recovery_epoch: epoch.clone(),
            successor: proposal,
        }
        .semantic_digest()
    } else {
        proposal.semantic_digest()
    }
}

async fn load_supersession(
    transaction: &mut Transaction<'_, Postgres>,
    binding_identity: &str,
) -> Result<Option<StoredSupersessionV1>, ProductEdgeError> {
    let rows = sqlx::query("SELECT binding_identity, successor_binding_identity, supersession_digest, supersession_json, committed_at_epoch_ms FROM product_edge_deployment_supersessions_v1 WHERE binding_identity = $1 FOR SHARE")
        .bind(binding_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() > 1 {
        return Err(ProductEdgeError::Unavailable);
    }
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let stored: StoredSupersessionV1 =
        from_json(row.try_get("supersession_json").map_err(storage)?)?;
    let digest = canonical_digest(
        "product-edge.deployment-supersession.v1",
        &(
            stored.schema_version,
            &stored.binding_identity,
            &stored.successor_binding_identity,
            &stored.successor_proposal_digest,
            stored.committed_at_epoch_ms,
        ),
    )?;

    if stored.schema_version != PRODUCT_EDGE_SCHEMA_V1
        || row
            .try_get::<String, _>("binding_identity")
            .map_err(storage)?
            != stored.binding_identity
        || row
            .try_get::<String, _>("successor_binding_identity")
            .map_err(storage)?
            != stored.successor_binding_identity
        || row
            .try_get::<String, _>("supersession_digest")
            .map_err(storage)?
            != stored.supersession_digest
        || stored.supersession_digest != digest
        || from_i64(row.try_get("committed_at_epoch_ms").map_err(storage)?)?
            != stored.committed_at_epoch_ms
    {
        return Err(ProductEdgeError::Unavailable);
    }
    verify_outbox(
        transaction,
        &stored.supersession_digest,
        &stored.binding_identity,
        SUPERSESSION_EVENT,
        &stored,
        stored.committed_at_epoch_ms,
    )
    .await?;
    Ok(Some(stored))
}

async fn load_bootstrap_readback(
    transaction: &mut Transaction<'_, Postgres>,
    binding: &StoredBindingV1,
    _read_cut: u64,
    hinted_bindings: &[StoredBindingV1],
    authorization_plan: &LockedAuthorizationPlanV1,
) -> Result<ProductEdgeBootstrapReadbackV1, ProductEdgeError> {
    let history = verify_deployment_history(
        transaction,
        &binding.deployment_identity,
        true,
        hinted_bindings,
        authorization_plan,
    )
    .await?
    .ok_or(ProductEdgeError::Unavailable)?;
    if history.find(&binding.binding_identity)? != binding {
        return Err(ProductEdgeError::Unavailable);
    }
    let authorization = authorization_plan
        .get(&AuthorizationRequirementV1::historical(
            &binding.authorization,
            &binding.authorization_frontier_identity,
        ))?
        .clone();
    Ok(ProductEdgeBootstrapReadbackV1 {
        deployment_identity: binding.deployment_identity.clone(),
        binding_identity: binding.binding_identity.clone(),
        generation: binding.generation,
        history_head_identity: binding.binding_identity.clone(),
        manifest_identities: binding.manifest_identities.clone(),
        authorization,
        committed_at_epoch_ms: binding.committed_at_epoch_ms,
    })
}

async fn load_current_binding(
    transaction: &mut Transaction<'_, Postgres>,
    deployment: &str,
    read_cut: u64,
    hinted_bindings: &[StoredBindingV1],
    authorization_plan: &LockedAuthorizationPlanV1,
) -> Result<StoredBindingV1, ProductEdgeError> {
    let history = verify_deployment_history(
        transaction,
        deployment,
        true,
        hinted_bindings,
        authorization_plan,
    )
    .await?
    .ok_or(ProductEdgeError::Unavailable)?;
    let binding = history.current()?.clone();
    if read_cut < binding.valid_from_epoch_ms || read_cut >= binding.valid_through_epoch_ms {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok(binding)
}

async fn load_binding_by_identity(
    transaction: &mut Transaction<'_, Postgres>,
    value: &str,
    update: bool,
) -> Result<Option<StoredBindingV1>, ProductEdgeError> {
    let query = if update {
        "SELECT binding_identity, deployment_identity, generation, predecessor_binding_identity, authorization_identity, issuance_receipt_identity, authorization_frontier_identity, binding_digest, binding_json, receipt_json, committed_at_epoch_ms FROM product_edge_deployment_bindings_v1 WHERE binding_identity = $1 FOR UPDATE"
    } else {
        "SELECT binding_identity, deployment_identity, generation, predecessor_binding_identity, authorization_identity, issuance_receipt_identity, authorization_frontier_identity, binding_digest, binding_json, receipt_json, committed_at_epoch_ms FROM product_edge_deployment_bindings_v1 WHERE binding_identity = $1 FOR SHARE"
    };
    let rows = sqlx::query(query)
        .bind(value)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() > 1 {
        return Err(ProductEdgeError::Unavailable);
    }
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let (stored, receipt) = decode_binding_row(row)?;
    verify_outbox(
        transaction,
        &receipt.receipt_identity,
        &stored.binding_identity,
        BINDING_EVENT,
        &receipt,
        stored.committed_at_epoch_ms,
    )
    .await?;
    Ok(Some(stored))
}

fn decode_binding_row(
    row: &sqlx::postgres::PgRow,
) -> Result<(StoredBindingV1, StoredBindingReceiptV1), ProductEdgeError> {
    let stored: StoredBindingV1 = from_json(row.try_get("binding_json").map_err(storage)?)?;
    let receipt: StoredBindingReceiptV1 = from_json(row.try_get("receipt_json").map_err(storage)?)?;

    if stored.schema_version != PRODUCT_EDGE_SCHEMA_V1
        || row
            .try_get::<String, _>("binding_identity")
            .map_err(storage)?
            != stored.binding_identity
        || row
            .try_get::<String, _>("deployment_identity")
            .map_err(storage)?
            != stored.deployment_identity
        || row.try_get::<i64, _>("generation").map_err(storage)? != to_i64(stored.generation)?
        || row
            .try_get::<Option<String>, _>("predecessor_binding_identity")
            .map_err(storage)?
            != stored.predecessor_binding_identity
        || row
            .try_get::<String, _>("authorization_identity")
            .map_err(storage)?
            != stored.authorization.authorization_identity
        || row
            .try_get::<String, _>("issuance_receipt_identity")
            .map_err(storage)?
            != stored.authorization.issuance_receipt_identity
        || row
            .try_get::<String, _>("authorization_frontier_identity")
            .map_err(storage)?
            != stored.authorization_frontier_identity
        || row
            .try_get::<String, _>("binding_digest")
            .map_err(storage)?
            != stored.binding_digest
        || binding_digest(&stored)? != stored.binding_digest
        || from_i64(row.try_get("committed_at_epoch_ms").map_err(storage)?)?
            != stored.committed_at_epoch_ms
        || receipt != binding_receipt(&stored)
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok((stored, receipt))
}

async fn load_manifest_for_operation(
    transaction: &mut Transaction<'_, Postgres>,
    binding: &StoredBindingV1,
    request: &ProductEdgeAdmissionRequestV1,
) -> Result<StoredManifestV1, ProductEdgeError> {
    let mut matches = Vec::new();

    for manifest_identity in &binding.manifest_identities {
        let manifest = load_manifest_by_identity(transaction, manifest_identity, false)
            .await?
            .ok_or(ProductEdgeError::Unavailable)?;

        if manifest.proposal.operation == request.operation
            && manifest.proposal.operation_schema == request.operation_schema
            && manifest.proposal.target_owner == request.target_owner
        {
            matches.push(manifest);
        }
    }

    if matches.len() == 1 {
        Ok(matches.pop().expect("one manifest match"))
    } else {
        Err(ProductEdgeError::Unavailable)
    }
}

async fn load_manifest_by_identity(
    transaction: &mut Transaction<'_, Postgres>,
    value: &str,
    update: bool,
) -> Result<Option<StoredManifestV1>, ProductEdgeError> {
    let query = if update {
        "SELECT manifest_identity, operation, operation_schema, target_owner, manifest_digest, manifest_json, receipt_json, committed_at_epoch_ms FROM product_edge_operation_manifests_v1 WHERE manifest_identity = $1 FOR UPDATE"
    } else {
        "SELECT manifest_identity, operation, operation_schema, target_owner, manifest_digest, manifest_json, receipt_json, committed_at_epoch_ms FROM product_edge_operation_manifests_v1 WHERE manifest_identity = $1 FOR SHARE"
    };
    let rows = sqlx::query(query)
        .bind(value)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() > 1 {
        return Err(ProductEdgeError::Unavailable);
    }
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let stored: StoredManifestV1 = from_json(row.try_get("manifest_json").map_err(storage)?)?;
    let receipt: StoredManifestReceiptV1 =
        from_json(row.try_get("receipt_json").map_err(storage)?)?;

    if stored.schema_version != PRODUCT_EDGE_SCHEMA_V1
        || stored.proposal.manifest_identity()? != stored.manifest_identity
        || stored.proposal.manifest_digest()? != stored.manifest_digest
        || row
            .try_get::<String, _>("manifest_identity")
            .map_err(storage)?
            != stored.manifest_identity
        || row.try_get::<String, _>("operation").map_err(storage)? != stored.proposal.operation
        || row
            .try_get::<String, _>("operation_schema")
            .map_err(storage)?
            != stored.proposal.operation_schema
        || row.try_get::<String, _>("target_owner").map_err(storage)?
            != stored.proposal.target_owner
        || row
            .try_get::<String, _>("manifest_digest")
            .map_err(storage)?
            != stored.manifest_digest
        || from_i64(row.try_get("committed_at_epoch_ms").map_err(storage)?)?
            != stored.committed_at_epoch_ms
        || receipt != manifest_receipt(&stored)
    {
        return Err(ProductEdgeError::Unavailable);
    }
    verify_outbox(
        transaction,
        &receipt.receipt_identity,
        &stored.manifest_identity,
        MANIFEST_EVENT,
        &receipt,
        stored.committed_at_epoch_ms,
    )
    .await?;
    Ok(Some(stored))
}

async fn load_admission_row(
    transaction: &mut Transaction<'_, Postgres>,
    value: &str,
    update: bool,
) -> Result<Option<StoredAdmissionV1>, ProductEdgeError> {
    let query = if update {
        "SELECT request_identity, admission_identity, deployment_identity, binding_identity, authorization_identity, issuance_receipt_identity, authorization_frontier_identity, request_semantic_digest, admission_digest, admission_json, receipt_json, committed_at_epoch_ms FROM product_edge_request_admissions_v1 WHERE request_identity = $1 FOR UPDATE"
    } else {
        "SELECT request_identity, admission_identity, deployment_identity, binding_identity, authorization_identity, issuance_receipt_identity, authorization_frontier_identity, request_semantic_digest, admission_digest, admission_json, receipt_json, committed_at_epoch_ms FROM product_edge_request_admissions_v1 WHERE request_identity = $1 FOR SHARE"
    };
    let rows = sqlx::query(query)
        .bind(value)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() > 1 {
        return Err(ProductEdgeError::Unavailable);
    }
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let (stored, _) = decode_admission_row(row)?;
    Ok(Some(stored))
}

async fn load_admission_row_by_identity(
    transaction: &mut Transaction<'_, Postgres>,
    admission_identity: &str,
) -> Result<Option<(StoredAdmissionV1, StoredAdmissionReceiptV1)>, ProductEdgeError> {
    let rows = sqlx::query(
        "SELECT request_identity, admission_identity, deployment_identity, binding_identity, authorization_identity, issuance_receipt_identity, authorization_frontier_identity, request_semantic_digest, admission_digest, admission_json, receipt_json, committed_at_epoch_ms FROM product_edge_request_admissions_v1 WHERE admission_identity = $1",
    )
    .bind(admission_identity)
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;

    if rows.len() > 1 {
        return Err(ProductEdgeError::Unavailable);
    }
    rows.first().map(decode_admission_row).transpose()
}

fn decode_admission_row(
    row: &sqlx::postgres::PgRow,
) -> Result<(StoredAdmissionV1, StoredAdmissionReceiptV1), ProductEdgeError> {
    let stored: StoredAdmissionV1 = from_json(row.try_get("admission_json").map_err(storage)?)?;
    let receipt: StoredAdmissionReceiptV1 =
        from_json(row.try_get("receipt_json").map_err(storage)?)?;

    stored
        .request
        .validate()
        .map_err(|_| ProductEdgeError::Unavailable)?;

    if stored.schema_version != PRODUCT_EDGE_SCHEMA_V1
        || stored.request.semantic_digest()? != stored.request_semantic_digest
        || admission_digest(&stored)? != stored.admission_digest
    {
        return Err(ProductEdgeError::Unavailable);
    }

    if row
        .try_get::<String, _>("request_identity")
        .map_err(storage)?
        != stored.request.request_identity
        || row
            .try_get::<String, _>("admission_identity")
            .map_err(storage)?
            != stored.admission_identity
        || row
            .try_get::<String, _>("deployment_identity")
            .map_err(storage)?
            != stored.deployment_identity
        || row
            .try_get::<String, _>("binding_identity")
            .map_err(storage)?
            != stored.binding_identity
        || row
            .try_get::<String, _>("authorization_identity")
            .map_err(storage)?
            != stored.authorization.authorization_identity
        || row
            .try_get::<String, _>("issuance_receipt_identity")
            .map_err(storage)?
            != stored.authorization.issuance_receipt_identity
        || row
            .try_get::<String, _>("authorization_frontier_identity")
            .map_err(storage)?
            != stored.authorization_frontier_identity
        || row
            .try_get::<String, _>("request_semantic_digest")
            .map_err(storage)?
            != stored.request_semantic_digest
        || row
            .try_get::<String, _>("admission_digest")
            .map_err(storage)?
            != stored.admission_digest
        || from_i64(row.try_get("committed_at_epoch_ms").map_err(storage)?)?
            != stored.committed_at_epoch_ms
        || receipt != admission_receipt(&stored)
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok((stored, receipt))
}

fn manifest_receipt(stored: &StoredManifestV1) -> StoredManifestReceiptV1 {
    StoredManifestReceiptV1 {
        schema_version: 1,
        receipt_identity: identity(
            "product-edge-operation-manifest-receipt-v1",
            &[
                &stored.manifest_identity,
                &stored.manifest_digest,
                &stored.committed_at_epoch_ms.to_string(),
            ],
        ),
        manifest_identity: stored.manifest_identity.clone(),
        manifest_digest: stored.manifest_digest.clone(),
        committed_at_epoch_ms: stored.committed_at_epoch_ms,
    }
}

fn binding_receipt(stored: &StoredBindingV1) -> StoredBindingReceiptV1 {
    StoredBindingReceiptV1 {
        schema_version: 1,
        receipt_identity: identity(
            "product-edge-deployment-binding-receipt-v1",
            &[
                &stored.binding_identity,
                &stored.binding_digest,
                &stored.committed_at_epoch_ms.to_string(),
            ],
        ),
        binding_identity: stored.binding_identity.clone(),
        binding_digest: stored.binding_digest.clone(),
        committed_at_epoch_ms: stored.committed_at_epoch_ms,
    }
}

fn admission_receipt(stored: &StoredAdmissionV1) -> StoredAdmissionReceiptV1 {
    StoredAdmissionReceiptV1 {
        schema_version: 1,
        receipt_identity: identity(
            "product-edge-request-admission-receipt-v1",
            &[
                &stored.admission_identity,
                &stored.admission_digest,
                &stored.committed_at_epoch_ms.to_string(),
            ],
        ),
        admission_identity: stored.admission_identity.clone(),
        admission_digest: stored.admission_digest.clone(),
        committed_at_epoch_ms: stored.committed_at_epoch_ms,
    }
}

fn admission_digest(stored: &StoredAdmissionV1) -> Result<String, ProductEdgeError> {
    let mut meaning = stored.clone();
    meaning.admission_digest.clear();
    canonical_digest("product-edge.request-admission.v1", &meaning)
}

fn binding_matches_proposal(
    stored: &StoredBindingV1,
    proposal: &ProductEdgeBootstrapProposalV1,
) -> Result<bool, ProductEdgeError> {
    let manifest_identities = proposal
        .manifests
        .iter()
        .map(AgentOperationManifestProposalV1::manifest_identity)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(stored.deployment_identity == proposal.deployment_identity
        && stored.binding_identity == proposal.binding_identity
        && stored.generation == proposal.generation
        && stored.predecessor_binding_identity.is_none()
        && stored.effective_principal == proposal.effective_principal
        && stored.scope_policy_version == proposal.scope_policy_version
        && stored.capability_policy_version == proposal.capability_policy_version
        && stored.audit_policy_version == proposal.audit_policy_version
        && stored.valid_from_epoch_ms == proposal.valid_from_epoch_ms
        && stored.valid_through_epoch_ms == proposal.valid_through_epoch_ms
        && stored.authorization == proposal.authorization
        && stored.manifest_identities == manifest_identities)
}

fn binding_matches_successor(
    stored: &StoredBindingV1,
    proposal: &ProductEdgeSuccessorProposalV1,
) -> Result<bool, ProductEdgeError> {
    let manifest_identities = proposal
        .manifests
        .iter()
        .map(AgentOperationManifestProposalV1::manifest_identity)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(stored.deployment_identity == proposal.deployment_identity
        && stored.binding_identity == proposal.binding_identity
        && stored.generation == proposal.generation
        && stored.predecessor_binding_identity.as_deref()
            == Some(proposal.predecessor_binding_identity.as_str())
        && stored.effective_principal == proposal.effective_principal
        && stored.scope_policy_version == proposal.scope_policy_version
        && stored.capability_policy_version == proposal.capability_policy_version
        && stored.audit_policy_version == proposal.audit_policy_version
        && stored.valid_from_epoch_ms == proposal.valid_from_epoch_ms
        && stored.valid_through_epoch_ms == proposal.valid_through_epoch_ms
        && stored.authorization == proposal.authorization
        && stored.manifest_identities == manifest_identities)
}

fn binding_digest(stored: &StoredBindingV1) -> Result<String, ProductEdgeError> {
    let mut meaning = stored.clone();
    meaning.binding_digest.clear();
    canonical_digest("product-edge.deployment-binding.v1", &meaning)
}

async fn lock_deployment(
    transaction: &mut Transaction<'_, Postgres>,
    value: &str,
) -> Result<(), ProductEdgeError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("deployment{value}"))
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}
async fn lock_request(
    transaction: &mut Transaction<'_, Postgres>,
    value: &str,
) -> Result<(), ProductEdgeError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("request{value}"))
        .execute(&mut **transaction)
        .await
        .map_err(storage)?;
    Ok(())
}

fn current_research_artifact_evidence_digest(
    evidence: &StoredCurrentResearchEvidenceV1,
) -> Result<String, ProductEdgeError> {
    let bytes = serde_json::to_vec(&serde_json::json!({
        "domain": "rd-owner.current-research-artifact-evidence.v1",
        "evidence": evidence,
    }))
    .map_err(storage)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

async fn peek_current_research_for_artifact(
    transaction: &mut Transaction<'_, Postgres>,
    intent_identity: &str,
) -> Result<PeekCurrentResearchEnvelopeV1, ProductEdgeError> {
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.peek_current_research_for_artifact_v1($1)")
            .bind(intent_identity)
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?;
    let value = value.ok_or(ProductEdgeError::Unavailable)?;
    let envelope: PeekCurrentResearchEnvelopeV1 =
        serde_json::from_value(value.clone()).map_err(|_| ProductEdgeError::Unavailable)?;
    if serde_json::to_value(&envelope.evidence).map_err(storage)? != value["evidence"]
        || envelope.evidence.schema_version != 1
        || envelope.evidence.intent_identity != intent_identity
        || envelope.evidence.evidence_identity.trim().is_empty()
        || envelope.evidence_digest
            != current_research_artifact_evidence_digest(&envelope.evidence)?
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok(envelope)
}

async fn lock_current_research_for_artifact(
    transaction: &mut Transaction<'_, Postgres>,
    intent_identity: &str,
    peeked: &PeekCurrentResearchEnvelopeV1,
) -> Result<LockedCurrentResearchEnvelopeV1, ProductEdgeError> {
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.lock_current_research_for_artifact_v1($1,$2,$3)")
            .bind(intent_identity)
            .bind(&peeked.evidence.evidence_identity)
            .bind(&peeked.evidence_digest)
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?;
    let value = value.ok_or(ProductEdgeError::Unavailable)?;
    let locked: LockedCurrentResearchEnvelopeV1 =
        serde_json::from_value(value).map_err(|_| ProductEdgeError::Unavailable)?;

    if locked.evidence != peeked.evidence
        || locked.evidence_digest != peeked.evidence_digest
        || locked.evidence_digest != current_research_artifact_evidence_digest(&locked.evidence)?
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok(locked)
}

async fn insert_outbox<T: Serialize>(
    transaction: &mut Transaction<'_, Postgres>,
    seed: &str,
    aggregate: &str,
    kind: &str,
    payload: &T,
    committed_at: u64,
) -> Result<String, ProductEdgeError> {
    insert_outbox_record(transaction, seed, aggregate, kind, payload, committed_at).await
}

async fn insert_admission_outbox<T: Serialize>(
    transaction: &mut Transaction<'_, Postgres>,
    seed: &str,
    aggregate: &str,
    payload: &T,
    committed_at: u64,
) -> Result<(), ProductEdgeError> {
    let owner_sequence: i64 = sqlx::query_scalar(
        "UPDATE product_edge_admission_event_stream_v1 SET last_owner_sequence = last_owner_sequence + 1 WHERE stream_identity = $1 RETURNING last_owner_sequence",
    )
    .bind(PRODUCT_EDGE_ADMISSION_EVENT_STREAM_V1)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)?
    .ok_or(ProductEdgeError::Unavailable)?;
    let event_identity = insert_outbox_record(
        transaction,
        seed,
        aggregate,
        ADMISSION_EVENT,
        payload,
        committed_at,
    )
    .await?;
    let predecessor_event_identity: Option<String> = if owner_sequence == 1 {
        None
    } else {
        Some(
            sqlx::query_scalar(
                "SELECT event_identity FROM product_edge_admission_events_v1 WHERE owner_sequence = $1 FOR SHARE",
            )
            .bind(owner_sequence - 1)
            .fetch_optional(&mut **transaction)
            .await
            .map_err(storage)?
            .ok_or(ProductEdgeError::Unavailable)?,
        )
    };
    sqlx::query(
        "INSERT INTO product_edge_admission_events_v1 (owner_sequence, event_identity, predecessor_event_identity, assignment_mode) VALUES ($1,$2,$3,'TRANSACTIONAL')",
    )
    .bind(owner_sequence)
    .bind(event_identity)
    .bind(predecessor_event_identity)
    .execute(&mut **transaction)
    .await
    .map_err(storage)?;
    Ok(())
}

async fn insert_outbox_record<T: Serialize>(
    transaction: &mut Transaction<'_, Postgres>,
    seed: &str,
    aggregate: &str,
    kind: &str,
    payload: &T,
    committed_at: u64,
) -> Result<String, ProductEdgeError> {
    let payload_digest = canonical_digest("product-edge.outbox-payload.v1", payload)?;
    let event_identity = identity(
        "product-edge-owner-event-v1",
        &[
            seed,
            aggregate,
            kind,
            &payload_digest,
            &committed_at.to_string(),
        ],
    );
    let record = StoredOutboxV1 {
        schema_version: 1,
        event_identity: event_identity.clone(),
        aggregate_identity: aggregate.to_string(),
        event_kind: kind.to_string(),
        payload_digest: payload_digest.clone(),
        committed_at_epoch_ms: committed_at,
    };
    sqlx::query("INSERT INTO product_edge_owner_outbox_v1 (event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(&event_identity).bind(aggregate).bind(kind).bind(&payload_digest).bind(json(&record)?).bind(to_i64(committed_at)?)
        .execute(&mut **transaction).await.map_err(storage)?;
    Ok(event_identity)
}

async fn verify_outbox<T: Serialize>(
    transaction: &mut Transaction<'_, Postgres>,
    seed: &str,
    aggregate: &str,
    kind: &str,
    payload: &T,
    committed_at: u64,
) -> Result<(), ProductEdgeError> {
    verify_outbox_with_lock(
        transaction,
        seed,
        aggregate,
        kind,
        payload,
        committed_at,
        true,
    )
    .await
}

async fn verify_outbox_read_only<T: Serialize>(
    transaction: &mut Transaction<'_, Postgres>,
    seed: &str,
    aggregate: &str,
    kind: &str,
    payload: &T,
    committed_at: u64,
) -> Result<(), ProductEdgeError> {
    verify_outbox_with_lock(
        transaction,
        seed,
        aggregate,
        kind,
        payload,
        committed_at,
        false,
    )
    .await
}

async fn verify_outbox_with_lock<T: Serialize>(
    transaction: &mut Transaction<'_, Postgres>,
    seed: &str,
    aggregate: &str,
    kind: &str,
    payload: &T,
    committed_at: u64,
    lock_rows: bool,
) -> Result<(), ProductEdgeError> {
    let payload_digest = canonical_digest("product-edge.outbox-payload.v1", payload)?;
    let event_identity = identity(
        "product-edge-owner-event-v1",
        &[
            seed,
            aggregate,
            kind,
            &payload_digest,
            &committed_at.to_string(),
        ],
    );
    let query = if lock_rows {
        "SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms FROM product_edge_owner_outbox_v1 WHERE aggregate_identity = $1 FOR SHARE"
    } else {
        "SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms FROM product_edge_owner_outbox_v1 WHERE aggregate_identity = $1"
    };
    let rows = sqlx::query(query)
        .bind(aggregate)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let matches: Vec<_> = rows
        .iter()
        .filter(|row| row.try_get::<String, _>("event_kind").ok().as_deref() == Some(kind))
        .collect();

    if matches.len() != 1 {
        return Err(ProductEdgeError::Unavailable);
    }
    let row = matches[0];
    let record: StoredOutboxV1 = from_json(row.try_get("payload_json").map_err(storage)?)?;
    let expected = StoredOutboxV1 {
        schema_version: 1,
        event_identity: event_identity.clone(),
        aggregate_identity: aggregate.to_string(),
        event_kind: kind.to_string(),
        payload_digest: payload_digest.clone(),
        committed_at_epoch_ms: committed_at,
    };

    if record != expected
        || row
            .try_get::<String, _>("event_identity")
            .map_err(storage)?
            != event_identity
        || row
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != aggregate
        || row.try_get::<String, _>("event_kind").map_err(storage)? != kind
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != payload_digest
        || from_i64(row.try_get("committed_at_epoch_ms").map_err(storage)?)? != committed_at
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok(())
}

async fn verify_outbox_kinds(
    transaction: &mut Transaction<'_, Postgres>,
    aggregate_identity: &str,
    expected_kinds: &[&str],
) -> Result<(), ProductEdgeError> {
    let rows = sqlx::query(
        "SELECT event_kind FROM product_edge_owner_outbox_v1 WHERE aggregate_identity = $1 ORDER BY event_kind FOR SHARE",
    )
    .bind(aggregate_identity)
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;
    let actual = rows
        .iter()
        .map(|row| row.try_get::<String, _>("event_kind").map_err(storage))
        .collect::<Result<Vec<_>, ProductEdgeError>>()?;

    if actual
        != expected_kinds
            .iter()
            .map(|kind| (*kind).to_string())
            .collect::<Vec<_>>()
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok(())
}

async fn verify_admission_event_stream(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<u64, ProductEdgeError> {
    let row: Option<AdmissionEventStreamStateRowV1> = sqlx::query_as(
        "SELECT last_owner_sequence, (SELECT COUNT(*) FROM product_edge_admission_events_v1) AS event_count, (SELECT MIN(owner_sequence) FROM product_edge_admission_events_v1) AS minimum_owner_sequence, (SELECT MAX(owner_sequence) FROM product_edge_admission_events_v1) AS maximum_owner_sequence, (SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE event_kind = $1) AS admission_count, (SELECT COUNT(*) FROM product_edge_admission_events_v1 AS event JOIN product_edge_owner_outbox_v1 AS outbox ON outbox.event_identity = event.event_identity WHERE outbox.event_kind <> $1) AS wrong_kind_count, (SELECT COUNT(*) FROM (SELECT owner_sequence, predecessor_event_identity, LAG(event_identity) OVER (ORDER BY owner_sequence) AS expected_predecessor_event_identity FROM product_edge_admission_events_v1) AS chain WHERE (owner_sequence = 1 AND predecessor_event_identity IS NOT NULL) OR (owner_sequence > 1 AND predecessor_event_identity IS DISTINCT FROM expected_predecessor_event_identity)) AS broken_predecessor_count, ((SELECT COUNT(*) FROM product_edge_admission_events_v1 AS event JOIN product_edge_owner_outbox_v1 AS outbox ON outbox.event_identity = event.event_identity WHERE event.assignment_mode NOT IN ('TRANSACTIONAL','REBUILT') OR (event.assignment_mode = 'TRANSACTIONAL' AND event.xmin <> outbox.xmin)) + (SELECT COUNT(*) FROM (SELECT event.owner_sequence, MIN(event.owner_sequence) OVER () - 1 + ROW_NUMBER() OVER (ORDER BY outbox.committed_at_epoch_ms, outbox.event_identity) AS expected_owner_sequence FROM product_edge_admission_events_v1 AS event JOIN product_edge_owner_outbox_v1 AS outbox ON outbox.event_identity = event.event_identity WHERE event.assignment_mode = 'REBUILT') AS rebuilt WHERE owner_sequence <> expected_owner_sequence)) AS broken_assignment_count FROM product_edge_admission_event_stream_v1 WHERE stream_identity = $2",
    )
    .bind(ADMISSION_EVENT)
    .bind(PRODUCT_EDGE_ADMISSION_EVENT_STREAM_V1)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(storage)?;
    let row = row.ok_or(ProductEdgeError::Unavailable)?;
    let last = from_i64(row.last_owner_sequence)?;
    let count = from_i64(row.event_count)?;
    let admission_count = from_i64(row.admission_count)?;
    let wrong_kind_count = from_i64(row.wrong_kind_count)?;
    let broken_predecessor_count = from_i64(row.broken_predecessor_count)?;
    let broken_assignment_count = from_i64(row.broken_assignment_count)?;
    let minimum = row.minimum_owner_sequence.map(from_i64).transpose()?;
    let maximum = row.maximum_owner_sequence.map(from_i64).transpose()?;

    if count != admission_count
        || wrong_kind_count != 0
        || broken_predecessor_count != 0
        || broken_assignment_count != 0
        || (last == 0 && (count != 0 || minimum.is_some() || maximum.is_some()))
        || (last > 0 && (count != last || minimum != Some(1) || maximum != Some(last)))
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok(last)
}

async fn follow_admission_events_after(
    pool: &PgPool,
    cursor: &ProductEdgeAdmissionEventCursorV1,
    page_size: u32,
) -> Result<Vec<ProductEdgeAdmissionEventLocatorV1>, ProductEdgeError> {
    if page_size == 0 || page_size > MAX_ADMISSION_EVENT_PAGE_V1 {
        return Err(ProductEdgeError::InvalidProposal("admission event cursor"));
    }
    let cursor_has_no_anchor = cursor.event_identity().is_none()
        && cursor.fact_identity().is_none()
        && cursor.fact_digest().is_none()
        && cursor.observation_identity().is_none()
        && cursor.observation_digest().is_none();
    let cursor_has_complete_anchor = cursor
        .event_identity()
        .is_some_and(|value| !value.trim().is_empty())
        && cursor
            .fact_identity()
            .is_some_and(|value| !value.trim().is_empty())
        && cursor.fact_digest().is_some_and(is_sha256_digest)
        && cursor
            .observation_identity()
            .is_some_and(|value| !value.trim().is_empty())
        && cursor.observation_digest().is_some_and(is_sha256_digest);
    if cursor.stream_identity() != PRODUCT_EDGE_ADMISSION_EVENT_STREAM_V1
        || (cursor.owner_sequence() == 0 && !cursor_has_no_anchor)
        || (cursor.owner_sequence() > 0 && !cursor_has_complete_anchor)
    {
        return Err(ProductEdgeError::Unavailable);
    }
    let mut transaction = begin_repeatable_read(pool).await?;
    let last_owner_sequence = verify_admission_event_stream(&mut transaction).await?;
    if cursor.owner_sequence() > last_owner_sequence {
        return Err(ProductEdgeError::Unavailable);
    }

    if cursor.owner_sequence() > 0 {
        let anchor =
            load_admission_event_locator_by_sequence(&mut transaction, cursor.owner_sequence())
                .await?
                .ok_or(ProductEdgeError::Unavailable)?;
        let observation =
            resolve_admission_observation_in_transaction(&mut transaction, &anchor).await?;
        if cursor.event_identity() != Some(anchor.event_identity())
            || cursor.fact_identity() != Some(anchor.fact_identity())
            || cursor.fact_digest() != Some(anchor.fact_digest())
            || cursor.observation_identity() != Some(observation.observation_identity())
            || cursor.observation_digest() != Some(observation.observation_digest())
        {
            return Err(ProductEdgeError::Unavailable);
        }
    }

    let rows = sqlx::query(
        "SELECT event.owner_sequence, outbox.event_identity, outbox.aggregate_identity FROM product_edge_admission_events_v1 AS event JOIN product_edge_owner_outbox_v1 AS outbox ON outbox.event_identity = event.event_identity WHERE outbox.event_kind = $1 AND event.owner_sequence > $2 ORDER BY event.owner_sequence LIMIT $3",
    )
    .bind(ADMISSION_EVENT)
    .bind(to_i64(cursor.owner_sequence())?)
    .bind(i64::from(page_size))
    .fetch_all(&mut *transaction)
    .await
    .map_err(storage)?;
    let mut locators = Vec::with_capacity(rows.len());
    let mut previous_sequence = cursor.owner_sequence();

    for row in rows {
        let locator = admission_event_locator_from_row(&mut transaction, &row).await?;
        if locator.owner_sequence() <= previous_sequence {
            return Err(ProductEdgeError::Unavailable);
        }
        resolve_admission_observation_in_transaction(&mut transaction, &locator).await?;
        previous_sequence = locator.owner_sequence();
        locators.push(locator);
    }
    transaction.commit().await.map_err(storage)?;
    Ok(locators)
}

async fn resolve_admission_observation(
    pool: &PgPool,
    locator: &ProductEdgeAdmissionEventLocatorV1,
) -> Result<ProductEdgeAdmissionObservationV1, ProductEdgeError> {
    let mut transaction = begin_repeatable_read(pool).await?;
    verify_admission_event_stream(&mut transaction).await?;
    let observation =
        resolve_admission_observation_in_transaction(&mut transaction, locator).await?;
    transaction.commit().await.map_err(storage)?;
    Ok(observation)
}

async fn load_admission_event_locator_by_sequence(
    transaction: &mut Transaction<'_, Postgres>,
    owner_sequence: u64,
) -> Result<Option<ProductEdgeAdmissionEventLocatorV1>, ProductEdgeError> {
    let rows = sqlx::query(
        "SELECT event.owner_sequence, outbox.event_identity, outbox.aggregate_identity FROM product_edge_admission_events_v1 AS event JOIN product_edge_owner_outbox_v1 AS outbox ON outbox.event_identity = event.event_identity WHERE outbox.event_kind = $1 AND event.owner_sequence = $2",
    )
    .bind(ADMISSION_EVENT)
    .bind(to_i64(owner_sequence)?)
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;

    if rows.len() > 1 {
        return Err(ProductEdgeError::Unavailable);
    }

    match rows.first() {
        Some(row) => Ok(Some(
            admission_event_locator_from_row(transaction, row).await?,
        )),
        None => Ok(None),
    }
}

async fn admission_event_locator_from_row(
    transaction: &mut Transaction<'_, Postgres>,
    row: &sqlx::postgres::PgRow,
) -> Result<ProductEdgeAdmissionEventLocatorV1, ProductEdgeError> {
    let owner_sequence = from_i64(row.try_get("owner_sequence").map_err(storage)?)?;
    let event_identity: String = row.try_get("event_identity").map_err(storage)?;
    let fact_identity: String = row.try_get("aggregate_identity").map_err(storage)?;
    let (admission, _) = load_admission_row_by_identity(transaction, &fact_identity)
        .await?
        .ok_or(ProductEdgeError::Unavailable)?;
    if owner_sequence == 0 || admission.admission_identity != fact_identity {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok(ProductEdgeAdmissionEventLocatorV1::from_owner_fact(
        owner_sequence,
        event_identity,
        fact_identity,
        admission.admission_digest,
    ))
}

async fn resolve_admission_observation_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &ProductEdgeAdmissionEventLocatorV1,
) -> Result<ProductEdgeAdmissionObservationV1, ProductEdgeError> {
    if locator.stream_identity() != PRODUCT_EDGE_ADMISSION_EVENT_STREAM_V1
        || locator.owner_sequence() == 0
        || locator.event_identity().trim().is_empty()
        || locator.fact_identity().trim().is_empty()
        || !is_sha256_digest(locator.fact_digest())
    {
        return Err(ProductEdgeError::Unavailable);
    }
    let (admission, receipt) = load_admission_row_by_identity(transaction, locator.fact_identity())
        .await?
        .ok_or(ProductEdgeError::Unavailable)?;

    if admission.admission_identity != locator.fact_identity()
        || admission.admission_digest != locator.fact_digest()
        || receipt.admission_identity != locator.fact_identity()
        || receipt.admission_digest != locator.fact_digest()
        || receipt.committed_at_epoch_ms != admission.committed_at_epoch_ms
    {
        return Err(ProductEdgeError::Unavailable);
    }
    let rows = sqlx::query(
        "SELECT event.owner_sequence, outbox.event_identity, outbox.aggregate_identity, outbox.event_kind, outbox.payload_digest, outbox.payload_json, outbox.committed_at_epoch_ms FROM product_edge_admission_events_v1 AS event JOIN product_edge_owner_outbox_v1 AS outbox ON outbox.event_identity = event.event_identity WHERE outbox.event_identity = $1",
    )
    .bind(locator.event_identity())
    .fetch_all(&mut **transaction)
    .await
    .map_err(storage)?;

    if rows.len() != 1 {
        return Err(ProductEdgeError::Unavailable);
    }
    let row = &rows[0];
    let owner_sequence: i64 = row.try_get("owner_sequence").map_err(storage)?;

    if from_i64(owner_sequence)? != locator.owner_sequence()
        || row
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != locator.fact_identity()
        || row.try_get::<String, _>("event_kind").map_err(storage)? != ADMISSION_EVENT
        || from_i64(row.try_get("committed_at_epoch_ms").map_err(storage)?)?
            != admission.committed_at_epoch_ms
    {
        return Err(ProductEdgeError::Unavailable);
    }
    verify_outbox_read_only(
        transaction,
        &receipt.receipt_identity,
        &admission.admission_identity,
        ADMISSION_EVENT,
        &receipt,
        admission.committed_at_epoch_ms,
    )
    .await?;
    let observation_digest = canonical_digest(
        "product-edge.admission-observation.v1",
        &(
            PRODUCT_EDGE_SCHEMA_V1,
            locator,
            &receipt.receipt_identity,
            admission.committed_at_epoch_ms,
        ),
    )?;
    let observation_identity = identity(
        "product-edge-admission-observation-v1",
        &[
            locator.event_identity(),
            locator.fact_identity(),
            locator.fact_digest(),
            &observation_digest,
        ],
    );
    Ok(ProductEdgeAdmissionObservationV1::from_owner_fact(
        observation_identity,
        observation_digest,
        locator.clone(),
        receipt.receipt_identity,
        admission.committed_at_epoch_ms,
    ))
}

fn now_ms() -> Result<u64, ProductEdgeError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| ProductEdgeError::Storage(e.to_string()))?;
    u64::try_from(duration.as_millis()).map_err(|e| ProductEdgeError::Storage(e.to_string()))
}
async fn database_now(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<u64, ProductEdgeError> {
    let value: i64 =
        sqlx::query_scalar("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint")
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?;
    from_i64(value)
}
fn json<T: Serialize>(value: &T) -> Result<serde_json::Value, ProductEdgeError> {
    serde_json::to_value(value).map_err(|e| ProductEdgeError::Storage(e.to_string()))
}
fn from_json<T: for<'de> Deserialize<'de>>(
    value: serde_json::Value,
) -> Result<T, ProductEdgeError> {
    serde_json::from_value(value).map_err(|_| ProductEdgeError::Unavailable)
}
fn to_i64(value: u64) -> Result<i64, ProductEdgeError> {
    i64::try_from(value).map_err(|e| ProductEdgeError::Storage(e.to_string()))
}
fn from_i64(value: i64) -> Result<u64, ProductEdgeError> {
    u64::try_from(value).map_err(|_| ProductEdgeError::Unavailable)
}
async fn begin_read_committed(
    pool: &PgPool,
) -> Result<Transaction<'_, Postgres>, ProductEdgeError> {
    let mut transaction = pool.begin().await.map_err(storage)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    Ok(transaction)
}
async fn begin_repeatable_read(
    pool: &PgPool,
) -> Result<Transaction<'_, Postgres>, ProductEdgeError> {
    let mut transaction = pool.begin().await.map_err(storage)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
    Ok(transaction)
}
fn storage(error: impl Display) -> ProductEdgeError {
    ProductEdgeError::Storage(error.to_string())
}
fn invocation_reservation_error(
    error: vibe_rd_artifact_invocation_custody::ArtifactInvocationCustodyError,
) -> ProductEdgeError {
    match error {
        vibe_rd_artifact_invocation_custody::ArtifactInvocationCustodyError::Unavailable => {
            ProductEdgeError::Unavailable
        }
        vibe_rd_artifact_invocation_custody::ArtifactInvocationCustodyError::Storage(message) => {
            ProductEdgeError::Storage(message)
        }
    }
}
fn source_invocation_custody_error(
    error: vibe_rd_source_intake_invocation_custody::SourceInvocationCustodyError,
) -> ProductEdgeError {
    match error {
        vibe_rd_source_intake_invocation_custody::SourceInvocationCustodyError::Unavailable => {
            ProductEdgeError::Unavailable
        }
        vibe_rd_source_intake_invocation_custody::SourceInvocationCustodyError::Storage(
            message,
        ) => ProductEdgeError::Storage(message),
    }
}
fn authority(error: OperatorAuthorizationError) -> ProductEdgeError {
    match error {
        OperatorAuthorizationError::ConflictingReplay => ProductEdgeError::ConflictingReplay,
        OperatorAuthorizationError::InvalidProposal(_)
        | OperatorAuthorizationError::Unavailable => ProductEdgeError::Unavailable,
        OperatorAuthorizationError::Storage(message) => ProductEdgeError::Storage(message),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        str::FromStr,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    use super::*;
    use rstest::rstest;
    use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
    use vibe_operator_authorization::{
        ExpiredManifestRecoveryEpochV1, ExpiredManifestRecoveryTransitionV1,
        OperationManifestBindingV1, OperatorAuthorizationExpiredManifestRecoveryProposalV1,
        OperatorAuthorizationIssuanceProposalV1, OperatorAuthorizationIssuerPostgresV1,
        OperatorAuthorizationRevocationProposalV1, OperatorAuthorizationScopeV1,
        OperatorAuthorizationSuccessorIssuanceProposalV1, PORTFOLIO_OWNER_AUDIENCE_V1,
        PORTFOLIO_VIEW_PERMISSION_V1, PortfolioResourceGrantContentV1,
        PortfolioResourceGrantIssuanceProposalV1, PortfolioResourceGrantRevocationProposalV1,
        PortfolioResourceGrantSuccessorProposalV1, PortfolioResourceModeV1, PortfolioResourceV1,
        ProductEdgeManifestBindingV1,
    };
    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    #[rstest]
    fn expired_manifest_recovery_schema_preparation_is_exactly_bounded() {
        assert_eq!(EXPIRED_MANIFEST_RECOVERY_SCHEMA_STATEMENTS.len(), 3);
        assert!(
            EXPIRED_MANIFEST_RECOVERY_SCHEMA_STATEMENTS
                .iter()
                .all(|statement| {
                    statement.contains("public.product_edge_expired_manifest_recoveries_v1")
                })
        );
        assert_eq!(
            EXPIRED_MANIFEST_RECOVERY_SCHEMA_STATEMENTS
                .map(|statement| { statement.split_ascii_whitespace().next().unwrap() }),
            ["CREATE", "ALTER", "REVOKE"]
        );
        assert_eq!(
            EXPIRED_MANIFEST_RECOVERY_SCHEMA_STATEMENTS[1],
            "ALTER TABLE public.product_edge_expired_manifest_recoveries_v1 OWNER TO product_edge_owner"
        );
        assert!(
            !EXPIRED_MANIFEST_RECOVERY_SCHEMA_STATEMENTS
                .iter()
                .any(|statement| statement.starts_with("UPDATE "))
        );
        assert!(VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.starts_with("SELECT "));
        assert!(VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.contains("namespace.nspname = 'public'"));
        assert!(
            VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA
                .contains("relation.relname = 'product_edge_expired_manifest_recoveries_v1'")
        );
        assert!(VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.contains("pg_catalog.pg_attribute"));
        assert!(VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.contains("pg_catalog.count(*) = 6"));
        assert!(VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.contains("pg_catalog.pg_constraint"));
        assert!(VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.contains(
            "FOREIGN KEY (predecessor_binding_identity) REFERENCES product_edge_deployment_bindings_v1(binding_identity)"
        ));
        assert!(VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.contains(
            "FOREIGN KEY (successor_binding_identity) REFERENCES product_edge_deployment_bindings_v1(binding_identity)"
        ));
        assert!(!VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.contains(" UPDATE "));
        assert!(!VERIFY_EXPIRED_MANIFEST_RECOVERY_SCHEMA.contains(" ALTER "));
    }

    #[tokio::test]
    #[ignore = "requires the disposable canonical OA/PE PostgreSQL topology"]
    async fn expired_manifest_recovery_sidecars_reject_unknown_constraints_without_catalog_mutation()
     {
        async fn catalog_fingerprint(pool: &PgPool, relation_name: &str) -> serde_json::Value {
            sqlx::query_scalar(
                "SELECT pg_catalog.jsonb_build_object(\
                   'owner', relation.relowner,\
                   'acl', COALESCE(relation.relacl::pg_catalog.text, ''),\
                   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(attribute.attname, attribute.atttypid::pg_catalog.text, attribute.attnotnull, attribute.atthasdef, attribute.attidentity, attribute.attgenerated) ORDER BY attribute.attnum) FROM pg_catalog.pg_attribute attribute WHERE attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped),\
                   'constraints', (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(constraint_entry.oid,true) ORDER BY pg_catalog.pg_get_constraintdef(constraint_entry.oid,true)), '[]'::pg_catalog.jsonb) FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=relation.oid)\
                 ) FROM pg_catalog.pg_class relation WHERE relation.oid=pg_catalog.to_regclass($1)",
            )
            .bind(relation_name)
            .fetch_one(pool)
            .await
            .unwrap()
        }

        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        let trust = ProductEdgeAuthorizationTrustV1 {
            issuer_identity: "operator-authorization-issuer-test-v1".into(),
            issuer_key_version: "test-key-v1".into(),
            audience: "R_AND_D".into(),
        };
        let _issuer = OperatorAuthorizationIssuerPostgresV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
        )
        .await
        .unwrap();
        let _owner = ProductEdgePostgresOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
            "schema-verification-probe-v1",
            trust.clone(),
        )
        .await
        .unwrap();
        let oa_pool = mutation.pool(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter);
        let pe_pool = mutation.pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner);

        sqlx::query("DROP TABLE operator_authorization_private.operator_authorization_expired_manifest_recoveries_v1")
            .execute(oa_pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE operator_authorization_private.operator_authorization_expired_manifest_recoveries_v1 (recovery_epoch_identity TEXT NOT NULL, recovery_epoch_digest TEXT NOT NULL, predecessor_authorization_identity TEXT NOT NULL, successor_authorization_identity TEXT NOT NULL, recovery_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)")
            .execute(oa_pool)
            .await
            .unwrap();
        sqlx::query("DROP TABLE public.product_edge_expired_manifest_recoveries_v1")
            .execute(pe_pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE public.product_edge_expired_manifest_recoveries_v1 (recovery_epoch_identity TEXT NOT NULL, recovery_epoch_digest TEXT NOT NULL, predecessor_binding_identity TEXT NOT NULL, successor_binding_identity TEXT NOT NULL, recovery_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL)")
            .execute(pe_pool)
            .await
            .unwrap();

        let before_oa = catalog_fingerprint(
            oa_pool,
            "operator_authorization_private.operator_authorization_expired_manifest_recoveries_v1",
        )
        .await;
        let before_pe = catalog_fingerprint(
            pe_pool,
            "public.product_edge_expired_manifest_recoveries_v1",
        )
        .await;
        assert!(matches!(
            OperatorAuthorizationIssuerPostgresV1::connect_for_expired_manifest_recovery(
                test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
            )
            .await,
            Err(OperatorAuthorizationError::Unavailable)
        ));
        assert!(matches!(
            ProductEdgePostgresOwnerV1::connect_for_expired_manifest_recovery(
                test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
                "schema-verification-probe-v1",
                trust,
            )
            .await,
            Err(ProductEdgeError::Unavailable)
        ));
        assert_eq!(
            catalog_fingerprint(
                oa_pool,
                "operator_authorization_private.operator_authorization_expired_manifest_recoveries_v1",
            )
            .await,
            before_oa,
            "failed OA sidecar verification must roll back owner and ACL changes"
        );
        assert_eq!(
            catalog_fingerprint(
                pe_pool,
                "public.product_edge_expired_manifest_recoveries_v1",
            )
            .await,
            before_pe,
            "failed Product Edge sidecar verification must roll back owner and ACL changes"
        );
    }

    #[rstest]
    fn artifact_build_effects_are_exact_and_ordered() {
        let exact = ARTIFACT_BUILD_REQUIRED_EFFECTS_V1
            .iter()
            .map(|effect| (*effect).to_string())
            .collect::<Vec<_>>();
        assert!(has_exact_artifact_build_effects(&exact));

        for refuting in [
            vec![],
            vec!["R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string()],
            vec!["R_AND_D_PROVIDER_INVOCATION_V1".to_string()],
            vec![
                "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
                "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
            ],
            vec![
                "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
            ],
            vec![
                "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
                "EXTRA_EFFECT_V1".to_string(),
            ],
        ] {
            assert!(!has_exact_artifact_build_effects(&refuting));
        }
    }

    #[rstest]
    fn manifest_and_binding_validity_are_half_open() {
        let manifest = AgentOperationManifestProposalV1 {
            operation: "artifact_build.submit_or_resolve.v1".to_string(),
            operation_schema: "rd-artifact-build-request-v1".to_string(),
            target_owner: "R_AND_D".to_string(),
            allowed_effects: vec!["R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string()],
            prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
            capability_policy_digest: format!("sha256:{}", "a".repeat(64)),
            effective_from_epoch_ms: 100,
            valid_through_epoch_ms: 200,
        };
        assert!(matches!(
            require_manifest_covers_binding(&manifest, 100, 200, 99),
            Err(ProductEdgeError::Unavailable)
        ));
        assert!(require_manifest_covers_binding(&manifest, 100, 200, 100).is_ok());
        assert!(matches!(
            require_manifest_covers_binding(&manifest, 100, 200, 200),
            Err(ProductEdgeError::Unavailable)
        ));
        assert!(matches!(
            require_manifest_covers_binding(&manifest, 99, 200, 100),
            Err(ProductEdgeError::Unavailable)
        ));
        assert!(matches!(
            require_manifest_covers_binding(&manifest, 100, 201, 100),
            Err(ProductEdgeError::Unavailable)
        ));
    }

    #[rstest]
    fn recovery_capability_evolution_is_explicit_and_fail_closed() {
        let manifest =
            |operation: &str, from: u64, through: u64| AgentOperationManifestProposalV1 {
                operation: operation.into(),
                operation_schema: format!("{operation}-schema"),
                target_owner: "R_AND_D".into(),
                allowed_effects: vec!["R_AND_D_MUTATION_V1".into()],
                prohibited_effects: ADDED_MANIFEST_PROHIBITED_FLOOR_V1
                    .iter()
                    .map(|effect| (*effect).to_string())
                    .collect(),
                capability_policy_digest: "policy-v2".into(),
                effective_from_epoch_ms: from,
                valid_through_epoch_ms: through,
            };
        let binding = |manifest: &AgentOperationManifestProposalV1| OperationManifestBindingV1 {
            manifest_identity: manifest.manifest_identity().unwrap(),
            manifest_digest: manifest.manifest_digest().unwrap(),
        };
        let retained_old = manifest("alpha.retained", 10, 20);
        let retained_new = manifest("alpha.retained", 20, 30);
        assert!(retained_manifest_is_non_widening(
            &retained_old,
            &retained_new,
            20
        ));
        let mut widened = retained_new.clone();
        widened.allowed_effects.push("R_AND_D_WRITE_V2".into());
        assert!(!retained_manifest_is_non_widening(
            &retained_old,
            &widened,
            20
        ));
        let mut weakened = retained_new.clone();
        weakened.prohibited_effects.remove(0);
        assert!(!retained_manifest_is_non_widening(
            &retained_old,
            &weakened,
            20
        ));

        let added = manifest("gamma.added", 20, 30);
        assert!(added_manifest_is_bounded(&added));
        let mut missing_floor = added.clone();
        missing_floor.prohibited_effects.remove(0);
        assert!(!added_manifest_is_bounded(&missing_floor));
        let mut live_target = added.clone();
        live_target.target_owner = "LIVE_EXECUTION".into();
        assert!(!added_manifest_is_bounded(&live_target));
        let mut trading_effect = added.clone();
        trading_effect.allowed_effects = vec!["LIVE_TRADING_V1".into()];
        assert!(!added_manifest_is_bounded(&trading_effect));

        let removed = manifest("beta.removed", 10, 20);
        let epoch = ExpiredManifestRecoveryEpochV1::new(vec![
            ExpiredManifestRecoveryTransitionV1::Retained {
                semantic_key: retained_old.semantic_key(),
                predecessor_manifest: binding(&retained_old),
                successor_manifest: binding(&retained_new),
            },
            ExpiredManifestRecoveryTransitionV1::Removed {
                semantic_key: removed.semantic_key(),
                predecessor_manifest: binding(&removed),
            },
            ExpiredManifestRecoveryTransitionV1::Added {
                semantic_key: added.semantic_key(),
                successor_manifest: binding(&added),
            },
        ])
        .unwrap();
        let proposal = ProductEdgeSuccessorProposalV1 {
            deployment_identity: "deployment-1".into(),
            binding_identity: "binding-2".into(),
            predecessor_binding_identity: "binding-1".into(),
            expected_history_head: "binding-1".into(),
            generation: 2,
            effective_principal: "principal-1".into(),
            scope_policy_version: "scope-v1".into(),
            capability_policy_version: "policy-v2".into(),
            audit_policy_version: "audit-v1".into(),
            valid_from_epoch_ms: 20,
            valid_through_epoch_ms: 30,
            authorization: OperatorAuthorizationLocatorV1 {
                authorization_identity: "authorization-2".into(),
                issuance_receipt_identity: "receipt-2".into(),
            },
            manifests: vec![retained_new, added],
        };
        assert!(recovery_capability_policy_is_valid(
            "policy-v1",
            &proposal,
            &epoch
        ));
        let mut mismatched = proposal;
        mismatched.manifests[0].capability_policy_digest = "other-policy".into();
        assert!(!recovery_capability_policy_is_valid(
            "policy-v1",
            &mismatched,
            &epoch
        ));
    }

    #[rstest]
    fn final_cut_revalidation_blocks_write_when_wait_crosses_expiry() {
        assert!(authority_windows_are_current_at(
            199, 100, 200, 100, 200, true
        ));
        assert!(
            !authority_windows_are_current_at(200, 100, 200, 100, 200, true),
            "equality at the half-open boundary must authorize zero write"
        );
        assert!(
            !authority_windows_are_current_at(199, 100, 200, 100, 200, false),
            "an authorization that expires while locks are held must authorize zero write"
        );
    }

    #[rstest]
    fn artifact_transport_cannot_supply_owner_evidence_or_freshness() {
        let payload = serde_json::json!({
            "build_request_identity": "build-1",
            "attempt_identity": "attempt-1",
            "intent_identity": "intent-1",
            "channel": "WINDMILL_PRODUCT_EDGE",
        });
        assert!(serde_json::from_value::<ArtifactBuildAdmissionPayloadV1>(payload.clone()).is_ok());
        for field in ["evidence_digest", "valid_through_epoch_ms", "fresh"] {
            let mut forged = payload.clone();
            forged[field] = serde_json::json!(true);
            assert!(serde_json::from_value::<ArtifactBuildAdmissionPayloadV1>(forged).is_err());
        }
    }

    #[rstest]
    fn source_intake_gateway_is_one_fixed_product_edge_authority() {
        let payload = serde_json::json!({
            "request_identity": "source-request-1",
            "gateway": "WINDMILL_PRODUCT_EDGE",
            "normalized_doi": "10.1234/source",
            "interpretation": {
                "bounded_explanation": "bounded",
                "plausible_alternatives": ["alternative"],
                "differentiating_prediction": "prediction",
                "falsifier": "falsifier"
            }
        });
        assert!(serde_json::from_value::<SourceIntakeAdmissionPayloadV1>(payload.clone()).is_ok());
        for legacy in ["WORKBENCH_WEB", "WORKBENCH_MCP"] {
            let mut legacy_payload = payload.clone();
            legacy_payload.as_object_mut().unwrap().remove("gateway");
            legacy_payload["channel"] = serde_json::json!(legacy);
            assert!(
                serde_json::from_value::<SourceIntakeAdmissionPayloadV1>(legacy_payload).is_err()
            );
        }
    }

    #[rstest]
    fn sealed_research_evidence_digest_binds_every_freshness_relation() {
        let evidence = StoredCurrentResearchEvidenceV1 {
            schema_version: 1,
            evidence_identity: "evidence-1".into(),
            request_identity: "research-1".into(),
            semantic_digest: "sha256:research".into(),
            source_admission: ProductEdgeAdmissionLocatorV1 {
                request_identity: "research-1".into(),
                admission_identity: "admission-1".into(),
                admission_digest: "sha256:admission".into(),
            },
            effective_principal: "principal-1".into(),
            authorized_scope: vec!["research:submit".into()],
            receipt_identity: "receipt-1".into(),
            intent_identity: "intent-1".into(),
            view_identity: "view-1".into(),
            projection_at_epoch_ms: 100,
            valid_through_epoch_ms: 200,
        };
        let digest = current_research_artifact_evidence_digest(&evidence).unwrap();
        let mut expired = evidence.clone();
        expired.valid_through_epoch_ms = 199;
        assert_ne!(
            current_research_artifact_evidence_digest(&expired).unwrap(),
            digest
        );
        let mut malformed = serde_json::to_value(evidence).unwrap();
        malformed["caller_authority"] = serde_json::json!(true);
        assert!(serde_json::from_value::<StoredCurrentResearchEvidenceV1>(malformed).is_err());
    }

    fn policy_binding(generation: u64, predecessor: Option<&str>) -> StoredBindingV1 {
        StoredBindingV1 {
            schema_version: 1,
            deployment_identity: "deployment-1".to_string(),
            binding_identity: format!("binding-{generation}"),
            generation,
            predecessor_binding_identity: predecessor.map(str::to_string),
            effective_principal: "principal-1".to_string(),
            authorized_scope: vec!["research:submit".to_string()],
            scope_policy_version: "scope-v1".to_string(),
            capability_policy_version: "capability-v1".to_string(),
            audit_policy_version: "audit-v1".to_string(),
            valid_from_epoch_ms: generation * 100,
            valid_through_epoch_ms: 10_000,
            authorization: OperatorAuthorizationLocatorV1 {
                authorization_identity: format!("authorization-{generation}"),
                issuance_receipt_identity: format!("issuance-{generation}"),
            },
            authorization_frontier_identity: format!("frontier-{generation}"),
            manifest_identities: vec!["manifest-1".to_string()],
            binding_digest: format!("sha256:binding-{generation}"),
            committed_at_epoch_ms: generation * 100,
            recovery_epoch: None,
        }
    }

    #[rstest]
    fn first_mutation_policy_accepts_only_immediate_equivalent_successor() {
        let admitted = policy_binding(1, None);
        let second = policy_binding(2, Some("binding-1"));
        let third = policy_binding(3, Some("binding-2"));
        assert!(matches!(
            policy_equivalent_chain_head(&admitted, &[second.clone(), third.clone()]),
            Err(ProductEdgeError::Unavailable)
        ));
        assert_eq!(
            policy_equivalent_chain_head(&admitted, std::slice::from_ref(&second))
                .unwrap()
                .binding_identity,
            "binding-2"
        );

        let mut broken = third.clone();
        broken.predecessor_binding_identity = Some("binding-1".to_string());
        assert!(matches!(
            policy_equivalent_chain_head(&admitted, &[second.clone(), broken]),
            Err(ProductEdgeError::Unavailable)
        ));

        let mut drifted = third;
        drifted.authorized_scope.push("research:other".to_string());
        assert!(matches!(
            policy_equivalent_chain_head(&admitted, &[second, drifted]),
            Err(ProductEdgeError::Unavailable)
        ));
    }

    fn invocation_admission_receipt() -> StoredInvocationAdmissionReceiptV1 {
        StoredInvocationAdmissionReceiptV1 {
            schema_version: 1,
            receipt_identity: "invocation-admission-1".to_string(),
            receipt_digest: String::new(),
            request_identity: "request-1".to_string(),
            admission_identity: "admission-1".to_string(),
            admission_digest: "sha256:admission".to_string(),
            historical_binding_identity: "binding-1".to_string(),
            historical_binding_generation: 1,
            historical_authorization_identity: "authorization-expired".to_string(),
            historical_issuance_receipt_identity: "issuance-expired".to_string(),
            historical_authorization_frontier_identity: "frontier-historical".to_string(),
            current_binding_identity: "binding-2".to_string(),
            current_binding_generation: 2,
            current_authorization_identity: "authorization-current".to_string(),
            current_issuance_receipt_identity: "issuance-current".to_string(),
            current_authorization_frontier_identity: "frontier-current".to_string(),
            current_authorization_not_before_epoch_ms: 100,
            current_authorization_valid_through_epoch_ms: 200,
            current_binding_valid_from_epoch_ms: 100,
            current_binding_valid_through_epoch_ms: 200,
            effective_principal: "principal-1".to_string(),
            authorized_scope: vec!["research:submit".to_string()],
            scope_policy_version: "scope-v1".to_string(),
            capability_policy_version: "capability-v1".to_string(),
            audit_policy_version: "audit-v1".to_string(),
            manifest_identity: "manifest-1".to_string(),
            manifest_digest: "sha256:manifest".to_string(),
            manifest_effective_from_epoch_ms: 100,
            manifest_valid_through_epoch_ms: 200,
            attempt_identity: "attempt-1".to_string(),
            effect: "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
            claim_identity: "claim-1".to_string(),
            write_cut_epoch_ms: 199,
        }
    }

    #[rstest]
    fn invocation_admission_receipt_seals_distinct_historical_and_current_frontiers() {
        let mut receipt = invocation_admission_receipt();
        receipt.receipt_digest = invocation_admission_receipt_digest(&receipt).unwrap();
        assert_ne!(
            receipt.historical_authorization_identity, receipt.current_authorization_identity,
            "an expired historical lineage may be recovered only through distinct current evidence"
        );
        assert!(authority_windows_are_current_at(
            199, 100, 200, 100, 200, true
        ));
        assert!(
            !authority_windows_are_current_at(200, 100, 200, 100, 200, true),
            "the final locked write cut at expiry must authorize zero write"
        );

        let sealed_digest = receipt.receipt_digest.clone();
        receipt.current_authorization_frontier_identity = "frontier-revoked".to_string();
        assert_ne!(
            invocation_admission_receipt_digest(&receipt).unwrap(),
            sealed_digest,
            "current-frontier tampering must fail the sealed receipt digest"
        );

        let mut malformed = serde_json::to_value(invocation_admission_receipt()).unwrap();
        malformed["caller_asserted_authority"] = serde_json::json!(true);
        assert!(from_json::<StoredInvocationAdmissionReceiptV1>(malformed).is_err());
        let mut missing = serde_json::to_value(invocation_admission_receipt()).unwrap();
        missing
            .as_object_mut()
            .unwrap()
            .remove("current_authorization_frontier_identity");
        assert!(from_json::<StoredInvocationAdmissionReceiptV1>(missing).is_err());
    }

    async fn authority_table_fingerprint(pool: &PgPool) -> String {
        let value: serde_json::Value = sqlx::query_scalar(
            "SELECT jsonb_build_object(
              'authorization_issuances', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.authorization_identity) FROM operator_authorization_private.operator_authorization_issuances_v1 row), '[]'::jsonb),
              'authorization_frontiers', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.frontier_identity) FROM operator_authorization_private.operator_authorization_revocation_frontiers_v1 row), '[]'::jsonb),
              'authorization_heads', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.scope_digest) FROM operator_authorization_private.operator_authorization_revocation_heads_v1 row), '[]'::jsonb),
              'grant_issuances', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.grant_identity) FROM operator_authorization_private.portfolio_resource_grant_issuances_v1 row), '[]'::jsonb),
              'grant_frontiers', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.frontier_identity) FROM operator_authorization_private.portfolio_resource_grant_revocation_frontiers_v1 row), '[]'::jsonb),
              'grant_heads', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.resource_digest) FROM operator_authorization_private.portfolio_resource_grant_revocation_heads_v1 row), '[]'::jsonb),
              'authorization_outbox', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.event_identity) FROM operator_authorization_private.operator_authorization_owner_outbox_v1 row), '[]'::jsonb),
              'grant_outbox', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.event_identity) FROM operator_authorization_private.portfolio_resource_grant_owner_outbox_v1 row), '[]'::jsonb)
            )",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        canonical_digest("product-edge.test-authority-table-fingerprint.v1", &value).unwrap()
    }

    async fn product_edge_table_fingerprint(pool: &PgPool) -> String {
        let value: serde_json::Value = sqlx::query_scalar(
            "SELECT jsonb_build_object(
              'manifests', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.manifest_identity) FROM product_edge_operation_manifests_v1 row), '[]'::jsonb),
              'bindings', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.binding_identity) FROM product_edge_deployment_bindings_v1 row), '[]'::jsonb),
              'binding_manifests', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.binding_identity, row.manifest_identity) FROM product_edge_binding_manifests_v1 row), '[]'::jsonb),
              'heads', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.deployment_identity) FROM product_edge_deployment_heads_v1 row), '[]'::jsonb),
              'supersessions', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.binding_identity) FROM product_edge_deployment_supersessions_v1 row), '[]'::jsonb),
              'admissions', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.request_identity) FROM product_edge_request_admissions_v1 row), '[]'::jsonb),
              'outbox', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.event_identity) FROM product_edge_owner_outbox_v1 row), '[]'::jsonb)
            )",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        canonical_digest("product-edge.test-owner-table-fingerprint.v1", &value).unwrap()
    }

    async fn isolated_portfolio_owner_pool(
        test_database: &CanonicalOwnerPostgresTestDatabaseV1,
    ) -> PgPool {
        let options = PgConnectOptions::from_str(
            test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
        )
        .unwrap()
        .username("postgres");
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .after_connect(|connection, _| {
                Box::pin(async move {
                    sqlx::query("SET SESSION AUTHORIZATION portfolio_owner")
                        .execute(connection)
                        .await?;
                    Ok(())
                })
            })
            .connect_with(options)
            .await
            .unwrap();
        let identity: (String, String) =
            sqlx::query_as("SELECT current_user::text, session_user::text")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            identity,
            ("portfolio_owner".into(), "portfolio_owner".into())
        );
        pool
    }

    async fn exercise_portfolio_read_policy_consumer(
        test_database: &CanonicalOwnerPostgresTestDatabaseV1,
    ) {
        use std::sync::Arc;

        let mutation = test_database.mutation();
        let issuer = Arc::new(
            OperatorAuthorizationIssuerPostgresV1::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
            )
            .await
            .unwrap(),
        );
        let oa_pool = mutation.pool(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter);
        let pe_pool = mutation.pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
        let portfolio_pool = isolated_portfolio_owner_pool(test_database).await;
        let role_boundary: (bool, bool) = sqlx::query_as(
            "SELECT pg_has_role('product_edge_owner', 'portfolio_owner', 'MEMBER'), rolcanlogin FROM pg_roles WHERE rolname='portfolio_owner'",
        )
        .fetch_one(pe_pool)
        .await
        .unwrap();
        assert_eq!(role_boundary, (false, false));
        let mut denied_role = pe_pool.begin().await.unwrap();
        assert!(
            sqlx::query("SET LOCAL ROLE portfolio_owner")
                .execute(&mut *denied_role)
                .await
                .is_err(),
            "Product Edge Owner must not assume Portfolio Owner"
        );
        denied_role.rollback().await.unwrap();
        let suffix = format!("portfolio-read-{}", unique_suffix());
        let now = now_ms().unwrap();
        let principal = format!("portfolio-principal-{suffix}");
        let manifest = AgentOperationManifestProposalV1 {
            operation: PORTFOLIO_READ_POLICY_OPERATION_V1.into(),
            operation_schema: PORTFOLIO_READ_POLICY_OPERATION_SCHEMA_V1.into(),
            target_owner: PORTFOLIO_READ_POLICY_TARGET_OWNER_V1.into(),
            allowed_effects: vec![PORTFOLIO_READ_ONLY_EFFECT_POLICY_V1.into()],
            prohibited_effects: vec![
                "DEPLOYMENT_V1".into(),
                "EXECUTION_V1".into(),
                "ORDER_V1".into(),
                "PORTFOLIO_MUTATION_V1".into(),
                "PROVIDER_EFFECT_V1".into(),
                "REAL_TRADING_V1".into(),
                "WINDMILL_WRITE_V1".into(),
            ],
            capability_policy_digest: format!("sha256:{}", "e".repeat(64)),
            effective_from_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(3_600_000),
        };
        let manifest_binding = ProductEdgeManifestBindingV1 {
            manifest_locator: manifest.manifest_identity().unwrap(),
            manifest_digest: manifest.manifest_digest().unwrap(),
        };
        let authorization = issuer
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("portfolio-policy-authorization-{suffix}"),
                issuer_identity: "operator-authorization-issuer-test-v1".into(),
                issuer_key_version: "test-key-v1".into(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: principal.clone(),
                    audience: "PRODUCT_EDGE".into(),
                    permissions: vec![PORTFOLIO_VIEW_PERMISSION_V1.into()],
                },
                request_proof_digest: "sha256:portfolio-read-proof".into(),
                operation_manifests: vec![OperationManifestBindingV1 {
                    manifest_identity: manifest_binding.manifest_locator.clone(),
                    manifest_digest: manifest_binding.manifest_digest.clone(),
                }],
                not_before_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
                expected_revocation_head: "EMPTY".into(),
            })
            .await
            .unwrap();
        let resource = PortfolioResourceV1 {
            principal: principal.clone(),
            audience: PORTFOLIO_OWNER_AUDIENCE_V1.into(),
            permission: PORTFOLIO_VIEW_PERMISSION_V1.into(),
            account_identity: format!("account-{suffix}"),
            execution_scope_identity: format!("execution-scope-{suffix}"),
            mode: PortfolioResourceModeV1::Paper,
        };
        let grant_content = PortfolioResourceGrantContentV1 {
            issuer_identity: "operator-authorization-owner-test-v1".into(),
            issuer_key_version: "test-key-v1".into(),
            resource: resource.clone(),
            product_edge_manifest: manifest_binding.clone(),
            effective_at_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(3_600_000),
        };
        let genesis_grant = issuer
            .issue_portfolio_resource_grant_genesis(PortfolioResourceGrantIssuanceProposalV1 {
                grant_identity: grant_content.grant_identity().unwrap(),
                content: grant_content.clone(),
                expected_revocation_frontier_identity: "EMPTY".into(),
            })
            .await
            .unwrap();
        let mut successor_content = grant_content.clone();
        successor_content.valid_through_epoch_ms = successor_content
            .valid_through_epoch_ms
            .saturating_add(1_000);
        let current_frontier = genesis_grant.frontier().frontier_identity().to_string();
        let successor_grant = issuer
            .issue_portfolio_resource_grant_successor(PortfolioResourceGrantSuccessorProposalV1 {
                predecessor: genesis_grant.locator(),
                expected_current_frontier_identity: current_frontier.clone(),
                successor: PortfolioResourceGrantIssuanceProposalV1 {
                    grant_identity: successor_content.grant_identity().unwrap(),
                    content: successor_content.clone(),
                    expected_revocation_frontier_identity: current_frontier,
                },
            })
            .await
            .unwrap();
        let (grant, bound_grant_content, earlier_grant) =
            if genesis_grant.locator().grant_identity < successor_grant.locator().grant_identity {
                (successor_grant, successor_content, genesis_grant)
            } else {
                (genesis_grant, grant_content, successor_grant)
            };
        assert!(earlier_grant.locator().grant_identity < grant.locator().grant_identity);
        let deployment = format!("portfolio-policy-deployment-{suffix}");
        let owner = ProductEdgePostgresOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
            &deployment,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: "operator-authorization-issuer-test-v1".into(),
                issuer_key_version: "test-key-v1".into(),
                audience: "PRODUCT_EDGE".into(),
            },
        )
        .await
        .unwrap();
        owner
            .bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
                deployment_identity: deployment,
                binding_identity: format!("portfolio-policy-binding-{suffix}"),
                expected_history_head: "EMPTY".into(),
                generation: 1,
                effective_principal: principal,
                scope_policy_version: "portfolio-scope-v1".into(),
                capability_policy_version: "portfolio-capability-v1".into(),
                audit_policy_version: "portfolio-audit-v1".into(),
                valid_from_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
                authorization: authorization.locator(),
                manifests: vec![manifest],
            })
            .await
            .unwrap();
        let payload = PortfolioReadPolicyPayloadV1 {
            schema_version: PORTFOLIO_READ_POLICY_SCHEMA_V1,
            resource: bound_grant_content.resource,
            grant: grant.locator(),
            manifest: bound_grant_content.product_edge_manifest,
            allowed_object_classes: vec![
                crate::PortfolioReadObjectClassV1::Account,
                crate::PortfolioReadObjectClassV1::Exposure,
                crate::PortfolioReadObjectClassV1::GrossCapacityView,
                crate::PortfolioReadObjectClassV1::Performance,
            ],
            effect_policy: crate::PortfolioReadEffectPolicyV1::ReadOnlyNoWritesNoEffects,
        };
        let request_identity = format!("portfolio-policy-request-{suffix}");
        let admission_request = ProductEdgeAdmissionRequestV1 {
            request_identity,
            typed_payload: serde_json::to_value(&payload).unwrap(),
            operation: PORTFOLIO_READ_POLICY_OPERATION_V1.into(),
            operation_schema: PORTFOLIO_READ_POLICY_OPERATION_SCHEMA_V1.into(),
            target_owner: PORTFOLIO_READ_POLICY_TARGET_OWNER_V1.into(),
            requested_effects: vec![PORTFOLIO_READ_ONLY_EFFECT_POLICY_V1.into()],
            request_proof_digest: "sha256:portfolio-read-proof".into(),
            audit_correlation: format!("portfolio-read:{suffix}"),
        };
        let semantic_digest = admission_request.semantic_digest().unwrap();
        let admission = owner.admit_request(admission_request).await.unwrap();
        let request = PortfolioReadPolicyRequestV1 {
            admission: admission.locator().clone(),
            grant: grant.locator(),
            expected_request_semantic_digest: semantic_digest,
            expected_policy_digest: payload.policy_digest().unwrap(),
        };

        let function_catalog: (String, bool, String, String, bool, Option<Vec<String>>) =
            sqlx::query_as("SELECT role.rolname, procedure.prosecdef, procedure.provolatile::text, procedure.proparallel::text, procedure.proisstrict, procedure.proconfig FROM pg_proc procedure JOIN pg_roles role ON role.oid=procedure.proowner WHERE procedure.oid=to_regprocedure('product_edge_api.lock_portfolio_read_policy_v1(text,text,text,text,text)')")
                .fetch_one(pe_pool).await.unwrap();
        assert_eq!(function_catalog.0, "product_edge_owner");
        assert!(function_catalog.1 && function_catalog.4);
        assert_eq!(
            (function_catalog.2.as_str(), function_catalog.3.as_str()),
            ("v", "u")
        );
        assert_eq!(
            function_catalog.5,
            Some(vec!["search_path=pg_catalog".into()])
        );

        for (role, wrapper, generic, direct_oa) in [
            ("portfolio_owner", true, false, false),
            ("rd_owner", false, true, false),
            ("operator_authorization_writer", false, false, true),
        ] {
            let observed: (bool, bool, bool) = sqlx::query_as(
                "SELECT has_function_privilege($1::name, 'product_edge_api.lock_portfolio_read_policy_v1(text,text,text,text,text)', 'EXECUTE'), has_function_privilege($1::name, 'product_edge_api.lock_downstream_admission_v1(text,text,text)', 'EXECUTE'), has_function_privilege($1::name, 'operator_authorization_api.lock_current_portfolio_resource_grant_v1(text,text)', 'EXECUTE')",
            )
            .bind(role)
            .fetch_one(pe_pool)
            .await
            .unwrap();
            assert_eq!(
                observed,
                (wrapper, generic, direct_oa),
                "ACL drift for {role}"
            );
        }

        let before = (
            authority_table_fingerprint(oa_pool).await,
            product_edge_table_fingerprint(pe_pool).await,
        );

        for index in 0..7 {
            let mut mismatched = request.clone();
            match index {
                0 => mismatched.grant.grant_identity.push_str("-other"),
                1 => mismatched
                    .grant
                    .issuance_receipt_identity
                    .push_str("-other"),
                2 => mismatched.admission.request_identity.push_str("-other"),
                3 => mismatched.admission.admission_identity.push_str("-other"),
                4 => mutate_sha256(&mut mismatched.admission.admission_digest),
                5 => mutate_sha256(&mut mismatched.expected_request_semantic_digest),
                6 => mutate_sha256(&mut mismatched.expected_policy_digest),
                _ => unreachable!(),
            }
            let mut mismatch_consumer = portfolio_pool.begin().await.unwrap();
            assert!(matches!(
                resolve_portfolio_read_policy_in_transaction(&mut mismatch_consumer, &mismatched,)
                    .await,
                PortfolioReadPolicyResolutionV1::Unavailable { .. }
            ));
            mismatch_consumer.rollback().await.unwrap();
        }
        assert_eq!(
            (
                authority_table_fingerprint(oa_pool).await,
                product_edge_table_fingerprint(pe_pool).await,
            ),
            before,
            "caller locator and digest mismatches must write no Owner state"
        );

        let expiry_start = now_ms().unwrap();
        let expiry_at = expiry_start.saturating_add(900);
        let expiring_resource = PortfolioResourceV1 {
            account_identity: format!("expiring-account-{suffix}"),
            ..payload.resource.clone()
        };
        let expiring_content = PortfolioResourceGrantContentV1 {
            issuer_identity: "operator-authorization-owner-test-v1".into(),
            issuer_key_version: "test-key-v1".into(),
            resource: expiring_resource.clone(),
            product_edge_manifest: payload.manifest.clone(),
            effective_at_epoch_ms: expiry_start.saturating_sub(1_000),
            valid_through_epoch_ms: expiry_at,
        };
        let expiring_grant = issuer
            .issue_portfolio_resource_grant_genesis(PortfolioResourceGrantIssuanceProposalV1 {
                grant_identity: expiring_content.grant_identity().unwrap(),
                content: expiring_content,
                expected_revocation_frontier_identity: "EMPTY".into(),
            })
            .await
            .unwrap();
        let expiring_payload = PortfolioReadPolicyPayloadV1 {
            resource: expiring_resource,
            grant: expiring_grant.locator(),
            ..payload.clone()
        };
        let expiring_request_identity = format!("portfolio-policy-expiring-{suffix}");
        let expiring_admission_request = ProductEdgeAdmissionRequestV1 {
            request_identity: expiring_request_identity.clone(),
            typed_payload: serde_json::to_value(&expiring_payload).unwrap(),
            operation: PORTFOLIO_READ_POLICY_OPERATION_V1.into(),
            operation_schema: PORTFOLIO_READ_POLICY_OPERATION_SCHEMA_V1.into(),
            target_owner: PORTFOLIO_READ_POLICY_TARGET_OWNER_V1.into(),
            requested_effects: vec![PORTFOLIO_READ_ONLY_EFFECT_POLICY_V1.into()],
            request_proof_digest: "sha256:portfolio-read-proof".into(),
            audit_correlation: format!("portfolio-read-expiry:{suffix}"),
        };
        let expiring_semantic_digest = expiring_admission_request.semantic_digest().unwrap();
        let expiring_admission = owner
            .admit_request(expiring_admission_request)
            .await
            .unwrap();
        let expiring_request = PortfolioReadPolicyRequestV1 {
            admission: expiring_admission.locator().clone(),
            grant: expiring_grant.locator(),
            expected_request_semantic_digest: expiring_semantic_digest,
            expected_policy_digest: expiring_payload.policy_digest().unwrap(),
        };
        let expiry_fingerprint = (
            authority_table_fingerprint(oa_pool).await,
            product_edge_table_fingerprint(pe_pool).await,
        );
        let mut pe_blocker = pe_pool.begin().await.unwrap();
        sqlx::query(
            "SELECT request_identity FROM product_edge_request_admissions_v1 WHERE request_identity=$1 FOR UPDATE",
        )
        .bind(&expiring_request_identity)
        .fetch_one(&mut *pe_blocker)
        .await
        .unwrap();
        let expiring_pool = portfolio_pool.clone();
        let expiring_task = tokio::spawn(async move {
            let mut transaction = expiring_pool.begin().await.unwrap();
            let resolution =
                resolve_portfolio_read_policy_in_transaction(&mut transaction, &expiring_request)
                    .await;
            transaction.rollback().await.unwrap();
            resolution
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(
            !expiring_task.is_finished(),
            "consumer must wait on the PE lock"
        );
        let mut oa_probe = oa_pool.begin().await.unwrap();
        assert!(
            sqlx::query("SELECT grant_identity FROM operator_authorization_private.portfolio_resource_grant_issuances_v1 WHERE grant_identity=$1 FOR UPDATE NOWAIT")
                .bind(&expiring_grant.locator().grant_identity)
                .fetch_one(&mut *oa_probe)
                .await
                .is_err(),
            "OA grant must be locked before the PE wait"
        );
        oa_probe.rollback().await.unwrap();
        let remaining = expiry_at.saturating_sub(now_ms().unwrap());
        tokio::time::sleep(Duration::from_millis(remaining.saturating_add(50))).await;
        pe_blocker.rollback().await.unwrap();
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(5), expiring_task)
                .await
                .unwrap()
                .unwrap(),
            PortfolioReadPolicyResolutionV1::Unavailable {
                reason: PortfolioReadPolicyUnavailableReasonV1::PolicyNotCurrent
            }
        ));
        assert_eq!(
            (
                authority_table_fingerprint(oa_pool).await,
                product_edge_table_fingerprint(pe_pool).await,
            ),
            expiry_fingerprint,
            "post-lock expiry must write no Owner state"
        );
        let mut consumer = portfolio_pool.begin().await.unwrap();
        assert_eq!(
            sqlx::query_as::<_, (String, String)>("SELECT current_user::text, session_user::text",)
                .fetch_one(&mut *consumer)
                .await
                .unwrap(),
            ("portfolio_owner".into(), "portfolio_owner".into())
        );
        let direct_privileges: (bool, bool) = sqlx::query_as(
            "SELECT
              has_table_privilege(current_user, (SELECT class.oid FROM pg_class class JOIN pg_namespace namespace ON namespace.oid=class.relnamespace WHERE namespace.nspname='public' AND class.relname='product_edge_request_admissions_v1'), 'SELECT'),
              has_table_privilege(current_user, (SELECT class.oid FROM pg_class class JOIN pg_namespace namespace ON namespace.oid=class.relnamespace WHERE namespace.nspname='operator_authorization_private' AND class.relname='portfolio_resource_grant_issuances_v1'), 'SELECT')",
        )
        .fetch_one(&mut *consumer)
        .await
        .unwrap();
        assert_eq!(direct_privileges, (false, false));
        let resolution =
            resolve_portfolio_read_policy_in_transaction(&mut consumer, &request).await;
        let PortfolioReadPolicyResolutionV1::Sealed { custody } = resolution else {
            panic!("expected sealed Portfolio read-policy custody: {resolution:?}");
        };
        assert!(custody.is_current_at(custody.final_cut_epoch_ms()));
        assert_eq!(
            custody.source_owner_result(),
            PortfolioSourceOwnerResolveResultV1::SourceOwnerResolveUnavailable
        );

        let distinct_revoke = {
            let issuer = Arc::clone(&issuer);
            let locator = earlier_grant.locator();
            let frontier = custody.authorization_policy_cut().to_string();

            tokio::spawn(async move {
                issuer
                    .revoke_portfolio_resource_grant(PortfolioResourceGrantRevocationProposalV1 {
                        grant: locator,
                        expected_frontier_identity: frontier,
                        reason_code: "DISTINCT_GRANT_REVERSE_ORDER".into(),
                    })
                    .await
            })
        };
        assert!(
            tokio::time::timeout(Duration::from_millis(100), async {
                while !distinct_revoke.is_finished() {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .is_err(),
            "OA writer must wait on the Portfolio read of the later grant"
        );
        consumer.rollback().await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), distinct_revoke)
            .await
            .unwrap()
            .unwrap()
            .unwrap();

        let after_distinct_revoke = (
            authority_table_fingerprint(oa_pool).await,
            product_edge_table_fingerprint(pe_pool).await,
        );
        assert_ne!(expiry_fingerprint.0, after_distinct_revoke.0);
        assert_eq!(expiry_fingerprint.1, after_distinct_revoke.1);

        let mut current_consumer = portfolio_pool.begin().await.unwrap();
        let current_resolution =
            resolve_portfolio_read_policy_in_transaction(&mut current_consumer, &request).await;
        let PortfolioReadPolicyResolutionV1::Sealed {
            custody: current_custody,
        } = current_resolution
        else {
            panic!("the distinct-grant revoke must preserve bound grant custody");
        };
        assert!(current_custody.is_current_at(current_custody.final_cut_epoch_ms()));
        assert_eq!(
            (
                authority_table_fingerprint(oa_pool).await,
                product_edge_table_fingerprint(pe_pool).await,
            ),
            after_distinct_revoke,
            "the post-frontier Portfolio read must write no Owner state"
        );

        let bound_revoke = {
            let issuer = Arc::clone(&issuer);
            let locator = grant.locator();
            let frontier = current_custody.authorization_policy_cut().to_string();

            tokio::spawn(async move {
                issuer
                    .revoke_portfolio_resource_grant(PortfolioResourceGrantRevocationProposalV1 {
                        grant: locator,
                        expected_frontier_identity: frontier,
                        reason_code: "ADMIN_REVOKED".into(),
                    })
                    .await
            })
        };
        assert!(
            tokio::time::timeout(Duration::from_millis(100), async {
                while !bound_revoke.is_finished() {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .is_err(),
            "OA writer must wait while bound Portfolio custody holds its cut"
        );
        current_consumer.rollback().await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), bound_revoke)
            .await
            .unwrap()
            .unwrap()
            .unwrap();

        let after_bound_revoke = (
            authority_table_fingerprint(oa_pool).await,
            product_edge_table_fingerprint(pe_pool).await,
        );
        let mut revoked_consumer = portfolio_pool.begin().await.unwrap();
        assert!(matches!(
            resolve_portfolio_read_policy_in_transaction(&mut revoked_consumer, &request).await,
            PortfolioReadPolicyResolutionV1::Unavailable {
                reason: PortfolioReadPolicyUnavailableReasonV1::PolicyNotCurrent
            }
        ));
        revoked_consumer.rollback().await.unwrap();
        assert_eq!(
            (
                authority_table_fingerprint(oa_pool).await,
                product_edge_table_fingerprint(pe_pool).await,
            ),
            after_bound_revoke,
            "revoked resolve must write no OA or Product Edge table"
        );
        assert_ne!(after_distinct_revoke.0, after_bound_revoke.0);
        assert_eq!(after_distinct_revoke.1, after_bound_revoke.1);
    }

    #[tokio::test]
    #[ignore = "requires the disposable canonical OA/PE PostgreSQL topology"]
    async fn expired_manifest_recovery_rejoins_across_owners_and_preserves_old_rows() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        let mutation = test_database.mutation();
        let suffix = unique_suffix();
        let now = now_ms().unwrap();
        let expiry = now.saturating_add(500);
        let successor_expiry = expiry.saturating_add(600_000);
        let principal = format!("recovery-principal-{suffix}");
        let deployment = format!("recovery-deployment-{suffix}");
        let first_binding = format!("recovery-binding-1-{suffix}");
        let second_binding = format!("recovery-binding-2-{suffix}");
        let capability_digest = format!("sha256:{}", "a".repeat(64));
        let prohibited_floor = ADDED_MANIFEST_PROHIBITED_FLOOR_V1
            .iter()
            .map(|effect| (*effect).to_string())
            .collect::<Vec<_>>();
        let first_manifest = AgentOperationManifestProposalV1 {
            operation: "alpha.recovery.retained.v1".into(),
            operation_schema: "alpha-recovery-retained-v1".into(),
            target_owner: "R_AND_D".into(),
            allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".into()],
            prohibited_effects: prohibited_floor.clone(),
            capability_policy_digest: capability_digest.clone(),
            effective_from_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: expiry,
        };
        let mut second_manifest = first_manifest.clone();
        second_manifest.effective_from_epoch_ms = expiry;
        second_manifest.valid_through_epoch_ms = successor_expiry;
        let removed_manifest = AgentOperationManifestProposalV1 {
            operation: "beta.recovery.removed.v1".into(),
            operation_schema: "beta-recovery-removed-v1".into(),
            target_owner: "R_AND_D".into(),
            allowed_effects: vec!["R_AND_D_OLD_MUTATION_V1".into()],
            prohibited_effects: prohibited_floor.clone(),
            capability_policy_digest: capability_digest.clone(),
            effective_from_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: expiry,
        };
        let added_manifest = AgentOperationManifestProposalV1 {
            operation: "gamma.recovery.added.v1".into(),
            operation_schema: "gamma-recovery-added-v1".into(),
            target_owner: "R_AND_D".into(),
            allowed_effects: vec!["R_AND_D_S3_MUTATION_V1".into()],
            prohibited_effects: prohibited_floor,
            capability_policy_digest: capability_digest.clone(),
            effective_from_epoch_ms: expiry,
            valid_through_epoch_ms: successor_expiry,
        };
        let first_manifest_binding = OperationManifestBindingV1 {
            manifest_identity: first_manifest.manifest_identity().unwrap(),
            manifest_digest: first_manifest.manifest_digest().unwrap(),
        };
        let second_manifest_binding = OperationManifestBindingV1 {
            manifest_identity: second_manifest.manifest_identity().unwrap(),
            manifest_digest: second_manifest.manifest_digest().unwrap(),
        };
        let removed_manifest_binding = OperationManifestBindingV1 {
            manifest_identity: removed_manifest.manifest_identity().unwrap(),
            manifest_digest: removed_manifest.manifest_digest().unwrap(),
        };
        let added_manifest_binding = OperationManifestBindingV1 {
            manifest_identity: added_manifest.manifest_identity().unwrap(),
            manifest_digest: added_manifest.manifest_digest().unwrap(),
        };
        let epoch = ExpiredManifestRecoveryEpochV1::new(vec![
            ExpiredManifestRecoveryTransitionV1::Retained {
                semantic_key: first_manifest.semantic_key(),
                predecessor_manifest: first_manifest_binding.clone(),
                successor_manifest: second_manifest_binding.clone(),
            },
            ExpiredManifestRecoveryTransitionV1::Removed {
                semantic_key: removed_manifest.semantic_key(),
                predecessor_manifest: removed_manifest_binding.clone(),
            },
            ExpiredManifestRecoveryTransitionV1::Added {
                semantic_key: added_manifest.semantic_key(),
                successor_manifest: added_manifest_binding.clone(),
            },
        ])
        .unwrap();
        let mut first_manifest_bindings =
            vec![first_manifest_binding.clone(), removed_manifest_binding];
        first_manifest_bindings
            .sort_by(|left, right| left.manifest_identity.cmp(&right.manifest_identity));
        let mut first_manifests = vec![first_manifest.clone(), removed_manifest];
        first_manifests.sort_by_key(|manifest| manifest.manifest_identity().unwrap());
        let issuer = OperatorAuthorizationIssuerPostgresV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
        )
        .await
        .unwrap();
        let first_authorization = issuer
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("recovery-authorization-1-{suffix}"),
                issuer_identity: "operator-authorization-issuer-test-v1".into(),
                issuer_key_version: "test-key-v1".into(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: principal.clone(),
                    audience: "R_AND_D".into(),
                    permissions: vec!["research:submit".into()],
                },
                request_proof_digest: "sha256:recovery-proof".into(),
                operation_manifests: first_manifest_bindings,
                not_before_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: expiry,
                expected_revocation_head: "EMPTY".into(),
            })
            .await
            .unwrap();
        let owner = ProductEdgePostgresOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
            &deployment,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: "operator-authorization-issuer-test-v1".into(),
                issuer_key_version: "test-key-v1".into(),
                audience: "R_AND_D".into(),
            },
        )
        .await
        .unwrap();
        owner
            .bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
                deployment_identity: deployment.clone(),
                binding_identity: first_binding.clone(),
                expected_history_head: "EMPTY".into(),
                generation: 1,
                effective_principal: principal.clone(),
                scope_policy_version: "scope-v1".into(),
                capability_policy_version: "capability-v1".into(),
                audit_policy_version: "audit-v1".into(),
                valid_from_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: expiry,
                authorization: first_authorization.locator(),
                manifests: first_manifests,
            })
            .await
            .unwrap();
        let pe_pool = mutation.pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
        let old_rows: (serde_json::Value, serde_json::Value) = sqlx::query_as(
            "SELECT binding_json, (SELECT manifest_json FROM product_edge_operation_manifests_v1 WHERE manifest_identity=$2) FROM product_edge_deployment_bindings_v1 WHERE binding_identity=$1",
        )
        .bind(&first_binding)
        .bind(first_manifest.manifest_identity().unwrap())
        .fetch_one(pe_pool)
        .await
        .unwrap();
        let remaining = expiry.saturating_sub(now_ms().unwrap());
        tokio::time::sleep(Duration::from_millis(remaining.saturating_add(25))).await;

        let ordinary_authorization = OperatorAuthorizationSuccessorIssuanceProposalV1 {
            predecessor_authorization: first_authorization.locator(),
            expected_current_frontier_identity: first_authorization
                .frontier()
                .frontier_identity()
                .into(),
            successor: OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("ordinary-authorization-2-{suffix}"),
                valid_through_epoch_ms: successor_expiry,
                ..first_authorization_proposal(&first_authorization, expiry)
            },
        };
        assert!(matches!(
            issuer.issue_successor(ordinary_authorization).await,
            Err(OperatorAuthorizationError::ConflictingReplay)
        ));
        let mut successor_manifest_bindings = vec![second_manifest_binding, added_manifest_binding];
        successor_manifest_bindings
            .sort_by(|left, right| left.manifest_identity.cmp(&right.manifest_identity));
        let mut successor_manifests = vec![second_manifest, added_manifest];
        successor_manifests.sort_by_key(|manifest| manifest.manifest_identity().unwrap());

        let recovery_authorization = OperatorAuthorizationExpiredManifestRecoveryProposalV1 {
            recovery_epoch: epoch.clone(),
            predecessor_authorization: first_authorization.locator(),
            expected_current_frontier_identity: first_authorization
                .frontier()
                .frontier_identity()
                .into(),
            successor: OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("recovery-authorization-2-{suffix}"),
                issuer_identity: first_authorization.issuer_identity().into(),
                issuer_key_version: first_authorization.issuer_key_version().into(),
                scope: first_authorization.scope().clone(),
                request_proof_digest: first_authorization.request_proof_digest().into(),
                operation_manifests: successor_manifest_bindings,
                not_before_epoch_ms: expiry,
                valid_through_epoch_ms: successor_expiry,
                expected_revocation_head: "EMPTY".into(),
            },
        };
        let mut widened_authorization = recovery_authorization.clone();
        widened_authorization
            .successor
            .authorization_identity
            .push_str("-widened");
        widened_authorization
            .successor
            .scope
            .permissions
            .push("trade:live".into());
        assert!(matches!(
            issuer
                .recover_expired_manifests(widened_authorization)
                .await,
            Err(OperatorAuthorizationError::ConflictingReplay)
        ));
        let mut stale_frontier = recovery_authorization.clone();
        stale_frontier
            .successor
            .authorization_identity
            .push_str("-stale-frontier");
        stale_frontier
            .expected_current_frontier_identity
            .push_str("-stale");
        assert!(matches!(
            issuer.recover_expired_manifests(stale_frontier).await,
            Err(OperatorAuthorizationError::ConflictingReplay)
        ));
        let (first_recovery, concurrent_recovery) = tokio::join!(
            issuer.recover_expired_manifests(recovery_authorization.clone()),
            issuer.recover_expired_manifests(recovery_authorization.clone()),
        );
        let second_authorization = first_recovery.unwrap();
        assert_eq!(concurrent_recovery.unwrap(), second_authorization);
        assert_eq!(
            issuer
                .recover_expired_manifests(recovery_authorization)
                .await
                .unwrap(),
            second_authorization
        );
        let expired_request = ProductEdgeAdmissionRequestV1 {
            request_identity: format!("recovery-before-pe-{suffix}"),
            typed_payload: serde_json::json!({"request_identity": format!("recovery-before-pe-{suffix}")}),
            operation: first_manifest.operation.clone(),
            operation_schema: first_manifest.operation_schema.clone(),
            target_owner: first_manifest.target_owner.clone(),
            requested_effects: first_manifest.allowed_effects.clone(),
            request_proof_digest: "sha256:recovery-proof".into(),
            audit_correlation: format!("recovery:{suffix}"),
        };
        assert!(matches!(
            owner.admit_request(expired_request).await,
            Err(ProductEdgeError::Unavailable)
        ));
        let recovery = ProductEdgeExpiredManifestRecoveryProposalV1 {
            recovery_epoch: epoch,
            successor: ProductEdgeSuccessorProposalV1 {
                deployment_identity: deployment.clone(),
                binding_identity: second_binding,
                predecessor_binding_identity: first_binding.clone(),
                expected_history_head: first_binding.clone(),
                generation: 2,
                effective_principal: principal,
                scope_policy_version: "scope-v1".into(),
                capability_policy_version: capability_digest,
                audit_policy_version: "audit-v1".into(),
                valid_from_epoch_ms: expiry,
                valid_through_epoch_ms: successor_expiry,
                authorization: second_authorization.locator(),
                manifests: successor_manifests,
            },
        };
        let successor_manifest_bindings = recovery
            .successor
            .manifests
            .iter()
            .map(|manifest| {
                (
                    manifest.manifest_identity().unwrap(),
                    manifest.manifest_digest().unwrap(),
                )
            })
            .collect::<Vec<_>>();
        let successor_digest = recovery.semantic_digest().unwrap();
        assert_eq!(
            owner
                .commit_successor_fence(
                    &recovery.successor,
                    &successor_digest,
                    Some(&recovery.recovery_epoch),
                )
                .await
                .unwrap(),
            None
        );
        let phase_one_state: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM product_edge_operation_manifests_v1 WHERE manifest_identity IN ($1,$2)), (SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE event_kind=$3 AND aggregate_identity IN ($1,$2)), (SELECT COUNT(*) FROM product_edge_deployment_bindings_v1 WHERE binding_identity=$4), (SELECT COUNT(*) FROM product_edge_binding_manifests_v1 WHERE binding_identity=$4), (SELECT COUNT(*) FROM product_edge_expired_manifest_recoveries_v1 WHERE successor_binding_identity=$4), (SELECT COUNT(*) FROM product_edge_deployment_heads_v1 WHERE binding_identity=$4)",
        )
        .bind(&successor_manifest_bindings[0].0)
        .bind(&successor_manifest_bindings[1].0)
        .bind(MANIFEST_EVENT)
        .bind(&recovery.successor.binding_identity)
        .fetch_one(pe_pool)
        .await
        .unwrap();
        assert_eq!(
            phase_one_state,
            (0, 0, 0, 0, 0, 0),
            "a durable B1 fence must not expose successor manifests, approved events, or B2 custody"
        );

        // Simulate response/process loss after the independently durable B1
        // fence. Exact rejoin must finish the complete B2 cut atomically.
        let (first_binding_recovery, concurrent_binding_recovery) = tokio::join!(
            owner.recover_expired_manifests(recovery.clone()),
            owner.recover_expired_manifests(recovery.clone()),
        );
        let recovered = first_binding_recovery.unwrap();
        assert_eq!(concurrent_binding_recovery.unwrap(), recovered);
        assert_eq!(
            owner
                .recover_expired_manifests(recovery.clone())
                .await
                .unwrap(),
            recovered
        );
        let phase_two_state: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM product_edge_operation_manifests_v1 WHERE manifest_identity IN ($1,$2)), (SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE event_kind=$3 AND aggregate_identity IN ($1,$2)), (SELECT COUNT(*) FROM product_edge_deployment_bindings_v1 WHERE binding_identity=$4), (SELECT COUNT(*) FROM product_edge_binding_manifests_v1 WHERE binding_identity=$4), (SELECT COUNT(*) FROM product_edge_expired_manifest_recoveries_v1 WHERE successor_binding_identity=$4), (SELECT COUNT(*) FROM product_edge_deployment_heads_v1 WHERE binding_identity=$4)",
        )
        .bind(&successor_manifest_bindings[0].0)
        .bind(&successor_manifest_bindings[1].0)
        .bind(MANIFEST_EVENT)
        .bind(&recovery.successor.binding_identity)
        .fetch_one(pe_pool)
        .await
        .unwrap();
        assert_eq!(phase_two_state, (2, 2, 1, 2, 1, 1));
        let stored_successor_manifests: Vec<(String, String)> = sqlx::query_as(
            "SELECT manifest_identity, manifest_digest FROM product_edge_operation_manifests_v1 WHERE manifest_identity IN ($1,$2) ORDER BY manifest_identity",
        )
        .bind(&successor_manifest_bindings[0].0)
        .bind(&successor_manifest_bindings[1].0)
        .fetch_all(pe_pool)
        .await
        .unwrap();
        assert_eq!(stored_successor_manifests, successor_manifest_bindings);
        let mut changed_replay = recovery.clone();
        changed_replay.successor.valid_through_epoch_ms = changed_replay
            .successor
            .valid_through_epoch_ms
            .saturating_add(1);
        assert!(matches!(
            owner.recover_expired_manifests(changed_replay).await,
            Err(ProductEdgeError::ConflictingReplay | ProductEdgeError::InvalidProposal(_))
        ));
        let mut stale_head = recovery.clone();
        stale_head
            .successor
            .predecessor_binding_identity
            .push_str("-stale");
        stale_head.successor.expected_history_head =
            stale_head.successor.predecessor_binding_identity.clone();
        assert!(matches!(
            owner.recover_expired_manifests(stale_head).await,
            Err(ProductEdgeError::ConflictingReplay)
        ));
        let restarted = ProductEdgePostgresOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
            deployment,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: "operator-authorization-issuer-test-v1".into(),
                issuer_key_version: "test-key-v1".into(),
                audience: "R_AND_D".into(),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            restarted.recover_expired_manifests(recovery).await.unwrap(),
            recovered
        );
        let preserved_rows: (serde_json::Value, serde_json::Value) = sqlx::query_as(
            "SELECT binding_json, (SELECT manifest_json FROM product_edge_operation_manifests_v1 WHERE manifest_identity=$2) FROM product_edge_deployment_bindings_v1 WHERE binding_identity=$1",
        )
        .bind(&first_binding)
        .bind(first_manifest.manifest_identity().unwrap())
        .fetch_one(pe_pool)
        .await
        .unwrap();
        assert_eq!(preserved_rows, old_rows);
    }

    fn first_authorization_proposal(
        readback: &OperatorAuthorizationReadbackV1,
        expiry: u64,
    ) -> OperatorAuthorizationIssuanceProposalV1 {
        OperatorAuthorizationIssuanceProposalV1 {
            authorization_identity: readback.locator().authorization_identity,
            issuer_identity: readback.issuer_identity().into(),
            issuer_key_version: readback.issuer_key_version().into(),
            scope: readback.scope().clone(),
            request_proof_digest: readback.request_proof_digest().into(),
            operation_manifests: readback.operation_manifests().to_vec(),
            not_before_epoch_ms: readback.not_before_epoch_ms(),
            valid_through_epoch_ms: expiry,
            expected_revocation_head: "EMPTY".into(),
        }
    }

    #[tokio::test]
    #[ignore = "requires the disposable canonical OA/PE/R&D/Qualification PostgreSQL topology"]
    async fn genesis_admission_claim_cutover_and_revocation_are_canonical() {
        let test_database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
        Box::pin(exercise_portfolio_read_policy_consumer(&test_database)).await;
        let mutation = test_database.mutation();
        let now = now_ms().unwrap();
        let suffix = unique_suffix();
        let manifest = AgentOperationManifestProposalV1 {
            operation: "research.generic.submit.v1".to_string(),
            operation_schema: "research-generic-submit-v1".to_string(),
            target_owner: "R_AND_D".to_string(),
            allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
            prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
            capability_policy_digest: format!("sha256:{}", "a".repeat(64)),
            effective_from_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(3_600_000),
        };
        let issuer = OperatorAuthorizationIssuerPostgresV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
        )
        .await
        .unwrap();
        let authorization = issuer
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("operator-authorization-{suffix}"),
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: format!("admin-{suffix}"),
                    audience: "R_AND_D".to_string(),
                    permissions: vec!["research:submit".to_string()],
                },
                request_proof_digest: "sha256:test-proof".to_string(),
                operation_manifests: vec![OperationManifestBindingV1 {
                    manifest_identity: manifest.manifest_identity().unwrap(),
                    manifest_digest: manifest.manifest_digest().unwrap(),
                }],
                not_before_epoch_ms: now.saturating_sub(1_000),
                valid_through_epoch_ms: now.saturating_add(3_600_000),
                expected_revocation_head: "EMPTY".to_string(),
            })
            .await
            .unwrap();
        let deployment = format!("product-edge-deployment-{suffix}");
        let first_binding = format!("product-edge-binding-1-{suffix}");
        let owner = ProductEdgePostgresOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
            &deployment,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                audience: "R_AND_D".to_string(),
            },
        )
        .await
        .unwrap();
        let pe_pool = mutation.pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
        let read_database_url = test_database.database_url(CanonicalOwnerTestRoleV1::BacktestOwner);
        assert!(matches!(
            ProductEdgePostgresAdmissionReadPortV1::connect(read_database_url).await,
            Err(ProductEdgeError::Unavailable)
        ));
        sqlx::query(
            "GRANT SELECT ON TABLE product_edge_request_admissions_v1, product_edge_owner_outbox_v1, product_edge_admission_event_stream_v1, product_edge_admission_events_v1 TO backtest_owner",
        )
        .execute(pe_pool)
        .await
        .unwrap();
        let read_role_boundary: (bool, bool, bool, bool, bool, bool, bool, bool) =
            sqlx::query_as(
                "SELECT
                   (SELECT bool_and(has_table_privilege('backtest_owner', table_name, 'SELECT')) FROM unnest(ARRAY['product_edge_request_admissions_v1','product_edge_owner_outbox_v1','product_edge_admission_event_stream_v1','product_edge_admission_events_v1']) AS table_name),
                   (SELECT bool_or(has_table_privilege('backtest_owner', table_name, privilege_name)) FROM unnest(ARRAY['product_edge_request_admissions_v1','product_edge_owner_outbox_v1','product_edge_admission_event_stream_v1','product_edge_admission_events_v1']) AS table_name CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS privilege_name),
                   has_schema_privilege('backtest_owner', 'public', 'CREATE'),
                   pg_has_role('backtest_owner', 'product_edge_owner', 'MEMBER'),
                   rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
                 FROM pg_roles WHERE rolname='backtest_owner'",
            )
            .fetch_one(pe_pool)
            .await
            .unwrap();
        assert_eq!(
            read_role_boundary,
            (true, false, false, false, false, false, false, false)
        );
        let admission_reader = ProductEdgePostgresAdmissionReadPortV1::connect(read_database_url)
            .await
            .unwrap();
        let read_role_pool = PgPool::connect(read_database_url).await.unwrap();
        assert!(
            sqlx::query(
                "INSERT INTO product_edge_admission_event_stream_v1 (stream_identity, last_owner_sequence) VALUES ('forged', 0)",
            )
            .execute(&read_role_pool)
            .await
            .is_err()
        );
        let bootstrap = ProductEdgeBootstrapProposalV1 {
            deployment_identity: deployment.clone(),
            binding_identity: first_binding.clone(),
            expected_history_head: "EMPTY".to_string(),
            generation: 1,
            effective_principal: format!("admin-{suffix}"),
            scope_policy_version: "scope-v1".to_string(),
            capability_policy_version: "capability-v1".to_string(),
            audit_policy_version: "audit-v1".to_string(),
            valid_from_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(3_600_000),
            authorization: authorization.locator(),
            manifests: vec![manifest.clone()],
        };
        let genesis = owner.bootstrap_genesis(bootstrap.clone()).await.unwrap();
        assert_eq!(owner.bootstrap_genesis(bootstrap).await.unwrap(), genesis);

        let request_identity = format!("generic-request-{suffix}");
        let request = ProductEdgeAdmissionRequestV1 {
            request_identity: request_identity.clone(),
            typed_payload: serde_json::json!({"request_identity": request_identity}),
            operation: manifest.operation.clone(),
            operation_schema: manifest.operation_schema.clone(),
            target_owner: manifest.target_owner.clone(),
            requested_effects: manifest.allowed_effects.clone(),
            request_proof_digest: "sha256:test-proof".to_string(),
            audit_correlation: format!("test:{suffix}"),
        };
        let invalid_counts_before: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM product_edge_request_admissions_v1), (SELECT COUNT(*) FROM product_edge_owner_outbox_v1)",
        )
        .fetch_one(pe_pool).await.unwrap();
        let mut wrong_proof = request.clone();
        wrong_proof.request_identity.push_str("-wrong-proof");
        wrong_proof.typed_payload["request_identity"] =
            serde_json::json!(wrong_proof.request_identity);
        wrong_proof.request_proof_digest = "sha256:wrong-proof".to_string();
        assert!(matches!(
            owner.admit_request(wrong_proof).await,
            Err(ProductEdgeError::Unavailable)
        ));
        let mut wrong_manifest = request.clone();
        wrong_manifest.request_identity.push_str("-wrong-manifest");
        wrong_manifest.typed_payload["request_identity"] =
            serde_json::json!(wrong_manifest.request_identity);
        wrong_manifest.operation.push_str(".forged");
        assert!(matches!(
            owner.admit_request(wrong_manifest).await,
            Err(ProductEdgeError::Unavailable)
        ));
        let mut wrong_effect = request.clone();
        wrong_effect.request_identity.push_str("-wrong-effect");
        wrong_effect.typed_payload["request_identity"] =
            serde_json::json!(wrong_effect.request_identity);
        wrong_effect
            .requested_effects
            .push("UNAUTHORIZED_EFFECT_V1".to_string());
        assert!(matches!(
            owner.admit_request(wrong_effect).await,
            Err(ProductEdgeError::Unavailable)
        ));
        let invalid_counts_after: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM product_edge_request_admissions_v1), (SELECT COUNT(*) FROM product_edge_owner_outbox_v1)",
        )
        .fetch_one(pe_pool).await.unwrap();
        assert_eq!(invalid_counts_after, invalid_counts_before);
        let admission = owner.admit_request(request.clone()).await.unwrap();
        assert_eq!(
            owner.admit_request(request.clone()).await.unwrap(),
            admission
        );
        let admission_event_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_edge_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2",
        )
        .bind(admission.locator().admission_identity.as_str())
        .bind(ADMISSION_EVENT)
        .fetch_one(pe_pool)
        .await
        .unwrap();
        assert_eq!(
            admission_event_count, 1,
            "semantic replay must join one event"
        );

        let second_request_identity = format!("generic-request-second-{suffix}");
        let mut second_request = request.clone();
        second_request.request_identity = second_request_identity.clone();
        second_request.typed_payload =
            serde_json::json!({"request_identity": second_request_identity});
        second_request.audit_correlation = format!("test-second:{suffix}");
        let second_admission = owner.admit_request(second_request).await.unwrap();
        let wakes = admission_reader
            .follow_admission_events_after(&ProductEdgeAdmissionEventCursorV1::origin(), 100)
            .await
            .unwrap();
        let first_wake = wakes
            .iter()
            .find(|wake| wake.fact_identity() == admission.locator().admission_identity)
            .unwrap()
            .clone();
        let second_wake = wakes
            .iter()
            .find(|wake| wake.fact_identity() == second_admission.locator().admission_identity)
            .unwrap()
            .clone();
        assert!(first_wake.owner_sequence() < second_wake.owner_sequence());
        let first_observation = admission_reader
            .resolve_admission_observation(&first_wake)
            .await
            .unwrap();
        let second_page = admission_reader
            .follow_admission_events_after(&first_observation.next_cursor(), 1)
            .await
            .unwrap();
        assert_eq!(second_page, vec![second_wake.clone()]);
        let second_observation = admission_reader
            .resolve_admission_observation(&second_wake)
            .await
            .unwrap();
        assert!(
            admission_reader
                .follow_admission_events_after(&second_observation.next_cursor(), 1)
                .await
                .unwrap()
                .is_empty()
        );

        let reconnected_reader = ProductEdgePostgresAdmissionReadPortV1::connect(read_database_url)
            .await
            .unwrap();
        assert_eq!(
            serde_json::to_vec(
                &reconnected_reader
                    .resolve_admission_observation(&first_wake)
                    .await
                    .unwrap()
            )
            .unwrap(),
            serde_json::to_vec(&first_observation).unwrap(),
            "reconnect must rebuild the byte-identical sealed observation"
        );
        assert_eq!(
            reconnected_reader
                .follow_admission_events_after(&ProductEdgeAdmissionEventCursorV1::origin(), 100)
                .await
                .unwrap(),
            wakes,
            "reconnect must rebuild the byte-identical wake stream"
        );

        sqlx::query(
            "DROP TRIGGER product_edge_admission_assignment_immutable_v1 ON product_edge_admission_events_v1",
        )
        .execute(pe_pool)
        .await
        .unwrap();
        let mut wrong_historical_mapping = pe_pool.begin().await.unwrap();
        sqlx::query("DELETE FROM product_edge_admission_events_v1 WHERE event_identity = $1")
            .bind(second_wake.event_identity())
            .execute(&mut *wrong_historical_mapping)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO product_edge_admission_events_v1 (owner_sequence, event_identity, predecessor_event_identity, assignment_mode) VALUES ($1,$2,NULL,'REBUILT')",
        )
        .bind(second_wake.owner_sequence() as i64)
        .bind(second_wake.event_identity())
        .execute(&mut *wrong_historical_mapping)
        .await
        .unwrap();
        assert!(matches!(
            verify_admission_event_stream(&mut wrong_historical_mapping).await,
            Err(ProductEdgeError::Unavailable)
        ));
        wrong_historical_mapping.rollback().await.unwrap();
        sqlx::query("DELETE FROM product_edge_admission_events_v1 WHERE event_identity = $1")
            .bind(second_wake.event_identity())
            .execute(pe_pool)
            .await
            .unwrap();
        let rebuilt = ProductEdgePostgresOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
            &deployment,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                audience: "R_AND_D".to_string(),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            rebuilt
                .follow_admission_events_after(&ProductEdgeAdmissionEventCursorV1::origin(), 100)
                .await
                .unwrap(),
            wakes,
            "a missing historical assignment must be inserted once without changing locators"
        );
        assert_eq!(
            serde_json::to_vec(
                &rebuilt
                    .resolve_admission_observation(&second_wake)
                    .await
                    .unwrap()
            )
            .unwrap(),
            serde_json::to_vec(&second_observation).unwrap(),
            "a rebuilt historical assignment must preserve the sealed observation bytes"
        );
        let rebuilt_mapping: (i64, String, Option<String>, String) = sqlx::query_as(
            "SELECT owner_sequence, event_identity, predecessor_event_identity, assignment_mode FROM product_edge_admission_events_v1 WHERE event_identity = $1",
        )
        .bind(second_wake.event_identity())
        .fetch_one(pe_pool)
        .await
        .unwrap();
        assert_eq!(rebuilt_mapping.0, second_wake.owner_sequence() as i64);
        assert_eq!(rebuilt_mapping.1, second_wake.event_identity());
        assert_eq!(
            rebuilt_mapping.2.as_deref(),
            Some(first_wake.event_identity())
        );
        assert_eq!(rebuilt_mapping.3, "REBUILT");
        let rebuilt_reconnected = ProductEdgePostgresOwnerV1::connect(
            test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
            &deployment,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                audience: "R_AND_D".to_string(),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            rebuilt_reconnected
                .follow_admission_events_after(&ProductEdgeAdmissionEventCursorV1::origin(), 100)
                .await
                .unwrap(),
            wakes,
            "reconnect must not remint or rewrite a rebuilt assignment"
        );

        let frontier_before_failure = first_observation.next_cursor();
        let mut missing_event = serde_json::to_value(&first_wake).unwrap();
        missing_event["event_identity"] = serde_json::json!("missing-event");
        let missing_event =
            serde_json::from_value::<ProductEdgeAdmissionEventLocatorV1>(missing_event).unwrap();
        assert!(matches!(
            admission_reader
                .resolve_admission_observation(&missing_event)
                .await,
            Err(ProductEdgeError::Unavailable)
        ));
        let mut wrong_sequence = serde_json::to_value(&first_wake).unwrap();
        wrong_sequence["owner_sequence"] = serde_json::json!(second_wake.owner_sequence());
        let wrong_sequence =
            serde_json::from_value::<ProductEdgeAdmissionEventLocatorV1>(wrong_sequence).unwrap();
        assert!(matches!(
            admission_reader
                .resolve_admission_observation(&wrong_sequence)
                .await,
            Err(ProductEdgeError::Unavailable)
        ));
        let mut wrong_digest = serde_json::to_value(&first_wake).unwrap();
        let mut forged_digest = first_wake.fact_digest().to_string();
        mutate_sha256(&mut forged_digest);
        wrong_digest["fact_digest"] = serde_json::json!(forged_digest);
        let wrong_digest =
            serde_json::from_value::<ProductEdgeAdmissionEventLocatorV1>(wrong_digest).unwrap();
        assert!(matches!(
            admission_reader
                .resolve_admission_observation(&wrong_digest)
                .await,
            Err(ProductEdgeError::Unavailable)
        ));
        let mut stale_cursor = serde_json::to_value(second_observation.next_cursor()).unwrap();
        stale_cursor["owner_sequence"] =
            serde_json::json!(second_wake.owner_sequence().saturating_add(1));
        let stale_cursor =
            serde_json::from_value::<ProductEdgeAdmissionEventCursorV1>(stale_cursor).unwrap();
        assert!(matches!(
            admission_reader
                .follow_admission_events_after(&stale_cursor, 1)
                .await,
            Err(ProductEdgeError::Unavailable)
        ));
        let mut skipped_cursor = serde_json::to_value(first_observation.next_cursor()).unwrap();
        skipped_cursor["owner_sequence"] = serde_json::json!(second_wake.owner_sequence());
        let skipped_cursor =
            serde_json::from_value::<ProductEdgeAdmissionEventCursorV1>(skipped_cursor).unwrap();
        assert!(matches!(
            admission_reader
                .follow_admission_events_after(&skipped_cursor, 1)
                .await,
            Err(ProductEdgeError::Unavailable)
        ));
        assert_eq!(frontier_before_failure, first_observation.next_cursor());

        let mut mapping_update = pe_pool.begin().await.unwrap();
        assert!(sqlx::query(
            "UPDATE product_edge_admission_events_v1 SET event_identity = CASE WHEN event_identity = $1 THEN $2 ELSE $1 END WHERE event_identity = $1 OR event_identity = $2",
        )
        .bind(first_wake.event_identity())
        .bind(second_wake.event_identity())
        .execute(&mut *mapping_update)
        .await
        .is_err());
        mapping_update.rollback().await.unwrap();

        let mut mapping_delete_reinsert = pe_pool.begin().await.unwrap();
        assert!(sqlx::query(
            "WITH removed AS (DELETE FROM product_edge_admission_events_v1 WHERE event_identity = $1 OR event_identity = $2 RETURNING owner_sequence, event_identity, predecessor_event_identity, assignment_mode) INSERT INTO product_edge_admission_events_v1 (owner_sequence, event_identity, predecessor_event_identity, assignment_mode) SELECT owner_sequence, event_identity, predecessor_event_identity, assignment_mode FROM removed",
        )
        .bind(first_wake.event_identity())
        .bind(second_wake.event_identity())
        .execute(&mut *mapping_delete_reinsert)
        .await
        .is_err());
        mapping_delete_reinsert.rollback().await.unwrap();
        assert_eq!(
            admission_reader
                .follow_admission_events_after(&ProductEdgeAdmissionEventCursorV1::origin(), 100)
                .await
                .unwrap(),
            wakes,
            "rejected assignment rewrites must not alter or advance the stream"
        );

        let trigger_drop_reached = std::sync::Arc::new(tokio::sync::Notify::new());
        let release_trigger_replacement = std::sync::Arc::new(tokio::sync::Notify::new());
        let migrating_owner = owner.clone();
        let migrating_reached = std::sync::Arc::clone(&trigger_drop_reached);
        let migrating_release = std::sync::Arc::clone(&release_trigger_replacement);

        let migration = tokio::spawn(async move {
            migrating_owner
                .migrate_observing(move |statement| {
                    let pause_after_trigger_drop = statement
                        == "DROP TRIGGER IF EXISTS product_edge_admission_assignment_immutable_v1 ON product_edge_admission_events_v1";
                    let reached = std::sync::Arc::clone(&migrating_reached);
                    let release = std::sync::Arc::clone(&migrating_release);
                    async move {
                        if pause_after_trigger_drop {
                            reached.notify_one();
                            release.notified().await;
                        }
                    }
                })
                .await
        });
        tokio::time::timeout(Duration::from_secs(5), trigger_drop_reached.notified())
            .await
            .unwrap();

        let rewrite_pool = pe_pool.clone();
        let rewrite_first_event = first_wake.event_identity().to_string();
        let rewrite_second_event = second_wake.event_identity().to_string();

        let mut concurrent_rewrite = tokio::spawn(async move {
            let mut transaction = rewrite_pool.begin().await.unwrap();
            let result = sqlx::query(
                "WITH removed AS (DELETE FROM product_edge_admission_events_v1 WHERE event_identity = $1 OR event_identity = $2 RETURNING owner_sequence, event_identity, predecessor_event_identity, assignment_mode) INSERT INTO product_edge_admission_events_v1 (owner_sequence, event_identity, predecessor_event_identity, assignment_mode) SELECT owner_sequence, event_identity, predecessor_event_identity, assignment_mode FROM removed",
            )
            .bind(rewrite_first_event)
            .bind(rewrite_second_event)
            .execute(&mut *transaction)
            .await;
            transaction.rollback().await.unwrap();
            result
        });
        let rewrite_blocked_before_commit =
            tokio::time::timeout(Duration::from_millis(100), &mut concurrent_rewrite)
                .await
                .is_err();
        release_trigger_replacement.notify_one();
        assert!(
            rewrite_blocked_before_commit,
            "a concurrent reconnect migration must never expose the dropped trigger"
        );
        tokio::time::timeout(Duration::from_secs(5), migration)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(
            tokio::time::timeout(Duration::from_secs(5), &mut concurrent_rewrite)
                .await
                .unwrap()
                .unwrap()
                .is_err(),
            "the waiting rewrite must observe the restored immutable trigger after commit"
        );
        assert_eq!(
            admission_reader
                .follow_admission_events_after(&ProductEdgeAdmissionEventCursorV1::origin(), 100)
                .await
                .unwrap(),
            wakes,
            "a concurrent reconnect must preserve the byte-identical event stream"
        );

        let original_admission_json: serde_json::Value = sqlx::query_scalar(
            "SELECT admission_json FROM product_edge_request_admissions_v1 WHERE request_identity=$1",
        )
        .bind(&request_identity)
        .fetch_one(pe_pool)
        .await
        .unwrap();
        let mut tampered_admission_json = original_admission_json.clone();
        tampered_admission_json["request"]["typed_payload"]["review_tamper"] =
            serde_json::json!(true);
        sqlx::query(
            "UPDATE product_edge_request_admissions_v1 SET admission_json=$1 WHERE request_identity=$2",
        )
        .bind(&tampered_admission_json)
        .bind(&request_identity)
        .execute(pe_pool)
        .await
        .unwrap();
        assert!(matches!(
            admission_reader
                .resolve_admission_observation(&first_wake)
                .await,
            Err(ProductEdgeError::Unavailable)
        ));
        assert_eq!(frontier_before_failure, first_observation.next_cursor());
        sqlx::query(
            "UPDATE product_edge_request_admissions_v1 SET admission_json=$1 WHERE request_identity=$2",
        )
        .bind(&original_admission_json)
        .bind(&request_identity)
        .execute(pe_pool)
        .await
        .unwrap();

        let original_admission_digest: String = sqlx::query_scalar(
            "SELECT admission_digest FROM product_edge_request_admissions_v1 WHERE request_identity=$1",
        )
        .bind(&request_identity).fetch_one(pe_pool).await.unwrap();
        sqlx::query("UPDATE product_edge_request_admissions_v1 SET admission_digest='sha256:corrupt' WHERE request_identity=$1")
            .bind(&request_identity).execute(pe_pool).await.unwrap();
        assert!(matches!(
            owner
                .resolve_admission(&request_identity, "sha256:test-proof")
                .await,
            Err(ProductEdgeError::Unavailable)
        ));
        assert!(matches!(
            owner.resolve_admission_observation(&first_wake).await,
            Err(ProductEdgeError::Unavailable)
        ));
        sqlx::query("UPDATE product_edge_request_admissions_v1 SET admission_digest=$1 WHERE request_identity=$2")
            .bind(&original_admission_digest).bind(&request_identity).execute(pe_pool).await.unwrap();
        let admission_event_identity: String = sqlx::query_scalar(
            "SELECT event_identity FROM product_edge_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2",
        )
        .bind(admission.locator().admission_identity.as_str()).bind(ADMISSION_EVENT)
        .fetch_one(pe_pool).await.unwrap();
        assert!(sqlx::query(
            "UPDATE product_edge_owner_outbox_v1 SET event_kind=event_kind WHERE event_identity=$1",
        )
        .bind(&admission_event_identity)
        .execute(pe_pool)
        .await
        .is_err());
        assert!(sqlx::query(
            "UPDATE product_edge_owner_outbox_v1 SET event_kind='CORRUPT' WHERE event_identity=$1",
        )
        .bind(&admission_event_identity)
        .execute(pe_pool)
        .await
        .is_err());
        assert_eq!(
            owner
                .resolve_admission_observation(&first_wake)
                .await
                .unwrap(),
            first_observation
        );
        assert_eq!(
            owner
                .resolve_admission(&request_identity, "sha256:test-proof")
                .await
                .unwrap()
                .unwrap(),
            admission
        );

        let successor = ProductEdgeSuccessorProposalV1 {
            deployment_identity: deployment,
            binding_identity: format!("product-edge-binding-2-{suffix}"),
            predecessor_binding_identity: first_binding.clone(),
            expected_history_head: first_binding.clone(),
            generation: 2,
            effective_principal: format!("admin-{suffix}"),
            scope_policy_version: "scope-v1".to_string(),
            capability_policy_version: "capability-v1".to_string(),
            audit_policy_version: "audit-v1".to_string(),
            valid_from_epoch_ms: now.saturating_sub(500),
            valid_through_epoch_ms: now.saturating_add(3_600_000),
            authorization: authorization.locator(),
            manifests: vec![manifest.clone()],
        };
        let supersessions_before: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM product_edge_deployment_supersessions_v1")
                .fetch_one(pe_pool)
                .await
                .unwrap();
        let mut drifted = successor.clone();
        drifted.effective_principal.push_str("-forged");
        assert!(matches!(
            owner.activate_successor(drifted).await,
            Err(ProductEdgeError::Unavailable)
        ));
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM product_edge_deployment_supersessions_v1",
            )
            .fetch_one(pe_pool)
            .await
            .unwrap(),
            supersessions_before
        );
        let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
        let successor_digest = successor.semantic_digest().unwrap();
        let mut downstream_successor_cut = rd_pool.begin().await.unwrap();
        resolve_admission_for_downstream_in_transaction(
            &mut downstream_successor_cut,
            admission.locator(),
            DownstreamAdmissionModeV1::FirstMutation {
                read_cut_epoch_ms: now_ms().unwrap(),
            },
        )
        .await
        .unwrap();
        let waiting_fence = owner.commit_successor_fence(&successor, &successor_digest, None);
        tokio::pin!(waiting_fence);
        assert!(
            tokio::time::timeout(Duration::from_millis(100), &mut waiting_fence)
                .await
                .is_err(),
            "phase-one cutover must wait for the locked downstream mutation cut"
        );
        downstream_successor_cut.rollback().await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_secs(5), &mut waiting_fence)
                .await
                .unwrap()
                .unwrap()
                .is_none()
        );
        assert_eq!(
            owner
                .commit_successor_fence(&successor, &successor_digest, None)
                .await
                .unwrap(),
            None,
            "exact phase-one replay joins the existing fence"
        );
        let fenced_identity = format!("generic-request-fenced-{suffix}");
        let fenced_counts_before: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM product_edge_request_admissions_v1), (SELECT COUNT(*) FROM product_edge_owner_outbox_v1)",
        )
        .fetch_one(pe_pool)
        .await
        .unwrap();
        assert!(matches!(
            owner
                .admit_request(ProductEdgeAdmissionRequestV1 {
                    request_identity: fenced_identity.clone(),
                    typed_payload: serde_json::json!({"request_identity": fenced_identity}),
                    operation: manifest.operation.clone(),
                    operation_schema: manifest.operation_schema.clone(),
                    target_owner: manifest.target_owner.clone(),
                    requested_effects: manifest.allowed_effects.clone(),
                    request_proof_digest: "sha256:test-proof".to_string(),
                    audit_correlation: format!("test-fenced:{suffix}"),
                })
                .await,
            Err(ProductEdgeError::Unavailable)
        ));
        let fenced_counts_after: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM product_edge_request_admissions_v1), (SELECT COUNT(*) FROM product_edge_owner_outbox_v1)",
        )
        .fetch_one(pe_pool)
        .await
        .unwrap();
        assert_eq!(fenced_counts_after, fenced_counts_before);
        let activated = owner.activate_successor(successor.clone()).await.unwrap();
        assert_eq!(
            owner.activate_successor(successor.clone()).await.unwrap(),
            activated
        );

        let original_head_digest: String = sqlx::query_scalar(
            "SELECT binding_digest FROM product_edge_deployment_heads_v1 WHERE deployment_identity=$1",
        )
        .bind(owner.deployment_identity.as_str())
        .fetch_one(pe_pool)
        .await
        .unwrap();
        sqlx::query("UPDATE product_edge_deployment_heads_v1 SET binding_digest='sha256:corrupt' WHERE deployment_identity=$1")
            .bind(owner.deployment_identity.as_str()).execute(pe_pool).await.unwrap();
        assert!(matches!(
            owner
                .resolve_admission(&request_identity, "sha256:test-proof")
                .await,
            Err(ProductEdgeError::Unavailable)
        ));
        sqlx::query("UPDATE product_edge_deployment_heads_v1 SET binding_digest=$1 WHERE deployment_identity=$2")
            .bind(&original_head_digest).bind(owner.deployment_identity.as_str())
            .execute(pe_pool).await.unwrap();
        let original_supersession_json: serde_json::Value = sqlx::query_scalar(
            "SELECT supersession_json FROM product_edge_deployment_supersessions_v1 WHERE binding_identity=$1",
        )
        .bind(&first_binding).fetch_one(pe_pool).await.unwrap();
        sqlx::query("UPDATE product_edge_deployment_supersessions_v1 SET supersession_json=jsonb_set(supersession_json, '{unexpected}', 'true'::jsonb) WHERE binding_identity=$1")
            .bind(&first_binding).execute(pe_pool).await.unwrap();
        assert!(matches!(
            owner
                .resolve_admission(&request_identity, "sha256:test-proof")
                .await,
            Err(ProductEdgeError::Unavailable)
        ));
        sqlx::query("UPDATE product_edge_deployment_supersessions_v1 SET supersession_json=$1 WHERE binding_identity=$2")
            .bind(&original_supersession_json).bind(&first_binding).execute(pe_pool).await.unwrap();
        let manifest_identity = admission.manifest_identity().to_string();
        let original_manifest_digest: String = sqlx::query_scalar(
            "SELECT manifest_digest FROM product_edge_operation_manifests_v1 WHERE manifest_identity=$1",
        )
        .bind(&manifest_identity).fetch_one(pe_pool).await.unwrap();
        sqlx::query("UPDATE product_edge_operation_manifests_v1 SET manifest_digest='sha256:corrupt' WHERE manifest_identity=$1")
            .bind(&manifest_identity).execute(pe_pool).await.unwrap();
        assert!(matches!(
            owner
                .resolve_admission(&request_identity, "sha256:test-proof")
                .await,
            Err(ProductEdgeError::Unavailable)
        ));
        sqlx::query("UPDATE product_edge_operation_manifests_v1 SET manifest_digest=$1 WHERE manifest_identity=$2")
            .bind(&original_manifest_digest).bind(&manifest_identity).execute(pe_pool).await.unwrap();

        let after_cutover_identity = format!("generic-request-after-cutover-{suffix}");
        owner
            .admit_request(ProductEdgeAdmissionRequestV1 {
                request_identity: after_cutover_identity.clone(),
                typed_payload: serde_json::json!({"request_identity": after_cutover_identity}),
                operation: manifest.operation.clone(),
                operation_schema: manifest.operation_schema.clone(),
                target_owner: manifest.target_owner.clone(),
                requested_effects: manifest.allowed_effects.clone(),
                request_proof_digest: "sha256:test-proof".to_string(),
                audit_correlation: format!("test-cutover:{suffix}"),
            })
            .await
            .unwrap();

        let function_catalog: (String, bool, String, String, bool, Option<Vec<String>>) =
            sqlx::query_as(
                "SELECT role.rolname, procedure.prosecdef, procedure.provolatile::text, procedure.proparallel::text, procedure.proisstrict, procedure.proconfig FROM pg_proc procedure JOIN pg_roles role ON role.oid=procedure.proowner WHERE procedure.oid=to_regprocedure('product_edge_api.lock_downstream_admission_v1(text,text,text)')",
            )
            .fetch_one(pe_pool).await.unwrap();
        assert_eq!(function_catalog.0, "product_edge_owner");
        assert!(function_catalog.1 && function_catalog.4);
        assert_eq!(
            (function_catalog.2.as_str(), function_catalog.3.as_str()),
            ("v", "u")
        );
        assert_eq!(
            function_catalog.5,
            Some(vec!["search_path=pg_catalog".into()])
        );
        assert!(
            sqlx::query("SELECT 1 FROM product_edge_request_admissions_v1 FOR SHARE")
                .fetch_optional(rd_pool)
                .await
                .is_err()
        );
        assert!(
            sqlx::query("SELECT 1 FROM operator_authorization_private.operator_authorization_issuances_v1 FOR SHARE")
                .fetch_optional(rd_pool).await.is_err()
        );
        let mut first_mutation = rd_pool.begin().await.unwrap();
        let resolved = resolve_admission_for_downstream_in_transaction(
            &mut first_mutation,
            admission.locator(),
            DownstreamAdmissionModeV1::FirstMutation {
                read_cut_epoch_ms: now_ms().unwrap(),
            },
        )
        .await
        .unwrap();
        assert!(resolved.authorizes_first_mutation_at(now_ms().unwrap()));
        let mut second_mutation = rd_pool.begin().await.unwrap();
        resolve_admission_for_downstream_in_transaction(
            &mut second_mutation,
            admission.locator(),
            DownstreamAdmissionModeV1::FirstMutation {
                read_cut_epoch_ms: now_ms().unwrap(),
            },
        )
        .await
        .unwrap();
        let revoke = issuer.revoke(OperatorAuthorizationRevocationProposalV1 {
            authorization: authorization.locator(),
            expected_frontier_identity: authorization.frontier().frontier_identity().to_string(),
            reason_code: "ADMIN_REVOKED".to_string(),
        });
        tokio::pin!(revoke);
        assert!(
            tokio::time::timeout(Duration::from_millis(100), &mut revoke)
                .await
                .is_err()
        );
        first_mutation.commit().await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(100), &mut revoke)
                .await
                .is_err()
        );
        second_mutation.rollback().await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), &mut revoke)
            .await
            .unwrap()
            .unwrap();

        let counts_before: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM product_edge_request_admissions_v1), (SELECT COUNT(*) FROM product_edge_owner_outbox_v1)",
        )
        .fetch_one(pe_pool)
        .await
        .unwrap();
        let rejected_identity = format!("generic-request-after-revoke-{suffix}");
        assert!(matches!(
            owner
                .admit_request(ProductEdgeAdmissionRequestV1 {
                    request_identity: rejected_identity.clone(),
                    typed_payload: serde_json::json!({"request_identity": rejected_identity}),
                    operation: manifest.operation,
                    operation_schema: manifest.operation_schema,
                    target_owner: manifest.target_owner,
                    requested_effects: manifest.allowed_effects,
                    request_proof_digest: "sha256:test-proof".to_string(),
                    audit_correlation: format!("test-revoked:{suffix}"),
                })
                .await,
            Err(ProductEdgeError::Unavailable)
        ));
        let counts_after: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM product_edge_request_admissions_v1), (SELECT COUNT(*) FROM product_edge_owner_outbox_v1)",
        )
        .fetch_one(pe_pool)
        .await
        .unwrap();
        assert_eq!(counts_after, counts_before);

        let mut revoked_cut = rd_pool.begin().await.unwrap();
        assert!(matches!(
            resolve_admission_for_downstream_in_transaction(
                &mut revoked_cut,
                admission.locator(),
                DownstreamAdmissionModeV1::FirstMutation {
                    read_cut_epoch_ms: now_ms().unwrap(),
                },
            )
            .await,
            Err(ProductEdgeError::Unavailable)
        ));
        revoked_cut.rollback().await.unwrap();
        assert_eq!(
            owner
                .resolve_admission(&request_identity, "sha256:test-proof")
                .await
                .unwrap()
                .unwrap(),
            admission,
            "historical admission remains byte-identical after revocation"
        );
    }

    fn unique_suffix() -> String {
        format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    fn mutate_sha256(value: &mut String) {
        let replacement = if &value[7..8] == "0" { "1" } else { "0" };
        value.replace_range(7..8, replacement);
    }
}
