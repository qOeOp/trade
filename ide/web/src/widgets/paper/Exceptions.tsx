import { Fragment, useState } from "react";
import { symbolOf, type RuntimeFailure } from "../../lib/paperApi";
import { Icon } from "../../icons/Icon";
import { TextButton } from "../../components/TextButton";
import { openSource } from "../../state/editors";

const CELL = "h-9 whitespace-nowrap px-3 last:pr-5 border-t border-line";
const HEAD = "sticky top-0 z-[1] h-8 whitespace-nowrap bg-island px-3 text-small font-normal text-fg-faint last:pr-5";
// The chevron's gutter, as Events draws it: text starts 36px in, the traceback under it.
const GUTTER = "w-6 pl-3 pr-0";

/** The total of `failures`' counts. */
export const raised = (failures: readonly RuntimeFailure[]) => failures.reduce((n, f) => n + f.count, 0);

/** "64+ errors" while the run goes (its records are rewritten at each power of two), exact once sealed. */
export const exceptionsText = (n: number, sealed: boolean) => `${n}${sealed ? "" : "+"} ${n === 1 && sealed ? "error" : "errors"}`;

/** The records of the contract the chart shows, with those of no contract; all of them on Equity. */
export const scoped = (failures: readonly RuntimeFailure[], only: string | null) =>
  failures.filter((f) => !only || !f.instrument_id.includes("-") || symbolOf(f.instrument_id) === only);

/** The exceptions the strategy raised, one row per distinct one in the order they first came: the
 *  contract, the callback it raised in, its type, how often and its message; a click opens its first
 *  traceback. Rows of the contract the chart shows (and those of no contract) when one shows. */
export function Exceptions({ failures, sealed, only, candidate }: {
  failures: readonly RuntimeFailure[]; sealed: boolean; only: string | null; candidate: string | null;
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const rows = failures.map((f, i) => ({ f, i })).filter(({ f }) => scoped([f], only).length > 0);
  if (!rows.length) return <p className="px-5 py-3 text-dense text-fg-faint">No exceptions on {only}</p>;
  const toggle = (i: number) => setOpen(new Set(open.has(i) ? [...open].filter((k) => k !== i) : [...open, i]));
  return (
    <div className="flex flex-col">
      <p className="px-5 pb-2.5 pt-2 text-dense text-fg-muted">
        Each exception ended its callback early{sealed ? "." : "; the run keeps going."}
        {!sealed && <span className="text-fg-faint"> Counts are read at 1, 2, 4, 8… until the seal.</span>}
      </p>
      <table className="w-full table-fixed border-collapse text-dense tabular-nums">
        <thead><tr>
          <th className={`${HEAD} ${GUTTER}`} />
          {!only && <th className={`${HEAD} w-28 text-left`}>Contract</th>}
          <th className={`${HEAD} w-28 text-left`}>Callback</th><th className={`${HEAD} w-40 text-left`}>Exception</th>
          <th className={`${HEAD} w-20 text-right`}>Times</th><th className={`${HEAD} text-left`}>Message</th>
        </tr></thead>
        <tbody>
          {rows.map(({ f, i }) => (
            <Fragment key={i}>
              <tr onClick={() => toggle(i)} aria-expanded={open.has(i)} className={`cursor-default ${open.has(i) ? "bg-island-alt" : "transition-colors hover:bg-row-hover"}`}>
                <td className={`${CELL} ${GUTTER} text-icon`}><span className={`grid transition-transform ${open.has(i) ? "rotate-90" : ""}`}><Icon name="chevron-right" size={12} /></span></td>
                {!only && <td className={`${CELL} truncate text-left`}>{f.instrument_id.includes("-") ? symbolOf(f.instrument_id) : <span className="text-fg-faint">{f.instrument_id}</span>}</td>}
                <td className={`${CELL} truncate text-left font-mono text-fg-muted`}>{f.stage}</td>
                <td className={`${CELL} truncate text-left font-mono`}>{f.code ?? f.exception_type}</td>
                <td className={`${CELL} text-right`}>{f.count}{sealed ? "" : "+"}</td>
                <td className={`${CELL} truncate text-left`} title={f.message}>{f.message}</td>
              </tr>
              {open.has(i) && (
                <tr className="bg-island-alt"><td colSpan={only ? 5 : 6} className="pb-3 pl-9 pr-5 pt-1">
                  <pre className="overflow-x-auto whitespace-pre font-mono text-small leading-5 text-fg-muted">{f.traceback || f.message}</pre>
                  {candidate && <TextButton className="-ml-1 mt-2 text-small text-fg-muted underline underline-offset-3" onClick={() => openSource(candidate)}>Open the source</TextButton>}
                </td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
