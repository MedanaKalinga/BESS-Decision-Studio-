"""Cookie-session authentication endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status

from app.config.auth import SESSION_COOKIE_NAME, auth_settings
from app.config.mongodb import PersistenceUnavailableError, mongo_persistence
from app.schemas.auth import LoginRequest, RegistrationRequest, UserResponse
from app.services.auth_project_service import (
    AuthenticationRequiredError,
    DuplicateEmailError,
    InactiveUserError,
    InvalidCredentialsError,
    MongoAuthProjectRepository,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])


def get_auth_repository() -> MongoAuthProjectRepository:
    try:
        return MongoAuthProjectRepository(mongo_persistence.repository().database)
    except PersistenceUnavailableError as exc:
        raise HTTPException(status_code=503, detail="Authentication is temporarily unavailable.") from exc


def get_current_user(
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
    repository: MongoAuthProjectRepository = Depends(get_auth_repository),
) -> dict[str, object]:
    try:
        return repository.authenticate_session(session_token)
    except InactiveUserError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except AuthenticationRequiredError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(
    request: RegistrationRequest,
    repository: MongoAuthProjectRepository = Depends(get_auth_repository),
) -> dict[str, object]:
    try:
        return repository.register_user(request.email, request.display_name, request.password)
    except DuplicateEmailError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/login", response_model=UserResponse)
def login(
    request: LoginRequest,
    response: Response,
    repository: MongoAuthProjectRepository = Depends(get_auth_repository),
) -> dict[str, object]:
    try:
        user, raw_token = repository.login(
            request.email,
            request.password,
            auth_settings.session_ttl_seconds,
        )
    except InactiveUserError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except InvalidCredentialsError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    response.set_cookie(
        SESSION_COOKIE_NAME,
        raw_token,
        max_age=auth_settings.session_ttl_seconds,
        httponly=True,
        secure=auth_settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
    repository: MongoAuthProjectRepository = Depends(get_auth_repository),
) -> None:
    repository.revoke_session(session_token)
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        httponly=True,
        secure=auth_settings.cookie_secure,
        samesite="lax",
        path="/",
    )


@router.get("/me", response_model=UserResponse)
def me(user: dict[str, object] = Depends(get_current_user)) -> dict[str, object]:
    return user
