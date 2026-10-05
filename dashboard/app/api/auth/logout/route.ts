import { NextResponse } from "next/server";

import { clearCookie, originAllowed } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!originAllowed(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", clearCookie(process.env.NODE_ENV === "production"));
  return res;
}
