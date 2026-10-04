from __future__ import annotations

import hashlib
from typing import Any

import rfc8785


def canonical_bytes(value: Any) -> bytes:
    return rfc8785.dumps(value)


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def raw_ref(value: bytes) -> str:
    return "sha256:" + sha256_hex(value)


def domain_ref(prefix: str, domain: str, value: Any) -> str:
    return prefix + sha256_hex(domain.encode("utf-8") + b"\0" + canonical_bytes(value))


def source_snapshot_ref(snapshot: Any) -> str:
    return domain_ref("bs_", "bilibili-note/source-snapshot/v1", snapshot)
