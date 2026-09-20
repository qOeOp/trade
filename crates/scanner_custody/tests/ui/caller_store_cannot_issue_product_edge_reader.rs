use vibe_scanner_custody::{ProductEdgeTerminalReceiptReadSource, ProductEdgeTerminalReceiptReader};

/// The read capability is issued by the Scanner-owned store over itself, never minted by a caller.
///
/// `Scanner` used to hand it out; it no longer can, because the seal lives here. This pins the
/// property that replaced it: the constructor is private to this crate, so possessing a sealed
/// store is the only way to obtain a reader over it.
fn caller_mints_a_reader<R: ProductEdgeTerminalReceiptReadSource>(
    store: &R,
) -> ProductEdgeTerminalReceiptReader<'_, R> {
    ProductEdgeTerminalReceiptReader::new(store)
}

fn main() {
    let _ = caller_mints_a_reader::<()>;
}
