import { MISSING } from "../lib/format";

/** A value that is not there: a plain hyphen, fainter than the values around it. */
export const Missing = () => <span className="text-fg-ghost">{MISSING}</span>;
