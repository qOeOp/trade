use vibe_scanner::{
    AttemptId, CommitOutcome, ProductEdgeTerminalReceiptReadSource, ReceiptStoreError,
    ScannerReceipt, TerminalReceiptStore,
};

struct CallerStore;

impl TerminalReceiptStore for CallerStore {
    fn find(&self, _: &AttemptId) -> Result<Option<ScannerReceipt>, ReceiptStoreError> {
        unimplemented!()
    }

    fn commit_or_join(&self, _: ScannerReceipt) -> Result<CommitOutcome, ReceiptStoreError> {
        unimplemented!()
    }
}

impl ProductEdgeTerminalReceiptReadSource for CallerStore {}

fn main() {}
