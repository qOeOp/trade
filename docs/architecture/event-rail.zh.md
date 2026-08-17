# Event Rail

## 职责

Event Rail 是唤醒通道和传输托管者，为已提交资格变化 运行事故 订单 成交和对账差异事实生成 Event Rail-owned Event Wake。它保留 wake 身份 来源事实引用 顺序语义和订阅投递。

## 权威边界

来源 Owner 始终保留被引用业务事实的权威。Event Rail 只拥有 Event Wake 传输 record，每个 wake 都绑定该 Owner 与已提交事实身份。Event Rail 与 Observability 只占用 custodian 字段，不能成为业务权威。Event Rail 不拥有审批 业务重试 业务终态 恢复确认 订单生命周期或账户事实。

## 治理用途

事件可以唤醒 Strategy Governance 去读取 Qualification、Runtime 或 Execution 已提交的事实。运行事故事件标识一个已提交 Runtime Incident Fact，对账事件标识一个已提交 Execution Reconciliation Drift Fact。Governance 必须从来源 Owner 直接读取这些事实。Portfolio 事实只通过已建模的 Owner 交接直接读取，Event Rail 不得虚构对应 wake。事件本身不能替代来源事实。

## 通知用途

已提交 Event Wake 可以路由到 Observability。wake 是 Observability 输入；Alert Delivery 是 Alert Routing
输出与回执，不能成为输入或业务事实。Qualification wake 只暴露 `CLOSED_NOT_QUALIFIED` `QUALIFIED`
`EXPIRED` 或 `REVOKED`，且只使用公共 attempt correlation、公共 state、effective cut、sequence 和一个
类型不透明且不可解引用的 reference。`REPLAY_REJECTED` `REPLAY_INVALID` `DIAGNOSTIC_INVALID`
`DIAGNOSTIC_UNRESOLVED` `ASSESSMENT_INVALID` 与 `INELIGIBLE` 六种终态都发出相同归一化
`CLOSED_NOT_QUALIFIED` event 形状；event 是否存在、state、effective cut、opaque-reference class 和
sequence 在六者间都不可区分，绝不发布内部 `INELIGIBLE` event。保护测量 参数 结果 holdout 细节
评估输出 timing difference 与 category-specific reference 绝不进入 Event Rail。投递成功只表示消息
到达，不表示底层业务转换成功。

## 实现验收

Qualification wake 按相同公共 attempt correlation、state、effective cut、opaque reference 与 event
sequence 去重；其他 wake 按稳定 Event Wake 身份去重。wake 或 alert 投递可以重试但不能重放来源业务
写入。通知丢失不能改变任何 Owner 状态。契约校验必须拒绝 Event Rail 或 Observability 出现在业务
权威字段，也必须拒绝把 Alert Delivery 用作 Events → Observability 输入。
