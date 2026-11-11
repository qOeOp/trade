"""If these fail, the served research graph no longer follows the ledger: a page asking for a graph gets
it once it is drawn, an open page is told when the head moves and gets the latest graph only, a
slow or failed head read never takes the last view away, another site cannot make the browser fetch graphs, a trial's report and a contract's daily bars are read once each and their refusals reach
the page, only the page itself, with its token, can start a paper run, only reads reach the Market page's
overview, the market-import service's status reaches the page as it is, stale by the healthcheck's rule, and a browser that takes gzip gets it without a stream losing its timing. The product is a stand-in; no ledger or network is used."""

import copy
from datetime import UTC, datetime, timedelta
import gzip
import http.client
import json
import re
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ide"))

from research_graph import serve  # noqa: E402
from tests.research_graph.test_research_graph import GRAPH  # noqa: E402

POLL = 0.01  # shutdown() waits one poll of serve_forever, 0.5 s by default
PAGE = b"<html><head></head>page</html>"


def setUpModule():
    """A stand-in page, so no test here installs and builds ide/web; test_research_graph.WebRenderTests
    tests the build."""
    page = mock.patch.object(serve, "_page", return_value=PAGE)
    page.start()
    unittest.addModuleCleanup(page.stop)


class FakeProduct:
    """`commit` answers the head (or a ref named in `refs`), waiting for `hold` when it is set and refusing
    with `failure` when that is; `graph` waits for `release` when it is set."""

    ledger = "copy"

    def __init__(self):
        self.head = "a" * 32
        self.refs: dict[str, str] = {}
        self.drawn: list[str] = []
        self.release: threading.Event | None = None
        self.hold: threading.Event | None = None
        self.reading = threading.Event()
        self.failure: dict | None = None
        self.reports: list[tuple[int, str]] = []
        self.read_bars: list[tuple[str, str, str, str]] = []
        self.same = False  # `research unchanged`: its answer, or a refusal to raise
        self.asked: list[tuple[str, str, str]] = []
        self.compared: list[tuple[str, int, str]] = []
        self.trial_counts: dict | None = {"research_trials": 3, "all_purpose_trials": 9}
        self.counted: list[tuple[str, str]] = []
        self.counts_failure: dict | None = None  # `research counts` refuses with this

    def counts(self, line, commit):
        self.counted.append((line, commit))
        if self.counts_failure is not None:
            raise serve.ProductError(self.counts_failure)
        return {"trial_counts": self.trial_counts, "ledger_commit": commit}

    def unchanged(self, line, since, commit):
        self.asked.append((line, since, commit))
        if isinstance(self.same, dict):
            raise serve.ProductError(self.same)
        return {"unchanged": self.same}

    def commit(self, ref=None):
        if ref is None:
            self.reading.set()
            if self.hold is not None:
                self.hold.wait(5)
            if self.failure is not None:
                raise serve.ProductError(self.failure)
            return self.head
        if ref not in self.refs:
            raise serve.ProductError({"code": "UNKNOWN_REF", "message": ref})
        return self.refs[ref]

    def trial(self, trial_id, commit):
        self.reports.append((trial_id, commit))
        if trial_id == 7:
            raise serve.ProductError({"code": "RUN_NOT_PASSED", "message": "run 7 is failed"})
        return {"trial_id": trial_id, "ledger_commit": commit, "tables": {"daily_returns": []}}

    def comparison(self, bundle, trial_id, commit):
        self.compared.append((bundle, trial_id, commit))
        if trial_id == 7:
            raise serve.ProductError({"code": "MARKET_UNREACHABLE", "message": "no market"})
        return {"comparison": {"vs_trial": 1}}

    def bars(self, symbol, start, end, commit):
        self.read_bars.append((symbol, start, end, commit))
        if symbol == "NOPEUSDT":
            raise serve.ProductError({"code": "NO_TERMS", "message": "no NOPEUSDT at the commit"})
        return {"commit": commit, "symbol": symbol, "timeframe": "1d", "bars": {"count": 0, "rows": []}}

    def lines(self, commit):
        return {"ledger_commit": commit, "lines": [{"bundle": "historical", "closed": True},
                                                   {"bundle": "current", "closed": False}]}

    def graph(self, commit, line, since):
        if self.release is not None:
            self.release.wait(5)
        self.drawn.append(commit)
        graph = copy.deepcopy(GRAPH)
        graph["scope"] = {**graph["scope"], "ledger_commit": commit}
        if line is not None:
            graph["line"]["bundle"] = line
        return graph


def until(condition, seconds=5.0):
    deadline = time.monotonic() + seconds
    while not condition():
        if time.monotonic() > deadline:
            raise AssertionError("not reached in time")
        time.sleep(0.01)


class HubTests(unittest.TestCase):
    def setUp(self):
        self.product = FakeProduct()
        self.hub = serve.Hub(self.product, "build", poll=0.05)
        threading.Thread(target=self.hub.work, daemon=True).start()

    def states(self, client):
        found = []
        while (message := client.take(0)) is not None:
            found.append(message)
        return found

    def test_a_page_gets_its_graph_once_it_is_drawn(self):
        status, body = self.hub.view(None, None, None)
        self.assertEqual(status, 202)
        self.assertIn(body["state"], ("queued", "computing", "ready"))
        until(lambda: self.hub.view(None, None, None)[0] == 200)
        status, view = self.hub.view(None, None, None)
        self.assertEqual(view["scope"]["ledger_commit"], "a" * 32)
        self.assertEqual(self.product.drawn, ["a" * 32], "a cached view is not drawn again")

    def test_a_slow_head_read_does_not_hold_a_page(self):
        until(lambda: self.hub.view(None, None, None)[0] == 200)
        self.product.hold, self.product.head = threading.Event(), "b" * 32
        self.addCleanup(self.product.hold.set)
        self.product.reading.clear()
        threading.Thread(target=self.hub.refresh, daemon=True).start()
        self.product.reading.wait(5)
        time.sleep(0.1)  # the head was read longer than `poll` ago
        started = time.monotonic()
        status, view = self.hub.view(None, None, None)
        self.assertLess(time.monotonic() - started, 1, "the page does not wait for the head read")
        self.assertEqual((status, view["scope"]["ledger_commit"]), (200, "a" * 32), "it gets the last view")
        self.product.hold.set()
        until(lambda: self.hub.view(None, None, None)[1].get("scope", {}).get("ledger_commit") == "b" * 32)

    def test_a_completed_graph_is_available_while_the_new_head_is_still_drawing(self):
        first, latest = threading.Event(), threading.Event()
        draw = self.product.graph

        def graph(commit, line, since):
            (first if commit == "a" * 32 else latest).wait(5)
            return draw(commit, line, since)

        self.product.graph = graph
        self.addCleanup(latest.set)
        self.addCleanup(first.set)
        self.hub.refresh(wait=True)
        client = serve.Client("line-a", None, None)
        self.hub.join(client)
        until(lambda: self.hub.running == self.hub.key("a" * 32, "line-a", None))
        self.product.head = "b" * 32
        self.hub.refresh(wait=True)
        first.set()
        until(lambda: self.hub.running == self.hub.key("b" * 32, "line-a", None))
        status, view = self.hub.view("line-a", None, None)
        self.assertEqual(status, 200, "new pages can show the completed graph instead of waiting for a moving head")
        self.assertEqual(view["scope"]["ledger_commit"], "a" * 32)
        self.assertEqual(view["line"]["bundle"], "line-a")
        self.assertEqual(client.sent, {"state": "computing", "ledger_commit": "b" * 32,
                                       "available_commit": "a" * 32})
        latest.set()
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "b" * 32})
        self.assertEqual(self.hub.view("line-a", None, None)[1]["scope"]["ledger_commit"], "b" * 32)

    def test_live_fallback_never_changes_line_scope_or_explicit_snapshot(self):
        until(lambda: self.hub.view("line-a", None, None)[0] == 200)
        self.product.release = threading.Event()
        self.addCleanup(self.product.release.set)
        self.product.head = "b" * 32
        self.hub.refresh(wait=True)
        self.assertEqual(self.hub.view("line-a", None, None)[0], 200)
        self.assertEqual(self.hub.view("line-b", None, None)[0], 202)
        self.assertEqual(self.hub.view("line-a", "s" * 32, None)[0], 202)
        self.assertEqual(self.hub.view("line-a", None, "b" * 32)[0], 202)
        self.assertEqual(self.hub.view(None, None, None)[0], 202, "an unnamed default may have changed lines")

    def test_a_busy_line_does_not_starve_a_pending_line_when_the_head_moves(self):
        first, later = threading.Event(), threading.Event()
        started = []
        draw = self.product.graph

        def graph(commit, line, since):
            started.append((commit, line))
            (first if commit == "a" * 32 else later).wait(5)
            return draw(commit, line, since)

        self.product.graph = graph
        self.addCleanup(later.set)
        self.addCleanup(first.set)
        self.hub.refresh(wait=True)
        self.hub.join(serve.Client("busy", None, None))
        until(lambda: len(started) == 1)
        self.hub.join(serve.Client("new-line", None, None))
        self.product.head = "b" * 32
        self.hub.refresh(wait=True)
        self.product.head = "c" * 32
        self.hub.refresh(wait=True)
        first.set()
        until(lambda: len(started) == 2)
        self.assertEqual(started[1], ("c" * 32, "new-line"), "keep the pending line's place while coalescing heads")

    def test_hot_line_versions_do_not_evict_every_other_line(self):
        until(lambda: self.hub.view("quiet", None, None)[0] == 200)
        for n in range(serve.CACHED + 2):
            self.product.head = f"{n:032x}"
            self.hub.refresh(wait=True)
            until(lambda: self.hub.view("busy", None, None)[0] == 200
                  and self.hub.view("busy", None, None)[1]["scope"]["ledger_commit"] == self.product.head)
        code, view = self.hub.view("quiet", None, None)
        self.assertEqual(code, 200, "switching back still has that line's last completed graph")
        self.assertEqual(view["scope"]["ledger_commit"], "a" * 32)
        self.assertLessEqual(len(self.hub.views), serve.CACHED)

    def test_reading_or_drawing_a_pinned_old_snapshot_does_not_rewind_live_fallback(self):
        until(lambda: self.hub.view("line-a", None, None)[0] == 200)
        self.product.head = "b" * 32
        self.hub.refresh(wait=True)
        until(lambda: self.hub.view("line-a", None, None)[1].get("scope", {}).get("ledger_commit") == "b" * 32)
        self.assertEqual(self.hub.view("line-a", None, "a" * 32)[0], 200)
        until(lambda: self.hub.view("line-a", None, "0" * 32)[0] == 200)
        self.product.release = threading.Event()
        self.addCleanup(self.product.release.set)
        self.product.head = "c" * 32
        self.hub.refresh(wait=True)
        self.assertEqual(self.hub.view("line-a", None, None)[1]["scope"]["ledger_commit"], "b" * 32)

    def test_a_failed_refresh_is_told_over_the_last_view(self):
        client = serve.Client(None, None, None)
        self.hub.refresh(wait=True)
        self.hub.join(client)
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "a" * 32})
        self.product.failure = {"code": "LEDGER_UNAVAILABLE", "message": "the service does not answer"}
        self.hub.refresh(wait=True)
        self.assertEqual((client.sent["state"], client.sent["ledger_commit"], client.sent["error"]["code"]),
                         ("error", "a" * 32, "LEDGER_UNAVAILABLE"))
        self.assertEqual(self.hub.view(None, None, None)[0], 200, "the last view is kept")
        self.product.failure = None
        self.hub.refresh(wait=True)
        self.assertEqual(client.sent, {"state": "ready", "ledger_commit": "a" * 32}, "a good refresh clears it")

    def test_an_open_page_follows_the_head_and_gets_only_the_latest_graph(self):
        client = serve.Client(None, None, None)
        self.hub.refresh(wait=True)
        self.hub.join(client)
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "a" * 32})
        self.product.release = threading.Event()
        self.product.head = "b" * 32
        self.hub.refresh(wait=True)
        until(lambda: self.hub.running is not None)
        self.product.head = "c" * 32  # two more commits while b is drawn
        self.hub.refresh(wait=True)
        self.product.head = "d" * 32
        self.hub.refresh(wait=True)
        self.product.release.set()
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "d" * 32})
        self.assertEqual(self.product.drawn, ["a" * 32, "b" * 32, "d" * 32], "c is skipped for the latest head")

    def drawn_page(self, line="line", **options):
        client = serve.Client(line, None, None, **options)
        self.hub.refresh(wait=True)
        self.hub.join(client)
        return client

    def test_an_unchanged_line_is_not_drawn_again_and_a_changed_one_is(self):
        client = self.drawn_page()
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "a" * 32})
        self.product.same, self.product.head = True, "b" * 32
        self.hub.refresh(wait=True)
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "b" * 32})
        self.assertEqual(self.product.drawn, ["a" * 32])
        self.assertEqual(self.product.asked, [("line", "a" * 32, "b" * 32)])
        scope = self.hub.view("line", None, None)[1]["scope"]
        self.assertEqual((scope["ledger_commit"], scope["drawn_commit"], scope["build"]), ("b" * 32, "a" * 32, "build"))
        self.assertEqual(self.summary()["trial_counts"], self.product.trial_counts)
        self.assertEqual(self.product.counted, [("line", "a" * 32), ("line", "b" * 32)])
        self.product.trial_counts = {"research_trials": 4, "all_purpose_trials": 12}
        self.product.head = "d" * 32  # a trial elsewhere: the graph holds and its counts move
        self.hub.refresh(wait=True)
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "d" * 32})
        self.assertEqual((self.product.drawn, self.summary()["trial_counts"]), (["a" * 32], self.product.trial_counts))
        self.product.same, self.product.head = False, "c" * 32
        self.hub.refresh(wait=True)
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "c" * 32})
        self.assertEqual(self.product.drawn, ["a" * 32, "c" * 32])
        self.assertEqual(self.product.asked[-1], ("line", "d" * 32, "c" * 32))
        scope = self.hub.view("line", None, None)[1]["scope"]
        self.assertEqual((scope["ledger_commit"], scope.get("drawn_commit")), ("c" * 32, None))

    def test_a_graph_drawn_without_the_market_is_drawn_again(self):
        real = self.product.graph

        def degraded(commit, line, since):
            graph = real(commit, line, since)
            graph["scope"]["market_unread"] = "UNKNOWN_REF: no such market commit"
            return graph

        self.product.graph, self.product.same = degraded, True
        client = self.drawn_page()
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "a" * 32})
        self.product.graph, self.product.head = real, "b" * 32
        self.hub.refresh(wait=True)
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "b" * 32})
        self.assertEqual(self.product.asked, [])
        self.assertIsNone(self.hub.view("line", None, None)[1]["scope"].get("market_unread"))

    def test_a_refused_check_draws_so_the_refusal_reaches_the_page(self):
        client = self.drawn_page()
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "a" * 32})
        self.product.same, self.product.head = {"code": "SCHEMA_MISMATCH", "message": "other schema"}, "b" * 32
        self.hub.refresh(wait=True)
        until(lambda: self.product.drawn == ["a" * 32, "b" * 32])

    def test_only_a_named_line_at_the_head_is_ever_compared(self):
        self.product.same = True
        for line, since in ((None, None), ("line", "s" * 32)):
            client = serve.Client(line, since, None)
            self.hub.refresh(wait=True)
            self.hub.join(client)
            self.product.head = "b" * 32 if line is None else "c" * 32
            until(lambda: client.sent["state"] == "ready")
            self.hub.refresh(wait=True)
            until(lambda: client.sent == {"state": "ready", "ledger_commit": self.product.head})
            self.hub.leave(client)
        self.product.refs["old"] = "e" * 32
        _, at = self.hub.resolve(None, "old")
        pinned = serve.Client("line", None, at)
        self.hub.join(pinned)
        until(lambda: pinned.sent["state"] == "ready")
        self.assertEqual(self.product.asked, [])

    def summary(self):
        return next(w for w in self.hub.view("line", None, None)[1]["widgets"] if w["id"] == "summary")

    def test_counts_that_refuse_refuse_the_graph_they_would_be_shown_on(self):
        refusal = {"code": "LEDGER_CORRUPT", "message": "a capture fails its hash"}
        client = self.drawn_page()
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "a" * 32})
        self.product.same, self.product.head, self.product.counts_failure = True, "b" * 32, refusal
        self.hub.refresh(wait=True)
        until(lambda: client.sent == {"state": "error", "ledger_commit": "b" * 32, "error": refusal, "available_commit": "a" * 32})
        self.product.head = "c" * 32
        self.confirming()
        keeper = self.drawn_page(have="k" * 32)
        until(lambda: keeper.sent == {"state": "error", "ledger_commit": "c" * 32, "error": refusal, "available_commit": "a" * 32})

    def test_counts_that_refuse_refuse_a_first_draw(self):
        refusal = {"code": "LEDGER_CORRUPT", "message": "a capture fails its hash"}
        self.product.counts_failure = refusal
        client = self.drawn_page()
        until(lambda: client.sent == {"state": "error", "ledger_commit": "a" * 32, "error": refusal})

    def test_a_page_is_told_the_check_is_running_and_its_own_commit_needs_no_counts(self):
        keeper = self.drawn_page(have="k" * 32)
        self.assertEqual(keeper.sent, {"state": "checking", "ledger_commit": "a" * 32})
        self.product.same = True
        self.confirming()
        until(lambda: keeper.sent["state"] == "unchanged")
        current = self.drawn_page(have="a" * 32)
        until(lambda: current.sent == {"state": "unchanged", "ledger_commit": "a" * 32})
        self.assertEqual(self.product.counted, [("line", "a" * 32)])

    def confirming(self):
        threading.Thread(target=self.hub.confirm, daemon=True).start()

    def test_a_kept_graph_that_holds_spares_the_draw(self):
        self.confirming()
        self.product.same = True
        client = self.drawn_page(have="k" * 32)
        counts = self.product.trial_counts
        until(lambda: client.sent == {"state": "unchanged", "ledger_commit": "a" * 32, "trial_counts": counts})
        self.assertEqual(self.product.drawn, [])
        self.assertEqual(self.product.asked, [("line", "k" * 32, "a" * 32)])
        self.product.head = "b" * 32  # the head moves on and it still holds
        self.hub.refresh(wait=True)
        until(lambda: client.sent == {"state": "unchanged", "ledger_commit": "b" * 32, "trial_counts": counts})
        self.assertEqual(self.product.drawn, [])

    def test_a_kept_graph_that_no_longer_holds_is_replaced_by_a_draw(self):
        self.confirming()
        client = self.drawn_page(have="k" * 32)
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "a" * 32})
        self.assertEqual(self.product.drawn, ["a" * 32])
        self.assertEqual(self.product.asked, [("line", "k" * 32, "a" * 32)])
        self.product.head = "b" * 32
        self.hub.refresh(wait=True)
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "b" * 32})
        self.assertEqual(self.product.drawn, ["a" * 32, "b" * 32])

    def test_a_refused_check_of_a_kept_graph_draws_and_the_refusal_reaches_the_page(self):
        self.confirming()
        self.product.same = {"code": "LEDGER_CORRUPT", "message": "stored bytes differ"}
        real, refusal = self.product.graph, {"code": "LEDGER_CORRUPT", "message": "stored bytes differ"}

        def refused(commit, line, since):
            raise serve.ProductError(refusal)

        self.product.graph = refused
        client = self.drawn_page(have="k" * 32)
        until(lambda: client.sent == {"state": "error", "ledger_commit": "a" * 32, "error": refusal})
        self.product.graph = real

    def test_a_page_that_kept_nothing_still_gets_a_draw_of_a_line_another_kept(self):
        self.confirming()
        self.product.same = True
        keeper = self.drawn_page(have="k" * 32)
        until(lambda: keeper.sent["state"] == "unchanged")
        other = serve.Client("line", None, None)
        self.hub.join(other)
        until(lambda: other.sent == {"state": "ready", "ledger_commit": "a" * 32})
        self.assertEqual(self.product.drawn, ["a" * 32])

    def test_a_check_never_waits_behind_a_draw(self):
        self.confirming()
        self.product.same, self.product.release = True, threading.Event()
        self.addCleanup(self.product.release.set)
        drawing = self.drawn_page(line="busy")
        until(lambda: self.hub.running is not None)
        keeper = self.drawn_page(have="k" * 32)
        until(lambda: keeper.sent["state"] == "unchanged")
        self.assertEqual(drawing.sent["state"], "computing")

    def test_a_page_at_a_commit_keeps_it(self):
        self.product.refs["line/x"] = "e" * 32
        _, at = self.hub.resolve(None, "line/x")
        client = serve.Client(None, None, at)
        self.hub.join(client)
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "e" * 32})
        self.product.head = "f" * 32
        self.hub.refresh(wait=True)
        self.assertEqual(client.sent["ledger_commit"], "e" * 32)
        with self.assertRaises(serve.ProductError):
            self.hub.resolve("nowhere", None)


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.hub = serve.Hub(FakeProduct(), "build", poll=0.05)
        threading.Thread(target=self.hub.work, daemon=True).start()
        self.server = serve.Server(("127.0.0.1", 0), serve.handler(self.hub, frozenset({"here:1"})))
        threading.Thread(target=self.server.serve_forever, args=(POLL,), daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def get(self, path, **headers):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        self.addCleanup(conn.close)
        conn.request("GET", path, headers={"Host": "here:1", **headers})
        return conn.getresponse()

    def test_about_names_the_build_and_the_ledger_or_the_refusal_reading_it(self):
        self.hub.product.service = lambda: {"running": True, "remote": "https://r/o/l", "ledger_commit": "abc", "pid": 7}
        self.assertEqual(json.loads(self.get("/api/about").read()),
                         {"build": "build", "ledger": {"running": True, "remote": "https://r/o/l", "unpublished": False,
                                                       "behind_seconds": None, "diverged": False, "commit": "abc"}})
        self.hub.product.service = lambda: {"running": False, "address": None}
        self.assertEqual(json.loads(self.get("/api/about").read())["ledger"],
                         {"running": False, "remote": None, "unpublished": False, "behind_seconds": None,
                          "diverged": False, "commit": None})

        def refused():
            raise serve.ProductError({"code": "LEDGER_UNKNOWN", "message": "no accounts"})
        self.hub.product.service = refused
        answer = self.get("/api/about")
        self.assertEqual((answer.status, json.loads(answer.read())),
                         (200, {"build": "build", "ledger": None,
                                "refusal": {"code": "LEDGER_UNKNOWN", "message": "no accounts"}}))

    def test_a_browser_keeps_the_page_and_asks_for_it_again_at_each_open(self):
        first = self.get("/", **{"Accept-Encoding": "gzip, br"})
        self.assertEqual((first.headers["Content-Encoding"], first.headers["Cache-Control"]), ("gzip", "private, no-cache"))
        self.assertEqual(gzip.decompress(first.read()), PAGE)
        again = self.get("/", **{"Accept-Encoding": "gzip, br", "If-None-Match": f'W/{first.headers["ETag"]}'})
        self.assertEqual((again.status, again.read()), (304, b""))
        plain = self.get("/", **{"If-None-Match": first.headers["ETag"]})
        self.assertEqual((plain.status, plain.read()), (200, PAGE), "another encoding is another page")
        self.assertEqual(self.get("/", Host="elsewhere:1", **{"If-None-Match": first.headers["ETag"]}).status, 403)

    def test_a_large_answer_is_gzipped_only_for_a_browser_that_takes_it(self):
        self.assertEqual([serve._takes_gzip(h) for h in ("gzip, br", "br", None, "GZIP;q=0.5", "gzip;q=0")],
                         [True, False, False, True, False])
        path = "/" + "x" * 2000
        zipped = self.get(path, **{"Accept-Encoding": "gzip"})
        self.assertEqual(zipped.headers["Content-Encoding"], "gzip")
        self.assertEqual(zipped.headers["Cache-Control"], "no-store")
        self.assertEqual(json.loads(gzip.decompress(zipped.read()))["code"], "NOT_FOUND")
        plain = self.get(path)
        self.assertNotIn("Content-Encoding", plain.headers)
        self.assertEqual(json.loads(plain.read())["code"], "NOT_FOUND")
        small = self.get("/x", **{"Accept-Encoding": "gzip"})
        self.assertNotIn("Content-Encoding", small.headers)
        self.assertEqual(json.loads(small.read())["code"], "NOT_FOUND")

    def test_only_the_page_itself_reads_graphs(self):
        self.assertEqual(self.get("/").read(), PAGE)
        self.assertEqual(self.get("/api/view", Host="elsewhere:1").status, 403)
        self.assertEqual(self.get("/api/view", **{"Sec-Fetch-Site": "cross-site"}).status, 403)
        response = self.get("/api/view")
        self.assertNotIn("Access-Control-Allow-Origin", response.headers)
        self.assertIn(response.status, (200, 202))
        self.assertEqual(self.get("/api/view?since=nowhere").status, 400)

    def test_external_document_navigation_can_open_the_page_shell(self):
        headers = {"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate",
                   "Sec-Fetch-Dest": "document"}
        for path in ("/", "/?line=published"):
            response = self.get(path, **headers)
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), PAGE)
            self.assertNotIn("Access-Control-Allow-Origin", response.headers)

    def test_document_navigation_exception_cannot_fetch_data_or_send_actions(self):
        headers = {"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate",
                   "Sec-Fetch-Dest": "document"}
        for path in ("/api/view", "/api/events", "/api/paper/runs", "/api/research/sync", "/favicon.ico"):
            with self.subTest(path=path):
                self.assertEqual(self.get(path, **headers).status, 403)
        self.assertEqual(self.get("/", Host="elsewhere:1", **headers).status, 403)
        self.assertEqual(self.get("/", **{"Sec-Fetch-Site": "cross-site"}).status, 403)
        for key, value in (("Sec-Fetch-Mode", "cors"), ("Sec-Fetch-Dest", "iframe")):
            with self.subTest(header=key):
                self.assertEqual(self.get("/", **{**headers, key: value}).status, 403)
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        self.addCleanup(conn.close)
        conn.request("POST", "/", body=b"{}", headers={"Host": "here:1", **headers})
        self.assertEqual(conn.getresponse().status, 403)

    def test_the_line_index_includes_closed_lines_and_honors_the_snapshot(self):
        self.hub.product.refs["before"] = "b" * 32
        response = self.get("/api/lines?at=before")
        self.assertEqual(response.status, 200)
        body = json.loads(response.read())
        self.assertEqual(body["ledger_commit"], "b" * 32)
        self.assertEqual([item["closed"] for item in body["lines"]], [True, False])
        self.assertEqual(self.get("/api/lines?at=missing").status, 400)
        self.assertEqual(self.get("/api/lines", Host="elsewhere:1").status, 403)
        self.assertEqual(self.get("/api/lines", **{"Sec-Fetch-Site": "cross-site"}).status, 403)

    def test_the_events_start_with_the_current_state(self):
        response = self.get("/api/events")
        self.assertEqual(response.headers["Content-Type"], "text/event-stream")
        first = json.loads(response.fp.readline().decode().removeprefix("data: "))
        self.assertIn(first["state"], ("fetching", "queued", "computing", "ready"))

    def test_a_kept_graph_counts_only_from_this_build_on_a_named_live_page(self):
        threading.Thread(target=self.hub.confirm, daemon=True).start()
        self.hub.product.same = True
        have, other = "k" * 32, "x" * 31
        self.hub.product.refs["z" * 32] = "z" * 32
        for query, counted in ((f"line=a&have={have}&build=build", True), (f"line=b&have={have}&build=older", False),
                               (f"have={have}&build=build", False), (f"line=c&have={other}&build=build", False),
                               (f"line=d&have={have}&build=build&at={'z' * 32}", False)):
            with self.subTest(query):
                before = len(self.hub.product.asked)
                self.get(f"/api/view?{query}").read()
                if counted:
                    until(lambda: len(self.hub.product.asked) > before)
                else:
                    time.sleep(0.05)
                    self.assertEqual(len(self.hub.product.asked), before)

    def test_line_navigation_is_warmed_and_reuses_the_snapshot_index(self):
        with mock.patch.object(self.hub.line_index, "read", wraps=self.hub.product.lines) as read:
            self.hub.refresh(wait=True)
            self.assertEqual(read.call_count, 1, "the index is ready before a first graph can be shown")
            for _ in range(3):
                response = self.get("/api/lines")
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read())["ledger_commit"], "a" * 32)
            self.assertEqual(read.call_count, 1)
            self.hub.product.head = "b" * 32
            self.hub.refresh(wait=True)
            self.assertEqual(read.call_count, 2)
            self.assertEqual(json.loads(self.get("/api/lines").read())["ledger_commit"], "b" * 32)
            self.assertEqual(read.call_count, 2)

    def test_an_index_failure_does_not_block_a_valid_graph(self):
        with mock.patch.object(self.hub.line_index, "read", side_effect=serve.ProductError(
                {"code": "LINE_CORRUPT", "message": "an unrelated line is unreadable"})):
            until(lambda: self.hub.view("valid-line", None, None)[0] == 200)
            response = self.get("/api/lines")
            self.assertEqual(response.status, 400)
            self.assertEqual(json.loads(response.read())["code"], "LINE_CORRUPT")

    def test_a_trial_report_is_read_once_per_commit_and_its_refusal_reaches_the_page(self):
        at = "c" * 32
        for _ in range(2):
            response = self.get(f"/api/trial?trial_id=3&at={at}")
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read())["ledger_commit"], at)
        self.assertEqual(self.hub.product.reports, [(3, at)])
        response = self.get(f"/api/trial?trial_id=7&at={at}")
        self.assertEqual((response.status, json.loads(response.read())["code"]), (400, "RUN_NOT_PASSED"))
        for query in ("trial_id=3", f"trial_id=x&at={at}", "trial_id=3&at=main"):
            self.assertEqual(self.get(f"/api/trial?{query}").status, 400, query)
        self.assertEqual(self.get(f"/api/trial?trial_id=3&at={at}", **{"Sec-Fetch-Site": "cross-site"}).status, 403)
        self.assertEqual(self.hub.product.reports, [(3, at), (7, at)])

    def test_a_comparison_is_read_once_per_commit_and_its_refusal_reaches_the_page(self):
        at = "c" * 32
        for _ in range(2):
            response = self.get(f"/api/comparison?bundle=registration-a&trial_id=3&at={at}")
            self.assertEqual((response.status, json.loads(response.read())), (200, {"comparison": {"vs_trial": 1}}))
        self.assertEqual(self.hub.product.compared, [("registration-a", 3, at)])
        response = self.get(f"/api/comparison?bundle=registration-a&trial_id=7&at={at}")
        self.assertEqual((response.status, json.loads(response.read())["code"]), (400, "MARKET_UNREACHABLE"))
        for query in ("bundle=a&trial_id=3", f"trial_id=3&at={at}", f"bundle=a%20b&trial_id=3&at={at}", f"bundle=a&trial_id=x&at={at}"):
            self.assertEqual(self.get(f"/api/comparison?{query}").status, 400, query)

    def test_daily_bars_are_read_once_per_contract_and_days_and_their_refusal_reaches_the_page(self):
        at, days = "d" * 32, "start=2026-09-01&end=2026-10-01"
        for _ in range(2):
            response = self.get(f"/api/bars?symbol=BTCUSDT&timeframe=1d&{days}&at={at}")
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read())["commit"], at)
        self.assertEqual(self.hub.product.read_bars, [("BTCUSDT", "2026-09-01", "2026-10-01", at)])
        response = self.get(f"/api/bars?symbol=NOPEUSDT&timeframe=1d&{days}&at={at}")
        self.assertEqual((response.status, json.loads(response.read())["code"]), (400, "NO_TERMS"))
        for query in (f"symbol=BTCUSDT&timeframe=1m&{days}&at={at}", f"symbol=BTCUSDT&{days}&at={at}",
                      f"symbol=btc;rm&timeframe=1d&{days}&at={at}", f"symbol=BTCUSDT&timeframe=1d&{days}&at=main",
                      f"symbol=BTCUSDT&timeframe=1d&start=2026-10-01&end=2026-09-01&at={at}",
                      f"symbol=BTCUSDT&timeframe=1d&start=2026-09-01T12:00:00Z&end=2026-10-01&at={at}",
                      f"symbol=BTCUSDT&timeframe=1d&start=2026-02-30&end=2026-10-01&at={at}"):
            self.assertEqual(self.get(f"/api/bars?{query}").status, 400, query)
        self.assertEqual(self.get(f"/api/bars?symbol=BTCUSDT&timeframe=1d&{days}&at={at}", **{"Sec-Fetch-Site": "cross-site"}).status, 403)
        self.assertEqual(len(self.hub.product.read_bars), 2)

    def test_without_a_chat_service_there_is_no_agent(self):
        self.assertEqual(self.get("/api/agent/health").status, 404)


class MarketImportTests(unittest.TestCase):
    def setUp(self):
        self.status = Path(tempfile.mkdtemp()) / "status.json"
        self.servers = {}
        for name, path in (("with", self.status), ("without", None)):
            server = serve.Server(("127.0.0.1", 0), serve.handler(serve.Hub(FakeProduct(), "build"),
                                                                  frozenset({"here:1"}), status=path))
            threading.Thread(target=server.serve_forever, args=(POLL,), daemon=True).start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)
            self.servers[name] = server

    def get(self, server="with", **headers):
        conn = http.client.HTTPConnection(*self.servers[server].server_address, timeout=5)
        self.addCleanup(conn.close)
        conn.request("GET", "/api/market-import", headers={"Host": "here:1", **headers})
        response = conn.getresponse()
        return response, json.loads(response.read())

    def test_the_status_reaches_the_page_stale_after_the_healthchecks_limit(self):
        from market import follow
        self.assertEqual(serve.STALE, follow.STALE)
        now = datetime.now(UTC)
        for age, stale in ((timedelta(hours=25), False), (timedelta(hours=27), True)):
            status = {"at": (now - age).isoformat(), "kinds": {"bars": {"scope": {"state": "caught_up"}}}}
            self.status.write_text(json.dumps(status))
            response, body = self.get()
            self.assertEqual(response.status, 200)
            self.assertNotIn("Access-Control-Allow-Origin", response.headers)
            self.assertEqual((body["status"], body["stale"]), (status, stale))

    def test_a_missing_or_broken_file_is_refused_and_without_one_there_is_no_path(self):
        self.assertEqual(self.get()[1]["code"], "MARKET_IMPORT_UNAVAILABLE")
        for text in ("{", "[]", '{"at": "yesterday"}', '{"kinds": {}}'):
            self.status.write_text(text)
            response, body = self.get()
            self.assertEqual((response.status, body["code"]), (503, "MARKET_IMPORT_UNREADABLE"), text)
        self.assertEqual(self.get("without")[0].status, 404)

    def test_another_site_cannot_read_it(self):
        self.status.write_text(json.dumps({"at": datetime.now(UTC).isoformat()}))
        self.assertEqual(self.get(Host="elsewhere:1")[0].status, 403)
        self.assertEqual(self.get(**{"Sec-Fetch-Site": "cross-site"})[0].status, 403)


class AgentForwardTests(unittest.TestCase):
    """A stand-in chat service records what reaches it and streams its answer in two pieces."""

    def setUp(self):
        self.seen: list[dict] = []
        seen = self.seen
        release = self.release = threading.Event()

        class Agent(serve.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                seen.append({"path": self.path, "host": self.headers["Host"], "body": body})
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()
                for piece in (b"data: one\n\n", b"data: two\n\n"):
                    self.wfile.write(b"%x\r\n%s\r\n" % (len(piece), piece))
                    self.wfile.flush()
                    release.wait(5)
                self.wfile.write(b"0\r\n\r\n")

            def log_message(self, *args):
                pass
        self.agent = serve.Server(("127.0.0.1", 0), Agent)
        threading.Thread(target=self.agent.serve_forever, args=(POLL,), daemon=True).start()
        self.addCleanup(self.agent.server_close)
        self.addCleanup(self.agent.shutdown)
        hub = serve.Hub(FakeProduct(), "build")
        url = "http://%s:%d" % self.agent.server_address
        self.server = serve.Server(("127.0.0.1", 0), serve.handler(hub, frozenset({"here:1"}), url))
        threading.Thread(target=self.server.serve_forever, args=(POLL,), daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def post(self, path, body, **headers):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        self.addCleanup(conn.close)
        conn.request("POST", path, body=body, headers={"Host": "here:1", "Content-Type": "application/json", **headers})
        return conn.getresponse()

    def test_a_chat_request_reaches_the_service_and_its_answer_streams_back(self):
        response = self.post("/api/agent/chat", b'{"q": 1}')
        self.assertEqual(response.status, 200)
        self.assertEqual(response.fp.readline(), b"data: one\n", "the first piece arrives before the answer ends")
        self.release.set()
        self.assertEqual(response.read(), b"\ndata: two\n\n")
        self.assertEqual(self.seen, [{"path": "/api/agent/chat", "host": "%s:%d" % self.agent.server_address, "body": b'{"q": 1}'}])

    def test_a_chat_answer_is_not_gzipped(self):
        response = self.post("/api/agent/chat", b"{}", **{"Accept-Encoding": "gzip"})
        self.assertNotIn("Content-Encoding", response.headers)
        self.release.set()
        self.assertEqual(response.read(), b"data: one\n\ndata: two\n\n")

    def test_another_site_cannot_reach_the_service(self):
        self.assertEqual(self.post("/api/agent/chat", b"{}", **{"Sec-Fetch-Site": "cross-site"}).status, 403)
        self.assertEqual(self.post("/api/agent/chat", b"{}", Host="elsewhere:1").status, 403)
        self.assertEqual(self.post("/api/view", b"{}").status, 404, "only agent paths take a body")
        self.assertEqual(self.seen, [])


class PaperForwardTests(unittest.TestCase):
    """A stand-in paper daemon records what reaches it."""

    def setUp(self):
        self.seen: list[dict] = []
        seen = self.seen

        class Paper(serve.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def answer(self):
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                seen.append({"method": self.command, "path": self.path, "body": body,
                             "token": self.headers.get(serve.PAPER_TOKEN)})
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

            do_GET = do_POST = answer

            def log_message(self, *args):
                pass
        self.paper = serve.Server(("127.0.0.1", 0), Paper)
        threading.Thread(target=self.paper.serve_forever, args=(POLL,), daemon=True).start()
        self.addCleanup(self.paper.server_close)
        self.addCleanup(self.paper.shutdown)
        url = "http://%s:%d" % self.paper.server_address
        self.server = serve.Server(("127.0.0.1", 0), serve.handler(
            serve.Hub(FakeProduct(), "build"), frozenset({"here:1"}), None, url))
        threading.Thread(target=self.server.serve_forever, args=(POLL,), daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def call(self, method, path, body=None, **headers):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        self.addCleanup(conn.close)
        conn.request(method, path, body=body, headers={"Host": "here:1", "Content-Type": "application/json", **headers})
        return conn.getresponse()

    def token(self) -> str:
        page = self.call("GET", "/").read().decode()
        return re.search(r'name="trade-paper-token" content="([^"]+)"', page)[1]

    def test_only_the_page_with_its_token_starts_a_run(self):
        token = self.token()
        refused = [self.call("POST", "/api/paper/runs", b"{}", **{"Sec-Fetch-Site": "same-origin"}),
                   self.call("POST", "/api/paper/runs", b"{}", **{"Sec-Fetch-Site": "same-origin", serve.PAPER_TOKEN: "x"}),
                   self.call("POST", "/api/paper/runs", b"{}", **{"Sec-Fetch-Site": "same-site", serve.PAPER_TOKEN: token})]
        self.assertEqual([response.status for response in refused], [403, 403, 403])
        self.assertEqual(self.seen, [])
        sent = self.call("POST", "/api/paper/runs", b'{"candidate": "a@1"}',
                         **{"Sec-Fetch-Site": "same-origin", serve.PAPER_TOKEN: token})
        self.assertEqual(sent.status, 200)
        self.assertEqual(self.call("GET", "/api/paper/runs").status, 200)
        self.assertEqual(self.seen, [{"method": "POST", "path": "/api/paper/runs", "body": b'{"candidate": "a@1"}', "token": None},
                                     {"method": "GET", "path": "/api/paper/runs", "body": b"", "token": None}])

    def test_a_stale_page_can_renew_only_a_same_origin_pre_forward_nonce_refusal(self):
        token = self.token()
        stale = self.call("POST", "/api/paper/runs", b'{"op_id":"original"}',
                          **{"Sec-Fetch-Site": "same-origin", serve.PAPER_TOKEN: "previous-release"})
        self.assertEqual(stale.status, 403)
        self.assertEqual(stale.getheader(serve.PAPER_TOKEN), token)
        self.assertEqual(self.seen, [])
        sent = self.call("POST", "/api/paper/runs", b'{"op_id":"original"}',
                         **{"Sec-Fetch-Site": "same-origin", serve.PAPER_TOKEN: stale.getheader(serve.PAPER_TOKEN)})
        self.assertEqual(sent.status, 200)
        self.assertEqual(sent.getheader(serve.PAPER_TOKEN), None)
        for headers in ({"Sec-Fetch-Site": "cross-site"}, {"Sec-Fetch-Site": "same-site"},
                        {"Sec-Fetch-Site": "same-origin", "Host": "elsewhere:1"}):
            refused = self.call("POST", "/api/paper/runs", b"{}", **headers)
            self.assertEqual(refused.status, 403)
            self.assertIsNone(refused.getheader(serve.PAPER_TOKEN))
        self.assertEqual(len(self.seen), 1)



class SetupForwardTests(unittest.TestCase):
    """The first-start port is reached like a paper action, and only with a setup URL."""

    def setUp(self):
        self.seen: list[str] = []
        seen = self.seen

        class Setup(serve.BaseHTTPRequestHandler):
            def answer(self):
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                seen.append(f"{self.command} {self.path} {self.headers.get('Host')} {body.decode()}")
                self.send_response(202)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

            do_GET = do_POST = answer

            def log_message(self, *args):
                pass
        self.setup = serve.Server(("127.0.0.1", 0), Setup)
        threading.Thread(target=self.setup.serve_forever, args=(POLL,), daemon=True).start()
        self.addCleanup(self.setup.server_close)
        self.addCleanup(self.setup.shutdown)
        self.upstream = "127.0.0.1:%d" % self.setup.server_address[1]
        self.server = serve.Server(("127.0.0.1", 0), serve.handler(
            serve.Hub(FakeProduct(), "build"), frozenset({"here:1"}), setup=f"http://{self.upstream}"))
        self.without = serve.Server(("127.0.0.1", 0), serve.handler(serve.Hub(FakeProduct(), "build"), frozenset({"here:1"})))
        for server in (self.server, self.without):
            threading.Thread(target=server.serve_forever, args=(POLL,), daemon=True).start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)

    def call(self, method, path, body=None, server=None, **headers):
        conn = http.client.HTTPConnection(*(server or self.server).server_address, timeout=5)
        self.addCleanup(conn.close)
        conn.request(method, path, body=body, headers={"Host": "here:1", **headers})
        return conn.getresponse()

    def test_only_the_page_with_its_token_starts_the_ledger(self):
        token = re.search(r'name="trade-paper-token" content="([^"]+)"', self.call("GET", "/").read().decode())[1]
        refused = [self.call("POST", serve.SETUP, b"{}", **{"Sec-Fetch-Site": "same-origin"}),
                   self.call("POST", serve.SETUP, b"{}", **{"Sec-Fetch-Site": "same-site", serve.PAPER_TOKEN: token}),
                   self.call("POST", serve.SETUP, b"{}", **{"Sec-Fetch-Site": "cross-site", serve.PAPER_TOKEN: token})]
        self.assertEqual([response.status for response in refused], [403, 403, 403])
        self.assertEqual(self.seen, [])
        sent = self.call("POST", serve.SETUP, b'{"repository": "o/r"}',
                         **{"Sec-Fetch-Site": "same-origin", serve.PAPER_TOKEN: token})
        self.assertEqual(sent.status, 202)
        self.assertEqual(self.call("GET", serve.SETUP).status, 202)
        self.assertEqual(self.seen, [f'POST {serve.SETUP} {self.upstream} {{"repository": "o/r"}}',
                                     f"GET {serve.SETUP} {self.upstream} "])

    def test_a_port_that_closed_is_told_apart_from_no_port_at_all(self):
        self.setup.shutdown()
        self.setup.server_close()
        gone = self.call("GET", serve.SETUP)
        self.assertEqual((gone.status, json.loads(gone.read())["code"]), (502, "SETUP_UNAVAILABLE"))
        self.assertEqual(self.call("GET", serve.SETUP, server=self.without).status, 404)
        self.assertEqual(self.call("POST", serve.SETUP, b"{}", server=self.without, **{"Sec-Fetch-Site": "same-origin"}).status, 404)


class OverviewForwardTests(unittest.TestCase):
    """A stand-in overview records what reaches it."""

    def setUp(self):
        self.seen: list[str] = []
        seen = self.seen
        self.more = more = threading.Event()

        class Overview(serve.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_GET(self):
                seen.append(f"{self.command} {self.path}")
                self.send_response(200)
                if self.path.endswith("/stream"):
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Transfer-Encoding", "chunked")
                    self.end_headers()
                    for piece in (b"data: one\n\n", b"data: two\n\n"):
                        self.wfile.write(b"%x\r\n%s\r\n" % (len(piece), piece))
                        self.wfile.flush()
                        more.wait(5)
                    self.wfile.write(b"0\r\n\r\n")
                    return
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", "11")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')

            do_POST = do_DELETE = do_GET

            def log_message(self, *args):
                pass
        self.overview = serve.Server(("127.0.0.1", 0), Overview)
        threading.Thread(target=self.overview.serve_forever, args=(POLL,), daemon=True).start()
        self.addCleanup(self.overview.server_close)
        self.addCleanup(self.overview.shutdown)
        url = "http://%s:%d" % self.overview.server_address
        self.server = serve.Server(("127.0.0.1", 0), serve.handler(
            serve.Hub(FakeProduct(), "build"), frozenset({"here:1"}), overview=url))
        threading.Thread(target=self.server.serve_forever, args=(POLL,), daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def call(self, method, path, **headers):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        self.addCleanup(conn.close)
        conn.request(method, path, body=b"{}" if method != "GET" else None, headers={"Host": "here:1", **headers})
        return conn.getresponse()

    def test_a_forwarded_answer_is_gzipped_and_a_stream_still_arrives_as_it_goes(self):
        answer = self.call("GET", "/api/overview/snapshot", **{"Accept-Encoding": "gzip"})
        self.assertEqual(answer.headers["Content-Encoding"], "gzip")
        self.assertEqual(gzip.decompress(answer.read()), b'{"ok":true}')
        plain = self.call("GET", "/api/overview/snapshot")
        self.assertNotIn("Content-Encoding", plain.headers)
        self.assertEqual(plain.read(), b'{"ok":true}')

        stream = self.call("GET", "/api/overview/stream", **{"Accept-Encoding": "gzip"})
        self.assertEqual(stream.headers["Content-Encoding"], "gzip")
        reader, seen = zlib.decompressobj(31), b""
        while b"data: one\n\n" not in seen:
            seen += reader.decompress(stream.read1(65536))
        self.assertFalse(self.more.is_set(), "the first event arrived before the second was sent")
        self.more.set()
        while chunk := stream.read1(65536):
            seen += reader.decompress(chunk)
        self.assertEqual(seen, b"data: one\n\ndata: two\n\n")

    def test_only_the_pages_reads_reach_the_overview(self):
        self.assertEqual(self.call("GET", "/api/overview/snapshot").status, 200)
        refused = [self.call(method, "/api/overview/snapshot", **{"Sec-Fetch-Site": "same-origin"}).status for method in ("POST", "DELETE")]
        self.assertEqual(refused, [405, 405])
        self.assertEqual(self.call("GET", "/api/overview/snapshot", **{"Sec-Fetch-Site": "cross-site"}).status, 403)
        self.assertEqual(self.seen, ["GET /api/overview/snapshot"])


if __name__ == "__main__":
    unittest.main()
