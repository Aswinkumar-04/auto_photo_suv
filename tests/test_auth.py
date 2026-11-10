import pytest
import time
from backend.auth import (
    verify_password,
    create_session_token,
    verify_session_token,
)
from backend.config import ADMIN_PASSWORD


def test_verify_password():
    assert verify_password(ADMIN_PASSWORD) is True
    assert verify_password("wrong-password") is False
    assert verify_password("") is False


def test_session_token_valid():
    token = create_session_token()
    assert token is not None
    assert verify_session_token(token) is True


def test_session_token_tampered():
    token = create_session_token()
    parts = token.split(":")
    # Tamper with signature
    tampered = f"{parts[0]}:{parts[1]}:badsignature"
    assert verify_session_token(tampered) is False


def test_session_token_malformed():
    assert verify_session_token("") is False
    assert verify_session_token("invalid-token") is False
    assert verify_session_token(None) is False

