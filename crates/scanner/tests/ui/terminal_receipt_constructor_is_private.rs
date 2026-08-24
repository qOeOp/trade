#![allow(unreachable_code)]

use vibe_scanner::{ScannerReceipt, StrategyDisposition};

fn main() {
    let _receipt = ScannerReceipt::incomplete_known(
        panic!("attempt id is irrelevant to the visibility check"),
        panic!("attempt meaning is irrelevant to the visibility check"),
        std::iter::empty::<StrategyDisposition>(),
        panic!("terminal reason is irrelevant to the visibility check"),
    );
}
