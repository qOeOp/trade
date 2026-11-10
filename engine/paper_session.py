"""Paper's checkpoint owner. Nautilus remains the sole owner of all economic state.

Protocol 1 is deliberately limited to credential-free perpetuals, explicit strategy save/load
hooks, minute bars and the aggregations WARMUP declares, and no strategy timers. An unrepresentable cut stays dirty.

A recovery warms each source again at its own T (engine.history): the declared history and the aggregations'
current buckets are read from Binance's klines, the history goes to on_historical_bars, then the source's on_load
gets its saved state and its on_start runs. A recovery that crossed a bucket boundary of a declared aggregation, or a
funding settlement, is refused: the source would never see that aggregated bar or settlement as it happened.
"""

from __future__ import annotations

import base64
from contextlib import contextmanager
from dataclasses import asdict
import json
from typing import Any, cast
import time

from nautilus_trader.model import Price, Venue
from nautilus_trader.trading import Strategy

from engine import history, paper_checkpoint as checkpoint, strategy as strategy_runtime, warmup
from engine.cadence import Cadence
from engine.config import ACCOUNT_CONTRACT


class Session:
    def __init__(self, backend, journal, loaded, saved: dict | None, started_ns: int, input_start_ns: int,
                 warm_at: int):
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
        # The sources start once warmed: T, its settling and its deadline (engine.history), and some slack.
        self.restore_deadline = (time.monotonic() + max(0, warm_at - time.time_ns()) / history.SECOND_NS
                                 + (history.DEADLINE_NS + history.SETTLE_NS) / history.SECOND_NS)
        self.lines: list[dict] = []  # only irreproducible settlement/refusal facts needed by the recorder
        self.last_bar: dict[str, int] = {}
        if saved:
            with (backend.output / "events.jsonl").open("rb") as stream:
                for raw in stream:
                    value = json.loads(raw)
                    if value["kind"] == "bar":
                        self.last_bar[value["instrument_id"]] = value["ts_event"]
                    elif value["kind"] in ("funding_settlement", "refusal"):
                        self.lines.append(value)
        if saved and saved.get("sources"):
            self._same_bucket()

    @property
    def aggregated(self) -> list[str]:
        """The aggregations the source's WARMUP declares (engine.warmup)."""
        return [period for period, _ in self.loaded.warmup if period != "1-MINUTE"]

    def _same_bucket(self) -> None:
        if not self.saved or not self.saved.get("sources"):
            return  # a waiting checkpoint has not started an aggregator or settlement cadence
        crossed = [period for period in self.aggregated if warmup.bucket_start(time.time_ns(), period)
                   != warmup.bucket_start(self.saved["cut_ns"], period)]
        if crossed:
            raise checkpoint.fail(f"recovery crossed a {crossed[-1]} aggregation boundary; the original point is "
                                  "retained")
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
        if not self.ready and len(self.starts) == self.expected_starts:
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
        found = saved.get("protection") or {}
        recorder.gaps.since, recorder.gaps.reported = dict(found.get("since", {})), set(found.get("reported", []))
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
                required = {f"{iid}-1-MINUTE-LAST-EXTERNAL"} | {f"{iid}-{period}-LAST-INTERNAL@1-MINUTE-EXTERNAL"
                                                                 for period in self.aggregated}
                if strategy._paper_subscription_changes or strategy._paper_subscriptions != required:
                    raise checkpoint.fail("recovery requires fixed subscriptions to the minute bars and every declared "
                                          "aggregation, without custom routing")
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
        recorder = self.recorder
        value = {"started_ns": self.started_ns, "input_start_ns": self.input_start_ns,
                 "cut_ns": cut_ns, "sources": sources,
                 "recorder": None if recorder is None else {
                     "minute": recorder.minute,
                     "marks": {iid: [ts, str(price)] for iid, (ts, price) in recorder.marks.items()},
                     "funding": {iid: item.next_funding_ns for iid, item in recorder.cadence.items()},
                     **({"protection": {"since": recorder.gaps.since, "reported": sorted(recorder.gaps.reported)}}
                        if recorder.uses_stop_loss else {}),
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
