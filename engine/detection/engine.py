"""DetectionEngine: evaluate a normalized event against all loaded Sigma
rules and the behavioural baseline, producing alert documents.

Alerts follow docs/interfaces.md 4.2 exactly (Person A writes, Person B
reads). First-time-activity flags (FR8) are returned alongside the alerts on
the result object rather than written into the alert document, because the 4.2
contract has no field for them; correlation uses them to adjust risk.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Optional

from .baseline import Baseline
from .rules import load_rules
from .sigma import SigmaRule

# Sigma level -> CSA-OPS severity enum (low|medium|high|critical).
_LEVEL_TO_SEVERITY = {
    "informational": "low",
    "low": "low",
    "medium": "medium",
    "high": "high",
    "critical": "critical",
}


@dataclass
class DetectionResult:
    alerts: list[dict] = field(default_factory=list)
    first_time_process: bool = False
    first_time_pair: bool = False

    @property
    def fired(self) -> bool:
        return bool(self.alerts)


class DetectionEngine:
    def __init__(self, rules: Optional[list[SigmaRule]] = None, baseline: Optional[Baseline] = None):
        self.rules = rules if rules is not None else load_rules()
        self.baseline = baseline if baseline is not None else Baseline()

    def evaluate(self, event: dict) -> DetectionResult:
        """Run every rule against one normalized event and update the baseline.

        The baseline is observed exactly once per event, whether or not a rule
        fires, so first-time-activity memory reflects all traffic, not just
        alerting traffic."""
        first_time = self.baseline.observe(event)
        alerts = [self._alert(rule, event) for rule in self.rules if rule.matches(event)]
        return DetectionResult(
            alerts=alerts,
            first_time_process=first_time["first_time_process"],
            first_time_pair=first_time["first_time_pair"],
        )

    def evaluate_stream(self, events) -> list[dict]:
        """Evaluate an ordered sequence of events, returning all alerts. Order
        matters: the baseline learns as it goes, so the first occurrence of a
        process is first-time and later ones are not."""
        alerts: list[dict] = []
        for event in events:
            alerts.extend(self.evaluate(event).alerts)
        return alerts

    def _alert(self, rule: SigmaRule, event: dict) -> dict:
        return {
            "alert_id": str(uuid.uuid4()),
            "timestamp": event.get("timestamp"),
            "rule_id": rule.rule_id,
            "rule_title": rule.title,
            "technique": rule.technique,
            "tactic": rule.tactic,
            "severity": _LEVEL_TO_SEVERITY.get(rule.level, "medium"),
            "host": event.get("host"),
            "user": event.get("user"),
            "event_id": event.get("event_id"),
            "pid": event.get("pid"),
            "ppid": event.get("parent_pid"),
            "image": event.get("process_name"),
            "command_line": event.get("command_line"),
        }
