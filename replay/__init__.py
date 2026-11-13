"""The one replay entry (entry): explorations, prechecks, and sealed research and validation replays,
each with its trial and start receipt written before the container starts, the runner, the
independent auditor and the semantic fingerprint run in one pinned image, the execution capture
sealed whatever the outcome, and sealed replays stored as runs whose status the ledger derives from
that capture; reproducing a sealed run into /tmp (reproduce); a line's closing history test (history);
replaying a Paper or Live run's declaration as no trial and comparing it with what ran (reconcile).

The research-chain chapters state the rules; `replay.<name>` in them is the function `<name>`
in this package. Containers start through `replay.seams`; the runtime image, its probe and the market
are reached through `registration.seams`.
"""
