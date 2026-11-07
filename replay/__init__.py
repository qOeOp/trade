"""The one replay entry (entry): explorations, prechecks, and sealed research and validation replays,
each with its trial and start receipt written before the container starts, the runner, the
independent auditor and the semantic fingerprint run in one pinned image, the execution capture
sealed whatever the outcome, and sealed replays stored as runs whose status the ledger derives from
that capture; reproducing a sealed run into /tmp (reproduce).

The research-chain chapters state the rules; `replay.<name>` in them is the function `<name>`
in this package. Today's runtime, runner and audit code are reached only through
`replay.seams` (and `registration.seams` for the runtime probe and market).
"""
