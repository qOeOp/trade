use vibe_scanner::{CapacityViewCut, MarketFactCut, UntrustedCapacityViewRetentionV1};

fn main() {
    // The validating parser is the only way canonical bytes become a committed cut. Assembling one
    // field by field would skip every check the receipt still witnesses.
    let _market = MarketFactCut::reconstruct;
    let _capacity = CapacityViewCut::reconstruct;
    let _retention = UntrustedCapacityViewRetentionV1::default();
}
