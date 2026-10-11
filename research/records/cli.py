"""Research records CLI: ledgers, rounds, strategy revisions, evidence, freezes and confirmations.

Every command opens one connection to one named ledger (`--ledger NAME`, default the active one)
and prints JSON. Errors are JSON on stderr with `code`, `message`, `next_actions` and
`write_status`; the exit code is 2. Writes are idempotent: rerunning the same command returns the
original record (`replayed: true`).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from research.records.common import RecordError, _read_json


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--ledger", help="named ledger profile (default: the active ledger)")
    commands = parser.add_subparsers(dest="command", required=True)

    ledger = commands.add_parser("ledger", help="local Dolt ledgers").add_subparsers(dest="action", required=True)
    init = ledger.add_parser("init", help="create a ledger database (and its service if new)")
    init.add_argument("--name", required=True)
    init.add_argument("--database", required=True)
    init.add_argument("--service-root", type=Path, required=True)
    init.add_argument("--binary", required=True, help="absolute path of the Dolt 2.4.2 binary")
    init.add_argument("--port", type=int, default=13330)
    init.add_argument("--role", choices=("active", "isolated", "temporary"), default="isolated")
    init.add_argument("--backup-root", type=Path)
    init.add_argument("--kind", choices=("research", "market"), default="research",
                      help="the research ledger or the market database (see research/market/README.md)")
    for name in ("start", "stop", "backup"):
        ledger.add_parser(name)
    ledger.add_parser("status", help="every ledger profile and whether its service runs")
    ledger.add_parser("witness", help="timestamp every freeze and confirmation plan that has no timestamp yet")
    temp = ledger.add_parser("temp", help="run a command against a throwaway ledger, then delete it")
    temp.add_argument("--name", required=True)
    temp.add_argument("--binary", required=True)
    temp.add_argument("--port", type=int, default=13390)
    temp.add_argument("cmd", nargs=argparse.REMAINDER)
    export = ledger.add_parser("export", help="write every table at a branch or tag as Parquet (read-only)")
    export.add_argument("--at", required=True)
    export.add_argument("--output", type=Path, required=True)
    sql = ledger.add_parser("sql", help="one read-only SQL statement as the reader account")
    sql.add_argument("statement")
    sql.add_argument("--at", help="branch, tag or commit (default: the open round)")
    sql.add_argument("--limit", type=int, default=200)
    audit = ledger.add_parser("audit", help="full check of one round: tests, readings, verdicts, history, witness")
    audit.add_argument("--at", help="branch or closing tag (default: the open round)")

    rounds = commands.add_parser("round", help="open, close or read the round").add_subparsers(dest="action", required=True)
    opened = rounds.add_parser("open", help="branch round/<goal_id> from main and record the goal")
    opened.add_argument("--goal", type=Path, required=True)
    rounds.add_parser("close", help="tag the round closed/<goal_id> read-only")
    status = rounds.add_parser("status", help="goal, counts and stop-rule counters")
    status.add_argument("--at")

    strategy = commands.add_parser("strategy", help="strategy revisions").add_subparsers(dest="action", required=True)
    publish = strategy.add_parser("publish", help="store one complete strategy source file as a new revision")
    publish.add_argument("--source", type=Path, required=True)
    publish.add_argument("--strategy-id", required=True)
    publish.add_argument("--entry-class", required=True)
    publish.add_argument("--description", required=True)
    publish.add_argument("--parent", help="ID@N this revision derives from")
    publish.add_argument("--difference", help="what changed from the parent")
    publish.add_argument("--op-id")
    show = strategy.add_parser("show")
    show.add_argument("ref", help="ID@N")
    show.add_argument("--at")
    exported = strategy.add_parser("export", help="write a revision's exact source bytes to a new file")
    exported.add_argument("ref", help="ID@N")
    exported.add_argument("--destination", type=Path, required=True)
    exported.add_argument("--at")

    evidence = commands.add_parser("evidence", help="derived evidence bundles").add_subparsers(dest="action", required=True)
    add = evidence.add_parser("add", help="store files (a directory recursively) as one evidence bundle")
    add.add_argument("--bundle", required=True)
    add.add_argument("paths", type=Path, nargs="+")
    add.add_argument("--op-id")
    restore = evidence.add_parser("export", help="write a bundle's files into a new directory")
    restore.add_argument("bundle")
    restore.add_argument("--destination", type=Path, required=True)
    restore.add_argument("--at")

    freeze = commands.add_parser("freeze", help="freeze a candidate: its development run judged once against the goal")
    freeze.add_argument("--run", type=int, required=True)
    freeze.add_argument("--source-bundle", help="evidence bundle holding the goal's claims.json source note")
    freeze.add_argument("--failed-part", choices=("gross_edge", "cost", "frequency", "tail", "integrity"))
    freeze.add_argument("--note", required=True)
    freeze.add_argument("--op-id")

    confirm = commands.add_parser("confirm", help="confirmation on data that did not exist at freeze").add_subparsers(
        dest="action", required=True)
    plan = confirm.add_parser("plan", help="preregister a confirmation window that starts in the future")
    plan.add_argument("--freeze", type=int, required=True)
    plan.add_argument("--window-start", required=True)
    plan.add_argument("--window-end", required=True)
    plan.add_argument("--op-id")
    verdict = confirm.add_parser("verdict", help="judge the confirmation run")
    verdict.add_argument("--plan", type=int, required=True)
    verdict.add_argument("--run", type=int, required=True)
    verdict.add_argument("--failed-part", choices=("gross_edge", "cost", "frequency", "tail", "integrity"))
    verdict.add_argument("--note", required=True)
    verdict.add_argument("--op-id")

    correct = commands.add_parser("correct", help="append a correction to a freeze or confirmation verdict")
    target = correct.add_mutually_exclusive_group(required=True)
    target.add_argument("--freeze", type=int)
    target.add_argument("--verdict", type=int)
    correct.add_argument("--result", choices=("passed", "failed", "invalid"), required=True)
    correct.add_argument("--failed-part", choices=("gross_edge", "cost", "frequency", "tail", "integrity"))
    correct.add_argument("--note", required=True)
    correct.add_argument("--op-id")
    return parser


def run(args) -> dict:
    from research.records import db, ledger, records
    if args.command == "ledger":
        if args.action == "init":
            return ledger.init(name=args.name, database=args.database, service_root=args.service_root,
                               binary=args.binary, port=args.port, role=args.role, backup_root=args.backup_root,
                               of=args.kind)
        if args.action == "status":
            return ledger.status()
        if args.action == "temp":
            command = args.cmd[1:] if args.cmd[:1] == ["--"] else args.cmd
            raise SystemExit(ledger.temporary(args.name, command, args.binary, args.port))
        value = ledger.profile(args.ledger, of=None if args.action in ("start", "stop", "backup") else "research")
        if args.action == "start":
            return ledger.start_service(Path(value["service"]))
        if args.action == "stop":
            return ledger.stop_service(Path(value["service"]))
        if args.action == "backup":
            return ledger.backup(value)
        if args.action == "witness":
            from research.records import witness
            return witness.sync(value)
        if args.action == "export":
            return ledger.export(value, args.at, args.output)
        if args.action == "sql":
            return ledger.sql(value, args.statement, args.at, args.limit)
        from research.records.audit import audit
        return audit(value, args.at)
    value = ledger.profile(args.ledger)
    if args.command == "round":
        if args.action == "open":
            return ledger.open_round(value, _read_json(args.goal))
        if args.action == "close":
            return ledger.close_round(value)
        return records.round_status(value, args.at)
    if args.command == "strategy":
        if args.action == "publish":
            return records.publish_strategy(value, source=args.source.read_bytes(), strategy_id=args.strategy_id,
                                            entry_class=args.entry_class, description=args.description,
                                            parent=args.parent, difference=args.difference, op=args.op_id)
        with db.reading(value, args.at) as conn:
            row = records.strategy(conn, args.ref)
        if args.action == "export":
            if args.destination.exists():
                raise RecordError(f"destination exists: {args.destination}", code="DESTINATION_EXISTS",
                                  write_status="not_written")
            args.destination.write_bytes(row["source"])
        return {key: records._plain(item) for key, item in row.items() if key != "source"} | (
            {"destination": str(args.destination)} if args.action == "export" else {})
    if args.command == "evidence":
        if args.action == "add":
            return records.add_evidence(value, args.bundle, args.paths, args.op_id)
        with db.reading(value, args.at) as conn:
            return records.export_evidence(conn, args.bundle, args.destination)
    if args.command == "freeze":
        return records.freeze(value, run_id=args.run, source_bundle=args.source_bundle,
                              failed_part=args.failed_part, note=args.note, op=args.op_id)
    if args.command == "confirm":
        if args.action == "plan":
            return records.confirm_plan(value, freeze_id=args.freeze, window_start=args.window_start,
                                        window_end=args.window_end, op=args.op_id)
        return records.confirm_verdict(value, plan_id=args.plan, run_id=args.run, failed_part=args.failed_part,
                                       note=args.note, op=args.op_id)
    return records.correct(value, freeze_id=args.freeze, verdict_id=args.verdict, result=args.result,
                           failed_part=args.failed_part, note=args.note, op=args.op_id)


def main() -> int:
    args = _parser().parse_args()
    try:
        result = run(args)
    except RecordError as exc:
        print(json.dumps({"error": exc.as_dict()}, ensure_ascii=False, default=str), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    failed = result.get("ok") is False or (result.get("witness") or {}).get("status") == "failed"
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
