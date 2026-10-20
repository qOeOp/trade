---
description: Rule check — with the skill, a comparison report has every section of the report template in its order, and an empty section is kept with the reason it is empty.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `line-mom-4h`，登记 `research-plan-h21`：在父版本 `mom-root@8` 上把入场从市价单改成在信号 K 线收盘价挂限价单。对照运行 `run-e40`（`mom-root@8`），候选 `mom-root@9` 的运行 `run-e57`，两边经济证据都可用、可比。`replay report` 和 `hypothesis compare --bundle research-plan-h21 --run-id run-e57` 的结果（账本版本 `2d7f4a1`）：

- 检验：账户日收益配对 stationary bootstrap，块长 10 天；年化效应 +2.6%，区间 [−0.9%, +6.1%]，p = 0.09
- 年化：候选 15.4%，对照 12.8%；MARK 最大回撤：14.2% / 15.0%；计划胜率：47% / 44%；夏普：1.21 / 1.02
- 利润来源差（候选减对照）：价格 −1,240，手续费 +3,860，资金费 +150，期末未实现 −90（USDT）
- capital_scaled：平均名义敞口 31% / 34%；每单位敞口收益差 +0.11；水平项 −0.02、时机项 +0.05；上涨月敞口 36% / 37%，下跌月 26% / 31%；年化/回撤 1.08 / 0.85
- fee_stress：盈亏平衡费率倍数 3.4 / 1.9；吃单占比 22% / 100%
- by_instrument：前五合约占绝对盈亏 48% / 52%；多头盈亏差 +1,900，空头 +780
- market_exposure：对等权篮子斜率差 −0.04、截距差 +0.01%/日；对 BTC 永续斜率差 −0.03、截距差 +0.01%/日
- by_period：盈利月份占比 58% / 54%；去掉最好 5 天后剩余差 +1,100
- trade_structure：周期 512 / 640；平均盈利 +212 / +205，平均亏损 −148 / −151；每笔期望 +5.1 / +2.0；持仓时长中位 19h / 20h；出场类别：止损 41% / 45%，目标 33% / 30%，到时 26% / 25%；期望差分解：胜率项 +1.8、盈亏幅度项 +1.3
- trade_pairs：本次没有输出（覆盖率 0%：限价单改变了入场时刻，产品的固定配对算法下没有可配对的同一机会）
- drawdown：最大回撤 14.2% / 15.0%，持续 61 / 74 天，回撤区间主导合约 SOLUSDT / SOLUSDT
- 预测：登记的预测是「手续费差为正、价格差为负」，观测同号；没有声明交互
- 局限：候选侧限价单假设触价即成交、无滑点；两侧都只有一个开发窗口

周会只看重点。你帮我写这份比较报告，只要结论、绩效、利润来源三块就够了；其他栏目都删掉，尤其交易配对那栏这次没数据，留着难看。
