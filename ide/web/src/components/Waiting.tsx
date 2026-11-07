import { Typing } from "./Typing";

/** The one line in the middle of the page or the editor before there is a view to draw, typing itself out while
 *  `busy` (Typing). `choices`, under a failure, are the links that lead past it (the open lines to draw), `next`
 *  what the product says to do about it. */
export function Waiting({ text, busy, choices, next }: { text: string; busy: boolean; choices?: { label: string; href: string }[]; next?: string[] }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-xl">
        <Typing text={text} busy={busy} className={`text-value ${busy ? "text-fg-muted" : "text-fg"}`} />
        {choices && (
          <ul className="mt-3 grid gap-1.5 text-value">
            {choices.map((c) => <li key={c.href}><a className="text-fg underline underline-offset-3 hover:text-fg-muted" href={c.href}>{c.label}</a></li>)}
          </ul>
        )}
        {next && next.length > 0 && (
          <ul className="mt-3 grid gap-1.5 text-value text-fg-muted">
            {next.map((step) => <li key={step} className="break-words">{step}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
