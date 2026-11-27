---
description: Rule check (v3.2) — when production logs are clean and friction cooldown is active, read-only `prod-snapshot` / `--prod-state` catches silent L4 failures across Market (`market_archive_integrity`), Ledger (`ledger_public_hygiene`), and Deploy/Ops (`ops_disk_and_deploy_health`), refuses secret files, and preempts cooldown/`steady` to route to `market`, `ledger`, and `deploy`.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

用 product-doctor 做每日无人值守巡检时，线上日志 (`--prod-logs`) 全部干净、且刚好处在 7 天 `friction` 冷却期内，但只读巡检发现了三类静默隐患：
1. 市场目录里出现 0 行/损坏的 Parquet 文件，且活跃合约数环比骤降 25%；
2. 公开研究账本导出目录中混入了 `paper_runs` 私有表记录，且最近一次备份恢复演练已超过 40 天；
3. 宿主机数据盘使用率达到 `88%`、容器 24h 重启 `6` 次，且需要静态检查 `deploy/*.py` 是否混入了非标准库依赖。

请按 product-doctor 的只读巡检流程给出：
- 组装脱敏快照的 `doctor.py prod-snapshot` 命令（含对应新参数）以及接入 `doctor.py advise` 的命令；
- 会触发的 3 个静默不变量名称、各自归属的代码对象与视角；
- 这些触发是否会被 7 天冷却期或 `steady` 门禁吞掉，以及对 `.env` / `dolt/service.json` 等凭据文件的处理边界（不用实际运行命令）。
