"""Mongo-backed users, server sessions, and owned projects."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping
from uuid import UUID, uuid4

import bcrypt
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError


class DuplicateEmailError(ValueError):
    pass


class InvalidCredentialsError(ValueError):
    pass


class AuthenticationRequiredError(PermissionError):
    pass


class InactiveUserError(PermissionError):
    pass


class ProjectNotFoundError(LookupError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: object) -> datetime | None:
    """Normalize PyMongo's default naive UTC datetimes for safe comparison."""
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _password_bytes(password: str) -> bytes:
    encoded = password.encode("utf-8")
    if len(encoded) > 72:
        raise ValueError("Password must be no more than 72 UTF-8 bytes.")
    return encoded


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_password_bytes(password), bcrypt.gensalt(rounds=12)).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_password_bytes(password), password_hash.encode("ascii"))
    except (ValueError, TypeError):
        return False


def public_user(user: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "display_name": user["display_name"],
        "role": user["role"],
        "is_active": user["is_active"],
        "created_at": user["created_at"],
        "updated_at": user["updated_at"],
        "last_login_at": user.get("last_login_at"),
    }


def public_project(project: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "project_id": project["project_id"],
        "owner_user_id": project["owner_user_id"],
        "name": project["name"],
        "description": project.get("description"),
        "status": project["status"],
        "created_at": project["created_at"],
        "updated_at": project["updated_at"],
        "last_opened_at": project.get("last_opened_at"),
        "active_dataset_id": project.get("active_dataset_id"),
        "schema_version": project["schema_version"],
    }


class MongoAuthProjectRepository:
    def __init__(self, database: Any) -> None:
        self.database = database
        self.users = database["users"]
        self.sessions = database["auth_sessions"]
        self.projects = database["projects"]

    def ensure_indexes(self) -> None:
        self.users.create_index("user_id", unique=True)
        self.users.create_index("email", unique=True)
        self.sessions.create_index("session_id", unique=True)
        self.sessions.create_index("token_hash", unique=True)
        self.sessions.create_index("expires_at", expireAfterSeconds=0)
        self.projects.create_index("project_id", unique=True)
        self.projects.create_index(
            [("owner_user_id", ASCENDING), ("updated_at", DESCENDING)]
        )

    def register_user(self, email: str, display_name: str, password: str) -> dict[str, Any]:
        now = _now()
        document = {
            "user_id": str(uuid4()),
            "email": email.strip().lower(),
            "password_hash": hash_password(password),
            "display_name": display_name.strip(),
            "role": "user",
            "is_active": True,
            "created_at": now,
            "updated_at": now,
            "last_login_at": None,
        }
        try:
            self.users.insert_one(document)
        except DuplicateKeyError as exc:
            raise DuplicateEmailError("An account already exists for this email.") from exc
        return public_user(document)

    def login(self, email: str, password: str, session_ttl_seconds: int) -> tuple[dict[str, Any], str]:
        user = self.users.find_one({"email": email.strip().lower()})
        stored_hash = user.get("password_hash") if isinstance(user, Mapping) else None
        if not isinstance(stored_hash, str) or not verify_password(password, stored_hash):
            raise InvalidCredentialsError("Email or password is incorrect.")
        if not bool(user.get("is_active")):
            raise InactiveUserError("This account is inactive.")

        now = _now()
        raw_token = secrets.token_urlsafe(32)
        session = {
            "session_id": str(uuid4()),
            "user_id": user["user_id"],
            "token_hash": _token_hash(raw_token),
            "created_at": now,
            "expires_at": now + timedelta(seconds=session_ttl_seconds),
            "last_seen_at": now,
            "revoked_at": None,
        }
        self.sessions.insert_one(session)
        self.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"last_login_at": now, "updated_at": now}},
        )
        user = {**dict(user), "last_login_at": now, "updated_at": now}
        return public_user(user), raw_token

    def authenticate_session(self, raw_token: str | None) -> dict[str, Any]:
        if not raw_token:
            raise AuthenticationRequiredError("Authentication is required.")
        session = self.sessions.find_one({"token_hash": _token_hash(raw_token)})
        if not isinstance(session, Mapping):
            raise AuthenticationRequiredError("The login session is invalid.")
        now = _now()
        expires_at = _as_utc(session.get("expires_at"))
        if session.get("revoked_at") is not None or expires_at is None or expires_at <= now:
            raise AuthenticationRequiredError("The login session has expired.")
        user = self.users.find_one({"user_id": session.get("user_id")})
        if not isinstance(user, Mapping):
            raise AuthenticationRequiredError("The login session is invalid.")
        if not bool(user.get("is_active")):
            raise InactiveUserError("This account is inactive.")
        self.sessions.update_one(
            {"session_id": session["session_id"]},
            {"$set": {"last_seen_at": now}},
        )
        return public_user(user)

    def revoke_session(self, raw_token: str | None) -> None:
        if not raw_token:
            return
        self.sessions.update_one(
            {"token_hash": _token_hash(raw_token), "revoked_at": None},
            {"$set": {"revoked_at": _now()}},
        )

    def create_project(self, owner_user_id: str, name: str, description: str | None) -> dict[str, Any]:
        now = _now()
        document = {
            "project_id": str(uuid4()),
            "owner_user_id": str(owner_user_id),
            "name": name.strip(),
            "description": description.strip() if description else None,
            "status": "active",
            "created_at": now,
            "updated_at": now,
            "last_opened_at": None,
            "active_dataset_id": None,
            "schema_version": 1,
        }
        self.projects.insert_one(document)
        return public_project(document)

    def list_projects(self, owner_user_id: str, *, include_archived: bool = False) -> list[dict[str, Any]]:
        cursor = self.projects.find({"owner_user_id": str(owner_user_id)})
        return [
            public_project(project)
            for project in cursor.sort("updated_at", DESCENDING)
            if include_archived or project.get("status") != "archived"
        ]

    def get_project(self, project_id: UUID, owner_user_id: str, *, touch: bool = True) -> dict[str, Any]:
        query = {"project_id": str(project_id), "owner_user_id": str(owner_user_id)}
        project = self.projects.find_one(query)
        if not isinstance(project, Mapping):
            raise ProjectNotFoundError("Project was not found.")
        if touch:
            now = _now()
            self.projects.update_one(query, {"$set": {"last_opened_at": now}})
            project = {**dict(project), "last_opened_at": now}
        return public_project(project)

    def update_project(
        self,
        project_id: UUID,
        owner_user_id: str,
        values: Mapping[str, Any],
    ) -> dict[str, Any]:
        query = {"project_id": str(project_id), "owner_user_id": str(owner_user_id)}
        if not isinstance(self.projects.find_one(query), Mapping):
            raise ProjectNotFoundError("Project was not found.")
        updates = {key: value for key, value in values.items() if value is not None}
        if "name" in updates:
            updates["name"] = str(updates["name"]).strip()
        if "description" in values:
            description = values.get("description")
            updates["description"] = str(description).strip() if description else None
        updates["updated_at"] = _now()
        self.projects.update_one(query, {"$set": updates})
        project = self.projects.find_one(query)
        if not isinstance(project, Mapping):
            raise ProjectNotFoundError("Project was not found.")
        return public_project(project)

    def archive_project(self, project_id: UUID, owner_user_id: str) -> dict[str, Any]:
        return self.update_project(
            project_id,
            owner_user_id,
            {"status": "archived"},
        )
