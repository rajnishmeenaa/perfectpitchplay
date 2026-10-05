"""Backend tests for Google auth + set-mobile + admin payment settings (manual UPI)."""
import os
import uuid
from datetime import datetime, timezone, timedelta

import jwt
import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE_URL:
    # Fallback: read from frontend env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

API = f"{BASE_URL}/api"
JWT_SECRET = os.environ["JWT_SECRET"]
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

ADMIN_MOBILE = "9602341799"
ADMIN_PASSWORD = "Admin@1234"
USER_MOBILE = "9000000001"
USER_PASSWORD = "user1234"


@pytest.fixture(scope="module")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"mobile": ADMIN_MOBILE, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def user_token():
    r = requests.post(f"{API}/auth/login", json={"mobile": USER_MOBILE, "password": USER_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture()
def google_user(db):
    """Create a mobile-less user simulating a Google sign-in and return (uid, token, email)."""
    uid = str(uuid.uuid4())
    email = f"gtest_{uid[:8]}@example.com"
    db.users.insert_one({
        "id": uid, "name": "Google Tester", "email": email, "mobile": None,
        "role": "user", "wallet_balance": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    token = jwt.encode(
        {"sub": uid, "role": "user", "exp": datetime.now(timezone.utc) + timedelta(days=1)},
        JWT_SECRET, algorithm="HS256",
    )
    yield {"id": uid, "token": token, "email": email}
    db.users.delete_many({"email": email})


# ---------- Google auth endpoints ----------

def test_google_session_invalid_returns_401():
    r = requests.post(f"{API}/auth/google/session", json={"session_id": "not-a-real-session"})
    assert r.status_code == 401, r.text


def test_set_mobile_without_bearer_returns_401():
    r = requests.post(f"{API}/auth/set-mobile", json={"mobile": "9111111111"})
    assert r.status_code == 401, r.text


def test_auth_me_returns_needs_mobile_false_for_user(user_token):
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {user_token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "needs_mobile" in body
    assert body["needs_mobile"] is False  # existing user has mobile


def test_auth_me_needs_mobile_true_for_google_user(google_user):
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {google_user['token']}"})
    assert r.status_code == 200, r.text
    assert r.json()["needs_mobile"] is True


# ---------- set-mobile ----------

def test_set_mobile_non_digit(google_user):
    r = requests.post(
        f"{API}/auth/set-mobile",
        json={"mobile": "abcd12345"},
        headers={"Authorization": f"Bearer {google_user['token']}"},
    )
    assert r.status_code == 400, r.text


def test_set_mobile_clash(google_user):
    r = requests.post(
        f"{API}/auth/set-mobile",
        json={"mobile": USER_MOBILE},
        headers={"Authorization": f"Bearer {google_user['token']}"},
    )
    assert r.status_code == 400, r.text
    assert "already registered" in r.json().get("detail", "").lower()


def test_set_mobile_success(google_user, db):
    fresh_mobile = "9" + str(uuid.uuid4().int)[:9]
    # Ensure it doesn't clash
    db.users.delete_many({"mobile": fresh_mobile})
    r = requests.post(
        f"{API}/auth/set-mobile",
        json={"mobile": fresh_mobile},
        headers={"Authorization": f"Bearer {google_user['token']}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["mobile"] == fresh_mobile
    # verify persisted
    got = db.users.find_one({"id": google_user["id"]})
    assert got["mobile"] == fresh_mobile


# ---------- Admin payment-settings (manual UPI only) ----------

def _get_settings(admin_token):
    r = requests.get(f"{API}/admin/payment-settings", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200, r.text
    return r.json()


def _put_settings(admin_token, payload):
    r = requests.put(
        f"{API}/admin/payment-settings",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_payment_settings_shape(admin_token):
    s = _get_settings(admin_token)
    for k in ("upi_id", "payee_name", "instructions", "manual_upi_enabled"):
        assert k in s, f"missing {k}: {s}"


def test_payment_settings_toggle_manual_upi(admin_token):
    # Snapshot current settings first
    original = _get_settings(admin_token)
    base = {
        "upi_id": original.get("upi_id") or "admin@upi",
        "payee_name": original.get("payee_name") or "Admin",
        "instructions": original.get("instructions") or "",
    }
    try:
        _put_settings(admin_token, {**base, "manual_upi_enabled": False})
        s = _get_settings(admin_token)
        assert s["manual_upi_enabled"] is False

        _put_settings(admin_token, {**base, "manual_upi_enabled": True})
        s = _get_settings(admin_token)
        assert s["manual_upi_enabled"] is True
    finally:
        _put_settings(admin_token, {**base, "manual_upi_enabled": True})
