"""Small local Dolt lifecycle and material API; no research workflow engine."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time

import pymysql

from research.records.common import ROOT, RecordError, _read_json
from research.records.dolt_store import DoltStore, DOLT_VERSION
from research.records.materials import retained_historical_refs, scan
from research.records.migration import original_bytes, publish
from research.records.store import DEFAULT_ROOT, canonical, config_path, configuration, open_store


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
    if root.is_relative_to(ROOT) or root.is_relative_to(Path("/tmp").resolve()):
        raise RecordError("metadata database must be outside Git and /tmp")
    path = config_path()
    config = {"root": str(root), "binary": str(Path(binary).resolve()), "host": "127.0.0.1", "port": port,
              "user": "root", "password": "", "database": "research_records", "dolt_version": DOLT_VERSION, "schema_version": 1}
    _binary(config)
    if path.exists() and _read_json(path) != config:
        raise RecordError(f"existing backend config differs: {path}; no implicit replacement")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(json.dumps(config, indent=2) + "\n")
    path.chmod(0o600)
    start(config)
    return {"config": str(path), **DoltStore(config).initialize()}


def backup(config, destination):
    destination = Path(destination).expanduser().resolve()
    if destination.is_relative_to(ROOT) or destination.is_relative_to(Path("/tmp").resolve()) or destination.exists():
        raise RecordError("native backup requires a new external directory outside Git and /tmp")
    adapter = DoltStore(config)
    status = adapter.status()
    if status["dirty"]:
        raise RecordError("backup requires a clean published working set")
    with adapter._connection() as connection:
        adapter._sql(connection, "CALL DOLT_BACKUP('sync-url',%s)", (destination.as_uri(),))
    return {"backup": str(destination), "method": "native DOLT_BACKUP sync-url", "snapshot": status,
            "restore": {"binary": str(_binary(config)), "url": destination.as_uri(), "database": config["database"]}}


def material(adapter, action, *, at=None, identity=None, revision=None, query=None, destination=None,
             brief=False, include_archive=False):
    fixed = at or adapter.status()["commit"]
    if action == "search":
        from research.records.retrieval import load_search, search
        objects, relations = load_search(adapter, fixed, include_archive=include_archive)
        return {"commit": fixed, **search(objects, relations, query,
                                         include_archive=include_archive)}
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
    all_relations = adapter.list_relations(commit=fixed)
    relations = [edge for edge in all_relations if
                 (edge["from_id"], edge["from_revision"]) == (identity, obj["revision"]) or
                 (edge["to_id"], edge["to_revision"]) == (identity, obj["revision"])]
    from research.records.retrieval import admission_view, admissions, corrections, load_show, resolved_references
    reader, correction_relations = load_show(adapter, fixed, obj, all_relations)
    active = resolved_references(reader, obj, all_relations)
    correction = corrections(obj, list(reader.objects.values()), correction_relations)
    decision = admission_view(admissions(list(reader.objects.values())).get((identity, obj["revision"])))
    if brief:
        obj = {**obj, "body": {key: value for key, value in obj["body"].items() if key not in ("text", "content_base64")},
               "provenance": {key: value for key, value in obj["provenance"].items() if key != "raw_content_base64"}}
    return {"commit": fixed, "object": obj, "relations": relations,
            "retention_decision": decision, "corrections": correction,
            "resolved_references": active}


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
        if args.action == "backup":
            return backup(config, args.destination)
        historical = retained_historical_refs() if args.historical_c02 else None
        if args.legacy_all:
            from research.records.history import load_archive
            archive = load_archive(ROOT)
            if archive:
                historical = [*(historical or []), {"commit": archive.commit,
                              "paths": [path for prefix in archive.prefixes for path in archive.paths(prefix)]}]
        return publish(adapter, scan(historical_refs=historical, selected_paths=args.paths), args.dry_run)
    store = open_store(args.backend)
    if not hasattr(store, "adapter"):
        raise RecordError("material and publication APIs require Dolt")
    if args.command == "material":
        if args.action == "admit":
            if args.at:
                raise RecordError("knowledge admission cannot write to a historical snapshot")
            from research.records.retention import publish as admit
            return admit(store.adapter, _read_json(args.file), operation_id=args.operation_id,
                         expected_version=args.expected_version)
        if args.action == "review":
            from research.records import reviews
            if args.review_action == "status":
                return reviews.status(store.adapter, args.inventory_id, args.revision,
                                      source_at=args.source_at, at=args.at, include_items=args.items)
            if args.at:
                raise RecordError("review writes cannot use a historical read snapshot")
            if args.review_action == "apply":
                return reviews.apply(store.adapter, _read_json(args.file))
            payload = reviews.prepare(store.adapter, args.inventory_id, args.revision, source_at=args.source_at,
                                      decisions=_read_json(args.decisions) if args.decisions else None,
                                      supplemental=_read_json(args.supplemental)["objects"] if args.supplemental else ())
            destination = args.destination.expanduser().resolve()
            if destination.is_relative_to(ROOT) or destination.is_relative_to(Path("/tmp").resolve()):
                raise RecordError("frozen review plan must be outside Git and /tmp")
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with destination.open("x") as target:
                json.dump(payload, target, ensure_ascii=False, indent=2)
                target.write("\n")
                target.flush()
                os.fsync(target.fileno())
            destination.chmod(0o600)
            return {"destination": str(destination), "operation_id": payload["operation_id"],
                    "payload_sha256": payload["payload_sha256"], "base_commit": payload["base_commit"],
                    "expected_version": payload["expected_version"], "counts": payload["counts"]}
        return material(store.adapter, args.action, at=args.at, identity=getattr(args, "identity", None),
                        revision=getattr(args, "revision", None), query=getattr(args, "query", None),
                        destination=getattr(args, "destination", None), brief=getattr(args, "brief", False),
                        include_archive=getattr(args, "include_archive", False))
    if args.at:
        raise RecordError("cannot publish to a historical read snapshot")
    body = _read_json(args.file)
    return store.publish_record("attempt", body, operation_id=args.operation_id, expected_version=args.expected_version,
                                provenance={"origin": "agent_publication", "input_sha256": hashlib.sha256(args.file.read_bytes()).hexdigest()},
                                receipt_path=args.file)
