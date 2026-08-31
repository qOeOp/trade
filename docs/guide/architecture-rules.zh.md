# 架构规则

这些规则是全局 Flow、本文档与未来实现之间的稳定契约。

## 有界全景

- 全局 Flow 固定包含 13 个顶层分组，另有一个不拥有业务事实的 Event Rail 通道节点。
- 每个分组最多包含五个模块。
- Strategy Factory 是价值流边界。R&D 是同时包含 Research 与 Develop 能力的一个业务 Owner；Backtest 保持独立的证据生产服务 Owner。
- Product Edge、Observability 和 Event Rail 是边界或渠道，不是业务事实 Owner。
- 不改变权威或 Owner 交接的新细节应写进正文，不进入全景图。

## 规范发布权威

当前规范产品文档只有 `guide` `architecture` `owners` `scenarios` 四个根目录，共同定义 TARGET 架构
与发布信息架构。其他历史源码根只作为备份和迁移证据保留，不属于 TARGET 也不得发布，更不能覆盖
当前契约。删除 恢复或重新迁移任何旧根目录都需要新的 明确且限定范围的用户授权；构建与导航逻辑
不得隐式重新发布旧内容。

每个公开不变量都必须无需阅读实现代码或私有测试即可发现：其规范对象 权威 Owner 允许关系，以及
accepted rejected unknown replay 含义都从 `architecture-contract.json` 发布，并由对应 Owner 或指南页面
链接。测试可以执行公开不变量但不能创造不变量。公开语义缺失会阻止开发切片，Agent 不得从测试名
猜测隐藏契约。

## Product Edge 请求权威

目标部署在稳定状态下只能有一个 `ACTIVE` Agent Shell binding，并选择规范
`WINDMILL_PRODUCT_EDGE` 准入网关。Windmill App 与 Windmill MCP 是该网关后的 channel，不是独立
writer。只切换客户端或 transport 时，必须保持相同的有效 principal、scope policy、已批准 Skill/MCP 能力政策与审计政策。
切换期间允许短暂零个 `ACTIVE`，但必须失败关闭。准确前驱先提交 `SUPERSEDED`，政策等价后继才能
提交 `ACTIVE`；多个 过期或政策不匹配的 binding 都不能接纳 Owner 写请求。在途请求始终保留原
request 与 binding 身份。

每次提交绑定提交前后的权威 deployment history head。genesis 仅允许在空历史且 generation 为一时
提交。后续 binding 必须在准确当前 head 上持久原子序列化，引用该已取代前驱，generation 只增加一，
cutover epoch 严格递增，并使用历史唯一 identity。零活动窗口永不重置历史。

每个 Product Edge 写请求都有稳定身份、受信授权上下文、类型化含义、目标 Owner 操作和审计关联。
原子准入必须读取并绑定权威 deployment history head，且准入截面唯一 `ACTIVE` binding 必须等于该
head。`SUPERSEDED` 单调且不可逆。Shell 或传输成功只表示 `SUBMITTED_OR_UNKNOWN`，接收 Owner 的
回执才是权威结果。相同身份和含义加入同一回执，含义改变必须拒绝；已经合法准入的在途请求即使
新 head 生效也继续按原 binding 解析。

Product Edge 是内容寻址 Agent Operation Manifest、Agent Shell Deployment Binding 及其 history head、
不可变 request admission 与对应 outbox 的唯一 writer。独立命名的 **Operator Authorization Issuer**
是授权签发与 revocation frontier 的唯一 writer。Product Edge 只能直接解析 Issuer 的规范事实；Windmill、
API、R&D、token、配置或 Product Edge admission 代码都不能签发或自我声明这些事实。两个 writer 在同一
authority database 使用不同 PostgreSQL role。Admission 提交时对准确 issuance 与 revocation frontier 持有
共享锁，revocation 使用冲突的更新锁。决定授权是否当前的是这一共同截面，而不是复制 DTO、cache 或由
同一 caller 校验的签名。

Deployment genesis 是显式且只执行一次的管理员操作，绝不是服务启动或请求路径默认动作。它要求完整
验证 binding 与 head 历史为空、expected head 为 `EMPTY`、generation 为一、有限有效期、内容寻址
manifest、一份不可变 receipt 及其 outbox。准确重放加入相同字节；并发或含义改变发生冲突，不能创建
第二个 `ACTIVE` binding。切换必须先提交准确前驱的 `SUPERSEDED` fence，随后才可提交政策等价后继
`ACTIVE`；零活动区间失败关闭，任何请求都不能重新创建 genesis。

不可变 Product Edge Request Admission 绑定稳定 request identity 与 typed-payload digest、准确 deployment
binding 与 head、有效 principal 与 scope、authorization identity、issuer 与 key version、有效期与 revocation
frontier、manifest identity 与 digest、operation、schema、target 与 effects、time evidence、request-proof
digest 和 audit correlation。R&D 只接收其 locator，并在 S1 或 S2 mutation 前直接解析完整规范 admission。
若尚无 downstream custody 提交，后续到期或撤销禁止第一次提交。已提交 downstream receipt 仍按原
admission cut 解析，但 recovery 若要开始新的 provider 或外部 effect invocation，必须在当前授权截面取得
新的单次 invocation admission。取代、到期和撤销绝不重写 admission 或 downstream Owner receipt。

历史上只依赖环境构造 authority 接受的行绝不回填或追认。终态 legacy 行只读并 quarantine；identity
碰撞失败关闭，任何 legacy 非终态 S2 custody 未排空时 activation 必须停止。authority 缺失、双重、过期、
失效、被撤销、issuer 错误、audience 错误、跨 principal、跨 scope、proof 不匹配、manifest 不匹配、digest
不匹配或混合截面时，不得创建 Product Edge admission、downstream Owner 写入或 provider 调用。

`LegacyPreparedAttemptDrainV1` 是唯一的有界例外，且仅适用于准确的历史 schema-v1 `PREPARED` APP 或
MCP 请求。原始 attempt 字节保持不可变。显式有界 admin 只有在绑定准确 attempt 与列 digest、build 与
attempt identity、canonical Product Edge admission、目标数据库，以及 canonical effect admission、claim、
state、artifact、provider-start custody 和非 drain attempt/build outbox 全部为零的事实后，才可在同一事务
追加仅 Owner 可用的 canonical receipt 及其 Owner outbox event。startup、请求处理与 `Resolve` 都不能创建
该 receipt。准确的全目标操作幂等；部分完成集合、目标变化或多出、digest 不匹配、已有 effect 或故障均
不得写入任何内容。已验证 receipt 只投影 legacy-quarantined `OUTCOME_UNKNOWN` 与
`PROVIDER_NEVER_STARTED`，并且只允许同 identity 读取与 `Resolve`；它绝不创建当前 custody、freshness、
authorization、artifact、family、successor、provider retry 或 effect authority。只有 canonical receipt 与
outbox 均验证通过后，startup 才可忽略该准确行；任何未 drain、malformed、不匹配或未知行仍阻断
activation。隔离的本地 recovery 证据不是 production authority，也不建立默认数据库、Windmill 或产品
成熟度 acceptance。

请求 Authorization Lineage 是不可拆分元组，包含稳定 request identity 有效 principal 与 scope 已准入
`ACTIVE` Shell binding 与准确 deployment history head Operator Authorization 和 Agent Operation
Manifest。Governance 接受的每个生命周期决定必须声明 `ATTENDED_REQUEST` 或
`UNATTENDED_REQUEST_WITH_POLICY`，两种模式都交叉绑定并保留完整请求 lineage。
`UNATTENDED_REQUEST_WITH_POLICY` 还要求该生命周期请求准入独立 Autonomous Policy Authorization，
并限定 policy 版本 generation Execution Scope 允许的 intent/action 类别 资金边界 有效期 revocation
frontier 和 operation manifest。该政策授权只能补充 不能替代请求 lineage。裸决定不是自动交易权限。
application intent Risk permit command Effect Journal 和回读必须端到端保留模式及该模式要求的全部身份。

`ATTENDED_REQUEST` 只提供非运行权威。它可以读取状态或请求只减不增的 `REDUCTION` `PAUSE`
`RETIREMENT` `DE_RISK` 或 `RECOVERY`，但不能创建 `ACTIVE_GENERATION` `APPLIED` 正常 Paper 或 Live
新增风险或 adapter 效果。`INITIAL_ACTIVATION` `PROMOTION` 及自动 Paper 或 Live generation 都要求
`UNATTENDED_REQUEST_WITH_POLICY`。`PROMOTION` 覆盖有界提高资金或活动后继转换；恢复和增资不是
生命周期动作别名。未来若支持
attended 外部效果，必须另建显式 attended-effect 契约；principal 在场不代表该契约存在。

Research 与 Strategy Governance 各自拥有绑定请求且只写一次的终态回执。Qualification 复用现有
只写一次 Candidate Intake Receipt 作为 Qualification Review Request 的终态回执，通过独立已提交事实交接返回它，
并与有界状态只读模型分离。该回执绑定稳定请求身份与
规范类型化含义。`ACCEPTED` 绑定准确结果 Research Intent 或 Authorized Generation Decision 身份，`REJECTED_NO_WRITE` 证明没有 Owner 转换。
回执缺失时保持 `SUBMITTED_OR_UNKNOWN`，不能隐含接受或拒绝。

## 每个可变事实只有一个权威

每个可变业务事实只有一个写入者。R&D 拥有工件身份，Qualification 拥有资格事实，
Governance 拥有部署与生命周期决定，Runtime 拥有策略实例 checkpoint readiness 和事故事实，Risk
拥有风险决定 预留和 fence activation，Execution 拥有订单 外部效果 Recovery Case Recovery Command
和 `KNOWN_CLOSED`，Portfolio 拥有账户与表现投影。缓存、事件、
通知或只读投影都不能成为第二权威。

## 研究、开发与资格评估

探索重放只有在请求与结果逐项完全相等时才能被接收和选择。终态 Exploratory Run Result 必须准确重复
Strategy Artifact 请求 PIT 范围 PIT Market Snapshot 身份 Universe Selection Record 身份与修订规则
replay configuration Runtime kernel simulator，以及成本 滑点 容量模型版本。只有请求相等的终态结果
可以进入 Research Selection。被拒 无效 未知 非终态或不匹配尝试只保留为 TrialFamily Census 事实。
准确成本 滑点与容量模型身份还必须从 Research Intent 经 Exploratory Replay Request 与 Result Diagnosis
Iteration Decision Research Selection 到 Candidate 保持相等。模型变化只能成为显式后继 Intent 的单一
假设变化，不能静默重新解释重放或选择。

探索结果可以从 Backtest 返回 Research。Research 提交一个终态 Research Selection Disposition，
交叉绑定准确 Intent 证伪条件 停止规则 探索前沿 Candidate 和 Census Frontier。只有
`SELECTED_FOR_QUALIFICATION` 能进入独立保护路径，保护结果不得返回同一个 R&D
循环。资格是 Governance 消费的事实，不是绕过 Governance 的权限。新 Research program 开始前，R&D
先提交密封且绑定 principal/request-scope 的 Independence Basis Receipt。Qualification 直接解析该回执与
自身完整持久历史，只发布 `GENESIS_EMPTY` 不透明当前 `FRONTIER(ref, cut)` 或 `UNAVAILABLE`。
Product Edge 只搬运绑定 principal/scope 的投影，不能断言 genesis 空历史 disposition basis identity 或
frontier。R&D 再把自身锁定本地历史解析为 `GENESIS_EMPTY` `COMPLETE_FRONTIER` 或 `UNAVAILABLE`；只有
物理 custody 也遵守同一边界：R&D 没有 Qualification 表的 raw read 或 write 权限，只能调用 Qualification-owned 锁定准入函数；Qualification Rust 必须规范校验其 raw envelope 后才可产生密封正向 readback。最后一次回读完成后，消费方 R&D 事务只能在第一笔写入前立即采样唯一 final cut，并在该 cut 重检所有半开 authority 区间。
两个 Owner 的当前规范读取都成立时才可提交 Intent 与 TrialFamily。Research 只保留语义前驱且不读取
保护细节；Qualification 独占跨 TrialFamily 祖先与累计 holdout 处理解析。更换 TrialFamily Candidate
Artifact Shell 或请求身份都不能重置任一历史。
Research 终态停止不创建 Selection 或 Candidate，因此永不进入 Qualification。仅选择 disposition 缺失
或不匹配时，在保护回放前生成 `NOT_ADMITTED` 且不消耗 holdout。
每个已选择 Candidate 还绑定结果前 Protected Robustness Plan。它冻结必需时间窗口 市场状态 标的切片
扰动 合理参数邻域单元的完整有限集合，以及覆盖 指标 容差 阈值 聚合 缺失单元和停止政策；同一轴可以
要求多个单元。plan request result assessment 必须重复准确 plan-cell-set digest，result 与 assessment
各自对每个冻结单元准确交代一次。Qualification 拥有结果分类 assessment；保护测量和单元细节永不返回
R&D。单个漂亮 aggregate、每轴一个单元或一个保护终态结果都不能替代完整计划。
对合格 Candidate，Eligibility Fact 还绑定下游可执行经济条件版本 已评估成本容量模型版本和资格容量上限。
Governance 与 Risk 必须保留准确来源，候选 Capital Envelope 不得超过 Qualification 上限 生命周期上限或当前兼容 Capacity View 估计。

冻结 Candidate 及其 Candidate Intake Receipt 必须绑定唯一预注册保护决策政策身份与版本。`ADMITTED`
intake Protected Replay Request 以及初始或续期 Eligibility Fact 必须重复准确同一 pair；政策身份或版本
缺失 替换或变化时，必须在创建请求前 `NOT_ADMITTED`，或创建后继保护评估，永不重新解释既有证据。

Protected Replay Request 必须冻结准确 Strategy Artifact、请求 PIT 范围、准确 PIT Market Snapshot
身份、快照与修订规则、重放配置
摘要、Runtime 内核、模拟器以及成本 滑点 容量模型版本。Protected Run Result 必须逐项重复对应的
实际消费字段，且每一对都完全相等。任何缺失 替换或不匹配都只能是
`INVALID_REPLAY_EVIDENCE`，按 Qualification 预注册 holdout 规则闭合尝试，且不能生成 Eligibility Fact。
初始或续期 Eligibility Fact 必须交叉绑定准确 Protected Replay Request 准确 `TERMINAL_RESULT`
Protected Run Result 保护决策政策身份与版本，以及 Qualification 已验证的请求结果相等关系。被拒绝 无效
非终态或不匹配结果永远不能生成 Eligibility。

## 自动交易写链

Authorized Generation Decision 是许可，不是 Runtime 状态。Runtime 单独拥有 Generation Application
Receipt。只有绑定唯一 Strategy Instance、checkpoint、决定、generation、Execution Scope、工件与
fence epoch 的 `APPLIED` 才证明正在运行。`REJECTED_NO_INSTANCE` 证明无实例，`APPLICATION_UNKNOWN`
在同一尝试完成对账前阻止重复应用和自动意图。

正常新增风险写链具有准确固定顺序：

1. Governance 按显式授权模式授权一个 generation 和不可变 Execution Scope。`INITIAL_ACTIVATION`
   `PROMOTION` 和
   自动 Paper 或 Live 要求 `UNATTENDED_REQUEST_WITH_POLICY` 并绑定当前 Autonomous Policy
   Authorization。`ATTENDED_REQUEST` 保持非运行和 decrease-only。授权本身不证明执行。
2. Runtime 应用该决定，只有其 Generation Application Receipt 为 `APPLIED` 才证明一个 Strategy Instance。
3. 已应用实例向 Risk 发送一个 Trade Intent。
4. Risk 返回终态 `ALLOW` 加一次性 Reservation，或返回不带 Reservation 的 `REJECT`。
5. Runtime 向 Execution 发送绑定准确决定与 Reservation 的 Authorized Order Command。
6. Execution 校验绑定并向 Risk 发送一个稳定 Reservation Claim Request。
7. Risk 持久原子序列化唯一不可变 `CONSUMED` `WITHDRAWN` 或 `REJECTED` claim result；只有
   `CONSUMED` 允许准备 attempt。
8. Execution 持久记录一个稳定 `PREPARED` attempt，再发送一个 `ADAPTER_ADMISSION_REQUEST`。
9. Risk 持久原子序列化 adapter admission 与 recovery fence activation，提交唯一不可变 `ADMITTED_ONCE`
   `SUPPRESSED_BY_FENCE` 或 `REJECTED`。
10. 只有匹配 `ADMITTED_ONCE` 才允许 Execution 持久化 `INVOCATION_STARTED` 并调用适配器。
11. 适配器响应与权威回读闭合 Effect Journal，不能裸重试。
12. Execution 向 Risk 回报结果与 settlement lineage，并向 Runtime 回报订单 成交 拒绝 回读和对账事实。
13. Execution 向 Portfolio 回报账户 订单 成交 费用 场所和 settlement lineage。Portfolio 发布一致
    projection bundle，Risk 再从同一 lineage 闭合或保持 Reservation liability。

Risk 永不签发订单命令。Execution 必须拒绝缺失、过期、不匹配或已经消费的许可。
Governance 为每个 generation 拥有唯一不可变 Execution Scope，包括 strategy generation、`PAPER` 或
`LIVE` 模式、账户命名空间和效果命名空间。Portfolio 另行拥有不可变 Capacity Scope key，只含账户
模式和经济资金池，绝不含策略或 generation。所有共享不可分 gross 约束映射同一个 key；Paper 与
Live 必须不同，重叠未知时失败关闭。意图 决定 预留 命令 效果 账户和反馈事实必须重复兼容身份。
同一 authorization mode request principal scope 已准入 Shell binding 与 history head Operator
Authorization 和 operation manifest 必须能从每个正常写链事实解析出来。
`UNATTENDED_REQUEST_WITH_POLICY` 还必须保留并重验同一 Autonomous Policy Authorization；
`ATTENDED_REQUEST` 不得用政策身份替代任何请求 lineage 成员。
Runtime 先提交本地抑制和不可变 `NOT_READY` readiness。Risk 不等待 Recovery Case 确认就独立激活
匹配 fence；readiness 过期同样失败关闭。Risk 先在 claim 与过期 围栏 政策撤回之间原子仲裁，只有
`CONSUMED` 允许 prepared attempt；再把每个 `ADAPTER_ADMISSION_REQUEST` 与 fence activation 仲裁。
只有 `ADMITTED_ONCE` 可以进入调用；`SUPPRESSED_BY_FENCE` 与 `REJECTED` 证明未调用。

正常 decrease-only 链是独立且同样有序的链。Governance 提交生命周期决定，Runtime 停止新策略意图，
Risk 返回准确 `PERMIT_DECREASE_ONLY`，Runtime 再发送 Reservation 与 Reservation Claim 字段均为明确空值的
有界命令。Execution 校验该形状，持久记录唯一 `PREPARED` attempt，再发送不创建 Reservation Claim
Request 的 `ADAPTER_ADMISSION_REQUEST`。Risk 把该请求与同 scope fence activation 原子排序并只返回一个
不可变 `ADMITTED_ONCE` `SUPPRESSED_BY_FENCE` 或 `REJECTED`。只有匹配 `ADMITTED_ONCE` 才允许
`INVOCATION_STARTED` 和适配器调用。重放或重启加入同一 attempt 与 admission result；没有 Reservation
和 claim 绝不代表可以绕过 preparation admission 或 fence arbitration。

每个 Capacity Scope 只有一个由 Risk 持久原子序列化的 Aggregate Commitment Frontier。Portfolio 独立
提供候选无关 gross Capacity View，以及包含 projected exposure open order 账户估值截面和已纳入
Execution settlement lineage 的一致 Portfolio Risk Evidence Bundle。Portfolio 永不读取 Risk 状态或
计算剩余 headroom。Risk 把该 bundle 与全部 held Reservation liability 联结，按稳定经济 lineage 去重，
并独占 usage 与 headroom 计算。未知效果按最坏情况占用。序列化尝试过期，或成员缺失 过期 不完整
重叠未知 不匹配时拒绝且不创建 Reservation。`WITHDRAWN` 与权威 `NO_EFFECT` 可释放 liability；仅有
`SETTLED` 不能释放，直到同一次序列化转换以覆盖准确 Execution settlement/readback lineage 的 Portfolio
bundle 替换它，且两者不能重复计数。

Governance 发布 Capital Envelope applicability chain：Capacity Scope 对应一个 `POOL_ROOT` envelope，intent
generation 对应一个 `STRATEGY_GENERATION` envelope。Intent 只受自身链限制，兄弟 envelope 不参与 global
minimum，全部 usage 仍受共同 pool ceiling 限制。政策收窄到低于当前 usage 时取代更宽 Capital Envelope。
只有 Risk 能在 Aggregate Commitment Frontier 上提交 `OVERCOMMITTED_NO_NEW_RISK`；Governance 不创建
不清除也不通过隐藏交接读取该状态，并且不把发布 envelope 当成当前 usage 证明。

依赖顺序必须无环。部署配置先准入不可变账户 mode 经济池 Market Data source 与 Execution adapter
binding。Portfolio 随后拥有候选无关 Capacity Scope，并可发布 gross ceiling 与一致 Portfolio Risk Evidence Bundle。
Qualification 提供 generation 特定经济证据；之后 Governance 才能授权绑定预先存在 Capacity Scope
与已准入 Execution Scope 的 generation。Risk 只消费这些事实，不能创建或修补它们。

## 活动 generation 保留

只有 Governance 显式续期并绑定当前 Eligibility 与全部必需 Performance Exposure degradation 证据截面，
才能保留 `ACTIVE_GENERATION`。Eligibility 过期 撤销 缺失或未知，或任何必需保留证据过期 不可用时，
必须立即用 `DE_RISK_PENDING` 取代新增风险权限。Runtime 在该后继截面停止新意图，Risk 拒绝新增风险，
Governance 推动 decrease-only 链直到 generation 降权 暂停 退役或其效果进入 Recovery。Capacity View
performance 或 exposure 证据缺失不能阻断暂停 降权或退役，因为这些转换不增加风险。证据恢复不能
静默复活旧 generation，恢复运行必须有新的 Authorized Generation Decision；无人值守恢复还必须有 Autonomous Policy Authorization。

## 只减不增生命周期链

降权 暂停或退役不是普通新增风险交易。Governance 提交 decrease-only 生命周期决定。Runtime 先停止
新策略意图并应用决定，再只提出撤单 reduce-only 清仓或回读工作。Risk 校验暴露不会增加，并返回
不含 add-risk Reservation 且只能表示为准确 `PERMIT_DECREASE_ONLY` 的决定。Runtime 创建绑定该 permit
且 Reservation/claim lineage 明确为空的有界命令。Execution 先把稳定 attempt 记录为 `PREPARED`，再请求
adapter admission；Risk 不创建 claim，而是把请求与 fence activation 排序。Execution adapter gate 只有
收到 `ADMITTED_ONCE` 才调用，只接纳撤单 减仓 清仓或回读，并拒绝任何新增风险形状。Execution 强制执行
已准入 adapter binding 和 reduce-only 能力，记录效果并回读外部状态。Portfolio 投影与 Execution 对账证明
结果暴露后 Governance 才闭合转换。未知效果永不算成功降权，而是进入 Recovery 并保持 generation 围栏。

attended 正常生命周期 de-risk 使用 `PERMIT_DECREASE_ONLY` 窄门，Recovery 不使用它。Risk 在唯一
Aggregate Commitment Frontier 证明准确当前完整 `ACTIVE` fence set；只有全部 member 版本化动作集合
确定性交集中的动作可以触达 Execution，交集为空时没有命令。两种权威都不允许激活 普通新增风险
订单流或增加暴露。

## 模拟与实盘同语义

模拟与实盘共享相同 Strategy Instance、风险、订单、效果、对账和反馈契约。模拟使用 Execution 模拟
适配器，实盘使用场所适配器。adapter 选择、账户和效果命名空间都由准确 Execution Scope 决定并属于
Execution，不属于 Runtime。Paper 与 Live 命名空间不得相等或互为别名，跨模式事实即使重放或重启也
必须拒绝。Runtime 与 Execution 拒绝缺失 相反模式或不匹配 scope，不能覆盖 Governance 模式。

## 定时 Scanner

Scanner 是定时提案生产者。它读取受治理的可部署策略、Market Data 事实，以及可选且受限的
Portfolio 容量视图。数据不足时记录原因，匹配成功时向 Governance 提交证据。它永不激活策略
或发送交易意图。

Capacity View 身份绑定不可变账户加模式经济池 Capacity Scope、准确账户与抵押品事实截面 各维度与单位的 gross ceiling 估值版本 流动性输入截面 候选无关资金池
方法与假设版本 测量时间和有效期。除非已发布激活条件明确要求，否则它只是可选提示；一旦条件要求，缺失 过期
不可用或身份不匹配都必须提交 `INPUT_UNAVAILABLE`，不能成为 `MATCHED`。

Capacity View 同时是 Portfolio 拥有的当前只读 gross 经济上限。`INITIAL_ACTIVATION` 必须绑定新鲜且
兼容的 Portfolio Lifecycle Evidence Receipt；`PROMOTION` 还必须按 `PROMOTION` transition-evidence
key 绑定新鲜准确 Performance 与 Exposure 回执。`PAUSE` `REDUCTION` 和 `RETIREMENT` 不能被容量证据
缺失阻断。Governance
把兼容证据绑定进 generation 决定和政策。Risk 每次新增风险决定都绑定准确新鲜 Capacity View；
证据缺失 过期，或 scope 条件 方法 假设 流动性不匹配时必须终态拒绝且不创建 Reservation。Risk
还必须在同 scope Aggregate Commitment Frontier usage 上完成准入。Portfolio 永不分配资金 维护承诺 读取 Risk 或授予交易许可。

## 安全绑定

Product Edge 写请求绑定不可自我声明的 Operator Authorization，包含准确 principal issuer audience scope
到期 撤销前沿 请求证明与内容寻址 Agent Operation Manifest。Research Strategy Artifact 绑定代码字节
依赖来源 runtime 与 sandbox policy capability manifest 安全准入，以及对环境 filesystem network secret
和 effect port 的明确拒绝及 Artifact Security Admission。Market Data 通过不可变 Market Data Source
Binding 准入每个来源，绑定实现与配置摘要
认证 endpoint dataset/account mapping normalization policy trust policy license scope 与不透明最小权限
credential handle。Execution Scope 绑定等价 adapter 身份 场所或 simulator endpoint 账户映射 capability
与 reduce-only policy trust policy 及不透明 credential handle。Secret 值不能复制进 artifact request
command journal 或 read model。
安全验证必须从 Governance 接受回执经 Runtime Risk Execution 追踪 authorization mode 与完整
Authorization Lineage 到权威回读。`UNATTENDED_REQUEST_WITH_POLICY` 还必须追踪并重验
Autonomous Policy Authorization。任一必需成员缺失 过期 撤销 scope 不匹配或 history head 不匹配时，
必须在 Reservation 创建或 adapter 调用前失败。

## 就绪 时间与效果闭合

每个可写 Owner 暴露可观察 readiness state。启动必须保持 `NOT_READY`，直到权威事实 frontier recovery
adapter/source admission 和 clock evidence 对账完成。过载采用有界准入与明确 backpressure；部分 Owner
故障使依赖转换不可用，不能缓存无限承诺。关闭进入 `DRAINING`，拒绝新写入，保留已接受身份，解析
或显式报告未知效果，并记录 restart cursor。Readiness 不是业务许可。

新鲜度与 deadline 绑定共享 Time Evidence：clock identity 与 epoch wall 和 monotonic observation
uncertainty 与 skew bound restart relation 以及比较规则。消费者不能比较未知 epoch 时间，也不能静默
延长有效期。SLO 观察 admission decision effect readback projection recovery closure latency，以及 queue
depth 与 dropped wake count；它永不改写业务事实。

Time Evidence 按用途区分，不能压缩成一个 timestamp：

每个时间敏感 architecture object 都准确声明一个规范 `timeEvidenceCutKind`。六行矩阵与这些对象声明
必须形成严格双射：时间敏感对象未声明、矩阵重复，或声明不在矩阵中都使契约无效。范围包括 source
binding 与 PIT request、保护 request/result/assessment 证据、Trade Intent 与 Authorized Order Command、
incident 与 drift fact、Recovery admission 与 closure，以及所有显式时间绑定的 Portfolio fact。所选行
提供完整必需 binding，本地 timestamp 不能满足该声明。

- `MARKET_DATA_AS_OF` 为 PIT snapshot stream 与 valuation fact 绑定 event-effective provider-available
  retrieval 和 correction time；observation time 不能替代其中任何截面。
- `RESEARCH_AND_GOVERNANCE_DECISION` 把决定绑定到一个 clock epoch monotonic sequence observation time
  和 `valid-through`；更晚 wall time 不能改写证据当时何时可得。
- `SCANNER_DUE_SLOT` 还绑定 time-zone ruleset 身份与版本 本地计划时间 已解析 UTC interval DST fold 或
  gap 处置 misfire/backfill policy 和 due-slot boundary。秋季回拨 fold 产生可区分 slot，春季跳时 gap
  按冻结 skip 或 shift 政策处理，不能重复运行。
- `PORTFOLIO_FRESHNESS` 把 Capacity View Performance Receipt Exposure Receipt Portfolio Interaction Receipt
  与 Portfolio Lifecycle Evidence Receipt 绑定到同一个 clock identity 和 epoch monotonic sequence
  observed-at uncertainty/skew bound restart-continuity proof `valid-through` 与完整 source-fact frontier。
  epoch 混合 frontier 不完整或证据过期时，不能驱动 Scanner Governance 或 Risk。
- `RISK_AND_EFFECT_FRONTIER` 把 decision claim effect settlement 绑定到 aggregate 或 effect frontier cut，
  wall-clock 顺序不能覆盖持久序列化。
- `RECOVERY_CLOSURE` 在 Runtime Risk Execution 与 Portfolio 间绑定一个 causal frontier 与共同证据
  截面；clock epoch 混合或 continuity 不确定时 case 保持打开。

重启若没有 continuity 证明必须创建新 clock epoch。skew 超限 DST 解析不明 `valid-through` 过期或
必需时间字段缺失时只阻止依赖转换，不能通过本地时间转换抹去。

### Shared Time clock-head 交接

**CURRENT：** Market Data 把一个私有规范 clock head 与自身 Source Binding 和 PIT fact 原子持久化。当前
实现支持准确 replay 与同 epoch 前进，并拒绝 epoch 变化；规范跨 Owner 交接与 epoch-successor proof 均非当前能力。

**TARGET：** Market Data 仍是 Owner-local producer，不设 global Time Owner。其 sealed read-only clock-head
handoff 不可变、内容寻址且可按准确身份回读，绑定 head identity 与 digest、clock identity 与 epoch、
monotonic sequence、wall observation、decision cut、排他的 `valid-through`、restart-continuity digest、
uncertainty 与 skew bound 和 comparison rule。同 epoch successor 必须严格推进全部必需 cut 并保持 epoch-stable
语义。新 epoch 只有在一个 direct immutable Epoch Successor Proof 与新 head 原子提交后才可消费。proof 绑定
准确 predecessor 与 successor head digest、前后 epoch identity、successor continuity digest、proof identity、
commit cut 与 comparison rule。消费者不能遍历 proof chain、跳过前驱或跨 epoch 比较 sequence。每个消费者
提交自己的准确 prior sealed handoff，并独自决定自身 transition。producer 闭合后，Portfolio
`PORTFOLIO_FRESHNESS` 是首个 TARGET 真实消费者。

### Deployment Store Admission

**CURRENT：** `crates/data/src/owner/store_admission` 将非业务 PostgreSQL admission 机制及其前后
revalidation 保留在 Market Data crate 内。固定 `rd-owner-api` bootstrap 请求该私有 seam；production resolver、
signer、anti-rollback witness、credential resolver 或 direct measurer 不可用时，在构造 repository 前 fail
closed。随后 Market Data 回读当前 PIT、Source Binding 与 clock head 并密封 `ResearchPitTerminal`。Strategy
Factory 只能获得 sealed terminal resolver：raw receipt、capability、query、DTO、evidence accessor 或
caller-authored positive authority 均不能越过 Owner 边界。通用 S3 catalog 仍只是机制，不是权威。

**TARGET：** 一个属于 Market Data 私有边界且不属于业务的 Deployment Store Admission Custodian，只拥有 signed append-only store manifest
与 history、唯一 signed current head、direct target measurement、immutable admission receipt、rotation fence 和
custody incident；它不进入业务 `authorityOwners`、Flow 或 Dashboard。manifest 绑定 environment、deployment、
consumer Owner、backend、endpoint、TLS、server 与 database 或 bucket 与 prefix identity；PostgreSQL schema、
migration、function、role 与 ACL identity，或 S3 capability 与 version 语义；opaque credential-handle identity、
audience 与 version；以及 predecessor、generation、validity 与 recovery。positive receipt 必须具备 signature、
current head、anti-rollback witness、direct measurement、credential lease 与已闭合 rotation fence，不能由 caller
自写 positive evidence 组装。restart 或 cache loss 必须重验 signature/head 并重新测量目标。任何歧义都不构造
Owner repository，也不触发 business retry。

预期的默认 consumer 是 `product/rd-workbench` 的 `rd-owner-api` bootstrap composition。Market Data 在构造
受治理 PostgreSQL repository 之前，其私有 seam 必须消费一个绑定准确 Market Data Owner、PostgreSQL backend、
environment、deployment 与 consumer identity 的 sealed store-admission receipt。S3 保持 TARGET 和
`UNAVAILABLE`，直到存在真实 catalog consumer 与 pinned disposable S3-compatible test authority。receipt 与 raw
store/PIT/source/clock evidence 保留在 Market Data 内；普通 consumer 首个可见值是 sealed
`ResearchPitTerminal`。在独立的 production resolver、signer、anti-rollback witness、credential-resolver 与
direct-measurement adapter 存在前，默认产品入口保持 `UNAVAILABLE`。

**`ISOLATED_EVENT_REPLAY_ACCEPTANCE_V1` / TARGET：** 在上述 adapter 存在前，只有这个被显式选择的 profile
获准作为非默认、非生产动态验收拓扑。canonical management plane 在 repository、candidate、caller、consumer 与被测进程
之外预置 immutable acceptance trust bundle，固定 environment、signer key fingerprint、witness、credential-
resolver 与 direct-measurer identity。分别执行的独立 principal 签发 signed append-only manifest/history 与
准确 current head、维护 witness、租赁 opaque credential handle、直接测量 disposable PostgreSQL target 并关闭
rotation；candidate/caller 不拥有其中任何写权限或 secret authority。admission receipt 交叉绑定该 bundle 与每项
observation。其余 stages 是：Market Data 私有 admission/custodian；Owner-issued request 到
projection/event locator 与 durable readback；密封只读 `StrategyInputSampleEventResolverV1`；`ProgramHost`；
真实 BacktestEngine 与 Sim Exchange；以及带 restart readback 的 Backtest Owner terminal-result receipt。raw
custody evidence 绝不交给 consumer。Backtest 原子提交准确 request、attempt、actual-consumption record、diagnosis
与 result；逐字节相同 retry 加入相同 canonical bytes，含义变化则冲突且零写入。

任一 signature、head、rotation、ACL、credential、measurement、request、locator、projection、event、role 或
readback binding 缺失或不匹配时，该 profile 必须在 `ProgramHost` 或 Backtest mutation 前 fail closed。raw
DSN、caller digest、fixture、fixed corpus、in-memory/temp-file writer，以及由 candidate、caller、consumer 或
被测进程派生的 signer/witness/credential/measurer 均不能创建
正向 resolver 或 result。成功的隔离证据只证明该准确 disposable topology；不能提升为 production readiness、
deployment authority、Paper、Live、real trading 或另一项 production write。

**NOT_ADMITTED：** custodian 不创建 business fact/receipt、global registry、scheduler 或 deployment service；
artifact/log 不保存 raw DSN、secret 或 private key；不自动执行 DDL、role、credential、bucket mutation 或
provider probe；也不授权 production write、Dashboard implementation 或 trading。

Shared Time producer state machine 先于其 Portfolio consumer。disposable PostgreSQL acceptance 必须覆盖
私有 admission、前后 revalidation、Market Data current-head 校验和被显式选择的隔离 consumer path；fixture
不能证明 production adapter。production signer、resolver、witness、credential-resolver、direct-measurement、
default-product 与 S3 adapter 在有自身证据前保持 unavailable。

Execution 面向 Product Edge 的 Effect Closure View 区分 `UNKNOWN_EFFECT` `NO_EFFECT` `SETTLED`，并绑定准确 effect frontier
回读与对账截面 blocker freshness 和责任 Owner。Recovery 投影另行区分 Runtime readiness `NOT_READY`
Risk fence `ACTIVE` 和 Execution case `OPEN` `FENCED_OPEN` `KNOWN_CLOSED`。视图可以解释进度，但不能替来源 Owner 宣告转换。

Research 不能把该视图当成来源证据。后继研究 provenance 只能绑定准确的已提交 Execution 账户 订单 成交
quality observation Effect Journal 回读或 Reconciliation Drift 事实身份及其来源截面；可变投影或 Event
Rail wake 不能代替这些事实。

## 本地化稳定性

Canvas 的 Owner 边界 通道和模块名称在所有语言中保持规范英文，避免切换语言改变拓扑或布局。
场景名称 导航 正文 节点描述和底部详情与证明胶囊参与本地化。切换语言只替换这些文本，不改变
节点 连线或 viewport 身份。

## Event Rail

Event Rail 只是传输托管者而不是业务权威。对已提交资格变化 事故 订单 成交和对账事实，它只拥有
Event Wake 传输 record，来源 Owner 仍拥有权威。Events → Observability 传递该 Event Wake 而不是业务结果；Observability 更新可重建状态与告警投影，Alert Routing 自己创建 Alert Delivery attempt 与 receipt 作为输出。wake 与 delivery 都不能审批 重试业务效果
拥有终态 充当证据权威或替代 Owner 之间的直接事实读取。

## Observability

领域事件使用原生 Owner transactional outbox 和至少一次 Event Rail 投递；trace、metric 与 log 使用可独立
开关的 OTLP pipeline。两者都绑定稳定身份、correlation/causation、来源、时间、schema、披露与策略版本，
但只有已提交 Owner fact 是业务事实。Projection consumer 必须幂等，并暴露 checkpoint、新鲜度、完整性、
lag 与 rebuild 状态。即使共享物理存储或中间件，也不能合并 Owner 写凭据、schema、retention 或 effect namespace。

## Recovery 终态

Recovery 把每个已提交 initiating cause 准确分类到 `RUNTIME_NOT_READY` `RUNTIME_INCIDENT`
`RECONCILIATION_DRIFT` 或 `RISK_HARD_STOP`。不同原因同时出现时保留各自 branch membership 并加入同一 case；任一分支都不要求
只由另一分支拥有的证据。`RUNTIME_NOT_READY` 绑定本地抑制和不可变 `NOT_READY` fact；
`RUNTIME_INCIDENT` 只绑定准确 `runtime-incident-fact` 并由 `runtime-risk-incident-fence` 携带给 Risk；
`RECONCILIATION_DRIFT` 只绑定准确 `reconciliation-drift-fact` 并由 `execution-risk-drift-fence` 携带给
Risk。两条关系都只携带已提交来源证据，Risk 仍是 Recovery Fence 唯一 writer。任一单独分支都不需要
另一来源，但只有 Execution 为它提交独立
一次性 `RECOVERY_ADMITTED` disposition 与匹配 `ACTIVE` Risk Recovery Fence 后，才能创建或加入 case；
两者同时准入时，各自 disposition 加入同一只追加 case。Runtime 为 `READY` 且不存在匹配 fence 时，
权威 no-effect 或已完整对账且无剩余 liability 的证明终结为 `NO_RECOVERY_REQUIRED`；缺失、混合截面或
无法隔离的证据终结为 `UNRESOLVED_NO_CASE`。两种 no-case 状态都不创建 case、command、effect attempt
或 fence。`RISK_HARD_STOP` 可以在 Runtime 为 `READY` 且没有 `RUNTIME_INCIDENT` 或
`RECONCILIATION_DRIFT` 时创建并围栏 case。Risk 在同
scope frontier 独立激活每个适用 fence，绝不等待 case 确认。Risk 给 fence activation 与每个正常
`ADAPTER_ADMISSION_REQUEST` 排出唯一顺序：fence 先获胜时
`SUPPRESSED_BY_FENCE` 证明未调用；admission 先获胜时只有一个 `ADMITTED_ONCE` attempt 纳入 Recovery
effect frontier。Execution Reconciler 还保留同时成立的已应用 Artifact
`DECREASE_ONLY_STRATEGY_PROTECTIVE` 原因，但不把它当作 Recovery 权威；并用同一 open-order 暴露
回读截面去重正常 attempt，使所有到达顺序对剩余数量最多允许一个外部减仓效果。Execution Reconciler
创建唯一 `OPEN` case，绑定 Risk-authoritative 完整活动 fence-set
identity/content digest 后推进为 `FENCED_OPEN`；Execution 不能根据收到的 member 推断完整性。
只有 Reconciler 能创建恢复命令。恢复命令必须绑定 Recovery Case
和 fence epoch，且只能撤销、减仓、清仓或回读。减仓与清仓还绑定 Execution 权威暴露回读截面 方向 数量
有界目标和 reduce-only 政策。Execution 在适配器调用前重验同一截面；部分或并发成交 较新截面 零或翻转暴露
不支持 reduce-only 或可能穿越零点都必须拒绝且不调用。Runtime Risk Execution 与 Portfolio 事实全部
闭合后，Reconciler 才能写入 `KNOWN_CLOSED`。外部效果未知时案例必须保持打开，也不能启动新一代。

Execution 在请求准入前把 attempt 以 `PREPARED` 持久化；只有 `ADMITTED_ONCE` 才允许外部调用前写入
`INVOCATION_STARTED`。崩溃 响应丢失或重启必须加入这些 record 并执行回读，不能裸重试。Recovery action
不提交普通 adapter-admission request。只有 Risk 拥有 Reservation 成员前沿
三态解析以及完整受影响集合或显式空集合。Execution 回报共同 case、完整 fence set、command、effect 身份和
按状态区分的证据。已提交 drift `UNKNOWN_EFFECT` 绑定 effect journal、uncertain-effect lineage、不确定性
观察、最后回读尝试或已证明缺失及完整 source/time frontier，且不伪造结果；只有 `NO_EFFECT` 与
`SETTLED` 绑定权威终态回读和对账截面。
Execution 既不读取也不证明 Reservation 成员关系。Risk 把事实与自己的前沿联结。孤儿外部效果只有在
完整 Risk 前沿联结 Execution 权威回读后才能标为 `RESOLVED_EMPTY`；隐式空集合或 `UNRESOLVED` 保持
`UNKNOWN_EFFECT`，使 Reservation 不可复用并保持 case 围栏。

Execution Reconciler 为同一 generation 和影响范围最多保留一个未终结 Recovery Case。匹配的 branch
cause 都追加到它的因果集合，不能伪造另一分支的前置条件。闭合必须绑定来源 Owner 的事实前沿，并
包含前沿内全部原因、准确完整 fence set、已对账
Execution 回读、完整 Risk 预留覆盖和匹配 Portfolio 投影。闭合提交前出现新原因会使待闭合证据失效。
只有绑定匹配完整 `ACTIVE` fence set 的 `FENCED_OPEN` case 能签发 decrease-only Recovery Command。
每个 plan attempt closure 绑定同一不可变集合快照；调用前新增 member 使旧 command 失效，调用后新增
member 保留已开始 attempt 并只推进后继 frontier。
`KNOWN_CLOSED` 由 Execution 独占追加，不能恢复旧 generation，只允许 Governance 考虑一次新的授权。
前驱 fence 继续保持 `ACTIVE` 并只绑定前驱 generation。新 generation 需要新的 Governance 决定和普通
新增风险门禁，但在自身四种准确 Recovery 来源分支之一独立激活前没有 Recovery Fence；
仅因为 generation 是新的就创建 fence 会直接抑制该 generation。

## 失败关闭

事实缺失、过期、格式错误、含义不明或不可用时，只停止依赖它的转换。任何组件都不能把沉默推断为
成功，不能裸重试外部效果，也不能把假设、回测结果、通知或只读投影提升为交易权威。
