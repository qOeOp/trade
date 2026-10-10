"""Small local Dolt lifecycle and material API; no research workflow engine."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time

from research.records.common import ROOT, RecordError, _is_temporary_path, _read_json
from research.records.dolt_store import DoltStore, DOLT_VERSION
from research.records.evidence import original_bytes, retain
from research.records.store import DEFAULT_ROOT, config_path, configuration, open_store


def _binary(config):
    binary = Path(config["binary"]).expanduser().resolve()
    checked = subprocess.run([str(binary), "version"], capture_output=True, text=True)
    if checked.returncode or checked.stdout.strip() != f"dolt version {DOLT_VERSION}":
        raise RecordError(f"expected Dolt {DOLT_VERSION} binary: {binary}")
    return binary


def start(config):
    binary = _binary(config)
    root = Path(config["root"]).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    data = root / "data"
    data.mkdir(mode=0o700, exist_ok=True)
    pid_file = root / "server.pid"
    if pid_file.exists():
        pid = int(pid_file.read_text())
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            pid_file.unlink()
        else:
            owner = subprocess.run(["ps", "-p", str(pid), "-o", "args="], capture_output=True, text=True)
            if str(data) not in owner.stdout or "sql-server" not in owner.stdout:
                raise RecordError("pid file does not identify the configured Dolt server")
            with DoltStore(config)._connection(database=False):
                pass
            return {"running": True, "pid": pid, "root": str(root)}
    # The supported server is private and uses a dedicated socket and directory.
    log = root / "server.log"
    with log.open("ab") as output:
        process = subprocess.Popen([str(binary), "sql-server", "--host", "127.0.0.1", "--port", str(config["port"]),
                                    "--data-dir", str(data), "--socket", str(root / "mysql.sock"), "--loglevel", "warning"],
                                   cwd=root, stdout=output, stderr=output, start_new_session=True)
    pid_file.write_text(str(process.pid))
    for _ in range(50):
        if process.poll() is not None:
            pid_file.unlink(missing_ok=True)
            raise RecordError(f"Dolt server failed; inspect {log}")
        try:
            with DoltStore({**config, "unix_socket": str(root / "mysql.sock")})._connection(database=False):
                if process.poll() is not None:
                    raise RecordError("configured Dolt process exited during startup")
                return {"running": True, "pid": process.pid, "root": str(root)}
        except RecordError:
            time.sleep(0.1)
    process.terminate()
    pid_file.unlink(missing_ok=True)
    raise RecordError(f"Dolt server did not become ready; inspect {log}")


def stop(config):
    root = Path(config["root"]).resolve()
    pid_file = root / "server.pid"
    if not pid_file.exists():
        return {"running": False, "root": str(root)}
    pid = int(pid_file.read_text())
    # Refuse to signal a recycled PID or an unrelated service.
    process = subprocess.run(["ps", "-p", str(pid), "-o", "args="], capture_output=True, text=True)
    if process.returncode == 0:
        if str(root / "data") not in process.stdout or "sql-server" not in process.stdout:
            raise RecordError("pid file does not identify the configured Dolt server")
        os.kill(pid, signal.SIGTERM)
        for _ in range(150):
            try:
                reaped, _ = os.waitpid(pid, os.WNOHANG)
                if reaped == pid:
                    break
            except ChildProcessError:
                pass
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.1)
        else:
            # A dead child may remain a zombie until its parent reaps it.
            state = subprocess.run(["ps", "-p", str(pid), "-o", "stat="], capture_output=True, text=True).stdout.strip()
            if not state.startswith("Z"):
                raise RecordError("Dolt server has not stopped; pid file retained")
    pid_file.unlink()
    return {"running": False, "pid": pid, "root": str(root)}


def initialize(binary, root=DEFAULT_ROOT, port=13326):
    root = Path(root).expanduser().resolve()
    if root.is_relative_to(ROOT.resolve()) or _is_temporary_path(root):
        raise RecordError("metadata database must be outside Git and /tmp or the system temp directory")
    path = config_path()
    if path.resolve().is_relative_to(ROOT.resolve()) or _is_temporary_path(path):
        raise RecordError("backend config must be outside Git and /tmp or the system temp directory")
    config = {"root": str(root), "binary": str(Path(binary).resolve()), "host": "127.0.0.1", "port": port,
              "user": "root", "password": "", "database": "research_records", "dolt_version": DOLT_VERSION, "schema_version": 1}
    _binary(config)
    if path.exists() and _read_json(path) != config:
        raise RecordError(f"existing backend config differs: {path}; no implicit replacement")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    path.chmod(0o600)
    start(config)
    return {"config": str(path), **DoltStore(config).initialize()}


def backup(config, destination):
    destination = Path(destination).expanduser().resolve()
    if destination.is_relative_to(ROOT.resolve()) or _is_temporary_path(destination) or destination.exists():
        raise RecordError("native backup requires a new external directory outside Git and /tmp or the system temp directory")
    adapter = DoltStore(config)
    status = adapter.status()
    if status["dirty"]:
        raise RecordError("backup requires a clean published working set")
    with adapter._connection() as connection:
        adapter._sql(connection, "CALL DOLT_BACKUP('sync-url',%s)", (destination.as_uri(),))
    return {"backup": str(destination), "method": "native DOLT_BACKUP sync-url", "snapshot": status,
            "restore": {"binary": str(_binary(config)), "url": destination.as_uri(), "database": config["database"]}}


def incoming_repairs(adapter, at, obj):
    """Pending typed repairs of this object; they never replace the original decision."""
    output = []
    for edge in adapter.list_relations(commit=at, kinds=("repair",), to_refs=((obj["id"], None),)):
        repair = adapter.get_object(edge["from_id"], commit=at)
        if repair is None or repair["kind"] != "attempt":
            continue
        decision = repair["body"].get("decision", {})
        if decision.get("outcome") != "pending":
            continue
        output.append({"relation_id": edge["id"], "repair_ref": {"id": repair["id"], "revision": repair["revision"]},
                       "target_ref": {"id": edge["to_id"], "revision": edge["to_revision"]},
                       "status": "pending_repair", "scope": decision.get("scope"),
                       "next_action": decision.get("next_action"), "effect": "requires_reassessment",
                       "original_decision_preserved": True})
    return output


def material(adapter, action, *, at=None, identity=None, revision=None, destination=None, brief=False):
    fixed = at or adapter.status()["commit"]
    obj = adapter.get_object(identity, revision=revision, commit=fixed)
    if obj is None:
        raise RecordError(f"unknown material revision: {identity}@{revision or 'latest'}")
    if action == "restore":
        path = Path(destination).expanduser().resolve()
        if path.exists():
            raise RecordError(f"restore destination exists: {path}")
        raw = original_bytes(obj)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as target:
            target.write(raw)
            target.flush()
            os.fsync(target.fileno())
        return {"commit": fixed, "id": identity, "revision": obj["revision"], "destination": str(path),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": len(raw)}
    selected_ref = ((identity, obj["revision"]),)
    relations = adapter.list_relations(commit=fixed, from_refs=selected_ref, to_refs=selected_ref)
    result = {"commit": fixed, "object": obj, "relations": relations,
              "incoming_repairs": incoming_repairs(adapter, fixed, obj)}
    if brief:
        from research.records.projections import bounded_brief
        return bounded_brief(result, at=fixed, identity=identity, revision=obj["revision"])
    return result


def command(args):
    if args.command == "ledger":
        if args.action == "init":
            return initialize(args.binary, args.root, args.port)
        config = configuration()
        if args.action == "start":
            return start(config)
        if args.action == "stop":
            return stop(config)
        adapter = DoltStore(config)
        if args.action == "status":
            return adapter.status()
        return backup(config, args.destination)
    store = open_store()
    if args.command == "material":
        if args.action == "retain":
            if args.at:
                raise RecordError("evidence retention cannot write to a historical snapshot")
            return retain(store.adapter, args.file, operation_id=args.operation_id,
                          expected_version=args.expected_version, origin=args.origin, dry_run=args.dry_run)
        return material(store.adapter, args.action, at=args.at, identity=args.identity, revision=args.revision,
                        destination=getattr(args, "destination", None), brief=getattr(args, "brief", False))
    if args.at:
        raise RecordError("cannot publish to a historical read snapshot")
    body = _read_json(args.file)
    findings = evidence_read_findings(body)
    result = store.publish_record("attempt", body, operation_id=args.operation_id, expected_version=args.expected_version,
                                  provenance={"origin": "agent_publication", "input_sha256": hashlib.sha256(args.file.read_bytes()).hexdigest()},
                                  dry_run=getattr(args, "dry_run", False))
    return {**result, **({"read_preflight": {"report_only": True, "findings": findings}} if findings else {})}


def evidence_read_findings(body: dict) -> list[dict]:
    """Report evidence paths that the formal show/compare readers cannot read now."""
    from research.records.cli import _check_ref
    findings = []
    for index, ref in enumerate(body.get("evidence_refs", [])):
        try:
            status = _check_ref(ref)
        except RecordError as exc:
            findings.append({"path": f"/evidence_refs/{index}", "evidence_path": ref["path"],
                             "status": "unreadable", "message": str(exc)})
            continue
        if status == "unavailable":
            findings.append({"path": f"/evidence_refs/{index}", "evidence_path": ref["path"], "status": status,
                             "message": "no file at this path for the formal reader"})
    return findings
