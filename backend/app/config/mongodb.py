"""MongoDB configuration and connection lifecycle without credential exposure."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock
from typing import TYPE_CHECKING

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import PyMongoError

if TYPE_CHECKING:
    from app.services.workspace_persistence_service import MongoWorkspaceRepository


BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_NAME = "bess_optimization"
DEFAULT_CONNECTION_TIMEOUT_MS = 20_000


logger = logging.getLogger(__name__)


def _connection_timeout_ms(value: str | None) -> int:
    if value is None:
        return DEFAULT_CONNECTION_TIMEOUT_MS
    try:
        timeout_ms = int(value)
    except ValueError:
        return DEFAULT_CONNECTION_TIMEOUT_MS
    return timeout_ms if timeout_ms > 0 else DEFAULT_CONNECTION_TIMEOUT_MS


class PersistenceUnavailableError(RuntimeError):
    """Raised when persistence cannot currently serve a request."""

    def __init__(self) -> None:
        super().__init__("Workspace persistence is temporarily unavailable.")


@dataclass(frozen=True)
class MongoSettings:
    uri: str | None = field(repr=False)
    database_name: str = DEFAULT_DATABASE_NAME
    connection_timeout_ms: int = DEFAULT_CONNECTION_TIMEOUT_MS

    @classmethod
    def from_environment(cls, env_path: Path = BACKEND_DIR / ".env") -> "MongoSettings":
        load_dotenv(dotenv_path=env_path, override=False)
        uri = os.getenv("MONGODB_URI")
        database_name = os.getenv("MONGODB_DATABASE", DEFAULT_DATABASE_NAME).strip()
        connection_timeout_ms = _connection_timeout_ms(os.getenv("MONGODB_TIMEOUT_MS"))
        return cls(
            uri=uri.strip() if uri and uri.strip() else None,
            database_name=database_name or DEFAULT_DATABASE_NAME,
            connection_timeout_ms=connection_timeout_ms,
        )


class MongoPersistence:
    """Own the process-wide Mongo client and expose a connected repository."""

    def __init__(self, settings: MongoSettings | None = None) -> None:
        self.settings = settings or MongoSettings.from_environment()
        self._client: MongoClient[dict[str, object]] | None = None
        self._repository: MongoWorkspaceRepository | None = None
        self._lock = RLock()
        self.available = False

    def connect(self) -> bool:
        from app.services.workspace_persistence_service import MongoWorkspaceRepository

        with self._lock:
            if self.available and self._repository is not None:
                return True
            if not self.settings.uri:
                self.available = False
                return False

            client: MongoClient[dict[str, object]] | None = None
            try:
                client = MongoClient(
                    self.settings.uri,
                    appname="bess-web",
                    serverSelectionTimeoutMS=self.settings.connection_timeout_ms,
                    connectTimeoutMS=self.settings.connection_timeout_ms,
                )
                client.admin.command("ping")
                repository = MongoWorkspaceRepository(
                    client[self.settings.database_name]
                )
                repository.ensure_indexes()
            except PyMongoError as exc:
                logger.warning("MongoDB persistence connection failed: %s", exc)
                if client is not None:
                    client.close()
                self._client = None
                self._repository = None
                self.available = False
                return False

            self._client = client
            self._repository = repository
            self.available = True
            return True

    def repository(self) -> "MongoWorkspaceRepository":
        with self._lock:
            if not self.available or self._repository is None:
                if not self.connect():
                    raise PersistenceUnavailableError()
            assert self._repository is not None
            return self._repository

    def close(self) -> None:
        with self._lock:
            if self._client is not None:
                self._client.close()
            self._client = None
            self._repository = None
            self.available = False


mongo_persistence = MongoPersistence()
