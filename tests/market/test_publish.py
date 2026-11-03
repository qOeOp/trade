"""market.publish against a loopback stand-in for an S3-compatible store (conditional writes as R2 answers
them); the signature against AWS's published Signature Version 4 examples."""

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import http.server
import json
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from unittest.mock import patch

from market import publish, versions
from tests.market.test_versions import FEB, JAN, Directory, bars, quotes, terms


class Store(http.server.BaseHTTPRequestHandler):
    """Objects of one bucket in memory, path-style: GET/HEAD/PUT honouring If-None-Match: * and If-Match."""

    objects: dict[str, bytes]
    puts: list[str]
    types: dict[str, str]
    before_put = None

    def log_message(self, *args):
        pass

    def _name(self) -> str | None:
        bucket, _, name = self.path.lstrip("/").partition("/")
        return name if bucket == "trade-market" else None

    def _answer(self, status: int, body: bytes = b"", etag: str | None = None, send=True) -> None:
        self.send_response(status)
        if etag:
            self.send_header("ETag", etag)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if send:
            self.wfile.write(body)

    def do_GET(self, send=True):
        name = self._name()
        if not self.path.startswith("/public/") and not self.headers.get("Authorization", "").startswith(
                "AWS4-HMAC-SHA256 Credential=key-id/"):
            return self._answer(403, send=send)
        if self.path.startswith("/public/"):
            name = self.path[len("/public/"):]
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


class Publish(Directory):
    def setUp(self):
        super().setUp()
        handler, url = self.enterContext(store())
        self.objects, self.handler = handler.objects, handler
        key = Path(tempfile.mkdtemp()) / "key.json"
        self.addCleanup(shutil.rmtree, key.parent, True)
        key.write_text(json.dumps({"endpoint": url, "bucket": "trade-market", "access_key_id": "key-id",
                                   "secret_access_key": "secret"}))
        self.profile = {**self.profile, "role": "active", "origin": f"{url}/public", "upload": str(key)}
        self.enterContext(patch.object(versions, "writer", return_value="a" * 40))

    def imported(self) -> str:
        self.commit([("instrument", None, 1, 2, [terms("BTCUSDT", 1)]),
                     ("bar", None, JAN, FEB, [bars([("BTCUSDT", "LAST", JAN, 5)])])],
                    {"import": "binance-bars", "month": "2025-01"})
        return self.commit([("quote", "BTCUSDT", JAN, FEB, [quotes("BTCUSDT", [JAN, JAN + 1])])],
                           {"import": "binance-quotes", "month": "2025-01"})

    def test_uploads_versions_receipts_and_only_the_uploaded_tables(self):
        head = self.imported()
        found = publish.publish(self.profile)
        self.assertEqual((found["head"], found["versions"]), (head, 2))
        self.assertEqual(self.objects["head"], f"{head}\n".encode())
        version = versions.load_version(versions.open_market(self.profile, "reader"), head)
        for entry in version["files"]:
            self.assertEqual(f"files/{entry['sha256']}.parquet" in self.objects, entry["table"] != "quote",
                             entry["table"])
        for sha in version["receipts"]:
            self.assertIn(f"files/{sha}.json", self.objects)
        self.assertEqual(self.handler.puts[-1], "head", "head is replaced last")
        self.assertEqual(publish.publish(self.profile), {"head": head, "versions": 0, "files": 0})

    def test_a_reader_of_the_public_copy_rebuilds_rather_than_fetches_the_other_tables(self):
        head = self.imported()
        publish.publish(self.profile)
        reader = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, reader, True)
        market = versions.open_market({"root": str(reader), "origin": self.profile["origin"]}, "reader")
        self.assertEqual(market.head, head)
        self.assertEqual(sum(batch.num_rows for batch in versions.read_table(market, head, "bar")), 1)
        with self.refusal("MARKET_UNREACHABLE"):
            list(versions.read_table(market, head, "quote"))

    def test_a_receipt_without_writer_publishes_nothing(self):
        self.imported()
        with patch.object(versions, "writer", return_value=None):
            self.commit([("quote", "ETHUSDT", JAN, FEB, [quotes("ETHUSDT", [JAN])])], {"import": "binance-quotes"})
        with self.refusal("WRITER_MISSING"):
            publish.publish(self.profile)
        self.assertEqual(self.objects, {})

    def test_converted_versions_need_no_writer(self):
        with patch.object(versions, "writer", return_value=None):
            head = self.imported()
        with patch.object(versions, "CONVERTED_HEAD", head), patch.object(versions, "CONVERTED", {}):
            self.assertEqual(publish.publish(self.profile)["head"], head)

    def test_a_public_head_off_the_local_chain_diverges(self):
        self.imported()
        self.objects["head"] = b"0" * 32 + b"\n"
        with self.refusal("PUBLISH_DIVERGED"):
            publish.publish(self.profile)
        self.assertEqual(self.objects["head"], b"0" * 32 + b"\n")

    def test_a_head_moved_meanwhile_is_read_again(self):
        first = self.imported()
        publish.publish(self.profile)
        latest = self.commit([("quote", "ETHUSDT", JAN, FEB, [quotes("ETHUSDT", [JAN])])], {"import": "binance-quotes"})
        moved = []

        def same_head_again(name):  # another publisher wrote the same head (another ETag) once
            if name == "head" and not moved:
                moved.append(name)
                self.objects["head"] = f"{first}\n\n".encode()
        self.handler.before_put = staticmethod(same_head_again)
        self.assertEqual(publish.publish(self.profile)["head"], latest)
        self.assertEqual(self.objects["head"], f"{latest}\n".encode())

        self.commit([("quote", "SOLUSDT", JAN, FEB, [quotes("SOLUSDT", [JAN])])], {"import": "binance-quotes"})

        def off_the_chain(name):
            if name == "head":
                self.objects["head"] = b"0" * 32 + b"\n"
        self.handler.before_put = staticmethod(off_the_chain)
        with self.refusal("PUBLISH_DIVERGED"):
            publish.publish(self.profile)
        self.assertEqual(self.objects["head"], b"0" * 32 + b"\n", "nothing overwritten")

    def test_objects_carry_their_content_type(self):
        self.imported()
        publish.publish(self.profile)
        self.assertEqual({name.rsplit(".", 1)[-1] if "." in name else name: kind
                          for name, kind in self.handler.types.items()},
                         {"parquet": "application/vnd.apache.parquet", "json": "application/json",
                          "head": "text/plain"})

    def test_only_the_active_market_with_a_public_copy_publishes(self):
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


class Writer(Directory):
    def test_every_receipt_names_its_writer(self):
        with patch.object(versions, "writer", return_value="b" * 40):
            commit = self.commit([("quote", "BTCUSDT", JAN, FEB, [quotes("BTCUSDT", [JAN])])],
                                 {"import": "binance-quotes"})
        market = versions.open_market(self.profile, "reader")
        sha = versions.load_version(market, commit)["receipts"][-1]
        self.assertEqual(versions.receipt(market, sha)["writer"], "b" * 40)

    def test_the_writer_is_this_checkout_head_or_none(self):
        found = versions.writer()
        self.assertTrue(found is None or len(found) == 40)


if __name__ == "__main__":
    unittest.main()
