// A deployment's first start (`ledger service run --setup`, forwarded by the page's server under /api/setup/).
import { pageFetch } from "./paperApi";

export type SetupRefusal = { code: string; message: string };
export type Setup = {
  state: "waiting" | "running" | "done" | "blocked";
  repository: string | null;
  public_key: string | null;
  step: string | null;
  refusal: SetupRefusal | null;
};

const URL = "/api/setup/";
const isSetup = (value: unknown): value is Setup => typeof (value as Setup | null)?.state === "string";

/** Where the first start stands; "none" with no setup port behind this page; "down" when none answers now, which
 *  is also how a service that has its ledger and never opened the port looks. */
export async function readSetup(): Promise<Setup | "none" | "down"> {
  try {
    const response = await fetch(URL, { cache: "no-store" });
    if (response.status === 404) return "none";
    const body: unknown = await response.json();
    return response.ok && isSetup(body) ? body : "down";
  } catch {
    return "down";
  }
}

/** Starts the first start with `repository`; what the service answered, or why it refused. */
export async function askSetup(repository: string): Promise<Setup | SetupRefusal> {
  const failed = (message: string) => ({ code: "SETUP_UNAVAILABLE", message });
  try {
    const response = await pageFetch(URL, {
      method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
      body: JSON.stringify({ repository }),
    });
    const body = await response.json() as Setup | SetupRefusal;
    return isSetup(body) || "code" in body ? body : failed(`${response.status}`);
  } catch (error) {
    return failed(String(error));
  }
}

/** Refusals of the repository: the page goes back to asking for it. */
const OF_REPOSITORY = new Set(["BOOTSTRAP_FAILED", "REMOTE_INVALID", "SERVICE_CHECK_FAILED", "ISOLATION_BREACH", "USAGE_ERROR"]);
export const refusesRepository = (refusal: SetupRefusal | null) => refusal !== null && OF_REPOSITORY.has(refusal.code);
export const refusesKey = (refusal: SetupRefusal | null) => refusal?.code === "DOLTHUB_CREDENTIALS";

/** A question the page is asking. A repository the deployment already names is not asked for, unless it failed or
 *  the operator went back to change it. */
export const question = (setup: Setup, refusal: SetupRefusal | null, repository: string | null, changing: boolean): "repository" | "key" =>
  changing || refusesRepository(refusal) || !(repository ?? setup.repository) ? "repository" : "key";

/** What the page's field may hold before it is worth asking: the service decides. */
export const namesRepository = (text: string) => /[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/.test(text);

/** A step of the bootstrap, as the page shows it. */
export function stepLine(step: string | null): string {
  const text = (step ?? "starting").replace("https://doltremoteapi.dolthub.com/", "");
  return `${text[0]!.toUpperCase()}${text.slice(1)}…`;
}
