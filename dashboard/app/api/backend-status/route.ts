import { NextResponse } from "next/server";

import { getBackendUrl } from "@/lib/api";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

export const dynamic = "force-dynamic";

export async function GET() {
  const baseUrl = getBackendUrl();
  if (baseUrl === null) {
    return NextResponse.json({ ok: false });
  }
  try {
    const result = await fetchWithTimeout(
      `${baseUrl}/healthz`,
      { cache: "no-store" },
      4000,
    );
    if (!result.ok) {
      return NextResponse.json({ ok: false });
    }
    const isOk = result.response.status === 200;
    return NextResponse.json({ ok: isOk });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
