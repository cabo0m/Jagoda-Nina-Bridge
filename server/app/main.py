"""Local REST mailbox for a single two-message Nina → Jagoda → Nina exchange."""
from __future__ import annotations

import hmac
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse

from .auth import require_participant
from .db import (
    DEFAULT_DB_PATH,
    connect,
    hash_token,
    initialize_database,
    now_utc,
    write_transaction,
)
from .models import LeaseProof, SendMessage

LEASE_SECONDS = 900


def problem(code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def get_conversation(db, conversation_id: str):
    row = db.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
    if row is None:
        raise problem(404, "Conversation not found")
    return row


def get_inbound_message(db, message_id: str, recipient: str):
    row = db.execute(
        "SELECT * FROM messages WHERE id = ? AND recipient_id = ?",
        (message_id, recipient),
    ).fetchone()
    if row is None:
        raise problem(404, "Message not found")
    return row


def check_lease(row, token: str, *, must_be_active: bool = True) -> None:
    stored = row["lease_token_hash"]
    if not stored or not hmac.compare_digest(stored, hash_token(token)):
        raise problem(409, "Lease token mismatch")
    if must_be_active and (not row["lease_expires_at"] or row["lease_expires_at"] <= now_utc()):
        raise problem(409, "Lease expired")


def create_app(db_path: Path | str | None = None) -> FastAPI:
    path = Path(db_path or os.environ.get("JNB_DB_PATH", str(DEFAULT_DB_PATH))).resolve()
    initialize_database(path)

    app = FastAPI(title="Jagoda–Nina Bridge", version="0.1.0")
    app.state.db_path = path

    @app.get("/v1/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.post("/v1/conversations/ensure-open")
    def ensure_open_conversation(who: str = Depends(require_participant)):
        """Exactly one open conversation. Only Jagoda may create a fresh one."""
        if who != "jagoda":
            raise problem(403, "Only Jagoda may start a fresh Bridge conversation")
        with write_transaction(path) as db:
            rows = db.execute(
                "SELECT id FROM conversations WHERE status='open' "
                "ORDER BY created_at LIMIT 2"
            ).fetchall()
            if len(rows) > 1:
                raise problem(409, "Multiple open conversations require operator review")
            if rows:
                return {"id": rows[0]["id"], "status": "open", "created": False}
            new_id = str(uuid.uuid4())
            db.execute(
                "INSERT INTO conversations(id,status,max_messages,created_at) "
                "VALUES(?,'open',2,?)",
                (new_id, now_utc()),
            )
        return {"id": new_id, "status": "open", "created": True}

    @app.get("/v1/current-conversation")
    def current_conversation(who: str = Depends(require_participant)):
        """Return the one open experiment, never create it via client request."""
        with connect(path) as db:
            rows = db.execute(
                "SELECT id FROM conversations WHERE status='open' "
                "ORDER BY created_at LIMIT 2"
            ).fetchall()
        if not rows:
            raise problem(404, "Brak otwartej rozmowy Bridge. Utwórz nową na hoście.")
        if len(rows) != 1:
            raise problem(409, "Więcej niż jedna otwarta rozmowa. Wymagana kontrola operatora.")
        return {"id": rows[0]["id"], "status": "open"}

    @app.get("/v1/conversations/{conversation_id}")
    def conversation(conversation_id: uuid.UUID, who: str = Depends(require_participant)):
        with connect(path) as db:
            item = get_conversation(db, str(conversation_id))
            total = db.execute(
                "SELECT count(*) AS all_messages, "
                "sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed "
                "FROM messages WHERE conversation_id = ?",
                (str(conversation_id),),
            ).fetchone()
            return {
                "id": item["id"],
                "status": item["status"],
                "max_messages": item["max_messages"],
                "message_count": total["all_messages"],
                "completed_count": total["completed"] or 0,
                "created_at": item["created_at"],
                "stopped_at": item["stopped_at"],
            }

    @app.get("/v1/inbox")
    def inbox(who: str = Depends(require_participant), limit: int = Query(default=50, ge=1, le=50)):
        with connect(path) as db:
            rows = db.execute(
                "SELECT id, conversation_id, reply_to_id, sender_id, recipient_id, "
                "content, status, created_at, claimed_at, lease_expires_at, attempts "
                "FROM messages WHERE recipient_id = ? "
                "AND status IN ('queued','claimed','needs_review') "
                "ORDER BY created_at, id LIMIT ?",
                (who, limit),
            ).fetchall()
            return {"messages": [dict(row) for row in rows]}

    @app.post("/v1/conversations/{conversation_id}/messages", status_code=201)
    def send_message(
        conversation_id: uuid.UUID,
        body: SendMessage,
        who: str = Depends(require_participant),
    ):
        content = body.content.strip()
        if not content:
            raise problem(422, "Message cannot be blank")
        cid = str(conversation_id)
        parent = str(body.reply_to_id) if body.reply_to_id is not None else None
        with write_transaction(path) as db:
            convo = get_conversation(db, cid)
            old = db.execute(
                "SELECT * FROM messages WHERE conversation_id=? AND sender_id=? "
                "AND idempotency_key=?",
                (cid, who, body.idempotency_key),
            ).fetchone()
            if old:
                if (
                    old["recipient_id"] != body.recipient_id
                    or old["content"] != content
                    or old["reply_to_id"] != parent
                ):
                    raise problem(409, "Idempotency key reused with different payload")
                return JSONResponse(
                    status_code=200,
                    content={"id": old["id"], "status": old["status"], "duplicate": True},
                )
            if convo["status"] != "open":
                raise problem(409, "Conversation stopped")
            count = db.execute(
                "SELECT count(*) FROM messages WHERE conversation_id=?", (cid,)
            ).fetchone()[0]
            if count == 0:
                if who != "nina" or body.recipient_id != "jagoda" or parent is not None:
                    raise problem(409, "First message must be Nina to Jagoda")
            elif count == 1:
                first = db.execute(
                    "SELECT * FROM messages WHERE conversation_id=?", (cid,)
                ).fetchone()
                if (
                    who != "jagoda"
                    or body.recipient_id != "nina"
                    or parent != first["id"]
                    or first["sender_id"] != "nina"
                    or first["status"] not in ("claimed", "completed")
                ):
                    raise problem(409, "Reply must reference the claimed Nina message")
            else:
                raise problem(409, "Maximum two messages per conversation")
            msg_id = str(uuid.uuid4())
            db.execute(
                "INSERT INTO messages("
                "id,conversation_id,reply_to_id,sender_id,recipient_id,content,"
                "status,created_at,idempotency_key) VALUES(?,?,?,?,?,?,'queued',?,?)",
                (msg_id, cid, parent, who, body.recipient_id, content,
                 now_utc(), body.idempotency_key),
            )
        return {"id": msg_id, "status": "queued", "duplicate": False}

    @app.post("/v1/messages/{message_id}/claim")
    def claim(message_id: uuid.UUID, who: str = Depends(require_participant)):
        needs_review = False
        claim_data = None
        with write_transaction(path) as db:
            msg = get_inbound_message(db, str(message_id), who)
            convo = get_conversation(db, msg["conversation_id"])
            if convo["status"] != "open":
                raise problem(409, "Conversation stopped")
            if msg["status"] == "claimed" and msg["lease_expires_at"] <= now_utc():
                if msg["dispatch_started_at"] is not None:
                    db.execute(
                        "UPDATE messages SET status='needs_review' WHERE id=?", (msg["id"],)
                    )
                    needs_review = True
            if not needs_review:
                if msg["status"] == "queued" or (
                    msg["status"] == "claimed"
                    and msg["lease_expires_at"] <= now_utc()
                    and msg["dispatch_started_at"] is None
                ):
                    lease_token = secrets.token_urlsafe(32)
                    expires_at = (
                        datetime.now(timezone.utc) + timedelta(seconds=LEASE_SECONDS)
                    ).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                    db.execute(
                        "UPDATE messages SET status='claimed', claimed_at=?, "
                        "lease_expires_at=?, lease_token_hash=?, attempts=attempts+1 "
                        "WHERE id=?",
                        (now_utc(), expires_at, hash_token(lease_token), msg["id"]),
                    )
                    claim_data = {
                        "id": msg["id"], "status": "claimed",
                        "lease_token": lease_token, "lease_expires_at": expires_at,
                    }
                else:
                    raise problem(409, "Message is not available for claim")
        if needs_review:
            raise problem(409, "Dispatch outcome uncertain; manual review required")
        return claim_data

    @app.post("/v1/messages/{message_id}/dispatch-start")
    def dispatch_start(
        message_id: uuid.UUID, body: LeaseProof, who: str = Depends(require_participant)
    ):
        with write_transaction(path) as db:
            msg = get_inbound_message(db, str(message_id), who)
            convo = get_conversation(db, msg["conversation_id"])
            if convo["status"] != "open" or msg["status"] != "claimed":
                raise problem(409, "Message is not actively claimed")
            check_lease(msg, body.lease_token)
            if msg["dispatch_started_at"]:
                return {"id": msg["id"], "already_started": True}
            db.execute(
                "UPDATE messages SET dispatch_started_at=? WHERE id=?",
                (now_utc(), msg["id"]),
            )
        return {"id": str(message_id), "already_started": False}

    @app.post("/v1/messages/{message_id}/ack")
    def acknowledge(
        message_id: uuid.UUID, body: LeaseProof, who: str = Depends(require_participant)
    ):
        with write_transaction(path) as db:
            msg = get_inbound_message(db, str(message_id), who)
            if msg["status"] == "completed":
                check_lease(msg, body.lease_token, must_be_active=False)
                return {"id": msg["id"], "status": "completed", "duplicate": True}
            if msg["status"] != "claimed":
                raise problem(409, "Message is not claimed")
            check_lease(msg, body.lease_token)
            db.execute(
                "UPDATE messages SET status='completed', completed_at=? WHERE id=?",
                (now_utc(), msg["id"]),
            )
            completed = db.execute(
                "SELECT count(*) FROM messages WHERE conversation_id=? "
                "AND status='completed'",
                (msg["conversation_id"],),
            ).fetchone()[0]
            if completed == 2:
                db.execute(
                    "UPDATE conversations SET status='stopped', stopped_at=? "
                    "WHERE id=? AND status='open'",
                    (now_utc(), msg["conversation_id"]),
                )
        return {"id": str(message_id), "status": "completed", "duplicate": False}

    @app.post("/v1/conversations/{conversation_id}/stop")
    def stop(conversation_id: uuid.UUID, who: str = Depends(require_participant)):
        with write_transaction(path) as db:
            convo = get_conversation(db, str(conversation_id))
            if convo["status"] == "open":
                db.execute(
                    "UPDATE conversations SET status='stopped', stopped_at=? WHERE id=?",
                    (now_utc(), str(conversation_id)),
                )
        return {"id": str(conversation_id), "status": "stopped"}

    return app


app = create_app()
