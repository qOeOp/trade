import { pageFetch } from "./paperApi";
import type { LiveReply } from "./liveTradingDto";

export class LiveApiError extends Error {
  constructor(readonly code: string, message: string, readonly requestId?: string) { super(message); }
}
export type LiveApi = <T>(path: string, input?: { body?: unknown }) => Promise<T>;

/** Only pageFetch's proved pre-forward nonce renewal can repeat a POST. All other recovery is GET. */
export const liveApi: LiveApi = async <T,>(path: string, input: { body?: unknown } = {}): Promise<T> => {
  let response: Response;
  try {
    response = await pageFetch(`/api/live${path}`, {
      method: input.body === undefined ? "GET" : "POST", cache: "no-store",
      headers: input.body === undefined ? undefined : { "content-type": "application/json" },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
  } catch { throw new LiveApiError("LIVE_UNAVAILABLE", "The Live request result is unknown. Check its status before submitting another action."); }
  if (response.status === 401) throw new LiveApiError("AUTH_REQUIRED", "Sign in again to read the existing request and run. Active runs continue on the server.");
  let reply: LiveReply<T>;
  try { reply = await response.json(); }
  catch { throw new LiveApiError("LIVE_RESPONSE_UNKNOWN", "The Live service did not return a readable result. The original request will be checked."); }
  if (reply?.ok === true && response.ok) return reply.data;
  if (reply?.ok === false && typeof reply.error?.code === "string" && typeof reply.error.message === "string") {
    // HTTP failure does not establish whether the operation already produced partial effects.
    throw new LiveApiError(reply.error.code, reply.error.message, reply.request_id);
  }
  throw new LiveApiError("LIVE_RESPONSE_UNKNOWN", "The Live service response could not be confirmed. The original request will be checked.");
};
