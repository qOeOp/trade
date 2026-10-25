"""Comparability (`registration.check_comparable`, `registration.config_key`, `registration.input_key`).

Two sides are comparable when they ran the same runtime image (by content digest), the same
effective configuration once host locations are removed, and the same inputs once host locations,
check times and the exporter's source hash are removed. Read only; nothing is written.
"""

from __future__ import annotations

from collections.abc import Mapping
import copy

from ledger.refusals import refuse


CONFIG_KEYS = ("runtime_contract", "start", "trade_start", "end", "symbols", "account")  # the engine's keys
INPUT_KEYS = ("market_commit", "universe_rule", "export_content_sha256")
# Recorded as provenance, never compared: the exporter's code is not an input. What the engine reads
# (the export root and the membership file) is export_content_sha256.
PROVENANCE_KEYS = ("exporter_source_sha256",)
COMPARABLE_PURPOSES = ("research", "validation")


def _host_location(key: str) -> bool:
    return key.endswith("_root") or key.endswith("_path")


def config_key(value: object) -> dict:
    """The effective configuration without its host-location keys (*_root, *_path); values untouched."""
    if not isinstance(value, Mapping):
        raise refuse("IDENTITY_MALFORMED", "the effective configuration is not a mapping",
                     expected="a mapping with " + ", ".join(CONFIG_KEYS))
    missing = tuple(key for key in CONFIG_KEYS if key not in value)
    if missing:
        raise refuse("IDENTITY_MALFORMED", "the effective configuration lacks " + ", ".join(missing), missing=missing)
    return {key: copy.deepcopy(item) for key, item in value.items() if not _host_location(str(key))}


def input_key(value: object) -> dict:
    """The input identity without host roots, check times and the exporter's source hash; every content
    and selection key kept."""
    if not isinstance(value, Mapping):
        raise refuse("IDENTITY_MALFORMED", "the input identity is not a mapping",
                     expected="a mapping with " + ", ".join(INPUT_KEYS))
    missing = tuple(key for key in INPUT_KEYS if key not in value)
    if missing:
        raise refuse("IDENTITY_MALFORMED", "the input identity lacks " + ", ".join(missing), missing=missing)
    return {key: copy.deepcopy(item) for key, item in value.items()
            if not (str(key) == "root" or str(key).endswith("_root") or key == "checked" or key in PROVENANCE_KEYS)}


def image_digest_of(execution: Mapping):
    """The runtime image digest of a registration plan's execution identity."""
    return execution.get("image_digest")


def check_comparable(run: Mapping, execution: Mapping) -> None:
    """Refuse unless `run` is a passed research or validation run with the same three identities."""
    if run.get("status") != "passed" or run.get("purpose") not in COMPARABLE_PURPOSES:
        raise refuse("RUN_NOT_PASSED", f"run {run.get('trial_id')} is {run.get('status') or 'unfinished'} with purpose "
                                       f"{run.get('purpose')}", expected="a passed research or validation run",
                     missing=(str(run.get("trial_id")),))
    conflicts = []
    if run.get("image_digest") is None or run.get("image_digest") != image_digest_of(execution):
        conflicts.append("runtime_image")
    if config_key(run.get("effective_config")) != config_key(execution.get("effective_config")):
        conflicts.append("effective_configuration")
    if input_key(run.get("input_identity")) != input_key(execution.get("input_identity")):
        conflicts.append("input_identity")
    if conflicts:
        raise refuse("COMPARABILITY_MISMATCH", "the two sides differ in " + ", ".join(conflicts),
                     missing=tuple(conflicts))
