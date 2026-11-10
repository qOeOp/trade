"""Comparability (`registration.check_comparable`, `registration.config_key`, `registration.input_key`).

Two sides are comparable when they ran the same runtime image (by content digest), the same
effective configuration once host locations are removed, and the same export content. The market
commit, universe rule and selection stay recorded and are not compared: content equal, inputs equal.
A run also holds the identity of each trial that reproduced it (`reproduction.reproductions`): the same
result under that image, configuration and inputs. Read only; nothing is written.
"""

from __future__ import annotations

from collections.abc import Mapping
import copy

from shared.refusals import refuse


CONFIG_KEYS = ("runtime_contract", "start", "trade_start", "end", "symbols", "account")  # the engine's keys
INPUT_KEY = "export_content_sha256"  # what the engine reads of the export root and the membership file
# Configuration keys export_content_sha256 already covers (the commit they were read at, the membership file's hash)
COVERED_CONFIG_KEYS = ("market_commit", "universe_sha256")
COMPARABLE_PURPOSES = ("research", "validation")


def _host_location(key: str) -> bool:
    return key.endswith(("_root", "_path"))


def config_key(value: object) -> dict:
    """The effective configuration without its host-location keys (*_root, *_path) and what the inputs cover;
    values untouched."""
    if not isinstance(value, Mapping):
        raise refuse("IDENTITY_MALFORMED", "the effective configuration is not a mapping",
                     expected="a mapping with " + ", ".join(CONFIG_KEYS))
    missing = tuple(key for key in CONFIG_KEYS if key not in value)
    if missing:
        raise refuse("IDENTITY_MALFORMED", "the effective configuration lacks " + ", ".join(missing), missing=missing)
    return {key: copy.deepcopy(item) for key, item in value.items()
            if not _host_location(str(key)) and key not in COVERED_CONFIG_KEYS}


def input_key(value: object) -> dict:
    """The part of an input identity two runs must share: its content."""
    if not isinstance(value, Mapping):
        raise refuse("IDENTITY_MALFORMED", "the input identity is not a mapping", expected=f"a mapping with {INPUT_KEY}")
    if INPUT_KEY not in value:
        raise refuse("IDENTITY_MALFORMED", f"the input identity lacks {INPUT_KEY}", missing=(INPUT_KEY,))
    return {INPUT_KEY: value[INPUT_KEY]}


def image_digest_of(execution: Mapping):
    """The runtime image digest of a registration plan's execution identity."""
    return execution.get("image_digest")


def _conflicts(identity: Mapping, execution: Mapping) -> list[str]:
    """Which of one identity's image, configuration and inputs differ from the execution's."""
    conflicts = []
    if identity.get("image_digest") is None or identity.get("image_digest") != image_digest_of(execution):
        conflicts.append("runtime_image")
    if config_key(identity.get("effective_config")) != config_key(execution.get("effective_config")):
        conflicts.append("effective_configuration")
    if input_key(identity.get("input_identity")) != input_key(execution.get("input_identity")):
        conflicts.append("input_identity")
    return conflicts


def check_comparable(run: Mapping, execution: Mapping) -> None:
    """Refuse unless `run` is a passed research or validation run with the same three identities."""
    if run.get("status") != "passed" or run.get("purpose") not in COMPARABLE_PURPOSES:
        raise refuse("RUN_NOT_PASSED", f"run {run.get('trial_id')} is {run.get('status') or 'unfinished'} with purpose "
                                       f"{run.get('purpose')}", expected="a passed research or validation run",
                     missing=(str(run.get("trial_id")),))
    conflicts = min((_conflicts(identity, execution) for identity in (run, *run.get("reproductions", ()))), key=len)
    if conflicts:
        raise refuse("COMPARABILITY_MISMATCH", "the two sides differ in " + ", ".join(conflicts),
                     missing=tuple(conflicts))
