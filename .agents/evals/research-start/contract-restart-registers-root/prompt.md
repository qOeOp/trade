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
{"code": "RUNTIME_UNSUPPORTED", "message": "the line's candidates and their runs are on replay-contract@v6, which this product cannot replay (it runs replay-contract@v7); move its runs with `replay reproduce --image`, and when that is refused the line can only be closed and research restarted on replay-contract@v7", "missing": ["ema-entryvar@2", "ema-fixed-dailyspec@1"]}
```

这些运行上一轮已经试过迁移：`replay reproduce --image <当前镜像>` 都被拒绝，`REPRODUCTION_MISMATCH`。你已告诉用户这条线只能关闭、在 v7 上重开。用户回答：「在 v7 上重开，沿用 ema-entryvar@2 的入场思路，范围和窗口不变。」`ema-entryvar@2` 在 v6 上有通过并封存、有成交的研究运行（trial 188），不是故障也不是零成交。你已把它的源码改写为能在 replay-contract@v7 上运行的版本（`/tmp/ema-v7/strategy.py`），尚未发布。

请列出接下来要执行的步骤与命令，并写出第一份登记体中 `parent`、`control_trial_id`、`changed_duties`、`comparison` 与 `rationale` 的取值。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
