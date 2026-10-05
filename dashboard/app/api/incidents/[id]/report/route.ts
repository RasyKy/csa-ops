import { NextResponse } from "next/server";

import { backendFetch, isBackendUnavailable } from "@/lib/api";

export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "md";
  const res = await backendFetch(`/incidents/${params.id}/report?format=${encodeURIComponent(format)}`);
  if (isBackendUnavailable(res)) {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 });
  }
  const body = await res.arrayBuffer();
  const headers: Record<string, string> = {};
  const contentType = res.headers.get("content-type") || (format === "pdf" ? "application/pdf" : "text/markdown");
  headers["content-type"] = contentType;
  const disposition = res.headers.get("content-disposition");
  if (disposition) headers["content-disposition"] = disposition;
  return new NextResponse(body, { status: res.status, headers });
}

