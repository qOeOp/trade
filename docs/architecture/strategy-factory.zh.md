# Strategy Factory

## 职责

Strategy Factory 是包围 R&D、探索性 Backtest 和独立 Qualification 的价值流边界。R&D 内含 Research 与 Develop 能力；该边界让 R D Q 分离清晰可见，但不成为新的 Owner。

## 正向路径

带来源假设只是一项提案。在任何保护反馈之前，R&D 先原子预提交一个绑定 principal 与 request scope 的 Independence Basis Receipt。Qualification 直接解析该准确 R&D 回执，并在检查其完整持久 principal/scope 历史后只返回 `GENESIS_EMPTY` 当前不透明 `FRONTIER(ref, cut)` 或 `UNAVAILABLE`；只有经证明 Qualification 历史为空时 genesis 才有效。Product Edge 仅搬运绑定同 principal/scope 的不透明投影，不接收保护细节。R&D 在锁定的准入事务内把自身完整本地语义前驱血缘解析为 `GENESIS_EMPTY` `COMPLETE_FRONTIER` 或 `UNAVAILABLE`。只有两个 Owner 的准确当前规范回读都成立时，才能原子创建冻结 Research Intent 永久 TrialFamily root 初始 census member 与 head 回执和 outbox。调用方不能提供或覆盖任一 frontier 独立性 disposition 或 basis identity。

Qualification 的 PostgreSQL custody 在物理上独立：`qualification_owner` 拥有其表与锁定准入函数，另一个 Qualification writer 执行投影写入。R&D role 对 Qualification 表没有 ownership、raw `SELECT` 或 DML。它只能在调用方 R&D 事务中执行固定安全 `search_path` 的 `SECURITY DEFINER` 准入函数；该函数使用全限定读取并保持锁顺序，只返回不可信 raw envelope。Qualification-owned Rust 必须把 envelope 与规范 R&D basis 和完整 Qualification 历史交叉验证后，才能构造密封且不可反序列化的正向 readback；不得公开 raw-envelope 正向构造器。

Qualification 投影构成一条按 principal/scope 绑定、只追加且无环的单链。某个准确且已验证的 Independence Basis 的最新投影若在 Qualification 提交或响应丢失后过期，只有 Qualification Owner 能在同一 principal/scope 锁下追加后继；该后继绑定准确 basis ref/digest、前驱投影 ref/digest、不变的规范 source sequence/cut/frontier、Owner clock epoch、新半开有效期、回执与 outbox，并原子推进 head。仍为 current 的投影必须按字节等价 join；调用方与 R&D 均不得自行续期。历史 R&D 终态 custody 继续绑定并暴露其实际消费的准确历史投影，而新的 S1 写入必须在最终锁定 cut 使用规范最新且仍 current 的投影。

R&D 内的 Develop 能力返回内容寻址 Strategy Artifact 和 Build Receipt，Research 能力再冻结一个 Exploratory Replay Request，绑定准确工件 数据范围 重放配置和模型身份后，独立 Backtest 服务才接收。探索事实只返回 R&D 并可形成后继 Intent。R&D 维护只追加 TrialFamily Census Frontier，且只有 R&D 能提交 Iteration Decision；终态停止不创建 Selection。只有 `READY_FOR_SELECTION` 决定才能产生仅选择 `SELECTED_FOR_QUALIFICATION` disposition 并提交 Qualification Candidate。

## 保护路径

Research 在提交前冻结 TrialFamily 穷尽 Census Frontier 跨 TrialFamily 前驱前沿 预提交独立性依据 PIT 规则 成本 容量假设 预算 证伪条件和停止规则。Qualification 校验这些 frontier 预注册内容 准确 `READY_FOR_SELECTION` 决定和仅选择 disposition，并拥有相关 TrialFamily 的累计 holdout 预留与处理，再请求保护重放。仅选择 disposition 缺失 证伪条件不匹配 遗漏同族试验 试验改名 预算不符 frontier 可变 祖先未解析 独立性依据过晚 反馈前沿过期或截面后新增族成员时都在保护回放前闭合为 `NOT_ADMITTED` 且不消耗 holdout；Research 终态停止永不进入 intake，后续试验需要后继 Candidate。保护结果可以更新 Eligibility State，但绝不能反馈同一研发循环。

## 权威边界

R&D 拥有 Intent TrialFamily Artifact Exploratory Replay Request 和 Candidate 身份。Develop 是 R&D 内部能力，不是第二 Owner。Backtest 拥有重放结果且不能替 R&D 选择下一动作，Qualification 拥有 intake 状态 holdout 状态 资格和撤销。Strategy Factory 不拥有这些事实，也没有独立存储权威。

## 实现验收

每次交接都保留不可变身份 请求关联 保护反馈祖先和实际消费输入回执。R&D basis 创建必须早于任何 Qualification 保护反馈写入。Qualification 投影绑定准确 basis ref/digest principal request scope source sequence/cut clock epoch 与半开有效期；过期 畸形 不匹配或不可用权威都不能创建 S1 转换。每个探索结果都关联一个稳定且由 R&D 拥有的请求身份，不匹配时运行前失败。Candidate intake 必须证明准确 `READY_FOR_SELECTION` 决定与 `SELECTED_FOR_QUALIFICATION` disposition 交叉绑定冻结证伪条件与探索前沿，TrialFamily frontier 在截面前不可变且穷尽，并证明累计 holdout 处理不会被 TrialFamily 改名重置。终态停止不创建 Selection 不能为 `ADMITTED` 且不消耗 holdout。任何保护结果都不能改写 R&D 输入 参数或被评估的 Artifact。

首次 S1 写入前，R&D 必须持有规范 Operator Authorization、Product Edge、本地 lineage 与 Qualification 锁，完成最后一次 Qualification 回读，然后才在第一笔写入前立即采样唯一 final cut。所有结果身份与回执都绑定同一 cut，authorization、binding、manifest 与 Qualification 的半开有效区间必须在该 cut 同时仍为 current。cut 等于任一 `valid_through` 即为 stale，并且 R&D receipt、Intent、TrialFamily、census 与 outbox 全部零写入。

在该终态写入之前，已提交的 Independence Basis 阶段即为持久下游 custody：它密封完整规范 R&D 请求含义、语义摘要、Product Edge admission locator 与历史 lineage、basis 回执及 outbox。准确 `RESOLVE` 只能使用这份经验证的密封含义恢复历史完成路径，且不得创建第二份 basis、head 或 outbox；含义变化、admission 变化、仅有裸行、custody 畸形或缺失都必须 fail closed。R&D 终态回执提交后，后续 authorization 或 view 过期仍保留准确回执、Intent、TrialFamily、basis 与历史 Qualification 投影，并以 `STALE` 只读结果返回；唯一动作是同请求解析，不授予新提交、后继或 provider effect。
