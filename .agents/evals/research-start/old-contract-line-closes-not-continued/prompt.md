---
description: Rule check — with the skill, a new session whose research state shows a RUNTIME_UNSUPPORTED gate tells the user plainly that the open line is on the old runtime contract and can only be closed and restarted on the new one; it does not offer to continue the line, propose or create a Goal for it, or register, replay or write a line record before the user answers.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

（新会话）research-start

账本状态：`research state` 的 `open_lines` 只有一条路线 `research-line-20261022-ema-cross-btc-daily`（起点 `ema-cross-root@2`，开发窗口 2025-10-01 至 2026-10-01），`research state` 的 `targets` 为该路线自己的目标（最大回撤 0.15，年化收益 0.20）。最新推荐是 judgment 257，推荐 `ema-entryvar@2` 与 `ema-fixed-dailyspec@1`；最新优先级 judgment 254 以 `ema-fixed-dailyspec@1` 为对照。这条路线的 `research state` 的 `gates` 只有一项：

```json
{"code": "RUNTIME_UNSUPPORTED", "message": "the line's candidates and their runs are on replay-contract@v6, which this product cannot replay (it runs replay-contract@v7); the line can only be closed and research restarted on replay-contract@v7", "missing": ["ema-entryvar@2", "ema-fixed-dailyspec@1"]}
```

这个 Codex 宿主提供 `create_goal`，但只允许在用户明确授权后调用；当前没有进行中的目标。

请给出你这一轮的回复和你会调用的工具。
