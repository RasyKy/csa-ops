# Person B: setup, safety model, data contracts

Everything Person B owns is built and tested: backend API, intake watcher,
response engine, agent (dry-run; live mode is code-complete but only
runnable on a disposable VM -- see Known Limitations), AI triage and
explain (Phase 5), dashboard, and the fixtures- and code-level parts of
Phase 6 (MTTR report, NFR-4 measurement). `STORE_BACKEND=elasticsearch` has
been verified against a real Elasticsearch cluster, not just unit-tested
against a fake client -- see "Point at real Elasticsearch" below.

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
start -- it never silently falls back to fixtures. `es_store.py` has been
verified against a real cluster (Docker, `docker-compose.yml`'s
`elasticsearch` service): `/health` reports `store: elasticsearch`, and a
full round trip through every B-owned index (`incident_triage`,
`response_actions`, `intake_state`) and through the real HTTP API works.

Two real bugs only a live cluster could catch, both fixed:

1. Every `term` query (`incident_id`, `host`, `status`, `severity`) queried
   the bare field name. Elasticsearch's default dynamic mapping makes
   string fields `text` (analyzed) with a separate `.keyword` sub-field for
   exact matches -- a term query against the analyzed field silently
   matched nothing. Fixed by querying `.keyword` everywhere.
2. `list_alerts`/`list_incidents`/etc. threw a 500 when their index didn't
   exist yet -- the real state of a fresh cluster before any data has been
   written, since Elasticsearch only auto-creates an index on a write, not
   a read. Fixed with a shared `_search()` helper that treats a missing
   index as an empty result.

Also: `backend/requirements.txt` pinned `elasticsearch==8.13.4`, which
doesn't exist on PyPI (that's the server's Docker image tag, not a client
version). Pinned to `8.13.2` instead.

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
4. **Idempotency, ahead of all of the above.** `commander.handle_incident`
   and `triage_incident` each check their own store (`response_actions`,
   `incident_triage`) for an existing record on that `incident_id` before
   doing anything else. This is not the same guarantee as the intake
   watcher's processed-set: that set lives in `intake_state` and is meant
   to be clearable (e.g. to re-test triage against the fixture incidents),
   and clearing it used to re-fire the commander too, issuing a second
   `isolate_host` for an incident that already had one. Now a cleared
   `intake_state` only ever re-offers an incident to handlers that check
   their own store first and no-op if it's already there.

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

In fixtures mode, all three B-owned "indices" are just JSON files under
`./data/` (`INTAKE_STATE_PATH`, `RESPONSE_ACTIONS_PATH`,
`INCIDENT_TRIAGE_PATH` -- all overridable via env var). `incident_triage`
used to be in-memory only, so a backend restart silently lost every triage
verdict for incidents the watcher had already marked processed and would
never re-offer. It's now persisted the same way `response_actions` always
was.

## Running the tests

```powershell
pytest tests/                          # everything
pytest tests/response/ tests/agent/    # response engine + agent (dry-run)
pytest tests/backend/                  # API, store, NFR-4, MTTR script logic
python scripts/mttr_report.py [output.csv]
```

One thing is skipped by default and needs extra setup to run:

- `tests/agent/test_windows_actions.py` -- needs `$env:CSA_OPS_LIVE_TESTS = "1"`,
  an elevated (Administrator) process, and a disposable Windows VM. It
  kills real processes and changes real Windows Firewall rules. **Never
  run this against a machine you care about.**

## Known limitations

1. **Elasticsearch: query correctness is now proven, two residual risks
   remain.** `es_store.py` has been run against a real cluster and both
   bugs that testing-with-a-fake-client couldn't catch (bare-field `term`
   queries matching nothing; a 500 on a not-yet-existing index) are fixed
   -- see "Point at real Elasticsearch" above. Still unverified: (a)
   `list_*` methods are only eventually consistent (~1s default refresh
   interval) -- a `response_actions` doc saved by the commander and
   immediately polled by the agent could theoretically miss one refresh
   cycle. The agent's 10s long-poll loop should absorb this in practice,
   but it's never been proven under load. (b) None of B's own indices
   (`incident_triage`, `response_actions`, `intake_state`) have an
   explicit index template -- field types beyond the string fields already
   fixed are whatever dynamic mapping guesses on first write, the same
   category of risk already flagged for `logs-normalized` in the Phase 0
   audit.
2. **Clock sync.** NFR-8 (MTTR, `scripts/mttr_report.py`) and NFR-4
   (dashboard visibility, logged by `backend/app/metrics.py`) both compare
   ISO timestamps produced by different processes (agent, backend,
   ingestion). If Machine 1 and Machine 2 aren't NTP-synced, these numbers
   will be wrong in a way that looks exactly like real latency. There is
   no automated check for clock drift here -- verify manually.
3. **Single-endpoint assumption.** The agent identifies itself by hostname
   (`socket.gethostname()` unless `AGENT_HOST` overrides it) and polls
   `/agent/commands?host=<that name>`. The whole design assumes one agent
   per host; multiple simultaneous Windows endpoints are architecturally
   plausible (host is already a first-class field everywhere) but have
   never been run or tested.
4. **LLM data egress.** `prompts.py` sends the full incident JSON --
   including real command lines, once ingestion stops dropping that field
   (see `docs/interfaces.md` section 1a) -- to whichever `LLM_PROVIDER` is
   configured. `LLM_BASE_URL` currently points at a third-party provider
   (DeepSeek). That's real telemetry leaving the network to a third party
   on every new incident, automatically, not just on the on-demand explain
   call. This has been built and is live-tested, but the data-egress
   decision itself should stay a deliberate, reviewed one, not treated as
   settled just because the code works.
5. **`docs/interfaces.md`'s open questions are still open.** Scenario
   naming, whether Person A populates `targets`, and Kafka-vs-polling for
   incident handoff are all still assumptions, not confirmed contracts,
   because Person A hasn't shipped anything to reconcile against yet. B's
   own read/write paths against Elasticsearch are now verified end-to-end;
   what's still unverified is everything downstream of A's real
   `alerts`/`incidents` documents, because none exist yet to point at.
6. **`backend/app/intake/kafka_source.py` is still an empty stub.**
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
