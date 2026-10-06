// Shared plumbing for the case proxy routes. Server only.
import { NextResponse } from "next/server";

import { backendFetch, isBackendUnavailable } from "@/lib/api";
import { sanitizeActorName } from "@/lib/actorName";

// Not a route, but it calls backendFetch, so it states the same limit as the
// routes that use it (see e2e/deploy_readiness.spec.ts).
export const maxDuration = 60;

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_BODY_BYTES = 8 * 1024;

export function badRequest(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status });
}

export function unavailable(): NextResponse {
  return NextResponse.json({ error: "backend_unavailable" }, { status: 503 });
}

// Backend status and JSON body pass through unchanged (409 carries the current
// case, 404 and 422 carry their details). Never adds the key or the upstream URL.
export async function relay(res: Awaited<ReturnType<typeof backendFetch>>): Promise<NextResponse> {
  if (isBackendUnavailable(res)) return unavailable();
  const body = await res.text();
  return new NextResponse(body, { status: res.status, headers: { "content-type": "application/json" } });
}

// The browser sends the name URI-encoded so any character survives an HTTP
// header. The backend takes the name as a header too, so characters outside
// Latin-1 are replaced with "?" on that last hop.
export function actorFromRequest(request: Request): string {
  const raw = request.headers.get("x-actor") ?? "";
  let decoded = raw;
  if (raw.includes("%")) {
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
  }
  return sanitizeActorName(decoded).replace(/[^ -ÿ]/g, "?");
}

// Validates a mutating request and returns its parsed JSON body, or the
// response to send instead.
export async function readJsonBody(request: Request): Promise<{ body: unknown } | { error: NextResponse }> {
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/json")) return { error: badRequest("unsupported_media_type", 415) };
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { error: badRequest("payload_too_large", 413) };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return { error: badRequest("payload_too_large", 413) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: badRequest("invalid_json") };
  }
  // Every case endpoint takes a JSON object.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: badRequest("invalid_json") };
  }
  return { body: parsed };
}

export async function forwardMutation(
  request: Request,
  id: string,
  method: "PATCH" | "POST",
  backendPath: string,
): Promise<NextResponse> {
  if (!ID_PATTERN.test(id)) return badRequest("invalid_id");
  const parsed = await readJsonBody(request);
  if ("error" in parsed) return parsed.error;
  const res = await backendFetch(backendPath, {
    method,
    headers: { "content-type": "application/json", "X-Actor": actorFromRequest(request) },
    body: JSON.stringify(parsed.body),
  });
  return relay(res);
}
