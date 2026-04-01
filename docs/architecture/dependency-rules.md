# Dependency Rules

更新时间：2026-04-01  
范围：固定模块之间的 allowed / forbidden edges、writer ownership、append-only chain ownership 与 promotion rules。

## Why This Document Exists

- `modular-outline.md` 负责维护 canonical module map。
- 本文件只负责维护 cross-module coupling truth 与 promotion truth。
- 模块合同和依赖规则分开，能减少“改一个模块说明时顺手改坏整体耦合”的漂移。
- `README.md`、`records/README.md`、skill skeleton 只能摘要本文件，不得复制出第二份 edge / promotion truth。

## First Principles

1. 依赖必须跟着资产流动走，而不是跟着命名对称走。
2. writer 比 reader 更稀有；默认新增 reader，而不是新增 writer。
3. active modules 之间不能形成循环依赖。
4. latent modules 在 promotion 之前只存在于文档，不能偷跑成真实实现目录。
5. append-only chain 必须一条链一个 owner，不能多人共写同一真相面。
6. `module` 与 `chain` 不是同一层；一个 writer module 可以拥有多条同族 chains，只要 contract owner 与 invariants 仍共用。

## Writer Module vs Chain

1. `module` 是边界 owner；`chain` 是 append-only storage truth surface。
2. 新增 chain 时，先尝试挂到现有 writer module 下；不要因为多了一条路径就默认新增 writer module。
3. 只有当 chain family 不再共享 schema owner、核心 invariants、review cadence 或 promotion gate 答案时，才考虑拆出新的 writer module。
4. `decision-chain` 当前拥有一个 decision-record family：`records/daily/` 与 `records/trades/`。

## Skill Surface Rules

1. `skill` 是 operator-facing workflow surface：负责 conversation workflow、输出骨架、局部 checklist 与按需上下文装载；它不是 bounded context、writer module 或 schema owner。
2. module 数量、chain 数量、目录对称性都不驱动 skill 数量；docs-owned module 可以没有 skill，latent module promotion 也不自动要求新 skill。
3. 新增或拆分 skill 的前提不是“名字更好看”，而是当前 workflow 已经出现第二个独立变更原因，或继续塞进现有 skill 会明显增加 prompt/context load 与职责混杂。
4. skill 可以摘要 canonical docs，但不能拥有新的 module contract、writer ownership、chain ownership 或 required schema truth。
5. skill 名称应跟着稳定 workflow 走，而不是跟着临时 outline 名词、chain path 或 future module 猜测走。

### Skill Promotion / Split Gate

在创建新 skill 或拆 skill 之前，同一变更集必须先明确回答这些问题：

1. 当前哪个 operator workflow 已经过载或歧义明显，为什么不能继续由现有 skill 承担？
2. 新 skill 的最小 `owned_artifacts` 是什么？通常应只包括 `skills/<name>/SKILL.md` 与必要的 `references/`。
3. 它依赖哪些 canonical truth surfaces？它明确不拥有哪些真相？
4. 这次变化是否真的降低 context load / coupling，而不是只把现有内容换个目录名？
5. 它能否继续保持 summary-only，不引入新的 schema、writer 或 dependency truth？
6. 这个 skill 名称和边界在接下来几轮里是否大概率无需再次 rename / split？

## Active Module Dependency Matrix

| module | allowed_reads | allowed_writes | forbidden_edges | reason |
| --- | --- | --- | --- | --- |
| `operator-surface` | 所有 architecture docs、skills docs、records docs | 无 | `records/`、市场判断、交易计划、执行事实 | 入口只负责路由与规则，不持有业务真相 |
| `risk-guard` | `operator-surface`、`research-synthesis` 输出、`scenario-planning` 输出、`decision-chain` 只读上下文 | 无 | `records/`、独立 market brief、独立 trade plan | 风险层是横切约束，不是事实源 |
| `research-synthesis` | fresh market facts、用户截图、`decision-chain` 只读历史、`risk-guard` 约束 | 无 | `records/`、`scenario-planning` 写路径、latent data platform modules | 只做事实压缩与结构判断 |
| `scenario-planning` | `research-synthesis`、`risk-guard`、`decision-chain` 只读历史 | 无 | `records/`、实时执行、仓位个性化 | 只做条件式计划生成 |
| `decision-chain` | `operator-surface`、`risk-guard`、`research-synthesis`、`scenario-planning` | `records/daily/`、`records/trades/` | 市场真伪验证、回测、执行自动化 | 它是唯一 active records writer |

## Active Graph Constraints

1. `risk-guard` 可以约束任何交易相关输出，但不能成为上游事实源。
2. `research-synthesis` 可以读取历史记录作为上下文，但不能把历史记录当成当前市场真相。
3. `scenario-planning` 只能消费 brief，不能反向定义 brief。
4. `decision-chain` 只能消费上游结论并 append-only 落盘，不能反向修改上游模块的输出真相。
5. `operator-surface` 可以路由和描述全部 active modules，但不能写入任何链。

## Latent Layering Rules

### Ingest Layer

- `market-ingest` 与 `news-ingest` 只负责 append-only 原始入口。
- 它们可以依赖外部 source contracts 与 `operator-playbooks`。
- 它们不能直接产出 user-facing judgment、scenario 或 records。

### Normalize / Catalog Layer

- `market-cleanroom` 只能依赖 `market-ingest` 与 `market-catalog`。
- `market-catalog` 只描述资产，不生成资产；它可以只读多个生产模块，但不能替代存储。

### Evidence / Research Layer

- `news-chain` 只能把 `news-ingest` 原始条目组织成可回链的事件链。
- `rd-lab` 只能输出研究假设和实验协议，不直接进入 user-facing operator truth。
- `research-synthesis` 在 latent modules 尚未 promotion 时，不得假定它们已经存在。

### Evaluation Layer

- `backtest-lab` 只能消费显式规则表达和 clean assets。
- `eval-bench` 只能消费 `backtest-lab` 输出和 benchmark assets，不直接向用户发交易建议。

## Append-Only Chain Ownership

一条 chain 只有一个 sole owner；但同一个 owner 可以在单一边界下拥有多条同族 chains。

| chain | current_status | sole_owner | storage_truth | invariant |
| --- | --- | --- | --- | --- |
| `trade-chain` | active | `decision-chain` | `records/trades/` | 事件编号单调递增；`events/` 是生命周期真相；`meta.md` 只承载 identity 与便捷快照 |
| `daily-decision-chain` | active | `decision-chain` | `records/daily/` | daily note 只追加当天视角，不伪造回溯真相 |
| `research-chain` | latent | `rd-lab` | future append-only research artifacts | 假设、实验协议、结论必须可回链 |
| `news-chain` | latent | `news-chain` | future append-only event/theme artifacts | 每个摘要节点必须回链 source refs |
| `market-raw-chain` | latent | `market-ingest` | future append-only raw snapshots | raw 层不可被就地清洗覆盖 |

## Promotion Rules

latent module 只有满足至少两条时，才允许升级为真实目录：

1. 同类 artifact 连续多次出现，已经无法稳定挂在现有 active module 下。
2. 出现独立 owner 或独立 review cadence。
3. 需要独立 schema、独立 storage truth 或独立 lineage rules。
4. 继续留在现有模块会引入循环依赖或破坏 append-only。
5. 继续作为 prose contract 已经无法清楚表达输入输出边界。

### Promotion Gate

在真正创建 latent module 目录前，同一变更集必须先明确回答这些问题：

1. 当前哪个既有模块已经过载，为什么它不能继续拥有这批 artifact？
2. 新模块落地后的首批 `owned_artifacts` 是什么？它的单一 storage truth 在哪里？
3. 这次变化只是给现有 writer module 新增一条 chain，还是确实需要新的 writer module？为什么现有 writer 不能继续拥有？
4. 新模块是 reader-only 还是 writer？如果是 writer，它独占哪条 append-only chain？
5. 新模块的 10 字段合同现在是否已经能具体填写，而不是继续停留在 future-maybe prose？
6. promotion 后是否仍保持无循环依赖，并避免在接下来几轮里立刻 rename / move / split？

## Anti-Patterns

- `research-synthesis` 直接写 `records/`
- `scenario-planning` 既生成计划又记录执行
- `trade-risk-guard` 漂成一个“什么都管”的总控模块
- 因为 module promotion、chain 增长或目录对称性，就默认新增一个 peer skill
- 让 skill skeleton 长出新的 schema、writer ownership 或 promotion truth
- 用 skill rename 来掩盖其实是 module boundary 没想清楚的问题
- 在 `README.md`、templates 或 skill references 里新增 required schema / writer ownership 真相
- 在没有第二个独立变更原因前创建 `market-ingest/`、`news-chain/`、`backtest-lab/` 目录
- 在未回答 promotion gate 前，先把 latent contract 落成真实目录
- 用未来可能会需要为理由，把多个 latent chains 预先塞进一个真实目录

## References

- [LangChain Context Engineering](https://docs.langchain.com/oss/javascript/langchain/context-engineering)
- [LangChain Multi-agent](https://docs.langchain.com/oss/javascript/langchain/multi-agent/index)
- [Dagster Assets](https://docs.dagster.io/guides/build/assets)
- [OpenLineage About](https://openlineage.io/docs/)
- [OpenLineage Object Model](https://openlineage.io/docs/spec/object-model)
- [Qlib Recorder](https://qlib.readthedocs.io/en/stable/component/recorder.html)
