# Dashboard

Next.js 14 (App Router) + TypeScript + Tailwind frontend for CSA-OPS.

## Setup

```
cp .env.example .env.local   # fill in DASHBOARD_API_KEY to match the backend
npm install
npm run dev
```

Requires the backend running at `BACKEND_URL` (default `http://localhost:8000`).

## Architecture

- `app/api/*` -- route handlers that proxy to FastAPI, attaching
  `DASHBOARD_API_KEY` from server env. Client components only ever call
  these same-origin routes, never the backend directly, so the key never
  reaches the browser.
- `app/incidents/[id]/page.tsx` -- a Server Component; it fetches the
  backend directly (via `lib/api.ts`) since it needs no client-side polling.
  Still never exposes the key to the browser -- the fetch runs on the
  server.
- `components/IncidentsView.tsx` / `AlertsView.tsx` -- client components
  with filters; incidents poll every 3 seconds (NFR-4).
- `components/IncidentGraph.tsx` -- attack chain graph via `@xyflow/react`,
  laid out with `dagre`.
