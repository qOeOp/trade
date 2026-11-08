// What `/api/about` answers (ide/research_graph/serve.py) and how the About panel names it.

export type Refusal = { code: string; message?: string };
export type About = {
  build: string;
  ledger: {
    running: boolean; remote: string | null; unpublished: boolean; commit: string | null;
    behind_seconds: number | null; diverged: boolean;
  } | null;
  refusal?: Refusal;
};
export type PaperHealth = { memory_budget: number; runtime: string | null };
export type Place = { name: string; href: string | null };

const DOLTHUB = "https://doltremoteapi.dolthub.com/";
const PRODUCT = "https://github.com/qOeOp/trade";

export const commitHref = (build: string) => `${PRODUCT}/commit/${build}`;
export const guideHref = (path: string) => `${PRODUCT}/blob/main/${path}`;

/** Where the ledger is published: a DoltHub repository by its name and page, any other remote as it is. */
export function placeOf(remote: string): Place {
  if (!remote.startsWith(DOLTHUB)) return { name: remote, href: null };
  const name = remote.slice(DOLTHUB.length);
  return { name, href: `https://www.dolthub.com/repositories/${name}` };
}

/** The ledger's line when it has no place to name: the reason, or that it is published nowhere. */
export function ledgerGap(about: About): string | null {
  if (about.refusal) return about.refusal.code;
  if (!about.ledger?.running) return "Not readable";
  return about.ledger.remote ? null : "Not published";
}

// A write publishes itself within seconds, a replay's early commits within the service's 5-minute retry.
const LAG_SECONDS = 15 * 60;
const ageOf = (seconds: number) => seconds < 7200 ? `${Math.floor(seconds / 60)} min`
  : seconds < 172800 ? `${Math.floor(seconds / 3600)} h` : `${Math.floor(seconds / 86400)} d`;

/** The public copy's fault, when it has one: changed elsewhere, or behind for longer than publishing takes. The short
 *  text is the status bar's, the long one the About panel's. */
export function publicCopyFault(about: About): { short: string; long: string } | null {
  const ledger = about.ledger;
  if (!ledger?.unpublished) return null;
  if (ledger.diverged) return {
    short: "Public copy: changed elsewhere",
    long: "Its history changed elsewhere, so publishing is refused and nothing reaches it until you decide.",
  };
  if (ledger.behind_seconds !== null && ledger.behind_seconds < LAG_SECONDS) return null;
  const age = ledger.behind_seconds === null ? "" : ` ${ageOf(ledger.behind_seconds)}`;
  return {
    short: `Public copy: behind${age}`,
    long: `Behind this ledger${age && ` by${age}`}: publishing keeps failing. The ledger service retries every 5 minutes; ledger publish shows why.`,
  };
}

/** The paper daemon's line: the memory its runs may reserve together. */
export const paperLine = (health: PaperHealth) => `Runs reserve up to ${(health.memory_budget / 1024).toFixed(1)} GiB`;

/** The runtime image by the start of its digest, or as it is named when it has none. */
export const runtimeDigest = (runtime: string) => runtime.match(/sha256:[0-9a-f]{8}/)?.[0] ?? runtime;
