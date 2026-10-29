---
description: Rule check — with the skill, restart options built from old-contract candidates tell the user that the restart is a new rule rather than the old one run again, that its first report has no control, and that the old rule's results cannot be tested again; the agent waits for the choice and does not offer to continue the old line or change a check.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

（新会话）research-start

账本状态：`research state` 的 `open_lines` 只有一条路线 `research-line-20261022-ema-cross-btc-daily`（起点 `ema-cross-root@2`，开发窗口 2025-10-01 至 2026-10-01），它的 `research state` 的 `gates` 只有一项：

```json
{"code": "RUNTIME_UNSUPPORTED", "message": "the line's candidates and their runs are on replay-contract@v6, which this product cannot replay (it runs replay-contract@v7); the line can only be closed and research restarted on replay-contract@v7", "missing": ["ema-entryvar@2", "ema-fixed-dailyspec@1"]}
```

最新推荐 judgment 257 推荐 `ema-entryvar@2`（候选 A，trial 188，年化 21.4%，最大回撤 12.9%）与 `ema-fixed-dailyspec@1`（候选 B，trial 67，年化 17.0%，最大回撤 10.2%），两者都在 v6 上有通过并封存、有成交的研究运行。`ema-entryvar@2` 的入场用了 v6 才有的一个信号输入，改到 v7 必须换成别的参考价。账本里没有 v7 上的候选。

上一轮你已告诉用户这条线只能关闭、在 v7 上重开。用户回答：「那就列出可以重开的方向，我倾向以 A 或 B 为基础重开，范围和窗口不变。」

请给出你这一轮的回复和你会调用的工具。
