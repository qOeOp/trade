/** Runs' transient Live dialogs. This state contains no credentials or command payloads. */
import { atom, useAtom } from "./atom";
import { liveTrading } from "./liveTrading";
import { phoneTab } from "./phone";
import { showRunsPage } from "./shell";
import { chooseLiveRun, chooseStage } from "./stage";

type Workspace = { wizard: { runId: string | null } | null; credentials: boolean; requests: boolean };
const workspace = atom<Workspace>({ wizard: null, credentials: false, requests: false });
export const useLiveWorkspace = () => useAtom(workspace);
export const openLiveWizard = (runId?: string) => workspace.set({ wizard: { runId: runId ?? null }, credentials: false, requests: false });
export const closeLiveWizard = () => workspace.set({ ...workspace.get(), wizard: null });
export const openLiveCredentials = () => workspace.set({ ...workspace.get(), credentials: true, requests: false });
export const closeLiveCredentials = () => workspace.set({ ...workspace.get(), credentials: false });
export const openLiveRequests = () => workspace.set({ ...workspace.get(), requests: true, credentials: false });
export const closeLiveRequests = () => workspace.set({ ...workspace.get(), requests: false });

/** Only selection/navigation: opening a retained run never submits an operation. */
export function showLiveRun(runId: string): void {
  const run = liveTrading.get().view.runs.find((item) => item.id === runId);
  chooseLiveRun(runId, run?.candidate ?? null);
  showRunsPage();
  phoneTab.set("runs");
}

export function showLiveStage(): void {
  chooseStage("live");
  showRunsPage();
  phoneTab.set("runs");
}
