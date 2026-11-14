/** Live's Runs data owner. Views receive observations/actions; mounting only reads the chosen run. */
import { useEffect, useState } from "react";
import type { LiveEvidenceRead, LiveRun, LiveSource, LiveTradingActions, LiveTradingView } from "../model/liveTrading";
import { liveEvidencePresentation, liveSourcePresentation } from "../model/liveTradingMap";
import type { LineageWidget, Targets } from "../model/types";
import { useView, useWidget } from "../model/view";
import { lineOf } from "../lib/lines";
import { liveApi, LiveApiError } from "../lib/liveTradingApi";
import type { LiveCandidateDto, LiveEvidenceReadDto } from "../lib/liveTradingDto";
import { useResearchLines } from "./researchLines";
import { useAtom } from "./atom";
import { useLiveTrading } from "./liveTrading";
import { useLiveDraft } from "./liveWorkspace";
import { usePaperRuns } from "./paper";
import { useShown } from "./shown";
import { choices, choiceOf } from "./stage";

export type LiveRunView = { run: LiveRun | null; actions: LiveTradingActions };
export type LiveCanvasView = LiveRunView & {
  version: string | null; view: LiveTradingView; first: boolean; backtestAvailable: boolean; paperAvailable: boolean;
};

export function useLiveRunView(): LiveRunView {
  const { liveRun: run } = useShown(), { actions } = useLiveTrading();
  return { run, actions };
}

export function useLiveCanvas(): LiveCanvasView {
  const { liveRun: run, version, trial } = useShown(), { view, actions } = useLiveTrading(), draft = useLiveDraft();
  // The launch page is drawn even where Live cannot take a run, greyed, saying why.
  const first = !run || draft?.version === version;
  const paper = usePaperRuns()?.runs ?? [], choice = choiceOf(useAtom(choices), version);
  useEffect(() => { if (run && actions.inspect) void actions.inspect(run.id); }, [run?.id, actions.inspect]);
  const paperAvailable = paper.some((item) => version ? item.candidate === version : item.paper_id === choice.run);
  return { run, version, view, actions, first, backtestAvailable: trial !== null, paperAvailable };
}

/** A Live candidate's research reading and the targets of its line, as the drawn research graph has them (null where
 *  it does not draw the candidate), for the launch page's target rows. */
export function useLaunchReading(candidate: string | null): { reading: { annual_return: number | null; max_drawdown: number | null } | null; targets: Targets | null } {
  const view = useView(), lineage = useWidget<LineageWidget>("lineage"), { lines } = useResearchLines();
  const reading = candidate ? lineage?.nodes.find((node) => node.id === candidate)?.reading ?? null : null;
  const targets = (candidate ? lineOf(lines, candidate)?.targets : null) ?? (reading ? lineage?.targets ?? view.targets : null) ?? null;
  return { reading, targets };
}

/** A version the Live control can read: strategy_id@revision (live/configuration.py CANDIDATE). */
const REF = /^([A-Za-z0-9][A-Za-z0-9_.-]{0,99})@([1-9][0-9]{0,8})$/;
const candidatePath = (candidate: string) => { const [, id, revision] = REF.exec(candidate)!; return `/candidates/${encodeURIComponent(id!)}/${revision}`; };
const CHECKING_MS = 3000, UNKNOWN_MS = 30_000;

/** The launch page's candidate, the version selected in the research graph, as the Live control reads it at the
 *  research head (live/control.py candidate): read once per version, again after a while when Live did not answer. */
export function useLiveSource(version: string | null): LiveSource | null {
  const candidate = version && REF.test(version) ? version : null;
  const [read, setRead] = useState<{ candidate: string; found: LiveCandidateDto | "absent" | "unknown" } | null>(null);
  useEffect(() => {
    if (!candidate) return;
    let live = true, timer: number | undefined;
    const ask = () => void liveApi<LiveCandidateDto>(candidatePath(candidate)).then(
      (found) => { if (live) setRead({ candidate, found }); },
      (error) => {
        if (!live) return;
        const absent = error instanceof LiveApiError && error.code === "LIVE_SOURCE_MISSING";
        setRead({ candidate, found: absent ? "absent" : "unknown" });
        if (!absent) timer = window.setTimeout(ask, UNKNOWN_MS);
      });
    ask();
    return () => { live = false; window.clearTimeout(timer); };
  }, [candidate]);
  if (!version) return null;
  // A version Live cannot name is no candidate it can run; one not read yet is still being read.
  return liveSourcePresentation(version, !candidate ? "absent" : read?.candidate === candidate ? read.found : "reading", null);
}

/** The candidate's replay evidence on `symbols` at the research head, asked of the serving Live control and asked
 *  again while it is checking (or did not answer); null until a found candidate and valid contracts are given. */
export function useLiveEvidence(source: LiveSource | null, symbols: readonly string[] | null): LiveEvidenceRead | null {
  const candidate = source?.read === "found" ? source.candidate : null, key = candidate && symbols ? `${candidate}/${symbols.join(",")}` : null;
  const [found, setFound] = useState<{ key: string; evidence: LiveEvidenceRead } | null>(null);
  useEffect(() => {
    if (!key || !candidate || !symbols) return;
    let live = true, timer: number | undefined;
    const ask = () => void liveApi<LiveEvidenceReadDto>(`${candidatePath(candidate)}/evidence/${symbols.join(",")}`).then(
      (read) => { if (!live) return; setFound({ key, evidence: liveEvidencePresentation(read) }); if (read.state === "checking" || read.state === "unknown") timer = window.setTimeout(ask, read.state === "checking" ? CHECKING_MS : UNKNOWN_MS); },
      () => { if (!live) return; setFound({ key, evidence: { state: "unknown", replays: [], tolerance: "0" } }); timer = window.setTimeout(ask, UNKNOWN_MS); });
    ask();
    return () => { live = false; window.clearTimeout(timer); };
  }, [key]);
  return key && found?.key === key ? found.evidence : key ? { state: "checking", replays: [], tolerance: "0" } : null;
}
