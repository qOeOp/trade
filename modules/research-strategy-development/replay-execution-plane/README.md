# Replay Execution Plane

RD 确定性历史执行与证据生产面。当前已实现：

```text
contracts/  完整 Trial/Candidate/Dataset/Policy/Result/Fingerprint 合同
data-adapter/ manifest/hash、UTC、instrument/PIT、closed bar/grid gap、funding ordering 准入
engine/     single-asset closed-candle -> next-open -> stop/target event kernel
accounting/ slippage、fee、exact funding cashflow 与单仓位守恒账本
metrics/    只从 fills/ledger 派生权威 Replay metrics
runner/     幂等、取消、typed failure 与原子 Artifact commit
tests/      golden、property、metamorphic、component parity 认证
compatibility/ 迁入的 legacy replay/benchmark/panel 实现，只用于兼容与 parity
certification/ 迁入的 calibration 认证来源
```

这是 certified v1 纵切，不代表 portfolio、partial fill、margin/liquidation 或 fast mode 已完成。旧 engine/runner 已迁入本 Plane 的 `compatibility/`，新 Trial-bound 请求可由兼容 runner 转发；RD 根不再保留旧路径。
