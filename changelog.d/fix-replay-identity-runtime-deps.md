- Breaking, replay identity: `dependency_lock_sha256` hashes only what the images install from `uv.lock`
  (`uv sync --no-dev`: the packages the project's runtime dependencies reach, without the project's own version), so a
  ruff, mypy or type-stub pin no longer rebuilds the replay image or leaves earlier replays unable to back a Live run.
  Every image's value changes: a replay sealed before this version no longer matches a newer execution image for Live
  admission (`live/admission.py` REPLAY_CODE); 0.5.0 starts on a new ledger (doctor 20261121-30).
