# Market Data Demand Contract

## Owns

- Runtime、active exposure / flow / plan、candidate 与 R&D 向 Market Data owner 提交的有界数据需求。
- Stable demand identity、consumer ref、priority、symbol、product requirement、lease / renewal grace 与 canonical hash。
- 多调用方需求的确定性合并、容量选择、过期 / grace 分类和无生命周期 authority 的 subscription proposal。
- canonical candle owner 与有界 demand worker 共享的 self-hashed OHLCV coverage audit read contract。
- L2、OHLCV 与 indicator 共用的 self-hashed fact ref：精确绑定 demand ids / source plan、owner source/hash、coverage、freshness 和产品 requirement，固定无领域 authority。

## Boundaries

- Demand caller 不能启动、停止、重启或选择 Market Data 进程，也不能声明 endpoint、PID、credential 或文件路径。
- `defensive_exposure` 过期后只进入短 grace 并产生 attention；它不是永久 pin，Market Data owner 仍必须和真实 exposure owner 对账。
- Reconciliation proposal 不证明 coverage / freshness，不写 owner store，不删除 raw，也不授予 trading、Replay 或 execution authority。
- L2、OHLCV 与 indicator 的实际 capacity、readiness、retention 和 release 仍由各自 owner 决定。
