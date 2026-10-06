import { NextResponse } from "next/server";

import { backendFetch } from "@/lib/api";

import { badRequest, relay } from "../incidents/[id]/case/caseProxy";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const PASS_THROUGH = ["status", "assignee"] as const;

export async function GET(request: Request): Promise<NextResponse> {
  const incoming = new URL(request.url).searchParams;
  const outgoing = new URLSearchParams();
  for (const key of PASS_THROUGH) {
    const value = incoming.get(key);
    if (value === null) continue;
    if (value.length > 64) return badRequest("invalid_query");
    outgoing.set(key, value);
  }
  const qs = outgoing.toString();
  return relay(await backendFetch(`/cases${qs ? `?${qs}` : ""}`));
}
