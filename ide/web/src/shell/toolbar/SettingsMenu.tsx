import { useState } from "react";
import { resetShell } from "../../state/shell";
import { theme, THEME_LABEL, useTheme, type ThemeChoice } from "../../state/theme";
import { Icon } from "../../icons/Icon";
import { AboutDialog } from "../../components/About";
import { Dropdown, DropdownItem, DropdownLabel, DropdownRadio, DropdownSeparator } from "../../components/Dropdown";

const THEMES = (Object.keys(THEME_LABEL) as ThemeChoice[]).map((value) => ({ value, label: THEME_LABEL[value] }));

/** The page's settings: theme, layout, and what this deployment runs. */
export function SettingsMenu() {
  const choice = useTheme();
  const [about, setAbout] = useState(false);
  return (
    <>
      <Dropdown label="Settings" align="end" variant="icon" trigger={<span className="text-icon"><Icon name="settings" size={20} /></span>}>
        <DropdownLabel>Theme</DropdownLabel>
        <DropdownRadio value={choice} options={THEMES} onChange={(v) => theme.set(v)} />
        <DropdownSeparator />
        <DropdownItem onSelect={resetShell}>Reset tool window layout</DropdownItem>
        <DropdownItem onSelect={() => setAbout(true)}>About this deployment</DropdownItem>
      </Dropdown>
      <AboutDialog open={about} onClose={() => setAbout(false)} />
    </>
  );
}
