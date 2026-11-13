import hmac
import hashlib
import time
import secrets
from typing import Optional
from fastapi import Request, HTTPException, status
from fastapi.responses import RedirectResponse

from backend.config import ADMIN_PASSWORD, SECRET_KEY, SESSION_COOKIE_NAME
from backend import database

SESSION_TTL_SECONDS = 7 * 24 * 3600  # 7 days


def get_current_password() -> str:
    """Retrieve active admin password from database settings or default from config."""
    return database.get_setting("admin_password", ADMIN_PASSWORD)


def verify_password(plain_password: str) -> bool:
    """Safely compare submitted password against configured admin password."""
    expected = get_current_password()
    return secrets.compare_digest(plain_password.strip(), expected.strip())


def create_session_token() -> str:
    """Create a tamper-proof timestamped HMAC session token."""
    timestamp = str(int(time.time()))
    random_salt = secrets.token_hex(8)
    message = f"admin:{timestamp}:{random_salt}".encode("utf-8")
    signature = hmac.new(SECRET_KEY.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return f"{timestamp}:{random_salt}:{signature}"


def verify_session_token(token: Optional[str]) -> bool:
    """Validate token format, signature, and expiration."""
    if not token or ":" not in token:
        return False

    parts = token.split(":")
    if len(parts) != 3:
        return False

    timestamp_str, random_salt, signature = parts
    try:
        timestamp = int(timestamp_str)
    except ValueError:
        return False

    # Check expiration
    if time.time() - timestamp > SESSION_TTL_SECONDS:
        return False

    # Verify signature
    message = f"admin:{timestamp_str}:{random_salt}".encode("utf-8")
    expected_sig = hmac.new(SECRET_KEY.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return secrets.compare_digest(signature, expected_sig)


def require_admin(request: Request) -> bool:
    """FastAPI dependency to protect sensitive host APIs."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not verify_session_token(token):
        # Also support Authorization: Bearer <token> header for convenience
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
            if verify_session_token(token):
                return True

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin authentication required.",
        )
    return True


def is_admin_authenticated(request: Request) -> bool:
    """Check if request comes from an authenticated host session."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    return verify_session_token(token)

