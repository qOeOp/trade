- The `candidate new` scaffold's `equity(event_ns)` reads the account as of the minute before the deciding close instead
  of `portfolio.equity`, so Paper and replay size an entry alike while other positions are open, until a funding
  settlement with a position open (Paper's account books none). Published sources keep their own helper: copy the new one into a new revision.
