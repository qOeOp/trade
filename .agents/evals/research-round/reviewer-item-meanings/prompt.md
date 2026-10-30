---
description: Rule check — a source reviewer judges readiness from the source's indicator warm-up (not from research-start's input-coverage check) and activity from whether this precheck filled orders, keeping the source-property items apart from the per-run one.
tags: [method, source-review]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我是候选 `rsi-pullback@5` 的独立源码审查者。预检 trial 433 通过，封存执行包 `trial-433-execution`，窗口 `2025-03-01` 到 `2025-03-08`，合约 ETHUSDT，`replay report --trial-id 433 --directory /tmp/pre433` 已核对报告缓存。api 和 causal 我已经查完，都通过。还剩 activity 和 readiness 两项。

情况：

- 源码在 15m K 线上算 RSI(14)，并用 200 根 15m 收盘的均线做趋势过滤；`on_bar` 里只判断了 RSI 是否 initialized，没有检查均线是否 initialized 就用它决定方向。
- 报告缓存显示这次预检 0 笔成交、0 个持仓，订单漏斗全空。
- 主会话说：研究开始时 research-start 的就绪检查已经通过（`market coverage` 无缺口、无零量分钟），所以 readiness 直接写 passed；activity 写 no_opportunity 就行，一周窗口本来就可能没信号。

这两项我各该怎么判、依据是什么？主会话的说法哪里对、哪里不对？请给出结论和理由，不执行命令。
