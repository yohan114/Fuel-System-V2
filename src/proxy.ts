import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  // Log incoming request details for diagnostic purposes
  console.log(`[Proxy Log] ${method} ${pathname} | Host: ${request.headers.get("host")} | Origin: ${request.headers.get("origin")} | X-Forwarded-Host: ${request.headers.get("x-forwarded-host")} | X-Forwarded-Proto: ${request.headers.get("x-forwarded-proto")}`);

  // Let machine endpoints pass: cron (CRON_SECRET), report exports (self-authed),
  // health (public), and the portal read API (X-Portal-Token in the handler).
  if (
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/reports/export") ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/portal")
  ) {
    return NextResponse.next();
  }

  // Skip auth checks for login page and static assets
  if (
    pathname === "/login" ||
    pathname.startsWith("/_next") ||
    pathname.includes("favicon.ico") ||
    pathname.startsWith("/public")
  ) {
    return NextResponse.next();
  }

  // Verify session cookie presence
  const session = request.cookies.get("session")?.value;
  if (!session) {
    console.log(`[Proxy Log] No session cookie found for ${pathname}. Redirecting to /login`);
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Keep track of the original page to redirect back after login
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
};

