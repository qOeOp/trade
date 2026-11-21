import { Icon } from "../icons/Icon";
import type { DataRole } from "../theme/roles";
import { Tip } from "./Tip";

/** A long note kept out of the layout: a small info icon whose tooltip says it (and whose label reads it whole to a
 *  screen reader). `tone` colours the icon when the note is about something the user should notice. */
export function InfoTip({ text, tone, label }: { text: string; tone?: DataRole; label?: string }) {
  return (
    <Tip content={text} side="bottom">
      <span role="img" tabIndex={0} aria-label={label ? `${label}: ${text}` : text}
            className="inline-grid shrink-0 cursor-help align-middle text-icon outline-none hover:text-fg focus-visible:text-fg">
        <Icon name="info" size={12} tone={tone} />
      </span>
    </Tip>
  );
}
