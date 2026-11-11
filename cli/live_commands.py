"""live: private Binance USD-M execution, operated by the user from the Live page."""

from __future__ import annotations

from pathlib import Path
import sys

from cli.common import CANDIDATE_HELP, EXECUTION_DEFAULT_HELP, UsageError, _market_option
from engine.live_errors import LiveRefusal
from ledger import db
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
        "{state: idle|busy|unavailable}; all three observations return exit 0 and only idle permits release admission",
        "LIVE_CONFIG; LIVE_RECORD_UNAVAILABLE; unavailable when custody or execution cannot be verified; busy while "
        "a runner or account slot remains active"),
    ("live", "preflight"): (
        "the selected service release identity, explicit research reader at a full commit, reviewed optional adaptation, "
        "universe and private credential file",
        "immutable private inputs, retained CI-image containers and GET-only account observations; no ledger or order writes",
        "run_id, mode, state, directory, container, warnings (an API key with no IP restriction) and review {research_at, "
        "origin_candidate, source_sha256, entry_class, image_ref (the runtime image digest pinned when this run-id "
        "was first prepared; a repeat that passes a tag keeps it), rewritten (source or class differs from the candidate), "
        "origin_candidate_validations [{registration_id, window_start, window_end, universe_rule, retry_of, status}] "
        "(empty means none at research_at), validation_note}; status reads "
        "preflight_complete or preflight_failed from the same account, clock and source checks start applies, and logs "
        "gives the refusal",
        "UNKNOWN_CANDIDATE (also a candidate absent at a repeat's research_at); LIVE_RELEASE_UNAVAILABLE; LIVE_RUN_CONFLICT; LIVE_RUN_FORMAT; LIVE_ACCOUNT_OWNED; LIVE_RUNNING; LIVE_RUN_MISSING; LIVE_KEY_WITHDRAWAL; LIVE_KEY_UNVERIFIED; "
        "LIVE_CONFIG; LIVE_RESEARCH_COMMIT; LIVE_SYMBOLS; LIVE_UNIVERSE; LIVE_SOURCE_UNSUPPORTED; LIVE_IDENTITY_CHANGED; "
        "LIVE_MARKET_TERMS; LIVE_CREDENTIAL_FILE; LIVE_RECORD_UNAVAILABLE; LIVE_JOURNAL_UNAVAILABLE; LIVE_DIRECTORY; "
        "LIVE_RUN_ID; LIVE_DOCKER_UNAVAILABLE; RUNTIME_NOT_MAIN"),
    ("live", "start"): (
        "the selected service release identity, one prepared private run, its source_sha256 as the confirmation, "
        "same credential binding and a fresh venue admission snapshot",
        "reserves this configured account slot and starts native Live execution; an unknown outcome retains custody",
        "run_id, mode, starting/running state, write_status and warnings; no restart of an attempted source",
        "LIVE_RELEASE_UNAVAILABLE; LIVE_ACCOUNT_OWNED; LIVE_RUNNING; LIVE_RESTART_REQUIRES_RECONCILIATION; LIVE_RUN_FORMAT; LIVE_KEY_WITHDRAWAL; LIVE_KEY_UNVERIFIED; "
        "LIVE_ACCOUNT_CHANGED; LIVE_CONFIG; LIVE_SOURCE_MISSING; LIVE_IDENTITY_CHANGED (includes a confirmation that is not this run's source); LIVE_CREDENTIAL_FILE; LIVE_RECORD_UNAVAILABLE; "
        "LIVE_JOURNAL_UNAVAILABLE; LIVE_DIRECTORY; LIVE_RUN_ID; LIVE_DOCKER_UNAVAILABLE"),
    ("live", "status"): (
        "the private manifest, lifecycle, native observations and retained container state",
        "nothing: observation does not archive logs, recycle containers or release custody; "
        "the paired controller owns maintenance",
        "run_id, state, mode, account_owned, source identities, image_ref (the pinned runtime image digest), symbols, "
        "exit_code, stop_reason (why the run first began to "
        "stop, such as max_loss, protection_missing or duration; null when it has not or the journal is unreadable) "
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
    ("live", "reconcile"): (
        "the selected service release identity, same private run, original native cache and credential binding",
        "ends at once with venue_flat when the whole account at Binance has no position or open order; otherwise "
        "starts only a native reconciliation observer until stop, with no strategy constructor, callbacks or order writes",
        "run_id and starting/running; only proven native flatness, or a whole account flat at Binance, releases custody",
        "LIVE_RELEASE_UNAVAILABLE; LIVE_RUNNING; LIVE_RUN_MISSING; LIVE_ACCOUNT_CHANGED; LIVE_ACCOUNT_OWNED; LIVE_IDENTITY_CHANGED; LIVE_CREDENTIAL_FILE; "
        "LIVE_RECORD_UNAVAILABLE; LIVE_JOURNAL_UNAVAILABLE; LIVE_DIRECTORY; LIVE_RUN_ID; LIVE_DOCKER_UNAVAILABLE"),
}


def register(verbs, verb, runner) -> None:
    """Add the live nouns to the parser with `cli.main._parser`'s verbs, verb and runner."""
    live = verbs("live", "private Binance USD-M execution: preflight, start, status, logs, stop, reconcile. It places real "
                         "orders with real money, a loss can exceed the limits you set, and nothing here is investment advice")
    command = verb(live, "serve", "serve the operator Live control API on its configured private Unix socket")
    command.add_argument("--configuration", type=Path, required=True, help=LIVE_CONFIGURATION_HELP)
    command.add_argument("--release-state", type=Path, help="fixed release state directory; requires --release-web")
    command.add_argument("--release-web", help="this control's paired managed Web name; requires --release-state")
    command = verb(live, "web-command", "execute one bounded operator web command; JSON body is read only from stdin")
    command.add_argument("--configuration", type=Path, required=True, help=LIVE_CONFIGURATION_HELP)
    command.add_argument("--release-state", type=Path, help="fixed release state directory; requires --release-web")
    command.add_argument("--release-web", help="this control's paired managed Web name; requires --release-state")
    command.add_argument("--action", required=True, choices=("prepare", "preflight", "start", "stop", "reconcile",
                                                           "maintain", "credential_save", "credential_remove", "resolve",
                                                           "notify_save", "notify_test", "notify_remove"),
                         help="the operator command to execute")
    command.add_argument("--target", help="the run ID the action applies to; the credential reference for "
                         "credential_remove; the request ID for resolve")
    command = verb(live, "release-inspect", "inspect custody while the paired release host holds the account lock")
    command.add_argument("--configuration", type=Path, required=True, help=LIVE_CONFIGURATION_HELP)
    command = verb(live, "preflight", "capture fixed research inputs and query the real account without trading")
    command.add_argument("--release-web", required=True, help="managed Web name of the selected CI service build")
    command.add_argument("--root", required=True, type=Path, help="private custody directory for one account")
    command.add_argument("--run-id", required=True, help="stable ID for this execution; reused by every command")
    command.add_argument("--research-ledger", required=True, help="explicit research reader profile")
    command.add_argument("--research-at", required=True, help="full immutable research commit")
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    command.add_argument("--symbols", nargs="+", required=True, help="distinct Binance USD-M symbols, e.g. BTCUSDT")
    command.add_argument("--strategy-file", type=Path, help="reviewed Live adaptation; original candidate stays unchanged")
    command.add_argument("--strategy-class", help="entry class of the adapted source")
    command.add_argument("--universe-file", type=Path, required=True,
                         help="universe JSON file (each symbol's membership intervals); its bytes are frozen "
                              "with the run")
    command.add_argument("--credentials-file", type=Path, required=True, help="private JSON file, mounted only into Live")
    command.add_argument("--runtime", help=EXECUTION_DEFAULT_HELP)
    command.add_argument("--budget-usdt", required=True, help="declared test allocation, not whole-account collateral")
    command.add_argument("--max-loss-usdt", required=True,
                         help="closes the position when this run's result at the mark price reaches this loss, at most the budget")
    command.add_argument("--duration-seconds", type=int, required=True,
                         help="the runner stops after this long, 1 to 86400")
    command.add_argument("--leverage", required=True,
                         help="the account's Binance leverage on the symbol (1 to 125); Live never sets it")
    _market_option(command)
    command.add_argument("--memory", default="2g", help="memory limit of the runner container, e.g. 512m or 2g "
                         "(default: 2g)")
    for action, description in (("start", "arm the already prepared run after fresh account admission"),
                                ("status", "read private execution and unresolved account custody"),
                                ("logs", "read a bounded tail of the private runner log"),
                                ("stop", "request owned-order cancellation and flat reconciliation; never kill"),
                                ("reconcile", "reconnect the same run without strategy callbacks or order writes")):
        command = verb(live, action, description)
        command.add_argument("--root", required=True, type=Path, help="private custody directory for one account")
        command.add_argument("--run-id", required=True, help="the ID preflight prepared")
        if action in ("start", "reconcile"):
            command.add_argument("--release-web", required=True, help="managed Web name of the selected CI service build")
            command.add_argument("--credentials-file", required=True, type=Path,
                                 help="private JSON file, mounted only into Live")
        if action == "start":
            command.add_argument("--confirm-real-orders", required=True, metavar="SOURCE_SHA256",
                                 help="the source_sha256 preflight or status shows: this source places real orders with "
                                      "real money, and a loss can exceed the limits you set")
            command.add_argument("--strategy-file", type=Path, help="optionally verify the prepared source bytes")
            command.add_argument("--strategy-class", help="optionally verify the prepared entry class")
        if action == "logs":
            command.add_argument("--tail", default=200, type=int, help="1–2000 lines")


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
        return {"state": release.idle_locked(live_scope.root)}, 0
    if args.verb in {"preflight", "start", "reconcile"}:
        from live import authority
        live_scope = authority.operator(args.root, args.release_web)
    if args.verb == "preflight":
        from live import control
        return control.operator_preflight(
            args.root, args.run_id, db.profile(args.research_ledger), args.research_at, args.candidate,
            args.symbols, args.universe_file, args.credentials_file, args.runtime,
            budget_usdt=args.budget_usdt, max_loss_usdt=args.max_loss_usdt, duration_seconds=args.duration_seconds, memory=args.memory,
            leverage=args.leverage, market_root=Path(profiles.market(args.market)["root"]),
            scope=live_scope,
            strategy_file=args.strategy_file, strategy_class=args.strategy_class), 0
    if args.verb == "start":
        from live import control
        return control.operator_start(args.root, args.run_id, args.credentials_file, args.confirm_real_orders,
                                      scope=live_scope, strategy_file=getattr(args, "strategy_file", None),
                                      strategy_class=getattr(args, "strategy_class", None)), 0
    if args.verb == "reconcile":
        from live import control
        return control.operator_reconcile(args.root, args.run_id, args.credentials_file, scope=live_scope), 0
    if args.verb == "status":
        return live_runs.observe(args.root, args.run_id), 0
    if args.verb == "stop":
        return live_runs.stop(args.root, args.run_id), 0
    if args.verb == "logs":
        return live_runs.logs(args.root, args.run_id, args.tail), 0
    raise UsageError(f"unknown command {args.noun} {args.verb}")
