# 可观测性接入指南

## 目标

本指南适用于各 Owner 与节点的可观测性接入；供应商、传输、存储和 Dashboard 的独立性要求见[Observability 架构](../architecture/observability/)。

原则很简单：Owner 持久化业务事实，Observability 持久化运行副本和投影。即使 Observability 消失，Owner 正确性和 Recovery 义务也不能改变。

## 最小接入

1. 复用原生与容器日志，绑定实际任务或运行身份，记录错误和终态；用户事后检查、修复并部署。
2. Dashboard 从所属服务读取已准入事实，明确未知、过时或不可用，不从日志推断业务完成。
3. 只有具体需求需要集中追踪、聚合或通知时，才复用 collector 与可替换适配器；按实际消费定义字段、脱敏与保留。
4. 已提交事件若用于跨服务唤醒，仍与来源事实原子保管，并按稳定身份去重；通知成功不证明业务转换。

不要求每个操作都建立 span、计时指标、全套遥测表或投影。秘密和 Qualification 保护证据不能进入日志、标签、通知或共享追踪；观测关闭不能改变业务状态或恢复义务。

## Owner 持久化与 Dashboard 矩阵

| Owner               | 权威记录                                                           | Dashboard 投影                                                                                                                            |
| ------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| R&D                 | 项目、来源、Strategy 包、实验、结果引用及 Agent 说明               | 项目进度、准确实验与结果引用、失败信息及 Agent 解释                                                                                       |
| Backtest            | replay request、exploratory/protected result 与 diagnosis          | 探索运行的用途、终态、耗时、成本、容量与实际错误；保护运行只显示公共终态、类型不透明且不可解引用的 reference 与 source‑frontier freshness |
| Qualification       | intake、保护评估、attempt disposition、Eligibility                 | 只按公共终态计数：`QUALIFIED`/`CLOSED_NOT_QUALIFIED`/expiry/revocation                                                                    |
| Market Data         | source binding、PIT snapshot、stream、correction 与 valuation fact | 来源新鲜度、缺口、修订、权利/语义拒绝、provider 时延                                                                                      |
| Strategy Governance | registry、lifecycle、allocation 与 authorized generation decision  | 当前部署 generation、开始/停止时间、活跃时长、pause/retire/resume 与资金变化                                                              |
| Runtime             | application、readiness、checkpoint 与 incident fact                | 当前应用 generation、uptime/downtime、重启、incident 与使用时长                                                                           |
| Risk                | decision/reservation、aggregate commitment、fence 与 closure       | allow/reject/decrease‑only、reservation 时延、liability、fence 与持续时间                                                                 |
| Execution           | journal、command、order/fill/readback、account 与 Recovery fact    | attempt、order、fill、adapter 时延、unknown effect、drift 与恢复时长                                                                      |
| Portfolio           | performance、exposure、capacity、interaction 与 lifecycle evidence | PnL/drawdown、exposure、capacity、interaction degradation 与证据新鲜度                                                                    |

计数必须由不可变身份和明确状态推导，不能维护一个脱离事实的可变计数器。例如策略使用次数来自不同 applied-generation 或 invocation fact，downtime 来自同一 clock epoch 下成对的 readiness/incident 区间。

Backtest disclosure 有意保持不对称。 探索投影可以暴露 diagnostic category set；保护投影只能暴露 公共终态 `CLOSED_NOT_QUALIFIED` 或
`QUALIFIED`、类型不透明且不可解引用的 result reference 与 source-frontier freshness。 保护 phase、run latency、terminal
timing 与 timing-derived field 明确禁止公开。

绝不能按保护 diagnostic category、内部终态 disposition 或 负面原因做 group filter label count alert health score 或填充 research
funnel。

所有负面终态共享同一个 公共 outcome 与 aggregate label：`REPLAY_REJECTED` `REPLAY_INVALID` `DIAGNOSTIC_INVALID`
`DIAGNOSTIC_UNRESOLVED` `ASSESSMENT_INVALID` 和 `INELIGIBLE` 都以字节等价方式归一为
`CLOSED_NOT_QUALIFIED`，`QUALIFIED` 保持准确。 通知不得发出内部 `INELIGIBLE` 或其他保护终态 事件，使保护失败在
Qualification 外保持不可区分。

## 存储边界

任务、结果、错误与运行事实仍由所属服务持久化；现有日志设施按访问权限与保留政策保管运行日志。
不为观测预设遥测表、研究漏斗或生命周期镜像数据库。需要缓存已接纳只读视图时，保存来源引用与新鲜度；它可重建，不能替代或修改来源事实。大型结果通过所属服务的准确引用读取，不复制进日志。

## 中间件与失败语义

使用 transactional outbox 或等价的原子来源事实发布边界。事件至少投递一次。Projection consumer 必须幂等，检测同一身份下内容变化，维护 checkpoint，并隔离 poison record。Backpressure 必须有界；过载可以按策略延迟或丢弃遥测，但不能静默丢弃已接纳业务事实或 Recovery 义务。

OTLP receiver、processor 与 exporter 都可替换。Collector 可以 batch、retry、sample、redact 和 fan-out，但不能把 secret 导入属性，也不能调用 Owner write API。告警适配器订阅受限 projection 或已提交事件提示，并保持在正确性路径之外。

## 按已接入能力验收

只验证实际接入的观测能力；没有 collector、投影或告警时不要求搭建它们来运行对应测试。秘密/保护隔离、来源事实权威和业务不依赖遥测的检查始终适用。

- 关闭 collector，证明原生 Owner 场景仍达到相同权威终态。
- 在事实提交与发布之间 crash，证明同事务 outbox 最终重新发布且不复制事实。
- 同一事件重放两次只产生一个投影；同一身份内容改变必须隔离。
- 丢失、延迟、乱序 telemetry 时，Dashboard 标记 incomplete 或 stale，不能编造健康。
- 从引用的来源 frontier 重建每个 projection，并比较结果摘要。
- 注入 secret、保护细节、超大 payload 与高 cardinality label，证明出口前拒绝。
- 验证探索 diagnostic aggregate 仍可用，同时保护 category label 与全部 category-derived aggregate 在
  Dashboard metric alert 和 research funnel 中被拒绝或不存在。
- 点击 Dashboard action 时，证明它创建新的受治理 Product Edge 请求，而不是写 projection。
