"""Poll loop: watermark, processed-set, dispatches new incidents to registered handlers.

Response and triage handlers register themselves in Phase 3 / Phase 5 via
IntakeWatcher.handlers.append(...). Empty for now.
"""
import asyncio
import logging

logger = logging.getLogger("csa_ops.intake")


class IntakeWatcher:
    def __init__(self, store, handlers: list, poll_seconds: int = 2):
        self.store = store
        self.handlers = handlers
        self._poll_seconds = poll_seconds
        self._task: asyncio.Task | None = None
        self._stopped = asyncio.Event()

    async def start(self) -> None:
        self._stopped.clear()
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stopped.set()
        if self._task is not None:
            await self._task
            self._task = None

    async def _run(self) -> None:
        while not self._stopped.is_set():
            self.poll_once()
            try:
                await asyncio.wait_for(self._stopped.wait(), timeout=self._poll_seconds)
            except asyncio.TimeoutError:
                pass

    def poll_once(self) -> list[dict]:
        """Synchronous so it's trivially unit-testable without an event loop."""
        state = self.store.get_intake_state()
        watermark = state.get("watermark")
        processed = set(state.get("processed_ids", []))

        candidates = self.store.list_incidents(since=watermark, limit=10_000, order="asc")
        new_incidents = [i for i in candidates if i["incident_id"] not in processed]

        for incident in new_incidents:
            for handler in self.handlers:
                handler(incident)
            processed.add(incident["incident_id"])
            raised_time = incident["incident_raised_time"]
            if watermark is None or raised_time > watermark:
                watermark = raised_time

        if new_incidents:
            self.store.save_intake_state({"watermark": watermark, "processed_ids": sorted(processed)})
            logger.info("intake watcher processed %d new incident(s)", len(new_incidents))
        else:
            logger.info("intake watcher: no new incidents")

        return new_incidents
