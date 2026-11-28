- Paper: a strategy that subscribes to `Metrics` in `on_start` and declares `PAPER_RECOVERY = 1` is checkpointed and
  recovers again; before, every checkpoint was deferred for the whole run. A recovery follows the contract's metrics
  from the checkpoint's cut and hands the rows it missed to `on_data` from Binance's REST, in time order with the
  back-filled aggregated bars; an order submitted on such a row is checked as one on a back-filled bar (refused without
  a declared aggregation's warm-up minutes). A cut waits while a followed row is due and not handed over, and
  following or unfollowing metrics once the run is under way still defers every checkpoint.
