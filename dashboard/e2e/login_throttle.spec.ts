import { expect, test } from "@playwright/test";

import {
  BLOCK_MS,
  createThrottle,
  FAILURE_WINDOW_MS,
  MAX_FAILURES,
  MAX_TRACKED_KEYS,
  STORE_PROPERTY,
} from "../lib/loginThrottle";

// Pure tests: no page, no server. A plain object stands in for globalThis.

const T0 = 1_000_000_000_000;

function fail(t: ReturnType<typeof createThrottle>, key: string, times: number, at: number) {
  for (let i = 0; i < times; i++) t.recordFailure(key, at + i);
}

test.describe("login throttle: thresholds", () => {
  test("the thresholds are the ones the route always had", () => {
    expect(MAX_FAILURES).toBe(5);
    expect(FAILURE_WINDOW_MS).toBe(10 * 60 * 1000);
    expect(BLOCK_MS).toBe(5 * 60 * 1000);
    expect(MAX_TRACKED_KEYS).toBe(1000);
  });

  test("below the threshold is not blocked, exactly at it is", () => {
    const t = createThrottle({});
    fail(t, "a", MAX_FAILURES - 1, T0);
    expect(t.isBlocked("a", T0 + 10)).toBe(false);
    expect(t.retryAfterSeconds("a", T0 + 10)).toBe(0);
    t.recordFailure("a", T0 + 10);
    expect(t.isBlocked("a", T0 + 10)).toBe(true);
    expect(t.retryAfterSeconds("a", T0 + 10)).toBe(300);
  });

  test("retryAfterSeconds counts down with the clock and rounds up", () => {
    const t = createThrottle({});
    fail(t, "a", MAX_FAILURES, T0);
    const blockedAt = T0 + MAX_FAILURES - 1;
    expect(t.retryAfterSeconds("a", blockedAt)).toBe(300);
    expect(t.retryAfterSeconds("a", blockedAt + 60_000)).toBe(240);
    expect(t.retryAfterSeconds("a", blockedAt + 299_001)).toBe(1);
    expect(t.retryAfterSeconds("a", blockedAt + 299_999)).toBe(1);
  });

  test("a block expires after the lockout length", () => {
    const t = createThrottle({});
    fail(t, "a", MAX_FAILURES, T0);
    const blockedAt = T0 + MAX_FAILURES - 1;
    expect(t.isBlocked("a", blockedAt + BLOCK_MS - 1)).toBe(true);
    expect(t.isBlocked("a", blockedAt + BLOCK_MS)).toBe(false);
    expect(t.retryAfterSeconds("a", blockedAt + BLOCK_MS)).toBe(0);
    // the counter starts again after a block: four more failures do not block
    fail(t, "a", MAX_FAILURES - 1, blockedAt + BLOCK_MS + 1);
    expect(t.isBlocked("a", blockedAt + BLOCK_MS + 10)).toBe(false);
  });

  test("failures older than the window no longer count", () => {
    const t = createThrottle({});
    fail(t, "a", MAX_FAILURES - 1, T0);
    // one more failure, but after the earlier ones have left the window
    t.recordFailure("a", T0 + FAILURE_WINDOW_MS + 100);
    expect(t.isBlocked("a", T0 + FAILURE_WINDOW_MS + 100)).toBe(false);
    // failures inside the window still add up
    fail(t, "a", MAX_FAILURES - 1, T0 + FAILURE_WINDOW_MS + 200);
    expect(t.isBlocked("a", T0 + FAILURE_WINDOW_MS + 500)).toBe(true);
  });

  test("clear resets a key and leaves other keys alone", () => {
    const t = createThrottle({});
    fail(t, "a", MAX_FAILURES, T0);
    fail(t, "b", MAX_FAILURES, T0);
    t.clear("a");
    expect(t.isBlocked("a", T0 + 10)).toBe(false);
    expect(t.isBlocked("b", T0 + 10)).toBe(true);
    // a cleared key needs the full number of failures again
    fail(t, "a", MAX_FAILURES - 1, T0 + 20);
    expect(t.isBlocked("a", T0 + 30)).toBe(false);
  });

  test("keys are independent", () => {
    const t = createThrottle({});
    fail(t, "a", MAX_FAILURES, T0);
    expect(t.isBlocked("b", T0 + 10)).toBe(false);
  });
});

test.describe("login throttle: shared state", () => {
  test("two instances over the same store share state (a module reload)", () => {
    const store: Record<string, unknown> = {};
    const before = createThrottle(store);
    fail(before, "a", MAX_FAILURES - 1, T0);
    const after = createThrottle(store); // what a hot reload creates
    expect(after.isBlocked("a", T0 + 10)).toBe(false);
    after.recordFailure("a", T0 + 10);
    expect(before.isBlocked("a", T0 + 10)).toBe(true);
    expect(after.retryAfterSeconds("a", T0 + 10)).toBe(before.retryAfterSeconds("a", T0 + 10));
    before.clear("a");
    expect(after.isBlocked("a", T0 + 20)).toBe(false);
  });

  test("all state sits under one property of the store", () => {
    const store: Record<string, unknown> = {};
    fail(createThrottle(store), "a", 2, T0);
    expect(Object.keys(store)).toEqual([STORE_PROPERTY]);
  });

  test("instances over different stores are independent", () => {
    const one = createThrottle({});
    const two = createThrottle({});
    fail(one, "a", MAX_FAILURES, T0);
    expect(one.isBlocked("a", T0 + 10)).toBe(true);
    expect(two.isBlocked("a", T0 + 10)).toBe(false);
  });

  test("the default store is globalThis", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    delete g[STORE_PROPERTY];
    try {
      const one = createThrottle();
      const two = createThrottle();
      fail(one, "default-store-key", MAX_FAILURES, T0);
      expect(two.isBlocked("default-store-key", T0 + 10)).toBe(true);
      expect(g[STORE_PROPERTY]).toBeInstanceOf(Map);
    } finally {
      delete g[STORE_PROPERTY];
    }
  });
});

test.describe("login throttle: bounds and robustness", () => {
  test("the cap evicts the oldest key and keeps the newest", () => {
    const store: Record<string, unknown> = {};
    const t = createThrottle(store);
    for (let i = 0; i < MAX_TRACKED_KEYS; i++) t.recordFailure(`k${i}`, T0 + i);
    expect((store[STORE_PROPERTY] as Map<string, unknown>).size).toBe(MAX_TRACKED_KEYS);

    t.recordFailure("newest", T0 + MAX_TRACKED_KEYS);
    const map = store[STORE_PROPERTY] as Map<string, unknown>;
    expect(map.size).toBe(MAX_TRACKED_KEYS);
    expect(map.has("k0")).toBe(false);
    expect(map.has("k1")).toBe(true);
    expect(map.has("newest")).toBe(true);
  });

  test("an evicted key starts from zero and a blocked newest key stays blocked", () => {
    const store: Record<string, unknown> = {};
    const t = createThrottle(store);
    for (let i = 0; i < MAX_TRACKED_KEYS; i++) t.recordFailure(`k${i}`, T0 + i);
    fail(t, "newest", MAX_FAILURES, T0 + 5000);
    expect(t.isBlocked("newest", T0 + 5010)).toBe(true);
    expect((store[STORE_PROPERTY] as Map<string, unknown>).size).toBe(MAX_TRACKED_KEYS);
  });

  test("pruning drops expired entries and leaves live ones", () => {
    const store: Record<string, unknown> = {};
    const t = createThrottle(store);
    t.recordFailure("old", T0);
    fail(t, "blocked", MAX_FAILURES, T0 + FAILURE_WINDOW_MS - 1000);
    t.recordFailure("recent", T0 + FAILURE_WINDOW_MS - 500);
    const map = store[STORE_PROPERTY] as Map<string, unknown>;

    // any call prunes: "old" is past the window, the others are live
    expect(t.isBlocked("anything", T0 + FAILURE_WINDOW_MS + 1)).toBe(false);
    expect(map.has("old")).toBe(false);
    expect(map.has("blocked")).toBe(true);
    expect(map.has("recent")).toBe(true);

    // once the block has also run out, that entry goes too
    t.isBlocked("anything", T0 + FAILURE_WINDOW_MS + BLOCK_MS + 10_000);
    expect(map.has("blocked")).toBe(false);
  });

  test("a null, number, object or empty key maps to the key 'unknown'", () => {
    for (const garbage of [null, undefined, 42, "", {}, [], true]) {
      const fresh = createThrottle({});
      fail(fresh, "unknown", MAX_FAILURES - 1, T0);
      fresh.recordFailure(garbage, T0 + 10);
      expect(fresh.isBlocked("unknown", T0 + 20), String(garbage)).toBe(true);
      expect(fresh.isBlocked(garbage, T0 + 20), String(garbage)).toBe(true);
      fresh.clear(garbage);
      expect(fresh.isBlocked("unknown", T0 + 30), String(garbage)).toBe(false);
    }
  });

  test("calls never throw on garbage input or a damaged store", () => {
    const garbageNow = [NaN, Infinity, -1, null, undefined, "x", {}] as unknown as number[];
    const stores: Record<string, unknown>[] = [
      {},
      { [STORE_PROPERTY]: "not a map" },
      { [STORE_PROPERTY]: null },
      { [STORE_PROPERTY]: new Map([["a", null]]) },
      { [STORE_PROPERTY]: new Map([["a", { failures: "x", blockedUntil: "y" }]]) },
    ];
    for (const store of stores) {
      const t = createThrottle(store);
      for (const now of garbageNow) {
        for (const key of [null, "a", 7, "", undefined, {}]) {
          expect(() => t.isBlocked(key, now)).not.toThrow();
          expect(() => t.recordFailure(key, now)).not.toThrow();
          expect(() => t.retryAfterSeconds(key, now)).not.toThrow();
          expect(() => t.clear(key)).not.toThrow();
        }
      }
    }
  });

  test("a damaged store is repaired and then throttles normally", () => {
    const store: Record<string, unknown> = { [STORE_PROPERTY]: "junk" };
    const t = createThrottle(store);
    fail(t, "a", MAX_FAILURES, T0);
    expect(t.isBlocked("a", T0 + 10)).toBe(true);
  });
});
