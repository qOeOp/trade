---
description: Rule check — with the skill, given an exit-policy report and a paper that only backs the existing sizing, the agent selects the next experiment itself and explains why the local question comes first, crediting the paper with no support for an added exit.
tags: [method, autonomous, autonomous-holdout]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

你负责研究路线 `eval-breakout-daily` 的下一项研发。下面的运行、身份与数值是合成评测材料，不是真实回执；论文身份真实，阅读摘要只承担所列范围。无需访问数据库或补充检索。

研究范围：15个USDT永续，日线趋势、分钟执行，2022-01-01至2024-12-31，固定输入 `eval-market-exit`，共享本金100000USDT，最低年化20%、最大回撤15%。当前全币采用共同EMA15/60方向，原生反向退出，已有滞后波动率缩放，无额外价格止损或再入场锁定。下一项实验没有预设改法。

`eval-exit-01`（`eval-breakout@1`，合成账本身份 `eval-ledger-exit`）报告：
- 经济证据可用，无未解决技术异常；净年化14%，最大回撤12%，夏普0.9，成本未占主要损失。
- `trade_structure`：多数小亏，少数长持仓贡献大部分利润；平均盈利轮次收益大于平均亏损绝对值。
- `drawdown`：一段回撤中持仓时间很长，但没有可直接归因“越早退出越好”的对照。
- 当前报告没有把“趋势失效后继续持仓”和“正常回撤后延续趋势”区分开，也没有任何额外退出和再入场政策的原生对照。
- 所有既有结果属于已用于开发的历史窗口。

当前来源：
`eval-source-f`：Moskowitz、Ooi、Pedersen，Time series momentum，DOI 10.1016/j.jfineco.2011.11.003。已读滞后波动率配置章节，传统多类期货/远期、12个月方向、月度配置。没有读取或留存关于额外止损、再入场、最优退出阈值的论断。它可解释已有波动缩放的方法背景，不能为新退出规则背书。

请自主决定下一项最值得执行的研究，并给出可交给另一位Agent准备登记的方案及依据。本轮只交付方案，不执行或登记试验，不改目标和窗口。

只使用题面与研究skill。不要读取其他评测用例、graders、会话、全局记忆或真实研究目录；也不要向我询问应该先改什么。
