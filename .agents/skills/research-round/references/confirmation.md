# Confirmation

The clean test for an Agent-developed candidate is market data that did not exist when it was
frozen. Nothing needs to be collected in advance: a window is independent because the confirmation
plan was registered and timestamped before the window began. Data after the development window that
already exists is not new; name the window by its start, not by a calendar period.

1. **Plan.** After a passed freeze, register the window with `confirm plan`
   ([records.md](records.md)). Its start must lie after the registration (server time) and after the
   plan's RFC 3161 timestamp, which `confirm plan` requests at once (if it fails, run
   `ledger witness` before the window starts, or the plan can never confirm). Choose its length
   from the frozen run's plan frequency so that it can hold at least 100 closed plans.
2. **Wait** until the window has passed.
3. **Build inputs** for that window and run the frozen revision once, sealed, on a main image, with
   the frozen run's coins and account ([runs.md](runs.md)).
4. **Judge** with `confirm verdict`. The product checks that the run uses the frozen source inside
   the window, that the plan was timestamped before the window began, and judges it against the
   user's three targets at the full drawdown budget with at least 100 closed plans.

One plan per freeze. A used window is development-exposed afterwards; data from before the plan's
registration is never independent. A short window can refute an obvious failure but cannot
establish a high return.
