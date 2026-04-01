# ADR 0003: Separate Truth Surfaces Before Expanding Outline

日期：2026-04-01

## Status

Accepted

## Context

前两条 ADR 已经把模块合同和依赖规则分别稳定到：

- `docs/architecture/modular-outline.md`
- `docs/architecture/dependency-rules.md`

但仓库里仍然存在另一类更隐蔽的 churn 风险：

- `README.md`、`records/README.md`、templates、skill references 都在描述结构规则
- 这些文档面对的是不同读者，也有不同 change cadence
- 如果它们各自长出半份 schema、半份 ownership、半份 coupling truth，后续每次 refinement 都会变成多点同步

第一性原理上，这不是“文档多少”的问题，而是“不同生命周期的 truth 是否被放在同一个面上”的问题。

外部参考也给出了一致信号：

- LangChain 把 reliability 的重点放在 context engineering，而不是默认增加 agent 数量；这要求 context truth 有稳定 owner。
- Dagster 把 asset definitions 与 dependencies 明确建模，避免由散落说明文档来隐式决定 graph。
- OpenLineage 把 job / dataset 的静态描述与 run event 分开，说明 design-time truth 和 run-time truth 不应混写。
- Qlib 把 experiment 与 recorder 分开，强调一层一责、单一 owner。

## Considered Options

### Option A: 继续接受多份摘要文档并手工保持同步

- 优点：最省当下改动。
- 缺点：随着 skills、templates、records 演化，drift 会持续累积。

### Option B: 明确每类 truth 的 canonical owner，其他文档只做摘要或跳转

- 优点：最小增量即可显著降低 drift，且不新增模块。
- 缺点：要求维护时多一步判断“这条改动到底属于哪个 truth surface”。

### Option C: 把更多规则直接塞回单一 README

- 优点：表面上“集中”。
- 缺点：会把 onboarding、architecture、schema、workflow 混回一个大文档，重新制造不同 change cadence 的冲突。

## Decision

采用 Option B。

具体决策：

1. `AGENTS.md` 只维护路由和仓库级工作约束。
2. `README.md` 只维护 operator-facing 摘要，不再承担字段级 architecture / schema 真相。
3. `docs/architecture/modular-outline.md` 继续作为 canonical module map。
4. `docs/architecture/dependency-rules.md` 继续作为 cross-module edge、writer ownership 与 chain ownership truth。
5. `records/schema.md` 继续作为 records contract 的唯一 authority。
6. `records/README.md`、`templates/`、`skills/*/references/` 只做示例、落盘提示和输出骨架。
7. 如果摘要层与 canonical 层冲突，以 canonical 层为准，并优先修摘要层，而不是复制更多解释。

## Consequences

### Positive

- 未来 diff 更容易判断是 boundary change，还是只是摘要措辞变化。
- 可以继续 refinement，而不需要再通过新增目录来“制造清晰感”。
- skill skeleton、records docs 和 architecture docs 的职责更分明，更不容易互相抢真相。

### Negative

- 维护者需要多一层 discipline：先找 canonical owner，再改文件。
- 某些原本写在 README 或 references 里的“方便说明”会被压回链接式摘要。

## Revisit When

- 新增第二个 active writer。
- records contract 出现第二条 append-only chain 且需要独立 schema owner。
- 某个 skill 必须同时维护 conversation workflow 与独立 schema，已经无法继续只做摘要层。
- 仓库从 Codex-native workspace 演化成独立 runtime 项目。
