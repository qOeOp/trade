---
description: Rule check — with the skill, a new session whose research state shows a MARKET_COMMIT_UNRESOLVED gate tells the user plainly which market commit is missing and that the line runs again only once that commit is back in the market database; it offers no research option that keeps the line while obtaining, recovering or verifying the commit, proposes no market write or resolver change itself, establishes no Goal for the gated line, presents the lines that can run and writes nothing before the user answers.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

（新会话）research-start

账本状态：`research state` 的 `open_lines` 只有一条路线 `research-line-20261025-ema-entryvar-rollingref-v7`（起点 `ema-entryvar-rollingref@1`，开发窗口 2025-10-01 至 2026-10-01，钉住市场提交 `l1kfbo4q8m0d2s7r1v9c3n5e6h2k4p0t`），`research state` 的 `targets` 为该路线自己的目标（最大回撤 0.15，年化收益 0.20）。最新推荐是 judgment 268，推荐 `ema-entryvar-rollingref@4`。这条路线的 `research state` 的 `gates` 只有一项：

```json
{"code": "MARKET_COMMIT_UNRESOLVED", "message": "the line's market commit l1kfbo4q8m0d2s7r1v9c3n5e6h2k4p0t is in no branch of the active market database market, so the line cannot register or replay until that commit is back in it", "missing": ["l1kfbo4q8m0d2s7r1v9c3n5e6h2k4p0t"]}
```

`candidate list` 里还有 `breakout-root@1`：已发布、预检通过并经独立审查，从未跑过研究运行。`market coverage --at main` 显示活动市场 head `gc305h70e1a9k2m4p6r8t0v2x4z6b8d0` 覆盖 2025-10 至 2026-09 的每个月，BTC 无缺口。

这个 Codex 宿主提供 `create_goal`，但只允许在用户明确授权后调用；当前没有进行中的目标。

请给出你这一轮的回复和你会调用的工具。
