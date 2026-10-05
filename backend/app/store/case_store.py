"""File-backed case store (docs/cases.md).

One JSON file, {"<incident_id>": Case}, kept apart from detection data. Every
operation reloads the file under a lock, so a second store instance over the
same file always sees current data. Writes go to a temp file in the same
directory and are moved into place with os.replace, so a crash never leaves a
half-written cases.json. In-memory state is never changed before the write
succeeds.

Invariant: version == len(events). The first mutation of a case-less incident
writes a "created" event (version 1) and then the mutation's own event.
"""
import json
import logging
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from pydantic import ValidationError

from ..models.case import Case, CaseEvent, CaseEventType, CaseStatus, CaseSummary, Verdict

logger = logging.getLogger("csa_ops.cases")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class CaseConflict(Exception):
    """A mutation is invalid in the case's current state or the caller's
    expected_version is stale. The router answers 409 with the current case."""

    def __init__(self, message: str, case: Case):
        super().__init__(message)
        self.message = message
        self.case = case


class CaseStore:
    def __init__(self, path: str | Path, clock: Callable[[], str] = utc_now):
        self._path = Path(path)
        self._clock = clock
        self._lock = threading.Lock()

    @property
    def path(self) -> Path:
        return self._path

    # --- reads ---

    def get(self, incident_id: str) -> Case:
        """The stored case, or a virtual default. Never writes."""
        with self._lock:
            cases, _ = self._load()
        return cases.get(incident_id) or Case(incident_id=incident_id)

    def list_summaries(
        self, *, status: Optional[str] = None, assignee: Optional[str] = None, by_assignee: bool = False
    ) -> list[CaseSummary]:
        with self._lock:
            cases, _ = self._load()
        items = list(cases.values())
        if status:
            items = [c for c in items if c.status.value == status]
        if by_assignee:
            items = [c for c in items if c.assignee == assignee]
        items.sort(key=lambda c: c.updated_time or "", reverse=True)
        return [
            CaseSummary(
                incident_id=c.incident_id, status=c.status, assignee=c.assignee, verdict=c.verdict,
                updated_time=c.updated_time, resolved_time=c.resolved_time, version=c.version,
            )
            for c in items
        ]

    # --- mutations ---

    def update(
        self, incident_id: str, *, actor: str, status: Optional[CaseStatus] = None,
        assignee: Optional[str] = None, set_assignee: bool = False,
        expected_version: Optional[int] = None,
    ) -> Case:
        """Status (open or investigating only) and/or assignee. A change to the
        value already held appends nothing and does not bump the version."""
        with self._lock:
            cases, corrupt = self._load()
            case = self._current(cases, incident_id, expected_version)
            if status == CaseStatus.resolved:
                raise CaseConflict("Use the resolve endpoint to resolve a case.", case)
            if status is not None and case.status == CaseStatus.resolved and status != case.status:
                raise CaseConflict("This case is resolved. Reopen it before changing its status.", case)

            changes: list[tuple[CaseEventType, dict]] = []
            new_status, new_assignee = case.status, case.assignee
            if status is not None and status != case.status:
                changes.append((CaseEventType.status_changed, {"from": case.status.value, "to": status.value}))
                new_status = status
            if set_assignee and assignee != case.assignee:
                changes.append((CaseEventType.assignee_changed, {"from": case.assignee, "to": assignee}))
                new_assignee = assignee
            if not changes:
                return case

            updated = self._append(case, actor, changes)
            updated.status, updated.assignee = new_status, new_assignee
            return self._commit(cases, corrupt, updated)

    def add_note(self, incident_id: str, *, actor: str, text: str, expected_version: Optional[int] = None) -> Case:
        with self._lock:
            cases, corrupt = self._load()
            case = self._current(cases, incident_id, expected_version)
            updated = self._append(case, actor, [(CaseEventType.note_added, {"text": text})])
            return self._commit(cases, corrupt, updated)

    def resolve(
        self, incident_id: str, *, actor: str, verdict: Verdict, note: Optional[str] = None,
        expected_version: Optional[int] = None,
    ) -> Case:
        with self._lock:
            cases, corrupt = self._load()
            case = self._current(cases, incident_id, expected_version)
            if case.status == CaseStatus.resolved:
                raise CaseConflict("This case is already resolved.", case)
            updated = self._append(case, actor, [(CaseEventType.resolved, {"verdict": verdict.value, "note": note})])
            updated.status = CaseStatus.resolved
            updated.verdict = verdict
            updated.resolution_note = note
            updated.resolved_time = updated.updated_time
            return self._commit(cases, corrupt, updated)

    def reopen(self, incident_id: str, *, actor: str, expected_version: Optional[int] = None) -> Case:
        with self._lock:
            cases, corrupt = self._load()
            case = self._current(cases, incident_id, expected_version)
            if case.status != CaseStatus.resolved:
                raise CaseConflict("Only a resolved case can be reopened.", case)
            updated = self._append(case, actor, [(CaseEventType.reopened, {})])
            updated.status = CaseStatus.investigating
            updated.verdict = None
            updated.resolution_note = None
            updated.resolved_time = None
            return self._commit(cases, corrupt, updated)

    # --- internals ---

    def _current(self, cases: dict[str, Case], incident_id: str, expected_version: Optional[int]) -> Case:
        case = cases.get(incident_id) or Case(incident_id=incident_id)
        if expected_version is not None and expected_version != case.version:
            raise CaseConflict(
                f"Version mismatch: expected {expected_version}, current is {case.version}.", case
            )
        return case

    def _append(self, case: Case, actor: str, changes: list[tuple[CaseEventType, dict]]) -> Case:
        """A copy of the case with new events appended (and a created event
        first when the case did not exist yet). Version tracks event count."""
        updated = case.model_copy(deep=True)
        now = self._clock()
        pending = list(changes)
        if case.version == 0:
            pending.insert(0, (CaseEventType.created, {}))
        for event_type, data in pending:
            updated.events.append(
                CaseEvent(id=f"evt-{len(updated.events) + 1}", time=now, actor=actor, type=event_type, data=data)
            )
        updated.version = len(updated.events)
        updated.updated_time = now
        return updated

    def _commit(self, cases: dict[str, Case], corrupt: bool, updated: Case) -> Case:
        new_cases = {**cases, updated.incident_id: updated}
        self._write(new_cases, corrupt)
        return updated

    def _load(self) -> tuple[dict[str, Case], bool]:
        """(cases, file_was_corrupt). A missing file is empty; a corrupt one is
        empty with a warning, and is set aside before the next write."""
        if not self._path.exists():
            return {}, False
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raise ValueError("top level is not an object")
            return {key: Case(**value) for key, value in raw.items()}, False
        except (OSError, ValueError, TypeError, ValidationError) as exc:
            logger.warning("cases file %s is unreadable (%s); treating it as empty", self._path, exc)
            return {}, True

    def _write(self, cases: dict[str, Case], corrupt: bool) -> None:
        directory = self._path.parent
        directory.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({key: case.model_dump(mode="json") for key, case in cases.items()}, indent=2)
        fd, tmp_name = tempfile.mkstemp(prefix=self._path.name + ".", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            if corrupt and self._path.exists():
                backup = self._path.with_name(self._path.name + ".corrupt")
                os.replace(self._path, backup)
                logger.warning("moved unreadable cases file to %s", backup)
            os.replace(tmp_name, self._path)
        except BaseException:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise
