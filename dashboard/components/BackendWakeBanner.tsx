"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Info } from "lucide-react";

import { Notice } from "@/components/ui/Notice";
import { nextDelay } from "@/lib/pollBackoff";

export function BackendWakeBanner() {
  const pathname = usePathname();
  const [isWaking, setIsWaking] = useState(false);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let failures = 0;
    let timerId: NodeJS.Timeout | null = null;

    const checkStatus = async () => {
      if (inFlight) return;
      if (pathnameRef.current === "/login") return;

      inFlight = true;
      let ok = true;
      try {
        const res = await fetch("/api/backend-status", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { ok?: boolean };
          ok = data?.ok === true;
        } else {
          ok = false;
        }
      } catch {
        ok = false;
      } finally {
        inFlight = false;
      }

      if (cancelled) return;

      setIsWaking(!ok);

      failures = ok ? 0 : failures + 1;
      // Healthy: check once a minute. Down: 10 s, doubling up to 30 s.
      const delay = ok ? 60000 : nextDelay(failures, 5000, 30000);
      if (typeof document === "undefined" || !document.hidden) {
        timerId = setTimeout(checkStatus, delay);
      }
    };

    const handleVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }
      } else {
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }
        void checkStatus();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    void checkStatus();

    return () => {
      cancelled = true;
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  if (pathname === "/login" || !isWaking) {
    return null;
  }

  return (
    <div role="status" className="border-b border-line bg-surface px-4 py-2">
      <Notice tone="neutral" icon={Info}>
        The demo backend is waking up. This can take up to a minute after it has been idle.
      </Notice>
    </div>
  );
}

export default BackendWakeBanner;
