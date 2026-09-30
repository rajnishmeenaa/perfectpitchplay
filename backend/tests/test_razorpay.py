"""Razorpay + regression backend tests for PitchPlay."""
import os
import io
import hmac
import json
import time
import hashlib
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "https://9bd54790-98f8-40f8-9c43-c600b460d89a.preview.emergentagent.com"
API = f"{BASE_URL}/api"

# Load Razorpay secrets from backend/.env
_env = {}
with open("/app/backend/.env") as f:
    for line in f:
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            _env[k] = v
RZP_KEY_ID = _env.get("RAZORPAY_KEY_ID")
RZP_KEY_SECRET = _env.get("RAZORPAY_KEY_SECRET")
RZP_WEBHOOK_SECRET = _env.get("RAZORPAY_WEBHOOK_SECRET")

ADMIN_MOBILE = "9602341799"
ADMIN_PASSWORD = "Admin@1234"
USER_MOBILE_EXISTING = "9000000001"
USER_PASSWORD_EXISTING = "user1234"


def _login(mobile, password):
    r = requests.post(f"{API}/auth/login", json={"mobile": mobile, "password": password})
    assert r.status_code == 200, f"login failed for {mobile}: {r.text}"
    return r.json()["token"]


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_MOBILE, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def existing_user_token():
    return _login(USER_MOBILE_EXISTING, USER_PASSWORD_EXISTING)


@pytest.fixture(scope="module")
def new_user():
    """Create a fresh user for razorpay tests (avoid 'already have an entry')."""
    mobile = f"98{int(time.time())%100000000:08d}"
    r = requests.post(f"{API}/auth/signup", json={"name": "TEST User", "mobile": mobile, "password": "test1234"})
    assert r.status_code == 200, r.text
    return {"token": r.json()["token"], "user": r.json()["user"], "mobile": mobile}


@pytest.fixture(scope="module")
def open_contest(admin_token):
    """Create an open contest for our tests."""
    payload = {
        "title": "TEST Razorpay Contest",
        "description": "test",
        "external_link": "https://example.com/play",
        "entry_fee": 50.0,
        "prize_pool": 500.0,
        "max_participants": 100,
        "match_time": None,
    }
    r = requests.post(f"{API}/contests", json=payload, headers=_hdr(admin_token))
    assert r.status_code == 200, r.text
    return r.json()


# ---------- payments/config ----------
def test_payments_config(existing_user_token):
    r = requests.get(f"{API}/payments/config", headers=_hdr(existing_user_token))
    assert r.status_code == 200
    d = r.json()
    assert d["razorpay_enabled"] is True
    assert d["key_id"].startswith("rzp_test_")
    assert "manual_upi_enabled" in d


def test_wallet_config(existing_user_token):
    r = requests.get(f"{API}/wallet/config", headers=_hdr(existing_user_token))
    assert r.status_code == 200
    d = r.json()
    assert "razorpay_enabled" in d and d["razorpay_enabled"] is True
    assert d.get("razorpay_key_id", "").startswith("rzp_test_")
    assert "manual_upi_enabled" in d


# ---------- Razorpay order ----------
def test_razorpay_order_admin_forbidden(admin_token, open_contest):
    r = requests.post(f"{API}/payments/razorpay/order", json={"contest_id": open_contest["id"]}, headers=_hdr(admin_token))
    assert r.status_code == 400


def test_razorpay_order_nonexistent(new_user):
    r = requests.post(f"{API}/payments/razorpay/order", json={"contest_id": "does-not-exist"}, headers=_hdr(new_user["token"]))
    assert r.status_code == 404


def test_razorpay_order_success(new_user, open_contest):
    r = requests.post(f"{API}/payments/razorpay/order", json={"contest_id": open_contest["id"]}, headers=_hdr(new_user["token"]))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["order_id"].startswith("order_")
    assert d["amount"] == int(open_contest["entry_fee"] * 100)
    assert d["currency"] == "INR"
    assert d["key_id"] == RZP_KEY_ID
    assert d["prefill"]["contact"] == new_user["mobile"]
    new_user["order_id"] = d["order_id"]


def test_verify_wrong_signature(new_user):
    body = {
        "razorpay_order_id": new_user["order_id"],
        "razorpay_payment_id": "pay_TESTFAKE1",
        "razorpay_signature": "0" * 64,
    }
    r = requests.post(f"{API}/payments/razorpay/verify", json=body, headers=_hdr(new_user["token"]))
    assert r.status_code == 400
    assert "verification" in r.json().get("detail", "").lower()


def test_order_status_after_sig_fail_recreate(new_user, open_contest):
    """After signature failure the order status becomes signature_failed; user must create new order (no existing entry yet)."""
    r = requests.post(f"{API}/payments/razorpay/order", json={"contest_id": open_contest["id"]}, headers=_hdr(new_user["token"]))
    assert r.status_code == 200, r.text
    new_user["order_id"] = r.json()["order_id"]


def test_verify_good_signature_creates_entry(new_user, open_contest):
    order_id = new_user["order_id"]
    payment_id = "pay_TESTOK" + uuid.uuid4().hex[:10]
    msg = f"{order_id}|{payment_id}"
    sig = hmac.new(RZP_KEY_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()
    body = {"razorpay_order_id": order_id, "razorpay_payment_id": payment_id, "razorpay_signature": sig}
    r = requests.post(f"{API}/payments/razorpay/verify", json=body, headers=_hdr(new_user["token"]))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "approved"
    assert d["payment_method"] == "razorpay"
    assert d["razorpay_payment_id"] == payment_id
    assert d["external_link"] == open_contest["external_link"]
    new_user["entry_id"] = d["id"]
    new_user["payment_id"] = payment_id


def test_verify_idempotent(new_user):
    order_id = new_user["order_id"]
    payment_id = new_user["payment_id"]
    msg = f"{order_id}|{payment_id}"
    sig = hmac.new(RZP_KEY_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()
    body = {"razorpay_order_id": order_id, "razorpay_payment_id": payment_id, "razorpay_signature": sig}
    r = requests.post(f"{API}/payments/razorpay/verify", json=body, headers=_hdr(new_user["token"]))
    assert r.status_code == 200
    assert r.json()["id"] == new_user["entry_id"]


def test_order_again_after_approved_entry_blocked(new_user, open_contest):
    r = requests.post(f"{API}/payments/razorpay/order", json={"contest_id": open_contest["id"]}, headers=_hdr(new_user["token"]))
    assert r.status_code == 400
    assert "already" in r.json().get("detail", "").lower()


def test_verify_other_user_order_404(existing_user_token, new_user):
    order_id = new_user["order_id"]
    payment_id = new_user["payment_id"]
    msg = f"{order_id}|{payment_id}"
    sig = hmac.new(RZP_KEY_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()
    body = {"razorpay_order_id": order_id, "razorpay_payment_id": payment_id, "razorpay_signature": sig}
    r = requests.post(f"{API}/payments/razorpay/verify", json=body, headers=_hdr(existing_user_token))
    assert r.status_code == 404


# ---------- Webhook ----------
def test_webhook_missing_signature():
    r = requests.post(f"{API}/payments/razorpay/webhook", data=b"{}")
    assert r.status_code == 400


def test_webhook_bad_signature():
    r = requests.post(f"{API}/payments/razorpay/webhook", data=b'{"event":"payment.captured"}',
                     headers={"X-Razorpay-Signature": "bad", "Content-Type": "application/json"})
    assert r.status_code == 400


def test_webhook_payment_captured_idempotent(new_user):
    """Send a payment.captured for the already-fulfilled order -- must remain idempotent."""
    body = {
        "event": "payment.captured",
        "payload": {"payment": {"entity": {"id": new_user["payment_id"], "order_id": new_user["order_id"]}}},
    }
    raw = json.dumps(body).encode()
    sig = hmac.new(RZP_WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    r = requests.post(f"{API}/payments/razorpay/webhook", data=raw,
                     headers={"X-Razorpay-Signature": sig, "Content-Type": "application/json"})
    assert r.status_code == 200
    assert r.json().get("ok") is True


def test_webhook_payment_failed(new_user, open_contest, admin_token):
    """Create a fresh order for another new user, then send payment.failed webhook."""
    mobile = f"97{int(time.time())%100000000:08d}"
    r = requests.post(f"{API}/auth/signup", json={"name": "TEST Fail", "mobile": mobile, "password": "test1234"})
    assert r.status_code == 200
    tok = r.json()["token"]
    r = requests.post(f"{API}/payments/razorpay/order", json={"contest_id": open_contest["id"]}, headers=_hdr(tok))
    assert r.status_code == 200
    order_id = r.json()["order_id"]
    body = {
        "event": "payment.failed",
        "payload": {"payment": {"entity": {"id": "pay_FAIL" + uuid.uuid4().hex[:8], "order_id": order_id,
                                            "error_description": "test failure"}}},
    }
    raw = json.dumps(body).encode()
    sig = hmac.new(RZP_WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    r = requests.post(f"{API}/payments/razorpay/webhook", data=raw,
                     headers={"X-Razorpay-Signature": sig, "Content-Type": "application/json"})
    assert r.status_code == 200
    # Check via admin endpoint that order status is failed
    r = requests.get(f"{API}/admin/payments/razorpay", headers=_hdr(admin_token))
    assert r.status_code == 200
    orders = r.json()["orders"]
    match = next((o for o in orders if o["razorpay_order_id"] == order_id), None)
    assert match is not None
    assert match["status"] == "failed"


# ---------- Downstream data ----------
def test_contests_shows_my_approved_entry(new_user, open_contest):
    r = requests.get(f"{API}/contests", headers=_hdr(new_user["token"]))
    assert r.status_code == 200
    contest = next((c for c in r.json() if c["id"] == open_contest["id"]), None)
    assert contest is not None
    assert contest.get("my_entry_status") == "approved"
    assert contest.get("external_link") == open_contest["external_link"]


def test_entries_mine_shows_razorpay(new_user):
    r = requests.get(f"{API}/entries/mine", headers=_hdr(new_user["token"]))
    assert r.status_code == 200
    entries = r.json()
    e = next((x for x in entries if x["id"] == new_user["entry_id"]), None)
    assert e is not None
    assert e["payment_method"] == "razorpay"
    assert e["status"] == "approved"


def test_admin_entries_shows_null_screenshot(admin_token, new_user):
    r = requests.get(f"{API}/entries", headers=_hdr(admin_token))
    assert r.status_code == 200
    e = next((x for x in r.json() if x["id"] == new_user["entry_id"]), None)
    assert e is not None
    assert e["screenshot_path"] is None
    assert e["payment_method"] == "razorpay"


def test_admin_stats(admin_token):
    r = requests.get(f"{API}/admin/stats", headers=_hdr(admin_token))
    assert r.status_code == 200
    d = r.json()
    assert "online_payments_count" in d
    assert "online_collected" in d
    assert d["online_payments_count"] >= 1
    assert d["online_collected"] >= 50.0


def test_admin_rzp_orders(admin_token):
    r = requests.get(f"{API}/admin/payments/razorpay", headers=_hdr(admin_token))
    assert r.status_code == 200
    d = r.json()
    assert "orders" in d and isinstance(d["orders"], list)
    assert "total_collected" in d
    assert d["total_collected"] >= 50.0


# ---------- manual_upi toggle ----------
def test_manual_upi_toggle_off_blocks_entry(admin_token, existing_user_token, open_contest):
    # get current settings
    r = requests.get(f"{API}/admin/payment-settings", headers=_hdr(admin_token))
    assert r.status_code == 200
    cur = r.json()
    # turn off
    payload = {"upi_id": cur.get("upi_id", "admin@upi"), "payee_name": cur.get("payee_name", "Admin"),
               "instructions": cur.get("instructions", ""), "manual_upi_enabled": False}
    r = requests.put(f"{API}/admin/payment-settings", json=payload, headers=_hdr(admin_token))
    assert r.status_code == 200
    try:
        # existing user creates fresh contest join attempt via manual
        # create another user (existing_user_token has already-joined contests but this one is fresh)
        files = {"screenshot": ("s.png", io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 100), "image/png")}
        data = {"contest_id": open_contest["id"], "utr": "TESTUTR1"}
        r = requests.post(f"{API}/entries", data=data, files=files, headers=_hdr(existing_user_token))
        assert r.status_code == 400
        assert "manual upi" in r.json().get("detail", "").lower()
    finally:
        payload["manual_upi_enabled"] = True
        r = requests.put(f"{API}/admin/payment-settings", json=payload, headers=_hdr(admin_token))
        assert r.status_code == 200


def test_manual_entry_works_when_enabled(admin_token, open_contest):
    # create a fresh user
    mobile = f"96{int(time.time())%100000000:08d}"
    r = requests.post(f"{API}/auth/signup", json={"name": "TEST Manual", "mobile": mobile, "password": "test1234"})
    assert r.status_code == 200
    tok = r.json()["token"]
    files = {"screenshot": ("s.png", io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 100), "image/png")}
    data = {"contest_id": open_contest["id"], "utr": "TESTUTR2"}
    r = requests.post(f"{API}/entries", data=data, files=files, headers=_hdr(tok))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "pending"
    assert d["payment_method"] == "manual_upi"


# ---------- regression ----------
def test_signup_duplicate_blocked():
    r = requests.post(f"{API}/auth/signup", json={"name": "dup", "mobile": USER_MOBILE_EXISTING, "password": "x"})
    assert r.status_code == 400


def test_login_bad_password():
    r = requests.post(f"{API}/auth/login", json={"mobile": USER_MOBILE_EXISTING, "password": "wrong"})
    assert r.status_code == 401


def test_contest_crud(admin_token):
    r = requests.post(f"{API}/contests", json={
        "title": "TEST CRUD", "description": "d", "external_link": "https://ex.com",
        "entry_fee": 10.0, "prize_pool": 100.0, "max_participants": 10, "match_time": None,
    }, headers=_hdr(admin_token))
    assert r.status_code == 200
    cid = r.json()["id"]
    r = requests.patch(f"{API}/contests/{cid}", json={"title": "TEST CRUD Updated"}, headers=_hdr(admin_token))
    assert r.status_code == 200
    assert r.json()["title"] == "TEST CRUD Updated"
    r = requests.delete(f"{API}/contests/{cid}", headers=_hdr(admin_token))
    assert r.status_code == 200
