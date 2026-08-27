use sqlx::{Postgres, Transaction};

use super::*;

pub(super) fn invocation_claim_digest(
    stored: &StoredInvocationClaimV1,
) -> Result<String, ProductEdgeError> {
    vibe_product_edge_claim_custody::invocation_claim_digest(stored)
        .map_err(|e| ProductEdgeError::Storage(e.to_string()))
}

pub(super) fn invocation_admission_receipt_digest(
    stored: &StoredInvocationAdmissionReceiptV1,
) -> Result<String, ProductEdgeError> {
    vibe_product_edge_claim_custody::invocation_admission_receipt_digest(stored)
        .map_err(|e| ProductEdgeError::Storage(e.to_string()))
}

pub(super) async fn load_invocation_admission_receipt(
    transaction: &mut Transaction<'_, Postgres>,
    claim_identity: &str,
) -> Result<Option<StoredInvocationAdmissionReceiptV1>, ProductEdgeError> {
    vibe_product_edge_claim_custody::load_invocation_admission_receipt(transaction, claim_identity)
        .await
        .map_err(claim_custody_error)
}

pub(super) async fn verify_invocation_admission_lineage(
    transaction: &mut Transaction<'_, Postgres>,
    admission: &ProductEdgeAdmissionReadbackV1,
    claim: &StoredInvocationClaimV1,
    expected_effect: &str,
) -> Result<(), ProductEdgeError> {
    let receipt = load_invocation_admission_receipt(transaction, &claim.claim_identity)
        .await?
        .ok_or(ProductEdgeError::Unavailable)?;
    let historical_authorization = admission.authorization().locator();
    if receipt.request_identity != admission.request().request_identity
        || receipt.admission_identity != admission.locator().admission_identity
        || receipt.admission_digest != admission.locator().admission_digest
        || receipt.historical_binding_identity != admission.binding_identity()
        || receipt.historical_binding_generation != admission.binding_generation()
        || receipt.historical_authorization_identity
            != historical_authorization.authorization_identity
        || receipt.historical_issuance_receipt_identity
            != historical_authorization.issuance_receipt_identity
        || receipt.historical_authorization_frontier_identity
            != admission.authorization().frontier().frontier_identity()
        || receipt.effective_principal != admission.effective_principal()
        || receipt.authorized_scope != admission.authorized_scope()
        || receipt.scope_policy_version != admission.scope_policy_version()
        || receipt.capability_policy_version != admission.capability_policy_version()
        || receipt.audit_policy_version != admission.audit_policy_version()
        || receipt.manifest_identity != admission.manifest_identity()
        || receipt.manifest_digest != admission.manifest_digest()
        || receipt.attempt_identity != claim.attempt_identity
        || receipt.effect != expected_effect
        || receipt.claim_identity != claim.claim_identity
        || receipt.receipt_identity != claim.invocation_admission_receipt_identity
        || receipt.receipt_digest != claim.invocation_admission_receipt_digest
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok(())
}

pub(super) async fn load_invocation_admission_for_locator(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &ProductEdgeAdmissionLocatorV1,
    claim: &StoredInvocationClaimV1,
    expected_effect: &str,
) -> Result<StoredInvocationAdmissionReceiptV1, ProductEdgeError> {
    let receipt = load_invocation_admission_receipt(transaction, &claim.claim_identity)
        .await?
        .ok_or(ProductEdgeError::Unavailable)?;

    if receipt.request_identity != locator.request_identity
        || receipt.admission_identity != locator.admission_identity
        || receipt.admission_digest != locator.admission_digest
        || receipt.attempt_identity != claim.attempt_identity
        || receipt.claim_identity != claim.claim_identity
        || receipt.receipt_identity != claim.invocation_admission_receipt_identity
        || receipt.receipt_digest != claim.invocation_admission_receipt_digest
        || receipt.effect != expected_effect
    {
        return Err(ProductEdgeError::Unavailable);
    }
    Ok(receipt)
}

pub(super) fn invocation_state_digest(
    stored: &StoredInvocationStateV1,
) -> Result<String, ProductEdgeError> {
    vibe_product_edge_claim_custody::invocation_state_digest(stored)
        .map_err(|e| ProductEdgeError::Storage(e.to_string()))
}

pub(super) async fn load_invocation_claim(
    transaction: &mut Transaction<'_, Postgres>,
    admission_identity: &str,
) -> Result<Option<StoredInvocationClaimV1>, ProductEdgeError> {
    vibe_product_edge_claim_custody::load_invocation_claim(transaction, admission_identity)
        .await
        .map_err(claim_custody_error)
}

pub(super) async fn load_invocation_state(
    transaction: &mut Transaction<'_, Postgres>,
    claim_identity: &str,
) -> Result<Option<StoredInvocationStateV1>, ProductEdgeError> {
    vibe_product_edge_claim_custody::load_invocation_state(transaction, claim_identity)
        .await
        .map_err(claim_custody_error)
}

fn claim_custody_error(
    error: vibe_product_edge_claim_custody::ProductEdgeClaimCustodyError,
) -> ProductEdgeError {
    match error {
        vibe_product_edge_claim_custody::ProductEdgeClaimCustodyError::Unavailable => {
            ProductEdgeError::Unavailable
        }
        vibe_product_edge_claim_custody::ProductEdgeClaimCustodyError::Encoding(message)
        | vibe_product_edge_claim_custody::ProductEdgeClaimCustodyError::Storage(message) => {
            ProductEdgeError::Storage(message)
        }
    }
}

pub(super) async fn resolve_invocation_claim_readback(
    transaction: &mut Transaction<'_, Postgres>,
    admission_identity: &str,
    disposition: ProductEdgeInvocationClaimDispositionV1,
) -> Result<ProductEdgeInvocationClaimReadbackV1, ProductEdgeError> {
    let custody = vibe_product_edge_claim_custody::resolve_invocation_claim_custody(
        transaction,
        admission_identity,
    )
    .await
    .map_err(claim_custody_error)?
    .ok_or(ProductEdgeError::Unavailable)?;
    Ok(ProductEdgeInvocationClaimReadbackV1::from_custody(
        custody,
        disposition,
    ))
}

pub(super) async fn resolve_invocation_start_readback(
    transaction: &mut Transaction<'_, Postgres>,
    admission_identity: &str,
    disposition: ProductEdgeInvocationStartDispositionV1,
) -> Result<ProductEdgeInvocationStartReadbackV1, ProductEdgeError> {
    let custody = vibe_product_edge_claim_custody::resolve_invocation_start_custody(
        transaction,
        admission_identity,
    )
    .await
    .map_err(claim_custody_error)?
    .ok_or(ProductEdgeError::Unavailable)?;
    Ok(ProductEdgeInvocationStartReadbackV1::from_custody(
        custody,
        disposition,
    ))
}
