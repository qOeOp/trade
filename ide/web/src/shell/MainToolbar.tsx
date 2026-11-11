import type { SummaryWidget } from "../model/types";
import { useWidget } from "../model/view";
import { desktopLayout, useNarrow } from "../state/phone";
import { paletteOpen, useOnRunsPage } from "../state/shell";
import { SearchTrigger } from "../components/SearchTrigger";
import { TextButton } from "../components/TextButton";
import { RENDERERS } from "../widgets/registry";
import { LedgerWidget } from "./toolbar/LedgerWidget";
import { LineWidget } from "./toolbar/LineWidget";
import { RunsWidget } from "./toolbar/RunsWidget";
import { RecommendationWidget } from "./toolbar/RecommendationWidget";
import { SettingsMenu } from "./toolbar/SettingsMenu";
import { ToolbarActions } from "./toolbar/ToolbarActions";

/** The window's top row, on the frame, as IntelliJ's main toolbar: the line and ledger widgets at the
 *  left, then the recommendation widget and its readout (on Runs the shared run picker and its state
 *  instead), then on Runs the action group (the selected stage's run actions), then search and
 *  settings; the side toggles sit at the stripes' feet (Stripe.tsx). On a phone that asked for this
 *  layout, where the row runs past the screen, the way back comes first. */
export function MainToolbar() {
  const summary = useWidget<SummaryWidget>("summary");
  const runs = useOnRunsPage(), narrow = useNarrow();
  const Readout = RENDERERS.summary.Component;
  return (
    <header id="main-toolbar" aria-label="Main toolbar" className="flex h-(--toolbar-h) min-w-0 shrink-0 items-center gap-1 overflow-hidden px-(--frame-inset) pt-(--frame-inset) pb-(--frame-near)">
      {narrow && <TextButton className="shrink-0 whitespace-nowrap text-dense" onClick={() => desktopLayout.set(false)}>Phone layout</TextButton>}
      <LineWidget /><LedgerWidget /><span className="mx-1 h-4 w-px shrink-0 bg-line-strong" />
      {runs ? <><RunsWidget /><div className="min-w-0 flex-1" /></> : <>
        <RecommendationWidget />
        <div className="ml-3 min-w-0 flex-1">{summary && <Readout widget={summary} />}</div>
      </>}
      <ToolbarActions />
      <SearchTrigger label="Version or command…" onOpen={() => paletteOpen.set(true)} />
      <div className="ml-2 flex shrink-0 items-center"><SettingsMenu /></div>
    </header>
  );
}
