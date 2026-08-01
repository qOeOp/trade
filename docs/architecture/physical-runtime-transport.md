---
title: Physical Runtime and Transport Decision
role: architecture-decision
status: active
owner: architecture
last_verified: 2026-07-30 CST
---

# 物理 Runtime 与 Transport 决策

## 1. 决策

十个顶层 domain 是 authority 边界，不是一域一服务的部署清单。当前基线保持单节点模块化 runtime；只把已经由故障隔离、生命周期、吞吐或 credential 边界证明需要独立运行的能力拆成进程。服务数量、容器数量和 broker 产品均不预先固定。

`protocol-fabric` 定义 rail、interaction、route ACL 与 envelope；`domain-bus` 将 inbox / outbox envelope 写入 `ops_runtime_store`，用于控制面审计和 incident，不负责 worker dispatch、subscriber offset、ack / retry / DLQ、热流 backpressure 或大 payload 搬运。它是 logical bus adapter，不是物理 broker。

语言按内聚 runtime plane 选择，不按 message、tool 或 handler 逐个选择：

| Runtime plane | 默认语言 | 当前边界 |
| --- | --- | --- |
| control / owner plane | TypeScript / Bun | orchestration、policy、decision、execution control、exchange facade、governance、artifact metadata、Research Control Plane |
| public market hot plane | Rust | L2 collect、sequence / gap、book、raw segment、compaction、bounded read port |
| certified research execution | TypeScript / Bun | Replay、Trial、authority、state machine 与回归资产不重写 |
| offline analytics / independent oracle | Python | 只读 ref、产 artifact；不持有 scheduler、owner store、risk 或 live execution authority |
| existing deterministic indicator plane | Go | 保留已闭合模块；不为语言统一重写，也不扩展成通用 control runtime |

## 2. 物理通信类别

| Class | 适用交互 | 当前 transport | Durable truth | 约束 |
| --- | --- | --- | --- | --- |
| owner request | `query / command` | fixed CLI、subprocess、local HTTP / gRPC owner port | owner store 或 command ledger | caller 持有 deadline、cancellation、retry；target 单一 |
| durable control message | `command / result / authorization / fact` | owner write + ops envelope audit；需要解耦时再加 outbox / inbox adapter | producing owner store | at-least-once only；consumer 以 semantic id 幂等 |
| immutable reference | `ref / fact / result` | content-addressed file / artifact / manifest ref | owner artifact/store | bus 不复制大 payload；ref 不授予物理 store 权限 |
| hot stream | 高频 `fact` | bounded channel、Rust service port、raw segment | raw segment + epoch manifest | continuity、watermark、backpressure 显式；不逐条写 SQLite bus |
| control audit | 任意 interaction 的 envelope | `domain-bus` → `ops_runtime_store` | ops audit only | 不冒充 delivery、business fact 或 execution authority |

## 3. Canonical Message / Route Matrix

SLO 使用语义边界，不虚构尚无 workload 证据的固定 QPS 或毫秒阈值。具体 deadline、freshness 和 retention 由 owner contract / profile 冻结。

| Route | Publisher → consumer | Interaction / payload | Timeliness | Delivery / ordering / replay | 当前物理路径 | 升级门 |
| --- | --- | --- | --- | --- | --- | --- |
| job dispatch | orchestration → target domain | `command`；ticket、scope、input refs | cycle / job deadline 内 | target 单一；job identity 幂等；ops ledger 可审计 | program job graph → fixed owner command | 多节点 timer/signal、部署中任务续跑超出现有 lease/store 能力才评审 durable workflow transport |
| job result | target domain → orchestration | `result`；status、output refs、effects、incident refs | job deadline 内 | 关联 command；terminal 不得倒退；可从 owner result 重读 | owner response + ops store | 独立 worker 需要异步 completion / retry 时增加 durable result inbox |
| health / safe mode | orchestration → policy / execution / write gate | `fact`；health、lock、suspension ref | freshness-bound | 最新有效事实；stale fail closed；保留 incident history | owner query + ops store | 跨节点 health consumer 出现后评审 fan-out transport；不以 broker heartbeat 代替 owner readiness |
| runtime policy | policy → decision / execution / exchange gate | `authorization`；policy hash、account scope、expiry | 必须在 expiry 内 | version / issue time 单调；deny wins；可审计不可延长 | policy owner port / typed payload | 多实例 consumer 需要独立 replay offset 时增加 durable authorization topic |
| market snapshot / feature | market data → decision / execution | `fact / ref`；snapshot、feature、watermark | freshness-bound | symbol / source watermark 有序；旧值可被更新但不可标 fresh | owner read / manifest ref | 多消费者、跨主机 cache 或 owner port 成为证实瓶颈后增加 snapshot stream |
| public L2 hot updates | Rust L2 owner → bounded consumers | 高频 `fact`；sequence、book delta / projection | hot-path bounded lag | epoch 内严格 sequence；gap/resync 显式；raw 可 replay | bounded channel / gRPC watch + TL2S raw segment | 多独立 consumer、独立 offset、ack / retry / DLQ 或单机 port 瓶颈成立后评审 broker |
| dataset lineage | market data → research / artifact | `ref`；immutable slice、manifest、hash、coverage | batch deadline 内 | content-addressed；create-or-identical；完整回放 | owner CLI + immutable file ref | 跨节点 artifact store 成立后替换 locator adapter，不改变 ref 语义 |
| account facts | exchange → decision / execution / reconcile | `fact / ref`；balance、margin、position、order、fill、as-of | live preflight freshness-bound | account scope 内因果可解释；stale/unknown fail closed | fixed exchange owner query + snapshot ref | private stream 成为权威来源且多 consumer 成立后增加 account-event stream |
| action intent | decision → execution | `intent`；DecisionInput / plan / proposal refs、expiry | 必须在 expiry 内 | intent identity 幂等；可 supersede；不是 authorization | same-domain build + execution owner handoff | decision 与 execution 独立部署且存在 durable backlog 后增加 bounded intent inbox |
| privileged exchange command | execution → exchange | `command`；capability ref、bounded action、idempotency | capability / fact freshness 内 | account / client-order identity 幂等；不得自动扩大效果 | owner tool → router → write gate → adapter | 独立 exchange service 部署时采用 authenticated request port 或 durable command inbox；不共享 credential |
| exchange result / confirmation | exchange → execution | `result / fact`；accepted、rejected、unknown、confirmed refs | command deadline + reconcile window | command-correlated；unknown 不得当 confirmed；可重查 | exchange runtime ledger + confirmation owner | async venue lifecycle 成为主路径时增加 account-scoped ordered result stream |
| event / reconcile proposal | execution → portfolio state | `fact / command`；event envelope、source / confirmation refs | state convergence deadline 内 | flow / event key 幂等；owner append-only；可 replay | event-store owner port | writer 跨进程且 crash window 需要原子投递时采用 transactional outbox / inbox |
| state projection | portfolio state → decision / execution / governance | `query / ref`；flow、exposure、risk lock、closed-flow refs | consumer freshness-bound | event-derived；projection 可重建；risk lock 不得丢 | flow-projector owner query | 多独立读者形成负载证据后增加 read-model service/cache，不复制写 authority |
| research evidence | research → governance / artifact | `ref / fact`；Trial、Result、Forward、candidate refs | batch / review deadline 内 | immutable evidence；lineage 完整；可 replay | owner store + artifact refs | 分布式 worker 需要独立 work offset 后增加 research queue；Result 仍由 Control Plane 接纳 |
| lifecycle / policy feedback | governance → research / policy | `authorization / result / intent`；reject、revise、promote、feedback | review cadence 内 | decision append-only；feedback 不能直接发布 runtime policy | governance owner port + refs | 独立 governance runtime 出现 durable backlog 后增加 inbox；promotion authority 不迁入 broker |
| Agent Run control | program → Agent Host | `command / result`；task、refs、budget、approval、terminal result | bounded semantic deadline | request identity 幂等；Host session 不承载业务事实 | 当前未装配；本机 Codex 仅人工交互 | 远程 Host 采用后使用受认证 Host RPC；未确认 side effect 保持 blocked |
| Agent capability call | Agent Host → owner | `query / command`；allowlisted MCP capability | tool deadline 内 | tool request identity + owner semantic id；结果需 validator | 当前本机 stdio `agent.mcp` | 跨容器时增加私网 Streamable HTTP MCP adapter；不挂 owner DB、不公开公网 |
| artifact register / query | producer / consumer ↔ artifact | `command / query / ref`；hash、owner、lineage、retention | batch deadline 内 | create-or-identical；query 无写 authority；可 replay | artifact owner port | remote artifact/catalog 采用后替换 port adapter；payload 继续留在 artifact store |
| notification | orchestration → external channel | `command / result`；severity、template、audit ref | incident policy deadline 内 | bounded retry；不可阻塞业务终态；attempt 可审计 | notify owner adapter + ops ledger | 多 channel / rate-limit backlog 成立后可用独立 queue；通知失败不改变交易事实 |

## 4. Delivery Invariants

- 不承诺 transport-level exactly-once；producer / consumer 以 `message_id`、domain semantic id、event key、client order id 或 artifact hash 实现幂等。
- `accepted / acked` 只表示接纳，不表示业务完成；terminal `result` 必须关联原 command，`unknown` 必须进入查询或 reconcile。
- 顺序只在明确 scope 内成立：L2 epoch/sequence、account/order、flow/event、policy version、job attempt。不得创造全局总序。
- producer store 与 outbox 若不能原子提交，则不得宣称可靠投递；引入 broker 前必须先设计 owner-side transactional outbox / inbox。
- retry 不能延长 authorization、capability、intent 或 market/account fact 的 expiry / freshness；过期消息终止而不是重新授权。
- 大 payload 留在 owner artifact/raw store；message 只携带 schema、hash、coverage、watermark、size 与 ref。
- schema 使用兼容版本和 typed failure；自然语言日志、stderr、HTTP status 或 broker metadata 不作为业务 authority。
- credential 只存在于 owning adapter / secret facility；不进入 message、artifact、trace、DLQ 或 replay archive。

## 5. Deployment Boundary Gate

模块只有满足至少一项真实约束，并完成 owner / state / failure 验证后才成为独立 service：

1. throughput、tail latency、CPU / memory 或连接数需要独立扩缩容；
2. crash / restart 必须与控制面、交易面或其他数据面隔离；
3. credential、网络 ACL 或真钱 side effect 要求独立 trust boundary；
4. resident stream、short request、scheduled batch 的生命周期无法由同一 process authority 安全承载；
5. 跨主机部署或多个独立 consumer 已成为实际需求；
6. owner port 的 profile / soak 证明它是瓶颈，而不是凭架构偏好推测。

拆分后仍保持一个事实一个 owner。禁止一 tool 一服务、J01–J07 一 job 一服务、consumer 直连 owner DB、跨服务共享可写表、同步分布式事务或 broker 成为业务 authority。

## 6. 当前 Runtime Projection

| Candidate unit | 当前决定 | 说明 |
| --- | --- | --- |
| program / control runtime | 单节点 TypeScript / Bun composition | 复用现有 job graph、lease、owner ports；不逐 tool 网络化 |
| public L2 data plane | 独立 Rust service，`active-partial` | 已由资源、连续性、crash recovery 和 bounded read 证据采用；consumer 尚未全面 cutover |
| exchange write boundary | 保持 TypeScript owner chain；可作为下一独立 trust unit 评审 | 拆分依据是 credential / side-effect isolation，不是吞吐；拆前先闭合 authenticated port、idempotency ledger 与 reconcile |
| research workers | owner-controlled isolated process / batch | 可独立耗时运行；Research Control Plane 仍是 Contract / Trial / Result 单写者 |
| governance / artifact / portfolio state | 当前不独立网络服务 | owner store 和调用量尚无拆分证据；先保持 fixed owner port |

## 7. Broker Adoption Gate

满足以下需求后才进入 broker ADR：同一 stream 有多个独立 consumer；consumer 需要独立 replay offset；进程解耦要求 durable ack / retry / DLQ；跨主机部署已批准；现有 owner port 已有瓶颈证据。选择时先冻结 workload、retention、partition key、最大 payload、failure budget 和运维 owner，再比较 NATS JetStream、Kafka / Redpanda 或继续无 broker。

broker 采用不改变 logical rail、interaction、domain owner 或 store authority。`domain-bus` 继续作为 control envelope audit；热 L2 不逐条进入它，broker retention 不替代 raw archive / artifact store，broker “exactly once”不替代 owner-side idempotency。

## 8. 变更合同

新增跨域消息或物理 transport 必须同步：

1. [Communication Map](./architecture-communication-v2.mmd) 与 [Architecture Contract](./design-architecture.md) 的 canonical route；
2. 本文的 route、ordering、delivery、replay、payload 与 adoption gate；
3. `protocol-fabric` schema / ACL、owner `CONTRACT.md`、idempotency 与 failure tests；
4. 若采用新 service / broker / runtime language，新增 ADR、部署 profile、health、shutdown、recovery、telemetry 与回滚证据；
5. 按 [Quality Contract](../engineering/code-quality.md) 运行受影响 package 与 consumer 的公开检查接口；全仓 closure 由交付端点决定。
