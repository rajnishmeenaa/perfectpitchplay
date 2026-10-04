"""Unit tests for the auto-pick XI builder (server._auto_pick / _can_grow / _xi_legal).

No database or network is touched: the builder is pure logic over a squad list.
These guard the two things users feel — the XI must be legal, and it must not
be a cheap XI when a star XI fits inside 100 credits.
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "unittests")
os.environ.setdefault("JWT_SECRET", "unit-secret")
os.environ.setdefault("ADMIN_MOBILE", "9000000000")
os.environ.setdefault("ADMIN_PASSWORD", "unit-admin-pw")
os.environ.setdefault("ADMIN_UPI_ID", "admin@upi")
os.environ.setdefault("APP_NAME", "fantasy-contest")
os.environ.setdefault("CORS_ORIGINS", "*")

import motor.motor_asyncio  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

motor.motor_asyncio.AsyncIOMotorClient = AsyncMongoMockClient

import server  # noqa: E402

_counter = [0]


def P(name, team, role, credits, projection=0.0, playing=True):
    _counter[0] += 1
    return {
        "id": f"p{_counter[0]}", "name": name, "team": team, "role": role,
        "credits": float(credits), "projection": float(projection), "playing": playing,
    }


# India/Australia style squad where the expensive names alone blow the budget:
# a value-first greedy stalls at 10 players, so the builder has to be budget-aware.
STAR_SQUAD = [
    P("Virat Kohli", "IND", "BAT", 11, 70), P("Suryakumar Yadav", "IND", "BAT", 10, 66),
    P("Rohit Sharma", "IND", "BAT", 10.5, 62), P("Shubman Gill", "IND", "BAT", 9, 48),
    P("KL Rahul", "IND", "WK", 9.5, 52), P("Rishabh Pant", "IND", "WK", 8.5, 44),
    P("Hardik Pandya", "IND", "AR", 9.5, 55), P("Ravindra Jadeja", "IND", "AR", 8.5, 46),
    P("Jasprit Bumrah", "IND", "BOWL", 10, 64), P("Kuldeep Yadav", "IND", "BOWL", 8.5, 45),
    P("Mohammed Shami", "IND", "BOWL", 8, 40),
    P("Travis Head", "AUS", "BAT", 9.5, 58), P("David Warner", "AUS", "BAT", 9, 50),
    P("Steve Smith", "AUS", "BAT", 8.5, 42), P("Glenn Maxwell", "AUS", "AR", 9.5, 60),
    P("Mitchell Marsh", "AUS", "AR", 8, 38), P("Alex Carey", "AUS", "WK", 7.5, 30),
    P("Tim David", "AUS", "BAT", 7.5, 34), P("Pat Cummins", "AUS", "BOWL", 9, 52),
    P("Adam Zampa", "AUS", "BOWL", 8, 41), P("Josh Hazlewood", "AUS", "BOWL", 8, 39),
    P("Marcus Stoinis", "AUS", "AR", 7, 33),
]


def pick(squad, order="projection"):
    return asyncio.run(server._auto_pick(squad, order))


def test_builds_a_legal_xi_when_stars_are_expensive():
    got = pick(STAR_SQUAD)
    assert got, "auto-pick gave up on a squad that has legal XIs"
    assert len(got["player_ids"]) == server.TEAM_SIZE
    assert got["credits_used"] <= server.CREDIT_BUDGET
    assert max(got["per_team"].values()) <= server.MAX_PER_SIDE
    for role, (lo, hi) in server.ROLE_LIMITS.items():
        assert lo <= got["by_role"][role] <= hi


def test_prefers_the_high_projection_names():
    got = pick(STAR_SQUAD)
    names = {p["name"] for p in STAR_SQUAD if p["id"] in got["player_ids"]}
    top = {"Virat Kohli", "Suryakumar Yadav", "Jasprit Bumrah"}
    assert top <= names, names
    # the cheapest filler is not chosen over a star the budget can still afford
    assert got["credits_used"] > 90, got["credits_used"]


def test_captain_and_vice_are_the_two_best():
    got = pick(STAR_SQUAD)
    by_id = {p["id"]: p for p in STAR_SQUAD}
    ranked = sorted(got["player_ids"], key=lambda pid: -by_id[pid]["projection"])
    assert got["captain_id"] == ranked[0]
    assert got["vice_captain_id"] == ranked[1]


def test_rejects_when_no_xi_fits_the_budget():
    rich = [P(f"Star {i}", "IND" if i % 2 else "AUS", ("WK", "BAT", "AR", "BOWL")[i % 4], 12, 50)
            for i in range(22)]
    assert pick(rich) is None


def test_rejects_a_squad_with_no_wicketkeeper():
    no_wk = [p for p in STAR_SQUAD if p["role"] != "WK"] + [P("Extra Bat", "AUS", "BAT", 7, 20)]
    assert pick(no_wk) is None


def test_honours_the_seven_per_side_cap():
    lopsided = [P(f"IND {i}", "IND", ("BAT", "BOWL", "AR")[i % 3], 7, 60 - i) for i in range(12)]
    lopsided += [P(f"AUS {i}", "AUS", ("WK", "BAT", "BOWL")[i % 3], 8, 40 - i) for i in range(10)]
    got = pick(lopsided)
    assert got and got["per_team"]["IND"] <= server.MAX_PER_SIDE


def test_legal_helpers_agree_with_the_validator():
    xi = [p for p in STAR_SQUAD]
    got = pick(STAR_SQUAD)
    chosen = [p for p in xi if p["id"] in got["player_ids"]]
    assert server._xi_legal(chosen) is True
    assert server._xi_credits(chosen) == got["credits_used"]
    assert server._can_grow(chosen[:5], xi) is True
    too_many = chosen + [P("Twelfth man", "AUS", "BAT", 1, 1)]
    assert server._can_grow(too_many, too_many) is False
