import pytest

from vibe_trader.adapters.okx import OKXDataClientConfig
from vibe_trader.adapters.okx import OKXEnvironment
from vibe_trader.adapters.okx import OKXExecClientConfig
from vibe_trader.adapters.okx import OKXRegion
from vibe_trader.adapters.okx import get_okx_http_base_url
from vibe_trader.adapters.okx import get_okx_ws_url_business
from vibe_trader.adapters.okx import get_okx_ws_url_private
from vibe_trader.adapters.okx import get_okx_ws_url_public
from vibe_trader.model import AccountId
from vibe_trader.model import TraderId


@pytest.mark.parametrize(
    ("region", "expected"),
    [
        (OKXRegion.GLOBAL, "https://www.okx.com"),
        (OKXRegion.EEA, "https://eea.okx.com"),
        (OKXRegion.US, "https://us.okx.com"),
    ],
)
def test_http_base_url_by_region(region: OKXRegion, expected: str) -> None:
    assert get_okx_http_base_url(region) == expected


def test_http_base_url_defaults_to_global() -> None:
    assert get_okx_http_base_url() == "https://www.okx.com"


@pytest.mark.parametrize(
    ("region", "public", "private", "business"),
    [
        (
            OKXRegion.GLOBAL,
            "wss://ws.okx.com:8443/ws/v5/public",
            "wss://ws.okx.com:8443/ws/v5/private",
            "wss://ws.okx.com:8443/ws/v5/business",
        ),
        (
            OKXRegion.EEA,
            "wss://wseea.okx.com:8443/ws/v5/public",
            "wss://wseea.okx.com:8443/ws/v5/private",
            "wss://wseea.okx.com:8443/ws/v5/business",
        ),
        (
            OKXRegion.US,
            "wss://wsus.okx.com:8443/ws/v5/public",
            "wss://wsus.okx.com:8443/ws/v5/private",
            "wss://wsus.okx.com:8443/ws/v5/business",
        ),
    ],
)
def test_ws_urls_by_region_live(
    region: OKXRegion,
    public: str,
    private: str,
    business: str,
) -> None:
    assert get_okx_ws_url_public(OKXEnvironment.LIVE, region) == public
    assert get_okx_ws_url_private(OKXEnvironment.LIVE, region) == private
    assert get_okx_ws_url_business(OKXEnvironment.LIVE, region) == business


def test_ws_urls_eea_demo() -> None:
    assert (
        get_okx_ws_url_public(OKXEnvironment.DEMO, OKXRegion.EEA)
        == "wss://wseeapap.okx.com:8443/ws/v5/public"
    )


def test_data_config_defaults_to_global_region() -> None:
    config = OKXDataClientConfig()

    assert config.region == OKXRegion.GLOBAL


def test_exec_config_accepts_region() -> None:
    config = OKXExecClientConfig(
        trader_id=TraderId("TRADER-001"),
        account_id=AccountId("OKX-001"),
        region=OKXRegion.EEA,
    )

    assert config.region == OKXRegion.EEA


def test_okx_region_enum_surface() -> None:
    # OKXRegion must mirror OKXEnvironment's surface so frozen configs with a region
    # field stay hashable, and string/TOML values round-trip.
    assert len({OKXRegion.GLOBAL, OKXRegion.EEA, OKXRegion.US}) == 3  # hashable + distinct
    assert OKXRegion.from_str("eea") == OKXRegion.EEA
    assert OKXRegion.from_str("EEA") == OKXRegion.EEA  # case-insensitive
    assert set(OKXRegion.variants()) == {"global", "eea", "us"}
