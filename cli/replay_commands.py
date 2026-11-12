"""replay: explore, precheck, run, report, reproduce and reseal."""

from __future__ import annotations

from pathlib import Path
import textwrap

from cli.common import (CANDIDATE_HELP, RUNNER_EPILOG, RUNTIME_DEFAULT_HELP, UsageError, _at, _ledger_option,
                        _market_at, _market_option)
from ledger import db
from shared import profiles
from shared.refusals import refuse


NOUNS = ("replay",)


def replay_explore(profile, market, at, strategy_file, strategy_class, output, runtime, runner_argv, line) -> dict:
    from replay import entry
    found = entry.explore(profile, market, at, Path(strategy_file), strategy_class, Path(output), runtime,
                          list(runner_argv), line)
    found["metrics_note"] = "source unverified: for orientation only, never evidence"
    found["next_actions"] = ["This source is now exposed by an exploration; derive and publish a new candidate to "
                             "register."]
    return found


def replay_precheck(profile, market, at, candidate, runtime, runner_argv, output, line=None) -> dict:
    from replay import entry
    return entry.precheck(profile, market, at, candidate, runtime, list(runner_argv), Path(output), line)


def replay_run(profile, market, at, candidate, runtime, runner_argv, registration, validation, output=None) -> dict:
    from replay import entry
    if (registration is None) == (validation is None):
        raise refuse("REGISTRATION_REQUIRED", "give exactly one of --registration or --validation",
                     expected="--registration <id> xor --validation <id>")
    ran = entry.run(profile, market, at, candidate, runtime, list(runner_argv), registration, validation,
                    Path(output) if output else None)
    with db.read_as_of(profile) as conn:
        commit = conn.resolved_commit
    return {**ran, "ledger_commit": commit}


def replay_report(profile, trial_id: int | None, directory: str | None, at: str | None, tables: bool,
                  reproduction: str | None, reproduction_trial: int | None, account: bool, exposures: bool) -> dict:
    """replay report: a sealed run's report (with --tables its drill-down tables, native ones from the
    run's kept directory or a verified reproduction), or an unsealed directory's report marked unverified."""
    from report import runs
    if directory is not None and trial_id is None:
        if not Path(directory).is_dir():
            raise refuse("DIRECTORY_NOT_FOUND", f"{directory} is not a directory", missing=(directory,))
        return {"source": "directory", **runs.directory_report(Path(directory), account=account)}
    if trial_id is None:
        raise UsageError("give --trial-id or --directory")
    with db.read_as_of(profile, at) as conn:
        at = conn.resolved_commit  # CF-11: every part of the report reads this one version
        trial = conn.one("SELECT purpose FROM trial WHERE trial_id = %s", (trial_id,))
    if directory and reproduction:
        raise UsageError("give either --directory (original cache) or --reproduction (regenerated cache)")
    cache_directory = directory or reproduction
    if trial is not None and trial["purpose"] == "precheck":
        return {"source": "precheck", **runs.precheck_report(
            profile, trial_id, at, directory=Path(cache_directory) if cache_directory else None,
            reproduction=reproduction_trial, account=account, exposures=exposures)}
    found = {"source": "sealed", **runs.run_report(profile, trial_id, at)}
    if found["headline"] is not None:
        from report import comparison
        with db.read_as_of(profile, at) as conn:
            found["annual_return_interval"] = comparison.annual_return_interval(conn, trial_id)
    if tables or exposures or account or cache_directory:
        found["tables"] = runs.tables(trial_id, profile, at, account=account, exposures=exposures,
                                      directory=Path(cache_directory) if cache_directory else None,
                                      reproduction=reproduction_trial)
    return found


CONTRACTS: dict[tuple[str, str], tuple[str, str, str, str]] = {
    ("replay", "explore"): (
        "--strategy-file; the market at --at (default main), exported into a reused cache under the temporary "
        "directory; the runtime image (a tag is pulled)",
        "an explore trial with its start receipt and execution capture; the new --output directory (source, "
        "reports, audit, fingerprint, process.json)",
        "purpose, status (passed or invalid), problems, path, trial_id, image_ref, market, metrics (unverified), "
        "metrics_note, next_actions; exit 0 even when invalid",
        "ENTRY_CLASS_INVALID; NOT_TEMPORARY_PATH, PATH_EXISTS (--output); RUNTIME_UNAVAILABLE; UNIVERSE_EMPTY; "
        "WINDOW_OUTSIDE_DEVELOPMENT (the trading window leaves --line's development period); LINE_UNKNOWN, "
        "LINE_ENDED; OUT_OF_SAMPLE_RESERVED (the window overlaps an unbound validation registration of this source); "
        "RUNNER_OPTION_RESERVED; RUNTIME_NOT_CI_BUILT (the image is no CI build of this repository; any branch's "
        "passes)"),
    ("replay", "precheck"): (
        "the candidate (reader); the market at --at, exported fresh; the runtime image",
        "a precheck trial with its start receipt and execution capture; the new --output directory",
        "purpose, trial_id, source_sha256, image_ref, export_sha256, comparable_config_sha256, status (passed or "
        "failed), problems, path, metrics, scope, exposure_exemption {trading_days, maximum_exempt_days, "
        "note}; exit 1 unless passed",
        "BAD_REF, UNKNOWN_CANDIDATE; PRECHECK_WINDOW_TOO_LONG (the trading window is over the exemption, refused "
        "before anything runs); RUNTIME_NOT_CI_BUILT (the image is no CI build of this repository; any "
        "branch's passes); RUNTIME_CONTRACT_MISMATCH (the candidate's contract is not the image's); "
        "NOT_TEMPORARY_PATH, PATH_EXISTS; UNIVERSE_EMPTY; "
        "WINDOW_OUTSIDE_DEVELOPMENT (outside --line's development period, or without --line outside the period a "
        "line opened today would get or inside an open line's holdout); LINE_HISTORY_SHORT (without --line: no line "
        "could open on the instruments); LINE_UNKNOWN, LINE_ENDED; "
        "OUT_OF_SAMPLE_RESERVED"),
    ("replay", "run"): (
        "the candidate and the registration (writer, head); the market at --at, exported fresh; the runtime image; "
        "the checkout's HEAD (with --validation it must contain origin/main)",
        "the trial naming its research or validation registration, its start receipt and execution capture, one "
        "run row and, when passed, its reading, daily returns and cycles; a "
        "working directory under /tmp, removed once stored unless it is the new --output directory, kept as the "
        "run's native report cache (kept and named on stderr after a failure)",
        "purpose, strategy, trial_id, status, failure_reasons, image_ref, ledger_commit, path (with --output); "
        "exit 1 unless passed",
        "REGISTRATION_REQUIRED (not exactly one of --registration, --validation); REGISTRATION_INVALID; "
        "EXECUTION_MISMATCH (window, instruments, image, config or inputs differ from the registration); "
        "SOURCE_MISMATCH (the candidate is not in the grid); SOURCE_PRECHECK_REQUIRED, SOURCE_PRECHECK_FAILED; "
        "GRID_ALREADY_ATTEMPTED; REGISTRATION_TOO_LATE; STALE_CHECKOUT (research: HEAD is not the fetched "
        "origin/main or the work tree is not clean; validation: HEAD lacks the remote's main); "
        "validation: RUNTIME_NOT_MAIN, "
        "REGISTRATION_CONSUMED, WINDOW_MISMATCH; LINE_ENDED (the registration's line is closed, or, for a "
        "research run, its closing has begun: it has a history trial); "
        "NOT_TEMPORARY_PATH, PATH_EXISTS (--output)"),
    ("replay", "report"): (
        "the trial at --at (reader) and, for a sealed run, market daily returns from its market (a "
        "failure only empties the market measures); --directory or --reproduction files; --directory alone "
        "reads no ledger",
        "nothing",
        "source (sealed, precheck or directory) and that report: sealed gives status, audit, populations, "
        "activity, order_funnel, plans, headline, annual_return_interval (the block-bootstrap interval of the "
        "registration's design, read now, no verdict; null without a design; absent without economic evidence), "
        "slices, closed_by_year, dev_years (a three-year window cut at trade_start anniversaries: each year's "
        "return against the line's annual-return target, years_at_target, worst_year_return, "
        "return_without_best_year; a slice of one continuous run, positions and the equity peak carry across "
        "years, not a fresh replay like the veto years; null for other windows), drawdown, capital, "
        "cost_basis (account terms, observed fee rate by liquidity side, "
        "taker_fill_share, slippage_stress [{bps_per_side 2 and 5, extra_cost_usdt, annual_return, null_reason}]: "
        "the fills' notional times the extra bps taken from the final equity, a first-order read-time reading), "
        "limitations, availability (performance null without economic evidence), plus tables with --tables, "
        "--account, --exposures, --directory or --reproduction; precheck gives capture, stages, outcome, "
        "runtime_failures, audit, reports, reports_verified; directory is marked unverified",
        "UNKNOWN_RUN (an explore trial or no run); RUN_NOT_PASSED, ECONOMIC_EVIDENCE_UNAVAILABLE (tables); "
        "REPRODUCTION_MISMATCH; DIRECTORY_NOT_FOUND; NATIVE_SUMMARY_MISSING, REPORT_PARSE_FAILED"),
    ("replay", "reproduce"): (
        "the original trial, its run or precheck capture and the candidate (writer, head); the market at the "
        "recorded commit; --image, else the newest image the run reached, else its own (another image must be a "
        "CI build of main); the runner arguments are rebuilt from the record",
        "an explore trial with its start receipt and capture (committed before the fingerprint check); the new "
        "--output directory, kept on a mismatch",
        "directory, trial_id, fingerprints_match (true), reproduction_trial_id, image_ref, tables_differing",
        "REPRODUCTION_IMAGE_DIFFERS (a precheck on another image), REPRODUCTION_CONFIG_DIFFERS: nothing written; "
        "REPRODUCTION_MISMATCH (fingerprints or sealed facts differ, or the original has none): the trial is written; RUNTIME_NOT_MAIN; UNKNOWN_RUN, "
        "UNKNOWN_CANDIDATE; NOT_TEMPORARY_PATH, "
        "PATH_EXISTS; OUT_OF_SAMPLE_RESERVED"),
    ("replay", "reseal"): (
        "the passed run, its reading and the candidate (writer, head); then as replay reproduce",
        "replay reproduce's explore trial; then, when the current metrics code computes another reading, run_reading "
        "updated (report, product_commit, op_id) in one reseal:<op_id> commit",
        "trial_id, reproduction_trial_id, directory, product_commit, previous_product_commit, resealed (false when "
        "the reading is unchanged), ledger_commit, op_id",
        "RUN_NOT_PASSED (no passed run with a reading); REPRODUCTION_MISMATCH (any fingerprint table differs, also "
        "on another image): the reproduction trial is written, the reading is not; REPORT_UNREADABLE (the current "
        "metrics code cannot read the reproduction); replay reproduce's refusals"),
}


def register(verbs, verb, runner) -> None:
    """Add the replay nouns to the parser with `cli.main._parser`'s verbs, verb and runner."""
    replay = verbs("replay", "replays: explore, precheck, run, report, reproduce, reseal")
    command = runner(replay, "explore", "replay an unpublished strategy file (not evidence)")
    command.epilog = textwrap.fill(
        "Records an explore trial in the ledger; the replay counts as prior exposure of that source and is never "
        "economic evidence.", 100) + "\n\n" + RUNNER_EPILOG
    _ledger_option(command)
    _market_option(command)
    _market_at(command)
    command.add_argument("--strategy-file", required=True, help="the draft strategy source file")
    command.add_argument("--strategy-class", required=True, help="its entry class name")
    command.add_argument("--line", required=True, help="the open research line whose development period the "
                                                       "trading window lies in")
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    command.add_argument("--runtime", help=RUNTIME_DEFAULT_HELP)
    command = runner(replay, "precheck", "the declared native precheck of a published candidate")
    from registration.precheck import PRECHECK_MAX_DAYS
    command.epilog = textwrap.fill(
        f"Exposure exemption permits at most {PRECHECK_MAX_DAYS} trading days (--trade-start, or --start, to "
        "--end; warm-up is excluded); a longer window is refused before anything runs, since it would expose the "
        "source and prevent its first research registration. Exemption also requires this precheck to be cited "
        "with matching execution identity; other prior replays can still expose the source. A precheck that failed "
        "before any market data reached a strategy (in loading or reading inputs, or because no contract's warm-up "
        "or lifecycle gave it a strategy instance) is no exposure.", 100) + "\n\n" \
        + RUNNER_EPILOG
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--at", required=True, help="market day, YYYY-MM-DD, or head for the newest day")
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    command.add_argument("--runtime", help=RUNTIME_DEFAULT_HELP)
    command.add_argument("--line", help="the open research line whose development period the trading window lies "
                                        "in; without it (a start candidate's precheck), the period a line opened "
                                        "today on its instruments would get, before any open line's holdout")
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    command = runner(replay, "run", "a sealed research or validation replay (runner arguments as registered)")
    command.epilog = textwrap.fill(
        "With --output the run's working directory stays as a cache of its native reports: replay report --trial-id "
        "N --directory DIR reads its orders, fills, account and order events after checking every report file "
        "against the run's sealed capture. Without it they come only from replay reproduce, which records an "
        "explore trial.", 100) + "\n\n" + RUNNER_EPILOG
    _ledger_option(command)
    _market_option(command)
    _market_at(command)
    command.add_argument("--candidate", required=True, help=CANDIDATE_HELP)
    command.add_argument("--runtime", help=RUNTIME_DEFAULT_HELP)
    command.add_argument("--registration", type=int, help="research registration ID (or --validation)")
    command.add_argument("--validation", type=int, help="validation registration ID (or --registration)")
    command.add_argument("--output", help="new directory under the temporary root that keeps the run's native "
                                          "reports as a cache (read with replay report --directory)")
    command = verb(replay, "report", "a sealed result, precheck technical facts/cache, or unverified directory")
    command.epilog = ("For a precheck, --directory verifies its original cache; for a run, the directory replay run "
                      "--output kept. When the cache is lost, run replay reproduce and pass its --reproduction "
                      "directory and --reproduction-trial; a reproduction never replaces the original's failures.")
    _ledger_option(command)
    command.add_argument("--trial-id", type=int, help="trial holding a sealed result or original precheck")
    command.add_argument("--directory", help="original cache with --trial-id (a precheck's, or the one replay run "
                                             "--output kept); otherwise an unverified directory")
    _at(command)
    command.add_argument("--tables", action="store_true", help="add the drill-down tables")
    command.add_argument("--reproduction", help="the directory `replay reproduce` wrote")
    command.add_argument("--reproduction-trial", type=int, help="the reproduction_trial_id `replay reproduce` returned")
    command.add_argument("--account", action="store_true", help="add the native account table")
    command.add_argument("--exposures", action="store_true", help="add the capital exposures table")
    command = verb(replay, "reproduce", "regenerate a sealed result's or precheck's reports into /tmp, "
                                                  "recording an explore trial")
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--trial-id", required=True, type=int, help="original trial holding a result or precheck")
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    command.add_argument("--image", help="replay on this CI image of main instead (a run after a product update); "
                                         "default: the newest image the run reached, else its own")
    command.epilog = ("Records an explore trial in the ledger. "
                      "Hands over the directory only when its results equal the recorded ones: every table on the "
                      "run's own image; on another image fills, positions, exposures and returns_series, with the "
                      "other tables listed in tables_differing. A match lets the run count that image, configuration "
                      "and inputs as its own too, and adds no exposure; so does identically reproducing the precheck "
                      "a registration cites. Any other exploration of a source counts as its prior exposure.")
    command = verb(replay, "reseal", "replace a passed run's reading with what the current metrics code computes from "
                                     "a reproduction equal to every fingerprint table")
    _ledger_option(command)
    _market_option(command)
    command.add_argument("--trial-id", required=True, type=int, help="the passed run whose reading to replace")
    command.add_argument("--output", required=True, help="new directory under the temporary root")
    command.add_argument("--image", help="as replay reproduce --image")
    command.epilog = ("Runs replay reproduce, which records an explore trial. Only when every native report equals "
                      "the run's fingerprints does the current metrics code compute the report again; the run, its "
                      "returns and cycles stay. The old reading stays in Dolt history and the public copy.")


def dispatch(args, runner_argv: list[str]) -> tuple[dict, int]:
    """(result, exit code) of one parsed replay command."""
    key = (args.noun, args.verb)
    if key == ("replay", "reproduce"):
        from replay import reproduce
        return reproduce.reproduce(args.trial_id, Path(args.output), ledger=db.profile(args.ledger),
                                   market=profiles.market(args.market), image=args.image), 0
    if key == ("replay", "reseal"):
        from replay import reproduce
        return reproduce.reseal(args.trial_id, Path(args.output), ledger=db.profile(args.ledger),
                                market=profiles.market(args.market), image=args.image), 0
    profile = db.profile(args.ledger, holds="research")
    if key == ("replay", "explore"):
        found = replay_explore(profile, profiles.market(args.market), args.at, args.strategy_file, args.strategy_class,
                               args.output, args.runtime, runner_argv, args.line)
        return found, 0
    if key == ("replay", "precheck"):
        found = replay_precheck(profile, profiles.market(args.market), args.at, args.candidate, args.runtime,
                                runner_argv, args.output, args.line)
        return found, 0 if found["status"] == "passed" else 1
    if key == ("replay", "run"):
        found = replay_run(profile, profiles.market(args.market), args.at, args.candidate, args.runtime, runner_argv,
                           args.registration, args.validation, args.output)
        return found, 0 if found.get("status") == "passed" else 1
    if key == ("replay", "report"):
        return replay_report(profile, args.trial_id, args.directory, args.at, args.tables, args.reproduction,
                             args.reproduction_trial, args.account, args.exposures), 0
    raise UsageError(f"unknown command {args.noun} {args.verb}")
