"""Read-only market supply over HTTP; native exports and their semantic identity stay unchanged.

The server owns the Dolt reader. Clients own disposable, verified content-addressed caches, never
a clone of the source database. A fresh request always reaches the existing exporter. Transport
manifests live outside native input roots; they are not research records or export receipts.

The two ends agree on the protocol and the database. They need not run the same exporter code: the
client verifies every served file against the manifest, the input identity holds the content hash
of what it received, and comparisons refuse different content (registration.input_key). The
supply's exporter hash is provenance only, recorded as the input identity's exporter_source_sha256;
a change to the request, response or manifest shape is a new PROTOCOL.
"""

from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
import fcntl
import hashlib
from http.client import IncompleteRead
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from ledger.errors import Refusal
from ledger.refusals import CATALOGUE, refuse
from market.export import exporter_sha256
from market.sources import MarketError


PROTOCOL = "market-supply-v2"
HASH = re.compile(r"[0-9a-f]{64}\Z")
COMMIT = re.compile(r"[0-9a-v]{32}\Z")
BLOCK = 1024 * 1024
MAX_JSON = 16 * BLOCK


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(BLOCK):
            result.update(block)
    return result.hexdigest()


def invalid(message: str, *, missing: tuple[str, ...] = (), expected: str | None = None):
    return refuse("MARKET_REMOTE_INVALID", message, missing=missing, expected=expected)


def differs(field: str, sent, served):
    """The refusal of a protocol or database that differs between this client and the supply."""
    return invalid(f"supply {field} differs: the client requests {sent!r}, the supply serves {served!r}",
                   missing=(field,), expected=None if served is None else str(served))


def relative(name: str) -> str:
    if (not isinstance(name, str) or not name or "\\" in name or "\x00" in name
            or PurePosixPath(name).is_absolute() or any(p in ("", ".", "..") for p in name.split("/"))):
        raise invalid("supply files must have normalized relative paths")
    return name


@contextmanager
def locked(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield


def atomic_json(path: Path, value):
    partial = path.with_suffix(".partial")
    partial.write_bytes(canonical(value))
    os.replace(partial, path)


class RemoteMarket:
    """The MarketAdapter protocol, with no local Dolt service/profile requirement."""

    def __init__(self, profile: dict):
        self.database = profile["database"]
        self.url = profile["remote_url"].rstrip("/")
        # Authentication belongs to the deployment's transport, never a market profile or URL.
        from urllib.parse import urlsplit
        parsed = urlsplit(self.url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
            raise invalid("remote_url must be an HTTP(S) service URL without credentials")
        if parsed.query or parsed.fragment:
            raise invalid("remote_url cannot contain a query or fragment")
        self.cache = Path(profile.get("cache_root", Path(tempfile.gettempdir()) / "trade-market-remote"))
        self.timeout = profile.get("timeout_seconds", 3600)
        self.transferred_bytes = 0
        self.exporter: str | None = None  # the supply's exporter hash, from its latest response

    def _rpc(self, method, **args):
        request = {"protocol": PROTOCOL, "database": self.database, "method": method, "args": args}
        try:
            with urlopen(Request(self.url + "/rpc", canonical(request),
                                 {"Content-Type": "application/json"}), timeout=self.timeout) as response:
                raw = response.read(MAX_JSON + 1)
            if len(raw) > MAX_JSON:
                raise invalid("supply response exceeds the metadata limit")
            result = json.loads(raw)
        except HTTPError as exc:
            try:
                with exc:
                    body = json.loads(exc.read(MAX_JSON))
                if "market_error" in body:
                    failure = body["market_error"]
                    raise MarketError(failure["message"], code=failure["code"], missing=tuple(failure.get("missing", ()))) from exc
                failure = body["refusal"]
                raise Refusal(failure["code"], failure["message"], missing=tuple(failure.get("missing", ())),
                              write_status="not_written", expected=failure.get("expected"),
                              next_actions=CATALOGUE.get(failure["code"], ("", ()))[1]) from exc
            except (KeyError, ValueError, TypeError):
                raise invalid(f"supply HTTP status {exc.code}") from exc
        except (OSError, URLError, TimeoutError, IncompleteRead) as exc:
            raise refuse("MARKET_REMOTE_UNAVAILABLE", "market supply transport failed; no local fallback") from exc
        except (ValueError, TypeError) as exc:
            raise invalid("supply response is not valid JSON") from exc
        if not isinstance(result, dict):
            raise invalid("supply response is not an object")
        for field, sent in (("protocol", PROTOCOL), ("database", self.database)):
            if result.get(field) != sent:
                raise differs(field, sent, result.get(field))
        if not isinstance(result.get("exporter"), str) or not HASH.fullmatch(result["exporter"]):
            raise invalid("supply response names no exporter hash")
        if "result" not in result:
            raise invalid("supply response has no result")
        self.exporter = result["exporter"]
        return result["result"]

    def resolve_commit(self, at):
        result = self._rpc("resolve_commit", at=at)
        if not isinstance(result, str) or not COMMIT.fullmatch(result):
            raise invalid("supply did not resolve an immutable commit")
        return result

    def universe_rule(self, commit):
        return self._rpc("universe_rule", commit=commit)

    def universe_month(self, commit):
        return [tuple(row) for row in self._rpc("universe_month", commit=commit)]

    def membership_path(self, commit, window_end):
        return self._rpc("membership_path", commit=commit, window_end=window_end)

    def validate_lifecycle(self, body, commit, files):
        from registration.seams import validate_lifecycle
        return validate_lifecycle(body, commit, files)

    def _object(self, item) -> Path:
        sha, size = item["sha256"], item["size"]
        objects = self.cache / "objects"
        objects.mkdir(parents=True, exist_ok=True)
        target = objects / sha
        with locked(objects / (sha + ".lock")):
            if target.is_file() and not target.is_symlink() and target.stat().st_size == size and digest(target) == sha:
                return target
            # Never accept a damaged cache object; replace only after a complete verified download.
            partial = objects / (sha + ".partial")
            if partial.is_symlink():
                raise invalid("cache contains a symbolic link")
            offset = partial.stat().st_size if partial.exists() else 0
            if offset > size:
                raise invalid("partial cache object exceeds its manifest size")
            try:
                if offset < size:
                    req = Request(self.url + "/objects/" + sha, headers={"Range": f"bytes={offset}-"})
                    with urlopen(req, timeout=self.timeout) as response:
                        if (response.status != 206 or response.headers.get("Content-Range") !=
                                f"bytes {offset}-{size - 1}/{size}"):
                            raise invalid("supply did not return the requested object range")
                        with partial.open("ab") as stream:
                            while block := response.read(min(BLOCK, size - stream.tell() + 1)):
                                stream.write(block)
                                self.transferred_bytes += len(block)
                                if stream.tell() > size:
                                    raise invalid("supply object exceeds its manifest size")
                elif size == 0 and not partial.exists():
                    partial.touch()
            except (OSError, URLError, TimeoutError, IncompleteRead) as exc:
                raise refuse("MARKET_REMOTE_UNAVAILABLE", "market object transfer interrupted; partial is unaccepted") from exc
            if partial.stat().st_size != size or digest(partial) != sha:
                # Keep evidence of the failure; do not automatically retry a corrupt response.
                raise invalid("market object does not match its size and SHA-256")
            os.replace(partial, target)
        return target

    def export_catalogs(self, commit, symbols, start_ns, end_ns, episodes, lifecycle_files, fresh, *, include_quotes=True,
                        include_trades=False):
        args = {"commit": commit, "symbols": symbols, "start_ns": start_ns, "end_ns": end_ns,
                "episodes": episodes, "lifecycle_files": {relative(n): base64.b64encode(v).decode()
                                                          for n, v in (lifecycle_files or {}).items()},
                "fresh": fresh, "include_quotes": include_quotes, "include_trades": include_trades}
        key = hashlib.sha256(canonical({"protocol": PROTOCOL, "url": self.url, "database": self.database,
                                       "args": {**args, "fresh": False}})).hexdigest()
        requests = self.cache / "requests"
        started = time.monotonic()
        if not fresh and self.exporter is None:
            self.resolve_commit(commit)  # learns the supply's exporter: a cached export is reused only from it
        with locked(requests / (key + ".lock")):
            manifest_path = requests / (key + ".json")
            manifest = None
            if not fresh and manifest_path.is_file() and not manifest_path.is_symlink():
                try:
                    manifest = json.loads(manifest_path.read_bytes())
                except ValueError as exc:
                    raise invalid("cached supply manifest is not valid JSON") from exc
                if isinstance(manifest, dict) and manifest.get("exporter_source_sha256") != self.exporter:
                    manifest = None  # another supply exporter made it: export anew, as a local cache would
            if manifest is None:
                manifest = self._rpc("export_catalogs", **args)
            self._validate_manifest(manifest, args)
            materialized = Path(tempfile.mkdtemp(prefix="market-remote-inputs-"))
            try:
                for item in manifest["files"]:
                    source = self._object(item)
                    target = materialized / item["path"]
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, target)  # no hard links: replay/cache mutations stay isolated
                    if digest(target) != item["sha256"]:
                        raise invalid("materialized input differs from its verified cache object")
                for symbol in symbols:
                    if json.loads((materialized / symbol / "export.json").read_bytes()) != manifest["receipts"][symbol]:
                        raise invalid("native receipt differs from the supply manifest")
                atomic_json(manifest_path, manifest)  # completion is published only after all files verify
            except BaseException:
                shutil.rmtree(materialized)
                raise
        return {"commit": commit, "root": materialized, "receipts": manifest["receipts"],
                "exporter_source_sha256": manifest["exporter_source_sha256"], "temporary": True,
                "exported": manifest["exported"], "reused": manifest["reused"],
                "seconds": round(time.monotonic() - started, 3)}

    @staticmethod
    def _validate_manifest(manifest, args):
        try:
            RemoteMarket._check_manifest(manifest, args)
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise invalid("supply manifest is malformed") from exc

    @staticmethod
    def _check_manifest(manifest, args):
        if (not isinstance(manifest, dict) or manifest.get("request") != args
                or manifest.get("commit") != args["commit"] or not isinstance(manifest.get("files"), list)
                or set(manifest.get("receipts", {})) != set(args["symbols"])
                or not HASH.fullmatch(manifest.get("exporter_source_sha256"))):
            # Fresh is a request instruction, not an input identity; cached nonfresh manifests are normalized below.
            if isinstance(manifest, dict) and not args["fresh"] and manifest.get("request") == {**args, "fresh": True}:
                manifest["request"] = dict(args)
                return RemoteMarket._validate_manifest(manifest, args)
            raise invalid("supply manifest differs from the pinned export request")
        seen = set()
        for item in manifest["files"]:
            name = relative(item["path"])
            if (name in seen or not HASH.fullmatch(item["sha256"]) or type(item["size"]) is not int or item["size"] < 0
                    or name.split("/")[0] not in {*args["symbols"], "lifecycle-evidence"}):
                raise invalid("supply manifest has invalid or duplicate files")
            seen.add(name)
        for symbol, receipt in manifest["receipts"].items():
            if (symbol + "/export.json" not in seen or receipt.get("commit") != args["commit"]
                    or receipt.get("symbol") != symbol or receipt.get("start_ns") != args["start_ns"]
                    or receipt.get("end_ns") != args["end_ns"]):
                raise invalid("native receipt differs from the pinned export window")


class Supply:
    """Only designed MarketAdapter reads are exposed; no SQL, import, filesystem or ledger API."""

    def __init__(self, market):
        self.market = market
        self.objects: dict[str, Path] = {}
        self.lock = threading.Lock()

    def call(self, request):
        if not isinstance(request, dict):
            raise invalid("supply request is not an object")
        for field, served in (("protocol", PROTOCOL), ("database", self.market.database)):
            if request.get(field) != served:
                raise differs(field, request.get(field), served)
        if set(request) != {"protocol", "database", "method", "args"}:
            raise invalid("supply request has unknown or missing fields",
                          expected="protocol, database, method and args")
        method, args = request["method"], request["args"]
        allowed = {"resolve_commit": {"at"}, "universe_rule": {"commit"}, "universe_month": {"commit"},
                   "membership_path": {"commit", "window_end"},
                   "export_catalogs": {"commit", "symbols", "start_ns", "end_ns", "episodes", "lifecycle_files",
                                       "fresh", "include_quotes", "include_trades"}}
        if method not in allowed or not isinstance(args, dict) or set(args) != allowed[method]:
            raise invalid("unknown supply read or arguments")
        if "commit" in args and (not isinstance(args["commit"], str) or not COMMIT.fullmatch(args["commit"])):
            raise invalid("supply reads require a full immutable commit")
        if method != "export_catalogs":
            return getattr(self.market, method)(**args)
        if (not isinstance(args["symbols"], list) or not args["symbols"]
                or any(not isinstance(s, str) or relative(s) != s or "/" in s for s in args["symbols"])
                or len(set(args["symbols"])) != len(args["symbols"])
                or any(type(args[name]) is not bool for name in ("fresh", "include_quotes", "include_trades"))):
            raise invalid("invalid supply scope or export mode")
        files = {relative(n): base64.b64decode(v, validate=True) for n, v in args["lifecycle_files"].items()}
        episodes = args["episodes"]
        if episodes is not None or files:
            verified = self.market.validate_lifecycle(json.loads(files["lifecycle.json"]), args["commit"], files)
            if verified != episodes:
                raise invalid("lifecycle episodes differ from the validated evidence")
        with self.lock:  # one exporter per service; no duplicate fresh jobs or object-index races
            result = self.market.export_catalogs(**{**args, "lifecycle_files": files})
            root = Path(result["root"])
            manifest = []
            for path in sorted(root.rglob("*")):
                name = path.relative_to(root).as_posix()
                # The existing nonfresh exporter can share a window directory between symbol
                # requests. Supply only this request's contracts and lifecycle evidence.
                if name.split("/")[0] not in args["symbols"] and name not in {
                        "lifecycle-evidence/" + n for n in files}:
                    continue
                if path.is_symlink():
                    raise invalid("server export contains a symbolic link")
                if path.is_file():
                    sha = digest(path)
                    self.objects[sha] = path
                    manifest.append({"path": relative(name),
                                     "sha256": sha, "size": path.stat().st_size})
            return {key: result[key] for key in ("commit", "exported", "reused", "receipts",
                                                 "exporter_source_sha256")} | {"request": args, "files": manifest}


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, supply):
        self.supply = supply
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # no profiles, requests, source paths or query contents in access logs

    def _json(self, status, value):
        body = canonical(value)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            if self.path != "/rpc" or not 0 < length <= MAX_JSON:
                raise invalid("invalid supply request path or length")
            result = self.server.supply.call(json.loads(self.rfile.read(length)))
            self._json(200, {"protocol": PROTOCOL, "database": self.server.supply.market.database,
                             "exporter": exporter_sha256(), "result": result})
        except Refusal as exc:
            self._json(400, {"refusal": exc.as_dict()})
        except MarketError as exc:
            self._json(400, {"market_error": exc.as_dict()})
        except (ValueError, KeyError, TypeError):
            self._json(400, {"refusal": invalid("malformed supply request").as_dict()})
        except Exception:
            self._json(500, {"refusal": refuse("MARKET_REMOTE_UNAVAILABLE", "market supply export failed").as_dict()})

    def do_GET(self):
        sha = self.path.removeprefix("/objects/")
        path = self.server.supply.objects.get(sha) if self.path.startswith("/objects/") and HASH.fullmatch(sha) else None
        match = re.fullmatch(r"bytes=(\d+)-", self.headers.get("Range", ""))
        if path is None or match is None or path.is_symlink() or not path.is_file():
            self.send_error(404)
            return
        size, offset = path.stat().st_size, int(match[1])
        if offset >= size:
            self.send_error(416)
            return
        self.send_response(206)
        self.send_header("Content-Length", str(size - offset))
        self.send_header("Content-Range", f"bytes {offset}-{size - 1}/{size}")
        self.end_headers()
        with path.open("rb") as stream:
            stream.seek(offset)
            shutil.copyfileobj(stream, self.wfile, BLOCK)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--market", help="server-side local market profile name or path (default: active)")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8210)
    args = parser.parse_args()
    from cli.main import market_profile
    from registration.seams import Market
    profile = market_profile(args.market)
    if "remote_url" in profile:
        parser.error("a supply server requires a local market reader")
    with Server((args.bind, args.port), Supply(Market(profile))) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
