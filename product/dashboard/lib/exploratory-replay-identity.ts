const RUST_EDGE_WHITESPACE = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;

export function validExploratoryReplayOpaqueIdentityV2(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
    && !RUST_EDGE_WHITESPACE.test(value)
    && new TextEncoder().encode(value).byteLength <= 256;
}

export function encodeExploratoryReplayOpaqueIdentityV2(value: string): string | null {
  if (!validExploratoryReplayOpaqueIdentityV2(value)) return null;
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeExploratoryReplayOpaqueIdentityV2(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || !/^[A-Za-z0-9_-]+$/u.test(value)
    || value.length % 4 === 1) return null;
  try {
    const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat((4 - value.length % 4) % 4)}`;
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return validExploratoryReplayOpaqueIdentityV2(decoded)
      && encodeExploratoryReplayOpaqueIdentityV2(decoded) === value
      ? decoded
      : null;
  } catch {
    return null;
  }
}
