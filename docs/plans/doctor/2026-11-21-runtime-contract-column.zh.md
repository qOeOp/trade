# 2026-11-21 账本存的 `runtime_contract` 两列在一代账本里恒为常量

0.5.0 全量重判 A-87（并入 D-027）与 H-46，见 [重判表](../rejudge-0.5-20261121.zh.md)。

| Item | Value |
|---|---|
| Sessions | 0.5.0 第三波清理 lane 的子 agent（Claude Code，Claude Opus 5.5） |
| Checkout / ledger | `origin/main` `305f7dc54`；未读写活动账本或市场，测试只用临时 Dolt 服务 |
| Cost | none（存了可由代码推出的值；检查只在升级时卡住全部候选） |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261121-41 | 账本 `candidate.runtime_contract`、`trial.runtime_contract` 在一代账本里恒为同一个值（契约变更即开新账本，#3282 只剩一个 `LAYOUT`），却靠唯一键与复合外键撑着三处检查：回放入口 `RUNTIME_CONTRACT_MISMATCH` 比候选列、登记网格 `CONFIG_MISMATCH` 比候选列、Live 准备比候选列 | `ledger/schema.sql` 的两列、`candidate_contract` 唯一键与 trial 复合外键；gen-1 中 candidate 66/66、trial 121/121 都是 v8；`runtime.image.validate_identity` 已拒绝契约不是代码常量的镜像（`RUNTIME_UNSUPPORTED`） | authority（删两列，改三处检查；委托决定） | none | in PR [#3315](https://github.com/qOeOp/trade/pull/3315) |

## 决定

2026-11-21：用户委托：「需要我定的部份最后也是一样由你决定按推荐做」。据此定：

- 第 2 代 schema（#3266，0.5.0 未发布，不升到第 3 代）删 `candidate.runtime_contract`、`trial.runtime_contract`、唯一键 `candidate_contract`，trial 外键只引 `candidate.source_sha256`。删列不是新增字段。
- `RUNTIME_CONTRACT_MISMATCH` 保留，改为镜像契约对代码常量 `RUNTIME_CONTRACT`，在回放入口与试验写入（`ledger.trials.open_trial`，代替删掉的复合外键守住写入边界）两处；登记网格的契约比较（`CONFIG_MISMATCH`）与 Live 准备的契约比较删掉，镜像解析时 `RUNTIME_UNSUPPORTED` 已覆盖。
- 输出里由存储列来的 `runtime_contract`（`candidate publish/list/show`、`research status` 的 `execution_identity`、`research runs` 的 `groups`、`replay report` 的 `runtime`）一并去掉；试验重建的运行身份写代码常量。
- 同一 PR 按 H-46 把运行输入身份里的 `market_database`（市场曾是 Dolt 库的遗留名）改名 `market_name`，与用户 11-05 在 #2112 选的名字一致；当时因账本不重写而放弃，0.5.0 账本从空开始，无迁移。
