// Login attempt throttle. Pure and import-free.
//
// All state lives under one well-known property of a store object (globalThis by
// default), so every module instance that creates a throttle over the same store
// shares it. That matters in the dev server, which re-evaluates route modules on
// hot reload and would otherwise reset a module-level Map.
//
// Best effort only: on serverless every instance has its own memory, so this slows
// a guesser down but is not a hard limit (docs/auth.md).

export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 10 * 60 * 1000;
export const BLOCK_MS = 5 * 60 * 1000;
export const MAX_TRACKED_KEYS = 1000;
export const STORE_PROPERTY = "__csaOpsLoginThrottle";

interface Entry {
  failures: number[];
  blockedUntil: number;
}

export interface Throttle {
  isBlocked(key: unknown, now: number): boolean;
  recordFailure(key: unknown, now: number): void;
  clear(key: unknown): void;
  retryAfterSeconds(key: unknown, now: number): number;
}

function normalizeKey(key: unknown): string {
  return typeof key === "string" && key !== "" ? key : "unknown";
}

export function createThrottle(store: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): Throttle {
  function entries(): Map<string, Entry> {
    const existing = store[STORE_PROPERTY];
    if (existing instanceof Map) return existing as Map<string, Entry>;
    const fresh = new Map<string, Entry>();
    store[STORE_PROPERTY] = fresh;
    return fresh;
  }

  function prune(map: Map<string, Entry>, now: number): void {
    map.forEach((entry, k) => {
      if (!entry || !Array.isArray(entry.failures) || typeof entry.blockedUntil !== "number") {
        map.delete(k); // damaged entry
        return;
      }
      if (entry.blockedUntil <= now && entry.failures.every((t) => now - t > FAILURE_WINDOW_MS)) map.delete(k);
    });
  }

  function retryAfterSeconds(key: unknown, now: number): number {
    try {
      const map = entries();
      prune(map, now);
      const entry = map.get(normalizeKey(key));
      return entry && entry.blockedUntil > now ? Math.ceil((entry.blockedUntil - now) / 1000) : 0;
    } catch {
      return 0;
    }
  }

  return {
    isBlocked(key, now) {
      return retryAfterSeconds(key, now) > 0;
    },

    retryAfterSeconds,

    recordFailure(key, now) {
      try {
        const map = entries();
        prune(map, now);
        const k = normalizeKey(key);
        if (!map.has(k) && map.size >= MAX_TRACKED_KEYS) {
          const oldest = map.keys().next().value;
          if (oldest !== undefined) map.delete(oldest);
        }
        const entry = map.get(k) ?? { failures: [], blockedUntil: 0 };
        entry.failures = entry.failures.filter((t) => now - t <= FAILURE_WINDOW_MS);
        entry.failures.push(now);
        if (entry.failures.length >= MAX_FAILURES) {
          entry.blockedUntil = now + BLOCK_MS;
          entry.failures = [];
        }
        map.set(k, entry);
      } catch {
        // a throttle problem must never break sign-in
      }
    },

    clear(key) {
      try {
        entries().delete(normalizeKey(key));
      } catch {
        // see above
      }
    },
  };
}
