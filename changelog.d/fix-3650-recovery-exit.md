- Breaking (replay, Paper, Live): a source's `market_exit()` before its warm-up has ended and its `on_start` has run
  breaks the order rules (`ORDER_RULE`, rule 8) and is not begun, as an order then already is: the native exit sent its
  MARKET closes past the rule. A Paper recovery's source can no longer start an exit from its history callbacks or
  `on_load` that would go on closing after the recovery is refused (#3650).
