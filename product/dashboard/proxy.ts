import { NextRequest, NextResponse } from "next/server";

import {
  LOCAL_OPERATOR_SESSION_COOKIE,
  readLocalOperatorSessionV1,
} from "@/lib/local-operator-session";
import { secureCookieForRequestV1 } from "@/lib/local-operator-request";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/session", "/api/health"]);
const PUBLIC_ASSETS = new Set(["/icon.svg", "/favicon.ico"]);

function normalizedPathname(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/$/u, "") : pathname;
}

function isPublicPath(pathname: string): boolean {
  const normalized = normalizedPathname(pathname);
  return PUBLIC_PATHS.has(normalized)
    || PUBLIC_ASSETS.has(normalized)
    || normalized.startsWith("/_next/");
}

function clearInvalidCookie(response: NextResponse, request: NextRequest) {
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

export function proxy(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();
  const state = readLocalOperatorSessionV1(request.cookies.get(LOCAL_OPERATOR_SESSION_COOKIE)?.value);
  if (state.authenticated) return NextResponse.next();

  const isApi = normalizedPathname(request.nextUrl.pathname).startsWith("/api/");
  if (isApi) {
    const response = NextResponse.json(state, {
      status: state.state === "configuration_unavailable" ? 503 : 401,
      headers: { "cache-control": "no-store" },
    });
    if (state.state === "invalid" || state.state === "expired") clearInvalidCookie(response, request);
    return response;
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  login.searchParams.set("return_to", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  login.searchParams.set("state", state.state);
  const response = NextResponse.redirect(login);
  response.headers.set("cache-control", "no-store");
  if (state.state === "invalid" || state.state === "expired") clearInvalidCookie(response, request);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
