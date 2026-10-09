"""Storage-independent research relationship and comparison contracts."""

from research.records.common import RecordError


COMPARISON_FIELDS = (
    "input_identity_sha256", "window", "account", "cost_model", "nautilus_version",
)


def _refuse(message, *, code, path, reason, next_actions, expected=None):
    raise RecordError(message + ". " + reason, code=code, path=path,
                      next_actions=next_actions, expected=expected,
                      write_status="not_written")


def _paired_control_ref(body, candidate_ref, relations):
    matches = [edge for edge in relations if edge["kind"] == "compared_with"
               and edge["from_id"] == candidate_ref["id"]
               and edge["from_revision"] == candidate_ref["revision"]]
    if len(matches) != 1:
        _refuse("paired decision requires one fixed registered control edge",
                code="decision_control_ambiguous", path="/decision/basis/candidate_run_ref",
                reason="The control must come from this exact candidate revision, never the latest run or a second declaration.",
                next_actions=["Inspect the candidate's compared_with edge at the fixed snapshot. Repair absent or ambiguous historical evidence separately; use a descriptive decision until a valid pair exists."])
    edge = matches[0]
    return {"id": edge["to_id"], "revision": edge["to_revision"]}


def decision_basis_refs(body, *, relations=()):
    """Return fixed endpoints, deriving a pair's control from its sealed run."""
    basis = body.get("decision", {}).get("basis", {})
    refs = [("candidate", basis["candidate_run_ref"])] if "candidate_run_ref" in basis else []
    if basis.get("mode") == "paired":
        refs.append(("control", _paired_control_ref(body, basis["candidate_run_ref"], relations)))
    return refs + [("evidence", ref) for ref in basis.get("evidence_refs", [])]


def publication_context_refs(body, *, relations=()):
    """Expose evidence and known exposure without duplicating payload bytes."""
    refs = decision_basis_refs(body, relations=relations)
    exposure = body.get("contract", {}).get("selection", {}).get("known_exposure", {})
    return refs + [("known_exposure", ref) for ref in exposure.get("run_refs", [])]


def validate_publication_contract(kind, body, *, previous=None, object_lookup=None,
                                  relations=()):
    """Reject locally testable contradictions before the storage transaction.

    JSON Schema owns field shapes. ``object_lookup(id, revision)`` reads fixed
    endpoints from the publication snapshot; it never silently selects latest.
    The port separately checks the fixed-revision graph and frozen registration.
    No identity string here constitutes authenticated independent review.
    """
    if kind == "run":
        if body.get("control_run_id") == body.get("run_id"):
            _refuse("a run cannot be its own control", code="self_control",
                    path="/control_run_id", reason="A comparison needs a distinct recorded run.",
                    next_actions=["Query the intended control run and submit its ID, or use null for a diagnostic run."])
        if body.get("evidence_grade") == "independent" and object_lookup is not None:
            initial = object_lookup("attempt:" + body["attempt_id"], 1)
            exposure = (initial or {}).get("body", {}).get("contract", {}).get("selection", {}).get("known_exposure", {})
            if exposure.get("status") == "development_exposed" or exposure.get("run_refs"):
                _refuse("independent grade contradicts registered result exposure",
                        code="EVIDENCE_EXPOSURE_CONTRADICTION", path="/evidence_grade",
                        reason="The initial contract already declares that results were inspected.",
                        next_actions=["Keep this run as development_exposed or unknown. Register a genuinely isolated confirmation separately; do not erase exposure history."])
        return
    if kind != "attempt":
        return
    identity = body["attempt_id"]
    decision = body["decision"]
    if previous is None and body.get("registration", {}).get("status") == "preregistered":
        if body.get("schema_version") != 3:
            _refuse("new preregistration requires the v3 research contract",
                    code="NEW_REGISTRATION_CONTRACT", path="/schema_version", expected=3,
                    reason="Historical v2 records stay readable; a new question must record the selection context before results.",
                    next_actions=["Discover the attempt contract and publish a pending v3 attempt with bounded purpose, family, primary response and known exposure."])
        if decision["layer"] != "pending" or decision["outcome"] != "pending":
            _refuse("first preregistration must have a pending/pending decision",
                    code="INITIAL_REGISTRATION_PENDING", path="/decision",
                    reason="A pre-result contract cannot include a learned outcome at its first publication.",
                    next_actions=["Publish the question and frozen plan as pending before inspecting new results; retain an already observed result as retrospective instead."])
    if (decision["layer"] == "pending") != (decision["outcome"] == "pending"):
        _refuse("pending decision layer and outcome must agree", code="pending_state_mismatch",
                path="/decision", expected="layer=pending iff outcome=pending",
                reason="A pending research question cannot simultaneously claim a completed result.",
                next_actions=["Keep both fields pending until evidence is available, or publish a completed layer and outcome with its evidence."])
    for field, key_fields in (("parents", ("attempt_id",)),
                              ("mechanism_refs", ("attempt_id", "component"))):
        seen = set()
        for index, ref in enumerate(body.get(field, [])):
            path = f"/{field}/{index}"
            if ref["attempt_id"] == identity:
                _refuse("an attempt cannot use itself as a parent or component source",
                        code="self_lineage", path=path,
                        reason="Research derivation needs a separate fixed source.",
                        next_actions=["Find the original source attempt and use its ID; a changed hypothesis needs a new attempt."])
            key = tuple(ref[name] for name in key_fields)
            if key in seen:
                _refuse("duplicate research source reference", code="duplicate_lineage",
                        path=path, reason="Repeating a source is not additional evidence.",
                        next_actions=["Keep one reference for this source and state its bounded derivation or reuse scope."])
            seen.add(key)

    def endpoint(ref, path, *, expected_kind=None):
        if object_lookup is None:
            _refuse("fixed research references require a snapshot lookup",
                    code="fixed_reference_lookup_required", path=path,
                    reason="An ID and revision alone do not establish that the evidence exists.",
                    next_actions=["Use the records publication or preflight interface to resolve references at one fixed Dolt snapshot."])
        obj = object_lookup(ref["id"], ref["revision"])
        if (obj is None or obj.get("id") != ref["id"] or obj.get("revision") != ref["revision"]
                or (expected_kind and obj.get("kind") != expected_kind)):
            _refuse(f"fixed research reference is unavailable or has the wrong kind: {ref}",
                    code="fixed_reference_unavailable", path=path,
                    expected=expected_kind or "existing object at this exact revision",
                    reason="Conclusions must point to the evidence actually reviewed, without rebinding to latest.",
                    next_actions=["Query the object at the fixed snapshot, then submit its exact ID and revision; do not invent a reference."])
        return obj

    selection = body.get("contract", {}).get("selection", {})
    exposure = selection.get("known_exposure", {})
    if exposure.get("status") == "unexposed_declared" and exposure.get("run_refs"):
        _refuse("inspected runs contradict the unexposed declaration", code="EXPOSURE_CONTRADICTION",
                path="/contract/selection/known_exposure/status",
                reason="The ledger already contains an explicit declaration that these results were inspected.",
                next_actions=["Retain the inspected run references and declare development_exposed or unknown; never remove known history to claim independent evidence."])
    if family := body.get("comparison_family"):
        for field in ("family_id", "primary_response"):
            if selection and selection[field] != family[field]:
                _refuse("realized comparison differs from the registered " + field,
                        code="SELECTION_CONTRACT_MISMATCH", path="/comparison_family/" + field,
                        expected=selection[field], reason="The initial selection family and primary response remain frozen after results.",
                        next_actions=["Use the registered selection context for this analysis; a changed objective requires a new attempt."])
    for index, ref in enumerate(exposure.get("run_refs", [])):
        endpoint(ref, f"/contract/selection/known_exposure/run_refs/{index}", expected_kind="run")
    basis = decision.get("basis")
    if basis is None:
        if body.get("schema_version") == 3 and decision["outcome"] != "pending":
            _refuse("a completed v3 decision requires fixed evidence basis",
                    code="decision_basis_required", path="/decision/basis",
                    reason="The next researcher must distinguish the decision's evidence from later diagnostic runs.",
                    next_actions=["Query the relevant runs or source objects and submit fixed basis references; keep the decision pending while evidence is incomplete."])
        return
    selected = {}
    for role, ref in decision_basis_refs(body, relations=relations):
        if role == "evidence":
            endpoint(ref, "/decision/basis/evidence_refs")
        else:
            selected[role] = endpoint(ref, "/decision/basis/candidate_run_ref", expected_kind="run")
    candidate = selected.get("candidate")
    if candidate and candidate["body"].get("attempt_id") != identity:
        _refuse("decision candidate run belongs to another attempt", code="decision_candidate_mismatch",
                path="/decision/basis/candidate_run_ref",
                reason="A decision must distinguish its own result from inherited or comparison evidence.",
                next_actions=["Select a run registered to this attempt; cite another attempt's run as supporting evidence instead."])
    if basis["mode"] != "paired":
        return
    candidate, control = selected["candidate"], selected["control"]
    left, right = candidate["body"], control["body"]
    if candidate["id"] == control["id"]:
        _refuse("paired decision cannot compare a run with itself", code="self_control",
                path="/decision/basis/candidate_run_ref", reason="A comparison needs distinct runs.",
                next_actions=["Query the separately registered control run and use its exact reference."])
    if (left.get("role") != "candidate" or right.get("role") != "control"
            or "run:" + str(left.get("control_run_id")) != control["id"]):
        _refuse("decision basis does not match registered candidate/control roles",
                code="decision_pair_role_mismatch", path="/decision/basis",
                reason="The decision cannot select a different control after observing its result.",
                next_actions=["Use the candidate's registered control and fixed revisions, or describe the result without a paired improvement claim."])
    if left.get("integrity") != "passed" or right.get("integrity") != "passed":
        _refuse("paired decision requires native integrity to pass on both runs",
                code="decision_pair_integrity", path="/decision/basis",
                reason="An execution failure cannot establish comparative account economics.",
                next_actions=["Inspect the fixed audits, repair the execution and register a new run; retain the failed diagnostic result."])
    mismatches = [field for field in COMPARISON_FIELDS
                  if field not in left or field not in right or left[field] != right[field]]
    modern = ["strategy_binding" in run for run in (left, right)]
    if modern[0] != modern[1]:
        mismatches.append("source_custody_backend")
    if all(modern):
        for field in ("image_digest", "platform", "runtime_contract"):
            if left.get("runtime_identity", {}).get(field) != right.get("runtime_identity", {}).get(field):
                mismatches.append("runtime_identity." + field)
        if left.get("effective_config_sha256") != right.get("effective_config_sha256"):
            mismatches.append("effective_config_sha256")
    if mismatches:
        _refuse("decision pair recorded contracts differ: " + ", ".join(mismatches),
                code="decision_pair_incomparable", path="/decision/basis",
                expected="same input, window, account, costs and runtime",
                reason="A changed comparison environment confounds the strategy effect.",
                next_actions=["Inspect the differing fields and register a comparable pair; use a descriptive engineering decision for an environment migration."])


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
    if any(
        selected[cell][field] != selected["00"][field]
        for cell in selected
        for field in COMPARISON_FIELDS
    ):
        raise RecordError(f"{identity}: four-cell recorded contracts differ")
