from __future__ import annotations

import json
import math
import re
from typing import Any


class StrictJsonError(ValueError):
    """Provider JSON is ambiguous, non-standard, malformed, or not an object."""


_MAX_NESTING_DEPTH = 128
_MAX_DECIMAL_STRING_LENGTH = 32
_UNSIGNED_DECIMAL = re.compile(r"(?:0|[1-9][0-9]*)(?:\.[0-9]+)?")
_UNSIGNED_INTEGER = re.compile(r"(?:0|[1-9][0-9]*)")


def _reject_excessive_nesting(value: str) -> None:
    depth = 0
    in_string = False
    escaped = False
    for character in value:
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue
        if character == '"':
            in_string = True
        elif character in "[{":
            depth += 1
            if depth > _MAX_NESTING_DEPTH:
                raise StrictJsonError("JSON nesting limit exceeded")
        elif character in "]}":
            depth -= 1


def _reject_constant(value: str) -> None:
    del value
    raise StrictJsonError("non-finite JSON number")


def _finite_float(value: str) -> float:
    decoded = float(value)
    if not math.isfinite(decoded):
        raise StrictJsonError("non-finite JSON number")
    return decoded


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise StrictJsonError("duplicate JSON object key")
        value[key] = item
    return value


def decode_strict_json_object(value: bytes | str) -> dict[str, Any]:
    """Decode one unambiguous RFC JSON object from provider-controlled input."""
    try:
        source = value.decode("utf-8") if isinstance(value, bytes) else value
        _reject_excessive_nesting(source)
        decoded = json.loads(
            source,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
            parse_float=_finite_float,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as e:
        raise StrictJsonError("invalid JSON object") from e
    if not isinstance(decoded, dict):
        raise StrictJsonError("JSON root must be an object")
    return decoded


def parse_finite_decimal_string(value: object) -> float:
    """Parse one bounded provider decimal string without numeric or boolean coercion."""
    if (
        not isinstance(value, str)
        or len(value) > _MAX_DECIMAL_STRING_LENGTH
        or _UNSIGNED_DECIMAL.fullmatch(value) is None
    ):
        raise StrictJsonError("invalid decimal string")
    parsed = float(value)
    if not math.isfinite(parsed):
        raise StrictJsonError("non-finite decimal string")
    return parsed


def parse_unsigned_integer_string(value: object) -> int:
    """Parse one bounded provider integer string without numeric or boolean coercion."""
    if (
        not isinstance(value, str)
        or len(value) > _MAX_DECIMAL_STRING_LENGTH
        or _UNSIGNED_INTEGER.fullmatch(value) is None
    ):
        raise StrictJsonError("invalid integer string")
    return int(value)
