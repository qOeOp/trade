"""External strategy identity, the runner's four inputs and the native configuration bridge."""

import contextlib
import hashlib
import importlib
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel, logger_flush
from nautilus_trader.config import ImportableStrategyConfig
from nautilus_trader.model import InstrumentId
from nautilus_trader.trading import Strategy

import dataclasses

from engine.config import Refusal
from engine.config import runtime_source_metadata
from engine.load import RUNTIME_CONTRACT, diagnostics, load_strategy, strategy_metadata
from engine import run
from engine.run import STRATEGIES, StrategyInputs, effective_configuration, execution_metadata, parse_configuration


@contextlib.contextmanager
def native_log():
    """Capture what the native logger writes to file descriptors 1 and 2: it is set up once per process
    by the first engine, so a later engine's LoggerConfig does not decide where (or whether) its ERROR
    lines go, and it writes from its own thread, so the capture lasts until that thread falls quiet.
    Yields a list that holds the captured text afterwards."""
    captured: list[str] = []
    sys.stdout.flush()
    sys.stderr.flush()
    saved = {fd: os.dup(fd) for fd in (1, 2)}
    with tempfile.TemporaryFile() as sink:
        for fd in saved:
            os.dup2(sink.fileno(), fd)
        try:
            yield captured
        finally:
            logger_flush()
            sizes, deadline = [-1], time.monotonic() + 5
            while time.monotonic() < deadline and sizes[-3:] != [sizes[-1]] * 3:
                time.sleep(0.05)
                sizes.append(os.fstat(sink.fileno()).st_size)
            for fd, original in saved.items():
                os.dup2(original, fd)
                os.close(original)
            sink.seek(0)
            captured.append(sink.read().decode("utf-8", "replace"))


def importable(loaded) -> str:
    """The node's path to the runner class around a loaded source."""
    return f"engine.run:{run._runner_class(loaded).__name__}"


SOURCE = '''from dataclasses import dataclass
from nautilus_trader.trading import Strategy, StrategyConfig

@dataclass
class NativeValue:
    value: int

class ProbeStrategy(Strategy):
    def replay_diagnostics(self):
        return {'signals': 1}

    def replay_integrity_findings(self, orders_denied_or_rejected=False):
        return ['native order failure'] if orders_denied_or_rejected else []

    def __init__(self, instrument_id, bar_type, **kwargs):
        super().__init__(StrategyConfig(strategy_id=kwargs["strategy_id"]))
        self.received = (instrument_id, bar_type, None, kwargs)
'''


class StrategyLoaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "strategy.py"
        self.source.write_text(SOURCE)
        self.digest = hashlib.sha256(self.source.read_bytes()).hexdigest()

    def load(self, **kwargs):
        return load_strategy(
            kwargs.get("path", self.source), kwargs.get("entry_class", "ProbeStrategy"),
            kwargs.get("digest", self.digest),
        )

    def test_verified_source_and_native_module(self):
        loaded = self.load()
        self.assertTrue(issubclass(loaded.strategy_class, Strategy))
        self.assertIs(
            importlib.import_module(loaded.strategy_class.__module__).ProbeStrategy,
            loaded.strategy_class,
        )
        self.assertEqual(strategy_metadata(loaded)["strategy_source"]["path"], str(self.source.resolve()))

    def test_hash_rejection_happens_before_source_execution(self):
        marker = self.root / "executed"
        self.source.write_text(f"from pathlib import Path\nPath({str(marker)!r}).touch()\n")
        with self.assertRaisesRegex(Refusal, "^CONTENT_HASH_MISMATCH: .*SHA-256 differs"):
            self.load()
        self.assertFalse(marker.exists())

    def test_reject_invalid_digest_and_entry_class(self):
        for digest in ("0" * 63, "A" * 64, "../source", None):
            with self.subTest(digest=digest), self.assertRaisesRegex(Refusal, "^CONTENT_HASH_INVALID: "):
                self.load(digest=digest)
        with self.assertRaisesRegex(Refusal, "^ENTRY_CLASS_INVALID: .*one Python class"):
            self.load(entry_class="module.Class")

    def test_reject_source_symlink_and_directory(self):
        alias = self.root / "alias.py"
        alias.symlink_to(self.source)
        for path in (alias, self.root):
            with self.subTest(path=path), self.assertRaisesRegex(Refusal, "^SOURCE_UNREADABLE: .*regular file"):
                self.load(path=path)

    def test_entry_class_must_be_native_and_defined_in_source(self):
        for source in (
            "class ProbeStrategy: pass\n",
            "from nautilus_trader.trading import Strategy as ProbeStrategy\n",
        ):
            self.source.write_text(source)
            digest = hashlib.sha256(self.source.read_bytes()).hexdigest()
            with self.subTest(source=source), self.assertRaisesRegex(Refusal, "^ENTRY_CLASS_INVALID: .*native Strategy"):
                self.load(digest=digest)
        self.source.write_text("raise KeyError('boom')\n")
        with self.assertRaisesRegex(Refusal, "^SOURCE_EXECUTION_FAILED: KeyError"):
            self.load(digest=hashlib.sha256(self.source.read_bytes()).hexdigest())

    def test_runtime_metadata_does_not_claim_git_strategy_authority(self):
        loaded = self.load()
        metadata = {**strategy_metadata(loaded), **runtime_source_metadata()}
        self.assertNotIn("source_commit", metadata)
        self.assertEqual(metadata["source_sha256"], self.digest)
        repo = Path(__file__).resolve().parents[2]
        for field, path in metadata["source_file_paths"].items():
            self.assertEqual(metadata[field], hashlib.sha256((repo / path).read_bytes()).hexdigest())

    def universe(self) -> Path:
        path = self.root / "membership.json"
        path.write_text('{"membership": {"BTCUSDT": [[0, 1]]}}')
        return path

    def configuration(self, extra=None):
        argv = [
            "--market-root", "/inputs/market", "--market-commit", "c" * 32, "--universe", str(self.universe()),
            "--symbols", "BTCUSDT", "ETHUSDT",
            "--start", "2025-10-07T00:00:00Z", "--end", "2026-10-07T08:30:00Z",
            "--output", "/reports", "--strategy-file", str(self.source),
            "--strategy-class", "ProbeStrategy", "--strategy-sha256", self.digest,
        ]
        return parse_configuration(argv + (extra or []))

    def test_execution_binding_checks_resolved_defaults_and_complete_config(self):
        args = self.configuration()
        resolved = effective_configuration(args)
        effective = resolved.values
        self.assertEqual(effective["trade_start"], args.window.start)
        self.assertNotIn("risk_budget_bps", effective)
        self.assertNotIn("coin_notional_cap_pct", effective)
        self.assertEqual(set(effective), {"runtime_contract", "execution_bar_minutes", "market_root", "market_commit",
                                          "universe_path", "universe_sha256", "symbols", "start", "end",
                                          "trade_start", "account"})
        self.assertEqual((effective["execution_bar_minutes"], effective["universe_sha256"]),
                         (1, hashlib.sha256(self.universe().read_bytes()).hexdigest()))
        self.assertEqual(effective["account"]["starting_balance_usdt"], "100000")
        # Host locations are not part of the digest; the universe file's bytes are.
        moved = dataclasses.replace(args, market_root=Path("/elsewhere"), universe_path=self.universe().rename(
            self.root / "moved.json"))
        self.assertEqual(effective_configuration(moved).digest, resolved.digest)
        (self.root / "moved.json").write_text('{"membership": {}}')
        self.assertNotEqual(effective_configuration(moved).digest, resolved.digest)
        missing = dataclasses.replace(args, universe_path=self.root / "absent.json")
        with self.assertRaises(Refusal) as caught:
            effective_configuration(missing)
        self.assertEqual(caught.exception.code, "UNIVERSE_FILE_UNREADABLE")
        self.universe()
        identity = {
            "image_ref": "example/runtime@sha256:" + "a" * 64,
            "image_digest": "sha256:" + "a" * 64,
            "platform": "linux/arm64", "runtime_contract": RUNTIME_CONTRACT,
        }
        digest = hashlib.sha256(json.dumps(
            {key: value for key, value in effective.items() if key not in ("market_root", "universe_path")},
            sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False,
        ).encode()).hexdigest()
        self.assertEqual(digest, resolved.digest)
        execution = self.root / "execution.json"
        binding = {
            "runtime_identity": identity, "effective_config": effective,
            "effective_config_sha256": digest,
        }
        execution.write_text(json.dumps(binding))
        args = dataclasses.replace(args, execution_binding=execution)
        self.assertEqual(execution_metadata(args), {
            "runtime_identity": identity, "effective_config_sha256": digest,
        })
        # A valid hash of another experiment must still be rejected.
        changed = {**effective, "coins": ["BTC"]}
        changed_digest = hashlib.sha256(json.dumps(
            changed, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
            allow_nan=False,
        ).encode()).hexdigest()
        execution.write_text(json.dumps({
            **binding, "effective_config": changed, "effective_config_sha256": changed_digest,
        }))
        with self.assertRaisesRegex(Refusal, "EXECUTION_BINDING_MISMATCH: .*resolved runner"):
            execution_metadata(args)
        execution.write_text(json.dumps({
            **binding, "runtime_identity": {**identity, "runtime_contract": "other"},
        }))
        with self.assertRaisesRegex(Refusal, "EXECUTION_BINDING_MISMATCH: .*runtime contract"):
            execution_metadata(args)

    def test_missing_hooks_or_invalid_warmup_declaration_are_refused_before_inputs_load(self):
        for body, message in (("    def replay_diagnostics(self):\n        return {}\n", "^HOOK_MISSING: .*replay_integrity_findings"),
                              ("    DAILY_WARMUP = 'yes'\n    def replay_diagnostics(self):\n        return {}\n"
                               "    def replay_integrity_findings(self, failed=False):\n        return []\n", "^DECLARATION_NOT_BOOL: .*DAILY_WARMUP"),
                              ("    DAILY_WARMUP = 1\n    def replay_diagnostics(self):\n        return {}\n"
                               "    def replay_integrity_findings(self, failed=False):\n        return []\n", "DAILY_WARMUP"),
                              ("    USES_STOP_LOSS = 0\n    def replay_diagnostics(self):\n        return {}\n"
                               "    def replay_integrity_findings(self, failed=False):\n        return []\n", "USES_STOP_LOSS")):
            self.source.write_text("from nautilus_trader.trading import Strategy\nclass ProbeStrategy(Strategy):\n" + body)
            digest = hashlib.sha256(self.source.read_bytes()).hexdigest()
            with self.subTest(message=message), self.assertRaisesRegex(Refusal, message):
                self.load(digest=digest)

    def test_stop_loss_declaration_reaches_the_summary_identity(self):
        self.assertIs(strategy_metadata(self.load())["strategy_uses_stop_loss"], True)
        self.source.write_text(SOURCE.replace("class ProbeStrategy(Strategy):\n",
                                              "class ProbeStrategy(Strategy):\n    USES_STOP_LOSS = False\n"))
        loaded = self.load(digest=hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertIs(strategy_metadata(loaded)["strategy_uses_stop_loss"], False)

    def test_quote_execution_declaration_needs_valid_margin_rates_and_reaches_the_identity(self):
        head = "from nautilus_trader.trading import Strategy\nclass ProbeStrategy(Strategy):\n"
        hooks = ("    def replay_diagnostics(self):\n        return {}\n"
                 "    def replay_integrity_findings(self, failed=False):\n        return []\n")
        for body, message in (("    QUOTE_EXECUTION = 1\n", "^DECLARATION_NOT_BOOL: .*QUOTE_EXECUTION"),
                              ("    QUOTE_EXECUTION = True\n", "^MARGIN_DECLARATION_INVALID: .*INITIAL_MARGIN_RATE"),
                              ("    QUOTE_EXECUTION = True\n    INITIAL_MARGIN_RATE = 0.02\n    MAINTENANCE_MARGIN_RATE = '0.01'\n",
                               "INITIAL_MARGIN_RATE"),
                              ("    QUOTE_EXECUTION = True\n    INITIAL_MARGIN_RATE = '0.02'\n    MAINTENANCE_MARGIN_RATE = '1'\n",
                               "MAINTENANCE_MARGIN_RATE"),
                              ("    QUOTE_EXECUTION = True\n    INITIAL_MARGIN_RATE = '0.01'\n    MAINTENANCE_MARGIN_RATE = '0.02'\n",
                               "must not exceed")):
            self.source.write_text(head + body + hooks)
            with self.subTest(message=message), self.assertRaisesRegex(Refusal, message):
                self.load(digest=hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.source.write_text(SOURCE)
        self.assertIs(strategy_metadata(self.load())["strategy_quote_execution"], False)
        self.assertIsNone(strategy_metadata(self.load())["strategy_margin_rates"])
        self.source.write_text(head + "    QUOTE_EXECUTION = True\n    INITIAL_MARGIN_RATE = '0.02'\n"
                               "    MAINTENANCE_MARGIN_RATE = '0.010'\n" + hooks)
        loaded = self.load(digest=hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertEqual((loaded.quote_execution, loaded.margin_rates), (True, ("0.02", "0.010")))
        self.assertEqual(strategy_metadata(loaded)["strategy_margin_rates"], ["0.02", "0.010"])

    def test_runner_takes_no_strategy_parameter(self):
        # A variant is a new source revision; the runner cannot be configured into another strategy.
        for extra in (["--signal-variant", "x"], ["--exit-variant", "x"], ["--daily-warmup"],
                      ["--risk-budget-bps", "25"], ["--coin-notional-cap-pct", "5"],
                      # an abbreviation of an option the replay entry writes itself, and the removed binding
                      ["--exec", "/x.json"], ["--strategy-binding", "/x.json"]):
            with self.subTest(extra=extra), self.assertRaises(Refusal) as caught:
                self.configuration(extra)
            self.assertEqual(caught.exception.code, "UNKNOWN_OPTION")

    def test_diagnostics_cannot_replace_native_facts(self):
        class InvalidDiagnostics:
            def replay_diagnostics(self):
                return {"positions": 0}
        with self.assertRaisesRegex(Refusal, "^DIAGNOSTICS_RESERVED_KEY: .*native report facts"):
            diagnostics(InvalidDiagnostics())

    def test_pinned_native_node_importable_bridge(self):
        loaded = self.load()
        path = importable(loaded)
        config = StrategyInputs(
            instrument_id="BTCUSDT-PERP.BINANCE", trade_start_ns=123, input_start_ns=100, strategy_id="R1-BTC",
            catalog_path="/unused", universe_membership=[[100, 200]],
        )
        engine = BacktestEngine(BacktestEngineConfig(
            logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False),
        ))
        self.addCleanup(engine.dispose)
        STRATEGIES.clear()
        engine.add_strategy_from_config(
            ImportableStrategyConfig(
                strategy_path=path,
                config_path="engine.run:StrategyInputs",
                config=config.__dict__,
            ),
        )
        strategy = STRATEGIES[config.instrument_id]
        self.assertIsInstance(strategy, loaded.strategy_class)
        self.assertEqual(strategy.received[0], InstrumentId.from_str(config.instrument_id))
        self.assertEqual(strategy.received[3]["historical_daily_bars"], [])
        self.assertEqual(strategy.received[3]["execution_bar_minutes"], 1)
        self.assertNotIn("risk_budget_fraction", strategy.received[3])
        self.assertNotIn("max_coin_notional_fraction", strategy.received[3])
        self.assertNotIn("signal_variant", strategy.received[3])
        self.assertEqual(strategy.received[3]["universe_membership"], ((100, 200),))
        self.assertEqual(str(strategy.config.strategy_id), "R1-BTC")

    def test_native_bridge_loads_daily_warmup_the_source_declares(self):
        self.source.write_text(SOURCE.replace("class ProbeStrategy(Strategy):\n", "class ProbeStrategy(Strategy):\n    DAILY_WARMUP = True\n"))
        loaded = self.load(digest=hashlib.sha256(self.source.read_bytes()).hexdigest())
        wrapper_path = importable(loaded)
        module_name, class_name = wrapper_path.split(":")
        wrapper = getattr(importlib.import_module(module_name), class_name)
        config = StrategyInputs(
            instrument_id="BTCUSDT-PERP.BINANCE", trade_start_ns=123, input_start_ns=100, strategy_id="R1-BTC",
            catalog_path="/inputs/market/BTCUSDT", universe_membership=[],
        )
        with patch("engine.run.warmup_daily_bars", return_value=["canonical warmup"]) as warmup:
            strategy = wrapper(config)
        warmup.assert_called_once_with(Path("/inputs/market/BTCUSDT"), InstrumentId.from_str(config.instrument_id), 100)
        self.assertEqual(strategy.received[3]["historical_daily_bars"], ["canonical warmup"])

    def test_a_raising_callback_or_constructor_leaves_a_structured_receipt(self):
        self.source.write_text(SOURCE + "\n    def on_start(self):\n        raise ValueError('boom')\n")
        loaded = self.load(digest=hashlib.sha256(self.source.read_bytes()).hexdigest())
        receipts = self.root / "runtime_failures.jsonl"
        run.FAILURES.clear()
        STRATEGIES.clear()
        self.addCleanup(setattr, run, "FAILURE_PATH", None)
        run.FAILURE_PATH = receipts
        engine = BacktestEngine(BacktestEngineConfig(
            logging=LoggerConfig(stdout_level=LogLevel.OFF, print_config=False),
        ))
        self.addCleanup(engine.dispose)
        config = {"instrument_id": "BTCUSDT-PERP.BINANCE", "trade_start_ns": 0, "input_start_ns": 0,
                  "strategy_id": "R1-BTC", "catalog_path": "/unused", "universe_membership": []}
        engine.add_strategy_from_config(ImportableStrategyConfig(
            strategy_path=importable(loaded), config_path="engine.run:StrategyInputs", config=config))
        with native_log() as logged, self.assertRaisesRegex(RuntimeError, "boom"):
            engine.run()
        self.assertIn("on_start failed: ValueError: boom", logged[0])
        with self.assertRaises(Refusal) as caught:
            run.configure_strategy(loaded, StrategyInputs(**{**config, "instrument_id": "not an instrument"}))
        self.assertEqual(caught.exception.code, "STRATEGY_CONSTRUCTION_FAILED")
        written = [json.loads(line) for line in receipts.read_text().splitlines()]
        self.assertEqual(written, run.FAILURES)
        self.assertEqual([(item["stage"], item["exception_type"], item["instrument_id"], item["count"], item["code"])
                          for item in written],
                         [("on_start", "ValueError", "BTCUSDT-PERP.BINANCE", 1, None),
                          ("constructor", "ValueError", "unconstructed", 1, None)])

    def test_a_failure_repeated_on_every_bar_is_one_record_with_its_count(self):
        receipts = self.root / "runtime_failures.jsonl"
        run.clear_failures()
        self.addCleanup(run.clear_failures)
        self.addCleanup(setattr, run, "FAILURE_PATH", None)
        run.FAILURE_PATH = receipts
        for _ in range(10_087):
            try:
                {}["equity"]
            except KeyError as exc:
                run.execution_failure("on_bar", exc, None)
        written = [json.loads(line) for line in receipts.read_text().splitlines()]
        self.assertEqual(len(written), 1)
        self.assertEqual((written[0]["count"], written[0]["stage"], written[0]["exception_type"]),
                         (8192, "on_bar", "KeyError"), "a killed runner leaves at least half the count")
        self.assertIn("{}[\"equity\"]", written[0]["traceback"])
        run.write_failures()  # as main does when it ends
        self.assertEqual(json.loads(receipts.read_text())["count"], 10_087)
        for number in range(run.MAX_FAILURE_RECORDS + 50):  # messages that differ every time stay bounded
            run.execution_failure("on_bar", ValueError(f"quantity {number} below the increment"), None)
        run.write_failures()
        written = [json.loads(line) for line in receipts.read_text().splitlines()]
        self.assertEqual(len(written), run.MAX_FAILURE_RECORDS + 1)
        self.assertEqual((written[-1]["stage"], written[-1]["count"]), (run.OVERFLOW_STAGE, 51))
        self.assertEqual(sum(item["count"] for item in written), 10_087 + run.MAX_FAILURE_RECORDS + 50)

    def test_a_refusal_before_the_replay_is_a_receipt_with_its_stage_and_code(self):
        output = self.root / "reports"
        argv = ["--market-root", str(self.root / "market"), "--market-commit", "c" * 32, "--symbols", "BTCUSDT",
                "--start", "2025-10-07T00:00:00Z", "--end", "2025-10-08T00:00:00Z", "--output", str(output),
                "--strategy-file", str(self.source), "--strategy-class", "ProbeStrategy"]
        self.addCleanup(run.clear_failures)
        self.addCleanup(setattr, run, "FAILURE_PATH", None)

        def receipts(*extra):
            with self.assertRaises(Refusal) as caught:
                run.main(argv + list(extra))
            return caught.exception, [json.loads(line) for line in
                                      (output / "runtime_failures.jsonl").read_text().splitlines()]

        refusal, written = receipts("--strategy-sha256", "0" * 64)
        self.assertEqual(refusal.code, "CONTENT_HASH_MISMATCH")
        self.assertEqual([(item["stage"], item["exception_type"], item["code"], item["count"]) for item in written],
                         [("load", "Refusal", "CONTENT_HASH_MISMATCH", 1)])
        binding = self.root / "execution.json"
        binding.write_text(json.dumps({"runtime_identity": {}, "effective_config": {}, "strategy_binding": {}}))
        refusal, written = receipts("--strategy-sha256", self.digest, "--execution-binding", str(binding))
        self.assertEqual((refusal.code, written[0]["stage"], written[0]["code"]),
                         ("EXECUTION_BINDING_MISMATCH", "execution_binding", "EXECUTION_BINDING_MISMATCH"))
        self.assertIn("missing effective_config_sha256; extra strategy_binding", written[0]["message"])

    def test_a_raising_clock_callback_leaves_a_receipt_though_the_engine_goes_on(self):
        from datetime import timedelta
        from decimal import Decimal
        from nautilus_trader.model import AccountType, BookType, Currency, Money, OmsType, StrategyId, TraderId, Venue
        from nautilus_trader.trading import StrategyConfig
        from tests.engine import test_partial_entry_protection as native

        class Timed(Strategy):
            def __init__(self):
                super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))

            def on_start(self):
                self.subscribe_bars(native.BAR_TYPE)
                self.clock.set_timer("tick", timedelta(minutes=5), callback=self.tick)
                self.clock.set_time_alert_ns("alert", self.clock.timestamp_ns() + 60 * 10**9, self.alert)

            def tick(self, event):
                raise ValueError("timer failed")

            def alert(self, event):
                raise KeyError("alert failed")

        run.FAILURES.clear()
        guarded = type("GuardedTimed", (Timed,), run.guarded_callbacks(Timed))
        engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(run.ACCOUNT_CONTRACT["trader_id"]),
                                                     logging=LoggerConfig(stdout_level=LogLevel.OFF)))
        self.addCleanup(engine.dispose)
        engine.add_venue(Venue("BINANCE"), OmsType.NETTING, AccountType.MARGIN, [Money(100000, Currency.from_str("USDT"))],
                         base_currency=Currency.from_str("USDT"), default_leverage=Decimal(1), book_type=BookType.L1_MBP,
                         bar_execution=True)
        engine.add_instrument(native.INSTRUMENT)
        engine.add_strategy(guarded())
        engine.add_data(native.bars())
        with native_log() as logged:
            engine.run()  # the engine logs and swallows a time event callback's exception
        self.assertIn("ValueError: timer failed", logged[0])
        stages = {(item["stage"], item["exception_type"], item["instrument_id"]) for item in run.FAILURES}
        self.assertEqual(stages, {("set_timer:tick", "ValueError", "unconstructed"),
                                  ("set_time_alert_ns:alert", "KeyError", "unconstructed")})


if __name__ == "__main__":
    unittest.main()
