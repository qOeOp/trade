# Runtime Domain

## 输入

- `trade.db`
- trading config
- cron / automation cadence payload
- local event append requests

## 输出

- initialized schema
- `plan_event`
- flow state projection
- automation cycle job plan
- cron lock / log artifacts

## 负责

- local event store and reducers
- runtime policy compilation
- cron lock/log
- automation job planning
- slow / fast track dry-run orchestration

## 禁止

- Binance endpoint details
- strategy promotion policy
- R&D candidate evaluation
- raw market data acquisition

