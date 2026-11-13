"""Regression tests: real API requests, isolated on-disk SQLite per test."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.db import bootstrap_database, connect
from app.main import create_app


@pytest.fixture()
def bridge(tmp_path):
    db_path = tmp_path / "bridge.sqlite3"
    setup = bootstrap_database(db_path)
    with TestClient(create_app(db_path)) as client:
        yield client, setup, db_path


def auth(setup, user):
    return {"Authorization": f"Bearer {setup['tokens'][user]}"}


def seed_initial(client, setup, *, key="nina-001"):
    cid = setup["conversation_id"]
    response = client.post(
        f"/v1/conversations/{cid}/messages",
        headers=auth(setup, "nina"),
        json={"recipient_id": "jagoda", "content": "Nino, tu Jagoda?", "idempotency_key": key},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_full_two_message_flow_and_auto_stop(bridge):
    client, setup, db = bridge
    cid = setup["conversation_id"]
    url = f"/v1/conversations/{cid}/messages"
    first_id = seed_initial(client, setup)
    assert len(client.get("/v1/inbox", headers=auth(setup, "jagoda")).json()["messages"]) == 1
    assert client.get("/v1/inbox", headers=auth(setup, "nina")).json()["messages"] == []

    repeated = client.post(
        url, headers=auth(setup, "nina"),
        json={"recipient_id": "jagoda", "content": "Nino, tu Jagoda?",
              "idempotency_key": "nina-001"},
    )
    assert repeated.status_code == 200
    assert repeated.json()["id"] == first_id
    assert repeated.json()["duplicate"] is True

    claimed = client.post(f"/v1/messages/{first_id}/claim", headers=auth(setup, "jagoda"))
    assert claimed.status_code == 200, claimed.text
    lease = claimed.json()["lease_token"]
    dispatch = client.post(
        f"/v1/messages/{first_id}/dispatch-start",
        headers=auth(setup, "jagoda"), json={"lease_token": lease},
    )
    assert dispatch.status_code == 200
    assert dispatch.json()["already_started"] is False
    repeated_dispatch = client.post(
        f"/v1/messages/{first_id}/dispatch-start",
        headers=auth(setup, "jagoda"), json={"lease_token": lease},
    )
    assert repeated_dispatch.json()["already_started"] is True

    reply = client.post(
        url, headers=auth(setup, "jagoda"),
        json={"recipient_id": "nina", "content": "Cześć Nino! Jagoda odpowiada.",
              "reply_to_id": first_id, "idempotency_key": "jagoda-001"},
    )
    assert reply.status_code == 201, reply.text
    reply_id = reply.json()["id"]
    assert client.post(
        f"/v1/messages/{first_id}/ack",
        headers=auth(setup, "jagoda"), json={"lease_token": lease}
    ).status_code == 200

    nina_inbox = client.get("/v1/inbox", headers=auth(setup, "nina")).json()["messages"]
    assert len(nina_inbox) == 1
    assert nina_inbox[0]["id"] == reply_id
    assert nina_inbox[0]["reply_to_id"] == first_id
    assert nina_inbox[0]["content"] == "Cześć Nino! Jagoda odpowiada."
    nina_claim = client.post(f"/v1/messages/{reply_id}/claim", headers=auth(setup, "nina"))
    assert nina_claim.status_code == 200
    ack = client.post(
        f"/v1/messages/{reply_id}/ack",
        headers=auth(setup, "nina"),
        json={"lease_token": nina_claim.json()["lease_token"]},
    )
    assert ack.status_code == 200, ack.text
    summary = client.get(f"/v1/conversations/{cid}", headers=auth(setup, "nina")).json()
    assert summary["status"] == "stopped"
    assert summary["message_count"] == 2
    assert summary["completed_count"] == 2
    assert client.get("/v1/inbox", headers=auth(setup, "nina")).json()["messages"] == []
    assert client.post(
        url, headers=auth(setup, "nina"),
        json={"recipient_id": "jagoda", "content": "Third message",
              "idempotency_key": "nina-002"}
    ).status_code == 409
    with connect(db) as sql:
        rows = sql.execute(
            "SELECT sender_id,recipient_id,status,reply_to_id FROM messages "
            "ORDER BY created_at, id"
        ).fetchall()
        assert len(rows) == 2
        assert {(x["sender_id"], x["recipient_id"]) for x in rows} == {
            ("nina", "jagoda"), ("jagoda", "nina")
        }
        assert all(x["status"] == "completed" for x in rows)


def test_authorization_isolation_and_payload_validation(bridge):
    client, setup, db = bridge
    cid = setup["conversation_id"]
    first_id = seed_initial(client, setup)
    assert client.get("/v1/inbox").status_code == 401
    assert client.get("/v1/inbox", headers={"Authorization": "Bearer invalid"}).status_code == 401
    assert client.post(
        f"/v1/messages/{first_id}/claim",
        headers=auth(setup, "nina")
    ).status_code == 404
    assert client.get("/v1/inbox", headers=auth(setup, "nina")).json()["messages"] == []
    assert client.post(
        f"/v1/conversations/{cid}/messages", headers=auth(setup, "jagoda"),
        json={"recipient_id": "nina", "content": "x", "idempotency_key": "r",
              "sender_id": "nina"},
    ).status_code == 422
    with connect(db) as sql:
        sql.execute("UPDATE participants SET enabled=0 WHERE id='nina'")
    assert client.get("/v1/inbox", headers=auth(setup, "nina")).status_code == 401


def test_idempotency_key_cannot_change_payload(bridge):
    client, setup, _ = bridge
    first_id = seed_initial(client, setup)
    cid = setup["conversation_id"]
    assert client.post(
        f"/v1/conversations/{cid}/messages", headers=auth(setup, "nina"),
        json={"recipient_id": "jagoda", "content": "DIFFERENT",
              "idempotency_key": "nina-001"}
    ).status_code == 409
    assert client.post(
        f"/v1/conversations/{cid}/messages", headers=auth(setup, "nina"),
        json={"recipient_id": "jagoda", "content": "Another message",
              "idempotency_key": "nina-002"}
    ).status_code == 409
    assert client.post(
        f"/v1/messages/{first_id}/claim", headers=auth(setup, "jagoda")
    ).status_code == 200


def test_expired_lease_can_be_reclaimed_only_before_dispatch(bridge):
    client, setup, db = bridge
    first_id = seed_initial(client, setup)
    headers = auth(setup, "jagoda")
    first = client.post(f"/v1/messages/{first_id}/claim", headers=headers).json()
    with connect(db) as sql:
        sql.execute(
            "UPDATE messages SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
            (first_id,),
        )
    second = client.post(f"/v1/messages/{first_id}/claim", headers=headers)
    assert second.status_code == 200, second.text
    assert first["lease_token"] != second.json()["lease_token"]
    assert client.post(
        f"/v1/messages/{first_id}/ack", headers=headers,
        json={"lease_token": first["lease_token"]}
    ).status_code == 409
    assert client.post(
        f"/v1/messages/{first_id}/ack", headers=headers,
        json={"lease_token": second.json()["lease_token"]}
    ).status_code == 200
    with connect(db) as sql:
        assert sql.execute(
            "SELECT attempts FROM messages WHERE id=?", (first_id,)
        ).fetchone()[0] == 2


def test_dispatch_uncertainty_is_never_replayed(bridge):
    client, setup, db = bridge
    first_id = seed_initial(client, setup)
    headers = auth(setup, "jagoda")
    lease = client.post(f"/v1/messages/{first_id}/claim", headers=headers).json()["lease_token"]
    assert client.post(
        f"/v1/messages/{first_id}/dispatch-start", headers=headers,
        json={"lease_token": lease},
    ).status_code == 200
    with connect(db) as sql:
        sql.execute(
            "UPDATE messages SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
            (first_id,),
        )
    retry = client.post(f"/v1/messages/{first_id}/claim", headers=headers)
    assert retry.status_code == 409
    with connect(db) as sql:
        row = sql.execute(
            "SELECT status,attempts FROM messages WHERE id=?", (first_id,)
        ).fetchone()
        assert row["status"] == "needs_review"
        assert row["attempts"] == 1


def test_manual_stop_blocks_new_work(bridge):
    client, setup, _ = bridge
    cid = setup["conversation_id"]
    first_id = seed_initial(client, setup)
    assert client.post(
        f"/v1/conversations/{cid}/stop",
        headers=auth(setup, "nina")
    ).json()["status"] == "stopped"
    assert client.post(
        f"/v1/conversations/{cid}/stop",
        headers=auth(setup, "jagoda")
    ).status_code == 200
    assert client.post(
        f"/v1/messages/{first_id}/claim",
        headers=auth(setup, "jagoda")
    ).status_code == 409
    assert client.post(
        f"/v1/conversations/{cid}/messages", headers=auth(setup, "jagoda"),
        json={"recipient_id": "nina", "content": "No",
              "reply_to_id": first_id, "idempotency_key": "jagoda-001"}
    ).status_code == 409


def test_two_parallel_claims_only_one_wins(bridge):
    client, setup, _ = bridge
    first_id = seed_initial(client, setup)
    headers = auth(setup, "jagoda")

    def claim_once():
        with TestClient(client.app) as contender:
            return contender.post(
                f"/v1/messages/{first_id}/claim", headers=headers
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        result = list(executor.map(lambda _: claim_once(), range(2)))
    assert sorted(result) == [200, 409]


def test_bootstrap_is_one_time_and_no_plain_tokens_in_db(bridge):
    _, setup, db = bridge
    with pytest.raises(RuntimeError, match="already provisioned"):
        bootstrap_database(db)
    with connect(db) as sql:
        assert sql.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert sql.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        hashes = {row[0] for row in sql.execute("SELECT token_hash FROM participants")}
        assert all(token not in hashes for token in setup["tokens"].values())
        assert len(hashes) == 2
        with pytest.raises(sqlite3.IntegrityError):
            sql.execute(
                "INSERT INTO messages("
                "id,conversation_id,sender_id,recipient_id,content,status,created_at,"
                "idempotency_key) VALUES('bad','missing','nina','jagoda','x','queued','now','bad')"
            )
