"""One-shot loopback-only credential recovery for an explicitly installed Chrome extension.

Run manually on the same Windows host as Jagoda–Nina Bridge.
Does not modify the SQLite conversation or send ChatGPT prompts.
"""
from __future__ import annotations

import argparse
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ALLOWED_PATH = "/bootstrap"
LOOPBACK = "127.0.0.1"


def parse_env(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip()
    for key in ("JNB_JAGODA_TOKEN", "JNB_CONVERSATION_ID"):
        if not result.get(key):
            raise RuntimeError(f"Missing {key} in credentials file")
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", result["JNB_CONVERSATION_ID"]):
        raise RuntimeError("Invalid conversation UUID")
    return result


def create_server(
    *,
    credentials_file: Path,
    extension_id: str,
    port: int = 8766,
    expires_seconds: int = 900,
) -> HTTPServer:
    if not re.fullmatch(r"[a-p]{32}", extension_id):
        raise ValueError("Extension ID has unexpected format")
    if not 1 <= port <= 65535 or not 1 <= expires_seconds <= 3600:
        raise ValueError("Port or expiry out of range")
    # Validate before opening socket. Tokens never appear in argv or logs.
    parse_env(credentials_file)
    expected_origin = f"chrome-extension://{extension_id}"
    allowed_host = f"{LOOPBACK}:{port}"

    class Handler(BaseHTTPRequestHandler):
        server_version = "JagodaBridgeLocalSetup"
        sys_version = ""

        def log_message(self, fmt: str, *args: object) -> None:
            # Requests and credentials are intentionally not logged.
            pass

        def origin_allowed(self) -> bool:
            return (
                self.client_address[0] == LOOPBACK
                and self.headers.get("Host") == allowed_host
                and self.headers.get("Origin") == expected_origin
                and self.path == ALLOWED_PATH
            )

        def cors_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", expected_origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "X-JNB-Local-Setup")
            self.send_header("Vary", "Origin")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")

        def do_OPTIONS(self) -> None:
            if not self.origin_allowed():
                self.send_error(403)
                return
            self.send_response(204)
            self.cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_POST(self) -> None:
            if not self.origin_allowed() or self.headers.get("X-JNB-Local-Setup") != "1":
                self.send_error(403)
                return
            if getattr(self.server, "consumed", False):
                self.send_error(410)
                return
            try:
                data = parse_env(credentials_file)
                payload = json.dumps(
                    {
                        "serverUrl": "http://127.0.0.1:8765",
                        "participant": "jagoda",
                        "conversationId": data["JNB_CONVERSATION_ID"],
                        "token": data["JNB_JAGODA_TOKEN"],
                    },
                    separators=(",", ":"),
                ).encode("utf-8")
            except Exception:
                self.send_error(503)
                return
            # Server processes one request at a time. Mark before answering.
            self.server.consumed = True
            self.send_response(200)
            self.cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            self.wfile.flush()
            threading.Thread(target=self.server.shutdown, daemon=True).start()

    server = HTTPServer((LOOPBACK, port), Handler)
    server.timeout = 1
    server.consumed = False
    expiry = threading.Timer(expires_seconds, server.shutdown)
    expiry.daemon = True
    server.expiry_timer = expiry
    expiry.start()
    return server


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--credentials-file", required=True, type=Path)
    parser.add_argument("--extension-id", required=True)
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--expires-seconds", type=int, default=900)
    args = parser.parse_args()
    server = create_server(
        credentials_file=args.credentials_file,
        extension_id=args.extension_id,
        port=args.port,
        expires_seconds=args.expires_seconds,
    )
    try:
        print(f"READY loopback={LOOPBACK}:{args.port}; one-shot; no tokens printed", flush=True)
        server.serve_forever(poll_interval=0.2)
    finally:
        server.expiry_timer.cancel()
        server.server_close()


if __name__ == "__main__":
    main()
