const RUST_EDGE_WHITESPACE = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;

export function validExploratoryReplayOpaqueIdentityV2(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
    && !RUST_EDGE_WHITESPACE.test(value)
    && new TextEncoder().encode(value).byteLength <= 256;
}
