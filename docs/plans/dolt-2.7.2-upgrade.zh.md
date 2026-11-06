# Dolt 2.4.2 升到 2.7.2

状态：实施中。2026-11-07 用户要求“如果可以的话项目和部署所有 dolt 都切换到最新版本”。当时最新版是 2.7.2（11-05 发布）。

## 为什么值得升

- **2.6.2 关掉了一个权限漏洞。** 只有 SELECT 的账号原来能 `SET GLOBAL`、`SET PERSIST`，包括关掉账本的提交验证组。现在需要 SUPER，
  reader 和 writer 都做不到。`COMMIT_CHECKS_DISABLED` 仍然保留，因为管理员还能改。
- **2.5.1 修了 `DOLT_BACKUP` 的误报。** 读不到源 root 时，同步和恢复原来会报成功，账本的备份走这条路。
- **2.6.2 缩短了 `dolt_gc` 阻塞并发查询的时间。**

## 版本之间的不兼容说明

| 版本 | 官方说明 | 对账本的影响 |
|---|---|---|
| 2.5.0 | 一个事务可以提交到多个分支 | 账本只有一个研究分支，writer 只有 `main` 的分支权限 |
| 2.6.0 | `dolt_merge()` 对长期分支的合并基准改变 | 账本不合并 |
| 2.7.0 | 合并冲突产物的存储改变，旧版读不了这些产物 | 账本不合并，没有这类产物；回退已实测 |
| 2.7.2 | `CALL` 不再清掉调用方的事务 | 全量测试通过；写入路径的事务不靠旧行为 |

## 实测

都在隔离环境，不碰活动账本，不向 DoltHub 写入。副本由 `ledger mirror` 从公开 DoltHub 克隆，head `ic7kgug8…`，9167 个提交。

| 检查 | 结果 |
|---|---|
| 全量测试（darwin-arm64，2.7.2） | 1034 项，9 项跳过，1 项错误，错误见下 |
| 2.4.2 克隆后换 2.7.2 打开 | head、29 张表的行数、提交数、标签数都相同 |
| `ledger review` | 2.4.2 与 2.7.2 输出的 JSON 完全相同，7 个提交测试 |
| reader 的 `SET GLOBAL`、`SET PERSIST` | 2.7.2 拒绝（1227） |
| reader 的 `LOAD_FILE`、`CALL DOLT_COMMIT` | 拒绝 |
| 2.7.2 提交、`dolt_test_run`、从 DoltHub 抓取、`dolt_gc` | 都成功，7 个测试全过 |
| **回退**：2.7.2 写入并 gc 后再用 2.4.2 打开 | 能读，能提交，`ledger review` 退出 0 |
| **混合状态**：服务 2.4.2，命令行代码与二进制 2.7.2 | `ledger review`、`ledger sql`、`ledger service check` 正常 |

那 1 项错误是 `test_a_switched_off_verification_group_stops_writes_and_connections`。它靠 reader 关掉验证组，这正是 2.6.2 修掉的漏洞。
测试改成：断言 reader 现在被拒绝，再由管理员关掉验证组，后面对 `COMMIT_CHECKS_DISABLED` 的断言不变。检查本身没有放宽或收紧。

**没有测到的：** 向真实 DoltHub 推送。公开账本写入不可撤回，所以只测了从 DoltHub 抓取和向 `file://` 远端推送（测试覆盖）。
第一次真实发布就是验证，失败时账本写入会报告未发布，可以重新发布。

## 改了什么

- `ledger/db.py` 的 `DOLT_VERSION`；`deploy/Dockerfile` 与 `quality.yml` 的下载地址和校验和（取自 GitHub 发布页的 asset digest）。
- 当前版本的说明：`README.md`、`AGENTS.md`、`deploy/README.md`、`ledger/refusals.py`、`cli/main.py`。
- 代码注释和 `docs/rd/` 中写着“2.4.2 实测”的句子保留：它们记录的是当时测到的结果，这次没有逐条重测。

回放不受影响：`engine/runtime/Dockerfile` 不含 Dolt，`deploy/Dockerfile` 也不是运行时镜像工作流的输入，所以运行时 digest 不变。

## 上线顺序

合并后 CI 准入新的 service 镜像，但每台主机的 Dolt 服务都不会自己换。

1. **本机**：运行 `deploy.images` 写入新值，重建 ledger、paper、market-import，再把主机二进制换成 2.7.2。
2. **服务器**：自动发布只换 Web 和 Paper 控制器，新控制器连旧服务已测过（上面的混合状态）。
   Dolt 服务要在 `/etc/trade/remote.env` 写入三个值、更新 `/opt/trade-app` 后单独重建。

回退：`python -m deploy.images --env <文件> --revision <旧提交>`，再重建 ledger。
