"""Explicit Agent admission of compact knowledge; storage remains with Dolt.

An import or reference review never constitutes knowledge admission. The Agent
owns the value judgement; this boundary verifies its fixed evidence and recipe.
"""

from __future__ import annotations

import hashlib
import copy
import re
from pathlib import Path

from research.records.common import ROOT, RecordError, _is_temporary_path
from research.records.store import canonical
from research.records.dolt_store import ConflictError
from research.records.migration import original_bytes


def _refusal(message, *, code, path, expected, next_actions, conflict=False):
    """A local pre-publication refusal; transport failures keep their status."""
    error = ConflictError if conflict else RecordError
    return error(message, code=code, path=path, expected=expected,
                 next_actions=next_actions, write_status="not_written")


def _operation_conflict():
    return _refusal(
        "retention operation-content conflict", code="ADMISSION_OPERATION_CONFLICT",
        path="/operation_id", expected="the exact original payload for an existing operation ID",
        next_actions=["This rejected retry wrote nothing; the original operation may already be committed. Read its receipt and fixed admission first. Retry only its original payload with the same operation ID. A changed judgement or evidence requires a new reviewed operation; do not edit content and reuse the old ID."],
        conflict=True)


def _text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise _refusal(
            f"retention {field} must explain the Agent's judgement",
            code="ADMISSION_DECLARATION_REQUIRED", path="/" + field.replace(".", "/"),
            expected="a nonempty statement of the actual review or judgement",
            next_actions=["State the actual reviewer or judgement for this field. Preserve uncertainty and failed evidence in claim.limitations; do not invent a review, proof or decision value to pass validation."])


def _aliases(value):
    """A reviewed component name mapping, not inferred semantic equivalence."""
    if (not isinstance(value, list) or not 1 <= len(value) <= 8
            or any(not isinstance(alias, str) or alias != alias.strip()
                   or not 1 <= len(alias) <= 80
                   or any(ord(char) < 32 for char in alias) for alias in value)
            or len({alias.casefold() for alias in value}) != len(value)):
        raise RecordError(
            "claim.aliases requires 1 to 8 distinct short component names",
            code="ADMISSION_ALIASES_INVALID", path="/claim/aliases",
            expected="1..8 unique trimmed names of 1..80 characters",
            next_actions=["Keep only reviewed names for this fixed component. Explain their scope in the existing claim; do not invent translations or expand a general word into a mechanism."],
            write_status="not_written")


def _external_ref(ref, field):
    location = "/retention/" + field
    if not isinstance(ref, dict) or set(ref) != {"path", "sha256"}:
        raise _refusal(f"retention {field} requires path and sha256",
                       code="RECONSTRUCTION_INPUT_SHAPE", path=location,
                       expected={"path": "absolute retained file", "sha256": "its lowercase SHA-256"},
                       next_actions=["Supply the actual retained original and its measured hash, or a fixed material id/revision. A description of a recipe is not its original bytes."])
    if not isinstance(ref["path"], str) or not isinstance(ref["sha256"], str):
        raise _refusal(f"retention {field} requires string path and sha256",
                       code="RECONSTRUCTION_INPUT_SHAPE", path=location,
                       expected="string path and string sha256",
                       next_actions=["Supply the actual retained file path and measured SHA-256 as strings; do not fabricate a source or hash."])
    try:
        path = Path(ref["path"]).expanduser()
        external_file = path.is_absolute() and not path.is_symlink()
        resolved = path.resolve()
    except (OSError, RuntimeError, ValueError) as exc:
        raise _refusal(f"retention {field} must be an absolute external file",
                       code="RECONSTRUCTION_PATH_INVALID", path=location + "/path",
                       expected="a valid absolute path to the retained original file",
                       next_actions=["Supply the actual retained file path available in this environment. Resolve missing home expansion or invalid path syntax without substituting fabricated evidence."]) from exc
    if not external_file:
        raise _refusal(f"retention {field} must be an absolute external file",
                       code="RECONSTRUCTION_PATH_INVALID", path=location + "/path",
                       expected="an absolute path to the retained file, not a symlink",
                       next_actions=["Retain the actual original at an absolute external file path and recalculate its hash. Keep custody failures explicit rather than substituting generated proof."])
    if resolved.is_relative_to(ROOT.resolve()) or _is_temporary_path(resolved):
        raise _refusal(f"retention {field} must be outside Git and /tmp or the system temp directory",
                       code="RECONSTRUCTION_CUSTODY_PATH", path=location + "/path",
                       expected="a retained original outside the product checkout and temporary directories",
                       next_actions=["Copy the verified original to durable storage outside Git and temporary directories, then supply that path and its measured hash. Do not claim recoverability before retaining the bytes."])
    try:
        matches = resolved.is_file() and hashlib.sha256(resolved.read_bytes()).hexdigest() == ref["sha256"]
    except OSError as exc:
        raise _refusal(f"retention {field} is unavailable or has a hash mismatch",
                       code="RECONSTRUCTION_INPUT_UNAVAILABLE", path=location,
                       expected="a readable retained file matching the supplied SHA-256",
                       next_actions=["Restore access to the actual original and verify its bytes and hash. Do not replace the expected hash with an unverified file's hash or claim reconstruction succeeded."]) from exc
    if not matches:
        raise _refusal(f"retention {field} is unavailable or has a hash mismatch",
                       code="RECONSTRUCTION_INPUT_UNAVAILABLE", path=location,
                       expected="a readable retained file matching the supplied SHA-256",
                       next_actions=["Locate the expected original and verify its hash before retrying. Preserve missing or mismatched custody as a failure; do not edit a hash merely to pass validation."])


def _material_bytes(obj, field):
    location = "/retention/" + field
    if obj["kind"] != "material":
        raise _refusal(f"retention {field} must identify retained material bytes",
                       code="RECONSTRUCTION_MATERIAL_KIND", path=location,
                       expected="a fixed material object with retained original bytes",
                       next_actions=["Choose the fixed material containing the actual recipe or verification original. A run receipt or generated summary does not replace the original."])
    try:
        if not isinstance(obj.get("body"), dict) or not isinstance(obj.get("provenance"), dict):
            raise ValueError("invalid fixed material structure")
        raw = original_bytes(obj)
    except (RecordError, TypeError, ValueError) as exc:
        raise _refusal(f"retention {field} has invalid original bytes",
                       code="RECONSTRUCTION_MATERIAL_BYTES", path=location,
                       expected="decodable original bytes whose SHA-256 matches the fixed material",
                       next_actions=["Inspect the fixed material and restore the verified original through a new material revision. Keep the corrupt or missing evidence visible; do not rewrite historical bytes or fabricate proof."]) from exc
    if type(obj["body"].get("byte_length")) is not int or obj["body"]["byte_length"] != len(raw):
        raise _refusal(f"retention {field} original byte length mismatch",
                       code="RECONSTRUCTION_MATERIAL_LENGTH", path=location,
                       expected="fixed material byte_length equal to its verified original bytes",
                       next_actions=["Verify the actual original's length and hash. Publish corrected material at a new revision and cite it; do not mutate the fixed historical object."])
    return raw


def _reconstruction_materials(adapter, retention, *, commit):
    """Keep existing material bytes and fixed refs; paths are only import inputs."""
    from research.records.reviews import retain_file
    materials = {}
    for field in ("recipe_ref", "verification_ref"):
        ref = retention.get(field)
        if isinstance(ref, dict) and set(ref) == {"path", "sha256"}:
            if not isinstance(ref["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", ref["sha256"]):
                raise _refusal(f"retention {field} requires a lowercase SHA-256",
                               code="RECONSTRUCTION_HASH_INVALID", path="/retention/" + field + "/sha256",
                               expected="64 lowercase hexadecimal characters measured from the original file",
                               next_actions=["Measure SHA-256 from the retained original; do not invent a checksum or substitute a report-only reference."])
            _external_ref(ref, field)
            try:
                incoming = retain_file(ref["path"], ref["sha256"], origin="retention_reconstruction_evidence")
            except (OSError, RecordError) as exc:
                raise _refusal(f"retention {field} is unavailable or has a hash mismatch",
                               code="RECONSTRUCTION_INPUT_UNAVAILABLE", path="/retention/" + field,
                               expected="unchanged readable original bytes matching the supplied SHA-256",
                               next_actions=["Check whether the retained file changed or became unreadable while preparing admission. Restore and verify the actual original before retrying; do not replace it with generated proof."]) from exc
            obj = adapter.get_object(incoming["id"], revision=1, commit=commit)
            if obj is None:
                obj = incoming
            elif _material_bytes(obj, field) != _material_bytes(incoming, field):
                raise _refusal(f"retention {field} stored original bytes conflict",
                               code="RECONSTRUCTION_MATERIAL_CONFLICT", path="/retention/" + field,
                               expected="the already stored fixed material bytes to match the verified original",
                               next_actions=["Stop and inspect the stored material and original. Preserve the conflict for investigation; do not overwrite historical evidence to make admission pass."], conflict=True)
        elif (isinstance(ref, dict) and set(ref) == {"id", "revision"}
              and isinstance(ref["id"], str) and ref["id"]
              and type(ref["revision"]) is int and ref["revision"] > 0):
            obj = adapter.get_object(ref["id"], revision=ref["revision"], commit=commit)
            if obj is None:
                raise _refusal(f"retention {field} fixed material is unavailable: {ref}",
                               code="RECONSTRUCTION_MATERIAL_UNAVAILABLE", path="/retention/" + field,
                               expected="an existing material id/revision in the fixed publication snapshot",
                               next_actions=["Read the exact fixed material reference. Retain and publish the actual original if it is absent, then cite its returned id/revision; do not guess an identifier or revision."])
        else:
            raise _refusal(f"retention {field} requires a fixed material id/revision or verified path/sha256 input",
                           code="RECONSTRUCTION_REFERENCE_INVALID", path="/retention/" + field,
                           expected="exactly id and positive revision, or exactly retained path and measured sha256",
                           next_actions=["Supply a fixed original-material reference or a verified retained file input. If reconstruction has not been verified, preserve that limitation instead of inventing a verification receipt."])
        _material_bytes(obj, field)
        retention[field] = {"id": obj["id"], "revision": obj["revision"]}
        materials[obj["id"], obj["revision"]] = obj
    return list(materials.values())


def publish(adapter, body, *, operation_id, expected_version):
    allowed = {"schema_version", "target", "disposition", "reviewer", "purpose",
               "value_basis", "claim", "evidence", "retention"}
    if not isinstance(body, dict) or set(body) != allowed or type(body["schema_version"]) is not int or body["schema_version"] not in (1, 2, 3):
        missing = sorted(allowed - set(body)) if isinstance(body, dict) else []
        raise _refusal("retention decision requires the v1, v2 or v3 admission contract",
                       code="ADMISSION_CONTRACT_INVALID", path="/" + missing[0] if missing else "/",
                       expected={"required_fields": sorted(allowed), "schema_versions": [1, 2, 3]},
                       next_actions=["Use the admission contract and supply the actual reviewed target, evidence and judgement. Remove unsupported fields; do not invent missing review or evidence. New rebuildable admissions require version 3."])
    if body["disposition"] not in ("knowledge", "archive"):
        raise _refusal("retention disposition must be knowledge or archive",
                       code="ADMISSION_DISPOSITION_INVALID", path="/disposition", expected=["knowledge", "archive"],
                       next_actions=["Choose knowledge only for a reviewed bounded conclusion with decision value. Use archive for source custody or unsupported conclusions; preserve failed and uncertain evidence."])
    for field in ("reviewer", "purpose", "value_basis"):
        _text(body[field], field)
    claim = body["claim"]
    required_claim = {"statement", "scope", "decision_impact", "limitations"}
    optional_claim = {"aliases"} if body["schema_version"] >= 2 else set()
    if not isinstance(claim, dict) or not required_claim <= set(claim) or set(claim) - required_claim - optional_claim:
        missing = sorted(required_claim - set(claim)) if isinstance(claim, dict) else []
        raise _refusal("retention claim requires statement, scope, decision_impact and limitations",
                       code="ADMISSION_CLAIM_INVALID", path="/claim/" + missing[0] if missing else "/claim",
                       expected={"required_fields": sorted(required_claim), "optional_fields": sorted(optional_claim)},
                       next_actions=["Describe the evidence-supported statement, its scope, the actual next decision it changes and its limitations. Keep uncertainty or failure explicit; do not add prose merely to simulate value."])
    for field in ("statement", "scope", "decision_impact", "limitations"):
        _text(claim[field], "claim." + field)
    if "aliases" in claim:
        _aliases(claim["aliases"])
    if len(canonical(claim).encode()) > 8192:
        raise _refusal("knowledge claim must be compact; cite detailed evidence instead",
                       code="ADMISSION_CLAIM_TOO_LARGE", path="/claim", expected="at most 8192 UTF-8 bytes",
                       next_actions=["Keep the conclusion, scope, decision impact and limitations compact. Retain detailed original evidence separately and cite its fixed id/revision; do not drop uncertainty or negative results to shorten the claim."])
    retention = body["retention"]
    if not isinstance(retention, dict) or not {"mode", "reason"} <= set(retention):
        missing = sorted({"mode", "reason"} - set(retention)) if isinstance(retention, dict) else []
        raise _refusal("retention requires an explicit mode and reason",
                       code="ADMISSION_RETENTION_INVALID", path="/retention/" + missing[0] if missing else "/retention",
                       expected="retention with explicit mode and nonempty reason",
                       next_actions=["Choose a custody mode based on the actual retained evidence and explain why it is needed. Do not claim rebuildability before its original recipe and verification are available."])
    if set(retention) - {"mode", "reason", "recipe_ref", "verification_ref"}:
        raise _refusal("unknown retention field", code="ADMISSION_RETENTION_INVALID", path="/retention",
                       expected="only mode, reason, recipe_ref and verification_ref",
                       next_actions=["Use existing retention fields and fixed evidence relations. Remove unsupported fields without removing relevant factual limitations from the claim."])
    if retention["mode"] not in ("minimal_record", "irreplaceable", "rebuildable"):
        raise _refusal("unknown retention mode", code="ADMISSION_RETENTION_MODE", path="/retention/mode",
                       expected=["minimal_record", "irreplaceable", "rebuildable"],
                       next_actions=["Choose the mode supported by actual custody. Rebuildable requires retained recipe and verification originals; otherwise retain irreplaceable evidence or the minimal reviewed record as appropriate."])
    _text(retention["reason"], "retention.reason")
    if retention["mode"] != "rebuildable" and ("recipe_ref" in retention or "verification_ref" in retention):
        raise _refusal("reconstruction references require rebuildable mode",
                       code="ADMISSION_RECONSTRUCTION_MODE", path="/retention/mode", expected="rebuildable when reconstruction references are supplied",
                       next_actions=["Use rebuildable only if both original recipe and verification are retained. For another custody mode, omit reconstruction references and preserve any unverified reconstruction limitation in the claim."])
    if not isinstance(operation_id, str) or not operation_id or len(operation_id) > 160:
        raise _refusal("retention operation_id must be nonempty and at most 160 characters",
                       code="ADMISSION_OPERATION_INVALID", path="/operation_id", expected="a nonempty operation ID of at most 160 characters",
                       next_actions=["Assign one operation ID to this exact publication intent. Keep the same ID and original payload for uncertain retries; changed intent requires a new operation after checking the original receipt."])
    status = adapter.status()
    if status["dirty"]:
        raise _refusal("retention publication requires a clean Dolt working set",
                       code="ADMISSION_DIRTY_WORKING_SET", path="/database/working_set", expected="a clean Dolt working set",
                       next_actions=["Inspect the uncommitted database changes and their owner before publication. Resolve them explicitly; do not automatically discard or commit another Agent's changes to pass validation."])
    context_id = "publication:" + hashlib.sha256(operation_id.encode()).hexdigest()
    context = adapter.get_object(context_id, commit=status["commit"])
    fixed = context["body"]["base_commit"] if context else status["commit"]
    input_sha256 = hashlib.sha256(canonical(body).encode()).hexdigest()
    identity = "retention:" + hashlib.sha256(canonical(body["target"]).encode()).hexdigest()
    materials = []
    if body["schema_version"] == 3:
        body = copy.deepcopy(body)
        retention = body["retention"]
        if context:
            stored = adapter.get_object(identity, revision=context["body"]["record_revision"], commit=status["commit"])
            if (context["body"]["record_id"] != identity or stored is None
                    or context["provenance"].get("input_sha256") != input_sha256):
                raise _operation_conflict()
            if retention["mode"] == "rebuildable":
                for field in ("recipe_ref", "verification_ref"):
                    retention[field] = copy.deepcopy(stored["body"]["retention"].get(field))
        if retention["mode"] == "rebuildable":
            materials = _reconstruction_materials(adapter, retention,
                                                  commit=status["commit"] if context else fixed)
    elif context is None and retention["mode"] == "rebuildable":
        raise RecordError(
            "new rebuildable admissions require v3 fixed material custody",
            code="REBUILDABLE_CONTRACT_VERSION", path="/schema_version", expected=3,
            next_actions=["Use schema_version 3. Supply fixed material id/revision references or retained path/sha256 inputs; publication keeps the verified original bytes in Dolt."],
            write_status="not_written")

    def endpoint(ref, location):
        if not isinstance(ref, dict) or set(ref) != {"id", "revision"} or not isinstance(ref["id"], str) or type(ref["revision"]) is not int or ref["revision"] < 1:
            raise _refusal("retention evidence requires a fixed id and positive revision",
                           code="ADMISSION_REFERENCE_INVALID", path=location,
                           expected={"id": "existing object ID", "revision": "positive integer fixed revision"},
                           next_actions=["Read the actual record at a fixed Dolt snapshot and cite its returned id/revision. Do not guess an ID or substitute the latest revision for evidence you reviewed."])
        obj = adapter.get_object(ref["id"], revision=ref["revision"], commit=fixed)
        if obj is None:
            raise _refusal(f"retention endpoint unavailable: {ref}",
                           code="ADMISSION_REFERENCE_UNAVAILABLE", path=location,
                           expected="the exact referenced object at the fixed publication snapshot",
                           next_actions=["Locate and inspect the exact evidence revision. If the original is unavailable, preserve that custody failure and withhold unsupported knowledge; do not fabricate or silently upgrade the reference."])
        return obj

    target = endpoint(body["target"], "/target")
    if "aliases" in claim and target["kind"] != "component":
        raise RecordError(
            "reviewed aliases must bind a fixed component target",
            code="ADMISSION_ALIASES_TARGET", path="/target",
            expected="component object at a fixed revision",
            next_actions=["Use the existing component and its fixed source relations, then review only its bounded names. Keep general material and research statements in the original claim fields."],
            write_status="not_written")
    if body["disposition"] == "knowledge":
        if target["kind"] not in ("attempt", "material_section", "component"):
            raise _refusal("raw payloads and operational receipts cannot be admitted as knowledge",
                           code="ADMISSION_TARGET_KIND", path="/target", expected="a fixed attempt, material_section or component",
                           next_actions=["Admit the bounded reviewed conclusion represented by an existing attempt, material section or component. Keep raw payloads and engineering receipts as archive evidence; do not relabel them to bypass admission."])
        if target["kind"] == "attempt" and target["body"].get("decision", {}).get("outcome") == "pending":
            raise _refusal("a pending attempt cannot be admitted as learned knowledge",
                           code="ADMISSION_TARGET_PENDING", path="/target", expected="a reviewed attempt whose decision is no longer pending",
                           next_actions=["Finish and publish the actual research decision with fixed evidence before knowledge admission. Failed or inconclusive results may be useful; do not mark success merely to pass this gate."])
        current = adapter.get_object(target["id"], commit=fixed)
        if current["revision"] != target["revision"]:
            raise _refusal("knowledge admission must review the current target revision",
                           code="ADMISSION_TARGET_STALE", path="/target/revision", expected=current["revision"],
                           next_actions=["Read and independently review the current target revision and its corrections before preparing a new admission operation. Do not replace the revision number without reviewing the changed evidence."])
    if not isinstance(body["evidence"], list) or not body["evidence"]:
        raise _refusal("retention admission requires fixed supporting evidence",
                       code="ADMISSION_EVIDENCE_REQUIRED", path="/evidence", expected="a nonempty list of fixed id/revision evidence references",
                       next_actions=["Cite the actual evidence supporting the bounded claim and limitations. If evidence is missing or contradictory, retain that failure explicitly and withhold unsupported knowledge; do not create invented proof."])
    evidence = [endpoint(ref, f"/evidence/{index}") for index, ref in enumerate(body["evidence"])]
    previous = adapter.get_object(identity, commit=fixed)
    if context:
        obj = adapter.get_object(identity, revision=context["body"]["record_revision"], commit=status["commit"])
        if context["body"]["record_id"] != identity or obj is None or canonical(obj["body"]) != canonical(body):
            raise _operation_conflict()
    elif previous and canonical(previous["body"]) == canonical(body):
        obj = previous
    else:
        obj = {"id": identity, "kind": "retention_decision",
               "revision": 1 if previous is None else previous["revision"] + 1,
               "body": body, "provenance": {"origin": "agent_retention_review"}}
    if context is None:
        context = {"id": context_id, "kind": "publication", "revision": 1,
                   "body": {"record_id": identity, "record_revision": obj["revision"], "base_commit": fixed},
                   "provenance": {"origin": "retention_publication", "operation_id": operation_id,
                                  **({"input_sha256": input_sha256} if body["schema_version"] == 3 else {})}}
    relations = []
    for kind, selected in [("retention_of", target), *[("admission_evidence", item) for item in [*evidence, *materials]]]:
        edge = {"kind": kind, "from_id": obj["id"], "from_revision": obj["revision"],
                "from_kind": obj["kind"], "to_id": selected["id"],
                "to_revision": selected["revision"], "to_kind": selected["kind"], "body": {}}
        edge["id"] = "edge:" + hashlib.sha256(canonical(edge).encode()).hexdigest()
        relations.append(edge)
    return adapter.publish([*materials, obj, context], relations, operation_id, expected_version,
                           "review research knowledge retention")
