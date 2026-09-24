// Binds an Owner-clock read to the request that asked for it.
//
// The Formation catalog, historical custody and Iteration timeline projections are stamped from the
// R&D Owner's clock, so their observation time cannot be placed in this process's request window.
// Each read instead sends a fresh nonce, and the read API returns it only beside a projection the
// Owner produced for that request; an answer that does not echo this read's own nonce is not its
// answer.

export const OWNER_READ_NONCE_HEADER = "x-dashboard-read-nonce";

const NONCE_BYTES = 16;

// 128 bits from the platform's cryptographic source, as 32 lowercase hexadecimal digits.
export function newOwnerReadNonceV1(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function ownerReadNonceEchoedV1(response: Response, nonce: string): boolean {
  return response.headers.get(OWNER_READ_NONCE_HEADER) === nonce;
}
