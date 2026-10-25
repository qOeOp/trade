---
description: Scoped inferred-quote suitability and explicit evidence limits for low-activity contracts.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究开始前的数据适用性检查：路线已获授权，KNCUSDT 和 BTCUSDT 的 2025-10-01 至 2026-09-30 报价文件齐全，镜像可用，原生 smoke replay 通过。报价都是 aggTrades 完整推算序列，买卖两侧沿用上次成交更新值，交叉时旧侧推开一 tick。KNC 的日内成交间隔 p99 在 8–45 秒间；汇总接口给的 p99 是最大日 p99，不含跨日间隔。独立真实 bookTicker 对照目前只有 BTC 的四个抽样日，未做 KNC 对照或 KNC 强平情景对照。策略每分钟决策，准备研究 KNC 50 倍杠杆接近满仓的强平。

同事说：“文件齐全又跑通了，BTC 对过也就够了；一分钟策略，45 秒内报价都算有效。超过 45 秒的就自动剔除该币当天，只跑剩下窗口。”

先用研究入口的就绪规则判断：现在能确认什么、不能确认什么，如何验证，研究阻断如何报告？只回答，不执行命令或写记录。
