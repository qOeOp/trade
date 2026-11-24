"""The new strategy file `candidate new` writes, formatted with its duty header and entry class."""

STRATEGY_STUB = '''{header}
from decimal import Decimal

from nautilus_trader.trading import Strategy


class {entry_class}(Strategy):
    """The one entry class. Decide only on closed bars; read trading facts (orders, fills,
    positions, account) from the engine's state, never from counters of your own."""

    WARMUP = {{}}  # {{period: bars}}: the history on_historical_bars receives before on_start, per kline period;
    # "FUNDING": n gives on_historical_funding_rates the last n settlements at or before the start

    def __init__(self, instrument_id, bar_type, *, trade_start_ns, execution_bar_minutes, strategy_id,
                 universe_membership):
        super().__init__()  # the runner allocates and configures the strategy
        self.instrument_id = instrument_id
        self.trade_start_ns = trade_start_ns

    def equity(self):
        """Account equity in the instrument's quote currency: portfolio.equity(venue=...) maps each
        currency to Money, keyed by Currency (not by its code)."""
        instrument = self.cache.instrument(self.instrument_id)
        found = self.portfolio.equity(venue=self.instrument_id.venue).get(instrument.quote_currency)
        return found.as_decimal() if found is not None else Decimal(0)

    def order_quantity(self, quantity, price=None):
        """`quantity` rounded down to the size precision (decimal places), or None when it is below the increment,
        min_quantity or (given a price) min_notional; make_qty(round_down=True) raises below the
        increment and the venue rejects an order below the minimums. The result is a multiple of the increment
        only when the increment is a power of ten (increment 0.5 with one decimal turns 1.76 into 1.7, increment
        10 turns 14 into 14), and make_price likewise rounds to the price precision, not to a multiple of the
        tick: round to the increment or tick yourself when it is not a power of ten. Market-data price/indicator
        inputs used to derive quantity and price must come from completed events strictly earlier
        than submission; this helper rounds and checks specifications, not their timestamps."""
        instrument = self.cache.instrument(self.instrument_id)
        quantity = Decimal(str(quantity))
        if quantity < instrument.size_increment.as_decimal():
            return None
        made = instrument.make_qty(quantity, round_down=True)
        if instrument.min_quantity is not None and made < instrument.min_quantity:
            return None
        if (price is not None and instrument.min_notional is not None and made.as_decimal() * Decimal(str(price))
                * instrument.multiplier.as_decimal() < instrument.min_notional.as_decimal()):
            return None
        return made

    def replay_diagnostics(self):
        """Diagnostic hook: counts the strategy reports about itself (summary only, never evidence);
        never a native report fact's name."""
        return {{}}

    def replay_integrity_findings(self, orders_denied_or_rejected):
        """Self-check hook: every finding returned, and every denied or rejected order, makes the run invalid."""
        return []
'''
