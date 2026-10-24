import type { Targets } from "../model/types";
import { tone, verdict, type Reading } from "../model/semantics";
import { pct } from "../lib/format";
import { v } from "../theme/roles";
import { Missing } from "./Missing";

// A version's two readings as one badge: annual return and max drawdown, each with the same fixed
// padding to the badge's edges and to the divider (the second cell's left border), so the badge is as
// wide as its numbers; one face, size and weight. A version without readings shows its status in a
// badge with the same padding.
const ROOT = "box-border inline-flex h-[18px] shrink-0 items-center overflow-hidden rounded-badge border text-badge";
const CELL = "px-(--rb-pad)";

export function ReadingBadge({ reading, targets, status }: { reading: Reading | null; targets: Targets | null; status?: string }) {
  if (!reading || reading.annual_return == null) {
    return <span data-part="badge" className={`${ROOT} border-line text-fg-faint`}><span data-part="status" className={CELL}>{status ?? <Missing />}</span></span>;
  }
  const ok = verdict(reading, targets);
  return (
    <span data-part="badge" className={`${ROOT} border-line-strong bg-island`}>
      <span data-part="ret" className={CELL} style={{ color: v(tone(ok.ret)) }}>{pct(reading.annual_return)}</span>
      <span data-part="dd" className={`${CELL} self-stretch border-l border-line-strong leading-4`} style={{ color: v(tone(ok.dd)) }}>
        {reading.max_drawdown == null ? <Missing /> : pct(reading.max_drawdown)}
      </span>
    </span>
  );
}
