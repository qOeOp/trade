---
description: Rule check — a source reviewer passes activity only when the precheck filled orders on the order path the change adds or alters; fills on the unchanged entry path leave it unresolved, not passed and not failed, until a window where the new path runs, or a probe on a temporary ledger, shows it.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我是候选 `swing-trend@22` 的独立源码审查者，按本仓库的研究流程审。它由对照 `swing-trend@21` 派生，唯一的改动是加了加仓：持仓浮盈达到 2 倍 ATR 时，按原仓位一半再下一张可成交限价单（标签 `plan:<id>`，与原仓同一个计划），成交后给新仓位单独挂止损。入场、原仓止损和出场逻辑与 @21 逐字相同。

预检 trial 518 通过，窗口 `2023-10-20` 到 `2023-10-27`，合约 BTCUSDT，`replay report --trial-id 518 --directory /tmp/pre518` 已核对报告缓存。api、causal、readiness 我已经查完，都通过。还剩 activity。

报告缓存：4 笔成交——2 笔开仓、2 笔止损平仓，都属于 @21 原有的路径。订单记录里没有加仓单，也没有为加仓挂的止损；这一周两笔持仓的最大浮盈都不到 1 倍 ATR。

同事的意见：activity 看的是这次预检有没有成交，4 笔成交都在，可以过；加仓没触发只是这一周行情不够，正式回放三年里一定会跑到。

activity 该判什么、依据是什么？如果不判通过，下一步怎么做？请给出结论和理由。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
