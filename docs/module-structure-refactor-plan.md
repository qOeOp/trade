# Module Structure Refactor Plan

## 0. 定位

本计划只解决源码组织和模块边界，不扩大产品范围。

项目形态是 agent-operated toolset：agent 通过 registry 找工具，通过 CLI + JSON contract 调用工具；仓库不是单入口 daemon，也不是传统单体应用。

目标不是“目录更好看”，而是让每个可用能力都满足：

- 行为独立：能被 agent 按 intent 找到。
- 职责单一：输入、输出、写入面清楚。
- 自包含：有本地 contract、schema、测试和检查入口。
- 可替换：跨域只依赖稳定 contract，不直接 import 业务实现。
- 可治理：运行产物、catalog、evidence、trade event 各有 owner。

## 1. 当前诊断

已完成的正确方向：

- R&D / review / artifact 已从 `trade-flow` 迁出。
- Binance 写工具基本保持原子化：place / cancel / protect / adjust 分离。
- `toolset.json` 已成为 agent-facing registry，适合工具集形态。
- 大多数模块已有 `CONTRACT.md`、本地测试和 `check` 脚本。

仍不满意的核心问题：

| 问题 | 证据 | 风险 |
| --- | --- | --- |
| `strategy-rd` 过胖 | 同时拥有 replay、R&D loop、campaign、panel、benchmark、calibration、data split、RD memory、shadow tracker、strategy contract | 研发循环、回放内核、状态机难以独立演进 |
| `trade-flow` 仍是流程 suite | automation、runtime event store、observe、execution orchestration、recovery 仍在一个 package | 在线链变化容易互相影响 |
| legacy contract layer 名不准 | `execution-contract`、`preflight`、`target-action` 是交易领域契约，不是通用 helper | 容易变成隐性业务层 |
| catalog 实现复制 | `data-catalog.ts` 在 `strategy-rd` / `strategy-review` / `artifact-catalog` 三份完全重复 | schema 或 bug 修复容易漏同步 |
| replay 实现复制 | `replay-core.ts` 在 `strategy-rd` / `strategy-review` 两份完全重复 | review 与 research 对同一 replay 语义可能漂移 |
| registry 粒度偏粗 | `toolset.json` 多数 entry 指向 suite，而不是原子行为 | agent 查找工具时仍需知道能力藏在哪 |
| docs 与目标态混杂 | `tool-layout.md` 描述当前结构，但没有明确下一轮目标 topology | 容易把迁移中间态误写成长期制度 |

### 1.1 原子性标尺

本项目的原子模块标尺以 Binance 写工具为准：`order-place`、`order-cancel`、`position-protect`、`position-adjust` 都是单一动作、单一写入面、单一 contract、单独测试入口。

一个模块只有同时满足以下条件，才算 atomic module：

| 维度 | 原子标准 | 反例 |
| --- | --- | --- |
| 行为 | 一个主动词 + 一个对象，例如 place order / cancel order / protect position | 一个入口靠 10+ 个互斥 flag 分派 |
| 写入面 | 至多一个 primary write surface，例如 Binance / artifact / catalog / strategy markdown / trade.db | 同时写 artifact、catalog、state、strategy 文档 |
| 输入契约 | 一个稳定 input schema 或一组同形 payload | 同一 CLI flag 集合混合 replay、campaign、state、lint |
| 输出契约 | 一个稳定 output schema shell | 不同子命令返回互不相干对象 |
| 测试入口 | 独立 `check` 能覆盖该行为 | 只能跑父 suite 的全量测试才知道是否坏 |
| agent 发现 | `toolset.json` 可按 intent 直接命中 | agent 必须知道能力藏在 `strategy-rd` 的某个 flag |
| 依赖方向 | 只依赖 contracts 或同模块内部 helper | 横向 import 其他业务模块实现 |

判定规则：

- `main.ts` 出现多个互斥业务 flag，不自动算错；但它代表 suite router，不代表 atomic module。
- atomic module 可以有内部 helper，但 helper 不应成为另一个业务行为的隐式 owner。
- 如果一个能力会被 agent 单独请求、单独失败、单独修复、单独回归测试，它就应该是 atomic module。

### 1.2 RD 当前拆解诊断

原 `strategy-rd` 已不再是 agent-facing 总入口，也不再承载生产 helper。Forward holdout、RD loop、RD campaign、candidate batch、RD program state、RD supervisor、RD shadow tracker、单策略 replay、latest signal、panel、data split、benchmark、calibration、funding governance、strategy contract compile/lint、artifact summary 已拆为独立 atomic / contract / engine module；跨模块回归集中到 `research/rd-integration-suite`。

| 当前 flag | 真实行为 | 目标 atomic module | primary write |
| --- | --- | --- | --- |
| `research.replay-runner` | 对单个 strategy / candidate 回放 | `research/replay-runner` | none / report |
| `research.signal-evaluator` | 最新闭合 K 线信号评估 | `research/signal-evaluator` | none |
| `research.strategy-contract-compile` | strategy markdown contract 编译 | `research/strategy-contract-compile` | none |
| `research.strategy-contract-lint` | strategy lifecycle contract lint | `research/strategy-contract-lint` | none |
| `research.data-split` | discovery / validation / holdout manifest 切分 | `research/data-split` | artifact + catalog |
| `research.candidate-batch` | bounded candidate 批量评估 | `research/candidate-batch` | report |
| `research.rd-loop-runner` | 一轮 R&D，写 artifact / ledger / optional RD state | `research/rd-loop-runner` | artifact + catalog + optional state |
| `research.rd-campaign-runner` | hypothesis queue / validation campaign | `research/rd-campaign-runner` | artifact + catalog + optional state |
| `research.panel-evaluator` | 多资产 panel / cross-candidate negative control | `research/panel-evaluator` | report |
| `research.rd-program-state` | durable RD memory init/read/update/plan_next | `research/rd-program-state` | RD state + catalog |
| `research.rd-supervisor` | plan_next -> execute -> writeback loop | `research/rd-supervisor` | RD state + artifacts |
| `research.rd-shadow-tracker` | forward signal 纸面 setup event chain | `research/rd-shadow-tracker` | artifact |
| `research.benchmark-runner` | 固定 benchmark 仿真 | `research/benchmark-runner` | report |
| `research.calibration-suite` | calibration suite / pipeline diagnosis | `research/calibration-suite` | report |
| `research.funding-governance` | funding coverage governance check | `research/funding-governance` | report |

拆分后的旧 `strategy-rd` 目录已删除；跨模块回归只保留在 `research/rd-integration-suite`，不作为 agent-facing 单一工具。

### 1.3 trade-flow 当前设计审计

`trade-flow` 的方向是对的：它已经把 R&D / review / artifact owner 迁出，并且 automation plan 能输出 job graph。但它现在仍不够像“清爽 orchestrator”，原因是它还直接拥有多类原子能力实现。

| 当前文件 / 能力 | 真实行为 | 问题 | 目标 |
| --- | --- | --- | --- |
| `automation-cycle.ts` | 生成 cadence / job graph，并硬编码 downstream command path | 有编排意图，但仍需继续减少裸路径依赖 | `flow/automation-plan` 只输出 tool id + payload + write scope |
| `slow-track-workflow.ts` | 调 account snapshot、market scan、symbol snapshot、OHLCV、tech indicators，并产出 watchlist artifact | slow track 变成小型流程引擎；data / analytics 调用硬编码在 trade-flow | 拆为 `flow/slow-track-plan`，只编排 read / data / analytics atomic tools |
| `fast-track-workflow.ts` | active flow 快轨检查、轻量 snapshot、trigger guard | 与 observe / recovery / execution gate 混合 | 拆为 `flow/fast-track-plan`，只编排 active-flow projection + observe + gate |
| `execution-flow.ts` | preflight、trigger、idempotency、contract compile、mock execution、record events、execution command spec | 执行链核心逻辑过多，不是单一原子能力 | 拆为 gate / route / record 三个 atomic modules |
| `live-execution.ts` | 调 exchange write tool 并记录本地事件 | 编排和记录合理，但必须只消费 execution command spec | `flow/live-small-runner` 只允许执行 spec，不重新判断策略 |
| `reconcile.ts` | 本地事件与 account snapshot 对账算法 | 是原子能力，但藏在 recovery suite 内 | `flow/reconcile-drafts` 独立 |
| `recovery-flow.ts` | 调 account snapshot、构建 reconcile、写 needs_review / apply drafts | 组合了 read / reconcile / write 三段 | 拆为 `flow/recovery-runner` 编排 |
| `runtime-policy.ts` | trading config normalize / clamp / hash | 不是 flow orchestration，而是 config contract/compiler | `contracts/runtime-policy` 或 `flow/runtime-policy-compiler` |
| `plan-events.ts` / `flow-state.ts` | `trade.db` event store 与 projection | 这是强 owner，应该独立且单写 | `flow/event-store` + `flow/flow-projector` |

结论：

- `trade-flow` 不应该消失，但它应该降级为 `flow` suite / orchestrator。
- 它可以决定“调用哪个原子能力、按什么顺序、以什么 write scope”，但不应继续内联实现 market scan workflow、reconcile algorithm、execution gate、runtime policy compiler。
- `trade-flow` 调原子模块时必须是 1:1 contract：一个 job 调一个 tool id，一个 tool id 对一个 owner，一个 owner 对一个 primary write surface。

### 1.4 1:1 编排约束

目标编排模型：

```text
automation-plan
  -> job(tool_id, payload_ref, capability_class, write_scope, concurrency_group)
  -> atomic tool validates input schema
  -> atomic tool returns output schema
  -> orchestrator may persist only its own event/ref
```

约束：

| 约束 | 含义 |
| --- | --- |
| `job.tool_id` 必须来自 `toolset.json` | 不在源码里硬编码 `modules/.../src/scripts/main.ts` |
| 一个 job 只调用一个 atomic tool | 复杂流程必须拆成多个 job |
| job 必须声明 `capability_class` / `writes` / `concurrency_group` | 调度前先知道写入面 |
| orchestrator 不得解释子工具业务结果 | 只检查 schema、status、refs、blocked reason |
| `T` 类 job 必须由 execution orchestrator 串 preflight + contract + explicit authorization | automation plan 不能直接产生 live write |
| `V` 类 job 只能通过 event-store 写 `trade.db` | 其他模块不得自己写 event DB |
| `A/E` 类 job 只能写 artifact / catalog / evidence owner | 不得顺手写 trade event |
| 子工具失败不得自动升级权限 | `R/A/E/V` 失败不能触发 `T` 补救 |

需要新增的 registry / schema 能力：

| 能力 | 说明 |
| --- | --- |
| `tool_id` | 稳定工具 id，不等于目录路径 |
| `entry_schema` / `output_schema` | 编排器只认 schema，不读实现 |
| `writes` | `trade_db / catalog / artifacts / evidence / binance / config` |
| `concurrency_group` | `trade-db / binance-write / artifact-catalog / rd-state:<id>` |
| `requires` | 前置 tool result，如 preflight verdict、execution contract、runtime policy |
| `forbidden_callers` | 如 exchange write 禁止 research / market scan 直接调用 |

## 2. 目标拓扑

目标目录采用 **suite / atomic module / contract module** 三层。

```text
modules/
  contracts/        # 跨模块源码 import 的唯一合法层：类型、schema、pure helpers
  exchange/         # 交易所原子工具：Binance read/write
  data/             # 市场数据采集与数据集构造
  analytics/        # 指标、结构、微观结构分析
  research/         # replay、families、R&D loop、RD memory、benchmark
  governance/       # strategy evidence、review、promotion
  flow/             # event-store、observe、execution orchestrator、recovery、automation
  ops/              # artifact catalog、GC、data hygiene、quality helpers
```

### 2.1 模块类型

| 类型 | 允许 | 禁止 |
| --- | --- | --- |
| `contract module` | 被业务源码 import；只放 type/schema/pure helper | 读写文件、调用外部 API、拥有业务流程 |
| `internal engine` | 同 domain 原子工具共享纯计算、公式、registry、parser | agent-facing CLI、状态写入、跨 domain 编排 |
| `atomic module` | 独立 CLI、schema、test、contract；负责一个行为 | 吞多个生命周期阶段 |
| `suite` | 目录归类和少量路由；帮助 agent 发现相关工具 | 承载业务逻辑大总线 |

### 2.2 import 规则

- 跨模块源码 import 只允许指向 `modules/contracts/*` 或同 domain 无 package internal engine。
- 业务模块之间通过 CLI JSON contract 协作。
- suite 内部可以 import 同 domain internal engine；调用 atomic module 应优先走 CLI / contract，确需源码复用时必须先抽 internal engine。
- `T` 类 exchange write module 不允许被 research / replay / market scan 直接调用。

## 3. 目标模块表

| 目标模块 | 类型 | 负责 | 当前来源 |
| --- | --- | --- | --- |
| `contracts/runtime-core` | contract | JSON、path、time、script envelope、runtime path guard | 已迁入 `modules/contracts/runtime-core` |
| `contracts/execution-contract` | contract | execution contract type、compile / validate pure logic | 已迁入 `modules/contracts/execution-contract` |
| `contracts/preflight-contract` | contract | preflight input/output、target action、guard result type | 已迁入 `modules/contracts/preflight-contract` |
| `contracts/catalog-contract` | contract | catalog record/schema/client shape，不拥有扫描和 GC | duplicated `data-catalog.ts` 的稳定类型层 |
| `contracts/replay-contract` | contract | replay result、trade sample、qualification shell | duplicated `replay-core.ts` 的输出契约层 |
| `flow/event-store` | atomic | `trade.db` schema、plan_event append/read；唯一 event write owner | `plan-events.ts` |
| `flow/flow-projector` | atomic | flow state、lane conflicts、active flows projection | `flow-state.ts` |
| `flow/runtime-policy-compiler` | atomic / contract candidate | trading config normalize / clamp / hash / compact snapshot | `runtime-policy.ts` |
| `flow/observe-builder` | atomic | supplied snapshots -> normalized observe event body | `observe-builder.ts` |
| `flow/observe-runner` | atomic | 调 account/symbol read tools，产出 observe event candidate；不写 DB | `observe-flow.ts`、`observe-adapter.ts` |
| `flow/execution-gate` | atomic | preflight result + trigger condition + idempotency gate | `execution-flow.ts` gate 部分 |
| `flow/execution-router` | atomic | target_action -> exchange write command spec | `execution-flow.ts` command spec 部分 |
| `flow/execution-recorder` | atomic | exchange result -> audited local `order_fill` draft | `execution-flow.ts` record 部分 |
| `flow/live-small-runner` | atomic | 执行 approved command spec，并交给 recorder；不重新做策略判断 | `live-execution.ts` |
| `flow/reconcile-drafts` | atomic | local flow + account snapshot -> reconcile drafts / unmatched | `reconcile.ts` |
| `flow/recovery-runner` | atomic | account snapshot read -> reconcile -> optional safe apply / needs_review | `recovery-flow.ts` |
| `flow/slow-track-plan` | atomic | slow cadence read/data/analytics job plan，不内联 market workflow | `slow-track-workflow.ts` |
| `flow/fast-track-plan` | atomic | active flow fast guard job plan，不内联 execution logic | `fast-track-workflow.ts` |
| `flow/automation-plan` | atomic | cadence plan、job graph、write-scope / concurrency declaration | `automation-cycle.ts` |
| `research/replay-engine` | contract/internal engine | replay core、fill model、closed-candle parity；被 runner 使用，不作为大总线 | old replay files |
| `research/replay-runner` | atomic | 单次 replay 执行与 replay report 输出 | `research.replay-runner` |
| `research/signal-evaluator` | atomic | 最新闭合 K 线信号评估，不执行、不写状态 | `research.signal-evaluator` |
| `research/strategy-contract-compile` | atomic | strategy markdown contract 编译为 candidate / lifecycle contract | migrated |
| `research/strategy-contract-lint` | atomic | strategy lifecycle contract 完整性 lint | migrated |
| `research/strategy-family-engine` | internal engine | family registry、family modules、candidate compile source | old R&D family files |
| `research/forward-holdout` | atomic | frozen candidate forward-only signal check | `research.forward-holdout` |
| `research/data-split` | atomic | discovery / validation / locked holdout manifest 切分 | migrated |
| `research/candidate-batch` | atomic | bounded candidate 批量评估、negative controls、failure summary | migrated |
| `research/rd-loop-runner` | atomic | 单轮 R&D loop、artifact、ledger、optional state writeback | migrated |
| `research/rd-campaign-runner` | atomic | hypothesis campaign、validation budget、zero-trial gates | `research.rd-campaign-runner` |
| `research/rd-ledger` | internal atomic | R&D run ledger、holdout idempotence、redacted loop artifact input | loop/campaign runners |
| `research/panel-evaluator` | atomic | 多资产 panel、cross-candidate negative control、marketability | migrated |
| `research/rd-program-state` | atomic | durable RD memory init/read/update/plan_next | migrated |
| `research/rd-supervisor` | atomic | plan_next -> execute -> writeback loop runner | migrated |
| `research/rd-shadow-tracker` | atomic | forward paper setup event chain | migrated |
| `research/benchmark-runner` | atomic | fixed benchmark simulation and report | migrated |
| `research/calibration-suite` | atomic | calibration suite、pipeline diagnostics、data breadth attribution | migrated |
| `research/funding-governance` | atomic | funding coverage / carry governance read-only check | migrated |
| `governance/evidence-ledger` | atomic | append evidence、fingerprint、catalog evidence refs | `strategy-review` evidence helpers |
| `governance/strategy-review` | atomic | review report、failure attribution、promotion read model | current `strategy-review` minus evidence append |
| `governance/promotion-gate` | atomic | status transition and `--yes` guarded strategy markdown update | current promote path |
| `ops/artifact-catalog` | atomic | catalog DB init/query/scan/stale | current artifact-catalog |
| `ops/artifact-gc` | atomic | filesystem GC、retention、pin/ref guard | current artifact hygiene |
| `data/ohlcv-fetch` | atomic | OHLCV manifest fetch | current `ohlcv-fetch` main |
| `data/market-features` | atomic | funding / market feature / panel construction | `ohlcv-fetch` feature scripts |
| `analytics/tech-indicators` | atomic | indicators、structure、beta、feature series | current tech-indicators |
| `analytics/liquidation-zones` | atomic | liquidation-like refs from supplied input | current binance/liquidation-zones |
| `exchange/binance-read/*` | atomic | account snapshot、symbol snapshot、market scan、aggtrades | current Binance read modules |
| `exchange/binance-write/*` | atomic | place、cancel、protect、adjust | current Binance write modules |

## 4. 迁移原则

- 全迁移，不保留旧入口兼容壳。
- 每次只迁一个 owner 边界，迁完删除旧路径。
- 先迁 contract，再迁实现，再迁 registry，再迁 docs。
- 不把目录搬迁和业务行为修改混在一轮。
- 不把中间态写成长期 memory。
- 每轮结束必须跑对应 module check；跨模块迁移跑 `scripts/quality-check.sh`。

## 5. 分阶段计划

### Phase 0：固化结构契约

目标：让后续迁移有共同地图。

任务：

- 更新 `docs/tool-layout.md`：区分 current layout 与 target topology。
- 更新 `modules/README.md`：定义 suite / atomic / contract module。
- 更新 `toolset.json`：新增 `module_type`、`owner_scope`、`entry_contract` 字段。
- 新增 `job contract` / registry resolver 设计：orchestrator 输出 `tool_id + payload + schema`，不输出裸路径 command。
- 新增边界检查设计：跨模块 import 只能指向 `modules/contracts/*`。

验收：

- 文档能回答：一个新能力应该落在哪、能否被 import、写入面是什么。
- registry 能按 intent 找到工具，不要求 agent 记父模块。

当前落地：

- `toolset.json` 已新增 `module_type`、`owner_scope`、`entry_contract`、`requires_preflight`、`concurrency_group`、`forbidden_callers`。
- `scripts/toolset.ts --validate` 已校验上述字段和可选 schema 路径。
- `schemas/tool-job.schema.json` 已定义编排 job 的稳定 shell。
- `docs/tool-layout.md` 与 `modules/README.md` 已区分 current layout、target topology、suite / atomic / contract module。

尚未完成：

- registry resolver 仍未替换 `trade-flow` 内部裸路径编排。

### Phase 1：去重最高风险实现

目标：消灭完全重复的大文件。

任务：

- 把三份重复 `data-catalog.ts` 收敛为单 owner。
- 抽出 `contracts/catalog-contract`；业务模块只通过 contract 或 CLI 使用 catalog。
- 把两份重复 `replay-core.ts` 收敛到 `research/replay-engine`。
- 抽出 `contracts/replay-contract`；governance 只读 replay result，不拥有 replay implementation。

验收：

- 仓库内不存在内容 hash 完全相同的 catalog / replay 大实现复制。
- `rd-integration-suite`、`strategy-review`、`artifact-catalog` check 全通过。
- `scripts/quality-check.sh` 通过。

当前落地：

- `data-catalog.ts` 的 DB/schema/scan 实现已收敛到 `modules/ops/artifact-catalog/src/lib/data-catalog.ts`。
- `modules/contracts/catalog-contract/src/catalog-client.ts` 提供跨模块 catalog client；research / governance 旧本地路径只保留 re-export 适配。
- artifact-catalog CLI 已新增 direct register / upsert / list 命令，并有 `catalog-cli.test.ts` 覆盖。
- `replay-core.ts` 实现已收敛到 `modules/research/replay-engine/src/lib/replay-core.ts`；research / governance 旧本地路径只保留 re-export 适配。

尚未完成：

- `research/replay-engine` 仍是内部 engine owner，尚未拆出 agent-facing `research/replay-runner`。
- `contracts/replay-contract` 仍未单独拆 type/schema shell；governance 当前通过 re-export 使用 replay engine 类型和测试 helper。

### Phase 2：明确 contract 层

目标：把旧共享层改成明确 contract 层。

任务：

- runtime JSON、paths、time → `modules/contracts/runtime-core`。
- `execution-contract.ts` → `modules/contracts/execution-contract`。
- `preflight.ts`、`target-action.ts` → `modules/contracts/preflight-contract`。
- 更新所有 import。
- 删除旧共享目录。

验收：

- 业务源码跨模块 import 只出现 `modules/contracts/*` 或同 domain 无 package internal engine。
- 旧共享目录不再存在。
- Binance、preflight、trade-flow check 全通过。

当前落地：

- `modules/contracts/runtime-core`、`execution-contract`、`preflight-contract` 已建立并补 `CONTRACT.md`。
- 所有源码 import 已切到 `modules/contracts/*`。
- `scripts/check-ts-tool-boundaries.ts` 已只放行 `modules/contracts/*`。
- 旧共享目录已删除。

### Phase 3：拆旧 R&D 大包

目标：把 research suite 拆成和 Binance write tools 同级别的 research atomic modules。

顺序：

1. `research/replay-engine`：先作为内部 engine / contract owner，消灭 duplicated replay core。
2. `research/replay-runner`：承接单策略 replay。
3. `research/signal-evaluator`：承接 latest signal。
4. `research/strategy-contract-compile` 与 `research/strategy-contract-lint`：承接 compile / lint。
5. `research/data-split`：已承接 discovery / validation / locked holdout manifest 切分。
6. `research/strategy-families`：只拥有 family registry 和 family modules。
7. `research/candidate-batch`：已承接 bounded candidate batch evaluation。
8. `research/rd-loop-runner`：已承接 single R&D loop artifact writeback。
9. `research/rd-campaign-runner`：承接 hypothesis campaign、validation budget、zero-trial gates、campaign artifact writeback。
10. `research/panel-evaluator`：已承接 panel evaluation。
11. `research/rd-program-state`：已承接 RD memory init/read/update/plan_next。
12. `research/rd-supervisor`：已承接 autonomous RD supervisor loop。
13. `research/rd-shadow-tracker`：已承接 forward paper setup event chain tracker。
14. `research/benchmark-runner`：已承接 fixed benchmark。
15. `research/calibration-suite`：已承接 calibration diagnostics。
16. `research/funding-governance`：已承接 funding coverage governance。

每个子模块必须有：

- `CONTRACT.md`
- `package.json`
- `src/scripts/main.ts`
- `src/schemas/*`
- `bun run check`
- `toolset.json` entry

验收：

- 旧 R&D 大包不再是多业务 flag 大总线；agent-facing registry 不再指向单一总工具。
- 每个 RD atomic module 的主入口只有一个业务动作。
- replay、signal、data split、candidate batch、loop、campaign、panel、RD state、supervisor、shadow tracker、benchmark、calibration 都可独立运行测试。
- R&D 不 import Binance write，不写 `trade.db`。
- R&D supervisor 只能调用 research atomic tools 和 catalog / state contract，不能内联实现 batch / campaign / panel 逻辑。

当前落地：

- `research/replay-runner` 已成为 agent-facing atomic module，拥有 `CONTRACT.md`、独立 package、CLI、schema、测试和 `toolset.json` entry。
- 旧 R&D 大包已删除单策略 replay 总线入口，`toolset.json` 的 replay intent 只命中 `research.replay-runner`。
- `strategy-replay` façade 与 registered replay strategy 已迁到 `research/replay-engine`；旧本地 façade 已删除。
- 旧 R&D 大包已删除 strategy contract compile/lint 总线入口，`toolset.json` 的 contract compile/lint intent 分别命中 `research.strategy-contract-compile` 和 `research.strategy-contract-lint`。
- strategy contract 解析、编译、lint 语义已迁到 `modules/contracts/strategy-contract`；research 原子 CLI 只负责参数与 response envelope。
- `research.rd-program-state` 已成为 agent-facing atomic module，承接 durable RD memory init/read/update/plan_next；旧大包不再暴露 RD memory CLI。
- `research.rd-supervisor` 已成为 agent-facing atomic module，承接 plan_next -> loop/campaign -> state writeback；旧大包不再暴露 RD supervisor CLI。
- `research.rd-shadow-tracker` 已成为 agent-facing atomic module，承接 forward paper setup event chain；旧大包不再暴露 `--rd-shadow-tracker`。
- `research.candidate-batch` 已成为 agent-facing atomic module，承接 bounded candidate batch evaluation；旧大包不再暴露 `--strategy-rnd-batch`。
- `research.rd-loop-runner` 已成为 agent-facing atomic module，承接 single R&D loop artifact writeback；旧大包不再暴露 `--strategy-rnd-loop`。
- `research.rd-campaign-runner` 已成为 agent-facing atomic module，承接 bounded R&D campaign orchestration；旧大包不再暴露 campaign CLI。
- `research.rd-ledger` 已成为 internal atomic module，承接 R&D run ledger、holdout idempotence 与 redacted loop artifact input；loop/campaign 不再读取旧本地 ledger helper。
- `research.forward-holdout` 已成为 agent-facing atomic module，承接 frozen candidate forward-only signal check；旧大包不再拥有 forward holdout helper。
- `research.rd-artifact-summary` 已成为 internal atomic module，承接 R&D artifact 摘要；旧大包不再拥有 artifact summary helper。
- `contracts.strategy-policy` 已成为 contract module，承接 strategy markdown frontmatter / policy loader；`trade-flow` 与 `strategy-review` 不再复制 loader。
- `research.rd-integration-suite` 已成为 test module，承接跨 research atoms 回归；旧 `strategy-rd` 目录已删除。

### Phase 4：拆 `trade-flow`

目标：把在线链从胖 suite 拆成 flow atomic modules，并让 orchestrator 只通过 1:1 job contract 调用原子能力。

顺序：

1. `flow/event-store`
2. `flow/flow-projector`
3. `flow/runtime-policy-compiler`
4. `flow/observe-builder`
5. `flow/observe-runner`
6. `flow/execution-gate`
7. `flow/execution-router`
8. `flow/execution-recorder`
9. `flow/live-small-runner`
10. `flow/reconcile-drafts`
11. `flow/recovery-runner`
12. `flow/slow-track-plan`
13. `flow/fast-track-plan`
14. `flow/automation-plan`

迁移后 `trade-flow` 只允许作为 suite alias 或完全删除。

验收：

- event-store 是 `trade.db` 单写 owner。
- projector 只读 `trade.db` 并输出 flow projection。
- observe-builder / observe-runner 不写交易事件。
- execution-gate 不调用 exchange write，不写 DB。
- execution-router 只产 command spec，不执行。
- execution-recorder 只把 approved result 转为 event draft / event-store write request。
- live-small-runner 是唯一可执行 `T` command spec 的 flow 模块。
- reconcile-drafts 不写 DB；recovery-runner 才能通过 event-store 安全 apply。
- slow / fast track plan 只产 job graph；不得硬编码多工具 workflow 实现。
- automation-plan job 中不得出现裸路径 command；必须使用 `tool_id + payload + schema`。
- automation-plan 不直接写 research / review / catalog artifact。

### Phase 5：整理 data / analytics / exchange 命名

目标：目录语义和行为一致。

任务：

- `modules/binance` 拆为 `modules/exchange/binance-read` 与 `modules/exchange/binance-write`。
- `modules/ohlcv-fetch` 迁到 `modules/data/ohlcv-fetch`。
- `ohlcv-fetch` 内部的 market features / calibration panel 升为独立 data atomic module。
- `liquidation-zones` 从 binance 目录迁到 analytics，除非它直接负责 Binance fetch。

验收：

- read / write exchange 工具目录分离。
- data acquisition 与 analytics 不混名。
- registry 中 `writes.binance` 与目录语义一致。

### Phase 6：registry 行为化

目标：agent 不需要知道目录历史，只按行为找工具。

任务：

- `toolset.json` 每个 entry 指向 atomic module。
- 每个工具声明：
  - `module_type`
  - `capability_class`
  - `intent`
  - `writes`
  - `requires_preflight`
  - `entry_schema`
  - `output_schema`
  - `owner_scope`
- 增加 registry 校验脚本：entry path、schema、check script 必须存在。

验收：

- 按 `intent=rd-memory` 能直接找到 `research.rd-program-state`。
- 按 `intent=reconcile-drafts` 能直接找到 `flow/reconcile-drafts`；按 `intent=recovery-runner` 能直接找到 `flow/recovery-runner`。
- 按 `writes.binance=true` 只出现 exchange write 和 execution orchestrator。

## 6. 停机检查清单

每轮迁移结束必须检查：

- 功能是否仍能真实运行。
- 是否新增跨业务 import。
- 是否有旧入口残留。
- 是否有运行产物落进源码目录。
- 是否有 schema drift。
- 是否有 docs 指向旧路径。
- 是否有 registry 指向旧路径。
- 是否有重复实现重新出现。

## 7. 优先级

| 优先级 | 内容 | 原因 |
| --- | --- | --- |
| P0 | Phase 0 + Phase 1 | 先建立地图，再修真实重复实现风险 |
| P1 | Phase 2 | 旧共享层名不准会持续污染边界 |
| P2 | Phase 3 | R&D 是当前增长最快的模块，最需要原子化 |
| P3 | Phase 4 | 在线链安全重要，但已比 R&D 更稳定 |
| P4 | Phase 5 + Phase 6 | 命名与 registry 体验优化，放在边界稳定后 |

## 8. 非目标

- 不新增 UI / SaaS / 多账户 / 多交易所。
- 不重写策略规则。
- 不改变 live-small 安全门禁。
- 不把所有 helper 都强行拆成包。
- 不为目录审美牺牲可运行性。
