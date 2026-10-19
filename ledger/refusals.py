"""The refusal catalogue (`ledger.refusal_catalogue`): one meaning and repair per refusal code.

The repairs are the commands that supply what is missing; none is a way around a check. Every
code a function of this package raises is listed here; a test walks every raise site.
"""

from __future__ import annotations

from typing import Literal

from ledger.errors import Refusal, refusal


_RERUN = "Rerun the same command; writes are idempotent by operation ID."

CATALOGUE: dict[str, tuple[str, tuple[str, ...]]] = {
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
                        ("Use the product version that matches the ledger's schema generation.",)),
    "INVALID_NAME": ("A profile, database or branch name is malformed, or the kind is unknown.",
                     ("Use letters, digits, hyphens and underscores, and kind active, isolated or temporary.",)),
    "LEDGER_EXISTS": ("A profile of that name, the active research ledger, or that database already exists.",
                      ("Choose another profile and database name; existing ledgers are never replaced.",)),
    "ISOLATION_BREACH": ("A test ledger reuses the active database name, or the active ledger would live in the "
                         "source checkout or a temporary root (or lacks its backup directory).",
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
    # Paths
    "NOT_TEMPORARY_PATH": ("The path is not strictly under a temporary root.",
                           ("Pass a new directory under /tmp (or the platform temporary directory).",)),
    "PATH_EXISTS": ("The working path already exists; working copies are always new.",
                    ("Pass a path that does not exist yet.",)),
    # Evidence
    "INVALID_BUNDLE_NAME": ("The bundle name is not of the form [A-Za-z0-9][A-Za-z0-9_.-]{0,159}.",
                            ("Rename the bundle within the allowed characters and length.",)),
    "RESERVED_BUNDLE": ("The bundle name lies in a product namespace (trial-<id>-execution(-start), "
                        "trial-<id>-recovery(-*), registration-*, source-review-*, research-line-<n>, "
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
                ("Write the reference as strategy_id@N, for example rsi@3.",)),
    "UNKNOWN_CANDIDATE": ("The ledger version read holds no candidate of that reference.",
                          ("List candidates with `candidate list`.",)),
    "SOURCE_EXISTS": ("These exact source bytes are already a candidate.",
                      ("Use the existing candidate named in the message, or change the source.",)),
    # Research lines
    "START_NOT_FOUND": ("The start candidate of the research line does not exist.",
                        ("Publish the start with `candidate publish`, then select the line again.",)),
    "MARKET_COMMIT_UNRESOLVED": ("The market reference resolves to no unique commit with a universe rule.",
                                 ("Pass a market commit, tag or branch shown by `market coverage`.",)),
    "WINDOW_INVALID": ("A window does not start before it ends, or a trial's warm-up start is after its trading "
                       "start or not on a whole UTC minute.",
                       ("Pass a window whose start precedes its end (and, for a replay, a whole-minute warm-up "
                        "start no later than the trading start).",)),
    "WINDOW_OUT_OF_COVERAGE": ("The development window ends after the market commit's latest complete day.",
                               ("End the window at most one day after the latest complete day, or pin a newer "
                                "market commit.",)),
    "LINE_CONFLICT": ("A research line of that number already exists with other content.",
                      ("Read the current line with `research state`, then select again.",)),
    "LINE_CORRUPT": ("The research line record is missing from its bundle or no longer matches its hash.",
                     ("Run `ledger review`; select a new line with `line select`.",)),
    "LINE_FORMAT_UNSUPPORTED": ("The research line record is not a research-line-v1 record.",
                                ("Select a new line with `line select`.",)),
    "LINE_UNKNOWN": ("The research line bundle does not exist or is not a research-line-* bundle.",
                     ("Read the current line with `research state`; select one with `line select`.",)),
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
    "NOT_A_CHECKOUT": ("The metrics code is not in a Git checkout, so no metrics revision can be recorded.",
                       ("Run the product from its Git checkout.",)),
    "UNKNOWN_RUN": ("The ledger version read holds no run of that ID.",
                    ("List runs with `research status`.",)),
    "REPORT_UNREADABLE": ("A native report file exists but is not UTF-8 CSV, JSON or gzip as the runner writes it.",
                          ("Replay again into a new directory; report the runner if it persists.",)),
    # Replays (replay/)
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
    "CADENCE_REQUIRED": ("cadence_trials is required exactly for review_cadence judgments.",
                         ("Give --cadence-trials N for review_cadence and omit it otherwise.",)),
    "REVIEW_CADENCE_RAISED": ("A review cadence may only be lowered when superseded.",
                              ("Supersede it with a cadence no larger than the current one.",)),
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
    "METRIC_UNSUPPORTED": ("The comparison metric has no defined paired inference; only annual_return has one.",
                           ("Register metric annual_return.",)),
    "RESEARCH_LINE_REQUIRED": ("The ledger has no research line record, so the window cannot be checked.",
                               ("Select a research line with `line select`, then register.",)),
    "WINDOW_MISMATCH": ("The registered window differs from the research line's development window, or a "
                        "validation trial's window is not inside its registered window or does not start after "
                        "it ends.",
                        ("Register the research line's window exactly (read it with `research state`); replay a "
                         "validation only inside its registered window after it has ended.",)),
    "CONFIG_MISMATCH": ("A grid point's runtime contract differs from the execution identity, or a validation's "
                        "account terms differ from the candidate's latest valid research run (or it has none).",
                        ("Publish the grid for the probed runtime contract; replay the candidate's research run "
                         "under the validation's runtime first.",)),
    "SOURCE_ALREADY_EXPOSED": ("A grid source was already run by a replay that is not the cited precheck (of at "
                               "most seven trading days), and no registration on the retry_of chain consumed it.",
                               ("Register a new source, or set retry_of to the registration that consumed this "
                                "source.",)),
    "DUTY_UNKNOWN": ("changed_duties names a duty outside the 27, or is nonempty for a root or empty for a derived "
                     "registration.",
                     ("Use duty IDs A1 to I2 from the duty directory; leave changed_duties empty only for a root.",)),
    "PREDICTION_INVALID": ("A prediction names a duty outside changed_duties or a slice or measure outside the "
                           "measure catalogue, has an empty slice without a reason, or a changed duty has no "
                           "prediction.",
                           ("Write at least one prediction per changed duty on a catalogue slice and measure (or an "
                            "empty slice with a reason).",)),
    "INTERPRETATION_REQUIRED": ("A completed research trial of the line has no interpretation judgment.",
                                ("Add an interpretation with `judgment add --kind interpretation` about the trials "
                                 "the message lists.",)),
    "REVIEW_DUE": ("The research trials since the last recommendation reached the review cadence.",
                   ("Review the line and add a recommendation with `judgment add --kind recommendation`.",)),
    "REVIEW_CADENCE_REQUIRED": ("A derived registration needs a review cadence on the line first.",
                                ("Declare one with `judgment add --kind review_cadence --cadence-trials N`.",)),
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
                       ("Write trial_id, verdict and the four items api, causal, activity, readiness, each with a "
                        "status and a note.",)),
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
                          "capture) nor invalid and has economic evidence; or the retried validation registration "
                          "does not exist, differs in candidate, window or universe rule, or was never bound.",
                          ("Retry only attempts whose replay was interrupted, invalid or without economic "
                           "evidence; a poor result is no reason to retry.",)),
    "REGISTRATION_UNKNOWN": ("The validation registration does not exist.",
                             ("List validation registrations with `research status`.",)),
    "REGISTRATION_CONSUMED": ("The validation registration was already bound, or the trial is bound to another "
                              "registration.",
                              ("Register a new validation; a bound registration stays consumed.",)),
    "STALE_CHECKOUT": ("The product checkout is dirty, lacks the latest main commit, or cannot prove either.",
                       ("Commit or remove local changes and update to origin/main, then rerun.",)),
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
    "EXPORT_PATH_INVALID": ("The export destination lies inside the ledger service directory or a Git work tree, or "
                            "exists and is no export of this ledger.",
                            ("Choose a new directory outside the service directory and any checkout, or this ledger's "
                             "earlier export.",)),
    "DOLT_BACKUP": ("The full-history backup could not be synced or restored, or its head differs from the ledger "
                    "head after the sync.",
                    ("Check the backup directory and the ledger service, then export again.",)),
    # Reports (report/)
    "MARKET_RETURNS_UNAVAILABLE": ("The market's daily returns for the run's market commit and window could not be "
                                   "read; only the market measures are empty.",
                                   ("Make the market database profile available (read only), then read the report "
                                    "again.",)),
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
    "INVALID_QUERY": ("The identity query is empty, names a dimension other than runtime, effective_config and input, "
                      "or a runtime key outside image_digest, runtime_contract, engine_version and "
                      "dependency_lock_sha256.",
                      ("Give at least one of the three dimensions with only their keys.",)),
    "RUN_IDENTITY_MISSING": ("A sealed run lacks its runtime image, effective configuration or input identity.",
                             ("Run the whole review (`ledger review`); the run's identity cannot be compared.",)),
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
                            ("Check the image reference and the container runtime, then rerun.",)),
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
    "WRITE_VIA_SQL": ("`ledger sql` runs exactly one read-only SELECT, SHOW, DESCRIBE or WITH statement.",
                      ("Write only through the declared commands; read with one SELECT.",)),
    "PRECHECK_NOT_FOUND": ("The trial is no native precheck of this candidate's source on this runtime image.",
                           ("Run `replay precheck` for the candidate on the image, then review that trial.",)),
    "RUNTIME_UNRESOLVED": ("The runtime reference does not resolve to an image digest.",
                           ("Pass the image the precheck ran on, by tag or digest.",)),
    "BACKUP_TARGET_UNSET": ("The ledger profile declares no backup directory.",
                            ("Export with `ledger export --kind reproduce --output <new directory>`.",)),
    "EXPORT_MISMATCH": ("The written export manifest does not reread to the exported content hash; the "
                        "incomplete copy was removed.",
                        ("Rerun the same export; report the disk if it persists.",)),
    "LEDGER_NOT_INITIALIZED": ("The service directory holds no initialized ledger of this profile.",
                               ("Initialize it with `ledger init` (or `ledger temp` for a test ledger).",)),
    "SERVICE_START_FAILED": ("The service started but the ledger did not answer; the service was stopped.",
                             ("Inspect the service log in the service directory, then rerun `ledger service start`.",)),
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
                            "--market.",)),
    "SCHEMA_VERSION_MISMATCH": ("The market database's schema generation is not the one this code reads.",
                                ("Use the product version that matches the market database's schema generation.",)),
    "MARKET_SCHEMA": ("The market database was written under another schema generation, scale or universe rule.",
                      ("Import into a market database of this generation and rule.",)),
    "MARKET_PERMISSION": ("The market account may not run this statement.",
                          ("Import only through `market import`; read with the reader account.",)),
    "MARKET_SQL_ERROR": ("The market database refused a statement; nothing was committed.",
                         ("Rerun the same command; report the statement if it persists.",)),
    "AMBIGUOUS_REF": ("The hash prefix matches more than one market commit.",
                      ("Pass more characters of the commit hash.",)),
    "NOT_A_COMMIT": ("The reference names a working set, not a commit.",
                     ("Pass a market commit, tag or branch.",)),
    "MONTH_INVALID": ("The month is not YYYY-MM, lies after the current UTC month, or leaves a gap after the stored "
                      "months.",
                      ("Import the months in order, one `market import --month YYYY-MM` each.",)),
    "MONTH_EXISTS": ("The market database already holds that month through its end (or through today).",
                     ("Import the next month; a stored month is never rewritten.",)),
    "POOL_CHANGED": ("The universe recomputed from stored volumes differs for a stored month.",
                     ("Report the month and contracts named; stored months are never rewritten.",)),
    "SOURCE_CONFLICT": ("Two sources hold the same minute or funding time with different values.",
                        ("Report the contract, price type and time named; the import stops rather than choose.",)),
    "SOURCE_SHAPE": ("A source gave a bar off the minute grid or a row that does not parse.",
                     ("Rerun the import after the cache is refreshed; report the archive if it persists.",)),
    "SCALE_RANGE": ("A price or volume does not fit the market database's integer scale.",
                    ("Report the contract named; the scale is fixed for the database's generation.",)),
    "SCALE_LOSS": ("A price or volume has more decimals than the market database's scale holds.",
                   ("Report the contract named; values are never rounded on import.",)),
    "NO_TERMS": ("The market commit holds no exchange terms for the contract.",
                 ("Export only contracts the commit holds terms for.",)),
    "EXPORT_WINDOW": ("The export window is not a positive whole-minute interval.",
                      ("Pass a window whose start and end lie on whole minutes, start before end.",)),
    "EXPORT_SCOPE": ("The export contract list is empty or repeats a contract.",
                     ("Pass each contract once.",)),
    "FUNDING_UNSORTED": ("A contract's funding settlement times are not strictly increasing.",
                         ("Report the contract named; the market database is inconsistent.",)),
    "INTERVAL_INVALID": ("The input interval is not explicit UTC on whole minutes with start before end.",
                         ("Pass --start and --end as UTC times on whole minutes, start before end.",)),
    "INPUT_SHAPE": ("Bar open times given to a coverage reading are not whole, strictly increasing minutes.",
                    ("Read the bars from the market database at one commit.",)),
    "EMPTY_SYMBOLS": ("The contract list is empty or repeats a contract.",
                      ("Pass each contract once, or none to take the universe of the interval's months.",)),
    "UNKNOWN_SYMBOL": ("The contract is not an instrument of that market commit.",
                       ("List the commit's contracts with `market coverage` over the universe.",)),
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
