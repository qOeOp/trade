# Replay Accounting

Owns deterministic monetary primitives, post-fill Position Projection, EventKey-ordered cash evidence, and the settlement-asset journal/trial-balance projection used by certified Replay capabilities.

It may calculate adverse slippage, trade/liquidation charges, exact funding, average-cost PnL, post-Fill Position, cash, Equity v1, Journal v4, Trial Balance, and Margin v6 snapshots. Liquidation fee is a distinct ledger fact and expense account; it cannot be folded into trade fee or deducted twice. Accounting does not decide whether a source event triggers liquidation. Dynamic collateral, deficit/insurance/ADL, partial liquidation, grid-interior execution, borrow, cross margin, and shared portfolio allocation remain unsupported.
