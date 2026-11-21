import { useEffect, useRef, useState, type ReactNode } from "react";
import { wash } from "../theme/roles";

const MS = 1500;

/** A button that acts only once held for 1.5 seconds: a lighter fill grows across it while held, counting down what is
 *  left, and letting go, moving off it or a second finger cancels. A key press (Enter or Space) held as long
 *  acts too. For an urgent, irreversible action on a phone, after a sheet has said what it does. */
export function HoldButton({ onHeld, disabled = false, children }: { onHeld: () => void; disabled?: boolean; children: ReactNode }) {
  const [left, setLeft] = useState<number | null>(null), timer = useRef<number | null>(null), started = useRef(0);
  const stop = () => { if (timer.current !== null) cancelAnimationFrame(timer.current); timer.current = null; setLeft(null); };
  const tick = () => {
    const rest = MS - (performance.now() - started.current);
    if (rest <= 0) { stop(); onHeld(); return; }
    setLeft(rest);
    timer.current = requestAnimationFrame(tick);
  };
  const start = () => {
    if (disabled || timer.current !== null) return;
    started.current = performance.now();
    timer.current = requestAnimationFrame(tick);
  };
  useEffect(() => stop, []);
  const done = left === null ? 0 : 1 - left / MS;
  return (
    <button type="button" disabled={disabled} aria-label={`Hold for ${(MS / 1000).toFixed(1)} seconds to confirm`}
            onPointerDown={start} onPointerUp={stop} onPointerCancel={stop}
            onPointerLeave={stop} onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); start(); } }} onKeyUp={stop}
            className="relative h-11 w-full touch-none select-none overflow-hidden rounded-control border font-semibold text-fail-fg disabled:opacity-50"
            style={{ background: wash("fail", 12), borderColor: wash("fail", 55) }}>
      <span aria-hidden className="absolute inset-y-0 left-0" style={{ width: `${done * 100}%`, background: wash("fail", 34) }} />
      <span className={`relative tabular-nums ${left === null ? "" : "text-fg"}`}>{left === null ? children : `Keep holding · ${(left / 1000).toFixed(1)} s`}</span>
    </button>
  );
}
