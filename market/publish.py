"""market.publish: the market directory's public copy on an S3-compatible store (Cloudflare R2;
docs/plans/market-plain-files.zh.md §5).

The copy holds the files of files.UPLOADED under their paths, what an import observed and cannot fetch again; the
other tables are rebuilt from the exchange's archives, never uploaded. A file absent from the copy is created only
when still absent (If-None-Match: *). A universe month is written once and never replaced. A liquidation month and the
terms file are replaced with a conditional write on the ETag read first, when the local file holds every row of the
remote one: an old local copy cannot cover what only the copy still holds, and two publishers cannot both replace a
file.

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
from xml.etree import ElementTree

import pyarrow as pa
import pyarrow.parquet as pq

from market import files
from market.sources import _refuse


TIMEOUT = 300
REGION = "auto"  # R2's region; S3 SigV4 signs it
KEY_FIELDS = ("endpoint", "bucket", "access_key_id", "secret_access_key")
PARQUET = "application/vnd.apache.parquet"


class Bucket:
    """Path-style S3 requests signed with AWS Signature Version 4 (the payload hashed, not UNSIGNED)."""

    def __init__(self, key: dict, opener=urllib.request.urlopen, clock=lambda: datetime.now(timezone.utc)):
        self.endpoint = key["endpoint"].rstrip("/")
        self.bucket = key["bucket"]
        self._access, self._secret = key["access_key_id"], key["secret_access_key"]
        self.opener, self.clock = opener, clock

    def request(self, method: str, name: str, body: bytes = b"", headers: dict | None = None,
                query: dict | None = None) -> tuple[int, dict, bytes]:
        """(status, response headers in lower case, body); 404 and 412 are answers, other failures refuse."""
        url = f"{self.endpoint}/{self.bucket}" + (f"/{urllib.parse.quote(name, safe='/-_.~')}" if name else "")
        if query:
            url += "?" + urllib.parse.urlencode(query, quote_via=urllib.parse.quote)
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

    def listing(self, prefix: str) -> dict[str, str]:
        """{object name: ETag without its quotes} of the objects under `prefix`."""
        found, token = {}, None
        while True:
            query = {"list-type": "2", "prefix": prefix, **({"continuation-token": token} if token else {})}
            status, _, body = self.request("GET", "", query=query)
            try:
                if status != 200:
                    raise ValueError(status)
                # The answer's elements carry the S3 namespace: compare local names.
                root = ElementTree.fromstring(body)
                local = {item: item.tag.rsplit("}", 1)[-1] for item in root.iter()}
                for item in root:
                    if local[item] == "Contents":
                        fields = {local[part]: part.text for part in item}
                        found[str(fields["Key"])] = str(fields["ETag"]).strip('"')
                ending = {local[item]: item.text for item in root if local[item] in ("IsTruncated", "NextContinuationToken")}
            except (ValueError, KeyError, AttributeError, ElementTree.ParseError):
                raise _refuse(f"the public copy's listing of {prefix} cannot be read", "PUBLISH_FAILED",
                              missing=(prefix,)) from None
            if ending.get("IsTruncated") != "true":
                return found
            token = ending["NextContinuationToken"]


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
    """{created, replaced}: how many objects of the public copy this call created and replaced."""
    if profile.get("role") != "active":
        raise _refuse("only the active market publishes", "PUBLISH_FORBIDDEN")
    if not profile.get("upload"):
        raise _refuse("the market profile names no upload key file (upload)", "REMOTE_UNSET", missing=("upload",))
    market = files.open_market(profile, "reader")
    bucket = bucket or Bucket(upload_key(profile["upload"]))
    created = replaced = 0
    for table in files.UPLOADED:
        remote = bucket.listing(files.relative_path(table, None) if files.TABLES[table].layout == "single" else f"{table}/")
        for entry in files.entries(market, table):
            body = memoryview(files.file_bytes(market, entry)).tobytes()
            etag = remote.get(entry.relative)
            if etag == hashlib.md5(body, usedforsecurity=False).hexdigest():
                continue
            if etag is None:
                created += _put(bucket, entry.relative, body, {"If-None-Match": "*"})
                continue
            status, headers, found = bucket.request("GET", entry.relative)
            if status != 200:
                raise _refuse(f"the public copy answered {status} to GET {entry.relative}", "PUBLISH_FAILED",
                              missing=(entry.relative,))
            if found == body or _rows(found) == _rows(body):  # the store's ETag is no MD5, or another writer's bytes
                continue
            if entry.table == "universe_month":
                raise _refuse(f"the public copy's {entry.relative} differs and a universe month is written once",
                              "PUBLISH_DIVERGED", missing=(entry.relative,))
            if _rows(found) - _rows(body):
                raise _refuse(f"the public copy's {entry.relative} holds rows this market does not", "PUBLISH_DIVERGED",
                              missing=(entry.relative,))
            replaced += _put(bucket, entry.relative, body, {"If-Match": headers.get("etag", etag)})
    return {"created": created, "replaced": replaced}


def _rows(data: bytes) -> set[tuple]:
    if not data.startswith(b"PAR1"):
        raise _refuse("an object of the public copy is no Parquet file", "PUBLISH_DIVERGED")
    table = pq.read_table(pa.BufferReader(data))
    return set(zip(*(table.column(name).to_pylist() for name in table.column_names), strict=True))


def _put(bucket: Bucket, name: str, body: bytes, condition: dict) -> int:
    status = bucket.request("PUT", name, body, {**condition, "Content-Type": PARQUET})[0]
    if status == 412:
        raise _refuse(f"another publisher changed {name} meanwhile; publish again", "PUBLISH_FAILED", missing=(name,))
    if status != 200:
        raise _refuse(f"the public copy answered {status} to PUT {name}", "PUBLISH_FAILED", missing=(name,))
    return 1
