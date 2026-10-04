import json
from pathlib import Path

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


def test_source_text_built_like_explain_py():
    incident = {
        "incident_id": "inc-0001",
        "host": "WS01",
        "targets": {
            "pids": [1234],
            "remote_ips": ["192.168.1.50"],
            "file_paths": [r"C:\Windows\Temp\payload.exe"],
        },
    }
    triage = {"incident_id": "inc-0001", "verdict": "true_positive"}
    response_actions = [{"action": "kill_process", "target": {"pids": [1234]}}]
    source_text = json.dumps(incident) + json.dumps(triage) + json.dumps(response_actions)
    explain_text = "Host WS01 executed C:\\Windows\\Temp\\payload.exe (PID 1234) connecting to 192.168.1.50."
    assert grounding.find_ungrounded(explain_text, source_text) == []


def test_path_with_trailing_punctuation_not_flagged():
    incident = {
        "targets": {
            "file_paths": [r"C:\Users\alice\AppData\Local\Temp\lsass.dmp"],
        },
    }
    source_text = json.dumps(incident)
    # Test trailing period, comma, and closing paren
    explain_text = (
        "Memory dumped to C:\\Users\\alice\\AppData\\Local\\Temp\\lsass.dmp. "
        "Also saw C:\\Users\\alice\\AppData\\Local\\Temp\\lsass.dmp, "
        "and (in C:\\Users\\alice\\AppData\\Local\\Temp\\lsass.dmp)"
    )
    assert grounding.find_ungrounded(explain_text, source_text) == []


def test_same_path_twice_extracted_once_and_not_flagged():
    incident = {
        "targets": {
            "file_paths": [r"C:\Users\alice\AppData\Local\Temp\lsass.dmp"],
        },
    }
    source_text = json.dumps(incident)
    explain_text = (
        "Memory dumped to C:\\Users\\alice\\AppData\\Local\\Temp\\lsass.dmp. "
        "File C:\\Users\\alice\\AppData\\Local\\Temp\\lsass.dmp was preserved."
    )
    entities = grounding.extract_entities(explain_text)
    assert entities == {r"C:\Users\alice\AppData\Local\Temp\lsass.dmp"}
    assert grounding.find_ungrounded(explain_text, source_text) == []


def test_windows_path_case_insensitivity():
    incident = {"targets": {"file_paths": [r"C:\TEMP\lsass.dmp"]}}
    source_text = json.dumps(incident)
    explain_text = r"Memory dumped to c:\temp\lsass.dmp."
    assert grounding.find_ungrounded(explain_text, source_text) == []


def test_unc_path_round_trip():
    incident = {"targets": {"file_paths": [r"\\server\share\file.txt"]}}
    source_text = json.dumps(incident)
    explain_text = r"Accessed \\server\share\file.txt."
    entities = grounding.extract_entities(explain_text)
    assert r"\\server\share\file.txt" in entities
    assert grounding.find_ungrounded(explain_text, source_text) == []


def test_real_ungrounded_path_flagged_once():
    incident = {"targets": {"file_paths": [r"C:\Users\alice\AppData\Local\Temp\lsass.dmp"]}}
    source_text = json.dumps(incident)
    explain_text = (
        r"Checked C:\Users\alice\Desktop\other.txt. "
        r"Also inspected C:\Users\alice\Desktop\other.txt"
    )
    flagged = grounding.find_ungrounded(explain_text, source_text)
    assert flagged == [r"C:\Users\alice\Desktop\other.txt"]


def test_real_ungrounded_and_grounded_ip_pid_hostname():
    incident = {
        "host": "WS01",
        "targets": {
            "pids": [4412],
            "remote_ips": ["203.0.113.7"],
        },
    }
    source_text = json.dumps(incident)
    # Grounded: none flagged
    grounded_explain = "Host WS01 ran PID 4412 connecting to 203.0.113.7."
    assert grounding.find_ungrounded(grounded_explain, source_text) == []

    # Ungrounded: each flagged
    ungrounded_explain = "Host SRV02 ran PID 9999 connecting to 198.51.100.1."
    flagged = grounding.find_ungrounded(ungrounded_explain, source_text)
    assert flagged == ["198.51.100.1", "9999", "SRV02"]


def test_real_inc_0003_explain_vs_source():
    repo_root = Path(__file__).resolve().parents[2]
    incidents = json.loads((repo_root / "fixtures/incidents.json").read_text(encoding="utf-8"))
    inc3 = next(i for i in incidents if i["incident_id"] == "inc-0003")
    triages = json.loads((repo_root / "data/incident_triage.json").read_text(encoding="utf-8"))
    triage3 = triages["inc-0003"]
    triage3_no_explain = {k: v for k, v in triage3.items() if k != "explain"}
    actions_raw = json.loads((repo_root / "data/response_actions.json").read_text(encoding="utf-8"))
    actions3 = [a for a in actions_raw if a.get("incident_id") == "inc-0003"]

    source_text = json.dumps(inc3) + json.dumps(triage3_no_explain) + json.dumps(actions3)
    explain = triage3["explain"]
    explain_text = "\n".join([
        explain["summary"],
        explain["objective"],
        *explain["notable_details"],
        *explain["next_steps"],
        *explain["caveats"],
    ])

    after = grounding.find_ungrounded(explain_text, source_text)
    assert after == []


def test_c2_security_term_yields_no_entities():
    # "C2" is a 2-character token and must be filtered by the minimum-length
    # guard before even reaching the security-terms check.
    entities = grounding.extract_entities("exfiltration or C2 contact")
    assert "C2" not in entities
    assert entities == set()


def test_ungrounded_real_hostnames_flagged_grounded_ones_not():
    incident = {"host": "WS01", "targets": {"pids": [4412]}}
    triage = {"incident_id": "inc-0003", "verdict": "true_positive"}
    actions = [{"action": "kill_process", "target": {"pids": [4412]}}]
    source_text = json.dumps(incident) + json.dumps(triage) + json.dumps(actions)

    # WS01 is in the source; WS99, SRV-042, DC01 are not.
    explain_text = (
        "Host WS01 communicated with WS99. "
        "Lateral movement was observed via SRV-042 and DC01."
    )
    flagged = grounding.find_ungrounded(explain_text, source_text)
    assert "WS01" not in flagged
    assert "WS99" in flagged
    assert "SRV-042" in flagged
    assert "DC01" in flagged
    # Each must appear exactly once.
    assert flagged.count("WS99") == 1
    assert flagged.count("SRV-042") == 1
    assert flagged.count("DC01") == 1


def test_security_abbreviations_sha256_tls12_not_flagged():
    # SHA256 and TLS12 match _HOSTNAME_RE (uppercase-led, contain a digit, >=4
    # chars) but must be filtered by _SECURITY_TERMS and never appear in
    # ungrounded output regardless of source content.
    source_text = "{}"
    explain_text = (
        "The payload was hashed with SHA256 and the channel used TLS12."
    )
    flagged = grounding.find_ungrounded(explain_text, source_text)
    assert "SHA256" not in flagged
    assert "TLS12" not in flagged
    assert flagged == []
