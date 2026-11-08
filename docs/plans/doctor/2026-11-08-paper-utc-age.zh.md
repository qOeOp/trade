# 2026-11-08 Paper UTC 运行时长换算

| Item | Value |
|---|---|
| Sessions | Codex 01a1b0a1-c7f5-7381-b08a-36a7084eaca9；用户要求先核实后端UTC计算，再提供全局展示时区 |
| Audit session | focused timezone diagnosis；独立explorer复查Python时间使用，主会话复查SQL和调用方；非整会话审计 |
| Checkout / ledger | origin/main b0f876aaaa4d682bef1fe6f266823ef481d63ac8；无活动账本、账户或凭据访问 |
| Coverage | ledger.schema UTC DATETIME producer → paper listing → Daemon.seal_found → _epoch；尚未声称现服务器采用非UTC环境 |
| Cost | 代码和隔离表达式复现证实错误；实际误恢复次数、生产影响和调查耗时未知 |
| Net change | 修正既有UTC时间解释，不新增配置、存储字段、拒绝、审计或重试机制；原600秒阈值和恢复动作保留 |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261108-02 | Paper 对UTC naive datetime调用timestamp，自动恢复时机依赖服务器本地时区 | `ledger/schema.sql:374` 以UTC_TIMESTAMP写paper_run.created_at DATETIME；`paper/serve.py:430` 按 now−_epoch(created_at)>600判断未收尾运行，`:502` 直接调用naive timestamp。stdlib子进程TZ复现：JST偏移−32400秒、上海−28800秒、纽约夏/冬+14400/+18000秒。只改变子进程TZ，未修改系统时区或运行真实恢复。 | fix | unknown | open |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| DB naive datetime隐式使用宿主时区 | 无独立风险保护；只是默认转换行为 | 数据库已定义UTC_TIMESTAMP，显式附UTC再换epoch | 所有非UTC宿主会错算该年龄 | 为DB datetime补明UTC；已带offset的datetime保留其实际时刻 |

无需通过设置服务器全局TZ或改600秒阈值绕过问题。修正的是既有UTC事实的换算，保留unsealed/ended状态条件、恢复/封存命令、原生checkpoint准入及拒绝规则。缺失/非时间值的现有行为本次不改，避免把额外策略变更混入。

## Decisions

用户2026-11-08明确要求后端时间统一UTC。此实现修复不修改拒绝或审计条件，不操作实际宿主进程、系统时区或Paper运行；测试仅使用隔离环境及mock CLI。发布和生产行为仍需后续正常交付确认。
