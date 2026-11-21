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
| 20261120-04 | IDE 不绘制 `history` 与 `validation` 运行：`Runs` 与 `Details` 只画研究运行，关线历史段和样本外运行看不到权益曲线、日历与成交 | **当前产品**：`ide/web/src/model/stage.ts:23` `drawable = t.purpose === "research" && t.eligible === true`，`widgets/detail/ReplayTable.tsx` 用同一判定；`report/graph.py:427-440` 只给 `purpose == "research"` 的运行算四项读数与资格。这些运行在账本里已封存读数、日收益与周期。<br>**消费者**：复盘关线或验证结果的用户 | fix（放开 `history`、`validation` 封存运行的加载与绘制） | unknown | open |
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
- 2026-11-21 `20261120-09` 计量后关闭，动作 none：在隔离的临时账本与临时市场上用 `replay explore` 计量（不是完整的封存 `line history` 路径），每段市场导出 1.4–4.2 秒，约占一段回放的 2–13%，按日交易的候选 8–12%。按导出身份共享最多省几个百分点，且只在预热、合约与 `include_*` 旗标都相同时可行，不改。
- 2026-11-21 `20261120-04` 只修了 `validation` 运行（[#3216](https://github.com/qOeOp/trade/pull/3216)）。`history` 运行仍不能在 `Runs` 里绘制：`registration/availability.py` 对非 `research`、`validation` 用途给出 `PURPOSE_NOT_COMPARABLE`，`replay report` 因此遮蔽其读数、`--tables` 拒绝。放开属于改拒绝与可用性判定，需用户授权；不放开时，历史段读数只在 `Line-close history` 页面（`research history`）可读。
- 2026-11-21 用户对含 `20261120-01` 的授权清单答复「我都授权」。`report/history.py` 的 `_veto` 把没有 `passed` 运行的非整年否决段（如封存为 `invalid` 的首年）记入 `missing`（`veto YEAR`），与缺读数的整年否决段一样使汇总结论为未定；`passed` 的非整年段仍不进任何汇总。`line close` 不读结论，不变。
