# 全量分支与总装集成交接总账（2026-11-27，供 Owner 与 Claude 逐分支审阅/合入）

- **基准基线**：`origin/main` @ `d4460250a`
- **主工作区状态**：`/Users/vx/WebstormProjects/trade` 全程未改动，仍在 `main`，未建 PR、未合入 `main`
- **总装验证分支**：`origin/exp/integration-preview`（本地 worktree：`/Users/vx/WebstormProjects/trade-wt-integration`）
- **过夜审计全过程证据**：见 `docs/plans/overnight-audit-20261127.zh.md`

---

## 1. 14 条独立分支清单（全部直接基于 `origin/main` `d4460250a`，按推荐合入顺序）

每条分支均独立拉自 `origin/main` (`d4460250a`)、无堆叠，且均通过 Phase 1–3 两轮独立红队/冷区复验（**0 剩余 P0/P1**），可由 Claude 逐条审阅、微调或拆 PR。

| 顺 | 分支名 | 远程 HEAD | 本地 Worktree | 覆盖 Issues / 审计项 | 核心改动摘要 | 合入注意事项 |
|---|---|---|---|---|---|---|
| 1 | `exp/docs-agents-200u-auto` | `8c1d8c636` | `/Users/vx/WebstormProjects/trade-wt-docs-agents` | `#3785`（Owner 2026-11-27 授权） | 更新 `AGENTS.md`：放开 200U 专用合约测试账户有界回归权限（含权益校验与用户自持凭据），收窄 `authority` 为不可逆红线，明确 `doctor.py advise --auto` 适用边界 | 无代码冲突；先合此分支统一权限口径 |
| 2 | `exp/fix-http-ledger-hygiene` | `5542e2d14` | `/Users/vx/WebstormProjects/trade-wt-http-ledger-hygiene` | `#3697`, `#3695`, `#3710`, `#3711`, `#3712` | 严格 HTTP `Content-Length`/重复 `Transfer-Encoding` 校验并统一接入 `live/serve.py` 与 `ledger/replica.py`（拒绝截断体）；`ledger/service.py` 迁移不跳 schema 校验且拒绝空 `databases`；`mypy.ini` 纳入 `deploy`；`OVERSIZED` 下行棘轮；`changelog-release.py` 严格校验 | `OVERSIZED["cli/research_commands.py"]` 需在合入 `#3759` 时对齐至 `937`（仍低于 `origin/main` `973`） |
| 3 | `exp/fix-3782-paper-oom` | `372be24cd` | `/Users/vx/WebstormProjects/trade-wt-fix-3782` | `#3782` | 校准 `paper/runs.py` 内存配额（`320 + 32*N` MiB，6 合约 512 MiB）；`engine/paper.py` 显式设 `PAPER_TICK_CAPACITY = 1_000` | 与 `#3783`/`#3658` 同改 `engine/paper.py`（合流后实测 1244 行） |
| 4 | `exp/fix-3783-metrics-checkpoint` | `3fc95ae1a` | `/Users/vx/WebstormProjects/trade-wt-fix-3783` | `#3783` | 解除 `Metrics` 订阅永久 defer checkpoint 双重阻断，并按时间序交错回补 Metrics 与聚合 bar、持久化每合约 Metrics 游标、保护非 MARKET 挂单、`on_data()` 动态退订与 `Session.exiting()` `_has_backfill()` 守卫 | 与 `#3782` 在 `tests/engine/test_paper.py` 尾部各增测试类，合并保留两者即可 |
| 5 | `exp/fix-paper-runtime-guards` | `bfefbb574` | `/Users/vx/WebstormProjects/trade-wt-paper-runtime-guards` | `#3658`, `#3674`, `#3650` | Paper 等待队列 GTD 605s 按提交时刻计算；`klines.terms()` 校验 `TRADING`/`PERPETUAL`/`USDT`；`Session.admitted`/`commanded(close=True)`/`OrderRules.close_position` + `Waiting._wait()` 封堵 `WARMING` TOCTOU | 触及 replay closure（`engine/klines.py`、`engine/order_rules.py`），CI 会重建 replay 镜像 |
| 6 | `exp/fix-live-stop-compare` | `2e7f28f4d` | `/Users/vx/WebstormProjects/trade-wt-live-stop-compare` | `#3727`, `#3660` | Live STOP 平仓后复拉最终快照并过 `require_flat`（修复 `Observer.observe()` 漏 `return` 落入同 tick timeout）；`live/compare.py` 填 `taken` 消除 mark 舍入误报 | 含合规 `changelog.d/` 碎片 |
| 7 | `exp/fix-replay-capital-lot` | `b1285310c` | `/Users/vx/WebstormProjects/trade-wt-replay-capital-lot` | `#3652`（并实证评估 `#3552`, `#3717`） | `CapitalObserver` 按 `<= T` 原生重建仓位估值修复 quotes 回撤漏算，并修复多/单/末根 bar MARK 缺口假阳性 `CAPITAL_VALUATION_GAP`，对齐 `ledger/metrics.py` `_drawdown_section` | 触及 replay closure（`engine/report.py`、`engine/run.py` 943 行） |
| 8 | `exp/fix-line-coverage-veto` | `8141c6d6d` | `/Users/vx/WebstormProjects/trade-wt-line-coverage-veto` | `#3761`, `#3760`, `#3759` | 中断 control trial 保留 `summary` 并标 `missing`；`VETO_RESERVE` 用 `input_start` 识别非零 warm-up 整年；`line select/history/close` 按统一 `earliest` + 显式 `--symbols` 按月轨道交集规划（空/缺失拒 `COVERAGE_INCOMPLETE`，排除 0 行 Parquet footer） | `cli/research_commands.py` 937 行；`report.history.market_days` 替换为 `market_scope` |
| 9 | `exp/fix-registration-judgment-guards` | `423ee14f4` | `/Users/vx/WebstormProjects/trade-wt-reg-judgment` | `#3676`, `#3662`, `#3663`, `#3667`, `#3668`, `#3669` | 封堵二次 precheck（按时刻切片 `last_research_symbols(..., at=...)` + `matches_scope`）、逐跳 `_unrelated_retry` 绕过、未过审计 capture（`audit/audit.json` `passed is True`）、`Cf` 零宽空白 `judgment`、`--universe pool` 与 `--symbols` 冲突及 `--op-id` 复用（零新增存储字段） | `paper/serve.py` 882 行；校验拆至 `registration/duties.py` |
| 10 | `exp/feat-3786-soak-fixture` | `0fcbdf345` | `/Users/vx/WebstormProjects/trade-wt-feat-3786` | `#3786` | 新增 `tests/soak/` 6 合约加速 Paper/Live 浸泡与故障注入夹具（`try/finally` 关 journal、内存斜率/OOM/容器上限、WS 粘包/429/强平对账、日志契约）及 `Loopback(symbols=...)` | 合入 `#3782`/`#3783` 后可顺带合入总装分支中的 6 合约 Metrics 8h 浸泡回归锁 |
| 11 | `exp/doctor-v2-convergence` | `7952aedbc` | `/Users/vx/WebstormProjects/trade-wt-doctor-v2` | `#3785`, `#3762`, `#3766` + Phase 3 `self` | `product-doctor` v2 收敛 + v3.0（流式 `O(1)` `--prod-logs`、生产事故抢占、研发合规、`--auto` 全量红线过滤、`--steady-exit-code`、`cost` RSS/heap 标度量测、`lenses.md` 盲区补强、13 个 eval cases） | 5 个纯 stdlib 资产 `max_cognitive <= 47`；Claude 恢复后可补跑 `claude plugin eval .agents` |
| 12 | `exp/fix-ide-audit-findings` | `cb2cb307d` | `/Users/vx/WebstormProjects/trade-wt-fix-ide-audit` | Phase 2C (`IDE-F1..F4`) + Phase 3 R2 (`P1-OV1`) | 修复 Phone `?run=` 强刷、Desktop `localStorage` 深链劫持、Phone `RunsTab` 离线伪造计数、Phone `PaperPage` 封存口径与离线骨架卡死；修复 `ide/overview/src/app.ts` 在 `Host` 校验前无保护 `new URL()` 导致的进程崩溃 DoS | 零字体改动；`ide/web` 361/361 + `ide/overview` 42/42 全绿 |
| 13 | `exp/fix-audit-market-deploy` | `a45794741` | `/Users/vx/WebstormProjects/trade-wt-fix-audit-market-deploy` | Phase 3A (`3A-1` P0, `3A-2` P1, `3A-3` P1) | 修复退市合约冻结 `market` `latest_day`/`head` 达 60 天；修复 `deploy/update.py` 处理 Docker JSON `RepoTags`/`RepoDigests: null` 崩 `TypeError`（纯 stdlib）；修复 symbol 路径穿越校验并合法保留 Unicode 合约名 | 与 `exp/fix-http-ledger-hygiene` 均改 `deploy/update.py`，合并保留两处修复即可 |
| 14 | `exp/fix-audit-live-paper` | `de66f6d89` | `/Users/vx/WebstormProjects/trade-wt-fix-audit-live-paper` | Phase 3B (`3B-1` P1, `3B-2` P1) | 修复 `live/notify.py:_active()` `str`/`int` 键不匹配丢弃平静日日报；修复 `paper/serve.py:Daemon.seal_found()` 对 `>600s` `unsealed` 孤儿误派 `resume` 而非 `seal` 及 `paper/runs.py:resume()` 缺失 `inputs/*` 捕获 `OSError` | `paper/serve.py` 保持 882 行 |

---

## 2. 核实分流（有证据、未强改的外部/上游/在线评测条目）

- **`#3552`**（`MARKET_LOT_SIZE`）：已在 `d4460250a` 复现确认，但 Owner 2026-11-24 已明确暂不新增存储字段（新增字段需独立子代理评审 + `docs/plans/` 记录 + 显式授权），已在 issue 留档。
- **`#3717`**（Paper Sandbox funding 结算）：已补齐量化复现（单次 1 bps funding 造成 4 步仓位偏差触发 `orders_differ`），原生探测 `nautilus_trader==2.0.0rc7` Rust `SandboxExecutionClient` 未暴露 funding hook，Python 侧修改副本会构造平行账本违反 `AGENTS.md`，需上游 rc7+ 支持或 Owner 决策对比口径。
- **`#3505`**（NU/ANT/MDT 重用代码）：代码已合入，仅待下一代数据线全量重导 active market 目录。
- **`#3508` / `#3509`**（实盘未知撤单与幽灵仓位）：既有防线均在位，离线与 6 合约真子进程场景已通过压测，待合入 200U 测试账户规则后执行实盘观察。
- **`#3504`**（Nautilus rc7 `update_position` 二次方扫描）：已固定 `nautilus_trader==2.0.0rc7`，待下次升级 Nautilus 复测。
- **`#3523` / `#3524`**（真机跨代切换实测 / GHCR 30 天定时清理观察）：需真机发布或等待定时任务出现可删清单。
- **`#3764`, `#3765`, `#3767`, `#3768`**（概率性 eval 波动）：需在线运行 `claude plugin eval .agents` >= 12 次采样后决策；其中 `#3766` 明确的规则缺口已在 `exp/doctor-v2-convergence` 补齐。

---

## 3. 总装集成终验记录（`exp/integration-preview`）

- **静态与类型门禁**：`uv run --frozen ruff check .` 0 errors；`uv run --frozen mypy`（全仓 194 文件，含 `deploy`）0 errors。
- **前端与 Overview 门禁**：`ide/overview` `node --test src/*.test.ts` **42/42 pass** + `tsc --noEmit` 0 errors；`ide/web` `npm test` **361/361 pass** + `tsc`/`check-rules`/`knip`/`vite build` 全绿。
- **专项门禁**：`tests.test_source_hygiene` + `tests.test_package_layers` + `tests.runtime.test_replay_closure` + `tests.test_changelog_release` + `tests.test_eval_cases` **19/19 OK**；8 个 `OVERSIZED` 模块全部严格落在紧缩上限内。
- **全仓并行单测**：`uv run --frozen python .github/scripts/run-tests.py` 全仓全部测试模块 100% 通过（退出码 0，详见推送前实测输出）。
- **Doctor v3.0 终验**：`doctor.py delta origin/main HEAD` 报告 `tangled_refactor_risk: false`；`doctor.py advise --tree HEAD --auto --issues-json /tmp/doctor-rd-sources/issues_batch.json` 精准拦截 4 条红线 `[3552, 3524, 3508, 3505]` 并放行全部 20 条普通缺陷。
