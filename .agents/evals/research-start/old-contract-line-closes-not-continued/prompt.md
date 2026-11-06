---
description: Rule check — with the skill, a new session whose research state shows a RUNTIME_UNSUPPORTED gate, with moving the runs already refused, tells the user plainly that the open line is on the old runtime contract and can only be closed and restarted on the new one; it does not offer to continue the line, propose or create a Goal for it, or register, replay or write a line record before the user answers.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

（新会话）research-start

账本状态：`research state` 的 `open_lines` 只有一条路线 `research-line-20261022-ema-cross-btc-daily`（起点 `ema-cross-root@2`，开发窗口 2025-10-01 至 2026-10-01），`research state` 的 `targets` 为该路线自己的目标（最大回撤 0.15，年化收益 0.20）。最新推荐是 judgment 257，推荐 `ema-entryvar@2` 与 `ema-fixed-dailyspec@1`；最新优先级 judgment 254 以 `ema-fixed-dailyspec@1` 为对照。这条路线的 `research state` 的 `gates` 只有一项：

```json
{"code": "RUNTIME_UNSUPPORTED", "message": "the line's candidates and their runs are on replay-contract@v6, which this product cannot replay (it runs replay-contract@v7); move its runs with `replay reproduce --image`, and when that is refused the line can only be closed and research restarted on replay-contract@v7", "missing": ["ema-entryvar@2", "ema-fixed-dailyspec@1"]}
```

这两个候选的运行上一轮已经试过迁移：`replay reproduce --image <当前镜像>` 都被拒绝，`REPRODUCTION_MISMATCH`，消息里写着 tables: fills, positions。

这个 Codex 宿主提供 `create_goal`，但只允许在用户明确授权后调用；当前没有进行中的目标。

请给出你这一轮的回复和你会调用的工具。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
