"""live: private Binance USD-M execution, operated by the user from the Live page."""

from __future__ import annotations

from pathlib import Path
import sys

from cli.common import MARKET, MARKET_DAY, Command, declarer, option
from engine.live_errors import LiveRefusal
from shared import profiles


NOUNS = {"live": "private Binance USD-M execution, prepared, started and reconciled from the Live page. It places real "
                 "orders with real money, a loss can exceed the limits you set, and nothing here is investment advice"}
COMMANDS: list[Command] = []
command = declarer(COMMANDS)


LIVE_CONFIGURATION_HELP = ("the paired control's fixed deployment configuration, "
                           "/var/lib/trade-release/live/<revision>/configuration.json")
CONFIGURATION = option("--configuration", type=Path, required=True, help=LIVE_CONFIGURATION_HELP)
RELEASE = (option("--release-state", type=Path, help="fixed release state directory; requires --release-web"),
           option("--release-web", help="this control's paired managed Web name; requires --release-state"))
ROOT = option("--root", required=True, type=Path, help="private custody directory for one account")
RUN_ID = option("--run-id", required=True, help="the run ID the Live page prepared")
MARKET_ROOT = option("--market-root", required=True, type=Path, help="the market directory, read only")


def compare_instant(text: str) -> int:
    from live.compare import instant  # its imports are a replay's
    return instant(text)


@command("live", "serve", "serve the operator Live control API on its configured private Unix socket", (
        "a fixed deployment configuration, private custody and its paired Web release metadata",
        "a private operator Unix socket and existing host maintenance; authenticated commands run through the fixed "
        "Live command interface, never a browser-selected path or shell command",
        "the operator HTTP API until cooperative shutdown; queries and STOP remain available during release handover",
        "LIVE_CONFIG; LIVE_RECORD_UNAVAILABLE; LIVE_DIRECTORY; LIVE_RELEASE_UNAVAILABLE; per-command Live refusals"),
         CONFIGURATION, *RELEASE)
def live_serve(args):
    from live import release, serve
    serve.serve(args.configuration, binding=release.parse_binding(args.release_state, args.release_web))
    return {}


@command("live", "web-command", "execute one bounded operator web command; JSON body is read only from stdin",
         (
        "one bounded JSON body from stdin, fixed deployment configuration and its paired Web release identity",
        "one request ID per local or native effect, carried on the effect's own rows: the same ID sent again does "
        "the effect at most once; a release handover refuses new effects, while STOP keeps its existing checks; the Telegram "
        "notification settings (notify_*) write only LIVE_ROOT/notify, with no request ID",
        "{status, body}: the HTTP status and safe operator result with request ID; never credential or bot token values",
        "LIVE_CONFIG; LIVE_REQUEST_ID; LIVE_REQUEST_CONFLICT; LIVE_RELEASE_UNAVAILABLE; incumbent account, source "
        "and credential refusals"), CONFIGURATION, *RELEASE,
         option("--action", required=True, choices=("prepare", "preflight", "start", "stop", "reconcile", "maintain",
                                                    "credential_save", "credential_remove", "resolve", "notify_save",
                                                    "notify_test", "notify_remove"),
                help="the operator command to execute"),
         option("--target", help="the run ID the action applies to; the credential reference for "
                                 "credential_remove; the request ID for resolve"))
def live_web_command(args):
    from live import authority, control, release
    from live.serve import MAX_BODY, decode
    body = decode(sys.stdin.buffer.read(MAX_BODY + 1))
    binding = release.parse_binding(args.release_state, args.release_web)
    try:
        live_scope = authority.from_file(args.configuration, binding)
    except LiveRefusal as exc:
        return {"status": 503, "body": control.error(exc.code, body.get("request_id"))}
    status, result = control.execute(live_scope.config, args.action, args.target, body, binding=binding)
    return {"status": status, "body": result}


@command("live", "release-inspect", "inspect custody while the paired release host holds the account lock",
         (
        "fixed deployment configuration, retained runs and verified container identities; the release host "
        "must already hold the original account lock across this inspection and its metadata write",
        "none: no lock acquisition or creation, credential reads, venue connections, state repair or trading",
        "{state: idle|busy|unavailable}; all three observations return exit 0 and only idle permits release admission",
        "LIVE_CONFIG; LIVE_RECORD_UNAVAILABLE; unavailable when custody or execution cannot be verified; busy while "
        "a runner or account slot remains active"), CONFIGURATION)
def live_release_inspect(args):
    from live import authority, inventory, release
    live_scope = authority.inspection(args.configuration)
    try:
        inventory.require_clear(live_scope.root)
    except LiveRefusal:
        return {"state": "unavailable"}
    return {"state": release.idle_locked(live_scope.root)}


@command("live", "status", "read private execution and unresolved account custody", (
        "the private manifest, lifecycle, native observations and retained container state",
        "nothing: observation does not archive logs, recycle containers or release custody; "
        "the paired controller owns maintenance",
        "run_id, state, mode, account_owned, source identities, image_ref (the pinned runtime image digest), symbols, "
        "exit_code, stop_reason (why the run first began to "
        "stop, such as drawdown, protection_missing or duration; null when it has not or the journal is unreadable) "
        "and, when unresolved, a note pointing to the manual steps",
        "LIVE_RECORD_UNAVAILABLE; LIVE_JOURNAL_UNAVAILABLE; LIVE_IDENTITY_CHANGED; LIVE_DIRECTORY; LIVE_RUN_ID; LIVE_DOCKER_UNAVAILABLE"), ROOT, RUN_ID)
def live_status(args):
    from live import runs
    return runs.observe(args.root, args.run_id)


@command("live", "logs", "read a bounded tail of the private runner log", (
        "the retained private runner log",
        "nothing; never reads the research ledger",
        "run_id and at most --tail lines (1–2000), with a 128-KiB byte bound",
        "LIVE_LOG_LIMIT; LIVE_RECORD_UNAVAILABLE; LIVE_JOURNAL_UNAVAILABLE; LIVE_IDENTITY_CHANGED; LIVE_DIRECTORY; LIVE_RUN_ID; "
        "LIVE_DOCKER_UNAVAILABLE"), ROOT, RUN_ID,
         option("--tail", default=200, type=int, help="1–2000 lines"))
def live_logs(args):
    from live import runs
    return runs.logs(args.root, args.run_id, args.tail)


@command("live", "stop", "request owned-order cancellation and flat reconciliation; never kill", (
        "the immutable private run inputs",
        "an idempotent STOP request; the native runner owns cancellation, flattening and reconciliation; never kills",
        "run_id and stop_requested; unresolved exposure continues to own the account slot",
        "LIVE_RECORD_UNAVAILABLE; LIVE_IDENTITY_CHANGED; LIVE_DIRECTORY; LIVE_RUN_ID"),
         ROOT, RUN_ID)
def live_stop(args):
    from live import runs
    return runs.stop(args.root, args.run_id)


@command("live", "compare", "replay a Live run's minutes on the archive and compare it group by group",
         (
        "one run's private inputs, journal and evidence pack (one trading start: --segment, default the latest); "
        "the market at --market-day (default the newest day), exported into a reused cache under the temporary directory; Binance's "
        "published funding rates; the run's own runtime image",
        "nothing in any database and nothing in the private root; the new --output directory (replay/ with the "
        "native reports and audit, comparison.json); never a credential, order or venue connection",
        "path, segment {number, of}, window {start, end}, market_day, unexplained [{at, at_ns, class}], "
        "summary {run_orders, run_fills, replay_orders, replay_fills, groups, same, "
        "differs, run_only, replay_only, consequences, look_ahead_suspects, missing_bars, late_bars, unknown_bars, side_down_bars, published_late_bars, early_bars, "
        "differing_bars, warmup_differs, terms_differ, equity_max_difference, equity_unexplained_minutes}, measures {from, to (--from, --to), groups, "
        "entries_unfilled, partial_fills, fills_paired, adverse_slippage_bps, fees, equity_change, holds}, "
        "replay {status, problems, path}",
        "LIVE_RECORD_UNAVAILABLE; LIVE_IDENTITY_CHANGED; LIVE_COMPARE_EMPTY (no warm-up, no such trading start, no "
        "start observation or whole minute); LIVE_COMPARE_UNCOVERED (the market lacks the run's minutes); "
        "LIVE_RUN_ID; NOT_TEMPORARY_PATH, PATH_EXISTS (--output); RUNTIME_UNAVAILABLE; REPLAY_TIMEOUT (--timeout-seconds)"), ROOT, RUN_ID, MARKET, MARKET_DAY,
         option("--output", required=True, help="new directory under the temporary root"),
         option("--timeout-seconds", type=float, help="stop the replay after this long"),
         option("--segment", type=int, help="the run's Nth trading start (1 is the first; default the latest)"),
         option("--from", dest="since", type=compare_instant, help="sum the measures from this time (UTC)"),
         option("--to", dest="until", type=compare_instant, help="replay and sum the measures before this time (UTC)"),
         epilog="The replay takes the run's source, runtime image, contract, leverage, starting wallet and the "
                "minutes its source received, warmed at the same start; only the market day is chosen here. "
                "Nothing reaches a ledger (live.compare, replay.comparison).")
def live_compare(args):
    from live import compare
    return compare.compare(args.root, args.run_id, profiles.market(args.market), args.market_day, Path(args.output),
                           args.timeout_seconds, args.segment, args.since, args.until)


@command("live", "compare-daily", "compare each Live run's latest day with its replay (the control's daily "
         "comparison container; live.daily)", (
        "each launched run's private inputs, journal, evidence pack and compare.json; the market directory "
        "(--market-root); Binance's published funding rates; each run's own runtime image",
        "compare.lock and compare-tmp/ under the root (the working directory, removed after the pass), each run's "
        "runs/<run>/compare.json; removes exited "
        "trade-live-compare-* stage containers; never a database, "
        "credential, order or venue connection",
        "state (done, or busy while another pass holds compare.lock), runs {run_id: the state of the record written: "
        "running, done, waiting, failed, empty, or unreadable}",
        "LIVE_RECORD_UNAVAILABLE (the root); LIVE_DIRECTORY (compare-tmp or its temporary directory); a run's own "
        "refusal is kept in its record, never raised"), ROOT, MARKET_ROOT,
         option("--today", required=True, help="the UTC day the comparison runs on, such as 2026-11-13"))
def live_compare_daily(args):
    from live import daily
    return daily.run(args.root, args.market_root, args.today)


@command("live", "paper-compare", "compare one sealed Paper run with its replay for Live admission (the "
         "control's comparison container; live.reconcile)", (
        "one sealed Paper run's journal through the Paper reader profile (--paper-ledger); the market directory "
        "(--market-root); the run's own runtime image",
        "paper-compare.lock and paper-compare-tmp/ under the root (the working directory, removed after); never a "
        "database, credential, order or venue connection",
        "paper_id, market_day, reason (null: the run reconciles with its replay; else why not), retry (the market "
        "does not cover the run yet)",
        "LIVE_RECORD_UNAVAILABLE (the root); LIVE_DIRECTORY (paper-compare-tmp); the comparison's own refusal is "
        "returned as the reason, never raised"), ROOT,
         option("--paper-ledger", required=True, type=Path, help="the Paper database's reader profile"),
         MARKET_ROOT, option("--paper-id", required=True, type=int, help="the sealed Paper run"))
def live_paper_compare(args):
    from live import reconcile
    from paper import compare
    return reconcile.compare_one(args.root, args.paper_ledger, args.market_root, args.paper_id,
                                 compare=compare.compare, held_since=compare.held_since)
