"""Comparability (`registration.check_comparable`, `registration.comparable_identity`).

Two sides are comparable when they ran the same runtime image (by content digest), the same effective
configuration once host locations, window and instruments are removed (`comparable_config_sha256`), the
same export content and the same window. The market day, universe rule and selection stay recorded and
are not compared: content equal, inputs equal. A run also holds the identity of each trial that reproduced
it (`reproduction.reproductions`): the same result under that identity. Read only; nothing is written.
"""

from __future__ import annotations

from collections.abc import Mapping

from shared.refusals import refuse


# The trial columns two comparable sides share; a registration's execution identity gives the same keys.
IDENTITY = ("image_digest", "comparable_config_sha256", "export_sha256", "input_start", "trade_start", "trade_end")
COMPARABLE_PURPOSES = ("research", "validation")


def comparable_identity(row: Mapping) -> dict:
    """The IDENTITY values of a trial row read with its image digest (or of an execution identity)."""
    return {key: row.get(key) for key in IDENTITY}


def _conflicts(identity: Mapping, execution: Mapping) -> list[str]:
    """Which identity columns differ from the execution's; a missing image digest always differs."""
    return [key for key in IDENTITY if identity.get(key) is None or identity.get(key) != execution.get(key)]


def check_comparable(run: Mapping, execution: Mapping) -> None:
    """Refuse unless `run` is a passed research or validation run sharing the IDENTITY of `execution`, itself
    or through one of its `reproductions`."""
    if run.get("status") != "passed" or run.get("purpose") not in COMPARABLE_PURPOSES:
        raise refuse("RUN_NOT_PASSED", f"run {run.get('trial_id')} is {run.get('status') or 'unfinished'} with purpose "
                                       f"{run.get('purpose')}", expected="a passed research or validation run",
                     missing=(str(run.get("trial_id")),))
    conflicts = min((_conflicts(identity, execution) for identity in (run, *run.get("reproductions", ()))), key=len)
    if conflicts:
        raise refuse("COMPARABILITY_MISMATCH", "the two sides differ in " + ", ".join(conflicts),
                     missing=tuple(conflicts))
