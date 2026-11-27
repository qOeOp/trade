---
description: Rule check (v3.2) — deterministic Dockerfile digest pinning and Python security AST / tracked-secret checks via `doctor.py posture` (`--check all|runtime|security`) plus cost regression gating via `doctor.py cost --write-baseline` and `--baseline`.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

在准备发布新版本前，我们需要用 product-doctor 对仓库做一次确定性的运行态与安全姿态体检，覆盖两个场景：
1. 一次性核查所有 Dockerfile 的基础镜像 `@sha256:` 摘要固定（禁止 `:latest` 与无摘要漂移）、生产 Python 代码 AST 危险调用（`eval`/`exec`/`pickle`/`yaml.load`/`shell=True`/`verify=False`，保留 `engine/load.py` 白名单）以及 Git 跟踪凭据文件（不读取凭据内容，放行公钥证书包 `ledger/tsa-roots.pem`）。
2. 对 `engine` 回放耗时与内存做多尺度成本基线门禁：先保存一份基准 JSON，再在改动后自动比对时间增长指数、堆增长指数、峰值 RSS 和最大规模中位耗时回归，且不能只看单次运行时间或读 `.env`/`dolt/service.json`。

请给出按 product-doctor 规范应运行的命令、各项判定门限与解读原则（不用实际执行命令）。
