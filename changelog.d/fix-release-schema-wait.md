- Release (host): before its journal, a release runs the candidate's own `ledger service check` on the host's
  research mirror and Paper database. A database it refuses with `SCHEMA_MISMATCH` makes the release wait: nothing
  changes, no `failed/<revision>` is written, one Telegram notice names the database and the owner's step
  (`deploy/remote/README.md`, A version that needs a new ledger generation), and every tick checks again. Before,
  such a version warmed for 30 minutes, rolled back and was blocked for good (doctor 20261122-30).
