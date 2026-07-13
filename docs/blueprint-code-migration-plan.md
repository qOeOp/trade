# Blueprint Code Migration Plan

## 0. 定位

本文把 `architecture-overview-v2.mmd` 作为最高约束，把当前仓库代码投影到蓝图上，形成框架壳、约束、数据结构和迁移计划。

目标不是一次性重写系统，而是让代码逐步长成蓝图：

- 每个能力有唯一责任域。
- 跨域只走 protocol fabric / rail envelope / domain inbox-outbox。
- 每个 store 有 owner、写入口和可审计 contract。
- control tower 只调度、验收、收口，不做交易判断。
- 子域 handler 只在授权输入、写入面、idempotency key 和 output contract 内工作。

本文记录三类差异：

| 类型 | 含义 | 处理 |
| --- | --- | --- |
| 蓝图已覆盖，代码未覆盖 | 需要补框架壳、contract 或迁移实现 | 进入 migration backlog |
| 代码已有，蓝图未显式覆盖 | 判断是域内 capability、implementation detail，还是蓝图缺口 | 先归档，再决定是否补图 |
| 二者交集但边界不一致 | 当前能跑，但有飞线、旧 job 编号、owner 混杂或 contract 不稳 | 先加约束，再迁实现 |

## 0.1 漂移审计机制

蓝图不是靠人脑记忆维持。每次结构性实现后，必须从代码反向生成一次实现投影：

- `bun scripts/architecture-drift-audit.ts --write` 生成 `docs/generated/code-architecture-current.mmd` 和 `docs/generated/architecture-drift-report.md`。
- `bun scripts/architecture-drift-audit.ts --check` 进入 quality gate，阻止未登记 package module、失效 manifest path、生成图过期。
- `architecture-drift-report.md` 不把旧债务藏起来：源码跨域 import、job owner / target-domain 不一致、manifest 外 CONTRACT root 都要显式列出。
- 迁移目标不是让报告“没有内容”，而是让报告里的源码飞线逐步退化为 rail / ref / outbox，并让 job owner 全部回到 target domain。

## 1. 蓝图约束摘要

v2 蓝图的长期边界：

| 层 | 蓝图约束 |
| --- | --- |
| control tower | `pre_cycle / pre_job / post_job / post_cycle`；health 和 notify 是 lifecycle processor，不是普通 job |
| jobs | 只保留派发给子域的 `J01...J07`：reconcile、fast、slow、R&D、shadow、catalog、review |
| protocol fabric | `rail envelope header + rail ownership registry + schema registry + domain runtime` |
| domain runtime | `pre_accept -> pre_handle -> handler -> post_handle -> post_commit -> outbox` |
| stores | 一个 logical store、一个 owner、一个写入口；跨域只传 ref |
| crossing | 外部只能连 domain inbox / outbox；不得直接连域内 handler、store、helper |

当前 v2 job 编号：

| Ticket | Job | Target domain | 写入语义 |
| --- | --- | --- | --- |
| `J01` | `account_reconcile_guard` | `live-execution-control` | reconcile / needs_review event draft |
| `J02` | `fast_track_guard` | `live-execution-control` | light observe / order_fill event draft |
| `J03` | `slow_track_market_watch` | `live-decision-planning` | full observe / action_intent / watchlist refs |
| `J04` | `rd_strategy_supervisor` | `research-strategy-development` | research state / artifacts |
| `J05` | `rd_forward_shadow_trackers` | `research-strategy-development` | shadow artifacts |
| `J06` | `catalog_hygiene_scan` | `artifact-knowledge` | catalog metadata |
| `J07` | `closed_flow_review_sweep` | `governance-review-compliance` | review / governance evidence |

`runtime_health_guard`、`ops_notify_dispatch` 保留模块，但身份迁为 control tower hooks/processors。

## 2. 当前代码投影

仓库已经具备按域切分的骨架，迁移重点是把运行时关系和检查脚本升级到蓝图语义。

| Blueprint domain | 当前主要代码 | 对齐度 | 主要偏差 |
| --- | --- | ---: | --- |
| `orchestration-ops` | `trade-flow`、`domain-bus`、`ops-runtime-store`、`runtime-health-guard`、`ops-notify-dispatch` | 高 | `architecture-manifest` / `automation-cycle` / `toolset` 已切到 J01-J07 + lifecycle processors；incident store + lifecycle event 已落地；control tower 已能采纳 owner handler 的原生 result |
| `protocol fabric` | `contracts/protocol-fabric`、`domain-bus`、`ops_runtime_store.domain_message` | 中 | 有 envelope/schema 雏形，但 rail header / rail ownership registry / pub-sub 权限尚未成为强校验 |
| `domain-runtime` | `contracts/domain-runtime` + J02/J04/J05/J06/J07 owner handler | 中高 | schema / validator 已有，J02/J04-J07 已原生产出 result；其余 jobs 仍需下沉到 owner handler |
| `policy-risk` | `runtime-policy-compiler`、`policy-registry` | 中 | policy snapshot 有落点；trading mode authority、override ledger、mode decision ledger 还不完整 |
| `portfolio-execution-state` | `event-store`、`flow-projector` | 高 | store owner 清楚；owner tool surface 已覆盖 append/read/latest fill/chain scan/projection；下一步是把 refs/rail 契约继续硬化 |
| `market-data-products` | `ohlcv-fetch`、`tech-indicators`、`binance-read/*`、`market-data-store`、`liquidation-zones`、`data-quality-gate`、`market-fact-publisher` | 高 | raw/canonical/feature 工具齐；quality gate / fact publisher 已显式化为薄 owner port，后续补真实 pipeline 接线 |
| `exchange-gateway` | `binance-read/account-snapshot`、`binance-write/*`、`exchange-runtime-store`、`exchange-request-router`、`write-pre-adapter-gate`、`post-write-confirmation` | 高 | exchange runtime store 已有；request router / write gate / confirmation 已显式化为薄 owner port，后续接真实 gateway pipeline |
| `live-decision-planning` | `observe-builder`、`observe-runner`、`slow-track-plan`、`decision-input-assembler`、`trade-plan-builder`、`action-intent-publisher` | 高 | assembler / planner / publisher 已显式化为薄 owner port；后续把 slow-track-plan 内部流水线迁入这些边界 |
| `live-execution-control` | `fast-track-guard`、`execution-gate`、`execution-router`、`execution-recorder`、`live-small-runner`、`reconcile-drafts`、`recovery-runner`、`plan-preflight` | 高 | J02 已归执行控制域；router/gate/recorder 已显式 owner tool；剩余重点是把 live-small/execution-flow 的真实路径继续收敛到 refs/envelope |
| `research-strategy-development` | replay/data-split/signal/panel/benchmark/calibration/RD state/supervisor/shadow/candidate freezer/evidence publisher 等模块 | 高 | 能力丰富；candidate freezer / research evidence publisher 已显式化为 refs-only owner port，后续补真实 pipeline 接线 |
| `governance-review-compliance` | `strategy-review`、`governance-ledger`、`closed-flow-review-sweep`、`evidence-intake-gate`、`policy-feedback-compiler` | 高 | closed-flow review 已对齐 J07；evidence intake / policy feedback 已显式化为薄 owner port，后续接 ledger/review pipeline |
| `artifact-knowledge` | `artifact-catalog` | 中高 | J06 已原生返回 domain-runtime result；catalog 仍偏胖，artifact intake、lineage、retention/GC planner、summary publisher 需要继续拆壳 |

## 3. 已发现的硬不一致

### 3.1 Job 编号已切到 v2 宪法

已处理：

- `docs/architecture-manifest.json` 要求 `J01...J07`。
- `scripts/check-architecture-manifest.ts` 不再硬编码 J09，而按 manifest 连续编号校验。
- `toolset.json` 已去掉 health/notify 的 J 编号表达；`closed-flow-review-sweep` 已改 J07。
- `automation-cycle.ts` 输出 7 个 domain job；`runtime_health_guard` 和 `ops_notify_dispatch` 进入 `lifecycle_processors`。
- `runtime-health-guard` / `ops-notify-dispatch` 输出 `processor_id + lifecycle_phase`，不再返回 J ticket。
- `closed-flow-review-sweep` 代码和 CONTRACT 已对齐 J07。

蓝图裁决：

- health 是 `pre_cycle / pre_job` guard。
- notify 是 `post_job / post_cycle` processor。
- closed flow review 是 `J07`。

迁移动作：

1. 已完成 `architecture-manifest.json` 到 `J01...J07`。
2. 已完成 `check-architecture-manifest.ts` manifest-based expected jobs。
3. 已完成 `automation-cycle.ts`：7 个 domain job + lifecycle processors。
4. 已完成 `job-graph-runner`：`job_run` 只记录 domain jobs；processor result 单列进入 cycle result。
5. 已完成 `toolset.json` / CONTRACT / PRD 的 v2 同步。

剩余：

- `incident` store、ack/resolve/ignore/reopen 管理命令已落地；control effectiveness review 已接入 post-cycle 复盘。
- J02/J04/J05/J06/J07 已由 owner domain 原生产出 domain job result；J01/J03 仍需下沉到 owner handler。

### 3.2 Domain runtime 正在从契约走向 owner-native jobs

现状：

- `modules/contracts/domain-runtime/CONTRACT.md` 定义了 hook 顺序和 result envelope。
- `J02 fast_track_guard` 已由 `live-execution-control/fast-track-guard` 原生产出 `domain-runtime.domain-job-result.v1`。
- `J04 rd_strategy_supervisor` 已由 `research-strategy-development/rd-supervisor` 原生产出 `domain-runtime.domain-job-result.v1`。
- `J05 rd_forward_shadow_trackers` 已由 `research-strategy-development/rd-shadow-tracker` 原生产出 `domain-runtime.domain-job-result.v1`。
- `J06 catalog_hygiene_scan` 已由 `artifact-knowledge/artifact-catalog` 原生产出 `domain-runtime.domain-job-result.v1`。
- `J07 closed_flow_review_sweep` 已由 `governance-review-compliance/closed-flow-review-sweep` 原生产出 `domain-runtime.domain-job-result.v1`。
- 其余域 job 仍有一部分由 `job-graph-runner` 生成临时 result。

蓝图裁决：

- domain runtime 只承载横切约束，不做业务。
- 每个 domain job 必须声明 inbox contract、handler capability、owner store、write surface、outbox contract、failure classes、idempotency key。

迁移动作：

1. 已在 `contracts/domain-runtime/src` 补纯函数和 schema：`domain-job-result.schema.json`、`hook-context.schema.json`。
2. 已完成 J02/J04/J05/J06/J07 owner-native result：owner handler 自己声明逻辑写入面与 output refs。
3. `job-graph-runner` 执行后优先采纳子域 stdout 中的原生 `runtime_result`。
4. 后续按 J01/J03 顺序，把 result 生成从 runner 下沉到 owner handler。

### 3.3 Protocol fabric 尚未强制 rail ownership

现状：

- `contracts/protocol-fabric` 有多类 envelope schema。
- `domain-bus` 能写 `ops_runtime_store.domain_message`。
- `toolset.json` 仍以 `writes.trade_db/catalog/artifacts/binance/config` 表达写入面，不能表达 logical store / rail / publisher-consumer。

蓝图裁决：

- 每条 rail 必须声明 allowed publishers、consumers、schemas、retention、replay。
- 跨域只传 `payload_ref` / summary，不传大对象。

迁移动作：

1. 增加 `rail-ownership-registry.schema.json` 和静态 registry。
2. toolset 扩展 `publishes`、`consumes`、`writes.logical_stores`。
3. `domain-bus.publish` 校验 source_domain、target_domain、rail、schema_id 是否被 registry 允许。
4. `check-ts-tool-boundaries.ts` 从 import 白名单逐步转为“跨域源码 import 禁止；contracts / same-domain internal-engine / orchestrator adapters 例外”。

### 3.4 Store owner 已清楚，源码飞线已清零

当前状态：

- `architecture-drift-audit` 显示生产源码跨域 import 为 0。
- `closed-flow-review-sweep` 通过状态域 owner tools 读 chain / projection。
- `execution-flow-runner`、`live-small-runner`、`recovery-runner` 通过状态域 owner tools append/read。
- `strategy-review` 通过 replay-runner owner fingerprint surface 消费 replay provenance。
- 测试可以保留少量行为锚点 import，但不得复制到生产路径。

蓝图裁决：

- 跨域实现只允许连 inbox/outbox 和 refs；不得从外部直接连域内 store/helper。
- 防回归由 `architecture-drift-audit` 与 `check-ts-tool-boundaries.ts` 共同执行。

迁移动作：

1. 保持生产源码跨域 import 为 0，任何回归必须被 drift audit 阻断。
2. `portfolio-execution-state` owner surface 已覆盖 append/read/projection；flow projector 已输出 read model refs。
3. execution/recovery 当前通过 event-store owner append/read；event append 已走显式 `event write envelope`。
4. governance/review 当前通过 owner surface 消费状态/回放指纹；replay fingerprint 和 flow read refs 已有稳定 contract。
5. `check-ts-tool-boundaries.ts` 生产白名单只保留同域 control tower 编排所需依赖，跨域测试锚点单独登记。

## 4. 蓝图覆盖但代码缺壳

| Blueprint node | 当前覆盖 | 缺口 | 迁移建议 |
| --- | --- | --- | --- |
| control tower `lifecycle hooks + processors` | `automation-cycle` + `contracts/runtime-core/src/lifecycle.ts` | lifecycle processor spec/record 已上提 runtime-core；真实执行仍由 control tower job graph 驱动 | 后续只补更多 processor 类型，不再另造第二套 runtime |
| `incident manager` / `incident store` | `ops-runtime-store` + `job-graph-runner` + `control-effectiveness-review` | 已有 incident / incident_event table；job/processor/domain bus 失败可落 incident；ack/resolve/ignore/reopen 生命周期已补 | 后续接 override source classifier |
| `control effectiveness review` | `orchestration-ops/control-effectiveness-review` | 已读 incident/job/notify 并写 `control_review`；override review 仍待补 | 后续接入 override ledger 和更细 owner routing |
| rail ownership registry | `contracts/protocol-fabric` | 已有可执行 registry/check；domain bus publish 已绑定 rail route 校验 | 后续扩展 rail 时必须同步 schema/test |
| domain runtime result | `contracts/domain-runtime` + J02/J04/J05/J06/J07 原生 job | J02/J04-J07 已由 owner domain 自己产出 result；其余 J01/J03 仍待原生化 | 逐个域把 result 生成下沉到 owner handler |
| policy `trading mode authority` | runtime-policy-compiler 部分覆盖 | mode decision ledger / override ledger 不足 | 补 `policy-risk/trading-mode-authority`，写 `policy_registry` 或单独 mode table |
| market `data quality gate` | `market-data-products/data-quality-gate` 薄壳 | 已有统一 freshness/checksum manifest gate；待接入真实 market pipeline | 后续由 market router / producer 调用，不下沉交易判断 |
| market fact publisher | `market-data-products/market-fact-publisher` 薄壳 | 已有统一 manifest/ref publisher；待接入 protocol fabric outbox | 只产 refs，durable store 仍归 `market-data.store` |
| exchange request router | `exchange-gateway/exchange-request-router` 薄壳 | 已有 read/write route contract；待接入真实 gateway pipeline | 只路由，不调用 Binance、不做风险判断 |
| exchange write pre-adapter gate | `exchange-gateway/write-pre-adapter-gate` 薄壳 | 已有 authorized mode / idempotency / intent ref gate；待接 write adapters | 不替代 policy-risk 或 execution preflight |
| exchange post-write confirmation | `exchange-gateway/post-write-confirmation` 薄壳 | 已有 exchange-command-ref confirmation contract；待接真实 reread/confirmation | 输出 exchange result refs，不写 trade event |
| decision `trade plan builder` | `decision-input-assembler` / `trade-plan-builder` / `action-intent-publisher` 薄壳 | 已显式拆出 planner/publisher；待接入 slow-track-plan 真实逻辑 | action intent 统一输出 `action-intent-ref`，执行域只消费 intent ref |
| research `candidate freezer` | `research-strategy-development/candidate-freezer` 薄壳 | 已有冻结输出 contract；待接入 signal/panel/holdout 结果 | 输出 `frozen-candidate-ref`，由 governance promotion 消费 |
| research evidence publisher | `research-strategy-development/research-evidence-publisher` 薄壳 | 已有统一 research outbox ref；待接入 artifact/catalog pipeline | 输出 `research-evidence-ref`，不直接 promotion |
| governance evidence intake gate | `governance-review-compliance/evidence-intake-gate` 薄壳 | 已有独立 gate；待接入 strategy-review / closed-flow-review-sweep | 输出 accepted / needs_evidence governance ref |
| policy feedback compiler | `governance-review-compliance/policy-feedback-compiler` 薄壳 | 已有 policy feedback ref；待接入 review findings | 输出 governance refs 给 policy-risk，不直接改 policy |
| artifact lineage indexer | artifact_ref / extraction 部分覆盖 | 不是独立边界 | 从 artifact-catalog 抽 lineage API |
| catalog summary publisher | catalog query | 无 outbox publisher | 补 catalog summary envelope |

## 5. 代码已有但蓝图未显式展开

这些不是错误，先归入蓝图域内 capability，暂不新增顶级域。

| Code capability | 归属 | 裁决 |
| --- | --- | --- |
| `benchmark-engine` / `benchmark-runner` | `research-strategy-development / experiment runners` | 域内 internal-engine + atomic runner |
| `calibration-suite` | `research-strategy-development / experiment design + signal evaluation` | 域内诊断，不进入 governance promotion |
| `funding-governance` | `research-strategy-development / experiment design gate` | 数据覆盖治理，不是 policy-risk |
| `forward-holdout` | `research-strategy-development / shadow-forward evidence` | 归 shadow/evidence 输入，不直接 promotion |
| `strategy-family-engine` / `signal-engine` | `research-strategy-development / internal-engine` | 只给 R&D/signal evaluator 用 |
| `liquidation-zones` | `market-data-products / feature engine` | feature ref，不是交易信号 |
| `domain-bus` | `protocol fabric` 的当前物理化入口 | 可保留，但必须由 rail ownership registry 约束 |
| `trade-flow.runtime` | control tower facade | 只保留编排 / handoff / owner tool resolver，不承接业务域逻辑 |

## 6. 目标框架壳

### 6.1 目录壳

优先补壳，不急着搬业务：

```text
modules/contracts/domain-runtime/src/
  hook-context.ts
  domain-job-result.ts
  schemas/domain-job-result.schema.json
  schemas/hook-context.schema.json

modules/contracts/protocol-fabric/src/
  rail-ownership.ts
  schemas/rail-envelope-header.schema.json
  schemas/rail-ownership-registry.schema.json

modules/orchestration-ops/control-tower-runtime/
  CONTRACT.md
  src/lib/control-tower-runtime.ts

modules/orchestration-ops/incident-store/
  CONTRACT.md
  src/lib/incident-store.ts

modules/policy-risk/trading-mode-authority/
  CONTRACT.md
  src/lib/trading-mode-authority.ts

modules/market-data-products/data-quality-gate/
modules/market-data-products/market-fact-publisher/
modules/live-decision-planning/decision-input-assembler/
modules/live-decision-planning/trade-plan-builder/
modules/live-decision-planning/action-intent-publisher/
modules/research-strategy-development/candidate-freezer/
modules/research-strategy-development/research-evidence-publisher/
modules/governance-review-compliance/evidence-intake-gate/
modules/governance-review-compliance/policy-feedback-compiler/
modules/artifact-knowledge/lineage-indexer/
modules/artifact-knowledge/catalog-summary-publisher/
```

这些壳的第一版可以只做 schema validation / pass-through / envelope wrapping，不迁业务逻辑。

### 6.2 数据结构壳

优先新增/调整这些 schema：

| Schema | Owner | 用途 |
| --- | --- | --- |
| `rail-envelope-header.schema.json` | protocol-fabric | 所有 rail 消息头 |
| `rail-ownership-registry.schema.json` | protocol-fabric | allowed publishers/consumers |
| `domain-job-result.schema.json` | domain-runtime | 所有 handler 返回壳 |
| `hook-context.schema.json` | domain-runtime | hook 上下文 |
| `incident.schema.json` | orchestration-ops | incident classify/ack/resolve |
| `trading-mode-decision.schema.json` | policy-risk | mode state / reason / expiry |
| `market-fact-ref.schema.json` | market-data-products | fresh facts / freshness metadata |
| `action-intent-ref.schema.json` | live-decision-planning | intent / no_action / expiry |
| `frozen-candidate-ref.schema.json` | research-strategy-development | gated draft / assumptions / limits |
| `research-evidence-ref.schema.json` | research-strategy-development | research / validation / shadow / lesson evidence refs |
| `promotion-decision-ref.schema.json` | governance-review-compliance | governance -> policy |
| `catalog-summary-ref.schema.json` | artifact-knowledge | catalog summary / stale candidates |

### 6.3 Store 迁移壳

| Store | 当前 | 迁移 |
| --- | --- | --- |
| `ops_runtime_store` | 有 `cycle_run/job_run/runtime_health/notify/domain_message/lock/incident/incident_event/control_review` | job_run 已改 J01-J07；incident 生命周期与 control review 已补；domain_message 已绑定 rail registry |
| `policy_registry` | snapshot + approved refs | 增 mode decision / override ledger，或拆 `mode_decision_store` |
| `trade_event_store` | append-only plan_event | 保持；新增 event write envelope adapter，外域不直接 append |
| `market_data_store` | manifest/candle/funding/feature manifest | 补 freshness / quality verdict 字段或 side table |
| `exchange_runtime_store` | command/result/snapshot | 补 confirmation status / reread refs / authorized mode refs |
| `research_state_store` | program/hypothesis/trial/holdout/lesson | 保持；candidate freezer 输出 ref，不写 live policy |
| `governance_ledger` | evidence/promotion/review/batch | 补 evidence intake verdict / policy feedback refs |
| `artifact_catalog` | artifact/dataset/ref/R&D/evidence/panel/report | 抽 lineage / summary publisher API，GC 只产候选 |

## 7. 分阶段迁移计划

### P0：蓝图对齐，不改业务行为（已完成）

1. 更新 `architecture-manifest.json` 到 v2：J01-J07，health/notify 移出 jobs。
2. 更新 `check-architecture-manifest.ts`：expected jobs 从 manifest/blueprint 读，不硬编码 J09。
3. 更新 `toolset.json`：health/notify purpose 去 J 编号；closed-flow review 改 J07。
4. 更新相关 CONTRACT：runtime-health、ops-notify、closed-flow-review-sweep。
5. `docs/prd.md` 已同步到 v2，产品文档不再宣称旧编号。

验收：

- `git diff --check`
- `bun scripts/toolset.ts --validate`
- `bun scripts/check-architecture-manifest.ts`
- `bun scripts/architecture-drift-audit.ts --check`

### P1：补 protocol/runtime 壳（runtime 壳第一版已完成）

1. 已补 protocol-fabric rail header / ownership registry schema。
2. 已补 domain-runtime result envelope / hook context schema。
3. 已完成 J06 owner-native result；不做兼容 adapter。
4. 已让 `job-graph-runner` 优先采纳 owner handler 返回的 domain job result envelope。
5. 已让 `domain-bus` publish 前校验 rail ownership。

验收：

- protocol-fabric check
- domain-runtime schema tests
- trade-flow job graph targeted tests

### P2：迁 control tower lifecycle

1. 已从 `automation-cycle.ts` 中拆出 `pre_cycle / post_cycle`。
2. 已让 `runtime-health-guard` 作为 pre processor 执行，不生成 job ticket。
3. 已让 `ops-notify-dispatch` 作为 post processor 执行，不生成 job ticket。
4. 已补 `incident` store + lifecycle event；job failure、processor failure、rail rejection 已写 incident refs，ack/resolve/ignore/reopen 已可操作。
5. 已补 `control effectiveness review` 初版：只读 incident/job/notify，写 `control_review` 改进项与 next-cycle constraints。

验收：

- automation-cycle plan schema 更新
- ops-runtime-store tests
- job graph runner tests

### P3：收束 store 飞线

1. execution/recovery 已从直接 append/read 改为 event-store owner surface；后续继续演进为 event write envelope。
2. decision/governance 已从直接 projector import 改为 owner surface；后续继续演进为 flow read model refs。
3. market/research/governance/artifact 统一通过 artifact/data lineage refs 传材料。
4. `check-ts-tool-boundaries.ts` 删除对应白名单。

验收：

- event-store / flow-projector check
- execution / recovery check
- governance review check
- boundary check 不再需要旧白名单

### P4：拆域内 capability 壳

按风险从低到高：

1. artifact：lineage-indexer / catalog-summary-publisher。
2. market：data-quality-gate / market-fact-publisher。
3. decision：decision-input-assembler / action-intent-publisher。
4. governance：evidence-intake-gate / policy-feedback-compiler。
5. research：candidate-freezer / research-evidence-publisher。
6. exchange：request-router / post-write-confirmation。
7. policy：trading-mode-authority / mode decision ledger。

验收：

- 每个新壳有 CONTRACT、schema、check。
- 原 owner 模块保持行为不变，新增壳先只包输出。

### P5：强化机器约束

1. toolset 增加 `publishes/consumes/logical_stores/rails`。
2. architecture manifest 增加 expected rails ownership。
3. boundary checker 改为根据 manifest/toolset/rail registry 自动判断。
4. 禁止新增跨域源码 import，除非在迁移 debt 中显式登记并有到期目标。
5. quality-check 纳入 v2 blueprint consistency。

验收：

- `scripts/quality-check.sh`
- 无新增未登记飞线。

## 8. 当前飞线清单

当前生产源码飞线已由 drift audit 收敛为 0；以下不再是源码 import debt，而是后续 rail / resolver 化的结构优化项。

| 飞线 | 当前原因 | 目标 |
| --- | --- | --- |
| `trade-flow -> live-execution-control/*` | suite facade 调 owner tool | control tower 只发 job ticket，handler 通过 domain runtime |
| `trade-flow -> portfolio event-store` | runtime append/read facade 已转 owner client | 迁到 fact rail / event-store inbox |
| `slow-track-plan -> runtime-policy / flow facts` | 计划需要 policy + flow facts，生产路径已转 owner client | decision input assembler 消费 refs |
| `fast-track-guard -> execution-gate / flow facts` | J02 已归 execution control，生产路径已转 owner client | 后续改为 flow read model refs / fact rail |
| `recovery-runner -> observe-runner` | 需要 account snapshot tool runner | 改为 exchange rail read request/result refs |
| `execution-flow/live-small -> event-store` | 生产路径已通过状态域 owner surface | 改 event draft -> fact rail |
| `closed-flow-review-sweep -> event-store/flow-projector` | 生产路径已通过状态域 owner surface | 改 flow read model refs |
| `strategy-review -> replay fingerprint` | 已改为 replay-runner owner fingerprint surface | 抽 replay provenance contract |
| `artifact-catalog` 内部混合 intake/index/lineage/GC/publish | 一个模块承担多 capability；J06 result 已原生化 | 拆壳但保持 artifact_catalog owner |

## 9. 蓝图缺口回写

当前 v2 蓝图整体足够作为约束，但后续可考虑补两类说明，不急于改图：

| 缺口 | 是否改图 | 建议 |
| --- | --- | --- |
| `domain-bus` 当前物理化在 ops_runtime_store | 暂不改图 | 文档说明它是 protocol fabric 的当前 adapter |
| `benchmark/calibration/funding-governance` 没在图上逐个列 | 不改图 | 归 research experiment runners / design gate |
| `forward-holdout` 没单列 | 不改图 | 归 shadow tracking / research evidence publisher |
| `position-protect/adjust/cancel` 没单列 | 不改图 | 归 exchange write adapter capability |
| `legacy executor` 术语仍在后半文档 | 不改图 | 实施阶段逐步改为 execution control 链 |
| `incident store` 图上有，store + lifecycle event 已落地 | 不改图 | 已接 control effectiveness review；后续补 override review |

## 10. 第一批推荐工单

按收益和风险排序：

1. **manifest-v2-sync**：已完成。
2. **automation-cycle-lifecycle**：已完成第一版，health/notify 已从 job list 移到 lifecycle sections。
3. **domain-runtime-native-jobs**：J02/J04-J07 已原生化；继续把 J01/J03 的 result 生成下沉到各 owner handler，不做兼容 adapter。
4. **rail-ownership-registry**：已完成 registry schema 和 publish 校验。
5. **incident-store-shell**：已补 incident / incident_event table/schema；job failure、processor failure、rail rejection 已落账，ack/resolve/ignore/reopen 已可操作。
6. **control-effectiveness-review**：已补 `orchestration-ops/control-effectiveness-review` 和 `control_review` 表；初版覆盖 active critical incident、stale ack、repeated incident、repeated job failure、notify failure。
7. **event-write-envelope-native-flow**：execution/recovery/review 先产 event draft envelope，再由 event-store owner append。
8. **boundary-check-v2**：把白名单 import 变成 migration debt 清单，禁止新增飞线。
9. **architecture-drift-audit**：已补实现投影图和漂移报告；后续每个迁移切片必须更新生成图并通过 `--check`。
