# Storage Architecture

本文件是 Mermaid 顶层架构和代码实现之间的存储落地表。权威机器可检版本见 [architecture-manifest.json](architecture-manifest.json)；库表 DDL 见 [storage-schema/](storage-schema/)。

## 当前原则

- 一个事实源，一个 owner，一个写入口。
- 物理库可以少，logical store 必须先分清。
- 跨 store 不做强外键，只传 `event_key / artifact_ref / manifest_ref / strategy_ref / logical-store-ref`。
- Durable fact 只进入数据库；大 payload 若存在，只能作为 `tmp/` 工作区材料，并由 DB 记录 summary/ref/hash。
- `scripts/check-architecture-manifest.ts` 会校验 manifest、目录、rail schema 和 SQL 表名一致。

## Local Data Plane

`data/` 只允许数据库文件。它是本机 durable state 平面，不承载目录型 payload、raw archive 或 research memory 文件。

| 层 | 当前落点 | 责任 |
| --- | --- | --- |
| SQLite logical stores | `data/*.db` | 唯一 durable 存储方式：事实、ledger、owner write contract、refs、hash、summary |
| ephemeral payloads | `tmp/artifacts/`, `tmp/panels/`, `tmp/market/` | 可再生工作区产物；不是 durable storage，需 DB ref 才能被长期解释 |

判断口径：SQLite logical store 是唯一事实边界。OHLCV canonical candles 由 `ohlcv_store` 增量 upsert，market metadata / funding / feature refs 由 `market_data_store` 持久化，RD memory 由 `research_state_store` 持久化；跨域只传 logical-store ref，不传本机目录所有权。

## Logical Stores

| Store | 状态 | Owner | 当前 / 目标物理落点 | 说明 |
| --- | --- | --- | --- | --- |
| `trade_event_store` | implemented | `portfolio-execution-state/event-store` | `data/trade.db.plan_event` | 钱的事件真相；append-only |
| `flow_read_models` | implemented-derived | `portfolio-execution-state/flow-projector` | memory；可选 cache table | 从 `plan_event` 重建，不是事实源 |
| `market_data_store` | implemented | `market-data-products/market-data-store` | `data/market_data.db` | market manifests / funding / feature manifests；`calibration-market-features --market-data-db` 同步 funding events 与 feature refs |
| `ohlcv_store` | implemented | `market-data-products/market-data-store` | `data/ohlcv.db` | canonical candles；`ohlcv-fetch --ohlcv-db` 按 latest candle 增量抓取并 upsert 多标的 / 多周期 OHLCV |
| `exchange_runtime_store` | implemented | `exchange-gateway/exchange-runtime-store` | `data/exchange_runtime.db` | 交易所 command/result/idempotency ledger；Binance 写工具与 `execution-router` 默认接入；真钱事实仍回写 `trade_event_store` |
| `artifact_catalog` | implemented | `artifact-knowledge/artifact-catalog` | `data/data_catalog.db` | artifact/dataset/evidence/report 索引，不存大 payload |
| `research_state_store` | implemented | `research-strategy-development/research-control-plane/state-store` | `data/rd_state.db` | RD program memory + Research Control Plane facts + Draft Strategy registry |
| `governance_ledger` | implemented | `governance-review-compliance/governance-ledger` | `data/governance.db` | evidence、promotion、closed-flow review 的独立 ledger |
| `policy_registry` | implemented | `policy-risk/policy-registry` | `data/policy_registry.db` | runtime policy snapshot 与 approved strategy refs |
| `ops_runtime_store` | implemented | `orchestration-ops/ops-runtime-store` | `data/ops_runtime.db` | cycle/job/health/notify/domain_message observability；`summary` 读口派生 stage/domain/attention 聚合；domain-bus 只存 envelope/ref，不参与交易真相 |

`market_data_store` 的 owner 读口已覆盖 `read_manifest`、`read_funding`、`read_feature_manifest`、`list_feature_manifests`；`ohlcv_store` 的 owner 读口覆盖 `read_latest_candle` 与 `read_candles`。后续 R&D / governance 迁移消费 candles、funding 或 feature refs 时，应优先走 owner CLI / protocol ref，而不是跨域直读 SQL 表。

`calibration-market-features --market-data-db` 会在 calibration suite input 的 dataset 上同时保留旧 `indicator_report_path` 与新 `market_data_db / funding_events_ref / feature_manifest_ref`。当前 benchmark input、data hash 与 panel diagnostics 已识别这些 refs；实际 funding 数值读取仍兼容旧 JSON report，后续可在不改输入契约的前提下切换到 owner 读口。

## Implementation Rule

当前 logical store 均已有 owner / DDL / init-check 路径。后续若新增 `planned` store，`planned` 不表示“不需要做”，而是表示顶层已决定需要独立 owner 和 DDL，但运行时代码还未接入该物理库。实现任一 planned store 时必须：

1. 先以对应 `docs/storage-schema/*.sql` 为 migration 起点。
2. owner module 提供唯一 `ensureSchema/init` 入口。
3. 外部模块只能通过 protocol ref 或 owner CLI / contract 使用，不直接写表。
4. 把 [architecture-manifest.json](architecture-manifest.json) 对应 store 状态从 `planned` 更新为 `implemented` 或 `implemented-derived`。
5. 增加 owner module check，并让 `scripts/quality-check.sh` 通过。
