- Breaking (ledger schema generation 2, delegated decision, doctor 20261121-41): the ledger no longer stores
  `runtime_contract` on `candidate` or `trial` (a contract change starts a new ledger, so it was one constant per
  ledger). `RUNTIME_CONTRACT_MISMATCH` now compares the runtime image's contract with this release's, at the replay
  entry and when a trial is written (in place of the dropped foreign key); the grid contract comparison
  (`CONFIG_MISMATCH`) and Live prepare's contract comparison are gone, since resolving an image already refuses
  another contract (`RUNTIME_UNSUPPORTED`). `candidate publish/list/show`, `research status`'s `execution_identity`,
  `research runs`'s `groups` and `replay report`'s `runtime` drop the `runtime_contract` key. A run's input identity
  names its market profile as `market_name`, not `market_database`.
