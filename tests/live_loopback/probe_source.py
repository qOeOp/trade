"""The loopback runs' strategy source: each closed one-minute kline's volume is a command from the test.

It is ordinary source text, loaded and checked by the product like any reviewed source (engine.load). Commands:
  2  enter long: a marketable GTC limit buy of 0.002; once filled, a reduce-only STOP_MARKET sell 1% below
  3  close: a marketable reduce-only limit sell of every open long position; a closed position's stop is
     cancelled
  4  enter long with a GTD limit whose expiry has a fraction of a second (Live cannot send it)
  5  enter long with a GTD STOP_MARKET entry (Live cannot send it)
Every closed kline (with the cached instrument's price increment), order event and denial is printed to standard output as `probe <kind> <detail>` for the test to read.
"""

SOURCE = '''from decimal import Decimal
from nautilus_trader.model import OrderSide, Price, Quantity, TimeInForce
from nautilus_trader.trading import Strategy


class Probe(Strategy):
    def __init__(self, instrument_id, bar_type, **kwargs):
        super().__init__()
        self.iid = instrument_id
        self.bar_type = bar_type
        self.findings = []

    def on_start(self):
        self.subscribe_bars(self.bar_type)

    def on_bar(self, bar):
        code = int(bar.volume.as_double())
        close = bar.close.as_decimal()
        instrument = self.cache.instrument(self.iid)
        print(f"probe bar {bar.ts_event} {code} {close} {instrument.price_increment}", flush=True)
        if code in (2, 4):
            expire = {}
            if code == 4:
                expire = dict(time_in_force=TimeInForce.GTD, expire_time=bar.ts_event + 900 * 10**9 + 500_000_000)
            order = self.order_factory.limit(self.iid, OrderSide.BUY, Quantity.from_str("0.002"),
                                             Price.from_str(str((close * Decimal("1.001")).quantize(Decimal("0.1")))),
                                             **expire)
            self.submit_order(order)
        elif code == 5:
            order = self.order_factory.stop_market(self.iid, OrderSide.BUY, Quantity.from_str("0.002"),
                                                   Price.from_str(str((close * Decimal("1.01")).quantize(Decimal("0.1")))),
                                                   time_in_force=TimeInForce.GTD, expire_time=bar.ts_event + 900 * 10**9)
            self.submit_order(order)
        elif code == 3:
            for position in self.cache.positions_open(instrument_id=self.iid, strategy_id=self.strategy_id):
                order = self.order_factory.limit(self.iid, OrderSide.SELL, position.quantity,
                                                 Price.from_str(str((close * Decimal("0.999")).quantize(Decimal("0.1")))),
                                                 reduce_only=True)
                self.submit_order(order, position_id=position.id)

    def on_position_opened(self, event):
        position = self.cache.position(event.position_id)
        trigger = (position.avg_px_open * 0.99) // 0.1 * 0.1
        stop = self.order_factory.stop_market(self.iid, OrderSide.SELL, position.quantity,
                                              Price.from_str(f"{trigger:.1f}"), reduce_only=True)
        self.submit_order(stop, position_id=position.id)

    def on_position_closed(self, event):
        for order in self.cache.orders_open(instrument_id=self.iid, strategy_id=self.strategy_id):
            self.cancel_order(order.client_order_id)

    def on_order_event(self, event):
        print(f"probe order {type(event).__name__} {event.client_order_id}", flush=True)

    def on_order_denied(self, event):
        print(f"probe denied {event.client_order_id} {event.reason}", flush=True)
        self.findings.append(f"order denied {event.client_order_id}: {event.reason}")

    def replay_diagnostics(self):
        return {}

    def replay_integrity_findings(self, orders_denied_or_rejected=False):
        return list(self.findings)
'''
