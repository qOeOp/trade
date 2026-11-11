# 新账本 schema 逐列评审稿（2026-11-10）

[新账本重构计划](new-ledger-redesign-20261110.zh.md)第 7 节第 2 阶段的产出，也是第 8 节 A1 要的逐列评审稿。用户已按 L1–L11 预先授权新 schema（2026-11-10"全部授权"）。本文逐表逐列写明三件事：谁读它，它对应现在已经存的哪个事实，为什么不能从别处推导。第 6 节列出计划以外的结构变化、存储字段和检查改动，用户 2026-11-11 已全部按建议定下。

依据：
- `origin/main` `818a5f51b` 的 `ledger/schema.sql`；
- 一份逐列清单：列出每一列和每份 JSON 文档的每个键，带写入方、读者的 `文件:行`，以及它是否是重复或可推导的值；
- 第 8 节的独立评审。

下文的"现状"引用那份清单的结论，代码位置以 `818a5f51b` 为准。

本文只是设计稿，不改代码。实施在第 3 阶段，按一个原因一个 PR。

## 1. Dolt 2.7.2 探针（L8、L10）

在本机临时目录起一个 2.7.2 服务（只监听 127.0.0.1），用四个脚本实测。脚本和原始输出没有进仓库，结果如下。

### 1.1 现有的绕行

| 绕行或问题 | 位置 | 2.7.2 实测 | 处理 |
|---|---|---|---|
| CHECK 写成 `(a) = (b IS NOT NULL)` 会存成无法解析的形式，弄坏整张表 | `ledger/schema.sql:9-10` | 建表后存成 `a = NOT(b IS NULL)`。ALTER 之后、重启服务之后，都仍然拒绝违例行 | 删掉"写成显式 OR"的规定，CHECK 直接写等式 |
| 两个事务把同一行改成完全相同的值，会被静默合并而不是冲突 | `ledger_head.op_id` | 仍然如此：值相同时第二个提交成功；值不同时报序列化冲突 | 保留：每次写入把 `op_id` 设成自己的值 |
| 对没有行的结果取 MAX，返回零行而不是一行 NULL | `ledger/strategies.py:93-95` | 返回一行 NULL | 删掉这条注释和对应的兼容写法 |
| 对存储的 blob 重算 SHA2 会崩溃，所以每次读都在 Python 里重新哈希 | `ledger/evidence.py:182`、`ledger/strategies.py:60` | 10 B、70 KB、5 MB 三种大小：SQL 重算结果等于生成列，也等于 Python 的结果 | 读时的 Python 校验可以保留（便宜），但删掉"SQL 会崩"的说法 |
| EXPLAIN 的数值字段里有字面量 `NULL` | `cli/main.py:292-298` | 仍然有：默认解码器报 `invalid literal for int(): 'NULL'` | 保留解码兼容，注释改成 2.7.2 |
| 克隆一个没有数据的远端，报 `remote at that url contains no Dolt data` | `cli/service.py:61` `EMPTY_COPY` | 文字不变 | 保留，注释改成 2.7.2 |
| 读者账号能执行 `SET PERSIST` | `cli/main.py:52-55` 的首词检查 | 被拒（需要 SUPER） | 首词检查属于纵深防御，保留，注释改成"2.7.2 已拒绝，这里是第二道" |
| tag 的推送和列举 | `ledger/publish.py:12-22` | 未测 | 不用测：关线改成表（L2）以后，产品不再写 tag，`publish.py` 里推送 tag 的逻辑整段删除 |

### 1.2 权限

| 问题 | 2.7.2 实测 | 用在 |
|---|---|---|
| 写账号能不能只对一张表有 UPDATE | 能：`GRANT UPDATE ON db.reading` 之后，该表可以 UPDATE；其他表的 UPDATE、DELETE、`REPLACE`、`ON DUPLICATE KEY UPDATE` 都被拒 | 第 2 节 |
| 能不能只对某几列授予 UPDATE | 不能：`GRANT has not yet implemented column privileges` | 读数单独成表（X1） |
| 只有 SELECT、INSERT 的写账号能不能 `DOLT_COMMIT` | 不能。还要 `EXECUTE ON PROCEDURE dolt_commit` 和一行 `dolt_branch_control`，与现在的 `ledger/db.py:537-544` 相同 | 第 2 节 |
| 写账号能不能在自己的会话里关掉外键检查 | **能**：`SET SESSION foreign_key_checks = 0` 之后，违反外键的行能插入并提交 | 第 5 节 |
| 写账号能不能绕过 CHECK | 不能：没有会话变量能关掉 CHECK | 第 5 节 |
| 写账号设 `sql_mode = ''` 后能不能存一个不在列表里的 ENUM 值 | 不能：报 `Data truncated` | ENUM 不再需要重复的 CHECK |
| 能不能找出关掉检查后插入的违例行 | 能：`CALL DOLT_VERIFY_CONSTRAINTS('--all', '--output-only')` 返回 1，而且不写工作区 | 第 5 节 |

### 1.3 约束

| 设计 | 2.7.2 实测 | 用在 |
|---|---|---|
| 生成列做主键，并被自己表的外键引用 | 能：重复的源码被主键拒，不存在的父哈希被外键拒 | `candidate`（3.4） |
| 生成列加复合外键，保证"每个范围只有一条生效的目标链" | 能：同一范围第二个链头被唯一键拒；跨范围替代被外键拒；同一行被替代两次被唯一键拒 | `line_target`（3.7） |
| CHECK 能不能看到 BEFORE INSERT 触发器写入的服务器时间 | 能：按服务器时间判断，调用方给的时间被覆盖。`retry_of IS NOT NULL OR window_start > created_at` 放行窗口已过的重试 | `validation_registration`（3.17） |
| 可空的复合外键、可空生成列上的外键 | 都生效：有空值时不检查，全有值时按外键检查。`explore` 试验可以用未发布的源码，研究试验不在格点上被拒，同一格点第二个试验被唯一键拒，没有登记的研究试验被 CHECK 拒 | `trial`（3.11） |
| 复合外键的父表上没有对应索引 | 建表被拒：`missing index for foreign key` | 每个复合外键都在父表上建同列序的唯一键 |
| BEFORE UPDATE 触发器里 `SIGNAL` | 生效：改主键被拒，改其他列放行 | `run_reading`（3.15） |
| BEFORE INSERT 触发器从别的表读值 | 能：写账号插入时给的 `sealed_seq` 被触发器从 `ledger_head` 取的值覆盖 | `run.sealed_seq`（3.14） |
| `CHECK (supersedes < id)` | 拒绝自己替代自己 | `judgment`、`line_target` |
| `CHECK (failure_reasons IS NULL OR JSON_TYPE(failure_reasons) = 'ARRAY')` | 拒绝 JSON 的 `null` | `run`（3.14） |
| ENUM、外键、触发器覆盖调用方给的时间 | 都生效 | 各表 |
| `dolt_diff_<表>` 找回某行是在哪个提交里加的 | 能 | 见证改用外键后不再需要（L6） |

还有三条与安全有关的绕行，按计划只改注释、不测：`NO_FILE_IO`、OUTFILE、`branch_control` 转义。设计站里"在 Dolt 2.4.2 上验证"的说法，实施时按上表更新。

## 2. 分层与账号权限（L10）

| 层 | 表 | 写账号 |
|---|---|---|
| 承诺 | `candidate`、`research_line`、`line_close`、`line_target`、`research_registration`、`registration_grid_point`、`comparison_design`、`source_review`、`validation_registration`、`trial`、`trial_instrument`、`trial_capture`、`trial_file`、`run`、`run_return`、`run_cycle`、`judgment`、`judgment_subject`、`witness`、`evidence_bundle`、`evidence`、`evidence_content` | SELECT、INSERT |
| 读数 | `run_reading` | SELECT、INSERT、UPDATE |
| 写入协调 | `ledger_head` | SELECT、UPDATE |
| 版本 | `ledger_schema` | SELECT |

另外两项与现在相同：
- 写账号有 `EXECUTE ON PROCEDURE dolt_commit`；
- `dolt_branch_control` 里有一行，让写账号只能写主分支。

其他规则：
- 整个账号都没有 DELETE（L5 以后，Paper 删除流程不存在了）。
- 读者账号只有 SELECT，不变。
- 整理层先不建表（L10）。
- 没有视图（L7）。

以后的 schema 变化（P5，用户 2026-11-11 「全按建议」定，覆盖清单 U10）：
- 读数层：口径变了，用重封（reseal）重算要看的运行的读数，替换原值；不另存版本。
- 承诺层：只加列，不改、不删已有的列和数据。
- `schema.sql` 开头写的就是这两条，取代原先"以后改 schema 就是新账本"。

已知的限制，与现在相同：
- 写账号的 `DOLT_COMMIT` 仍然接受 `--amend` 和 `--date`（`ledger/db.py:535-536`）。amend 能把一份被替换的读数的旧值从历史里抹掉，也能让一个已见证的提交脱离主分支。
- 所以 `ledger review` 的增量检查（B8）先确认上次检查过的提交仍是主分支头的祖先，否则报告并全量重查。
- 写账号可以关掉外键检查（1.2），第 5 节说怎么查出来。

## 3. 逐表

下面每张表的列表里："读者"写产品代码的消费者；"对应现状"写这一列的事实现在存在哪里；"为什么存"说明为什么不能推导。只为写入去重存在的 `op_id`、触发器写的 `created_at`，在 3.0 统一说明，表里不再重复。

每个复合外键都在父表上建同列序的唯一键（1.3：没有就建不了表）。实施时把这些键列在 schema 里，本文不逐个写。

### 3.0 每次写入的头行，和 `created_at`

每次写入有且只有一个头行，带 `op_id VARCHAR(160) NOT NULL UNIQUE`。`db.write` 按它判断重放：同一操作再来一次时返回已有结果。附属行（如 `trial_instrument`、`registration_grid_point`、试验的证据包）不带 `op_id`。现在为嵌套写入编出来的 `execution_start:…`、`registration_source:…` 不再出现。

| 写入 | 头行 |
|---|---|
| 发布候选 | `candidate` |
| 开线、关线、改目标 | `research_line`、`line_close`、`line_target` |
| 研究登记、验证登记、源码审查、比较设计 | 各自的表 |
| 开始试验 | `trial` |
| 封存捕获 | `trial_capture` |
| 恢复捕获 | `evidence_bundle`（`kind = 'recovery'`） |
| 封存运行 | `run` |
| 重封读数 | `run_reading`（见 3.15） |
| 判断、Agent 证据、生命周期证据 | `judgment`、`evidence_bundle` |
| 见证 | `witness`（主键就能判断重放） |

`created_at DATETIME(6) NOT NULL`：
- 头行都有，由 BEFORE INSERT 触发器写服务器时间。
- 读者：排序；验证窗口必须晚于登记（第 5 节）。
- 为什么存：服务器时间是信任边界，调用方给的值被触发器覆盖（探针确认）。Dolt 提交时间可以由调用方用 `--date` 指定，所以不能代替它。

附属行没有自己的 `created_at`，跟头行同一个提交。

### 3.1 `ledger_schema`（版本）

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `singleton TINYINT PK CHECK = 1` | — | 同 | 单行表的键 |
| `version INT NOT NULL CHECK > 0` | 打开连接时核对（`db._schema_version`）、副本、`ledger init` 的检查 | 同，值为 3 | 代码要知道自己面对的是哪一版。新账本从 1 开始（L9）；`READABLE_VERSIONS` 和 `ledger upgrade` 删除 |

### 3.2 `ledger_head`（写入协调）

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `singleton` | — | 同 | — |
| `seq BIGINT NOT NULL CHECK >= 0` | `run.sealed_seq` 的触发器（3.14） | 同 | 每次写入加 1，是并发写入的冲突点 |
| `op_id VARCHAR(160) NOT NULL` | 无读者 | 同 | 不是事实，是并发机制：探针确认，两个事务写入相同值时 Dolt 静默合并。每次写入把它设成自己的 `op_id`，保证值不同、必然冲突 |

### 3.3 证据：`evidence_bundle`、`evidence`、`evidence_content`

改完以后，证据包只装不透明的文件：捕获的输出、覆盖回执、有效配置、来源原件、生命周期、Agent 自己的证据。研究线、研究登记、源码审查不再是证据包（L2）。

`evidence_bundle`：

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `bundle VARCHAR(160) PK` | `evidence load`、`ledger export`、Agent 引用 | 同 | 包的名字。试验的包名由代码按 `trial-<编号>-<种类>` 生成，CHECK 保证它以 `CONCAT('trial-', trial_id, '-')` 开头；没有读者再从名字里解析编号或种类 |
| `kind ENUM('start','capture','recovery','lifecycle','source','agent') NOT NULL` | 按种类找包，代替名字前缀 | 现在写在名字里，读者用 `LIKE` 解析（第 4 节） | 同一个事实从名字搬到列里，不是新事实（X2） |
| `trial_id INT NULL FK trial` | 找某个试验的启动、捕获、恢复包 | 现在写在名字里 | 同上。CHECK：`kind IN ('start','capture','recovery')` 时必填，否则必须为空。生成列 `one_per_trial AS (IF(kind IN ('start','capture'), kind, NULL))` 加唯一键 (`trial_id`, `one_per_trial`)，保证每个试验最多一个启动包、一个捕获包 |
| `op_id VARCHAR(160) NULL UNIQUE` | 写入重放 | 现在 NOT NULL，嵌套写入用编出来的值 | 只有自成一次写入的包（恢复、生命周期、来源、Agent 证据）才有，附属于别的写入的包为空（3.0） |
| `created_at` | 来源原件和 Agent 证据是什么时候取得的 | 同 | 见 3.0 |

`evidence (bundle, path, sha256)` 和 `evidence_content (sha256 生成列, content)`：与现在相同。内容按哈希只存一次，生成列让写入方无法把字节和别的哈希配对。

### 3.4 `candidate`（L1）

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `source LONGBLOB NOT NULL` | 回放取源码、复现、导出 | 同 | 完整策略源码，AGENTS.md 要求存 |
| `source_sha256 CHAR(64) AS (SHA2(source,256)) STORED PK` | 所有引用 | 现在是 UNIQUE，主键是名字 | 候选的身份只有一个（L1）；生成列可以做主键（探针） |
| `strategy_id VARCHAR(100)`、`revision INT CHECK > 0`，UNIQUE (`strategy_id`, `revision`) | 命令行和报告里的名字 `id@rev` | 同（现在是主键） | 人用的名字。下一个版本号按 `strategy_id` 取最大值加 1 |
| `entry_class VARCHAR(100)` | 回放的入口参数、候选报告 | 同 | 从源码里能找到类，但一个文件可以有多个类，入口是声明 |
| `runtime_contract VARCHAR(40)` | `RUNTIME_UNSUPPORTED` 判断、候选报告；试验的复合外键（3.11） | 同 | 发布时声明源码按哪份运行契约写，回放前就要知道 |
| `description VARCHAR(2000)` | 研究图、状态 | 同 | 声明 |
| `parent_source_sha256 CHAR(64) NULL FK candidate` | 研究图、比较、登记 | 现在是 (`parent_strategy_id`, `parent_revision`) | L1：所有引用都用哈希 |
| `difference VARCHAR(2000) NULL` | 研究图、归因 | 同 | 声明。CHECK：父与改动同时有或同时没有；不能以自己为父 |

### 3.5 `research_line`（L2）

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `line_id INT AUTO_INCREMENT PK` | 所有指向线的外键 | 现在是包名 `research-line-<日期>-<slug>` | 外键要一个键 |
| `name VARCHAR(64) NOT NULL UNIQUE` | 命令行 `--line`、IDE | 包名里的 slug | 人用的名字 |
| `start_source_sha256 CHAR(64) NOT NULL FK candidate` | `research-start`、状态 | `research-line.json` 的 `start` 和 `start_sha256`（后者是前者的副本） | 开线时声明的起点 |
| `market_day DATE NOT NULL` | 这条线里登记的默认市场版本（`cli/main.py:612`） | `market_commit`（N1 改名为市场日） | 开线时固定的数据版本 |
| `universe_rule VARCHAR(60) NOT NULL` | 同上 | 同 | 开线时声明 |
| `dev_start DATE NOT NULL`、`dev_end DATE NOT NULL`，CHECK `dev_start < dev_end` | 回放入口的窗口隔离、关线历史回测、热力图 | `window_start`、`window_end`，由 Agent 选 | 由规则从开线日和当时的市场覆盖算出（[关线历史回测](line-close-history-test-20261110.zh.md) 3.1），但规则以后可能变，而开发期是开线时的承诺（L10），所以存下来，不在读时重算 |

删掉：`format`、`market_database`（市场曾是 Dolt 库的遗留）、`start_sha256`（`start` 的副本）、`note`（只有测试读）。

### 3.6 `line_close`（L2）

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `line_id INT PK FK research_line` | `open_lines`、读命令默认只看开着的线（L11）、热力图 | 现在用 Dolt tag `line/<日期>-<slug>`，判断开没开要逐线查 `dolt_log` 祖先关系 | 关线是一个承诺 |
| `summary TEXT NOT NULL` | 状态、热力图 | tag 的说明文字 | 关线时的结论 |
| `op_id`、`created_at` | 见 3.0 | — | — |

关线只能在该线全部历史试验都有运行之后写（关线计划 3.5），由写入代码检查。关线不再需要管理员账号（现在打 tag 要用，`ledger/lines.py:374`）。

### 3.7 `line_target`（L6）

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `target_id BIGINT AUTO_INCREMENT PK` | 替代链 | 同 | — |
| `line_id INT NULL FK research_line` | `targets_for`、研究图、关线候选资格 | 现在是 `line_bundle`，NULL 表示账本默认 | 用户的两个研究目标作用于哪条线 |
| `scope_key INT AS (COALESCE(line_id, 0)) STORED NOT NULL` | 约束 | 新的生成列 | 显式的默认范围（L6）：0 表示账本默认 |
| `root_scope INT AS (IF(supersedes IS NULL, COALESCE(line_id, 0), NULL)) STORED NULL UNIQUE` | 约束 | 新的生成列 | 每个范围只有一个链头（探针确认） |
| `max_drawdown DECIMAL(7,4)` CHECK (0,1)；`annual_return DECIMAL(7,4)` CHECK > 0 | 同上 | 同 | 用户的目标 |
| `supersedes BIGINT NULL UNIQUE`，CHECK `supersedes < target_id`，复合外键 (`supersedes`, `scope_key`) → (`target_id`, `scope_key`) | 当前生效的是链尾 | 同（现在没有范围一致的约束） | 改目标是追加一行替代旧行；复合外键保证不能跨范围替代（探针确认） |

改完以后"当前生效的目标唯一"由约束保证，`ledger/targets.py:50` 的 `LEDGER_CORRUPT` 兜底删除。

### 3.8 `research_registration`（L2）

研究登记是回放前的预登记：假设、预测、候选与对照、比较设计、执行身份。

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `registration_id INT AUTO_INCREMENT PK` | 外键 | 现在是包名 `registration-…` | — |
| `line_id INT NOT NULL FK research_line` | 线内的试验计数、状态 | 计划文件顶层的 `line`；旧计划没有它，靠推断（C6） | L2：外键不可空 |
| `retry_of INT NULL FK research_registration`，CHECK `retry_of < registration_id` | 重试规则（`registration/register.py:369,528`） | `body.retry_of` | 承诺 |
| `control_trial_id INT NULL FK trial` | 研究图、比较 | `body.control_trial_id` | 承诺 |
| `comparison_design_id INT NULL FK comparison_design` | 比较 | `body.comparison`（可以为空） | 承诺 |
| `image_ref VARCHAR(300) NOT NULL` | 回放要用这个镜像；技术重建的识别比较镜像摘要（`register.py:377`），摘要从它截出 | `execution.image_ref`（`image_digest` 是它的一部分，删） | 登记时承诺的执行身份。复合外键要求每个研究试验与它相同（3.11、X4） |
| `market_day DATE NOT NULL`、`universe_rule VARCHAR(60) NOT NULL`、`lifecycle_bundle VARCHAR(160) NULL FK evidence_bundle`、`export_sha256 CHAR(64) NOT NULL`、`config_sha256 CHAR(64) NOT NULL` | 同上；预检核对（`precheck.py:37-38,190-197`）；技术重建的识别（`register.py:377-383`） | `execution.input_identity`、`execution.effective_config` | 同上。`config_sha256` 的定义见 3.11 |
| `body JSON NOT NULL` | 研究图、归因、比较 | `body` 里的自由文本部分 | 预测和理由是文本，整份读（L2） |

`body` 只留预登记的文字：`prediction.mechanism`、`prediction.interaction`、`prediction.outcomes`、`conditions`、`changed_duties`、`rationale`、`sources`。`outcomes` 和 `conditions` 没有代码读，但它们是看到结果之前写下的话，Agent 和用户用 `ledger sql` 读（X6）。

删掉以下内容：
- `format`、`runtime_ref`、`grid[].params`：没有读者，也不是预登记的文字。
- `execution.runtime_contract`：等于格点候选的契约，复合外键保证候选的契约等于镜像的（3.11）。
- `body.parent`：`_check_grid` 已经要求每个格点候选的父都等于它（`register.py:316-320`），从格点候选推出。
- `body.change`：第一个格点候选的 `difference` 的副本。
- `body.window`：等于线的开发期。
- `body.grid`、`body.prechecks`：改成 3.9 的表。

### 3.9 `registration_grid_point`（L2）

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `registration_id INT FK research_registration`、`source_sha256 CHAR(64) FK candidate`，PK 两者 | 研究试验的复合外键；复核 | `body.grid[].candidate`，加 `registration_attempt` 的行 | 登记时承诺要跑的候选 |
| `source_review_id INT NOT NULL`，复合外键 (`source_review_id`, `source_sha256`) → `source_review` | 登记前必须有通过的审查 | `body.prechecks` | 承诺：用的是哪一份审查。复合外键保证审的是同一份源码，现在只由代码检查（`precheck.py:173-177`） |

`registration_attempt` 删除。试验通过 (`research_registration_id`, `source_sha256`) 的复合外键指到格点，同一对上的唯一键保证每个格点最多一个研究试验（3.11），与现在 `registration_attempt` 的主键和 `GRID_ALREADY_ATTEMPTED` 相同。

### 3.10 `comparison_design` 和 `source_review`（L2）

`comparison_design`：研究登记和验证登记共用。

| 列 | 读者 | 对应现状 |
|---|---|---|
| `design_id INT AUTO_INCREMENT PK` | 外键 | — |
| `method`、`block_days`、`resamples`、`inner_resamples`、`seed`、`alpha`、`minimum_effect`、`design_reason` | `report/comparison.py:352-427,520-560,617-670` | `validation_registration.design` 的 8 个键（`DESIGN_KEYS`），以及研究登记的 `body.comparison` |

每一列都是登记时承诺的比较方法；`design_reason` 只被原样输出（`report/comparison.py:271`），作为方法的理由保留。列类型实施时照 `DESIGN_KEYS` 的校验定。

`source_review`：

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `review_id INT AUTO_INCREMENT PK` | 格点外键 | 现在是包名 `source-review-<试验>-<哈希前 16 位>` | — |
| `trial_id INT NOT NULL`、`source_sha256 CHAR(64) NOT NULL`、生成列 `purpose AS ('precheck')`，复合外键 (`trial_id`, `source_sha256`, `purpose`) → `trial` | 资格判断（`registration/availability.py`）、预检 | `source-review.json` 的 `trial_id`、`source_sha256` | 审的是哪次预检。复合外键保证审的是预检试验、源码就是那次预检的源码；格点再用 (`review_id`, `source_sha256`) 引用它 |
| `verdict ENUM('passed','failed') NOT NULL` | 同上 | 同 | 独立审查的结论。CHECK：`verdict = 'passed'` 当且仅当四项状态都在 `passed`、`no_opportunity` 之内（现在由 `precheck.py:236` 检查） |
| `api_status`、`api_note`、`causal_status`、`causal_note`、`activity_status`、`activity_note`、`readiness_status`、`readiness_note` | 同上、研究图 | 四项审阅，各 {status, note}；状态用 ENUM | 审查内容 |
| `reviewer VARCHAR(100) NOT NULL` | 状态 | `authority` | 谁审的 |

删掉 `image_digest`、`execution_bundle`：都能从 `trial_id` 推出。按 `record_review:` 提交信息匹配审查包的读法（`availability.py:206,223`）随之删除。

### 3.11 `trial`（L3）

一行一次回放尝试，在容器启动前写入。

执行身份各列（`runtime_contract`、`market_day`、`universe_rule`、`lifecycle_bundle`、`export_sha256`、`config_sha256`、`execution`、`starting_balance`、三个时间、`trial_instrument`）都是推导出来的值：
- 来源是镜像检视，和覆盖回执 `input-coverage.json`；
- 这份回执要挂进容器，所以作为启动包的证据文件保留（`replay/entry.py:155-158,197`）。

规则：
- 写入代码从回执的字节算出这些列，不接受调用方给的值。
- 存这些列，是为了让可比性、计数、关线变成 SQL 查询（L3）。

| 列 | 读者 | 对应现状 | 说明 |
|---|---|---|---|
| `trial_id INT AUTO_INCREMENT PK` | 到处 | 同 | — |
| `purpose ENUM('explore','precheck','research','validation','history') NOT NULL` | 到处 | 同，加 `history`（关线计划 A2） | 用途决定计数和资格 |
| `source_sha256 CHAR(64) NOT NULL` | 到处 | 同 | explore 的源码可以不是候选，所以不直接加外键 |
| `candidate_sha256 CHAR(64) AS (IF(purpose = 'explore', NULL, source_sha256)) STORED NULL`，复合外键 (`candidate_sha256`, `runtime_contract`) → `candidate` | 约束 | 新的生成列 | 除 explore 外的源码必须是已发布的候选，契约必须等于候选声明的（dolt_tests 第 1 条和 `RUNTIME_CONTRACT_MISMATCH` 改成外键，探针确认） |
| `line_id INT NULL FK research_line` | 线内计数、隔离、关线 | 现在推断（`ledger/lines.py:244-283`） | 试验指到线（关线计划 3.5）。CHECK：`history` 和 `research` 必填 |
| `research_registration_id INT NULL`，复合外键 (`research_registration_id`, `source_sha256`) → 格点；UNIQUE 同一对 | 研究计数、比较 | `registration_attempt` | CHECK：`(purpose = 'research') = (research_registration_id IS NOT NULL)`（dolt_tests 第 7 条）。唯一键：每个格点最多一个研究试验（探针确认） |
| 复合外键 (`research_registration_id`, `line_id`, `image_ref`, `market_day`, `universe_rule`, `export_sha256`, `config_sha256`) → `research_registration` | 约束 | 现在由代码检查（`register.py:757-786`） | 研究试验必须用登记时承诺的线和执行身份（X4）。`lifecycle_bundle` 可空，单独由写入代码核对 |
| `validation_registration_id INT NULL UNIQUE`，复合外键 (`validation_registration_id`, `source_sha256`, `universe_rule`, `trade_start`, `trade_end`) → 验证登记的 (`registration_id`, `source_sha256`, `universe_rule`, `window_start`, `window_end`) | 验证、见证、比较 | `validation_binding` | CHECK：`(purpose = 'validation') = (validation_registration_id IS NOT NULL)`（dolt_tests 第 2、4 条，探针确认） |
| `image_ref VARCHAR(300) NOT NULL` | 复现、可比性 | 同；开始回执的 `runtime_identity.image_ref` 是副本 | 实际运行的镜像。摘要在读时从它截出 |
| `runtime_contract VARCHAR(40) NOT NULL` | 可比性、状态 | 开始回执 `runtime_identity` | 镜像声明的契约。explore 的源码没有候选，所以存在试验上 |
| `platform VARCHAR(40) NOT NULL`、`build_revision CHAR(40) NULL` | 可比性、复现 | 开始回执 `runtime_identity` | 来自镜像检视。镜像可能被清理，账本要能独立说明它在哪个平台、哪个构建上跑 |
| `market_day DATE NOT NULL`、`universe_rule VARCHAR(60) NOT NULL`、`lifecycle_bundle VARCHAR(160) NULL FK evidence_bundle` | 关线、验证、状态、预检核对、复现（`replay/reproduce.py:56-57,86`） | `input_identity` 的同名键 | 输入身份 |
| `export_sha256 CHAR(64) NOT NULL` | 可比性（`input_key`） | `input_identity.export_content_sha256` | 输入内容的身份 |
| `config_sha256 CHAR(64) NOT NULL` | 可比性改成 SQL 分组；预检核对 | 现在读时从回执重算 `config_key` | 定义见下文。X3 |
| `execution ENUM('bars','quotes') NOT NULL`、`starting_balance DECIMAL(24,8) NOT NULL` | 报告（复利、权益）、可比性 | 有效配置 `account.execution`、`account.starting_balance_usdt` | 每个运行的报告都要读，不再为此解析回执 |
| `input_start`、`trade_start`、`trade_end DATETIME(6)`，CHECK `input_start <= trade_start < trade_end` | 到处 | 同 | 窗口 |
| `runner_argv JSON NOT NULL` | 复现、捕获 | 开始回执 `argv`（捕获清单里还有一份副本） | 容器的参数用的是固定的容器内路径，不含主机路径 |

`config_sha256` 的定义：
- 取今天的 `registration.config_key`，也就是有效配置去掉主机路径、`market_commit`、`universe_sha256` 之后的结果。
- 再去掉预检可以不同的键 `CONFIG_SET_ASIDE`（`start`、`trade_start`、`end`、`symbols`），这四个键已经是本表的列和 `trial_instrument`。
- 对剩下的部分取规范 JSON 的 SHA-256，规范 JSON 由 M4 唯一的写入函数生成。

这样，同一个哈希能回答两个问题：
- 预检的核对（"除了窗口和标的，配置都相同"）；
- 可比性（再加上窗口和标的两列）。

它与引擎的 `effective_config_sha256`（含 `market_commit`，`ledger/problems.py:79-84`）是两回事，实施时起名要区分开，比如 `comparable_config_sha256`。

删掉：
- `instruments` JSON，改成 3.12 的表。
- 开始回执 `execution.json` 整个不再写：
  - 它的 `trial_id`、`purpose`、`source_sha256`、`runtime_identity` 都已经在行里；
  - `workdir`、`mounts` 是主机路径（L3，未结项 20261107-111）；
  - `argv` 进了上表。
- 封存时"工作目录必须等于开始时那个"的核对（`ledger/trials.py:245`、`ledger/execution.py:523`）要换一种做法，见 X12。

索引（L7）：(`purpose`, `source_sha256`)、(`trade_start`, `trade_end`)、`line_id`。

### 3.12 `trial_instrument`

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `trial_id`、`instrument_id VARCHAR(64)`，PK 两者 | 验证核对标的、状态、关线 | `trial.instruments` JSON，以及 `input_identity.symbols`、有效配置 `symbols`、导出回执的键 | 这次回放的标的。与 3.11 的执行身份一样，从回执算出 |

### 3.13 `trial_capture` 和 `trial_file`（L3）

`trial_capture`：一行一个试验，封存或拒绝捕获时写入，是这次写入的头行。

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `trial_id INT PK FK trial` | — | — | — |
| `native_state`、`native_exit_code`、`audit_state`、`audit_exit_code`、`fingerprint_state`、`fingerprint_exit_code` | 状态、预检、资格、复现、失败原因（`ledger/problems.py:242,270,298`） | 捕获清单的 `stages`；`process.json` 里有一份副本 | 各阶段的结束状态，回放不能保证再现 |
| `outcome_kind`、`outcome_detail` | 登记、状态、资格、复现 | 捕获清单的 `outcome` | 同上 |
| `table_hashes JSON NULL` | 跨镜像复现的核对（`registration/reproduction.py:179`） | 捕获清单的 `table_hashes`，只在跨镜像复现的 explore 捕获里有（`replay/reproduce.py:107`） | explore 没有 `run` 行，这些按表的哈希无处可推 |
| `op_id`、`created_at` | 见 3.0 | 现在头行是捕获证据包 | — |

`trial_file`：

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `trial_id`、`path`，PK 两者 | 复现核对、报告的文件列表 | 捕获清单的 `files` | — |
| `status ENUM('captured','captured_empty','hashed','missing','not_started')` | 同上 | 同 | 每个文件的去向 |
| `sha256 CHAR(64) NULL`、`length BIGINT NULL` | 复现时核对重放的原生报告 | 同 | 只存哈希、不存内容的文件只有这里有它的哈希。CHECK：`status = 'hashed'` 时两列必填，否则两列为空（现在读时检查，`ledger/execution.py:227-240`）。captured 的文件，字节和哈希在捕获证据包里 |

不再写的文件：
- 捕获清单 `execution.json` 和 `process.json`：它们重复了试验行和开始回执（清单 §2.5）。
- `fingerprints` 里的 `file_sha256`：与 `trial_file.sha256` 重复，删掉（3.14）。
- 恢复清单里的主机 `workdir`（`ledger/execution.py:592`）：也删。

### 3.14 `run`（L4、L10 的承诺部分）

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `trial_id INT PK FK trial` | 到处 | 同 | — |
| `failure_reasons JSON NULL`，CHECK `failure_reasons IS NULL OR JSON_TYPE(failure_reasons) = 'ARRAY'` | 状态、报告、资格 | 同 | 封存时的观察，其中 `INPUTS_CHANGED`、`CONFIG_MISMATCH` 只在封存时能看到。CHECK 防止 JSON 的 `null` 冒充 SQL 的 NULL（探针确认） |
| `status ENUM('passed','invalid') AS (IF(failure_reasons IS NULL, 'passed', 'invalid')) STORED` | 到处 | 现在是独立列，再用两条 CHECK 保证它与另外两列一致 | 改成生成列，状态与失败原因不可能不一致（X5） |
| `fingerprints JSON NULL`，CHECK `(failure_reasons IS NULL) = (fingerprints IS NOT NULL)` | 复现、审查 | 同 | 原生报告的语义指纹 {表: {rows, sha256}}，是重算读数时证明"同一次运行"的凭据（L10）。去掉 `file_sha256`（与 `trial_file` 重复）；`by_utc_day` 本来就不存（C5 在镜像里删） |
| `sealed_seq BIGINT NOT NULL` | `latest_research`（`ledger/trials.py:324-340`） | 现在对每个运行用 `dolt_diff` 加 `AS OF` 找回插入时的 `ledger_head.seq` | 计划里唯一真正新增的列（L4），已在 A1 中授权。由 BEFORE INSERT 触发器从 `ledger_head.seq` 取值，不接受调用方给的值（探针确认） |
| `op_id`、`created_at` | 见 3.0 | 同 | — |

删掉：`audit` JSON（是捕获的 `audit/audit.json` 的副本；`ran` 等价于 `audit_state`）。

### 3.15 `run_reading`（读数层，L4、L10）

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `trial_id INT PK FK run` | 报告、比较、状态、复核、IDE | `run_sealed` 的键之一 | 每个通过的运行只有一份当前读数。BEFORE UPDATE 触发器用 `SIGNAL` 拒绝改它（探针确认），写账号不能把读数换到别的运行上 |
| `report JSON NOT NULL` | 同上 | `run_sealed.report` | 只能靠回放重算的指标（最大回撤取分钟级 MARK 权益；资金使用；成交占量；订单漏斗；按流动性方向的手续费；局限） |
| `product_commit CHAR(40) NOT NULL` | 重封时比较 | `metrics_revision`（改名，L4） | 是哪一版产品代码算出这份读数 |
| `op_id VARCHAR(160) NULL UNIQUE` | 重封的写入重放 | `run_sealed.op_id`（现在复制 `run.op_id`） | 第一次封存时与 `run` 同一次写入，为空；每次重封是一次独立写入，设成重封自己的 `op_id` |
| `computed_at DATETIME(6) NOT NULL` | 状态 | `run_sealed.created_at` | 由 BEFORE INSERT 和 BEFORE UPDATE 两个触发器写服务器时间 |

`report` 去掉以下内容（L4）：
- `@N` 键后缀。连同 `report/measures.py:46-73` 的 `VERSIONS`、`SEALED_DRAWDOWN` 别名和 `key()` 一起删。
- `catalogue`：它是代码常量，由 `product_commit` 决定。
- 从已存行能推导的数：
  - `populations` 的 `cycles`、`days`、`fills`；
  - `cycles_cover_fills.count`；
  - `account_endpoints_match.rows`；
  - `returns_compound_to_equity.compounded`；
  - `plans_valid`（复核本来就从 `run_cycle.plan_tag` 重算）；
  - `final_equity`：等于 `trial.starting_balance` 乘以日收益连乘。封存时已经检查过两者一致（`returns_compound_to_equity`），读者（`report/review.py:163`、`report/comparison.py:303`、`report/measures.py:116`）改为推导。

重封：
- 只有产品的封存命令重封。重新回放后，新的原生报告要与 `run.fingerprints` 逐项相同，才用当前代码覆盖 `report` 和 `product_commit`。
- 旧值留在 Dolt 历史和公开副本里（L10，B7 已授权）。
- 写账号对整张表有 UPDATE，"只有封存命令重封"是代码约定，数据库挡不住。所以 `ledger review` 检查：每个改动 `run_reading` 已有行的提交，都是重封提交（提交信息和 `op_id`），而且同一提交里没有别的承诺行。

### 3.16 `run_return` 和 `run_cycle`（承诺）

- `run_return (trial_id, ts_event_ns, native_return, mean_gross_notional)`：与现在相同。日收益是配对检验的单位；平均名义敞口在逐分钟敞口不进账本以后，没有别处能算（`report-storage-fields` 的决定）。
- `run_cycle`：与现在相同，只改一处：`realized_pnl DECIMAL(24,8) NOT NULL`（B4）。
  - 现在的封存代码不会写 NULL（`ledger/metrics.py:376,1027`）；对不上账时整份不写周期（`ledger/trials.py:211-213`）。
  - NULL 只出现在 #1637（2026-10-22）之前封存的未平周期里，新账本没有这些行。
  - 随之删除 `report/profit.py:44-60`、`report/measures.py:113-114,454-455` 的补算。
  - `closing_order_tag` 只在 `report/runs.py` 的表格里原样输出，Agent 用它看非计划出场，保留（`report-storage-fields` 的决定）。

### 3.17 `validation_registration`（L1、L6）

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `registration_id INT AUTO_INCREMENT PK` | 试验外键、见证 | 同 | — |
| `source_sha256 CHAR(64) NOT NULL FK candidate` | 同上 | (`strategy_id`, `revision`) | L1 |
| `market_day DATE NOT NULL`、`universe_rule VARCHAR(60) NOT NULL` | 重新推出成员（`registration/validation.py:113`） | `market_commit`（N1）、同 | 登记时承诺的数据版本和成员规则 |
| `window_start`、`window_end DATETIME(6)`，CHECK `window_start < window_end`，CHECK `retry_of IS NOT NULL OR window_start > created_at` | 试验复合外键 | 同；后一条现在是 dolt_tests 第 3 条和 `validation.py:219` | 承诺的样本外窗口。重试发生在窗口结束之后（验证试验要在 `window_end` 之后才能开始，`validation.py:311`），所以只有首次登记要求窗口晚于登记时间（探针确认） |
| `comparison_design_id INT NOT NULL FK comparison_design` | 比较 | `design` JSON | 3.10 |
| `retry_of INT NULL`，CHECK `retry_of < registration_id`，复合外键 (`retry_of`, `source_sha256`, `universe_rule`, `window_start`, `window_end`) → 本表同列 | 重试规则 | 同；"重试保持候选、成员规则和窗口"现在是 dolt_tests 第 5 条和 `validation.py:203` | 探针确认复合外键生效 |

`validation_binding` 删除，改成 `trial.validation_registration_id`。它的 `op_id` 原本就复制 `trial.op_id`。

### 3.18 `judgment`、`judgment_subject`（L6）

`judgment`：

| 列 | 读者 | 对应现状 |
|---|---|---|
| `judgment_id` PK | 外键 | 同 |
| `kind ENUM('recommendation','priority','interpretation','search_exposure') NOT NULL` | 状态、研究图、登记 | VARCHAR 加 CHECK，代码里另有 `KINDS` |
| `line_id INT NOT NULL FK research_line` | 同上 | `line_bundle` 加 `CHECK LIKE 'research-line-%'` |
| `based_on_commit CHAR(32) NOT NULL` | 登记、状态 | 同 |
| `body TEXT NOT NULL` | 状态、研究图 | 同 |
| `supersedes BIGINT NULL UNIQUE`，CHECK `supersedes < judgment_id`，复合外键 (`supersedes`, `line_id`) → (`judgment_id`, `line_id`) | 判断历史 | 同；现在可以跨线替代 |

`judgment_subject (judgment_id, seq, role, source_sha256 | trial_id | research_registration_id)`：
- `role` 改成 ENUM('about','recommended','parent','control')，去掉代码里的 `ROLES`。
- 三种主体各一列，恰好一列有值（CHECK 保留）；`recommended`、`parent`、`control` 必须是候选（CHECK 保留）。
- 候选用哈希（L1），研究登记用外键（原来是包名）。

### 3.19 `witness`（L6）

| 列 | 读者 | 对应现状 | 为什么存 |
|---|---|---|---|
| `commit_hash CHAR(32) PK` | 核验时间戳凭证 | 同 | 凭证盖章的对象就是这个提交 |
| `registration_id INT NOT NULL UNIQUE FK validation_registration` | 验证、复核、比较、状态 | 现在经 `dolt_diff_validation_registration` 找（`ledger/witness.py:116,196`、`cli/main.py:313-316`） | 不再读 diff。它与 `commit_hash` 是否对得上（该提交确实插入了这条登记，且仍在主分支上），由写入代码在盖章前核对，`ledger review` 复查（第 5 节） |
| `token LONGBLOB NOT NULL` | 时间取凭证里的 genTime | 同 | 外部时间证明 |

`op_id` 删除：它就是 `"witness:" + commit_hash`，重放用主键判断。

### 3.20 离开研究账本的表

- `paper_run` 和 `paper-N-capture` 证据包移到 Paper 自己的库（L5，P1 已定）。Paper 库的 schema 不在本文，随 L5 的 PR 给出。
- `registration_attempt`、`validation_binding`、`run_sealed`：合并进别的表（见上）。
- 全部 10 个视图（L7）。

## 4. 按名字前缀读 JSON 的地方都消失

| 现在 | 改成 |
|---|---|
| `ledger/lines.py:70` `research-line-%` | `research_line` |
| `ledger/lines.py:77` `dolt_tags LIKE 'line/%'` 加祖先查询 | `line_close` |
| `registration/register.py:519` `registration-%` | `research_registration.retry_of` |
| `registration/register.py:562` `trial-%-recovery%` | `evidence_bundle (kind = 'recovery', trial_id)` |
| `registration/precheck.py:216`、`registration/availability.py:219,223` `source-review-%` | `source_review` |
| `registration/availability.py:206` 提交信息 `record_review:%` | `source_review` |
| `report/status.py:44,71` `trial-%` 的 `execution.json`、`input-coverage.json` | `trial`、`trial_capture` 的列 |
| `ledger/admin.py:261` `registration-%` | `research_registration` |
| `ledger/execution.py:417` `trial-N-recovery-%` | `evidence_bundle (kind, trial_id)` |
| `report/graph.py:338` `source-review-%` 或 `research-line-%` 的 `created_at` | 两张表的 `created_at` |

## 5. dolt_tests 改成表约束（B2）

| dolt_tests | 改成 |
|---|---|
| 1 研究和验证试验的源码已发布 | `trial.candidate_sha256` 生成列加外键（3.11） |
| 2 验证试验都有绑定 | `trial` 的 CHECK `(purpose = 'validation') = (validation_registration_id IS NOT NULL)` |
| 3 首次验证登记的窗口晚于登记 | `validation_registration` 的 CHECK（3.17） |
| 4 验证运行与登记的候选、成员规则和窗口一致 | `trial` 到 `validation_registration` 的复合外键 |
| 5 重试保持候选、成员规则和窗口 | `validation_registration` 的复合自外键 |
| 6 见证盖章的是插入验证登记的提交 | `witness.registration_id` 外键，加写入核对和 `ledger review` 复查 |
| 7 研究试验都有登记 | `trial` 的 CHECK，加到格点的复合外键 |

CHECK、ENUM、主键和唯一键，写账号绕不过去（1.2）。外键不一样：写账号可以在自己的会话里关掉外键检查，再写入违例的行（1.2，探针确认）。所以：
- 外键挡住的是产品代码的错误，不是信任边界本身；
- `ledger review` 对新提交跑 `CALL DOLT_VERIFY_CONSTRAINTS('--all', '--output-only')`，有违例就报告。探针确认它能找出这样插入的行，而且不写工作区。

`commit` 组的 dolt_tests 整个删除，`product_commit_tests`、`COMMIT_TEST_COLUMNS`、副本和 `ledger init` 对它的核对一起删。

`ledger review` 的承诺层检查（B8），只查上次检查之后的新提交，共五项：
1. 上次检查过的提交仍是主分支头的祖先（第 2 节，`--amend`）；
2. 承诺层有没有行被改或删；
3. 约束验证（上面那条）；
4. `run_reading` 的改动都是重封提交（3.15）；
5. 见证的提交与登记对得上，且在主分支上。

## 6. 计划之外的变化（用户已定）

A1 的授权写明：评审中出现计划以外的存储字段，单独再问。改动拒绝或检查也要用户授权。下面是本稿相对 L1–L11 的全部偏离，每项都给出建议。

| 编号 | 变化 | 为什么 | 建议 |
|---|---|---|---|
| X1 | 读数不并进 `run`，单独成表 `run_reading` | L4 说并进 `run`，L10 说读数可替换、写账号对读数有 UPDATE。探针显示 Dolt 不支持列级授权：并进 `run` 就得对整张 `run` 授予 UPDATE，承诺列也能被改了 | 采用。两张表一对一，事实数不变 |
| X2 | `evidence_bundle` 加 `kind` 和 `trial_id` 两列 | 现在这两个事实编码在包名里，读者用 `LIKE` 解析（第 4 节）。搬到列里，名字只作标签，CHECK 保证两者不矛盾 | 采用 |
| X3 | `trial` 和 `research_registration` 的 `config_sha256` 是可推导的值 | 它是证据文件里有效配置去掉窗口和标的之后的哈希，按规则不该存。L3 要把可比性变成 SQL 分组，预检核对也要比较"除窗口和标的外的配置"，就需要一列可比较的值。另一种做法是把约 30 个配置项全部拆成列，更差 | 采用。写入时由代码从回执重算，不接受调用方给的值 |
| X4 | 研究登记和研究试验都存执行身份，并用复合外键要求两者相同 | 登记存的是"承诺用什么跑"，试验存的是"实际用什么跑"，是两个事实。今天两边都存（计划 JSON 和开始回执），由代码比较（`register.py:757-786`） | 采用。把一条代码检查改成数据库约束，拒绝条件不变 |
| X5 | `run.status` 改成生成列 | 它能从 `failure_reasons` 推出；现在靠两条 CHECK 保证一致 | 采用 |
| X6 | 研究登记的 `prediction.outcomes` 和 `conditions` 保留在 `body` 里 | 没有代码读，只做格式校验。但它们是预登记的文字：看到结果之前写下"每种结果说明什么""结论适用于哪里" | 保留。删掉的只有 `grid[].params`、`runtime_ref` 这两项既没人读、也不是预登记文字的内容 |
| X7 | （撤回）已通过运行的 stdout、stderr 只存哈希 | 计划 L11 留给本评审决定。评审指出：没有证据表明回放能逐字节再生成这两份日志（多半带时间和随机编号）；如果不能，存下的哈希永远无法核对，也没有读者 | 不改，照旧存内容 |
| X8 | `trial.runner_argv` 从开始回执搬到试验行 | 开始回执整个不再写，`argv` 是唯一还有读者（复现）的字段 | 采用 |
| X9 | 不再写开始回执 `execution.json`、捕获清单 `execution.json`、`process.json`，恢复清单去掉主机 `workdir` | 它们的内容全部是行里的副本、主机路径，或已搬进 `trial_capture`、`trial_file` | 采用 |
| X10 | 删掉 `research_line.note`、`input_identity.exporter_source_sha256`、覆盖回执的 `scope` | 没有产品读者（清单 §6）；`exporter_source_sha256` 已被 `export_content_sha256` 覆盖 | 采用 |
| X11 | 捕获文件的去向单独成表 `trial_file` | L3 原来说在 `evidence` 上加一个状态列。但只存哈希的文件没有内容，放不进按内容寻址的 `evidence`；`missing`、`not_started` 的文件连哈希都没有 | 采用 |
| X12 | 封存时"工作目录必须是开始时那个"的核对换一种做法 | 开始回执不再存主机路径，就没法比较路径。改为：开始时在工作目录里写一个标记文件，记下试验编号和开始写入的 `op_id`；封存时核对这个文件。拒绝的代码和含义不变（捕获必须来自为这个试验开始的工作目录），但检查方式变了，所以要用户授权 | 采用 |

### 已定

2026-11-11，用户对本节"全按建议"：

- X1–X6、X8–X12 按"建议"一栏采用。其中 X6 是保留，不是删除。
- X7 撤回：已通过运行的 stdout、stderr 照旧存内容。
- X4 和 X12 改了检查的做法，拒绝条件和含义不变，这次一并授权。

第 3 阶段按本稿实施。实施中如果再出现本稿以外的存储字段或检查改动，仍单独问用户。

## 7. 实施时要核对的事

- `research_line.market_day` 的读者只剩"登记的默认市场"（`cli/main.py:612`）。如果实施时发现它只服务于被删掉的线归属推断，就删掉这一列。
- `comparison_design` 各列的类型，照 `registration/validation.py` 对 `DESIGN_KEYS` 的校验定。
- 读者账号能不能调用 `DOLT_VERIFY_CONSTRAINTS('--output-only')`；不能的话，`ledger review` 用管理员连接跑这一项。
- 第 3 阶段合入以后跑 L11 的规模测试：约 2 万个 trial、1,000 条线，给读命令计时，定上限。

## 8. 独立评审（2026-11-10）

一个全新的只读子代理，拿到本稿初版、`ledger/schema.sql`、逐列清单、探针脚本和输出、此前各份字段决定，没有拿到本稿作者的结论。它按"读者、独立事实、为什么现有字段或推导不能表达"逐列审查。下表是它的意见和处理，上文各节已经按"处理"改过。

| 意见 | 处理 |
|---|---|
| H1 `window_start > created_at` 会拒绝所有验证重试：重试保持原窗口，而且发生在窗口结束之后 | 采纳，CHECK 改为放行重试，探针确认（3.17） |
| H2 每个格点最多一个研究试验，从数据库约束退回到代码检查，属于放松检查，又没列进第 6 节 | 采纳，`trial` 上加 (`research_registration_id`, `source_sha256`) 唯一键，探针确认（3.11） |
| H3 验证重试的复合自外键漏了 `universe_rule` | 采纳，加进去；验证试验到登记的外键也加（3.11、3.17） |
| H4 跨镜像复现读的 `table_hashes` 被删掉了，explore 没有 `run` 行，无处可推 | 采纳，`trial_capture.table_hashes`（3.13） |
| H5 研究登记丢了 `lifecycle_bundle`（预检核对、复现要用）和完整配置（预检按"除窗口和标的外"比较，单个哈希答不了） | 采纳：登记和试验都加 `lifecycle_bundle`；`config_sha256` 重新定义为去掉窗口和标的之后的哈希，窗口和标的本来就是列（3.8、3.11） |
| H6 "只存这一处"不对：覆盖回执作为证据保留，执行身份各列都是它的副本 | 采纳，3.11 改为说明这些列是推导值，写入时从回执字节算出 |
| H7 权限没写 `EXECUTE dolt_commit` 和分支控制；`--amend` 能抹掉读数的旧值和见证的提交；`run_reading` 的 UPDATE 能改主键 | 采纳：第 2 节补全；增量检查先查祖先关系；`SIGNAL` 触发器禁止改主键（探针确认）；review 检查读数改动都在重封提交里 |
| H8 写账号可能关掉外键检查，"七条都由约束挡住"没有根据 | 探针确认能关。第 5 节改写，`ledger review` 跑约束验证（探针确认能查出）；ENUM 在非严格模式下仍拒绝，不用重复的 CHECK |
| M1 登记的父候选是格点候选父的副本 | 采纳，删掉，从格点推出 |
| M2 研究试验的 `line_id` 与登记的没有约束 | 采纳，加进 X4 的复合外键 |
| M3 封存捕获和恢复捕获的写入头行没定；`run_reading.op_id` 第一次封存时复制 `run.op_id` | 采纳，3.0 列出每次写入的头行；`trial_capture` 有 `op_id`；`run_reading.op_id` 只在重封时有值 |
| M4 `trial_file` 和工作目录核对的改法是计划外的变化，没列出 | 采纳，X11、X12 |
| M5 缺的约束：`trial_file` 的状态与哈希；审查必须是预检、格点引用的审查必须审同一份源码；审查结论与四项一致；判断不能跨线替代；`supersedes < id`；试验契约等于候选契约 | 全部采纳，探针确认可行的写法（3.9、3.10、3.11、3.13、3.18） |
| M6 复合外键要父表上有索引 | 探针确认没有就建不了表，3 节开头写明 |
| M7 `sealed_seq` 由写入方给 | 采纳，触发器取值，探针确认 |
| M8 读数里的 `final_equity` 是副本 | 采纳，改为从起始资金和日收益推导（3.15） |
| 第 1 节的约束类结论不在探针脚本里；"重启后仍能读""ALTER 后仍生效"没测到 | 补了第二到第四个脚本；重启服务、ALTER 之后都重新插入了违例行，仍被拒 |
| X2 包名与列重复 | 名字只作标签，CHECK 防止矛盾，加每试验唯一的启动包、捕获包 |
| X3 要与引擎的 `effective_config_sha256` 区分名字 | 采纳 |
| X5 JSON `null` 能冒充 SQL NULL | 采纳，加 CHECK，探针确认 |
| X6 `conditions` 也是预登记文字 | 采纳，保留 |
| X7 日志不一定能逐字节再生成 | 采纳，撤回 X7 |
| X9 恢复清单里还有主机 `workdir` | 采纳，删 |

评审标为未验证的五项，处理如下：
- 已验证，结果在第 1 节：外键检查能否关掉；非严格模式下的 ENUM；触发器里的 `SIGNAL`；父表索引。
- 已处理：日志能否逐字节再生成，撤回 X7，不再依赖它。
- 未逐项复核：逐列清单的 `文件:行`，评审抽查了约 20 处，都对得上。实施时每个 PR 按自己改到的读者重新核对。
