- The `candidate new` scaffold's `equity(event_ns)` no longer reads a balance of 0 when the latest account update lists
  another currency only (a Live one may); it returns None when the account holds none of the quote currency.
