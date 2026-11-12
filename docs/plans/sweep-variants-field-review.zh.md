# 离线扫描的变体数要不要存：字段审阅

2026-11-12。doctor 20261112-16（[b5788262 审计](doctor/2026-11-12-dow-theory-b5788262-full-audit.zh.md)）：有效试验数 N 不含 Agent 的离线参数扫描，扫描只以自由文本的 `search_exposure` 判断记下。用户当天决定把这些扫描计入 N（“按建议做”）。按 AGENTS.md，加存储字段前先做独立子 Agent 审阅，结论记在这里。依据 origin/main `a1775a5a5` 之后的检出。

## 谁在用

`report/status.py` 的 `multiple_testing` 与 `deflated_range`：折扣夏普的两端分别用 `effective_trials` 和 `all_purpose_trials`。研究会话读 `research status` 给出的范围（`research-round/SKILL.md` 的证据一节，`nautilus-report-analysis/references/ratios.md`）。

## 它是不是独立的事实

是。扫描跑在 `/tmp` 脚本里，跑完就没了，变体数只有写判断的 Agent 知道。现有 18 条 `search_exposure` 判断（编号 4 至 67，都在线 1，没有被取代的）都解析不出数：判断 21 写的是参数区间（“trailing (30 to 180 days)”“floors 0.15 to 0.5”），不是变体数；判断 30 是 LINE_DAYS × LINE_WIDTH 的 4×3 网格，只数了信号突破，“No prices of fills, returns, PnL or drawdowns”，按性能评估的变体是 0。

要计的事实是“拿这条线数据的任何结果评估过、却没登记也没回放的规则或参数变体的个数”。审阅时原写“只看信号的视图记 0”；圆桌（见文末）改为：在价格已知的窗口里看变体的信号或日期落在哪里也算评估过（J42、J67 计入），只有不碰规则变体的视图记 0，免得把看过价格的视图改称“只看日期”。

## 考虑过的做法

| 做法 | 结论 |
|---|---|
| (a) 新列 `judgment.variants` | 正确但现在代价太大。`SCHEMA_VERSION`（`ledger/db.py:54`）升版后，第一代账本的每个提交都读不了：连接与 `read_as_of` 拒绝 `SCHEMA_MISMATCH`（`ledger/db.py:714-717, 755-759`），副本同步拒绝 `REPLICA_INVALID`（`ledger/replica.py:79-81`）；`research status --at` 读旧提交、推荐的 `compared(line, commit)` 读升级前的 `based_on_commit` 都会坏。没有升级命令。对已有 18 行加 `CHECK` 也会失败，要求仍得写在代码里 |
| (b) 正文首行固定写 `Evaluated variants: K` | 采用。不改表结构，旧提交照读；写入时由 `judgment add` 校验，读时由产品解析并计入 N |
| (c) 不改产品，skill 让 Agent 自算含扫描的折扣夏普 | 不采用。Agent 既数又算，等于给自己打分（`docs/plans/research-skill-overfit-20261111.zh.md:161` P1），也违反 `ratios.md` “never count trials yourself” |
| (d) 每个变体跑一次 `replay explore` | 只适用于本身就是策略的变体；离线改缩收益序列不是策略 |

四种做法里产品都核不了 K 本身，K 都由 Agent 申报。差别在于：(a)(b) 里 Agent 只公开申报一个整数，记录只追加、绑定提交，算术由产品做，申报偏低可以对照判断自己的描述查出；(c) 里计数和计算都在 Agent 手里。

## 结论

按 (b) 做：

1. `search_exposure` 正文第一行恰为 `Evaluated variants: K`，K 为非负整数（无前导零），定义见上。
2. `judgment add` 拒绝缺这一行的 `search_exposure`（新写或取代），拒绝码 `SEARCH_EXPOSURE_VARIANTS_MISSING`。这条收紧检查由用户 11-12 委托的圆桌决定（[道氏新旧对比诊断](doctor/2026-11-12-dow-old-vs-new-compare.zh.md)“圆桌裁决”一节）。
3. 总体：`multiple_testing` 的重叠总体里每条有试验的线，其当前（未被取代的）`search_exposure` 判断。
4. `multiple_testing` 与 `trial_counts`（IDE“Picked from”读它）新增 `sweep_variants`（K 之和）、`undeclared_sweeps`（缺这一行的当前判断编号）和 `trials_with_sweeps = all_purpose_trials + sweep_variants`。
5. `deflated_range` 的上端改用 `trials_with_sweeps`；`effective_trials` 不变，它的 ρ 来自已存的研究收益，扫描没有收益序列。
6. 旧判断缺这一行时记为未知，不当 0 也不当 1，列在 `undeclared_sweeps` 里，表示上端只是 N 的下界。Agent 能如实重建 K 的，可以各用一次取代写上。同一条取代链取申报过的最大 K，取代不能把数改小。
7. `all_purpose_trials` 保持“试验数”的含义（IDE `Recommendation.tsx`、`graph.schema.json`、`report/graph.py` 都按这个读）。
8. 同时生效的 -25：未登记规则的收益、PnL、回撤不再离线算（要看就 `replay explore` 或登记），K 主要计信号、日期类的选择视图。
9. 要同步的文本：`research-round/SKILL.md` 的试验数一句、`ratios.md`、`cli/research_commands.py` 的 `research status` 说明、`feedback.md` 的 search_exposure 一句（写明 K 的定义）、设计站 `design-database-judgments.zh.mdx`。

以后账本若有多版本读取，可以把解析出的值挪进一列，按 (a) 再审一次。
