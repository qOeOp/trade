# 一次重写账本：去掉市场旧设计的字段（方案，待批准）

2026-11-05。用户要求：已删设计“没有用的话尽量做到无痕，就好像从来没出现过一样”；重写只做一次，所有涉及账本重写的修改都放进这一轮。

这份方案没有改任何东西。活动账本、DoltHub、市场目录和服务都没有动。下面的数字来自 DoltHub 的克隆，只在隔离副本上试写过，头是 `h6rknqlflujgbcl6uf8recilaittk5bt`（2654 个提交，试验号到 576）。除非特别说明，数字已不含将被去掉的 53 条试验。

范围按你对审计清单的答复写：“按建议进方案”。那是同意进方案，不是同意动手。

## 1. 要你批准的

1. **改检查。** 你这次说同意不包含改任何拒绝或审计检查，但市场改名这部分做不到不改。§2 第二张表逐条列出现在拒绝什么、之后允许什么。其中 `validation_retries_keep_candidate_and_window` 引用 `universe_rule` 列，删这一列就必须改这条测试。这张表不批准，就只能保留 `universe_rule` 和市场名这两个键及它们的比较，也就做不到无痕。其余改名可以照做。
2. **范围 A 和 B（§2）。** A 是市场旧设计，B 是审计清单里你答复进方案的项。其中删已发布记录的是 B2、B4，改封存旧文件的是 B3、B5 到 B9、B13。
3. **改名和取值。** `market_commit` 改成 `market_day`，值是日期 `2026-10-18`（§3）。
4. **8 个旧编号合并成 3 个日期。** 账本从此看不出它们原来是不同的版本（§4）。
5. **运行合约不升，账本结构版本升到 4。** 升合约会让全部 199 个候选都不能再跑（§5）。
6. **旧运行不能再在原镜像上复现。** 这是改引擎参数名的直接后果（§5）。
7. **删 10 个视图（B15）。** 没有代码读它们。之后手查，包括在 DoltHub 上，都要直接写表和连接。你没有单独回答过这一项，所以单列。
8. **工作目录路径（§4）。** 历史记录可以清掉。新试验还会写，因为 `ingest` 和 `execution recover` 拿它做检查，不改检查就停不了。我建议这次就这样。另一个做法是改存路径的哈希，拒绝行为不变，但要改这两处检查的代码，也要多一个存储字段。
9. **切换当天要停的东西和要删的东西**，包括封存并结束 paper 运行 6，以及 DoltHub 删库重建（§8）。

已经按你的答复定下的，不再问：去掉试验 524–576；正文里的旧编号只替换编号这串字符，其余一字不动；18 个 PDF 和 21 个 HTML 不动。

## 2. 范围

**A：市场旧设计**

| # | 改什么 | 为什么可以 | 账本里多少 |
|---|---|---|---|
| A1 | 删 `exporter_source_sha256` | 只写不比较 | 1011 份内容 |
| A2 | 删 `market_database`（不再改名 `market_name`），读取方改读当前市场配置 | 取值只有一个 `market`，本机只有一个市场 | 1012 份内容 |
| A3 | 把 8 个旧编号写成日期，删 `files.LEGACY` | 账本里全部 `market_commit` 都是这 8 个；“日期加 24 个 0”的形式一个也没有 | 2797 份内容、97 条判断、3 行 `paper_run` |
| A4 | 删 `universe_rule`，规则名只留在代码里 | 只有一条规则，取值只有一个 | 1012 份内容、3 行 `paper_run.config`、0 行 `validation_registration` |
| A5 | 删市场引用 `main`，只留 `head` | 账本没有存过它，是输入项 | 无 |
| A6 | `market_commit` 改成 `market_day` | 市场早已不是带提交的数据库 | 1453 份内容，另有 1726 份的 `--market-commit` |
| A7 | 去掉试验 524–576 | 你已决定，新镜像上要整体重迁 | 106 个提交、267 份只属于它们的内容 |

**B：账本精简（编号沿用审计清单）**

| # | 改什么 | 省多少 | 说明 |
|---|---|---|---|
| B1 | `run.fingerprints` 的 `by_utc_day`（154 行） | 29.7 MB | **这改了你 10-30 的“旧行不改”。** 量得整列从 29.9 MB 降到 181 KB。镜像还写这个键，所以入账时继续去掉它；比较前对存储值的那两次调用和文档字符串删除（`report/runs.py:348`、`replay/reproduce.py:45`、`ledger/problems.py:286-287`） |
| B2 | 两个币安月度 zip，留 `.CHECKSUM` | 3.79 MB | 删已发布记录。币安公开归档可再取 |
| B3 | 账本不再存 `process.json` | 2.61 MB | 封存时 `_require_process` 照旧读工作目录的副本，检查不变 |
| B4 | `native-upstream-tree.json` | 1.75 MB | 删已发布记录。`query-log.json` 里的 URL 含树哈希，GitHub 能再取，不保证永久 |
| B5 | `audit.json` 的 `uncovered_intervals`、`coverage_limits`、`scope`、`run` | 1.50 MB | 检查逻辑和 `findings`、`passed` 不变。`uncovered_intervals` 写到工作目录的单独文件，不进账本，回放可再生成 |
| B6 | `summary.json` 的 `source_file_paths`、`strategy_source`、`account_model`、5 个 `*_source_sha256` | 约 0.42 MB | `runtime_identity` 留：`RUNTIME_MISMATCH` 在读。探针输出里的同名字段留，`runtime/image.py` 在比较 |
| B7 | 回执的 `coverage.interpretation`、`member_months`、`listing_delisting`，以及顶层 `scope` | 0.54 MB | 只从 `market/export.py` 写进回执的那份去掉。`market coverage` 的输出不变，`research-start` 技能要读它的 `interpretation`（审计漏了这个读者） |
| B8 | 捕获清单的 `argv` | 0.28 MB | 启动回执里还有一份 |
| B9 | 启动回执的 `mounts` | 0.27 MB | |
| B13 | `research-plan.json` 的 `runtime_ref` | 21 KB | `execution.image_digest` 留，`comparability.image_digest_of` 在读 |
| B14 | `run_sealed` 并入 `run` | 约 13 KB | 见 §5 |
| B15 | 删 10 个视图 | 可忽略 | 同时把 `ledger/refusals.py:110` 提示里的 `v_evidence` 换成表名 |

逻辑字节共省约 41 MB。每个 explore 约少 14 KB，182 个的新增量从 4–5.6 MB 降到约 2–3 MB（审计估算，磁盘实际节省没有量）。

**会变的检查（要你批准）**

| 检查 | 现在 | 之后 | 实际影响 |
|---|---|---|---|
| `dolt_tests` 的 `validation_retries_keep_candidate_and_window` | 重试的规则名不同就不让提交 | 不比规则名，其余不变。`schema.sql` 一起改，`COMMIT_TEST_ALTERED` 不会报 | 该表 0 行 |
| `RULE_VERSION_MISMATCH`、`universe_rule_is_recorded` | 规则名不同或没记录就拒绝 | 没有了 | 只有一条规则，现在不可能不同。将来改规则不再被记录，所以规定新规则用新的市场目录 |
| 验证、研究线对 `universe_rule`、`market_database` 的比较 | 不同就拒绝 | 没有了 | 取值都只有一个 |
| `facts` 里“不是市场配置的名字”的拒绝 | 拒绝 | 没有了 | 不再有名字可比 |
| `EXEMPT_INPUT_KEYS` | 比较市场名、市场编号、规则、`lifecycle_bundle` | 比较 `market_day`、`lifecycle_bundle` | 见下 |
| 市场引用 `main` 和空字符串 | 接受，等于最新 | 拒绝 | 收紧 |
| 日期写成 `20261018` | `date.fromisoformat` 接受 | `MARKET_DAY_INVALID` | 收紧，防止一条研究线的键被分开 |
| 三列的 `universe_month` 文件 | 接受 | `files.py:466` 拒绝 | 收紧。82 个文件切换时一起改写 |
| `MARKET_COMMIT_UNRESOLVED`、`MARKET_COMMIT_INVALID`、`UNKNOWN_REF` | | 改名 `MARKET_DAY_UNRESOLVED`、`MARKET_DAY_INVALID`、`UNKNOWN_DAY` | 条件不变 |
| `MARKET_COMMIT` | | 并入 `MARKET_DAY_UNRESOLVED` | 条件相同 |
| `engine/load.py`、`engine/audit.py`、`ledger/coverage.py` 对市场编号的比较 | 比 `market_commit` | 比 `market_day` | 条件不变 |
| `SEALED_RESULT_MISSING` | 查 `run_sealed` | 查 `run.report`，发现项的表名写 `run` | 条件不变 |

**`EXEMPT_INPUT_KEYS` 的影响，单独说。** 它决定一个预检能不能让登记免于算作暴露。8 个编号并成 3 个日期后，原来不同的编号可能变成相等，理论上会变宽。逐对查过：177 个登记引用的 182 对预检和登记，全部本来就用同一个编号，判定一个也不变。用 `gc30…` 的 3 个预检（212–214）没被任何登记引用。同一函数先要求镜像摘要相同，旧预检全在旧镜像上，新登记在新镜像上，所以这些旧预检今后也拿不到豁免。今后只有两个市场目录存同一天数据时才有区别，现在只有一个市场。

**这次不碰（只标出，要你另外授权才动）：** 捕获清单的 `runtime_identity`（`EXECUTION_IDENTITY` 在比较）；`input-coverage.json` 的 `input_identity`（`ledger/coverage.py` 在比较，镜像也读）；写路径的 `LEDGER_UPGRADE_REQUIRED`（现在走不到，但它是一条拒绝）；`ingest` 和 `execution recover` 对 `workdir` 的检查。

**没有变弱的地方：** 一次运行用了什么数据，仍由 `export_content_sha256` 判定。它只算回放读到的内容（费率、合约存续段、成员），A、B 都不在里面，所以这个哈希一个都不变。

## 3. 改名对照

| 现在 | 之后 |
|---|---|
| `market_commit`（JSON 键）、回执和成员文件的 `commit` | `market_day`，字符串 `YYYY-MM-DD` |
| `paper_run.market_commit`、`validation_registration.market_commit` | `market_day DATE NOT NULL`，去掉长度约束 |
| 引擎参数 `--market-commit` | `--market-day` |
| `--market-at`、市场命令的 `--at` | `--market-day`、`--day`；可写日期或 `head`，默认最新一天 |
| `MARKET_COMMIT_UNRESOLVED`、`MARKET_COMMIT_INVALID` | `MARKET_DAY_UNRESOLVED`、`MARKET_DAY_INVALID` |
| `MARKET_COMMIT`（导出引用解析不了） | 并入 `MARKET_DAY_UNRESOLVED`，条件相同 |
| 市场内部的 `UNKNOWN_REF` | `UNKNOWN_DAY` |
| `resolve_commit`、`check_commit`、`commit_end`、`latest_commit` | `resolve_day`、`check_day`、`day_end`、`latest_day` |
| `commit_day`、`commit_of`、`DATED`、`LEGACY` | 删 |
| `lifecycle-<market_commit>` | `lifecycle-<market_day>`（账本里 0 个这种包） |
| IDE 的 “Market commit” 和短哈希显示 | “Market day” 和日期 |

账本提交（`ledger_commit`、`based_on_commit`、账本命令的 `--at`）不改：账本确实是 Dolt。

## 4. 账本里的值怎么写

**旧编号到日期，按 `files.LEGACY`：**

| 日期 | 旧编号 | 用它的地方 |
|---|---|---|
| 2026-10-18 | `l1kf…`、`53tg…` | 380 次试验、1 次试验 |
| 2026-10-25 | `1kcb…`、`dbng…`、`gc30…`、`6ho8…`、`pn5b…` | 98、93、3 次试验，paper 4、paper 5 |
| 2026-10-31 | `iv71…` | paper 6 |

合并成同一天不会让记录撞车，这几点都查过：

- 6 条研究线合并后，没有新增相同的“日期加窗口”。有 3 条本来就共用 `l1kf…` 和同一窗口，那是现状。
- `registration_attempt` 只用了 `l1kf…`、`1kcb…`、`dbng…`，后两个所在研究线的窗口不同。
- 没有任何一份内容或判断同时提到合并到同一天的两个编号，所以不会出现“2026-10-25 和 2026-10-25 不同”这种句子。
- 预检判定不会放宽：177 个登记引用的 182 对预检和登记，全部用同一个编号。用 `gc30…` 的 3 个预检（212–214）没有被任何登记引用。这是逐对枚举的结果，审计当时没有枚举。
- 代价：账本从此看不出 `1kcb…` 和 `dbng…` 曾是不同版本。它们的导出内容不同，由 `export_content_sha256` 区分。

**按内容类型处理。** 只有产品写的结构化字段按结构改，Agent 写的文字只换编号：

| 内容 | 改什么 |
|---|---|
| 启动回执 `execution.json`（规范 JSON） | 删 `mounts`、`workdir`；`input_identity` 删键、改键、改值；`argv` 改参数和值 |
| 捕获清单 `execution.json`（规范 JSON） | 删 `argv`；`files` 去掉 `process.json`，其余条目的 `sha256`、`length` 跟着文件重算 |
| `input-coverage.json` | 同启动回执的 `input_identity`；删 B7 的键；`membership` 和每份回执的 `commit` 改成 `market_day`；`effective_config`；重算 `universe_sha256` |
| `process.json` | 整份删 |
| `audit/audit.json` | 删 B5 的键；重算 `file_sha256["summary.json"]` |
| `reports/summary.json` | 删 B6 的键；`market_commit` 改名改值；重算 `effective_config_sha256` |
| `research-plan.json` | `execution` 按结构改；删 `runtime_ref`；`body` 只换编号 |
| `research-line.json` | 键和值按结构改；`note` 只换编号 |
| `source-review.json` | 字段里的提交和编号引用；`note` 只换编号 |
| `run.fingerprints` | 删 `by_utc_day` |
| `run_sealed` | 并进同一 `trial_id` 的 `run` 行 |
| `paper_run` | 列和 `config.universe_rule` |
| 判断正文、Agent 自建包里的文件、两个路线标签 | 只换编号 |
| 两个 zip、`native-upstream-tree.json` | 从包里删，内容行一起删 |
| 捕获的 stdout、stderr | 只换编号 |
| `candidate.source` | **不改** |

**只替换编号这串字符，其余一字不动。** 所以正文里的 “market commit” 留着，比如变成 “market commit 2026-10-18”。涉及 97 条判断（审计记 64 条，我用 8 个编号重扫，是 97 行：`l1kf…` 62、`dbng…` 35）和 188 份审阅里的 264 处。

**工作目录路径。** 审计说 996 份含 `/private/tmp`、2 份含 `/Users/`，这是去掉 53 条试验前、只数这两种前缀的结果。我把 `/var/folders` 和裸 `/tmp/` 也算上，逐份归类，共 1154 份：

| 在哪 | 份数 | 处理 | 哈希 |
|---|---|---|---|
| `process.json` 的命令行 | 522 | B3 整份删 | 捕获清单跟着变，本来就要变 |
| 启动回执的 `mounts` | 522（和下一行是同一批文件） | B9 删 | 只有这份回执自身的内容哈希，没有别的记录引用它 |
| 启动回执的 `workdir` | 522 | 历史删；新试验继续写 | 同上 |
| 审阅、计划、Agent 文件和判断的文字 | 87 份审阅、7 份计划、13 份 Agent 文件、151 条判断 | **不动**。其中 2 份审阅是 `/private/tmp`，其余是裸 `/tmp/` | 不适用 |
| 3 个 PDF 内部的 `/Users/` | 3 | **不动**。这是论文作者自己机器的路径，不是这台机器的 | 不适用 |

**有没有动到不该动的哈希：没有。** 上面三类结构化路径都不进 `export_content_sha256`、`run.fingerprints`、`table_hashes`、`source_sha256`，这几份文件本来就因改名要变。要报回给你的是两件事，都不是哈希问题：

- `workdir` 在写入路径上被两处检查读（§1 第 8 条）。历史可以删，是因为保留的试验再也走不到它们：182 个研究试验都已入账，保留试验的捕获都在，不需要恢复。
- 文字里的路径和你说的“其余一字不动”冲突，我按后者办。所以账本里还会有这些 `/tmp/…` 字样，它们是当时工作目录的名字，不含凭据。

## 5. 回答几个关键问题

**重写几次？** 一次。全部规则放进同一轮。脚本写成规则表：删哪些键、改哪些键、值怎么映射、按路径怎么处理、编号替换、整份删掉哪些文件。脚本等方案批准后再写，最后一轮重放在切换时才跑。

**先后顺序：** 改名、B3、B5 到 B9 和 B13 都要先进代码和新镜像，然后才重写，最后才迁移 182 个运行。迁移新增的记录这样才小，也不用迁两遍。524–576 这 53 条被去掉，所以迁移全部在新代码上重新跑。

**运行合约要不要升？不升，留在 `replay-contract@v7`，`image.LAYOUTS` 和 `shared_equal` 都不改。**

- 我原来打算升到 v8，独立审阅指出了问题，我核对后属实：`replay/entry.py:426,510` 和 `registration/register.py:326` 要求候选的合约等于镜像的合约。升了以后，199 个候选全部被 `RUNTIME_CONTRACT_MISMATCH` 拒绝。而 `candidate_source` 唯一约束不让相同源码重新发布（`SOURCE_EXISTS`），所以每个策略都得改字节、换身份、开新修订。改 `candidate.runtime_contract` 又不符合事实。这个代价不值。
- 合约说的是模块路径和策略接口，这两样都没变。以前加 `--metrics` 也没升：旧镜像在探测时报 `UNKNOWN_OPTION`，这是现成的做法。
- 引擎还是要改：`--market-commit`、`export.json` 和成员文件的 `commit`、`summary.json` 的键、`engine/load.py` 和 `engine/audit.py` 的检查。所以会有新镜像，所有运行都要迁过去。这和任何一次 `engine/` 修改相同，靠 `runs_behind_image` 看进度。
- `shared_equal` 跨镜像只比两边都有的键，`market_day` 由 `COVERED_CONFIG_KEYS` 排除，不进比较。**这一条必须改对**，否则不同日期的运行会互相判为不可比。
- 旧记录的 `runtime_contract`（69 个 v6 候选、130 个 v7 候选）和镜像摘要不改，它们是实际发生的事。

**代价要说清楚：** 切换后，所有旧试验都不能再在自己的镜像上复现。

- 已有镜像只认 `--market-commit` 和 `market_commit`（`engine/load.py:349-351,540-555`），新代码不再给它们，探测时报 `UNKNOWN_OPTION`。这一点读代码得出，准备阶段实跑确认。
- 旧的 v7 镜像仍标着受支持，所以报错不如 `RUNTIME_UNSUPPORTED` 清楚。
- `replay reproduce` 不带 `--image` 时默认用最近到达的镜像（`replay/reproduce.py:79`）。所以顺序只能是改名、新镜像、再迁移。迁移后默认值就是新镜像。
- 之前试跑迁不过去的 12 个都是 v6，本来就被 `RUNTIME_UNSUPPORTED` 拦着。
- 旧预检按规则只能在自己的镜像上复现，所以从此不能复现。它们的记录还在，新登记本来也要在新镜像上做新预检。

想保留原镜像复现，只能让引擎继续用旧名字，主机再写一份旧键。这正是你不要的兼容，所以不选。

**账本结构版本升到 4。** 没切换的工作区用旧代码读新账本时，会直接报 `SCHEMA_MISMATCH`，而不是读一半才出错。第一个提交的信息和 `ledger_schema` 一起写成 4。

**哪些封存的字节不能改？哈希怎么重算？**

| 值 | 处理 | 依据 |
|---|---|---|
| 策略源码、`source_sha256` | 不改 | 199 份源码里这些词一个都没有，其中只有 5 份引用了账本提交，留着 |
| `run.fingerprints` 的 `rows`、`sha256`、`file_sha256` | 不改 | 只算成交、持仓等表，不读 A、B 的字段。只删 `by_utc_day` |
| `fingerprint/fingerprint.json` 和它在清单里的哈希 | 不改 | 163 份预检存了字节，里面仍有 `by_utc_day`；其余只存哈希。没有进范围 |
| `table_hashes`（只有 524–576 有） | 随这些试验一起去掉 | |
| `reports/*.csv` 等原生报告 | 不改 | 只存哈希的改不了；预检存了字节的也不含这些字段 |
| `export_content_sha256` | 不改 | `_read_facts` 不含这些字段 |
| 运行身份、镜像摘要 | 不改 | 实际发生的事 |
| `effective_config_sha256` | 按 `problems.config_sha256` 重算 | `capture_problems` 把它和封存的配置比较，不重算就报 `CONFIG_MISMATCH` |
| `universe_sha256` | 重算 | 253 份里全部等于成员对象规范 JSON 的哈希 |
| `audit.json` 的 `file_sha256["summary.json"]` | 重算 | 它覆盖 summary 的字节 |
| 内容哈希、清单的 `sha256` 和 `length`、审阅包名 | 跟着内容重算 | 和上一次演练相同 |

**重算的顺序按依赖走：**

1. `membership` 改完，算 `universe_sha256`，写进 `effective_config`。
2. 算 `effective_config_sha256`，写进 `summary.json`。
3. 算 `summary.json` 的哈希，写进 `audit.json` 的 `file_sha256`。
4. 算 `summary.json`、`audit.json`、`input-coverage.json` 的哈希和长度，写进捕获清单。
5. 内容行的哈希是生成列，自己变。审阅包名含内容哈希，跟着改名，引用它的 `plan.body.prechecks` 和文字跟着换。

**文件格式不能变：** 同一个键删掉后，字节要和当时的写法相同。逐份量过，这几种文件用固定的写法都能逐字节还原：`execution.json` 是规范 JSON；`audit.json`、`summary.json` 是缩进 2、保留键序、带换行；`input-coverage.json`、`research-plan.json`、`research-line.json`、`source-review.json` 是缩进 2、键排序、带换行。

**受影响的比较：** `reproduction.matches` 同镜像比 `fingerprint.json` 的哈希，跨镜像比 `table_hashes` 和 `run.fingerprints` 的 `sha256`，都不变。配置比较用 `config_key`，`market_day` 由 `COVERED_CONFIG_KEYS` 排除（见上）。`summary.json` 的 `effective_config_sha256` 只在写入时检查，读取时不查，算错了不会报错，所以要单独扫描核对。

两条旧约束：199 份源码不变，成立。“没有被重写值的表，表哈希不变”也成立，但 `paper_run`、`validation_registration`、`run` 改了结构，不算在内；`trial` 少 53 行，只比较保留的行。

**`run_sealed` 并入 `run`（B14）。** 实测 182 行一一对应，全部是 `passed`，`op_id` 全等。只取一个修订，所以 13 种 `metrics_revision` 各自留在自己的行上。

- 新结构：`run` 加可空的 `metrics_revision`、`report`。不加新的 `CHECK`，那等于收紧；`SEALED_RESULT_MISSING` 照旧由 `ledger review` 判。
- `run_sealed.created_at` 丢掉。182 行都和 `run.created_at` 不同，因为各盖各的时间戳，并表后没有读者。
- 删表、触发器和多修订读取：`latest_sealed`、`ledger/metrics.py:285-286,297-303`、`registration/register.py:269-270`、`report/review.py:215`。

**大行和结构写得进去吗？** 这项要在重写前试过，隔离副本上的结果：

| 试的内容 | 结果 |
|---|---|
| `run` 删 `by_utc_day`，154 行更新 | 1.3 秒，正常 |
| 最大一份内容（6.27 MB）写入和提交；就地更新 `evidence_content` | 正常 |
| `run` 加两列，逐行写入 182 份 `report` | 1.4 秒，182 行和原值相等 |
| `DROP TABLE run_sealed`、删 10 个视图 | 正常，剩 8 个触发器 |
| 从包里删 3 个文件和内容行，提交 | 正常，包里其余文件还在 |
| `UPDATE run JOIN run_sealed` | **失败**：报 `Check constraint violated`，这是假报，那些行本身没有违反。逐行更新没问题 |
| `UPDATE candidate` | **Dolt 2.4.2 panic**，和上次相同 |

后两条都不影响做法：脚本按提交重放，整行插入，不用这两种写法。还没试的是按规则表完整重放一遍，那要等脚本写好，结果在演练时给你看。

**结构怎么进历史？** 只有 3 个结构提交。重放到这些提交时，不再 cherry-pick，而是直接用改过的建表语句：`run` 从第一个提交起就是新结构，没有 `run_sealed` 和视图；`validation_retries_keep_candidate_and_window` 测试用改过的文字。`COMMIT_TEST_ALTERED` 要求 `dolt_tests` 和 `schema.sql` 逐字节相同，所以这一条每个提交都要对。`validation_registration` 是 0 行，`witness` 是 0 行，没有时间戳令牌会失效。

## 6. 去掉试验 524–576

核对结果：

- 从头往下正好 106 个提交，53 条 `open_trial` 加 53 条 `seal_capture`，中间没有别的。下面一个是 `seal_capture:execution:trial-523`。
- 去掉后正好 2548 个提交，就是上次演练的范围。
- 带 `trial_id` 的表里只有 `trial` 有这些行；`judgment_subject`、`run`、`registration_attempt` 都是 0。
- 其余判断和证据的文字没有提到这些试验号（按“trial、explore、run、试验”加号码扫描，没有扫单独出现的数字）。
- 267 份内容只属于这些包，一起消失。
- 重放在 `trial-523` 停下，下一个试验号自然是 524。

**头怎么对齐：** 三处都换成新链。活动账本换库；`dolt_backup` 目录改名保留，再导出一份新的；DoltHub 重建后发布。

**如果之后又写了账本：** 脚本按提交信息跳过这 106 个，其余照常重放。如果后面的提交引用了这些试验号，脚本停下报告，不猜。

## 7. 代码怎么交付

- **代码 PR：** 复用 #2112，改标题和正文。包括 `market`、`registration`、`ledger`、`report`、`replay`、`paper`、`cli`、`engine`、`ide`、技能和蓝图。粗算非测试代码约 280 行、测试 39 个文件、蓝图 28 个文件。等另一个会话的 #2116 合并后变基。
- **B 里改产品代码和镜像的项放进同一个 PR。** 这个 PR 会改 `engine/`，所以有新镜像。
- **删掉的兼容代码：** `files.LEGACY`；市场引用 `main`；对存储值调 `stored_fingerprint` 的两处和它的文档字符串；按修订读 `run_sealed` 的代码；`report/measures.py:440` 过时的注释。`fill_volumes` 可选、`RUNTIME_UNSUPPORTED`、`shared_equal`、`_paper_deletion`、`held`、`build_revision`、`NOT_EVALUATED` 都留：对应的旧记录或功能还在，或者没有把握。
- **评测 PR：** 紧跟着单独开。26 个评测文件提到这些名字，另一个会话数出约 49 个用例带假编号。
- **市场目录：** 一次性脚本把 `universe_month` 的 82 个文件（共 328K）去掉这一列，逐文件核对成员不变。
- **旧文档：** 蓝图和 README 随代码改。`docs/plans/` 里有 19 份提到这些名字，由另一个会话一起判断。视图那一页 `docs/rd/design-database-views*` 和其余提到 `run_sealed`、视图的页面一起改。这份方案和 `market-name-field.zh.md` 在切换后删掉，只留一份不写旧名字的决定记录，加 5 份策略源码引用的新旧提交对照。
- **留下的痕迹（做不到完全无痕的地方）：**
  - Git 历史不重写，旧代码和旧 PR 还看得到。GHCR 上保留的旧镜像仍有旧参数。
  - 5 份策略源码注释里的账本旧提交哈希不改，因为改了策略身份就变了。
  - 按“只换编号”，正文里还留 “market commit”（约 129 份内容、5 条判断、2 个标签信息）和 “market database”（7 份）这些词。
  - Agent 的原件和捕获里留旧键：`technical-precheck-identity.json`、`probe-exact-grouping.py`、`independent-exact-grouping-probe.json`，以及试验 212、213 的 stderr 回溯。
  - 预检的 `fingerprint.json` 里留 `by_utc_day`（163 份）。
  - 新试验的启动回执继续写 `workdir`（§1 第 8 条）。

## 8. 切换顺序

**准备（只在隔离环境，不停服务）：**

1. 写代码，全量测试，拿到 PR 镜像 `pr-N`。
2. 按 `engine/README.md` 的成对回放比较 a46c 和 `pr-N`，确认行为相同。
3. 写重写脚本，在克隆上演练，跑核对（§9）。把结果给你看。

**切换（你批准后）：**

1. 确认没有会话在写账本。停 paper，先封存运行 6（它还没封存，市场编号是 `iv71…`，要在重放前落进账本）。再停 `market-import`、`ide`。
2. `ledger export --kind backup`，让旧链有一份完整备份。这个备份上次同步是 10-25，平时只手动同步。
3. 从最新账本做最后一轮重放，重跑全部核对。**这里停下，把结果给你看。**
4. 你同意后，停 `ledger`，把旧库改名留在原处，换上新库。
5. 改写 `universe_month`。
6. 合并代码 PR。CI 构建 `main` 镜像（最多约 30 分钟）。
7. 按先 `ledger` 后其余的顺序重建服务，跑 `ledger review`。
8. 旧备份目录改名保留，重新导出。此时 `ledger review` 不应再有 `HISTORY_REWRITTEN`。
9. DoltHub：强制推送清不掉服务端的旧对象。要做到无痕，需要你在 DoltHub 上删库重建，再 `ledger publish`。
10. 合并评测 PR。
11. 另一个会话把全部运行迁到新镜像。
12. paper 用新镜像开新运行（重启本来就是新运行）。

**一周后，你决定：** 删旧库、旧备份，以及更早的 `dolt-backups/research-before-clear-20261022T0507`。

**耗时：** 上次重放 2548 个提交用了约 23 分钟。这次多结构和按结构改 JSON，加上核对，估计一小时内。第 1 到 8 步里账本不可写。之后的迁移另算。

## 9. 怎么判断重写对了

沿用上次的核对，并加上这次的：

- 按提交逐行核对，约束没有违反，没有被重写值的表的哈希不变。
- 严格扫描，按字节窗口，不按单词（上次用单词匹配漏掉过引用）。全库和全部提交信息：8 个旧编号一个不剩，只放过 §7 列的地方。结构化字段：旧键、旧参数、旧拒绝码一个不剩。
- B 的键在对应文件里一个不剩，`process.json`、两个 zip、`native-upstream-tree.json` 的内容行没有了。
- 结构化路径：保留的启动回执没有 `mounts`、`workdir`。
- 新代码读新库和旧代码读旧库，同样 20 份输出比较，差别必须能全部解释。
- `ledger review` 0 个问题。`read_capture` 对保留的 522 个试验全部通过。
- 每份 `summary.json` 的 `effective_config_sha256` 等于重算值，每份 `universe_sha256` 等于成员对象的哈希，每份 `audit.json` 的 `file_sha256["summary.json"]` 等于 summary 的哈希。读取路径不查前两个，只能这样扫。
- 每份改过的 JSON 按它的格式重新序列化后逐字节相等。
- `reproduction.reproductions` 对每个运行逐个比较新旧。`matches` 遇到 `EXECUTION_IDENTITY` 不报错，只返回 False，链条写错的话，复现会悄悄变成新试验，`ledger review` 看不出来。
- 每条研究线的 `line_trials`、每个登记的预检判定，新旧相同。旧编号合并后，试验 198、212–214 的日期可能和别的研究线相同，这一条专门防它。
- `export_content_sha256`、`run_cycle`、`run_return` 逐行相等。`run.fingerprints` 去掉 `by_utc_day` 后相等。`run.report`、`run.metrics_revision` 等于旧的 `run_sealed`。
- 结构：每个提交的表结构、`dolt_schemas`、`dolt_tests` 都和新的 `schema.sql` 一致。这是上次演练没有覆盖的新内容。
- 抽样在新镜像上 `replay reproduce`，包括开着的研究线上的运行，四张表相同。这一步要合并后才能走正式路径，准备阶段用 `pr-N` 做成对回放代替。成对回放也要看 B5、B6 只少了键，别的不变。

## 10. 独立审阅

2026-11-04，子 Agent 只读代码，没有看账本，也没有看我的结论。账本相关的问题我在克隆上量过。

| 字段 | 消费者 | 记录的事实 | 审阅结论 | 处理 |
|---|---|---|---|---|
| `exporter_source_sha256` | 只有写入和测试 | 导出器代码版本，只作来源记录 | 照做 | 照做 |
| `market_database` | `facts`（恒真）、`market_for` 选档案、`select_line`、预检比较 | 本机市场档案；取值全是 `market`，没有信息量 | 改动后照做 | 见下 1 |
| `files.LEGACY` | `commit_day`、跳过最新日检查 | 旧编号代表不同数据版本，日期表达不了 | 改动后照做 | 先重写再删；撞车已量，没有新增 |
| `universe_rule` | 验证、研究线、预检、读取都在比较；`store.py:665` 用它筛行 | 规则名；成员已被直接比较 | 改动后照做 | 见下 2 |
| 市场引用 `main` | `resolve_commit`、`select_line` 默认值 | 无 | 改动后照做 | `market_at or "main"` 改成默认 `None`；账本的 `main` 不动 |
| `market_commit` | 引擎和主机都比较，也显示 | 这次读到哪一天 | 改动后照做 | 见下 3 |

1. 删 `market_name` 后有两个前提：隔离环境要用自己的档案目录，否则市场度量会静默读活动市场；如果将来有两个市场，另一个目录上的预检也能拿到豁免。现在只有一个市场。这要改 `EXEMPT_INPUT_KEYS`，属于要批准的检查。
2. 删 `universe_rule` 的风险：将来改 `RULE` 而目录不变时，什么都不会记录。所以写明新规则要用新的市场目录。`store.py:665` 去掉筛选前我量过，82 个文件全部只有这一条规则。三列的旧文件会被 `files.py:466` 拒绝，所以 `market-import` 要先停，文件要和代码一起换。
3. `market_day` 的四个要求：加进 `COVERED_CONFIG_KEYS`；账本的 `--at` 不动；日期解析要严格，`date.fromisoformat` 也接受 `20261018`，两种写法会把一条研究线的键分开，要拒绝；`serve.py:135`、`graph.schema.json:73`、`LineWidget.tsx:20`、`StatusBar.tsx:31` 一起改。

**其他采纳的意见：** 不升合约（§5）；核对复现列表和 `summary` 哈希（§9）。

**审阅认为做不到完全无痕的地方：** 5 份策略源码、保留的旧镜像、Git 历史。这些写在 §7。

## 11. 这次不做的

- **18 个 PDF、21 个 HTML：** 不动。其中论文 PDF（28 MB）放在公开账本上能不能这样再分发，没有查过。这是未决问题：要彻底从公开历史去掉，只有这次重写最省事，之后就得再重写一次。
- **预检的 `fingerprint.json`、DoltHub 失败记录：** 不动。
- **磁盘实际节省：** 没有量，41 MB 是逻辑字节。

