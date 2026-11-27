---
description: Rule check (v3.2) — deterministic runtime pinning/closure, security/supply-chain, and docs-drift checks via `doctor.py posture` (`--check all|runtime|security|docs`) plus cost regression gating via `doctor.py cost --write-baseline` and `--baseline`.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

在准备发布新版本前，我们需要用 product-doctor 对仓库做一次确定性的运行态与工程姿态体检，覆盖两个场景：
1. 一次性核查回放镜像与 Nautilus 锁版本（`uv.lock`、Dockerfile 禁止 `:latest` 漂移、`tests/runtime/test_replay_closure.py` 闭包一致性）、依赖与安全供应链姿态（`pyproject.toml`/`package.json` 锁文件与通配符、生产代码 AST 危险调用、Git 跟踪凭据文件）以及顶层与 skill 文档路径漂移（`broken_doc_refs`）。
2. 对 `engine` 回放耗时与内存做多尺度成本基线门禁：先保存一份基准 JSON，再在改动后自动比对时间增长指数、堆增长指数、峰值 RSS 和最大规模中位耗时回归，且不能只看单次运行时间或读 `.env`/`dolt/service.json`。

请给出按 product-doctor 规范应运行的命令、各项判定门限与解读原则（不用实际执行命令）。
