use vibe_scanner_custody::{ProductEdgeTerminalReceiptReadSource, ProductEdgeTerminalReceiptReader};

fn caller_selected<R: ProductEdgeTerminalReceiptReadSource>(
    store: &R,
) -> ProductEdgeTerminalReceiptReader<'_, R> {
    ProductEdgeTerminalReceiptReader { receipts: store }
}

fn main() {}
