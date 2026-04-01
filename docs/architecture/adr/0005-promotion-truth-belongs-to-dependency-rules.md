# ADR 0005: Keep Promotion Truth Inside Dependency Rules

日期：2026-04-01

## Status

Accepted

## Context

前几轮已经把 truth surfaces 收敛为：

- `docs/architecture/modular-outline.md` 维护 canonical module map
- `docs/architecture/dependency-rules.md` 维护 cross-module edges、writer ownership、chain ownership 与 promotion rules

但仓库里还残留一个会持续制造 drift 的缺口：

- `modular-outline.md` 仍复制了一份 promotion rules
- `dependency-rules.md` 也维护了一份 promotion rules
- 两边条件已经开始出现轻微但真实的差异

这不是措辞问题，而是 canonical owner 再次被双写了。

外部参考给出的信号是一致的：

- LangChain 把可靠性重点放在 context engineering，而不是先增加更多 agent surface；这要求 context boundary 有单一 owner。
- Dagster External Assets 先定义 asset 的 structure、lineage、metadata，再把 runtime events 注入 event log；这说明 promotion 前应先钉死 design-time ownership。
- OpenLineage 把 design-time object model 与 runtime event 分开，说明“对象边界”不应和“运行事件”混写在多个真相面。
- Qlib 强调 loosely-coupled components，并把 execution tracking 放进 recorder system；这说明 promotion 决策应跟依赖与记录 ownership 一起收口。

## Considered Options

### Option A: 继续允许 `modular-outline.md` 和 `dependency-rules.md` 各写一份 promotion rules

- 优点：不用改现有结构。
- 缺点：会继续制造 drift，而且每次 refinement 都要双点同步。

### Option B: 把 promotion truth 完全收回 `dependency-rules.md`，`modular-outline.md` 只保留跳转

- 优点：符合 truth surface 分层；promotion 直接和 edge / writer / chain ownership 一起维护。
- 缺点：维护者需要接受“module map 不负责决定何时落真实目录”。

### Option C: 再新增一份独立 promotion guide 文档

- 优点：表面上更聚焦。
- 缺点：会长出第三个 canonical 候选 owner，反而扩大 surface area。

## Decision

采用 Option B。

具体决策：

1. `modular-outline.md` 只负责声明 active / latent module contracts，不再复制 promotion 条件。
2. `dependency-rules.md` 是 promotion rules 的唯一 canonical owner。
3. 在真正创建 latent module 目录前，同一变更集必须先在 `dependency-rules.md` 层面回答最小 promotion gate。
4. promotion gate 至少要明确：
   - 当前哪个既有模块已经过载，以及为什么不能继续拥有该资产
   - 新模块的首批 `owned_artifacts` 与 storage truth
   - 新模块是 reader-only 还是 writer；如果是 writer，它独占哪条 append-only chain
   - 它的 10 字段合同是否已经能具体填写，而不是继续写 future-maybe prose
   - promotion 后是否仍保持无循环依赖，并避免短期内再次 rename / move / split

## Consequences

### Positive

- 降低 canonical docs 之间的 drift 风险。
- 让“何时 promotion”与“promotion 后会引入什么耦合/写权限”在同一真相面里判断。
- 避免为了说明清楚而再新增一份 playbook 型 architecture 文档。

### Negative

- 维护者要更自觉地区分“module map 变化”和“promotion decision 变化”。
- promotion 讨论会更像接口审查，而不是自由 brainstorming。

## Revisit When

- promotion rules 本身出现第二个独立 owner 或 review cadence。
- 仓库真的开始频繁 promotion latent modules，且 gate 内容已经长到影响 `dependency-rules.md` 可读性。
- 出现第二个 docs-owned coupling truth surface，需要重新评估是否拆出更细的 governance 文档。
