"""live: private Binance USD-M execution, operated by the user from the Live page."""

from __future__ import annotations

from pathlib import Path
import sys

from cli.common import UsageError, _market_at, _market_option
from engine.live_errors import LiveRefusal
from shared import profiles


NOUNS = ("live",)


LIVE_CONFIGURATION_HELP = ("the paired control's fixed deployment configuration, "
                           "/var/lib/trade-release/live/<revision>/configuration.json")


CONTRACTS: dict[tuple[str, str], tuple[str, str, str, str]] = {
    ("live", "serve"): (
        "a fixed deployment configuration, private custody and its paired Web release metadata",
        "a private operator Unix socket and existing host maintenance; authenticated commands run through the fixed "
        "Live command interface, never a browser-selected path or shell command",
        "the operator HTTP API until cooperative shutdown; queries and STOP remain available during release handover",
        "LIVE_CONFIG; LIVE_RECORD_UNAVAILABLE; LIVE_DIRECTORY; LIVE_RELEASE_UNAVAILABLE; per-command Live refusals"),
    ("live", "web-command"): (
        "one bounded JSON body from stdin, fixed deployment configuration and its paired Web release identity",
        "claims one request ID before its authorized local or native effect; repeats only return its original evidence; "
        "a release handover refuses new effects before claim, while STOP keeps its existing checks; the Telegram "
        "notification settings (notify_*) write only LIVE_ROOT/notify, with no request ID",
        "{status, body}: the HTTP status and safe operator result with request ID; never credential or bot token values",
        "LIVE_CONFIG; LIVE_REQUEST_ID; LIVE_REQUEST_COMMAND; LIVE_REQUEST_CONFLICT; LIVE_REQUEST_UNRESOLVED; "
        "LIVE_REQUEST_CLOSED_UNCLAIMED; LIVE_RELEASE_UNAVAILABLE; incumbent account, source and credential refusals"),
    ("live", "release-inspect"): (
        "fixed deployment configuration, retained requests, runs and verified container identities; the release host "
        "must already hold the original account lock across this inspection and its metadata write",
        "none: no lock acquisition or creation, credential reads, venue connections, state repair or trading",
        "{state: idle|busy|unavailable}; all three observations return exit 0 and only idle permits release admission; "
        "with --adopt a busy answer also lists runtimes (each busy run's runtime build revision or null), and a "
        "release host may then hand those runners to a control of the same runner contract",
        "LIVE_CONFIG; LIVE_RECORD_UNAVAILABLE; unavailable when custody or execution cannot be verified; busy while "
        "a runner or account slot remains active"),
    ("live", "status"): (
        "the private manifest, lifecycle, native observations and retained container state",
        "nothing: observation does not archive logs, recycle containers or release custody; "
        "the paired controller owns maintenance",
        "run_id, state, mode, account_owned, source identities, image_ref (the pinned runtime image digest), symbols, "
        "exit_code, stop_reason (why the run first began to "
        "stop, such as drawdown, protection_missing or duration; null when it has not or the journal is unreadable) "
        "and, when unresolved, a note pointing to the manual steps",
        "LIVE_RECORD_UNAVAILABLE; LIVE_JOURNAL_UNAVAILABLE; LIVE_IDENTITY_CHANGED; LIVE_DIRECTORY; LIVE_RUN_ID; LIVE_DOCKER_UNAVAILABLE"),
    ("live", "logs"): (
        "the retained private runner log",
        "nothing; never reads the research ledger",
        "run_id and at most --tail lines (1–2000), with a 128-KiB byte bound",
        "LIVE_LOG_LIMIT; LIVE_RECORD_UNAVAILABLE; LIVE_JOURNAL_UNAVAILABLE; LIVE_IDENTITY_CHANGED; LIVE_DIRECTORY; LIVE_RUN_ID; "
        "LIVE_DOCKER_UNAVAILABLE"),
    ("live", "stop"): (
        "the immutable private run inputs",
        "an idempotent STOP request; the native runner owns cancellation, flattening and reconciliation; never kills",
        "run_id and stop_requested; unresolved exposure continues to own the account slot",
        "LIVE_RECORD_UNAVAILABLE; LIVE_IDENTITY_CHANGED; LIVE_DIRECTORY; LIVE_RUN_ID"),
    ("live", "compare"): (
        "one run's private inputs, journal and evidence pack (one trading start: --segment, default the latest); "
        "the market at --at (default main), exported into a reused cache under the temporary directory; Binance's "
        "published funding rates; the run's own runtime image",
        "nothing in any database and nothing in the private root; the new --output directory (replay/ with the "
        "native reports and audit, reconcile.json); never a credential, order or venue connection",
        "path, segment {number, of}, window {start, end}, market_day, unexplained [{at, at_ns, class}], "
        "summary {run_orders, run_fills, replay_orders, replay_fills, groups, same, "
        "differs, run_only, replay_only, consequences, look_ahead_suspects, missing_bars, late_bars, differing_bars, "
        "warmup_differs, terms_differ, equity_max_difference}, measures {from, to (--from, --to), groups, "
        "entries_unfilled, partial_fills, fills_paired, adverse_slippage_bps, fees, equity_change, holds}, "
        "replay {status, problems, path}",
        "LIVE_RECORD_UNAVAILABLE; LIVE_IDENTITY_CHANGED; LIVE_COMPARE_EMPTY (no warm-up, no such trading start, no "
        "start observation or whole minute); LIVE_COMPARE_UNCOVERED (the market lacks the run's minutes); "
        "LIVE_RUN_ID; NOT_TEMPORARY_PATH, PATH_EXISTS (--output); RUNTIME_UNAVAILABLE; REPLAY_TIMEOUT (--timeout-seconds)"),
    ("live", "compare-daily"): (
        "each launched run's private inputs, journal, evidence pack and compare.json; the market directory "
        "(--market-root); Binance's published funding rates; each run's own runtime image",
        "compare.lock and compare-tmp/ under the root (the working directory, removed after the pass), each run's "
        "runs/<run>/compare.json (with the paired replay on --offered-runtime); removes exited "
        "trade-live-compare-* stage containers; never a database, "
        "credential, order or venue connection",
        "state (done, or busy while another pass holds compare.lock), runs {run_id: the state of the record written: "
        "running, done, waiting, failed, empty, or unreadable}",
        "LIVE_RECORD_UNAVAILABLE (the root); LIVE_DIRECTORY (compare-tmp or its temporary directory); a run's own "
        "refusal is kept in its record, never raised"),
}


def compare_instant(text: str) -> int:
    from live.compare import instant  # its imports are a replay's
    return instant(text)


def register(verbs, verb, runner) -> None:
    """Add the live nouns to the parser with `cli.main._parser`'s verbs, verb and runner."""
    live = verbs("live", "private Binance USD-M execution, prepared, started and reconciled from the Live page; here status, "
                         "logs and stop. It places real orders with real money, a loss can exceed the limits you set, "
                         "and nothing here is investment advice")
    command = verb(live, "serve", "serve the operator Live control API on its configured private Unix socket")
    command.add_argument("--configuration", type=Path, required=True, help=LIVE_CONFIGURATION_HELP)
    command.add_argument("--release-state", type=Path, help="fixed release state directory; requires --release-web")
    command.add_argument("--release-web", help="this control's paired managed Web name; requires --release-state")
    command = verb(live, "web-command", "execute one bounded operator web command; JSON body is read only from stdin")
    command.add_argument("--configuration", type=Path, required=True, help=LIVE_CONFIGURATION_HELP)
    command.add_argument("--release-state", type=Path, help="fixed release state directory; requires --release-web")
    command.add_argument("--release-web", help="this control's paired managed Web name; requires --release-state")
    command.add_argument("--action", required=True, choices=("prepare", "preflight", "start", "stop", "reconcile",
                                                           "maintain", "runtime_switch", "runtime_switch_cancel",
                                                           "credential_save", "credential_remove", "resolve",
                                                           "notify_save", "notify_test", "notify_remove"),
                         help="the operator command to execute")
    command.add_argument("--target", help="the run ID the action applies to; the credential reference for "
                         "credential_remove; the request ID for resolve")
    command = verb(live, "release-inspect", "inspect custody while the paired release host holds the account lock")
    command.add_argument("--configuration", type=Path, required=True, help=LIVE_CONFIGURATION_HELP)
    command.add_argument("--adopt", action="store_true",
                         help="list the runtime build revision of each busy run (live.release.ADOPT_INSPECT)")
    for action, description in (("status", "read private execution and unresolved account custody"),
                                ("logs", "read a bounded tail of the private runner log"),
                                ("stop", "request owned-order cancellation and flat reconciliation; never kill")):
        command = verb(live, action, description)
        command.add_argument("--root", required=True, type=Path, help="private custody directory for one account")
        command.add_argument("--run-id", required=True, help="the run ID the Live page prepared")
        if action == "logs":
            command.add_argument("--tail", default=200, type=int, help="1–2000 lines")
    command = verb(live, "compare", "replay a Live run's minutes on the archive and compare it group by group")
    command.epilog = ("The replay takes the run's source, runtime image, contract, leverage, starting wallet and the "
                      "minutes its source received, warmed at the same start; only the market day is chosen here. "
                      "Nothing reaches a ledger (live.compare, replay.reconcile).")
    command.add_argument("--root", required=True, type=Path, help="private custody directory for one account")
    command.add_argument("--run-id", required=True, help="the run ID the Live page prepared")
    _market_option(command)
    _market_at(command)
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    command.add_argument("--timeout-seconds", type=float, help="stop the replay after this long")
    command.add_argument("--segment", type=int, help="the run's Nth trading start (1 is the first; default the latest)")
    command.add_argument("--from", dest="since", type=compare_instant, help="sum the measures from this time (UTC)")
    command.add_argument("--to", dest="until", type=compare_instant,
                         help="replay and sum the measures before this time (UTC)")
    command = verb(live, "compare-daily", "compare each Live run's latest day with its replay (the control's daily "
                   "comparison container; live.daily)")
    command.add_argument("--root", required=True, type=Path, help="private custody directory for one account")
    command.add_argument("--market-root", required=True, type=Path, help="the market directory, read only")
    command.add_argument("--today", required=True, help="the UTC day the comparison runs on, such as 2026-11-13")
    command.add_argument("--offered-runtime", dest="offered",
                         help="the control's runtime image: replay each running run on another image on it as well")


def dispatch(args, runner_argv: list[str]) -> tuple[dict, int]:
    """(result, exit code) of one parsed live command."""
    from live import runs as live_runs
    if args.verb == "serve":
        from live import release
        from live import serve as live_serve
        live_serve.serve(args.configuration, binding=release.parse_binding(args.release_state, args.release_web))
        return {}, 0
    if args.verb == "web-command":
        from live import authority, control, release
        from live.serve import MAX_BODY, decode
        body = decode(sys.stdin.buffer.read(MAX_BODY + 1))
        binding = release.parse_binding(args.release_state, args.release_web)
        try:
            live_scope = authority.from_file(args.configuration, binding)
        except LiveRefusal as exc:
            return {"status": 503, "body": control.error(exc.code, body.get("request_id"))}, 0
        status, result = control.execute(live_scope.config, args.action, args.target, body, binding=binding)
        return {"status": status, "body": result}, 0
    if args.verb == "release-inspect":
        from live import authority, inventory, release
        live_scope = authority.inspection(args.configuration)
        try:
            inventory.require_clear(live_scope.root)
        except LiveRefusal:
            return {"state": "unavailable"}, 0
        found, runtimes = release.inspect_locked(live_scope.root)
        return ({"state": found, "runtimes": runtimes} if args.adopt and found == "busy" else {"state": found}), 0
    if args.verb == "status":
        return live_runs.observe(args.root, args.run_id), 0
    if args.verb == "stop":
        return live_runs.stop(args.root, args.run_id), 0
    if args.verb == "logs":
        return live_runs.logs(args.root, args.run_id, args.tail), 0
    if args.verb == "compare-daily":
        from live import daily
        return daily.run(args.root, args.market_root, args.today, args.offered), 0
    if args.verb == "compare":
        from live import compare
        return compare.compare(args.root, args.run_id, profiles.market(args.market), args.at, Path(args.output),
                               args.timeout_seconds, args.segment, args.since, args.until), 0
    raise UsageError(f"unknown command {args.noun} {args.verb}")
