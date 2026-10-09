"""Agent API for versioned research records, materials and native-run comparison.

The records expose fixed research contracts, decisions and native evidence.
This tool never runs a backtest or promotes development evidence into strategy
qualification.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from decimal import Decimal
from pathlib import Path

from research.records.common import ROOT
from research.records.common import RecordError
from research.records.common import _check_commit
from research.records.common import _read_json
from research.records.contracts import _check_family, _validate_records


def _repo_file(ref: dict) -> Path:
    if ref["path"].startswith("artifact://"):
        root = os.environ.get("TRADE_RESEARCH_ARTIFACT_ROOT")
        if not root:
            raise RecordError("TRADE_RESEARCH_ARTIFACT_ROOT is required")
        relative = Path(ref["path"].removeprefix("artifact://"))
        base = Path(root).resolve()
        path = (base / relative).resolve()
        if not path.is_relative_to(base) or len(relative.parts) < 2:
            raise RecordError(f"invalid artifact path: {ref['path']}")
        return path
    path = (ROOT / ref["path"]).resolve()
    if not path.is_relative_to(ROOT):
        raise RecordError(f"path escapes repository: {ref['path']}")
    return path


def _check_ref(ref: dict) -> str:
    raw = _evidence_bytes(ref)
    if raw is None:
        return "unavailable"
    if ref.get("sha256") is None:
        return "unverified"
    digest = hashlib.sha256(raw).hexdigest()
    if digest != ref["sha256"]:
        raise RecordError(f"hash mismatch: {ref['path']}")
    return "verified"


def _evidence_bytes(ref: dict) -> bytes | None:
    from research.records.history import read_archive_bytes, relative_path
    if not ref["path"].startswith("artifact://"):
        relative_path(ref["path"])
    path = _repo_file(ref)
    if path.is_file():
        return path.read_bytes()
    if ref["path"].startswith("artifact://"):
        return None
    return read_archive_bytes(ref["path"], ROOT)


def _read_evidence_json(ref: dict) -> dict:
    """Read hash-verified current, artifact or explicitly archived source bytes."""
    raw = _evidence_bytes(ref)
    if raw is None:
        raise RecordError(f"evidence is unavailable: {ref['path']}")
    if ref.get("sha256") is None:
        raise RecordError(f"evidence is unverified: {ref['path']}")
    if hashlib.sha256(raw).hexdigest() != ref["sha256"]:
        raise RecordError(f"hash mismatch: {ref['path']}")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RecordError(f"invalid evidence JSON: {ref['path']}") from exc
    if not isinstance(value, dict):
        raise RecordError(f"evidence must be a JSON object: {ref['path']}")
    return value


def _check_source_revision(run: dict) -> str:
    if "strategy_binding" in run:
        from research.records.artifacts import ArtifactError, verify
        from research.records.runtime import validate_identity
        from research.records.store import open_store
        from research.records.strategies import validate_binding
        if "source_revision" in run:
            raise RecordError(f"{run['run_id']}: conflicting Git and Dolt strategy identities")
        store = open_store()
        if not hasattr(store, "adapter"):
            raise RecordError("Dolt strategy source validation requires its database owner")
        validate_binding(store.adapter, run["strategy_binding"])
        validate_identity(run["runtime_identity"])
        ref = run.get("artifact_manifest_ref")
        if ref is None:
            raise RecordError(f"{run['run_id']}: Dolt/OCI run has no sealed execution manifest")
        manifest = _read_evidence_json(ref)
        for field in ("strategy_binding", "runtime_identity", "effective_config_sha256"):
            if manifest.get(field) != run[field]:
                raise RecordError(f"{run['run_id']}: {field} differs from sealed manifest")
        try:
            verify(Path(os.environ["TRADE_RESEARCH_ARTIFACT_ROOT"]), run["run_id"])
        except (ArtifactError, OSError, KeyError) as exc:
            raise RecordError(f"{run['run_id']}: sealed source verification failed: {exc}") from exc
        if run["source_files_sha256"].get("strategy_source_sha256") != run["strategy_binding"]["source_sha256"]:
            raise RecordError(f"{run['run_id']}: source digest differs from Dolt binding")
        return "verified_dolt_oci"
    revision = run.get("source_revision")
    if revision is None:
        return "unknown"
    commit = revision["commit"]
    if _check_commit(commit) != "present":
        raise RecordError(f"{run['run_id']}: source commit is unavailable: {commit}")
    for field, path in revision["files"].items():
        if field not in run["source_files_sha256"]:
            raise RecordError(
                f"{run['run_id']}: source field is not in native summary: {field}"
            )
        if path.startswith("/") or ".." in Path(path).parts:
            raise RecordError(f"{run['run_id']}: invalid source path: {path}")
        result = subprocess.run(
            ["git", "show", f"{commit}:{path}"],
            cwd=ROOT,
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            raise RecordError(
                f"{run['run_id']}: source file is unavailable at {commit}: {path}"
            )
        actual = hashlib.sha256(result.stdout).hexdigest()
        if actual != run["source_files_sha256"][field]:
            raise RecordError(f"{run['run_id']}: source revision hash mismatch: {path}")
    return "verified"


def _load_records(store=None, commit=None) -> tuple[dict[str, dict], dict[str, dict]]:
    from research.records.store import open_store
    attempts, runs, _ = (store or open_store()).snapshot(commit)
    _validate_records(attempts, runs)
    return attempts, runs


def _lineage(
    identity: str, attempts: dict[str, dict], seen: frozenset[str] = frozenset()
) -> dict:
    if identity in seen:
        raise RecordError(f"cycle in hypothesis lineage at {identity}")
    attempt = attempts[identity]
    return {
        "attempt_id": identity,
        "hypothesis": attempt["hypothesis"],
        "decision": attempt["decision"],
        "composition_mode": attempt.get("composition_mode"),
        "mechanism_sources": [
            {
                **source,
                "source_decision": attempts[source["attempt_id"]]["decision"],
            }
            for source in attempt.get("mechanism_refs", [])
        ],
        "parents": [
            {
                "relationship": parent["relationship"],
                "difference": parent["difference"],
                "record": _lineage(parent["attempt_id"], attempts, seen | {identity}),
            }
            for parent in attempt["parents"]
        ],
    }


def _dolt_lineage(adapter, identity, commit, revision=None, seen=frozenset()):
    obj = adapter.get_object("attempt:" + identity, revision=revision, commit=commit)
    if obj is None:
        raise RecordError(f"missing lineage revision: {identity}@{revision}")
    key = (obj["id"], obj["revision"])
    if key in seen:
        raise RecordError(f"cycle in fixed lineage: {key}")
    edges = [edge for edge in adapter.list_relations(commit=commit)
             if (edge["from_id"], edge["from_revision"]) == key]
    body = obj["body"]

    def endpoint(kind, target, detail):
        matches = [edge for edge in edges if edge["kind"] == kind and edge["to_id"] == "attempt:" + target
                   and edge["body"].get("reference", edge["body"]) == detail]
        revisions = {edge["to_revision"] for edge in matches}
        if len(revisions) != 1:
            raise RecordError(f"missing or ambiguous fixed {kind} relation: {key} -> {target}")
        return revisions.pop()

    sources = []
    for source in body.get("mechanism_refs", []):
        fixed = endpoint("component_reuse", source["attempt_id"], source)
        source_obj = adapter.get_object("attempt:" + source["attempt_id"], revision=fixed, commit=commit)
        sources.append({**source, "source_revision": fixed, "source_decision": source_obj["body"]["decision"]})
    parents = []
    for parent in body["parents"]:
        fixed = endpoint(parent["relationship"], parent["attempt_id"], parent)
        parents.append({"relationship": parent["relationship"], "difference": parent["difference"],
                        "record": _dolt_lineage(adapter, parent["attempt_id"], commit, fixed, seen | {key})})
    return {"attempt_id": identity, "revision": obj["revision"], "commit": commit,
            "hypothesis": body["hypothesis"], "decision": body["decision"],
            "composition_mode": body.get("composition_mode"), "mechanism_sources": sources, "parents": parents}


def _summary(run: dict) -> dict:
    summary = _read_evidence_json(run["summary_ref"])
    expected = run["window"]
    actual = (
        summary.get("input_start_utc"),
        summary.get("period_start_utc"),
        summary.get("period_end_utc"),
        summary.get("data_interval_minutes"),
    )
    recorded = (
        expected["input_start_utc"],
        expected["trade_start_utc"],
        expected["end_utc"],
        expected["bar_minutes"],
    )
    if actual != recorded:
        raise RecordError(f"{run['run_id']}: window does not match native summary")
    if (
        summary.get("account_model") != run["account"]["model"]
        or summary.get("starting_balance_usdt")
        != run["account"]["starting_balance_usdt"]
        or summary.get("sizing") != run["account"]["sizing"]
    ):
        raise RecordError(
            f"{run['run_id']}: account contract does not match native summary"
        )
    if bool(summary.get("integrity_passed")) != (run["integrity"] == "passed"):
        raise RecordError(
            f"{run['run_id']}: integrity status disagrees with native summary"
        )
    for field, digest in run["source_files_sha256"].items():
        if summary.get(field) != digest:
            raise RecordError(
                f"{run['run_id']}: {field} digest disagrees with native summary"
            )
    if "strategy_binding" in run:
        for field in ("strategy_binding", "runtime_identity", "effective_config_sha256"):
            if summary.get(field) != run[field]:
                raise RecordError(f"{run['run_id']}: {field} disagrees with native summary")
    return summary


def _validate(attempts: dict[str, dict], runs: dict[str, dict], *, check_lineage=True) -> dict:
    if check_lineage:
        for identity in attempts:
            _lineage(identity, attempts)
    statuses = {}
    commits = {}
    source_revisions = {}
    family_evidence = {}
    for identity, attempt in attempts.items():
        statuses[identity] = [_check_ref(ref) for ref in attempt["evidence_refs"]]
        commits[identity] = {
            "code_parent": _check_commit(attempt["code_parent"])
            if attempt["code_parent"]
            else "unknown",
        }
        if family := attempt.get("comparison_family"):
            family_evidence[identity] = _check_ref(family["analysis_ref"])
            if family_evidence[identity] != "verified":
                raise RecordError(f"{identity}: four-cell analysis is unavailable")
    for run in runs.values():
        if run["raw_reports"] in ("sealed_local", "durable"):
            ref = run.get("artifact_manifest_ref")
            if ref is None or _check_ref(ref) != "verified":
                raise RecordError(f"{run['run_id']}: sealed manifest unavailable")
            from research.records.artifacts import verify
            from research.records.artifacts import ArtifactError

            relative = ref["path"].removeprefix("artifact://")
            if relative != f"{run['run_id']}/manifest.json":
                raise RecordError(f"{run['run_id']}: manifest path differs from run ID")
            try:
                checked = verify(
                    Path(os.environ["TRADE_RESEARCH_ARTIFACT_ROOT"]), run["run_id"]
                )
            except (ArtifactError, OSError) as exc:
                raise RecordError(
                    f"{run['run_id']}: sealed artifact verification failed: {exc}"
                ) from exc
            if checked["status"] != run["integrity"]:
                raise RecordError(f"{run['run_id']}: seal and integrity disagree")
        if run["integrity"] != "passed":
            source_revisions[run["run_id"]] = _check_source_revision(run)
            continue
        _summary(run)
        source_revisions[run["run_id"]] = _check_source_revision(run)
        if _check_ref(run["audit_ref"]) != "verified":
            raise RecordError(f"{run['run_id']}: native audit is unavailable")
        audit = _read_evidence_json(run["audit_ref"])
        if bool(audit.get("passed")) != (run["integrity"] == "passed"):
            raise RecordError(f"{run['run_id']}: audit status disagrees with record")
    return {
        "attempts": len(attempts),
        "runs": len(runs),
        "attempt_evidence_status": statuses,
        "commit_status": commits,
        "source_revision_status": source_revisions,
        "comparison_evidence_status": family_evidence,
    }


def _show(identity: str, attempts: dict[str, dict], runs: dict[str, dict], lineage=None) -> dict:
    if identity not in attempts:
        raise RecordError(f"unknown attempt: {identity}")
    attempt = attempts[identity]
    return {
        "attempt": attempt,
        "lineage": lineage or _lineage(identity, attempts),
        "runs": [run for run in runs.values() if run["attempt_id"] == identity],
        "comparison_runs": (
            {
                cell: runs[run_id]
                for cell, run_id in attempt["comparison_family"]["cells"].items()
            }
            if attempt.get("comparison_family")
            else None
        ),
        "evidence_status": [
            {"path": ref["path"], "status": _check_ref(ref)}
            for ref in attempt["evidence_refs"]
        ],
    }


def _brief(identity: str, attempts: dict[str, dict], runs: dict[str, dict], lineage=None) -> dict:
    if identity not in attempts:
        raise RecordError(f"unknown attempt: {identity}")
    attempt = attempts[identity]

    def compact_lineage(node: dict) -> dict:
        return {
            "attempt_id": node["attempt_id"],
            **({"revision": node["revision"]} if "revision" in node else {}),
            "decision_layer": node["decision"]["layer"],
            "decision_outcome": node["decision"]["outcome"],
            "parents": [
                {
                    "relationship": parent["relationship"],
                    "difference": parent["difference"],
                    "record": compact_lineage(parent["record"]),
                }
                for parent in node["parents"]
            ],
        }

    return {
        "attempt_id": identity,
        "question": attempt["question"],
        "mechanism": attempt["mechanism"],
        "registration_status": attempt["registration"]["status"],
        "code_parent": attempt["code_parent"],
        "lineage": compact_lineage(lineage or _lineage(identity, attempts)),
        **({"mechanism_sources": lineage["mechanism_sources"]} if lineage else {}),
        "mechanism_refs": attempt.get("mechanism_refs", []),
        "decision": attempt["decision"],
        "comparison_family": (
            attempt["comparison_family"]["cells"]
            if attempt.get("comparison_family")
            else None
        ),
        "runs": [
            {
                key: run[key]
                for key in (
                    "run_id",
                    "role",
                    "integrity",
                    "control_run_id",
                    "raw_reports",
                )
            }
            for run in runs.values()
            if run["attempt_id"] == identity
        ],
        "evidence_status": [
            {"path": ref["path"], "status": _check_ref(ref)}
            for ref in attempt["evidence_refs"]
        ],
    }


def _find(
    mechanism: str | None, layer: str | None, attempts: dict[str, dict]
) -> list[dict]:
    return [
        {
            "attempt_id": attempt["attempt_id"],
            "question": attempt["question"],
            "mechanism": attempt["mechanism"],
            "decision": attempt["decision"],
        }
        for attempt in attempts.values()
        if (not mechanism or mechanism.casefold() in attempt["mechanism"].casefold())
        and (not layer or layer == attempt["decision"]["layer"])
    ]


def _compare(candidate_id: str, control_id: str, runs: dict[str, dict], *, engineering_audit: bool = False) -> dict:
    if candidate_id not in runs or control_id not in runs:
        raise RecordError("unknown candidate or control run")
    candidate, control = runs[candidate_id], runs[control_id]
    if candidate["control_run_id"] != control_id:
        raise RecordError(f"{candidate_id}: {control_id} is not its registered control")
    if candidate["role"] != "candidate" or control["role"] != "control":
        raise RecordError("incomparable runs: candidate/control roles disagree")
    if candidate["integrity"] != "passed" or control["integrity"] != "passed":
        raise RecordError("incomparable runs: native integrity did not pass")
    fields = (
        "input_identity_sha256",
        "window",
        "account",
        "cost_model",
        "nautilus_version",
    )
    mismatches = [field for field in fields if candidate[field] != control[field]
                  and not (engineering_audit and field == "nautilus_version")]
    if mismatches:
        raise RecordError(f"incomparable runs: {', '.join(mismatches)}")
    modern = ["strategy_binding" in run for run in (candidate, control)]
    environment_changes = []
    if modern[0] != modern[1]:
        environment_changes.append("source_custody_backend")
    if all(modern):
        for field in ("image_digest", "platform", "runtime_contract"):
            if candidate["runtime_identity"][field] != control["runtime_identity"][field]:
                environment_changes.append(field)
        if candidate["effective_config_sha256"] != control["effective_config_sha256"]:
            raise RecordError("incomparable runs: effective configuration differs")
    if environment_changes and not engineering_audit:
        raise RecordError("incomparable runs: " + ", ".join(environment_changes) + "; use --engineering-audit for an environment migration")
    source_revision_status = [
        _check_source_revision(run) for run in (candidate, control)
    ]
    for run in (candidate, control):
        if _check_ref(run["audit_ref"]) != "verified":
            raise RecordError(
                f"incomparable runs: {run['run_id']} audit is unavailable"
            )
        audit = _read_evidence_json(run["audit_ref"])
        if not audit.get("passed") or audit.get("findings"):
            raise RecordError(f"incomparable runs: {run['run_id']} audit did not pass")
    left, right = _summary(candidate), _summary(control)
    if {coin["instrument"] for coin in left["per_coin"]} != {
        coin["instrument"] for coin in right["per_coin"]
    }:
        raise RecordError("incomparable runs: instrument universe differs")
    metrics = (
        "final_equity_usdt",
        "annualized_return_pct",
        "closed_trade_win_rate",
        "native_sharpe_365",
        "native_max_drawdown_daily_close",
    )
    return {
        "candidate": candidate_id,
        "control": control_id,
        "comparability": "engineering_environment_migration" if engineering_audit else "recorded_contract_matches",
        **({"environment_changes": environment_changes} if engineering_audit else {}),
        "evidence_grade": (
            "independent"
            if candidate["evidence_grade"] == control["evidence_grade"] == "independent"
            else "development_exposed"
            if "development_exposed"
            in (candidate["evidence_grade"], control["evidence_grade"])
            else "unknown"
        ),
        "raw_report_status": [candidate["raw_reports"], control["raw_reports"]],
        "source_revision_status": source_revision_status,
        "scope": ("engineering migration audit; not a paired research decision or strategy qualification"
                  if engineering_audit else "descriptive paired development read; not independent qualification"),
        "metrics": {
            metric: {
                "candidate": left[metric],
                "control": right[metric],
                "difference": str(
                    Decimal(str(left[metric])) - Decimal(str(right[metric]))
                ),
            }
            for metric in metrics
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--at", help="read one exact Dolt commit")
    command = parser.add_subparsers(dest="command", required=True)
    command.add_parser("validate")
    show = command.add_parser("show")
    show.add_argument("attempt_id")
    show.add_argument(
        "--brief", action="store_true", help="show a compact research decision view"
    )
    find = command.add_parser("find")
    find.add_argument("--mechanism")
    find.add_argument("--component", help="find explicit component reuse and sources")
    find.add_argument(
        "--failure-layer", choices=("source", "data", "execution", "economics")
    )
    compare = command.add_parser("compare")
    compare.add_argument("candidate_run")
    compare.add_argument("control_run")
    compare.add_argument("--engineering-audit", action="store_true",
                         help="explicitly compare legacy and migrated run custody for implementation parity")
    ledger = command.add_parser("ledger", help="manage the local Dolt metadata store")
    lifecycle = ledger.add_subparsers(dest="action", required=True)
    initialize = lifecycle.add_parser("init")
    initialize.add_argument("--binary", type=Path, required=True)
    from research.records.store import DEFAULT_ROOT
    initialize.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    initialize.add_argument("--port", type=int, default=13326)
    for name in ("start", "stop", "status"):
        lifecycle.add_parser(name)
    import_ = lifecycle.add_parser("import")
    import_.add_argument("--dry-run", action="store_true")
    import_.add_argument("--paths", nargs="+", required=True, help="explicit source materials to archive")
    backup = lifecycle.add_parser("backup")
    backup.add_argument("--destination", type=Path, required=True)
    materials = command.add_parser("material")
    actions = materials.add_subparsers(dest="action", required=True)
    search = actions.add_parser("search")
    search.add_argument("query")
    admission = actions.add_parser("admit", help="publish an explicit Agent knowledge/retention decision")
    admission.add_argument("--file", type=Path, required=True)
    admission.add_argument("--expected-version", type=int, required=True)
    admission.add_argument("--operation-id", required=True)
    search.add_argument("--include-archive", action="store_true",
                        help="also search unadmitted source material and retained audit metadata")
    for name in ("show", "restore"):
        action = actions.add_parser(name)
        action.add_argument("identity")
        action.add_argument("--revision", type=int)
        if name == "show":
            action.add_argument("--brief", action="store_true")
        else:
            action.add_argument("--destination", type=Path, required=True)
    review = actions.add_parser("review", help="review an immutable material import queue")
    review_actions = review.add_subparsers(dest="review_action", required=True)
    for name in ("status", "prepare"):
        action = review_actions.add_parser(name)
        action.add_argument("inventory_id")
        action.add_argument("--revision", type=int, default=1)
        action.add_argument("--source-at", required=True, help="exact original inventory Dolt commit")
        if name == "status":
            action.add_argument("--items", action="store_true")
        else:
            action.add_argument("--decisions", type=Path, help="Agent decisions and retained evidence manifest")
            action.add_argument("--supplemental", type=Path, help="explicitly retained supplemental object DTOs")
            action.add_argument("--destination", type=Path, required=True)
    apply_review = review_actions.add_parser("apply")
    apply_review.add_argument("--file", type=Path, required=True, help="frozen prepare payload; reuse on retry")
    publication = command.add_parser("publish")
    publications = publication.add_subparsers(dest="action", required=True)
    attempt = publications.add_parser("attempt")
    attempt.add_argument("--file", type=Path, required=True)
    attempt.add_argument("--expected-version", type=int, required=True)
    attempt.add_argument("--operation-id", required=True)
    strategies = command.add_parser("strategy", help="publish and export complete Dolt strategy source revisions")
    strategy_actions = strategies.add_subparsers(dest="action", required=True)
    strategy_publish = strategy_actions.add_parser("publish")
    strategy_publish.add_argument("--file", type=Path, required=True, help="strategy metadata JSON")
    strategy_publish.add_argument("--source", type=Path, required=True, help="complete UTF-8 Python source file")
    strategy_publish.add_argument("--expected-version", type=int, required=True)
    strategy_publish.add_argument("--operation-id", required=True)
    strategy_list = strategy_actions.add_parser("list")
    strategy_list.add_argument("--family-id")
    strategy_list.add_argument("--status", choices=("research", "retired", "archived"))
    strategy_list.add_argument("--all-revisions", action="store_true", help="include immutable older source revisions")
    for name in ("show", "lineage", "export"):
        action = strategy_actions.add_parser(name)
        action.add_argument("strategy_id")
        action.add_argument("--revision", type=int)
        if name == "show":
            action.add_argument("--brief", action="store_true")
        elif name == "export":
            action.add_argument("--destination", type=Path, required=True)
            action.add_argument("--binding-output", type=Path, help="also write a new exact source binding JSON file")
    args = parser.parse_args()
    try:
        if args.command == "strategy":
            from research.records.strategies import command as strategy_command
            output = strategy_command(args)
            print(json.dumps(output, ensure_ascii=False, indent=2))
            return 0
        if args.command in ("ledger", "material", "publish"):
            from research.records.ledger import command as ledger_command
            output = ledger_command(args)
            print(json.dumps(output, ensure_ascii=False, indent=2))
            return 0
        from research.records.store import open_store
        store = open_store()
        fixed = args.at or store.adapter.status()["commit"]
        attempts, runs, snapshot_storage = store.snapshot(fixed)
        _validate_records(attempts, runs)
        if args.command == "validate":
            output = _validate(attempts, runs, check_lineage=not fixed)
            output["registration_receipts"] = {
                identity: store.registration_snapshot(identity, at=fixed)[1]
                for identity, body in attempts.items()
                if body["registration"]["status"] == "preregistered"
            }
            if fixed:
                for identity in attempts:
                    _dolt_lineage(store.adapter, identity, fixed)
        elif args.command == "show":
            lineage = _dolt_lineage(store.adapter, args.attempt_id, fixed) if fixed else None
            output = (
                _brief(args.attempt_id, attempts, runs, lineage)
                if args.brief
                else _show(args.attempt_id, attempts, runs, lineage)
            )
            if attempts[args.attempt_id]["registration"]["status"] == "preregistered":
                initial, binding = store.registration_snapshot(args.attempt_id, at=fixed)
                output["registration_receipt"] = binding
                if not args.brief:
                    output["registered_contract"] = initial
        elif args.command == "find":
            output = _find(args.mechanism, args.failure_layer, attempts)
            if args.component:
                component = store.adapter.get_object("component:" + args.component, commit=fixed)
                identities = {edge["to_id"].removeprefix("attempt:") for edge in store.adapter.list_relations(commit=fixed)
                              if component and edge["kind"] == "component_index" and edge["from_id"] == component["id"]
                              and edge["from_revision"] == component["revision"]}
                output = [item for item in output if item["attempt_id"] in identities]
        else:
            output = _compare(args.candidate_run, args.control_run, runs,
                              engineering_audit=args.engineering_audit)
        storage = snapshot_storage
        output = {"storage": storage, "matches": output} if isinstance(output, list) else {**output, "storage": storage}
    except RecordError as exc:
        parser.exit(2, f"research record error: {exc}\n")
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
