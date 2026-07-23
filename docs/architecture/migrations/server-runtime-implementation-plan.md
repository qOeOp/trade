---
title: Server Runtime Implementation Plan
role: architecture-migration
status: active-migration
owner: architecture
last_verified: 2026-07-23 CST
---

# Server Runtime Implementation Plan

## 1. 目标与边界

本文把 [Program-Owned Runtime Migration](./program-owned-runtime-migration-plan.md) 收敛为单机服务器可施工计划：程序在 Agent 离线后仍持续采集行情、运行交易与研究任务、恢复状态并保守停机；Codex、OpenClaw、HTTP、MCP 只作为北向入口。

本文不改变当前 authority，也不宣称 live cutover 已完成。Rust L2、J01–J07、R&D、review、MCP 等继续由既有 owner 负责；本阶段新增的是统一装配、任务生命周期和部署闭包，不复制领域逻辑。

## 2. 当前基线与总缺口

| 已有基线 | 尚缺闭包 |
| --- | --- |
| Rust public L2 WebSocket、book、raw segment、gRPC/read owner | 多 symbol 与正式服务器托管；L2 尚未成为策略或执行 authority |
| J01–J07 job graph、cadence、health、lease、idempotency | 常驻 program profile 仍关闭 domain jobs 与 live write |
| trade plan、action intent、trigger expiry、execution gate | 没有独立的短期条件监控任务生命周期 |
| J04 supervisor、Replay、forward、review、durable RD state | 已有 bounded autonomy refill；真实 provider/kill-restart/长时 J04-J05-J07 soak 尚未闭合 |
| 既有 owner toolset、本地 stdio MCP 与 loopback HTTP allowlist | HTTP resident/audit/rotation 已验证，但尚未进入 manager composition；TLS/OpenClaw/长时 soak 未闭合 |
| SQLite owner stores 与 artifact catalog | 本机真实 online backup/隔离 restore 已过；外部介质与被 durable ref 引用的 `tmp/` artifact 迁移仍未闭合 |

核心缺口不是更多 tool，而是一个可验证的 runtime profile，把既有 owner 按依赖装配成长期运行程序。

当前 S3 前置证据已进入 P1.26：program shadow supervisor 具备 fenced lease、bounded child、signal drain、immutable Agent/program parity ledger，以及 owner/MCP 共用的只读 parity status。P1.25 的顺序实时读取观察在 27 轮中得到 26 match / 1 mismatch；该差异来自两条路径在相隔数百毫秒时读取到不同的 resident-consumer health，不是 graph 实现漂移。P1.26 因此固定 `shared_owner_result_replay_v1`：program 每轮只采样一次 owner command，Agent 路径独立构图但回放同一结果；回放键保留 executable / cwd / argv 的语义字段，只去除 cycle、时间和结果 ID 等 invocation identity，任何命令语义漂移都 fail closed。旧记录原样保留为 `sequential_live_reads_v1`，只读状态同时报告 raw / comparable / legacy counts，且不输出 cutover verdict。修正口径预检与首轮短观察累计 `7/7 match`；最终一小时 bounded observation 已于 2026-07-23 01:11 CST 以 fencing token `7` 从零启动，期间 J01–J07、live write 与真实通知仍关闭。

并行准备的 P1.27 不改变该 soak：新增 one-shot `catalog_hygiene_canary` 固定 profile，未来只允许一次 J06 owner scan 与 `artifact_catalog` 写入；GC、`--yes`、任意 root、J01–J05/J07、live write 和真实通知均无入口。当前只完成代码/fixture，真实 canary 必须等待 P1.26 终态与 lease release。

S1 截至 2026-07-23 已完成 macOS no-live 主机纵切：三个正式 foreground entrypoint 从 committed immutable release 由 launchd 常驻；只读 status、consumer-only restart、public/full-shadow soak 和真实 online backup/隔离 restore 均通过。owner/consumer 同 epoch，累计 parity `9/9 match`；既有 `50061` L2 未被接管。Linux systemd 保留同合同的 render/fixture，不是 macOS 完成门；外部备份介质、整机重启与长时 crash-loop 仍待验证。

S3 已新增独立 `full_shadow` 固定 profile：同一 fenced supervisor/wakeup 可启用 J01–J07、强制 cadence due、保留 owner active/state gate，并永久关闭 exchange live write 与真实通知。干净 HEAD 的临时 SQLite/captured-owner 双周期 fixture 已得到 7/7 enabled、Agent/program `2/2 match`、零重复 job/incident；同槽重启 terminal skip 且 fencing token `1→2`，未出现 live command。当前版本化 server config 仍是 `shadow_program`；published owner CLI smoke、故障注入与长时观察完成前不得切换。

S4/S5 已形成首个本地闭环：J04 路由先读 `plan_next`，ready/terminal 不调用模型；active empty/unready queue 才调用固定 Model Gateway，domain assessment 通过后以 `updated_at` CAS 原子入队，再委托既有 supervisor。模型失败不写 state/Trial，identical replay 幂等，stale/conflict fail closed；真实 provider probe 已通过。真实 R&D owner 子进程另完成 post-commit/pre-ack `SIGKILL`：重启前移除源 manifest 仍幂等读回同一 Result，数据库保持单一 completed Trial / Result。J04/J05/J07 长时 soak 与 Linux 采用仍待闭合。

S6 已新增 loopback-only Operator HTTP：Bearer + 独立 controlled approval、固定 read/write rate、exact route/payload 和 ops pre/post audit；当前只开放 tool search、RD read 与 approved J04 wakeup，不含 exchange/live/promotion/任意 command。Bun resident、真实 audit 回读和 API/approval token 重启轮换已通过，且 smoke 不调用 controlled owner；TLS、manager secret facility、OpenClaw client 与长时 soak 尚未完成。

S7 已新增机器可判定的 no-live release gate。本机已补齐 launchd install、真实 volume restore、public/full-shadow soak、Operator resident/audit/rotation、SiliconFlow probe 与 R&D kill/restart 单 Trial/Result。平台边界已收紧：Darwin 全绿仍只能证明 `no_live_local_rehearsal`，并以 `linux_server_rehearsal_not_run` 阻断 server adoption；只有真实 Linux systemd / 容器证据才可进入 `no_live_server_shadow` 人工变更评审。D10 source package 已可从 committed HEAD 原子生成 source archive、关键合同 hash 与 checksum；Linux acceptance 入口请求 BuildKit SBOM/provenance，并验证 no-live health、container restart 与 named-volume canary，但本机没有 Docker，尚未产生该证据。该 gate 无论结果如何都不能开放 exchange write 或自动 promotion。

本机 Darwin arm64 已把 committed release staging 到非受保护用户数据目录，并安装三个固定 launchd labels；因此不再从 Downloads workspace 取得无人值守 authority。manager plist/hash 与 release manifest 绑定，当前三个 unit active。

后续冲突审计发现现有独立 L2 已占用 `50061`，因此 macOS profile 使用隔离 `51061`，且 preflight 新增 listener availability。server launchd manager 只允许三个固定 label，拒绝 loaded duplicate、plist drift 与 blocked preflight，bootstrap 失败时只回滚本次创建的 labels/plists。

为避免把可编辑 workspace 直接交给 launchd，macOS 采用新增 immutable release staging：只取 committed HEAD，绑定 dependency lock 与 Rust binary hashes，使用全新 runtime roots，不复制现有 owner 数据。staged release 通过自身 preflight 后才可进入 plist diff/install。

## 3. 运行工作模型

系统不使用一个全局轮询间隔处理所有工作。每项工作只能属于以下运行形态之一：

| 形态 | 生命周期 | 适用工作 | 禁止 |
| --- | --- | --- | --- |
| resident service | 进程长期存活，外部 manager 重启 | Rust L2、resident market consumer、operator gateway | 持有策略或交易决策 authority |
| scheduled domain cycle | 按 owner cadence 唤醒，执行后退出 | J01–J07、slow/fast track、catalog、review | 用高频空转代替事件或 watch |
| ephemeral watch task | 由已批准 plan 创建；触发、到期、取消或阻断后释放 | 入场区间、保护条件、短时 market-quality/freshness 监控 | 生成新 thesis、绕过 preflight、直接下单 |
| semantic model task | 有界 API 请求，返回 typed proposal 后退出 | hypothesis、异常归因、计划解释、review synthesis | 进入 tick loop、写 owner store、调用 Binance write |
| bounded worker job | 队列驱动，可跨分钟或小时，终态后退出 | Replay、R&D campaign、forward evidence | 无预算循环、打开未授权 holdout、自动 promotion |
| operator request | 人或 Agent 触发的短请求 | 查询、审批、诊断、显式提交 | 成为 daemon 父进程或内部消息总线 |

`trade-flow` 与 `ops_runtime_store` 继续拥有 schedule、lease、job lifecycle 和 incident；领域 owner 继续拥有输入验证、计算与写入。MCP、HTTP 或模型框架不得创建第二套 scheduler / state authority。

## 4. 可执行计划与短期 Watch Task

### 4.1 计划分层

现有 `trade-plan-draft -> action_intent -> preflight -> execution-gate -> execution-router` 保留。一个计划只有同时绑定以下语义，才可派生监控任务：

- 稳定 plan / intent identity、symbol、side、source refs 与 content hash；
- 明确 trigger / invalidation、有效期和允许的目标动作；
- facts freshness、continuity 与 policy snapshot 要求；
- idempotency key、风险预算和原 flow / setup identity；
- 到期、取消、数据不可用、owner unavailable 时的保守终态。

LLM 可以提出计划草案或解释非结构化上下文，但最终 trigger 必须被编译为 owner 可确定性验证的条件；无法编译的条件只能保留为 `watchlist / needs_review / no_action`，不能进入自动执行监控。

### 4.2 Watch Task 语义

Watch Task 是执行计划的临时观察器，不是微型策略 Agent。首个纵切只要求语义闭包，不提前冻结通用 DSL：

```text
identity       task / plan / flow / intent / idempotency
observation    owner fact refs + freshness / continuity requirements
condition      deterministic predicate + invalidation predicate
lifetime       created_at + not_before + deadline + cancellation ref
budget         poll/event budget + error/reconnect budget
handoff        target action intent + required preflight/execution owners
audit          last observation ref + terminal reason + result ref
```

状态只能单调前进：

```text
created -> armed -> observing
  -> triggered -> handed_off -> completed
  -> expired | cancelled | blocked
```

- `triggered` 只产生 owner-validated action handoff；下单前重新读取最新 account/market facts，并重新经过 preflight、execution contract、idempotency 和 exchange confirmation。
- `expired / cancelled / blocked` 不制造成交或成功事件；必要时写 observe / attention fact。
- “自动销毁”只释放 timer、socket subscription、child/worker 和 lease；terminal audit 不删除。
- 进程重启后，未过期且 identity/hash 未漂移的任务可重新 acquire lease；已过期、source stale 或 plan 被替换的任务直接终止。
- 同一 intent 的重复触发由 idempotency key 和 flow projection 去重，不能依赖内存 flag。

### 4.3 观察方式

| 输入现实 | 执行方式 |
| --- | --- |
| owner 提供 watch/event port | bounded subscription；断线、epoch change 或 resync 必须重取 snapshot |
| 只有 bounded owner read | task-owned timer 周期读取；不得运行完整 J01–J07 graph |
| 仅 closed candle 有意义 | 只在 candle close 后求值，不做伪高频轮询 |
| 条件需要账户/订单事实 | 使用 exchange/account owner read；未知事实进入 blocked/reconcile |
| 条件需要 LLM 每次判断 | 不允许 armed；先改写为确定性 predicate 或降级人工 review |

当前 L2 watermark 只证明服务连续性，不能直接充当 depth delta 或经济触发源。接入策略前必须新增明确 consumer contract、freshness gate、fixture 与 no-overclaim 证据。

## 5. Cadence 与反应延迟

当前 job graph 的 15m fast、4h slow、12h R&D、4h forward/review、24h hygiene 是 domain cadence，不是所有条件的反应延迟。目标分层：

| 延迟层 | 驱动 | 典型职责 |
| --- | --- | --- |
| stream hot path | event/socket | sequence、book、raw、freshness；Rust，零 LLM |
| active-plan watch | event 优先，bounded poll 回退 | 已批准计划的 trigger / invalidation / protection readiness |
| fast defensive cycle | active flow + cadence / incident wakeup | reconcile、trigger refresh、保护与风险锁 |
| slow planning cycle | closed candle / slow cadence | watchlist、thesis、trade-plan draft |
| research/governance | queue + budget + hours cadence | hypothesis、Replay、forward、review、catalog |

具体间隔由 owner profile、交易周期、API 限频与真实延迟证据确定；不得把一个 interval 固化成全系统常量。短期 watch 解决“计划已存在但 15 分钟太慢”，不把 slow planning 变成高频 Agent loop。

## 6. LLM Semantic Task

### 6.1 适用与禁区

| 可使用模型能力 | 必须保持确定性 |
| --- | --- |
| 生成结构化 strategy hypothesis | socket ingest、sequence、book、freshness |
| 汇总多来源证据并提出 plan/watchlist draft | trigger predicate 求值、expiry、idempotency |
| 对 incident / blocker 做诊断建议 | preflight、quantity、risk cap、order route |
| closed-flow review synthesis 与 policy feedback draft | exchange write、confirmation、reconcile |
| 将人类约束编译为候选结构，再交 owner lint | lifecycle、promotion gate、owner store write |

LLM 不替代原 Agent 的无限权限。原来 Agent 能读项目、推理再调用 tool 的流程，迁移后拆成：

```text
owner context assembler
  -> bounded model gateway request
  -> schema parse / deterministic validation
  -> typed proposal
  -> domain owner decision / write
```

### 6.2 最低运行合同

每个 semantic task 必须绑定 task type、input refs、prompt/schema version、provider capability、token/time/cost budget、data classification、idempotency、trace ref 与允许的 next action。失败只返回 `blocked / no_action / retryable`，不得用宽松文本修补后继续。

本文不冻结 semantic task 数量、prompt 或策略流程。新增任务必须先确定 domain owner、最小 context、typed output、deterministic validator 与允许的 handoff；否则仍由人工/Agent 处理。

- provider key 只由 gateway 读取；domain task 不接触 credential。
- 默认一次 structured completion；只有真实出现多轮分支、checkpoint 或人工中断时才评估 LangGraph。
- 模型输出不直接创建 watch task；先由 plan/hypothesis/review owner 校验并冻结。
- provider unavailable 不影响 Rust stream、reconcile、防御动作和既有 deterministic jobs。
- prompt injection、超时、截断、invalid JSON、schema drift、预算耗尽必须进入测试与 incident 分类。

首个闭环保持 R&D 低风险路径：`research_hypothesis_brief -> model task -> research_hypothesis_prepare -> research_job_submit`。只有该闭环稳定后，才评估 slow-plan semantic task；fast guard 与 execution 永不接 LLM 同步依赖。

## 7. 单机服务器装配

### 7.1 逻辑进程组

```text
market-data-runtime
  Rust L2 service -> raw / current book / internal gRPC
  TS owner reconcile / compaction / resident consumer

control-runtime
  program supervisor -> existing J01-J07 job graph -> domain owner CLI/ports
  ephemeral watch-task workers

research-runtime
  J04 workers + Replay / forward / review
  model gateway client

operator-gateway
  local MCP + authenticated HTTP adapter + optional OpenClaw client
```

首版仍是单节点模块化单体：不把 owner toolset 逐个变成网络服务。以上是故障与 authority 隔离边界，不固定容器数量；低风险 worker 可先同进程/同容器，长期进程只能有一个 process authority。macOS launchd 或 Linux systemd 负责 restart，程序内 lease/fencing 负责业务单例与 stale recovery；两者装配同一 foreground contract，均可作为正式单机部署。

### 7.2 内外接口

- Rust gRPC、owner DB 与内部 worker port 默认只在 loopback/private network。
- 北向只开放 authenticated operator API；MCP stdio 可作为同机 sidecar。
- HTTP/MCP/OpenClaw 调用同一 owner ports，不复制业务判断。
- 大数据通过 immutable path/ref/hash 传递；控制消息使用现有 schema envelope。
- Broker 不作为首版前置；出现多独立 durable consumer、offset/replay 和 DLQ 需求后再走 adoption gate。

### 7.3 持久化与 secret

| 路径/能力 | 服务器语义 |
| --- | --- |
| durable DB volume | `trade / ops / rd / catalog / market / ohlcv / governance / exchange / policy` owner DB |
| durable artifact volume | 被 evidence、catalog、review 或恢复引用的 immutable artifact |
| ephemeral workspace | cache、可复算 panel、未被引用的临时报告 |
| read-only config | trading profile、非敏感 provider/model/endpoint policy |
| secret facility | `BINANCE_API_KEY`、`BINANCE_API_SECRET`、`SILICONFLOW_API_KEY`；不进 image/DB/log/prompt |

容器化前必须把“durable ref 指向 `tmp/`”改成可恢复 artifact storage，定义 SQLite online backup/restore、schema migration、WAL/checkpoint、磁盘水位和灾难恢复演练。只挂载 `data/` 而丢失已引用 artifact 不算恢复成功。

## 8. 启动、健康与降级

启动顺序：

```text
validate config/secrets/volumes
  -> owner DB migrate + integrity check
  -> Rust L2 + market consumer ready
  -> control runtime shadow
  -> research/model workers
  -> operator gateway
  -> per-job authority enable
```

- health 区分 process alive、owner ready、data fresh、dependency degraded 和 safe mode；不能用单一 `/health=200` 代表可交易。
- LLM/API 失败：semantic jobs blocked；stream 与确定性防御链继续。
- L2 stale/resync：依赖它的 watch/task blocked；reconcile 与明确 reduce/cancel/protection 不被错误阻断。
- private exchange unavailable：禁止新增风险；保留可审计重试与 reconcile attention。
- DB busy/corrupt、lease lost、artifact missing：fail closed，不启动重复 worker 或无证据续跑。
- shutdown 先停止接收新任务，再取消/到期 ephemeral watch，drain 当前 owner write，checkpoint/close DB，最后停止 stream；不得用进程退出伪造业务终态。

## 9. 实施切片与采用门

| Slice | 施工内容 | 退出条件 |
| --- | --- | --- |
| S0 contract freeze | 本文、runtime profile、process/volume/secret/port 清单 | 当前事实与目标态分离；无第二套 authority |
| S1 composition root | 一个 server profile 装配既有进程；默认 no-live-write | 单命令启动/停止；crash restart；DB/volume 可恢复 |
| S2 watch-task vertical | 一个现有 trade plan 编译为 bounded deterministic watch | trigger/expiry/cancel/restart/idempotency fixture 全闭合；只 handoff 不直写 exchange |
| S3 full shadow runtime | program cadence 启用 J01–J07，但 exchange write 保持关闭 | 与 Agent 路径 parity；长时无重复 job/双写；incident 可查询 |
| S4 model gateway | 已实现 SiliconFlow adapter + R&D hypothesis semantic task + domain assessment | 本地 schema/预算/超时/redaction/eval 已过；真实 capability/dataset parity/server secret/soak 待闭合 |
| S5 research autonomy | 已实现 J04 bounded refill + CAS queue + existing supervisor delegation；J05/J07 保持独立 cadence | 本地 stopped/blocked/no-write/duplicate/stale 门已过；真实 provider、kill/restart 单 Trial/Result 与长时 soak 待闭合 |
| S6 operator convergence | 已实现 loopback HTTP allowlist，与 MCP 同样委托既有 owner；Bun resident、真实 audit 与 token rotation 已过；OpenClaw 仅保留 client 角色 | TLS、manager secret facility、OpenClaw fixture 与长时 soak 待闭合 |
| S7 no-live host adoption | release gate 聚合 lifecycle/recovery/full-shadow/R&D/operator/deployment 证据；macOS launchd、真实 restore 与 soak 已过 | 真实 provider 与 R&D kill/restart 单 Trial/Result 后也仅可进入人工变更评审 |
| post-S7 live cutover | 独立授权后按 job 逐项开放 authority | shadow soak、reconcile、kill/restart、backup/restore、catalog canary 与 live-small canary 全通过 |

每个切片独立提交、验证和回滚。S2 不等待 LLM；S4 不等待 OpenClaw；S7 不因“所有进程能启动”自动成立，也不包含 live authority。可替换 Codex/OpenClaw Host 的采用走独立的 [Agent Host Runtime plan](./agent-host-runtime-integration-plan.md)，不是 S7 的前置条件，也不得反向修改 Program/Owner authority。

### 9.1 完整服务器交付账本

目标交付物不是单个 adapter，而是一套可在远程 Linux 服务器长期运行、经模拟和分阶段采用的无人值守交易系统。按 `D0 → D12` 连续施工；Agent Host 子步骤以 [Agent Host Runtime plan](./agent-host-runtime-integration-plan.md) 的 `P0–P8` 为准。每个阶段都必须包含 scoped diff review、changed/full quality、secret scan、workspace / artifact cleanup 和目标态 / 当前态文档核对。

| 阶段 | 状态 | 交付目标 | 阶段 gate |
| --- | --- | --- | --- |
| D0 基线与总合同 | active | 冻结现状、任务矩阵、风险与外部采用门 | 所有缺口有 owner / test / exit condition |
| D1 No-live composition | active-partial | 单命令装配全部确定性 resident / scheduled 进程 | 重启、drain、lease、restore 不重复 effect |
| D2 市场数据供给 | active-partial | typed demand registry 已完成；继续多 symbol、L2/OHLCV/indicator lifecycle | coverage / freshness / retention 可审计 |
| D3 在线决策循环 | active-partial | J01/J02/J03、watch、账户级候选仲裁 | 无 fresh facts / contract / risk 即 no_action |
| D4 执行与恢复 | active-partial | preflight、execution、confirm/reconcile、保护 / 减风险 | 重投不重复下单；未知事实锁风险 |
| D5 长期策略工厂 | active-partial | Planner/Developer/Replay/Reviewer/Registry/Forward | Codex 式多轮研发不退化；单 Trial / Result |
| D6 策略治理闭环 | pending | review 成熟度、pause/retire/improve、旧 flow 兼容 | 生命周期决定可回指证据和精确版本 |
| D7 存储、GC 与灾备 | active-partial | owner-authorized GC、L2 retention、备份 / 恢复 | 空间自愈；受保护事实零误删 |
| D8 运维、安全与可观察性 | active-partial | health、incident、trace、secret、operator surface | 最小权限、脱敏、可轮换、可告警 |
| D9 Agent / MCP runtime | active-partial | Codex Host port / durable registry、私有 MCP 与 workspace manager 已落地；继续 OpenClaw / R&D 采用 | Host 离线不影响确定性安全链 |
| D10 远程容器交付 | active-partial | 固定镜像、Compose/systemd、volume/network/secret | 干净主机可部署、回滚和恢复 |
| D11 模拟、shadow 与可靠性 | pending | 仿真、故障注入、长时 soak、资源与漂移验证 | 无双写、无 silent stale、无 authority violation |
| D12 live-small 与生产采用 | pending | 逐 job canary、风险限额、生产 runbook | 外部权限齐备且全部 live gate 通过 |

#### D0 基线与总合同

| ID | 步骤 | 完成证据 |
| --- | --- | --- |
| D0.1 | 保存 dirty-worktree scoped baseline，保护既有改动 | path-scoped status / diff |
| D0.2 | 盘点每个 resident、J01–J07、watch、worker、owner store、port、volume 和 secret | machine-readable inventory |
| D0.3 | 将产品故事映射到实现 owner、当前证据、缺口和测试 | coverage matrix |
| D0.4 | 固定 no-live、full-shadow、live-small、production 四级 profile authority | profile validation tests |
| D0.5 | 固定外部门：远程主机、Binance key、IP allowlist、账户 / 风险参数、告警目的地 | deployment prerequisite contract |
| D0.6 | 固定每阶段质量门、清理、artifact retention 和回滚 | engineering contract parity |
| D0.7 | 跑全仓基线并区分既有失败 / 环境缺口 / 本轮回归 | baseline evidence |

#### D1 No-live composition

| ID | 步骤 | 完成证据 |
| --- | --- | --- |
| D1.1 | 统一 release staging、config compile、volume / port / binary preflight | immutable release manifest |
| D1.2 | 装配 L2 owner、resident consumer、control supervisor、research workers、operator gateway | no-live process graph |
| D1.3 | 每个长期进程只保留一个 restart authority；manager 与内部 supervisor 不互相拉扯 | crash-loop tests |
| D1.4 | 实现 startup ordering、readiness、drain 与 bounded shutdown | lifecycle fixture |
| D1.5 | 验证 fenced lease、stale recovery、同槽重启和 DB busy | monotonic token / no duplicate |
| D1.6 | 验证 host reboot / process kill 后从 owner state 恢复 | recovery fixture |
| D1.7 | 聚合 release gate，但保持 domain jobs / live write 关闭 | no-live adoption artifact |

#### D2 市场数据供给

| ID | 步骤 | 完成证据 |
| --- | --- | --- |
| D2.1 | 定义 Runtime / R&D data-demand contract、priority、lease、release | complete：strict contract + owner registry / CLI tests |
| D2.2 | 将固定单 symbol L2 扩为 owner-managed bounded multi-symbol capacity | active-partial：slot / eviction / readiness / drain tests + no-demand foreground fixture；真实双流与 profile cutover 待完成 |
| D2.3 | 合并 active exposure、候选和 R&D 的兼容需求；调用方不控制 daemon | complete：Flow symbol projection + stable lease renewal audit + active-flow defensive sync + J03 candidate submit + explicit R&D merge tests |
| D2.4 | 完成 L2 reconnect、gap/new epoch、current book、bounded watch 与 readiness | complete：sequence gap → new epoch、snapshot/watch resync、bounded session/error budgets、owner/consumer readiness、15m clean release window；current-book 以 wrapper observed age 而非 provider 自报 freshness fail closed |
| D2.5 | 将 OHLCV sync / gap fill 纳入 Program cadence | complete：independent resident worker + aligned self-hashed coverage audit + bounded first-gap fill + unchanged-watermark retry / shutdown fixture；server profile adoption 随 D10 |
| D2.6 | 将 indicators / features 纳入 source watermark 与 deterministic recompute | complete：explicit indicator + compatible OHLCV demand、exact zero-gap watermark、immutable candle slice、closed-world Go provider flags、path/time-independent feature hash、create-or-identical admission；真实 3-bar compute + next-cycle existing fixture；server profile adoption 随 D10 |
| D2.7 | 统一 market fact refs、coverage、freshness 和 consumer binding | complete：shared self-hashed no-authority fact ref；L2 live point、OHLCV zero-gap audit 与 indicator artifact 都绑定 exact demand ids / source plan / owner source hash / product requirement |
| D2.8 | 完成 raw finalize / compaction / reference closure / retention release | no premature delete |
| D2.9 | 只有实测多 durable consumer backlog 才评估 broker | complete（rejected for now）：当前跨进程需求为 owner proposal/read ref，未出现多 durable consumer backlog；不引入 Kafka，出现可量化积压和 fan-out 证据后重开 ADR |

#### D3 在线决策循环

| ID | 步骤 | 完成证据 |
| --- | --- | --- |
| D3.1 | J01 每周期先 reconcile account/order/fill/position facts | unknown fact risk lock |
| D3.2 | J02 只管理 active flow、保护和明确减风险 | no new thesis / risk tests |
| D3.3 | J03 以全市场粗筛 → 候选深化 → setup / intent 运行 | no indiscriminate L2 |
| D3.4 | active-plan watch 覆盖 trigger、invalidation、expiry、cancel 和 restart | deterministic watch suite |
| D3.5 | setup TTL、instrument tradability 与候选失效释放数据需求 | stale opportunity tests |
| D3.6 | 实现账户级候选排序、相关暴露、资金互斥与统一分配 | complete at qualified-candidate seam：deterministic self-hashed arbiter、integer risk units、total/symbol/correlation/new-slot limits、expiry/existing exposure/duplicate symbol rejection；J03 当前无 qualified setup 时继续零候选/no_action |
| D3.7 | 固定 setup / lane / flow identity 和精确 strategy version binding | replay / duplicate tests |
| D3.8 | 每轮 no_action / blocked / skipped 具备 owner reason 与 refs | explainability assertions |

#### D4 执行与恢复

| ID | 步骤 | 完成证据 |
| --- | --- | --- |
| D4.1 | 补齐 risk-control 未统一接入的 fresh facts、exposure、market-quality 与成本门 | preflight matrix |
| D4.2 | intent → execution contract → router → exchange owner 保持单一路径 | no bypass test |
| D4.3 | Binance write 使用稳定 idempotency、精确授权和最小 credential | duplicate request tests |
| D4.4 | submit 后必须 confirm 或进入 reconcile；只由 fill 改变 position | uncertain submit fixtures |
| D4.5 | partial fill、cancel/replace、保护修复、reduce / close 保持事件可追踪 | flow projection tests |
| D4.6 | exchange/API outage、rate limit、clock drift、规则变化 fail closed | failure matrix |
| D4.7 | retired / paused 策略的已有 exposure 仍可防御和闭合 | legacy-flow safety tests |
| D4.8 | live capability 默认编译为 false；不得被 Agent / 容器化隐式开启 | profile / secret gate |

#### D5 长期策略工厂

| ID | 步骤 | 完成证据 |
| --- | --- | --- |
| D5.1 | 将 Factory durable lifecycle 与 Campaign / Agent Run / Trial 局部终态分离 | restart / queue tests |
| D5.2 | 接入 cited research finding、失败、review 与 improvement request | provenance-separated inputs |
| D5.3 | Planner 生成 typed hypothesis 并经过既有 admission | complete：真实 OpenClaw Planner、owner-resolved protocol、trial budget / family axis gate 与 accepted revision |
| D5.4 | Developer 做 family / data / Replay / Runtime capability assessment | complete at registered-family seam：真实 Brief、v3 exact data snapshot、registered family/protocol assessment；新 family/code coverage 仍归 D5.5 |
| D5.5 | Developer 在隔离 worktree 改 MD / code / tests | active-partial：frozen worktree、closed write prefixes、bounded package check、patch hash 与 GC 已完成；容器读隔离和真实 Agent 二次修改待 P5 |
| D5.6 | owner 冻结 data、reserve Trial、执行 deterministic Replay | active-partial：6-Trial immutable Plan / Work Package 与 compatibility Result 已实跑；certified Replay reservation/worker 仍待接入 |
| D5.7 | Agent 阅读失败 artifact 并二次修改或 reject | active-partial：Reviewer lesson 已驱动 4H→1h bounded revision；真实隔离代码 patch→重测仍待 D5.5 |
| D5.8 | Reviewer 基于登记 evidence 提交 decision | complete at historical compatibility stage：Result classification→bounded context→typed modify→lifecycle / lesson 幂等写回 |
| D5.9 | Registry / Forward / Governance 沿正式入口接纳 | no automatic promotion |
| D5.10 | mechanical Replay、Agent-assisted evaluation 和 Forward evidence 分权 | active-partial：compatibility evidence 明确无 formal Replay / promotion authority；certified Replay 与 Forward gate 待闭合 |
| D5.11 | 完成 kill/restart、provider outage、duplicate 和 locked-holdout 测试 | active-partial：Host terminal recovery、R&D post-commit/pre-ack `SIGKILL` 单 Trial/Result、context oversize fail/retry、SQLite bounded busy wait 与 locked-holdout zero-use 已验证；mid-execution kill、outage / 长时 Factory 待完成 |

#### D6 策略治理闭环

| ID | 步骤 | 完成证据 |
| --- | --- | --- |
| D6.1 | 汇总 closed-flow review，区分 thesis/data/execution/guard/cost/process | attribution contract |
| D6.2 | 定义最小独立样本、时间跨度、regime、成本完整度和 execution maturity | decision-ready gate |
| D6.3 | 实现 keep / observe / pause / retire / improve owner transition | lifecycle tests |
| D6.4 | retired 版本禁止新 setup / forward / live，但历史证据保留 | fail-closed tests |
| D6.5 | improvement request 回到 Factory 并形成新 version | no in-place mutation |
| D6.6 | 新 release 不重新解释旧 active flow；旧实现按依赖回收 | compatibility gate |
| D6.7 | Agent 只提建议，Governance owner 写最终 decision | authority test |

#### D7 存储、GC 与灾备

| ID | 步骤 | 完成证据 |
| --- | --- | --- |
| D7.1 | 建立 owner store / artifact / cache / tmp / L2 raw 容量分类账 | capacity inventory |
| D7.2 | Program 定期触发 artifact owner dry-run / delete gate | deterministic GC |
| D7.3 | 保护 active flow、Trial、dataset、evidence、incident 和 durable refs | reference-closure tests |
| D7.4 | L2 使用专属 compaction / retention / deletion authority | raw safety tests |
| D7.5 | soft watermark 自动回收；hard line 只局部阻断非必要写入 / 新风险 | pressure tests |
| D7.6 | SQLite backup、WAL/checkpoint、integrity 与隔离 restore | byte/hash verified restore |
| D7.7 | DB 与被引用 artifact 一致备份，不留下指向丢失 `tmp/` 的 durable ref | disaster recovery fixture |
| D7.8 | 未知大文件只允许 Agent 建议，owner 决定删除 | no natural-language delete |

#### D8 运维、安全与可观察性

| ID | 步骤 | 完成证据 |
| --- | --- | --- |
| D8.1 | health 分离 process、owner、data freshness、capability、profile readiness | readiness model |
| D8.2 | trace 关联 cycle/job/Agent/tool/Trial/Result/flow/exchange command | bounded audit lookup |
| D8.3 | 统一 retry、backoff、circuit breaker、rate / token / cost budgets | failure budget tests |
| D8.4 | secret facility 按服务注入，支持轮换；不进入 image/log/DB/prompt | secret scan / rotation |
| D8.5 | Operator API 通过 VPN/TLS/private ingress、鉴权、approval 与 rate limit | network/security tests |
| D8.6 | incident 分类、告警抑制、升级和恢复确认 | incident fixtures |
| D8.7 | 日志 / metrics / artifacts 有大小、retention 与脱敏边界 | pressure / leakage tests |
| D8.8 | 运行账户 / 订单 / 持仓 / 数据 stale / disk / Agent backlog 的值守检查 | unattended dashboard/CLI evidence |

#### D9 Agent 与 MCP runtime

本阶段按 [Agent Host Runtime plan](./agent-host-runtime-integration-plan.md) 的 `P0–P8` 执行；它必须同时满足：

- Codex App Server 是代码研发基线；OpenClaw 是外层 Gateway 候选，不替代 Program。
- Developer sandbox 是采用前置条件，Planner / Reviewer 默认只读。
- private MCP 复用相同 owner capability registry；Agent Host 无 production repo RW、owner DB、Binance key 或 scheduler authority。
- Host/provider 全部离线时，L2、J01/J02、防御执行、GC 与确定性 jobs 继续。

#### D10 远程容器交付

| ID | 步骤 | 完成证据 |
| --- | --- | --- |
| D10.1 | 创建 pinned multi-stage images；非 root、read-only rootfs、最小 package | image scan |
| D10.2 | Compose 首版只表达进程、network、volume、secret 和 health，不表达业务 cadence | config audit |
| D10.3 | control、L2、Agent、Developer job 与备份 volume / network 隔离 | trust-boundary tests |
| D10.4 | 生成 systemd / Compose 启停、drain、backup、restore 和 rollback 命令 | clean-host rehearsal |
| D10.5 | config migration、schema migration 和 release compatibility fail closed | upgrade / downgrade fixture |
| D10.6 | 锁定 CPU/memory/PID/file/log limits 与 restart policy | resource kill tests |
| D10.7 | active-partial：committed source package、critical hash、checksum、版本 manifest 与 Linux acceptance 已实现；真实 SBOM/provenance/digest 待 Linux build | artifact verification |
| D10.8 | 在真实 Linux runner / 服务器运行 no-live restore + restart rehearsal | remote adoption evidence |

#### D11 模拟、shadow 与可靠性

| ID | 步骤 | 完成证据 |
| --- | --- | --- |
| D11.1 | 历史 Replay 回归覆盖策略、成本、风险和 execution assumptions | deterministic regression |
| D11.2 | exchange adapter 使用 fixture / testnet / shadow command 验证，不产生真钱动作 | no-live execution evidence |
| D11.3 | full-shadow 启用 J01–J07 和真实 public/private reads，write 始终 false | job / fact parity |
| D11.4 | 注入进程、主机、L2、provider、MCP、DB、network 和磁盘故障 | failure matrix |
| D11.5 | 重投、cancel race、unknown submit、stale facts 和 clock drift | fail-closed report |
| D11.6 | 长时 soak 观察 restart、memory、disk、backlog、token/cost 和 state growth | bounded soak artifact |
| D11.7 | 审查 false positive / no_action / missed cadence / degraded recovery 并迭代 | review ledger |
| D11.8 | clean revision 重跑全部采用证据和全仓质量门 | release candidate |

#### D12 live-small 与生产采用

| ID | 步骤 | 完成证据 |
| --- | --- | --- |
| D12.1 | 校验远程主机、备份目的地、时间同步、private ingress 与告警通道 | deployment prerequisites |
| D12.2 | 校验 Binance key 无提现权限、最小 read/trade、IP allowlist 与轮换方案 | credential attestation |
| D12.3 | 冻结账户、symbol、strategy、notional、daily loss、exposure、order 与 kill-switch limits | signed risk profile |
| D12.4 | 先开 private read + reconcile，保持 write false | account parity soak |
| D12.5 | 单策略 / 单 symbol / 最小 notional live-small canary | confirm/reconcile/stop evidence |
| D12.6 | 注入 canary 后重启、网络失败和重复请求，证明不双单且保护可恢复 | live fault evidence |
| D12.7 | 按 job / strategy 独立扩大 authority，任何 gate 失败自动回退 shadow / safe mode | staged adoption ledger |
| D12.8 | 完成值守 runbook、自动 backup/GC/health/incident 与定期演练 | unattended operations |
| D12.9 | 只有所有 gate 通过才标记 production adopted；否则交付保持可部署 shadow 候选 | explicit adoption decision |

D0–D9 和 D10 的可审查部署包可以在没有远程主机的当前环境持续完成。D10.8 与 D12 必须有真实 Linux 运行环境；D12 还必须由用户提供最小权限 Binance credential、账户 / 风险参数和 live-small 明确授权。这些外部门不会被测试 key、模拟成交或“容器运行正常”替代。

### 9.2 当前立即执行队列

严格按门禁继续，不以新增框架绕过失败项：

1. 完成 D0 inventory / coverage / profile authority 与全仓基线。
2. 复判现有 S1–S7 证据，删除只剩历史价值的即时状态描述，保留可复跑 gate。
3. 已完成真实 R&D owner post-commit/pre-ack `SIGKILL` 后单 Trial / Result 恢复；继续补 J04/J05/J07 长时 cadence soak。
4. D2.1 typed demand / lease / release / reconciliation 已闭合；继续 D2.2–D2.8，不先等待 Agent / Docker。
5. 继续 D9 的 P0–P5；D10 source package 已闭合本机可做部分，下一门是把包交给真实 Linux 跑 acceptance、restore、host reboot 与 soak，形成 D10.8 证据。
6. 每完成一个阶段更新本账本状态；阶段全部完成后自动进入下一阶段。

## 10. 完成定义

- 一台干净服务器可从版本化配置和 secret facility 启动全部长期进程，无需保持 Agent 会话。
- 行情、快慢轨、active-plan watch、R&D、forward、review 和 hygiene 各按自身触发现实运行。
- 每个任务都能回答 owner、输入 refs、deadline/budget、idempotency、状态、结果与终止原因。
- LLM 只产生 typed proposal；确定性 owner 决定是否接受、记录或执行。
- 任一进程崩溃、主机重启、API/LLM/L2/DB 部分故障都不会产生双写、静默 continuity 或绕过风险门。
- 数据库与被引用 artifact 可一起备份恢复；恢复后 projection、lease、task 和 evidence 引用可校验。
- operator API、MCP、OpenClaw 全部离线时，既有安全运行和保守降级仍成立。
- live write 只能由逐 job cutover 明确开启，且始终经过现有 [Event and Flow Contract](../../runtime/event-flow-contract.md)、[Execution Tool Contract](../../runtime/execution-tool-contract.md) 与 preflight authority。
