"""A terminal stop a Live run began, read from its journal (the runner and the control read it alike; no native import)."""
from __future__ import annotations

# The reasons of a trading start's stops that leave the run to start again as itself.
PASSING = frozenset({"interrupted", "rewarming"})
# The reasons a run stops for without having failed; any other fails it (engine.live_session, engine.live_brake,
# engine.live_source), also when a later start finishes the stop.
UNFAILED = frozenset({"requested", "duration", "drawdown", "source_shutdown"})


def begun_stop(rows: list[dict]) -> str | None:
    """The reason of the first stop that was to end the run, journalled by a start that trades; None when there is none.
    A held start's stop closes nothing and begins no such stop."""
    trading = False
    for row in rows:
        event = row.get("event")
        if event == "preflight":
            trading = row.get("mode") == "run"
        elif event == "resuming":
            trading = not row.get("held")
        elif event == "stopping" and trading and row.get("reason") not in PASSING:
            return str(row.get("reason"))
    return None
