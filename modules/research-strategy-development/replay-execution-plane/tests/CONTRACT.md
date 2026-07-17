# Replay Certification Tests

Owns cross-component golden, property, metamorphic and parity certification for Replay Execution Plane semantics.

Tests may compare certified components and compatibility outputs, but this package owns no production behavior and cannot turn a compatibility result into governed evidence.

R4.85 certification must prove that Wire v2 cross-source collisions remain marked `deterministic_tie_break_only` in the non-economic candidate trace, while `economic_exact_trigger` is rejected both for `resolution_limited` input and for declared-timestamp-exact input lacking a certified economic consumer. Rehashing cannot erase per-event ambiguity lineage or create execution effects.

R4.86 certification must prove dual-clock causality: a fact with `availability_at > effective_time` is absent from every earlier visibility cut, enters only at its declared availability, remains non-retroactive, and cannot be revealed early by reordering and rehashing. Immediate facts preserve effective-order parity; deterministic rebuild preserves both timeline hashes.

`OHLCV Oracle Fixture v1` 是 certification-only 的 ordered-price reference：只对 synthetic piecewise-linear observation trace 计算首个 simple-bracket crossing，用于证明 OHLC P1/P2 envelope containment、same-OHLC opposite outcome 与 sampling-density metamorphism。它不是 Market Data 合同、tick Replay 模式或真实成交事实。

OHLCV Resolution Evidence v2 certification 必须覆盖 initial generation 1、stop replacement generation 2、partial-resize generation 2 及其 remaining quantity/order identity，并以重算 evidence/checkpoint hash 的 stale-generation 篡改证明自洽哈希不能替代跨 Artifact 的 SourceEvent/OrderEvent/Fill 绑定。

OHLCV Resolution Evidence v3 certification 还必须覆盖 long/short directionally rounded execution price、fee/gross/net 算术、exact path zero span、collision positive span、价格缩放、cost-policy tamper、canonical Fill tamper 与 clean/resume/idempotent parity。不得用该 envelope 推断真实 path probability 或完整 counterfactual equity。

`OHLCV Economic Oracle Fixture v1` 是 certification-only 的成本/精度向量。Oracle 必须独立实现有理数与舍入，不得导入 production accounting/decimal；至少覆盖 zero-cost、非零 fee/slippage、fractional bps、coarse price/settlement increment、long/short、gap/single-touch/collision、ordered actual-path containment、手算 golden 与采样加密不变性。该认证不把 synthetic cost policy 升级为真实 venue 成本模型，也不授予 Result/Artifact authority。

`OHLCV Economic Oracle Request/Response v1` 是 certification-only Python stdio 协议：输入 decimal 必须为 canonical string，输出 economics 也必须为 canonical string；success 保持 vector 顺序，非法 schema/direction/decimal/重复 id 必须非零退出并返回 typed `input_invalid`。Bun 必须通过仓库 Python resolver 调用，并把每条结果同时与 TypeScript BigInt oracle、production Evidence 对齐。该协议不是 Replay Plane port、tool、runtime backend 或 Artifact schema。

数据连续性认证必须把 observed price gap 与 missing grid interval 分开：缺 frozen earliest-executable bar 在 Fill 前 typed fail；持仓后缺口在前一 observed close 后、任何未来 SourceEvent/checkpoint 前 fail；clean 与 resume 必须命中同一 gap evidence。终态在缺口前完成时，追加未来缺口不得改变 source prefix、orders、fills、ledger、limitations 或 semantic Result。严格 decision lookback 另需锁定内部 gap 与 stale terminal bar 拒绝。所有 gap failure 均禁止 partial Result/Artifact，且不得用 synthetic bar、forward-fill 或 `resolution_limited` 代替。

交易状态认证必须覆盖 complete PIT `trading -> halted -> trading` schedule、schedule gap/overlap/hash drift、decision/executable-time halt 拒绝、bar 跨 halt 拒绝、`current_snapshot_only` 不得声称历史停牌。唯一可跨越的无 bar 区间必须全程 halted；halt/resume phase-`00`，Funding/Mark 仍消费，protection 不失活，恢复首 open 按真实 gap 触发。checkpoint/resume semantic Result 必须一致。停牌中 exact maintenance breach 必须返回 typed failure 与 `not_simulated` observation，且没有 liquidation Fill、Result 或 Artifact；delisting 同刻仍先于 status transition。
