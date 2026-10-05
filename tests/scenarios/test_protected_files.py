"""The scenario generator must not touch anything it does not own."""
import shutil
import subprocess

import pytest

from scripts.generate_scenarios import REPO_ROOT, generate

PROTECTED = [
    "fixtures/incidents.json",
    "fixtures/alerts.json",
    "fixtures/normalized_events.sample.json",
    "fixtures/baseline_benign.sample.json",
    "fixtures/eval",
    "rules",
    "engine",
    "backend",
]


@pytest.mark.skipif(shutil.which("git") is None, reason="git is not available")
def test_git_reports_no_diff_on_protected_paths():
    result = subprocess.run(
        ["git", "diff", "--exit-code", "--stat", "--", *PROTECTED],
        cwd=REPO_ROOT, capture_output=True, text=True, stdin=subprocess.DEVNULL,
    )
    if result.returncode == 128:
        pytest.skip("not a git work tree")
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize("target", ["data", "rules", "engine", "backend", "dashboard", "fixtures", "fixtures/eval"])
def test_generator_refuses_protected_output_directories(target):
    with pytest.raises(ValueError):
        generate("2026-10-04T12:00:00.000Z", REPO_ROOT / target)


def test_generator_refuses_repo_root():
    with pytest.raises(ValueError):
        generate("2026-10-04T12:00:00.000Z", REPO_ROOT)
