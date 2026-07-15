# Replay Certification Tests

Owns cross-component golden, property, metamorphic and parity certification for Replay Execution Plane semantics.

Tests may compare certified components and compatibility outputs, but this package owns no production behavior and cannot turn a compatibility result into governed evidence.

`OHLCV Oracle Fixture v1` 是 certification-only 的 ordered-price reference：只对 synthetic piecewise-linear observation trace 计算首个 simple-bracket crossing，用于证明 OHLC P1/P2 envelope containment、same-OHLC opposite outcome 与 sampling-density metamorphism。它不是 Market Data 合同、tick Replay 模式或真实成交事实。

OHLCV Resolution Evidence v2 certification 必须覆盖 initial generation 1、stop replacement generation 2、partial-resize generation 2 及其 remaining quantity/order identity，并以重算 evidence/checkpoint hash 的 stale-generation 篡改证明自洽哈希不能替代跨 Artifact 的 SourceEvent/OrderEvent/Fill 绑定。

OHLCV Resolution Evidence v3 certification 还必须覆盖 long/short directionally rounded execution price、fee/gross/net 算术、exact path zero span、collision positive span、价格缩放、cost-policy tamper、canonical Fill tamper 与 clean/resume/idempotent parity。不得用该 envelope 推断真实 path probability 或完整 counterfactual equity。
