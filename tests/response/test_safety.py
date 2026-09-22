from engine.response.safety import KillSwitch, global_mode, resolve_mode


def test_default_is_dry_run():
    assert global_mode(response_live=False) == "dry_run"
    assert resolve_mode(response_live=False, response_live_hosts=[], host="WS01") == "dry_run"


def test_live_requires_both_flags():
    # RESPONSE_LIVE true but host missing from RESPONSE_LIVE_HOSTS -> still dry-run.
    assert resolve_mode(response_live=True, response_live_hosts=[], host="WS01") == "dry_run"
    assert resolve_mode(response_live=True, response_live_hosts=["WS02"], host="WS01") == "dry_run"

    # RESPONSE_LIVE false, host listed -> still dry-run.
    assert resolve_mode(response_live=False, response_live_hosts=["WS01"], host="WS01") == "dry_run"

    # Both present -> live.
    assert resolve_mode(response_live=True, response_live_hosts=["WS01"], host="WS01") == "live"


def test_kill_switch_present_forces_blocked(tmp_path):
    switch = KillSwitch(tmp_path / "killswitch")
    assert switch.is_set() is False

    switch.set()
    assert switch.is_set() is True

    switch.clear()
    assert switch.is_set() is False


def test_kill_switch_survives_object_recreation(tmp_path):
    path = tmp_path / "killswitch"
    KillSwitch(path).set()

    # A fresh KillSwitch instance over the same path must see it as set --
    # the state lives in the file, not in the object.
    assert KillSwitch(path).is_set() is True

    KillSwitch(path).clear()
    assert KillSwitch(path).is_set() is False
