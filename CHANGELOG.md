# Changelog

The version is `pyproject.toml`'s; `python -m cli.main --version` and the IDE's About name it beside the commit.
A version is what releases to the author's host ([`deploy/remote/README.md`](deploy/remote/README.md)): CI admits
the commit of the highest version tag (`v0.2.0` or later, on `main`) to the `deploy-ready` channel the host reads.
A merge only reaches `main-ready`, the staging channel every checked `main` build goes to. Shipping a version is the
user's call each time.

To release a version: in one pull request, raise the version in `pyproject.toml` and move the Unreleased entries
under it with the date. After it merges, write that entry to a file and create the release, which tags the merge
commit:

```bash
gh release create vX.Y.Z --target <merge-commit> --title vX.Y.Z --notes-file <entry.md>
```

The tag push wakes `release-ready`, which admits the version once every check of its commit has passed and records
a GitHub deployment to `production`; the host switches on its next release tick. A version on a commit behind the
one the host runs is ignored. Its images are `ghcr.io/qoeop/trade-{ide,service,runtime}:sha-<merge-commit>`; going
back to one is [Rolling back](deploy/remote/README.md#rolling-back).

## Unreleased

## 0.2.0 (2026-11-11)

A breaking release: a new research ledger (schema generation 1) that starts research from zero. The previous ledger
is not upgraded; read it with its matching old checkout (README.md). Everything below lands on a fresh host.

- Ledger: schema generation 1 (fewer tables and fields, `market_day` a `DATE`, readings computed at sealing), its
  public DoltHub copy started anew. `line close` syncs the backup, and `ledger review` reports one that is behind.
- Research windows follow a three-segment rule: a development period by quarters before the line's start, an
  8-quarter holdout run once as one segment, and earlier calendar years as veto years; a line with fewer than 12
  complete quarters is refused (`LINE_HISTORY_SHORT`). The line-close history test and its IDE heatmap report veto,
  holdout and their joint verdict, with the deflated Sharpe ratio.
- Replays run only on images this repository's CI built (any branch; validation still needs a `main` build), each
  stage capped at 16 GiB (`STAGE_MEMORY_LIMIT`). The audit is indexed per strategy, contract and side, and the
  fingerprint streams reports: a busy 3-year pool replay went from about 98 minutes with a 17.5 GiB peak to
  about 20 minutes with a 6.2 GiB peak.
- The market version is a day throughout: refusal codes `MARKET_DAY_*`, `UNIVERSE_EMPTY_AT_DAY`, and `market_day`
  in every JSON output and receipt. `replay report` adds slippage stress; `research status` adds the deflated Sharpe.
- Paper writes to its own `paper` database, never published; `paper resume` re-exports terms at the run's market day.
  `TRADE_PAPER_MEMORY` reaches the Paper controller on the host and the workstation.
- Only a version releases to the author's host: `deploy-ready` admits the commit of the highest version tag from
  `v0.2.0` on, and a merge reaches only the new `main-ready` staging channel (`deploy.images --channel main`).
- Profile files name `holds` and `kind` (`{"name", "holds": "market", "kind": "active", "root"}`); rewrite an old
  `market.json` by hand.

## 0.1.0 (2026-11-11)

The first named version: `main` as of this tag. Native Nautilus replays of single-file strategies in a digest-pinned
runtime image, the Dolt research ledger with its public DoltHub copy, the market directory of Binance public data,
the research IDE with its chat Agent, Paper trading on public data with Sandbox fills, the operator's Live trial,
and automatic release to the author's host.

- `python -m cli.main --version` and the IDE's About show the version.
