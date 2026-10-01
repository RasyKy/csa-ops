import { NextResponse } from "next/server";

import { backendFetch } from "@/lib/api";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const search = new URL(request.url).search;
  const res = await backendFetch(`/ai/explain/${params.id}${search}`, { method: "POST" });
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
