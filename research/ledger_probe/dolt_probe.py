"""Isolated Dolt/MySQL ledger candidate probe; never touches production state.

Run with the external venv's Python after installing PyMySQL==1.1.2. The binary,
servers, databases, logs and backups stay below --artifact-root. This adapter
uses append-only object revisions by convention; immutable historical snapshots
come from Dolt commits, not that convention. SQL transaction commits are separate
from explicit Dolt history commits. No project dependency is changed.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.request

import pymysql

RELEASE = "2.4.2"
ASSET_URL = "https://github.com/dolthub/dolt/releases/download/v2.4.2/dolt-darwin-arm64.tar.gz"
ASSET_SHA = "edd31e01c59b0cbd5178fa4d6dbf5526d48e5654e41049ff6f4281e3ad366a7b"
AUTHOR = "Ledger Probe <probe@example.invalid>"
ROOT = Path("/Users/vx/.local/share/trade/ledger-probe/dolt-20261009")
SOURCES = [
    "https://github.com/dolthub/dolt/releases/tag/v2.4.2",
    "https://api.github.com/repos/dolthub/dolt/releases/tags/v2.4.2",
    "https://raw.githubusercontent.com/dolthub/dolt/v2.4.2/go/libraries/doltcore/sqle/enginetest/dolt_transaction_queries.go",
    "https://raw.githubusercontent.com/dolthub/dolt/v2.4.2/integration-tests/bats/backup.bats",
    "https://www.dolthub.com/docs/sql-reference/version-control/dolt-sql-procedures/",
    "https://www.dolthub.com/docs/sql-reference/version-control/querying-history/",
]


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def value_hash(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


class Probe:
    def __init__(self, args):
        self.args = args
        self.started = time.monotonic()
        self.fixture = json.loads(args.fixture.read_text())
        self.contract = json.loads(args.contract.read_text()) if args.contract.exists() else None
        if not self.contract or value_hash(self.fixture) != self.contract['fixture_sha256']:
            raise ValueError('Frozen fixture/contract digest mismatch')
        if self.contract['contract_schema_version'] < 3:
            raise ValueError('A5 requires the frozen disjoint-writer contract revision 3 or later')
        self.run_dir = args.artifact_root / ("run-" + dt.datetime.now().strftime("%Y%m%dT%H%M%S-%f"))
        self.run_dir.mkdir(parents=True)
        self.data = self.run_dir / "data"
        self.data.mkdir()
        self.binary = args.artifact_root / "bin/dolt-darwin-arm64/bin/dolt"
        self.events = []
        self.servers = []
        self.current_branch = "main"
        self.by_key = {(o["id"],o["revision"]):o for o in self.fixture["objects"]}
        self.result = {
            "candidate": "Dolt", "requested_version": RELEASE,
            "fixture_sha256": value_hash(self.fixture), "fixture_file_sha256": digest(args.fixture), "contract_sha256": value_hash(self.contract) if self.contract else None,
            "source_head": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
            "fixture_source_head": self.fixture.get("source_head"),
            "transcription": self.fixture.get("transcription"),
            "source_urls": SOURCES, "run_artifact_path": str(self.run_dir),
            "sdk": {"name": "PyMySQL", "distribution_version": importlib.metadata.version('PyMySQL'), "module_version": pymysql.__version__},
            "contract_schema_version":self.contract['contract_schema_version'],
            "rerun_argv":[sys.executable,str(Path(__file__).resolve())]+sys.argv[1:],
            "setup_commands":[
                ["curl","-fLsS",ASSET_URL,"-o",str(args.artifact_root/'downloads/dolt-darwin-arm64.tar.gz')],
                ["shasum","-a","256",str(args.artifact_root/'downloads/dolt-darwin-arm64.tar.gz')],
                ["tar","-xzf",str(args.artifact_root/'downloads/dolt-darwin-arm64.tar.gz'),"-C",str(args.artifact_root/'bin')],
                ["uv","venv",str(args.artifact_root/'venv')],
                ["uv","pip","install","--python",str(args.artifact_root/'venv/bin/python'),"PyMySQL==1.1.2"],
            ],
            "prior_diagnostic_evidence":{
                "path":str(args.artifact_root/'logs/dolt_diagnostic_result.json'),
                "classification":"Development smoke run, not acceptance: an SQL alias named next caused a syntax error, fixed to downstream. Its same-object CAS was replaced by frozen disjoint-writer v3 tests.",
                "bootstrap_notes":"A pre-harness version probe tried unsupported @@dolt_version; fixed to DOLT_VERSION(). SQL COMMIT vs DOLT_COMMIT behavior was separately observed then repeated in this harness."},
            "adapter_requirements": [
                "Explicit schema and typed composite foreign keys for revision-specific relations",
                "Append-only object revision convention enforced by this adapter, not immutable row storage",
                "Explicit application operation-id/payload-digest table and lookup before retry",
                "Conditional version update and divergent writer marker inside one SQL transaction",
                "Explicit ROLLBACK on a statement constraint error",
                "Explicit DOLT_COMMIT at audit checkpoints; ordinary SQL COMMIT only updates working set",
                "No recursive graph engine: these fixed-depth recall/impact queries are SQL joins",
            ],
            "not_tested": [
                "Production migration, production permissions or trading account integration",
                "Real lost TCP response, network partition or crash after server commit",
                "Remote/cloud backup durability, disaster recovery on another host",
                "Large corpus query performance, vector/semantic similarity or free-form natural-language planning",
                "Concurrent merges on separate branches or multi-primary writes",
                "Retention and garbage-collection policy for long-lived production history",
                "Native denial of UPDATE to an existing (id,revision) row; current revision immutability needs publication protocol/permissions. Fixed historical references include commit hash plus object id/revision.",
            ],
            "checks": {}, "commit_ids": {}, "commands": [],
        }

    def command(self, argv, cwd=None):
        started = time.monotonic()
        p = subprocess.run([str(v) for v in argv], cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        rec = {"argv": [str(v) for v in argv], "cwd": str(cwd) if cwd else None,
               "exit_code": p.returncode, "output": p.stdout, "duration_seconds": time.monotonic() - started}
        self.result["commands"].append(rec)
        if p.returncode:
            raise RuntimeError(canonical(rec))
        return p.stdout

    def start_server(self, data, port, name):
        log_path = self.run_dir / (name + ".log")
        log = log_path.open("w")
        argv = [str(self.binary), "sql-server", "--host", "127.0.0.1", "--port", str(port),
                "--data-dir", str(data), "--socket", str(self.run_dir / (name + ".sock")), "--loglevel", "info"]
        p = subprocess.Popen(argv, cwd=self.run_dir, stdout=log, stderr=subprocess.STDOUT)
        self.servers.append((p, log, log_path))
        self.result["commands"].append({"argv": argv, "log_path": str(log_path), "local_only": True})
        for _ in range(100):
            if p.poll() is not None:
                raise RuntimeError(log_path.read_text())
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=.1):
                    return
            except OSError:
                time.sleep(.1)
        raise RuntimeError("server readiness timeout")

    def connect(self, port=None, db="current", autocommit=True):
        if db == "current":
            db = "ledger_probe/" + self.current_branch
        return pymysql.connect(host="127.0.0.1", port=port or self.args.port, user="root", password="",
                               database=db, charset="utf8mb4", autocommit=autocommit,
                               connect_timeout=5, read_timeout=20, write_timeout=20)

    def sql(self, conn, query, params=None):
        started = time.monotonic()
        with conn.cursor() as cursor:
            try:
                cursor.execute(query, params)
                rows = cursor.fetchall()
                count = cursor.rowcount
                while cursor.nextset():
                    cursor.fetchall()
            except Exception as e:
                self.events.append({"query": query, "params": params, "error": repr(e),
                                    "duration_seconds": time.monotonic() - started})
                raise
        self.events.append({"query": query, "params": params, "rows": rows, "rowcount": count,
                            "duration_seconds": time.monotonic() - started})
        return rows

    def checkpoint(self, conn, name):
        rows = self.sql(conn, "CALL DOLT_COMMIT('-Am', %s, '--author', %s)", (name, AUTHOR))
        value = rows[0][0]
        self.result["commit_ids"][name] = value
        return value

    def branch(self, name):
        self.sql(self.conn,"CALL DOLT_CHECKOUT('-b',%s,%s)",(name,self.correction_commit))
        self.current_branch = name

    def read_objects(self, conn, keys, as_of=None):
        values = []
        for ident,revision in keys:
            suffix = " AS OF %s" if as_of else ""
            params = (as_of,ident,revision) if as_of else (ident,revision)
            row = self.sql(conn,"SELECT id,kind,revision,body,provenance FROM objects"+suffix+" WHERE id=%s AND revision=%s",params)[0]
            values.append({"id":row[0],"kind":row[1],"revision":row[2],"body":json.loads(row[3]),"provenance":json.loads(row[4])})
        return values

    def read_relations(self, conn, ids, as_of=None):
        values = []
        for ident in ids:
            suffix = " AS OF %s" if as_of else ""
            params = (as_of,ident) if as_of else (ident,)
            row = self.sql(conn,"SELECT id,kind,from_id,from_revision,to_id,to_revision,body FROM relations"+suffix+" WHERE id=%s",params)[0]
            values.append({"id":row[0],"kind":row[1],"from_id":row[2],"from_revision":row[3],"to_id":row[4],"to_revision":row[5],"body":json.loads(row[6])})
        return values

    def durable_state(self):
        c = self.connect()
        try:
            keys = [[r[0],r[1]] for r in self.sql(c,"SELECT id,revision FROM objects ORDER BY id,revision")]
            relids = [r[0] for r in self.sql(c,"SELECT id FROM relations ORDER BY id")]
            return {"objects_hash":value_hash(self.read_objects(c,keys)),"relations_hash":value_hash(self.read_relations(c,relids)),
                    "object_count":len(keys),"relation_count":len(relids),"operation_count":self.sql(c,"SELECT COUNT(*) FROM operations")[0][0],
                    "version":self.sql(c,"SELECT version FROM write_heads WHERE id='publication'")[0][0],
                    "head":self.sql(c,"SELECT DOLT_HASHOF('HEAD')")[0][0],"native_commit_count":self.sql(c,"SELECT COUNT(*) FROM dolt_log")[0][0]}
        finally:
            c.close()

    def test(self, name, fn):
        started = time.monotonic()
        before = len(self.events)
        try:
            detail = fn()
            status = "passed" if detail.pop("passed", True) else "failed"
        except Exception as e:
            detail = {"error": repr(e), "traceback": traceback.format_exc()}
            status = "failed"
        self.result["checks"][name] = {"status": status, "duration_seconds": time.monotonic() - started,
                                        "observations": detail, "sql_event_start": before,
                                        "sql_event_end": len(self.events)}
        print(name + ": " + status, flush=True)

    def object_insert(self, conn, obj):
        self.sql(conn, "INSERT INTO objects(id,kind,revision,body,provenance) VALUES(%s,%s,%s,%s,%s)",
                 (obj["id"], obj["kind"], obj["revision"], canonical(obj["body"]), canonical(obj["provenance"])))

    def relation_insert(self, conn, rel):
        by_key = {(o["id"], o["revision"]): o["kind"] for o in self.fixture["objects"]}
        self.sql(conn, "INSERT INTO relations(id,kind,from_id,from_revision,from_kind,to_id,to_revision,to_kind,body) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                 (rel["id"], rel["kind"], rel["from_id"], rel["from_revision"],
                  by_key[(rel["from_id"], rel["from_revision"])], rel["to_id"], rel["to_revision"],
                  by_key[(rel["to_id"], rel["to_revision"])], canonical(rel["body"])))

    def setup(self):
        archive = self.args.artifact_root / "downloads/dolt-darwin-arm64.tar.gz"
        self.result["binary_asset"] = {"url": ASSET_URL, "expected_sha256": ASSET_SHA, "actual_sha256": digest(archive)}
        if digest(archive) != ASSET_SHA:
            raise RuntimeError("release digest mismatch")
        self.result["actual_version"] = self.command([self.binary, "version"]).strip()
        if self.result['actual_version'] != 'dolt version '+RELEASE:
            raise RuntimeError('Pinned binary version mismatch')
        self.result["binary_sha256"] = digest(self.binary)
        self.command([self.binary, "backup", "--help"])
        self.start_server(self.data, self.args.port, "primary-server")
        conn = self.connect(db=None)
        self.sql(conn, "CREATE DATABASE ledger_probe")
        self.sql(conn, "USE ledger_probe")
        self.conn = conn
        self.result["mysql_server_version"] = self.sql(conn, "SELECT VERSION(), DOLT_VERSION()")[0]
        kinds = sorted({o["kind"] for o in self.fixture["objects"]})
        rel_kinds = sorted({r["kind"] for r in self.fixture["relations"]})
        kind_list = ",".join("'" + k.replace("'", "''") + "'" for k in kinds)
        rel_list = ",".join("'" + k.replace("'", "''") + "'" for k in rel_kinds)
        schemas = [
            f"CREATE TABLE objects(id VARCHAR(160) NOT NULL,kind VARCHAR(40) NOT NULL,revision INT NOT NULL,body JSON NOT NULL,provenance JSON NOT NULL,PRIMARY KEY(id,revision),UNIQUE KEY typed_revision(id,revision,kind),CHECK(revision>0),CHECK(kind IN ({kind_list})))",
            f"CREATE TABLE relations(id VARCHAR(160) PRIMARY KEY,kind VARCHAR(40) NOT NULL,from_id VARCHAR(160) NOT NULL,from_revision INT NOT NULL,from_kind VARCHAR(40) NOT NULL,to_id VARCHAR(160) NOT NULL,to_revision INT NOT NULL,to_kind VARCHAR(40) NOT NULL,body JSON NOT NULL,FOREIGN KEY(from_id,from_revision,from_kind) REFERENCES objects(id,revision,kind),FOREIGN KEY(to_id,to_revision,to_kind) REFERENCES objects(id,revision,kind),CHECK(from_revision>0 AND to_revision>0),CHECK(kind IN ({rel_list})),CHECK(kind<>'uses_claim' OR to_kind='claim'))",
            "CREATE TABLE write_heads(id VARCHAR(160) PRIMARY KEY,version BIGINT NOT NULL,writer VARCHAR(40) NOT NULL,CHECK(version>0))",
            "CREATE TABLE operations(operation_id VARCHAR(160) PRIMARY KEY,payload_sha256 CHAR(64) NOT NULL,object_id VARCHAR(160) NOT NULL,object_revision INT NOT NULL,result_version BIGINT NOT NULL,native_message VARCHAR(400) NOT NULL,FOREIGN KEY(object_id,object_revision) REFERENCES objects(id,revision))",
            "CREATE TABLE working_markers(id VARCHAR(80) PRIMARY KEY,body JSON NOT NULL)",
        ]
        for statement in schemas:
            self.sql(conn, statement)
        self.result["schema_sql"] = schemas
        self.sql(conn,"INSERT INTO write_heads VALUES('publication',1,'baseline')")
        self.schema_commit = self.checkpoint(conn, "schema")
        initial_keys = {tuple(k) for k in self.contract["validation_history"]["baseline"]["object_keys"]}
        for obj in self.fixture["objects"]:
            if (obj["id"],obj["revision"]) in initial_keys:
                self.object_insert(conn, obj)
        initial_rel_ids = self.contract["validation_history"]["baseline"]["relation_ids"]
        for rel in self.fixture["relations"]:
            if rel["id"] in initial_rel_ids:
                self.relation_insert(conn, rel)
        sql_head = self.sql(conn, "SELECT DOLT_HASHOF('HEAD')")[0][0]
        self.sql(conn, "COMMIT")
        sql_head_after = self.sql(conn, "SELECT DOLT_HASHOF('HEAD')")[0][0]
        self.initial_commit = self.checkpoint(conn, "fixture_revision_1")
        self.result["sql_vs_native_commit"] = {"ordinary_sql_commit_head_before": sql_head, "ordinary_sql_commit_head_after": sql_head_after,
                                                 "dolt_commit_head": self.initial_commit,
                                                 "ordinary_commit_did_not_create_history": sql_head == sql_head_after,
                                                 "native_commit_created_history": sql_head_after != self.initial_commit}

    def corrections(self):
        conn = self.conn
        old = [o for o in self.fixture["objects"] if o["kind"] == "claim" and o["revision"] == 1 and "C02" in o["id"]][0]
        new = [o for o in self.fixture["objects"] if o["id"] == old["id"] and o["revision"] == 2][0]
        old_body = self.sql(conn, "SELECT body FROM objects AS OF %s WHERE id=%s AND revision=1", (self.initial_commit, old["id"]))[0][0]
        self.sql(conn, "START TRANSACTION")
        correction_keys = {tuple(k) for k in self.contract["validation_history"]["correction"]["add_object_keys"]}
        for obj in self.fixture["objects"]:
            if (obj["id"],obj["revision"]) in correction_keys:
                self.object_insert(conn, obj)
        initial_rel_ids = {r[0] for r in self.sql(conn, "SELECT id FROM relations")}
        for rel in self.fixture["relations"]:
            if rel["id"] not in initial_rel_ids:
                self.relation_insert(conn, rel)
        self.sql(conn, "COMMIT")
        current_before_history = self.sql(conn, "SELECT DOLT_HASHOF('HEAD')")[0][0]
        self.correction_commit = self.checkpoint(conn, "fixture_correction")
        old_readback = self.sql(conn, "SELECT body FROM objects AS OF %s WHERE id=%s AND revision=1", (self.initial_commit, old["id"]))[0][0]
        current_old = self.sql(conn, "SELECT body FROM objects WHERE id=%s AND revision=1", (old["id"],))[0][0]
        correction = self.sql(conn, "SELECT body FROM objects WHERE id=%s AND revision=2", (old["id"],))[0][0]
        historical_new = self.sql(conn, "SELECT COUNT(*) FROM objects AS OF %s WHERE id=%s AND revision=2", (self.initial_commit, old["id"]))[0][0]
        fixed = self.sql(conn, "SELECT id,kind,from_id,from_revision,to_id,to_revision FROM relations WHERE from_id=%s OR to_id=%s ORDER BY id", (old["id"], old["id"]))
        impact = self.sql(conn, "SELECT o.id,o.revision,JSON_UNQUOTE(JSON_EXTRACT(o.body,'$.scope')) FROM relations r JOIN objects o ON (o.id=r.from_id AND o.revision=r.from_revision) WHERE r.kind='uses_claim' AND r.to_id=%s AND r.to_revision=1 ORDER BY o.id", (old["id"],))
        downstream = self.sql(conn,"SELECT DISTINCT downstream.from_id FROM relations used JOIN relations downstream ON downstream.to_id=used.from_id AND downstream.to_revision=used.from_revision WHERE used.kind='uses_claim' AND used.to_id=%s AND used.to_revision=1 AND downstream.kind='interprets' ORDER BY downstream.from_id",(old["id"],))
        old_object_hash = value_hash(self.read_objects(conn,[[old["id"],1]],self.initial_commit)[0])
        new_object_hash = value_hash(self.read_objects(conn,[[old["id"],2]])[0])
        contract = next(k for k in self.contract["classes"] if k["id"].startswith('A2'))
        return {"passed": json.loads(old_body) == json.loads(old_readback) == json.loads(current_old) == old["body"] and json.loads(correction) == new["body"] and historical_new == 0 and old_object_hash==contract['historical_object_sha256'] and new_object_hash==contract['current_object_sha256'] and [r[0] for r in impact]==contract['direct_affected_ids'] and [r[0] for r in downstream]==contract['downstream_affected_ids'],
                "old_snapshot_commit": self.initial_commit, "successor_snapshot_commit": self.correction_commit,
                "head_before_native_correction_commit": current_before_history, "old_snapshot_content": json.loads(old_readback),
                "successor_content": json.loads(correction), "old_revision_persists": True,
                "historical_successor_count": historical_new, "version_fixed_relations": fixed, "affected_old_claim_consumers": impact,
                "downstream_affected_ids":downstream,"historical_object_sha256":old_object_hash,"current_object_sha256":new_object_hash,
                "immutability_boundary": "Append-only revision rows are an adapter convention. AS OF immutable content-addressed Dolt commits is native history."}

    def recall(self):
        contract = next(k for k in self.contract['classes'] if k['id'].startswith('A1'))
        results = {}
        for term in contract['queries']:
            rows = self.sql(self.conn, "SELECT id,revision,kind,JSON_UNQUOTE(JSON_EXTRACT(body,'$.scope')),JSON_UNQUOTE(JSON_EXTRACT(body,'$.state')) FROM objects WHERE kind='attempt' AND JSON_SEARCH(body,'one',%s,NULL,'$.aliases[*]') IS NOT NULL ORDER BY id,revision", (term,))
            results[term] = rows
        components = self.sql(self.conn, "SELECT id,kind,from_id,from_revision,to_id,to_revision,JSON_UNQUOTE(JSON_EXTRACT(body,'$.scope')) FROM relations WHERE from_id LIKE '%H08%' OR to_id LIKE '%H08%' OR from_id LIKE '%H18%' OR to_id LIKE '%H18%' ORDER BY id")
        failed_extra = self.sql(self.conn, "SELECT id,JSON_EXTRACT(body,'$.scope'),JSON_EXTRACT(body,'$.state'),body FROM objects WHERE id LIKE '%H13b%'")
        return {"passed": all([r[0] for r in rows]==contract['expected_ids'] and all(r[3]==contract['expected_scope_by_attempt'][r[0].split(':')[1]] for r in rows) for rows in results.values()),
                "queries": results, "component_relations": components, "failed_source_only_record": failed_extra,
                "recall_semantics": "Exact hand-transcribed metadata alias recall; stored scopes are returned verbatim. No Markdown extraction or general natural-language recall claim."}

    def duplicates(self):
        sources = self.sql(self.conn, "SELECT id,revision,JSON_UNQUOTE(JSON_EXTRACT(provenance,'$.sha256')),body,provenance FROM objects WHERE kind='source_check' AND (id LIKE '%S01%' OR id LIKE '%S15%') ORDER BY id")
        links = self.sql(self.conn, "SELECT id,kind,from_id,from_revision,to_id,to_revision,body FROM relations WHERE (from_id LIKE '%S01%' AND to_id LIKE '%S15%') OR (from_id LIKE '%S15%' AND to_id LIKE '%S01%')")
        media_values = []
        for row in sources:
            body, provenance = json.loads(row[3]), json.loads(row[4])
            media_values.append(next(a for a in body['aliases'] if len(a)==64))
        distinct_source_digests = len({r[2] for r in sources})
        return {"passed": len(sources) == 2 and bool(links), "sources": sources, "duplicate_relations": links,
                "source_file_digest_count": distinct_source_digests, "media_hashes": media_values,
                "independent_evidence_groups": 1 if links else len(sources),
                "deduplication_boundary": "Application explicitly groups fixture duplicate relations; distinct transcription file digests alone do not establish independent media evidence."}

    def copied_object(self, ident, revision=2):
        obj = json.loads(canonical(self.by_key[(ident,1)]))
        obj['revision'] = revision
        return obj

    def publication_request(self, ident='attempt:H13b'):
        obj = self.copied_object(ident)
        old_rel = next(r for r in self.fixture['relations'] if r['id']=='rel:H13b-repair-H13')
        rel = json.loads(canonical(old_rel))
        rel.update(id='rel:validation-publication-'+ident.split(':')[1],from_id=ident,from_revision=2)
        return {'object':obj,'relation':rel}

    def raw_relation_insert(self, conn, rel):
        from_kind = rel['from_id'].split(':')[0]
        to_kind = rel['to_id'].split(':')[0]
        self.sql(conn,"INSERT INTO relations(id,kind,from_id,from_revision,from_kind,to_id,to_revision,to_kind,body) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                 (rel['id'],rel['kind'],rel['from_id'],rel['from_revision'],from_kind,
                  rel['to_id'],rel['to_revision'],to_kind,canonical(rel['body'])))

    def integrity(self):
        self.branch('validation-A4')
        contract = next(k for k in self.contract['classes'] if k['id'].startswith('A4'))
        before = self.durable_state()
        copies = [self.copied_object(k[0],k[2]) for k in contract['copy_real_objects_to_new_revision']]
        request = {'objects':copies,'relation':contract['invalid_relation']}
        conn = self.connect(autocommit=False)
        error = None
        try:
            self.sql(conn,'START TRANSACTION')
            self.sql(conn,"UPDATE write_heads SET version=version+1,writer=%s WHERE id='publication' AND version=%s",(contract['operation_id'],before['version']))
            for obj in copies:
                self.object_insert(conn,obj)
            self.sql(conn,'INSERT INTO operations VALUES(%s,%s,%s,%s,%s,%s)',
                     (contract['operation_id'],value_hash(request),copies[0]['id'],2,before['version']+1,'would-be-invalid-publication'))
            self.raw_relation_insert(conn,contract['invalid_relation'])
            self.sql(conn,"CALL DOLT_COMMIT('-Am',%s,'--author',%s)",('invalid publication must not exist',AUTHOR))
        except Exception as e:
            error = repr(e)
            conn.rollback()
        finally:
            conn.close()
        after = self.durable_state()
        check_error = None
        try:
            self.sql(self.conn,"INSERT INTO objects VALUES('probe:bad-revision','attempt',0,'{}','{}')")
        except Exception as e:
            check_error = repr(e)
        typed_error = None
        rel = self.fixture['relations'][0]
        try:
            self.sql(self.conn,"INSERT INTO relations VALUES('probe:wrong-endpoint-type',%s,%s,%s,'attempt',%s,%s,'claim','{}')",
                     (rel['kind'],rel['from_id'],rel['from_revision'],rel['to_id'],rel['to_revision']))
        except Exception as e:
            typed_error = repr(e)
        return {'passed':bool(error) and before==after and bool(check_error) and bool(typed_error),
                'operation_id':contract['operation_id'],'attempted_real_object_keys':[[o['id'],o['revision']] for o in copies],
                'invalid_fk_error':error,'before':before,'after_independent_connection':after,
                'check_error':check_error,'typed_fk_error':typed_error,
                'rollback_boundary':'Native FK rejects the invalid statement; adapter explicitly aborts the entire multiobject transaction. Object, relation, operation, version and Dolt HEAD are independently read back unchanged.'}

    def native_result(self, conn, operation_id, request):
        rows = self.sql(conn,'SELECT payload_sha256,object_id,object_revision,result_version,native_message FROM operations WHERE operation_id=%s',(operation_id,))
        if not rows:
            return None
        if rows[0][0] != value_hash(request):
            raise ValueError('operation-content conflict: '+operation_id)
        commits = self.sql(conn,'SELECT commit_hash FROM dolt_log WHERE message=%s',(rows[0][4],))
        if len(commits)!=1:
            raise ValueError('operation commit binding requires exactly one native commit')
        return {'operation_id':operation_id,'payload_sha256':rows[0][0],'object_key':[rows[0][1],rows[0][2]],
                'version':rows[0][3],'native_commit':commits[0][0]}

    def publish(self, expected, operation_id, request, read_barrier=None, delay=0, unique_token=True):
        conn = self.connect(autocommit=False)
        observed = None
        try:
            self.sql(conn,'START TRANSACTION')
            existing = self.native_result(conn,operation_id,request)
            if existing:
                self.sql(conn,'ROLLBACK')
                return {'status':'recovered','result':existing,'observed_version':None}
            observed = self.sql(conn,"SELECT version FROM write_heads WHERE id='publication'")[0][0]
            if read_barrier:
                read_barrier.wait(timeout=15)
            if delay:
                time.sleep(delay)
            if observed != expected:
                raise ValueError(f'expected-version conflict: expected {expected}, observed {observed}')
            with conn.cursor() as q:
                if unique_token:
                    q.execute("UPDATE write_heads SET version=version+1,writer=%s WHERE id='publication' AND version=%s",(operation_id,expected))
                else:
                    q.execute("UPDATE write_heads SET version=version+1 WHERE id='publication' AND version=%s",(expected,))
                changed = q.rowcount
            if changed!=1:
                raise ValueError('atomic conditional version guard rejected operation')
            self.object_insert(conn,request['object'])
            self.raw_relation_insert(conn,request['relation'])
            message = 'ledger-operation:'+operation_id+':'+value_hash(request)
            self.sql(conn,'INSERT INTO operations VALUES(%s,%s,%s,%s,%s,%s)',
                     (operation_id,value_hash(request),request['object']['id'],request['object']['revision'],expected+1,message))
            commit = self.sql(conn,"CALL DOLT_COMMIT('-Am',%s,'--author',%s)",(message,AUTHOR))[0][0]
            return {'status':'committed','observed_version':observed,
                    'result':{'operation_id':operation_id,'payload_sha256':value_hash(request),
                              'object_key':[request['object']['id'],request['object']['revision']],
                              'version':expected+1,'native_commit':commit}}
        except Exception as e:
            try:
                conn.rollback()
            except Exception:
                pass
            return {'status':'explicit_conflict','observed_version':observed,'error':repr(e)}
        finally:
            conn.close()

    def cas(self):
        request = self.publication_request()
        trials = []
        self.branch('validation-A5-stale-control')
        stale_before = self.durable_state()
        first = self.publish(stale_before['version'],'validation:stale-first',request)
        stale = self.publish(stale_before['version'],'validation:stale-second',request)
        stale_after = self.durable_state()
        stale_passed = first['status']=='committed' and stale['status']=='explicit_conflict' and stale_after['version']==stale_before['version']+1 and stale_after['operation_count']==1
        for mode,delay in [('ordinary',0),('delayed-after-read',.3)]:
            for trial in range(self.args.cas_trials):
                self.branch(f'validation-A5-{mode}-{trial}')
                before = self.durable_state()
                barrier = threading.Barrier(2)
                outcomes = []
                lock = threading.Lock()
                def writer(name,wait):
                    writer_request = request if name.endswith('-a') else self.publication_request('attempt:H13')
                    value = self.publish(before['version'],name,writer_request,barrier,wait)
                    with lock:
                        outcomes.append(value)
                threads = [threading.Thread(target=writer,args=('validation:race-a',0)),
                           threading.Thread(target=writer,args=('validation:race-b',delay))]
                for thread in threads:
                    thread.start()
                for thread in threads:
                    thread.join(timeout=30)
                after = self.durable_state()
                conflicts_valid = all('duplicate' not in o.get('error','').lower() and ('1213' in o.get('error','') or 'expected-version conflict' in o.get('error','')) for o in outcomes if o['status']=='explicit_conflict')
                passed = conflicts_valid and len(outcomes)==2 and sum(o['status']=='committed' for o in outcomes)==1 and sum(o['status']=='explicit_conflict' for o in outcomes)==1 and after['version']==before['version']+1 and after['operation_count']==before['operation_count']+1 and after['object_count']==before['object_count']+1 and after['relation_count']==before['relation_count']+1 and after['native_commit_count']==before['native_commit_count']+1 and all(o['observed_version']==before['version'] for o in outcomes)
                trials.append({'mode':mode,'delay_seconds':delay,'trial':trial,'writers':outcomes,'disjoint_object_keys':[['attempt:H13b',2],['attempt:H13',2]],'conflict_reason_is_native_version_conflict':conflicts_valid,'before':before,'after_independent_connection':after,'passed':passed})
        return {'passed':stale_passed and all(t['passed'] for t in trials),
                'serial_stale_control':{'first':first,'stale':stale,'before':stale_before,'after':stale_after,'passed':stale_passed},
                'trials':trials,'barrier':'Two independent MySQL connections read the same global publication version before either mutation; delayed mode pauses writer B 300ms after that read.',
                'atomic_publication':'Conditional UPDATE, real H13b revision copy, fixed repair relation, operation registration and DOLT_COMMIT in one native SQL transaction.',
                'retry_policy':'No conflict retries or process-wide publication lock; divergent last-operation marker prevents two same-value version increments from being silently converged.'}

    def operation(self):
        self.branch('validation-A6')
        contract = next(k for k in self.contract['classes'] if k['id'].startswith('A6'))
        request = self.publication_request()
        op = contract['operation_id']
        before = self.durable_state()
        discarded_response = self.publish(before['version'],op,request)
        after_first = self.durable_state()
        recovered = self.publish(before['version'],op,request)
        after_replay = self.durable_state()
        conflict = self.publish(before['version'],op,self.publication_request('attempt:H13'))
        after_conflict = self.durable_state()
        passed = discarded_response['status']=='committed' and recovered['status']=='recovered' and recovered['result']==discarded_response['result'] and conflict['status']=='explicit_conflict' and 'operation-content conflict' in conflict['error'] and after_first==after_replay==after_conflict and after_first['version']==before['version']+1 and after_first['operation_count']==before['operation_count']+1 and after_first['object_count']==before['object_count']+1 and after_first['native_commit_count']==before['native_commit_count']+1
        return {'passed':passed,'operation_id':op,'discarded_response':discarded_response,
                'recovery':recovered,'different_payload_retry':conflict,'before':before,
                'after_initial_commit':after_first,'after_identical_replay':after_replay,'after_content_conflict':after_conflict,
                'native_commit_binding':'Persisted unique operation message + payload digest resolved to exactly one DOLT_LOG commit hash; recovery returns the original operation version and commit, not current HEAD.',
                'simulation':'Application deliberately discards completed success, closes the connection, reconnects and looks up operation_id before new mutation. No real TCP-response loss fault injected.'}

    def no_token_control(self):
        self.branch('diagnostic-no-unique-cas-token')
        before = self.durable_state()
        barrier = threading.Barrier(2)
        outcomes = []
        lock = threading.Lock()
        def writer(op,ident):
            value = self.publish(before['version'],op,self.publication_request(ident),barrier,unique_token=False)
            with lock:
                outcomes.append(value)
        threads = [threading.Thread(target=writer,args=('diagnostic:no-token-a','attempt:H13b')),
                   threading.Thread(target=writer,args=('diagnostic:no-token-b','attempt:H13'))]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
        after = self.durable_state()
        success_count = sum(o['status']=='committed' for o in outcomes)
        return {'passed':len(outcomes)==2,'diagnostic_only':True,'before':before,'writers':outcomes,
                'after_independent_connection':after,'success_count':success_count,
                'sql_guard_without_token':"UPDATE write_heads SET version=version+1 WHERE id='publication' AND version=?",
                'sql_guard_with_unique_operation_token':"UPDATE write_heads SET version=version+1,writer=? WHERE id='publication' AND version=?",
                'counterexample_to_version_counter_only':success_count==2,
                'interpretation':'If both operations succeed, same-value global version increments were converged; a unique per-operation token on the guarded row is required by this publication protocol.'}

    def backup(self):
        self.sql(self.conn,"CALL DOLT_CHECKOUT('main')")
        self.current_branch = 'main'
        conn = self.conn
        contract = next(k for k in self.contract['classes'] if k['id'].startswith('A7'))
        self.sql(conn,"CALL DOLT_BRANCH('validation-baseline',%s)",(self.initial_commit,))
        self.sql(conn,"CALL DOLT_BRANCH('validation-review',%s)",(self.correction_commit,))
        pending = self.copied_object('attempt:H13b')
        self.object_insert(conn,pending)
        self.sql(conn,'COMMIT')
        status = self.sql(conn,'SELECT * FROM dolt_status')
        primary_branches = self.sql(conn,'SELECT name,hash FROM dolt_branches ORDER BY name')
        history = self.contract['validation_history']
        baseline_keys = history['baseline']['object_keys']
        baseline_rels = history['baseline']['relation_ids']
        all_keys = [[o['id'],o['revision']] for o in self.fixture['objects']]
        all_rels = [r['id'] for r in self.fixture['relations']]
        primary_hashes = {
            'baseline_objects':value_hash(self.read_objects(conn,baseline_keys,self.initial_commit)),
            'baseline_relations':value_hash(self.read_relations(conn,baseline_rels,self.initial_commit)),
            'current_objects':value_hash(self.read_objects(conn,all_keys,self.correction_commit)),
            'current_relations':value_hash(self.read_relations(conn,all_rels,self.correction_commit)),
            'working_object':value_hash(self.read_objects(conn,[['attempt:H13b',2]])[0])}
        primary_logs = {}
        for branch,_ in primary_branches:
            c = self.connect(db='ledger_probe/'+branch)
            primary_logs[branch] = [r[0] for r in self.sql(c,'SELECT commit_hash FROM dolt_log ORDER BY commit_hash')]
            c.close()
        backup_path = self.run_dir/'native-backup'
        self.sql(conn,"CALL DOLT_BACKUP('sync-url',%s)",('file://'+str(backup_path),))
        backup_files = [{'path':str(path.relative_to(backup_path)),'bytes':path.stat().st_size,'sha256':digest(path)}
                        for path in sorted(backup_path.rglob('*')) if path.is_file()]
        restore_data = self.run_dir/'restored-data'
        restore_data.mkdir()
        self.command([self.binary,'backup','restore','file://'+str(backup_path),'ledger_probe'],cwd=restore_data)
        restore_port = self.args.port+1
        self.start_server(restore_data,restore_port,'restored-server')
        restored = self.connect(port=restore_port,db='ledger_probe/main')
        restore_branches = self.sql(restored,'SELECT name,hash FROM dolt_branches ORDER BY name')
        restored_hashes = {
            'baseline_objects':value_hash(self.read_objects(restored,baseline_keys,self.initial_commit)),
            'baseline_relations':value_hash(self.read_relations(restored,baseline_rels,self.initial_commit)),
            'current_objects':value_hash(self.read_objects(restored,all_keys,self.correction_commit)),
            'current_relations':value_hash(self.read_relations(restored,all_rels,self.correction_commit)),
            'working_object':value_hash(self.read_objects(restored,[['attempt:H13b',2]])[0])}
        restored_status = self.sql(restored,'SELECT * FROM dolt_status')
        pending_at_head = self.sql(restored,'SELECT COUNT(*) FROM objects AS OF %s WHERE id=%s AND revision=2',(self.correction_commit,'attempt:H13b'))[0][0]
        restored_old_hash = value_hash(self.read_objects(restored,[['claim:C02-stop-attribution',1]],self.initial_commit)[0])
        restored_new_hash = value_hash(self.read_objects(restored,[['claim:C02-stop-attribution',2]],self.correction_commit)[0])
        restored.close()
        restored_logs = {}
        for branch,_ in restore_branches:
            c = self.connect(port=restore_port,db='ledger_probe/'+branch)
            restored_logs[branch] = [r[0] for r in self.sql(c,'SELECT commit_hash FROM dolt_log ORDER BY commit_hash')]
            c.close()
        expected_hashes = {
            'baseline_objects':contract['expected_baseline_objects_hash'],
            'baseline_relations':contract['expected_baseline_relations_hash'],
            'current_objects':contract['expected_current_objects_hash'],
            'current_relations':contract['expected_current_relations_hash'],
            'working_object':value_hash(pending)}
        passed = primary_hashes==restored_hashes==expected_hashes and primary_branches==restore_branches and primary_logs==restored_logs and pending_at_head==0 and restored_old_hash==contract['expected_baseline_object_hash'] and restored_new_hash==contract['expected_current_object_hash'] and bool(restored_status)
        return {'passed':passed,'backup_path':str(backup_path),'restore_path':str(restore_data/'ledger_probe'),
                'restore_uses_new_empty_path':True,'backup_files':backup_files,
                'primary_branches':primary_branches,'restored_branches':restore_branches,
                'primary_commits_by_branch':primary_logs,'restored_commits_by_branch':restored_logs,
                'expected_content_hashes':expected_hashes,'primary_content_hashes':primary_hashes,'restored_content_hashes':restored_hashes,
                'old_claim_hash':restored_old_hash,'current_claim_hash':restored_new_hash,
                'native_working_set_recovery':'passed' if pending_at_head==0 and restored_hashes['working_object']==value_hash(pending) else 'failed',
                'pending_object_key':['attempt:H13b',2],'pending_object_count_at_committed_head':pending_at_head,
                'primary_status':status,'restored_status':restored_status,
                'backup_method':'Native DOLT_BACKUP sync-url + pinned CLI backup restore. Independent local MySQL server verifies every branch/history and fixed content hash. No logical dump/filesystem-copy fallback.',
                'scope':'Same-host empty-directory recovery; no independent-host disaster-recovery claim.'}

    def finish(self):
        try:
            if hasattr(self, "conn"):
                self.conn.close()
        except Exception:
            pass
        logs = []
        for process, log, log_path in reversed(self.servers):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            log.close()
            logs.append({"path": str(log_path), "exit_code": process.returncode})
        self.result["server_logs"] = logs
        self.result["servers_stopped"] = all(p.poll() is not None for p,_,_ in self.servers)
        self.result["sql_event_log"] = str(self.run_dir / "sql-events.json")
        (self.run_dir / "sql-events.json").write_text(json.dumps(self.events,ensure_ascii=False,indent=2,default=str)+"\n")
        self.result["elapsed_seconds"] = time.monotonic() - self.started
        self.result["maintenance_code"] = {"probe_file": str(Path(__file__).resolve()),
                                            "probe_sha256":digest(Path(__file__)),
                                            "source_lines": len(Path(__file__).read_text().splitlines()),
                                            "project_dependencies_changed": False,
                                            "adapter_estimate": "This reproducible harness includes install/server lifecycle and evidence reporting; no production adapter was implemented."}
        self.result['runtime_platform']={'system':os.uname().sysname,'machine':os.uname().machine,'python':sys.version}
        self.result['run_only_duration_note']='elapsed_seconds measures this fresh run, excluding binary download, SDK installation and harness development.'
        self.result["status"] = "passed" if self.result["checks"] and all(x["status"]=="passed" for x in self.result["checks"].values()) and "fatal_error" not in self.result else "failed"
        text = json.dumps(self.result, ensure_ascii=False, indent=2, default=str)+"\n"
        self.args.result.write_text(text)
        (self.run_dir / "dolt_result.json").write_text(text)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    here = Path(__file__).resolve().parent
    parser.add_argument("--fixture",type=Path,default=here/"fixture.json")
    parser.add_argument("--contract",type=Path,default=here/"contract.json")
    parser.add_argument("--result",type=Path,default=here/"dolt_result.json")
    parser.add_argument("--artifact-root",type=Path,default=ROOT)
    parser.add_argument("--port",type=int,default=13316)
    parser.add_argument("--cas-trials",type=int,default=10)
    parser.add_argument("--no-token-control",action='store_true',help='Bounded standalone negative CAS control; not the seven-class acceptance run')
    args = parser.parse_args()
    probe = Probe(args)
    try:
        probe.setup()
        probe.test("A2-correction-and-impact", probe.corrections)
        if args.no_token_control:
            probe.test('diagnostic-no-unique-cas-token',probe.no_token_control)
        else:
            probe.test("A1-component-recall", probe.recall)
            probe.test("A3-duplicate-source", probe.duplicates)
            probe.test("A4-atomic-rollback", probe.integrity)
            probe.test("A5-same-version-race", probe.cas)
            probe.test("A6-idempotent-operation", probe.operation)
            probe.test("A7-native-history-recovery", probe.backup)
    except Exception as e:
        probe.result["fatal_error"] = {"error":repr(e), "traceback":traceback.format_exc()}
    finally:
        probe.finish()
    print(str(args.result), flush=True)
    return 0 if probe.result["status"]=="passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
