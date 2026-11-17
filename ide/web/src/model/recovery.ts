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

/** A running run whose source does not declare Paper recovery: an interruption (a release, a host restart, a
 *  crash) ends it. Unknown (null) is not said. */
export const endsOnInterruption = (run: PaperRun): boolean => run.state === "running" && run.recovery_declared === false;

export const NO_RECOVERY = "The source does not declare Paper recovery; an interruption ends this run";
/** That mark in a few words, in the warning tone wherever it shows (run row, phone). */
export const ENDS_ON_RESTART = "Ends on restart";
