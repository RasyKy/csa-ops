"use client";

import { useCallback, useRef, useState } from "react";

import { clientCache } from "@/lib/clientCache";

export interface SwrState<T> {
  data: T;
  // Stores next in the cache (reusing every part that did not change) and shows it.
  // A result equal to what is already shown keeps the same data reference, so
  // nothing that depends on it re-renders. Never touches the network.
  setData: (next: T) => T;
  // When the data on screen was last fetched, or null while there is none.
  fetchedAt: number | null;
  // True from the first frame when the data came from the cache, until a
  // refresh succeeds.
  fromCache: boolean;
  // Only ever true while cached data is on screen and being revalidated.
  refreshing: boolean;
  setRefreshing: (value: boolean) => void;
}

interface Held<T> {
  key: string;
  data: T;
  fromCache: boolean;
}

function start<T>(key: string, empty: T): { held: Held<T>; fetchedAt: number | null } {
  const entry = key ? clientCache.get<T>(key) : undefined;
  return entry
    ? { held: { key, data: entry.data, fromCache: true }, fetchedAt: entry.fetchedAt }
    : { held: { key, data: empty, fromCache: false }, fetchedAt: null };
}

// State backed by the shared cache. The first render of a key already shows its
// cached entry (a revisit has no loading state); a key with no entry shows
// `empty`. Switching key switches the shown data the same way.
export function useSwrState<T>(key: string, empty: T): SwrState<T> {
  const [held, setHeld] = useState<Held<T>>(() => start(key, empty).held);
  const [fetchedAt, setFetchedAt] = useState<number | null>(() => start(key, empty).fetchedAt);
  const [refreshing, setRefreshingState] = useState(false);

  let current = held;
  let currentFetchedAt = fetchedAt;
  if (held.key !== key) {
    // the key changed: show that key's entry (derived during render, no extra frame)
    const next = start(key, empty);
    current = next.held;
    currentFetchedAt = next.fetchedAt;
    setHeld(next.held);
    setFetchedAt(next.fetchedAt);
    setRefreshingState(false);
  }

  const fromCacheRef = useRef(current.fromCache);
  fromCacheRef.current = current.fromCache;
  const keyRef = useRef(key);
  keyRef.current = key;

  const setData = useCallback(
    (next: T): T => {
      const stored = clientCache.set(key, next);
      const at = clientCache.get<T>(key)?.fetchedAt ?? Date.now();
      // a response for a key that is no longer shown is cached but not displayed
      if (keyRef.current === key) {
        setHeld((prev) => (prev.key === key && prev.data === stored && !prev.fromCache ? prev : { key, data: stored, fromCache: false }));
        setFetchedAt(at);
        setRefreshingState(false);
      }
      return stored;
    },
    [key],
  );

  const setRefreshing = useCallback((value: boolean) => {
    // there is nothing to call "refreshing" unless cached data is on screen
    if (value && !fromCacheRef.current) return;
    setRefreshingState(value);
  }, []);

  return {
    data: current.data,
    setData,
    fetchedAt: currentFetchedAt,
    fromCache: current.fromCache,
    refreshing: refreshing && current.fromCache,
    setRefreshing,
  };
}
