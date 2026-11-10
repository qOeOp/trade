/** Runs' transient Live dialogs. This state contains no credentials or command payloads. */
import { atom, useAtom } from "./atom";
import { liveTrading } from "./liveTrading";
import { phoneTab } from "./phone";
import { showRunsPage } from "./shell";
import { chooseLiveRun } from "./stage";

type Workspace = { wizard: { runId: string | null } | null; credentials: boolean; requests: boolean };
const workspace = atom<Workspace>({ wizard: null, credentials: false, requests: false });
export const useLiveWorkspace = () => useAtom(workspace);
export const openLiveWizard = (runId?: string) => workspace.set({ wizard: { runId: runId ?? null }, credentials: false, requests: false });
export const closeLiveWizard = () => workspace.set({ ...workspace.get(), wizard: null });
export const openLiveCredentials = () => workspace.set({ ...workspace.get(), credentials: true, requests: false });
export const closeLiveCredentials = () => workspace.set({ ...workspace.get(), credentials: false });
export const openLiveRequests = () => workspace.set({ ...workspace.get(), requests: true, credentials: false });
export const closeLiveRequests = () => workspace.set({ ...workspace.get(), requests: false });

/** The New live run form drawn in the Live canvas (before any live run): the version it was begun on, its
 *  step, strategy, limits and the run it prepared, kept across stage and page changes until that run starts,
 *  another run is chosen or it is discarded. Null until the user touches the form. No credential or command
 *  payload is held. */
export type LiveDraft = { version: string | null; step: number; chosen: string | null; edits: Readonly<Record<string, string>>; preparedId: string | null };
export const FRESH_DRAFT: LiveDraft = { version: null, step: 0, chosen: null, edits: {}, preparedId: null };
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
