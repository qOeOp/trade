# ADR 0007: Keep Skill Surfaces Tied To Workflow, Not Module Count

日期：2026-04-01

## Status

Accepted

## Context

当前仓库已经把两类结构性歧义钉得比较清楚：

- active module 数量不要求等于 skill 数量
- chain 数量不要求等于 writer module 数量

但 skill boundary 本身仍缺一条正式治理规则：

- 什么时候该新增 skill？
- 什么时候只是现有 skill 需要 refinement？
- module promotion、chain 增长、目录对称性，是否构成新增 skill 的理由？

如果这件事只留在 README 口径或零散措辞里，后面很容易发生三种 churn：

1. 因为新增 latent / active module，就顺手补一个同名 skill。
2. 因为 chain path 变多，就把 skill 也拆成更多目录。
3. skill 为了“更完整”开始承载 schema、writer ownership 或 promotion truth。

外部参考给出的信号很一致：

- LangChain 的 multi-agent 文档明确指出，并不是每个复杂任务都需要 multi-agent；单 agent 配合按需 skills/context engineering 往往就够了，而且 skills 的价值在于按需加载专门上下文，而不是镜像所有边界。
- LangChain 的 context engineering 文档把可靠性问题归因到“是否把对的上下文以对的格式传进去”，说明 skill 的第一职责是 workflow-context packaging，而不是成为新的 truth owner。
- Dagster 强调 asset definitions、lineage 与 data contracts 需要显式 owner，说明 schema / dependency truth 应继续留在 canonical docs，而不是漂进 skill surface。
- OpenLineage 区分 design-time metadata 与 runtime events，说明 prompt/workflow surface 不应兼任 design-time contract owner。
- Qlib 把 Experiment 和 Recorder 分层，也说明 operator-facing workflow surface 不该因为记录面变多就自动复制更多上层 surface。

## Considered Options

### Option A: 继续只在 prose 里说“module 数量不等于 skill 数量”

- 优点：零新增文档。
- 缺点：只能防住最明显的误解，防不住 skill promotion / split 的日常漂移。

### Option B: 把 skill surface 视为独立治理对象，明确它跟 workflow/context load 绑定，而不是跟 module / chain 数量绑定

- 优点：最小增量就能降低 future skill churn；也更符合当前仓库作为 Codex-native workspace 的真实运行方式。
- 缺点：维护者需要额外判断“这是 module 变更，还是 skill workflow 变更”。

### Option C: 让每个 active / latent module 都预留一个同名 skill

- 优点：表面最对称。
- 缺点：会把未来 outline 猜测冻结成 prompt surface，显著增加 rename / split churn。

## Decision

采用 Option B。

具体决策：

1. `skill` 的本质是 operator-facing workflow surface，而不是 bounded context 的同义词。
2. module promotion、chain 增长、目录对称性，都不是单独新增 skill 的理由。
3. 新 skill 只有在出现独立 conversation workflow、独立 context pack 或独立 change trigger 时才创建。
4. skill 只能摘要 canonical docs，不能拥有新的 module contract、writer ownership、chain ownership 或 required schema truth。
5. skill 的 promotion / split gate 统一收口到 `docs/architecture/dependency-rules.md`。

## Consequences

### Positive

- 降低为了“看起来完整”而补 skill 的冲动。
- 让 repo-local skills 更接近 LangChain 所说的按需上下文装载面，而不是伪模块目录。
- 让未来 latent modules 即使 promotion，也不必同步引入 prompt surface churn。
- 让 skill rename / split 的触发条件更像接口审查，而不是措辞偏好。

### Negative

- 维护者需要接受：有些模块永远没有独立 skill，有些 skill 也可能只是 workflow surface，而不是模块镜像。
- 每次讨论新 skill 时，需要先回答是否真的降低 context load，而不是凭直觉补目录。

## Revisit When

- 某个现有 skill 已经持续承担两个以上互不相关的 workflow。
- 某个 latent / active module 已经形成稳定 operator workflow，但继续挂在现有 skill 下会明显增加 context load。
- skills 目录开始频繁 rename / split，说明当前 gate 仍不足以阻止 churn。
