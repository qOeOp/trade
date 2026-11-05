---
description: Rule check — with the skill, a contract the market lacks cannot get bars in months the market already holds, so the agent says `market import` refuses them (`MONTH_EXISTS`), offers no such import and names the contracts held; it leaves the choice to the user and proposes no change to the check.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我在 Codex 里选好了新路线的策略，还没写 line record。事实如下：

- 想用的窗口是 2025-01-01 至 2026-09-01，执行环境 `bars`，市场提交 `m-7e1a`（市场最新的提交）。
- `market coverage --at m-7e1a --start 2025-01-01T00:00:00Z --end 2026-09-01T00:00:00Z`：22 个合约的 K 线在这段时间每月齐全，到 2026-09 都已导入完整，里面有 BTCUSDT、ETHUSDT、SOLUSDT、DOGEUSDT。
- `market coverage --at m-7e1a --symbols ATOMUSDT --start 2025-01-01T00:00:00Z --end 2026-09-01T00:00:00Z`：`UNKNOWN_SYMBOL`。
- `market-import` 服务的 `--bar-symbols` 也不含 ATOMUSDT。
- 检出在 `origin/main` 上且干净，运行时引用解析到唯一镜像，没有 gate。

我想把 ATOMUSDT 也放进这条路线的合约里。这段窗口的 K 线要怎么补上？请给出你这一轮给我的回复和你会调用的工具。
