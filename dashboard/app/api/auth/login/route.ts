import { randomInt, scrypt, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { createThrottle } from "@/lib/loginThrottle";
import { isAuthConfigured, originAllowed, sessionCookie, signSession, ttlSecondsFromEnv } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;
const MAX_PASSWORD_CHARS = 200;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;

// Best effort only: on serverless every instance has its own memory, so this
// slows a guesser down but is not a hard limit (docs/auth.md). The state lives on
// globalThis so a dev-server module reload does not reset it.
const throttle = createThrottle();

function clientKey(request: Request): string {
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
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
  const wait = throttle.retryAfterSeconds(key, Date.now());
  if (wait > 0) {
    return NextResponse.json(
      { error: "Too many attempts." },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  }

  if (!(await passwordMatches(password, passwordHash as string))) {
    throttle.recordFailure(key, Date.now());
    await sleep(randomInt(400, 601));
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  throttle.clear(key);
  const ttl = ttlSecondsFromEnv(process.env.SESSION_TTL_HOURS);
  const token = await signSession(secret as string, passwordHash as string, ttl);
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", sessionCookie(token, ttl, process.env.NODE_ENV === "production"));
  return res;
}
