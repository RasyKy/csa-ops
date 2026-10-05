import type { Metadata } from "next";

import { BackendWakeBanner } from "@/components/BackendWakeBanner";
import { Sidebar } from "@/components/Sidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
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
  try {
    var isNarrow = window.matchMedia("(max-width: 767px)").matches;
    var isCol = localStorage.getItem("sidebar-collapsed") === "true";
    if (isCol || isNarrow) {
      document.documentElement.dataset.sidebar = "collapsed";
    }
    var rawW = localStorage.getItem("csa-sidebar-width");
    if (!isCol && !isNarrow && rawW) {
      var w = parseInt(rawW, 10);
      if (!isNaN(w)) {
        w = Math.min(360, Math.max(200, w));
        document.documentElement.style.setProperty("--sidebar-width", w + "px");
      }
    }
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
      <body className="h-screen overflow-hidden bg-background text-foreground">
        <ThemeProvider>
          <div className="flex h-screen">
            <Sidebar />
            <div className="h-screen min-w-0 flex-1 overflow-y-auto">
              <BackendWakeBanner />
              {children}
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
