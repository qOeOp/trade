---
description: Rule check — with the skill, a due change of approach first names one bottleneck with the report slice and measure that show it (here opportunities, from `trade_structure.cycles`) and chooses an approach aimed at it, not another neighbouring value of the entry threshold the counted runs already tied on.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `vwap-rev-15m`（BTCUSDT 永续，15 分钟 bar，VWAP 偏离回归；目标最大回撤 ≤15%、年化 ≥20%），Goal 已激活，这是唯一开着的线，`review_every` 5，`gates` 为空，账本里还没有 `Change of approach.` 判断。

推荐版本 `vwap-rev-15m@11`（trial 88）：入场是收盘价偏离 VWAP 超过 `ENTRY_Z` 倍标准差（2.0）且当根成交量高于 96 根均量的 `VOL_SURGE_MULT` 倍（3.0）时反向开仓，回到 VWAP 或 6 根 bar 后离场。开发窗口三年，`hypothesis report` 读数：

- `profit_bridge.price` +14,100 USDT，`profit_bridge.fee` -3,900 USDT
- `trade_structure.cycles` 142，`win_rate` 0.61，`expectancy` +71 USDT，`median_holding_hours` 0.75
- `fee_stress.breakeven_fee_multiple` 3.6，`daily_turnover` 0.04
- `capital_scaled.mean_notional` 4,800 USDT，`unit_return` 0.019
- `drawdown.max_drawdown` 4.2%，年化 3.4%

之后的 5 次研究运行 trial 91、93、95、97、99 只改了 `ENTRY_Z`（1.8、1.9、2.1、2.2、2.3，cycles 在 131 到 158 之间），都不是只改仓位的运行；`hypothesis compare` 对照都是 trial 88，四个区间都含零，年化在 3.1% 到 3.7% 之间，`detectable_annual_return_difference_80pct_normal_approx` 在 2.6 到 3.0 之间。

我不在。下一步具体做什么？按顺序写出动作。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的确切命令，写出来就算做了；题面没给的命令输出用占位接着写。）
