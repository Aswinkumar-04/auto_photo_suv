import io
import pytest
from fastapi.testclient import TestClient
from main import app
from backend.config import ADMIN_PASSWORD, SESSION_COOKIE_NAME
from backend.auth import create_session_token


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_cookies():
    token = create_session_token()
    return {SESSION_COOKIE_NAME: token}


def test_public_event_info(client: TestClient):
    response = client.get("/api/event-info")
    assert response.status_code == 200
    data = response.json()
    assert "event_name" in data
    assert "total_photos" in data


def test_guest_page_loads(client: TestClient):
    response = client.get("/guest")
    assert response.status_code == 200
    assert "SUV Photography" in response.text
    assert "guest-video" in response.text


def test_login_page_loads(client: TestClient):
    response = client.get("/login")
    assert response.status_code == 200
    assert "SUV Photography" in response.text


def test_dashboard_redirects_when_unauthenticated(client: TestClient):
    response = client.get("/dashboard", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/login"


def test_login_endpoint(client: TestClient):
    # Invalid password
    bad_res = client.post("/api/auth/login", json={"password": "wrong"})
    assert bad_res.status_code == 401

    # Valid password
    good_res = client.post("/api/auth/login", json={"password": ADMIN_PASSWORD})
    assert good_res.status_code == 200
    assert good_res.json()["success"] is True
    assert SESSION_COOKIE_NAME in good_res.cookies


def test_dashboard_stats_authenticated(client: TestClient, auth_cookies):
    response = client.get("/api/dashboard/stats", cookies=auth_cookies)
    assert response.status_code == 200
    data = response.json()
    assert "total_photos" in data
    assert "total_faces" in data
    assert "match_threshold" in data


def test_dashboard_qr_authenticated(client: TestClient, auth_cookies):
    response = client.get("/api/dashboard/qr", cookies=auth_cookies)
    assert response.status_code == 200
    data = response.json()
    assert "qr_base64" in data
    assert data["qr_base64"].startswith("data:image/png;base64,")


def test_qr_download(client: TestClient):
    response = client.get("/api/dashboard/qr/download")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert len(response.content) > 100


def test_match_face_no_face_in_selfie(client: TestClient):
    # Create a small blank image in memory
    from PIL import Image
    buf = io.BytesIO()
    img = Image.new("RGB", (200, 200), color="blue")
    img.save(buf, format="JPEG")
    buf.seek(0)

    response = client.post(
        "/api/match-face",
        files={"selfie": ("test.jpg", buf, "image/jpeg")},
    )
    assert response.status_code == 400
    data = response.json()
    assert data["success"] is False
    assert "No face detected" in data["detail"]


def test_download_zip_empty(client: TestClient):
    response = client.post("/api/download-zip", json={"photo_ids": []})
    assert response.status_code == 400

