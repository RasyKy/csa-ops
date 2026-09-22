// Server-only. Never import this from a "use client" component -- it carries
// the dashboard API key, which must never reach the browser (CLAUDE.md rule 10).
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";

export async function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "X-API-Key": DASHBOARD_API_KEY,
    },
    cache: "no-store",
  });
}
