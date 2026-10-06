"use client";

import { useEffect } from "react";

import { handleUnauthorized } from "@/lib/clientCache";
import { nextDelay } from "@/lib/pollBackoff";
import { useSwrState } from "@/lib/useSwrState";

export interface AlertTitle {
  title?: string;
  timestamp?: string;
}

export type AlertTitleMap = Record<string, AlertTitle>;

const REFRESH_MS = 60_000;
const MAX_DELAY_MS = 300_000;
// GET /alerts accepts up to 500 (backend/app/routers/alerts.py); the fixture sets hold 8 and 19.
const ALERT_LIMIT = 500;

// Rule titles for the alerts behind each incident, by alert id. Used to name an
// incident that has no matched scenario. It never shows an error: a failed
// request keeps the last map (or none, and titles fall back to the technique).
export function useAlertTitles(): AlertTitleMap | null {
  // Cached ("alerts:titles"), so a revisit already has the titles on the first frame.
  const { data: titles, setData: setTitles } = useSwrState<AlertTitleMap | null>("alerts:titles", null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const controller = new AbortController();

    const clearTimer = () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    };

    const load = async (): Promise<boolean> => {
      try {
        const res = await fetch(`/api/alerts?limit=${ALERT_LIMIT}`, { signal: controller.signal, cache: "no-store" });
        if (res.status === 401) {
          if (!cancelled) handleUnauthorized();
          return false;
        }
        if (!res.ok) return false;
        const body: unknown = await res.json();
        if (!Array.isArray(body)) return false;
        const next: AlertTitleMap = {};
        for (const alert of body) {
          if (!alert || typeof alert !== "object") continue;
          const a = alert as Record<string, unknown>;
          if (typeof a.alert_id !== "string") continue;
          next[a.alert_id] = {
            title: typeof a.rule_title === "string" ? a.rule_title : undefined,
            timestamp: typeof a.timestamp === "string" ? a.timestamp : undefined,
          };
        }
        if (cancelled) return false;
        setTitles(next);
        return true;
      } catch {
        return false;
      }
    };

    const schedule = () => {
      if (cancelled || document.hidden) return;
      timerId = setTimeout(() => void run(), nextDelay(failures, REFRESH_MS, MAX_DELAY_MS));
    };

    const run = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      const ok = await load();
      inFlight = false;
      if (cancelled) return;
      failures = ok ? 0 : failures + 1;
      schedule();
    };

    const onVisibilityChange = () => {
      clearTimer();
      if (!document.hidden) void run();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void run();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [setTitles]);

  return titles;
}
