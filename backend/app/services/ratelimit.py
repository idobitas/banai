"""Small in-memory sliding-window rate limiter for paid endpoints (voice).

Per process only (fine for one Railway replica); memory is bounded by `max_keys`.
Behind a proxy, run uvicorn with --proxy-headers so the client IP is the customer's.
"""

from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable
from threading import Lock


class RateLimiter:
    def __init__(self, limit: int, window_s: float, *, max_keys: int = 10_000, clock: Callable[[], float] = time.monotonic) -> None:
        self.limit = limit
        self.window_s = window_s
        self.max_keys = max_keys
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        now = self._clock()
        with self._lock:
            hits = self._hits.get(key)
            if hits is None:
                if len(self._hits) >= self.max_keys:
                    self._evict(now)
                hits = self._hits[key] = deque()
            while hits and now - hits[0] >= self.window_s:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True

    def _evict(self, now: float) -> None:
        stale = [key for key, hits in self._hits.items() if not hits or now - hits[-1] >= self.window_s]
        for key in stale:
            del self._hits[key]
        if len(self._hits) >= self.max_keys:  # still full: drop the oldest half
            for key in list(self._hits)[: len(self._hits) // 2]:
                del self._hits[key]
