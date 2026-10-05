# Render Deployment Guide (Demo Backend)

This document describes how to deploy the CSA-OPS FastAPI backend as a public demo on Render's free tier, its configuration variables, seed data lifecycle, cold start behavior, and security characteristics.

---

## 1. Overview and Architecture

The CSA-OPS backend runs on Render as a Python web service under the Free instance tier.
In demo mode:
- `STORE_BACKEND=fixtures` and `FIXTURE_SET=realistic` serve realistic scenario fixtures.
- `DEMO_BOOTSTRAP=1` reconstructs the demo workspace in ephemeral storage (`/tmp/csa-ops-demo`) upon every container start, dynamically generating the scenario events and alerts with the current UTC anchor time, seeding triage/response records, and rebasing timestamps so data is always fresh.
- The dashboard frontend hosted on Vercel communicates with this backend server-to-server via Next.js API routes and server components.

---

## 2. Deployment Instructions

### Option A: Render Blueprint (Recommended)

1. Connect your repository to Render.
2. In the Render Dashboard, click **New** -> **Blueprint**.
3. Select this repository. Render detects [`render.yaml`](file:///c:/KIT%20-%20Software%20Engineering/Year%203/Semester%202/Intern/csa-ops/render.yaml) at the repository root.
4. Render will prompt you to enter the secret environment variables (`sync: false`):
   - `DASHBOARD_API_KEY`: generate a cryptographically strong string of at least 32 characters (e.g. `openssl rand -hex 24`).
   - (Optional) `LLM_API_KEY`, `LLM_MODEL`, `LLM_PROVIDER`, `LLM_BASE_URL` if enabling live AI explanations.
5. Click **Apply**. Render builds the service using `requirements-render.txt` and launches the application.

### Option B: Manual Web Service

1. In Render Dashboard, click **New** -> **Web Service**.
2. Connect your Git repository.
3. Configure the service settings:
   - **Name**: `csa-ops-backend` (or your preferred name)
   - **Runtime**: `Python`
   - **Plan**: `Free`
   - **Build Command**: `pip install -r requirements-render.txt`
   - **Start Command**: `uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT`
   - **Health Check Path**: `/healthz`
   - **Auto-Deploy**: `No` (recommended for demos so manual redeploys occur only after verified seed updates)
4. Add the environment variables listed in Section 3.
5. Click **Create Web Service**.

---

## 3. Environment Variables Reference

| Variable | Side | Required | Value / Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `APP_ENV` | Render | Yes | `production` | Enables production mode: disables `/docs`, `/redoc`, and `/openapi.json` (404), enforces $\ge 32$-character `DASHBOARD_API_KEY`, and omits browser CORS. |
| `STORE_BACKEND` | Render | Yes | `fixtures` | In-memory store loaded from fixture files. |
| `FIXTURE_SET` | Render | Yes | `realistic` | Selects the realistic multi-host scenario set. |
| `DEMO_BOOTSTRAP` | Render | Yes | `1` | Triggers runtime state reconstruction into an ephemeral work directory at container startup. |
| `INTAKE_ENABLED` | Render | Yes | `false` | Disables background file-watching intake loop (fixtures demo does not intake live Kafka/ES events). |
| `PYTHON_VERSION` | Render | Yes | `3.14.2` | Pins Python runtime version supported by Render. |
| `DASHBOARD_API_KEY` | Render & Vercel | Yes | Secret ($\ge 32$ chars) | Shared authentication secret sent via `X-API-Key` header. Never committed to version control. |
| `LLM_API_KEY` | Render | Optional | Secret | API key for Anthropic/OpenAI provider. |
| `LLM_PROVIDER` | Render | Optional | `anthropic` or `openai` | Model provider for AI explain and triage. |
| `LLM_MODEL` | Render | Optional | e.g. `claude-3-5-haiku-20241022` | Specific LLM model identifier. |
| `LLM_BASE_URL` | Render | Optional | `""` | Custom API base URL if using an inference proxy. |

### Vercel Environment Variables (Frontend)
The dashboard deployment on Vercel requires the following environment variables (see `docs/deploy-vercel.md` for full setup instructions):
- `BACKEND_URL`: Public HTTPS URL of your Render web service (e.g. `https://csa-ops-backend.onrender.com`).
- `DASHBOARD_API_KEY`: Exactly matching the 32+ character key configured on Render.
- `DASHBOARD_PASSWORD_HASH`: Scrypt password hash (`<salt_hex>:<hash_hex>`) generated via `node scripts/hash-password.mjs "<password>"`.
- `SESSION_SECRET`: Cryptographically strong random string of at least 32 characters for session HMAC signing.
- `SESSION_TTL_HOURS`: Optional session duration in hours (defaults to 8 hours).

---

## 4. Demo Seed Lifecycle and Refresh

The demo state is persisted in committed seed files under `deploy/seed/realistic/`:
- `incident_triage.json`
- `response_actions.json`
- `intake_state.json`
- `cases.json` (if present)

### How to Refresh the Seed
1. Run local triage, response actions, or explain generation to update your local runtime files in `data/realistic/`.
2. Run the export script:
   ```bash
   python scripts/export_demo_seed.py --set realistic
   ```
3. The script verifies:
   - At least 8 incidents exist in the source data.
   - No triage record has `status: "failed"`.
   - No sensitive strings like `sk-` or `Bearer ` exist in the data.
4. Review the generated markdown summary table printed by the script.
5. Review the files in `deploy/seed/realistic/`.
6. Commit the updated seed directory to git and push.

---

## 5. Cold Starts, Keep-Alive, and Wake-Up Behavior

### Render Free Tier Lifecycle
- **Spin-Down**: Render automatically spins down free web services after 15 minutes of inbound HTTP inactivity.
- **Cold Start**: When a new request arrives after spin-down, Render allocates a container and boots the app. The cold start typically takes **50 to 60 seconds**.
- **Ephemeral Filesystem**: The local disk is entirely wiped on every restart or spin-down. When the container wakes up, `DEMO_BOOTSTRAP=1` reconstructs the entire scenario state from the committed seed in less than 1 second, rebasing all incident timestamps so they appear recent relative to current UTC time.

### Keep-Alive Options
If you wish to prevent spin-down and eliminate the cold start delay:
- Configure a free external HTTP pinger (such as [UptimeRobot](https://uptimerobot.com), [Better Stack](https://betterstack.com), or [cron-job.org](https://cron-job.org)) to perform a `GET` request to `/healthz` every **10 minutes**.
- `/healthz` returns `{"status":"ok"}` immediately without performing database queries or store lookups, keeping memory footprint minimal.
- **Note on Vercel Crons**: Vercel Hobby plan crons are limited to once per day. Therefore, Vercel cron jobs cannot be used for 10-minute keep-alive pings.

---

## 6. Security and Operational Limits

### Authentication and Access Control
- All operational endpoints (`/incidents`, `/alerts`, `/metrics/*`, `/cases`, etc.) strictly require the `X-API-Key` header matching `DASHBOARD_API_KEY`. Requests without a key receive `401 Unauthorized`; requests with an invalid key receive `403 Forbidden`. In production mode (`APP_ENV=production`), `GET /health` also requires `DASHBOARD_API_KEY`.
- The only unauthenticated endpoint is `GET /healthz`, which returns only `{"status":"ok"}` with no internal metadata, timestamps, or system paths.
- Interactive documentation (`/docs`, `/redoc`) and schema definition (`/openapi.json`) are completely disabled in production mode (`APP_ENV=production`), returning `404 Not Found`.
- To rotate keys: change `DASHBOARD_API_KEY` on Render and Vercel in parallel.

### Ephemeral Demo Limits
- Case notes, investigator assignments, and manually triggered response actions created by users during a demo session exist in container memory and ephemeral disk. They will reset to the pristine seed state when the service restarts.
- Memory consumption of the backend in fixtures mode is approximately **56 MB RSS**, well below Render's 512 MB free tier quota.

### AI Explanation Costs
- The backend only invokes external LLM APIs when `LLM_API_KEY` is explicitly set on Render and a user triggers an AI analysis action.
- Leaving `LLM_API_KEY` unset on Render guarantees zero external AI API costs; the backend will cleanly report that AI analysis is unconfigured.

