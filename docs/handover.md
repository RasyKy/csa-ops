# CSA-OPS: Person B handover — status and what's next

Branch: `feature/backend-response`. Last commit on origin: `d962129`.
124 tests passing, 1 skipped (Phase 4 live-VM marker, intentionally never run
on this machine). See `docs/person_b.md` for full setup/safety/contracts
detail — this doc is the short version plus what's planned next.

## What's built and verified (not just written)

Everything in Person B's scope (backend API, intake watcher, response
engine, agent, AI triage/explain, dashboard) is built and tested. A few
things are specifically worth knowing weren't just unit-tested against
fixtures or fakes, but proven against the real thing:

- **AI triage/explain** — real calls against the actual DeepSeek endpoint
  (401-failure path) and a local fake OpenAI-compatible server (full
  success path: verdicts, Explain button, caching). Import-isolation from
  `engine/response` is proven with a real AST import-graph walk, not a
  docstring claim.
- **Elasticsearch integration** — ran the backend against a real Docker ES
  cluster, not just a fake client. Found and fixed two bugs that only a
  real cluster could expose: every `term` query was silently matching
  nothing (ES's default dynamic mapping needs `.keyword` sub-fields), and
  list endpoints 500'd on an index that doesn't exist yet (the real state
  of a fresh cluster before any data is written).
- **The intake watcher doesn't block the server anymore** — a real bug
  found in a self-review pass: the watcher called `poll_once()` directly
  on the event loop, so a real LLM call (up to 20-40s) froze `/health`,
  dashboard polling, and the agent's long-poll. Fixed with
  `run_in_executor`, and live-verified: hit `/health` repeatedly while a
  4-second-per-call fake LLM was mid-triage and got consistent ~150ms
  responses throughout.
- **Idempotency** — clearing `intake_state` used to re-issue duplicate
  response actions and re-run triage. Fixed so `commander.handle_incident`
  and `triage_incident` each check their own store first. Also fixed a
  regression in that same fix (it originally treated a prior *manual*
  action as if the automatic policy had already run, which would have
  silently suppressed the real automatic response).

## Two commits not yet pushed

The self-review pass above (watcher non-blocking fix, exception isolation,
idempotency/manual-action fix, explain status check, LLM max_tokens fix,
doc cleanup) is committed locally but not pushed. Run `git push` when
ready — nothing else is pending.

## What's genuinely blocked (not just unbuilt)

| Item | Blocked on |
|---|---|
| Live response testing (`kill_process`, `block_address`, `isolate_host` actually executing) | A disposable, snapshotted Windows VM. Code and gated tests (`-m live`) are complete, never run. |
| Kafka incident handoff (`kafka_source.py`) | Person A confirming whether they publish to Kafka at all, and the topic name. Currently a stub. |
| Full end-to-end integration (alert → incident → triage → response, live on the dashboard) | Person A's `engine/detection/`/`engine/correlation/` and Person C's attack scripts — both still empty stubs on this branch. |

**Not blocked, just optional:** NFR-9 (ingestion throughput benchmark) —
benchmarks Person A's consumer, not B's code; doc marks it
whoever-has-downtime-first.

## Team split, for reference

- **Person A** owns detection (`engine/detection/`, Sigma rules, baseline
  tracking) and correlation (`engine/correlation/`, attack chain
  reconstruction, risk scoring, writes to the `incidents` index).
- **Person C** owns the attack simulation scripts (3 multi-stage scenarios)
  that exercise the whole pipeline end-to-end.
- **Person B (this branch)** owns everything downstream of the `incidents`
  index: response, AI, dashboard, and the backend API connecting them.

## What we plan

Current scope (everything above) is complete for what CLAUDE.md specifies.
Decision: rather than picking up Person A's or C's work, the plan is to
add more features/functionality beyond the committed spec — current scope
feels thin for a demo/portfolio standpoint. Ideas not brainstormed yet;
this section is intentionally left open for that next session.

Constraints for whatever gets added, so it doesn't conflict with what's
already built:
- Stay in Person B's territory (`backend/`, `engine/response/`,
  `engine/ai_explain/`, `dashboard/`, `agent/`) — don't touch A's or C's
  areas.
- Keep the safety model intact: kill switch → dry-run → decision order is
  fixed (CLAUDE.md rule 1), dry-run stays the default, `engine/ai_explain`
  stays read-only and isolated from `engine/response` (rule 5, and there's
  a real AST-based test enforcing this — any new AI feature needs to keep
  passing it).
- Whatever's added should still run against fixtures with no live
  dependencies, the same way everything above does.
