import { NextResponse, type NextRequest } from "next/server";

import { routeFor } from "@/lib/hosts";

/** Keeps the shop on gituas.com and the newsroom on hawalnoos.com (rules in src/lib/hosts.ts). */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const route = routeFor(request.headers.get("host") ?? "", pathname, search);
  if (route.kind === "redirect") return NextResponse.redirect(route.url, 307);
  if (route.kind === "rewrite") {
    const url = request.nextUrl.clone();
    url.pathname = route.path;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except build assets; routeFor itself lets APIs, media and files through.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
