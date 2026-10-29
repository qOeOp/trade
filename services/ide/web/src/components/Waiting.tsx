import { useEffect, useState } from "react";

const TYPE = 32, ERASE = 14, HOLD = 1800, REST = 450;  // ms: a letter typed, a letter erased, the pause typed out, the pause empty
const CARET = "ml-px inline-block h-[1.1em] w-0.5 align-[-0.2em]";
const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The one line in the middle of a served page before there is a view to draw. While `busy` it types
 *  itself out behind a blinking caret, holds, erases and types again; a new text starts from empty.
 *  A failure (not busy) and reduced motion show it whole and still. The whole line and its caret, kept
 *  invisible, hold the width, so the typed letters grow from its left edge and the centred line stays put.
 *  `choices`, under a failure, are the links that lead past it (the open lines to draw). */
export function Waiting({ text, busy, choices }: { text: string; busy: boolean; choices?: { label: string; href: string }[] }) {
  const moving = busy && !still();
  const [shown, setShown] = useState(moving ? 0 : text.length);
  useEffect(() => {
    if (!moving) { setShown(text.length); return; }
    let n = 0, step = 1, timer = 0;
    const tick = () => {
      n += step;
      setShown(n);
      if (n >= text.length) step = -1;
      else if (n <= 0) step = 1;
      timer = window.setTimeout(tick, n >= text.length ? HOLD : n <= 0 ? REST : step > 0 ? TYPE : ERASE);
    };
    setShown(0);
    timer = window.setTimeout(tick, REST);
    return () => window.clearTimeout(timer);
  }, [text, moving]);
  return (
    <div className="grid h-full place-items-center bg-frame p-6">
      <div className="max-w-xl">
        <p role="status" aria-label={text} className={`relative text-value ${busy ? "text-fg-muted" : "text-fg"}`}>
          <span aria-hidden className="invisible">{text}{moving && <i className={CARET} />}</span>
          <span aria-hidden className="absolute inset-0">
            {text.slice(0, shown)}{moving && <i className={`caret ${CARET} bg-fg-muted`} />}
          </span>
        </p>
        {choices && (
          <ul className="mt-3 grid gap-1.5 text-value">
            {choices.map((c) => <li key={c.href}><a className="text-fg underline underline-offset-3 hover:text-fg-muted" href={c.href}>{c.label}</a></li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
