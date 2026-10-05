# Dashboard sign-in

The dashboard is gated by one shared password. A signed, HttpOnly session cookie
is issued on login and checked by Edge middleware on every request. Nothing is
written to disk and everything is configured through environment variables, so
it runs unchanged on Vercel.

## How it works

- `middleware.ts` (Edge) lets `/login` and `/api/auth/*` through and requires a
  valid session cookie for everything else. A signed-out page request is
  redirected to `/login?next=<path>`; a signed-out `/api/*` request gets
  `401 {"error":"unauthorized"}`.
- `POST /api/auth/login` (Node runtime) checks the password with scrypt and a
  constant-time compare, then sets the cookie `csa_session`.
- `POST /api/auth/logout` clears the cookie. The sidebar has a sign out button.
- The cookie value is `v1.<exp>.<nonce>.<signature>`. The signature is
  HMAC-SHA256 over the expiry, a random nonce and a fingerprint of the password
  hash, keyed by `SESSION_SECRET`. The cookie is `HttpOnly; SameSite=Lax; Path=/`
  and `Secure` in production builds.
- POST, PUT, PATCH and DELETE requests whose `Origin` header names another host
  get 403. A missing `Origin` is allowed.
- Every response carries `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY` and `Referrer-Policy: same-origin`; `/api/*` responses
  are `Cache-Control: private, no-store`.
- The browser talks to Next.js route handlers only. `DASHBOARD_API_KEY` stays on
  the server and never reaches the browser.

## Configuration

| Variable | Meaning |
| --- | --- |
| `DASHBOARD_PASSWORD_HASH` | `<salt_hex>:<hash_hex>`: scrypt (N=16384, r=8, p=1, 32-byte key) of the password with a 16-byte salt. Hex only, so dotenv does not expand it. |
| `SESSION_SECRET` | Signing key, at least 32 characters. |
| `SESSION_TTL_HOURS` | Optional. How long a sign-in lasts. Default 8. |

There is no default password or secret anywhere and no setting that turns auth
off. If the secret is shorter than 32 characters or the hash is not of the form
`^[0-9a-f]{32}:[0-9a-f]{64}$`, the dashboard fails closed: no session ever
verifies, `/login` shows "Login is not configured on this server" and
`POST /api/auth/login` returns 503.

### Generate the values

From the `dashboard` folder:

```powershell
node scripts/hash-password.mjs "your password here"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The first command prints the value for `DASHBOARD_PASSWORD_HASH`, the second one
for `SESSION_SECRET`. Locally, put them in `dashboard/.env.local` (never in a
tracked file). `dashboard/.env.example` lists the variable names.

## Vercel

1. Project settings, Environment Variables: add `DASHBOARD_PASSWORD_HASH`,
   `SESSION_SECRET` and optionally `SESSION_TTL_HOURS` for the Production
   environment (and Preview if you want previews gated too). Also set
   `BACKEND_URL` and `DASHBOARD_API_KEY` as before.
2. Redeploy. Environment variables are read at runtime, but a new deployment
   makes sure every instance has them.
3. Open the site: you should be redirected to `/login`. If you see "Login is not
   configured on this server", one of the two values is missing or malformed.

Proxy route handlers that call the AI (for example `/api/ai/explain/[id]`) can
run longer than the platform's default function time limit. If explanations time
out on Vercel, raise `export const maxDuration = <seconds>` in that route file
within your plan's limit.

## Rotating the password

Generate a new hash, set `DASHBOARD_PASSWORD_HASH`, redeploy. The session
signature includes a fingerprint of the hash, so every existing session stops
verifying at once and everyone signs in again. Changing `SESSION_SECRET` does the
same.

## Running the e2e tests

The Playwright config starts the dashboard and a backend with a test-only
`SESSION_SECRET` and a hash derived from `E2E_PASSWORD`, then signs in once in
`e2e/global-setup.ts`.

```powershell
$env:E2E_PASSWORD = "any throwaway value"
npx playwright test
```

If a dashboard dev server is already running, Playwright reuses it, and it must
have been started with the same `SESSION_SECRET` and a hash of `E2E_PASSWORD`.
Global setup prints the exact command when sign in fails.

## Limitations

- One shared password. The case audit trail only knows the actor label
  (`analyst`), not who the person was.
- The login throttle (5 failures in 10 minutes blocks that address for 5
  minutes) is in memory. On serverless platforms each instance has its own
  counter, so it slows guessing down but is not a hard limit. It keys on the
  first `X-Forwarded-For` entry, so behind a proxy that does not set it, all
  clients share one counter.
- No SSO and no MFA.
- Signing out clears the cookie in the browser. A copy of the cookie that was
  stolen earlier stays valid until it expires or the password or secret is
  rotated.
- This protects a demo with synthetic data. It is not sufficient for real
  telemetry.
