import { useState } from "react";
import { resetShell } from "../../state/shell";
import { theme, THEME_LABEL, useTheme, type ThemeChoice } from "../../state/theme";
import { timeZone, useTimeZone } from "../../state/timeZone";
import { desktopHref, desktopLayout, usePhoneRun } from "../../state/phone";
import { TIME_ZONES, TIME_ZONE_LABEL } from "../../lib/time";
import { copyText } from "../../lib/clipboard";
import { Icon } from "../../icons/Icon";
import { AboutDialog } from "../../components/About";
import { Dropdown, DropdownItem, DropdownLabel, DropdownRadio, DropdownSeparator } from "../../components/Dropdown";

const THEMES = (Object.keys(THEME_LABEL) as ThemeChoice[]).map((value) => ({ value, label: THEME_LABEL[value] }));
const ZONES = TIME_ZONES.map((value) => ({ value, label: TIME_ZONE_LABEL[value] }));

/** The page's settings: theme, time zone, layout, and what this deployment runs. On a phone, at the end of its
 *  bar: the way to the desktop too, the address of what it shows (the run, else `line`) and the desktop layout. */
export function SettingsMenu({ phone = false, line = null }: { phone?: boolean; line?: string | null }) {
  const choice = useTheme(), zone = useTimeZone(), run = usePhoneRun();
  const [about, setAbout] = useState(false);
  return (
    <>
      <Dropdown label="Settings" align="end" variant="icon" trigger={<span className="text-icon"><Icon name="settings" size={20} /></span>}>
        <DropdownLabel>Theme</DropdownLabel>
        <DropdownRadio value={choice} options={THEMES} onChange={(v) => theme.set(v)} />
        <DropdownSeparator />
        <DropdownLabel>Time zone</DropdownLabel>
        <DropdownRadio value={zone} options={ZONES} onChange={(value) => timeZone.set(value)} />
        <DropdownSeparator />
        {phone ? <>
          <DropdownItem icon="copy" onSelect={() => void copyText(desktopHref(window.location.href, run, line))}>Copy link for the desktop</DropdownItem>
          <DropdownItem icon="desktop" onSelect={() => desktopLayout.set(true)}>Desktop layout</DropdownItem>
        </> : <DropdownItem onSelect={resetShell}>Reset tool window layout</DropdownItem>}
        <DropdownItem onSelect={() => setAbout(true)}>About this deployment</DropdownItem>
      </Dropdown>
      <AboutDialog open={about} onClose={() => setAbout(false)} />
    </>
  );
}
