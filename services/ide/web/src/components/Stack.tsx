import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { Icon } from "../icons/Icon";
import { Tip } from "./Tip";

const SWIPE = 40;   // px of sideways swipe that turns one card
const PAUSE = 320;  // ms after a turn before a swipe can turn the next

/** A stack of cards, as a phone's widget stack: the front card in full and up to two more edging out
 *  under it, so the stack's depth shows at a glance. A sideways swipe over it, or ↑ ↓ while it has
 *  focus, brings the next card or the one before to the front (the wheel's up and down stay the page's); "2 of 5" (`front` places it) opens every card
 *  as a list to pick from; `badge` marks it when a card behind needs a look, and `hint` says why. */
export function Stack({ count, at, onAt, label, front, list, badge, hint }: {
  count: number; at: number; onAt: (i: number) => void; label: string; badge?: ReactNode; hint?: string;
  front: (pager: ReactNode) => ReactNode; list: (close: () => void) => ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const step = useRef<(by: number) => void>(() => {});
  step.current = (by: number) => { if (count > 1) onAt((at + by + count) % count); };
  useEffect(() => {
    const el = host.current!;
    const turn = { travel: 0, last: 0 };
    const wheel = (e: WheelEvent) => {
      if (count < 2 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const now = performance.now();
      if (now - turn.last < PAUSE) return;
      turn.travel += e.deltaX;
      if (Math.abs(turn.travel) >= SWIPE) { step.current(Math.sign(turn.travel)); turn.travel = 0; turn.last = now; }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [count]);

  const pager = count > 1 && (
    <Tip content={hint}>
    <Popover.Trigger aria-label={`${label}: all ${count}${hint ? ` · ${hint}` : ""}`}
                     className="inline-flex h-7 shrink-0 items-center gap-1 rounded-control pl-2 pr-1.5 text-small tabular-nums text-fg-muted outline-none transition-colors hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-pressed data-[state=open]:text-fg">
      {badge && <span className="mr-0.5 inline-flex">{badge}</span>}{at + 1} of {count}<Icon name="chevron-down" size={12} />
    </Popover.Trigger>
    </Tip>
  );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div ref={host} role="group" aria-label={label} tabIndex={-1} className="relative shrink-0 pb-2.5 outline-none"
             onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); step.current(e.key === "ArrowDown" ? 1 : -1); } }}>
          {count > 2 && <span aria-hidden className="absolute inset-x-5 bottom-0 h-8 rounded-island bg-stack-2 ring-1 ring-inset ring-line" />}
          {count > 1 && <span aria-hidden className="absolute inset-x-2.5 bottom-1.25 h-8 rounded-island bg-stack-1 ring-1 ring-inset ring-line" />}
          <div key={at} className="relative animate-stack-in rounded-island bg-island ring-1 ring-card-border">{front(pager)}</div>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content side="bottom" align="end" sideOffset={4} collisionPadding={8}
                         className="z-50 flex max-h-[min(440px,var(--radix-popover-content-available-height))] w-90 flex-col gap-px overflow-auto rounded-popup border border-popup-border bg-popup p-1 shadow-popup outline-none">
          {list(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
