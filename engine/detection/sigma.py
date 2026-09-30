"""A small, self-contained Sigma rule matcher.

Supports the subset of the Sigma specification the CSA-OPS rules use, which is
also the subset most SigmaHQ Windows process rules use:

  * `logsource.category` (mapped to an event_type via taxonomy)
  * named selections, each a map of `field|modifier...: value(s)`
  * field modifiers: contains, startswith, endswith, re, all
  * a list value on a field means OR over the list (AND with the `all` modifier)
  * a selection means AND over its fields
  * `condition` expressions with: selection names, and, or, not, parentheses,
    and the aggregations `1 of ...`, `any of ...`, `all of ...` (with `them`
    or a `prefix*` pattern)

Every string comparison is case-insensitive, matching how real SIEM backends
compile Sigma. Anything outside this subset (counts, timeframes, correlation)
is intentionally not handled here -- correlation lives in engine/correlation.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

from .taxonomy import CATEGORY_TO_EVENT_TYPE, resolve_field


class SigmaError(ValueError):
    """Raised when a rule is malformed or uses an unsupported construct."""


@dataclass
class SigmaRule:
    rule_id: str
    title: str
    technique: str
    tactic: str
    level: str
    detection: dict
    category: Optional[str] = None
    description: str = ""
    tags: list[str] = field(default_factory=list)
    source_path: Optional[str] = None

    @property
    def event_type(self) -> Optional[str]:
        if self.category is None:
            return None
        return CATEGORY_TO_EVENT_TYPE.get(self.category, self.category)

    def matches(self, event: dict, *, ignore_filters: bool = False) -> bool:
        """True if `event` (a normalized event as a dict) satisfies this rule.

        ignore_filters forces every selection whose name starts with `filter`
        to evaluate False, which turns `selection and not filter` into plain
        `selection`. The FR21 report uses this to measure the "before tuning"
        false-positive count -- how noisy each rule would be without its
        tuning filters."""
        if self.event_type is not None and event.get("event_type") != self.event_type:
            return False
        selections = {k: v for k, v in self.detection.items() if k != "condition"}
        condition = self.detection.get("condition")
        if condition is None:
            raise SigmaError(f"{self.rule_id}: detection has no condition")
        evaluated = {}
        for name, spec in selections.items():
            if ignore_filters and name.startswith("filter"):
                evaluated[name] = False
            else:
                evaluated[name] = _match_selection(spec, event)
        return _eval_condition(str(condition), evaluated)


def build_rule(doc: dict, source_path: Optional[str] = None) -> SigmaRule:
    """Build a SigmaRule from a parsed YAML document.

    tactic/technique are read from the `tags` list (attack.<tactic> and
    attack.tNNNN) so a rule stays pure Sigma -- no CSA-OPS-specific keys."""
    try:
        detection = doc["detection"]
        logsource = doc.get("logsource", {})
    except KeyError as exc:
        raise SigmaError(f"rule missing required section: {exc}") from exc

    tags = [str(t) for t in doc.get("tags", [])]
    technique = _technique_from_tags(tags)
    tactic = _tactic_from_tags(tags)
    rule_id = doc.get("id") or doc.get("rule_id")
    if not rule_id:
        raise SigmaError("rule missing 'id'")

    return SigmaRule(
        rule_id=str(rule_id),
        title=doc.get("title", str(rule_id)),
        technique=technique,
        tactic=tactic,
        level=doc.get("level", "medium"),
        detection=detection,
        category=logsource.get("category"),
        description=doc.get("description", ""),
        tags=tags,
        source_path=source_path,
    )


# --- tag parsing -----------------------------------------------------------

# attack.t1059.001 -> T1059.001 ; the tactic tags are the named ATT&CK tactics.
_TACTIC_TAGS = {
    "attack.execution": "execution",
    "attack.persistence": "persistence",
    "attack.privilege_escalation": "privilege_escalation",
    "attack.defense_evasion": "defense_evasion",
    "attack.credential_access": "credential_access",
    "attack.discovery": "discovery",
    "attack.lateral_movement": "lateral_movement",
    "attack.collection": "collection",
    "attack.command_and_control": "command_and_control",
    "attack.exfiltration": "exfiltration",
    "attack.impact": "impact",
    "attack.initial_access": "initial_access",
    "attack.reconnaissance": "reconnaissance",
    "attack.resource_development": "resource_development",
}


def _technique_from_tags(tags: list[str]) -> str:
    for tag in tags:
        low = tag.lower()
        if low.startswith("attack.t") and _looks_like_technique(low[len("attack.") :]):
            return low[len("attack.") :].upper()
    raise SigmaError("rule tags carry no ATT&CK technique (expected e.g. attack.t1059.001)")


def _looks_like_technique(token: str) -> bool:
    return bool(re.fullmatch(r"t\d{4}(\.\d{3})?", token))


def _tactic_from_tags(tags: list[str]) -> str:
    for tag in tags:
        if tag.lower() in _TACTIC_TAGS:
            return _TACTIC_TAGS[tag.lower()]
    raise SigmaError("rule tags carry no ATT&CK tactic (expected e.g. attack.execution)")


# --- selection matching ----------------------------------------------------

def _match_selection(spec: Any, event: dict) -> bool:
    # A selection may be a single map (AND over fields) or a list of maps
    # (OR over the maps -- Sigma's list-of-dicts form).
    if isinstance(spec, list):
        return any(_match_selection(item, event) for item in spec)
    if not isinstance(spec, dict):
        raise SigmaError(f"selection must be a map or list of maps, got {type(spec).__name__}")
    return all(_match_field(key, value, event) for key, value in spec.items())


def _match_field(key: str, expected: Any, event: dict) -> bool:
    parts = key.split("|")
    sigma_field = parts[0]
    modifiers = parts[1:]
    attr = resolve_field(sigma_field)
    actual = event.get(attr)

    if expected is None:
        return actual is None

    expected_values = expected if isinstance(expected, list) else [expected]
    require_all = "all" in modifiers
    predicate_mods = [m for m in modifiers if m != "all"]

    results = (_match_value(actual, exp, predicate_mods) for exp in expected_values)
    return all(results) if require_all else any(results)


def _match_value(actual: Any, expected: Any, modifiers: list[str]) -> bool:
    if actual is None:
        return False

    if "re" in modifiers:
        return re.search(str(expected), str(actual), re.IGNORECASE) is not None

    # Numeric equality when both look numeric (e.g. DestinationPort: 445).
    if not modifiers and isinstance(expected, int) and isinstance(actual, int):
        return actual == expected

    a = str(actual).lower()
    e = str(expected).lower()

    if "contains" in modifiers:
        return e in a
    if "startswith" in modifiers:
        return a.startswith(e)
    if "endswith" in modifiers:
        return a.endswith(e)
    return a == e


# --- condition evaluation --------------------------------------------------

_TOKEN_RE = re.compile(r"\(|\)|\b(?:and|or|not)\b|[^\s()]+", re.IGNORECASE)


def _eval_condition(condition: str, evaluated: dict[str, bool]) -> bool:
    tokens = _tokenize_condition(condition, evaluated)
    parser = _ConditionParser(tokens)
    result = parser.parse_expression()
    if not parser.at_end():
        raise SigmaError(f"unparsed trailing tokens in condition: {condition!r}")
    return result


def _tokenize_condition(condition: str, evaluated: dict[str, bool]) -> list:
    """Turn a condition string into a token list, expanding `X of PATTERN`
    aggregations into their boolean value up front."""
    raw = _TOKEN_RE.findall(condition)
    tokens: list = []
    i = 0
    while i < len(raw):
        tok = raw[i]
        low = tok.lower()
        if low in ("and", "or", "not", "(", ")"):
            tokens.append(low)
            i += 1
        elif low in ("all", "any", "1") and i + 2 < len(raw) and raw[i + 1].lower() == "of":
            quantifier = low
            pattern = raw[i + 2]
            tokens.append(_aggregate(quantifier, pattern, evaluated))
            i += 3
        else:
            if tok not in evaluated:
                raise SigmaError(f"condition references unknown selection {tok!r}")
            tokens.append(bool(evaluated[tok]))
            i += 1
    return tokens


def _aggregate(quantifier: str, pattern: str, evaluated: dict[str, bool]) -> bool:
    if pattern.lower() == "them":
        selected = list(evaluated.values())
    elif pattern.endswith("*"):
        prefix = pattern[:-1]
        selected = [v for name, v in evaluated.items() if name.startswith(prefix)]
    else:
        selected = [evaluated.get(pattern, False)]

    if not selected:
        return False
    if quantifier in ("1", "any"):
        return any(selected)
    return all(selected)  # "all"


class _ConditionParser:
    """Recursive-descent parser over a pre-tokenized boolean expression.

    Grammar (precedence low->high): or_expr := and_expr (or and_expr)* ;
    and_expr := not_expr (and not_expr)* ; not_expr := 'not' not_expr | atom ;
    atom := '(' or_expr ')' | bool."""

    def __init__(self, tokens: list):
        self._tokens = tokens
        self._pos = 0

    def at_end(self) -> bool:
        return self._pos >= len(self._tokens)

    def _peek(self):
        return None if self.at_end() else self._tokens[self._pos]

    def _advance(self):
        tok = self._tokens[self._pos]
        self._pos += 1
        return tok

    def parse_expression(self) -> bool:
        return self._parse_or()

    def _parse_or(self) -> bool:
        value = self._parse_and()
        while self._peek() == "or":
            self._advance()
            value = self._parse_and() or value
        return value

    def _parse_and(self) -> bool:
        value = self._parse_not()
        while self._peek() == "and":
            self._advance()
            value = self._parse_not() and value
        return value

    def _parse_not(self) -> bool:
        if self._peek() == "not":
            self._advance()
            return not self._parse_not()
        return self._parse_atom()

    def _parse_atom(self) -> bool:
        tok = self._peek()
        if tok == "(":
            self._advance()
            value = self._parse_or()
            if self._peek() != ")":
                raise SigmaError("unbalanced parentheses in condition")
            self._advance()
            return value
        if isinstance(tok, bool):
            return self._advance()
        raise SigmaError(f"unexpected token in condition: {tok!r}")
