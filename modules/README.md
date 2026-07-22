# Modules

`modules/` 是项目源码货架。每个模块内部自带 `src/`、运行入口、测试和本地契约；根目录 [toolset.json](../toolset.json) 是 agent 使用这些模块的注册表。

## Shape

| 层 | 职责 |
| --- | --- |
| `toolset.json` | agent-facing 工具索引：按 intent / capability / writes / module_type 找工具 |
| `modules/<domain>/<module>/` | 模块根：package / go.mod / requirements / reference / 模块说明 |
| `modules/<domain>/<module>/src/` | 模块实现：scripts、schemas、tests、内部 helper |
| `modules/contracts/<contract>/src/` | 新跨模块 contract / client 层；业务模块优先依赖这里或 CLI contract |
| `modules/<domain>/<internal-engine>/src/` | 无 package / 无 agent entry 的领域内计算内核；只承载共享公式、schema-adjacent parser 或纯计算 |

## Module Types

| 类型 | 负责 | 禁止 |
| --- | --- | --- |
| `suite` | 归类、迁移期路由、把一组原子能力暴露给 agent | 继续扩张成业务大总线 |
| `atomic` | 一个主动词 + 一个对象；单一 CLI、单一主写入面、独立 contract / check | 混合多个生命周期阶段或多个 owner |
| `contract` | 可被源码跨模块 import 的 type、schema、pure helper | 读写文件、调用外部 API、拥有流程 |
| `internal-engine` | 同一 domain 下原子工具共享的纯计算实现，如 replay / signal / benchmark / family engine | agent-facing CLI、状态写入、跨 domain 编排 |

`toolset.json` 每个 entry 必须声明 `module_type`、`owner_scope`、`entry_contract`、`requires_preflight`、`concurrency_group` 和 `forbidden_callers`。编排器只应输出 `tool_id + payload + entry_contract`，不输出裸路径命令；裸路径 command 只保留在 registry resolver 层。该 registry 当前只登记 agent-facing `suite` / `atomic`，contract 与 internal engine 由目录和本地 `CONTRACT.md` 管理。

## Module Contracts

| 模块 | 输入 | 输出 | 负责 | 禁止 |
| --- | --- | --- | --- | --- |
| `orchestration-ops/trade-flow` | strategy markdown、trading config、`trade.db`、tool JSON 输出 | CLI response、automation jobs、shadow observe glue | control tower CLI、command routing、automation cycle、owner tool handoff | Binance endpoint 细节、市场数据接入实现、执行流 owner、恢复 owner、R&D 实验实现、策略复核 owner |
| `orchestration-ops/agent-mcp` | `toolset.json` 与显式只读查询参数 | MCP structured result | 本地 stdio MCP 门面、只读白名单、Owner CLI 适配 | 任意命令执行、领域写入、Binance write、远程监听 |
| `portfolio-execution-state/event-store` | `trade.db` handle、plan event payload | validated `plan_event` rows、ordered event reads | `trade.db.plan_event` schema、append/read、event validation | flow projection、交易所调用、策略判断、artifact catalog |
| `portfolio-execution-state/flow-projector` | event-store reads、reconcile drafts | flow state、active flows、lane conflicts、approved reconcile apply result | 可重建 flow projection、风险锁、open action gap、reconcile draft apply | event schema ownership、交易所调用、策略判断 |
| `policy-risk/runtime-policy-compiler` | trading config、legacy account / notify config | normalized config、`runtime-policy.v1`、compact snapshot | trading config normalize / clamp / hash | preflight、execution、review、R&D 决策、`trade.db`、Binance |
| `live-decision-planning/observe-builder` | account / market projection、plan seed、policy snapshot | observe event candidate、account projection summary | supplied snapshots -> normalized observe event body | exchange/tool 调用、`trade.db`、execution、review、R&D |
| `live-decision-planning/observe-runner` | repo root、symbol、optional timeout / runner | account snapshot、market snapshot、market refs | 调 account/symbol read tools 并产出 observe projection | `plan_event`、execution、review、R&D、`trade.db`、Binance 写接口 |
| `live-decision-planning/slow-track-plan` | runtime policy、strategy pool、read-only account/market/data tool refs | watchlist artifact、analysis-only `no_action` decision | slow cadence watchlist and operator planning | `trade.db` 写入、exchange write、R&D、promotion |
| `live-execution-control/fast-track-guard` | active flow projection、read-only account/market facts | fast observe events、fast-track artifact、trigger readiness report、J02 runtime result | active flow fast guard and fast observe planning | exchange write、策略研发 |
| `live-execution-control/execution-gate` | action intent trigger condition、current mark、now | ready/skipped gate result | trigger expiry and mark-range readiness | preflight、contract compile、exchange write、event append |
| `live-execution-control/execution-flow-runner` | DB handle、execution input、dry-run/shadow mode | execution result shell、observe skip event、mock order_fill | dry-run/shadow execution flow、idempotency gate、skip observe construction | live exchange write、strategy thesis、account snapshot reconcile |
| `live-execution-control/execution-router` | target action、repo root、execution contract / request | execution command spec | target_action -> Binance write-tool argv | 命令执行、preflight/idempotency、order event recording、`trade.db` |
| `live-execution-control/execution-recorder` | execution result、target action、contract/request context | `order_fill` plan-event drafts | exchange result -> audited local event draft | `trade.db` append、preflight/idempotency、exchange command routing |
| `live-execution-control/live-small-runner` | DB handle、approved live-small input、explicit yes、runner | live-small result shell、audited order_fill append | 小额实盘执行 gate、command spec 执行、confirmed result 记录 | strategy thesis、exchange API 细节、reconcile |
| `live-execution-control/reconcile-drafts` | projected local flow、account snapshot | reconcile drafts、unmatched facts | local/exchange 对账建议 | account snapshot 调用、apply draft、needs_review 写入 |
| `live-execution-control/recovery-runner` | repo root、flow id、DB handle、runner、apply flag | reconcile result、optional applied drafts / needs_review | account snapshot read -> reconcile -> safe local recovery | strategy thesis、exchange write、R&D |
| `research-strategy-development/research-control-plane/*` | Proposal/Contract/Trial/Result/Review、Draft authorization | 权威 RD facts、ready Draft Strategy binding | RD 单写者、策略物化与跨 Plane 认证 | Replay/Forward 执行、Agent 推理、正式 Shadow/Live |
| `research-strategy-development/replay-execution-plane/*` | Trial-bound request、normalized closed bars、funding events | Result Artifact、ledger、metrics、fingerprint | certified historical evidence execution | Candidate 生成、Review、promotion |
| `research-strategy-development/forward-evidence-plane/*` | ready Draft binding、freeze、watermark、Forward reservation | post-freeze Forward Result | no-backfill 前瞻证据 | 正式 Shadow、账户事实、promotion |
| `research-strategy-development/agent-roles/*` | Control Plane context、identity、registered evidence | Proposal/Candidate request/Decision submission | Planner/Developer/Reviewer 可替换角色入口 | 权威事实和直接策略落盘 |
| `research-strategy-development/replay-execution-plane/compatibility/legacy-research-kernel` | 既有 candidate、family 与 forward inputs | legacy fill/trade facts、result shell | 有界维持迁移期 R&D/Forward 执行消费者 | native Trial Replay、Result/Artifact authority、新调用方 |
| `research-strategy-development/replay-execution-plane/compatibility/legacy-research-contracts` | legacy data/feature/evaluation/provenance type refs | Signal、Trade、Strategy、Options、Result 等 compile-time shapes | 冻结旧源码类型合同 | runtime 实现、native Replay contracts、新字段设计 |
| `research-strategy-development/replay-execution-plane/compatibility/legacy-research-data` | manifest path、timeframe、CSV bytes、legacy funding events | manifest、Candle arrays、funding range statistics | 冻结旧 R&D/Forward 数据读取 | native Dataset admission、SourceEvent、新数据接入 |
| `research-strategy-development/replay-execution-plane/compatibility/legacy-research-decision` | legacy Strategy/Options、candles、indicators、latest entry ref | frozen decision input、latest diagnostic、lookahead report | 冻结旧 prefix-only decision 语义 | fill materialization、trade resolution、Forward/Review/execution authority |
| `research-strategy-development/replay-execution-plane/compatibility/legacy-research-evaluation` | legacy trade metric views、split/stage fields | summary、diagnostics、anti-overfit、robustness、candidate gate | 冻结旧 R&D/Forward 评估语义 | Replay 执行、trade facts、native metrics、Review/promotion authority |
| `research-strategy-development/replay-execution-plane/compatibility/legacy-research-features` | legacy numeric series / Candle arrays | EMA、ATR、fixed indicator set | 冻结旧 R&D/Forward 派生特征语义 | 新特征研发、feature store、native Replay indicator contract |
| `research-strategy-development/replay-execution-plane/compatibility/legacy-research-order-lane` | legacy Candle、simulated lane orders、initial position/risk basis | simulated fills、final position、legacy R projections | 冻结独立 OHLCV order-lane 语义 | 主 Replay、native engine/order state/accounting、新执行语义 |
| `research-strategy-development/replay-execution-plane/compatibility/legacy-research-provenance` | manifest、bar interval、assumptions、candle/trade times、supplemental refs | legacy provenance、temporal contract | 冻结旧 identity binding 与 closed-candle temporal projection | Replay 执行、trade facts、native PIT/Result/Artifact authority |
| `research-strategy-development/replay-execution-plane/compatibility/legacy-research-strategy-fixture` | legacy replay options、frozen Candle/indicator contracts | 单一 trend-pullback fixture、fixture id、compatibility replay result | 维持 legacy certification fixture | 产品 registry、Draft Strategy、strategy-family、新策略 |
| `research-strategy-development/replay-execution-plane/compatibility/legacy-replay-identity` | JSON identity、manifest/timeframe、supplemental refs、legacy kernel source | canonical/file/data/harness hashes | 冻结旧 evidence identity | strategy、Signal、Fill、Result、新 Replay identity |
| `research-strategy-development/replay-execution-plane/certification/legacy-replay-fingerprint` | legacy replay manifest / assumptions | evidence fingerprint certification | 基于 legacy research kernel 的 evidence parity 认证 | replay 执行、Trial 转发、新语义 owner、策略升格 |
| `governance-review-compliance/strategy-review` | strategy markdown、evidence input、catalog evidence、optional read-only `trade.db` | evidence record、review report、promotion result、strategy status update | 策略证据、复核、升格门禁 | R&D 实验、交易执行、写 `trade.db`、写 RD memory |
| `artifact-knowledge/artifact-catalog` | catalog DB、`data/` / `tmp/` roots、artifact refs、retention 设置 | catalog query、stale report、GC report、artifact metadata、feature report refs | 数据资产索引、artifact hygiene、catalog-aware GC | 写 `trade.db`、策略判断、交易所 API |
| `market-data-products/ohlcv-fetch` | Binance market symbol、timeframes、Vision/funding/panel 请求参数 | CSV/manifest、funding events、market feature panel、calibration inputs | 数据采集与因果对齐 | 策略判断、升格、交易事实 |
| `exchange-gateway/binance-read/account-snapshot` | symbol、history 参数、Binance read credentials | balance / position / open-order / protective-order / history JSON | 账户事实读取 | 写 `trade.db`、下单、策略观点 |
| `market-data-products/binance-read/symbol-snapshot` | symbol、pulse / recent-kline 参数 | ticker、mark、funding、OI、轻量 K 线 JSON | 单标的市场事实读取 | 候选排名、live action |
| `market-data-products/binance-read/market-scan` | direction、universe、ranking filters | long / short 候选列表 | 全市场初筛 | 直接触发交易 |
| `market-data-products/binance-read/aggtrades-fetch` | symbol、time/limit 参数 | aggTrades 原材料与 summary | 成交流材料获取 | 长期策略结论 |
| `market-data-products/liquidation-zones` | aggTrades / snapshot / optional raw input | liquidation-like refs | 微观结构分析 refs | 裸信号、交易执行 |
| `exchange-gateway/binance-write/order-preview` | structured order intent | exchange method、request preview、warnings | 执行预演和路由解释 | 真实下单 |
| `exchange-gateway/binance-write/order-place` | executor 编译后的 entry/add order 参数 | exchange submit result | USDM 主单写接口 | 减仓、保护腿、策略判断 |
| `exchange-gateway/binance-write/order-cancel` | order id / client id / algo cancel scope | exchange cancel result | 撤单写接口 | 新开风险、状态持久化 |
| `exchange-gateway/binance-write/position-protect` | position side、stop/take-profit/trailing 参数 | protective legs result | 保护腿写接口 | 主单开仓、策略判断 |
| `exchange-gateway/binance-write/position-adjust` | position side、reduce / close 参数 | reduce / close result | 减仓或平仓写接口 | 加仓、新开风险 |
| `live-execution-control/plan-preflight` | plan、observe、strategy、account config、runtime policy | deterministic verdict、blocked reasons、warnings | hard guard / decision card | 市场观点、事件写入 |
| `market-data-products/tech-indicators` | local OHLCV manifest、indicator config | indicator report、structure、feature series、beta | 指标与结构计算 | 交易执行、数据获取 |
| `contracts/runtime-core` | 无运行输入；被源码 import | JSON、path、time helper | 跨模块 runtime core contract | 领域编排、外部 API |
| `contracts/execution-contract` | execution contract input | compiled execution contract、validation result | 执行契约编译和校验 | 下单、preflight verdict |
| `contracts/preflight-contract` | plan / observe / strategy / account config | deterministic verdict、blocked reasons、warnings | hard guard contract、target action parsing | 交易所写入、市场观点 |
| `contracts/catalog-contract` | catalog command payload | artifact / evidence / R&D run catalog result | catalog CLI client contract | catalog DB schema / scan / GC 实现 |
| `contracts/replay-contract` | replay result records | replay result type/schema shell | replay result read model contract | replay execution、manifest/data/hash 读取、gate 计算 |
| `contracts/strategy-contract` | strategy markdown、contract YAML subset | compiled/lint contract types and pure helpers | strategy contract 解析、编译、lint 语义 | agent-facing CLI、R&D execution、review/promotion |
| `contracts/strategy-policy` | strategy markdown、optional JSON path | lightweight strategy policy metadata | frontmatter / strategy file / strategy directory 读取契约 | full Trade Contract compile/lint、fallback discovery、写文件 |

## Trade-Flow Façade

`orchestration-ops/trade-flow` 保留 automation / runtime / observe / execution / recovery 五类 suite entry；当前实现入口集中在 `src/scripts/commands/*`，已退役的 `src/domain/*` 不得恢复。事件、投影、observe、执行与恢复的真实 owner 分别位于 `portfolio-execution-state/*`、`live-decision-planning/*` 与 `live-execution-control/*`；trade-flow 只做参数、顺序、权限和 owner handoff。

## Rules

- agent-facing 模块之间通过 CLI JSON contract 协作；MCP 只作为 Agent 入口适配既有 Owner CLI，不成为新的领域 owner。源码跨模块 import 只允许指向 `modules/contracts/*`、同 domain 的无 package internal engine，或 `orchestration-ops/trade-flow` 编排层调用 `modules/*` 原子能力。
- `modules/orchestration-ops/trade-flow/src/scripts/commands/*` 是 suite façade；新增原子能力优先落独立 `modules/<domain>/<module>`，不要继续塞进 trade-flow。
- 模块 durable 运行事实只落 `data/*.db`；临时工作产物只落 `tmp/`；模块目录不保存运行快照、cache、研究垃圾。
- `T` 类 Binance 写模块不得被 R&D / replay / market scan 直接调用。
- `negative_control` 是唯一命名口径。
