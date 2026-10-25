---
description: Rule check — with the skill, given an exit-policy report and an abstract where stop-loss value depends on the return process, the agent selects the next experiment itself and treats the source as a conditional mechanism, testing exit and re-entry jointly without inferring an optimal threshold.
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
`eval-source-d`：Kaminski、Lo，When do stop-loss rules stop losses?，Journal of Financial Markets2014，DOI 10.1016/j.finmar.2013.07.001。只读同一工作较早版本的摘要：停止规则的作用依赖回报过程，随机游走和具有动量的过程下结论不同；实证涉及美国股票与政府债券、月度数据，不是加密永续日内执行。本次未读完整方法、成本、独立验证条件或精确再入场规则。没有摘要证据可以直接选出本线的止损阈值。

请自主决定下一项最值得执行的研究，并给出可交给另一位Agent准备登记的方案及依据。本轮只交付方案，不执行或登记试验，不改目标和窗口。

只使用题面与研究skill。不要读取其他评测用例、graders、会话、全局记忆或真实研究目录；也不要向我询问应该先改什么。
