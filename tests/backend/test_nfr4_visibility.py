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
    # Both calls must run inside the same at_level block: caplog.records
    # accumulates for the whole test regardless of the `with` block's
    # extent, so the first call's 5 expected messages have to be
    # explicitly cleared rather than relied on to not be captured. Relying
    # on ambient root-logger state (e.g. whether something upstream already
    # called logging.basicConfig) to suppress the first call is what made
    # this test order-dependent: `backend/app/main.py`'s own
    # `logging.basicConfig(level=logging.INFO)` is a no-op whenever pytest's
    # own logging handlers already exist on the root logger, which only
    # happens when other test files are collected first.
    with caplog.at_level(logging.INFO, logger="csa_ops.metrics"):
        client.get("/incidents", headers=HEADERS)
        caplog.clear()
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
