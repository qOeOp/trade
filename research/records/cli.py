"""Read-only pilot for research lineage and native-run comparison.

The records include retrospective examples and a prospectively registered
four-cell experiment. This tool never runs a backtest or promotes development
evidence into strategy qualification.
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
from research.records.common import RECORDS
from research.records.common import RecordError
from research.records.common import _check_commit
from research.records.common import _read_json
from research.records.common import _validator


def _load_all(kind: str, id_key: str) -> dict[str, dict]:
    validator = _validator(kind)
    found: dict[str, dict] = {}
    for path in sorted((RECORDS / f"{kind}s").glob(f"*/{kind}.json")):
        item = _read_json(path)
        problems = sorted(
            validator.iter_errors(item), key=lambda issue: str(issue.path)
        )
        if problems:
            issue = problems[0]
            raise RecordError(f"{path}: {list(issue.path)}: {issue.message}")
        identity = item[id_key]
        if identity != path.parent.name:
            raise RecordError(f"{path}: {id_key} does not match directory")
        if identity in found:
            raise RecordError(f"duplicate {id_key}: {identity}")
        found[identity] = item
    return found


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
    path = _repo_file(ref)
    if not path.is_file():
        return "unavailable"
    if ref.get("sha256") is None:
        return "unverified"
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != ref["sha256"]:
        raise RecordError(f"hash mismatch: {ref['path']}")
    return "verified"


def _check_source_revision(run: dict) -> str:
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


def _load_records() -> tuple[dict[str, dict], dict[str, dict]]:
    attempts = _load_all("attempt", "attempt_id")
    runs = _load_all("run", "run_id")
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
    return attempts, runs


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


def _summary(run: dict) -> dict:
    status = _check_ref(run["summary_ref"])
    if status != "verified":
        raise RecordError(f"{run['run_id']}: summary is {status}")
    summary = _read_json(_repo_file(run["summary_ref"]))
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
    return summary


def _validate(attempts: dict[str, dict], runs: dict[str, dict]) -> dict:
    for identity in attempts:
        _lineage(identity, attempts)
    statuses = {}
    commits = {}
    source_revisions = {}
    family_evidence = {}
    for identity, attempt in attempts.items():
        statuses[identity] = [_check_ref(ref) for ref in attempt["evidence_refs"]]
        commits[identity] = {
            "original_registration": _check_commit(
                attempt["registration"]["original_registration_commit"]
            )
            if attempt["registration"].get("original_registration_commit")
            else "unknown",
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
        audit = _read_json(_repo_file(run["audit_ref"]))
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


def _show(identity: str, attempts: dict[str, dict], runs: dict[str, dict]) -> dict:
    if identity not in attempts:
        raise RecordError(f"unknown attempt: {identity}")
    attempt = attempts[identity]
    return {
        "attempt": attempt,
        "lineage": _lineage(identity, attempts),
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


def _brief(identity: str, attempts: dict[str, dict], runs: dict[str, dict]) -> dict:
    if identity not in attempts:
        raise RecordError(f"unknown attempt: {identity}")
    attempt = attempts[identity]

    def compact_lineage(node: dict) -> dict:
        return {
            "attempt_id": node["attempt_id"],
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
        "lineage": compact_lineage(_lineage(identity, attempts)),
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


def _compare(candidate_id: str, control_id: str, runs: dict[str, dict]) -> dict:
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
    mismatches = [field for field in fields if candidate[field] != control[field]]
    if mismatches:
        raise RecordError(f"incomparable runs: {', '.join(mismatches)}")
    source_revision_status = [
        _check_source_revision(run) for run in (candidate, control)
    ]
    for run in (candidate, control):
        if _check_ref(run["audit_ref"]) != "verified":
            raise RecordError(
                f"incomparable runs: {run['run_id']} audit is unavailable"
            )
        audit = _read_json(_repo_file(run["audit_ref"]))
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
        "comparability": "recorded_contract_matches",
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
        "scope": "descriptive paired development read; not independent qualification",
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
    command = parser.add_subparsers(dest="command", required=True)
    command.add_parser("validate")
    show = command.add_parser("show")
    show.add_argument("attempt_id")
    show.add_argument(
        "--brief", action="store_true", help="show a compact research decision view"
    )
    find = command.add_parser("find")
    find.add_argument("--mechanism")
    find.add_argument(
        "--failure-layer", choices=("source", "data", "execution", "economics")
    )
    compare = command.add_parser("compare")
    compare.add_argument("candidate_run")
    compare.add_argument("control_run")
    args = parser.parse_args()
    try:
        attempts, runs = _load_records()
        if args.command == "validate":
            output = _validate(attempts, runs)
        elif args.command == "show":
            output = (
                _brief(args.attempt_id, attempts, runs)
                if args.brief
                else _show(args.attempt_id, attempts, runs)
            )
        elif args.command == "find":
            output = _find(args.mechanism, args.failure_layer, attempts)
        else:
            output = _compare(args.candidate_run, args.control_run, runs)
    except RecordError as exc:
        parser.exit(2, f"research record error: {exc}\n")
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
