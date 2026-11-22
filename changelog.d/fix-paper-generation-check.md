- `ledger service check` reads a Paper database at its own schema instead of refusing it as `LEDGER_KIND`, so a
  release's schema pre-check no longer fails every tick on the host's Paper database.
