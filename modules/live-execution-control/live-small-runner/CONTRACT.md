# live-small-runner

## Owns

- explicit `--yes` live-small authorization
- armable preflight gate before exchange writes
- target action allowlist for small live entry placement
- command spec execution through injected runner
- audited order_fill append after confirmed exchange tool output

## Does not own

- strategy thesis
- exchange API details
- dry-run / shadow mock execution
- account snapshot reconciliation

## Stable entrypoints

- `runLiveSmall(db, input, yes, runner?)`
