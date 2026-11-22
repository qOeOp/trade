- Breaking (deployment): `TRADE_RESEARCH_ORIGIN` (and the repository the IDE's first-start page is given) names the
  DoltHub repository each ledger generation is named after: a version of ledger schema generation N reads and
  publishes `<TRADE_RESEARCH_ORIGIN>-g<N>` (a trailing `-g<digits>` is dropped first), so no setting changes between
  generations. The upgrade drops the reading of the unsuffixed repository: this version (schema generation 2) starts
  generation 2 on every deployment still on generation 1, below.
- Release: a version whose ledger schema generation differs from the deployment's starts the new data generation by
  itself, replacing the manual "Starting a new data generation" steps. `deploy/update.sh` publishes the old ledger,
  creates the new DoltHub repository when it is missing (with a DoltHub API token in `TRADE_DOLTHUB_TOKEN_FILE`,
  default `$TRADE_DATA/dolthub-token`; without one it stops first and names the repository to create), archives the
  ledger's data into `$TRADE_DATA/archive/` and starts the new ledger, which publishes it. The release host waits,
  with one notice, until that ledger is published, no Paper runner runs and Live is idle, then archives the same way,
  starts the ledger mirror and market import from the version's definition and releases the version on the next tick.
  Only the newest archive is kept on either. Both finish an interrupted cutover from its step
  (deploy/README.md Updating; deploy/remote/README.md, A version that starts a new data generation).
- Release workflow: a version that changes `SCHEMA_VERSION` or `PAPER_SCHEMA_VERSION` since the newest release must
  raise the minor version before 1.0 and the major version from 1.0; the workflow refuses it otherwise, before the
  bump and again on the merged commit.
