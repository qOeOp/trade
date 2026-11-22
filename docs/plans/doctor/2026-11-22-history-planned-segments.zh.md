# 2026-11-22 关线结论漏算未跑的否决年、Paper 对账漏答检查期间的询问

外部审计（Gemini，2026-11-22）提出两处缺陷，协调者核实后交修；本记录只收这两处，各以先失败后通过的测试复现。

| Item | Value |
|---|---|
| Sessions | 外部审计 Gemini 2026-11-22；核实与修复由 Claude Code（Claude Opus 5.5）子 agent 完成 |
| Checkout / ledger | `origin/main` `2a9922f3f`；测试只用隔离的临时 Dolt 库与假市场，未写活动账本或市场 |
| Cost | unknown（没有会话读到这两条路径的代价） |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261122-02 | 关线结论只看已有的历史试验：`line history --limit` 或中途失败留下没有试验的计划段，一个否决年都没跑（或三年只跑一年）而对照与留出期通过时，`_summary` 以留出期（或已跑的年份）判达标，验证登记与 Live 准入（`require_unfalsified`）照收 | `report/history.py` `_veto` 只遍历已有格子；`replay/history.py` `run_history` 按 `--limit` 惰性跑段。新测试 `test_veto_years_not_replayed_yet_leave_the_verdict_undecided` 在修复前 `require_unfalsified` 不拒绝 | authority（收紧证伪判定：计划里有可交易窗口却没有试验的否决年记入 `missing`，结论未定；委托决定） | unknown | in PR [#3416](https://github.com/qOeOp/trade/pull/3416) |
| 20261122-03 | Live 控制的 Paper 对账 `Reconciliation.check` 开始时只取一次已问的键，检查进行中被问的新键要等下一次询问才有答案，准备运行可能因此被拒 `LIVE_PAPER_UNRECONCILED` | `live/reconcile.py` `_run` 一次 `check` 后即清 `_reading`；新测试 `test_a_key_asked_while_a_check_runs_is_answered_without_another_request` 在修复前读到 `checking` | fix（`_run` 在同一把锁下见到未答的键就再查一次，再清标志） | unknown | in PR [#3414](https://github.com/qOeOp/trade/pull/3414) |

## Decisions

- 2026-11-22 用户委托：「需要我定的部份最后也是一样由你决定按推荐做」（2026-11-21），并要求处理外部审计的发现。据此定 `20261122-02`：判定按 `ledger.lines.history_plan` 在市场当前首日与最近完整日上计划的段计数；有可交易窗口、却没有历史试验的否决年以 `veto YEAR` 记入 `missing`，结论未定（`HISTORY_UNDECIDED`）；没有可交易窗口的段仍不算。对照与留出期没有试验时原本就记 `control`、`holdout`。`research history` 因此要读市场（`--market`，默认活动市场），IDE 的 History 页面带上它的市场；验证登记用登记的市场 profile，Live 准备用控制挂载的市场目录。不加存储字段。
