"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Card } from "@/components/ui/Card";
import { buttonClasses } from "@/components/ui/Button";
import { safeNextPath } from "@/lib/session";

const NOT_CONFIGURED = "Login is not configured on this server.";

function messageFor(status: number): string {
  if (status === 401) return "Incorrect password.";
  if (status === 429) return "Too many attempts. Try again in a few minutes.";
  if (status === 503) return NOT_CONFIGURED;
  return "Something went wrong. Try again.";
}

export function LoginForm({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (password.length === 0) {
      setError("Enter your password.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // Full reload so the layout and server components see the new cookie.
        const next = new URLSearchParams(window.location.search).get("next");
        window.location.assign(safeNextPath(next));
        return;
      }
      setError(messageFor(res.status));
    } catch {
      setError(messageFor(0));
    }
    setPending(false);
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-8">
      <Card className="w-full max-w-sm p-6">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-indigo-600 text-xs font-bold text-white">
            C
          </span>
          <span className="font-semibold text-ink">CSA-OPS</span>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-ink">Sign in</h1>

        {configured ? (
          <form onSubmit={onSubmit} className="mt-4" noValidate>
            <label htmlFor="password" className="block text-sm font-medium text-ink">
              Password
            </label>
            <div className="relative mt-1">
              <input
                id="password"
                name="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby="login-error"
                className="h-9 w-full rounded-md border border-line-strong bg-surface pl-3 pr-10 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-pressed={show}
                aria-label="Show password"
                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-ink-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
            <p id="login-error" role="alert" className="mt-2 min-h-[1.25rem] text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
            <button
              type="submit"
              disabled={pending}
              className={buttonClasses({ variant: "primary", className: "mt-2 !h-9 w-full" })}
            >
              {pending ? "Signing in..." : "Sign in"}
            </button>
          </form>
        ) : (
          <p role="alert" className="mt-4 text-sm text-ink-muted">
            {NOT_CONFIGURED}
          </p>
        )}

        <p className="mt-6 text-xs text-ink-subtle">Demo environment. All data is synthetic.</p>
      </Card>
    </main>
  );
}
