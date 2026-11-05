# 2026-11-05 Python 消费者链路：函数、文件、模块、功能

用户要求检查所有 `.py` 文件，沿“函数 → 文件 → 模块 → 功能”找冗余函数、字段和无消费者的功能，并执行微重构和清理。本记录审产品，不审研究会话。同日的[冗余审计](2026-11-05-redundancy-audit.zh.md)已清掉大部分，这次只记它之后还在的。编号跳过 -39 至 -50，开着的 [#2172](https://github.com/qOeOp/trade/pull/2172) 已占用。

| Item | Value |
|---|---|
| Sessions | 无研究会话。转录只用来数命令实际执行次数（`~/.codex/sessions`、`~/.claude/projects/-Users-vx-WebstormProjects-trade`） |
| Audit session | Claude Code desktop，claude-opus-5-5，会话 `6070a404-c0c4-4c12-ad31-977340199f28`，worktree `py-consumer-cleanup`。没有派子代理。本会话写了修复 PR，所以不是独立审计 |
| Checkout / ledger | 分析在 main `671b9a8ee`，改动变基到 `488440e8d`（已含 #2164）后复核。活动账本只读（`line list` 数 `runs_behind_image`，`candidate export` 取回放用的源码，都为算 -53 镜像部分的代价）；成对回放写临时账本 |
| Coverage | 工作流 Product contracts and delivery 的 Mechanisms 与 Residue。全部受版本管理的 191 个 `.py`，约 50,000 行。方法：按模块解析导入的函数级引用图，从真实入口（`cli.main`、`engine.*` 的 `main`、`ide`、`replay.entry`）算可达；方法与 dataclass 字段按属性读取数；可选参数、恒定实参、未读返回值按调用点；函数体结构哈希找重复；CLI 命令和标志对 skill、评测、部署、IDE、文档、转录；`ledger/schema.sql` 列对代码文本；`ruff --select F,ARG,ERA,PIE,SIM,RUF100` 宽规则。**缺口**：属性读取是按名字全局数的，同名属性会让字段或方法漏判；调用点分析只覆盖名字唯一的函数；报告 JSON 键是给 Agent 读的输出，只抽查，没有逐键判定；账本列只查文本出现，没区分只写不读 |
| Cost | 研究：无研究会话；产品造成的无效试验 0。审计自身 token unknown |
| Net change | #2181：产品 Python +123 −326，测试 +39 −131，`ide/web` +1 −10；拒绝码 253 → 249（-10 的 4 个）；skill 词数 27,523，未动。删 1 个文件（`report/reproduce.py`）、1 个空包层（`renderers/web`）、1 个存储外的 profile 字段（`holds`）、1 个 `connect` 分支；加 2 个共用函数（`db.has_table`、`metrics.moment_ns`），各替掉 2 份复制。没有新增机制。镜像部分 #2182：+10 −18，已合并 |

## Findings

每项都用 AST 和 `git grep` 复核到调用点。这一批没有研究会话证据，代价 `none` 指没有观察到损失。

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261105-12 | **无消费者的名字**（本次收尾）。除 `engine/config.py` 的 `account_contract` 由 #2164 删外全部处理：`DAY_NS`、`READINGS_SECONDS`、`GROUPS`、`OPTIONAL`、`_install_key`、`replay.entry.summary_problems`、`report.attribution.attribution`（连带 `compare(part=)`）、`Hub.resolve(line)`、`TRADE_IDE_BUILD`、`meeting_targets`、`priceText`、`returnOf`、`AgentInput`；`registration.validate` 是 `_validate` 的包装，包装删掉，`_validate` 改名 `validate` | 引用图：产品入口不可达。`report/review.py` 的 `FINDINGS`、`engine/config.py` 的 `INTEGRITY_CODES` 按上两份记录留 | remove | none | 见索引 |
| 20261105-51 | **只有测试调用或没人读结果的小件**：`refusal_catalogue`（产品直接读 `CATALOGUE`）；`runtime_identity_fields(identity)` 不用参数；`directory_report` 接缝没有替身，只是转一次；`_sync_backup`、`check_name`、`_note`、`ingest_capture_refusal` 的返回值所有产品调用都丢弃；`ide/research_graph/renderers/web/render.py` 在 #2165 删掉 `--renderer` 后只剩一个实现，两层空包；23 处 `noqa` 指的规则没启用（4 处带说明的改成普通注释） | 调用点扫描；`ruff --extend-select RUF100` 处理后只剩下面 -53 的 3 处 | remove | none | 见索引 |
| 20261105-52 | **逐字复制的函数**：`_birth_commit` 与 `_registration_commit`（同一条 SQL）、`replay/entry.py` 的 `_regular`（-22 合并时漏的）、`replay/reproduce.py` 与 `report/measures.py` 的 `_ns`、`ledger/paper.py` 与 `ledger/targets.py` 的 `held` | 函数体结构哈希相同，人工比过语义。`report/attribution.py` 的 `_ns` 多收整数，`report/review.py` 的走字符串，不同义，留 | remove | none | 见索引 |
| 20261105-53 | **动了就换导出器哈希或镜像摘要的冗余**。导出器：`files.months_through(table)` 恒为 `"bar"`，`sources.daily_archives` 的 `interval` 恒为 `"1m"`、`workers` 无人传，`export.write_quotes(chunk)` 只有测试传，`market/store.py` 的多余 `noqa`。镜像：`engine/config.py` 的 `parse_window(execution_bar_minutes)` 无产品调用方传，`engine/audit.py`、`engine/paper.py` 的多余 `noqa` | `market/export.py` 的 `EXPORTER_FILES` 含前者；改了导出缓存失效，每个窗口重导一次（39–151 MB），`exporter_sha256` 不进身份比较。`engine/` 改动换镜像摘要，开着的线已通过的运行进 `runs_behind_image`，要逐个重现 | remove，用户决定不留到下次。导出器部分在 #2181。镜像部分单开 #2182，摘要的代价和成对回放结果写在该 PR，用户看过后决定合并，已合入 | none | 见索引 |
| 20261105-54 | **`Reports.coverage` 只写不读**：`ledger/metrics.py` 解析覆盖回执放进字段，产品没有 `.coverage` 读取。解析本身会对坏文件拒绝，删字段等于去掉这条路径 | `rg '\.coverage\b'` 产品 0 处。封存时 `ledger/execution.py` 的 `_require_coverage`（`COVERAGE_MISMATCH`）和 `metrics.load_run` 对存储回执的身份核对（`EXECUTION_IDENTITY`）仍在，未封存目录里的这个文件没有读者 | authority，然后 remove | none | 见索引 |

已有未结项本次复核仍成立，并按用户授权处理：20261105-10（`report/reproduce.py` 的 `compare_runs` 未接入，连带 `registration/comparability.py` 的 `input_keys` 和 4 个拒绝码）、20261105-11（`LedgerProfile.holds`，连带 `connect` 里的 `LEDGER_KIND` 分支；`cli/main.py` 仍用这个码拒绝不是市场的 profile，文案相应改了）。

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| `compare_runs` 与 4 个拒绝码 | 一对运行的对比 | `engine.compare_reports`、`report.compare` | 从未接入 | 已删（-10） |
| `LedgerProfile.holds` | 把市场 profile 当账本 | 市场 profile 没有 `database`，`from_json` 跳过它，`ledger sql` 得 `LEDGER_UNKNOWN`（按代码推的，没实际跑）；`cli/main.py` 查市场这一侧 | 今天的 profile 走不到 | 已删（-11） |
| `Reports.coverage` | 无（字段没人读）；解析顺带拦坏文件 | 封存时 `_require_coverage`、`metrics.load_run` 的身份核对 | 只有构造 | 已删（-54） |

### 查过，不动

- CLI 命令和标志：47 个命令都有 skill、部署、IDE、文档或转录中的消费者。Codex 转录里没执行过的 `ledger witness`、`execution recover`、`paper delete`、`line targets` 是恢复路径、用户操作或由 skill 指引，没走到不等于可删。只出现在 `--help` 的 `--retry-of`、`--failure-receipt`、`--supersedes` 同理。
- 接缝：其余 16 个字段，测试里都传过同名参数（按关键字数的，没有逐个确认是替身）。`use` 只有 `report/graph.py` 在产品里调用，其他是测试入口，三份各自绑模块的 `current`，合不了。
- `review_all(tables, trial_ids)`、`sync_witness(tsa_roots)`、`validation_register(tsa_roots)`：只有测试传。前者删了要动 `INVALID_NAME` 分支，后两者是测试注入信任根，留。
- `plan_metrics` 返回值产品丢弃，但测试断言它，且函数主体是审计检查。留。
- `engine/audit.py` 的 `forbidden(intervals=intervals)`：默认参数绑循环变量，不是冗余。`parse_window(execution_bar_minutes)` 见 -53。磁盘上的 profile 文件留着旧键 `holds`、`research_branch`，`from_json` 不读，无害，没有动。
- `cli/main.py` 里 3–4 行的命令函数（`ledger_review`、`research_status` 等）：只为延迟导入，合进分发只会让分发更长。
- `handle_error`、`log_request` 在 IDE 服务和 paper 服务各一份：两个独立服务，不为两行加依赖。
- 报告 JSON 里只写一次的键（`rss_mb`、`by_liquidity_side`、`merge_equals_ab` 等）：读者是 Agent 和人，不算无消费者。
- `ledger/schema.sql`：每列都有代码引用，没有发现没人碰的列。只写不读这一层没查，见缺口。

## Decisions

用户 2026-11-05：“三个全做 不留下次了”。三个指 -10、-11、-54。“不留下次了”我读作 -53 也现在做。

我提问时只说 -53“约 10 行不划算”，没说镜像摘要的代价，所以这句话不算对新摘要的决定。#2182 先留 draft，把代价写明：9 条开着的线上已通过的运行，落后 main 镜像的从 145 个变 217 个，新增 72 个，串行约 1.6–12.9 小时。我建议留到下次换镜像；用户看过后说“现在合并”。
