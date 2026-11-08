import { useTimeZone } from "../../state/timeZone";
import type { ReactNode } from "react";
import type { Candidate } from "../../model/types";
import { PREDICTION, ROLE } from "../../model/semantics";
import { when } from "../../lib/format";
import { Icon } from "../../icons/Icon";
import { select } from "../../state/selection";
import { TextButton } from "../../components/TextButton";
import { Tip } from "../../components/Tip";

const PREDICTION_TEXT = { meets: "text-meets", misses: "text-misses", "fg-muted": "text-fg-muted", "fg-faint": "text-fg-faint" } as const;

/** The selected version's card: its name, role, prediction verdict, when it was published, its
 *  parent; its readings follow in the same card. */
export function Header({ c, children }: { c: Candidate; children?: ReactNode }) {
  const zone = useTimeZone();
  const role = c.status ?? null;
  return (
    <header className="rounded-card border border-card-border bg-island-alt px-3 pt-2">
      <h2 className="truncate font-mono text-h1 font-semibold">{c.id}</h2>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-dense text-fg-faint">
        <Tip content={role ? ROLE[role].hint : undefined}><span className="text-fg-muted">{role ? ROLE[role].label : "-"}</span></Tip>
        <span className={PREDICTION_TEXT[PREDICTION[c.prediction_class].tone]}>{PREDICTION[c.prediction_class].label}</span>
        <span>{when(c.created_at, zone)}</span>
        {c.parent && (
          // pulled out by its padding, and its arrow by the glyph's own inset, so the arrow's ink starts at
          // the line's edge where the link wraps to a line of its own, as the words above it do
          <TextButton className="-mx-1 min-w-0 max-w-full font-mono" title={c.parent} onClick={() => { const p = c.parent!; select(p, { reveal: true }); }}>
            <span className="-ml-0.5 flex"><Icon name="arrow-up" size={12} /></span><span className="truncate">{c.parent}</span>
          </TextButton>
        )}
      </div>
      <div className="mt-2">{children}</div>
    </header>
  );
}
