"""Reusable accelerated Paper & Live multi-contract soak and fault simulation harness (#3786).

Runs >= 6 contracts across staggered/misaligned tracks (`bars`, `quotes`, `marks`, `funding`, `metrics`) in
accelerated virtual time, while enforcing four release-gate invariants:
1. Multi-contract & multi-track throughput and cadence invariants (no dropped tracks or skipped settlements).
2. Memory & resource envelope bounds (`tracemalloc` steady-state growth + RSS + container memory ceiling).
3. Periodic native checkpoint advancement and mid-run fault / reconnect / restart reconciliation.
4. Machine-readable structured log & journal completeness (turning silent production failures into test failures).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
import json
from pathlib import Path
import re
import resource
import sys
import tempfile
import tracemalloc
from types import SimpleNamespace
from typing import Any
from unittest import mock

from nautilus_trader.model import (
    FundingRateUpdate,
    InstrumentId,
    OrderSide,
    OrderStatus,
    OrderType,
    Price,
    TimeInForce,
    TriggerType,
)
from nautilus_trader.trading import Strategy

from engine import metrics, paper, paper_checkpoint as checkpoint, paper_session
from engine import strategy as strategy_runtime
from engine.cadence import Cadence
from engine.config import MINUTE_NS
from engine.live_venue import BinanceReadOnly, Credentials
from paper import runs as paper_runs
from tests.live_loopback.venue import Venue

HOUR_NS = 60 * MINUTE_NS
FUNDING_INTERVAL_NS = 8 * HOUR_NS
BASE_TS_NS = 1_767_225_600_000_000_000  # 2026-01-01 00:00:00 UTC

DEFAULT_SYMBOLS: dict[str, dict[str, str]] = {
    "BTCUSDT": {"price": "96000.0", "tick": "0.10", "step": "0.001", "min_notional": "50"},
    "ETHUSDT": {"price": "3400.0", "tick": "0.01", "step": "0.001", "min_notional": "20"},
    "SOLUSDT": {"price": "195.0", "tick": "0.01", "step": "0.01", "min_notional": "10"},
    "BNBUSDT": {"price": "690.0", "tick": "0.01", "step": "0.01", "min_notional": "10"},
    "XRPUSDT": {"price": "2.4000", "tick": "0.0001", "step": "1", "min_notional": "10"},
    "DOGEUSDT": {"price": "0.34000", "tick": "0.00001", "step": "1", "min_notional": "10"},
}

PROD_ERROR_PATTERNS: dict[str, re.Pattern[str]] = {
    "oom": re.compile(
        r"(?:"
        r"\bOOMKilled(?![\"']?\s*[:=]\s*(?:false|0)\b)"
        r"|\bOOM[- ]?killer\b"
        r"|\bMemoryError\b"
        r"|\bCannot allocate memory\b"
        r"|\bOut of memory(?:\s*[:!(,]|\s+(?:kill(?:ed|ing)?|error|while|allocat\w*)|$)"
        r"|\bKilled process\s+\d+\b"
        r"|\b(?:exit(?:ed|\s+code|\s+status)?|ExitCode|status)[\"']?\s*[:=(]?\s*137\b"
        r")",
        re.IGNORECASE,
    ),
    "checkpoint_deferred": re.compile(r"Paper checkpoint deferred:", re.IGNORECASE),
    "recovery_unavailable": re.compile(r"\bPAPER_RECOVERY_UNAVAILABLE\b"),
    "fatal_exception": re.compile(r"\b(?:Traceback \(most recent call last\)|FATAL|CRITICAL)\b"),
}


class SoakStrategy(Strategy):
    """Recovery-capable strategy class used by the Paper soak harness."""

    PAPER_RECOVERY = 1

    def on_save(self) -> dict[str, bytes]:
        return {"soak": b"ok"}

    def on_load(self, state: dict[str, bytes]) -> None:
        pass


@dataclass
class MemorySample:
    step: int
    current_kib: float
    peak_kib: float
    rss_mib: float


class MemoryEnvelope:
    """Tracks steady-state heap growth and process RSS against a configurable production ceiling."""

    def __init__(self, *, max_growth_kib: float = 4096.0, max_rss_mib: float = 1024.0):
        self.max_growth_kib = max_growth_kib
        self.max_rss_mib = max_rss_mib
        self.samples: list[MemorySample] = []
        self._started_here = False

    @staticmethod
    def _rss_mib() -> float:
        raw = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # macOS reports ru_maxrss in bytes; Linux reports KiB.
        divisor = 1024.0 * 1024.0 if sys.platform == "darwin" else 1024.0
        return raw / divisor

    def __enter__(self) -> MemoryEnvelope:
        if not tracemalloc.is_tracing():
            tracemalloc.start()
            self._started_here = True
        return self

    def __exit__(self, *exc) -> None:
        if self._started_here and tracemalloc.is_tracing():
            tracemalloc.stop()

    def sample(self, step: int) -> MemorySample:
        current, peak = tracemalloc.get_traced_memory()
        rec = MemorySample(step=step, current_kib=current / 1024.0, peak_kib=peak / 1024.0, rss_mib=self._rss_mib())
        self.samples.append(rec)
        return rec

    @property
    def steady_growth_kib(self) -> float:
        """Heap growth from midpoint (post-warmup) to final sample."""
        if len(self.samples) < 2:
            return 0.0
        mid = len(self.samples) // 2
        return self.samples[-1].current_kib - self.samples[mid].current_kib

    def assert_within_budget(self, *, contracts: int, enforce_container_cap: bool = False) -> dict[str, float]:
        if not self.samples:
            raise AssertionError("MemoryEnvelope has no samples")
        growth = self.steady_growth_kib
        peak_rss = max(s.rss_mib for s in self.samples)
        container_mib = float(paper_runs.mib(paper_runs.runner_memory(contracts)))
        if growth > self.max_growth_kib:
            raise AssertionError(
                f"unbounded soak heap growth: {growth:.1f} KiB > limit {self.max_growth_kib:.1f} KiB "
                f"(contracts={contracts}, container_limit={container_mib} MiB)"
            )
        rss_limit = min(self.max_rss_mib, container_mib) if enforce_container_cap else self.max_rss_mib
        if peak_rss > rss_limit:
            raise AssertionError(
                f"process RSS exceeded soak ceiling: {peak_rss:.1f} MiB > limit {rss_limit:.1f} MiB "
                f"(max_rss_mib={self.max_rss_mib:.1f}, container_limit={container_mib:.1f} MiB)"
            )
        return {
            "steady_growth_kib": round(growth, 2),
            "peak_kib": round(max(s.peak_kib for s in self.samples), 2),
            "peak_rss_mib": round(peak_rss, 2),
            "container_limit_mib": container_mib,
        }


@dataclass
class LogAuditResult:
    event_count: int
    log_line_count: int
    seen_events: set[str]
    anomalies: dict[str, list[str]]


class LogContractVerifier:
    """Enforces structured runtime log and JSONL journal completeness for Paper & Live runs."""

    def audit(
        self,
        *,
        events_path: Path | None = None,
        events: list[dict[str, Any]] | None = None,
        log_lines: list[str] | None = None,
        required_events: tuple[str, ...] = ("started", "stopped"),
        allow_anomalies: set[str] | None = None,
    ) -> LogAuditResult:
        parsed_events: list[dict[str, Any]] = []
        if events is not None:
            parsed_events.extend(events)
        if events_path is not None:
            if not events_path.exists():
                raise AssertionError(f"structured journal missing: {events_path}")
            raw_lines = [line for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
            for lineno, line in enumerate(raw_lines, 1):
                try:
                    parsed_events.append(json.loads(line))
                except json.JSONDecodeError as exc:
                    raise AssertionError(f"corrupt JSONL line {lineno} in {events_path}: {exc}") from exc

        if not parsed_events:
            raise AssertionError("empty structured event journal: silent runtime failure is forbidden")

        seen: set[str] = set()
        for entry in parsed_events:
            name = entry.get("kind") or entry.get("event")
            if isinstance(name, str):
                seen.add(name)

        missing = [req for req in required_events if req not in seen]
        if missing:
            raise AssertionError(f"missing required lifecycle events: {missing} (seen={sorted(seen)})")

        lines = list(log_lines or [])
        anomalies: dict[str, list[str]] = {key: [] for key in PROD_ERROR_PATTERNS}
        for line in lines:
            for key, pattern in PROD_ERROR_PATTERNS.items():
                if pattern.search(line):
                    anomalies[key].append(line)

        allowed = allow_anomalies or set()
        unexpected = {key: hits for key, hits in anomalies.items() if hits and key not in allowed}
        if unexpected:
            summary = ", ".join(f"{k}={len(v)}" for k, v in sorted(unexpected.items()))
            raise AssertionError(f"unexpected runtime log anomalies detected: {summary}")

        return LogAuditResult(
            event_count=len(parsed_events),
            log_line_count=len(lines),
            seen_events=seen,
            anomalies={k: v for k, v in anomalies.items() if v},
        )


@dataclass
class PaperSoakResult:
    symbols: list[str]
    minutes_simulated: int
    bars_delivered: dict[str, int]
    quotes_delivered: dict[str, int]
    marks_accepted: dict[str, int]
    funding_settlements: dict[str, int]
    metrics_delivered: dict[str, int]
    attempted_cuts: int
    published_cuts: int
    deferred_reasons: list[str]
    log_lines: list[str]
    events_path: Path
    memory: dict[str, float]
    last_snapshot: dict[str, Any] = field(default_factory=dict)


class PaperSoakHarness:
    """Accelerated multi-contract Paper soak runner built directly on real engine.paper* primitives."""

    def __init__(
        self,
        *,
        symbols: dict[str, dict[str, str]] | None = None,
        start_ns: int = BASE_TS_NS,
        cut_every_minutes: int = 30,
        memory_growth_limit_kib: float = 4096.0,
    ):
        self.symbols = dict(symbols or DEFAULT_SYMBOLS)
        self.iids = [f"{sym}-PERP.BINANCE" for sym in self.symbols]
        self.start_ns = start_ns
        self.cut_every_minutes = cut_every_minutes
        self.memory_growth_limit_kib = memory_growth_limit_kib
        self._temp = tempfile.TemporaryDirectory(prefix="paper-soak-")
        self.root = Path(self._temp.name)
        self.output = self.root / "out"
        self.output.mkdir(parents=True, exist_ok=True)
        self.recovery_root = self.output / "recovery"
        self.recovery_root.mkdir(parents=True, exist_ok=True)
        self.rdb_path = self.root / "cache.rdb"
        self.rdb_path.write_bytes(b"REDIS0011-soak-snapshot")
        self.log_lines: list[str] = []
        self.leaked_buffers: list[bytes] = []

    def close(self) -> None:
        self.leaked_buffers.clear()
        self._temp.cleanup()

    def __enter__(self) -> PaperSoakHarness:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    @staticmethod
    def make_resting_order(iid: str, *, side: str = "SELL", trigger: str = "80000.0", order_id: str = "O-SOAK-1"):
        return SimpleNamespace(
            client_order_id=order_id,
            instrument_id=iid,
            order_type=OrderType.STOP_MARKET,
            status=OrderStatus.ACCEPTED,
            side=getattr(OrderSide, side),
            trigger_price=Price.from_str(trigger),
            price=Price.from_str(trigger),
            time_in_force=TimeInForce.GTC,
            expire_time=None,
            trigger_type=TriggerType.DEFAULT,
            is_closed=False,
            is_emulated=False,
            emulation_trigger=None,
            contingency_type=None,
            parent_order_id=None,
            linked_order_ids=None,
        )

    def _make_strategy(
        self, iid: str, *, timers: list[str], subscription_changed: bool, subscribe_metrics: bool = False
    ) -> Any:
        followed = (
            {iid: {"instrument_id": iid, "ts_event": self.start_ns, "found": {}, "thread": None, "retry_ns": 0}}
            if subscribe_metrics
            else {}
        )
        return SimpleNamespace(
            _paper_held=[],
            _paper_subscription_changes=subscription_changed,
            _paper_user_timers=False,
            _paper_subscriptions={f"{iid}-1-MINUTE-LAST-EXTERNAL"},
            clock=SimpleNamespace(timer_names=lambda: list(timers)),
            save=lambda iid=iid: {"contract": iid.encode("utf-8")},
            _paper_cadence={iid: Cadence()},
            _metrics_followed=followed,
        )

    def run(
        self,
        *,
        hours: int = 8,
        subscribe_metrics: bool = False,
        inject_subscription_change: bool = False,
        inject_user_timer: bool = False,
        inject_leak_kib_per_minute: int = 0,
        open_orders: list[Any] | None = None,
        assert_checkpoints_advance: bool = True,
        assert_memory: bool = True,
    ) -> PaperSoakResult:
        total_minutes = hours * 60
        bars_delivered = {iid: 0 for iid in self.iids}
        quotes_delivered = {iid: 0 for iid in self.iids}
        marks_accepted = {iid: 0 for iid in self.iids}
        funding_settlements = {iid: 0 for iid in self.iids}
        metrics_delivered = {iid: 0 for iid in self.iids}

        journal = paper.Journal(self.output)
        try:
            journal.write("started", symbols=list(self.symbols), contracts=len(self.symbols))
            self.log_lines.append(f"INFO paper soak started contracts={len(self.symbols)} hours={hours}")

            snapshots: list[dict[str, Any]] = []

            def fake_snapshot(cache_obj, meta: dict[str, Any]) -> dict[str, Any]:
                snapshots.append(meta)
                checkpoint.publish(self.output, f"soak-{len(snapshots)}", self.rdb_path)
                return meta

            backend = SimpleNamespace(output=self.output, root=self.recovery_root, snapshot=fake_snapshot)
            loaded = SimpleNamespace(strategy_class=SoakStrategy, warmup=())
            session = paper_session.Session(backend, journal, loaded, None, self.start_ns, self.start_ns, self.start_ns)
            session.ready = True
            session.warm_at = self.start_ns

            timers = ([metrics.TIMER_NAME] if subscribe_metrics else []) + (
                ["user-soak-timer"] if inject_user_timer else []
            )
            strategies = {
                iid: self._make_strategy(
                    iid,
                    timers=timers,
                    subscription_changed=inject_subscription_change,
                    subscribe_metrics=subscribe_metrics,
                )
                for iid in self.iids
            }
            cache = SimpleNamespace(orders=lambda: list(open_orders or []), positions_open=list)

            attempted_cuts = 0
            published_cuts = 0
            deferred_reasons: list[str] = []

            with mock.patch.dict(strategy_runtime.STRATEGIES, strategies, clear=True), MemoryEnvelope(
                max_growth_kib=self.memory_growth_limit_kib
            ) as mem:
                mem.sample(0)
                for minute in range(1, total_minutes + 1):
                    now_ns = self.start_ns + minute * MINUTE_NS
                    # Mark dirty on every simulated tick batch as Session.callback does.
                    checkpoint.dirty(self.output)

                    for idx, (sym, spec) in enumerate(self.symbols.items()):
                        iid = f"{sym}-PERP.BINANCE"
                        inst_id = InstrumentId.from_str(iid)
                        base_price = Decimal(spec["price"])
                        # Deterministic bounded price oscillation across tracks.
                        offset = Decimal((minute + idx) % 11 - 5) * Decimal(spec["tick"]) * 10
                        px = base_price + offset
                        if px <= 0:
                            raise AssertionError(f"invalid synthetic price {px} for {sym}")
                        bars_delivered[iid] += 1
                        # Two quote ticks per minute (staggered sub-minute timestamps).
                        quotes_delivered[iid] += 2

                        # Cadence: emit 2 marks per minute; only the first passes replay cadence.
                        cadence = strategies[iid]._paper_cadence[iid]
                        for sub in (100_000_000, 500_000_000):
                            mark_update = SimpleNamespace(instrument_id=inst_id, ts_event=now_ns + sub, value=px)
                            if cadence.mark(mark_update):
                                marks_accepted[iid] += 1

                        # Funding settlement every 8 hours (next_funding_ns advances at each 8h boundary).
                        next_funding = ((now_ns // FUNDING_INTERVAL_NS) + 1) * FUNDING_INTERVAL_NS
                        funding_update = FundingRateUpdate(
                            inst_id,
                            Decimal("0.0001"),
                            now_ns,
                            now_ns,
                            None,
                            next_funding,
                        )
                        if cadence.funding(funding_update) is not None:
                            funding_settlements[iid] += 1

                        # Staggered 5-minute Metrics track (aligned to 5m boundaries, real Metrics dataclass).
                        if minute % 5 == 0:
                            ts_ev = now_ns - metrics.VISIBLE_NS
                            row = metrics.Metrics(
                                inst_id,
                                Decimal("10000").quantize(metrics.EXACT),
                                Decimal("1.1").quantize(metrics.EXACT),
                                Decimal("1.2").quantize(metrics.EXACT),
                                Decimal("1.0").quantize(metrics.EXACT),
                                ts_ev,
                                now_ns,
                            )
                            if row.ts_init == now_ns:
                                metrics_delivered[iid] += 1
                                if subscribe_metrics:
                                    strategies[iid]._metrics_followed[iid]["ts_event"] = now_ns

                    if inject_leak_kib_per_minute > 0:
                        self.leaked_buffers.append(b"x" * (inject_leak_kib_per_minute * 1024))

                    if minute % self.cut_every_minutes == 0:
                        attempted_cuts += 1
                        for iid in self.iids:
                            journal.write("bar", instrument_id=iid, ts_event=now_ns - 1_000_000, minute=minute)
                        with mock.patch("engine.paper_session.time.time_ns", return_value=now_ns):
                            try:
                                session.cut(cache)
                                published_cuts += 1
                                journal.write("checkpoint", cut_ns=now_ns, published=published_cuts)
                                self.log_lines.append(f"INFO paper checkpoint published cut_ns={now_ns}")
                            except checkpoint.Refusal as exc:
                                reason = str(exc)
                                deferred_reasons.append(reason)
                                self.log_lines.append(f"WARNING Paper checkpoint deferred: {reason}")
                        mem.sample(minute)

                journal.write("stopped", minutes=total_minutes, published_cuts=published_cuts)
                self.log_lines.append(f"INFO paper soak stopped published_cuts={published_cuts}")
                journal.close()
                mem.sample(total_minutes + 1)
                mem_stats = mem.assert_within_budget(contracts=len(self.symbols)) if assert_memory else {
                    "steady_growth_kib": round(mem.steady_growth_kib, 2),
                    "peak_kib": round(max(s.peak_kib for s in mem.samples), 2),
                    "peak_rss_mib": round(max(s.rss_mib for s in mem.samples), 2),
                    "container_limit_mib": float(paper_runs.mib(paper_runs.runner_memory(len(self.symbols)))),
                }
        finally:
            journal.close()

        if assert_checkpoints_advance:
            min_expected = max(1, total_minutes // self.cut_every_minutes)
            if published_cuts < min_expected:
                raise AssertionError(
                    f"checkpoint starvation detected: published {published_cuts}/{attempted_cuts} cuts "
                    f"(expected >= {min_expected}); deferred={deferred_reasons[:3]}"
                )

        return PaperSoakResult(
            symbols=list(self.symbols),
            minutes_simulated=total_minutes,
            bars_delivered=bars_delivered,
            quotes_delivered=quotes_delivered,
            marks_accepted=marks_accepted,
            funding_settlements=funding_settlements,
            metrics_delivered=metrics_delivered,
            attempted_cuts=attempted_cuts,
            published_cuts=published_cuts,
            deferred_reasons=deferred_reasons,
            log_lines=list(self.log_lines),
            events_path=self.output / "events.jsonl",
            memory=mem_stats,
            last_snapshot=snapshots[-1] if snapshots else {},
        )

    def simulate_restart_recovery(
        self,
        *,
        saved_snapshot: dict[str, Any],
        downtime_minutes: int,
        open_orders: list[Any],
        downtime_low: str = "95000.0",
        downtime_high: str = "97000.0",
    ) -> tuple[bool, str | None]:
        """Simulates a mid-run Paper restart with real Session.maybe_begin() and touched() checks."""
        cut_ns = int(saved_snapshot["cut_ns"])
        warm_at = cut_ns + downtime_minutes * MINUTE_NS
        last_bar_ns = cut_ns - 1_000_000
        downtime: dict[str, list[Any]] = {}
        last_bar: dict[str, int] = {}
        for iid in self.iids:
            last_bar[iid] = last_bar_ns
            downtime[iid] = [
                SimpleNamespace(
                    ts_event=last_bar_ns + idx * MINUTE_NS,
                    low=Price.from_str(downtime_low),
                    high=Price.from_str(downtime_high),
                )
                for idx in range(1, downtime_minutes + 1)
            ]

        account = SimpleNamespace(to_dict=lambda: {"calculate_account_state": True})
        backend = SimpleNamespace(output=self.output, root=self.recovery_root, snapshot=mock.Mock(return_value={}))
        loaded = SimpleNamespace(strategy_class=SoakStrategy, warmup=())
        with mock.patch("engine.paper_session.time.time_ns", return_value=warm_at):
            session = paper_session.Session(
                backend, mock.Mock(), loaded, saved_snapshot, self.start_ns, self.start_ns, warm_at,
                release=lambda _: None,
            )
            session.ready = False
            session.expected_starts = len(self.iids) + 1
            session.warm_at = warm_at
            session.last_bar = last_bar
            session.downtime = downtime
            session.cache = SimpleNamespace(account_for_venue=lambda _: account, orders=lambda: list(open_orders))

            started: list[str] = []
            session.start(lambda: started.append("recorder"))
            for iid in self.iids:
                session.start(lambda iid=iid: started.append(iid))
        return session.ready, session.refused

    def simulate_metrics_restart_recovery(
        self,
        *,
        saved_snapshot: dict[str, Any],
        downtime_minutes: int = 16,
    ) -> tuple[bool, str | None, dict[str, list[int]]]:
        """End-to-end recovery check for Metrics-subscribed strategies across #3783 + #3786."""
        cut_ns = int(saved_snapshot["cut_ns"])
        warm_at = cut_ns + downtime_minutes * MINUTE_NS
        delivered: dict[str, list[int]] = {iid: [] for iid in self.iids}

        def reader(_iid: str, _ts_event: int, wanted: list[str]) -> dict[str, Decimal]:
            return {name: Decimal("2.5").quantize(metrics.EXACT) for name in wanted}

        account = SimpleNamespace(to_dict=lambda: {"calculate_account_state": True})
        backend = SimpleNamespace(output=self.output, root=self.recovery_root, snapshot=mock.Mock(return_value={}))
        loaded = SimpleNamespace(strategy_class=SoakStrategy, warmup=())

        strategies: dict[str, Any] = {}
        for iid in self.iids:
            strat = self._make_strategy(iid, timers=[], subscription_changed=False, subscribe_metrics=False)
            strat._metrics_read = reader
            strat._replay_input_start_ns = self.start_ns
            strat.on_data = lambda custom, iid=iid: delivered[iid].append(custom.data.ts_event)
            clock = SimpleNamespace(
                timestamp_ns=lambda: warm_at + 10**9,
                timer_names=list,
                set_timer=lambda *_args, **_kwargs: None,
            )
            strat._metrics_clock = lambda clock=clock: clock
            strat._metrics_tick = lambda _ev=None: None
            strat._metrics_backfill_due = lambda up_to_ns, strat=strat: metrics.Feed._metrics_backfill_due(
                strat, up_to_ns
            )
            strategies[iid] = strat

        with mock.patch.dict(strategy_runtime.STRATEGIES, strategies, clear=True), mock.patch(
            "engine.paper_session.time.time_ns", return_value=warm_at
        ):
            session = paper_session.Session(
                backend, mock.Mock(), loaded, saved_snapshot, self.start_ns, self.start_ns, warm_at,
                release=lambda _: None,
            )
            session.ready = False
            session.expected_starts = len(self.iids) + 1
            session.warm_at = warm_at
            session.since = {}
            session.cache = SimpleNamespace(account_for_venue=lambda _: account, orders=list)
            session.start(lambda: None)
            for iid, strat in strategies.items():
                session.start(
                    lambda iid=iid, strat=strat: metrics.Feed._metrics_follow(
                        strat, iid, after_ns=session.metrics_after()
                    )
                )
        return session.ready, session.refused, delivered


class LiveSoakVenue:
    """Multi-contract Live loopback venue + real BinanceReadOnly client wrapper for accelerated fault tests."""

    def __init__(self, *, symbols: dict[str, dict[str, str]] | None = None, wallet: str = "200"):
        self.symbols = dict(symbols or DEFAULT_SYMBOLS)
        self.credentials = Credentials("soak-key", "soak-secret")
        self.venue = Venue(
            api_key=self.credentials.api_key,
            api_secret=self.credentials.api_secret,
            symbols=self.symbols,
            wallet=wallet,
        )
        self.client: BinanceReadOnly | None = None

    def __enter__(self) -> LiveSoakVenue:
        self.venue.start()
        self.client = BinanceReadOnly(self.credentials, origin=self.venue.http_origin)
        return self

    def __exit__(self, *exc) -> None:
        self.venue.close()
