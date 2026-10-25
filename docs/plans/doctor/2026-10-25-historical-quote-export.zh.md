# 2026-10-25 旧市场提交的 bars 导出

| Item | Value |
|---|---|
| Sessions | Codex local，研究会话 `01a16f63-bdeb-7af3-b4c8-a9a557e46116`；2026-10-25 |
| Audit session | 聚焦诊断，沿当前导出调用到消费者；不是会话整体审计 |
| Checkout / ledger | `a501d7c86` 复现，交付基线 `b367113d0`；活动账本 `digabm8fnl2uepd15c86i43ersd340id` 未写 |
| Coverage | `market.export.quote_rows`、固定提交的实际导出、隔离升级/导出测试与原生装载；未覆盖完整市场来源验收 |
| Cost | 原生导出在 SQL 1146 停止；未创建活动 trial，未测总工时或节省量 |
| Invalid trials caused by the product | 0 |
| Findings by action | fix 1；不新增字段、表或命令 |

## Findings

| id | Finding | Evidence and consumer | Action | Status |
|---|---|---|---|---|
| 20261025-01 | 新导出器对旧市场提交无条件读取 quote 表，阻止 bars 回放 | 固定提交 `l1kfbo4b2of54ijpjnpn02ijdm175aqd` 的原生导出报 MySQL 1146 `table not found: quote`；`SHOW TABLES AS OF` 在该提交返回空。原 LAST/MARK 覆盖完整，故这是导出器历史快照读取问题，不能解释成策略失败或新市场数据缺失 | fix：在固定提交中没有 quote 表时导出零 quote；其他 SQL 错误继续传播；quotes 执行由原装载检查要求真实 quote 数据 | open，交付及后续会话验证记于索引 |

## Removal list

| Mechanism | Proposal |
|---|---|
| 每次导出无条件读 quote | 改为按同一固定提交查表，再决定是否读取，保留已有 quote 时的全部数据 |
| 旧快照被迫改用新市场提交或升级 | 无需执行；当前 market 数据及历史提交不改 |
| 新存储事实、宽泛 SQL 异常吞掉或合成 quote | 不添加；现有快照 schema 已能表达没有 quote 表 |

## Decisions

用户于本会话回复“迁移吧”，授权研究环境迁移。此修复恢复固定提交的读取，不改变研究窗口、
运行环境、清算规则或 quote 推导规则。隔离测试创建旧快照后升级当前库，再从旧提交导出并经
原生 `read_market` 装载，确认历史身份不会因当前表已存在而错误读取。
