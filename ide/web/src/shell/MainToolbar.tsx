import type { SummaryWidget } from "../model/types";
import { useWidget } from "../model/view";
import { desktopLayout, useNarrow } from "../state/phone";
import { paletteOpen, toggleSide, useOnRunsPage, useShell, type Side } from "../state/shell";
import { IconButton } from "../components/IconButton";
import { SearchTrigger } from "../components/SearchTrigger";
import { TextButton } from "../components/TextButton";
import { ResearchSync } from "../components/ResearchSync";
import { RENDERERS } from "../widgets/registry";
import { LedgerWidget } from "./toolbar/LedgerWidget";
import { LineWidget } from "./toolbar/LineWidget";
import { PaperRunWidget } from "./toolbar/PaperRunWidget";
import { RecommendationWidget } from "./toolbar/RecommendationWidget";
import { SettingsMenu } from "./toolbar/SettingsMenu";
import type { ToolWindow } from "./toolWindows";

/** The window's top row, on the frame, as IntelliJ's main toolbar: the line and ledger widgets at the
 *  left, then the recommendation widget and its readout (on the Runs page the paper run widget and the
 *  run's readout instead), then search, the side toggles and settings. On a phone that asked for this layout, where
 *  the row runs past the screen, the way back comes first. */
export function MainToolbar({ windows }: { windows: readonly ToolWindow[] }) {
  const summary = useWidget<SummaryWidget>("summary@1");
  const { open } = useShell();
  const runs = useOnRunsPage(), narrow = useNarrow();
  const Readout = RENDERERS.summary.Component;
  const has = (side: Side) => windows.some((w) => w.side === side);
  const drawn = (side: Side) => windows.some((w) => w.side === side && w.id === open[side]);
  return (
    <header className="flex h-(--toolbar-h) min-w-0 shrink-0 items-center gap-1 overflow-hidden px-(--frame-inset)">
      {narrow && <TextButton className="shrink-0 whitespace-nowrap text-dense text-fg underline underline-offset-3" onClick={() => desktopLayout.set(false)}>Phone layout</TextButton>}
      <LineWidget />
      <LedgerWidget />
      <ResearchSync />
      <span className="mx-1 h-4 w-px shrink-0 bg-line-strong" />
      {runs ? <><PaperRunWidget /><div className="min-w-0 flex-1" /></> : <>
        <RecommendationWidget />
        <div className="ml-3 min-w-0 flex-1">{summary && <Readout widget={summary} />}</div>
      </>}
      <SearchTrigger label="Go to…" onOpen={() => paletteOpen.set(true)} />
      <div className="ml-2 flex shrink-0 items-center gap-1">
        {has("bottom") && <IconButton frame icon="panel-bottom" label="Bottom tool windows" keys="⌘J" active={drawn("bottom")} onClick={() => toggleSide("bottom")} />}
        {has("right") && <IconButton frame icon="panel-right" label="Right tool windows" keys="⌘B" active={drawn("right")} onClick={() => toggleSide("right")} />}
        <SettingsMenu />
      </div>
    </header>
  );
}
