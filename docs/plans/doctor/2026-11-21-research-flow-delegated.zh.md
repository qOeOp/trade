# 2026-11-21 研究流程重判中委托决定的四项

| Item | Value |
|---|---|
| Sessions | 无研究会话；依据是 [0.5.0 全量重判](../rejudge-0.5-20261121.zh.md) 的 A-22/E-17、E-21、C-203、F-32 四行及其来源 |
| Audit session | Claude Code（Claude Opus 5.5），0.5.0 第三波研究流程 lane；修复 PR 见索引 |
| Checkout / ledger | `origin/main` `43ae50caa`；未读写账本或市场 |
| Coverage | 四行各自的 file:line 证据在 `origin/main` 上逐条复核过；缺口：重判表里来自旧账本的计数（审查耗时、`search_exposure` 条数）未重测 |
| Cost | hours（A-22/E-17：派生候选的源码审查 Line 2 19 次 150.4 min、Line 3 29 次 138.6 min）；其余 unknown |
| Net change | 一条推荐比较规则改动（非劣判定去掉胜率）、一条关线读数新增（计入跨线留出期试验数的 DSR）、两条审查与推荐的技能规则；不增拒绝码、不增存储字段 |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261121-22 | 派生候选的源码审查每次从零读父本，同批只差常数的网格点各起一个审查者 | **会话证据**：重判表 A-22（Line 2 19 次 150.4 min，Line 3 29 次 138.6 min）、E-17。<br>**当前产品**：`research-round/SKILL.md` 审查简报只收候选 id、预检包与技术报告，不给与父本的源码 diff，且一次一个候选；`ledger/schema.sql` 每个网格点引用自己源码的审查。<br>**消费者**：research-round 的审查步骤 | authority（审计流程：给审查者父本 diff 作事实输入；同批只差常数的网格点由一个审查者审完，每点仍各记一条审查） | hours | 见索引 |
| 20261121-23 | 关线留出期的 deflated Sharpe 只按本线参与者数折扣，不计已看过同一留出期的跨线试验；IDE 只对达标行显示 | **当前产品**：`report/history.py` `_discount` 的试验数是 `len(rows)`，同文件已算出 `holdout_prior_trials` 却只旁列；`HistoryPage.tsx` 在 `!meets_targets` 时显示 `—`。<br>**消费者**：关线判断与 IDE 的 Line-close history 表 | authority（改证伪读数：另给一个以参与者加先前试验为试验数的 DSR，方差仍用本线参与者；IDE 有读数的行都显示） | unknown | 见索引 |
| 20261121-24 | `research status` 比较表的非劣（支配）判定把计划胜率当第四个度量，AGENTS.md 写胜率只是报告维度 | **当前产品**：`report/status.py` `TABLE_MEASURES` 含 `plan_win_rate`，`_dominates` 逐项比较全部四个；`review.md` 要求推荐权衡其他线的 non_dominated 运行。<br>**消费者**：推荐与 `research status` 的读者 | authority（支配只用年化、MARK 回撤、夏普；胜率留在表里显示） | unknown | 见索引 |
| 20261121-25 | `bars` 执行下成交可超过该分钟市场总成交量（2005d252 step 946：`participation` 最大 268.29%，`above_volume` 2 笔），推荐流程从不看这个读数 | **会话证据**：2005d252 step 946。<br>**当前产品**：`ledger/metrics.py` 算 `above_volume`；`nautilus-report-analysis/references/capital.md` 说明参与率不设上限；`research-round` 技能里没有 `participation`。<br>**消费者**：推荐 | authority（新增推荐规则：`above_volume > 0` 时推荐须引用该读数，并在 `quotes` 执行下复跑或写明成交不可信） | unknown | 见索引 |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|

## Decisions

- 2026-11-21 用户把需要定夺的事项交给 Claude（「需要我定的部份最后也是一样由你决定按推荐做」），0.5.0 第三波研究流程 lane 据此按重判表的推荐决定：
  - 20261121-22：做。审查者的独立性不变：它仍无作者上下文、不收任何先前结论；父本 diff 是事实输入，api 项仍覆盖源码里全部原生调用。同批只差数值常数的网格点交给一个审查者，每点仍各自预检、各记一条四项审查。
  - 20261121-23：做。原有按参与者数折扣的读数不变，另加一个计入 `holdout_prior_trials` 的读数；不改目标、不改拒绝。
  - 20261121-24：做。胜率仍在比较表里显示，只是不再参与支配。
  - 20261121-25：做。只加推荐规则，不给参与率设上限，也不加拒绝。
