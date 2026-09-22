import logging

from .conftest import DASHBOARD_KEY

HEADERS = {"X-API-Key": DASHBOARD_KEY}


def test_first_get_incidents_logs_visibility_gap_per_incident(client, caplog):
    with caplog.at_level(logging.INFO, logger="csa_ops.metrics"):
        client.get("/incidents", headers=HEADERS)

    messages = [r.message for r in caplog.records if r.name == "csa_ops.metrics"]
    assert len(messages) == 5  # one per fixture incident
    for message in messages:
        assert "NFR-4 dashboard_visible_time" in message
        assert "gap=" in message


def test_second_call_does_not_relog_already_seen_incidents(client, caplog):
    client.get("/incidents", headers=HEADERS)

    with caplog.at_level(logging.INFO, logger="csa_ops.metrics"):
        client.get("/incidents", headers=HEADERS)

    messages = [r.message for r in caplog.records if r.name == "csa_ops.metrics"]
    assert messages == []


def test_visibility_gap_is_non_negative(client, caplog):
    with caplog.at_level(logging.INFO, logger="csa_ops.metrics"):
        client.get("/incidents", headers=HEADERS)

    messages = [r.message for r in caplog.records if r.name == "csa_ops.metrics"]
    for message in messages:
        gap = float(message.split("gap=")[1].rstrip("s"))
        assert gap >= 0
