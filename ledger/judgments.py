"""Agent judgments (`ledger.add_judgment`).

A judgment is the Agent's text (recommendation, priority, interpretation or search exposure; the
judgment.kind ENUM) on a research line, based on an exact ledger commit, about named candidates, trials or
research registrations. It cites records and never copies their facts; it is appended, and a
newer judgment of the same kind on the same line supersedes it at most once. The review cadence is
the product's (registration.REVIEW_EVERY), never a judgment. A recommendation names, among its
candidate subjects, every candidate with a run of the line's execution identity in its comparison
table at the commit it is based on.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping

from ledger import db, lines, strategies
from shared.errors import Refusal
from shared.refusals import refuse


CANDIDATE_ROLES = ("recommended", "parent", "control")  # with `about`, the judgment_subject.role ENUM
TARGETS = ("candidate", "trial_id", "registration_id")


def _subjects(subjects) -> list[dict]:
    normalized = []
    for subject in subjects or ():
        if not isinstance(subject, Mapping):
            raise refuse("SUBJECT_UNKNOWN", "a subject must name exactly one candidate, trial or registration")
        targets = [key for key in TARGETS if subject.get(key) is not None]
        if len(targets) != 1 or set(subject) - set(TARGETS) - {"role"}:
            raise refuse("SUBJECT_UNKNOWN", "a subject must name exactly one candidate, trial or registration",
                         expected="{candidate, role} | {trial_id} | {registration_id}")
        role = subject.get("role") or (None if targets == ["candidate"] else "about")  # its only possible role
        if role not in (*CANDIDATE_ROLES, "about") or (role in CANDIDATE_ROLES and targets != ["candidate"]):
            raise refuse("SUBJECT_ROLE_MISMATCH", f"role {role!r} does not fit a {targets[0]} subject",
                         expected="recommended | parent | control for candidates, about for any subject")
        normalized.append({"role": role, targets[0]: subject[targets[0]]})
    return normalized


def _check_subject(conn: db.LedgerConnection, subject: dict) -> tuple:
    """(role, source_sha256, trial_id, research_registration_id) of one subject."""
    if "candidate" in subject:
        try:
            row = strategies.read_candidate(conn, subject["candidate"])
        except Refusal as exc:
            raise refuse("SUBJECT_UNKNOWN", f"no candidate {subject['candidate']!r}",
                         missing=(str(subject["candidate"]),)) from exc
        return subject["role"], row["source_sha256"], None, None
    if "trial_id" in subject:
        trial_id = subject["trial_id"]
        if not isinstance(trial_id, int) or not conn.rows("SELECT 1 FROM trial WHERE trial_id = %s", (trial_id,)):
            raise refuse("SUBJECT_UNKNOWN", f"no trial {trial_id!r}", missing=(str(trial_id),))
        return subject["role"], None, trial_id, None
    registration = subject["registration_id"]
    if not isinstance(registration, int) or not conn.rows(
            "SELECT 1 FROM research_registration WHERE registration_id = %s", (registration,)):
        raise refuse("SUBJECT_UNKNOWN", f"no research registration {registration!r}", missing=(str(registration),))
    return subject["role"], None, None, registration


def _is_ancestor(conn: db.LedgerConnection, ancestor: str, descendant: str) -> bool:
    (base,), = conn.rows("SELECT DOLT_MERGE_BASE(%s, %s)", (ancestor, descendant))
    return base == ancestor


def add_judgment(profile: db.LedgerProfile, kind: str, line: str, based_on_commit: str, body: str,
                 subjects: list[dict] | None = None, supersedes: int | None = None, op_id: str | None = None, *,
                 compared: Callable[[str, str], list[str]] | None = None) -> dict:
    """Append one judgment and its subjects in one write; the same payload again is a replay.

    `compared(line, commit)` is report.compared_candidates: the `candidates` of the line's
    comparison table at a commit, which a recommendation must all name (required for one)."""
    if kind == "recommendation" and compared is None:
        raise ValueError("a recommendation needs the comparison table (compared=)")
    normalized = _subjects(subjects)
    with db.connect(profile, "writer") as conn:
        try:
            commit = db.resolve_commit(conn, based_on_commit)
        except Refusal as exc:
            raise refuse("COMMIT_NOT_ANCESTOR", f"{based_on_commit!r} is no commit of this ledger",
                         missing=(str(based_on_commit),)) from exc
        line_id = lines.read_line(conn, line)["line_id"] if isinstance(line, str) else None
        if line_id is None:
            raise refuse("LINE_UNKNOWN", f"no research line {line!r}", missing=(str(line),))
        payload = {"kind": kind, "line": line, "based_on_commit": commit, "body": body,
                   "subjects": normalized, "supersedes": supersedes}

        def checked_subjects(c):
            if not _is_ancestor(c, commit, "HEAD"):
                raise refuse("COMMIT_NOT_ANCESTOR", f"{commit} is not an ancestor of the ledger head")
            line_commit = c.rows("SELECT to_commit FROM dolt_diff_research_line WHERE to_line_id = %s "
                                 "AND diff_type = 'added' LIMIT 1", (line_id,))[0][0]
            if not _is_ancestor(c, line_commit, commit):
                raise refuse("COMMIT_BEFORE_LINE", f"{commit} is older than line {line} ({line_commit})")
            return [_check_subject(c, subject) for subject in normalized]

        # The table is a function of the fixed commit and takes minutes: inside the transaction any other
        # write landing meanwhile would roll this one back. A replay needs no table.
        candidates: list[str] = []
        op_id = op_id or db.derive_op_id("add_judgment", payload)
        if kind == "recommendation" and not conn.rows("SELECT 1 FROM judgment WHERE op_id = %s", (op_id,)):
            assert compared is not None
            checked_subjects(conn)  # a bad line, commit or subject is refused as itself, not by the table's read
            candidates = compared(line, commit)

        def insert(c, op):
            rows = checked_subjects(c)
            if kind == "recommendation":
                named = {subject["candidate"] for subject in normalized if "candidate" in subject}
                missing = [ref for ref in candidates if ref not in named]
                if missing:
                    raise refuse("RECOMMENDATION_INCOMPLETE", "the recommendation does not name every candidate of "
                                                              f"the line's execution identity in the comparison table at "
                                                              f"{commit}: " + ", ".join(missing),
                                 missing=tuple(missing))
            if supersedes is not None:
                old = c.one("SELECT kind, line_id FROM judgment WHERE judgment_id = %s", (supersedes,))
                if (old is None or old["kind"] != kind or old["line_id"] != line_id
                        or c.rows("SELECT 1 FROM judgment WHERE supersedes = %s", (supersedes,))):
                    raise refuse("SUPERSEDES_INVALID", f"judgment {supersedes} cannot be superseded by this one",
                                 missing=(str(supersedes),))
            c.rows("INSERT INTO judgment (kind, line_id, based_on_commit, body, supersedes, op_id) "
                   "VALUES (%s, %s, %s, %s, %s, %s)", (kind, line_id, commit, body, supersedes, op))
            (judgment_id,), = c.rows("SELECT LAST_INSERT_ID()")
            if rows:
                c.many("INSERT INTO judgment_subject (judgment_id, seq, role, source_sha256, trial_id, "
                       "research_registration_id) VALUES (%s, %s, %s, %s, %s, %s)",
                       [(judgment_id, seq, *row) for seq, row in enumerate(rows, start=1)])
            return {"judgment_id": judgment_id}

        def replay(c, row):
            stored = c.dicts("SELECT s.role, c.strategy_id, c.revision, s.trial_id, s.research_registration_id "
                             "FROM judgment_subject s LEFT JOIN candidate c ON c.source_sha256 = s.source_sha256 "
                             "WHERE s.judgment_id = %s ORDER BY s.seq", (row["judgment_id"],))
            stored_subjects = [{"role": item["role"], **(
                {"candidate": f"{item['strategy_id']}@{item['revision']}"} if item["strategy_id"] is not None else
                {"trial_id": item["trial_id"]} if item["trial_id"] is not None else
                {"registration_id": item["research_registration_id"]})} for item in stored]
            original = {"kind": row["kind"], "line": lines.read_line(c, row["line_id"])["name"],
                        "based_on_commit": row["based_on_commit"], "body": row["body"],
                        "subjects": stored_subjects, "supersedes": row["supersedes"]}
            if original != payload:
                raise refuse("OP_ID_CONFLICT", f"operation {row['op_id']} already names another judgment",
                             missing=(row["op_id"],))
            return {"judgment_id": row["judgment_id"]}

        written = db.write(conn, "add_judgment", payload, "judgment", insert, replay, op_id=op_id)
    return {"judgment_id": written["record"]["judgment_id"], "ledger_commit": written["commit"],
            "replayed": written["replayed"]}
