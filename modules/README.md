# Modules

`modules/` 是项目源码货架。每个模块内部自带 `src/`、运行入口、测试和本地契约；根目录 [toolset.json](../toolset.json) 是 agent 使用这些模块的注册表。

## Shape

| 层 | 职责 |
| --- | --- |
| `toolset.json` | agent-facing 工具索引：按 intent / capability / writes / module_type 找工具 |
| `modules/<domain>/<module>/` | 模块根：package / go.mod / requirements / reference / 模块说明 |
| `modules/<domain>/<module>/src/` | 模块实现：scripts、schemas、tests、内部 helper |
| `modules/contracts/<contract>/src/` | 新跨模块 contract / client 层；业务模块只能依赖这里或 CLI contract |

## Module Types

| 类型 | 负责 | 禁止 |
| --- | --- | --- |
| `suite` | 归类、迁移期路由、把一组原子能力暴露给 agent | 继续扩张成业务大总线 |
| `atomic` | 一个主动词 + 一个对象；单一 CLI、单一主写入面、独立 contract / check | 混合多个生命周期阶段或多个 owner |
| `contract` | 可被源码跨模块 import 的 type、schema、pure helper | 读写文件、调用外部 API、拥有流程 |

`toolset.json` 每个 entry 必须声明 `module_type`、`owner_scope`、`entry_contract`、`requires_preflight`、`concurrency_group` 和 `forbidden_callers`。编排器后续只应输出 `tool_id + payload + entry_contract`，不输出裸路径命令；裸路径 command 只保留在 registry resolver 层。

## Module Contracts

| 模块 | 输入 | 输出 | 负责 | 禁止 |
| --- | --- | --- | --- | --- |
| `trade-flow` | strategy markdown、trading config、`trade.db`、tool JSON 输出 | `plan_event`、automation jobs、recovery drafts | 编排、执行流、恢复、准入、事件流 | Binance endpoint 细节、市场数据接入实现、R&D 实验实现、策略复核 owner |
| `research/replay-runner` | OHLCV manifest、strategy id、replay parameters | replay result | 单策略机械 replay | 写文件、写 catalog、R&D search、策略升格 |
| `research/data-split` | source OHLCV manifests、split ratios、embargo parameters | discovery / validation / locked holdout manifests、split report、optional catalog ref | 数据切分与 holdout 隔离 | R&D search、replay、review、`trade.db` |
| `research/benchmark-runner` | panel manifests、benchmark cost / funding assumptions | fixed benchmark report | 固定 benchmark 仿真与负对照 | R&D search、calibration suite、review、`trade.db` |
| `research/calibration-suite` | panel manifests、optional previous calibration report | calibration diagnostic report | pipeline calibration、data breadth/funding/cost diagnostics | R&D search、strategy evidence、review、`trade.db` |
| `research/strategy-contract-compile` | strategy markdown、candidate override JSON | compiled strategy contract | strategy contract 编译 | R&D search、replay、review、catalog 写入 |
| `research/strategy-contract-lint` | strategy markdown | lint result、optional compiled contract | strategy contract 完整性 lint | R&D search、replay、review、catalog 写入 |
| `research/strategy-rd` | OHLCV manifest、market feature artifact、candidate JSON、strategy contract、R&D state | R&D / panel report、R&D state update、gated draft candidate、catalog metadata | 策略研发、panel、forward holdout、R&D learning memory | 写 `trade.db`、触发 Binance、策略升格、单策略 replay CLI、data split CLI、benchmark/calibration CLI、strategy contract compile/lint CLI |
| `governance/strategy-review` | strategy markdown、evidence input、catalog evidence、optional read-only `trade.db` | evidence record、review report、promotion result、strategy status update | 策略证据、复核、升格门禁 | R&D 实验、交易执行、写 `trade.db`、写 RD memory |
| `ops/artifact-catalog` | catalog DB、`data/` / `tmp/` roots、artifact refs、retention 设置 | catalog query、stale report、GC report、artifact metadata、feature report refs | 数据资产索引、artifact hygiene、catalog-aware GC | 写 `trade.db`、策略判断、交易所 API |
| `ohlcv-fetch` | Binance market symbol、timeframes、Vision/funding/panel 请求参数 | CSV/manifest、funding events、market feature panel、calibration inputs | 数据采集与因果对齐 | 策略判断、升格、交易事实 |
| `binance/account-snapshot` | symbol、history 参数、Binance read credentials | balance / position / open-order / protective-order / history JSON | 账户事实读取 | 写 `trade.db`、下单、策略观点 |
| `binance/symbol-snapshot` | symbol、pulse / recent-kline 参数 | ticker、mark、funding、OI、轻量 K 线 JSON | 单标的市场事实读取 | 候选排名、live action |
| `binance/market-scan` | direction、universe、ranking filters | long / short 候选列表 | 全市场初筛 | 直接触发交易 |
| `binance/aggtrades-fetch` | symbol、time/limit 参数 | aggTrades 原材料与 summary | 成交流材料获取 | 长期策略结论 |
| `binance/liquidation-zones` | aggTrades / snapshot / optional raw input | liquidation-like refs | 微观结构分析 refs | 裸信号、交易执行 |
| `binance/order-preview` | structured order intent | exchange method、request preview、warnings | 执行预演和路由解释 | 真实下单 |
| `binance/order-place` | executor 编译后的 entry/add order 参数 | exchange submit result | USDM 主单写接口 | 减仓、保护腿、策略判断 |
| `binance/order-cancel` | order id / client id / algo cancel scope | exchange cancel result | 撤单写接口 | 新开风险、状态持久化 |
| `binance/position-protect` | position side、stop/take-profit/trailing 参数 | protective legs result | 保护腿写接口 | 主单开仓、策略判断 |
| `binance/position-adjust` | position side、reduce / close 参数 | reduce / close result | 减仓或平仓写接口 | 加仓、新开风险 |
| `guards/plan-preflight` | plan、observe、strategy、account config、runtime policy | deterministic verdict、blocked reasons、warnings | hard guard / decision card | 市场观点、事件写入 |
| `analytics/tech-indicators` | local OHLCV manifest、indicator config | indicator report、structure、feature series、beta | 指标与结构计算 | 交易执行、数据获取 |
| `contracts/runtime-core` | 无运行输入；被源码 import | JSON、path、time helper | 跨模块 runtime core contract | 领域编排、外部 API |
| `contracts/execution-contract` | execution contract input | compiled execution contract、validation result | 执行契约编译和校验 | 下单、preflight verdict |
| `contracts/preflight-contract` | plan / observe / strategy / account config | deterministic verdict、blocked reasons、warnings | hard guard contract、target action parsing | 交易所写入、市场观点 |
| `contracts/catalog-contract` | catalog command payload | artifact / evidence / R&D run catalog result | catalog CLI client contract | catalog DB schema / scan / GC 实现 |
| `contracts/strategy-contract` | strategy markdown、contract YAML subset | compiled/lint contract types and pure helpers | strategy contract 解析、编译、lint 语义 | agent-facing CLI、R&D execution、review/promotion |

## Trade-Flow Domains

`trade-flow` 是编排模块，但内部不能再是大平层。旧 `research` / `review` / `artifact` domain 已移除；真实 RD owner 是 `modules/research/strategy-rd`，真实 review owner 是 `modules/governance/strategy-review`，真实 artifact/catalog owner 是 `modules/ops/artifact-catalog`。

| Domain | Contract | 负责 |
| --- | --- | --- |
| `execution` | `modules/trade-flow/src/domain/execution/CONTRACT.md` | dry-run、shadow、live-small、execution command spec、order_fill |
| `recovery` | `modules/trade-flow/src/domain/recovery/CONTRACT.md` | reduce、reconcile、safe local apply、needs_review |
| `observe` | `modules/trade-flow/src/domain/observe/CONTRACT.md` | runtime load、snapshot projection、observe event build |
| `runtime` | `modules/trade-flow/src/domain/runtime/CONTRACT.md` | event store、flow projection、cron、automation plan |

## Rules

- 模块之间通过 CLI JSON contract 协作；源码跨模块 import 只允许指向 `modules/contracts/*`。
- `trade-flow/src/domain/*/index.ts` 是 trade-flow 编排边界；新增原子能力优先落独立 `modules/<domain>/<module>`，不要继续塞进 trade-flow。
- 模块运行产物只落 `data/` 或 `tmp/`；模块目录不保存运行快照、cache、研究垃圾。
- `T` 类 Binance 写模块不得被 R&D / replay / market scan 直接调用。
- `negative_control` 是唯一命名口径。
