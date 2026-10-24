import { resetShell } from "../../state/shell";
import { theme, THEME_LABEL, useTheme, type ThemeChoice } from "../../state/theme";
import { Icon } from "../../icons/Icon";
import { Dropdown, DropdownItem, DropdownLabel, DropdownRadio, DropdownSeparator } from "../../components/Dropdown";

const THEMES = (Object.keys(THEME_LABEL) as ThemeChoice[]).map((value) => ({ value, label: THEME_LABEL[value] }));

/** The page's settings: theme and layout. */
export function SettingsMenu() {
  const choice = useTheme();
  return (
    <Dropdown label="设置" align="end" trigger={<span className="text-icon"><Icon name="settings" /></span>}>
      <DropdownLabel>主题</DropdownLabel>
      <DropdownRadio value={choice} options={THEMES} onChange={(v) => theme.set(v)} />
      <DropdownSeparator />
      <DropdownItem onSelect={resetShell}>重置工具窗布局</DropdownItem>
    </Dropdown>
  );
}
