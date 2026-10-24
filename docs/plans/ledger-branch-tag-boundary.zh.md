# 研究账本的固定写分支与封盘标签

2026-10-25，用户确认：每个账本保持一个固定研究写分支，默认 `main`，已有名称保留；市场、窗口和研究方向用既有记录区分；沿用已定的封盘标签和最小权限。本次只收敛文档与待定清单，不改变代码、权限、拒绝或审计检查，也不重命名或迁移已有账本分支。

## 对照现有实现

- `ledger/db.py` 的 `LedgerProfile.research_branch` 默认 `main`；`connect` 对 writer 请求分支逐字核对，初始化按既有最小权限配置账号。普通写账号除读取和新增外，还能更新 `ledger_head` 并发守卫行及执行 `dolt_commit`，不授予业务记录改删或分支、标签管理过程执行权。
- 原生 `dolt_branch_control` 使用 `LIKE` 模式匹配，含下划线的既有名称保留其已知同形匹配限制。代码注释与接口文档已经记录此限制；本次没有重做该模式匹配实验，也不将应用层逐字核对描述为数据库层绝对隔离。既有提交改写风险及相应复核仍按原实现处理。
- [10 月 21 日已定的封盘方案](line-close-tags.zh.md)与 `ledger/lines.py` 保持一致：`line close` 是受控管理员入口，给已结束的线创建 `line/<UTC 日期>-<slug>`，封盘点为下一条线诞生提交的父提交，当前线不封。总结是检索目录，账本记录仍是事实来源；管理员可删重建标签，不将标签消息声称为不可改证据。

## 文档改动

- `J.3.3.1` 明确固定分支、研究记录分工、普通账号权限、管理员封盘例外和原生匹配限制，引用已有接口与整体复核，不新增第二套规则。
- 账本连接接口说明区分应用层分支核对与数据库授权；更新中英文待译正文、悬浮定义和对应图谱引用。补齐已有 `ledger.close_line` 文档的悬浮索引，使正文新增引用能定位到现有接口。
- 从本章和总清单移除“账本内 Dolt branch 与 tag 的组织，及写账号的 branch 授权范围”，在本章留下已定边界；其余待定保持原样。

## 验证

- 复用三个既有测试，使用隔离 Dolt 2.4.2 服务：`LedgerBaseTests.test_connect_refusals`、`LedgerBaseTests.test_the_writer_may_only_insert_and_bump_the_head_on_the_research_branch`、`ResearchLineTests.test_an_ended_line_is_closed_once_with_its_summary`，全部通过，无跳过。覆盖产品分支拒绝、普通账号的改删／分支／标签权限拒绝，以及受控封盘、当前线拒绝、重复封盘和按标签读取。日志 `/tmp/trade-ledger-branch-docs-tests.log`。
- `npm run check:i18n --prefix docs-site`：47 组双语章节通过。
- `npm run build --prefix docs-site`：通过，日志 `/tmp/trade-ledger-branch-docs-build.log`。
- `npm run check:routes --prefix docs-site`：98 条期望／导出路由通过，94 个本地化页面有导航父级。
- 中英文导出页面、既有锚点、封盘引用及悬浮索引与源文件一致；本项待定移除，其他待定保留。
- `git diff --check`：通过。本次没有产品代码变更，未重新运行全量 Python 套件；没有操作活动账本或市场库。
