import { atom, useAtom } from "./atom";

// A live page's update to a newer ledger head while it keeps showing the graph it has: the market
// pulled for the new head, its graph queued or drawn, or a refresh that failed (the graph stays).
export type UpdateStage = "pulling" | "queued" | "computing" | "failed";
export type Update = { stage: UpdateStage; commit: string | null; shown: string | null; error?: { code?: string; message?: string } };

export const update = atom<Update | null>(null);
export const useUpdate = () => useAtom(update);
