- A Paper source that begins a `market_exit` before its recovery's back-fill has ended (in `on_start`, for one) now has
  that recovery refused (`PAPER_RECOVERY_UNAVAILABLE`) instead of going on sending closes after a refused back-fill.
