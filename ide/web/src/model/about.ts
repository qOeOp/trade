// What `/api/about` answers (ide/research_graph/serve.py) and how the About panel names it.

export type Refusal = { code: string; message?: string };
export type About = {
  build: string;
  ledger: { running: boolean; remote: string | null; commit: string | null } | null;
  refusal?: Refusal;
};
export type PaperHealth = { limit: number; runtime: string | null };
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

/** The paper daemon's line: its own limit on runs. */
export const paperLine = (health: PaperHealth) => `Up to ${health.limit} runs at once`;

/** The runtime image by the start of its digest, or as it is named when it has none. */
export const runtimeDigest = (runtime: string) => runtime.match(/sha256:[0-9a-f]{8}/)?.[0] ?? runtime;
