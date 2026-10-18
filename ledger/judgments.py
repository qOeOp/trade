"""Agent judgments (`ledger.add_judgment`).

A judgment is the Agent's text (recommendation, priority, review cadence, interpretation or search
exposure) on a research line, based on an exact ledger commit, about named candidates, trials or
attempted registrations. It cites records and never copies their facts; it is appended, and a
newer judgment of the same kind on the same line supersedes it at most once.
"""

from __future__ import annotations

from collections.abc import Mapping

from ledger import db, lines, strategies
from ledger.errors import Refusal
from ledger.refusals import refuse


CANDIDATE_ROLES = ("recommended", "parent", "control")
ROLES = CANDIDATE_ROLES + ("about",)
TARGETS = ("candidate", "trial_id", "registration_bundle")


def _subjects(subjects) -> list[dict]:
    normalized = []
    for subject in subjects or ():
        if not isinstance(subject, Mapping):
            raise refuse("SUBJECT_UNKNOWN", "a subject must name exactly one candidate, trial or registration bundle")
        targets = [key for key in TARGETS if subject.get(key) is not None]
        if len(targets) != 1 or set(subject) - set(TARGETS) - {"role"}:
            raise refuse("SUBJECT_UNKNOWN", "a subject must name exactly one candidate, trial or registration bundle",
                         expected="{role, candidate | trial_id | registration_bundle}")
        role = subject.get("role")
        if role not in ROLES or (role in CANDIDATE_ROLES and targets != ["candidate"]):
            raise refuse("SUBJECT_ROLE_MISMATCH", f"role {role!r} does not fit a {targets[0]} subject",
                         expected="recommended | parent | control for candidates, about for any subject")
        normalized.append({"role": role, targets[0]: subject[targets[0]]})
    return normalized


def _check_subject(conn: db.LedgerConnection, subject: dict) -> tuple:
    if "candidate" in subject:
        try:
            strategy_id, revision = strategies.parse_ref(subject["candidate"])
        except Refusal:
            strategy_id, revision = None, None
        if strategy_id is None or not conn.rows(
                "SELECT 1 FROM candidate WHERE strategy_id = %s AND revision = %s", (strategy_id, revision)):
            raise refuse("SUBJECT_UNKNOWN", f"no candidate {subject['candidate']!r}",
                         missing=(str(subject["candidate"]),))
        return subject["role"], strategy_id, revision, None, None
    if "trial_id" in subject:
        trial_id = subject["trial_id"]
        if not isinstance(trial_id, int) or not conn.rows("SELECT 1 FROM trial WHERE trial_id = %s", (trial_id,)):
            raise refuse("SUBJECT_UNKNOWN", f"no trial {trial_id!r}", missing=(str(trial_id),))
        return subject["role"], None, None, trial_id, None
    bundle = subject["registration_bundle"]
    if not isinstance(bundle, str) or not conn.rows(
            "SELECT 1 FROM registration_attempt WHERE registration_bundle = %s LIMIT 1", (bundle,)):
        raise refuse("SUBJECT_UNKNOWN", f"registration bundle {bundle!r} was never attempted", missing=(str(bundle),))
    return subject["role"], None, None, None, bundle


def _is_ancestor(conn: db.LedgerConnection, ancestor: str, descendant: str) -> bool:
    (base,), = conn.rows("SELECT DOLT_MERGE_BASE(%s, %s)", (ancestor, descendant))
    return base == ancestor


def add_judgment(profile: db.LedgerProfile, kind: str, line_bundle: str, based_on_commit: str, body: str,
                 cadence_trials: int | None = None, subjects: list[dict] | None = None, supersedes: int | None = None,
                 op_id: str | None = None) -> dict:
    """Append one judgment and its subjects in one write; the same payload again is a replay."""
    if (kind == "review_cadence") != (cadence_trials is not None) or (
            cadence_trials is not None and (not isinstance(cadence_trials, int) or cadence_trials < 1)):
        raise refuse("CADENCE_REQUIRED", "cadence_trials (a positive integer) is required exactly for review_cadence",
                     missing=("cadence_trials",) if kind == "review_cadence" else ())
    normalized = _subjects(subjects)
    with db.connect(profile, "writer") as conn:
        try:
            commit = db.resolve_commit(conn, based_on_commit)
        except Refusal as exc:
            raise refuse("COMMIT_NOT_ANCESTOR", f"{based_on_commit!r} is no commit of this ledger",
                         missing=(str(based_on_commit),)) from exc
        payload = {"kind": kind, "line_bundle": line_bundle, "based_on_commit": commit, "body": body,
                   "cadence_trials": cadence_trials, "subjects": normalized, "supersedes": supersedes}

        def insert(c, op):
            if not isinstance(line_bundle, str) or not lines.LINE.fullmatch(line_bundle) or not c.rows(
                    "SELECT 1 FROM evidence_bundle WHERE bundle = %s", (line_bundle,)):
                raise refuse("LINE_UNKNOWN", f"no research line bundle {line_bundle!r}", missing=(str(line_bundle),))
            if not _is_ancestor(c, commit, "HEAD"):
                raise refuse("COMMIT_NOT_ANCESTOR", f"{commit} is not an ancestor of the ledger head")
            line_commit = c.rows("SELECT to_commit FROM dolt_diff_evidence_bundle WHERE to_bundle = %s "
                                 "AND diff_type = 'added' LIMIT 1", (line_bundle,))[0][0]
            if not _is_ancestor(c, line_commit, commit):
                raise refuse("COMMIT_BEFORE_LINE", f"{commit} is older than {line_bundle} ({line_commit})")
            rows = [_check_subject(c, subject) for subject in normalized]
            if supersedes is not None:
                old = c.one("SELECT kind, line_bundle, cadence_trials FROM judgment WHERE judgment_id = %s",
                            (supersedes,))
                if (old is None or old["kind"] != kind or old["line_bundle"] != line_bundle
                        or c.rows("SELECT 1 FROM judgment WHERE supersedes = %s", (supersedes,))):
                    raise refuse("SUPERSEDES_INVALID", f"judgment {supersedes} cannot be superseded by this one",
                                 missing=(str(supersedes),))
                if kind == "review_cadence" and cadence_trials > old["cadence_trials"]:
                    raise refuse("REVIEW_CADENCE_RAISED", f"the cadence may only be lowered from "
                                                          f"{old['cadence_trials']}",
                                 expected=f"cadence_trials <= {old['cadence_trials']}")
            c.rows("INSERT INTO judgment (kind, line_bundle, based_on_commit, body, cadence_trials, supersedes, op_id, "
                   "created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, UTC_TIMESTAMP(6))",
                   (kind, line_bundle, commit, body, cadence_trials, supersedes, op))
            (judgment_id,), = c.rows("SELECT LAST_INSERT_ID()")
            if rows:
                c.many("INSERT INTO judgment_subject (judgment_id, seq, role, strategy_id, revision, trial_id, "
                       "registration_bundle) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                       [(judgment_id, seq, *row) for seq, row in enumerate(rows, start=1)])
            return {"judgment_id": judgment_id}

        def replay(c, row):
            stored = c.dicts("SELECT role, strategy_id, revision, trial_id, registration_bundle FROM judgment_subject "
                             "WHERE judgment_id = %s ORDER BY seq", (row["judgment_id"],))
            stored_subjects = [{"role": item["role"], **(
                {"candidate": f"{item['strategy_id']}@{item['revision']}"} if item["strategy_id"] is not None else
                {"trial_id": item["trial_id"]} if item["trial_id"] is not None else
                {"registration_bundle": item["registration_bundle"]})} for item in stored]
            original = {"kind": row["kind"], "line_bundle": row["line_bundle"],
                        "based_on_commit": row["based_on_commit"], "body": row["body"],
                        "cadence_trials": row["cadence_trials"], "subjects": stored_subjects,
                        "supersedes": row["supersedes"]}
            if original != payload:
                raise refuse("OP_ID_CONFLICT", f"operation {row['op_id']} already names another judgment",
                             missing=(row["op_id"],))
            return {"judgment_id": row["judgment_id"]}

        written = db.write(conn, "add_judgment", payload, "judgment", insert, replay, op_id=op_id)
    return {"judgment_id": written["record"]["judgment_id"], "ledger_commit": written["commit"],
            "replayed": written["replayed"]}
