# Ronnie source-chart acceptance cases

These cases test whether a mechanical rule expresses what the author describes. They are not economic validation samples or historical Binance futures fills. TradingView drawings use spot or gold charts; the native backtest remains Binance USDT perpetuals. A variant must state its expected native signal/order behavior for these cases before reading annual PnL, and retain disagreements.

## C01 - four-hour range edge

[2024-10-28 original video](https://video-ideas.tradingview.com/1/1416280-Bf_rqWB7C_1tcMiE.mp4), 01:01-02:05. BTC is in a four-hour range; an edge where a rising trend line meets horizontal support is preferred. A proposed range/confluence rule must distinguish edge from middle and state which already-closed bars establish the range before an order exists.

## C02 - wick and support zone

The same video, 02:10-03:15. An ETH wick-only penetration is not a confirmed break; support is a zone. A close-based break must not fire on the wick alone, and a structural stop must sit outside the chosen zone.

## C03 - conditional multi-timeframe targets

[2025-01-03 original video](https://video-ideas.tradingview.com/1/1416280-CE95nknsvjzFWTbV.mp4), 03:39-05:34; 04:24 original frame (`/Users/vx/.local/share/bilibili-note-mcp/notes/note-abe46396788340e491006e35561f6e42/images/source-1-1.png`). An ETH four-hour range break/retest precedes conditional four-hour, daily and weekly resistance targets. A multi-timeframe exit must identify the next already-known resistance at entry, handle repeated role reversals as new decisions, and avoid treating all drawn arrows as concurrent orders.

## C04 - range middle is idle

The same video, 08:58-09:23; 09:19 original frame (`/Users/vx/.local/share/bilibili-note-mcp/notes/note-abe46396788340e491006e35561f6e42/images/source-1-10.png`). Gold range quarters call for no trade in the middle, while trend-line context can give a different plan. A proposed location filter must define its range and middle exclusion before backtesting and report conflict with the trend reading. Gold checks source interpretation only.

## C05 - staged and conditional plans

[2025-02-25 original video](https://video-ideas.tradingview.com/1/1416280-nNo75ZxC6tXOfNoT.mp4), 00:24-01:24; 00:31 original frame (`/Users/vx/.local/share/bilibili-note-mcp/notes/note-f112d7ceacb147d180327781b0db6d58/images/source-1-3.png`). A BTC short plan has a stop and three named targets. After a support-band touch, the author considers a separate long and avoids chasing a short. A staged exit must use actual native partial fills and preserve protection for the remainder; the later long is a new conditional plan, not simultaneous hedging.

## C06 - trend and instrument context

[2025-02-21 original video](https://video-ideas.tradingview.com/0/0-aKWKvFZAvw_fZ4AQ.mp4), 00:00-01:28 and 04:03-05:45. OM rising lows/new highs favor a trend pullback long; BTC range middle is avoided; ETH has a distinct bearish bias. Context rules must be instrument-specific and must not turn every local retracement into a countertrend reversal.

Fast video-note transcripts and source frames are stored under the note IDs in `RD_EXPERIMENTS.md` S01-S04. Audio was not independently reviewed. These cases specify source fidelity, not an indicator preset; a future Agent may choose another encoding and retain the old attempt and disagreement.

## H03 fidelity read

The registered H03 four-hour box rule passed synthetic geometry checks for C02's close requirement, C03's conditional break/retest order, and C04's idle range middle. These checks demonstrate the code's stated geometry, not that a 60-bar box exactly matches the author's drawn ETH band. C03's later daily/weekly target sequence is absent. C01's range-edge support long without a fresh closing breakout and C05's staged exits are absent. The native 37-coin replay therefore tests a bounded mechanical subrule; its score must not be described as Ronnie's full strategy.
