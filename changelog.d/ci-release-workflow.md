- Release: a version is released by starting the `release` workflow with it (`gh workflow run release.yml -f
  version=X.Y.Z`). It opens and auto-merges the bump pull request (`pyproject.toml`, `uv.lock`, the changelog
  section), waits until `main-ready` admits the commit carrying the version and creates the GitHub release and tag on
  it, then wakes `release-ready`. The bump pull request needs a `RELEASE_TOKEN` secret (`release.yml` says which).
  `changelog-release.py` now folds pending entries into the newest section when its version is not released yet, and
  prints a version's notes with `--notes`.
