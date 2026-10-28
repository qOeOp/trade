# 2026-10-29 零成交短预检把源码烧掉

| 项 | 值 |
|---|---|
| 会话 | Codex，`rollout-2026-10-29T00-36-20-01a18327-b631-7382-9500-8a717ee941b2.jsonl`（子会话 `01a1833b-a2ef-73e0-8f30-9bb3a9ac9a04`），2026-10-28 15:36–16:03 UTC |
| 诊断会话 | Claude Code，claude-opus-5-5，会话 b303a571-7192-4c43-b7a5-0cc967795e8a；本项是聚焦诊断，用户在整场审计进行中要求先审 Codex 提出的拒绝放宽；整场审计另写记录 |
| 检出 / 账本 | main `7d7597d57`；账本 `kmsv7v8nvedcnq8rba8dn2mc0sb5smrg`（会话前后相同，只读 `ledger sql`） |
| 覆盖 | 会话 15:53–16:03 的第 3–6 轮与设计子会话；`registration/register.py`、`registration/precheck.py`、`ledger/lines.py` 的暴露与起线检查；trial 212–214 与其评审的账本原件。未改代码、未跑回放 |
| 时间拆分 | 第 3–6 轮约 10 分钟，多为设计与等待用户；未细分 |
| 产品造成的无效试验 | 0 新增；trial 214 已计入 20261028-13 |
| 按动作的发现 | fix + authority 1（20261029-01） |
| 复发项 | 无 |
| 用户先发现 | 0（用户追问“rollingref 不能跑了吗”，触发的是 Codex 的放宽提议，不是本诊断漏掉的问题） |
| skill 体量 | 未改 skill |

## 发现

| id | 发现 | 证据 | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261029-01 | 预检收到行情但没有成交时，源码仍被当作已运行，它的失败评审也永远挡住起线。`ema-entrynotional-rollingref@1` 的 trial 214（7 天预检，网格缺陷 20261028-13 使市价单不成交）因此既不能登记，也不能起线；#1826 修好缺陷也解不开 | **会话**：15:54 Codex 读 main 后确认 214 仍触发 `SOURCE_ALREADY_EXPOSED`；15:55 提议放宽，15:56 用户回“授权”；Codex 随后设计在 source-review 正文加 `product_repair {precheck_trial, fix_commit, reason}`，由评审人声明因果，并要求新旧预检同一市场提交，16:02 为此请用户在 gc305/krl5 间选择。**当前产品**：`registration/register.py:452-490` 只豁免登记引用的那次短预检和行情前失败的预检（`precheck.stopped_before_data`，`registration/precheck.py:105-126`），214 两者都不是；`ledger/lines.py:130-134` 按源码哈希收集评审，有一份 failed 就 `START_REVIEW_REQUIRED`，不看镜像与输入。**账本**：trial 213、214 同源码 `ed519ca4…`、同窗口 `[2021-01-01, 2021-01-08)`；`source-review-214-52a2ab00a61965c0` 的 api/causal/readiness 为 passed、activity 为 unresolved、verdict failed，正文写明零成交零持仓；214 的封存指纹 fills 与 positions 都是 0 行。**判断**：零成交零持仓的短预检没有让任何人看到收益，算作暴露保护不了多重检验；activity 失败说的是那一次运行，不是源码属性。Codex 方案让评审人为自己的重试作因果担保，比按封存事实判定弱，还引入存储字段、市场提交选择和八组测试；它的授权请求也没说出不改规则的路（`ema-entrybudget-multiyear@1` 无暴露、无失败评审） | fix + authority，按下方决定的两条规则，只读封存事实，不加字段；不改 api/causal/readiness 失败的一票否决，不改旧记录 | 一个候选被产品缺陷挡住；会话第 3–6 轮约 10 分钟 | open |

## 移除清单

| 机制 | 守护的风险 | 已有覆盖 | 本次证据 | 建议 |
|---|---|---|---|---|
| 收到行情的预检一律算暴露 | 先看结果再登记同一源码 | 短预检的收益要从成交来；零成交时没有可挑的结果 | 214 零成交零持仓，仍挡登记 | 收窄：零成交零持仓的短预检不算 |
| 起线时同源码任一 failed 评审一票否决 | 换评审人刷掉失败 | api/causal/readiness 是源码属性，必须保留；activity 取决于运行 | 214 只有 activity unresolved | 收窄：只放过 activity 失败、零成交、后来有成交且评审通过的情形 |
| Codex 提议的 `product_repair` 评审字段 | 同上 | 被下方两条按封存事实的规则覆盖 | 未实现 | 不加 |

## 决定

用户 2026-10-29 授权（取代 15:56 对 Codex 方案的“授权”）：

1. **暴露。** 登记的暴露检查不把这样的试验算作源码已运行：声明为预检，与登记同一源码，交易窗口不超过 `PRECHECK_MAX_DAYS`，封存捕获完整，原生指纹的 fills 与 positions 都是 0 行，没有被登记消费。与 `stopped_before_data` 一样，不要求镜像、输入或窗口与登记一致。
2. **起线。** `line select` 统计失败评审时，不计这样的评审：api、causal、readiness 都是 passed，只有 activity 为 failed 或 unresolved；所评审的预检封存为零成交零持仓；同一源码有一个更晚的预检，封存 fills 多于 0 行，有 passed 评审且没有 failed 评审。其余失败评审照旧拒绝。
3. 不加存储字段，不改市场提交，旧 trial 214 与其失败评审原样保留、仍不能被登记引用。
4. 在 main 上开修复 PR，PR 正文写本 id，测试只用隔离 Dolt 库。
