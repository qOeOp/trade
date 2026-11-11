// The History page's data: `research history` at the head, read when the page shows and again when the ledger head
// the page follows moves (lib/historyApi.ts). The last answer stays while a newer one is read or fails.
import { useEffect } from "react";
import { fetchHistory, type History } from "../lib/historyApi";
import { useView } from "../model/view";
import { atom, useAtom } from "./atom";

type Read = { history: History | null; reading: boolean; error: string | null };
const read = atom<Read>({ history: null, reading: false, error: null });

async function load(): Promise<void> {
  read.set({ ...read.get(), reading: true });
  const found = await fetchHistory(null);
  read.set(found.kind === "ready" ? { history: found.history, reading: false, error: null }
    : { ...read.get(), reading: false, error: found.message });
}

/** The history tests, read while the page that calls this shows. */
export function useHistory(): Read {
  const head = useView().scope?.ledger_commit ?? null;
  useEffect(() => { void load(); }, [head]);
  return useAtom(read);
}
