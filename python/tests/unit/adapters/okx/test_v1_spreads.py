from vibe_trader.adapters.okx import OKXHttpClient


def test_http_client_exposes_generic_spread_execution_methods() -> None:
    assert hasattr(OKXHttpClient, "place_order")
    assert hasattr(OKXHttpClient, "cancel_order")
    assert hasattr(OKXHttpClient, "cancel_all_orders")
    assert hasattr(OKXHttpClient, "request_order_status_reports")
    assert hasattr(OKXHttpClient, "request_fill_reports")


def test_http_client_does_not_expose_spread_specific_execution_methods() -> None:
    assert not hasattr(OKXHttpClient, "place_spread_order")
    assert not hasattr(OKXHttpClient, "cancel_spread_order")
    assert not hasattr(OKXHttpClient, "cancel_all_spread_orders")
    assert not hasattr(OKXHttpClient, "request_spread_order_status_reports")
    assert not hasattr(OKXHttpClient, "request_spread_fill_reports")
