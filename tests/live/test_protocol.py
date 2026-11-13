"""What one PROTOCOL number promises a Web serving beside an older Live control.

docs/plans/live-web-first-release-20261108.zh.md: a release serves a newer Web beside the older control
that owns a busy account only while both declare the same number. These tests hold the two halves of that
promise to the code: the requests a browser of this protocol sends (every older control of the protocol
must take them as they are; Request stop above all), and the oldest answers of the protocol (`protocol-N.json`,
recorded from the first control declaring it) that the browser must still show (scripts/liveProtocol.test.mjs).
"""

import json
from pathlib import Path
import unittest
from unittest.mock import patch

from live import configuration, control, serve, state
from live.protocol import PROTOCOL
from tests.live import test_views


BASELINE = Path(__file__).with_name(f"protocol-{PROTOCOL}.json")
RAISE = ("an older control of this protocol would refuse or misread it: raise live/protocol.py PROTOCOL and "
         "record its own baseline (docs/plans/live-web-first-release-20261108.zh.md)")
RUN, REQUEST, REF = "probe-one", "request-0001", "0" * 32
# The writes a browser of each protocol sends: path, the control action it reaches, the exact body fields.
WRITES = {
    1: (
        ("/api/live/credentials", "credential_save", None, {"request_id", "api_key", "api_secret"}),
        ("/api/live/runs", "prepare", None, {"request_id", "run_id", "source_id", "credential_ref", "config"}),
        (f"/api/live/credentials/{REF}/remove", "credential_remove", REF, {"request_id"}),
        (f"/api/live/requests/{REQUEST}/resolve", "resolve", REQUEST, {"request_id"}),
        (f"/api/live/runs/{RUN}/preflight", "preflight", RUN, {"request_id"}),
        (f"/api/live/runs/{RUN}/start", "start", RUN, {"request_id", "confirm_real_orders"}),
        (f"/api/live/runs/{RUN}/stop", "stop", RUN, {"request_id"}),
        (f"/api/live/runs/{RUN}/reconcile", "reconcile", RUN, {"request_id"}),
        (f"/api/live/runs/{RUN}/maintain", "maintain", RUN, {"request_id"}),
    ),
}
# Protocol 2 adds the Telegram notification settings (docs/plans/live-telegram-notify-20261110.zh.md).
WRITES[2] = (*WRITES[1],
             ("/api/live/notify/telegram", "notify_save", None, {"bot_token"}),
             ("/api/live/notify/test", "notify_test", None, set()),
             ("/api/live/notify/remove", "notify_remove", None, set()))
# The plan a prepare carries, field by field, in the units the browser means (USDT; seconds).
PLAN = {1: {"budget_usdt", "max_notional_per_order", "max_loss_usdt", "duration_seconds"}}
PLAN[2] = PLAN[1]
# Protocol 3 drops the fixed entry limit: Live bounds each entry by 3 times USDT equity
# (docs/plans/live-equity-entry-limit-20261110.zh.md).
PLAN[3] = PLAN[2] - {"max_notional_per_order"}
WRITES[3] = WRITES[2]
# Protocol 4 adds the account's Binance leverage, which the venue's must equal
# (docs/plans/r1-2d-leverage-terms-20261111.zh.md).
PLAN[4] = PLAN[3] | {"leverage"}
WRITES[4] = WRITES[3]
# Protocol 5 answers the candidate Live runs instead of an origin and a possibly rewritten source: sources and runs
# name `candidate`, a source has no file availability, and the review drops `rewritten`
# (docs/plans/execution-paths-replan-20261110.zh.md R2).
PLAN[5], WRITES[5] = PLAN[4], WRITES[4]
# Protocol 6 replaces the budget and the per-run loss limit with a drawdown brake: the cash floor is 85% of the wallet
# at the run's first start, and a run may have no duration (docs/plans/live-continuous-operation-design-20261110.zh.md).
PLAN[6], WRITES[6] = PLAN[5] - {"budget_usdt", "max_loss_usdt"} | {"drawdown_brake"}, WRITES[5]
# Protocol 7 moves the contracts from the Live settings onto each source, which trades them one instance each
# (docs/plans/cross-line-fusion-20261111.zh.md, L1 b), and switches a continuous run to a confirmed runtime image.
PLAN[7], WRITES[7] = PLAN[6], (*WRITES[6],
                               (f"/api/live/runs/{RUN}/runtime_switch", "runtime_switch", RUN, {"request_id"}),
                               (f"/api/live/runs/{RUN}/runtime_switch_cancel", "runtime_switch_cancel", RUN, {"request_id"}))


class ProtocolRequestTests(unittest.TestCase):
    def test_each_write_reaches_its_action_with_its_exact_fields(self):
        self.assertIn(PROTOCOL, WRITES, RAISE)
        for path, action, target, fields in WRITES[PROTOCOL]:
            with self.subTest(path=path):
                self.assertEqual(serve.write_route(path), (action, target), RAISE)
                seen = []

                def recorded(value, names):
                    seen.append(set(names))
                    raise configuration.fail()

                with patch.object(control.configuration, "fields", side_effect=recorded):
                    control.execute(None, action, target, {"request_id": REQUEST})
                self.assertEqual(seen[:1], [fields], RAISE)

    def test_the_plan_keeps_its_fields(self):
        self.assertEqual(set(configuration.CONFIG_KEYS), PLAN[PROTOCOL], RAISE)


def missing(baseline, current, path="") -> list[str]:
    """Where `current` lacks something `baseline` has: a key, or the shape of a list's first item."""
    if isinstance(baseline, dict):
        if not isinstance(current, dict):
            return [path or "/"]
        return [found for key, value in baseline.items()
                for found in (missing(value, current[key], f"{path}/{key}") if key in current else [f"{path}/{key}"])]
    if isinstance(baseline, list) and baseline:
        return missing(baseline[0], current[0], path + "/0") if isinstance(current, list) and current else [path]
    return []


class ProtocolBaselineTests(test_views.LiveViewTests):
    """The baseline is something a control of this protocol answers: today's control answers at least it."""

    def test_todays_listing_still_holds_every_part_of_the_baseline(self):
        self.manifest["config"].update(drawdown_brake="0.15",
                                       duration_seconds=8100, leverage="3")
        (self.directory / "inputs" / "manifest.json").write_bytes(state.encode(self.manifest))
        self.account()
        self.native("order", native={"type": "OrderFilled", "client_order_id": "cid-1",
                                     "instrument_id": "BTCUSDT-PERP.BINANCE", "ts_event": 1794000000000000001,
                                     "order_side": "BUY", "last_qty": "0.001", "last_px": "75000"})
        self.native("minute_result", minute_ns=1794000000000000000, result="-1.5")
        listing = control.listing(self.authority.config, binding=self.authority.binding)
        self.assertEqual(missing(json.loads(BASELINE.read_text()), listing), [],
                         "the baseline names what no control of this protocol answers")


for _name in [name for name in vars(test_views.LiveViewTests) if name.startswith("test_")]:
    setattr(ProtocolBaselineTests, _name, None)  # only its fixture is borrowed; the view tests run in test_views
