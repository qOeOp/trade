- Breaking (deployment): `main` of the research repository (`TRADE_RESEARCH_ORIGIN`) is always the ledger in use;
  the local `main` is pushed as `main`, and bootstraps, publishes and mirror syncs fetch `main` alone. A ledger's
  version line is the tag `line/<line>` on its first commit, not a stored field; the first publication pushes it. A
  version of a later line keeps the old line's ledger as the branch of that line's name (pushed, never forced, and
  checked to hold `main`'s head) before its new ledger is force-pushed to `main`; the release host waits until `main`
  holds the new line and that branch its mirror's head. The first 0.5.4 update on a workstation moves the v0.5 ledger,
  which 0.5.3 published as the branch `v0.5`, onto `main`: the previous generation on `main` goes to the branch `v0.4`,
  the ledger is tagged `line/v0.5` and force-pushed to `main`, and `v0.5` is deleted once `main` holds its head. The
  first 0.5.4 release on the release host then moves its mirror onto `main`. Workstations and the release host refuse
  versions before 0.5.4 from then on, and 0.5.2's `-g2` repository is no longer recognised.
