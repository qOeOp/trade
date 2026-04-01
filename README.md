# BTC Trade Workspace

这个仓库不是独立聊天应用。

它是一个直接在 Codex 里使用的 BTC 交易工作仓库，包含两类核心资产：

- `skills/`：约束 Codex 如何分析 BTC、如何给出情景化计划、如何控制风险、如何把交易决策落盘
- `records/`：存放历史交易、决策更新、执行记录、平仓结果与复盘，适合直接交给 Git 追踪

## 这是什么

这是一个 `Codex-native` 的工作流：

1. 你在这个仓库里直接和 Codex 聊
2. Codex 依据 [AGENTS.md](/Users/vx/WebstormProjects/trade/AGENTS.md) 读取本地 skills
3. 当你问当前 BTC，Codex 先验证最新市场数据，再回答
4. 当你说 `记下来`、`落盘`、`更新这笔单`，Codex 把结论写进 `records/`

更具体的模块边界与未来演进规则，见：

- [docs/architecture/modular-outline.md](/Users/vx/WebstormProjects/trade/docs/architecture/modular-outline.md)
- [docs/architecture/dependency-rules.md](/Users/vx/WebstormProjects/trade/docs/architecture/dependency-rules.md)
- [docs/architecture/adr/0001-skills-first-workspace.md](/Users/vx/WebstormProjects/trade/docs/architecture/adr/0001-skills-first-workspace.md)
- [docs/architecture/adr/0002-contract-first-module-map.md](/Users/vx/WebstormProjects/trade/docs/architecture/adr/0002-contract-first-module-map.md)
- [docs/architecture/adr/0003-truth-surfaces-first.md](/Users/vx/WebstormProjects/trade/docs/architecture/adr/0003-truth-surfaces-first.md)
- [docs/architecture/adr/0004-operator-surface-is-an-active-module.md](/Users/vx/WebstormProjects/trade/docs/architecture/adr/0004-operator-surface-is-an-active-module.md)
- [docs/architecture/adr/0005-promotion-truth-belongs-to-dependency-rules.md](/Users/vx/WebstormProjects/trade/docs/architecture/adr/0005-promotion-truth-belongs-to-dependency-rules.md)
- [docs/architecture/adr/0006-chain-family-belongs-to-writer-module.md](/Users/vx/WebstormProjects/trade/docs/architecture/adr/0006-chain-family-belongs-to-writer-module.md)
- [docs/architecture/adr/0007-skill-surfaces-follow-workflow-not-module-count.md](/Users/vx/WebstormProjects/trade/docs/architecture/adr/0007-skill-surfaces-follow-workflow-not-module-count.md)
- [records/schema.md](/Users/vx/WebstormProjects/trade/records/schema.md)

## 这不是什么

这不是：

- 独立 Web App
- 独立 CLI Chat 程序
- 自动下单机器人
- 个性化投资顾问

如果项目目标是“做一个单独的聊天产品”，那应该是另一条产品线，不该和这个仓库混在一起。
这个仓库的第一性原理是：`让分析与决策可复用、可追溯、可复盘`。

## 设计推导

### 路径 1：做独立聊天应用

优点：

- 容易想象
- 看起来完整

问题：

- 偏离了你真正的使用方式，你本来就直接在 Codex 里聊
- 会把精力浪费在运行时、前端、CLI 和接口封装上
- 对“交易记录落盘”这个核心价值帮助不大

### 路径 2：只放一些零散提示词

优点：

- 最轻

问题：

- 没有结构
- 没有历史记录约束
- 很快会失控，知识和记录都会碎掉

### 路径 3：做 Codex 原生工作仓库

保留技能、强化记录、用 Git 追踪整个决策链。

这是当前选择，因为它最符合你的实际工作流：

- 交互入口已经存在，就是 Codex
- 仓库真正应该沉淀的是 `skill` 和 `history`
- 交易这种事最需要的是可追溯链路，不是再套一层聊天壳

## 仓库结构

```text
.
├── AGENTS.md
├── README.md
├── docs
│   └── architecture
├── records
│   ├── README.md
│   ├── schema.md
│   ├── daily
│   └── trades
├── skills
│   ├── btc-market-brief
│   ├── btc-trade-scenarios
│   ├── trade-record-chain
│   └── trade-risk-guard
└── templates
    ├── daily-note.md
    └── trade-case
```

## Skills

### `trade-risk-guard`

控制回答边界：

- 不承诺收益
- 不伪装成个性化投资建议
- 不鼓励极端杠杆

### `btc-market-brief`

负责先回答：

- 现在结构偏多还是偏空
- 关键支撑阻力在哪里
- 当前是趋势、震荡还是高波动阶段

### `btc-trade-scenarios`

负责把市场判断收敛成：

- 多头情景
- 空头情景
- 触发条件
- 入场区
- 止损
- 止盈
- 失效条件

### `trade-record-chain`

负责把一次交易从想法到复盘落成 append-only 记录链。

## 模块收敛

这段只保留高层摘要。

字段级 module contract 以 [docs/architecture/modular-outline.md](/Users/vx/WebstormProjects/trade/docs/architecture/modular-outline.md) 为准；cross-module edges、writer ownership、chain ownership 与 promotion rules 以 [docs/architecture/dependency-rules.md](/Users/vx/WebstormProjects/trade/docs/architecture/dependency-rules.md) 为准。

当前 active modules 只有五个：

- `operator-surface`
- `risk-guard`
- `research-synthesis`
- `scenario-planning`
- `decision-chain`

其中 `operator-surface` 是 docs-owned active module，因此 active module 数量不要求等于 repo-local skill 数量。

`decision-chain` 是一个 writer module，不是单条链的别名；它当前同时拥有 `records/daily/` 与 `records/trades/` 两条 append-only chains，所以“链变多了”本身不是拆模块理由。

这些模块的 canonical contract 统一使用固定 10 字段，cross-module coupling truth 与 promotion gate 单独维护在 [docs/architecture/dependency-rules.md](/Users/vx/WebstormProjects/trade/docs/architecture/dependency-rules.md)。

repo-local `skill` 也是受治理的 surface，但它绑定的是 operator workflow 与 context packaging，不是 bounded context 数量本身。只有当出现独立 conversation workflow、独立 context pack，且继续塞进现有 skill 会明显增加耦合时，才新增或拆分 skill；module promotion、chain 增长和目录对称性都不是单独理由。canonical gate 同样以 [docs/architecture/dependency-rules.md](/Users/vx/WebstormProjects/trade/docs/architecture/dependency-rules.md) 为准。

未来可能出现的 `market-ingest`、`market-cleanroom`、`market-catalog`、`news-ingest`、`news-chain`、`rd-lab`、`backtest-lab`、`eval-bench`、`operator-playbooks`，现在只保留为文档里的 latent contracts，不提前建空目录。

这不是保守，而是刻意避免假复杂度：

- 先把接口和 invariants 写清
- 先把 module contracts 和 dependency rules 写稳
- 等到真的出现第二个独立变更原因，再升级成真实模块

## 记录模型

每一笔交易都是一个独立案例目录：

```text
records/trades/2026/2026-04-01-btc-breakout-long/
├── meta.md
└── events
    ├── 0001-decision.md
    ├── 0002-update.md
    └── 0003-close.md
```

规则只有一个核心原则：

- 不要回头改写历史判断

如果计划变了，不改 `0001`，而是新增 `0002-update.md`。
这样 Git 历史和目录历史会形成双重审计链。

补一条容易混淆但很关键的规则：

- `meta.md` 只保存 case identity 与慢变化元数据
- 交易生命周期真相以 `events/` 为准

## 直接怎么用

在这个仓库里直接和 Codex 聊。

### 常见提问

- `现在 BTC 结构怎么看？`
- `给我多空两套情景和关键失效位。`
- `把刚才这套计划落盘。`
- `把这笔单记成一个新 case。`
- `给这笔交易追加一条风控更新。`
- `把这笔平仓并写个简短复盘。`

### Codex 落盘时的目标位置

- 新案例：`records/trades/YYYY/YYYY-MM-DD-<slug>/`
- 日记：`records/daily/YYYY/YYYY-MM-DD.md`

具体格式看：

- [records/README.md](/Users/vx/WebstormProjects/trade/records/README.md)
- [records/schema.md](/Users/vx/WebstormProjects/trade/records/schema.md)
- [templates/trade-case/meta.md](/Users/vx/WebstormProjects/trade/templates/trade-case/meta.md)
- [templates/daily-note.md](/Users/vx/WebstormProjects/trade/templates/daily-note.md)

## 诚实边界

这个仓库里的 skill 是 `repo-local` 资产，不是自动安装到全局的系统 skill。

这意味着：

- 在本仓库里，Codex 可以通过 [AGENTS.md](/Users/vx/WebstormProjects/trade/AGENTS.md) 主动读取和遵循它们
- 如果你想在别的仓库也自动复用这些 skill，后面需要再把它们安装到 `$CODEX_HOME/skills`

## 下一步最值得做的事

1. 继续只做 outline 级演进，不要过早把 latent contracts 变成真实目录
2. 让新增 `daily note` 与 `trade event` 优先使用 `source_refs` / `derived_from`，`trade meta` 继续使用 `source_note_refs`
3. 只有当某个 active surface 真正出现第二个独立变更原因或独立 owner 时，再考虑拆 skill 或拆 chain，不为了对称性补模块
4. 如果以后真要产品化，再单独开一个运行时项目，不要污染这个知识仓库

## 文档真相层级

- `AGENTS.md`：路由规则与仓库级约束。
- `README.md`：operator-facing 摘要，不承载字段级 contract。
- `docs/architecture/modular-outline.md`：canonical module map。
- `docs/architecture/dependency-rules.md`：cross-module edges、writer ownership、chain ownership、promotion rules。
- `docs/architecture/adr/*.md`：被接受的结构决策与取舍原因。
- `records/schema.md`：record schema 与 lineage rules 的唯一 authority。
- `records/README.md`、`templates/`、`skills/*/references/`：示例与工作提示；若与 canonical docs 冲突，以 canonical docs 为准。
