- Breaking (Live, D-102): a Live run trades either the real Binance account or Binance Demo Trading, chosen by the
  Live page's Live/Demo switch and kept in its manifest (`config.environment`, manifest format `live-run-6`; runs of
  `live-run-5` are not read). A demo run uses the demo hosts for trading, account reads, klines, funding and its kline
  side connection, production's REST host for metrics, and an egress that admits those hosts alone; it skips the key
  permission check (demo serves none) and keeps every other gate, `TERMS_CHANGED` included. Saved keys are kept per
  environment under `credentials/<environment>/` (the old `credentials/` layout is not read; save the key again), and
  a run binds a key of its own environment only. Telegram, the daily summary, the Live page and `live compare` label
  demo runs, and a demo comparison says it is no evidence of consistency. Field approvals: the user, 2026-11-21,
  「同意」 and 「为什么只存一把 这是两个不同的环境吧 应该有按钮切换 demo 和 live都有各自的key才对吧」.
