export type ReplayPortfolioTerminalJournalAccount =
  | "wallet_cash"
  | "isolated_margin_collateral"
  | "position_valuation"
  | "opening_equity"
  | "realized_pnl_income"
  | "realized_pnl_loss"
  | "funding_income"
  | "funding_expense"
  | "fee_expense"
  | "liquidation_fee_expense"
  | "unrealized_pnl_income"
  | "unrealized_pnl_loss"

export type ReplayPortfolioTerminalPostingKind =
  | "opening_cash"
  | "collateral_reserve"
  | "entry_fee"
  | "funding"
  | "realized_pnl"
  | "terminal_trading_fee"
  | "liquidation_fee"
  | "collateral_release"
  | "terminal_mark_to_market"

export interface ReplayPortfolioTerminalJournalEvent {
  kind: "entry" | "funding" | "terminal" | "terminal_mark"
  funding_cashflow: number
  record: {
    isolated_collateral: number
    entry_fee: number
    realized_pnl: number
    exit_trading_fee: number
    liquidation_fee: number
    released_collateral: number
    ending_unrealized_pnl: number
  }
}

export type ReplayPortfolioTerminalJournalPost<T> = (
  event: T | null,
  kind: ReplayPortfolioTerminalPostingKind,
  debit: ReplayPortfolioTerminalJournalAccount,
  credit: ReplayPortfolioTerminalJournalAccount,
  amount: number,
  accountingOrdinal: number | null,
) => void

export function appendReplayPortfolioTerminalJournal<T extends ReplayPortfolioTerminalJournalEvent>(
  openingCash: number,
  events: readonly T[],
  post: ReplayPortfolioTerminalJournalPost<T>,
): void {
  post(null, "opening_cash", "wallet_cash", "opening_equity", openingCash, null)
  events.forEach((event, index) => {
    const ordinal = index + 1
    if (event.kind === "entry") {
      post(event, "collateral_reserve", "isolated_margin_collateral", "wallet_cash",
        event.record.isolated_collateral, ordinal)
      post(event, "entry_fee", "fee_expense", "wallet_cash", event.record.entry_fee, ordinal)
      return
    }
    if (event.kind === "funding") {
      postSigned(event, "funding", event.funding_cashflow, "funding_income", "funding_expense", ordinal, post)
      return
    }
    if (event.kind === "terminal") {
      postSigned(event, "realized_pnl", event.record.realized_pnl,
        "realized_pnl_income", "realized_pnl_loss", ordinal, post)
      post(event, "terminal_trading_fee", "fee_expense", "wallet_cash", event.record.exit_trading_fee, ordinal)
      post(event, "liquidation_fee", "liquidation_fee_expense", "wallet_cash", event.record.liquidation_fee, ordinal)
      post(event, "collateral_release", "wallet_cash", "isolated_margin_collateral",
        event.record.released_collateral, ordinal)
      return
    }
    if (event.record.ending_unrealized_pnl > 0) {
      post(event, "terminal_mark_to_market", "position_valuation", "unrealized_pnl_income",
        event.record.ending_unrealized_pnl, ordinal)
    } else if (event.record.ending_unrealized_pnl < 0) {
      post(event, "terminal_mark_to_market", "unrealized_pnl_loss", "position_valuation",
        -event.record.ending_unrealized_pnl, ordinal)
    }
  })
}

function postSigned<T>(
  event: T,
  kind: "funding" | "realized_pnl",
  amount: number,
  income: "funding_income" | "realized_pnl_income",
  expense: "funding_expense" | "realized_pnl_loss",
  accountingOrdinal: number,
  post: ReplayPortfolioTerminalJournalPost<T>,
): void {
  if (amount > 0) post(event, kind, "wallet_cash", income, amount, accountingOrdinal)
  if (amount < 0) post(event, kind, expense, "wallet_cash", -amount, accountingOrdinal)
}
