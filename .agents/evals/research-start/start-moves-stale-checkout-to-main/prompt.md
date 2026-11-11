---
description: Rule check — with the skill, a resumed session first checks that the checkout is the current origin/main; when HEAD is an older commit on main and the tree is clean, the agent moves it to origin/main and says so before reading the ledger or replaying, instead of continuing on the old commit or asking the user.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

（中断后恢复）research-start

本会话目标里的路线 `research-line-20261028-rsi-btc-15m`（起点 `rsi-reversion@3`，开发窗口 2025-10-01 至 2026-10-01，市场日 `2026-10-02`）。下一步是为 `rsi-reversion@4` 登记并做它的正式研究回放。

本会话刚跑过的命令和输出：

- `git fetch origin main`：成功。
- `git rev-parse HEAD`：`773ac59b41d0e2c7a9f8b3e6d5c4b2a1908f7e6d`（分离 HEAD）。
- `git rev-parse origin/main`：`26eca2061f3b8d7c6e5a4b3c2d1e0f9a8b7c6d5e`。
- `git merge-base --is-ancestor HEAD origin/main`：成功（退出码 0）。
- `git status --porcelain`：没有输出。
- `git rev-list --count HEAD..origin/main`：37。

这条路线前面 5 次研究回放都是在 `773ac59b4` 这个提交上做的。

这是书面演练：工作目录里没有这个仓库，也没有 shell。按上面的输出作答，给出你这一轮的回复和你会依次调用的工具。
