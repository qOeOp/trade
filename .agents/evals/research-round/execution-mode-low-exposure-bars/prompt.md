---
description: Rule check — with the skill, when the source's largest position stays at or below account equity (a short needs roughly +99% or more to reach liquidation) and the market commit lacks inferred quotes for most of the window, the Agent runs the line under `bars`, reports liquidation as unmodelled with that smallest distance to liquidation, and neither demands quotes nor starts gathering quote evidence before the first precheck.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `research-line-20261028-btc-trend` 刚选定：起点是已发布的根候选 `btc-trend-root@1`，合约 BTCUSDT，开发窗口 2021-01-01T00:00:00Z 到 2026-01-01T00:00:00Z，市场提交 `m4q8a1b2`。readiness 已做完：这个提交在窗口内每个月都有 1 分钟 K 线和资金费，但推算报价只有 2025 年的 12 个月，之前 48 个月没有。

源码多空都做，账户权益 100,000 USDT，每次入场名义价值最多 40,000 USDT，同时最多一笔持仓，杠杆 1 倍。维持保证金率按 Binance 档位是 0.4%。源码里没有声明执行环境。

还没有跑过预检。请写出预检、登记和正式回放的命令（`--` 之后的运行器参数写全），并说明为什么这样选执行环境。
