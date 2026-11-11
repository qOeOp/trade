import type { ReactNode } from "react";
import { PhoneBack, PhoneBar } from "../../components/PhoneBar";
import { SettingsMenu } from "../toolbar/SettingsMenu";

/** A phone page's bar: its title (or the way back), what it is at the right, and the settings at the end, which
 *  hold the way to the desktop. `line`: the research line the page is about, for that way. */
export function PhoneTop({ title, back, aside, line = null }: { title?: string; back?: { label: string; onClick: () => void }; aside?: ReactNode; line?: string | null }) {
  return (
    <PhoneBar>
      {back ? <PhoneBack onClick={back.onClick}>{back.label}</PhoneBack> : <h1 className="min-w-0 truncate px-2 text-h2 font-semibold">{title}</h1>}
      <span className="ml-auto min-w-0 truncate pl-2 text-small text-fg-faint">{aside}</span>
      <SettingsMenu phone line={line} />
    </PhoneBar>
  );
}
