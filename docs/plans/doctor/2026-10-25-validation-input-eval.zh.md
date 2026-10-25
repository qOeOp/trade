# 2026-10-25 评测 validation-input-runtime-change 失败

| Item | Value |
|---|---|
| Sessions | 无研究会话；对象是评测用例 `.agents/evals/research-round/validation-input-runtime-change/` 的运行记录，2026-10-25 12:28Z–13:10Z |
| Audit session | Claude Code 桌面版，Opus 5.5，聚焦诊断（步骤 3–5）；会话 id 宿主未显示 |
| Checkout / ledger | 诊断基线 `4607cc3bc`，修复基线 `e573724db`；不读写账本 |
| Coverage | 用例 prompt 与两个 grader、`references/validation.md`、`references/changes.md`、设计站 X.1.3.1/X.1.3.2、计划 `validation-input-runtime-change.zh.md`、`registration/validation.py` 的绑定拒绝；6 份回答逐条重判（haiku，每份 3 票，要求逐条说明）。未覆盖：真实样本外绑定与配对 |
| Time split | 评测 6 轮（每轮两臂各 3 次）各约 3 分钟、约 1.05 美元；其余为阅读，未计时 |
| Invalid trials caused by the product | 0（只涉及评测） |
| Findings by action | skill 1 / fix 1（grader） |
| Recurred items | 无；20261025-29（用例不在插件根）已由 #1743 修复，本次是它首次真实运行 |
| Found by the user first | 0 |
| Skill size | `references/validation.md` 505 → 624 词；增量是代码与 Agent 分工、拒绝不消耗登记、停止条件、停止记录引用的身份和账户基准定义，设计站 X.1.3.2 已有、skill 未写 |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261025-36 | validation.md 没写设计站 X.1.3.2 交给 skill 的几条：代码只核构建、源码、设计、成员、窗口、覆盖与账户，镜像兼容和修正影响由 Agent 判断；拒绝的绑定不写入、不消耗登记；停止记录要引登记、账本提交、市场提交和新旧镜像身份；账户基准是哪次运行的 `account`。“实质条款变化即停止”也没说只适用于只能按新条款运行的情形。用例明确问“代码与 Agent 各自负责什么”，加载 skill 的 Agent 只能自己猜 | 基线 skill 本会话两轮 with 臂 2/3、1/3（发起会话报告的首轮 1/3）。重判失败回答：B 没提账户基准或拒绝不消耗登记；把“判断配对是否通过”“判断重试资格”归给代码，被判为声称有自动兼容裁决；D 的证据只写“新镜像”，没有镜像身份。补前四点后 with 3/3、2/3，剩下的失败是 D 先说“保证金变了旧验证必须停止”又给按 S0 继续的选项；停止条件改为“只能按变化后的条款或未证兼容的镜像运行时停止，否则按原条款绑定”后两轮 with 6/6（18 票全 PASS）、without 1/6。代码事实：`registration/validation.py:237-320` 依次拒绝 `RUNTIME_NOT_MAIN`、`RETRY_NOT_ALLOWED`（设计变化）、`SOURCE_MISMATCH`、`MEMBERSHIP_CHANGED`、`WINDOW_MISMATCH`、`COVERAGE_INCOMPLETE`、`CONFIG_MISMATCH`（账户），没有镜像兼容判断 | skill（只改 validation.md，prompt 与 grader 不动） | 无研究会话代价；该规则此前没有通过的行为评测 | in PR |
| 20261025-37 | 该用例的 `skill-fired` 是 `type: llm`，看回答内容而不看工具调用，并计入分数：无插件臂没调用任何工具（1 turn）也拿到 PASS（首轮 2/3、修复轮 1/3），抬高 without 分数；其余用例都用 `tool_used` 匹配 `Skill` | `.agents/evals/research-round/validation-input-runtime-change/graders/skill-fired.md`；改为 `tool_used` 后 with 臂 3/3 记录了 `Skill` 调用、作为 with-only 指标不计分 | fix（grader 单独 PR） | 评分失真，无研究代价 | in PR |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| `skill-fired` 的 llm 评审 | 没加载 skill 也被算作遵守 | `tool_used` 匹配 `Skill` 调用，与其余用例一致 | 无插件臂无调用仍判 PASS | 换成 `tool_used`，不保留 llm 版 |
| validation.md 现有句子 | — | — | 失败点都是缺句，不是多余句 | 不删，只补 X.1.3.2 已有的分工与记录要求 |

## Decisions

无需用户授权：不改检查、目标、存储字段或 prompt。
