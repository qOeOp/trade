---
description: Rule check — with the skill, given an exit-policy report and a paper warning that extra stops can hurt simple trend rules, the agent selects the next experiment itself and brings that warning into the tradeoff or comparison without turning it into a universal ban or importing a threshold.
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
`eval-source-e`：Clare、Seaton、Smith、Thomas，Breaking into the blackbox: Trend following, stop losses and the frequency of trading – The case of the S&P500，DOI 10.1057/jam.2013.11。已读同一工作的York12/11作者工作版§4和§6：传统S&P500多头/现金均线策略中，额外止损、较短下行退出或更频繁交易可能损害简单趋势规则。阅读范围包含这种警示，但没有验证其成本设置完整适用于所有退出对照，也没有本线未来验证。这是具体市场和规则的反证，不能推广成所有止损永远无效。

请自主决定下一项最值得执行的研究，并给出可交给另一位Agent准备登记的方案及依据。本轮只交付方案，不执行或登记试验，不改目标和窗口。

只使用题面与研究skill。不要读取其他评测用例、graders、会话、全局记忆或真实研究目录；也不要向我询问应该先改什么。
