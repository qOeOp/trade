# Contributing

This is a self-hosted research product run by one operator ([`README.md`](README.md#start-here)). Most changes
come from Agents working for that operator; outside pull requests are read, but nothing is promised.
[`AGENTS.md`](AGENTS.md) is the rulebook for every change, by a person or an Agent: what needs the owner's
authority, when product code is warranted at all, where data goes, and how changes are checked. Read it first;
this page only lists the mechanics.

## Issues

Use a template under **Issues → New issue**: a bug report needs the version or commit, what you ran and what you
saw. Report a vulnerability privately as [`SECURITY.md`](SECURITY.md) says, never in an issue. Issues are public
and indexed: leave out credentials, tokens and Live or Paper execution records.

## Pull requests

- Base every pull request on `main`, one root cause each; never stack one on another, since the quality checks run
  only for pull requests into `main`.
- Fill in [`.github/pull_request_template.md`](.github/pull_request_template.md). The title is
  `type(scope): description` with one lowercase scope; check it with
  `bash .github/scripts/validate-pr-title.sh "<title>"`. Report only checks you actually ran.
- A change of behavior or interface adds one file under [`changelog.d/`](changelog.d/), named after the branch;
  never edit `CHANGELOG.md` ([how](CHANGELOG.md#unreleased)).
- Skill text under `.agents/skills/` is product code: follow [`.agents/README.md`](.agents/README.md).
- Merging is not releasing. Version tags (`vX.Y.Z`) are the owner's call, every time.

## Checks

Python 3.14 and [uv](https://docs.astral.sh/uv/):

```bash
uv sync --frozen
uv run --frozen python .github/scripts/run-tests.py   # the tests, one process per module, as CI runs them
uv run --frozen ruff check .
uv run --frozen mypy
```

The Dolt integration tests need the pinned Dolt binary and skip without it ([`README.md`](README.md)). A change
that should preserve replay behavior is accepted only by the paired native replays in
[`engine/README.md`](engine/README.md#paired-acceptance), not by green tests.

Web code (`ide/web`; in `ide/agent` and `ide/overview` also run `npm test`):

```bash
cd ide/web && npm ci && npm run check
```
