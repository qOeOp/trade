#![allow(unreachable_code)]

use vibe_scanner::{ProductEdgeTerminalReceiptReadSource, ProductEdgeTerminalReceiptReader};

fn commit<R: ProductEdgeTerminalReceiptReadSource>(
    reader: ProductEdgeTerminalReceiptReader<'_, R>,
) {
    reader.commit_or_join(panic!("receipt is irrelevant to the capability check"));
}

fn main() {}
