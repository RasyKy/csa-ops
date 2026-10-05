import { randomInt, scrypt, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { isAuthConfigured, originAllowed, sessionCookie, signSession, ttlSecondsFromEnv } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;
const MAX_PASSWORD_CHARS = 200;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;

const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 5 * 60 * 1000;
const MAX_TRACKED_KEYS = 1000;

// Best effort only: on serverless every instance has its own memory, so this
// slows a guesser down but is not a hard limit (docs/auth.md).
const attempts = new Map<string, { failures: number[]; blockedUntil: number }>();

function clientKey(request: Request): string {
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
}

function retryAfterSeconds(key: string, now: number): number {
  const entry = attempts.get(key);
  return entry && entry.blockedUntil > now ? Math.ceil((entry.blockedUntil - now) / 1000) : 0;
}

function recordFailure(key: string, now: number): void {
  if (!attempts.has(key) && attempts.size >= MAX_TRACKED_KEYS) {
    attempts.forEach((entry, k) => {
      if (entry.blockedUntil <= now && entry.failures.every((t) => now - t > FAILURE_WINDOW_MS)) attempts.delete(k);
    });
    if (attempts.size >= MAX_TRACKED_KEYS) {
      const oldest = attempts.keys().next().value;
      if (oldest !== undefined) attempts.delete(oldest);
    }
  }
  const entry = attempts.get(key) ?? { failures: [], blockedUntil: 0 };
  entry.failures = entry.failures.filter((t) => now - t <= FAILURE_WINDOW_MS);
  entry.failures.push(now);
  if (entry.failures.length >= MAX_FAILURES) {
    entry.blockedUntil = now + BLOCK_MS;
    entry.failures = [];
  }
  attempts.set(key, entry);
}

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, SCRYPT, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

async function passwordMatches(password: string, passwordHash: string): Promise<boolean> {
  const [saltHex, hashHex] = passwordHash.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
  const host = request.headers.get("host");
  if (!originAllowed(request.headers.get("origin"), host)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const secret = process.env.SESSION_SECRET;
  const passwordHash = process.env.DASHBOARD_PASSWORD_HASH;
  if (!isAuthConfigured(secret, passwordHash)) {
    return NextResponse.json({ error: "Login is not configured on this server." }, { status: 503 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  let password: unknown;
  try {
    password = (JSON.parse(raw) as { password?: unknown }).password;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_CHARS) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const key = clientKey(request);
  const wait = retryAfterSeconds(key, Date.now());
  if (wait > 0) {
    return NextResponse.json(
      { error: "Too many attempts." },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  }

  if (!(await passwordMatches(password, passwordHash as string))) {
    recordFailure(key, Date.now());
    await sleep(randomInt(400, 601));
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  attempts.delete(key);
  const ttl = ttlSecondsFromEnv(process.env.SESSION_TTL_HOURS);
  const token = await signSession(secret as string, passwordHash as string, ttl);
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", sessionCookie(token, ttl, process.env.NODE_ENV === "production"));
  return res;
}
