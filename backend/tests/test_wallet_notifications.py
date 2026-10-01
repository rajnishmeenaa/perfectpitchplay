"""Tests for the new features: in-app notifications, wallet top-up (Razorpay),
and paying a contest entry fee directly from the wallet balance.

Like the other suites in this folder, these are INTEGRATION tests: they make real
HTTP calls against a running backend that has the new code deployed.

Point them at your backend with:
    REACT_APP_BACKEND_URL=https://<your-host> pytest tests/test_wallet_notifications.py

If REACT_APP_BACKEND_URL is unset, the shared Emergent preview default is used
(same as the other test modules) — that preview must be re-deployed with the new
endpoints before these will pass.

Razorpay note: real top-up *completion* needs live gateway keys and a real
payment, so here we cover what is testable without a gateway — auth, request
validation, and the configured/not-configured contract of the order endpoint.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://app-launch-2979.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_MOBILE = "9602341799"
ADMIN_PASSWORD = "admin123"


def _login(mobile, password):
    return requests.post(f"{API}/auth/login", json={"mobile": mobile, "password": password}, timeout=30)


def _unique_mobile():
    return "9" + str(uuid.uuid4().int)[:9]


def _balance(headers):
    r = requests.get(f"{API}/auth/me", headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    return float(r.json().get("wallet_balance", 0.0))


def _make_contest(admin_headers, entry_fee=100, title="TEST_WalletContest"):
    r = requests.post(f"{API}/contests", json={
        "title": title, "description": "d", "external_link": "https://a.com",
        "entry_fee": entry_fee, "prize_pool": entry_fee * 5, "max_participants": 50,
    }, headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _delete_contest(admin_headers, cid):
    requests.delete(f"{API}/contests/{cid}", headers=admin_headers, timeout=30)


def _credit_wallet(admin_headers, uid, amount, note="TEST_seed"):
    r = requests.post(f"{API}/admin/users/{uid}/wallet",
                      json={"amount": amount, "note": note}, headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text
    return r


@pytest.fixture(scope="module")
def admin_headers():
    r = _login(ADMIN_MOBILE, ADMIN_PASSWORD)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def user_ctx(admin_headers):
    mobile = _unique_mobile()
    r = requests.post(f"{API}/admin/users", json={
        "name": "TEST_WalletUser", "mobile": mobile, "password": "pass1234", "wallet_balance": 0
    }, headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text
    uid = r.json()["id"]
    login = _login(mobile, "pass1234").json()
    yield {"id": uid, "mobile": mobile, "headers": {"Authorization": f"Bearer {login['token']}"}}
    requests.delete(f"{API}/admin/users/{uid}", headers=admin_headers, timeout=30)


# ---------- Pay entry fee from wallet ----------
class TestWalletEntryPayment:
    def test_requires_auth(self):
        r = requests.post(f"{API}/entries/wallet", json={"contest_id": "x"}, timeout=30)
        assert r.status_code == 401

    def test_insufficient_balance_400(self, admin_headers, user_ctx):
        cid = _make_contest(admin_headers, entry_fee=100000, title="TEST_Expensive")
        try:
            r = requests.post(f"{API}/entries/wallet", json={"contest_id": cid},
                              headers=user_ctx["headers"], timeout=30)
            assert r.status_code == 400, r.text
            assert "nsufficient" in r.json().get("detail", "")
        finally:
            _delete_contest(admin_headers, cid)

    def test_contest_not_found_404(self, user_ctx):
        r = requests.post(f"{API}/entries/wallet", json={"contest_id": "does-not-exist"},
                          headers=user_ctx["headers"], timeout=30)
        assert r.status_code == 404

    def test_success_debits_and_auto_approves(self, admin_headers, user_ctx):
        cid = _make_contest(admin_headers, entry_fee=100, title="TEST_WalletJoin")
        try:
            before = _balance(user_ctx["headers"])
            # Ensure enough funds regardless of prior tests in this module.
            if before < 100:
                _credit_wallet(admin_headers, user_ctx["id"], 100 - before + 500)
                before = _balance(user_ctx["headers"])

            r = requests.post(f"{API}/entries/wallet", json={"contest_id": cid},
                              headers=user_ctx["headers"], timeout=30)
            assert r.status_code == 200, r.text
            entry = r.json()
            assert entry["status"] == "approved"
            assert entry["payment_method"] == "wallet"
            assert entry["entry_fee"] == 100
            assert entry["contest_id"] == cid

            # Balance debited by exactly the entry fee.
            after = _balance(user_ctx["headers"])
            assert round(before - after, 2) == 100.0

            # Shows up in "my entries".
            mine = requests.get(f"{API}/entries/mine", headers=user_ctx["headers"], timeout=30).json()
            assert any(e["id"] == entry["id"] and e["payment_method"] == "wallet" for e in mine)

            # Debit logged in wallet history.
            hist = requests.get(f"{API}/wallet/history", headers=user_ctx["headers"], timeout=30).json()
            assert any(h["amount"] == -100 and "Entry fee" in (h.get("note") or "") for h in hist)
        finally:
            _delete_contest(admin_headers, cid)

    def test_duplicate_entry_400(self, admin_headers, user_ctx):
        cid = _make_contest(admin_headers, entry_fee=50, title="TEST_DupJoin")
        try:
            bal = _balance(user_ctx["headers"])
            if bal < 50:
                _credit_wallet(admin_headers, user_ctx["id"], 500)
            r1 = requests.post(f"{API}/entries/wallet", json={"contest_id": cid},
                               headers=user_ctx["headers"], timeout=30)
            assert r1.status_code == 200, r1.text
            r2 = requests.post(f"{API}/entries/wallet", json={"contest_id": cid},
                               headers=user_ctx["headers"], timeout=30)
            assert r2.status_code == 400, r2.text
        finally:
            _delete_contest(admin_headers, cid)

    def test_admin_cannot_join(self, admin_headers):
        cid = _make_contest(admin_headers, entry_fee=10, title="TEST_AdminJoin")
        try:
            r = requests.post(f"{API}/entries/wallet", json={"contest_id": cid},
                              headers=admin_headers, timeout=30)
            assert r.status_code == 400
        finally:
            _delete_contest(admin_headers, cid)


# ---------- Wallet top-up (Razorpay) ----------
class TestWalletTopUp:
    def test_order_requires_auth(self):
        r = requests.post(f"{API}/wallet/topup/order", json={"amount": 100}, timeout=30)
        assert r.status_code == 401

    @pytest.mark.parametrize("bad", [0, -5, 100001])
    def test_order_amount_validation_422(self, user_ctx, bad):
        # Pydantic Field(gt=0, le=100000) rejects these before any gateway call.
        r = requests.post(f"{API}/wallet/topup/order", json={"amount": bad},
                          headers=user_ctx["headers"], timeout=30)
        assert r.status_code == 422, r.text

    def test_order_contract(self, user_ctx):
        # 200 when Razorpay is configured; 503 when it isn't. Both are valid here.
        r = requests.post(f"{API}/wallet/topup/order", json={"amount": 100},
                          headers=user_ctx["headers"], timeout=30)
        assert r.status_code in (200, 503), r.text
        if r.status_code == 200:
            d = r.json()
            assert d["order_id"]
            assert d["amount"] == 10000  # paise
            assert d["currency"] == "INR"
            assert d["key_id"]

    def test_verify_requires_auth(self):
        r = requests.post(f"{API}/wallet/topup/verify", json={
            "razorpay_order_id": "x", "razorpay_payment_id": "y", "razorpay_signature": "z"}, timeout=30)
        assert r.status_code == 401


# ---------- In-app notifications ----------
class TestNotifications:
    def test_endpoints_require_auth(self):
        assert requests.get(f"{API}/notifications", timeout=30).status_code == 401
        assert requests.get(f"{API}/notifications/unread-count", timeout=30).status_code == 401
        assert requests.post(f"{API}/notifications/read-all", timeout=30).status_code == 401

    def test_unread_count_shape(self, user_ctx):
        r = requests.get(f"{API}/notifications/unread-count", headers=user_ctx["headers"], timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json()["unread"], int)
        assert r.json()["unread"] >= 0

    def test_wallet_adjust_creates_notification(self, admin_headers, user_ctx):
        note = f"TEST_note_{uuid.uuid4().int % 100000}"
        _credit_wallet(admin_headers, user_ctx["id"], 10, note=note)
        items = requests.get(f"{API}/notifications", headers=user_ctx["headers"], timeout=30).json()
        assert any(n["type"] == "wallet" and note in (n.get("body") or "") for n in items), items[:3]

    def test_wallet_entry_creates_entry_notification(self, admin_headers, user_ctx):
        cid = _make_contest(admin_headers, entry_fee=25, title="TEST_NotifyJoin")
        try:
            if _balance(user_ctx["headers"]) < 25:
                _credit_wallet(admin_headers, user_ctx["id"], 500)
            r = requests.post(f"{API}/entries/wallet", json={"contest_id": cid},
                              headers=user_ctx["headers"], timeout=30)
            assert r.status_code == 200, r.text
            items = requests.get(f"{API}/notifications", headers=user_ctx["headers"], timeout=30).json()
            assert any(n["type"] == "entry" and (n.get("data") or {}).get("contest_id") == cid for n in items)
        finally:
            _delete_contest(admin_headers, cid)

    def test_win_creates_notification_and_credits(self, admin_headers, user_ctx):
        cid = _make_contest(admin_headers, entry_fee=20, title="TEST_NotifyWin")
        try:
            if _balance(user_ctx["headers"]) < 20:
                _credit_wallet(admin_headers, user_ctx["id"], 500)
            ej = requests.post(f"{API}/entries/wallet", json={"contest_id": cid},
                               headers=user_ctx["headers"], timeout=30)
            assert ej.status_code == 200, ej.text
            eid = ej.json()["id"]

            before = _balance(user_ctx["headers"])
            rw = requests.post(f"{API}/entries/{eid}/declare-winner",
                               json={"entry_id": eid, "prize_amount": 300},
                               headers=admin_headers, timeout=30)
            assert rw.status_code == 200, rw.text
            assert round(_balance(user_ctx["headers"]) - before, 2) == 300.0

            items = requests.get(f"{API}/notifications", headers=user_ctx["headers"], timeout=30).json()
            assert any(n["type"] == "win" and (n.get("data") or {}).get("entry_id") == eid for n in items)
        finally:
            _delete_contest(admin_headers, cid)

    def test_mark_read_and_read_all(self, admin_headers, user_ctx):
        # Guarantee at least one unread notification exists.
        _credit_wallet(admin_headers, user_ctx["id"], 5, note="TEST_for_read")
        items = requests.get(f"{API}/notifications", headers=user_ctx["headers"], timeout=30).json()
        unread = [n for n in items if not n.get("read")]
        assert unread, "expected at least one unread notification"

        one = unread[0]
        r = requests.post(f"{API}/notifications/{one['id']}/read", headers=user_ctx["headers"], timeout=30)
        assert r.status_code == 200
        after = requests.get(f"{API}/notifications", headers=user_ctx["headers"], timeout=30).json()
        assert next(n for n in after if n["id"] == one["id"])["read"] is True

        r2 = requests.post(f"{API}/notifications/read-all", headers=user_ctx["headers"], timeout=30)
        assert r2.status_code == 200
        assert requests.get(f"{API}/notifications/unread-count",
                            headers=user_ctx["headers"], timeout=30).json()["unread"] == 0

    def test_list_sorted_desc(self, user_ctx):
        items = requests.get(f"{API}/notifications", headers=user_ctx["headers"], timeout=30).json()
        dates = [n["created_at"] for n in items]
        assert dates == sorted(dates, reverse=True)
