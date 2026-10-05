import { NextResponse } from "next/server";

import { forwardMutation } from "../caseProxy";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return forwardMutation(request, params.id, "POST", `/incidents/${params.id}/case/notes`);
}
