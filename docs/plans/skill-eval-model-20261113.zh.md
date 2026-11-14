# 技能评估在 deepseek 模型上的表现（2026-11-13）

状态：已跑完并记录。本文是工作台调研结论，不涉及任何产品代码、skill 文本或账本的改动。

## 背景

本仓库的 skill 通过 `claude plugin eval .agents` 跑评分套件（`.agents/evals/<skill>/`，共 6 个 skill、241 个 case）。主机上的 Claude Code 走 DeepSeek 的 Anthropic 兼容端点：

- `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`
- 默认模型（opus/sonnet 映射）→ `deepseek-v4-pro`
- haiku 映射 → `deepseek-v4-flash`（`ANTHROPIC_DEFAULT_HAIKU_MODEL`）

本次要回答：**skill 在当前模型上的表现如何，以及该用哪个模型跑评估。** 评估命令统一为 `--ablation none`（只跑 skill 臂，不做 no-plugin 基线），grader 默认 `haiku` → `deepseek-v4-flash`。

## 成本口径（重要）

`claude plugin eval` 报出的 `$` 成本按 Claude token 价计，**不是 DeepSeek 实际扣费**。以全量 `--runs 1` 一次（241 case）为例：

| | harness 报的 `$` | DeepSeek 余额实际扣减 |
|---|---|---|
| flash 全量一次 | $153.80 | **¥23.52（约 $3.3）** |

换算比约 47 倍，所以评估预算只看 DeepSeek 余额扣减，不看 harness 的 `$`。`stderr` 里的 `claude-code:unrecognized_model`（`deepseek-v4-flash`）只是 SDK 不认识自定义模型名的警告，不影响运行。

## 结果（deepseek-v4-flash，全量 241 case，每 case 1 次）

| skill | cases | 评分 | 通过 | 通过率 | 触发 skill | 触发率 | 未跑完 |
|---|---|---|---|---|---|---|---|
| research-sources | 13 | 11 | 11 | 100% | 10 | 91% | 2 max-turns |
| video-evidence | 29 | 29 | 27 | 93% | 28 | 97% | 0 |
| nautilus-report-analysis | 23 | 21 | 16 | 76% | 18 | 86% | 2 max-turns |
| research-round | 106 | 91 | 68 | 75% | 65 | 71% | 14 max-turns + 1 超时 |
| product-doctor | 25 | 24 | 17 | 71% | 21 | 88% | 1 max-turns |
| research-start | 45 | 45 | 29 | 64% | 35 | 78% | 0 |
| **合计** | 241 | 221 | 168 | **76%** | 177 | **80%** | 20 |

「触发 skill」指 `tool_used: Skill` grader 判为已调用；通过率是已评分 run 中 score=1 的比例（`--runs 1` 单次，有单次波动）。

## 与 deepseek-v4-pro 的对比（部分数据）

pro 那次按默认 3–5 次/case 跑，跑到第 168 次后余额耗尽（402 Insufficient Balance），560 次未跑，只有 3 个 skill 有部分数据：

| skill | pro 通过率（168 次，部分） | pro 触发率 | flash 通过率 | flash 触发率 |
|---|---|---|---|---|
| nautilus-report-analysis | 64% | 66% | **76%** | **86%** |
| product-doctor | 50% | 77% | **71%** | **88%** |
| research-round | 38% | 75% | **75%** | 71% |

趋势明确：**便宜的 flash 通过率和 skill 触发率整体都高于 pro**，且全量一次只要 ¥23.5。看 skill 表现应挂 flash，而不是 pro。

## 失败明细（逐 case）

20 次未跑完（19 次打满 12 轮 + 1 次 300s 超时）加 53 次评分 FAIL，共 73 个 case（241 里的 30%）。两类 FAIL 的区分：**「触发 skill：无」是模型根本没去调 skill → 0 分；「触发 skill：有」是调了但多问项答不全 → 0.5/0.8 分。**

### nautilus-report-analysis（23 case）

未跑完：`dynamic-analysis-stays-temporary`、`promote-recurring-measure`（均 max-turns）。

评分 FAIL：
- `derived-number-recomputed` — 0，无
- `derived-numbers-state-weighting` — 0.5，有
- `dsr-uses-ledger-counts` — 0，无
- `native-stats-and-tearsheet` — 0.8，有
- `participation-covers-limit-fills` — 0.5，有

### product-doctor（25 case）

未跑完：`trigger-positive`（max-turns）。

评分 FAIL：
- `attach-live-diagnosis` — 0.5，有
- `attach-not-full-audit` — 0.5，有
- `credential-carriers-off-limits` — 0，无
- `diagnosis-does-not-reproduce` — 0，无
- `improvement-needs-consumer-decisions` — 0.5，有
- `reviewers-get-no-conclusions` — 0.5，有
- `user-first-miss` — 0.5，有

### research-round（106 case，最弱）

未跑完（14 max-turns + 1 超时）：`buy-and-hold-reference-before-recommendation`、`execution-mode-low-exposure-bars`、`gross-negative-updates-priority`、`losing-candidate-still-derives`、`one-window-no-rerun`、`outcome-map-not-rewritten`、`prediction-falsifiable`、`recommendation-body-holds-trial-counts`、`report-does-not-end-turn`、`report-follows-template`、`reviewer-gets-technical-cache`、`reviewer-reads-prices-by-command`、`search-exposure-recorded`、`template-header-27-duties`（max-turns）；`live-candidate-runs-unchanged`（超时）。

评分 FAIL（「无」= 没触发 skill → 0）：
- `aggregated-bar-arrives-standard` — 0，无
- `causal-input-clock-current-minute` — 0，无
- `concentration-disclosed-before-validation` — 0.5，有
- `l3-touch-not-pnl` — 0，无
- `ledger-is-the-only-record` — 0.5，有
- `line-change-counts-undistinguished-runs` — 0，无
- `live-adaptation-separate-orders` — 0，无
- `live-gtd-short-entry` — 0，无
- `move-runs-before-rebuild` — 0，无
- `no-approval-within-line` — 0.5，有
- `partial-target-own-order` — 0.5，无
- `quick-look-stays-on-recorded-route` — 0，无
- `reviewer-reads-api-from-stubs` — 0，无
- `reviewer-reads-no-memory` — 0，无
- `reviewer-reads-terms-by-command` — 0，无
- `single-run-report-sections` — 0，无
- `source-no-private-ledger` — 0，无
- `stop-move-cancel-then-resubmit` — 0，无
- `summary-merges-corrections` — 0.5，有
- `template-cross-section-two-leg-native-gaps` — 0.5，有
- `template-stop-entry-no-target` — 0.5，无
- `trigger-positive` — 0，无
- `zero-volume-mid-line-continues` — 0，无

### research-sources（13 case）

未跑完：`open-copy-before-asking`、`source-status-and-conditions`（均 max-turns）。无评分 FAIL（11/11 全过）。

### research-start（45 case，触发率最低）

评分 FAIL（无未跑完）：
- `approved-import-runs-in-container` — 0，无
- `decision-bar-gap-asks-choice` — 0.5，有
- `dirty-checkout-stops-and-names-paths` — 0，无
- `held-bar-months-refuse-other-contract` — 0.5，有
- `inferred-quotes-matched-scope` — 0.5，有
- `leave-every-line-lists-template-roots` — 0.5，有
- `line-close-reads-full-record` — 0.5，无
- `line-close-runs-history-first` — 0.5，无
- `line-options-link-ide-view` — 0，无
- `line-options-registrable-and-covered` — 0.5，有
- `line-select-period-not-chosen` — 0.5，有
- `resume-keeps-route` — 0，无
- `route-change-waits-for-user` — 0.5，有
- `service-skipped-month-no-manual-import` — 0，无
- `unreviewed-trials-from-commit-diff` — 0，无
- `user-idea-registered-as-hypothesis` — 0.5，无

### video-evidence（29 case）

评分 FAIL（无未跑完）：
- `planted-config` — 0.5，有
- `title-metachar` — 0，无

逐 case 的完整 grader 证据在 `/tmp/skill-eval-flash-2026-11-13.json`（工作副本，可重跑再生）。

## 结论

1. **评估用 flash 不用 pro**：更便宜（¥23.5/全量）且通过率更高（76% vs pro 部分数据的 38–64%）。
2. **最弱的是 research-start（64%）和 research-round 的「触发类」case**：模型常忘记调 skill，或触发了但答半对；research-round 还有 14 个 case 会让模型打满 12 轮。
3. 成本只看 DeepSeek 余额扣减，harness 的 `$` 数字会高估约 47 倍。
