# 全景场景

全景讲述从可证伪想法到受治理自动交易、事实反馈和已知安全恢复的一条产品故事。图中只呈现 Owner
契约，细节由各场景正文承载。

## Entry / 入口

个人用户把带来源、可证伪的市场想法交给外部 Agent。Agent 经领域 MCP 调用有界、版本化 Owner 操作；服务器服务持久保存已接纳任务与结果，不依赖对话存活。Dashboard 只读研究进度与证据，提供获准的 Governance 控制及首次试盘确认，不发起研究，也不控制本地 Agent。Product Edge 接纳请求，不拥有业务事实或直接交易。

## Value path / 价值路径

1. 用户通过外部 Agent 提出目标与风险容忍；Agent 在批准边界内编写原生 Strategy、提出假设并登记实验。
2. Market Data 准备/复用准确的一分钟行情和所需附加数据；R&D 冻结 Git 源码包、参数、环境及输入引用。
3. Backtest 使用 Nautilus 回放、撮合和报告；Agent 解释证据，R&D 保存实验、暴露和可复用知识。研究目标达成即停止。
4. 用户另行请求独立 Qualification。保护评估只公开二级终态；失败不自动重启研究。
5. 资格通过仍不表示上线。用户在 Dashboard 确认真实试盘后，Governance 将准确版本加入队列。
6. Governance 校验当前资格、授权、冻结政策、账户容量与已有占用，准入后由原生 Runtime/Risk/Execution/Portfolio 运行。
7. Governance 按试盘条件自动转正、按冻结退出条件或用户请求下架；已有持仓按原保护退出，真实占用释放后才可再分配。
8. 单策略与组合研究共用同一原生回测语义。组合配置单独版本化，成员退出预案由 R&D 研究、Governance 执行；Portfolio 提供可复算账户和表现，科学解释由 Agent 完成。
9. 故障保留来源日志和未知效果；恢复由事实 Owner 闭合并维持 Risk 围栏，不凭通知、重试或本地确认猜测成功。

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

- **受益者** - 使用可更换外部 Agent 研发并运行策略的个人用户。
- **可观测结果** - 每个已接受转换都有唯一 Owner 事实，每个自动效果都关联治理 generation 许可 执行记录 账户投影和反馈闭环。
- **未改变伤害** - 团队会建立竞争权威，把漂亮但未合格的结果推向交易，并失去解释资金与外部效果的能力。
- **终态负例** - 任何不完整交接都停在所属 Owner 的明确负面或未解析状态；Recovery Case 未闭合 回执缺失或效果未知都不能推断成功。

## Fail closed and forbidden transitions / 失败关闭与禁止转换

- 自然语言、Agent 计划、通知或事件永远不是交易权威。
- 保护评估不得反馈同一研发循环。
- 只读机会发现不得启动 Runtime。
- Risk 不得签发订单命令，Execution 不得接受未绑定许可的命令。
- 外部效果未知时，不得宣称成功或闭合，也不得启动新 generation。
- 活动 generation 不得靠沉默保留。Eligibility 丢失或必需 performance exposure degradation 证据过期
  时进入 `DE_RISK_PENDING`，阻止新增风险但保留 decrease-only 安全动作。
