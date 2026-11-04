"""market.publish against a loopback stand-in for an S3-compatible store (conditional writes as R2 answers
them); the signature against AWS's published Signature Version 4 examples."""

from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import http.server
import json
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
import urllib.parse

import pyarrow as pa
import pyarrow.parquet as pq

from market import publish
from tests.market.test_files import DAY, FEB, FEB_1, JAN, JAN_1, Directory, bars, members, quotes, rows_of, terms, watch


def force_order(received: int) -> pa.RecordBatch:
    price, size = Decimal(100), Decimal(1)
    return rows_of("binance_force_order", symbol=["BTCUSDT"], trade_time=[received], side=["SELL"], price=[price],
                   avg_price=[price], orig_qty=[size], filled_qty=[size], last_filled_qty=[size], status=["FILLED"],
                   event_time=[received], received_at=[received], n=[1])


class Store(http.server.BaseHTTPRequestHandler):
    """Objects of one bucket in memory, path-style: GET/HEAD/PUT honouring If-None-Match: * and If-Match, and
    ListObjectsV2 by pages of `page`."""

    objects: dict[str, bytes]
    puts: list[str]
    types: dict[str, str]
    before_put = None
    page = 1000

    def log_message(self, *args):
        pass

    def _name(self) -> str | None:
        bucket, _, name = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path).lstrip("/").partition("/")
        return name if bucket == "trade-market" else None

    def _answer(self, status: int, body: bytes = b"", etag: str | None = None, send=True) -> None:
        self.send_response(status)
        if etag:
            self.send_header("ETag", etag)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if send:
            self.wfile.write(body)

    def _listing(self, query: dict) -> None:
        names = sorted(name for name in self.objects if name.startswith(query.get("prefix", [""])[0]))
        start = int(query.get("continuation-token", ["0"])[0])
        shown = names[start:start + self.page]
        contents = "".join(f"<Contents><Key>{name}</Key><ETag>&quot;{hashlib.md5(self.objects[name]).hexdigest()}"
                           "&quot;</ETag></Contents>" for name in shown)
        more = start + self.page < len(names)
        ending = f"<NextContinuationToken>{start + self.page}</NextContinuationToken>" if more else ""
        self._answer(200, ('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                           f"<IsTruncated>{str(more).lower()}</IsTruncated>{contents}{ending}"
                           "</ListBucketResult>").encode())

    def do_GET(self, send=True):
        if not self.headers.get("Authorization", "").startswith("AWS4-HMAC-SHA256 Credential=key-id/"):
            return self._answer(403, send=send)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        if "list-type" in query:
            return self._listing(query)
        name = self._name()
        if name not in self.objects:
            return self._answer(404, send=send)
        data = self.objects[name]
        self._answer(200, data, f'"{hashlib.md5(data).hexdigest()}"', send)

    def do_HEAD(self):
        self.do_GET(send=False)

    def do_PUT(self):
        name = self._name()
        data = self.rfile.read(int(self.headers["Content-Length"]))
        if type(self).before_put is not None:
            type(self).before_put(name)
        current = self.objects.get(name)
        if self.headers.get("If-None-Match") == "*" and current is not None:
            return self._answer(412)
        match = self.headers.get("If-Match")
        if match is not None and (current is None or match != f'"{hashlib.md5(current).hexdigest()}"'):
            return self._answer(412)
        self.objects[name] = data
        self.puts.append(name)
        self.types[name] = self.headers.get("Content-Type")
        self._answer(200)


@contextmanager
def store():
    handler = type("Bucket", (Store,), {"objects": {}, "puts": [], "types": {}, "before_put": None})
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield handler, f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


class Signature(unittest.TestCase):
    ACCESS, SECRET = "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    NOW = datetime(2013, 5, 24, tzinfo=timezone.utc)

    def test_the_published_get_object_example(self):
        signed = publish.sign("GET", "https://examplebucket.s3.amazonaws.com/test.txt", {"Range": "bytes=0-9"}, b"",
                              self.ACCESS, self.SECRET, self.NOW, "us-east-1")
        self.assertTrue(signed["Authorization"].endswith(
            "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"))

    def test_the_published_put_object_example(self):
        signed = publish.sign("PUT", "https://examplebucket.s3.amazonaws.com/test%24file.text",
                              {"Date": "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY"},
                              b"Welcome to Amazon S3.", self.ACCESS, self.SECRET, self.NOW, "us-east-1")
        self.assertTrue(signed["Authorization"].endswith(
            "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"))

    def test_the_published_list_objects_example(self):
        signed = publish.sign("GET", "https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J", {}, b"",
                              self.ACCESS, self.SECRET, self.NOW, "us-east-1")
        self.assertTrue(signed["Authorization"].endswith(
            "Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"))


class Publish(Directory):
    def setUp(self):
        super().setUp()
        handler, url = self.enterContext(store())
        self.objects, self.handler = handler.objects, handler
        key = Path(tempfile.mkdtemp()) / "key.json"
        self.addCleanup(shutil.rmtree, key.parent, True)
        key.write_text(json.dumps({"endpoint": url, "bucket": "trade-market", "access_key_id": "key-id",
                                   "secret_access_key": "secret"}))
        self.profile = {**self.profile, "role": "active", "upload": str(key)}

    def imported(self) -> None:
        self.write([("instrument", None, None, [terms("BTCUSDT", 1)]),
                    ("universe_month", JAN_1, None, [members(JAN_1, ["BTCUSDT"])]),
                    ("bar", JAN_1, None, [bars([("BTCUSDT", "LAST", JAN, 5)])]),
                    ("quote", JAN_1, "BTCUSDT", [quotes("BTCUSDT", [JAN, JAN + 1])]),
                    ("binance_force_order", JAN_1, "BTCUSDT", [force_order(JAN + 5)]),
                    ("liquidation_watch", JAN_1, None, [watch(JAN)])])

    def test_only_what_cannot_be_fetched_again_is_uploaded_under_its_path(self):
        self.imported()
        self.assertEqual(publish.publish(self.profile), {"created": 4, "replaced": 0})
        self.assertEqual(sorted(self.objects), [
            "binance_force_order/2025-01/BTCUSDT.parquet", "instrument.parquet", "liquidation_watch/2025-01.parquet",
            "universe_month/2025-01.parquet"])
        self.assertEqual(self.objects["instrument.parquet"], (self.root / "instrument.parquet").read_bytes())
        self.assertEqual(self.handler.types["instrument.parquet"], publish.PARQUET)
        self.assertEqual(publish.publish(self.profile), {"created": 0, "replaced": 0})
        self.assertEqual(len(self.handler.puts), 4)

    def test_watch_is_uploaded_after_the_rows_it_vouches_for(self):
        self.imported()
        publish.publish(self.profile)
        self.assertLess(self.handler.puts.index("binance_force_order/2025-01/BTCUSDT.parquet"),
                        self.handler.puts.index("liquidation_watch/2025-01.parquet"))

    def test_the_listing_follows_pages(self):
        self.imported()
        self.write([("universe_month", FEB_1, None, [members(FEB_1, ["BTCUSDT"])])])
        publish.publish(self.profile)
        before = len(self.handler.puts)
        self.handler.page = 1
        self.assertEqual(publish.publish(self.profile), {"created": 0, "replaced": 0})
        self.assertEqual(len(self.handler.puts), before)

    def test_a_universe_month_that_differs_is_refused_and_not_overwritten(self):
        self.imported()
        publish.publish(self.profile)
        self.objects["universe_month/2025-01.parquet"] = b"other"
        with self.refusal("PUBLISH_DIVERGED"):
            publish.publish(self.profile)
        self.assertEqual(self.objects["universe_month/2025-01.parquet"], b"other")

    def test_the_same_rows_in_other_bytes_are_left_alone(self):
        self.imported()
        publish.publish(self.profile)
        sink = pa.BufferOutputStream()
        pq.write_table(pq.read_table(self.root / "universe_month" / "2025-01.parquet"), sink, compression="snappy")
        self.objects["universe_month/2025-01.parquet"] = sink.getvalue().to_pybytes()
        self.assertEqual(publish.publish(self.profile), {"created": 0, "replaced": 0})

    def test_a_liquidation_month_uploaded_while_open_is_replaced_once_it_ends(self):
        self.imported()
        publish.publish(self.profile)
        name = "binance_force_order/2025-01/BTCUSDT.parquet"
        self.write([("binance_force_order", JAN_1, "BTCUSDT", [force_order(JAN + 5), force_order(JAN + 6)]),
                    ("liquidation_watch", JAN_1, None, [watch(JAN), watch(FEB - DAY)])])
        self.assertEqual(publish.publish(self.profile)["replaced"], 2)
        self.assertEqual(self.objects[name], (self.root / name).read_bytes())
        # Rows only the copy holds stop it, the month ended or not.
        self.write([("binance_force_order", JAN_1, "BTCUSDT", [force_order(JAN + 6)])])
        with self.refusal("PUBLISH_DIVERGED"):
            publish.publish(self.profile)

    def test_an_open_file_is_replaced_when_the_local_one_holds_its_rows(self):
        self.imported()
        publish.publish(self.profile)
        rows = pa.Table.from_batches([terms("BTCUSDT", 1), terms("ETHUSDT", 2)]).combine_chunks().to_batches()
        self.write([("instrument", None, None, rows)])
        self.assertEqual(publish.publish(self.profile), {"created": 0, "replaced": 1})
        self.assertEqual(self.objects["instrument.parquet"], (self.root / "instrument.parquet").read_bytes())

    def test_an_old_local_copy_cannot_cover_rows_only_the_public_copy_holds(self):
        self.imported()
        rows = pa.Table.from_batches([terms("BTCUSDT", 1), terms("ETHUSDT", 2)]).combine_chunks().to_batches()
        self.write([("instrument", None, None, rows)])
        publish.publish(self.profile)
        kept = self.objects["instrument.parquet"]
        self.write([("instrument", None, None, [terms("BTCUSDT", 1)])])
        with self.refusal("PUBLISH_DIVERGED"):
            publish.publish(self.profile)
        self.assertEqual(self.objects["instrument.parquet"], kept)

    def test_a_replacement_someone_beat_fails_without_overwriting(self):
        self.imported()
        publish.publish(self.profile)
        rows = pa.Table.from_batches([terms("BTCUSDT", 1), terms("ETHUSDT", 2)]).combine_chunks().to_batches()
        self.write([("instrument", None, None, rows)])
        objects = self.objects

        def beaten(name):
            objects[name] = b"someone else"
        self.handler.before_put = staticmethod(beaten)
        with self.refusal("PUBLISH_FAILED"):
            publish.publish(self.profile)
        self.assertEqual(objects["instrument.parquet"], b"someone else")

    def test_only_the_active_market_with_an_upload_key_publishes(self):
        self.imported()
        with self.refusal("PUBLISH_FORBIDDEN"):
            publish.publish({**self.profile, "role": "isolated"})
        with self.refusal("REMOTE_UNSET"):
            publish.publish({**self.profile, "upload": None})
        with self.refusal("REMOTE_UNSET"):
            publish.publish({**self.profile, "upload": str(self.root / "missing.json")})

    def test_an_endpoint_without_a_scheme_fails_as_a_refusal(self):
        self.imported()
        key = Path(self.profile["upload"])
        key.write_text(json.dumps({**json.loads(key.read_text()), "endpoint": "r2.example"}))
        with self.refusal("PUBLISH_FAILED"):
            publish.publish(self.profile)


if __name__ == "__main__":
    unittest.main()
