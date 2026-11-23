# 2026-11-24 全量审计

| Item | Value |
|---|---|
| Sessions | 无指定会话；agents 与 burden 扫描 2026-11-19 以来的 Claude Code、Codex、Antigravity 转录 |
| Audit session | Claude Code，claude-opus-5-5，`3e053555-16bf-416a-838d-e2802b2d488f`；产品树为 `origin/main` 的独立 detached worktree，本会话只写本记录的 PR |
| Checkout / ledger | `5fc5168d6`；活动账本只读过研究命令，其余在临时账本上 |
| Coverage | Partial audit。Not exercised: gates/empty, gates/failed, gates/partial. gates 三行实际跑过且输出不同，但把脚本本身填成了 artifact，判成同一份；临时账本已删，不能重跑，按未检查算。各面未到之处：真实 GHCR、DoltHub 与 compose、发布主机、Live 真实账户、Paper 与 Live 有运行时的页面、容器镜像内系统包、Live 重启恢复（本机无 Redis）、统计检验全程走登记与验证、`market lifecycle`、quotes 导入导出 |
| Cost | 本次审计约 55 分钟；子代理 313 万 token（预算 300 万，超 5%），主会话未计；已确认 19 条（18 个议题加 1 条私下报告），约 16.5 万 token 一条。机器负载 25–144，成本读数偏高 |
| Net change | 提议：恢复类多为改顺序、改文字与合并规则；新增 2 组测试约 20 行、页面 1 个错误处理、Paper 撤单出队；删除 Live 一条停机规则（需授权）；不加字段；skill 约加 40 词 |

## Findings

| Item | Subject | State | Evidence |
|---|---|---|---|
| value | command-use | examined | `uv run --frozen python work/agents/value.py` exit 0, 5fc5168d6 |
| results | ledger-identity-vs-binance-archive | examined | `python3 -I work/research/results.py work/research/arch /tmp/doctor-research-out3/reports` exit 0, 5fc5168d6 |
| flow | single | examined | `zsh work/flow/flow.sh single 3 22ff41494473dbb6decd0f07930576efb3ed10cdb9593772010a4afb0708c469 1` exit 0, 5fc5168d6 |
| flow | pool | examined | `zsh work/flow/flow.sh pool 4 6e466d6f82647b951ccb3b6f3972d1b3f5e08ece141a8c2f9f86bea45abb91af 2` exit 0, 5fc5168d6 |
| parity | entry-cancel-replay-paper | examined | `uv run --frozen python work/parity/paper_cancel.py` exit 0, 5fc5168d6 |
| research | noise-edge-leak-verdicts | examined | `uv run --frozen python work/research/verdicts.py work/research` exit 0, 5fc5168d6 |
| research | report | examined | `env PYTHONPATH=. uv run --frozen python work/challenge/sim.py 1095 0.2 null 200 11` exit 0, 5fc5168d6 |
| external | binance-rest-and-archives | examined | `env PYTHONPATH=. python work/external/binance.py` exit 0, 5fc5168d6 |
| external | market | examined | `env PYTHONPATH=. uv run --frozen python work/challenge/mk.py work/challenge/w3` exit 0, 5fc5168d6 |
| consumers | ledger | same as another | `.venv/bin/python work/gates/consumers.py ledger` exit 0, 5fc5168d6 |
| consumers | ledger | examined | `.venv/bin/python work/gates/consumers.py ledger` exit 0, 5fc5168d6 |
| consumers | report | same as another | `.venv/bin/python work/gates/consumers.py report` exit 0, 5fc5168d6 |
| consumers | report | examined | `.venv/bin/python work/gates/consumers.py report` exit 0, 5fc5168d6 |
| consumers | cli | same as another | `.venv/bin/python work/gates/consumers.py cli` exit 0, 5fc5168d6 |
| consumers | cli | examined | `.venv/bin/python work/gates/consumers.py cli` exit 0, 5fc5168d6 |
| consumers | ide | same as another | `.venv/bin/python work/gates/consumers.py ide` exit 0, 5fc5168d6 |
| consumers | ide | examined | `.venv/bin/python work/gates/consumers.py ide` exit 0, 5fc5168d6 |
| consumers | ide | examined | `.venv/bin/python work/gates/consumers.py ide` exit 0, 5fc5168d6 |
| storage | ledger-restore-from-copies | examined | `bash work/storage/run.sh s1 --tmpfs /data:uid=501,size=800m` exit 0, 5fc5168d6 |
| storage | ledger-growth-per-candidate | examined | `bash work/storage/run.sh s5 --tmpfs /data:uid=501,size=800m` exit 0, 5fc5168d6 |
| gates | empty | same as another | `.venv/bin/python work/gates/gates.py temp-2ca9baef.json ghcr.io/qoeop/trade-runtime@sha256:1b5f7b6c6a40aa9d3a64b5985131b4af3d7906f0f77e53de11d6da716265ba97 work/gates empty` exit 0, 5fc5168d6 |
| gates | failed | same as another | `.venv/bin/python work/gates/gates.py temp-2ca9baef.json ghcr.io/qoeop/trade-runtime@sha256:1b5f7b6c6a40aa9d3a64b5985131b4af3d7906f0f77e53de11d6da716265ba97 work/gates failed` exit 0, 5fc5168d6 |
| gates | partial | same as another | `.venv/bin/python work/gates/gates.py temp-2ca9baef.json ghcr.io/qoeop/trade-runtime@sha256:1b5f7b6c6a40aa9d3a64b5985131b4af3d7906f0f77e53de11d6da716265ba97 work/gates partial` exit 0, 5fc5168d6 |
| faults | docker | examined | `env PYTHONPATH=audit uv run --frozen python work/interrupt/replayfaults.py` exit 0, 5fc5168d6 |
| faults | live | examined | `uv run --frozen python work/parity/livefault.py cancel_queued cancel_sent stop_2021 partial_opened partial_follow` exit 0, 5fc5168d6 |
| interrupt | deploy | examined | `bash work/interrupt/all.sh work/interrupt` exit 0, 5fc5168d6 |
| operation | disk-full-ledger-service | examined | `bash work/storage/run.sh s3 --tmpfs /data:uid=501,size=60m` exit 0, 5fc5168d6 |
| cost | import | examined | exponent 0.84, warm {'1': [0.220631, 0.306279, 0.273984], '4': [0.807294, 0.704249, 0.496347], '16': [2.813103, 2.855673, 2.751672]} |
| cost | ledger | broken | exponent None, warm None |
| cost | ledger | noisy | exponent None, warm {'5': [0.42492, 0.615838, 0.457479], '20': [0.502128, 0.195847, 0.380399], '60': [1.163707, 0.300681, 0.155659]} |
| cost | ledger | noisy | exponent None, warm {'4': [0.121321, 0.10488, 0.101849], '40': [0.264673, 0.272121, 0.261606], '160': [0.947152, 0.875778, 1.087716]} |
| cost | ledger | examined | exponent 0.62, warm {'10': [0.165835, 0.191312, 0.180493], '80': [0.637077, 0.627454, 0.717893], '160': [1.020437, 1.022628, 1.064343]} |
| cost | reports | noisy | exponent None, warm {'2': [0.518956, 0.66168, 0.93983], '10': [2.947998, 2.545554, 2.52486], '50': [21.750603, 16.380129, 15.821012]} |
| cost | reports | noisy | exponent None, warm {'1': [0.172435, 0.189833, 0.171521], '8': [1.238299, 1.266623, 1.236856], '64': [13.893519, 15.133329, 12.909623]} |
| cost | reports | examined | exponent 1.07, warm {'4': [0.630612, 0.616528, 0.62173], '24': [4.046916, 4.003944, 4.083722], '64': [12.211532, 12.206174, 12.931189]} |
| cost | replay | noisy | exponent None, warm {'2': [3.007759, 2.905739, 2.820931], '10': [11.194674, 15.652302, 21.529237], '40': [106.365418, 35.215219, 33.108329]} |
| cost | replay | examined | exponent 1.08, warm {'1': [0.633078, 0.674881, 0.682314], '8': [5.509685, 5.076491, 4.982953], '64': [59.898914, 59.052002, 59.069731]} |
| cost | replay | noisy | exponent None, warm {'2': [1.10212, 1.088488, 1.078308], '20': [13.122713, 12.825263, 12.565233], '64': [60.501275, 75.405825, 93.873882]} |
| structure | import graph and co-change | examined | `uv run --frozen python work/structure/cochange.py audit work/structure/log.txt` exit 0, 5fc5168d6 |
| size | by-area | examined | `python3 work/size.py` exit 0, 5fc5168d6 |
| checks | mutation-sample | examined | `sort work/checks/mut/mut.txt` exit 0, 5fc5168d6 |
| checks | studentized-mutants-13-modules | examined | `cat work/checks/one0.txt work/checks/one2.txt work/checks/one4.txt work/checks/v1.txt` exit 0, 5fc5168d6 |
| delivery | runs-since-2026-11-22 | examined | `python3 work/checks/delivery.py work/checks/runs.tsv work/checks/prs.json` exit 0, 5fc5168d6 |
| delivery | quality-queue | examined | `python3 work/checks/queue.py work/checks/runs.tsv` exit 0, 5fc5168d6 |
| delivery | docs-only-main-pushes | examined | `python3 work/checks/docsonly.py work/checks/runs.tsv` exit 0, 5fc5168d6 |
| delivery | release-steps | examined | `bash work/checks/flow.sh` exit 0, 5fc5168d6 |
| delivery | any | examined | `sh -c cd work/challenge && python3 skip.py` exit 0, 5fc5168d6 |
| lifecycle | first-start-interrupted-reset-idle-newhost | examined | `bash work/storage/run.sh s4 --tmpfs /data:uid=501,size=800m` exit 0, 5fc5168d6 |
| pages | empty | examined | `node work/pages/walk.mjs 18801 work/pages/empty.txt work/pages/e` exit 0, 5fc5168d6 |
| pages | records | examined | `node work/pages/walk.mjs 18802 work/pages/records.txt work/pages/r 15000` exit 0, 5fc5168d6 |
| pages | reload | examined | `node work/pages/reload.mjs` exit 0, 5fc5168d6 |
| pages | offline | examined | `node work/pages/offline.mjs` exit 0, 5fc5168d6 |
| usability | keyboard-contrast-narrow | examined | `node work/pages/usa.mjs` exit 0, 5fc5168d6 |
| words | readme-command-line-only | examined | `bash work/checks/follow.sh` exit 0, 5fc5168d6 |
| words | published-site | failed | `python3 work/checks/site.py` exit 1, 5fc5168d6 |
| words | published-site-vs-main | examined | `python3 work/checks/site.py` exit 0, 5fc5168d6 |
| security | dependency-and-action-pins | examined | `python3 work/external/pins.py` exit 0, 5fc5168d6 |
| security | docker-api-proxy-own-instance | examined | `python3 work/external/egress.py` exit 0, 5fc5168d6 |
| security | ide-requests-own-instance | failed | `python work/external/ide.py` exit 1, 5fc5168d6 |
| security | ide-requests-own-instance | examined | `python work/external/ide.py` exit 0, 5fc5168d6 |
| agents | recommendation-messages | examined | `python3 work/agents/rec.py` exit 0, 5fc5168d6 |
| agents | compaction-bcac6c3c | examined | `python3 work/agents/compact.py` exit 0, 5fc5168d6 |
| agents | antigravity-use | examined | `python3 work/agents/ag.py` exit 0, 5fc5168d6 |
| burden | user-messages | examined | `python3 work/agents/burden.py` exit 0, 5fc5168d6 |
| burden | usage-errors | examined | `python3 work/agents/ue.py` exit 0, 5fc5168d6 |
| governance | ci-holds | skipped tests | `uv run --frozen python work/checks/gov.py` exit 0, 5fc5168d6 |
| unchanged | market import interrupted and revised | examined | `uv run --frozen python work/structure/crash.py work/structure` exit 0, 5fc5168d6 |
| unchanged | market import vs original archives | examined | `sh work/structure/all.sh` exit 0, 5fc5168d6 |
| unchanged | engine audit mutated native reports | examined | `uv run --frozen python work/structure/mut.py work/structure/nr/reports work/structure` exit 0, 5fc5168d6 |
| fixed | a90bfb770 | undecided | 0 telling tests |
| fixed | c77f5302c | examined | 1 telling tests |
| fixed | 60a8a243b | examined | 1 telling tests |
| fixed | e1e939bdf | examined | 1 telling tests |
| fixed | 5fc5168d6 | undecided | 0 telling tests |
| fixed | 285dcb37b | undecided | 0 telling tests |
| fixed | 062a6c960 | undecided | 0 telling tests |
| self | issue-sources | examined | `python3 work/self.py` exit 0, 5fc5168d6 |
| self | open-issues | examined | `python3 work/rerun/open.py ev` exit 0, 5fc5168d6 |
| self | open-issues | examined | `python3 work/rerun/open.py ev` exit 0, 5fc5168d6 |

| Finding | Verdict | Observed | Expected | Control | At the last audit |
|---|---|---|---|---|---|
| issue-3529 | shown | ['passed', 'SOURCE_ALREADY_EXPOSED', 'SOURCE_PRECHECK_FAILED'] | ['passed', 'registered'] | ['passed', 'registered'] | present |
| issue-3498 | shown | 'RETRY_NOT_ALLOWED' | 'registered' | 'registered' | present |
| issue-3491 | shown | 'registered, bound; family latest is second retry: True' | 'RETRY_NOT_ALLOWED' | 'RETRY_NOT_ALLOWED' | present |
| issue-3531 | shown | ['veto', 'holdout_prior_trials', 'forward', 'generation'] | [] | [] | present |
| issue-3499 | shown | [(True, True), (True, True)] | [(False, True), (False, True)] | [(False, True), (False, True)] | absent |
| interrupt-bootstrap-stuck | shown | ['running', 'PUBLISH_FAILED', 'old line'] | ['running', 'published', 'new ledger'] | ['running', 'published', 'new ledger'] | unknown |
| issue-3500 | shown | [True, True] | [False, True] | [False, True] | present |
| offered-period-needs-a-write | shown | "one research_line row named <slug> and, when given, the line's targets in the same commit;" | 'nothing' | 'nothing' | present |
| issue-3460 | shown | [False, False] | [True, True] | [True, True] | present |
| paper-cancel-lost | shown | {'order': 'FILLED', 'held': ['0.010']} | {'order': 'CANCELED', 'held': []} | {'order': 'CANCELED', 'held': []} | present |
| interrupt-bootstrap-refused | shown | ['BOOTSTRAP_REFUSED', None, 'old line'] | ['running', 'published', 'new ledger'] | ['running', 'published', 'new ledger'] | unknown |
| issue-3497 | shown | [4, 13] | [4, 4] | [1, 1] | present |
| external-docker-api-second-spelling | shown | 按 SECURITY.md 不公开 | | | present |
| interrupt-bootstrap-health | shown | ['BOOTSTRAP_REFUSED', None, 'old line'] | ['running', 'published', 'new ledger'] | ['running', 'published', 'new ledger'] | unknown |
| issue-3454 | shown | [] | ['worst_quarter_return', 'net_without_top_instrument'] | ['worst_quarter_return', 'net_without_top_instrument'] | present |
| issue-3455 | shown | [] | ['above_volume', 'exit_net', 'deflated_range', 'annual_return_interval'] | ['above_volume', 'exit_net', 'deflated_range', 'annual_return_interval'] | present |
| issue-3496 | shown | ['sharpe_lo', 'by_instrument'] | ['dev_quarters', 'sharpe_lo', 'by_instrument', 'effective_trials'] | ['dev_quarters', 'sharpe_lo', 'by_instrument', 'effective_trials'] | present |
| external-market-lot-size | shown | {'symbol': 'UAIUSDT', 'max_quantity': 2000000.0} | {'symbol': 'UAIUSDT', 'max_quantity': 400000.0} | {'symbol': 'UAIUSDT', 'max_quantity': 400000.0} | present |
| external-terms-observed-at | shown | 262 | 0 | 0 | present |
| issue-3514 | shown | False | True | True | present |
| hosts-miss-antigravity | shown | [] | ['Antigravity'] | ['Claude Code'] | present |
| issue-3506 | shown | 'MONTH_EXISTS' | 'imported' | 'imported' | present |
| issue-3521 | shown | [True, 'stopping'] | [False, 'stopping'] | [False, 'clean_stop'] | present |
| issue-3492 | shown | 'LIVE_EVIDENCE_MISSING' | 'evidence' | 'evidence' | present |
| faults-docker-stagelog-hang | shown | 'HUNG' | 'returned' | 'returned' | present |
| issue-3494 | shown | [True, 'waiting'] | [False, 'waiting'] | [False, 'waiting'] | present |
| issue-3513 | shown | [] | ['BBBUSDT'] | ['BBBUSDT'] | unknown |
| issue-3519 | shown | {'BTCUSDT': [['77']]} | None | None | present |
| issue-3533 | shown | [12, 24, 36] | [12, 12, 12] | [2, 2, 2] | present |
| storage-paper-backup-stops-after-restore | shown | 'never 0' | 'synced 0' | 'synced 0' | present |
| storage-interrupted-first-backup-blocks-every-later | shown | 'EXPORT_PATH_INVALID' | 'ok' | 'ok' | present |
| storage-disk-full-ledger-refuses-writes-after-space-returns | shown | 'refused 0 accepted' | 'accepted 0 accepted' | 'accepted 0 accepted' | present |
| paired-sparse-told-apart | indiscriminate | {'told_apart_false_rate_within_twice_alpha': False} | {'told_apart_false_rate_within_twice_alpha': True} | {'told_apart_false_rate_within_twice_alpha': False} | present |
| dsr-effective-trials-double-discount | shown | {'best_of_noise_above_95pct_at_most_7.5pct': False} | {'best_of_noise_above_95pct_at_most_7.5pct': True} | {'best_of_noise_above_95pct_at_most_7.5pct': True} | present |
| cost-account-margins-quadratic | shown | 'bytes per trade grew 8x' | 'bytes per trade at most doubled' | 'bytes per trade at most doubled' | present |
| checks-studentized-untested | shown | 'survived' | 'killed' | 'killed' | present |
| checks-rollback-start-untested | shown | 'survived' | 'killed' | 'killed' | unknown |
| paired-sparse-told-apart-2 | indiscriminate | {'told_apart_false_rate_within_twice_alpha': False} | {'told_apart_false_rate_within_twice_alpha': True} | {'told_apart_false_rate_within_twice_alpha': False} | present |
| graph-status-masked-after-retry-opens | shown | {'finished': ['invalid'], 'research_trials': 2, 'line_list_eligible': False, 'graph': 'recommended'} | {'finished': ['invalid'], 'research_trials': 2, 'line_list_eligible': False, 'graph': 'masked'} | {'finished': ['invalid'], 'research_trials': 1, 'line_list_eligible': False, 'graph': 'masked'} | present |
| graph-status-superseded-without-any-run | shown | {'eligible': [None], 'status': 'superseded'} | {'eligible': [None], 'status': 'unrun'} | {'eligible': [True], 'status': 'superseded'} | present |
| live-evidence-counts-zero-fill-explore | shown | {'fills': 0, 'backing_replays': 1} | {'fills': 0, 'backing_replays': 0} | {'fills': 12, 'backing_replays': 1} | present |
| line-starts-on-crashed-precheck | shown | {'precheck_native_exit': 1, 'line': 'opened'} | {'precheck_native_exit': 1, 'line': 'START_REVIEW_REQUIRED'} | {'precheck_native_exit': 0, 'line': 'opened'} | present |
| flow-paper-load-refusal | shown | {'runner_said': None, 'status': 'invalid', 'seal_names_it': False, 'reasons': ['JOURNAL_MISSING', 'RUNNER_EXIT_NONZERO', 'SUMMARY_MISSING']} | {'runner_said': None, 'status': 'complete', 'seal_names_it': True, 'reasons': ['JOURNAL_MISSING', 'RUNNER_EXIT_NONZERO', 'SUMMARY_MISSING']} | {'runner_said': 'PAPER_CACHE_UNAVAILABLE', 'status': 'complete', 'seal_names_it': True, 'reasons': ['REFUSED:PAPER_CACHE_UNAVAILABLE', 'RUNNER_EXIT_NONZERO', 'SUMMARY_MISSING']} | present |
| flow-paper-load-refusal-v2 | shown | {'runner_said': 'SOURCE_REACH', 'status': 'invalid', 'seal_names_it': False, 'reasons': ['JOURNAL_MISSING', 'RUNNER_EXIT_NONZERO', 'SUMMARY_MISSING']} | {'runner_said': 'SOURCE_REACH', 'status': 'complete', 'seal_names_it': True, 'reasons': ['JOURNAL_MISSING', 'RUNNER_EXIT_NONZERO', 'SUMMARY_MISSING']} | {'runner_said': 'PAPER_CACHE_UNAVAILABLE', 'status': 'complete', 'seal_names_it': True, 'reasons': ['REFUSED:PAPER_CACHE_UNAVAILABLE', 'RUNNER_EXIT_NONZERO', 'SUMMARY_MISSING']} | present |
| graph-unfinished-superseded | shown | {'version': 'pa_sweep_reclaim@39', 'status': 'superseded', 'has_economic_evidence': False} | {'version': 'pa_sweep_reclaim@39', 'status': 'unrun', 'has_economic_evidence': False} | {'version': 'pa_sweep_reclaim@36', 'status': 'superseded', 'has_economic_evidence': True} | present |
| ide-unknown-version-address | shown | {'asked': 'nosuch@1', 'address': '#nosuch@1', 'details': 'pa_sweep_reclaim@40', 'notice': False} | {'asked': 'nosuch@1', 'address': '#nosuch@1', 'details': 'nosuch@1 or a notice', 'notice': False} | {'asked': 'pa_sweep_reclaim@29', 'address': '#pa_sweep_reclaim@29', 'details': 'pa_sweep_reclaim@29', 'notice': False} | - |
| ide-not-served-offline | shown | {'service': 'down', 'says_not_served': True, 'trades_drawn': False} | {'says_not_served': False, 'trades_drawn': False, 'service': 'down'} | {'service': 'up', 'says_not_served': False, 'trades_drawn': True} | - |
| ide-stream-502 | shown | {'answer': '502', 'streams_before': True, 'streams_reopened_after_recovery': False, 'graph_still_drawn': True, 'warning': False} | {'streams_before': True, 'streams_reopened_after_recovery': True, 'graph_still_drawn': True, 'warning': False, 'answer': '502'} | {'answer': 'refused', 'streams_before': True, 'streams_reopened_after_recovery': True, 'graph_still_drawn': True, 'warning': False} | - |
| paired-sparse-told-apart-3 | shown | {'told_apart_false_rate_at_most_12.5pct_at_alpha_5pct': False} | {'told_apart_false_rate_at_most_12.5pct_at_alpha_5pct': True} | {'told_apart_false_rate_at_most_12.5pct_at_alpha_5pct': True} | present |
| live-cancel-ends-run | shown | {'exit': 0, 'position': '0.000', 'stopping': ['stopping:unsubmitted_entry_canceled']} | {'exit': None, 'position': '0.002', 'stopping': []} | {'exit': None, 'position': '0.002', 'stopping': []} | present |
| flow-pool-reconcile-quantity | shown | {'reason': '1 order group(s) differ for no known cause', 'groups': 3, 'quantity_differences': ['0.000', '0.01']} | {'reason': None, 'groups': 3, 'quantity_differences': ['0.000', '0.01']} | {'reason': None, 'groups': 2, 'quantity_differences': ['0.000']} | present |

Shown: 49 of 51 probed. Of 41 datable ones, the last audit already had 40.

反驳：3 个代理判 29 条；18 条或其中部分确认并开议题（合并同因后），改窄或改正措辞 11 条；推翻或按设计 8 条（-2021 止损被拒即停、零成交 explore 可作 Live 证据、条款 observed_at、比较区间在少差异日过宽的原说法、有效试验数双重折扣、main 重跑只改文档的提交、`ledger mirror` 帮助已是 #3499、崩溃预检可开线影响低）。
未经反驳、未开议题：`cost-account-margins-quadratic`（宽持仓回放的 `account.csv` 里 margins 占 75–97%，删列动指纹，需授权）；Paper README 的 start 例子缺必填参数；`COMPARE_UNCOVERED` 的下一步没提 `--preliminary`；键盘与对比度；挑战 2 的补救。
1 条涉及 Docker API 代理，按 `SECURITY.md` 不公开。
旧议题重跑：33 个里 19 个仍出现，0 个消失，14 个未重跑：#3458 #3457 #3495 #3532 #3520 #3522（预算），#3503 #3505 #3507（要活动账本或市场），#3504（库内测量），#3508 #3509（要真实账户），#3530 #3534（要 eval）；#3523 #3524 #3525 未看。证据里 `issue-3513` 有一行早期读数由输入回显造成，无效，只认最后一行。修复复测：3 个成立（`c77f5302c` `60a8a243b` `e1e939bdf`），4 个无法判定。
过程偏离：一路代理用了一次自己脚本名的模式 kill；一路用临时档案写进用户档案目录后已删；`audit/.venv` 曾被重装后恢复。

- [#3540](https://github.com/qOeOp/trade/issues/3540) add
- [#3541](https://github.com/qOeOp/trade/issues/3541) remove（authority）
- [#3542](https://github.com/qOeOp/trade/issues/3542) restate/add（authority）
- [#3543](https://github.com/qOeOp/trade/issues/3543) restate（authority）
- [#3544](https://github.com/qOeOp/trade/issues/3544) restate
- [#3545](https://github.com/qOeOp/trade/issues/3545) restate
- [#3546](https://github.com/qOeOp/trade/issues/3546) restate
- [#3547](https://github.com/qOeOp/trade/issues/3547) restate
- [#3548](https://github.com/qOeOp/trade/issues/3548) restate
- [#3549](https://github.com/qOeOp/trade/issues/3549) merge
- [#3550](https://github.com/qOeOp/trade/issues/3550) add（测试）
- [#3551](https://github.com/qOeOp/trade/issues/3551) add（测试）
- [#3552](https://github.com/qOeOp/trade/issues/3552) none（authority，等证据）
- [#3553](https://github.com/qOeOp/trade/issues/3553) add
- [#3554](https://github.com/qOeOp/trade/issues/3554) restate
- [#3555](https://github.com/qOeOp/trade/issues/3555) restate
- [#3556](https://github.com/qOeOp/trade/issues/3556) add
- [#3557](https://github.com/qOeOp/trade/issues/3557) restate

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| Live 的 `unsubmitted_entry_canceled` 停机 | 未发送的入场没有终态事件 | 出队并本地终结该单 | 回环上一次撤单即平掉受保护仓位 | 移除，等用户决定（#3541） |

## Decisions

- [#3541](https://github.com/qOeOp/trade/issues/3541)、[#3542](https://github.com/qOeOp/trade/issues/3542)、[#3543](https://github.com/qOeOp/trade/issues/3543)、[#3552](https://github.com/qOeOp/trade/issues/3552)，以及私下报告的一条
- 挑战的选择（由一个代理测量，未再复核）：换方向判据四区间并用，保留（零差异误判约 6%，单用一条会漏掉回撤差异；日差异自相关到 0.5 或 `REVIEW_EVERY` 变大时重开）；行情存储逐月整体拒绝，可改不急（一个合约一行改动停全池，但 29 合约 1,953 份日档里未见单合约重发；见到一例即重开）；main 全量重测，保留（69% 的合并树此前没测过；开合并队列或嫌发布等待时重开）
