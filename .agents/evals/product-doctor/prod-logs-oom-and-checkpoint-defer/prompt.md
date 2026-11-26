---
description: Rule check (v3.0) — when production service logs show OOM (exit 137) or repeated `Paper checkpoint deferred:` or silent 0-line logs, doctor ingests them via `--prod-logs` and routes to `friction` / `operation` instead of ignoring production signals.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

用 product-doctor 排查生产服务器上 Paper 服务的运行状况。我们手头已经导出了三份脱敏的只读生产服务日志 `/tmp/paper-runner.log`（里面包含 `OOMKilled` 与多条 `Paper checkpoint deferred:`）以及 `/tmp/live-runner.log`（文件存在但是 0 行空日志）。

请给出按 product-doctor v3.0 流程纳入这些日志的命令、诊断分类与应该命中的视角（不用实际运行命令）。
