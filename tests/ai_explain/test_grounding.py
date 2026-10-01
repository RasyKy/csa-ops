"""Pure unit tests for the grounding post-check -- no LLM call, synthetic
strings only."""
from engine.ai_explain import grounding


def test_extract_entities_finds_ip_pid_path_and_hostname():
    text = "Host WS01 (PID 4412) wrote to C:\\Users\\alice\\AppData\\Local\\Temp\\lsass.dmp and reached 203.0.113.7."
    entities = grounding.extract_entities(text)
    assert "203.0.113.7" in entities
    assert "4412" in entities
    assert "C:\\Users\\alice\\AppData\\Local\\Temp\\lsass.dmp" in entities
    assert "WS01" in entities


def test_extract_entities_does_not_treat_bare_numbers_as_pids():
    # "within about 2 seconds" or "port 445" must not be extracted as a PID
    # just because a number appears -- only a number explicitly labeled PID.
    text = "The activity spanned about 2 seconds and used port 445."
    assert grounding.extract_entities(text) == set()


def test_find_ungrounded_ignores_entities_present_in_source():
    source_text = '{"host": "WS01", "targets": {"remote_ips": ["203.0.113.7"]}}'
    explain_text = "Host WS01 contacted 203.0.113.7."
    assert grounding.find_ungrounded(explain_text, source_text) == []


def test_find_ungrounded_flags_entities_absent_from_source():
    source_text = '{"host": "WS01"}'
    explain_text = "Host WS01 also contacted 10.0.0.99, a host never mentioned in the input."
    flagged = grounding.find_ungrounded(explain_text, source_text)
    assert "10.0.0.99" in flagged
    assert "WS01" not in flagged


def test_find_ungrounded_returns_sorted_stable_output():
    source_text = "{}"
    explain_text = "Reached 10.0.0.2 then 10.0.0.1."
    assert grounding.find_ungrounded(explain_text, source_text) == ["10.0.0.1", "10.0.0.2"]
