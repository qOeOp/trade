# Exit reasons

- The single-run report (`replay report --trial-id RUN`) gives each closing order type's closed net
  PnL as `top_exit_share.exit_net`, open cycles excluded: read that split there, never recompute it.
- For a split it does not give (by entry plan, by closing tag, or with its parts apart), build the
  table from `tables()` cycles of an eligible run: one row per entry-plan tag (`plan_tag`), one
  column per exit category, each cell the closed count and closed net PnL with price PnL,
  commissions and funding apart. The exit category is only the closing order's tag or
  order type (`closing_order_tag`, `closing_order_type`), never the sign of PnL or a price level.
  That is the last closing order; a split exit's earlier orders are in the reproduced native orders.
  An untagged close at delisting belongs to a plan only when it matches the settlement event, cycle
  and plan uniquely; otherwise it is "unattributed". Open positions get their own row, in no exit
  category. Totals equal `reconciled`. When the plan readings are masked, give the
  reason and no table.
