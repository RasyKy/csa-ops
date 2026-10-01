"use client";

import { useTheme } from "./ThemeProvider";

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <circle cx="12" cy="12" r="4" />
      <path
        strokeLinecap="round"
        d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 1020.354 15.354z" />
    </svg>
  );
}

export function ThemeToggle() {
  const { theme, toggle, mounted } = useTheme();

  // Avoid rendering an icon that might not match the DOM's real theme for
  // one tick during hydration -- a fixed-size placeholder keeps layout
  // stable either way.
  if (!mounted) return <span className="inline-block h-7 w-7" />;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="flex h-7 w-7 items-center justify-center rounded border border-zinc-300 text-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:hover:text-zinc-100"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
