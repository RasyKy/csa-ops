import { NextResponse, type NextRequest } from "next/server";

import { COOKIE_NAME, originAllowed, safeNextPath, verifySession } from "@/lib/session";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function withHeaders(res: NextResponse, pathname: string): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "same-origin");
  if (pathname.startsWith("/api/")) res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (MUTATING.has(request.method)) {
    const host = request.headers.get("host") ?? request.nextUrl.host;
    if (!originAllowed(request.headers.get("origin"), host)) {
      return withHeaders(NextResponse.json({ error: "forbidden" }, { status: 403 }), pathname);
    }
  }

  const isLogin = pathname === "/login";
  const isPublic = isLogin || pathname.startsWith("/api/auth/");
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const authed = await verifySession(token, process.env.SESSION_SECRET, process.env.DASHBOARD_PASSWORD_HASH);

  if (isLogin && authed) {
    const target = request.nextUrl.clone();
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    const url = new URL(next, request.url);
    target.pathname = url.pathname;
    target.search = url.search;
    return withHeaders(NextResponse.redirect(target), pathname);
  }

  if (isPublic || authed) return withHeaders(NextResponse.next(), pathname);

  if (pathname.startsWith("/api/")) {
    return withHeaders(NextResponse.json({ error: "unauthorized" }, { status: 401 }), pathname);
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?next=${encodeURIComponent(safeNextPath(pathname + search))}`;
  return withHeaders(NextResponse.redirect(login), pathname);
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
