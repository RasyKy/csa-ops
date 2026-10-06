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

## Incident report

`GET /incidents/{id}/report?format=md|pdf` includes a **Case** section. It sits
after Response actions and before the footer: the report already runs from what
happened (summary, attack chain, indicators) through the AI's view and what the
system did, and the analyst's handling is the last step of that story, in line
with the post-incident activity step of NIST SP 800-61. An existing legacy "Case
details" block (only present if an incident document itself carries status or
assignee fields) is left where it was.

What it contains:

- **Status** and **Assignee** ("Unassigned" when there is none).
- When the case is resolved: **Verdict**, **Resolution note** (if any) and
  **Resolved time**.
- **Case activity**: every event oldest first as `<time> | <sentence>`, using the
  report's existing time format (the stored UTC time). Notes and resolution notes
  appear as an indented block quote under their event. The wording comes from
  `backend/app/case_text.py`, which mirrors `dashboard/lib/caseDisplay.ts`.
- A case with no events (the virtual default) is one line: "No analyst activity
  recorded. Status: Open."
- At most 200 events are listed. The newest 200 are kept, still oldest first, and a
  last line says how many older events were left out.

Analyst-written text (actor names, assignees, notes, resolution notes) is
untrusted. It goes through the same neutralization as other free text in the
report: Markdown special characters are escaped, a note line that starts with a
block marker (`#`, `-`, `>`, `1.`) is defused, and the PDF escapes HTML, so a note
can never create a heading, list, link, code block or HTML element. Long strings
without spaces wrap. The Markdown and PDF come from the same source text, so they
cannot drift.

The endpoints read the incident's case from the case store (the virtual default
when none is stored) and never write. `include_case=false` leaves the section out.
If `cases.json` cannot be used (corrupt, or an entry that does not validate), the
export still works and simply has no Case section. A builder call with `case=None`
produces exactly the report as it was before cases existed.

## Case metrics

Bookkeeping numbers over resolved cases. They never feed detection, correlation,
scoring, response actions or AI output (`engine/` does not import the metric
code; `tests/ai_explain/test_isolation.py` enforces it), and a corrupt or missing
`cases.json` just reads as "no cases".

`GET /metrics/cases?range=` (dashboard key; the same `range` handling as the
other metrics: incidents are scoped by `incident_raised_time`). The pure
functions are in `backend/metrics/case_metrics.py`.

| Value | Meaning |
| --- | --- |
| `status_counts` | open, investigating and resolved over the incidents in range. An incident without a stored case is open. Always `ok` when there are incidents. |
| `ai_agreement` | Over **resolved** cases only (a reopened case is investigating again and does not count). Each resolved case is exactly one of `scored`, `ai_uncertain` or `unscored`, so `resolved_total = scored + ai_uncertain + unscored`. `agree` and `disagree` split `scored`. `confusion` has the four cells `ai_<side>_analyst_<side>`. |
| `resolve_time` | Seconds from a case's first event to its last `resolved` event (a case reopened and resolved again counts to the second resolution): `count`, `median_seconds`, `p90_seconds`, `values_seconds`. Cases with missing or unparseable times are skipped. |
| `verdicts_by_rule` | `{rule_id: {true_positive, false_positive, benign_activity, undetermined, total}}`. Every alert of a resolved incident counts once under its rule with the incident's analyst verdict. |

Each is wrapped as `{value, status}`; `status` is `no_data` when no case is
resolved (and `ok` otherwise).

**Sides.** For the AI, `true_positive` and `likely_true_positive` are malicious,
`false_positive` and `likely_false_positive` are benign, and `needs_review` is
uncertain. For the analyst, `true_positive` is malicious, `false_positive` and
`benign_activity` are benign, and `undetermined` is not scored. Triage that failed,
is missing or has no verdict is not scored.

**On the Overview** (inside existing cards, no new cards; the rows are left out if
`/api/metrics/cases` is unavailable):

- **AI triage**: "Analyst agreement", for example "5 of 7 resolved incidents" (always
  counts, never percentages), a muted line with the rest ("1 disagree, 2 not scored,
  1 uncertain"), and a tooltip explaining the sides. With no resolved case it reads
  "No resolved incidents yet".
- **Open incidents**: a muted line "3 open · 2 investigating · 3 resolved" and, when
  at least one case is resolved, "Median time to resolve: 12 min (3 resolved)".
- **Detection quality**: below the existing fixture-label rows, an "Analyst verdicts"
  block with "`<fp>` of `<total>` false positive" per rule (and "n benign" when there
  are benign verdicts), most alerts first. It appears only when at least one rule has
  a resolved verdict.

### Evidence for the final report

```
python scripts/ai_vs_analyst_report.py --set realistic
python scripts/ai_vs_analyst_report.py --set default
python scripts/ai_vs_analyst_report.py --set NAME [--data-root DIR] [--fixture-root DIR]
```

It prints a Markdown table (incident, host, scenario, AI verdict with confidence,
analyst verdict, agreement as Agree, Disagree, AI uncertain or Not scored), the
summary counts and the confusion table, using the same functions as the endpoint,
so the report and the Overview agree. It is read only and never writes a file. It
reads `fixtures/[NAME/]incidents.json`, `data/[NAME/]incident_triage.json` and
`data/[NAME/]cases.json`.

Caution: with only a handful of resolved incidents these numbers are
illustrations of how the comparison works, not statistics about how accurate the AI
is. Say so next to any table you paste into a report.
