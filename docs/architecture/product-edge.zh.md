# Product Edge

## 职责

Product Edge 把自然语言转成受限请求，并返回只读产品视图。LobeHub 负责对话界面。OpenClaw/Codex 是一个可配置的 Agent Shell 槽位：每次部署只启用其中一个，由它解释意图并选择已批准的 Skill 或 MCP 操作。

## Agent Shell 部署绑定

Product Edge 为每个部署拥有一个非业务 Agent Shell Deployment Binding。它绑定选择 generation、
唯一选中的 Shell（`OPENCLAW` 或 `CODEX`）、有效 principal、scope policy 版本、已批准 Skill/MCP
能力集版本、审计政策版本和 cutover epoch。两个 Shell 可以使用不同凭证，但有效 principal 与政策
必须完全相同；切换 Shell 只改变归因，不改变权限。

每次 binding 提交还必须绑定提交前后的权威 deployment history head。只有部署从未存在 binding
历史时才允许 genesis，且必须是 generation 一并且没有 predecessor。历史一旦存在，后继必须以
在准确当前 head 上持久原子序列化，引用已 `SUPERSEDED` 的前驱，generation 只增加一，cutover
epoch 严格递增，并使用历史中从未出现过的 binding identity。零 `ACTIVE` 窗口不会清空 history head。

规范绑定状态只有 `ACTIVE` 和 `SUPERSEDED`，且 `SUPERSEDED` 单调不可逆。切换期间允许短暂没有 `ACTIVE` Shell，但此时必须失败
关闭且不得向 Owner 提交写请求；同时存在两个 `ACTIVE`、generation 过期或政策不匹配也不得写入。
准确前驱必须先提交 `SUPERSEDED`，以此形成持久请求来源围栏，政策完全等价的后继才能提交
`ACTIVE`。每个写请求原子读取并绑定权威 history head，且准入要求唯一 `ACTIVE` binding 等于该
head。已由合法前驱准入的请求保留原 request 与 binding 身份，新 head 生效后仍按该原绑定解析，
不会发生写入重叠或裸重试。

## 类型化 Owner 请求

每次写请求必须绑定稳定 client request 身份、受信部署绑定、有效 principal 与 scope、能力与审计
政策版本、目标 Owner 与规范操作、类型化业务含义身份和审计关联。Shell 不能自行声明身份或扩大
权限。目标或含义不明确时必须在提交前失败关闭。

请求还必须绑定受信 authority 签发且不能自我声明的 Operator Authorization，包括 issuer、
subject/effective principal、audience、准确 scope、共享 Time Evidence 下的签发与到期时间、revocation
frontier、request-proof 摘要和内容寻址 Agent Operation Manifest。manifest 声明准确 operation
schema 目标 Owner 允许 object class 禁止写入和 capability-policy 摘要。Shell 只能选择 manifest 成员；
自然语言 本地配置或持有 credential 都不能自行产生授权。secret 只存在于不透明最小权限 handle 后，
永不进入请求。

稳定请求身份 有效 principal 与 scope 已准入的 `ACTIVE` Shell binding 及准确 deployment history head
Operator Authorization 和 Agent Operation Manifest 共同组成请求的 Authorization Lineage。Strategy
Governance 接受生命周期请求时，必须把完整 lineage 交叉绑定进结果 Authorized Generation Decision。
Scanner 证据 自然语言 Agent 计划或裸 Governance 决定都不能替代其中任何成员。

无人值守交易使用由该生命周期请求准入的独立显式 Autonomous Policy Authorization，不能伪装成每笔
订单都由用户或 Agent 再次授权。它绑定 policy 身份与版本 principal 与 scope strategy generation 与
Execution Scope、允许的 intent 和 action 类别、Capital Policy 边界、生效与到期时间、revocation
frontier 和已准入 operation manifest。Runtime Risk Execution 必须让该身份贯穿 application intent
decision reservation command Effect Journal 和权威回读。任一成员过期 撤销 scope 漂移或 lineage
断裂都必须阻止新增风险。

Shell 或传输成功只表示 `SUBMITTED_OR_UNKNOWN`。只有接收 Owner 的关联回执才是权威结果。
相同身份和含义的重放加入同一回执；相同身份但含义改变必须拒绝，新动作必须使用后继身份。

Research 用只写一次的 `ACCEPTED` 或 `REJECTED_NO_WRITE` Research Request Receipt 闭合研究请求；
接受回执必须绑定唯一结果 Research Intent 身份。Strategy Governance 以相同两个终态闭合生命周期
请求；接受回执必须绑定唯一 Authorized Generation Decision 身份及完整 Authorization Lineage。Owner 回执出现前 Product Edge
始终保留原请求的未知状态，不从 Shell 确认、只读视图或没有错误中推断接受。

`ATTENDED_D_ONLY_REPAIR` 使用同一请求 lineage 与 receipt 规则，但已接受的 R&D Request Receipt 只绑定
D-only repair admission，不证明修复完成。admission 前的 `REJECTED_NO_WRITE` receipt 不创建 repair
attempt，因此也没有 D-only Repair Disposition。R&D 随后准确提交一个关联请求与 attempt 的 D-only Repair
Disposition：`D0_COMPLETED_NO_ARTIFACT` `D1_VALIDATED` `D1_VALIDATION_FAILED` `D1_BUILD_FAILED`
`REJECTED_NOT_D_ONLY` 或 `OUTCOME_UNKNOWN`。Product Edge 只能通过现有 Research View 显示该事实；
它不拥有 disposition，不能从 Shell 投递推断结果，也不能把 `D1_VALIDATED` 提升为 Qualification
Governance 部署或交易权威。相同请求重放加入同一个只写一次 disposition；新 attempt 必须有新的显式
用户请求和后继 R&D admission。

Qualification Review Request 通过 Qualification 现有且只写一次的 Candidate Intake Receipt 闭合。
该回执绑定稳定评估请求身份 规范类型化含义 准确 Candidate 和 intake attempt。相同请求重放加入
同一回执；含义改变或裸用新身份不能创建第二次 intake 或 holdout 尝试。

Qualification 通过专用已提交事实交接返回该回执。Qualification Status Summary 是后续 intake 尝试或
eligibility 阶段的独立有界只读模型。摘要 事件 Shell 确认或没有错误都不能代替已提交回执，回执缺失
保持 `SUBMITTED_OR_UNKNOWN`。

## 只读视图

每个 Product Edge 只读模型都是有界 Owner 投影，不是影子存储。共同 envelope 绑定稳定 read-request
身份 trusted principal、准确授权 scope 或账户与 Execution Scope、authorization-policy 身份与截面、
来源 Owner、完整权威 source frontier 或 snapshot cut、observed/projection time、新鲜度和 valid-through。
可用结果明确为 `AVAILABLE` `STALE` 或 `UNAVAILABLE`；完整性要求更严格的模型还可额外失败关闭。
同一请求在同一来源截面重放返回同一投影身份；新来源截面创建后继视图。跨 principal scope 账户 mode、
政策过期 时间过期或同请求冲突重放都不返回缓存视图，也不创建 Owner transition。

Research View 状态为 `AVAILABLE` `STALE` 或 `UNAVAILABLE`，并暴露一个阶段：
`REQUEST_UNRESOLVED` `INTENT_FROZEN` `ARTIFACT_AVAILABLE` `EXPLORATION_ACTIVE` 或
`SELECTION_TERMINAL`。它只包含 R&D 拥有的来源血缘 Research Intent 状态 Strategy Artifact 与 Build
Receipt 引用 探索请求结果摘要 Research Selection Disposition，以及已授权请求的有界 D-only Repair
Disposition。它不包含保护重放测量 参数 结果 holdout 消耗或可解引用 Qualification 证据。

Exploratory Run Result View 只从完整 Backtest frontier 向已授权 Research scope 投影 Backtest-owned
探索结果。Governance Decision View 只从完整 Governance frontier 投影 lifecycle state、policy bounds、
effective interval、有界 rationale 和不透明已提交事实引用。两者读取可用性均为 `AVAILABLE` `STALE`
或 `UNAVAILABLE`，都不暴露保护评估细节；Governance view 也不证明 Runtime application 或外部效果。

Qualification Status Summary 只暴露 `NOT_ADMITTED` `ADMITTED` `EVALUATING` `CLOSED_NOT_QUALIFIED`
`QUALIFIED` `EXPIRED` `REVOKED` 或 `UNAVAILABLE`。内部 replay 拒绝或无效、diagnostic 无效或未解析、
assessment 无效以及 `INELIGIBLE` fact 全部映射为同一个 `CLOSED_NOT_QUALIFIED` outcome，并使用类型
不透明且不可解引用的 reference。Product Edge 不能区分、计数、分组或过滤这些内部负面原因。

Portfolio View 状态为 `AVAILABLE` `INCOMPLETE_FAIL_CLOSED` `STALE` 或 `UNAVAILABLE`，只包含 Portfolio 拥有的账户 暴露 表现
和 gross Capacity View 投影，并绑定获准读取的 Execution Scope 与一致 Portfolio 快照截面。它不包含
Risk Reservation Aggregate Commitment Frontier usage 剩余 headroom Risk Decision 或部署交易权限。
来源截面缺失 未授权 过期或混合时保持明确不可用，不能拼接或推断。

Effect Closure View 由 Product Edge 针对稳定 effect-view request 与已授权 Execution Scope 直接向
Execution 请求。`AVAILABLE` 只返回一个 `UNKNOWN_EFFECT` `NO_EFFECT` 或 `SETTLED` 投影，并绑定 attempt
账户 mode effect namespace Effect Journal frontier 回读/对账截面 blocker 责任 Owner projection cut 和
valid-through。政策缺失或过期、跨 principal/账户/mode、请求含义变化或 case/fence 不匹配时不返回
view。source frontier 或权威回读未解析时，同一请求保持 `UNAVAILABLE`，不能推断闭合。同一来源截面
准确重放加入同一投影，较新截面创建后继 view。Product Edge 可以用该 view 解释进度，但效果与
Recovery 状态只能由已提交 Execution 及其他来源 Owner 事实建立，Research 永不把该 view 当 provenance。

## 产品闭环与应用层

只有用户能把一个有界目标从入口推进到权威结果及其下一个合法动作，而不需要手工拼接 Owner 数据库、
回执、日志或终端输出时，产品闭环才成立。Product Edge 用类型化 Owner 请求、请求关联回执和有界只读
模型组合这段旅程，但不拥有旅程中展示的业务转换。

R&D 应用旅程展示 `Source / Hypothesis → Frozen Research Intent → Strategy Artifact and Build
Receipt → Exploratory Run → Run Detail or Compare → Diagnosis → Iteration Decision`。它的终态动作是停止、提交准确的
类型化输入修复请求、创建唯一已接纳后继，或把准确已选择 Candidate 交给 Qualification。每个阶段都
绑定原生 Owner 事实、来源 frontier、新鲜度和未解析状态。可见按钮只提交一个新的类型化请求，绝不
直接修改投影或推进阶段；原生 Owner 回执出现前，动作保持 `SUBMITTED_OR_UNKNOWN`。

Product Edge 可以拥有筛选、布局和未提交表单等短暂交互细节，但不拥有 Research 血缘、Iteration
Decision、Qualification 状态、生命周期状态或外部效果闭合。Observability 可以为旅程标注进度与诊断；
遥测可用性、Dashboard 状态和告警投递永远不能证明完成或选择下一个业务动作。

## 权威边界

它不拥有研究、策略、订单、账户、风险或恢复事实。Agent 操作成功只证明本地提交状态，不是 Owner 回执或业务结果。

向某 principal 投影每个有界 Qualification 阶段事实时，Product Edge 都推进不可解引用的保护反馈
观察前沿。后续 Research 与 Qualification 请求必须提交相关前沿和前驱身份，使 Shell 切换 请求改名
或新 TrialFamily 不能静默擦除已经观察到的反馈。

## 交接

研究与生命周期 admission 请求只能通过接收 Owner 的终态回执闭合；已接受 D-only admission 与后续由
R&D 拥有的 D-only Repair Disposition 保持分离。只有 Runtime 的 Generation Application
Receipt 才能把策略显示为正在运行，Governance 授权本身不能证明已运行。

Product Edge 可以请求 Research 工作、独立 Qualification 评估，或准确一个 Strategy Governance 规范生命周期动作：`INITIAL_ACTIVATION` `PROMOTION` `REDUCTION` `PAUSE` `RETIREMENT` `DE_RISK` 或 `RECOVERY`。冲突按 `RECOVERY > RETIREMENT > PAUSE > DE_RISK > REDUCTION > PROMOTION > INITIAL_ACTIVATION` 解析；`PROMOTION` 要求无人值守政策，并按自身 evidence key 绑定新鲜兼容的 Capacity View、Performance 与 Exposure 证据。它可以读取 Research View Portfolio View 探索 Backtest 结果 有界 Qualification Status Summary 每个 ScheduledScanId 的唯一终态 Scanner Receipt，以及有界 Governance Decision View。Research View 的终态停止只来自 Iteration Decision，只有存在仅选择 `SELECTED_FOR_QUALIFICATION` disposition 才显示 Selection。Intake 状态保留只写一次的 `NOT_ADMITTED` 或 `ADMITTED` 回执；`EVALUATING` 是 `ADMITTED` 回执加上进行中或未知保护请求派生的摘要，不是 Intake Receipt 状态。所有负面保护终态只显示为 `CLOSED_NOT_QUALIFIED`，不投影内部 replay、diagnostic、assessment 或 ineligibility 原因。已提交正向 Eligibility Fact 以 `QUALIFIED` 取代视图阶段，但不改写先前事实。Product Edge 直接读取 Scanner Receipt，不保存竞争的 Scanner-owned 投影。回执显示准确完成状态和一个 expected-set 分支。已解析分支包含准确 expected observed 与 missing，未解析分支包含权威未解析 disposition observed 事实 missing-members-unavailable 标记和终态原因。只有完整 `PROPOSED` 回执含准确 proposal members，不完整 `FAILED` 不能宣称集合完整。Qualification 和 Governance 视图只含公共状态 条件或政策边界 生效区间和类型不透明且不可解引用的已提交事实引用，绝不暴露保护测量 负面原因或评估细节。Event Rail 通知不是终态证明。

## 禁止事项

它不得让 OpenClaw 和 Codex 成为竞争写入者，不接受自我声明 operator identity，不得用任意 SQL 或
命令绕过 Owner 存储，不调用 admitted manifest 之外的 operation，不暴露 credential，不绕过 Risk
创建订单 批准资格 解引用保护证据，也不得用 Agent 记忆宣告恢复成功。

## 决策契约

- **输入** — 自然语言意图 唯一 active Agent Shell Deployment Binding trusted principal 与 scope
  Operator Authorization admitted Agent Operation Manifest 和有界 Owner 只读模型请求。
- **诊断与决定** — 解析唯一规范 Owner operation 与 semantic payload，再以准确 Authorization Lineage
  提交一个类型化请求，或在任何业务写入前拒绝。
- **冲突解析** — 权威 deployment-history head 和政策等价 active binding 优先；意图歧义 双 Shell 写入
  过期切换 含义改变的重放或 scope 冲突都失败关闭。
- **输出与终态负例** — 请求关联 Owner 回执或有界视图；本地 Shell 成功仍为 `SUBMITTED_OR_UNKNOWN`，
  授权拒绝或 Owner 回执未解析都不能变成业务成功。
- **反馈与经济意义** — 把自然语言转成可归因 可安全重放的产品工作，同时不让 Agent credential 通知
  或 UI cache 成为交易权威。
- **禁止事项** — 不执行无 schema 命令或 SQL 不自签身份 不扩大能力 不写业务状态 不披露保护证据
  不创建订单 不分配资金 不绕过 Risk 也不宣称 Recovery。

## 实现验收

切换 Agent Shell 配置时必须保持相同的有效主体、权限范围、能力与审计政策和 Owner 权威规则。测试必须证明只选择一个实现、允许失败关闭的零活动切换窗口、前驱先 `SUPERSEDED` 后继再 `ACTIVE`、取代不可逆、双写或政策漂移被拒、每个请求按准确权威 head 准入，以及所有已准入在途请求身份被保留。每个写操作都有类型 可归因 可安全重放且绑定接收 Owner 回执。Qualification review 复用 Candidate Intake Receipt 作为关联请求终态回执，并独立于有界状态视图返回它。仅含义相同不能加入 Candidate 尝试 状态 结果或身份不同的回执。Research 与生命周期接受回执绑定准确结果事实，拒绝回执证明没有写入。Runtime 在证明 `APPLIED` 或 `REJECTED_NO_INSTANCE` 前必须显式保持 `APPLICATION_UNKNOWN`。自然语言存在歧义时必须在业务写入前失败关闭。

只读模型测试必须证明每个视图保留稳定请求 principal scope 授权政策截面 来源 Owner 来源截面
observed/projection time 新鲜度 valid-through 和明确可用状态；拒绝混合截面 过期政策 冲突重放和未授权
scope；并证明保护 Qualification 细节 Risk headroom 或授权不能进入任何投影。

未来 Dashboard 只读取 Observability-owned Global Status View。该视图必须显示 projection 版本、引用的
Owner/telemetry frontier、新鲜度、完整性、lag、quarantine 与 rebuild 状态。过期、部分、重建中或不可用
视图必须保持明确非当前。Dashboard 中任何可能改变 Owner 的动作都要转成新的 typed 且独立授权的
Product Edge 请求，绝不能直接写入 projection。

切换测试还必须拒绝历史存在后的伪 genesis 过期 history head 重用 binding identity 不递增的
generation 或 epoch，以及并发竞争同一 head 时除唯一序列化获胜者以外的所有后继。

安全测试还必须在提交前拒绝错误 issuer audience subject scope expiry revocation frontier proof digest
manifest operation schema 或 target Owner，并证明任何 Shell 都不能扩大已准入 operation。
Lineage 测试必须证明每个已接受生命周期决定及其最终效果与回读都解析到同一 request principal scope
已准入 Shell binding 与 history head Operator Authorization operation manifest 和授权模式；无人值守
lineage 还必须解析到同一 Autonomous Policy Authorization。任一必需成员缺失或不匹配时必须在新增风险前失败。
