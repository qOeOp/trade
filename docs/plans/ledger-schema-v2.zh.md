# 研究账本模式第 2 代：逐列取舍与重建

2026-10-21。依据 origin/main 95672ebd3。

授权：用户审计正式账本后，授权修掉审计列出的存储问题，并加只读视图。随后用户又定：不做迁移。旧研究数据备份后丢弃，正式 `research` 账本以第 2 代模式同名从零重建。

用户的原话是：跑出来的数据是为了发现问题、迭代产品，测试数据不能反过来影响产品设计。所以下面每一项只依据产品语义和代码里真实的读者。旧数据只当作发现问题的线索，不当作保留或删除某列的理由。

按 AGENTS.md，改存储字段前做了独立审阅：一个只读子代理，没有参与起草，只读代码和测试，不写库。审阅推翻了初稿的三处：B 的方向、E、F。

## 逐项取舍

| 项 | 结论 | 理由（语义与读者） |
|---|---|---|
| A `candidate.runtime_contract` | 列不变 | 这一项原本是把旧库里的旧契约名改掉。重建后不再有旧行，新候选发布时写的就是 `replay-contract@v6`（`ledger/strategies.py`）。这一列有读者：`replay/entry.py` 的 RUNTIME_CONTRACT_MISMATCH 和 `runtime/image.py` 的 `layout()`。 |
| B 周期盈亏 | 保留 `realized_pnl`，删生成列 `price_pnl` | 独立事实是 Nautilus 报告的已实现盈亏：`metrics.cycles` 从原生持仓行读它，`metrics.economics` 拿它和审计的 `reported_realized_pnl_usdt` 对账。价格盈亏只是它加手续费、减资金费，属于推导值。现在改为读时算出：`IF(ts_closed_ns IS NULL, NULL, realized_pnl + commissions - funding)`，常量是 `ledger.metrics.PRICE_PNL`。用到它的地方是 `metrics.load_run` 的 `tables()`、`report/review.py` 的权益桥接。DECIMAL 加减是精确的。审计信号不变：CYCLE_IDENTITY_FAILED 和 AUDIT_ECONOMICS_MISMATCH 都在封存前对内存里的原生周期判断。 |
| C `evidence.byte_length` | 删 | 写入之外没有读者，可以从字节推出。 |
| D `trial.image_digest` 与 `image_ref` | 留 `image_ref`，删生成列 `image_digest` | 拉镜像、解析、复现、导出都要仓库名（`runtime/image.py`、`replay/reproduce.py`、`runtime/container.py`），所以 `image_ref` 是独立事实，摘要可以从它推出。读者改为 `SUBSTRING_INDEX(image_ref, '@', -1) AS image_digest`，常量是 `ledger.db.IMAGE_DIGEST`。 |
| E `run_cycle.closing_order_tag` | 保留 | 它有真实读者：`metrics.load_run` 经 `tables()` 把它交给 Agent；`nautilus-report-analysis` skill 规定出场原因只取自它或 `closing_order_type`，有 4 个评测依赖这条规则。语义上，策略用止损或止盈出场时，平仓单的标签是区分出场原因的唯一依据。 |
| F `run_cycle.closing_order_type` | 保留 VARCHAR(40)，不改 ENUM | 读者是 `report/measures.py`（按出场单类型分盈亏）和 `report/attribution.py`。改成 ENUM 等于新增一道入库拒绝：Nautilus 出现新类型时，整次封存都会失败。读者只按字符串分组，ENUM 给不了它们任何东西。 |
| G NOT NULL | 采用 | `evidence.sha256`（现在是引用列）和 `candidate.source_sha256` 按语义必有值。 |
| H 包名长度 | 采用 | `judgment.line_bundle`、`judgment_subject.registration_bundle` 从 VARCHAR(200) 改为 VARCHAR(160)，和它们外键指向的 `evidence_bundle.bundle` 一致。 |
| I 证据按内容存一份 | 采用 | 新表 `evidence_content(sha256 生成列主键, content)`；`evidence(bundle, path, sha256 → evidence_content)`。同一份字节，例如每次试验的覆盖回执，只存一次。哈希仍由库从字节派生：写方没法把字节配上别的哈希，最多只能引用已经存在的内容。写方只插入库里还没有的内容，只需 INSERT 权限。读字节的 7 处改为 JOIN，入口是 `ledger.evidence.files_from`。导出走 `load_bundle`。审阅指出：writer 有库级 INSERT 权限，可以绕过 `write_files` 插入没人引用的内容行，危害很小；要堵就得加 dolt_tests，那属于新增检查，没有做。 |
| J 只读视图 | 新增 4 个 | 现有命令没有跨研究线的连接：`candidate list` 没有谱系根和深度，`research state` 只按一条线分页。四个视图是 `v_candidate_lineage`（谱系根与深度）、`v_run_history`（每个运行与封存时存下的读数）、`v_judgment_chain`（含已取代判断的取代链）、`v_judgment_subjects`（主体解析到候选与运行）。视图不计算度量：年化、夏普、胜率由报告推导，统计按 `tables()` 读，避免出现第二套实现。 |

## 其余各列

审阅逐列核对了读者、能否推导、信息量。有两处严格说是重复，不在这次范围内，记下留待下次议：

- `trial.instruments` 与开始回执里的 `input_identity.symbols` 是同一事实。`registration/register.py` 比较两者是否相等，`report/status.py` 也读它。
- `run.audit` 的 findings 复制自捕获里的 `audit/audit.json`，读者只用到 `ran`。AGENTS.md 允许存审计结论。

其余各列都有读者，且不能由别的存储推出。

## Dolt 2.4.2 实测

- 生成列可以作主键；视图里可以用递归 CTE；JSON 路径能取带 `@` 的键。
- 对已经存着的长二进制重算 SHA2 会让服务端 panic（`*val.ByteArray, not []uint8`），更新所在行或修改生成列定义都会触发；插入字节时计算则正常。所以 `evidence_content` 只插不改，读回时的哈希核对在 Python 里做。

## 模式代数

- `SCHEMA_VERSION = 2`，`READABLE_VERSIONS = {2}`，新建的账本直接是第 2 代。
- 第 1 代的账本被 SCHEMA_MISMATCH 拒绝，没有升级路径。

## 正式账本重建步骤（等用户确认后执行）

前提：本 PR 已获用户确认，但第 3 步之前还不要把它拉到主 checkout。第 1、2 步必须用第 1 代的代码，也就是合并前的 main（95672ebd3）。第 2 代代码读旧账本会被拒绝。

1. 停掉所有用 `research` 的会话、Codex 线程和回放。
2. 用第 1 代代码做最后一次备份和完整导出，导出放在仓库外。`D` 是一个尚不存在的目录。

   ```bash
   D="$HOME/.local/share/trade/dolt-backups/research-v1-final-$(date +%Y%m%d)"
   uv run --frozen python -m cli.main ledger export --ledger research --kind backup
   uv run --frozen python -m cli.main ledger export --ledger research --kind reproduce --output "$D"
   ```

   - 第一条把全史同步到档案的备份目录。
   - 第二条在 `$D/backup` 写一份全史 dolt_backup，在 `$D/reproduce` 写复现清单、候选源码、运行、判断。
3. 把旧档案和旧备份目录收进存档。新库同名，旧备份留在原处会让以后的同步报 BACKUP_DIVERGED。

   ```bash
   mv ~/.local/share/trade/ledgers/research.json "$D/research.json"
   mv ~/.local/share/trade/dolt-backups/research "$D/profile-backup"
   ```

4. 以服务管理员删掉 `research` 库。只删这一个库：`market` 库不动，服务也不停。root 口令在服务的 `service.json` 里。
5. 把合并后的 main 拉到主 checkout，用 Dolt 2.4.2 同名重建：

   ```bash
   RESEARCH_DOLT_BINARY=<dolt 2.4.2> uv run --frozen python -m cli.main ledger init --name research --kind active \
     --service-root "$HOME/.local/share/trade/dolt" \
     --backup-root "$HOME/.local/share/trade/dolt-backups/research"
   ```

   - `ledger init` 在同一个服务上重新生成 `research_writer` 和 `research_reader` 两个账号及其密码。旧库留下的同名账号和 branch 写权会被替换。
   - 服务端口 13330 和 socket 都不变。
6. 检查新库：

   ```bash
   uv run --frozen python -m cli.main ledger export --ledger research --kind backup
   uv run --frozen python -m cli.main ledger review --ledger research
   uv run --frozen python -m cli.main ledger sql --ledger research "SELECT version FROM ledger_schema"
   ```

   - 期望版本是 2。

7. 之后研究从空账本重新开始。旧数据只在 `$D` 里。需要查旧数据时，把 `$D/backup` 恢复到一个隔离服务，用第 1 代代码去读。
