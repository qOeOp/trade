"""Transport/cache acceptance against the unchanged input identity, without a client market DB."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from unittest.mock import patch

from ledger.errors import Refusal
from market import remote
from registration import inputs, seams
from tests.ledger.dolt import MARKET_COMMIT
from tests.registration.world import FakeMarket, LINE_WINDOW, months_rows
from tests.market.dolt import BINARY, SKIP, TemporaryMarket, seed


@contextmanager
def supply_exporter(value: str):
    """Another exporter on the supply only: its request threads see `value`, the client (main thread) its own."""
    from market import export
    real = export.exporter_sha256
    def seen():
        return real() if threading.current_thread() is threading.main_thread() else value
    with patch("market.remote.exporter_sha256", side_effect=seen), patch("market.export.exporter_sha256", side_effect=seen):
        yield


class RemoteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="supply-test-", dir="/tmp"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.market = FakeMarket({MARKET_COMMIT: months_rows(), "e" * 32: months_rows(symbols=["OTHERUSDT"])})
        self.supply = remote.Supply(self.market)
        self.server = remote.Server(("127.0.0.1", 0), self.supply)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.profile = {"kind": "market", "database": "market", "remote_url": f"http://127.0.0.1:{self.server.server_port}",
                        "cache_root": str(self.tmp / "cache")}
        self.client = remote.RemoteMarket(self.profile)

    def exported(self, fresh=False, **overrides):
        args = dict(commit=MARKET_COMMIT, symbols=["AAAUSDT"], start_ns=LINE_WINDOW["start"],
                    end_ns=LINE_WINDOW["end"], episodes=None, lifecycle_files=None, fresh=fresh, include_quotes=False)
        result = self.client.export_catalogs(**(args | overrides))
        self.addCleanup(shutil.rmtree, result["root"], True)
        return result

    def test_remote_is_selected_without_local_service_and_preserves_input_identity(self):
        self.assertIsInstance(seams.DEFAULT.market(self.profile), remote.RemoteMarket)
        local = inputs.market_inputs(self.market, MARKET_COMMIT, LINE_WINDOW, {"symbols": ["AAAUSDT"]}, None, True)
        served = inputs.market_inputs(self.profile, MARKET_COMMIT, LINE_WINDOW, {"symbols": ["AAAUSDT"]}, None, True)
        self.addCleanup(inputs.cleanup, local)
        self.addCleanup(inputs.cleanup, served)
        self.assertEqual(local["identity"], served["identity"])
        self.assertEqual(list(Path(served["root"]).iterdir())[0].name, "AAAUSDT")
        inputs.cleanup(served)
        self.assertFalse(Path(served["root"]).exists())
        self.assertTrue((self.tmp / "cache" / "objects").is_dir())

    def test_fresh_always_reexports_but_transfers_nothing_for_unchanged_content(self):
        first = self.exported(True)
        cold = self.client.transferred_bytes
        before = self.market.exports
        second = self.exported(True)
        self.assertEqual(self.market.exports, before + 1)
        self.assertEqual(self.client.transferred_bytes, cold)  # the receipt holds no export time: every object is cached
        membership = self.tmp / "membership.json"
        membership.write_text("{}")
        self.assertEqual(inputs.export_fingerprint({**first, "membership_file": membership}, semantic=True),
                         inputs.export_fingerprint({**second, "membership_file": membership}, semantic=True))
        with patch.object(self.client, "_rpc", side_effect=AssertionError("nonfresh cache export should be offline")):
            self.exported(False)
        self.assertEqual(self.client.transferred_bytes, cold)

    def test_cached_object_corruption_is_never_accepted_and_transfer_resumes_a_prefix(self):
        data = b"verified market data" * 100
        sha = hashlib.sha256(data).hexdigest()
        source = self.tmp / "object"
        source.write_bytes(data)
        self.supply.objects[sha] = source
        objects = self.tmp / "cache/objects"
        objects.mkdir(parents=True)
        (objects / (sha + ".partial")).write_bytes(data[:71])
        result = self.client._object({"sha256": sha, "size": len(data)})
        self.assertEqual(result.read_bytes(), data)
        self.assertEqual(self.client.transferred_bytes, len(data) - 71)
        result.write_bytes(b"damaged")
        source.write_bytes(b"wrong" + data[5:])
        with self.assertRaises(Refusal) as caught:
            self.client._object({"sha256": sha, "size": len(data)})
        self.assertEqual(caught.exception.code, "MARKET_REMOTE_INVALID")
        self.assertEqual(result.read_bytes(), b"damaged")

    def test_manifest_cannot_escape_or_change_commit_window_or_scope(self):
        self.exported()
        manifest = json.loads(next((self.tmp / "cache/requests").glob("*.json")).read_bytes())
        mutations = [lambda m: m["files"][0].update(path="../escape"),
                     lambda m: m["files"].append(m["files"][0]),
                     lambda m: m["files"][0].update(path="OTHERUSDT/data"),
                     lambda m: m.update(commit="e" * 32),
                     lambda m: m["receipts"]["AAAUSDT"].update(end_ns=0)]
        for mutate in mutations:
            broken = deepcopy(manifest)
            mutate(broken)
            with self.subTest(mutate=mutate), self.assertRaises(Refusal):
                remote.RemoteMarket._validate_manifest(broken, manifest["request"])

    def test_shared_server_cache_does_not_supply_unrequested_contracts(self):
        real = self.market.export_catalogs
        def shared(*args, **kwargs):
            done = real(*args, **kwargs)
            other = Path(done["root"]) / "OTHERUSDT"
            other.mkdir()
            (other / "old-data.parquet").write_bytes(b"unrequested cache contents")
            return done
        with patch.object(self.market, "export_catalogs", side_effect=shared):
            found = self.exported()
        self.assertEqual({p.name for p in found["root"].iterdir()}, {"AAAUSDT"})

    def test_trade_ticks_and_metrics_are_separate_requests_and_booleans(self):
        with patch.object(self.market, "export_catalogs", wraps=self.market.export_catalogs) as export:
            self.exported()
            self.exported(include_trades=True)
            self.exported(include_metrics=True)
        self.assertEqual([(call.kwargs["include_trades"], call.kwargs["include_metrics"])
                          for call in export.call_args_list], [(False, False), (True, False), (False, True)])
        for name in ("include_trades", "include_metrics"):
            request = {"protocol": remote.PROTOCOL, "database": "market",
                       "method": "export_catalogs", "args": {"commit": MARKET_COMMIT, "symbols": ["AAAUSDT"],
                                                             "start_ns": LINE_WINDOW["start"],
                                                             "end_ns": LINE_WINDOW["end"], "episodes": None,
                                                             "lifecycle_files": {}, "fresh": False,
                                                             "include_quotes": False, "include_trades": False,
                                                             "include_metrics": False, name: 1}}
            with self.subTest(name=name), self.assertRaises(Refusal) as caught:
                self.supply.call(request)
            self.assertIn("export mode", caught.exception.message)

    def test_interrupted_transfer_keeps_only_an_unaccepted_prefix_then_resumes(self):
        data = b"x" * (remote.BLOCK*2 + 57)
        sha = hashlib.sha256(data).hexdigest()
        source = self.tmp / "large-object"
        source.write_bytes(data)
        self.supply.objects[sha] = source
        def interrupted(handler):
            handler.send_response(206)
            handler.send_header("Content-Length", str(len(data)))
            handler.send_header("Content-Range", f"bytes 0-{len(data)-1}/{len(data)}")
            handler.end_headers()
            handler.wfile.write(data[:remote.BLOCK])
            handler.wfile.flush()
            handler.close_connection = True
        with patch.object(remote.Handler, "do_GET", interrupted), self.assertRaises(Refusal):
            self.client._object({"sha256": sha, "size": len(data)})
        objects = self.tmp / "cache/objects"
        self.assertFalse((objects / sha).exists())
        self.assertFalse((self.tmp / "cache/requests").exists())
        self.assertEqual((objects / (sha + ".partial")).stat().st_size, remote.BLOCK)
        found = self.client._object({"sha256": sha, "size": len(data)})
        self.assertEqual(found.read_bytes(), data)

    def test_no_sql_write_arbitrary_file_or_latest_fallback(self):
        with self.assertRaises(Refusal) as caught:
            self.client.resolve_commit("missing-commit")
        self.assertEqual(caught.exception.code, "MARKET_COMMIT_UNRESOLVED")
        for method, args in [("execute", {"sql": "DROP TABLE bar"}), ("universe_rule", {"commit": "main"}),
                             ("export_catalogs", {"path": "/etc/passwd"})]:
            with self.subTest(method=method), self.assertRaises(Refusal):
                self.client._rpc(method, **args)

    def test_another_protocol_or_database_is_refused_naming_the_field_both_values_and_the_exits(self):
        other = remote.RemoteMarket({**self.profile, "database": "other"})
        with self.assertRaises(Refusal) as database:
            other.resolve_commit(MARKET_COMMIT)  # refused by the supply, carried over HTTP
        older = {"protocol": "market-supply-v1", "database": "market", "exporter": "y" * 64,
                 "method": "resolve_commit", "args": {"at": MARKET_COMMIT}}
        with self.assertRaises(Refusal) as protocol:
            self.supply.call(older)
        for refusal, field, sent, served in ((database.exception, "database", "other", "market"),
                                             (protocol.exception, "protocol", "market-supply-v1", remote.PROTOCOL)):
            with self.subTest(field=field):
                self.assertEqual((refusal.code, refusal.missing, refusal.expected),
                                 ("MARKET_REMOTE_INVALID", (field,), served))
                self.assertIn(repr(sent), refusal.message)
                self.assertIn(repr(served), refusal.message)
                self.assertTrue(any("market-supply" in action and "--market" in action
                                    for action in refusal.next_actions))

    def test_a_supply_exporter_that_writes_the_same_bytes_serves_comparable_inputs(self):
        """An exporter edit that leaves the exported bytes unchanged refuses nothing: the content
        identity is the local one, and the supply's exporter hash is what the identity records."""
        from registration import comparability
        selection = {"symbols": ["AAAUSDT"]}
        local = inputs.market_inputs(self.market, MARKET_COMMIT, LINE_WINDOW, selection, None, True)
        self.addCleanup(inputs.cleanup, local)
        with supply_exporter("5" * 64):
            served = inputs.market_inputs(self.profile, MARKET_COMMIT, LINE_WINDOW, selection, None, True)
        self.addCleanup(inputs.cleanup, served)
        self.assertEqual(served["identity"]["exporter_source_sha256"], "5" * 64)
        self.assertNotEqual(local["identity"]["exporter_source_sha256"], "5" * 64)
        self.assertEqual(served["identity"]["export_content_sha256"], local["identity"]["export_content_sha256"])
        self.assertEqual(comparability.input_key(served["identity"]), comparability.input_key(local["identity"]))

    def test_a_supply_exporter_that_writes_other_bytes_gives_another_input_identity(self):
        from registration import comparability
        selection = {"symbols": ["AAAUSDT"]}
        local = inputs.market_inputs(self.market, MARKET_COMMIT, LINE_WINDOW, selection, None, True)
        self.addCleanup(inputs.cleanup, local)
        real = self.market.export_catalogs
        def changed(*args, **kwargs):
            done = real(*args, **kwargs)
            (Path(done["root"]) / "AAAUSDT/bars.parquet").write_bytes(b"another exporter's bytes")
            return done
        with supply_exporter("6" * 64), patch.object(self.market, "export_catalogs", side_effect=changed):
            served = inputs.market_inputs(self.profile, MARKET_COMMIT, LINE_WINDOW, selection, None, True)
        self.addCleanup(inputs.cleanup, served)
        self.assertNotEqual(served["identity"]["export_content_sha256"], local["identity"]["export_content_sha256"])
        self.assertNotEqual(comparability.input_key(served["identity"]), comparability.input_key(local["identity"]))

    def test_a_cached_export_is_reused_only_from_the_supplys_current_exporter(self):
        self.exported()
        before = self.market.exports
        with patch.object(self.client, "_rpc", side_effect=AssertionError("same exporter: served from the cache")):
            self.exported()
        with supply_exporter("7" * 64):
            client = remote.RemoteMarket(self.profile)
            result = client.export_catalogs(MARKET_COMMIT, ["AAAUSDT"], LINE_WINDOW["start"], LINE_WINDOW["end"],
                                            None, None, False, include_quotes=False)
        self.addCleanup(shutil.rmtree, result["root"], True)
        self.assertEqual(self.market.exports, before + 1)
        self.assertEqual(result["exporter_source_sha256"], "7" * 64)

    def test_existing_market_errors_cross_the_transport_without_changing_the_cli_refusal_mapping(self):
        from market.sources import MarketError
        failure = MarketError("original export refusal", code="EXPORT_WINDOW", missing=("start", "end"))
        with patch.object(self.market, "export_catalogs", side_effect=failure), self.assertRaises(MarketError) as caught:
            self.exported(True)
        self.assertEqual(caught.exception.as_dict(), failure.as_dict())

    def test_parallel_clients_get_independent_roots_and_one_nonfresh_export(self):
        def fetch(_):
            client = remote.RemoteMarket(self.profile)
            return client.export_catalogs(MARKET_COMMIT, ["AAAUSDT"], LINE_WINDOW["start"], LINE_WINDOW["end"],
                                          None, None, False, include_quotes=False)
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(fetch, range(2)))
        for result in results:
            self.addCleanup(shutil.rmtree, result["root"], True)
        self.assertNotEqual(results[0]["root"], results[1]["root"])
        self.assertEqual(self.market.exports, 1)
        (results[0]["root"] / "AAAUSDT/bars.parquet").write_bytes(b"tampered after handoff")
        self.assertNotEqual((results[0]["root"] / "AAAUSDT/bars.parquet").read_bytes(),
                            (results[1]["root"] / "AAAUSDT/bars.parquet").read_bytes())


@unittest.skipUnless(BINARY, SKIP)
class NativeExportTests(unittest.TestCase):
    def test_real_export_excludes_other_symbols_and_half_open_boundary_rows_at_a_fixed_version(self):
        import numpy as np
        from market import store
        fixture = TemporaryMarket()
        self.addCleanup(fixture.close)
        start = 1738368000000  # 2025-02-01; sentinels in January and after the selected interval
        bars = {"ts_open": np.array([start - 60000, start, start + 60000], np.int64)}
        bars.update({k: np.full(3, v, np.int64) for k, v in
                     {"open": 10000000000, "high": 10000000000, "low": 10000000000,
                      "close": 10000000000, "volume": 100000000}.items()})
        seed(fixture.profile, month="2025-01", through="2025-03-01", terms=[
            (s, {"price_increment": "0.01", "size_increment": "0.001"}) for s in ("BTCUSDT", "ETHUSDT")],
            bars={(s, p): (bars if p == "LAST" else {**bars, "volume": np.zeros(3, np.int64)})
                  for s in ("BTCUSDT", "ETHUSDT") for p in ("LAST", "MARK")})
        with store.connect(fixture.profile, "import") as conn:
            conn.many("INSERT INTO quote VALUES (%s,%s,%s,%s,%s)",
                      [(s, t, i, 9999000000, 10001000000) for s in ("BTCUSDT", "ETHUSDT")
                       for i, t in enumerate([start-1, start, start+60000])])
            commit = store._commit(conn, "fixture boundary quotes")
        local = seams.Market(fixture.profile)
        commit = local.resolve_commit(None)
        server = remote.Server(("127.0.0.1", 0), remote.Supply(local))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        cache = Path(tempfile.mkdtemp(prefix="supply-native-cache-"))
        self.addCleanup(shutil.rmtree, cache, True)
        client = remote.RemoteMarket({"database": local.database, "remote_url": f"http://127.0.0.1:{server.server_port}",
                                      "cache_root": cache})
        args = (commit, ["BTCUSDT"], start*1000000, (start+60000)*1000000, None, None, True)
        expected, actual = local.export_catalogs(*args), client.export_catalogs(*args)
        for result in (expected, actual):
            self.addCleanup(shutil.rmtree, result["root"], True)
        membership = cache / "membership.json"
        membership.write_text("{}")
        self.assertEqual(inputs.export_fingerprint({**expected, "membership_file": membership}, semantic=True),
                         inputs.export_fingerprint({**actual, "membership_file": membership}, semantic=True))
        self.assertEqual([p.name for p in actual["root"].iterdir()], ["BTCUSDT"])
        counts = actual["receipts"]["BTCUSDT"]["pieces"][0]["counts"]
        self.assertEqual((counts["last"], counts["mark"], counts["quote"]), (1, 1, 1))
        with store.connect(fixture.profile, "import") as conn:
            conn.execute("INSERT INTO quote VALUES ('BTCUSDT', %s, 10, 9998000000, 10001000000)", (start+10,))
            store._commit(conn, "fixture main advanced after pinned export")
        self.assertEqual(client.resolve_commit(commit), commit)
        pinned = client.export_catalogs(*args)
        self.addCleanup(shutil.rmtree, pinned["root"], True)
        self.assertEqual(inputs.export_fingerprint({**pinned, "membership_file": membership}, semantic=True),
                         inputs.export_fingerprint({**actual, "membership_file": membership}, semantic=True))


if __name__ == "__main__":
    unittest.main()
