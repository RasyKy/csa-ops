import type { Metadata } from "next";

import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "CSA-OPS",
  description: "CSA-OPS SOC dashboard",
};

// Runs before hydration so the page never flashes the wrong theme: reads a
// stored preference, or falls back to the OS preference, and sets it
// directly on <html> before React (and Tailwind's dark: classes) render.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background text-foreground">
        <ThemeProvider>
          <nav className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 text-sm dark:border-zinc-800">
            <div className="flex items-center">
              <span className="mr-6 font-semibold">CSA-OPS</span>
              <a href="/" className="mr-4 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                Overview
              </a>
              <a href="/incidents" className="mr-4 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                Incidents
              </a>
              <a href="/alerts" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                Alerts
              </a>
            </div>
            <ThemeToggle />
          </nav>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
