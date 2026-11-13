"""One-time, local-only bootstrap. Do not log or commit emitted tokens."""
from __future__ import annotations

import argparse
import os
from pathlib import Path

from .db import DEFAULT_DB_PATH, bootstrap_database


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision Jagoda–Nina Bridge")
    parser.add_argument(
        "--db",
        type=Path,
        default=Path(os.environ.get("JNB_DB_PATH", str(DEFAULT_DB_PATH))),
    )
    args = parser.parse_args()
    result = bootstrap_database(args.db)
    print(f"Database: {args.db}")
    print(f"Conversation ID: {result['conversation_id']}")
    print("ONE-TIME CREDENTIALS. Store locally; never commit or share in logs.")
    for name, token in result["tokens"].items():
        print(f"{name.upper()} TOKEN: {token}")


if __name__ == "__main__":
    main()
