"""Unit tests for the match-day feed, builder extras and play-safety guards.

Everything runs in-process against mongomock with no network: provider payloads are
synthetic, and each money/safety decision goes through the real product helpers, so
these guard what a user would notice — a ticker that names the right players, a live
board that remembers where you were, and limits that actually stop spend.
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone

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


def pl(pid, name, team, role, credits=8.0, projection=0.0):
    return {"id": pid, "name": name, "team": team, "role": role, "credits": credits,
            "projection": projection, "playing": True, "match_id": "m1"}


SQUAD = [
    pl("p-sk", "Suryakumar Yadav", "MUM", "BAT", 10.5, 78),
    pl("p-til", "Tilak Varma", "MUM", "BAT", 8.0, 30),
    pl("p-roh", "Rohit Sharma", "MUM", "BAT", 9.0, 40),
    pl("p-ish", "Ishan Kishan", "MUM", "WK", 8.5, 33),
    pl("p-bum", "Jasprit Bumrah", "MUM", "BOWL", 9.5, 66),
    pl("p-rah", "KL Rahul", "DEL", "BAT", 9.5, 60),
    pl("p-rab", "Kagiso Rabada", "DEL", "BOWL", 9.0, 72),
    pl("p-axar", "Axar Patel", "DEL", "AR", 8.5, 45),
]

RUN = asyncio.run


# ---------- ball-by-ball ticker ----------
def test_events_normalise_dicts_and_plain_strings():
    payload = {"ball_by_ball": [
        {"over": 15, "ball": 1, "batsman": "Tilak Varma", "bowler": "Kagiso Rabada", "runs": 0,
         "wicket": True, "text": "Tilak Varma c Rahul b Rabada 22(16)"},
        {"over": 15, "ball": 2, "batsman": "Suryakumar Yadav", "bowler": "Kagiso Rabada", "runs": 4,
         "text": "Suryakumar Yadav drives to the fence, FOUR"},
        "6  Ishan Kishan  b Axar Patel  30(12)",
    ]}
    evs = server.extract_live_events(payload, SQUAD)
    assert len(evs) == 3
    first = evs[0]
    assert first["batter_id"] == "p-til" and first["bowler_id"] == "p-rab"
    assert first["wicket"] is True and first["runs"] == 0
    assert evs[1]["boundary"] is True and evs[1]["batter_id"] == "p-sk"
    assert evs[2]["text"].startswith("6")  # bare-string ball still reaches the ticker
    assert evs[2]["runs"] == 6 and evs[2]["boundary"] is True


def test_events_keep_unknown_names_and_innings():
    evs = server.extract_live_events({"ball_by_ball": [
        {"over": 3, "ball": 4, "batsman": "Nobody Atall", "bowler": "K Rabada", "runs": 1,
         "text": "worked to mid on", "inns": "Mumbai 1st"}]}, SQUAD)
    assert evs[0]["batter_id"] is None
    assert evs[0]["batter"] == "Nobody Atall"
    assert evs[0]["bowler_id"] == "p-rab"          # initials still match
    assert evs[0]["inning"] == "Mumbai 1st"


def test_event_list_is_capped_at_the_tail():
    payload = {"ball_by_ball": [{"over": i // 6, "ball": i % 6 + 1, "batsman": "Rohit Sharma",
                                 "bowler": "Kagiso Rabada", "runs": 1} for i in range(200)]}
    evs = server.extract_live_events(payload, SQUAD)
    assert len(evs) == server.LIVE_EVENT_LIMIT
    assert evs[-1]["over"] == "33"


def test_events_from_the_info_block_shape():
    evs = server.extract_live_events({"info": {"ball_by_ball": [
        {"over": 1, "ball": 1, "batsman": "KL Rahul", "bowler": "J Bumrah", "runs": 6}]}}, SQUAD)
    assert len(evs) == 1 and evs[0]["batter_id"] == "p-rah" and evs[0]["boundary"] is True


# ---------- innings tables ----------
def test_innings_tables_from_provider_structure():
    payload = {"scorecard": [{
        "inns": "Delhi Inners 1st",
        "batting": [
            {"batsman": {"name": "KL Rahul"}, "runs": "52", "balls": "31", "fours": "6", "sixes": "2",
             "dismissalText": "c Kishan b Bumrah"},
            {"batsman": {"name": "Kagiso Rabada"}, "runs": "12", "balls": "8", "fours": "1", "sixes": "1"},
        ],
        "bowling": [{"bowler": {"name": "Jasprit Bumrah"}, "overs": "4", "maidens": "1", "runs": "15",
                     "wickets": "3"}],
    }]}
    tables = server.innings_tables(payload, [], SQUAD, [])
    assert len(tables) == 1 and tables[0]["innings"] == "Delhi Inners 1st"
    rahul = next(b for b in tables[0]["batting"] if b["player_id"] == "p-rah")
    assert rahul["runs"] == 52 and rahul["balls"] == 31 and rahul["strike_rate"] == 167.7
    assert rahul["out"] is True
    rab = next(b for b in tables[0]["batting"] if b["player_id"] == "p-rab")
    assert rab["out"] is False and rab["sixes"] == 1
    bowl = tables[0]["bowling"][0]
    assert bowl["player_id"] == "p-bum" and bowl["overs"] == "4"
    assert bowl["economy"] == 3.75 and bowl["wickets"] == 3


def test_innings_tables_fall_back_to_stat_lines():
    lines = [
        {"player_id": "p-sk", "played": True, "runs": 61, "balls": 33, "fours": 5, "sixes": 4, "out": True},
        {"player_id": "p-til", "played": True, "runs": 24, "balls": 19, "fours": 3},
        {"player_id": "p-bum", "played": True, "balls_bowled": 24, "runs_conceded": 15, "wickets": 3, "maidens": 1},
        {"player_id": "p-rab", "played": True, "runs": 12, "balls": 8, "balls_bowled": 26, "runs_conceded": 18,
         "wickets": 4},
    ]
    innings = [{"innings": "Mumbai 1st", "runs": 126, "wickets": 4, "overs": "15.2"},
               {"innings": "Delhi Inners 1st", "runs": 168, "wickets": 6, "overs": "20.0"}]
    tables = server.innings_tables({}, lines, SQUAD, innings)
    assert {t["innings"] for t in tables} == {"Mumbai 1st", "Delhi Inners 1st"}
    mum = next(t for t in tables if t["innings"] == "Mumbai 1st")
    assert [b["player_id"] for b in mum["batting"]] == ["p-sk", "p-til"]   # runs descending, bowlers left out
    assert mum["batting"][0]["strike_rate"] == 184.8
    assert [b["player_id"] for b in mum["bowling"]] == ["p-bum"]            # Bumrah bowls for Mumbai here
    assert mum["bowling"][0]["overs"] == "4.0" and mum["bowling"][0]["economy"] == 3.75
    del_table = next(t for t in tables if t["innings"] == "Delhi Inners 1st")
    assert [b["player_id"] for b in del_table["bowling"]] == ["p-rab"]
    assert [b["player_id"] for b in del_table["batting"]] == ["p-rab"]     # he batted and bowled
    assert del_table["bowling"][0]["overs"] == "4.2"


def test_run_rate_series_tracks_overs():
    events = [
        {"over": 0, "ball": 1, "runs": 4, "wicket": False},
        {"over": 0, "ball": 2, "runs": 6, "wicket": False},
        {"over": 1, "ball": 3, "runs": 0, "wicket": True},
        {"over": 2, "ball": 1, "runs": 1, "wicket": False},
    ]
    series = server.run_rate_series(events, [])
    assert [p["over"] for p in series] == [0, 1, 2]
    assert series[0]["runs"] == 10 and series[1]["wickets"] == 1 and series[2]["runs"] == 11
    assert all(b >= a["runs"] for a, b in zip(series, [p["runs"] for p in series][1:]))


def test_run_rate_series_falls_back_to_innings_totals():
    series = server.run_rate_series([], [{"innings": "Mumbai 1st", "runs": 120, "wickets": 5, "overs": "20.0"}])
    assert series and series[-1]["over"] == 20 and series[-1]["runs"] == 120


# ---------- live board remembers the previous rank ----------
async def _seed_board():
    for coll in (server.db.matches, server.db.players, server.db.player_scores, server.db.contests,
                 server.db.entries, server.db.fantasy_teams, server.db.match_live):
        await coll.delete_many({})
    await server.db.matches.insert_one({"id": "m1", "team_a_short": "MUM", "team_b_short": "DEL",
                                        "status": "live", "auto_live": False})
    for p in SQUAD:
        await server.db.players.insert_one(dict(p))
    await server.db.contests.insert_one({"id": "c1", "kind": "fantasy", "match_id": "m1", "title": "Cup",
                                         "entry_fee": 10, "status": "closed",
                                         "prize_breakdown": [{"rank": 1, "amount": 50}]})
    for i, (uid, ids, top) in enumerate((("u1", ["p-sk", "p-rah", "p-til", "p-roh", "p-ish", "p-bum", "p-rab",
                                                 "p-axar", "p-sk", "p-til", "p-roh"], "p-sk"),
                                         ("u2", ["p-rab", "p-axar", "p-bum", "p-rah", "p-sk", "p-roh", "p-til",
                                                 "p-ish", "p-rab", "p-axar", "p-bum"], "p-rab"))):
        await server.db.fantasy_teams.insert_one({
            "id": f"t{i}", "match_id": "m1", "user_id": uid, "name": f"T{i}",
            "player_ids": list(dict.fromkeys(ids)), "captain_id": top, "vice_captain_id": "p-bum",
            "credits_used": 100})
        await server.db.entries.insert_one({"id": f"e{i}", "contest_id": "c1", "user_id": uid,
                                            "user_name": uid, "status": "approved", "team_id": f"t{i}",
                                            "team_name": f"T{i}", "entry_fee": 10, "winner_prize": 0,
                                            "created_at": server.now_iso()})


async def _set_points(who_high):
    order = ["p-sk", "p-til", "p-roh", "p-ish", "p-bum"] if who_high else ["p-rab", "p-axar", "p-bum"]
    for i, pid in enumerate(order):
        await server.db.player_scores.update_one(
            {"match_id": "m1", "player_id": pid},
            {"$set": {"match_id": "m1", "player_id": pid, "player_name": pid, "team": "MUM", "role": "BAT",
                      "points": 90 - i * 10, "components": {"runs": 90 - i * 10}, "stats": {}}}, upsert=True)
    rest = ["p-rab", "p-axar", "p-bum"] if who_high else ["p-sk", "p-til", "p-roh", "p-ish"]
    for i, pid in enumerate(rest):
        await server.db.player_scores.update_one(
            {"match_id": "m1", "player_id": pid},
            {"$set": {"match_id": "m1", "player_id": pid, "player_name": pid, "team": "DEL", "role": "BOWL",
                      "points": 20 + i, "components": {"wickets": 20 + i}, "stats": {}}}, upsert=True)


def test_live_board_tracks_rank_movement():
    async def scenario():
        await _seed_board()
        await _set_points(who_high=True)
        first = await server.refresh_live_boards("m1")
        e0 = await server.db.entries.find_one({"id": "e0"}, {"_id": 0})
        e1 = await server.db.entries.find_one({"id": "e1"}, {"_id": 0})
        assert first["entries_ranked"] == 2
        assert e0["fantasy_rank"] == 1 and e0.get("fantasy_rank_prev") is None
        assert e1["fantasy_rank"] == 2 and e1["live_entries"] == 2
        c = await server.db.contests.find_one({"id": "c1"}, {"_id": 0})
        assert c["live_entries"] == 2 and c["live_top_points"] == e0["fantasy_points"]

        await _set_points(who_high=False)                 # the bowler's XI pulls ahead
        await server.refresh_live_boards("m1")
        e0 = await server.db.entries.find_one({"id": "e0"}, {"_id": 0})
        e1 = await server.db.entries.find_one({"id": "e1"}, {"_id": 0})
        assert (e0["fantasy_rank"], e0["fantasy_rank_prev"]) == (2, 1)
        assert (e1["fantasy_rank"], e1["fantasy_rank_prev"]) == (1, 2)
        assert e1["fantasy_points"] > e0["fantasy_points"]
        # money columns stay untouched by a live re-rank
        assert e0["status"] == "approved" and e0["winner_prize"] == 0 and e0.get("decided_at") is None
    RUN(scenario())


def test_leaderboard_exposes_components_for_my_xi():
    async def scenario():
        await _seed_board()
        await _set_points(who_high=True)
        contest = await server.db.contests.find_one({"id": "c1"}, {"_id": 0})
        entries = await server.db.entries.find({"contest_id": "c1"}, {"_id": 0}).to_list(10)
        rows = await server.build_leaderboard(contest, entries)
        assert rows[0]["rank"] == 1 and rows[0]["points"] > rows[1]["points"]
        captain = next(r for r in rows[0]["breakdown"] if r["is_captain"])
        assert captain["multiplier"] == 2.0 and captain["components"]
        assert captain["points"] == captain["base"] * 2
    RUN(scenario())


# ---------- play-safety guards ----------
def _user(**kw):
    base = {"id": "u1", "name": "Ravi", "role": "user", "wallet_balance": 500.0}
    base.update(kw)
    return base


def test_exclusion_blocks_play_and_deposits_but_not_withdrawals():
    future = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    excluded = _user(self_exclusion={"until": future, "days": 3})
    assert server._is_excluded(excluded) is True
    assert server._is_excluded(_user(self_exclusion={"until": past})) is False
    assert server._is_excluded(_user()) is False

    async def scenario():
        try:
            await server.enforce_play_safety(excluded, 10)
            assert False, "excluded user should not be able to play"
        except server.HTTPException as e:
            assert e.status_code == 400 and "break" in e.detail.lower()
        try:
            await server.enforce_deposit_safety(excluded, 100)
            assert False, "excluded user should not be able to deposit"
        except server.HTTPException as e:
            assert e.status_code == 400 and "exclusion" in e.detail.lower()
        # an admin is never blocked by these guards
        await server.enforce_play_safety(_user(role="admin", self_exclusion={"until": future}), 10)
    RUN(scenario())


def test_deposit_limit_rolls_over_and_blocks():
    async def scenario():
        await server.db.users.delete_many({})
        await server.db.users.insert_one({"id": "u1", "name": "Ravi", "role": "user", "wallet_balance": 0.0})
        await server.add_deposit("u1", 200)
        await server.add_deposit("u1", 50)
        fresh = await server.db.users.find_one({"id": "u1"}, {"_id": 0})
        assert await server.deposited_today(fresh) == 250

        limited = dict(fresh, deposit_limit_daily=300)
        await server.enforce_deposit_safety(limited, 40)          # 290 total — allowed
        try:
            await server.enforce_deposit_safety(limited, 400)
            assert False, "should be over the daily deposit limit"
        except server.HTTPException as e:
            assert e.status_code == 400 and "deposit limit" in e.detail.lower()
            assert "₹50" in e.detail                                  # tells you what is left

        stale = dict(fresh, deposit_day=(datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d"),
                     deposit_limit_daily=100)
        assert await server.deposited_today(stale) == 0            # new day, fresh allowance
        await server.enforce_deposit_safety(stale, 100)
    RUN(scenario())


def test_daily_play_cap_includes_the_entry_being_bought():
    async def scenario():
        await server.db.entries.delete_many({})
        await server.db.users.delete_many({})
        await server.db.settings.delete_many({"key": "safety"})
        await server.db.entries.insert_many([
            {"id": "x1", "user_id": "u9", "status": "approved", "entry_fee": 20, "created_at": server.now_iso()},
            {"id": "x2", "user_id": "u9", "status": "rejected", "entry_fee": 99, "created_at": server.now_iso()},
            {"id": "x3", "user_id": "u9", "status": "approved", "entry_fee": 40,
             "created_at": "2000-01-01T00:00:00+00:00"},
        ])
        assert await server.spend_today("u9") == 20
        try:
            await server.enforce_play_safety(_user(id="u9"), 10)   # nothing capped yet
        except server.HTTPException:
            assert False, "no cap should mean no block"
        await server.db.settings.update_one({"key": "safety"}, {"$set": {"key": "safety", "max_daily_spend": 25}},
                                            upsert=True)
        await server.enforce_play_safety(_user(id="u9"), 5)         # 25 total — still inside the cap
        try:
            await server.enforce_play_safety(_user(id="u9"), 10)
            assert False, "cap should stop the next entry"
        except server.HTTPException as e:
            assert e.status_code == 400 and "play cap" in e.detail.lower()
        await server.db.settings.delete_many({"key": "safety"})
    RUN(scenario())


def test_pan_validation_and_masking():
    assert server.PAN_RE.match("ABCDE1234F")
    assert server.PAN_RE.match("ZXBVK9218F")
    assert not server.PAN_RE.match("ABCDE1234")
    assert not server.PAN_RE.match("abcde1234f")
    assert not server.PAN_RE.match("ABCD12345F")
    masked = server._mask_pan("ABCDE1234F")
    assert masked.startswith("ABCDE") and masked.endswith("F") and "1234" not in masked


def test_safety_settings_defaults_are_permissive():
    async def scenario():
        await server.db.settings.delete_many({"key": "safety"})
        s = await server.get_safety_settings()
        assert s["allow_user_deposit_limit"] is True
        assert s["max_daily_spend"] == 0 and s["kyc_required_for_payouts"] is False
        assert s["allow_self_lift_exclusion"] is False             # a break should not be shortcut
        assert s["self_exclusion_max_days"] >= 30
    RUN(scenario())


# ---------- FAQ ----------
def test_faq_defaults_and_admin_override():
    async def scenario():
        await server.db.settings.delete_many({"key": "faq"})
        default = await server.get_faq()
        assert len(default) >= 6 and all(i["q"] and i["a"] for i in default)
        assert any("point" in i["q"].lower() for i in default)
        await server.db.settings.update_one({"key": "faq"}, {"$set": {"key": "faq", "items": [
            {"q": "Payouts?", "a": "UTR in the Withdrawals tab."}]}}, upsert=True)
        assert await server.get_faq() == [{"q": "Payouts?", "a": "UTR in the Withdrawals tab."}]
        await server.db.settings.update_one({"key": "faq"}, {"$set": {"items": []}})
        assert len(await server.get_faq()) == len(default)          # empty admin list falls back
        await server.db.settings.delete_many({"key": "faq"})
    RUN(scenario())
