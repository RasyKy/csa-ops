import { NextResponse } from "next/server";

import { backendFetch } from "@/lib/api";

import { relay } from "../../incidents/[id]/case/caseProxy";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return relay(await backendFetch("/cases/assignees"));
}
