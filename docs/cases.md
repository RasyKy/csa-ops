# Analyst cases

A case is the analyst's working record for one incident: who owns it, where it
stands, what was found, and how it ended. It is bookkeeping for people. The
data model and endpoints are in `docs/interfaces.md` (Cases).

## Where it lives

`cases.json` next to the other runtime files:

- default set: `data/cases.json`
- named set (`FIXTURE_SET=realistic`): `data/realistic/cases.json`
- `DATA_ROOT` redirects the base directory, as it does for the other runtime files.

The format is `{"<incident_id>": Case}`. Cases are file-backed whatever
`STORE_BACKEND` is, so Elasticsearch mode keeps them on the backend machine's
disk (single backend process assumed, like the other runtime files). Writes go
to a temp file in the same directory and are moved into place with
`os.replace`, under a lock, so a crash never leaves a half-written file. A
missing file is an empty store. A corrupt file loads as empty with a logged
warning; the next write sets the unreadable file aside as `cases.json.corrupt`
instead of silently destroying it.

## Virtual default

An incident with no stored case still answers `GET /incidents/{id}/case`: status
`open`, no assignee, no events, version 0. Nothing is written. The first
mutation creates the case with a `created` event followed by the mutation's own
event. A refused mutation (409) or a no-op creates nothing.

## Audit trail

`events` is append-only. Every effective change adds an event with a sequential
id (`evt-1`, `evt-2`, ...), a UTC time with milliseconds, the actor and a small
data object. Reopening clears the verdict, resolution note and resolved time on
the case but keeps every event, including the earlier resolution. `version`
equals the event count and is what `expected_version` is compared against: a
stale client gets 409 with the current case instead of overwriting newer work.
A change to the value already held (same status, same assignee) is a no-op and
adds nothing.

Notes are stored exactly as sent (trimmed). The API never renders HTML; a client
that shows a note must escape it.

## Assignees

`CASE_ASSIGNEES` (comma separated, default `Unassigned,Analyst 1,Analyst 2,Analyst 3`)
is the list of allowed names. `Unassigned` (or `null`) stores no assignee.
Anything else is rejected with 422. `GET /cases/assignees` returns the list.

## Actor

`X-Actor` names who made a change (default `analyst`). It is an unauthenticated
label, not an identity.

## Non-goals

- No authentication or user accounts beyond the shared dashboard key.
- No SLA timers, due dates or reminders.
- No automatic status changes from detection, correlation, triage or response.
- Case data never influences detection, correlation, scoring, response actions or
  AI output. The case modules and `engine/response` and `engine/ai_explain` do
  not import each other (enforced in `tests/ai_explain/test_isolation.py`), and
  the case endpoints never call the response engine or write alerts, incidents,
  triage or explain data.
