# 固定报价快照的备份增量同步与恢复核验

2026-10-25。执行 Git `81f41991dbcafb508037a53e643c6f7a14095a22`，开始前已同步远程 main；本次文档另从最新 main 建分支。按用户确认，通过现有 CLI 更新市场备份，再只读复制到 `/tmp` 并用原生 Dolt 2.4.2 恢复。

**固定市场提交 `53tgna1pa02hb1t9v6r3h6pqh8d2e1s1` 的备份同步与恢复核验通过，旧备份点仍可读。此前“缺报价表创建和 12 次月度报价导入”的备份覆盖缺口，在这个固定提交上已有补证；旧全池、外部原件、行情与强平适用性缺口不因此关闭。** 不外推后续新提交或任意其他备份。

## 同步固定提交，不重新导入

| 项目 | 本次读数 |
| --- | --- |
| 唯一备份写入口 | `uv run --frozen python -m cli.main market backup --market /Users/vx/.local/share/trade/ledgers/market.json` |
| 原备份点 | `l1kfbo4b2of54ijpjnpn02ijdm175aqd`，同步前确认为固定提交的祖先 |
| 固定提交／CLI 返回的新头 | `53tgna1pa02hb1t9v6r3h6pqh8d2e1s1`，两者完全相同 |
| 原生同步 | 产品既有导入锁、分叉保护及同步后备份头检查；退出 0，约 133.799 秒 |
| 备份目标 | `/Users/vx/.local/share/trade/dolt-backups/market/backup`，本次按授权实际更新 |
| 文件变化 | 从 13 份／1,180,460,310 字节到 19 份／6,908,687,693 字节；新增 6 个 `.darc`，原有内容只变更 manifest，0 文件删除 |

没有直接调用管理员 SQL 写入，没有 import／import-quotes、重导入、注册、数据发布、gc、修复、prune 或强制覆盖。更新的是备份目标，不是活动市场提交或行；不能将本次写成“原备份未变”。同步前旧备份与此前保留的完整副本哈希一致，旧副本及其 118 份核验材料在本次结束时仍逐份 SHA-256 匹配。

## 独立复制与原生恢复

更新后的 19 份备份复制到 `/tmp/trade-market-quote-backup-sync/updated-backup-copy/`，逐份 SHA-256 与来源一致、inode 不同，不使用硬链接；复制期间及核验结束时再次确认来源文件集、大小、mtime 和完整哈希稳定。

仅对副本执行原生 `dolt backup restore`，目标为本目录 `restored/market_restored`，不带 `--force`，配置隔离在本目录的 `DOLT_ROOT_PATH` 下。恢复退出 0，约 35.316 秒；`dolt fsck --quiet` 退出 0，约 155.380 秒，`No problems found.`。仅 main、无标签、工作区干净，HEAD／STAGED／WORKING 根一致，fsck 后身份再次核对不变。没有启动临时 SQL 服务。

## 内容身份与报价核对

| 核对项 | 结果 |
| --- | --- |
| 完整版本化数据库根 | `h68vp3p0vupe9eqr7v3tqoqchmmqq0e9`，与固定源提交相同 |
| 完整 quote 表原生哈希 | `e4rgdkbub049lfop8oj1r07ugr7mj635`，与固定源提交相同 |
| quote | 467,914,411 行 |
| bar／funding／instrument | 47,062,075／51,779／30 行 |
| market_schema／universe_month | 1／477 行；v_universe 为 477 行视图，不重复计存储 |
| schema／规则 | version 2、`usdt-perp-listed30d-v1`、import_seq 22，未改规则 |
| 独立边界样本 | 2025-10 至 2026-09，12 个月各取最前 3 条与最后 3 条，共 72 条，逐字段完全一致 |

样本核对 symbol、毫秒 ts、agg_trade_id、缩放整数 bid／ask，无数值容差。72 条是月边界样本，不冒充全部报价的独立逐行算法复算；全部存储身份由原生数据库根、完整报价表哈希和 fsck 共同核对。没有重新计算推算报价、替换来源或新增接收延迟模型。

恢复历史有 37 个可达提交：原 24 个全部保留，新增 13 个为 1 个报价表创建和 2025-10 至 2026-09 共 12 次 BTCUSDT 月度报价导入。既有 22 次基础行情导入不变。此结果覆盖此前报告遗漏的报价备份增量，不等于验证真实盘口或报价规则的普遍适用性。

## 旧点仍可读，其他缺口保留

- 在新恢复库直接读旧 `l1kfbo4b2of54ijpjnpn02ijdm175aqd`，根仍为 `b677jc5c67gbne2k66pda1bnvp3kioav`，与前次原生恢复完全一致；全部 477 条成员关系逐项相同。旧点仍没有 quote 表，没有把新报价追写到旧提交。
- 原 24 个可达提交集合全部保留；此前保留副本和 118 份核验材料哈希未变，没有删除或改写旧封存与旧核验结果。
- 旧全池 `ebg4rg1g7pmtlj8vfk6tu8hdlql4gbkr` 与更早 `4aubs5q0t3r48200rb048c7ovlj0frlc` 的原生 AS OF 仍退出 1、`target commit not found`。当前工程市场备份同步不会自动找回旧全池，不认定旧全池恢复通过。
- 本次没有恢复旧 RD10 研究库、完整生命周期包或来源原件；未验证 62 份外部 ZIP 的备份恢复。旧导入 readings 原始凭证、旧参考原件哈希、五月参考源断连、T/E 时间口径、其他合约／时段／敞口适用性及真实结算价／算法输入缺口继续保留。

## 状态保持与验证范围

活动市场起止均为固定 `53tgna…`，HEAD／WORKING 根及完整 quote 表哈希未变，工作区干净。活动研究账本起止均为 `odeo1h7mc6e429dohb6qrjt6vd89eusi`，最大试验 211，工作区干净；只以 reader 查询，没有新增研究记录。

执行 Git 起止相同且干净。本次 main 已合入 rc7，按既有锁文件运行 CLI；没有编辑依赖或产品，没有策略 replay，不宣称新旧引擎行为一致。首次帮助调用的 `--market` 位置错误由 USAGE_ERROR 拒绝、not_written；按帮助确认后执行正确备份命令，未改检查。原生命令已结束，没有后台临时服务。

所有工作副本在 `/tmp/trade-market-quote-backup-sync/`：固定身份、CLI 命令／退出记录、同步前后文件差异与指纹、独立复制与恢复回执、根和报价表哈希、72 条样本、旧点原生读数、fsck 与终了状态均保留。168 份工作文件有交付指纹；原始材料、脚本、逐项回执及数据库文件不进 Git，本文只记工程发现。临时副本不是新增永久备份设施；本次文档同步未再次更新备份或执行恢复。
