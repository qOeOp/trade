import type { ReactNode } from "react";
import { NextSteps } from "./NextSteps";
import { Typing } from "./Typing";

/** The one line in the middle of the page or the editor before there is a view to draw, typing itself out while
 *  `busy` (Typing). `choices`, under a failure, are the links that lead past it (the open lines to draw), `next`
 *  what the product says to do about it. */
export function Waiting({ text, busy, choices, next }: { text: string; busy: boolean; choices?: { label: string; href: string }[]; next?: string[] }) {
  return (
    <div className="grid h-full place-items-center overflow-y-auto p-6">
      <div className="max-w-xl">
        <Typing text={text} busy={busy} className={`text-value ${busy ? "text-fg-muted" : "text-fg"}`} />
        {choices && (
          <ul className="mt-3 grid gap-1.5 text-value">
            {choices.map((c) => <li key={c.href}><a className="text-fg underline underline-offset-3 hover:text-fg-muted" href={c.href}>{c.label}</a></li>)}
          </ul>
        )}
        <NextSteps steps={next} className="mt-3 text-value" />
      </div>
    </div>
  );
}

/** A page with nothing to draw: its title in the middle, and why or what to do under it. */
export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="grid h-full place-items-center p-6 text-center text-dense">
    <div className="max-w-md"><p className="font-semibold text-fg">{title}</p>{children && <p className="mt-2 text-balance text-fg-muted">{children}</p>}</div>
  </div>
);
