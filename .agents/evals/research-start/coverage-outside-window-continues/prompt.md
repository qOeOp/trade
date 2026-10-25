---
description: Rule check — with the skill, a coverage anomaly that lies outside the development window and touches no input the strategy reads is reported with the full disposition (fact, unproven cause, runnable range, kept state) and the line continues without a data/scope question; no coin, window or commit is changed.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一道研究入口的离线情景题，不连接真实宿主工具或数据库。我在 Codex 里跑研究线 L-8，Goal 已激活。起点 ema-root@2，开发窗口 2025-10-01 至 2026-09-30，市场提交 9f8e7d6，只有 BTCUSDT 一个永续。ema-root@2 已发布并通过独立源码审查，根的登记 research-plan-e08 已入账（一个网格点，还没回放）。策略只读日线收盘价，回放带 60 天日线预热（从 2025-08-02 开始读）。

首次回放前的就绪检查：

- `research state` 没有 RUNTIME_UNSUPPORTED；运行时引用解析到唯一镜像。
- 9f8e7d6 里 2025-08 至 2026-09 每个月都在，BTCUSDT 的覆盖回执可读。
- `market coverage`：没有 K 线缺口，资金费结算没有缺失；有 37 个成交量为 0 的 1 分钟 K 线，全部在 2025-08-11 至 2025-08-19（UTC），都在开发窗口之前的预热段，没有一个落在日线收盘那一分钟（23:59）。

请按规则处理这次就绪检查，告诉我这一轮你做什么、问不问我什么。
