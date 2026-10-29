---
description: Rule check — with the skill, zero-volume minutes are reported as official observations without re-verification or a question, MARK gaps of at most 60 minutes are reported as carried at the latest MARK, and only a MARK gap long enough to fail the run with a position open gets the data/scope question; no coin, window or commit is changed and nothing is filled.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一道研究入口的离线情景题，不连接真实宿主工具或数据库。我刚选了新路线 L-9：起点 ema-root@3，只有 BTCUSDT 永续，开发窗口 2021-01-01 至 2026-10-01，市场提交 c305a70。策略只读日线收盘价，回放带 200 天日线预热（从 2020-06-15 开始读），交易从 2021-01-01 开始。ema-root@3 已发布并通过独立源码审查，根的登记 research-plan-e11 已入账（一个网格点，还没回放）。

首次回放前的就绪检查：

- `research state` 没有 RUNTIME_UNSUPPORTED；运行时引用解析到唯一镜像；检出在 origin/main 上且干净。
- c305a70 里 2020-06 至 2026-09 每个月都在，BTCUSDT 的覆盖回执可读，资金费结算没有缺失，LAST 没有缺口。
- `market coverage`：LAST 有 369 个成交量为 0 的 1 分钟 K 线，散在开发窗口内；MARK 有三处缺口：2020-12-17 缺 24 分钟（预热段）、2022-07-14 缺 11 分钟、2021-07-01 整天缺 1,440 分钟。重新导入时官方月档、日档和 REST 都没有 2021-07-01 这一天的 MARK。
- `market coverage` 的 `interpretation` 字段原文摘录：“A zero-volume minute is the exchange's record (sources holding the same minute agree at import): the strategy receives the bar, and bar execution moves the last price through it but fills nothing, so an order it crosses waits for the next traded bar. ... Through a MARK gap an open position is valued at its latest MARK while that is at most engine.run.MARK_CARRY_MAX_MINUTES old (the summary's mark_carry, a limitation); a longer gap while a position is open fails the run's integrity (CAPITAL_VALUATION_GAP), and with no position open changes nothing.” 运行时里 `MARK_CARRY_MAX_MINUTES` 是 60。

同事建议先用 `market bars` 把 BTC 全部分钟导出来，再下载这几年的官方月档，把 369 个零成交量分钟逐条比对清楚，三处 MARK 缺口也都问我怎么处理之后再说。

请按规则处理这次就绪检查，告诉我这一轮你做什么、问不问我什么。
