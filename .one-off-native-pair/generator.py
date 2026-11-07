"""Generate isolated engineering inputs; never run an engine or write a ledger."""
import argparse
import ast
from datetime import date
import hashlib
import inspect
import json
from pathlib import Path
import sys

import numpy as np

MINUTE = 60_000
DAY = 1440 * MINUTE
JAN = 1_767_225_600_000
SYMBOLS = ["BTCUSDT", "ETHUSDT"]
TRACE_SCHEMA = "pairing-clock-v2"
WINDOWS = {
    "probe": {"start": "2026-01-01T00:00:00Z", "trade_start": "2026-01-01T00:05:00Z",
              "end": "2026-01-03T00:00:00Z", "class": "Probe", "uses_stop_loss": False},
    "protection": {"start": "2026-01-01T07:30:00Z", "trade_start": "2026-01-01T07:30:00Z",
                   "end": "2026-01-01T09:06:00Z", "class": "TieredEntry", "uses_stop_loss": True},
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def verify_baseline(repo):
    baseline = json.loads(Path(__file__).with_name("baseline.json").read_text())
    changed = [name for name, expected in baseline["files"].items() if sha(repo / name) != expected]
    if changed:
        raise ValueError(f"frozen fixture/engine inputs changed: {changed}")
    return baseline


def fixture_trees(repo):
    stream = ast.parse((repo / "tests/engine/test_stream.py").read_text())
    probe = next(ast.literal_eval(node.value) for node in stream.body if isinstance(node, ast.Assign)
                 and any(isinstance(t, ast.Name) and t.id == "PROBE" for t in node.targets))
    probe_tree = ast.parse(probe)
    trace_expressions = {
        "on_bar": '["bar", str(bar.bar_type), bar.ts_event, bar.ts_init, self.clock.timestamp_ns()]',
        "on_mark_price": '["mark", mark.ts_event, mark.ts_init, self.clock.timestamp_ns()]',
        "on_funding_rate": '["funding", funding.ts_event, funding.ts_init, self.clock.timestamp_ns()]',
        "on_order_event": '["order", type(event).__name__, event.ts_event, event.ts_init, self.observation_clock.timestamp_ns(), str(event.client_order_id)]',
        "on_timer": '["timer", event.ts_event, event.ts_init, self.clock.timestamp_ns(), event.name]',
    }
    for node in ast.walk(probe_tree):
        if isinstance(node, ast.FunctionDef) and node.name == "on_start":
            node.body.insert(0, ast.parse('self.observation_clock = self.clock').body[0])
        if isinstance(node, ast.FunctionDef) and node.name == "replay_diagnostics":
            node.body = ast.parse(f'return {{"bars": self.n, "seen": self.seen, "trace_schema": "{TRACE_SCHEMA}"}}').body
        if isinstance(node, ast.FunctionDef) and node.name in trace_expressions:
            # Replace only an existing passive diagnostic append. Trading/timer scheduling statements stay intact.
            calls = [item for item in ast.walk(node) if isinstance(item, ast.Call)
                     and isinstance(item.func, ast.Attribute) and item.func.attr == "append"
                     and isinstance(item.func.value, ast.Attribute) and item.func.value.attr == "seen"]
            if len(calls) != 1:
                raise ValueError("the frozen Probe callback trace shape changed")
            calls[0].args = [ast.parse(trace_expressions[node.name], mode="eval").body]
    # Keep all trading rules and USES_STOP_LOSS=False of the existing Probe intact.
    partial = ast.parse((repo / "tests/engine/test_partial_entry_protection.py").read_text())
    tier = next(node for node in partial.body if isinstance(node, ast.ClassDef) and node.name == "TieredEntry")

    class Adapt(ast.NodeTransformer):
        def visit_Name(self, node):
            if node.id == "INSTRUMENT_ID":
                return ast.copy_location(ast.Attribute(ast.Name("self", ast.Load()), "iid", ast.Load()), node)
            if node.id == "BAR_TYPE":
                return ast.copy_location(ast.parse('BarType.from_str(f"{self.iid}-1-MINUTE-LAST-EXTERNAL")',
                                                  mode="eval").body, node)
            if node.id == "CLOSE_BAR":
                return ast.copy_location(ast.Constant(90), node)
            return node

        def visit_Call(self, node):
            if isinstance(node.func, ast.Name) and node.func.id == "StrategyId":
                return ast.copy_location(ast.parse('kw["strategy_id"]', mode="eval").body, node)
            return self.generic_visit(node)

    tier = Adapt().visit(tier)
    for node in tier.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        if node.name == "__init__":
            node.args = ast.parse('def f(self, instrument_id, daily_bar_type, **kw): pass').body[0].args
            node.body += ast.parse('self.iid = instrument_id\nself.seen = []\nself.tiers = (("103.00", "16.339"),)').body
        elif node.name == "on_start":
            node.body.insert(0, ast.parse('self.observation_clock = self.clock').body[0])
            node.body += ast.parse('self.subscribe_mark_prices(self.iid)\nself.subscribe_funding_rates(self.iid)').body
        elif node.name == "on_bar":
            node.body.insert(0, ast.parse(f'self.seen.append({trace_expressions["on_bar"]})').body[0])
        elif node.name == "replay_diagnostics":
            node.body = ast.parse(f'return {{"bars": self.bars, "seen": self.seen, "trace_schema": "{TRACE_SCHEMA}"}}').body
    # New callbacks record clocks only; extracted order construction/expiry/stop geometry is unchanged.
    for name, arg, expression in [
        ("on_mark_price", "mark", trace_expressions["on_mark_price"]),
        ("on_funding_rate", "funding", trace_expressions["on_funding_rate"]),
        ("on_order_event", "event", trace_expressions["on_order_event"]),
    ]:
        tier.body += ast.parse(f'def {name}(self, {arg}):\n    self.seen.append({expression})').body
    tier.body.insert(1, ast.parse('USES_STOP_LOSS = True').body[0])
    imports = ast.parse('from nautilus_trader.model import BarType, OrderSide, OrderType, Price, Quantity, TimeInForce\n'
                        'from nautilus_trader.trading import Strategy, StrategyConfig\nBAR_NS = 60_000_000_000').body
    protection = ast.Module(body=imports + [tier], type_ignores=[])
    return {"probe": ast.fix_missing_locations(probe_tree), "protection": ast.fix_missing_locations(protection)}


def generate_sources(repo, output):
    # tests/ is deliberately not an installed product package; use only the explicitly frozen checkout.
    if str(repo) not in sys.path:
        sys.path.insert(0, str(repo))
    from engine.load import load_strategy, source_findings
    baseline = verify_baseline(repo)
    output.mkdir(parents=True, exist_ok=False)
    sources = {}
    for kind, tree in fixture_trees(repo).items():
        path = output / f"{kind}.py"
        path.write_text(ast.unparse(tree) + "\n")
        problems = source_findings(path.read_bytes())
        if problems:
            raise ValueError(f"source check {kind}: {problems}")
        loaded = load_strategy(path, WINDOWS[kind]["class"], sha(path))
        if loaded.uses_stop_loss != WINDOWS[kind]["uses_stop_loss"]:
            raise ValueError("source stop declaration changed")
        sources[kind] = {"file": path.name, "sha256": sha(path), **WINDOWS[kind]}
    value = {"baseline_candidate": baseline["reference_candidate"], "sources": sources,
             "symbols": SYMBOLS, "groups": [["BTCUSDT"], ["ETHUSDT"], SYMBOLS],
             "trace_schema": TRACE_SCHEMA,
             "scope": "synthetic engineering fixtures; no research/venue evidence"}
    write_json(output / "manifest.json", value)
    return value


def columns(kind, seed):
    # One full month-eve day plus two complete trade days; all LAST minutes trade.
    minutes = np.arange(-1440, 2880, dtype=np.int64)
    if kind == "probe":
        # Same algorithm as test_stream.series; import only the deterministic data helper.
        from tests.engine.test_stream import series
        last = series(seed, minutes)
    else:
        from decimal import Decimal
        from tests.engine import test_partial_entry_protection as fixture
        tree = ast.parse(inspect.getsource(fixture.bars))
        geometry = next(node.value for node in ast.walk(tree) if isinstance(node, ast.Assign)
                        and any(isinstance(target, ast.Tuple) and [value.id for value in target.elts] == ["o", "h", "l", "c", "v"]
                                for target in node.targets))
        expression = compile(ast.Expression(geometry), "<frozen-fixture-geometry>", "eval")
        offset = minutes - 450  # scenario starts Jan 1 07:30; original 96-bar geometry
        rows = []
        for i in offset:
            values = eval(expression, {"__builtins__": {}}, {"index": int(i), "ENTRY_BAR": fixture.ENTRY_BAR, "STOP_BAR": fixture.STOP_BAR})
            rows.append([int(Decimal(str(v)) * 10**8) for v in values])
        matrix = np.asarray(rows, dtype=np.int64)
        last = {"ts_open": JAN + minutes * MINUTE,
                **{key: matrix[:, index] for index, key in enumerate(("open", "high", "low", "close", "volume"))}}
    mark = {**last, "volume": np.zeros(len(minutes), dtype=np.int64)}
    return last, mark


def seed_market(kind, profile):
    from tests.market.directory import seed
    bars = {}
    for index, symbol in enumerate(SYMBOLS):
        last, mark = columns(kind, index + 1)
        bars[(symbol, "LAST")], bars[(symbol, "MARK")] = last, mark
    commit = seed(profile, month="2026-01", through="2026-01-03",
                  terms=[(s, {"price_increment": "0.01", "size_increment": "0.001"}) for s in SYMBOLS],
                  bars=bars, funding={s: [(int(t), "0.0001") for t in range(JAN - DAY, JAN + 2 * DAY, 8 * 60 * MINUTE)]
                                     for s in SYMBOLS}, members=[(date(2026, 1, 1), s) for s in SYMBOLS])
    return commit


def input_manifest(profile):
    root = Path(profile["root"])
    return {str(p.relative_to(root)): sha(p) for p in sorted(root.rglob("*.parquet"))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(generate_sources(args.repo.resolve(), args.output.resolve()), indent=2))


if __name__ == "__main__":
    main()
