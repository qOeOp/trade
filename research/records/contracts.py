"""Storage-independent research relationship and comparison contracts."""

from research.records.common import RecordError


def _validate_records(attempts, runs):
    for item in attempts.values():
        for parent in item["parents"]:
            if parent["attempt_id"] not in attempts:
                raise RecordError(
                    f"{item['attempt_id']}: missing parent {parent['attempt_id']}"
                )
        for source in item.get("mechanism_refs", []):
            if source["attempt_id"] not in attempts:
                raise RecordError(
                    f"{item['attempt_id']}: missing mechanism source {source['attempt_id']}"
                )
    for item in runs.values():
        if item["attempt_id"] not in attempts:
            raise RecordError(f"{item['run_id']}: missing attempt {item['attempt_id']}")
        control = item["control_run_id"]
        if control is not None and control not in runs:
            raise RecordError(f"{item['run_id']}: missing control run {control}")
    for item in attempts.values():
        if family := item.get("comparison_family"):
            _check_family(item, family, attempts, runs)


def _check_family(
    item: dict, family: dict, attempts: dict[str, dict], runs: dict[str, dict]
) -> None:
    identity = item["attempt_id"]
    if item.get("composition_mode") != "factorial":
        raise RecordError(
            f"{identity}: four-cell family requires factorial composition"
        )
    factors = {family["factor_a_attempt_id"], family["factor_b_attempt_id"]}
    if len(factors) != 2 or not factors.issubset(attempts):
        raise RecordError(f"{identity}: missing or duplicated factor attempts")
    parent_ids = {
        parent["attempt_id"]
        for parent in item["parents"]
        if parent["relationship"] == "composition"
    }
    if parent_ids != factors:
        raise RecordError(f"{identity}: composition parents differ from factors")
    expected_attempts = {
        "00": family["origin_attempt_id"],
        "10": family["factor_a_attempt_id"],
        "01": family["factor_b_attempt_id"],
        "11": identity,
    }
    if len(set(family["cells"].values())) != 4:
        raise RecordError(f"{identity}: four-cell run IDs are duplicated")
    selected = {}
    for cell, run_id in family["cells"].items():
        run = runs.get(run_id)
        if run is None or run["attempt_id"] != expected_attempts[cell]:
            raise RecordError(f"{identity}: {cell} missing or belongs to wrong attempt")
        if run["role"] != ("candidate" if cell == "11" else "control"):
            raise RecordError(f"{identity}: {cell} has wrong candidate/control role")
        selected[cell] = run
    if selected["11"]["control_run_id"] != family["cells"]["10"]:
        raise RecordError(f"{identity}: 11 must register 10 as direct control")
    fields = (
        "input_identity_sha256",
        "window",
        "account",
        "cost_model",
        "nautilus_version",
    )
    if any(
        selected[cell][field] != selected["00"][field]
        for cell in selected
        for field in fields
    ):
        raise RecordError(f"{identity}: four-cell recorded contracts differ")
