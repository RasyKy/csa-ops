# Person B: setup, safety model, data contracts

Everything Person B owns (backend API, intake watcher, response engine,
agent, dashboard) is built through Phase 4, plus the fixtures- and
code-level parts of Phase 6 (Elasticsearch store, MTTR report, NFR-4
measurement). Phase 5 (AI triage and explain) has not been built --
`engine/ai_explain/` is still empty stub files, and the dashboard's
Triage/Explain panels will always show "no data yet" until it is.

## Setup from zero

### Prerequisites

- Windows 11, PowerShell (use `curl.exe`, not the `curl` alias)
- Python 3.11+
- Node 20+
- Docker Desktop -- only needed if you're pointing at a real Elasticsearch
  cluster (`STORE_BACKEND=elasticsearch`). Fixtures mode needs none of it.

### 1. Install

```powershell
git clone <repo-url>
cd csa-ops
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
cd dashboard
npm install
cd ..
```

### 2. Environment

```powershell
Copy-Item .env.example .env
Copy-Item dashboard\.env.example dashboard\.env.local
```

Edit both. At minimum, `DASHBOARD_API_KEY` must be the same value in `.env`
(backend) and `dashboard\.env.local` (dashboard) -- the dashboard attaches
this key server-side on every call to the backend. `AGENT_API_KEY` only
needs to match between `.env` and wherever the agent is run.

### 3. Run the backend (fixtures mode -- no Docker needed)

```powershell
uvicorn backend.app.main:app --reload
curl.exe http://localhost:8000/health
```

Expect `{"store": "fixtures", "kill_switch": false, "response_mode": "dry_run"}`.
The backend log will show the intake watcher auto-dispatching a dry-run
response for each of the 4 fixture incidents within a couple of seconds.

### 4. Run the dashboard

```powershell
cd dashboard
npm run dev
```

Open `http://localhost:3000`. By default `next dev` binds to `0.0.0.0`,
which is reachable from your LAN if Windows Firewall allows it (check
`netstat -ano` and `netsh advfirewall firewall show rule name=all` if
you're unsure). Use `npm run dev -- -H 127.0.0.1` to bind localhost-only.

### 5. Run the agent

```powershell
$env:AGENT_API_KEY = "<same value as backend's .env>"
$env:BACKEND_URL = "http://localhost:8000"
python -m agent.agent
```

On the real Machine 1 (the Windows endpoint), install this as an elevated
Scheduled Task -- Task Scheduler, "Run whether user is logged on or not",
"Run with highest privileges", trigger "At startup" -- pointed at
`python -m agent.agent`, or start it manually in an elevated PowerShell
window. **Only set `AGENT_LIVE=true` on a disposable, snapshotted VM** (see
CLAUDE.md Phase 4) -- it enables real process kills, firewall changes, and
file quarantine.

### 6. Point at real Elasticsearch

```powershell
$env:STORE_BACKEND = "elasticsearch"
$env:ES_HOST = "http://<machine-2-ip>:9200"
uvicorn backend.app.main:app --reload
```

If ES is unreachable at startup, the backend logs an error and refuses to
start -- it never silently falls back to fixtures. `es_store.py` is fully
implemented (see `backend/app/store/es_store.py`) but **has never run
against a real cluster** -- see Known Limitations.

## Safety model

Three independent layers, evaluated in a fixed order every time (kill
switch, then mode, then decision -- never reordered):

1. **Kill switch** (`engine/response/safety.py`, file-backed at
   `KILL_SWITCH_PATH`). When set, the backend never dispatches a new
   command, and any command already sitting in the queue is withheld from
   `GET /agent/commands` rather than handed out. The agent independently
   refuses anything the backend's response body flags as
   `kill_switch: true`, as a second layer.
2. **Dry-run by default**, on both sides independently: the backend won't
   mark an action `mode=live` unless `RESPONSE_LIVE=true` *and* the
   incident's host is listed in `RESPONSE_LIVE_HOSTS`; the agent won't
   actually execute a live action unless its own `AGENT_LIVE=true` *and*
   the command it received says `mode=live`. Both must agree.
3. **Policy decision** (`engine/response/decision.py` +
   `policy.yaml`): severity default, overridden by scenario if
   `matched_scenario` is set. Actions in `policy.yaml`'s `never_auto` list
   (`unisolate_host`, `restore_file`, `unblock_address`) can only be
   issued through `POST /response/actions` (the manual endpoint) -- the
   automatic path refuses to dispatch one even if a policy misconfiguration
   ever mapped a severity/scenario to one.

## Data contracts

See `docs/interfaces.md` for the full field-level contract. Summary of
index ownership:

| Index | Owner |
| --- | --- |
| `logs-normalized` | ingestion |
| `alerts`, `incidents` | Person A |
| `incident_triage`, `response_actions`, `intake_state` | Person B (this repo) |

B never writes to A's indices; joins happen at read time in the backend
(`GET /incidents` joins triage verdict + latest response action per
incident).

## Running the tests

```powershell
pytest tests/                          # everything
pytest tests/response/ tests/agent/    # response engine + agent (dry-run)
pytest tests/backend/                  # API, store, NFR-4, MTTR script logic
python scripts/mttr_report.py [output.csv]
```

Two things are skipped by default and need extra setup to run:

- Anything needing the real `elasticsearch` package: only
  `test_es_store.py`'s connection-refusal test actually needs it installed
  (`pip install elasticsearch`, already in `backend/requirements.txt`).
  Everything in `test_es_store_queries.py` uses a fake client and runs
  without it -- those verify query *shapes*, not real ES behavior.
- `tests/agent/test_windows_actions.py` -- needs `$env:CSA_OPS_LIVE_TESTS = "1"`,
  an elevated (Administrator) process, and a disposable Windows VM. It
  kills real processes and changes real Windows Firewall rules. **Never
  run this against a machine you care about.**

## Known limitations

1. **Phase 5 doesn't exist.** `engine/ai_explain/` is empty stubs. No
   triage verdicts, no explain endpoint, dashboard panels stay empty.
2. **Elasticsearch is untested against a real cluster.** `es_store.py`'s
   query-building logic is unit-tested with a fake client, but two real ES
   behaviors are unverified: (a) `list_*` methods use `_search`, which is
   only eventually consistent (~1s default refresh interval) -- a
   `response_actions` doc saved by the commander and immediately polled by
   the agent could theoretically miss one refresh cycle. The agent's 10s
   long-poll loop should absorb this in practice, but it's never been
   proven against a real cluster. (b) None of B's own indices
   (`incident_triage`, `response_actions`, `intake_state`) have an index
   template -- field types are whatever dynamic mapping guesses on first
   write, the same category of risk already flagged for `logs-normalized`
   in the Phase 0 audit.
3. **Clock sync.** NFR-8 (MTTR, `scripts/mttr_report.py`) and NFR-4
   (dashboard visibility, logged by `backend/app/metrics.py`) both compare
   ISO timestamps produced by different processes (agent, backend,
   ingestion). If Machine 1 and Machine 2 aren't NTP-synced, these numbers
   will be wrong in a way that looks exactly like real latency. There is
   no automated check for clock drift here -- verify manually.
4. **Single-endpoint assumption.** The agent identifies itself by hostname
   (`socket.gethostname()` unless `AGENT_HOST` overrides it) and polls
   `/agent/commands?host=<that name>`. The whole design assumes one agent
   per host; multiple simultaneous Windows endpoints are architecturally
   plausible (host is already a first-class field everywhere) but have
   never been run or tested.
5. **LLM data egress (forward-looking, Phase 5).** Once built, `prompts.py`
   is specified to send the full incident JSON -- including real command
   lines -- to whichever `LLM_PROVIDER` is configured. That's real
   telemetry leaving the network to a third-party API. This should be a
   deliberate, reviewed decision when Phase 5 starts, not a silent default.
6. **`docs/interfaces.md`'s open questions are still open.** Scenario
   naming, whether Person A populates `targets`, and Kafka-vs-polling for
   incident handoff are all still assumptions, not confirmed contracts,
   because Person A hasn't shipped anything to reconcile against yet.
   `engine/ai_explain` aside, this is the main reason Phase 6 can't fully
   close: there's no real `alerts`/`incidents` data to point the ES store
   at, so `STORE_BACKEND=elasticsearch` mode is implemented but unverified
   end-to-end.
7. **`backend/app/intake/kafka_source.py` is still an empty stub.**
   Switching from polling to Kafka-based incident handoff needs Person A's
   actual topic name and message format, neither of which exist yet.

## What's genuinely blocked, not just unbuilt

- Reconciling `docs/interfaces.md` with what Person A actually writes --
  blocked on Person A having real `alerts`/`incidents` documents to look at.
- Enabling `kafka_source.py` -- blocked on Person A confirming they publish
  to Kafka at all, and if so, the topic name.
- The full Phase 6 manual checklist (Person C fires a scenario, alert rows
  appear, then an incident, then a response action) -- blocked on Person A
  and Person C's pieces existing and being reachable from this backend.
- Phase 4's live-VM manual checklist (`isolate_host` actually cutting and
  restoring connectivity) -- requires a disposable, snapshotted Windows VM;
  intentionally never run against a real machine while building this.
