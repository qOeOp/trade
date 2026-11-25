# 2026-11-25 整体审计（覆盖不全）

| Item | Value |
|---|---|
| Sessions | 无指定会话；`agents`、`burden`、`value` 扫描 2026-11-22 以来的 Claude Code、Antigravity、Codex 转录（Codex 无 11-22 后会话） |
| Audit session | Antigravity，Gemini 4 Neon (Medium)，`3fd77426-5a94-4330-99ef-63261edfe986`；产品树为 `origin/main` 的独立 detached worktree，本会话只写本记录的 PR |
| Checkout / ledger | `3f10104a1`（审计期间 `origin/main` 前进 1 个无关提交 `16e51a5dc` #3651）；活动账本只读，其余全部在临时账本与临时市场运行 |
| Coverage | 覆盖不全：按 `SKILL.md` 步骤 4，真实依赖没够到的只算部分审计，所以不算全量；当时的 `doctor.py report` 还不能登记这类缺口，原样打印了 `# Full audit` 与 `Not exercised: nothing listed.`。步骤 1 要求的未结 issue 证明重跑没有做。各面未到之处：Live 真实账户与发布主机变更（按 `AGENTS.md` 位于所有审计之外）；真实 GHCR/DoltHub 远端推送、真实远端 systemd/Telegram 投递、真机 Docker OOM/SIGKILL 与宿主机 Redis 重启、`live` 凭证私有接口、长窗口（>1m）归档覆盖的 `paper compare`、`validation` 未来窗口绑定、`docs-site` 全量 `next build`、`claude plugin eval` 实时 LLM 评测。以下为 `doctor.py report` 覆盖表。 |
| Cost | 本次审计从用户确认到结束约 113 分钟（2026-11-25 03:27:52–05:20:34 +09:00，预算 45 分钟，超支；合并前按会话转录更正，原写 52 分钟）；主会话与 29 个子代理的 token 未测量；确认 75 条（64 个公开议题覆盖 74 条 + 1 条按 `SECURITY.md` 私下报告），独立反驳推翻 7/82 条。 |
| Net change | 提议均为缺陷修复、测试补齐、文档/契约对齐与 3 处非保留循环依赖拆解，不新增机制与存储字段；`cost` 4 项均为线性或亚线性（`import` 0.90、`ledger` 0.78、`reports` 0.70、`replay` 1.00）；2 项静默选择挑战经独立反驳确认为有意设计（不改）。 |

| Item | Subject | State | Evidence |
|---|---|---|---|
| value | command-use-and-unmet-asks | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/value/analyze_value.py /tmp/doctor-audit-20261125-3f10104a1/work/value/value.json` exit 0, 3f10104a1 |
| results | conservation-and-archive-originals | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/results/run_audit.py` exit 1, 3f10104a1 |
| results | conservation-and-archive-originals | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/results/run_audit.py` exit 1, 3f10104a1 |
| results | conservation-and-archive-originals | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/results/run_audit.py` exit 1, 3f10104a1 |
| results | conservation-and-archive-originals | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/results/run_audit.py` exit 1, 3f10104a1 |
| results | conservation-and-archive-originals | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/results/run_audit.py` exit 1, 3f10104a1 |
| results | conservation-and-archive-originals | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/results/run_audit.py` exit 1, 3f10104a1 |
| results | conservation-and-archive-originals | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/results/run_audit.py` exit 1, 3f10104a1 |
| results | conservation-and-archive-originals | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/results/run_audit.py` exit 0, 3f10104a1 |
| flow | single | no artifact | `sh -c uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/flow/flow_harness.py single \| tee /tmp/doctor-audit-20261125-3f10104a1/work/flow/single-result.json` exit 0, 3f10104a1 |
| flow | single | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/flow/flow_harness.py single /tmp/doctor-audit-20261125-3f10104a1/work/flow/single-result.json` exit 1, 3f10104a1 |
| flow | single | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/flow/flow_harness.py single /tmp/doctor-audit-20261125-3f10104a1/work/flow/single-result.json` exit 1, 3f10104a1 |
| flow | single | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/flow/flow_harness.py single /tmp/doctor-audit-20261125-3f10104a1/work/flow/single-result.json` exit 1, 3f10104a1 |
| flow | single | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/flow/flow_harness.py single /tmp/doctor-audit-20261125-3f10104a1/work/flow/single-result.json` exit 1, 3f10104a1 |
| flow | single | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/flow/flow_harness.py single /tmp/doctor-audit-20261125-3f10104a1/work/flow/single-result.json` exit 1, 3f10104a1 |
| flow | single | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/flow/flow_harness.py single /tmp/doctor-audit-20261125-3f10104a1/work/flow/single-result.json` exit 0, 3f10104a1 |
| flow | pool | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/flow/flow_harness.py pool /tmp/doctor-audit-20261125-3f10104a1/work/flow/pool-result.json` exit 0, 3f10104a1 |
| parity | replay-paper-live | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/parity/exercise_parity.py /tmp/doctor-audit-20261125-3f10104a1/work/parity/replay-paper-live.json` exit 1, 3f10104a1 |
| parity | replay-paper-live | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/parity/exercise_parity.py /tmp/doctor-audit-20261125-3f10104a1/work/parity/replay-paper-live.json` exit 1, 3f10104a1 |
| parity | replay-paper-live | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/parity/exercise_parity.py /tmp/doctor-audit-20261125-3f10104a1/work/parity/replay-paper-live.json` exit 0, 3f10104a1 |
| research | noise-edge-leak-verdicts | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/research/exercise_research.py` exit 1, 3f10104a1 |
| research | noise-edge-leak-verdicts | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/research/exercise_research.py` exit 1, 3f10104a1 |
| research | noise-edge-leak-verdicts | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/research/exercise_research.py` exit 1, 3f10104a1 |
| research | noise-edge-leak-verdicts | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/research/exercise_research.py` exit 0, 3f10104a1 |
| external | binance-rest-archives-and-terms | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/external/audit_external.py` exit 0, 3f10104a1 |
| external | binance-archives-rest-demo-and-notices | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/external/audit_deep.py` exit 0, 3f10104a1 |
| external | delisted-licenses-and-nonascii | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/external/audit_leads.py` exit 1, 3f10104a1 |
| external | delisted-licenses-and-nonascii-v2 | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/external/audit_leads.py` exit 0, 3f10104a1 |
| external | aggtrades-ghcr-dolthub-pypi | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/external/audit_more.py` exit 0, 3f10104a1 |
| external | nautilus-loader-and-stablecoins | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/external/audit_nautilus_and_edge.py` exit 1, 3f10104a1 |
| external | nautilus-loader-and-stablecoins-v2 | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/external/audit_nautilus_and_edge.py` exit 0, 3f10104a1 |
| external | nautilus-loader-and-stablecoins-v3 | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/external/audit_nautilus_and_edge.py` exit 0, 3f10104a1 |
| external | nautilus-loader-and-gaib | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/external/audit_nautilus_and_edge.py` exit 0, 3f10104a1 |
| consumers | ledger | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/consumers/read_ledger.py` exit 0, 3f10104a1 |
| consumers | report | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/consumers/read_report.py` exit 0, 3f10104a1 |
| consumers | ide | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/consumers/read_ide.py` exit 0, 3f10104a1 |
| consumers | ide | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/consumers/read_ide.py` exit 0, 3f10104a1 |
| consumers | cli | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/consumers/read_cli.py` exit 0, 3f10104a1 |
| storage | backup-restore-rebuild-growth | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/storage/exercise_storage.py` exit 1, 3f10104a1 |
| storage | backup-restore-rebuild-growth | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/storage/exercise_storage.py` exit 1, 3f10104a1 |
| storage | backup-restore-rebuild-growth | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/storage/exercise_storage.py` exit 1, 3f10104a1 |
| storage | backup-restore-rebuild-growth | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/storage/exercise_storage.py` exit 1, 3f10104a1 |
| storage | backup-restore-rebuild-growth | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/storage/exercise_storage.py` exit 0, 3f10104a1 |
| storage | backup-restore-rebuild-growth | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/storage/exercise_storage.py` exit 1, 3f10104a1 |
| storage | backup-restore-rebuild-growth | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/storage/exercise_storage.py` exit 0, 3f10104a1 |
| gates | empty | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/gates/exercise_empty.py` exit 0, 3f10104a1 |
| gates | failed | failed | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/gates/exercise_failed.py` exit 1, 3f10104a1 |
| gates | failed | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/gates/exercise_failed.py` exit 0, 3f10104a1 |
| gates | partial | failed | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/gates/exercise_partial.py` exit 1, 3f10104a1 |
| gates | partial | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/gates/exercise_partial.py` exit 0, 3f10104a1 |
| faults | live | examined | `bash -c uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/faults/exercise_live.py \| tee /tmp/doctor-audit-20261125-3f10104a1/work/faults/live_results.json` exit 0, 3f10104a1 |
| faults | docker | examined | `bash -c uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/faults/exercise_docker.py \| tee /tmp/doctor-audit-20261125-3f10104a1/work/faults/docker_results.json` exit 0, 3f10104a1 |
| interrupt | live-replay-deploy-steps | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/interrupt/exercise_all.py` exit 0, 3f10104a1 |
| interrupt | live-replay-deploy-steps | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/interrupt/exercise_all.py` exit 0, 3f10104a1 |
| interrupt | live-replay-deploy-steps-more | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/interrupt/exercise_more.py` exit 0, 3f10104a1 |
| operation | degraded-service-and-full-disk | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/operation/exercise.py` exit 0, 3f10104a1 |
| operation | dolt-enospc-backup-and-write | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/operation/exercise_dolt_enospc.py` exit 0, 3f10104a1 |
| operation | dolt-enospc-backup-and-write | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/operation/exercise_dolt_enospc.py` exit 0, 3f10104a1 |
| operation | dolt-enospc-backup-and-write | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/operation/exercise_dolt_enospc.py` exit 0, 3f10104a1 |
| operation | dolt-enospc-backup-and-write | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/operation/exercise_dolt_enospc.py` exit 0, 3f10104a1 |
| cost | import | examined | exponent 0.83, warm {'1': [0.095017, 0.096128, 0.098063], '4': [0.269358, 0.270809, 0.271108], '16': [0.961574, 0.953975, 0.953137]} |
| cost | import | examined | exponent 0.9, warm {'2': [0.154019, 0.154898, 0.151045], '8': [0.508527, 0.568711, 0.513965], '32': [1.872614, 1.85978, 1.860506]} |
| cost | ledger | broken | exponent None, warm None |
| cost | ledger | broken | exponent None, warm None |
| cost | ledger | broken | exponent None, warm None |
| cost | ledger | examined | exponent 0.78, warm {'10': [0.008894, 0.010652, 0.011666], '40': [0.026082, 0.026842, 0.025423], '160': [0.091453, 0.094049, 0.090691]} |
| cost | reports | broken | exponent None, warm None |
| cost | reports | broken | exponent None, warm None |
| cost | reports | examined | exponent 0.7, warm {'10': [0.047183, 0.044927, 0.044474], '40': [0.115842, 0.09721, 0.09637], '160': [0.316015, 0.299782, 0.31025]} |
| cost | replay | broken | exponent None, warm None |
| cost | replay | broken | exponent None, warm None |
| cost | replay | broken | exponent None, warm None |
| cost | replay | broken | exponent None, warm None |
| cost | replay | examined | exponent 1.0, warm {'2': [0.055581, 0.053102, 0.052549], '8': [0.209315, 0.212536, 0.208561], '32': [0.869869, 0.849939, 0.850154]} |
| structure | layers-cycles-duplication-cochange | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/structure/analyze_structure.py` exit 1, 3f10104a1 |
| structure | layers-cycles-duplication-cochange | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/structure/analyze_structure.py` exit 0, 3f10104a1 |
| size | by-area-since-5fc5168d6 | examined | `python3 /tmp/doctor-audit-20261125-3f10104a1/work/scripts/size_audit.py` exit 0, 3f10104a1 |
| checks | mutation-and-eval-gates | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/checks/exercise_checks.py /tmp/doctor-audit-20261125-3f10104a1/work/checks/checks.json` exit 0, 3f10104a1 |
| delivery | github-runs-and-prs | examined | `python3 /tmp/doctor-audit-20261125-3f10104a1/work/scripts/delivery_audit.py` exit 0, 3f10104a1 |
| lifecycle | install-upgrade-idle-move-host | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/lifecycle/exercise_lifecycle.py /tmp/doctor-audit-20261125-3f10104a1/work/lifecycle /tmp/doctor-audit-20261125-3f10104a1/work/lifecycle/lifecycle.json` exit 1, 3f10104a1 |
| lifecycle | install-upgrade-idle-move-host | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/lifecycle/exercise_lifecycle.py /tmp/doctor-audit-20261125-3f10104a1/work/lifecycle /tmp/doctor-audit-20261125-3f10104a1/work/lifecycle/lifecycle.json` exit 0, 3f10104a1 |
| pages | empty | examined | `node /tmp/doctor-audit-20261125-3f10104a1/work/pages/run_empty.mjs` exit 0, 3f10104a1 |
| pages | records | examined | `node /tmp/doctor-audit-20261125-3f10104a1/work/pages/run_records.mjs` exit 0, 3f10104a1 |
| pages | offline | examined | `node /tmp/doctor-audit-20261125-3f10104a1/work/pages/run_offline.mjs` exit 0, 3f10104a1 |
| pages | reload | examined | `node /tmp/doctor-audit-20261125-3f10104a1/work/pages/run_reload.mjs` exit 0, 3f10104a1 |
| usability | keyboard-contrast-narrow | no artifact | `node /tmp/doctor-audit-20261125-3f10104a1/work/usability/audit_browser.mjs /tmp/doctor-audit-20261125-3f10104a1/work/usability/usability.json` exit 1, 3f10104a1 |
| usability | keyboard-contrast-narrow | examined | `node /tmp/doctor-audit-20261125-3f10104a1/work/usability/audit_browser.mjs /tmp/doctor-audit-20261125-3f10104a1/work/usability/usability.json` exit 0, 3f10104a1 |
| usability | keyboard-contrast-narrow | examined | `node /tmp/doctor-audit-20261125-3f10104a1/work/usability/audit_browser.mjs /tmp/doctor-audit-20261125-3f10104a1/work/usability/usability.json` exit 0, 3f10104a1 |
| usability | keyboard-contrast-narrow | examined | `node /tmp/doctor-audit-20261125-3f10104a1/work/usability/audit_browser.mjs /tmp/doctor-audit-20261125-3f10104a1/work/usability/usability.json` exit 0, 3f10104a1 |
| usability | keyboard-contrast-narrow | examined | `node /tmp/doctor-audit-20261125-3f10104a1/work/usability/audit_browser.mjs /tmp/doctor-audit-20261125-3f10104a1/work/usability/usability.json` exit 0, 3f10104a1 |
| words | docs-help-and-published-site | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/words/run_words_exercise.py` exit 0, 3f10104a1 |
| security | process-reach-and-deps | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/security/exercise.py` exit 1, 3f10104a1 |
| security | process-reach-and-deps | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/security/exercise.py` exit 1, 3f10104a1 |
| security | process-reach-and-deps | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/security/exercise.py` exit 0, 3f10104a1 |
| agents | transcripts-skills-and-claims | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/agents/run_agents_exercise.py` exit 0, 3f10104a1 |
| burden | user-messages-and-usage-errors | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/burden/exercise_burden.py` exit 0, 3f10104a1 |
| governance | rules-copies-and-enforcement | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/governance/audit_governance.py /tmp/doctor-audit-20261125-3f10104a1/work/governance/governance.json` exit 0, 3f10104a1 |
| unchanged | runtime-docs-site-and-quotes | no artifact | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/unchanged/exercise_unchanged.py /tmp/doctor-audit-20261125-3f10104a1/work/unchanged/unchanged.json` exit 1, 3f10104a1 |
| unchanged | runtime-docs-site-and-quotes | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/unchanged/exercise_unchanged.py /tmp/doctor-audit-20261125-3f10104a1/work/unchanged/unchanged.json` exit 0, 3f10104a1 |
| unchanged | runtime-docs-site-and-quotes | examined | `uv run --frozen python /tmp/doctor-audit-20261125-3f10104a1/work/unchanged/exercise_unchanged.py /tmp/doctor-audit-20261125-3f10104a1/work/unchanged/unchanged.json` exit 0, 3f10104a1 |
| fixed | 55dfe5088 | no test | 0 telling tests |
| fixed | 676359f87 | examined | 1 telling tests |
| fixed | baae92c9d | undecided | 0 telling tests |
| fixed | f7a874109 | examined | 1 telling tests |
| fixed | 60a8a243b | examined | 1 telling tests |
| fixed | c77f5302c | examined | 1 telling tests |
| self | issue-sources-and-states | examined | `python3 /tmp/doctor-audit-20261125-3f10104a1/work/scripts/self_audit.py` exit 0, 3f10104a1 |

## Findings

| Finding | Verdict | Observed | Expected | Control | At the last audit |
|---|---|---|---|---|---|
| faults-partial-venue-closed-stop | shown | {'submitted': ['1.0'], 'venue_flat': True, 'stopped': True} | {'submitted': ['1.0'], 'venue_flat': False, 'stopped': False} | {'submitted': [], 'venue_flat': True, 'stopped': True} | present |
| parity-multi-contract-cadence | shown | (['BTCUSDT-PERP.BINANCE'], ['BTCUSDT-PERP.BINANCE']) | (['BTCUSDT-PERP.BINANCE', 'ETHUSDT-PERP.BINANCE'], ['BTCUSDT-PERP.BINANCE', 'ETHUSDT-PERP.BINANCE']) | (['BTCUSDT-PERP.BINANCE', 'ETHUSDT-PERP.BINANCE'], ['BTCUSDT-PERP.BINANCE', 'ETHUSDT-PERP.BINANCE']) | present |
| faults-held-failure-exits-zero | shown | {'exit_code': 0, 'last_event': 'reconcile_stopped'} | {'exit_code': 1, 'last_event': 'unresolved'} | {'exit_code': 1, 'last_event': 'unresolved'} | present |
| parity-paper-unsent-gtd-cancel | shown | (['ORDER_RULE'], None) | ([], 'CANCELED') | ([], 'CANCELED') | unknown |
| parity-paper-foreign-unsent-cancel | shown | ([], 'RuntimeError') | (['ORDER_RULE'], None) | (['ORDER_RULE'], None) | unknown |
| parity-live-compare-mark-rounding | shown | ('unexplained', 1) | ('mark_rounding', 0) | ('mark_rounding', 0) | unknown |
| faults-stop-reason-masked-by-interrupt | shown | 'interrupted' | 'drawdown' | 'drawdown' | present |
| faults-stage-log-oserror-swallowed | shown | ('returned', 127) | ('raised', 'OSError') | ('raised', 'ValueError') | present |
| gates-retry-of-bypass | shown | 'accepted' | 'refused' | 'refused' | present |
| parity-live-market-exit-second-call | shown | True | False | False | unknown |
| gates-empty-judgment-body | shown | 'accepted' | 'refused' | 'refused' | present |
| gates-uncaptured-retry-reason | shown | (False, True) | (False, False) | (True, True) | present |
| gates-validation-retry-next-actions | shown | (True, True) | (True, False) | (False, True) | present |
| flow-paper-op-id-pool-conflict | shown | 'replayed:BTCUSDT' | 'OP_ID_CONFLICT' | 'OP_ID_CONFLICT' | present |
| flow-paper-serve-both-scope | shown | 'accepted:--universe pool' | 'USAGE_ERROR' | 'USAGE_ERROR' | present |
| flow-runner-universe-unvalidated | shown | ('accepted', {'universe': True}) | 'USAGE_ERROR' | 'USAGE_ERROR' | present |
| interrupt-live-egress-bridge | shown | 'LIVE_IDENTITY_CHANGED' | 'starting' | 'starting' | present |
| interrupt-release-generation-finish | shown | True | False | False | unknown |
| research-dsr-constant-nonzero-crash | shown | 'ZeroDivisionError: division by zero' | None | None | present |
| research-derive-measures-wipeout-crash | shown | 'ValueError: expected argument value > -1, got -1.0' | (None, None) | (None, None) | present |
| research-precheck-causal-fail-bypass | shown | 'ACCEPTED_TRIAL_2' | 'SOURCE_PRECHECK_FAILED' | 'SOURCE_PRECHECK_FAILED' | present |
| pages-sse-drop-silent | shown | {'stage': None, 'code': None} | {'stage': 'failed', 'code': 'UNAVAILABLE'} | {'stage': 'failed', 'code': 'UNAVAILABLE'} | unknown |
| research-dsr-invalid-inputs-silent | shown | (False, False) | (True, True) | (True, True) | present |
| research-dev-quarters-day29-31-missing | shown | None | 8 | 8 | present |
| pages-backtest-absent-stuck | shown | {'calls': 1, 'kind': 'absent'} | {'calls': 2, 'kind': 'ready'} | {'calls': 2, 'kind': 'ready'} | present |
| pages-dev-unknown-path-draws-unauthenticated-page | shown | {'status': 200, 'is_html': True, 'has_token_meta': False} | {'status': 404, 'is_html': False, 'has_token_meta': False} | {'status': 404, 'is_html': False, 'has_token_meta': False} | present |
| flow-live-reconcile-empty-retries | shown | True | False | False | present |
| flow-line-close-replay-drops-commit | shown | False | True | True | present |
| consumers-retracted-recommendation-view | shown | 'alpha@2' | None | 'alpha@1' | present |
| consumers-unfinished-trial-wipes-view-reading | shown | ('unrun', None) | ('below_targets', 0.23) | ('below_targets', 0.23) | present |
| consumers-unfinished-trial-drops-graph-comparison | shown | None | 5 | 5 | present |
| external-pending-trading-1122 | shown | ('refused', 'SOURCE_SHAPE') | ('ok', 0) | ('ok', 0) | present |
| external-paper-terms-ignores-non-trading | shown | 'admitted' | 'rejected' | 'rejected' | present |
| external-notices-web-mit-count | shown | ('web_mit', 273) | ('web_mit', 274) | ('agent', 16, 9, 6) | present |
| usability-pnl-text-contrast | shown | False | True | True | present |
| usability-lineage-node-focus-ring | shown | False | True | True | present |
| usability-heattile-opacity-contrast | shown | False | True | True | present |
| results-quotes-exposure-lag | shown | (0.0002, False) | (0.1001, True) | (0.1001, True) | present |
| usability-code-diff-comment-contrast | shown | False | True | True | present |
| usability-link-non-island-contrast | shown | False | True | True | present |
| storage-backup-interrupted-first-export | shown | 'EXPORT_PATH_INVALID' | 'ok' | 'ok' | present |
| storage-backup-interrupted-initial-sync | shown | False | True | True | present |
| storage-market-holes-republished-early-return | shown | False | True | True | present |
| structure-live-control-notify-cycle | shown | ['live.control -> live.notify', 'live.notify -> live.control'] | [] | [] | present |
| structure-engine-live-4module-cycle | shown | ['engine.live_brake -> engine.live_commands', 'engine.live_commands -> engine.live_connection', 'engine.live_commands -> engine.live_session', 'engine.live_connection -> engine.live_commands', 'engine.live_session -> engine.live_brake', 'engine.live_session -> engine.live_commands', 'engine.live_session -> engine.live_connection'] | [] | [] | present |
| structure-ide-web-format-time-cycle | shown | ['ide/web/src/lib/format.ts -> ide/web/src/lib/time.ts', 'ide/web/src/lib/time.ts -> ide/web/src/lib/format.ts'] | [] | [] | present |
| http-negative-content-length-bypass | shown | {'ide_rejected_4xx': False, 'paper_rejected_4xx': False} | {'ide_rejected_4xx': True, 'paper_rejected_4xx': True} | {'ide_rejected_4xx': True, 'paper_rejected_4xx': True} | present |
| runtime-symlink-comma-mount-injection | shown | False | True | True | present |
| op-backup-enospc-wedge | shown | 'the backup at /var/folders/n3/7bzqqwbn019gzxk79l7h6pt40000gn/T/probe-bkp-txkh4svt/backup holds no Dolt manifest' | True | True | present |
| op-paper-compare-enospc-wedge | shown | False | True | True | present |
| op-paper-seal-thread-silent-death | shown | False | True | True | present |
| op-ide-market-import-stale-mismatch | shown | True | False | False | present |
| op-ide-proxy-http-exception-crash | shown | 'RemoteDisconnected' | 502 | 502 | present |
| checks-redis-loopback-never-run-in-ci | shown | {'redis_gated_modules': ['tests/live_loopback/test_begun_stop.py', 'tests/live_loopback/test_unsent_cancel.py'], 'run_in_redis_ci': False} | {'redis_gated_modules': ['tests/live_loopback/test_begun_stop.py', 'tests/live_loopback/test_unsent_cancel.py'], 'run_in_redis_ci': True} | {'redis_gated_modules': ['tests/engine/test_paper_cache_faults.py'], 'run_in_redis_ci': True} | absent |
| checks-runtime-image-skips-redis-test-edits | shown | 'changed=false' | 'changed=true' | 'changed=true' | present |
| checks-lifecycle-validation-mutants-survive | shown | 'survived' | 'killed' | 'killed' | present |
| agents-doctor-recheck-skips-agent-assets | shown | 'no test' | 'confirmed' | 'confirmed' | present |
| agents-eval-cases-misses-compound-spans | shown | [] | ['s/a'] | ['s/a'] | present |
| words-replay-report-directory-reads-ledger | shown | 'LEDGER_UNKNOWN' | 'NATIVE_SUMMARY_MISSING' | 'NATIVE_SUMMARY_MISSING' | present |
| words-research-history-reads-market-when-empty | shown | 'refused_missing_market_profile' | 'no_market_refusal' | 'no_market_refusal' | present |
| lifecycle-cutover-root-archive-loses-market-json | shown | {'archiver_runs_as_root': True, 'error': None, 'market_json_restored': False, 'journal_removed': True} | {'archiver_runs_as_root': True, 'error': None, 'market_json_restored': True, 'journal_removed': True} | {'archiver_runs_as_root': True, 'error': None, 'market_json_restored': True, 'journal_removed': True} | present |
| lifecycle-first-run-bad-content-length-crash | shown | '<no HTTP response>' | 'HTTP/1.0 400 Bad Request' | 'HTTP/1.0 400 Bad Request' | present |
| words-operator-rollback-contradicts-deploy | shown | (True, False) | (False, False) | (True, True) | present |
| words-operator-default-market-args-stale | shown | ('3_contracts', 'all_eligible_contracts', False) | ('all_eligible_contracts', 'all_eligible_contracts', False) | 300 | present |
| lifecycle-move-host-local-service-starts-old-data | shown | {'refused': False, 'target_socket_exists': False, 'old_socket_opened': True} | {'refused': True, 'target_socket_exists': False, 'old_socket_opened': False} | {'refused': False, 'target_socket_exists': True, 'old_socket_opened': False} | present |
| lifecycle-compose-service-skips-schema-check-on-moved-profile | shown | {'refusal_code': None, 'started_with_bad_schema': True} | {'refusal_code': 'SERVICE_CHECK_FAILED', 'started_with_bad_schema': False} | {'refusal_code': 'SERVICE_CHECK_FAILED', 'started_with_bad_schema': False} | present |
| lifecycle-market-follow-first-round-healthy-before-completion | shown | 0 | 1 | 1 | present |
| gov-mypy-omits-deploy | shown | {'package': 'deploy', 'declared_product_package': True, 'in_mypy_ini': False, 'mypy_exit': 1, 'mypy_errors': 15} | {'package': 'deploy', 'declared_product_package': True, 'in_mypy_ini': True, 'mypy_exit': 0, 'mypy_errors': 0} | {'package': 'shared', 'declared_product_package': True, 'in_mypy_ini': True, 'mypy_exit': 0, 'mypy_errors': 0} | present |
| gov-oversized-caps-stale | shown | {'cli/research_commands.py': 40, 'ide/research_graph/serve.py': 24, 'report/status.py': 2} | {} | [] | present |
| gov-changelog-d-unenforced-in-ci | shown | {'rejected_by_release': True, 'checked_in_quality_or_test': False} | {'rejected_by_release': True, 'checked_in_quality_or_test': True} | {'caught_by_script': True, 'invoked_in_quality_yml': True} | present |
| gov-eval-skill-fired-copies | shown | ['.agents/evals/research-round/cost-margin-lowers-turnover-first/graders/skill-fired.md', '.agents/evals/research-round/grid-review-brief-parent-diff/graders/skill-fired.md', '.agents/evals/research-round/recommendation-reads-above-volume/graders/skill-fired.md'] | [] | {'suite': 'product-doctor', 'duplicates': []} | present |
| burden-runner-utc-traceback | shown | (False, True) | (True, False) | (True, False) | present |
| burden-runner-parser-usage-error | shown | ('USAGE_ERROR', True, False) | ('USAGE_ERROR', False, True) | ('USAGE_ERROR', False, True) | present |
| quotes-stale-push-nonpositive-bid | shown | False | True | True | present |
| burden-manual-usage-error-expected | shown | {'replay report': ('USAGE_ERROR', False), 'ledger export': ('USAGE_ERROR', False), 'ledger service': ('USAGE_ERROR', False), 'market follow': ('USAGE_ERROR', False), 'paper start': ('USAGE_ERROR', False)} | {'replay report': ('USAGE_ERROR', True), 'ledger export': ('USAGE_ERROR', True), 'ledger service': ('USAGE_ERROR', True), 'market follow': ('USAGE_ERROR', True), 'paper start': ('USAGE_ERROR', True)} | ('USAGE_ERROR', True) | present |
| quotes-cross-day-time-reversal | shown | 'accepted' | 'SOURCE_SHAPE' | 'SOURCE_SHAPE' | present |
| live-egress-secret-mount-bypass | shown | 'allowed(mounted=True)' | 'ARGV_INVALID' | 'ARGV_INVALID' | present |
| container-mount-symlink-comma-injection | shown | 'allowed' | 'MOUNT_TARGET_INVALID' | 'MOUNT_TARGET_INVALID' | present |
| container-cpus-zero-unlimited | shown | 'allowed' | 'ARGV_INVALID' | 'ARGV_INVALID' | present |
| lifecycle-mixed-start-ns-typeerror | shown | 'TypeError' | 'LIFECYCLE_INPUT' | 'LIFECYCLE_INPUT' | present |
| lifecycle-duplicate-instrument-id-across-symbols | shown | 'accepted' | 'LIFECYCLE_INPUT' | 'LIFECYCLE_INPUT' | present |
| cost-dsr-constant-zero-div | shown | 'ZeroDivisionError' | None | None | present |

Shown: 84 of 84 probed. Of 78 datable ones, the last audit already had 77.

上一行是 `doctor.py` 的原始计数；其中 2 行属 `SECURITY.md` 范围，上表不列。

独立反驳共复核 82 条主张（80 条去重后的 `shown` 探针 + 2 条步骤 5 的 `change` 建议），推翻 **7 条**（5 条 `by design`：`SECURITY.md` 范围内 1 条、`usability-pnl-text-contrast`、`storage-backup-interrupted-first-export` [重复 #3547]、`challenge-paper-terms-queue`、`challenge-replay-fresh-catalog-export`；2 条 `false`：`research-dsr-invalid-inputs-silent`、`quotes-cross-day-time-reversal`），确认 **75 条**（1 条按 `SECURITY.md` 私下报告给用户，其余 74 条按单因单议题合并为 64 个 `agent-finding` 议题）。

已复验关闭议题：`#3549`（`676359f87`）、`#3497`（`f7a874109`）、`#3517`（`60a8a243b`）、`#3516`（`c77f5302c`）已加 `held` 评论；`#3532`（`55dfe5088`）无测试、`#3545`（`baae92c9d`）`undecided`；其余 60 个关闭且无 `held` 评论的 `agent-finding` 议题留待下次审计。

- [#3652](https://github.com/qOeOp/trade/issues/3652) — `fix`
- [#3653](https://github.com/qOeOp/trade/issues/3653) — `fix`
- [#3654](https://github.com/qOeOp/trade/issues/3654) — `fix`
- [#3655](https://github.com/qOeOp/trade/issues/3655) — `fix`
- [#3656](https://github.com/qOeOp/trade/issues/3656) — `fix`
- [#3657](https://github.com/qOeOp/trade/issues/3657) — `fix`
- [#3658](https://github.com/qOeOp/trade/issues/3658) — `fix`
- [#3659](https://github.com/qOeOp/trade/issues/3659) — `fix`
- [#3660](https://github.com/qOeOp/trade/issues/3660) — `authority`
- [#3661](https://github.com/qOeOp/trade/issues/3661) — `fix`
- [#3662](https://github.com/qOeOp/trade/issues/3662) — `authority`
- [#3663](https://github.com/qOeOp/trade/issues/3663) — `authority`
- [#3664](https://github.com/qOeOp/trade/issues/3664) — `fix`
- [#3665](https://github.com/qOeOp/trade/issues/3665) — `fix`
- [#3666](https://github.com/qOeOp/trade/issues/3666) — `fix`
- [#3667](https://github.com/qOeOp/trade/issues/3667) — `fix`
- [#3668](https://github.com/qOeOp/trade/issues/3668) — `fix`
- [#3669](https://github.com/qOeOp/trade/issues/3669) — `fix`
- [#3670](https://github.com/qOeOp/trade/issues/3670) — `fix`
- [#3671](https://github.com/qOeOp/trade/issues/3671) — `fix`
- [#3672](https://github.com/qOeOp/trade/issues/3672) — `fix`
- [#3673](https://github.com/qOeOp/trade/issues/3673) — `fix`
- [#3674](https://github.com/qOeOp/trade/issues/3674) — `authority`
- [#3675](https://github.com/qOeOp/trade/issues/3675) — `fix`
- [#3676](https://github.com/qOeOp/trade/issues/3676) — `authority`
- [#3677](https://github.com/qOeOp/trade/issues/3677) — `fix`
- [#3678](https://github.com/qOeOp/trade/issues/3678) — `fix`
- [#3679](https://github.com/qOeOp/trade/issues/3679) — `fix`
- [#3680](https://github.com/qOeOp/trade/issues/3680) — `fix`
- [#3681](https://github.com/qOeOp/trade/issues/3681) — `fix`
- [#3682](https://github.com/qOeOp/trade/issues/3682) — `fix`
- [#3683](https://github.com/qOeOp/trade/issues/3683) — `fix`
- [#3684](https://github.com/qOeOp/trade/issues/3684) — `fix`
- [#3685](https://github.com/qOeOp/trade/issues/3685) — `fix`
- [#3686](https://github.com/qOeOp/trade/issues/3686) — `fix`
- [#3687](https://github.com/qOeOp/trade/issues/3687) — `fix`
- [#3688](https://github.com/qOeOp/trade/issues/3688) — `fix`
- [#3689](https://github.com/qOeOp/trade/issues/3689) — `fix`
- [#3690](https://github.com/qOeOp/trade/issues/3690) — `fix`
- [#3691](https://github.com/qOeOp/trade/issues/3691) — `fix`
- [#3692](https://github.com/qOeOp/trade/issues/3692) — `fix`
- [#3693](https://github.com/qOeOp/trade/issues/3693) — `fix`
- [#3694](https://github.com/qOeOp/trade/issues/3694) — `fix`
- [#3695](https://github.com/qOeOp/trade/issues/3695) — `authority`
- [#3696](https://github.com/qOeOp/trade/issues/3696) — `fix`
- [#3697](https://github.com/qOeOp/trade/issues/3697) — `fix`
- [#3698](https://github.com/qOeOp/trade/issues/3698) — `fix`
- [#3699](https://github.com/qOeOp/trade/issues/3699) — `fix`
- [#3700](https://github.com/qOeOp/trade/issues/3700) — `fix`
- [#3701](https://github.com/qOeOp/trade/issues/3701) — `fix`
- [#3702](https://github.com/qOeOp/trade/issues/3702) — `authority`
- [#3703](https://github.com/qOeOp/trade/issues/3703) — `fix`
- [#3704](https://github.com/qOeOp/trade/issues/3704) — `fix`
- [#3705](https://github.com/qOeOp/trade/issues/3705) — `fix`
- [#3706](https://github.com/qOeOp/trade/issues/3706) — `skill`
- [#3707](https://github.com/qOeOp/trade/issues/3707) — `fix`
- [#3708](https://github.com/qOeOp/trade/issues/3708) — `fix`
- [#3709](https://github.com/qOeOp/trade/issues/3709) — `fix`
- [#3710](https://github.com/qOeOp/trade/issues/3710) — `fix`
- [#3711](https://github.com/qOeOp/trade/issues/3711) — `fix`
- [#3712](https://github.com/qOeOp/trade/issues/3712) — `fix`
- [#3713](https://github.com/qOeOp/trade/issues/3713) — `fix`
- [#3714](https://github.com/qOeOp/trade/issues/3714) — `fix`
- [#3715](https://github.com/qOeOp/trade/issues/3715) — `fix`

## Removal list
| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| 3 份完全相同的 `research-round` `graders/skill-fired.md` 常规副本 | 评测用例触发检查 | 套件根目录 `skill-fired.md` 符号链接 | 违反 `.agents/README.md:6-7` | 改为符号链接（#3713） |

## Decisions
以下 7 个议题涉及收紧或放宽拒绝/审计检查，需用户明确授权后方可修改：

- [#3660](https://github.com/qOeOp/trade/issues/3660) — live compare omits taken timestamps and labels price-precision mark rounding deltas as unexplained
- [#3662](https://github.com/qOeOp/trade/issues/3662) — Registering an unrelated candidate with retry_of bypasses INTERPRETATION_REQUIRED and _check_retry
- [#3663](https://github.com/qOeOp/trade/issues/3663) — judgment add accepts empty or whitespace-only bodies for interpretation, recommendation, and priority
- [#3674](https://github.com/qOeOp/trade/issues/3674) — Paper live terms check ignores contract status, contractType, and marginAsset, admitting SETTLING perpetuals
- [#3676](https://github.com/qOeOp/trade/issues/3676) — A source that failed causal review on precheck trial 1 slips past require_precheck via a second precheck trial
- [#3695](https://github.com/qOeOp/trade/issues/3695) — ledger/service.py _check_service silently skips schema validation when a compose deployment is moved to a new path
- [#3702](https://github.com/qOeOp/trade/issues/3702) — market/lifecycle.py validate_lifecycle allows two different symbols to claim the same active instrument_id
