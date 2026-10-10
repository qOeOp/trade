"""Append-only research record storage on the validated Dolt 2.4.2 protocol.

The caller owns record validation and publication intent. This adapter only
stores immutable revision rows, fixed revision relations and native commits.
There is no Git fallback, server lifecycle management or automatic write retry.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import timezone
import hashlib
import json
import re
import uuid

import pymysql

from research.records.common import RecordError


DOLT_VERSION = "2.4.2"
SCHEMA_VERSION = 1
AUTHOR = "Research Records <research-records@example.invalid>"


class ConflictError(RecordError):
    """Publication intent conflicts with persistent version or content."""


def _canonical(value):
    # Native JSON preserves the mathematical number, rendering 25.0 as 25.
    # Original source formatting is retained separately in raw byte payloads.
    def normalize(item):
        if isinstance(item, float) and item.is_integer():
            return int(item)
        if isinstance(item, dict):
            return {key: normalize(child) for key, child in item.items()}
        if isinstance(item, list):
            return [normalize(child) for child in item]
        return item

    try:
        return json.dumps(
            normalize(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise RecordError(f"record is not canonical JSON: {exc}") from exc


def _text(value, name, limit):
    if not isinstance(value, str) or not value or len(value) > limit:
        raise RecordError(f"{name} must be a nonempty string of at most {limit} characters")
    return value


def _revision(value, name="revision"):
    if type(value) is not int or value < 1 or value > 2147483647:
        raise RecordError(f"{name} must be a positive SQL INT")
    return value


def _normalized_objects(objects):
    unique = {}
    for item in objects:
        if not isinstance(item, dict):
            raise RecordError("objects must contain dictionaries")
        try:
            value = {
                "id": _text(item["id"], "object id", 160),
                "kind": _text(item["kind"], "object kind", 40),
                "revision": _revision(item["revision"]),
                "body": item["body"],
                "provenance": item["provenance"],
            }
        except KeyError as exc:
            raise RecordError(f"object missing {exc.args[0]}") from exc
        if not isinstance(value["body"], dict) or not isinstance(value["provenance"], dict):
            raise RecordError("object body and provenance must be JSON objects")
        value = json.loads(_canonical(value))
        key = (value["id"], value["revision"])
        if key in unique and _canonical(unique[key]) != _canonical(value):
            raise ConflictError(f"conflicting duplicate object revision: {key}")
        unique[key] = value
    return [unique[key] for key in sorted(unique)]


def _normalized_relations(relations):
    unique = {}
    for item in relations:
        if not isinstance(item, dict):
            raise RecordError("relations must contain dictionaries")
        try:
            value = {
                "id": _text(item["id"], "relation id", 160),
                "kind": _text(item["kind"], "relation kind", 40),
                "from_id": _text(item["from_id"], "from_id", 160),
                "from_revision": _revision(item["from_revision"], "from_revision"),
                "to_id": _text(item["to_id"], "to_id", 160),
                "to_revision": _revision(item["to_revision"], "to_revision"),
                "body": item["body"],
            }
        except KeyError as exc:
            raise RecordError(f"relation missing {exc.args[0]}") from exc
        if not isinstance(value["body"], dict):
            raise RecordError("relation body must be a JSON object")
        for name in ("from_kind", "to_kind"):
            if name in item:
                value[name] = _text(item[name], name, 40)
        value = json.loads(_canonical(value))
        key = value["id"]
        if key in unique and _canonical(unique[key]) != _canonical(value):
            raise ConflictError(f"conflicting duplicate relation: {key}")
        unique[key] = value
    return [unique[key] for key in sorted(unique)]


SCHEMA_SQL = (
    "CREATE TABLE record_store_schema (singleton TINYINT PRIMARY KEY, "
    "version INT NOT NULL, dolt_version VARCHAR(40) NOT NULL, "
    "CHECK(singleton=1))",
    "CREATE TABLE objects (id VARCHAR(160) COLLATE utf8mb4_bin NOT NULL, "
    "revision INT NOT NULL, kind VARCHAR(40) COLLATE utf8mb4_bin NOT NULL, "
    "body JSON NOT NULL, provenance JSON NOT NULL, PRIMARY KEY(id,revision), "
    "UNIQUE KEY typed_revision(id,revision,kind), CHECK(revision>0))",
    "CREATE TABLE relations (id VARCHAR(160) COLLATE utf8mb4_bin PRIMARY KEY, "
    "kind VARCHAR(40) COLLATE utf8mb4_bin NOT NULL, "
    "from_id VARCHAR(160) COLLATE utf8mb4_bin NOT NULL, from_revision INT NOT NULL, "
    "from_kind VARCHAR(40) COLLATE utf8mb4_bin NOT NULL, "
    "to_id VARCHAR(160) COLLATE utf8mb4_bin NOT NULL, to_revision INT NOT NULL, "
    "to_kind VARCHAR(40) COLLATE utf8mb4_bin NOT NULL, body JSON NOT NULL, "
    "FOREIGN KEY(from_id,from_revision,from_kind) REFERENCES objects(id,revision,kind), "
    "FOREIGN KEY(to_id,to_revision,to_kind) REFERENCES objects(id,revision,kind), "
    "CHECK(from_revision>0 AND to_revision>0), "
    "CHECK(kind<>'uses_claim' OR to_kind='claim'))",
    "CREATE TABLE write_head (singleton TINYINT PRIMARY KEY, version BIGINT NOT NULL, "
    "writer VARCHAR(40) COLLATE utf8mb4_bin NOT NULL, UNIQUE KEY writer_token(writer), "
    "CHECK(singleton=1), CHECK(version>=0))",
    "CREATE TABLE operations (operation_id VARCHAR(160) COLLATE utf8mb4_bin PRIMARY KEY, "
    "payload_sha256 CHAR(64) NOT NULL, result_version BIGINT NOT NULL, "
    "native_message VARCHAR(320) COLLATE utf8mb4_bin NOT NULL, message TEXT NOT NULL, "
    "UNIQUE KEY native_operation_message(native_message), CHECK(result_version>0))",
)


class DoltStore:
    """Connect directly to one explicitly configured local Dolt database."""

    def __init__(self, config):
        if not isinstance(config, dict):
            raise RecordError("Dolt configuration must be a dictionary")
        self.config = dict(config)
        self.database = config.get("database")
        if not isinstance(self.database, str) or not re.fullmatch(
            r"[A-Za-z_][A-Za-z0-9_]{0,63}", self.database
        ):
            raise RecordError("an explicit Dolt database name is required (letters, digits, underscore)")
        if config.get("dolt_version", DOLT_VERSION) != DOLT_VERSION:
            raise RecordError(f"only validated Dolt {DOLT_VERSION} is supported")
        if config.get("schema_version", SCHEMA_VERSION) != SCHEMA_VERSION:
            raise RecordError(f"only research record schema {SCHEMA_VERSION} is supported")
        port = config.get("port", 3306)
        if type(port) is not int or not 1 <= port <= 65535:
            raise RecordError("Dolt port must be an integer from 1 to 65535")
        self._connection_config = {
            "host": config.get("host", "127.0.0.1"), "port": port,
            "user": config.get("user", "root"), "password": config.get("password", ""),
            "charset": "utf8mb4", "connect_timeout": 5,
            "read_timeout": 60, "write_timeout": 60,
        }
        if config.get("unix_socket"):
            self._connection_config["unix_socket"] = config["unix_socket"]

    @staticmethod
    def _sql(conn, statement, params=None):
        with conn.cursor() as cursor:
            cursor.execute(statement, params)
            rows, changed = cursor.fetchall(), cursor.rowcount
            while cursor.nextset():
                cursor.fetchall()
            return rows, changed

    @contextmanager
    def _connection(self, *, database=True, autocommit=True):
        conn = None
        try:
            kwargs = dict(self._connection_config, autocommit=autocommit)
            if database:
                kwargs["database"] = self.database
            conn = pymysql.connect(**kwargs)
            version = self._sql(conn, "SELECT DOLT_VERSION()")[0][0][0]
            if version != DOLT_VERSION:
                raise RecordError(f"Dolt version mismatch: expected {DOLT_VERSION}, observed {version}")
            yield conn
        except pymysql.MySQLError as exc:
            if exc.args and exc.args[0] == 1213:
                raise ConflictError(
                    "native Dolt transaction conflict (1213); retry the same operation only after rereading",
                    code="NATIVE_TRANSACTION_CONFLICT", path="/operation_id",
                    expected="one atomic publication at the current version",
                    next_actions=["Check the original operation receipt before retrying. If absent, reread the ledger and recheck the fixed evidence, then retry the same operation and unchanged payload; do not invent a replacement operation to bypass the conflict."],
                ) from exc
            raise RecordError(
                f"Dolt SQL error: {exc}", code="DOLT_SQL_ERROR",
                expected="a reachable pinned Dolt backend and valid native constraints",
                next_actions=["Check backend availability and the reported constraint. For a publication, query its original operation receipt before retrying; an unconfirmed result is not proof that nothing was written."],
            ) from exc
        finally:
            if conn is not None:
                conn.close()

    def _check_schema(self, conn):
        rows = self._sql(
            conn, "SELECT singleton,version,dolt_version FROM record_store_schema"
        )[0]
        if rows != ((1, SCHEMA_VERSION, DOLT_VERSION),):
            raise RecordError("Dolt record schema/version mismatch; no automatic migration is permitted")

    def initialize(self):
        """Create a fresh schema and native checkpoint; never repair a partial schema."""
        with self._connection(database=False) as conn:
            self._sql(conn, f"CREATE DATABASE IF NOT EXISTS `{self.database}`")
            self._sql(conn, f"USE `{self.database}`")
            tables = {row[0] for row in self._sql(conn, "SHOW TABLES")[0]}
            expected = {"record_store_schema", "objects", "relations", "write_head", "operations"}
            if tables:
                if not expected.issubset(tables):
                    raise RecordError("existing Dolt database lacks the complete record schema")
                self._check_schema(conn)
            else:
                for statement in SCHEMA_SQL:
                    self._sql(conn, statement)
                self._sql(conn, "INSERT INTO record_store_schema VALUES(1,%s,%s)",
                          (SCHEMA_VERSION, DOLT_VERSION))
                self._sql(conn, "INSERT INTO write_head VALUES(1,0,'schema')")
                self._sql(conn, "CALL DOLT_COMMIT('-Am',%s,'--author',%s)",
                          (f"research-records-schema:{SCHEMA_VERSION}", AUTHOR))
        return self.status()

    @staticmethod
    def _object(row):
        return {"id": row[0], "kind": row[1], "revision": row[2],
                "body": json.loads(row[3]), "provenance": json.loads(row[4])}

    @staticmethod
    def _relation(row):
        return {"id": row[0], "kind": row[1], "from_id": row[2],
                "from_revision": row[3], "from_kind": row[4], "to_id": row[5],
                "to_revision": row[6], "to_kind": row[7], "body": json.loads(row[8])}

    @staticmethod
    def _as_of(commit):
        if commit is None:
            return "", ()
        if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-v]{32}", commit):
            raise RecordError("historical reads require an exact 32-character Dolt commit hash")
        return " AS OF %s", (commit,)

    def list_objects(self, kind=None, commit=None, latest=True):
        """Read at one native commit; optionally retain all revision rows."""
        suffix, params = self._as_of(commit)
        if latest:
            # Find each identity's current revision before filtering its kind,
            # and return JSON only for those revisions. Both table reads must
            # use the same historical snapshot when a commit is supplied.
            query = (
                "SELECT current.id,current.kind,current.revision,current.body,current.provenance "
                "FROM objects" + suffix + " AS current INNER JOIN "
                "(SELECT id,MAX(revision) AS revision FROM objects" + suffix +
                " GROUP BY id) AS newest "
                "ON current.id=newest.id AND current.revision=newest.revision"
            )
            params += params
            kind_column = "current.kind"
            order = " ORDER BY current.id,current.revision DESC"
        else:
            query = "SELECT id,kind,revision,body,provenance FROM objects" + suffix
            kind_column = "kind"
            order = " ORDER BY id,revision DESC"
        predicates = []
        if kind is not None:
            _text(kind, "object kind", 64)
            predicates.append(f"{kind_column}=%s")
            params += (kind,)
        where = " WHERE " + " AND ".join(predicates) if predicates else ""
        with self._connection() as conn:
            self._check_schema(conn)
            rows = self._sql(conn, query + where + order, params)[0]
        return [self._object(row) for row in rows]

    def get_object(self, id, revision=None, commit=None):
        _text(id, "object id", 160)
        suffix, params = self._as_of(commit)
        query = "SELECT id,kind,revision,body,provenance FROM objects" + suffix + " WHERE id=%s"
        params += (id,)
        if revision is not None:
            query += " AND revision=%s"
            params += (_revision(revision),)
        query += " ORDER BY revision DESC LIMIT 1"
        with self._connection() as conn:
            self._check_schema(conn)
            rows = self._sql(conn, query, params)[0]
        return self._object(rows[0]) if rows else None

    def list_relations(self, commit=None, *, kinds=None, from_refs=None, to_refs=None, include_body=True):
        """Filter existing relation columns at one snapshot.

        Endpoints are ``(id, revision)`` pairs; ``revision=None`` selects the
        identity across revisions. From/to selections are alternatives, while
        kinds further restrict them. Empty selections return no rows. Index
        reads omit JSON without joining away dangling endpoints.
        """
        suffix, params = self._as_of(commit)
        if type(include_body) is not bool:
            raise RecordError("include_body must be a boolean")
        predicates, endpoints = [], []
        if kinds is not None:
            if isinstance(kinds, str):
                raise RecordError("relation kind filter must be a collection")
            kinds = tuple(_text(value, "relation kind", 40) for value in kinds)
            predicates.append("kind IN (" + ",".join(["%s"] * len(kinds)) + ")" if kinds else "FALSE")
            params += kinds
        for side, references in (("from", from_refs), ("to", to_refs)):
            if references is None:
                continue
            selected = []
            for reference in references:
                if not isinstance(reference, (tuple, list)) or len(reference) != 2:
                    raise RecordError("relation endpoint filter requires (id, revision) pairs")
                identity, revision = reference
                _text(identity, "relation endpoint id", 160)
                predicate = f"{side}_id=%s"
                params += (identity,)
                if revision is not None:
                    predicate += f" AND {side}_revision=%s"
                    params += (_revision(revision),)
                selected.append("(" + predicate + ")")
            endpoints.extend(selected)
        if from_refs is not None or to_refs is not None:
            predicates.append("(" + " OR ".join(endpoints) + ")" if endpoints else "FALSE")
        where = " WHERE " + " AND ".join(predicates) if predicates else ""
        columns = "id,kind,from_id,from_revision,from_kind,to_id,to_revision,to_kind"
        if include_body:
            columns += ",body"
        with self._connection() as conn:
            self._check_schema(conn)
            rows = self._sql(conn, "SELECT " + columns + " FROM relations" + suffix +
                             where + " ORDER BY id", params)[0]
        if include_body:
            return [self._relation(row) for row in rows]
        return [dict(zip(columns.split(","), row)) for row in rows]

    def _read_head(self, conn, commit=None):
        suffix, params = self._as_of(commit)
        rows = self._sql(conn, "SELECT version,writer FROM write_head" + suffix +
                         " WHERE singleton=1", params)[0]
        if len(rows) != 1:
            raise RecordError("Dolt publication head is missing")
        return rows[0]

    def status(self):
        with self._connection() as conn:
            self._check_schema(conn)
            head = self._sql(conn, "SELECT DOLT_HASHOF('HEAD')")[0][0][0]
            version, writer = self._read_head(conn, head)
            counts = {
                name: self._sql(conn, f"SELECT COUNT(*) FROM {table} AS OF %s", (head,))[0][0][0]
                for name, table in (("object_revisions", "objects"), ("relations", "relations"),
                                    ("operations", "operations"), ("native_commits", "dolt_log"))
            }
            dirty = bool(self._sql(conn, "SELECT * FROM dolt_status")[0])
        return {"database": self.database, "dolt_version": DOLT_VERSION,
                "schema_version": SCHEMA_VERSION, "version": version, "writer": writer,
                "commit": head, "dirty": dirty, **counts}

    def operation_receipt(self, operation_id, commit=None):
        """Read the actual publication commit visible at one fixed snapshot."""
        _text(operation_id, "operation_id", 160)
        with self._connection() as conn:
            self._check_schema(conn)
            fixed = commit or self._sql(conn, "SELECT DOLT_HASHOF('HEAD')")[0][0][0]
            rows = self._sql(conn,
                "SELECT result_version,native_message FROM operations AS OF %s WHERE operation_id=%s",
                (fixed, operation_id))[0]
            if not rows:
                raise RecordError(f"unknown publication operation at {fixed}: {operation_id}")
            version, message = rows[0]
            commits = self._sql(conn,
                "SELECT commit_hash FROM dolt_log AS OF %s WHERE message=%s", (fixed, message))[0]
            if len(commits) != 1:
                raise RecordError(f"operation {operation_id} must bind to exactly one native commit")
            return {"operation_id": operation_id, "version": version, "commit": commits[0][0]}

    def commit_time(self, commit):
        """Return a native commit's UTC time; Dolt reports it as a naive UTC datetime."""
        _text(commit, "commit", 64)
        with self._connection() as conn:
            rows = self._sql(conn, "SELECT date FROM dolt_log WHERE commit_hash=%s", (commit,))[0]
        if len(rows) != 1:
            raise RecordError(f"unknown native commit: {commit}")
        return rows[0][0].replace(tzinfo=timezone.utc)

    def _operation_result(self, conn, operation_id, payload_sha256):
        rows = self._sql(conn,
            "SELECT payload_sha256,result_version,native_message FROM operations WHERE operation_id=%s",
            (operation_id,))[0]
        if not rows:
            return None
        digest, version, message = rows[0]
        if digest != payload_sha256:
            raise ConflictError(
                f"operation-content conflict: {operation_id}",
                code="OPERATION_CONTENT_CONFLICT", path="/operation_id",
                expected="the exact original content for an existing operation ID",
                next_actions=["Read the original operation receipt and fixed content. Retry that operation with its unchanged payload; use a new operation ID only for an intentional new publication after reviewing its evidence."],
                write_status="not_written",
            )
        commits = self._sql(conn, "SELECT commit_hash FROM dolt_log WHERE message=%s", (message,))[0]
        if len(commits) != 1:
            raise RecordError(f"operation {operation_id} must bind to exactly one native commit")
        return {"operation_id": operation_id, "version": version,
                "commit": commits[0][0], "replayed": True}

    def _insert_object(self, conn, obj):
        rows = self._sql(conn,
            "SELECT id,kind,revision,body,provenance FROM objects WHERE id=%s AND revision=%s",
            (obj["id"], obj["revision"]))[0]
        if rows:
            if _canonical(self._object(rows[0])) != _canonical(obj):
                raise ConflictError(f"immutable object revision conflict: {obj['id']}@{obj['revision']}")
            return
        self._sql(conn, "INSERT INTO objects(id,kind,revision,body,provenance) VALUES(%s,%s,%s,%s,%s)",
                  (obj["id"], obj["kind"], obj["revision"], _canonical(obj["body"]),
                   _canonical(obj["provenance"])))

    def _insert_relation(self, conn, rel):
        value = dict(rel)
        for side in ("from", "to"):
            name = side + "_kind"
            if name not in value:
                rows = self._sql(conn, "SELECT kind FROM objects WHERE id=%s AND revision=%s",
                                 (rel[side + "_id"], rel[side + "_revision"]))[0]
                if not rows:
                    raise RecordError(f"relation {rel['id']} has a missing {side} endpoint")
                value[name] = rows[0][0]
        rows = self._sql(conn,
            "SELECT id,kind,from_id,from_revision,from_kind,to_id,to_revision,to_kind,body "
            "FROM relations WHERE id=%s", (rel["id"],))[0]
        if rows:
            if _canonical(self._relation(rows[0])) != _canonical(value):
                raise ConflictError(f"immutable relation conflict: {rel['id']}")
            return
        self._sql(conn,
            "INSERT INTO relations(id,kind,from_id,from_revision,from_kind,to_id,to_revision,to_kind,body) "
            "VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (value["id"], value["kind"], value["from_id"], value["from_revision"], value["from_kind"],
             value["to_id"], value["to_revision"], value["to_kind"], _canonical(value["body"])))

    def publish(self, objects, relations, operation_id, expected_version, message="publish research records",
                *, validated_by=None):
        """Append revisions atomically, or recover the original completed operation.

        Snapshot batches may include unchanged existing keys. A changed existing
        revision or relation is rejected; a correction requires a new key. The
        operation digest covers normalized sorted content and the human message,
        while expected_version is omitted so stale identical retries can recover.
        Only a publication API that has checked its contract writes, naming
        itself in ``validated_by``; a script cannot publish around it by mistake.
        """
        _text(operation_id, "operation_id", 160)
        if type(expected_version) is not int or expected_version < 0:
            raise RecordError("expected_version must be a nonnegative integer")
        if not isinstance(message, str):
            raise RecordError("publication message must be a string")
        payload = {"objects": _normalized_objects(objects),
                   "relations": _normalized_relations(relations), "message": message}
        if validated_by is None:
            raise RecordError(
                "raw store publication is refused; use a publication command",
                code="RAW_RECORD_PUBLICATION", path="/validated_by",
                expected="publish attempt, artifacts register, strategy publish or material retain",
                next_actions=["Publish attempts with `publish attempt`, runs with `artifacts register`, strategies "
                              "with `strategy publish` and evidence originals with `material retain`."],
                write_status="not_written")
        digest = hashlib.sha256(_canonical(payload).encode()).hexdigest()
        native_message = f"research-records-operation:{operation_id}:{digest}"
        with self._connection(autocommit=False) as conn:
            try:
                conn.begin()
                self._check_schema(conn)
                prior = self._operation_result(conn, operation_id, digest)
                if prior:
                    conn.rollback()
                    return prior
                if self._sql(conn, "SELECT * FROM dolt_status")[0]:
                    # DOLT_COMMIT -A would otherwise commit stray SQL edits under this receipt.
                    raise RecordError(
                        "Dolt working set has unpublished SQL changes; resolve before publication",
                        code="DIRTY_WORKING_SET", path="/expected_version",
                        expected="a clean working set at the last published commit",
                        next_actions=["Inspect `dolt_status` and the uncommitted rows; do not publish them under "
                                      "another operation's receipt."],
                        write_status="not_written")
                observed, _ = self._read_head(conn)
                if observed != expected_version:
                    raise ConflictError(
                        f"expected-version conflict: expected {expected_version}, observed {observed}",
                        code="EXPECTED_VERSION_CONFLICT", path="/expected_version",
                        expected=observed,
                        next_actions=["Read the current ledger status and the original operation receipt. If the operation is absent, recheck the payload and fixed evidence against the current snapshot before retrying with its current version."],
                        write_status="not_written",
                    )
                changed = self._sql(conn,
                    "UPDATE write_head SET version=version+1,writer=%s WHERE singleton=1 AND version=%s",
                    (uuid.uuid4().hex, expected_version))[1]
                if changed != 1:
                    raise ConflictError(
                        "conditional publication version guard rejected operation",
                        code="PUBLICATION_VERSION_GUARD", path="/expected_version",
                        expected="the current version at the atomic write guard",
                        next_actions=["Reread the ledger and original operation receipt; recheck fixed evidence before retrying the unchanged operation at the observed version."],
                        write_status="not_written",
                    )
                for obj in payload["objects"]:
                    self._insert_object(conn, obj)
                for rel in payload["relations"]:
                    self._insert_relation(conn, rel)
                self._sql(conn, "INSERT INTO operations VALUES(%s,%s,%s,%s,%s)",
                          (operation_id, digest, expected_version + 1, native_message, message))
                commit = self._sql(conn, "CALL DOLT_COMMIT('-Am',%s,'--author',%s)",
                                   (native_message, AUTHOR))[0][0][0]
                return {"operation_id": operation_id, "version": expected_version + 1,
                        "commit": commit, "replayed": False}
            except Exception:
                # A native statement error does not itself abort all preceding
                # writes. Never let a partially failed batch become durable.
                try:
                    conn.rollback()
                except pymysql.MySQLError:
                    pass
                raise
