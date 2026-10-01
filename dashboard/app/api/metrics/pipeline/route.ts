import { NextRequest, NextResponse } from "next/server";

import { backendFetch } from "@/lib/api";

export async function GET(request: NextRequest) {
  const res = await backendFetch(`/metrics/pipeline${request.nextUrl.search}`);
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
