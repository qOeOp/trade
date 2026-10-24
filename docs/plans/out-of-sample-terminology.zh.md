# 样本外登记与验证流程的英文用词

2026-10-25，用户确认：样本外登记记录用 `out-of-sample registrations`，验证流程用 `out-of-sample validation`；本项只清理文档、失效引用与待定清单，不改表名、命令、实现或检查规则。

## 对照与改动

- `AGENTS.md` 的持久记录清单已使用 `out-of-sample registrations`，`ledger/schema.sql` 的登记与绑定分别为 `validation_registration` 和 `validation_binding`；既有 `validation` 命令涵盖登记与报告。无需改名或迁移。
- 本章与总待定清单仍引用已不存在的 `research/records/README.md`，并拟将记录名称改成 `out-of-sample validations`。移除这条过时待定及失效路径；不重建旧文件。
- 在账本章节 `J.1.1.1` 的既有入账说明后，明确登记记录与验证流程的两种英文用词。中英文待译页面作相同改动，保留既有待译提示；不新增一套术语表。
- 现有悬浮定义的首段与引用关系未变，无需修改索引或图谱；其他待定原样保留。

## 验证

- `npm run check:i18n --prefix docs-site`：47 组双语章节通过。
- `npm run build --prefix docs-site`：通过，日志 `/tmp/trade-validation-terminology-build.log`。
- `npm run check:routes --prefix docs-site`：98 条期望／导出路由通过，94 个本地化页面有导航父级。
- 中英文 4 个静态导出页面核对通过：术语区分在正文可见，旧路径和本项待定已移除，既有锚点及下一项待定保留。双语改动相同；生成索引与图谱和未改动的源文件一致。
- `git diff --check`：通过。
- 没有产品代码变更，未重跑 Python 全量套件，未操作活动账本或市场库。
