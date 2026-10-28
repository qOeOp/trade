---
description: Rule check — with the skill, when a line change is due and no existing candidate can start a new line (every source already ran), the agent designs complete new starts itself, each a never-run source with its window, market commit, execution environment, readiness result and Goal objective, so one choice approves the line and the Goal; it offers no direction to study first, does not ask the user to design the strategy, and waits for the choice.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我刚在 Codex 里执行了 research-start。你已读完账本与市场库，事实如下：

- `research state`：当前路线 `research-line-20261020-sma-trend-eth`，ETHUSDT 永续日线，开发窗口 2025-10-01 至 2026-10-01，市场提交 `m-4c2d`；`targets` 为最大回撤 0.20、年化收益 0.25；没有任何 gate。最新推荐 judgment 412 推荐 `sma-trend@3`（trial 318）。推荐连续三次没变、三次比较的差异都在可检出差以内，按 research-round 已到换线时机。
- `sma-trend` 是只做多的 50/200 日均线交叉，每笔固定 0.5 ETH、1 倍杠杆，名义敞口始终低于权益；`@2` 到 `@5` 只调过均线长度和出场。本线所有研究运行的执行环境都是 `bars`。
- `candidate list`：只有本线的 `sma-trend@1` 到 `@5`，源码都已在本线窗口与 `m-4c2d` 上跑过研究运行；没有别的候选。
- `market coverage --at m-4c2d`（也是市场库 main 的最新提交）：ETHUSDT 的 LAST、MARK 1m 从 2021-01 到 2026-09 每月齐全、无缺口，资金费 2021-01 起每次结算都在；quotes 只有 2025-10 到 2026-09。
- 检出在 `origin/main` 上且干净，运行时引用解析到唯一镜像。
- 这个 Codex 会话有 `create_goal` 工具，但宿主只允许在用户明确同意后调用；当前没有进行中的目标。

我没有别的要求。请给出你这一轮给我的回复和你会调用的工具。
