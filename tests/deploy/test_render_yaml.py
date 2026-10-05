import yaml

from backend.app.config import REPO_ROOT


def test_render_yaml_structure_and_secrets():
    render_file = REPO_ROOT / "render.yaml"
    assert render_file.is_file(), "render.yaml must exist at repo root"

    raw_text = render_file.read_text(encoding="utf-8")
    data = yaml.safe_load(raw_text)

    assert "services" in data
    services = data["services"]
    assert len(services) >= 1

    web_service = next((s for s in services if s.get("type") == "web"), None)
    assert web_service is not None, "web service not found in render.yaml"

    assert web_service.get("plan") == "free"
    assert web_service.get("healthCheckPath") == "/healthz"
    start_cmd = web_service.get("startCommand", "")
    assert "$PORT" in start_cmd

    env_vars = web_service.get("envVars", [])
    keys = {e["key"]: e for e in env_vars}

    # Verify required keys
    assert "APP_ENV" in keys and keys["APP_ENV"].get("value") == "production"
    assert "STORE_BACKEND" in keys and keys["STORE_BACKEND"].get("value") == "fixtures"
    assert "FIXTURE_SET" in keys and keys["FIXTURE_SET"].get("value") == "realistic"
    assert "DEMO_BOOTSTRAP" in keys and str(keys["DEMO_BOOTSTRAP"].get("value")) == "1"
    assert "INTAKE_ENABLED" in keys and str(keys["INTAKE_ENABLED"].get("value")).lower() == "false"
    assert "PYTHON_VERSION" in keys

    # Verify sync: false variables have no value
    for item in env_vars:
        if item.get("sync") is False:
            assert "value" not in item, f"Secret variable {item['key']} with sync: false must not have a value"

    # Verify no string looks like a secret
    assert "sk-" not in raw_text
    assert "Bearer " not in raw_text
    assert "changeme" not in raw_text

