// How the page reaches its own server, which forwards to the product and the services behind it. Their refusals
// are { code, message }, as the product's are. Live parses its own reply envelope (lib/liveTradingApi.ts).

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** An error in one line: a refusal as `CODE: message`. */
export const errorText = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));

/** The page's token for Paper, research-sync, setup and Live writes; empty when none of them is configured. */
const paperToken = () => document.querySelector<HTMLMetaElement>('meta[name="trade-paper-token"]')?.content ?? "";

/** A write refused before forwarding after a release can renew its nonce and retry exactly once. */
export async function pageFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const writing = !["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase());
  const send = () => {
    const headers = new Headers(init.headers);
    if (writing) headers.set("x-trade-paper-token", paperToken());
    return fetch(url, { ...init, headers });
  };
  let response = await send();
  const renewed = writing && response.status === 403 ? response.headers.get("x-trade-paper-token") : null;
  const meta = renewed && document.querySelector<HTMLMetaElement>('meta[name="trade-paper-token"]');
  if (meta && renewed) { meta.content = renewed; response = await send(); }
  return response;
}

/** One JSON request to the service `name` (AGENT, PAPER) under `url`; throws its refusal as an ApiError, `name`_UNAVAILABLE
 *  when nothing answered and `name`_FAILED when the answer is not JSON. `signIn`, when given, is what a 401 says. */
export async function serviceApi<T>(name: string, url: string, init: { method?: string; body?: unknown } = {}, signIn?: string): Promise<T> {
  let response: Response;
  try {
    response = await pageFetch(url, {
      method: init.method ?? "GET", cache: "no-store",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new ApiError(`${name}_UNAVAILABLE`, String(error));
  }
  if (signIn && response.status === 401) throw new ApiError("AUTH_REQUIRED", signIn);
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({ code: `${name}_FAILED`, message: `${response.status} ${response.statusText}` }));
  if (!response.ok) throw new ApiError(body.code ?? `${name}_FAILED`, body.message ?? "");
  return body as T;
}

/** A read the page's server did not answer with its JSON: the product's refusal, or nothing served (no such route,
 *  the product did not answer, the page offline). */
export type Unread = { kind: "refused"; code: string; message: string } | { kind: "absent"; message: string };

// The page's server's own failures, as against the product's refusals.
const SERVED = new Set(["PRODUCT_UNAVAILABLE", "PRODUCT_FAILED", "BAD_REQUEST", "NOT_FOUND"]);

/** One GET of the page's server: its JSON answer, or why there is none. */
export async function getJson<T>(url: string): Promise<{ kind: "ready"; body: T } | Unread> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => null) as (T & { code?: string; message?: string }) | null;
    if (response.ok && body) return { kind: "ready", body };
    if (body?.code && !SERVED.has(body.code)) return { kind: "refused", code: body.code, message: body.message ?? "" };
    return { kind: "absent", message: body?.message ?? `HTTP ${response.status}` };
  } catch (error) {
    return { kind: "absent", message: String(error) };
  }
}
