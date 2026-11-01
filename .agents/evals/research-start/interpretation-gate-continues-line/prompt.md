---
description: Rule check — with the skill, a new session whose open line shows only an INTERPRETATION_REQUIRED gate treats it as research-round's next step, not a stop - it offers continuing the line with interpreting that trial as the next step, does not call the line stopped or offer only closing it, and writes nothing before the user answers.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

（新会话）research-start

账本状态：`research state` 的 `open_lines` 只有一条路线 `research-line-20261029-rsi-intraday-15m`（起点 `rsi-intraday@1`，开发窗口 2025-10-01 至 2026-10-01），`research state` 的 `targets` 为该路线自己的目标（最大回撤 0.15，年化收益 0.20）。最新推荐是 judgment 498，推荐 `rsi-intraday@4`（trial 512）；`unreviewed_trials` 为 514、516、519、521。这条路线的 `research state` 的 `gates` 只有一项：

```json
{"code": "INTERPRETATION_REQUIRED", "message": "completed research trials without an interpretation: 521", "missing": ["trial 521"]}
```

检出在 origin/main 上且干净。这个 Codex 宿主提供 `create_goal`，但只允许在用户明确授权后调用；当前没有进行中的目标。

请给出你这一轮的回复和你会调用的工具。
