import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

export const LOCAL_OPERATOR_PRINCIPAL = "local_operator" as const;
export const LOCAL_OPERATOR_SESSION_COOKIE = "trade_dashboard_session_v1" as const;
export const LOCAL_OPERATOR_SESSION_TTL_SECONDS = 8 * 60 * 60;

const SESSION_SCHEMA_VERSION = 1;
const MAX_SECRET_BYTES = 4_096;
const MIN_SECRET_BYTES = 32;
const MAX_SESSION_BYTES = 8_192;

type SessionConfiguration = {
  loginToken: string;
  hmacKey: string;
};

type SessionPayloadV1 = {
  schema_version: 1;
  session_identity: string;
  principal_ref: typeof LOCAL_OPERATOR_PRINCIPAL;
  credential_digest: string;
  issued_at_epoch_s: number;
  expires_at_epoch_s: number;
};

export type LocalOperatorSessionStateV1 =
  | {
    schema_version: 1;
    state: "authenticated";
    authenticated: true;
    unavailable_reason: null;
    principal_ref: typeof LOCAL_OPERATOR_PRINCIPAL;
    session_identity: string;
    issued_at: string;
    expires_at: string;
  }
  | {
    schema_version: 1;
    state: "required" | "invalid" | "expired" | "configuration_unavailable";
    authenticated: false;
    unavailable_reason:
      | "SESSION_REQUIRED"
      | "SESSION_INVALID"
      | "SESSION_EXPIRED"
      | "SESSION_CONFIGURATION_UNAVAILABLE";
    principal_ref: typeof LOCAL_OPERATOR_PRINCIPAL | null;
    session_identity: string | null;
    issued_at: string | null;
    expires_at: string | null;
  };

export type IssuedLocalOperatorSessionV1 = {
  token: string;
  state: Extract<LocalOperatorSessionStateV1, { state: "authenticated" }>;
};

function validSecret(value: string | undefined): value is string {
  if (!value) return false;
  const bytes = Buffer.byteLength(value, "utf8");
  return bytes >= MIN_SECRET_BYTES && bytes <= MAX_SECRET_BYTES;
}

function configuredSession(
  loginToken: string | undefined = process.env.DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN,
  hmacKey: string | undefined = process.env.DASHBOARD_SESSION_HMAC_KEY,
): SessionConfiguration | null {
  return validSecret(loginToken) && validSecret(hmacKey) ? { loginToken, hmacKey } : null;
}

function credentialDigest(loginToken: string): string {
  return createHash("sha256").update(loginToken, "utf8").digest("hex");
}

function unavailable(
  state: "required" | "invalid" | "expired" | "configuration_unavailable",
  payload?: SessionPayloadV1,
): LocalOperatorSessionStateV1 {
  const reasons = {
    required: "SESSION_REQUIRED",
    invalid: "SESSION_INVALID",
    expired: "SESSION_EXPIRED",
    configuration_unavailable: "SESSION_CONFIGURATION_UNAVAILABLE",
  } as const;
  return {
    schema_version: 1,
    state,
    authenticated: false,
    unavailable_reason: reasons[state],
    principal_ref: payload?.principal_ref ?? null,
    session_identity: payload?.session_identity ?? null,
    issued_at: payload ? new Date(payload.issued_at_epoch_s * 1_000).toISOString() : null,
    expires_at: payload ? new Date(payload.expires_at_epoch_s * 1_000).toISOString() : null,
  };
}

function available(payload: SessionPayloadV1): LocalOperatorSessionStateV1 {
  return {
    schema_version: 1,
    state: "authenticated",
    authenticated: true,
    unavailable_reason: null,
    principal_ref: payload.principal_ref,
    session_identity: payload.session_identity,
    issued_at: new Date(payload.issued_at_epoch_s * 1_000).toISOString(),
    expires_at: new Date(payload.expires_at_epoch_s * 1_000).toISOString(),
  };
}

function isPayloadV1(value: unknown): value is SessionPayloadV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join(",") !== [
    "credential_digest",
    "expires_at_epoch_s",
    "issued_at_epoch_s",
    "principal_ref",
    "schema_version",
    "session_identity",
  ].join(",")) return false;
  return candidate.schema_version === SESSION_SCHEMA_VERSION
    && candidate.principal_ref === LOCAL_OPERATOR_PRINCIPAL
    && typeof candidate.session_identity === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(candidate.session_identity)
    && typeof candidate.credential_digest === "string"
    && /^[0-9a-f]{64}$/u.test(candidate.credential_digest)
    && Number.isSafeInteger(candidate.issued_at_epoch_s)
    && Number.isSafeInteger(candidate.expires_at_epoch_s);
}

function encodePayload(payload: SessionPayloadV1): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signPayload(encodedPayload: string, key: string): string {
  return createHmac("sha256", key).update(encodedPayload, "ascii").digest("base64url");
}

export function verifyLocalOperatorCredentialV1(
  credential: string,
  loginToken: string | undefined = process.env.DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN,
  hmacKey: string | undefined = process.env.DASHBOARD_SESSION_HMAC_KEY,
): "available" | "configuration_unavailable" | "denied" {
  const configuration = configuredSession(loginToken, hmacKey);
  if (!configuration) return "configuration_unavailable";
  if (Buffer.byteLength(credential, "utf8") > MAX_SECRET_BYTES) return "denied";
  const expected = Buffer.from(configuration.loginToken, "utf8");
  const provided = Buffer.from(credential, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided) ? "available" : "denied";
}

export function issueLocalOperatorSessionV1({
  nowEpochSeconds = Math.floor(Date.now() / 1_000),
  loginToken = process.env.DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN,
  hmacKey = process.env.DASHBOARD_SESSION_HMAC_KEY,
  sessionIdentity = randomUUID(),
}: {
  nowEpochSeconds?: number;
  loginToken?: string;
  hmacKey?: string;
  sessionIdentity?: string;
} = {}): IssuedLocalOperatorSessionV1 | null {
  const configuration = configuredSession(loginToken, hmacKey);
  if (!configuration || !Number.isSafeInteger(nowEpochSeconds) || nowEpochSeconds < 0) return null;
  const payload: SessionPayloadV1 = {
    schema_version: SESSION_SCHEMA_VERSION,
    session_identity: sessionIdentity,
    principal_ref: LOCAL_OPERATOR_PRINCIPAL,
    credential_digest: credentialDigest(configuration.loginToken),
    issued_at_epoch_s: nowEpochSeconds,
    expires_at_epoch_s: nowEpochSeconds + LOCAL_OPERATOR_SESSION_TTL_SECONDS,
  };
  if (!isPayloadV1(payload)) return null;
  const encodedPayload = encodePayload(payload);
  return {
    token: `${encodedPayload}.${signPayload(encodedPayload, configuration.hmacKey)}`,
    state: available(payload) as Extract<LocalOperatorSessionStateV1, { state: "authenticated" }>,
  };
}

export function readLocalOperatorSessionV1(
  token: string | undefined,
  {
    nowEpochSeconds = Math.floor(Date.now() / 1_000),
    loginToken = process.env.DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN,
    hmacKey = process.env.DASHBOARD_SESSION_HMAC_KEY,
  }: {
    nowEpochSeconds?: number;
    loginToken?: string;
    hmacKey?: string;
  } = {},
): LocalOperatorSessionStateV1 {
  const configuration = configuredSession(loginToken, hmacKey);
  if (!configuration) return unavailable("configuration_unavailable");
  if (!token) return unavailable("required");
  if (Buffer.byteLength(token, "utf8") > MAX_SESSION_BYTES || !Number.isSafeInteger(nowEpochSeconds)) {
    return unavailable("invalid");
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return unavailable("invalid");
  const [encodedPayload, signature] = parts;
  let suppliedSignature: Buffer;
  let payload: unknown;
  try {
    suppliedSignature = Buffer.from(signature, "base64url");
    if (suppliedSignature.toString("base64url") !== signature) return unavailable("invalid");
    const decoded = Buffer.from(encodedPayload, "base64url");
    if (decoded.toString("base64url") !== encodedPayload) return unavailable("invalid");
    payload = JSON.parse(decoded.toString("utf8"));
  } catch {
    return unavailable("invalid");
  }
  const expectedSignature = Buffer.from(signPayload(encodedPayload, configuration.hmacKey), "base64url");
  if (nowEpochSeconds < 0
    || suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)
    || !isPayloadV1(payload)
    || payload.credential_digest !== credentialDigest(configuration.loginToken)
    || payload.expires_at_epoch_s - payload.issued_at_epoch_s !== LOCAL_OPERATOR_SESSION_TTL_SECONDS
    || payload.issued_at_epoch_s > nowEpochSeconds + 30) {
    return unavailable("invalid");
  }
  if (payload.expires_at_epoch_s <= nowEpochSeconds) return unavailable("expired", payload);
  return available(payload);
}
