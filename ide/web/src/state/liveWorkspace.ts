/** Runs' transient Live dialogs and the launch page's choices. This state contains no credentials or command payloads. */
import { atom, useAtom } from "./atom";
import { liveTrading } from "./liveTrading";
import { phoneTab } from "./phone";
import { showRunsPage } from "./shell";
import { selection } from "./selection";
import { chooseLiveRun, chooseStage } from "./stage";

type Workspace = { review: string | null; credentials: boolean; requests: boolean };
const workspace = atom<Workspace>({ review: null, credentials: false, requests: false });
export const useLiveWorkspace = () => useAtom(workspace);

export const openLiveReview = (runId: string) => workspace.set({ review: runId, credentials: false, requests: false });
export const closeLiveReview = () => workspace.set({ ...workspace.get(), review: null });
export const openLiveCredentials = () => workspace.set({ ...workspace.get(), credentials: true, requests: false });
export const closeLiveCredentials = () => workspace.set({ ...workspace.get(), credentials: false });
export const openLiveRequests = () => workspace.set({ ...workspace.get(), requests: true, credentials: false });
export const closeLiveRequests = () => workspace.set({ ...workspace.get(), requests: false });

/** The Live launch page's own choices (widgets/live/LiveLaunch.tsx): the version it was begun on, the candidate and
 *  settings changed, and the run it prepared to check the account, kept across stage and page changes until a run
 *  starts, another run is chosen or it is discarded. Null until the user touches the page. No credential or command
 *  payload is held. */
export type LiveDraft = { version: string | null; chosen: string | null; edits: Readonly<Record<string, string>>; preparedId: string | null };
export const FRESH_DRAFT: LiveDraft = { version: null, chosen: null, edits: {}, preparedId: null };
export const liveDraft = atom<LiveDraft | null>(null);
export const useLiveDraft = () => useAtom(liveDraft);

/** Only selection/navigation: opening a retained run never submits an operation. */
export function showLiveRun(runId: string): void {
  liveDraft.set(null);
  const run = liveTrading.get().view.runs.find((item) => item.id === runId);
  chooseLiveRun(runId, run?.candidate ?? null);
  showRunsPage();
  phoneTab.set("runs");
}

/** Runs → Live with the launch page in its canvas, over the version's own runs, keeping a draft begun on this
 *  version. Only navigation; nothing is submitted. */
export function openLiveLaunch(): void {
  const version = selection.get();
  if (liveDraft.get()?.version !== version) liveDraft.set({ ...FRESH_DRAFT, version });
  chooseStage("live");
  showRunsPage();
}
