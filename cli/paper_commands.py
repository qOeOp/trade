"""paper: paper runs on live public market data with simulated fills."""

from __future__ import annotations

from pathlib import Path
import textwrap

from cli.common import (CANDIDATE_HELP, EXECUTION_DEFAULT_HELP, UsageError, _market_at, _market_option, _op_id,
                        _paper_option)
from engine.config import ACCOUNT_CONTRACT
from ledger import db
from shared import profiles
from shared.refusals import refuse


NOUNS = ("paper",)


CONTRACTS: dict[tuple[str, str], tuple[str, str, str, str]] = {
    ("paper", "start"): (
        "the candidate in the research ledger (reader; --research-ledger, default the active one, at "
        "--research-at, default its head); this Paper database's containers on Docker; the runtime image (a tag "
        "is pulled); the market day --at (default main) and its current-month membership",
        "the candidate's source copied into the Paper database (once per source) and one paper_run row; the run "
        "directory <service>/paper/<database>/<paper_id> (source, membership); an internal Docker network with "
        "the runner and the egress proxy, left running (the command returns at once); the same --op-id again "
        "is a replay",
        "paper_id, candidate, source_sha256, image_ref, symbols, market_day, directory, containers, "
        "ledger_commit, write_status (a replay gives paper_id, write_status, directory)",
        "PAPER_RUN_ACTIVE (this source already runs); PAPER_MEMORY_FULL (its reservation exceeds the free paper memory); EMPTY_SYMBOLS; "
        "UNKNOWN_CANDIDATE, BAD_REF; RUNTIME_UNAVAILABLE; LEDGER_KIND (--ledger is not a Paper database); "
        "PAPER_START_FAILED (the containers did not start; the run is sealed with START_FAILED, write_status written)"),
    ("paper", "resume"): (
        "the unsealed run, its pinned container, source and terms inputs and native checkpoint/journal cut "
        "(reader); the contract terms at the run's market day (--market)",
        "records a recovery attempt, then starts the same runner and account; no new run or ledger row; "
        "all lifecycle commands share a database advisory lock",
        "paper_id, write_status (written or replayed), state (resuming or running)",
        "PAPER_RUN_UNKNOWN; PAPER_RECOVERY_UNAVAILABLE (sealed/user-stopped run, missing or dirty checkpoint, "
        "changed identity, terms that no longer match the market day, journal tail, missing container, a "
        "running run of the source or three recovery "
        "attempts per hour); PAPER_MEMORY_FULL (its reservation exceeds the free paper memory)"),
    ("paper", "stop"): (
        "the paper run (reader); its runner container",
        "a STOP file for the runner (it cancels its orders and writes its summary), then SIGTERM after "
        "--wait-seconds and SIGKILL 30 s later; then seals as paper seal. --request-only durably writes "
        "the final STOP request and returns without waiting; paper serve completes cancellation and sealing",
        "as paper seal; --request-only returns paper_id, state, write_status",
        "PAPER_RUN_UNKNOWN; as paper seal"),
    ("paper", "seal"): (
        "the paper run and its seal (reader); its run directory (journal, summary, egress log) and runner log",
        "the run's seal and its files (the journal by UTC day, summary, logs, seal.json) in one commit, then "
        "removes the containers and network; an existing seal stands and is returned (write_status replayed)",
        "paper_id, files {path: sha256}, seal (status complete or invalid, reasons, returns, drawdown, "
        "funding, fills, orders, gaps, limitations), ledger_commit, write_status",
        "PAPER_RUN_UNKNOWN; PAPER_RUN_ACTIVE (still running: stop it first); RUNTIME_UNAVAILABLE"),
    ("paper", "delete"): (
        "the paper run and its seal (writer)",
        "removes the sealed run's paper_run row, its seal and files in one commit paper_delete:<id>, then its run "
        "directory; Dolt history and the backup keep them; the user's own action (an Agent asks first)",
        "paper_id, files_deleted, ledger_commit, write_status",
        "PAPER_RUN_UNKNOWN; PAPER_RUN_ACTIVE (not sealed: stop or seal it first); DIRTY_WORKING_SET"),
    ("paper", "list"): (
        "every paper run and its seal (reader); this Paper database's containers on Docker",
        "nothing",
        "runs [{paper_id, candidate, source_sha256, symbols, state (running, ended, unsealed or sealed), "
        "created_at, image_ref, status, reasons, total_return, max_drawdown}], running, limit",
        "RUNTIME_UNAVAILABLE (docker did not answer)"),
    ("paper", "serve"): (
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
    ("paper", "reconcile"): (
        "the sealed paper run, its source and its files (reader); the market at --at (default main), exported "
        "into a reused cache under the temporary directory; the run's own runtime image",
        "nothing in any database (no trial, no exposure); the new --output directory (replay/ with the native "
        "reports and audit, reconcile.json)",
        "path, summary {paper_fills, replay_fills, same, price, quantity, time, paper_only, replay_only, "
        "look_ahead_suspects, missing_bars, differing_bars, late_bars, equity_max_difference}, replay {status, "
        "problems, path}",
        "PAPER_RUN_UNKNOWN; PAPER_RUN_ACTIVE (not sealed); PAPER_RECONCILE_EMPTY (no interval); "
        "PAPER_RECONCILE_UNCOVERED (the market lacks the interval's minutes); NOT_TEMPORARY_PATH, PATH_EXISTS "
        "(--output); RUNTIME_UNAVAILABLE"),
}


def register(verbs, verb, runner) -> None:
    """Add the paper nouns to the parser with `cli.main._parser`'s verbs, verb and runner."""
    paper = verbs("paper", "paper runs on live public market data with simulated fills: start, stop, seal, delete, list, "
                           "reconcile, serve")
    command = verb(paper, "start", "declare a paper run of a candidate and start its containers")
    command.epilog = textwrap.fill(
        "Binance public market data and Nautilus Sandbox fills only, no credential (engine.paper); the runner "
        "reaches the network only through an egress proxy that admits Binance's public USD-M hosts. Membership "
        "is the current month's at the market day. Paper runs add no trial count and no exposure.", 100)
    _paper_option(command)
    _market_option(command)
    _market_at(command)
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    scope = command.add_mutually_exclusive_group(required=True)
    scope.add_argument("--symbols", nargs="+", help="Binance symbols such as BTCUSDT")
    scope.add_argument("--universe", choices=("pool",), help="every member of the current month among the contracts this deployment's market holds")
    command.add_argument("--runtime", help=EXECUTION_DEFAULT_HELP)
    command.add_argument("--memory", help="the runner container's memory limit and reservation (default: sized by its contracts)")
    command.add_argument("--research-ledger", help="the research ledger the candidate is read from (default: the "
                                                  "active one)")
    command.add_argument("--research-at", help="read the candidate at this exact research commit")
    command.add_argument("--leverage", default=ACCOUNT_CONTRACT["default_leverage"],
                         help="the account's Binance leverage, an integer from 1 to 125 (default %(default)s)")
    command.add_argument("--duration-seconds", type=int, help="stop after this long (engineering trials)")
    _op_id(command)
    command = verb(paper, "resume", "continue one unsealed run from its consistent native checkpoint")
    _paper_option(command)
    _market_option(command)
    command.add_argument("--paper-id", required=True, type=int, help="paper run ID")
    command = verb(paper, "stop", "stop a running paper run and seal it")
    _paper_option(command)
    command.add_argument("--paper-id", required=True, type=int, help="paper run ID")
    command.add_argument("--request-only", action="store_true", help="persist the final STOP request and return; "
                         "the daemon completes cancellation and sealing")
    command.add_argument("--wait-seconds", type=int, default=60, help="seconds the runner gets to cancel its orders "
                                                                      "and write its summary before it is killed")
    command = verb(paper, "seal", "seal an ended paper run into the Paper database")
    _paper_option(command)
    command.add_argument("--paper-id", required=True, type=int, help="paper run ID")
    command = verb(paper, "delete", "delete a sealed paper run from the Paper database (the user's own action)")
    command.epilog = textwrap.fill(
        "Deleting a run is the user's decision, never an Agent's own (AGENTS.md). The run leaves the Paper database "
        "in one commit; Dolt history and the backup keep it.", 100)
    _paper_option(command)
    command.add_argument("--paper-id", required=True, type=int, help="paper run ID")
    command = verb(paper, "list", "every paper run with its state and seal readings")
    _paper_option(command)
    command = verb(paper, "reconcile", "replay a sealed paper run on the archive and compare it order by order")
    command.epilog = textwrap.fill(
        "The replay takes the run's source, runtime image, contracts and the interval its runner received bars for; "
        "only the market day is chosen here. It is no trial and adds no exposure; nothing reaches the ledger "
        "(paper.reconcile).", 100)
    _paper_option(command)
    _market_option(command)
    _market_at(command)
    command.add_argument("--paper-id", required=True, type=int, help="paper run ID")
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    command.add_argument("--timeout-seconds", type=float, help="stop the replay after this long")
    command = verb(paper, "serve", "serve the Paper database's runs to the trade IDE's Paper panel")
    command.epilog = ("Listens on loopback only, or inside a container on its own address with TMPDIR a host directory "
                      "mounted at its own path (paper.serve); the IDE service reaches it with --paper. Starts, stops and "
                      "seals run this command line, and runs that end on their own are sealed as they are found; one that "
                      "Docker stopped from outside resumes the same unsealed run only from a verified native "
                      "checkpoint; unavailable recovery retains the records without starting a new account.")
    _paper_option(command)
    _market_option(command)
    command.add_argument("--host", default="127.0.0.1",
                         help="address to listen on: loopback, or inside a container 0.0.0.0")
    command.add_argument("--port", type=int, default=8767, help="port to listen on (default: 8767)")
    command.add_argument("--allow-host", action="append", default=[], dest="hosts",
                         help="Host header a request may carry (default: 127.0.0.1, localhost and "
                              "host.docker.internal at PORT); repeatable")
    command.add_argument("--runtime", help=EXECUTION_DEFAULT_HELP + " for the runs it starts")
    command.add_argument("--research-ledger", help="the research ledger candidates and their last replays are read from "
                                                  "(default: the active one)")
    command.add_argument("--release-route", type=Path, help="internal release router configuration; unselected controllers are read-only")
    command.add_argument("--release-name", help="this controller's identity in the internal release router")


def dispatch(args, runner_argv: list[str]) -> tuple[dict, int]:
    """(result, exit code) of one parsed paper command."""
    profile = db.profile(args.ledger, holds="paper")
    from paper import runs as paper_runs
    if args.verb == "start":
        if args.research_at and not db.COMMIT_HASH.fullmatch(args.research_at):
            raise refuse("USAGE_ERROR", "--research-at is a full commit hash")
        return paper_runs.start(profile, profiles.market(args.market), args.at, args.candidate,
                                None if args.universe else args.symbols, args.runtime, args.memory,
                                args.duration_seconds, args.op_id, research=db.profile(args.research_ledger),
                                research_at=args.research_at, leverage=args.leverage), 0
    if args.verb == "stop":
        if args.request_only:
            return paper_runs.request_stop(profile, args.paper_id), 0
        return paper_runs.stop(profile, args.paper_id, args.wait_seconds), 0
    if args.verb == "resume":
        from paper import recovery
        return recovery.resume(profile, profiles.market(args.market), args.paper_id), 0
    if args.verb == "seal":
        return paper_runs.seal(profile, args.paper_id), 0
    if args.verb == "delete":
        return paper_runs.delete(profile, args.paper_id), 0
    if args.verb == "list":
        return paper_runs.listing(profile), 0
    if args.verb == "reconcile":
        from paper import reconcile
        return reconcile.reconcile(profile, profiles.market(args.market), args.at, args.paper_id, Path(args.output),
                                   args.timeout_seconds), 0
    if args.verb == "serve":
        from paper import serve
        serve.serve(args.ledger, args.market, args.host, args.port, args.hosts, Path(__file__).resolve().parents[1],
                    args.runtime, args.research_ledger, args.release_route, args.release_name)
    raise UsageError(f"unknown command {args.noun} {args.verb}")
