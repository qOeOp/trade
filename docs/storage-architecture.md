# Storage Architecture

本文件是 Mermaid 顶层架构和代码实现之间的存储落地表。权威机器可检版本见 [architecture-manifest.json](architecture-manifest.json)；库表 DDL 见 [storage-schema/](storage-schema/)。

## 当前原则

- 一个事实源，一个 owner，一个写入口。
- 物理库可以少，logical store 必须先分清。
- 跨 store 不做强外键，只传 `event_key / artifact_ref / manifest_ref / strategy_ref / logical-store-ref`。
- 大 payload 留在文件、parquet 或 artifact；DB 只存索引、ledger、ref、hash、summary。
- `scripts/check-architecture-manifest.ts` 会校验 manifest、目录、rail schema 和 SQL 表名一致。

## Logical Stores

| Store | 状态 | Owner | 当前 / 目标物理落点 | 说明 |
| --- | --- | --- | --- | --- |
| `trade_event_store` | implemented | `portfolio-execution-state/event-store` | `data/trade.db.plan_event` | 钱的事件真相；append-only |
| `flow_read_models` | implemented-derived | `portfolio-execution-state/flow-projector` | memory；可选 cache table | 从 `plan_event` 重建，不是事实源 |
| `market_data_store` | implemented | `market-data-products/market-data-store` | `data/market_data.duckdb` / parquet | raw/canonical/funding/feature manifests；`ohlcv-fetch --market-data-db` 和慢轨盯市默认同步 canonical candles |
| `exchange_runtime_store` | implemented | `exchange-gateway/exchange-runtime-store` | `data/exchange_runtime.db` | 交易所 command/result/idempotency ledger；Binance 写工具与 `execution-router` 默认接入；真钱事实仍回写 `trade_event_store` |
| `artifact_catalog` | implemented | `artifact-knowledge/artifact-catalog` | `data/data_catalog.db` | artifact/dataset/evidence/report 索引，不存大 payload |
| `research_state_store` | implemented | `research-strategy-development/research-state-store` | `data/rd_state.db` | RD program / hypothesis / trial / holdout-use ledger |
| `governance_ledger` | implemented | `governance-review-compliance/governance-ledger` | `data/governance.db` | evidence、promotion、closed-flow review 的独立 ledger |
| `policy_registry` | implemented | `policy-risk/policy-registry` | `data/policy_registry.db` | runtime policy snapshot 与 approved strategy refs |
| `ops_runtime_store` | implemented | `orchestration-ops/ops-runtime-store` | `data/ops_runtime.db` | cycle/job/health/notify/domain_message observability；`summary` 读口派生 stage/domain/attention 聚合；domain-bus 只存 envelope/ref，不参与交易真相 |

## Implementation Rule

当前 logical store 均已有 owner / DDL / init-check 路径。后续若新增 `planned` store，`planned` 不表示“不需要做”，而是表示顶层已决定需要独立 owner 和 DDL，但运行时代码还未接入该物理库。实现任一 planned store 时必须：

1. 先以对应 `docs/storage-schema/*.sql` 为 migration 起点。
2. owner module 提供唯一 `ensureSchema/init` 入口。
3. 外部模块只能通过 protocol ref 或 owner CLI / contract 使用，不直接写表。
4. 把 [architecture-manifest.json](architecture-manifest.json) 对应 store 状态从 `planned` 更新为 `implemented` 或 `implemented-derived`。
5. 增加 owner module check，并让 `scripts/quality-check.sh` 通过。
