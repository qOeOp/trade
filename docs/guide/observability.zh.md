# 可观测性接入指南

## 目标

本指南把一个 Owner 或 node 接入可诊断体系，但不把它耦合到单一 vendor、broker、数据库或 Dashboard。它适用于 R&D、Market Data、Backtest、Qualification、Scanner、Strategy Governance、Runtime、Risk、Execution 与 Portfolio。

原则很简单：Owner 持久化业务事实，Observability 持久化运行副本和投影。即使 Observability 消失，Owner 正确性和 Recovery 义务也不能改变。

## 接入顺序

1. 明确被观测的原生 Owner 事实、命令或未终结 operation。
2. 只有已提交事实可以选择 `COMMITTED_DOMAIN_EVENT`，其他情况选择 `TRACE`、`METRIC` 或 `LOG`。
3. 在进程边界绑定规范 envelope 与兼容 W3C 的 trace context。
4. 校验采集策略版本、来源 scope、cardinality budget、redaction class 与 retention。
5. 领域事件与来源事实同事务写 outbox；普通遥测发送到本地 OTLP endpoint。
6. Gateway 在不阻塞 Owner 事务的前提下校验、脱敏、采样、batch 与 export。
7. 按稳定身份幂等投影，并保存来源 frontier 与 lag 的 checkpoint。
8. Dashboard 与告警必须如实显示 stale、partial、rebuilding、quarantined 或 unavailable。

## 每个 Owner node 的最小埋点

每个已接纳 operation 创建一个 root span 或加入传入 trace，使用稳定 correlation 与 causation 身份，记录 queue/admission/processing/result 时延，并产生一个有界终态或明确 unknown。Metric 必须有命名单位、聚合、窗口与有限 label 集。Log 是结构化记录，不是自由文本业务数据库。

API key、opaque credential value、Qualification 保护证据、原始 prompt/source body、账户秘密和无限制订单 payload 绝不能进入 trace attribute、metric label、log、Event Rail 或告警消息。

## Owner 持久化与 Dashboard 矩阵

| Owner               | 权威记录                                                           | Dashboard 投影                                                                                                                            |
| ------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| R&D                 | source provenance、Research Intent、Artifact、迭代与选择           | 使用来源、假设、开发尝试、失败原因、到选中版本的迭代次数、D-only repair 历史                                                              |
| Backtest            | replay request、exploratory/protected result 与 diagnosis          | 探索运行的用途、终态、耗时、成本、容量与诊断分布；保护运行只显示公共终态、类型不透明且不可解引用的 reference 与 source-frontier freshness |
| Qualification       | intake、保护评估、attempt disposition、Eligibility                 | 只按公共终态计数：`QUALIFIED`/`CLOSED_NOT_QUALIFIED`/expiry/revocation                                                                    |
| Market Data         | source binding、PIT snapshot、stream、correction 与 valuation fact | 来源新鲜度、缺口、修订、权利/语义拒绝、provider 时延                                                                                      |
| Scanner             | due-slot attempt、逐策略 disposition、receipt、proposal            | 调度次数、扫描候选、matched/failed、proposal 与时延                                                                                       |
| Strategy Governance | registry、lifecycle、allocation 与 authorized generation decision  | 当前部署 generation、开始/停止时间、活跃时长、pause/retire/resume 与资金变化                                                              |
| Runtime             | application、readiness、checkpoint 与 incident fact                | 当前应用 generation、uptime/downtime、重启、incident 与使用时长                                                                           |
| Risk                | decision/reservation、aggregate commitment、fence 与 closure       | allow/reject/decrease-only、reservation 时延、liability、fence 与持续时间                                                                 |
| Execution           | journal、command、order/fill/readback、account 与 Recovery fact    | attempt、order、fill、adapter 时延、unknown effect、drift 与恢复时长                                                                      |
| Portfolio           | performance、exposure、capacity、interaction 与 lifecycle evidence | PnL/drawdown、exposure、capacity、interaction degradation 与证据新鲜度                                                                    |

计数必须由不可变身份和明确状态推导，不能维护一个脱离事实的可变计数器。例如策略使用次数来自不同 applied-generation 或 invocation fact，downtime 来自同一 clock epoch 下成对的 readiness/incident 区间。

Backtest disclosure 有意保持不对称。探索投影可以暴露 diagnostic category set；保护投影只能暴露
公共终态 `CLOSED_NOT_QUALIFIED` 或 `QUALIFIED`、类型不透明且不可解引用的 result reference 与
source-frontier freshness。保护 phase、run latency、terminal timing 与 timing-derived field 明确禁止公开。
绝不能按保护 diagnostic category、内部终态 disposition 或
负面原因做 group filter label count alert health score 或填充 research funnel。所有负面终态共享同一个
公共 outcome 与 aggregate label：`REPLAY_REJECTED` `REPLAY_INVALID` `DIAGNOSTIC_INVALID`
`DIAGNOSTIC_UNRESOLVED` `ASSESSMENT_INVALID` 和 `INELIGIBLE` 都以字节等价方式归一为
`CLOSED_NOT_QUALIFIED`，`QUALIFIED` 保持准确。Event Rail 永不发出内部 `INELIGIBLE` 或其他保护终态
事件，使保护失败在 Qualification 外保持不可区分。

## 逻辑数据模型

- Owner store 按原生写权威隔离。每个 Owner 拥有自己的 fact table 与同事务 `owner_outbox`。
- `telemetry_event`、`trace_span`、`log_record`、`metric_sample` 与 `metric_rollup` 是按策略保留的运行存储。
- `owner_health_snapshot`、`strategy_lifecycle_projection` 与 `research_funnel_projection` 是可重建 read model。
- `projection_checkpoint` 绑定 consumer、partition、来源 frontier、schema 版本、observed time、lag 与 rebuild generation。
- `quarantine_record` 只保存身份、有界原因、来源引用与 retry disposition，不保存危险 payload。
- `alert_delivery` 只保存 adapter attempt 与投递 disposition。

契约有意不预选 PostgreSQL、ClickHouse、Kafka、NATS、OpenTelemetry backend 或前端框架。第一版可以使用一套物理数据库和一个 collector，只要 schema 与写凭据仍保留上述逻辑边界。

## 中间件与失败语义

使用 transactional outbox 或等价的原子来源事实发布边界。事件至少投递一次。Projection consumer 必须幂等，检测同一身份下内容变化，维护 checkpoint，并隔离 poison record。Backpressure 必须有界；过载可以按策略延迟或丢弃遥测，但不能静默丢弃已接纳业务事实或 Recovery 义务。

OTLP receiver、processor 与 exporter 都可替换。Collector 可以 batch、retry、sample、redact 和 fan-out，但不能把 secret 导入属性，也不能调用 Owner write API。告警适配器订阅受限 projection 或 Event Wake，并保持在正确性路径之外。

## 验收测试

- 关闭 collector，证明原生 Owner 场景仍达到相同权威终态。
- 在事实提交与发布之间 crash，证明同事务 outbox 最终重新发布且不复制事实。
- 同一事件重放两次只产生一个投影；同一身份内容改变必须隔离。
- 丢失、延迟、乱序 telemetry 时，Dashboard 标记 incomplete 或 stale，不能编造健康。
- 从引用的来源 frontier 重建每个 projection，并比较结果摘要。
- 注入 secret、保护细节、超大 payload 与高 cardinality label，证明出口前拒绝。
- 验证探索 diagnostic aggregate 仍可用，同时保护 category label 与全部 category-derived aggregate 在
  Dashboard metric alert 和 research funnel 中被拒绝或不存在。
- 点击 Dashboard action 时，证明它创建新的受治理 Product Edge 请求，而不是写 projection。
