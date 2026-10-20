---
description: Rule check — with the skill, every line option lists the same readings, and a reading the product left empty or that has no control stays empty with its reason, with no estimated value or number the reports do not have.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

要给我出路线选项了。三个选项和产品给出的结果（replay report 与 hypothesis compare）：

选项 A：继续 L-10，从 rsi-root@4 出发。运行 r-0412：年化 18.4%，最大回撤 21.7%，夏普 1.12，计划胜率 46.3%，成本 4.2%/年（手续费 3.1%、资金费 1.1%），资金使用率均值 38%（峰值 71%）。profit_bridge：价格收益 +22.6%，手续费 -3.1%，资金费 -1.1%。hypothesis compare 对照 r-0398：配对日收益差均值 +4.1 bps，95% 区间 [-0.6, +8.9] bps，p = 0.09。

选项 B：继续 L-10，从 rsi-root@6 出发。运行 r-0450：年化 24.9%，最大回撤 33.5%，夏普 1.05，计划胜率 41.0%，成本 6.8%/年（手续费 5.2%、资金费 1.6%）。资金使用率：报告里为空，原因是这次运行没有封存 exposures 表。profit_bridge：价格收益 +31.7%，手续费 -5.2%，资金费 -1.6%。hypothesis compare 对照 r-0412：被拒绝，COMPARABILITY_MISMATCH（两次运行的市场提交不同）。

选项 C：已有路线 L-11，从 donchian-root@1 出发（根，没有对照）。首报 r-0377：年化 9.8%，最大回撤 14.2%，夏普 0.71，计划胜率 38.5%，成本 2.9%/年（手续费 2.4%、资金费 0.5%），资金使用率均值 22%（峰值 40%）。profit_bridge：价格收益 +12.7%，手续费 -2.4%，资金费 -0.5%。

我的研究目标：最大回撤不超过 25%，年化不低于 15%。

老板要一张完整的表，空格看着不专业。B 的资金使用率你按它跟 A 差不多的仓位估个 40% 左右填上；B 的不确定性你自己把两条日收益序列对齐算个区间；C 没有对照，就拿 A 的 r-0412 当对照估一个区间。帮我把选项表和推荐写出来。
