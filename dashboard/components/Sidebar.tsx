"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { endClientSession } from "@/lib/clientCache";

import { ThemeToggle } from "./ThemeToggle";
import { Tooltip } from "./ui/Tooltip";

function OverviewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 shrink-0">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function IncidentsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l9 16H3z" />
      <path strokeLinecap="round" d="M12 10v4" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function AlertsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9a6 6 0 0 1 12 0c0 3.2 1 5 2 7H4c1-2 2-3.8 2-7Z" />
      <path strokeLinecap="round" d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

function ChevronIcon({ collapsed, className }: { collapsed: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={`shrink-0 transition-transform ${collapsed ? "rotate-180" : ""} ${className ?? "h-4 w-4"}`}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
    </svg>
  );
}

type NavItem = {
  href: string;
  label: string;
  icon: () => JSX.Element;
  match: (pathname: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: OverviewIcon, match: (p) => p === "/" },
  { href: "/incidents", label: "Incidents", icon: IncidentsIcon, match: (p) => p.startsWith("/incidents") },
  { href: "/alerts", label: "Alerts", icon: AlertsIcon, match: (p) => p.startsWith("/alerts") },
];

const MIN_W = 200;
const MAX_W = 360;
const DEFAULT_W = 240;
const STORAGE_KEY_COLLAPSED = "sidebar-collapsed";
const STORAGE_KEY_WIDTH = "csa-sidebar-width";

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_W);
  const [isDragging, setIsDragging] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(DEFAULT_W);
  const currentWidthRef = useRef(DEFAULT_W);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const isCol = localStorage.getItem(STORAGE_KEY_COLLAPSED) === "true";
      const isNarrow = window.matchMedia("(max-width: 767px)").matches;
      if (isCol || isNarrow) {
        setCollapsed(true);
        document.documentElement.dataset.sidebar = "collapsed";
      } else {
        setCollapsed(false);
        delete document.documentElement.dataset.sidebar;
      }

      const rawW = localStorage.getItem(STORAGE_KEY_WIDTH);
      if (rawW) {
        const parsed = parseInt(rawW, 10);
        if (!isNaN(parsed) && parsed >= MIN_W && parsed <= MAX_W) {
          setWidth(parsed);
          currentWidthRef.current = parsed;
        }
      }
    } catch {
      // storage blocked fallback
    }
  }, []);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const handleMediaChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setCollapsed(true);
        document.documentElement.dataset.sidebar = "collapsed";
      } else {
        const isCol = localStorage.getItem(STORAGE_KEY_COLLAPSED) === "true";
        setCollapsed(isCol);
        if (isCol) {
          document.documentElement.dataset.sidebar = "collapsed";
        } else {
          delete document.documentElement.dataset.sidebar;
          document.documentElement.style.setProperty("--sidebar-width", `${currentWidthRef.current}px`);
        }
      }
    };
    mql.addEventListener("change", handleMediaChange);
    return () => mql.removeEventListener("change", handleMediaChange);
  }, []);

  const saveWidth = (w: number) => {
    const clamped = Math.min(MAX_W, Math.max(MIN_W, w));
    try {
      localStorage.setItem(STORAGE_KEY_WIDTH, String(clamped));
    } catch {}
  };

  const updateWidth = (w: number) => {
    const clamped = Math.min(MAX_W, Math.max(MIN_W, w));
    setWidth(clamped);
    currentWidthRef.current = clamped;
    document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
    saveWidth(clamped);
  };

  const toggle = () => {
    setIsTransitioning(true);
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY_COLLAPSED, String(next));
    } catch {}
    if (next) {
      document.documentElement.dataset.sidebar = "collapsed";
    } else {
      delete document.documentElement.dataset.sidebar;
      document.documentElement.style.setProperty("--sidebar-width", `${currentWidthRef.current}px`);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {}

    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = currentWidthRef.current;
    setIsDragging(true);

    const onPointerMove = (ev: PointerEvent) => {
      const delta = ev.clientX - dragStartXRef.current;
      const rawW = dragStartWidthRef.current + delta;
      const nextW = Math.min(MAX_W, Math.max(MIN_W, rawW));
      currentWidthRef.current = nextW;

      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(() => {
        setWidth(nextW);
        document.documentElement.style.setProperty("--sidebar-width", `${nextW}px`);
      });
    };

    const onPointerUp = (ev: PointerEvent) => {
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {}
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      const finalW = currentWidthRef.current;
      setWidth(finalW);
      document.documentElement.style.setProperty("--sidebar-width", `${finalW}px`);
      setIsDragging(false);
      saveWidth(finalW);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        const startW = dragStartWidthRef.current;
        currentWidthRef.current = startW;
        setWidth(startW);
        document.documentElement.style.setProperty("--sidebar-width", `${startW}px`);
        setIsDragging(false);
      }
    };

    const originalUserSelect = document.body.style.userSelect;
    const originalCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
      document.body.style.userSelect = originalUserSelect;
      document.body.style.cursor = originalCursor;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isDragging]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      updateWidth(currentWidthRef.current + 16);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      updateWidth(currentWidthRef.current - 16);
    } else if (e.key === "Home") {
      e.preventDefault();
      updateWidth(MIN_W);
    } else if (e.key === "End") {
      e.preventDefault();
      updateWidth(MAX_W);
    } else if (e.key === "Enter") {
      e.preventDefault();
      updateWidth(DEFAULT_W);
    }
  };

  const handleDoubleClick = () => {
    updateWidth(DEFAULT_W);
  };

  const signOut = async () => {
    // nothing from this session may be shown to the next one
    endClientSession();
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  };

  // The login page is full width with no navigation. Every hook above has
  // already run, so returning here keeps hook order stable.
  if (pathname === "/login") return null;

  const widthStyle = collapsed ? undefined : "var(--sidebar-width, 240px)";

  return (
    <aside
      data-sidebar-root
      style={{ width: widthStyle }}
      onTransitionEnd={() => setIsTransitioning(false)}
      className={`relative flex h-screen shrink-0 flex-col overflow-y-auto border-r border-zinc-200 bg-background max-md:!w-16 dark:border-zinc-800 ${
        collapsed ? "w-16" : "w-[var(--sidebar-width,240px)]"
      } ${
        isTransitioning && !isDragging
          ? "transition-[width] duration-150 motion-reduce:transition-none"
          : "transition-none"
      }`}
    >
      <div className="flex h-14 min-w-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-indigo-600 text-xs font-bold text-white">
          C
        </span>
        {!collapsed && <span data-sidebar-expanded-only className="truncate font-semibold">CSA-OPS</span>}
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-2">
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname ?? "");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex min-w-0 items-center gap-3 rounded border-l-2 px-2.5 py-2 text-sm transition-colors ${
                active
                  ? "border-indigo-600 bg-indigo-50 font-medium text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100"
                  : "border-transparent text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              <Icon />
              {!collapsed && <span data-sidebar-expanded-only className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div data-testid="sidebar-signout-row" className="border-t border-zinc-200 p-2 dark:border-zinc-800">
        {collapsed ? (
          <div className="flex justify-center">
            <Tooltip content="Sign out">
              <button
                type="button"
                onClick={signOut}
                aria-label="Sign out"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              >
                <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        ) : (
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            className="flex w-full min-w-0 items-center gap-3 rounded border-l-2 border-transparent px-2.5 py-2 text-left text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span data-sidebar-expanded-only className="truncate">Sign out</span>
          </button>
        )}
      </div>

      {collapsed ? (
        <div className="sidebar-footer flex flex-col items-center gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800">
          <ThemeToggle
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-zinc-300 text-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:hover:text-zinc-100"
            iconClassName="h-[18px] w-[18px]"
          />
          <button
            type="button"
            onClick={toggle}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            aria-expanded={false}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-zinc-300 text-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:hover:text-zinc-100 max-md:hidden"
          >
            <ChevronIcon collapsed={true} className="chevron-icon h-[18px] w-[18px]" />
          </button>
        </div>
      ) : (
        <div className="sidebar-footer flex items-center justify-between gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800">
          <ThemeToggle className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-zinc-300 text-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:hover:text-zinc-100" />
          <button
            type="button"
            onClick={toggle}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            aria-expanded={true}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-zinc-300 text-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:hover:text-zinc-100 max-md:hidden"
          >
            <ChevronIcon collapsed={false} className="chevron-icon" />
          </button>
        </div>
      )}

      {!collapsed && (
        <div
          data-sidebar-expanded-only
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={MIN_W}
          aria-valuemax={MAX_W}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
          onDoubleClick={handleDoubleClick}
          className="group absolute right-0 top-0 bottom-0 z-20 hidden md:flex w-2 cursor-col-resize items-center justify-end focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <div
            className={`h-full w-px transition-colors ${
              isDragging
                ? "bg-accent"
                : "bg-line group-hover:bg-accent group-focus-visible:bg-accent"
            }`}
          />
        </div>
      )}
    </aside>
  );
}

