import { NextRequest, NextResponse } from "next/server";

import { backendFetch, isBackendUnavailable } from "@/lib/api";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const res = await backendFetch(`/metrics/mitre${request.nextUrl.search}`);
  if (isBackendUnavailable(res)) {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 });
  }
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

