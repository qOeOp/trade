use vibe_scanner::{ProductEdgeTerminalReceiptReadSource, ProductEdgeTerminalReceiptReader};

fn caller_selected<R: ProductEdgeTerminalReceiptReadSource>(
    store: &R,
) -> ProductEdgeTerminalReceiptReader<'_, R> {
    ProductEdgeTerminalReceiptReader { receipts: store }
}

fn main() {}
