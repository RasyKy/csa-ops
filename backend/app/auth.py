"""X-API-Key auth dependencies. 401 on missing key, 403 on wrong key."""
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyHeader

from .config import get_settings

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def require_dashboard_key(api_key: Optional[str] = Depends(_api_key_header)) -> str:
    return _check(api_key, get_settings().dashboard_api_key)


def require_agent_key(api_key: Optional[str] = Depends(_api_key_header)) -> str:
    return _check(api_key, get_settings().agent_api_key)


def _check(api_key: Optional[str], expected: str) -> str:
    if api_key is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Missing X-API-Key")
    if api_key != expected:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Invalid X-API-Key")
    return api_key
