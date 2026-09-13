const DISPOSABLE_OWNER_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "::1",
  "rd-owner-api",
]);

export function disposableOwnerUrlV1(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const value = new URL(raw);
    if (value.protocol !== "http:" || !DISPOSABLE_OWNER_HOSTS.has(value.hostname)
      || value.username || value.password || value.search || value.hash
      || value.pathname !== "/") return null;
    return value.origin;
  } catch {
    return null;
  }
}
