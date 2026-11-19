# Live 页面私有钱包规模回放验证与证据存储规划（2026-11-19）

依据：用户 2026-11-19 在 Live 页面遇到 `Replay evidence: None` 导致 `Check account` 与 `Start live run` 全部置灰，选择“方案 1”（在 Live 页面增加回放验证按钮与私有回放接口，将通过审计的回放证据保存在 `LIVE_ROOT` 私有目录，实现 Web 端闭环操作），并已授权新增存储字段与调整 `LIVE_EVIDENCE_MISSING` / `LIVE_EVIDENCE_BALANCE` 证据来源边界。用户要求先写规划文档，待 Claude 审查后再实施代码。

基线：`origin/main` `657331a98`。新增存储字段与检查边界已通过独立子代理审查（见第 3 节）。

---

## 1. 问题根因与现状死锁

当前 Live 启动页（`ide/web/src/model/liveLaunch.ts`、`live/runs.py`、`engine/live_venue.py`）设置了两道回放证据门槛，且全部只从**公开研究账本（Research Ledger）**读取：

1. **第一道门槛（`① Strategy` 栏 `Replay evidence`，拒绝码 `LIVE_EVIDENCE_MISSING`）**：
   - `live/runs.py:_evidence` 在 `research_at` 查询公开研究账本的 `trial` 表，要求该候选（`source_sha256`）在完全相同的合约集合（`symbols`）、`bars` 环境下，存在已通过的封存运行（`status == 'passed'`）或已有研究窗口内通过审计的探索回放（`purpose == 'explore'`）；
   - **同时要求**该回放镜像的 `--describe` 回放闭包指纹 `REPLAY_CODE`（`source_files_sha256`、`audit_source_sha256`、`dependency_lock_sha256`）与当前 Live 执行镜像 `config.runtime` 完全相等。
   - **为什么已通过研究回测的策略在页面上变成 `Replay evidence: None`**：
     - 每次发版（如 `v0.4.1`、`v0.4.2`、`v0.4.3`）都会更新 `uv.lock` 中的项目版本号，而镜像将 `uv.lock` 原始字节哈希进 `dependency_lock_sha256`（`engine/config.py`）。因此**每次发版都会改变执行镜像的 `REPLAY_CODE`**，导致发版前在账本中跑过的所有研究回测在发版后全部失配；
     - 用户在 Live 页面上修改 `Contracts`（例如只选子集）时，账本中也没有该合约组合的 `trial`。
2. **第二道门槛（`② Account` 栏 `Replay at wallet`，拒绝码 `LIVE_EVIDENCE_BALANCE`）**：
   - `engine/live.py:start` 在 `preflight`（`Check account`）与 `run`（`Start live run`）两个模式下都会调用 `engine/live_venue.py:require_evidence`，要求 `manifest["evidence"]` 中至少有一条回放的 `starting_balance_usdt` 在币安合约账户实测 USDT 钱包余额的 `±10%`（`EVIDENCE_TOLERANCE`）以内；
   - 研究回测（`replay run`）固定使用标准账户 `100,000 USDT`（`engine/config.py:ACCOUNT_CONTRACT`），而首轮实盘试验限制 `Cash floor = 钱包 × 85% ≤ 100 USDT`（即钱包余额最多约 `117.64 USDT`）。研究阶段产出的 `100,000 USDT` 回测永远无法满足小资金实盘钱包的 `±10%` 校验。
3. **为什么用户在 Web IDE 上无法闭环操作（三处架构冲突）**：
   - **无触发接口与按钮**：Web 端只有只读查询 `GET /api/live/candidates/<id>/<rev>/evidence/<symbols>`，没有任何触发回放的按钮或 POST 接口；
   - **远程主机账本只读且不应写入私人余额**：线上部署（`deploy/remote/README.md`）的研究账本是只读镜像（`ledger mirror`），Web、Agent、Paper 与 Live 服务均只有 `reader` 权限，无法从 Web 往研究账本写 `trial`；且 `AGENTS.md` 明确规定实盘执行记录与私人账户事实绝不进公开研究账本或 DoltHub；
   - **页面交互先后死锁**：
     - 在点击 `Check account` 之前，页面尚未读取币安账户，根本不知道用户的 `Futures wallet` 余额；
     - 但 `checkBlocker`（`liveLaunch.ts:194`）和 `prepare_locked`（`live/runs.py:504`）在 `Replay evidence` 缺失时直接禁止点击 `Check account`；
     - 且 `engine/live.py` 在 `preflight`（`Check account`）首次运行时就会调用 `bind_manifest` 固化 `out/manifest.json` 并调用 `require_evidence` 校验钱包余额 `±10%`——这意味着**在 `prepare_locked` 写出 `inputs/manifest.json` 之前，匹配真实钱包余额与当前执行镜像的回放证据必须已经就绪**。

---

## 2. 目标与边界

1. **Web 页面一键闭环**：用户在 Live 页面选定候选策略、合约与杠杆并保存币安期货 API Key 后，可直接在页面上点击按钮完成针对当前真实钱包余额与当前执行镜像的原生回放 + 独立审计验证，无需退回工作站命令行跑 `replay explore`。
2. **原生回放与审计标准不放宽**：
   - 回放仍在当前受托执行镜像 `config.runtime` 中通过 `replay.entry.replay_unrecorded` 执行原生 `engine.run` 与独立审计 `engine.audit`，要求 `audit_problems` 为空（`status == "passed"`）；
   - `LIVE_EVIDENCE_MISSING` 仍要求匹配的 `source_sha256`、`symbols` 与 `REPLAY_CODE`；
   - `LIVE_EVIDENCE_BALANCE` 仍要求回放起始资金在实测 USDT 钱包余额的 `±10%` 以内。
3. **私有边界与运行时兼容**：
   - 钱包回放证据只写进 `LIVE_ROOT/evidence/` 私有目录，绝不写研究账本、Paper 库、DoltHub 或 Git；
   - 投影到 `manifest["evidence"]` 时复用现有结构 `{"trial_id": 0, "starting_balance_usdt": ..., "image_ref": ...}`，**不修改 `engine/` 下的任何文件，不改 `MANIFEST_FORMAT = "live-run-4"`，不触发 `trade-runtime` 镜像重建**。

---

## 3. 存储字段独立审查记录（按 `AGENTS.md` 规定）

独立子代理对 `LIVE_ROOT` 新增持久化记录进行了审查，结论如下：

### 3.1 为什么现有存储不能表达

1. **公开研究账本 (`trial` 表)**：
   - 远程主机上的研究账本是 `ledger mirror` 只读副本，Live 控制进程只有 `research_ledger`（`reader` 账号），无写入权限；
   - 钱包规模回放的参数包含用户私人币安账户的 USDT 余额，按 `AGENTS.md`（“Execution records are not research data: the remote host's `paper` database and Live's private root never reach the ledger, DoltHub or Git”）不得写入公开研究账本。
2. **已准备运行的清单 (`LIVE_ROOT/runs/<run_id>/inputs/manifest.json`)**：
   - `prepare_locked` 在写出 `manifest.json` 之前即检查 `_evidence` 并拒绝 `LIVE_EVIDENCE_MISSING`；
   - 页面在准备任何 `run_id` 之前即通过 `GET /api/live/candidates/<id>/<rev>/evidence/<symbols>` 展示回放证据状态；
   - 用户调整回撤刹车（`drawdown_brake`）或运行时长（`duration_seconds`）会准备新的 `run_id`，同一 `(source_sha256, symbols, image_ref, starting_balance_usdt)` 的回放证据不应绑死在单个未启动的 `run_id` 上重复重跑。

### 3.2 `LIVE_ROOT/evidence/<sha256>.json` 字段审查表

文件位于 `LIVE_ROOT/evidence/<sha256>.json`（目录权限 `0700`，文件权限 `0600`，按内容寻址：`<sha256>` 为规范化 JSON 内容的 SHA-256，先写同目录隐藏临时文件 `.<sha256>.<hex>`，`fsync` 后 `os.replace` 原子落盘并 `fsync_parent`，读取时拒绝符号链接或非 `0600` 普通文件）。

除固定格式标识 `"format": "live-evidence-v1"` 外，只存以下 **4 个业务字段**（不存时间戳、窗口或收益指标等无消费方的派生值）：

| 存储字段 | 类型与格式 | 消费方 | 独立事实 | 为什么现有字段、关联或派生无法表达 |
|---|---|---|---|---|
| `source_sha256` | 64 位小写十六进制字符串 | `live/runs.py:_evidence`、`replay_evidence` | 通过原生回放与独立审计的确切策略源码字节 SHA-256 | 候选引用（`strategy_id@revision`）随账本提交解析，回放性质属于不可变的源码字节本身 |
| `symbols` | 非空有序去重列表（如 `["BTCUSDT", "ETHUSDT"]`） | `live/runs.py:_evidence`、`replay_evidence` | 在同一共享保证金账户下一并回放通过的币安 USD-M 合约集合 | 多合约策略在共享账户下共同占用权益与保证金，单合约回放或候选元数据不能推出哪组尺度的合约组合通过了联合回放 |
| `image_ref` | 带不可变摘要的镜像引用（`<name>@sha256:<64 hex>`） | `live/runs.py:_evidence`（调用 `same_code(image_ref)`）、`engine/live.py:read_manifest`、`live/runs.py:review` | 执行该次原生回放与独立审计的固定 OCI 镜像摘要 | 执行镜像随发版演进；保存 `image_ref` 后，`_evidence` 可用现有的 `image.inspect_runtime` 比对其 `REPLAY_CODE` 是否与当前执行镜像一致，且无需再冗余存储 3 个 `REPLAY_CODE` 哈希字段 |
| `starting_balance_usdt` | 规范化正十进制文本（如 `"100"`、`"98.52"`） | `live/runs.py:_evidence`、`engine/live_venue.py:require_evidence`、`ide/web/src/model/liveLaunch.ts` | 该次原生回放与独立审计通过时的账户起始 USDT 资金 | 策略按权益比例下单时，最小下单量（`min_qty`/`min_notional`）与步长截断行为取决于起始资金规模，源码与市场数据本身不包含所测钱包余额 |

**向 `manifest["evidence"]` 的投影**：
当 `live/runs.py:_evidence` 读到匹配的 `live-evidence-v1` 记录时，返回：
```json
{"trial_id": 0, "starting_balance_usdt": "<starting_balance_usdt>", "image_ref": "<image_ref>"}
```
- `engine/live.py:read_manifest`（第 94–96 行）只校验 `type(item["trial_id"]) is int`、`Decimal(item["starting_balance_usdt"]).is_finite()` 及 `image_ref` 包含 `@sha256:<64 hex>`；
- `engine/live_venue.py:require_evidence` 只比较 `starting_balance_usdt` 与实测钱包余额的 `10%` 容差；
- `ide/web/src/model/liveLaunch.ts` 只读取 `starting_balance_usdt`；
- 因此 `trial_id: 0` 与现有执行镜像、清单格式 `live-run-4` 及前端 DTO 100% 兼容。

---

## 4. 回放执行机制设计（`live/evidence.py`）

参照 `live/daily.py`（《连续运行第 7b 步：控制每天自动对照》）已验证的容器、内存与锁边界，新增模块 `live/evidence.py`（注意与 `engine/live_evidence.py` 区分）：

### 4.1 钱包余额读取与前置校验

触发回放验证时，无需用户手填余额，直接读取当前选中 API Key 对应的币安合约钱包余额：

1. **读取选中凭证**：
   - 在 `state.reading(config.root)` 下读取 `credentials.events_locked(root)` 中当前 `selected` 且未 `removed` 的凭证文件 `path`（若未保存或不可用，拒绝 `LIVE_CREDENTIAL_UNAVAILABLE`）；
2. **只读查询币安期货账户 USDT 钱包余额**：
   - Live 控制容器位于 `backend` 网络（与 `live/key.py` 相同，可直连币安 REST）；
   - 调用 `BinanceReadOnly(read_credentials(path)).get("/fapi/v2/account")`，提取 `assets` 中 `asset == "USDT"` 的 `walletBalance` 与 `availableBalance`；
   - 校验：
     - `wallet > 0` 且有限，否则拒绝 `LIVE_FUNDS`；
     - 计算 `budget = floor(wallet * 85) / 100`（与 `engine/live_brake.py:cash_floor` 一致），若 `budget <= 0` 或 `budget > 100` 拒绝 `LIVE_BUDGET`，若 `min(wallet, available) < budget` 拒绝 `LIVE_FUNDS`（在耗时回放开始前就把不符合首轮实盘资金要求的账户直接告知用户）；
   - 规范化 `starting_balance_usdt = format(wallet.normalize(), "f")`。
3. **幂等短路**：
   - 若当前 `_evidence` 中已存在匹配 `(source_sha256, set(symbols), REPLAY_CODE)` 且 `starting_balance_usdt` 在该实测 `wallet` 的 `±10%`（`EVIDENCE_TOLERANCE`）以内的记录，无需重跑回放，直接返回已有证据并刷新 `control.Evidence` 缓存。

### 4.2 回放窗口与预热起点选择（兼容远程主机与工作站）

远程主机（`trade-sgp-01`）的 `config.market_root` 只按 `TRADE_MARKET_ARGS` 导入近期月份（不存 2021–2024 历史），因此回放窗口必须从 `config.market_root` 当前持有的最新市场日派生，而不依赖研究账本中 2021–2024 的 `trial` 窗口：

1. **最新市场日与交易窗口 `[trade_start, end)`**：
   - 打开只读市场目录 `opened = files.open_market({"root": str(config.market_root)}, "reader")`，解析最新市场日 `market_day = files.resolve_day(opened, None)`；
   - 先校验 `symbols` 在最新市场日均有合约条款（`runs._market_terms`）且当月有 `universe` 成员资格（`control._universe`），不满足则立即拒绝 `LIVE_MARKET_TERMS` 或 `LIVE_UNIVERSE`；
   - 取 `end = files.day_end("bar", market_day) * 1_000_000`（即 `market_day` 结束的 UTC 次日 `00:00:00Z`，纳秒，落在 1 分钟网格上）；
   - 取交易时长 `TRADING_DAYS = 1`（`trade_start = end - 86_400 * 10**9`，即最新完整市场日一整天 `1440` 分钟，既能快速在 15–30 秒内完成，又完整覆盖日内所有结算时点与分钟 K 线）。
2. **按源码 `WARMUP` 声明计算导出起点 `--start`**：
   - 从候选源码字节中用 `ast.parse`（或加载策略类属性）读取 `entry_class` 的 `WARMUP` 字典（若未声明则为空字典 `{}`），用 `engine.warmup` 的规则计算所需前置分钟与资金费跨度：
     - `1-DAY` 周期由 `market.export.daily_bars` 从 `0` 导出所有在 `end` 之前的完整日线，不需要拉长分钟导出起点 `--start`；
     - 对所有非 `1-DAY` 的 K 线周期 `P`（`count > 0`）：所需最早开盘时刻为 `bucket_start(trade_start, P) - count * period_ns(P)`；
     - 对 `FUNDING: n`（`n > 0`）：币安最宽资金费间隔为 8 小时，取 `trade_start - (n + 1) * 8 * 3600 * 10**9`；
   - `start = min([trade_start, *上述各周期起点])`；
   - 检查每个 `symbol` 在 `config.market_root` 中 `[start, end)` 的 1 分钟 `LAST` K 线覆盖（与 `replay/comparison.py:archive` 相同）：若某合约的已存 K 线未覆盖到 `end - 1 min` 或晚于所需预热起点，拒绝并提示市场目录尚未覆盖该时段。
3. **调用 `replay.entry.replay_unrecorded`**：
   - 参数：
     ```python
     argv = [
         "--symbols", *symbols,
         "--start", utc_text(start),
         "--trade-start", utc_text(trade_start),
         "--end", utc_text(end),
         "--execution", "bars",
         "--leverage", str(leverage),
         "--starting-balance", starting_balance_usdt,
     ]
     membership_end = month_end_ns(end - 1)
     ```
   - 与 `replay/comparison.py:979-983` 一致：若首次运行在 `runtime_errors.jsonl` 中报告 `METRICS_NOT_SERVED`（说明该候选订阅了 `metrics`），自动追加 `"--metrics"` 重跑一次；
   - 检查返回结果：若 `replayed["status"] != "passed"` 或 `replayed["problems"]` 非空，拒绝 `LIVE_EVIDENCE_MISSING`（并将第一个 problem 的 code 记录在状态中供页面显示）；
   - 通过后，将 `{"format": "live-evidence-v1", "source_sha256": source_sha256, "symbols": list(symbols), "image_ref": identity["image_ref"], "starting_balance_usdt": starting_balance_usdt}` 原子写入 `LIVE_ROOT/evidence/<sha256>.json`。

### 4.3 兄弟容器、内存上限、`TMPDIR` 与锁边界

与 `live/daily.py` 完全一致，遵守以下 4 条硬约束：

1. **绝不在回放期间持有 `account.lock`**：
   - 回放使用独立的 `LIVE_ROOT/evidence.lock`（非阻塞 `flock(LOCK_EX | LOCK_NB)`）；若已被占用，说明当前已有回放验证在运行，直接返回 `running` 状态；
   - `STOP`、`maintain`、`release-inspect` 等需要 `account.lock` 的操作在回放期间完全不受阻塞。
2. **工作目录与 `TMPDIR` 必须位于宿主同路径挂载的 `<LIVE_ROOT>/compare-tmp/` 下**：
   - `replay.entry.replay_unrecorded` 通过宿主 Docker daemon 启动 `native` 与 `audit` 阶段容器，挂载导出目录与工作目录；
   - 控制容器的 `/tmp` 是容器私有 `tmpfs`，宿主 Docker 无法挂载；而 `LIVE_ROOT` 在宿主与控制容器内同路径挂载（`/var/lib/trade-release/live-root`）；
   - 因此在 `<LIVE_ROOT>/compare-tmp/` 下创建 `evidence-<hex>/`，设为 `TMPDIR` 并重置 `tempfile.tempdir = None`，校验 `Path(tempfile.gettempdir()).resolve() == attempt.resolve()`，结束后在 `finally` 中 `shutil.rmtree(attempt, ignore_errors=True)`。
3. **在 2 GiB 兄弟容器中执行（避免撑爆 768 MiB 控制容器）**：
   - 控制容器只有 `768 MiB` 内存，而 `replay_unrecorded` 导出 Catalog 时会启动 `pyarrow` / `nautilus_trader` 子进程；
   - 当控制运行在容器内（`Path("/.dockerenv").exists()` 且 `HOSTNAME` 存在）时，复用 `live/daily.py:launch_argv` 的方式：`docker inspect` 自身容器，以 `--volumes-from`、相同用户/权限/网络、`--memory 2g --memory-swap 2g --cpus 1 --rm` 启动兄弟容器 `trade-live-evidence-<hex>`，运行新增的内部 CLI 动词：
     ```bash
     python -m cli.main live replay-evidence --configuration <config_file> \
       --candidate <strategy_id@rev> --symbols <SYM,SYM> --leverage <leverage>
     ```
   - 当不在容器内（本地开发与单元测试）时，直接在当前进程内持 `evidence.lock` 执行。
4. **超时与残留清理**：
   - 获得 `evidence.lock` 后，先清理已退出的 `trade-live-evidence-*` 阶段容器及 `compare-tmp/evidence-*` 残留目录；
   - `replay_unrecorded` 传入 `timeout=1800`（30 分钟），超时自动 `docker stop` 阶段容器。

---

## 5. 控制接口与页面交互设计

### 5.1 Live 控制接口（`live/serve.py`、`live/control.py`、`cli/live_commands.py`）

1. **只读查询接口（已有路径，扩展状态字段）**：
   - `GET /api/live/candidates/<id>/<rev>/evidence/<SYM,SYM>`
   - 返回：`{"state": "found" | "missing" | "checking" | "running" | "unknown", "replays": [{"trial_id": int, "starting_balance_usdt": str}], "tolerance": "0.1", "research_at": str, "error": str | None}`
   - 当 `LIVE_ROOT/evidence/status.json`（或内存/锁状态）显示该 `(source_sha256, symbols)` 正在运行回放（且 `evidence.lock` 被持有）时，`state` 返回 `"running"`；
   - 当回放落盘到 `LIVE_ROOT/evidence/<sha256>.json` 后，`control.Evidence` 重新读取 `runs.replay_evidence(research, research_at, source_sha256, symbols, config.runtime, root=config.root)`，返回 `state: "found"` 及包含新余额的 `replays`。
2. **触发回放接口（新增 POST 动作）**：
   - 路由：`POST /api/live/evidence`（映射到 `live web-command --action evidence_replay`）
   - 请求体：`{"candidate": "<id>@<rev>", "symbols": ["BTCUSDT", ...], "leverage": "3"}`
   - 方式：与 `notify.ACTIONS`（`live/control.py:392`）一致，它不改动真实账户持仓/订单、不占用账户槽位（`account.jsonl`），因此不进 `requests/` 请求日志、不持 `account.lock` 跑长任务：
     1. 短暂检查 `authority.retained(config, binding).admit_locked(config.root, inventory=False)`（发布切换期间不接新任务）；
     2. 校验 `candidate` 在研究账本头部可加载（`runs.runnable`）、`symbols` 合法且在最新市场日有 `universe` 成员资格、`leverage` 合法（`1..125`）；
     3. 读取当前选中的 API Key 并通过 `BinanceReadOnly` 读取币安合约账户的 USDT `walletBalance`、校验 `Cash floor <= 100 USDT`；
     4. 启动后台回放（容器环境下异步拉起 `trade-live-evidence-<hex>` 兄弟容器并记录 `status.json` 为 `running`，同时将 `control.Evidence` 中对应 key 标记为待刷新；立即返回 `202 {"ok": True, "data": {"state": "running", "starting_balance_usdt": starting_balance_usdt}}`）。

### 5.2 `live/runs.py` 证据合并逻辑

- `runs._evidence(research, research_at, source_sha256, symbols, inspection, runner_args, root: Path | None = None)`：
  1. 保留原有研究账本 `trial` 表查询逻辑；
  2. 若传入 `root`（`config.root`）且 `(root / "evidence").is_dir()`：
     - 遍历 `(root / "evidence").glob("*.json")`（跳过隐藏文件，若遇到符号链接或非 `0600` 普通文件则忽略或报错）；
     - 过滤 `row.get("format") == "live-evidence-v1"`、`row.get("source_sha256") == source_sha256`、`set(row.get("symbols") or ()) == set(symbols)`；
     - 对 `row["image_ref"]` 调同一个 `same_code(row["image_ref"])` 检查其 `REPLAY_CODE` 是否与当前执行镜像 `inspection` 一致；
     - 匹配的记录追加 `{"trial_id": 0, "starting_balance_usdt": format(Decimal(row["starting_balance_usdt"]).normalize(), "f"), "image_ref": row["image_ref"]}`。
- `runs.replay_evidence` 与 `runs.prepare_locked` 均传入 `root=config.root`（或 `prepare_locked` 的 `root` 参数），保证页面预读（`read_ahead`）与准备运行（`prepare_locked`）看到完全一致的证据列表。

### 5.3 Web 页面交互（`ide/web/src/model/liveLaunch.ts`、`ide/web/src/widgets/live/LiveLaunch.tsx`）

1. **三栏底部按钮对齐**：
   - 目前第二栏（`② Account`）底部有 **`Check account`** 与 **`Manage keys…`**，第三栏（`③ Limits & start`）底部有 **`Start live run`**，第一栏（`① Strategy`）底部为空；
   - 在第一栏（`① Strategy`）底部新增 **`Replay at wallet`** 按钮（当已有回放但不在 `checked.venue.wallet` 的 `±10%` 内时，按钮文案显示 **`Replay at wallet`**；正在回放时显示 **`Replaying…`** 并置灰）。
2. **按钮可用条件与提示（`replayBlocker`）**：
   - 需要：Live 服务可用、已选中合法候选（`source.read === "found"`）、`Contracts` 合法、`Leverage` 合法、已在 Settings 中保存并选中 API Key（用于读取币安钱包余额）、且当前没有正在运行的回放（`evidence.state !== "running"`）；
   - 若尚未保存 API Key，按钮置灰并在下方提示：`Save an API key in Settings first.`
3. **状态流转与自动轮询**：
   - 用户点击 **`Replay at wallet`** → 调用 `POST /api/live/evidence`；
   - `useLiveEvidence`（`ide/web/src/state/liveRun.ts:85`）在 `read.state === "checking" || read.state === "running"` 时每 `3000 ms` 自动轮询 `GET /api/live/candidates/<id>/<rev>/evidence/<symbols>`；
   - 回放进行中：`Replay evidence` 行显示 `wait` 状态（`"Replaying"`，提示 `"Replaying this candidate on these contracts at your wallet's balance on the execution image."`）；
   - 回放通过后：`Replay evidence` 行自动变为绿色 `pass`（`1 replay · at <wallet> USDT`），第二栏的 **`Check account`** 立即解锁；
   - 用户点击 **`Check account`**：`prepare` 与 `preflight` 自动采纳该条与钱包余额一致的回放证据，第二栏 `Account check` 与 `Replay at wallet` 全部变绿，第三栏 **`Start live run`** 亮起。

---

## 6. 拒绝检查变化与不变项对照

| 检查项 / 拒绝码 | 当前行为 | 本规划修改后行为 |
|---|---|---|
| `LIVE_EVIDENCE_MISSING` | 只查公开研究账本的 `trial` 表；无匹配当前执行镜像 `REPLAY_CODE` 和 `symbols` 的记录即拒绝 | 查公开研究账本 `trial` 表 **并** 查 `LIVE_ROOT/evidence/*.json`；私有记录同样必须由 `replay_unrecorded` 通过原生回放与独立审计（`audit_problems == []`）且匹配 `source_sha256`、`symbols`、`REPLAY_CODE` |
| `LIVE_EVIDENCE_BALANCE` | `engine/live_venue.py:require_evidence` 要求 `manifest["evidence"]` 中有起始资金在实测 USDT 钱包 `±10%` 内的记录 | **不变**（`Replay at wallet` 直接按实测币安 USDT 钱包余额跑回放，产出的记录天然落在 `0%` 偏差内） |
| 原生审计 `engine.audit` | 任何 runtime error、拒绝单、未保护持仓、越界入场或计数不符均判定 `invalid` | **不变**（私有回放调用同一个 `replay.entry.replay_unrecorded` 与 `audit_problems`） |
| 运行时契约、`require_main_build`、市场条款、仅 USDT 合约、账户模式与杠杆核对、85% Cash floor ≤ 100 USDT | 准备与 `preflight` / `run` 逐项强制检查 | **全部不变** |

---

## 7. 涉及文件与验证清单（供审查通过后实施）

### 7.1 拟改动文件

1. `live/evidence.py`（新增）：私有证据文件读写（`live-evidence-v1`）、币安钱包余额只读获取与预算前置校验、基于 `WARMUP` 与 `market_root` 最新市场日的回放窗口计算、`evidence.lock` 与兄弟容器/进程内 `replay_unrecorded` 执行。
2. `live/runs.py`：`_evidence`、`replay_evidence`、`prepare_locked` 增加 `root: Path | None = None` 参数，合并 `live/evidence.py` 读取的私有证据。
3. `live/control.py`、`live/serve.py`、`cli/live_commands.py`：
   - `GET /api/live/candidates/<id>/<rev>/evidence/<symbols>` 支持返回 `state: "running"` 及失败原因；
   - `POST /api/live/evidence`（`web-command --action evidence_replay`）与内部容器命令 `live replay-evidence`。
4. `ide/web/src/lib/liveTradingDto.ts`、`ide/web/src/model/liveTrading.ts`、`ide/web/src/model/liveTradingMap.ts`、`ide/web/src/state/liveRun.ts`、`ide/web/src/state/liveTrading.ts`、`ide/web/src/model/liveLaunch.ts`、`ide/web/src/widgets/live/LiveLaunch.tsx`：
   - 支持 `"running"` 证据状态与 `error` 展示；
   - 第一栏底部增加 **`Replay at wallet`** 按钮及 `replayAtWallet` 动作绑定。

### 7.2 单元测试与前端测试计划

1. `tests/live/test_replay_evidence.py`：
   - 账本无匹配回放时，`LIVE_ROOT/evidence/` 下的 `live-evidence-v1` 记录（匹配 `source_sha256`、`symbols`、`REPLAY_CODE`）可通过 `prepare_locked` 与 `require_evidence`；
   - `source_sha256` 不同、`symbols` 不同、`REPLAY_CODE` 不同、或损坏/符号链接的证据文件被拒绝（仍报 `LIVE_EVIDENCE_MISSING`）；
   - 钱包回放执行流程：根据候选 `WARMUP` 计算 `--start`、遇到 `METRICS_NOT_SERVED` 自动带 `--metrics` 重试、审计失败时不写证据文件并报错、审计通过时原子写入 `0600` 证据文件；
   - 钱包余额前置校验（`budget > 100` 拒 `LIVE_BUDGET`，可用余额不足拒 `LIVE_FUNDS`）；
   - `evidence.lock` 被占用时返回 `running`，不阻塞 `account.lock`。
2. `tests/live/test_web_control.py`：
   - `POST /api/live/evidence` 路由、权限与释放屏障（`LIVE_RELEASE_UNAVAILABLE`）校验。
3. `ide/web/scripts/liveLaunch.test.mjs`：
   - `Replay evidence` 在 `missing`、`running`、`found` 状态下的行展示、`Replay at wallet` 按钮可用条件与提示文案。
