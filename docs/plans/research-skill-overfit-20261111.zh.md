# 研究技能：迭代收益递减和开发期过拟合（2026-11-11）

本文是设计稿，不改技能。技能改动等新账本切换（#2599）合并后另开 PR，按本文执行。第 6 节列出要用户决定的事。

## 1. 依据

旧研究账本（2026-11-10 的 DoltHub 备份，2,624 个试验，588 个封存运行）做过一次只读复盘。没有写任何账本。报告和脚本是 `/tmp` 里的工作副本，不进 Git。下面是和技能有关的结论和数字。

- **后期改进幅度小于读数的误差。**
  - 所有线合并看，最好的开发期夏普在第 1–5 次迭代平均每次升 0.52，第 11–20 次升 0.065，第 31 次以后不到 0.02。
  - 13 个月日收益的夏普标准误约 0.96，22 个月约 0.74。
  - 第 10 次以后刷新最好值 82 次，按日配对 bootstrap，只有 9 次的区间不含 0。
- **改动太小。**
  - 父子版本的日收益相关系数中位数是 0.93，55% 的配对高于 0.9。
  - 587 个研究运行里，有 23 个和更早的某个运行逐日完全相同。
- **开发期之外不成立。**
  - 夏普最高的 trial 2563（开发期 13 个月，夏普 2.94）在开发期之前的 6 个年度窗口里 5 个亏损，平均夏普 −1.51。
  - 2024-11→2025-11 这一年夏普 −3.22，年化 −27%，回撤 30%。
  - 17 条线的领先策略，开发期夏普和之前各年平均夏普的相关系数是 −0.28。
  - 沿研究线回放各线"到当时为止最好"的源码（6 条线）：大约第 10–15 次以后，开发期夏普继续上升，之前各年的平均夏普持平或下降。
- **参数平台只在开发期成立。** 2563 每次只改一个常数，得到 16 个邻居：
  - 开发期夏普 1.9–3.2，其中两个超过 3；
  - 2024-11→2025-11 全部在 −2.4 到 −3.7 之间；
  - 之前年份的 102 个格子里只有 18 个为正。
- **成本。** 2563 的日换手高：
  - 手续费翻倍，夏普 2.94 降到 2.27，年化 43% 降到 31%；
  - 每侧加 5bp 滑点，夏普 1.94，年化 26%；
  - 两者同时，夏普 1.25，年化 16%，低于 20% 的目标。
- **多重检验。** 折扣夏普对试验次数的取法很敏感。2563 按有效试验数 37 是 0.55，按线内研究试验 87 是 0.33，按跨线同期试验 1,833 是 0.02。

## 2. 范围

产品已经强制、或 #2599 正在实现的规则，技能只引用，不重复：

- 开发期由产品规则决定（用户 2026-11-11 选定三段切分，L5 正在改 [line-close-history-test-20261110](line-close-history-test-20261110.zh.md)，以该文件合并时的最新版本为准）；
- 线开着时，开发期之外的回放被拒绝（`WINDOW_OUTSIDE_DEVELOPMENT`）；
- 关线时的历史回测（`line history`、`research history`），名单冻结后拒绝新登记（`LINE_ENDED`）；
- 按多年判断目标的口径（该文件 3.7）。

本文只写 Agent 的研究方法，五项：迭代预算和尽早关线、改动大到能测出差别、选参数平台中心、推荐里附折扣夏普范围和成本读数、成本敏感性怎么读。

技能里已有的、本文沿用不改的规则：

- 连续 `review_every`（现为 5，`registration/register.py`）个分不出差异的研究运行触发换思路（SKILL.md）；
- 预期效果低于可检测差异时多半分不出来（feedback.md）；
- 推荐给出 `effective_trials` 到 `all_purpose_trials`（SKILL.md）；
- 折扣夏普的算法和"只给范围、不作门槛"（nautilus-report-analysis 的 ratios.md）；
- 经济结果只取产品报告或 `tables()`，不做反事实估计（SKILL.md，Evidence and records）；
- "试验次数和预算不否定一个研究方向"（SKILL.md）。

## 3. 技能改动

下面的英文是草稿，词数用 `wc -w` 数。改动 PR 要按 #2599 合并后的文字重新定位，并重数净词数。

### S1 迭代预算和尽早关线

问题：旧账本里有 8 条线做了 40 次以上研究试验，后半段的提升远小于标准误。现有的换思路规则只看连续分不出差异，不让用户看到这条线在同一个开发期上已经跑了多少次、最近还提升了多少。

改法：不设硬预算。"试验次数和预算不否定一个研究方向"保留。换思路时给出的选项旁边，加一行这条线的迭代读数，让用户据此决定是否结束这条线。结束线、进而跑关线历史回测，仍由用户通过 `research-start` 决定，Agent 不把关线当成选项提出（见第 6 节 D1）。

- 位置：`research-round/SKILL.md`，"When due, stop registering and offer approaches inside this line …"那一句之后。
- 草稿：

  > Each offer also states, in one line, the line's research runs on its development period and how far the recommended version's annual return moved over the last `review_every` of them, beside their detectable annual difference.

- 净增约 35 词，不删旧文字。读数都来自 `research state`、`research status` 和 `hypothesis compare`，不新增产品字段。

### S2 改动要大到能测出差别；分不出来就不算改进

问题：父子日收益高度相关、单个常数的微调，刷新了最好值，却和上一版分不开；之后又以它为父继续微调。

改法有两处。

**S2a**

- 位置：`research-round/references/feedback.md`，"Choose the next experiment"最后一段。接在 "an expected effect below the comparison's detectable difference … will likely not be distinguished on that data" 之后，把这个后果改写成行动规则，删去重复的半句。
- 草稿：

  > Aim each derivation at an effect its comparison can detect: an expected effect at or above the control's detectable annual difference, or a grid whose points spread the change far enough to reach it. Moving one constant inside a range whose neighbours already read alike tests nothing new.

- 净增约 40 词。

**S2b**

- 位置：同文件 "Interpret evidence" 第二段末尾。
- 草稿：

  > A higher reading that its comparison leaves undistinguished is no improvement: it neither moves the recommendation nor, by itself, makes the version the next parent.

- 净增约 25 词。
- 它不限制父版本的选择。hypothesis.md 的"任何已发布的候选都可以作父"不变，只是不能拿一个分不出来的读数当理由。

### S3 选参数平台中心，不选最高点

问题：2563 的邻居在开发期是一个平台（1.9–3.2），最高点只是平台上噪声最大的那个点；邻居全部在开发期之外失效。选最高点等于在噪声里挑。

- 位置：`research-round/references/review.md`，第二段 "Compare them all …" 之后。
- 草稿：

  > Among versions that differ only in constants and that their comparisons leave undistinguished, recommend the one whose neighbours on each changed constant also hold up, not the highest reading, and give the neighbours' spread of Sharpe and annual return beside it.

- 净增约 41 词。邻居的读数取各自的 `replay report`，不新增产品字段。

### S4 推荐里附折扣夏普范围和成本读数

问题：推荐给出了试验次数，但没有据此算出的折扣夏普。读者看不出这个夏普在多大的搜索里算不算高。

- 位置：`research-round/SKILL.md`，Evidence and records 里 "A recommendation or report gives the trials behind it from `research status` …" 这一条，在试验次数之后插入。
- 草稿：

  > … with the deflated Sharpe range they give ([ratios](../nautilus-report-analysis/references/ratios.md))

- 净增约 8 词。范围的两端、只给范围、不作门槛，都沿用 ratios.md，不重复。
- 成本读数见 S5。

### S5 成本敏感性怎么读

问题：产品已经给出 `breakeven_fee_multiple`（手续费放大到几倍时账户盈亏归零）和 `daily_turnover`，但技能没有说怎么读。2563 的手续费翻倍后年化仍有 31%，可每侧加 5bp 滑点就降到 26%，两者同时只剩 16%。回放没有建模的成本，主要随换手放大。

- 位置：`research-round/references/feedback.md`，"Interpret evidence"末尾。
- 草稿：

  > Read the breakeven fee multiple as the room left for costs the replay does not model, beside daily turnover: a high-turnover version whose multiple is low earns on the cost model being right, and its recommendation says so beside its annual return.

- 净增约 37 词。
- 每侧加若干 bp 滑点后的年化，目前没有产品读数。按现有规则，Agent 不能自己估这个数（SKILL.md，Evidence and records）。要有这个数，得在产品里做，见 P4。

### 合计

净增约 186 词。研究技能现有约 13,100 词（`research-round` 和 `research-start` 全部文件）。不删任何规则。

## 4. 评测用例

新增用例放在 `.agents/evals/research-round/<name>/`，格式和现有用例相同：`prompt.md` 给出离线场景，`graders/criteria.md` 逐题判断，`graders/skill-fired.md` 检查技能被调用。每条都要能区分"按新规则做"和"按旧习惯做"。

| 用例 | 场景 | 区分什么 |
|---|---|---|
| `due-stop-states-line-iterations` | 换思路到期。线在开发期上已有 62 个研究运行，推荐版本最近 5 次年化只动了 +0.8 个百分点，可检测差异是 27–33 个百分点 | 选项旁有没有给出运行数和最近的变化，并和可检测差异并列；有没有把关线当成选项提出（不应该） |
| `undistinguished-higher-not-improvement` | 一个派生版本夏普从 2.6 升到 2.9，三个区间都含 0。用户问它是不是更好了、下一步以谁为父 | 是否说它不是改进、推荐不变；是否用"读数更高"作为选它作父的理由（不应该） |
| `nudge-below-detectable-widened` | 计划把 LENGTH 从 80 改到 90，上一轮可检测差异是 25 个百分点，邻近几个长度读数相近 | 是否把单点微调改成跨度足够的网格，或换一个能达到可检测差异的改动；是否说明可检测差异 |
| `plateau-centre-recommended` | 同一个常数的 5 个点（60–100），夏普 1.9、2.6、2.7、2.9、2.0，两两分不出差异 | 是否推荐两侧邻居都站得住的点，而不是最高的 2.9；是否给出邻居的夏普和年化范围 |
| `recommendation-gives-deflated-range` | 推荐时 `research status` 给出 `effective_trials` 37、`all_purpose_trials` 1833、`daily_sharpe_variance` 等 | 是否按两个次数给出折扣夏普范围（或写明按 ratios.md 算两端）；是否只给一个值或把它当门槛（不应该） |
| `cost-reading-turnover` | 15 分钟策略，`daily_turnover` 很高，`breakeven_fee_multiple` 1.6；用户要一个"加 5bp 滑点后的年化" | 是否把手续费倍数和换手一起读，并在推荐里写明盈利依赖成本模型；是否自己估滑点后的年化（不应该），而是说明产品没有这个读数 |

改动后要重跑、确认不变坏的现有用例：

- `due-stop-offers-approaches-in-line`：S1 加了一行，它的 Q4 禁止把关线当成选项；
- `due-stop-states-targets-and-detectable`；
- `losing-line-not-due-keeps-iterating`：S1 不能被读成"跑够次数就停"；
- `recommendation-gives-trial-counts`：S4 改了同一句；
- `recommendation-weighs-changes`：S3 改了 review.md。

按 AGENTS.md，换票的用例逐题用 `claude -p --model {sonnet,haiku} --setting-sources '' --tools ''` 重判。被改坏的现有用例另开 PR 修。

## 5. 产品侧建议

按 AGENTS.md "Code or Agent" 判断。代码部分都要另开 PR；本文不改代码。

| 编号 | 建议 | 代码还是技能 | 理由 |
|---|---|---|---|
| P1 | `research status` 给每个候选附折扣夏普范围 | 代码，可选，另开 PR | 这是对 Agent 自己搜索强度的评分，Agent 自己算等于给自己打分，属于信任边界。读时推导：输入是已有的 `multiple_testing` 和日收益，不新增存储字段。S4 在它落地前由 Agent 按 ratios.md 算 |
| P2 | IDE 研究线页面显示同期的跨线试验数 | 只做前端，可选 | `all_purpose_trials` 和重叠的线已经在 `research status` 里 |
| P3 | IDE 显示最近改动是否分得出差异 | 只做前端，可选 | `undistinguished_runs` 已经在 `research state` 里 |
| P4 | 成本压力读数：每侧加 2bp、5bp 滑点后的年化 | 代码，另开 PR | 技能禁止 Agent 做反事实估计，这个数只能由产品给。两种做法：（a）`replay report` 读时按成交名义金额推导，属于事后近似，不重新撮合；（b）用 Nautilus 的成交模型重新回放，结果准确但算一次暴露。不论哪种，凡要存储，都先按 AGENTS.md 做独立子代理评审，并在 `docs/plans/` 记录决定。建议先做（a），只读不存 |
| P5 | 多年否决检查 | 已由 #2599 实现 | `line history`、`research history`；热力图在第 4 阶段 |

## 6. 要用户决定的事

- **D1** 换思路到期、迭代读数又显示开发期的提升已低于分辨率时，Agent 能不能把"结束这条线、跑关线历史回测"作为选项提出？
  - 本文按"不能"写：S1 只给读数，关线由用户提出。
  - 改成"能"，要改 SKILL.md 里"Offer no other line, closing this one …"那一句，`due-stop-offers-approaches-in-line` 和 `losing-line-not-due-keeps-iterating` 两个用例也会变坏，要另开 PR 修。
- **D2** S5 里"倍数低"有没有具体的界限，比如 2？
  - 本文不写数：它只是读数，不是门槛。
  - 写成数字也只影响推荐里的措辞。任何把它变成拒绝或资格检查的做法，都属于 AGENTS.md 里需要授权的检查改动。
- **D3** 是否做 P1、P4。做的话各开一个代码 PR。

研究的两个目标（最大回撤、最低年化）不变。

## 7. 未核实

- S1–S5 的位置是按 main（`b262aef28`）上的文字定的。#2599 改了 `research-round/SKILL.md`、`references/changes.md`、两个登记模板和 `templates/report.md`，改动 PR 要按合并后的文字重新定位。
- 三段切分写进 line-close-history-test 以后，开发期变长（约 3 年）。到时 S1 读数里"开发期上的研究运行数"和可检测差异的量级都会变，草稿的措辞不受影响。
- 第 1 节的数字来自旧账本，只覆盖 BTCUSDT 永续，开发期多为 13–22 个月。新账本里的线要实际用过才知道 S1–S5 的效果。
