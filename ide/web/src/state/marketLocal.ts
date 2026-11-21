// The market directory's held contracts (model/marketLocal), read through the page's server once the Market page
// or its coins first ask, then hourly (the server reads `market coverage` once a UTC day). Null while unknown: not
// read yet, or refused (an empty or unreadable market), so nothing is marked.
import { heldBy, type LocalContract, type LocalReply } from "../model/marketLocal";
import { polled, type Answer, type Poll } from "../lib/polled";
import { atom, useAtom } from "./atom";
import { useEffect } from "react";

const POLL_MS = 3_600_000;

type Local = { marketDay: string; held: Map<string, LocalContract> } | null;
const local = atom<Local>(null);

function map(answer: Answer): void {
  const body = answer?.ok ? answer.body as LocalReply | null : null;
  local.set(body && Array.isArray(body.contracts) ? { marketDay: body.market_day, held: heldBy(body) } : null);
}

let poll: Poll | null = null;
/** The held contracts, read from the first call on. */
export function useMarketLocal(): Local {
  useEffect(() => {
    if (!poll) { poll = polled("/api/market/local", POLL_MS, map); void poll.read(); }
  }, []);
  return useAtom(local);
}
