// Resolves the backend base URL from the environment. Pure and import-free.
//
// Production has no safe default: an unset or empty BACKEND_URL is an error so
// a misconfigured deployment fails loudly instead of quietly calling localhost.
// Outside production the default stays http://localhost:8000.
export type BackendUrlResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

const DEV_DEFAULT = "http://localhost:8000";

export function resolveBackendUrl(env: { BACKEND_URL?: string; NODE_ENV?: string }): BackendUrlResult {
  const raw = (env.BACKEND_URL ?? "").trim();
  if (raw === "") {
    if (env.NODE_ENV === "production") {
      return { ok: false, reason: "BACKEND_URL is not set" };
    }
    return { ok: true, url: DEV_DEFAULT };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "BACKEND_URL is not a valid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "BACKEND_URL must start with http:// or https://" };
  }
  return { ok: true, url: raw.replace(/\/+$/, "") };
}
