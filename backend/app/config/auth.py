"""Authentication cookie settings loaded without exposing secrets."""

from __future__ import annotations

import os
from dataclasses import dataclass


SESSION_COOKIE_NAME = "bess_session"


@dataclass(frozen=True)
class AuthSettings:
    cookie_secure: bool = False
    session_ttl_seconds: int = 7 * 24 * 60 * 60

    @classmethod
    def from_environment(cls) -> "AuthSettings":
        secure = os.getenv("AUTH_COOKIE_SECURE", "false").strip().lower() in {
            "1", "true", "yes", "on",
        }
        raw_ttl = os.getenv("AUTH_SESSION_TTL_SECONDS", "604800").strip()
        try:
            ttl = max(300, int(raw_ttl))
        except ValueError:
            ttl = 604800
        return cls(cookie_secure=secure, session_ttl_seconds=ttl)


auth_settings = AuthSettings.from_environment()
