"""FastAPI application entrypoint."""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from engine.ai_explain import triage as ai_triage
from engine.response import commander

from .config import Settings, get_settings
from .demo_bootstrap import bootstrap_demo
from .intake.watcher import IntakeWatcher
from .metrics import DashboardVisibilityTracker
from .routers import agent, ai, alerts, cases, health, incidents, metrics, response
from .store import build_store

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if settings.app_env == "production":
        raw_env_key = os.getenv("DASHBOARD_API_KEY")
        key = settings.dashboard_api_key
        if not raw_env_key and key == "changeme-dashboard-key":
            raise RuntimeError(
                "DASHBOARD_API_KEY must be set and at least 32 characters in production mode"
            )
        if not key or len(key) < 32:
            raise RuntimeError(
                "DASHBOARD_API_KEY must be set and at least 32 characters in production mode"
            )

    if settings.demo_bootstrap:
        bootstrap_demo(settings)

    store = build_store(settings)
    app.state.store = store
    app.state.visibility_tracker = DashboardVisibilityTracker()

    def _run_triage(incident: dict) -> None:
        store.save_triage(ai_triage.triage_incident(incident, store=store).model_dump())

    handlers = [
        lambda incident: commander.handle_incident(incident, store=store, settings=settings),
        _run_triage,
    ]
    watcher = IntakeWatcher(store=store, handlers=handlers, poll_seconds=settings.intake_poll_seconds)
    app.state.watcher = watcher
    if settings.intake_enabled:
        await watcher.start()

    yield

    if settings.intake_enabled:
        await watcher.stop()


def create_app(settings: Settings | None = None) -> FastAPI:
    if settings is None:
        settings = get_settings()

    is_production = settings.app_env == "production"
    docs_kwargs = {}
    if is_production:
        docs_kwargs = {
            "docs_url": None,
            "redoc_url": None,
            "openapi_url": None,
        }

    application = FastAPI(title="CSA-OPS Backend", lifespan=lifespan, **docs_kwargs)

    if not is_production:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=["http://localhost:3000"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    application.include_router(health.router)
    application.include_router(alerts.router)
    application.include_router(incidents.router)
    application.include_router(agent.router)
    application.include_router(response.router)
    application.include_router(ai.router)
    application.include_router(metrics.router)
    application.include_router(cases.router)
    return application


app = create_app()
