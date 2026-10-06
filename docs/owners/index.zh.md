# Owner 契约

本目录定义全局架构 Flow 投影出的产品级权威边界。内容刻意停留在类 API 进程和存储选择之上。未来实现可以替换这些细节，但在先修改架构契约之前，必须保留这里的 Owner 事实交接和禁止事项。

产品有六组职责和九个业务 Owner。Native Trading Node 汇集 Runtime、Risk、Execution 和 Portfolio，其余五组各有一个 Owner。视觉分组不等于服务进程。Product Edge 是客户端边界，Strategy Factory 描述策略价值流，Event Rail 和 Observability 属于基础设施。R&D 拥有 Research、Develop、知识与按需发现。客户端接口与交付路线见[服务蓝图](../architecture/)。

## 生命周期

1. [Market Data](./market-data/) 提供时点正确的市场事实和标的事实。
2. [R&D](./rd/) 把带来源假设转化为冻结意图和不可变策略工件，按冻结研究规则记录有界修复及后继。
3. [Backtest](./backtest/) 为探索或保护评估产出规范重放证据。
4. [Qualification](./qualification/) 独立授予或撤销可部署资格，保护结果不得反馈同一研发循环。
5. [Strategy Governance](./strategy-governance/) 拥有部署决定 生命周期状态和资金政策。
6. [Runtime](./runtime/) 运行已激活策略实例，是正常交易意图的唯一写入者。
7. [Risk](./risk/) 为每个意图独立返回明确终态决定和一次性预留。
8. [Execution](./execution/) 独占订单 外部效果 场所回读和对账。
9. [Portfolio](./portfolio/) 从执行事实和估值输入投影账户 暴露 表现和容量事实。

## 系统不变量

- 每种可变业务事实只有一个权威 Owner。
- R&D 与 Qualification 在保护边界保持单向，保护结果不能用于调优本次候选；Backtest 只生产证据，不拥有 R&D 决策。
- Paper 与 Live 共享 Runtime Risk Execution 语义，只替换 Execution Adapter。
- Runtime 只有绑定同一 Risk Decision 和 Reservation 后才能向 Execution 发出命令。
- R&D 发现只读；运行策略持续判断行情，Governance 直接判定冻结生命周期条件。发现请求与结果归 R&D，发现本身不授予上线权威。
- Event Rail 只传播已提交事实的唤醒提示，不承担审批 重试 恢复或终态权威。
- Recovery 只允许带围栏的撤销 减仓 清仓和回读。写入 `RecoveryCase.KNOWN_CLOSED` 前始终禁止新增风险，之后 Governance 只能授权新 generation，Runtime 还必须单独证明 `APPLIED`。

## 兼容参考

[Scanner 边界](./scanner/)保留封存协议与拒绝含义；按需发现属于 R&D，不新增业务部门。
