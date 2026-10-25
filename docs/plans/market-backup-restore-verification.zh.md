# 市场备份点的原生恢复核验

2026-10-25。执行 Git `6bc1792706d0e04fef657076d63dd5e88de9cfa0`，开始前已同步最新远程 main。活动市场快照为 `53tgna1pa02hb1t9v6r3h6pqh8d2e1s1`；只复制现有市场备份到 `/tmp`，用原生 Dolt 2.4.2 恢复副本。

**这份备份在其自身备份点恢复通过，原生完整性和同提交内容身份核对通过；旧全池提交仍不可读，当前报价增量未覆盖。不认定最新快照或全池恢复通过。** 本项没有更新备份、重导入数据或改变规则。

## 副本与备份点

| 项目 | 本次结果 |
| --- | --- |
| 原备份 | `/Users/vx/.local/share/trade/dolt-backups/market/backup` |
| 文件和字节 | 13 份，1,180,460,310 字节（约 1.18 GB） |
| 副本核对 | 逐文件 SHA-256 相同、inode 不同；恢复后副本 13 份仍匹配，不使用硬链接 |
| 临时恢复 | `/tmp/trade-market-backup-restore-check/restored/market_restored` |
| 原生版本／命令 | Dolt 2.4.2；`dolt backup restore file:///tmp/trade-market-backup-restore-check/backup-copy market_restored`，不带 `--force` |
| 隔离配置 | `DOLT_ROOT_PATH` 指向本次 `/tmp` 下的 home，不改用户或活动服务配置；未启动 sql-server |
| 备份头 | `l1kfbo4b2of54ijpjnpn02ijdm175aqd` |
| 版本化数据库根 | `b677jc5c67gbne2k66pda1bnvp3kioav` |
| 原生恢复与完整性 | 恢复退出 0（约 6.485 秒）；`dolt fsck --quiet` 退出 0（约 24.322 秒），`No problems found.` |
| 分支、标签、状态 | 仅 main、无标签、工作区干净；HEAD／STAGED／WORKING 根相同，检查后身份未变 |

## 恢复内容身份

| 表／视图 | 原生行数 |
| --- | ---: |
| bar | 47,062,075 |
| funding | 51,779 |
| instrument | 30 |
| market_schema | 1 |
| universe_month | 477 |
| v_universe（视图，不重复计存储） | 477 |

schema version 2、规则 `usdt-perp-listed30d-v1`、`import_seq=22`。24 条可达历史中有 22 笔基础月度导入，每笔均为相同的 30 合约工程 allowlist。月度成员为 2025-02 至 2026-10，去重 26 个；当前研究窗 UTC `[2025-10-01, 2026-10-01)` 去重 24 个。首个导入月份和首个成员月份不是同一口径。

使用现有 `market_reader@%` 只读连接，在活动库的 `market/l1kfbo4b2of54ijpjnpn02ijdm175aqd` revision database 确认同一 HEAD，再读原生数据库根；结果与恢复库完全一致。该根覆盖版本化 schema、数据及其他版本化对象，不代表账号配置或外部 ZIP 字节。另核对 schema 行、全部 477 条成员关系及 30 条合约的 symbol／observed_at／classification／terms_source 身份，均逐项一致。

这些核对支持备份点的版本化内容身份；没有重新计算策略指标、实际回放或验证报价、强平、生命周期适用性。

## 旧全池与最新报价仍未恢复

| 提交 | 恢复库原生读取 |
| --- | --- |
| 旧全池 `ebg4rg1g7pmtlj8vfk6tu8hdlql4gbkr` | AS OF 退出 1：`target commit not found` |
| 更早基础全量 `4aubs5q0t3r48200rb048c7ovlj0frlc` | AS OF 退出 1：`target commit not found` |
| 当前报价快照 `53tgna1pa02hb1t9v6r3h6pqh8d2e1s1` | AS OF 退出 1：`target commit not found` |
| 本次备份头 `l1kfbo4b2of54ijpjnpn02ijdm175aqd` | AS OF 可读，正对照通过 |

原生 merge-base 确认备份头是当前市场头的祖先。两者之间 **缺 13 个提交**：

- 1 个 `market tables: quote`，创建报价表；
- 2025-10 至 2026-09 共 **12 次 BTCUSDT 月度报价导入**。

不是 13 次报价导入。`DOLT_DIFF_SUMMARY` 只列新增 quote 表，schema／data 均变化；恢复库没有 quote 表，不能从这份备份读回当前报价快照。原有 bar、funding、instrument、market_schema 和 universe_month 在同一备份点的身份核对通过，不把后续报价缺失解释成原库数据已改。

这份备份不能读回上述旧提交，不证明任意其他离线备份或远端均没有旧全池。完整旧生命周期包和来源原件仍缺，本次未恢复研究备份或补造生命周期材料。原始 ZIP 缓存、Dolt 版本化数据和历史回执是不同材料；此恢复不关闭 62 份 ZIP 的备份恢复缺口、五月断连、T/E 时钟差异或旧参考原件哈希缺口。

## 原件保持与验证边界

- 原备份前后文件集合均为 13 份；每份 SHA-256、字节数、mtime、inode 均未变。副本恢复后重新核对 13 份 SHA-256；不是仅看元数据。
- 活动市场前后头均为 `53tgna1pa02hb1t9v6r3h6pqh8d2e1s1`，main 身份和干净工作集未变；版本化 HEAD／WORKING 根均为 `h68vp3p0vupe9eqr7v3tqoqchmmqq0e9`。
- 活动研究账本前后均为 `odeo1h7mc6e429dohb6qrjt6vd89eusi`，最大试验 211，工作集干净。只用 reader 读取，没有创建、回滚或重写研究记录。
- Git 起止同一提交且干净；原生命令已结束，没有临时服务留在后台。所有新增材料只在 `/tmp`。
- 首次恢复因隔离配置缺作者身份停止且未创建目标库；仅在本次临时 home 配置工程身份后重试成功。失败记录保留，没有使用强制覆盖。
- 原生空集、NULL、JSON、整数和容器的驱动表示差异在临时核对器中规范化后精确比较；固定版本的根哈希按只读 revision database 读取，merge-base 在 main 上读。前置失败均留存，没有改变产品检查或放宽比较要求。
- 未导入、注册、发布、备份同步、gc、修复或 prune；未修改产品、schema、skill、检查或规则，未运行产品测试或策略 replay。此次文档只同步已完成结果，没有重复恢复或更新备份。

工作包在 `/tmp/trade-market-backup-restore-check/`：`summary.json`、`verification-result.json`、原备份前后指纹、副本核对、原生命令／退出记录、逐查询原响应、`fsck`、同提交对照、起止身份和失败日志均保留；118 份工作文件有交付指纹。副本和恢复库是临时工作材料，不是新增永久备份设施。原件、逐项回执、脚本和数据库文件不进 Git，本文只记工程发现。

## 后续固定报价快照备份补齐

[报价备份增量同步与恢复](market-quote-backup-sync-verification.zh.md)随后经现有 CLI 将备份从 `l1kfbo…` 推进至固定 `53tgna…`，独立副本原生恢复、fsck、完整数据库及报价表哈希通过；467,914,411 条报价，72 条边界样本完全一致。旧点根和 477 条成员关系仍相同，原 24 个提交全部保留。此前缺 1 个建表和 12 次报价导入的覆盖缺口只在该固定快照上补齐；旧全池仍不可读，外部原件、生命周期及行情适用性缺口保留，不改写本页先前时点的结论。
