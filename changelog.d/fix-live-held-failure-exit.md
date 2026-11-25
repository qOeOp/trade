- A held Live start that fails (a connected account read refused, a lost connection, lost storage) exits 1 with
  `unresolved` as any failed run does, instead of `reconcile_stopped` and 0.
