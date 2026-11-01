import { Typing } from "./Typing";

/** The one line in the middle of a served page before there is a view to draw, typing itself out while
 *  `busy` (Typing). `choices`, under a failure, are the links that lead past it (the open lines to draw). */
export function Waiting({ text, busy, choices }: { text: string; busy: boolean; choices?: { label: string; href: string }[] }) {
  return (
    <div className="grid h-full place-items-center bg-frame p-6">
      <div className="max-w-xl">
        <Typing text={text} busy={busy} className={`text-value ${busy ? "text-fg-muted" : "text-fg"}`} />
        {choices && (
          <ul className="mt-3 grid gap-1.5 text-value">
            {choices.map((c) => <li key={c.href}><a className="text-fg underline underline-offset-3 hover:text-fg-muted" href={c.href}>{c.label}</a></li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
