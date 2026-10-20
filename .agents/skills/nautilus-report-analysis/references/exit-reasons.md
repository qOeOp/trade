# Exit reasons

Read before an entry-plan × exit-reason table or splitting contributions by exit.

- Build the table from `tables()` cycles of an eligible run: one row per entry-plan
  tag, one column per exit category, each cell the closed count and closed net PnL with price PnL,
  commissions and funding apart. The exit category is only the closing order's tag or order type
  (`closing_order_tags`, the order of `closing_order_id`), never the sign of PnL or a price level.
  An untagged close at delisting belongs to a plan only when it matches the settlement event, cycle
  and plan uniquely; otherwise it is "unattributed". Open positions get their own row, in no exit
  category. Totals equal the report's closed split. When the plan readings are masked, give the
  reason and no table.
