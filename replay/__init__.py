"""The one replay entry (entry): explorations, prechecks, and sealed research and validation replays,
each with its trial and start receipt written before the container starts, the runner and the
independent auditor run in one pinned image, the execution capture sealed whatever the outcome, and
sealed replays stored as runs; reproducing a sealed run into /tmp (reproduce).

The design page design-code-replay is the specification; a design id `replay.<name>` is the
function `<name>` of the module the design names. Today's runtime, runner and audit code are
reached only through `replay.seams` (and `registration.seams` for the runtime probe and market).
"""
