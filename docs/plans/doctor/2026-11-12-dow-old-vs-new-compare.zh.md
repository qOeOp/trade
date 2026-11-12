# 2026-11-12 道氏研究改版前后对比的诊断

输入是一份只读对比报告（会话 `local_ca5306e1` 的侧会话写，`side-session-notes/local_ca5306e1-…/dow-research-compare-20261112/report.md`，附逐试验表、`scripts/`、`new/`、`old/`）：新账本的线 `dow-theory-btc-eth`（研究会话 b5788262，全量审计见 [b5788262 审计](2026-11-12-dow-theory-b5788262-full-audit.zh.md)）对比归档账本的 `dow-structure-4h`、`dow-volume-4h-b`。报告第 5 节的产品候选 C1–C5、第 4 节的新线问题 N1–N9 与旧线问题 O1–O6 逐条在当前产品上复核；报告的结论只作线索，下文每条结论都由本诊断自己的查询或代码位置支持。`t n` 是试验 n，`J n` 是判断 n，`reg n` 是登记 n。

| Item | Value |
|---|---|
| Sessions | 研究会话 b5788262（2026-11-11T15:05Z–11-12T10:16Z，转录已由 [b5788262 审计](2026-11-12-dow-theory-b5788262-full-audit.zh.md) 读过，本诊断不重读）；对比报告由会话 `local_ca5306e1` 的侧会话于 2026-11-12 22:30–22:57（本地时间）写成，只读账本、没有回放 |
| Audit session | Claude Code，Opus 5.5，会话 `e0f7fb4f-56a3-437e-beed-6d443739c7f9`，worktree `.claude/worktrees/vigorous-chandrasekhar-40db25`；本记录随索引一个 PR，没有修复 PR |
| Checkout / ledger | `origin/main` `88bde069d`。活动账本只读（`ledger sql`），读到的提交 `pio1ucfkr3muki15rspcnf0ijl4jvqe5`（与报告相同）。归档账本：`~/.local/share/trade/dolt-backups/dolthub-trade-research-20261110.*/backup` 用 `dolt backup restore` 恢复到本会话 scratchpad，只 SELECT（11-10 的 DoltHub 副本，2,624 个试验） |
| Coverage | 聚焦诊断（product-doctor 第 3–5 步），一题一题做，不是全量审计：没有分派三个工作流子代理，没有读研究转录（b5788262 审计已读），没有新的文献检索（-16、-17 的文献沿用 b5788262 审计）。核对过：`report/measures.py`、`report/history.py`、`report/status.py:769-797`（`_undistinguished_runs`）、`ledger/lines.py`（留出期）、`registration/precheck.py:39`、`ide/research_graph/layout.py:72-77`、`docs/plans/line-close-history-test-20261110.zh.md:197`；skill：`research-round/SKILL.md`、`references/feedback.md`、`hypothesis.md`、`review.md`，`research-start/references/recommendation.md`，`nautilus-report-analysis/SKILL.md`。缺口：旧账本 `search_exposure` 里有多少是“重标度日收益”的经济预览没能可靠计数（关键词匹配混进否定句），所以 -25 的跨会话复发未证实；旧账本是否仍在 DoltHub 公开未核实（11-11 起 DoltHub `vincent/trade-research` 是新建的空库） |
| Cost | 研究会话的代价已在 b5788262 审计计过；本诊断新增的实测：41 个研究运行里 36 个前两个开发年都不赚、只有第三年赚（-24），这一事实在会话中只出现在 Agent 自算的 J55，从未出现在产品读数里。本诊断约 1.2 h，token 未计 |
| Net change | 拒绝码 253（`shared/refusals.py` `CATALOGUE` 键；上份记录 252，差 1 来自 #2791 的 `PRECHECK_WINDOW_TOO_LONG`）。skill 词数 26,651（`.agents/skills/**/*.md` 全部 `cat \| wc -w`；上份记录 26,510，同口径）。本记录不改任何东西。授权项若全按建议：-24 读数加一组派生量（开发期分年年化与 MARK 回撤，读时由 `run_return` 派生，不加字段、不加拒绝码），`recommendation.md` 读数清单加约 6 词；-25 把 `SKILL.md:117-119` 与 `feedback.md:15-17` 两条合写成一条（约 +15 词、−0 规则：两条规则变一条带边界的规则）；-17 关线读数加一句先验暴露说明。增长理由写在各行 |

## 结论

报告的总判断成立：改版后的流程更诚实（3 年开发窗口、最小效应与目标挂钩、预测可计分、审阅与审计拦得住错误），但这条线没有一个运行同时达到两个目标，比较几乎从不分出结果，等风险下新线最好的版本只和旧线的样本外结果打平。这本身不是产品缺陷：开发期只能说明“在这三年里怎样”，真假要到关线的否决年份与留出期才看（报告第 7 节也说公平比较只能等那时）。产品层面能改的是三件事：开发期内“只靠一年”的事实没有产品读数（-24）；“离线算一下换个规则会怎样”这类经济预览的边界不清，且不进试验计数（-25、-16）；第一条线的留出期早已被归档账本搜过（-17 不再是潜在问题）。其余报告条目或已被修复覆盖，或是 Agent 已用现有指引正确处理，判 `none`。

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261112-24 | 开发期内的分年读数在产品里没有：`replay report`、`hypothesis compare`、`research status` 只给整窗读数，关线历史检验（`report/history.py`）只对否决年份分年、对开发期整段当对照。这条线的收益几乎全来自第三个开发年，从来没在产品读数里出现过，只在 Agent 自算的判断里出现 | 本诊断用 `ledger sql` 对 `run_return` 按开发年（2021-10、2022-10、2023-10 起）复利重算：41 个通过的研究运行里 **36 个第一、二年 ≤0、第三年 >0**，没有一个运行有两年达到 20%；推荐的 t85 三年 −10.7%、−4.9%、+130.3%（与报告 `new/years.csv` 一致）。报告的“2023-10→2024-04 之外 40/41 为负”是事后挑出最好 7 个月再去掉，有选择偏差，本诊断不用它。产品已有的集中度读数没有揭示这一点：t85 `months_won_share` 约 0.31，`residual_after_top5_days` 为正（去掉最好 5 天仍赚）。消费者：J55（推荐 @51）自己写了“return comes almost entirely from the long plans of the 2024 advance”，J56、J59、J63 从存储的日收益复利自算分窗回撤（如 J56：t85 最大 29.5% 在 2023 段、2024 段 28.8%），而 `nautilus-report-analysis/SKILL.md:30` 写着回撤只用报告的 MARK 最大回撤、不重算，缺分段读数时 Agent 绕过了这条；此后 @35 以后的改动围绕 2024 年 2–4 月这一段设计（J32、J39、J42 列出的都是 2024 春的日期，reg 19 的预测直接引 J42 的日期，J68 自己承认“any rule that only closes the added part acts on one episode”），用户 6 次换思路的选择（b5788262 审计 -15）也没看到分年读数。规范：`nautilus-report-analysis/SKILL.md:39` 要求反复驱动决定的自算量提议进读数目录；用户 11-11 认可的三段切分原文写着“要求窗口内每一年单独都不太差”（`side-session-notes/local_4fecb3e2-…/iteration-overfit-study-20261111.md:29`），而 `line-close-history-test-20261110.zh.md:197` 明说“按季度看开发期内的稳定性……本计划不包括这一项”，于是用户认可的这一半没有落地。旧线 O4（后期迭代只抬高开发窗口）是同一现象在单一行情窗口上的样子 | authority：A（建议）把开发期分年年化与 MARK 回撤加进单次报告与比较的读数（读时派生，不存储），并在 `recommendation.md` 的读数清单里写一句；B 在 A 之上把“开发期每一年都不太差”定为推荐或资格条件（这改变目标的判法，阈值由用户定）；C 不改产品，只靠 Agent 自算。先排除：`none` 不够，因为 Agent 算了也写了，用户的换思路选择仍按运行次数走，自算量没有独立复核，而且为了算它 Agent 绕过了“不重算回撤”的规则；只改 skill 不够，因为自算是 Agent 给自己打分 | hours（推荐与换思路在约 19 h 里没有这项读数；可归因的部分未计量） | open |
| 20261112-25 | “用对照的日收益离线模拟一个还没登记的规则”算不算被禁止的反事实估计，skill 里两条规则互相拉扯：`research-round/SKILL.md:117-119` 不许“substitute counterfactual estimates”推断经济结果，`references/feedback.md:15-17` 要求把自算视图记为 `search_exposure`。会话按后一条记录、按前一条声明“no economic evidence”，然后用它挑了要登记的方向 | J21（03:37Z）：对 t40 的日收益离线套几十种回撤缩放（全程、入场后、30–180 天滚动峰值，单向与双向，下限 0.15–0.5），近似复现了 t46/t47 的年化（3.7%、4.8% 对 3.8%、5.4%），并写明“It chose the trailing-peak hypothesis for dow-theory@31 and @32”；J22 同法试市场回撤叠加，看到 15% 阈值上回撤变大仍按源码的 15% 登记（reg 9，t52 结果比对照差）；J24 同法排出优先级。这三条都是在开发窗口上对一个规则的经济预览，而产品对源码的同类预览设了 7 天上限（`registration/precheck.py:39`，-08 用户已授权事先拒绝），离线预览绕过了这道边界。消费者：登记的选择、有效试验数 N（-16） | authority：建议把两条合成一条：未登记规则的经济读数（任何由收益、PnL、回撤推出的“如果这样会怎样”）就是反事实估计，不算、不写，要知道就登记它去回放；只读信号与日期、不碰收益的视图照旧记为 `search_exposure`。另一选项：允许，但每个变体按 -16 计入 N。先排除：`none` 不够，因为会话两条都“遵守”了仍得出相反用法；删除任一条都会丢掉另一条的保护 | minutes（直接代价是 J21 选出的 @31/@32 后因预检窗口误用作废；对 N 的低估见 -16） | open |

已有条目的新证据：

| id | 本次 | 新状态 |
|---|---|---|
| 20261112-15 | 第一步（`hypothesis compare` 加回撤差与区间，#2804，合入 a3278aa06）已合入；计数规则尚未按量测重定。新证据：比较设计 3、4 的 `design_reason`（本诊断 `ledger sql` 读 `comparison_design`）写着上次比较可检测 9–13、1.9–10.4 个点，并以“瞄准大效应”照登，正是 `feedback.md:33-38` 要求的做法，问题不在登记没有拦，而在登记前没有可用的可检测差估计（-15 原建议）。设计 4 把 `feedback.md:35-36` 的“it scales with position size”读成“加大仓位就能够到可检测差”，而仓位同时放大效应与噪声：reg 4 的 t26、t27 可检测差 20.7、10.4，对照 t15 本身 9.2，都没分出。改计数规则时顺带把那半句写成“仓位同比放大效应与可检测差，够不着的效应靠加仓够不着”（一句重述，不是新规则）。另：t110、t111 与对照 t105 逐日收益 1,096 天全同（`ledger sql`），也计入 `undistinguished_runs`（J68“two undistinguished runs since that choice”）；产品输出已是零宽区间（J66 读对了），-09 的修复会在登记前把这种情况判 `unresolved`；“与对照完全相同”该不该计数，归入本行待定的计数规则 | open |
| 20261112-16 | 用户 11-12 对审计待定项答“按建议做”：离线参数扫描计入有效试验数 N。索引此前没写进这一决定，也还没有 PR。新证据：除 J21、J22、J24 的经济预览（-25）外，J32、J39、J42、J65、J67 是只读信号的视图，变体数都写在正文里（如 J39 的 LINE_CONFIRM 2/3/5/10 与 LINE_WIDTH 0.75/1.25/1.5），reg 19 的预测直接引用 J42 的日期；J67 写明“settled what both drafted grid points would do … so neither was registered”，即离线结果替代了登记。按 -16 的决定实现时，N 的计数要能从这些正文读出变体数，否则要求 `search_exposure` 写明变体数 | open |
| 20261112-17 | 不再是潜在问题：第一条线 `dow-theory-btc-eth` 的开发期止于 2024-10-01，留出期 2024-10-01→2026-10-01（`ledger/lines.py` `holdout_end`，8 个季度）。恢复的归档账本里 2,624 个试验中 2,503 个的交易窗口与它重叠，589 个研究试验全部重叠，全部交易 BTCUSDT 或含它的池（本诊断 `dolt sql` 只读）。规则本身（Hamilton 1922）不来自那段数据，污染有限；但这些结果曾在 DoltHub 公开、也在本机记忆与笔记里（如 `iteration-overfit-study-20261111`），研究 Agent 可能读到。用户 11-12 定的“新账本第一条线关闭前再定”现在就指这条线：关它之前要回答 | open |

逐条结论（`none` 与归并）：

| 报告条目 | 结论 |
|---|---|
| C1 开发期分年读数缺失 | 证实，新发现 -24 |
| C2 `search_exposure` 边界 | 证实，新发现 -25；计数部分是 -16 的新证据 |
| C3 与对照完全相同 | 证实（t110/t111 1,096 天全同），`none` 作为单独发现：产品输出已是零宽区间、会话读对了（J66），-09（#2793 已合入）在登记前挡住改动路径没跑过的情况；是否计入换思路归 -15 |
| C4 留出期与旧账本搜索窗口重叠 | 证实，归入 -17（同一原因：留出期的新鲜度依赖产品看不到的先前搜索；同一处置：关线前由用户定怎么读） |
| C5 功效不足仍可登记 | 部分证实：设计 3、4 照 skill 瞄准了大效应，登记不该因此被拒；缺的是登记前的可检测差估计，归入 -15 |
| N1 迭代围绕一段行情 | 证实（见 -24 证据），归入 -24 与 -16：没有分年读数让它不显眼，离线视图不计数让它便宜。不另加“不要按某段行情设计改动”的规则：开发期本来就用来拟合，防线是否决年份与留出期 |
| N2 功效远低于最小效应 | 即 -15 |
| N3 推荐按分不出的读数换（J55） | `none`：`review.md:16-18` 要求只差常数且分不出的版本里推荐邻居也站得住的那个、并给邻居范围，J55 照做并写明“rests on readings, not on a comparison”与可检测差 49 点。推荐必须选一个，读数是唯一依据，已如实披露 |
| N4 登记前的经济预览 | 即 -25（及 -16） |
| N5 预检窗口误用 | 即 -08，`PRECHECK_WINDOW_TOO_LONG` 已在运行前拒绝（`replay/entry.py:452-455`，#2791），`none` |
| N6 改动路径没跑过就登记（reg 21、25） | 即 -09（#2793 已合入），`none` |
| N7 加仓换收益（@3→@25/@26） | 不成立：t4 到 t40 Sharpe 从 0.20 升到 0.66（与规模无关的量），回撤比收益从约 0.09 升到 0.60，不只是放大敞口；比较设计 5、6 自己写明是仓位改动、按目标读。`none` |
| N8 同分钟权益 | 即 -11（#2797 已合入），`none` |
| N9 t19/t20 错计暴露 | 即 -13（#2794 已合入），`none` |
| 预测多是改动的机械后果（136 条，`return_over_drawdown` 13/32） | `none`：`hypothesis.md:42-46` 要求每条预测同时写目录量的方向与产生它的成交或持仓行为，持仓时长、周期数这类就是在检查机制有没有起作用；24 次派生登记里 23 次另有 `return_over_drawdown` 或 `max_drawdown` 的经济预测，其命中率逐条可见。IDE 的版本标记（`ide/research_graph/layout.py:72-77`）把两类合成 held/failed/mixed，“mixed”不说哪条失败，但没见到哪个决定因此走偏，未计量 |
| O1 单一行情窗口 | 改版已修（三段切分、`WINDOW_OUTSIDE_DEVELOPMENT`），`none` |
| O2 最小效应为 0、改动太小 | 新线每次登记都是 0.02，未复发；完全相同的运行见 C3。`none` |
| O3 “改进”主要是放大风险 | 现有规则已覆盖（`feedback.md` 只放大仓位的运行不计数、`nautilus-report-analysis` 敞口写法），新线未复发（见 N7），`none` |
| O4 后期迭代只抬高开发窗口 | 证据归入 -24 |
| O5 文本无法审计 | 新线登记平均约 390 字符、可读，`none` |
| O6 审阅几乎不拦 | 新线 56 次拦下 10 次，`none` |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| `minimum_effect`（登记声明，没有检查读它，`hypothesis.md:58-60`） | 没有实际意义门槛的比较被当成证据 | 无；报告把它与可检测差并排 | 新线 25 次都设 0.02 并与目标挂钩；正是它让“可检测 33 点对最小效应 2 点”一眼可见 | 保留 |
| `undistinguished_runs` 把与对照完全相同的运行计入 | 一种思路的改动始终测不出差别 | 无 | t110/t111 计入；-09 修复后这类登记应在审阅时被挡 | 保留，计数口径随 -15 一起定 |

## Decisions

待用户决定的项（按建议排序，每项一个问题）：

1. **-24 开发期分年读数。** 现在产品只给开发期整段的读数；这条线 41 个运行里 36 个只在第三年赚钱，这件事只在 Agent 自己算的判断里出现过。建议 A：把开发期每一年的年化与回撤加进单次报告和比较的读数，推荐时必须列出（只是读数，不设门槛）。也可以选 B：再把“开发期每一年都不太差”定成推荐或资格条件（会改变目标怎么判，阈值由你定）；或 C：不改产品。
2. **-25 离线模拟规则的经济结果。** Agent 曾在登记前，用对照的日收益离线套几十种回撤规则，看哪种收益与回撤更好，再据此挑登记方向。skill 一条说不许用反事实估计经济结果，另一条说自算视图记下来就行，两条都被“遵守”了。建议：禁止这类经济预览（想知道就登记去回放），只看信号与日期的视图照旧可以记录；另一选项是允许，但每个变体计入有效试验数。
3. **-17 第一条线的留出期。** `dow-theory-btc-eth` 的留出期 2024-10→2026-10 与归档账本 2,503 个试验的窗口重叠（全部 589 个研究试验）。你 11-12 定的是“第一条线关闭前再定”，现在就是这条线。建议：关线读留出结果时写明这段历史已被旧账本搜索过多少次、哪些线，不改切分；前向段（2026-10 以后）与 Paper 是仅有的没被看过的数据。

已定未做：-16（用户 11-12“按建议做”：离线扫描计入 N），需要一个 PR；-15 的计数规则待量测。

## 圆桌裁决（2026-11-12）

用户把 -16、-24、-25、-17 的最终方案交给多 Agent 圆桌决定（“你自己参考开源和论文还有项目情况开多agent圆桌会议来决定最终方案”）。圆桌：文献、开源实践、项目约束三路取证；严谨、最少机制、用户目标三位评审各自提案；反方逐条攻击；主席裁决。主席引用的代码与 skill 行已在 `origin/main` `e936f5d2a` 上复核。各 PR 正文引用本节作为授权。

| id | 裁决 | 新拒绝或新要求 | 未采纳及理由 |
|---|---|---|---|
| -25 | 未登记规则的经济结果（收益、PnL、回撤、权益，包括对已存日收益的缩放或过滤）只来自产品计数的回放：草稿用 `replay explore`（strategy-authoring.md 的既有路径，explore 计入 `all_purpose_trials`）或登记。只看信号、日期、计数的视图照记 `search_exposure`。已发生的预览按 -16 申报 K，由它选出的登记引用那条判断。只改 skill：`research-round/SKILL.md` 证据一节重述为一句（不在回放外算规则的收益、PnL、回撤，选登记方向也不行），`feedback.md` 记录一句限定为信号、日期、计数视图，`nautilus-report-analysis` 加一个从句；加一个评测用例 | skill 规则收紧（J21、J22、J24 的做法被禁止）；代码无新拒绝 | 允许但按 K 计数：选择压力最大的变体由 Agent 自报，信任最弱，也不比禁止更可执行。禁止且不给 explore：基于对 `SOURCE_ALREADY_EXPOSED` 的误读（它只拒绝把已跑源码当新源码登记），会把查看推到记录之外 |
| -16 | 字段审阅方案 (b) 全做：`judgment add` 对 search_exposure（新写或取代）拒绝首行不是 `Evaluated variants: K`（非负整数、无前导零）的正文，拒绝码 `SEARCH_EXPOSURE_VARIANTS_MISSING`。K = 该视图拿这条线数据的任何结果（收益、PnL、回撤，或信号、日期落在已知价格路径上的位置）评估过的、未登记也未回放的规则或参数变体个数；在已知价格的窗口里列信号日期也算（J42、J67 计入）；不碰规则变体的视图才是 0。读数：`multiple_testing` 加 `sweep_variants`、`undeclared_sweeps`、`trials_with_sweeps`；`deflated_range` 上端用 `trials_with_sweeps`，`effective_trials` 与下端不变；取代链取最大 K；`trial_counts` 同步，IDE“Picked from”与 `research status` 一致；说明写明上端只计已申报的扫描，是 N 的下界 | `judgment add` 新拒绝（收紧检查） | 只走 explore、不加代码：J42、J67 这类选择视图进不了 N，缩窄了用户 11-12 的决定。不加拒绝：18 条自由文本判断没有一条解析得出数。新列：`SCHEMA_VERSION` 升版使第一代账本不可读。K 进 `effective_trials`：扫描没有收益序列，算不出相关 |
| -24 | 采用 A 的读数版：12 季度开发窗口的运行，读时从已存 `run_return` 按交易起点周年切出三个开发年，给每年复利收益对年化目标（达到或差多少）、“达标年数 k/3”、最差一年、去掉最好一年后的年化。进 `replay report`（与 `closed_by_year` 并列，纳入 `PERFORMANCE_KEYS` 的遮蔽）与状态比较表的两列仅展示字段（不进支配规则）；4 季度线不给。推荐与换思路报告必须列出 | 推荐、换思路报告的必列读数；无拒绝、无存储、目标不变 | 分年 MARK 回撤入封存读数：年内回撤不超过已存的整窗 MARK 回撤，要字段审阅与重封却不改判断。读时日收盘回撤：在 MARK 目标旁另立第二种回撤定义。B 门槛：三个观测、无公开阈值，否决年份已在样本外覆盖；用户以后要门槛，一致的形式是否决式（开发年收益中位数 ≥ 目标），需用户给阈值 |
| -17 | 不改切分。`line_history` 读时加 `holdout_prior_trials`：本账本里这条线的合约上、交易窗口与 [开发期末, 留出期末) 重叠的计数试验（任何用途、任何线，不含本线的历史检验试验），按线与用途分组，`research history --line` 与现有留出期折扣夏普并列；折扣夏普的 N 不变。`research-start` 关线一句写明留出期先前的搜索（产品数加账本外的）与前向读取日期，此后只有 Paper 与之后的数据没被看过。第一条线关线时由研究会话从归档账本的只读临时恢复读出 2,624/2,503/589 并写明 | 关线总结的必写项；无拒绝、无存储 | 改切分或挪留出期：不存在干净的 BTCUSDT 历史，且重写每条线的窗口、违背 11-11 决定。只用 2026-10 以后作留出：约一个月。第二个更大 N 的折扣夏普：方差只来自参与者，假精确。产品代码读归档库：为一次性需要加第二个数据库依赖 |

实施顺序（每个根因一个 PR，都基于 `main`，不叠）：1) -25 skill 与评测；2) -16 产品代码、读数、IDE、说明与 skill（在 1 合入后开，`feedback.md` 那句只改一次）；3) -16 使旧答案变错的四个评测用例单独一个 PR（recommendation-gives-deflated-range、recommendation-gives-trial-counts、recommendation-body-cites-trial-counts、dsr-uses-ledger-counts）；4) -24；5) -17。4、5 与 1–3 无依赖，可并行。五个都合入后第一条线才跑关线历史检验；之后研究会话用一次取代给 18 条 search_exposure 补上能如实重建的 K，下一次推荐写明 J21、J22、J24 是未计数的预览。另记：`closed_by_year` 有两份实现（`report/measures.py:657`、`ledger/metrics.py:387`），单独审。
