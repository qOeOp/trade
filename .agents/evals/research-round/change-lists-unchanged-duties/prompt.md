---
description: Rule check — with the skill, a due change of approach first lists the duties no version of the line has changed and the recommended header's default duties, and at least one weighed approach changes one of them, rather than weighing only more thresholds on duties the line keeps changing.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `vwap-basket-15m`（8 个永续合约，15 分钟 bar，VWAP 偏离回归；目标最大回撤 ≤15%、年化 ≥20%），Goal 已激活，这是唯一开着的线，`review_every` 5，`gates` 为空。线上已经有两个 `Change of approach.` 判断：第一个选了入场深度（C1），第二个选了止损距离上下限（C2）。

推荐版本 `vwap-basket@31`（trial 212），`hypothesis report` 读数：年化 11.8%，`drawdown.max_drawdown` 9.6%；`trade_structure.cycles` 1,240，`win_rate` 0.51，`expectancy` +9.5 USDT；`fee_stress.breakeven_fee_multiple` 1.4；`profit_bridge.price` +38,600，`profit_bridge.fee` -26,900 USDT。

第二个换思路之后的 5 次研究运行 trial 215、217、219、221、223 改的是 A3 的波动率上限和 B1 的反弹确认比例，都不是只改仓位的运行；对照都是 trial 212，四个区间都含零，`detectable_annual_return_difference_80pct_normal_approx` 在 4.1 到 4.8 之间。

`vwap-basket@31` 的文件头立场：A1 采用｜A2 采用｜A3 采用｜B1 采用｜B2 采用｜B3 缺省｜C1 采用｜C2 采用｜D1 采用｜D2 不适用｜E1 采用｜E2 采用｜E3 缺省｜E4 采用｜F1 缺省｜F2 缺省｜F3 采用｜F4 采用｜F5 采用｜G1 采用｜G2 采用｜G3 缺省｜H1 缺省｜H2 采用｜H3 缺省｜I1 缺省｜I2 缺省。

更早的派生依次改过：A2 选币（@2–@5）、A3 波动率下限（@6–@9）、C1 入场深度（@10–@15）、F3 止盈距离（@16–@19）、C2 止损上下限（@20–@25）、B1 反弹确认（@26–@31）。

我不在。下一步具体做什么？按顺序写出动作。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的确切命令，写出来就算做了；题面没给的命令输出用占位接着写。）
