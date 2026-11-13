"""Telegram notices: private settings, chat binding, no history at first enable, one sender, bounded retries.

Every Telegram call is injected; no test reaches the network.
"""

from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from engine.live_errors import LiveRefusal
from live import notify, state
from tests.live import test_views


TOKEN = "123456789:" + "A" * 35
DAY = int(datetime(2026, 11, 9, tzinfo=timezone.utc).timestamp()) * 10**9
HOUR = 3600 * 10**9


def private_update(chat_id, kind="private", name="message"):
    return {"update_id": chat_id, name: {"message_id": 1, "chat": {"id": chat_id, "type": kind}, "text": "hi"}}


class Telegram:
    """Records calls; `updates` answers getUpdates, `failures` makes the next sends fail."""

    def __init__(self, updates=(), failures=()):
        self.updates, self.failures, self.calls = list(updates), list(failures), []

    def __call__(self, token, method, payload):
        self.calls.append((token, method, payload))
        if self.failures:
            raise self.failures.pop(0)
        if method == "getUpdates":
            return {"ok": True, "result": self.updates}
        return {"ok": True, "result": {}}

    def texts(self):
        return [payload["text"] for _, method, payload in self.calls if method == "sendMessage"]


def run(run_id="run-a", state_="running", mode="run", **fields):
    return {"run_id": run_id, "source_name": "example", "host": {"state": state_, "mode": mode, "exit_code": None},
            "terminal": None, "custody": {"archived": False}, "orders": [], "positions": [], "minute_results": [],
            "account": None, "stop_reason": None, **fields}


def fill(trade, ts, side="BUY"):
    return {"event_type": "OrderFilled", "client_order_id": "cid-1", "trade_id": trade, "ts_event": str(ts),
            "order_side": side, "last_qty": "0.001", "last_px": "75000", "instrument_id": "BTCUSDT-PERP.BINANCE"}


class Base(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve() / "custody"
        with state.serialized(self.root):
            pass
        self.config = SimpleNamespace(root=self.root, sources={})

    def refused(self, code, action, body, call):
        with self.assertRaises(LiveRefusal) as caught:
            notify.execute(self.config, action, body, call=call)
        self.assertEqual(caught.exception.code, code)
        self.assertNotIn(TOKEN, str(caught.exception))


class Settings(Base):
    def test_save_binds_the_single_private_chat_in_private_files_and_never_returns_the_token(self):
        call = Telegram([private_update(42), private_update(-100, kind="group"), private_update(42, name="edited_message")])
        result = notify.execute(self.config, "notify_save", {"bot_token": TOKEN}, call=call)
        self.assertEqual(result, {"configured": True, "last_sent_ns": None, "last_error": None, "dropped": 0})
        directory = self.root / "notify"
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        saved = directory / "telegram.json"
        self.assertEqual(saved.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(saved.read_bytes()), {"bot_token": TOKEN, "chat_id": 42})
        self.assertEqual((directory / "state.json").stat().st_mode & 0o777, 0o600)
        self.assertNotIn(TOKEN, json.dumps(notify.view(self.root)))
        self.assertNotIn(TOKEN, (directory / "state.json").read_text())
        self.assertEqual([name for _, name, _ in call.calls], ["getUpdates"])

    def test_binding_refuses_none_or_several_chats_and_a_rejected_or_malformed_token_without_saving(self):
        self.refused("LIVE_NOTIFY_NO_CHAT", "notify_save", {"bot_token": TOKEN}, Telegram([private_update(-5, kind="group")]))
        self.refused("LIVE_NOTIFY_CHATS", "notify_save", {"bot_token": TOKEN}, Telegram([private_update(1), private_update(2)]))
        self.refused("LIVE_NOTIFY_TOKEN", "notify_save", {"bot_token": TOKEN}, Telegram(failures=[notify.Failure("http_4xx", 401)]))
        self.refused("LIVE_NOTIFY_TELEGRAM", "notify_save", {"bot_token": TOKEN}, Telegram(failures=[notify.Failure("network")]))
        untouched = Telegram()
        self.refused("LIVE_NOTIFY_TOKEN", "notify_save", {"bot_token": "not a token"}, untouched)
        self.refused("LIVE_CONFIG", "notify_save", {"bot_token": TOKEN, "chat_id": 1}, untouched)
        self.assertEqual(untouched.calls, [])
        self.assertFalse((self.root / "notify" / "telegram.json").exists())
        self.assertFalse(notify.view(self.root)["configured"])

    def test_test_message_records_its_failure_and_success_and_remove_deletes_both_files(self):
        self.refused("LIVE_NOTIFY_UNCONFIGURED", "notify_test", {}, Telegram())
        notify.execute(self.config, "notify_save", {"bot_token": TOKEN}, call=Telegram([private_update(7)]))
        self.refused("LIVE_NOTIFY_TELEGRAM", "notify_test", {}, Telegram(failures=[notify.Failure("http_4xx", 403)]))
        self.assertEqual(notify.view(self.root)["last_error"]["code"], "http_4xx")
        call = Telegram()
        result = notify.execute(self.config, "notify_test", {}, call=call)
        self.assertIsNone(result["last_error"])
        self.assertIsNotNone(result["last_sent_ns"])
        self.assertEqual(call.calls[0][2]["chat_id"], 7)
        result = notify.execute(self.config, "notify_remove", {}, call=Telegram())
        self.assertEqual(result, {"configured": False, "last_sent_ns": None, "last_error": None, "dropped": 0})
        self.assertEqual(sorted(path.name for path in (self.root / "notify").iterdir()), ["lock"])

    def test_a_settings_command_waits_for_a_sending_control_then_refuses_as_busy(self):
        notify.execute(self.config, "notify_save", {"bot_token": TOKEN}, call=Telegram([private_update(7)]))
        with open(self.root / "notify" / "lock", "r+") as held, patch.object(notify, "WAIT", 0.3):
            fcntl.flock(held, fcntl.LOCK_EX)
            self.refused("LIVE_NOTIFY_BUSY", "notify_test", {}, Telegram())


class Sending(Base):
    def setUp(self):
        super().setUp()
        notify.execute(self.config, "notify_save", {"bot_token": TOKEN}, call=Telegram([private_update(42)]))
        self.facts = []
        collect = patch.object(notify, "collect", side_effect=lambda config, skip: [
            fact for fact in self.facts if fact["run_id"] not in skip])
        collect.start()
        self.addCleanup(collect.stop)

    def tick(self, now, call=None):
        call = call or Telegram()
        notify.tick(self.config, call=call, now=now)
        return call

    def record(self):
        return json.loads((self.root / "notify" / "state.json").read_text())

    def test_first_enable_sends_no_history_and_then_only_what_is_new(self):
        self.facts = [run(orders=[fill("t1", DAY + HOUR)]), run("run-b", "clean_stopped", stop_reason="duration")]
        self.assertEqual(self.tick(DAY + 2 * HOUR).calls, [])
        self.facts[0]["orders"].append(fill("t2", DAY + 3 * HOUR, side="SELL"))
        texts = self.tick(DAY + 3 * HOUR).texts()
        self.assertEqual(texts, ["Live run run-a (example) fill: SELL 0.001 BTCUSDT-PERP.BINANCE at 75000."])
        self.assertEqual(self.tick(DAY + 3 * HOUR + 10).calls, [])

    def test_two_controls_never_both_send_and_a_held_lock_skips_the_tick(self):
        self.tick(DAY)
        self.facts = [run()]
        with open(self.root / "notify" / "lock", "r+") as held:
            fcntl.flock(held, fcntl.LOCK_EX)
            self.assertEqual(self.tick(DAY + 10).calls, [])
        first, second = self.tick(DAY + 20), self.tick(DAY + 20)
        self.assertEqual(first.texts(), ["Live run run-a (example) started."])
        self.assertEqual(second.calls, [])

    def test_failures_keep_order_back_off_without_a_cap_and_only_a_refused_message_is_dropped(self):
        self.tick(DAY)
        self.facts = [run(), run("run-b")]
        failing = Telegram(failures=[notify.Failure("network")])
        self.tick(DAY + 10, failing)
        self.assertEqual(len(failing.calls), 1)  # a failure ends the tick
        self.assertEqual(notify.view(self.root)["last_error"], {"code": "network", "at_ns": str(DAY + 10)})
        self.assertEqual(self.tick(DAY + 11).calls, [])  # nothing overtakes the message waiting for its backoff
        now = DAY + 10
        for count in range(1, 12):  # far past any fixed cap: a transient failure is never a reason to drop
            now += min(notify.BACKOFF_NS * 2 ** (count - 1), notify.MAX_BACKOFF_NS)
            self.tick(now, Telegram(failures=[notify.Failure("http_5xx", 502)]))
        self.assertEqual(self.record()["attempts"]["run-a:running:run"]["n"], 12)
        self.assertEqual(notify.view(self.root)["dropped"], 0)
        now += notify.MAX_BACKOFF_NS
        retry = self.tick(now)
        self.assertEqual(retry.texts(), ["Live run run-a (example) started.", "Live run run-b (example) started."])
        self.assertIsNone(notify.view(self.root)["last_error"])
        self.assertEqual(self.record()["attempts"], {})
        self.facts.append(run("run-c"))
        self.tick(now + 1, Telegram(failures=[notify.Failure("http_4xx", 400)]))
        self.assertEqual(notify.view(self.root)["dropped"], 1)
        self.assertEqual(self.tick(now + 2).calls, [])

    def test_daily_summary_comes_once_at_the_first_tick_of_the_utc_day_with_the_previous_days_fills(self):
        self.facts = [run(account={"usdt_wallet": "100.5", "observed_ns": str(DAY - HOUR)},
                          positions=[{"event_type": "PositionOpened", "position_id": "p1", "instrument_id": "BTCUSDT-PERP.BINANCE",
                                      "side": "LONG", "quantity": "0.001"}])]
        self.tick(DAY + 22 * HOUR)  # baseline on 2026-11-09
        self.facts[0]["orders"] = [fill("t1", DAY + 23 * HOUR), fill("t2", DAY + 23 * HOUR + 1)]
        before = self.tick(DAY + 24 * HOUR - 10**9)
        self.assertEqual(len(before.texts()), 2)
        after = self.tick(DAY + 24 * HOUR + 5 * 10**9).texts()
        self.assertEqual(len(after), 1)
        self.assertIn("Live daily summary for 2026-11-09 (UTC)", after[0])
        self.assertIn("Wallet: 100.5 USDT, observed 2026-11-08 23:00 UTC by run run-a", after[0])
        self.assertIn("Open positions (no recorded close): run-a BTCUSDT-PERP.BINANCE LONG 0.001", after[0])
        self.assertIn("Fills: 2", after[0])
        self.assertEqual(self.tick(DAY + 25 * HOUR).calls, [])

    def test_ended_and_unresolved_runs_say_why_and_a_closed_run_is_no_longer_read(self):
        self.tick(DAY)
        self.facts = [run("run-a", "clean_stopped", mode="run", stop_reason="max_loss", minute_results=[["1", "-1.5"], ["2", None]],
                          host={"state": "clean_stopped", "mode": "run", "exit_code": 1}, custody={"archived": True}),
                      run("run-b", "unresolved", terminal={"observed_ns": "9"})]
        texts = self.tick(DAY + 10).texts()
        self.assertEqual(texts[0], "Live run run-a (example) ended: stopped flat. Stop reason: max_loss. Result: -1.5 USDT. "
                                   "Needs attention: exit code 1.")
        self.assertIn("run-b (example) is UNRESOLVED and needs attention now", texts[1])
        self.assertEqual(self.record()["closed"], ["run-a"])
        self.assertEqual(self.record()["done"], ["@daily:2026-11-09", "run-b:unresolved:run"])
        self.assertEqual(self.tick(DAY + 20).calls, [])

    def test_entries_closed_beyond_a_brief_reconnect_are_noticed_and_so_is_their_reopening(self):
        gate = [{"event": "entries_closed", "observed_ns": "1", "reasons": ["disconnected"], "socket": "BINANCE user"},
                {"event": "entries_opened", "observed_ns": "2", "reasons": ["unverified"], "socket": None},
                {"event": "entries_closed", "observed_ns": "3", "reasons": ["disconnected"], "socket": "BINANCE user"},
                {"event": "connection_lost", "observed_ns": "4", "reasons": [], "socket": "BINANCE user"},
                {"event": "entries_opened", "observed_ns": "5", "reasons": ["unverified"], "socket": None},
                {"event": "entries_closed", "observed_ns": "6", "reasons": ["bars_missing"], "socket": None}]
        texts = [text for key, text in notify.messages(run(gate=gate)) if ":gate:" in key]
        self.assertEqual(len(texts), 3)  # a brief reconnect, closed and reopened, says nothing
        self.assertIn("down for over a minute", texts[0])
        self.assertIn("entries are open", texts[1])
        self.assertIn("a bar is missing from the feed, so entries are closed", texts[2])
        self.assertIn("starts again and warms up", texts[2])

    def test_a_start_again_to_warm_up_is_noticed_once_and_so_is_the_reopening(self):
        restarts = [{"event": "warmup", "observed_ns": "1", "held": None},  # the first start: nothing to say
                    {"event": "rewarming", "observed_ns": "2", "held": None},
                    {"event": "resuming", "observed_ns": "3", "held": False},
                    {"event": "warmup", "observed_ns": "4", "held": None},
                    {"event": "interrupted", "observed_ns": "5", "held": None},
                    {"event": "resuming", "observed_ns": "6", "held": False},
                    {"event": "warmup", "observed_ns": "7", "held": None}]
        sent = [(key, text) for key, text in notify.messages(run(restarts=restarts)) if ":restart:" in key]
        self.assertEqual([key for key, _ in sent], ["run-a:restart:rewarming:2", "run-a:restart:warmup:4",
                                                    "run-a:restart:interrupted:5", "run-a:restart:resuming:6"])
        self.assertIn("starts again to warm up", sent[0][1])
        self.assertIn("entries are open", sent[1][1])

    def test_a_failed_warm_up_started_once_more_and_reduce_only_orders_left_are_noticed(self):
        restarts = [{"event": "rewarming", "observed_ns": "2", "held": None, "retry": False},
                    {"event": "resuming", "observed_ns": "3", "held": False, "retry": False},
                    {"event": "rewarming", "observed_ns": "4", "held": None, "retry": True},
                    {"event": "resuming", "observed_ns": "5", "held": False, "retry": False},
                    {"event": "warmup", "observed_ns": "6", "held": None, "retry": False}]
        sent = [(key, text) for key, text in notify.messages(run(restarts=restarts)) if ":restart:" in key]
        self.assertEqual([key for key, _ in sent], ["run-a:restart:rewarming:2", "run-a:restart:rewarming:4",
                                                    "run-a:restart:warmup:6"])
        self.assertIn("could not warm up again after the missing bar; it starts once more", sent[1][1])
        self.assertIn("If that warm-up fails too, the run ends", sent[1][1])
        gate = [{"event": "orphan_orders", "observed_ns": "7", "reasons": [], "socket": None}]
        [(key, text)] = [(key, text) for key, text in notify.messages(run(gate=gate)) if ":gate:" in key]
        self.assertEqual(key, "run-a:gate:7")
        self.assertIn("Binance has kept its reduce-only orders for over ten minutes", text)
        self.assertIn("cancel them at Binance if nothing needs them", text)

    def test_a_contract_not_trading_and_the_reopening_after_it_are_noticed(self):
        gate = [{"event": "entries_closed", "observed_ns": "1", "reasons": ["contract_status"], "socket": None,
                 "status": "SETTLING"},
                {"event": "entries_checking", "observed_ns": "2", "reasons": ["unverified"], "socket": None,
                 "status": "TRADING"},
                {"event": "entries_opened", "observed_ns": "3", "reasons": ["unverified"], "socket": None, "status": None}]
        sent = [(key, text) for key, text in notify.messages(run(gate=gate)) if ":gate:" in key]
        self.assertEqual([key for key, _ in sent], ["run-a:gate:1", "run-a:gate:3"])
        self.assertIn("Binance lists its contract as SETTLING, so entries are closed", sent[0][1])
        self.assertIn("a new entry from the strategy is denied and the run goes on", sent[0][1])
        self.assertIn("entries are open", sent[1][1])

    def test_the_brake_and_a_failed_key_check_and_its_recovery_are_noticed(self):
        facts = run(brake={"peak": "104", "fired": {"equity": "88", "peak": "104", "drawdown": "0.1538",
                                                    "observed_ns": "3"}},
                    key_checks=[{"event": "key_check_failed", "code": "LIVE_KEY_WITHDRAWAL", "observed_ns": "4"},
                                {"event": "key_check_passed", "code": None, "observed_ns": "5"}])
        texts = [text for key, text in notify.messages(facts) if ":brake" in key or ":key:" in key]
        self.assertIn("hit its drawdown brake: equity 88 USDT is 0.1538 below its highest 104 USDT", texts[0])
        self.assertIn("failed the periodic check (LIVE_KEY_WITHDRAWAL)", texts[1])
        self.assertIn("passes the periodic check again", texts[2])

    def test_an_interruption_each_start_again_and_the_restart_limit_are_noticed(self):
        restarts = [{"event": "interrupted", "observed_ns": "1", "held": None},
                    {"event": "resuming", "observed_ns": "2", "held": True},
                    {"event": "venue_flat_while_held", "observed_ns": "3", "held": None},
                    {"event": "resuming", "observed_ns": "4", "held": False},
                    {"event": "held_flat", "observed_ns": "5", "held": None},
                    {"event": "restart_limited", "observed_ns": "6", "held": None}]
        texts = [text for key, text in notify.messages(run(restarts=restarts)) if ":restart:" in key]
        self.assertEqual(len(texts), 5)  # held_flat only ends a start; venue_flat_while_held already said so
        self.assertIn("interrupted without closing", texts[0])
        self.assertIn("protected only by its stop at Binance: the strategy no longer manages its exits", texts[1])
        self.assertIn("close the position at Binance", texts[1])
        keys = [key for key, _ in notify.messages(run(restarts=restarts)) if ":restart:" in key]
        self.assertEqual(keys[1], "run-a:restart:resuming:2", "the key the earlier text was sent under: no resend")
        self.assertIn("flat at Binance again", texts[2])
        self.assertIn("flat account", texts[3])
        self.assertIn("no longer started again automatically", texts[4])

    def test_a_closed_run_stays_read_until_the_summary_after_its_last_fill_and_while_it_holds_the_newest_wallet(self):
        self.tick(DAY)
        ended = {"host": {"state": "clean_stopped", "mode": "run", "exit_code": 0}, "custody": {"archived": True},
                 "terminal": {"observed_ns": str(DAY + 2 * HOUR)}}
        compared = {"day": "2026-11-09", "state": "done"}
        self.facts = [run("run-a", orders=[fill("t1", DAY + HOUR)], compare=compared, **ended),
                      run("run-b", account={"usdt_wallet": "99", "observed_ns": str(DAY + HOUR)}, compare=compared,
                          **ended)]
        self.tick(DAY + 3 * HOUR)
        self.assertEqual(self.record()["closed"], [])
        summary = self.tick(DAY + 24 * HOUR + 10).texts()
        self.assertIn("Fills: 1", summary[0])
        self.assertIn("Wallet: 99 USDT", summary[0])
        self.assertEqual(self.record()["closed"], ["run-a"])  # run-b still holds the newest wallet observation

    def test_the_daily_comparison_reports_unexplained_decisions_the_week_and_repeated_failures(self):
        done = {"day": "2026-11-08", "state": "done", "unexplained_count": 2, "unexplained_week": 3,
                "unexplained": [{"at": "2026-11-08T03:00:00Z", "at_ns": 1, "class": "run_only"}],
                "measures": {"groups": 9, "entries_unfilled": 1, "partial_fills": 0, "adverse_slippage_bps": 2.25,
                             "fees": {"difference": "0.01"}, "equity_change": {"difference": "-0.4"},
                             "holds": {"held": 2, "held_ns_median": 4 * 10**9, "held_ns_p90": 31 * 10**9}}}
        sent = [(key, text) for key, text in notify.messages(run(compare=done)) if ":compare" in key]
        self.assertEqual([key for key, _ in sent], ["run-a:compare:2026-11-08", "run-a:compare-week:2026-11-08"])
        self.assertIn("2 of its decisions differ from the replay's with no known cause (the first at "
                      "2026-11-08T03:00:00Z)", sent[0][1])
        self.assertIn("9 decisions, 3 unexplained; entries the replay filled and Live did not: 1; partial fills: 0; "
                      "mean adverse slippage: 2.2 bps; fees Live less replay: 0.01 USDT; equity change Live less "
                      "replay: -0.4 USDT; held entries: 2 (median 4 s, p90 31 s)", sent[1][1])
        weekday = {**done, "day": "2026-11-09", "unexplained_count": 0}
        self.assertEqual([key for key, _ in notify.messages(run(compare=weekday)) if ":compare" in key], [])
        for failures, expected in ((1, []), (2, ["run-a:compare-failed:2026-11-09"])):
            failed = {"day": "2026-11-09", "state": "failed", "code": "LIVE_COMPARE_EMPTY", "failures": failures}
            self.assertEqual([key for key, _ in notify.messages(run(compare=failed)) if ":compare" in key], expected)

    def test_an_ended_run_stays_read_until_its_last_day_is_compared_or_three_days_pass(self):
        self.tick(DAY)
        ended = {"host": {"state": "clean_stopped", "mode": "run", "exit_code": 0}, "custody": {"archived": True},
                 "terminal": {"observed_ns": str(DAY + 2 * HOUR)}}
        self.facts = [run("run-a", compare={"day": "2026-11-09", "state": "waiting"}, **ended)]
        self.tick(DAY + 24 * HOUR + 10)
        self.assertEqual(self.record()["closed"], [])  # the summary after its last day is out, the comparison not
        self.facts[0]["compare"] = {"day": "2026-11-09", "state": "empty"}
        self.tick(DAY + 25 * HOUR)
        self.assertEqual(self.record()["closed"], ["run-a"])
        self.facts = [run("run-b", compare=None, **ended)]
        for days in (2, 3):  # the summary of 11-12, three days after its last, is still read
            self.tick(DAY + days * 24 * HOUR + 10)
            self.assertEqual(self.record()["closed"], ["run-a"])
        self.tick(DAY + 4 * 24 * HOUR + 10)
        self.assertEqual(self.record()["closed"], ["run-a", "run-b"])

    def test_no_failure_of_notification_reaches_the_maintenance_loop(self):
        self.tick(DAY)
        self.facts = [run()]
        notify.tick(self.config, call=Telegram(failures=[RuntimeError("unexpected")]), now=DAY + 10)
        with patch.object(notify, "collect", side_effect=OSError("disk")):
            notify.tick(self.config, call=Telegram(), now=DAY + 20)
        (self.root / "notify" / "state.json").write_text("{")
        notify.tick(self.config, call=Telegram(), now=DAY + 30)
        self.assertEqual(notify.view(self.root)["last_error"], {"code": "unavailable", "at_ns": None})
        os.chmod(self.root / "notify", 0o755)
        notify.tick(self.config, call=Telegram(), now=DAY + 40)


class Collecting(test_views.LiveViewTests):
    def test_collect_reads_the_browser_safe_view_with_a_safe_stop_reason_and_the_configured_source(self):
        self.native("order", native={"type": "OrderFilled", "client_order_id": "cid-1", "trade_id": "t1",
                                     "instrument_id": "BTCUSDT-PERP.BINANCE", "ts_event": 1794000000000000001,
                                     "order_side": "BUY", "last_qty": "0.001", "last_px": "75000"})
        self.native("stopping", reason="SECRET reason with spaces")
        source = SimpleNamespace(source_id="deployed", candidate="example-live@2", purpose="natural",
                                 source_sha256=self.manifest["source"]["source_sha256"], entry_class="Example")
        facts = notify.collect(SimpleNamespace(root=self.root, sources={"deployed": source}), set())
        self.assertEqual([fact["source_name"] for fact in facts], ["example-live@2"])
        self.assertEqual(facts[0]["stop_reason"], "other")
        texts = [text for _, text in notify.messages(facts[0])]
        self.assertEqual(texts, ["Live run probe-one (example-live@2) fill: BUY 0.001 BTCUSDT-PERP.BINANCE at 75000."])
        # The release names the IDE's page; each notice then ends with the run's page there, under the same key.
        with patch.dict(os.environ, {"TRADE_PAGE": "https://trade.example.com"}):
            linked = notify.messages(facts[0])
        self.assertEqual([key for key, _ in linked], [key for key, _ in notify.messages(facts[0])])
        self.assertEqual([text for _, text in linked], [texts[0] + "\nhttps://trade.example.com/?live=probe-one"])
        for page in ("http://trade.example.com", "https://trade.example.com/x", "https://evil.test\n"):
            with patch.dict(os.environ, {"TRADE_PAGE": page}):
                self.assertEqual([text for _, text in notify.messages(facts[0])], texts, page)
        self.assertEqual(notify.collect(SimpleNamespace(root=self.root, sources={}), {"probe-one"}), [])


for _name in [name for name in vars(test_views.LiveViewTests) if name.startswith("test_")]:
    setattr(Collecting, _name, None)  # only the fixture is borrowed; the view tests run in test_views
