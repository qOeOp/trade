import { useEffect, useState } from "react";
import { AboutSheet } from "../../components/About";
import { NextSteps } from "../../components/NextSteps";
import { PhoneBack, PhoneBar, PhoneBarIcon, PhonePage, PhoneRow } from "../../components/PhoneBar";
import { Tabs } from "../../components/Tabs";
import { Typing } from "../../components/Typing";
import { UpdateStatus } from "../../components/UpdateStatus";
import { lineHref } from "../../lib/lines";
import { plural } from "../../lib/format";
import type { DetailWidget, LineageWidget, NotesWidget, ProgressWidget, ScatterWidget, SummaryWidget, TableWidget } from "../../model/types";
import { useView, useWidget } from "../../model/view";
import { useAtom } from "../../state/atom";
import { closeVersion, lineTab, openVersion, useLandscape, versionOpen, viewStatus, type LineTab } from "../../state/phone";
import { useResearchLines } from "../../state/researchLines";
import { select, useSelection } from "../../state/selection";
import { useShown } from "../../state/shown";
import { SelectedDetail } from "../../widgets/detail/Detail";
import { Lineage } from "../../widgets/lineage/Lineage";
import { Notes } from "../../widgets/Notes";
import { Progress } from "../../widgets/Progress";
import { Recommendation } from "../../widgets/Recommendation";
import { RunsPage } from "../../widgets/paper/RunsPage";
import { Scatter } from "../../widgets/Scatter";
import { VersionTable } from "../../widgets/VersionTable";
import { VersionTree } from "../../widgets/VersionTree";
import { lineCounts, StageSource } from "../StatusBar";
import { VersionSource } from "./VersionSource";

const short = (bundle: string) => bundle.replace(/^research-line-/, "");

/** Every line, open ones first, the newest first; each opens its own page. */
function Lines() {
  const { lines, loaded, error } = useResearchLines();
  const status = useAtom(viewStatus);
  const [about, setAbout] = useState(false);
  const order = [...lines].reverse().sort((a, b) => Number(a.closed) - Number(b.closed));
  return (
    <>
      <PhoneBar>
        <h1 className="min-w-0 flex-1 truncate px-2 text-dense font-semibold">Research lines</h1>
        <PhoneBarIcon name="info" label="About this deployment" onClick={() => setAbout(true)} />
      </PhoneBar>
      <AboutSheet open={about} onClose={() => setAbout(false)} />
      <PhonePage>
        {!order.length && !status.busy && status.text
          ? <div className="p-4 text-dense"><p className="break-words">{status.text}</p><NextSteps steps={status.next} className="mt-2" /></div>
          : !loaded && <p className="p-4 text-dense text-fg-faint">{error ?? "Reading the research lines…"}</p>}
        {order.map((line) => (
          <PhoneRow key={line.bundle} href={lineHref(window.location.href, line.bundle)}>
            <span className="block truncate font-mono text-dense">{short(line.bundle)}</span>
            <span className="mt-0.5 block truncate text-small text-fg-faint">
              {line.closed ? "Closed" : "Open"} · {plural(line.versions.length, "version")} · {line.window_start} to {line.window_end} · UTC window
            </span>
          </PhoneRow>
        ))}
      </PhonePage>
    </>
  );
}

/** The status bar's update, which a phone has no bar for: a graph kept from before says it is not the ledger's yet, or why it could not be redrawn. */
const PhoneUpdate = () => <div className="shrink-0 border-b border-line bg-frame px-3 py-1.5 text-small text-fg-faint empty:hidden"><UpdateStatus spelled /></div>;

const TABS: readonly { id: LineTab; label: string; widget: string }[] = [
  { id: "graph", label: "Graph", widget: "lineage@2" }, { id: "versions", label: "Versions", widget: "lineage@2" },
  { id: "readings", label: "Readings", widget: "scatter@1" }, { id: "table", label: "Table", widget: "table@1" }, { id: "gaps", label: "Gaps", widget: "notes@1" },
];

/** Opens a version's page, the version selected. */
const openOne = (id: string) => { select(id); openVersion(); };

/** A line's page: what it recommends and the line's counts, then the desktop's windows a tab at a time: the canvas
 *  over the progress chart on its axis, the Versions tree, the scatter, the table and the gaps. A version anywhere
 *  opens its page. */
function Line() {
  const view = useView(), tab = useAtom(lineTab), summary = useWidget<SummaryWidget>("summary@1"), lineage = useWidget<LineageWidget>("lineage@2");
  const progress = useWidget<ProgressWidget>("progress@1"), scatter = useWidget<ScatterWidget>("scatter@1"), table = useWidget<TableWidget>("table@1"), notes = useWidget<NotesWidget>("notes@1");
  const tabs = TABS.filter((t) => view.widgets.some((w) => w.type === t.widget));
  return (
    <>
      <PhoneBar><PhoneBack href={`${window.location.pathname}#lines`}>{short(view.line.bundle)}</PhoneBack></PhoneBar>
      <PhoneUpdate />
      <PhonePage>
        {summary && (
          <div className="px-3 pt-3">
            <Recommendation widget={summary} />
            <p className="mt-1.5 text-small text-fg-faint">{lineCounts(summary)}</p>
          </div>
        )}
        <div className="mt-1 flex h-(--header-h) items-center px-1 text-dense"><Tabs label="Line" value={tab} onChange={lineTab.set} items={tabs} /></div>
        {tab === "graph" && (
          <>
            {lineage && <div className="h-[36dvh] min-h-56 border-t border-line"><Lineage widget={lineage} onOpen={openOne} /></div>}
            {progress && <div className="h-48 border-t border-line"><Progress widget={progress} /></div>}
          </>
        )}
        {tab === "versions" && lineage && <div className="overflow-x-auto border-t border-line"><VersionTree widget={lineage} onOpen={openOne} /></div>}
        {tab === "readings" && scatter && <div className="h-[62dvh] min-h-96 border-t border-line"><Scatter widget={scatter} onOpen={openOne} /></div>}
        {tab === "table" && table && <div data-page-table="sticky" className="overflow-x-auto border-t border-line"><VersionTable widget={table} onOpen={openOne} /></div>}
        {tab === "gaps" && notes && <div className="border-t border-line"><Notes widget={notes} /></div>}
      </PhonePage>
    </>
  );
}

/** A version's page: the Runs page's chart of its stages and where they come from, then Details as the inspector
 *  shows it, and its source. Turned sideways, the chart alone. */
function Version() {
  const view = useView(), detail = useWidget<DetailWidget>("candidate-detail@1"), selected = useSelection(), { stage } = useShown(), landscape = useLandscape();
  if (landscape && stage !== null) return <RunsPage />;
  return (
    <>
      <PhoneBar><PhoneBack onClick={closeVersion}>{short(view.line.bundle)}</PhoneBack></PhoneBar>
      <PhoneUpdate />
      <PhonePage>
        {stage !== null && <div key={selected} className="h-[72dvh] min-h-96 overflow-hidden"><RunsPage /></div>}
        <div className="px-3 pb-1 pt-1.5 leading-tight"><StageSource className="text-small text-fg-faint" /></div>
        {detail && <div className="pt-1"><SelectedDetail widget={detail} /></div>}
        {selected && <VersionSource id={selected} />}
      </PhonePage>
    </>
  );
}

/** The Research tab: the lines, a line (a page of its own, by its address, so its graph is read only when asked
 *  for), or a version. While a line is drawn, or refused, the desktop's one line says so. */
export function ResearchTab() {
  const view = useView(), status = useAtom(viewStatus), open = useAtom(versionOpen), detail = useWidget<DetailWidget>("candidate-detail@1"), selected = useSelection();
  const asked = new URLSearchParams(window.location.search).get("line");
  // Back from the Runs tab, which shows a run with no version selected.
  useEffect(() => { if (view.line.bundle && selected === null && detail?.default) select(detail.default); }, [view.line.bundle, selected, detail?.default]);
  if (view.line.bundle) return open ? <Version /> : <Line />;
  if (asked) return (
    <>
      <PhoneBar><PhoneBack href={`${window.location.pathname}#lines`}>{short(asked)}</PhoneBack></PhoneBar>
      <div className="grid min-h-0 flex-1 place-items-center p-6">
        <div>
          <Typing text={status.text} busy={status.busy} className="text-dense text-fg-muted" />
          <NextSteps steps={status.next} className="mt-2 text-dense" />
        </div>
      </div>
    </>
  );
  return <Lines />;
}
