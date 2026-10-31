"""The refusal catalogue (`ledger.refusal_catalogue`): one meaning and repair per refusal code (and
`MARKET_CATALOGUE` for a market reference refused under a code the ledger also uses).

The repairs are the commands that supply what is missing; none is a way around a check. Every
code a function of this package raises is listed here; a test walks every raise site.
"""

from __future__ import annotations

from typing import Literal

from ledger.errors import Refusal, refusal


_RERUN = "Rerun the same command; writes are idempotent by operation ID."

CATALOGUE: dict[str, tuple[str, tuple[str, ...]]] = {
    "MARKET_REMOTE_INVALID": ("The read-only market supply response or cache does not match the pinned request.",
                              ("Inspect the supply identity, manifest and cache; no local or latest fallback is used.",)),
    "MARKET_REMOTE_UNAVAILABLE": ("The read-only market supply transport or export did not complete.",
                                  ("Inspect the supply service and connection before retrying the same request.",)),
    # Connections and service (ledger/db.py)
    "INVALID_ROLE": ("The connection role is neither writer nor reader.",
                     ("Connect with role writer to write or reader to read.",)),
    "LEDGER_UNKNOWN": ("No such ledger profile, or its service has no accounts for its database.",
                       ("List profiles with `ledger service status`; create one with `ledger init`.",)),
    "LEDGER_KIND": ("The profile is not a research ledger (for example a market database).",
                    ("Pass the research ledger profile.",)),
    "BRANCH_FORBIDDEN": ("The writer writes only the profile's fixed research branch.",
                         ("Connect the writer without a branch, or read other branches with the reader.",)),
    "LEDGER_UNAVAILABLE": ("The ledger service is not running or does not accept connections.",
                           ("Start it with `ledger service start`, then rerun the same command.",)),
    "LEDGER_PERMISSION": ("The ledger account may not run this statement or was refused.",
                          ("Write only through the declared commands; they use the writer account.",)),
    "SCHEMA_MISMATCH": ("The ledger schema generation is not the one this code reads.",
                        ("Use the product version that matches the ledger's schema generation; the active "
                         "ledger is rebuilt under the same name when the generation changes (README).",)),
    "INVALID_NAME": ("A profile, database or branch name is malformed, or the kind is unknown.",
                     ("Use letters, digits, hyphens and underscores, and kind active, isolated or temporary.",)),
    "LEDGER_EXISTS": ("A profile of that name, the active research ledger, or that database already exists.",
                      ("Choose another profile and database name; existing ledgers are never replaced.",)),
    "ISOLATION_BREACH": ("A test ledger reuses the active database name, or the active ledger or market database "
                         "would live in the source checkout or a temporary root (or lacks its backup directory).",
                         ("Give an isolated ledger its own database name; keep the active service and backup "
                          "outside Git and temporary directories.",)),
    "DOLT_BINARY": ("No Dolt executable of the pinned version was found.",
                    ("Set RESEARCH_DOLT_BINARY to a Dolt 2.4.2 executable.",)),
    "LEDGER_START": ("The Dolt service did not start or accept connections in time.",
                     ("Inspect the service log printed on standard error, then rerun `ledger init`.",)),
    "INVALID_REF": ("The ledger reference is empty or holds characters outside the Dolt reference set.",
                    ("Pass a commit hash, tag or branch name.",)),
    "UNKNOWN_REF": ("The reference names no commit, tag or branch of this ledger.",
                    ("List commits with `ledger sql \"SELECT * FROM dolt_log\"` and pass one of them.",)),
    # The write protocol
    "READ_ONLY_CONNECTION": ("Writes need the writer connection on the research branch.",
                             ("Run the declared write command; it opens the writer connection.",)),
    "DIRTY_WORKING_SET": ("The research branch holds uncommitted SQL changes from outside the write path.",
                          ("Have the ledger administrator inspect `dolt_status`; never commit them under another "
                           "operation.",)),
    "COMMIT_CHECK_FAILED": ("A commit verification test (dolt_tests, group commit) failed; nothing was written.",
                            ("Supply the missing records the failed test names, then rerun the same command.",)),
    "COMMIT_CHECKS_DISABLED": ("The service-wide commit verification setting is not the ledger's group 'commit'. "
                               "Any account can switch it on Dolt 2.4.2, so the write stops rather than commit "
                               "unchecked.",
                               ("Restore it with the administrator session: SET PERSIST "
                                "dolt_commit_verification_groups = 'commit'; then rerun the same command.",)),
    "CONCURRENT_WRITE": ("Another write landed first; this transaction was rolled back.",
                         ("Reread the ledger, check the record still makes sense, then rerun the same command; it "
                          "is idempotent.",)),
    "DOLT_SQL_ERROR": ("The ledger refused a statement; the transaction was rolled back.",
                       (_RERUN,)),
    "SQL_STATEMENT_FAILED": ("The ledger refused a `ledger sql` read statement; the server's error text is in the "
                             "message.",
                             ("Fix the statement and rerun; list tables with `ledger sql \"SHOW TABLES\"` and columns "
                              "with `ledger sql \"DESCRIBE <table>\"`.",)),
    # Paths
    "NOT_TEMPORARY_PATH": ("The path is not strictly under a temporary root.",
                           ("Pass a new directory under /tmp (or the platform temporary directory).",)),
    "PATH_EXISTS": ("The working path already exists; working copies are always new.",
                    ("Pass a path that does not exist yet.",)),
    # Evidence
    "INVALID_BUNDLE_NAME": ("The bundle name is not of the form [A-Za-z0-9][A-Za-z0-9_.-]{0,159}.",
                            ("Rename the bundle within the allowed characters and length.",)),
    "RESERVED_BUNDLE": ("The bundle name lies in a product namespace (trial-<id>-execution(-start), "
                        "trial-<id>-recovery(-*), registration-*, source-review-*, research-line-*, "
                        "lifecycle-<market_commit>), written only by its product command.",
                        ("Write those through their commands (`registration add`, `source review`, `line select`); "
                         "name your own evidence otherwise, for example correction-*.",)),
    "INVALID_EVIDENCE_PATH": ("An evidence source is a symbolic link, or a path in the bundle is absolute, "
                              "contains .. or repeats another.",
                              ("Copy the files into a plain directory without links or duplicate names.",)),
    "EMPTY_EVIDENCE": ("An evidence file is empty, or the sources hold no file.",
                       ("Remove empty files and pass at least one nonempty file.",)),
    "MEDIA_NOT_KEPT": ("Audio and video media are not kept in the ledger; only derived evidence is.",
                       ("Store the transcript, frames and receipts derived from the media instead.",)),
    "EVIDENCE_TOO_LARGE": ("An evidence file exceeds the per-file size limit.",
                           ("Store a derived, smaller file instead of the original.",)),
    "BUNDLE_EXISTS": ("A bundle of that name already exists with other content, or a trial with recovery material "
                      "is sealed again; bundles are never replaced and a trial is sealed once.",
                      ("Use a new bundle name; to correct a bundle, add a correction-* bundle naming it.",)),
    "UNKNOWN_BUNDLE": ("The ledger version read holds no bundle of that name.",
                       ("List bundles with `ledger sql \"SELECT DISTINCT bundle FROM v_evidence\"`.",)),
    "LEDGER_CORRUPT": ("Stored bytes no longer match their stored content hash; this is a ledger integrity "
                       "fault.",
                       ("Report it with the bundle or candidate named; run `ledger review` and restore from the "
                        "backup with the administrator.",)),
    # Candidates
    "SOURCE_SIZE": ("The strategy source is not bytes, is empty or exceeds the source size limit.",
                    ("Publish one complete, nonempty UTF-8 strategy file within the limit.",)),
    "ENTRY_CLASS_INVALID": ("The entry class is not a valid Python identifier.",
                            ("Pass the name of the strategy's top-level class.",)),
    "SOURCE_SYNTAX": ("The source is not valid UTF-8 Python.",
                      ("Fix the syntax or encoding in the working copy, then publish again.",)),
    "ENTRY_CLASS_NOT_UNIQUE": ("The source does not define exactly one top-level class of the entry class name.",
                               ("Define the entry class once at module top level.",)),
    "INVALID_ID": ("The strategy ID is not a reference name ([A-Za-z0-9][A-Za-z0-9_.-]{0,99}).",
                   ("Choose a strategy ID within the allowed characters and length.",)),
    "NOTE_INVALID": ("The description or difference is empty or longer than 2000 characters.",
                     ("Write a nonempty note of at most 2000 characters.",)),
    "LINEAGE_INCOMPLETE": ("A parent and its difference were not given together.",
                           ("Give both --parent and --difference, or neither for a root.",)),
    "BAD_REF": ("A candidate reference is not strategy_id@revision with a positive revision.",
                ("Write the reference as strategy_id@N.",)),
    "UNKNOWN_CANDIDATE": ("The ledger version read holds no candidate of that reference.",
                          ("List candidates with `candidate list`.",)),
    "SOURCE_EXISTS": ("These exact source bytes are already a candidate.",
                      ("Use the existing candidate named in the message, or change the source.",)),
    # Research lines
    "START_NOT_FOUND": ("The start candidate of the research line does not exist.",
                        ("Publish the start with `candidate publish`, then select the line again.",)),
    "START_REVIEW_REQUIRED": ("The start revision has no passed source review, or a source review of it failed. "
                              "A review that failed only on activity, of a precheck that sealed no fill and no "
                              "position, does not count once a later precheck of the source sealed fills and has a "
                              "passed review and no failed one.",
                              ("Run `replay precheck` on the start revision and record its `source review`, then "
                               "select the line again; after a failed review, fix the source, publish it and start "
                               "from the new revision.",)),
    "MARKET_COMMIT_UNRESOLVED": ("The market reference resolves to no unique commit with a universe rule.",
                                 ("Pass a commit, tag or branch of the active market database; `market coverage` "
                                  "without --at prints its head as commit.",
                                  "A commit outside that history (an earlier market database's) does not resolve: "
                                  "nothing pinned to it registers or replays against this market database.")),
    "WINDOW_INVALID": ("A window does not start before it ends, or a trial's warm-up start is after its trading "
                       "start or not on a whole UTC minute.",
                       ("Pass a window whose start precedes its end (and, for a replay, a whole-minute warm-up "
                        "start no later than the trading start).",)),
    "WINDOW_OUT_OF_COVERAGE": ("The development window ends after the market commit's latest complete day.",
                               ("End the window at most one day after the latest complete day, or pin a newer "
                                "market commit.",)),
    "LINE_CONFLICT": ("A research line of that date and slug already exists with another choice.",
                      ("Name the direction more precisely with another `--slug`, then select again.",)),
    "LINE_SLUG_INVALID": ("The line slug is not lowercase ASCII words joined by hyphens of at most 48 characters.",
                          ("Name the line's direction in that form.",)),
    "LINE_DATA_TAKEN": ("An open research line already holds this market commit and development window, so the "
                        "two lines would share their trials.",
                        ("Continue that line, or close it with `line close` before selecting this one; never pin "
                         "another market commit or move the window only to get past this.",)),
    "LINE_AMBIGUOUS": ("Several research lines are open and the command names none.",
                       ("Name the line with --line (one of `research state` open_lines).",)),
    "LINE_CLOSED": ("The line is already closed with another summary; a closing tag is never replaced.",
                    ("Read its summary from dolt_tags (`ledger sql`); leave it as it is.",)),
    "LINE_SUMMARY_INVALID": ("The line summary is not UTF-8, is empty or exceeds 32768 bytes.",
                             ("Shorten the summary to the line's directions, results, failures and lessons, then "
                              "close again.",)),
    "LINE_CORRUPT": ("The research line record is missing from its bundle or no longer matches its hash.",
                     ("Run `ledger review`; select a new line with `line select`.",)),
    "LINE_FORMAT_UNSUPPORTED": ("The research line record is not a research-line-v2 record.",
                                ("Select a new line with `line select`.",)),
    "LINE_UNKNOWN": ("The research line bundle does not exist or is not a research-line-* bundle.",
                     ("Name an existing research-line-<date>-<slug> bundle, or omit --line to use the only open line; "
                      "select a line with `line select`.",)),
    "LINE_ENDED": ("The research line is closed: its closing tag marks its end.",
                   ("Work on an open line (`research state` lists open_lines), or select a new one with "
                    "`line select`; targets without a line go to the ledger default (`line targets --default`).",)),
    "TARGETS_INVALID": ("A research target is missing or out of range: maximum drawdown is a fraction between 0 "
                        "and 1, minimum annual return a positive fraction.",
                        ("Pass both targets as the user stated them, as fractions (0.15 for 15%).",)),
    "LEDGER_UPGRADE_REQUIRED": ("The ledger lacks a table this product version writes.",
                                ("Run `ledger upgrade` (the service administrator adds the missing tables), then "
                                 "rerun the same command.",)),
    # Trials
    "BINDING_NOT_ALLOWED": ("The binder does not fit the replay's purpose: an exploration or precheck was given "
                            "a registration binder, or a non-validation trial a validation binder.",
                            ("Run explorations and prechecks without a registration; bind a validation registration "
                             "only to a validation replay.",)),
    "BINDING_REQUIRED": ("A research or validation replay has no registration binder.",
                         ("Register first (`registration add` or `validation registration`), then replay.",)),
    "SOURCE_NOT_PUBLISHED": ("The executed source is not a published candidate.",
                             ("Publish it with `candidate publish`, then replay.",)),
    "RUNTIME_NOT_PINNED": ("The runtime image is not pinned by digest, disagrees with its digest, or lacks its "
                           "probe inspection.",
                           ("Resolve the runtime image by digest and inspect it, then replay.",)),
    "TRIAL_INPUT_INCOMPLETE": ("The input identity lacks the market commit, universe rule, instruments, export "
                               "content hash or coverage receipt, or the window lacks a bound.",
                               ("Export the market inputs for the window again, then replay.",)),
    "OUT_OF_SAMPLE_RESERVED": ("The trial trades inside the window of a validation registration of the same "
                               "candidate source that is not yet bound.",
                               ("Run the validation the user registered; other trials of this candidate may not "
                                "touch its window until it is bound.",)),
    "TRIAL_NOT_FOUND": ("The trial does not exist on this ledger version.",
                        ("List trials with `research status`.",)),
    "EXECUTION_IDENTITY": ("The execution start receipt disagrees with its trial row (source, runtime identity) "
                           "or is malformed; or the stages, commands or working directory of a capture differ from "
                           "the process record, the start receipt or the sealed hashes.",
                           ("Replay through `replay run`, `replay precheck` or `replay explore`, which write both "
                            "together.",)),
    "REGISTRATION_TOO_LATE": ("The registration was not recorded strictly before the trial, or a validation "
                              "registration's time witness is missing or not before its window starts.",
                              ("Register a new grid point, then replay it; for a validation, stamp it with "
                               "`ledger witness` before the window starts or register a later window.",)),
    "SOURCE_MISMATCH": ("The executed source is not in the registration's locked grid, or not the source of the "
                        "registered validation candidate.",
                        ("Replay a source of the registered grid (or the registered candidate), or register "
                         "again.",)),
    "LINEAGE_MISMATCH": ("The grid source's parent or difference no longer matches the registration.",
                         ("Register the grid again from the published candidates.",)),
    "EXECUTION_MISMATCH": ("What the trial records (purpose, windows, instruments, runtime image and contract, "
                           "effective configuration, input identity) differs from the registration.",
                           ("Replay with the registered execution identity, or register again.",)),
    "SOURCE_PRECHECK_REQUIRED": ("The grid source lacks a matching native precheck or independent review, or the "
                                 "precheck's capture is malformed.",
                                 ("Run `replay precheck` and record `source review` for the source.",)),
    "SOURCE_PRECHECK_FAILED": ("The precheck or independent review of the grid source did not pass, or another "
                               "review of the same precheck failed it.",
                               ("Fix the source, publish it and precheck it again.",)),
    "GRID_ALREADY_ATTEMPTED": ("This grid point (or validation registration) was already consumed.",
                               ("Register a new grid point; consumed attempts stay counted.",)),
    # Execution captures (ledger/execution.py)
    "EXECUTION_START_MISSING": ("The trial has no trial row or no execution start receipt, so nothing is sealed.",
                                ("Replay through `replay run`, `replay precheck` or `replay explore`, which write the "
                                 "trial and its start receipt before the container starts.",)),
    "EXECUTION_CAPTURE_LIMIT": ("The execution capture exceeds the capacity limit of its purpose (or one file the "
                                "per-file limit); no capture was written and the working directory is kept. A "
                                "research or validation trial is stored as an invalid run with its recovery "
                                "material.",
                                ("Rerun with a shorter window or fewer instruments; for a precheck, append the kept "
                                 "bytes with `execution recover` (they stay recovery material, not the "
                                 "capture).",)),
    "RECOVERY_NOT_APPLICABLE": ("Recovery applies only to a trial whose original capture is missing, from the "
                                "working directory its start receipt records: a precheck with no run and no "
                                "registration attempt, or (by the replay entry only) a sealed replay refused for "
                                "size.",
                                ("Read the trial's capture with `research status`; replay again instead of "
                                 "recovering.",)),
    "RECOVERY_INCOMPLETE": ("The kept directory lacks valid stage facts or an original the stages require, or the "
                            "host error is not the capture-limit refusal.",
                            ("Pass the kept working directory unchanged and the capture-limit refusal it wrote.",)),
    # Coverage at ingest (ledger/coverage.py)
    "CAPTURE_INCOMPLETE": ("The trial's original capture is missing or lacks its start receipt, stages, coverage "
                           "receipt or native summary.",
                           ("The run cannot be stored from this trial; replay the grid point again under a "
                            "retry registration.",)),
    "PHASE_FAILED": ("A stage of the original capture (runner or auditor) did not exit 0.",
                     ("Store the replay as invalid with its reasons; diagnose it from the capture.",)),
    "INPUT_IDENTITY_MISMATCH": ("The sealed coverage receipt names other inputs than the stored input identity.",
                                ("Replay through `replay run`, which writes both from one export.",)),
    "COVERAGE_RECEIPT_INVALID": ("The coverage receipt is not execution-input-coverage-v1, lacks the market commit "
                                 "or instruments, or an instrument has no export receipt.",
                                 ("Export the market inputs again and replay through the product entry.",)),
    "COVERAGE_MISMATCH": ("The coverage receipt and the native summary differ in instruments, market commit or input "
                          "interval (or a given window), or the sealed receipt is not the start receipt's.",
                          ("Replay with the inputs the receipt names; report the runner if it read others.",)),
    "LIFECYCLE_NATIVE_COUNT_INVALID": ("A native lifecycle count is not a nonnegative integer, or an instance repeats.",
                                       ("Report the runner defect; the run cannot be stored.",)),
    "LIFECYCLE_BUNDLE_MISSING": ("The native summary has lifecycle events but the inputs name no lifecycle bundle.",
                                 ("Replay with the lifecycle bundle of the market commit (`--lifecycle-bundle`).",)),
    "LIFECYCLE_COVERAGE_MISMATCH": ("The coverage receipt's format, input window or market commit differs from the "
                                    "native summary's.",
                                    ("Replay with the inputs the receipt names; report the runner if it read others.",)),
    "LIFECYCLE_COUNT_MISMATCH": ("The export receipts' lifecycle counts, their episodes and the native counts disagree.",
                                 ("Export the inputs again with the lifecycle bundle; report the runner if the "
                                  "engine delivered other events.",)),
    "LIFECYCLE_EVENT_INVALID": ("A lifecycle event of an exported episode is not a native event, has inconsistent "
                                "clocks or an invalid close.",
                                ("Write a corrected lifecycle bundle for the market commit; never edit an export.",)),
    "LIFECYCLE_DUPLICATE_EVENT": ("A termination of one type, instance and time appears twice in the episodes.",
                                  ("Write a corrected lifecycle bundle for the market commit.",)),
    # Runs (ledger/trials.py, ledger/metrics.py)
    "TRIAL_PURPOSE_INVALID": ("Only research and validation trials become runs; explorations and prechecks stay "
                              "working copies.",
                              ("Read the exploration or precheck from its directory; register to store a run.",)),
    "RUN_ALREADY_INGESTED": ("The trial already has a run.",
                             ("Read it with `research status`; a trial is stored once.",)),
    "UNKNOWN_RUN": ("The ledger version read holds no run of that ID.",
                    ("List runs with `research status`.",)),
    "REPORT_UNREADABLE": ("A native report file exists but is not UTF-8 CSV, JSON or gzip as the runner writes it.",
                          ("Replay again into a new directory; report the runner if it persists.",)),
    # Replays (replay/)
    "TRADE_TICKS_NEED_QUOTES": ("--trade-ticks is given without --execution quotes: in the bar environment an order a "
                                "trade prompts mid-minute would match the whole minute's bar.",
                                ("Add --execution quotes with its margin rates, or drop --trade-ticks.",)),
    "RUNNER_OPTION_RESERVED": ("The runner arguments name an option the replay entry writes itself (strategy file, "
                               "class or hash, bindings, output, market inputs).",
                               ("Pass only the window and the instrument scope; the entry adds the rest.",)),
    "RUNTIME_NOT_CI_BUILT": ("The runtime image has no build source revision label, so it is no CI build.",
                             ("Use a runtime image built by CI (`--runtime ghcr.io/qoeop/trade-runtime:main`).",)),
    "RUNTIME_CONTRACT_MISMATCH": ("The candidate's runtime contract differs from the runtime image's.",
                                  ("Replay on an image of the candidate's contract, or publish the source for the "
                                   "image's contract.",)),
    "REGISTRATION_REQUIRED": ("A sealed replay needs exactly one of a registration bundle (research) or a validation "
                              "registration.",
                              ("Pass --hypothesis registration-<name> or --validation <id>, not both.",)),
    "EXPORT_CHANGED_BEFORE_EXECUTION": ("The exported inputs no longer have the content hash their input identity "
                                        "records; nothing was started.",
                                        ("Export the inputs again (rerun the same command).",)),
    "REPRODUCTION_MISMATCH": ("The reproduced native reports do not carry the semantic fingerprint recorded for the "
                              "run (or no fingerprint exists on either side to compare), or a directory read as a "
                              "reproduction is not the one its reproduction trial sealed (another trial, source, "
                              "image or inputs, or a report file that differs from the trial's capture); the "
                              "directory is kept for diagnosis.",
                              ("Diagnose the kept directory; reproduce on the run's own image (replay.reproduce) and "
                               "read native detail with the directory and the trial ID it returned.",)),
    # Judgments
    "COMMIT_NOT_ANCESTOR": ("The judgment's based_on_commit is not an ancestor of the ledger head.",
                            ("Pass the commit you read, as shown by `research state`.",)),
    "COMMIT_BEFORE_LINE": ("The judgment's based_on_commit is older than its research line.",
                           ("Read the ledger after the line was selected and pass that commit.",)),
    "SUBJECT_UNKNOWN": ("A judgment subject names no existing candidate, trial or attempted registration.",
                        ("Reference existing records only; list them with `candidate list` and "
                         "`research status`.",)),
    "SUBJECT_ROLE_MISMATCH": ("A subject role is unknown, or recommended, parent or control names no candidate.",
                              ("Use role recommended, parent or control for candidates and about otherwise.",)),
    "SUPERSEDES_INVALID": ("The superseded judgment is missing, of another kind or line, or already superseded.",
                           ("Supersede the current judgment of the same kind on the same line.",)),
    "OP_ID_CONFLICT": ("This operation ID already names a record with other content.",
                       ("Use a new operation ID, or omit it to derive one from the content.",)),
    "RECOMMENDATION_INCOMPLETE": ("A recommendation does not name every candidate with a run of the line's "
                                  "execution identity in its comparison table at the commit it is based on.",
                                  ("Run `research status --at COMMIT` and add a `--subject role=…,candidate=ID@N` for "
                                   "each candidate the message lists.",)),
    # Witness
    "NOT_REGISTRATION_COMMIT": ("The commit added no validation registration.",
                                ("Pass the commit that added the validation registration (`ledger witness`).",)),
    "WITNESS_INVALID": ("The timestamp token does not verify offline against the pinned roots, the commit, the "
                        "nonce or the registration time.",
                        ("Run `ledger witness` again to request a new token.",)),
    "WITNESS_UNAVAILABLE": ("The timestamp authority was unreachable, timed out or did not grant a token.",
                            ("Run `ledger witness` again before the validation window starts.",)),
    # Registration (registration/register.py)
    "REGISTRATION_BUNDLE_NAME": ("A registration bundle is named registration-*, the namespace only the "
                                 "registration command writes.",
                                 ("Register under registration-<hypothesis>.",)),
    "DUPLICATE_BUNDLE": ("A bundle of that name already exists with another research-plan.json.",
                         ("Register under a new bundle name; registrations are never replaced.",)),
    "REGISTRATION_INVALID": ("The registration body does not have the required shape, or a record it cites (source "
                             "bundle, retry_of registration, parent, grid candidate) is not in the ledger; a "
                             "registration is only a registration-* bundle.",
                             ("Fix the field the message names (its description is quoted), then run "
                              "`registration add` again.",)),
    "SOURCES_REQUIRED": ("The rationale cites external work without a source original, or a cited source bundle "
                         "does not exist.",
                         ("Pass the originals with `registration add --source`, or add them with `evidence add` "
                          "and cite their bundle names.",)),
    "RESEARCH_LINE_REQUIRED": ("The ledger has no open research line, so the window cannot be checked.",
                               ("Select a research line with `line select`, then register.",)),
    "WINDOW_MISMATCH": ("The registered window differs from the development window of the line it is registered "
                        "on, or a "
                        "validation trial's window is not inside its registered window or does not start after "
                        "it ends.",
                        ("Register the research line's window exactly (read it with `research state`); replay a "
                         "validation only inside its registered window after it has ended.",)),
    "CONFIG_MISMATCH": ("A grid point's runtime contract differs from the execution identity, or a validation's "
                        "account terms differ from the candidate's latest passed research run at the original "
                        "validation registration commit (or no such run existed then).",
                        ("Publish the grid for the probed runtime contract. For validation, keep the original "
                         "registration's account terms; later research cannot replace that baseline. If terms "
                         "must change, stop and ask the user about a new future-window registration.",)),
    "SOURCE_ALREADY_EXPOSED": ("A grid source already sealed an economic result the researcher could read, in "
                               "a trial that is neither part of this registration's retry chain nor the cited "
                               "short precheck, so registering it now would choose it after seeing its result.",
                               ("Preserve the exposure record. Use retry_of only for an earlier registration that "
                                "actually consumed this source; a rebuild of the same question on another image "
                                "cites a new precheck on that image. Register a new source for a new research "
                                "hypothesis.",)),
    "DUTY_UNKNOWN": ("changed_duties names a duty outside the 27, or is nonempty for a root or empty for a derived "
                     "registration.",
                     ("Use duty IDs A1 to I2 from the duty directory; leave changed_duties empty only for a root.",)),
    "PREDICTION_INVALID": ("A prediction names a duty outside changed_duties or a slice or measure outside the "
                           "measure catalogue, has an empty slice without a reason, or a changed duty has no "
                           "prediction.",
                           ("Write at least one prediction per changed duty on a catalogue slice and measure (or an "
                            "empty slice with a reason).",)),
    "INTERPRETATION_REQUIRED": ("A completed research trial of the line has no interpretation judgment (an invalid "
                                "run whose registration a later registration retries needs none).",
                                ("Add an interpretation with `judgment add --kind interpretation` about the trials "
                                 "the message lists.",)),
    "REVIEW_DUE": ("The line has run the product's fixed number of research trials since its last recommendation; "
                   "registrations stop until a review.",
                   ("Run `research status` and read its `comparison` table.",
                    "Write a `recommendation` judgment naming every candidate of the line's `execution_identity` in that "
                    "table (`judgment add --kind "
                    "recommendation --based-on COMMIT`), and a `priority` judgment for the next steps; the "
                    "recommendation clears the stop.")),
    # Comparability (registration/comparability.py)
    "RUN_NOT_PASSED": ("The run is not a passed sealed research or validation run.",
                       ("Choose a passed research or validation run as the control.",)),
    "COMPARABILITY_MISMATCH": ("The two sides differ in runtime image, effective configuration or input identity.",
                               ("Choose a comparable control, or replay the control under the new execution "
                                "identity first.",)),
    "IDENTITY_MALFORMED": ("An effective configuration or input identity is not a mapping or lacks a required key.",
                           ("Replay through the product entry points, which record complete identities.",)),
    "ECONOMIC_EVIDENCE_UNAVAILABLE": ("The run has no economic evidence (no fills, unmatched records, failed "
                                      "capture or failed source review).",
                                      ("Choose a control with economic evidence, or diagnose and fix the run "
                                       "first.",)),
    # Inputs (registration/inputs.py)
    "SYMBOL_SELECTION_INVALID": ("The selection does not give exactly one of universe or symbols, or repeats a "
                                 "symbol.",
                                 ("Pass {\"universe\": true} or {\"symbols\": [...]} without repeats.",)),
    "UNIVERSE_EMPTY": ("The market commit has no universe members, or none intersects the trading window.",
                       ("Pin a market commit whose universe covers the window, or choose another window.",)),
    "EXPORT_TIMEFRAME": ("An export receipt is not of 1-minute bars.",
                         ("Export the market inputs again with the product entry point.",)),
    "EXPORT_CONTENT_INVALID": ("The export root or membership file holds a symbolic link, or the membership file "
                               "is missing.",
                               ("Export the market inputs again into a new directory.",)),
    "LIFECYCLE_INPUT": ("The lifecycle evidence bundle is not lifecycle-<market_commit> of the pinned commit, is "
                        "missing, lacks lifecycle.json, fails its hash check or does not validate against the "
                        "pinned market commit.",
                        ("Write the lifecycle bundle for this market commit again with the market command.",)),
    # Prechecks and source reviews (registration/precheck.py)
    "REVIEW_INVALID": ("The source review body lacks or adds a field, uses a status or verdict outside the "
                       "enumeration, has an empty note, or its verdict is not passed exactly when no item is "
                       "failed or unresolved.",
                       ("Write only the four items api, causal, activity and readiness to the --items file, each "
                        "{status, note}; pass trial_id as --precheck-trial and verdict as --verdict.",)),
    "PRECHECK_CAPTURE_MISSING": ("The trial has no original precheck capture (only recovery material, or another "
                                 "purpose).",
                                 ("Run `replay precheck` for the source and review that trial.",)),
    # Validation (registration/validation.py)
    "CANDIDATE_UNKNOWN": ("The validated candidate is not a published candidate.",
                          ("Pass a candidate shown by `candidate list` as strategy_id@revision.",)),
    "DESIGN_INVALID": ("The declared test design lacks or adds a field or holds an illegal value.",
                       ("Declare method, block_days, resamples, inner_resamples, seed, alpha, minimum_effect and "
                        "design_reason.",)),
    "RETRY_NOT_ALLOWED": ("A consumed attempt on the retry_of chain of a research registration, or the bound "
                          "replay of a retried validation registration, was neither interrupted (by its original "
                          "capture) nor invalid and has economic evidence without qualifying as a fixed-question "
                          "research rebuild on a different image; or the retried validation registration "
                          "does not exist, differs in candidate, window, universe rule or original test design, "
                          "or was never bound.",
                          ("Retry only attempts whose replay was interrupted, invalid or without economic "
                           "evidence. For a research runtime rebuild, keep the declarations, source grid, "
                           "configuration and inputs fixed, cite new matching reviews and rebuild the equivalent "
                           "control first. Validation retries keep the original candidate, window, universe "
                           "rule and test design. A poor result is no reason to retry.",)),
    "REGISTRATION_UNKNOWN": ("The validation registration does not exist.",
                             ("List validation registrations with `research status`.",)),
    "REGISTRATION_CONSUMED": ("The validation registration was already bound, or the trial is bound to another "
                              "registration.",
                              ("Register a new validation; a bound registration stays consumed.",)),
    "STALE_CHECKOUT": ("The product checkout's HEAD lacks the latest main commit, or this cannot be proved.",
                       ("Update the checkout to origin/main, then rerun.",)),
    "RUNTIME_NOT_MAIN": ("The runtime image is not a main build of the product image source, or its code differs "
                         "from that revision, or the trial ran another image.",
                         ("Merge first, then rerun with the main runtime image.",)),
    "MEMBERSHIP_CHANGED": ("The universe rule differs, a month up to the registration month changed between the "
                           "two market commits, a window month is missing, a member was removed from the strategy's "
                           "path, or the trial's instruments differ from its recorded membership.",
                           ("Replay with the registered universe rule on a market commit that keeps the registered "
                            "months and covers the window.",)),
    "COVERAGE_INCOMPLETE": ("A member's input interval has no coverage receipt.",
                            ("Export the market inputs for the whole warm-up and trading interval again.",)),
    # Export and backup (ledger/admin.py)
    "EXPORT_PATH_INVALID": ("The export or backup destination lies inside the service directory or a Git work tree, "
                            "exists and is no export of this ledger, or holds a file where the backup goes.",
                            ("Choose a new directory outside the service directory and any checkout, or this ledger's "
                             "earlier export.",)),
    "DOLT_BACKUP": ("The full-history backup could not be synced or restored, or its head differs from the ledger "
                    "(or market) head after the sync.",
                    ("Check the backup directory and the service, then rerun the export or `market backup`.",)),
    "BACKUP_DIVERGED": ("The existing backup's head is no commit of this database's history: it is another "
                        "database's backup, or a commit was rewritten. A sync would overwrite it, so nothing was "
                        "synced.",
                        ("Run `ledger review` (or `market review`) and report the finding; a backup is replaced "
                         "only with the user's authority.",)),
    # Publication (ledger/publish.py)
    "REMOTE_UNSET": ("The database has no origin remote to publish to.",
                     ("Name its DoltHub repository once with `ledger publish --remote URL` (or `market publish "
                      "--remote URL`).",)),
    "REMOTE_INVALID": ("The remote is neither a DoltHub repository nor a local file:// remote.",
                       ("Pass https://doltremoteapi.dolthub.com/<owner>/<repository>.",)),
    "REMOTE_MISMATCH": ("The database already publishes to another origin; it is not replaced.",
                        ("Publish without --remote, or report it: changing the public copy needs the user's "
                         "authority.",)),
    "PUBLISH_FORBIDDEN": ("Only the active database publishes to a public remote; an isolated or temporary one "
                          "publishes only to a local file:// remote.",
                          ("Publish the active database, or give a file:// remote for an isolated one.",)),
    "DOLTHUB_CREDENTIALS": ("No DoltHub key from `dolt login` was found to install in the service's Dolt home.",
                            ("Ask the user to run `dolt login`, then rerun the same command.",)),
    "PUBLISH_REJECTED": ("The remote refused the push, and after a fetch its head neither contains the local head "
                         "nor is an ancestor of it. Nothing was forced and no tag was pushed.",
                         ("Report it to the user: the public copy was changed elsewhere, and replacing it needs the "
                          "user's authority.",)),
    "PUBLISH_FAILED": ("The push or the fetch failed (network, credentials or DoltHub), the remote's head after the "
                       "push does not contain the local one, or another publish of the database held its publish lock "
                       "too long. The local write stands.",
                       ("Check the network and the DoltHub key, then run `ledger publish` (or `market publish`).",
                        "When the message says the service started before its key was installed, restart the service "
                        "(`ledger service stop`, then `ledger service start`) first.")),
    # Reports (report/)
    "MARKET_RETURNS_UNAVAILABLE": ("The market's daily returns for the run's market commit and window could not be "
                                   "read; only the market measures are empty.",
                                   ("When the message names UNKNOWN_REF, the run's market commit is not in the active "
                                    "market database's history: its market measures cannot be read here and stay "
                                    "empty.",
                                    "Otherwise make the market database profile available (read only), then read the "
                                    "report again.")),
    "DIRECTORY_NOT_FOUND": ("The replay directory does not exist or is not readable.",
                            ("Pass the output directory of an exploration or precheck.",)),
    "NATIVE_SUMMARY_MISSING": ("The directory holds no native summary written by the runner.",
                               ("Pass a directory the runner finished writing; a failed runner leaves its reason in "
                                "the capture.",)),
    "REPORT_PARSE_FAILED": ("A native report file is missing, lacks a column or does not parse in the sealed format.",
                            ("Replay again with the runner of the runtime contract; reports are never repaired.",)),
    "NO_CONTROL": ("The registration declares no control run, or the declared control run does not exist.",
                   ("Register a derived hypothesis with a comparable control run to compare it.",)),
    "RUN_NOT_IN_GRID": ("The candidate run is not the run of a grid point this registration consumed, or its source "
                        "differs from the consumed point.",
                        ("Compare the run under the registration whose grid point produced it.",)),
    "COMPARISON_UNAVAILABLE": ("A side's trade-window daily returns are empty, invalid or do not compound to its final "
                               "equity, the series hold fewer than two whole blocks, or the test inputs are malformed.",
                               ("Use runs whose daily series reconcile and a window of at least two blocks; the series "
                                "are never repaired.",)),
    "CLOCK_MISMATCH": ("The two sides' UTC daily clocks are not the same day by day.",
                       ("Compare runs of the same trading window; days are never filled or resampled.",)),
    "INTERACTION_UNATTESTED": ("A declared interaction's four corners do not attest it: a and b do not derive from base "
                               "or ab from a or b, the three-way merge of a and b from base conflicts or is not ab's "
                               "source, a corner lacks exactly one comparable passed research run with economic "
                               "evidence, or a corner's run is not older than the declaring registration. The "
                               "comparison reports it as the interaction's reason and stands.",
                               ("Declare the two-by-two when registering its last corner, with ab the merge of a and "
                                "b; read the comparison without the interaction otherwise.",)),
    "REFERENTIAL_GAP": ("A registration attempt or run names a trial that does not exist, or the attempt outcomes do "
                        "not add up to the attempts.",
                        ("Run the whole review (`ledger review`) and report the gap; counts are never partial.",)),
    "SAME_RUN": ("The reference and the candidate are the same run.",
                 ("Pass two different runs of the same source, inputs and configuration.",)),
    "RUN_INCOMPLETE": ("A run to compare is not passed or has no sealed result.",
                       ("Compare passed sealed runs only.",)),
    "PAIR_INPUT_MISMATCH": ("The two runs differ in source content hash, input identity or effective configuration.",
                            ("Compare runs of the same source on the same inputs and configuration; only the runtime "
                             "may differ.",)),
    "EXPORT_INCOMPLETE": ("A reproduction directory lacks a native report the comparison needs.",
                          ("Reproduce the run again; a reproduction is handed over only complete.",)),
    # Replay stage containers (replay/seams.py, runtime.container_command)
    "MODULE_NOT_IN_LAYOUT": ("The module is not the runner, auditor, probe or fingerprint the runtime layout declares.",
                             ("Run only the modules runtime.layout declares for the image's contract.",)),
    "MOUNT_HOST_PATH_INVALID": ("A mount source is not an existing absolute host path.",
                                ("Mount only the replay's own working directory and exported inputs.",)),
    "MOUNT_TARGET_INVALID": ("A mount target is not absolute, repeats, is the root, or lies over or under /tmp or "
                             "the image's code (/opt/trade).",
                             ("Give each input its own absolute container path clear of /tmp and /opt/trade.",)),
    "MOUNT_WRITABLE_NOT_REPORTS": ("A writable mount is not /reports, or more than one mount is writable.",
                                   ("Mount every input read-only; only the stage's output directory is /reports.",)),
    "REPORTS_MOUNT_MISSING": ("The stage has no writable /reports mount.",
                              ("Mount the stage's output directory writable at /reports.",)),
    "ARGV_INVALID": ("A container argument is not a string.",
                     ("Pass the runner's arguments as strings.",)),
    # Runtime (runtime/image.py)
    "RUNTIME_UNAVAILABLE": ("The runtime image could not be pulled, inspected or pinned to one digest.",
                            ("Check the image reference and the container runtime, then rerun. A pull that never "
                             "finishes is often a Docker credential helper (credsStore or credHelpers in "
                             "~/.docker/config.json) that never answers; the public runtime image pulls "
                             "anonymously without it.",)),
    "RUNTIME_PROBE_INVALID": ("The runtime identity probe failed or returned an incomplete report.",
                              ("Use a runtime image built by CI for a supported runtime contract.",)),
    "RUNTIME_IDENTITY_INVALID": ("The runtime identity is malformed: a field is missing or extra, the reference "
                                 "carries no sha256 digest or disagrees with it, or the image has no contract label.",
                                 ("Resolve the image with `--runtime <image>:<tag>` or `<image>@sha256:<digest>`; "
                                  "never write an identity by hand.",)),
    "RUNTIME_UNSUPPORTED": ("The runtime platform or contract has no layout in this product version.",
                            ("Use a CI image of a contract runtime.layout declares (`--runtime "
                             "ghcr.io/qoeop/trade-runtime:main`).",)),
    "RUNTIME_DIGEST_AMBIGUOUS": ("The local image has no single manifest digest under its image name.",
                                 ("Pass the image by digest (`<image>@sha256:<digest>`).",)),
    "RUNTIME_MISMATCH": ("The local image or its probe disagrees with the identity: digest, platform, contract, "
                         "source layout or configuration hash.",
                         ("Pull the image by digest again; report the image if the probe still disagrees.",)),
    # The command line (cli/)
    "USAGE_ERROR": ("The command, a required option or an option's type is not what the command line declares.",
                    ("Read `python -m cli.main <noun> <verb> --help` and rerun with the declared options.",)),
    "SOURCE_UNREADABLE": ("The given file is not a readable regular file (missing, a directory or a link).",
                          ("Pass the path of the single-file UTF-8 source itself.",)),
    "WRITE_VIA_SQL": ("`ledger sql` runs exactly one read statement (SELECT, SHOW, DESCRIBE, DESC, EXPLAIN, WITH, "
                      "TABLE or VALUES) with the reader account; /*! and /*+ comments, which the server executes, "
                      "are not accepted.",
                      ("Write only through the declared commands; read with one SELECT.",)),
    "PRECHECK_NOT_FOUND": ("The trial is no native precheck of this candidate's source on this runtime image.",
                           ("Run `replay precheck` for the candidate on the image, then review that trial.",)),
    "RUNTIME_UNRESOLVED": ("The runtime reference does not resolve to an image digest.",
                           ("Pass the image the precheck ran on, by tag or digest.",)),
    "BACKUP_TARGET_UNSET": ("The ledger or market profile declares no backup directory.",
                            ("Export with `ledger export --kind reproduce --output <new directory>`.",
                             "For a market database, its profile's `backup` names the directory (`market init "
                             "--backup-root`); then run `market backup`.")),
    "EXPORT_MISMATCH": ("The written export manifest does not reread to the exported content hash; the "
                        "incomplete copy was removed.",
                        ("Rerun the same export; report the disk if it persists.",)),
    "LEDGER_NOT_INITIALIZED": ("The service directory holds no initialized ledger of this profile.",
                               ("Initialize it with `ledger init` (or `ledger temp` for a test ledger).",)),
    "SERVICE_START_FAILED": ("The service started but the ledger did not answer. A service this host started was "
                             "stopped; one compose runs was left running.",
                             ("Inspect the service log (in the service directory, or `docker compose logs ledger`), "
                              "then rerun `ledger service start`.",)),
    "BOOTSTRAP_REFUSED": ("`ledger service run` found no service.json, but the service, data or profile directory "
                          "is not empty; it bootstraps only into empty ones and changed nothing.",
                          ("Report it to the user: TRADE_DATA may name the wrong directory, or service.json was lost.",)),
    "BOOTSTRAP_FAILED": ("A bootstrap step failed (cloning a public copy); what the bootstrap made was removed.",
                         ("Inspect `docker compose logs ledger`; the next start bootstraps again.",)),
    "SERVICE_CHECK_FAILED": ("The service or a database on it is not what this code reads (commit verification "
                             "group, a recorded database, a schema version or the commit tests); it was not served.",
                             ("Report it to the user with the named item; nothing was changed.",)),
    "SERVICE_MANAGED": ("The Dolt service is run by compose (its service.json names no socket); this host neither "
                        "starts nor stops it.",
                        ("Stop or restart it with `docker compose stop ledger` or `docker compose restart ledger`.",)),
    "JUDGMENT_BODY_UNREADABLE": ("The judgment body is not a readable UTF-8 text file.",
                                 ("Write the judgment text to a UTF-8 file and pass it with --body.",)),
    # The market database (market/)
    "MARKET_REFUSED": ("The market database refused the import or read.",
                       ("Read the message; fix the input it names and rerun the same command.",)),
    "ROLE_UNKNOWN": ("The market connection role is neither import nor reader.",
                     ("Connect with role import to import or reader to read.",)),
    "MARKET_UNREACHABLE": ("The market database's service is not running, the database does not exist or the account "
                           "was refused.",
                           ("Start the service with `ledger service start` and pass the market profile with "
                            "--market; create a market database with `market init`.",)),
    "SCHEMA_VERSION_MISMATCH": ("The market database's schema generation or integer scales are not the ones this code "
                                "reads, or a reader found a database without its schema row (never imported).",
                                ("Use the product version that matches the market database, or import its first "
                                 "month with `market import`.",)),
    "MARKET_PERMISSION": ("The market account may not run this statement.",
                          ("Import only through `market import`; read with the reader account.",)),
    "MARKET_SQL_ERROR": ("The market database refused a statement; nothing was committed.",
                         ("Rerun the same command; report the statement if it persists.",)),
    "AMBIGUOUS_REF": ("The hash prefix matches more than one market commit.",
                      ("Pass more characters of the commit hash.",)),
    "NOT_A_COMMIT": ("The reference names a working set, not a commit.",
                     ("Pass a market commit, tag or branch.",)),
    "MARKET_COMMIT_INVALID": ("The value is not a resolved 32-character market commit hash.",
                              ("Resolve the reference first (`market coverage --at <ref>` prints the commit) and "
                               "pass the hash.",)),
    "MARKET_COMMIT": ("The export's market reference does not resolve to a commit of the market database.",
                      ("Pass a commit, tag or branch of the market database named by --market.",)),
    "MONTH_INVALID": ("The month is not YYYY-MM, lies after the current UTC month or has no closed day yet, or is "
                      "neither the latest stored month, the month after it nor the month just before the earliest.",
                      ("Import the month after the latest or the month before the earliest, one `market import "
                       "--month YYYY-MM` each.",)),
    "MONTH_EXISTS": ("The market database already holds that month through its end, the sources reread for the "
                     "month's stored part differ from the stored rows, or a month to backfill already holds rows.",
                     ("Import the next month or the month before the earliest; a stored month is never rewritten.",)),
    "RULE_VERSION_MISMATCH": ("The market database produces another universe rule version, or holds quotes of another "
                              "quote rule version, than this code.",
                              ("Use the product version of that rule; a new rule needs a new market database.",)),
    "SEQUENCE_GAP": ("An aggTrades archive's agg_trade_id sequence is not contiguous within the day or does not continue "
                     "the day before (the trades import keeps an id Binance repeated for a distinct later trade), so "
                     "that month's trades or inferred quotes cannot be trusted; nothing was stored.",
                     ("Re-download the day with the refused command (`market import-trades` or `market import-quotes` "
                      "--month YYYY-MM) after clearing its cached archive; a gap the exchange published stays a gap and "
                      "the month stays unimported.",)),
    "UNIVERSE_UNKNOWN": ("The month has no universe members in the market database and no --symbols were named.",
                         ("Import the month's bars first (`market import --month YYYY-MM`) or name --symbols.",)),
    "TERMS_UNKNOWN": ("The market database holds no contract terms for a symbol the quote import needs (the price "
                      "increment that pushes a stale side).",
                      ("Import the contract's bars first; terms come from the bar import's exchangeInfo observation.",)),
    "IMPORT_SCOPE": ("The engineering symbol allowlist is empty, repeats or malforms a contract, differs from the "
                     "scope of the earlier imports.",
                     ("Import every month of a market database with the scope its first import set; a different "
                      "scope is a new market database.",)),
    "UNIVERSE_CHANGED": ("The universe recomputed from the stored data differs from a stored month.",
                         ("Report the month and contracts named; stored months are never rewritten.",)),
    "DATA_TESTS_FAILED": ("A market commit test (dolt_tests, group commit) failed at DOLT_COMMIT; the import was "
                          "rolled back.",
                          ("Report the failed test named; the import stops rather than commit inconsistent data.",)),
    "CONCURRENT_IMPORT": ("Another import of this market database holds its import lock.",
                          ("Wait for the running import to finish, then rerun the same `market import`.",)),
    "MARKET_EMPTY": ("The market commit holds no universe month yet (the first imported month has none).",
                     ("Import the next month with `market import`.",)),
    "ARCHIVE_NOT_PUBLISHED": ("The exchange has not published that archive or its checksum.",
                              ("Nothing to repair: the import takes the daily archives or public REST instead.",)),
    "CHECKSUM_MISMATCH": ("An archive's SHA-256 differs from the .CHECKSUM the exchange published beside it.",
                          ("Rerun the import (the archive is downloaded again); report the archive if it persists.",)),
    "SOURCE_CONFLICT": ("Two sources hold the same minute or funding time with different values.",
                        ("Report the contract, price type and time named; the import stops rather than choose.",)),
    "SOURCE_SHAPE": ("A source gave a bar off the minute grid, a row that does not parse or a malformed request.",
                     ("Rerun the import after the cache is refreshed; report the archive if it persists.",)),
    "SOURCE_UNREACHABLE": ("An exchange archive or public endpoint stayed unreachable or throttled after retries.",
                           ("Rerun the same import later; nothing was committed.",)),
    "SOURCE_UNKNOWN_SYMBOL": ("The public endpoint does not know a contract the exchange lists as trading.",
                              ("Report the contract named; rerun the import once exchangeInfo and the endpoint "
                               "agree.",)),
    "PRICE_TYPE_UNKNOWN": ("The price type is neither LAST nor MARK.",
                           ("Stitch LAST or MARK series only.",)),
    "SCALE_RANGE": ("A price or volume does not fit the market database's integer scale.",
                    ("Report the contract named; the scale is fixed for the database's generation.",)),
    "SCALE_LOSS": ("A price or volume has more decimals than the market database's scale holds.",
                   ("Report the contract named; values are never rounded on import.",)),
    "QUOTE_INEXACT": ("A stored quote price does not fit the instrument's price precision at export.",
                      ("Report the contract named; the quote table and the instrument terms disagree.",)),
    "TRADE_INEXACT": ("A stored aggregate trade's price or quantity does not fit the instrument's precisions at export.",
                      ("Report the contract named; the agg_trade table and the instrument terms disagree.",)),
    "QUOTES_UNSORTED": ("The stored quotes of a contract do not come out of the market database in time order.",
                        ("Report the contract named; the exporter never reorders quotes.",)),
    "GRID_MISALIGNED": ("Bar times are not strictly increasing on the timeframe's grid.",
                        ("Pass bars read from the market database at one commit.",)),
    "TIMEFRAME_UNKNOWN": ("The timeframe is not one of 1m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 1w.",
                          ("Use a timeframe of the fixed list.",)),
    "INPUT_UNSORTED": ("The minute bars to derive from are not strictly increasing whole minutes.",
                       ("Pass bars read from the market database at one commit.",)),
    "VOLUME_OVERFLOW": ("A derived bar's volume would exceed BIGINT.",
                        ("Report the contract and timeframe named; derivation never truncates.",)),
    "PRECISION_INVALID": ("A precision given to the derived-bar comparison is negative.",
                          ("Pass the contract's price and size decimals.",)),
    "UNIVERSE_RULE_UNKNOWN": ("The universe rule version is not built into this code.",
                              ("Use the rule version the market database records.",)),
    "EXCHANGE_INFO_MALFORMED": ("An exchangeInfo contract lacks its contract type, underlying type or base asset, or "
                                "names another contract.",
                                ("Rerun the import; report the contract if exchangeInfo keeps the shape.",)),
    "MONTH_NOT_FIRST_DAY": ("A universe month is not a UTC month start, or the months are out of order.",
                            ("Pass month starts, the first not after the last.",)),
    "TRADING_DAYS_INSUFFICIENT": ("The trading days do not cover the listing-age look-back before the first month "
                                  "through the day before the last.",
                                  ("Compute the universe only from the month after the first stored month on.",)),
    "UNIVERSE_EMPTY_AT_COMMIT": ("The market commit holds no universe month.",
                                 ("Import the next month with `market import`, then pin the new commit.",)),
    "UNIVERSE_NOT_COVERING_WINDOW": ("The market commit's last universe month ends before the replay window.",
                                     ("Import the window's months, or end the window within the produced months.",)),
    "NO_TERMS": ("The market commit holds no exchange terms for the contract.",
                 ("Export only contracts the commit holds terms for.",)),
    "TERMS_INVALID": ("A contract's stored increments are not positive decimals, or a lower bound exceeds its upper one.",
                      ("Report the contract named; terms are stored as the exchange published them.",)),
    "PRECISION_NARROWED": ("The export asked for a price precision narrower than the exchange's increment.",
                           ("Export with at least the increment's decimals; precision is only widened.",)),
    "UNSUPPORTED_QUOTE": ("The contract does not settle in USDT.",
                          ("Export USDT perpetuals only.",)),
    "SYMBOL_SHAPE": ("The contract name does not end in USDT or holds an engine separator (- or .).",
                     ("Export USDT perpetuals by their public names.",)),
    "EPISODE_INDEX": ("A lifecycle episode number is not a positive integer.",
                      ("Number episodes 1, 2, ... in time order.",)),
    "EPISODE_SHAPE": ("A lifecycle episode lacks start_ns or native events, or its instrument ID is not the "
                      "numbered native ID SYMBOL-E<n>-PERP.BINANCE.",
                      ("Fix the lifecycle manifest and write a new bundle with `market lifecycle`.",)),
    "EPISODE_ORDER": ("A contract's lifecycle episodes overlap or are not in time order.",
                      ("Fix the lifecycle manifest and write a new bundle with `market lifecycle`.",)),
    "BARS_UNSORTED": ("Exported bar closes are not strictly increasing.",
                      ("Report the contract named; the market database is inconsistent.",)),
    "BAR_RAW_INEXACT": ("A bar price or volume is not exact at the instrument's precision.",
                        ("Report the contract named; the exporter never rounds.",)),
    "MARK_UNSORTED": ("Exported mark price times are not strictly increasing.",
                      ("Report the contract named; the market database is inconsistent.",)),
    "MARK_INEXACT": ("A mark price is not exact at the precision it is written with.",
                     ("Report the contract named; the exporter never rounds.",)),
    "FUNDING_UNSORTED": ("A contract's funding settlement times are not strictly increasing.",
                         ("Report the contract named; the market database is inconsistent.",)),
    "FUNDING_RATE_SHAPE": ("A funding rate is not a finite decimal.",
                           ("Report the contract named; the market database is inconsistent.",)),
    "EXPORT_WINDOW": ("The export window is not a positive whole-minute interval.",
                      ("Pass a window whose start and end lie on whole minutes, start before end.",)),
    "EXPORT_SCOPE": ("The export contract list is empty or repeats a contract.",
                     ("Pass each contract once.",)),
    "INTERVAL_INVALID": ("The input interval is not explicit UTC on whole minutes with start before end.",
                         ("Pass --start and --end as UTC times on whole minutes, start before end.",)),
    "EMPTY_SYMBOLS": ("The contract list is empty or repeats a contract.",
                      ("Pass each contract once, or none to take the universe of the interval's months.",)),
    "UNKNOWN_SYMBOL": ("The contract is not an instrument of that market commit.",
                       ("List the commit's contracts with `market coverage` over the universe.",)),
    "MARKET_RETURNS_WINDOW": ("The window for the market's daily returns holds no whole UTC day.",
                              ("Report market measures only for runs with a whole trading day.",)),
    # Paper runs (ledger/paper.py, paper/runs.py)
    "PAPER_RUN_UNKNOWN": ("The ledger holds no paper run of that ID.",
                          ("List the runs with `paper list`.",)),
    "PAPER_RUN_ACTIVE": ("The candidate already has a running paper run, the run to seal is still running, or the "
                         "run to delete is not sealed yet.",
                         ("Stop it with `paper stop --paper-id N`, which also seals it.",)),
    "PAPER_CONCURRENCY_LIMIT": ("The ledger already has the most paper runs running at once.",
                                ("Stop a running one with `paper stop --paper-id N`, then start again.",)),
    "PAPER_START_FAILED": ("The run was declared but its containers did not start; it is sealed invalid with the "
                           "error in runner.log.",
                           ("Read the error, repair the runtime or Docker, then start a new run.",)),
    # Paper reconciliation (paper/reconcile.py)
    "PAPER_RECONCILE_EMPTY": ("The sealed run's capture names no input start or stop, or it stopped before its first "
                              "bar closed: there is no interval to replay.",
                              ("Reconcile a run that received at least one bar.",)),
    "PAPER_RECONCILE_UNCOVERED": ("The market commit does not hold every minute of the run's interval yet.",
                                  ("Import the run's month with `market import --month YYYY-MM` over the market's "
                                   "contract scope once its days are archived, then reconcile at the new commit.",)),
}


# The market package's codes that share a name with a ledger code but refuse a market reference: their
# meaning and repair when a market refusal is printed (`cli.main._market_refusal`).
MARKET_CATALOGUE: dict[str, tuple[str, tuple[str, ...]]] = {
    "UNKNOWN_REF": ("The reference names no branch, tag or commit in the active market database's history.",
                    ("Pass a commit, tag or branch of the active market database; `market coverage` without --at "
                     "prints its head as commit.",
                     "A commit outside that history (an earlier market database's) cannot be read here: runs and "
                     "lines pinned to it do not replay against this market database.")),
}


def refusal_catalogue(code: str) -> dict:
    """The meaning and repair commands of a refusal code."""
    message, next_actions = CATALOGUE[code]
    return {"message": message, "next_actions": list(next_actions)}


def refuse(code: str, message: str, *, missing: tuple[str, ...] = (), expected: str | None = None,
           write_status: Literal["not_written", "unknown", "written"] = "not_written",
           operation_id: str | None = None) -> Refusal:
    """A refusal whose repair commands come from the catalogue (an unknown code is a KeyError)."""
    return refusal(code, message, missing=missing, write_status=write_status, operation_id=operation_id,
                   expected=expected, next_actions=CATALOGUE[code][1])
