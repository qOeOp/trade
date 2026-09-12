export function sameOriginRequestV1(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const supplied = new URL(origin);
    const requestUrl = new URL(request.url);
    if (supplied.origin === requestUrl.origin) return true;
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim()
      ?? request.headers.get("host");
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim()
      ?? requestUrl.protocol.slice(0, -1);
    return Boolean(forwardedHost)
      && supplied.host === forwardedHost
      && supplied.protocol === `${forwardedProtocol}:`;
  } catch {
    return false;
  }
}

export function secureCookieForRequestV1(request: Request): boolean {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  return forwardedProtocol ? forwardedProtocol === "https" : new URL(request.url).protocol === "https:";
}
