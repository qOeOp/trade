# 2026-10-22 固定源码的运行时迁移登记

| Item | Value |
|---|---|
| Sessions | Codex desktop，01a15f8b-e253-72d0-a67b-76d3e2e8377e；continuity 三条独立诊断，migration 三条冻结候选复核 |
| Checkout / ledger | 诊断 1030525d5，交付基线 3643ffbe8；活动账本 mue9tjufiipsijvdmiitljpmm57cq7jt，诊断只读 |
| Coverage | 登记、预检、绑定、复现身份、拒绝文案与运行时变更指导；当前实现的复核和交付状态记于索引 |
| Time split | 隔离账本针对性 28 tests 用时 20.475 秒；研究、发现、人工等待及未来重建成本未完整归因 |
| Invalid trials caused by the product | 0；在继续登记前发现，未向活动账本试写失败登记；此前无效 trial 11 保持原样 |
| Findings by action | fix 1；无新增存储字段、表、命令或工作流 |
| Recurred items | 未证明本项曾交付后复发；CSV 两项已由 #1633 修复，与此项分开 |
| Found by the user first | 0 |
| Skill size | SKILL.md 未改；changes.md 增补现有 retry_of 的调用方式，不新增研究权限 |

## Findings

| id | Finding | Evidence and consumer | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261022-03 | 新镜像必须先重建可比基准，但登记准入没有原样迁移路径 | changes.md 要求对照先行；comparability 正确拒绝旧镜像对照。旧 register._check_retry 拒绝有效基准，_check_exposure 又把旧预检及原生复现列为无关暴露。三条独立诊断和主代理只读调用实际消费者复现 root 的 RETRY_NOT_ALLOWED、旧预检 trial 2/10 的 SOURCE_ALREADY_EXPOSED；reproduce 固定旧镜像，explore 不能替代研究对照 | fix：沿现有 retry_of 识别固定研究声明、源码网格、运行契约、配置和输入的新镜像重建；只识别关联短预检及已验证复现；仍要求新镜像审查和可比对照 | 实际阻止原 EMA 消融续跑；没有失败活动登记或节省量估计 | 用户已逐项授权；实现及隔离消费者测试完成，后续复核、全量测试和 PR 交付以索引为准 |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| 镜像、配置与输入可比性 | 把引擎差异误归因给策略 | 工程配对不能替代新身份下的研究对照 | 旧对照在新镜像被正确拒绝 | 保留 |
| 有效成功尝试的重试拒绝 | 重复研究被当成新证据 | 新镜像本身不证明声明固定 | 原规则也阻止技术重建 | 保留同镜像拒绝；仅按原登记事实识别固定问题迁移 |
| 源码暴露检查 | 结果暴露后重新预登记 | retry_of 不是所有探索的通行证 | 原已引用预检、确定复现也被拒绝 | 保留无关暴露；关联短预检核原身份，复现核原件与封存指纹 |
| 独立源审查 | API、因果、活动与就绪错误 | 旧镜像审查不能证明新镜像可运行 | 新镜像需要新预检 | 保留，不继承旧审查作为新准入 |
| 网格单次消耗与原始失败 | 遗失失败及重复尝试身份 | 迁移声明不能替代消耗记录 | 需新登记、新 trial；旧 trial 11 无经济证据 | 保留；测试通过实际登记和绑定检查 |
| 新增持久事实 | 无已证明的缺失事实 | 已有 plan、registration_attempt、trial、capture 的身份、审查引用及指纹文件哈希 | 足以派生技术关联 | 不新增字段或迁移状态 |

## Decisions

用户于 2026-10-22 回复“授权该修复并继续 EMA 研究”，明确批准固定源码、研究问题、窗口、
账户和输入的基准在新镜像重建；仅认可该登记链已引用的旧预检和已验证复现，仍要求新镜像
预检和新的可比对照。同镜像成功重试、无关暴露仍拒绝，历史失败保留。此项授权不同于此前
CSV 读取与工程配对两项授权。

实现仅使用既存事实。每个被消耗登记的研究声明和网格逐项相同；可移动的只有 retry_of、
预检引用和同源码的重建对照。新对照仍由原有可比性及经济证据消费者核验。复现的认定从
完整封存的原始运行和 explore 身份、阶段及指纹文件哈希派生，不依赖 /tmp 原生报告留存，
也不把研究状态中仅按身份排除的 reproduction 标签当成完整证明。

实际 EMA 路线的解释门已满足，research state 的 gates 为空；未修改解释门或复盘次数。
通过隔离账本回归不代表活动路线已迁移，交付后仍需新预检、审查、登记、回放及解释。
