# ADR 0002: Normalize Module Contracts Before Expanding Modules

日期：2026-04-01

## Status

Accepted

## Context

上一轮已经确定：当前仓库最真实的 active assets 仍然只有 operator docs、repo-local skills、append-only records 与 templates。

问题不在“模块太少”，而在“模块合同还不够稳定”：

- `modular-outline.md` 虽然已经有 active / latent module map，但字段名还是偏 prose，缺少固定 contract schema。
- dependency rules 混在 outline prose 里，不利于长期维护 cross-module coupling truth。
- 四个 active skills 的 boundary labels 与 module map 也不完全同构，未来容易 drift。

外部参考给出的信号也很一致：

- LangChain 强调很多复杂任务仍可以由单 agent 配合按需 skills/context engineering 完成，而不是默认多 agent。
- Dagster 强调 asset definitions 要显式声明资产和依赖，而不是让隐式 graph 成为真相。
- OpenLineage 把 job / run / dataset 与 design-time / runtime event 分开，说明 contract 与 event model 需要稳定对象边界。
- Qlib 把 experiment、recorder、run 分层，说明研究与记录系统应该先明确层级再扩运行时。

## Considered Options

### Option A: 维持现有 prose labels，不新增 dependency rules 文档

- 优点：最轻。
- 缺点：合同字段不稳定，耦合规则容易漂移。

### Option B: 维持现有模块集合，但把 module contracts 规范成固定 10 字段，并拆出独立 dependency rules 文档

- 优点：不增加模块数量，却显著提高边界稳定性和可维护性。
- 缺点：需要持续保持 docs 与 skill skeleton 对齐。

### Option C: 让文件系统直接成为 truth，创建更多未来目录

- 优点：看起来完整。
- 缺点：把未成熟边界提前冻结成目录，制造假复杂度和未来 churn。

## Decision

采用 Option B。

具体决策：

1. canonical module map 继续放在 `docs/architecture/modular-outline.md`。
2. 每个 module 必须使用同一组固定字段：
   - `mission`
   - `owned_artifacts`
   - `upstream_inputs`
   - `downstream_outputs`
   - `invariants`
   - `allowed_dependencies`
   - `forbidden_dependencies`
   - `non_goals`
   - `change_triggers`
   - `future_split_points`
3. cross-module coupling truth 单独维护在 `docs/architecture/dependency-rules.md`。
4. 不新增任何 runtime、data、backtest 或 agent implementation 目录。
5. active skills 的 boundary skeleton 应与 canonical module contract 尽量同构。

## Consequences

### Positive

- future diff 更容易判断“是边界变化，还是只是措辞变化”。
- dependency rules 不再埋在 prose 里，更容易防止循环依赖。
- active skills 和 architecture docs 更容易长期保持一致。
- 不需要大拆目录，也能提高 outline 的承重能力。

### Negative

- 文档字段更规范后，维护时会更像维护接口契约，而不是自由 prose。
- module map 与 dependency rules 分开后，需要明确哪个文件是 canonical truth、哪个文件是 coupling truth。

## Revisit When

- 出现第二个 active writer。
- 某个 active module 明确需要拆成两个独立 owner 的模块。
- 某个 latent chain 被 promotion 为真实目录。
- skill skeleton 和 module map 再次出现明显 drift。
