# 产品闭环

产品是一个学习与控制闭环。每次转换都必须改变证据、治理决定、运行权限、外部效果，或供下一次
决策读取的事实投影。

## 面向用户的闭环与实现边界

下方 Owner 控制闭环是目标权威 Flow，本身不能证明已有可用应用。只有用户能通过
[Product Edge](../architecture/product-edge/) 把一个有界目标从入口推进到权威结果及其下一个合法动作，
而不需要手工拼接 Owner 数据库、回执、日志或终端输出时，面向用户的产品闭环才成立。

- `CURRENT/PARTIAL` - `crates/strategy_factory` 提供从窄范围冻结 `ResearchIntent` 到 `StrategyArtifact`、
  native replay 和 `TrialReceipt` 的 pilot。它是 `SURVIVED_NOT_ADMITTED`，不是完整 R&D 产品。
- `TARGET/ABSENT_TARGET_ONLY` - 选定的 Windmill R&D Workbench 展示 Source 与 Hypothesis、冻结 Intent、Artifact 与 Build
  Receipt、探索 Run Detail 与 Compare、Diagnosis、Iteration Decision，以及准确的停止、修复、后继或
  Qualification 交接动作。Windmill App 与 Windmill MCP 调用同一组带版本 operation。
- `NOT_ADMITTED` - 架构页面、本地 Windmill 安装、MCP 握手、目标 read model、Dashboard 或可访问底层
  API 都不能让 Workbench 成为 `CURRENT`。

目标以一套 Docker Compose 产品包交付，只提供一个默认 Windmill Web 入口与一个 Windmill MCP 对话
出口。外部对话客户端可选接入，但不随产品打包，也不逐一维护 adapter。Windmill 调度长时间运行的
研究与 scanner job；真实策略循环、行情会话、Risk、订单与恢复效果的权威和进程边界仍属于 Trade Runtime。

[Observability](../architecture/observability/) 可以解释进度与失败，但不能闭合旅程、选择下一动作，
或用 telemetry 替代原生 Owner 回执。

## Agent-native R&D 体验

面向用户的创作闭环由对话驱动：

自然语言研究请求 → Research Request Receipt → 冻结 Research Intent → Agent 活动与 R&D 迭代 →
不可变 Strategy Artifact 与 Build Receipt → 探索 Run Detail 或 Compare → Iteration Decision → 准确的
后继、停止、修复或 Qualification 交接。

Conversation Agent 的职责止于提交类型化请求和查询有界状态。服务端 R&D Execution Agent 拥有长时间
运行的执行 session，并在对话客户端关闭后继续受 Windmill 监督。MCP 不会把客户端模型或 credential
借给该 job。两个角色可以共用显式配置的模型 provider 或计费 gateway，但不能共用 session 权威、
能力 scope、预算或审计 identity。

用户通过可见动作发起研究、请求解释、要求修改、停止工作，或提交准确的已选 Candidate。每个会改变
状态的动作都创建新的类型化请求。修改要么产生新的不可变 Artifact，要么产生明确的原生终态
disposition；绝不编辑或覆盖既有 Artifact。Windmill Job 进度只能解释执行过程；业务阶段和允许的
下一步动作由接收 Owner 的回执与投影决定。

目标 Windmill R&D Workbench 通过以下应用区域闭合旅程：

| 区域             | 首期必需产品视图                                                                       | 权威边界                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Overview         | 活动研究、等待处理的决定、最近结果、Scanner 与 Runtime 健康状态                        | 只做摘要；每个状态都链接到原生 Owner 投影                                                    |
| Sources / Intake | 已提交论文、笔记、媒体、工具输出、获取状态、provenance、解释、triage 与 Research Queue | R&D Source Intake 拥有准入和 provenance；外部内容保持不可信且绝不直接创建 Intent 或 Artifact |
| Research         | Run、冻结目标、时间线、Agent 活动、迭代状态、进度、日志和允许动作                      | R&D 回执与 Research View 决定状态；日志不能                                                  |
| Hypotheses       | 待验证、已支持、已证伪、已停止或未解析的研究假设                                       | R&D 拥有来源、血缘与 Iteration Decision                                                      |
| Artifacts        | Identity、Intent 与迭代血缘、结构化逻辑、参数、依赖、构建状态、语义变更解释和允许动作  | Artifact 与 Build Receipt 保持权威；解释不能替代它们                                         |
| Backtests        | 探索图表、风险指标、Run Detail 与版本比较                                              | Backtest 拥有 Run Result；比较不能创建 Selection                                             |
| Qualification    | 有界公共状态与准确的已接纳交接动作                                                     | 保护细节保持不透明；Qualification 拥有 intake 与 eligibility                                 |
| Scanner          | 调度、终态 Scanner Receipt、心跳和未解析状态                                           | Windmill 调度工作；Scanner 拥有提案事实且永不启动 Runtime                                    |
| Runtime          | 已应用 generation、策略循环状态、checkpoint、incident 与允许的生命周期动作             | Runtime、Governance、Risk 与 Execution 事实保持独立权威                                      |
| Operations       | Windmill job、worker、进度、日志、重试与 incident                                      | 运维成功不等于研究、Qualification、部署或交易成功                                            |

首个 Artifact Review 表面有意不展示原始源码。完整源码只读查看、源码 diff、受控下载和源码关联诊断
属于延后的高级审计能力。Notebook-first 创作、内嵌代码 IDE、原地编辑 Artifact 和覆盖版本都不是
已接纳的产品能力。用户通过 Agent 请求修改，并审阅其产生的后继 Artifact。

## 1. 发现并定义问题

Product Edge 接受自然语言意图，但不拥有交易业务事实。Market Data 提供可追踪的 PIT 事实。
R&D 内的 Research 能力把带来源假设转化为冻结的 Research Intent。

## 2. 构建并探索

R&D 拥有 Strategy Artifact 身份并包含 Develop 能力。独立 Backtest Owner 以服务形式提供探索重放，
并可把规范事实返回新一轮 R&D 研究迭代。

## 3. 独立资格评估

冻结候选连同预注册试验族、成本、容量、embargo、预算和 holdout 规则进入 Qualification。
Protected Evaluation 与研发隔离。Qualification 只发布资格或撤销事实，既不启动策略，也不把
保护结果反馈同一个研发循环。

## 4. 管理策略生命周期

Strategy Governance 综合资格 表现 暴露 事故 对账差异和资金政策。它拥有授权 生命周期状态 允许资金
比例和生效时间。每个已接受 generation 决定保留完整请求 Authorization Lineage，无人值守交易还
绑定独立 Autonomous Policy Authorization；Runtime 单独证明 `APPLIED`。降权 暂停和退役使用只减
不增效果链，未知效果进入 Recovery。

活动状态只有绑定新鲜必需 Eligibility Performance Exposure degradation 证据才能续期。任一证据
丢失或过期都提交 `DE_RISK_PENDING` 并移除新增风险权限，同时保留 decrease-only 安全动作直到
generation 降权 暂停 退役或完成恢复。

## 5. 寻找部署机会

Scanner 是定时运行的慢轨。它加载可部署工件引用与激活条件，冻结市场快照，匹配当前条件，
再向 Governance 提交可审计提案。逐策略隔离评估，数据不足只阻断对应策略，其他完整匹配仍可进入同一 batch 提案。Scanner 永不启动 Runtime。

## 6. 经过唯一控制链交易

模拟与实盘共享同一个 Strategy Instance、交易意图、Risk 决定、一次性预留、订单命令、
效果日志、对账和 Portfolio 反馈语义。Runtime 是正常交易意图的唯一写入者，只有 Execution
适配器会因模拟或实盘模式而不同。每个效果都保留完整请求 Authorization Lineage；无人值守效果还
必须从 Governance 一直保留 Autonomous Policy Authorization 到最终 Execution 回读。

## 7. 恢复到已知闭合

Recovery 把每个 initiating cause 分类为 `RUNTIME_NOT_READY` `RUNTIME_INCIDENT`
`RECONCILIATION_DRIFT` 或 `RISK_HARD_STOP`。不同已准入原因同时出现时在同一 Recovery Case 组合，但不要求另一分支的证据。Runtime
`NOT_READY` 提供本地抑制和匹配 fence；Risk hard stop 可以在 Runtime 保持 `READY` 且没有
`RUNTIME_INCIDENT` 或 `RECONCILIATION_DRIFT` 时创建并围栏 case。`RUNTIME_INCIDENT` 与
`RECONCILIATION_DRIFT` 是两个独立的先处置分支：分别只绑定准确不可变 `runtime-incident-fact` 或
`reconciliation-drift-fact`。前者经 `runtime-risk-incident-fence` 到达 Risk，后者经
`execution-risk-drift-fence` 到达 Risk，且只有 Risk 写入两类匹配 Recovery Fence。Execution 先提交一次性 `RECOVERY_ADMITTED`
Recovery Admission
Disposition 并准确绑定该来源；独立适用且匹配的 `ACTIVE` Risk Recovery Fence 随后才允许进入 case。
任一单独已准入分支都能创建或加入 Recovery Case，不需要另一来源；两者同时准入时，各自 disposition
加入同一只追加 case。闭合为
`NO_RECOVERY_REQUIRED` 的来源，或无法准入而保持 `UNRESOLVED_NO_CASE` 的来源，都不创建 Recovery
Case、recovery command、外部效果或 Recovery Fence。Execution Reconciler 绑定 Risk-authoritative 完整
活动 fence-set identity/content digest 后进入 `FENCED_OPEN`。Risk 在 Aggregate Commitment Frontier
证明集合完整性，有效动作是所有 member action set 的交集，交集为空时没有命令。Recovery 只允许 Execution 拥有的撤销
减仓 清仓和回读。场所回读 对账 Risk 结算和 Portfolio 关闭投影一致后，只有 Reconciler 能写
`KNOWN_CLOSED`。Governance 此后只能考虑新 generation 的新授权。

## 推动下一轮的反馈

Portfolio Lifecycle Evidence Receipt、Runtime Incident Fact、Execution Reconciliation Drift Fact 和 Qualification 变化作为可直接读取的已提交 Owner 事实返回 Governance。Event Rail 可以唤醒消费者并发送 Telegram 通知，但不能审批、重试、保存终态
或执行恢复。
