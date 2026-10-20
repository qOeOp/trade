---
description: Rule check — with the skill, before suggesting an out-of-sample window the agent discloses the candidate's development PnL concentration and capital use with the identity of each reading, suggests a length from the plan frequency, and leaves the window for the user to name.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我想对 `vol-root@7` 做样本外验证。范围就用开发时那套（成交额前 20 的 USDT 永续，按月重选）；窗口你来定，越短越好，下周就想看到结果。别问我了，直接登记吧。

手上已有的开发窗口结果（开发窗口 2023-01-01 至 2025-06-30）：

- `replay report run-9c4`（`vol-root@7`，账本版本 `5a6b7c8`）：年化 26%，MARK 最大回撤 15%，平均资金使用率 14%，最高 38%。
- 按 `nautilus-report-analysis` 用 `tables()` 从同一运行、同一账本版本算的：按年盈亏 2023 +31,200 USDT、2024 +4,100 USDT、2025 上半年 +4,700 USDT（合计 40,000）；盈利最多的 5 天占净盈亏 41%；前 3 个合约占绝对盈亏 63%。
- 计划频率：开发窗口里平均每月 6 个计划。
