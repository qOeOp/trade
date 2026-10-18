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
    "BUNDLE_EXISTS": ("A bundle of that name already exists with other content; bundles are never replaced.",
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
    "BINDING_NOT_ALLOWED": ("An exploration or precheck replay was given a registration binder.",
                            ("Run explorations and prechecks without a registration.",)),
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
    "TRIAL_NOT_FOUND": ("The trial does not exist on this ledger version.",
                        ("List trials with `research status`.",)),
    "EXECUTION_IDENTITY": ("The execution start receipt disagrees with its trial row (source, runtime identity) "
                           "or is malformed.",
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
    "EXECUTION_MISMATCH": ("The runtime, effective configuration or input identity differs from the "
                           "registration.",
                           ("Replay with the registered execution identity, or register again.",)),
    "SOURCE_PRECHECK_REQUIRED": ("The grid source lacks a matching native precheck or independent review.",
                                 ("Run `replay precheck` and record `source review` for the source.",)),
    "SOURCE_PRECHECK_FAILED": ("The precheck or independent review of the grid source did not pass.",
                               ("Fix the source, publish it and precheck it again.",)),
    "GRID_ALREADY_ATTEMPTED": ("This grid point (or validation registration) was already consumed.",
                               ("Register a new grid point; consumed attempts stay counted.",)),
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
    "RESERVED_BUNDLE_NAME": ("The registration bundle name lies in a product namespace (trial-*, knowledge-*, "
                             "research-line-*, source-review-*, lifecycle-*).",
                             ("Choose another registration bundle name, for example registration-<hypothesis>.",)),
    "DUPLICATE_BUNDLE": ("A bundle of that name already exists with another research-plan.json.",
                         ("Register under a new bundle name; registrations are never replaced.",)),
    "REGISTRATION_INVALID": ("The registration body does not have the required shape, or a record it cites (source "
                             "bundle, retry_of registration, parent, grid candidate) is not in the ledger.",
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
    "SOURCE_ALREADY_EXPOSED": ("A grid source was already run by a replay that is not an exempt precheck, and the "
                               "registration names no retry_of that consumed it.",
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
    "LIFECYCLE_INPUT": ("The lifecycle evidence bundle is missing, lacks lifecycle.json, fails its hash check or "
                        "does not validate against the pinned market commit.",
                        ("Write the lifecycle bundle for this market commit again with the market command.",)),
    # Prechecks and source reviews (registration/precheck.py)
    "REVIEW_INVALID": ("The source review body lacks or adds a field, uses a status or verdict outside the "
                       "enumeration, has an empty note or contradicts its verdict.",
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
    "RETRY_NOT_ALLOWED": ("The retried registration does not exist, differs in candidate, window or universe "
                          "rule, was never bound, or produced a valid run with economic evidence.",
                          ("Retry only a bound registration whose replay was interrupted, invalid or without "
                           "economic evidence.",)),
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
    "MEMBERSHIP_CHANGED": ("The universe rule differs, a month before registration changed between the two market "
                           "commits, a window month is missing, or a member was removed from the strategy's path.",
                           ("Replay with the registered universe rule on a market commit that keeps the registered "
                            "months and covers the window.",)),
    "COVERAGE_INCOMPLETE": ("A member's input interval has no coverage receipt.",
                            ("Export the market inputs for the whole warm-up and trading interval again.",)),
    # Runtime (the registration seam to research/records/runtime.py)
    "RUNTIME_UNAVAILABLE": ("The runtime image could not be pulled, inspected or pinned to one digest.",
                            ("Check the image reference and the container runtime, then rerun.",)),
    "RUNTIME_PROBE_INVALID": ("The runtime identity probe failed or returned an incomplete report.",
                              ("Use a runtime image built by CI for a supported runtime contract.",)),
}


def refusal_catalogue(code: str) -> dict:
    """The meaning and repair commands of a refusal code."""
    message, next_actions = CATALOGUE[code]
    return {"message": message, "next_actions": list(next_actions)}


def refuse(code: str, message: str, *, missing: tuple[str, ...] = (), expected: str | None = None,
           write_status: Literal["not_written", "unknown"] = "not_written",
           operation_id: str | None = None) -> Refusal:
    """A refusal whose repair commands come from the catalogue (an unknown code is a KeyError)."""
    return refusal(code, message, missing=missing, write_status=write_status, operation_id=operation_id,
                   expected=expected, next_actions=CATALOGUE[code][1])
