# 2026-11-20 关线历史证伪、History 页面与 Validation / Paper / Live 准入

用户审视关线功能（`line history`、`line close`、`research history` 与 IDE `Line-close history` 页面）、证伪判定、样本外验证入口、Live 准入条件，以及最近两条研究线（Line 2 `hf-15m-vwap-reversion`、Line 3 `hf-15m-vwap-broad-reversion`）的工作流时提出问题。本记录只收经代码核实的缺陷与需要用户定夺的事项；对研究方法、职责目录、全仓架构与文档规模的重设计意见，以及与已记录用户决定冲突或无法在代码上核实的说法，不记为发现。

| Item | Value |
|---|---|
| Sessions | Google Antigravity：Line 2 主会话 `2005d252-349a-4d8d-9174-81ae73d419cb`（2026-11-18..19）；Line 3 主会话 `37b4ec7d-3123-473d-a023-f04e6afc297f`（2026-11-19）与关线会话 `c0c6cca5-293d-495d-98e0-c304206c51f0`；Line 1 并发关线会话 `eec22f6c-92b2-4140-ac83-ac6cbd937766`；起止时刻 unknown |
| Audit session | Google Antigravity，会话 `3faf0faf-a726-475a-82fb-87fa54a42531`（Gemini 4 Argon），2026-11-20，写 PR [#3201](https://github.com/qOeOp/trade/pull/3201)；按评审删改与核实由 Claude Code（Claude Opus 5.5）完成，同一 PR |
| Checkout / ledger | `origin/main` `dadab781a`；活动账本提交 `rah0i0u9ehq2besq95isujpun0lkqerm` |
| Coverage | `ledger/lines.py`、`replay/history.py`、`report/{history,graph}.py`、`registration/{validation,register}.py`、`cli/replay_commands.py`、`paper/compare.py`、`live/runs.py`、`ide/web/src/{widgets/history/*,model/history.ts,model/stage.ts,widgets/detail/ReplayTable.tsx,model/liveLaunch.ts,widgets/live/LiveLaunch.tsx}`、`.agents/skills/research-round/SKILL.md`。缺口：会话轨迹里的次数与耗时（拒绝次数、关线时长）出自审计会话的读数，删改时没有复核；没有原生复现 |
| Cost | unknown（研究、发现、修复、等待的时间分摊没有计量）；未写账本或市场，0 个无效试验 |
| Net change | 本记录不改产品代码与 skill；拒绝码 249，skill 词数 28,094 |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261120-01 | 关线证伪只看整年否决段：不是整年的否决段即使封存为 `invalid`（审计失败，如 `UNPROTECTED_POSITION`）也不进否决结论，候选的汇总不因它缺项或不达标 | **当前产品**：`report/history.py:64` `_whole_year` 只认 1 月 1 日到次年 1 月 1 日；`_veto`（`:111`）只收 `kind == "veto" and whole_year` 的格子，非整年格子无论 `status` 如何都被跳过，`missing` 也不含它。市场首日之后叠加预热，首个日历年的否决段不是整年（审计会话在 `price-action-trend-second-entry` 上读到 2020 段为 `invalid` 的候选，删改时未复核）。<br>**消费者**：`research history`、IDE `Line-close history` 的结论列。<br>**要定的**：非整年否决段为 `invalid` 时是否计入 `missing` 或判否决不通过，这是改证伪判定 | authority（改证伪判定规则；问用户） | unknown | fixed 0944d9465 [#3223](https://github.com/qOeOp/trade/pull/3223) |
| 20261120-02 | `Line-close history` 默认隐藏 `noEdge` 行只看否决年收益中位数，留出期达标或为正的候选也被默认藏起 | **当前产品**：`ide/web/src/model/history.ts:74` `noEdge = (row.summary?.veto.median_annual_return ?? Infinity) <= 0`，不读 `holdout` 读数与结论。<br>**消费者**：在关线页面挑候选的用户；默认视图把可能值得看的行藏起 | fix（`noEdge` 同时看留出期读数，或只在两段都无优势时隐藏） | unknown | open |
| 20261120-03 | `line history` 把封存为 `invalid` 的历史段当作已完成，续跑不再重跑；因环境或瞬时故障失败的段让该候选永久缺项 | **当前产品**：`ledger/lines.py:366` 取 `status is not None` 的历史试验，`:380-384` 据此设 `done`；`replay/history.py` 只跑 `done is None` 的段。<br>**消费者**：`line history` 续跑与 `research history` 的缺项。<br>**要定的**：是否允许重跑 `invalid` 历史段、按什么条件区分环境故障与策略本身的审计失败；改历史试验的重跑规则 | authority（问用户） | unknown | open |
| 20261120-04 | IDE 不绘制 `history` 与 `validation` 运行：`Runs` 与 `Details` 只画研究运行，关线历史段和样本外运行看不到权益曲线、日历与成交 | **当前产品**：`ide/web/src/model/stage.ts:23` `drawable = t.purpose === "research" && t.eligible === true`，`widgets/detail/ReplayTable.tsx` 用同一判定；`report/graph.py:427-440` 只给 `purpose == "research"` 的运行算四项读数与资格。这些运行在账本里已封存读数、日收益与周期。<br>**消费者**：复盘关线或验证结果的用户 | fix（放开 `history`、`validation` 封存运行的加载与绘制） | unknown | fixed d83254243 [#3224](https://github.com/qOeOp/trade/pull/3224) |
| 20261120-05 | 样本外验证登记不要求候选先经关线证伪：研究中用户接受一个候选即被问是否验证，`validation register` 不看候选的关线历史结论 | **用户指出**：样本外验证应只作用于未被证伪的候选，入口放到关线页面。<br>**当前产品**：`.agents/skills/research-round/SKILL.md:172-176` 在用户接受候选时问一次是否验证；`registration/validation.py:141` `validation_register` 不读 `research history`。<br>**要定的**：是否把“关线未证伪”作为验证登记的前提（新增拒绝），以及技能里提问的时点 | authority（新增拒绝与改技能流程；问用户） | unknown | open |
| 20261120-06 | Live 准入不看候选是否已被关线证伪，也不要求跑过 Paper 并通过 `paper compare` 对账 | **用户指出**：Live 应只在候选未被证伪、且 Paper 运行一段时间并对账无误后才允许启动。<br>**当前产品**：`live/runs.py:358` `_evidence` 与 `:430` `prepare_locked` 只要求一条匹配合约与回放代码的 `passed` 回放；`paper/compare.py` 不写账本（用户 2026-10-26 决定，见该文件模块说明），其结论无处可读。<br>**要定的**：加哪些前置条件（新增 Live 拒绝）；若要读对账结论，需保存它，这是新增存储字段，按 AGENTS.md 先做独立子代理评审并在 `docs/plans/` 记录，再逐字段问用户，且与 2026-10-26 的决定相关 | authority（新增 Live 拒绝；可能的存储字段需评审后问用户） | unknown | open |
| 20261120-07 | 开发期按覆盖季度二选一：覆盖不足 24 个完整季度的合约组合开发期从 12 季度降到 4 季度，覆盖 23 季度的组合也只得 1 年 | **会话证据**：Line 2 与 Line 3 的合约组合含 2020-09 上市的 `SOLUSDT`，开发期为 `2023-10-01..2024-10-01`。<br>**当前产品**：`ledger/lines.py:97-98` `DEVELOPMENT_QUARTERS = (12, 4)`、`STANDARD_COVERAGE = 24`（注释为用户 2026-11-11 定），`:163` 二选一。<br>**要定的**：是否把阶跃改成按覆盖分级；这是用户定的窗口规则 | authority（改用户定的窗口划分；问用户） | unknown | open |
| 20261120-08 | `replay run --registration` 不带 `--market-day` 时取市场最新日而不是登记的 `market_day`，市场跨日推进后必报 `EXECUTION_MISMATCH` | **会话证据**：两条线跨日后多次以 `EXECUTION_MISMATCH ... market_day` 被拒，补传 `--market-day` 后通过（次数出自审计会话，未复核）。<br>**当前产品**：`cli/replay_commands.py` 的 `replay run` 用 `_market_day(command)`，默认 `head`；`registration/register.py:704-713` 比较试验与登记的 `market_day`，不同即拒。登记已存 `market_day`，默认值可以从它读。<br>**消费者**：每次跨日或与 `market-import` 同跑的研究回放 | fix（带 `--registration` 或 `--validation` 且未给 `--market-day` 时取登记的市场日） | unknown | open |
| 20261120-09 | `line history` 每个候选的每个分段都重新导出一次市场输入，同一分段在各候选间可能重复导出 | **会话证据**：三条线关线各耗时数小时（审计会话读数，未复核）。<br>**当前产品**：`replay/history.py:45-58` 对每个 `(候选, 分段)` 调 `registration_inputs.market_inputs` 再 `cleanup`；候选的合约选择与输入旗标可能不同，能否复用要先比对导出身份（`export_sha256`）。<br>**消费者**：关线耗时 | measure → fix（先计量导出在关线总耗时中的占比与同分段导出身份重复率，属实再按导出身份复用） | unknown | open |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| 本次无 | | | | |

## Decisions

- 2026-11-20 用户审阅关线、证伪、页面与 Validation / Paper / Live 准入的诊断后决定：“先都记着，然后提交 PR，之后 Claude 上线后会看到这些内容然后来改进。”
- 2026-11-20 用户要求审计最近两次研究流程后决定：“记录 并 提交”。
- authority 行（`20261120-01`、`-03`、`-05`、`-06`、`-07`）尚待用户决定。
- 2026-11-21 用户对含 `20261120-07` 的清单答复「我都授权」：开发期改为按覆盖分级，取 C − 8（留出期）− 4（否决段）个季度，最少 4、最多 12；留出期长度与位置不变，C < 12 仍以 `LINE_HISTORY_SHORT` 拒绝，已开的线保留存下的开发期。C ≥ 24 与 C ≤ 16 与原规则相同，C 在 17～23 之间开发期为 C − 12 个季度、否决段 4 个季度（覆盖 23 个季度得 11 个季度）。
- 2026-11-21 `20261120-09` 计量后关闭，动作 none：在隔离的临时账本与临时市场上用 `replay explore` 计量（不是完整的封存 `line history` 路径），每段市场导出 1.4–4.2 秒，约占一段回放的 2–13%，按日交易的候选 8–12%。按导出身份共享最多省几个百分点，且只在预热、合约与 `include_*` 旗标都相同时可行，不改。
- 2026-11-21 `20261120-04` 只修了 `validation` 运行（[#3216](https://github.com/qOeOp/trade/pull/3216)）。`history` 运行仍不能在 `Runs` 里绘制：`registration/availability.py` 对非 `research`、`validation` 用途给出 `PURPOSE_NOT_COMPARABLE`，`replay report` 因此遮蔽其读数、`--tables` 拒绝。放开属于改拒绝与可用性判定，需用户授权；不放开时，历史段读数只在 `Line-close history` 页面（`research history`）可读。
- 2026-11-21 用户对含 `20261120-03` 的授权清单答复「我都授权」：`line history` 每次调用在跑完没有运行的段之后，把最近一次历史运行为 `invalid` 的段再回放一次（每段每次调用最多一次）；新试验取代旧的无效试验，旧试验留在账本；`research history` 每段只读最近一次有运行的试验，被取代的列在 `superseded`；统计计数把与先前计数的历史试验身份完全相同的重跑当作复现，不重复计。无效段仍算有运行，`line close` 不因它拒绝。账本 `trial` 表对历史试验没有按段的唯一约束（`op_id` 含随机工作目录），不需要新字段。
- 2026-11-21 用户对含 `20261120-01` 的授权清单答复「我都授权」。`report/history.py` 的 `_veto` 把没有 `passed` 运行的非整年否决段（如封存为 `invalid` 的首年）记入 `missing`（`veto YEAR`），与缺读数的整年否决段一样使汇总结论为未定；`passed` 的非整年段仍不进任何汇总。`line close` 不读结论，不变。
- 2026-11-21 用户对 `20261120-15`（Catalogue-Guided Agentic Reasoning，来自 [#3201](https://github.com/qOeOp/trade/pull/3201)）答复「按照你的建议来」。核实：Line 1 的三次换思路（判断 #33、#82、#99）都写了带计数的 `Bottleneck:`；两条 15m VWAP 线的九次（#126、#139、#149、#159、#167、#191、#202、#211、#226）一次也没写，且都是同一机制内的阈值微调。改动：research-round `feedback.md` 的 Change approach 去掉“瓶颈不清时”的条件，每次换思路先点名一个瓶颈（机会、信号质量、成本、资金使用、尾部回撤）并引用显示它的报告切片与度量，每个思路说明针对哪个瓶颈，判断正文写出瓶颈（净 +24 词）。新评测 `change-names-bottleneck-first`（重写一次，去掉了过滤跳过计数这一过强提示）：运行器 3 次，有 skill 3/3、无插件 1/3；sonnet 逐题复判有 skill 3/3、无插件 0/3。旧 skill 对照（origin/main 的 `.agents` 加本例）运行器 3/3、sonnet 复判 2/3：题面摆出切片读数时旧条件句已多半能引出瓶颈，本例主要守住“有 skill 时点名瓶颈并对准它”，测不出新旧措辞的差别。research-start 的新起点多样性另行计量：所有已关线同为 15m VWAP 回归时，有 skill 运行器 3/3、sonnet 复判 3/3 给出机制不同的起点，无插件运行器 1/3、复判 1/3；有 skill 不失败，`SKILL.md` 不改、该候选评测不入库。
- 2026-11-21 用户对含 `20261120-04` 余项的授权清单答复「我都授权」，授权只放开 `history` 运行的可用性判定。`registration/availability.py` 的用途闸门改为封存运行的全部用途（`ledger.trials.RUN_PURPOSES`：`research`、`validation`、`history`），`PURPOSE_NOT_COMPARABLE` 只留给不封存运行的 `precheck`、`explore`；`history` 运行按与研究运行相同的口径判定经济证据（源码审查失败、无真实成交等仍使其失格），`replay report` 不再遮蔽其读数、`--tables` 可读，IDE `Runs` 与 `Details` 可选中并绘制。比较、排名与关线候选的隔离不变：`registration.comparability.COMPARABLE_PURPOSES` 仍只收 `research`、`validation`（`hypothesis compare` 对 `history` 运行仍拒 `RUN_NOT_PASSED`），研究运行列表、多重检验计数、比较表与 `history_participants` 都按 `purpose = 'research'` 取数，`availability` 的 `applicability.comparable_purpose` 仍报可比性。`20261120-04` 由此全部修复（[#3224](https://github.com/qOeOp/trade/pull/3224)）。
- 2026-11-21 PR [#3201](https://github.com/qOeOp/trade/pull/3201) 的提议 `20261120-16`（报告缺去掉第一大合约后的净利，研究会话反复自算逐合约净值表看集中度：Line 2 的 13 条 `search_exposure` 判断全有，Line 3 的 8 条里有 6 条），用户答「按照你的建议来」：`by_instrument` 切面加读时派生的 `net_without_top_instrument`（闭仓净盈亏去掉沿总和方向贡献最大的一个合约，并给出它的名字；比较另给逐合约差上的 `pairwise`），从已存的 `run_cycle` 算，不加存储字段。逐合约明细表仍由 Agent 自算，提议里的明细表与对比表级滑点压力不在本次范围。
