# 2026-11-09 Dolt 磁盘回收：GC 与备份保留（-158 余项）

| Item | Value |
|---|---|
| Sessions | 无被审研究会话。用户 11-09 要求服务器不再堆积垃圾、产品自带资源回收；-158 的“备份不剪枝、产品从不调 `dolt_gc`”两项在关行时未处理 |
| Audit session | Claude Code（桌面应用），claude-opus-5-5；worktree `confident-proskuriakova-6fad5e`，分支 `fix/dolt-gc-backup-retention`，本记录所在 PR |
| Checkout / ledger | origin/main 2a962b38e；不读账本 |
| Coverage | 聚焦诊断：`cli/service.py`、`cli/replica.py`、`ledger/admin.py`、`ledger/replica.py`、`deploy/`（remote compose、发布平面）、设计站 J.3.5.1。原生探针用本机 Dolt 2.7.2（与镜像同版本）和产品写出的 config.yaml 同形配置，一次性目录。**未覆盖**：服务器 139.180.214.30 的实际目录大小，只读 SSH 被自动模式以生产读取拒绝；`buffered_file_byte_sink_*` 由哪个操作留下（本机 file:// 克隆、同步、备份都没复现，推测是中断的 DoltHub 流式传输，未证实） |
| Cost | 审计约 40 min；tokens 未测 |
| Net change | 机制 +1（服务重启前清空 `<data>/.dolt/tmp`），配置 +1 行（把 Dolt 默认开着的自动 GC 写明）；拒绝码 +0，skill 词 +0，存储字段 +0。增长理由：这个文件在只有容器看得到的卷里，Agent 删不了也判断不了有没有进程持有（-158 里自动模式拒删，用户手删）；服务启动、Dolt 尚未起来时是唯一确知无人持有的时点 |

## 原生实测（Dolt 2.7.2）

| 问题 | 做法 | 结果 |
|---|---|---|
| 服务会不会自己 GC | 产品同形 config.yaml（`behavior` 只有 `autocommit`），反复覆盖 9,000 行不提交 | 工作区垃圾涨到 155 MB 后自动回收到 3.7 MB，日志 `sqle/auto_gc: Successfully completed auto GC`；`@@dolt_auto_gc_enabled` 为 ON，配置写 `enable: false` 时为 OFF |
| 同步到已有备份会不会因源库 GC 重复存块 | 30 轮“提交 + `DOLT_BACKUP('sync-url')`”，期间源库自动 GC 3 次 | 备份每轮只增约 576 KB（当轮新提交），GC 后不重复；备份只随可达历史增长 |
| 重启或 GC 会不会清 `.dolt/tmp` 下的遗留文件 | 放入 5 MB `buffered_file_byte_sink_*`，重启服务，再 `CALL DOLT_GC()` | 都还在 |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261107-158 | **余项**：“产品从不调 `dolt_gc`”成立，但不等于不 GC：Dolt 1.75 起 sql-server 默认自动 GC，产品写的配置没关，账本与 paper 库已经在被回收（上表）。真正不会自己消失的是 Dolt 中断传输留在 `<data>/.dolt/tmp` 的文件（-158 实测 1.59 GB），重启和 GC 都不清。备份：服务器上没有任何周期写备份的产品步骤（`ledger export --kind backup` 只在手动时跑；`/srv/trade/dolt-backups/deployment-research-20261106` 是 11-06 验收时手动留的修复前原件，见 [验收记录](../remote-paper-production-acceptance.zh.md)），同步到已有备份只增新块，没有可剪而不丢历史的部分。设计站 J.3.5.1 两处写“不运行 DOLT_GC”，与实际不符 | **产品**：`cli/service.py` `_write_config` 无 `auto_gc_behavior`（默认 true）；`start` 重启路径直接 `_launch`，不碰 data 目录；`ledger/admin.py:176` 只在 `export_history` 时同步；`cli/replica.py:39` 给 paper 配 `backups/paper` 但没有调用方定期同步。**消费者**：磁盘（服务器 23G 已用）；`ledger/replica.py:_history` 读 reflog，注释已写明 GC 后只剩最近的移动 | fix：配置写明 `auto_gc_behavior.enable: true`；`start` 在启动 Dolt 前清空 `<data>/.dolt/tmp`；改正设计站三处说法。备份不加剪枝：没有周期写入者，剪已有备份内的块会丢历史；删整个旧备份目录是 AGENTS.md 列出的破坏性写，逐个由用户定 | none（磁盘，一次性 1.59 GB；服务器现状未测） | in PR |

## Removal list

无。

## Decisions

无。服务器上两个旧备份目录（`deployment-research-20261106` 据父会话 701 MB；长期未同步的 `paper`）是否删除，待用户逐项决定；paper 库没有定期备份另属 20261107-114。
