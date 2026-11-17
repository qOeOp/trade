// Whether a paper run can come back after it stops without a seal. A run resumes only from a complete native
// checkpoint of a source that declares Paper recovery (engine/README.md); the daemon tries each interrupted
// run itself and keeps the last refusal on the run (paper/serve.py recovery_failures).
import type { PaperRun } from "../lib/paperApi";

/** The resume refusals a later try can pass (paper/runs.py resume, paper/recovery.py): another operation or run
 *  in the way, or the hourly limit. Every other PAPER_RECOVERY_UNAVAILABLE stays so: no complete native
 *  checkpoint, a dirty or changed one, a changed input, a missing container. */
const PASSING = ["another Paper lifecycle operation", "another run of this source is running", "recovery attempts per hour"];

/** Whether resuming this ended run can only be refused again: its last resume was refused for a reason that
 *  stays. Stop and seal is what is left. */
export const unresumable = (run: PaperRun): boolean =>
  run.recovery?.code === "PAPER_RECOVERY_UNAVAILABLE" && !PASSING.some((reason) => run.recovery!.message.includes(reason));

/** A running run whose source does not declare Paper recovery: after an interruption (a release, a host restart, a
 *  crash) the source does not run again. A run then holding a position is held (engine/paper.py): its stops and
 *  targets work until it is flat, and no other run of the source starts meanwhile (paper/runs.py); a flat one ends.
 *  Unknown (null) is not said. */
export const heldOnInterruption = (run: PaperRun): boolean => run.state === "running" && run.recovery_declared === false;

export const NO_RECOVERY = "The source does not declare Paper recovery; after an interruption the source does not run again: an open position keeps only its stops and targets until it is flat, and this source cannot start another run until then";
/** That mark in a few words, in the warning tone wherever it shows (run row, phone). */
export const HELD_ON_RESTART = "Held on restart";

/** The positions of a held run that no working stop protects (paper/serve.py unprotected): it stays held, and the
 *  release names each in a Telegram notice (user 2026-11-17). Empty for every other run. */
export const unprotected = (run: PaperRun): string[] => (run.unprotected ?? []).map((item) => item.position_id);
/** That mark in a few words, in the fail tone wherever it shows (run row, run page, phone). */
export const UNPROTECTED = "Unprotected position";
/** What the mark means, naming the positions. */
export const unprotectedText = (ids: readonly string[]): string =>
  `Held after an interruption, and no working stop protects ${ids.join(", ")}: the run stays held until its remaining orders close it or you stop it`;
