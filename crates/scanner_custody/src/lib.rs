//! Scanner-owned terminal receipt custody, and the Product Edge read capability over it.

pub mod postgres;
pub mod vectors;

pub use postgres::{CommitKindV1, ScannerTerminalReceiptCustodyV1, TerminalReceiptCustodyError};

use vibe_scanner::{AttemptId, OpaqueId, ReceiptStoreError, ScannerReceipt, TerminalReceiptStore};

mod sealed {
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
    /// Issues the read-only capability Product Edge holds over this store.
    ///
    /// The store issues it rather than a composition layer, so the capability cannot exist without
    /// a Scanner-owned store behind it. It exposes no write operation and no store access.
    fn product_edge_terminal_receipts(&self) -> ProductEdgeTerminalReceiptReader<'_, Self>
    where
        Self: Sized,
    {
        ProductEdgeTerminalReceiptReader::new(self)
    }
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
/// [`ProductEdgeTerminalReceiptReadSource::product_edge_terminal_receipts`].
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
    const fn new(receipts: &'a R) -> Self {
        Self { receipts }
    }
}

impl<R> ProductEdgeTerminalReceiptReader<'_, R>
where
    R: ProductEdgeTerminalReceiptReadSource,
{
    /// Reads exactly one canonical terminal receipt for the requested scheduled scan attempt.
    pub async fn read(
        &self,
        attempt_id: &AttemptId,
    ) -> Result<ScannerReceipt, ProductEdgeReceiptReadError> {
        let receipt = self
            .receipts
            .find(attempt_id)
            .await
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

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use vibe_scanner::{
        AttemptId, CommitOutcome, DueSlotBoundary, LocalDateTime, OpaqueId, ReceiptStoreError,
        ScannerReceipt, TerminalReceiptStore, Version, VersionedIdentity,
        parse_untrusted_terminal_receipt_v1,
    };

    use super::{
        ProductEdgeReceiptReadError, ProductEdgeTerminalReceiptReadSource, sealed,
        vectors::{CANONICAL_RECEIPT_V1_HEX, bytes},
    };

    fn held_receipt() -> ScannerReceipt {
        parse_untrusted_terminal_receipt_v1(&bytes(CANONICAL_RECEIPT_V1_HEX))
            .expect("the canonical vector is a receipt; a failure here means the encoding moved")
    }

    /// An attempt that is not the held one, built from the public domain surface only.
    fn other_attempt() -> AttemptId {
        let identity = |value: &str| VersionedIdentity {
            identity: OpaqueId::new(value).expect("a named identity"),
            version: Version::new(1).expect("a non-zero version"),
        };
        AttemptId {
            definition: identity("some-other-definition"),
            scan_scope: identity("some-other-scope"),
            boundary: DueSlotBoundary::Normal {
                local: LocalDateTime::new(2026, 1, 1, 0, 0, 0).expect("a real local time"),
                utc_offset_seconds: 0,
            },
        }
    }

    enum FakeStore {
        Absent,
        Holds(Box<ScannerReceipt>),
        SemanticConflict,
        Unavailable,
    }

    impl TerminalReceiptStore for FakeStore {
        async fn find(
            &self,
            attempt_id: &AttemptId,
        ) -> Result<Option<ScannerReceipt>, ReceiptStoreError> {
            match self {
                Self::Absent => Ok(None),
                Self::Holds(receipt) => Ok(Some(receipt.as_ref().clone())),
                Self::SemanticConflict => Err(ReceiptStoreError::SemanticConflict {
                    attempt_id: attempt_id.clone(),
                }),
                Self::Unavailable => Err(ReceiptStoreError::Unavailable {
                    evidence: OpaqueId::new("store-unreachable").expect("a named identity"),
                }),
            }
        }

        async fn commit_or_join(
            &self,
            _: ScannerReceipt,
        ) -> Result<CommitOutcome, ReceiptStoreError> {
            unreachable!("the Product Edge read capability cannot reach the store write path")
        }
    }

    impl sealed::ScannerOwnedTerminalReceiptStore for FakeStore {}
    impl ProductEdgeTerminalReceiptReadSource for FakeStore {}

    #[tokio::test]
    async fn a_held_receipt_reads_back_whole() {
        let receipt = held_receipt();
        let store = FakeStore::Holds(Box::new(receipt.clone()));
        let read = store
            .product_edge_terminal_receipts()
            .read(receipt.attempt_id())
            .await
            .expect("the store holds exactly this attempt");
        assert_eq!(read, receipt);
        assert_eq!(read.dispositions().len(), 1);
        assert!(read.proposal().is_some());
    }

    /// The four non-positive outcomes must stay four.
    ///
    /// Collapsing any of them into absence is the defect the Owner document names: a store that
    /// holds a conflicting receipt, or cannot be reached, would then read as an attempt that never
    /// scanned, and an absent receipt has its own meaning elsewhere in the contract.
    #[rstest]
    #[tokio::test]
    async fn every_non_positive_outcome_keeps_its_own_name() {
        let requested = held_receipt().attempt_id().clone();

        let absent = FakeStore::Absent
            .product_edge_terminal_receipts()
            .read(&requested)
            .await
            .expect_err("an absent receipt is not a positive read");
        assert!(matches!(
            absent,
            ProductEdgeReceiptReadError::NotFound { ref attempt_id } if *attempt_id == requested
        ));

        // The store answers with a receipt bound to an attempt nobody asked about.
        let mismatched = FakeStore::Holds(Box::new(held_receipt()))
            .product_edge_terminal_receipts()
            .read(&other_attempt())
            .await
            .expect_err("a receipt for another attempt is a detected custody fault");
        assert!(matches!(
            mismatched,
            ProductEdgeReceiptReadError::IdentityConflict { ref requested, ref returned }
                if **requested == other_attempt() && **returned == requested_identity_of_held()
        ));

        let conflict = FakeStore::SemanticConflict
            .product_edge_terminal_receipts()
            .read(&requested)
            .await
            .expect_err("a store semantic conflict is a detected custody fault");
        assert!(matches!(
            conflict,
            ProductEdgeReceiptReadError::StoreSemanticConflict { ref attempt_id }
                if *attempt_id == requested
        ));

        let unavailable = FakeStore::Unavailable
            .product_edge_terminal_receipts()
            .read(&requested)
            .await
            .expect_err("an unreachable store is not an absent receipt");
        assert!(matches!(
            unavailable,
            ProductEdgeReceiptReadError::Unavailable { ref evidence }
                if evidence.as_str() == "store-unreachable"
        ));
    }

    fn requested_identity_of_held() -> AttemptId {
        held_receipt().attempt_id().clone()
    }
}
