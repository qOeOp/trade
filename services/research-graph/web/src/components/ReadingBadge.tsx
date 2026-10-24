import type { Targets } from "../model/types";
import { tone, verdict, type Reading } from "../model/semantics";
import { pct } from "../lib/format";
import { v } from "../theme/roles";
import { Missing } from "./Missing";

// A version's two readings as one badge of fixed width: annual return and max drawdown in cells of
// fixed character width (--rb-ret, --rb-dd) with equal padding, numbers right-aligned in one face,
// size and weight, and the divider being the second cell's left border. A version without readings
// shows its status in a badge of exactly the same width. Widths resolve in the badge's own font.
const ROOT = "box-border inline-grid h-[18px] w-(--rb-w) shrink-0 overflow-hidden rounded-badge border font-mono text-badge";

export function ReadingBadge({ reading, targets, status }: { reading: Reading | null; targets: Targets | null; status?: string }) {
  if (!reading || reading.annual_return == null) {
    return <span data-part="badge" className={`${ROOT} place-items-center border-line text-fg-faint`}>{status ?? <Missing />}</span>;
  }
  const ok = verdict(reading, targets);
  return (
    <span data-part="badge" className={`${ROOT} grid-cols-[calc(var(--rb-ret)+2*var(--rb-pad))_1fr] border-line-strong bg-island`}>
      <span data-part="ret" className="px-(--rb-pad) text-right" style={{ color: v(tone(ok.ret)) }}>{pct(reading.annual_return)}</span>
      <span data-part="dd" className="border-l border-line-strong px-(--rb-pad) text-right" style={{ color: v(tone(ok.dd)) }}>
        {reading.max_drawdown == null ? <Missing /> : pct(reading.max_drawdown)}
      </span>
    </span>
  );
}
