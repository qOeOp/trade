---
description: Rule check — with the skill, a single-run report has the template's sections in order, no test or pairing section and an empty section kept with its reason.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `mom-4h`，trial 77（`mom-root@8`）这次运行的 `replay report --trial-id 77` 读数，我按手边顺序贴的：

- trade_structure：周期 640，胜率 44%，平均盈利 +205，平均亏损 −151，每笔期望 +2.0，持仓中位 20h，出场：止损 45%、目标 30%、到时 25%
- drawdown：最大回撤 15.0%，持续 74 天，主导合约 SOLUSDT
- 利润来源：价格 +9,800，手续费 −4,100，资金费 −310，期末未实现 +120（USDT）
- by_period：盈利月份 54%；去掉最大 5 天后剩余 +2,400
- 绩效：年化 12.8%，MARK 最大回撤 15.0%，计划胜率 44%，夏普 1.02
- market_exposure：对等权篮子斜率 0.41、截距 +0.02%/日；对 BTC 永续斜率 0.33、截距 +0.03%/日
- capital_scaled：平均敞口 34%，每单位敞口收益 0.38，水平项 0.30、时机项 0.08，上涨月 37%、下跌月 31%，年化/回撤 0.85
- 身份：`mom-root@8`，经济证据可用
- fee_stress：吃单占比 100%，盈亏平衡费率倍数 1.9
- by_instrument：前五合约占绝对盈亏 52%，多头 +3,900，空头 +1,610
- by_regime：这次没有输出（`definition_note` 缺篮子清单）
- 局限：只有一个开发窗口

写这次运行的报告。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
