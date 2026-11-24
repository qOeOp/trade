"""The new strategy file `candidate new` writes, formatted with its duty header and entry class."""

STRATEGY_STUB = '''{header}
from decimal import Decimal

from nautilus_trader.model import BarType, Position
from nautilus_trader.trading import Strategy

MINUTE_NS = 60 * 10**9


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

    def equity(self, event_ns):
        """Account equity in the instrument's quote currency, for a decision on the minute close nearest `event_ns` (a
        closed bar's ts_event): no fill of that close, positions at the one-minute LAST close before it. Paper and its
        replay then read one value; portfolio.equity values positions at MARK, and its MARKs and other contracts'
        same-minute fills depend on when it is read. They part after a funding settlement with a position open (Paper's
        account books none) or a fill more than half a minute from its close. None when a position has no such bar:
        every instance subscribes to its one-minute LAST bars, and WARMUP {{1: 1}} covers a resume. Read it only to
        size: its cost grows with the run."""
        close_ns = (event_ns + MINUTE_NS // 2) // MINUTE_NS * MINUTE_NS
        before_ns = close_ns - MINUTE_NS // 2  # orders of one close fill within seconds of it: cut between closes
        venue, account = self.instrument_id.venue, self.cache.account_for_venue(self.instrument_id.venue)
        states = account.events
        state = next((state for state in reversed(states) if state.ts_event < before_ns), states[0])
        currency = self.cache.instrument(self.instrument_id).quote_currency
        equity = next((found.total.as_decimal() for found in state.balances if found.currency == currency), Decimal(0))
        for position in self.cache.positions(venue=venue):
            if position.ts_closed is not None and position.ts_closed < before_ns:
                continue
            fills = [fill for fill in position.events() if fill.ts_event < before_ns]
            if not fills:
                continue
            held = Position(self.cache.instrument(position.instrument_id), fills[0])
            for fill in fills[1:]:
                held.apply(fill)
            bars = BarType.from_str(f"{{position.instrument_id}}-1-MINUTE-LAST-EXTERNAL")
            index, last = 0, self.cache.bar(bars)
            while last is not None and last.ts_event >= close_ns - 10**6:
                index += 1
                last = self.cache.bar(bars, index)
            if last is None:
                return None
            equity += held.unrealized_pnl(last.close).as_decimal()
        return equity

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
