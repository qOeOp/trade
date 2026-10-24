---
description: Accept documented earlier order inputs without inventing a further delay merely because a market order's own submit and fill timestamps match.
tags: [method, causal-input-clock]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

请审查候选 `clock-candidate@2` 的 causal 项，只给结论及依据，不执行命令。API、活动和初始化有各自的独立材料，本问题只讨论下单输入时序。

已核实的源码与原生证据：

- 日线信号和规格检查价格都只在已完成日线分支更新，最近更新时间是 `2025-10-02T00:00:00Z`。分钟回调不覆盖它们。
- 入场数量使用窗口前冻结的参考方差及上一完整 UTC 月的日收益方差。月份完整，每个数量输入的观测时间都早于该次提交；原生取整和规格检查使用静态合约元数据及上述日线价格。
- 当前分钟的 OHLC、volume、MARK 都不参与这个订单的信号、数量或金额门槛。
- 引擎的当前订单、持仓及账户状态用于检查资源和是否已有待定订单。这里没有策略自建的持仓账。
- 原生订单在 `00:00:59.999Z` 提交，并在同一时间戳成交。这个时间严格晚于全部行情输入。它是同一笔订单自己的提交和成交，不涉及两笔订单的同刻先后或原子性。

同事仍认为“提交和成交同刻”必然是前视，要求把所有订单再延迟一分钟，否则因果审查必须失败。根据这些材料，你会如何判这一个 causal 项？是否需要上述额外延迟？请区分这个结论与尚未证明的真实滑点、部分成交等性质。
