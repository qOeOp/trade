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

## C07 - existing DOGE holding versus a late futures entry

[2024-11-19 original video](https://video-ideas.tradingview.com/1/1416280-f1hAXIls3Y2mrc7q.mp4), 00:00-02:31; original daily frame at 02:22 (`/Users/vx/.local/share/bilibili-note-mcp/notes/note-8b5dd062e3f14ba5aa9dd460938a60fa/images/source-1-5.png`). The speaker's prior support order and already profitable holding are different decisions from opening a new leveraged long after the rise, when the structural stop still belongs below the old band. A candidate must state entry time, existing position, market type, stop location and risk budget before interpreting the same support drawing as a trade. The frame does not provide a general maximum stop-distance ratio.

## C08 - ETH support is not broken by a wick or weak first close

[2025-03-10 original video](https://video-ideas.tradingview.com/1/1416280-RDuLm44RB_k-HCh2.mp4), 01:13-03:51; original daily frame at 02:59 (`/Users/vx/.local/share/bilibili-note-mcp/notes/note-e49045be678d4613b06c1a8bb7b3889a/images/source-1-3.png`). Weekly bearish force is acknowledged, but the key role-reversal support may still hold. A wick below the area and one insufficient bearish daily close do not license a fresh short; the next completed daily candle could confirm deeper displacement or reclaim support. A rule must make its already-known zone and close-confirmation semantics explicit; the video supplies no universal numeric body/zone threshold.

## C09 - bullish four-hour BTC range does not imply a resistance short

The same DOGE video at 03:13-04:02 and ETH video at 04:00-04:40. The speaker treats BTC's upper consolidation inside a larger bullish structure as a reason to wait for support/pullback rather than short merely because an upper edge exists. A proposed range strategy must distinguish the directional context and conditional trade choice from a generic symmetric box rule; other source cases allow short attempts at particular higher-timeframe resistance, so this is not a universal short ban.

## C10 - one AAVE chart, two different entry decisions

[2025-03-06 original video](https://video-ideas.tradingview.com/1/1416280--AdDW90B6Qsgj4nx.mp4), 04:01-04:48. The fast transcript and source frame F32 at 04:31.770 are retained under the S07 stage IDs in `RD_EXPERIMENTS.md`; the composed note failed after transcription and frame extraction. On the AAVE daily chart, a prior support/diagonal area is lower than the current price, a nearer overhead zone limits upside, and a valid long stop remains beneath the lower structure. The speaker declines a **fresh long now**, considers a long if price returns to support, and explicitly says the sketched pullback is not a short instruction. A candidate must keep support, obstacle, stop, decision time and current versus existing position separate, then predict idle now and conditional long at the support. The older hand-annotated prices are approximate chart geometry, not an uttered universal ratio or futures fills.

## C11 - IMX support, confirmation and an earlier resting order

[2024-10-11 original video](https://video-ideas.tradingview.com/1/1416280-Js98IM_uEBnfyAGi.mp4), 02:17-03:01; original daily frames F08 at 02:32 and F15 at 02:54 and the complete fast transcript are bound in `results/2026-10-08-s09-imx-trendline-source.json`. The speaker names a key support, a bullish engulfing candle at that support, earlier resting long orders, the stop for anyone filled, continued holding, and the previous high or channel upper edge as a target. A rising diagonal is visible in the chart, but he does not give mechanical anchor selection, a line tolerance, or a **break-then-reclaim** rule in this segment. A candidate must distinguish an order resting before the confirmation candle from deciding after that candle closes; it cannot require the later engulfing to have caused the earlier fill. The separate UNI segment in the same video explicitly calls drawn trend lines revisable hypotheses and places the valid stop below a local low. This source case does not authorize automatically reactivating AAVE's invalidated horizontal support.

## C12 - a broken BTC band and a separate intact low

[2024-09-09 original video](https://video-ideas.tradingview.com/1/1416280-4cBG81UxU6nlrhsZ.mp4), 00:10-03:00; full fast transcript and original daily frames F29 at 01:27.990, F17 at 01:44.350 and F06 at 02:15.310 are bound in `results/2026-10-08-s10-btc-rebound-source.json`. The speaker says the earlier near-56,000 horizontal support broke, while the distinct August 5 low was not broken and remained support. Returning above the near-56,000 band and continuing down a channel are future alternatives, not a confirmed reclaim at the video decision. His action is to hold existing spot and mostly wait; no new futures long and structural stop are specified. A candidate must keep the broken band, still-intact lower low, conditional future reclaim, existing spot position and new futures entry separate. It cannot restore the broken band just because price bounced or treat an arrow as an already submitted order.

Fast video-note transcripts and source frames are stored under the note IDs in `RD_EXPERIMENTS.md` S01-S04 and S06. Audio was not independently reviewed. These cases specify source fidelity, not an indicator preset; a future Agent may choose another encoding and retain the old attempt and disagreement.

## H03 fidelity read

The registered H03 four-hour box rule passed synthetic geometry checks for C02's close requirement, C03's conditional break/retest order, and C04's idle range middle. These checks demonstrate the code's stated geometry, not that a 60-bar box exactly matches the author's drawn ETH band. C03's later daily/weekly target sequence is absent. C01's range-edge support long without a fresh closing breakout and C05's staged exits are absent. The native 37-coin replay therefore tests a bounded mechanical subrule; its score must not be described as Ronnie's full strategy.
