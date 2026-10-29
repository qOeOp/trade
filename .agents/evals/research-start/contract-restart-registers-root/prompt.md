---
description: Rule check — with the skill, research the user restarts on a new runtime contract from an old-contract candidate's idea begins as a root; the carried source is published without a parent and its first registration has no parent, no control, empty changed_duties and no comparison, with the old idea in its rationale; the old-contract candidate is never named as parent or control.
tags: [method]
plugins: ["../../.."]
max_turns: 14
allowed_tools: [Read, Glob, Grep, Skill]
---

（新会话）research-start

账本状态：`research state` 的 `open_lines` 只有一条路线 `research-line-20261022-ema-cross-btc-daily`（起点 `ema-cross-root@2`，开发窗口 2025-10-01 至 2026-10-01）。它的 `research state` 的 `gates` 只有一项：

```json
{"code": "RUNTIME_UNSUPPORTED", "message": "the line's candidates and their runs are on replay-contract@v6, which this product cannot replay (it runs replay-contract@v7); the line can only be closed and research restarted on replay-contract@v7", "missing": ["ema-entryvar@2", "ema-fixed-dailyspec@1"]}
```

上一轮你已告诉用户这条线只能关闭、在 v7 上重开。用户回答：「在 v7 上重开，沿用 ema-entryvar@2 的入场思路，范围和窗口不变。」`ema-entryvar@2` 在 v6 上有通过并封存、有成交的研究运行（trial 188），不是故障也不是零成交。你已把它的源码改写为能在 replay-contract@v7 上运行的版本（`/tmp/ema-v7/strategy.py`），尚未发布。

请列出接下来要执行的步骤与命令，并写出第一份登记体中 `parent`、`control_trial_id`、`changed_duties`、`change`、`comparison` 与 `rationale` 的取值。
