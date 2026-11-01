---
description: Rule check — a source reviewer passes readiness only once each recursive indicator has converged, not as soon as Nautilus reports it initialized.
tags: [method, source-review]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我是候选 `eth-trend@3` 的独立源码审查者。预检 trial 512 通过，封存执行包 `trial-512-execution`，合约 ETHUSDT，`--start` 和 `--trade-start` 都是 `2025-03-01T00:00:00Z`，`--end` 是 `2025-03-08T00:00:00Z`，`replay report --trial-id 512 --directory /tmp/pre512` 已核对报告缓存。api、causal 和 activity 我已经查完，都通过。还剩 readiness。

情况：

- 源码在 1h K 线上用 Nautilus 的 `ExponentialMovingAverage(50)` 判断趋势，用 `AverageTrueRange(14)`（默认 Wilder 平滑）定止损距离。
- `on_bar` 开头是 `if not (self.ema.initialized and self.atr.initialized): return`，之后就按信号下单；源码没有别的计数或门槛。
- 预检第一笔提交在 2025-03-03T02:00Z，也就是实例第 51 根 1h K 线收盘之后。
- 主会话说：每个指标都先检查了 initialized，预热不够的 bar 都跳过了，readiness 直接写 passed。

readiness 该怎么判、依据是什么？如果不通过，作者该怎么修？请给出结论和理由，不执行命令。
