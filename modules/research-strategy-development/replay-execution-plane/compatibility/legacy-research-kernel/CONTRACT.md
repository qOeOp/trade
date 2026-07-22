# Legacy Research Evaluation Kernel

## Type

legacy shared research kernel / compatibility-only

## Owns

- Legacy R&D candidate evaluation semantics and result types.
- Legacy conservative fill ordering, cost, funding, temporal diagnostics, and gates.
- Compatibility hashing plus OHLCV manifest/data loading helpers.
- Bounded full-series versus cutoff-recomputed strategy-decision integrity detection.

## Inputs

- Local OHLCV manifests.
- Optional supplemental data refs.
- A compiled `ReplayStrategy`.
- Strategy decisions receive only a frozen OHLCV/indicator prefix through the decision cutoff and an observed `decisionPrice`; next-event prices are execution-only facts.

## Outputs

- Legacy `ReplayResult` and related research-evaluation types.
- Compatibility latest-signal shells used by migration-source tools.
- Next-open materialization that preserves the predeclared reward/risk ratio and rejects fills exceeding the signal's entry-risk limit.
- A deterministic temporal-integrity report with complete/sampled coverage, mismatch count, and bounded mismatch evidence.

## Boundaries

- 不是 native Trial-bound Replay authority；不得为新 Result、Artifact、promotion 或 execution 语义背书。
- 现有消费者只可维持 legacy R&D/Forward 兼容，不得新增调用方。
- 不写文件、catalog、`trade.db` 或 exchange state。
- Does not promote strategies.
- Does not call Binance write tools.
- Strategies cannot read future bars or choose an actual next-open fill price.
- The integrity detector rebuilds indicators at each cutoff; callers with external feature stores must also provide a cutoff-bounded strategy factory.
- Native historical evidence belongs to Replay contracts/data-adapter/engine/accounting/runner, not this kernel.

## Retirement Gate

- 所有直接消费者迁出 legacy `ReplayResult`、fill/signal semantics 与 data/hash helpers。
- State Store capability refs 改指 canonical owner；cross-plane import allowlist 清零。
- `legacy-replay-fingerprint` certification 显式迁移或终止。
- legacy integration coverage 被各 canonical owner 的定向测试替代后，删除本模块而非改名接管新语义。
