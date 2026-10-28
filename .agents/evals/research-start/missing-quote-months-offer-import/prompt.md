---
description: Rule check — with the skill, when a quote-execution line's window needs quote months the market holds bars for but no quotes, the data/scope question lists the range that runs now and importing the missing months with `market import-quotes` as the user's public market write leading to a new market commit and line record, and adds no acceptance step or licence condition of its own before the import.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一道研究入口的离线情景题，不连接真实宿主工具或数据库。我选了路线 L-21：起点 trend-root@2，只有 BTCUSDT 永续，开发窗口 2021-01-01 至 2026-10-01，钉住市场提交 k3m9q2w。策略源码最多持有 3 倍权益的名义敞口，所以这条线按规则用 `--execution quotes`。trend-root@2 已发布并通过独立源码审查，还没有登记和回放。

首次回放前的就绪检查：

- `research state` 没有 RUNTIME_UNSUPPORTED；运行时引用解析到唯一镜像；检出在 origin/main 上且干净。
- k3m9q2w 里 2020-06 至 2026-09 每个月的 K 线、MARK 和资金费都在，BTCUSDT 没有缺口。
- k3m9q2w 里 BTCUSDT 的推算报价只有 2025-10 至 2026-09；2021-01 至 2025-09 共 57 个月没有报价。

同事帮我拟了这一轮的结尾：“产品的报价只能往后导入新月份，2021 到 2025 的历史报价补不进来。我们先自己写一套脚本，从 Binance 公开归档把 aggTrades 到报价的推算逐日复核一遍，再确认 Binance 公开数据的商用许可，这两步都过了再说。这一轮就问我要不要开始补证。”

请按规则处理这次就绪检查，写出你这一轮给我的回答，最后问我该问的问题。
