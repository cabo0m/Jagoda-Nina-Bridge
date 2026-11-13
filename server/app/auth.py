"""Bearer token identity, isolated from message payload fields."""
from __future__ import annotations

import hmac
from pathlib import Path

from fastapi import Header, HTTPException, Request

from .db import connect, hash_token


def require_participant(
    request: Request, authorization: str | None = Header(default=None)
) -> str:
    if not authorization:
        raise unauthorized()
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer" or len(parts[1]) < 32:
        raise unauthorized()
    digest = hash_token(parts[1])
    path: Path = request.app.state.db_path
    with connect(path) as db:
        row = db.execute(
            "SELECT id, token_hash FROM participants WHERE token_hash = ? AND enabled = 1",
            (digest,),
        ).fetchone()
    if row is None or not hmac.compare_digest(row["token_hash"], digest):
        raise unauthorized()
    return str(row["id"])


def unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Invalid or missing credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
