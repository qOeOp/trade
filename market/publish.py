"""market.publish: the market directory's public copy on an S3-compatible store (Cloudflare R2;
docs/plans/market-parquet-store.zh.md §7).

The copy holds every version file and receipt and the data files of versions.UPLOADED, the tables an import
observed and cannot fetch again. The other tables' files are rebuilt from their receipts, never uploaded.
Objects are created only when absent (If-None-Match: *) and never overwritten; head is replaced last with a
conditional write on the ETag read first, so a reader never sees a version listing a file not yet uploaded,
and two publishers cannot both move it.

The profile's `upload` names a JSON key file {endpoint, bucket, access_key_id, secret_access_key}; this
module reads that file and no other credential, and never prints or returns a value of it.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import hmac
import http.client
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

from market import versions
from market.sources import _refuse


TIMEOUT = 300
REGION = "auto"  # R2's region; S3 SigV4 signs it
KEY_FIELDS = ("endpoint", "bucket", "access_key_id", "secret_access_key")
TYPES = {".parquet": "application/vnd.apache.parquet", ".json": "application/json"}


class Bucket:
    """Path-style S3 requests signed with AWS Signature Version 4 (the payload hashed, not UNSIGNED)."""

    def __init__(self, key: dict, opener=urllib.request.urlopen, clock=lambda: datetime.now(timezone.utc)):
        self.endpoint = key["endpoint"].rstrip("/")
        self.bucket = key["bucket"]
        self._access, self._secret = key["access_key_id"], key["secret_access_key"]
        self.opener, self.clock = opener, clock

    def request(self, method: str, name: str, body: bytes = b"", headers: dict | None = None) -> tuple[int, dict, bytes]:
        """(status, response headers in lower case, body); 404 and 412 are answers, other failures refuse."""
        url = f"{self.endpoint}/{self.bucket}/{urllib.parse.quote(name, safe='/-_.~')}"
        try:
            signed = sign(method, url, {**(headers or {})}, body, self._access, self._secret, self.clock())
            request = urllib.request.Request(url, data=body if method == "PUT" else None, method=method,
                                             headers=signed)
            with self.opener(request, timeout=TIMEOUT) as response:
                return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
        except urllib.error.HTTPError as error:
            with error:  # an HTTPError holds the response open
                if error.code in (404, 412):
                    return error.code, {k.lower(): v for k, v in error.headers.items()}, error.read()
            raise _refuse(f"the public copy answered {error.code} to {method} {name}", "PUBLISH_FAILED",
                          missing=(name,)) from None
        except (urllib.error.URLError, OSError, http.client.HTTPException, ValueError) as error:
            raise _refuse(f"the public copy cannot be reached for {method} {name}: {error}", "PUBLISH_FAILED",
                          missing=(name,)) from None

    def create(self, name: str, body: bytes) -> bool:
        """Create an object only when absent; whether it was created (an existing one, named by content, is
        the same bytes). A HEAD first saves resending a large body after an interrupted publish."""
        if self.request("HEAD", name)[0] == 200:
            return False
        status = self.request("PUT", name, body, {"If-None-Match": "*",
                                                   "Content-Type": TYPES.get(Path(name).suffix, "text/plain")})[0]
        if status not in (200, 412):
            raise _refuse(f"the public copy answered {status} to PUT {name}", "PUBLISH_FAILED", missing=(name,))
        return status == 200


def sign(method: str, url: str, headers: dict, body: bytes, access: str, secret: str, now: datetime,
         region: str = REGION) -> dict:
    """The request headers with x-amz-date, x-amz-content-sha256 and Authorization (SigV4, service s3)."""
    parts = urllib.parse.urlsplit(url)
    stamp, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    payload = hashlib.sha256(body).hexdigest()
    signed = {**headers, "host": parts.netloc, "x-amz-date": stamp, "x-amz-content-sha256": payload}
    names = sorted(name.lower() for name in signed)
    lowered = {name.lower(): " ".join(str(value).strip().split()) for name, value in signed.items()}
    query = "&".join(sorted(f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}"
                            for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)))
    canonical = "\n".join([method, parts.path or "/", query, "".join(f"{name}:{lowered[name]}\n" for name in names),
                           ";".join(names), payload])
    scope = f"{day}/{region}/s3/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", stamp, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    key = f"AWS4{secret}".encode()
    for part in (day, region, "s3", "aws4_request"):
        key = hmac.new(key, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    return {**{name: value for name, value in signed.items() if name != "host"},
            "Authorization": f"AWS4-HMAC-SHA256 Credential={access}/{scope}, SignedHeaders={';'.join(names)}, "
                             f"Signature={signature}"}


def upload_key(path: str) -> dict:
    """The key file the profile's `upload` names; REMOTE_UNSET when it is missing or malformed."""
    try:
        key = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise _refuse("the market profile's upload key file cannot be read", "REMOTE_UNSET",
                      missing=("upload",)) from None
    if not isinstance(key, dict) or any(not isinstance(key.get(name), str) or not key[name] for name in KEY_FIELDS):
        raise _refuse("the upload key file lacks endpoint, bucket, access_key_id or secret_access_key",
                      "REMOTE_UNSET", missing=("upload",))
    return key


def publish(profile: dict, bucket: Bucket | None = None) -> dict:
    """{head, versions, files}: the public copy's head after publishing and how many version files and data
    files or receipts this call created."""
    if profile.get("role") != "active":
        raise _refuse("only the active market publishes", "PUBLISH_FORBIDDEN")
    if not profile.get("origin") or not profile.get("upload"):
        raise _refuse("the market profile names no public copy (origin) or upload key file (upload)",
                      "REMOTE_UNSET", missing=tuple(name for name in ("origin", "upload") if not profile.get(name)))
    market = versions.open_market(profile, "reader")
    if market.empty:
        return {"head": None, "versions": 0, "files": 0}
    bucket = bucket or Bucket(upload_key(profile["upload"]))
    for _ in range(2):  # a head another publisher moved after it was read is read again once
        found = _publish(market, bucket)
        if found is not None:
            return found
    raise _refuse("another publisher moved the public copy's head meanwhile, twice", "PUBLISH_DIVERGED",
                  missing=("head",))


def _publish(market: versions.Market, bucket: Bucket) -> dict | None:
    """One publish against the head read first; None when head moved before it was replaced."""
    status, headers, body = bucket.request("GET", "head")
    remote = body.decode(errors="replace").strip() if status == 200 else None
    etag = headers.get("etag") if status == 200 else None
    if remote == market.head:
        return {"head": remote, "versions": 0, "files": 0}
    newer: list[str] = []
    for commit in versions.chain(market):  # back from head, only as far as the public copy's head
        if commit == remote:
            break
        newer.append(commit)
    else:
        if remote is not None:
            raise _refuse(f"the public copy's head {remote} is not on the local chain", "PUBLISH_DIVERGED",
                          missing=(remote,))
    pending = list(reversed(newer))
    exempt = versions.converted(market)
    if remote is None:  # the first publish also carries the converted versions off the main chain
        pending = [commit for commit in sorted(exempt) if commit not in newer] + pending
    for commit in pending:
        if commit in exempt:
            continue
        for sha in versions.own(market, commit)["receipts"]:
            if versions.receipt(market, sha).get("writer") is None:
                raise _refuse(f"version {commit} has a receipt that names no writer (an import from a modified "
                              "work tree); nothing is published", "WRITER_MISSING", missing=(commit, sha))
    created = 0
    for commit in pending:
        added = versions.own(market, commit)
        for entry in added["files"]:
            if entry["table"] in versions.UPLOADED:
                data = versions.file_bytes(market, entry["sha256"], "parquet")
                created += bucket.create(f"files/{entry['sha256']}.parquet", memoryview(data).tobytes())
        for sha in added["receipts"]:
            created += bucket.create(f"files/{sha}.json", memoryview(versions.file_bytes(market, sha, "json")).tobytes())
        versions.version_file(market, commit)  # checked against its id before its bytes leave
        bucket.create(f"versions/{commit}.json", (market.root / "versions" / f"{commit}.json").read_bytes())
    condition = {"If-Match": etag} if etag else {"If-None-Match": "*"}
    status = bucket.request("PUT", "head", f"{market.head}\n".encode(), {**condition, "Content-Type": "text/plain"})[0]
    if status == 412:
        return None
    if status != 200:
        raise _refuse(f"the public copy answered {status} to PUT head", "PUBLISH_FAILED", missing=("head",))
    return {"head": market.head, "versions": len(pending), "files": created}

