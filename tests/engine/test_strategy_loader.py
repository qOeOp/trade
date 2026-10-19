"""External strategy identity, the runner's four inputs and the native configuration bridge."""

import contextlib
import hashlib
import io
import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.config import ImportableStrategyConfig
from nautilus_trader.model import InstrumentId
from nautilus_trader.trading import Strategy

from engine.load import RUNTIME_CONTRACT, load_strategy
from engine.report import diagnostics, runtime_source_metadata
from engine import run
from engine.run import (
    STRATEGIES, StrategyInputs, effective_configuration, execution_metadata, importable_strategy,
    parse_configuration,
)


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
        self.binding = {
            "database": "research",
            "commit": "sldp6n46ejbmghcinbltf88mv53q1koq",
            "strategy_id": "R1-H19a",
            "revision": 1,
            "source_sha256": self.digest,
            "entry_class": "ProbeStrategy",
            "runtime_contract": RUNTIME_CONTRACT,
        }
        self.binding_path = self.root / "strategy.binding.json"
        self.binding_path.write_text(json.dumps(self.binding))

    def load(self, **kwargs):
        return load_strategy(
            kwargs.get("path", self.source), kwargs.get("entry_class", "ProbeStrategy"),
            kwargs.get("digest", self.digest), kwargs.get("binding_path"),
        )

    def test_verified_binding_and_native_module(self):
        loaded = self.load(binding_path=self.binding_path)
        self.assertTrue(issubclass(loaded.strategy_class, Strategy))
        self.assertIs(
            importlib.import_module(loaded.strategy_class.__module__).ProbeStrategy,
            loaded.strategy_class,
        )
        self.assertEqual(loaded.metadata()["strategy_binding"], self.binding)
        self.assertEqual(loaded.metadata()["strategy_source"]["path"], str(self.source.resolve()))

    def test_hash_rejection_happens_before_source_execution(self):
        marker = self.root / "executed"
        self.source.write_text(f"from pathlib import Path\nPath({str(marker)!r}).touch()\n")
        with self.assertRaisesRegex(ValueError, "SHA-256 differs"):
            self.load()
        self.assertFalse(marker.exists())

    def test_reject_invalid_digest_and_entry_class(self):
        for digest in ("0" * 63, "A" * 64, "../source", None):
            with self.subTest(digest=digest), self.assertRaises(ValueError):
                self.load(digest=digest)
        with self.assertRaisesRegex(ValueError, "one Python class"):
            self.load(entry_class="module.Class")

    def test_reject_source_symlink_and_directory(self):
        alias = self.root / "alias.py"
        alias.symlink_to(self.source)
        for path in (alias, self.root):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "regular file"):
                self.load(path=path)

    def test_reject_binding_mismatches_before_source_execution(self):
        for field, value in (
            ("source_sha256", "0" * 64), ("entry_class", "OtherStrategy"),
            ("runtime_contract", "other"), ("revision", True), ("database", ""),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                broken = {**self.binding, field: value}
                self.binding_path.write_text(json.dumps(broken))
                self.load(binding_path=self.binding_path)
        self.binding_path.write_text(json.dumps({**self.binding, "unexpected": 1}))
        with self.assertRaisesRegex(ValueError, "exact Dolt revision"):
            self.load(binding_path=self.binding_path)

    def test_entry_class_must_be_native_and_defined_in_source(self):
        for source in (
            "class ProbeStrategy: pass\n",
            "from nautilus_trader.trading import Strategy as ProbeStrategy\n",
        ):
            self.source.write_text(source)
            digest = hashlib.sha256(self.source.read_bytes()).hexdigest()
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, "native Strategy"):
                self.load(digest=digest)

    def test_runtime_metadata_does_not_claim_git_strategy_authority(self):
        loaded = self.load(binding_path=self.binding_path)
        metadata = {**loaded.metadata(), **runtime_source_metadata()}
        self.assertNotIn("source_commit", metadata)
        self.assertEqual(metadata["source_sha256"], self.digest)
        repo = Path(__file__).resolve().parents[2]
        for field, path in metadata["source_file_paths"].items():
            self.assertEqual(metadata[field], hashlib.sha256((repo / path).read_bytes()).hexdigest())

    def configuration(self, extra=None):
        argv = [
            "--market-root", "/inputs/market", "--market-commit", "c" * 32, "--pool", "/inputs/pool.json",
            "--symbols", "BTCUSDT", "ETHUSDT",
            "--start", "2025-10-07T00:00:00Z", "--end", "2026-10-07T08:30:00Z",
            "--output", "/reports", "--strategy-file", str(self.source),
            "--strategy-class", "ProbeStrategy", "--strategy-sha256", self.digest,
        ]
        return parse_configuration(argv + (extra or []))

    def test_execution_binding_checks_resolved_defaults_and_complete_config(self):
        args = self.configuration()
        effective = effective_configuration(args)
        self.assertEqual(effective["trade_start"], args.start)
        self.assertNotIn("risk_budget_bps", effective)
        self.assertNotIn("coin_notional_cap_pct", effective)
        self.assertEqual(set(effective), {"runtime_contract", "market_root", "market_commit", "pool", "symbols",
                                          "start", "end", "trade_start", "account"})
        self.assertEqual(effective["account"]["starting_balance_usdt"], "100000")
        identity = {
            "image_ref": "example/runtime@sha256:" + "a" * 64,
            "image_digest": "sha256:" + "a" * 64,
            "platform": "linux/arm64", "runtime_contract": RUNTIME_CONTRACT,
        }
        digest = hashlib.sha256(json.dumps(
            effective, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
            allow_nan=False,
        ).encode()).hexdigest()
        execution = self.root / "execution.json"
        binding = {
            "runtime_identity": identity, "effective_config": effective,
            "effective_config_sha256": digest,
        }
        execution.write_text(json.dumps(binding))
        args.execution_binding = execution
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
        with self.assertRaisesRegex(ValueError, "actual resolved runner"):
            execution_metadata(args)
        execution.write_text(json.dumps({
            **binding, "runtime_identity": {**identity, "runtime_contract": "other"},
        }))
        with self.assertRaisesRegex(ValueError, "runtime contract"):
            execution_metadata(args)

    def test_missing_hooks_or_invalid_warmup_declaration_are_refused_before_inputs_load(self):
        for body, message in (("    def replay_diagnostics(self):\n        return {}\n", "replay_integrity_findings"),
                              ("    DAILY_WARMUP = 'yes'\n    def replay_diagnostics(self):\n        return {}\n"
                               "    def replay_integrity_findings(self, failed=False):\n        return []\n", "DAILY_WARMUP"),
                              ("    DAILY_WARMUP = 1\n    def replay_diagnostics(self):\n        return {}\n"
                               "    def replay_integrity_findings(self, failed=False):\n        return []\n", "DAILY_WARMUP"),
                              ("    USES_STOP_LOSS = 0\n    def replay_diagnostics(self):\n        return {}\n"
                               "    def replay_integrity_findings(self, failed=False):\n        return []\n", "USES_STOP_LOSS")):
            self.source.write_text("from nautilus_trader.trading import Strategy\nclass ProbeStrategy(Strategy):\n" + body)
            digest = hashlib.sha256(self.source.read_bytes()).hexdigest()
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.load(digest=digest)

    def test_stop_loss_declaration_reaches_the_summary_identity(self):
        self.assertIs(self.load().metadata()["strategy_uses_stop_loss"], True)
        self.source.write_text(SOURCE.replace("class ProbeStrategy(Strategy):\n",
                                              "class ProbeStrategy(Strategy):\n    USES_STOP_LOSS = False\n"))
        loaded = self.load(digest=hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertIs(loaded.metadata()["strategy_uses_stop_loss"], False)

    def test_runner_takes_no_strategy_parameter(self):
        # A variant is a new source revision; the runner cannot be configured into another strategy.
        for extra in (["--signal-variant", "x"], ["--exit-variant", "x"], ["--daily-warmup"],
                      ["--risk-budget-bps", "25"], ["--coin-notional-cap-pct", "5"]):
            with self.subTest(extra=extra), contextlib.redirect_stderr(io.StringIO()) as errors:
                with self.assertRaises(SystemExit):
                    self.configuration(extra)
                self.assertIn("unrecognized arguments", errors.getvalue())

    def test_diagnostics_cannot_replace_native_facts(self):
        class InvalidDiagnostics:
            def replay_diagnostics(self):
                return {"positions": 0}
        with self.assertRaisesRegex(ValueError, "native report facts"):
            diagnostics(InvalidDiagnostics())

    def test_pinned_native_node_importable_bridge(self):
        loaded = self.load()
        path = importable_strategy(loaded)
        config = StrategyInputs(
            instrument_id="BTCUSDT-PERP.BINANCE", trade_start_ns=123, input_start_ns=100, strategy_id="R1-BTC",
            catalog_path="/unused", pool_membership=[[100, 200]],
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
        self.assertEqual(strategy.received[3]["execution_bar_minutes"], 5)
        self.assertNotIn("risk_budget_fraction", strategy.received[3])
        self.assertNotIn("max_coin_notional_fraction", strategy.received[3])
        self.assertNotIn("signal_variant", strategy.received[3])
        self.assertEqual(strategy.received[3]["pool_membership"], ((100, 200),))
        self.assertEqual(str(strategy.config.strategy_id), "R1-BTC")

    def test_native_bridge_loads_daily_warmup_the_source_declares(self):
        self.source.write_text(SOURCE.replace("class ProbeStrategy(Strategy):\n", "class ProbeStrategy(Strategy):\n    DAILY_WARMUP = True\n"))
        loaded = self.load(digest=hashlib.sha256(self.source.read_bytes()).hexdigest())
        wrapper_path = importable_strategy(loaded)
        module_name, class_name = wrapper_path.split(":")
        wrapper = getattr(importlib.import_module(module_name), class_name)
        config = StrategyInputs(
            instrument_id="BTCUSDT-PERP.BINANCE", trade_start_ns=123, input_start_ns=100, strategy_id="R1-BTC",
            catalog_path="/inputs/market/BTCUSDT", pool_membership=[],
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
                  "strategy_id": "R1-BTC", "catalog_path": "/unused", "pool_membership": []}
        engine.add_strategy_from_config(ImportableStrategyConfig(
            strategy_path=importable_strategy(loaded), config_path="engine.run:StrategyInputs", config=config))
        with self.assertRaisesRegex(RuntimeError, "boom"):
            engine.run()
        wrapper = getattr(run, importable_strategy(loaded).split(":")[1])
        with self.assertRaises(ValueError):
            wrapper(StrategyInputs(**{**config, "instrument_id": "not an instrument"}))
        written = [json.loads(line) for line in receipts.read_text().splitlines()]
        self.assertEqual(written, run.FAILURES)
        self.assertEqual([(item["stage"], item["exception_type"], item["instrument_id"]) for item in written],
                         [("on_start", "ValueError", "BTCUSDT-PERP.BINANCE"), ("constructor", "ValueError", "unconstructed")])


if __name__ == "__main__":
    unittest.main()
