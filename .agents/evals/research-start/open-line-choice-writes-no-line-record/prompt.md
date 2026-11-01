---
description: Rule check — with the skill, when the user chooses a line that is already open, the Agent continues that line, naming it with `--line`, and writes no line record (no `line select`), because the open line already has its record.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

（新会话）research-start

你上一轮读了账本：`research state` 的 `open_lines` 有两条路线：

- A：`research-line-20261020-ema-cross-btc-daily`（起点 `ema-cross-root@2`，开发窗口 2025-10-01 至 2026-10-01，市场提交 `c41d9e0`）
- B：`research-line-20261028-brk-breakout-eth`（起点 `brk-root@3`，开发窗口 2024-01-01 至 2026-01-01，市场提交 `c41d9e0`）

两条都没有门槛，`targets` 都是账本默认值（最大回撤 0.15，年化收益 0.20）。B 的最新推荐是 judgment 412，推荐 `brk-root@5`；最新优先级 judgment 411 的首位动作是「ATR 止损倍数改成按波动分档」。你问我继续 A、继续 B 还是换别的路线。这个宿主提供 `create_goal`，无需额外授权即可调用；当前没有进行中的目标。

我的回答：继续 B。

请给出你这一轮的回复和你会调用的工具（命令写全）。
