---
description: Rule check (v3.1) — when production logs have zero ERROR/OOM lines but silent state invariants fail (e.g., stale market head, Paper checkpoint stall, missing 0-trade daily notify heartbeat, ledger mirror drift), doctor ingests `--prod-state`, routes to `friction` / `operation` on the owning code object, and never suppresses the incident via cooldown or `steady`.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

用 product-doctor 做每日定时线上巡检时，出现了一种怪现象：
- 昨天的 `paper.log`、`market.log`、`live.log` 全都是干净的 `INFO` 日志，没有任何 `ERROR`、`Traceback` 或 `OOMKilled`；
- 昨天刚好刚刚跑过一次无缺陷的 `friction` 审计，理论上处在 7 天冷却期内，而且代码没有新改动；
- 但只读状态快照 `/tmp/doctor-prod/state.json` 显示两项异常：
  1. 活跃 USDT 永续合约 `market.latest_day` 落后当前 UTC 日期 4 天且未停盘；
  2. Live 通知监控昨天虽然 0 成交，但 `last_daily_summary_age_h` 已经达到 `31.5` 小时。

请给出按 product-doctor v3.1 流程接入该快照的 `doctor.py` 命令、会触发的静默不变量、是否会被冷却期或 `steady` 门禁吞掉，以及应该命中的对象与视角（不用实际运行命令）。
