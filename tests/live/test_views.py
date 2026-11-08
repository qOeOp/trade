"""Only retained synthetic facts reach the browser; polling performs no lifecycle action."""
import json
from unittest.mock import patch

from live import runs, state, views
from tests.live.test_runs import LiveFixture


class LiveViewTests(LiveFixture):
    def setUp(self):
        super().setUp()
        with state.serialized(self.root):
            pass
        state.append(self.directory / "lifecycle.jsonl", "prepared", self.run_id)
        state.write_new(self.root / "account.jsonl", b"")
        state.write_new(self.directory / "out" / "events.jsonl", b"")
        self.calls = []
        docker = patch.object(runs, "_docker", side_effect=self.docker_view({}, self.calls))
        docker.start()
        self.addCleanup(docker.stop)
        for name in ("status", "stop", "launch", "_credentials", "_release_if_resolved", "_recycle"):
            guarded = patch.object(runs, name, side_effect=AssertionError("projection invoked " + name))
            guarded.start()
            self.addCleanup(guarded.stop)

    def files(self):
        return {str(path.relative_to(self.root)): (path.stat().st_mode, path.stat().st_mtime_ns, path.read_bytes())
                for path in self.root.rglob("*") if path.is_file()}

    def native(self, event, **fields):
        state.append(self.directory / "out" / "events.jsonl", event, self.run_id, **fields)

    def account(self, event="preflight", filename="preflight-123.json", **changes):
        payload = {"observed_ns": 123, "credential_binding": self.manifest["credential_binding"],
                   "config": {"canTrade": True, "dualSidePosition": True, "multiAssetsMargin": True},
                   "account": {"assets": [{"asset": "USDT", "walletBalance": "100.12345678",
                                           "availableBalance": "90.12000000"}]},
                   "positions": [], "orders": [], "algo_orders": []}
        payload.update(changes)
        state.write_new(self.directory / "out" / filename, state.encode(payload))
        self.native(event, observation=filename)
        return self.directory / "out" / filename

    def test_safe_whitelist_and_read_does_not_change_any_file(self):
        self.manifest["config"].update(budget_usdt="100", max_notional_per_order="90", max_loss_usdt="5",
                                       duration_seconds=8100, proxy_url="https://SECRET_PROXY", secret="SECRET_CONFIG")
        self.manifest["source"]["secret"] = "SECRET_SOURCE"
        (self.directory / "inputs" / "manifest.json").write_bytes(state.encode(self.manifest))
        self.account(reason="SECRET_ACCOUNT")
        self.native("source_shutdown", source_reason="SECRET_REASON")
        self.native("order", reason="SECRET_OUTER", native={"type": "OrderAccepted", "client_order_id": "cid-1",
                    "instrument_id": "BTCUSDT-PERP.BINANCE", "ts_event": 1794000000000000001,
                    "reason": "SECRET_REASON", "tags": ["SECRET_TAG"], "account_id": "SECRET_ACCOUNT_ID",
                    "trader_id": "SECRET_TRADER", "unknown": {"api_key": "SECRET_KEY"}})
        before = self.files()
        result = views.run_view(self.root, self.run_id)
        text = json.dumps(result)
        self.assertNotIn("SECRET", text)
        self.assertNotIn(str(self.root), text)
        self.assertNotIn(self.manifest["credential_binding"], text)
        self.assertEqual(result["runtime"]["digest"], "sha256:" + "a" * 64)
        self.assertEqual(result["config"]["duration_seconds"], "8100")
        self.assertEqual(result["orders"][0]["ts_event"], "1794000000000000001")
        self.assertEqual(result["account"]["usdt_wallet"], "100.12345678")
        self.assertEqual(before, self.files())
        self.assertTrue(all(len(call) == 3 and call[1] == "inspect" for call in self.calls))

    def test_minute_results_keep_journal_order_and_unknowns_and_drop_damaged_rows(self):
        self.native("minute_result", minute_ns=60_000_000_000, result="-2.50000000")
        self.native("minute_result", minute_ns=120_000_000_000, result=None)
        self.native("minute_result", minute_ns="SECRET", result="1")
        self.native("minute_result", minute_ns=180_000_000_000, result="SECRET_TEXT")
        self.native("socket_state", state="CONNECTED")
        result = views.run_view(self.root, self.run_id)
        self.assertEqual(result["minute_results"], [["60000000000", "-2.50000000"], ["120000000000", None],
                                                    ["180000000000", None]])
        self.assertNotIn("SECRET", json.dumps(result))

    def test_missing_native_and_account_are_unknown_not_zero_or_flat(self):
        (self.directory / "out" / "events.jsonl").unlink()
        result = views.run_view(self.root, self.run_id)
        self.assertIsNone(result["account"])
        self.assertIsNone(result["orders"])
        self.assertIsNone(result["positions"])
        self.assertIsNone(result["minute_results"])
        self.assertIsNone(result["terminal"])
        self.assertFalse(result["complete"])
        self.assertEqual(next(row for row in result["evidence"] if row["source"] == "native")["state"], "missing")

    def test_partial_fill_is_only_an_event_and_never_a_filled_order_or_position(self):
        self.native("order", native={"type": "OrderFilled", "client_order_id": "entry-1", "order_side": "BUY",
                                     "last_qty": "0.001", "last_px": "70000.00", "quantity": "0.003",
                                     "status": "FILLED", "ts_event": 123})
        result = views.run_view(self.root, self.run_id)
        order = result["orders"][0]
        self.assertEqual(order["event_type"], "OrderFilled")
        self.assertEqual(order["last_qty"], "0.001")
        self.assertNotIn("status", order)
        self.assertEqual(result["positions"], [])  # no position events, not a zero position
        self.assertIsNone(result["account"])

    def test_position_rows_preserve_native_quantity_without_aggregation(self):
        self.native("position", native={"type": "PositionOpened", "position_id": "position-1", "side": "LONG",
                                        "quantity": "0.003", "signed_qty": 0.003, "ts_opened": 123})
        self.native("position", native={"type": "PositionChanged", "position_id": "position-1", "side": "LONG",
                                        "quantity": "0.002", "signed_qty": 0.002, "ts_event": 124})
        result = views.run_view(self.root, self.run_id)
        self.assertEqual([row["quantity"] for row in result["positions"]], ["0.003", "0.002"])
        self.assertNotIn("position_quantity", result)

    def test_malformed_tail_hides_even_preceding_terminal_and_fills(self):
        self.account(event="clean_stop", filename="final-account-123.json")
        self.native("order", native={"type": "OrderFilled", "last_qty": "0.001"})
        with (self.directory / "out" / "events.jsonl").open("ab") as stream:
            stream.write(b'{"event":"unresolved"')
        before = self.files()
        result = views.run_view(self.root, self.run_id)
        for key in ("terminal", "orders", "positions", "account"):
            self.assertIsNone(result[key])
        self.assertFalse(result["complete"])
        self.assertEqual(before, self.files())

    def test_native_change_between_reads_is_unknown(self):
        self.account(event="clean_stop", filename="final-account-123.json")
        original = views._sample
        reads = []

        def sample(path, source, **kwargs):
            value = original(path, source, **kwargs)
            if source == "native" and not reads:
                reads.append(source)
                self.native("unresolved", reason="SECRET_RACE")
            return value

        with patch.object(views, "_sample", side_effect=sample):
            result = views.run_view(self.root, self.run_id)
        self.assertIsNone(result["terminal"])
        self.assertIsNone(result["account"])
        self.assertIsNone(result["orders"])
        self.assertIsNone(result["host"]["state"])
        self.assertEqual(next(row for row in result["evidence"] if row["source"] == "native")["state"], "changed")

    def test_account_change_between_reads_is_unknown(self):
        path = self.account()
        original = views._sample
        reads = []

        def sample(target, source, **kwargs):
            value = original(target, source, **kwargs)
            if source == "account_observation" and not reads:
                reads.append(source)
                path.write_bytes(state.encode({"observed_ns": 124}))
            return value

        with patch.object(views, "_sample", side_effect=sample):
            result = views.run_view(self.root, self.run_id)
        self.assertIsNone(result["account"])
        self.assertEqual(next(row for row in result["evidence"] if row["source"] == "account_observation")["state"], "changed")

    def test_observation_cannot_name_a_credential_or_follow_a_symlink(self):
        self.native("preflight", observation="../../credentials.json")
        result = views.run_view(self.root, self.run_id)
        self.assertIsNone(result["account"])
        (self.directory / "out" / "preflight-123.json").symlink_to(self.credentials)
        self.native("preflight", observation="preflight-123.json")
        result = views.run_view(self.root, self.run_id)
        self.assertIsNone(result["account"])
        self.assertNotIn("example-key", json.dumps(result))

    def test_terminal_release_and_archive_remain_independent(self):
        self.launch_record()
        self.account(event="clean_stop", filename="final-account-123.json")
        result = views.run_view(self.root, self.run_id)
        self.assertEqual(result["terminal"]["event"], "clean_stop")
        self.assertTrue(result["host"]["account_owned"])
        self.assertFalse(result["custody"]["released"])
        self.assertFalse(result["custody"]["archived"])
        self.assertTrue(result["account"]["venue_flat"])
        state.append(self.root / "account.jsonl", "released", self.run_id, reason="native_and_venue_flat")
        state.append(self.directory / "lifecycle.jsonl", "recycled", self.run_id, state="clean_stopped", exit_code=0)
        result = views.run_view(self.root, self.run_id)
        self.assertTrue(result["custody"]["released"])
        self.assertTrue(result["custody"]["archived"])
        self.assertFalse(result["host"]["account_owned"])

    def test_prior_terminal_and_archive_do_not_describe_a_later_launch(self):
        self.account(event="clean_stop", filename="final-account-123.json")
        state.append(self.directory / "lifecycle.jsonl", "recycled", self.run_id, state="clean_stopped", exit_code=0)
        self.launch_record(mode="reconcile")
        result = views.run_view(self.root, self.run_id)
        self.assertIsNone(result["terminal"])
        self.assertFalse(result["custody"]["archived"])
        self.assertIsNone(result["account"]["venue_flat"])

    def test_venue_flat_at_reconcile_start_or_end_is_observed_without_releasing_custody(self):
        self.launch_record(mode="reconcile")
        for prefix in ("preflight", "final-account"):
            with self.subTest(prefix=prefix):
                self.account(event="venue_flat", filename=f"{prefix}-123.json")
                before = self.files()
                result = views.run_view(self.root, self.run_id)
                self.assertEqual(result["terminal"]["event"], "venue_flat")
                self.assertIsNone(result["terminal"]["source_failed"])
                self.assertTrue(result["account"]["venue_flat"])
                self.assertTrue(result["host"]["account_owned"])
                self.assertFalse(result["custody"]["released"])
                self.assertFalse(result["custody"]["archived"])
                self.assertEqual(before, self.files())

    def test_venue_flat_release_and_archive_preserve_their_distinct_reason(self):
        self.launch_record(mode="reconcile")
        self.account(event="venue_flat", filename="final-account-123.json")
        state.append(self.root / "account.jsonl", "released", self.run_id, reason="venue_flat")
        state.append(self.directory / "lifecycle.jsonl", "recycled", self.run_id, state="venue_flat", exit_code=0)
        before = self.files()
        result = views.run_view(self.root, self.run_id)
        self.assertEqual(result["host"]["state"], "venue_flat")
        self.assertFalse(result["host"]["account_owned"])
        self.assertEqual(result["custody"], {"released": True, "release_reason": "venue_flat", "archived": True})
        self.assertEqual(before, self.files())

    def test_venue_flat_keeps_observation_binding_and_timestamp_checks_for_both_prefixes(self):
        self.launch_record(mode="reconcile")
        for prefix in ("preflight", "final-account"):
            with self.subTest(prefix=prefix):
                path = self.account(event="venue_flat", filename=f"{prefix}-123.json", credential_binding="f" * 64)
                self.assertIsNone(views.run_view(self.root, self.run_id)["account"])
                payload = json.loads(path.read_text())
                payload.update(credential_binding=self.manifest["credential_binding"], observed_ns=124)
                path.write_bytes(state.encode(payload))
                self.assertIsNone(views.run_view(self.root, self.run_id)["account"])
                payload["observed_ns"] = 123
                path.write_bytes(state.encode(payload))
                self.assertTrue(views.run_view(self.root, self.run_id)["account"]["venue_flat"])

    def test_venue_flat_cannot_adopt_other_observation_purposes(self):
        for prefix in ("connected-account", "entry-account"):
            with self.subTest(prefix=prefix):
                self.account(event="venue_flat", filename=f"{prefix}-123.json")
                result = views.run_view(self.root, self.run_id)
                self.assertIsNone(result["account"])
                evidence = next(row for row in result["evidence"] if row["source"] == "account_observation")
                self.assertEqual(evidence["state"], "invalid")

    def test_venue_flat_before_the_latest_launch_does_not_assert_a_current_terminal_or_flat_account(self):
        self.account(event="venue_flat", filename="preflight-123.json")
        self.launch_record(mode="reconcile")
        result = views.run_view(self.root, self.run_id)
        self.assertIsNone(result["terminal"])
        self.assertIsNone(result["account"]["venue_flat"])
        self.assertTrue(result["host"]["account_owned"])

    def test_saved_preflight_empty_lists_are_not_a_venue_flat_assertion(self):
        self.account()
        result = views.run_view(self.root, self.run_id)
        self.assertIsNone(result["account"]["venue_flat"])

    def test_malformed_custody_does_not_claim_released_or_unowned(self):
        (self.root / "account.jsonl").write_bytes(b'{"event":"released"')
        result = views.run_view(self.root, self.run_id)
        self.assertIsNone(result["host"]["account_owned"])
        self.assertIsNone(result["custody"]["released"])

    def test_native_other_run_is_not_adopted(self):
        state.append(self.directory / "out" / "events.jsonl", "clean_stop", "foreign-run")
        result = views.run_view(self.root, self.run_id)
        self.assertIsNone(result["terminal"])
        self.assertIsNone(result["orders"])
        self.assertFalse(result["complete"])

    def test_empty_numeric_or_unknown_enum_cannot_leak_free_text(self):
        self.native("order", native={"type": "OrderFilled", "last_px": "SECRET_AMOUNT", "last_qty": "NaN",
                                     "order_side": "SECRET_SIDE", "ts_event": "SECRET_TIME",
                                     "venue_order_id": "/SECRET/PATH"})
        result = views.run_view(self.root, self.run_id)
        self.assertNotIn("SECRET", json.dumps(result))
        self.assertIsNone(result["orders"][0]["last_qty"])

    def test_foreign_observation_binding_and_wrong_purpose_are_unknown(self):
        path = self.account(credential_binding="f" * 64)
        self.assertIsNone(views.run_view(self.root, self.run_id)["account"])
        payload = json.loads(path.read_text())
        payload["credential_binding"] = self.manifest["credential_binding"]
        path.write_bytes(state.encode(payload))
        self.native("clean_stop", observation=path.name)
        self.assertIsNone(views.run_view(self.root, self.run_id)["account"])

    def test_structurally_malformed_native_values_do_not_raise_or_leak(self):
        self.native("order", native={"type": {"secret": "SECRET"}})
        result = views.run_view(self.root, self.run_id)
        self.assertEqual(result["orders"], [])
        self.assertNotIn("SECRET", json.dumps(result))
        path = self.directory / "out" / "events.jsonl"
        path.write_bytes(state.encode({"event": {"secret": "SECRET"}, "run_id": self.run_id, "observed_ns": 1}))
        result = views.run_view(self.root, self.run_id)
        self.assertIsNone(result["orders"])
        self.assertNotIn("SECRET", json.dumps(result))

    def test_stop_file_before_journal_append_is_already_an_intent_without_reading_its_body(self):
        state.write_new(self.directory / "out" / "STOP", b"SECRET_BODY_NOT_READ")
        before = self.files()
        result = views.run_view(self.root, self.run_id)
        self.assertTrue(result["stop_requested"])
        self.assertNotIn("SECRET", json.dumps(result))
        self.assertEqual(before, self.files())
        self.assertEqual(next(row for row in result["evidence"] if row["source"] == "stop_intent")["state"], "complete")

    def test_stop_symlink_is_unknown_and_never_read(self):
        (self.directory / "out" / "STOP").symlink_to(self.credentials)
        result = views.run_view(self.root, self.run_id)
        self.assertIsNone(result["stop_requested"])
        self.assertNotIn("example-secret", json.dumps(result))

    def test_prepared_without_custody_or_native_journal_keeps_host_state(self):
        (self.root / "account.jsonl").unlink()
        (self.directory / "out" / "events.jsonl").unlink()
        before = self.files()
        self.assertEqual(runs.observe(self.root, self.run_id)["state"], "prepared")
        result = views.run_view(self.root, self.run_id)
        self.assertEqual(result["host"]["state"], "prepared")
        self.assertIsNone(result["host"]["account_owned"])
        self.assertIsNone(result["account"])
        self.assertIsNone(result["terminal"])
        self.assertFalse(result["complete"])
        evidence = {row["source"]: row for row in result["evidence"]}
        self.assertTrue(evidence["host"]["complete"])
        self.assertEqual(evidence["custody"]["state"], "missing")
        self.assertEqual(evidence["native"]["state"], "missing")
        self.assertEqual(before, self.files())

    def test_launched_without_native_keeps_running_or_unresolved_not_clean(self):
        self.launch_record()
        (self.directory / "out" / "events.jsonl").unlink()
        before = self.files()
        for running, expected in ((True, "running"), (False, "unresolved")):
            with self.subTest(running=running), patch.object(
                    runs, "_docker", side_effect=self.docker_view(self.inspected(running=running), [])):
                self.assertEqual(runs.observe(self.root, self.run_id)["state"], expected)
                result = views.run_view(self.root, self.run_id)
            self.assertEqual(result["host"]["state"], expected)
            self.assertTrue(result["host"]["account_owned"])
            self.assertIsNone(result["terminal"])
            self.assertIsNone(result["account"])
            self.assertFalse(result["complete"])
        self.assertEqual(before, self.files())

    def test_missing_runner_and_native_remain_unresolved(self):
        self.launch_record()
        (self.directory / "out" / "events.jsonl").unlink()
        before = self.files()
        result = views.run_view(self.root, self.run_id)
        self.assertEqual(result["host"]["state"], "unresolved")
        self.assertTrue(result["host"]["account_owned"])
        self.assertFalse(result["custody"]["released"])
        self.assertIsNone(result["terminal"])
        self.assertIsNone(result["account"])
        self.assertFalse(result["complete"])
        self.assertEqual(before, self.files())

    def test_retained_release_and_archive_explain_host_without_native(self):
        self.launch_record()
        state.append(self.root / "account.jsonl", "released", self.run_id, reason="native_and_venue_flat")
        state.append(self.directory / "lifecycle.jsonl", "recycled", self.run_id, state="clean_stopped", exit_code=0)
        (self.directory / "out" / "events.jsonl").unlink()
        before = self.files()
        with patch.object(runs, "_docker", side_effect=AssertionError("archived resources inspected")):
            result = views.run_view(self.root, self.run_id)
        self.assertEqual(result["host"]["state"], "clean_stopped")
        self.assertFalse(result["host"]["account_owned"])
        self.assertTrue(result["custody"]["released"])
        self.assertTrue(result["custody"]["archived"])
        self.assertIsNone(result["terminal"])
        self.assertIsNone(result["account"])
        self.assertFalse(result["complete"])
        self.assertEqual(before, self.files())

    def test_native_appearing_between_reads_is_changed_not_stable_missing(self):
        (self.directory / "out" / "events.jsonl").unlink()
        original = views._sample
        reads = []

        def sample(path, source, **kwargs):
            value = original(path, source, **kwargs)
            if source == "native" and not reads:
                reads.append(source)
                self.assertEqual(value.status, "missing")
                self.native("unresolved", reason="SECRET_RACE")
            return value

        with patch.object(views, "_sample", side_effect=sample):
            result = views.run_view(self.root, self.run_id)
        self.assertIsNone(result["host"]["state"])
        self.assertIsNone(result["terminal"])
        self.assertIsNone(result["account"])
        self.assertIsNone(result["orders"])
        self.assertFalse(result["complete"])
        self.assertNotIn("SECRET", json.dumps(result))
        evidence = {row["source"]: row for row in result["evidence"]}
        self.assertEqual(evidence["native"]["state"], "changed")
        self.assertEqual(evidence["host"]["state"], "unknown")
