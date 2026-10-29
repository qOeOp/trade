# 零成交复核的经济资格读取修复

对应不可变诊断：[20261029-01 资格读取复发](doctor/2026-10-29-zero-fill-review-qualification.zh.md)。用户于本会话明确回复“授权按原三个条件修复”，授权产品 PR，暂不合并。此前整合评审 P2 拒绝的扩宽仍不实施。

`ledger/review_activity.py` 收拢起线已有判断，`ledger/lines.py` 和 `qualification/availability.py` 共用它。经济资格先完成原有源码、镜像和可见提交筛选，再判断旧 activity 失败是否已解决：

1. api、causal、readiness 全通过，只有 activity failed/unresolved。
2. 旧预检封存 fills 与 positions 都为零；缺失不当零处理。
3. 更晚的同源码预检封存有成交，该预检有 passed 且无 failed 复核。

满足条件的旧复核进入现有 `ignored` 输出并给出原因；其他失败仍否决。原复核、捕获、封存结果不改写，旧 failed 复核仍不可被登记引用。重试仍按登记引用及封存时可见提交决定，后写复核不产生重跑权限。无新字段或拒绝码；不改原生回放、runtime、指标计算及研究目标。

按既有设计契约将检查名递增为 `economic_evidence_v2`；检查器哈希包含 availability 文件和共用政策文件，拼接顺序与零字节分隔符记录在设计页。当前报告与旧报告可按检查身份区分。

## 验证

- 隔离 Dolt 2.4.2 的聚焦回归：`tests.report.test_review_activity` 与 `tests.registration.test_precheck.LineStartTests`，8 个测试通过。覆盖三个条件的正反例、无封存计数、后续零成交、后续也有 failed、不同源码/镜像、先后顺序、封存包与提交范围、原记录保留、旧复核登记拒绝，以及封存报告读取和实际重试资格。
- `uv run --frozen ruff check .`、`uv run --frozen mypy` 通过。
- 文档 `check:i18n`、`build`、`check:routes` 通过：47 个双语章节、98 条导出路由。
- 全套隔离测试结果以本修复 PR 的 Validation 与 CI 为准；命令为 `RESEARCH_DOLT_BINARY=<Dolt 2.4.2> uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'`。

验证仅使用测试自行创建的隔离账本及运行替身；不声称任何真实策略收益或原生行为等价。trial 218 保留为已完成的诊断运行，未重跑，也未在未合并的产品代码下读取其被屏蔽经济值。合并获批后才以新检查身份重读，追加解释，不修改旧解释。
