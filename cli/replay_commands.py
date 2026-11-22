"""replay: explore, precheck, run, report, reproduce and reseal."""

from __future__ import annotations

from pathlib import Path

from cli.common import (AT, CANDIDATE_HELP, LEDGER, MARKET, MARKET_DAY, RUNTIME_DEFAULT_HELP, command,
                        market_day, option)
from ledger import db
from registration.precheck import PRECHECK_MAX_DAYS
from shared import profiles
from shared.refusals import refuse


NOUNS = {"replay": "replays"}
RUNTIME = option("--runtime", help=RUNTIME_DEFAULT_HELP)
OUTPUT = option("--output", required=True, help="new directory under the temporary root")


def _research(args) -> db.LedgerProfile:
    return db.profile(args.ledger, holds="research")


def replay_explore(args):
    from replay import entry
    found = entry.explore(_research(args), profiles.market(args.market), args.market_day, Path(args.strategy_file),
                          args.strategy_class, Path(args.output), args.runtime, list(args.runner_argv), args.line)
    found["metrics_note"] = "source unverified: for orientation only, never evidence"
    found["next_actions"] = ["This source is now exposed by an exploration; derive and publish a new candidate to "
                             "register."]
    return found


def replay_precheck(args):
    from replay import entry
    found = entry.precheck(_research(args), profiles.market(args.market), args.market_day, args.candidate,
                           args.runtime, list(args.runner_argv), Path(args.output), args.line)
    return found, 0 if found["status"] == "passed" else 1


def replay_run(args):
    from replay import entry
    profile = _research(args)
    ran = entry.run(profile, profiles.market(args.market), args.market_day, args.candidate, args.runtime,
                    list(args.runner_argv), args.registration, args.validation,
                    Path(args.output) if args.output else None)
    with db.read_as_of(profile) as conn:
        commit = conn.resolved_commit
    found = {**ran, "ledger_commit": commit}
    return found, 0 if found.get("status") == "passed" else 1


def replay_report(profile, trial_id: int | None, directory: str | None, at: str | None, tables: bool,
                  reproduction: str | None, reproduction_trial: int | None, account: bool, exposures: bool) -> dict:
    """replay report: a sealed run's report (with --tables its drill-down tables, native ones from the
    run's kept directory or a verified reproduction), or an unsealed directory's report marked unverified."""
    from report import runs
    if directory is not None and trial_id is None:
        return {"source": "directory", **runs.directory_report(Path(directory), account=account)}
    if trial_id is None:
        raise refuse("USAGE_ERROR", "give --trial-id or --directory")
    with db.read_as_of(profile, at) as conn:
        at = conn.resolved_commit  # CF-11: every part of the report reads this one version
        trial = conn.one("SELECT purpose FROM trial WHERE trial_id = %s", (trial_id,))
    if directory and reproduction:
        raise refuse("USAGE_ERROR", "give either --directory (original cache) or --reproduction (regenerated cache)")
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


def _replay_report(args):
    return replay_report(_research(args), args.trial_id, args.directory, args.at, args.tables, args.reproduction,
                         args.reproduction_trial, args.account, args.exposures)


def replay_reproduce(args):
    from replay import reproduce
    return reproduce.reproduce(args.trial_id, Path(args.output), ledger=db.profile(args.ledger),
                               market=profiles.market(args.market), image=args.image)


def replay_reseal(args):
    from replay import reproduce
    return reproduce.reseal(args.trial_id, Path(args.output), ledger=db.profile(args.ledger),
                            market=profiles.market(args.market), image=args.image)


COMMANDS = [
    command(replay_explore, "replay", "explore", "replay an unpublished strategy file (not evidence)", (
        "--strategy-file; the market at --market-day (default the newest day), exported into a reused cache under the temporary "
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
         LEDGER, MARKET, MARKET_DAY,
         option("--strategy-file", required=True, help="the draft strategy source file"),
         option("--strategy-class", required=True, help="its entry class name"),
         option("--line", required=True, help="the open research line whose development period the trading window "
                                               "lies in"),
         OUTPUT, RUNTIME, runner=True,
         epilog="Records an explore trial in the ledger; the replay counts as prior exposure of that source and is "
                "never economic evidence."),
    command(replay_precheck, "replay", "precheck", "the declared native precheck of a published candidate", (
        "the candidate (reader); the market at --market-day, exported fresh; the runtime image",
        "a precheck trial with its start receipt and execution capture; the new --output directory",
        "purpose, trial_id, source_sha256, image_ref, export_sha256, comparable_config_sha256, status (passed or "
        "failed), problems, path, technical (populations, activity and plan checks, order_funnel; no return, "
        "drawdown, ratio, win rate or cost measure), scope, exposure_exemption {trading_days, "
        "maximum_exempt_days, note}; exit 1 unless passed",
        "BAD_REF, UNKNOWN_CANDIDATE; PRECHECK_WINDOW_TOO_LONG (the trading window is over the exemption, refused "
        "before anything runs); RUNTIME_NOT_CI_BUILT (the image is no CI build of this repository; any "
        "branch's passes); RUNTIME_CONTRACT_MISMATCH (the image's contract is not this release's); "
        "NOT_TEMPORARY_PATH, PATH_EXISTS; UNIVERSE_EMPTY; "
        "WINDOW_OUTSIDE_DEVELOPMENT (outside --line's development period, or without --line outside the period a "
        "line opened today would get or inside an open line's holdout); LINE_HISTORY_SHORT (without --line: no line "
        "could open on the instruments); LINE_UNKNOWN, LINE_ENDED; "
        "OUT_OF_SAMPLE_RESERVED"),
         LEDGER, MARKET, market_day(required=True), option("--candidate", required=True, help=CANDIDATE_HELP),
         RUNTIME,
         option("--line", help="the open research line whose development period the trading window lies in; without "
                               "it (a start candidate's precheck), the period a line opened today on its instruments "
                               "would get, before any open line's holdout"),
         OUTPUT, runner=True,
         epilog=f"Exposure exemption permits at most {PRECHECK_MAX_DAYS} trading days (--trade-start, or --start, to "
                "--end; warm-up is excluded); a longer window is refused before anything runs, since it would expose "
                "the source and prevent its first research registration. Exemption also requires this precheck to be "
                "cited with matching execution identity; other prior replays can still expose the source. A precheck "
                "that failed before any market data reached a strategy (in loading or reading inputs, or because no "
                "contract's warm-up or lifecycle gave it a strategy instance) is no exposure."),
    command(replay_run, "replay", "run", "a sealed research or validation replay (runner arguments as registered)", (
        "the candidate and the registration (writer, head); the market at --market-day (default: the research "
        "registration's market day, else head), exported fresh; the runtime image; "
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
         LEDGER, MARKET, market_day(default="the research registration's market day, else head"),
         option("--candidate", required=True, help=CANDIDATE_HELP), RUNTIME,
         option("--registration", type=int, help="research registration ID (or --validation)"),
         option("--validation", type=int, help="validation registration ID (or --registration)"),
         option("--output", help="new directory under the temporary root that keeps the run's native reports as a "
                                 "cache (read with replay report --directory)"),
         runner=True,
         epilog="With --output the run's working directory stays as a cache of its native reports: replay report "
                "--trial-id N --directory DIR reads its orders, fills, account and order events after checking every "
                "report file against the run's sealed capture. Without it they come only from replay reproduce, which "
                "records an explore trial."),
    command(_replay_report, "replay", "report", "a sealed result, precheck technical facts/cache, or unverified directory",
         (
        "the trial at --at (reader) and, for a sealed run, market daily returns from its market (a "
        "failure only empties the market measures); --directory or --reproduction files; --directory alone "
        "reads no ledger",
        "nothing",
        "source (sealed, precheck or directory) and that report: sealed gives status, audit, populations, "
        "activity, order_funnel, plans, headline, annual_return_interval (the block-bootstrap interval of the "
        "registration's design, read now, no verdict; null without a design; absent without economic evidence), "
        "slices, closed_by_year, closed_by_instrument (closed cycles by instrument: closed_trades, win_rate, "
        "price_pnl_usdt, fill_commissions_usdt, reported_funding_usdt, net_pnl_usdt; derived on read), dev_years (the window cut at trade_start anniversaries, a last partial year when "
        "it ends between two: each year's return, and each whole year's against the line's annual-return target, "
        "and its sealed bar-close MARK drawdown with peak_utc and trough_utc (the peak carried from earlier years), "
        "years_at_target, "
        "worst_year_return, return_without_best_year over the whole years; a slice of one continuous run, "
        "positions and the equity peak carry across years, not a fresh replay like the veto years; null for a "
        "window of one year or less), dev_quarters (a window under two years cut every three months from "
        "trade_start, a last partial quarter: each quarter's return, worst_quarter_return, return_without_best_quarter "
        "over the whole quarters; not read against the target; null for two years or more or one quarter or less), "
        "basket (the equal-weight basket's daily returns on the run's days, read now from its market: days, "
        "returns, null_reason, definition_note), drawdown, capital, "
        "cost_basis (account terms, observed fee rate by liquidity side, "
        "slippage_stress [{bps_per_side 2 and 5, extra_cost_usdt, annual_return, null_reason}]: "
        "the fills' notional times the extra bps taken from the final equity, a first-order read-time reading), "
        "limitations, availability (performance null without economic evidence), plus tables with --tables, "
        "--account, --exposures, --directory or --reproduction; precheck gives capture, stages, outcome, "
        "runtime_failures, audit, reports, reports_verified; directory is marked unverified",
        "UNKNOWN_RUN (an explore trial or no run); RUN_NOT_PASSED, ECONOMIC_EVIDENCE_UNAVAILABLE (tables); "
        "REPRODUCTION_MISMATCH; DIRECTORY_NOT_FOUND; NATIVE_SUMMARY_MISSING, REPORT_PARSE_FAILED"), LEDGER,
         option("--trial-id", type=int, help="trial holding a sealed result or original precheck"),
         option("--directory", help="original cache with --trial-id (a precheck's, or the one replay run --output "
                                    "kept); otherwise an unverified directory"),
         AT, option("--tables", action="store_true", help="add the drill-down tables"),
         option("--reproduction", help="the directory `replay reproduce` wrote"),
         option("--reproduction-trial", type=int, help="the reproduction_trial_id `replay reproduce` returned"),
         option("--account", action="store_true", help="add the native account table"),
         option("--exposures", action="store_true", help="add the capital exposures table"),
         epilog="For a precheck, --directory verifies its original cache; for a run, the directory replay run "
                "--output kept. When the cache is lost, run replay reproduce and pass its --reproduction "
                "directory and --reproduction-trial; a reproduction never replaces the original's failures."),
    command(replay_reproduce, "replay", "reproduce", "regenerate a sealed result's or precheck's reports into /tmp, recording an explore "
         "trial", (
        "the original trial, its run or precheck capture and the candidate (writer, head); the market at the "
        "recorded commit; --image, else the newest image the run reached, else its own (another image must be a "
        "CI build of main); the runner arguments are rebuilt from the record",
        "an explore trial with its start receipt and capture (committed before the fingerprint check); the new "
        "--output directory, kept on a mismatch",
        "directory, trial_id, fingerprints_match (true), reproduction_trial_id, image_ref, tables_differing",
        "REPRODUCTION_IMAGE_DIFFERS (a precheck on another image), REPRODUCTION_CONFIG_DIFFERS: nothing written; "
        "REPRODUCTION_MISMATCH (fingerprints or sealed facts differ, or the original has none): the trial is written; RUNTIME_NOT_MAIN; UNKNOWN_RUN, "
        "UNKNOWN_CANDIDATE; NOT_TEMPORARY_PATH, "
        "PATH_EXISTS; OUT_OF_SAMPLE_RESERVED"), LEDGER, MARKET,
         option("--trial-id", required=True, type=int, help="original trial holding a result or precheck"), OUTPUT,
         option("--image", help="replay on this CI image of main instead (a run after a product update); default: "
                                "the newest image the run reached, else its own"),
         epilog="Records an explore trial in the ledger. Hands over the directory only when its results equal the "
                "recorded ones: every table on the run's own image; on another image fills, positions, exposures and "
                "returns_series, with the other tables listed in tables_differing. A match lets the run count that "
                "image, configuration and inputs as its own too, and adds no exposure; so does identically "
                "reproducing the precheck a registration cites. Any other exploration of a source counts as its "
                "prior exposure."),
    command(replay_reseal, "replay", "reseal", "replace a passed run's reading with what the current metrics code computes from a "
         "reproduction equal to every fingerprint table", (
        "the passed run, its reading and the candidate (writer, head); then as replay reproduce",
        "replay reproduce's explore trial; then, when the current metrics code computes another reading, run_reading "
        "updated (report, product_commit, op_id) in one reseal:<op_id> commit",
        "trial_id, reproduction_trial_id, directory, product_commit, previous_product_commit, resealed (false when "
        "the reading is unchanged), ledger_commit, op_id",
        "RUN_NOT_PASSED (no passed run with a reading); REPRODUCTION_MISMATCH (any fingerprint table differs, also "
        "on another image): the reproduction trial is written, the reading is not; REPORT_UNREADABLE (the current "
        "metrics code cannot read the reproduction); replay reproduce's refusals"), LEDGER, MARKET,
         option("--trial-id", required=True, type=int, help="the passed run whose reading to replace"), OUTPUT,
         option("--image", help="as replay reproduce --image"),
         epilog="Runs replay reproduce, which records an explore trial. Only when every native report equals the "
                "run's fingerprints does the current metrics code compute the report again; the run, its returns and "
                "cycles stay. The old reading stays in Dolt history and the public copy."),
]
