# 产品闭环

产品是一个学习与控制闭环。每次转换都必须改变证据、治理决定、运行权限、外部效果，或供下一次
决策读取的事实投影。

## 面向用户的闭环与实现边界

下方 Owner 控制闭环是目标权威 Flow，本身不能证明已有可用应用。只有用户能通过
[Product Edge](../../architecture/product-edge/) 把一个有界目标从入口推进到权威结果及其下一个合法动作，
而不需要手工拼接 Owner 数据库、回执、日志或终端输出时，面向用户的产品闭环才成立。

- `CURRENT/PARTIAL` - `crates/strategy_factory` 提供从窄范围冻结 `ResearchIntent` 到 `StrategyArtifact`、
  native replay 和 `TrialReceipt` 的 pilot。它是 `SURVIVED_NOT_ADMITTED`，不是完整 R&D 产品。
- `TARGET/ABSENT_TARGET_ONLY` - R&D Workbench 展示 Source 与 Hypothesis、冻结 Intent、Artifact 与 Build
  Receipt、探索 Run Detail 与 Compare、Diagnosis、Iteration Decision，以及准确的停止、修复、后继或
  Qualification 交接动作。
- `NOT_ADMITTED` - 架构页面、目标 read model、Dashboard 或可访问底层 API 都不能让 Workbench 成为
  `CURRENT`。

[Observability](../../architecture/observability/) 可以解释进度与失败，但不能闭合旅程、选择下一动作，
或用 telemetry 替代原生 Owner 回执。

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
