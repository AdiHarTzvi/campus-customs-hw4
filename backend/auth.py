"""Account creation, login, and sessions backed by the existing `users` table.

Passwords are stored as `pbkdf2_sha256$<salt>$<hex digest>` (PBKDF2-HMAC-SHA256, 120,000
iterations), the same format as the seed users already in the database. Password hashes
never leave this module: every response uses `public_user`, which omits them.
"""

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "campus_customs.db"

PBKDF2_ITERATIONS = 120_000
MIN_PASSWORD_LENGTH = 8
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

SESSION_COOKIE = "cc_session"
SESSION_MAX_AGE = 7 * 24 * 60 * 60
# Signs session cookies. Set SESSION_SECRET to keep users logged in across restarts;
# otherwise a random secret is used and everyone is logged out when the server restarts.
SESSION_SECRET = (os.environ.get("SESSION_SECRET") or secrets.token_hex(32)).encode()

router = APIRouter(prefix="/api/auth")


# ---------- Passwords ----------

def _pbkdf2(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), PBKDF2_ITERATIONS
    ).hex()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(8)
    return f"pbkdf2_sha256${salt}${_pbkdf2(password, salt)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, salt, digest = stored.split("$")
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    return hmac.compare_digest(_pbkdf2(password, salt), digest)


# Used when the email is unknown so a failed login takes as long as a wrong password.
_DUMMY_HASH = hash_password(secrets.token_hex(16))


# ---------- Sessions (signed cookie: "<user_id>.<expires>.<signature>") ----------

def _sign(payload: str) -> str:
    return hmac.new(SESSION_SECRET, payload.encode(), hashlib.sha256).hexdigest()


def make_session_token(user_id: int) -> str:
    payload = f"{user_id}.{int(time.time()) + SESSION_MAX_AGE}"
    return f"{payload}.{_sign(payload)}"


def read_session_token(token: str | None) -> int | None:
    if not token:
        return None
    try:
        user_id, expires, signature = token.split(".")
    except ValueError:
        return None
    if not hmac.compare_digest(_sign(f"{user_id}.{expires}"), signature):
        return None
    if int(expires) < time.time():
        return None
    return int(user_id)


def set_session_cookie(response: Response, user_id: int) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        make_session_token(user_id),
        max_age=SESSION_MAX_AGE,
        httponly=True,  # not readable from JavaScript
        samesite="lax",
        path="/",
    )


# ---------- Database ----------

def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def public_user(row: sqlite3.Row) -> dict:
    # Deliberately excludes password_hash.
    return {
        "id": row["id"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "name": row["name"],
        "email": row["email"],
        "created_at": row["created_at"],
    }


def find_user_by_email(conn: sqlite3.Connection, email: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM users WHERE lower(email) = ?", (email.lower(),)
    ).fetchone()


def find_user_by_id(conn: sqlite3.Connection, user_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def current_user(request: Request) -> sqlite3.Row | None:
    user_id = read_session_token(request.cookies.get(SESSION_COOKIE))
    if user_id is None:
        return None
    with connect() as conn:
        return find_user_by_id(conn, user_id)


# ---------- Request bodies ----------
# Fields are optional at the schema level so missing values get friendly,
# per-field messages instead of FastAPI's generic 422.

class SignupBody(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    password: str | None = None
    confirm_password: str | None = None


class LoginBody(BaseModel):
    email: str | None = None
    password: str | None = None


def fail(status: int, message: str, fields: dict[str, str] | None = None) -> HTTPException:
    return HTTPException(status_code=status, detail={"message": message, "fields": fields or {}})


# ---------- Endpoints ----------

@router.post("/signup", status_code=201)
def signup(body: SignupBody, response: Response) -> dict:
    first_name = (body.first_name or "").strip()
    last_name = (body.last_name or "").strip()
    email = (body.email or "").strip().lower()
    password = body.password or ""
    confirm = body.confirm_password or ""

    errors: dict[str, str] = {}
    if not first_name:
        errors["first_name"] = "First name is required."
    if not last_name:
        errors["last_name"] = "Last name is required."
    if not email:
        errors["email"] = "Email is required."
    elif not EMAIL_PATTERN.match(email):
        errors["email"] = "Enter a valid email address."
    if not password:
        errors["password"] = "Password is required."
    elif len(password) < MIN_PASSWORD_LENGTH:
        errors["password"] = f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
    if not confirm:
        errors["confirm_password"] = "Please confirm your password."
    elif password and confirm != password:
        errors["confirm_password"] = "Passwords do not match."
    if errors:
        raise fail(400, "Please fix the highlighted fields.", errors)

    with connect() as conn:
        if find_user_by_email(conn, email):
            raise fail(409, "An account with this email already exists.", {"email": "This email is already registered."})
        try:
            cursor = conn.execute(
                "INSERT INTO users (name, email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?, ?)",
                (f"{first_name} {last_name}", email, hash_password(password), first_name, last_name),
            )
        except sqlite3.IntegrityError:
            # UNIQUE(email) caught a race between the check above and the insert.
            raise fail(409, "An account with this email already exists.", {"email": "This email is already registered."})
        user = find_user_by_id(conn, cursor.lastrowid)

    set_session_cookie(response, user["id"])
    return {"user": public_user(user)}


@router.post("/login")
def login(body: LoginBody, response: Response) -> dict:
    email = (body.email or "").strip().lower()
    password = body.password or ""

    errors: dict[str, str] = {}
    if not email:
        errors["email"] = "Email is required."
    if not password:
        errors["password"] = "Password is required."
    if errors:
        raise fail(400, "Please enter your email and password.", errors)

    with connect() as conn:
        user = find_user_by_email(conn, email)
    # Same message for unknown email and wrong password, so the form can't be used
    # to discover which emails have accounts.
    if user is None:
        verify_password(password, _DUMMY_HASH)
        raise fail(401, "Incorrect email or password.")
    if not verify_password(password, user["password_hash"]):
        raise fail(401, "Incorrect email or password.")

    set_session_cookie(response, user["id"])
    return {"user": public_user(user)}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(request: Request) -> dict:
    user = current_user(request)
    return {"user": public_user(user) if user else None}
