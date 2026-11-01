---
description: Rule check — with the skill, a due line change offers each line with its annual return and maximum drawdown against the user's targets (met, or missed by how much) and states the annual difference the counted runs could detect, so undistinguished runs are not read as no better.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我刚在 Codex 里执行了 research-start。你已读完账本与市场库，事实如下：

- `research state --line research-line-20261012-breakout-btc`：开着，BTCUSDT 永续，开发窗口 2025-01-01 至 2026-01-01，市场提交 `m-7a1e`，执行环境 `bars`；`targets` 为 `max_drawdown` 0.15、`annual_return` 0.20；没有 gate；`unreviewed_trials` 为空。最新推荐 judgment 731 推荐 `breakout@6`（trial 2210）。按 research-round 已到换线时机；计入的运行里最近三次（trial 2214、2217、2220）的候选与对照都没分辨开。
- 这三次的 `hypothesis compare`（对照都是 trial 2210）：
  - trial 2214：`annual_return_difference` 0.041，`annual_return_difference_interval` [-0.142, 0.268]，`detectable_annual_return_difference_80pct_normal_approx` 0.334
  - trial 2217：0.012，[-0.118, 0.201]，0.271
  - trial 2220：-0.023，[-0.187, 0.176]，0.308
- `replay report` trial 2210（`breakout@6`）：年化 29.4%，最大回撤 8.5%，夏普 1.62，计划胜率 44.1%，成本 3.6%/年，资金使用率均值 31%，profit_bridge：价格收益 +33.0%，手续费 -2.7%，资金费 -0.9%。
- `candidate list` 里另外两个候选能起新线（各自研究运行都在下面的窗口与提交上，没有开着的线占用同一提交与窗口，`market coverage` 该窗口每月齐全）：
  - `carry@3`（trial 1980，ETHUSDT，窗口 2024-01-01 至 2025-01-01，`m-7a1e`）：年化 0.21%，最大回撤 0.79%，夏普 0.18，计划胜率 61.2%，成本 0.4%/年，资金使用率均值 12%；profit_bridge：价格收益 -0.3%，资金费 +0.9%，手续费 -0.4%。对照 trial 1972：`annual_return_difference_interval` [-0.004, 0.009]，`detectable_annual_return_difference_80pct_normal_approx` 0.011。
  - `meanrev@4`（trial 2101，SOLUSDT，窗口 2024-07-01 至 2025-07-01，`m-7a1e`）：年化 24.6%，最大回撤 19.3%，夏普 1.05，计划胜率 52.7%，成本 5.1%/年，资金使用率均值 44%；profit_bridge：价格收益 +29.7%，手续费 -4.3%，资金费 -0.8%。对照 trial 2093：`annual_return_difference_interval` [0.012, 0.139]，`detectable_annual_return_difference_80pct_normal_approx` 0.096。
- 检出在 `origin/main` 上且干净。

三次都没分辨开，看来 breakout 这条线已经做不出更好的了。请给出你这一轮给我的回复和你会调用的工具。
