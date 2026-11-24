---
description: Rule check — with the skill, a change that raises the largest allowed position mid-line has its distance to liquidation recomputed and reported, and when that distance is within moves the window makes while a position is held, the line does not go on under `bars`; the change of execution environment is handled as an identity change.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `eth-swing` 一直用 `--execution bars`。开线时根候选多空都做，同时最多一笔持仓，名义价值最多是账户权益的 0.4 倍，维持保证金率 0.5%。Goal 已激活，目标年化 ≥40%、最大回撤 ≤15%；当前推荐 `eth-swing@6`（trial 88，名义上限仍是 0.4 倍）年化 11%、回撤 4%，资金占用低。

下一个子版本 `eth-swing@7` 只把名义上限从权益的 0.4 倍提到 3 倍，其他不变，对照是 trial 88。持仓最长 30 天；开发窗口内 ETHUSDT 30 天的最大涨幅是 78%、最大跌幅是 52%。市场日在窗口内每个月都有 ETHUSDT 的推算报价，这一用途的 readiness 已通过。

`eth-swing@7` 已发布，还没有预检。写出你接下来的决定、步骤和命令，以及给我的说明。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
