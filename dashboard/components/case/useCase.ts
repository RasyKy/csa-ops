"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ACTOR_STORAGE_KEY, sanitizeActorName } from "@/lib/actorName";
import { nextDelay } from "@/lib/pollBackoff";
import type { Case, CaseStatus, Verdict } from "@/lib/types";

const POLL_BASE_MS = 15_000;
const POLL_MAX_MS = 60_000;

export const CASE_UNAVAILABLE = "Case data is unavailable right now. The rest of this page still works.";

export function readActorName(): string {
  try {
    return sanitizeActorName(window.localStorage.getItem(ACTOR_STORAGE_KEY));
  } catch {
    return sanitizeActorName(null);
  }
}

export function saveActorName(raw: string): string {
  const name = sanitizeActorName(raw);
  try {
    window.localStorage.setItem(ACTOR_STORAGE_KEY, name);
  } catch {
    // storage blocked: the name still applies for this page view
  }
  return name;
}

export interface MutationResult {
  ok: boolean;
  status: number;
  message?: string;
}

export interface UseCase {
  caseData: Case | null;
  loading: boolean;
  error: string | null;
  conflict: boolean;
  pending: boolean;
  reload: () => Promise<void>;
  setAssignee: (assignee: string | null) => Promise<MutationResult>;
  setStatus: (status: Exclude<CaseStatus, "resolved">) => Promise<MutationResult>;
  resolve: (verdict: Verdict, note: string) => Promise<MutationResult>;
  addNote: (text: string) => Promise<MutationResult>;
  reopen: () => Promise<MutationResult>;
}

function detailOf(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null) {
    const d = (body as { detail?: unknown }).detail;
    if (typeof d === "string") return d;
  }
  return undefined;
}

export function useCase(incidentId: string): UseCase {
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);

  // Always the newest case the page has seen, so a mutation sends the right
  // expected_version even from a stale closure.
  const latest = useRef<Case | null>(null);
  const mutating = useRef(false);
  const runNow = useRef<() => void>(() => {});

  const accept = useCallback((fresh: Case) => {
    // Versions only go up, so a poll response that was slow cannot overwrite a
    // newer state this page already knows.
    if (latest.current && fresh.version < latest.current.version) return;
    latest.current = fresh;
    setCaseData(fresh);
  }, []);

  const url = `/api/incidents/${encodeURIComponent(incidentId)}/case`;

  const fetchCase = useCallback(
    async (signal?: AbortSignal): Promise<boolean> => {
      try {
        const res = await fetch(url, { cache: "no-store", signal });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as Case;
        if (signal?.aborted) return false;
        accept(body);
        setError(null);
        return true;
      } catch {
        if (signal?.aborted) return false;
        setError(CASE_UNAVAILABLE);
        return false;
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [url, accept],
  );

  useEffect(() => {
    // Same rules as the Overview poll: one run at a time, back off while
    // failing, pause while the tab is hidden, run at once when it is shown.
    let cancelled = false;
    let inFlight = false;
    let failures = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const clearTimer = () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    };
    const scheduleNext = () => {
      if (cancelled || document.hidden) return;
      timerId = setTimeout(() => void run(), nextDelay(failures, POLL_BASE_MS, POLL_MAX_MS));
    };
    const run = async () => {
      if (inFlight || cancelled) return;
      clearTimer();
      inFlight = true;
      const ok = await fetchCase(controller.signal);
      inFlight = false;
      if (cancelled) return;
      failures = ok ? 0 : failures + 1;
      scheduleNext();
    };
    const onVisibility = () => {
      clearTimer();
      if (!document.hidden) void run();
    };
    const onFocus = () => {
      void run();
    };

    runNow.current = () => {
      void run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    void run();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchCase]);

  const send = useCallback(
    async (method: "PATCH" | "POST", path: string, payload: Record<string, unknown>): Promise<MutationResult> => {
      if (mutating.current) return { ok: false, status: 0, message: "Another change is in progress." };
      mutating.current = true;
      setPending(true);
      try {
        const body = { ...payload, expected_version: latest.current?.version ?? 0 };
        const res = await fetch(`${url}${path}`, {
          method,
          headers: {
            "content-type": "application/json",
            // URI-encoded so any character survives an HTTP header; the proxy decodes it.
            "x-actor": encodeURIComponent(readActorName()),
          },
          body: JSON.stringify(body),
        });
        let json: unknown = null;
        try {
          json = await res.json();
        } catch {
          json = null;
        }
        if (res.ok) {
          accept(json as Case);
          setConflict(false);
          setError(null);
          return { ok: true, status: res.status };
        }
        if (res.status === 409 && typeof json === "object" && json !== null && "case" in json) {
          const current = (json as { case: Case }).case;
          // The server's copy wins even if its version looks older than ours.
          latest.current = current;
          setCaseData(current);
          setConflict(true);
          return { ok: false, status: 409, message: detailOf(json) };
        }
        if (res.status === 503) {
          setError(CASE_UNAVAILABLE);
          return { ok: false, status: 503, message: CASE_UNAVAILABLE };
        }
        return { ok: false, status: res.status, message: detailOf(json) ?? "The change could not be saved." };
      } catch {
        setError(CASE_UNAVAILABLE);
        return { ok: false, status: 0, message: CASE_UNAVAILABLE };
      } finally {
        mutating.current = false;
        setPending(false);
      }
    },
    [url, accept],
  );

  const reload = useCallback(async () => {
    setLoading(latest.current === null);
    runNow.current();
  }, []);

  return {
    caseData,
    loading,
    error,
    conflict,
    pending,
    reload,
    setAssignee: (assignee) => send("PATCH", "", { assignee }),
    setStatus: (status) => send("PATCH", "", { status }),
    resolve: (verdict, note) => send("POST", "/resolve", { verdict, ...(note.trim() ? { note: note.trim() } : {}) }),
    addNote: (text) => send("POST", "/notes", { text: text.trim() }),
    reopen: () => send("POST", "/reopen", {}),
  };
}
