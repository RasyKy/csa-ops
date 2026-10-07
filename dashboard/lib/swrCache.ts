// A small stale-while-revalidate cache. Pure and import-free.
//
// shareStructure keeps object identity for everything that did not change, so a
// refresh that brings back the same data produces the very same references and
// React has nothing to re-render. createCache stores JSON values by string key
// with a maximum age and a maximum number of entries.

const MAX_DEPTH = 50;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function share(prev: unknown, next: unknown, depth: number, path: Set<object>): unknown {
  if (Object.is(prev, next)) return prev;
  if (depth >= MAX_DEPTH) return next;
  const nextIsArray = Array.isArray(next);
  const nextIsObject = isPlainObject(next);
  if (!nextIsArray && !nextIsObject) return next;
  // a value that contains itself cannot be compared structurally
  if (path.has(next as object)) return next;
  path.add(next as object);
  try {
    if (nextIsArray) {
      if (!Array.isArray(prev)) return next;
      const n = next as unknown[];
      let same = prev.length === n.length;
      const out: unknown[] = new Array(n.length);
      for (let i = 0; i < n.length; i++) {
        const kept = i < prev.length ? share(prev[i], n[i], depth + 1, path) : n[i];
        out[i] = kept;
        if (same && kept !== prev[i]) same = false;
      }
      return same ? prev : out;
    }
    if (!isPlainObject(prev)) return next;
    const n = next as Record<string, unknown>;
    const nextKeys = Object.keys(n);
    let same = nextKeys.length === Object.keys(prev).length;
    const out: Record<string, unknown> = {};
    for (const k of nextKeys) {
      const had = hasOwn(prev, k);
      const kept = had ? share(prev[k], n[k], depth + 1, path) : n[k];
      out[k] = kept;
      if (same && (!had || kept !== prev[k])) same = false;
    }
    return same ? prev : out;
  } finally {
    path.delete(next as object);
  }
}

// Returns prev (the same reference) when next is deeply equal to it. Otherwise
// returns a new value that reuses, by reference, every sub-object and array
// element of prev that is deeply equal to its counterpart. Arrays are compared
// position by position, objects key by key (key order does not matter). Never
// throws; beyond a depth of 50, or for a value that contains itself, it returns
// the new value as it is.
export function shareStructure<T>(prev: unknown, next: T): T {
  try {
    return share(prev, next, 0, new Set()) as T;
  } catch {
    return next;
  }
}

export interface CacheOptions {
  now?: () => number;
  maxEntries?: number;
  maxAgeMs?: number;
}

export interface CacheEntry<T = unknown> {
  data: T;
  fetchedAt: number;
}

export interface SwrCache {
  get<T = unknown>(key: string): CacheEntry<T> | undefined;
  set<T>(key: string, data: T, fetchedAt?: number): T;
  patch<T = unknown>(key: string, updater: (data: T) => T): T | undefined;
  delete(key: string): void;
  deletePrefix(prefix: string): void;
  clear(): void;
  size(): number;
}

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

const validKey = (key: unknown): key is string => typeof key === "string" && key.length > 0;

export function createCache(options: CacheOptions = {}): SwrCache {
  const now = options.now ?? (() => Date.now());
  const maxEntries = typeof options.maxEntries === "number" && options.maxEntries >= 0 ? options.maxEntries : DEFAULT_MAX_ENTRIES;
  const maxAgeMs = typeof options.maxAgeMs === "number" && options.maxAgeMs >= 0 ? options.maxAgeMs : DEFAULT_MAX_AGE_MS;
  // a Map iterates in insertion order, so the first key is the oldest write
  const entries = new Map<string, CacheEntry>();

  const evict = () => {
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  };

  const get = <T = unknown>(key: string): CacheEntry<T> | undefined => {
    if (!validKey(key)) return undefined;
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (now() - entry.fetchedAt > maxAgeMs) {
      entries.delete(key);
      return undefined;
    }
    return entry as CacheEntry<T>;
  };

  const set = <T>(key: string, data: T, fetchedAt: number = now()): T => {
    if (!validKey(key)) return data;
    const old = entries.get(key);
    const stored = old ? shareStructure(old.data, data) : data;
    // a rewrite counts as the newest write
    entries.delete(key);
    entries.set(key, { data: stored, fetchedAt });
    evict();
    return stored;
  };

  const patch = <T = unknown>(key: string, updater: (data: T) => T): T | undefined => {
    const entry = get<T>(key);
    if (!entry) return undefined;
    const stored = shareStructure(entry.data, updater(entry.data));
    entries.set(key, { data: stored, fetchedAt: entry.fetchedAt });
    return stored;
  };

  return {
    get,
    set,
    patch,
    delete(key) {
      if (validKey(key)) entries.delete(key);
    },
    deletePrefix(prefix) {
      if (typeof prefix !== "string") return;
      for (const key of Array.from(entries.keys())) if (key.startsWith(prefix)) entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}
