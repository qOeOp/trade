# Legacy Research Provenance

## Type

legacy research provenance compatibility module

## Owns

- Legacy replay provenance shell assembly。
- Legacy closed-candle temporal contract and supplemental report-time projection。
- Frozen binding of legacy harness、data、assumptions and supplemental content hashes into provenance。

## Inputs

- Manifest path、timeframe、bar interval and assumptions。
- Structural candle timestamps、trade exit times and supplemental refs。

## Outputs

- Legacy `ReplayProvenance` and `ReplayTemporalContract`。
- Empty temporal shell used before a complete replay result is bound。

## Boundaries

- 只投影既成输入，不执行 Replay，不生成 Signal、Fill、trade facts 或 metrics。
- 不定义新 hash algorithm；identity 只来自 `legacy-replay-identity`。
- 不校验 native PIT Dataset/Result contract，不是 Artifact 或 promotion authority。
- 不写文件、catalog 或 durable state；随 legacy provenance consumers 一并退役。
