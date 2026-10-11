# 新研究账本启用记录（2026-10-11）

WS2 把研究记录层重写为有类型的 Dolt 账本（设计见[重构计划](rd-round-audit-refactor-plan.zh.md) WS2 第 11 条，字段见[字段评审](ws2-ledger-field-review.zh.md)）。本文记录新库的启用状态，以及之前各轮研究留下的暴露事实。

## 新库

| 项 | 值 |
|---|---|
| 档案 | `research`，角色 `active`，文件 `~/.local/share/trade/ledgers/research.json` |
| 服务目录 | `~/.local/share/trade/dolt`，Dolt 2.4.2，unix socket `~/.local/share/trade/dolt/mysql.sock`，回环端口 13330 |
| 数据库 | `research`；`main` 只有 schema 第 1 代，启用时的提交为 `9qdb1do1n3p4948teqsmmfqj8i6occnr` |
| 账号 | `research_writer`（只能插入；`ledger_head` 可更新；只能执行 `dolt_commit` 这一个存储过程；分支控制只允许写当前开着的一轮）和 `research_reader`（只读）；轮次管理和备份用服务的 root |
| 备份 | `dolt_backup sync` 到 `~/.local/share/trade/dolt-backups/research`，启用当时已同步一次 |
| 外部见证 | 冻结和确认计划的提交向 DigiCert（失败再试 Sectigo）申请 RFC 3161 时间戳，凭证存在 `witness` 表 |

新库是空的，没有导入旧账本的任何记录。新一轮从 `round open --goal` 开始。

## 旧服务

旧账本服务（`127.0.0.1:13326`，数据在 `~/.local/share/trade/records`）已于 2026-10-11 停止，命令是 main 上旧 CLI 的 `ledger stop`；数据没有改动，也没有删除。旧账本及其全部副本、`ledger-archives/`、旧封存和备份、`~/.local/share/trade/research/` 都留给 WS7 统一删除。之前为外部见证创建的 GitHub 仓库 `qOeOp/trade-ledger-witness` 没有被使用（改为 RFC 3161 时间戳），是否删除由用户决定。

## 暴露声明（供下一个 goal 的 `known_exposure` 引用）

两轮旧研究不导入新库，只留下面这一句声明：

> 截至 2026-10-11，RONNIE-NATIVE-RD-20261010 和 RONNIE-RESTART-20261011 两轮（以及 2026-10-09 之前的各轮）都在 R1 一年 Catalog 上做过原生回放和结果查看：37 个 USDT 永续，2025-10-07 00:00 UTC 至 2026-10-07 08:30 UTC，可交易窗口从 2025-10-17 开始。这一区间的全部数据对任何新 goal 都是已暴露的开发数据，只能用于探索和证伪，不能作为确认；两轮的经济结论都是失败（RONNIE-RESTART-20261011 的两次经济读数毛收益均为负）。

数据来源：旧账本活动提交 `870q3p8c7jqu3sqchovbv4vpossidi7i`，以及重构计划第 0 节和 WS1 验收记录中的读数；WS7 删除旧数据之后，以本文的文字为准。
