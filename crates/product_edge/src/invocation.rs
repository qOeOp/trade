use serde::Serialize;
use vibe_product_edge_claim_custody::{
    ProductEdgeInvocationClaimCustodyV1, ProductEdgeInvocationStartCustodyV1,
};
pub use vibe_product_edge_claim_custody::{
    ProductEdgeInvocationNextLegalActionV1, ProductEdgeInvocationStateV1,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProductEdgeInvocationClaimDispositionV1 {
    ClaimedNew,
    AlreadyClaimed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProductEdgeInvocationStartDispositionV1 {
    StartedNew,
    OutcomeUnknown,
}

/// Sealed Product Edge one-use provider invocation claim.
///
/// ```compile_fail
/// use vibe_product_edge::ProductEdgeInvocationClaimReadbackV1;
/// let _: ProductEdgeInvocationClaimReadbackV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProductEdgeInvocationClaimReadbackV1 {
    #[serde(flatten)]
    pub(crate) custody: ProductEdgeInvocationClaimCustodyV1,
    pub(crate) disposition: ProductEdgeInvocationClaimDispositionV1,
    pub(crate) state: ProductEdgeInvocationStateV1,
    pub(crate) next_legal_action: ProductEdgeInvocationNextLegalActionV1,
}

impl ProductEdgeInvocationClaimReadbackV1 {
    pub(crate) fn from_custody(
        custody: ProductEdgeInvocationClaimCustodyV1,
        disposition: ProductEdgeInvocationClaimDispositionV1,
    ) -> Self {
        let state = custody.state();
        let next_legal_action = custody.next_legal_action();
        Self {
            custody,
            disposition,
            state,
            next_legal_action,
        }
    }
    pub fn request_identity(&self) -> &str {
        self.custody.request_identity()
    }
    pub fn admission_identity(&self) -> &str {
        self.custody.admission_identity()
    }
    pub fn attempt_identity(&self) -> &str {
        self.custody.attempt_identity()
    }
    pub fn claim_identity(&self) -> &str {
        self.custody.claim_identity()
    }
    pub fn disposition(&self) -> ProductEdgeInvocationClaimDispositionV1 {
        self.disposition
    }
    pub fn claim_digest(&self) -> &str {
        self.custody.claim_digest()
    }
    pub fn invocation_admission_receipt_identity(&self) -> &str {
        self.custody.invocation_admission_receipt_identity()
    }
    pub fn invocation_admission_receipt_digest(&self) -> &str {
        self.custody.invocation_admission_receipt_digest()
    }
    pub fn state_digest(&self) -> &str {
        self.custody.state_digest()
    }
    pub fn state(&self) -> ProductEdgeInvocationStateV1 {
        self.state
    }
    pub fn next_legal_action(&self) -> ProductEdgeInvocationNextLegalActionV1 {
        self.next_legal_action
    }
    pub fn into_custody(self) -> ProductEdgeInvocationClaimCustodyV1 {
        self.custody
    }
}

/// Sealed Product Edge provider-invocation start result.
///
/// ```compile_fail
/// use vibe_product_edge::ProductEdgeInvocationStartReadbackV1;
/// let _: ProductEdgeInvocationStartReadbackV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProductEdgeInvocationStartReadbackV1 {
    #[serde(flatten)]
    pub(crate) custody: ProductEdgeInvocationStartCustodyV1,
    pub(crate) disposition: ProductEdgeInvocationStartDispositionV1,
}

impl ProductEdgeInvocationStartReadbackV1 {
    pub(crate) fn from_custody(
        custody: ProductEdgeInvocationStartCustodyV1,
        disposition: ProductEdgeInvocationStartDispositionV1,
    ) -> Self {
        Self {
            custody,
            disposition,
        }
    }
    pub fn disposition(&self) -> ProductEdgeInvocationStartDispositionV1 {
        self.disposition
    }
    pub fn state_digest(&self) -> &str {
        self.custody.state_digest()
    }
}
