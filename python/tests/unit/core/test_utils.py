import pytest

from vibe_trader.core import VIBE_USER_AGENT
from vibe_trader.core import VIBE_VERSION
from vibe_trader.core import convert_to_snake_case
from vibe_trader.core import mask_api_key


def test_version_constants_are_consistent():
    assert VIBE_VERSION
    assert f"VibeTrader/{VIBE_VERSION}" == VIBE_USER_AGENT


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("SomePascalCase", "some_pascal_case"),
        ("AnotherExample", "another_example"),
        ("someCamelCase", "some_camel_case"),
        ("yetAnotherExample", "yet_another_example"),
        ("some-kebab-case", "some_kebab_case"),
        ("dashed-word-example", "dashed_word_example"),
        ("already_snake_case", "already_snake_case"),
        ("no_change_needed", "no_change_needed"),
        ("UPPER_CASE_EXAMPLE", "upper_case_example"),
        ("ANOTHER_UPPER_CASE", "another_upper_case"),
        ("MiXeD_CaseExample", "mi_xe_d_case_example"),
        ("Another-OneHere", "another_one_here"),
        ("BSPOrderBookDelta", "bsp_order_book_delta"),
        ("OrderBookDelta", "order_book_delta"),
        ("TradeTick", "trade_tick"),
    ],
)
def test_convert_to_snake_case(value, expected):
    assert convert_to_snake_case(value) == expected


def test_mask_api_key_masks_middle():
    result = mask_api_key("sk-abc123xyz789")
    assert result.startswith("sk")
    assert result.endswith("789")
    assert "..." in result


def test_mask_api_key_short_key():
    result = mask_api_key("abc")
    assert isinstance(result, str)
