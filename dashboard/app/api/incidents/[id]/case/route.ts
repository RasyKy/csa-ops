import { NextResponse } from "next/server";

import { backendFetch } from "@/lib/api";

import { ID_PATTERN, badRequest, forwardMutation, relay } from "./caseProxy";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  if (!ID_PATTERN.test(params.id)) return badRequest("invalid_id");
  return relay(await backendFetch(`/incidents/${params.id}/case`));
}

export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return forwardMutation(request, params.id, "PATCH", `/incidents/${params.id}/case`);
}
