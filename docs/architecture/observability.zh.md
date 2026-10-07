# Observability

## 职责

Observability 是不拥有业务事实的运行观测边界，统一处理 trace、metric、log、全局状态投影和告警路由。它让整个系统可诊断，但不会成为 Research、Qualification、生命周期、账户、订单、风险或恢复事实的第二写入者。

先使用 Nautilus/服务自身日志、容器日志与任务终态，保留可定位的错误供用户检查和部署修复。Dashboard 直接读取所属服务的获准事实。无需先建设独立遥测网关、全局状态数据库或告警系统。只有具体运行需求需要跨进程追踪、聚合或通知时，才接入现成 collector、受限投影或通知适配器；这些是基础设施能力，不增加业务部门。

## 两条独立信号通道

已提交领域事件和运行遥测不能混用权威语义。

- **已提交领域事件** 只能在原生 Owner 同一事务提交业务事实与 outbox 后产生。来源服务保管 outbox 与发布进度，通过原生消息扩展点或现有传输提供至少一次通知；消费者按稳定事件身份去重，再从来源 Owner 读取事实。
- **Trace、metric 与 log** 优先使用原生记录；需要集中采集时再通过 OTLP 接入现成 collector。采集策略可插拔、有版本、可独立开关、可采样、限制 cardinality 并在出口前脱敏。遥测丢失只降低可见性，不能改变原生 Owner 的正确性或业务状态。

命令和未提交请求仍走 Owner 端口。通知只能提示事实变化，不能作为业务命令。原生 MessageBus 的进程内投递不等于持久跨服务投递；需要后者时由来源服务恢复 outbox 发布，不新增通知服务。

## 规范 envelope 与 trace context

结构化跨服务观测接口的记录按实际消费契约绑定 schema 版本、信号类型、来源 Owner 与 node、事件或 observation 身份、correlation 与 causation 身份、idempotency key、trace/span/parent-span 身份、适用的 strategy/generation/artifact/TrialFamily/account/scope/mode 命名空间、相关四时间与 clock epoch、有界 outcome/error category、payload digest/reference、redaction class 与采集策略版本。

已提交事件还必须绑定准确且不可变的 Owner 事实引用与内容摘要。Trace context 只用于关联，不得携带 credential、Qualification 保护证据、principal 权威或 effect 权限。

## 持久化模型

普通运行日志不要求填写与其无关的账户、策略、时钟或 span 字段，也不要求每条日志生成业务回执。涉及状态或权限的消费仍使用来源服务事实。

下表说明所需能力的权限归属，不要求建立全部表或部署组件。日志由现有运行设施保管；只有已接纳的投影/通知消费者需要时才增加其存储。物理基础设施可以共享，但写凭据、保留和删除按权威与披露类别隔离。

| 逻辑存储                                                             | 写入者                      | 用途                                                            |
| -------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------- |
| Owner fact store                                                     | 仅原生 Owner                | 不可变或版本化业务事实与原生回执                                |
| Owner outbox                                                         | 原生 Owner 与事实同事务写入 | 事实身份、事件类型、sequence、payload digest 与发布状态         |
| telemetry record / trace span / log record / metric sample 与 rollup | Observability 托管          | 有界保留的脱敏运行信号                                          |
| owner health / strategy lifecycle / research funnel projection       | Status Projection           | 带来源 frontier、新鲜度、完整性、lag 与 checkpoint 的可重建视图 |
| quarantine 与 dead letter                                            | Observability 托管          | 不含秘密 payload 的非法、未知或耗尽投递身份                     |
| alert delivery                                                       | Alert Routing               | delivered、suppressed、failed 或 unknown 的适配器 disposition   |

需要保管的大型业务结果仍由所属服务提供准确引用，运行日志不复制业务 payload，也不为诊断增加新的对象存储。Dashboard 记录永远不能成为业务事实的唯一副本。

## Global Status View

Dashboard API 提供受限的只读 Global Status View。 它可以按 disclosure class 汇总 R&D 使用的数据来源与 迭代历史、Backtest 运行、Qualification
结果、Market Data 新鲜度、R&D 发现覆盖/结果、旧 Scanner 回执、活跃 generation、 Runtime uptime 与 incident、Risk
reservation/fence、Execution order/fill/unknown effect，以及 Portfolio exposure/performance/capacity。

探索 Backtest 投影可以包含 diagnostic category set；保护投影只能包含 公共终态 `CLOSED_NOT_QUALIFIED` 或
`QUALIFIED`、类型不透明且不可解引用的 result reference 和 source-frontier freshness。 保护 phase、latency、terminal
timing 与 timing-derived field 明确禁止公开。

内部 replay、diagnostic、assessment、ineligibility disposition 及 全部 category/reason-derived aggregate 必须不可区分且只由
Qualification 持有。 准确而言， `REPLAY_REJECTED` `REPLAY_INVALID` `DIAGNOSTIC_INVALID` `DIAGNOSTIC_UNRESOLVED`
`ASSESSMENT_INVALID` 与 `INELIGIBLE` 都以字节等价方式投影为 `CLOSED_NOT_QUALIFIED`，`QUALIFIED` 保持准确。

通知不得发布内部 `INELIGIBLE` 或其他保护终态事件。

每个字段都引用来源 Owner 事实或 telemetry frontier，并显示 `observed-at`、`valid-through`、完整性、lag 与重建状态。`STALE`、`PARTIAL`、`REBUILDING`、`UNAVAILABLE` 必须明确显示，不能伪装成健康或完整。Dashboard 上触发变更的操作必须另行发起并接纳 Product Edge → Owner 请求，绝不能直接写入视图。

展示 Product Edge 旅程不会让 Observability 成为产品闭环 Owner。它可以标注 Research 阶段、运行进度
或失败诊断，但不能保存权威工作流阶段、创建 Iteration Decision、推进 Qualification、选择后继，或从
遥测推断完成。产品闭环仍由原生 Owner 请求、回执和有界投影组合而成。

## 已提交事实的通知

通知只携带稳定身份、来源 Owner、已提交事实引用与必要顺序。Governance 被唤醒后直接读取 Qualification、Runtime 或 Execution 事实；没有通知也不能推断没有事故或已经恢复。通知或告警的重试只重投同一提示，不重放业务写入。通知丢失不能改变 Owner 状态。告警投递回执是输出，不能反过来充当来源事件或事实。

Qualification 通知只包含公共 attempt correlation、公共状态、effective cut、sequence 和类型不透明且不可解引用的 reference。相同公共输入的负面结果在事件是否存在及这些字段上均不可区分；消费者按这些公共字段去重。保护指标、内部类别、终态时间及其派生信息均不得进入通知。

## 告警路由

需要通知时，现成告警组件消费受限 已提交事件提示 或已接纳的健康条件，再发送到用户选择的可替换适配器，不设产品默认通知渠道。它只拥有投递偏好、attempt 与 receipt。投递成功、静默、重复或失败都不能证明来源转换、解除围栏、重试未知订单效果、恢复策略或宣告 `KNOWN_CLOSED`。

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
