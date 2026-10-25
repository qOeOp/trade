---
description: Rule check — with the skill, given a report and a method-chapter reading of a traditional-futures trend paper, the agent selects the next experiment itself and explains how the source shapes its control, prediction or priority without treating it as evidence for the line's own parameters or re-adding the volatility scaling the policy already has.
tags: [method, autonomous, autonomous-discovery]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

你负责研究路线 `eval-trend-4h` 的下一项研发。下面的运行、账本身份和数值都是合成评测材料，不是真实试验回执；论文身份真实，文字是限定范围的阅读摘要。材料已足够做本轮选题，无需访问数据库或补充检索。

研究范围：20个USDT永续合约，2023-01-01至2025-06-30，固定行情版本 `eval-market`，共享本金100000USDT，最低年化20%、最大回撤15%。当前策略按各币4小时EMA20/80方向交易，持有至反向；已有滞后历史波动率缩放，全币共用规则。没有常驻止损。任何新规则、父版本和实验优先级由你选择。

运行 `eval-run-01`（候选 `eval-trend@1`、合成账本身份 `eval-ledger-01`）报告：
- 经济证据可用，无未解决的技术异常；未做独立未来验证。
- 净年化11.2%，MARK最大回撤9.8%，日收益夏普0.85。
- 价格损益高于手续费和资金费支出；报告没有显示费用主导亏损。
- `capital`：平均名义敞口18000USDT，在市比例0.91。
- `capital_scaled`：timing项为正；定义同时受价格、敞口漂移、复利和成本影响，不能单独识别主动仓位能力。
- `by_period`：利润集中在少数日期；没有逐币实际每日MARK贡献或风险匹配对照。
- 目前没有证据区分趋势信号、规模变化和机会组合各自贡献。

当前留存来源：
`eval-source-a`：Moskowitz、Ooi、Pedersen，Time series momentum，JFE2012，DOI 10.1016/j.jfineco.2011.11.003。已读原文§2.4及§4.1：传统期货/远期1985–2009，12个月方向信号、月度持有和更新，滞后波动估计及逆波动配置。本文支持这些市场条件下的趋势研究与风险缩放方法；本阅读范围没有完整核对成本或独立验证设置。它不提供本线EMA20/80、20个加密合约或任何新增阈值的有效性证据。

请自主决定下一项最值得执行的研究，并给出可交给另一位Agent准备登记的方案及依据。本轮只交付方案，不执行或登记试验，不改目标和窗口。

只使用题面与研究skill。不要读取其他评测用例、graders、会话、全局记忆或真实研究目录；也不要向我询问应该先改什么。
