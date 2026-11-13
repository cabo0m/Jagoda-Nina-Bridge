"""SQLite storage, initialization and one-time local participant provisioning."""
from __future__ import annotations

import hashlib
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "bridge.sqlite3"

SCHEMA = """
CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open', 'stopped')),
    max_messages INTEGER NOT NULL DEFAULT 2
        CHECK(max_messages = 2),
    created_at TEXT NOT NULL,
    stopped_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    reply_to_id TEXT UNIQUE REFERENCES messages(id),
    sender_id TEXT NOT NULL REFERENCES participants(id),
    recipient_id TEXT NOT NULL REFERENCES participants(id),
    content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 4000),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK(status IN ('queued','claimed','completed','needs_review','failed')),
    created_at TEXT NOT NULL,
    claimed_at TEXT,
    lease_expires_at TEXT,
    lease_token_hash TEXT,
    dispatch_started_at TEXT,
    completed_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    idempotency_key TEXT NOT NULL,
    CHECK(sender_id <> recipient_id),
    UNIQUE(conversation_id, sender_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_messages_inbox
    ON messages(recipient_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_lease
    ON messages(status, lease_expires_at);
"""


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@contextmanager
def connect(path: Path | str) -> Iterator[sqlite3.Connection]:
    db = sqlite3.connect(str(path), timeout=5, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=5000")
    try:
        yield db
    finally:
        db.close()


@contextmanager
def write_transaction(path: Path | str) -> Iterator[sqlite3.Connection]:
    with connect(path) as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            yield db
        except BaseException:
            db.rollback()
            raise
        else:
            db.commit()


def initialize_database(path: Path | str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as db:
        mode = db.execute("PRAGMA journal_mode=WAL").fetchone()[0]
        if mode.lower() != "wal":
            raise RuntimeError("SQLite WAL is required for the bridge")
        db.executescript(SCHEMA)


def bootstrap_database(path: Path | str) -> dict[str, object]:
    """Provision EXACTLY two participants and one conversation, returning secrets once.

    Re-running does not reset credentials or erase existing messages.
    """
    initialize_database(path)
    tokens = {name: secrets.token_urlsafe(32) for name in ("jagoda", "nina")}
    conversation_id = str(uuid.uuid4())
    with write_transaction(path) as db:
        counts = [
            db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            for table in ("participants", "conversations", "messages")
        ]
        if any(counts):
            raise RuntimeError("Database is already provisioned; refusing to rotate tokens")
        current = now_utc()
        db.executemany(
            "INSERT INTO participants(id,name,enabled,token_hash,created_at) "
            "VALUES(?,?,1,?,?)",
            [(name, name, hash_token(token), current) for name, token in tokens.items()],
        )
        db.execute(
            "INSERT INTO conversations(id,status,max_messages,created_at) "
            "VALUES(?,'open',2,?)",
            (conversation_id, current),
        )
    return {"conversation_id": conversation_id, "tokens": tokens}
