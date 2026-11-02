import { useEffect, useState } from "react";

const TYPE = 32, ERASE = 14, HOLD = 1800, REST = 450;  // ms: a letter typed, a letter erased, the pause typed out, the pause empty
const CARET = "ml-px inline-block h-[1.1em] w-0.5 align-[-0.2em]";
const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A status line. While `busy` it types itself out behind a blinking caret in its own colour, holds,
 *  erases and types again; a new text starts from empty. Not busy, or under reduced motion, it shows whole
 *  and still. The whole line and its caret, kept invisible, hold the width, so the typed letters grow from
 *  its left edge and a centred line stays put. */
export function Typing({ text, busy, className = "" }: { text: string; busy: boolean; className?: string }) {
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
    <p role="status" aria-label={text} className={`relative ${className}`}>
      <span aria-hidden className="invisible">{text}{moving && <i className={CARET} />}</span>
      <span aria-hidden className="absolute inset-0">
        {text.slice(0, shown)}{moving && <i className={`caret ${CARET} bg-current`} />}
      </span>
    </p>
  );
}
