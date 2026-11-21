"""If this fails, the paper run's egress proxy could tunnel somewhere other than Binance's public USD-M
hosts on 443, or answer a request that is not a CONNECT."""

import asyncio
from pathlib import Path
import tempfile
import unittest

from urllib.parse import urlsplit

from engine import egress
from engine.live_venue import VENUES


class EgressTests(unittest.TestCase):
    def test_only_connect_to_the_public_hosts_on_443_is_admitted(self):
        self.assertEqual(egress.admitted("CONNECT fapi.binance.com:443 HTTP/1.1"), ("fapi.binance.com", 443))
        self.assertEqual(egress.admitted("CONNECT FSTREAM.binance.com:443 HTTP/1.1"), ("fstream.binance.com", 443))
        for line in ("CONNECT fapi.binance.com:80 HTTP/1.1", "CONNECT api.binance.com:443 HTTP/1.1",
                     "CONNECT testnet.binancefuture.com:443 HTTP/1.1", "CONNECT fapi.binance.com.evil.io:443 HTTP/1.1",
                     "GET http://fapi.binance.com/fapi/v1/time HTTP/1.1", "CONNECT fapi.binance.com HTTP/1.1",
                     "CONNECT fapi.binance.com:443", ""):
            with self.subTest(line=line):
                self.assertIsNone(egress.admitted(line))

    def test_each_environment_admits_its_own_hosts_alone(self):
        """A demo run reaches Binance Demo Trading and production's REST host (its metrics), never production's
        stream; a live run or Paper never a demo host (D-102)."""
        demo = egress.ALLOWED["demo"]
        for host in ("demo-fapi.binance.com", "demo-fstream.binance.com", "fapi.binance.com"):
            with self.subTest(host=host):
                self.assertEqual(egress.admitted(f"CONNECT {host}:443 HTTP/1.1", demo), (host, 443))
                self.assertEqual(egress.admitted(f"CONNECT {host}:443 HTTP/1.1") is not None,
                                 not host.startswith("demo-"))
        self.assertIsNone(egress.admitted("CONNECT fstream.binance.com:443 HTTP/1.1", demo))
        for environment, hosts in VENUES.items():
            with self.subTest(environment=environment):
                self.assertLessEqual({(urlsplit(hosts["rest"]).hostname, 443), (hosts["stream"], 443)},
                                     egress.ALLOWED[environment])

    def test_a_refused_request_gets_403_and_is_logged(self):
        with tempfile.TemporaryDirectory() as root:
            log = Path(root, "egress.log")
            writer = egress.Log(str(log))
            try:
                answers = asyncio.run(self.ask(writer, [b"CONNECT example.com:443 HTTP/1.1\r\n\r\n",
                                                        b"GET / HTTP/1.1\r\nHost: x\r\n\r\n"]))
            finally:
                writer.close()
            logged = log.read_text(encoding="utf-8").splitlines()
        self.assertTrue(all(answer.startswith(b"HTTP/1.1 403") for answer in answers))
        self.assertEqual([line.split(" ")[1] for line in logged], ["DENY", "DENY"])

    async def ask(self, log, requests):
        server = await asyncio.start_server(egress.handler(log), "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        answers = []
        async with server:
            for request in requests:
                reader, writer = await asyncio.open_connection("127.0.0.1", port)
                writer.write(request)
                await writer.drain()
                answers.append(await reader.read())
                writer.close()
        return answers
