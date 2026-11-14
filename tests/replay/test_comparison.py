"""If this fails, a run compared with its replay (Paper or Live) is misjudged: an order filled in pieces counts
as several, an exit lands in another position's group, concurrent positions or a scale-out's exits are paired across
each other and read as differences or a look-ahead suspect, a difference is called unexplained while a known product
cause (a missing, late or differing live bar, the warm-up, the contract terms or fee rates, the window's end, Live's entry gate) applies,
the causes are not tried in their order, a difference the replay did not make alone is a look-ahead suspect, a later
difference is taken for a cause of its own, or a warm-up the archive repeats exactly reads as different."""

from __future__ import annotations

from decimal import Decimal
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from engine.config import utc_text
from replay import comparison


MINUTE = comparison.MINUTE_NS
START = 1_792_949_160 * 10**9  # 2026-10-25T17:26:00Z
BTC = "BTCUSDT-PERP.BINANCE"


def close_of(i: int) -> int:
    return START + (i + 1) * MINUTE - 10**6


def order(name: str, tag: str, side: str, at: int, qty: str = "1", *, kind: str = "LIMIT", price: str | None = "100.0",
          trigger: str | None = None, reduce_only: bool | None = None) -> dict:
    return {"type": "OrderInitialized", "client_order_id": name, "instrument_id": BTC, "order_side": side,
            "order_type": kind, "quantity": qty, "price": price, "trigger_price": trigger, "tags": [tag],
            "reduce_only": tag != "ENTRY" if reduce_only is None else reduce_only, "ts_init": at, "ts_event": at}


def fill(name: str, at: int, px: str, qty: str, side: str, position: str, commission: str = "0.10 USDT") -> dict:
    return {"type": "OrderFilled", "client_order_id": name, "instrument_id": BTC, "order_side": side, "last_px": px,
            "last_qty": qty, "commission": commission, "position_id": position, "ts_event": at}


def bar(i: int, close: str = "100.0", wall_ns: int | None = None) -> dict:
    return {"instrument_id": BTC, "ts_event": close_of(i), "wall_ns": close_of(i) + 10**7 if wall_ns is None else wall_ns,
            "open": "100.0", "high": "101.0", "low": "99.0", "close": close, "volume": "5"}


def archived(minutes: int, closes: dict[int, str] | None = None) -> list[list]:
    return [[START // 10**6 + i * 60_000, START // 10**6 + i * 60_000 + 59_999, "100.0", "101.0", "99.0",
             (closes or {}).get(i, "100.0"), "5"] for i in range(minutes)]


def compared(run_events: list[dict], replay_events: list[dict], minutes: int = 40, *, skip: tuple[int, ...] = (),
             closes: dict[int, str] | None = None, late: tuple[int, ...] = (), early: tuple[int, ...] = (),
             **context) -> dict:
    bars = [bar(i, (closes or {}).get(i, "100.0"), close_of(i) + 5 * 10**9 if i in late else None)
            | {"ts_init": close_of(i) - 10**6 if i in early else close_of(i) + 10**7}
            for i in range(minutes) if i not in skip]
    run = {"bars": bars, "events": run_events, **{key: context.pop(key) for key in ("warmup", "terms", "fees",
                                                                                   "settlements", "gate") if key in context}}
    return comparison.compare(run, replay_events, {"BTCUSDT": archived(minutes)}, None, START, START + minutes * MINUTE,
                             **context)


def bracket(prefix: str, at: int, filled_at: int, position: str, *, qty: str = "1", px: str = "100.0",
            delay: int = 0) -> list[dict]:
    """An entry filled at `filled_at` with its stop (never filled)."""
    return [order(f"{prefix}-E", "ENTRY", "BUY", at + delay, qty, price=px),
            fill(f"{prefix}-E", filled_at + delay, px, qty, "BUY", position),
            order(f"{prefix}-S", "STOP_LOSS", "SELL", filled_at + delay, qty, kind="STOP_MARKET", price=None,
                  trigger="95.0")]


class Groups(unittest.TestCase):
    def test_an_order_filled_in_pieces_is_one_order_at_its_weighted_price(self):
        [found] = comparison.orders([order("A", "ENTRY", "BUY", START, "4"), fill("A", close_of(2), "100.0", "1", "BUY", "P"),
                                    fill("A", close_of(2), "100.4", "3", "BUY", "P")])
        self.assertEqual((found["filled"]["qty"], found["filled"]["px"], found["role"], found["position"]),
                         (4, Decimal("100.3"), "entry", "P"))
        self.assertEqual(found["filled"]["commission"], Decimal("0.20"))

    def test_an_entry_its_stop_and_its_scale_out_are_one_group_and_concurrent_positions_two(self):
        events = [*bracket("A", close_of(1), close_of(1), "PA"), *bracket("B", close_of(2), close_of(2), "PB", qty="2"),
                  order("A-T1", "TAKE_PROFIT", "SELL", close_of(1), "0.5", price="102.0"),
                  order("A-T2", "TAKE_PROFIT", "SELL", close_of(1), "0.5", price="103.0"),
                  fill("A-T1", close_of(5), "102.0", "0.5", "SELL", "PA")]
        found = comparison.groups(comparison.orders(events))
        self.assertEqual([(g["entry"]["order"], [o["order"] for o in g["exits"]]) for g in found],
                         [("A-E", ["A-S", "A-T1", "A-T2"]), ("B-E", ["B-S"])])

    def test_an_unfilled_exit_goes_to_the_latest_position_that_still_held_its_quantity(self):
        events = [*bracket("A", close_of(1), close_of(1), "PA", qty="1"), *bracket("B", close_of(3), close_of(3), "PB", qty="2"),
                  order("X", "TAKE_PROFIT", "SELL", close_of(4), "2", price="103.0")]
        found = comparison.groups(comparison.orders(events))
        self.assertEqual([o["order"] for o in found[1]["exits"]], ["B-S", "X"])


class Pairing(unittest.TestCase):
    """The pairing by entry order (user 2026-11-12) against the earlier pairing by contract, side, role and time."""

    def concurrent(self, paper_late: int, replay_ids: tuple[str, str] = ("r9", "r1")) -> tuple[list[dict], list[dict]]:
        """Two longs X (1) and Y (2) entered on the same bar, each closed by its own target. By default the replay's
        order IDs sort Y before X, as random UUIDs may; the run's Y target fills `paper_late` minutes after the
        replay's."""
        def side(prefix: str, x: str, y: str, late: int) -> list[dict]:
            return [order(x + "-E", "ENTRY", "BUY", close_of(2), "1"), fill(x + "-E", close_of(2), "100.0", "1", "BUY", prefix + "X"),
                    order(y + "-E", "ENTRY", "BUY", close_of(2), "2", price="99.5"),
                    fill(y + "-E", close_of(2), "99.5", "2", "BUY", prefix + "Y"),
                    order(x + "-T", "TAKE_PROFIT", "SELL", close_of(2), "1", price="101.0"),
                    order(y + "-T", "TAKE_PROFIT", "SELL", close_of(2), "2", price="101.5"),
                    fill(x + "-T", close_of(10), "101.0", "1", "SELL", prefix + "X"),
                    fill(y + "-T", close_of(10 + late), "101.5", "2", "SELL", prefix + "Y")]
        return side("p", "p1", "p2", paper_late), side("r", *replay_ids, 0)

    def test_concurrent_positions_that_agree_are_the_same(self):
        """Positive control: the time pairing paired the run's X entry and target with the replay's Y ones (the
        nearest, then the first by order ID) and read these identical runs as four unexplained quantity
        differences."""
        found = compared(*self.concurrent(0))
        self.assertEqual((found["summary"]["groups"], found["summary"]["same"]), (2, 2))

    def test_a_later_exit_of_one_concurrent_position_is_that_groups_difference_alone(self):
        """The time pairing read X as differing too, and Y's late target as a replay-only and a paper-only fill."""
        found = compared(*self.concurrent(15))
        x, y = found["groups"]
        self.assertEqual((x["class"], x["run_position"], x["replay_position"]), ("same", "pX", "rX"))
        self.assertEqual((y["class"], y["stage"], y["orders"][y["first"]]["class"], y["cause"], y["look_ahead_suspect"]),
                         ("differs", "fill", "time", "unexplained", False))
        self.assertEqual(found["summary"]["look_ahead_suspects"], 0)

    def test_an_exit_later_than_pair_ns_stays_in_its_group_and_is_no_look_ahead_suspect(self):
        """Positive control: with X and Y in order, the time pairing found no run fill within PAIR_NS of the replay's
        Y target and flagged it, a replay-only fill without a live cause, as a look-ahead suspect."""
        found = compared(*self.concurrent(15, ("r1", "r2")))
        self.assertEqual([(g["class"], g["stage"], g.get("look_ahead_suspect")) for g in found["groups"]],
                         [("same", None, None), ("differs", "fill", False)])
        self.assertEqual(found["summary"]["look_ahead_suspects"], 0)

    def test_a_scale_outs_targets_sent_at_one_instant_pair_by_their_terms_not_their_ids(self):
        """Found on a real replay: a source sends both targets in one callback, at one ts_init, and the native reports
        list orders by ID, so neither gives the order they were sent in; by ID these targets cross."""
        def side(prefix: str, first: str, second: str) -> list[dict]:
            return [order(prefix + "E", "ENTRY", "BUY", close_of(1)), fill(prefix + "E", close_of(1), "100.0", "1", "BUY", prefix),
                    order(first, "TAKE_PROFIT", "SELL", close_of(1), "0.5", price="101.0"),
                    order(second, "TAKE_PROFIT", "SELL", close_of(1), "0.5", price="102.0"),
                    fill(first, close_of(6), "101.0", "0.5", "SELL", prefix), fill(second, close_of(6), "102.0", "0.5", "SELL", prefix)]
        found = compared(side("p", "p-b", "p-a"), side("r", "r-a", "r-b"))
        [group] = found["groups"]
        self.assertEqual(group["class"], "same")
        self.assertEqual([(row["run"]["price"], row["replay"]["price"]) for row in group["orders"][1:]],
                         [("101", "101"), ("102", "102")])

    def test_entries_further_apart_than_pair_ns_are_different_trades(self):
        run = bracket("p", close_of(1), close_of(1), "P")
        replay = bracket("r", close_of(1) + comparison.PAIR_NS + MINUTE, close_of(1) + comparison.PAIR_NS + MINUTE, "R")
        found = compared(run, replay)
        self.assertEqual([g["class"] for g in found["groups"]], ["run_only", "replay_only"])


class Attribution(unittest.TestCase):
    def replay_only(self, **kwargs) -> dict:
        return compared([], bracket("r", close_of(5), close_of(5), "R"), **kwargs)["groups"][0]

    def test_a_replay_only_group_without_a_known_cause_is_a_look_ahead_suspect(self):
        group = self.replay_only()
        self.assertEqual((group["class"], group["cause"], group["look_ahead_suspect"]), ("replay_only", "unexplained", True))

    def test_a_run_only_group_without_a_known_cause_is_unexplained_and_no_suspect(self):
        group = compared(bracket("p", close_of(5), close_of(5), "P"), [])["groups"][0]
        self.assertEqual((group["cause"], group["look_ahead_suspect"]), ("unexplained", False))

    def test_the_known_causes_are_tried_in_order(self):
        cases = [({"skip": (3,), "late": (2,), "closes": {4: "100.5"}}, "missing_bar"),
                 ({"late": (2,), "closes": {4: "100.5"}}, "late_bar"),
                 ({"closes": {4: "100.5"}}, "bar_mismatch")]
        for given, cause in cases:
            with self.subTest(cause):
                group = self.replay_only(**given)
                self.assertEqual((group["cause"], group["look_ahead_suspect"]), (cause, False))

    def test_a_concurrent_position_that_agreed_after_a_missing_bar_does_not_hide_it(self):
        """Found on a real replay: a position opened earlier and closed (agreeing) after the bar the run missed; the
        inputs since that position closed hold no missing bar, those since it was decided do."""
        def held(prefix: str, position: str) -> list[dict]:
            return [*bracket(prefix + "1", close_of(1), close_of(1), position),
                    order(prefix + "1-T", "TAKE_PROFIT", "SELL", close_of(1), price="101.0"),
                    fill(prefix + "1-T", close_of(20), "101.0", "1", "SELL", position)]
        group = compared(held("p", "P"), [*held("r", "R"), *bracket("r2", close_of(5), close_of(5), "R2")],
                         skip=(5,))["groups"][1]
        self.assertEqual((group["class"], group["cause"], group["look_ahead_suspect"]), ("replay_only", "missing_bar", False))

    def test_a_late_bar_reaches_the_source_more_than_two_seconds_after_its_close(self):
        found = comparison.bars([bar(0, wall_ns=close_of(0) + 10**6 + comparison.LATE_NS),
                                bar(1, wall_ns=close_of(1) + 10**6 + comparison.LATE_NS + 1)],
                               {"BTCUSDT": archived(2)}, START, START + 2 * MINUTE)
        self.assertEqual(found["BTCUSDT"]["late"], [close_of(1)])

    def test_an_early_bar_is_shown_beside_a_difference_and_is_no_cause(self):
        """Found on a two-contract Paper run (2026-11-13): the clock behind the venue's stamped bars before their
        close, and the Sandbox, matching at that stamp, expired a GTD order due at such a close a bar late. The
        early bars are shown; the difference stays unexplained and a look-ahead suspect (user 2026-11-14)."""
        found = comparison.bars([bar(0) | {"ts_init": close_of(0) - 1}, bar(1) | {"ts_init": close_of(1)}, bar(2)],
                                {"BTCUSDT": archived(3)}, START, START + 3 * MINUTE)["BTCUSDT"]
        self.assertEqual(found["early"], {close_of(0): 1})
        result = compared([], bracket("r", close_of(5), close_of(5), "R"), early=(2, 4))
        self.assertEqual((result["summary"]["early_bars"], result["inputs"]["BTCUSDT"]["bars"]["early"]),
                         (2, [{"close": utc_text(close_of(i)), "lead_ms": "1"} for i in (2, 4)]))
        group = result["groups"][0]
        self.assertEqual((group["cause"], group["look_ahead_suspect"]), ("unexplained", True))
        self.assertEqual((group["evidence"]["early_bars"], group["evidence"]["early_lead_ms"], group["evidence"]["first"]),
                         (2, "1", None))
        # Control: with every bar stamped after its close, nothing is shown.
        self.assertEqual((self.replay_only()["evidence"]["early_bars"], self.replay_only()["evidence"]["early_lead_ms"]),
                         (0, None))
        # An early bar after the group's last order shows nothing about it; a known cause keeps its early bars.
        self.assertEqual(self.replay_only(early=(9,))["evidence"]["early_bars"], 0)
        late = self.replay_only(late=(2,), early=(3,))
        self.assertEqual((late["cause"], late["evidence"]["early_bars"]), ("late_bar", 1))

    def test_a_live_aggregation_is_not_a_minute(self):
        hour = {**bar(0), "bar_type": f"{BTC}-1-HOUR-LAST-INTERNAL@1-MINUTE-EXTERNAL", "close": "1"}
        minute = {**bar(0), "bar_type": f"{BTC}-1-MINUTE-LAST-EXTERNAL"}
        found = comparison.bars([hour, minute], {"BTCUSDT": archived(1)}, START, START + MINUTE)["BTCUSDT"]
        self.assertEqual((found["live"], found["differing"]), (1, {}))

    def test_a_warm_up_unlike_the_archives_explains_a_difference_within_its_reach(self):
        got = {"bars": 3, "first_ts_event": START - 2 * MINUTE - 10**6, "last_ts_event": START - 10**6, "sha256": "a"}
        warm = {"warmup": {BTC: {"1-MINUTE": got}},
                "archived_warmup": {"BTCUSDT": {"1-MINUTE": {**got, "sha256s": ["b"]}}}}
        near = compared([], bracket("r", close_of(1), close_of(1), "R"), **warm)["groups"][0]
        far = compared([], bracket("r", close_of(5), close_of(5), "R"), **warm)["groups"][0]
        self.assertEqual((near["cause"], near["look_ahead_suspect"]), ("warmup", False))
        self.assertEqual((far["cause"], far["look_ahead_suspect"]), ("unexplained", True))
        same = {**warm, "archived_warmup": {"BTCUSDT": {"1-MINUTE": {**got, "sha256s": ["b", "a"]}}}}
        self.assertEqual(compared([], bracket("r", close_of(1), close_of(1), "R"), **same)["groups"][0]["cause"],
                         "unexplained")

    def test_contract_terms_unlike_the_replays_explain_a_difference(self):
        group = self.replay_only(terms={"BTCUSDT": {"price_increment": "0.10", "size_increment": "0.001"}},
                                 replay_terms={"BTCUSDT": {"price_increment": "0.01", "size_increment": "0.001"}})
        self.assertEqual((group["cause"], group["evidence"]["terms"]), ("contract_terms", ["price_increment: market 0.01, exchange 0.10"]))

    def test_a_tick_the_replays_export_widened_explains_a_price_difference(self):
        # The market's terms agree (0.10 both days), but the replay traded on the 0.01 grid its history needs.
        with tempfile.TemporaryDirectory() as name:
            reports = Path(name) / "reports"
            reports.mkdir()
            (reports / "account.csv").write_text("ts_event,total\n")
            (Path(name) / "input-coverage.json").write_text(json.dumps({"export_receipts": {"BTCUSDT": {"pieces": [
                {"price_precision": 2, "price_precision_widened": True}]}}}))
            tick = {"price_increment": "0.10", "size_increment": "0.001"}
            run = bracket("p", close_of(1), close_of(1), "P", px="100.1")
            replay = bracket("r", close_of(1), close_of(1), "R", px="100.13")
            bars = [bar(i, "100.0") for i in range(40)]
            group = comparison.compare({"bars": bars, "events": run, "terms": {"BTCUSDT": tick}}, replay,
                                      {"BTCUSDT": archived(40)}, reports, START, START + 40 * MINUTE,
                                      replay_terms={"BTCUSDT": tick})["groups"][0]
        self.assertEqual((group["stage"], group["cause"], group["evidence"]["terms"]),
                         ("decision", "contract_terms", ["price_increment: market 0.01, exchange 0.10"]))

    def test_fee_rates_unlike_the_replays_explain_only_a_fee_difference(self):
        run = bracket("p", close_of(1), close_of(1), "P")
        run[1] = {**run[1], "commission": "0.09 USDT"}
        fees = {"fees": {"BTCUSDT": {"maker": "0.00018", "taker": "0.00045"}}, "replay_fees": {"maker": "0.0002", "taker": "0.0005"}}
        group = compared(run, bracket("r", close_of(1), close_of(1), "R"), **fees)["groups"][0]
        self.assertEqual((group["stage"], group["cause"]), ("fee", "contract_terms"))
        group = compared(bracket("p", close_of(1), close_of(1), "P", px="100.5"), bracket("r", close_of(1), close_of(1), "R"),
                         **fees)["groups"][0]
        self.assertEqual((group["stage"], group["orders"][0]["class"], group["cause"]), ("decision", "price", "unexplained"))

    def test_a_lone_group_in_the_windows_last_minute_is_at_its_end(self):
        group = compared([], bracket("r", close_of(39), close_of(39), "R"))["groups"][0]
        self.assertEqual((group["cause"], group["look_ahead_suspect"]), ("window_end", False))

    def test_live_entry_gate_explains_a_held_or_withdrawn_fill_and_a_refused_held_decision(self):
        # Sent after a hold: decided on time, filled later than the replay's.
        late = bracket("p", close_of(1), close_of(3), "P")
        replay = bracket("r", close_of(1), close_of(1), "R")
        group = compared(late, replay, gate={"released": ["p-E"]})["groups"][0]
        self.assertEqual((group["orders"][0]["stage"], group["cause"]), ("fill", "entry_gate"))
        self.assertEqual(compared(late, replay)["groups"][0]["cause"], "unexplained")
        withdrawn = bracket("p", close_of(1), close_of(1), "P")[:1] + [
            {"type": "OrderCanceled", "client_order_id": "p-E", "instrument_id": BTC, "ts_event": close_of(2)}]
        group = compared(withdrawn, replay, gate={"withdrawn": ["p-E"]})["groups"][0]
        self.assertEqual((group["orders"][0]["class"], group["cause"]), ("replay_only", "entry_gate"))
        # Denied natively while a missing bar held entries closed (the user, 2026-11-13).
        denied = bracket("p", close_of(1), close_of(1), "P")[:1] + [
            {"type": "OrderDenied", "client_order_id": "p-E", "instrument_id": BTC, "ts_event": close_of(1)}]
        group = compared(denied, replay, gate={"denied": ["p-E"]})["groups"][0]
        self.assertEqual((group["orders"][0]["class"], group["cause"]), ("replay_only", "entry_gate"))
        self.assertEqual(compared(denied, replay)["groups"][0]["cause"], "unexplained")
        # The decision itself differs: the gate does not explain it.
        early = bracket("p", close_of(1) - 2 * MINUTE, close_of(1) - 2 * MINUTE, "P")
        self.assertNotEqual(compared(early, replay, gate={"released": ["p-E"]})["groups"][0]["cause"], "entry_gate")
        # Refused after a hold: Live made no order; the replay's decision is not a look-ahead suspect.
        group = self.replay_only(gate={"refused": [close_of(5) + 2 * 10**9]})
        self.assertEqual((group["cause"], group["look_ahead_suspect"]), ("entry_gate", False))
        self.assertEqual(self.replay_only(gate={"refused": [close_of(9)]})["cause"], "unexplained")

    def test_a_fill_only_the_replay_made_is_a_suspect_and_what_follows_is_its_consequence(self):
        run = bracket("p", close_of(1), close_of(1), "P") + bracket("p2", close_of(20), close_of(20), "P2")
        replay = bracket("r", close_of(1), close_of(1), "R") + bracket("r2", close_of(25), close_of(25), "R2")
        replay += [fill("r-S", close_of(4), "95.0", "1", "SELL", "R")]
        found = compared(run, replay)
        first, later = found["groups"]
        self.assertEqual((first["stage"], first["orders"][first["first"]]["class"], first["look_ahead_suspect"]),
                         ("fill", "replay_only", True))
        self.assertEqual((later["cause"], later["follows"]), ("consequence", utc_text(close_of(1))))

    def test_differences_follow_the_first_until_a_group_agrees_again(self):
        run = bracket("a", close_of(1), close_of(1), "A") + bracket("b", close_of(10), close_of(10), "B")
        run += bracket("c", close_of(20), close_of(20), "C")
        replay = bracket("a", close_of(1), close_of(1), "A", px="100.5") + bracket("b", close_of(10), close_of(10), "B")
        replay += bracket("c", close_of(20), close_of(20), "C", px="100.5")
        found = compared(run, replay)
        self.assertEqual([(g["class"], g.get("cause")) for g in found["groups"]],
                         [("differs", "unexplained"), ("same", None), ("differs", "unexplained")])

    def test_funding_unlike_the_replays_is_the_groups_last_stage(self):
        settlements = [{"instrument_id": BTC, "settlement_ns": close_of(5), "rate": Decimal("0.0001"),
                        "mark": Decimal("100"), "positions": {"P": Decimal(1)}}]
        with mock.patch.object(comparison, "replay_funding", return_value={"R": Decimal("-0.02")}):
            group = compared(bracket("p", close_of(1), close_of(1), "P"), bracket("r", close_of(1), close_of(1), "R"),
                             settlements=settlements)["groups"][0]
        self.assertEqual((group["stage"], group["funding"]), ("funding", {"run": "-0.01", "replay": "-0.02"}))


class Warmup(unittest.TestCase):
    def test_the_archives_minutes_aggregate_to_the_warm_up_the_run_received(self):
        hour = 60 * MINUTE
        at = START // hour * hour + hour  # a T on the hour
        minutes = [[(at - 2 * hour) // 10**6 + i * 60_000, (at - 2 * hour) // 10**6 + i * 60_000 + 59_999,
                    "100.1", str(100 + i / 100), "99.9", "100.2", "0.5"] for i in range(120)]
        rows = [(at - hour - 10**6, "100.10", "100.59", "99.90", "100.20", "30.000"),
                (at - 10**6, "100.10", "101.19", "99.90", "100.20", "30.000")]
        received = {"1-HOUR": comparison.digest(rows)}
        with mock.patch("market.read.stored_bars", return_value={"bars": {"rows": minutes}}):
            found = comparison.archive_warmup({}, "2026-11-11", "BTCUSDT", at + 7, received,
                                             {"price_increment": "0.10", "size_increment": "0.001"})
        compared_ = comparison.warmup({BTC: received}, {"BTCUSDT": found})["BTCUSDT"]
        self.assertTrue(compared_["same"])
        self.assertEqual(compared_["reach_ns"], 2 * hour)
        received = {"1-HOUR": comparison.digest([rows[0], (*rows[1][:5], "30.001")])}
        self.assertFalse(comparison.warmup({BTC: received}, {"BTCUSDT": found})["BTCUSDT"]["same"])

    def test_a_live_packs_historical_bars_are_digested_as_paper_journals_them(self):
        rows = [{"instrument_id": BTC, "bar_type": f"{BTC}-1-MINUTE-LAST-EXTERNAL", "ts_event": close_of(i),
                 "open": "1.0", "high": "2.0", "low": "0.5", "close": "1.5", "volume": "3.000"} for i in (1, 0)]
        found = comparison.received_warmup(rows)[BTC]["1-MINUTE"]
        from nautilus_trader.model import Bar, BarType, Price, Quantity
        from engine.paper import warmup_digest
        journaled = warmup_digest([Bar(BarType.from_str(f"{BTC}-1-MINUTE-LAST-EXTERNAL"), Price.from_str("1.0"),
                                       Price.from_str("2.0"), Price.from_str("0.5"), Price.from_str("1.5"),
                                       Quantity.from_str("3.000"), close_of(i), close_of(i)) for i in (0, 1)])
        self.assertEqual(found, journaled)

    def test_a_funding_history_is_digested_alike_in_paper_live_and_the_archive_and_reaches_back(self):
        from engine.paper import warmup_digest
        from engine.warmup import FUNDING, funding_update
        hour = 3_600_000
        at = START // (hour * 10**6) * hour * 10**6
        stored = [((at // 10**6) - k * 8 * hour + (13 if k == 2 else 0), Decimal(rate))
                  for k, rate in ((3, "0.0000100000"), (2, "-0.0000250000"), (1, "0E-10"), (0, "0.0001000000"))]
        journaled = warmup_digest([funding_update(BTC, ms * 10**6, rate) for ms, rate in stored])
        live = comparison.received_warmup({"kind": "historical_funding", "instrument_id": BTC, "ts_event": ms * 10**6,
                                           "rate": str(funding_update(BTC, ms * 10**6, rate).rate)}
                                          for ms, rate in stored)[BTC][FUNDING]
        self.assertEqual(live, journaled)
        with mock.patch("market.files.open_market"), mock.patch("market.coverage.read_funding",
                                                                return_value=stored) as read:
            archived = comparison.archive_funding({}, "2026-11-11", "BTCUSDT", at, 3)
            whole = comparison.archive_funding({}, "2026-11-11", "BTCUSDT", at, 4)
        self.assertLessEqual(read.call_args_list[0].args[3], stored[1][0])
        self.assertEqual((archived["bars"], archived["first_ts_event"]), (3, stored[1][0] * 10**6))
        self.assertTrue(comparison.warmup({BTC: {FUNDING: journaled}}, {"BTCUSDT": {FUNDING: whole}})["BTCUSDT"]["same"])
        self.assertFalse(comparison.warmup({BTC: {FUNDING: journaled}}, {"BTCUSDT": {FUNDING: archived}})["BTCUSDT"]["same"])
        self.assertEqual(comparison.history_start(at, {BTC: {FUNDING: journaled}}),
                         stored[0][0] * 10**6 // MINUTE * MINUTE)
