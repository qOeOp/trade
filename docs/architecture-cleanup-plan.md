# Architecture Cleanup Plan

## 0. 定位

本文是一次深层整理计划，不改变产品边界。

项目仍只做：agent 工作区内的 Binance USDM 单账户 4H+ swing 自动化；不转向 QuantDinger 式 SaaS、UI、多用户、多交易所平台。

整理目标不是“多做功能”，而是防止增量开发继续把判断、事实、执行、研究、恢复和运维堆进同一层。

## 1. 参照来源

QuantDinger 可借鉴的是工程组织，不是产品范围：

| QuantDinger 做法 | 本项目吸收方式 |
| --- | --- |
| 文档契约 / 命令契约 / API-MCP 契约分层 | 改为：docs 契约 / skill CLI 契约 / event-evidence 契约 |
| Human API 与 Agent Gateway 分面 | 改为：用户接管 / cron 慢轨 / cron 快轨共用 executor，但入口权限分级 |
| capability scope：R/W/B/C/T | 改为本地动作权限分级，不做 token 系统 |
| paper-only default + live 双重解锁 | 改为 setup `live-small` + runtime live gate + preflight 三重准入 |
| order intent / fill / runtime event 分离 | 在 `plan_event` 单表内补足 lifecycle 语义，不提前多表化 |
| concurrency model：idempotency / lock / claim-before-work | 改为 cron lock、flow/lane 单写入者、clientOrderId 幂等、执行前 claim |
| module boundaries / extension guide | 改为 skill 与脚本 ownership rules，防止 `trade-flow` 继续膨胀 |
| signal execution standard | 改为 replay / shadow / live 对齐契约：信号时刻、成交时刻、退出负责人 |
| agent audit / redaction / payload bounds | 改为 skill 输出 schema、敏感字段红线、artifact retention |

## 2. 当前诊断

已有强项：

- vision / prd / design 已把产品边界压住。
- `plan_event`、`execution_contract_snapshot`、preflight、reconcile、evidence fingerprint 已形成安全骨架。
- R&D gate 已有 locked holdout、null controls、calibration suite、artifact ledger。
- 功能 skill 多数单一职责，且大多已有测试入口。

主要风险：

- `trade-flow` 已混合 online flow、recovery、execution recording、replay、R&D、calibration、evidence、artifact GC。
- `trade-flow/scripts/main.ts` 与 `SKILL.md` 变成命令总线，新增能力容易继续往里塞。
- 没有项目级命令契约；各 skill 有各自 `check`，但没有统一“改了什么跑什么”。
- 动作权限没有机器可读边界；只读、写 evidence、写 `trade.db`、真实下单都靠文档和人工识别。
- order lifecycle 仍偏事件描述，缺少统一状态机词表。
- recovery 已有方向，但还不是独立算法契约。
- R&D 代码和在线交易 glue 共处一个 skill，容易让“研究失败样本”与“交易事实”在心智上混杂。
- artifact / tmp / data 的保留、pin、引用关系需要更硬的运行约定。

## 3. 目标架构

### 3.1 三层契约

| 层 | 名称 | 作用 | 不做 |
| --- | --- | --- | --- |
| L1 | docs contract | 定义产品边界、术语、流程语义、ownership、红线 | 不写临时灵感 |
| L2 | command contract | 定义稳定 CLI、输入输出 schema、验证命令 | 不靠散落的一次性 shell |
| L3 | event/evidence contract | 定义 `plan_event`、evidence ledger、artifact refs、order lifecycle | 不引入 UI/API 平台 |

任何新增能力先归入三层之一；归不进去则先写设计，不直接实现。

### 3.2 动作权限分级

本项目不做 agent token，但每个 skill / command 必须归类：

| Class | 名称 | 允许 | 例子 |
| --- | --- | --- | --- |
| `R` | read facts | 读外部或本地事实，不写状态 | account snapshot、symbol snapshot |
| `A` | analyze | 计算指标 / replay / calibration，可写 artifact | tech indicators、R&D batch |
| `E` | evidence write | 写 strategy evidence / R&D ledger，不写 `trade.db` | append evidence、artifact GC dry-run |
| `V` | event write | 写本地 `plan_event`，不触发 Binance 写接口 | observe、shadow order_fill、reconcile apply |
| `T` | trade write | 触发 Binance 写接口 | order place / protect / adjust / cancel |
| `C` | credentials/config | 读写敏感配置或凭证 | account config、API key 环境 |

规则：

- `T` 必须先过 `plan-preflight`，且必须生成 `execution_contract_snapshot`。
- `T` 默认不允许由 R&D / replay / market scan 直接触发。
- `R/A/E/V` 失败不得自动升级为 `T` 补救。
- `C` 不进入普通 cron 输出，不进入 artifact，不进入 agent notes。

### 3.3 运行面 ownership

| Domain | Owns | Must not own |
| --- | --- | --- |
| `observe` | 事实采集、快照归一、最小 observe 构造 | 交易判断、候选搜索 |
| `plan` | thesis、entry/stop/size/no_action、action_intent | Binance payload、数量精度 |
| `preflight` | hard guards、decision card、阻断原因 | 市场观点 |
| `execution` | contract compile、preview、submit、protect、fill 归档 | 策略资格判断 |
| `recovery` | reduce、exchange reconcile、unknown / needs_review | 新开风险 |
| `review` | flow 闭合样本、归因、policy feedback | 自动升格 |
| `research` | replay、R&D、calibration、benchmark、candidate signal | 写 `trade.db`、触发 Binance |
| `evidence` | fingerprint、strategy status gate、ledger | 交易事实替代品 |
| `artifact` | refs、pin、retention、GC | 业务判断 |

`trade-flow` 可以继续作为 suite 入口，但脚本内部必须按 domain 分包；入口只做 command routing。

## 4. 目标目录形态

先整理模块，不先决定 skill 数量。

```text
.agents/skills/trade-flow/
├─ SKILL.md                  # 只保留 router、权限分级、红线、命令索引
├─ stages/                   # observe / plan / execute / review 的人读流程
├─ scripts/
│  ├─ main.ts                # thin router，禁止承载业务逻辑
│  ├─ commands/              # 每个 CLI command 一个薄入口
│  └─ lib/
│     ├─ runtime/            # plan_event repo、projection、flow/lane reducer
│     ├─ observe/            # observe builder / skill adapter
│     ├─ execution/          # execution contract wrapper、order lifecycle recorder
│     ├─ recovery/           # reconcile / unknown / needs_review
│     ├─ research/           # replay / R&D / benchmark / calibration
│     ├─ evidence/           # strategy evidence / review / promote
│     ├─ artifacts/          # GC / pin / refs
│     └─ shared/             # json, hash, time, schema helpers
└─ strategies/               # strategy assets；后续再定是否外迁
```

功能 skill 保持平铺；只有满足以下条件才迁入 suite 内部 tools：

- 只服务 `trade-flow`；
- 裸调用会产生安全绕行；
- 已验证 agent runtime 对嵌套 skill 的扫描行为；
- 已有等价 command contract 和测试。

## 4.1 Skill 设计调整

当前 skill 的主要问题不是数量，而是“可被裸调用的能力”和“必须走流程的能力”边界不够硬。

调整方向：

| Skill 类型 | 目标形态 | 调整 |
| --- | --- | --- |
| Suite skill | 编排流程、读写事件、调用功能 skill | `trade-flow` 只保留在线链 glue；R&D 虽可暂留同 skill，但代码 owner 独立 |
| Read skill | 只读事实，输出稳定 JSON | `binance-account-snapshot`、`binance-symbol-snapshot`、`ohlcv-fetch` 标为 `R/A`，不得写 `trade.db` |
| Execute skill | 只做单一交易动作 | `binance-order-place/protect/adjust/cancel` 标为 `T`，必须由 executor 调用，不作为 plan 入口 |
| Guard skill | 确定性阻断 | `plan-preflight` 保持独立，输出固定 blocked/warnings，不写事件 |
| Analysis skill | 计算与研究 | `tech-indicators`、R&D 相关命令不得 import Binance 写接口 |
| Notify skill | 运维通知 | `notify-dispatch` 只做 dispatch，不改变 flow 状态 |

SKILL.md 调整规则：

- `< 300 行`，只写用途、权限 class、输入输出、红线、命令索引。
- 长流程下沉到 `stages/*/STAGE.md` 或 `references/*.md`。
- 每个命令标明 `R/A/E/V/T/C`。
- 每个 `T` 命令必须写“不能被直接用于策略判断”。
- 每个调用其他 skill 的命令必须说明被调用 skill 的权限 class。

需要新增的 skill 元数据字段：

```yaml
capability_class: R | A | E | V | T | C
writes:
  trade_db: false
  evidence_ledger: false
  artifacts: false
  binance: false
requires_preflight: false
```

这些字段先作为文档约定，不要求 agent runtime 识别；后续可由 docs check 解析。

## 4.2 代码组织调整

需要把“文件按技术类型分”升级为“文件按 domain owner 分”。

### `trade-flow`

当前大文件风险：

- `scripts/main.ts` 同时承担 parse、dispatch、DB、execution、research、evidence、recovery。
- `scripts/lib/strategy-rnd.ts` 同时承担输入解析、候选生成、replay、selection audit、ledger record。
- `scripts/lib/replay-core.ts` 同时承担数据读取、指标、撮合、gate、provenance。
- `scripts/lib/strategy-benchmark.ts` 同时承担 calibration、benchmark、负对照、report。

目标拆分：

```text
scripts/
├─ main.ts                         # parse + dispatch only
├─ commands/
│  ├─ runtime.ts                    # init / append / recover-flow
│  ├─ observe.ts                    # build-observe / observe-from-skills
│  ├─ execution.ts                  # record-execution / dry-run / shadow / live-small
│  ├─ recovery.ts                   # reconcile / apply / cron-recover
│  ├─ research.ts                   # replay / rnd / benchmark / calibration / signal
│  ├─ evidence.ts                   # append-evidence / review / promote
│  └─ artifacts.ts                  # artifact-gc
└─ lib/
   ├─ runtime/
   ├─ observe/
   ├─ execution/
   ├─ recovery/
   ├─ research/
   │  ├─ replay/
   │  ├─ rnd/
   │  ├─ calibration/
   │  └─ families/
   ├─ evidence/
   ├─ artifacts/
   └─ shared/
```

拆分顺序：

1. 只移动代码，不改行为。
2. 先抽 command wrapper，再抽 lib。
3. 每步保留旧 CLI 参数。
4. 每步跑当前 skill test。

### Binance execute skills

执行 skill 需要统一 contract 姿势：

- 所有写 Binance 的 skill 都接受 `client_order_id` 或明确说明交易所不支持。
- 所有写 Binance 的 skill 输出统一 envelope：`ok / request / exchange_response / normalized_event / warnings`。
- `binance-order-place` 不再成为“参数自由入口”；executor 编译后的 contract 才是推荐输入。
- protect / adjust / cancel 同样输出可直接变成 `order_fill` 的 normalized event。

### Market / analysis skills

- market skill 只给事实，不给交易建议。
- `binance-market-scan` 输出必须保持 candidate list，不得输出 action_intent。
- `tech-indicators` 输出 factor descriptor 与 feature series；不得知道 R&D candidate family 的业务含义。
- `ohlcv-fetch` 只负责数据与 manifest，不负责 replay gate。

### Shared code

当前每个 TS skill 自带 package / node_modules。先不做 monorepo 迁移，但要形成共享代码边界：

- 短期：复制少量工具可以接受，但 schema / hash / time / envelope 不能继续分叉。
- 中期：建立 `.agents/shared/ts/` 或 `scripts/shared/`，由各 skill import。
- 迁移前先确认 agent runtime 与相对 import / package resolution 是否稳定。

禁止项：

- 不为“去重复”引入过重 build system。
- 不把所有 skill 合成一个巨型包。
- 不让共享库反向依赖具体 skill。

## 4.3 测试架构调整

测试按风险域组织，不再只按文件 colocate。

| Test suite | 覆盖 | 不触发 |
| --- | --- | --- |
| `unit` | pure helper、schema、hash、parser | 网络 / Binance / DB 写 |
| `contract` | CLI 输入输出、JSON envelope、权限 class | Binance 写 |
| `runtime` | plan_event append/reduce/recover | Binance 写 |
| `execution-dry` | contract compile、preview、mock order lifecycle | Binance 写 |
| `recovery-fixture` | missing fill、unknown order、partial fill、protective drift | Binance 写 |
| `research` | replay、R&D、calibration、null controls | trade.db / Binance 写 |
| `binance-test` | Binance test endpoint / read smoke | 默认关闭 |

每个高风险 bug 修复都应落一个 fixture，而不是只修实现。

## 4.4 依赖与仓库卫生

当前多个 skill 目录含 `node_modules`，会放大仓库噪声与审查成本。

调整：

- 明确 `node_modules` 是否应进入 Git；若不应进入，统一 `.gitignore` 与 install/check 文档。
- 每个 skill 保留 lockfile，但不把依赖源码当项目资产审查。
- 建立“skill dependency install / check”命令契约。
- Python / Go / TS skill 分别列清运行时要求。

验收：

- `rg --files` 不被依赖源码淹没。
- 代码 review 默认只看项目源文件。
- 新 skill 不复制旧 skill 的完整依赖树进 Git。

## 5. Order / flow lifecycle 统一词表

`order_fill.sub_kind` 保留，但补 lifecycle 词表：

```text
intent_created
contract_compiled
submitted
accepted
partially_filled
filled
amended
cancel_requested
cancelled
rejected
expired
unknown
needs_review
reconciled
```

规则：

- 新增风险必须先有 `intent_created -> contract_compiled`。
- `submitted` 不改变 position；只有 `filled / partially_filled / reconciled fill` 改变 position。
- `unknown` 不允许继续加风险；只能 reconcile、sync protection 或人工接管。
- `needs_review` 冻结该 flow 的加风险动作，直到慢轨全量对账或用户明确处理。
- reduce / cancel / sync protection 在 `unknown` 下仍可作为防御动作，但必须写明来源。

## 6. Recovery 契约

恢复优先级固定：

```text
Binance facts
  > exchange order/fill history
  > local plan_event
  > evidence ledger
  > artifact / notes
  > memory
```

恢复算法：

1. reduce 本地 flow，得 `current_orders / current_position / latest_observe`。
2. 拉 Binance account + symbol-scoped history。
3. 对每个差异分类：`matched` / `reconcile_draft` / `protective_drift` / `unmatched`。
4. `reconcile_draft` 只生成草案；apply 必须显式 `--yes` 或慢轨授权。
5. `protective_drift` 可防御性 `sync_protection`，但不冒充账本已恢复。
6. 任一 `unmatched` 进入 `needs_review`，本轮不新增风险。
7. 恢复结束写 `decision_summary`，不能只返回 success/fail。

## 7. Replay / live 对齐契约

每个可升格 setup 必须能说明：

| 字段 | 含义 |
| --- | --- |
| `signal_source` | replay family / strategy rule / manual setup |
| `signal_timing` | confirmed closed candle / trigger condition / manual |
| `execution_timing` | next bar open / current mark / limit trigger |
| `exit_owner` | protective order / strategy rule / manual review |
| `same_bar_policy` | stop_first / target_first forbidden / no same-bar |
| `cost_model` | fee、slippage、funding、gap |
| `live_deviation_policy` | live 与 replay 偏差如何进入 review |

没有这组对齐契约的 replay 只能研究，不能作为升格 evidence。

## 8. 命令契约

新增项目级命令文档前，先按现有 skill 保留入口；后续统一到 `scripts/` 或 `justfile` 时再实施。

最低命令集：

| Intent | Command contract |
| --- | --- |
| 检查全部安全域 | run all skill checks that changed |
| 检查在线链 | trade-flow + plan-preflight + binance preview/place/protect/adjust tests |
| 检查 R&D 链 | ohlcv-fetch + tech-indicators + trade-flow research tests |
| 检查 docs 契约 | docs link / required sections / forbidden stale terms |
| dry-run flow | init db -> build observe -> preflight -> mock execute -> reduce |
| recovery drill | seed events -> reconcile snapshot -> apply draft -> reduce |

每个 command 必须声明：

- 输入文件 / env；
- 是否可写；
- 是否可能触发 Binance；
- 成功输出；
- 最小测试。

## 9. 文档治理

文档分层：

| Doc | Role |
| --- | --- |
| `vision.md` | 产品北极星与边界 |
| `prd.md` | 当前产品契约 |
| `design-architecture.md` | 在线链与事件语义 |
| `tech-spec.md` | 执行层、schema、skill 细节 |
| `skill-layout.md` | skill 拓扑与 ownership |
| `market-data-design.md` | 数据来源与合法落点 |
| `rd-reliability-roadmap.md` | R&D 可靠性 |
| `architecture-cleanup-plan.md` | 本次整理施工图 |

规则：

- 新功能先找 owner doc；找不到先补 ownership，不直接写实现。
- `SKILL.md` 只放 router 和红线；长流程下沉到 stage / reference。
- 文档不得把未实现结构写成已完成事实。
- R&D 失败结论不写进长期 memory；只进 R&D ledger / artifact。

## 10. 分期实施计划

### P0：冻结基线与盘点

目标：先知道系统真实长什么样。

任务：

- 输出 skill / command / class 清单。
- 标出每个命令的 `R/A/E/V/T/C`。
- 记录现有测试基线与失败项。
- 标出大文件、跨 domain import、裸 Binance 写入口。

验收：

- 有一份可 diff 的 inventory。
- 不改业务逻辑。

### P1：契约补齐

目标：先补边界，再搬代码。

任务：

- 在 `skill-layout.md` 增加动作权限分级。
- 在 `design-architecture.md` 增加 order lifecycle / recovery 契约。
- 在 `prd.md` 增加 replay-live 对齐契约。
- 在 `tech-spec.md` 对齐 `unknown / needs_review / partial_fill`。

验收：

- docs 之间术语一致。
- 没有新增产品范围。

### P2：`trade-flow` 路由瘦身

目标：把入口从业务文件变成 router。

任务：

- `main.ts` 拆为 `commands/*`。
- DB / projection 归 `runtime/`。
- observe / reconcile / execution / research / evidence 分目录。
- 保留所有 CLI 参数兼容。

验收：

- 旧命令仍可运行。
- `main.ts` 只负责 parse + dispatch + response。
- 测试按旧入口通过。

### P3：执行生命周期硬化

目标：真钱路径先稳。

任务：

- execution recorder 支持 lifecycle 词表。
- `record-execution` 强制 `intent_created / contract_compiled` 语义。
- recovery 遇到 `unknown / needs_review` 自动阻断加风险。
- clientOrderId 与 lifecycle 状态统一校验。

验收：

- partial fill 不被当成 full position。
- rejected / unknown 不会继续 add risk。
- 防御动作仍可执行并可审计。

### P4：Recovery drill

目标：每次异常都有固定恢复动作。

任务：

- 增加恢复 fixture：缺本地 fill、保护腿漂移、未知挂单、部分成交。
- `cron-recover-from-skills` 输出固定分类。
- reconcile apply 只接受安全草案。

验收：

- 任一 unmatched 都阻断 EXECUTE。
- protective drift 不污染账本。
- 恢复报告可直接进入 review。

### P5：R&D 边界整理

目标：研究强，但不污染在线链。

任务：

- `research/` 包含 replay、R&D、benchmark、calibration。
- research command 全部标为 `A/E`，不得 import execution writer。
- candidate signal 只返回 `entry/no_action`，不写 `trade.db`。
- artifact refs / evidence refs 明确分离。

验收：

- R&D 代码不依赖 Binance 写 skill。
- research 失败只进 R&D ledger / artifact。
- promotion 仍需 fresh evidence gate。

### P6：命令与测试契约

目标：后续增量开发不靠记忆。

任务：

- 建立项目级 check 文档或脚本。
- 按 domain 定义最小测试组。
- 对高风险命令增加 fixture 测试。
- 明确哪些测试允许真实 Binance test endpoint，默认关闭。

验收：

- 改 execution 能知道跑什么。
- 改 R&D 能知道跑什么。
- 改 docs 能知道检查什么。

### P7：Artifact / data hygiene

目标：长期运行不变成垃圾场。

任务：

- 定义 artifact durable / ephemeral / pinned。
- GC dry-run 默认输出引用原因。
- `.pin`、evidence ref、ledger ref 三类保护统一。
- tmp 与 data/artifacts 的迁移/清理规则落地。

验收：

- 未引用 artifact 可安全 dry-run 清理。
- 被 evidence 引用的 artifact 不会被删。

### P8：可选机器契约

目标：不做 API，也让 CLI 可被机器可靠消费。

任务：

- 为核心 command 输出 JSON schema。
- 为 `plan_event.body` / evidence record 提供 schema 文件。
- 输出错误 envelope：`ok=false + code + retriable + details`。

验收：

- agent 不需要读长文也能调用核心命令。
- schema drift 能被测试发现。

## 11. 实施红线

- 不新增 UI / SaaS / 多账户 / 多交易所目标。
- 不把 QuantDinger 的 Postgres/Redis/Agent Gateway/MCP 照搬进当前阶段。
- 不用重构顺手改策略规则。
- 不移动代码而不保留 CLI 兼容。
- 不让 R&D 代码 import Binance 写接口。
- 不让快轨产生战略判断。
- 不把临时研究结论写成长期制度。
- 不在未补测试前重写执行路径。

## 12. 完成定义

这次整理完成后，项目应能回答：

- 一个命令属于哪个权限 class？
- 一个文件属于哪个 domain owner？
- 一次真钱动作如何从 intent 追到 contract、submit、fill、review？
- 一次异常如何进入 recovery，何时进入 `needs_review`？
- 一个 replay evidence 为什么能或不能升格？
- 改某层代码应该跑哪组检查？

能回答这些问题，就不是堆叠；后续增量开发才有骨架。

## 13. 实施记录

### 2026-07-08

已完成：

- P0 inventory：新增 `docs/architecture-inventory.md`，记录 skill、command、热点文件、测试基线。
- 权限分级：16 个本地 skill 的 `SKILL.md` 已补 `capability_class / writes / requires_preflight` 元数据。
- 文档骨架：`skill-layout / prd / design-architecture / tech-spec` 已补 live gate、execution alignment、order lifecycle、recovery priority。
- `trade-flow` 第一轮瘦身：
  - `commands/args.ts`：CLI 参数解析独立。
  - `commands/help.ts`：CLI help 独立。
  - `commands/research.ts`：replay / R&D / benchmark / calibration / signal / artifact GC 路由独立。
  - `commands/evidence.ts`：append evidence / review / promote 路由独立。
  - `lib/plan-events.ts`：`plan_event` schema、append、read、validate 独立。
  - `lib/flow-state.ts`：flow reducer 与 reconcile apply 独立。
  - `lib/execution-flow.ts`：execution event、dry-run/shadow step、order-place command 构造独立。
  - `lib/json.ts`、`lib/run-mode.ts`：共享基础类型与字段读取独立。
- `trade-flow` 第二轮瘦身：
  - `commands/observe.ts`：load runtime / build observe / observe-from-skills 路由独立。
  - `commands/runtime.ts`：init / append order_fill 路由独立。
  - `commands/execution.ts`：record execution / dry-run / shadow / live-small 路由独立。
  - `commands/recovery.ts`：recover / reconcile / apply / cron recover 路由独立。
  - `lib/observe-flow.ts`：runtime load 与 observe-from-skills 独立。
  - `lib/live-execution.ts`：shadow-from-skills 与 live-small 执行独立。
  - `lib/recovery-flow.ts`：reconcile-from-skills 与 cron recover 独立。
  - `scripts/main.ts` 降为 thin router。
- 命令层回归测试：
  - `commands/args.test.ts` 锁定核心 flag、JSON 文件输入、非法 enum / unknown flag 错误路径。
  - `commands/handlers.test.ts` 锁定 observe / runtime / execution / recovery handler 的代表性无外部依赖路径。
- 研究侧输入契约拆分：
  - `lib/strategy-rnd-inputs.ts`：R&D batch / loop / campaign / signal 的输入类型与 JSON parser 独立。
  - `lib/strategy-rnd-inputs.test.ts`：锁定 factor research option alias、campaign discovery manifest alias、signal candidate 解析。
  - `lib/strategy-benchmark-inputs.ts`：benchmark / calibration suite 输入类型与 JSON parser 独立。
  - `lib/strategy-benchmark-inputs.test.ts`：锁定 benchmark public definition、funding report alias、calibration-only 字段。
- 研究侧 ledger 拆分：
  - `lib/strategy-rnd-ledger.ts`：R&D ledger record、artifact redaction、JSONL 读写、run_id / holdout 幂等独立。
  - `lib/strategy-rnd-ledger.test.ts`：锁定 rejected reason 汇总、locked holdout key、idempotence、artifact redaction。
- 研究侧 campaign 拆分：
  - `lib/strategy-rnd-campaign.ts`：R&D campaign orchestration、calibration gate、discovery/validation non-overlap、locked validation 调度独立。
  - `lib/strategy-rnd-campaign.test.ts`：锁定 calibration blocker 读取、overlap 拒绝、discovery→validation 调度、trial budget 阻断。
- 研究侧 candidate evaluation 拆分：
  - `lib/strategy-rnd-evaluation.ts`：candidate replay、null controls、parameter stability、R&D gate、funding events helper 独立。
  - `lib/strategy-rnd-evaluation.test.ts`：锁定 parameter count / side flip、entry lag rebuild、gate blockers、robustness、candidate ranking。
- 研究侧 selection / failure summary 拆分：
  - `lib/strategy-rnd-selection.ts`：winner selection、rank reversal audit、blocker summary、failure area、next action 独立。
  - `lib/strategy-rnd-selection.ts`：新增 `reliability_gate`，把样本画像、失败层归因与继续 trial 权限机器化。
  - `lib/strategy-rnd-selection.test.ts`：锁定 unstable selection blocker、accepted candidate ranking、failure summary、reliability gate 与 action 建议。
- 研究侧 candidate source 拆分：
  - `lib/strategy-rnd-candidates.ts`：feature store load、candidate id 校验、provided / bounded composition / scientific discovery 候选来源、campaign candidate count、setup-conditioned factor research 独立。
  - `lib/strategy-rnd-candidates.test.ts`：锁定 duplicate/empty candidate id、候选来源分类、factor condition 注入、campaign 计数与 discovery 约束。
- 外部 skill runner fixture：
  - `lib/live-execution.test.ts`：锁定 live-small 调用 `binance-order-place` 的 cwd、命令参数、失败不写 `order_fill`。
  - `lib/recovery-flow.test.ts`：锁定 reconcile 调用 `binance-account-snapshot` 的 cwd、history 参数、snapshot 失败不 apply。
- 执行生命周期硬化：
  - `buildRecordedExecutionEvent` 写入 `lifecycle_status=submitted`。
  - `flow-state` reducer 支持 `submitted / accepted / amended / rejected / expired / cancelled / partially_filled / filled / reconciled / unknown / needs_review` 语义。
  - `unknown / needs_review` 进入 `risk_lock`，`live-small` 在风险锁下拒绝继续加风险。
  - `lib/flow-state.test.ts` 锁定 rejected/expired/cancelled 不改仓位、filled/reconciled 改仓位、unknown/review 形成风险锁。
- Recovery drill 硬化：
  - `cronRecoverFromSkills` 遇到 unmatched reconcile 写入 `review(status=needs_review)`。
  - recovery 后 `reduceFlowState` 可读到持久 `risk_lock`，避免异常后下一轮继续加风险。
  - `lib/recovery-flow.test.ts` 增加 unmatched → needs_review fixture。
- Recovery fixture 补齐：
  - `reconcile` 对缺本地 fill / partial fill 先生成补录 draft，再按 projected position 判断仓位差异，避免可解释成交被误判 unmatched。
  - `reconcile` 对保护腿漂移输出 `protective_drift`，不生成普通 submit draft，不把保护腿异常冒充为账本恢复。
  - `lib/reconcile.test.ts` 增加缺本地 fill、partial fill 历史补录、protective drift 三个 fixture。
- Benchmark domain 拆分：
  - `strategy-rnd.ts` 当前已基本只剩 batch / loop / campaign glue，暂不继续硬拆。
  - `lib/strategy-benchmark-data.ts`：panel alignment、panel diagnostics、data hash、funding coverage、historical funding drag 独立。
  - `lib/strategy-benchmark-simulation.ts`：cost model、weight schedule、portfolio simulation、null controls、regime attribution 独立。
  - `lib/strategy-calibration-report.ts`：calibration report assembly、report hash、previous run comparison、failure findings 独立。
  - `strategy-benchmark.ts` 降为 benchmark runner glue；当前约 179 行。
  - `lib/strategy-benchmark-data.test.ts` 与 `lib/strategy-benchmark-simulation.test.ts` 锁定数据层和仿真层契约。
- Artifact / data hygiene：
  - `lib/artifact-hygiene.ts` 区分 durable / ephemeral / pinned；支持 root-relative 引用、目录引用、目录级 `.pin`、durable store/ledger 保护。
  - `.jsonl`、`durable/`、`ledger/`、`ledgers/` 默认不被 GC 删除；`tmp/`、`temp/`、`cache/`、`scratch/`、`ephemeral/` 可走更短保留期。
  - `--ephemeral-retention-hours` 接入 CLI，用于独立控制临时目录清理阈值。
  - `lib/artifact-hygiene.test.ts` 锁定 dry-run、引用保护、目录 pin、durable 保护、ephemeral 短保留期、显式删除路径。
- P8 机器契约开口：
  - `commands/response.ts`：失败输出保留 `error`，新增 `code / retriable / details`。
  - 成功与失败输出统一带 `schema_version=trade-flow.script-response.v1`；业务 `data` 暂不提前冻结。
  - `successResponse / errorResponse` 统一命令响应构造，避免散落裸 `{ ok, data }`。
  - `schemas/script-response.schema.json` 落地外层响应 JSON Schema，只约束 envelope，不约束 command-specific `data`。
  - `schemas/plan-event.schema.json` 落地 `plan_event` 外壳 JSON Schema，只约束事件行外层，不约束各 `kind.body_json`。
  - `ScriptResponse` 明确 `INVALID_ARGUMENT / PRECONDITION_FAILED / EXTERNAL_FAILURE / INTERNAL_ERROR`。
  - `response.test.ts` 锁定 response schema 与 builder 不漂移；`plan-events-schema.test.ts` 锁定 plan_event schema 与 validator-owned kind 枚举不漂移。
  - `main.test.ts` 锁定成功、invalid argument、precondition 三类外层 envelope。

验证：

- `.agents/skills/trade-flow`: `bun run typecheck`
- `.agents/skills/trade-flow`: `bun run test`，170 pass / 0 fail
- repo root: `git diff --check`

下一步：

- 继续盘点是否需要为少数核心 `data` 输出补 JSON schema；只冻结已经稳定的契约。
