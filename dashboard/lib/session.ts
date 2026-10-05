// Shared-password session tokens. Pure and import-free: Web Crypto and
// TextEncoder only, so it runs in Edge middleware, Node route handlers and the
// browser alike.
//
// Token: "v1.<expEpochSeconds>.<nonce16hex>.<sigHex>" where
//   sig = HMAC-SHA256(secret, `v1.${exp}.${nonce}.${fp}`)
//   fp  = first 16 hex chars of SHA-256(passwordHash)
// so changing the password invalidates every existing session.

export const COOKIE_NAME = "csa_session";

const VERSION = "v1";
const MIN_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 256;
const HASH_FORMAT = /^[0-9a-f]{32}:[0-9a-f]{64}$/;
const EXP_FORMAT = /^[0-9]{1,12}$/;
const NONCE_FORMAT = /^[0-9a-f]{16}$/;
const SIG_FORMAT = /^[0-9a-f]{64}$/;
const MAX_NEXT_LENGTH = 512;

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Auth only works when both values are present and well formed. Anything else
// fails closed: no session is ever issued or accepted.
export function isAuthConfigured(secret: string | undefined | null, passwordHash: string | undefined | null): boolean {
  return (
    typeof secret === "string" &&
    secret.length >= MIN_SECRET_LENGTH &&
    typeof passwordHash === "string" &&
    HASH_FORMAT.test(passwordHash)
  );
}

async function fingerprint(passwordHash: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(passwordHash));
  return toHex(new Uint8Array(digest)).slice(0, 16);
}

function hmacKey(secret: string, usages: ("sign" | "verify")[]): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

export async function signSession(
  secret: string,
  passwordHash: string,
  ttlSeconds: number,
  now: number = Date.now(),
  nonce?: string,
): Promise<string> {
  const exp = Math.floor(now / 1000) + Math.floor(ttlSeconds);
  const n = nonce ?? toHex(globalThis.crypto.getRandomValues(new Uint8Array(8)));
  const fp = await fingerprint(passwordHash);
  const key = await hmacKey(secret, ["sign"]);
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(`${VERSION}.${exp}.${n}.${fp}`));
  return `${VERSION}.${exp}.${n}.${toHex(new Uint8Array(sig))}`;
}

// Never throws; any problem is simply "not valid".
export async function verifySession(
  token: string | undefined | null,
  secret: string | undefined | null,
  passwordHash: string | undefined | null,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return false;
    if (!isAuthConfigured(secret, passwordHash)) return false;
    const parts = token.split(".");
    if (parts.length !== 4) return false;
    const [version, exp, nonce, sig] = parts;
    if (version !== VERSION || !EXP_FORMAT.test(exp) || !NONCE_FORMAT.test(nonce) || !SIG_FORMAT.test(sig)) {
      return false;
    }
    if (Number(exp) <= Math.floor(now / 1000)) return false;
    const fp = await fingerprint(passwordHash as string);
    const key = await hmacKey(secret as string, ["verify"]);
    return await globalThis.crypto.subtle.verify(
      "HMAC",
      key,
      fromHex(sig) as unknown as ArrayBuffer,
      encoder.encode(`${VERSION}.${exp}.${nonce}.${fp}`),
    );
  } catch {
    return false;
  }
}

// Where to go after login. Only same-site paths: anything that could be read
// as another origin, a login or API path, or that carries control characters
// falls back to "/".
export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  if (raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return "/";
  if (raw[0] !== "/" || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "/";
  if (/^\/(login|api)(?:[/?#]|$)/.test(raw)) return "/";
  return raw;
}

export function parseCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0 && trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

function cookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAgeSeconds)}${secure ? "; Secure" : ""}`;
}

export function sessionCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return cookie(value, maxAgeSeconds, secure);
}

export function clearCookie(secure: boolean): string {
  return cookie("", 0, secure);
}

// For POST, PUT, PATCH and DELETE: a present Origin must point at this host.
// A missing Origin is allowed (non-browser clients, same-origin GET-like flows).
export function originAllowed(origin: string | null | undefined, host: string | null | undefined): boolean {
  if (!origin) return true;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// SESSION_TTL_HOURS, default 8; anything unusable falls back to 8.
export function ttlSecondsFromEnv(raw: string | undefined | null): number {
  const hours = raw === undefined || raw === null || raw.trim() === "" ? 8 : Number(raw);
  return Number.isFinite(hours) && hours > 0 && hours <= 24 * 30 ? Math.round(hours * 3600) : 8 * 3600;
}
