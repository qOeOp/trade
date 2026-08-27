use vibe_scanner::{
    MarketSnapshot, ProposalBuilder, Scanner, StrategyLoader, StrategyMatcher, TerminalReceiptStore,
};

fn caller_selected_store<L, S, M, P, R>(scanner: &Scanner<L, S, M, P, R>)
where
    L: StrategyLoader,
    S: MarketSnapshot,
    M: StrategyMatcher,
    P: ProposalBuilder,
    R: TerminalReceiptStore,
{
    scanner.product_edge_terminal_receipts();
}

fn main() {}
