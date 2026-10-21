# 研究账本模式第 2 代：逐列审阅与迁移

2026-10-21。依据 origin/main 95672ebd3。

授权：用户只读审计了正式账本（档案 `research`）后明确授权两件事：一是把 `candidate.runtime_contract` 的旧值批量改名；二是修掉审计发现的全部存储问题（A–I），另加只读视图（J）。正式库的迁移要等本 PR 合并、用户暂停正在写库的 Codex 线程之后再做，届时还要用户再确认一次。

按 AGENTS.md，改账本存什么之前要先做独立审阅。审阅由一个只读子代理完成，它没有参与起草，只读代码和测试，不写库。审阅推翻了起草稿里的三处（B 的方向、E、F），下面按审阅后的结论记。

## 审计时的账本

数据来自正式账本，经 reader 账号只读读取。

- 264 个证据包，975 个文件，共 28.7 MB；按哈希去重后剩 802 份内容，25.4 MB。
- 33 个候选，其中 32 个的 `runtime_contract` 还是旧名 `r1-native-v6`。
- 89 个试验，28 个运行（全部 passed）。
- 600 个周期：`closing_order_type` 全是 MARKET，`closing_order_tag` 全是 NULL，每行都满足 `price_pnl = realized_pnl + commissions - funding`。
- 92 条判断，553 个判断主体。

## 逐项结论

| 项 | 结论 | 理由（读者与独立事实） |
|---|---|---|
| A `candidate.runtime_contract` 改名 | 采用：迁移时把 32 行 `r1-native-v6` 改为 `replay-contract@v6` | 读者是 `replay/entry.py` 的 RUNTIME_CONTRACT_MISMATCH 和 `runtime/image.py` 的 `layout()`。不改名，旧候选就不能在新镜像上回放。证据字节里记的契约名（开始回执的 `effective_config.runtime_contract`）是原始观察，有哈希保护，不改。 |
| B 周期盈亏 | 修订：保留 `realized_pnl`，删掉生成列 `price_pnl` | 起草稿原本要删 `realized_pnl`，审阅指出方向反了。独立事实是 Nautilus 报告的已实现盈亏：`metrics.cycles` 从原生持仓行读它，`metrics.economics` 拿它和审计的 `reported_realized_pnl_usdt` 对账。v1 的 `price_pnl` 只是由它推出的生成列。读者里用 realized 的更多（`report/measures.py`、`report/attribution.py`），用 price 的较少（`report/review.py` 的权益桥接、`measures`、`runs`）。现在价格盈亏改为读时按 `IF(ts_closed_ns IS NULL, NULL, realized_pnl + commissions - funding)` 读出（`ledger.metrics.PRICE_PNL`），DECIMAL(24,8) 的加减是精确的。审计信号没有变：CYCLE_IDENTITY_FAILED 和 AUDIT_ECONOMICS_MISMATCH 都在封存前、对内存里的原生周期做。 |
| C `evidence.byte_length` | 采用：删 | 除了写入，只有 `v_evidence` 和一个测试读它。 |
| D `trial.image_digest` / `image_ref` | 采用：留 `image_ref`，删生成列 `image_digest` | 拉镜像、解析、复现和导出都要用到仓库名（`runtime/image.py`、`replay/reproduce.py`、`runtime/container.py`），所以 `image_ref` 是独立事实，摘要可以从它推出。读者改为 `SUBSTRING_INDEX(image_ref, '@', -1) AS image_digest`（`ledger.db.IMAGE_DIGEST`）。这个写法在第 1 代的提交上也能读，所以 `qualification/availability.py` 对旧提交的 AS OF 读法照常可用。 |
| E `run_cycle.closing_order_tag` | 不采用：保留 | 审阅指出它有读者：`metrics.load_run` 把它经 `tables()` 交给 Agent；`nautilus-report-analysis` skill 规定出场原因只能取自 `closing_order_tag` 或 `closing_order_type`，有 4 个评测依赖它。现在全是 NULL，只是因为现有策略都用市价单出场。一旦用止损、止盈（bracket/OCO）出场，这个标签是区分出场原因的唯一依据。 |
| F `run_cycle.closing_order_type` | 不采用：保留 VARCHAR(40)，不改 ENUM | 改成 ENUM 等于新增一道入库拒绝：遇到未知类型，整个封存事务失败，几小时的回放白跑。按 AGENTS.md，收紧拒绝要另有授权。读者只按字符串分组，用不到 ENUM。顺带核对过：nautilus_trader 2.0.0rc3 的 OrderType 有 9 个名字。 |
| G 改 NOT NULL | 采用 | `evidence.sha256`（现在是引用列）和 `candidate.source_sha256` 改为 NOT NULL。`trial.image_digest` 已按 D 删掉。 |
| H 包名长度 | 采用 | `judgment.line_bundle`、`judgment_subject.registration_bundle` 从 VARCHAR(200) 改为 VARCHAR(160)，和 `evidence_bundle.bundle` 一致。外键保证现存值都不超过 160。 |
| I 证据按内容去重 | 采用 | 新表 `evidence_content(sha256 生成列主键, content)`，`evidence(bundle, path, sha256 → evidence_content)`。哈希仍由库从字节派生：写方没法把字节配上别的哈希，最多只能引用一份已经存在的内容。写方只插入库里还没有的内容（只需 INSERT 权限）。读字节的 7 处改为 JOIN（`ledger.evidence.files_from`）。导出走 `load_bundle`；dolt_backup 与表结构无关，不用改。审阅指出：writer 有库级 INSERT 权限，可以绕过 `write_files` 插入不被引用的内容行，危害很小。要堵就得加一条 dolt_tests，那属于新增检查，没做。 |
| J 只读视图 | 部分采用 | 新增 `v_candidate_lineage`（谱系根与深度）、`v_judgment_chain`（含已取代判断的取代链）、`v_judgment_subjects`（主体解析到候选与运行）、`v_run_history`。现有命令没有这些跨研究线的连接：`candidate list` 没有根和深度，`research state` 只按一条线分页。审阅反对在视图里重算复利，`v_run_history` 因此只取封存时存下的读数（最大回撤、期末权益、周期数），不算任何度量，也不汇总周期。统计仍按 `tables()` 读。 |

## 其余各列

审阅逐列核对了读者、能否推导、信息量。下面两处严格说是重复，但都不在用户授权的 A–I 范围内，这次不动，只记下来：

- `trial.instruments` 与开始回执里的 `input_identity.symbols` 是同一事实。`registration/register.py` 正在比较两者是否相等，`report/status.py` 也读它。作为可直接查询的身份列，有它在比去解析回执方便。
- `run.audit` 的 findings 复制自捕获里的 `audit/audit.json`，读者只用到其中的 `ran`。AGENTS.md 允许存审计结论；要不要只留结论，可以下次议。

其余各表各列都有读者，且不能由其他存储推出，没有问题。

## Dolt 2.4.2 实测

- 生成列可以作主键，视图里可以用递归 CTE，JSON 路径能取带 `@` 的键。
- 对已经存着的长二进制重算 SHA2 会让服务端 panic（`*val.ByteArray, not []uint8`）。UPDATE 一行 candidate（候选源码约 10 KB 以上）或 MODIFY 它的生成列都会触发；插入字节时计算则正常。所以迁移不改 candidate 的行，而是重建这张表：逐行重新插入，父版本在前，别的表指向它的外键先摘下、重建后再挂上。哈希核对一律在 Python 里做。
- 带外键的列不能直接 MODIFY 类型，要先摘外键，改完再挂回。

## 迁移（`ledger migrate`）

由服务管理员执行，见 `ledger/migrate.py`：

1. 该库账号还有其他会话就拒绝（MIGRATION_BUSY），工作集不干净也拒绝。
2. 先把全史同步到 dolt_backup。
3. 在 Python 里读出全部记录并核对哈希。
4. 在工作集里改表，改完再读一遍，逐行比对。
5. `ledger_head` 必须恰好前进一步，否则说明期间有别的写入。
6. 以上都通过，才做一次 `DOLT_COMMIT`（schema:2，提交校验照常运行）。任何一步失败都执行 `DOLT_RESET --hard` 加 `DOLT_CLEAN`，不留下任何提交。

迁移是幂等的：已经是第 2 代的库原样返回。新建的库直接建成第 2 代。

`READABLE_VERSIONS = {2}`：用 `--at` 指向迁移前的提交会得到 SCHEMA_MISMATCH。这符合用户定的“重构期不兼容旧数据”，旧版本要用当时的代码去读。

## 演练

演练对象是正式账本 dolt_backup 的一份恢复副本：放在 /tmp 的隔离服务里，库名 `rehearsal`，头提交 k123u4cp，和正式账本头一致。正式服务没有被碰过。

步骤是：先用 origin/main 的 v1 代码取一份快照，跑 `ledger migrate`，再用 v2 代码取一份快照，逐项对比。

| | 迁移前（v1 代码） | 迁移后（v2 代码） |
|---|---|---|
| 行数 | 证据包 264、文件 975、候选 33、试验 89、运行 28、封存 28、日收益 10220、周期 600、判断 92、主体 553、登记尝试 28 | 完全相同 |
| 28 个运行的派生度量（`derive_measures` 全量）与周期 | 逐运行哈希 | 完全相同 |
| 264 个包的逐文件哈希（`load_bundle` 重算） | — | 完全相同 |
| 证据存储 | 975 个文件，28,749,836 字节 | 802 份内容，25,356,372 字节，省 3,393,464 字节 |
| 候选契约名 | 32 个 r1-native-v6 | 全部 replay-contract@v6 |
| 耗时 | — | 3.4 秒 |
| `ledger review` | ok，没有发现 | 1697 条 ROW_CHANGED（candidate 32、evidence 975、trial 89、run_cycle 600、ledger_schema 1） |

## 待用户决定：`ledger review` 的 ROW_CHANGED

`report/review.py` 把每张表 `dolt_diff_<表>` 里任何不是 added 的行都报为篡改，例外只有 `ledger_head`。迁移本身就会改行：改名、删列、重建证据表。所以迁移之后，`ledger review` 会一直报这 1697 条。

要消掉它们就得改这道审计检查，例如把恰好一次、由 `ledger_schema` 从 1 变到 2 的那个提交的改动单独列出、单独核对。AGENTS.md 把放宽审计检查列为必须由用户明确授权的事，而这次的授权（修存储问题）不包括它，所以本 PR 没有改。

正式库迁移之前需要用户在下面两条里选一条：

1. 授权改 review，按上面的思路识别那一个迁移提交；
2. 接受迁移后 review 一直报这些发现。

## 已知限制

旧镜像里声明的契约名仍是 `r1-native-v6`，所以用旧运行自己的镜像去复现它，仍会被 `layout()` 拒绝。这是 #1627 定下的“不认别名”，改它需要另外授权。

改名之后，旧候选可以在新镜像上做新的回放。不过新运行和旧运行镜像摘要不同，按设计本来就不可比。

## 正式库迁移步骤（等用户确认后执行）

1. 本 PR 合并，上面那条 review 决定已经落实。
2. 用户暂停所有写 `research` 的 Codex 线程和回放。
3. 在主 checkout 上 `git pull`，然后运行：
   `uv run --frozen python -m cli.main ledger migrate --ledger research`
   命令会先把全史同步到 `~/.local/share/trade/dolt-backups/research/backup`，并在返回里给出 `previous_commit`。
4. 核对迁移结果：
   - 运行 `ledger review`；
   - 运行 `research status`；
   - 运行 `ledger sql "SELECT * FROM v_run_history"`；
   - 运行 `ledger export --kind backup`，把迁移提交同步进备份。

回滚方法有两种：

1. 迁移失败时什么都不会提交，不需要回滚。
2. 迁移已经提交后要撤回，有两条路：
   - 由服务管理员执行 `CALL DOLT_RESET('--hard', '<previous_commit>')`，把研究 branch 退回迁移前的提交；
   - 从第 3 步同步的 dolt_backup 恢复整库。

   两条路都是改写已发布的历史，需要用户授权。退回之后，代码也要回到第 1 代。
