import type { SummaryWidget } from "../model/types";
import { useWidget } from "../model/view";
import { paletteOpen, toggleSide, useOnPaperPage, useShell } from "../state/shell";
import { IconButton } from "../components/IconButton";
import { SearchTrigger } from "../components/SearchTrigger";
import { RENDERERS } from "../widgets/registry";
import { LedgerWidget } from "./toolbar/LedgerWidget";
import { LineWidget } from "./toolbar/LineWidget";
import { RecommendationWidget } from "./toolbar/RecommendationWidget";
import { SettingsMenu } from "./toolbar/SettingsMenu";

/** The window's top row, on the frame, as IntelliJ's main toolbar: the line, ledger and recommendation
 *  widgets at the left, the recommendation's readout, then search, the side toggles and settings. The
 *  Paper page drops the recommendation and its readout: its runs carry their own readings. */
export function MainToolbar() {
  const summary = useWidget<SummaryWidget>("summary@1");
  const { open } = useShell();
  const paper = useOnPaperPage();
  const Readout = RENDERERS.summary.Component;
  return (
    <header className="flex h-(--toolbar-h) min-w-0 shrink-0 items-center gap-1 overflow-hidden px-(--frame-inset)">
      <LineWidget />
      <LedgerWidget />
      {!paper && <><span className="mx-1 h-4 w-px shrink-0 bg-line-strong" /><RecommendationWidget /></>}
      <div className="ml-3 min-w-0 flex-1">{summary && !paper && <Readout widget={summary} />}</div>
      <SearchTrigger label="Go to…" onOpen={() => paletteOpen.set(true)} />
      <div className="ml-2 flex shrink-0 items-center gap-1">
        <IconButton frame icon="panel-bottom" label="Bottom tool windows" keys="⌘J" active={!!open.bottom} onClick={() => toggleSide("bottom")} />
        <IconButton frame icon="panel-right" label="Right tool windows" keys="⌘B" active={!!open.right} onClick={() => toggleSide("right")} />
        <SettingsMenu />
      </div>
    </header>
  );
}
