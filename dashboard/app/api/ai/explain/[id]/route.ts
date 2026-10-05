import { NextResponse } from "next/server";

import { backendFetch, isBackendUnavailable } from "@/lib/api";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const search = new URL(request.url).search;
  const res = await backendFetch(`/ai/explain/${params.id}${search}`, { method: "POST" });
  if (isBackendUnavailable(res)) {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 });
  }
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

