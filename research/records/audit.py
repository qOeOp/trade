"""Full audit of one round, separate from every read: what `ledger audit` checks.

Reads never revalidate the whole ledger; this does, at one branch or closing tag:
commit tests, append-only history, stored readings against a recomputation from the stored rows,
freeze verdicts and trial counts against the goal, and the external witness of every freeze and
confirmation plan. A finding means something changed or was written outside the normal path; the
guarantee is that changes leave traces, not that they are impossible.
"""

from __future__ import annotations

from decimal import Decimal
import json

from research.records import db


TABLES = ("goal", "evidence_bundle", "evidence", "strategy_revision", "trial", "run", "run_order", "run_fill",
          "run_position", "run_account", "run_return", "run_order_event", "freeze", "confirmation_plan",
          "confirmation_verdict", "correction", "witness")
READINGS = ("max_drawdown", "plans_closed", "plans_won", "plans_open", "closed_positions", "open_positions",
            "realized_pnl_usdt", "commissions_usdt", "funding_usdt", "price_pnl_usdt", "unrealized_usdt")


def _same(stored, computed) -> bool:
    if stored is None or computed is None:
        return stored is None and computed is None
    if isinstance(stored, float) or isinstance(computed, float):
        return abs(float(stored) - float(computed)) <= 1e-12
    return Decimal(str(stored)) == Decimal(str(computed))


def audit(profile: dict, at: str | None) -> dict:
    from research.records.analysis import load_run, readings
    from research.records.records import gates, _result
    findings: list[str] = []
    with db.reading(profile, at) as conn:
        failed_tests = [row for row in db.dicts(conn, "SELECT * FROM dolt_test_run('*')")
                        if row.get("status") != "PASS"]
        findings += [f"commit test {row.get('test_name')}: {row.get('message')}" for row in failed_tests]
        for table in TABLES:
            (changed,), = db.rows(conn, f"SELECT COUNT(*) FROM dolt_diff_{table} WHERE diff_type <> 'added'")
            if changed:
                findings.append(f"{table}: {changed} rows were modified or removed after insertion")
        goal = db.one(conn, "SELECT * FROM goal")
        runs = db.dicts(conn, "SELECT * FROM run WHERE status = 'passed' ORDER BY run_id")
        for run in runs:
            values = readings(load_run(conn, run["run_id"]))
            economics, plans = values["economics"] or {}, values["plans"] or {}
            closed = economics.get("closed") or {}
            computed = {"max_drawdown": values["max_drawdown"], "plans_closed": plans.get("closed"),
                        "plans_won": plans.get("wins"), "plans_open": plans.get("open"),
                        "closed_positions": economics.get("closed_trades"),
                        "open_positions": economics.get("open_positions"),
                        "realized_pnl_usdt": closed.get("reported_realized_pnl_usdt"),
                        "commissions_usdt": closed.get("fill_commissions_usdt"),
                        "funding_usdt": closed.get("reported_funding_usdt"),
                        "price_pnl_usdt": closed.get("price_pnl_usdt"),
                        "unrealized_usdt": economics.get("unrealized_residual_usdt")}
            for key in READINGS:
                if not _same(run[key], computed[key]):
                    findings.append(f"run {run['run_id']}: stored {key} {run[key]} differs from recomputed {computed[key]}")
        freezes = db.dicts(conn, "SELECT f.*, d.to_commit FROM freeze f JOIN dolt_diff_freeze d "
                                 "ON d.to_freeze_id = f.freeze_id AND d.diff_type = 'added' ORDER BY f.freeze_id")
        for item in freezes:
            run = db.one(conn, "SELECT r.*, t.trade_start, t.trade_end FROM run r JOIN trial t ON t.trial_id = r.trial_id "
                               "WHERE r.run_id = %s", (item["run_id"],))
            try:
                expected = _result(run, gates(goal, run, development=True), item["failed_part"])
            except Exception as exc:  # noqa: BLE001 - a refusal is itself the finding
                expected = f"refused ({exc})"
            if expected != item["result"]:
                findings.append(f"freeze {item['freeze_id']}: stored result {item['result']}, recomputed {expected}")
            (sources,), = db.rows(conn, "SELECT COUNT(DISTINCT strategy_source_sha256) FROM trial AS OF %s "
                                        "WHERE trade_start < %s AND trade_end > %s",
                                  (item["to_commit"], goal["window_end"], goal["window_start"]))
            if sources != item["distinct_sources"]:
                findings.append(f"freeze {item['freeze_id']}: {item['distinct_sources']} distinct sources recorded, "
                                f"{sources} in the trial table at its commit")
        witnessed = [(row["to_commit"], "freeze", row["freeze_id"]) for row in freezes] + [
            (commit, "confirmation_plan", plan_id) for commit, plan_id in db.rows(
                conn, "SELECT to_commit, to_plan_id FROM dolt_diff_confirmation_plan WHERE diff_type = 'added'")]
        from research.records.witness import stamped_at
        from research.records.common import RecordError
        for commit, kind, record_id in witnessed:
            try:
                if stamped_at(conn, commit) is None:
                    findings.append(f"{kind} {record_id} (commit {commit}) has no timestamp")
            except RecordError as exc:
                findings.append(f"{kind} {record_id} (commit {commit}): {exc}")
        (head,), = db.rows(conn, "SELECT DOLT_HASHOF('HEAD')")
    return {"at": at or "open round", "commit": head, "runs_checked": len(runs), "freezes_checked": len(freezes),
            "ok": not findings, "findings": findings}
