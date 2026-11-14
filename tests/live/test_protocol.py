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
from tests.live.test_views import LiveViewFixture


BASELINE = Path(__file__).with_name(f"protocol-{PROTOCOL}.json")
RAISE = ("an older control of this protocol would refuse or misread it: raise live/protocol.py PROTOCOL and "
         "record its own baseline (docs/plans/live-web-first-release-20261108.zh.md)")
RUN, REQUEST, REF = "probe-one", "request-0001", "0" * 32
# The writes a browser of this protocol sends: path, the control action it reaches, the exact body fields.
# Protocol 7 moved the contracts from the Live settings onto each source and added the runtime switch writes
# (docs/plans/cross-line-fusion-20261111.zh.md, L1 b).
WRITES = (
    ("/api/live/credentials", "credential_save", None, {"request_id", "api_key", "api_secret"}),
    ("/api/live/runs", "prepare", None, {"request_id", "run_id", "source_id", "credential_ref", "config"}),
    (f"/api/live/credentials/{REF}/remove", "credential_remove", REF, {"request_id"}),
    (f"/api/live/requests/{REQUEST}/resolve", "resolve", REQUEST, {"request_id"}),
    (f"/api/live/runs/{RUN}/preflight", "preflight", RUN, {"request_id"}),
    (f"/api/live/runs/{RUN}/start", "start", RUN, {"request_id", "confirm_real_orders"}),
    (f"/api/live/runs/{RUN}/stop", "stop", RUN, {"request_id"}),
    (f"/api/live/runs/{RUN}/reconcile", "reconcile", RUN, {"request_id"}),
    (f"/api/live/runs/{RUN}/maintain", "maintain", RUN, {"request_id"}),
    ("/api/live/notify/telegram", "notify_save", None, {"bot_token"}),
    ("/api/live/notify/test", "notify_test", None, set()),
    ("/api/live/notify/remove", "notify_remove", None, set()),
    (f"/api/live/runs/{RUN}/runtime_switch", "runtime_switch", RUN, {"request_id"}),
    (f"/api/live/runs/{RUN}/runtime_switch_cancel", "runtime_switch_cancel", RUN, {"request_id"}),
)
# The plan a prepare carries, field by field.
PLAN = {"duration_seconds", "leverage", "drawdown_brake"}


class ProtocolRequestTests(unittest.TestCase):
    def test_each_write_reaches_its_action_with_its_exact_fields(self):
        for path, action, target, fields in WRITES:
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
        self.assertEqual(set(configuration.CONFIG_KEYS), PLAN, RAISE)


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


class ProtocolBaselineTests(LiveViewFixture):
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
