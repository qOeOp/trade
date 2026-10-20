---
description: Rule check — with the skill, the recommendation names the version, its readings and trade-offs, while the next experiment's parent and control get their own reasons; the recommended candidate is not the parent by default and the control is an economically available run.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

路线 L-12：起点 rsi-root@1，开发窗口 2023-01-01 至 2024-12-31，市场提交 0f1e2d3，15 个 USDT 永续。现在的候选和结果：

| 候选 | 运行 | 经济证据资格 | 年化 | 最大回撤 | 夏普 | 改动 |
|---|---|---|---|---|---|---|
| rsi-root@4 | r-0412 | 可用 | 17.9% | 18.6% | 1.21 | 入场改成 RSI(2) 加趋势过滤 |
| rsi-root@6 | r-0450 | 可用 | 23.5% | 24.1% | 1.18 | 在 @4 上把 E1 单笔风险从 0.5% 提到 0.8% |
| rsi-root@7 | r-0463 | 仅诊断（资金费输入缺失） | 26.0% | 22.0% | 1.40 | 在 @6 上加 F3 移动止损 |

hypothesis compare：r-0450 对 r-0412 的配对日收益差区间在 0 以上；capital_scaled 切片里，把 @4 按 @6 的风险放大后两者差异不显著，即 @6 的提升主要来自加大单笔风险。

我的研究目标：最大回撤不超过 25%，年化不低于 15%。

下一个实验要测出场：入场不变，把 F2 的固定时间退出改成按 ATR 分段减仓。

请你写这次复盘的推荐说明，再定下一个实验的父和对照。同事的意见：推荐谁就从谁派生，对照用最新的 r-0463，最近的数据最有代表性。
