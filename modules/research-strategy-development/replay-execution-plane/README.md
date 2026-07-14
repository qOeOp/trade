# Replay Execution Plane

RD 确定性历史执行与证据生产面。当前已实现：

```text
contracts/  完整 Trial/Candidate/Dataset/Instrument/Policy/Result/Fingerprint 合同
data-adapter/ manifest/hash、UTC、instrument/PIT、closed bar/grid gap、funding ordering 准入
engine/     EventKey source reducer + source-bound entry/exit order lanes
accounting/ slippage、fee、exact funding、multi-Fill position、现金归约与平衡 journal
metrics/    只从 fills/ledger 派生权威 Replay metrics
runner/     幂等、取消、typed failure 与 source/order events 原子 Artifact commit
tests/      golden、property、metamorphic、component parity 认证
compatibility/ 迁入的 legacy replay/benchmark/panel 实现，只用于兼容与 parity
certification/ 迁入的 calibration 认证来源
```

这是 Result/Artifact v7、Dataset Manifest v2、Simulator Policy v2 的受限认证纵切：signal-time submit 后，单一 SourceEvent reducer 在 eligible `bar_open` 同步驱动 entry activate/fill 与 stop/target activation，再按 `(event_time, boundary_phase, source_sequence, event_subphase, stable_event_id)` 推进 `instrument_delisted|bar_open|bar_range|funding`，命中 terminal market event 时同步驱动 exit lane，自然截断 source/order causal prefix。Fill 绑定实际 filled OrderEvent key；每笔 Fill 生成同 key 的 post-fill Position Projection；fee/realized PnL 复用 Fill key，funding 复用 SourceEvent key，首尾资金快照使用显式 checkpoint key。Manifest 绑定 linear derivative 的 base/quote/settlement asset 与 increment；`rd-replay-number-v3` 以 BigInt rational 完成 bps/rate/product/division，再按 quantity floor、buy-ceil/sell-floor price、fee ceiling、signed cashflow floor、12 位 weighted-average/return half-away 一次量化，并拒绝未对齐 stop/target、OHLC 与现金事实。Bun/BigInt 与 Python Decimal 共用认证向量。Accounting 同时认证 net average-cost、多 Fill 现金归约和 `rd-replay-journal-v1` 两腿平衡 journal/trial balance。Runner 仍只接受一笔 entry 与一笔全量 reduce-only close。同时间 funding 在 entry 前看见 flat `t-` position；同一 entry open 的 gap 在 bracket activation 后处理。它仍不是 generic instrument status/market/command、多订单 matching、任意精度 JSON transport 或 portfolio reducer，也不代表真实 liquidity partial、limit queue、margin/liquidation 或 fast mode 已完成。
