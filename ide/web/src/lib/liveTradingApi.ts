import { pageFetch } from "./transport";
import type { LiveReply } from "./liveTradingDto";

export class LiveApiError extends Error {
  constructor(readonly code: string, message: string, readonly requestId?: string) { super(message); }
}
export type LiveApi = <T>(path: string, input?: { body?: unknown }) => Promise<T>;

/** Only pageFetch's proved pre-forward nonce renewal repeats a POST by itself; any other repeat is the user's Send again. */
export const liveApi: LiveApi = async <T,>(path: string, input: { body?: unknown } = {}): Promise<T> => {
  let response: Response;
  try {
    response = await pageFetch(`/api/live${path}`, {
      method: input.body === undefined ? "GET" : "POST", cache: "no-store",
      headers: input.body === undefined ? undefined : { "content-type": "application/json" },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
  } catch { throw new LiveApiError("LIVE_UNAVAILABLE", "No reply from Live."); }
  if (response.status === 401) throw new LiveApiError("AUTH_REQUIRED", "Sign in again. Active runs continue on the server.");
  let reply: LiveReply<T>;
  try { reply = await response.json(); }
  catch { throw new LiveApiError("LIVE_RESPONSE_UNKNOWN", "The Live service did not return a readable reply."); }
  if (reply?.ok === true && response.ok) return reply.data;
  if (reply?.ok === false && typeof reply.error?.code === "string" && typeof reply.error.message === "string") {
    // HTTP failure does not establish whether the operation already produced partial effects.
    throw new LiveApiError(reply.error.code, reply.error.message, reply.request_id);
  }
  throw new LiveApiError("LIVE_RESPONSE_UNKNOWN", "The Live service reply could not be confirmed.");
};
