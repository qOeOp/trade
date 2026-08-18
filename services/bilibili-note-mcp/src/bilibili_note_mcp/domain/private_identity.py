from __future__ import annotations

import re

# Browser-visible whitespace may originate from literal Unicode separators or HTML entities such as
# ``&Tab;`` and ``&NewLine;``. Field ownership, not this closed grammar, distinguishes provider text
# from host-owned rendered line boundaries.
_GAP = r"\s*"
_THREE_DIGITS = rf"[0-9]{_GAP}[0-9]{_GAP}[0-9]"
_TWO_DIGITS = rf"[0-9]{_GAP}[0-9]"
PRIVATE_EVIDENCE_ID = re.compile(
    rf"(?<![a-z0-9])(?:e{_GAP}-?{_GAP}{_THREE_DIGITS}|[vfh]{_GAP}-?{_GAP}{_TWO_DIGITS})(?![a-z0-9])"
)
PRIVATE_CATALOG_ID = re.compile(
    rf"(?<![a-z0-9])s{_GAP}{_TWO_DIGITS}{_GAP}:{_GAP}[cmr]{_GAP}{_TWO_DIGITS}(?![a-z0-9])"
)
_DIGEST_PREFIX = rf"(?:b{_GAP}[stpb]|s{_GAP}a{_GAP}[cs])"
_DIGEST_HEX = rf"[0-9a-f](?:{_GAP}[0-9a-f]){{63}}"
PRIVATE_DIGEST = re.compile(rf"(?<![a-z0-9]){_DIGEST_PREFIX}{_GAP}_{_GAP}{_DIGEST_HEX}(?![a-z0-9])")


def canonical_text_contains_private_identity(value: str) -> bool:
    """Detect closed private identifier families after caller-owned canonicalization."""
    return any(
        pattern.search(value) is not None
        for pattern in (PRIVATE_EVIDENCE_ID, PRIVATE_CATALOG_ID, PRIVATE_DIGEST)
    )


def canonical_text_contains_private_catalog_identity(value: str) -> bool:
    return PRIVATE_CATALOG_ID.search(value) is not None
