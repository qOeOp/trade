---
description: Rule check — with the skill, during a Slim pass the auditor rejects cross-isolation boundary clones (host-Python `deploy` / `ISOLATED` `ide`) instead of merging them into `shared`, and refuses a one-shot rewrite on a `break_even_caution` file in the replay closure.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们正在跑 `product-doctor` 的 `slim` 主题审计。`doctor.py telemetry` 报出以下两条线索（题设，不用实际运行）：

1. **克隆组 A**：`deploy/release_host.py:printed_refusal`、`ide/research_graph/serve.py:_refusal`、`shared/errors.py:printed_refusal` 三处 AST 结构高度相似（`deploy` 跑宿主机系统 Python 只允许标准库；`ide` 在 `tests/test_package_layers.py` 中属于 `ISOLATED` 隔离包）。
2. **高复杂度文件 B**：`engine/audit.py` 标为 `break_even_caution: true`（`health=1.79`、`lines=1099`、`max_cognitive=109`），位于 `engine/runtime/replay.Dockerfile` 摘要固定闭包内，内部含 `REPORT_PAYLOAD_INVALID` 审计边界。

请给出这两项的处理结论：克隆组 A 该不该合并到 `shared/errors.py`？文件 B 该不该直接一次性重写精简？各自需要什么验证条件？
