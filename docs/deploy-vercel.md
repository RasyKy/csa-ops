# Vercel Deployment Guide (Dashboard Frontend)

This document describes how to deploy the CSA-OPS Next.js dashboard to Vercel against the Render FastAPI backend, configure environment variables, manage security and session secrets, handle cold starts, and prepare for live demonstrations.

---

## 1. Project Setup and Repository Import

1. In the Vercel Dashboard, select **Add New...** -> **Project**.
2. Connect your Git provider and import the `csa-ops` repository.
3. Configure the project settings:
   - **Framework Preset**: `Next.js`
   - **Root Directory**: Click **Edit** and select `dashboard`. This ensures Vercel runs build and deployment commands within the Next.js workspace rather than the repository root.
   - **Build Command**: Default (`next build`)
   - **Output Directory**: Default (`.next`)
   - **Install Command**: Default (`npm install` or `npm ci`)

---

## 2. Plan and Execution Limits

- **Hobby Plan**: Vercel's Hobby plan is strictly for personal and non-commercial demonstration use.
- **Function Execution Limits (`maxDuration`)**:
  - The Render free tier backend may take 50 to 60 seconds to complete a cold start after being idle for 15 minutes.
  - To prevent Vercel Serverless Functions from timing out prematurely during backend wake-up, all API route handlers and server pages calling the backend explicitly export `export const maxDuration = 60;`.
  - Server-side HTTP calls to the backend use an internal timeout of 55 seconds via `fetchWithTimeout`. If the backend does not answer in time, the route handler cleanly returns HTTP 503 `{"error": "backend_unavailable"}` instead of an unhandled function crash.

---

## 3. Function Region Alignment

Network latency between Vercel Serverless Functions and the Render backend directly affects dashboard performance.
- When creating the Vercel project or in **Settings** -> **Functions** -> **Function Region**, select the region closest to your Render backend deployment.
- For example, if Render is hosted in Singapore (`sin`) and the primary audience is in Cambodia or Southeast Asia, select Vercel's Singapore region (`sin1`).
- Keeping both services within the same geographic region family minimizes cross-region round-trip latency for server-to-server API calls.

---

## 4. Production Environment Variables Reference

Configure these variables in **Settings** -> **Environment Variables** for the **Production** environment (and Preview if needed). Never commit secret values to version control.

| Variable | Environment | Required | Description |
| :--- | :--- | :--- | :--- |
| `BACKEND_URL` | Production, Preview | Yes | Public HTTPS URL of the FastAPI backend on Render, e.g. `https://csa-ops-backend.onrender.com` (no trailing slash). |
| `DASHBOARD_API_KEY` | Production, Preview | Yes | Shared secret header (`X-API-Key`) sent to the backend. Must match `DASHBOARD_API_KEY` configured on Render exactly (at least 32 characters in production mode). |
| `DASHBOARD_PASSWORD_HASH` | Production, Preview | Yes | Scrypt hash (`<salt_hex>:<hash_hex>`) for authenticating the SOC operator into the dashboard. Generated with `node scripts/hash-password.mjs "<password>"`. |
| `SESSION_SECRET` | Production, Preview | Yes | Cryptographically strong random string of at least 32 characters used to sign and verify HMAC session cookies. |
| `SESSION_TTL_HOURS` | Production, Preview | Optional | Session duration in hours before re-authentication is required (defaults to 8 hours). |

---

## 5. Preview Deployment Protection

Preview deployments created from pull requests or non-main branches should be protected from unauthorized public access:
1. In the Vercel Dashboard, navigate to **Settings** -> **Deployment Protection**.
2. Enable **Vercel Authentication** or **Password Protection** for Preview deployments.
3. This ensures preview URLs are shielded from untrusted internet traffic while allowing team members to review changes.

---

## 6. Secret Rotation Procedures

### Rotating the SOC Operator Password
1. Generate a new password hash locally:
   ```bash
   node scripts/hash-password.mjs "<new-password>"
   ```
2. Update `DASHBOARD_PASSWORD_HASH` in the Vercel project environment settings.
3. Redeploy the dashboard.
4. Existing user sessions remain signed by `SESSION_SECRET` until their cookie TTL expires, but subsequent logins require the new password. To immediately invalidate all active sessions, rotate `SESSION_SECRET` at the same time.

### Rotating the Session Secret
1. Generate a new random secret of at least 32 characters:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Update `SESSION_SECRET` in the Vercel environment settings.
3. Trigger a redeploy. All existing session cookies will fail HMAC verification and users will be redirected to `/login`.

### Rotating the Dashboard API Key
1. Generate a new high-entropy string of at least 32 characters:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```
2. Update `DASHBOARD_API_KEY` on Render first (or simultaneously).
3. Update `DASHBOARD_API_KEY` on Vercel.
4. Redeploy both services. Ensure both values match exactly; mismatched keys will result in 403 Forbidden responses on backend API calls.

---

## 7. Pre-Demo Checklist

Before presenting a live demonstration to stakeholders or evaluators, follow this sequence:
1. **Two Minutes Prior**: Open the backend health check URL in your browser:
   ```text
   https://<your-render-backend>.onrender.com/healthz
   ```
   If the container was idle and spun down, this initial HTTP request wakes the container. Verify that it returns `{"status":"ok"}`.
2. **One Minute Prior**: Open the Vercel dashboard URL. If the backend is still completing its cold start, the neutral wake-up banner will display:
   > "The demo backend is waking up. This can take up to a minute after it has been idle."
   Wait until the banner automatically dismisses once `/api/backend-status` confirms backend health.
3. **Sign In**: Log in through the `/login` route using your demo password. Verify redirection to the Overview page.
4. **Pre-warm Cache**: Click into the Incidents page and open an incident detail page (e.g. `inc-1001` or `inc-1002`) to verify that the attack chain graph and timeline load cleanly.
