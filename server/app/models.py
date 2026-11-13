"""Strict public request models for the MVP."""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SendMessage(StrictModel):
    recipient_id: Literal["jagoda", "nina"]
    content: str = Field(min_length=1, max_length=4000)
    reply_to_id: UUID | None = None
    idempotency_key: str = Field(min_length=1, max_length=128)


class LeaseProof(StrictModel):
    lease_token: str = Field(min_length=32, max_length=256)
