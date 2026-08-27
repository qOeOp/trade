use crate::{AttemptId, OpaqueId, ReceiptStoreError, ScannerReceipt, TerminalReceiptStore};

pub(crate) mod sealed {
    pub trait ScannerOwnedTerminalReceiptStore {}
}

/// Scanner-owned store capability allowed to issue Product Edge terminal-read handles.
///
/// The private supertrait keeps arbitrary downstream [`TerminalReceiptStore`] implementations from
/// becoming canonical positive-read authorities. A production adapter must be bound here by the
/// Scanner owner; this static contract currently provides no production implementation.
pub trait ProductEdgeTerminalReceiptReadSource:
    TerminalReceiptStore + sealed::ScannerOwnedTerminalReceiptStore
{
}

/// Explicit non-positive outcomes from Product Edge's Scanner-owned terminal read.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProductEdgeReceiptReadError {
    NotFound {
        attempt_id: AttemptId,
    },
    IdentityConflict {
        requested: Box<AttemptId>,
        returned: Box<AttemptId>,
    },
    StoreSemanticConflict {
        attempt_id: AttemptId,
    },
    Unavailable {
        evidence: OpaqueId,
    },
}

/// Read-only Product Edge capability bound to the terminal store selected by Scanner composition.
///
/// It deliberately has no public constructor: an ordinary composition layer obtains it only from
/// [`crate::Scanner::product_edge_terminal_receipts`].
pub struct ProductEdgeTerminalReceiptReader<'a, R>
where
    R: ProductEdgeTerminalReceiptReadSource,
{
    receipts: &'a R,
}

impl<'a, R> ProductEdgeTerminalReceiptReader<'a, R>
where
    R: ProductEdgeTerminalReceiptReadSource,
{
    pub(crate) const fn new(receipts: &'a R) -> Self {
        Self { receipts }
    }
}

impl<R> ProductEdgeTerminalReceiptReader<'_, R>
where
    R: ProductEdgeTerminalReceiptReadSource,
{
    /// Reads exactly one canonical terminal receipt for the requested scheduled scan attempt.
    pub fn read(
        &self,
        attempt_id: &AttemptId,
    ) -> Result<ScannerReceipt, ProductEdgeReceiptReadError> {
        let receipt = self
            .receipts
            .find(attempt_id)
            .map_err(ProductEdgeReceiptReadError::from)?
            .ok_or_else(|| ProductEdgeReceiptReadError::NotFound {
                attempt_id: attempt_id.clone(),
            })?;

        if receipt.attempt_id() != attempt_id {
            return Err(ProductEdgeReceiptReadError::IdentityConflict {
                requested: Box::new(attempt_id.clone()),
                returned: Box::new(receipt.attempt_id().clone()),
            });
        }
        Ok(receipt)
    }
}

impl From<ReceiptStoreError> for ProductEdgeReceiptReadError {
    fn from(error: ReceiptStoreError) -> Self {
        match error {
            ReceiptStoreError::SemanticConflict { attempt_id } => {
                Self::StoreSemanticConflict { attempt_id }
            }
            ReceiptStoreError::Unavailable { evidence } => Self::Unavailable { evidence },
        }
    }
}
