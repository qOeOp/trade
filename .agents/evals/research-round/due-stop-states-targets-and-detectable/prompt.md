---
description: Rule check — with the skill, a due change of approach gives this line's annual return and maximum drawdown against the user's targets and the annual difference the counted runs could detect, so undistinguished runs are not read as no better, and chooses an approach inside this line itself rather than offering the other candidates' lines.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `research-line-20261012-breakout-btc` 的 Goal 已激活，你一直在这条线上做研究。刚读过的账本与市场结果如下：

- `research state --line research-line-20261012-breakout-btc`：开着，BTCUSDT 永续，开发窗口 2025-01-01 至 2026-01-01，市场日 `2026-01-02`，执行环境 `bars`；`targets` 为 `max_drawdown` 0.15、`annual_return` 0.20；`review_every` 5；没有 gate；`unreviewed_trials` 为空。最新推荐 judgment 731 推荐 `breakout@6`（trial 2210）。按 research-round 已到该换思路的时候：用户上次选线之后的研究运行连续 5 次，候选与对照的三个区间都含零（没分辨开），其中最近三次是 trial 2214、2217、2220。
- 这三次的 `hypothesis compare`（对照都是 trial 2210）：
  - trial 2214：`annual_return_difference` 0.041，`annual_return_difference_interval` [-0.142, 0.268]，`detectable_annual_return_difference_80pct_normal_approx` 0.334
  - trial 2217：0.012，[-0.118, 0.201]，0.271
  - trial 2220：-0.023，[-0.187, 0.176]，0.308
- `replay report` trial 2210（`breakout@6`）：年化 29.4%，最大回撤 8.5%，夏普 1.62，计划胜率 44.1%，成本 3.6%/年，资金使用率均值 31%，profit_bridge：价格收益 +33.0%，手续费 -2.7%，资金费 -0.9%。
- `candidate list` 里另外两个候选能起新线（各自研究运行都在下面的窗口与提交上，`market coverage` 该窗口每月齐全）：
  - `carry@3`（trial 1980，ETHUSDT，窗口 2024-01-01 至 2025-01-01，`2026-01-02`）：年化 0.21%，最大回撤 0.79%，夏普 0.18，计划胜率 61.2%，成本 0.4%/年，资金使用率均值 12%；profit_bridge：价格收益 -0.3%，资金费 +0.9%，手续费 -0.4%。对照 trial 1972：`annual_return_difference_interval` [-0.004, 0.009]，`detectable_annual_return_difference_80pct_normal_approx` 0.011。
  - `meanrev@4`（trial 2101，SOLUSDT，窗口 2024-07-01 至 2025-07-01，`2026-01-02`）：年化 24.6%，最大回撤 19.3%，夏普 1.05，计划胜率 52.7%，成本 5.1%/年，资金使用率均值 44%；profit_bridge：价格收益 +29.7%，手续费 -4.3%，资金费 -0.8%。对照 trial 2093：`annual_return_difference_interval` [0.012, 0.139]，`detectable_annual_return_difference_80pct_normal_approx` 0.096。

这些运行都没分辨开，看来 breakout 这条线已经做不出更好的了。请给出你这一轮给我的回复和你会调用的工具。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
