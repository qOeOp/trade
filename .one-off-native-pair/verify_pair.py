"""Read-only semantic acceptance; never starts a replay or changes a product check."""
import argparse
import ast
from decimal import Decimal
import gzip
import json
from pathlib import Path
import re

from generator import TRACE_SCHEMA, WINDOWS, sha

TOL = Decimal("0.00000001")
TABLES = {"orders", "fills", "positions", "account", "returns_series", "order_events", "exposures", "fill_volumes"}
MINUTE_NS = 60_000_000_000
MS_NS = 1_000_000
CONTRACT = "replay-contract@v7"
IMAGE = re.compile(r"ghcr\.io/qoeop/trade-runtime@sha256:[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")


def require(condition, note):
    if not condition:
        raise ValueError(note)


def verify_native_bar_schema():
    """Pure pinned value construction/equality; no engine, strategy callback, timer or service is run."""
    import importlib.metadata
    from nautilus_trader.model import BarType
    require(importlib.metadata.version("nautilus_trader") == "2.0.0rc7", "host Nautilus version differs from pinned schema")
    subscription = BarType.from_str("BTCUSDT-PERP.BINANCE-15-MINUTE-LAST-INTERNAL@1-MINUTE-EXTERNAL")
    emitted = subscription.standard()
    require(str(emitted) == "BTCUSDT-PERP.BINANCE-15-MINUTE-LAST-INTERNAL" and emitted != subscription,
            "pinned standard/composite BarType schema differs")
    return {"subscription": str(subscription), "emitted": str(emitted), "equal": False}


def money(value):
    return Decimal(str(value).split()[0])


def ns(value):
    text = str(value)
    if text.lstrip("-").isdigit():
        return int(text)
    # pandas preserves native nanosecond CSV timestamps; datetime would drop sub-microsecond clocks.
    import pandas as pd
    return int(pd.Timestamp(text).value)


def rows(directory, name):
    from engine.native_csv import dict_reader
    path = directory / ("exposures.csv.gz" if name == "exposures" else f"{name}.csv")
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8", newline="") as stream:
        return list(dict_reader(stream))


def order_events(reports):
    with gzip.open(reports / "order_events.jsonl.gz", "rt", encoding="utf-8") as stream:
        return [json.loads(line) for line in stream]


def order_refusals(directory):
    """Report facts even when acceptance fails; neither fixture expects a denied/rejected order."""
    summary = json.loads((directory / "reports/summary.json").read_text())
    events = [{key: event.get(key) for key in ("type", "client_order_id", "instrument_id", "ts_event", "reason")}
              for event in order_events(directory / "reports") if event.get("type") in ("OrderDenied", "OrderRejected")]
    return {"denied_orders": summary["denied_orders"], "rejected_orders": summary["rejected_orders"],
            "native_denied_events": sum(e["type"] == "OrderDenied" for e in events),
            "native_rejected_events": sum(e["type"] == "OrderRejected" for e in events),
            "refusal_events": events, "expected": False}


def clocks(per_coin, kind, start_ns, trade_start_ns, end_ns, events, receipt):
    seen = per_coin.get("seen")
    require(per_coin.get("trace_schema") == TRACE_SCHEMA and isinstance(seen, list) and bool(seen),
            "source clock trace schema/content is missing")
    iid = per_coin["instrument"]
    minute_type = f"{iid}-1-MINUTE-LAST-EXTERNAL"
    # rc7's BarAggregatorCore standardizes its builder: emitted bars omit the subscription's @ suffix.
    quarter_type = f"{iid}-15-MINUTE-LAST-INTERNAL"
    expected_minutes = list(range(start_ns + MINUTE_NS - MS_NS, end_ns, MINUTE_NS))
    period = 8 * 60 * MINUTE_NS
    expected_funding = list(range(-(-start_ns // period) * period, end_ns, period))
    observed = {tag: [] for tag in ("minute", "quarter", "mark", "funding", "order", "timer")}
    native = {(e["type"], e["client_order_id"], int(e["ts_event"]), int(e["ts_init"]))
              for e in events if e["instrument_id"] == iid}
    previous = start_ns
    counts = {}
    counted_bars = []
    for item in seen:
        require(isinstance(item, list) and bool(item), "malformed source clock record")
        tag = item[0]
        counts[tag] = counts.get(tag, 0) + 1
        if tag == "bar":
            require(len(item) == 5 and item[1] in (minute_type, quarter_type), "unexpected bar trace schema/type")
            event, initialized, now = item[2:5]
            subtype = "minute" if item[1] == minute_type else "quarter"
            require(kind == "probe" or subtype == "minute", "unexpected protection internal bar")
            observed[subtype].append(event)
            if event >= trade_start_ns:
                # Preserve Probe's original comparison with a composite self.quarter. Standard internal bars
                # fall through that unequal comparison and increment n, just like external minutes.
                counted_bars.append(event)
        elif tag in ("mark", "funding"):
            require(len(item) == 4, f"unexpected {tag} trace schema")
            event, initialized, now = item[1:4]
            observed[tag].append(event)
        elif tag == "timer":
            require(kind == "probe" and len(item) == 5 and isinstance(item[4], str), "unexpected timer trace schema")
            event, initialized, now = item[1:4]
            require(item[4] == f"T-{iid}" or item[4].startswith(f"A-{iid}-"), "timer belongs to a different instrument")
            require(event == now, "native timer did not fire at its scheduled time")
            observed[tag].append((event, item[4]))
        elif tag == "order":
            require(len(item) == 6, "unexpected order trace schema")
            event, initialized, now = item[2:5]
            require((item[1], item[5], event, initialized) in native, "source order callback lacks matching native event")
            if item[1] in ("OrderSubmitted", "OrderEmulated"):
                require(event >= trade_start_ns, "source saw a submission before trade start")
            observed[tag].append((item[1], item[5], event))
        else:
            raise ValueError(f"unplanned clock trace kind: {tag}")
        require(all(type(value) is int for value in (event, initialized, now)), "clock fields must be integer nanoseconds")
        require(start_ns <= event <= now < end_ns and start_ns <= initialized <= now, f"noncausal {tag} callback clock")
        # TimeEvent.ts_init is creation time; its scheduled ts_event can lie after creation.
        if tag != "timer":
            require(event <= initialized, f"noncausal {tag} event/init clock")
        require(now >= previous, "callback clock moved backwards")
        previous = now
    require(observed["minute"] == expected_minutes, "minute trace does not cover every expected input exactly once")
    require(observed["mark"] == expected_minutes, "MARK trace does not cover every expected input exactly once")
    require(observed["funding"] == expected_funding, "funding trace does not cover every expected input exactly once")
    require(bool(observed["order"]), "no observed order callbacks")
    expected_counts = {"last": len(expected_minutes), "mark": len(expected_minutes), "funding": len(expected_funding)}
    for name, value in expected_counts.items():
        require(per_coin["counts"][name] == value, f"summary input count differs for {name}")
        require(sum(piece["counts"][name] for piece in receipt["pieces"]) == value, f"export input count differs for {name}")
    require(len(receipt["pieces"]) == 1 and receipt["pieces"][0]["instrument_id"] == iid,
            "unexpected export instrument pieces")
    piece = receipt["pieces"][0]
    require(piece["first_bar_ns"] == expected_minutes[0] and piece["last_bar_ns"] == expected_minutes[-1]
            and piece["missing_minutes"] == piece["last_mark_unmatched"] == 0, "export minute/MARK coverage is incomplete")
    if kind == "probe":
        require(bool(observed["quarter"]) and len(set(observed["quarter"])) == len(observed["quarter"]),
                "no unique internal 15-minute callbacks")
        require(all(value % (15 * MINUTE_NS) == 0 for value in observed["quarter"]), "internal bars not on 15-minute boundary")
        require(start_ns % (15 * MINUTE_NS) == end_ns % (15 * MINUTE_NS) == 0, "Probe fixture must use aligned 15-minute boundaries")
        # The first input is funding at start. Startup drains subscriptions at that clock; the immediate
        # aggregation timer has no initialized builder. The last run(None end) and end() stop at the last
        # input, end-1ms. Thus start+15m through end-15m must all emit; neither boundary emits a bar.
        expected_quarters = list(range(start_ns + 15 * MINUTE_NS, end_ns, 15 * MINUTE_NS))
        require(observed["quarter"] == expected_quarters, "internal 15-minute trace does not cover the complete input-derived range")
        require(any(name == f"T-{iid}" for _, name in observed["timer"])
                and any(name.startswith(f"A-{iid}-") for _, name in observed["timer"]), "periodic/alert timer paths not both observed")
        # Derive counters/alerts from actual ordered callbacks; the stopping horizon comes from the input,
        # not the trace's own last timestamp, so a missing tail cannot redefine what should have happened.
        horizon = end_ns - MS_NS
        expected_alerts = [(event + 90_000_000_007, f"A-{iid}-{number}")
                           for number, event in enumerate(counted_bars, 1)
                           if number % 41 == 0 and event + 90_000_000_007 <= horizon]
        alerts = [(event, name) for event, name in observed["timer"] if name.startswith(f"A-{iid}-")]
        require(alerts == expected_alerts, "Probe alert names/deadlines differ from ordered mixed bar counter")
        periodic = [event for event, name in observed["timer"] if name == f"T-{iid}"]
        interval = 37 * MINUTE_NS + 13_000
        require(periodic == list(range(start_ns + interval, horizon + 1, interval)), "Probe periodic timer schedule differs")
    require(per_coin["bars"] == len(counted_bars), "source mixed bar counter differs" if kind == "probe" else "source minute counter differs")
    return {"callbacks": counts, "minute_inputs": len(observed["minute"]), "internal_15m": len(observed["quarter"]),
            "source_bar_counter": len(counted_bars), "funding_inputs": len(observed["funding"]),
            "event_init_consumption_checked": True}


def native_economics(reports, summary, audit, expected_symbols):
    data = {name: rows(reports, name) for name in ("orders", "fills", "positions", "account", "exposures", "returns_series")}
    fills, positions, accounts = data["fills"], data["positions"], data["account"]
    require(bool(fills) and bool(positions) and len(accounts) > 1, "empty native economic evidence")
    require({r["instrument_id"].split("-PERP.")[0] for r in fills} == set(expected_symbols), "not every symbol actually filled")
    commissions = sum((money(row["commission"]) for row in fills), Decimal(0))
    adjustments = [a for p in positions for a in ast.literal_eval(p["adjustments"] or "[]")
                   if a.get("adjustment_type") == "FUNDING"]
    funding = sum((money(a["pnl_change"]) for a in adjustments), Decimal(0))
    require(commissions > 0 and bool(adjustments) and funding != 0, "fees/funding were not exercised")
    require(all(money(a["pnl_change"]) != 0 for a in adjustments), "zero funding adjustment")
    native = audit["native_economics"]
    require(abs(commissions - money(native["fill_commissions_usdt"])) <= TOL, "fee sum differs from native audit")
    require(abs(funding - money(native["reported_funding_usdt"])) <= TOL, "funding sum differs from native audit")
    require(len(adjustments) == native["funding_adjustments"], "funding adjustment count differs")
    balances = {ns(row["ts_event"]): money(row["total"]) for row in accounts}
    fill_times = {ns(row["ts_event"]) for row in fills}
    by_time = {}
    for value in adjustments:
        at = ns(value["ts_event"])
        by_time[at] = by_time.get(at, Decimal(0)) + money(value["pnl_change"])
    checked = 0
    for at, value in by_time.items():
        if at in fill_times:
            continue  # preserved audit limitation; protection case disallows this below
        earlier = [t for t in balances if t < at]
        require(bool(earlier) and at in balances, "missing funding account states")
        require(abs(balances[at] - balances[max(earlier)] - value) <= TOL, "funding does not reconcile to account delta")
        checked += 1
    require(checked > 0, "no independently reconcilable funding settlement")
    realized = sum((money(p["realized_pnl"]) for p in positions if p["realized_pnl"]), Decimal(0))
    opening, closing = money(accounts[0]["total"]), money(accounts[-1]["total"])
    require(abs(closing - opening - realized) <= TOL, "account balance differs from realized position economics")
    end_mark = ns(summary["period_end_utc"]) - 1_000_000
    exposed = [row for row in data["exposures"] if int(row["ts_event_ns"]) == end_mark]
    unrealized = sum((money(row["unrealized_pnl"]) for row in exposed), Decimal(0))
    open_positions = [row for row in positions if row["side"] != "FLAT" and money(row["quantity"]) != 0]
    require(not open_positions or {p["position_id"] for p in open_positions} == {e["position_id"] for e in exposed},
            "final open positions lack final MARK exposure")
    require(abs(closing + unrealized - money(summary["final_equity_usdt"])) <= TOL, "final MARK equity does not reconcile")
    return {"fills": len(fills), "positions": len(positions), "commission": str(commissions), "funding": str(funding),
            "funding_adjustments": len(adjustments), "independent_funding_states": checked,
            "final_balance": str(closing), "final_unrealized": str(unrealized), "open_positions": len(open_positions)}, data, adjustments


def protection(data, adjustments, audit, symbols, events):
    require(audit["strategy_uses_stop_loss"] is True and audit["uncovered_intervals"] == [], "protection audit did not pass")
    require(all(row["side"] == "FLAT" and money(row["quantity"]) == 0 for row in data["positions"]), "protection scenario not flat")
    require(all(row["status"] in ("FILLED", "CANCELED", "EXPIRED") for row in data["orders"]), "protection scenario has working order")
    settlement = ns("2026-01-01T08:00:00Z")
    require(len(adjustments) == len(symbols) and all(ns(a["ts_event"]) == settlement for a in adjustments),
            "protection must hold exactly once per symbol across 08:00 funding")
    require(settlement not in {ns(row["ts_event"]) for row in data["fills"]}, "concurrent funding/fill weakens economic check")
    submitted = ns("2026-01-01T07:31:59.999Z")
    partial = ns("2026-01-01T07:33:59.999Z")
    expiry = submitted + 72 * MINUTE_NS
    stopped = ns("2026-01-01T08:48:59.999Z")
    for symbol in symbols:
        iid = symbol + "-PERP.BINANCE"
        orders = [r for r in data["orders"] if r["instrument_id"] == iid]
        entry = [r for r in orders if r["type"] == "LIMIT" and r["side"] == "BUY"]
        stop = [r for r in orders if r["type"] == "STOP_MARKET"]
        target = [r for r in orders if r["type"] == "LIMIT" and r["side"] == "SELL"]
        require(len(entry) == len(stop) == len(target) == 1, "unexpected partial bracket topology")
        require(entry[0]["status"] == "EXPIRED" and money(entry[0]["quantity"]) == Decimal("16.339")
                and money(entry[0]["filled_qty"]) == Decimal("0.250"), "entry did not partially fill then expire")
        require(entry[0]["time_in_force"] == "GTD" and ns(entry[0]["ts_init"]) == submitted
                and ns(entry[0]["expire_time_ns"]) == expiry, "entry requested GTD deadline differs from fixture")
        require(stop[0]["status"] == "FILLED" and money(stop[0]["quantity"]) == money(stop[0]["filled_qty"]) == Decimal("0.250")
                and stop[0]["is_reduce_only"] == "True", "resized reduce-only stop did not close exactly 0.250")
        require(target[0]["status"] == "CANCELED", "bracket target did not cancel")
        per = [f for f in data["fills"] if f["instrument_id"] == iid]
        require(len(per) == 2 and all(money(f["last_qty"]) == Decimal("0.250") for f in per), "unexpected partial bracket fills")
        require([(f["client_order_id"], ns(f["ts_event"])) for f in per]
                == [(entry[0]["client_order_id"], partial), (stop[0]["client_order_id"], stopped)],
                "native partial/stop fill identity or planned clock differs")
        histories = {}
        for order in orders:
            cid = order["client_order_id"]
            history = [event for event in events if event["client_order_id"] == cid]
            require(bool(history) and all(event["instrument_id"] == iid for event in history), "native order history missing/misattributed")
            times = [int(e["ts_event"]) for e in history]
            require(times == sorted(times), "native per-order event clock moved backwards")
            require(all(submitted <= int(e["ts_event"]) <= int(e["ts_init"]) <= stopped for e in history),
                    "noncausal native protection order history")
            histories[cid] = history
        entry_history, stop_history = histories[entry[0]["client_order_id"]], histories[stop[0]["client_order_id"]]
        def timed(history, kind):
            return [int(event["ts_event"]) for event in history if event["type"] == kind]
        require(timed(entry_history, "OrderInitialized") == [submitted]
                and timed(entry_history, "OrderSubmitted") == [submitted], "entry initialization/submission clock differs")
        require(timed(entry_history, "OrderFilled") == [partial] and timed(entry_history, "OrderExpired") == [expiry],
                "native GTD expiry/partial event differs from planned deadline")
        accepted = timed(stop_history, "OrderAccepted")
        require(bool(accepted) and min(accepted) <= partial, "stop was not accepted by the partial fill")
        require(not any(e["type"] in ("OrderCanceled", "OrderExpired", "OrderDenied", "OrderRejected") for e in stop_history),
                "stop became terminal before closing the partial position")
        require(timed(stop_history, "OrderFilled") == [stopped], "stop did not survive GTD expiry until planned close")
        updates = [e for e in stop_history if e["type"] == "OrderUpdated"]
        require(all(money(e["quantity"]) >= Decimal("0.250") for e in updates), "stop update lost partial quantity coverage")
        for fill in per:
            matching = [e for e in histories[fill["client_order_id"]] if e["type"] == "OrderFilled"
                        and int(e["ts_event"]) == ns(fill["ts_event"])]
            require(len(matching) == 1 and money(matching[0]["last_qty"]) == money(fill["last_qty"])
                    and matching[0]["trade_id"] == fill["trade_id"], "native fill/event quantity or identity differs")
        positions = [p for p in data["positions"] if p["instrument_id"] == iid]
        require(len(positions) == 1 and positions[0]["opening_order_id"] == entry[0]["client_order_id"]
                and positions[0]["closing_order_id"] == stop[0]["client_order_id"]
                and ns(positions[0]["ts_opened"]) == partial and ns(positions[0]["ts_closed"]) == stopped,
                "native position did not preserve partial exposure across GTD expiry")
    return {"symbols": symbols, "partial_quantity": "0.250", "funding_timestamp_ns": settlement,
            "entry_submission_ns": submitted, "partial_fill_ns": partial, "requested_and_actual_expiry_ns": expiry,
            "stop_fill_ns": stopped, "flat": True}


def expected_runtime(manifest, side):
    prefix = "old" if side == "reference" else "new"
    image = manifest[prefix + "_runtime"]
    return {"image_ref": image, "image_digest": image.split("@", 1)[1], "platform": manifest["platform"],
            "runtime_contract": CONTRACT, "build_revision": manifest[prefix + "_revision"]}


def bound_execution(manifest, pair, side, directory, load, process, summary, coverage, inspection):
    from engine.config import config_sha256, execution_account
    expected = expected_runtime(manifest, side)
    require(pair["sides"][side]["runtime"] == expected, "side runtime differs from suite intended digest/revision/platform")
    receipt, binding = load("start-receipt/execution.json"), load("source/execution.json")
    four = {key: value for key, value in expected.items() if key != "build_revision"}
    require(receipt["runtime_identity"] == expected and summary["runtime_identity"] == binding["runtime_identity"] == four,
            "receipt/summary/execution runtime mismatch")
    trial = pair["sides"][side]["trial_id"]
    result = load("cli-result.json")
    require(type(trial) is int and trial > 0 and receipt["trial_id"] == process["trial_id"] == result["trial_id"] == trial,
            "trial identity differs across native execution facts")
    require(receipt["format"] == "execution_start_v1" and receipt["purpose"] == process["purpose"] == "explore"
            and result["status"] == "passed", "unexpected execution receipt purpose/result")
    require(receipt["source_sha256"] == pair["source"]["sha256"]
            == sha(directory / "start-receipt/strategy.py"), "start receipt source mismatch")
    require(receipt["input_identity"] == coverage["input_identity"]
            and sha(directory / "start-receipt/input-coverage.json") == sha(directory / "input-coverage.json"),
            "start receipt input coverage mismatch")
    effective = binding["effective_config"]
    require(effective == inspection["effective_config"] == coverage["effective_config"], "effective configuration facts differ")
    digest = config_sha256(effective)
    require(binding["effective_config_sha256"] == inspection["effective_config_sha256"]
            == summary["effective_config_sha256"] == digest, "effective configuration digest mismatch")
    require(effective["runtime_contract"] == CONTRACT and effective["symbols"] == pair["symbols"]
            and effective["account"] == execution_account("bars", None), "effective execution contract/symbols/account differ")
    require(inspection["runtime_contract"] == CONTRACT and inspection["engine_version"] == "2.0.0rc7",
            "native inspection contract/version differs")
    require(all(ns(effective[key]) == ns(pair["source"][key]) for key in ("start", "trade_start", "end")),
            "effective execution window differs from frozen source plan")
    require(ns(summary["input_start_utc"]) == ns(pair["source"]["start"])
            and ns(summary["period_end_utc"]) == ns(pair["source"]["end"]), "native summary window differs")
    for stage, module in (("native", "engine.run"), ("audit", "engine.audit"), ("fingerprint", "engine.compare")):
        command = process["commands"][stage]
        require(isinstance(command, list) and all(isinstance(arg, str) for arg in command), "malformed recorded container argv")
        require(command[:2] == ["docker", "run"] and command.count("--platform") == 1
                and command[command.index("--platform") + 1] == expected["platform"], "recorded stage platform mismatch")
        require(command.count(expected["image_ref"]) == 1, "recorded stage image differs from intended runtime")
        at = command.index(expected["image_ref"])
        require(command[at + 1:at + 3] == ["-m", module], "recorded stage native module mismatch")
        if stage == "native":
            require(command[at + 3:] == receipt["argv"], "recorded runner argv differs from execution-start receipt")
            for option, value in (("--strategy-sha256", pair["source"]["sha256"]), ("--strategy-class", pair["source"]["class"]),
                                  ("--strategy-file", "/strategy/strategy.py"), ("--execution-binding", "/strategy/execution.json")):
                require(receipt["argv"].count(option) == 1 and receipt["argv"][receipt["argv"].index(option) + 1] == value,
                        "runner argv source/binding differs from frozen fixture")


def verify_side(root, manifest, pair, side):
    from engine.compare import report_fingerprint
    directory = root / pair["sides"][side]["directory"]
    reports = directory / "reports"
    def load(name):
        return json.loads((directory / name).read_text())
    process, audit, summary = load("process.json"), load("audit/audit.json"), load("reports/summary.json")
    require(all(process["stages"].get(s, {}).get("state") == "exited" and process["stages"][s]["exit_code"] == 0
                for s in ("native", "audit", "fingerprint")), "not all native stages completed successfully")
    require(audit.get("passed") is True and audit["findings"] == [], "native audit failed")
    require(summary["integrity_passed"] is True and not summary["integrity_findings"], "native integrity failed")
    require(summary["denied_orders"] == summary["rejected_orders"] == 0, "denied/rejected native orders")
    require(summary["engine_version"] == "2.0.0rc7" and summary["execution"] == "bars", "unexpected native contract")
    require(summary["source_sha256"] == pair["source"]["sha256"] and sha(directory / "source/strategy.py") == pair["source"]["sha256"],
            "strategy source identity mismatch")
    require(summary["strategy_uses_stop_loss"] is pair["source"]["uses_stop_loss"], "stop-loss declaration changed")
    require(not order_refusals(directory)["refusal_events"], "native denied/rejected events are never expected by these fixtures")
    fingerprint = load("fingerprint/fingerprint.json")
    require(set(fingerprint) == TABLES, "not all eight fingerprint tables are present")
    require(fingerprint == report_fingerprint(reports), "retained native fingerprint does not match report bytes")
    inspection = load("runtime-inspection.json")
    coverage = load("input-coverage.json")
    bound_execution(manifest, pair, side, directory, load, process, summary, coverage, inspection)
    baseline = json.loads((root / "baseline.json").read_text())["files"]
    require(inspection["dependency_lock_sha256"] == baseline["uv.lock"], "native lock differs from frozen checkout")
    require(inspection["audit_source_sha256"] == baseline["engine/audit.py"], "native auditor differs from frozen checkout")
    from runtime.image import layout
    require(inspection["source_file_paths"] == layout(CONTRACT)["source_paths"], "native source path schema differs")
    require(set(inspection["source_files_sha256"]) == set(inspection["source_file_paths"]), "native source hash schema differs")
    for field, path in inspection["source_file_paths"].items():
        require(inspection["source_files_sha256"][field] == baseline[path], f"native {path} differs from frozen checkout")
    per_coin = summary["per_coin"]
    require(isinstance(per_coin, list) and len(per_coin) == len(pair["symbols"])
            and {row["instrument"] for row in per_coin} == {symbol + "-PERP.BINANCE" for symbol in pair["symbols"]},
            "expected exactly one complete trace for every requested symbol")
    events = order_events(reports)
    require(set(coverage["export_receipts"]) == set(pair["symbols"]), "input coverage symbol set differs")
    trace = {row["instrument"]: clocks(row, pair["kind"], ns(pair["source"]["start"]), ns(pair["source"]["trade_start"]),
                                       ns(pair["source"]["end"]), events,
                                       coverage["export_receipts"][row["instrument"].split("-PERP.")[0]]) for row in per_coin}
    economy, data, adjustments = native_economics(reports, summary, audit, pair["symbols"])
    specific = protection(data, adjustments, audit, pair["symbols"], events) if pair["kind"] == "protection" else {
        "uses_stop_loss": False, "uncovered_intervals": audit["uncovered_intervals"],
        "bracket_branch_exercised": False,
        "limitation": "Probe declares no mandatory stop protection; rc7 standard internal bars never equal its composite subscription, so only timer-driven market activity is covered"}
    return {"economics": economy, "clocks": trace, "scenario": specific}, summary, fingerprint, coverage, inspection


def verify_suite(root):
    from engine.compare_reports import compare_reports
    manifest = json.loads((root / "suite.json").read_text())
    native_schema = verify_native_bar_schema()
    results = []
    expected = {(kind, tuple(symbols)) for kind in ("probe", "protection")
                for symbols in (["BTCUSDT"], ["ETHUSDT"], ["BTCUSDT", "ETHUSDT"])}
    require({(p["kind"], tuple(p["symbols"])) for p in manifest["pairs"]} == expected and len(manifest["pairs"]) == 6,
            "suite must contain exactly the six requested pairs")
    require(all(IMAGE.fullmatch(manifest[key]) for key in ("old_runtime", "new_runtime"))
            and manifest["old_runtime"] != manifest["new_runtime"], "suite must name distinct immutable runtime images")
    require(all(REVISION.fullmatch(manifest[key]) for key in ("old_revision", "new_revision"))
            and manifest["host_revision"] == manifest["new_revision"] and manifest["platform"] == "linux/amd64",
            "suite revision/platform identity is invalid")
    source_manifest = json.loads((root / "sources/manifest.json").read_text())
    require(source_manifest["trace_schema"] == TRACE_SCHEMA, "generated source trace schema differs")
    directories, trials = set(), set()
    for pair in manifest["pairs"]:
        admission = {}
        audits = {}
        try:
            admission = {side: order_refusals(root / pair["sides"][side]["directory"]) for side in ("reference", "candidate")}
            # Read and retain both verdicts even if an earlier independent side check subsequently rejects the pair.
            audits = {side: json.loads((root / pair["sides"][side]["directory"] / "audit/audit.json").read_text())
                      for side in ("reference", "candidate")}
            require(pair["source"] == source_manifest["sources"][pair["kind"]]
                    and all(pair["source"][key] == value for key, value in WINDOWS[pair["kind"]].items())
                    and sha(root / "sources" / pair["source"]["file"]) == pair["source"]["sha256"],
                    "source plan/hash differs from frozen generated inputs")
            for side in ("reference", "candidate"):
                directory = (root / pair["sides"][side]["directory"]).resolve()
                trial = pair["sides"][side]["trial_id"]
                require(directory.is_relative_to(root.resolve()) and directory not in directories and trial not in trials,
                        "side must have a distinct retained directory and trial")
                directories.add(directory)
                trials.add(trial)
            left, a, fa, ca, ia = verify_side(root, manifest, pair, "reference")
            right, b, fb, cb, ib = verify_side(root, manifest, pair, "candidate")
            comparison = compare_reports(root / pair["sides"]["reference"]["directory"] / "reports",
                                         root / pair["sides"]["candidate"]["directory"] / "reports")
            require(comparison["passed"], "five native tables/funding/account metrics differ")
            require(fa == fb, "eight semantic native fingerprints differ")
            require(ca == cb, "input content/coverage/account configuration differs")
            for key in ("runtime_contract", "engine_version", "python_version", "dependency_lock_sha256", "source_files_sha256",
                        "audit_source_sha256", "effective_config_sha256"):
                require(ia[key] == ib[key], f"native probe differs in {key}")
            require(a["per_coin"] == b["per_coin"], "source callback clocks/per-coin diagnostics differ")
            require(left == right, "independent scenario/economic checks differ")
            results.append({"pair": pair["name"], "passed": True, "order_refusals": admission,
                            "native_audits": audits, "observed": left, "comparison": comparison})
        except (ValueError, KeyError, TypeError, IndexError, OSError, AssertionError) as exc:
            results.append({"pair": pair["name"], "passed": False, "order_refusals": admission,
                            "native_audits": audits, "error": f"{type(exc).__name__}: {exc}"})
    return {"passed": all(item["passed"] for item in results), "pairs": results, "native_value_schema": native_schema,
            "scope": "six synthetic native AMD64 engineering pairs; not research profitability, live venue or deployment evidence",
            "audit_limits": ["up to one minute stop coverage grace", "funding is native-reported, not independently rate-derived",
                             "Probe declares USES_STOP_LOSS=False", "clock trace is source diagnostics checked against native reports"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path, help="only the uploaded evidence directory")
    args = parser.parse_args()
    result = verify_suite(args.root)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["passed"] else 1)
