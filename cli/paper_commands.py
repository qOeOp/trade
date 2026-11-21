"""paper: paper runs on live public market data with simulated fills."""

from __future__ import annotations

from pathlib import Path

from cli.common import (CANDIDATE_HELP, EXECUTION_DEFAULT_HELP, MARKET, MARKET_DAY, OP_ID, PAPER, command,
                        one_of, option)
from engine.config import ACCOUNT_CONTRACT
from ledger import db
from shared import profiles
from shared.refusals import refuse


NOUNS = {"paper": "paper runs on live public market data with simulated fills"}
PAPER_ID = option("--paper-id", required=True, type=int, help="paper run ID")


def _paper(args) -> db.LedgerProfile:
    return db.profile(args.ledger, holds="paper")


def paper_start(args):
    from paper import runs
    if args.research_at and not db.COMMIT_HASH.fullmatch(args.research_at):
        raise refuse("USAGE_ERROR", "--research-at is a full commit hash")
    return runs.start(_paper(args), profiles.market(args.market), args.market_day, args.candidate,
                      None if args.universe else args.symbols, args.runtime, args.duration_seconds, args.op_id,
                      research=db.profile(args.research_ledger), research_at=args.research_at, leverage=args.leverage)


def paper_resume(args):
    from paper import runs
    return runs.resume(_paper(args), profiles.market(args.market), args.paper_id)


def paper_stop(args):
    from paper import runs
    return (runs.request_stop if args.request_only else runs.stop)(_paper(args), args.paper_id)


def paper_seal(args):
    from paper import runs
    return runs.seal(_paper(args), args.paper_id)


def paper_delete(args):
    from paper import runs
    return runs.delete(_paper(args), args.paper_id)


def paper_list(args):
    from paper import runs
    return runs.listing(_paper(args))


def paper_compare(args):
    from paper import compare
    return compare.compare(_paper(args), profiles.market(args.market), args.market_day, args.paper_id,
                           Path(args.output), args.timeout_seconds, args.preliminary)


def paper_serve(args):
    from paper import serve
    _paper(args)
    serve.serve(args.ledger, args.market, args.host, args.port, args.hosts, Path(__file__).resolve().parents[1],
                args.runtime, args.research_ledger, args.release_route, args.release_name)
    return {}


COMMANDS = [
    command(paper_start, "paper", "start", "declare a paper run of a candidate and start its containers", (
        "the candidate in the research ledger (reader; --research-ledger, default the active one, at "
        "--research-at, default its head); this Paper database's containers on Docker; the runtime image (a tag "
        "is pulled); the market day (--market-day, default the newest day) and its current-month membership",
        "the candidate's source copied into the Paper database (once per source) and one paper_run row; the run "
        "directory <service>/paper/<database>/<paper_id> (source, membership); an internal Docker network with "
        "the runner and the egress proxy, left running (the command returns at once); the same --op-id again "
        "is a replay",
        "paper_id, candidate, source_sha256, image_ref, symbols, market_day, directory, containers, "
        "ledger_commit, write_status (a replay gives paper_id, write_status, directory)",
        "PAPER_RUN_ACTIVE (this source already runs); PAPER_MEMORY_FULL (its reservation exceeds the free paper memory); EMPTY_SYMBOLS; "
        "UNIVERSE_EMPTY (no --symbols and no member for the current month); "
        "PAPER_RECOVERY_UNDECLARED (the source never names PAPER_RECOVERY, on_save or on_load); "
        "UNKNOWN_CANDIDATE, BAD_REF; RUNTIME_UNAVAILABLE; LEDGER_KIND (--ledger is not a Paper database); "
        "PAPER_START_FAILED (the containers did not start; the run is sealed with START_FAILED, write_status written)"),
         PAPER, MARKET, MARKET_DAY, option("--candidate", required=True, help=CANDIDATE_HELP),
         one_of(option("--symbols", nargs="+", help="Binance symbols such as BTCUSDT"),
                option("--universe", choices=("pool",), help="every member of the current month among the contracts this deployment's market holds"),
                required=True),
         option("--runtime", help=EXECUTION_DEFAULT_HELP),
         option("--research-ledger", help="the research ledger the candidate is read from (default: the "
                                          "active one)"),
         option("--research-at", help="read the candidate at this exact research commit"),
         option("--leverage", default=ACCOUNT_CONTRACT["default_leverage"],
                help="the account's Binance leverage, an integer from 1 to 125 (default %(default)s)"),
         option("--duration-seconds", type=int, help="stop after this long (engineering trials)"),
         OP_ID,
         epilog="Binance public market data and Nautilus Sandbox fills only, no credential (engine.paper); the runner "
                "reaches the network only through an egress proxy that admits Binance's public USD-M hosts. Membership "
                "is the current month's at the market day. Paper runs add no trial count and no exposure."),
    command(paper_resume, "paper", "resume", "continue one unsealed run from its consistent native checkpoint", (
        "the unsealed run, its pinned container, source and terms inputs and native checkpoint/journal cut "
        "(reader); the contract terms at the run's market day (--market)",
        "records a recovery attempt, then starts the same runner and account; no new run or ledger row; "
        "all lifecycle commands share a database advisory lock",
        "paper_id, write_status (written or replayed), state (resuming or running)",
        "PAPER_RUN_UNKNOWN; PAPER_RECOVERY_UNAVAILABLE (sealed/user-stopped run, missing or dirty checkpoint, "
        "changed identity, terms that no longer match the market day, journal tail, missing container, a "
        "running run of the source or three recovery "
        "attempts per hour); PAPER_MEMORY_FULL (its reservation exceeds the free paper memory)"),
         PAPER, MARKET, PAPER_ID),
    command(paper_stop, "paper", "stop", "stop a running paper run and seal it", (
        "the paper run (reader); its runner container",
        "a STOP file for the runner (it cancels its orders and writes its summary), then SIGTERM after "
        "60 s and SIGKILL 30 s later; then seals as paper seal. --request-only durably writes "
        "the final STOP request and returns without waiting; paper serve completes cancellation and sealing",
        "as paper seal; --request-only returns paper_id, state, write_status",
        "PAPER_RUN_UNKNOWN; as paper seal"),
         PAPER, PAPER_ID,
         option("--request-only", action="store_true", help="persist the final STOP request and return; "
                "the daemon completes cancellation and sealing")),
    command(paper_seal, "paper", "seal", "seal an ended paper run into the Paper database", (
        "the paper run and its seal (reader); its run directory (journal, summary, egress log) and runner log",
        "the run's seal and its files (the journal by UTC day, summary, logs, seal.json) in one commit, then "
        "removes the containers and network; an existing seal stands and is returned (write_status replayed)",
        "paper_id, files {path: sha256}, seal (status complete or invalid, reasons, returns, drawdown, "
        "funding, fills, orders, gaps, limitations), ledger_commit, write_status",
        "PAPER_RUN_UNKNOWN; PAPER_RUN_ACTIVE (still running: stop it first); RUNTIME_UNAVAILABLE"), PAPER, PAPER_ID),
    command(paper_delete, "paper", "delete", "delete a sealed paper run from the Paper database (the user's own action)",
         (
        "the paper run and its seal (writer)",
        "removes the sealed run's paper_run row, its seal and files in one commit paper_delete:<id>, then its run "
        "directory; Dolt history and the backup keep them; the user's own action (an Agent asks first)",
        "paper_id, files_deleted, ledger_commit, write_status",
        "PAPER_RUN_UNKNOWN; PAPER_RUN_ACTIVE (not sealed: stop or seal it first); DIRTY_WORKING_SET"), PAPER, PAPER_ID,
         epilog="Deleting a run is the user's decision, never an Agent's own (AGENTS.md). The run leaves the Paper "
                "database in one commit; Dolt history and the backup keep it."),
    command(paper_list, "paper", "list", "every paper run with its state and seal readings", (
        "every paper run and its seal (reader); this Paper database's containers on Docker",
        "nothing",
        "runs [{paper_id, op_id, candidate, source_sha256, symbols, state (running, ended, unsealed or sealed), "
        "containers, created_at, image_ref, market_day, config, status, reasons, total_return, max_drawdown, seal}], "
        "running, memory {budget, reserved, host_available, headroom, free, smallest}",
        "RUNTIME_UNAVAILABLE (docker did not answer)"), PAPER),
    command(paper_compare, "paper", "compare", "replay a sealed paper run on the archive and compare it group by group",
         (
        "the sealed paper run, its source and its files (reader); the market at --market-day (default the newest day), exported "
        "into a reused cache under the temporary directory; the run's own runtime image; with --preliminary, Binance's "
        "public REST (klines, markPriceKlines, fundingRate and, for a source that read metrics, futures/data) for "
        "what the market does not hold yet, paced, stopping at the first rate limit",
        "nothing in any database (no trial, no exposure) and nothing in the market directory; the new --output "
        "directory (replay/ with the native reports and audit, comparison.json; with --preliminary, market/: the "
        "market's files linked and the months REST extends rewritten)",
        "path, data_source (archive, or rest: preliminary), summary {run_orders, run_fills, replay_orders, replay_fills, groups, same, differs, run_only, "
        "replay_only, consequences, look_ahead_suspects, missing_bars, late_bars, unknown_bars, side_down_bars, published_late_bars, early_bars, differing_bars, "
        "warmup_differs, terms_differ, equity_max_difference, equity_unexplained_minutes}, replay {status, problems, path}",
        "PAPER_RUN_UNKNOWN; PAPER_RUN_ACTIVE (not sealed); PAPER_COMPARE_EMPTY (no interval); "
        "COMPARE_UNCOVERED (the market lacks the interval's minutes); NOT_TEMPORARY_PATH, PATH_EXISTS "
        "(--output); RUNTIME_UNAVAILABLE; REPLAY_TIMEOUT (--timeout-seconds); SOURCE_UNREACHABLE (--preliminary: "
        "REST refused, a rate limit included)"), PAPER, MARKET, MARKET_DAY, PAPER_ID,
         option("--output", required=True, help="new directory under the temporary root"),
         option("--timeout-seconds", type=float, help="stop the replay after this long"),
         option("--preliminary", action="store_true",
                help="read the minutes, funding and metrics the market does not hold yet from Binance's public "
                     "REST into a working copy under --output: a preliminary result (data_source rest) before "
                     "the day's archive; the comparison on the archive is the one that counts"),
         epilog="The replay takes the run's source, runtime image, contracts, leverage and the interval its runner "
                "received bars for, warmed at the same start; only the market day is chosen here. It is no trial and "
                "adds no exposure; nothing reaches the ledger (paper.compare, replay.comparison)."),
    command(paper_serve, "paper", "serve", "serve the Paper database's runs to the trade IDE's Paper panel", (
        "the paper runs, their seals and files (reader); a candidate's last research replay in the research ledger "
        "(reader); each run's directory; this Paper database's containers on Docker",
        "nothing itself: page writes and explicit ends run paper start, stop, seal or delete; an interruption "
        "runs paper resume against the same unsealed run and verified native account; recovery failure "
        "retains the run without starting a replacement account",
        "nothing until stopped; over HTTP on loopback (inside a container, on its own address), /api/paper/ lists "
        "the runs, streams a run's journal and readings, and answers a start or stop with that command's result",
        "USAGE_ERROR (a --host that is not loopback outside a container; inside one, no usable TMPDIR); over HTTP: "
        "FORBIDDEN (a Host or origin not allowed), NOT_FOUND, USAGE_ERROR (a bad body), NO_LAST_REPLAY, and the "
        "start, stop and seal refusals"),
         PAPER, MARKET,
         option("--host", default="127.0.0.1", help="address to listen on: loopback, or inside a container 0.0.0.0"),
         option("--port", type=int, default=8767, help="port to listen on (default: 8767)"),
         option("--allow-host", action="append", default=[], dest="hosts",
                help="Host header a request may carry (default: 127.0.0.1, localhost and "
                     "host.docker.internal at PORT); repeatable"),
         option("--runtime", help=EXECUTION_DEFAULT_HELP + " for the runs it starts"),
         option("--research-ledger", help="the research ledger candidates and their last replays are read from "
                                          "(default: the active one)"),
         option("--release-route", type=Path, help="internal release router configuration; unselected controllers are read-only"),
         option("--release-name", help="this controller's identity in the internal release router"),
         epilog="Listens on loopback only, or inside a container on its own address with TMPDIR a host directory "
                "mounted at its own path (paper.serve); the IDE service reaches it with --paper. Starts, stops and "
                "seals run this command line, and runs that end on their own are sealed as they are found; one that "
                "Docker stopped from outside resumes the same unsealed run only from a verified native "
                "checkpoint; unavailable recovery retains the records without starting a new account."),
]
