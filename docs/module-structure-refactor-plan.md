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
| `common` 名不准 | `execution-contract`、`preflight`、`target-action` 是交易领域契约，不是通用 helper | common 变成隐性业务层 |
| catalog 实现复制 | `data-catalog.ts` 在 `strategy-rd` / `strategy-review` / `artifact-catalog` 三份完全重复 | schema 或 bug 修复容易漏同步 |
| replay 实现复制 | `replay-core.ts` 在 `strategy-rd` / `strategy-review` 两份完全重复 | review 与 research 对同一 replay 语义可能漂移 |
| registry 粒度偏粗 | `toolset.json` 多数 entry 指向 suite，而不是原子行为 | agent 查找工具时仍需知道能力藏在哪 |
| docs 与目标态混杂 | `tool-layout.md` 描述当前结构，但没有明确下一轮目标 topology | 容易把迁移中间态误写成长期制度 |

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
| `atomic module` | 独立 CLI、schema、test、contract；负责一个行为 | 吞多个生命周期阶段 |
| `suite` | 目录归类和少量路由；帮助 agent 发现相关工具 | 承载业务逻辑大总线 |

### 2.2 import 规则

- 跨模块源码 import 只允许指向 `modules/contracts/*`。
- 业务模块之间通过 CLI JSON contract 协作。
- suite 内部可以 import 自己的 atomic module，但不得反向依赖。
- `T` 类 exchange write module 不允许被 research / replay / market scan 直接调用。

## 3. 目标模块表

| 目标模块 | 类型 | 负责 | 当前来源 |
| --- | --- | --- | --- |
| `contracts/runtime-core` | contract | JSON、path、time、script envelope、runtime path guard | `modules/common/src/json.ts`、`paths.ts`、`time.ts` |
| `contracts/execution-contract` | contract | execution contract type、compile / validate pure logic | `modules/common/src/execution-contract.ts` |
| `contracts/preflight-contract` | contract | preflight input/output、target action、guard result type | `modules/common/src/preflight.ts`、`target-action.ts` |
| `contracts/catalog-contract` | contract | catalog record/schema/client shape，不拥有扫描和 GC | duplicated `data-catalog.ts` 的稳定类型层 |
| `contracts/replay-contract` | contract | replay result、trade sample、qualification shell | duplicated `replay-core.ts` 的输出契约层 |
| `flow/event-store` | atomic | `trade.db` schema、plan_event append/read、projection reducer | `trade-flow/src/scripts/lib/plan-events.ts`、`flow-state.ts` |
| `flow/observe` | atomic | runtime load、snapshot adapter、observe body build | `trade-flow` observe domain |
| `flow/execution-orchestrator` | atomic | dry-run、shadow、live-small orchestration、order_fill audit | `trade-flow` execution domain |
| `flow/recovery` | atomic | reduce、reconcile、needs_review、safe local apply | `trade-flow` recovery domain |
| `flow/automation` | atomic | cadence plan、job graph、slow/fast/R&D/review/catalog dispatch plan | `trade-flow` automation-cycle |
| `research/replay-engine` | atomic | replay core、strategy signal、closed-candle parity | `strategy-rd` replay files |
| `research/strategy-families` | atomic | family registry、family modules、candidate compile | `strategy-rd/src/lib/rnd-families` |
| `research/rd-loop` | atomic | batch、loop、campaign、selection、negative control diagnostics | `strategy-rd` R&D files |
| `research/rd-program` | atomic | durable RD memory、planner、supervisor runner | `rd-program-*`、`rd-supervisor-runner.ts` |
| `research/rd-shadow-tracker` | atomic | forward paper setup event chain | `rd-shadow-tracker.ts`、`setup-event-chain.ts` |
| `research/benchmark-calibration` | atomic | benchmark、calibration suite、marketability diagnostics | `strategy-benchmark*`、calibration files |
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
- 新增边界检查设计：跨模块 import 只能指向 `modules/contracts/*`。

验收：

- 文档能回答：一个新能力应该落在哪、能否被 import、写入面是什么。
- registry 能按 intent 找到工具，不要求 agent 记父模块。

### Phase 1：去重最高风险实现

目标：消灭完全重复的大文件。

任务：

- 把三份重复 `data-catalog.ts` 收敛为单 owner。
- 抽出 `contracts/catalog-contract`；业务模块只通过 contract 或 CLI 使用 catalog。
- 把两份重复 `replay-core.ts` 收敛到 `research/replay-engine`。
- 抽出 `contracts/replay-contract`；governance 只读 replay result，不拥有 replay implementation。

验收：

- 仓库内不存在内容 hash 完全相同的 catalog / replay 大实现复制。
- `strategy-rd`、`strategy-review`、`artifact-catalog` check 全通过。
- `scripts/quality-check.sh` 通过。

### Phase 2：拆 `common`

目标：把“通用”改成明确 contract 层。

任务：

- `modules/common/src/json.ts`、`paths.ts`、`time.ts` → `modules/contracts/runtime-core`。
- `execution-contract.ts` → `modules/contracts/execution-contract`。
- `preflight.ts`、`target-action.ts` → `modules/contracts/preflight-contract`。
- 更新所有 import。
- 删除 `modules/common`。

验收：

- 业务源码跨模块 import 只出现 `modules/contracts/*`。
- `common` 不再存在。
- Binance、preflight、trade-flow check 全通过。

### Phase 3：拆 `strategy-rd`

目标：把 research suite 拆成可独立维护的 research atomic modules。

顺序：

1. `research/replay-engine`
2. `research/strategy-families`
3. `research/rd-loop`
4. `research/rd-program`
5. `research/rd-shadow-tracker`
6. `research/benchmark-calibration`

每个子模块必须有：

- `CONTRACT.md`
- `package.json`
- `src/scripts/main.ts`
- `src/schemas/*`
- `bun run check`
- `toolset.json` entry

验收：

- `strategy-rd` 不再是 13 个命令的大总线。
- replay、RD loop、RD memory 可独立运行测试。
- R&D 不 import Binance write，不写 `trade.db`。

### Phase 4：拆 `trade-flow`

目标：把在线链从胖 suite 拆成 flow atomic modules。

顺序：

1. `flow/event-store`
2. `flow/observe`
3. `flow/recovery`
4. `flow/execution-orchestrator`
5. `flow/automation`

迁移后 `trade-flow` 只允许作为 suite alias 或完全删除。

验收：

- event-store 是 `trade.db` 单写 owner。
- observe 不写交易事件。
- execution-orchestrator 是唯一可编排 `T` 工具的 flow 模块。
- recovery 不开新风险、不调用 Binance write。
- automation 只产 job graph，不直接写 research / review / catalog artifact。

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

- 按 `intent=rd-memory` 能直接找到 `research/rd-program`。
- 按 `intent=reconcile` 能直接找到 `flow/recovery`。
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
| P1 | Phase 2 | `common` 名不准会持续污染边界 |
| P2 | Phase 3 | R&D 是当前增长最快的模块，最需要原子化 |
| P3 | Phase 4 | 在线链安全重要，但已比 R&D 更稳定 |
| P4 | Phase 5 + Phase 6 | 命名与 registry 体验优化，放在边界稳定后 |

## 8. 非目标

- 不新增 UI / SaaS / 多账户 / 多交易所。
- 不重写策略规则。
- 不改变 live-small 安全门禁。
- 不把所有 helper 都强行拆成包。
- 不为目录审美牺牲可运行性。
