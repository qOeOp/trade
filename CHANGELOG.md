# Changelog

The version is `pyproject.toml`'s; `python -m cli.main --version` and the IDE's About name it beside the commit.
Every checked merge to `main` still releases to the author's host ([`deploy/remote/README.md`](deploy/remote/README.md));
a version names a revision worth returning to, not every release.

To release a version: in one pull request, raise the version in `pyproject.toml` and move the Unreleased entries
under it with the date. After it merges, tag that merge commit and publish its entry:

```bash
git tag -a vX.Y.Z <merge-commit> -m vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z --verify-tag --title vX.Y.Z --notes "<the entry>"
```

Its images are `ghcr.io/qoeop/trade-{ide,service,runtime}:sha-<merge-commit>`; going back to one is
[Rolling back](deploy/remote/README.md#rolling-back).

## Unreleased

## 0.1.0 (2026-11-11)

The first named version: `main` as of this tag. Native Nautilus replays of single-file strategies in a digest-pinned
runtime image, the Dolt research ledger with its public DoltHub copy, the market directory of Binance public data,
the research IDE with its chat Agent, Paper trading on public data with Sandbox fills, the operator's Live trial,
and automatic release to the author's host.

- `python -m cli.main --version` and the IDE's About show the version.
