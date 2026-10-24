"""Comparability (`registration.check_comparable`, `registration.config_key`, `registration.input_key`).

Two sides are comparable when they ran the same runtime image (by content digest), the same
effective configuration once host locations are removed, and the same inputs once host locations
and check times are removed. Read only; nothing is written.
"""

from __future__ import annotations

from collections.abc import Mapping
import copy

from ledger.refusals import refuse


CONFIG_KEYS = ("runtime_contract", "start", "trade_start", "end", "symbols", "account")  # the engine's keys
INPUT_KEYS = ("market_commit", "universe_rule", "export_content_sha256")
COMPARABLE_PURPOSES = ("research", "validation")


def contract_migration(previous: object, current: object) -> bool:
    """The declared source ABI migration; this never makes executions economically comparable."""
    return (previous, current) == ("replay-contract@v6", "replay-contract@v7")


def source_contract_supported(source: str, runtime: object) -> bool:
    """v7 retains the v6 strategy constructor and callbacks. Its image still needs a fresh review."""
    return source == runtime or contract_migration(source, runtime)


def rebuild_identity_matches(previous: Mapping, current: Mapping) -> bool:
    """Technical continuity, not parity: keep market selection and account terms across v6 -> v7.

    v7 exports new quote metadata and declares the existing bars environment explicitly. Its
    export bytes and exporter identity are pinned afresh; comparisons still require exact identity.
    Same-contract rebuilds retain their original, stricter artifact identity requirement.
    """
    old_config, new_config = config_key(previous.get("effective_config")), config_key(current.get("effective_config"))
    old_inputs, new_inputs = input_key(previous.get("input_identity")), input_key(current.get("input_identity"))
    old_contract, new_contract = previous.get("runtime_contract"), current.get("runtime_contract")
    if old_contract == new_contract:
        return old_config == new_config and old_inputs == new_inputs
    if not contract_migration(old_contract, new_contract):
        return False
    if old_config["runtime_contract"] != old_contract or new_config["runtime_contract"] != new_contract:
        return False
    old_config["runtime_contract"] = new_contract
    account = old_config.get("account")
    if not isinstance(account, dict) or account.get("bar_execution") is not True:
        return False
    for name, value in {"execution": "bars", "liquidation_enabled": False, "margin_model": "default",
                        "initial_margin_rate": None, "maintenance_margin_rate": None}.items():
        account.setdefault(name, value)
    for values in (old_inputs, new_inputs):
        for name in ("export_content_sha256", "exporter_source_sha256"):
            values.pop(name, None)
    return old_config == new_config and old_inputs == new_inputs


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
    """The input identity without host roots and check times; every content key kept."""
    if not isinstance(value, Mapping):
        raise refuse("IDENTITY_MALFORMED", "the input identity is not a mapping",
                     expected="a mapping with " + ", ".join(INPUT_KEYS))
    missing = tuple(key for key in INPUT_KEYS if key not in value)
    if missing:
        raise refuse("IDENTITY_MALFORMED", "the input identity lacks " + ", ".join(missing), missing=missing)
    return {key: copy.deepcopy(item) for key, item in value.items()
            if not (str(key) == "root" or str(key).endswith("_root") or key == "checked")}


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
