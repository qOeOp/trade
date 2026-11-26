"""Accelerated Paper multi-contract soak, restart recovery, memory cap & log contract tests (#3786)."""

from __future__ import annotations

import gc
import time
import unittest
import warnings

from engine import paper_checkpoint as checkpoint
from tests.soak.harness import DEFAULT_SYMBOLS, LogContractVerifier, MemoryEnvelope, MemorySample, PaperSoakHarness


class PaperSoakTests(unittest.TestCase):
    def test_six_contract_multi_track_accelerated_soak_advances_checkpoints_within_memory_envelope(self):
        started = time.monotonic()
        with PaperSoakHarness(symbols=DEFAULT_SYMBOLS, cut_every_minutes=30) as soak:
            result = soak.run(hours=8)
            elapsed = time.monotonic() - started
            self.assertLess(elapsed, 30.0, f"accelerated soak took too long: {elapsed:.2f}s")
            self.assertEqual(len(result.symbols), 6)
            self.assertEqual(result.minutes_simulated, 480)
            for iid in soak.iids:
                self.assertEqual(result.bars_delivered[iid], 480)
                self.assertEqual(result.quotes_delivered[iid], 960)
                self.assertEqual(result.marks_accepted[iid], 480, "replay cadence keeps 1 mark/minute")
                self.assertEqual(result.funding_settlements[iid], 1, "8h soak crosses 1 funding settlement")
                self.assertEqual(result.metrics_delivered[iid], 96, "8h soak delivers 96 5m Metrics rows")

            self.assertEqual(result.attempted_cuts, 16)
            self.assertEqual(result.published_cuts, 16)
            self.assertEqual(result.deferred_reasons, [])
            self.assertIn("sources", result.last_snapshot)
            self.assertEqual(len(result.last_snapshot["sources"]), 6)

            audit = LogContractVerifier().audit(
                events_path=result.events_path,
                log_lines=result.log_lines,
                required_events=("started", "bar", "checkpoint", "stopped"),
            )
            self.assertEqual(audit.anomalies, {})
            self.assertGreaterEqual(audit.event_count, 34)

    def test_paper_soak_mid_run_restart_and_recovery_reconciles_cleanly_without_phantom_orders(self):
        with PaperSoakHarness(symbols=DEFAULT_SYMBOLS, cut_every_minutes=30) as soak:
            btc_iid = soak.iids[0]
            resting_stop = soak.make_resting_order(btc_iid, side="SELL", trigger="90000.0", order_id="O-SAFE-1")
            result = soak.run(hours=2, open_orders=[resting_stop])
            self.assertEqual(result.published_cuts, 4)

            # Outage where price stays inside [95000, 97000]: resting SELL stop at 90000 is untouched -> recovers cleanly.
            ready, refused = soak.simulate_restart_recovery(
                saved_snapshot=result.last_snapshot,
                downtime_minutes=15,
                open_orders=[resting_stop],
                downtime_low="95000.0",
                downtime_high="97000.0",
            )
            self.assertTrue(ready)
            self.assertIsNone(refused)

            # Outage where price drops to 89500: resting SELL stop at 90000 was touched -> recovery must refuse cleanly.
            ready_hit, refused_hit = soak.simulate_restart_recovery(
                saved_snapshot=result.last_snapshot,
                downtime_minutes=15,
                open_orders=[resting_stop],
                downtime_low="89500.0",
                downtime_high="97000.0",
            )
            self.assertFalse(ready_hit)
            self.assertIsNotNone(refused_hit)
            self.assertIn("O-SAFE-1", refused_hit or "")

            # Dirty checkpoint marker or corrupt truncated journal tail must fail loudly.
            checkpoint.dirty(soak.output)
            with self.assertRaises(checkpoint.Refusal):
                checkpoint.read(soak.output, "soak-4")

    def test_soak_fixture_deterministically_catches_memory_growth_checkpoint_starvation_and_log_gaps(self):
        # 1. Catch #3782-class unbounded memory growth during soak.
        with PaperSoakHarness(symbols=DEFAULT_SYMBOLS, cut_every_minutes=30, memory_growth_limit_kib=256.0) as soak:
            with self.assertRaises(AssertionError) as ctx:
                soak.run(hours=2, inject_leak_kib_per_minute=16, assert_checkpoints_advance=False, assert_memory=True)
            self.assertIn("unbounded soak heap growth", str(ctx.exception))

        # 2. Catch #3783-class silent checkpoint starvation (subscription change & user timer).
        for label, kwargs in (
            ("subscription_change", {"inject_subscription_change": True}),
            ("user_timer", {"inject_user_timer": True}),
        ):
            with self.subTest(fault=label), PaperSoakHarness(symbols=DEFAULT_SYMBOLS, cut_every_minutes=30) as soak:
                with self.assertRaises(AssertionError) as ctx:
                    soak.run(hours=2, assert_checkpoints_advance=True, **kwargs)
                self.assertIn("checkpoint starvation detected", str(ctx.exception))

                # Verify structured log anomaly detection flags the deferred checkpoint cascade.
                with self.assertRaises(AssertionError) as log_ctx:
                    LogContractVerifier().audit(
                        events_path=soak.output / "events.jsonl",
                        log_lines=soak.log_lines,
                        required_events=("started", "stopped"),
                    )
                self.assertIn("checkpoint_deferred=", str(log_ctx.exception))

        # 3. Catch silent / empty or incomplete runtime logs.
        verifier = LogContractVerifier()
        with self.assertRaises(AssertionError) as empty_ctx:
            verifier.audit(events=[], log_lines=[])
        self.assertIn("empty structured event journal", str(empty_ctx.exception))

        with self.assertRaises(AssertionError) as oom_ctx:
            verifier.audit(
                events=[{"event": "started"}, {"event": "stopped"}],
                log_lines=["ERROR container exited with OOMKilled (exit 137)"],
            )
        self.assertIn("oom=1", str(oom_ctx.exception))

    def test_six_contract_metrics_subscribed_soak_and_recovery_locks_3782_3783_3786(self):
        """End-to-end integration lock combining #3782 (512 MiB cap), #3783 (Metrics checkpoint+backfill), and #3786."""
        with PaperSoakHarness(symbols=DEFAULT_SYMBOLS, cut_every_minutes=30) as soak:
            result = soak.run(hours=8, subscribe_metrics=True)
            self.assertGreaterEqual(result.memory["container_limit_mib"], 512.0, "#3782 6-contract container budget")
            self.assertEqual(result.attempted_cuts, 16)
            self.assertEqual(result.published_cuts, 16, "#3783 runner-metrics timer must not starve checkpoints")
            self.assertEqual(result.deferred_reasons, [])

            ready, refused, delivered = soak.simulate_metrics_restart_recovery(
                saved_snapshot=result.last_snapshot,
                downtime_minutes=16,
            )
            self.assertTrue(ready)
            self.assertIsNone(refused)
            cut_ns = int(result.last_snapshot["cut_ns"])
            expected_ts = [cut_ns, cut_ns + 5 * 60 * 10**9, cut_ns + 10 * 60 * 10**9]
            for iid in soak.iids:
                self.assertEqual(delivered[iid], expected_ts, f"missed or duplicate Metrics rows for {iid}")

    def test_oom_log_contract_avoids_benign_false_positives_and_catches_real_signals(self):
        verifier = LogContractVerifier()
        events = [{"event": "started"}, {"event": "stopped"}]
        benign_lines = [
            'INFO container inspect {"OOMKilled": false, "ExitCode": 0}',
            "INFO OOMKilled=0 status=ok",
            "INFO IOC order killed (unfilled remainder cancelled)",
            "INFO healthcheck ok: Out of memory monitor active",
            "INFO old worker killed cleanly on shutdown",
        ]
        audit = verifier.audit(events=events, log_lines=benign_lines)
        self.assertEqual(audit.anomalies, {})

        for label, line in (
            ("oomkilled-true", 'ERROR container {"OOMKilled": true, "ExitCode": 137}'),
            ("memory-error", "ERROR MemoryError: unable to allocate buffer"),
            ("kernel-oom", "kernel: Out of memory: Killed process 1234 (python)"),
            ("exit-137", "ERROR runner exited with status 137"),
        ):
            with self.subTest(signal=label), self.assertRaises(AssertionError) as ctx:
                verifier.audit(events=events, log_lines=[line])
            self.assertIn("oom=1", str(ctx.exception))

    def test_memory_envelope_enforces_max_rss_and_optional_container_cap(self):
        env = MemoryEnvelope(max_growth_kib=4096.0, max_rss_mib=512.0)
        env.samples = [
            MemorySample(step=0, current_kib=100.0, peak_kib=100.0, rss_mib=600.0),
            MemorySample(step=1, current_kib=110.0, peak_kib=110.0, rss_mib=600.0),
        ]
        with self.assertRaises(AssertionError) as ctx:
            env.assert_within_budget(contracts=6)
        self.assertIn("process RSS exceeded soak ceiling", str(ctx.exception))

        # Above container_limit_mib but below max_rss_mib: passes by default, fails with enforce_container_cap=True.
        env_cap = MemoryEnvelope(max_growth_kib=4096.0, max_rss_mib=4096.0)
        env_cap.samples = [
            MemorySample(step=0, current_kib=100.0, peak_kib=100.0, rss_mib=1024.0),
            MemorySample(step=1, current_kib=110.0, peak_kib=110.0, rss_mib=1024.0),
        ]
        stats = env_cap.assert_within_budget(contracts=6)
        self.assertGreater(stats["peak_rss_mib"], stats["container_limit_mib"])
        with self.assertRaises(AssertionError) as cap_ctx:
            env_cap.assert_within_budget(contracts=6, enforce_container_cap=True)
        self.assertIn("process RSS exceeded soak ceiling", str(cap_ctx.exception))

    def test_paper_soak_harness_closes_journal_on_exception_without_resource_warning(self):
        bad_syms = {"BADUSDT": {"price": "0.0", "tick": "0.10", "step": "1", "min_notional": "10"}}
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always", ResourceWarning)
            with PaperSoakHarness(symbols=bad_syms, cut_every_minutes=30) as soak:
                with self.assertRaises(AssertionError):
                    soak.run(hours=1)
            gc.collect()
        resource_warnings = [str(w.message) for w in caught if issubclass(w.category, ResourceWarning)]
        self.assertEqual(resource_warnings, [])


if __name__ == "__main__":
    unittest.main()
