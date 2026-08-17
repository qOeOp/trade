# Owner 契约

本目录定义全局架构 Flow 投影出的产品级权威边界。内容刻意停留在类 API 进程和存储选择之上。未来实现可以替换这些细节，但在先修改架构契约之前，必须保留这里的 Owner 事实交接和禁止事项。

全景图包含十三个 Bento 分组，由十个业务 Owner 加 Product Edge Strategy Factory 和 Observability 组成。Event Rail 是独立通道节点，不是权威。R&D 内含 Research 与 Develop 能力；每个分组仍低于五模块上限。

## 生命周期

1. [Market Data](./market-data/) 提供时点正确的市场事实和标的事实。
2. [R&D](./rd/) 把带来源假设转化为冻结意图和不可变策略工件，并支持有界的有人值守 D-only 修复。
3. [Backtest](./backtest/) 为探索或保护评估产出规范重放证据。
4. [Qualification](./qualification/) 独立授予或撤销可部署资格，保护结果不得反馈同一研发循环。
5. [Strategy Governance](./strategy-governance/) 拥有部署决定 生命周期状态和资金政策。
6. [Scanner](./scanner/) 定时把受治理策略与当前条件匹配并提交提案，永不直接启动策略。
7. [Runtime](./runtime/) 运行已激活策略实例，是正常交易意图的唯一写入者。
8. [Risk](./risk/) 为每个意图独立返回明确终态决定和一次性预留。
9. [Execution](./execution/) 独占订单 外部效果 场所回读和对账。
10. [Portfolio](./portfolio/) 从执行事实和估值输入投影账户 暴露 表现和容量事实。

## 系统不变量

- 每种可变业务事实只有一个权威 Owner。
- R&D 与 Qualification 在保护边界保持单向，保护结果不能用于调优本次候选；Backtest 只生产证据，不拥有 R&D 决策。
- Paper 与 Live 共享 Runtime Risk Execution 语义，只替换 Execution Adapter。
- Runtime 只有绑定同一 Risk Decision 和 Reservation 后才能向 Execution 发出命令。
- Scanner 只向 Governance 提案，永不直接激活 Runtime。
- Event Rail 只传播已提交事实的唤醒提示，不承担审批 重试 恢复或终态权威。
- Recovery 只允许带围栏的撤销 减仓 清仓和回读。写入 `RecoveryCase.KNOWN_CLOSED` 前始终禁止新增风险，之后 Governance 只能授权新 generation，Runtime 还必须单独证明 `APPLIED`。
