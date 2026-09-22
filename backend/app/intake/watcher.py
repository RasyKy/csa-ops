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
        loop = asyncio.get_event_loop()
        while not self._stopped.is_set():
            # poll_once() is synchronous and its handlers can block on real
            # network calls (e.g. the AI triage handler's LLM request, up to
            # LLM_TIMEOUT_SECONDS). Running it in-line on the event loop would
            # freeze every other request (dashboard polling, health checks,
            # the agent's long-poll) for the duration -- so it runs in a
            # worker thread instead.
            await loop.run_in_executor(None, self.poll_once)
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
                # One handler's failure must not skip the next handler for
                # this incident, nor stop the batch, nor kill the watcher's
                # background task for every incident after this one.
                try:
                    handler(incident)
                except Exception:
                    logger.exception(
                        "handler %r raised for incident %s; continuing", handler, incident["incident_id"]
                    )
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
