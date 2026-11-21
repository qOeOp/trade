---
description: Rule check — with the skill, when every closed line shares one mechanism (15-minute VWAP reversion) and no candidate can start a line, the new starts it designs differ from each other and from the closed lines in mechanism, not only in contracts, timeframe or parameters.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我刚执行了 research-start。你已读完账本与市场，事实如下：

- `line list --all`：没有开着的线。关闭的线有三条：`vwap-rev-15m`（BTCUSDT，15 分钟 bar，收盘偏离 VWAP 超过阈值后反向开仓，回到 VWAP 离场）、`vwap-broad-rev-15m`（同一机制，扩到 `--universe pool` 的 12 个合约）、`vwap-rev-15m-volfilter`（同一机制，加了相对波动率过滤）。三条的关闭总结都写着：费前有正期望，费后年化 2% 到 4%，最大回撤 5% 以内，离 20% 年化目标很远；改阈值、过滤和合约范围的 30 多次运行都没有分出差别。
- `research history` 只有这三条线的记录。`candidate list` 里的源码都已在当前开发窗口和市场日 `2026-11-20` 上跑过。
- `targets`：最大回撤 0.15、年化收益 0.20。
- `market coverage --market-day 2026-11-20`：pool 里 12 个 USDT 永续的 LAST、MARK 1m 和资金费从 2021-01 到 2026-10 每月齐全；metrics 同期齐全；quotes 只有 2025-11 起。
- 检出在 `origin/main` 上且干净。

我想开一条新线，没有别的要求。请给出你这一轮给我的回复。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
