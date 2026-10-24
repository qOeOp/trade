import { useView, useWidget } from "../model/view";
import type { SummaryWidget } from "../model/types";
import { paletteOpen } from "../state/shell";
import { THEME_LABEL, useTheme } from "../state/theme";
import { IconButton } from "../components/IconButton";
import { SearchTrigger } from "../components/SearchTrigger";
import { Tip } from "../components/Tip";
import { Recommendation } from "../widgets/Recommendation";
import type { Action } from "./commands";

/** The window's top row, on the frame: the line, the current recommendation's readout, search and
 *  the panel and theme toggles. (Step 3 turns the left part into dropdown widgets.) */
export function MainToolbar({ actions, dockOpen, inspectorOpen }: { actions: readonly Action[]; dockOpen: boolean; inspectorOpen: boolean }) {
  const view = useView();
  const summary = useWidget<SummaryWidget>("summary/1");
  const choice = useTheme();
  const act = (id: string) => actions.find((a) => a.id === id);
  return (
    <header className="flex h-(--toolbar-h) shrink-0 items-center gap-4 px-3">
      <Tip content={view.line.bundle} side="bottom">
        <div className="flex min-w-0 shrink items-baseline gap-2">
          <span className="truncate font-mono text-dense font-semibold">{view.line.bundle.replace(/^research-line-/, "")}</span>
          {view.line.start && <span className="hidden truncate font-mono text-small text-fg-faint xl:inline">起点 {view.line.start}</span>}
        </div>
      </Tip>
      <span className="h-4 w-px shrink-0 bg-line-strong" />
      <div className="min-w-0 flex-1">{summary && <Recommendation widget={summary} />}</div>
      <SearchTrigger label="跳转…" onOpen={() => paletteOpen.set(true)} />
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton icon="panel-bottom" label="底部面板" keys="⌘J" active={dockOpen} onClick={act("dock")?.run} />
        <IconButton icon="panel-right" label="详情" keys="⌘B" active={inspectorOpen} onClick={act("inspector")?.run} />
        <IconButton icon="theme" label={`主题：${THEME_LABEL[choice]}`} onClick={act("theme")?.run} />
      </div>
    </header>
  );
}
