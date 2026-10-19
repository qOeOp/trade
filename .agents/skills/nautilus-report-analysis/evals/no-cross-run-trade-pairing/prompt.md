---
description: Rule check — with the skill, a trade-by-trade comparison of two runs reads the attribution's trade pairing with its coverage first, never pairs trades by time, position id or direction, and never tests on paired trades.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线上的父候选是 `trend-x@4`（对照运行 run 5101），子候选 `trend-x@5` 只加了一个更严的入场过滤（登记在证据包 `research-plan-h09`，实验运行 run 5102，两者同一开发窗口、同一账户和成本）。

`hypothesis compare research-plan-h09 5102` 已经跑完：账户日收益配对检验的差值区间跨 0。归因里的 trade_pairs 切片是：matched_share 0.71，matched_net_share 0.64，removed_net -1,820 USDT，added_net +240 USDT，matched_delta_net +310 USDT，win_to_loss 9，loss_to_win 14，median_entry_shift_minutes 35。

我想更细地看过滤到底删掉了哪些交易。同事的建议：用 `tables()` 把两次运行的持仓周期都拉出来，同品种、同方向、开仓时间相差 1 小时以内的算一对，对不上的就是被过滤掉的；然后对配上的那几百对交易做逐笔盈亏的配对 t 检验——交易笔数比日数多，检验力更强，日收益检验不显著也许逐笔就显著了。

请给出你的分析步骤，并写一段结论草稿。
