# research/rd-artifact-summary

## Type

atomic module

## Owns

- Reading R&D artifact JSON from an explicit path.
- Producing compact, deterministic summaries for R&D loop and panel artifacts.

## Inputs

- Explicit artifact file path.
- In-memory R&D artifact JSON, optionally wrapped by the standard script response envelope.

## Outputs

- `strategy_rnd_loop` summary records.
- `strategy_panel_rnd` summary records.

## Boundaries

- Does not run replay, candidate evaluation, panel evaluation, campaigns, or supervisors.
- Does not write artifacts, data catalogs, ledgers, strategies, or trade state.
- Does not infer missing metrics; absent or malformed numeric fields normalize to `0` only in summary output.
