import { NextRequest, NextResponse } from "next/server";

import {
  issueLocalOperatorSessionV1,
  LOCAL_OPERATOR_SESSION_COOKIE,
  LOCAL_OPERATOR_SESSION_TTL_SECONDS,
  readLocalOperatorSessionV1,
  verifyLocalOperatorCredentialV1,
} from "@/lib/local-operator-session";
import { sameOriginRequestV1, secureCookieForRequestV1 } from "@/lib/local-operator-request";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const MAX_LOGIN_BODY_BYTES = 8_192;

function sessionState(request: NextRequest) {
  return readLocalOperatorSessionV1(request.cookies.get(LOCAL_OPERATOR_SESSION_COOKIE)?.value);
}

function clearSessionCookie(response: NextResponse, request: Request) {
  response.cookies.set({
    name: LOCAL_OPERATOR_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: secureCookieForRequestV1(request),
    path: "/",
    maxAge: 0,
  });
}

export function GET(request: NextRequest) {
  const state = sessionState(request);
  const response = NextResponse.json(state, {
    status: state.state === "configuration_unavailable" ? 503 : 200,
    headers: NO_STORE,
  });
  if (state.state === "invalid" || state.state === "expired") clearSessionCookie(response, request);
  return response;
}

export async function POST(request: NextRequest) {
  if (!sameOriginRequestV1(request)) {
    return NextResponse.json({ schema_version: 1, state: "invalid", unavailable_reason: "SESSION_ORIGIN_DENIED" }, {
      status: 403,
      headers: NO_STORE,
    });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ schema_version: 1, state: "invalid", unavailable_reason: "SESSION_REQUEST_INVALID" }, {
      status: 400,
      headers: NO_STORE,
    });
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > MAX_LOGIN_BODY_BYTES) {
    return NextResponse.json({ schema_version: 1, state: "invalid", unavailable_reason: "SESSION_REQUEST_INVALID" }, {
      status: 400,
      headers: NO_STORE,
    });
  }
  let value: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_LOGIN_BODY_BYTES) throw new Error("body too large");
    value = JSON.parse(text);
  } catch {
    return NextResponse.json({ schema_version: 1, state: "invalid", unavailable_reason: "SESSION_REQUEST_INVALID" }, {
      status: 400,
      headers: NO_STORE,
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return NextResponse.json({ schema_version: 1, state: "invalid", unavailable_reason: "SESSION_REQUEST_INVALID" }, {
      status: 400,
      headers: NO_STORE,
    });
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).join(",") !== "credential" || typeof body.credential !== "string") {
    return NextResponse.json({ schema_version: 1, state: "invalid", unavailable_reason: "SESSION_REQUEST_INVALID" }, {
      status: 400,
      headers: NO_STORE,
    });
  }
  const credentialState = verifyLocalOperatorCredentialV1(body.credential);
  if (credentialState !== "available") {
    return NextResponse.json({
      schema_version: 1,
      state: credentialState === "configuration_unavailable" ? "configuration_unavailable" : "invalid",
      unavailable_reason: credentialState === "configuration_unavailable"
        ? "SESSION_CONFIGURATION_UNAVAILABLE"
        : "SESSION_CREDENTIAL_DENIED",
    }, { status: credentialState === "configuration_unavailable" ? 503 : 401, headers: NO_STORE });
  }
  const issued = issueLocalOperatorSessionV1();
  if (!issued) {
    return NextResponse.json({
      schema_version: 1,
      state: "configuration_unavailable",
      unavailable_reason: "SESSION_CONFIGURATION_UNAVAILABLE",
    }, { status: 503, headers: NO_STORE });
  }
  const response = NextResponse.json(issued.state, { status: 200, headers: NO_STORE });
  response.cookies.set({
    name: LOCAL_OPERATOR_SESSION_COOKIE,
    value: issued.token,
    httpOnly: true,
    sameSite: "strict",
    secure: secureCookieForRequestV1(request),
    path: "/",
    maxAge: LOCAL_OPERATOR_SESSION_TTL_SECONDS,
  });
  return response;
}

export function DELETE(request: NextRequest) {
  if (!sameOriginRequestV1(request)) {
    return NextResponse.json({ schema_version: 1, state: "invalid", unavailable_reason: "SESSION_ORIGIN_DENIED" }, {
      status: 403,
      headers: NO_STORE,
    });
  }
  const response = NextResponse.json({
    schema_version: 1,
    state: "required",
    authenticated: false,
    unavailable_reason: "SESSION_REQUIRED",
    principal_ref: null,
    session_identity: null,
    issued_at: null,
    expires_at: null,
  }, { status: 200, headers: NO_STORE });
  clearSessionCookie(response, request);
  return response;
}
