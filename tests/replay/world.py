"""A replay world for the replay and run-storage tests: the registration world (throwaway Dolt service,
research line, candidates, fake market) plus a stand-in runtime whose "containers" are local Python
processes acting as runner, auditor and (when `fingerprint` is set) fingerprint stage on the host
side of the mounts, and a clean throwaway Git checkout as the product checkout. No Docker, never the
active ledger.

The stand-in runner writes a small native report set for its --symbols: one closed long cycle on the
first symbol (buy 1 at 100, sell at 110, 0.1 commission each side), daily returns compounding to the
final equity (`scenario["returns"]` sets the trade-window days, cycling), an empty exposure table
(flat at every bar close) and order events. `scenario` bends it.
"""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

from registration import seams as registration_seams
from replay import entry, seams
from tests.registration.world import FakeMarket, World, inspect_stand_in, months_rows
from tests.ledger.dolt import MARKET_COMMIT


BUILD_REVISION = "c" * 40
DEFAULT_FINGERPRINT = {"fills": {"rows": 2, "sha256": "0" * 64, "by_utc_day": {}}}
CONFIG_SHA = "f" * 64

RUNNER = r'''
import gzip, json, sys
from datetime import datetime, timezone
from pathlib import Path
spec = json.loads(sys.argv[1])
mounts, argv, scenario = spec["mounts"], spec["argv"], spec["scenario"]

def option(name, many=False):
    if name not in argv:
        return None
    index = argv.index(name) + 1
    if not many:
        return argv[index]
    found = []
    while index < len(argv) and not argv[index].startswith("--"):
        found.append(argv[index]); index += 1
    return found

def ns(text):
    return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()) * 10**9

def iso(value):
    return datetime.fromtimestamp(value // 10**9, timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f+00:00")

if spec["module"] == "fingerprint":
    Path(mounts["/reports"], "fingerprint.json").write_text(json.dumps(spec["fingerprint"]))
    sys.exit(0)

if spec["module"] == "audit":
    out = Path(mounts["/reports"])
    if scenario.get("audit_writes", True):
        (out / "audit.json").write_text(json.dumps({"passed": scenario.get("audit_passed", True),
            "findings": scenario.get("findings", []), "native_economics": {
                "reported_realized_pnl_usdt": "9.80000000", "fill_commissions_usdt": "0.20000000",
                "reported_funding_usdt": "0", "final_balance_usdt": "100009.80000000"}}))
    sys.exit(scenario.get("audit_exit", 0))

out = Path(mounts["/reports"])
start, end = option("--start"), option("--end")
trade_start = option("--trade-start") or start
symbols = option("--symbols", many=True)
execution = Path(mounts.get("/strategy", "/nonexistent")) / "execution.json"
binding = json.loads(execution.read_text()) if execution.is_file() else {}
if scenario.get("skip_reports"):
    sys.exit(scenario.get("native_exit", 1))
first, t0 = symbols[0], ns(trade_start)
iid = first + "-PERP.BINANCE"
buy, sell = t0 + 3600 * 10**9, t0 + 7200 * 10**9
tag = repr(["plan:%s-1" % iid]) if scenario.get("plan_tags", True) else "[]"
orders = [
    {"client_order_id": "O-1", "instrument_id": iid, "side": "BUY", "type": "LIMIT", "status": "FILLED", "filled_qty": "1",
     "ts_init": str(buy - 60 * 10**9), "ts_last": str(buy), "tags": tag, "parent_order_id": "", "is_reduce_only": "False"},
    {"client_order_id": "O-2", "instrument_id": iid, "side": "SELL", "type": "LIMIT", "status": "FILLED", "filled_qty": "1",
     "ts_init": str(buy - 60 * 10**9), "ts_last": str(sell), "tags": tag, "parent_order_id": "O-1", "is_reduce_only": "True"}]
fills = [
    {"client_order_id": "O-1", "instrument_id": iid, "order_side": "BUY", "last_qty": "1", "last_px": "100",
     "liquidity_side": "MAKER", "event_id": "E-1", "ts_event": iso(buy), "commission": "0.10000000 USDT"},
    {"client_order_id": "O-2", "instrument_id": iid, "order_side": "SELL", "last_qty": "1", "last_px": "110",
     "liquidity_side": "TAKER", "event_id": "E-2", "ts_event": iso(sell), "commission": "0.10000000 USDT"}]
events = [{"event_id": f["event_id"], "order_side": f["order_side"], "last_qty": f["last_qty"], "last_px": f["last_px"],
           "ts_event": buy if f["event_id"] == "E-1" else sell} for f in fills]
realized = scenario.get("realized", "9.80000000")
positions = [{"position_id": iid + "-P", "events": repr(events), "adjustments": "[]", "instrument_id": iid,
              "opening_order_id": "O-1", "closing_order_id": "O-2", "entry": "BUY", "side": "FLAT", "multiplier": "1",
              "is_inverse": "False", "ts_opened": iso(buy), "ts_last": str(sell), "ts_closed": iso(sell),
              "realized_pnl": realized + " USDT", "commissions": repr(["0.20000000 USDT"]), "is_snapshot": "False"}]
account = [{"ts_event": iso(ns(start)), "total": "100000.00000000", "locked": "0"},
           {"ts_event": iso(buy), "total": "99999.90000000", "locked": "100"},
           {"ts_event": iso(sell), "total": "100009.80000000", "locked": "0"}]
day = 86400 * 10**9
daily = scenario.get("returns")  # the trade-window daily returns; the final equity compounds them
returns = [(ts, 0.0 if ts < t0 else (0.000098 if ts == t0 else 0.0)) for ts in range(ns(start), ns(end), day)]
final = "100009.80000000"
if daily is not None:
    trade = [ts for ts, _ in returns if ts >= t0]
    returns = [(ts, 0.0) for ts, _ in returns if ts < t0] + [(ts, daily[k % len(daily)]) for k, ts in enumerate(trade)]
    growth = 1.0
    for _, value in returns:
        growth *= 1 + value
    final = "%.8f" % (100000 * growth)

def table(name, rows):
    with (out / name).open("w", newline="") as stream:
        import csv
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader(); writer.writerows(rows)

table("orders.csv", orders); table("fills.csv", fills); table("positions.csv", positions); table("account.csv", account)
(out / "returns_series.csv").write_text("ts_event_ns,native_return\n" + "".join(f"{ts},{value!r}\n" for ts, value in returns))
(out / "exposures.csv.gz").write_bytes(b"not gzip" if scenario.get("corrupt_exposures") else
                                       gzip.compress(b"ts_event_ns,position_id,notional_value,unrealized_pnl\n"))
(out / "order_events.jsonl.gz").write_bytes(gzip.compress(b"".join(
    json.dumps({"client_order_id": o["client_order_id"], "type": "OrderInitialized"}).encode() + b"\n" for o in orders)))
summary = {"source_sha256": option("--strategy-sha256"), "integrity_passed": True, "integrity_findings": [],
           "starting_balance_usdt": "100000", "final_equity_usdt": final, "closed_trades": 1,
           "data_interval_minutes": 1440, "input_start_utc": start, "period_start_utc": trade_start,
           "period_end_utc": end, "market_commit": option("--market-commit"),
           "per_coin": [{"instrument": s + "-PERP.BINANCE", "counts": {"last": 1, "mark": 1, "funding": 0}} for s in symbols]}
if binding:
    summary.update(runtime_identity=binding["runtime_identity"], effective_config_sha256=binding["effective_config_sha256"])
summary.update(scenario.get("summary", {}))
(out / "summary.json").write_text(json.dumps(summary))
if scenario.get("runtime_failures"):
    (out / "runtime_failures.jsonl").write_text(scenario["runtime_failures"])
if scenario.get("tamper_export"):
    Path(mounts["/inputs/market"], first, "bars.parquet").write_bytes(b"changed during the replay")
sys.exit(scenario.get("native_exit", 0))
'''


class Market(FakeMarket):
    """The fake market with an instrument_id in each export receipt, as today's exporter writes it."""

    def export_catalogs(self, commit, symbols, start_ns, end_ns, episodes, lifecycle_files, fresh):
        done = super().export_catalogs(commit, symbols, start_ns, end_ns, episodes, lifecycle_files, fresh)
        for symbol, receipt in done["receipts"].items():
            receipt["instrument_id"] = f"{symbol}-PERP.BINANCE"
            (Path(done["root"]) / symbol / "export.json").write_text(json.dumps(receipt))
        return done


def inspect(identity, runner_argv, inputs):
    return {**inspect_stand_in(identity, runner_argv, inputs), "effective_config_sha256": CONFIG_SHA}


class ReplayWorld(World):
    """The registration world with a stand-in runtime; `scenario` steers the next stand-in replay."""

    def __init__(self, name: str = "replay"):
        super().__init__(name)
        try:
            self.market = Market({MARKET_COMMIT: months_rows()})
            self.scenario: dict = {}
            self.fingerprint = DEFAULT_FINGERPRINT  # None: the image has no fingerprint entry
            self.commands: list[dict] = []
            self.stopped: list[str] = []
            self.checkout = clean_checkout(self.service.root / "checkout")
            self._inspect = registration_seams.use(inspect_runtime=inspect, checkout=lambda: self.checkout)
            self._inspect.__enter__()
            self._replay = seams.use(container_command=self.command, build_revision=lambda identity: BUILD_REVISION,
                                     layout=self.layout, stop=self.stopped.append)
            self._replay.__enter__()
            self._root = patch.object(entry, "WORK_ROOT", str(self.tmp))
            self._root.start()
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        for name in ("_root",):
            if getattr(self, name, None) is not None:
                getattr(self, name).stop()
        for name in ("_replay", "_inspect"):
            if getattr(self, name, None) is not None:
                getattr(self, name).__exit__(None, None, None)
        super().close()

    def layout(self, runtime_contract: str) -> dict:
        found = seams.DEFAULT.layout(runtime_contract)
        return {**found, "fingerprint_module": "fingerprint" if self.fingerprint is not None else None}

    def command(self, identity, mounts, module, argv, name):
        kind = "audit" if module.endswith("audit") else "fingerprint" if module == "fingerprint" else "runner"
        spec = {"module": kind, "mounts": {target: str(host) for host, target, _ in mounts}, "argv": list(argv),
                "scenario": self.scenario, "fingerprint": self.fingerprint, "name": name}
        self.commands.append(spec)
        return [sys.executable, "-c", RUNNER, json.dumps(spec), *argv]

    def output(self, name: str) -> Path:
        return self.tmp / name

    def strategy_file(self, data: bytes, name: str = "draft.py") -> Path:
        path = self.tmp / name
        path.write_bytes(data)
        return path


def clean_checkout(root: Path) -> Path:
    """A Git work tree with one commit and nothing uncommitted: the product checkout of a sealed run."""
    root.mkdir()
    env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid", "GIT_COMMITTER_NAME": "t",
           "GIT_COMMITTER_EMAIL": "t@example.invalid", "GIT_CONFIG_GLOBAL": "/dev/null",
           "GIT_CONFIG_SYSTEM": "/dev/null",
           "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin"}
    for argv in (["init", "-q"], ["commit", "-q", "--allow-empty", "-m", "product"]):
        subprocess.run(["git", *argv], cwd=root, env=env, check=True, capture_output=True)
    return root


def registered_grid(world: World, tags: list[str], bundle: str = "registration-grid") -> list[str]:
    """Publish root candidates, precheck and review each, and register them as one grid; returns refs."""
    refs, reviews = [], {}
    for tag in tags:
        published = world.publish(tag, parent=None)
        refs.append(published["candidate"])
        reviews[published["candidate"]] = world.prechecked(published["source"])
    world.judge("review_cadence", cadence=50)
    world.register(bundle, world.body(refs, reviews))
    return refs
