import { useView, useWidget } from "../model/view";
import type { SummaryWidget } from "../model/types";
import { paletteOpen, toggleSide, useShell } from "../state/shell";
import { cycleTheme, THEME_LABEL, useTheme } from "../state/theme";
import { IconButton } from "../components/IconButton";
import { SearchTrigger } from "../components/SearchTrigger";
import { Tip } from "../components/Tip";
import { RENDERERS } from "../widgets/registry";

/** The window's top row, on the frame: the line, the current recommendation's readout, search and
 *  the side and theme toggles. (Step 3 turns the left part into dropdown widgets.) */
export function MainToolbar() {
  const view = useView();
  const summary = useWidget<SummaryWidget>("summary/1");
  const { open } = useShell();
  const choice = useTheme();
  const Summary = RENDERERS.summary.Component;
  return (
    <header className="flex h-(--toolbar-h) shrink-0 items-center gap-4 px-3">
      <Tip content={view.line.bundle} side="bottom">
        <div className="flex min-w-0 shrink items-baseline gap-2">
          <span className="truncate font-mono text-dense font-semibold">{view.line.bundle.replace(/^research-line-/, "")}</span>
          {view.line.start && <span className="hidden truncate font-mono text-small text-fg-faint xl:inline">起点 {view.line.start}</span>}
        </div>
      </Tip>
      <span className="h-4 w-px shrink-0 bg-line-strong" />
      <div className="min-w-0 flex-1">{summary && <Summary widget={summary} />}</div>
      <SearchTrigger label="跳转…" onOpen={() => paletteOpen.set(true)} />
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton icon="panel-bottom" label="底部工具窗" keys="⌘J" active={!!open.bottom} onClick={() => toggleSide("bottom")} />
        <IconButton icon="panel-right" label="右侧工具窗" keys="⌘B" active={!!open.right} onClick={() => toggleSide("right")} />
        <IconButton icon="theme" label={`主题：${THEME_LABEL[choice]}`} onClick={cycleTheme} />
      </div>
    </header>
  );
}
