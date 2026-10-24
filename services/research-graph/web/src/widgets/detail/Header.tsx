import type { ReactNode } from "react";
import type { Candidate } from "../../model/types";
import { PREDICTION, ROLE } from "../../model/semantics";
import { when } from "../../lib/format";
import { Icon } from "../../icons/Icon";
import { RoleMark } from "../../icons/marks";
import { requestFocus } from "../../state/linking";
import { select } from "../../state/selection";
import { TextButton } from "../../components/TextButton";
import { Tip } from "../../components/Tip";

const PREDICTION_TEXT = { meets: "text-meets", misses: "text-misses", "fg-muted": "text-fg-muted", "fg-faint": "text-fg-faint" } as const;

/** The selected version's card: mark and name, role, prediction verdict, when it was published, its
 *  parent; its readings follow in the same card. */
export function Header({ c, children }: { c: Candidate; children?: ReactNode }) {
  const role = c.status ?? null;
  return (
    <header className="rounded-popup bg-island-alt px-3 pt-2.5">
      <div className="flex items-center gap-2">
        <RoleMark role={role} size={16} />
        <h2 className="min-w-0 truncate font-mono font-semibold">{c.id}</h2>
        <TextButton className="ml-auto shrink-0 text-small text-fg-faint" onClick={() => requestFocus(c.id)}>在图中定位</TextButton>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-dense text-fg-faint">
        <Tip content={role ? ROLE[role].hint : undefined}><span className="text-fg-muted">{role ? ROLE[role].label : "-"}</span></Tip>
        <span className={PREDICTION_TEXT[PREDICTION[c.prediction_class].tone]}>{PREDICTION[c.prediction_class].label}</span>
        <span className="font-mono">{when(c.created_at)}</span>
        {c.parent && (
          <TextButton className="font-mono" onClick={() => { const p = c.parent!; select(p, { reveal: true }); }}>
            <Icon name="arrow-up" size={12} />{c.parent}
          </TextButton>
        )}
      </div>
      <div className="mt-2.5">{children}</div>
    </header>
  );
}
