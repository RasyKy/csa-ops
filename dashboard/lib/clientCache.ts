// The browser's one shared cache. Memory only: nothing here touches localStorage,
// sessionStorage, cookies or IndexedDB, so a full page load starts empty.
//
// It is kept on globalThis under one property so it survives hot module reloads.
// On the server (where client components are rendered ahead of time) it is a
// cache that keeps nothing, so one visitor's data can never reach another's.
import { createCache, type SwrCache } from "./swrCache";
import { safeNextPath } from "./session";

const KEY = "__csaSwrCache";

function resolve(): SwrCache {
  if (typeof window === "undefined") return createCache({ maxEntries: 0 });
  const g = globalThis as unknown as Record<string, SwrCache | undefined>;
  const existing = g[KEY];
  if (existing) return existing;
  const created = createCache();
  g[KEY] = created;
  return created;
}

export const clientCache: SwrCache = resolve();

export function clearClientCache(): void {
  clientCache.clear();
}

let redirecting = false;

// The person signed out: nothing cached may outlive the session, and a poll that is
// still running when the cookie goes must not send the browser to sign-in a second
// time (the sign-out navigation is already on its way).
export function endClientSession(): void {
  clearClientCache();
  redirecting = true;
}

// A cached client fetch got a 401: the session is gone. Forget everything that
// was cached and go to the sign-in page once, coming back to this page after.
export function handleUnauthorized(): void {
  clearClientCache();
  if (typeof window === "undefined" || redirecting) return;
  const here = window.location.pathname + window.location.search;
  if (/^\/login(?:[/?#]|$)/.test(here)) return;
  redirecting = true;
  // slashes stay readable (?next=/incidents); everything else is encoded
  const next = encodeURIComponent(safeNextPath(here)).replace(/%2F/gi, "/");
  window.location.assign(`/login?next=${next}`);
}
