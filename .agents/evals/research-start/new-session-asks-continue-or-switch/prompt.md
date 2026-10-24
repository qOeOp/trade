---
description: Rule check — with the skill, a new session started with only research-start on a ledger with a recorded line asks once whether to continue that line (giving its state and next step) or choose another, and does no registration, replay or line record until the user answers; when the host needs authorization to create the Goal, the concrete objective is in the same question.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

（新会话）research-start

账本状态：当前路线 `research-line-20261022-ema-cross-btc-daily`（起点 `ema-cross-root@2`，开发窗口 2025-10-01 至 2026-10-01），路线记录 note 写着目标「最大回撤不超过 15%，年化不低于 20%」。最新推荐是 judgment 253，推荐 `ema-fixed-dailyspec@1`（trial 67）；最新优先级 judgment 252 的首位动作是「固定间隔刷新交易方向」；`gates` 为空，`unclosed_lines` 为空。这个 Codex 宿主提供 `create_goal`，但只允许在用户明确授权后调用；当前没有进行中的目标。

请给出你这一轮的回复和你会调用的工具。
