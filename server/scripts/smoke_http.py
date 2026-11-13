"""Launch an isolated real HTTP server and run one Nina → Jagoda → Nina exchange.

Uses a temporary SQLite file and credentials; it never exposes test tokens in logs.
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import bootstrap_database


def check(response: httpx.Response, expected: int = 200) -> dict:
    if response.status_code != expected:
        raise RuntimeError(
            f"{response.request.method} {response.request.url.path}: "
            f"HTTP {response.status_code}: {response.text[:350]}"
        )
    return response.json()


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="jnb-smoke-") as temp:
        path = Path(temp) / "smoke.sqlite3"
        provision = bootstrap_database(path)
        conversation_id = provision["conversation_id"]

        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]

        environment = dict(os.environ, JNB_DB_PATH=str(path))
        command = [
            sys.executable, "-m", "uvicorn", "app.main:app",
            "--host", "127.0.0.1", "--port", str(port), "--no-access-log",
        ]
        process = subprocess.Popen(
            command,
            cwd=root,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            base_url = f"http://127.0.0.1:{port}"
            with httpx.Client(base_url=base_url, timeout=3, trust_env=False) as anonymous:
                deadline = time.monotonic() + 12
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError("Uvicorn exited unexpectedly")
                    try:
                        check(anonymous.get("/v1/health"))
                        break
                    except (httpx.RequestError, RuntimeError):
                        time.sleep(0.15)
                else:
                    raise RuntimeError("Uvicorn failed to become healthy")

            with (
                httpx.Client(
                    base_url=base_url,
                    timeout=5,
                    trust_env=False,
                    headers={"Authorization": f"Bearer {provision['tokens']['nina']}"},
                ) as nina,
                httpx.Client(
                    base_url=base_url,
                    timeout=5,
                    trust_env=False,
                    headers={"Authorization": f"Bearer {provision['tokens']['jagoda']}"},
                ) as jagoda,
            ):
                uri = f"/v1/conversations/{conversation_id}"
                first = check(
                    nina.post(
                        uri + "/messages",
                        json={
                            "recipient_id": "jagoda",
                            "content": "Nina: Cześć Jagodo!",
                            "idempotency_key": "smoke-nina-1",
                        },
                    ),
                    expected=201,
                )
                first_id = first["id"]
                received = check(jagoda.get("/v1/inbox"))
                assert [item["id"] for item in received["messages"]] == [first_id]
                lease_j = check(jagoda.post(f"/v1/messages/{first_id}/claim"))
                check(
                    jagoda.post(
                        f"/v1/messages/{first_id}/dispatch-start",
                        json={"lease_token": lease_j["lease_token"]},
                    )
                )
                reply = check(
                    jagoda.post(
                        uri + "/messages",
                        json={
                            "recipient_id": "nina",
                            "content": "Jagoda: Cześć Nino!",
                            "reply_to_id": first_id,
                            "idempotency_key": "smoke-jagoda-1",
                        },
                    ),
                    expected=201,
                )
                check(
                    jagoda.post(
                        f"/v1/messages/{first_id}/ack",
                        json={"lease_token": lease_j["lease_token"]},
                    )
                )
                assert check(nina.get("/v1/inbox"))["messages"][0]["id"] == reply["id"]
                lease_n = check(nina.post(f"/v1/messages/{reply['id']}/claim"))
                check(
                    nina.post(
                        f"/v1/messages/{reply['id']}/ack",
                        json={"lease_token": lease_n["lease_token"]},
                    )
                )
                state = check(nina.get(uri))
                assert state["status"] == "stopped"
                assert state["message_count"] == state["completed_count"] == 2
                assert nina.get("/v1/inbox").json()["messages"] == []
                assert jagoda.get("/v1/inbox").json()["messages"] == []
                print(
                    "HTTP E2E PASS: Nina -> Jagoda -> Nina -> STOP; "
                    "2 messages, 2 ACKs; no pending inbox messages"
                )
                print(f"SERVER: http://127.0.0.1:{port} (temporary, terminated)")
                print(f"CONVERSATION: {conversation_id}")
        finally:
            process.terminate()
            try:
                process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate(timeout=5)


if __name__ == "__main__":
    main()
