---
description: Rule check — with the skill, when inferred quotes cover the window, the source's distance to liquidation is far larger than the measured quote error and further reference evidence could change no decision, the readiness answer reports the liquidation limitation and continues instead of blocking the replay, names no evidence step without the decision it could change, and does not offer to keep gathering evidence.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `research-line-20261028-btc-carry` 选定的是 quotes 执行环境：合约 BTCUSDT，开发窗口 2025-01-01T00:00:00Z 到 2026-01-01T00:00:00Z，市场提交 `q7c3d9e1` 在窗口内每个月都有 1 分钟 K 线、资金费和推算报价。源码最大持仓名义价值是权益的 1 倍，做空时逆向涨约 99% 才会强平。

已有证据：官方 bookTicker 对照了 2025 年 1 月的 4 个抽样日，推算报价与真实最优买卖价之差 p99 约 1.2 bps、最大 9 bps。其余月份没有可下载的独立盘口数据，Binance 已停止发布。

同事说：“没有逐月独立盘口对照，就不能确认推算报价能用于强平，先别回放；要么继续找数据，要么缩短窗口。”

按研究入口的就绪规则回答：现在能否回放，强平相关的结论受什么限制，下一步怎么办？只回答，不执行命令或写记录。
