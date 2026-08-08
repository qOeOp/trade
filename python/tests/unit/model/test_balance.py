from vibe_trader.model import AccountBalance
from vibe_trader.model import Currency
from vibe_trader.model import InstrumentId
from vibe_trader.model import MarginBalance
from vibe_trader.model import Money


USD = Currency.from_str("USD")


def _account_balance():
    return AccountBalance(
        total=Money(1525000.00, USD),
        locked=Money(25000.00, USD),
        free=Money(1500000.00, USD),
    )


def _margin_balance():
    return MarginBalance(
        Money(1.00, USD),
        Money(1.00, USD),
        InstrumentId.from_str("AUD/USD.SIM"),
    )


def test_account_balance_equality():
    b1 = _account_balance()
    b2 = _account_balance()
    assert b1 == b2


def test_account_balance_properties():
    balance = _account_balance()

    assert balance.total == Money(1525000.00, USD)
    assert balance.locked == Money(25000.00, USD)
    assert balance.free == Money(1500000.00, USD)
    assert balance.currency == USD


def test_account_balance_display():
    bal = _account_balance()
    expected = "AccountBalance(total=1525000.00 USD, locked=25000.00 USD, free=1500000.00 USD)"
    assert str(bal) == expected
    assert repr(bal) == expected


def test_account_balance_to_from_dict():
    bal = _account_balance()
    d = bal.to_dict()
    assert bal == AccountBalance.from_dict(d)
    assert d == {
        "type": "AccountBalance",
        "free": "1500000.00",
        "locked": "25000.00",
        "total": "1525000.00",
        "currency": "USD",
    }


def test_margin_balance_equality():
    m1 = _margin_balance()
    m2 = _margin_balance()
    assert m1 == m2


def test_margin_balance_properties():
    balance = _margin_balance()

    assert balance.initial == Money(1.00, USD)
    assert balance.maintenance == Money(1.00, USD)
    assert balance.currency == USD
    assert balance.instrument_id == InstrumentId.from_str("AUD/USD.SIM")


def test_margin_balance_display():
    bal = _margin_balance()
    expected = "MarginBalance(initial=1.00 USD, maintenance=1.00 USD, instrument_id=AUD/USD.SIM)"
    assert str(bal) == expected


def test_margin_balance_to_from_dict():
    bal = _margin_balance()
    d = bal.to_dict()
    assert bal == MarginBalance.from_dict(d)
    assert d == {
        "type": "MarginBalance",
        "initial": "1.00",
        "maintenance": "1.00",
        "instrument_id": "AUD/USD.SIM",
        "currency": "USD",
    }


def test_account_balance_hash():
    b1 = _account_balance()
    b2 = _account_balance()

    assert hash(b1) == hash(b2)


def test_account_balance_hash_differs():
    b1 = _account_balance()
    b2 = AccountBalance(
        total=Money(100.00, USD),
        locked=Money(0.00, USD),
        free=Money(100.00, USD),
    )

    assert hash(b1) != hash(b2)


def test_margin_balance_hash():
    m1 = _margin_balance()
    m2 = _margin_balance()

    assert hash(m1) == hash(m2)


def test_account_balance_copy():
    bal = _account_balance()
    copy = bal.copy()

    assert copy == bal
    assert copy is not bal


def test_margin_balance_copy():
    bal = _margin_balance()
    copy = bal.copy()

    assert copy == bal
    assert copy is not bal


def test_account_balance_not_equal_to_none():
    bal = _account_balance()
    assert (bal == None) is False  # noqa: E711


def test_margin_balance_not_equal_to_none():
    bal = _margin_balance()
    assert (bal == None) is False  # noqa: E711
