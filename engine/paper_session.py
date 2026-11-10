"""Paper's checkpoint owner. Nautilus remains the sole owner of all economic state.

Protocol 1 is deliberately limited to credential-free perpetuals, explicit strategy save/load
hooks, minute/daily inputs and no strategy timers. An unrepresentable cut stays dirty.
"""

from __future__ import annotations

import base64
from contextlib import contextmanager
from dataclasses import asdict
import json
from pathlib import Path
import tempfile
from typing import Any, cast
import time

from nautilus_trader.common import DataActor
from nautilus_trader.model import Bar, BarType, Price, Venue
from nautilus_trader.persistence import ParquetDataCatalog
from nautilus_trader.trading import Strategy

from engine import paper_checkpoint as checkpoint, strategy as strategy_runtime
from engine.cadence import Cadence
from engine.config import ACCOUNT_CONTRACT
from engine.load import DAY_NS


def bar(value: dict) -> Bar:
    return Bar.from_dict({"type": "Bar", **{key: value[key] for key in
                         ("bar_type", "open", "high", "low", "close", "volume", "ts_event", "ts_init")}})


def history_bounds(values: list[Bar]) -> tuple[int, int]:
    # Python datetime cannot express native nanoseconds. Give the temporary Catalog
    # exactly these microsecond-aligned coverage bounds, preserving every Bar byte.
    # Otherwise request_bars fills the tiny uncovered edges from Binance REST.
    return (values[0].ts_init // 1000 - 1) * 1000, ((values[-1].ts_init + 999) // 1000 + 1) * 1000


class Session:
    def __init__(self, backend, journal, loaded, saved: dict | None, started_ns: int, input_start_ns: int):
        self.backend, self.journal, self.loaded, self.saved = backend, journal, loaded, saved
        self.started_ns, self.input_start_ns = started_ns, input_start_ns
        self.depth = 0
        source_bases = loaded.strategy_class.__mro__[:loaded.strategy_class.__mro__.index(Strategy)]
        hooks = {name for base in source_bases for name, value in vars(base).items() if callable(value)}
        self.supported = (getattr(loaded.strategy_class, "PAPER_RECOVERY", None) == 1
                          and {"on_save", "on_load"} <= hooks)
        self.ready = False
        self.recorder: Any = None
        self.cache: Any = None
        self.starts: list = []
        self.expected_starts = 0
        self.error: str | None = None
        self.pause_error: str | None = None
        self.restore_deadline = time.monotonic() + 30
        self.warmup = (saved or {}).get("warmup", {})
        self.lines: list[dict] = []  # only irreproducible settlement/refusal facts needed by the recorder
        self.last_bar: dict[str, int] = {}
        self.daily: dict[str, list[Bar]] = {}
        self.partial: dict[str, list[Bar]] = {}
        self.pending: set[str] = set()
        if saved:
            with (backend.output / "events.jsonl").open("rb") as stream:
                for raw in stream:
                    value = json.loads(raw)
                    iid = value.get("instrument_id")
                    if value["kind"] == "native_daily":
                        self.daily.setdefault(iid, []).append(bar(value))
                        self.partial[iid] = []
                    elif value["kind"] == "bar":
                        if "ts_init" not in value:
                            raise checkpoint.fail("the checkpoint lacks native input timestamps")
                        self.last_bar[iid] = value["ts_event"]
                        if self.loaded.daily_warmup:
                            minute = {**value, "bar_type": f"{iid}-1-MINUTE-LAST-EXTERNAL"}
                            self.partial.setdefault(iid, []).append(bar(minute))
                    elif value["kind"] in ("funding_settlement", "refusal"):
                        self.lines.append(value)
        if saved and saved.get("sources"):
            self._same_bucket()

    def _same_bucket(self) -> None:
        if not self.saved or not self.saved.get("sources"):
            return  # a waiting checkpoint has not started an aggregator or settlement cadence
        if self.loaded.daily_warmup and time.time_ns() // DAY_NS != self.saved["cut_ns"] // DAY_NS:
            raise checkpoint.fail("recovery crossed a daily aggregation boundary; the original point is retained")
        following = list((self.saved.get("recorder") or {}).get("funding", {}).values())
        following.extend(value["cadence"].get("next_funding_ns") for value in self.saved["sources"].values())
        if any(value is not None and time.time_ns() >= value for value in following):
            raise checkpoint.fail("recovery crossed an unobserved funding settlement; the original point is retained")

    @contextmanager
    def callback(self):
        checkpoint.dirty(self.backend.output)
        self.depth += 1
        try:
            yield
        finally:
            self.depth -= 1

    def start(self, callback) -> None:
        self.starts.append(callback)
        self.maybe_begin()

    def maybe_begin(self) -> None:
        if not self.ready and not self.pending and len(self.starts) == self.expected_starts:
            self._same_bucket()
            account = self.cache.account_for_venue(Venue(ACCOUNT_CONTRACT["venue"]))
            if account is None or account.to_dict().get("calculate_account_state") is not True:
                raise checkpoint.fail("native account initialization did not restore Sandbox calculation mode")
            for callback in self.starts:
                callback()
            self.ready = True

    def try_cut(self, cache) -> None:
        if not (self.backend.root / "dirty").exists() or not self.ready:
            return
        try:
            self.cut(cache)
            self.error = None
        except checkpoint.Refusal as exc:
            if str(exc) != self.error:
                print(f"Paper checkpoint deferred: {exc}", flush=True)
                self.error = str(exc)

    def restore_source(self, strategy, iid: str) -> None:
        saved = (self.saved or {}).get("sources", {}).get(iid)
        if not saved:
            return
        strategy.load({key: base64.b64decode(value, validate=True) for key, value in saved["state"].items()})
        factory = strategy.order_factory
        for wanted, count, generate in (
            (saved["factory"][0], factory.get_client_order_id_count, factory.generate_client_order_id),
            (saved["factory"][1], factory.get_order_list_id_count, factory.generate_order_list_id),
        ):
            if count() > wanted:
                raise checkpoint.fail("the restored order factory advanced before recovery completed")
            while count() < wanted:
                generate()
        for key, value in saved["cadence"].items():
            setattr(strategy._paper_cadence, key, value)

    def restore_recorder(self, recorder) -> None:
        self.recorder = recorder
        saved = (self.saved or {}).get("recorder")
        if not saved:
            return
        recorder.minute = saved["minute"]
        recorder.marks = {iid: (value[0], Price.from_str(value[1])) for iid, value in saved["marks"].items()}
        recorder.uncovered = saved.get("uncovered", {})
        for iid, following in saved["funding"].items():
            recorder.cadence[iid] = Cadence(next_funding_ns=following)
        recorder.last_bar = dict(self.last_bar)
        for value in self.lines:
            if value["kind"] == "funding_settlement":
                recorder.settlements.append({key: item for key, item in value.items() if key not in ("kind", "wall_ns")})
            elif value["kind"] == "refusal":
                recorder.findings.append(value["code"])

    def cut(self, cache=None) -> dict:
        if self.pause_error:
            raise checkpoint.fail(self.pause_error)
        if self.depth or strategy_runtime.FAILURES:
            raise checkpoint.fail("callbacks are active or failed; no consistent checkpoint is available")
        cut_ns = time.time_ns()
        sources: dict[str, dict] = {}
        if cache is not None:
            if not self.supported or not self.ready:
                raise checkpoint.fail("the source has not completed its recovery protocol")
            if any(not order.is_closed for order in cache.orders()):
                raise checkpoint.fail("orders are not all terminal at the checkpoint")
            for iid, native in strategy_runtime.STRATEGIES.items():
                strategy = cast(Any, native)
                required = {f"{iid}-1-MINUTE-LAST-EXTERNAL"}
                if self.loaded.daily_warmup:
                    required.add(f"{iid}-1-DAY-LAST-INTERNAL@1-MINUTE-EXTERNAL")
                if strategy._paper_subscription_changes or strategy._paper_subscriptions != required:
                    raise checkpoint.fail("recovery requires fixed minute/daily subscriptions without custom routing")
                if strategy._paper_user_timers:
                    raise checkpoint.fail("the source registered timers outside the recovery protocol")
                if strategy._paper_held or strategy.clock.timer_names():
                    raise checkpoint.fail("a strategy callback or timer remains pending")
                source_state = strategy.save()
                if not all(isinstance(key, str) and isinstance(value, bytes) for key, value in source_state.items()):
                    raise checkpoint.fail("strategy save hooks must return string-to-bytes state")
                sources[iid] = {"state": {key: base64.b64encode(value).decode() for key, value in source_state.items()},
                                "factory": [strategy.order_factory.get_client_order_id_count(),
                                            strategy.order_factory.get_order_list_id_count()],
                                "cadence": asdict(strategy._paper_cadence)}
            if (self.depth or strategy_runtime.FAILURES or any(not order.is_closed for order in cache.orders())
                    or any(cast(Any, source)._paper_held or source.clock.timer_names()
                           or cast(Any, source)._paper_user_timers
                           for source in strategy_runtime.STRATEGIES.values())):
                raise checkpoint.fail("saving hooks failed or left an order, callback or timer pending")
            if self.loaded.daily_warmup:
                current = cut_ns // DAY_NS
                for iid in strategy_runtime.STRATEGIES:
                    history = self.daily.get(iid, [])
                    if not history and current != self.input_start_ns // DAY_NS:
                        raise checkpoint.fail("the first skipped daily boundary has not been observed")
                    values = self.partial.get(iid, [])
                    if (any(value.ts_init // DAY_NS != current for value in values)
                            or any(b.ts_init <= a.ts_init for a, b in zip(values, values[1:], strict=False))):
                        raise checkpoint.fail("partial daily inputs do not form one ordered native bucket")
                    if history and any(value.ts_init <= history[-1].ts_init for value in self.partial.get(iid, [])):
                        raise checkpoint.fail("native input/timer ordering cannot be replayed at this cut")
        recorder = self.recorder
        value = {"started_ns": self.started_ns, "input_start_ns": self.input_start_ns,
                 "cut_ns": cut_ns, "warmup": self.warmup, "sources": sources,
                 "recorder": None if recorder is None else {
                     "minute": recorder.minute,
                     "marks": {iid: [ts, str(price)] for iid, (ts, price) in recorder.marks.items()},
                     "funding": {iid: item.next_funding_ns for iid, item in recorder.cadence.items()},
                     **({"uncovered": recorder.uncovered} if recorder.uses_stop_loss else {}),
                 }}
        self.journal.sync()
        return self.backend.snapshot(cache, value)

    def before_stop(self, cache) -> None:
        # Native component stop cancels clocks. Checking only after node.run returned
        # would hide a user timer which existed when the pause was requested.
        if any(not order.is_closed for order in cache.orders()):
            self.pause_error = "the pause had a nonterminal order; its original state is retained"
        if any(source.clock.timer_names() for source in strategy_runtime.STRATEGIES.values()):
            self.pause_error = "the pause had a source timer; no timer state was checkpointed"

    def received_minute(self, value: Bar) -> None:
        if not self.loaded.daily_warmup:
            return
        self.partial.setdefault(str(value.bar_type.instrument_id), []).append(value)

    def received_daily(self, value: Bar) -> None:
        iid = str(value.bar_type.instrument_id)
        self.daily.setdefault(iid, []).append(value)
        self.partial[iid] = []

    def prepare_catalog(self) -> Path | None:
        if not self.saved or not self.saved.get("sources") or not self.loaded.daily_warmup:
            return None
        self._same_bucket()
        # The first incomplete bucket's skip is retained; completed native daily observations are not invented.
        path = Path(tempfile.mkdtemp(prefix="paper-recovery-history-"))
        catalog = ParquetDataCatalog(str(path))
        for iid, values in self.partial.items():
            if values:
                if self.daily.get(iid) and any(value.ts_init <= self.daily[iid][-1].ts_init for value in values):
                    raise checkpoint.fail("post-daily input order is not representable by native history")
                if any(value.ts_init // DAY_NS != self.saved["cut_ns"] // DAY_NS for value in values):
                    raise checkpoint.fail("the partial aggregation spans an unobserved skipped boundary")
                start, end = history_bounds(values)
                catalog.write_bars(values, start=start, end=end)
                self.pending.add(iid)
        return path if self.pending else None

    def history_complete(self, iid: str) -> None:
        self.pending.discard(iid)
        self.maybe_begin()


class History(DataActor):
    def __new__(cls, *_):
        return DataActor.__new__(cls)

    def __init__(self, session: Session, iid: str):
        from nautilus_trader.common import DataActorConfig
        from nautilus_trader.model import ActorId
        super().__init__(DataActorConfig(actor_id=ActorId(f"Recovery-{iid.split('-')[0]}")))
        self.session, self.iid = session, iid

    def on_start(self):
        from datetime import UTC, datetime, timedelta
        values = self.session.partial[self.iid]
        def at(ns):
            return datetime.fromtimestamp(ns // 1_000_000_000, UTC) + timedelta(microseconds=ns % 1_000_000_000 // 1000)
        start, end = history_bounds(values)
        self.request_bars(BarType.from_str(f"{self.iid}-1-MINUTE-LAST-EXTERNAL"),
                          start=at(start), end=at(end),
                          params={"bar_types": [f"{self.iid}-1-DAY-LAST-INTERNAL@1-MINUTE-EXTERNAL"],
                                  "update_subscriptions": True,
                                  "skip_first_non_full_bar": not bool(self.session.daily.get(self.iid))})

    def on_historical_bars(self, values):
        expected = self.session.partial[self.iid]
        if [value.to_dict() for value in values] != [value.to_dict() for value in expected]:
            raise checkpoint.fail("native history did not return the exact checkpoint inputs")
        self.session.history_complete(self.iid)
