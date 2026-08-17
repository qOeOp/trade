# 快速开始

最短且安全的产品旅程以完成对账的模拟结果结束，在不产生真实市场效果的前提下展示完整闭环。

## 1. 从可证伪想法开始

通过 Product Edge 提交带来源的假设。R&D 内的 Research 能力在实验前把机制、所需数据、成本与容量假设、
试验族、预算、证伪条件和停止规则冻结为 Research Intent。

## 2. 构建可复现策略工件

R&D 的 Development Sandbox 在隔离研发环境运行生成代码。R&D 发布内容寻址的 Strategy Artifact，
绑定意图、代码、依赖和运行环境版本。Sandbox 无权部署工件。

## 3. 先探索再冻结

独立 Backtest 服务可以把探索事实返回 R&D 开启新一轮迭代。候选冻结后，Qualification 预注册
保护评估规则。保护结果不得反馈同一个 R&D 循环。

## 4. 让策略取得使用资格

Qualification 发布 Eligibility State。只有 Strategy Governance 能决定启动、降权、暂停、
恢复或退役策略，并选择适用的资金政策。资格成立不等于已经启动。
已接受生命周期请求保留 request principal scope 已准入 Shell binding 与 history head Operator
Authorization 和 operation manifest。自动 Paper 交易还必须有显式 `PAPER` Autonomous Policy
Authorization，裸 Governance 决定不够。

## 5. 运行模拟会话

Governance 只授权一个模拟 generation，并不直接启动 Runtime。Runtime 独立应用该决定，只有
Generation Application Receipt 为 `APPLIED` 才证明一个 Strategy Instance 已运行。实例产生 Trade
Intent，Risk 返回 `ALLOW` 和一次性 Reservation，Runtime 再创建绑定同一决定与 Reservation 的
Authorized Order Command。
application intent permit command Effect Journal 和模拟回读必须保留同一 Authorization Lineage 与
Autonomous Policy Authorization。

Execution 先申请占用 Reservation，并等待 Risk 唯一不可变的 `CONSUMED` 结果。之后它持久记录
一个 `PREPARED` attempt，再发送一个 `ADAPTER_ADMISSION_REQUEST`。只有 Risk 返回匹配的
`ADMITTED_ONCE`，Execution 才能先持久化 `INVOCATION_STARTED` 再调用模拟适配器。适配器结果与
权威回读随后推动 Execution Portfolio Risk 闭合，任何确认或超时都不能跳过步骤。

## 6. 闭合证据循环

Execution 在适配器调用后对模拟效果完成对账，并回报结果与结算 lineage。Portfolio 发布匹配的
Capacity View 与 Portfolio Risk Evidence Bundle，覆盖账户 暴露 open order 表现和已纳入 settlement
lineage。只有 Risk 计算当前 usage 与剩余
headroom，并且只有同一经济 lineage 被权威证明无效果或被 Portfolio 投影替换后，才能闭合
Reservation liability。Governance 消费这些已提交事实，做出下一次生命周期决定。

Governance 只有用新鲜必需 Eligibility Performance Exposure degradation 证据显式续期，才能保留
`ACTIVE_GENERATION`。任一证据丢失或过期都进入 `DE_RISK_PENDING` 并阻止新增风险，同时继续
decrease-only 暂停 降权或退役，不等待缺失容量证据。

只有规范输入和结果可追踪、外部效果模型已对账、风险预留进入终态，并且 Portfolio 能解释
最终账户状态时，快速开始才算完成。
