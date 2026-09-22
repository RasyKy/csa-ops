import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CSA-OPS",
  description: "CSA-OPS SOC dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <nav className="border-b border-slate-200 px-6 py-3 text-sm dark:border-slate-800">
          <span className="mr-6 font-semibold">CSA-OPS</span>
          <a href="/" className="mr-4 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
            Incidents
          </a>
          <a href="/alerts" className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
            Alerts
          </a>
        </nav>
        {children}
      </body>
    </html>
  );
}
