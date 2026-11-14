import type { ReactNode } from "react";
import { Icon } from "../icons/Icon";
import { spanText, type LaunchColumn, type LaunchRow, type Mark } from "../model/liveLaunch";
import { LiveDurationField } from "./LiveDurationField";
import { Spinner } from "./Spinner";
import { MISSING } from "../lib/format";

/** A row's mark before its label, so the answer reads first: a green check or red cross for a start condition, the
 *  amber of a missed target for a row shown only, a dashed ring while unanswered, a turning ring while the service
 *  is reading it, nothing for a value with no condition. */
function RowMark({ mark, required, busy }: { mark: Mark; required: boolean; busy: boolean }) {
  if (mark === "shown") return <span aria-hidden="true" className="size-4" />;
  if (mark === "wait") return busy
    ? <Spinner size={16} still="untested" className="text-icon" />
    : <Icon name="untested" size={16} className="text-fg-faint" />;
  return mark === "pass" ? <Icon name="passed" size={16} tone="meets" />
    : <Icon name="failed" size={16} tone={required ? "fail" : "misses"} />;
}

const SAID: Record<Mark, string> = { pass: "met", fail: "not met", wait: "not answered yet", shown: "" };

/** One row: its label and value on a line (an editable value on a blue underline, the rest greyed), then where the value
 *  comes from (nothing for a value typed here) and, when it fails or waits, why and who can change that. */
function Row({ row, closed, edit, busy }: { row: LaunchRow; closed: boolean; edit?: (id: string, value: string) => void; busy: boolean }) {
  const open = row.editable && !closed && edit;
  const tone = closed ? "text-fg-faint" : row.value === null ? "text-fg-faint" : "text-fg-muted";
  const invalid = row.mark === "fail";
  const shown = row.span && row.value !== null ? spanText(row.value) ?? row.value : row.value;
  return <li className="flex gap-2 border-b border-line py-2 last:border-b-0">
    <span className="flex h-(--form-h) shrink-0 items-center" title={SAID[row.mark]}>
      <RowMark mark={row.mark} required={row.required} busy={busy && row.mark === "wait"} />
      {row.mark !== "shown" && <span className="sr-only">{`${row.label}: ${SAID[row.mark]}${row.required ? "" : ", shown only"}`}</span>}
    </span>
    <div className="min-w-0 flex-1 space-y-0.5">
      <div className="flex min-h-(--form-h) flex-wrap items-center justify-between gap-x-3">
        <span className={closed ? "text-fg-faint" : "text-fg"}>{row.label}</span>
        {open && row.span ? <LiveDurationField label={row.label} value={row.value ?? ""} invalid={invalid} onValue={(value) => edit(row.id, value)} />
          : open ? <label className="flex items-baseline whitespace-pre">
            <span className="sr-only">{row.label}</span>
            {/* No box: the value sits in the row like the greyed ones, on a blue underline that thickens while editing,
                as wide as its digits (two at least, as the duration's fields). */}
            <input value={row.value ?? ""} inputMode={row.text ? "text" : "numeric"} autoCapitalize={row.text ? "characters" : undefined} spellCheck={false}
              aria-invalid={invalid} onChange={(event) => edit(row.id, event.target.value)} style={{ width: `${Math.max(2, (row.value ?? "").length)}ch` }}
              className={`max-w-full border-0 border-b border-link bg-transparent px-0 pb-px text-right text-fg outline-none hover:bg-hover focus:border-b-2 focus:pb-0 aria-invalid:border-fail ${row.text ? "" : "tabular-nums"}`} />
            {row.unit && <span className="text-fg-faint"> {row.unit}</span>}
          </label>
          : <span className={`min-w-0 text-right tabular-nums wrap-anywhere ${tone} ${row.mono ? "font-mono" : ""}`}>
            {shown ?? MISSING}{row.value !== null && row.unit && <span className="text-fg-faint"> {row.unit}</span>}
          </span>}
      </div>
      {(row.source || row.reason) && <p className="text-small text-fg-faint">{row.source}
        {row.reason && <>{row.source && " · "}<span className={invalid && row.required && !closed ? "text-fail-fg" : "text-fg-muted"}>{row.reason}</span></>}</p>}
    </div>
  </li>;
}

/** A column of the launch page: its number and title, how many of its start conditions are met, its rows, and its
 *  own actions at the foot. */
export function LiveLaunchColumn({ column, index, closed, edit, busy = false, children }: {
  column: LaunchColumn; index: number; closed: boolean; edit?: (id: string, value: string) => void; busy?: boolean; children?: ReactNode;
}) {
  const conditions = column.rows.filter((row) => row.required && row.mark !== "shown");
  const met = conditions.filter((row) => row.mark === "pass").length;
  return <section aria-label={column.title} className="flex min-w-0 flex-1 basis-0 flex-col border-line [&+&]:border-t @3xl:[&+&]:border-t-0 @3xl:[&+&]:border-l">
    <header className="flex h-(--header-h) shrink-0 items-center gap-2 px-3 text-ui">
      <span className={`grid size-5 shrink-0 place-items-center rounded-full border text-small ${closed ? "border-line text-fg-faint" : "border-line-strong text-fg-muted"}`}>{index + 1}</span>
      <h3 className={`min-w-0 truncate font-semibold ${closed ? "text-fg-muted" : "text-fg"}`}>{column.title}</h3>
      {conditions.length > 0 && <span className="ml-auto shrink-0 text-small text-fg-faint tabular-nums">{met} of {conditions.length} met</span>}
    </header>
    <ul className="min-h-0 flex-1 px-3 @3xl:overflow-y-auto">
      {column.rows.map((row) => <Row key={row.id} row={row} closed={closed} edit={edit} busy={busy} />)}
    </ul>
    {/* One row of controls and one short line, its height kept so the footers' top rules line up across columns. */}
    {children && <footer className="flex min-h-[calc(var(--form-h)+var(--size-small)*1.4+var(--spacing)*5)] shrink-0 flex-col gap-1 border-t border-line px-3 py-2">{children}</footer>}
  </section>;
}
