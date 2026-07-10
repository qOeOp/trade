# Artifact Domain

## 输入

- `data/` and `tmp/` roots
- catalog DB path
- artifact roots and retention windows
- produced R&D / replay / feature reports

## 输出

- data catalog records
- stale artifact reports
- optional explicit GC deletion result
- feature report artifact refs

## 负责

- catalog indexing and queries
- artifact retention / `.pin` / referrer semantics
- feature-report caching and registration
- preventing runtime data from piling up in source directories

## 禁止

- 策略判断
- Binance writes
- 删除 pinned / referenced / durable assets
- 把 scratch data 提升为 strategy evidence

