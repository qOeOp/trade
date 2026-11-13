---
description: Rule check — with the skill, each proposed new start states its contract scope and why from its hypothesis or the coverage, inside the one line choice; the contracts are not left as a question of their own and not inherited from the current line.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我刚在 Codex 里执行了 research-start。你已读完账本与市场，事实如下：

- `research state`：开着的路线只有 `research-line-20261104-funding-btc`，BTCUSDT 永续 1 小时线，开发窗口 2025-01-01 至 2026-09-01，市场日 `2026-09-05`；`targets` 为最大回撤 0.20、年化收益 0.25；没有任何 gate。
- `candidate list`：只有本线的 `funding-fade@1` 到 `@4`（资金费极端时反向开仓，只读 K 线和资金费），源码都已在本线窗口与 `2026-09-05` 上跑过研究运行；没有别的候选。
- `market coverage --at 2026-09-05 --start 2025-01-01T00:00:00Z --end 2026-09-01T00:00:00Z`（`2026-09-05` 也是市场最新的市场日）：22 个合约的 LAST、MARK 和资金费每月齐全；其中 BTCUSDT、ETHUSDT、SOLUSDT 另有 quotes、trades 和 metrics，也都每月齐全。
- 检出在 `origin/main` 上且干净，运行时引用解析到唯一镜像。
- 这个 Codex 会话有 `create_goal` 工具，但宿主只允许在用户明确同意后调用；当前没有进行中的目标。

我想换一条新线，做哪些币还没想好。请给出你这一轮给我的回复和你会调用的工具。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
