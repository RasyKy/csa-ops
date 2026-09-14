"""FastAPI application entrypoint."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from engine.response import commander

from .config import get_settings
from .intake.watcher import IntakeWatcher
from .metrics import DashboardVisibilityTracker
from .routers import agent, alerts, health, incidents, response
from .store import build_store

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    store = build_store(settings)
    app.state.store = store
    app.state.visibility_tracker = DashboardVisibilityTracker()

    handlers = [lambda incident: commander.handle_incident(incident, store=store, settings=settings)]
    watcher = IntakeWatcher(store=store, handlers=handlers, poll_seconds=settings.intake_poll_seconds)
    app.state.watcher = watcher
    if settings.intake_enabled:
        await watcher.start()

    yield

    if settings.intake_enabled:
        await watcher.stop()


app = FastAPI(title="CSA-OPS Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(alerts.router)
app.include_router(incidents.router)
app.include_router(agent.router)
app.include_router(response.router)
