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

## UI

### The incident page

- **Case card** (top of the right rail) and the header show the same case status
  and assignee.
- **Status badge.** Open, Investigating or Resolved. When resolved, the card also
  shows the verdict, the resolution note and when it was resolved.
- **Assignee.** A list of the names from `CASE_ASSIGNEES`, with "Unassigned"
  first. Picking one saves it at once.
- **Start investigating** and **Resolve** are both available on an Open case, so a
  case can be resolved without being investigated first (the audit trail then has
  a `resolved` event and no `status_changed` event). An investigating case offers
  **Resolve** and **Mark as open**; a resolved case offers **Reopen**.
- **Resolve.** Opens a dialog. Choose a verdict (none is preselected), add an
  optional note of up to 1000 characters, then "Resolve case". Escape, Cancel or a
  click outside closes it without changing anything, and nothing typed survives
  the dialog closing.
- **Reopen.** Puts a resolved case back to investigating. The verdict and note are
  cleared, and every earlier event stays in the audit trail.
- **Recorded as.** The name sent with each change (`X-Actor`). Click "Change" to
  edit it; it is kept in the browser (`localStorage`, key `csa-actor-name`) and
  falls back to "Analyst". It is trimmed, stripped of control characters and
  limited to 64 characters.
- **Conflicts.** Every change sends the version the page last saw. If someone else
  changed the case first, the page shows the latest version with the notice "This
  case was changed by someone else" instead of overwriting it.
- **Unavailable.** If the case service cannot be reached the card shows a notice
  with Retry. The rest of the incident page keeps working. The card refreshes
  every 15 seconds while the tab is visible, backing off while the backend is
  failing.

### Case activity and notes

The **Case activity** card sits directly below the AI triage card. It has a note
box on top ("Add a note", up to 2000 characters, Ctrl or Cmd plus Enter to send)
and the audit trail below it, newest first. Each row has a plain sentence ("Priya
changed the status from Open to Investigating"), the time (the exact UTC time is
in its title), and, for notes and resolutions, the text in a bordered block.

The first 6 events are shown; "Show all N events" reveals the rest. The oldest
row is always "Case opened". Notes are always shown as plain text, never as HTML,
so markup in a note appears literally. A note that fails to save stays in the box
with an error underneath it, and an empty or whitespace-only note is never sent.

### Lists

- **Incidents list.** New **Status** and **Assignee** columns (before Last action),
  both sortable, and two filters beside the existing ones. Status: All, Active
  (open or investigating), Open, Investigating, Resolved. Assignee: All,
  Unassigned, or a name. They are kept in the URL as `status` and `assignee`. A
  legacy `?status=open` link now means Open exactly; the old filter that guessed
  status from the last response action is gone. Last action is hidden below 1280px
  wide, before any other column. The Raised column shows a formatted date and time
  (the exact UTC time is in the cell's title, the display time zone in the column's
  title) and sorts by the real timestamp.
- **Overview.** "Open incidents" counts incidents whose case is open or
  investigating, so resolving a case removes it. It links to
  `/incidents?status=active`, and the Newest incidents list shows the same
  unresolved incidents.
- **When case data is unavailable** the list and the Overview keep working and
  treat incidents without case data as Open (the list adds a muted "Case data
  unavailable" note beside the result count).
- An incident with no stored case is Open and unassigned everywhere.

The incident's Details card shows "Not classified" when the detection did not match
a scenario.

### Safety

The recorded name is only a label. The dashboard has one shared login, so names
are not verified and anyone can record changes under any name.

Case changes are for analysts. They never change detections or response actions:
no case control starts a response action, and the browser talks only to the
dashboard's own `/api/cases` and `/api/incidents/<id>/case` routes, which forward
to the case endpoints and nothing else.

The proxy routes validate the incident id (letters, digits, `_` and `-`, up to 64
characters), require a JSON object body of at most 8 KB on changes, pass the
backend status and body through unchanged (including the 409 body that carries the
current case) and never forward cookies. The browser URI-encodes the name in
`X-Actor`; because the backend takes the name as an HTTP header, characters outside
Latin-1 are stored as `?`.
