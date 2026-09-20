use vibe_scanner::{AttemptId, CommitOutcome, ReceiptStoreError, ScannerReceipt, TerminalReceiptStore};
use vibe_scanner_custody::ProductEdgeTerminalReceiptReadSource;

struct CallerStore;

impl TerminalReceiptStore for CallerStore {
    async fn find(&self, _: &AttemptId) -> Result<Option<ScannerReceipt>, ReceiptStoreError> {
        unimplemented!()
    }

    async fn commit_or_join(&self, _: ScannerReceipt) -> Result<CommitOutcome, ReceiptStoreError> {
        unimplemented!()
    }
}

impl ProductEdgeTerminalReceiptReadSource for CallerStore {}

fn main() {}
