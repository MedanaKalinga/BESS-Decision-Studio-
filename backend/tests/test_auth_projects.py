from __future__ import annotations

import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, Response
from pymongo.errors import DuplicateKeyError

from app.api.auth import get_current_user, login, logout, me, register
from app.api.projects import archive_project, create_project, get_project, list_projects, update_project
from app.schemas.auth import LoginRequest, RegistrationRequest
from app.schemas.projects import ProjectCreateRequest, ProjectUpdateRequest
from app.services.auth_project_service import (
    AuthenticationRequiredError,
    DuplicateEmailError,
    InactiveUserError,
    InvalidCredentialsError,
    MongoAuthProjectRepository,
    ProjectNotFoundError,
)


class FakeCursor(list[dict[str, object]]):
    def sort(self, key: str, direction: int) -> "FakeCursor":
        reverse = direction < 0
        return FakeCursor(sorted(self, key=lambda item: item.get(key), reverse=reverse))


class FakeCollection:
    def __init__(self) -> None:
        self.documents: list[dict[str, object]] = []
        self.unique_fields: set[str] = set()

    def create_index(self, key: object, **values: object) -> None:
        if values.get("unique") and isinstance(key, str):
            self.unique_fields.add(key)

    @staticmethod
    def _matches(document: dict[str, object], query: dict[str, object]) -> bool:
        return all(document.get(key) == value for key, value in query.items())

    def insert_one(self, document: dict[str, object]) -> object:
        for field in self.unique_fields:
            if any(existing.get(field) == document.get(field) for existing in self.documents):
                raise DuplicateKeyError(f"duplicate {field}")
        self.documents.append(deepcopy(document))
        return object()

    def find_one(self, query: dict[str, object]) -> dict[str, object] | None:
        for document in self.documents:
            if self._matches(document, query):
                return deepcopy(document)
        return None

    def find(self, query: dict[str, object]) -> FakeCursor:
        return FakeCursor(
            deepcopy(document)
            for document in self.documents
            if self._matches(document, query)
        )

    def update_one(self, query: dict[str, object], update: dict[str, dict[str, object]], **_values: object) -> object:
        for index, document in enumerate(self.documents):
            if self._matches(document, query):
                updated = deepcopy(document)
                updated.update(deepcopy(update.get("$set", {})))
                self.documents[index] = updated
                break
        return object()


class FakeDatabase:
    def __init__(self) -> None:
        self.collections: dict[str, FakeCollection] = {}

    def __getitem__(self, name: str) -> FakeCollection:
        return self.collections.setdefault(name, FakeCollection())


class TestAuthenticationAndProjects(unittest.TestCase):
    def setUp(self) -> None:
        self.database = FakeDatabase()
        self.repository = MongoAuthProjectRepository(self.database)
        self.repository.ensure_indexes()

    def register_user(self, email: str = "user@example.com", display_name: str = "Researcher") -> dict[str, object]:
        return self.repository.register_user(email, display_name, "SecurePass123")

    def login_user(self, email: str = "user@example.com") -> tuple[dict[str, object], str]:
        return self.repository.login(email, "SecurePass123", 3600)

    def test_registration_normalizes_email_and_returns_safe_user(self) -> None:
        result = register(
            RegistrationRequest(display_name="Researcher", email=" User@Example.COM ", password="SecurePass123"),
            self.repository,
        )
        self.assertEqual(result["email"], "user@example.com")
        self.assertEqual(result["role"], "user")
        self.assertNotIn("password_hash", result)

    def test_duplicate_email_is_rejected(self) -> None:
        self.register_user()
        with self.assertRaises(DuplicateEmailError):
            self.repository.register_user("USER@example.com", "Other", "SecurePass123")

    def test_password_is_stored_as_bcrypt_hash_never_plaintext(self) -> None:
        self.register_user()
        stored = self.database["users"].documents[0]
        self.assertNotEqual(stored["password_hash"], "SecurePass123")
        self.assertTrue(str(stored["password_hash"]).startswith("$2"))
        self.assertNotIn("SecurePass123", repr(stored))

    def test_login_success_sets_httponly_cookie_and_auth_me(self) -> None:
        self.register_user()
        response = Response()
        user = login(LoginRequest(email="user@example.com", password="SecurePass123"), response, self.repository)
        cookie = response.headers["set-cookie"]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=lax", cookie)
        raw_token = cookie.split(";", 1)[0].split("=", 1)[1]
        restored = get_current_user(raw_token, self.repository)
        self.assertEqual(me(restored)["user_id"], user["user_id"])
        self.assertNotIn(raw_token, repr(self.database["auth_sessions"].documents))

    def test_invalid_password_is_rejected(self) -> None:
        self.register_user()
        with self.assertRaises(InvalidCredentialsError):
            self.repository.login("user@example.com", "wrong-password", 3600)

    def test_logout_revokes_session_and_clears_cookie(self) -> None:
        self.register_user()
        _, token = self.login_user()
        response = Response()
        logout(response, token, self.repository)
        self.assertIn("bess_session=", response.headers["set-cookie"])
        with self.assertRaises(AuthenticationRequiredError):
            self.repository.authenticate_session(token)

    def test_expired_and_revoked_sessions_are_rejected(self) -> None:
        self.register_user()
        _, token = self.login_user()
        session = self.database["auth_sessions"].documents[0]
        session["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)
        with self.assertRaises(AuthenticationRequiredError):
            self.repository.authenticate_session(token)
        session["expires_at"] = datetime.now(timezone.utc) + timedelta(hours=1)
        session["revoked_at"] = datetime.now(timezone.utc)
        with self.assertRaises(AuthenticationRequiredError):
            self.repository.authenticate_session(token)

    def test_pymongo_naive_utc_session_expiry_is_accepted(self) -> None:
        self.register_user()
        user, token = self.login_user()
        session = self.database["auth_sessions"].documents[0]
        session["expires_at"] = (
            datetime.now(timezone.utc) + timedelta(hours=1)
        ).replace(tzinfo=None)
        restored = self.repository.authenticate_session(token)
        self.assertEqual(restored["user_id"], user["user_id"])

    def test_inactive_user_is_rejected(self) -> None:
        user = self.register_user()
        self.database["users"].documents[0]["is_active"] = False
        with self.assertRaises(InactiveUserError):
            self.repository.login(str(user["email"]), "SecurePass123", 3600)

    def test_unauthenticated_project_request_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as context:
            get_current_user(None, self.repository)
        self.assertEqual(context.exception.status_code, 401)

    def test_create_list_get_update_and_archive_own_project(self) -> None:
        user = self.register_user()
        created = create_project(
            ProjectCreateRequest(name="Campus BESS", description="Research case"),
            user,
            self.repository,
        )
        project_id = UUID(str(created["project_id"]))
        self.assertEqual(list_projects(user, self.repository)[0]["name"], "Campus BESS")
        self.assertIsNotNone(get_project(project_id, user, self.repository)["last_opened_at"])
        updated = update_project(
            project_id,
            ProjectUpdateRequest(name="Updated Campus BESS"),
            user,
            self.repository,
        )
        self.assertEqual(updated["name"], "Updated Campus BESS")
        self.assertEqual(archive_project(project_id, user, self.repository)["status"], "archived")

    def test_cross_user_project_access_is_denied_for_every_operation(self) -> None:
        user_a = self.register_user("a@example.com", "User A")
        user_b = self.register_user("b@example.com", "User B")
        project = self.repository.create_project(str(user_a["user_id"]), "Project A", None)
        project_id = UUID(str(project["project_id"]))
        self.assertEqual(self.repository.list_projects(str(user_b["user_id"])), [])
        for operation in (
            lambda: self.repository.get_project(project_id, str(user_b["user_id"])),
            lambda: self.repository.update_project(project_id, str(user_b["user_id"]), {"name": "Denied"}),
            lambda: self.repository.archive_project(project_id, str(user_b["user_id"])),
        ):
            with self.assertRaises(ProjectNotFoundError):
                operation()
        self.assertEqual(self.repository.get_project(project_id, str(user_a["user_id"]))["name"], "Project A")

    def test_archiving_project_preserves_scientific_records(self) -> None:
        user = self.register_user()
        project = self.repository.create_project(str(user["user_id"]), "Project A", None)
        project_id = UUID(str(project["project_id"]))
        for collection_name in (
            "datasets",
            "optimization_runs",
            "optimization_checkpoints",
            "ahp_states",
            "promethee_states",
        ):
            self.database[collection_name].documents.append({
                "project_id": str(project_id),
                "sentinel": collection_name,
            })

        archived = self.repository.archive_project(project_id, str(user["user_id"]))

        self.assertEqual(archived["status"], "archived")
        for collection_name in (
            "datasets",
            "optimization_runs",
            "optimization_checkpoints",
            "ahp_states",
            "promethee_states",
        ):
            self.assertEqual(
                self.database[collection_name].documents[0]["sentinel"],
                collection_name,
            )

    def test_openapi_exposes_auth_and_project_endpoints_without_secret_fields(self) -> None:
        from app.main import app

        paths = app.openapi()["paths"]
        for path in (
            "/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/me",
            "/api/projects", "/api/projects/{project_id}",
        ):
            self.assertIn(path, paths)
        serialized = repr(paths["/api/auth/me"])
        self.assertNotIn("password_hash", serialized)
        self.assertNotIn("token_hash", serialized)


if __name__ == "__main__":
    unittest.main()
