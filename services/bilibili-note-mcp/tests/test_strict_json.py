from __future__ import annotations

import pytest

from bilibili_note_mcp.adapters.strict_json import (
    StrictJsonError,
    decode_strict_json_object,
    parse_finite_decimal_string,
    parse_unsigned_integer_string,
)


def test_excessive_provider_json_nesting_fails_closed() -> None:
    value = '{"root":' + "[" * 2_000 + "0" + "]" * 2_000 + "}"

    with pytest.raises(StrictJsonError, match="JSON nesting limit exceeded"):
        decode_strict_json_object(value)


def test_nesting_scan_ignores_json_syntax_characters_inside_strings() -> None:
    assert decode_strict_json_object(r'{"root":[{"text":"[[[{{{\\\"}}}"}]}') == {
        "root": [{"text": '[[[{{{\\"}}}'}]
    }


def test_exact_decimal_string_parsers_never_coerce_json_scalars() -> None:
    assert parse_finite_decimal_string("1.250000") == 1.25
    assert parse_unsigned_integer_string("1250") == 1250

    for value in (True, False, 1, 1.0, None, "1e3", "+1", "01", "1" * 33):
        with pytest.raises(StrictJsonError):
            parse_finite_decimal_string(value)
        with pytest.raises(StrictJsonError):
            parse_unsigned_integer_string(value)
