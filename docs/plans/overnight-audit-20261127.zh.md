# 过夜深度对抗审计与全栈收官报告（2026-11-27）

- **基准基线**：`origin/main` @ `d4460250a`
- **执行模型**：Phase 1（11 条既有分支独立红队对抗自审 + 两轮收敛）→ Phase 2（真子进程 6 合约 Live / 真临时 Dolt / 无头 Chrome 全栈压测）→ Phase 3（`product-doctor` v3.0 跨模块冷区盲审 → 独立反驳 → 修复 → Doctor `self` 演化 → 第二轮收敛复验）→ Phase 4（14 条独立分支全量总装验证）
- **铁律核查**：主工作区 `/Users/vx/WebstormProjects/trade` 全程零修改（停在 `main`，无 PR、无合入）；零字体改动（保留 PP Supply Mono）；零凭据/私钥/运行中 IDE 页面读取；零 active ledger/active market/Docker/真机/真实 Live 账户操作；零新增 ledger 存储字段；`product-doctor` 资产与 `deploy/` 保持纯 Python stdlib；未新建多余 GitHub bug issue。

---

## 一、Phase 1：11 条既有分支独立红队对抗自审（两轮收敛：33 个 P0/P1 全部清零）

将 11 条独立分支按 3 个盲审分组交给无上下文独立红队子代理按“只找反例、竞态、边界失效与绕过”模式审查，确认并修复 **33 个实证（`shown`）P0/P1 缺陷**，随后由独立 Round-2 复验子代理逐条回归核查，**全部 11 条分支 0 P0/P1 收敛**：

| 分支 | 最终 HEAD | 红队抓出的核心 P0/P1 与修复 | R2 复验 |
|---|---|---|---|
| `exp/docs-agents-200u-auto` | `8c1d8c636` | 对齐 `AGENTS.md` 与 `SKILL.md` 边界（用户保存凭据、200U 测试账户权益校验、`doctor.py advise --auto` 仅用于非红线日常修复） | CLEAN |
| `exp/fix-http-ledger-hygiene` | `5542e2d14` | 修复首个空值重复 `Transfer-Encoding` 绕过（改用 `get_all`）；`live/serve.py` 与 `ledger/replica.py` 统一走 `shared.http.content_length`/`read_body` 并拒绝截断体；`ledger/service.py` 拒绝空 `config["databases"]`；`changelog-release.py` 拦截空 bullet 与未缩进标题 | CLEAN |
| `exp/fix-3782-paper-oom` | `372be24cd` | Round-1 红队直接通过（内存预算公式与 `PAPER_TICK_CAPACITY` 边界无反例） | CLEAN |
| `exp/fix-3783-metrics-checkpoint` | `3fc95ae1a` | 修复 Metrics 与聚合 bar 的时间交错排序、checkpoint JSON 持久化每合约 Metrics 游标、Metrics 回补期不误伤非 MARKET 挂单、`on_data()` 内动态退订处理、`Session.exiting()` 补齐 `_has_backfill()` 守卫（`engine/paper.py` 保持 1244 行） | CLEAN |
| `exp/fix-paper-runtime-guards` | `bfefbb574` | 修复 `OrderRules.close_position()` `WARMING` 拦截、`Session.commanded(close=True)` 准入前置与 `Waiting._wait()` `WARMING` TOCTOU 竞态（`engine/paper.py` 1243 行） | CLEAN |
| `exp/fix-live-stop-compare` | `2e7f28f4d` | 修复 `Observer.observe()` 在 `stop_venue_flat` 与 `native_flat` 分支漏 `return` 导致同 tick 落入 timeout 误判 | CLEAN |
| `exp/fix-replay-capital-lot` | `b1285310c` | 修复多合约/单合约/同时刻/末根 bar MARK 缺口引发的假阳性 `CAPITAL_VALUATION_GAP`（`if next_ts is not None and position.ts_last >= next_ts:`），`repro_3652.py` + `probe_3652_t2.py` + 631 engine 单测全绿（`engine/run.py` 943 行） | CLEAN |
| `exp/fix-line-coverage-veto` | `8141c6d6d` | 统一 `control`/全部区段 `earliest`；显式 `--symbols` 按月取轨道交集；轨道缺失或空集触发 `COVERAGE_INCOMPLETE`；修复 `_whole_year(input_start=None)`、`--symbols=` 等号语法与 0 行 Parquet footer 误算 | CLEAN |
| `exp/fix-registration-judgment-guards` | `423ee14f4` | `last_research_symbols(..., at=...)` 按时刻切片并加 `matches_scope`；逐跳 `_unrelated_retry` 限定已消费可重试 trial 策略（封堵未消费 root grid 偷换）；`_clean_capture` 强制校验 `audit/audit.json` `passed is True`；`add_judgment` 剔除 Unicode `Cf` 零宽字符（`paper/serve.py` 882 行） | CLEAN |
| `exp/feat-3786-soak-fixture` | `0fcbdf345` | `PaperSoakHarness` `try/finally` 关闭 journal（0 `ResourceWarning`）；收紧 OOM 正则与 `enforce_container_cap`；修复 `_open_ws` 粘包帧解析 | CLEAN |
| `exp/doctor-v2-convergence` | `7952aedbc` | 生产事故高优抢占不可被冷却压制（`PROD_INCIDENT_PREFIXES`）；`--auto` 补充 `auto_mode` 与正文/评论全量 `AGENTS.md` 红线过滤（实测 `issues_batch.json` 精准拦截 `[3552, 3524, 3508, 3505]` 4 条红线、放行全部 20 条普通缺陷）；`_inspect_prod_log` 流式 `O(1)` 内存（50 MiB 日志堆峰值 120.6 MiB → 0.0 MiB）；兼容 `docker compose`/`journalctl` 前缀与 `exited with code 137`；shell 转义/子壳/grep 标志加固；`--steady-exit-code` 校验 `0 \| 2..125` | CLEAN |

---

## 二、Phase 2：全栈真环境端到端压测（2A / 2B / 2C）

### 2A：真子进程 6 合约 `engine.live` 环回压测
- **探针**：`/tmp/doctor-rd-sources/phase2_ab/probe_live_6sym_subprocess.py`（`Loopback(symbols=DEFAULT_SYMBOLS, wallet="200")` 启动真实 `python -m engine.live` 子进程）。
- **场景**：6 合约热身 → 3 并发建仓 + 3 笔 Algo STOP 挂单 → `drop_user_streams()` 断流期间触发止损成交并自动重连恢复 → 注入 `external_fill()` 外部成交触发风控对账 → 优雅 `STOP` 退出。
- **实测结果**：退出码 `0`、`venue.errors == []`、`1,494` 次 HTTP 请求中 `>= 400` 错误数为 `0`、子进程 RSS 峰值 **`159.94 MiB`**、总耗时 `260.76s`。

### 2B：真临时 Dolt 2.7.2 多轨道错位研报链 + 三档 `doctor.py cost` 标度探针
- **端到端链路**：真实临时 Dolt 2.7.2 执行 `line select → register → precheck → history_plan → run_history → line_history → close_line` 全部集成守卫通过（耗时 `2.73s`）。
- **三档 `doctor.py cost` 标度基准**：

| 被测路径 | 输入规模（3 档） | 墙钟耗时 | 标度指数 | 内存特征 / 结论 |
|---|---|---|---|---|
| `friction.analyze_prod_logs` | `5 / 15 / 45 MiB` | `0.026 / 0.079 / 0.230s` | `0.99` | 真实 `O(1)` 堆内存（`147.96 KiB`），已达流式线性下界 |
| `CapitalObserver`（多合约常规 bar） | 3 档 bar 数 | 线性增长 | `0.98` | 正常行情接近严格 `O(N)` |
| `engine/report.py:candidates_at`（同 bar 高频撤改 churn） | `1000 / 3000 / 9000` bars | `0.010 / 0.075 / 0.755s` | `1.96` | **记录 P2 观察项**：极端同 bar 撤改下呈二次扫描，不构成线上阻断，留待后续需要时优化 |
| `history_plan` | `90×180` 参与者 | `147ms` | — | **记录 P3 观察项**：按参与者重复建索引，当前量级可接受 |

### 2C：真实无头 Google Chrome（`158.0.8127.37`）IDE 全页与 API 契约盲审
- **覆盖矩阵**：在隔离 `ide/ide.py serve` 上跑完 **44 个真浏览器步骤**，横跨 `empty`、`records`、`offline`/Dolt 宕机、强刷 `reload`、手机窄屏 `390×844` 与窄桌面 `780×844`；全程 `0` JS 未捕获异常、`0` console error、`0` `NaN`/`undefined`，临时服务全部清理退出。
- **发现并修复 4 个 P1（均在独立分支 `exp/fix-ide-audit-findings` 修复并经 361/361 前端单测 + R2 复验通过）**：
  1. `IDE-F1`（Phone `?run=` 强刷丢失）：`stage.ts`/`phone.ts` 保留手机端 `?run=` 深链且不触发跨线重载。
  2. `IDE-F2`（Desktop `localStorage` 劫持深链）：`shell.ts`/`stage.ts` 确保显式 `?run=`/`?trial=`/`?line=`/`?at=` 深链优先于本地持久化页签。
  3. `IDE-F3`（Phone `RunsTab` 离线伪造计数/空态）：离线状态不再显示伪造 0 计数与误导空态文案。
  4. `IDE-F4`（Phone `PaperPage` 封存口径与离线骨架卡死）：使用封存 `run.seal` 真实字段、`paperEquity()` 起始权益并解除离线骨架死锁。

---

## 三、Phase 3：`product-doctor` v3.0 冷区盲审 → 独立反驳 → 修复 → Doctor `self` 演化 → 二轮收敛

### 3.1 独立冷区盲审与反驳结果（5/5 确认 + R2 捕获 1 个收尾 P1，总计 1 P0 + 5 P1）

对 `market/`、`deploy/`、`runtime/`、`cli/`、`live/`、`paper/`、`report/`、`replay/`、`ide/research_graph/`、`ide/overview/`、`ide/agent/`、`shared/` 执行盲审，并由独立反驳子代理（Step 6 `refute`）逐一验证反例与现网路径：**Phase 3A+3B 首批 5 条 5/5 确认为真缺陷（0 误报）**，Phase 3 Round-2 全仓复验额外发现并确认 1 条冷区 P1（`P1-OV1`），**全部 6 条已修复在独立干净分支**：

| 编号 | 级别 | 模块与位置 | 实证根因 | 修复分支与 HEAD |
|---|---|---|---|---|
| `3A-1` | **P0** | `market/files.py`（`_traded_after`, `followed_metrics`）、`market/follow.py`（`_listings`, `_states`） | 退市合约保留在跟踪集合内，导致全局 `latest_day`/`head` 被旧合约冻结长达 60 天 | `exp/fix-audit-market-deploy` (`a45794741`) |
| `3A-2` | **P1** | `deploy/update.py` | Docker `inspect` JSON 中 `RepoTags`/`RepoDigests` 为 `null` 时抛出 `TypeError` 中断发布清理（保持纯 stdlib） | `exp/fix-audit-market-deploy` (`a45794741`) |
| `3A-3` | **P1** | `market/export.py`、`registration/runner.py`、`registration/inputs.py` | 合约 symbol 缺少路径穿越校验，同时需合法放行 Unicode 合约名（如 `币安人生USDT`） | `exp/fix-audit-market-deploy` (`a45794741`) |
| `3B-1` | **P1** | `live/notify.py`（`_active()`） | `minute_results` 键类型 `str` 与 `int` 不匹配，导致平静交易日 Telegram 日报被静默丢弃 | `exp/fix-audit-live-paper` (`de66f6d89`) |
| `3B-2` | **P1** | `paper/serve.py`（`Daemon.seal_found()`）、`paper/runs.py`（`resume()`） | 超过 600s 的 `unsealed` 孤儿进程被错误派发 `resume` 而非 `seal`；缺失 `inputs/*` 时 `resume()` 未捕获 `OSError`（`paper/serve.py` 保持 882 行） | `exp/fix-audit-live-paper` (`de66f6d89`) |
| `P1-OV1` | **P1** | `ide/overview/src/app.ts`（L24–26） | `new URL(request.url ?? "/", "http://overview")` 在 `Host` 校验之前无 `try/catch` 执行，任意跨站 `GET //x:99999/` 抛出未捕获 `ERR_INVALID_URL` 直接打崩整个 `ide/overview` Node.js 进程 | `exp/fix-ide-audit-findings` (`cb2cb307d`) |

### 3.2 `product-doctor` `self` 能力演化（`exp/doctor-v2-convergence` @ `7952aedbc`）
- **新增内存标度量测**：`doctor.py cost` 在零计时污染前提下输出 `peak_rss_mib`、`median_peak_rss_mib`、`peak_heap_kib`、`median_peak_heap_kib` 与 `heap_exponent`，可直接区分 `O(1)` 流式与 `O(N)` 内存泄露。
- **更新审计透镜**：`references/lenses.md` 补强三项高频盲区——`pages`（有状态深链、强刷恢复、Desktop vs Phone 对等性）、`lifecycle`（退市合约 rollover 冻结）、`checks`（序列化线协议类型与 producer/consumer mock 一致性）。
- **资产复杂度与纯 stdlib 守恒**：5 个纯 stdlib 资产最大认知复杂度 `<= 47`（`doctor 32` / `friction 36` / `js_analyzer 40` / `scheduler 47` / `telemetry 27`），53/53 单测全绿。

### 3.3 Phase 3 Round-2 收敛判定
- 独立复验覆盖 `exp/fix-audit-market-deploy`、`exp/fix-audit-live-paper`、`exp/fix-ide-audit-findings`、`exp/doctor-v2-convergence` 以及冷区 `shared/`、`ide/agent/`、`ide/overview/`：除已立即修复并回归验证的 `P1-OV1`（42/42 `ide/overview` 单测 + `tsc` 0 错 + 畸形原包回归返回 `403`/`400`/`200`）外，**0 剩余 P0/P1**，满足收敛停机条件。

---

## 四、证据索引（本地临时目录）
所有复现脚本、无头浏览器记录、子进程压测日志与三档性能探针留存于 `/tmp/doctor-rd-sources/`（`rt_1a/`、`rt_1b/`、`rt_1c/`、`rt2_ab/`、`rt2_c/`、`rt2_reg/`、`phase2_ab/`、`phase2_ide/`、`phase3_a/`、`phase3_b/`、`refute_p3/`、`p3_r2/`），未污染仓库。
