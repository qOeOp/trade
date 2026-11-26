# 全量分支与总装集成交接总账（2026-11-27，供 Owner 与 Claude 逐分支审阅/合入）

- **基准基线**：`origin/main` @ `d4460250a`
- **主工作区状态**：`/Users/vx/WebstormProjects/trade` 全程未改动，仍在 `main`，未建 PR、未合入 `main`
- **总装验证分支**：`origin/exp/integration-preview`（本地 worktree：`/Users/vx/WebstormProjects/trade-wt-integration`）

---

## 1. 11 条独立分支清单（按推荐合入 `main` 顺序）

每条分支均直接基于 `origin/main` (`d4460250a`) 独立拉出，可由 Claude 逐条审阅、微调或拆 PR，无需堆叠。

| 顺 | 分支名 | 远程 HEAD | 本地 Worktree | 覆盖 Issues | 核心改动摘要 | 合入注意事项 |
|---|---|---|---|---|---|---|
| 1 | `exp/docs-agents-200u-auto` | `f3c9dffcc` | `/Users/vx/WebstormProjects/trade-wt-docs-agents` | `#3785`（Owner 2026-11-27 授权） | 更新 `AGENTS.md`：放开 200U 专用合约测试账户有界回归权限，收窄 `authority` 为不可逆红线，允许全自动 `product-doctor --auto` 与缺陷修复不因旧 `authority` 卡死 | 无代码冲突；先合此分支可明确后续分支的权限口径 |
| 2 | `exp/fix-http-ledger-hygiene` | `be60fc388` | `/Users/vx/WebstormProjects/trade-wt-http-ledger-hygiene` | `#3697`, `#3695`, `#3710`, `#3711`, `#3712` | 严格 `Content-Length` 校验（IDE/Paper/first_run）；`ledger/service.py` 目录迁移不再跳过 schema 检查；`mypy.ini` 纳入 `deploy` 并修清 16 个类型报错；`test_source_hygiene.py` 增加 `OVERSIZED` 下行棘轮；PR CI 校验 `changelog.d` 格式 | `OVERSIZED["cli/research_commands.py"]` 紧缩至 `934`；合入 `#3759` 时需同步调至 `937`（仍低于 `origin/main` 的 `973`） |
| 3 | `exp/fix-3782-paper-oom` | `372be24cd` | `/Users/vx/WebstormProjects/trade-wt-fix-3782` | `#3782` | 校准 `paper/runs.py` 内存配额（`320 + 32*N` MiB，6 合约 512 MiB）；`engine/paper.py` 显式设 `PAPER_TICK_CAPACITY = 1_000` | 与 `#3783`/`#3658` 同改 `engine/paper.py`（合流后实测 1243 <= 1244 行） |
| 4 | `exp/fix-3783-metrics-checkpoint` | `7141337ff` | `/Users/vx/WebstormProjects/trade-wt-fix-3783` | `#3783` | 解除 `Metrics` 订阅永久 defer checkpoint 的双重阻断（启动期不置 `_paper_subscription_changes`、豁免 `runner-metrics` 定时器、`due()` 拦到期行、`backfill()` 回补 `(cut_ns, warm_at]` 并走 `submitted()` 触价检查） | 与 `#3782` 在 `tests/engine/test_paper.py` 尾部各新增一个测试类，合并保留两者即可 |
| 5 | `exp/fix-paper-runtime-guards` | `b829a36f1` | `/Users/vx/WebstormProjects/trade-wt-paper-runtime-guards` | `#3658`, `#3674`, `#3650` | Paper 等待队列 GTD 605s 提前量按提交时刻计算；`klines.terms()` 校验 `TRADING`/`PERPETUAL`/`USDT`；`Session.admitted` + `OrderRules.market_exit` 禁止恢复未准入或 `WARMING` 期发 market exit | 触及 replay closure（`engine/klines.py`、`engine/order_rules.py`），CI 会重建 replay 镜像；`engine/paper.py` 净减 1 行至 1243 行 |
| 6 | `exp/fix-live-stop-compare` | `444320c4f` | `/Users/vx/WebstormProjects/trade-wt-live-stop-compare` | `#3727`, `#3660` | Live STOP 改为平仓后重新拉取最终快照并过 `require_flat` 才记 `venue_flat`；`live/compare.py` 填充 `taken` 时间戳消除 mark 舍入误报 unexplained | 两笔原子提交（`05769981b`、`444320c4f`），含合规 `changelog.d/` 碎片 |
| 7 | `exp/fix-replay-capital-lot` | `046fa4c89` | `/Users/vx/WebstormProjects/trade-wt-replay-capital-lot` | `#3652`（并实证评估 `#3552`, `#3717`） | `CapitalObserver` 按 `<= T` 原生重建仓位估值修复 quotes 模式回撤漏算，并对齐 `ledger/metrics.py` `_drawdown_section` 截断边界 | 触及 replay closure（`engine/report.py`、`engine/run.py`）；后续单独 PR 同步 `nautilus-report-analysis` 技能文案与 eval grader |
| 8 | `exp/fix-line-coverage-veto` | `064c3e2dd` | `/Users/vx/WebstormProjects/trade-wt-line-coverage-veto` | `#3761`, `#3760`, `#3759` | 中断 control trial (`status=None`) 保留 `summary` 并标 `missing`；`VETO_RESERVE` 用 `input_start` 识别非零 warm-up 整年；`line select`/`line history`/`line close` 按有效多轨道覆盖（bars/`--metrics`/quotes/晚上市/pool）规划窗口 | `cli/research_commands.py` 为 937 行（低于 `origin/main` 973）；`report.history.market_days` 已替换为 `market_scope` |
| 9 | `exp/fix-registration-judgment-guards` | `b26cf2562` | `/Users/vx/WebstormProjects/trade-wt-reg-judgment` | `#3676`, `#3662`, `#3663`, `#3667`, `#3668`, `#3669` | 封堵二次 precheck 绕过、无关候选 `retry_of` 绕过、空白 `judgment`、`--universe pool` 与 `--symbols` 冲突及 `--op-id` 复用绕过（零新增存储字段） | `paper/serve.py` 保持 882 行；`register.py` 部分校验拆至 `registration/duties.py`（766/800） |
| 10 | `exp/feat-3786-soak-fixture` | `c72cf14f4` | `/Users/vx/WebstormProjects/trade-wt-feat-3786` | `#3786` | 新增 `tests/soak/` 6 合约加速 Paper/Live 浸泡与故障注入夹具（内存斜率、多轨道、checkpoint 饥饿检测、WS/429/强平对账、结构化日志契约）及 `Loopback(symbols=...)` 多合约扩展 | 合入 `#3782`/`#3783` 后，可顺带合并 `exp/integration-preview` 中新增的 `#3782+#3783+#3786` 6 合约 Metrics 浸泡回归锁 |
| 11 | `exp/doctor-v2-convergence` | `ff91d7029` | `/Users/vx/WebstormProjects/trade-wt-doctor-v2` | `#3785`, `#3762`, `#3766` | `product-doctor` v2 收敛（Round 8–13 红队修复 + 5 个纯 stdlib 资产减负，517 JS/TS bit-exact parity）+ v3.0（`--prod-logs`、研发流程合规、`-auto`/`--steady-exit-code`）+ `#3762`/`#3766` + 13 个新增 eval cases + 修复并行测试下临时 git repo `gc.auto` 竞态 | Claude 额度恢复后可补跑 `claude plugin eval .agents` 做 A/B 验证 |

---

## 2. Wave 5 核实分流（有证据、未强改的外部/上游/在线评测条目）

- **`#3552`**（`MARKET_LOT_SIZE`）：已在 `d4460250a` 复现确认，但 Owner 2026-11-24 已明确暂不新增存储字段（且新增字段需独立子代理评审 + `docs/plans/` 记录 + 显式授权），已在 issue 留档。
- **`#3717`**（Paper Sandbox funding 结算）：已补齐量化复现（单次 1 bps funding 造成 4 步仓位偏差触发 `orders_differ`），但原生探测 `nautilus_trader==2.0.0rc7` Rust `SandboxExecutionClient` 未暴露 funding hook，Python 侧修改副本会构造平行账本违反 `AGENTS.md`，需上游 rc7+ 支持或 Owner 决策对比口径。
- **`#3505`**（NU/ANT/MDT 重用代码）：代码已合入，仅待下一代数据线全量重导 active market 目录。
- **`#3508` / `#3509`**（实盘未知撤单与幽灵仓位）：既有防线均在位，离线场景已覆盖进 `tests/soak/`，待合入 200U 测试账户规则后执行实盘观察。
- **`#3504`**（Nautilus rc7 `update_position` 二次方扫描）：已固定 `nautilus_trader==2.0.0rc7`，待下次升级 Nautilus 复测。
- **`#3523` / `#3524`**（真机跨代切换实测 / GHCR 30 天定时清理观察）：需真机发布或等待定时任务出现可删清单。
- **`#3764`, `#3765`, `#3767`, `#3768`**（概率性 eval 波动）：需在线运行 `claude plugin eval .agents` >= 12 次采样后决策；其中 `#3766` 明确的规则缺口已在 `exp/doctor-v2-convergence` 补齐。

---

## 3. 总装集成验证记录（`exp/integration-preview`）

- **静态检查**：`uv run --frozen ruff check .` **0 errors**；`uv run --frozen mypy`（全仓 194 文件，含 `deploy`）**0 errors**。
- **专项门禁**：`tests/soak/`（含新增 `#3782+#3783+#3786` 6 合约 Metrics 订阅 8h 浸泡 + 16m 断电回补回归锁）**7/7 OK（2.0s）**；`tests.test_source_hygiene + tests.test_package_layers + tests.runtime.test_replay_closure + tests.test_changelog_release + tests.test_eval_cases` **19/19 OK**。
- **Doctor v3.0 自验**：`doctor.py delta origin/main HEAD` 报告 `tangled_refactor_risk: false`；既有文件健康度仅 3 处轻微变化（`engine/live.py` 4.08→3.98、`engine/paper_session.py` 4.00→3.87、`ledger/lines.py` 7.41→5.44）。
- **全仓测试**：`uv run --frozen python .github/scripts/run-tests.py`（全仓库 178 个测试模块并行运行，详见最终推送前全绿结果）。
