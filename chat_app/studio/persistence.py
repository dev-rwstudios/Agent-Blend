"""Local chat history: a SQLite-backed Chainlit data layer.

Chainlit only shows the history sidebar (and resumes threads) for an
authenticated user, so this also provides the pieces for a login-free local
setup: a persisted JWT secret and a single implicit "local" user (see
header_auth_callback in app.py).
"""

from __future__ import annotations

import json
import os
import secrets
import sqlite3
from pathlib import Path
from typing import Any

from chainlit.data.sql_alchemy import SQLAlchemyDataLayer

DATA_DIR = Path(os.environ.get("AGENT_BLEND_DATA_DIR", Path(__file__).resolve().parent.parent / ".data"))
DB_PATH = DATA_DIR / "history.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    "id" TEXT PRIMARY KEY,
    "identifier" TEXT NOT NULL UNIQUE,
    "metadata" TEXT NOT NULL,
    "createdAt" TEXT
);
CREATE TABLE IF NOT EXISTS threads (
    "id" TEXT PRIMARY KEY,
    "createdAt" TEXT,
    "name" TEXT,
    "userId" TEXT,
    "userIdentifier" TEXT,
    "tags" TEXT,
    "metadata" TEXT,
    FOREIGN KEY ("userId") REFERENCES users("id") ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS steps (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "parentId" TEXT,
    "command" TEXT,
    "modes" TEXT,
    "streaming" BOOLEAN NOT NULL,
    "waitForAnswer" BOOLEAN,
    "isError" BOOLEAN,
    "metadata" TEXT,
    "tags" TEXT,
    "input" TEXT,
    "output" TEXT,
    "createdAt" TEXT,
    "start" TEXT,
    "end" TEXT,
    "generation" TEXT,
    "showInput" TEXT,
    "defaultOpen" BOOLEAN,
    "autoCollapse" BOOLEAN,
    "language" TEXT,
    "icon" TEXT,
    FOREIGN KEY ("threadId") REFERENCES threads("id") ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS elements (
    "id" TEXT PRIMARY KEY,
    "threadId" TEXT,
    "type" TEXT,
    "url" TEXT,
    "chainlitKey" TEXT,
    "name" TEXT NOT NULL,
    "display" TEXT,
    "objectKey" TEXT,
    "size" TEXT,
    "page" INTEGER,
    "language" TEXT,
    "forId" TEXT,
    "mime" TEXT,
    "props" TEXT,
    "autoPlay" BOOLEAN,
    "playerConfig" TEXT,
    FOREIGN KEY ("threadId") REFERENCES threads("id") ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS feedbacks (
    "id" TEXT PRIMARY KEY,
    "forId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "comment" TEXT,
    FOREIGN KEY ("threadId") REFERENCES threads("id") ON DELETE CASCADE
);
"""


def ensure_database() -> str:
    """Create the history DB and its tables if needed; returns the
    SQLAlchemy connection string."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript(_SCHEMA)
    return f"sqlite+aiosqlite:///{DB_PATH}"


def ensure_auth_secret() -> None:
    """Chainlit refuses to start with authentication enabled and no
    CHAINLIT_AUTH_SECRET. Generate one on first run and keep it on disk so
    sessions survive restarts."""
    if os.environ.get("CHAINLIT_AUTH_SECRET"):
        return
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    secret_file = DATA_DIR / "auth_secret"
    if not secret_file.exists():
        secret_file.write_text(secrets.token_urlsafe(48))
        secret_file.chmod(0o600)
    os.environ["CHAINLIT_AUTH_SECRET"] = secret_file.read_text().strip()


class SQLiteDataLayer(SQLAlchemyDataLayer):
    """SQLAlchemyDataLayer targets Postgres, which binds JSON natively.
    SQLite can't bind dicts or lists (a step's `modes`, `tags`, ...), so
    serialize those on the way in."""

    async def execute_sql(self, query: str, parameters: dict) -> Any:
        parameters = {
            k: json.dumps(v) if isinstance(v, (dict, list)) else v
            for k, v in parameters.items()
        }
        return await super().execute_sql(query=query, parameters=parameters)

    async def get_all_user_threads(self, user_id: str | None = None, thread_id: str | None = None):
        threads = await super().get_all_user_threads(user_id=user_id, thread_id=thread_id)
        if threads and thread_id is None:
            # A panel click (capture viewport, add an asset, ...) starts a
            # thread before any message is sent; don't list those as chats.
            threads = [t for t in threads if t.get("steps")]
        return threads
