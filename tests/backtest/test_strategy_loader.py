"""External strategy identity and the pinned native configuration bridge."""

import contextlib
import hashlib
import io
import importlib
import json
import tempfile
import unittest
from pathlib import Path

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.config import ImportableStrategyConfig
from nautilus_trader.model import InstrumentId
from nautilus_trader.trading import Strategy

from backtest.r1.node_strategy import STRATEGIES, NodeStrategyConfig, register_strategy
from backtest.r1.run_portfolio import (
    _source_metadata, _execution_metadata, effective_configuration, parse_configuration,
)
from backtest.r1.strategy_loader import RUNTIME_CONTRACT, load_strategy


SOURCE = '''from dataclasses import dataclass
from nautilus_trader.trading import Strategy, StrategyConfig

@dataclass
class NativeValue:
    value: int

class ProbeStrategy(Strategy):
    def __init__(self, instrument_id, bar_type, trade_size, **kwargs):
        super().__init__(StrategyConfig(strategy_id=kwargs["strategy_id"]))
        self.received = (instrument_id, bar_type, trade_size, kwargs)
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
        metadata = _source_metadata(loaded)
        self.assertNotIn("source_commit", metadata)
        self.assertEqual(metadata["strategy_source_sha256"], self.digest)
        self.assertNotIn("strategy_source_sha256", metadata["source_file_paths"])
        repo = Path(__file__).resolve().parents[2]
        for field, path in metadata["source_file_paths"].items():
            self.assertEqual(metadata[field], hashlib.sha256((repo / path).read_bytes()).hexdigest())

    def configuration(self, extra=None):
        argv = [
            "--catalog-root", "/inputs/catalog", "--daily-root", "/inputs/daily",
            "--quantity-csv", "/inputs/quantity.csv", "--coins", "BTC", "ETH",
            "--start", "2025-10-07T00:00:00Z", "--end", "2026-10-07T08:30:00Z",
            "--output", "/reports", "--strategy-file", str(self.source),
            "--strategy-class", "ProbeStrategy", "--strategy-sha256", self.digest,
        ]
        return parse_configuration(argv + (extra or []))

    def test_execution_binding_checks_resolved_defaults_and_complete_config(self):
        args = self.configuration()
        effective = effective_configuration(args)
        self.assertEqual(effective["trade_start"], args.start)
        self.assertEqual(effective["risk_budget_bps"], 25.0)
        self.assertEqual(effective["native_account"]["starting_balance_usdt"], "100000")
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
        self.assertEqual(_execution_metadata(args), {
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
            _execution_metadata(args)
        execution.write_text(json.dumps({
            **binding, "runtime_identity": {**identity, "runtime_contract": "other"},
        }))
        with self.assertRaisesRegex(ValueError, "runtime contract"):
            _execution_metadata(args)

    def test_unconverted_variants_and_changed_h19a_risk_fail_visibly(self):
        for extra in (
            ["--signal-variant", "support-three-tier-line-cancel-4h"],
            ["--exit-variant", "fixed-2r"], ["--risk-budget-bps", "26"],
        ):
            with self.subTest(extra=extra), contextlib.redirect_stderr(io.StringIO()) as errors:
                with self.assertRaises(SystemExit):
                    self.configuration(extra)
                self.assertIn("error:", errors.getvalue())

    def test_pinned_native_node_importable_bridge(self):
        loaded = self.load()
        path = register_strategy(loaded)
        config = NodeStrategyConfig(
            coin="BTC", instrument_id="BTCUSDT-PERP.BINANCE", trade_size="0.100",
            trade_start_ns=123, input_start_ns=100, strategy_id="R1-BTC",
            signal_variant="support-broad-two-tier-4h", daily_root="/unused",
            risk_budget_fraction=0.0025, max_coin_notional_fraction=0.05,
        )
        engine = BacktestEngine(BacktestEngineConfig(
            logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False),
        ))
        self.addCleanup(engine.dispose)
        STRATEGIES.clear()
        engine.add_strategy_from_config(
            ImportableStrategyConfig(
                strategy_path=path,
                config_path="backtest.r1.node_strategy:NodeStrategyConfig",
                config=config.__dict__,
            ),
        )
        strategy = STRATEGIES[config.instrument_id]
        self.assertIsInstance(strategy, loaded.strategy_class)
        self.assertEqual(strategy.received[0], InstrumentId.from_str(config.instrument_id))
        self.assertEqual(strategy.received[3]["historical_daily_bars"], [])
        self.assertEqual(strategy.received[3]["execution_bar_minutes"], 5)
        self.assertEqual(strategy.received[3]["risk_budget_fraction"], 0.0025)
        self.assertEqual(str(strategy.config.strategy_id), "R1-BTC")


if __name__ == "__main__":
    unittest.main()
