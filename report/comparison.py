"""The comparison report and the out-of-sample report (`report.compare`, `report.paired`, `report.single`,
`report.holm`, `report.validation_report`).

The comparison has one entry: it reads the registration, checks both sides' comparability and
economic evidence, runs the paired circular block bootstrap on the two sides' daily account returns
and adds the attribution, all at read time from stored rows with the registration's locked seed, so
any recomputation gives the same numbers; nothing is stored and no field is a verdict. A declared
interaction is read from its four corners (`interaction_of`); when they do not attest the shape it
is reported unavailable and the rest of the comparison stands.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import hashlib
import json
import math
from pathlib import Path
from statistics import NormalDist

import numpy as np

from ledger import db, metrics, strategies, witness
from ledger.errors import Refusal
from ledger.refusals import refuse
from qualification import availability
from registration import comparability, register
from report import attribution as report_attribution, measures, runs


PAIRED_LIMITATIONS = (
    "The tested object is the daily log difference of the candidate's and the control's account returns on the same "
    "UTC day; the null hypothesis is a mean daily log difference not above zero (one-sided)",
    "Bonferroni covers only this registration's grid, not the search across registrations",
    "p is a tail probability under the null model, not the probability that the strategy works",
    "A development-window comparison after an adaptive search is no independent validation",
    "The block bootstrap assumes the daily differences are roughly stationary and weakly dependent",
    "The annual difference interval does not test the minimum effect",
    "The test design values are uncalibrated method examples")
SINGLE_LIMITATIONS = (
    "p is a tail probability under the null model, not the probability that the strategy works",
    "The test design values are uncalibrated method examples",
    "The single-series block bootstrap assumes the daily returns are roughly stationary and weakly dependent")
VALIDATION_LIMITATIONS = (
    "p is a tail probability under the null model, not the probability that the strategy works",
    "The test design values are uncalibrated method examples",
    "Economic evidence is a read-time view; it rewrites no stored conclusion",
    "Holm's step-down correction corresponds to no single interval; the family interval coverage is Bonferroni")
POWER = 0.8  # the power of the detectable effect; an uncalibrated example value
INTERACTION_WEIGHTS = (1.0, -1.0, -1.0, 1.0)  # base, a, b, ab: ab - a - b + base
INTERACTION_LIMITATIONS = (
    "The interaction is read on the daily log account returns of four separately run corners; its interval is "
    "uncorrected for any search and no p is given",
    "An interaction explains where a difference comes from; it is no evidence of an improvement",
    "The contributions average each change's marginal effect over both orders of adding the two changes")
UNCORRECTED_DROPPED = ("p_one_sided", "p_bonferroni", "interval_coverage_grid_adjusted",
                       "detectable_mean_log_difference_80pct_normal_approx", "observed_account_annual_return_difference")


def _source() -> str:
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


# The bootstrap

def _series(values, name: str) -> np.ndarray:
    try:
        array = np.asarray(values, dtype=float)
    except (TypeError, ValueError) as exc:
        raise refuse("COMPARISON_UNAVAILABLE", f"{name} is not a numeric series", missing=(name,)) from exc
    if array.ndim != 1:
        raise refuse("COMPARISON_UNAVAILABLE", f"{name} is not one-dimensional", missing=(name,))
    if not np.all(np.isfinite(array)) or np.any(array <= -1):
        raise refuse("COMPARISON_UNAVAILABLE", f"{name} holds a value that is not finite or not above -1",
                     missing=(name,))
    return array


def _deviation(values: np.ndarray, axis=None) -> np.ndarray | float:
    """The sample standard deviation, exactly zero when every value is the same (numpy's two-pass
    formula leaves rounding residue there)."""
    spread = np.std(values, axis=axis, ddof=1)
    flat = np.ptp(values, axis=axis) == 0
    return float(0.0 if flat else spread) if axis is None else np.where(flat, 0.0, spread)


def block_indices(rng: np.random.Generator, days: int, block: int, resamples: int) -> np.ndarray:
    """(resamples, days) circular block indices: each row draws ceil(days / block) block starts in
    [0, days) and concatenates the wrapped blocks, cut to `days`."""
    count = math.ceil(days / block)
    offsets = np.arange(block)
    rows = np.empty((resamples, days), dtype=np.int64)
    for row in range(resamples):
        starts = rng.integers(0, days, size=count)
        rows[row] = ((starts[:, None] + offsets).ravel()[:days]) % days
    return rows


def _outer(values: np.ndarray, block: int, resamples: int, seed: int, alpha: float) -> dict:
    """Basic interval and one-sided p of the mean of `values` by the outer circular block bootstrap."""
    observed = float(values.mean())
    means = values[block_indices(np.random.default_rng(seed), len(values), block, resamples)].mean(axis=1)
    deviation = _deviation(means)
    centered = means - observed
    p = (int(np.sum(centered >= observed)) + 1) / (resamples + 1) if deviation > 0 else None
    low, high = np.quantile(means, [alpha / 2, 1 - alpha / 2])
    return {"means": means, "se": deviation, "p": p,
            "basic": [2 * observed - float(high), 2 * observed - float(low)]}


def _studentized(values: np.ndarray, indices: np.ndarray, se: float, block: int, inner: int, seed: int,
                 alpha: float) -> tuple[list[float] | None, int]:
    """The nested (studentized) interval: each outer resample's standard error from `inner` inner block
    resamples (their own random stream, seeded by (seed, 1)); None when any inner one is degenerate."""
    observed = float(values.mean())
    rng = np.random.default_rng([seed, 1])
    stats, degenerate = [], 0
    days = len(values)
    for row in indices:
        sample = values[row]
        inner_means = sample[block_indices(rng, days, block, inner)].mean(axis=1)
        inner_se = _deviation(inner_means)
        if inner_se <= 0:
            degenerate += 1
            continue
        stats.append((float(sample.mean()) - observed) / inner_se)
    if degenerate or se <= 0 or not stats:
        return None, degenerate
    low, high = np.quantile(np.asarray(stats), [alpha / 2, 1 - alpha / 2])
    return [observed - float(high) * se, observed - float(low) * se], degenerate


def _sensitivity(values: np.ndarray, block: int, resamples: int, seed: int, alpha: float) -> list[dict]:
    found = []
    for length in (max(1, block // 2), block, 2 * block):
        if len(values) < 2 * length:
            found.append({"block_days": length, "available": False})
            continue
        outer = _outer(values, length, resamples, seed, alpha)
        found.append({"block_days": length, "available": True, "mean_log_interval": outer["basic"],
                      "p_one_sided": outer["p"]})
    return found


def paired(left: Sequence, right: Sequence, design: dict, grid_points: int,
           weights: Sequence[float] | None = None) -> dict:
    """The paired circular block bootstrap of the daily log difference (right minus left), or with
    `weights` of the weighted sum of several aligned daily log series ([*left, *right]); both sides
    share one matrix of block starts. Effect, intervals, p and robustness numbers; no verdict."""
    register.validate_design(design)
    if not isinstance(grid_points, int) or isinstance(grid_points, bool) or grid_points < 1:
        raise refuse("REGISTRATION_INVALID", "grid_points must be a positive integer", missing=("grid_points",))
    if weights is None:
        sides = [_series(left, "left"), _series(right, "right")]
        weights = (-1.0, 1.0)
    else:
        sides = [_series(item, f"series {index}") for index, item in enumerate([*left, *right])]
        if len(weights) != len(sides):
            raise refuse("COMPARISON_UNAVAILABLE", "the weights do not match the series", missing=("weights",))
    days = len(sides[0])
    if any(len(side) != days for side in sides):
        raise refuse("COMPARISON_UNAVAILABLE", "the series differ in length", missing=("days",))
    block, resamples = design["block_days"], design["resamples"]
    if days < 2 * block:
        raise refuse("COMPARISON_UNAVAILABLE", f"{days} days hold fewer than two blocks of {block}",
                     missing=("days",), expected=f"at least {2 * block} days")
    logs = [np.log1p(side) for side in sides]
    values = sum(weight * series for weight, series in zip(weights, logs))
    alpha = design["alpha"] / grid_points
    observed = float(values.mean())
    indices = block_indices(np.random.default_rng(design["seed"]), days, block, resamples)
    means = values[indices].mean(axis=1)
    se = _deviation(means)
    centered = means - observed
    limitations = list(PAIRED_LIMITATIONS)
    p = (int(np.sum(centered >= observed)) + 1) / (resamples + 1) if se > 0 else None
    if p is None:
        limitations.append("DEGENERATE_SE: the bootstrap standard error is zero; p and the studentized interval are "
                           "empty")
    low, high = np.quantile(means, [alpha / 2, 1 - alpha / 2])
    studentized, degenerate = _studentized(values, indices, se, block, design["inner_resamples"], design["seed"], alpha)
    if degenerate:
        limitations.append(f"DEGENERATE_NESTED: {degenerate} outer resamples had a zero inner standard error; the "
                           "studentized interval is empty")
    annual, annual_interval = None, None
    if len(sides) == 2:
        annual = math.exp(365 * float(logs[1].mean())) - math.exp(365 * float(logs[0].mean()))
        spread = np.exp(365 * logs[1][indices].mean(axis=1)) - np.exp(365 * logs[0][indices].mean(axis=1))
        annual_interval = [float(value) for value in np.quantile(spread, [alpha / 2, 1 - alpha / 2])]
    else:
        limitations.append("A weighted contrast has no annual return difference")
    absolute = np.sort(np.abs(values))[::-1]
    normal = NormalDist()
    return {"method": design["method"], "days": days, "mean_daily_log_difference": observed,
            "mean_log_basic_interval": [2 * observed - float(high), 2 * observed - float(low)],
            "mean_log_studentized_interval": studentized, "annual_return_difference": annual,
            "annual_return_difference_interval": annual_interval, "interval_coverage_grid_adjusted": 1 - alpha,
            "p_one_sided": p, "p_bonferroni": None if p is None else min(1.0, p * grid_points),
            "predeclared_alpha": design["alpha"], "predeclared_minimum_effect": design["minimum_effect"],
            "detectable_mean_log_difference_80pct_normal_approx":
                se * (normal.inv_cdf(1 - alpha) + normal.inv_cdf(POWER)),
            "top_five_absolute_difference_share": float(absolute[:5].sum() / absolute.sum()) if absolute.sum() else None,
            "block_sensitivity": _sensitivity(values, block, resamples, design["seed"], alpha),
            "degenerate_nested_samples": degenerate, "design": dict(design), "grid_points": grid_points,
            "limitations": limitations}


def single(returns: Sequence, design: dict, family_size: int = 1) -> dict:
    """The single-series circular block bootstrap of an out-of-sample window's daily log returns: the
    mean and annualized Sharpe ratio with basic intervals, a studentized interval of the mean, the
    one-sided p of a mean not above zero and the block-length sensitivity; no verdict."""
    register.validate_design(design)
    if not isinstance(family_size, int) or isinstance(family_size, bool) or family_size < 1:
        raise refuse("COMPARISON_UNAVAILABLE", "family_size must be a positive integer", missing=("family_size",))
    values = np.log1p(_series(returns, "returns"))
    days, block, resamples = len(values), design["block_days"], design["resamples"]
    if days < 2 * block:
        raise refuse("COMPARISON_UNAVAILABLE", f"{days} days hold fewer than two blocks of {block}",
                     missing=("days",), expected=f"at least {2 * block} days")
    alpha = design["alpha"] / family_size
    observed = float(values.mean())
    deviation = _deviation(values)
    sharpe = observed / deviation * math.sqrt(365) if deviation > 0 else None
    indices = block_indices(np.random.default_rng(design["seed"]), days, block, resamples)
    samples = values[indices]
    means = samples.mean(axis=1)
    se = _deviation(means)
    limitations = list(SINGLE_LIMITATIONS)
    p = (int(np.sum(means - observed >= observed)) + 1) / (resamples + 1) if se > 0 else None
    if p is None:
        limitations.append("DEGENERATE_SE: the bootstrap standard error is zero; p is empty")
    low, high = np.quantile(means, [alpha / 2, 1 - alpha / 2])
    sharpe_interval = None
    if sharpe is not None:
        spread = _deviation(samples, axis=1)
        valid = spread > 0
        if np.all(valid):
            ratios = means / spread * math.sqrt(365)
            s_low, s_high = np.quantile(ratios, [alpha / 2, 1 - alpha / 2])
            sharpe_interval = [2 * sharpe - float(s_high), 2 * sharpe - float(s_low)]
        else:
            limitations.append("A resample without variation leaves the Sharpe ratio interval empty")
    studentized, degenerate = _studentized(values, indices, se, block, design["inner_resamples"], design["seed"], alpha)
    if degenerate:
        limitations.append(f"DEGENERATE_NESTED: {degenerate} outer resamples had a zero inner standard error; the "
                           "studentized interval is empty")
    return {"method": design["method"], "days": days, "mean_daily_log": observed,
            "mean_log_basic_interval": [2 * observed - float(high), 2 * observed - float(low)],
            "mean_log_studentized_interval": studentized, "sharpe_annualised": sharpe, "sharpe_interval": sharpe_interval,
            "p_one_sided": p, "interval_coverage": 1 - alpha,
            "block_sensitivity": _sensitivity(values, block, resamples, design["seed"], alpha),
            "degenerate_nested_samples": degenerate, "predeclared_alpha": design["alpha"],
            "predeclared_minimum_effect": design["minimum_effect"], "design": dict(design),
            "limitations": limitations}


def holm(p_values: Sequence[float]) -> list[float]:
    """Holm's step-down adjusted p values in the original order: sorted ascending, the k-th smallest
    times (m - k + 1), made monotone by a running maximum and cut at 1."""
    values = list(p_values)
    if not values or any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value)
                         or not 0 <= value <= 1 for value in values):
        raise refuse("COMPARISON_UNAVAILABLE", "Holm's correction needs a nonempty list of p values in [0, 1]",
                     missing=("p_values",))
    order = sorted(range(len(values)), key=lambda index: values[index])
    adjusted, running = [0.0] * len(values), 0.0
    for rank, index in enumerate(order):
        running = max(running, min(1.0, values[index] * (len(values) - rank)))
        adjusted[index] = running
    return adjusted


# The comparison

def trade_window_series(facts: Mapping, side: str) -> list[tuple[int, float, object]]:
    """The trade-window daily returns of one side, refused unless they compound to its final equity."""
    limitations: list[str] = []
    if facts["starting_balance"] is None or facts["final_equity"] is None:
        raise refuse("COMPARISON_UNAVAILABLE", f"the {side} run records no starting balance or final equity",
                     missing=(side,))
    summary = {"period_start_utc": str(facts["trade_start_ns"]), "period_end_utc": str(facts["trade_end_ns"]),
               "starting_balance_usdt": str(facts["starting_balance"]),
               "final_equity_usdt": str(facts["final_equity"])}
    series = metrics.daily_returns([(ts, value) for ts, value, _ in facts["returns"]], summary, limitations)
    if series is None:
        raise refuse("COMPARISON_UNAVAILABLE", f"the {side} daily returns are unusable: " + "; ".join(limitations),
                     missing=(side,))
    return facts["returns"]


def check_clocks(control: Sequence, candidate: Sequence) -> None:
    """CLOCK_MISMATCH unless both daily series hold the same UTC days in the same order."""
    left, right = [item[0] for item in control], [item[0] for item in candidate]
    if left != right:
        differs = next((index for index, (a, b) in enumerate(zip(left, right)) if a != b), min(len(left), len(right)))
        raise refuse("CLOCK_MISMATCH", f"the two sides' UTC daily clocks differ from day {differs}",
                     missing=("ts_event_ns",))


def _run_row(conn: db.LedgerConnection, run_id: int, side: str) -> dict:
    found = conn.one("SELECT r.run_id, r.trial_id, r.status, t.purpose, t.source_sha256, t.image_digest FROM run r "
                     "JOIN trial t ON t.trial_id = r.trial_id WHERE r.run_id = %s", (run_id,))
    if found is None:
        if side == "control":
            raise refuse("NO_CONTROL", f"the registered control run {run_id} does not exist", missing=(str(run_id),))
        raise refuse("UNKNOWN_RUN", f"no run {run_id} on this ledger version", missing=(str(run_id),))
    return found


def gather(conn: db.LedgerConnection, bundle: str, run_id: int) -> dict:
    """Every check of report.compare and both sides' stored facts (read only)."""
    plan, registered_at = register.load_plan(conn, bundle)
    body, execution = plan["body"], plan["execution"]
    if body.get("control_run") is None:
        raise refuse("NO_CONTROL", f"{bundle} declares no control run", missing=("control_run",))
    candidate = _run_row(conn, run_id, "candidate")
    attempt = conn.one("SELECT source_sha256 FROM registration_attempt WHERE registration_bundle = %s AND trial_id = %s",
                       (bundle, candidate["trial_id"]))
    if attempt is None or attempt["source_sha256"] != candidate["source_sha256"]:
        raise refuse("RUN_NOT_IN_GRID", f"run {run_id} is not the run of a grid point of {bundle}",
                     missing=(str(run_id),))
    control = _run_row(conn, body["control_run"], "control")
    records = {}
    for side, row in (("candidate", candidate), ("control", control)):
        records[side] = register.control_run(conn, row["run_id"])
        comparability.check_comparable(records[side], execution)
    qualified = {side: availability.require(conn, records[side]) for side in ("candidate", "control")}
    facts = {side: measures.run_facts(conn, records[side]["run_id"]) for side in ("candidate", "control")}
    series = {side: trade_window_series(facts[side], side) for side in ("candidate", "control")}
    check_clocks(series["control"], series["candidate"])
    return {"plan": plan, "body": body, "registered_at": registered_at, "candidate": candidate, "control": control,
            "availability": qualified, "facts": facts, "series": series, "ledger_commit": db.head_commit(conn)}


def compare(profile, bundle: str, run_id: int, at: str | None = None, *, part: str = "all") -> dict:
    """The one comparison entry: comparability and economic evidence of both sides, the paired test,
    both sides' measures with their differences, trade pairing and the prediction check; computed at
    read time from stored rows and the registration, never stored."""
    revision = availability.report_revision()
    with db.read_as_of(runs.profile_of(profile), at) as conn:
        found = gather(conn, bundle, run_id)
        interaction = interaction_of(conn, found)
    body, facts = found["body"], found["facts"]
    identity = {"bundle": bundle, "run_id": found["candidate"]["run_id"], "control_run_id": found["control"]["run_id"],
                "research_parent": body.get("parent"), "ledger_commit": found["ledger_commit"],
                "registered_at": found["registered_at"], "metrics_revision": revision,
                "catalogue": measures.CATALOGUE_REVISION, "comparison_source_sha256": _source(),
                "availability": found["availability"]}
    market = measures.market_for(facts["candidate"])
    attributed = report_attribution.attribute(facts["control"], facts["candidate"], body, market, interaction)
    if part == "attribution":
        return {"comparison": identity, **attributed}
    evidence = paired([value for _, value, _ in found["series"]["control"]],
                      [value for _, value, _ in found["series"]["candidate"]], body["comparison"], len(body["grid"]))
    observed = attributed["headline"][measures.key("annual_return")]["difference"]
    evidence["observed_account_annual_return_difference"] = observed
    return {**identity, "evidence": evidence, "attribution": attributed,
            "limitations": runs.dedupe(evidence["limitations"], *(facts[side]["sealed"].get("limitations")
                                                                  for side in ("control", "candidate")),
                                       *(found["availability"][side]["limitations"] for side in ("control", "candidate")))}


# A declared interaction

def _unattested(why: str) -> Refusal:
    return refuse("INTERACTION_UNATTESTED", why, missing=("prediction.interaction",))


def _corner_run(conn: db.LedgerConnection, name: str, row: Mapping, execution: Mapping, checker: Mapping) -> int:
    """The one passed research run of a corner's source that is comparable with the registration's
    execution and has economic evidence; INTERACTION_UNATTESTED unless there is exactly one."""
    qualified = []
    for (candidate_run,) in conn.rows("SELECT r.run_id FROM run r JOIN trial t ON t.trial_id = r.trial_id WHERE "
                                      "t.source_sha256 = %s AND t.purpose = 'research' AND r.status = 'passed' ORDER BY "
                                      "r.run_id", (row["source_sha256"],)):
        try:
            record = register.control_run(conn, candidate_run)
            comparability.check_comparable(record, execution)
            availability.require(conn, record, checker=checker)
        except Refusal:
            continue
        qualified.append(candidate_run)
    if len(qualified) != 1:
        raise _unattested(f"corner {name} ({row['strategy_id']}@{row['revision']}) has {len(qualified)} passed research "
                          "runs comparable with this registration and with economic evidence, not exactly one")
    return qualified[0]


def _corners(conn: db.LedgerConnection, declared: Mapping, candidate: Mapping) -> dict[str, dict]:
    """The four candidate rows (base, a, b and the compared run's candidate ab), their lineage and
    shape checked: a and b derive from base, ab from a or b, and the conflict-free three-way merge of
    a and b from base is byte for byte ab's source."""
    rows = {}
    for name in ("base", "a", "b"):
        try:
            rows[name] = strategies.read_candidate(conn, declared[name])
        except Refusal as exc:
            raise _unattested(f"corner {name} {declared[name]} cannot be read ({exc.code})") from exc
    found = conn.one("SELECT strategy_id, revision FROM candidate WHERE source_sha256 = %s",
                     (candidate["source_sha256"],))
    if found is None:
        raise _unattested("the compared run's source is no published candidate")
    rows["ab"] = strategies.read_candidate(conn, f"{found['strategy_id']}@{found['revision']}")
    if len({row["source_sha256"] for row in rows.values()}) != 4:
        raise _unattested("the four corners are not four different sources")

    def ref(row):
        return f"{row['strategy_id']}@{row['revision']}"

    def parent(row):
        return None if row["parent_strategy_id"] is None else f"{row['parent_strategy_id']}@{row['parent_revision']}"

    for name in ("a", "b"):
        if parent(rows[name]) != ref(rows["base"]):
            raise _unattested(f"corner {name} {ref(rows[name])} has parent {parent(rows[name])}, not base "
                              f"{ref(rows['base'])}")
    if parent(rows["ab"]) not in (ref(rows["a"]), ref(rows["b"])):
        raise _unattested(f"the compared candidate {ref(rows['ab'])} has parent {parent(rows['ab'])}, neither a nor b")
    merged = report_attribution.merge3(rows["base"]["source"], rows["a"]["source"], rows["b"]["source"])
    if merged is None:
        raise _unattested("a and b change the same lines of base: their three-way merge conflicts")
    if merged != rows["ab"]["source"]:
        raise _unattested(f"the three-way merge of a and b from base is not the source of {ref(rows['ab'])}")
    return rows


def interaction_of(conn: db.LedgerConnection, found: Mapping) -> dict | None:
    """The declared two-by-two of a comparison (gather's result), or None without a declaration.

    The corners are base, a and b as declared and ab, the compared run's candidate. They attest the
    interaction when the shape holds (_corners), each corner has exactly one passed research run
    comparable with this registration's execution and with economic evidence (ab's is the compared
    run), the other three runs predate the declaring registration, and the four daily clocks agree.
    Then the weighted contrast ab - a - b + base goes through `paired` (interval uncorrected, no p),
    with each change's two-order average contribution. Otherwise {available: false, reason:
    INTERACTION_UNATTESTED: why}; the rest of the comparison is not affected."""
    declared = (found["body"].get("prediction") or {}).get("interaction")
    if not declared:
        return None
    try:
        rows = _corners(conn, declared, found["candidate"])
        execution = found["plan"]["execution"]
        checker = availability.check_identity()
        runs_of = {name: _corner_run(conn, name, rows[name], execution, checker) for name in ("base", "a", "b", "ab")}
        if runs_of["ab"] != found["candidate"]["run_id"]:
            raise _unattested(f"the qualified run of the compared candidate is run {runs_of['ab']}, not the compared "
                              f"run {found['candidate']['run_id']}")
        for name in ("base", "a", "b"):
            created = conn.one("SELECT created_at FROM run WHERE run_id = %s", (runs_of[name],))["created_at"]
            if not created < found["registered_at"]:
                raise _unattested(f"run {runs_of[name]} of corner {name} was stored at {created}, not before the "
                                  f"declaring registration ({found['registered_at']})")
        clocks = {name: trade_window_series(measures.run_facts(conn, runs_of[name]), name)
                  for name in ("base", "a", "b")}
        clocks["ab"] = found["series"]["candidate"]
        for name in ("base", "a", "b"):
            check_clocks(clocks["ab"], clocks[name])
        series = {name: [value for _, value, _ in clocks[name]] for name in ("base", "a", "b", "ab")}
        tested = paired([series["base"], series["a"]], [series["b"], series["ab"]], found["body"]["comparison"], 1,
                        weights=INTERACTION_WEIGHTS)
    except Refusal as exc:
        why = exc.message if exc.code == "INTERACTION_UNATTESTED" else f"{exc.code}: {exc.message}"
        return {"available": False, "declared": dict(declared), "reason": f"INTERACTION_UNATTESTED: {why}"}
    means = {name: float(np.log1p(np.asarray(values, dtype=float)).mean()) for name, values in series.items()}
    for item in tested["block_sensitivity"]:
        item.pop("p_one_sided", None)
    test = {key: value for key, value in tested.items() if key not in UNCORRECTED_DROPPED}
    test["limitations"] = [item for item in test["limitations"] if item not in PAIRED_LIMITATIONS]
    return {"available": True, "declared": dict(declared), "reason": None,
            "corners": {name: {"candidate": f"{rows[name]['strategy_id']}@{rows[name]['revision']}",
                               "run_id": runs_of[name]} for name in ("base", "a", "b", "ab")},
            "shape": {"method": report_attribution.MERGE_METHOD, "merge_equals_ab": True},
            "weights": dict(zip(("base", "a", "b", "ab"), INTERACTION_WEIGHTS)), "uncorrected": True, "p": None,
            "interval_coverage_uncorrected": 1 - found["body"]["comparison"]["alpha"],
            "mean_daily_log": means, "contributions": report_attribution.contributions(means), "test": test,
            "limitations": list(INTERACTION_LIMITATIONS)}


# The out-of-sample report

def _registration_commit(conn: db.LedgerConnection, registration_id: int) -> str | None:
    found = conn.rows("SELECT to_commit FROM dolt_diff_validation_registration WHERE to_registration_id = %s AND "
                      "diff_type = 'added' LIMIT 1", (registration_id,))
    return found[0][0] if found else None


def _witness(conn: db.LedgerConnection, commit: str | None) -> dict:
    if commit is None:
        return {"stamped_at": None, "verified": False}
    try:
        moment = witness.stamped_at(conn, commit)
    except Refusal:
        return {"stamped_at": None, "verified": False}
    return {"stamped_at": moment, "verified": moment is not None}


def _bound(conn: db.LedgerConnection, registration_id: int) -> tuple[dict | None, dict | None]:
    """(binding, run row) of a validation registration; LEDGER_CORRUPT when the bound trial is missing."""
    binding = conn.one("SELECT registration_id, trial_id FROM validation_binding WHERE registration_id = %s",
                       (registration_id,))
    if binding is None:
        return None, None
    trial = conn.one("SELECT trial_id, purpose, created_at FROM trial WHERE trial_id = %s", (binding["trial_id"],))
    if trial is None:
        raise refuse("LEDGER_CORRUPT", f"validation registration {registration_id} binds the missing trial "
                                       f"{binding['trial_id']}", missing=(f"trial {binding['trial_id']}",))
    run = conn.one("SELECT r.run_id, r.trial_id, r.status, t.purpose, t.source_sha256, t.image_digest, r.audit FROM run r "
                   "JOIN trial t ON t.trial_id = r.trial_id WHERE r.trial_id = %s", (binding["trial_id"],))
    return {**binding, "purpose": trial["purpose"], "bound_at": trial["created_at"]}, run


def _single_of(conn: db.LedgerConnection, run: Mapping | None, design: dict, family_size: int) -> tuple[dict | None,
                                                                                                          str | None]:
    if run is None or run["status"] != "passed":
        return None, "the bound replay has no passed run"
    value = availability.assess(conn, run)
    if not value["economic_evidence_available"]:
        return None, "the bound run has no economic evidence"
    facts = measures.run_facts(conn, run["run_id"])
    try:
        series = trade_window_series(facts, "validation")
        return single([item for _, item, _ in series], design, family_size), None
    except Refusal as exc:
        return None, f"{exc.code}: {exc.message}"


def validation_report(profile, registration_id: int, at: str | None = None) -> dict:
    """The out-of-sample report of one validation registration: the registration, its witness, the
    bound run's single-run measures behind the qualification view, the single-series test, Holm's
    correction across the registrations of the same window and universe rule, and every
    out-of-sample registration of the same candidate; no verdict."""
    with db.read_as_of(runs.profile_of(profile), at) as conn:
        row = conn.one("SELECT * FROM validation_registration WHERE registration_id = %s", (registration_id,))
        if row is None:
            raise refuse("REGISTRATION_UNKNOWN", f"no validation registration {registration_id} on this version",
                         missing=(str(registration_id),))
        design = row["design"] if isinstance(row["design"], dict) else json.loads(row["design"])
        source = conn.one("SELECT source_sha256 FROM candidate WHERE strategy_id = %s AND revision = %s",
                          (row["strategy_id"], row["revision"]))
        limitations = list(VALIDATION_LIMITATIONS)
        output = {"registration_id": registration_id, "ledger_commit": db.head_commit(conn),
                  "metrics_revision": availability.report_revision(),
                  "registration": {"candidate": f"{row['strategy_id']}@{row['revision']}",
                                   "source_sha256": (source or {}).get("source_sha256"),
                                   "window_start": row["window_start"], "window_end": row["window_end"],
                                   "universe_rule": row["universe_rule"], "market_commit": row["market_commit"],
                                   "design": design, "registered_at": row["created_at"], "retry_of": row["retry_of"]},
                  "witness": _witness(conn, _registration_commit(conn, registration_id)),
                  "binding": None, "availability": None, "metrics": None, "single": None}
        if output["witness"]["stamped_at"] is None:
            limitations.append("UNWITNESSED: the registration commit has no verified timestamp token")
        binding, run = _bound(conn, registration_id)
        family_rows = conn.dicts("SELECT registration_id, strategy_id, revision, design FROM validation_registration "
                                 "WHERE window_start = %s AND window_end = %s AND universe_rule = %s ORDER BY "
                                 "registration_id", (row["window_start"], row["window_end"], row["universe_rule"]))
        family_size = len(family_rows)
        if binding is None:
            limitations.append("UNBOUND: no validation replay is bound to the registration")
        else:
            output["binding"] = {"trial_id": binding["trial_id"], "run_id": (run or {}).get("run_id"),
                                 "purpose": binding["purpose"], "status": (run or {}).get("status", "unfinished"),
                                 "audit_status": (run or {}).get("status"), "bound_at": binding["bound_at"]}
            if run is None:
                limitations.append("UNFINISHED: the bound replay stored no run")
            else:
                report = runs.report_of(conn, run["run_id"])
                output["availability"] = report["availability"]
                output["metrics"] = None if report["headline"] is None else {
                    "headline": report["headline"], "slices": report["slices"], "cost_basis": report["cost_basis"],
                    "closed_by_year": report["closed_by_year"], "capital": report["capital"],
                    "exposures_table": {"reader": "report.tables", "run_id": run["run_id"], "exposures": True,
                                        "needs": "the directory and trial ID replay.reproduce returns (a verified "
                                                 "reproduction)"}}
                output["single"], why = _single_of(conn, run, design, family_size)
                if why:
                    limitations.append(f"NO_SINGLE_TEST: {why}")
        members = []
        for member in family_rows:
            _, member_run = _bound(conn, member["registration_id"])
            own = member["design"] if isinstance(member["design"], dict) else json.loads(member["design"])
            tested, _ = (output["single"], None) if member["registration_id"] == registration_id else \
                _single_of(conn, member_run, own, family_size)  # each member's p by its own registered design
            members.append({"registration_id": member["registration_id"],
                            "candidate": f"{member['strategy_id']}@{member['revision']}", "design": own,
                            "run_id": (member_run or {}).get("run_id"),
                            "p_one_sided": None if tested is None else tested["p_one_sided"], "p_holm": None})
        with_p = [member for member in members if member["p_one_sided"] is not None]
        if with_p:
            for member, adjusted in zip(with_p, holm([member["p_one_sided"] for member in with_p])):
                member["p_holm"] = adjusted
        output["family"] = {"window_start": row["window_start"], "window_end": row["window_end"],
                            "universe_rule": row["universe_rule"], "size": family_size, "members": members,
                            "interval_coverage": 1 - design["alpha"] / family_size}
        output["same_candidate_registrations"] = [
            {"registration_id": item["registration_id"], "window_start": item["window_start"],
             "window_end": item["window_end"], "status": item["status"] or ("bound" if item["trial_id"] else "unbound")}
            for item in conn.dicts("SELECT g.registration_id, g.window_start, g.window_end, b.trial_id, r.status FROM "
                                   "validation_registration g LEFT JOIN validation_binding b ON b.registration_id = "
                                   "g.registration_id LEFT JOIN run r ON r.trial_id = b.trial_id WHERE g.strategy_id = %s "
                                   "AND g.revision = %s ORDER BY g.registration_id", (row["strategy_id"], row["revision"]))]
    output["limitations"] = runs.dedupe(limitations)
    return output
