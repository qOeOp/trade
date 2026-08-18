# 全景场景

全景讲述从可证伪想法到受治理自动交易、事实反馈和已知安全恢复的一条产品故事。图中只呈现 Owner
契约，细节由各场景正文承载。

## Entry / 入口

用户通过目标 Windmill Product Edge 提交带来源且可证伪的市场想法。默认 Windmill App 与通过
Windmill MCP 接入的可选外部对话客户端，在同一 `WINDMILL_PRODUCT_EDGE` 准入网关后调用相同带
版本的受限 Owner operation。UI、MCP transport 与 workflow 都不保存业务事实，也不直接交易。

## Value path / 价值路径

1. Market Data 提供可追踪 PIT 事实和规范标的身份。
2. Research 冻结假设并生成可复现 Strategy Artifact。
3. 探索性 Backtest 可以支持下一轮研究迭代。
4. 冻结候选进入独立保护 Qualification。
5. Strategy Governance 综合资格 生命周期证据 资金政策 完整请求 Authorization Lineage 和显式
   Autonomous Policy Authorization，形成部署决定。
6. Scanner 可以定期提交证据提案；提案只有在既有已授权无人值守生命周期血缘和独立 Governance
   决定中才能合法继续，Scanner 永不部署。
7. Runtime、Risk 与 Execution 经过绑定许可的唯一写链执行自动模拟或实盘交易。
8. Portfolio 投影只读账户 暴露 表现 容量 交互和 degradation 事实；Governance 对完整 contender set
   确定分配，Risk 只执行 generation envelope 并联结账户事实 open order 与 liability，不成为 allocator。
9. 已提交反馈返回 Governance，Recovery 围栏事故直到外部效果已知闭合。

## Owner handoffs / Owner 交接

核心方向是 Market Data → Research → Backtest → Qualification → Strategy Governance → Runtime →
Risk → Runtime → Execution → Portfolio → Strategy Governance。Strategy Factory 只把 Research 内部
构建路径与独立资格路径组合为一个价值流，不成为第二权威。Product Edge 只发请求和读视图，
Observability 只接收已提交事件与受限遥测。

## Proof / 证明

每次转换都能追溯到所属事实，包括冻结意图与工件、规范运行结果、资格、部署决定、风险决定与预留、
授权订单命令、效果日志、已对账账户投影、生命周期反馈，以及发生恢复时的
`RecoveryCase.KNOWN_CLOSED`。
每个自动效果还必须让来源 request principal scope 已准入 Shell binding 与 history head Operator
Authorization operation manifest 和 Autonomous Policy Authorization 一直贯穿到权威回读。

## Development outcome / 开发结果

- **受益者** - 需要从想法到自动交易保持一条可追踪路径的量化研究员 策略运营者和资金负责人。
- **可观测结果** - 每个已接受转换都有唯一 Owner 事实，每个自动效果都关联治理 generation 许可 执行记录 账户投影和反馈闭环。
- **未改变伤害** - 团队会建立竞争权威，把漂亮但未合格的结果推向交易，并失去解释资金与外部效果的能力。
- **终态负例** - 任何不完整交接都停在所属 Owner 的明确负面或未解析状态；Recovery Case 未闭合 回执缺失或效果未知都不能推断成功。

## Fail closed and forbidden transitions / 失败关闭与禁止转换

- 自然语言、Agent 计划、通知或事件永远不是交易权威。
- 保护评估不得反馈同一研发循环。
- Scanner 不得启动 Runtime。
- Risk 不得签发订单命令，Execution 不得接受未绑定许可的命令。
- 外部效果未知时，不得宣称成功或闭合，也不得启动新 generation。
- 活动 generation 不得靠沉默保留。Eligibility 丢失或必需 performance exposure degradation 证据过期
  时进入 `DE_RISK_PENDING`，阻止新增风险但保留 decrease-only 安全动作。
