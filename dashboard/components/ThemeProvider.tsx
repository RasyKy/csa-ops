"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

const ThemeContext = createContext<{ theme: Theme; toggle: () => void; mounted: boolean }>({
  theme: "light",
  toggle: () => {},
  mounted: false,
});

// The <head> inline script (see layout.tsx) already set html.dark before
// hydration -- this just reads that back so React's state agrees with what
// the DOM already shows, instead of guessing and causing a flash.
function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("theme", next);
    } catch {
      // private-browsing/blocked storage -- theme just won't persist across reloads
    }
  };

  return <ThemeContext.Provider value={{ theme, toggle, mounted }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
