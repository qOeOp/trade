# 2026-11-05 Python 消费者链路：函数、文件、模块、功能

用户要求检查所有 `.py` 文件，沿“函数 → 文件 → 模块 → 功能”找冗余函数、字段和无消费者的功能，并执行微重构和清理。本记录审产品，不审研究会话。同日的[冗余审计](2026-11-05-redundancy-audit.zh.md)已清掉大部分，这次只记它之后还在的。编号跳过 -39 至 -50，开着的 [#2172](https://github.com/qOeOp/trade/pull/2172) 已占用。

| Item | Value |
|---|---|
| Sessions | 无研究会话。转录只用来数命令实际执行次数（`~/.codex/sessions`、`~/.claude/projects/-Users-vx-WebstormProjects-trade`） |
| Audit session | Claude Code desktop，claude-opus-5-5，会话 `6070a404-c0c4-4c12-ad31-977340199f28`，worktree `py-consumer-cleanup`。没有派子代理。本会话写了修复 PR，所以不是独立审计 |
| Checkout / ledger | 分析在 main `671b9a8ee`，改动变基到 `488440e8d`（已含 #2164）后复核。账本未读未写 |
| Coverage | 工作流 Product contracts and delivery 的 Mechanisms 与 Residue。全部受版本管理的 191 个 `.py`，约 50,000 行。方法：按模块解析导入的函数级引用图，从真实入口（`cli.main`、`engine.*` 的 `main`、`ide`、`replay.entry`）算可达；方法与 dataclass 字段按属性读取数；可选参数、恒定实参、未读返回值按调用点；函数体结构哈希找重复；CLI 命令和标志对 skill、评测、部署、IDE、文档、转录；`ledger/schema.sql` 列对代码文本；`ruff --select F,ARG,ERA,PIE,SIM,RUF100` 宽规则。**缺口**：属性读取是按名字全局数的，同名属性会让字段或方法漏判；调用点分析只覆盖名字唯一的函数；报告 JSON 键是给 Agent 读的输出，只抽查，没有逐键判定；账本列只查文本出现，没区分只写不读 |
| Cost | 研究：无研究会话；产品造成的无效试验 0。审计自身 token unknown |
| Net change | 产品 Python +91 −169，测试 +33 −37，`ide/web` +1 −10；拒绝码 254 个，不变；skill 词数 27,523，未动。删 1 个空包层（`renderers/web`），加 2 个共用函数（`db.has_table`、`metrics.moment_ns`），各替掉 2 份复制。没有新增机制 |

## Findings

每项都用 AST 和 `git grep` 复核到调用点。这一批没有研究会话证据，代价 `none` 指没有观察到损失。

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261105-12 | **无消费者的名字**（本次收尾）。除 `engine/config.py` 的 `account_contract` 由 #2164 删外全部处理：`DAY_NS`、`READINGS_SECONDS`、`GROUPS`、`OPTIONAL`、`_install_key`、`replay.entry.summary_problems`、`report.attribution.attribution`（连带 `compare(part=)`）、`Hub.resolve(line)`、`TRADE_IDE_BUILD`、`meeting_targets`、`priceText`、`returnOf`、`AgentInput`；`registration.validate` 是 `_validate` 的包装，包装删掉，`_validate` 改名 `validate` | 引用图：产品入口不可达。`report/review.py` 的 `FINDINGS`、`engine/config.py` 的 `INTEGRITY_CODES` 按上两份记录留 | remove | none | 见索引 |
| 20261105-51 | **只有测试调用或没人读结果的小件**：`refusal_catalogue`（产品直接读 `CATALOGUE`）；`runtime_identity_fields(identity)` 不用参数；`directory_report` 接缝没有替身，只是转一次；`_sync_backup`、`check_name`、`_note`、`ingest_capture_refusal` 的返回值所有产品调用都丢弃；`ide/research_graph/renderers/web/render.py` 在 #2165 删掉 `--renderer` 后只剩一个实现，两层空包；23 处 `noqa` 指的规则没启用（4 处带说明的改成普通注释） | 调用点扫描；`ruff --extend-select RUF100` 处理后只剩下面 -53 的 3 处 | remove | none | 见索引 |
| 20261105-52 | **逐字复制的函数**：`_birth_commit` 与 `_registration_commit`（同一条 SQL）、`replay/entry.py` 的 `_regular`（-22 合并时漏的）、`replay/reproduce.py` 与 `report/measures.py` 的 `_ns`、`ledger/paper.py` 与 `ledger/targets.py` 的 `held` | 函数体结构哈希相同，人工比过语义。`report/attribution.py` 的 `_ns` 多收整数，`report/review.py` 的走字符串，不同义，留 | remove | none | 见索引 |
| 20261105-53 | **动了就换导出器哈希或镜像摘要的冗余**：`files.months_through(table)` 恒为 `"bar"`，`sources.daily_archives` 的 `interval` 恒为 `"1m"`、`workers` 无人传，`export.write_quotes(chunk)` 只有测试传，`market/store.py:783` 的多余 `noqa`；镜像里 `engine/config.py` 的 `parse_window(execution_bar_minutes)` 无产品调用方传，`engine/audit.py:675`、`engine/paper.py:345` 的多余 `noqa` | `market/export.py:548` 的 `EXPORTER_FILES` 含这些文件；改它们会让导出缓存失效、新运行的 `exporter_source_sha256` 变一次，`engine/` 改动要新镜像摘要。为约 10 行不划算 | remove（随下一次必须的导出器或镜像变更） | none | open |
| 20261105-54 | **`Reports.coverage` 只写不读**：`ledger/metrics.py:244` 解析覆盖回执放进字段，产品没有 `.coverage` 读取。但解析本身会对坏文件拒绝，删字段等于放宽一条路径 | `ledger/metrics.py:135,244`；`rg '\.coverage\b'` 产品 0 处 | authority，然后 remove | none | open |

已有未结项在本次复核仍成立，未动：20261105-10（`report/reproduce.py` 的 `compare_runs` 未接入，连带 `registration/comparability.py` 的 `input_keys` 和 4 个拒绝码）、20261105-11（`LedgerProfile.holds`）。两项都碰拒绝路径，需要授权。

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| `compare_runs` 与 4 个拒绝码 | 一对运行的对比 | `engine.compare_reports`、`report.compare` | 从未接入 | 问用户（-10） |
| `LedgerProfile.holds` | 把市场 profile 当账本 | `cli/main.py:148-149` | 今天的 profile 走不到 | 问用户（-11） |
| `Reports.coverage` | 无（字段没人读）；解析顺带拦坏文件 | 其他阶段是否同样拦，unverified | 只有构造 | 问用户（-54） |

### 查过，不动

- CLI 命令和标志：47 个命令都有 skill、部署、IDE、文档或转录中的消费者。Codex 转录里没执行过的 `ledger witness`、`execution recover`、`paper delete`、`line targets` 是恢复路径、用户操作或由 skill 指引，没走到不等于可删。只出现在 `--help` 的 `--retry-of`、`--failure-receipt`、`--supersedes` 同理。
- 接缝：其余 16 个字段，测试里都传过同名参数（按关键字数的，没有逐个确认是替身）。`use` 只有 `report/graph.py` 在产品里调用，其他是测试入口，三份各自绑模块的 `current`，合不了。
- `review_all(tables, trial_ids)`、`sync_witness(tsa_roots)`、`validation_register(tsa_roots)`：只有测试传。前者删了要动 `INVALID_NAME` 分支，后两者是测试注入信任根，留。
- `plan_metrics` 返回值产品丢弃，但测试断言它，且函数主体是审计检查。留。
- `engine/audit.py` 的 `forbidden(intervals=intervals)`：默认参数绑循环变量，不是冗余。`parse_window(execution_bar_minutes)` 见 -53。
- `cli/main.py` 里 3–4 行的命令函数（`ledger_review`、`research_status` 等）：只为延迟导入，合进分发只会让分发更长。
- `handle_error`、`log_request` 在 IDE 服务和 paper 服务各一份：两个独立服务，不为两行加依赖。
- 报告 JSON 里只写一次的键（`rss_mb`、`by_liquidity_side`、`merge_equals_ab` 等）：读者是 Agent 和人，不算无消费者。
- `ledger/schema.sql`：每列都有代码引用，没有发现没人碰的列。只写不读这一层没查，见缺口。

## Decisions

等用户定：-10、-11、-54。
