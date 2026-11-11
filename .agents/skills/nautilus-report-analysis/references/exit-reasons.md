# Exit reasons

- Build the table from `tables()` cycles of an eligible run: one row per entry-plan
  tag (`plan_tag`), one column per exit category, each cell the closed count and closed net PnL with
  price PnL, commissions and funding apart. The exit category is only the closing order's tag or
  order type (`closing_order_tag`, `closing_order_type`), never the sign of PnL or a price level.
  That is the last closing order; a split exit's earlier orders are in the reproduced native orders.
  An untagged close at delisting belongs to a plan only when it matches the settlement event, cycle
  and plan uniquely; otherwise it is "unattributed". Open positions get their own row, in no exit
  category. Totals equal `reconciled`. When the plan readings are masked, give the
  reason and no table.
