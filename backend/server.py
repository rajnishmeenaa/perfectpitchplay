from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Header, Query, Request
from fastapi.responses import Response
import razorpay
import json
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import io
import csv
import time
import secrets
import asyncio
import hashlib
import logging
import uuid
import requests
import bcrypt
import jwt
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT / Admin config
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"
JWT_EXP_DAYS = 30
ADMIN_MOBILE = os.environ['ADMIN_MOBILE']
ADMIN_PASSWORD = os.environ['ADMIN_PASSWORD']
ADMIN_UPI_ID = os.environ['ADMIN_UPI_ID']

# Storage
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = os.environ.get("APP_NAME", "fantasy-contest")
storage_key: Optional[str] = None

# Razorpay
RZP_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RZP_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
RZP_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
rzp_client = razorpay.Client(auth=(RZP_KEY_ID, RZP_KEY_SECRET)) if RZP_KEY_ID and RZP_KEY_SECRET else None
RZPX_ACCOUNT_NUMBER = os.environ.get("RAZORPAYX_ACCOUNT_NUMBER", "").strip()
RZPX_API = "https://api.razorpay.com/v1"
payouts_enabled = bool(rzp_client and RZPX_ACCOUNT_NUMBER)


def init_storage(force: bool = False):
    global storage_key
    if storage_key and not force:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> tuple[bytes, str]:
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ---------- Utility ----------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXP_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("blocked"):
        raise HTTPException(status_code=403, detail="Account blocked")
    return user


async def require_admin(user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def inr(amount) -> str:
    try:
        return f"₹{float(amount):,.0f}"
    except (TypeError, ValueError):
        return f"₹{amount}"


async def push_notification(user_id: str, type: str, title: str, body: str = "", data: Optional[dict] = None) -> None:
    """Insert an in-app notification for a user. Never raises — notifications are best-effort."""
    if not user_id:
        return
    try:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "type": type,
            "title": title,
            "body": body or "",
            "data": data or {},
            "read": False,
            "created_at": now_iso(),
        })
    except Exception:
        logger.exception("push_notification failed")


def sanitize_user(u: dict, hide_mobile: bool = True) -> dict:
    out = {k: v for k, v in u.items() if k not in ("password_hash",)}
    if hide_mobile and out.get("role") != "admin":
        # For non-admin viewing themselves, we do show their own mobile — handled by caller.
        pass
    return out


# ---------- Models ----------
class SignupBody(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    mobile: str = Field(min_length=6, max_length=15)
    password: str = Field(min_length=4, max_length=100)
    ref: Optional[str] = Field(None, max_length=16)  # inviter's referral code


class LoginBody(BaseModel):
    mobile: str
    password: str


class GoogleSessionBody(BaseModel):
    session_id: str


class SetMobileBody(BaseModel):
    mobile: str = Field(min_length=6, max_length=15)


class PrizeBreakdownItem(BaseModel):
    rank: int = Field(ge=1, le=10000)
    amount: float = Field(gt=0, le=10000000)


def normalize_prize_breakdown(items: List[PrizeBreakdownItem]) -> List[dict]:
    ranks = [item.rank for item in items]
    if len(ranks) != len(set(ranks)):
        raise HTTPException(status_code=422, detail="Prize ranks must be unique")
    return [item.model_dump() for item in sorted(items, key=lambda item: item.rank)]


class ContestCreate(BaseModel):
    title: str
    description: str = ""
    external_link: str = ""
    entry_fee: float
    prize_pool: float = Field(default=0, ge=0)
    prize_breakdown: List[PrizeBreakdownItem] = Field(default_factory=list)
    max_participants: int = 100
    match_time: Optional[str] = None  # ISO string
    kind: str = "classic"  # "classic" | "fantasy"
    match_id: Optional[str] = None
    max_teams_per_user: int = Field(default=1, ge=1, le=20)
    auto_close_at_start: bool = True  # ops loop closes entries once match_time has passed


class ContestUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    external_link: Optional[str] = None
    entry_fee: Optional[float] = None
    prize_pool: Optional[float] = Field(default=None, ge=0)
    prize_breakdown: Optional[List[PrizeBreakdownItem]] = None
    max_participants: Optional[int] = None
    match_time: Optional[str] = None
    status: Optional[str] = None  # "open", "closed", "completed"
    kind: Optional[str] = None  # "classic" | "fantasy"
    match_id: Optional[str] = None
    max_teams_per_user: Optional[int] = Field(default=None, ge=1, le=20)
    auto_close_at_start: Optional[bool] = None


class WithdrawalCreate(BaseModel):
    amount: float
    upi_id: str


class DeclareWinnerBody(BaseModel):
    entry_id: str
    prize_amount: float


class ApproveBody(BaseModel):
    action: str  # "approve" or "reject"
    note: Optional[str] = None


class AdminUserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    mobile: str = Field(min_length=6, max_length=15)
    password: str = Field(min_length=4, max_length=100)
    wallet_balance: float = 0.0


class WalletAdjustBody(BaseModel):
    amount: float  # positive = credit, negative = debit
    note: Optional[str] = None


class BlockBody(BaseModel):
    blocked: bool


class PaymentSettingsBody(BaseModel):
    upi_id: str = Field(min_length=3, max_length=100)
    payee_name: str = Field(default="", max_length=60)
    instructions: str = Field(default="", max_length=500)
    manual_upi_enabled: bool = True
    razorpayx_account_number: str = Field(default="", max_length=40)


class RzpOrderBody(BaseModel):
    contest_id: str
    team_id: Optional[str] = None


class RzpVerifyBody(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class WalletTopupOrderBody(BaseModel):
    amount: float = Field(gt=0, le=100000)


class WalletEntryBody(BaseModel):
    contest_id: str
    team_id: Optional[str] = None


# ---------- Fantasy models (Dream11-style) ----------
FANTASY_ROLES = ("WK", "BAT", "AR", "BOWL")
# Dream11 T20 squad composition limits: min, max per role
ROLE_LIMITS = {"WK": (1, 4), "BAT": (3, 6), "AR": (1, 4), "BOWL": (3, 6)}
TEAM_SIZE = 11
CREDIT_BUDGET = 100.0
MAX_PER_SIDE = 7


class MatchCreate(BaseModel):
    team_a_name: str = Field(min_length=1, max_length=60)
    team_a_short: str = Field(min_length=1, max_length=6)
    team_b_name: str = Field(min_length=1, max_length=60)
    team_b_short: str = Field(min_length=1, max_length=6)
    start_time: str  # ISO string
    venue: str = ""
    format: str = "T20"
    external_id: str = ""  # provider match id (CricAPI unique_id) for live syncing
    live_feed: str = "scorecard"  # "scorecard" | "fantasy"
    auto_live: bool = False  # refresh the live centre from the provider on demand


class MatchUpdate(BaseModel):
    team_a_name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    team_a_short: Optional[str] = Field(default=None, min_length=1, max_length=6)
    team_b_name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    team_b_short: Optional[str] = Field(default=None, min_length=1, max_length=6)
    start_time: Optional[str] = None
    venue: Optional[str] = None
    format: Optional[str] = None
    status: Optional[str] = None  # "upcoming", "live", "completed", "abandoned"
    external_id: Optional[str] = None
    live_feed: Optional[str] = None
    auto_live: Optional[bool] = None


class PlayerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    team: str  # team_a_short or team_b_short (uppercased by server)
    role: str  # WK | BAT | AR | BOWL
    credits: float = Field(default=9.0, gt=0, le=20)
    projection: float = Field(default=0.0, ge=0, le=500)  # admin's expected fantasy points


class PlayerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    team: Optional[str] = None
    role: Optional[str] = None
    credits: Optional[float] = Field(default=None, gt=0, le=20)
    playing: Optional[bool] = None
    projection: Optional[float] = Field(default=None, ge=0, le=500)


class PlayerBulkAdd(BaseModel):
    players: List[PlayerCreate] = Field(min_length=1, max_length=40)


class TeamCreate(BaseModel):
    match_id: str
    player_ids: List[str] = Field(min_length=TEAM_SIZE, max_length=TEAM_SIZE)
    captain_id: str
    vice_captain_id: str
    name: Optional[str] = Field(default=None, max_length=30)


class TeamUpdate(BaseModel):
    player_ids: Optional[List[str]] = Field(default=None, min_length=TEAM_SIZE, max_length=TEAM_SIZE)
    captain_id: Optional[str] = None
    vice_captain_id: Optional[str] = None
    name: Optional[str] = Field(default=None, max_length=30)


class PlayerScoreIn(BaseModel):
    """Admin-entered scorecard line for one player."""
    player_id: str
    played: bool = True
    # batting
    runs: int = Field(default=0, ge=0, le=1000)
    balls: int = Field(default=0, ge=0, le=600)
    fours: int = Field(default=0, ge=0, le=200)
    sixes: int = Field(default=0, ge=0, le=100)
    out: bool = False
    # bowling
    balls_bowled: int = Field(default=0, ge=0, le=1000)  # legal balls, e.g. 24 = 4 overs
    runs_conceded: int = Field(default=0, ge=0, le=1000)
    wickets: int = Field(default=0, ge=0, le=10)
    maidens: int = Field(default=0, ge=0, le=30)
    bowled_or_lbw: int = Field(default=0, ge=0, le=10)
    # fielding
    catches: int = Field(default=0, ge=0, le=10)
    stumpings: int = Field(default=0, ge=0, le=10)
    run_out_direct: int = Field(default=0, ge=0, le=10)
    run_out_thrower: int = Field(default=0, ge=0, le=10)


class ScorecardSubmit(BaseModel):
    scores: List[PlayerScoreIn] = Field(default_factory=list)
    mark_completed: bool = True


class SettleBody(BaseModel):
    dry_run: bool = False
    force: bool = False


class EnterMultiBody(BaseModel):
    team_id: str
    contest_ids: List[str] = Field(min_length=1, max_length=12)


class LiveSyncBody(BaseModel):
    feed: Optional[str] = None  # overrides the match's stored feed for this pull
    write_scores: bool = True   # store partial stats so leaderboards move mid-match


class AppVersionBody(BaseModel):
    version_code: int = Field(ge=1, le=100000)
    version_name: str = Field(default="", max_length=20)
    apk_url: str = Field(default="", max_length=500)
    notes: str = Field(default="", max_length=500)
    force_update: bool = False


def compute_player_points(s: PlayerScoreIn, role: str, playing_xi: bool = True) -> dict:
    """Dream11 T20 scoring engine. Returns a component->points map plus 'total'."""
    if not s.played:
        return {"total": 0, "did_not_play": True, "components": {}}
    p: dict = {}
    runs = int(s.runs or 0)
    balls = int(s.balls or 0)
    wickets = int(s.wickets or 0)
    balls_bowled = int(s.balls_bowled or 0)
    catches = int(s.catches or 0)

    if playing_xi:
        p["playing_xi"] = 4

    # ---- Batting ----
    if runs:
        p["runs"] = runs
    if s.fours:
        p["fours"] = int(s.fours) * 1
    if s.sixes:
        p["sixes"] = int(s.sixes) * 2
    if runs >= 100:
        p["century"] = 16
    elif runs >= 50:
        p["half_century"] = 8
    elif runs >= 30:
        p["thirty"] = 4
    if balls >= 10:
        sr = (runs / balls) * 100.0
        if sr > 170:
            p["strike_rate"] = 6
        elif sr >= 150:
            p["strike_rate"] = 4
        elif sr >= 130:
            p["strike_rate"] = 2
        elif sr > 70:
            p["strike_rate"] = 0
        elif sr >= 60:
            p["strike_rate"] = -2
        elif sr >= 50:
            p["strike_rate"] = -4
        else:
            p["strike_rate"] = -6
    if s.out and runs == 0 and role in ("BAT", "WK", "AR"):
        p["duck"] = -2

    # ---- Bowling ----
    if wickets:
        p["wickets"] = wickets * 25
    if s.bowled_or_lbw:
        p["bowled_lbw"] = int(s.bowled_or_lbw) * 8
    if wickets >= 5:
        p["five_wicket_haul"] = 16
    elif wickets == 4:
        p["four_wicket_haul"] = 8
    elif wickets == 3:
        p["three_wicket_haul"] = 4
    if s.maidens:
        p["maidens"] = int(s.maidens) * 12
    overs = balls_bowled / 6.0
    if balls_bowled >= 12:  # minimum 2 overs
        econ = (int(s.runs_conceded or 0) / overs) if overs else 0.0
        if econ < 5:
            p["economy"] = 6
        elif econ < 6:
            p["economy"] = 4
        elif econ <= 7:
            p["economy"] = 2
        elif econ <= 10:
            p["economy"] = 0
        elif econ <= 11:
            p["economy"] = -2
        elif econ <= 12:
            p["economy"] = -4
        else:
            p["economy"] = -6

    # ---- Fielding ----
    if catches:
        p["catches"] = catches * 8
    if catches >= 3:
        p["catch_bonus"] = 4
    if s.stumpings:
        p["stumpings"] = int(s.stumpings) * 12
    if s.run_out_direct:
        p["run_out_direct"] = int(s.run_out_direct) * 12
    if s.run_out_thrower:
        p["run_out_thrower"] = int(s.run_out_thrower) * 6

    p = {k: v for k, v in p.items() if v}
    return {"total": float(round(sum(p.values()), 2)), "components": p}


def team_points(player_points: dict, team: dict, names: Optional[dict] = None) -> dict:
    """Apply Captain 2x / Vice-Captain 1.5x to a saved fantasy team."""
    names = names or {}
    c = team.get("captain_id")
    vc = team.get("vice_captain_id")
    rows = []
    for pid in team.get("player_ids", []):
        entry = player_points.get(pid) or {}
        base = float(entry.get("total", 0))
        mult = 2.0 if pid == c else (1.5 if pid == vc else 1.0)
        info = names.get(pid) or {}
        rows.append({
            "player_id": pid,
            "name": info.get("name"),
            "team": info.get("team"),
            "role": info.get("role"),
            "credits": info.get("credits"),
            "base": round(base, 2),
            "multiplier": mult,
            "points": round(base * mult, 2),
            "components": entry.get("components") or {},
            "is_captain": pid == c,
            "is_vice_captain": pid == vc,
        })
    return {"total": round(sum(r["points"] for r in rows), 2), "rows": rows}


POINTS_RULES = {
    "batting": [
        ("Run", "+1"), ("Boundary bonus (four)", "+1"), ("Six bonus", "+2"),
        ("30 run bonus", "+4"), ("Half-century bonus", "+8"), ("Century bonus", "+16"),
        ("Strike rate > 170 (min 10 balls)", "+6"), ("Strike rate 150–170", "+4"),
        ("Strike rate 130–150", "+2"), ("Strike rate 60–70", "-2"),
        ("Strike rate 50–60", "-4"), ("Strike rate < 50", "-6"),
        ("Duck (BAT / WK / AR)", "-2"),
    ],
    "bowling": [
        ("Wicket", "+25"), ("Bonus for LBW / Bowled", "+8"),
        ("3 wicket haul bonus", "+4"), ("4 wicket haul bonus", "+8"), ("5 wicket haul bonus", "+16"),
        ("Maiden over", "+12"),
        ("Economy < 5 (min 2 overs)", "+6"), ("Economy 5–6", "+4"), ("Economy 6–7", "+2"),
        ("Economy 10–11", "-2"), ("Economy 11–12", "-4"), ("Economy > 12", "-6"),
    ],
    "fielding": [
        ("Catch", "+8"), ("3 catch bonus", "+4"), ("Stumping", "+12"),
        ("Run out (direct hit)", "+12"), ("Run out (thrower / catcher)", "+6"),
    ],
    "other": [
        ("In playing XI", "+4"), ("Captain", "2x"), ("Vice-captain", "1.5x"),
    ],
}


async def get_payment_settings() -> dict:
    s = await db.settings.find_one({"key": "payment"}, {"_id": 0})
    if not s:
        s = {"key": "payment", "upi_id": ADMIN_UPI_ID, "payee_name": "Admin", "instructions": ""}
    s.setdefault("manual_upi_enabled", True)
    s.setdefault("razorpayx_account_number", RZPX_ACCOUNT_NUMBER)
    return s


async def resolve_rzpx_account() -> str:
    s = await get_payment_settings()
    return (s.get("razorpayx_account_number") or "").strip() or RZPX_ACCOUNT_NUMBER


async def payment_settings_admin_view() -> dict:
    s = await get_payment_settings()
    acct = (s.get("razorpayx_account_number") or "").strip() or RZPX_ACCOUNT_NUMBER
    s["razorpayx_account_number"] = acct
    s["razorpay_connected"] = rzp_client is not None
    s["razorpayx_enabled"] = bool(rzp_client and acct)
    return s


async def get_joinable_contest(contest_id: str, user: dict) -> dict:
    if user["role"] == "admin":
        raise HTTPException(status_code=400, detail="Admin cannot join contests")
    contest = await db.contests.find_one({"id": contest_id}, {"_id": 0})
    if not contest:
        raise HTTPException(status_code=404, detail="Contest not found")
    await enforce_play_safety(user, float(contest.get("entry_fee") or 0))
    if contest.get("status") != "open":
        raise HTTPException(status_code=400, detail="Contest not open")
    mt = contest.get("match_time")
    if mt:
        try:
            if datetime.fromisoformat(mt.replace("Z", "+00:00")) <= datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="Entries closed: match already started")
        except ValueError:
            pass
    if contest.get("kind") == "fantasy":
        # Fantasy contests allow several entries per user (one per saved team);
        # the cap is enforced per contest via max_teams_per_user in resolve_entry_team.
        await enforce_entry_caps(contest, user)
        return contest
    existing = await db.entries.find_one(
        {"contest_id": contest_id, "user_id": user["id"], "status": {"$in": ["pending", "approved", "won"]}}
    )
    if existing:
        raise HTTPException(status_code=400, detail="You already have an entry for this contest")
    await enforce_entry_caps(contest, user)
    return contest


# ---------- Auth ----------
@api_router.post("/auth/signup")
async def signup(body: SignupBody, request: Request):
    mobile = body.mobile.strip()
    key = f"signup:{mobile}:{client_ip(request)}"
    rate_limit_check("auth", key)
    existing = await db.users.find_one({"mobile": mobile})
    if existing:
        rate_limit_hit("auth", key)
        raise HTTPException(status_code=400, detail="Mobile already registered")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "name": body.name.strip(),
        "mobile": mobile,
        "password_hash": hash_password(body.password),
        "role": "user",
        "wallet_balance": 0.0,
        "bonus_balance": 0.0,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    rate_limit_clear("auth", key)
    await ensure_referral_code(user_id)
    await attribute_referral(user_id, body.ref)
    token = create_token(user_id, "user")
    return {"token": token, "user": {"id": user_id, "name": doc["name"], "mobile": mobile, "role": "user",
                                     "wallet_balance": 0.0, "bonus_balance": 0.0}}


@api_router.post("/auth/login")
async def login(body: LoginBody, request: Request):
    mobile = body.mobile.strip()
    key = f"{mobile}:{client_ip(request)}"
    # Only wrong passwords accumulate — a busy admin or a shared NAT IP is never locked out.
    rate_limit_check("auth", key)
    user = await db.users.find_one({"mobile": mobile}, {"_id": 0})
    if not user or not verify_password(body.password, user["password_hash"]):
        rate_limit_hit("auth", key)
        raise HTTPException(status_code=401, detail="Invalid mobile or password")
    if user.get("blocked"):
        raise HTTPException(status_code=403, detail="Your account is blocked. Contact admin.")
    rate_limit_clear("auth", key)
    token = create_token(user["id"], user["role"])
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "name": user["name"],
            "mobile": user["mobile"],
            "role": user["role"],
            "wallet_balance": user.get("wallet_balance", 0.0),
            "bonus_balance": round(float(user.get("bonus_balance") or 0), 2),
        },
    }


@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return {
        "id": user["id"],
        "name": user["name"],
        "mobile": user.get("mobile"),
        "email": user.get("email"),
        "picture": user.get("picture"),
        "role": user["role"],
        "wallet_balance": user.get("wallet_balance", 0.0),
        "bonus_balance": round(float(user.get("bonus_balance") or 0), 2),
        "needs_mobile": not user.get("mobile"),
    }


EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


@api_router.post("/auth/google/session")
async def google_session(body: GoogleSessionBody):
    try:
        r = requests.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": body.session_id}, timeout=15)
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="Could not reach Google sign-in service")
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Google sign-in failed or session expired")
    data = r.json()
    email = (data.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Google account has no email")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        user_id = str(uuid.uuid4())
        user = {
            "id": user_id,
            "name": (data.get("name") or email.split("@")[0]).strip(),
            "email": email,
            "mobile": None,
            "picture": data.get("picture"),
            "auth_provider": "google",
            "role": "user",
            "wallet_balance": 0.0,
            "created_at": now_iso(),
        }
        await db.users.insert_one(dict(user))
    if user.get("blocked"):
        raise HTTPException(status_code=403, detail="Your account is blocked. Contact admin.")
    token = create_token(user["id"], user.get("role", "user"))
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "name": user["name"],
            "mobile": user.get("mobile"),
            "email": user.get("email"),
            "picture": user.get("picture"),
            "role": user.get("role", "user"),
            "wallet_balance": user.get("wallet_balance", 0.0),
            "needs_mobile": not user.get("mobile"),
        },
    }


@api_router.post("/auth/set-mobile")
async def set_mobile(body: SetMobileBody, user=Depends(get_current_user)):
    mobile = body.mobile.strip()
    if not mobile.isdigit():
        raise HTTPException(status_code=400, detail="Enter a valid mobile number")
    clash = await db.users.find_one({"mobile": mobile, "id": {"$ne": user["id"]}})
    if clash:
        raise HTTPException(status_code=400, detail="Mobile already registered")
    await db.users.update_one({"id": user["id"]}, {"$set": {"mobile": mobile}})
    return {"ok": True, "mobile": mobile}


# ---------- Contests ----------
@api_router.get("/contests")
async def list_contests(user=Depends(get_current_user)):
    contests = await db.contests.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    # For non-admin, hide external_link unless user has approved entry
    if user["role"] != "admin":
        my_entries = await db.entries.find(
            {"user_id": user["id"], "status": {"$in": ["pending", "approved", "won"]}}, {"_id": 0, "contest_id": 1, "status": 1}
        ).to_list(500)
        status_by_contest = {e["contest_id"]: e["status"] for e in my_entries}
        for c in contests:
            st = status_by_contest.get(c["id"])
            c["my_entry_status"] = st
            if st not in ("approved", "won"):
                c["external_link"] = None
    # Attach participant counts (+ match info for fantasy contests)
    match_ids = list({c["match_id"] for c in contests if c.get("match_id")})
    matches_by_id = {}
    if match_ids:
        for m in await db.matches.find({"id": {"$in": match_ids}}, {"_id": 0}).to_list(300):
            matches_by_id[m["id"]] = m
    for c in contests:
        c["participants_count"] = await db.entries.count_documents(
            {"contest_id": c["id"], "status": {"$in": ["approved", "pending"]}}
        )
        m = matches_by_id.get(c.get("match_id")) if c.get("match_id") else None
        if m:
            c["match_label"] = f"{m.get('team_a_short')} vs {m.get('team_b_short')}"
            c["match_status"] = m.get("status")
            c["match_locked"] = match_locked(m)
            c["scorecard_entered"] = bool(m.get("scorecard_entered"))
        else:
            c["match_label"] = None
            c["match_status"] = None
            c["match_locked"] = False
            c["scorecard_entered"] = False
    return contests


@api_router.post("/contests")
async def create_contest(body: ContestCreate, admin=Depends(require_admin)):
    prize_breakdown = normalize_prize_breakdown(body.prize_breakdown)
    prize_pool = round(sum(item["amount"] for item in prize_breakdown), 2) if prize_breakdown else body.prize_pool
    kind = (body.kind or "classic").strip().lower()
    if kind not in ("classic", "fantasy"):
        raise HTTPException(status_code=400, detail="Kind must be 'classic' or 'fantasy'")
    match_time = body.match_time
    if kind == "fantasy":
        if not body.match_id:
            raise HTTPException(status_code=400, detail="Fantasy contests need a match")
        match = await get_match_or_404(body.match_id)
        match_time = match.get("start_time") or match_time
    doc = {
        "id": str(uuid.uuid4()),
        "title": body.title,
        "description": body.description,
        "external_link": body.external_link,
        "entry_fee": body.entry_fee,
        "prize_pool": prize_pool,
        "prize_breakdown": prize_breakdown,
        "max_participants": body.max_participants,
        "match_time": match_time,
        "kind": kind,
        "match_id": body.match_id if kind == "fantasy" else None,
        "max_teams_per_user": body.max_teams_per_user if kind == "fantasy" else 1,
        "auto_close_at_start": bool(body.auto_close_at_start),
        "status": "open",
        "created_at": now_iso(),
        "created_by": admin["id"],
    }
    await db.contests.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.patch("/contests/{contest_id}")
async def update_contest(contest_id: str, body: ContestUpdate, admin=Depends(require_admin)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if body.prize_breakdown is not None:
        prize_breakdown = normalize_prize_breakdown(body.prize_breakdown)
        updates["prize_breakdown"] = prize_breakdown
        if prize_breakdown:
            updates["prize_pool"] = round(sum(item["amount"] for item in prize_breakdown), 2)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    existing = await db.contests.find_one({"id": contest_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Contest not found")
    kind = updates.get("kind") or existing.get("kind") or "classic"
    if kind not in ("classic", "fantasy"):
        raise HTTPException(status_code=400, detail="Kind must be 'classic' or 'fantasy'")
    updates["kind"] = kind
    if kind == "fantasy":
        match_id = updates.get("match_id") or existing.get("match_id")
        if not match_id:
            raise HTTPException(status_code=400, detail="Fantasy contests need a match")
        match = await get_match_or_404(match_id)
        updates["match_id"] = match_id
        if "match_time" not in updates:
            updates["match_time"] = match.get("start_time")
    else:
        updates["match_id"] = None
        updates.setdefault("max_teams_per_user", 1)
    res = await db.contests.update_one({"id": contest_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Contest not found")
    contest = await db.contests.find_one({"id": contest_id}, {"_id": 0})
    return contest


@api_router.delete("/contests/{contest_id}")
async def delete_contest(contest_id: str, admin=Depends(require_admin)):
    await db.contests.delete_one({"id": contest_id})
    return {"ok": True}


# ---------- Entries (Join contest with UPI screenshot) ----------
@api_router.post("/entries")
async def create_entry(
    contest_id: str = Form(...),
    utr: str = Form(""),
    screenshot: UploadFile = File(...),
    team_id: str = Form(""),
    user=Depends(get_current_user),
):
    rate_limit("join", user["id"])
    settings = await get_payment_settings()
    if not settings.get("manual_upi_enabled", True):
        raise HTTPException(status_code=400, detail="Manual UPI payment is disabled. Please pay online.")
    contest = await get_joinable_contest(contest_id, user)
    team = await resolve_entry_team(contest, user, team_id or None)

    data = await screenshot.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (>5MB)")
    ext = (screenshot.filename or "png").rsplit(".", 1)[-1].lower()
    if ext not in {"png", "jpg", "jpeg", "webp"}:
        ext = "png"
    path = f"{APP_NAME}/screenshots/{user['id']}/{uuid.uuid4()}.{ext}"
    try:
        result = put_object(path, data, screenshot.content_type or "image/png")
    except Exception as e:
        logger.exception("Upload failed")
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")

    entry_id = str(uuid.uuid4())
    doc = {
        "id": entry_id,
        "contest_id": contest_id,
        "contest_title": contest["title"],
        "user_id": user["id"],
        "user_name": user["name"],
        "user_mobile": user["mobile"],
        "entry_fee": contest["entry_fee"],
        "utr": utr,
        "screenshot_path": result["path"],
        "screenshot_content_type": screenshot.content_type or "image/png",
        "status": "pending",
        "payment_method": "manual_upi",
        "contest_kind": contest.get("kind", "classic"),
        "team_id": team["id"] if team else None,
        "team_name": team.get("name") if team else None,
        "winner_prize": 0.0,
        "created_at": now_iso(),
    }
    await db.entries.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.post("/entries/wallet")
async def create_entry_wallet(body: WalletEntryBody, user=Depends(get_current_user)):
    """Pay the entry fee directly from the user's in-app wallet balance. Auto-approved."""
    rate_limit("join", user["id"])
    contest = await get_joinable_contest(body.contest_id, user)
    team = await resolve_entry_team(contest, user, body.team_id)
    fee = float(contest["entry_fee"])
    if fee <= 0:
        raise HTTPException(status_code=400, detail="This contest cannot be joined with wallet balance")
    # Bonus cash pays first (it can never be withdrawn), then the withdrawable wallet.
    settlement = await get_settlement_settings()
    cash = round(float(user.get("wallet_balance") or 0), 2)
    bonus = round(float(user.get("bonus_balance") or 0), 2) if settlement["bonus_join_enabled"] else 0.0
    if round(cash + bonus, 2) + 0.001 < fee:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance. Please top up to continue.")
    from_bonus = min(bonus, fee)
    from_cash = round(fee - from_bonus, 2)
    # Atomic conditional debit — only succeeds if both balances still cover their share.
    cond = {"id": user["id"]}
    inc = {}
    if from_cash:
        cond["wallet_balance"] = {"$gte": from_cash}
        inc["wallet_balance"] = -from_cash
    if from_bonus:
        cond["bonus_balance"] = {"$gte": from_bonus}
        inc["bonus_balance"] = -from_bonus
    res = await db.users.update_one(cond, {"$inc": inc})
    if res.matched_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance. Please top up to continue.")
    entry_id = str(uuid.uuid4())
    doc = {
        "id": entry_id,
        "contest_id": contest["id"],
        "contest_title": contest["title"],
        "user_id": user["id"],
        "user_name": user["name"],
        "user_mobile": user.get("mobile"),
        "entry_fee": fee,
        "utr": None,
        "screenshot_path": None,
        "status": "approved",
        "payment_method": "wallet",
        "contest_kind": contest.get("kind", "classic"),
        "team_id": team["id"] if team else None,
        "team_name": team.get("name") if team else None,
        "decision_note": "Auto-approved via wallet payment",
        "decided_at": now_iso(),
        "winner_prize": 0.0,
        "paid_cash": from_cash,
        "paid_bonus": from_bonus,
        "created_at": now_iso(),
    }
    await db.entries.insert_one(doc)
    logs = []
    if from_cash:
        logs.append({"id": str(uuid.uuid4()), "user_id": user["id"], "amount": -from_cash, "kind": "cash",
                     "note": f"Entry fee · {contest['title']}", "by": "system", "created_at": now_iso()})
    if from_bonus:
        logs.append({"id": str(uuid.uuid4()), "user_id": user["id"], "amount": -from_bonus, "kind": "bonus",
                     "note": f"Entry fee (bonus) · {contest['title']}", "by": "system", "created_at": now_iso()})
    for log in logs:
        await db.wallet_logs.insert_one(log)
    paid_with = f"{inr(from_bonus)} bonus" if from_cash == 0 else (
        f"{inr(from_cash)} wallet + {inr(from_bonus)} bonus" if from_bonus else "your wallet")
    await push_notification(
        user["id"], "entry", "Entry confirmed",
        f"You joined {contest['title']} using {paid_with}. {inr(fee)} deducted. Good luck!",
        {"contest_id": contest["id"], "entry_id": entry_id, "amount": fee,
         "paid_cash": from_cash, "paid_bonus": from_bonus},
    )
    doc.pop("_id", None)
    doc["external_link"] = contest.get("external_link")
    return doc


# ---------- Razorpay payments ----------
@api_router.get("/payments/config")
async def payments_config(user=Depends(get_current_user)):
    s = await get_payment_settings()
    acct = (s.get("razorpayx_account_number") or "").strip() or RZPX_ACCOUNT_NUMBER
    return {"razorpay_enabled": rzp_client is not None, "key_id": RZP_KEY_ID if rzp_client else None,
            "manual_upi_enabled": s.get("manual_upi_enabled", True), "payouts_enabled": bool(rzp_client and acct)}


@api_router.post("/payments/razorpay/order")
async def rzp_create_order(body: RzpOrderBody, user=Depends(get_current_user)):
    if not rzp_client:
        raise HTTPException(status_code=503, detail="Online payments not configured")
    contest = await get_joinable_contest(body.contest_id, user)
    team = await resolve_entry_team(contest, user, body.team_id)
    amount_paise = int(round(float(contest["entry_fee"]) * 100))
    if amount_paise < 100:
        raise HTTPException(status_code=400, detail="Entry fee must be at least ₹1 for online payment")
    order_ref = str(uuid.uuid4())
    try:
        order = rzp_client.order.create({
            "amount": amount_paise,
            "currency": "INR",
            "receipt": order_ref[:40],
            "payment_capture": 1,
            "notes": {"contest_id": contest["id"], "user_id": user["id"], "order_ref": order_ref},
        })
    except Exception as e:
        logger.exception("Razorpay order create failed")
        raise HTTPException(status_code=400, detail=f"Payment gateway error: {e}")
    await db.payment_orders.insert_one({
        "id": order_ref,
        "kind": "entry",
        "razorpay_order_id": order["id"],
        "contest_id": contest["id"],
        "contest_title": contest["title"],
        "contest_kind": contest.get("kind", "classic"),
        "team_id": team["id"] if team else None,
        "team_name": team.get("name") if team else None,
        "user_id": user["id"],
        "user_name": user["name"],
        "user_mobile": user["mobile"],
        "amount": contest["entry_fee"],
        "amount_paise": amount_paise,
        "status": "created",
        "created_at": now_iso(),
    })
    return {
        "order_id": order["id"],
        "amount": amount_paise,
        "currency": "INR",
        "key_id": RZP_KEY_ID,
        "contest_title": contest["title"],
        "prefill": {"name": user["name"], "contact": user["mobile"]},
    }


async def fulfill_rzp_order(razorpay_order_id: str, payment_id: str, source: str) -> dict:
    order = await db.payment_orders.find_one({"razorpay_order_id": razorpay_order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    existing = await db.entries.find_one({"razorpay_order_id": razorpay_order_id}, {"_id": 0})
    if existing:
        return existing
    entry = {
        "id": str(uuid.uuid4()),
        "contest_id": order["contest_id"],
        "contest_title": order["contest_title"],
        "user_id": order["user_id"],
        "user_name": order["user_name"],
        "user_mobile": order["user_mobile"],
        "entry_fee": order["amount"],
        "utr": payment_id,
        "screenshot_path": None,
        "payment_method": "razorpay",
        "contest_kind": order.get("contest_kind", "classic"),
        "team_id": order.get("team_id"),
        "team_name": order.get("team_name"),
        "razorpay_order_id": razorpay_order_id,
        "razorpay_payment_id": payment_id,
        "status": "approved",
        "decision_note": f"Auto-approved via Razorpay ({source})",
        "decided_at": now_iso(),
        "winner_prize": 0.0,
        "created_at": now_iso(),
    }
    await db.entries.insert_one(entry)
    entry.pop("_id", None)
    await db.payment_orders.update_one(
        {"razorpay_order_id": razorpay_order_id},
        {"$set": {"status": "paid", "razorpay_payment_id": payment_id, "paid_at": now_iso(), "entry_id": entry["id"]}},
    )
    await push_notification(
        order["user_id"], "entry", "Payment successful",
        f"Your entry for {order['contest_title']} is confirmed. Good luck!",
        {"contest_id": order["contest_id"], "entry_id": entry["id"]},
    )
    return entry


@api_router.post("/payments/razorpay/verify")
async def rzp_verify(body: RzpVerifyBody, user=Depends(get_current_user)):
    if not rzp_client:
        raise HTTPException(status_code=503, detail="Online payments not configured")
    order = await db.payment_orders.find_one({"razorpay_order_id": body.razorpay_order_id, "user_id": user["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    try:
        rzp_client.utility.verify_payment_signature(body.model_dump())
    except razorpay.errors.SignatureVerificationError:
        await db.payment_orders.update_one({"razorpay_order_id": body.razorpay_order_id}, {"$set": {"status": "signature_failed"}})
        raise HTTPException(status_code=400, detail="Payment verification failed")
    entry = await fulfill_rzp_order(body.razorpay_order_id, body.razorpay_payment_id, "checkout")
    contest = await db.contests.find_one({"id": entry["contest_id"]}, {"_id": 0})
    entry["external_link"] = contest.get("external_link") if contest else None
    return entry


# ---------- Wallet top-up (Razorpay) ----------
@api_router.post("/wallet/topup/order")
async def wallet_topup_order(body: WalletTopupOrderBody, user=Depends(get_current_user)):
    rate_limit("topup", user["id"])
    await enforce_deposit_safety(user, float(body.amount))
    if not rzp_client:
        raise HTTPException(status_code=503, detail="Online payments not configured")
    if body.amount < 1:
        raise HTTPException(status_code=400, detail="Minimum top-up is ₹1")
    amount_paise = int(round(float(body.amount) * 100))
    order_ref = str(uuid.uuid4())
    try:
        order = rzp_client.order.create({
            "amount": amount_paise,
            "currency": "INR",
            "receipt": order_ref[:40],
            "payment_capture": 1,
            "notes": {"kind": "topup", "user_id": user["id"], "order_ref": order_ref},
        })
    except Exception as e:
        logger.exception("Razorpay top-up order create failed")
        raise HTTPException(status_code=400, detail=f"Payment gateway error: {e}")
    await db.payment_orders.insert_one({
        "id": order_ref,
        "kind": "topup",
        "razorpay_order_id": order["id"],
        "user_id": user["id"],
        "user_name": user["name"],
        "user_mobile": user.get("mobile"),
        "amount": float(body.amount),
        "amount_paise": amount_paise,
        "status": "created",
        "created_at": now_iso(),
    })
    return {
        "order_id": order["id"],
        "amount": amount_paise,
        "currency": "INR",
        "key_id": RZP_KEY_ID,
        "prefill": {"name": user["name"], "contact": user.get("mobile") or ""},
    }


async def fulfill_topup_order(razorpay_order_id: str, payment_id: str, source: str) -> dict:
    order = await db.payment_orders.find_one({"razorpay_order_id": razorpay_order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("topup_credited"):
        return order
    amount = float(order["amount"])
    await db.users.update_one({"id": order["user_id"]}, {"$inc": {"wallet_balance": amount}})
    await db.wallet_logs.insert_one({
        "id": str(uuid.uuid4()), "user_id": order["user_id"], "amount": amount,
        "note": f"Wallet top-up via Razorpay ({payment_id})", "by": "system", "created_at": now_iso(),
    })
    await db.payment_orders.update_one(
        {"razorpay_order_id": razorpay_order_id},
        {"$set": {"status": "paid", "razorpay_payment_id": payment_id, "paid_at": now_iso(), "topup_credited": True}},
    )
    await add_deposit(order["user_id"], amount)
    await maybe_pay_referral_bonus(order["user_id"])
    await push_notification(
        order["user_id"], "topup", "Wallet topped up",
        f"{inr(amount)} has been added to your wallet.",
        {"amount": amount, "payment_id": payment_id},
    )
    return order


@api_router.post("/wallet/topup/verify")
async def wallet_topup_verify(body: RzpVerifyBody, user=Depends(get_current_user)):
    if not rzp_client:
        raise HTTPException(status_code=503, detail="Online payments not configured")
    order = await db.payment_orders.find_one({"razorpay_order_id": body.razorpay_order_id, "user_id": user["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    try:
        rzp_client.utility.verify_payment_signature(body.model_dump())
    except razorpay.errors.SignatureVerificationError:
        await db.payment_orders.update_one({"razorpay_order_id": body.razorpay_order_id}, {"$set": {"status": "signature_failed"}})
        raise HTTPException(status_code=400, detail="Payment verification failed")
    await fulfill_topup_order(body.razorpay_order_id, body.razorpay_payment_id, "checkout")
    me = await db.users.find_one({"id": user["id"]}, {"_id": 0, "wallet_balance": 1})
    return {"ok": True, "wallet_balance": (me or {}).get("wallet_balance", 0.0)}


PAYOUT_FINAL_OK = {"processed"}
PAYOUT_FINAL_FAIL = {"reversed", "failed", "rejected", "cancelled"}


async def apply_payout_status(w: dict, payout: dict) -> dict:
    ps = payout.get("status", "")
    upd = {"payout_status": ps, "payout_utr": payout.get("utr"), "payout_synced_at": now_iso()}
    if ps in PAYOUT_FINAL_OK and w["status"] != "paid":
        upd.update({"status": "paid", "decided_at": now_iso(), "decision_note": f"Paid via RazorpayX payout {payout['id']}"})
        await push_notification(
            w["user_id"], "payout", "Withdrawal paid",
            f"{inr(w['amount'])} has been transferred to {w.get('upi_id', 'your UPI')}.",
            {"withdrawal_id": w["id"], "amount": w["amount"]},
        )
    elif ps in PAYOUT_FINAL_FAIL and w["status"] not in ("rejected", "paid"):
        reason = payout.get("failure_reason") or (payout.get("status_details") or {}).get("description") or ps
        await db.users.update_one({"id": w["user_id"]}, {"$inc": {"wallet_balance": w["amount"]}})
        upd.update({"status": "rejected", "decided_at": now_iso(), "decision_note": f"Payout {ps}: {reason}. Amount refunded to wallet."})
        await push_notification(
            w["user_id"], "payout", "Withdrawal failed — refunded",
            f"Your payout of {inr(w['amount'])} could not be completed ({reason}). The amount has been refunded to your wallet.",
            {"withdrawal_id": w["id"], "amount": w["amount"]},
        )
    elif ps and ps not in PAYOUT_FINAL_OK | PAYOUT_FINAL_FAIL and w["status"] == "pending":
        upd["status"] = "processing"
    await db.withdrawals.update_one({"id": w["id"]}, {"$set": upd})
    return await db.withdrawals.find_one({"id": w["id"]}, {"_id": 0})


def rzpx_request(method: str, path: str, **kwargs) -> dict:
    resp = requests.request(method, f"{RZPX_API}{path}", auth=(RZP_KEY_ID, RZP_KEY_SECRET), timeout=30, **kwargs)
    data = resp.json() if resp.content else {}
    if resp.status_code >= 400:
        desc = (data.get("error") or {}).get("description") or resp.text[:200]
        if "not found on the server" in desc.lower():
            desc = "RazorpayX is not activated on this Razorpay account. Activate RazorpayX and set the account number."
        raise HTTPException(status_code=400, detail=f"RazorpayX: {desc}")
    return data


@api_router.post("/withdrawals/{wid}/payout")
async def payout_withdrawal(wid: str, admin=Depends(require_admin)):
    acct = await resolve_rzpx_account()
    if not rzp_client or not acct:
        raise HTTPException(status_code=503, detail="Auto payouts not configured. Add your RazorpayX account number in Payment settings.")
    w = await db.withdrawals.find_one({"id": wid}, {"_id": 0})
    if not w:
        raise HTTPException(status_code=404, detail="Withdrawal not found")
    if w["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Already {w['status']}")
    body = {
        "account_number": acct,
        "amount": int(round(float(w["amount"]) * 100)),
        "currency": "INR",
        "mode": "UPI",
        "purpose": "payout",
        "fund_account": {
            "account_type": "vpa",
            "vpa": {"address": w["upi_id"]},
            "contact": {"name": w["user_name"], "contact": w["user_mobile"], "type": "customer", "reference_id": w["user_id"][:40]},
        },
        "queue_if_low_balance": True,
        "reference_id": wid[:40],
        "narration": "PitchPlay winnings",
    }
    payout = rzpx_request("POST", "/payouts", json=body, headers={"X-Payout-Idempotency": wid})
    await db.withdrawals.update_one({"id": wid}, {"$set": {"payout_id": payout["id"], "payout_method": "razorpayx", "payout_requested_at": now_iso(), "payout_by": admin["id"]}})
    w["payout_id"] = payout["id"]
    return await apply_payout_status(w, payout)


@api_router.post("/withdrawals/{wid}/payout/sync")
async def sync_payout(wid: str, admin=Depends(require_admin)):
    w = await db.withdrawals.find_one({"id": wid}, {"_id": 0})
    if not w or not w.get("payout_id"):
        raise HTTPException(status_code=404, detail="No payout for this withdrawal")
    payout = rzpx_request("GET", f"/payouts/{w['payout_id']}")
    return await apply_payout_status(w, payout)


def _sig_ok(raw: bytes, signature: str, secret: str) -> bool:
    try:
        rzp_client.utility.verify_webhook_signature(raw.decode(), signature, secret)
        return True
    except razorpay.errors.SignatureVerificationError:
        return False


@api_router.post("/payments/razorpay/webhook")
async def rzp_webhook(request: Request):
    if not rzp_client or not RZP_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Webhook not configured")
    raw = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    secrets_to_try = [s for s in (RZP_WEBHOOK_SECRET, os.environ.get("RAZORPAYX_WEBHOOK_SECRET", "")) if s]
    if not any(_sig_ok(raw, signature, s) for s in secrets_to_try):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    payload = json.loads(raw)
    event = payload.get("event") or ""
    pay = (payload.get("payload", {}).get("payment", {}) or {}).get("entity", {}) or {}
    if event in ("payment.captured", "order.paid") and pay.get("order_id"):
        order = await db.payment_orders.find_one({"razorpay_order_id": pay["order_id"]})
        if order:
            if order.get("kind") == "topup":
                await fulfill_topup_order(pay["order_id"], pay["id"], "webhook")
            else:
                await fulfill_rzp_order(pay["order_id"], pay["id"], "webhook")
    elif event == "payment.failed" and pay.get("order_id"):
        await db.payment_orders.update_one(
            {"razorpay_order_id": pay["order_id"], "status": "created"},
            {"$set": {"status": "failed", "failure_reason": pay.get("error_description")}},
        )
    elif event.startswith("payout."):
        payout = (payload.get("payload", {}).get("payout", {}) or {}).get("entity", {}) or {}
        if payout.get("id"):
            w = await db.withdrawals.find_one({"payout_id": payout["id"]}, {"_id": 0})
            if w:
                await apply_payout_status(w, payout)
    return {"ok": True}


@api_router.get("/admin/payments/razorpay")
async def admin_rzp_orders(admin=Depends(require_admin)):
    items = await db.payment_orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    collected = sum(o["amount"] for o in items if o.get("status") == "paid")
    return {"orders": items, "total_collected": collected}


@api_router.get("/entries/mine")
async def my_entries(user=Depends(get_current_user)):
    items = await db.entries.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Attach external link if approved
    for it in items:
        if it["status"] in ("approved", "won"):
            c = await db.contests.find_one({"id": it["contest_id"]}, {"_id": 0})
            it["external_link"] = c.get("external_link") if c else None
    return items


@api_router.get("/entries")
async def all_entries(status: Optional[str] = None, admin=Depends(require_admin)):
    q = {}
    if status:
        q["status"] = status
    items = await db.entries.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return items


@api_router.post("/entries/{entry_id}/decision")
async def approve_entry(entry_id: str, body: ApproveBody, admin=Depends(require_admin)):
    entry = await db.entries.find_one({"id": entry_id})
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if entry["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Entry already {entry['status']}")
    new_status = "approved" if body.action == "approve" else "rejected"
    await db.entries.update_one(
        {"id": entry_id},
        {"$set": {"status": new_status, "decision_note": body.note or "", "decided_at": now_iso()}},
    )
    if new_status == "approved":
        await push_notification(
            entry["user_id"], "entry", "Entry approved",
            f"Your entry for {entry.get('contest_title', 'the contest')} was approved. You're in!",
            {"contest_id": entry.get("contest_id"), "entry_id": entry_id},
        )
    else:
        reason = f" Note: {body.note}" if body.note else ""
        await push_notification(
            entry["user_id"], "entry", "Entry rejected",
            f"Your entry for {entry.get('contest_title', 'the contest')} was rejected.{reason}",
            {"contest_id": entry.get("contest_id"), "entry_id": entry_id},
        )
    return {"ok": True, "status": new_status}


@api_router.post("/entries/{entry_id}/declare-winner")
async def declare_winner(entry_id: str, body: DeclareWinnerBody, admin=Depends(require_admin)):
    entry = await db.entries.find_one({"id": entry_id})
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if entry["status"] != "approved":
        raise HTTPException(status_code=400, detail="Entry must be approved first")
    if body.prize_amount <= 0:
        raise HTTPException(status_code=400, detail="Prize must be positive")
    await db.entries.update_one(
        {"id": entry_id},
        {"$set": {"status": "won", "winner_prize": body.prize_amount, "won_at": now_iso()}},
    )
    # Credit to user wallet
    await db.users.update_one(
        {"id": entry["user_id"]},
        {"$inc": {"wallet_balance": body.prize_amount}},
    )
    await push_notification(
        entry["user_id"], "win", "You won! 🏆",
        f"Congratulations! You won {inr(body.prize_amount)} in {entry.get('contest_title', 'a contest')}. The prize has been credited to your wallet.",
        {"contest_id": entry.get("contest_id"), "entry_id": entry_id, "prize": body.prize_amount},
    )
    return {"ok": True}


# ---------- Wallet & Withdrawals ----------
@api_router.get("/wallet/config")
async def wallet_config(user=Depends(get_current_user)):
    s = await get_payment_settings()
    g = await get_guard_settings()
    return {"admin_upi_id": s["upi_id"], "payee_name": s.get("payee_name", ""), "instructions": s.get("instructions", ""), "qr_path": s.get("qr_path"),
            "manual_upi_enabled": s.get("manual_upi_enabled", True), "razorpay_enabled": rzp_client is not None, "razorpay_key_id": RZP_KEY_ID if rzp_client else None,
            "min_withdrawal": float(g.get("min_withdrawal") or 0), "max_withdrawal_per_day": float(g.get("max_withdrawal_per_day") or 0)}


@api_router.get("/wallet/history")
async def wallet_history(user=Depends(get_current_user)):
    items = []
    async for e in db.entries.find({"user_id": user["id"], "status": "won"}, {"_id": 0}):
        items.append({"id": e["id"], "type": "prize", "kind": "cash", "amount": e.get("winner_prize", 0),
                      "tax_amount": e.get("tax_amount", 0), "prize_gross": e.get("prize_gross"),
                      "note": f"Won {e['contest_title']}", "created_at": e.get("won_at") or e["created_at"]})
    async for w in db.withdrawals.find({"user_id": user["id"]}, {"_id": 0}):
        items.append({"id": w["id"], "type": "payout", "kind": "cash", "amount": -w["amount"],
                      "note": f"Withdrawal to {w['upi_id']} ({w['status']})", "created_at": w["created_at"]})
    async for l in db.wallet_logs.find({"user_id": user["id"]}, {"_id": 0}):
        items.append({"id": l["id"], "type": "credit" if l["amount"] > 0 else "debit", "kind": l.get("kind") or "cash",
                      "amount": l["amount"], "note": l.get("note") or "Admin adjustment", "created_at": l["created_at"]})
    items.sort(key=lambda x: x["created_at"], reverse=True)
    return items


@api_router.get("/winners")
async def winners_board(user=Depends(get_current_user)):
    items = await db.entries.find({"status": "won"}, {"_id": 0, "id": 1, "contest_title": 1, "user_name": 1, "winner_prize": 1, "won_at": 1}).sort("won_at", -1).to_list(100)
    return items


# ---------- Notifications ----------
@api_router.get("/notifications")
async def list_notifications(user=Depends(get_current_user)):
    items = await db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items


@api_router.get("/notifications/unread-count")
async def notifications_unread_count(user=Depends(get_current_user)):
    unread = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return {"unread": unread}


@api_router.post("/notifications/read-all")
async def notifications_read_all(user=Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True, "read_at": now_iso()}})
    return {"ok": True}


@api_router.post("/notifications/{nid}/read")
async def notification_read(nid: str, user=Depends(get_current_user)):
    await db.notifications.update_one({"id": nid, "user_id": user["id"]}, {"$set": {"read": True, "read_at": now_iso()}})
    return {"ok": True}


@api_router.get("/admin/payment-settings")
async def admin_get_payment_settings(admin=Depends(require_admin)):
    return await payment_settings_admin_view()


@api_router.put("/admin/payment-settings")
async def admin_put_payment_settings(body: PaymentSettingsBody, admin=Depends(require_admin)):
    doc = {"key": "payment", "upi_id": body.upi_id.strip(), "payee_name": body.payee_name.strip(),
           "instructions": body.instructions.strip(), "manual_upi_enabled": body.manual_upi_enabled,
           "razorpayx_account_number": body.razorpayx_account_number.strip(), "updated_at": now_iso()}
    await db.settings.update_one({"key": "payment"}, {"$set": doc}, upsert=True)
    return await payment_settings_admin_view()


@api_router.post("/admin/payment-settings/qr")
async def admin_upload_qr(qr: UploadFile = File(...), admin=Depends(require_admin)):
    data = await qr.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (>5MB)")
    ext = (qr.filename or "png").rsplit(".", 1)[-1].lower()
    if ext not in {"png", "jpg", "jpeg", "webp"}:
        ext = "png"
    path = f"{APP_NAME}/qr/{uuid.uuid4()}.{ext}"
    try:
        result = put_object(path, data, qr.content_type or "image/png")
    except Exception as e:
        logger.exception("QR upload failed")
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    await db.settings.update_one({"key": "payment"}, {"$set": {"qr_path": result["path"], "updated_at": now_iso()}}, upsert=True)
    return await get_payment_settings()


@api_router.delete("/admin/payment-settings/qr")
async def admin_remove_qr(admin=Depends(require_admin)):
    await db.settings.update_one({"key": "payment"}, {"$unset": {"qr_path": ""}})
    return await get_payment_settings()


@api_router.post("/withdrawals")
async def create_withdrawal(body: WithdrawalCreate, user=Depends(get_current_user)):
    if user["role"] == "admin":
        raise HTTPException(status_code=400, detail="Admin cannot request withdrawal")
    rate_limit("withdraw", user["id"])
    g = await get_guard_settings()
    await require_terms(user)
    upi = (body.upi_id or "").strip()
    if not UPI_RE.match(upi):
        raise HTTPException(status_code=400, detail="Enter a valid UPI ID (for example name@bank)")
    if not user.get("mobile"):
        raise HTTPException(status_code=400, detail="Add your mobile number before withdrawing")
    safety = await get_safety_settings()
    if safety["kyc_required_for_payouts"] and (user.get("kyc") or {}).get("status") != "verified":
        raise HTTPException(status_code=402, detail="Verify your PAN in Play responsibly before withdrawing")
    balance = user.get("wallet_balance", 0.0)
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    if body.amount < float(g.get("min_withdrawal") or 0):
        raise HTTPException(status_code=400, detail=f"Minimum withdrawal is {inr(g['min_withdrawal'])}")
    day_cap = float(g.get("max_withdrawal_per_day") or 0)
    if day_cap:
        already = 0.0
        async for w in db.withdrawals.find(
            {"user_id": user["id"], "status": {"$ne": "rejected"}, "created_at": {"$gte": day_start_iso()}},
            {"_id": 0, "amount": 1},
        ):
            already += float(w.get("amount") or 0)
        if already + body.amount > day_cap:
            left = max(day_cap - already, 0)
            raise HTTPException(status_code=400, detail=f"Daily withdrawal limit is {inr(day_cap)}. You can request {inr(left)} more today.")
    if body.amount > balance:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")
    # Deduct immediately (held) — refund on rejection
    await db.users.update_one({"id": user["id"]}, {"$inc": {"wallet_balance": -body.amount}})
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user["name"],
        "user_mobile": user["mobile"],
        "amount": body.amount,
        "upi_id": upi,
        "status": "pending",
        "created_at": now_iso(),
    }
    await db.withdrawals.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/withdrawals/mine")
async def my_withdrawals(user=Depends(get_current_user)):
    items = await db.withdrawals.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


@api_router.get("/withdrawals")
async def list_withdrawals(status: Optional[str] = None, admin=Depends(require_admin)):
    q = {}
    if status:
        q["status"] = status
    items = await db.withdrawals.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return items


@api_router.post("/withdrawals/{wid}/decision")
async def decide_withdrawal(wid: str, body: ApproveBody, admin=Depends(require_admin)):
    w = await db.withdrawals.find_one({"id": wid})
    if not w:
        raise HTTPException(status_code=404, detail="Withdrawal not found")
    if w["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Already {w['status']}")
    if body.action == "approve":
        await db.withdrawals.update_one(
            {"id": wid},
            {"$set": {"status": "paid", "decision_note": body.note or "", "decided_at": now_iso()}},
        )
        await push_notification(
            w["user_id"], "payout", "Withdrawal paid",
            f"{inr(w['amount'])} has been sent to {w['upi_id']}.",
            {"withdrawal_id": wid, "amount": w["amount"]},
        )
    else:
        # refund
        await db.users.update_one({"id": w["user_id"]}, {"$inc": {"wallet_balance": w["amount"]}})
        await db.withdrawals.update_one(
            {"id": wid},
            {"$set": {"status": "rejected", "decision_note": body.note or "", "decided_at": now_iso()}},
        )
        reason = f" Note: {body.note}" if body.note else ""
        await push_notification(
            w["user_id"], "payout", "Withdrawal rejected",
            f"Your withdrawal of {inr(w['amount'])} was rejected and the amount has been refunded to your wallet.{reason}",
            {"withdrawal_id": wid, "amount": w["amount"]},
        )
    return {"ok": True}


# ---------- Admin: users ----------
@api_router.get("/admin/users")
async def admin_users(admin=Depends(require_admin)):
    users = await db.users.find({"role": "user"}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(1000)
    for u in users:
        u["entries_count"] = await db.entries.count_documents({"user_id": u["id"]})
        u["total_won"] = 0
        cur = db.entries.find({"user_id": u["id"], "status": "won"}, {"_id": 0, "winner_prize": 1})
        async for e in cur:
            u["total_won"] += e.get("winner_prize", 0)
    return users


@api_router.post("/admin/users")
async def admin_create_user(body: AdminUserCreate, admin=Depends(require_admin)):
    mobile = body.mobile.strip()
    if await db.users.find_one({"mobile": mobile}):
        raise HTTPException(status_code=400, detail="Mobile already registered")
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name.strip(),
        "mobile": mobile,
        "password_hash": hash_password(body.password),
        "role": "user",
        "wallet_balance": float(body.wallet_balance),
        "blocked": False,
        "created_by_admin": True,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


@api_router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, admin=Depends(require_admin)):
    u = await db.users.find_one({"id": user_id, "role": "user"})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.delete_one({"id": user_id})
    await db.entries.delete_many({"user_id": user_id})
    await db.withdrawals.delete_many({"user_id": user_id})
    await db.fantasy_teams.delete_many({"user_id": user_id})
    return {"ok": True}


@api_router.post("/admin/users/{user_id}/block")
async def admin_block_user(user_id: str, body: BlockBody, admin=Depends(require_admin)):
    res = await db.users.update_one({"id": user_id, "role": "user"}, {"$set": {"blocked": body.blocked}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "blocked": body.blocked}


@api_router.post("/admin/users/{user_id}/wallet")
async def admin_adjust_wallet(user_id: str, body: WalletAdjustBody, admin=Depends(require_admin)):
    u = await db.users.find_one({"id": user_id, "role": "user"}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if body.amount == 0:
        raise HTTPException(status_code=400, detail="Amount cannot be zero")
    new_balance = u.get("wallet_balance", 0.0) + body.amount
    if new_balance < 0:
        raise HTTPException(status_code=400, detail="Balance cannot go negative")
    await db.users.update_one({"id": user_id}, {"$set": {"wallet_balance": new_balance}})
    await db.wallet_logs.insert_one({
        "id": str(uuid.uuid4()), "user_id": user_id, "amount": body.amount,
        "note": body.note or "", "by": admin["id"], "created_at": now_iso(),
    })
    credited = body.amount > 0
    await push_notification(
        user_id, "wallet", "Wallet credited" if credited else "Wallet debited",
        f"{inr(abs(body.amount))} {'added to' if credited else 'deducted from'} your wallet."
        + (f" {body.note}" if body.note else ""),
        {"amount": body.amount, "wallet_balance": new_balance},
    )
    return {"ok": True, "wallet_balance": new_balance}


@api_router.get("/admin/stats")
async def admin_stats(admin=Depends(require_admin)):
    total_users = await db.users.count_documents({"role": "user"})
    total_contests = await db.contests.count_documents({})
    pending_entries = await db.entries.count_documents({"status": "pending"})
    pending_withdrawals = await db.withdrawals.count_documents({"status": "pending"})
    online_paid = await db.payment_orders.find({"status": "paid"}, {"_id": 0, "amount": 1}).to_list(10000)
    total_matches = await db.matches.count_documents({})
    fantasy_teams = await db.fantasy_teams.count_documents({})
    unsettled = await db.contests.count_documents({"kind": "fantasy", "settled_at": {"$exists": False}})
    return {
        "total_users": total_users,
        "total_contests": total_contests,
        "pending_entries": pending_entries,
        "pending_withdrawals": pending_withdrawals,
        "online_payments_count": len(online_paid),
        "online_collected": sum(o["amount"] for o in online_paid),
        "total_matches": total_matches,
        "fantasy_teams": fantasy_teams,
        "fantasy_contests_unsettled": unsettled,
    }


# ---------- Files (image serve for admin/user) ----------
@api_router.get("/files")
async def serve_file(path: str = Query(...), user=Depends(get_current_user)):
    # Any authenticated user can view their own screenshots; admin can view all.
    # Since entries store screenshot_path, allow if user is admin OR path startswith user id folder.
    if user["role"] != "admin":
        expected_prefix = f"{APP_NAME}/screenshots/{user['id']}/"
        if not path.startswith(expected_prefix) and not path.startswith(f"{APP_NAME}/qr/"):
            raise HTTPException(status_code=403, detail="Forbidden")
    try:
        data, content_type = get_object(path)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Not found: {e}")
    return Response(content=data, media_type=content_type)


# ---------- Fantasy cricket (Dream11-style) ----------
async def get_match_or_404(match_id: str) -> dict:
    m = await db.matches.find_one({"id": match_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    return m


def match_locked(match: dict) -> bool:
    """Teams and entries freeze once the match has started (or its start time has passed)."""
    if match.get("status") in ("live", "completed", "abandoned"):
        return True
    st = match.get("start_time")
    if st:
        try:
            return datetime.fromisoformat(st.replace("Z", "+00:00")) <= datetime.now(timezone.utc)
        except ValueError:
            return False
    return False


async def get_match_players(match_id: str) -> list:
    return await db.players.find({"match_id": match_id}, {"_id": 0}).sort("credits", -1).to_list(300)


def validate_team(players_by_id: dict, player_ids: list, captain_id: str, vice_captain_id: str) -> dict:
    """Enforce Dream11 squad rules. Returns the composed team summary or raises 400."""
    ids = list(player_ids or [])
    if len(ids) != TEAM_SIZE:
        raise HTTPException(status_code=400, detail=f"Pick exactly {TEAM_SIZE} players")
    if len(set(ids)) != TEAM_SIZE:
        raise HTTPException(status_code=400, detail="Duplicate players selected")
    missing = [pid for pid in ids if pid not in players_by_id]
    if missing:
        raise HTTPException(status_code=400, detail="Some selected players are not in this match")
    if captain_id not in ids:
        raise HTTPException(status_code=400, detail="Captain must be one of your 11 players")
    if vice_captain_id not in ids:
        raise HTTPException(status_code=400, detail="Vice-captain must be one of your 11 players")
    if captain_id == vice_captain_id:
        raise HTTPException(status_code=400, detail="Captain and vice-captain must be different players")

    picked = [players_by_id[pid] for pid in ids]
    credits_used = round(sum(float(p.get("credits", 0)) for p in picked), 2)
    if credits_used > CREDIT_BUDGET:
        raise HTTPException(status_code=400, detail=f"Over budget: {credits_used} credits used (max {CREDIT_BUDGET:.0f})")

    by_role = {r: 0 for r in FANTASY_ROLES}
    per_team: dict = {}
    for p in picked:
        role = p.get("role")
        if role not in by_role:
            raise HTTPException(status_code=400, detail=f"Player {p.get('name')} has an invalid role")
        by_role[role] += 1
        code = p.get("team") or "?"
        per_team[code] = per_team.get(code, 0) + 1

    for role, (lo, hi) in ROLE_LIMITS.items():
        if not (lo <= by_role[role] <= hi):
            raise HTTPException(status_code=400, detail=f"{role}: pick {lo}–{hi} (you have {by_role[role]})")
    for code, n in per_team.items():
        if n > MAX_PER_SIDE:
            raise HTTPException(status_code=400, detail=f"Maximum {MAX_PER_SIDE} players from one team ({code}: {n})")

    return {"credits_used": credits_used, "by_role": by_role, "per_team": per_team}


async def resolve_entry_team(contest: dict, user: dict, team_id: Optional[str]) -> Optional[dict]:
    """Validate the fantasy team attached to a contest entry. Returns None for classic contests."""
    if contest.get("kind") != "fantasy":
        return None
    if not team_id:
        raise HTTPException(status_code=400, detail="Select a fantasy team to join this contest")
    team = await db.fantasy_teams.find_one({"id": team_id, "user_id": user["id"]}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if team.get("match_id") != contest.get("match_id"):
        raise HTTPException(status_code=400, detail="That team is not for this match")
    match = await db.matches.find_one({"id": team["match_id"]}, {"_id": 0})
    if match and match_locked(match):
        raise HTTPException(status_code=400, detail="Match has started — entries and teams are locked")
    clash = await db.entries.find_one({
        "contest_id": contest["id"], "user_id": user["id"], "team_id": team["id"],
        "status": {"$in": ["pending", "approved", "won"]},
    })
    if clash:
        raise HTTPException(status_code=400, detail="This team has already joined the contest")
    max_teams = int(contest.get("max_teams_per_user") or 1)
    already = await db.entries.count_documents({
        "contest_id": contest["id"], "user_id": user["id"],
        "status": {"$in": ["pending", "approved", "won"]},
    })
    if already >= max_teams:
        raise HTTPException(status_code=400, detail=f"You can join this contest with at most {max_teams} team(s)")
    cap = int(contest.get("max_participants") or 0)
    if cap:
        filled = await db.entries.count_documents({"contest_id": contest["id"], "status": {"$in": ["pending", "approved", "won"]}})
        if filled >= cap:
            raise HTTPException(status_code=400, detail="Contest is full")
    return team


# ----- Admin: matches -----
@api_router.post("/admin/matches")
async def admin_create_match(body: MatchCreate, admin=Depends(require_admin)):
    a = body.team_a_short.strip().upper()
    b = body.team_b_short.strip().upper()
    if a == b:
        raise HTTPException(status_code=400, detail="Team short names must be different")
    doc = {
        "id": str(uuid.uuid4()),
        "team_a_name": body.team_a_name.strip(),
        "team_a_short": a,
        "team_b_name": body.team_b_name.strip(),
        "team_b_short": b,
        "start_time": body.start_time,
        "venue": body.venue.strip(),
        "format": body.format.strip().upper() or "T20",
        "external_id": body.external_id.strip(),
        "live_feed": (body.live_feed or "scorecard").strip().lower(),
        "auto_live": bool(body.auto_live),
        "status": "upcoming",
        "scorecard_entered": False,
        "created_at": now_iso(),
        "created_by": admin["id"],
    }
    await db.matches.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/admin/matches")
async def admin_list_matches(admin=Depends(require_admin)):
    items = await db.matches.find({}, {"_id": 0}).sort("start_time", -1).to_list(500)
    for m in items:
        m["players_count"] = await db.players.count_documents({"match_id": m["id"]})
        m["teams_count"] = await db.fantasy_teams.count_documents({"match_id": m["id"]})
        m["contests_count"] = await db.contests.count_documents({"match_id": m["id"], "kind": "fantasy"})
        m["locked"] = match_locked(m)
    return items


@api_router.patch("/admin/matches/{match_id}")
async def admin_update_match(match_id: str, body: MatchUpdate, admin=Depends(require_admin)):
    match = await get_match_or_404(match_id)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "team_a_short" in updates:
        updates["team_a_short"] = updates["team_a_short"].strip().upper()
    if "team_b_short" in updates:
        updates["team_b_short"] = updates["team_b_short"].strip().upper()
    a = updates.get("team_a_short", match["team_a_short"])
    b = updates.get("team_b_short", match["team_b_short"])
    if a == b:
        raise HTTPException(status_code=400, detail="Team short names must be different")
    if updates.get("live_feed"):
        feed = str(updates["live_feed"]).strip().lower()
        if feed not in ("scorecard", "fantasy"):
            raise HTTPException(status_code=400, detail="Live feed must be 'scorecard' or 'fantasy'")
        updates["live_feed"] = feed
    if "external_id" in updates:
        updates["external_id"] = str(updates["external_id"]).strip()
    updates["updated_at"] = now_iso()
    await db.matches.update_one({"id": match_id}, {"$set": updates})
    updated = await get_match_or_404(match_id)
    # Keep fantasy contests in sync: entries must close when the match starts.
    contest_set = {"match_time": updated.get("start_time")}
    if updated.get("status") in ("live", "completed", "abandoned"):
        contest_set["status"] = "closed"
    await db.contests.update_many({"match_id": match_id, "kind": "fantasy"}, {"$set": contest_set})
    if updated.get("status") == "abandoned":
        g = await get_guard_settings()
        if g.get("refund_on_abandon", True):
            contest_ids = [c["id"] for c in await db.contests.find({"match_id": match_id}, {"_id": 0, "id": 1}).to_list(500)]
            if contest_ids:
                paid = await db.entries.find({"contest_id": {"$in": contest_ids}, "status": {"$in": ["approved", "pending"]}}, {"_id": 0}).to_list(5000)
                updated["refund"] = await refund_entries(paid, "Match abandoned")
        else:
            updated["refund"] = {"refunded": 0, "amount": 0, "note": "Auto-refund is switched off in guardrails"}
    updated["locked"] = match_locked(updated)
    return updated


@api_router.delete("/admin/matches/{match_id}")
async def admin_delete_match(match_id: str, admin=Depends(require_admin)):
    await db.matches.delete_one({"id": match_id})
    await db.players.delete_many({"match_id": match_id})
    await db.player_scores.delete_many({"match_id": match_id})
    await db.fantasy_teams.delete_many({"match_id": match_id})
    return {"ok": True}


# ----- Admin: squads -----
async def _insert_player(match: dict, body: PlayerCreate) -> dict:
    code = body.team.strip().upper()
    if code not in (match["team_a_short"], match["team_b_short"]):
        raise HTTPException(status_code=400, detail=f"Team must be {match['team_a_short']} or {match['team_b_short']}")
    role = body.role.strip().upper()
    if role not in FANTASY_ROLES:
        raise HTTPException(status_code=400, detail="Role must be WK, BAT, AR or BOWL")
    doc = {
        "id": str(uuid.uuid4()),
        "match_id": match["id"],
        "name": body.name.strip(),
        "team": code,
        "role": role,
        "credits": float(body.credits),
        "projection": float(body.projection or 0),
        "playing": True,
        "created_at": now_iso(),
    }
    await db.players.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.post("/admin/matches/{match_id}/players")
async def admin_add_player(match_id: str, body: PlayerCreate, admin=Depends(require_admin)):
    match = await get_match_or_404(match_id)
    return await _insert_player(match, body)


@api_router.post("/admin/matches/{match_id}/players/bulk")
async def admin_add_players_bulk(match_id: str, body: PlayerBulkAdd, admin=Depends(require_admin)):
    match = await get_match_or_404(match_id)
    added = [await _insert_player(match, p) for p in body.players]
    return {"added": len(added), "players": added}


@api_router.patch("/admin/players/{player_id}")
async def admin_update_player(player_id: str, body: PlayerUpdate, admin=Depends(require_admin)):
    player = await db.players.find_one({"id": player_id}, {"_id": 0})
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "team" in updates:
        match = await get_match_or_404(player["match_id"])
        code = updates["team"].strip().upper()
        if code not in (match["team_a_short"], match["team_b_short"]):
            raise HTTPException(status_code=400, detail=f"Team must be {match['team_a_short']} or {match['team_b_short']}")
        updates["team"] = code
    if "role" in updates:
        role = updates["role"].strip().upper()
        if role not in FANTASY_ROLES:
            raise HTTPException(status_code=400, detail="Role must be WK, BAT, AR or BOWL")
        updates["role"] = role
    await db.players.update_one({"id": player_id}, {"$set": updates})
    return await db.players.find_one({"id": player_id}, {"_id": 0})


@api_router.delete("/admin/players/{player_id}")
async def admin_delete_player(player_id: str, admin=Depends(require_admin)):
    player = await db.players.find_one({"id": player_id}, {"_id": 0})
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    match = await get_match_or_404(player["match_id"])
    if match_locked(match):
        raise HTTPException(status_code=400, detail="Match has started — squad is locked")
    used = await db.fantasy_teams.count_documents({"match_id": player["match_id"], "player_ids": player_id})
    if used:
        raise HTTPException(status_code=400, detail=f"{used} team(s) already contain this player")
    await db.players.delete_one({"id": player_id})
    return {"ok": True}


# ----- Admin: scorecard + settlement -----
@api_router.post("/admin/matches/{match_id}/scorecard")
async def admin_submit_scorecard(match_id: str, body: ScorecardSubmit, admin=Depends(require_admin)):
    match = await get_match_or_404(match_id)
    players = {p["id"]: p for p in await get_match_players(match_id)}
    unknown = [s.player_id for s in body.scores if s.player_id not in players]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown player(s): {', '.join(unknown[:5])}")

    saved = []
    for s in body.scores:
        player = players[s.player_id]
        pts = compute_player_points(s, player.get("role", "BAT"), playing_xi=bool(player.get("playing", True)))
        doc = {
            "match_id": match_id,
            "player_id": s.player_id,
            "player_name": player["name"],
            "team": player["team"],
            "role": player["role"],
            "stats": s.model_dump(exclude={"player_id"}),
            "points": pts["total"],
            "components": pts.get("components", {}),
            "did_not_play": bool(pts.get("did_not_play")),
            "updated_at": now_iso(),
            "updated_by": admin["id"],
        }
        await db.player_scores.update_one(
            {"match_id": match_id, "player_id": s.player_id},
            {"$set": doc},
            upsert=True,
        )
        saved.append(doc)

    await db.matches.update_one({"id": match_id}, {"$set": {
        "scorecard_entered": True,
        "scorecard_at": now_iso(),
        "status": "completed" if body.mark_completed else (match.get("status") or "live"),
    }})
    updated = await get_match_or_404(match_id)
    if updated.get("status") in ("live", "completed"):
        await db.contests.update_many({"match_id": match_id, "kind": "fantasy", "status": "open"}, {"$set": {"status": "closed"}})
    return {"ok": True, "match": updated, "scores": sorted(saved, key=lambda x: -x["points"])}


@api_router.get("/admin/matches/{match_id}/scorecard")
async def admin_get_scorecard(match_id: str, admin=Depends(require_admin)):
    match = await get_match_or_404(match_id)
    scores = await db.player_scores.find({"match_id": match_id}, {"_id": 0}).to_list(300)
    players = await get_match_players(match_id)
    by_id = {s["player_id"]: s for s in scores}
    rows = []
    for p in players:
        s = by_id.get(p["id"])
        rows.append({**p, "score": (s or {}).get("stats"), "points": (s or {}).get("points", 0),
                     "components": (s or {}).get("components", {}), "entered": bool(s)})
    return {"match": match, "rows": rows}


async def build_leaderboard(contest: dict, entries: list) -> list:
    """Rank fantasy entries by team points (Captain 2x / VC 1.5x applied)."""
    match_id = contest.get("match_id")
    scores = await db.player_scores.find({"match_id": match_id},
                                        {"_id": 0, "player_id": 1, "points": 1, "components": 1}).to_list(300)
    player_points = {s["player_id"]: {"total": s.get("points", 0), "components": s.get("components") or {}}
                     for s in scores}
    teams = await db.fantasy_teams.find({"match_id": match_id}, {"_id": 0}).to_list(2000)
    teams_by_id = {t["id"]: t for t in teams}
    names = {p["id"]: p for p in await get_match_players(match_id)}

    rows = []
    for e in entries:
        team = teams_by_id.get(e.get("team_id"))
        tp = team_points(player_points, team, names) if team else {"total": 0, "rows": []}
        rows.append({
            "entry_id": e["id"],
            "user_id": e["user_id"],
            "user_name": e.get("user_name"),
            "team_id": e.get("team_id"),
            "team_name": e.get("team_name") or (team or {}).get("name"),
            "points": tp["total"],
            "breakdown": tp["rows"],
            "rank_prev": e.get("fantasy_rank_prev"),
            "entry_status": e.get("status"),
            "prize": e.get("winner_prize", 0) if e.get("status") == "won" else 0,
            "created_at": e.get("created_at"),
        })
    rows.sort(key=lambda r: (-r["points"], r["created_at"] or ""))
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    return rows


@api_router.post("/admin/fantasy/contests/{contest_id}/settle")
async def admin_settle_contest(contest_id: str, body: SettleBody, admin=Depends(require_admin)):
    contest = await db.contests.find_one({"id": contest_id}, {"_id": 0})
    if not contest:
        raise HTTPException(status_code=404, detail="Contest not found")
    if contest.get("kind") != "fantasy":
        raise HTTPException(status_code=400, detail="Not a fantasy contest")
    match = await get_match_or_404(contest["match_id"])
    score_count = await db.player_scores.count_documents({"match_id": match["id"]})
    if not score_count:
        raise HTTPException(status_code=400, detail="Enter the match scorecard first")
    if contest.get("settled_at") and not body.dry_run and not body.force:
        raise HTTPException(status_code=400, detail="Contest already settled")

    entries = await db.entries.find(
        {"contest_id": contest_id, "status": {"$in": ["approved", "won"]}}, {"_id": 0}
    ).to_list(5000)
    board = await build_leaderboard(contest, entries)
    prizes = {int(p["rank"]): float(p["amount"]) for p in (contest.get("prize_breakdown") or [])}
    settlement = await get_settlement_settings()
    tax_percent = settlement["tax_percent"]

    winners = []
    for row in board:
        amount = prizes.get(row["rank"], 0)
        gross, tax, net = split_prize(amount, tax_percent)
        row["prize"] = amount
        row["tax_percent"] = tax_percent
        row["tax_amount"] = tax
        row["net_prize"] = net
        if amount <= 0 or body.dry_run:
            continue
        e = await db.entries.find_one({"id": row["entry_id"]})
        if not e or e.get("status") == "won":
            continue
        await db.entries.update_one(
            {"id": row["entry_id"]},
            {"$set": {"status": "won", "winner_prize": net, "prize_gross": gross,
                      "tax_percent": tax_percent, "tax_amount": tax, "won_at": now_iso(),
                      "fantasy_rank": row["rank"], "fantasy_points": row["points"]}},
        )
        await db.users.update_one({"id": row["user_id"]}, {"$inc": {"wallet_balance": net}})
        await db.wallet_logs.insert_one({
            "id": str(uuid.uuid4()), "user_id": row["user_id"], "amount": net, "kind": "cash",
            "note": (f"Fantasy prize · rank {row['rank']} · {contest.get('title')}"
                     + (f" (after {tax_percent:g}% tax {inr(tax)})" if tax else "")),
            "by": "system", "created_at": now_iso(),
        })
        await push_notification(
            row["user_id"], "win", f"You ranked #{row['rank']}! 🏆",
            f"{row['team_name'] or 'Your team'} scored {row['points']} points in {contest.get('title')}. "
            + (f"{inr(gross)} prize minus {inr(tax)} tax — {inr(net)} credited to your wallet." if tax
               else f"{inr(net)} has been credited to your wallet."),
            {"contest_id": contest_id, "entry_id": row["entry_id"], "rank": row["rank"],
             "points": row["points"], "prize": net, "prize_gross": gross, "tax_amount": tax},
        )
        winners.append({"entry_id": row["entry_id"], "rank": row["rank"], "user_name": row["user_name"],
                        "team_name": row["team_name"], "points": row["points"], "prize": net,
                        "prize_gross": gross, "tax_amount": tax, "tax_percent": tax_percent})

    if body.dry_run:
        return {"ok": True, "dry_run": True, "leaderboard": board, "winners": winners}

    # Persist points/ranks for every entry, then notify the non-winners.
    won_ids = {w["entry_id"] for w in winners}
    for row in board:
        await db.entries.update_one(
            {"id": row["entry_id"]},
            {"$set": {"fantasy_rank": row["rank"], "fantasy_points": row["points"]}},
        )
        if row["entry_id"] in won_ids or row["prize"] > 0:
            continue
        await push_notification(
            row["user_id"], "entry", "Fantasy contest result",
            f"{contest.get('title')} is settled. Your team scored {row['points']} points and ranked #{row['rank']}.",
            {"contest_id": contest_id, "entry_id": row["entry_id"], "rank": row["rank"], "points": row["points"]},
        )
    await db.contests.update_one(
        {"id": contest_id},
        {"$set": {"status": "completed", "settled_at": now_iso(), "settled_by": admin["id"], "total_entries": len(board)}},
    )
    return {"ok": True, "settled": len(board), "leaderboard": board, "winners": winners}


# ----- User: matches, squads, teams -----
@api_router.get("/matches")
async def list_matches(user=Depends(get_current_user)):
    items = await db.matches.find({}, {"_id": 0}).sort("start_time", 1).to_list(300)
    out = []
    for m in items:
        m["locked"] = match_locked(m)
        m["players_count"] = await db.players.count_documents({"match_id": m["id"]})
        m["contests_count"] = await db.contests.count_documents({"match_id": m["id"], "kind": "fantasy", "status": {"$ne": "completed"}})
        m["my_teams_count"] = await db.fantasy_teams.count_documents({"match_id": m["id"], "user_id": user["id"]})
        out.append(m)
    return out


@api_router.get("/matches/{match_id}")
async def match_detail(match_id: str, user=Depends(get_current_user)):
    match = await get_match_or_404(match_id)
    match["locked"] = match_locked(match)
    players = await get_match_players(match_id)
    contests = await db.contests.find({"match_id": match_id, "kind": "fantasy"}, {"_id": 0}).sort("entry_fee", 1).to_list(200)
    my_entries = await db.entries.find(
        {"contest_id": {"$in": [c["id"] for c in contests]}, "user_id": user["id"]},
        {"_id": 0, "contest_id": 1, "status": 1, "team_id": 1},
    ).to_list(500)
    entry_by_contest: dict = {}
    for e in my_entries:
        entry_by_contest.setdefault(e["contest_id"], []).append({"status": e["status"], "team_id": e.get("team_id")})
    for c in contests:
        c["my_entries"] = entry_by_contest.get(c["id"], [])
        c["participants_count"] = await db.entries.count_documents(
            {"contest_id": c["id"], "status": {"$in": ["approved", "pending"]}}
        )
    my_teams = await db.fantasy_teams.find({"match_id": match_id, "user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(50)
    scores = await db.player_scores.find({"match_id": match_id}, {"_id": 0, "player_id": 1, "points": 1}).to_list(300)
    points_by_player = {s["player_id"]: s.get("points", 0) for s in scores}
    for p in players:
        p["points"] = points_by_player.get(p["id"])
    players_by_id = {p["id"]: p for p in players}
    for t in my_teams:
        t["players"] = [players_by_id.get(pid) for pid in t.get("player_ids", [])]
        t["captain"] = players_by_id.get(t.get("captain_id"))
        t["vice_captain"] = players_by_id.get(t.get("vice_captain_id"))
    return {"match": match, "players": players, "contests": contests, "my_teams": my_teams}


@api_router.get("/fantasy/points-rules")
async def fantasy_points_rules(user=Depends(get_current_user)):
    return {"rules": POINTS_RULES, "team_size": TEAM_SIZE, "credit_budget": CREDIT_BUDGET,
            "role_limits": ROLE_LIMITS, "max_per_side": MAX_PER_SIDE}


@api_router.post("/fantasy/teams")
async def create_fantasy_team(body: TeamCreate, user=Depends(get_current_user)):
    if user["role"] == "admin":
        raise HTTPException(status_code=400, detail="Admin cannot create fantasy teams")
    match = await get_match_or_404(body.match_id)
    if match_locked(match):
        raise HTTPException(status_code=400, detail="Match has started — teams are locked")
    players = await get_match_players(match["id"])
    if len(players) < 2 * TEAM_SIZE:
        raise HTTPException(status_code=400, detail="Squads for this match are not announced yet")
    players_by_id = {p["id"]: p for p in players}
    summary = validate_team(players_by_id, body.player_ids, body.captain_id, body.vice_captain_id)

    mine = await db.fantasy_teams.count_documents({"match_id": match["id"], "user_id": user["id"]})
    if mine >= 20:
        raise HTTPException(status_code=400, detail="You can save up to 20 teams per match")

    doc = {
        "id": str(uuid.uuid4()),
        "match_id": match["id"],
        "match_label": f"{match['team_a_short']} vs {match['team_b_short']}",
        "user_id": user["id"],
        "user_name": user["name"],
        "name": (body.name or f"Team {mine + 1}").strip()[:30],
        "player_ids": list(body.player_ids),
        "captain_id": body.captain_id,
        "vice_captain_id": body.vice_captain_id,
        "credits_used": summary["credits_used"],
        "by_role": summary["by_role"],
        "per_team": summary["per_team"],
        "created_at": now_iso(),
    }
    await db.fantasy_teams.insert_one(doc)
    doc.pop("_id", None)
    doc["players"] = [players_by_id[pid] for pid in doc["player_ids"]]
    return doc


@api_router.get("/fantasy/teams/mine")
async def my_fantasy_teams(match_id: Optional[str] = None, user=Depends(get_current_user)):
    q = {"user_id": user["id"]}
    if match_id:
        q["match_id"] = match_id
    teams = await db.fantasy_teams.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)
    ids = {pid for t in teams for pid in t.get("player_ids", [])}
    players = await db.players.find({"id": {"$in": list(ids)}}, {"_id": 0}).to_list(500) if ids else []
    by_id = {p["id"]: p for p in players}
    for t in teams:
        t["players"] = [by_id.get(pid) for pid in t.get("player_ids", [])]
        t["captain"] = by_id.get(t.get("captain_id"))
        t["vice_captain"] = by_id.get(t.get("vice_captain_id"))
    return teams


@api_router.patch("/fantasy/teams/{team_id}")
async def update_fantasy_team(team_id: str, body: TeamUpdate, user=Depends(get_current_user)):
    team = await db.fantasy_teams.find_one({"id": team_id, "user_id": user["id"]}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    match = await get_match_or_404(team["match_id"])
    if match_locked(match):
        raise HTTPException(status_code=400, detail="Match has started — teams are locked")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    player_ids = updates.get("player_ids", team["player_ids"])
    captain_id = updates.get("captain_id", team["captain_id"])
    vice_captain_id = updates.get("vice_captain_id", team["vice_captain_id"])
    players_by_id = {p["id"]: p for p in await get_match_players(match["id"])}
    summary = validate_team(players_by_id, player_ids, captain_id, vice_captain_id)

    if updates.get("player_ids"):
        joined = await db.entries.count_documents({"team_id": team_id, "status": {"$in": ["pending", "approved", "won"]}})
        if joined:
            raise HTTPException(status_code=400, detail="This team is already in a contest — create a new team instead")

    updates.update({
        "player_ids": list(player_ids),
        "captain_id": captain_id,
        "vice_captain_id": vice_captain_id,
        "credits_used": summary["credits_used"],
        "by_role": summary["by_role"],
        "per_team": summary["per_team"],
        "updated_at": now_iso(),
    })
    if "name" in updates:
        updates["name"] = str(updates["name"]).strip()[:30] or team.get("name")
    await db.fantasy_teams.update_one({"id": team_id}, {"$set": updates})
    fresh = await db.fantasy_teams.find_one({"id": team_id}, {"_id": 0})
    fresh["players"] = [players_by_id[pid] for pid in fresh["player_ids"]]
    return fresh


@api_router.delete("/fantasy/teams/{team_id}")
async def delete_fantasy_team(team_id: str, user=Depends(get_current_user)):
    team = await db.fantasy_teams.find_one({"id": team_id, "user_id": user["id"]}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    joined = await db.entries.count_documents({"team_id": team_id, "status": {"$in": ["pending", "approved", "won"]}})
    if joined:
        raise HTTPException(status_code=400, detail="This team is already in a contest")
    match = await get_match_or_404(team["match_id"])
    if match_locked(match):
        raise HTTPException(status_code=400, detail="Match has started — teams are locked")
    await db.fantasy_teams.delete_one({"id": team_id})
    return {"ok": True}


@api_router.get("/fantasy/contests/{contest_id}/leaderboard")
async def fantasy_leaderboard(contest_id: str, user=Depends(get_current_user)):
    contest = await db.contests.find_one({"id": contest_id}, {"_id": 0})
    if not contest or contest.get("kind") != "fantasy":
        raise HTTPException(status_code=404, detail="Fantasy contest not found")
    entries = await db.entries.find(
        {"contest_id": contest_id, "status": {"$in": ["approved", "won"]}}, {"_id": 0}
    ).to_list(5000)
    settled = bool(contest.get("settled_at"))
    if settled:
        rows = [{
            "entry_id": e["id"], "user_id": e["user_id"], "user_name": e.get("user_name"),
            "team_id": e.get("team_id"), "team_name": e.get("team_name"),
            "points": e.get("fantasy_points", 0), "rank": e.get("fantasy_rank", 0),
            "prize": e.get("winner_prize", 0) if e.get("status") == "won" else 0,
            "entry_status": e.get("status"),
        } for e in entries]
        rows.sort(key=lambda r: (r["rank"] or 9999, -r["points"]))
    else:
        rows = await build_leaderboard(contest, entries)
    mine = user["role"] == "admin"
    if settled:
        # Final standings store only the totals; recompute each XI breakdown for the per-team view.
        scores = await db.player_scores.find({"match_id": contest.get("match_id")},
                                            {"_id": 0, "player_id": 1, "points": 1, "components": 1}).to_list(300)
        player_points = {s["player_id"]: {"total": s.get("points", 0), "components": s.get("components") or {}}
                         for s in scores}
        names = {p["id"]: p for p in await get_match_players(contest.get("match_id"))}
        teams_by_id = {t["id"]: t for t in await db.fantasy_teams.find({"match_id": contest.get("match_id")}, {"_id": 0}).to_list(2000)}
        for r in rows:
            team = teams_by_id.get(r.get("team_id"))
            r["breakdown"] = team_points(player_points, team, names)["rows"] if team else []
    for r in rows:
        is_me = r["user_id"] == user["id"]
        r["is_me"] = is_me
        prev = r.get("rank_prev")
        r["rank_delta"] = (prev - r["rank"]) if (prev and r.get("rank")) else 0
        if not (is_me or mine or settled):
            r.pop("breakdown", None)
        if not is_me and not mine:
            r["team_id"] = None
    match = await db.matches.find_one({"id": contest.get("match_id")}, {"_id": 0}) or {}
    return {
        "contest": {"id": contest["id"], "title": contest.get("title"), "entry_fee": contest.get("entry_fee"),
                    "prize_pool": contest.get("prize_pool"), "prize_breakdown": contest.get("prize_breakdown") or [],
                    "status": contest.get("status"), "settled_at": contest.get("settled_at"),
                    "participants_count": len(rows), "live_entries": contest.get("live_entries") or len(rows),
                    "live_top_points": contest.get("live_top_points"), "live_ranked_at": contest.get("live_ranked_at")},
        "match": {"id": match.get("id"), "team_a_short": match.get("team_a_short"), "team_b_short": match.get("team_b_short"),
                  "team_a_name": match.get("team_a_name"), "team_b_name": match.get("team_b_name"),
                  "status": match.get("status"), "start_time": match.get("start_time"), "locked": match_locked(match) if match else False},
        "scorecard_entered": bool(match.get("scorecard_entered")),
        "leaderboard": rows,
    }


# ---------- External live scores (CricAPI / CricketData.org) ----------
CRICAPI_KEY_ENV = os.environ.get("CRICAPI_KEY", "").strip()
CRICAPI_BASE = (os.environ.get("CRICAPI_BASE") or "https://api.cricapi.com/v1").rstrip("/")


async def get_score_settings() -> dict:
    """Live-score provider config. The key may come from the admin panel or CRICAPI_KEY env."""
    s = await db.settings.find_one({"key": "scores"}, {"_id": 0}) or {}
    admin_key = (s.get("cricapi_key") or "").strip()
    return {
        "provider": s.get("provider") or "cricapi",
        "admin_key_set": bool(admin_key),
        "env_key_set": bool(CRICAPI_KEY_ENV),
        "key_present": bool(admin_key or CRICAPI_KEY_ENV),
        "enabled": bool(s.get("enabled", True)),
        "base_url": CRICAPI_BASE,
    }


async def score_api_key() -> str:
    s = await get_score_settings()
    if not s["enabled"]:
        raise HTTPException(status_code=400, detail="Live-score import is switched off in settings")
    key = await db.settings.find_one({"key": "scores"}, {"_id": 0}) or {}
    return (key.get("cricapi_key") or "").strip() or CRICAPI_KEY_ENV


def cric_call(endpoint: str, params: dict, api_key: str) -> dict:
    q = dict(params or {})
    q["apikey"] = api_key
    try:
        resp = requests.get(f"{CRICAPI_BASE}/{endpoint}", params=q, timeout=30,
                            headers={"User-Agent": "PitchPlay/1.0"})
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Could not reach the score service: {e}")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Score service returned HTTP {resp.status_code}")
    try:
        data = resp.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Score service returned a non-JSON response")
    if isinstance(data, dict) and data.get("status") not in (None, "success"):
        raise HTTPException(status_code=400, detail=f"Score service: {data.get('reason') or data.get('status')}")
    return data


def _num(v, default=0.0) -> float:
    if v is None:
        return default
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    if s in ("", "-", "null", "None", "N/A"):
        return default
    try:
        return float(s.split(" ")[0])
    except ValueError:
        return default


def overs_to_balls(v) -> int:
    """CricAPI reports overs as '4.2' (4 overs 2 balls)."""
    f = _num(v)
    whole = int(f)
    frac = int(round((f - whole) * 10))
    return whole * 6 + min(max(frac, 0), 5)


NOT_OUT_WORDS = ("not out", "did not bat", "unused sub", "did not bowl", "dnb", "batting")
BOWLER_TAIL_RE = re.compile(r"\bb\s+(.+?)\s*$")
LBW_RE = re.compile(r"\blbw\b")


def _player_name(ref) -> str:
    if isinstance(ref, dict):
        return str(ref.get("name") or ref.get("playerName") or "").strip()
    return str(ref or "").strip()


def bowled_lbw_bowler(b: dict) -> str:
    """Bowler credited with a bowled/LBW dismissal (Dream11 pays a +8 bonus for these).

    Caught ("c Fielder b Bowler") deliberately does NOT count — only bowled and lbw do.
    """
    d = b.get("dismissal")
    text = str(b.get("dismissalText") or (d if isinstance(d, str) else "") or "").strip().lower()
    kind = str(d.get("type") or d.get("text") or "").strip().lower() if isinstance(d, dict) else ""
    is_bowled = kind in ("b", "bowled", "lbw", "lbw b") or bool(re.match(r"^b[\s.]", text)) or bool(LBW_RE.search(text))
    if not is_bowled:
        return ""
    if isinstance(d, dict):
        named = _player_name(d.get("bowler"))
        if named:
            return named
    m = BOWLER_TAIL_RE.search(text)
    return m.group(1).strip() if m else ""


def _norm_name(n: str) -> str:
    keep = "".join(ch.lower() if ch.isalnum() else " " for ch in (n or ""))
    return " ".join(keep.split())


def _name_score(a: str, b: str) -> float:
    """Similarity between a provider name and a squad name (handles 'K Rabada' vs 'Kagiso Rabada')."""
    na, nb = _norm_name(a), _norm_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    ta, tb = na.split(), nb.split()
    if ta[-1] == tb[-1]:  # same surname
        rest_a, rest_b = ta[:-1], tb[:-1]
        if not rest_a or not rest_b:
            return 0.85

        def align(short_, long_):
            return all(any(s == t or (len(s) == 1 and t.startswith(s)) for t in long_) for s in short_)

        if align(rest_a, rest_b) or align(rest_b, rest_a):
            return 0.9
    jaccard = len(set(ta) & set(tb)) / len(set(ta) | set(tb))
    if (len(ta) == 1 and ta[0] in tb) or (len(tb) == 1 and tb[0] in ta):
        return max(jaccard, 0.8)
    if len(na) >= 3 and (na in nb or nb in na):
        return 0.85
    return jaccard


def merge_cric_payload(data: dict) -> dict:
    """Flatten either CricAPI shape (per-innings `scorecard` list, or the fantasy
    `batting`/`bowling`/`fielding` arrays) into one stats map keyed by player name."""
    acc: dict = {}

    def slot(name):
        key = _norm_name(name)
        if key not in acc:
            acc[key] = {"name": name.strip(), "runs": 0, "balls": 0, "fours": 0, "sixes": 0, "out": False,
                        "balls_bowled": 0, "runs_conceded": 0, "wickets": 0, "maidens": 0, "bowled_or_lbw": 0,
                        "catches": 0, "stumpings": 0, "run_out_direct": 0, "run_out_thrower": 0, "played": False}
        return acc[key]

    innings = data.get("scorecard")
    if isinstance(innings, list) and innings and isinstance(innings[0], dict) and ("batting" in innings[0] or "bowling" in innings[0]):
        for inns in innings:
            for b in inns.get("batting") or []:
                name = _player_name(b.get("batsman") or b.get("player") or b.get("name"))
                if not name:
                    continue
                row = slot(name)
                row["played"] = True
                row["runs"] += int(_num(b.get("runs")))
                row["balls"] += int(_num(b.get("balls")))
                row["fours"] += int(_num(b.get("fours") or b.get("4s")))
                row["sixes"] += int(_num(b.get("sixes") or b.get("6s")))
                disc = b.get("dismissalText") or b.get("dismissal") or b.get("out") or ""
                disc_l = str(disc).lower()
                row["out"] = row["out"] or bool(disc_l) and "not out" not in disc_l and "did not" not in disc_l
                bowler = bowled_lbw_bowler(b)
                if bowler:
                    slot(bowler)["bowled_or_lbw"] += 1
            for x in inns.get("bowling") or []:
                name = _player_name(x.get("bowler") or x.get("player") or x.get("name"))
                if not name:
                    continue
                row = slot(name)
                row["played"] = True
                row["balls_bowled"] += overs_to_balls(x.get("overs"))
                row["runs_conceded"] += int(_num(x.get("runs") or x.get("conceded")))
                row["wickets"] += int(_num(x.get("wickets")))
                row["maidens"] += int(_num(x.get("maidens")))
            for c in inns.get("catches") or []:
                name = _player_name(c.get("catchman") or c.get("player") or c.get("name"))
                if name:
                    row = slot(name)
                    row["played"] = True
                    row["catches"] += 1
            for st in inns.get("stumping") or inns.get("stumpings") or []:
                name = _player_name(st.get("stumper") or st.get("player") or st.get("name"))
                if name:
                    row = slot(name)
                    row["played"] = True
                    row["stumpings"] += 1
            for ro in inns.get("runOuts") or inns.get("runouts") or []:
                who = ro.get("fielder") or ro.get("catcher") or ro.get("player") or ro.get("name")
                name = _player_name(who)
                if not name:
                    continue
                row = slot(name)
                kind = str(ro.get("type") or ro.get("dismissal") or "").lower()
                if "direct" in kind:
                    row["run_out_direct"] += 1
                else:
                    row["run_out_thrower"] += 1
        return acc

    bat = data.get("batting")
    if isinstance(bat, list):
        for b in bat:
            name = _player_name(b.get("playerName") or b.get("player") or b.get("name"))
            if not name:
                continue
            row = slot(name)
            row["played"] = True
            row["runs"] += int(_num(b.get("runs")))
            row["balls"] += int(_num(b.get("balls")))
            row["fours"] += int(_num(b.get("fours") or b.get("4s")))
            row["sixes"] += int(_num(b.get("sixes") or b.get("6s")))
            disc = str(b.get("dismissal") or b.get("dismissalText") or "").lower()
            row["out"] = bool(disc) and "not out" not in disc and "did not" not in disc
    bowl = data.get("bowling")
    if isinstance(bowl, list):
        for x in bowl:
            name = _player_name(x.get("playerName") or x.get("player") or x.get("name"))
            if not name:
                continue
            row = slot(name)
            row["played"] = True
            row["balls_bowled"] += overs_to_balls(x.get("overs"))
            row["runs_conceded"] += int(_num(x.get("runs") or x.get("conceded")))
            row["wickets"] += int(_num(x.get("wickets")))
            row["maidens"] += int(_num(x.get("maidens")))
            row["bowled_or_lbw"] += int(_num(x.get("bowled") or x.get("bowledOrLbw") or 0))
    field = data.get("fielding")
    if isinstance(field, list):
        for f in field:
            name = _player_name(f.get("playerName") or f.get("player") or f.get("name"))
            if not name:
                continue
            row = slot(name)
            row["played"] = True
            row["catches"] += int(_num(f.get("catches") or f.get("catch")))
            row["stumpings"] += int(_num(f.get("stumpings") or f.get("stumping")))
            row["run_out_direct"] += int(_num(f.get("runOutsDirect") or f.get("runouts_direct") or 0))
            row["run_out_thrower"] += int(_num(f.get("runOuts") or f.get("runouts") or 0))
    return acc


def map_stats_to_squad(stats: dict, squad: list) -> tuple:
    """Attach provider player names to our squad player ids."""
    lines, matched, unmatched = [], [], []
    for key, s in stats.items():
        name = str(s.get("name") or key).strip()  # provider's original spelling for display
        best, best_score = None, 0.0
        for p in squad:
            sc = _name_score(key, p["name"])
            if sc > best_score:
                best, best_score = p, sc
        if best and best_score >= 0.75:
            lines.append({
                "player_id": best["id"], "squad_name": best["name"], "source_name": name,
                "confidence": round(best_score, 2), "played": bool(s.get("played")),
                "runs": s["runs"], "balls": s["balls"], "fours": s["fours"], "sixes": s["sixes"], "out": s["out"],
                "balls_bowled": s["balls_bowled"], "runs_conceded": s["runs_conceded"], "wickets": s["wickets"],
                "maidens": s["maidens"], "bowled_or_lbw": s["bowled_or_lbw"], "catches": s["catches"],
                "stumpings": s["stumpings"], "run_out_direct": s["run_out_direct"], "run_out_thrower": s["run_out_thrower"],
            })
            matched.append({"source_name": name.strip(), "player": best["name"], "confidence": round(best_score, 2)})
        else:
            unmatched.append({"source_name": name.strip(), "best_guess": best["name"] if best else None,
                             "confidence": round(best_score, 2)})
    covered = {l["player_id"] for l in lines}
    missing = [{"player_id": p["id"], "player": p["name"], "team": p["team"], "role": p["role"]}
               for p in squad if p["id"] not in covered]
    lines.sort(key=lambda l: (_norm_name(l["squad_name"])))
    return lines, unmatched, missing


class ScoreConfigBody(BaseModel):
    cricapi_key: Optional[str] = None
    enabled: Optional[bool] = None
    provider: Optional[str] = None


class ScoreImportBody(BaseModel):
    external_id: str = Field(min_length=1, max_length=60)
    feed: str = "scorecard"  # "scorecard" | "fantasy"


@api_router.get("/admin/scores/config")
async def admin_scores_config(admin=Depends(require_admin)):
    s = await get_score_settings()
    s["has_live_matches"] = s["key_present"] and s["enabled"]
    return s


@api_router.put("/admin/scores/config")
async def admin_scores_put(body: ScoreConfigBody, admin=Depends(require_admin)):
    doc = {"key": "scores", "updated_at": now_iso()}
    if body.cricapi_key is not None:
        doc["cricapi_key"] = body.cricapi_key.strip()
    if body.enabled is not None:
        doc["enabled"] = bool(body.enabled)
    if body.provider:
        doc["provider"] = body.provider.strip().lower()
    await db.settings.update_one({"key": "scores"}, {"$set": doc}, upsert=True)
    return await get_score_settings()


@api_router.delete("/admin/scores/config/key")
async def admin_scores_clear_key(admin=Depends(require_admin)):
    await db.settings.update_one({"key": "scores"}, {"$unset": {"cricapi_key": ""}})
    return await get_score_settings()


@api_router.get("/admin/scores/live")
async def admin_scores_live(admin=Depends(require_admin)):
    """Current matches from the provider, so the admin can copy the right id."""
    key = await score_api_key()
    data = cric_call("current_matches", {}, key)
    out = []
    for m in data.get("data") or []:
        out.append({
            "external_id": m.get("unique_id") or m.get("id"),
            "name": m.get("name") or " · ".join([str(m.get("team1") or ""), str(m.get("team2") or "")]).strip(" ·"),
            "status": m.get("status") or m.get("state") or "",
            "venue": m.get("venue") or "",
            "start": m.get("startDate") or m.get("matchStarted") or "",
            "series": m.get("seriesName") or "",
        })
    return {"count": len(out), "matches": out}


@api_router.post("/admin/matches/{match_id}/import-scorecard")
async def admin_import_scorecard(match_id: str, body: ScoreImportBody, admin=Depends(require_admin)):
    """Preview a provider scorecard mapped onto our squad. Nothing is saved here."""
    match = await get_match_or_404(match_id)
    key = await score_api_key()
    feed = (body.feed or "scorecard").strip().lower()
    if feed not in ("scorecard", "fantasy"):
        raise HTTPException(status_code=400, detail="Feed must be 'scorecard' or 'fantasy'")
    data = cric_call(feed, {"id": body.external_id, "unique_id": body.external_id}, key)
    payload = data.get("data") if isinstance(data.get("data"), dict) else data
    stats = merge_cric_payload(payload or {})
    if not stats:
        raise HTTPException(status_code=400, detail="That match has no player scorecard yet on the score service")
    squad = await get_match_players(match_id)
    lines, unmatched, missing = map_stats_to_squad(stats, squad)
    info = payload.get("info") or {}
    return {
        "external_id": body.external_id,
        "feed": feed,
        "match_title": info.get("matchInfo", {}).get("name") or info.get("name") or payload.get("name") or "",
        "status": (info.get("status") or payload.get("status") or ""),
        "players_found": len(stats),
        "lines": lines,
        "unmatched": unmatched,
        "squad_without_stats": missing,
    }


# ---------- Live match centre ----------
LIVE_STALE_SECONDS = 45  # the in-app ticker re-pulls the provider at most this often
LIVE_EVENT_LIMIT = 90    # balls kept for the ticker


def _resolve_player(name: str, squad: list) -> tuple:
    """Map a provider spelling onto our squad. Returns (player_id or None, display name, team, role)."""
    best, best_score = None, 0.0
    for p in squad:
        sc = _name_score(name, p["name"])
        if sc > best_score:
            best, best_score = p, sc
    if best and best_score >= 0.75:
        return best["id"], best["name"], best.get("team"), best.get("role")
    return None, str(name or "").strip(), None, None


def _event_row(item, squad: list) -> Optional[dict]:
    """One ball, whatever shape the provider used. Returns None when nothing is usable."""
    if isinstance(item, str):
        text = item.strip()
        if not text:
            return None
        # many providers send bare strings like "4 Rohit Sharma b Bumrah" or "WIDE, 2 runs"
        lead = re.match(r"^\s*(\d+)\b", text)
        item = {"text": text, "runs": lead.group(1) if lead else None}
    if not isinstance(item, dict):
        return None
    text = str(item.get("text") or item.get("long_text") or item.get("description") or
               item.get("ball_text") or item.get("event") or "").strip()
    batter_raw = item.get("batsman") or item.get("batter") or item.get("striker") or ""
    bowler_raw = item.get("bowler") or item.get("bowlerName") or ""
    if isinstance(batter_raw, dict):
        batter_raw = batter_raw.get("name") or batter_raw.get("player") or ""
    if isinstance(bowler_raw, dict):
        bowler_raw = bowler_raw.get("name") or bowler_raw.get("player") or ""
    runs = item.get("runs")
    if runs is None:
        runs = item.get("score") or item.get("shot_runs")
    wicket = item.get("wicket")
    if isinstance(wicket, str):
        wicket = wicket.strip().lower() not in ("", "no", "false", "0")
    kind = str(item.get("kind") or item.get("type") or item.get("event_type") or "").strip().lower()
    over = item.get("over")
    if isinstance(over, dict):
        over = over.get("number") or over.get("over")
    ball = item.get("ball")
    if isinstance(ball, dict):
        ball = ball.get("number") or ball.get("ball")
    if not text and batter_raw is None and bowler_raw is None and runs is None and not wicket:
        return None
    b_id, b_name, team, _role = _resolve_player(batter_raw or "", squad)
    if not b_name and text:  # the ticker text is the only clue — guess the side from the bowler
        _x, _y, team, _z = _resolve_player(bowler_raw or "", squad)
        if team:
            team = {"IND": "AUS"}.get(team) or team
    p_id, p_name, _pt, _pr = _resolve_player(bowler_raw or "", squad)
    try:
        runs_n = int(_num(runs))
    except (TypeError, ValueError):
        runs_n = 0
    low = text.lower()
    boundary = runs_n >= 4 or "four" in low or "six" in low
    return {
        "over": str(over if over is not None else "").strip(),
        "ball": str(ball if ball is not None else "").strip(),
        "text": text or (f"{b_name} {runs_n} run{'s' if runs_n != 1 else ''}" if runs_n else ""),
        "runs": runs_n,
        "wicket": bool(wicket) or "out" in kind or "wicket" in kind or bool(re.search(r"\b(out|b |c |lbw|st |run ?out)\b", low)),
        "boundary": bool(boundary) or bool(kind in ("four", "six", "boundary", "6", "4")),
        "kind": kind or ("wicket" if wicket else ("boundary" if boundary else "run")),
        "batter": b_name or None, "batter_id": b_id,
        "bowler": p_name or None, "bowler_id": p_id,
        "team": team, "inning": str(item.get("inns") or item.get("innings") or "").strip(),
    }


def extract_live_events(payload: dict, squad: list) -> list:
    """Normalise the first ball-by-ball shape the provider actually filled in."""
    candidates = [
        payload.get("ball_by_ball"),
        (payload.get("info") or {}).get("ball_by_ball"),
        payload.get("events"),
        (payload.get("data") or {}).get("events") if isinstance(payload.get("data"), dict) else None,
    ]
    raw = next((c for c in candidates if isinstance(c, list) and c), [])
    rows = [r for r in (_event_row(item, squad) for item in raw) if r]
    return rows[-LIVE_EVENT_LIMIT:]


async def fetch_live_events(external_id: str, api_key: str, squad: list) -> list:
    """Ball-by-ball is a separate provider call. If it is missing we simply have no ticker."""
    for endpoint, params in (("match_bball", {"match_id": external_id}),
                             ("ballbyball", {"id": external_id, "unique_id": external_id})):
        try:
            data = await asyncio.to_thread(cric_call, endpoint, params, api_key)
        except HTTPException:
            continue
        body = data.get("data") if "data" in data else data
        if isinstance(body, dict):
            body = body.get("ball_by_ball") or body.get("events") or body.get("data") or []
        rows = extract_live_events({"ball_by_ball": body if isinstance(body, list) else []}, squad)
        if rows:
            return rows
    return []


def _sr(runs, balls) -> float:
    return round(100.0 * float(runs) / float(balls), 1) if balls else 0.0


def _econ(runs, balls) -> float:
    return round(float(runs) * 6.0 / float(balls), 2) if balls else 0.0


def innings_tables(payload: dict, lines: list, squad: list, innings: list) -> list:
    """Per-innings batting/bowling tables.

    Prefers the provider's own per-innings structure; falls back to the squad-mapped
    stat lines we already trust, so the table works on the fantasy feed too.
    """
    raw = payload.get("scorecard")
    tables = []
    if isinstance(raw, list) and raw and isinstance(raw[0], dict) and ("batting" in raw[0] or "bowling" in raw[0]):
        for inns in raw:
            label = str(inns.get("inns") or inns.get("name") or inns.get("innings") or "").strip()
            bats, bowls = [], []
            for b in inns.get("batting") or []:
                name = _player_name(b.get("batsman") or b.get("player") or b.get("name"))
                if not name:
                    continue
                pid, disp, team, role = _resolve_player(name, squad)
                r, bl = int(_num(b.get("runs"))), int(_num(b.get("balls")))
                disc = str(b.get("dismissalText") or b.get("dismissal") or "")
                if isinstance(b.get("dismissal"), dict):
                    disc = str(b["dismissal"].get("text") or "")
                bats.append({"player_id": pid, "name": disp, "team": team, "role": role, "runs": r, "balls": bl,
                             "fours": int(_num(b.get("fours") or b.get("4s"))), "sixes": int(_num(b.get("sixes") or b.get("6s"))),
                             "strike_rate": _sr(r, bl), "out": bool(disc) and "not out" not in disc.lower(),
                             "dismissal": disc.strip() or None})
            for x in inns.get("bowling") or []:
                name = _player_name(x.get("bowler") or x.get("player") or x.get("name"))
                if not name:
                    continue
                pid, disp, team, role = _resolve_player(name, squad)
                ov = x.get("overs")
                bl = overs_to_balls(ov)
                rn, wk = int(_num(x.get("runs") or x.get("conceded"))), int(_num(x.get("wickets")))
                bowls.append({"player_id": pid, "name": disp, "team": team, "role": role, "overs": str(ov or ""),
                              "runs": rn, "wickets": wk, "maidens": int(_num(x.get("maidens"))),
                              "economy": _econ(rn, bl)})
            tables.append({"innings": label, "batting": bats, "bowling": bowls})
        return tables

    by_id = {p["id"]: p for p in squad}
    sides: dict = {}
    for line in lines:
        p = by_id.get(line.get("player_id"))
        if not p:
            continue
        side = sides.setdefault(p["team"], {"batting": [], "bowling": []})
        r, bl = int(line.get("runs") or 0), int(line.get("balls") or 0)
        if r or bl or (line.get("played") and p.get("role") != "BOWL"):
            side["batting"].append({"player_id": p["id"], "name": p["name"], "team": p["team"], "role": p.get("role"),
                                    "runs": r, "balls": bl, "fours": int(line.get("fours") or 0),
                                    "sixes": int(line.get("sixes") or 0), "strike_rate": _sr(r, bl),
                                    "out": bool(line.get("out")), "dismissal": None})
        bb, rc, wk = int(line.get("balls_bowled") or 0), int(line.get("runs_conceded") or 0), int(line.get("wickets") or 0)
        if bb or wk:
            side["bowling"].append({"player_id": p["id"], "name": p["name"], "team": p["team"], "role": p.get("role"),
                                   "overs": f"{bb // 6}.{bb % 6}", "runs": rc, "wickets": wk,
                                   "maidens": int(line.get("maidens") or 0), "economy": _econ(rc, bb)})
    for row in innings or []:
        label = str(row.get("innings") or "").strip()
        short = next((s for s in sides if s and s.lower()[:3] in label.lower()), None)
        if short and sides[short]:
            tables.append({"innings": label, **sides.pop(short)})
    for team, side in sides.items():
        if side["batting"] or side["bowling"]:
            tables.append({"innings": f"{team} innings", **side})
    for t in tables:
        t["batting"].sort(key=lambda b: -b["runs"])
        t["bowling"].sort(key=lambda b: (-b["wickets"], b["economy"]))
    return tables


def run_rate_series(events: list, innings: list) -> list:
    """Cumulative runs/wickets per over for the graph — from the ticker when we have one."""
    pts, acc_r, acc_w = [], 0, 0
    for ev in events:
        raw_over = ev.get("over")
        if raw_over is None or str(raw_over).strip() == "":
            continue
        try:
            ov = int(str(raw_over).split(".")[0])
        except (TypeError, ValueError):
            continue
        if ov < 0:
            continue
        acc_r += int(ev.get("runs") or 0)
        acc_w += 1 if ev.get("wicket") else 0
        while len(pts) <= ov:
            pts.append({"over": len(pts), "runs": acc_r, "wickets": acc_w})
        if pts[ov]["runs"] < acc_r or pts[ov]["wickets"] < acc_w:
            pts[ov] = {"over": ov, "runs": acc_r, "wickets": acc_w}
    if len(pts) > 1:
        return [{"over": p["over"], "runs": p["runs"], "wickets": p["wickets"]} for p in pts]
    out, cum_r, cum_w = [], 0, 0
    for row in innings or []:
        o = _num(row.get("overs"))
        cum_r += int(row.get("runs") or 0)
        cum_w += int(row.get("wickets") or 0)
        for each in range(1, int(o) + 1):
            out.append({"over": each, "runs": round(cum_r * each / max(o, 1)), "wickets": cum_w})
    return out



async def _live_doc(match_id: str) -> dict:
    return await db.match_live.find_one({"match_id": match_id}, {"_id": 0}) or {}


async def fetch_live_ticker(external_id: str, api_key: str) -> tuple:
    """Best-effort scoreboard rows from the provider's live-matches feed (never raises)."""
    try:
        data = await asyncio.to_thread(cric_call, "current_matches", {}, api_key)
    except HTTPException:
        return [], "", ""
    for m in data.get("data") or []:
        if not isinstance(m, dict):
            continue
        if external_id not in (str(m.get("unique_id") or ""), str(m.get("id") or "")):
            continue
        rows = []
        for s in m.get("score") or []:
            if not isinstance(s, dict):
                continue
            rows.append({
                "innings": str(s.get("inns") or s.get("name") or "").strip(),
                "runs": int(_num(s.get("r"))),
                "wickets": int(_num(s.get("w"))),
                "overs": str(s.get("o") or "").strip(),
            })
        return rows, str(m.get("status") or "").strip(), str(m.get("venue") or "").strip()
    return [], "", ""


async def fetch_live_snapshot(match: dict, feed: Optional[str] = None) -> dict:
    """Pull the provider's view of a match and map it onto our squad."""
    external_id = (match.get("external_id") or "").strip()
    if not external_id:
        raise HTTPException(status_code=400, detail="Set the score-service match id on this match first")
    api_key = await score_api_key()
    use_feed = (feed or match.get("live_feed") or "scorecard").strip().lower()
    if use_feed not in ("scorecard", "fantasy"):
        raise HTTPException(status_code=400, detail="Live feed must be 'scorecard' or 'fantasy'")
    data = await asyncio.to_thread(cric_call, use_feed, {"id": external_id, "unique_id": external_id}, api_key)
    payload = data.get("data") if isinstance(data.get("data"), dict) else data
    payload = payload or {}
    stats = merge_cric_payload(payload)
    info = payload.get("info") or {}
    status_text = str(info.get("status") or payload.get("status") or "").strip()
    venue = str(info.get("venue") or payload.get("venue") or "").strip()
    innings, ticker_status, ticker_venue = await fetch_live_ticker(external_id, api_key)
    # The live list is fresher than a stored scorecard's status line.
    status_text = ticker_status or status_text
    venue = venue or ticker_venue
    squad = await get_match_players(match["id"])
    lines, unmatched, missing = ([], [], [])
    if stats:
        lines, unmatched, missing = map_stats_to_squad(stats, squad)
    events = await fetch_live_events(external_id, api_key, squad)
    tables = innings_tables(payload, lines, squad, innings)
    return {
        "match_id": match["id"],
        "external_id": external_id,
        "feed": use_feed,
        "status_text": status_text,
        "venue": venue,
        "innings": innings,
        "events": events,
        "tables": tables,
        "run_rate": run_rate_series(events, innings),
        "players_found": len(stats),
        "lines": lines,
        "unmatched": unmatched,
        "squad_without_stats": missing,
        "fetched_at": now_iso(),
    }


async def write_live_scores(match: dict, lines: list, admin_id: str) -> int:
    """Store partial player stats + points so leaderboards move while the match runs."""
    players = {p["id"]: p for p in await get_match_players(match["id"])}
    written = 0
    for line in lines:
        player = players.get(line.get("player_id"))
        if not player:
            continue
        stats = {k: v for k, v in line.items()
                 if k in PlayerScoreIn.model_fields and k != "player_id"}
        try:
            score_in = PlayerScoreIn(player_id=player["id"], **stats)
        except Exception:
            continue
        pts = compute_player_points(score_in, player.get("role", "BAT"), playing_xi=bool(player.get("playing", True)))
        await db.player_scores.update_one(
            {"match_id": match["id"], "player_id": player["id"]},
            {"$set": {
                "match_id": match["id"], "player_id": player["id"], "player_name": player["name"],
                "team": player["team"], "role": player["role"],
                "stats": score_in.model_dump(exclude={"player_id"}),
                "points": pts["total"], "components": pts.get("components", {}),
                "did_not_play": bool(pts.get("did_not_play")),
                "live": True, "partial": not match.get("scorecard_entered"),
                "updated_at": now_iso(), "updated_by": admin_id,
            }},
            upsert=True,
        )
        written += 1
    return written


async def refresh_live_boards(match_id: str) -> dict:
    """Re-rank every fantasy contest of a match without touching money."""
    contests = await db.contests.find({"match_id": match_id, "kind": "fantasy"}, {"_id": 0}).to_list(200)
    ranked = 0
    for c in contests:
        entries = await db.entries.find(
            {"contest_id": c["id"], "status": {"$in": ["approved", "won"]}}, {"_id": 0}
        ).to_list(5000)
        if not entries:
            continue
        rows = await build_leaderboard(c, entries)
        for row in rows:
            before = next((e.get("fantasy_rank") for e in entries if e["id"] == row["entry_id"]), None)
            upd = {"fantasy_points": row["points"], "fantasy_rank": row["rank"],
                   "live_rank_at": now_iso(), "live_entries": len(entries)}
            if before and before != row["rank"]:
                # only shift the "previous rank" when it actually moved, so arrows mean something
                upd["fantasy_rank_prev"] = before
            await db.entries.update_one({"id": row["entry_id"]}, {"$set": upd})
            ranked += 1
        await db.contests.update_one({"id": c["id"]}, {"$set": {
            "live_ranked_at": now_iso(), "live_entries": len(entries),
            "live_top_points": rows[0]["points"] if rows else 0,
        }})
    return {"contests": len(contests), "entries_ranked": ranked}


def public_live_view(match: dict, doc: dict) -> dict:
    """What the in-app live screen shows — ticker plus our own points, never raw provider data."""
    innings = doc.get("innings", [])
    events = doc.get("events", [])
    tables = doc.get("tables", [])
    return {
        "available": bool(doc),
        "match_id": match["id"],
        "match": f"{match.get('team_a_short', '')} vs {match.get('team_b_short', '')}",
        "status": match.get("status"),
        "locked": match_locked(match),
        "status_text": doc.get("status_text", ""),
        "venue": doc.get("venue", ""),
        "innings": innings,
        "current": innings[-1] if innings else None,
        "events": events,
        "last_events": events[-18:],
        "tables": tables,
        "run_rate": doc.get("run_rate", []),
        "feed": doc.get("feed", ""),
        "auto_live": bool(match.get("auto_live")),
        "updated_at": doc.get("fetched_at"),
    }


@api_router.post("/admin/matches/{match_id}/live/sync")
async def admin_live_sync(match_id: str, body: LiveSyncBody, admin=Depends(require_admin)):
    """Refresh the live centre from the score service and re-rank leaderboards."""
    match = await get_match_or_404(match_id)
    snap = await fetch_live_snapshot(match, feed=body.feed)
    stored = {k: v for k, v in snap.items() if k != "lines"}
    stored["lines"] = snap["lines"]
    await db.match_live.update_one({"match_id": match_id}, {"$set": {"match_id": match_id, **stored}}, upsert=True)

    written = 0
    if body.write_scores and snap["lines"]:
        written = await write_live_scores(match, snap["lines"], admin["id"])
        match = await get_match_or_404(match_id)
    if snap["innings"] or snap["status_text"]:
        # A match the provider says is underway should be live in-app too.
        fresh = await get_match_or_404(match_id)
        if fresh.get("status") == "upcoming":
            await db.matches.update_one({"id": match_id}, {"$set": {"status": "live"}})
            await db.contests.update_many({"match_id": match_id, "kind": "fantasy", "status": "open"},
                                          {"$set": {"status": "closed"}})
            match = await get_match_or_404(match_id)
    boards = await refresh_live_boards(match_id)
    return {
        "ok": True,
        "live": public_live_view(match, stored),
        "scores_written": written,
        "matched": len(snap["lines"]),
        "unmatched": snap["unmatched"][:12],
        "squad_without_stats": snap["squad_without_stats"][:12],
        "boards": boards,
    }


@api_router.get("/admin/matches/{match_id}/live")
async def admin_live_peek(match_id: str, admin=Depends(require_admin)):
    match = await get_match_or_404(match_id)
    doc = await _live_doc(match_id)
    return {"live": public_live_view(match, doc), "matched": doc.get("lines", []),
            "unmatched": doc.get("unmatched", []), "squad_without_stats": doc.get("squad_without_stats", []),
            "config": {"external_id": match.get("external_id", ""), "feed": match.get("live_feed", "scorecard"),
                       "auto_live": bool(match.get("auto_live"))}}


@api_router.delete("/admin/matches/{match_id}/live")
async def admin_live_clear(match_id: str, admin=Depends(require_admin)):
    await db.match_live.delete_many({"match_id": match_id})
    return {"ok": True}


@api_router.get("/matches/{match_id}/live")
async def match_live(match_id: str, user=Depends(get_current_user)):
    """In-app live screen. Re-pulls the provider when the match opts into auto-sync."""
    match = await get_match_or_404(match_id)
    doc = await _live_doc(match_id)
    note = None
    stale = True
    if doc.get("fetched_at"):
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(doc["fetched_at"])).total_seconds()
            stale = age > LIVE_STALE_SECONDS
        except ValueError:
            stale = True
    if match.get("auto_live") and match.get("external_id") and stale and match.get("status") == "live":
        try:
            snap = await fetch_live_snapshot(match)
            doc = {k: v for k, v in snap.items()}
            await db.match_live.update_one({"match_id": match_id}, {"$set": {"match_id": match_id, **doc}}, upsert=True)
            if snap["lines"] and not match.get("scorecard_entered"):
                await write_live_scores(match, snap["lines"], "auto-live")
                await refresh_live_boards(match_id)
                match = await get_match_or_404(match_id)
        except HTTPException as e:
            note = str(e.detail)
        except Exception as e:  # a provider outage must not break the screen
            note = f"Live update failed: {e}"

    out = public_live_view(match, doc)
    out["error"] = note
    # Top performers + my standing, from our own points table.
    scores = await db.player_scores.find({"match_id": match_id}, {"_id": 0}).to_list(300)
    by_player = {s.get("player_id"): s for s in scores}
    top = sorted(scores, key=lambda s: -float(s.get("points") or 0))[:8]
    out["top_performers"] = [{"name": s.get("player_name"), "team": s.get("team"), "role": s.get("role"),
                              "points": s.get("points", 0)} for s in top if float(s.get("points") or 0) > 0]
    out["partial"] = any(bool(s.get("partial")) for s in scores)
    best = top[0] if top and float(top[0].get("points") or 0) > 0 else None
    out["star"] = ({"name": best.get("player_name"), "team": best.get("team"), "role": best.get("role"),
                    "points": best.get("points", 0)} if best and (match.get("scorecard_entered")
                                                                  or match.get("status") == "completed") else None)

    my_teams = await db.fantasy_teams.find({"match_id": match_id, "user_id": user["id"]},
                                           {"_id": 0, "player_ids": 1}).to_list(20)
    my_ids = {pid for t in my_teams for pid in (t.get("player_ids") or [])}
    out["my_player_ids"] = sorted(my_ids)
    out["events"] = [dict(e, mine=bool(e.get("batter_id") in my_ids or e.get("bowler_id") in my_ids))
                     for e in out.get("events", [])]
    out["last_events"] = out["events"][-18:]
    names = {p["id"]: p for p in await get_match_players(match_id)}
    mine_rows = [{"player_id": pid, "name": (names.get(pid) or {}).get("name"),
                  "team": (names.get(pid) or {}).get("team"), "role": (names.get(pid) or {}).get("role"),
                  "points": float((by_player.get(pid) or {}).get("points") or 0)} for pid in my_ids]
    out["my_players"] = sorted(mine_rows, key=lambda c: -c["points"])[:11]

    contests = await db.contests.find({"match_id": match_id, "kind": "fantasy"}, {"_id": 0}).to_list(200)
    meta = {c["id"]: c for c in contests}
    my = await db.entries.find(
        {"contest_id": {"$in": list(meta)}, "user_id": user["id"], "status": {"$in": ["approved", "won"]}},
        {"_id": 0, "contest_id": 1, "fantasy_rank": 1, "fantasy_rank_prev": 1, "fantasy_points": 1,
         "team_name": 1, "live_entries": 1},
    ).to_list(200)
    out["my_positions"] = []
    for m in my:
        rank, prev = m.get("fantasy_rank"), m.get("fantasy_rank_prev")
        c = meta.get(m.get("contest_id")) or {}
        out["my_positions"].append({
            "contest_id": m.get("contest_id"), "contest_title": c.get("title"),
            "rank": rank, "rank_delta": (prev - rank) if (rank and prev) else 0,
            "entries": m.get("live_entries") or c.get("live_entries") or 0,
            "top_points": c.get("live_top_points"), "points": m.get("fantasy_points"),
            "team_name": m.get("team_name"),
        })
    return out


# ---------- Fantasy extras: one XI into many contests, auto-pick ----------
@api_router.post("/fantasy/enter-multi")
async def fantasy_enter_multi(body: EnterMultiBody, user=Depends(get_current_user)):
    """Join several fantasy contests with one saved team, paid from the wallet in one tap."""
    if user["role"] == "admin":
        raise HTTPException(status_code=400, detail="Admin cannot join contests")
    team = await db.fantasy_teams.find_one({"id": body.team_id}, {"_id": 0})
    if not team or team.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Team not found")
    match = await get_match_or_404(team["match_id"])
    if match_locked(match):
        raise HTTPException(status_code=400, detail="Entries for this match are closed")

    planned = []
    for cid in body.contest_ids:
        contest = await get_joinable_contest(cid, user)
        if contest.get("kind") != "fantasy":
            raise HTTPException(status_code=400, detail=f"{contest.get('title')} is not a fantasy contest")
        if contest.get("match_id") != team["match_id"]:
            raise HTTPException(status_code=400, detail=f"{contest.get('title')} belongs to a different match")
        await resolve_entry_team(contest, user, team["id"])
        fee = float(contest.get("entry_fee") or 0)
        if fee <= 0:
            raise HTTPException(status_code=400, detail=f"{contest.get('title')} cannot be paid from the wallet")
        planned.append((contest, fee))

    total = round(sum(fee for _, fee in planned), 2)
    balance = float(user.get("wallet_balance") or 0)
    if total > balance:
        raise HTTPException(status_code=400, detail=f"These {len(planned)} contests need {inr(total)}. "
                                                   f"Your wallet has {inr(balance)} — top up or drop one.")

    made = []
    for contest, fee in planned:
        res = await db.users.update_one(
            {"id": user["id"], "wallet_balance": {"$gte": fee}},
            {"$inc": {"wallet_balance": -fee}},
        )
        if res.matched_count == 0:
            break  # wallet ran dry mid-batch; keep what we already joined
        entry_id = str(uuid.uuid4())
        await db.entries.insert_one({
            "id": entry_id,
            "contest_id": contest["id"],
            "contest_title": contest["title"],
            "match_id": contest.get("match_id"),
            "user_id": user["id"],
            "user_name": user["name"],
            "user_mobile": user.get("mobile"),
            "entry_fee": fee,
            "utr": None,
            "screenshot_path": None,
            "status": "approved",
            "payment_method": "wallet",
            "contest_kind": "fantasy",
            "team_id": team["id"],
            "team_name": team.get("name"),
            "decision_note": f"Joined {len(planned)} contests with one team",
            "decided_at": now_iso(),
            "winner_prize": 0.0,
            "created_at": now_iso(),
        })
        await db.wallet_logs.insert_one({
            "id": str(uuid.uuid4()), "user_id": user["id"], "amount": -fee,
            "note": f"Entry fee · {contest['title']}", "by": "system", "created_at": now_iso(),
        })
        made.append({"entry_id": entry_id, "contest_id": contest["id"], "title": contest["title"], "fee": fee})

    if not made:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance. Please top up to continue.")
    await push_notification(
        user["id"], "entry", f"Joined {len(made)} contests",
        f"{team.get('name') or 'Your team'} is in {', '.join(m['title'] for m in made[:3])}"
        f"{'…' if len(made) > 3 else ''}. {inr(round(sum(m['fee'] for m in made), 2))} deducted from your wallet.",
        {"team_id": team["id"], "contest_ids": [m["contest_id"] for m in made]},
    )
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "wallet_balance": 1})
    return {"ok": True, "joined": made, "total_spent": round(sum(m["fee"] for m in made), 2),
            "wallet_balance": round(float(fresh.get("wallet_balance") or 0), 2)}


def _xi_credits(sel: list) -> float:
    return round(sum(float(p.get("credits") or 0) for p in sel), 2)


def _xi_legal(sel: list) -> bool:
    """A finished XI that breaks no rule."""
    if len(sel) != TEAM_SIZE or _xi_credits(sel) > CREDIT_BUDGET + 1e-9:
        return False
    roles: dict = {}
    sides: dict = {}
    for p in sel:
        r = p.get("role")
        if r not in ROLE_LIMITS:
            return False
        roles[r] = roles.get(r, 0) + 1
        sides[p.get("team")] = sides.get(p.get("team"), 0) + 1
    for r, (lo, hi) in ROLE_LIMITS.items():
        if not (lo <= roles.get(r, 0) <= hi):
            return False
    return max(sides.values() or [0]) <= MAX_PER_SIDE


def _can_grow(sel: list, pool: list) -> bool:
    """Can this partial XI still become legal? Caps, budget and the roles we owe."""
    if len(sel) > TEAM_SIZE or _xi_credits(sel) > CREDIT_BUDGET + 1e-9:
        return False
    roles: dict = {}
    sides: dict = {}
    for p in sel:
        r = p.get("role")
        if r not in ROLE_LIMITS:
            return False
        roles[r] = roles.get(r, 0) + 1
        sides[p.get("team")] = sides.get(p.get("team"), 0) + 1
    for r, (_lo, hi) in ROLE_LIMITS.items():
        if roles.get(r, 0) > hi:
            return False
    if max(sides.values() or [0]) > MAX_PER_SIDE:
        return False
    chosen = {p["id"] for p in sel}
    owed = 0
    for r, (lo, _hi) in ROLE_LIMITS.items():
        need = max(0, lo - roles.get(r, 0))
        if need > sum(1 for p in pool if p.get("role") == r and p["id"] not in chosen):
            return False
        owed += need
    return owed <= TEAM_SIZE - len(sel)


async def _auto_pick(pool: list, order: str) -> Optional[dict]:
    """Auto-build a strong legal XI.

    Seeds with the cheapest legal set so the 100-credit budget is never the
    blocker, then hill-climbs by swapping in higher-value players while the XI
    stays legal — so projections actually win their seat instead of being
    skipped for want of credits.
    """
    if len(pool) < TEAM_SIZE:
        return None

    def value(p):
        if order == "projection":
            return float(p.get("projection") or 0)
        return float(p.get("credits") or 0) * 10

    seed: list = []
    for p in sorted(pool, key=lambda x: (float(x.get("credits") or 0), -value(x))):
        if len(seed) >= TEAM_SIZE:
            break
        if _can_grow(seed + [p], pool):
            seed.append(p)
    if not _xi_legal(seed):
        return None

    cur = list(seed)
    for _round in range(3):
        improved = False
        for candidate in sorted(pool, key=lambda x: -value(x)):
            if candidate in cur:
                continue
            best_out, best_gain = None, 0.0
            for out in cur:
                gain = value(candidate) - value(out)
                if gain <= best_gain:
                    continue
                trial = [x for x in cur if x is not out] + [candidate]
                if _xi_legal(trial):
                    best_out, best_gain = out, gain
            if best_out is not None:
                cur = [x for x in cur if x is not best_out] + [candidate]
                improved = True
        if not improved:
            break

    ids = [p["id"] for p in cur]
    ranked = sorted(cur, key=lambda p: -value(p))
    captain = ranked[0]["id"]
    vice = ranked[1]["id"] if len(ranked) > 1 else ranked[0]["id"]
    by_id = {p["id"]: p for p in cur}
    try:
        comp = validate_team(by_id, ids, captain, vice)
    except HTTPException:
        return None
    return {"player_ids": ids, "captain_id": captain, "vice_captain_id": vice,
            "basis": order, "credits_left": round(CREDIT_BUDGET - _xi_credits(cur), 2), **comp}


@api_router.get("/fantasy/suggested-team")
async def fantasy_suggested_team(match_id: str, user=Depends(get_current_user)):
    """Auto-build a legal XI. Uses admin projections when set, otherwise credit weight."""
    match = await get_match_or_404(match_id)
    players = await get_match_players(match_id)
    if len(players) < TEAM_SIZE:
        raise HTTPException(status_code=400, detail="This match needs at least 11 players first")
    XI = [p for p in players if p.get("playing", True)]
    orders = ["projection", "credits"]
    if not any(float(p.get("projection") or 0) > 0 for p in XI):
        orders = ["credits"]
    pool_plan = [(XI, o, "playing_xi") for o in orders] + [(players, o, "full_squad") for o in orders]
    for pool, order, used in pool_plan:
        built = await _auto_pick(pool, order)
        if built:
            names = {p["id"]: p for p in pool}
            built["players"] = [{
                "id": pid, "name": names[pid]["name"], "team": names[pid]["team"], "role": names[pid]["role"],
                "credits": names[pid].get("credits"), "projection": names[pid].get("projection", 0),
                "is_captain": pid == built["captain_id"], "is_vice_captain": pid == built["vice_captain_id"],
            } for pid in built["player_ids"]]
            built["match_id"] = match_id
            built["name"] = "Auto XI"
            built["squad_used"] = used
            built["warnings"] = ([] if used == "playing_xi"
                                 else ["The announced XI is incomplete, so this uses the full squad — check before you lock in."])
            return built
    raise HTTPException(status_code=400, detail="No legal XI fits the 100-credit budget — lower some player credits or widen the role mix")


# ---------- Season stats ----------
@api_router.get("/me/season-stats")
async def season_stats(user=Depends(get_current_user)):
    uid = user["id"]
    entries = await db.entries.find({"user_id": uid}, {"_id": 0}).to_list(5000)
    played = [e for e in entries if e.get("status") in ("approved", "won")]
    won = [e for e in entries if e.get("status") == "won"]
    refunded = [e for e in entries if e.get("status") == "refunded"]
    pending = [e for e in entries if e.get("status") == "pending"]
    wagered = round(sum(float(e.get("entry_fee") or 0) for e in played), 2)
    winnings = round(sum(float(e.get("winner_prize") or 0) for e in won), 2)
    ranks = [int(e["fantasy_rank"]) for e in entries if e.get("fantasy_rank")]
    points = [float(e.get("fantasy_points") or 0) for e in entries if e.get("fantasy_points")]
    withdrawals = await db.withdrawals.find({"user_id": uid}, {"_id": 0}).to_list(1000)
    paid_out = round(sum(float(w.get("amount") or 0) for w in withdrawals if w.get("status") == "paid"), 2)
    best = max(won, key=lambda e: float(e.get("winner_prize") or 0), default=None)
    teams = await db.fantasy_teams.count_documents({"user_id": uid})
    matches = await db.fantasy_teams.find({"user_id": uid}, {"_id": 0, "match_id": 1}).to_list(2000)
    months: dict = {}
    for e in entries:
        key = (e.get("created_at") or "")[:7]
        if not key:
            continue
        row = months.setdefault(key, {"month": key, "wagered": 0.0, "won": 0.0, "entries": 0, "points": 0.0})
        if e.get("status") in ("approved", "won"):
            row["entries"] += 1
            row["wagered"] += float(e.get("entry_fee") or 0)
        if e.get("status") == "won":
            row["won"] += float(e.get("winner_prize") or 0)
        row["points"] += float(e.get("fantasy_points") or 0)
    series = []
    for key in sorted(months)[-6:]:
        r = months[key]
        series.append({"month": key, "wagered": round(r["wagered"], 2), "won": round(r["won"], 2),
                       "entries": r["entries"], "points": round(r["points"], 1)})
    return {
        "contests_played": len(played),
        "contests_won": len(won),
        "contests_pending": len(pending),
        "contests_refunded": len(refunded),
        "teams_built": teams,
        "matches_played": len({m.get("match_id") for m in matches if m.get("match_id")}),
        "wagered": wagered,
        "winnings": winnings,
        "net": round(winnings - wagered, 2),
        "paid_out": paid_out,
        "win_rate": round((len(won) / len(played) * 100) if played else 0.0, 1),
        "best_win": {"amount": float(best.get("winner_prize") or 0), "contest_title": best.get("contest_title"),
                     "at": best.get("won_at") or best.get("created_at")} if best else None,
        "total_points": round(sum(points), 1),
        "avg_points": round(sum(points) / len(points), 1) if points else 0.0,
        "best_rank": min(ranks) if ranks else None,
        "top3_finishes": len([r for r in ranks if r <= 3]),
        "wallet_balance": round(float(user.get("wallet_balance") or 0), 2),
        "monthly": series,
    }


# ---------- App release info (drives the in-app update banner) ----------
APP_VERSION_DEFAULTS = {"version_code": 4, "version_name": "1.3.0", "apk_url": "",
                        "notes": "Live match centre, team insights and play-safety controls", "force_update": False}


async def app_release() -> dict:
    s = await db.settings.find_one({"key": "app_version"}, {"_id": 0}) or {}
    out = dict(APP_VERSION_DEFAULTS)
    for k in APP_VERSION_DEFAULTS:
        if s.get(k) is not None:
            out[k] = s[k]
    out["updated_at"] = s.get("updated_at")
    return out


@api_router.get("/app/version")
async def app_version_public():
    """Public: the installed APK compares its own build number with this."""
    return await app_release()


@api_router.put("/admin/app/version")
async def admin_app_version(body: AppVersionBody, admin=Depends(require_admin)):
    doc = {"key": "app_version", "version_code": int(body.version_code), "version_name": body.version_name.strip(),
           "apk_url": body.apk_url.strip(), "notes": body.notes.strip(), "force_update": bool(body.force_update),
           "updated_at": now_iso(), "updated_by": admin["id"]}
    await db.settings.update_one({"key": "app_version"}, {"$set": doc}, upsert=True)
    return await app_release()


# ---------- Admin exports ----------
def csv_response(rows: list, columns: list, filename: str) -> Response:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        writer.writerow({c: ("" if r.get(c) is None else r.get(c)) for c in columns})
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/admin/export/entries.csv")
async def admin_export_entries(contest_id: Optional[str] = None, status: Optional[str] = None,
                               admin=Depends(require_admin)):
    q = {}
    if contest_id:
        q["contest_id"] = contest_id
    if status:
        q["status"] = status
    rows = []
    fetched = await db.entries.find(q, {"_id": 0}).sort("created_at", -1).to_list(20000)
    for e in fetched:
        rows.append({
            "entry_id": e.get("id"), "contest": e.get("contest_title"), "kind": e.get("contest_kind", "classic"),
            "team_name": e.get("team_name"), "user_name": e.get("user_name"), "user_id": e.get("user_id"),
            "status": e.get("status"), "entry_fee": e.get("entry_fee"), "payment_method": e.get("payment_method"),
            "utr": e.get("utr"), "fantasy_points": e.get("fantasy_points"), "fantasy_rank": e.get("fantasy_rank"),
            "prize": e.get("winner_prize"), "created_at": e.get("created_at"), "decided_at": e.get("decided_at"),
            "note": e.get("decision_note"),
        })
    return csv_response(rows, list(rows[0].keys()) if rows else
                        ["entry_id", "contest", "kind", "team_name", "user_name", "user_id", "status", "entry_fee",
                         "payment_method", "utr", "fantasy_points", "fantasy_rank", "prize", "created_at",
                         "decided_at", "note"],
                        "pitchplay-entries.csv")


@api_router.get("/admin/export/payouts.csv")
async def admin_export_payouts(status: Optional[str] = None, admin=Depends(require_admin)):
    q = {}
    if status:
        q["status"] = status
    rows = []
    fetched = await db.withdrawals.find(q, {"_id": 0}).sort("created_at", -1).to_list(20000)
    for w in fetched:
        rows.append({
            "withdrawal_id": w.get("id"), "user_name": w.get("user_name"), "user_mobile": w.get("user_mobile"),
            "upi_id": w.get("upi_id"), "amount": w.get("amount"), "status": w.get("status"),
            "payout_id": w.get("payout_id"), "utr": w.get("payout_utr"), "payout_status": w.get("payout_status"),
            "requested_at": w.get("payout_requested_at"), "created_at": w.get("created_at"),
            "decided_at": w.get("decided_at"), "note": w.get("decision_note"),
        })
    return csv_response(rows, list(rows[0].keys()) if rows else
                        ["withdrawal_id", "user_name", "user_mobile", "upi_id", "amount", "status", "payout_id",
                         "utr", "payout_status", "requested_at", "created_at", "decided_at", "note"],
                        "pitchplay-payouts.csv")


# ---------- Admin audit trail ----------
AUDIT_SKIP_PREFIXES = ("/api/auth/", "/api/razorpay/", "/api/files", "/api/wallet/topup", "/api/payments/")


@app.middleware("http")
async def audit_admin_actions(request: Request, call_next):
    response = await call_next(request)
    try:
        path = request.url.path
        method = request.method
        if (method in ("POST", "PATCH", "PUT", "DELETE") and path.startswith("/api/")
                and response.status_code < 400
                and not any(path.startswith(p) for p in AUDIT_SKIP_PREFIXES)):
            auth = request.headers.get("authorization") or ""
            token = auth.split(" ", 1)[1] if auth.lower().startswith("bearer ") else ""
            if token:
                try:
                    claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
                except jwt.PyJWTError:
                    claims = {}
                if claims.get("role") == "admin":
                    admin = await db.users.find_one({"id": claims.get("sub")}, {"_id": 0, "name": 1}) or {}
                    await db.admin_audit.insert_one({
                        "id": str(uuid.uuid4()),
                        "admin_id": claims.get("sub"),
                        "admin_name": admin.get("name") or "admin",
                        "method": method,
                        "path": path,
                        "query": str(request.url.query or ""),
                        "status": response.status_code,
                        "ip": (request.client.host if request.client else "") or "",
                        "at": now_iso(),
                    })
    except Exception:  # auditing must never break a real request
        logging.getLogger(__name__).exception("audit write failed")
    return response


@api_router.get("/admin/audit")
async def admin_audit(limit: int = Query(200, ge=1, le=1000), admin=Depends(require_admin)):
    return await db.admin_audit.find({}, {"_id": 0}).sort("at", -1).to_list(limit)


# ---------- Guardrails, legal & refunds ----------
GUARD_DEFAULTS = {
    "min_withdrawal": 1,               # ₹; raise to e.g. 100 to cut payout fees
    "max_withdrawal_per_day": 0,       # 0 = no cap
    "max_entries_per_user_per_day": 0,  # 0 = no cap
    "max_entries_per_user_per_contest": 0,  # 0 = no cap (fantasy uses max_teams_per_user)
    "require_terms_acceptance": False,  # hard-block joins/withdrawals until accepted
    "require_age_gate": False,          # hard-block until 18+ confirmed
    "refund_on_abandon": True,
    "terms_version": "1.0",
    "terms_title": "Terms, skill-game notice and eligibility",
    "terms_body": (
        "PitchPlay hosts skill-based fantasy cricket contests. "
        "You must be 18 or older and allowed to play real-money skill games where you live "
        "(such games are restricted in some states). Entry fees are paid to the organiser and "
        "winnings are credited to your in-app wallet, which you can withdraw to your own UPI. "
        "Team selection locks at the scheduled start time; results are calculated from the "
        "scorecard published by the organiser. Prizes are not guaranteed and you can lose your "
        "entry fee. Play responsibly — this is not a game of chance."
    ),
}
UPI_RE = re.compile(r"^[a-zA-Z0-9._\-]{2,}@[a-zA-Z]{2,}$")


async def get_guard_settings() -> dict:
    s = await db.settings.find_one({"key": "guardrails"}, {"_id": 0}) or {}
    out = dict(GUARD_DEFAULTS)
    for k in GUARD_DEFAULTS:
        if s.get(k) is not None:
            out[k] = s[k]
    return out


async def require_terms(user: dict) -> None:
    g = await get_guard_settings()
    if g["require_terms_acceptance"] and not user.get("terms_accepted_at"):
        raise HTTPException(status_code=402, detail="Please accept the terms to continue")
    if g["require_age_gate"] and not user.get("age_confirmed"):
        raise HTTPException(status_code=402, detail="You must confirm you are 18 or older")


@api_router.get("/legal/config")
async def legal_config(user=Depends(get_current_user)):
    g = await get_guard_settings()
    return {
        "terms_version": g["terms_version"], "terms_title": g["terms_title"], "terms_body": g["terms_body"],
        "require_terms_acceptance": g["require_terms_acceptance"], "require_age_gate": g["require_age_gate"],
        "accepted": bool(user.get("terms_accepted_at")), "age_confirmed": bool(user.get("age_confirmed")),
        "accepted_version": user.get("terms_version"),
        "needs_action": (not user.get("terms_accepted_at")) or (not user.get("age_confirmed")),
    }


class LegalAcceptBody(BaseModel):
    terms_version: str = "1.0"
    age_confirmed: bool = False


@api_router.post("/legal/accept")
async def legal_accept(body: LegalAcceptBody, user=Depends(get_current_user)):
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "terms_accepted_at": now_iso(), "terms_version": body.terms_version,
        "age_confirmed": bool(body.age_confirmed),
    }})
    return {"ok": True, "terms_version": body.terms_version, "age_confirmed": bool(body.age_confirmed)}


class GuardBody(BaseModel):
    min_withdrawal: Optional[float] = Field(default=None, ge=0)
    max_withdrawal_per_day: Optional[float] = Field(default=None, ge=0)
    max_entries_per_user_per_day: Optional[float] = Field(default=None, ge=0)
    max_entries_per_user_per_contest: Optional[float] = Field(default=None, ge=0)
    require_terms_acceptance: Optional[bool] = None
    require_age_gate: Optional[bool] = None
    refund_on_abandon: Optional[bool] = None
    terms_version: Optional[str] = Field(default=None, max_length=20)
    terms_title: Optional[str] = Field(default=None, max_length=120)
    terms_body: Optional[str] = Field(default=None, max_length=4000)


@api_router.get("/admin/guardrails")
async def admin_get_guardrails(admin=Depends(require_admin)):
    return await get_guard_settings()


@api_router.put("/admin/guardrails")
async def admin_put_guardrails(body: GuardBody, admin=Depends(require_admin)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updates["key"] = "guardrails"
    updates["updated_at"] = now_iso()
    updates["updated_by"] = admin["id"]
    await db.settings.update_one({"key": "guardrails"}, {"$set": updates}, upsert=True)
    return await get_guard_settings()


def day_start_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


async def enforce_entry_caps(contest: dict, user: dict) -> None:
    """Per-user entry limits, applied to every payment path via get_joinable_contest."""
    g = await get_guard_settings()
    per_contest = int(g.get("max_entries_per_user_per_contest") or 0)
    if per_contest:
        mine = await db.entries.count_documents({
            "contest_id": contest["id"], "user_id": user["id"], "status": {"$in": ["pending", "approved", "won"]}
        })
        if mine >= per_contest:
            raise HTTPException(status_code=400, detail=f"You can join at most {per_contest} time(s) per contest")
    per_day = int(g.get("max_entries_per_user_per_day") or 0)
    if per_day:
        today = await db.entries.count_documents({
            "user_id": user["id"], "status": {"$in": ["pending", "approved", "won"]},
            "created_at": {"$gte": day_start_iso()},
        })
        if today >= per_day:
            raise HTTPException(status_code=400, detail=f"Daily entry limit reached ({per_day}). Try again tomorrow.")
    await require_terms(user)


async def refund_entries(entries: list, reason: str) -> dict:
    """Credit entry fees back to wallets for the given entries."""
    refunded, total = 0, 0.0
    for e in entries:
        if e.get("status") == "refunded":
            continue
        amount = float(e.get("entry_fee") or 0)
        await db.users.update_one({"id": e["user_id"]}, {"$inc": {"wallet_balance": amount}})
        await db.wallet_logs.insert_one({
            "id": str(uuid.uuid4()), "user_id": e["user_id"], "amount": amount,
            "note": f"Refund · {e.get('contest_title') or 'contest'} · {reason}", "by": "system", "created_at": now_iso(),
        })
        await db.entries.update_one({"id": e["id"]}, {"$set": {
            "status": "refunded", "refunded_at": now_iso(), "refund_reason": reason, "decision_note": reason,
        }})
        await push_notification(
            e["user_id"], "refund", "Entry fee refunded",
            f"{inr(amount)} was returned to your wallet — {reason}.",
            {"contest_id": e.get("contest_id"), "entry_id": e["id"], "amount": amount},
        )
        refunded += 1
        total += amount
    return {"refunded": refunded, "amount": round(total, 2)}


@api_router.post("/contests/{contest_id}/refund")
async def refund_contest(contest_id: str, admin=Depends(require_admin)):
    """Refund every paid entry of a cancelled contest (classic or fantasy)."""
    contest = await db.contests.find_one({"id": contest_id}, {"_id": 0})
    if not contest:
        raise HTTPException(status_code=404, detail="Contest not found")
    entries = await db.entries.find({"contest_id": contest_id, "status": {"$in": ["approved", "pending"]}}, {"_id": 0}).to_list(5000)
    if not entries:
        return {"refunded": 0, "amount": 0}
    res = await refund_entries(entries, "Contest cancelled by organiser")
    await db.contests.update_one({"id": contest_id}, {"$set": {"status": "closed", "refunded_at": now_iso()}})
    return res


# ---------- Builder depth: player insight, XI compare, settlement explainer ----------
@api_router.get("/players/{player_id}/insight")
async def player_insight(player_id: str, user=Depends(get_current_user)):
    """Everything a selection decision needs: value, role rank, and how this player has been scoring."""
    p = await db.players.find_one({"id": player_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Player not found")
    match = await db.matches.find_one({"id": p["match_id"]}, {"_id": 0}) or {}
    squad = await get_match_players(p["match_id"])
    credits = float(p.get("credits") or 0)
    proj = float(p.get("projection") or 0)
    value = round(proj / credits, 2) if credits and proj else 0.0
    peers = [float(x.get("projection") or 0) / max(float(x.get("credits") or 1), 0.1)
             for x in squad if float(x.get("projection") or 0) > 0]
    median = round(sorted(peers)[len(peers) // 2], 2) if peers else 0.0
    role_rank = 1 + sum(1 for x in squad if x.get("role") == p.get("role")
                        and float(x.get("projection") or 0) > proj) if proj else 0
    hist = await db.player_scores.find({"player_id": player_id}, {"_id": 0}).sort("updated_at", -1).to_list(10)
    labels = {}
    if hist:
        for m in await db.matches.find({"id": {"$in": [h["match_id"] for h in hist]}},
                                       {"_id": 0, "id": 1, "team_a_short": 1, "team_b_short": 1,
                                        "status": 1, "scorecard_entered": 1}).to_list(40):
            labels[m["id"]] = f"{m.get('team_a_short')} vs {m.get('team_b_short')}"
            labels[m["id"] + "_final"] = bool(m.get("scorecard_entered")) or m.get("status") == "completed"
    form = [{"match_id": h["match_id"], "match": labels.get(h["match_id"], "match"),
             "final": bool(labels.get(h["match_id"] + "_final")), "points": h.get("points", 0),
             "runs": int((h.get("stats") or {}).get("runs") or 0),
             "wickets": int((h.get("stats") or {}).get("wickets") or 0)} for h in hist]
    pts = [float(f["points"] or 0) for f in form]
    return {
        "player": {k: p.get(k) for k in ("id", "name", "team", "role", "credits", "projection", "playing", "match_id")},
        "match": {"id": match.get("id"), "label": f"{match.get('team_a_short')} vs {match.get('team_b_short')}",
                  "status": match.get("status"), "venue": match.get("venue")},
        "value_per_credit": value,
        "squad_median_value": median,
        "value_verdict": ("good value" if value and median and value >= median * 1.15 else
                          "fair" if value and median and value >= median * 0.85 else
                          "expensive" if value else "no projection set"),
        "role_rank": role_rank,
        "role_peers": sum(1 for x in squad if x.get("role") == p.get("role")),
        "innings": len(form),
        "avg_points": round(sum(pts) / len(pts), 2) if pts else 0,
        "best_points": max(pts) if pts else 0,
        "form": form,
    }


@api_router.get("/fantasy/teams/{team_id}/compare/{other_id}")
async def compare_fantasy_teams(team_id: str, other_id: str, user=Depends(get_current_user)):
    """Side-by-side of two of my XIs: who is shared, who differs, and what each pick scored."""
    a = await db.fantasy_teams.find_one({"id": team_id}, {"_id": 0})
    b = await db.fantasy_teams.find_one({"id": other_id}, {"_id": 0})
    if not a or not b:
        raise HTTPException(status_code=404, detail="Team not found")
    if user["role"] != "admin" and (a.get("user_id") != user["id"] or b.get("user_id") != user["id"]):
        raise HTTPException(status_code=404, detail="Team not found")
    if a.get("match_id") != b.get("match_id"):
        raise HTTPException(status_code=400, detail="Only teams from the same match can be compared")
    match_id = a["match_id"]
    names = {p["id"]: p for p in await get_match_players(match_id)}
    scores = await db.player_scores.find({"match_id": match_id}, {"_id": 0}).to_list(300)
    by_player = {s["player_id"]: s for s in scores}
    match = await db.matches.find_one({"id": match_id}, {"_id": 0}) or {}
    have_scores = bool(match.get("scorecard_entered")) or match.get("status") == "completed"

    def label(pid):
        info = names.get(pid) or {}
        return {"player_id": pid, "name": info.get("name"), "team": info.get("team"), "role": info.get("role"),
                "credits": info.get("credits"), "points": float((by_player.get(pid) or {}).get("points") or 0)}

    set_a, set_b = set(a.get("player_ids") or []), set(b.get("player_ids") or [])
    shared = [label(pid) for pid in a.get("player_ids") or [] if pid in set_b]
    diff = []
    for pid in sorted(set_a ^ set_b):
        row = label(pid)
        row["in"] = "A" if pid in set_a else "B"
        row["captain"] = pid in (a.get("captain_id"), b.get("captain_id")) and (
            a.get("captain_id") == pid or b.get("captain_id") == pid)
        row["captain_of"] = ("A" if a.get("captain_id") == pid else "") + ("B" if b.get("captain_id") == pid else "")
        row["vice_of"] = ("A" if a.get("vice_captain_id") == pid else "") + ("B" if b.get("vice_captain_id") == pid else "")
        diff.append(row)
    diff.sort(key=lambda r: -r["points"])

    def side(t):
        tp = team_points({pid: {"total": float((by_player.get(pid) or {}).get("points") or 0)} for pid in t.get("player_ids") or []}, t, names)
        return {"id": t["id"], "name": t.get("name"), "credits_used": t.get("credits_used"),
                "captain": (names.get(t.get("captain_id")) or {}).get("name"),
                "vice_captain": (names.get(t.get("vice_captain_id")) or {}).get("name"),
                "points": tp["total"] if have_scores else None}

    ta, tb = side(a), side(b)
    return {
        "match": {"id": match_id, "label": f"{match.get('team_a_short')} vs {match.get('team_b_short')}",
                  "status": match.get("status")},
        "scorecard_entered": bool(match.get("scorecard_entered")),
        "final": have_scores,
        "team_a": ta, "team_b": tb,
        "shared_count": len(shared),
        "differ_count": len(diff),
        "swing": (round((ta["points"] or 0) - (tb["points"] or 0), 2) if have_scores else None),
        "differences": diff,
        "shared": shared,
    }


@api_router.get("/entries/{entry_id}/settlement")
async def entry_settlement(entry_id: str, user=Depends(get_current_user)):
    """Why this entry finished where it did — per player, per scoring component, plus the prize rule."""
    e = await db.entries.find_one({"id": entry_id}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Entry not found")
    if user["role"] != "admin" and e.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Entry not found")
    contest = await db.contests.find_one({"id": e.get("contest_id")}, {"_id": 0}) or {}
    team = await db.fantasy_teams.find_one({"id": e.get("team_id")}, {"_id": 0}) if e.get("team_id") else None
    names = {p["id"]: p for p in await get_match_players(contest.get("match_id") or "")}
    scores = await db.player_scores.find({"match_id": contest.get("match_id")}, {"_id": 0}).to_list(300)
    player_points = {s["player_id"]: {"total": s.get("points", 0), "components": s.get("components") or {}}
                     for s in scores}
    rows = team_points(player_points, team, names)["rows"] if team else []
    prizes = {int(p["rank"]): float(p["amount"]) for p in (contest.get("prize_breakdown") or [])}
    rank = e.get("fantasy_rank")
    return {
        "entry": {"id": e["id"], "status": e.get("status"), "team_name": e.get("team_name"),
                  "entry_fee": e.get("entry_fee"), "created_at": e.get("created_at"),
                  "prize": e.get("winner_prize", 0), "refunded": e.get("status") == "refunded"},
        "contest": {"id": contest.get("id"), "title": contest.get("title"), "settled_at": contest.get("settled_at"),
                    "prize_pool": contest.get("prize_pool"),
                    "prize_breakdown": sorted(prizes.items()),
                    "prize_for_my_rank": prizes.get(int(rank)) if rank else None,
                    "live_entries": contest.get("live_entries"), "kind": contest.get("kind")},
        "rank": rank,
        "points": e.get("fantasy_points"),
        "rows": rows,
        "rules": POINTS_RULES,
        "scorecard_entered": bool((await db.matches.find_one({"id": contest.get("match_id")}, {"_id": 0}) or {})
                                  .get("scorecard_entered")),
    }


# ---------- Play safety: deposit limits, self-exclusion, reality check, KYC ----------
SAFETY_DEFAULTS = {
    "allow_user_deposit_limit": True,
    "default_deposit_limit_daily": 0,      # ₹; 0 = no limit forced on new users
    "max_deposit_limit_daily": 0,          # ₹; 0 = user may set any limit
    "allow_self_exclusion": True,
    "self_exclusion_min_days": 1,
    "self_exclusion_max_days": 180,
    "allow_self_lift_exclusion": False,    # a break should not be shortcut in a weak moment
    "reality_check_default_minutes": 0,    # 0 = off; otherwise the app shows a session timer
    "max_daily_spend": 0,                  # ₹ across all entry fees per day; 0 = off
    "kyc_required_for_payouts": False,     # turn on to hold payouts until PAN is verified
    "support_email": "",
    "helpline": "",
    "reality_check_message": "You have been playing for a while. Check your time, spend and mood — you can pause or set a deposit limit any time.",
}
PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")


async def get_safety_settings() -> dict:
    s = await db.settings.find_one({"key": "safety"}, {"_id": 0}) or {}
    out = dict(SAFETY_DEFAULTS)
    for k in SAFETY_DEFAULTS:
        if s.get(k) is not None:
            out[k] = s[k]
    return out


def _exclusion_until(user: dict) -> str:
    return str(((user.get("self_exclusion") or {}).get("until")) or "")


def _is_excluded(user: dict) -> bool:
    until = _exclusion_until(user)
    return bool(until) and until > now_iso()


def _utc_day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def deposited_today(user: dict) -> float:
    if user.get("deposit_day") != _utc_day():
        return 0.0
    return float(user.get("deposited_today") or 0)


async def add_deposit(user_id: str, amount: float) -> None:
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0, "deposit_day": 1, "deposited_today": 1}) or {}
    base = float(fresh.get("deposited_today") or 0) if fresh.get("deposit_day") == _utc_day() else 0.0
    await db.users.update_one({"id": user_id}, {"$set": {"deposit_day": _utc_day(),
                                                         "deposited_today": round(base + float(amount), 2)},
                                                "$inc": {"total_deposited": round(float(amount), 2)}})


async def spend_today(user_id: str) -> float:
    total = 0.0
    async for e in db.entries.find({"user_id": user_id, "status": {"$in": ["pending", "approved", "won"]},
                                   "created_at": {"$gte": day_start_iso()}}, {"_id": 0, "entry_fee": 1}):
        total += float(e.get("entry_fee") or 0)
    return total


async def enforce_play_safety(user: dict, fee: float = 0.0) -> None:
    """Blocks new real-money play for an excluded user or one over their daily spend cap."""
    if user.get("role") == "admin":
        return
    if _is_excluded(user):
        raise HTTPException(status_code=400,
                            detail=f"You chose to take a break until {_exclusion_until(user)[:10]}. "
                                   "Entries stay closed for you until then.")
    s = await get_safety_settings()
    cap = float(s.get("max_daily_spend") or 0)
    if cap:
        already = await spend_today(user["id"])
        if already + float(fee or 0) > cap:
            left = max(round(cap - already, 2), 0.0)
            raise HTTPException(status_code=400,
                                detail=f"Daily play cap of {inr(cap)} reached ({inr(left)} left today). "
                                       "You can change the cap in Play responsibly.")


async def enforce_deposit_safety(user: dict, amount: float) -> None:
    """Blocks a top-up that would break the user's own deposit limit (or an active exclusion)."""
    if user.get("role") == "admin":
        return
    if _is_excluded(user):
        raise HTTPException(status_code=400,
                            detail=f"Your account is in self-exclusion until {_exclusion_until(user)[:10]} — "
                                  "deposits are blocked.")
    s = await get_safety_settings()
    if not s["allow_user_deposit_limit"]:
        return
    limit = float(user.get("deposit_limit_daily") or 0) or float(s.get("default_deposit_limit_daily") or 0)
    if limit <= 0:
        return
    already = await deposited_today(user)
    if already + float(amount) > limit:
        left = max(round(limit - already, 2), 0.0)
        raise HTTPException(status_code=400,
                            detail=f"Your daily deposit limit is {inr(limit)}. {inr(left)} left today — "
                                   "raise it in Play responsibly if this was deliberate.")


def _mask_pan(pan: str) -> str:
    return f"{pan[:5]}****{pan[-1]}" if len(pan) >= 10 else pan


class SafetyBody(BaseModel):
    deposit_limit_daily: Optional[float] = Field(default=None, ge=0, le=1000000)
    reality_check_minutes: Optional[int] = Field(default=None, ge=0, le=600)


class ExcludeBody(BaseModel):
    days: int = Field(ge=0, le=3650)
    reason: str = Field(default="", max_length=200)


class LiftBody(BaseModel):
    ack: bool = False


class KycBody(BaseModel):
    full_name: str = Field(min_length=3, max_length=80)
    pan: str = Field(min_length=10, max_length=10)


@api_router.get("/me/safety")
async def my_safety(user=Depends(get_current_user)):
    s = await get_safety_settings()
    g = await get_guard_settings()
    return {
        "deposit_limit_daily": float(user.get("deposit_limit_daily") or 0),
        "default_deposit_limit_daily": float(s["default_deposit_limit_daily"] or 0),
        "max_deposit_limit_daily": float(s["max_deposit_limit_daily"] or 0),
        "allow_user_deposit_limit": bool(s["allow_user_deposit_limit"]),
        "reality_check_minutes": int(user.get("reality_check_minutes") or s["reality_check_default_minutes"] or 0),
        "self_exclusion": user.get("self_exclusion") or {},
        "excluded": _is_excluded(user),
        "allow_self_exclusion": bool(s["allow_self_exclusion"]),
        "allow_self_lift": bool(s["allow_self_lift_exclusion"]),
        "self_exclusion_min_days": int(s["self_exclusion_min_days"]),
        "self_exclusion_max_days": int(s["self_exclusion_max_days"]),
        "daily_spend_cap": float(s["max_daily_spend"] or 0),
        "deposited_today": await deposited_today(user),
        "spent_today": round(await spend_today(user["id"]), 2),
        "kyc": {"status": (user.get("kyc") or {}).get("status", "none"),
                "name": (user.get("kyc") or {}).get("name"),
                "pan": (user.get("kyc") or {}).get("pan_masked"),
                "note": (user.get("kyc") or {}).get("note"),
                "submitted_at": (user.get("kyc") or {}).get("submitted_at")},
        "kyc_required_for_payouts": bool(s["kyc_required_for_payouts"]),
        "support_email": s["support_email"], "helpline": s["helpline"],
        "reality_check_message": s["reality_check_message"],
        "terms_title": g["terms_title"], "terms_version": g["terms_version"],
        "age_gate": bool(g["require_age_gate"]),
    }


@api_router.put("/me/safety")
async def update_my_safety(body: SafetyBody, user=Depends(get_current_user)):
    s = await get_safety_settings()
    updates = {"safety_updated_at": now_iso()}
    if body.deposit_limit_daily is not None:
        if not s["allow_user_deposit_limit"]:
            raise HTTPException(status_code=400, detail="Deposit limits are managed by the organiser")
        limit = round(float(body.deposit_limit_daily), 2)
        cap = float(s["max_deposit_limit_daily"] or 0)
        if cap and limit > cap:
            raise HTTPException(status_code=400, detail=f"Deposit limits can be at most {inr(cap)}")
        updates["deposit_limit_daily"] = limit
    if body.reality_check_minutes is not None:
        updates["reality_check_minutes"] = int(body.reality_check_minutes)
    await db.users.update_one({"id": user["id"]}, {"$set": updates})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return await my_safety(fresh)


@api_router.post("/me/self-exclude")
async def self_exclude(body: ExcludeBody, user=Depends(get_current_user)):
    s = await get_safety_settings()
    if not s["allow_self_exclusion"]:
        raise HTTPException(status_code=400, detail="Self-exclusion is disabled — contact the organiser")
    if body.days <= 0:
        await db.users.update_one({"id": user["id"]}, {"$unset": {"self_exclusion": ""}})
        await push_notification(user["id"], "safety", "Self-exclusion lifted",
                                "Your self-imposed break has ended. Play sensibly.", {})
        return {"ok": True, "excluded": False}
    if body.days < int(s["self_exclusion_min_days"]):
        raise HTTPException(status_code=400, detail=f"The shortest break you can take is {s['self_exclusion_min_days']} day(s)")
    if body.days > int(s["self_exclusion_max_days"]):
        raise HTTPException(status_code=400, detail=f"Self-exclusion can be at most {s['self_exclusion_max_days']} days")
    until = (datetime.now(timezone.utc) + timedelta(days=body.days)).isoformat()
    doc = {"until": until, "days": body.days, "reason": body.reason.strip(), "started_at": now_iso()}
    await db.users.update_one({"id": user["id"]}, {"$set": {"self_exclusion": doc}})
    await push_notification(user["id"], "safety", "Self-exclusion is active",
                            f"You cannot join contests or add money until {until[:10]}. "
                            "Winnings can still be withdrawn.", {"until": until})
    return {"ok": True, "excluded": True, "self_exclusion": doc,
            "balance_held": float(user.get("wallet_balance") or 0)}


@api_router.post("/me/self-exclude/lift")
async def self_exclude_lift(body: LiftBody, user=Depends(get_current_user)):
    if not _is_excluded(user):
        return {"ok": True, "excluded": False}
    if not body.ack:
        raise HTTPException(status_code=400, detail="Confirm that you understand the break is a protective measure")
    s = await get_safety_settings()
    if not s["allow_self_lift_exclusion"]:
        raise HTTPException(status_code=403, detail="Self-exclusion can only be lifted by the organiser. "
                                                   "Use the help section and we will review your request.")
    await db.users.update_one({"id": user["id"]}, {"$unset": {"self_exclusion": ""}})
    return {"ok": True, "excluded": False}


@api_router.put("/me/kyc")
async def submit_kyc(body: KycBody, user=Depends(get_current_user)):
    pan = body.pan.strip().upper()
    if not PAN_RE.match(pan):
        raise HTTPException(status_code=400, detail="Enter a valid 10-character PAN, e.g. ABCDE1234F")
    existing = user.get("kyc") or {}
    if existing.get("status") == "verified" and existing.get("pan_masked") != _mask_pan(pan):
        raise HTTPException(status_code=400, detail="Contact the organiser to change a verified PAN")
    doc = {"status": "pending", "name": body.full_name.strip(), "pan_masked": _mask_pan(pan),
           "pan_hash": hashlib.sha256(pan.encode()).hexdigest()[:16], "submitted_at": now_iso(), "note": ""}
    await db.users.update_one({"id": user["id"]}, {"$set": {"kyc": doc}})
    return {"ok": True, "kyc": {"status": doc["status"], "name": doc["name"], "pan": doc["pan_masked"]}}


class AdminSafetyBody(BaseModel):
    deposit_limit_daily: Optional[float] = Field(default=None, ge=0, le=1000000)
    exclude_days: Optional[int] = Field(default=None, ge=0, le=3650)
    lift_exclusion: Optional[bool] = None
    note: Optional[str] = Field(default=None, max_length=200)


@api_router.post("/admin/users/{user_id}/safety")
async def admin_user_safety(user_id: str, body: AdminSafetyBody, admin=Depends(require_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    updates = {"safety_updated_at": now_iso(), "safety_by": admin["id"]}
    if body.deposit_limit_daily is not None:
        updates["deposit_limit_daily"] = round(float(body.deposit_limit_daily), 2)
    if body.exclude_days:
        until = (datetime.now(timezone.utc) + timedelta(days=body.exclude_days)).isoformat()
        updates["self_exclusion"] = {"until": until, "days": body.exclude_days,
                                    "reason": (body.note or "Excluded by organiser").strip()[:200],
                                    "started_at": now_iso(), "by_admin": True}
    if body.lift_exclusion:
        updates["self_exclusion_lifted_at"] = now_iso()
    await db.users.update_one({"id": user_id}, {"$set": updates})
    if body.lift_exclusion:
        await db.users.update_one({"id": user_id}, {"$unset": {"self_exclusion": ""}})
    await push_notification(user_id, "safety", "Account restriction updated",
                            body.note or "The organiser updated the play-safety settings on your account.", {})
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    return {"ok": True, "user": {"id": fresh["id"], "name": fresh.get("name"),
                                 "deposit_limit_daily": float(fresh.get("deposit_limit_daily") or 0),
                                 "self_exclusion": fresh.get("self_exclusion") or {},
                                 "kyc": fresh.get("kyc") or {}}}


class KycDecisionBody(BaseModel):
    decision: str = Field(pattern="^(verified|rejected)$")
    note: str = Field(default="", max_length=200)


@api_router.post("/admin/users/{user_id}/kyc")
async def admin_user_kyc(user_id: str, body: KycDecisionBody, admin=Depends(require_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    kyc = dict(target.get("kyc") or {})
    if not kyc.get("pan_masked"):
        raise HTTPException(status_code=400, detail="This user has not submitted a PAN yet")
    kyc.update({"status": body.decision, "note": body.note.strip(),
                "reviewed_at": now_iso(), "reviewed_by": admin["id"]})
    await db.users.update_one({"id": user_id}, {"$set": {"kyc": kyc}})
    await push_notification(
        user_id, "kyc", "KYC " + ("verified" if body.decision == "verified" else "not accepted"),
        ("Your PAN is verified — withdrawals are unlocked." if body.decision == "verified"
         else f"We could not verify your PAN. {body.note}".strip()), {})
    return {"ok": True, "kyc": {"status": kyc["status"], "pan": kyc.get("pan_masked"),
                                "name": kyc.get("name"), "note": kyc.get("note")}}


class SafetySettingsBody(BaseModel):
    allow_user_deposit_limit: Optional[bool] = None
    default_deposit_limit_daily: Optional[float] = Field(default=None, ge=0, le=1000000)
    max_deposit_limit_daily: Optional[float] = Field(default=None, ge=0, le=1000000)
    allow_self_exclusion: Optional[bool] = None
    self_exclusion_min_days: Optional[int] = Field(default=None, ge=1, le=365)
    self_exclusion_max_days: Optional[int] = Field(default=None, ge=1, le=3650)
    allow_self_lift_exclusion: Optional[bool] = None
    reality_check_default_minutes: Optional[int] = Field(default=None, ge=0, le=600)
    reality_check_message: Optional[str] = Field(default=None, max_length=400)
    max_daily_spend: Optional[float] = Field(default=None, ge=0, le=1000000)
    kyc_required_for_payouts: Optional[bool] = None
    support_email: Optional[str] = Field(default=None, max_length=120)
    helpline: Optional[str] = Field(default=None, max_length=60)


@api_router.get("/admin/safety")
async def admin_safety(q: Optional[str] = None, limit: int = Query(200, ge=1, le=1000),
                       admin=Depends(require_admin)):
    s = await get_safety_settings()
    users = await db.users.find({"role": "user"}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    restricted, kyc_pending = [], []
    for u in users:
        row = {"id": u["id"], "name": u.get("name"), "mobile": u.get("mobile"),
               "wallet_balance": float(u.get("wallet_balance") or 0),
               "deposit_limit_daily": float(u.get("deposit_limit_daily") or 0),
               "deposited_today": await deposited_today(u),
               "spent_today": round(await spend_today(u["id"]), 2),
               "self_exclusion": u.get("self_exclusion") or {},
               "excluded": _is_excluded(u),
               "kyc": {"status": (u.get("kyc") or {}).get("status", "none"),
                       "name": (u.get("kyc") or {}).get("name"),
                       "pan": (u.get("kyc") or {}).get("pan_masked"),
                       "submitted_at": (u.get("kyc") or {}).get("submitted_at")}}
        if q:
            hay = f"{row['name']} {row['mobile']}".lower()
            if q.lower() not in hay:
                continue
        if row["excluded"] or row["deposit_limit_daily"]:
            restricted.append(row)
        if row["kyc"]["status"] == "pending":
            kyc_pending.append(row)
    return {"settings": s, "restricted": restricted, "kyc_pending": kyc_pending,
            "counts": {"users": len(users), "excluded": sum(1 for r in restricted if r["excluded"]),
                       "kyc_pending": len(kyc_pending)}}


@api_router.put("/admin/safety")
async def admin_put_safety(body: SafetySettingsBody, admin=Depends(require_admin)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if (updates.get("self_exclusion_min_days") or 0) > (updates.get("self_exclusion_max_days") or 0):
        raise HTTPException(status_code=400, detail="Minimum exclusion cannot exceed the maximum")
    updates["key"] = "safety"
    updates["updated_at"] = now_iso()
    updates["updated_by"] = admin["id"]
    await db.settings.update_one({"key": "safety"}, {"$set": updates}, upsert=True)
    return await get_safety_settings()


# ---------- FAQ + support tickets ----------
FAQ_DEFAULTS = [
    {"q": "How are fantasy points calculated?",
     "a": "Exactly like the points screen in a contest: runs, boundaries, milestones, wickets, maidens, "
          "catches, stumpings, run-outs and strike/economy bonuses. The captain counts double and the "
          "vice-captain 1.5x. Every entry is scored from the scorecard the organiser publishes."},
    {"q": "When do teams lock?",
     "a": "At the scheduled start time of the match. Until then you can edit or delete a saved XI. "
          "Once a match goes live the squads and entries are frozen."},
    {"q": "When do I get my winnings?",
     "a": "As soon as the organiser settles the contest, prize money is credited to your in-app wallet. "
          "From the wallet you can request a payout to your own UPI; the transaction reference (UTR) "
          "appears in the Withdrawals tab once the transfer completes."},
    {"q": "What if a match is abandoned?",
     "a": "Contests that cannot be completed are refunded — the full entry fee goes back to your wallet "
          "and you get a notification. Refunded entries are marked clearly in My Entries."},
    {"q": "How do I add money?",
     "a": "Use Add money for a UPI or card payment, or pay an entry fee directly from your wallet. "
          "Deposits are instant and you can set your own daily deposit limit in Play responsibly."},
    {"q": "Is this gambling?",
     "a": "PitchPlay is a skill-based fantasy game: every entry depends on your knowledge of cricket. "
          "You must be 18 or older and real-money skill games are restricted in some Indian states, "
          "so check your local rules. You can lose your entry fee — never play to chase losses."},
]
FAQ_MIN_LENGTH = 2


class FaqItem(BaseModel):
    q: str = Field(min_length=4, max_length=200)
    a: str = Field(min_length=FAQ_MIN_LENGTH, max_length=1200)


class FaqBody(BaseModel):
    items: List[FaqItem] = Field(min_length=1, max_length=40)


async def get_faq() -> list:
    s = await db.settings.find_one({"key": "faq"}, {"_id": 0}) or {}
    items = s.get("items")
    return items if isinstance(items, list) and items else list(FAQ_DEFAULTS)


@api_router.get("/legal/faq")
async def legal_faq(user=Depends(get_current_user)):
    return {"items": await get_faq()}


@api_router.put("/admin/faq")
async def admin_put_faq(body: FaqBody, admin=Depends(require_admin)):
    items = [i.model_dump() for i in body.items]
    await db.settings.update_one({"key": "faq"}, {"$set": {"key": "faq", "items": items,
                                                           "updated_at": now_iso(), "updated_by": admin["id"]}},
                                 upsert=True)
    return {"items": await get_faq()}


class TicketBody(BaseModel):
    subject: str = Field(min_length=4, max_length=140)
    message: str = Field(min_length=10, max_length=2000)
    category: str = Field(default="other", max_length=30)
    contest_id: Optional[str] = None
    entry_id: Optional[str] = None
    withdrawal_id: Optional[str] = None


class TicketReplyBody(BaseModel):
    message: str = Field(min_length=2, max_length=2000)
    status: str = Field(default="answered", pattern="^(open|answered|resolved|closed)$")


TICKET_CATEGORIES = ("payment", "entry", "scorecard", "payout", "account", "safety", "other")


@api_router.post("/support/tickets")
async def create_ticket(body: TicketBody, user=Depends(get_current_user)):
    category = (body.category or "other").strip().lower()
    if category not in TICKET_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Category must be one of {', '.join(TICKET_CATEGORIES)}")
    doc = {
        "id": str(uuid.uuid4()), "user_id": user["id"], "user_name": user.get("name"),
        "user_mobile": user.get("mobile"), "subject": body.subject.strip(), "message": body.message.strip(),
        "category": category, "contest_id": body.contest_id, "entry_id": body.entry_id,
        "withdrawal_id": body.withdrawal_id, "status": "open", "replies": [],
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.support_tickets.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/support/tickets/mine")
async def my_tickets(user=Depends(get_current_user)):
    return await db.support_tickets.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)


@api_router.get("/support/tickets/{ticket_id}")
async def one_ticket(ticket_id: str, user=Depends(get_current_user)):
    t = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if t.get("user_id") != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=404, detail="Ticket not found")
    return t


@api_router.get("/admin/tickets")
async def admin_tickets(status: Optional[str] = None, category: Optional[str] = None,
                        limit: int = Query(200, ge=1, le=1000), admin=Depends(require_admin)):
    q = {}
    if status:
        q["status"] = status
    if category:
        q["category"] = category
    return await db.support_tickets.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)


@api_router.post("/admin/tickets/{ticket_id}/reply")
async def admin_ticket_reply(ticket_id: str, body: TicketReplyBody, admin=Depends(require_admin)):
    t = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    reply = {"at": now_iso(), "by": admin.get("name") or "support", "message": body.message.strip()}
    await db.support_tickets.update_one({"id": ticket_id}, {"$push": {"replies": reply},
                                                            "$set": {"status": body.status, "updated_at": now_iso()}})
    await push_notification(t["user_id"], "support", f"Reply to “{t['subject'][:60]}”",
                            reply["message"], {"ticket_id": ticket_id, "status": body.status})
    return {"ok": True, "ticket": {**t, "replies": list(t.get("replies") or []) + [reply],
                                   "status": body.status}}


# ---------- Growth: referrals, streaks, badges, season ladder, broadcast ----------
#
# Referral rewards are OFF by default and pay out as non-withdrawable bonus cash,
# so switching them on cannot create a withdrawable liability by accident.

GROWTH_DEFAULTS = {
    "referral_enabled": False,
    "referee_bonus": 0.0,        # bonus cash the new player gets
    "referrer_reward": 0.0,      # bonus cash the inviter gets per converted friend
    "referral_min_deposit": 100.0,  # the friend must deposit this much first
    "season_name": "Season 1",
    "season_start": None,        # ISO date; null = all-time
}


async def get_growth_settings() -> dict:
    s = await db.settings.find_one({"key": "growth"}, {"_id": 0}) or {}
    out = dict(GROWTH_DEFAULTS)
    for k in out:
        if s.get(k) is not None:
            out[k] = s[k]
    for k in ("referee_bonus", "referrer_reward", "referral_min_deposit"):
        try:
            out[k] = round(float(out[k] or 0), 2)
        except (TypeError, ValueError):
            out[k] = 0.0
    out["referral_enabled"] = bool(out["referral_enabled"])
    return out


class GrowthBody(BaseModel):
    referral_enabled: Optional[bool] = None
    referee_bonus: Optional[float] = Field(None, ge=0, le=100000)
    referrer_reward: Optional[float] = Field(None, ge=0, le=100000)
    referral_min_deposit: Optional[float] = Field(None, ge=0, le=10000000)
    season_name: Optional[str] = Field(None, max_length=40)
    season_start: Optional[str] = None


@api_router.get("/admin/growth")
async def admin_get_growth(admin=Depends(require_admin)):
    return await get_growth_settings()


@api_router.put("/admin/growth")
async def admin_put_growth(body: GrowthBody, admin=Depends(require_admin)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "season_name" in updates:
        updates["season_name"] = updates["season_name"].strip() or GROWTH_DEFAULTS["season_name"]
    updates["key"] = "growth"
    updates["updated_at"] = now_iso()
    await db.settings.update_one({"key": "growth"}, {"$set": updates}, upsert=True)
    return await get_growth_settings()


CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no I/O/0/1 so codes survive being read aloud


def _make_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))


async def ensure_referral_code(user_id: str) -> str:
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "referral_code": 1}) or {}
    if u.get("referral_code"):
        return u["referral_code"]
    for _ in range(12):
        code = _make_code()
        try:
            await db.users.update_one({"id": user_id, "referral_code": None}, {"$set": {"referral_code": code}}, upsert=False)
        except Exception:
            continue
        fresh = await db.users.find_one({"id": user_id}, {"_id": 0, "referral_code": 1}) or {}
        if fresh.get("referral_code") == code:
            return code
        if fresh.get("referral_code"):
            return fresh["referral_code"]
    return ""


async def attribute_referral(user_id: str, ref: Optional[str]) -> None:
    """Record who invited a brand-new account. Bad or self codes are ignored."""
    code = (ref or "").strip().upper()
    if len(code) != 6:
        return
    inviter = await db.users.find_one({"referral_code": code}, {"_id": 0, "id": 1, "name": 1})
    if not inviter or inviter["id"] == user_id:
        return
    await db.users.update_one({"id": user_id}, {"$set": {"referred_by": inviter["id"], "referred_at": now_iso()}})


async def maybe_pay_referral_bonus(user_id: str) -> Optional[dict]:
    """Pay both sides once the invitee's lifetime deposits clear the bar."""
    g = await get_growth_settings()
    if not g["referral_enabled"]:
        return None
    me = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not me or not me.get("referred_by") or me.get("referral_rewarded"):
        return None
    if float(me.get("total_deposited") or 0) + 0.001 < g["referral_min_deposit"]:
        return None
    await db.users.update_one({"id": user_id}, {"$set": {"referral_rewarded": True, "referral_rewarded_at": now_iso()}})
    paid = {"referee": 0.0, "referrer": 0.0}
    if g["referee_bonus"] > 0:
        await credit_bonus(user_id, g["referee_bonus"], "Welcome bonus from your invite", "referral")
        paid["referee"] = g["referee_bonus"]
        await push_notification(user_id, "wallet", f"{inr(g['referee_bonus'])} welcome bonus 🎉",
                                "Your first deposit unlocked a bonus you can spend on entry fees.")
    inviter = await db.users.find_one({"id": me["referred_by"]}, {"_id": 0, "id": 1, "name": 1})
    if inviter and g["referrer_reward"] > 0:
        await credit_bonus(inviter["id"], g["referrer_reward"], f"Friend bonus · {me.get('name')}", "referral")
        paid["referrer"] = g["referrer_reward"]
        await push_notification(inviter["id"], "wallet", f"{inr(g['referrer_reward'])} for inviting {me.get('name')} 🎁",
                                "Bonus cash is in your account and ready to use on entry fees.")
    return {"paid": paid, "inviter": inviter["id"] if inviter else None}


@api_router.get("/me/referral")
async def my_referral(user=Depends(get_current_user)):
    g = await get_growth_settings()
    code = await ensure_referral_code(user["id"])
    invited = await db.users.find({"referred_by": user["id"]}, {"_id": 0, "name": 1, "referred_at": 1,
                                                               "referral_rewarded": 1}).to_list(500)
    rewarded = [i for i in invited if i.get("referral_rewarded")]
    origin = (user.get("referred_by") and (await db.users.find_one({"id": user["referred_by"]}, {"_id": 0, "name": 1}))) or None
    return {
        "enabled": g["referral_enabled"],
        "code": code,
        "share_text": (f"Join my PitchPlay contest — pick an XI, win real money. "
                       f"Use my invite code {code} when you sign up."),
        "referee_bonus": g["referee_bonus"],
        "referrer_reward": g["referrer_reward"],
        "min_deposit": g["referral_min_deposit"],
        "invited": [{"name": (i.get("name") or "Player").split(" ")[0], "at": i.get("referred_at"),
                     "rewarded": bool(i.get("referral_rewarded"))} for i in invited],
        "invited_count": len(invited),
        "rewarded_count": len(rewarded),
        "earned": round(sum(g["referrer_reward"] for _ in rewarded), 2),
        "invited_by": origin.get("name") if origin else None,
    }


BADGES = [
    {"key": "first_team", "label": "Team Registered", "hint": "Built your first XI", "icon": "Flag"},
    {"key": "first_entry", "label": "On The Pitch", "hint": "Joined your first contest", "icon": "Ticket"},
    {"key": "first_win", "label": "Champion", "hint": "Won a settled contest", "icon": "Trophy"},
    {"key": "three_top", "label": "Podium Regular", "hint": "Three top-3 finishes", "icon": "ChartBar"},
    {"key": "century", "label": "Ton Club", "hint": "Scored 100+ points in a match", "icon": "Lightning"},
    {"key": "week_streak", "label": "Seven Days Straight", "hint": "Played in three consecutive weeks", "icon": "Timer"},
    {"key": "season_50", "label": "Season Grinder", "hint": "Fifty contests played", "icon": "ShieldCheck"},
]


def _week_of(iso: str) -> tuple:
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return (0, 0)
    return d.isocalendar()[:2]


async def compute_badges(user_id: str) -> dict:
    entries = await db.entries.find({"user_id": user_id}, {"_id": 0}).to_list(5000)
    teams = await db.fantasy_teams.count_documents({"user_id": user_id})
    played = [e for e in entries if e.get("status") in ("approved", "won")]
    won = [e for e in entries if e.get("status") == "won"]
    ranks = [int(e["fantasy_rank"]) for e in entries if e.get("fantasy_rank")]
    points = [float(e.get("fantasy_points") or 0) for e in entries if e.get("fantasy_points")]
    weeks = sorted({_week_of(e.get("created_at")) for e in played if e.get("created_at")} - {(0, 0)})
    streak = 1
    best_streak = 1 if weeks else 0
    for i in range(1, len(weeks)):
        prev_y, prev_w = weeks[i - 1]
        cur_y, cur_w = weeks[i]
        # consecutive ISO week, accounting for the year rollover
        expected = (prev_y, prev_w + 1) if prev_w < 52 else (prev_y + 1, 1)
        if weeks[i] == expected:
            streak += 1
        else:
            streak = 1
        best_streak = max(best_streak, streak)
    earned = {
        "first_team": teams > 0,
        "first_entry": len(played) > 0,
        "first_win": len(won) > 0,
        "three_top": len([r for r in ranks if r <= 3]) >= 3,
        "century": any(p >= 100 for p in points),
        "week_streak": best_streak >= 3,
        "season_50": len(played) >= 50,
    }
    return {
        "badges": [{**b, "earned": bool(earned.get(b["key"]))} for b in BADGES],
        "earned_count": sum(1 for b in BADGES if earned.get(b["key"])),
        "week_streak": best_streak,
        "weeks_played": len(weeks),
    }


@api_router.get("/me/badges")
async def my_badges(user=Depends(get_current_user)):
    return await compute_badges(user["id"])


@api_router.get("/leaderboard/season")
async def season_leaderboard(limit: int = Query(50, ge=5, le=200), user=Depends(get_current_user)):
    """Rank players by points scored across settled contests this season."""
    g = await get_growth_settings()
    since = g.get("season_start")
    q = {"fantasy_points": {"$gt": -1_000_000}}
    if since:
        q["created_at"] = {"$gte": since}
    agg: dict = {}
    rows_in = await db.entries.find(q, {"_id": 0, "user_id": 1, "user_name": 1, "fantasy_points": 1,
                                        "fantasy_rank": 1, "status": 1, "winner_prize": 1,
                                        "entry_fee": 1}).to_list(50000)
    for e in rows_in:
        uid = e.get("user_id")
        if not uid:
            continue
        row = agg.setdefault(uid, {"user_id": uid, "name": e.get("user_name") or "Player", "points": 0.0,
                                   "contests": 0, "wins": 0, "top3": 0, "winnings": 0.0, "wagered": 0.0})
        pts = float(e.get("fantasy_points") or 0)
        row["points"] += pts
        if e.get("status") in ("approved", "won"):
            row["contests"] += 1
            row["wagered"] += float(e.get("entry_fee") or 0)
        if e.get("status") == "won":
            row["wins"] += 1
            row["winnings"] += float(e.get("winner_prize") or 0)
        if e.get("fantasy_rank") and int(e["fantasy_rank"]) <= 3:
            row["top3"] += 1
    rows = sorted(agg.values(), key=lambda r: (-r["points"], -r["wins"]))[:limit]
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
        r["points"] = round(r["points"], 1)
        r["winnings"] = round(r["winnings"], 2)
        r["wagered"] = round(r["wagered"], 2)
        r["is_me"] = r["user_id"] == user["id"]
    me_row = next((r for r in rows if r["is_me"]), None)
    if not me_row and user["id"] in agg:
        full = sorted(agg.values(), key=lambda r: (-r["points"], -r["wins"]))
        pos = next((i for i, r in enumerate(full, start=1) if r["user_id"] == user["id"]), None)
        if pos:
            mine = agg[user["id"]]
            me_row = {**mine, "rank": pos, "points": round(mine["points"], 1), "is_me": True,
                      "winnings": round(mine["winnings"], 2), "wagered": round(mine["wagered"], 2)}
    return {"season": g["season_name"], "season_start": since, "rows": rows, "me": me_row,
            "total_players": len(agg)}


# --- Device push tokens + admin broadcast ---
class PushTokenBody(BaseModel):
    token: str = Field(..., min_length=8, max_length=400)
    platform: Optional[str] = "android"


@api_router.post("/me/push-token")
async def register_push_token(body: PushTokenBody, user=Depends(get_current_user)):
    await db.push_tokens.update_one(
        {"token": body.token},
        {"$set": {"token": body.token, "user_id": user["id"], "platform": (body.platform or "android")[:20],
                  "updated_at": now_iso()}},
        upsert=True,
    )
    return {"ok": True}


@api_router.delete("/me/push-token")
async def unregister_push_token(token: str = Query(...), user=Depends(get_current_user)):
    await db.push_tokens.delete_many({"token": token, "user_id": user["id"]})
    return {"ok": True}


async def send_server_push(title: str, body: str, data: Optional[dict] = None) -> dict:
    """Best-effort FCM send. Without a Firebase project configured the in-app
    notification is still the delivery channel, so this only reports what it did."""
    project = os.environ.get("FCM_PROJECT_ID", "").strip()
    creds_path = os.environ.get("FCM_SERVICE_ACCOUNT_FILE", "").strip()
    tokens = [t["token"] async for t in db.push_tokens.find({}, {"_id": 0, "token": 1}).limit(5000)]
    if not project or not creds_path or not Path(creds_path).exists():
        return {"sent": 0, "skipped": len(tokens), "reason": "firebase_not_configured"}
    try:
        from firebase_admin import credentials, initialize_app, messaging  # noqa: WPS433
    except ImportError:
        return {"sent": 0, "skipped": len(tokens), "reason": "firebase_admin_not_installed"}
    try:
        initialize_app(credentials.Certificate(creds_path))
    except ValueError:
        pass  # already initialised by an earlier broadcast
    except Exception:
        logger.exception("Firebase init failed")
        return {"sent": 0, "skipped": len(tokens), "reason": "firebase_init_failed"}
    msgs = [messaging.Message(
        token=t, notification=messaging.Notification(title=title[:110], body=body[:240]),
        data={k: str(v) for k, v in (data or {}).items()},
    ) for t in tokens]
    ok = 0
    for chunk_start in range(0, len(msgs), 500):
        try:
            res = messaging.send_each(msgs[chunk_start:chunk_start + 500])
            ok += sum(1 for r in res.responses if r.success)
        except Exception:
            logger.exception("FCM batch failed")
    return {"sent": ok, "skipped": len(tokens) - ok, "reason": "firebase"}


class BroadcastBody(BaseModel):
    title: str = Field(..., min_length=3, max_length=110)
    body: str = Field(..., min_length=1, max_length=400)
    link: Optional[str] = None
    audience: Optional[str] = "all"  # all | players | depositors


@api_router.post("/admin/broadcast")
async def admin_broadcast(body: BroadcastBody, admin=Depends(require_admin)):
    q = {}
    if body.audience == "players":
        q = {"role": "user"}
    elif body.audience == "depositors":
        q = {"role": "user", "total_deposited": {"$gt": 0}}
    else:
        q = {"role": "user"}
    sent = 0
    recipients = await db.users.find(q, {"_id": 0, "id": 1}).to_list(20000)
    for u in recipients:
        await push_notification(u["id"], "news", body.title.strip(), body.body.strip(),
                                {"link": body.link} if body.link else None)
        sent += 1
    push = await send_server_push(body.title.strip(), body.body.strip(), {"link": body.link or ""})
    return {"ok": True, "in_app": sent, "push": push}


# ---------- Ops: rate limiting, settlement tax, bonus wallet, automations, OTP ----------
#
# Everything here is deliberately conservative for a real-money app: limits default to
# OFF/0 until the operator switches them on, and nothing moves money without an
# explicit admin action or an existing user-initiated request.

RATE_RULES = {
    "auth": (10, 300),        # failed login / signup attempts per identity
    "otp_request": (5, 600),  # codes per mobile
    "otp_request_ip": (60, 600),  # codes per IP — Indian carrier NAT puts many
                                  # genuine users behind one gateway address, so
                                  # this stays far looser than the per-mobile cap
    "otp_verify": (10, 600),  # guesses per mobile
    "join": (30, 600),        # contest joins per user
    "withdraw": (10, 600),    # withdrawal requests per user
    "topup": (12, 600),       # top-up orders per user
    "ticket": (6, 600),       # support tickets per user
}
_rate_hits: dict = {}


def client_ip(request: Optional[Request]) -> str:
    if request is None:
        return "unknown"
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit_check(scope: str, key: str) -> None:
    """Raise 429 when this identity already has too many recorded attempts.

    Fixed-window and in-memory: single-process only — good enough for one backend
    instance, and it fails open (never locks anyone out) across a restart, which is
    the right trade for a login screen."""
    limit, window = RATE_RULES.get(scope, (30, 60))
    ident = f"{scope}:{key}"
    now = time.monotonic()
    hits = [t for t in _rate_hits.get(ident, []) if now - t < window]
    _rate_hits[ident] = hits
    if len(hits) >= limit:
        retry = int(window - (now - hits[0])) + 1
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Please wait a moment and try again.",
            headers={"Retry-After": str(retry)},
        )


def rate_limit_hit(scope: str, key: str) -> None:
    """Record one attempt (call this only for the attempts worth counting)."""
    _, window = RATE_RULES.get(scope, (30, 60))
    ident = f"{scope}:{key}"
    now = time.monotonic()
    _rate_hits[ident] = [t for t in _rate_hits.get(ident, []) if now - t < window] + [now]


def rate_limit_clear(scope: str, key: str) -> None:
    _rate_hits.pop(f"{scope}:{key}", None)


def rate_limit(scope: str, key: str) -> None:
    """Check + record in one call — for endpoints where every call costs something
    (sending an SMS, creating an order)."""
    rate_limit_check(scope, key)
    rate_limit_hit(scope, key)


# --- Settlement tax (TDS-style columns on every prize). 0 = disabled until the
#     operator confirms the rate and section with their CA. ---
TAX_MAX_PERCENT = float(os.environ.get("TAX_MAX_PERCENT", "30"))


async def get_settlement_settings() -> dict:
    s = await db.settings.find_one({"key": "settlement"}, {"_id": 0}) or {}
    try:
        pct = float(s.get("tax_percent") or 0)
    except (TypeError, ValueError):
        pct = 0.0
    return {
        "tax_percent": round(min(max(pct, 0.0), TAX_MAX_PERCENT), 2),
        "tax_section": (s.get("tax_section") or "").strip(),
        "bonus_join_enabled": bool(s.get("bonus_join_enabled", True)),
        "auto_close": bool(s.get("auto_close", True)),
        "auto_settle": bool(s.get("auto_settle", False)),
        "settle_grace_minutes": int(s.get("settle_grace_minutes") or 30),
        "updated_at": s.get("updated_at"),
    }


def split_prize(amount, tax_percent: float) -> tuple:
    """(gross, tax, net) for one prize row, rounded to paise."""
    gross = round(float(amount or 0), 2)
    pct = float(tax_percent or 0)
    tax = round(gross * pct / 100.0, 2) if pct > 0 else 0.0
    return gross, tax, round(gross - tax, 2)


class SettlementBody(BaseModel):
    tax_percent: float = Field(0, ge=0, le=100)
    tax_section: Optional[str] = None
    bonus_join_enabled: Optional[bool] = None
    auto_close: Optional[bool] = None
    auto_settle: Optional[bool] = None
    settle_grace_minutes: Optional[int] = Field(None, ge=0, le=10080)


async def _set_settlement(updates: dict) -> dict:
    updates = {k: v for k, v in updates.items() if v is not None}
    updates["key"] = "settlement"
    updates["updated_at"] = now_iso()
    await db.settings.update_one({"key": "settlement"}, {"$set": updates}, upsert=True)
    return await get_settlement_settings()


@api_router.get("/admin/settlement")
async def admin_get_settlement(admin=Depends(require_admin)):
    return await get_settlement_settings()


@api_router.put("/admin/settlement")
async def admin_put_settlement(body: SettlementBody, admin=Depends(require_admin)):
    if body.tax_percent > TAX_MAX_PERCENT:
        raise HTTPException(status_code=400, detail=f"Tax rate cannot exceed {TAX_MAX_PERCENT:g}%")
    data = body.model_dump()
    data["tax_section"] = (data.get("tax_section") or "").strip()[:40]
    out = await _set_settlement(data)
    return out


# --- Bonus wallet: promo money that can buy entry fees but can never be withdrawn ---
async def credit_bonus(user_id: str, amount: float, note: str, by: str) -> dict:
    amount = round(float(amount), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Bonus amount must be positive")
    await db.users.update_one({"id": user_id}, {"$inc": {"bonus_balance": amount}})
    log = {
        "id": str(uuid.uuid4()), "user_id": user_id, "amount": amount,
        "note": note, "by": by, "kind": "bonus", "created_at": now_iso(),
    }
    await db.wallet_logs.insert_one(log)
    log.pop("_id", None)
    return log


class BonusBody(BaseModel):
    amount: float = Field(..., gt=0, le=1000000)
    note: Optional[str] = None


@api_router.post("/admin/users/{user_id}/bonus")
async def admin_grant_bonus(user_id: str, body: BonusBody, admin=Depends(require_admin)):
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if u.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Cannot grant bonus to an admin")
    log = await credit_bonus(user_id, body.amount, (body.note or "Bonus credit from PitchPlay").strip()[:160], "admin")
    await push_notification(
        user_id, "wallet", f"{inr(body.amount)} bonus added 🎁",
        f"{inr(body.amount)} bonus cash is in your account. Use it on entry fees — it is not withdrawable.",
        {"bonus": body.amount},
    )
    return {"ok": True, "bonus_balance": round(float(u.get("bonus_balance") or 0) + body.amount, 2), "log": log}


# --- Phone OTP: pluggable provider, mock by default so the flow is testable ---
OTP_TTL_SECONDS = int(os.environ.get("OTP_TTL_SECONDS", "300"))
OTP_VERIFY_WINDOW = int(os.environ.get("OTP_VERIFY_WINDOW", "600"))  # how long a verified mobile stays usable
OTP_PROVIDER = (os.environ.get("OTP_PROVIDER") or "mock").strip().lower()
MSG91_AUTH_KEY = os.environ.get("MSG91_AUTH_KEY", "").strip()
MSG91_TEMPLATE_ID = os.environ.get("MSG91_TEMPLATE_ID", "").strip()


async def deliver_otp(mobile: str, code: str) -> str:
    """Send the OTP. Returns the channel name; raises 502 if a real provider is
    configured but not usable, so we never silently pretend a code was sent."""
    if OTP_PROVIDER == "mock":
        logger.info("OTP(mock) for %s: %s", mobile[-4:], code)
        return "mock"
    if OTP_PROVIDER == "msg91":
        if not (MSG91_AUTH_KEY and MSG91_TEMPLATE_ID):
            raise HTTPException(status_code=502, detail="OTP provider is not configured. Ask the admin to set MSG91_AUTH_KEY and MSG91_TEMPLATE_ID.")
        try:
            r = requests.post(
                f"https://api.msg91.com/api/v5/flow/?template_id={MSG91_TEMPLATE_ID}&mobile_no={mobile}&auth={MSG91_AUTH_KEY}",
                json={"mobile_no": mobile, "template_id": MSG91_TEMPLATE_ID,
                      "variables": {"otp": code}, "sender": "TestR4", "country": "91"},
                timeout=15,
            )
        except requests.RequestException:
            raise HTTPException(status_code=502, detail="Could not reach the SMS provider. Try again in a minute.")
        if r.status_code >= 400:
            logger.error("msg91 OTP failed: %s %s", r.status_code, r.text[:300])
            raise HTTPException(status_code=502, detail="The SMS provider rejected the request. Try again shortly.")
        return "msg91"
    raise HTTPException(status_code=500, detail=f"Unknown OTP provider '{OTP_PROVIDER}'")


class OtpRequestBody(BaseModel):
    mobile: str


class OtpVerifyBody(BaseModel):
    mobile: str
    code: str


async def _issue_otp(mobile: str) -> tuple:
    code = f"{secrets.randbelow(1_000_000):06d}"
    await db.otps.update_one(
        {"mobile": mobile},
        {"$set": {"code_hash": hash_password(code), "mobile": mobile, "tries": 0, "verified": False,
                  "created_at": now_iso(), "expires_at": _iso_after(OTP_TTL_SECONDS)}},
        upsert=True,
    )
    return code


def _iso_after(seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


@api_router.post("/auth/otp/request")
async def otp_request(body: OtpRequestBody, request: Request):
    mobile = re.sub(r"\D", "", body.mobile or "")[-10:]
    if len(mobile) != 10:
        raise HTTPException(status_code=400, detail="Enter a valid 10-digit mobile number")
    rate_limit("otp_request", mobile)
    rate_limit("otp_request_ip", client_ip(request))
    code = await _issue_otp(mobile)
    channel = await deliver_otp(mobile, code)
    out = {"ok": True, "mobile": mobile, "channel": channel, "expires_in": OTP_TTL_SECONDS,
           "registered": bool(await db.users.find_one({"mobile": mobile}, {"_id": 0}))}
    if channel == "mock":
        # Local/demo only: the code is shown so the flow can be exercised without an SMS gateway.
        out["dev_code"] = code
    return out


@api_router.post("/auth/otp/verify")
async def otp_verify(body: OtpVerifyBody, request: Request):
    mobile = re.sub(r"\D", "", body.mobile or "")[-10:]
    code = (body.code or "").strip()
    vkey = f"otp_verify:{mobile}"
    rate_limit_check("otp_verify", vkey)
    rec = await db.otps.find_one({"mobile": mobile})
    if not rec:
        raise HTTPException(status_code=400, detail="Request a code first")
    if datetime.fromisoformat(rec["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="That code has expired. Request a new one.")
    if int(rec.get("tries") or 0) >= 5:
        raise HTTPException(status_code=429, detail="Too many wrong attempts. Request a fresh code.")
    if not verify_password(code, rec["code_hash"]):
        rate_limit_hit("otp_verify", vkey)
        await db.otps.update_one({"mobile": mobile}, {"$inc": {"tries": 1}})
        raise HTTPException(status_code=401, detail="Incorrect code")
    rate_limit_clear("otp_verify", vkey)
    # Keep a short-lived "verified" marker so /auth/otp/signup can trust the mobile.
    await db.otps.update_one(
        {"mobile": mobile},
        {"$set": {"code_hash": "", "verified": True, "tries": 0, "verified_at": now_iso(),
                  "expires_at": _iso_after(OTP_VERIFY_WINDOW)}},
    )
    user = await db.users.find_one({"mobile": mobile}, {"_id": 0})
    if not user:
        return {"ok": True, "verified": True, "needs_signup": True, "mobile": mobile}
    if user.get("blocked"):
        raise HTTPException(status_code=403, detail="Your account is blocked. Contact admin.")
    token = create_token(user["id"], user["role"])
    return {"ok": True, "verified": True, "token": token, "user": sanitize_user(user, hide_mobile=False)}


class OtpSignupBody(BaseModel):
    mobile: str
    name: str
    password: str = Field(..., min_length=4, max_length=72)
    ref: Optional[str] = Field(None, max_length=16)  # inviter's referral code


@api_router.post("/auth/otp/signup")
async def otp_signup(body: OtpSignupBody, request: Request):
    """Create the account after the mobile has been OTP-verified."""
    mobile = re.sub(r"\D", "", body.mobile or "")[-10:]
    skey = f"otpsignup:{mobile}:{client_ip(request)}"
    rate_limit_check("auth", skey)
    if len(mobile) != 10:
        raise HTTPException(status_code=400, detail="Enter a valid 10-digit mobile number")
    rec = await db.otps.find_one({"mobile": mobile})
    if not rec or not rec.get("verified"):
        rate_limit_hit("auth", skey)
        raise HTTPException(status_code=400, detail="Verify the code sent to your mobile first")
    if datetime.fromisoformat(rec["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Your verification has expired. Verify again.")
    if await db.users.find_one({"mobile": mobile}):
        rate_limit_hit("auth", skey)
        raise HTTPException(status_code=400, detail="Mobile already registered")
    await db.otps.delete_one({"mobile": mobile})
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id, "name": body.name.strip()[:60], "mobile": mobile,
        "password_hash": hash_password(body.password), "role": "user",
        "wallet_balance": 0.0, "bonus_balance": 0.0, "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    await ensure_referral_code(user_id)
    await attribute_referral(user_id, body.ref)
    doc.pop("_id", None)
    return {"token": create_token(user_id, "user"), "user": sanitize_user(doc, hide_mobile=False)}


# --- Automations: close entries at the scheduled start, settle after the match ---
async def auto_close_due_contests() -> int:
    s = await get_settlement_settings()
    if not s["auto_close"]:
        return 0
    now = datetime.now(timezone.utc)
    closed = 0
    due = await db.contests.find({"status": "open", "auto_close_at_start": True}, {"_id": 0}).to_list(500)
    for c in due:
        start = c.get("match_time") or (await db.matches.find_one({"id": c.get("match_id")}, {"_id": 0, "start_time": 1}) or {}).get("start_time")
        if not start:
            continue
        try:
            if datetime.fromisoformat(str(start).replace("Z", "+00:00")) > now:
                continue
        except ValueError:
            continue
        await db.contests.update_one({"id": c["id"]}, {"$set": {"status": "closed", "closed_by": "system", "closed_at": now_iso()}})
        closed += 1
        pending = await db.entries.find({"contest_id": c["id"], "status": "pending"}, {"_id": 0}).to_list(2000)
        for e in pending:
            await push_notification(e["user_id"], "entry", f"Entries closed · {c.get('title')}",
                                    "Your payment is still being checked — the admin will confirm your slot.",
                                    {"contest_id": c["id"]})
    return closed


async def auto_settle_due_contests() -> int:
    s = await get_settlement_settings()
    if not s["auto_settle"]:
        return 0
    admin = await db.users.find_one({"mobile": ADMIN_MOBILE}, {"_id": 0})
    if not admin:
        return 0
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=s["settle_grace_minutes"])).isoformat()
    settled = 0
    done = await db.matches.find({"status": "completed", "scorecard_at": {"$lte": cutoff}}, {"_id": 0}).to_list(200)
    for m in done:
        contests = await db.contests.find({"kind": "fantasy", "match_id": m["id"],
                                           "status": {"$in": ["open", "closed"]}, "settled_at": None}, {"_id": 0}).to_list(200)
        for c in contests:
            try:
                await admin_settle_contest(c["id"], SettleBody(), admin)
                settled += 1
                logger.info("Auto-settled contest %s", c["id"])
            except HTTPException as e:
                logger.warning("Auto-settle skipped %s: %s", c["id"], e.detail)
            except Exception:
                logger.exception("Auto-settle failed for %s", c["id"])
    return settled


_OPS_LOOP_TASK = None


@api_router.post("/admin/ops/run")
async def admin_run_ops(admin=Depends(require_admin)):
    """Run the entry-closing / auto-settle sweep now instead of waiting for the loop."""
    return {"closed": await auto_close_due_contests(), "settled": await auto_settle_due_contests()}


async def _ops_loop():
    while True:
        try:
            await asyncio.sleep(60)
            n = await auto_close_due_contests()
            if n:
                logger.info("Auto-closed %d contest(s)", n)
            n = await auto_settle_due_contests()
            if n:
                logger.info("Auto-settled %d contest(s)", n)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Ops loop iteration failed")


# ---------- Startup ----------
@app.on_event("startup")
async def startup():
    # Seed admin
    admin = await db.users.find_one({"mobile": ADMIN_MOBILE})
    if not admin:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "name": "Admin",
            "mobile": ADMIN_MOBILE,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "role": "admin",
            "wallet_balance": 0.0,
            "created_at": now_iso(),
        })
        logger.info("Admin user seeded")
    else:
        # Ensure role is admin (idempotent)
        await db.users.update_one({"mobile": ADMIN_MOBILE}, {"$set": {"role": "admin"}})
    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    global _OPS_LOOP_TASK
    if _OPS_LOOP_TASK is None:
        _OPS_LOOP_TASK = asyncio.create_task(_ops_loop())
        logger.info("Ops loop started (entry closing + optional auto-settle)")


@app.on_event("shutdown")
async def shutdown_db_client():
    global _OPS_LOOP_TASK
    if _OPS_LOOP_TASK:
        _OPS_LOOP_TASK.cancel()
        _OPS_LOOP_TASK = None
    client.close()


app.include_router(api_router)
_cors_origins = os.environ.get('CORS_ORIGINS', '*').split(',')
_cors_kwargs = {"allow_origin_regex": ".*"} if _cors_origins == ['*'] else {"allow_origins": _cors_origins}
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    **_cors_kwargs,
)
