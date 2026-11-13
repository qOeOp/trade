# 新账本前的一次性重构与瘦身（2026-11-10）

用户 2026-11-10 已备份并删除研究账本 `trade-research`，以后的研究从一个新账本从零开始。用户要求趁这次把库结构、冗余和错名字段、为不破坏既有数据而加的兼容层和绕行一次解决，做一次大瘦身。

本文只是计划，不授权任何改动。第 8 节列出要用户逐项授权或决定的事。
基线 `origin/main` `454a3eb29`。三路独立只读审查：账本数据模型；代码中的兼容与绕行；skills、评测、IDE 和文档。关键结论已在该检出上复核。

## 0. 与执行路径重规划的分工

[执行路径重规划](execution-paths-replan-20261110.zh.md)（R1–R5）管回放、Paper、Live 的运行契约，内容包括：

- 数据、账户、预热和订单规则；
- Live 只跑研究候选本身；
- Live 与回放的对照；
- Paper 的补丁。

本文不重复这些，只管其余部分：

- 账本 schema；
- 读写账本的代码；
- 兼容层；
- 命名；
- 模块依赖；
- 部署遗留；
- skills、评测、设计站、计划文档和 IDE。

两份计划都必须在新账本开张前完成。合并后的顺序见第 7 节。

不变的边界（AGENTS.md）：
- Nautilus 管执行。
- 账本只存回放给不回来的事实，每个事实存一次，不存可推导的东西。
- 写账本只走命令行。
- Paper 和 Live 的执行记录不进账本。
- 新增存储字段要独立评审，并在 `docs/plans/` 记录。
- 改拒绝或审计检查要用户授权。

## 1. 新账本 schema（L）

### 原则

- 按"读的人怎么读"决定形状。
  - 整份读、整份比的文档（封存报告、指纹、有效配置、覆盖回执）留 JSON 或证据文件。
  - 按名字前缀查找、要连接、要分组的记录改成表和列：研究线、研究登记、源码审查、试验的执行身份。
- 删掉复制、可推导字段和版本后缀以后，事实总数不增加。表结构改变不等于新增事实。每一列都要能对应到现在已经存储的某个事实（第 8 节 A1 的评审要逐列核对这一点）。

### L1 候选的身份只有一个

- 现状：`candidate` 的主键是 `(strategy_id, revision)`，另有 UNIQUE `source_sha256`。
  - `trial`、`registration_attempt`、`paper_run` 用哈希引用候选；
  - `validation_registration`、`judgment_subject` 用名字引用；
  - `ledger/strategies.py:3` 却说身份是哈希。
- 改为：
  - 主键 `source_sha256`，`(strategy_id, revision)` 是 UNIQUE 名字；
  - 父关系改为 `parent_source_sha256`；
  - 所有引用都用哈希。

### L2 产品记录从证据 JSON 里搬出来

现状：研究线、研究登记、源码审查都是固定格式的产品记录，却存成证据包里的 JSON 文件。

- 读的人用 `LIKE 'research-line-%'` 这类名字前缀找包，再解析文件（`ledger/lines.py:70`、`registration/register.py:520`、`qualification/availability.py:219`、`report/status.py:45`）。
- 试验属于哪条线是推断出来的：从每个启动回执读出市场提交，再比较窗口和时间（`ledger/lines.py:244-283`）。

改为以下几张表：
- `research_line`：名字、起点源码、市场日、成员规则、窗口、备注。
- `line_close`：取代用 Dolt tag 关线。现在关线要管理员账号（`ledger/lines.py:374`），判断"开着没"要对每条线查一次 `dolt_log` 祖先关系。
- 开发期的固定规则、线开着时的隔离，以及关线历史回测和热力图，见[固定开发期与关线历史回测](line-close-history-test-20261110.zh.md)。
- `research_registration`：外键 `line_id` 不可空。
  - 预测、理由等自由文本仍然放在一个 JSON 列；
  - 比较设计和执行身份用列。
- `registration_grid_point(registration_id, source_sha256)`：每个格点的预检和审查。
- `source_review`：结论和四项审阅，各带状态和说明。
- `comparison_design`：现在 `validation_registration.design` 里固定的 8 个键，研究登记与验证登记共用。

改完以后，证据包只装不透明的文件：
- 捕获的标准输出、错误输出和 summary；
- 覆盖回执；
- 来源原件；
- 生命周期；
- Agent 自己的证据。

### L3 试验带上自己的执行身份

- 现状：执行身份散在 JSON 里。
  - 运行时契约、平台、构建版本、输入身份、有效配置都在启动回执 `execution.json` 里；
  - `report/status.py:38-110` 每次调用都把每个试验的回执读一遍；
  - 可比性要在 Python 里重算。
- 改为 `trial` 的列：
  - `runtime_contract`、`platform`、`build_revision`；
  - `market_day`、`universe_rule`、`export_sha256`、`config_sha256`；
  - `execution`（bars 或 quotes）、`starting_balance`。

  可比性就变成 SQL 分组。完整的有效配置和覆盖回执仍各存一个证据文件。
- `registration_attempt` 和 `validation_registration` 两张表与试验一一对应，而且在同一事务里写入。把它们并进 `trial`，成为两个外键：`research_registration_id`、`validation_registration_id`。
- `trial.instruments` 这个 JSON 与 `input_identity.symbols` 重复，改成一张 `trial_instrument` 表。
- 启动回执里不再复制行里已有的列（`trial_id`、`purpose`、`source_sha256`、`image_ref`）。
- 启动回执不再存 `workdir`、`mounts` 这些主机路径。这同时解决未结项 20261107-111 里公开账本上约 4,600 条临时路径的问题。
- 捕获清单（各阶段状态、退出码、文件状态）改为 `trial_capture` 表加 `evidence` 的状态列。去掉其中复制的 `argv` 和 `runtime_identity`，以及"阶段必须等于 `process.json`"这份双写。

### L4 运行一张表，封存读数不带版本

- `run_sealed` 并进 `run`：
  - 它的主键是 `(trial_id, metrics_revision)`，但唯一写入点是 `ledger/trials.py:297`，在 `require_new` 之下，所以与 `run` 一一对应；
  - "取最新版本"的读法（`ledger/metrics.py:341-346`、`registration/register.py:269`、`report/review.py:215`）是为从来没实现的重封存写的。
- 读数按 L10 可以替换：每次运行只有一份当前读数，口径变了用重封覆盖，不再并存多个版本。
- `metrics_revision` 改名 `product_commit`。它是封存时产品检出的 HEAD（`ledger/metrics.py:745`），不是指标版本。
- 封存报告仍是一份 JSON（整份读），但做以下精简：
  - 去掉 `@N` 键：`mark_max_drawdown@2`、`top_instrument@3`、`peak_utc@1/@2` 并存等。`report/measures.py:46-73` 的 `VERSIONS`、`SEALED_DRAWDOWN` 别名和 `key()` 一起删；
  - 去掉可推导的数：`populations.cycles/days` 是行数，`compounded` 可以从收益序列重算；
  - 最终权益不再埋在 `activity."returns_compound_to_equity@1".final_equity` 里。
- `run.audit` 是捕获中 `audit/audit.json` 的副本，删掉。
- `run.failure_reasons` 和 `run.fingerprints` 是整份读的 JSON，保留，同时删掉两条互相推导的 CHECK。
- 新增 `sealed_seq`。
  - 理由：`latest_research`（`ledger/trials.py:324-340`）现在对每个已过运行做一次 `dolt_diff` 加 `AS OF`，为的是找回插入时的 `ledger_head.seq`；
  - 这是这次唯一真正新增的列，要单独评审。
- `run_cycle.realized_pnl` 改为 NOT NULL，删除 `report/profit.py:44-60` 和 `report/measures.py:113-114,454-455` 里补算旧周期的代码。
  - 前提要先核实：现在封存一定写这个值（`ledger/metrics.py:375` 缺值会抛错）。

### L5 Paper 记录离开研究账本

- 现状：
  - `paper_run` 和 `paper-N-capture` 在研究账本的 schema 里（`ledger/schema.sql:240`）；
  - 本机 compose 的 `paper serve` 不带 `--ledger`（`deploy/compose.yaml:136`），所以写进活动的、会公开的研究账本，违反 AGENTS.md"执行记录不进账本"；
  - 只有远程部署用独立的 `paper` 库（`deploy/remote/compose.yaml:50`）。
- 改为：
  - Paper 库有自己的小 schema：`paper_run` 加捕获，候选照 `paper/inputs.py` 现在的做法复制过去；
  - 研究账本删掉 `paper_run`，删掉 Paper 删除流程和 `ledger review` 为它开的豁免（`ledger/paper.py:370-416`、`report/review.py:53,290-308`）；
  - 本机和远程用同一种部署形状。

### L6 判断、目标、见证

- `judgment.line_bundle` 和 `CHECK LIKE 'research-line-%'` 改为外键 `line_id`。
- `kind` 改为 ENUM，去掉重复的 CHECK 和 `KINDS`。
- `judgment_subject` 的三种主体改为：候选哈希、试验、研究登记。
- `line_target` 现在用 NULL 范围表示账本默认，所以"当前生效"无法用约束保证唯一，只能靠运行时的 `LEDGER_CORRUPT` 兜底（`ledger/targets.py:50`）。改为显式的默认范围。`supersedes` 链保留。
- `witness` 加 `registration_id` 外键，查询不再经过 `dolt_diff_validation_registration`（`ledger/witness.py:116,196`、`cli/main.py:364`）。

### L7 清理与效率

- 删掉全部 10 个视图。产品代码一个都不读，只有测试和一条拒绝提示（`ledger/refusals.py:122`）引用它们。
- `op_id` 只放在每次写入的头行上：
  - `run_sealed.op_id` 复制了 `run.op_id`，随 L4 删除；
  - 为嵌套写入编出来的 `evidence_bundle.op_id`（`execution_start:…`、`registration_source:…`）删掉。
- 显式写入的 `created_at` 删掉；只留触发器写入服务器时间，这是信任边界。
- `dolt_tests` 第 1、2、7 条在 L3 合表后能写成行内 CHECK 或外键，第 4 条能写成复合外键。第 6 条每次提交都扫历史，随 L6 去掉。这些都是改检查，要授权（第 8 节 B2）。
- 补索引：`trial(purpose, source_sha256)`、`trial(trade_start, trade_end)`、`judgment(line_id, kind)`、`research_registration(line_id)`、`source_review(trial_id)`。

### L8 在 Dolt 2.7.2 上重测 2.4.2 时代的绕行

现在固定的是 2.7.2，但以下绕行都是在 2.4.2 上测出来的，一条都没有重测：

- `ledger/schema.sql:9-10` 把 CHECK 写成显式 OR；
- `ledger_head.op_id` 的合并语义；
- 对没有行的结果取 MAX 返回空（`ledger/strategies.py:93-95`）；
- 对存储的 blob 重算 SHA2 会崩溃，所以每次读都在 Python 里重新哈希；
- EXPLAIN 的 NULL 解码（`cli/main.py:53,311-349`）；
- `EMPTY_COPY`（`cli/service.py:61`）；
- tag 列举（`ledger/publish.py:17`）。

做法：

- 在隔离库里做原生探针，还成立的留下，不成立的删掉；
- 安全相关的几条（`NO_FILE_IO`、OUTFILE、`branch_control` 转义）属于纵深防御，保留，只改注释；
- 设计站里"在 Dolt 2.4.2 上验证"的说法一并更新。

### L9 版本与迁移

- 删掉 `ledger upgrade`、`READABLE_VERSIONS`、`has_table` 的各处门槛，以及拒绝码 `LEDGER_UPGRADE_REQUIRED`（`ledger/db.py:893-924` 等，约 65 行）。
- `SCHEMA_VERSION` 从 1 重新开始。
- 以后的 schema 变化怎么走（只能重建，还是写迁移）是未结项 20261107-113（第 8 节 P5）。用户 2026-11-11 定为两条：读数层靠重封重算，承诺层只加列、不改不删（[schema 稿](new-ledger-schema-20261110.zh.md)第 2 节）。原先的建议是按 L10 分层：
  - 承诺层只做追加式迁移（新增可空列或新表）；
  - 读数层可以整张重建；
  - 只有承诺层出现不兼容的结构变化，才重开账本。

### L10 防篡改只保护承诺：承诺、读数、整理三层

要防的是 Agent 给自己打分：看完结果再改预测，藏掉失败的试验，把读数改好看。还有一层是公开账本的可信度。这是单人自托管的工具，不防用户自己。

以下现有机制正是保护这个边界的，而且成本很低，全部保留：
- 写账号只有 INSERT 权限（`ledger/db.py:535`）；
- 服务器触发器写入创建时间；
- 源码和证据内容的哈希是数据库生成列；
- 验证登记的 RFC 3161 时间戳；
- 公开的 DoltHub 副本。

碍事的是把封存读数也当成了承诺：口径一改就只能另起版本键，于是有了 `@N` 键、`metrics_revision` 取最新、`run_sealed` 的复合主键，以及 `ledger review` 里核对复制字段的大段检查。

| 层 | 包含 | 规则 |
|---|---|---|
| 承诺 | 候选源码；试验声明（开跑前写入的窗口、镜像、用途）；研究登记和预测；验证登记和时间戳；判断；目标；开线时固定的开发期；运行的原始结果（状态、失败原因、指纹、周期、日收益）；关线记录 | 只能追加，错了也只追加更正。写账号对这些表只有 INSERT。`ledger review` 只检查这一层有没有行被改或删 |
| 读数 | 封存报告里的各项指标 | 可以替换，每次运行只留一份当前读数，不带版本键。只有产品的封存命令能写：重新回放，新的原生报告与已存指纹逐项相同，才用当前指标代码覆盖，并记下 `product_commit`。旧值留在 Dolt 历史和公开副本里，查得到 |
| 整理 | 只为展示和检索、不影响任何结论的东西 | 可改可删。先不建任何这样的表，检索问题由 L11 解决；真需要时再加 |

- 指纹的角色反过来：它不再阻碍修改，而是证明重算用的是同一次运行。
- 指纹只留每张原生报告的语义哈希加行数。按日哈希随 C5 删掉；逐字节的 `file_sha256` 实施时先核对用途（`engine/audit.py:653`、`engine/compare.py:145`），只是与语义哈希重复就删掉。
- 指标改口径时，只需重封要看的运行，每次约 80 秒。最大回撤取分钟级 MARK 权益，只能靠回放重算，所以不必全量重跑。
- `ledger review` 的行变更检查缩小到承诺层，并只查上次检查之后的新提交。现在是每次扫全部历史。
- 写账号对读数表另给 UPDATE。Dolt 是否支持按表授予 UPDATE 尚未验证，在隔离库里先测；如果不支持，读数单独放一个库或分支。
- AGENTS.md 里"封存时算一次"的读数说法相应改写（第 8 节 B7）。

### L11 已关的线：不删，默认不读

已关线里那些不合格的策略不删，也不压缩：
- 它们是多重检验的分母：试验计数、折扣夏普、`search_exposure`、关线热力图上"从多大的搜索里挑出来"都靠它们。删了会让幸存者看起来更好。
- Dolt 删行不省空间：历史、备份和公开副本都还留着。回收空间只能改写历史，那是破坏性写入。
- 存储量不是瓶颈。旧账本 11-07 实测：2,399 个 trial、555 个运行、598 个候选，Dolt 实际数据 489 MB，其中 blob 约 116 MB，平均每个 trial 约 0.2 MB。涨 100 倍也只有约 50 GB，比现在的市场目录（81 GB）还小（[规模实测](https://github.com/qOeOp/trade/blob/ffcb6771ee9a3a818f472a497ac3621e53bc9943/docs/plans/doctor/2026-11-07-trial-growth-scaling.zh.md)）。

检索变慢是真问题，但原因是"每次都读全账本"。同一份实测里：
- `research status` 在 423 个 trial 时要 1.95 秒，到 2,399 个时要 6.94 秒；
- 平均相关随运行数平方增长，2,600 个运行要 29 秒。

除了 L3 和 L7（列加索引），再加三条规则：
- **读命令默认只看开着的线。** 已关的线只通过关线记录和关线热力图出现，需要时按线查。
- **跨线只读汇总。** 多重检验次数、热力图这类跨线的数用 SQL 聚合算，不逐个加载运行。"不合格"是从读数推导出的状态，不存标记，列表里默认折叠。
- **开张前做一次规模测试。** 在隔离库里造约 2 万个 trial、1,000 条线，给关键读命令计时并定上限。以后超过上限就修读法，不删数据。

真要省空间，就在源头不存能再生成的大文件：已通过运行的捕获输出（stdout、stderr）是否只存哈希，并进 A1 的逐列评审一起决定。

## 2. 删掉兼容层（C）

以下各项只为旧账本、旧镜像或旧主机存在；新账本开张后都没有消费者。

| 项 | 位置 | 服务的旧东西 | 约删行数 |
|---|---|---|---|
| C1 | `market/files.py:42-53` `LEGACY`，8 个旧 Dolt 提交哈希，及 `:292,375` | 旧账本引用的市场提交 | 18 |
| C2 | `market/files.py:287` `commit_of`（日期补 24 个 0）和 `DATED` | 让市场日长得像 Dolt 哈希 | 10；字段改名见 N1 |
| C3 | `runtime/image.py:33-40,79-81` `LEGACY_V7_SOURCE_PATHS` | 旧 main 版本的 v7 源码表 | 15 |
| C4 | `engine/compare.py:25,53,108`、`ledger/metrics.py:54,143,187,250,840` 中可选的 `fill_volumes` | 不写成交量的旧镜像 | 15（要发新镜像） |
| C5 | `engine/compare.py:137-143` 计算的 `by_utc_day`，以及 `ledger/problems.py:283-291` 再把它剥掉 | 旧运行行里存的按日哈希 | 25（要发新镜像） |
| C6 | `ledger/lines.py:121-151,244-283,313-321`、`registration/register.py:533,739` 的线归属推断 | 不写 `line` 的旧登记计划（现在一律写，见 `register.py:652`） | 50 |
| C7 | `report/runs.py:100` 缺 `catalogue` 时的默认值 | 旧封存 | 1 |
| C8 | `ledger/db.py:438-443` 旧账号名 | 哈希命名之前的账号 | 4 |
| C9 | 运行时契约只剩一个布局之后：`RUNTIME_UNSUPPORTED`、"旧契约重启"的 skill 文字（`changes.md`、`research-start/SKILL.md:43-44`）和 2 个评测 | 旧契约的候选 | 文字约 100 词。拒绝码几乎没有成本，保留 |
| C10 | `ledger/reproduction.py:21,60-68` 跨契约复现时只比共有字段 | 旧契约少写的配置项 | 15（收紧检查，要授权） |
| C11 | 测试：`tests/live/protocol-1.json`、`protocol-2.json` 没有任何读者；约 8 个整测和 6 个局部只测兼容路径；`top_instrument_share_in_drawdown@2` 等过期键 | — | 测试约 480 行 |

部署和 Live 的兼容层放在第 5 节。

## 3. 命名（N）

改名都是破坏性的，新账本开张前一次改完。

- **N1** `market_commit`（117 处）→ `market_day`。现在它的值是一个日期；`market_database`、`market_at` 也是"市场曾是 Dolt 库"的遗留叫法。
- **N2** 市场 profile 的 `kind` 和 `role` 两个字段互换了含义（`market/files.py:691` 写的是 `"role": kind`）。市场 profile 放在"ledger profile 目录"里，`LEDGER_KIND` 的意思其实是"不是市场"。统一成一种 profile 结构，用一个字段区分账本和市场。
- **N3** 记录历史的版本后缀一律重置为 v1，或者直接去掉。包括 `replay-contract@v7`、`research-line-v2`、`research-plan-v2`、`ledger-export-v2`、`runtime-failure-v2`、`live-run-v6`、度量键上的 `@N`，以及 IDE 部件类型的 `summary@1`、`lineage@2`（约 25 处，服务端就是本仓库自己）。
- **N4** 容易混的命令名（建议，要用户定，见第 8 节 P3）：
  - `research status` 对 `research state`；
  - `validation registration`（名词接名词）对 `registration add`；
  - `replay report` 读的是封存运行，不是回放；
  - `ledger review`（产品提交检查）对 `source review`。
- **N5** 已经错了的注释：
  - `ledger/strategies.py:23` 说账本不导入引擎，实际导入了；
  - 三个 `seams` 模块写着"后续阶段接线"；
  - `tests/ledger/dolt.py` 里的"phase 2"。

## 4. 模块依赖与重复（M）

- **M1 断开循环依赖：**
  - `ledger` ↔ `registration`（`ledger/reproduction.py:14`）；
  - `ledger` ↔ `report`（`ledger/replica.py:78`）；
  - `qualification` ↔ `registration`（`qualification/availability.py:25-26,62` 对 `registration/seams.py:207-215`）；
  - `cli` ↔ `paper`（`paper/serve.py:214`）。
- **M2** `ledger/errors.py` 和 `refusals.py` 移到一个只被依赖、不依赖别人的包。`market` 用自己的 profile 模块，不再借用 `ledger.db._inside` 和 `_private_write`（`market/files.py:662-693`）。
- **M3** `ledger/metrics.py:31` 导入了 `engine.native_csv`，账本要读原生 CSV 却依赖了镜像内的代码。把读取器放进 M2 的共享包。
  - 实施时不做（#2574）：运行镜像只复制 `engine/`，镜像无法导入共享包；另放一份再用测试钉住，增加的比省下的多。`engine.native_csv` 只用标准库，本来就是镜像和主机共用的那一份 CSV 约定。
- **M4 规范 JSON 只写一种，优先做。** 现在有六种写法，`ensure_ascii` 和 `allow_nan` 的设置各不相同（`ledger/db.py:757`、`registration/inputs.py:36`、`paper/recovery.py:60`、`live/state.py:68`、`engine/config.py:463`、`engine/compare.py:83`）。同一份内容可能得出不同哈希，这是正确性风险，不只是重复。`engine` 那两处在镜像边界内，可以保留各自一份，但必须与共享实现逐字节一致，并用测试钉住。
- **M5 其它重复：**
  - 市场 profile 查找写了三遍；
  - 报告文件清单写了三遍；
  - `execution-input-coverage-v1` 定义了三遍；
  - 按月迭代有五种写法；
  - Docker 辅助函数写了三遍。

  合计约 90 行。

  实施记录：市场 profile 查找并入 `shared.profiles.market`（#2574）；覆盖格式由 `replay` 改用 `ledger.coverage.FORMAT`，镜像那份用测试钉住；市场包内列月份并成 `market.universe.months`。不做：报告文件清单随 C4 在第 3 阶段处理；`registration` 的字符串月份不导入 `market`（会在导入时带进 pyarrow），`engine` 那份在镜像内；三处 Docker 辅助函数的拒绝语义不同，合并要改拒绝。
- **M6** `cli/main.py:1092-1751` 有 660 行帮助文字，其中的"拒绝"条目在复述 `ledger/refusals.py` 的含义。改为从拒绝码目录生成，约省 150 行。
- **M7（低优先）** 三个 `seams` 模块（约 450 行）是全局可变的依赖注入。产品代码也经由它们接线（`cli/main.py:700`、`report/graph.py:153`），不只是测试在用。能否用直接调用加 `mock.patch` 取代，要先逐个看调用点，暂不承诺省多少。

## 5. 部署与 Live 遗留（D）

- **D1 旧 Web 路由 `trade-ide-ide-1` 的一次性接管代码：**
  - 涉及 `deploy/release.py`、`deploy/release_host.py`、`live/release.py`、`install-release.sh` 的相关部分，约 80 行 Python 加脚本；
  - 主机已经走过这一步，`release.py:649` 在旧路由仍活跃时会拒绝；
  - 删除前先在服务器上只读确认那个容器已经不在；
  - 新主机只保留一个安装器。
- **D2 旧 Paper 容器 `trade-ide-paper-1`：**
  - 涉及 `OLD_PAPER`、`install-paper-release.sh`，以及 `deploy/remote/compose.yaml:49-59` 的 `paper` 服务；
  - 这个服务还在，所以整项目 `compose up` 会多起一个控制器，现在只靠 README 的一句警告挡着；
  - 容器 11-09 已删。删除这些代码前，先 grep 部署代码确认没有引用（记忆中 #2526 就是删容器删出事故）。
- **D3** 旧的两字段 CI 记录（`deploy/release.py:209,223`、`deploy/paper_release.py:119`）。
- **D4 部署重复：** Caddy 路由逻辑写了两遍，常量和版本解析写了两遍，预热循环和 `docker create` 参数在三个主机文件里各写一遍。约 140 行。
- **D5 操作员用的 Live 命令行路径（要用户定，见第 8 节 P2）：**
  - 涉及 `live preflight/start/reconcile --credentials-file`，以及没有 `credential_ref` 的旧运行（`live/credentials.py:159-169,264,345`、`live/runs.py:241-244`、`live/inventory.py:62-70`）；
  - 约 150 行代码加 60 行文档；
  - 删掉以后，Live 只剩 Web 控制这一个入口。

## 6. Skills、评测、IDE、设计站、计划文档（S）

### Skills（约 25,900 词）

- 历史文字已经很少，旧命令、旧字段的引用一处都没找到。只靠新账本能删的约 200 词：
  - `capital.md:23-27` 旧镜像的空参与率；
  - C9 的旧契约重启；
  - `research-round/SKILL.md:129` 里旧账本的 trial、判断编号。
- 模板名单（`template.md:3-33`，368 词）编码了三份用户决定。新账本上"首批模板已完成首报"的条件会重新计起。要不要改成"模板由用户准入、Agent 带证据提名"（约省 250 词）由用户定（第 8 节 P4）。
- 大的瘦身只能靠改写，不靠删历史。最大的两块：
  - `research-start/SKILL.md` 的 Goal 与宿主暂停一段（323 词）；
  - `readiness.md` 的覆盖处置第 4 部分。

  估计还能省 10–15%（未起草，未验证）。每次改动按 AGENTS.md 跑受影响的评测。
- `research-sources/references/data.md` 104 行，缺目录。

### 评测（231 例，约 65,200 词）

- 新账本使以下评测失效：
  - 1 例：`participation-null-old-image`；
  - 删掉旧契约以后，再失效 2 例：`old-contract-restart-option-says-new-rule`、`contract-restart-registers-root`。
- 模板名单若改，4–5 例跟着改。
- Live 那 3 例归执行路径重规划。
- 216 份 `graders/skill-fired.md` 里有 88 份字节相同。先量 `claude plugin eval` 能不能共用评分器，能就合并。
- 每个评分器的改动都单独开 PR（AGENTS.md）。

### IDE

- 死代码：
  - `components/LiveActions.tsx` 只被测试脚本引用；
  - `components/LiveRefresh.tsx` 没有引用；
  - `state/liveWorkspace.ts:36-40` 定义了但没人调用；
  - `state/shell.ts:77-81` 迁移旧 Live 页布局。
- `model/account.ts:58-81` 的 `tradeStats` 对回测重算胜率、均盈、均亏、期望。报告的 `slices` 已经给了这些值，回测改读报告；Paper 仍然需要这个函数。
- 部件类型的 `@N` 和 Unknown 部件兜底随 N3 一起去掉。
- 疑似缺陷，未运行验证：`model/backtest.ts:36` 直接用 `ts_closed_ns` 做除法，而开放周期的这个值是 NULL。实施时先复现。
- 合计约 120 行。IDE 不写 SQL，只经由命令行读，所以 schema 改动对它的影响集中在 `backtest.ts:52,55` 和 `agent/src/tools.ts:52`。

### 设计站（`docs/rd` 33 页）

- 最大的一块是"全池 RSI"演练叙述：H01–H10 在 16 页里出现约 170 次，带 `rd-tier-rehearsal` 标记的段尾有 118 个。它们的证据在已删的账本里，删掉。
- 以下内容随实施一起改写：
  - schema 第 3 代、`ledger upgrade`；
  - 旧市场提交表；
  - 度量 `@N` 和 `metrics_revision`；
  - `research-line-v2`；
  - 旧契约；
  - Dolt 2.4.2 的说法。
- 已经过时的内容：
  - `feedback.zh.mdx:63` 的 `NO_ECONOMIC_EVIDENCE` 实际叫 `ECONOMIC_EVIDENCE_UNAVAILABLE`；
  - 英文页 `design-ledger.mdx:3` 的开头是中文。
- 设计站在 schema 落地后整体重写数据库各页，不逐句修补。

### 计划文档

- `docs/plans/` 里约 37 份已经没有用（约 2,226 行），可以删：
  - 已完成的修复验证和验收；
  - 旧账本和演练的记录；
  - 已并入 skill 的规则；
  - 已完成的 Live 分步记录。

  其中 10 份先要去掉设计站对它们的链接；约 17 份被代码、部署或测试按路径引用，要先改这些引用。
- 13 份存储字段决定是 L 节的输入，在 A1 评审里逐份重审，不删：`store-once-review`、`report-storage-fields`、`participation-field-review`、`config-hash-field-review`、`input-identity`、`paper-run-storage-decision` 等。
- 24 份用户规则仍然有约束力，保留。
- `doctor/` 下 51 份记录里，29 份已经没有未结行，按 `record.md` 可以由用户删除。
- `doctor/index.zh.md` 里随新账本解决的未结行：20261105-03（它说的判断随旧账本删除）、20261107-111 由 L3 解决、20261107-113 由第 8 节 P5 决定、20261022-14 由关线时同步备份（refactor-coverage U2）解决。20261107-121 不会随新账本消失：Live 门槛归执行路径 R2。实施时更新这些行。
- 实施：#2566 删了 33 份计划文档和 19 份 doctor 记录（另有 6 份存疑保留，理由见该 PR）；#2681 按上面更新索引，再删 12 份 doctor 记录。2026-11-13 经用户授权（瘦身审计 20261113-151），又删了 19 份决定已在设计站的用户规则副本和 6 份对象已被 gen-1 删除或反转的存储评审（含 `config-hash-field-review`）。

## 7. 顺序

| 阶段 | 内容 | 依赖新账本 | 授权 |
|---|---|---|---|
| 0 | 用户就第 8 节作决定 | — | — |
| 1 | 现在就能做的纯删除和重构：M1–M5（M4 优先）、D1–D4、C11 中的死夹具、IDE 死代码、计划文档和 doctor 记录清理 | 否 | D1/D2 要只读登服务器确认；删文档由用户定 |
| 2 | 新 schema 设计稿（逐表逐列：消费者、对应的现存事实、为什么不能推导）+ 独立子代理评审 + L8 的 Dolt 2.7.2 探针 | — | A1 |
| 3 | 一组破坏性 PR：L1–L11、C1–C10、N1–N3，加上执行路径重规划的 R1 运行契约；发新运行镜像 | 是 | A1、B1–B4、B7、B8；R1 自己的授权项 |
| 4 | skills、评测（每个评分器单独 PR）、IDE、设计站跟上；README、`deploy/` 文档 | 是 | 跟随第 3 阶段 |
| 5 | 用户执行 `ledger init --kind active` | — | 用户亲自执行 |

- 第 3 阶段按"一个原因一个 PR"拆，全部基于 `main`，不叠 PR。
- 涉及 `engine/` 的改动发新镜像。行为应该不变的部分先跑 `engine/README.md` 里的成对原生回放，再声称一致。
- 测试、演示只写隔离库。
- 第 3 阶段合入以后，在隔离库里走一遍完整研究流程（起线、登记、预检、回放、封存、报告、判断、验证登记、见证），作为开张前的验收；同时跑 L11 的规模测试。

### 服务器过渡（2026-11-11 用户定）

本段写于合入还是发布的时候。#2657（3e210729c）之后合入不再是发布：主机只部署 `v0.2.0` 及以后的版本 tag，`main` 的构建只到 `main-ready`（预发布，主机不读），打 tag 每次由用户决定（`CHANGELOG.md`、`deploy/remote/README.md`）。破坏性 PR 已在 #2672 一次合入；服务器的切换随用户打下一个版本 tag 发生，下面"集中合"的做法是当时的记录。

当时：研究账本或 Paper 库的 schema 一变，服务器上读旧库的部分就会因 schema 不匹配而拒绝工作：
- IDE 读公开 DoltHub 的旧账本副本；
- Paper 用服务器上旧 schema 的 `paper` 库；
- Live 只在预检、准备、复核时从研究账本读候选，运行本身不读账本。

用户选择"破坏性 PR 集中合"：
- 改变研究账本或 Paper 库 schema 的 PR 做完、测好以后，先开成草稿，在 PR 上写明暂缓合入，不合。
- 不改 schema 的 PR 照常合入。
- 验收（上一条的完整研究流程）在这些草稿合在一起的状态上跑。
- 用户执行 `ledger init --kind active` 的前后，一次合入这些草稿，把服务器停摆的时间压到一天以内。
  - 合入之前，用户先停掉服务器上在跑的 Paper。
  - 开张时服务器的切换（新建 `paper` 库、IDE 改读新的公开副本）要用户另给一次服务器操作授权。
- 草稿开着期间，它们与 `main` 和彼此的冲突，由实施方反复变基解决。

估计减量（实施时以 diff 为准）：

| 部分 | 约减 |
|---|---|
| Python 产品代码 | 1,000–1,300 行 |
| 测试 | 600 行以上 |
| 部署 | 250 行以上 |
| 计划文档和 doctor 记录 | 数千行 |
| 设计站 | 演练叙述那一块最大 |
| 账本 schema | 4 张表、10 个视图、一套迁移机制 |

新增：`research_line`、`line_close`、`research_registration`、`registration_grid_point`、`source_review`、`comparison_design`、`trial_instrument`、`trial_capture` 这几张表，内容由现有的 JSON 搬入；真正新增的列只有 `sealed_seq` 一个。

## 8. 要用户决定或授权的事

### A 存储字段

- **A1** 新 schema 整体按 AGENTS.md 的存储字段规则处理：一份逐列评审稿，由独立子代理评审，记录在 `docs/plans/`，然后由用户逐项授权。
  - 13 份旧的字段决定在这份评审里重审；
  - 其中为兼容做的妥协可以撤销。

### B 拒绝或审计检查

- **B1** 删除拒绝码 `LEDGER_UPGRADE_REQUIRED` 和 `ledger upgrade`（L9）。
- **B2** `dolt_tests` 第 1、2、4、7 条改写成表约束，第 6 条随 L6 改写；`ledger review` 为复制字段做的读数核对随 L3、L4 缩小，Paper 豁免随 L5 删除。
- **B3** 跨契约复现只比共有字段改为要求完全相等（C10）；去掉旧 v7 源码表（C3）。
- **B4** `run_cycle.realized_pnl` 改为 NOT NULL（L4）。
- **B7** 读数可替换（L10）：AGENTS.md 的"封存时算一次"改为"产品封存命令凭指纹重封替换"；写账号对读数表加 UPDATE。
- **B8** `ledger review` 的行变更检查缩小到承诺层，并改为只查上次检查之后的新提交（L10）。

### P 产品决定

- **P1** Paper 记录完全离开研究账本，本机和远程都用独立的 Paper 库（L5）。
- **P2** 删掉操作员用的 Live 命令行路径，Live 只剩 Web 控制（D5）。
- **P3** 命令改名：N4 的四组。
- **P4** 模板名单是保留现状，还是改成"用户准入、Agent 提名"。
- **P5** 以后 schema 怎么变：只能重建账本（现状），还是加入迁移（未结项 20261107-113）。建议按 L10 分层：承诺层只做追加式迁移，读数层可重建。
- **P6** 删除约 37 份没有用的计划文档和 29 份没有未结行的 doctor 记录，以及设计站的演练叙述。都可以从 git 恢复。
- **P7** [固定开发期与关线历史回测](line-close-history-test-20261110.zh.md)第 6 节的 P1–P5、B5、B6 和 A2。

### 已定

- 2026-11-10，用户先授权 B7 和 B8（原话"授权"），随后"全部授权"本节其余各项。凡是给了推荐或建议的项，按推荐或建议执行；没有给推荐的项，按下面的解读执行：
  - **A1**：新 schema 按 L1–L11 预先授权。逐列评审稿和独立子代理评审仍按 AGENTS.md 照做，并记录在 `docs/plans/`。评审中出现计划以外的存储字段，单独再问。
  - **B1–B4、B7、B8**：照本节所列执行。
  - **P1**：Paper 记录离开研究账本。
  - **P2**：删掉操作员用的 Live 命令行路径。
  - **P3**：N4 的四组命令改名，新名字在实施 PR 里给出。
  - **P4**：模板名单改为"模板由用户准入、Agent 带证据提名"。本项没有给推荐，按计划里列出的瘦身方向解读。
  - **P5**：按 L10 分层迁移。
  - **P6**：删除所列计划文档、doctor 记录和设计站的演练叙述。
  - **P7**：见[固定开发期与关线历史回测](line-close-history-test-20261110.zh.md)第 6 节的"已定"。
  - 授权的是方向，实施按第 7 节分阶段、一个原因一个 PR。
  - 不在授权范围内：新账本的 `ledger init --kind active` 仍由用户亲自执行；执行路径重规划自己的授权项另算。

### 时间

新账本 `ledger init --kind active` 在第 3 阶段和执行路径 R1 都合入之后，由用户执行。

## 9. 未核实

- L8 的各项 Dolt 行为，以及 Dolt 能否按表授予 UPDATE（L10）；
- `realized_pnl` 现在是否总有值；
- `backtest.ts:36` 的空值除法；
- 评测能否共用评分器；
- 服务器上旧容器是否都已不在；
- skills 改写的实际省量。

以上实施前逐项用探针或只读检查确认。
