import pytest

from scripts.generate_scenarios import generate

FIXED_ANCHOR = "2026-10-04T12:00:00.000Z"


@pytest.fixture(scope="session")
def generated(tmp_path_factory):
    return generate(FIXED_ANCHOR, tmp_path_factory.mktemp("scenarios"))
