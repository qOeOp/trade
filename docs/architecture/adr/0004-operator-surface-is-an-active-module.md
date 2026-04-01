# ADR 0004: Make Operator Surface An Explicit Active Module

日期：2026-04-01

## Status

Accepted

## Context

当前 canonical module map 已经把 `operator-surface` 视为 active module，并明确其拥有：

- `AGENTS.md`
- `README.md`
- `docs/architecture/`

但仓库仍保留一个轻微却高频的歧义源：

- repo-local skills 只有四个
- active modules 有五个
- 早期 ADR 只显式列出四个 skill-backed active modules

本 ADR 用来澄清并局部 supersede `ADR 0001` 中对 active modules 的早期表述；字段级 canonical truth 仍以 `docs/architecture/modular-outline.md` 为准。

这个歧义会诱发两类错误判断：

1. 误以为 active module 必须一一对应一个 skill。
2. 误以为 `operator-surface` 只是“入口说明”，不是需要被单独维护边界的模块。

外部参考给出的信号很一致：

- LangChain 把 multi-agent handoff 的重点放在显式 context engineering，而不是默认增加 agent 数量；这意味着入口与路由面本身就是需要独立 owner 的 surface。
- Dagster 把 asset definition 与 dependency truth 提升为显式对象，说明“描述系统如何被组织”本身就是一类资产，不应只是附属说明。
- OpenLineage 把 Job / Run / Dataset 分开，说明 design-time object 与 run-time event 应有清晰边界。
- Qlib 把 workflow、experiment、recorder 分层，说明入口编排面不该和 run record 面混成一层。

## Considered Options

### Option A: 维持现状，不新增 ADR

- 优点：零改动。
- 缺点：active module 数量与 skill 数量之间的歧义继续存在，后续容易为了对称性错误加模块或加 skill。

### Option B: 明确把 `operator-surface` 升级为 docs-owned active module，并记录“active module 不必对应 skill”

- 优点：最小增量即可钉死边界，避免未来为对称性制造假复杂度。
- 缺点：需要同步入口摘要文档，避免旧说法继续漂移。

### Option C: 为 `operator-surface` 新建一个 repo-local skill

- 优点：表面上更对称。
- 缺点：会把 docs-owned routing surface 错误包装成 prompt package，制造新的维护面，而不是降低耦合。

## Decision

采用 Option B。

具体决策：

1. `operator-surface` 是 first-class active module，而不是附属说明层。
2. `operator-surface` 的主资产是 docs surfaces，不要求存在对应的 repo-local skill。
3. active module 数量不需要等于 skill 数量；skill 只是 module 可能采用的一种 surface。
4. 只有当 routing workflow 本身出现第二个独立变更原因、独立 owner 或独立维护 cadence 时，才考虑把 `operator-surface` 进一步拆分，而不是先补一个 skill。
5. `AGENTS.md` 与 `README.md` 只能摘要这条决策，不重新定义 module contract。

## Consequences

### Positive

- 降低“为了模块对称性而补 skill / 补目录”的冲动。
- 让 `AGENTS.md`、`README.md`、`docs/architecture/` 的 ownership 更稳定。
- 让后续 architecture refinement 更聚焦在 asset ownership，而不是目录外观。

### Negative

- 需要接受 active modules 与 skills 不是一一映射，这比“每层都对称”更反直觉。
- 后续维护者需要先判断某条变更属于 docs surface、skill surface 还是 record surface，再决定改哪里。

## Revisit When

- `operator-surface` 同时承载 routing handbook、review handbook、handoff playbook，已经出现多个独立变更原因。
- 出现第二个 docs-owned active module，需要统一 surface taxonomy。
- repo-local skills 与 docs-owned surfaces 的映射再次引发明显 drift。
