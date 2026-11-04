# 一次重写账本：去掉市场旧设计的字段（方案，待批准）

2026-11-05。用户要求：已删设计“没有用的话尽量做到无痕，就好像从来没出现过一样”；重写只做一次，所有涉及账本重写的修改都放进这一轮。

这份方案没有改任何东西。活动账本、DoltHub、市场目录和服务都没有动。下面的数字来自 DoltHub 的克隆，只在隔离副本上试写过，头是 `h6rknqlflujgbcl6uf8recilaittk5bt`（2654 个提交，试验号到 576），都含将被去掉的 53 条试验。

## 1. 要你确认的

1. **范围第 1 到 5 项。** 你当时回答的是“也改”，是另一个会话把它理解成全部同意。请在这里确认一次（§2）。
2. **改名和取值。** `market_commit` 改成 `market_day`，值是日期 `2026-10-18`（§3）。
3. **8 个旧编号合并成 3 个日期。** 账本从此看不出它们原来是不同的版本（§4）。
4. **运行合约不升，账本结构版本升到 4。** 引擎参数会改名，但升合约会让全部 199 个候选都不能再跑（§5）。
5. **去掉试验 524–576。** 你已回答“去掉”，这里核对过，可以干净地去掉（§6）。
6. **改不改 Agent 写的文字。** 判断和审阅正文里有“market commit”和旧编号。我建议机械替换，否则账本里留着代码再也解析不了的编号（§4）。审计的意见相反，认为这是判断原文，所以要你定。
7. **切换当天要停的东西和要删的东西**，包括 paper 当前的运行和 DoltHub 仓库（§8）。
8. **旧运行不能再在原镜像上复现。** 这是改引擎参数名的直接后果（§5）。
9. **审计清单里哪些一起做。** 另一个会话正在把同样的内容交给你决定，我的建议在 §11。只有你明确同意的条目才进重写范围。

## 2. 范围

| # | 改什么 | 为什么可以 | 账本里多少 |
|---|---|---|---|
| 1 | 删 `exporter_source_sha256` | 只写不比较 | 1011 份内容 |
| 2 | 删 `market_database`（不再改名 `market_name`），读取方改读当前市场配置 | 取值只有一个 `market`，本机只有一个市场 | 1012 份内容 |
| 3 | 把 8 个旧编号写成日期，删 `files.LEGACY` | 账本里全部 `market_commit` 都是这 8 个；“日期加 24 个 0”的形式一个也没有 | 2797 份内容、97 条判断、3 行 `paper_run` |
| 4 | 删 `universe_rule`，规则名只留在代码里 | 只有一条规则，取值只有一个 | 1012 份内容、3 行 `paper_run.config`、0 行 `validation_registration` |
| 5 | 删市场引用 `main`，只留 `head` | 账本没有存过它，是输入项 | 无 |
| 6 | `market_commit` 改成 `market_day` | 市场早已不是带提交的数据库 | 1453 份内容，另有 1726 份的 `--market-commit` |
| 7 | 去掉试验 524–576 | 用户决定，新镜像上要整体重迁 | 106 个提交、267 份只属于它们的内容 |

删字段后下面这些检查会消失或改变，都属于要你批准的范围：

- `RULE_VERSION_MISMATCH` 和 `universe_rule_is_recorded`：只有一条规则，没有可比的对象。
- 验证登记、研究线和预检对 `universe_rule`、市场名的比较：同上。现在比较的值永远相等。
- `facts` 里“不是市场配置的名字”的拒绝：不再有名字可比。
- 市场引用 `main` 和空字符串：之后被拒绝。
- `registration/precheck.py:37` 的 `EXEMPT_INPUT_KEYS`：去掉市场名和规则。
- `dolt_tests` 的 `validation_retries_keep_candidate_and_window`：去掉对 `universe_rule` 的比较。`report/review.py` 把它和 `schema.sql` 逐字节比（`COMMIT_TEST_ALTERED`），两边一起改。

没有变弱的地方：一次运行用了什么数据，仍由 `export_content_sha256` 判定。它只算回放读到的内容（费率、合约存续段、成员），这 6 项都不在里面，所以这个哈希一个都不变。

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

**按内容类型处理。** 键名不能靠全文替换，`commit` 这个词到处都是，所以 JSON 按结构改：

| 内容 | 改什么 |
|---|---|
| 启动回执和捕获清单 `execution.json`（规范 JSON） | `input_identity` 删键、改键、改值；`argv` 改参数和值；按规范 JSON 重新序列化 |
| `input-coverage.json` | 同上；`membership` 和每份回执的 `commit` 改成 `market_day`；`effective_config`；重算 `universe_sha256` |
| `process.json` | 命令行里的 `--market-commit` 和值 |
| `reports/summary.json` | `market_commit`，重算 `effective_config_sha256` |
| `research-plan.json`、`research-line.json`、预检身份文件 | 同样的键和值 |
| 审阅、判断、笔记、两个路线标签的正文 | 只替换词：“market commit”→“market day”，“market database”→“market”，旧编号→日期 |
| 报错日志（2 份） | Python 回溯里的 `market_commit` |
| `probe-exact-grouping.py` 和它的探针结果（各 1 份） | 手工处理：删掉比较 `exporter_source_sha256` 的那一行和那个键 |
| `paper_run` | 列和 `config.universe_rule` |
| `candidate.source` | **不改** |

**文字替换**影响 134 份内容和判断里的“market commit”、7 份里的“market database”，以及 189 份审阅、97 条判断里的旧编号（审计记的是 64 条判断，我用 8 个编号重扫，是 97 行）。只换这些词，别的文字一个字不动。

如果你选择不改文字：这些旧编号留在正文里，要在 `docs/plans/` 写一张 8 个编号到日期的对照表。那就不算无痕。

## 5. 回答几个关键问题

**重写几次？** 一次。全部规则放进同一轮。脚本写成规则表：删哪些键、改哪些键、值怎么映射、按路径怎么处理、文字替换、整份删掉哪些文件。§11 里你同意的项只加表项，不改重放逻辑。脚本等方案批准后再写，最后一轮重放在切换时才跑。

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

**哪些封存的字节不能改？**

| 值 | 处理 | 依据 |
|---|---|---|
| 策略源码、`source_sha256` | 不改 | 199 份源码里这些词一个都没有，其中只有 5 份引用了账本提交，留着 |
| `run.fingerprints`、捕获里指纹文件的哈希 | 不改 | 只算成交、持仓等表，`engine/compare.py` 不读这些字段 |
| `export_content_sha256` | 不改 | `_read_facts` 不含这些字段 |
| `effective_config_sha256` | 按 `problems.config_sha256` 重算 | `capture_problems` 把它和封存的配置比较，不重算就报 `CONFIG_MISMATCH` |
| `universe_sha256` | 重算 | 253 份里全部等于成员对象规范 JSON 的哈希，所以能重算 |
| `audit.json` 的 `file_sha256["summary.json"]` | 重算 | 它覆盖 summary 的字节 |
| 内容哈希、清单的 `sha256` 和 `length`、审阅包名 | 跟着内容重算 | 和上一次演练相同 |
| 只存哈希的原生报告（成交表等） | 不改 | 原始字节不在账本里，也不含这些字段。`summary.json` 都存了字节（573 份，去掉这 53 条后 520 份），可以改 |

`summary.json` 的 `effective_config_sha256` 只在写入时检查，读取时不查，算错了不会报错，所以要单独扫描核对。

两条旧约束：199 份源码不变，成立。“没有被重写值的表，表哈希不变”也成立，但 `paper_run` 和 `validation_registration` 改了结构，不算在内；`trial` 少 53 行，只比较保留的行。

**大行写得进去吗？** 在隔离副本上试过：`run` 的 154 行更新 1.3 秒；最大的一份内容（6.27 MB）写入和提交都正常；就地更新 `evidence_content` 也正常。`UPDATE candidate` 仍然让 Dolt 2.4.2 panic，和上次相同；上次的做法是撤掉触发器后按提交重放，没有用 `UPDATE`，这次沿用。

**结构怎么进历史？** 只有 3 个结构提交。重放到这些提交时，不再 cherry-pick，而是直接用改过的建表语句，同时写入改过的 `v_validations` 和 `validation_retries_keep_candidate_and_window` 测试。`COMMIT_TEST_ALTERED` 要求 `dolt_tests` 和 `schema.sql` 逐字节相同，所以这一条每个提交都要对。`validation_registration` 是 0 行，`witness` 是 0 行，没有时间戳令牌会失效。

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
- **§11 里改产品代码和镜像的项放进同一个 PR。** 它们要在 182 个 explore 之前生效，否则迁移新增的记录不会变小。
- **评测 PR：** 紧跟着单独开。26 个评测文件提到这些名字，另一个会话数出约 49 个用例带假编号。
- **市场目录：** 一次性脚本把 `universe_month` 的 82 个文件（共 328K）去掉这一列，逐文件核对成员不变。
- **旧文档：** 蓝图和 README 随代码改。`docs/plans/` 里有 19 份提到这些名字，由另一个会话一起判断。这份方案和 `market-name-field.zh.md` 在切换后删掉，只留一份不写旧名字的决定记录，加 5 份策略源码引用的新旧提交对照。
- **留下的痕迹：** Git 历史不重写，旧代码和旧 PR 还看得到。GHCR 上保留的旧镜像仍有旧参数。5 份策略源码注释里的账本旧提交哈希不改，因为改了策略身份就变了。

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
- 严格扫描：全库和全部提交信息里，旧键、旧编号、旧参数、旧拒绝码一个都不剩，只放过 5 份策略源码和旧提交引用。扫描按字节窗口，不按单词，这是上次用单词匹配漏掉引用后得到的教训。
- 新代码读新库和旧代码读旧库，同样 20 份输出比较，差别必须能全部解释。
- `ledger review` 0 个问题。`read_capture` 对保留的 522 个试验全部通过。
- 每份 `summary.json` 的 `effective_config_sha256` 等于重算值，每份 `universe_sha256` 等于成员对象的哈希。读取路径不查这两个，只能这样扫。
- `reproduction.reproductions` 对每个运行逐个比较新旧。`matches` 遇到 `EXECUTION_IDENTITY` 不报错，只返回 False，链条写错的话，复现会悄悄变成新试验，`ledger review` 看不出来。
- 每条研究线的 `line_trials`、每个登记的预检判定，新旧相同。旧编号合并后，试验 198、212–214 的日期可能和别的研究线相同，这一条专门防它。
- `export_content_sha256`、`run.fingerprints`、`run_cycle`、`run_return`、`run_sealed` 逐行相等。
- 结构：每个提交的表结构、`dolt_schemas`、`dolt_tests` 都和新的 `schema.sql` 一致。这是上次演练没有覆盖的新内容。
- 抽样在新镜像上 `replay reproduce`，包括开着的研究线上的运行，四张表相同。这一步要合并后才能走正式路径，准备阶段用 `pr-N` 做成对回放代替。

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

## 11. 审计清单（等你决定）

完整报告是另一个会话的账本只读审计。账本逻辑上约 110 MB。我逐项核对了读者，结果有一处和审计不同：`summary.runtime_identity` 有读者，`ledger/problems.py:199` 拿它做 `RUNTIME_MISMATCH` 检查，所以不能删。

这些项只有这次能做干净：历史一旦重写完，再删就只能留在旧提交里。

| # | 项 | 节省 | 碰什么 | 我的建议 |
|---|---|---|---|---|
| 1 | `run.fingerprints` 的 `by_utc_day`（154 行） | 29.7 MB | 你 10-30 定过“旧行不改”，要改口 | **做。** 没有读者，隔离副本上量得整列从 29.9 MB 降到 181 KB |
| 2 | 两个币安月度 zip，留 `.CHECKSUM` | 3.79 MB | 删除已发布记录 | **做。** 币安公开归档可再取，校验和还在 |
| 3 | `process.json` | 2.61 MB | 改旧封存文件 | **做。** 只有工作目录的副本被读，存进账本的没人读 |
| 4 | `native-upstream-tree.json`，已含树哈希 | 1.75 MB | 删除已发布记录 | **做。** GitHub 能按哈希再取，不保证永久 |
| 5 | `audit.json` 的 `uncovered_intervals`、`coverage_limits`、`scope`、`run` | 1.50 MB | 审计输出变，判定不变 | **做。** 反正要出新镜像。`uncovered_intervals` 是 `engine/README.md` 写明的诊断，说明止损覆盖为什么不够，所以不直接丢：改写到工作目录的单独文件，不进账本，要看时回放重新生成 |
| 6 | `summary.json` 的 `source_file_paths`、`strategy_source`、`account_model`、5 个 `*_source_sha256` | 约 0.42 MB | 同上 | **做，不含 `runtime_identity`** |
| 7 | `input-coverage.json` 的 `interpretation`、`member_months`、`scope`、`listing_delisting` | 0.54 MB | 产品代码 | **做** |
| 8 | 捕获清单的 `argv`（启动回执里还有一份） | 0.28 MB | 产品代码 | **做** |
| 9 | 启动回执的 `mounts`，顺带少一批本机路径 | 0.27 MB | 产品代码 | **做** |
| 13 | `research-plan.json` 的 `runtime_ref` | 21 KB | 产品代码 | **做。** `execution.image_digest` 留着，`comparability.image_digest_of` 在读 |

全做约省 41 MB。每个 explore 约少 14 KB，182 个的新增量从 4–5.6 MB 降到约 2–3 MB（审计估算，磁盘实际节省没有量）。

**不做，只标出（碰检查，要你另外授权）：**

- 捕获清单的 `runtime_identity`：`EXECUTION_IDENTITY` 在比较。
- `input-coverage.json` 的 `input_identity`：`ledger/coverage.py` 在比较，镜像也读。
- 写路径的 `LEDGER_UPGRADE_REQUIRED`：现在走不到，但它是一条拒绝。

**不做，以后随时能做，不需要重写：** `run_sealed` 并入 `run`（约 13 KB）、删 10 个视图。

**不建议改：** 预检的 `fingerprint.json`、18 个 PDF 和 21 个 HTML 来源原件、DoltHub 失败记录。

**只有这次能处理的两件事，审计没有结论，要你看一眼：**

- 账本是公开的，18 个论文 PDF（28 MB）能不能这样再分发，没有查过。如果不能，只有这次能从公开历史里彻底去掉。
- 996 份内容含 `/private/tmp` 路径，2 份含 `/Users/`。这些是本机路径，不含凭据。我建议不动，除非你在意。

**重写后可以删的兼容代码比预期少：** `LEDGER_UPGRADE_REQUIRED` 以外，只有比较前对存储值调 `stored_fingerprint` 的两处（`report/runs.py:348`、`replay/reproduce.py:45`）和 §3 列的内容。`fill_volumes` 可选、`RUNTIME_UNSUPPORTED`、`shared_equal`、`_paper_deletion`、`held` 都要留：对应的旧记录或功能还在。
