// Server-only. Never import this from a "use client" component -- it carries
// the dashboard API key, which must never reach the browser (CLAUDE.md rule 10).
import { fetchWithTimeout } from "./fetchWithTimeout";
import { resolveBackendUrl } from "./backendUrl";

// Resolved on every call (cheap) rather than at import time, so a build that
// imports this module without BACKEND_URL does not log. A bad value is reported
// once per process, by variable name only, never with any key.
const LOGGED_FLAG = "__csaBackendUrlLogged";

export function getBackendUrl(): string | null {
  const result = resolveBackendUrl({
    BACKEND_URL: process.env.BACKEND_URL,
    NODE_ENV: process.env.NODE_ENV,
  });
  if (result.ok) return result.url;
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (!g[LOGGED_FLAG]) {
    g[LOGGED_FLAG] = true;
    console.error(`[dashboard] ${result.reason}. Backend calls will return backend_unavailable until BACKEND_URL is fixed.`);
  }
  return null;
}

const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY ?? "";

export type BackendUnavailable = {
  readonly ok: false;
  readonly status: 503;
  readonly error: "backend_unavailable";
};

export type BackendFetchResult = Response | BackendUnavailable;

export function isBackendUnavailable(res: unknown): res is BackendUnavailable {
  return (
    typeof res === "object" &&
    res !== null &&
    "error" in res &&
    (res as { error: unknown }).error === "backend_unavailable"
  );
}

export async function backendFetch(
  path: string,
  init?: RequestInit,
): Promise<BackendFetchResult> {
  const baseUrl = getBackendUrl();
  if (baseUrl === null) {
    return { ok: false, status: 503, error: "backend_unavailable" };
  }

  const headers = new Headers(init?.headers);
  headers.delete("cookie");
  headers.delete("Cookie");
  headers.set("X-API-Key", DASHBOARD_API_KEY);

  const url = `${baseUrl}${path}`;

  try {
    const result = await fetchWithTimeout(
      url,
      {
        ...init,
        headers,
        cache: "no-store",
      },
      55000,
    );

    if (!result.ok) {
      return { ok: false, status: 503, error: "backend_unavailable" };
    }

    return result.response;
  } catch {
    return { ok: false, status: 503, error: "backend_unavailable" };
  }
}
