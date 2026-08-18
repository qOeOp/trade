# Observability

## 职责

Observability 是不拥有业务事实的运行观测边界，统一处理 trace、metric、log、全局状态投影和告警路由。它让整个系统可诊断，但不会成为 Research、Qualification、生命周期、账户、订单、风险或恢复事实的第二写入者。

可见模块为 Telemetry Gateway、Status Projection、Alert Routing 与 Dashboard API。Telegram 是 Alert Routing 的默认适配器，不是顶层权威。

## 两条独立信号通道

已提交领域事件和运行遥测不能混用权威语义。

- **已提交领域事件** 只能在原生 Owner 同一事务提交业务事实与 outbox 后产生。Event Rail 提供至少一次唤醒投递，消费者按稳定事件身份去重，再从来源 Owner 读取事实。
- **Trace、metric 与 log** 通过 OTLP 进入 Telemetry Gateway。采集策略可插拔、有版本、可独立开关、可采样、限制 cardinality 并在出口前脱敏。遥测丢失只降低可见性，不能改变原生 Owner 的正确性或业务状态。

命令和未提交请求仍走 Owner 端口。Event Rail 不是命令总线，Telemetry Gateway 也不是业务工作流引擎。

## 规范 envelope 与 trace context

每条已接纳记录必须绑定 schema 版本、信号类型、来源 Owner 与 node、事件或 observation 身份、correlation 与 causation 身份、idempotency key、trace/span/parent-span 身份、适用的 strategy/generation/artifact/TrialFamily/account/scope/mode 命名空间、相关四时间与 clock epoch、有界 outcome/error category、payload digest/reference、redaction class 与采集策略版本。

已提交事件还必须绑定准确且不可变的 Owner 事实引用与内容摘要。Trace context 只用于关联，不得携带 credential、Qualification 保护证据、principal 权威或 effect 权限。

## 持久化模型

物理基础设施可以共享，但逻辑 schema、写凭据、保留和删除必须按权威与披露类别隔离。

| 逻辑存储                                                             | 写入者                      | 用途                                                            |
| -------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------- |
| Owner fact store                                                     | 仅原生 Owner                | 不可变或版本化业务事实与原生回执                                |
| Owner outbox                                                         | 原生 Owner 与事实同事务写入 | 事实身份、事件类型、sequence、payload digest 与发布状态         |
| telemetry record / trace span / log record / metric sample 与 rollup | Observability 托管          | 有界保留的脱敏运行信号                                          |
| owner health / strategy lifecycle / research funnel projection       | Status Projection           | 带来源 frontier、新鲜度、完整性、lag 与 checkpoint 的可重建视图 |
| quarantine 与 dead letter                                            | Observability 托管          | 不含秘密 payload 的非法、未知或耗尽投递身份                     |
| alert delivery                                                       | Alert Routing               | delivered、suppressed、failed 或 unknown 的适配器 disposition   |

大型 payload 保留在按内容寻址的对象存储中，只通过 digest 引用与披露策略访问。Dashboard 记录永远不能成为业务事实的唯一副本。

## Global Status View

Dashboard API 提供受限的只读 Global Status View。它可以按 disclosure class 汇总 R&D 使用的数据来源与
迭代历史、Backtest 运行、Qualification 结果、Market Data 新鲜度、Scanner proposal、活跃 generation、
Runtime uptime 与 incident、Risk reservation/fence、Execution order/fill/unknown effect，以及 Portfolio
exposure/performance/capacity。探索 Backtest 投影可以包含 diagnostic category set；保护投影只能包含
公共终态 `CLOSED_NOT_QUALIFIED` 或 `QUALIFIED`、类型不透明且不可解引用的 result reference 和
source-frontier freshness。保护 phase、latency、terminal timing 与 timing-derived field 明确禁止公开。
内部 replay、diagnostic、assessment、ineligibility disposition 及
全部 category/reason-derived aggregate 必须不可区分且只由 Qualification 持有。准确而言，
`REPLAY_REJECTED` `REPLAY_INVALID` `DIAGNOSTIC_INVALID` `DIAGNOSTIC_UNRESOLVED` `ASSESSMENT_INVALID` 与
`INELIGIBLE` 都以字节等价方式投影为 `CLOSED_NOT_QUALIFIED`，`QUALIFIED` 保持准确。Event Rail 永不
发布内部 `INELIGIBLE` 或其他保护终态事件。

每个字段都引用来源 Owner 事实或 telemetry frontier，并显示 `observed-at`、`valid-through`、完整性、lag 与重建状态。`STALE`、`PARTIAL`、`REBUILDING`、`UNAVAILABLE` 必须明确显示，不能伪装成健康或完整。Dashboard 上触发变更的操作必须另行发起并接纳 Product Edge → Owner 请求，绝不能直接写入视图。

展示 Product Edge 旅程不会让 Observability 成为产品闭环 Owner。它可以标注 Research 阶段、运行进度
或失败诊断，但不能保存权威工作流阶段、创建 Iteration Decision、推进 Qualification、选择后继，或从
遥测推断完成。产品闭环仍由原生 Owner 请求、回执和有界投影组合而成。

## 告警路由

Alert Routing 消费受限 Event Wake 或策略已接纳的健康条件，再发送到 Telegram 或其他可替换适配器。它只拥有投递偏好、attempt 与 receipt。投递成功、静默、重复或失败都不能证明来源转换、解除围栏、重试未知订单效果、恢复策略或宣告 `KNOWN_CLOSED`。

## 实现验收

- Observability 可以关闭、降级、重启或替换，不改变 Owner 转换。
- 来源事实与 outbox 原子提交；未提交 telemetry 不得创建领域事件。
- 事件至少投递一次，projection consumer 必须幂等；架构不宣称 exactly-once。
- 非法 schema、同一身份下内容变化、保护细节、秘密或无限 cardinality 必须在出口前拒绝或隔离。
- projection 重建保留准确来源 frontier，不能修改或确认它读取的事实。
- 保护 Backtest category、内部终态 disposition 或负面原因不得用于 label group filter count alert health
  score 或 research-funnel projection。六种负面终态 `REPLAY_REJECTED` `REPLAY_INVALID`
  `DIAGNOSTIC_INVALID` `DIAGNOSTIC_UNRESOLVED` `ASSESSMENT_INVALID` 与 `INELIGIBLE` 必须相同地映射为
  `CLOSED_NOT_QUALIFIED`；`QUALIFIED` 保持准确，探索 category 在有界 policy 下仍可观测。
- Dashboard 与告警适配器保持只读，任何变更都必须先由独立的受治理 Owner 请求接纳。
