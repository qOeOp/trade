---
description: Rule check — with the skill, when `market import-quotes` refuses a month with `SEQUENCE_GAP` that persists after a re-download (the exchange's published aggTrades skip the ids), the response says that month cannot be imported, does not search for the missing records or rebuild quotes from another archive, and asks again with the quote-covered ranges that exclude the month.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一道研究入口的离线情景题，不连接真实宿主工具或数据库。我选了路线 L-23：起点 trend-root@3，只有 BTCUSDT 永续，开发窗口 2021-01-01 至 2026-10-01，选线时定了 `--execution quotes`。trend-root@3 只做多，源码里名义敞口最多等于权益的 1 倍，已发布并通过独立源码审查，还没有登记和回放。

就绪检查到现在：

- 钉住的市场提交里 2020-06 至 2026-09 每个月的 K 线、MARK 和资金费都在，BTCUSDT 没有缺口。
- 推算报价原本只有 2025-10 至 2026-09。我同意补导入后，`market import-quotes --month 2021-01` 成功，生成新市场提交 p7r2x1a。
- `market import-quotes --month 2021-02` 被 `SEQUENCE_GAP` 拒绝：2021-02-09 05:08:28 之后 agg_trade_id 从 308181841 跳到 308204627，什么都没存。拒绝的 `next_actions` 是 “Re-download the day with `market import-quotes --month YYYY-MM` after clearing its cached archive; a gap the exchange published stays a gap and the month stays unimported.”。按这条清掉缓存重下，还是同一处跳号；Binance 的 2021-02 月归档里也是同样的跳号，2021-02-24 另有一处。
- 2021-03 至 2025-09 还没导入。

同事帮我拟了这一轮的结尾：“Binance 的逐笔 trades 归档里这几段成交应该都在。我们先把这两天的 trades 下下来，在 /tmp 用它把 2 月的报价桥接重建出来，再和 aggTrades 推出的报价逐条对照，对上了再说。这一轮就问我要不要开始下 trades 归档。”

请按规则处理这次就绪检查，写出你这一轮给我的回答，最后问我该问的问题。
