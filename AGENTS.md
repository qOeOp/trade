# AGENTS.md

本仓库是一个 `Codex 原生 BTC 交易工作仓库`，不是独立应用。

## Mission

- 在 Codex 对话里直接完成 BTC 市场分析、情景化交易计划、历史决策落盘与复盘。
- 用本地 `skills/` 约束回答风格、风险边界和记录格式。
- 用 Git 追踪每一次交易想法、调整、执行和平仓，而不是把历史覆盖掉。

## Capability Boundary

- 这些 repo-local skills 不是全局安装到 `$CODEX_HOME/skills` 的系统级 skill。
- 在这个仓库里，它们通过本文件被显式路由和使用。
- 如果将来需要跨仓库复用，再单独安装为全局 skill。

## Skill Routing

遇到相关请求时，优先打开并遵循这些文件：

1. `skills/trade-risk-guard/SKILL.md`
2. `skills/btc-market-brief/SKILL.md`
3. `skills/btc-trade-scenarios/SKILL.md`
4. `skills/trade-record-chain/SKILL.md`

## Architecture Routing

当用户在问：

- `这个仓库的模块怎么拆`
- `哪些模块现在不该建`
- `record schema 怎么定`
- `skill 边界怎么收敛`

先读：

1. `docs/architecture/modular-outline.md`
2. `docs/architecture/dependency-rules.md`
3. `docs/architecture/adr/0001-skills-first-workspace.md`
4. `docs/architecture/adr/0002-contract-first-module-map.md`
5. `docs/architecture/adr/0003-truth-surfaces-first.md`
6. `docs/architecture/adr/0004-operator-surface-is-an-active-module.md`
7. `docs/architecture/adr/0005-promotion-truth-belongs-to-dependency-rules.md`
8. `docs/architecture/adr/0006-chain-family-belongs-to-writer-module.md`
9. `docs/architecture/adr/0007-skill-surfaces-follow-workflow-not-module-count.md`
10. `records/schema.md`

### Use `btc-market-brief`

当用户在问：

- `现在 BTC 结构怎么看`
- `今天偏多还是偏空`
- `关键支撑阻力在哪`

### Use `btc-trade-scenarios`

当用户在问：

- `给我多空两套计划`
- `开单和平仓点位怎么定`
- `突破和回踩分别怎么做`

### Use `trade-record-chain`

当用户在问：

- `把这次决策落盘`
- `记录这笔交易`
- `更新这笔单`
- `把这笔平仓并复盘`

## Freshness Rule

- 只要用户问的是 `当前 / 最新 / 现在 / 今天` 的 BTC 信息，先验证最新市场数据，再回答。
- 优先使用可信的一手或主流市场数据源。
- 如果线程里已经有刚刚验证过的数据，可以复用，但要明确数据时间。

## Persistence Rule

- 只有在用户明确要求 `记录 / 落盘 / 保存 / 归档 / 复盘` 时，才写入仓库。
- 不要偷偷把普通聊天都写进记录。

## Record Model

采用 append-only 事件链，不要覆写历史判断：

- 新交易案例：创建 `records/trades/YYYY/YYYY-MM-DD-<slug>/`
- 初始信息：写 `meta.md`（只放 case identity 与慢变化元数据）
- 每次变化：追加 `events/NNNN-<event-type>.md`

允许的 `event-type`：

- `decision`
- `update`
- `execution`
- `risk`
- `close`
- `review`

## Editing Rule

- 不要修改旧事件文件来“修正历史”。
- 如果观点变了、止损变了、计划取消了，新增下一条事件。
- 只有在用户明确要求修 typo 或修格式时，才回改旧文件。

## Architecture Rule

- 优先 `refinement over expansion`，先收紧边界，再考虑新增模块。
- canonical module map 以 `docs/architecture/modular-outline.md` 为准；耦合约束、chain ownership 与 promotion rules 以 `docs/architecture/dependency-rules.md` 为准。
- `README.md`、`records/README.md`、templates、skill references 只做摘要与引导，不重新定义 architecture truth 或 record schema。
- active module 数量不要求等于 repo-local skill 数量；`operator-surface` 是 docs-owned active module，不需要为了对称性补一个 skill。
- skill 是 workflow surface，不是 bounded context 的镜像；新增或拆分 skill 以 `docs/architecture/dependency-rules.md` 中的 skill gate 为准。
- 候选 bounded contexts 可以先存在于 architecture docs，不要急着建真实目录。
- 只有当现有模块出现多个独立变更原因时，才允许拆模块。
- `decision-chain` 是唯一 records writer；其他模块默认只读 records。

## Path Convention

- 路径和文件名使用 ASCII、小写、短横线。
- 正文内容优先中文。
- 时间默认使用 `Asia/Shanghai`。

参考：

- `records/README.md`
- `templates/trade-case/`
- `templates/daily-note.md`
