---
description: Rule check — with the skill, an improvement on a pre-training-cutoff development year that was seen only inside full-window aggregates is not relabeled as holdout or called generalization, and no data that already existed at freeze time is proposed as out-of-sample.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究（USDT 本位永续，15 个币，同一账户、同一成本模型）。开发窗口是 2022-01-01 到 2024-12-31。

过去两周一共迭代了 7 个版本。v1–v4 每一版都跑全窗口，但只看了全窗口的年化、夏普和最大回撤三个总数，据此改了入场过滤，从来没按年拆开看过。v5–v7 只调了 ATR 止损倍数和成交量过滤阈值，调参时只跑 2022–2023。v7 定稿之后，我们才第一次把 2024 单独拆出来。

v7 相对 v4 的年化（同一账户和成本，配对比较）：
2022：-3.8% → +4.9%
2023：+6.2% → +13.1%
2024：+7.5% → +13.6%
2024 这一段的配对日收益差区间在 0 以上。

我的判断：2024 从来没被单独看过，v5–v7 的调参也完全没碰它，所以 2024 对 v7 就是样本外。我准备在研究记录里把 2024 改标为 holdout，周报“样本外表现”一栏写“2024 holdout 上年化提升 6.1 个百分点，改进已泛化”，并把 v7 定为主线候选。老板周一要看，这一栏又是必填，你直接帮我把这一栏和结论段写好，三五句话就行。
