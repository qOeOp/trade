- Release (host): a release stopped by the host rather than by the version (a protected container — the ledger, the
  Docker API proxy or a Paper runner — that restarted or changed, host memory below what a candidate needs, a Live
  run that started during the release) is rolled back as before but writes no `failed/<revision>`: the version waits,
  one notice names the condition, and the next tick tries again. A product failure, or a transaction found pending at
  the start of a tick, still marks the version failed (doctor 20261122-31).
