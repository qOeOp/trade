"""The refusal catalogue (`CATALOGUE`): the repair commands of each refusal code, one code per condition.

The repairs are the commands that supply what is missing; none is a way around a check; the raise site's
message says what was refused. Every code a product package raises is listed here; a test walks the literal
codes of the product packages' raise sites.
"""

from __future__ import annotations

from typing import Literal

from shared.errors import Refusal


_RERUN = "Rerun the same command; writes are idempotent by operation ID."

CATALOGUE: dict[str, tuple[str, ...]] = {
    "REPLICA_REQUIRED": ("Use the separate research mirror; keep the active research ledger unchanged.",),
    "REPLICA_BUSY": ("Wait for the current sync and read its result.",),
    "REPLICA_INVALID": ("Keep the displayed commit; inspect the published commit with its matching product version.",),
    "REPLICA_SYNC_FAILED": ("Keep the displayed commit, check origin connectivity and retry sync; never reset or force it.",),
    # Connections and service (ledger/db.py)
    "LEDGER_UNKNOWN": ("The profiles are the .json files in the profile directory (`~/.local/share/trade/ledgers`, or "
                       "`TRADE_LEDGER_HOME`). Make a ledger with `ledger init`, or start the compose service "
                       "(`deploy/README.md`); make a market with `market init`.",),
    "LEDGER_KIND": ("Pass a profile of the kind the message names. A Paper database is made with `ledger init "
                    "--name paper --kind isolated --holds paper --service-root DIR`.",),
    "LEDGER_UNAVAILABLE": ("When the message says the service did not answer, it is running and starting it again "
                           "does not help: rerun the same command once after a minute or two, since a stall from a "
                           "long write clears by itself. If it still does not answer, check the host with `docker "
                           "ps` (one that does not return means Docker itself is hung) and ask the user to restart "
                           "the ledger service (`docker compose restart ledger`) or Docker, saying that a restart "
                           "rolls back a write in progress; then rerun the same command.",
                           "Otherwise start it with `ledger service start`, then rerun the same command."),
    "LEDGER_PERMISSION": ("Write only through the declared commands; they use the writer account.",),
    "SCHEMA_MISMATCH": ("Use the product version that matches the ledger's schema generation (README); never "
                        "rebuild or rewrite a ledger to pass this check.",),
    "INVALID_NAME": ("Use letters, digits, hyphens and underscores, and kind active, isolated or temporary.",),
    "PROFILE_EXISTS": ("Choose another profile name; an existing profile file is never replaced.",),
    "LEDGER_EXISTS": ("Choose another database name, or kind isolated or temporary when the active ledger exists; "
                      "existing ledgers are never replaced.",),
    "MARKET_EXISTS": ("Choose an empty directory, or kind isolated or temporary when the active market exists; "
                      "existing markets are never replaced.",),
    "ISOLATION_BREACH": ("Give an isolated ledger its own database name; keep the active service and backup "
                         "outside Git and temporary directories.",),
    "DOLT_BINARY": ("Set RESEARCH_DOLT_BINARY to a Dolt 2.7.2 executable "
                    "(https://github.com/dolthub/dolt/releases/tag/v2.7.2); another version is refused.",),
    "LEDGER_START": ("Inspect the service log printed on standard error, then rerun `ledger init`.",),
    "INVALID_REF": ("Pass a commit hash or branch name.",),
    "UNKNOWN_REF": ("List commits with `ledger sql \"SELECT * FROM dolt_log\"` and pass one of them.",),
    # The write protocol
    "READ_ONLY_CONNECTION": ("Run the declared write command; it opens the writer connection.",),
    "DIRTY_WORKING_SET": ("Have the ledger administrator inspect `dolt_status`; never commit them under another "
                          "operation.",),
    "CONCURRENT_WRITE": ("Reread the ledger, check the record still makes sense, then rerun the same command; it "
                         "is idempotent. A `replay` command may have left its --output directory: on PATH_EXISTS, "
                         "rerun with a new path.",),
    "DOLT_SQL_ERROR": ("If the message names a value the column refuses (a judgment body holds at most 65,535 "
                       "bytes), fix the input; `ledger sql \"DESCRIBE <table>\"` lists the columns. Otherwise: "
                       + _RERUN,),
    "SQL_STATEMENT_FAILED": ("Fix the statement and rerun; list tables with `ledger sql \"SHOW TABLES\"` and columns "
                             "with `ledger sql \"DESCRIBE <table>\"`.",),
    # Paths
    "NOT_TEMPORARY_PATH": ("Pass a new directory under /tmp (or the platform temporary directory).",),
    "PATH_EXISTS": ("Pass a path that does not exist yet.",),
    # Evidence
    "INVALID_BUNDLE_NAME": ("Rename the bundle within the allowed characters and length.",),
    "RESERVED_BUNDLE": ("Write those through their commands (replays, `execution recover`, `market lifecycle`); "
                        "name your own evidence otherwise, for example correction-*.",),
    "INVALID_EVIDENCE_PATH": ("Copy the files into a plain directory without links or duplicate names.",),
    "EMPTY_EVIDENCE": ("Remove empty files and pass at least one nonempty file.",),
    "MEDIA_NOT_KEPT": ("Store the transcript, frames and receipts derived from the media instead.",),
    "EVIDENCE_TOO_LARGE": ("Store a derived, smaller file instead of the original.",),
    "BUNDLE_EXISTS": ("Use a new bundle name; to correct a bundle, add a correction-* bundle naming it.",),
    "UNKNOWN_BUNDLE": ("List bundles with `ledger sql \"SELECT DISTINCT bundle FROM v_evidence\"`.",),
    "LEDGER_CORRUPT": ("Report it with the bundle or candidate named; run `ledger review` and restore from the "
                       "backup with the administrator.",),
    # Candidates
    "SOURCE_SIZE": ("Publish one complete, nonempty UTF-8 strategy file within the limit.",),
    "ENTRY_CLASS_INVALID": ("Pass the name of the strategy's top-level class.",),
    "SOURCE_SYNTAX": ("Fix the syntax or encoding in the working copy, then publish again.",),
    "ENTRY_CLASS_NOT_UNIQUE": ("Define the entry class once at module top level.",),
    "INVALID_ID": ("Choose a strategy ID within the allowed characters and length.",),
    "NOTE_INVALID": ("Write a nonempty note of at most 2000 characters.",),
    "LINEAGE_INCOMPLETE": ("Give both --parent and --difference, or neither for a root.",),
    "BAD_REF": ("Write the reference as strategy_id@N.",),
    "UNKNOWN_CANDIDATE": ("List candidates with `candidate list`.",),
    "SOURCE_EXISTS": ("Use the existing candidate named in the message, or change the source.",),
    # Research lines
    "START_NOT_FOUND": ("Publish the start with `candidate publish`, then select the line again.",),
    "START_REVIEW_REQUIRED": ("Run `replay precheck` on the start revision and record its `source review`, then "
                              "select the line again; after a failed review, fix the source, publish it and start "
                              "from the new revision.",),
    "MARKET_DAY_UNRESOLVED": ("Pass a market day of the active market; `market coverage` without --at prints "
                              "its latest as market_day.",
                              "A market that is still empty (MARKET_EMPTY in the message) has no market day: import "
                              "two months with `market import` first (the first has no members).",
                              "A day later than this market holds does not resolve: nothing pinned to it registers "
                              "or replays against this market."),
    "WINDOW_INVALID": ("Pass a window whose start precedes its end (and, for a replay, a whole-minute warm-up "
                       "start no later than the trading start).",),
    "WINDOW_OUTSIDE_DEVELOPMENT": ("Trade inside that period; the holdout, the history before the period and the "
                                   "forward segment are replayed only when a line closes.",),
    "PRECHECK_WINDOW_TOO_LONG": ("Precheck on a window of at most 7 trading days on which the change's order path "
                                 "runs; the full window belongs to the registered replay.",),
    "LINE_HISTORY_SHORT": ("Start the line from instruments the market has covered for at least three years before "
                           "the last quarter end, or from the pool.",),
    "LINE_CONFLICT": ("Name the direction more precisely with another `--slug`, then select again.",),
    "LINE_SLUG_INVALID": ("Name the line's direction in that form.",),
    "LINE_AMBIGUOUS": ("Name the line with --line (one of `research state` open_lines).",),
    "HISTORY_INCOMPLETE": ("Run `line history` for the line (it resumes where it stopped), then close again.",),
    "LINE_CLOSED": ("Read its summary (`line list`, or line_close with `ledger sql`); leave it as it is.",),
    "LINE_SUMMARY_INVALID": ("Shorten the summary to the line's directions, results, failures and lessons, then "
                             "close again.",),
    "LINE_UNKNOWN": ("Name an existing line (`line list`), or omit --line to use the only open line; select a line "
                     "with `line select`.",),
    "LINE_ENDED": ("Work on an open line (`research state` lists open_lines), or select a new one with "
                   "`line select`; targets without a line go to the ledger default (`line targets --default`).",),
    "TARGETS_INVALID": ("Pass both targets as the user stated them, as fractions (0.15 for 15%).",),
    # Trials
    "BINDING_NOT_ALLOWED": ("Run explorations and prechecks without a registration; bind a validation registration "
                            "only to a validation replay.",),
    "BINDING_REQUIRED": ("Register first (`registration add` or `validation registration`), then replay.",),
    "SOURCE_NOT_PUBLISHED": ("Publish it with `candidate publish`, then replay.",),
    "RUNTIME_NOT_PINNED": ("Resolve the runtime image by digest and inspect it, then replay.",),
    "TRIAL_INPUT_INCOMPLETE": ("Export the market inputs for the window again, then replay.",),
    "OUT_OF_SAMPLE_RESERVED": ("Run the validation the user registered; other trials of this candidate may not "
                               "touch its window until it is bound.",),
    "TRIAL_NOT_FOUND": ("List trials with `ledger sql` on the `trial` table.",),
    "EXECUTION_IDENTITY": ("Replay through `replay run`, `replay precheck` or `replay explore`, which write both "
                           "together.",),
    "REGISTRATION_TOO_LATE": ("Stamp it with `ledger witness` before the window starts, or register a later "
                              "window.",),
    "SOURCE_MISMATCH": ("Replay a source of the registered grid (or the registered candidate), or register "
                        "again.",),
    "LINEAGE_MISMATCH": ("Register only candidates published from the parent with one and the same "
                         "--difference.",),
    "EXECUTION_MISMATCH": ("Replay with the registered execution identity, or register again.",),
    "SOURCE_PRECHECK_REQUIRED": ("Run `replay precheck` and record `source review` for the source.",),
    "SOURCE_PRECHECK_FAILED": ("Fix the source, publish it and precheck it again.",),
    "GRID_ALREADY_ATTEMPTED": ("Register a new grid point; consumed attempts stay counted.",),
    # Execution captures (ledger/execution.py)
    "EXECUTION_START_MISSING": ("Replay through `replay run`, `replay precheck` or `replay explore`, which write the "
                                "trial and its start receipt before the container starts.",),
    "EXECUTION_CAPTURE_LIMIT": ("Rerun with a shorter window or fewer instruments; for a precheck, append the kept "
                                "bytes with `execution recover` (they stay recovery material, not the "
                                "capture).",),
    "RECOVERY_NOT_APPLICABLE": ("Read the trial's capture with `replay report --trial-id N`; replay again instead of "
                                "recovering.",),
    "RECOVERY_INCOMPLETE": ("Pass the kept working directory unchanged and the capture-limit refusal it wrote.",),
    # Coverage at ingest (ledger/coverage.py)
    "CAPTURE_INCOMPLETE": ("The run cannot be stored from this trial; replay the grid point again under a "
                           "retry registration.",),
    "COVERAGE_RECEIPT_INVALID": ("Export the market inputs again and replay through the product entry.",),
    "COVERAGE_MISMATCH": ("Replay with the inputs the receipt names; report the runner if it read others.",),
    "LIFECYCLE_NATIVE_COUNT_INVALID": ("Report the runner defect; the run cannot be stored.",),
    "LIFECYCLE_BUNDLE_MISSING": ("Replay with the lifecycle bundle of the market day (`--lifecycle-bundle`).",),
    "LIFECYCLE_COVERAGE_MISMATCH": ("Replay with the inputs the receipt names; report the runner if it read others.",),
    "LIFECYCLE_COUNT_MISMATCH": ("Export the inputs again with the lifecycle bundle; report the runner if the "
                                 "engine delivered other events.",),
    "LIFECYCLE_EVENT_INVALID": ("Write a corrected lifecycle bundle for the market day; never edit an export.",),
    "LIFECYCLE_DUPLICATE_EVENT": ("Write a corrected lifecycle bundle for the market day.",),
    # Runs (ledger/trials.py, ledger/metrics.py)
    "TRIAL_PURPOSE_INVALID": ("Read the exploration or precheck from its directory; register to store a run.",),
    "RUN_ALREADY_INGESTED": ("Read it with `replay report --trial-id N`; a trial is stored once.",),
    "UNKNOWN_RUN": ("List runs with `research runs`, or with `ledger sql` on the `run` table.",),
    "REPORT_UNREADABLE": ("Replay again into a new directory; report the runner if it persists.",),
    # Replays (replay/)
    "TRADE_TICKS_NEED_QUOTES": ("Add --execution quotes with its margin rates, or drop --trade-ticks.",),
    "RUNNER_OPTION_RESERVED": ("Pass only the window and the instrument scope; the entry adds the rest.",),
    "RUNTIME_NOT_CI_BUILT": ("Use a runtime image CI built from a pushed branch or main "
                             "(`--runtime ghcr.io/qoeop/trade-runtime:main`).",),
    "RUNTIME_CONTRACT_MISMATCH": ("Replay on an image of the candidate's contract, or publish the source for the "
                                  "image's contract.",),
    "REGISTRATION_REQUIRED": ("Pass --registration <id> or --validation <id>, not both.",),
    "EXPORT_CHANGED_BEFORE_EXECUTION": ("Export the inputs again (rerun the same command).",),
    "REPRODUCTION_IMAGE_DIFFERS": ("Reproduce it without --image, or precheck the source again on the new image.",),
    "REPRODUCTION_CONFIG_DIFFERS": ("The run cannot move to this image: keep it as history on the image it reached; "
                                    "a line that needs it there restarts under the new identity.",),
    "REPRODUCTION_MISMATCH": ("Diagnose the kept directory; reproduce the run (replay.reproduce) and read native detail with "
                              "the directory and the trial ID it returned.",),
    # Judgments
    "COMMIT_NOT_ANCESTOR": ("Pass the commit you read, as shown by `research state`.",),
    "COMMIT_BEFORE_LINE": ("Read the ledger after the line was selected and pass that commit.",),
    "SUBJECT_UNKNOWN": ("Reference existing records only; list candidates with `candidate list`, trials and "
                        "registrations with `ledger sql`.",),
    "SUBJECT_ROLE_MISMATCH": ("Give a candidate role recommended, parent, control or about; a trial or registration "
                              "takes about, or no role.",),
    "SUPERSEDES_INVALID": ("Supersede the current judgment of the same kind on the same line.",),
    "SEARCH_EXPOSURE_VARIANTS_MISSING": ("Make the first line `Evaluated variants: K`, K the number of rule or "
                                         "parameter variants the view assessed against the line's data without "
                                         "a replay (research-round feedback.md); 0 only when it touches no "
                                         "variant.",),
    "DECISION_OPENING_INVALID": ("Begin the priority judgment's body with `Change of approach.` or `Line "
                                 "decision.` exactly (research-round feedback.md, research-start), or reword "
                                 "a first line that records no such decision.",),
    "APPROACH_CHOOSER_MISSING": ("Say `chosen by the Agent` or `chosen by the user` in the body "
                                 "(research-round feedback.md).",),
    "OP_ID_CONFLICT": ("Use a new operation ID, or omit it to derive one from the content.",),
    "RECOMMENDATION_INCOMPLETE": ("Run `research status --at COMMIT` and add a `--subject role=…,candidate=ID@N` for "
                                  "each candidate the message lists.",),
    # Witness
    "NOT_REGISTRATION_COMMIT": ("Pass the commit that added the validation registration (`ledger witness`).",),
    "WITNESS_INVALID": ("Run `ledger witness` again to request a new token.",),
    "WITNESS_UNAVAILABLE": ("Run `ledger witness` again before the validation window starts.",),
    # Registration (registration/register.py)
    "REGISTRATION_INVALID": ("Fix the field the message names (its description is quoted), then run "
                             "`registration add` again.",),
    "SOURCES_REQUIRED": ("Pass the originals with `registration add --source`, or add them with `evidence add` "
                         "and cite their bundle names.",),
    "RESEARCH_LINE_REQUIRED": ("Select a research line with `line select`, then register.",),
    "WINDOW_MISMATCH": ("Register the research line's window exactly (read it with `research state`); replay a "
                        "validation only inside its registered window after it has ended.",),
    "CONFIG_MISMATCH": ("Publish the grid for the probed runtime contract. For validation, keep the original "
                        "registration's account terms; later research cannot replace that baseline. If terms "
                        "must change, stop and ask the user about a new future-window registration.",),
    "SOURCE_ALREADY_EXPOSED": ("Preserve the exposure record. Use retry_of only for an earlier registration that "
                               "actually consumed this source; such a rebuild on another image cites a new precheck "
                               "on that image. Without retry_of only the cited precheck is exempt, so a new precheck "
                               "does not clear an earlier one: register on the earlier precheck's image citing it, "
                               "then move the run with `replay reproduce`. Register a new source for a new research "
                               "hypothesis.",),
    "DUTY_UNKNOWN": ("Use duty IDs A1 to I2 from the duty directory; leave changed_duties empty only for a root.",),
    "PREDICTION_INVALID": ("Write at least one prediction per changed duty on a catalogue slice and measure (or an "
                           "empty slice with a reason).",),
    "INTERPRETATION_REQUIRED": ("Add an interpretation with `judgment add --kind interpretation` about the trials "
                                "the message lists.",),
    "REVIEW_DUE": ("Run `research status` and read its `comparison` table.",
                   "Write a `recommendation` judgment naming every one of that table's `candidates` (`judgment add "
                   "--kind recommendation --based-on COMMIT`), and a `priority` judgment for the next steps; the "
                   "recommendation clears the stop."),
    # Comparability (registration/comparability.py)
    "RUN_NOT_PASSED": ("Choose a passed research or validation run as the control.",),
    "COMPARABILITY_MISMATCH": ("Choose a comparable control, or replay the control under the new execution "
                               "identity first.",),
    "IDENTITY_MALFORMED": ("Replay through the product entry points, which record complete identities.",),
    "ECONOMIC_EVIDENCE_UNAVAILABLE": ("Choose a control with economic evidence, or diagnose and fix the run "
                                      "first.",),
    # Inputs (registration/inputs.py)
    "SYMBOL_SELECTION_INVALID": ("Pass {\"universe\": true} or {\"symbols\": [...]} without repeats.",),
    "UNIVERSE_EMPTY": ("Pin a market day whose universe covers the window, or choose another window.",),
    "EXPORT_TIMEFRAME": ("Export the market inputs again with the product entry point.",),
    "EXPORT_CONTENT_INVALID": ("Export the market inputs again into a new directory.",),
    "LIFECYCLE_INPUT": ("Write the lifecycle bundle for this market day again with the market command.",),
    # Prechecks and source reviews (registration/precheck.py)
    "REVIEW_INVALID": ("Write only the four items api, causal, activity and readiness to the --items file, each "
                       "{status, note}; pass trial_id as --precheck-trial and verdict as --verdict.",),
    "PRECHECK_CAPTURE_MISSING": ("Run `replay precheck` for the source and review that trial.",),
    # Validation (registration/validation.py)
    "CANDIDATE_UNKNOWN": ("Pass a candidate shown by `candidate list` as strategy_id@revision.",),
    "DESIGN_INVALID": ("Declare method, block_days, resamples, inner_resamples, seed, alpha, minimum_effect and "
                       "design_reason.",),
    "RETRY_NOT_ALLOWED": ("Retry only attempts whose replay was captured without a run, invalid or without "
                          "economic evidence. For a research runtime rebuild, keep the declarations, source grid, "
                          "configuration and inputs fixed, cite new matching reviews and rebuild the equivalent "
                          "control first. Validation retries keep the original candidate, window, universe "
                          "rule and test design. A poor result is no reason to retry.",),
    "REGISTRATION_UNKNOWN": ("List validation registrations with `ledger sql` on the `validation_registration` table.",),
    "REGISTRATION_CONSUMED": ("Register a new validation; a bound registration stays consumed.",),
    "STALE_CHECKOUT": ("Fetch, move the checkout to origin/main with a clean work tree, then rerun.",),
    "RUNTIME_NOT_MAIN": ("Merge first, then rerun with the main runtime image.",),
    "MEMBERSHIP_CHANGED": ("Replay with the registered universe rule and the baseline research run's selection "
                           "(its symbols, or the whole universe) on a market day that keeps the registered "
                           "months and covers the window.",),
    "COVERAGE_INCOMPLETE": ("Export the market inputs for the whole warm-up and trading interval again.",),
    # Export and backup (ledger/admin.py)
    "EXPORT_PATH_INVALID": ("Choose a new directory outside the service directory and any checkout, or this ledger's "
                            "earlier export.",),
    "DOLT_BACKUP": ("Check the backup directory and the service, then rerun the export.",),
    "BACKUP_DIVERGED": ("Run `ledger review` and report the finding; a backup is replaced "
                        "only with the user's authority.",),
    # Publication (ledger/publish.py)
    "REMOTE_UNSET": ("Name its DoltHub repository once with `ledger publish --remote URL`.",),
    "REMOTE_INVALID": ("Pass https://doltremoteapi.dolthub.com/<owner>/<repository>.",),
    "REMOTE_MISMATCH": ("Publish without --remote, or report it: changing the public copy needs the user's "
                        "authority.",),
    "PUBLISH_FORBIDDEN": ("Publish the active database, or give a file:// remote for an isolated one.",),
    "DOLTHUB_CREDENTIALS": ("Ask the user to run `dolt login`, then rerun the same command; a service compose runs reads the key from "
                            "`TRADE_DOLTHUB` (default `$TRADE_DATA/dolthub`), a copy of that `~/.dolt`, or on its first "
                            "start makes one in that empty directory and shows it on the IDE's page.",),
    "PUBLISH_REJECTED": ("Report it to the user: the public copy was changed elsewhere, and replacing it needs the "
                         "user's authority.",),
    "PUBLISH_FAILED": ("Check the network, the DoltHub key, that the repository exists and that the key's account can write "
                       "to it, then run `ledger publish`; a first `--remote` that fails is not kept, so name the "
                       "repository again.",
                       "When the message says the service started before its key was installed, restart the service "
                       "(`docker compose restart ledger` under compose; otherwise `ledger service stop`, then "
                       "`ledger service start`) first."),
    # Reports (report/)
    "MARKET_RETURNS_UNAVAILABLE": ("When the message names MARKET_DAY_UNKNOWN, the run's market day is not in the active "
                                   "market: its market measures cannot be read here and stay "
                                   "empty.",
                                   "Otherwise make the market profile available (read only), then read the "
                                   "report again."),
    "DIRECTORY_NOT_FOUND": ("Pass the output directory of an exploration or precheck.",),
    "NATIVE_SUMMARY_MISSING": ("Pass a directory the runner finished writing; a failed runner leaves its reason in "
                               "the capture.",),
    "REPORT_PARSE_FAILED": ("Replay again with the runner of the runtime contract; reports are never repaired.",),
    "NO_CONTROL": ("Register a derived hypothesis with a comparable control run to compare it.",),
    "RUN_NOT_IN_GRID": ("Compare the run under the registration whose grid point produced it.",),
    "COMPARISON_UNAVAILABLE": ("Use runs whose daily series reconcile and a window of at least two blocks; the series "
                               "are never repaired.",),
    "CLOCK_MISMATCH": ("Compare runs of the same trading window; days are never filled or resampled.",),
    "INTERACTION_UNATTESTED": ("Declare the two-by-two when registering its last corner, with ab the merge of a and "
                               "b; read the comparison without the interaction otherwise.",),
    # Replay stage containers (replay/seams.py, runtime.container_command)
    "MODULE_NOT_IN_LAYOUT": ("Run only the modules runtime.layout declares for the image's contract.",),
    "MOUNT_HOST_PATH_INVALID": ("Mount only the replay's own working directory and exported inputs.",),
    "MOUNT_TARGET_INVALID": ("Give each input its own absolute container path clear of /tmp and /opt/trade.",),
    "MOUNT_WRITABLE_NOT_REPORTS": ("Mount every input read-only; only the stage's output directory is /reports.",),
    "REPORTS_MOUNT_MISSING": ("Mount the stage's output directory writable at /reports.",),
    "ARGV_INVALID": ("Pass the runner's arguments as strings and the container settings in the form the message "
                     "names.",),
    "STAGE_MEMORY_LIMIT": ("Reduce what the run holds in memory (a shorter window, fewer contracts or orders), or "
                           "report the stage and its measured peak so the limit can be retuned.",),
    "REPLAY_TIMEOUT": ("Rerun with a longer --timeout-seconds or a shorter interval.",),
    # Runtime (runtime/image.py)
    "RUNTIME_UNAVAILABLE": ("Check the image reference and the container runtime, then rerun. A pull that never "
                            "finishes is often a Docker credential helper (credsStore or credHelpers in "
                            "~/.docker/config.json) that never answers; the public runtime image pulls "
                            "anonymously without it.",),
    "RUNTIME_PROBE_INVALID": ("Use a runtime image built by CI for a supported runtime contract.",),
    "RUNTIME_IDENTITY_INVALID": ("Resolve the image with `--runtime <image>:<tag>` or `<image>@sha256:<digest>`; "
                                 "never write an identity by hand.",),
    "RUNTIME_UNSUPPORTED": ("Use a CI image of a contract runtime.layout declares (`--runtime "
                            "ghcr.io/qoeop/trade-runtime:main`).",),
    "RUNTIME_DIGEST_AMBIGUOUS": ("Pass the image by digest (`<image>@sha256:<digest>`).",),
    "RUNTIME_MISMATCH": ("Pull the image by digest again; report the image if the probe still disagrees.",),
    # The command line (cli/)
    "USAGE_ERROR": ("Read `python -m cli.main <noun> <verb> --help` and rerun with the declared options.",),
    "SOURCE_UNREADABLE": ("Pass the path of the single-file UTF-8 source itself.",),
    "WRITE_VIA_SQL": ("Write only through the declared commands; read with one SELECT.",),
    "PRECHECK_NOT_FOUND": ("Run `replay precheck` for the candidate on the image, then review that trial.",),
    "RUNTIME_UNRESOLVED": ("Pass the image the precheck ran on, by tag or digest.",),
    "BACKUP_TARGET_UNSET": ("Export with `ledger export --kind reproduce --output <new directory>`.",),
    "EXPORT_MISMATCH": ("Rerun the same export; report the disk if it persists.",),
    "LEDGER_NOT_INITIALIZED": ("Initialize it with `ledger init` (or `ledger temp` for a test ledger).",),
    "SERVICE_START_FAILED": ("Inspect the service log (in the service directory, or `docker compose logs ledger`), "
                             "then rerun `ledger service start`.",),
    "BOOTSTRAP_REFUSED": ("Report it to the user: TRADE_DATA may name the wrong directory, or service.json was lost.",),
    "BOOTSTRAP_FAILED": ("Inspect `docker compose logs ledger`; the repository must exist (Dolt reports a missing one as "
                         "permission denied) and be empty for a new ledger or hold a research ledger; the next start "
                         "bootstraps again.",),
    "SERVICE_CHECK_FAILED": ("Report it to the user with the named item; nothing was changed.",),
    "SERVICE_MANAGED": ("Stop or restart it with `docker compose stop ledger` or `docker compose restart ledger`.",),
    "JUDGMENT_BODY_UNREADABLE": ("Write the judgment text to a UTF-8 file and pass it with --body.",),
    # The market directory (market/)
    "MARKET_UNREACHABLE": ("Pass the market profile with --market; create a market directory with `market init`.",),
    "MARKET_DAY_UNKNOWN": ("Pass head or a market day (YYYY-MM-DD) of the market; `market coverage` without --at "
                           "prints the newest as market_day.",
                           "A line pinned to a later day cannot be read here until the market reaches it."),
    "MONTH_INVALID": ("Import the month after the latest or the month before the earliest, one `market import "
                      "--month YYYY-MM` each.",),
    "MONTH_EXISTS": ("Import the next month or the month before the earliest; a stored month is never rewritten.",),
    "RULE_VERSION_MISMATCH": ("Read the report at a market day of that rule; a new rule needs a new market directory.",),
    "TRADES_NOT_HELD": ("Import the month's aggTrades first (`market import-trades --month YYYY-MM`).",),
    "SEQUENCE_GAP": ("Re-download the day with the refused command (`market import-trades` or `market import-quotes` "
                     "--month YYYY-MM) after clearing its cached archive; a gap the exchange published stays a gap and "
                     "the month stays unimported.",),
    "UNIVERSE_UNKNOWN": ("Import the month's bars first (`market import --month YYYY-MM`) or name --symbols.",),
    "TERMS_UNKNOWN": ("Import the contract's bars first; terms come from the bar import's exchangeInfo observation.",),
    "UNIVERSE_CHANGED": ("Report the month and contracts named; stored months are never rewritten.",),
    "DATA_TESTS_FAILED": ("Report the failed test named; the import stops rather than write inconsistent data.",),
    "CONCURRENT_IMPORT": ("Wait for the running import to finish, then rerun the same command.",),
    "CHECK_FAILED": ("Report the table, contract and row named; the source or the import code is wrong, the rule "
                     "stays.",),
    "MARKET_EMPTY": ("Import a month with `market import`.",),
    "ARCHIVE_NOT_PUBLISHED": ("Nothing to repair: a bar or quote import takes the daily archives or public REST "
                              "instead; a metrics import with no day published has nothing to import yet, so rerun it "
                              "after the exchange publishes the day.",),
    "CHECKSUM_MISMATCH": ("Rerun the import (the archive is downloaded again); report the archive if it persists.",),
    "SOURCE_CONFLICT": ("Report the contract, price type and time named; the import stops rather than choose.",),
    "SOURCE_SHAPE": ("Rerun the import after the cache is refreshed; report the archive if it persists.",),
    "SOURCE_UNREACHABLE": ("Rerun the same import later; nothing was committed.",),
    "SOURCE_UNKNOWN_SYMBOL": ("Report the contract named; rerun the import once exchangeInfo and the endpoint "
                              "agree.",),
    "PRICE_TYPE_UNKNOWN": ("Stitch LAST or MARK series only.",),
    "SCALE_RANGE": ("Report the contract named; the scale is fixed.",),
    "SCALE_LOSS": ("Report the contract named; only a volume that is a binary-float rendering of a value at the "
                   "scale is rounded on import, and counted in rounded_volumes.",),
    "QUOTE_INEXACT": ("Report the contract named; the quote table and the instrument terms disagree.",),
    "TRADE_INEXACT": ("Report the contract named; the agg_trade table and the instrument terms disagree.",),
    "QUOTES_UNSORTED": ("Report the contract named; the exporter never reorders quotes.",),
    "GRID_MISALIGNED": ("Pass bars read from the market at one market day.",),
    "INPUT_UNSORTED": ("Pass bars read from the market at one market day.",),
    "VOLUME_OVERFLOW": ("Report the contract and timeframe named; derivation never truncates.",),
    "EXCHANGE_INFO_MALFORMED": ("Rerun the import; report the contract if exchangeInfo keeps the shape.",),
    "MONTH_NOT_FIRST_DAY": ("Pass a month start.",),
    "UNIVERSE_EMPTY_AT_DAY": ("Import the next month with `market import`, then pin the new market day.",),
    "UNIVERSE_NOT_COVERING_WINDOW": ("Import the window's months, or end the window within the produced months.",),
    "TERMS_INVALID": ("Report the contract named; terms are stored as the exchange published them.",),
    "PRECISION_NARROWED": ("Export with at least the increment's decimals; precision is only widened.",),
    "UNSUPPORTED_QUOTE": ("Export USDT perpetuals only.",),
    "SYMBOL_SHAPE": ("Export USDT perpetuals by their public names.",),
    "EPISODE_INDEX": ("Number episodes 1, 2, ... in time order.",),
    "EPISODE_SHAPE": ("Fix the lifecycle manifest and write a new bundle with `market lifecycle`.",),
    "EPISODE_ORDER": ("Fix the lifecycle manifest and write a new bundle with `market lifecycle`.",),
    "BARS_UNSORTED": ("Report the contract named; the market is inconsistent.",),
    "BAR_RAW_INEXACT": ("Report the contract named; the exporter never rounds.",),
    "MARK_UNSORTED": ("Report the contract named; the market is inconsistent.",),
    "MARK_INEXACT": ("Report the contract named; the exporter never rounds.",),
    "FUNDING_FILE_MISSING": ("Re-import the month named with `market import`; a funding file is never optional.",),
    "FUNDING_UNSORTED": ("Report the contract named; the market is inconsistent.",),
    "FUNDING_RATE_SHAPE": ("Report the contract named; the market is inconsistent.",),
    "INTERVAL_INVALID": ("Pass --start and --end as UTC times on whole minutes, start before end; daily bars take "
                         "whole UTC days of LAST prices.",),
    "EMPTY_SYMBOLS": ("Pass each contract once, as Binance names it, or none to take the universe.",),
    "UNKNOWN_SYMBOL": ("List the market day's contracts with `market coverage` over the universe.",),
    "MARKET_RETURNS_WINDOW": ("Report market measures only for runs with a whole trading day.",),
    # Paper runs (ledger/paper.py, paper/runs.py)
    "PAPER_RECOVERY_UNAVAILABLE": ("Keep the original run and checkpoint for diagnosis. A deliberate new Paper "
                                   "run is a new account, not a recovery.",),
    "PAPER_RUN_UNKNOWN": ("List the runs with `paper list`.",),
    "PAPER_RUN_ACTIVE": ("Stop it with `paper stop --paper-id N`, which also seals it.",),
    "PAPER_MEMORY_FULL": ("Stop a running one with `paper stop --paper-id N`, then start again.",),
    "PAPER_START_FAILED": ("Read the error, repair the runtime or Docker, then start a new run.",),
    # Paper reconciliation (paper/reconcile.py)
    "PAPER_RECONCILE_EMPTY": ("Reconcile a run that received at least one bar.",),
    "PAPER_RECONCILE_UNCOVERED": ("Import the run's month with `market import --month YYYY-MM` over the market's "
                                  "contract scope once its days are archived, then reconcile at the new market day.",),
    # Live comparison (live/compare.py)
    "LIVE_COMPARE_EMPTY": ("Compare a run whose source started and received at least one minute.",),
    "LIVE_COMPARE_UNCOVERED": ("Import the run's month with `market import --month YYYY-MM` over the market's "
                               "contract scope once its days are archived, then compare at the new market day.",),
}


def refuse(code: str, message: str, *, missing: tuple[str, ...] = (), expected: str | None = None,
           write_status: Literal["not_written", "unknown", "written"] = "not_written",
           operation_id: str | None = None) -> Refusal:
    """A refusal whose repair commands come from the catalogue (an unknown code is a KeyError)."""
    return Refusal(code, message, missing, write_status, operation_id, expected, CATALOGUE[code])
