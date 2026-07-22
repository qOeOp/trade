---
title: Server Runtime Implementation Plan
role: architecture-migration
status: proposed
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
| J04 supervisor、Replay、forward、review、durable RD state | ready queue 为空时仍需外部 Agent 生成 hypothesis |
| 既有 owner toolset 与本地 stdio MCP | 没有统一 composition root、HTTP operator API 与服务器部署合同 |
| SQLite owner stores 与 artifact catalog | 没有 volume、备份恢复；被 durable ref 引用的 artifact 仍可能落在 `tmp/` |

核心缺口不是更多 tool，而是一个可验证的 runtime profile，把既有 owner 按依赖装配成长期运行程序。

当前 S3 前置证据已进入 P1.26：program shadow supervisor 具备 fenced lease、bounded child、signal drain、immutable Agent/program parity ledger，以及 owner/MCP 共用的只读 parity status。P1.25 的顺序实时读取观察在 27 轮中得到 26 match / 1 mismatch；该差异来自两条路径在相隔数百毫秒时读取到不同的 resident-consumer health，不是 graph 实现漂移。P1.26 因此固定 `shared_owner_result_replay_v1`：program 每轮只采样一次 owner command，Agent 路径独立构图但回放同一结果；回放键保留 executable / cwd / argv 的语义字段，只去除 cycle、时间和结果 ID 等 invocation identity，任何命令语义漂移都 fail closed。旧记录原样保留为 `sequential_live_reads_v1`，只读状态同时报告 raw / comparable / legacy counts，且不输出 cutover verdict。修正口径预检与首轮短观察累计 `7/7 match`；最终一小时 bounded observation 已于 2026-07-23 01:11 CST 以 fencing token `7` 从零启动，期间 J01–J07、live write 与真实通知仍关闭。

并行准备的 P1.27 不改变该 soak：新增 one-shot `catalog_hygiene_canary` 固定 profile，未来只允许一次 J06 owner scan 与 `artifact_catalog` 写入；GC、`--yes`、任意 root、J01–J05/J07、live write 和真实通知均无入口。当前只完成代码/fixture，真实 canary 必须等待 P1.26 终态与 lease release。

S1 截至 2026-07-23 已从“提案散点”进入可执行实现：三个正式 foreground entrypoint、固定 `server-shadow` profile、systemd render、preflight/status、合成生命周期与恢复演练均已落地。只读 public smoke 已跨两个 control cycle 保持同一 L2 epoch、同一 fencing token，comparable parity mismatch 未增加；因当前 host 为 macOS，结论只能是 local observation。Linux systemd 安装/故障注入和真实 durable volume restore 仍是 S1 采用门，未完成前不得宣称服务器 ready。

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

首版仍是单节点模块化单体：不把 owner toolset 逐个变成网络服务。以上是故障与 authority 隔离边界，不固定容器数量；低风险 worker 可先同进程/同容器，长期进程只能有一个 process authority。Docker/systemd 负责 restart，程序内 lease/fencing 负责业务单例与 stale recovery。macOS launchd 只用于开发机验证，不是 Linux 部署合同。

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
| S4 model gateway | SiliconFlow adapter + R&D hypothesis semantic task | schema/预算/超时/redaction/eval 通过；Agent 离线可补 ready queue |
| S5 research autonomy | J04/J05/J07 按 state/cadence 连续推进 | blocked/no-promote 正确终止；无自动 promotion；重启不重复 Trial |
| S6 operator convergence | HTTP/MCP/OpenClaw 复用 owner ports | auth、approval、rate limit、audit；关闭入口不影响 runtime |
| S7 live cutover | 按 job 逐项开放 authority | shadow soak、reconcile、kill/restart、backup/restore、canary live-small 全通过 |

每个切片独立提交、验证和回滚。S2 不等待 LLM；S4 不等待 OpenClaw；S7 不因“所有进程能启动”自动成立。

## 10. 完成定义

- 一台干净服务器可从版本化配置和 secret facility 启动全部长期进程，无需保持 Agent 会话。
- 行情、快慢轨、active-plan watch、R&D、forward、review 和 hygiene 各按自身触发现实运行。
- 每个任务都能回答 owner、输入 refs、deadline/budget、idempotency、状态、结果与终止原因。
- LLM 只产生 typed proposal；确定性 owner 决定是否接受、记录或执行。
- 任一进程崩溃、主机重启、API/LLM/L2/DB 部分故障都不会产生双写、静默 continuity 或绕过风险门。
- 数据库与被引用 artifact 可一起备份恢复；恢复后 projection、lease、task 和 evidence 引用可校验。
- operator API、MCP、OpenClaw 全部离线时，既有安全运行和保守降级仍成立。
- live write 只能由逐 job cutover 明确开启，且始终经过现有 [Event and Flow Contract](../../runtime/event-flow-contract.md)、[Execution Tool Contract](../../runtime/execution-tool-contract.md) 与 preflight authority。
