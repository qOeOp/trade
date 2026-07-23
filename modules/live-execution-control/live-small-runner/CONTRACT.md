# live-small-runner

## Owns

- explicit `--yes` live-small authorization
- armable preflight gate before exchange writes
- account-scoped, short-lived execution capability compilation
- mandatory exchange request router, write pre-adapter gate, adapter, and post-write confirmation sequence
- target action allowlist for small live entry placement
- command spec execution through injected runner
- audited order_fill append after confirmed exchange tool output

## Does not own

- strategy thesis
- exchange API details
- dry-run / shadow mock execution
- account snapshot reconciliation

## Stable entrypoints

- `runLiveSmall(dbPath, input, yes, runner?, runtime?)`

State access goes through execution-flow-runner's state runtime and portfolio-execution-state owner tools by default. Tests may inject runtime readers/appender as behavior anchors.
